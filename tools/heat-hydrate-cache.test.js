/* Device-heat fix, approach A ("make hydrate idempotent") — the caches and
   guards that stop a focus/realtime/write tick from re-doing the whole ledger.

   Each section runs the REAL src file in a vm with a bare window and the few
   globals it reaches for at call time, same pattern as recur-engine.test.js.
   Internal helpers are exposed by appending a `window.__t = {...}` line to the
   source INSIDE the sandbox script, so production code carries no test hooks.

   Pinned:
     15-crypto   fhRead memoizes plaintext by ciphertext; a hit costs no
                 WebCrypto call; failures are not cached; the cache is dropped
                 when the DEK changes (adopt / drop / load-miss); dual-mode
                 mismatch detection still fires through the cache; _b64 encodes
                 a 2 MB buffer and round-trips through _unb64.
     20-helpers  _syncSoon and the realtime path share ONE hydrate timer: a
                 local write followed by its own echo is one loadFamilyData,
                 and a full request is never downgraded by a windowed one.
     40-writes   fhTxnBulkPatch / fhTxnBulkDelete stamp DB._lastLocalWrite
                 BEFORE the write goes out.
     19-personal _setState paints the tab + the open queue only when the data
                 signature changed; a background 'loading' over a ready view
                 paints nothing; a background hydrate that landed the same
                 ledger does not invalidate the match/stats slices, a write
                 hydrate always does; the mirror hydrates only when it wrote
                 something; the staging private key is unwrapped once and
                 handed out as copies.
     22-spaces   fhSpacesBoot runs once per 60s unless forced. */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let failed = 0, passed = 0;
function t(name, ok, detail) {
  console.log((ok ? '  PASS  ' : '  FAIL  ') + name + (ok ? '' : '  -> ' + (detail === undefined ? '' : JSON.stringify(detail))));
  if (ok) passed++; else failed++;
}
const read = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
const BASE = { console, Date, JSON, Math, Promise, Array, Object, String, Number, Map, Set, isFinite, Uint8Array, Error, btoa, atob, TextEncoder, TextDecoder };

