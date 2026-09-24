#!/usr/bin/env node
/* The unlock flow end to end on the device, with REAL sealing: open a card, read the
 * table, show the preview, and queue the rows. `node tools/statement-flow.test.js`
 *
 * Written after the first real use (2026-09-19), which asked for three things this
 * pins: the person SEES the rows before agreeing to queue them; the button that queues
 * them visibly works and works ONCE however many times it is tapped; and the cards can
 * be narrowed by bank. It also re-walks the path that broke on day one (sealed details
 * -> file hash -> open), this time through the real fhStmtOpen.
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
  const FILE = new Uint8Array(nodeCrypto.randomBytes(2048));                  // stands in for the .xlsx bytes
  const sha = nodeCrypto.createHash('sha256').update(FILE).digest('hex');
  const GRID = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'statements', 'ewallet.grid.json'), 'utf8'));
  const mkFile = (id, msg, provider, subject, extra) => {
    const m = SB.sealForFamily(Object.assign({ filename: id + '.xlsx', subject, file_sha256: sha }, extra || {}), pub, OWNER, msg, { nacl, rng: nodeCrypto.webcrypto }, 'personal');
    return { id, gmail_message_id: msg, part_index: 0, source_provider: provider, received_at: '2026-09-18T16:38:00+00:00', file_ext: 'xlsx', byte_size: 100,
      object_path: OWNER + '/' + id + '.sealed', meta_sealed: m.sealed, meta_eph_pub: m.eph_pub, meta_nonce: m.nonce, enc_v: m.enc_v, status: 'pending', backfill: false };
  };
  const files = [
    mkFile('w1', 'm1', 'MoMo', 'Sao kê lịch sử giao dịch', { period_from: '2026-06-20', period_to: '2026-09-18' }),
    mkFile('c1', 'm2', 'VIB', 'SAO KE THE TIN DUNG VIB CASH BACK THANG 09 NAM 2026', { period_month: '2026-09' }),
    mkFile('a1', 'm3', 'VIB', 'Sao kê tài khoản', {}),
  ];
  const blob = SB.sealBytes(FILE, pub, { nacl, rng: nodeCrypto.webcrypto });

  const src18 = fs.readFileSync(path.join(__dirname, '..', 'src', 'js-data', '18-staging-keys.js'), 'utf8');
  const fx = (name) => { const j = src18.indexOf('function ' + name); return src18.slice(j, src18.indexOf('\n    }', j) + 6); };
  const fhStagingOpenRow = new Function('nacl', 'STAGING_ENC_V', fx('_sb64ToBytes') + '\n' + fx('fhStagingOpenRow') + '\nreturn fhStagingOpenRow;')(nacl, 1);

  // a DOM just big enough for the flow
  const els = {};
  const el = (id) => (els[id] = els[id] || { id, innerHTML: '', hidden: false, disabled: false, textContent: '', value: '', checked: false,
    classList: { _s: new Set(), add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); }, has(c) { return this._s.has(c); } }, focus() {} });
  const document = { getElementById: (id) => { if (id === 'csv-result') return el(id); const host = el('csv-result').innerHTML; return host.indexOf('id="' + id + '"') >= 0 ? el(id) : null; } };

  const calls = { rpc: [], removed: [], reopened: 0, toasts: [] };
  let rpcGate = null;                                                         // lets the test hold the RPC "in flight"
  const _rpc = async (fn, args) => { calls.rpc.push({ fn, args }); if (rpcGate) await rpcGate; return (args.p_rows || []).length; };
  const query = (rows) => { const q = { select: () => q, in: () => q, eq: () => q, order: () => q, limit: () => Promise.resolve({ data: rows, error: null }), then: (r) => r({ data: rows, error: null }) }; return q; };
  const window = {
    fhUser: { id: OWNER }, nacl, fhStagingOpenRow, fhStmtParse: T.fhStmtParse,
    fhPersonalKeyReady: () => true, fhPersonalStagingPrivKey: async () => kp.secretKey,
    fhPersonalEncBytes: async (b) => b, fhPersonalDecBytes: async (b) => b,
    fhProviderName: (p) => p, renderCsvReview: () => { el('csv-result').innerHTML = window.fhStmtCardsHTML(); },
    fhTxnReviewSheet: () => { calls.reopened++; }, toast: (m) => calls.toasts.push(m), csvEntryScope: null,
    sb: { from: (tbl) => query(tbl === 'statement_files' ? files : []),
          storage: { from: () => ({ download: async () => ({ data: { arrayBuffer: async () => blob.buffer.slice(blob.byteOffset, blob.byteOffset + blob.byteLength) }, error: null }),
                                    remove: async (paths) => { calls.removed.push(...paths); return {}; } }) },
          functions: { invoke: async () => ({ data: { concepts: {} } }) } },
  };
  new Function('window', 'CSV_MCC_CONCEPT', 'L', '_esc', '_escAttr', '_rpc', 'localStorage', 'sessionStorage', 'document', 'crypto', 'fhParseXlsxBuffer', 'csvFmt',
    fs.readFileSync(path.join(__dirname, '..', 'src', 'js-data', '77-statement-capture.js'), 'utf8'))(
    window, {}, (vi) => vi, (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;'), (s) => String(s), _rpc,
    { _m: {}, getItem(k) { return this._m[k] || null; }, setItem(k, v) { this._m[k] = v; }, removeItem(k) { delete this._m[k]; } }, { setItem() {} }, document, nodeCrypto.webcrypto,
    async () => GRID, (n) => Math.round(n).toLocaleString('vi-VN') + 'đ');

  console.log('\n-- 1. the cards: told apart, and narrowed by bank --');
  await window.fhStmtLoad();
  let html = window.fhStmtCardsHTML();
  t('two VIB statements read apart: card vs account', /Sao kê VIB thẻ tín dụng · tháng 09\/2026/.test(html) && /Sao kê VIB tài khoản/.test(html), html.match(/Sao kê VIB[^<]*/g));
  t('the wallet says it is a wallet, with its period', /Sao kê MoMo ví · 20\/06 – 18\/09/.test(html), html.match(/Sao kê MoMo[^<]*/g));
  /* The chips moved into the Chọn nhanh drawer (activation feedback 2026-09-24):
     the body stays chips-free and the drawer embeds fhStmtPickChipsHTML(). */
  var chips = window.fhStmtPickChipsHTML();
  t('a bank filter appears once there is more than one bank — in the drawer, not the body',
    /fhStmtProvTgl\('VIB'\)/.test(chips) && /fhStmtProvTgl\('MoMo'\)/.test(chips) && /Tất cả/.test(chips) && !/stm-provs/.test(html));
  window.fhStmtProvTgl('VIB'); html = el('csv-result').innerHTML;
  t('VIB only: both VIB cards, no MoMo card', (html.match(/class="stm-card/g) || []).length === 2 && !/Sao kê MoMo/.test(html));
  t('...and the counts on the chips still describe the whole list', /Tất cả <span class="ctp-n">3<\/span>/.test(window.fhStmtPickChipsHTML()));
  window.fhStmtProvTgl('VIB'); html = el('csv-result').innerHTML;
  t('tapping the same bank again clears the filter', (html.match(/class="stm-card/g) || []).length === 3);
  t('a card is a tappable row with a chevron and the queue\'s own remove control', /class="stm-tap" onclick="fhStmtOpen/.test(html) && /class="chev"/.test(html) && /class="bulk-x"/.test(html) && !/Mở sao kê/.test(html));
  t('the row says what the statement is of', /Thẻ tín dụng/.test(html) && /Tài khoản/.test(html));

  console.log('\n-- 2. open -> the rows are SHOWN before anything is queued --');
  await window.fhStmtOpen('w1');
  html = el('csv-result').innerHTML;
  t('the file opened: sealed details, hash check, table read', /csv-unlock-title">13 giao dịch</.test(html), html.slice(0, 160));
  t('failed rows are counted, not shown', /1 thất bại/.test(html) && (html.match(/class="stm-prow/g) || []).length === 13);
  t('each row shows when, what and how much', /REVI COFFEE/.test(html) && /27\/08/.test(html) && /−55\.000đ/.test(html), (html.match(/stm-pamt[^>]*>[^<]*/g) || []).slice(0, 3));
  t('money in is marked as money in', /stm-pamt in">\+2\.000\.000đ/.test(html));
  t('newest first', html.indexOf('27/08') < html.indexOf('01/08'));
  t('a top-up says what the app thinks it is', /chuyển nội bộ\?/.test(html));
  t('a payment funded by a bank says so', /qua ngân hàng liên kết/.test(html));
  t('nothing has been written yet', calls.rpc.length === 0 && /chưa ghi vào sổ/.test(html));

  console.log('\n-- 3. the button: works once, and says it is working --');
  let release; rpcGate = new Promise((r) => { release = r; });
  const first = window.fhStmtCommit();
  await new Promise((r) => setTimeout(r, 60));                                // encryption done, RPC now "in flight"
  const btn = el('stm-go');
  t('busy at once: disabled, spinner, and it says what it is doing', btn.disabled === true && btn.classList.has('busy') && /stm-spin/.test(btn.innerHTML) && /Đang đưa vào hàng chờ/.test(btn.innerHTML), btn.innerHTML);
  t('the way out is hidden while it works', el('stm-back').hidden === true);
  await window.fhStmtCommit(); await window.fhStmtCommit(); await window.fhStmtCommit();   // an impatient thumb
  t('three more taps while it is in flight: still ONE write', calls.rpc.filter((c) => c.fn === 'stage_statement_rows').length === 1, calls.rpc.length);
  release(); await first;
  const staged = calls.rpc.find((c) => c.fn === 'stage_statement_rows');
  t('13 rows queued for this statement, in order', staged.args.p_statement_id === 'w1' && staged.args.p_rows.length === 13 && staged.args.p_rows.every((r, i) => r.row_index === i && /^\d{4}-\d\d-\d\d$/.test(r.txn_date)));
  const one = JSON.parse(Buffer.from(staged.args.p_rows[0].payload_enc, 'base64').toString('utf8'));
  t('each row carries its statement\'s title, for "Chọn nhanh"', one.stitle === 'Sao kê MoMo ví · 20/06 – 18/09', one.stitle);
  t('the sealed file is deleted the moment the rows are in', calls.removed.length === 1 && calls.removed[0] === OWNER + '/w1.sealed');
  t('and the review reopens on the new rows', calls.reopened === 1);

  console.log('\n-- 4. "Chọn nhanh" can find a statement\'s rows --');
  window._fhStagedRows = [window.fhStmtAsStaged('r0', one), { id: 'e1', raw_extracted: {} }];
  const st = window.fhStmtOfCand({ rowIndex: 0 });
  t('a statement row names its statement', st && st.id === 'w1' && st.title === 'Sao kê MoMo ví · 20/06 – 18/09', st);
  t('an email row names none', window.fhStmtOfCand({ rowIndex: 1 }) === null);
  const old = window.fhStmtAsStaged('r9', Object.assign({}, one, { stitle: undefined }));
  window._fhStagedRows = [old];
  t('a row written before titles rode along falls back to the bank', window.fhStmtOfCand({ rowIndex: 0 }).title === 'Sao kê MoMo');

  console.log('\n' + (fail ? fail + ' FAILED, ' : 'ALL ') + pass + ' PASSED');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
