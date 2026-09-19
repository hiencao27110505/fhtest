#!/usr/bin/env node
/* src/js-data/78-receipt-scan.js — the client side of receipt scan.
   Runs the REAL file in a vm context with a record-based fake DOM, a fake `sb`
   and a fake fetch, so loosening the real file fails here instead of passing
   against a duplicate (the house pattern, tools/autotxn-connected-live.test.js). */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let pass = 0, fail = 0;
const t = (n, ok, d) => { console.log((ok ? '  PASS  ' : '  FAIL  ') + n + (!ok && d ? '  -> ' + d : '')); ok ? pass++ : fail++; };
const settle = (ms) => new Promise((r) => setTimeout(r, ms || 0));

const SRC = fs.readFileSync(path.join(__dirname, '..', 'src', 'js-data', '78-receipt-scan.js'), 'utf8');

function harness(opts) {
  opts = opts || {};
  const rec = { html: {}, toasts: [], fetches: [], inserts: [], opened: [], closed: 0, bulk: null, personal: 0, cam: false };
  const store = {};
  const els = {};
  let seq = 0;
  function mk(id) {
    const cls = new Set();
    const e = { id, hidden: false, disabled: false, textContent: '', _html: '', value: '', style: {}, dataset: {}, attrs: {},
      videoWidth: 0, videoHeight: 0, srcObject: null, files: [],
      classList: { add: (c) => cls.add(c), remove: (c) => cls.delete(c), contains: (c) => cls.has(c) },
      querySelector: (sel) => sel === '.modal-body' ? mk(id + ':body') : (sel === '.peek-del' ? el('peek-del') : null),
      querySelectorAll: () => [], setAttribute: (k, v) => { e.attrs[k] = v; }, getAttribute: (k) => e.attrs[k] || null,
      click() {}, insertBefore() {}, appendChild() {}, play: async () => {},
      getContext: () => ({ drawImage() {} }), toDataURL: () => 'data:image/jpeg;base64,CAPTURED' };
    Object.defineProperty(e, 'innerHTML', { get: () => e._html, set: (v) => { e._html = v; rec.html[id] = v; } });
    return e;
  }
  function el(id) { if (!els[id]) els[id] = mk(id); return els[id]; }

  // fake supabase: consents table + inserts
  let consents = opts.consents || [];
  const sb = {
    from: (table) => {
      const q = { _filters: [] };
      const chain = () => q;
      q.select = chain; q.in = chain; q.order = chain; q.limit = chain; q.eq = chain;
      q.insert = (payload) => { rec.inserts.push({ table, payload }); return Promise.resolve(opts.insertError ? { error: { message: opts.insertError } } : { data: [payload], error: null }); };
      q.then = (ok, err) => Promise.resolve({ data: table === 'user_consents' ? consents : [] }).then(ok, err);
      return q;
    },
    auth: { getSession: async () => ({ data: { session: { access_token: 'tok' } } }) },
  };

  const ctx = {
    console, setTimeout, clearTimeout, Promise, Math, Number, String, Array, Object, JSON, Date, RegExp, Error,
    document: { getElementById: el, createElement: (tag) => mk('new:' + tag + (++seq)), querySelector: () => null },
    navigator: { onLine: opts.onLine !== false, mediaDevices: undefined },
    localStorage: { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } },
    MutationObserver: function () { return { observe() {}, disconnect() {} }; },
    fetch: async (url, init) => {
      rec.fetches.push({ url, init });
      const r = opts.reply ? opts.reply(JSON.parse(init.body)) : { status: 500 };
      return { ok: r.status === 200, status: r.status, json: async () => r.body };
    },
    sb,
    L: (vi) => vi,
    toast: (m) => rec.toasts.push(m),
    _friendly: (e) => 'friendly:' + ((e && e.message) || e),
    fmt: (n) => n + 'đ', amtToInput: (n) => String(n), parseAmtBase: (s) => parseFloat(String(s).replace(',', '.')) || 0, curMult: () => 1000,
    familyCatForConcept: (c) => ({ Groceries: 'Ăn uống', Health: 'Sức khoẻ' })[c] || '',
    catValid: (c) => !!c, isVi: () => true, esc: (s) => String(s), isoDate: () => '2026-09-19', TODAY: new Date('2026-09-19'), CUR: 'VND',
    fmtDayMon: () => '19 thg 9', setTxt() {}, selectChipByVal() {}, chosen: () => opts.chosenCat || '', refreshExCta() {},
    readPhoto: (f, cb) => cb('data:image/jpeg;base64,FILE' + (f.name || '')),
    openExpense: (p) => rec.opened.push(p), closeExpense: () => { rec.closed++; }, closeModals: () => { rec.closed++; },
    submitBulk: (o) => { rec.bulk = { opts: o, rows: ctx.window.bulkRows }; }, _submitPersonalExpense: async () => { rec.personal++; rec.bulk = { rows: ctx.window.bulkRows }; },
    go() {}, segTo() {}, peekHideActions() {}, closePeek() {}, _closeOv() {},
    fhPersonalData: () => ({ key: opts.personalKey !== false }),
    fhCompressImage: async (s) => s, fhPhotoTakenOn: () => opts.taken || null,
  };
  ctx.window = ctx;
  ctx.el = el; ctx.rec = rec; ctx.store = store;
  vm.createContext(ctx);
  vm.runInContext(SRC, ctx, { filename: '78-receipt-scan.js' });
  return ctx;
}
const A = 'data:image/jpeg;base64,AAAA', B = 'data:image/jpeg;base64,BBBB';
const GOOD = { is_transaction: true, amount: 337900, currency: 'VND', date: '2026-09-12', time: '14:23', counterparty: 'CIRCLE K', memo: '', category: 'Groceries', direction: 'debit', flags: { amount_unverified: false } };

