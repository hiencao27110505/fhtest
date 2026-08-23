#!/usr/bin/env node
/* Two rows that merely LOOK alike are not the same transaction.
 * `node tools/review-bucketing.test.js`
 *
 * Bug 1 — silent rows collided. bucketCsvCandidates keyed the in-batch duplicate
 * check on description|amount|date. A p2p transfer deliberately has no
 * description (a pre-filled wrong answer is worse than a blank field), and
 * buildCsvCandidates then substitutes the placeholder "(không có mô tả)" — which
 * is IDENTICAL on every silent row. Two unrelated 2.000đ transfers on one day
 * therefore keyed the same, and the second was hidden in the duplicates section.
 *
 * Bug 2 — history only answered to a row's saved NOTE, so renaming a row on
 * import ("Ăn trưa" instead of "REVI PHU MY HUNG TOWER") meant the category just
 * given could never be found again. The counterparty names the merchant plainly.
 *
 * Real functions extracted from source by name.
 */
// NOT 'use strict': eval'd declarations must land in this scope.
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'js-ui', '57-csv-import-review.js'), 'utf8');

function normDescForDedup(x){ return String(x||'').trim().toLowerCase().replace(/\s+/g,' '); }
const i = src.indexOf('function bucketCsvCandidates');
if (i < 0) { console.error('bucketCsvCandidates not found — renamed?'); process.exit(1); }
var window = { txns: [] };
eval(src.slice(i, src.indexOf('\n}', src.indexOf('return { ready: ready', i)) + 2));

let pass = 0, fail = 0;
const t = (n, ok, d) => { console.log((ok ? '  PASS  ' : '  FAIL  ') + n + (!ok && d ? '  -> ' + d : '')); ok ? pass++ : fail++; };

const PLACEHOLDER = '(không có mô tả)';
// A silent p2p row as buildCsvCandidates actually produces it.
const silent = (amount, party, day) => ({
  description: PLACEHOLDER, _hasDesc: false, counterparty: party || '',
  amount: amount, dateDisplay: day, date: new Date(day), categoryName: 'Khác', flags: []
});
const spoken = (desc, amount, day) => ({
  description: desc, _hasDesc: true, counterparty: '',
  amount: amount, dateDisplay: day, date: new Date(day), categoryName: 'Khác', flags: []
});

console.log('\n-- the reported bug: two silent transfers, same amount, same day --');
var r = bucketCsvCandidates([
  silent(2000, 'LE VAN HOANG', '2026-08-16'),
  silent(2000, 'NGUYEN VAN A', '2026-08-16'),
], false);
t('both are ready, neither is called a duplicate', r.ready.length === 2 && r.possibleDuplicate.length === 0,
  'ready=' + r.ready.length + ' dup=' + r.possibleDuplicate.length);

console.log('\n-- with no counterparty either, they still both survive --');
r = bucketCsvCandidates([ silent(2000, '', '2026-08-16'), silent(2000, '', '2026-08-16') ], false);
t('nothing to compare -> no duplicate claimed', r.possibleDuplicate.length === 0);
t('and both still reach ready', r.ready.length === 2);

console.log('\n-- but the SAME counterparty twice is still caught --');
r = bucketCsvCandidates([
  silent(2000, 'LE VAN HOANG', '2026-08-16'),
  silent(2000, 'LE VAN HOANG', '2026-08-16'),
], false);
t('same merchant, same amount, same day -> flagged', r.possibleDuplicate.length === 1,
  String(r.possibleDuplicate.length));

console.log('\n-- and real described duplicates are unaffected --');
r = bucketCsvCandidates([ spoken('Chợ', 2000, '2026-08-16'), spoken('Chợ', 2000, '2026-08-16') ], false);
t('same description, same amount, same day -> flagged', r.possibleDuplicate.length === 1);
r = bucketCsvCandidates([ spoken('Chợ', 2000, '2026-08-16'), spoken('Chợ', 2000, '2026-08-17') ], false);
t('a habit on two different days is NOT a duplicate', r.possibleDuplicate.length === 0);

console.log('\n-- an uncategorised silent row still goes for a category, not to ready --');
var noCat = silent(2000, '', '2026-08-16'); noCat.categoryName = '';
r = bucketCsvCandidates([noCat], false);
t('it lands in needsCategoryGroups, not ready',
  r.ready.length === 0 && Object.keys(r.needsCategoryGroups).length === 1,
  'ready=' + r.ready.length + ' groups=' + Object.keys(r.needsCategoryGroups).length);

console.log('\n-- the ledger cross-match still applies to a silent row --');
window.txns = [{ _d: new Date('2026-08-16'), amt: 2000 }];
r = bucketCsvCandidates([ silent(2000, '', '2026-08-16') ], false);
t('an existing transaction is still matched', r.possibleDuplicate.length === 1,
  String(r.possibleDuplicate.length));
window.txns = [];

console.log('\n' + (fail === 0 ? 'ALL ' + pass + ' PASSED' : pass + ' passed, ' + fail + ' FAILED'));
process.exit(fail ? 1 : 0);
