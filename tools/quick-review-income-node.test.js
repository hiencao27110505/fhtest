#!/usr/bin/env node
/* An income row approved from the quick sheet must keep an INCOME node.
 * `node tools/quick-review-income-node.test.js`
 *
 * The quick sheet resolves a tree node once, when it opens, against the tree of
 * the row's kind. The kind was chosen with `flow === 'in'`, and flow is never
 * 'in': money in is 'income' (the line that sets it is a few lines above). So
 * every income row was resolved against the EXPENSE tree, and the write then
 * discarded the result two ways: _qrNode('income') rejects an expense node, and
 * the income write never passed a node at all, to a writer that had no field
 * for one (email-reading-v2-spec §15, smaller defects).
 *
 * Three links, each pinned: the kind test, the call that writes, the writer.
 * Real functions extracted from source by name; the real tree.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const QUICK = read('src/js-data/76-quick-review.js');
const PERSONAL = read('src/js-data/19-personal.js');

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

/* ── 1. the kind the sheet resolves against ────────────────────────────────── */
console.log('the sheet resolves an income row against the income tree');
{
  const call = (QUICK.match(/node:\s*_qrNodeFor\(re, desc, ([^)]*)\),/) || [])[1] || '';
  ok(!!call, 'found the QR.node call site', call);
  // Evaluate the real expression for each value `flow` can take.
  const kindFor = (flow) => new Function('flow', 'return (' + call + ');')(flow);
  ok(kindFor('income') === 'income', 'flow "income" -> the income tree', kindFor('income'));
  ok(kindFor('expense') === 'expense', 'flow "expense" -> the expense tree', kindFor('expense'));
  ok(!/flow === 'in'/.test(QUICK), 'nothing tests flow === \'in\', a value flow never has');
  // The value the test must match is the one the same function assigns.
  ok(/var flow = re\.flow \|\| \(re\.direction === 'credit' \? 'income' : 'expense'\)/.test(QUICK),
    'and "income" is still the word flow uses for money in');
}

/* ── 2. what that resolution returns, over the real tree ───────────────────── */
console.log('\n_qrNodeFor + _qrNode');
{
  const ctx = { console };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(read('src/js-ui/11-taxonomy.js'), ctx);
  vm.runInContext(read('src/js-ui/13-partition.js'), ctx);
  vm.runInContext('var QR = null;\n' + grab(QUICK, 'function _qrNodeFor(') + '\n' + grab(QUICK, 'function _qrNode('), ctx);
  const run = (code) => vm.runInContext(code, ctx);

  // A sealed income node (the server may seal one for any kind: spec §4).
  ctx.__re = { node: 'wage', counterparty: 'SYNTHETIC EMPLOYER', amount: 20000000 };
  const asIncome = run('_qrNodeFor(__re, "luong thang 8", "income")');
  const asExpense = run('_qrNodeFor(__re, "luong thang 8", "expense")');
  ok(asIncome === 'wage', 'resolved as income, the sealed income node stands', asIncome);
  ok(asExpense !== 'wage', 'resolved as expense (the old behaviour) it was thrown away', asExpense);

  run('QR = { node: ' + JSON.stringify(asIncome) + ' }');
  ok(run('_qrNode("income")') === 'wage', '_qrNode("income") hands it to the write');
  ok(run('_qrNode("expense")') === null, 'and an income node can never ride an expense write');
}

/* ── 3. the write passes it, and the writer stores it ──────────────────────── */
console.log('\nthe income write');
{
  const call = QUICK.slice(QUICK.indexOf('window.fhPersonalAddIncome(base'));
  const args = call.slice(0, call.indexOf(');'));
  ok(/node:\s*_qrNode\('income'\)/.test(args), 'quick review passes node: _qrNode(\'income\') to fhPersonalAddIncome', args);

  let inserted = null;
  const ctx = {
    console: { warn() {} },
    P: { uid: 'user-1', key: 'k' },
    FH_TAX: { get: (c) => (c === 'wage' ? { code: 'wage' } : null) },
    _encP: async (v) => 'enc(' + v + ')',
    _localDate: () => '2026-08-20',
    _sb: () => ({ from: () => ({ insert: async (row) => { inserted = row; return { error: null }; } }) }),
    fhPersonalHydrate: async () => {},
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(grab(PERSONAL, 'function _okNode(') + '\n'
    + PERSONAL.match(/const _okTime = .*;/)[0] + '\n'
    + grab(PERSONAL, 'window.fhPersonalAddIncome = async function') + ';', ctx);

  (async () => {
    await ctx.fhPersonalAddIncome(20000, 'luong thang 8', '2026-08-20', 'direct-email', { catName: 'Lương', node: 'wage', time: '09:15' });
    ok(inserted && inserted.node_enc === 'enc(wage)', 'fhPersonalAddIncome writes node_enc', inserted && inserted.node_enc);
    ok(inserted && inserted.kind === 'income' && inserted.occurred_time_enc === 'enc(09:15)', 'and the rest of the row is unchanged');

    await ctx.fhPersonalAddIncome(20000, 'x', '2026-08-20', null, { node: 'not-a-code' });
    ok(inserted && inserted.node_enc === null, 'a code the tree does not know is never written');

    await ctx.fhPersonalAddIncome(20000, 'x', '2026-08-20', null, { accountId: 'a1' });
    ok(inserted && inserted.node_enc === null && inserted.account_id === 'a1', 'a caller that passes no node (goals, the manual sheet) writes as before');

    console.log(failed ? '\n' + failed + ' failed' : '\nall passed');
    process.exit(failed ? 1 : 0);
  })().catch((e) => { console.error(e); process.exit(1); });
}
