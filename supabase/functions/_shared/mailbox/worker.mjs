/**
 * One poll: from a grant to a sealed row in the review queue.
 *
 * Pure orchestration. Every dependency — the database, `fetch`, the clock, the
 * crypto library — arrives as an argument, so the whole flow runs in a test with
 * a fake Google, a real bank email, real encryption, and the actual client
 * opener reading the result back.
 *
 * THE ORDER OF THE LAST TWO STEPS IS THE WHOLE DESIGN.
 *
 *   stage every message  →  then advance the cursor
 *
 * The cursor is written LAST and only when the window was handled. A crash, a
 * rate-limited model, a family that has not minted a staging key yet: all of
 * them leave `last_synced_at` where it was, so the next poll reads the same
 * window again. Advancing first would skip mail silently, and silence is this
 * pipeline's characteristic failure — there is no error page for a transaction
 * that never appeared.
 *
 * That makes re-reading normal rather than exceptional, which is why
 * `alreadyStaged` is asked once per window before anything is fetched, and why
 * `gmail_message_id` carries a UNIQUE constraint underneath it as the real
 * guard.
 */

import { resolveDestination, MailboxHold } from './identity.mjs';
import { buildStagedRow } from './stage.mjs';
import { readTransaction } from './extract.mjs';
import * as senders from './senders.mjs';
import * as gmail from './gmail.mjs';
import * as mailtext from './mailtext.mjs';
import { decryptToken } from './token-crypto.mjs';

/** An ordinary poll looks this far back. Overlap is intentional: cheap, and it
 *  covers a mail that arrived while the previous run was mid-flight. */
export const POLL_DAYS = 2;

/** A first connect reaches further. This is the product difference direct read
 *  buys over forwarding — "here is your last three months" rather than "we
 *  start from now" — and it happens exactly once per mailbox. */
export const BACKFILL_DAYS = 90;

/** Per-run ceilings. A run has a function timeout and a free-tier model quota,
 *  and both are better spent across mailboxes than exhausted on one. */
export const MAX_MESSAGES_PER_GRANT = 40;
export const MAX_MODEL_CALLS_PER_RUN = 10;

/**
 * Runs every due mailbox.
 *
 * One mailbox failing never stops the others: each is caught, counted and
 * reported. A run that dies on the first bad grant would let one broken
 * connection freeze everybody else's, which is exactly the kind of coupling a
 * multi-tenant job should not have.
 */
export async function runAll(ctx) {
  const grants = await ctx.db.dueGrants(ctx.maxGrants);
  const budget = _budget(ctx.maxModelCalls ?? MAX_MODEL_CALLS_PER_RUN);
  const results = [];

  for (const grant of grants) {
    try {
      results.push(await runGrant(grant, { ...ctx, budget }));
    } catch (e) {
      results.push({
        grantId: grant.id, email: grant.email,
        status: 'error', detail: String(e && e.message || e),
      });
    }
  }
  return { polled: grants.length, modelCalls: budget.used(), results };
}

/**
 * One mailbox.
 *
 * Returns a summary rather than throwing for the ordinary outcomes, because
 * "held" and "token rejected" are states the operator wants counted, not
 * incidents.
 */
