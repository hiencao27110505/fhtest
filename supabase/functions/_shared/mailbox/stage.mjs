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
import { RAW_FIELDS, RAW_KEYS, PAYLOAD_V, SRC, SENDER_KINDS as CONTRACT_SENDER_KINDS, fieldAccepts, flowFor } from './contract.mjs';

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
/**
 * The flow a row lands under, reconciled against the direction.
 *
 * Separate function because the rule is a claim about MEANING, not a mapping:
 * "direction is evidence, flow is judgement, evidence wins." Inlining it would
 * bury that in a ternary and make the fallback look like a default.
 */
function _flowFor(reading) {
  const said = reading.flow;

  // The one judgement direction cannot contradict: a transfer is the same money
  // moving between the person's own accounts, so it is consistent with a credit
  // (money arriving in one) and a debit (leaving the other) alike.
  if (said === 'transfer') return 'transfer';

  // Otherwise the mail's own statement decides, and the model's opinion is
  // discarded rather than blended — a credit is income, a debit is expense.
  // This is also the path every TEMPLATE-parsed row takes, where no model ran
  // and `said` is simply absent.
  if (reading.direction === 'credit') return 'income';
  if (reading.direction === 'debit') return 'expense';

  // No direction at all. buildStagedRow refuses such a row upstream, so this is
  // unreachable in practice and returns null rather than inventing a flow.
  return said || null;
}

export function transactionTypeFor(kind) {
  return kind === 'bank' ? 'bank_txn' : 'ecommerce_receipt';
}

/** The five verdicts a reader may give (llm.mjs EXTRACTION_SCHEMA; the
 *  label-table reader answers two of them). Anything else seals as null: a
 *  closed vocabulary the device can switch on, never free text. */
export const READER_TYPES = ['bank_txn', 'subscription', 'ecommerce_receipt', 'p2p_transfer', 'bill_payment'];
function _readerType(v) {
  return typeof v === 'string' && READER_TYPES.indexOf(v) >= 0 ? v : null;
}

/** The sender kind as senders.match assigns it, or null when the caller had
 *  none. Sealed so the device can tell WHY transaction_type says what it says.
 *
 *  TWO GRAINS (2026-09-22). senders.mjs now tells a gateway, a broker and a
 *  lender apart from an e-wallet. A v1 row seals the COARSE kind it always
 *  sealed ('wallet' for all four, which is what they were inside the old
 *  WALLETS group), so nothing a v1 device reads has changed; a v2 row seals the
 *  finer one (contract.mjs SENDER_KINDS). */
const SENDER_KINDS = ['bank', 'wallet', 'receipt'];
function _senderKind(v) {
  if (typeof v !== 'string') return null;
  if (SENDER_KINDS.indexOf(v) >= 0) return v;
  return CONTRACT_SENDER_KINDS.indexOf(v) >= 0 ? 'wallet' : null;
}
function _senderKindFine(v) {
  return typeof v === 'string' && CONTRACT_SENDER_KINDS.indexOf(v) >= 0 ? v : null;
}

/* ── ONE FIELD LIST FOR BOTH MAPPERS (email-reading-v2 §4: "the mapping is the
 * wire") ──────────────────────────────────────────────────────────────────────
 *
 * worker.mjs `toReading` and ingest.mjs `normaliseReading` were two hand-written
 * lists that had to agree, and did not: `status` and the reader's verdict were
 * mapped by one and not the other, `card_masked` by neither for a while, and
 * every such gap sealed rows without the field FOR GOOD, because a box is never
 * amended. Both now call this, and this walks contract.mjs RAW_FIELDS. A field
 * added to the contract is carried by both transports the same day, and
 * pipeline/contract.test.js drives both real mappers to prove it.
 *
 * `source` is whatever the transport holds (the extraction, or the caller's
 * reading); `alias` names the source key where it is not the contract's key.
 * A value the contract does not accept (a wrong enum word, a string where a
 * number belongs) is carried as NULL: a sealed row is one nobody can inspect
 * afterwards to find out what went wrong.
 */
const _SRC_VALUES = Object.values(SRC);
const _TOP_KEYS = ['amount', 'currency', 'direction', 'counterparty', 'reference_number', 'counterparty_display'];
/* What a source calls a field, where that is not the sealed key. */
const _SRC_KEY_RENAMES = { category: 'category_hint', transaction_type: 'reader_type' };

