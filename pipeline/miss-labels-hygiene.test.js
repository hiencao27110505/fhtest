#!/usr/bin/env node
/* The miss table records LABELS, and nothing else.
 * `node pipeline/miss-labels-hygiene.test.js`
 *
 * WHAT WENT WRONG. extract_miss_labels is described at its call site as "bank
 * boilerplate, no values, no amounts, nothing personal — the only training data
 * this pipeline collects". On 2026-09-03 it held 1,627 rows whose 697 distinct
 * entries included 500 amount-shaped strings and 318 names or merchants: a
 * named account holder (772 rows), their coffee shops, their Apple bills. A
 * plaintext table of one person's spending, in the database sealed staging
 * exists to keep money out of.
 *
 * The old rule asked whether a line LOOKED like a label — short, few words, no
 * run of four digits. In production line-form rendering a value looks exactly
 * like that, and a formatted VND amount never shows four consecutive digits
 * because of its comma separators, so `500,000 ₫` passed every test there was.
 *
 * These fixtures are the real leaked entries. Each assertion names the family
 * it comes from, so a future loosening fails on the specific thing it lets
 * back in rather than on a count.
 */
const L = await import('../supabase/functions/_shared/mailbox/labeltable.mjs');
const { unknownLabels } = L;

let pass = 0, fail = 0;
const t = (n, ok, d) => { console.log((ok ? '  PASS  ' : '  FAIL  ') + n + (!ok && d ? '  -> ' + d : '')); ok ? pass++ : fail++; };

/* A VIB body carrying one of each leaked family, in line form — the rendering
   production actually sends, and the one the old filter could not read. */
const BODY = [
  'Kính gửi CAO THÁI DUY HIỂN',
  'Ngày giao dịch', '03/09/2026 10:17',
  'Số tiền', '500,000 ₫',
  'Phí (bao gồm VAT)', '0 ₫',
  'Số hoá đơn', 'HD00123',
  'Đến tài khoản', 'NGUYEN VAN A',
  'Diễn giải', 'Thanh toan tien dien thang 8',
  'Tại TLJ CRESCENT MALL', 'x',
  'Tại MPOS*WAYNESCOFFEE', 'y',
  'Giá trị: 105,000 VND', 'z',
  'Website', 'vib.com.vn',
  'Email', 'dvkh247@vib.com.vn',
].join('\n');

const READING = {
  is_transaction: true, amount: 500000, currency: 'VND', direction: 'debit',
  counterparty: 'NGUYEN VAN A', memo: 'Thanh toan tien dien thang 8',
  occurred_at: '2026-09-03T10:17:00+07:00', reference_number: 'HD00123',
};

const got = unknownLabels(BODY, READING);
const has = (s) => got.some((l) => l.includes(s));

console.log('\n-- nothing that is a value gets recorded --');
t('no amount — "500,000 ₫" was the entry the digit rule could not see',
  !got.some((l) => /[0-9]/.test(l)), JSON.stringify(got));
t('no currency token anywhere', !got.some((l) => /(₫|VND)/i.test(l)));
t('no account holder — "Kính gửi CAO THÁI DUY HIỂN", 772 rows in production',
  !has('CAO THÁI'));
t('no counterparty — it is subtracted using the answer we already hold',
  !has('NGUYEN VAN A'));
t('no memo — the payer\'s own words about why the money moved', !has('Thanh toan tien dien'));
t('no merchant — "TLJ CRESCENT MALL", "MPOS*WAYNESCOFFEE"',
  !has('CRESCENT') && !has('WAYNESCOFFEE'));
t('no "Giá trị: 105,000 VND" — a fused label+amount', !has('105,000'));
t('no host or address — footer values, never labels',
  !has('vib.com.vn') && !got.some((l) => l.includes('@')));

console.log('\n-- and the real vocabulary still gets through --');
t('"Phí (bao gồm VAT)" survives — one short caps run is not a proper noun',
  has('Phí (bao gồm VAT)'));
t('"Số hoá đơn" survives', has('Số hoá đơn'));
t('"Diễn giải" survives — the memo label we most want to learn', has('Diễn giải'));
t('it recorded something at all — a filter that returns nothing is not hygiene',
  got.length >= 3, JSON.stringify(got));

console.log('\n-- the shape rules hold without a reading, and subtraction adds to them --');
/* cache-hygiene.test.js calls the one-argument form; it must not throw, and the
   shape rules alone must still keep every leaked family out of this fixture. */
const bare = unknownLabels(BODY);
t('one-argument form still works', Array.isArray(bare));
t('shape rules alone already remove every leaked family here',
  !bare.some((l) => /[0-9]|₫|VND/i.test(l)) && !bare.some((l) => l.includes('CAO THÁI'))
  && !bare.some((l) => l.includes('NGUYEN VAN A')), JSON.stringify(bare));

/* WHAT SUBTRACTION UNIQUELY CATCHES, and why production must pass the reading:
   a memo that is mixed-case, carries no digit and names nobody in capitals is
   invisible to every shape rule above. It is also the single most sensitive
   free-text field we hold — the payer's own words about why the money moved. */
const MEMO_BODY = ['Diễn giải', 'Thanh toan tien dien hang thang', 'Số hoá đơn', 'HD1'].join('\n');
t('without a reading, a digit-free mixed-case memo leaks',
  unknownLabels(MEMO_BODY).some((l) => l.includes('Thanh toan tien dien hang thang')));
t('with the reading, it is subtracted and only labels remain',
  JSON.stringify(unknownLabels(MEMO_BODY, { memo: 'Thanh toan tien dien hang thang' }))
  === JSON.stringify(['Diễn giải', 'Số hoá đơn']));

console.log('\n' + pass + ' pass, ' + fail + ' fail\n');
if (fail) process.exit(1);
