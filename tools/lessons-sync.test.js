#!/usr/bin/env node
/* The lessons blob survives a reload, and a save never overwrites what it has not read.
 * `node tools/lessons-sync.test.js`
 *
 * 24-lessons.js keeps every lesson (loans, categories, Tiêu vào gì, item
 * signatures, tombstones) in ONE encrypted row that each save replaces whole.
 * Until 2026-10-03 two things broke it:
 *   - the pull left the `node` map out, so every Tiêu vào gì lesson was gone
 *     after a reload and the next save erased the server's copy too;
 *   - the pull ran only when the review queue opened, so a lesson taught from
 *     the ledger first uploaded this session's few keys over the whole blob.
 * Run against the real module with a fake Supabase and identity crypto. */
const fs = require('fs'), path = require('path'), vm = require('vm');
const SRC = fs.readFileSync(path.join(__dirname, '..', 'src/js-data/24-lessons.js'), 'utf8');
let pass = 0, fail = 0;
const t = (name, ok, info) => { if (ok) { pass++; console.log('  ✓ ' + name); } else { fail++; console.log('  FAIL  ' + name + (info !== undefined ? '  -> ' + JSON.stringify(info) : '')); } };

function boot(server) {
  const db = { row: server == null ? null : JSON.stringify(server), pulls: 0, pushes: 0, failPull: false };
  const q = {
    select() { return q; }, eq() { return q; },
    async maybeSingle() { db.pulls++; if (db.failPull) return { data: null, error: { message: 'Load failed' } }; return { data: db.row == null ? null : { lessons_enc: db.row }, error: null }; },
    async upsert(r) { db.pushes++; db.row = r.lessons_enc; return { error: null }; },
  };
  const timers = [];
  const ctx = {
    console, Date, JSON, Object, String, Promise,
    setTimeout: (f) => { timers.push(f); return timers.length; }, clearTimeout() {},
    FHCrypto: { encVal: async (k, v) => v, decVal: async (k, v) => v },
    FH_TAX: { get: (n) => /^[a-z]/.test(n) ? { id: n } : null },
    fhPersonalData: () => ({ uid: 'u1', key: 'k' }),
    fhPersonKey: (cp, memo, amt) => (cp || memo) + '|' + (amt < 50000 ? 'a' : 'c'),
    csvLearnedExport: () => ({}), csvLearnedMergeIn() {},
  };
  ctx.window = ctx; ctx.sb = { from: () => q };
  vm.createContext(ctx);
  vm.runInContext(SRC, ctx);
  const flush = async () => { while (timers.length) { const f = timers.shift(); f(); } for (let i = 0; i < 20; i++) await Promise.resolve(); };
  return { ctx, db, flush, blob: () => JSON.parse(db.row) };
}

(async () => {
  const SAVED = { kind: { 'mehoa|c': { who: 'Mẹ Hoa', n: 3, t: 1 } }, cat: {}, node: { 'chu nha|c': { node: 'rent', t: 1 } }, tomb: { 'kind|old|a': { t: 1 } } };

  console.log('\n-- a reload keeps the Tiêu vào gì lessons --');
  {
    const a = boot(SAVED);
    await a.ctx.fhLessonsSync(); await a.flush();
    t('after the queue syncs, a node lesson saved earlier is read back', a.ctx.fhLessonNode({ counterparty: 'chu nha', amount: 7000000 }) === 'rent');
    t('and the save that follows keeps it on the server', !!a.blob().node['chu nha|c'], a.blob().node);
  }

  console.log('\n-- a lesson taught from the ledger first does not wipe the server --');
  {
    const a = boot(SAVED);
    a.ctx.fhLessonLearnNode({ counterparty: 'grab', amount: 30000, node: 'ride' });   // no sync has run this session
    await a.flush();
    const b = a.blob();
    t('the server is read before the first save', a.db.pulls === 1 && a.db.pushes === 1, a.db);
    t('the new lesson is saved', b.node['grab|a'] && b.node['grab|a'].node === 'ride', b.node);
    t('the loans, the old node lessons and the tombstones are still there', b.kind['mehoa|c'] && b.kind['mehoa|c'].n === 3 && b.node['chu nha|c'] && b.tomb['kind|old|a'], b);
  }

  console.log('\n-- a server that cannot be read is never overwritten --');
  {
    const a = boot(SAVED); a.db.failPull = true;
    a.ctx.fhLessonLearnNode({ counterparty: 'grab', amount: 30000, node: 'ride' });
    await a.flush();
    t('a failed pull means no save', a.db.pushes === 0 && !!a.blob().kind['mehoa|c'], a.db);
    a.db.failPull = false;
    a.ctx.fhLessonLearnNode({ counterparty: 'be', amount: 30000, node: 'ride' });
    await a.flush();
    const b = a.blob();
    t('the next save, once the pull works, carries both new lessons and everything old', b.node['grab|a'] && b.node['be|a'] && b.kind['mehoa|c'] && b.node['chu nha|c'], b);
  }

  console.log('\n-- a first-ever save (no row yet) still works --');
  {
    const a = boot(null);
    a.ctx.fhLessonLearnNode({ counterparty: 'grab', amount: 30000, node: 'ride' });
    await a.flush();
    t('the blob is created', a.db.pushes === 1 && a.blob().node['grab|a'].node === 'ride', a.db);
  }

  console.log('\n-- a forget stays forgotten across the merge --');
  {
    const a = boot(SAVED);
    a.ctx.fhLessonForgetNode({ counterparty: 'chu nha', amount: 7000000 });           // before any pull
    await a.flush();
    t('the old server lesson does not come back', a.ctx.fhLessonNode({ counterparty: 'chu nha', amount: 7000000 }) === null && !!a.blob().tomb['node|chu nha|c']);
  }

  console.log('\n' + (fail ? fail + ' FAILED, ' : 'ALL ') + pass + ' PASSED');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('  FAIL  the test ran  -> ' + (e && e.stack || e)); process.exit(1); });
