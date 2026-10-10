#!/usr/bin/env node
/* A statement that asks nothing of the person stages itself when the review
 * queue opens (statement-capture-spec S31). `node tools/statement-auto.test.js`
 *
 * The story this pins, 2026-10-10: receiving a statement used to cost a tap on
 * its card and a second tap on a summary before a single row reached the queue.
 * Now a fresh statement whose file is not locked, or whose password this device
 * remembers, and whose column reading is proved or was confirmed before, is in
 * the queue as rows by the time the queue paints. Everything that still needs
 * the person stays a card, exactly as it was.
 *
 * The server here is a small stateful fake (cards, rows, the staging RPC with
 * its real "already opened is a no-op" rule), the sealing is REAL, and the code
 * under test is the shipped 77-statement-capture.js, whole.
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

  const OWNER = '11111111-1111-4111-8111-111111111111';
  const kp = nacl.box.keyPair(), pub = Buffer.from(kp.publicKey).toString('base64');
  const GRID = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'statements', 'ewallet.grid.json'), 'utf8'));
  /* The same statement with its balance column removed: nothing to prove the
     reading against, so the vocabulary's reading has to be confirmed by a person. */
  const BAL = T.fhStmtParse(GRID, null, { provider: 'MoMo' }).table.roles.balance;
  const GRID_NOBAL = GRID.map((r) => r.filter((_, i) => i !== BAL));
  const SRC = fs.readFileSync(path.join(__dirname, '..', 'src', 'js-data', '77-statement-capture.js'), 'utf8');
  const src18 = fs.readFileSync(path.join(__dirname, '..', 'src', 'js-data', '18-staging-keys.js'), 'utf8');
  const fx = (name) => { const j = src18.indexOf('function ' + name); if (j < 0) { console.error(name + ' not found'); process.exit(1); } return src18.slice(j, src18.indexOf('\n    }', j) + 6); };
  const fhStagingOpenRow = new Function('nacl', 'STAGING_ENC_V', fx('_sb64ToBytes') + '\n' + fx('fhStagingOpenRow') + '\nreturn fhStagingOpenRow;')(nacl, 1);

  /* ── the fake server: one per test, shared by every "session" booted on it ── */
  function server() {
    const sv = { files: [], rows: [], blobs: {}, content: {}, downloads: 0, staged: [], removed: [], fnCalls: 0, resolvedErr: false, rpcFail: 0, rpcGate: null };
    let seq = 0;
    /* A statement file: random bytes stand in for the spreadsheet; what they
       "contain" (grid, and the password that opens them) is looked up by hash. */
    sv.add = (id, provider, o) => {
      o = o || {};
      const bytes = new Uint8Array(nodeCrypto.randomBytes(256));
      const sha = nodeCrypto.createHash('sha256').update(bytes).digest('hex');
      const msg = 'm-' + id;
      const m = SB.sealForFamily(Object.assign({ filename: id + '.xlsx', subject: o.subject || 'Sao kê lịch sử giao dịch', file_sha256: sha, period_month: o.month || '2026-09' }, {}), pub, OWNER, msg, { nacl, rng: nodeCrypto.webcrypto }, 'personal');
      const f = { id, gmail_message_id: msg, part_index: 0, source_provider: provider, received_at: '2026-09-' + String(28 - (seq++)).padStart(2, '0') + 'T16:38:00+00:00', file_ext: 'xlsx', byte_size: 256,
        object_path: OWNER + '/' + id + '.sealed', meta_sealed: m.sealed, meta_eph_pub: m.eph_pub, meta_nonce: m.nonce, enc_v: m.enc_v, status: 'pending', backfill: !!o.backfill };
      sv.files.push(f);
      sv.blobs[f.object_path] = SB.sealBytes(bytes, pub, { nacl, rng: nodeCrypto.webcrypto });
      sv.content[sha] = { grid: o.grid || GRID, password: o.password || '', unsupported: !!o.unsupported };
      return f;
    };
    sv.rpc = async (fn, args) => {
      if (fn !== 'stage_statement_rows') return null;
      sv.staged.push(args);
      if (sv.rpcGate) await sv.rpcGate;
      if (sv.rpcFail > 0) { sv.rpcFail--; throw new Error('net'); }
      const f = sv.files.find((x) => x.id === args.p_statement_id);
      if (!f) throw new Error('statement_not_found');
      if (f.status === 'opened') return sv.rows.filter((r) => r.statement_id === f.id).length;   // 0139: a second call is a no-op
      if (f.status !== 'pending') throw new Error('statement_not_pending');
      args.p_rows.forEach((r) => sv.rows.push(Object.assign({ statement_id: f.id }, r)));
      f.status = 'opened';
      return args.p_rows.length;
    };
    return sv;
  }
  const mkStore = () => ({ _m: {}, getItem(k) { return this._m[k] || null; }, setItem(k, v) { this._m[k] = v; }, removeItem(k) { delete this._m[k]; } });

  /* ── one session of the app on a device (its localStorage outlives sessions) ── */
  function boot(sv, ls, opts) {
    opts = opts || {};
    const els = {};
    const el = (id) => (els[id] = els[id] || { id, innerHTML: '', hidden: false, disabled: false, textContent: '', value: '', checked: false,
      classList: { _s: new Set(), add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); }, has(c) { return this._s.has(c); } }, focus() {} });
    const document = { getElementById: (id) => { if (id === 'csv-result') return el(id); const host = el('csv-result').innerHTML; return host.indexOf('id="' + id + '"') >= 0 ? el(id) : null; } };
    const calls = { reopened: 0, toasts: [], badge: 0, said: [], heat: [], parses: 0 };
    const answer = (data, error) => { const q = { select: () => q, in: () => q, eq: () => q, order: () => q, limit: () => Promise.resolve({ data, error: error || null }), then: (r) => r({ data, error: error || null }) }; return q; };
    const window = {
      fhUser: { id: OWNER }, nacl, fhStagingOpenRow, fhStmtParse: T.fhStmtParse,
      fhPersonalKeyReady: () => !opts.locked, fhPersonalStagingPrivKey: async () => kp.secretKey,
      fhPersonalEncBytes: async (b) => b, fhPersonalDecBytes: async (b) => b,
      fhProviderName: (p) => p, renderCsvReview: () => { el('csv-result').innerHTML = window.fhStmtCardsHTML(); },
      fhTxnReviewSheet: () => { calls.reopened++; }, toast: (m) => calls.toasts.push(m), csvEntryScope: null,
      fhRefreshStagedCount: () => { calls.badge++; }, fhHeat: { tick: (n) => calls.heat.push(n) },
      sb: {
        from: (tbl) => tbl === 'statement_files' ? answer(sv.files.filter((f) => f.status === 'pending' || f.status === 'expired'))
          : tbl === 'statement_rows' ? answer(sv.rows.map((r) => ({ id: r.id, statement_id: r.statement_id, row_index: r.row_index, txn_date: r.txn_date, payload_enc: r.payload_enc })))
          : answer(sv.resolvedErr ? null : [], sv.resolvedErr ? new Error('offline') : null),
        storage: { from: () => ({
          download: async (p) => { sv.downloads++; if (opts.offline) return { data: null, error: new Error('offline') }; const b = sv.blobs[p]; return { data: { arrayBuffer: async () => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) }, error: null }; },
          remove: async (paths) => { sv.removed.push(...paths); return {}; } }) },
        functions: { invoke: async () => { sv.fnCalls++; if (opts.slowHints) await new Promise((r) => setTimeout(r, opts.slowHints)); return { data: { concepts: { 'REVI COFFEE': 'Dining' } } }; } } },
    };
    const parseXlsx = async (ab, password) => {
      calls.parses++;
      const c = sv.content[nodeCrypto.createHash('sha256').update(Buffer.from(ab)).digest('hex')];
      if (c.unsupported) throw new Error('xlsx_enc_unsupported');
      if (c.password && !password) throw new Error('xlsx_encrypted');
      if (c.password && password !== c.password) throw new Error('bad_password');
      return c.grid;
    };
    new Function('window', 'CSV_MCC_CONCEPT', 'L', '_esc', '_escAttr', '_rpc', 'localStorage', 'sessionStorage', 'document', 'crypto', 'fhParseXlsxBuffer', 'csvFmt', SRC)(
      window, {}, (vi) => vi, (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;'), (s) => String(s), sv.rpc,
      ls, { setItem() {} }, document, nodeCrypto.webcrypto, parseXlsx, (n) => Math.round(n).toLocaleString('vi-VN') + 'đ');
    const open = () => window.fhStmtLoad({ auto: true, say: (m) => calls.said.push(m) });
    return { window, el, calls, open };
  }
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  console.log('\n-- 1. an unlocked statement that proves: rows by the time the queue paints --');
  let sv = server(), ls = mkStore();
  sv.add('w1', 'MoMo');
  let A = boot(sv, ls);
  let out = await A.open();
  t('one write, 13 rows, no tap', sv.staged.length === 1 && sv.staged[0].p_statement_id === 'w1' && sv.staged[0].p_rows.length === 13, sv.staged.length);
  t('the same load hands the rows to the queue', out.rows.length === 13 && out.rows.every((r) => r._stmt && r.statement_id === 'w1'), out.rows.length);
  t('...already decrypted: the device wrote them', out.rows[0].raw_extracted && typeof out.rows[0].amount === 'number');
  t('the card is gone from this load and from the list', out.cards.length === 0 && A.window.fhStmtCards().length === 0 && out.staged.length === 1 && out.staged[0].n === 13);
  t('the sealed file is deleted (S13)', sv.removed.length === 1 && sv.removed[0] === OWNER + '/w1.sealed');
  t('no step was painted and none owns the body', A.el('csv-result').innerHTML === '' && A.window.fhStmtFlowActive() === false);
  t('the loader was told which statement it is reading', A.calls.said.length === 1 && /^Đang đọc Sao kê MoMo/.test(A.calls.said[0]), A.calls.said);
  let html = A.window.fhStmtCardsHTML();
  t('one line says what went in, and under which account', /class="stm-note" data-stm-note="w1"/.test(html) && /13 khoản đã vào hàng chờ · Ví\sMoMo/.test(html) && /fhStmtNoteSee\('w1'\)/.test(html), (html.match(/stm-sub">[^<]*/g) || []));
  t('merchant names were offered for a category hint, once', sv.fnCalls === 1);
  const sealed = (call) => call.p_rows.map((r) => JSON.parse(Buffer.from(r.payload_enc, 'base64').toString('utf8')));
  const revi = (rows) => rows.filter((p) => /REVI COFFEE/.test(p.counterparty + ' ' + p.memo));
  t('...and the hint is sealed into the rows it was for', revi(sealed(sv.staged[0])).length > 0 && revi(sealed(sv.staged[0])).every((p) => p.concept === 'Dining'), revi(sealed(sv.staged[0])).map((p) => p.concept));
  await wait(5);
  t('the badge is asked to recount: one file became thirteen rows', A.calls.badge === 1);
  t('the meter counts the pass', A.calls.heat.filter((n) => n === 'fhStmtAuto').length === 1);
  out = await A.open();
  t('the next open has nothing left to stage', sv.staged.length === 1 && out.rows.length === 13 && out.staged.length === 0);
  t('the line is still there while its rows are', /stm-note/.test(A.window.fhStmtCardsHTML()));
  sv.rows.length = 0;
  await A.open();
  t('...and leaves with the last of them', !/stm-note/.test(A.window.fhStmtCardsHTML()));

  console.log('\n-- 2. only the queue\'s own open does this --');
  sv = server(); ls = mkStore(); sv.add('w1', 'MoMo');
  A = boot(sv, ls);
  out = await A.window.fhStmtLoad();
  t('a plain load stages nothing and downloads nothing', sv.staged.length === 0 && sv.downloads === 0 && out.cards.length === 1);

  console.log('\n-- 3. the history backlog is never staged unasked (S11) --');
  sv = server(); ls = mkStore(); sv.add('old1', 'MoMo', { backfill: true }); sv.add('old2', 'VIB', { backfill: true });
  A = boot(sv, ls);
  out = await A.open();
  t('two backlog statements: no download, no write, both still cards', sv.downloads === 0 && sv.staged.length === 0 && out.cards.length === 2);
  await A.window.fhStmtOpen('old1');
  t('a tap on one still opens it, and it goes straight in', sv.staged.length === 1 && sv.staged[0].p_statement_id === 'old1' && A.calls.reopened === 1);

  console.log('\n-- 4. a locked file waits for its password, and is not fetched again to find that out --');
  sv = server(); ls = mkStore(); sv.add('c1', 'VIB', { password: 'hunter2', subject: 'SAO KE THE TIN DUNG VIB THANG 08 NAM 2026', month: '2026-08' });
  A = boot(sv, ls);
  out = await A.open();
  t('first open: fetched once, found locked, left as a card', sv.downloads === 1 && sv.staged.length === 0 && out.cards.length === 1 && A.el('csv-result').innerHTML === '');
  await A.open(); await A.open();
  t('later opens in the same session do not fetch it again', sv.downloads === 1);
  let B = boot(sv, ls);
  await B.open();
  t('nor does the next session: the reason is remembered on the device', sv.downloads === 1 && sv.staged.length === 0);

  console.log('\n-- 5. "no password needed (anymore)": remember it once, and the next statement walks in --');
  await B.window.fhStmtOpen('c1');
  t('a tap asks for the password', /File này có mật khẩu/.test(B.el('csv-result').innerHTML) && sv.downloads === 2);
  t('the remember switch says what it buys', /lần sau tự vào hàng chờ/.test(B.el('csv-result').innerHTML));
  B.el('stm-pw').value = 'hunter2'; B.el('stm-rem').checked = true;
  B.window.fhStmtUnlock(); await wait(150);
  t('the right password goes straight to the queue: no summary in between', sv.staged.length === 1 && sv.staged[0].p_statement_id === 'c1' && B.calls.reopened === 1 && B.window.fhStmtFlowActive() === false, sv.staged.length);
  sv.add('c2', 'VIB', { password: 'hunter2', subject: 'SAO KE THE TIN DUNG VIB THANG 09 NAM 2026', month: '2026-09' });
  sv.add('m9', 'MoMo', { password: 'other' });
  let C = boot(sv, ls);                               // next month, a new session
  out = await C.open();
  t('next month\'s VIB statement stages itself with the remembered password', sv.staged.length === 2 && sv.staged[1].p_statement_id === 'c2' && out.rows.some((r) => r.statement_id === 'c2'));
  t('a locked statement from another bank still waits', out.cards.length === 1 && out.cards[0].id === 'm9');

  console.log('\n-- 6. a remembered password that stopped working is forgotten, not retried forever --');
  sv = server(); ls = mkStore(); sv.add('c1', 'VIB', { password: 'old' });
  A = boot(sv, ls);
  await A.open();
  await A.window.fhStmtOpen('c1'); A.el('stm-pw').value = 'old'; A.el('stm-rem').checked = true; A.window.fhStmtUnlock(); await wait(150);
  sv.add('c2', 'VIB', { password: 'new' });           // the bank changed the rule
  B = boot(sv, ls);
  const d0 = sv.downloads;
  out = await B.open();
  t('the statement is fetched, the old password fails, the card stays', sv.downloads === d0 + 1 && sv.staged.length === 1 && out.cards.length === 1);
  await B.open();
  t('...and the dead password is not tried on every open', sv.downloads === d0 + 1);
  await B.window.fhStmtOpen('c2');
  t('a tap asks afresh, without a "wrong password" scolding', /File này có mật khẩu/.test(B.el('csv-result').innerHTML) && !/chưa đúng/.test(B.el('csv-result').innerHTML));

  console.log('\n-- 7. a reading that cannot be proved stops and asks, once per format --');
  sv = server(); ls = mkStore(); sv.add('n1', 'MoMo', { grid: GRID_NOBAL });
  A = boot(sv, ls);
  out = await A.open();
  t('no balance, no totals: nothing is staged unseen', sv.staged.length === 0 && out.cards.length === 1 && A.el('csv-result').innerHTML === '');
  const d1 = sv.downloads;
  await A.open();
  t('asking again costs no download: the grid is kept', sv.downloads === d1 && sv.staged.length === 0);
  await A.window.fhStmtOpen('n1');
  html = A.el('csv-result').innerHTML;
  t('a tap shows which column was read as what', /Tụi mình đọc cột thế này/.test(html) && /fhStmtMappingOk/.test(html) && /chưa ghi vào sổ/.test(html));
  await A.window.fhStmtMappingOk();
  t('"Đúng rồi" sends the rows in', sv.staged.length === 1 && sv.staged[0].p_rows.length === 13);
  sv.add('n2', 'MoMo', { grid: GRID_NOBAL });
  B = boot(sv, ls);
  out = await B.open();
  t('the next statement of that format is not asked about again: it stages itself', sv.staged.length === 2 && sv.staged[1].p_statement_id === 'n2' && out.cards.length === 0);
  sv.add('n3', 'VIB', { grid: GRID_NOBAL });
  out = await B.open();
  t('the same columns from another sender are a different format, and still ask', sv.staged.length === 2 && out.cards.length === 1 && out.cards[0].id === 'n3');

  console.log('\n-- 8. bounded: the person asked for a queue, not a wait --');
  sv = server(); ls = mkStore(); sv.add('a', 'MoMo'); sv.add('b', 'VIB'); sv.add('c', 'TPBank');
  A = boot(sv, ls);
  out = await A.open();
  t('three statements waiting: two are staged in one open', sv.staged.length === 2 && out.cards.length === 1, sv.staged.length);
  out = await A.open();
  t('the third on the next', sv.staged.length === 3 && out.cards.length === 0);
  sv = server(); ls = mkStore(); sv.add('w1', 'MoMo');
  A = boot(sv, ls, { slowHints: 6000 });
  const t0 = Date.now();
  out = await A.open();
  t('a slow category hint is not waited for past four seconds', Date.now() - t0 < 5500 && sv.staged.length === 1 && out.rows.length === 13, Date.now() - t0);
  await wait(2200);                                   // the hint has come back by now
  const shown = out.rows.filter((r) => /REVI COFFEE/.test(r.counterparty + ' ' + r.raw_extracted.memo));
  t('...the rows go in without it', revi(sealed(sv.staged[0])).length > 0 && revi(sealed(sv.staged[0])).every((p) => p.concept === ''), revi(sealed(sv.staged[0])).map((p) => p.concept));
  out = await A.open();
  t('...and a late answer does not land on the copy this device keeps of rows already sealed', shown.length > 0 && out.rows.filter((r) => /REVI COFFEE/.test(r.counterparty + ' ' + r.raw_extracted.memo)).every((r) => r.raw_extracted.category_hint === ''));

  console.log('\n-- 9. two opens at once, two devices at once --');
  sv = server(); ls = mkStore(); sv.add('w1', 'MoMo');
  A = boot(sv, ls);
  let release; sv.rpcGate = new Promise((r) => { release = r; });
  const p1 = A.open(), p2 = A.open();
  await wait(60); release(); sv.rpcGate = null;
  const [o1, o2] = await Promise.all([p1, p2]);
  t('two opens of the queue share one pass: ONE write', sv.staged.length === 1 && o1.rows.length === 13 && o2.rows.length === 13 && o2.cards.length === 0, sv.staged.length);
  sv = server(); sv.add('w1', 'MoMo');
  A = boot(sv, mkStore()); B = boot(sv, mkStore());   // two devices, each with its own storage
  const [da, db] = await Promise.all([A.open(), B.open()]);
  t('two devices race: both write, the server keeps one set', sv.staged.length === 2 && sv.rows.length === 13, { calls: sv.staged.length, rows: sv.rows.length });
  t('...and both queues show those 13 rows, none of them twice', da.rows.length === 13 && db.rows.length === 13 && new Set(da.rows.map((r) => r.id).concat(db.rows.map((r) => r.id))).size === 13);

  console.log('\n-- 10. when it cannot be done, it costs the shortcut and nothing else --');
  sv = server(); ls = mkStore(); sv.add('w1', 'MoMo'); sv.rpcFail = 1;
  A = boot(sv, ls);
  out = await A.open();
  t('a write that fails: the card stays, nothing is deleted, nobody is toasted', out.cards.length === 1 && sv.removed.length === 0 && A.calls.toasts.length === 0 && !/stm-note/.test(A.window.fhStmtCardsHTML()));
  await A.open();
  t('it is not hammered on every open of this session', sv.staged.length === 1);
  B = boot(sv, ls);
  out = await B.open();
  t('the next session tries again, and it lands', sv.staged.length === 2 && out.rows.length === 13 && out.cards.length === 0);
  sv = server(); ls = mkStore(); sv.add('w1', 'MoMo');
  A = boot(sv, ls, { offline: true });
  out = await A.open();
  t('offline: the queue still loads, the card stays', out.cards.length === 1 && sv.staged.length === 0);
  sv = server(); ls = mkStore(); sv.add('w1', 'MoMo'); sv.resolvedErr = true;
  A = boot(sv, ls);
  out = await A.open();
  t('"did they already decide on these rows?" cannot be answered: nothing is staged unseen', sv.staged.length === 0 && out.cards.length === 1);
  sv.resolvedErr = true;
  await A.window.fhStmtOpen('w1');
  t('...while a tap, with the person watching, still shows the rows', sv.staged.length === 1);
  sv = server(); ls = mkStore(); sv.add('u1', 'VIB', { unsupported: true });
  A = boot(sv, ls);
  await A.open(); B = boot(sv, ls); await B.open();
  t('a lock this device cannot open is found out once', sv.downloads === 1 && sv.staged.length === 0);
  sv = server(); ls = mkStore(); sv.add('w1', 'MoMo');
  A = boot(sv, ls, { locked: true });
  out = await A.open();
  t('a locked personal ledger: nothing is fetched, the card says to unlock', sv.downloads === 0 && out.cards.length === 1 && out.cards[0].keyLocked === true);

  console.log('\n-- 11. a statement with nothing new says so, once --');
  sv = server(); ls = mkStore(); sv.add('e1', 'MoMo', { grid: GRID });
  A = boot(sv, ls);
  /* every row already decided: the lookup answers with each fingerprint asked for */
  A.window.sb.from = ((orig) => (tbl) => {
    if (tbl !== 'resolved_statement_rows') return orig(tbl);
    let asked = [];
    const q = { select: () => q, in: (_c, v) => { asked = v; return q; }, then: (r) => r({ data: asked.map((fp) => ({ row_fp: fp })), error: null }) };
    return q;
  })(A.window.sb.from);
  out = await A.open();
  t('the card is closed with no rows written', sv.staged.length === 1 && sv.staged[0].p_rows.length === 0 && out.cards.length === 0 && out.rows.length === 0);
  html = A.window.fhStmtCardsHTML();
  t('the line says there was nothing new, with nothing to "Xem"', /Không có khoản mới/.test(html) && !/fhStmtNoteSee/.test(html));
  await A.open();
  t('...and is gone by the next open', !/stm-note/.test(A.window.fhStmtCardsHTML()));

  console.log('\n-- 12. disconnecting forgets why cards were left --');
  sv = server(); ls = mkStore(); sv.add('c1', 'VIB', { password: 'x' });
  A = boot(sv, ls);
  await A.open();
  t('(setup) the reason is on the device', Object.keys(ls._m).some((k) => k.indexOf('fh-stmt-auto:') === 0));
  await A.window.fhStmtPurge();
  t('purge removes it with the other on-device memories', !Object.keys(ls._m).some((k) => k.indexOf('fh-stmt-') === 0), Object.keys(ls._m));

  console.log('\n' + (fail ? fail + ' FAILED, ' : 'ALL ') + pass + ' PASSED');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
