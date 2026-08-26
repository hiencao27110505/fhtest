/**
 * Handing a mail we did NOT read into the staging table.
 *
 * The direct-read worker reads a mailbox and stages what it finds. This module
 * is the other way in: a pipeline that already reads the mailbox — the Python
 * ingest + parser on Cloud Run — hands over what it parsed, and we do the half
 * it deliberately does not do. Its `main.py` ends at `# TODO: persist`, and this
 * is that line's other end.
 *
 * WHY THE SEAL STAYS ON THIS SIDE. A staged row is sealed to
 * `family_keys.staging_pub` by whoever holds the plaintext last, and that is a
 * security boundary rather than a step. Porting it would make a THIRD
 * byte-compatible implementation of a construction one client opener has to read
 * back (`fhStagingOpenRow`), plus a second `DEDUP_FP_KEY` space — and the second
 * mint is silent: every cross-transport fingerprint stops matching, nothing
 * throws, and the queue quietly holds both halves of every purchase. So the
 * reader sends us a reading and we seal it, which keeps one implementation, one
 * key, and one place where plaintext becomes ciphertext.
 *
 * WHAT THIS IS NOT ALLOWED TO ASSUME. The caller is authenticated by a shared
 * secret, which makes it trusted, not correct. Everything it sends is validated
 * here: an amount that is not a finite number, a direction that is not one of
 * two words, or a missing message id is refused rather than sealed, because a
 * sealed row is one nobody can inspect afterwards to find out what went wrong.
 *
 * ─── THE ONE STRUCTURAL DIFFERENCE FROM THE POLL, AND IT MATTERS ───
 *
 * On the poll path a HOLD is free: we own the cursor, we leave it where it is,
 * and the same window is read again in five minutes. Here we own no cursor —
 * the calling pipeline advances its own `history_id` — so a hold cannot be
 * healed by anything in this file.
 *
 * It is acked anyway, and the reason is worth stating plainly because the
 * alternative looks safer and is not. Every hold reason is a property of the
 * MAILBOX, not of a message: no member, member archived, member moved, no
 * staging key. None of them clears in the seconds Pub/Sub would retry over, and
 * the commonest — a family that has never unlocked a device — can last days. So
 * refusing the ack would hold a redelivery loop open against a condition that
 * cannot change, back the topic up, and still lose the message when retention
 * expires.
 *
 * WHAT ACTUALLY HEALS IT IS THE POLL, and that makes the poll load-bearing here
 * rather than belt-and-braces. Our poller holds on the SAME conditions and
 * therefore does not advance `last_synced_at` either, so the window containing
 * this message stays open, and the first tick after a family mints a staging key
 * reads it again and stages it. Turn the poll off and a hold becomes silent data
 * loss. That is the trade this file is making, and it is why `held` is recorded
 * rather than merely returned.
 */

import { resolveDestination, MailboxHold } from './identity.mjs';
import { buildStagedRow } from './stage.mjs';
import { tidyMemo, tidyMerchant } from './memo.mjs';
import * as senders from './senders.mjs';
import * as gmail from './gmail.mjs';

/** The only two directions a bank notice can describe. */
export const DIRECTIONS = ['debit', 'credit'];

/** Why a payload was refused before anything was sealed. */
export const REJECT = {
  MALFORMED: 'malformed',
  NO_MESSAGE_ID: 'no_message_id',
  NO_EMAIL: 'no_email',
  NO_AMOUNT: 'no_amount',
  BAD_DIRECTION: 'bad_direction',
};

/**
 * Whether a value is a usable money amount.
 *
 * Rejects NaN, Infinity and negatives explicitly. Direction carries the sign in
 * this schema, so a negative amount means the caller is encoding the same fact
 * twice and one of the two is about to be wrong — better refused than sealed and
 * argued about later in a row nobody can open.
 */
function usableAmount(v) {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0;
}

/**
 * The caller's field names, mapped to the ones stage.mjs wants.
 *
 * A translation layer rather than a rename on either side: the Python reading is
 * the shape its parser package produces and its tests pin, and the staged shape
 * is the one the client opener reads. Neither is free to move, so the mapping
 * lives here where a mismatch is one file to look at.
 *
 * `body` is used and never stored. It is passed only so the memo tidy can do its
 * full job — the holder's name is detected by it appearing ELSEWHERE in the mail,
 * which is a question the memo alone cannot answer. `buildStagedRow` writes no
 * raw_body under any transport, so this string dies with the request.
 */
export function normaliseReading(raw, body) {
  const r = raw || {};
  const memo = r.description ?? r.memo ?? null;

  // The same tidy the direct-read extractor applies, for the same reason: what a
  // bank stamps into "Nội dung chuyển tiền" is usually not what the money was
  // for. Without this the rows this transport stages would arrive with no
  // memo_display, and the review screen would fall back to the raw auto-fill —
  // reintroducing, for this transport only, the bug that field exists to fix.
  const tidy = tidyMemo(memo, body || '');
  const merchant = r.merchant ?? r.counterparty ?? null;

  return {
    amount: r.amount,
    currency: r.currency || 'VND',
    direction: r.direction,
    balance: r.balance ?? null,
    merchant: merchant ? tidyMerchant(merchant) : null,
    description: memo,
    descriptionDisplay: tidy.description,
    typeCode: r.type_code || r.typeCode || tidy.code || null,
    channel: r.channel ?? null,
    accountTail: r.account_tail ?? r.accountTail ?? null,
    reference: r.reference ?? r.reference_number ?? null,
    category: r.category ?? null,
    occurredAt: r.occurred_at ?? r.occurredAt ?? null,
    senderAuth: r.sender_auth ?? r.senderAuth ?? null,
  };
}

