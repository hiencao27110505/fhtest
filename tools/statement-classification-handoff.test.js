#!/usr/bin/env node
/* What the statement reader decided about a row must reach the review card.
 * `node tools/statement-classification-handoff.test.js`
 *
 * fhStmtClassify (59) reads a statement row's own words and calls it a fee, a
 * refund, a salary, a top-up or a card payment. The hand-off in 77 let only the
 * last two through (as flow:'transfer' and stmt.xfer). A fee, a refund and a
 * salary were classified and then dropped, and `stmt.incomeCat` was written for
 * a reader that did not exist: the review re-guessed the income category from
 * keywords, and a fee reached the card with no node (email-reading-v2-spec §15
 * fix 5).
 *
 * This walks the REAL chain, no re-implementation: fhStmtClassify ->
 * fhStmtRowPayload -> fhStmtAsStaged (77) -> fhStagedAsCsvSource + the row
 * accessors (72) -> buildCsvCandidates (57), over the real tree (11, 13).
 * Synthetic rows only.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const T = require(path.join(ROOT, 'src/js-ui/59-statement-table.js'));

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

/* ── the device, just big enough for the chain ─────────────────────────────── */
const SRC72 = read('src/js-data/72-txn-review.js');
const SRC50 = read('src/js-ui/50-sheets-expense-capture.js');
const SRC45 = read('src/js-data/45-csv-import.js');
const SRC56 = read('src/js-ui/56-csv-import-ui.js');

const ctx = {
  console, L: (vi) => vi, LANG: 'vi', CUR: 'VND', csvStagedMode: true, txns: [],
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
vm.runInContext(SRC56.match(/var FH_INCOME_CATS = \[[^\]]*\];/)[0], ctx);
vm.runInContext(read('src/js-ui/57-csv-import-review.js'), ctx);
// 72's projection and row accessors, the same slice staged-memo-display.test.js takes.
vm.runInContext(SRC72.slice(SRC72.indexOf('var _BANK_GENERIC_MEMOS'), SRC72.indexOf('function fhStagedKind')), ctx);
['window.fhStagedNode = function (rowIndex)', 'window.fhStagedRawX = function (rowIndex)', 'window.fhStagedAcct = function (c)']
  .forEach((h) => vm.runInContext(grab(SRC72, h) + ';', ctx));

// 77 is an IIFE that publishes on `window`; hand it this one (as statement-rows.test.js does).
new Function('window', 'CSV_MCC_CONCEPT', 'L', '_esc', '_escAttr', '_rpc', 'localStorage', 'sessionStorage', 'document', 'crypto',
  read('src/js-data/77-statement-capture.js'))(
  ctx, {}, (vi) => vi, (s) => s, (s) => s, async () => null, ctx.localStorage, { setItem() {} }, {}, require('crypto').webcrypto);

/* A statement row as fhStmtRead hands it to the classifier. */
const srow = (description, amt, extra) => Object.assign({
  date: '2026-08-20', time: '', key: '2026-08-20T00:00:00', amt: amt, bal: null, ref: '',
  description: description, toName: '', fromName: '', toAcct: '', fromAcct: '', mcc: '',
}, extra || {});
const ACCT = { provider: 'TESTBANK', kind: 'deposit', tail: '0001' };

/* One statement row, all the way to its review candidate. `mutate` lets a case
   stand in for a payload stored by an older build. */
function candidateOf(row, mutate) {
  const cls = T.fhStmtClassify(row, { holder: 'NGUYEN VAN TEST' });
  const payload = ctx.fhStmtRowPayload(Object.assign({}, row, { cls: cls }), ACCT, 'S1');
  const staged = ctx.fhStmtAsStaged('id0', payload);
  if (mutate) mutate(staged);
  ctx._fhStagedRows = [staged];
  const s = vm.runInContext('fhStagedAsCsvSource(_fhStagedRows)', ctx);
  ctx.__p = s.parsed; ctx.__r = s.result;
  return { cls, staged, cand: vm.runInContext('buildCsvCandidates(__p, __r)', ctx)[0] };
}

console.log('a refund credit');
{
  const { cls, staged, cand } = candidateOf(srow('Hoan tien don hang 12345', 150000));
  ok(cls.flow === 'refund', 'the statement reader calls it a refund', cls.flow);
  ok(staged.raw_extracted.stmt.flow === 'refund', 'the hand-off keeps that word', staged.raw_extracted.stmt);
  ok(staged.raw_extracted.flow === 'income', 'the pipeline flow keeps its own three values', staged.raw_extracted.flow);
  ok(cand.isIncome === true && cand._incomeCat === 'Hoàn tiền', 'the card pre-selects "Hoàn tiền"', cand._incomeCat);
  ok(cand._stmtFlow === 'refund', 'and the candidate carries the classification');
}