/* ═══ 15-crypto.js ═══════════════════════════════════════════════════════ */
async function testCrypto() {
  console.log('\n-- 15-crypto: family decrypt cache + chunked base64 --');
  const real = globalThis.crypto;
  let decrypts = 0;
  const crypto = {
    getRandomValues: (a) => real.getRandomValues(a),
    randomUUID: () => real.randomUUID(),
    subtle: {
      importKey: (...a) => real.subtle.importKey(...a),
      encrypt: (...a) => real.subtle.encrypt(...a),
      decrypt: (...a) => { decrypts++; return real.subtle.decrypt(...a); },
      deriveBits: (...a) => real.subtle.deriveBits(...a),
      deriveKey: (...a) => real.subtle.deriveKey(...a),
    },
  };
  const errors = [];
  const window = {};
  const sandbox = Object.assign({}, BASE, { window, crypto, indexedDB: { open() { throw new Error('no idb in test'); } },
    console: { warn() {}, error: (...a) => errors.push(a.join(' ')), log() {} }, location: { origin: 'https://t' } });
  vm.runInNewContext(read('src/js-data/15-crypto.js') + '\nwindow.__t = { _b64, _unb64, fhKeyAdopt, fhKeyDrop, fhKeyLoad, fhDec, fhRead };', sandbox);
  const T = window.__t, FHCrypto = window.FHCrypto;

  // chunked base64: 2 MB round trip (the old spread form threw RangeError here)
  const big = require('crypto').randomFillSync(new Uint8Array(2 * 1024 * 1024));   // getRandomValues caps at 64 KiB
  let b64 = null, threw = null;
  try { b64 = T._b64(big); } catch (e) { threw = e; }
  t('_b64 encodes a 2 MB buffer without throwing', !threw && typeof b64 === 'string' && b64.length > 0, threw && threw.message);
  const back = T._unb64(b64);
  let same = back.length === big.length;
  for (let i = 0; same && i < big.length; i += 1) if (back[i] !== big[i]) same = false;
  t('_unb64(_b64(x)) round-trips 2 MB byte for byte', same, { inLen: big.length, outLen: back.length });
  t('_b64 handles 0..3 byte tails', T._b64(new Uint8Array(0)) === '' && T._b64(new Uint8Array([1])) === 'AQ==' && T._b64(new Uint8Array([1, 2])) === 'AQI=' && T._b64(new Uint8Array([1, 2, 3])) === 'AQID');
  t('_b64 accepts an ArrayBuffer as before', T._b64(new Uint8Array([65, 66]).buffer) === 'QUI=');
  // the chunk boundary itself: 0x8000 + 1 bytes
  const edge = require('crypto').randomFillSync(new Uint8Array(0x8000 + 1));
  t('_b64 is exact across the 32 KiB chunk boundary', Buffer.from(T._unb64(T._b64(edge))).equals(Buffer.from(edge)));

  // cache: adopt a key, encrypt, read twice
  const raw = real.getRandomValues(new Uint8Array(32));
  await T.fhKeyAdopt('f1', raw);
  window.DB = { fid: 'f1', enc: { enc_state: 'enc' } };
  const dek = await FHCrypto.importDek(raw);
  const ct = await FHCrypto.encVal(dek, '12345');
  decrypts = 0;
  const v1 = await T.fhRead({ amount: null, amount_enc: ct }, 'amount');
  const v2 = await T.fhRead({ amount: null, amount_enc: ct }, 'amount');
  t('fhRead returns the plaintext (enc state)', v1 === '12345' && v2 === '12345', [v1, v2]);
  t('second fhRead of the same ciphertext is a cache hit (one WebCrypto decrypt)', decrypts === 1, decrypts);
  t('fhDecCacheSize reports the entry', window.fhDecCacheSize() === 1, window.fhDecCacheSize());
  const ct2 = await FHCrypto.encVal(dek, 'ghi chú có dấu');
  t('a different ciphertext is a miss', (await T.fhRead({ note_enc: ct2 }, 'note')) === 'ghi chú có dấu' && decrypts === 2, decrypts);

  // dual mode: the verification still fires through the cache
  window.DB.enc.enc_state = 'dual';
  decrypts = 0; errors.length = 0;
  const d1 = await T.fhRead({ amount: 12345, amount_enc: ct }, 'amount');
  t('dual: plaintext wins, ct check served from cache (no decrypt)', d1 === '12345' && decrypts === 0 && errors.length === 0, { d1, decrypts, errors });
  const d2 = await T.fhRead({ amount: 999, amount_enc: ct }, 'amount');
  t('dual: a mismatch is still detected with the cached plaintext', d2 === '999' && errors.some((e) => /DUAL MISMATCH/.test(e)), { d2, errors });

  // failures are not cached
  window.DB.enc.enc_state = 'enc';
  const otherDek = await FHCrypto.importDek(real.getRandomValues(new Uint8Array(32)));
  const foreign = await FHCrypto.encVal(otherDek, '7');
  decrypts = 0;
  const f1 = await T.fhRead({ amount_enc: foreign }, 'amount');
  const f2 = await T.fhRead({ amount_enc: foreign }, 'amount');
  t('a failed decrypt resolves null and is retried, never cached', f1 === null && f2 === null && decrypts === 2 && window.fhDecCacheSize() === 2, { f1, f2, decrypts, size: window.fhDecCacheSize() });

  // cleared on key change
  await T.fhKeyAdopt('f1', real.getRandomValues(new Uint8Array(32)));
  t('fhKeyAdopt with a new DEK clears the cache', window.fhDecCacheSize() === 0, window.fhDecCacheSize());
  await T.fhKeyAdopt('f1', raw);
  await T.fhRead({ amount_enc: ct }, 'amount');
  t('cache refills under the re-adopted key', window.fhDecCacheSize() === 1);
  T.fhKeyDrop('f1');
  t('fhKeyDrop clears the cache', window.fhDecCacheSize() === 0, window.fhDecCacheSize());
  await T.fhKeyAdopt('f1', raw);
  await T.fhRead({ amount_enc: ct }, 'amount');
  const loaded = await T.fhKeyLoad('f2');          // no record for f2 in the (absent) IDB → session dropped
  t('fhKeyLoad miss for another family drops the key and the cache', loaded === false && window.fhDecCacheSize() === 0, { loaded, size: window.fhDecCacheSize() });
  t('window.fhDecCacheClear bridge exists', typeof window.fhDecCacheClear === 'function');
}