/**
 * Everything that can be judged without touching the database.
 *
 * Split out so the route can refuse a bad payload without spending a grant
 * lookup on it, and so the test can enumerate the refusals cheaply.
 */
export function validate(payload) {
  if (!payload || typeof payload !== 'object') return REJECT.MALFORMED;
  if (!payload.gmailMessageId) return REJECT.NO_MESSAGE_ID;
  if (!payload.email) return REJECT.NO_EMAIL;

  const r = payload.reading;
  if (!r || typeof r !== 'object') return REJECT.MALFORMED;
  if (!usableAmount(r.amount)) return REJECT.NO_AMOUNT;
  if (DIRECTIONS.indexOf(r.direction) < 0) return REJECT.BAD_DIRECTION;
  return null;
}

/**
 * Which sender this mail is from, according to US.
 *
 * Our registry is authoritative when it recognises the address, because
 * `source_provider` is what the client's bank-vs-bank dedup rule matches on
 * fuzzily and it should mean the same thing whichever transport wrote the row.
 *
 * When it does NOT recognise the address the mail is still staged, under the
 * caller's own label. The two registries are maintained separately and theirs is
 * wider today; refusing what they accepted would drop real transactions to
 * enforce a list, and the drop would be invisible. The divergence is REPORTED
 * instead — `senderUnknownToUs` in the result — so it shows up in their logs and
 * in the smoke test rather than being quietly absorbed.
 */
async function resolveSender(payload, ctx) {
  const declared = {
    provider: payload.sourceProvider || null,
    kind: payload.senderKind === 'bank' ? 'bank' : 'wallet',
    unknown: false,
  };
  if (!payload.from) return declared;

  let extra = [];
  try { extra = await ctx.db.providerDomains(); } catch { /* our list alone still decides */ }
  const matched = senders.match(payload.from, extra);
  if (matched) return { provider: matched.provider, kind: matched.kind, unknown: false };
  return { ...declared, unknown: true };
}

/**
 * Stage one parsed mail handed over by an external reader.
 *
 * Returns an ACK DECISION, the same contract `runPush` answers on. Anything that
 * will fail identically on a retry acks; only a genuinely transient fault is left
 * unacknowledged, because fighting a permanent failure with redelivery is how a
 * topic backs up.
 *
 * @param {object} payload {email, gmailMessageId, sourceProvider, senderKind, from?, body?, reading}
 * @param {object} ctx     the same ctx the worker uses: {db, nacl, rng, subtle, dedupKey, notify?}
 */
export async function runIngest(payload, ctx) {
  const bad = validate(payload);
  if (bad) return { status: 'rejected', reason: bad, ack: true };

  const email = String(payload.email);
  const messageId = String(payload.gmailMessageId);

  const grant = await ctx.db.grantByEmail(email, gmail.foldAddress(email));
  if (!grant) {
    // Disconnected, or awaiting re-consent. A reader can outlive a disconnect —
    // theirs holds its own credentials — so this is ordinary, not an error.
    return { status: 'ignored', reason: 'no_grant', ack: true };
  }

  let destination;
  try {
    destination = await resolveDestination(grant, ctx.db);
  } catch (e) {
    if (!(e instanceof MailboxHold)) throw e;
    // Recorded, not just returned. A hold here is the one failure this path
    // cannot heal by itself (see the header), so it has to be greppable rather
    // than inferred from an absence of rows. No plaintext goes in: the message
    // id and the reason are the whole record.
    await ctx.db.recordFailure({
      gmail_message_id: messageId,
      sender: payload.sourceProvider || null,
      error_reason: 'ingest_hold:' + e.reason,
    });
    return { status: 'held', reason: e.reason, ack: true };
  }

  // Delivery upstream is at-least-once and their own docstring says so, so the
  // same mail arrives more than once as a matter of course. Asked before the
  // seal because sealing is the expensive half, and backed by the UNIQUE on
  // gmail_message_id underneath in case two deliveries race past this check.
  const staged = await ctx.db.alreadyStaged([messageId], destination.memberId, destination.ownerUserId);
  if (staged.has(messageId)) return { status: 'skipped', reason: 'already_staged', ack: true };

  const sender = await resolveSender(payload, ctx);

  const row = await buildStagedRow({
    gmailMessageId: messageId,
    destination,
    reading: normaliseReading(payload.reading, payload.body),
    sourceProvider: sender.provider,
    senderKind: sender.kind,
    deps: {
      nacl: ctx.nacl, rng: ctx.rng, subtle: ctx.subtle,
      dedupKey: ctx.dedupKey, db: ctx.db,
    },
  });

  const inserted = await ctx.db.insertStaged(row);
  if (!inserted) return { status: 'skipped', reason: 'raced', ack: true };

  // One notification per staged row here, unlike the poll's one-per-run: this
  // path is called per message and holds no run to summarise. It carries the
  // same nothing the poll's does — no amount, no merchant.
  if (ctx.notify) {
    try { await ctx.notify(grant, 1); } catch { /* never fails an ingest */ }
  }

  return {
    status: 'staged',
    ack: true,
    duplicate: !!row.duplicate_of_id,
    senderUnknownToUs: sender.unknown,
    provider: sender.provider,
  };
}
