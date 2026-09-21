#!/usr/bin/env node
/* A VND mail is not foreign, and a foreign mail does not un-learn its shape.
 * `node pipeline/foreign-currency-false-refusal.test.js`
 *
 * Production, 2026-09-21: the template learner refused one VIB card-notice
 * shape as 'foreign_currency' 50 times, and the same step sat on domestic
 * shapes (a QR bill, train tickets, a card repayment). Three causes can be read
 * out of the code, and each has a synthetic fixture here:
 *
 *   1. SPELLING. _canonCurrency knew every single-token đồng ('₫', 'VNĐ', 'đ')
 *      and no compound one ("VND (₫)", "Việt Nam Đồng"). This is the only cause
 *      that can emit the step 'foreign_currency' on a VND reading: that step
 *      has exactly one exit, the currency test at the top of derivation.
 *   2. THE WIPE. A genuinely foreign mail is refused, correctly, and the save
 *      that follows wrote extraction_regex:null OVER the shape's working VND
 *      template (merge-duplicates replaces the column). So each foreign mail
 *      un-learned the shape and the next domestic mail paid the model again.
 *      This is what makes a TRUE refusal look like a drain on VND mail.
 *   3. THE LINE. _readsForeignCurrency tested the whole LINE the amount sits
 *      on. A line is not always a cell (SMS-style notices, a joined table row,
 *      a bilingual "Amount (VND/USD)" label), so a foreign token beside a VND
 *      figure degraded the mail. NOTE: at derivation this surfaces as step
 *      'proof', not 'foreign_currency', and at apply as a silent
 *      template_missed. Fixed by letting the token NEAREST the figure name it.
 *
 * And the true refusals keep working: USD stays refused, a USD mail still
 * degrades a VND template, a dual cell that leads with the foreign figure too.
 */
const fs = await import('node:fs');
const url = await import('node:url');
const HERE = url.fileURLToPath(new URL('.', import.meta.url));
const T = await import(HERE + '../supabase/functions/_shared/mailbox/templates.mjs');
const X = await import(HERE + '../supabase/functions/_shared/mailbox/extract.mjs');

let pass = 0, fail = 0;
const t = (n, ok, d) => { console.log((ok ? '  PASS  ' : '  FAIL  ') + n + (!ok && d !== undefined ? '  -> ' + JSON.stringify(d) : '')); ok ? pass++ : fail++; };

const READING = { is_transaction: true, transaction_type: 'ecommerce_receipt', source_provider: 'ZQ Bank',
  occurred_at: '2026-09-20T08:15:00+07:00', amount: 150000, currency: 'VND', direction: 'debit',
  counterparty: 'ZQ MART 01', reference_number: null, account_masked: null, memo: null };
const CLEAN = 'Ngay giao dich\n20/09/2026 08:15\nSo tien\n150,000 VND\nTai\nZQ MART 01';
const derive = (body, reading) => { let step = null; const tpl = T.deriveExtractionTemplate(body, { ...reading }, (s) => { step = s; }); return { tpl, step }; };

/* ── 1. spelling ─────────────────────────────────────────────────────────── */
console.log('\n-- 1. the đồng, said twice, is still the đồng --');
for (const cur of ['VND (₫)', '₫ VND', 'VND₫', 'VND đ', 'VNĐ (đồng)', 'Việt Nam Đồng', 'Vietnamese Dong', 'VN Dong', 'đồng Việt Nam', ' vnd. ']) {
  const r = derive(CLEAN, { ...READING, currency: cur });
  t('currency ' + JSON.stringify(cur) + ' derives', !!r.tpl, 'refused at: ' + r.step);
}
for (const cur of ['USD', 'usd', 'EUR', 'VND/USD', 'USD (VND)', '$', 'US$', 'JPY']) {
  const r = derive(CLEAN, { ...READING, currency: cur });
  t('currency ' + JSON.stringify(cur) + ' is still refused as foreign', !r.tpl && r.step === 'foreign_currency', r.step);
}

/* ── 3. the amount's line ────────────────────────────────────────────────── */
console.log('\n-- 3. a foreign token beside a VND figure does not make the figure foreign --');
const LINES = {
  'an SMS-style one-line notice that mentions a USD limit':
    'The ZQ 1234 GD 150,000 VND luc 20/09/2026 08:15 tai ZQ MART 01. Han muc GD quoc te 5,000 USD.',
  'a bilingual label "Amount (VND/USD)"':
    'Ngay giao dich\n20/09/2026 08:15\nSo tien/Amount (VND/USD) 150,000 VND\nTai\nZQ MART 01',
  'a "$" elsewhere on the row':
    'Ngay giao dich\n20/09/2026 08:15\nSo tien 150,000 VND (phi 0$)\nTai\nZQ MART 01',
  'the currency BEFORE the figure: "(VND) 150,000" beside a USD note':
    'Ngay giao dich\n20/09/2026 08:15\nSo tien (VND) 150,000 | quy doi tham khao USD\nTai\nZQ MART 01',
  'the symbol form: "150,000 ₫"':
    'Ngay giao dich\n20/09/2026 08:15\nSo tien 150,000 ₫ (the quoc te USD)\nTai\nZQ MART 01',
};
for (const [name, body] of Object.entries(LINES)) {
  const r = derive(body, READING);
  t(name + ': graduates', !!r.tpl, 'failed at: ' + r.step);
  if (!r.tpl) continue;
  const next = T.applyExtractionTemplate(r.tpl, body.replace('150,000', '92,500'));
  t('  ...and reads the next mail of the shape', !!next && next.amount === 92500 && next.currency === 'VND', next);
}

