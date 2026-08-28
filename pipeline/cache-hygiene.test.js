#!/usr/bin/env node
/* The learning cache stops fragmenting; merchants lose their city tails.
 * `node pipeline/cache-hygiene.test.js`
 *
 * Two shapes of the same silent failure: knowledge written under keys that
 * never meet. VCBDigibank@ vs vcbdigibank@ (a writer that didn't lowercase)
 * and "Fwd: Biên lai" vs "Biên lai" (a normaliser that kept the prefix) each
 * split one sender's pile in two, so repeats never accumulated and templates
 * never graduated. 0099 merged the damage; these pin the writers.
 */
const E = await import('../supabase/functions/_shared/mailbox/extract.mjs');
const M = await import('../supabase/functions/_shared/mailbox/memo.mjs');
const L = await import('../supabase/functions/_shared/mailbox/labeltable.mjs');
const { normalizeSubjectTemplate } = E;
const { tidyMerchant } = M;
const { unknownLabels } = L;

let pass = 0, fail = 0;
const t = (n, ok, d) => { console.log((ok ? '  PASS  ' : '  FAIL  ') + n + (!ok && d ? '  -> ' + d : '')); ok ? pass++ : fail++; };

console.log('\n-- a forwarded receipt is the same shape as the original --');
t('Fwd: strips', normalizeSubjectTemplate('Fwd: Biên lai chuyển tiền qua tài khoản')
  === normalizeSubjectTemplate('Biên lai chuyển tiền qua tài khoản'));
t('doubled Fwd: strips', normalizeSubjectTemplate('Fwd: Fwd: Biên lai chuyển tiền')
  === normalizeSubjectTemplate('Biên lai chuyển tiền'));
t('Re: and FW: strip too', normalizeSubjectTemplate('RE: FW: Thong bao giao dich')
  === normalizeSubjectTemplate('Thong bao giao dich'));
t('a subject merely CONTAINING fwd is untouched',
  normalizeSubjectTemplate('Chương trình fwd points tháng 8') === 'Chương trình fwd points tháng 8');

console.log('\n-- merchant names lose the city tail, never their identity --');
t('AEON keeps its street, loses the city',
  tidyMerchant('AEON NGUYEN VAN LINH HO CHI MINH VN') === 'AEON NGUYEN VAN LINH');
t('HCM short form strips', tidyMerchant('REVI PHU MY HUNG TOWER HCM VN') === 'REVI PHU MY HUNG TOWER');
t('aggregator prefix and city tail strip together',
  tidyMerchant('MPOS*WAYNESCOFFEE HO CHI MINH VN') === 'WAYNESCOFFEE');
t('bare country token strips', tidyMerchant('Foody 19002042 VN') === 'Foody 19002042');
t('a name that IS the city string never strips to nothing',
  tidyMerchant('HO CHI MINH VN').length > 0);
t('a bare country token survives whole', tidyMerchant('VN') === 'VN');
t('city letters mid-name are untouched', tidyMerchant('HUE CAFE CENTRAL') === 'HUE CAFE CENTRAL');

console.log('\n-- miss telemetry: labels only, values never --');
const missBody = `| Mã đơn hàng | ABC123456 |
| Tên cửa hàng | CGV Hoàng Văn Thụ |
| Số tiền | 100,000 VND |`;
const miss = unknownLabels(missBody);
t('unknown labels are captured', miss.includes('Mã đơn hàng') && miss.includes('Tên cửa hàng'));
t('known labels are not noise', !miss.includes('Số tiền'));
t('no VALUE ever leaks into the list', !miss.some(l => /ABC123456|CGV|100,000/.test(l)));

console.log('\n-- a cashback row cannot hijack the amount --');
const { readLabelTable } = L;
const promoInside = `| Số tiền khuyến mãi | 50,000 VND |
| Số tiền | 165,000 VND |
| Ngày, giờ giao dịch | 2026-08-26 10:00:00 |
| Điểm giao dịch | HIGHLANDS |`;
const pr = readLabelTable('x', promoInside);
t('the transaction amount wins', pr && pr.amount === 165000, pr && String(pr.amount));

console.log('\n-- one bank, one name, whoever wrote it down --');
const S = await import('../supabase/functions/_shared/mailbox/senders.mjs');
const cp = S.canonProviderName;
t('MB / MBank / MBBank fold into the registry name',
  cp('MB') === 'MB Bank' && cp('MBank') === 'MB Bank' && cp('MBBank') === 'MB Bank' && cp('mb bank') === 'MB Bank');
t('registry names are fixed points', cp('Vietcombank') === 'Vietcombank' && cp('MB Bank') === 'MB Bank');
t('an unknown bank passes through untouched — folding strangers merges real sources',
  cp('Ngân hàng XYZ') === 'Ngân hàng XYZ');
t('null passes through', cp(null) === null);

console.log('\n' + (fail === 0 ? 'ALL ' + pass + ' PASSED' : pass + ' passed, ' + fail + ' FAILED'));
process.exit(fail ? 1 : 0);
