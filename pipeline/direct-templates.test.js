#!/usr/bin/env node
/* The copied slices must stay identical to the ones they were copied from.
 * `node pipeline/direct-templates.test.js`
 *
 * `lib/templates.mjs` and `lib/memo.mjs` are verbatim copies of two slices of
 * pipeline/bank-email-pipeline.gs. Copies rot, and this pair rots dangerously,
 * because both transports READ AND WRITE THE SAME `sender_fingerprints` CACHE:
 * a template derived by the Apps Script is applied by the worker and the other
 * way round. A divergence would not throw anywhere. It would apply one bank's
 * anchors slightly differently and return a different amount.
 *
 * So this file does not test the copies against expectations. It re-slices the
 * .gs AT TEST TIME, evaluates both, and runs them over the same inputs. If
 * someone edits one side, this fails; if someone edits both the same way, it
 * passes, which is the outcome we actually want.
 *
 * A LEXICAL DIFF WOULD BE STRICTER AND WORSE. The .mjs files carry a header
 * comment and an export block that the .gs cannot have, so a byte comparison
 * would need exceptions carved into it, and an exception in a drift detector is
 * where drift hides. Comparing behaviour has no such hole.
 */
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, 'bank-email-pipeline.gs'), 'utf8');

// The .gs slices, evaluated into this scope. NOT 'use strict': these are ES5
// `var`/`function` declarations and they have to land as locals here.
// Ends at upsertFingerprint, which is the first FORWARDING-specific function
// in that file. Past it lie the fingerprint upsert, the sender-auth gate and the
// +tag / mailbox_connections resolution, none of which this transport uses.
const tplSlice = src.slice(src.indexOf('var EXTRACTION_LOGIC_VERSION'),
                           src.indexOf('function upsertFingerprint'));
const memoSlice = src.slice(src.indexOf('var MEMO_FILLER'), src.indexOf('function _withTidyMemo'));
eval(tplSlice);
eval(memoSlice);

let pass = 0, fail = 0;
const t = (n, ok, d) => { console.log((ok ? '  PASS  ' : '  FAIL  ') + n + (!ok && d ? '  -> ' + d : '')); ok ? pass++ : fail++; };

// A real MB Bank notice, laid out the way the mail actually arrives: one field
// per line, because a cell boundary is the only separator bank mail has.
const BODY = [
  'Ngan hang MB Bank',
  'So tien giao dich -165,000 VND',
  'So du 4,210,000 VND',
  'Tai khoan 0123456789',
  'Nguoi nhan HIGHLANDS COFFEE',
  'Noi dung chuyen tien ca phe sang',
  'Ma giao dich FT26234000123',
  'Thoi gian 24-08-2026 10:15:00',
].join('\n');

const EXTRACTION = {
  is_transaction: true,
  transaction_type: 'bank_txn',
  source_provider: 'MB Bank',
  occurred_at: '2026-08-24T10:15:00+07:00',
  amount: 165000,
  currency: 'VND',
  direction: 'debit',
  counterparty: 'HIGHLANDS COFFEE',
  memo: 'ca phe sang',
  reference_number: 'FT26234000123',
  status: null,
  account_masked: '0123456789',
};

// A second mail off the same template: different figures, same layout. This is
// what a stored template is FOR, and it is where a divergence would show up.
const BODY_2 = BODY
  .replace('-165,000', '-92,000')
  .replace('4,210,000', '4,118,000')
  .replace('HIGHLANDS COFFEE', 'AEON MALL TAN PHU')
  .replace('ca phe sang', 'com trua')
  .replace('FT26234000123', 'FT26234000999')
  .replace('24-08-2026 10:15:00', '25-08-2026 12:30:00');

