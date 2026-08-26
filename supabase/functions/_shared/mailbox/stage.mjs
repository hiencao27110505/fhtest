/**
 * Turning a parsed email into an email_transactions row.
 *
 * This is the boundary the whole feature stands on: everything before it holds
 * plaintext, everything after it holds ciphertext and routing metadata. The
 * worker that calls this can read a family's mail; the row it produces it can
 * never read back.
 *
 * WHAT STAYS CLEAR, AND WHY EACH ONE HAS TO
 *
 *   gmail_message_id  the idempotency key, queried before anything is decrypted
 *   member_id         ownership; the RLS policy in 0058 keys on it
 *   source_provider   dedup compares bank names FUZZILY; a hash matches exactly
 *   occurred_at       dedup queries a date RANGE
 *   dedup_fp          the equality token that replaces the sealed amount
 *   duplicate_of_id   workflow state, not content
 *   review_status     workflow state
 *
 * Everything else rides inside the box: amount, currency, direction,
 * counterparty, reference_number, transaction_type, and the whole raw_extracted
 * blob. 0068's CHECK constraint makes the half-sealed state unwritable — either
 * all four envelope columns are null, or all four are set AND every sensitive
 * column is null — so a bug that wrote both would be refused by Postgres rather
 * than quietly stored. This builder produces only the sealed shape.
 *
 * raw_body IS NOT STORED. Not sealed, not truncated — absent. It is ~20KB of
 * ciphertext per row that nothing ever reads back, and under this transport the
 * original mail is still sitting in the user's own mailbox, which is a better
 * archive than ours in every respect including the one that matters: they can
 * delete it. OAUTH-DIRECT-READ §3.3 asks for this to get stricter here rather
 * than looser, and this is what that looks like.
 *
 * SEAL-OR-HOLD IS ABSOLUTE. There is no argument, no config flag and no code
 * path from "could not seal" to a readable insert. A throw from here means the
 * caller leaves the cursor where it is and the same message is read again next
 * poll. The forwarding transport makes the same bargain by leaving the thread
 * labelled txn/inbox. SEALED-STAGING-DESIGN §4.3.
 */

import { sealForFamily } from './sealed-box.mjs';
import { dedupFingerprint, findDuplicate } from './dedup.mjs';

/**
 * The transaction_type values email_transactions accepts (0025's CHECK).
 *
 * The direct-read parser reads a mail's FIGURES; it has no opinion on what kind
 * of transaction they describe, and nothing in a bank notice says so. So the
 * kind is inferred from the sender we matched, which is the only evidence there
 * is, and a person corrects it at review — the same place they correct
 * everything else. Under sealing this value lives inside the box and the client
 * reads it back out of raw_extracted, where the bank-vs-bank dedup rule needs
 * it.
 */
export const TXN_TYPES = ['bank_txn', 'subscription', 'ecommerce_receipt', 'p2p_transfer', 'bill_payment'];

/**
 * What kind of transaction a sender's mail describes.
 *
 * `kind` comes from the sender registry: a bank domain says 'bank', a wallet or
 * merchant says 'wallet'. Anything unrecognised is a receipt rather than a bank
 * transaction, because guessing 'bank_txn' would feed the client's bank-vs-bank
 * rule a claim we cannot support — and that rule's job is to STOP a dedup, so a
 * wrong claim there hides nothing but does let a genuine duplicate through.
 */
export function transactionTypeFor(kind) {
  return kind === 'bank' ? 'bank_txn' : 'ecommerce_receipt';
}

/**
 * Builds one sealed staging row.
 *
 * @param {object} args
 * @param {string} args.gmailMessageId  idempotency key, bound inside the box
 * @param {object} args.destination     {memberId, familyId, stagingPub} from identity.mjs
 * @param {object} args.reading         what the parser read off the mail
 * @param {string} args.sourceProvider  the sender label ('techcombank', 'momo')
 * @param {string} args.senderKind      'bank' | 'wallet' | undefined
 * @param {object} args.deps            {nacl, rng?, subtle?, dedupKey, db}
 * @return {Promise<object>} a row ready to insert, sealed
 * @throws on anything that would otherwise produce a readable or unowned row
 */
