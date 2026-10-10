#!/usr/bin/env node
/* The background sweeps converge instead of running all session (device-heat
 * fix, 2026-10-10). `node tools/heat-sweep-converge.test.js`
 *
 * Three sweeps run behind every hydrate, and a hydrate fires on realtime, on
 * focus and after every write. Each used to start over from nothing:
 *   - the tree backfill (28) kept its progress on the row objects a hydrate
 *     replaces, re-filtered the whole ledger per slice and deburred every row
 *     with a node every time, so it never reached the end;
 *   - the recurrence pass (29) re-analysed 760 days of rows whether or not a
 *     single one had changed;
 *   - the lessons blob (24) was encrypted and upserted on every queue open and
 *     every quick-review attempt, changed or not.
 * Run against the real modules with fakes for the ledger, the tree and the
 * server.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const rd = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

let pass = 0, fail = 0;
const t = (n, ok, d) => { console.log((ok ? '  PASS  ' : '  FAIL  ') + n + (!ok && d !== undefined ? '  -> ' + JSON.stringify(d) : '')); ok ? pass++ : fail++; };
const tick = () => new Promise((r) => setImmediate(r));

/* ── the tree backfill ──────────────────────────────────────────────────── */
function backfillHarness() {
  const store = {}, timers = [], writes = [];
  let deburrs = 0;
  const rows = [];
  for (let i = 0; i < 100; i++) rows.push({ id: 'cafe' + i, kind: 'expense', note: 'Cafe sang ' + i, cat: 'Khác', amt: 35, node: null });
  for (let i = 0; i < 150; i++) rows.push({ id: 'deep' + i, kind: 'expense', note: 'HIGHLANDS COFFEE ' + i, cat: 'Ăn uống', amt: 55, node: 'coffee' });
  for (let i = 0; i < 50; i++) rows.push({ id: 'dark' + i, kind: 'expense', note: 'xq ' + i, cat: 'Khác', amt: 10, node: null });
  const P = { uid: 'u1', key: 'k', state: 'ready', txns: rows, labels: [] };
  const ctx = {
    console, Promise, Map, Set, Math, Number, String, Date, Object, Array,
    localStorage: { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } },
    setTimeout: (fn) => { timers.push(fn); return timers.length; },
    FH_TAX: { get: (code) => (code ? { code, depth: code === 'coffee' ? 3 : 1 } : null) },
    fhTreeOn: () => true,
    fhNodeFromClaims: () => null, fhDefaultClaimsFor: () => null,
    fhNodeGuess: (inp) => (/cafe/i.test(inp.note || '') ? 'coffee' : null),
    fhTransferShape: () => null, fhWhoNode: () => null, fhNodeDisplaced: () => false,
    fhPipeNodeOk: (node) => { deburrs++; return node; },           // every node still stands: nothing retired
    curMult: () => 1000,
    fhPersonalData: () => P,
    fhPersonalSetNode: async (id, node) => { writes.push([id, node]); return true; },
    txns: [],
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(rd('src/js-data/28-tree-backfill.js'), ctx);
  const drain = async (n) => { let k = 0; while (timers.length && (n == null || k < n)) { timers.shift()(); k++; await tick(); await tick(); } return k; };
  return { ctx, P, store, timers, writes, drain, deburrs: () => deburrs };
}

/* ── the recurrence pass ────────────────────────────────────────────────── */
function recurHarness() {
  const ctx = { console, Date, JSON, Object, String, Promise, Math, Number, Array, Map, Set, isFinite, paints: [] };
  ctx.window = ctx; ctx.TODAY = new Date(2026, 9, 7);
  ctx.fhRecurPainted = (scope) => ctx.paints.push(scope);
  vm.createContext(ctx);
  vm.runInContext(rd('src/js-ui/11-taxonomy.js'), ctx);
  vm.runInContext(rd('src/js-data/29-recur.js'), ctx);
  return ctx;
}
let rn = 0;
const rrow = (date, amt, o) => Object.assign({ id: 'r' + (++rn), date, kind: 'expense', amt, payee: null, note: '', node: null,
  recur: null, recurSrc: null, rcPeriod: null, recurSig: null, renewsOn: null }, o || {});
function rentLedger() {
  const rows = [];
  ['2025-11', '2025-12', '2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09']
    .forEach((m) => rows.push(rrow(m + '-05', 7500, { payee: 'NGUYEN VAN QUANG', note: 'Em gui tien nha', node: 'rentpay' })));
  rows.push(rrow('2026-09-02', 60, { payee: 'REVI', note: 'REVI', node: 'coffee' }));
  return rows;
}

