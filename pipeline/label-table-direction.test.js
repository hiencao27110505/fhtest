#!/usr/bin/env node
/* The label-table tier reads money COMING IN, and says null when it cannot tell.
 * `node pipeline/label-table-direction.test.js`
 *
 * Until 2026-09-22 direction was `negative ? 'debit' : (refund ? 'credit' :
 * 'debit')`: every mail without a minus sign or refund wording was a debit by
 * default. An incoming transfer (remitter row, memo, unsigned or "+" amount)
 * read as money leaving, and the template learner then froze that wrong
 * direction into the shape and served it to every later mail for free
 * (docs/specs/email-reading-v2-spec.md §2, §15 fix 1).
 *
 * Every fixture here is SYNTHETIC: invented names, invented digits.
 *
 * Properties pinned:
 *   • parseAmountCell reports the sign as three values: '-', '+', or null
 *   • a printed "+" is a credit; credit wording is a credit, in the subject,
 *     the txn-kind row, the status, or the amount row's own label
 *   • a remitter row with no beneficiary row is money coming in
 *   • a merchant row, a beneficiary row or a debit-account label is a debit
 *   • what the mail STATES outranks what its layout IMPLIES (a refund names its
 *     merchant; an incoming notice names its beneficiary)
 *   • stated evidence that disagrees with itself is null, and so is no evidence
 *   • a null direction still returns the reading (the card upgrade reads it),
 *     and extract.mjs sends such a mail on to the next tier
 */
const url = await import('node:url');
const HERE = url.fileURLToPath(new URL('.', import.meta.url));
const M = await import(HERE + '../supabase/functions/_shared/mailbox/labeltable.mjs');
const X = await import(HERE + '../supabase/functions/_shared/mailbox/extract.mjs');
const { readLabelTable, parseAmountCell } = M;

let pass = 0, fail = 0;
const t = (n, ok, d) => { console.log((ok ? '  PASS  ' : '  FAIL  ') + n + (!ok && d !== undefined ? '  -> ' + JSON.stringify(d) : '')); ok ? pass++ : fail++; };

console.log('\n-- parseAmountCell: the sign is three-valued --');
t('"-37,000 VND" → sign "-", negative true', (function () { const r = parseAmountCell('-37,000 VND'); return r && r.sign === '-' && r.negative === true; })());
t('"+5,000,000 VND" → sign "+", negative false', (function () { const r = parseAmountCell('+5,000,000 VND'); return r && r.sign === '+' && r.negative === false && r.value === 5000000; })());
t('"5,000,000 VND" → sign null: printed neither', (function () { const r = parseAmountCell('5,000,000 VND'); return r && r.sign === null && r.negative === false; })());
t('"(VND) +2,000.00" keeps the plus past the currency token', (parseAmountCell('(VND) +2,000.00') || {}).sign === '+');
t('"+ 250,000" tolerates a space after the sign', (parseAmountCell('+ 250,000') || {}).sign === '+');
t('the U+2212 minus HTML mail prints is a minus', (parseAmountCell('−37,000 VND') || {}).sign === '-');
t('"+12.99 USD" keeps sign and cents', (function () { const r = parseAmountCell('+12.99 USD'); return r && r.sign === '+' && r.value === 12.99; })());

/* ── money coming in ─────────────────────────────────────────────────────── */
const INCOMING = `| Ngày, giờ giao dịch | 20-09-2026 08:15:00 |
| Tên người chuyển | NGUYEN VAN A |
| Số tiền | 5,000,000 VND |
| Nội dung | NGUYEN VAN A chuyen tien an trua |
| Số dư | 12,000,000 VND |`;

console.log('\n-- an incoming transfer is a credit, not a default debit --');
const inc = readLabelTable('Thông báo giao dịch', INCOMING);
t('parses', !!inc);
t('remitter row + no beneficiary row → credit', inc && inc.direction === 'credit', inc && inc.direction);
t('the counterpart of money coming in is the remitter', inc && inc.counterparty === 'NGUYEN VAN A', inc && inc.counterparty);
t('still typed as a transfer between people', inc && inc.transaction_type === 'p2p_transfer');

