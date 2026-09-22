/**
 * Formats: what a stored template becomes (email-reading-v2 §8.2, decision R6).
 *
 * A v4 template (templates.mjs) is a set of regex anchors derived from one mail
 * and keyed by `(sender address, subject shape)`. It carries 5 frozen facts and
 * 7 anchored fields, it cannot carry a fee, a holder name or the other side's
 * bank, it fragments whenever a subject embeds a venue name, and it splits one
 * layout in two when a bank sends it from two addresses. 91% of successful
 * reads go through it, so most rows reach review with the least any tier knows.
 *
 * A FORMAT is a LABEL MAP instead: "the row labelled Tên người hưởng is the
 * beneficiary, Phí (bao gồm VAT) is the fee". It is keyed by
 * `(provider, label-set signature)`, where the signature is a hash of the
 * ordered labels of the mail's table. Subject noise stops mattering, sender
 * address variants stop mattering, and a credit variant with different labels
 * is its own format automatically. Applying one is the structural reader run
 * with the format's map in place of the vocabulary (labeltable.mjs readRows),
 * so a known format yields every v2 field the reader knows, for free, locally.
 *
 * THIS FILE IS THE PURE HALF. No I/O, no database: `get`/`put` belong to the
 * store the caller injects (extract.mjs `deps.formats`), and the table behind
 * it is another change's. What is here: the signature, the learner, the
 * applier, the proof that ties them together, and the hand-written seeds.
 *
 * NO PROOF, NO FORMAT. `learnFormat` replays what it built on the very mail it
 * was built from and returns null unless every learned field comes back
 * exactly. A plausible label map that does not reproduce its own source would
 * serve wrong figures to every later mail of that layout, to every family,
 * silently. Same bargain deriveExtractionTemplate has always made.
 *
 * LABELS ONLY, NEVER VALUES. A format is stored in a table every family shares.
 * Everything in it is the bank's boilerplate or a closed enum. A cited label
 * that looks like a value (digits, a name, the mail's own memo) is refused.
 */

import { SIGNALS, NOTICE_SIGNALS, SRC, SENDER_KINDS } from './contract.mjs';
import { readRows, vocabularyField } from './labeltable.mjs';
import { detectSignal } from './signals.mjs';
import { hashKey } from './classify.mjs';

export const FORMAT_V = 1;

const MAX_LABEL = 64;

/** The reader's own matching key for a label: deburred, lower-cased, single
 *  spaces, no trailing colon. Same reduction labeltable.mjs `_strip` makes. */
export function normLabel(label) {
  return String(label == null ? '' : label)
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd').replace(/Đ/g, 'D')
    .toLowerCase().replace(/\s+/g, ' ').replace(/\s*:$/, '').trim();
}

/* Is this string safe to KEEP as a label? Short, no run of digits (an account,
   a reference, a date), no currency mark, no address. Value-shaped strings are
   the incident extract_miss_labels was scrubbed for (spec §11). */
function _labelSafe(norm) {
  if (!norm || norm.length < 2 || norm.length > MAX_LABEL) return false;
  if (/\d{3,}/.test(norm)) return false;
  if (/[@₫$€£¥]|:\/\/|\bvnd\b/.test(norm)) return false;
  return /[a-z]/.test(norm);
}

/** The ordered, normalised labels a signature is taken over. Exported so a seed
 *  can be written as a list of labels and hashed by the same rule. */
export function signatureLabels(rows) {
  const out = [];
  for (const r of rows || []) {
    const n = normLabel(r && r.label);
    if (_labelSafe(n)) out.push(n);
  }
  return out;
}

/**
 * A stable hash of the ORDERED, normalised labels of a mail's rows. Labels
 * only, never values: two mails of one layout hash the same whatever they
 * report, and the hash says nothing about either.
 *
 * Async because it is WebCrypto, exactly as classify.mjs hashes a merchant key:
 * `crypto.subtle` is a global on Deno (the worker) and on the Node that runs
 * the tests, and a caller that holds one may pass it.
 */
export async function labelSignature(rows, subtle) {
  return signatureOfLabels(signatureLabels(rows), subtle);
}