/* ── the lessons blob ───────────────────────────────────────────────────── */
function lessonsBoot(server) {
  const db = { row: server == null ? null : JSON.stringify(server), pulls: 0, pushes: 0 };
  const q = {
    select() { return q; }, eq() { return q; },
    async maybeSingle() { db.pulls++; return { data: db.row == null ? null : { lessons_enc: db.row }, error: null }; },
    async upsert(r) { db.pushes++; db.row = r.lessons_enc; return { error: null }; },
  };
  const timers = [];
  const ctx = {
    console, Date, JSON, Object, String, Promise,
    setTimeout: (f) => { timers.push(f); return timers.length; }, clearTimeout() {},
    FHCrypto: { encVal: async (k, v) => v, decVal: async (k, v) => v },
    FH_TAX: { get: (n) => (/^[a-z]/.test(n) ? { id: n } : null) },
    fhPersonalData: () => ({ uid: 'u1', key: 'k' }),
    fhPersonKey: (cp, memo, amt) => (cp || memo) + '|' + (amt < 50000 ? 'a' : 'c'),
    csvLearnedExport: () => ({}), csvLearnedMergeIn() {},
  };
  ctx.window = ctx; ctx.sb = { from: () => q };
  vm.createContext(ctx);
  vm.runInContext(rd('src/js-data/24-lessons.js'), ctx);
  const flush = async () => { while (timers.length) { const f = timers.shift(); f(); } for (let i = 0; i < 20; i++) await Promise.resolve(); };
  return { ctx, db, timers, flush, blob: () => JSON.parse(db.row) };
}

