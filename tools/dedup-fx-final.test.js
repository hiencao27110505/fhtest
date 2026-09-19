#!/usr/bin/env node
/* A card statement's FINAL amount vs the ESTIMATE already in the ledger.
 * `node tools/dedup-fx-final.test.js`
 *
 * A foreign card purchase is booked from its email at our estimated VND, and the
 * promote step says so in the note: "[20 USD @26,350 +3% est.]". Weeks later the
 * statement carries what the bank actually charged. The two differ by far more than
 * the engine's 1.000d window, so without the fx_final tier the same purchase arrives
 * again as a NEW row and the month counts it twice. The tier is deliberately narrow,
 * and every edge below is a way it must NOT fire.
 * (docs/specs/statement-capture-spec.md section 3.4)
 */
const fs = require('fs');
const path = require('path');
var window = { txns: [], DB: { ownerMemberId: 'me' } };
var curMult = function(){ return 1000; };
eval(fs.readFileSync(path.join(__dirname, '..', 'src', 'js-ui', '58-dedup-engine.js'), 'utf8'));

let pass = 0, fail = 0;
const t = (n, ok, d) => { console.log((ok ? '  PASS  ' : '  FAIL  ') + n + (!ok && d !== undefined ? '  -> ' + JSON.stringify(d) : '')); ok ? pass++ : fail++; };
const per = (o) => Object.assign({ id: 'p' + Math.random(), date: o.day, kind: o.kind || 'expense', amt: o.amtD / 1000, note: o.note || '', link: null, src: 'direct-email', time: '' }, o);
const cand = (o) => ({ amount: o.amount, date: new Date(o.day + 'T00:00:00'), dateDisplay: o.day, time: '', description: o.desc || '', counterparty: '',
  isIncome: !!o.income, isTransfer: false, accountKind: 'credit_card', provider: 'VIB', kind: 'bank', currency: 'VND', shape: 'bank_txn', statement: o.statement !== false });
const run = (c, personal) => { window.txns = []; window._fhPersonalMatchSlice = personal; return fhDedupAssess([c], fhDedupLedgerIndex(), {})[0]; };

const EST = 'OPENAI *CHATGPT [20 USD @26,350 +3% est.]';
console.log('\n-- fires: a statement row against a booked ESTIMATE --');
var v = run(cand({ amount: 527400, day: '2026-08-14', desc: 'Mua Hàng / OPENAI *CHATGPT' }), [per({ day: '2026-08-13', amtD: 542810, note: EST })]);
t('matched as sure, why fx_final', v && v.tier === 'sure' && v.why === 'fx_final', v && { tier: v.tier, why: v.why });
t('the booked row is the evidence', v && v.twin && v.twin.book === 'personal' && Math.round(v.twin.amtD) === 542810);
t('the shared merchant word is reported', v && v.shared === 'openai', v && v.shared);

console.log('\n-- must NOT fire --');
v = run(cand({ amount: 527400, day: '2026-08-14', desc: 'Mua Hàng / OPENAI *CHATGPT', statement: false }), [per({ day: '2026-08-13', amtD: 542810, note: EST })]);
t('an EMAIL row never gets this tier: only a statement carries a final figure', !v || v.why !== 'fx_final');
v = run(cand({ amount: 527400, day: '2026-08-14', desc: 'Mua Hàng / OPENAI *CHATGPT' }), [per({ day: '2026-08-13', amtD: 542810, note: 'OPENAI *CHATGPT' })]);
t('a booked row that does NOT say it is an estimate', !v);
v = run(cand({ amount: 527400, day: '2026-08-14', desc: 'Mua Hàng / NETFLIX.COM' }), [per({ day: '2026-08-13', amtD: 542810, note: EST })]);
t('a different merchant, however close the amount', !v);
v = run(cand({ amount: 527400, day: '2026-08-14', desc: 'Mua Hàng / OPENAI *CHATGPT' }), [per({ day: '2026-08-13', amtD: 610000, note: EST })]);
t('more than 6% apart', !v);
v = run(cand({ amount: 527400, day: '2026-08-25', desc: 'Mua Hàng / OPENAI *CHATGPT' }), [per({ day: '2026-08-13', amtD: 542810, note: EST })]);
t('more than a few days apart: next month\'s subscription is a new purchase', !v);
v = run(cand({ amount: 527400, day: '2026-08-14', desc: 'Mua Hàng / OPENAI *CHATGPT', income: true }), [per({ day: '2026-08-13', amtD: 542810, note: EST })]);
t('a refund is not the purchase', !v);
v = run(cand({ amount: 20, day: '2026-08-14', desc: 'Mua Hàng / USD SHOP' }), [per({ day: '2026-08-13', amtD: 20, note: 'USD SHOP [20 USD @26,350 +3% est.]' })]);
t('the currency code inside the tag is not a "shared merchant word"', !v || v.why !== 'fx_final', v && v.why);

console.log('\n-- an exact match still wins over it --');
v = run(cand({ amount: 542810, day: '2026-08-13', desc: 'Mua Hàng / OPENAI *CHATGPT' }), [per({ day: '2026-08-13', amtD: 542810, note: EST })]);
t('same amount, same day, same merchant stays exact_merchant', v && v.why === 'exact_merchant', v && v.why);

console.log('\n' + (fail ? fail + ' FAILED, ' : 'ALL ') + pass + ' PASSED');
process.exit(fail ? 1 : 0);
