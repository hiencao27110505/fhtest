#!/usr/bin/env node
/* Never dump a row in the catch-all just because seeding has not run.
 * `node tools/label-fallback-root.test.js`
 *
 * A person whose partition is nothing but a catch-all (the empty-ledger hole in
 * fhPersonalLabelsEnsureDefaults: 240 rows, one personal_labels row) had every
 * row on every surface resolve to that one label. The seed is fixed, but the
 * rows already written must read correctly with no migration and nothing
 * rewritten, so the rescue is at DISPLAY time: while the partition is bare, a
 * row is shown under its own node's ROOT, named by the tree.
 *
 * The rules it must obey, because it is standing in for a person's own filing:
 *   - a real partition answers for itself, always;
 *   - a row whose label already says something keeps it;
 *   - a row with no node stays in the catch-all (it really is unplaced);
 *   - it writes nothing, ever;
 *   - fh-tree=off restores the old view along with everything else (C8).
 *
 * The real helper from 13-partition.js and the real _pBuildTxnCtx from
 * 60-transactions.js, on the real tree.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ROOT = path.join(__dirname, '..');

let pass = 0, fail = 0;
const t = (n, ok, d) => { console.log((ok ? '  PASS  ' : '  FAIL  ') + n + (!ok && d !== undefined ? '  -> ' + JSON.stringify(d) : '')); ok ? pass++ : fail++; };

function grab(src, header) {
  const at = src.indexOf(header);
  if (at < 0) throw new Error('not found in source: ' + header + ' — renamed?');
  let i = src.indexOf('{', at), depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (!depth) break; }
  }
  return src.slice(at, i + 1);
}
const TXN = fs.readFileSync(path.join(ROOT, 'src/js-ui/60-transactions.js'), 'utf8');
const PERS_UI = fs.readFileSync(path.join(ROOT, 'src/js-ui/21-personal.js'), 'utf8');

/* One app, one person's ledger. `labels` is P.labels; `txns` are personal rows
   in the shape hydrate leaves them. `treeOff` flips the C8 kill switch. */
function app(state) {
  const store = state.treeOff ? { 'fh-tree': 'off' } : {};
  const ctx = {
    console: { warn() {}, log() {} }, L: (vi) => vi,
    localStorage: { getItem: (k) => (k in store ? store[k] : null), setItem(k, v) { store[k] = v; } },
    TODAY: new Date('2026-09-20T00:00:00'),
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'src/js-ui/11-taxonomy.js'), 'utf8'), ctx);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'src/js-ui/13-partition.js'), 'utf8'), ctx);
  vm.runInContext('var CAT_FALLBACK = "Others";'
    + 'function isFallbackCat(n){ return String(n||"").trim().toLowerCase()==="others"; }', ctx);
  ctx.fhPersonalData = () => ({ txns: state.txns || [], txnsOld: [], accounts: [], debts: [],
    labels: state.labels || [], catBudget: {} });
  vm.runInContext(grab(TXN, 'function _pBuildTxnCtx('), ctx);
  return ctx;
}
/* Rows of THIS month, so they reach the hero totals the same way the app's do. */
const MONTH = '2026-09';
const row = (o) => Object.assign({ id: 'r' + Math.random(), kind: 'expense', date: MONTH + '-10',
  amt: 100, note: 'x', emoji: '🗂️' }, o);
const BARE = [{ id: 'lab-khac', name: 'Khác', emoji: '🗂️', claims: ['*'] }];
const REAL_PARTITION = [
  { id: 'lab-food', name: 'Ăn uống', emoji: '🍽️', claims: ['food'] },
  { id: 'lab-khac', name: 'Khác', emoji: '🗂️', claims: ['*'] },
];

