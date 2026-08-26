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

/** The FLOOR for an ordinary poll. Overlap is intentional: cheap, and it covers
 *  a mail that arrived while the previous run was mid-flight. The actual window
 *  is measured from the last successful poll — see `windowDays`. */
export const POLL_DAYS = 2;

/** A first connect reaches further. This is the product difference direct read
 *  buys over forwarding — "here is your last fortnight" rather than "we start
 *  from now" — and it happens exactly once per mailbox.
 *
 *  FIFTEEN, NOT NINETY, and the reason is the review queue rather than the API
 *  cost. Ninety days of a real household's bank mail arrived as 52 transactions
 *  all at once, every one of them pending and needing a decision. A first
 *  impression that opens with fifty-two chores reads as work, not as help — and
 *  the tail of it is the least useful part, because a purchase from ten weeks
 *  ago is the hardest to remember and the least likely to be corrected
 *  accurately. A fortnight is enough to prove the feature works, on mail the
 *  person still recognises well enough to correct.
 *
 *  Nothing is lost by starting smaller: the mail stays in their mailbox, and
 *  widening this later re-reads whatever the bigger window covers, because
 *  clearing `backfilled_at` sends the next tick back through the backfill path
 *  and already-staged messages are skipped on `gmail_message_id`. */
export const BACKFILL_DAYS = 15;

/** How far ahead of a watch's expiry we renew it.
 *
 *  A watch lasts 7 days; renewing 2 days out means each mailbox is re-registered
 *  roughly every five days and still has two days of slack if a sweep fails.
 *  Renewing on the last day would leave none. */
export const RENEW_WITHIN_SECONDS = 2 * 86400;

/** Per-run ceilings. A run has a function timeout and a free-tier model quota,
 *  and both are better spent across mailboxes than exhausted on one. */
export const MAX_MESSAGES_PER_GRANT = 40;
export const MAX_MODEL_CALLS_PER_RUN = 10;

/** How many ids ONE RUN may list, on any path.
 *
 *  Listing is cheap — ids only, no bodies, and `listMessageIds` stops as soon as
 *  Gmail returns no next page, so a quiet mailbox costs exactly one request
 *  whatever this is set to. Staging is the expensive half, and that is what
 *  `MAX_MESSAGES_PER_GRANT` caps.
 *
 *  Keeping the two caps separate is the point. Listing only as many as a run can
 *  stage makes "there is more" indistinguishable from "there is nothing", and a
 *  run that cannot tell the difference marks itself finished and strands the
 *  rest. Sized well above a busy household's backfill window of bank mail. */
export const LIST_MAX_PER_RUN = 500;

/**
 * How far back this poll should reach, measured from the last successful one.
 *
 * A FIXED window is a trap: with `newer_than:2d` hard-coded, a worker that is
 * down for three days comes back and reads the last two, and the missing day is
 * gone with nothing anywhere recording that it existed. Since `last_synced_at`
 * is only written when a window was actually handled, the gap since then is
 * exactly what still needs reading.
 *
 * Plus a day of slack, floored at POLL_DAYS, because Gmail's `newer_than` is
 * day-granular and a same-day boundary would round the oldest mail out.
 */