export function carryRaw(source, alias) {
  const from = source || {};
  const names = alias || {};
  const out = {};
  for (const field of RAW_FIELDS) {
    let value;
    for (const name of [field.key].concat(names[field.key] || [])) {
      if (from[name] !== undefined && from[name] !== null) { value = from[name]; break; }
    }
    if (value === undefined) value = null;
    if (field.type === 'obj' && value && field.keys) value = _block(value, field.keys);
    if (field.key === 'src') value = _srcMap(value);
    out[field.key] = fieldAccepts(field, value) ? value : null;
  }
  return out;
}

/* A kind-specific block keeps ONLY the keys the contract lists for it, and is
   null rather than half-filled. This is also the privacy rule for receipts:
   a Grab receipt carries a home address, and a key that is not listed (there
   is no address key, on purpose) cannot ride into the box. */
function _block(value, keys) {
  if (typeof value !== 'object' || Array.isArray(value)) return null;
  const out = {};
  let any = false;
  for (const k of keys) { out[k] = value[k] ?? null; if (out[k] != null) any = true; }
  return any ? out : null;
}

/* The provenance map. An entry is kept for what it SAYS, never for whether its
   field carries a value: `signal: null` beside `src.signal: 'model'` is how the
   device reads "withdrawn after the detector and the model disagreed", and
   stripping that entry would turn it into "the mail never said".
   A block (`investment`, `loan`, `notice`) has ONE entry under its own key,
   plus a dotted entry (`investment.symbol`) where one inner field came from
   somewhere else; the device looks up the dotted key first. */
function _srcMap(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const out = {};
  for (const k of Object.keys(value)) {
    if (_SRC_VALUES.indexOf(value[k]) < 0) continue;
    const key = _SRC_KEY_RENAMES[k] || k;
    if (RAW_KEYS.indexOf(key) >= 0 || _TOP_KEYS.indexOf(key) >= 0) { out[key] = value[k]; continue; }
    const dot = key.indexOf('.');
    if (dot > 0) {
      const block = RAW_FIELDS.find((f) => f.key === key.slice(0, dot) && f.type === 'obj' && f.keys);
      if (block && block.keys.indexOf(key.slice(dot + 1)) >= 0) out[key] = value[k];
    }
  }
  return Object.keys(out).length ? out : null;
}

/* Keys this module decides at the seal, whatever a mapper carried. */
const _SEALED_HERE = ['v', 'src', 'flow', 'sender_kind', 'txn_source', 'transaction_type', '_transport', '_sender_auth'];

/**
 * The plaintext payload, before it is sealed. Pure: no key, no database, no
 * clock. Split out of buildStagedRow so the contract test and the scoreboard can
 * look at exactly what WOULD be sealed without opening a box.
 *
 * @param {{reading: object, senderKind?: string, readerV?: number, rowKind?: string}} args
 */
