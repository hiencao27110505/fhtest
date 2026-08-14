#!/usr/bin/env node
/* Memo/merchant tidying, against a corpus harvested from real bank mail.
 * `node pipeline/memo-tidy.test.js`
 *
 * Every string below was taken from an actual email in the shared inbox on
 * 2026-08-14 (MB eBanking, MB card, Vietcombank). They are kept verbatim —
 * including the double space in "email trans live  iu anh" — because the whole
 * point is that the rules survive real data rather than tidy examples.
 *
 * The case that matters most is the third shape: a memo that LOOKS like prose
 * (spaces, letters, several words) and says nothing. Those are the ones that
 * must come back empty, because 72-txn-review.js is built on the principle that
 * a pre-filled wrong answer is worse than a blank field.
 */
// NOT 'use strict': eval'd .gs declarations must land in this scope.
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, 'bank-email-pipeline.gs'), 'utf8');
eval(src.slice(src.indexOf('var MEMO_FILLER'), src.indexOf('function _withTidyMemo')));

let pass = 0, fail = 0;
const t = (n, ok, d) => { console.log((ok ? '  PASS  ' : '  FAIL  ') + n + (!ok && d ? '  -> ' + d : '')); ok ? pass++ : fail++; };

/* Bodies reduced to the lines the rules actually read. The holder's name appears
   twice in a real email — once in the account line, once inside the auto-filled
   memo — and that repetition is exactly what identifies it as a name. */
const MB_BODY = [
  'Tai khoan trich no NGUYEN THU TRANG - 3510146052001 (VND)',
  'Nguoi thu huong NGUYEN THU TRANG - 0944684991',
  'Noi dung chuyen tien NGUYEN THU TRANG chuyen tien',
].join('\n');
const MB_HUMAN_BODY = [
  'Tai khoan trich no NGUYEN THU TRANG - 3510146052001 (VND)',
  'Nguoi thu huong CAO THAI DUY HIEN - 0904911217',
  'Noi dung chuyen tien email trans live  iu anh',
].join('\n');
const MB_ZALO_BODY = [
  'Tai khoan trich no NGUYEN THU TRANG - 3510146052001 (VND)',
  'Nguoi thu huong HO KINH DOANH HO THI THAO 1999 - V3SMS2XXXXXXXXX3326',
  'Noi dung chuyen tien Thu Trang chuyen khoan nhanh qua Zalo',
].join('\n');
const VCB_BODY = [
  'Ten nguoi chuyen tien CAO THAI DUY HIEN',
  'Ten nguoi huong CAO THAI DUY HIEN',
  'Noi dung chuyen tien CAO THAI DUY HIEN chuyen tien',
].join('\n');
const TOPUP = 'MB.5153-67776-20260814-145623-06800.20260814.NAP TIEN DIEN THOAI.0944684991.MOBILETOPUP.0944684991.002...1.';

console.log('\n-- auto-filled memos say nothing and must come back empty --');
t('MB bank auto-fill (3 of 5 real memos were this)',
  tidyMemo('NGUYEN THU TRANG chuyen tien', MB_BODY).description === '',
  JSON.stringify(tidyMemo('NGUYEN THU TRANG chuyen tien', MB_BODY)));
t('VCB auto-fill — a different holder, never hard-coded',
  tidyMemo('CAO THAI DUY HIEN chuyen tien', VCB_BODY).description === '');
t('Zalo app auto-fill, partial name match ("Thu Trang" of "NGUYEN THU TRANG")',
  tidyMemo('Thu Trang chuyen khoan nhanh qua Zalo', MB_ZALO_BODY).description === '',
  JSON.stringify(tidyMemo('Thu Trang chuyen khoan nhanh qua Zalo', MB_ZALO_BODY)));

console.log('\n-- what a person actually typed must survive untouched --');
const human = tidyMemo('email trans live  iu anh', MB_HUMAN_BODY);
t('human memo is kept', human.description === 'email trans live iu anh', JSON.stringify(human));
t('and only its double space is collapsed', human.description.indexOf('  ') === -1);

console.log('\n-- structured references yield prose AND a type code --');
const top = tidyMemo(TOPUP, TOPUP);
t('the human-readable segment is found', top.description === 'NAP TIEN DIEN THOAI', JSON.stringify(top.description));
t('the machine type code is captured for categorisation', top.code === 'MOBILETOPUP', String(top.code));
t('no reference, date or phone number leaks into the description',
  !/\d/.test(top.description), top.description);

console.log('\n-- merchants: strip the aggregator, keep the shop --');
t('MPOS* prefix removed', tidyMerchant('MPOS*QUICK SAVE MARKET') === 'QUICK SAVE MARKET');
t('a plain merchant is untouched', tidyMerchant('AEON NGUYEN VAN LINH') === 'AEON NGUYEN VAN LINH');
t('so is one with a building name', tidyMerchant('REVI PHU MY HUNG TOWER') === 'REVI PHU MY HUNG TOWER');
t('empty stays empty', tidyMerchant(null) === '');

console.log('\n-- edges --');
t('a null memo is empty, not a crash', tidyMemo(null, MB_BODY).description === '');
t('a memo with no body context still parses', tidyMemo('an trua', '').description === 'an trua');
t('a single filler word alone is not a description',
  tidyMemo('thanh toan', MB_BODY).description === '');

console.log('\n' + (fail === 0 ? 'ALL ' + pass + ' PASSED' : pass + ' passed, ' + fail + ' FAILED'));
process.exit(fail ? 1 : 0);