export async function buildStagedRow(args) {
  const { gmailMessageId, destination, reading, sourceProvider, senderKind, deps } = args;

  if (!gmailMessageId) throw new Error('STAGE_NO_MESSAGE_ID');
  if (!destination || !destination.memberId || !destination.familyId || !destination.stagingPub) {
    throw new Error('STAGE_NO_DESTINATION');
  }
  if (!reading || reading.amount == null || !reading.direction) {
    throw new Error('STAGE_NOT_READABLE');
  }

  // VND unless the mail said otherwise. There is a real USD sample in the
  // corpus and comparing bare numbers once read 200 USD as 200 VND, so the
  // currency travels with the amount everywhere — into the fingerprint, into
  // the box, and into the reviewer's hands.
  const currency = reading.currency || 'VND';
  const occurredAt = reading.occurredAt || reading.occurred_at || null;

  const transactionType = transactionTypeFor(senderKind);

  // Everything the reviewer needs and nothing the database may read. The five
  // cash-flow fields ride in raw_extracted rather than in columns of their own,
  // the same treatment memo/status/account_masked already get on the forwarding
  // side — email_transactions has no column for them and adding six would mean
  // six more things for 0068's CHECK to have to null out.
  const payload = {
    amount: reading.amount,
    currency,
    direction: reading.direction,
    counterparty: reading.merchant || null,
    reference_number: reading.reference || null,
    transaction_type: transactionType,
    raw_extracted: {
      amount: reading.amount,
      currency,
      direction: reading.direction,
      balance: reading.balance ?? null,
      counterparty: reading.merchant || null,
      memo: reading.description || null,
      memo_display: reading.descriptionDisplay ?? null,
      type_code: reading.typeCode || null,
      channel: reading.channel || null,
      account_masked: reading.accountTail || reading.account_tail || null,
      reference_number: reading.reference || null,
      transaction_type: transactionType,
      occurred_at: occurredAt,
      category_hint: reading.category || null,
      _transport: 'oauth_direct',
      _sender_auth: reading.senderAuth || null,
    },
  };

  // Sealed BEFORE the fingerprint is computed and before anything is logged, so
  // that the window in which this function holds both a readable amount and a
  // writable row is as short as it can be made.
  const envelope = sealForFamily(
    payload, destination.stagingPub, destination.familyId, gmailMessageId,
    { nacl: deps.nacl, rng: deps.rng },
  );

  const dedupFp = await dedupFingerprint(
    reading.amount, reading.direction, currency, deps.dedupKey, deps.subtle,
  );

  let duplicateOfId = null;
  if (deps.db && occurredAt) {
    const dup = await findDuplicate({
      amount: reading.amount,
      direction: reading.direction,
      currency,
      occurredAt,
      sourceProvider,
      memberId: destination.memberId,
      dedupFp,
    }, deps.db);
    duplicateOfId = dup ? dup.id : null;
  }

  return {
    gmail_message_id: gmailMessageId,
    member_id: destination.memberId,
    source_provider: sourceProvider,
    occurred_at: occurredAt,
    dedup_fp: dedupFp,
    duplicate_of_id: duplicateOfId,
    review_status: 'pending',

    /* Which key sealed this, so the client knows which one opens it (0091).
       It cannot guess: it holds two private keys and a sealed box gives no hint
       which fits, so trying both would turn a wrong answer into a silent
       "unreadable row" instead of a clear one. Defaults to 'family' when the
       destination predates scopes, which is what every existing grant means. */
    staging_scope: destination.scope === 'personal' ? 'personal' : 'family',

    // The envelope. 0068's CHECK requires all four together.
    sealed: envelope.sealed,
    eph_pub: envelope.eph_pub,
    nonce: envelope.nonce,
    enc_v: envelope.enc_v,
  };
}

/**
 * The columns 0068 requires to be null on a sealed row.
 *
 * Exported so the test can assert the builder's output against the constraint
 * rather than against a copy of the builder's own opinion. A row that grew a
 * plaintext field would fail here before it ever failed in Postgres — which
 * matters, because the version of this CHECK in 0065 forgot raw_extracted and
 * transaction_type, the two most content-bearing fields after the amount, and
 * would have passed the very bug it existed to prevent.
 */
export const MUST_BE_NULL_WHEN_SEALED = [
  'amount', 'currency', 'direction', 'counterparty',
  'reference_number', 'transaction_type', 'raw_extracted', 'raw_body',
];
