#!/usr/bin/env node
/* A v1 mailbox seals exactly what it sealed before payload v2 existed.
 * `node pipeline/stage-v1-snapshot.test.js`
 *
 * buildStagedRow now takes `readerV` (email-reading-v2 R15: a per-mailbox reader
 * version, default 1). At 1 the payload must be BYTE-FOR-BYTE what it was, key
 * order included: the device's opener, the dedup engine and every sealed row in
 * production read that shape, and five other users stay on it while the two
 * founders' mailboxes go to 2.
 *
 * EXPECTED below was captured from stage.mjs AS IT STOOD before the refactor
 * (commit acbf6a4), by running these same three readings through it and opening
 * the box. It is a recording, not a description: do not "fix" it to match new
 * behaviour. A v1 change is a change to every user at once.
 *
 * Fixtures are synthetic.
 *
 * Properties pinned:
 *   • readerV absent, 1, or anything that is not 2 → the recorded payload
 *   • a finer sender kind (gateway, broker, lender) seals as 'wallet' at v1 and
 *     keeps the non-bank transaction_type at both versions
 *   • at 2 the v1 keys are all still there, unchanged, with v, src and the
 *     carried fields ADDED; nothing new is a top-level key or a row column
 *   • flow at v2 is flowFor(signal, direction); direction still wins
 *   • a src entry survives when its field is null (a withdrawn signal), and a
 *     dotted block entry survives when the block lists that inner key
 *   • a rejected counterparty does not come back through counterparty_raw
 */
const nacl = await import('tweetnacl').then(m => m.default || m);
const crypto = await import('node:crypto').then(m => m.default || m);
const url = await import('node:url');
const HERE = url.fileURLToPath(new URL('.', import.meta.url));
const ROOT = HERE + '../supabase/functions/_shared/mailbox/';
const S  = await import(ROOT + 'stage.mjs');
const SB = await import(ROOT + 'sealed-box.mjs');

globalThis.atob = globalThis.atob || ((b64) => Buffer.from(b64, 'base64').toString('binary'));
globalThis.btoa = globalThis.btoa || ((s) => Buffer.from(s, 'binary').toString('base64'));

let pass = 0, fail = 0;
const t = (n, ok, d) => { console.log((ok ? '  PASS  ' : '  FAIL  ') + n + (!ok && d !== undefined ? '  -> ' + JSON.stringify(d) : '')); ok ? pass++ : fail++; };

const FAM_SEC = new Uint8Array(32).fill(7);
const FAM_PUB = Buffer.from(nacl.box.keyPair.fromSecretKey(FAM_SEC).publicKey).toString('base64');
const DEST = { memberId: 'm1', familyId: 'f1', stagingPub: FAM_PUB };
const deps = { nacl, dedupKey: Buffer.alloc(32, 9).toString('base64'), subtle: crypto.webcrypto.subtle };
const open = (row) => SB.openSealedRow({ ...row, family_id: 'f1' }, FAM_SEC, { nacl });
const build = (i, c, extra) => S.buildStagedRow({ gmailMessageId: 'snap-' + i, destination: DEST, deps,
  sourceProvider: 'ZQ Bank', senderKind: c.senderKind, reading: c.reading, ...(extra || {}) });

