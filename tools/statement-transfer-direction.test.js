#!/usr/bin/env node
/* A top-up seen from the wallet's statement is money coming IN, all the way to
 * the ledger.  `node tools/statement-transfer-direction.test.js`
 *
 * `isIncome` doubles as the direction flag on every review candidate: flipping a
 * credit to "Chuyển khoản nội bộ" on the card never clears it, and promote signs
 * the transfer leg from it. One path broke that convention. A statement row that
 * the file itself marks as a transfer (a wallet top-up, a recipient == holder
 * memo) is pre-set in buildCsvCandidates with `isIncome = false`, and the
 * direction went with it.
 *
 * The review card had the answer scaffolded and never wired: three places in 56
 * ask `isIncome || c._xferDir === 'in'`, and `_xferDir` was set nowhere (not in
 * any commit). So a wallet top-up was offered the money-OUT kinds, asked "Chuyển
 * đến đâu?" about money that had arrived, and imported with the wallet's leg
 * NEGATIVE: the balance moved the wrong way (email-reading-v2-spec §15, smaller
 * defects).
 *
 * The real chain: fhStmtClassify -> 77 -> 72's projection -> buildCsvCandidates,
 * then the real _fhPromoteStagedRun over that same candidate.
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

const SRC72 = read('src/js-data/72-txn-review.js');
const SRC50 = read('src/js-ui/50-sheets-expense-capture.js');
const SRC45 = read('src/js-data/45-csv-import.js');
const SRC56 = read('src/js-ui/56-csv-import-ui.js');

const ctx = {
  console: { log() {}, warn() {} }, L: (vi) => vi, LANG: 'vi', CUR: 'VND', csvStagedMode: true, txns: [],
  catOrder: ['Khác'], catStyle: { 'Khác': ['🗂️'] }, CAT_FALLBACK: 'Khác',
  isVi: () => true, catValid: (c) => c === 'Khác',
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
vm.runInContext(SRC72.slice(SRC72.indexOf('var _BANK_GENERIC_MEMOS'), SRC72.indexOf('function fhStagedKind')), ctx);
['window.fhStagedNode = function (rowIndex)', 'window.fhStagedRawX = function (rowIndex)', 'window.fhStagedAcct = function (c)',
 'window.fhStagedSource = function (c)', 'window.fhStagedRowTime = function (c)']
  .forEach((h) => vm.runInContext(grab(SRC72, h) + ';', ctx));
vm.runInContext(grab(SRC56, 'function csvRowTime('), ctx);
vm.runInContext(grab(SRC72, 'async function _fhPromoteStagedRun('), ctx);
new Function('window', 'CSV_MCC_CONCEPT', 'L', '_esc', '_escAttr', '_rpc', 'localStorage', 'sessionStorage', 'document', 'crypto',
  read('src/js-data/77-statement-capture.js'))(
  ctx, {}, (vi) => vi, (s) => s, (s) => s, async () => null, ctx.localStorage, { setItem() {} }, {}, require('crypto').webcrypto);

const WALLET = { provider: 'MoMo', kind: 'ewallet', tail: '1217' };
const BANK = { provider: 'TESTBANK', kind: 'deposit', tail: '0001' };
const srow = (description, amt, extra) => Object.assign({
  date: '2026-08-20', time: '', key: '2026-08-20T00:00:00', amt: amt, bal: null, ref: '',
  description: description, toName: '', fromName: '', toAcct: '', fromAcct: '', mcc: '',
}, extra || {});

function candidateOf(row, acct) {
  const cls = T.fhStmtClassify(row, { holder: 'NGUYEN VAN TEST' });
  ctx._fhStagedRows = [ctx.fhStmtAsStaged('id0', ctx.fhStmtRowPayload(Object.assign({}, row, { cls: cls }), acct, 'S1'))];
  const s = vm.runInContext('fhStagedAsCsvSource(_fhStagedRows)', ctx);
  ctx.__p = s.parsed; ctx.__r = s.result;
  return vm.runInContext('buildCsvCandidates(__p, __r)', ctx)[0];
}

/* Promote one candidate for real; the writer stub records the specs and reports a
   failed write, the shortest honest way out of the function. */
