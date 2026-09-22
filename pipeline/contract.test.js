#!/usr/bin/env node
/* The reading contract, held against the three things it must agree with.
 * `node pipeline/contract.test.js`
 *
 * contract.mjs is ONE definition of what a read mail states. It is only worth
 * anything if the tree, the two mappers and the seal all obey it, and each of
 * those has drifted before: `status` was mapped by one transport and not the
 * other, `card_masked` by neither, and a field missing from a mapper seals every
 * row without it for good, because a box is never amended
 * (docs/specs/email-reading-v2-spec.md §4, "the mapping is the wire").
 *
 * This file drives the REAL functions: worker.mjs toReading, ingest.mjs
 * normaliseReading, stage.mjs buildPayload. Fixtures are synthetic.
 *
 * Properties pinned:
 *   • every node a signal names exists in taxonomy/taxonomy.json, under a kind
 *     that fits what the signal proposes
 *   • every RAW_FIELDS key reaches the sealed v2 payload through BOTH mappers
 *   • a value the contract does not accept seals as null (a wrong enum word, a
 *     string where a number belongs), through both mappers
 *   • flowFor: transfer-type signals are transfers; otherwise direction decides
 */
const fs = await import('node:fs');
const url = await import('node:url');
const HERE = url.fileURLToPath(new URL('.', import.meta.url));
const ROOT = HERE + '../supabase/functions/_shared/mailbox/';
const C = await import(ROOT + 'contract.mjs');
const W = await import(ROOT + 'worker.mjs');
const I = await import(ROOT + 'ingest.mjs');
const S = await import(ROOT + 'stage.mjs');
const TREE = JSON.parse(fs.readFileSync(HERE + '../taxonomy/taxonomy.json', 'utf8'));

let pass = 0, fail = 0;
const t = (n, ok, d) => { console.log((ok ? '  PASS  ' : '  FAIL  ') + n + (!ok && d !== undefined ? '  -> ' + JSON.stringify(d) : '')); ok ? pass++ : fail++; };

/* ── signals ↔ the tree ──────────────────────────────────────────────────── */
console.log('\n-- every signal node exists in the tree, under the right kind --');
const byCode = Object.fromEntries(TREE.nodes.map((n) => [n.code, n]));
/* What a signal PROPOSES (the review kind, csvRowKindCur's vocabulary) → the
   tree kinds its nodes may live under. `xfer` admits investment because the
   spec's savings_move row reads "transfer or Đầu tư": a term deposit is filed
   under investment in the tree and proposed as a move of the person's own money. */
const KINDS_FOR = { expense: ['expense'], income: ['income'], xfer: ['transfer', 'investment'], cardpay: ['transfer'],
  invest: ['investment'], loan: ['loan'], repay: ['repayment'] };
for (const [signal, def] of Object.entries(C.SIGNALS)) {
  const codes = def.node ? [def.node] : (def.nodes || []);
  t(signal + ' has `node` or `nodes`, never both', !(def.node && def.nodes));
  for (const code of codes) {
    const n = byCode[code];
    t(signal + ' → ' + code + ' exists', !!n, code);
    if (n) t(signal + ' → ' + code + ' is ' + n.kind + ', which fits "' + def.proposes + '"', (KINDS_FOR[def.proposes] || []).includes(n.kind), { kind: n.kind, proposes: def.proposes });
    if (n) t(signal + ' → ' + code + ' is not a manual-only node', !n.manual);
  }
  if (!codes.length) t(signal + ' leaves the node to the merchant path', def.node === null && (signal === 'purchase' || signal === 'p2p'));
}
t('the signal enum in RAW_FIELDS is the two lists, nothing else',
  JSON.stringify(C.RAW_FIELDS.find((f) => f.key === 'signal').values) === JSON.stringify([...Object.keys(C.SIGNALS), ...C.NOTICE_SIGNALS]));

/* ── the mappers ─────────────────────────────────────────────────────────── */
/* A valid sentinel per field, by type. */
const sentinel = (f) => f.type === 'num' ? 4242 : f.type === 'str' ? 'zq-' + f.key
  : f.type === 'enum' ? f.values[f.values.length - 1]
  : f.type === 'arr' ? ['zq']
  : f.key === 'src' ? { amount: 'printed' }
  : f.keys ? Object.fromEntries(f.keys.map((k) => [k, 'zq-' + k])) : { zq: 1 };

/* Keys decided AT THE SEAL, whatever a mapper carried: asserted separately. */
const SEALED_HERE = { v: 2, _transport: 'oauth_direct', sender_kind: 'broker', txn_source: null, transaction_type: 'ecommerce_receipt' };
const MESSAGE = { internalDate: Date.parse('2026-09-20T01:15:00Z'), dkim: { result: 'pass', pass: true } };
const MAPPERS = [
  /* The extraction's own names: category, transaction_type and counterparty are
     what it calls category_hint, reader_type and counterparty_raw. */
  ['worker.mjs toReading', (field, value) => {
    const name = { category_hint: 'category', reader_type: 'transaction_type', counterparty_raw: 'counterparty' }[field.key] || field.key;
    const x = { amount: 90000, direction: 'debit', counterparty: 'ZQ MART' };
    x[name] = value;
    if (field.key === 'counterparty_raw') x.counterparty_display = 'ZQ';
    return W.toReading(x, MESSAGE);
  }],
  ['ingest.mjs normaliseReading', (field, value) => {
    const r = { amount: 90000, direction: 'debit', counterparty: 'ZQ MART' };
    r[field.key] = value;
    if (field.key === 'counterparty_raw') { delete r.counterparty; r.merchant = 'ZQ'; }
    return I.normaliseReading(r, '');
  }],
];