const plus = readLabelTable('Thông báo giao dịch', INCOMING.replace('5,000,000 VND', '+5,000,000 VND'));
t('a printed "+" → credit', plus && plus.direction === 'credit', plus && plus.direction);
t('and the amount is unchanged by its sign', plus && plus.amount === 5000000);

console.log('\n-- credit wording, wherever the mail puts it --');
const BARE = (extra) => `| Ngày, giờ giao dịch | 20-09-2026 08:15:00 |
| Số tiền | 750,000 VND |
| Nội dung | TRAN THI B tra tien sach |${extra || ''}`;
t('in the subject: "ghi có"', (readLabelTable('Thông báo ghi có tài khoản', BARE()) || {}).direction === 'credit');
t('in the subject: "nhận tiền"', (readLabelTable('Bạn vừa nhận tiền', BARE()) || {}).direction === 'credit');
t('in the txn-kind row: "Tiền vào"', (readLabelTable('Thông báo giao dịch', BARE('\n| Loại giao dịch | Tiền vào |')) || {}).direction === 'credit');
t('in the status: "credited"', (readLabelTable('Transaction alert', BARE('\n| Status | Your account has been credited |')) || {}).direction === 'credit');
t('in the amount row\'s OWN label: "Số tiền nhận"',
  (readLabelTable('Thông báo giao dịch', BARE().replace('| Số tiền |', '| Số tiền nhận |')) || {}).direction === 'credit');

console.log('\n-- debit evidence still reads debit --');
t('debit wording in the subject: "ghi nợ"', (readLabelTable('Thông báo ghi nợ tài khoản', BARE()) || {}).direction === 'debit');
t('debit wording in the amount label: "Số tiền chuyển"',
  (readLabelTable('Thông báo giao dịch', BARE().replace('| Số tiền |', '| Số tiền chuyển |')) || {}).direction === 'debit');
t('a merchant row (card purchase) → debit',
  (readLabelTable('Thông báo giao dịch thẻ', '| Ngày, giờ giao dịch | 20-09-2026 08:15:00 |\n| Số tiền | 90,000 VND |\n| Điểm giao dịch | ZQ MART 01 |') || {}).direction === 'debit');
t('a beneficiary row (outgoing receipt) → debit',
  (readLabelTable('Biên lai', '| Ngày, giờ giao dịch | 20-09-2026 08:15:00 |\n| Số tiền | 90,000 VND |\n| Tên người hưởng | LE VAN C |\n| Nội dung | tien nha |') || {}).direction === 'debit');
t('remitter AND beneficiary (a sent-transfer receipt names both) → debit',
  (readLabelTable('Biên lai', '| Ngày, giờ giao dịch | 20-09-2026 08:15:00 |\n| Số tiền | 90,000 VND |\n| Tên người chuyển | NGUYEN VAN A |\n| Tên người hưởng | LE VAN C |\n| Nội dung | tien nha |') || {}).direction === 'debit');
t('a debit-account style label → debit',
  (readLabelTable('Thông báo giao dịch', BARE('\n| Tài khoản trích nợ | 0000 1234 |')) || {}).direction === 'debit');
t('a plain "Số tài khoản" label is NOT debit evidence',
  (readLabelTable('Thông báo giao dịch', BARE('\n| Số tài khoản | 0000 1234 |')) || { direction: 'x' }).direction === null);

console.log('\n-- stated outranks implied --');
const refund = readLabelTable('Hoàn tiền giao dịch thẻ',
  '| Số tiền | 50,000 VND |\n| Ngày, giờ giao dịch | 2026-08-25 10:00:00 |\n| Điểm giao dịch | ZQ MART 01 |');
