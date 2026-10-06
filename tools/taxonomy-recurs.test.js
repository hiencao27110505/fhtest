/* recurring-charges-spec §18.4 — the tree's recurring leaves are a CLIENT-ONLY
   hint: FH_TAX.recursOf answers on the device, and the worker's and the Python
   reader's generated files carry neither key (so a change to the list never
   forces an Edge Function redeploy). */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.join(__dirname, '..');
const rd = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
let failed = 0;
function t(name, ok, detail) { console.log((ok ? '  PASS  ' : '  FAIL  ') + name + (ok ? '' : '  -> ' + JSON.stringify(detail))); if (!ok) failed++; }

const w = {}; vm.runInNewContext(rd('src/js-ui/11-taxonomy.js'), { window: w });
const T = w.FH_TAX;
const src = JSON.parse(rd('taxonomy/taxonomy.json'));
const flagged = src.nodes.filter((n) => n.recurs).map((n) => n.code).sort();

console.log('\n-- the list --');
t('nine leaves carry recurs', flagged.join(',') === 'electric,insurance,internet,mgmt,rentpay,software,streaming,tuition,waterbill', flagged);
t('every one is an expense node with a known period', src.nodes.filter((n) => n.recurs).every((n) => n.kind === 'expense' && ['monthly', 'yearly'].indexOf(n.recurs) >= 0));
t('recurs_var only beside recurs', src.nodes.filter((n) => n.recurs_var).every((n) => n.recurs && n.recurs_var === true));
t('top-ups, gyms, food and rides are deliberately absent', ['mobile', 'gym', 'coffee', 'ridehail'].every((c) => !src.nodes.find((n) => n.code === c) || !src.nodes.find((n) => n.code === c).recurs));

console.log('\n-- the client answers --');
t('rent: monthly, steady', JSON.stringify(T.recursOf('rentpay')) === '{"code":"rentpay","period":"monthly","variable":false}', T.recursOf('rentpay'));
t('electricity: monthly, the amount moves', T.recursOf('electric').variable === true);
t('a child inherits from its nearest flagged ancestor', (function () { const kid = src.nodes.find((n) => n.parent === 'insurance'); return !kid || (T.recursOf(kid.code) && T.recursOf(kid.code).code === 'insurance' && T.recursOf(kid.code).period === 'yearly'); })());
t('an ordinary leaf answers null', T.recursOf('coffee') === null && T.recursOf('nope') === null && T.recursOf(null) === null);

console.log('\n-- the server targets carry neither key --');
const worker = rd('supabase/functions/_shared/mailbox/taxonomy.mjs');
t('worker taxonomy.mjs has no recurs / recurs_var / recursOf', worker.indexOf('"recurs"') < 0 && worker.indexOf('recurs_var') < 0 && worker.indexOf('recursOf') < 0);
const py = fs.readdirSync(path.join(ROOT, 'earthy', 'serverless', 'functions', 'transaction-parser', 'parser')).indexOf('taxonomy.py') >= 0
  ? rd('earthy/serverless/functions/transaction-parser/parser/taxonomy.py') : '';
t('python taxonomy.py has no recurs', py.indexOf('recurs') < 0);
t('the worker still has every node', (worker.match(/"code":"/g) || []).length === src.nodes.length, (worker.match(/"code":"/g) || []).length);

if (failed) { console.log('\n' + failed + ' FAILED'); process.exit(1); }
console.log('\nall passed');
