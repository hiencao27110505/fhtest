#!/usr/bin/env node
/* The fields the email path never filled reach the writer.
 * `node tools/promote-v2-fields.test.js`
 *
 * The ledger has had a place for each of these and an emailed row never used it
 * (email-reading-v2-spec §2, "Attributes the email path never fills"):
 *
 *   - the counterparty on income, transfer and investment rows (counterparty_enc);
 *   - the COUNTERPART ACCOUNT of a transfer: a signal-matched account now arrives
 *     pre-filled on the candidate, and the promote path writes the pair;
 *   - a loan's due date, and a loan that is money IN (a lender's disbursement),
 *     which is a payable: −X, not the +X of money lent;
 *   - an investment's position and quantity;
 *   - a printed fee: its own small expense on the same account, written in the
 *     SAME insert as its parent and retired with it;
 *   - the tree node on the four kinds that never carried one, for v2 rows only.
 *
 * And a v1 candidate writes exactly the specs it always wrote, plus the
 * counterparty it always had.
 *
 * Real functions extracted from source by name, collaborators stubbed.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'src/js-data/72-txn-review.js'), 'utf8');
const CSVUI = fs.readFileSync(path.join(ROOT, 'src/js-ui/56-csv-import-ui.js'), 'utf8');
const PERS = fs.readFileSync(path.join(ROOT, 'src/js-data/19-personal.js'), 'utf8');

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

const REAL = [
  grab(SRC, 'async function _fhPromoteStagedRun('),
  grab(SRC, 'window.fhStagedRowTime = function (c)') + ';',
  grab(CSVUI, 'function csvRowTime('),
].join('\n');
const KINDS = { bankbank: 'transfer', wage: 'income', stock: 'investment', bankloan: 'loan', pay: 'repayment', bankfees: 'expense', fresh: 'expense' };

async function specsFor(cand, rawX) {
  let captured = null;
  const ctx = {
    console: { warn() {}, log() {} },
    crypto: { randomUUID: (() => { let n = 0; return () => 'gid-' + (++n); })() },
    L: (vi) => vi, toast: () => {},
    FH_TAX: { get: (c) => (KINDS[c] ? { code: c } : null), kindOf: (c) => KINDS[c] || null },
    _fhStagedRows: [{ id: 'staged-1', occurred_at: '2026-08-20T07:05:00Z', raw_extracted: rawX || {} }],
    csvReview: { ready: [cand] },
    csvStagedSelected: () => [cand],
    csvRowScope: () => 'personal',
    csvBaseAmt: (n) => Math.round(Number(n) / 1000),
    fhStagedIdsForResolved: () => [],
    fhStagedSource: () => 'direct-email',
    fhStagedAcct: () => ({ kind: 'deposit', provider: 'testbank', tail: '0001' }),
    fhStagedRawX: () => rawX || {},
    fhPersonalData: () => ({ accounts: [{ id: 'acct-own', kind: 'deposit' }, { id: 'acct-other', kind: 'deposit' }, { id: 'acct-card', kind: 'credit_card' }] }),
    fhPersonalAccountEnsure: async () => 'acct-own',
    fhResolveRepaidCard: () => 'acct-card',
    fhPersonalAddMany: async (specs) => { captured = specs; return { ok: false, written: 0 }; },
    _stagedResolve: async () => {}, _stagedRetiredAdd: () => {},
    _txrLoadShow: () => {}, _txrLoadMsg: () => {}, _txrYield: async () => {},
    _txrHeld: false,
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(REAL, ctx);
  await vm.runInContext('_fhPromoteStagedRun()', ctx);
  return captured || [];
}
const base = { rowIndex: 0, amount: 250000, description: 'synthetic row', dateDisplay: '2026-08-20', counterparty: 'SYNTHETIC PARTY' };

(async () => {
  console.log('the counterparty rides to the kinds that dropped it');
  {
    let s = await specsFor(Object.assign({}, base, { isIncome: true, _incomeCat: 'Lương' }));
    ok(s.length === 1 && s[0].kind === 'income' && s[0].who === 'SYNTHETIC PARTY' && s[0].catName === 'Lương', 'income', s);
    s = await specsFor(Object.assign({}, base, { _xfer: true, _xferOtherId: 'acct-other' }));
    ok(s.length === 2 && s.every((x) => x.kind === 'transfer' && x.who === 'SYNTHETIC PARTY'), 'both legs of a transfer', s.map((x) => x.who));
    ok(s[0].accountId === 'acct-own' && s[1].accountId === 'acct-other' && s[0].amt === -250 && s[1].amt === 250 && s[0].transferGroupId === s[1].transferGroupId,
      '...and a PRE-FILLED counterpart writes the pair: out of the captured account, into the matched one', s.map((x) => [x.accountId, x.amt]));
    s = await specsFor(Object.assign({}, base, { _invest: true, _investPosId: 'pos-1', _investQty: 300 }));
    ok(s.length === 1 && s[0].kind === 'investment' && s[0].who === 'SYNTHETIC PARTY' && s[0].positionId === 'pos-1' && s[0].qty === 300 && s[0].amt === -250,
      'an investment buy: position, quantity, and the broker beside the note', s);
    s = await specsFor(Object.assign({}, base, { _invest: true, _investPosId: 'pos-1', _investQty: 100, isIncome: true }));
    ok(s[0].amt === 250 && s[0].qty === -100, 'a sell: money in, quantity out', [s[0].amt, s[0].qty]);
    s = await specsFor(Object.assign({}, base, { counterparty: '   ' , isIncome: true }));
    ok(s[0].who === null, 'a blank counterparty is no counterparty, never the description', s[0].who);
  }

  console.log('\nloans: the due date, and money borrowed');
  {
    let s = await specsFor(Object.assign({}, base, { _loan: true, _loanWho: 'Person A', _loanDue: '2026-09-25' }));
    ok(s.length === 1 && s[0].kind === 'loan' && s[0].amt === 250 && s[0].dueDate === '2026-09-25' && s[0].who === 'Person A', 'money lent: +X, with its due date (as before)', s);
    s = await specsFor(Object.assign({}, base, { _loan: true, _loanWho: 'SYNTHETIC FINANCE', _loanDue: '2026-09-25', isIncome: true }));
    ok(s.length === 1 && s[0].kind === 'loan' && s[0].amt === -250 && s[0].dueDate === '2026-09-25', 'money BORROWED (a disbursement, money in): −X, a payable', s);
    s = await specsFor(Object.assign({}, base, { _repay: true, _repayWho: 'SYNTHETIC FINANCE' }));
    ok(s[0].kind === 'repayment' && s[0].amt === -250 && s[0].who === 'SYNTHETIC FINANCE', 'an instalment paid: −X against that lender', s);
  }

  console.log('\nthe printed fee');
  {
    let s = await specsFor(Object.assign({}, base, { _v2: true, _xfer: true, _xferOtherId: 'acct-other', _fee: { amount: 1100, on: true, node: 'bankfees' } }));
    ok(s.length === 3 && s[2].kind === 'expense' && s[2].amt === 1 && s[2].accountId === 'acct-own' && s[2].node === 'bankfees' && s[2].withPrev === true,
      'a transfer with a fee: the clean pair, then one small expense on the SAME account, glued to it', s.map((x) => [x.kind, x.amt, x.accountId, x.withPrev]));
    ok(s[2].time === s[0].time && s[2].dateIso === s[0].dateIso && s[2].source === s[0].source, '...same day, time and source as its parent');
    s = await specsFor(Object.assign({}, base, { _v2: true, _fee: { amount: 1100, on: false, node: 'bankfees' } }));
    ok(s.length === 1 && s[0].kind === 'expense', 'a fee left unticked writes nothing', s.map((x) => x.kind));
    s = await specsFor(Object.assign({}, base, {}));
    ok(s.length === 1, 'and a row with no fee is one row, as ever');

    /* The writer: a glued spec never crosses a chunk boundary. */
    const inserts = [];
    const ctx = { console: { warn() {} } };
    ctx.window = ctx;
    ctx.P = { uid: 'u', key: 'k' };
    ctx._encP = async (v) => 'e:' + v; ctx._okTime = (t) => t || null; ctx._okNode = (n) => !!n; ctx._localDate = () => '2026-08-20';
    ctx._sb = () => ({ from: () => ({ insert: async (rows) => { inserts.push(rows.length); return { error: null }; } }) });
    ctx.fhPersonalHydrate = async () => {};
    vm.createContext(ctx);
    vm.runInContext(grab(PERS, 'window.fhPersonalAddMany = async function (specs, onChunk)') + ';', ctx);
    const specs = [];
    for (let i = 0; i < 49; i++) specs.push({ kind: 'expense', amt: 1 });
    specs.push({ kind: 'expense', amt: 5 });                       // spec #50: the parent, last of the first chunk
    specs.push({ kind: 'expense', amt: 1, withPrev: true });       // its fee
    specs.push({ kind: 'expense', amt: 2 });
    ctx.__s = specs;
    const res = await vm.runInContext('fhPersonalAddMany(__s)', ctx);
    ok(res.ok && res.written === 52 && JSON.stringify(inserts) === '[51,1]', 'parent #50 and its fee land in ONE insert (51 + 1), never 50 + 2', inserts);
  }

  console.log('\nthe node, on the kinds that never carried one');
  {
    let s = await specsFor(Object.assign({}, base, { _v2: true, _xfer: true, _xferOtherId: 'acct-other', _node: 'bankbank' }));
    ok(s.every((x) => x.node === 'bankbank'), 'a v2 transfer carries its node on both legs', s.map((x) => x.node));
    s = await specsFor(Object.assign({}, base, { _xfer: true, _xferOtherId: 'acct-other', _node: 'bankbank' }));
    ok(s.every((x) => !x.node), 'a v1 transfer writes what it always wrote: no node', s.map((x) => x.node));
    s = await specsFor(Object.assign({}, base, { _v2: true, _loan: true, _loanWho: 'X', isIncome: true, _node: 'bankloan' }));
    ok(s[0].node === 'bankloan', 'a v2 loan', s[0].node);
    s = await specsFor(Object.assign({}, base, { _v2: true, _repay: true, _node: 'pay' }));
    ok(s[0].node === 'pay', 'a v2 repayment', s[0].node);
    s = await specsFor(Object.assign({}, base, { _v2: true, _invest: true, _investPosId: 'pos-1', _node: 'stock' }));
    ok(s[0].node === 'stock', 'a v2 investment', s[0].node);
    s = await specsFor(Object.assign({}, base, { _v2: true, _invest: true, _investPosId: 'pos-1', _node: 'fresh' }));
    ok(!s[0].node, 'still guarded by kind: an expense node never rides an investment row', s[0].node);
  }

  console.log('\nthe family path writes the fee too');
  {
    const body = grab(CSVUI, 'function csvPromote(');
    ok(/fc\._fee\.on/.test(body) && /node: fc\._fee\.node \|\| null/.test(body) && /bulkRows = withFees;/.test(body), 'csvPromote adds the fee row right after its parent');
    ok(/if\(csvStagedMode\)\{\s*var withFees/.test(body), '...for staged rows only: a file import has no fee field');
  }

  console.log(failed ? '\n' + failed + ' failed' : '\nall passed');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