export async function signatureOfLabels(labels, subtle) {
  const impl = subtle || (globalThis.crypto && globalThis.crypto.subtle);
  if (!impl) throw new Error('FORMAT_NO_DIGEST');
  return hashKey('fmt1\n' + (labels || []).join('\n'), impl);
}

/* ── parse modes ─────────────────────────────────────────────────────────────
   Recorded at learning and CHECKED at application: a format learned from
   "11:57 02/09/2026" that one day meets "2026-09-02 11:57:04" is a layout that
   changed, and the honest answer is the next tier, not a guess. */
function _whenMode(raw) {
  const s = String(raw || '');
  if (/\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}/.test(s)) return 'ymd_hm';
  if (/\d{2}[-\/]\d{2}[-\/]\d{4}\s+\d{2}:\d{2}/.test(s)) return 'dmy_hm';
  if (/\d{1,2}:\d{2}(?::\d{2})?\s+.*?\d{2}[\/\-]\d{2}[\/\-]\d{4}/.test(s)) return 'hm_dmy';
  return null;
}

/* Which row field a field of the READING is read from. The model cites labels
   against reading fields ("labels.counterparty"); a label map is keyed by row
   fields, because that is what the reader looks up. The counterparty is the
   one that needs a judgement: a shop, the payer, or the payee. */
function _rowFieldFor(readingField, extraction) {
  const x = extraction || {};
  switch (readingField) {
    case 'amount': return x.fx_amount != null ? 'converted' : 'amount';
    case 'fx_amount': return 'amount';
    case 'currency': case 'fx_currency': return 'currency_row';
    case 'occurred_at': return 'occurred_at';
    case 'counterparty':
      if (x.counterparty_kind === 'merchant') return 'merchant';
      if (x.counterparty_kind === 'bank') return 'cp_bank';
      return x.direction === 'credit' ? 'remitter' : 'beneficiary';
    case 'memo': return 'memo';
    case 'reference_number': return 'reference';
    case 'status': return 'status';
    case 'account_masked': case 'account_tail': return 'account';
    case 'balance': case 'balance_after': return 'balance';
    case 'card_masked': case 'card_tail': return 'card';
    case 'fee_amount': return 'fee';
    case 'available_limit': return 'limit';
    case 'holder_name': return 'holder';
    case 'counterparty_bank': return 'cp_bank';
    case 'counterparty_account_tail': return 'cp_account';
    case 'txn_kind': return 'txn_kind';
    default: return null;
  }
}

const _DEBIT_LABEL_RX = /\b(?:ghi no|trich no|tien ra|so tien chuyen|debited)\b/;
const _CREDIT_LABEL_RX = /\b(?:ghi co|nhan tien|tien vao|so tien nhan|credited|received)\b/;

function _sameText(a, b) {
  const f = (v) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim();
  return f(a) === f(b);
}
function _sameTail(a, b) {
  const d = (v) => String(v == null ? '' : v).replace(/\D/g, '').slice(-4);
  return d(a) === d(b);
}
function _sameInstant(a, b) {
  const x = Date.parse(a || ''), y = Date.parse(b || '');
  return Number.isFinite(x) && Number.isFinite(y) && x === y;
}

/**
 * Builds a format from one read mail, or returns null.
 *
 * Two sources, one output:
 *   source 'table'  the structural/line reader read the mail by itself.
 *                   `labels` is its own `{rowField: printed label}`.
 *   source 'model'  the model read it and CITED, per reading field, the label
 *                   it read the value from (`{amount: "Số tiền giao dịch"}`,
 *                   "~" when the value came from a sentence). A cited label
 *                   that does not occur among the mail's rows is dropped, not
 *                   trusted; "~" is not learnable.
 *
 * The hand-written vocabulary always wins: every row it resolves is mapped as
 * it resolves it, and a citation may only ADD a label it does not know. Then
 * the proof.
 *
 * @return {Promise<object|null>}
 */
export async function learnFormat(args) {
  const { provider, senderKind, rows, extraction, labels, source, subject, subtle } = args || {};
  try {
    if (!provider || !rows || rows.length < 3 || !extraction) return null;
    if (extraction.amount == null || !extraction.occurred_at) return null;
    /* A foreign-denominated mail does not teach a format, for the reason it
       does not teach a v4 template: one layout legitimately carries both
       currencies, and a map learned from the USD mail would be keyed exactly
       like the VND one. The structural reader reads such a mail every time,
       for free, with its currency intact. */
    if (extraction.currency && extraction.currency !== 'VND') return null;

    const present = new Map();                  // normalised label -> printed label, in row order
    for (const r of rows) { const n = normLabel(r.label); if (!present.has(n)) present.set(n, r.label); }

    const map = {};
    const taken = new Set();
    for (const [norm, printed] of present) {
      const f = vocabularyField(printed);
      if (f && !taken.has(f) && _labelSafe(norm)) { map[norm] = f; taken.add(f); }
    }
    if (source === 'model') {
      const values = Object.values(extraction).filter((v) => typeof v === 'string' && v.length >= 3).map(normLabel);
      for (const [readingField, cited] of Object.entries(labels || {})) {
        if (typeof cited !== 'string' || cited.trim() === '~' || !cited.trim()) continue;
        const norm = normLabel(cited);
        const rowField = _rowFieldFor(readingField, extraction);
        if (!rowField || !present.has(norm) || !_labelSafe(norm)) continue;      // not a row of THIS mail: dropped
        if (values.indexOf(norm) >= 0) continue;                                 // a value wearing a label's clothes
        if (map[norm] || taken.has(rowField)) continue;                          // the vocabulary already answered
        map[norm] = rowField; taken.add(rowField);
      }
    }
    if (!(taken.has('amount') || taken.has('converted')) || !taken.has('occurred_at')) return null;

    const amountLabel = Object.keys(map).find((k) => map[k] === 'amount' || map[k] === 'converted') || '';
    const direction = _DEBIT_LABEL_RX.test(amountLabel) ? 'debit' : (_CREDIT_LABEL_RX.test(amountLabel) ? 'credit' : null);

    /* The signal is frozen only when the LABELS or the SUBJECT state it, never
       because this one mail's memo happened to. From the subject it is frozen
       together with that subject's shape, so a second subject that shares the
       layout does not inherit a meaning it never stated. */
    const ctx = { senderKind };
    const fromLabels = detectSignal({ txn_kind: Object.keys(map).join(' | ') }, ctx).signal;
    const fromSubject = fromLabels ? null : detectSignal({}, { ...ctx, subject }).signal;
    const frozen = fromLabels || fromSubject || null;
    const signal = frozen && frozen !== 'purchase' && frozen !== 'p2p' ? frozen : null;

    const whenRaw = (rows.find((r) => map[normLabel(r.label)] === 'occurred_at' && r.value) || {}).value;
    const format = {
      v: FORMAT_V,
      provider: String(provider),
      sig: await labelSignature(rows, subtle),
      map,
      parse: { amount: 'vnd', occurred_at: _whenMode(whenRaw) },
      facts: {
        sender_kind: SENDER_KINDS.indexOf(senderKind) >= 0 ? senderKind : null,
        account_kind: extraction.account_kind || null,
        currency: 'VND',
      },
      direction,
      signal,
      signal_subject: signal && !fromLabels ? normLabel(subject) : null,
      source: source === 'model' ? 'model' : 'table',
    };

    // ── the proof ──
    const replay = applyFormat(format, rows, subject);
    if (!replay) return null;
    const x = extraction;
    if (replay.amount !== x.amount) return null;
    if (!_sameInstant(replay.occurred_at, x.occurred_at)) return null;
    if (x.direction && replay.direction !== x.direction) return null;
    const checks = [
      ['counterparty', _sameText], ['memo', _sameText], ['reference_number', _sameText],
      ['account_masked', _sameTail], ['card_masked', _sameTail], ['holder_name', _sameText],
      ['counterparty_bank', _sameText], ['counterparty_account_tail', _sameTail],
    ];
    for (const [field, same] of checks) {
      // Only what the format CLAIMS to read is held to the proof: a field the
      // model filled from a sentence ("~") is not in the map and not in the replay.
      if (replay[field] != null && x[field] != null && !same(replay[field], x[field])) return null;
    }
    for (const field of ['fee_amount', 'available_limit', 'balance', 'fx_amount']) {
      if (replay[field] != null && x[field] != null && replay[field] !== x[field]) return null;
    }
    return format;
  } catch { return null; }
}

