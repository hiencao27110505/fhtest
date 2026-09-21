#!/usr/bin/env node
/* The merchant classifier keeps the consent promise.
 * `node pipeline/classify-consent.test.js`
 *
 * Consent says a new mail FORMAT goes to the AI service once, and later mails of
 * that format are not sent. enrichCategory runs on every mail whose merchant the
 * free tiers cannot place, template-read mails included, and its one model call
 * sent `counterparty + memo`, unmasked. On a transfer that is a person's name and
 * the words they typed (docs/specs/email-reading-v2-spec.md §11).
 *
 * This test CAPTURES what is sent and pins:
 *   • the model sees the merchant NAME only: no memo text, no long digit run
 *   • no call at all for a person-to-person row: the reader's p2p_transfer
 *     verdict, a counterparty read off a beneficiary/remitter row, or a
 *     counterparty that reads as a person's name
 *   • a skipped row spends no budget and caches nothing
 *   • the FREE tiers still read the memo, exactly as before
 *
 * All names synthetic.
 */
const url = await import('node:url');
const HERE = url.fileURLToPath(new URL('.', import.meta.url));
const ROOT = HERE + '../supabase/functions/_shared/mailbox/';
const C = await import(ROOT + 'classify.mjs');
const LT = await import(ROOT + 'labeltable.mjs');

let pass = 0, fail = 0;
const t = (n, ok, d) => { console.log((ok ? '  PASS  ' : '  FAIL  ') + n + (!ok && d !== undefined ? '  -> ' + JSON.stringify(d) : '')); ok ? pass++ : fail++; };
const subtle = globalThis.crypto.subtle;

function harness(answer) {
  const h = { sent: [], puts: [], budget: { left: 5 } };
  h.ctx = {
    subtle, llm: { apiKey: 'k' }, classifyBudget: h.budget,
    db: { merchantCorrectionGet: async () => null, merchantConceptGet: async () => null,
          merchantConceptPut: async (...a) => { h.puts.push(a); } },
    fetch: async (u, init) => {
      const req = JSON.parse(init.body);
      h.sent.push(req.contents.map((c) => c.parts.map((p) => p.text).join('\n')).join('\n'));
      const body = { candidates: [{ content: { parts: [{ text: JSON.stringify(answer || { node: null, concept: 'Others', pool: null }) }] } }] };
      return { ok: true, status: 200, text: async () => JSON.stringify(body) };
    },
  };
  return h;
}
/* No tree keyword and no dictionary word in it, so the free tiers cannot answer
   from it and the row really does reach the model step. */
const MEMO = 'gui lai phan con thieu hom truoc nhe';

console.log('\n-- a merchant: the name goes, the memo does not --');
{
  const h = harness();
  const x = { transaction_type: 'ecommerce_receipt', counterparty: 'ZQ OPAQUE TRADING 0901234567', counterparty_display: null, memo: MEMO, category: null };
  await C.enrichCategory(x, { user_id: 'u1' }, h.ctx);
  t('the model was asked once', h.sent.length === 1, h.sent);
  t('it was shown the merchant name', /ZQ OPAQUE TRADING/.test(h.sent[0] || ''), h.sent);
  t('NO memo text reached it', !/gui lai|con thieu|hom truoc/.test(h.sent[0] || ''), h.sent);
  t('nor the long digit run riding in the counterparty', !/0901234567|\d{6,}/.test(h.sent[0] || ''), h.sent);
  t('exactly "Merchant: <name>"', h.sent[0] === 'Merchant: ZQ OPAQUE TRADING', h.sent[0]);
  t('the answer still lands', x.category === 'Others');
}
{
  const h = harness();
  const x = { transaction_type: 'bank_txn', counterparty: 'MPOS*ZQ OPAQUE VN', counterparty_display: 'ZQ OPAQUE', memo: MEMO, category: null };
  await C.enrichCategory(x, { user_id: 'u1' }, h.ctx);
  t('the tidied display name is the one sent', h.sent[0] === 'Merchant: ZQ OPAQUE', h.sent);
}
{
  const h = harness();
  const x = { transaction_type: 'bank_txn', counterparty: null, memo: 'ZQ OPAQUE chuyen khoan le phi', category: null };
  await C.enrichCategory(x, { user_id: 'u1' }, h.ctx);
  t('a memo-only row has no merchant to name: no call', h.sent.length === 0, h.sent);
  t('...and spends no budget', h.budget.left === 5, h.budget.left);
}