const READINGS = [
 {
  "senderKind": "bank",
  "reading": {
   "amount": 90000,
   "direction": "debit",
   "currency": "VND",
   "fxAmount": null,
   "fxCurrency": null,
   "merchant": "ZQ MART 01",
   "merchantRaw": "MPOS*ZQ MART 01 HO CHI MINH VN",
   "reference": "FT0000000001",
   "occurredAt": "2026-09-20T01:15:00.000Z",
   "balance": 1200000,
   "description": "NGUYEN VAN A chuyen tien",
   "descriptionDisplay": "",
   "typeCode": "POS",
   "channel": null,
   "accountTail": "…0000",
   "accountKind": "deposit",
   "cardMasked": null,
   "category": "Groceries",
   "node": "supermarket",
   "flow": null,
   "status": "Thành công",
   "readerType": "ecommerce_receipt",
   "senderAuth": {
    "result": "pass",
    "pass": true
   }
  }
 },
 {
  "senderKind": "wallet",
  "reading": {
   "amount": 12.99,
   "direction": "credit",
   "currency": "USD",
   "fxAmount": 12.99,
   "fxCurrency": "USD",
   "merchant": null,
   "merchantRaw": null,
   "reference": null,
   "occurredAt": "2026-09-21T10:00:00+07:00",
   "balance": null,
   "description": null,
   "descriptionDisplay": null,
   "typeCode": null,
   "channel": "QR",
   "accountTail": null,
   "accountKind": null,
   "cardMasked": "…1111",
   "category": null,
   "node": null,
   "flow": "transfer",
   "status": null,
   "readerType": "made_up",
   "senderAuth": null
  }
 },
 {
  "senderKind": "receipt",
  "reading": {
   "amount": 55000,
   "direction": "debit",
   "merchant": "ZQ FOOD",
   "merchantRaw": "ZQ FOOD",
   "occurred_at": "2026-09-22T12:00:00+07:00",
   "flow": "income"
  }
 }
];

/* Recorded from the pre-refactor stage.mjs. See the header. */
const EXPECTED = [
 {
  "amount": 90000,
  "currency": "VND",
  "direction": "debit",
  "counterparty": "ZQ MART 01",
  "reference_number": "FT0000000001",
  "transaction_type": "bank_txn",
  "raw_extracted": {
   "amount": 90000,
   "currency": "VND",
   "fx_amount": null,
   "fx_currency": null,
   "direction": "debit",
   "balance": 1200000,
   "counterparty": "ZQ MART 01",
   "counterparty_raw": "MPOS*ZQ MART 01 HO CHI MINH VN",
   "memo": "NGUYEN VAN A chuyen tien",
   "memo_display": "",
   "type_code": "POS",
   "channel": null,
   "account_masked": "…0000",
   "account_kind": "deposit",
   "card_masked": null,
   "reference_number": "FT0000000001",
   "transaction_type": "bank_txn",
   "reader_type": "ecommerce_receipt",
   "sender_kind": "bank",
   "occurred_at": "2026-09-20T01:15:00.000Z",
   "category_hint": "Groceries",
   "node": "supermarket",
   "txn_source": null,
   "status": "Thành công",
   "flow": "expense",
   "_transport": "oauth_direct",
   "_sender_auth": {
    "result": "pass",
    "pass": true
   }
  },
  "family_id": "f1",
  "gmail_message_id": "snap-0",
  "enc_v": 1
 },
 {
  "amount": 12.99,
  "currency": "USD",
  "direction": "credit",
  "counterparty": null,
  "reference_number": null,
  "transaction_type": "ecommerce_receipt",
  "raw_extracted": {
   "amount": 12.99,
   "currency": "USD",
   "fx_amount": 12.99,
   "fx_currency": "USD",
   "direction": "credit",
   "balance": null,
   "counterparty": null,
   "counterparty_raw": null,
   "memo": null,
   "memo_display": null,
   "type_code": null,
   "channel": "QR",
   "account_masked": null,
   "account_kind": null,
   "card_masked": "…1111",
   "reference_number": null,
   "transaction_type": "ecommerce_receipt",
   "reader_type": null,
   "sender_kind": "wallet",
   "occurred_at": "2026-09-21T10:00:00+07:00",
   "category_hint": null,
   "node": null,
   "txn_source": null,
   "status": null,
   "flow": "transfer",
   "_transport": "oauth_direct",
   "_sender_auth": null
  },
  "family_id": "f1",
  "gmail_message_id": "snap-1",
  "enc_v": 1
 },
 {
  "amount": 55000,
  "currency": "VND",
  "direction": "debit",
  "counterparty": "ZQ FOOD",
  "reference_number": null,
  "transaction_type": "ecommerce_receipt",
  "raw_extracted": {
   "amount": 55000,
   "currency": "VND",
   "fx_amount": null,
   "fx_currency": null,
   "direction": "debit",
   "balance": null,
   "counterparty": "ZQ FOOD",
   "counterparty_raw": null,
   "memo": null,
   "memo_display": null,
   "type_code": null,
   "channel": null,
   "account_masked": null,
   "account_kind": null,
   "card_masked": null,
   "reference_number": null,
   "transaction_type": "ecommerce_receipt",
   "reader_type": null,
   "sender_kind": "receipt",
   "occurred_at": "2026-09-22T12:00:00+07:00",
   "category_hint": null,
   "node": null,
   "txn_source": "receipt",
   "status": null,
   "flow": "expense",
   "_transport": "oauth_direct",
   "_sender_auth": null
  },
  "family_id": "f1",
  "gmail_message_id": "snap-2",
  "enc_v": 1
 }
];