console.log('\n-- ...and a figure that IS foreign still degrades --');
{
  const tpl = derive('Ngay giao dich\n20/09/2026 08:15\nSo tien giao dich 150,000 VND\nTai\nZQ MART 01', READING).tpl;
  t('(the VND template exists)', !!tpl);
  const usd = 'Ngay giao dich\n21/09/2026 09:00\nSo tien giao dich 111.00 USD\nTai\nZQ SUBSCRIPTION';
  t('"111.00 USD" on the amount line → the template steps aside', T.applyExtractionTemplate(tpl, usd) === null);
  const dual = 'Ngay giao dich\n21/09/2026 09:00\nSo tien giao dich 111.00 USD (2,923,000 VND)\nTai\nZQ SUBSCRIPTION';
  t('a dual cell LEADING with the foreign figure steps aside too', T.applyExtractionTemplate(tpl, dual) === null);
  const dollar = 'Ngay giao dich\n21/09/2026 09:00\nSo tien giao dich $111.00\nTai\nZQ SUBSCRIPTION';
  t('"$111.00" steps aside', T.applyExtractionTemplate(tpl, dollar) === null);
  const row = 'Ngay giao dich\n21/09/2026 09:00\nSo tien giao dich 111.00\nLoai tien: USD\nTai\nZQ SUBSCRIPTION';
  t('an explicit "Loại tiền: USD" row steps aside', T.applyExtractionTemplate(tpl, row) === null);
  const domestic = 'Ngay giao dich\n21/09/2026 09:00\nSo tien giao dich 45,000 VND\nTai\nZQ CAFE';
  const d = T.applyExtractionTemplate(tpl, domestic);
  t('and a domestic mail of the shape is read, as ever', !!d && d.amount === 45000);
}
{
  /* A template learned off a '₫' reading carries '₫' as its static. The degrade
     only ran when the static was the literal 'VND', so such a template stamped
     its đồng onto a USD mail unguarded. */
  const tpl = derive('Ngay giao dich\n20/09/2026 08:15\nSo tien giao dich 150,000\nTai\nZQ MART 01', { ...READING, currency: '₫' }).tpl;
  t('(a "₫"-static template exists)', !!tpl && JSON.parse(tpl).static.currency === '₫');
  t('it steps aside on a USD mail too',
    T.applyExtractionTemplate(tpl, 'Ngay giao dich\n21/09/2026 09:00\nSo tien giao dich 111.00 USD\nTai\nZQ SUBSCRIPTION') === null);
}

