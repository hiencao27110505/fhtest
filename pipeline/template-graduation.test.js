#!/usr/bin/env node
/* Every real mail shape we hold must GRADUATE: one model call per shape, ever.
 * `node pipeline/template-graduation.test.js`
 *
 * THE BUG THIS PINS. 16 of 18 transaction shapes in production had
 * `extraction_regex` null — derivation failed silently on every mail, so those
 * shapes paid a model call per MAIL forever. That is the mechanism behind a
 * 20.5-hour backfill and 731k held reads. Bisected against real bodies, two
 * causes, both fixed 2026-09-02:
 *
 *   • masking ran BEFORE learning — the learner needs each value verbatim in
 *     the body, and "…9979" never is (three of five shapes died here);
 *   • time written BEFORE the date ("10:17 30/08/2026") — the scanner only
 *     knew time-after, so every candidate resolved to midnight (two shapes).
 *
 * Plus the anchor-hygiene class found by the template_missed tally: a live
 * template with "+" baked into its amount anchor matched refunds only — 409
 * misses a day. Anchors now generalise digits, tolerate signs, refuse name
 * prefixes for accounts, and a template carrying a 6+ digit run is refused
 * outright: the plaintext shared cache never holds an account number by RULE,
 * not by the luck of one hand-run audit.
 *
 * Fixtures: the four REAL bodies from label-table.test.js (re-sliced at test
 * time, so they cannot drift apart) and one REAL VIB mail (info@card.vib.com.vn,
 * 30-08-2026, digits as sent). No invented mail — an invented fixture passed
 * for two days this week while production failed.
 */
const fs = await import('node:fs');
const url = await import('node:url');
const HERE = url.fileURLToPath(new URL('.', import.meta.url));

const T  = await import('../supabase/functions/_shared/mailbox/templates.mjs');
const LT = await import('../supabase/functions/_shared/mailbox/labeltable.mjs');
const R  = await import('../supabase/functions/_shared/mailbox/extract.mjs');

let pass = 0, fail = 0;
const t = (n, ok, d) => { console.log((ok ? '  PASS  ' : '  FAIL  ') + n + (!ok && d ? '  -> ' + d : '')); ok ? pass++ : fail++; };

const lab = fs.readFileSync(HERE + 'label-table.test.js', 'utf8');
const grab = (n) => { const i = lab.indexOf('const ' + n + ' = `'); const s = lab.indexOf('`', i) + 1;
                     return lab.slice(s, lab.indexOf('`', s)); };

/* ── 1. the four label-table shapes graduate from their OWN readings ─────── */
console.log('\n-- the four real bank shapes graduate --');
const steps = {};
for (const name of ['MB_TAP', 'MB_SELF', 'VCB_CARD', 'VCB_RECEIPT']) {
  const body = grab(name);
  const reading = LT.readLabelTable('Thong bao giao dich', body);
  const tpl = T.deriveExtractionTemplate(body, reading, (s) => { steps[name] = s; });
  t(name + ' graduates', !!tpl, name + ' failed at: ' + steps[name]);
  if (tpl) {
    const back = T.applyExtractionTemplate(tpl, body);
    t('  ...and the template reproduces its own amount and instant',
      !!back && back.amount === reading.amount && back.occurred_at === reading.occurred_at,
      JSON.stringify(back && { amt: back.amount, at: back.occurred_at }));
    t('  ...carrying no 6+ digit run into the shared cache', !/\d{6,}/.test(tpl));
  }
}

/* ── 2. the real VIB mail: time-first date ───────────────────────────────── */
console.log('\n-- VIB: "Vào lúc: 10:17 30/08/2026" --');
const VIB = [
  'Thông báo giao dịch Thẻ tín dụng VIB Cash Back', 'Kính gửi Quý khách hàng,', '',
  'Số thẻ: 5138***4751', 'Chủ thẻ: CAO THAI DUY HIEN',
  'Giao dịch: Thanh toán dịch vụ - hàng hóa', 'Giá trị: 253,900 VND',
  'Vào lúc: 10:17 30/08/2026', 'Tại Foody', '',
  'Ngân hàng Quốc Tế (VIB)', 'Trân trọng.',
].join('\n');
const VIB_READING = {
  is_transaction: true, transaction_type: 'ecommerce_receipt', source_provider: 'VIB',
  occurred_at: '2026-08-30T10:17:00+07:00', amount: 253900, currency: 'VND',
  direction: 'debit', counterparty: 'Foody', reference_number: null, status: null,
  account_masked: '5138***4751', memo: 'Thanh toán dịch vụ - hàng hóa',
};
let vibStep = null;
const vibTpl = T.deriveExtractionTemplate(VIB, VIB_READING, (s) => { vibStep = s; });
t('the VIB card shape graduates', !!vibTpl, 'failed at: ' + vibStep);
if (vibTpl) {
  const back = T.applyExtractionTemplate(vibTpl, VIB);
  t('  ...and reads 10:17, not midnight', !!back && back.occurred_at === '2026-08-30T10:17:00+07:00',
    JSON.stringify(back && back.occurred_at));
  t('  ...anchors carry no literal clock time (a 10:18 purchase must match too)',
    !!back && !/10:17/.test(JSON.parse(vibTpl).fields.occurred_at.re),
    vibTpl && JSON.parse(vibTpl).fields.occurred_at.re);
}