/* ═══ 20-data-helpers.js ═══════════════════════════════════════════════════ */
function fakeTimers() {
  const timers = new Map(); let id = 0;
  return {
    setTimeout: (fn, ms) => { timers.set(++id, { fn, ms }); return id; },
    clearTimeout: (i) => { timers.delete(i); },
    pending: () => timers.size,
    fireAll: () => { const fns = [...timers.values()].map((x) => x.fn); timers.clear(); fns.forEach((f) => f()); },
  };
}
function testScheduler() {
  console.log('\n-- 20-data-helpers: one hydrate timer for local writes + realtime echoes --');
  const tm = fakeTimers();
  const calls = [];
  const window = { DB: {}, loadFamilyData: (o) => { calls.push(o); } };
  const sandbox = Object.assign({}, BASE, { window, setTimeout: tm.setTimeout, clearTimeout: tm.clearTimeout, sb: {}, L: (a) => a,
    document: { getElementById: () => null }, navigator: { onLine: true } });
  vm.runInNewContext(read('src/js-data/20-data-helpers.js') + '\nwindow.__t = { _scheduleHydrate, _syncSoon };', sandbox);
  const T = window.__t;

  // echo first (realtime beat the REST response), then the post-write _syncSoon
  T._scheduleHydrate(900, false);
  const before = Date.now();
  T._syncSoon();
  t('_syncSoon stamps DB._lastLocalWrite', window.DB._lastLocalWrite >= before && window.DB._lastLocalWrite <= Date.now(), window.DB._lastLocalWrite);
  t('echo + local write arm ONE timer', tm.pending() === 1, tm.pending());
  tm.fireAll();
  t('…which runs loadFamilyData once, windowed', calls.length === 1 && calls[0] && calls[0].windowed === true, calls);

  // full is sticky across the coalesced requests
  calls.length = 0;
  T._scheduleHydrate(900, true);     // an out-of-window echo asked for full
  T._syncSoon();                      // then a windowed post-write request
  t('still one timer', tm.pending() === 1, tm.pending());
  tm.fireAll();
  t('a full request is not downgraded by a later windowed one', calls.length === 1 && calls[0] && calls[0].windowed === undefined, calls);

  // editingTx guard: nothing runs, and the sticky full flag does not leak into the next tick
  calls.length = 0;
  window.editingTx = 3;
  T._scheduleHydrate(900, true);
  tm.fireAll();
  t('an open editor suppresses the hydrate', calls.length === 0, calls);
  window.editingTx = null;
  T._scheduleHydrate(700, false);
  tm.fireAll();
  t('the suppressed full flag does not leak into the next windowed tick', calls.length === 1 && calls[0] && calls[0].windowed === true, calls);
}

/* ═══ 40-txn-writes-outbox.js ══════════════════════════════════════════════ */
async function testBulkStamp() {
  console.log('\n-- 40-txn-writes-outbox: bulk writes stamp _lastLocalWrite before the round trip --');
  const seen = [];   // DB._lastLocalWrite as observed by the fake server at write time
  const window = { DB: { fid: 'f1', _lastLocalWrite: 0 }, addEventListener() {} };
  function builder(table) {
    const q = { table };
    const self = {
      select: () => self, eq: () => self, is: () => self, in: () => self, update: () => { q.op = 'update'; return self; }, delete: () => { q.op = 'delete'; return self; },
      insert: () => self, single: () => self,
      then: (res) => { seen.push({ table, op: q.op, stamp: window.DB._lastLocalWrite }); return Promise.resolve({ data: [], error: null }).then(res); },
    };
    return self;
  }
  let syncs = 0;
  const sandbox = Object.assign({}, BASE, { window, crypto: globalThis.crypto, setTimeout: () => 0, clearTimeout() {},
    sb: { from: builder, storage: { from: () => ({ remove: async () => ({}) }) } },
    _w: async (qq) => { const { data, error } = await qq; if (error) throw error; return data; },
    _rpc: async () => null, _writeErr: () => {}, _syncSoon: () => { syncs++; }, fhEncState: () => 'off', fhKeyReady: () => true,
    fhField: async (n, v) => ({ [n]: v }), fhDec: async () => null, L: (a) => a, navigator: { onLine: true },
    indexedDB: { open() { throw new Error('no idb'); } }, localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    document: { getElementById: () => null }, _categoryIdForName: async () => 'c', _memberIdForWho: () => 'm', _txnIso: () => '2026-10-10',
    CAT_FALLBACK: 'Khác', _isNetErr: () => false });
  vm.runInNewContext(read('src/js-data/40-txn-writes-outbox.js'), sandbox);

  window.DB._lastLocalWrite = 0;
  const t0 = Date.now();
  await window.fhTxnBulkPatch('tx1', { category_id: 'c2' });
  const w = seen.find((s) => s.table === 'transactions' && s.op === 'update');
  t('fhTxnBulkPatch stamps before the update leaves', !!w && w.stamp >= t0, w);
  t('fhTxnBulkPatch leaves a fresh stamp after it lands', window.DB._lastLocalWrite >= t0 && window.DB._lastLocalWrite <= Date.now(), window.DB._lastLocalWrite);

  seen.length = 0; window.DB._lastLocalWrite = 0;
  const t1 = Date.now();
  await window.fhTxnBulkDelete('tx1', null);
  const d = seen.find((s) => s.table === 'transactions' && s.op === 'delete');
  t('fhTxnBulkDelete stamps before the delete leaves', !!d && d.stamp >= t1, d);
  t('the delete still schedules its full re-sync', syncs === 1, syncs);
}