/**
 * Reads a mail through a format's label map. Null means "the next tier":
 *   amount or date cannot be read, the date's printed form changed, the
 *   direction has no evidence in this mail and none frozen in the format, or a
 *   foreign currency appears where the format is VND (the posture the v4
 *   template path takes, for the same reason).
 */
export function applyFormat(format, rows, subject) {
  try {
    if (!format || !format.map || !rows) return null;
    const lookup = (label) => format.map[normLabel(label)] || null;
    const reading = readRows(subject, rows, lookup);
    if (!reading || reading.amount == null || !reading.occurred_at) return null;

    const facts = format.facts || {};
    if (facts.currency === 'VND' && reading.currency !== 'VND') return null;
    if (format.parse && format.parse.occurred_at) {
      const whenRaw = (rows.find((r) => lookup(r.label) === 'occurred_at' && r.value) || {}).value;
      if (_whenMode(whenRaw) !== format.parse.occurred_at) return null;
    }
    if (!reading.direction && format.direction) reading.direction = format.direction;
    if (!reading.direction) return null;

    if (facts.account_kind && reading.account_kind == null) reading.account_kind = facts.account_kind;
    if (format.signal && (SIGNALS[format.signal] || NOTICE_SIGNALS.indexOf(format.signal) >= 0)
        && (!format.signal_subject || format.signal_subject === normLabel(subject))) {
      // A HINT, not a verdict: signals.mjs still applies E7 and the tie-break.
      reading.signal_hint = format.signal;
    }

    // Read by a stored format, not off an unknown page: `template`.
    const src = {};
    for (const k of Object.keys(reading.src || {})) src[k] = reading.src[k] === SRC.PRINTED ? SRC.TEMPLATE : reading.src[k];
    if (reading.account_kind != null && facts.account_kind) src.account_kind = SRC.TEMPLATE;
    reading.src = src;
    reading.format_sig = format.sig || null;
    return reading;
  } catch { return null; }
}

/* ── seeds ───────────────────────────────────────────────────────────────────
   Hand-written formats, `source: 'seed'`, so first contact with a bank's main
   mail costs no model call (spec §3, §10.5; precedent 0140_statement_shapes_
   seed). Each was verified against the owner's 955-mail test set with
   tools/scoreboard/run.mjs: the count beside each is how many real mails it
   reads there. NONE is written from memory or from a bank's website: a format
   nobody has seen a mail of is not seeded.

   A seed is written as its ordered label list; its signature is computed from
   that list by the same rule as any mail's (seedFormats below), and pinned in
   pipeline/formats.test.js so the list and the reader cannot drift.

   Seeds are applied BEFORE learned formats and are never overwritten. When a
   seed stops matching, the learner writes a sibling and leaves the seed. */