(async () => {
  console.log('\n-- receipts are evidence, never memories --');
  let h = harness();
  t('a storage path starting rcpt_ is a receipt', h.fhIsReceiptSrc('https://x/family-media/fid/rcpt_1_ab.jpg'));
  t('…including the encrypted variant', h.fhIsReceiptSrc('https://x/family-media/fid/rcpt_1_ab.jpg.enc'));
  t('an ordinary photo path is not', !h.fhIsReceiptSrc('https://x/family-media/fid/1_ab.jpg'));
  h.__fhScanSeed({ items: [{ src: 'data:x' }] });
  t('a data URI in the batch is a receipt before it is uploaded', h.fhIsReceiptSrc('data:x'));

  console.log('\n-- the consent sheet says what the law requires --');
  h = harness();
  await h.fhScanConsentSheet({});
  const html = h.rec.html['fh-sheet-body'] || '';
  t('WHAT: data types', html.indexOf('Gửi đi những gì') >= 0);
  t('WHY: purpose', html.indexOf('Để làm gì') >= 0);
  t('WHO ELSE: Google is named', html.indexOf('Google') >= 0);
  t('HOW: processing method', html.indexOf('tự vào sổ') >= 0);
  t('HOW LONG: retention', html.indexOf('Giữ bao lâu') >= 0);
  t('RIGHTS: how to stop', html.indexOf('Muốn dừng') >= 0);
  t('WHO IS ANSWERABLE: controller and contact', html.indexOf('gichisreading@gmail.com') >= 0);
  t('agreeing opens the camera, not a form', html.indexOf('Đồng ý và mở máy ảnh') >= 0);

  console.log('\n-- nothing is sent before a consent row is confirmed --');
  h = harness({ insertError: 'boom' });
  await h.fhScanConsentAgree(h.el('scan-agree'));
  t('a failed insert: no camera, no cache, a friendly toast', !h.el('scan-cam').classList.contains('on') && !h.store['fh-scan-consent-v1'] && h.rec.toasts.some((m) => /friendly:boom/.test(m)));
  h = harness();
  await h.fhScanConsentAgree(h.el('scan-agree'));
  t('a confirmed insert writes kind receipt_scan v1, caches, and opens the camera', h.rec.inserts[0].table === 'user_consents' && h.rec.inserts[0].payload.kind === 'receipt_scan' && h.store['fh-scan-consent-v1'] === '1' && h.el('scan-cam').classList.contains('on'));
  h = harness({ consents: [] });
  h.fhScanStart('family'); await settle(10);
  t('a first scan with no consent on record shows the sheet, never the camera', (h.rec.html['fh-sheet-body'] || '').indexOf('Đồng ý và mở máy ảnh') >= 0 && !h.el('scan-cam').classList.contains('on'));
  h = harness({ consents: [{ kind: 'receipt_scan_withdraw', version: 1, consented_at: '2026-09-18' }] });
  h.fhScanStart('family'); await settle(10);
  t('after a withdrawal the sheet is asked again', (h.rec.html['fh-sheet-body'] || '').indexOf('Đồng ý và mở máy ảnh') >= 0);
  h = harness({ consents: [{ kind: 'receipt_scan', version: 1, consented_at: '2026-09-18' }] });
  h.fhScanStart('family'); await settle(10);
  t('with consent on record the camera opens', h.el('scan-cam').classList.contains('on'));
  h = harness({ personalKey: false });
  h.fhScanStart('personal');
  t('a locked personal ledger refuses with the existing toast', h.rec.toasts.some((m) => /Mở khoá sổ cá nhân/.test(m)));

  console.log('\n-- reading: the only place read values become form values --');
  h = harness({ reply: () => ({ status: 200, body: GOOD }) });
  h.__fhScanSeed({ items: [{ src: A, state: 'new' }] });
  h.fhScanDone(); await settle(20);
  t('one request per photo, bearer token, compressed image as base64', h.rec.fetches.length === 1 && /Bearer tok/.test(h.rec.fetches[0].init.headers.Authorization) && JSON.parse(h.rec.fetches[0].init.body).mime === 'image/jpeg');
  await h.fhScanSave(h.el('scan-save'));
  let row = h.rec.bulk && h.rec.bulk.rows[0];
  t('raw 337900 becomes 337.9 base units: divided by curMult exactly once', row && row.amt === '337.9', JSON.stringify(row));
  t('the concept maps to the FAMILY category, never itself', row && row.cat === 'Ăn uống');
  t('note is the counterparty; date and time from the image', row && row.note === 'CIRCLE K' && row.date === '2026-09-12' && row.time === '14:23');
  t('the row carries its own receipt and source scan', row && row.photos[0] === A && row.source === 'scan');
  t('the family batch commits through submitBulk({prepared, stay})', h.rec.bulk.opts && h.rec.bulk.opts.prepared === true && h.rec.bulk.opts.stay === true);
  t('the batch toast names count and total, from receipts', h.rec.toasts.some((m) => /Đã ghi 1 khoản từ hóa đơn/.test(m)));

  h = harness({ reply: () => ({ status: 200, body: Object.assign({}, GOOD, { date: null }) }), taken: '2026-09-10' });
  h.__fhScanSeed({ items: [{ src: A, state: 'new' }] }); h.fhScanDone(); await settle(20);
  await h.fhScanSave(h.el('scan-save'));
  t('no date on the image: the photo capture date', h.rec.bulk.rows[0].date === '2026-09-10');
  h = harness({ reply: () => ({ status: 200, body: Object.assign({}, GOOD, { date: null }) }) });
  h.__fhScanSeed({ items: [{ src: A, state: 'new' }] }); h.fhScanDone(); await settle(20);
  await h.fhScanSave(h.el('scan-save'));
  t('no date anywhere: today', h.rec.bulk.rows[0].date === '2026-09-19');

  h = harness({ reply: () => ({ status: 200, body: Object.assign({}, GOOD, { flags: { amount_unverified: true } }) }) });
  h.__fhScanSeed({ items: [{ src: A, state: 'new' }] }); h.fhScanDone(); await settle(20);
  t('an unverified amount renders the amber check line and still counts as ready', /Kiểm tra lại số tiền/.test(h.rec.html['scan-rows']) && !h.el('scan-save').disabled);

  h = harness({ reply: () => ({ status: 200, body: Object.assign({}, GOOD, { currency: 'USD' }) }) });
  h.__fhScanSeed({ items: [{ src: A, state: 'new' }] }); h.fhScanDone(); await settle(20);
  t('a foreign currency is never guessed into ₫: the row is typed by hand', /Chưa đọc được/.test(h.rec.html['scan-rows']) && h.el('scan-save').disabled);
  h = harness({ reply: () => ({ status: 429 }) });
  h.__fhScanSeed({ items: [{ src: A, state: 'new' }] }); h.fhScanDone(); await settle(20);
  t('a rate limit leaves the row unread with its photo, save stays grey', /Chưa đọc được/.test(h.rec.html['scan-rows']) && h.el('scan-save').disabled);
  h = harness({ reply: () => ({ status: 200, body: { is_transaction: false } }) });
  h.__fhScanSeed({ items: [{ src: A, state: 'new' }] }); h.fhScanDone(); await settle(20);
  t('not a receipt: unread, never a phantom amount', /Chưa đọc được/.test(h.rec.html['scan-rows']));
  h = harness({ reply: () => ({ status: 200, body: Object.assign({}, GOOD, { category: 'Fun' }) }) });
  h.__fhScanSeed({ items: [{ src: A, state: 'new' }] }); h.fhScanDone(); await settle(20);
  t('a concept the family has no category for asks for a pick and is not ready', /Chạm để chọn danh mục/.test(h.rec.html['scan-rows']) && h.el('scan-save').disabled);

  console.log('\n-- offline: nothing is sent --');
  h = harness({ onLine: false, reply: () => ({ status: 200, body: GOOD }) });
  h.__fhScanSeed({ items: [{ src: A, state: 'new' }, { src: B, state: 'new' }] }); h.fhScanDone(); await settle(20);
  t('no request is made', h.rec.fetches.length === 0);
  t('the rows open with their photos, marked not sent, save grey', /Chưa gửi được/.test(h.rec.html['scan-rows']) && h.el('scan-save').disabled && /Không có mạng/.test(h.el('scan-note').textContent));

  console.log('\n-- editing a row hands its fields back to the review --');
  h = harness({ reply: () => ({ status: 200, body: GOOD }), chosenCat: 'Ăn uống' });
  h.__fhScanSeed({ items: [{ src: A, state: 'new' }] }); h.fhScanDone(); await settle(20);
  h.fhScanRowTap(0); await settle(80);
  t('the existing expense form opens for that row with its photo and scope', h.rec.opened.length === 1 && h.rec.opened[0].photos[0] === A && h.rec.opened[0].scope === 'family');
  h.el('ex-amt').value = '400'; h.el('ex-note').value = 'Circle K sáng';
  t('while a row is open, the form Save is intercepted', h.fhScanCollectEdit() === true);
  await h.fhScanSave(h.el('scan-save'));
  row = h.rec.bulk.rows[0];
  t('a changed amount is stamped scan-edited, with the edited values', row.source === 'scan-edited' && row.amt === '400' && row.note === 'Circle K sáng');
  h = harness();
  t('with no row open the form Save is not intercepted', h.fhScanCollectEdit() === false);

  console.log('\n-- the personal book --');
  h = harness({ reply: () => ({ status: 200, body: GOOD }), consents: [{ kind: 'receipt_scan', version: 1, consented_at: '2026-09-18' }] });
  h.__fhScanSeed({ scope: 'personal', items: [{ src: A, state: 'new' }] }); h.fhScanDone(); await settle(20);
  t('the header names the personal book', /Sổ cá nhân/.test(h.el('scan-dest').textContent));
  await h.fhScanSave(h.el('scan-save'));
  t('a personal batch commits through _submitPersonalExpense with source on the row', h.rec.personal === 1 && h.rec.bulk.rows[0].source === 'scan');

  console.log('\n-- cancel arms; what is left stays --');
  h = harness();
  h.__fhScanSeed({ items: [{ src: A, amt: 85, cat: 'Ăn uống', note: 'A' }, { src: B, state: 'bad' }] });
  t('Save counts only the ready rows', h.el('scan-save').textContent === 'Lưu 1');
  h.fhScanReviewCancel();
  t('first tap arms and does not close', h.rec.closed === 0 && /Bỏ 2 ảnh\?/.test(h.el('scan-cancel').textContent));
  h.fhScanReviewCancel();
  t('second tap closes', h.rec.closed === 1);
  h = harness();
  h.__fhScanSeed({ items: [{ src: A, amt: 85, cat: 'Ăn uống', note: 'A' }, { src: B, state: 'bad' }] });
  await h.fhScanSave(h.el('scan-save'));
  t('after saving, the unread row stays in the review', h.fhScanHasBatch() === true && /Chưa đọc được/.test(h.rec.html['scan-rows']));

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
