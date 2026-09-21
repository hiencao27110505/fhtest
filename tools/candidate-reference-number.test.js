#!/usr/bin/env node
/* The richest-copy merge counts a bank reference. Candidates must carry one.
 * `node tools/candidate-reference-number.test.js`
 *
 * When one payment reaches the queue twice, bucketCsvCandidates keeps whichever
 * copy TELLS the most (csvInfoScore) and flags the other. The score has always
 * given two points for `c.reference_number`, and no candidate ever had that
 * field: buildCsvCandidates never copied it off the staged row. So the last
 * tie-break was dead, and between two otherwise equal copies arrival order
 * decided, which is the accident the merge was written to avoid
 * (email-reading-v2-spec §15, smaller defects).
 *
 * It stays a REVIEW field. reference_number has no ledger column on purpose
 * (spec §4): it serves dedup and does not belong on a ledger row.
 *
 * Real functions over the real tree; synthetic rows.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

let failed = 0;
function ok(cond, what, detail) {
  console.log((cond ? '  ok   ' : '  FAIL ') + what + (!cond && detail !== undefined ? '  -> ' + JSON.stringify(detail) : ''));
  if (!cond) failed++;
}
function grab(src, header) {
  const at = src.indexOf(header);
  if (at < 0) throw new Error('not found in source: ' + header);
  let i = src.indexOf('{', at), depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (!depth) break; }
  }
  return src.slice(at, i + 1);
}

const SRC72 = read('src/js-data/72-txn-review.js');
const SRC50 = read('src/js-ui/50-sheets-expense-capture.js');
const SRC45 = read('src/js-data/45-csv-import.js');
function device(staged) {
  const ctx = {
    console, L: (vi) => vi, LANG: 'vi', CUR: 'VND', csvStagedMode: staged, txns: [],
    catOrder: ['Ăn uống', 'Khác'], catStyle: { 'Ăn uống': ['🍜'], 'Khác': ['🗂️'] }, CAT_FALLBACK: 'Khác',
    isVi: () => true, catValid: (c) => c === 'Ăn uống' || c === 'Khác',
    localStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(read('src/js-ui/11-taxonomy.js'), ctx);
  vm.runInContext(read('src/js-ui/13-partition.js'), ctx);
  vm.runInContext([
    'function deburr(', 'var KW_SHARED=', 'var KW_VI=', 'var KW_EN=', 'var CONCEPT_MATCH=',
    'function _scanConcepts(', 'function conceptFromNote(', 'function familyCatForConcept(', 'function guessCat(',
  ].map((h) => grab(SRC50, h) + (h.startsWith('var') ? ';' : '')).join('\n') + '\n' + SRC50.match(/var CONCEPT_ORDER=\[[^\]]*\];/)[0], ctx);
  vm.runInContext(SRC45.slice(0, SRC45.indexOf('function classifyDate')) + grab(SRC45, 'function classifyDate(') + '\n' + grab(SRC45, 'function classifyAmount('), ctx);
  vm.runInContext(read('src/js-ui/57-csv-import-review.js'), ctx);
  vm.runInContext(read('src/js-ui/58-dedup-engine.js'), ctx);
  vm.runInContext(SRC72.slice(SRC72.indexOf('var _BANK_GENERIC_MEMOS'), SRC72.indexOf('function fhStagedKind')), ctx);
  ['window.fhStagedNode = function (rowIndex)', 'window.fhStagedRawX = function (rowIndex)', 'window.fhStagedAcct = function (c)']
    .forEach((h) => vm.runInContext(grab(SRC72, h) + ';', ctx));
  return ctx;
}
function candidates(ctx, rows) {
  ctx._fhStagedRows = rows;
  const s = vm.runInContext('fhStagedAsCsvSource(_fhStagedRows)', ctx);
  ctx.__p = s.parsed; ctx.__r = s.result;
  return vm.runInContext('buildCsvCandidates(__p, __r)', ctx);
}
const stagedRow = (id, extracted) => ({
  id: id, occurred_at: '2026-08-20T04:11:09+00:00', amount: 250000, currency: 'VND', direction: 'debit',
  counterparty: 'SYNTHETIC MART', source_provider: 'TESTBANK', duplicate_of_id: null, resolved_before: false,
  raw_extracted: Object.assign({ memo: null, memo_display: '', transaction_type: 'bank_txn', account_kind: 'deposit', account_masked: '0001' }, extracted),
});

console.log('the candidate carries the staged row\'s reference');
const ctx = device(true);
let cs = candidates(ctx, [stagedRow('a', { reference_number: 'FT26232000001' }), stagedRow('b', {}), stagedRow('c', { reference_number: '   ' })]);
ok(cs[0].reference_number === 'FT26232000001', 'a reference rides onto the candidate', cs[0].reference_number);
ok(cs[1].reference_number === undefined, 'a row without one carries nothing', cs[1].reference_number);
ok(cs[2].reference_number === undefined, 'a blank one is nothing, not a blank string', cs[2].reference_number);

console.log('\nso the score can finally see it');
ctx.__a = cs[0]; ctx.__b = cs[1];
const sa = vm.runInContext('csvInfoScore(__a)', ctx), sb = vm.runInContext('csvInfoScore(__b)', ctx);
ok(sa === sb + 2, 'two otherwise equal copies differ by exactly the reference\'s two points', [sa, sb]);

console.log('\nand the richest-copy merge keeps the copy that has it');
{
  // Same instant, same amount: one payment that arrived twice. The poorer copy
  // arrives FIRST, which is the order that used to win by accident.
  cs = candidates(ctx, [stagedRow('poor', {}), stagedRow('rich', { reference_number: 'FT26232000001' })]);
  ctx.__cs = cs;
  vm.runInContext('bucketCsvCandidates(__cs, false)', ctx);
  ok(cs[0]._mergedCopy === true && !cs[1]._mergedCopy, 'the copy with the reference survives, whatever order they came in',
    { poor: !!cs[0]._mergedCopy, rich: !!cs[1]._mergedCopy });

  cs = candidates(ctx, [stagedRow('rich', { reference_number: 'FT26232000001' }), stagedRow('poor', {})]);
  ctx.__cs = cs;
  vm.runInContext('bucketCsvCandidates(__cs, false)', ctx);
  ok(!cs[0]._mergedCopy && cs[1]._mergedCopy === true, '...and the other way round');
}

console.log('\na file import has no staged row behind it');
{
  const file = device(false);
  // A stale queue left in memory must not lend its reference to a CSV row.
  file._fhStagedRows = [stagedRow('stale', { reference_number: 'FT-STALE' })];
  file.__p = { rows: [['2026-08-20', 'ca phe', '-45000', '']], headers: [] };
  file.__r = { columnMap: { 0: { field: 'occurred_at', confidence: 1 }, 1: { field: 'description', confidence: 1 }, 2: { field: 'amount', confidence: 1 }, 3: { field: 'counterparty', confidence: 1 } } };
  const c = vm.runInContext('buildCsvCandidates(__p, __r)', file)[0];
  ok(c.reference_number === undefined, 'a CSV candidate carries none', c.reference_number);
}

console.log('\nit never reaches a ledger write');
{
  const promote = grab(SRC72, 'async function _fhPromoteStagedRun(');
  const csvui = read('src/js-ui/56-csv-import-ui.js');
  ok(!/reference_number/.test(promote), 'the personal promote path does not read it');
  ok(!/reference_number/.test(grab(csvui, 'function csvPromote(')), 'nor the family one');
  ok(!/reference_number/.test(grab(csvui, 'function csvDraftPayload(')), 'nor the on-device draft');
}

console.log(failed ? '\n' + failed + ' failed' : '\nall passed');
process.exit(failed ? 1 : 0);