/* ── 3. the sign is never an anchor and never lost ───────────────────────── */
console.log('\n-- signs --');
const signBody = (s) => ['MB TK cham', 'x5249', 'Ngay, gio giao dich', '2026-08-25 18:52:04',
  'Diem giao dich', 'GS25', 'So tien', s + '37,000 VND'].join('\n');
const signReading = LT.readLabelTable('TK cham', signBody('+'));
const signTpl = T.deriveExtractionTemplate(signBody('+'), signReading);
t('derived off a refund (+), still matches a purchase (-)  <-- the 409/day bug',
  !!signTpl && !!T.applyExtractionTemplate(signTpl, signBody('-')),
  String(signTpl));

/* ── 4. account_masked can degrade but nothing else can ──────────────────── */
console.log('\n-- degradation is for exactly one field --');
const noAcct = { ...VIB_READING, account_masked: 'x9999-not-in-body' };
let naStep = null;
const naTpl = T.deriveExtractionTemplate(VIB, noAcct, (s) => { naStep = s; });
t('an unanchorable account degrades instead of killing the template',
  !!naTpl && !JSON.parse(naTpl).fields.account_masked, 'failed at: ' + naStep);
const noMemo = { ...VIB_READING, memo: 'typed by a human, not in body' };
let nmStep = null;
t('an unanchorable memo still kills it — that strictness is a scar, not a bug',
  T.deriveExtractionTemplate(VIB, noMemo, (s) => { nmStep = s; }) === null && nmStep === 'anchor:memo',
  'step: ' + nmStep);

/* ── 5. hygiene: the shared cache never holds an account number ──────────── */
console.log('\n-- hygiene --');
/* A name-prefixed account cell: the value is bare digits, the text before it on
   the same line is the holder's name — the layout that once baked
   "NGUYEN THU TRANG -" into a template regex. */
const nameBody = ['Giao dich thanh cong', 'So tien', '50,000 VND',
  'Ngay, gio giao dich', '2026-08-25 18:52:04',
  'Diem giao dich', 'GS25',
  'NGUYEN THU TRANG - 3510187654001', ''].join('\n');
const nameReading = { is_transaction: true, transaction_type: 'ecommerce_receipt',
  source_provider: 'MB Bank', occurred_at: '2026-08-25T18:52:04+07:00', amount: 50000,
  currency: 'VND', direction: 'debit', counterparty: 'GS25', reference_number: null,
  status: null, account_masked: '3510187654001', memo: null };
const nameTpl = T.deriveExtractionTemplate(nameBody, nameReading);
t('no template ever carries a 6+ digit run or a holder-name anchor',
  nameTpl === null || (!/\d{6,}/.test(nameTpl) && !/NGUYEN/.test(nameTpl)),
  String(nameTpl));

/* ── 6. masking still holds END TO END, where it now lives ───────────────── */
console.log('\n-- the last-four invariant, enforced at _tidy --');
const vcb = grab('VCB_CARD');
const res = await R.readTransaction(
  { from: 'x@vcb.com', subject: 'Thong bao', body: vcb },
  { fingerprint: async () => null, saveFingerprint: async () => {}, bumpReadTally: async () => {} },
  { llm: { apiKey: null } });
t('readTransaction output is masked to last four',
  !!res.extraction && String(res.extraction.account_masked || '').indexOf('…') === 0,
  JSON.stringify(res.extraction && res.extraction.account_masked));
t('and the full number never leaves the reader',
  !/1046999979/.test(JSON.stringify(res.extraction)));

/* ── 7. both codebases moved together ────────────────────────────────────── */
console.log('\n-- parity --');
globalThis.Logger = { log: () => {} };
const gs = fs.readFileSync(HERE + 'bank-email-pipeline.gs', 'utf8');
(0, eval)(gs.slice(gs.indexOf('var EXTRACTION_LOGIC_VERSION'), gs.indexOf('function upsertFingerprint')));
t('the .gs derives the identical VIB template, byte for byte',
  globalThis.deriveExtractionTemplate(VIB, VIB_READING) === vibTpl);

console.log('\n' + pass + ' pass, ' + fail + ' fail\n');
if (fail) process.exit(1);
