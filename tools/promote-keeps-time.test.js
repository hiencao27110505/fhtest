#!/usr/bin/env node
/* The email's clock time must reach the ledger on EVERY kind, not two of them.
 * `node tools/promote-keeps-time.test.js`
 *
 * _fhPromoteStagedRun turns each reviewed candidate into one or two row specs
 * for fhPersonalAddMany. The expense and income specs carried `time`; the specs
 * for an own-account transfer, a card payment, a loan, a repayment and an
 * investment did not, although the writer accepts it for any kind. So a bank
 * mail that said 14:05 landed as a day-only row on five kinds, and the ledger
 * lost the one fact that orders two same-day movements (email-reading-v2-spec
 * §2, §15 fix 3).
 *
 * The real function is pulled out of the source by name and run in a vm with
 * its collaborators stubbed; the writer stub records the specs and reports a
 * failed write, which is the shortest honest way out of the function. A source
 * with no time of day (stored at UTC midnight) must stay day-only: a fabricated
 * clock is worse than none.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'src/js-data/72-txn-review.js'), 'utf8');
const CSVUI = fs.readFileSync(path.join(ROOT, 'src/js-ui/56-csv-import-ui.js'), 'utf8');

let failed = 0;
function ok(cond, what, detail) {
  console.log((cond ? '  ok   ' : '  FAIL ') + what + (!cond && detail ? '  -> ' + detail : ''));
  if (!cond) failed++;
}

/* Pull a `function NAME(…){…}` / `window.NAME = function (…) {…}` out of the
   real file by brace matching. */
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

/* Two staged rows: one with a real bank moment, one day-only (UTC midnight is
   how a date-only source is stored). Synthetic values throughout. */
const WITH_TIME = '2026-08-20T07:05:00Z';
const DAY_ONLY = '2026-08-20T00:00:00Z';
const d = new Date(WITH_TIME);
const EXPECT = String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');

/* noSender: a card-side alert, where no sending account resolves and the payment
   books as the card's single leg. */
async function specsFor(cand, occurredAt, noSender) {
  let captured = null;
  const ctx = {
    console: { warn() {}, log() {} },
    crypto: { randomUUID: (() => { let n = 0; return () => 'gid-' + (++n); })() },
    L: (vi) => vi,
    toast: () => {},
    _fhStagedRows: [{ id: 'staged-1', occurred_at: occurredAt, raw_extracted: {} }],
    csvReview: { ready: [cand] },
    csvStagedSelected: () => [cand],
    csvRowScope: () => 'personal',
    csvBaseAmt: (n) => Math.round(Number(n) / 1000),
    fhStagedIdsForResolved: () => [],
    fhStagedSource: () => 'direct-email',
    fhStagedAcct: () => (noSender ? null : { kind: 'deposit', provider: 'testbank', tail: '0001' }),
    fhStagedRawX: () => ({}),
    fhPersonalData: () => ({ accounts: [
      { id: 'acct-own', kind: 'deposit' }, { id: 'acct-other', kind: 'deposit' },
      { id: 'acct-card', kind: 'credit_card' }] }),
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

const base = { rowIndex: 0, amount: 250000, description: 'synthetic row', dateDisplay: '2026-08-20' };
const KINDS = [
  ['own-account transfer (pair)', { _xfer: true, _xferOtherId: 'acct-other' }, 'transfer', 2],
  ['own-account transfer (one leg)', { _xfer: true }, 'transfer', 1],
  ['repayment', { _repay: true, _repayWho: 'Person A' }, 'repayment', 1],
  ['loan', { _loan: true, _loanWho: 'Person A' }, 'loan', 1],
  ['investment', { _invest: true, _investPosId: 'pos-1', _investQty: 2 }, 'investment', 1],
  ['card payment (pair)', { isTransfer: true }, 'transfer', 2],
  ['card payment (card only)', { isTransfer: true, _payCardId: 'acct-card' }, 'transfer', 1, true],
  ['expense (already worked)', {}, 'expense', 1],
  ['income (already worked)', { isIncome: true }, 'income', 1],
];

(async () => {
  console.log('promote — the email\'s time rides every kind');
  for (const [name, extra, kind, n, noSender] of KINDS) {
    const specs = await specsFor(Object.assign({}, base, extra), WITH_TIME, noSender);
    ok(specs.length === n && specs.every((s) => s.kind === kind),
      name + ': ' + n + ' ' + kind + ' spec(s)', JSON.stringify(specs.map((s) => s.kind)));
    ok(specs.length > 0 && specs.every((s) => s.time === EXPECT),
      name + ': every spec carries ' + EXPECT, JSON.stringify(specs.map((s) => s.time)));
  }

  console.log('\n-- a day-only source stays day-only --');
  for (const [name, extra, , , noSender] of KINDS) {
    const specs = await specsFor(Object.assign({}, base, extra), DAY_ONLY, noSender);
    ok(specs.length > 0 && specs.every((s) => !s.time),
      name + ': no time is invented', JSON.stringify(specs.map((s) => s.time)));
  }

  console.log('\n-- the person\'s own edit of the time wins --');
  {
    const specs = await specsFor(Object.assign({}, base, { _loan: true, _loanWho: 'Person A', time: '09:30' }), WITH_TIME);
    ok(specs.length === 1 && specs[0].time === '09:30', 'an edited time is what lands', JSON.stringify(specs.map((s) => s.time)));
    const cleared = await specsFor(Object.assign({}, base, { _repay: true, time: '' }), WITH_TIME);
    ok(cleared.length === 1 && !cleared[0].time, 'a time the person cleared stays cleared');
  }

  console.log(failed ? '\n' + failed + ' failed' : '\nall passed');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });

