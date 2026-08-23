#!/usr/bin/env node
/* A duplicate is a SUSPICION, not a delete order.
 * `node tools/dup-advisory.test.js`
 *
 * email_transactions.duplicate_of_id used to be filtered out of the fetch, so a
 * guess made blind by the pipeline — with no human present, against a staging
 * table that empties as you review — could hide a real transaction AND cancel
 * its notification, with no screen showing it and no button to undo it. That is
 * how a genuine 2.000đ transfer disappeared.
 *
 * The detection is kept: the pipeline sees a pair this screen cannot (two
 * unreviewed emails, same amount, different wording). What it loses is the
 * authority to act alone. And the screen now runs the same rule itself, with
 * more evidence — the decrypted amount plus source_provider, which never gets
 * sealed precisely because bank names need fuzzy matching and a hash cannot.
 *
 * Real functions extracted from source by name.
 */
// NOT 'use strict': eval'd declarations must land in this scope.
const fs = require('fs');
const path = require('path');

const REVIEW = path.join(__dirname, '..', 'src', 'js-ui', '57-csv-import-review.js');
const src = fs.readFileSync(REVIEW, 'utf8');

// Extract a top-level function by name, up to its column-0 closing brace.
function grab(name) {
  const i = src.indexOf('function ' + name + '(');
  if (i < 0) { console.error(name + ' not found in 57-csv-import-review.js — renamed?'); process.exit(1); }
  const end = src.indexOf('\n}', i);
  if (end < 0) { console.error(name + ': no closing brace at column 0'); process.exit(1); }
  return src.slice(i, end + 2);
}

// Real deburr, copied from 50-sheets-expense-capture.js (loads earlier at runtime).
function deburr(s){ return String(s==null?'':s).normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/đ/g,'d').replace(/Đ/g,'D'); }
function normDescForDedup(x){ return deburr(String(x||'').trim().toLowerCase()).replace(/\s+/g,' '); }

const NOISE = src.match(/var CSV_PROVIDER_NOISE = \[[\s\S]*?\];/);
if (!NOISE) { console.error('CSV_PROVIDER_NOISE not found'); process.exit(1); }
eval(NOISE[0]);
eval(grab('csvCanonicalProvider'));
eval(grab('csvStagedCrossSourceDup'));

var window = { txns: [], csvStagedMode: false };
eval(grab('bucketCsvCandidates'));

let pass = 0, fail = 0;
const t = (n, ok, d) => { console.log((ok ? '  PASS  ' : '  FAIL  ') + n + (!ok && d ? '  -> ' + d : '')); ok ? pass++ : fail++; };

/* ---------------------------------------------------------------- 1. names */
console.log('\n-- one bank, many spellings --');
const mb = csvCanonicalProvider('MB Bank');
t("'MB Bank' and 'MBBank' agree", mb === csvCanonicalProvider('MBBank'), mb + ' vs ' + csvCanonicalProvider('MBBank'));
t("'MB Bank' and 'MB' agree", mb === csvCanonicalProvider('MB'));
t("'MB BANK JSC' agrees too", mb === csvCanonicalProvider('MB BANK JSC'));
t("'MB Internet Banking' agrees", mb === csvCanonicalProvider('MB Internet Banking'));
t('longest-noise-first leaves no stray e', csvCanonicalProvider('MB eBanking') === mb,
  csvCanonicalProvider('MB eBanking'));
t('different banks stay different', csvCanonicalProvider('Vietcombank') !== mb);
t('accents fold', csvCanonicalProvider('Kỹ Thương') === csvCanonicalProvider('Ky Thuong'));
t('empty is empty, never a match key', csvCanonicalProvider('') === '' && csvCanonicalProvider(null) === '');

/* ------------------------------------------------------------ 2. the rule */
console.log('\n-- cross-source rule in isolation --');
const cand = (amount, day) => ({ amount: amount, date: new Date(day), dateDisplay: day });
const prior = (amount, day, provider, cur) => ({ c: cand(amount, day), provider: csvCanonicalProvider(provider), currency: (cur||'VND') });

t('same bank twice is NOT a duplicate',
  csvStagedCrossSourceDup(cand(2000, '2026-08-16'), 'MB Bank', 'VND', [prior(2000, '2026-08-16', 'MBBank')]) === null);
t('different source, same amount, same day IS flagged',
  csvStagedCrossSourceDup(cand(2000, '2026-08-16'), 'MB Bank', 'VND', [prior(2000, '2026-08-16', 'Grab')]) !== null);
t('within 3 days still flagged',
  csvStagedCrossSourceDup(cand(2000, '2026-08-19'), 'MB Bank', 'VND', [prior(2000, '2026-08-16', 'Grab')]) !== null);
t('4 days apart is not',
  csvStagedCrossSourceDup(cand(2000, '2026-08-20'), 'MB Bank', 'VND', [prior(2000, '2026-08-16', 'Grab')]) === null);
t('different amount is not',
  csvStagedCrossSourceDup(cand(3000, '2026-08-16'), 'MB Bank', 'VND', [prior(2000, '2026-08-16', 'Grab')]) === null);
t('unknown provider on MY side refuses to guess',
  csvStagedCrossSourceDup(cand(2000, '2026-08-16'), '', 'VND', [prior(2000, '2026-08-16', 'Grab')]) === null);
t('unknown provider on THEIR side refuses to guess',
  csvStagedCrossSourceDup(cand(2000, '2026-08-16'), 'MB Bank', 'VND', [prior(2000, '2026-08-16', '')]) === null);
t('no date refuses to guess',
  csvStagedCrossSourceDup({ amount: 2000, date: null }, 'MB Bank', 'VND', [prior(2000, '2026-08-16', 'Grab')]) === null);
