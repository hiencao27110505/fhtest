#!/usr/bin/env node
/* The self-transfer test must actually see the counterparty it asks about.
 * `node tools/self-transfer-counterparty.test.js`
 *
 * buildCsvCandidates decides "this is a move between my own accounts" from a
 * memo shaped "X chuyển tiền đến X", and it asks two fields: the memo (or the
 * description), and the counterparty, which is where some banks print that same
 * auto-fill sentence. The second question was dead: `party` was declared a few
 * lines BELOW the test. `var` hoists the name, so nothing threw; the test just
 * saw undefined on every row (email-reading-v2-spec §15, smaller defects).
 *
 * The visible cost: a row whose description is what the person typed and whose
 * counterparty carries the bank's "X chuyen tien den X" stayed an expense (or a
 * card payment asking "which card?") instead of an internal transfer.
 *
 * Real function, run over the real tree. Synthetic names only.
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

const SRC50 = read('src/js-ui/50-sheets-expense-capture.js');
const SRC45 = read('src/js-data/45-csv-import.js');
const ctx = {
  console, L: (vi) => vi, LANG: 'vi', CUR: 'VND', csvStagedMode: false, txns: [],
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

const COLS = ['occurred_at', 'description', 'amount', 'counterparty'];
const columnMap = {};
COLS.forEach((f, i) => { columnMap[i] = { field: f, confidence: 1 }; });
function candidate(description, counterparty) {
  ctx.__p = { rows: [['2026-08-20', description, '-5000000', counterparty]], headers: COLS };
  ctx.__r = { columnMap };
  return vm.runInContext('buildCsvCandidates(__p, __r)', ctx)[0];
}

const SELF = 'NGUYEN VAN TEST chuyen tien den NGUYEN VAN TEST - 1000000001';

console.log('self-transfer, named in the counterparty');
let c = candidate('gui tiet kiem', SELF);
ok(c._xfer === true, 'the counterparty\'s "X chuyen tien den X" makes it an internal transfer (was dead)', { _xfer: c._xfer });
ok(c.isTransfer === false, 'and not a card payment, which would ask "which card?"');
ok(c.counterparty === SELF, 'the counterparty itself is unchanged on the candidate');

console.log('\nthe half that already worked');
c = candidate(SELF, '');
ok(c._xfer === true, 'the same sentence in the description still does it');

console.log('\nconservative, as the rule was written');
c = candidate('gui tien', 'NGUYEN VAN TEST chuyen tien den TRAN THI KHAC - 1000000002');
ok(c._xfer === false, 'two different names is a transfer to SOMEONE, never a self-transfer');
c = candidate('ca phe', 'SYNTHETIC COFFEE');
ok(c._xfer === false, 'an ordinary merchant is untouched');
c = candidate('ca phe', '');
ok(c._xfer === false, 'no counterparty at all is untouched');

console.log('\nsource order');
{
  const src = read('src/js-ui/57-csv-import-review.js');
  const body = src.slice(src.indexOf('function buildCsvCandidates('));
  const decl = body.indexOf('var party =');
  const use = body.indexOf('_isSelfTransfer(party)');
  ok(decl >= 0 && use >= 0 && decl < use, '`party` is assigned before _isSelfTransfer(party) reads it', { decl, use });
}

console.log(failed ? '\n' + failed + ' failed' : '\nall passed');
process.exit(failed ? 1 : 0);