console.log('\n-- readerV 1: the recording --');
for (const [i, c] of READINGS.entries()) {
  t('reading ' + i + ': no readerV → byte-identical', JSON.stringify(open(await build(i, c))) === JSON.stringify(EXPECTED[i]), open(await build(i, c)));
  t('reading ' + i + ': readerV 1 → byte-identical', JSON.stringify(open(await build(i, c, { readerV: 1 }))) === JSON.stringify(EXPECTED[i]));
}
for (const odd of [0, 3, '2x', null, undefined, NaN, true]) {
  t('readerV ' + String(odd) + ' is read as 1', JSON.stringify(open(await build(0, READINGS[0], { readerV: odd }))) === JSON.stringify(EXPECTED[0]));
}
t('a v2 reading carried by the mapper changes NOTHING at v1',
  JSON.stringify(open(await build(0, { ...READINGS[0], reading: { ...READINGS[0].reading, raw: S.carryRaw({ signal: 'purchase', fee_amount: 1100, holder_name: 'NGUYEN VAN A', src: { amount: 'printed' } }) } }))) === JSON.stringify(EXPECTED[0]));
t('buildPayload is what buildStagedRow seals', JSON.stringify(S.buildPayload({ reading: READINGS[0].reading, senderKind: 'bank' })) === JSON.stringify((({ family_id, gmail_message_id, enc_v, ...p }) => p)(EXPECTED[0])));

console.log('\n-- the finer sender kinds --');
for (const k of ['gateway', 'broker', 'lender']) {
  const v1 = open(await build(1, { ...READINGS[1], senderKind: k }));
  t(k + ' at v1 seals exactly what "wallet" sealed', JSON.stringify(v1) === JSON.stringify(EXPECTED[1]), v1.raw_extracted.sender_kind);
  const v2 = open(await build(1, { ...READINGS[1], senderKind: k }, { readerV: 2 }));
  t(k + ' at v2 seals its own kind, and is still not a bank to the dedup engine', v2.raw_extracted.sender_kind === k && v2.transaction_type === 'ecommerce_receipt' && v2.raw_extracted.transaction_type === 'ecommerce_receipt', v2.raw_extracted.sender_kind);
}
t('transactionTypeFor: only a bank is bank_txn', S.transactionTypeFor('bank') === 'bank_txn'
  && ['wallet', 'gateway', 'broker', 'lender', 'biller', 'receipt', undefined, 'nonsense'].every((k) => S.transactionTypeFor(k) === 'ecommerce_receipt'));

