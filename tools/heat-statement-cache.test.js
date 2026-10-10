#!/usr/bin/env node
/* Statement capture no longer redoes its heavy work (device-heat fix, approach C):
 * src/js-data/77-statement-capture.js.  `node tools/heat-statement-cache.test.js`
 *
 *   C4  the opened grid is kept by file hash: a second tap, "Để sau" and back, do
 *       not download / unseal / derive again; it is sealed into IndexedDB (fake
 *       here) so a NEW session skips the download too; a committed statement
 *       leaves the cache; a file picked from the device is never kept
 *   C5  decrypted queue rows are kept by id + ciphertext across loads, decrypted
 *       fifty at a time rather than one awaited call per row, capped at 3000
 *   C6  arming a card's ✕ swaps that one button; a bank chip repaints the cards
 *       and the chips in place; the full renderCsvReview is only the fallback
 */
const fs = require('fs');
const path = require('path');
const nacl = require('tweetnacl');
const nodeCrypto = require('crypto');

(async () => {
  const SB = await import(path.join(__dirname, '..', 'supabase', 'functions', '_shared', 'mailbox', 'sealed-box.mjs'));
  const T = require(path.join(__dirname, '..', 'src', 'js-ui', '59-statement-table.js'));
  let pass = 0, fail = 0;
  const t = (n, ok, d) => { console.log((ok ? '  PASS  ' : '  FAIL  ') + n + (!ok && d !== undefined ? '  -> ' + JSON.stringify(d) : '')); ok ? pass++ : fail++; };
  const SRC = fs.readFileSync(path.join(__dirname, '..', 'src', 'js-data', '77-statement-capture.js'), 'utf8');

  const OWNER = '11111111-1111-4111-8111-111111111111';
  const kp = nacl.box.keyPair(), pub = Buffer.from(kp.publicKey).toString('base64');
  const FILE = new Uint8Array(nodeCrypto.randomBytes(2048));
  const sha = nodeCrypto.createHash('sha256').update(FILE).digest('hex');
  const GRID = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'statements', 'ewallet.grid.json'), 'utf8'));
  const mkFile = (id, msg, provider, subject, extra) => {
    const m = SB.sealForFamily(Object.assign({ filename: id + '.xlsx', subject, file_sha256: sha }, extra || {}), pub, OWNER, msg, { nacl, rng: nodeCrypto.webcrypto }, 'personal');
    return { id, gmail_message_id: msg, part_index: 0, source_provider: provider, received_at: '2026-09-18T16:38:00+00:00', file_ext: 'xlsx', byte_size: 100,
      object_path: OWNER + '/' + id + '.sealed', meta_sealed: m.sealed, meta_eph_pub: m.eph_pub, meta_nonce: m.nonce, enc_v: m.enc_v, status: 'pending', backfill: false };
  };
  const blob = SB.sealBytes(FILE, pub, { nacl, rng: nodeCrypto.webcrypto });
  const src18 = fs.readFileSync(path.join(__dirname, '..', 'src', 'js-data', '18-staging-keys.js'), 'utf8');
  const fx = (name) => { const j = src18.indexOf('function ' + name); return src18.slice(j, src18.indexOf('\n    }', j) + 6); };
  const fhStagingOpenRow = new Function('nacl', 'STAGING_ENC_V', fx('_sb64ToBytes') + '\n' + fx('fhStagingOpenRow') + '\nreturn fhStagingOpenRow;')(nacl, 1);

  /* ── a fake IndexedDB: open / transaction / objectStore / get put getAll delete clear ── */
  function fakeIDB() {
    const dbs = {};
    const req = (fn) => { const r = { result: undefined, error: null, onsuccess: null, onerror: null }; queueMicrotask(() => { try { r.result = fn(); r.onsuccess && r.onsuccess({ target: r }); } catch (e) { r.error = e; r.onerror && r.onerror({ target: r }); } }); return r; };
    return {
      open(name) {
        const r = { result: null, onupgradeneeded: null, onsuccess: null, onerror: null };
        queueMicrotask(() => {
          const fresh = !dbs[name]; if (fresh) dbs[name] = { stores: {} };
          const data = dbs[name];
          const db = {
            objectStoreNames: { contains: (s) => !!data.stores[s] },
            createObjectStore: (s) => { data.stores[s] = new Map(); },
            transaction: (s, mode) => {
              const store = data.stores[s];
              const tx = { oncomplete: null, onerror: null, onabort: null, error: null, _n: 0 };
              const done = () => queueMicrotask(() => { if (--tx._n === 0) tx.oncomplete && tx.oncomplete(); });
              const wrap = (fn) => { tx._n++; const r = req(fn); queueMicrotask(() => done()); return r; };
              tx.objectStore = () => ({
                get: (k) => wrap(() => store.get(k)),
                put: (v, k) => wrap(() => { store.set(k, v); return k; }),
                getAll: () => wrap(() => Array.from(store.values())),
                delete: (k) => wrap(() => { store.delete(k); }),
                clear: () => wrap(() => { store.clear(); }),
              });
              // a transaction with no request still completes
              queueMicrotask(() => queueMicrotask(() => { if (tx._n === 0) tx.oncomplete && tx.oncomplete(); }));
              return tx;
            },
          };
          r.result = db;
          if (fresh) r.onupgradeneeded && r.onupgradeneeded();
          r.onsuccess && r.onsuccess();
        });
        return r;
      },
      _dbs: dbs,
    };
  }

  /* ── a DOM just big enough: ids, plus querySelectorAll over a tiny element tree ── */
  function fakeDoc() {
    const els = {};
    const el = (id) => (els[id] = els[id] || { id, innerHTML: '', outerHTML: '', hidden: false, disabled: false, textContent: '', value: '', checked: false, className: '',
      classList: { _s: new Set(), add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); }, has(c) { return this._s.has(c); } }, focus() {} });
    const doc = {
      els, el,
      cards: {},                                      // id -> { x: fake button }
      provs: [],                                      // fake .stm-provs elements
      getElementById: (id) => { if (id === 'csv-result' || id === 'stm-cards') return el(id); const host = el('csv-result').innerHTML; return host.indexOf('id="' + id + '"') >= 0 ? el(id) : null; },
      querySelectorAll: (sel) => {
        let m = /^\.stm-card\[data-stm="([^"]+)"\]$/.exec(sel);
        if (m) { const c = doc.cards[m[1]]; return c ? [{ querySelector: (s) => (s === '.bulk-x' ? c.x : null) }] : []; }
        if (sel === '.stm-provs') return doc.provs;
        if (sel === '#stm-cards') return doc.stmCards ? [el('stm-cards')] : [];
        return [];
      },
    };
    return doc;
  }

  const AES = { enc: 0, dec: 0, inflight: 0, maxInflight: 0 };
  const encBytes = async (b) => { AES.enc++; return b; };
  const decBytes = async (b) => { AES.dec++; AES.inflight++; AES.maxInflight = Math.max(AES.maxInflight, AES.inflight); await new Promise((r) => setTimeout(r, 1)); AES.inflight--; return b; };

  function boot(opts) {
    const calls = { rpc: [], downloads: 0, renders: 0, toasts: [], head: 0 };
    const files = opts.files;
    const rows = () => opts.rows || [];
    const query = (tbl) => { const data = tbl === 'statement_files' ? files : (tbl === 'statement_rows' ? rows() : []);
      const q = { select: () => q, in: () => q, eq: () => q, order: () => q, limit: () => Promise.resolve({ data, error: null }), then: (r) => r({ data, error: null }) }; return q; };
    const doc = fakeDoc();
    const window = {
      fhUser: { id: OWNER }, nacl, fhStagingOpenRow, fhStmtParse: T.fhStmtParse,
      fhPersonalKeyReady: () => true, fhPersonalStagingPrivKey: async () => kp.secretKey,
      fhPersonalEncBytes: encBytes, fhPersonalDecBytes: decBytes,
      fhProviderName: (p) => p, renderCsvReview: () => { calls.renders++; doc.el('csv-result').innerHTML = window.fhStmtCardsHTML(); },
      csvTxrHeadSync: () => { calls.head++; },
      fhTxnReviewSheet: () => {}, toast: (m) => calls.toasts.push(m), csvEntryScope: null,
      sb: { from: query,
            storage: { from: () => ({ download: async () => { calls.downloads++; return { data: { arrayBuffer: async () => blob.buffer.slice(blob.byteOffset, blob.byteOffset + blob.byteLength) }, error: null }; },
                                      remove: async () => ({}) }) },
            functions: { invoke: async () => ({ data: { concepts: {} } }) } },
    };
    let parses = 0;
    new Function('window', 'CSV_MCC_CONCEPT', 'L', '_esc', '_escAttr', '_rpc', 'localStorage', 'sessionStorage', 'document', 'crypto', 'fhParseXlsxBuffer', 'csvFmt', 'indexedDB',
      SRC)(
      window, {}, (vi) => vi, (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;'), (s) => String(s), async (fn, args) => { calls.rpc.push({ fn, args }); if (opts.rpcFail && fn === 'stage_statement_rows') throw new Error('net'); return 0; },
      { _m: {}, getItem(k) { return this._m[k] || null; }, setItem(k, v) { this._m[k] = v; }, removeItem(k) { delete this._m[k]; } }, { setItem() {} }, doc, nodeCrypto.webcrypto,
      async () => { parses++; return GRID; }, (n) => Math.round(n).toLocaleString('vi-VN') + 'đ', opts.idb);
    return { window, doc, calls, parses: () => parses };
  }
  const settle = () => new Promise((r) => setTimeout(r, 20));

  console.log('\n-- C4. the grid is kept by file hash --');
  const idb = fakeIDB();
  const files = [mkFile('w1', 'm1', 'MoMo', 'Sao kê lịch sử giao dịch', { period_from: '2026-06-20', period_to: '2026-09-18' }), mkFile('c1', 'm2', 'VIB', 'SAO KE THE', { period_month: '2026-09' })];
  /* Since S30 a tap that reads and proves goes straight on to the write, and a
     statement that is written leaves the cache. What still reaches the cache
     and stays there is a statement whose flow STOPPED after the read: a column
     check put off with "Để sau", or, as here, a write that did not land. */
  let A = boot({ files, idb, rpcFail: true });
  await A.window.fhStmtLoad();
  await A.window.fhStmtOpen('w1');
  let html = A.doc.el('csv-result').innerHTML;
  t('first open: downloads, unseals, reads the table, and stops on the write that failed', A.calls.downloads === 1 && A.parses() === 1 && /Chưa lưu được/.test(html), { d: A.calls.downloads, p: A.parses() });
  t('the grid is now cached under the file hash', A.window.fhStmtGridCached(sha) === true);
  A.window.fhStmtCancel();
  await A.window.fhStmtOpen('w1');
  html = A.doc.el('csv-result').innerHTML;
  t('"Để sau" then re-open: no download, no parse, straight back to the write', A.calls.downloads === 1 && A.parses() === 1 && A.calls.rpc.filter((c) => c.fn === 'stage_statement_rows').length === 2, { d: A.calls.downloads, p: A.parses() });
  A.window.fhStmtCancel();
  await A.window.fhStmtOpen('w1');
  t('a third tap is still free', A.calls.downloads === 1 && A.parses() === 1);
  await settle();
  const store = idb._dbs['fh-stmt'] && idb._dbs['fh-stmt'].stores.grid;
  t('the grid was sealed into IndexedDB under the hash, for the owner', !!(store && store.get(sha) && store.get(sha).uid === OWNER && store.get(sha).ct), store && Array.from(store.keys()));
  t('what was sealed is the grid, not the file', !!(store && store.get(sha) && JSON.parse(Buffer.from(store.get(sha).ct).toString('utf8')).length === GRID.length));

  // a NEW session (fresh module instance, same device store): the first open is free too
  let B = boot({ files, idb });
  await B.window.fhStmtLoad();
  await B.window.fhStmtOpen('w1');
  t('a new session finds the sealed grid: no download at all', B.calls.downloads === 0 && B.parses() === 0, { d: B.calls.downloads, p: B.parses() });

  // the write landed → the cache entry is gone, memory and store
  await settle();
  t('the rows were queued', B.calls.rpc.some((c) => c.fn === 'stage_statement_rows' && c.args.p_rows.length === 13));
  t('a committed statement leaves the cache (memory and store)', B.window.fhStmtGridCached(sha) === false && !store.get(sha));
  await B.window.fhStmtLoad();                         // (the stub server still lists the card)
  await B.window.fhStmtOpen('w1');
  t('...so opening it again downloads again', B.calls.downloads === 1);

  // dismiss → gone as well
  let C = boot({ files, idb, rpcFail: true });
  await C.window.fhStmtLoad();
  await C.window.fhStmtOpen('c1'); C.window.fhStmtCancel();
  t('(setup) c1 cached', C.window.fhStmtGridCached(sha) === true);
  await C.window.fhStmtDismiss('c1'); await C.window.fhStmtDismiss('c1');   // arm, then confirm
  await settle();
  t('a dismissed statement leaves the cache', C.window.fhStmtGridCached(sha) === false && !store.get(sha));

  // a file picked from the device is not kept (its hash was never checked)
  let D = boot({ files: [Object.assign({}, files[0], { status: 'expired' })], idb });
  await D.window.fhStmtLoad();
  await D.window.fhStmtOpen('w1');
  await D.window.fhStmtFilePicked({ files: [{ name: 'x.xlsx', arrayBuffer: async () => FILE.buffer.slice(0) }] });
  await settle();
  t('a file picked from the device is read but never cached', D.parses() === 1 && D.window.fhStmtGridCached(sha) === false && !store.get(sha));

  // the store keeps the twenty most recent: reach the put through real opens on 23 hashes
  const many = [];
  for (let i = 0; i < 23; i++) {
    const bytes = new Uint8Array(nodeCrypto.randomBytes(64)), h = nodeCrypto.createHash('sha256').update(bytes).digest('hex');
    const m = SB.sealForFamily({ filename: 'f' + i, file_sha256: h }, pub, OWNER, 'mm' + i, { nacl, rng: nodeCrypto.webcrypto }, 'personal');
    many.push({ row: { id: 'x' + i, gmail_message_id: 'mm' + i, part_index: 0, source_provider: 'VIB', received_at: '2026-09-18T16:38:00+00:00', file_ext: 'xlsx', byte_size: 64,
      object_path: OWNER + '/x' + i, meta_sealed: m.sealed, meta_eph_pub: m.eph_pub, meta_nonce: m.nonce, enc_v: m.enc_v, status: 'pending', backfill: false }, bytes, h });
  }
  const F = boot({ files: many.map((x) => x.row), idb, rpcFail: true });
  F.window.sb.storage.from = () => ({ download: async (p) => { const x = many.find((y) => y.row.object_path === p); const b = SB.sealBytes(x.bytes, pub, { nacl, rng: nodeCrypto.webcrypto }); return { data: { arrayBuffer: async () => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) }, error: null }; }, remove: async () => ({}) });
  await F.window.fhStmtLoad();
  for (const x of many) { await F.window.fhStmtOpen(x.row.id); F.window.fhStmtCancel(); }
  await settle(); await settle();
  t('the store holds at most 20 grids after 23 opens, the oldest evicted', store.size === 20 && !store.get(many[0].h) && !store.get(many[2].h) && !!store.get(many[22].h), { size: store.size });

  console.log('\n-- C5. queue rows: cached by id + ciphertext, decrypted in batches --');
  const payload = (i) => Buffer.from(JSON.stringify({ sid: 'w1', date: '2026-09-0' + (1 + (i % 9)), amt: -1000 * (i + 1), memo: 'row ' + i, provider: 'MoMo' })).toString('base64');
  const rowsSrv = []; for (let i = 0; i < 120; i++) rowsSrv.push({ id: 'r' + i, statement_id: 'w1', row_index: i, txn_date: '2026-09-01', payload_enc: payload(i) });
  const opts = { files: [], rows: rowsSrv, idb: fakeIDB() };
  const G = boot(opts);
  AES.dec = 0; AES.maxInflight = 0;
  let out = await G.window.fhStmtLoad();
  t('first load decrypts every row once', out.rows.length === 120 && AES.dec === 120, { n: out.rows.length, dec: AES.dec });
  t('...in batches, not one awaited call at a time', AES.maxInflight >= 20 && AES.maxInflight <= 50, AES.maxInflight);
  t('rows come back in the server\'s order', out.rows.map((r) => r.id).join(',') === rowsSrv.map((r) => r.id).join(','));
  AES.dec = 0;
  out = await G.window.fhStmtLoad();
  t('second load decrypts nothing', out.rows.length === 120 && AES.dec === 0, AES.dec);
  const first = out.rows[0];
  out = await G.window.fhStmtLoad();
  t('each load hands out a fresh row object (downstream mutates rows in place)', out.rows[0] !== first && out.rows[0].id === first.id);
  rowsSrv[5] = Object.assign({}, rowsSrv[5], { payload_enc: payload(500) });
  AES.dec = 0;
  out = await G.window.fhStmtLoad();
  t('a re-sealed row (new ciphertext) is the only one decrypted again', AES.dec === 1 && out.rows[5].amount === 501000, { dec: AES.dec, amt: out.rows[5].amount });
  opts.rows = rowsSrv.slice(0, 100);
  await G.window.fhStmtLoad();
  t('rows gone from the server leave the cache', G.window.fhStmtRowCacheSize() === 100, G.window.fhStmtRowCacheSize());
  const big = []; for (let i = 0; i < 3005; i++) big.push({ id: 'b' + i, statement_id: 'w1', row_index: i, txn_date: '2026-09-01', payload_enc: payload(i) });
  opts.rows = big;
  await G.window.fhStmtLoad();
  t('the row cache is capped at 3000', G.window.fhStmtRowCacheSize() === 3000, G.window.fhStmtRowCacheSize());

  console.log('\n-- C6. arm / chips repaint in place --');
  const H = boot({ files, idb: fakeIDB() });
  await H.window.fhStmtLoad();
  H.window.renderCsvReview(); H.calls.renders = 0;
  const btn = (id) => (H.doc.cards[id] = { x: { className: 'bulk-x', textContent: '✕' } }).x;
  const x1 = btn('w1'), x2 = btn('c1');
  H.window.fhStmtDismiss('w1');
  t('arming swaps that card\'s button to "Bỏ?" with no full repaint', x1.className === 'bulk-x armed' && x1.textContent === 'Bỏ?' && H.calls.renders === 0, { cls: x1.className, renders: H.calls.renders });
  H.window.fhStmtDismiss('c1');
  t('arming another card disarms the first, still no full repaint', x1.className === 'bulk-x' && x1.textContent === '✕' && x2.className === 'bulk-x armed' && H.calls.renders === 0, { a: x1.className, b: x2.className, renders: H.calls.renders });
  delete H.doc.cards.c1; delete H.doc.cards.w1;
  H.window.fhStmtDismiss('w1');
  t('a card not on screen falls back to the full render', H.calls.renders === 1, H.calls.renders);
  t('the card markup carries its id for the in-place swap', /class="stm-card" data-stm="w1"/.test(H.window.fhStmtCardsHTML()));
  t('the body keeps a wrapper to repaint into', /^<div id="stm-cards">/.test(H.window.fhStmtCardsHTML()));

  H.calls.renders = 0; H.calls.head = 0;
  H.doc.stmCards = true; H.doc.provs = [{ outerHTML: '' }];
  H.window.fhStmtProvTgl('VIB');
  const body = H.doc.el('stm-cards').innerHTML;
  t('a bank chip repaints the cards in place: VIB only, no full render', (body.match(/class="stm-card/g) || []).length === 1 && /Sao kê VIB/.test(body) && !/Sao kê MoMo/.test(body) && H.calls.renders === 0, { renders: H.calls.renders });
  t('...the chips are swapped in place and the toolbox header is synced', /fhStmtProvTgl\('VIB'\)/.test(H.doc.provs[0].outerHTML) && / on"/.test(H.doc.provs[0].outerHTML) && H.calls.head === 1, H.doc.provs[0].outerHTML.slice(0, 120));
  H.doc.provs = [];
  H.window.fhStmtProvTgl('VIB');
  t('no chips on screen: the full render is the fallback', H.calls.renders === 1);

  console.log('\n' + (fail ? fail + ' FAILED, ' : 'ALL ') + pass + ' PASSED');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