export async function runGrant(grant, ctx) {
  const summary = {
    grantId: grant.id, email: grant.email, status: 'ok',
    fetched: 0, staged: 0, skipped: 0, unreadable: 0, held: 0, duplicates: 0,
  };

  // Resolved BEFORE any mail is fetched. A mailbox whose family has no staging
  // key cannot have a single row written for it, so fetching first would spend
  // Gmail calls and hand this process plaintext it has no way to store.
  let destination;
  try {
    destination = await resolveDestination(grant, ctx.db);
  } catch (e) {
    if (e instanceof MailboxHold) return { ...summary, status: 'held', reason: e.reason };
    throw e;
  }

  let token;
  try {
    const enc = ctx.fromBytea ? ctx.fromBytea(grant.refresh_token_enc) : grant.refresh_token_enc;
    token = await decryptToken(enc, ctx.tokenKey, { subtle: ctx.subtle });
  } catch (e) {
    // A credential we cannot read is not a transient failure and not something
    // the user can fix by waiting. Flagged so the app asks them to reconnect.
    await ctx.db.markNeedsReauth(grant.id);
    return { ...summary, status: 'token_unreadable' };
  }

  let access;
  try {
    access = await gmail.accessToken(token, ctx.google, ctx.fetch);
  } catch (e) {
    if (e instanceof gmail.TokenRejected) {
      await ctx.db.markNeedsReauth(grant.id);
      return { ...summary, status: 'needs_reauth' };
    }
    throw e;   // transient: no cursor write, next poll retries
  }

  const domains = await ctx.db.providerDomains();
  const backfilling = !grant.backfilled_at;
  const query = senders.inboxQuery(backfilling ? BACKFILL_DAYS : POLL_DAYS, domains);

  const ids = await gmail.listMessageIds(
    query, ctx.maxMessages ?? MAX_MESSAGES_PER_GRANT, access, ctx.fetch);
  summary.fetched = ids.length;

  // One query for the whole window. A throw here is NOT caught: if the database
  // is unreachable, concluding "not staged" would insert a second copy of every
  // transaction in the window.
  const staged = await ctx.db.alreadyStaged(ids);
  const fresh = ids.filter(id => !staged.has(id));
  summary.skipped = ids.length - fresh.length;

  let hitLimit = false;

  for (const id of fresh) {
    const message = await gmail.getMessage(id, access, ctx.fetch, mailtext);
    if (!message) { summary.skipped++; continue; }   // deleted between list and get

    const sender = senders.match(message.from, domains);
    if (!sender) { summary.skipped++; continue; }

    // DKIM is recorded on every row rather than enforced by default. It can
    // reject real mail — some banks legitimately sign with an ESP domain — so
    // it earns enforcement on observed verdicts rather than on principle. Under
    // this transport the stakes are higher than under forwarding: a phishing
    // mail only has to reach the user's inbox, not be forwarded to us.
    if (ctx.enforceSenderAuth && !message.dkim.pass) {
      summary.skipped++;
      await ctx.db.recordFailure({
        gmail_message_id: id, sender: message.from, subject: message.subject,
        error_reason: 'sender_auth_failed:' + message.dkim.result,
      });
      continue;
    }

    let read;
    try {
      read = await readTransaction(message, ctx.db, {
        llm: ctx.llm, fetch: ctx.fetch, budget: ctx.budget,
      });
    } catch (e) {
      // The model is unreachable or out of quota. HOLD the whole mailbox: the
      // cursor stays put and this message is read again next poll. Carrying on
      // through the rest of the window would advance past mail we never read.
      summary.held++;
      hitLimit = true;
      break;
    }

    if (!read.ok) {
      if (read.reason === 'not_a_transaction') { summary.skipped++; continue; }
      summary.unreadable++;
      await ctx.db.recordFailure({
        gmail_message_id: id, sender: message.from, subject: message.subject,
        error_reason: read.detail || read.reason,
      });
      continue;
    }

    const row = await buildStagedRow({
      gmailMessageId: id,
      destination,
      reading: _toReading(read.extraction, message),
      sourceProvider: read.extraction.source_provider || sender.provider,
      senderKind: sender.kind,
      deps: {
        nacl: ctx.nacl, rng: ctx.rng, subtle: ctx.subtle,
        dedupKey: ctx.dedupKey, db: ctx.db,
      },
    });

    if (row.duplicate_of_id) summary.duplicates++;
    if (await ctx.db.insertStaged(row)) summary.staged++;
    else summary.skipped++;      // raced with another run; the guard held
  }

  // Written last, and skipped entirely when the window was cut short. Not
  // advancing is what makes every hold above self-healing.
  if (!hitLimit) {
    await ctx.db.markSynced(grant.id, backfilling ? { backfilled_at: new Date().toISOString() } : {});
  }

  // One notification per run per mailbox, not one per transaction: a bank that
  // sends five mails in a burst is one thing to look at, not five. It carries no
  // amount and no merchant — the fact that something is waiting is the whole
  // message, and the payload travels through a service that must not learn more.
  if (summary.staged > 0 && ctx.notify) {
    try { await ctx.notify(grant, summary.staged); } catch { /* never fails a run */ }
  }

  if (hitLimit) summary.status = 'held';
  return summary;
}

/**
 * The extractor's field names, mapped to the ones stage.mjs wants.
 *
 * A translation layer rather than renaming one side: the extraction shape is
 * the one the shared `sender_fingerprints` templates were derived against, and
 * the staged shape is the one the client opener reads. Neither is free to move.
 */
function _toReading(x, message) {
  return {
    amount: x.amount,
    direction: x.direction,
    currency: x.currency || 'VND',
    merchant: x.counterparty_display || x.counterparty || null,
    reference: x.reference_number || null,
    // Falling back to the mail's own date: a template that could not anchor the
    // timestamp still produced a real transaction, and a row with no date
    // cannot be deduped or shown in the right place in the ledger.
    occurredAt: x.occurred_at || _headerDate(message),
    balance: x.balance ?? null,
    // Raw and tidied are BOTH carried, exactly as the forwarding pipeline
    // carries them. tidyMemo can legitimately return an empty description (bank
    // auto-fill like "NGUYEN THU TRANG chuyen tien" says nothing), and collapsing
    // the two here would either lose that judgement or lose the original. The
    // review screen reads `memo` today; when it learns to prefer `memo_display`
    // that improves both transports at once, which it cannot do if one of them
    // already threw a field away.
    description: x.memo ?? null,
    descriptionDisplay: x.memo_display ?? null,
    typeCode: x.type_code || null,
    channel: x.channel || null,
    accountTail: x.account_masked || null,
    category: x.category || null,
    senderAuth: message.dkim,
  };
}

function _headerDate(message) {
  if (message.internalDate) return new Date(message.internalDate).toISOString();
  const d = message.date ? new Date(message.date) : null;
  return d && !isNaN(d.getTime()) ? d.toISOString() : null;
}

/** A run-wide ceiling on model calls, shared across every mailbox in the run. */
function _budget(max) {
  let used = 0;
  return { spend: () => (used < max ? (used++, true) : false), used: () => used };
}