/* ═══ 19-personal.js ═══════════════════════════════════════════════════════ */
async function testPersonal() {
  console.log('\n-- 19-personal: paint-on-change, slice invalidation, mirror, staging key memo --');
  const DATA = { personal_transactions: [], personal_budgets: null, personal_accounts: [], personal_transaction_photos: [], personal_review_memory: [], transactions: [], categories: [],
    /* a catch-all label already present, or fhPersonalLabelsEnsureDefaults seeds one after every hydrate (the stub never persists the insert) */
    personal_labels: [{ id: 'l1', name_enc: 'enc:Khác', emoji: '🗂️', sort_order: 0, claims_enc: 'enc:["*"]' }, { id: 'l2', name_enc: 'enc:Ăn uống', emoji: '🍜', sort_order: 1, claims_enc: 'enc:["food"]' }] };
  const RPC = { get_personal_staging_key: { staging_pub: 'pub', staging_priv_enc: 'enc:' + Buffer.from([9, 8, 7, 6]).toString('base64') } };
  let decrypts = 0;
  const FHCrypto = {
    encVal: async (k, v) => 'enc:' + String(v),
    decVal: async (k, b64) => { decrypts++; if (!String(b64).startsWith('enc:')) throw new Error('bad'); return String(b64).slice(4); },
    importDek: async () => ({ k: 1 }), genCard: () => ({}), genSaltHex: () => '', parseCard: () => ({ ok: false }),
  };
  /* A fake PostgREST that honours the three filters the mirror's correctness
     rests on (eq / is null / not is null) over whatever keys the fixture rows
     carry; everything else is a pass-through. */
  function builder(table) {
    const self = {}, filters = [];
    ['select', 'gte', 'or', 'in', 'order', 'limit', 'range', 'maybeSingle', 'update', 'insert', 'delete', 'single'].forEach((m) => { self[m] = () => self; });
    self.eq = (k, v) => { filters.push((r) => r[k] === undefined || r[k] === v); return self; };
    self.is = (k, v) => { filters.push((r) => v === null ? (r[k] == null) : r[k] === v); return self; };
    self.not = (k, op, v) => { filters.push((r) => !(op === 'is' && v === null ? (r[k] == null) : r[k] === v)); return self; };
    self.then = (res, rej) => {
      let d = DATA[table] === undefined ? [] : DATA[table];
      if (Array.isArray(d)) d = d.filter((r) => filters.every((f) => f(r)));
      return Promise.resolve({ data: d, error: null }).then(res, rej);
    };
    return self;
  }
  const paints = { personal: 0, csv: 0 }, rpcs = {};
  const window = {
    DB: { fid: 'f1', ownerMemberId: 'm1' },
    sb: { auth: { getSession: async () => ({ data: { session: { user: { id: 'u1' } } } }) }, from: builder, rpc: async (name) => { rpcs[name] = (rpcs[name] || 0) + 1; return { data: RPC[name] || null, error: null }; } },
    renderPersonal: () => { paints.personal++; }, renderCsvReview: () => { paints.csv++; }, csvStagedMode: true, csvReview: {},
    fhKeyReady: () => true, fhDecStr: async (x) => x, _persHadReady: true,
  };
  const sandbox = Object.assign({}, BASE, { window, crypto: globalThis.crypto, setTimeout: () => 0, clearTimeout() {}, FHCrypto, SUPABASE_URL: 'https://x',
    document: { getElementById: (id) => (id === 'csv-import-modal' ? { classList: { contains: () => true } } : null) },
    indexedDB: { open() { throw new Error('no idb'); } }, localStorage: { getItem: () => null, setItem() {}, removeItem() {} }, L: (a) => a,
    renderPersonal: () => { paints.personal++; }, DB: window.DB /* the mirror reads the classic-script globals DB / fhKeyReady / fhDecStr */,
    fhKeyReady: window.fhKeyReady, fhDecStr: window.fhDecStr });
  vm.runInNewContext(read('src/js-data/19-personal.js'), sandbox);
  const P = window.fhPersonalData();
  P.uid = 'u1'; P.key = { k: 1 };
  let inv = { match: 0, stats: 0 };
  const oM = window.fhPersonalMatchSliceInvalidate, oS = window.fhPersonalStatsSliceInvalidate;
  window.fhPersonalMatchSliceInvalidate = () => { inv.match++; oM(); };
  window.fhPersonalStatsSliceInvalidate = () => { inv.stats++; oS(); };

  const row = (id, amt, extra) => Object.assign({ id, amount_enc: 'enc:' + amt, note_enc: 'enc:ghi chú ' + id, cat_name_enc: 'enc:Ăn uống', cat_emoji: '🍜', txn_date: '2026-10-0' + (1 + (id.length % 8)), kind: 'expense', space_id: null, link_id: null, version: 1, updated_at: '2026-10-01T00:00:00Z', created_at: '2026-10-01T00:00:00Z', account_id: null }, extra || {});
  DATA.personal_transactions = [row('t1', 120), row('t2', 35), row('t3', 1500)];

  // first hydrate: cold → paints loading + ready
  paints.personal = 0; paints.csv = 0; inv = { match: 0, stats: 0 }; decrypts = 0;
  await window.fhPersonalHydrate();
  t('first hydrate lands the rows', P.state === 'ready' && P.txns.length === 3, { state: P.state, n: P.txns.length });
  t('first hydrate paints twice (loading note, then ready)', paints.personal === 2 && paints.csv === 2, paints);
  t('a write hydrate invalidates both slices', inv.match === 1 && inv.stats === 1, inv);
  const sig1 = window.fhPersonalSig();
  t('fhPersonalSig is a string over the ledger', typeof sig1 === 'string' && sig1.indexOf('t1:') > 0 && sig1.indexOf('120') > 0);
  const d1 = decrypts;

  // background hydrate, nothing changed: no paint, no invalidation, no WebCrypto
  paints.personal = 0; paints.csv = 0; inv = { match: 0, stats: 0 }; decrypts = 0;
  await window.fhPersonalHydrate({ bg: true });
  t('background hydrate with identical data paints nothing (tab + queue)', paints.personal === 0 && paints.csv === 0, paints);
  t('…and does not invalidate the match/stats slices', inv.match === 0 && inv.stats === 0, inv);
  t('…and every decrypt is a cache hit', decrypts === 0, { first: d1, second: decrypts });
  t('…yet the state went through loading back to ready', P.state === 'ready');

  // write hydrate, nothing changed: still no paint, but the slices are invalidated (a write may be outside the window)
  paints.personal = 0; paints.csv = 0; inv = { match: 0, stats: 0 };
  await window.fhPersonalHydrate();
  t('write hydrate with identical data paints nothing', paints.personal === 0 && paints.csv === 0, paints);
  t('…but a write hydrate always invalidates the slices', inv.match === 1 && inv.stats === 1, inv);

  // data moved: one paint (ready only; the loading flip is silent over a ready view), slices invalidated even in bg
  DATA.personal_transactions[1] = row('t2', 36, { updated_at: '2026-10-02T00:00:00Z' });
  paints.personal = 0; paints.csv = 0; inv = { match: 0, stats: 0 };
  await window.fhPersonalHydrate({ bg: true });
  t('a changed amount repaints exactly once (ready), no loading flash', paints.personal === 1 && paints.csv === 1, paints);
  t('…and the background pass invalidates the slices because the data moved', inv.match === 1 && inv.stats === 1, inv);
  t('signature changed with the data', window.fhPersonalSig() !== sig1);

  // mirror: nothing to do → no hydrate; the first pass still tells the tab (mirrorRan)
  let hydrates = 0;
  const oH = window.fhPersonalHydrate;
  window.fhPersonalHydrate = (o) => { hydrates++; return oH(o); };
  DATA.transactions = []; DATA.categories = [];
  P.mirrorRan = false; paints.personal = 0;
  await window.fhPersonalMirror();
  t('a no-op mirror pass does not hydrate', hydrates === 0 && P.mirrorRan === true, { hydrates, ran: P.mirrorRan });
  t('…but the first pass still repaints so the sync note clears', paints.personal === 1, paints.personal);
  paints.personal = 0;
  await window.fhPersonalMirror();
  t('a second no-op pass neither hydrates nor paints', hydrates === 0 && paints.personal === 0, { hydrates, paints: paints.personal });

  // mirror: an unlinked family row of mine → it reserves link_id (stamping the echo window), inserts a master, hydrates once
  DATA.transactions = [{ id: 'fam1', txn_date: '2026-10-03', category_id: null, amount: 50, note: 'cà phê', occurred_time: null, node: null }];
  window.DB._lastLocalWrite = 0;
  const t0 = Date.now();
  await window.fhPersonalMirror();
  t('a mirror pass that wrote something hydrates exactly once', hydrates === 1, hydrates);
  t('the family link_id update stamped DB._lastLocalWrite', window.DB._lastLocalWrite >= t0, window.DB._lastLocalWrite);
  window.fhPersonalHydrate = oH;

  // staging private key memo
  decrypts = 0;
  const k1 = await window.fhPersonalStagingPrivKey();
  const k2 = await window.fhPersonalStagingPrivKey();
  t('staging private key unwraps once (memoized)', decrypts === 1, decrypts);
  t('…returns equal bytes as distinct copies', k1 !== k2 && Buffer.from(k1).equals(Buffer.from(k2)) && Buffer.from(k1).equals(Buffer.from([9, 8, 7, 6])));
  for (let i = 0; i < k1.length; i++) k1[i] = 0;    // what fhPersonalStagingVerify does
  const k3 = await window.fhPersonalStagingPrivKey();
  t('zeroing a handed-out copy does not poison the memo', Buffer.from(k3).equals(Buffer.from([9, 8, 7, 6])));
  t('the staging key record itself was fetched once', rpcs.get_personal_staging_key === 1, rpcs);
  window.fhPersonalStagingKeysForget();
  const k4 = await window.fhPersonalStagingPrivKey();
  // the re-unwrap is served by the ciphertext cache (same sealed bytes), so what proves the memo dropped is the record re-fetch
  t('forget drops the memo: the record is re-read and the bytes come back intact', rpcs.get_personal_staging_key === 2 && Buffer.from(k4).equals(Buffer.from([9, 8, 7, 6])), { rpcs, k4: Array.from(k4) });

  t('cached decrypt bridges exist for 27-streaks', typeof window.fhPersonalDecP === 'function' && typeof window.fhPersonalDecTxt === 'function' && typeof window.FH_PDEC_FAILED === 'string');
  t('fhPersonalDecTxt folds a failure to null', (await window.fhPersonalDecTxt('garbage')) === null && (await window.fhPersonalDecP('garbage')) === window.FH_PDEC_FAILED);
}