console.log('\n-- readerV 2: added, never instead --');
{
  const raw = S.carryRaw({ signal: 'card_repayment', node: 'cardpay', fee_amount: 1100, holder_name: 'NGUYEN VAN A', time_precision: 'minute',
    counterparty_kind: 'bank', counterparty_bank: 'Ngân hàng TMCP ZQ', counterparty_account_tail: '…0002', mail_kind: 'transaction',
    investment: { symbol: 'ZQQ', quantity: 100, junk: 'x' }, src: { amount: 'printed', signal: 'template', investment: 'model', 'investment.symbol': 'printed' } });
  const o = open(await build(0, { ...READINGS[0], reading: { ...READINGS[0].reading, raw } }, { readerV: 2 }));
  const v1 = EXPECTED[0];
  t('every v1 key is still there with its v1 value', Object.keys(v1.raw_extracted).every((k) => k === 'flow' || k === 'sender_kind' || JSON.stringify(o.raw_extracted[k]) === JSON.stringify(v1.raw_extracted[k])),
    Object.keys(v1.raw_extracted).filter((k) => JSON.stringify(o.raw_extracted[k]) !== JSON.stringify(v1.raw_extracted[k])));
  t('the six top-level payload keys are the same six', Object.keys(o).join() === Object.keys(v1).join(), Object.keys(o));
  t('v: 2', o.raw_extracted.v === 2);
  t('the carried v2 fields are sealed', o.raw_extracted.fee_amount === 1100 && o.raw_extracted.holder_name === 'NGUYEN VAN A' && o.raw_extracted.time_precision === 'minute'
    && o.raw_extracted.counterparty_kind === 'bank' && o.raw_extracted.counterparty_bank === 'Ngân hàng TMCP ZQ' && o.raw_extracted.counterparty_account_tail === '…0002', o.raw_extracted);
  t('a transfer-type signal makes flow "transfer"', o.raw_extracted.signal === 'card_repayment' && o.raw_extracted.flow === 'transfer', o.raw_extracted.flow);
  t('a block keeps only the keys the contract lists', JSON.stringify(o.raw_extracted.investment) === JSON.stringify({ symbol: 'ZQQ', side: null, quantity: 100, unit_price: null, order_id: null }), o.raw_extracted.investment);
  t('src: one entry per block, a dotted entry for an inner field', o.raw_extracted.src.investment === 'model' && o.raw_extracted.src['investment.symbol'] === 'printed', o.raw_extracted.src);
  const row = await build(0, { ...READINGS[0], reading: { ...READINGS[0].reading, raw } }, { readerV: 2 });
  for (const col of S.MUST_BE_NULL_WHEN_SEALED) t(col + ' is still absent from the sealed row (0068)', row[col] === undefined || row[col] === null);
  t('no new row column', Object.keys(row).join() === Object.keys(await build(0, READINGS[0])).join(), Object.keys(row));
}
{
  const o = S.buildPayload({ readerV: 2, senderKind: 'bank', reading: { amount: 1, direction: 'credit', raw: S.carryRaw({ signal: 'salary' }) } }).raw_extracted;
  t('an income signal on a credit → income', o.flow === 'income');
  const x = S.buildPayload({ readerV: 2, senderKind: 'bank', reading: { amount: 1, direction: 'debit', flow: 'income', raw: S.carryRaw({ signal: 'purchase' }) } }).raw_extracted;
  t('direction still wins over any judgement: debit + "income" → expense', x.flow === 'expense', x.flow);
  const n = S.buildPayload({ readerV: 2, senderKind: 'bank', reading: { amount: 1, direction: 'debit', flow: 'transfer', raw: S.carryRaw({}) } }).raw_extracted;
  t('no signal: the v1 reconciliation stands (a caller\'s "transfer" is heard)', n.flow === 'transfer' && n.signal === null, n.flow);
}
{
  const w = S.buildPayload({ readerV: 2, senderKind: 'bank', reading: { amount: 1, direction: 'debit', raw: S.carryRaw({ signal: null, src: { signal: 'model', amount: 'model' } }) } }).raw_extracted;
  t('a WITHDRAWN signal: signal null, src.signal still "model"', w.signal === null && w.src && w.src.signal === 'model', w.src);
  const bad = S.carryRaw({ src: { amount: 'guessed', nonsense_key: 'printed', 'investment.address': 'printed', 'loan.due_date': 'template', category: 'model', transaction_type: 'heuristic' } }).src;
  t('src keeps only known keys and known sources; extraction names are renamed to sealed ones',
    JSON.stringify(bad) === JSON.stringify({ 'loan.due_date': 'template', category_hint: 'model', reader_type: 'heuristic' }), bad);
  const r = S.buildPayload({ readerV: 2, senderKind: 'bank', reading: { amount: 1, direction: 'debit', merchant: null, raw: S.carryRaw({ counterparty_raw: 'Kính gửi NGUYEN VAN A' }) } }).raw_extracted;
  t('a counterparty the tidy layer rejected does not come back as counterparty_raw', r.counterparty === null && r.counterparty_raw === null, r.counterparty_raw);
}

console.log('\n' + (fail === 0 ? 'ALL ' + pass + ' PASSED' : pass + ' passed, ' + fail + ' FAILED'));
process.exit(fail ? 1 : 0);