console.log('\n-- a person: no call at all --');
const P2P = [
  ['the reader said p2p_transfer', { transaction_type: 'p2p_transfer', counterparty: 'ZQ OPAQUE TRADING', memo: MEMO }],
  ['a template-read row carrying the shape\'s frozen p2p verdict', { transaction_type: 'p2p_transfer', counterparty: 'LE VAN C', memo: 'LE VAN C chuyen tien' }],
  ['the label table read the name off a BENEFICIARY row', { transaction_type: 'bank_txn', counterparty_row: 'beneficiary', counterparty: 'ZQ OPAQUE', memo: MEMO }],
  ['...or off a REMITTER row', { transaction_type: 'bank_txn', counterparty_row: 'remitter', counterparty: 'ZQ OPAQUE', memo: MEMO }],
  ['the counterparty reads as a person, whatever the reader called it', { transaction_type: 'bank_txn', counterparty: 'NGUYEN VAN A', memo: MEMO }],
  ['...with an account tail, as banks print it', { transaction_type: 'ecommerce_receipt', counterparty: 'TRAN THI B - 0000 1234 5678', memo: MEMO }],
  ['...in Title Case with diacritics', { transaction_type: 'bank_txn', counterparty: 'Phạm Thị Dung', memo: null }],
];
for (const [name, x0] of P2P) {
  const h = harness();
  const x = { category: null, ...x0 };
  await C.enrichCategory(x, { user_id: 'u1' }, h.ctx);
  t(name + ': model NOT called', h.sent.length === 0, h.sent);
  t('  ...no budget spent, nothing cached', h.budget.left === 5 && h.puts.length === 0, { left: h.budget.left, puts: h.puts.length });
}

console.log('\n-- the real table reader feeds the guard --');
{
  const r = LT.readLabelTable('Bien lai chuyen tien',
    '| Ngày, giờ giao dịch | 20-09-2026 08:15:00 |\n| Số tiền | 90,000 VND |\n| Tên người hưởng | LE VAN C |\n| Nội dung | ' + MEMO + ' |');
  t('a transfer reading says which row named the counterparty', r && r.counterparty_row === 'beneficiary' && r.transaction_type === 'p2p_transfer', r);
  const h = harness();
  await C.enrichCategory(r, { user_id: 'u1' }, h.ctx);
  t('and it never reaches the model', h.sent.length === 0, h.sent);
  const m = LT.readLabelTable('Thong bao giao dich the',
    '| Ngày, giờ giao dịch | 20-09-2026 08:15:00 |\n| Số tiền | -90,000 VND |\n| Điểm giao dịch | ZQ OPAQUE TRADING |');
  t('a card purchase names a MERCHANT row', m && m.counterparty_row === 'merchant');
  const h2 = harness();
  await C.enrichCategory(m, { user_id: 'u1' }, h2.ctx);
  t('and that one may be asked about, by name', h2.sent.length === 1 && h2.sent[0] === 'Merchant: ZQ OPAQUE TRADING', h2.sent);
}

console.log('\n-- looksLikePerson: errs toward person, keeps the shops --');
for (const p of ['NGUYEN VAN A', 'TRAN THI B - 0000 1234', 'Lê Văn C', 'PHAM THI DUNG 0000123456', 'HOANG MINH']) t(JSON.stringify(p) + ' is a person', LT.looksLikePerson(p) === true);
for (const m of ['ZQ MART 01', 'AEON NGUYEN VAN LINH', 'LE VAN SY COFFEE', 'CONG TY TNHH ZQ', 'HIGHLANDS COFFEE', 'GS25', 'NGUYEN', '', null, 'NHA HANG HOANG YEN'])
  t(JSON.stringify(m) + ' is not', LT.looksLikePerson(m) === false);

console.log('\n-- the free tiers are untouched: they still read the memo --');
{
  const h = harness();
  const x = { transaction_type: 'p2p_transfer', counterparty: 'NGUYEN VAN A', memo: 'tra tien highlands coffee', category: null };
  await C.enrichCategory(x, { user_id: 'u1' }, h.ctx);
  t('a keyword in the MEMO still places a transfer, locally', x.category === 'Dining' && h.sent.length === 0, { category: x.category, sent: h.sent });
}
{
  let asked = null;
  const h = harness();
  h.ctx.db.merchantConceptGet = async (hash) => { asked = hash; return { concept: 'Shopping', pool: null }; };
  const x = { transaction_type: 'p2p_transfer', counterparty: 'NGUYEN VAN A', memo: 'zq opaque', category: null };
  await C.enrichCategory(x, { user_id: 'u1' }, h.ctx);
  t('the cache tier still runs for a p2p row, on the key it always used',
    x.category === 'Shopping' && asked === await C.hashKey(C.merchantKey('NGUYEN VAN A', 'zq opaque'), subtle) && h.sent.length === 0);
}

console.log('\n-- the batch path already kept the promise: names only --');
{
  const sent = [];
  await C.classifyMerchantsBatch(['ZQ OPAQUE TRADING'], { apiKey: 'k' }, async (u, init) => {
    sent.push(JSON.parse(init.body).contents[0].parts[0].text);
    return { ok: true, status: 200, text: async () => JSON.stringify({ candidates: [{ content: { parts: [{ text: '{"items":[]}' }] } }] }) };
  });
  t('one numbered line per name and nothing else', sent[0] === '1. ZQ OPAQUE TRADING', sent);
}

console.log('\n' + (fail === 0 ? 'ALL ' + pass + ' PASSED' : pass + ' passed, ' + fail + ' FAILED'));
process.exit(fail ? 1 : 0);