async function promote(cand, ownId) {
  let captured = [];
  Object.assign(ctx, {
    crypto: { randomUUID: () => 'gid' }, toast: () => {},
    csvReview: { ready: [cand] }, csvStagedSelected: () => [cand], csvRowScope: () => 'personal',
    csvBaseAmt: (n) => Math.round(Number(n) / 1000), fhStagedIdsForResolved: () => [],
    fhPersonalData: () => ({ accounts: [{ id: 'acct-wallet', kind: 'ewallet' }, { id: 'acct-bank', kind: 'deposit' }] }),
    fhPersonalAccountEnsure: async () => ownId,
    fhPersonalAddMany: async (specs) => { captured = specs; return { ok: false, written: 0 }; },
    _stagedResolve: async () => {}, _stagedRetiredAdd: () => {},
    _txrLoadShow: () => {}, _txrLoadMsg: () => {}, _txrYield: async () => {}, _txrHeld: false,
  });
  await vm.runInContext('_fhPromoteStagedRun()', ctx);
  return captured;
}
const legOf = (specs, acct) => (specs.find((s) => s.accountId === acct) || {}).amt;

(async () => {
  console.log('a top-up, seen from the WALLET\'s statement (money in)');
  let c = candidateOf(srow('Nap tien vao vi tu TESTBANK', 2000000, { fromName: 'TESTBANK' }), WALLET);
  ok(c._xfer === true && c.isIncome === false, 'pre-set as an internal transfer, as before', { _xfer: c._xfer, isIncome: c.isIncome });
  ok(c._xferDir === 'in', 'and it now says which way the money moved', c._xferDir);
  c._xferOtherId = 'acct-bank';                       // the person answers "Chuyển từ đâu?"
  let specs = await promote(c, 'acct-wallet');
  ok(specs.length === 2 && specs.every((s) => s.kind === 'transfer'), 'one transfer pair', specs.map((s) => s.kind));
  ok(legOf(specs, 'acct-wallet') === 2000 && legOf(specs, 'acct-bank') === -2000,
    'the wallet leg is +, the bank leg is − (was the other way round)', { wallet: legOf(specs, 'acct-wallet'), bank: legOf(specs, 'acct-bank') });

  delete c._xferOtherId;
  specs = await promote(c, 'acct-wallet');
  ok(specs.length === 1 && specs[0].amt === 2000, 'with no counterpart picked, the single wallet leg is still +', specs.map((s) => s.amt));

  console.log('\nthe same event, seen from the BANK\'s statement (money out)');
  c = candidateOf(srow('Nap tien vao vi MoMo', -2000000), BANK);
  ok(c._xfer === true && c._xferDir === 'out', 'a transfer, going out', { _xfer: c._xfer, _xferDir: c._xferDir });
  c._xferOtherId = 'acct-wallet';
  specs = await promote(c, 'acct-bank');
  ok(legOf(specs, 'acct-bank') === -2000 && legOf(specs, 'acct-wallet') === 2000, 'the bank leg is −, the wallet leg is +, unchanged');

  console.log('\nrows the statement did not mark');
  c = candidateOf(srow('SYNTHETIC COFFEE SHOP', -45000), BANK);
  ok(c._xferDir === undefined, 'an ordinary purchase carries no transfer direction');
  c = candidateOf(srow('NGUOI GUI TEST chuyen khoan', 300000), BANK);
  ok(c._xferDir === undefined && c.isIncome === true, 'an ordinary credit is still income, direction on isIncome as ever');

  console.log('\nevery reader asks the same question');
  const reads56 = (SRC56.match(/c\.isIncome \|\| c\._xferDir === 'in'/g) || []).length;
  ok(reads56 >= 6, 'the review card: kinds, repay question and both "from/to where" titles', reads56);
  ok(/var _moneyIn = !!c\.isIncome \|\| c\._xferDir === 'in';/.test(SRC72), 'promote signs from the same test');

  console.log(failed ? '\n' + failed + ' failed' : '\nall passed');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