console.log('\n-- the helper, on its own --');
{
  const a = app({ labels: BARE, txns: [] });
  t('a bare partition is recognised', a.fhPersonalPartitionBare() === true);
  t('...and so is no partition at all', a.fhPersonalPartitionBare([]) === true);
  t('one real claim and it is not bare any more',
    a.fhPersonalPartitionBare(REAL_PARTITION) === false);

  const r = a.fhPersonalRowLabel({ cat: 'Others', node: 'coffee' });
  t('a row in the catch-all is shown under its node\'s ROOT, named by the tree',
    !!r && r.name === 'Ăn uống' && r.emoji === '🍽️', r);
  t('the Vietnamese catch-all name counts as the catch-all too',
    (a.fhPersonalRowLabel({ cat: 'Khác', node: 'ridehail' }) || {}).name === 'Đi lại');
  t('an unlabelled row is rescued as well',
    (a.fhPersonalRowLabel({ cat: '', node: 'electric' }) || {}).name === 'Nhà ở & hoá đơn');
  t('a row with NO node stays in the catch-all: it really is unplaced',
    a.fhPersonalRowLabel({ cat: 'Others', node: null }) === null);
  t('a node the running tree does not know is not invented either',
    a.fhPersonalRowLabel({ cat: 'Others', node: 'nosuchcode' }) === null);
  t('a row whose label says something keeps it',
    a.fhPersonalRowLabel({ cat: 'Đi chợ', node: 'coffee' }) === null);
  t('a transfer row is named by its own root, not forced into an expense group',
    (a.fhPersonalRowLabel({ cat: 'Others', node: 'cardpay' }) || {}).name === 'Trả nợ thẻ tín dụng');
}
{
  const a = app({ labels: REAL_PARTITION, txns: [] });
  t('with a REAL partition the rescue stands down entirely',
    a.fhPersonalRowLabel({ cat: 'Others', node: 'coffee' }) === null);
}
{
  const a = app({ labels: BARE, txns: [], treeOff: true });
  t('fh-tree=off restores the old view (C8)',
    a.fhPersonalRowLabel({ cat: 'Others', node: 'coffee' }) === null);
}

console.log('\n-- the breakdown the person actually reads --');
{
  const txns = [
    row({ cat: 'Others', node: 'coffee', amt: 60, emoji: '🗂️' }),
    row({ cat: 'Others', node: 'electric', amt: 40 }),
    row({ cat: 'Others', node: 'ridehail', amt: 25 }),
    row({ cat: 'Others', node: null, amt: 10 }),
  ];
  const a = app({ labels: BARE, txns: txns });
  a._pBuildTxnCtx();
  const c = a._pTxnCtx;
  t('the label view is no longer one bucket',
    c.catOrder.length === 4 && c.catOrder.indexOf('Ăn uống') >= 0 && c.catOrder.indexOf('Đi lại') >= 0,
    c.catOrder);
  t('every group carries its own money',
    c.catSpent['Ăn uống'] === 60 && c.catSpent['Nhà ở & hoá đơn'] === 40 && c.catSpent['Đi lại'] === 25,
    c.catSpent);
  t('the row with no node is still "Others", untouched', c.catSpent['Others'] === 10, c.catSpent);
  t('the tree\'s own emoji comes with the name',
    (c.catStyle['Ăn uống'] || [])[0] === '🍽️', c.catStyle['Ăn uống']);
  t('the rows in the list follow the same names',
    c.rows.filter((r) => r.cat === 'Ăn uống').length === 1
    && c.rows.filter((r) => r.cat === 'Others').length === 1, c.rows.map((r) => r.cat));
  t('both views still add up to the same money',
    Object.keys(c.catSpent).reduce((s, k) => s + c.catSpent[k], 0) === 135, c.catSpent);
  t('nothing was written back onto the ledger rows',
    txns.every((x) => x.cat === 'Others'), txns.map((x) => x.cat));
}
{
  // The same rows, once the person (or the fixed seed) has a real partition.
  const a = app({ labels: REAL_PARTITION, txns: [row({ cat: 'Ăn uống', node: 'coffee', amt: 60 })] });
  a._pBuildTxnCtx();
  t('a person with a real partition sees their own names, as always',
    a._pTxnCtx.catOrder.join() === 'Ăn uống', a._pTxnCtx.catOrder);
}

console.log('\n-- the other surface is wired to the same helper --');
t('"Tiền đi đâu tháng này" asks fhPersonalRowLabel too',
  /fhPersonalRowLabel/.test(PERS_UI));

console.log('\n' + (fail === 0 ? 'ALL ' + pass + ' PASSED' : pass + ' passed, ' + fail + ' FAILED'));
process.exit(fail ? 1 : 0);