export function buildPayload(args) {
  const { reading, senderKind } = args;
  const readerV = Number(args.readerV) === 2 ? 2 : 1;
  const isNotice = args.rowKind === 'notice';
  // VND unless the mail said otherwise. There is a real USD sample in the
  // corpus and comparing bare numbers once read 200 USD as 200 VND, so the
  // currency travels with the amount everywhere — into the fingerprint, into
  // the box, and into the reviewer's hands.
  const currency = reading.currency || 'VND';
  const occurredAt = reading.occurredAt || reading.occurred_at || null;

  /* DERIVED FROM THE SENDER KIND, ON PURPOSE, and not to be "fixed" with the
     reader's verdict: the device's dedup engine reads this to tell a bank from
     a non-bank. The reader's own verdict rides beside it as
     raw_extracted.reader_type (2026-09-22). */
  const transactionType = transactionTypeFor(senderKind);

  const counterparty = reading.merchant || null;
  const counterpartyRawIn = reading.merchantRaw ?? reading.counterparty_raw ?? null;
  const counterpartyRaw = (counterparty && counterpartyRawIn && String(counterpartyRawIn) !== String(counterparty))
    ? String(counterpartyRawIn) : null;

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
      /* The foreign original behind a converted-VND amount (a $111
         subscription billed as 2.923.000đ — foreign-currency-emails-spec.md,
         Approach 2). Rides inside the box like every other content field; the
         review card shows it ("≈ $111") and promotion writes it into the
         ledger row's note as machine-readable provenance, so a future
         multi-currency migration can recover the originals. */
      fx_amount: reading.fxAmount ?? reading.fx_amount ?? null,
      fx_currency: reading.fxCurrency ?? reading.fx_currency ?? null,
      direction: reading.direction,
      balance: reading.balance ?? null,
      counterparty: reading.merchant || null,
      /* The counterparty verbatim, ONLY when the display form above differs
         from it ("MPOS*ZQ MART 01 HO CHI MINH VN" beside "ZQ MART 01"). The
         key above stays the tidied form every existing reader expects; this
         one is additive, and null whenever the two are the same string or
         there is no counterparty at all. */
      counterparty_raw: counterpartyRaw,
      memo: reading.description || null,
      memo_display: reading.descriptionDisplay ?? null,
      type_code: reading.typeCode || null,
      channel: reading.channel || null,
      account_masked: reading.accountTail || reading.account_tail || null,
      /* WHICH INSTRUMENT moved the money (borrowing-lending-spec §8): the
         review chip and the ledger meaning (expense vs card debt vs top-up)
         hang off this. Inside raw_extracted like the other cash-flow fields —
         a new top-level column would need 0068's CHECK to null it out, and the
         sealed row's key set is pinned. Null means "the mail did not say":
         the client defaults to deposit-expense behaviour with an editable
         chip, never inventing a debt. */
      account_kind: reading.accountKind ?? reading.account_kind ?? null,
      /* The repaid credit card on a card-payment mail, distinct from
         account_masked (the funding side). Last-4, inside the box like every
         cash-flow field. The review screen matches it to an owned card and
         pre-selects "Trả cho thẻ" (card-repayment-routing-spec.md). Null means
         the mail named no card. */
      card_masked: reading.cardMasked ?? reading.card_masked ?? null,
      reference_number: reading.reference || null,
      transaction_type: transactionType,
      /* What the READER said this mail is (p2p_transfer, bill_payment, ...),
         and which kind of sender it came from. Two NEW keys rather than a
         change to transaction_type: see the note where that is derived. Inside
         raw_extracted like everything else the database may not read; a
         top-level key would be a column 0068's CHECK has to null out. */
      reader_type: _readerType(reading.readerType ?? reading.reader_type),
      sender_kind: _senderKind(senderKind),
      occurred_at: occurredAt,
      category_hint: reading.category || null,
      /* The category-tree node (0144, taxonomy.mjs): the most specific code the
         extractor or the cascade in classify.mjs decided — 'coffee', or a group
         like 'utilities' — beside the legacy concept above, which old clients
         keep reading unchanged. Inside the box like category_hint: a top-level
         column would need 0068's CHECK to null it out, and the sealed row's
         key set is pinned. Null = nothing decided. */
      node: reading.node || null,
      /* PROVENANCE OF THE FIGURES, for the client's receipt join. 'receipt'
         means the sender is a merchant (senders.mjs RECEIPT_DOMAINS: Grab,
         Shopee, Apple...) whose mail describes the SAME purchase a bank or
         wallet notice also reports — the client joins it onto that row (memo,
         items, node) instead of importing it as a second transaction. Inside
         raw_extracted rather than a column: email_transactions has no
         txn_source column (0100's `source` is on the ledger tables, written at
         promote), and insertStaged posts the row verbatim, so an unknown
         top-level key would be a 400 that holds the message forever. Null for
         every bank and wallet row, which is every row today. */
      txn_source: reading.txnSource || (senderKind === 'receipt' ? 'receipt' : null),
      status: reading.status || null,

      /* WHERE THE MONEY LANDS. The client routes on this now — a credit files
         to the income book, a transfer should file to neither — so a wrong value
         is no longer cosmetic: a card payment filed as income inflates earnings,
         and a salary filed as spending inflates the budget.
    
         RECONCILED, not trusted. `direction` is a fact the mail states and a
         stored template can read with no model at all; `flow` is a judgement only
         the model makes. So where they disagree, direction wins and the
         judgement is discarded — a credit can only be income or transfer, a
         debit only expense or transfer. And where the model said nothing (every
         template-parsed row, which is most volume), it is DERIVED from direction
         rather than left null, so the client never has to guess.
    
         The cost of that fallback is the only case it gets wrong: an untagged
         internal transfer reads as income or expense. That is the failure the
         prompt is told to prefer, because a transfer filed as an expense is
         merely wrong and visible, while a real expense filed as a transfer
         vanishes from the ledger. */
      flow: _flowFor(reading),
      _transport: 'oauth_direct',
      _sender_auth: reading.senderAuth || null,
    },
  };


  if (readerV === 2) _sealV2(payload.raw_extracted, reading, senderKind);
  /* A NOTICE (spec §6) carries what it said whatever the mailbox's reader
     version: the row kind did not exist before v2, so there is no v1 shape to
     keep byte-identical, and a device that opens one needs `notice` (due day,
     minimum payment, closing debt) to update the account tile quietly. amount
     and direction are null: the mail moved no money. */
  if (isNotice) {
    const raw = payload.raw_extracted;
    const carried = reading.raw || {};
    raw.mail_kind = 'notice';
    raw.signal = carried.signal ?? reading.signal ?? null;
    raw.notice = carried.notice ?? null;
    raw.loan = carried.loan ?? null;
    raw.flow = null;
  }
  return payload;
}