for (const [name, map] of MAPPERS) {
  console.log('\n-- ' + name + ': every RAW_FIELDS key is carried to the seal --');
  for (const field of C.RAW_FIELDS) {
    if (field.key in SEALED_HERE || field.key === 'flow' || field.key === '_sender_auth') continue;
    // memo_display and type_code are DERIVED by the ingest mapper's own tidy;
    // reader_type is a closed list of its own (stage.mjs READER_TYPES).
    let value = sentinel(field);
    if (field.key === 'reader_type') value = 'bill_payment';
    if (field.key === 'memo_display' && name.startsWith('ingest')) continue;
    const reading = map(field, value);
    t(field.key + ' is in reading.raw', JSON.stringify(reading.raw[field.key]) === JSON.stringify(value), reading.raw[field.key]);
    const sealed = S.buildPayload({ reading, senderKind: 'broker', readerV: 2 }).raw_extracted;
    const want = field.key === 'src' ? { amount: 'printed' } : value;
    t(field.key + ' is in the sealed v2 payload', JSON.stringify(sealed[field.key]) === JSON.stringify(want), sealed[field.key]);
  }
  const base = S.buildPayload({ reading: map({ key: 'memo' }, 'zq'), senderKind: 'broker', readerV: 2 }).raw_extracted;
  for (const [k, v] of Object.entries(SEALED_HERE)) t(k + ' is decided at the seal: ' + JSON.stringify(v), JSON.stringify(base[k]) === JSON.stringify(v), base[k]);
  t('flow is derived at the seal', base.flow === 'expense', base.flow);
  t('every RAW_FIELDS key is PRESENT in a v2 payload, null or not', C.RAW_KEYS.every((k) => k in base), C.RAW_KEYS.filter((k) => !(k in base)));

  console.log('\n-- ' + name + ': what the contract does not accept seals as null --');
  for (const field of C.RAW_FIELDS.filter((f) => f.type === 'enum' && !(f.key in SEALED_HERE) && f.key !== 'flow')) {
    const sealed = S.buildPayload({ reading: map(field, 'not-a-real-' + field.key), senderKind: 'bank', readerV: 2 }).raw_extracted;
    t('a wrong ' + field.key + ' → null', sealed[field.key] === null, sealed[field.key]);
  }
  for (const key of ['fee_amount', 'fx_rate', 'available_limit']) {
    const field = C.RAW_FIELDS.find((f) => f.key === key);
    t('a string where ' + key + ' wants a number → null', S.buildPayload({ reading: map(field, '1,100'), senderKind: 'bank', readerV: 2 }).raw_extracted[key] === null);
    t('NaN is not a number either', S.buildPayload({ reading: map(field, NaN), senderKind: 'bank', readerV: 2 }).raw_extracted[key] === null);
  }
  t('an array where a block belongs → null', S.buildPayload({ reading: map(C.RAW_FIELDS.find((f) => f.key === 'loan'), ['x']), senderKind: 'bank', readerV: 2 }).raw_extracted.loan === null);
  t('a block with nothing in it → null, never a half-filled object', S.buildPayload({ reading: map(C.RAW_FIELDS.find((f) => f.key === 'loan'), { due_date: null }), senderKind: 'bank', readerV: 2 }).raw_extracted.loan === null);
  t('a receipt block cannot carry an address: unlisted keys are dropped',
    !('address' in (S.buildPayload({ reading: map(C.RAW_FIELDS.find((f) => f.key === 'receipt'), { service_type: 'ride', address: '1 ZQ Street' }), senderKind: 'receipt', readerV: 2 }).raw_extracted.receipt || {})));
}

console.log('\n-- the ingest mapper still hears the names it always heard --');
{
  const r = I.normaliseReading({ amount: 1, direction: 'debit', accountTail: '…0000', cardTail: '…1111', balanceAfter: 500, feeAmount: 1100, holderName: 'NGUYEN VAN A', category: 'Dining' }, '');
  t('camelCase and the *_tail names reach the contract keys', r.raw.account_masked === '…0000' && r.raw.card_masked === '…1111' && r.raw.balance === 500
    && r.raw.fee_amount === 1100 && r.raw.holder_name === 'NGUYEN VAN A' && r.raw.category_hint === 'Dining', r.raw);
  /* The v1 keys hear only the names they always heard (accountTail, not
     cardTail): widening them would change v1 rows. cardTail reaches the box
     through the v2 carry above, and nowhere else. */
  t('the v1 keys the v1 payload is built from are untouched', r.accountTail === '…0000' && r.cardMasked === null && r.category === 'Dining', [r.accountTail, r.cardMasked, r.category]);
}

console.log('\n-- flowFor --');
for (const [signal, def] of Object.entries(C.SIGNALS)) {
  const transfer = def.proposes === 'xfer' || def.proposes === 'cardpay';
  t(signal + ': ' + (transfer ? 'a transfer either way' : 'direction decides'),
    transfer ? (C.flowFor(signal, 'debit') === 'transfer' && C.flowFor(signal, 'credit') === 'transfer')
      : (C.flowFor(signal, 'debit') === 'expense' && C.flowFor(signal, 'credit') === 'income'));
}
t('no signal: direction decides; no direction: null', C.flowFor(null, 'credit') === 'income' && C.flowFor(null, null) === null && C.flowFor('nonsense', 'debit') === 'expense');

console.log('\n' + (fail === 0 ? 'ALL ' + pass + ' PASSED' : pass + ' passed, ' + fail + ' FAILED'));
process.exit(fail ? 1 : 0);