t('200 USD is not 200 VND',
  csvStagedCrossSourceDup(cand(200, '2026-08-16'), 'Anthropic', 'USD', [prior(200, '2026-08-16', 'MB Bank', 'VND')]) === null);
t('but 200 USD twice, from two sources, still matches',
  csvStagedCrossSourceDup(cand(200, '2026-08-16'), 'Anthropic', 'USD', [prior(200, '2026-08-16', 'MB Bank', 'USD')]) !== null);

/* --------------------------------------------------------- 3. in the screen */
const row = (desc, amount, day, i) => ({
  rowIndex: i, description: desc, _hasDesc: !!desc, counterparty: '',
  amount: amount, dateDisplay: day, date: new Date(day), categoryName: 'Khác', flags: []
});
const stagedMode = (rows, fn) => {
  window.csvStagedMode = true;
  window._fhStagedRows = rows;
  window.fhStagedMeta = function (ri) {
    var r = rows[ri];
    return r ? { provider: r.source_provider || '', currency: (r.currency || 'VND'),
                 occurredAt: r.occurred_at || '', pipelineDup: !!r.duplicate_of_id } : null;
  };
  try { return fn(); } finally { window.csvStagedMode = false; window.fhStagedMeta = null; }
};

console.log('\n-- the pipeline flag is shown, not obeyed --');
var r = stagedMode(
  [{ source_provider: 'MB Bank', duplicate_of_id: 'abc-123' }],
  () => bucketCsvCandidates([row('Cà phê', 50000, '2026-08-16', 0)], false));
t('a flagged row is NOT silently dropped', r.ready.length + r.possibleDuplicate.length + r.deferred.length === 1);
t('it reaches the review screen as a possible duplicate', r.possibleDuplicate.length === 1,
  'dup=' + r.possibleDuplicate.length + ' ready=' + r.ready.length);
t('and says why, so the card can explain itself',
  r.possibleDuplicate.length === 1 && r.possibleDuplicate[0].duplicateOfPipeline === true);
t('it never lands in ready, where it would import unasked', r.ready.length === 0);

console.log('\n-- an unflagged row is untouched --');
r = stagedMode(
  [{ source_provider: 'MB Bank', duplicate_of_id: null }],
  () => bucketCsvCandidates([row('Cà phê', 50000, '2026-08-16', 0)], false));
t('goes straight to ready', r.ready.length === 1 && r.possibleDuplicate.length === 0);

console.log('\n-- the case the pipeline sees and the old screen could not --');
r = stagedMode(
  [{ source_provider: 'MB Bank', duplicate_of_id: null },
   { source_provider: 'Grab',    duplicate_of_id: null }],
  () => bucketCsvCandidates([
    row('TT POS 1234', 200000, '2026-08-16', 0),
    row('Nhà hàng ABC', 200000, '2026-08-16', 1),
  ], false));
t('two different wordings, same amount, different source -> flagged',
  r.possibleDuplicate.length === 1, 'dup=' + r.possibleDuplicate.length);
t('the FIRST one still imports; only the echo is questioned',
  r.ready.length === 1 && r.ready[0].description === 'TT POS 1234');
t('flagged with the cross-source reason',
  r.possibleDuplicate.length === 1 && !!r.possibleDuplicate[0].duplicateOfSource);

console.log('\n-- the bug that ate a real 2.000đ transfer must stay dead --');
r = stagedMode(
  [{ source_provider: 'MB Bank', duplicate_of_id: null },
   { source_provider: 'MBBank',  duplicate_of_id: null }],
  () => bucketCsvCandidates([
    row('Chuyển cho Hoàng', 2000, '2026-08-16', 0),
    row('Chuyển cho Anh',   2000, '2026-08-16', 1),
  ], false));
t('same bank, two transfers -> BOTH import, neither questioned',
  r.ready.length === 2 && r.possibleDuplicate.length === 0,
  'ready=' + r.ready.length + ' dup=' + r.possibleDuplicate.length);

console.log('\n-- a habit is not a duplicate --');
r = stagedMode(
  [{ source_provider: 'MB Bank', duplicate_of_id: null },
   { source_provider: 'Grab',    duplicate_of_id: null }],
  () => bucketCsvCandidates([
    row('Cà phê', 50000, '2026-08-01', 0),
    row('Cà phê', 50000, '2026-08-20', 1),
  ], false));
t('19 days apart, same amount, different source -> both ready', r.ready.length === 2);

console.log('\n-- file imports are not affected by any of this --');
window.csvStagedMode = false;
r = bucketCsvCandidates([
  row('Cà phê', 50000, '2026-08-16', 0),
  row('Bún bò', 60000, '2026-08-16', 1),
], false);
t('no staged mode, no provider logic, both ready', r.ready.length === 2 && r.possibleDuplicate.length === 0);

/* ------------------------------------------------------- 4. the fetch guard */
console.log('\n-- the fetch must not hide flagged rows again --');
const fetchSrc = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'js-data', '72-txn-review.js'), 'utf8');
const stripped = fetchSrc.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
t("no .is('duplicate_of_id', null) filter survives in code",
  stripped.indexOf("duplicate_of_id', null") < 0);
t('duplicate_of_id is still SELECTed, so the screen can explain the flag',
  /select\([^)]*duplicate_of_id/.test(fetchSrc));
t('fhStagedMeta is bridged to window for js-ui to reach',
  /window\.fhStagedMeta\s*=\s*fhStagedMeta/.test(fetchSrc));

console.log('\n' + (fail ? '  ' + fail + ' FAILED' : '  all ' + pass + ' passed') + ' (' + (pass + fail) + ' assertions)\n');
process.exit(fail ? 1 : 0);