/**
 * Payload v2, ADDED to the v1 keys above and never instead of them: a device
 * that knows nothing about v2 reads a v2 row exactly as it reads a v1 one.
 *
 * Walks contract.mjs RAW_FIELDS over what the mapper carried (`reading.raw`,
 * built by carryRaw). A v1 key keeps the value the v1 code above gave it and is
 * only FILLED from the carried value when that was null; a v2 key is set.
 */
function _sealV2(raw, reading, senderKind) {
  const carried = reading.raw || {};
  for (const field of RAW_FIELDS) {
    if (_SEALED_HERE.indexOf(field.key) >= 0) continue;
    let value = fieldAccepts(field, carried[field.key]) ? (carried[field.key] ?? null) : null;
    // The verbatim counterparty rides only beside a counterparty: one the tidy
    // layer REJECTED (a salutation) must not come back through the raw key.
    if (field.key === 'counterparty_raw' && !raw.counterparty) value = null;
    /* A carried NULL never erases a value the v1 code above produced. The
       contract lists counterparty_raw as a v2 key, but this file has sealed it
       since 2026-09-22 (only when it differs from the display form); writing
       the carried null over it lost the verbatim counterparty on every v2 row
       whose mapper had nothing to add. Caught by stage-v1-snapshot.test.js. */
    if (field.since === 1) {
      /* A v1 key the v1 code sealed WITHOUT checking it (account_kind, channel:
         whatever word the reader gave) is held to the contract on a v2 row: a
         word outside the enum is null, never a string nobody can switch on.
         Here and not above, because a v1 payload must stay byte-for-byte what
         it was, unchecked words included. Caught by pipeline/contract.test.js. */
      if (!fieldAccepts(field, raw[field.key])) raw[field.key] = null;
      if (raw[field.key] == null && value != null) raw[field.key] = value;
    } else raw[field.key] = value != null ? value : (raw[field.key] ?? null);
  }
  raw.sender_kind = _senderKindFine(senderKind) || raw.sender_kind;
  /* `flow` for a v2 row is DERIVED from the signal and the direction
     (contract.mjs flowFor), reconciled by the rule this file has always applied:
     direction is evidence, flow is judgement, evidence wins. A transfer-type
     signal is the one judgement direction cannot contradict. With no signal the
     v1 reconciliation above stands, so a caller that still says "transfer"
     (the forwarding reader) is heard. */
  if (raw.signal) raw.flow = flowFor(raw.signal, reading.direction) || raw.flow;
  raw.src = _srcMap(carried.src);
  raw.v = PAYLOAD_V;
}