t('a refund names its merchant and is still a credit', refund && refund.direction === 'credit', refund && refund.direction);
t('and its counterparty is the merchant', refund && refund.counterparty === 'ZQ MART 01');
const incBoth = readLabelTable('Thông báo giao dịch',
  '| Ngày, giờ giao dịch | 20-09-2026 08:15:00 |\n| Số tiền | +90,000 VND |\n| Tên người chuyển | NGUYEN VAN A |\n| Tên người hưởng | LE VAN C |\n| Nội dung | tra tien |');
t('"+" beside a beneficiary row (the reader themself) → credit', incBoth && incBoth.direction === 'credit');
t('and the counterparty is the remitter, not the reader', incBoth && incBoth.counterparty === 'NGUYEN VAN A', incBoth && incBoth.counterparty);

console.log('\n-- conflicting or missing evidence is null, never a guess --');
const none = readLabelTable('Thông báo giao dịch', BARE());
t('no sign, no wording, no telling row → the reading comes back', !!none);
t('...with direction null', none && none.direction === null, none && none.direction);
t('a minus under refund wording → null',
  (readLabelTable('Hoàn tiền giao dịch', BARE().replace('750,000', '-750,000')) || { direction: 'x' }).direction === null);
t('a plus under debit wording → null',
  (readLabelTable('Thông báo ghi nợ', BARE().replace('750,000', '+750,000')) || { direction: 'x' }).direction === null);
t('a title naming BOTH directions is no wording: the sign decides',
  (readLabelTable('Thông báo ghi nợ/ghi có', BARE().replace('750,000', '-750,000')) || {}).direction === 'debit');
t('...and with no sign either, null',
  (readLabelTable('Thông báo ghi nợ/ghi có', BARE()) || { direction: 'x' }).direction === null);

/* ── extract.mjs: a null direction falls through, and nothing is learned ──── */
console.log('\n-- a null direction goes to the next tier --');
function fakeDb() {
  const saved = [], tally = [];
  return { saved, tally,
    async fingerprint() { return null; },
    async saveFingerprint(row) { saved.push(row); },
    async bumpReadTally(stage) { tally.push(stage); } };
}
const msg = (subject, body) => ({ from: 'Bank <alerts@bank.example>', subject, body });
{
  const db = fakeDb();
  let modelAsked = 0;
  const llm = { apiKey: 'k' };
  const fetch = async () => { modelAsked++; const body = { candidates: [{ content: { parts: [{ text: JSON.stringify({ is_transaction: false }) }] } }] };
    return { ok: true, status: 200, text: async () => JSON.stringify(body) }; };
  const r = await X.readTransaction(msg('Thông báo giao dịch', BARE()), db, { llm, fetch });
  t('the table tier did not answer', !db.tally.includes('table'), db.tally);
  t('the mail went on to the model', modelAsked === 1, modelAsked);
  t('and no transaction shape was frozen off a guess', !db.saved.some((x) => x.is_transaction_source === true), db.saved);
  void r;
}
{
  const db = fakeDb();
  let modelAsked = 0;
  const r = await X.readTransaction(msg('Thông báo giao dịch', INCOMING), db,
    { llm: { apiKey: 'k' }, fetch: async () => { modelAsked++; throw new Error('must not be called'); } });
  t('an evidenced credit is read by the table tier, no model', r.ok && r.stage === 'table' && modelAsked === 0, { stage: r.stage, modelAsked });
  t('and reaches the caller as a credit', r.ok && r.extraction.direction === 'credit');
  const learnt = db.saved.find((x) => x.is_transaction_source === true);
  t('a template learned from it freezes CREDIT, not the old default',
    !learnt || !learnt.extraction_regex || JSON.parse(learnt.extraction_regex).static.direction === 'credit',
    learnt && learnt.extraction_regex);
}

console.log('\n' + (fail === 0 ? 'ALL ' + pass + ' PASSED' : pass + ' passed, ' + fail + ' FAILED'));
process.exit(fail ? 1 : 0);