/* ═══ 22-spaces.js ═════════════════════════════════════════════════════════ */
async function testSpaces() {
  console.log('\n-- 22-spaces: fhSpacesBoot throttle --');
  let rpcs = 0, now = 1_000_000;
  const window = { sb: { auth: { getSession: async () => ({ data: { session: { user: { id: 'u1' } } } }) }, rpc: async () => { rpcs++; return { data: [], error: null }; } } };
  const FakeDate = Object.assign(function () { return new Date(now); }, { now: () => now });
  const sandbox = Object.assign({}, BASE, { window, Date: FakeDate, crypto: globalThis.crypto, setTimeout, clearTimeout, FHCrypto: {},
    localStorage: { getItem: () => null, setItem() {} }, indexedDB: { open() { throw new Error('x'); } }, L: (a) => a });
  vm.runInNewContext(read('src/js-data/22-spaces.js'), sandbox);
  await window.fhSpacesBoot();
  t('first boot runs my_families', rpcs === 1, rpcs);
  await window.fhSpacesBoot();
  await window.fhSpacesBoot();
  t('two more plain calls within 60s are free', rpcs === 1, rpcs);
  await window.fhSpacesBoot({ force: true });
  t('{force:true} re-reads the roster', rpcs === 2, rpcs);
  now += 61_000;
  await window.fhSpacesBoot();
  t('after 60s a plain call re-reads', rpcs === 3, rpcs);
}

(async () => {
  await testCrypto();
  testScheduler();
  await testBulkStamp();
  await testPersonal();
  await testSpaces();
  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('test crashed', e); process.exit(1); });