/**
 * Builds one sealed staging row.
 *
 * @param {object} args
 * @param {string} args.gmailMessageId  idempotency key, bound inside the box
 * @param {object} args.destination     {memberId, familyId, stagingPub} from identity.mjs
 * @param {object} args.reading         what the parser read off the mail
 * @param {string} args.sourceProvider  the sender label ('techcombank', 'momo')
 * @param {string} args.senderKind      'bank' | 'wallet' | 'receipt' | undefined
 * @param {object} args.deps            {nacl, rng?, subtle?, dedupKey, db}
 * @return {Promise<object>} a row ready to insert, sealed
 * @throws on anything that would otherwise produce a readable or unowned row
 */
export async function buildStagedRow(args) {
  const { gmailMessageId, destination, reading, sourceProvider, senderKind, deps } = args;
  /* 'txn' (the default, and the only kind before 0147) or 'notice'. A notice
     has no amount, so it has no dedup fingerprint and is never compared with
     anything: the equality token would hash null, and the review queue has
     nothing to import from it. The column is CLEAR on the row (0147 says why). */
  const rowKind = args.rowKind === 'notice' ? 'notice' : 'txn';
  /* THE READER VERSION OF THIS MAILBOX (email-reading-v2 R15): a plain workflow
     column on mailbox_grants, default 1. At 1 the payload is byte-for-byte what
     it was before payload v2 existed (pinned by pipeline/stage-v1-snapshot.test.js);
     at 2 it also carries `v`, `src` and every contract.mjs field the mail stated. */
  const readerV = Number(args.readerV) === 2 ? 2 : 1;

  if (!gmailMessageId) throw new Error('STAGE_NO_MESSAGE_ID');
  /* A destination needs a key and somebody to belong to. Since 0092 that
     "somebody" can be an owner OR a member: a personal-only user has no member
     row, and requiring one would refuse exactly the people that migration
     admits. Requiring NEITHER would be worse than the old rule — a row with no
     owner and no member matches no RLS predicate and is visible to nobody,
     which is silent loss rather than a refusal anyone can see. */
  if (!destination || !destination.stagingPub) throw new Error('STAGE_NO_DESTINATION');
  if (!destination.ownerUserId && !destination.memberId) throw new Error('STAGE_NO_OWNER');
  if (!reading || (rowKind === 'txn' && (reading.amount == null || !reading.direction))) {
    throw new Error('STAGE_NOT_READABLE');
  }

  const currency = reading.currency || 'VND';
  const occurredAt = reading.occurredAt || reading.occurred_at || null;
  const payload = buildPayload({ reading, senderKind, readerV, rowKind });

  // Sealed BEFORE the fingerprint is computed and before anything is logged, so
  // that the window in which this function holds both a readable amount and a
  // writable row is as short as it can be made.
  /* The identity bound inside the box is whichever one scopes the row: the
     family for a family row, the owner for a personal one. A personal-only user
     has no family to bind, and binding a null would make the opener's check
     vacuous. */
  const isPersonal = destination.scope === 'personal';
  const scopeId = isPersonal ? destination.ownerUserId : destination.familyId;
  const envelope = sealForFamily(
    payload, destination.stagingPub, scopeId, gmailMessageId,
    { nacl: deps.nacl, rng: deps.rng }, destination.scope,
  );

  const dedupFp = rowKind === 'notice' ? null : await dedupFingerprint(
    reading.amount, reading.direction, currency, deps.dedupKey, deps.subtle,
  );

  let duplicateOfId = null;
  if (rowKind === 'txn' && deps.db && occurredAt) {
    const dup = await findDuplicate({
      amount: reading.amount,
      direction: reading.direction,
      currency,
      occurredAt,
      sourceProvider,
      memberId: destination.memberId,
      dedupFp,
      familyId: destination.familyId,
      scope: destination.scope,
      gmailMessageId,
    }, deps.db);
    duplicateOfId = dup ? dup.id : null;
  }

  return {
    gmail_message_id: gmailMessageId,
    // Both, whenever both are known. owner_user_id is what a personal-only user
    // is scoped by; member_id is what the forwarding transport routes on and
    // what dedup groups by. 0092's policy accepts either.
    owner_user_id: destination.ownerUserId || null,
    member_id: destination.memberId || null,
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
    /* Only written on a notice: a txn row omits the key and takes the column's
       default, so its insert is byte-identical to before 0147 existed. */
    ...(rowKind === 'notice' ? { row_kind: 'notice' } : {}),

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
