#!/usr/bin/env node
/* The bank-email menu gate is fail-closed. That is the whole property, and it is
 * invisible in review — a gate that reveals on every answer looks identical to
 * one that reveals on `true`. So it is asserted here instead.
 *
 * `node tools/mailbox-gate.test.js`
 *
 * The real function is extracted from 73-mailbox-gate.js by name, not copied, so
 * these tests fail if someone loosens the check rather than passing against a
 * stale duplicate.
 *
 * What must hold: the rows appear on `true` and on nothing else. A false, a
 * thrown RPC (a database without 0067), a null, or a truthy non-`true` all leave
 * the feature invisible. Being wrong in that direction costs a menu row; being
 * wrong in the other direction puts a stranger's bank mail in our inbox.
 */
// NOT 'use strict': the eval'd declarations must land in the harness scope.
const fs = require('fs');
const path = require('path');

const SRC_FILE = path.join(__dirname, '..', 'src', 'js-data', '73-mailbox-gate.js');
const src = fs.readFileSync(SRC_FILE, 'utf8');

/* Take everything from the row list down to the end of _mailboxGateApply. The
   boot waiter below it is deliberately excluded — it depends on timers and on
   window, and it is not what carries the security-relevant decision. */
const start = src.indexOf('var _MB_GATE_ROWS');
const end = src.indexOf('/* Waits for hydrate');
if (start < 0 || end < 0) {
  console.error('FAIL: could not find the gate in ' + SRC_FILE + ' — did it get renamed?');
  process.exit(1);
}
const GATE_SRC = src.slice(start, end);

let pass = 0, fail = 0;
const t = (n, ok, d) => {
  console.log((ok ? '  PASS  ' : '  FAIL  ') + n + (!ok && d ? '  -> ' + d : ''));
  ok ? pass++ : fail++;
};

/* A DOM with just enough surface for the gate: rows start hidden, exactly as
   index.html ships them. */
function fakeDom(ids) {
  const els = {};
  ids.forEach((id) => { els[id] = { id: id, style: { display: 'none' } }; });
  return {
    getElementById: (id) => (Object.prototype.hasOwnProperty.call(els, id) ? els[id] : null),
    shown: () => Object.keys(els).filter((id) => els[id].style.display === ''),
    hidden: () => Object.keys(els).filter((id) => els[id].style.display === 'none'),
  };
}

/* Instantiate the real gate against a given RPC and DOM. The eval'd source
   closes over these locals, so `document` and `_rpc` resolve to the fakes. */
function makeGate(rpcImpl, document) {
  let calls = 0;
  const _rpc = function (name) { calls++; return rpcImpl(name); };
  // eslint-disable-next-line no-eval
  const api = eval(GATE_SRC + ';({ apply: _mailboxGateApply, done: () => _mbGateDone, rows: _MB_GATE_ROWS })');
  api.calls = () => calls;
  return api;
}

const ALL_ROWS = ['set-autotxn-row', 'set-mailbox-row', 'set-review-row'];

(async () => {
  console.log('\n-- every row of the feature is gated, not just the connect one --');
  {
    const g = makeGate(async () => true, fakeDom([]));
    t('the gate knows about every row', g.rows.length === ALL_ROWS.length &&
      ALL_ROWS.every((id) => g.rows.indexOf(id) >= 0),
      JSON.stringify(g.rows));
  }

  console.log('\n-- an allowlisted account sees the feature --');
  {
    const dom = fakeDom(ALL_ROWS);
    const g = makeGate(async () => true, dom);
    await g.apply();
    t('every row is revealed', dom.shown().length === ALL_ROWS.length, JSON.stringify(dom.shown()));
    t('and the gate latches so a second boot costs no RPC', g.done() === true);
    await g.apply();
    t('a repeat call really does not re-query', g.calls() === 1, 'calls=' + g.calls());
  }

  console.log('\n-- everything else leaves the feature invisible --');
  const CLOSED = [
    ['a plain refusal (not on the allowlist)', async () => false],
    ['the RPC throwing — a database without 0067 applied', async () => { throw new Error('function does not exist'); }],
    ['a network failure mid-boot', async () => { throw new TypeError('Failed to fetch'); }],
    ['null, which PostgREST can return for a null-returning function', async () => null],
    ['undefined, if the response shape ever changes', async () => undefined],
    ['the STRING "true" — truthy, but not an answer', async () => 'true'],
    ['an empty object — truthy, and meaningless', async () => ({})],
    ['the number 1', async () => 1],
  ];
  for (const [name, rpc] of CLOSED) {
    const dom = fakeDom(ALL_ROWS);
    const g = makeGate(rpc, dom);
    await g.apply();
    t(name, dom.hidden().length === ALL_ROWS.length && g.done() === false, 'shown=' + JSON.stringify(dom.shown()));
  }

  console.log('\n-- a partly-rendered or older shell must not lock the gate open --');
  {
    const dom = fakeDom([]);            // rows not in the DOM yet
    const g = makeGate(async () => true, dom);
    await g.apply();
    t('with no rows present it does not latch done', g.done() === false);
    t('and it does not spend an RPC call on nothing', g.calls() === 0, 'calls=' + g.calls());
  }
  {
    // An older cached shell that has the connect row but not yet the review id.
    const dom = fakeDom(['set-mailbox-row']);
    const g = makeGate(async () => true, dom);
    await g.apply();
    t('one row present: it is revealed, and the missing one is not a crash',
      dom.shown().length === 1 && dom.shown()[0] === 'set-mailbox-row', JSON.stringify(dom.shown()));
  }

  console.log('\n' + (fail === 0 ? 'ALL ' + pass + ' PASSED' : pass + ' passed, ' + fail + ' FAILED'));
  process.exit(fail ? 1 : 0);
})();
