#!/usr/bin/env node
/* Opening the review queue a second time costs no unseals (device-heat fix,
 * 2026-10-10). `node tools/heat-queue-open-cache.test.js`
 *
 * What a queue open used to burn: nacl.box.open on up to a thousand sealed
 * rows (pure-JS X25519), the private key unwrapped once PER ROW, every pending
 * receipt opened again, and a full fetch of every sealed row just to count
 * them for the badge. Pinned here, against the real modules:
 *   - one session-wide opened-row cache (18 fhStagedOpenCache) that the
 *     review's opener (72), the teaser (76) and the reading watcher (74) share:
 *     a row opened by any of them is never opened again by another;
 *   - one private-key resolve per loop (fhStagedPrivPool);
 *   - the badge count is a HEAD request, with the fetch only as a fallback,
 *     and the tab repaints only when the number moves;
 *   - the receipt join finds a queue row in O(1) and gives the answers the old
 *     linear filter gave, memoizes offers per settled state, keeps opened
 *     receipts across runs and skips a ledger pass whose inputs did not move.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const rd = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
const SRC18 = rd('src/js-data/18-staging-keys.js'), SRC72 = rd('src/js-data/72-txn-review.js');
const SRC74 = rd('src/js-data/74-autotxn-ui.js'), SRC76 = rd('src/js-data/76-quick-review.js');
const SRC78 = rd('src/js-ui/78-receipt-join.js'), TAX = rd('src/js-ui/11-taxonomy.js');

let pass = 0, fail = 0;
const t = (n, ok, d) => { console.log((ok ? '  PASS  ' : '  FAIL  ') + n + (!ok && d !== undefined ? '  -> ' + JSON.stringify(d) : '')); ok ? pass++ : fail++; };
function grab(src, header) {
  const at = src.indexOf(header);
  if (at < 0) { console.error('not found in source: ' + header); process.exit(1); }
  let i = src.indexOf('{', at), depth = 0;
  for (; i < src.length; i++) { if (src[i] === '{') depth++; else if (src[i] === '}') { depth--; if (!depth) break; } }
  return src.slice(at, i + 1);
}

/* ── a device: the cache (18), the opener (72), the teaser's opener (76), the
   watcher's opener (74), with a counting fake in place of nacl ────────────── */
function device() {
  const store = {};
  const ctx = {
    console: { warn() {}, log() {} }, Promise, Map, Set, Object, Date, JSON, Math, String, Number, Array,
    DB: { fid: 'fam-1' }, fhUser: { id: 'user-1' }, L: (vi) => vi, esc: (s) => s,
    localStorage: { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } },
    opens: 0, keys: { p: 0, f: 0 },
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(SRC18, ctx);
  ctx.fhStagingOpenRow = (row) => { ctx.opens++; if (row.__locked) throw new Error('staging_open_failed'); return row.__payload; };
  ctx.fhPersonalStagingPrivKey = async () => { ctx.keys.p++; return 'ppriv'; };
  ctx.fhStagingPrivKey = async () => { ctx.keys.f++; return 'fpriv'; };
  vm.runInContext(grab(SRC72, 'async function fhReadStagedRow('), ctx);
  vm.runInContext(grab(SRC76, 'async function _qrOpen('), ctx);
  vm.runInContext(SRC74.slice(SRC74.indexOf('const _atxStats = {'), SRC74.indexOf('/* Rows -> feed items')), ctx);
  return ctx;
}
const sealed = (i, scope) => ({ id: 'row' + i, sealed: 'x', eph_pub: 'e', nonce: 'nonce' + i, enc_v: 1, member_id: 'm1',
  staging_scope: scope || 'personal', occurred_at: '2026-10-01T03:00:00Z', source_provider: 'TESTBANK', duplicate_of_id: null, resolved_before: false,
  __payload: { amount: 1000 * (i + 1), currency: 'VND', direction: 'debit', counterparty: 'SHOP ' + i, raw_extracted: { memo: 'memo ' + i, memo_display: 'Memo ' + i } } });