export const SEED_FORMATS = Object.freeze([
  {
    /* VIB credit-card purchase notice, "Thông báo giao dịch thẻ tín dụng" (341
       mails). Not a table: five inline "Label: value" lines and a colon-less
       "Tại <merchant>". No local tier could read it and the template learner
       refused it as "foreign currency", so it paid the model on every mail:
       the largest single drain in production (spec §2). currency is NOT frozen:
       17 of the 341 are in USD and are read as the foreign figure they print. */
    id: 'vib.card_purchase_notice',
    provider: 'VIB',
    labels: ['so the', 'chu the', 'giao dich', 'gia tri', 'vao luc', 'tai'],
    map: { 'so the': 'card', 'chu the': 'holder', 'giao dich': 'txn_kind', 'gia tri': 'amount', 'vao luc': 'occurred_at', 'tai': 'merchant' },
    parse: { amount: 'vnd', occurred_at: 'hm_dmy' },
    facts: { sender_kind: 'bank', account_kind: 'credit_card', currency: null },
    direction: null, signal: null, signal_subject: null,
  },
  {
    /* VIB "Thanh toán thẻ tín dụng VIB thành công" (81 mails): the bank's own
       confirmation that a card bill was paid. The one format whose SUBJECT
       states its signal (spec §8.4). The issuer is the only counterpart the
       mail names, which is exactly what E7 asks of a repayment. */
    id: 'vib.card_repayment',
    provider: 'VIB',
    labels: ['so giao dich', 'trang thai giao dich', 'ngay giao dich', 'tu tai khoan', 'so the', 'ngan hang huong',
      'so tien', 'phi giao dich (bao gom vat)', 'dien giai'],
    map: { 'so giao dich': 'reference', 'trang thai giao dich': 'status', 'ngay giao dich': 'occurred_at', 'tu tai khoan': 'account',
      'so the': 'card', 'ngan hang huong': 'cp_bank', 'so tien': 'amount', 'phi giao dich (bao gom vat)': 'fee', 'dien giai': 'memo' },
    parse: { amount: 'vnd', occurred_at: 'hm_dmy' },
    /* account_kind is NOT frozen: the money leaves a deposit account to pay a
       card, the mail names both, and what the device does with a repayment
       already rests on the per-mail heuristic's answer. Not this seed's call. */
    facts: { sender_kind: 'bank', account_kind: null, currency: 'VND' },
    direction: null, signal: 'card_repayment', signal_subject: null,
  },
  {
    /* VIB "Thanh toán hóa đơn QR thành công", paid from a credit card (6 mails;
       the old line walk read none of the 15 QR bills: it knew neither "Nhà
       cung cấp" nor "Diễn giải"). Two sibling layouts exist in the test set, 9
       mails, where the bank's own template prints a placeholder key in place of
       the amount label; those are left to the structural reader, not seeded. */
    id: 'vib.qr_bill_card',
    provider: 'VIB',
    labels: ['so giao dich', 'trang thai giao dich', 'ngay giao dich', 'the tin dung', 'hang hoa/dich vu', 'nha cung cap',
      'so tien thanh toan', 'phi (bao gom vat)', 'dien giai'],
    map: { 'so giao dich': 'reference', 'trang thai giao dich': 'status', 'ngay giao dich': 'occurred_at', 'the tin dung': 'card',
      'hang hoa/dich vu': 'item', 'nha cung cap': 'merchant', 'so tien thanh toan': 'converted', 'phi (bao gom vat)': 'fee', 'dien giai': 'memo' },
    parse: { amount: 'vnd', occurred_at: 'hm_dmy' },
    facts: { sender_kind: 'bank', account_kind: 'credit_card', currency: 'VND' },
    direction: null, signal: null, signal_subject: null,
  },
].map((s) => Object.freeze({ v: FORMAT_V, source: 'seed', ...s })));

export function isSeed(format) { return !!format && format.source === 'seed'; }

let _seedIndex = null;
/** The seeds with their signatures computed: `[{...seed, sig}]`. Cached. */
export async function seedFormats(subtle) {
  if (_seedIndex) return _seedIndex;
  const out = [];
  for (const s of SEED_FORMATS) out.push(Object.freeze({ ...s, sig: await signatureOfLabels(s.labels, subtle) }));
  _seedIndex = out;
  return out;
}

export async function seedFor(provider, sig, subtle) {
  for (const s of await seedFormats(subtle)) if (s.provider === provider && s.sig === sig) return s;
  return null;
}

/**
 * The store extract.mjs uses when the caller injects none: the seeds, plus
 * whatever this process learns, for as long as the process lives. It is also
 * the reference for the contract a real store must keep:
 *
 *   get(provider, sig) -> Promise<format|null>   a seed first, then a learned one
 *   put(format)        -> Promise<boolean>       false, and nothing written, when
 *                                                a SEED holds that key
 */
export function memoryFormatStore(subtle) {
  const learned = new Map();
  const key = (provider, sig) => String(provider) + '\n' + String(sig);
  return {
    async get(provider, sig) {
      return (await seedFor(provider, sig, subtle)) || learned.get(key(provider, sig)) || null;
    },
    async put(format) {
      if (!format || !format.provider || !format.sig || isSeed(format)) return false;
      if (await seedFor(format.provider, format.sig, subtle)) return false;
      learned.set(key(format.provider, format.sig), format);
      return true;
    },
    size() { return learned.size; },
  };
}