export function windowDays(lastSyncedAt, nowMs) {
  if (!lastSyncedAt) return POLL_DAYS;
  const since = ((nowMs || Date.now()) - new Date(lastSyncedAt).getTime()) / 86400000;
  if (!Number.isFinite(since) || since < 0) return POLL_DAYS;
  return Math.max(POLL_DAYS, Math.ceil(since) + 1);
}

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
    fetched: 0, staged: 0, skipped: 0, unreadable: 0, held: 0, duplicates: 0, queued: 0,
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
  const days = backfilling ? BACKFILL_DAYS : windowDays(grant.last_synced_at, ctx.nowMs);
  const query = senders.inboxQuery(days, domains);

  const perRun = ctx.maxMessages ?? MAX_MESSAGES_PER_GRANT;
  // The same list cap on both paths. An ordinary poll can face a backlog too:
  // `windowDays` widens after an outage, and listing only what one run can stage
  // would truncate the catch-up exactly the way a truncated backfill does.
  const ids = await gmail.listMessageIds(
    query, ctx.listMax ?? LIST_MAX_PER_RUN, access, ctx.fetch);
  summary.fetched = ids.length;

  // One query for the whole window. A throw here is NOT caught: if the database
  // is unreachable, concluding "not staged" would insert a second copy of every
  // transaction in the window.
  const staged = await ctx.db.alreadyStaged(ids);
  const allFresh = ids.filter(id => !staged.has(id));
  summary.skipped = ids.length - allFresh.length;

  // The per-run ceiling applies to what is actually WORKED ON, not to what was
  // listed. Taking the cap off the list instead would end a backfill after 40
  // messages and mark it done, losing the rest of the history with nothing
  // recording that it was ever there.
  const fresh = allFresh.slice(0, perRun);
  const moreQueued = allFresh.length > fresh.length;
  summary.queued = allFresh.length - fresh.length;

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

  // Written last, and only when this run actually FINISHED the window: nothing
  // held, and nothing left queued. Both are the same rule seen from two angles —
  // `last_synced_at` is what `windowDays` measures from, so advancing it with
  // messages still unread shrinks the next window past them and they are gone
  // with nothing recording they were there. `backfilled_at` is the same, one
  // level up: setting it early drops a half-done backfill to an ordinary poll.
  //
  // Not advancing costs one repeated listing five minutes later, and the
  // already-staged check makes the repeat nearly free.
  if (!hitLimit && !moreQueued) {
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
  else if (moreQueued) summary.status = 'more';   // healthy, just not finished
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
    // review screen (`72-txn-review.js`) prefers `memo_display` and treats an
    // EMPTY one as the verdict it is, falling through to the counterparty rather
    // than resurrecting the raw auto-fill — which it could not do if either
    // transport had thrown a field away here.
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

/**
 * One Gmail push notification: read THAT mailbox, now.
 *
 * This is the whole latency story. The notification carries `{emailAddress,
 * historyId}` and no mail content, so what happens next is exactly the windowed
 * read a poll would do — same fetch, same sender filter, same seal, same insert.
 * Only the trigger is different, and the difference is minutes.
 *
 * WHAT IT RETURNS IS AN ACK DECISION, and that matters more than it looks.
 * Pub/Sub redelivers anything not acknowledged, for as long as the topic's
 * retention allows. So every outcome that will fail identically on a retry —
 * a malformed envelope, a mailbox we hold no grant for, a mailbox that is
 * held — must ACK. Only a genuinely transient failure should be left for
 * redelivery, and even then the 5-minute poll would have caught it anyway.
 *
 * A notification for a mailbox with no grant is ORDINARY, not an error: a watch
 * outlives a disconnect by up to 7 days, and during that window Gmail keeps
 * ringing a doorbell nobody is behind. Dropping it quietly is correct.
 */
export async function runPush(notification, ctx) {
  if (!notification || !notification.emailAddress) {
    return { status: 'ignored', reason: 'malformed', ack: true };
  }

  const grant = await ctx.db.grantByEmail(
    notification.emailAddress, gmail.foldAddress(notification.emailAddress));

  if (!grant) {
    // Disconnected, or awaiting re-consent (the query excludes those). Either
    // way there is nothing to read and nothing a retry would change.
    return { status: 'ignored', reason: 'no_grant', ack: true };
  }

  const summary = await runGrant(grant, {
    ...ctx,
    budget: ctx.budget || _budget(ctx.maxModelCalls ?? MAX_MODEL_CALLS_PER_RUN),
  });
  return { ...summary, ack: true };
}

/**
 * Re-registers the watches that are about to lapse.
 *
 * Runs on the same tick as the poll rather than as its own schedule: it is two
 * API calls per due mailbox, it is due for almost nobody on almost every run,
 * and a separate cron job is one more thing that can be silently not running.
 *
 * A watch that lapses takes the notifications with it and says nothing, so the
 * failure this prevents looks exactly like a quiet mailbox. The poll is what
 * keeps that from being data loss; this is what keeps it from being slow.
 */
export async function renewWatches(ctx) {
  if (!ctx.topicName) return { renewed: 0, failed: 0, skipped: 'no topic configured' };

  const due = await ctx.db.watchesDue(ctx.renewWithin ?? RENEW_WITHIN_SECONDS, ctx.maxGrants);
  let renewed = 0, failed = 0, needsReauth = 0;

  for (const grant of due) {
    try {
      const enc = ctx.fromBytea ? ctx.fromBytea(grant.refresh_token_enc) : grant.refresh_token_enc;
      const token = await decryptToken(enc, ctx.tokenKey, { subtle: ctx.subtle });
      const access = await gmail.accessToken(token, ctx.google, ctx.fetch);
      const result = await gmail.watch(ctx.topicName, access, ctx.fetch);
      await ctx.db.saveWatch(grant.id, result.expiration);
      renewed++;
    } catch (e) {
      if (e instanceof gmail.TokenRejected) {
        // Not a renewal failure: the grant itself is dead. Flagged so the app
        // asks, and so the next sweep stops spending calls on it.
        await ctx.db.markNeedsReauth(grant.id);
        needsReauth++;
      } else {
        // One mailbox failing must not stop the rest. The poll still covers it.
        failed++;
      }
    }
  }
  return { renewed, failed, needsReauth };
}
