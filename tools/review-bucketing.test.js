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
function deburr(s){ return String(s||'').normalize('NFD').replace(/[̀-ͯ]/g,''); }
// Each dependency of bucketCsvCandidates, sliced from its `function NAME` to
// the first column-0 close brace — the same trick the main extraction uses.
const fx = (name) => {
  const j = src.indexOf('function ' + name);
  if (j < 0) { console.error(name + ' not found — renamed?'); process.exit(1); }
  return src.slice(j, src.indexOf('\n}', j) + 2);
};
eval(fx('_csvNameKey'));
eval(fx('csvNearMissDup'));
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

console.log('\n-- the units bug (2026-09-03): ledger stores base units, candidates carry đồng --');
/* With curMult live (1000 for VND), a stored 92.5 IS the candidate's 92.500đ.
   The old comparison ran raw — |92.5 − 92500| — and never matched anything,
   which is how two exact SHOPEE repeats sat ticked in ready on a real queue. */
curMult = function(){ return 1000; };
window.txns = [{ _d: new Date('2026-08-29'), amt: 92.5, note: 'SHOPEE - VIETNAM 87821624', cat: 'Shopping', who: 'Hiền' }];
r = bucketCsvCandidates([ spoken('SHOPEE - VIETNAM 87821624', 92500, '2026-08-29') ], false);
t('a base-unit ledger row matches a đồng candidate', r.possibleDuplicate.length === 1,
  String(r.possibleDuplicate.length));
t('and the flag carries the matched row as evidence',
  r.possibleDuplicate.length === 1 && !!r.possibleDuplicate[0].duplicateOfExisting
  && r.possibleDuplicate[0].duplicateOfExisting.note === 'SHOPEE - VIETNAM 87821624');

console.log('\n-- the near-miss tier: same merchant, same day, rounded by hand --');
/* 467.000đ hand-logged against the bank's 467.290đ — a real pair the exact
   tier waved through. Merchant + day + a gap under 1.000đ = the weak flag. */
window.txns = [{ _d: new Date('2026-08-27'), amt: 467, note: 'AEON NGUYEN VAN LINH', cat: 'Đi chợ', who: 'Hiền' }];
r = bucketCsvCandidates([ spoken('AEON NGUYEN VAN LINH', 467290, '2026-08-27') ], false);
t('a rounded hand-log is flagged as a near miss',
  r.possibleDuplicate.length === 1 && !!r.possibleDuplicate[0].duplicateNearMiss,
  String(r.possibleDuplicate.length));
r = bucketCsvCandidates([ spoken('AEON NGUYEN VAN LINH', 468500, '2026-08-27') ], false);
t('a gap of 1.500đ is a different purchase, not a near miss', r.possibleDuplicate.length === 0,
  String(r.possibleDuplicate.length));
r = bucketCsvCandidates([ spoken('HIGHLANDS COFFEE', 467290, '2026-08-27') ], false);
t('a different merchant never near-misses, however close the amount', r.possibleDuplicate.length === 0,
  String(r.possibleDuplicate.length));
window.txns = [];
curMult = undefined;

console.log('\n' + (fail === 0 ? 'ALL ' + pass + ' PASSED' : pass + ' passed, ' + fail + ' FAILED'));
process.exit(fail ? 1 : 0);