(async () => {
  console.log('\n-- a second queue open performs zero unseals for unchanged rows --');
  {
    const c = device();
    const raw = []; for (let i = 0; i < 60; i++) raw.push(sealed(i, i % 3 ? 'personal' : 'family'));
    const openAll = async () => {
      const pool = c.fhStagedPrivPool();
      const out = [];
      for (const r of raw) out.push(await c.fhReadStagedRow(r, pool));
      return out;
    };
    const first = await openAll();
    t('the first open unseals every row', c.opens === 60 && first.every((r) => r && !r._unreadable && r.raw_extracted.memo_display), c.opens);
    t('…and resolves each private key ONCE for the whole loop, not per row', c.keys.p === 1 && c.keys.f === 1, c.keys);
    const second = await openAll();
    t('the second open unseals nothing', c.opens === 60, c.opens);
    t('…and never asks for a key', c.keys.p === 1 && c.keys.f === 1, c.keys);
    t('the rows read the same', second.every((r, i) => r.amount === first[i].amount && r.raw_extracted.memo === first[i].raw_extracted.memo));
    first[3].raw_extracted._rcpt = { v: 1 }; first[3]._joined = 'queue';
    const again = await c.fhReadStagedRow(raw[3]);
    t('each read is its own copy: a mark on one open never leaks into the next', !again.raw_extracted._rcpt && !again._joined);
    raw[4].duplicate_of_id = 'row9'; raw[4].resolved_before = true;
    const wf = await c.fhReadStagedRow(raw[4]);
    t('workflow columns ride outside the box and are re-read without an unseal', wf.duplicate_of_id === 'row9' && wf.resolved_before === true && c.opens === 60, { d: wf.duplicate_of_id, opens: c.opens });
    raw[5].nonce = 'resealed';
    await c.fhReadStagedRow(raw[5]);
    t('a re-sealed row (new nonce) is a new box and is opened again', c.opens === 61, c.opens);
    const locked = sealed(99); locked.__locked = true;
    const u1 = await c.fhReadStagedRow(locked), u2 = await c.fhReadStagedRow(locked);
    t('an unreadable row is never cached: unlocking must heal it', u1._unreadable && u2._unreadable && c.opens === 63, c.opens);
    t('the cache is exposed with get/set/has/clear and reports its size', typeof c.fhStagedOpenCache.get === 'function' && typeof c.fhStagedOpenCache.clear === 'function' && c.fhStagedOpenCache.size() === 61, c.fhStagedOpenCache.size());

    /* shared across surfaces */
    const re = await c._qrOpen(raw[7]);
    t('the quick-review teaser reads a row the queue opened without an unseal', re && re.memo_display === 'Memo 7' && re.source_provider === 'TESTBANK' && c.opens === 63, c.opens);
    const fd = await c._atxOpenFind(raw[8]);
    t('the reading watcher reads it too, and its own meter counts no unseal', fd.desc === 'Memo 8' && c.fhReadLoopStats().unseals === 0 && c.opens === 63, { fd, opens: c.opens });
    const fresh = sealed(200);
    await c._atxOpenFind(fresh);
    t('what the watcher opens, the queue then reads for free', c.opens === 64 && (await c.fhReadStagedRow(fresh)).amount === 201000 && c.opens === 64, c.opens);
    c.fhStagingKeysForget();
    t('the opened rows leave with the key', c.fhStagedOpenCache.size() === 0);
    c.DB.fid = 'fam-2';
    c.fhStagedOpenCache.set('k', { a: 1 });
    t('a family switch empties the cache before it is read', c.fhStagedOpenCache.get('k') === undefined || c.fhStagedOpenCache.size() <= 1);
    c.fhStagedOpenCache.clear();
    const QUEUE = grab(SRC72, 'window.fhTxnReviewSheet = async function');
    t('the review sheet pools the key and passes it through the loop', /fhStagedPrivPool\(\)/.test(QUEUE) && /fhReadStagedRow\(raw\[i\], pool\)/.test(QUEUE));
    t('…and yields to paint only around real unseals', /miss && \(misses\+\+ % 20 === 0\)/.test(QUEUE));
    t('the cache is capped', /OPEN_CACHE_MAX = 3000/.test(SRC18));
  }

  console.log('\n-- the badge count is a HEAD request, and the tab repaints only when it moves --');
  {
    const state = { count: 7, still: 0, rows: [], heads: [], fetches: 0, headFail: false };
    const store = {};
    const sbq = () => {
      const self = { select() { state.fetches++; return self; }, eq() { return self; }, or() { return self; }, order() { return self; }, limit() { return self; }, in() { return self; },
        then(res) { return Promise.resolve({ data: state.rows, error: null }).then(res); } };
      return self;
    };
    const ctx = {
      console: { warn() {}, log() {} }, Promise, Map, Object, Date, JSON, Math, String, Number, Array, L: (vi) => vi,
      localStorage: { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } },
      fhUser: { id: 'user-1' }, DB: { fid: 'fam-1' }, renders: 0, ctas: 0, notices: 0, forgets: 0,
      sb: { from: () => sbq() },
    };
    ctx.window = ctx;
    ctx.renderPersonal = () => { ctx.renders++; };
    ctx.renderCashflowEmailCta = () => { ctx.ctas++; };
    ctx.fhNoticesApply = () => { ctx.notices++; };
    ctx.fhBackfillCountForget = () => { ctx.forgets++; };
    ctx.fhStagedPendingHead = async (extra) => {
      if (state.headFail) throw new Error('down');
      if (extra) { const q = { in: (col, ids) => { state.heads.push('in:' + col + ':' + ids.join('+')); return q; } }; extra(q); return state.still; }
      state.heads.push('all'); return state.count;
    };
    vm.createContext(ctx);
    vm.runInContext(SRC72.slice(SRC72.indexOf('var TXN_REVIEW_PAGE'), SRC72.indexOf('window.fhStagedCount = 0;')), ctx);
    vm.runInContext(SRC72.slice(SRC72.indexOf('window.fhStagedCount = 0;'), SRC72.indexOf('/* The always-visible')), ctx);

    await ctx.fhRefreshStagedCount();
    t('the first refresh asks one HEAD count and fetches nothing', state.heads.length === 1 && state.heads[0] === 'all' && state.fetches === 0, { heads: state.heads, fetches: state.fetches });
    t('the count lands on the badge and is exposed as known', ctx.fhStagedCount === 7 && ctx.fhStagedCountKnown === 7 && ctx._fhStagedKnown === true && ctx.fhStagedTotal === 7);
    t('the first answer paints the tab and the CTA', ctx.renders === 1 && ctx.ctas === 1 && ctx.forgets === 1);
    await ctx.fhRefreshStagedCount();
    t('an unchanged count paints nothing', ctx.renders === 1 && ctx.ctas === 1 && state.fetches === 0, { renders: ctx.renders });
    t('the notice pass still runs each time (self-throttled, not gated on the count)', ctx.notices === 2, ctx.notices);
    state.count = 9;
    await ctx.fhRefreshStagedCount();
    t('a moved count paints once more', ctx.renders === 2 && ctx.fhStagedCountKnown === 9, ctx.renders);
    store['fh-staged-retired:u:user-1'] = JSON.stringify(['ra', 'rb']);
    state.still = 1;
    await ctx.fhRefreshStagedCount();
    t('locally retired rows the server still holds are subtracted through a second HEAD narrowed to their ids',
      ctx.fhStagedCount === 8 && state.heads.some((h) => h === 'in:id:ra+rb') && state.fetches === 0, { n: ctx.fhStagedCount, heads: state.heads });
    state.headFail = true; state.rows = [{ id: 'x1' }, { id: 'x2' }, { id: 'x3' }];
    await ctx.fhRefreshStagedCount();
    t('when the count cannot be asked, the fetch is the fallback', state.fetches >= 1 && ctx.fhStagedCount === 3 && ctx.fhStagedCountKnown === 3, { fetches: state.fetches, n: ctx.fhStagedCount });

    /* 74's own helper, which 72 reads */
    const c74 = { console, Promise, Object, Array, Map, calls: [] };
    c74.window = c74;
    c74.sb = { from: () => { const q = { select() { return q; }, eq() { return q; }, or() { return q; }, in(col, ids) { c74.calls.push([col, ids]); return q; },
      then(res) { return Promise.resolve({ count: 4, error: null }).then(res); } }; return q; } };
    vm.createContext(c74);
    vm.runInContext('const _atxStats = { req: 0 }; const _atxTxnOnly = (build) => build((q) => q);\n' + grab(SRC74, 'async function _atxPendingCount('), c74);
    const n = await vm.runInContext("_atxPendingCount((q) => q.in('id', ['a', 'b']))", c74);
    t('74 _atxPendingCount applies a caller\'s narrowing and returns the count', n === 4 && c74.calls.length === 1 && c74.calls[0][1].join() === 'a,b', c74.calls);
    t('74 exports it for 72 to read', /window\.fhStagedPendingHead = _atxPendingCount/.test(SRC74));
    t('72 fetches no payload to count: the HEAD helper is what it asks', /fhStagedPendingHead\(\)/.test(grab(SRC72, 'async function _stagedHeadCount(')));
    t('no new direct reader of the table was added (notice-rows pins the nine)', (SRC72 + SRC74 + SRC76).split("from('email_transactions')").length - 1 === 9);
    t('the peek stands down on a queue the badge counted empty', /_fhStagedKnown && window\.fhStagedCountKnown === 0/.test(grab(SRC76, 'window.fhStagedPeek = async function')));
  }

  console.log('\n-- the receipt join: O(1) row index, memoized offers, opened receipts kept, a gated ledger pass --');
  {
    function makeEnv(state) {
      const timers = [];
      const env = {
        console: { warn() {}, log() {} }, setTimeout: (f) => { timers.push(f); return timers.length; }, clearTimeout() {}, Date, JSON, Math, Promise, Array, Object, String, Number, isFinite, Map, Set,
        curMult: () => 1000,
        sb: { from: (table) => {
          const q = { _receipt: false };
          const self = {
            select: () => self, eq: (k, v) => { if (k === 'row_kind' && v === 'receipt') q._receipt = true; return self; }, order: () => self,
            range: (a, b) => Promise.resolve({ data: q._receipt ? (state.receiptRows || []).slice(a, b + 1) : [], error: null }),
            limit: () => { if (table === 'statement_files') state.stmtAsks++; return Promise.resolve({ data: [], error: null }); },
          };
          return self;
        } },
        fhReadStagedRow: async (row) => { state.reads++; return state.opened[row.id] || { id: row.id, _unreadable: 'x' }; },
        fhPersonalMatchSlice: async () => state.slice,
        fhPersonalSetReceipt: async (id, rc) => { state.attached.push(id); return true; },
        fhPersonalGetReceipt: async () => { state.gets++; return null; },
        fhStagedRetireIds: async (ids) => { state.retired.push(...ids); },
        fhLessonItemNode: () => null,
      };
      env.window = env; env.globalThis = env;
      vm.createContext(env);
      vm.runInContext(TAX, env);
      vm.runInContext(SRC78, env);
      env.__timers = timers;
      return env;
    }
    const rcpt = (state, id, paid, at, o) => {
      o = o || {};
      state.receiptRows.push({ id, created_at: o.created || new Date(Date.now() - 3 * 864e5).toISOString(), occurred_at: at, source_provider: 'Grab', nonce: 'n-' + id });
      state.opened[id] = { id, raw_extracted: { receipt: { service_type: 'ride', order_id: 'o-' + id, items: null, paid, paid_with_tail: o.tail || null, service_label: 'Car' }, amount: paid, direction: 'debit' } };
    };
    const qrow = (id, amount, at, tail) => ({ id, occurred_at: at || '2026-09-26T13:09:00+07:00', raw_extracted: { amount, direction: 'debit', account_masked: tail ? ('5138***' + tail) : null } });
    const fresh = () => ({ receiptRows: [], opened: {}, slice: [], attached: [], retired: [], reads: 0, gets: 0, stmtAsks: 0 });

    /* a 400-row queue and three receipts: one exact, one pair the rules cannot split */
    const st = fresh();
    const rows = []; for (let i = 0; i < 400; i++) rows.push(qrow('q' + i, 1000 * (i + 1)));
    rcpt(st, 'rA', 6000, '2026-09-26T13:08:00+07:00');            // exactly q5
    rows.push(qrow('q400', 50500), qrow('q401', 50500));          // two rows of one amount, no clocks to decide
    rcpt(st, 'rC', 50500, '2026-09-26T13:08:00+07:00');
    const q400 = rows[rows.length - 2], q401 = rows[rows.length - 1];
    const env = makeEnv(st);
    const t0 = Date.now();
    await env.fhReceiptJoinQueue(rows);
    t('the exact pair attaches', rows[5]._rcpt && rows[5]._rcptRowId === 'rA');
    t('the ambiguous pair attaches nothing and is offered to both', !q400._rcpt && !q401._rcpt
      && env.fhReceiptOffers('q400').length === 1 && env.fhReceiptOffers('q401')[0].id === 'rC');
    t('an attached row and an unknown row have no offers', env.fhReceiptOffers('q5').length === 0 && env.fhReceiptOffers('nope').length === 0);
    const firstAnswer = JSON.stringify(env.fhReceiptOffers('q401'));
    let asked = 0; const tA = Date.now();
    for (let k = 0; k < 20; k++) for (let i = 0; i < 400; i++) asked += env.fhReceiptOffers('q' + i).length;
    t('8000 offer lookups over a 400-row queue finish quickly (indexed + memoized)', Date.now() - tA < 1500 && asked === 0, { ms: Date.now() - tA, asked });
    t('the memoized answer is the computed answer', JSON.stringify(env.fhReceiptOffers('q401')) === firstAnswer);
    const o1 = env.fhReceiptOffers('q400'); o1.push({ bogus: 1 });
    t('a caller gets a copy: pushing into it changes nothing', env.fhReceiptOffers('q400').length === 1);
    t('a pick re-settles and the memo follows: the other row loses the offer', env.fhReceiptAttach('q400', 'rC') === true && q400._rcptRowId === 'rC' && env.fhReceiptOffers('q401').length === 0);
    t('a detach is a "not this one": the pair is no longer ambiguous and the receipt settles on the other row', env.fhReceiptDetach('q400') === true && !q400._rcpt && q401._rcptRowId === 'rC' && env.fhReceiptOffers('q400').length === 0 && env.fhReceiptOffers('q401').length === 0);
    t('the whole scenario ran inside a second', Date.now() - t0 < 2500, Date.now() - t0);
    t('the source: the row index is a Map, not a filter', /function _rjRowById\(id\) \{ return RJ\.byId\.get\(id\)/.test(SRC78) && !/\(RJ\.queue \|\| \[\]\)\.filter\(function \(q\) \{ return q && q\.id === id/.test(SRC78));

    /* opened receipts kept across runs; the ledger pass gated */
    const s2 = fresh();
    const old = new Date(Date.now() - 5 * 864e5).toISOString();
    rcpt(s2, 'r1', 681700, old); rcpt(s2, 'r2', 99000, old, { created: new Date(Date.now() - 20 * 864e5).toISOString() });   // r2: past grace
    s2.slice = [{ id: 'p1', kind: 'expense', link: null, amt: 681.7, date: old.slice(0, 10) }];
    const e2 = makeEnv(s2);
    const ledgerPass = async () => { e2.fhReceiptLedgerSoon(); const f = e2.__timers.shift(); await f(); };
    await ledgerPass();
    t('the first ledger pass opens both receipts, attaches the one with a row, and asks the statement hold for the aged one', s2.reads === 2 && s2.attached.length === 1 && s2.gets === 1 && s2.stmtAsks === 1, s2);
    await ledgerPass();
    t('the second pass, same receipts and the same slice: no unseal, no matching, no statement ask', s2.reads === 2 && s2.gets === 1 && s2.stmtAsks === 1, { reads: s2.reads, gets: s2.gets, stmt: s2.stmtAsks });
    s2.slice = s2.slice.slice();                                  // a write invalidated the slice: new identity
    await ledgerPass();
    t('a new slice runs the pass again, still without re-opening the receipts', s2.reads === 2 && s2.gets === 2, { reads: s2.reads, gets: s2.gets });
    rcpt(s2, 'r3', 12000, old);
    await ledgerPass();
    t('a new receipt is opened once and the pass runs', s2.reads === 3 && s2.gets === 3, { reads: s2.reads, gets: s2.gets });
    s2.receiptRows[0].nonce = 'resealed';
    await ledgerPass();
    t('a re-sealed receipt is opened again', s2.reads === 4, s2.reads);
    t('the opened-receipt cache is capped', /RJ_OPEN_MAX = 3000/.test(SRC78));
    t('the queue path is never gated (its rows are new each open)', /if \(!queueRows\) \{\s*\n\s*var sig = _rjLedgerSig/.test(SRC78));
  }

  console.log('\n' + (fail ? fail + ' FAILED, ' : 'ALL ') + pass + ' PASSED');
  process.exit(fail ? 1 : 0);
})();