/* ── 2. the wipe ─────────────────────────────────────────────────────────── */
console.log('\n-- 2. a refused foreign mail leaves the shape\'s VND template alone --');
{
  const SEP = String.fromCharCode(0);
  const table = new Map();
  const db = {
    fingerprint: async (s, tpl) => table.get(s + SEP + tpl) || null,
    saveFingerprint: async (row) => { table.set(row.sender_address + SEP + row.subject_template, row); },
    failures: [],
    recordDeriveFailure: async function (s, tpl, step) { this.failures.push(step); },
  };
  let modelCalls = 0, answer = null;
  const deps = { llm: { apiKey: 'k' }, fetch: async () => { modelCalls++;
    const body = { candidates: [{ content: { parts: [{ text: JSON.stringify(answer) }] } }] };
    return { ok: true, status: 200, text: async () => JSON.stringify(body) }; } };
  /* Prose-shaped on purpose, so the label-table tier declines and the model is
     the tier that reads it: the path production took. */
  const mail = (amountText, when, where) => ({ from: 'ZQ Bank <card@zqbank.example>', subject: 'Thong bao giao dich the',
    body: 'Quy khach vua giao dich.\nGia tri: ' + amountText + '\nVao luc: ' + when + '\nDia diem: ' + where });
  const vnd = (amount, when, iso, where) => ({ ...READING, amount, occurred_at: iso, counterparty: where });

  answer = vnd(150000, '20/09/2026 08:15', '2026-09-20T08:15:00+07:00', 'ZQ MART 01');
  const r1 = await X.readTransaction(mail('150,000 VND', '20/09/2026 08:15', 'ZQ MART 01'), db, deps);
  const key = 'card@zqbank.example' + SEP + 'Thong bao giao dich the';
  t('the first domestic mail pays the model once and graduates', r1.ok && r1.learned && modelCalls === 1 && typeof table.get(key).extraction_regex === 'string', { modelCalls, learned: r1.learned });

  const r2 = await X.readTransaction(mail('92,500 VND', '21/09/2026 10:00', 'ZQ CAFE'), db, deps);
  t('the second is read by the template, no model', r2.ok && r2.stage === 'template' && modelCalls === 1, { stage: r2.stage, modelCalls });

  answer = { ...READING, amount: 111, currency: 'USD', occurred_at: '2026-09-22T09:00:00+07:00', counterparty: 'ZQ SUBSCRIPTION' };
  const r3 = await X.readTransaction(mail('111.00 USD', '22/09/2026 09:00', 'ZQ SUBSCRIPTION'), db, deps);
  t('a USD mail of the same shape goes to the model and is read as USD', r3.ok && r3.stage === 'llm' && r3.extraction.currency === 'USD' && modelCalls === 2, { stage: r3.stage, modelCalls });
  t('its derivation is refused as foreign: a TRUE refusal, recorded', db.failures.includes('foreign_currency'), db.failures);
  t('and the VND template is STILL THERE', typeof table.get(key).extraction_regex === 'string', table.get(key));

  const r4 = await X.readTransaction(mail('45,000 VND', '23/09/2026 12:30', 'ZQ MART 02'), db, deps);
  t('so the next domestic mail costs nothing  <-- it used to pay the model again',
    r4.ok && r4.stage === 'template' && r4.extraction.amount === 45000 && modelCalls === 2, { stage: r4.stage, modelCalls });
}
{
  /* Narrow on purpose: any OTHER failed derivation still stores null. */
  const SEP = String.fromCharCode(0);
  const table = new Map();
  const db = { fingerprint: async (s, tpl) => table.get(s + SEP + tpl) || null,
    saveFingerprint: async (row) => { table.set(row.sender_address + SEP + row.subject_template, row); } };
  const key = 'card@zqbank.example' + SEP + 'Thong bao khac';
  table.set(key, { sender_address: 'card@zqbank.example', subject_template: 'Thong bao khac', is_transaction_source: true,
    extraction_regex: JSON.stringify({ v: 4, static: {}, fields: { amount: { re: 'KHONG CO DONG NAY ([\\d.,]+)', num: 'us' } } }) });
  const answer = { ...READING, memo: 'a memo the body never printed' };
  await X.readTransaction({ from: 'card@zqbank.example', subject: 'Thong bao khac', body: 'Gia tri: 150,000 VND\nVao luc: 20/09/2026 08:15\nDia diem: ZQ MART 01' }, db,
    { llm: { apiKey: 'k' }, fetch: async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(answer) }] } }] }) }) });
  t('a derivation that failed for another reason still stores null, as before', table.get(key).extraction_regex === null, table.get(key));
}

/* ── the .gs twin ────────────────────────────────────────────────────────── */
console.log('\n-- the Apps Script twin agrees --');
{
  const src = fs.readFileSync(HERE + 'bank-email-pipeline.gs', 'utf8');
  const slice = src.slice(src.indexOf('var EXTRACTION_LOGIC_VERSION'), src.indexOf('function upsertFingerprint'));
  const G = new Function(slice + '\nreturn { deriveExtractionTemplate: deriveExtractionTemplate, applyExtractionTemplate: applyExtractionTemplate, _canonCurrency: _canonCurrency };')();
  let same = true;
  for (const cur of ['VND (₫)', 'Việt Nam Đồng', 'VND/USD', 'USD', '₫', 'VN Dong']) {
    const a = T.deriveExtractionTemplate(CLEAN, { ...READING, currency: cur });
    const b = G.deriveExtractionTemplate(CLEAN, { ...READING, currency: cur });
    if (a !== b) { same = false; t('twin agrees on ' + cur, false, [a, b]); }
  }
  t('both copies derive (or refuse) identically across the spellings', same);
  let sameLines = true;
  for (const body of Object.values(LINES)) {
    if (T.deriveExtractionTemplate(body, { ...READING }) !== G.deriveExtractionTemplate(body, { ...READING })) sameLines = false;
  }
  t('and across the amount-line fixtures', sameLines);
  const mjs = fs.readFileSync(HERE + '../supabase/functions/_shared/mailbox/templates.mjs', 'utf8');
  const fn = (s, name) => { const i = s.indexOf('function ' + name + '('); return s.slice(i, s.indexOf('\n}\n', i)); };
  for (const name of ['_canonCurrency', '_amountIsDong', '_readsForeignCurrency', 'applyExtractionTemplate']) {
    t(name + ' is byte-identical in both files', fn(mjs, name) === fn(src, name) && fn(mjs, name).length > 40);
  }
  t('the .gs no longer writes null over a stored template on a foreign refusal',
    /deriveStep === 'foreign_currency'/.test(src));
}

console.log('\n' + (fail === 0 ? 'ALL ' + pass + ' PASSED' : pass + ' passed, ' + fail + ' FAILED'));
process.exit(fail ? 1 : 0);