(async () => {
const T = await import('../supabase/functions/_shared/mailbox/templates.mjs');
const M = await import('../supabase/functions/_shared/mailbox/memo.mjs');

console.log('\n-- the logic version is the cache key; it cannot drift --');
t('EXTRACTION_LOGIC_VERSION matches', T.EXTRACTION_LOGIC_VERSION === EXTRACTION_LOGIC_VERSION,
  T.EXTRACTION_LOGIC_VERSION + ' vs ' + EXTRACTION_LOGIC_VERSION);

console.log('\n-- derivation produces the same template, byte for byte --');
const mine = T.deriveExtractionTemplate(BODY, EXTRACTION);
const theirs = deriveExtractionTemplate(BODY, EXTRACTION);
t('both sides derived something', !!mine && !!theirs, 'mine=' + !!mine + ' theirs=' + !!theirs);
t('and the templates are identical', mine === theirs);
// The derivation only returns a template that reproduces the extraction it came
// from. That self-proof is what keeps a plausible-but-wrong template out of a
// cache both transports read.
t('a template was actually learned, not silently skipped', typeof mine === 'string' && mine[0] === '{');

console.log('\n-- applying it gives the same reading on both sides --');
for (const [label, body] of [['the mail it was derived from', BODY],
                             ['a second mail off the same template', BODY_2]]) {
  const a = T.applyExtractionTemplate(mine, body);
  const b = applyExtractionTemplate(theirs, body);
  t(label + ': both read it', !!a && !!b, 'mine=' + JSON.stringify(a) + ' theirs=' + JSON.stringify(b));
  t(label + ': identical result', JSON.stringify(a) === JSON.stringify(b));
}

// The figures themselves, spelled out. If the two implementations agreed on a
// WRONG answer the test above would still pass, so the values are pinned too.
{
  const r = T.applyExtractionTemplate(mine, BODY_2);
  t('the second mail reads its own amount, not the first one\'s', r.amount === 92000, String(r.amount));
  t('and its own counterparty', r.counterparty === 'AEON MALL TAN PHU', String(r.counterparty));
  t('and its own reference', r.reference_number === 'FT26234000999', String(r.reference_number));
  t('and its own date', String(r.occurred_at).startsWith('2026-08-25'), String(r.occurred_at));
  t('the balance is not mistaken for the amount', r.amount !== 4118000);
}

console.log('\n-- a structurally different mail is refused, not guessed at --');
{
  const other = 'Something else entirely\nwith none of the labels';
  t('mine returns null', T.applyExtractionTemplate(mine, other) === null);
  t('theirs returns null too', applyExtractionTemplate(theirs, other) === null);
}
{
  // A stale template must invalidate rather than be applied by newer logic.
  const stale = JSON.stringify({ ...JSON.parse(mine), v: 1 });
  t('a stale version is refused on both sides',
    T.applyExtractionTemplate(stale, BODY) === null && applyExtractionTemplate(stale, BODY) === null);
}
{
  t('a legacy placeholder string is refused, not parsed',
    T.applyExtractionTemplate('some-old-regex', BODY) === null);
}

console.log('\n-- memo tidying agrees on every shape in the corpus --');
const MEMOS = [
  // bank auto-fill: says nothing, and a pre-filled wrong answer is worse than
  // a blank one because it gets accepted rather than corrected
  ['NGUYEN THU TRANG chuyen tien', BODY],
  ['CAO THAI DUY HIEN chuyen tien', BODY],
  ['Thu Trang chuyen khoan nhanh qua Zalo', BODY],
  // a human actually wrote these
  ['ca phe sang', BODY],
  ['tra tien an trua thu 6', BODY],
  ['email trans live  iu anh', BODY],
  // structured reference: a type code plus prose
  ['MB.5153-20260814.NAP TIEN DIEN THOAI.0944684991.MOBILETOPUP', BODY],
  ['', BODY],
  [null, BODY],
];
for (const [memo, body] of MEMOS) {
  const a = M.tidyMemo(memo, body);
  const b = tidyMemo(memo, body);
  t('tidyMemo(' + JSON.stringify(memo) + ') matches',
    JSON.stringify(a) === JSON.stringify(b), JSON.stringify(a) + ' vs ' + JSON.stringify(b));
}

console.log('\n-- and on merchants --');
for (const name of ['MPOS*QUICK SAVE MARKET', 'PAYOO-AEON MALL', 'VNPAY_GRAB',
                    'HIGHLANDS COFFEE', 'MOMO  SHOP', '', null]) {
  t('tidyMerchant(' + JSON.stringify(name) + ') matches',
    M.tidyMerchant(name) === tidyMerchant(name),
    JSON.stringify(M.tidyMerchant(name)) + ' vs ' + JSON.stringify(tidyMerchant(name)));
}

console.log('\n-- deburring, which the memo rules stand on --');
for (const s of ['Ngân hàng', 'Kỹ Thương', 'chuyển tiền', 'ĐẦU TƯ', 'plain ascii']) {
  t('deburrAscii(' + JSON.stringify(s) + ') matches', M.deburrAscii(s) === deburrAscii(s));
}

console.log('\n' + (fail ? 'FAILED ' + fail + ' of ' + (pass + fail)
                         : 'ALL ' + pass + ' assertions passed'));
process.exit(fail ? 1 : 0);
})();