(async () => {
  console.log('\n-- the tree backfill walks a 300-row ledger to done across two hydrates --');
  {
    const h = backfillHarness();
    h.ctx.fhTreeBackfill('personal');
    await tick(); await tick();
    t('the first slice is scheduled through the idle timer', h.timers.length === 1, h.timers.length);
    const firstRun = await h.drain(5);                     // five slices in, mid-walk
    t('five slices ran', firstRun === 5 && h.writes.length > 0, { firstRun, writes: h.writes.length });
    const deburredBefore = h.deburrs();
    t('every row with a deep node was deburred once while the walk list was built', deburredBefore === 150, deburredBefore);

    /* HYDRATE 1: the server echoes the ledger as new objects, same content,
       the sweep's writes included. One deep row comes back with an edited
       note, which is a different row to this sweep. */
    h.P.txns = h.P.txns.map((r) => Object.assign({}, r));
    h.P.txns[120].note = h.P.txns[120].note + ' (sua)';
    h.ctx.fhTreeBackfill('personal');                     // the hydrate tail calls it again; the latch holds
    const midRun = await h.drain(4);
    t('the walk carried on after the hydrate', midRun === 4, midRun);

    /* HYDRATE 2: another identical echo, mid-walk. */
    h.P.txns = h.P.txns.map((r) => Object.assign({}, r));
    h.ctx.fhTreeBackfill('personal');
    const rest = await h.drain();
    t('the chain stops: no timer left, bounded slices', h.timers.length === 0 && (5 + 4 + rest) < 40, { rest });
    t('the scope is marked done (v15 cursor) though 50 rows were unresolvable',
      h.store['fh-tree-bf:v15:per:u1'] === 'done', Object.keys(h.store));
    const ids = h.writes.map((w) => w[0]);
    t('every café row was written exactly once across the hydrates', h.writes.length === 100 && new Set(ids).size === 100 && ids.every((id) => /^cafe/.test(id)), { n: h.writes.length });
    t('unchanged deep rows were never deburred again; the edited one was looked at once more', h.deburrs() === 151, h.deburrs());
    t('the sweep never wrote a row that already had its node', !h.writes.some((w) => /^deep/.test(w[0])));
    t('no row object carries the old skip flag as its only memory', !h.P.txns.some((r) => r._tbfSkip));
  }

  console.log('\n-- the backfill reset forgets the marks --');
  {
    const h = backfillHarness();
    h.ctx.fhTreeBackfill('personal');
    await tick(); await tick(); await h.drain();
    const before = h.writes.length;
    h.ctx.fhTreeBackfillReset('personal');
    t('reset clears the done mark', !h.store['fh-tree-bf:v15:per:u1']);
    h.ctx.fhTreeBackfill('personal');
    await tick(); await tick(); await h.drain();
    t('a second full walk looks at the rows again (nothing to write now: nodes are set)', h.writes.length === before && h.store['fh-tree-bf:v15:per:u1'] === 'done', h.writes.length - before);
  }

  console.log('\n-- recurrence: an unchanged input is not analysed again --');
  {
    const c = recurHarness(), rows = rentLedger(), wrote = [];
    c.fhPersonalRecurRows = async () => ({ rows, complete: true });
    c.fhPersonalPatchMany = async (p) => { wrote.push(...p); return p.map((x) => x.id); };
    const n1 = await c.fhRecurRunPersonal();
    const paints1 = c.paints.length;
    t('the first pass analyses, paints and writes the rent mark', n1 >= 1 && paints1 >= 1, { n1, paints1 });
    t('the signature of the completed run is exposed', typeof c.fhRecurLastSig.pers === 'string' && c.fhRecurLastSig.pers.length > 10, c.fhRecurLastSig.pers);
    const n2 = await c.fhRecurRunPersonal();
    t('the same rows again: no write, no repaint', n2 === 0 && c.paints.length === paints1, { n2, paints: c.paints.length });
    rows[0].amt = 7600;
    const n3 = await c.fhRecurRunPersonal();
    t('one amount moved: the pass runs again', c.paints.length > paints1, { n3, paints: c.paints.length });
    const paints3 = c.paints.length;
    c.fhRecurReanalyse('pers');
    t('a person\'s pick clears the gate', c.fhRecurLastSig.pers === null);
    await c.fhRecurRunPersonal();
    t('…so the next pass looks again', c.paints.length > paints3, c.paints.length);

    /* family */
    c.txns = [];
    ['2026-06-18', '2026-07-18', '2026-08-18', '2026-09-18'].forEach((d, i) => c.txns.push({ _dbId: 'f' + i, dateIso: d, amt: 2970, note: 'ANTHROPIC* CLAUDE SUB', node: 'software', ico: null }));
    c.DB = { _hydrated: true, _lastFullAt: 1 };
    c.fhTxnBulkPatch = async () => {};
    const famPaints0 = c.paints.filter((s) => s === 'fam').length;
    await c.fhRecurRunFamily();
    const famPaints1 = c.paints.filter((s) => s === 'fam').length;
    t('the family pass analyses and paints', famPaints1 > famPaints0, famPaints1);
    const f2 = await c.fhRecurRunFamily();
    t('and skips the identical ledger on the next hydrate', f2 === 0 && c.paints.filter((s) => s === 'fam').length === famPaints1, f2);
    t('the family signature is exposed too', typeof c.fhRecurLastSig.fam === 'string');
  }

  console.log('\n-- lessons: no push when nothing changed, one push when something did --');
  {
    const SAVED = { kind: { 'mehoa|c': { who: 'Mẹ Hoa', n: 3, t: 1 } }, cat: {}, node: { 'chu nha|c': { node: 'rent', t: 1 } }, tomb: {},
      rule: {}, pin: {}, route: {}, recur: { 'recur|p|grab': { period: 'monthly', source: 'person', t: 1 } } };
    const a = lessonsBoot(SAVED);
    await a.ctx.fhLessonsSync(); await a.flush();
    await a.ctx.fhLessonsSync(); await a.flush();
    t('two queue syncs over an unchanged blob push nothing', a.db.pulls === 1 && a.db.pushes === 0, a.db);
    t('the recurrence lessons survive the reload (they were pulled but never merged)', a.ctx.fhLessonRecur('p|grab') && a.ctx.fhLessonRecur('p|grab').period === 'monthly', a.ctx.fhLessonRecur('p|grab'));
    a.ctx.fhLessonLearnNode({ counterparty: 'grab', amount: 30000, node: 'ride' });
    t('a new lesson schedules exactly one save', a.timers.length === 1, a.timers.length);
    await a.flush();
    t('…and that save goes up, carrying everything', a.db.pushes === 1 && a.blob().node['grab|a'].node === 'ride' && a.blob().kind['mehoa|c'].n === 3 && a.blob().recur['recur|p|grab'], a.db);
    await a.ctx.fhLessonsSync(); await a.flush();
    t('the next sync, with nothing new, pushes nothing again', a.db.pushes === 1, a.db.pushes);
    a.ctx.fhLessonForgetNode({ counterparty: 'grab', amount: 30000 });
    await a.flush();
    t('a forget is a change and pushes', a.db.pushes === 2 && a.blob().tomb['node|grab|a'], a.db);
  }

  console.log('\n' + (fail ? fail + ' FAILED, ' : 'ALL ') + pass + ' PASSED');
  process.exit(fail ? 1 : 0);
})();