console.log('\na salary credit');
{
  const { cls, cand } = candidateOf(srow('CONG TY TEST thanh toan luong thang 08', 20000000));
  ok(cls.flow === 'salary', 'the statement reader calls it a salary', cls.flow);
  ok(cand.isIncome === true && cand._incomeCat === 'Lương', 'the card pre-selects "Lương"', cand._incomeCat);
}

console.log('\nthe statement\'s classification outranks the keyword guess');
{
  /* The words say both. fhStmtClassify tests refund first; the review's own regex
     tests "luong" first. Before the fix the keyword guess was the only reader, so
     this row pre-selected Lương against the statement's own verdict. */
  const { cls, cand } = candidateOf(srow('Hoan tien tam ung luong', 500000));
  ok(cls.flow === 'refund', 'the statement says refund', cls.flow);
  ok(cand._incomeCat === 'Hoàn tiền', 'and the statement wins', cand._incomeCat);

  // A payload carrying only the flow (no incomeCat) still answers.
  const onlyFlow = candidateOf(srow('Hoan tien tam ung luong', 500000), (st) => { st.raw_extracted.stmt.incomeCat = ''; });
  ok(onlyFlow.cand._incomeCat === 'Hoàn tiền', 'the flow alone is enough', onlyFlow.cand._incomeCat);

  // A name the income set does not have is not trusted; the keyword guess runs.
  const odd = candidateOf(srow('Hoan tien tam ung luong', 500000),
    (st) => { st.raw_extracted.stmt.incomeCat = 'Not A Category'; st.raw_extracted.stmt.flow = ''; });
  ok(odd.cand._incomeCat === 'Lương', 'an unknown name falls back to the keyword guess', odd.cand._incomeCat);
}

console.log('\na credit the statement said nothing about');
{
  const { cls, cand } = candidateOf(srow('NGUOI GUI TEST chuyen khoan', 300000));
  ok(cls.flow === '', 'no classification', cls.flow);
  ok(cand.isIncome === true && cand._incomeCat === 'Khác', 'the keyword guess still runs, exactly as before', cand._incomeCat);
  ok(cand._stmtFlow === undefined, 'and nothing is invented on the candidate');
}

console.log('\na fee debit');
{
  const { cls, staged, cand } = candidateOf(srow('Phi duy tri dich vu', -11000));
  ok(cls.flow === 'fee', 'the statement reader calls it a fee', cls.flow);
  ok(staged.raw_extracted.stmt.flow === 'fee' && staged.raw_extracted.flow === 'expense', 'it crosses the hand-off as an expense that is a fee', staged.raw_extracted);
  ok(cand.isIncome === false && cand.isTransfer === false && cand._xfer === false, 'it stays an expense');
  ok(ctx.FH_TAX.get('fees') && ctx.FH_TAX.kindOf('fees') === 'expense', 'the tree has a fees node (the test would be vacuous without it)');
  ok(cand._node === 'fees' && cand._nodeSource === 'statement', 'and takes it', [cand._node, cand._nodeSource]);
}

console.log('\n...but a fee the tree can name more exactly keeps the exact node');
{
  // "gui xe" is a parking keyword; the statement still says fee ("phi").
  const kw = ctx.FH_TAX.keywordNode('phi gui xe thang 8', 'expense');
  const { cls, cand } = candidateOf(srow('Phi gui xe thang 8', -150000));
  ok(cls.flow === 'fee', 'the statement says fee', cls.flow);
  ok(!!kw && kw !== 'fees', 'the tree\'s keywords name something more specific', kw);
  ok(cand._node === kw && cand._nodeSource === 'keyword', 'the specific node wins over the group', [cand._node, cand._nodeSource]);
}

console.log('\nwhat already worked still does');
{
  const pay = candidateOf(srow('Thanh toan the tin dung 9999', -2000000));
  ok(pay.staged.raw_extracted.flow === 'transfer' && pay.cand.isTransfer === true, 'a card payment is still a transfer');
  const plain = candidateOf(srow('SYNTHETIC COFFEE SHOP', -45000));
  ok(plain.cand._stmtFlow === undefined && plain.cand._nodeSource !== 'statement', 'an ordinary purchase gets nothing from this tier');
}

console.log(failed ? '\n' + failed + ' failed' : '\nall passed');
process.exit(failed ? 1 : 0);
