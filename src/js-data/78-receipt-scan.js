/* ═══ Receipt scan — capture → read → review → commit ═══════════════════════
   docs/briefs/receipt-scan.md. Capture is Apple's document-scanner skeleton;
   review reuses the ledger row; the commit goes through the EXISTING save paths
   (submitBulk / _submitPersonalExpense) so write-through, provenance (0100
   `source`) and photo upload stay exactly as they are.

   Scope (CLAUDE.md §3): this is the js-data MODULE — every inline-handler target
   is assigned on window. `sb`, `_friendly`, `fhField` are module-scope siblings
   (all js-data files concatenate into one <script type="module">); `L`, `toast`,
   `fmt`, `amtToInput`, `parseAmtBase`, `curMult`, `familyCatForConcept`,
   `readPhoto`, `openExpense`, `closeExpense`, `submitBulk`, … are js-ui globals.

   Privacy: NOTHING is sent before a `receipt_scan` consent row is confirmed. What
   is sent is the compressed copy (fhCompressImage strips EXIF/GPS). The reply is
   fields only; the model's transcription never reaches this file. */
(function () {
  const KIND = 'receipt_scan', KIND_WD = 'receipt_scan_withdraw', VERSION = 1;
  // Per-device memo of an accepted consent, so a later scan can acquire the
  // camera synchronously inside the tap (iOS drops the gesture across an await).
  // Re-verified against the table on every use; a withdrawal anywhere clears it.
  const CACHE_KEY = 'fh-scan-consent-v' + VERSION;
  const MAX = 10, CONC = 3, ENDPOINT = '/api/receipt-extract';
  const S = { scope: 'family', items: [], open: false, editing: null, stream: null, pending: null,
              camArmed: false, camTimer: null, cancelArmed: false, cancelTimer: null, receipt: new Set(),
              peekRestore: null, filesPending: 0, newSig: [] };

  const $ = (id) => document.getElementById(id);
  const vi = () => (typeof isVi === 'function' ? isVi() : true);
  const isoToday = () => (typeof isoDate === 'function' && typeof TODAY !== 'undefined') ? isoDate(TODAY) : new Date().toISOString().slice(0, 10);

  /* ── receipts are evidence, never memories ─────────────────────────────── */
  // Before upload a receipt is a data URI held in this set; after upload its
  // storage path starts with rcpt_ (40-txn-writes-outbox.js), so every device
  // can tell it apart from a memory with no column.
  window.fhIsReceiptSrc = function (src) {
    if (!src) return false;
    if (S.receipt.has(src)) return true;
    return /\/rcpt_[^/?]*(\?|$)/.test(String(src));
  };
  window.fhScanHasBatch = () => S.open && S.items.length > 0;
  window.fhScanIsNew = (t) => !!(S.newSig && S.newSig.length && t && S.newSig.indexOf((t.note || '') + '|' + (t.amt || 0)) >= 0);

  /* ── consent ────────────────────────────────────────────────────────────── */
  function cachedOk() { try { return localStorage.getItem(CACHE_KEY) === '1'; } catch (e) { return false; } }
  function cache(v) { try { if (v) localStorage.setItem(CACHE_KEY, '1'); else localStorage.removeItem(CACHE_KEY); } catch (e) {} }
  async function consentOk() {
    try {
      const r = await sb.from('user_consents').select('kind,version,consented_at')
        .in('kind', [KIND, KIND_WD]).order('consented_at', { ascending: false }).limit(1);
      const row = r && r.data && r.data[0];
      const ok = !!(row && row.kind === KIND && row.version >= VERSION);
      cache(ok);
      return ok;
    } catch (e) { return cachedOk(); }   // unreadable (offline): trust the device memo
  }
  function esc2(s) { return (typeof esc === 'function') ? esc(String(s == null ? '' : s)) : String(s == null ? '' : s); }
  function cstRow(q, a) { return '<div class="cst-row"><div class="cst-rt">' + esc2(q) + '</div><div class="cst-rs">' + esc2(a) + '</div></div>'; }
  function openSheet(html) {
    const b = $('fh-sheet-body'); if (!b) return;
    b.innerHTML = html;
    $('scrim').classList.add('on'); $('fh-sheet').classList.add('on');
  }
  // The seven items the law requires (docs/PDPL-COMPLIANCE.md §5c): purpose ·
  // data types · processing method · third parties · rights · retention ·
  // controller + contact. tools/receipt-scan.test.js asserts each one.
  function consentBody() {
    return '<div class="cst-body">'
      + cstRow(L('Gửi đi những gì?', 'What is sent?'), L('Một bản sao nhỏ của từng ảnh, đã xoá vị trí và thông tin máy chụp.', 'A smaller copy of each photo, with location and camera details removed.'))
      + cstRow(L('Để làm gì?', 'What for?'), L('Chỉ để đọc số tiền, ngày và nơi mua, rồi điền sẵn khoản chi. Không bán, không quảng cáo.', 'Only to read the amount, date and shop, then prefill an expense. Never sold, never ads.'))
      + cstRow(L('Ai đọc ảnh?', 'Who reads the photo?'), L('AI của Google đọc tự động. Máy chủ Earthy chuyển đi, không giữ lại.', 'Google’s AI reads it automatically. Earthy’s server passes it on and keeps nothing.'))
      + cstRow(L('Có tự vào sổ không?', 'Does anything save by itself?'), L('Không. Bạn xem lại từng khoản rồi mới lưu.', 'No. You check every item before it is saved.'))
      + cstRow(L('Giữ bao lâu?', 'How long is it kept?'), L('Earthy không giữ bản gửi đi. Google xử lý theo điều khoản của gói đang dùng.', 'Earthy keeps no copy. Google handles it under the terms of the plan in use.'))
      + '</div>';
  }
  function consentMeta(withDecline) {
    return '<div class="cst-meta">' + esc2(L(
      'Muốn dừng: Cài đặt, Quyền riêng tư, Quét hóa đơn. Vận hành: Trang và Hiên · gichisreading@gmail.com · Chi tiết: Chính sách quyền riêng tư.' + (withDecline ? ' Nếu không đồng ý, chỉ tính năng này không bật.' : ''),
      'To stop: Settings, Privacy, Receipt scan. Operated by Trang and Hien · gichisreading@gmail.com · Details: Privacy Policy.' + (withDecline ? ' If you decline, only this feature stays off.' : ''))) + '</div>';
  }
  window.fhScanConsentSheet = async function (opts) {
    opts = opts || {};
    const ro = !!opts.readOnly;
    let status = '';
    if (ro) {
      let when = null;
      try {
        const r = await sb.from('user_consents').select('consented_at').eq('kind', KIND).order('consented_at', { ascending: false }).limit(1);
        when = r && r.data && r.data[0] ? new Date(r.data[0].consented_at) : null;
      } catch (e) {}
      const camSvg = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4.5 8.6h3L9.2 6h5.6l1.7 2.6h3v9.8h-15z"/><circle cx="12" cy="13.2" r="3.1"/></svg>';
      status = '<div class="cst-group"><div class="cst-lrow"><span class="cst-ic">' + camSvg + '</span>'
        + '<span class="cst-ltxt"><span class="cst-lt">' + esc2(L('Đang gửi ảnh cho AI', 'Sending photos to AI')) + '</span>'
        + '<span class="cst-ls">' + esc2(when ? L('Bạn đã đồng ý ngày ', 'You agreed on ') + fmtDayMon(when) : L('Chưa có xác nhận nào được ghi nhận.', 'No confirmation on record.')) + '</span></span>'
        + '<button type="button" class="cst-stop" onclick="fhScanStop(this)">' + esc2(L('Dừng', 'Stop')) + '</button></div></div>';
    }
    openSheet(
      '<div class="cst-kicker">' + esc2(ro ? L('QUÉT HÓA ĐƠN', 'RECEIPT SCAN') : L('ĐỒNG Ý XỬ LÝ DỮ LIỆU CÁ NHÂN · QUÉT HÓA ĐƠN', 'PERSONAL DATA CONSENT · RECEIPT SCAN')) + '</div>'
      + '<div class="sheet-h">' + esc2(L('Bạn chụp, AI đọc, bạn xem lại.', 'You snap it, AI reads it, you check it.')) + '</div>'
      + status + consentBody() + consentMeta(!ro)
      + (ro
        ? '<button class="btn-skip" onclick="_closeOv()">' + esc2(L('Đóng', 'Close')) + '</button>'
        : '<button class="cta" id="scan-agree" onclick="fhScanConsentAgree(this)">' + esc2(L('Đồng ý và mở máy ảnh', 'Agree and open the camera')) + '</button>'
          + '<button class="btn-skip" onclick="_closeOv()">' + esc2(L('Để sau', 'Not now')) + '</button>'));
  };
  window.fhScanConsentAgree = async function (btn) {
    preacquire();                                  // inside the tap, before any await (iOS)
    if (btn) { btn.disabled = true; btn.textContent = L('Đang ghi nhận…', 'Recording…'); }
    let res;
    try { res = await sb.from('user_consents').insert({ kind: KIND, version: VERSION }); } catch (e) { res = { error: e }; }
    const dup = res && res.error && /duplicate key|already exists/i.test(res.error.message || '');
    if (res && res.error && !dup) {
      // The record IS the consent: no row, no camera, nothing sent.
      stopCam();
      if (btn) { btn.disabled = false; btn.textContent = L('Đồng ý và mở máy ảnh', 'Agree and open the camera'); }
      toast(_friendly(res.error));
      return;
    }
    cache(true);
    window._closeOv && _closeOv();
    showCam();
  };
  window.fhScanStop = async function (btn) {
    if (!btn) return;
    if (!btn.dataset.armed) {
      btn.dataset.armed = '1';
      btn.textContent = L('Chắc chắn dừng? Bấm lần nữa', 'Sure? Tap again to stop');
      setTimeout(function () { if (btn && btn.dataset) { delete btn.dataset.armed; btn.textContent = L('Dừng', 'Stop'); } }, 10000);
      return;
    }
    btn.disabled = true; btn.textContent = L('Đang dừng…', 'Stopping…');
    let res;
    try { res = await sb.from('user_consents').insert({ kind: KIND_WD, version: VERSION }); } catch (e) { res = { error: e }; }
    if (res && res.error && !/duplicate key|already exists/i.test(res.error.message || '')) {
      btn.disabled = false; delete btn.dataset.armed; btn.textContent = L('Dừng', 'Stop');
      toast(_friendly(res.error)); return;
    }
    cache(false);
    window._closeOv && _closeOv();
    toast(L('Đã dừng gửi ảnh cho AI', 'Stopped sending photos to AI'));
  };

  /* ── camera ─────────────────────────────────────────────────────────────── */
  const CONSTRAINTS = { video: { facingMode: { ideal: 'environment' }, width: { ideal: 2560 }, height: { ideal: 1920 } }, audio: false };
  function preacquire() {
    if (S.pending || S.stream) return;
    if (!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia)) return;
    try { S.pending = navigator.mediaDevices.getUserMedia(CONSTRAINTS); S.pending.catch(function () {}); }
    catch (e) { S.pending = null; }
  }
  function say(t) { const e = $('scan-say'); if (e) e.textContent = t; }
  async function startCam() {
    const v = $('scan-video'); if (!v) return;
    let stream = null; const p = S.pending; S.pending = null;
    try {
      stream = p ? await p : ((navigator.mediaDevices && navigator.mediaDevices.getUserMedia) ? await navigator.mediaDevices.getUserMedia(CONSTRAINTS) : null);
    } catch (e) { stream = null; }
    if (!stream) { camFail(); return; }
    S.stream = stream; v.hidden = false;
    try { v.srcObject = stream; await v.play(); } catch (e) {}
    try {
      const t = stream.getVideoTracks()[0];
      const caps = t && t.getCapabilities ? t.getCapabilities() : {};
      const fb = $('scan-flash'); if (fb) fb.classList.toggle('off', !caps.torch);
    } catch (e) {}
    const sh = $('scan-shutter'); if (sh) sh.hidden = false;
    narrate();
  }
  function camFail() {
    const sh = $('scan-shutter'); if (sh) sh.hidden = true;
    const v = $('scan-video'); if (v) v.hidden = true;
    say(L('Máy ảnh không dùng được ở đây. Chọn ảnh từ thư viện.', 'The camera is not available here. Pick from the library.'));
  }
  function stopCam() {
    try { if (S.stream) S.stream.getTracks().forEach(function (t) { try { t.stop(); } catch (e) {} }); } catch (e) {}
    S.stream = null;
    const p = S.pending; S.pending = null;
    if (p) p.then(function (s) { try { s.getTracks().forEach(function (t) { t.stop(); }); } catch (e) {} }, function () {});
    const v = $('scan-video'); if (v) { try { v.srcObject = null; } catch (e) {} }
  }
  function showCam() {
    const c = $('scan-cam'); if (!c) return;
    S.camArmed = false;
    c.classList.add('on');
    renderTray();
    startCam();
  }
  function hideCam() { const c = $('scan-cam'); if (c) c.classList.remove('on'); stopCam(); }
  function narrate() {
    const n = S.items.length;
    if (!S.stream) return;
    if (n >= MAX) say(L('Đủ ' + MAX + ' ảnh, tối đa một lần · chạm Xong', MAX + ' photos, the most for one batch · tap Done'));
    else if (n) say(L('Đã chụp ' + n + ' · chụp tiếp hoặc chạm Xong', n + ' captured · keep going or tap Done'));
    else say(L('Đưa hóa đơn vào khung', 'Line the receipt up in the frame'));
  }
  function renderTray() {
    const t = $('scan-tray'); if (!t) return;
    const n = S.items.length;
    t.innerHTML = n
      ? '<span class="th" style="background-image:url(' + S.items[n - 1].src + ')"><span class="n">' + n + '</span></span>' + esc2(L('Xong', 'Done'))
      : '';
    const sh = $('scan-shutter'); if (sh) sh.disabled = n >= MAX;
    narrate();
  }
  function add(src) {
    if (!src) return false;
    if (S.items.length >= MAX) { toast(L('Tối đa ' + MAX + ' ảnh một lần', 'Up to ' + MAX + ' photos at a time')); return false; }
    S.receipt.add(src);
    S.items.push({ src: src, taken: (window.fhPhotoTakenOn ? window.fhPhotoTakenOn(src) : null) || null, state: 'new',
                   amt: '', readAmt: 0, note: '', cat: '', date: '', time: '', edited: false });
    renderTray();
    return true;
  }
  window.fhScanCapture = function () {
    const v = $('scan-video');
    if (!v || !S.stream || !v.videoWidth) { toast(L('Máy ảnh chưa sẵn sàng', 'Camera not ready yet')); return; }
    try {
      const c = document.createElement('canvas'); c.width = v.videoWidth; c.height = v.videoHeight;
      c.getContext('2d').drawImage(v, 0, 0);
      add(c.toDataURL('image/jpeg', 0.92));
    } catch (e) { toast(L('Chụp chưa được, thử lại', 'Could not capture, try again')); }
  };
  window.fhScanFlash = async function () {
    try {
      const t = S.stream && S.stream.getVideoTracks()[0]; if (!t) return;
      const on = !!(t.getSettings && t.getSettings().torch);
      await t.applyConstraints({ advanced: [{ torch: !on }] });
    } catch (e) {}
  };
  window.fhScanLibrary = function () { const f = $('scan-file'); if (f) f.click(); };
  window.fhScanFiles = function (input) {
    const files = Array.prototype.slice.call((input && input.files) || []);
    if (input) input.value = '';
    if (!files.length) return;
    const room = Math.max(0, MAX - S.items.length);
    if (files.length > room) toast(L('Chỉ thêm được ' + room + ' ảnh nữa', 'Only ' + room + ' more will fit'));
    const take = files.slice(0, room);
    S.filesPending += take.length;
    take.forEach(function (f) {
      readPhoto(f, function (src) {
        if (src) add(src);
        S.filesPending--;
        // No live camera here (a desktop, or a blocked camera): a library pick is the whole batch.
        if (S.filesPending === 0 && !S.stream && S.items.length) window.fhScanDone();
      });
    });
  };
  window.fhScanDone = function () {
    if (!S.items.length) { toast(L('Chưa có ảnh nào', 'No photos yet')); return; }
    hideCam();
    openReview();
    readAll();
  };
  window.fhScanCancel = function () {
    const fresh = S.items.filter(function (i) { return i.state === 'new'; }).length;
    if (fresh && !S.camArmed) {
      S.camArmed = true;
      toast(L('Chạm lần nữa để bỏ ' + fresh + ' ảnh vừa chụp', 'Tap again to discard the ' + fresh + (fresh === 1 ? ' photo' : ' photos') + ' you just captured'));
      clearTimeout(S.camTimer); S.camTimer = setTimeout(function () { S.camArmed = false; }, 3500);
      return;
    }
    S.camArmed = false;
    S.items = S.items.filter(function (i) { return i.state !== 'new'; });   // an in-progress review keeps its rows
    hideCam();
    if (S.open) render();
  };

  /* ── start ──────────────────────────────────────────────────────────────── */
  window.fhScanStart = function (scope) {
    S.scope = scope === 'personal' ? 'personal' : 'family';
    if (S.scope === 'personal') {
      const pd = window.fhPersonalData && fhPersonalData();
      if (!pd || !pd.key) { toast(L('Mở khoá sổ cá nhân ở tab Cá nhân trước', 'Unlock your personal ledger in the Cá nhân tab first')); return; }
    }
    if (S.open && S.items.length) { openReview(); return; }   // a batch in progress: back to it
    S.items = []; S.open = false;
    if (cachedOk()) {
      preacquire();                                // inside the tap
      showCam();
      consentOk().then(function (ok) { if (!ok) { hideCam(); window.fhScanConsentSheet({}); } });   // withdrawn elsewhere: ask again
      return;
    }
    consentOk().then(function (ok) { if (ok) showCam(); else window.fhScanConsentSheet({}); });
  };
  window.fhScanMore = function () { preacquire(); showCam(); };

  /* ── review ─────────────────────────────────────────────────────────────── */
  function openReview() {
    S.open = true; S.cancelArmed = false;
    const m = $('scan-review'); if (!m) return;
    $('scrim').classList.add('on');
    m.classList.add('on'); m.style.transform = ''; m.style.transition = '';
    const b = m.querySelector('.modal-body'); if (b) b.scrollTop = 0;
    render();
  }
  function closeReview() {
    S.open = false; S.items = []; S.cancelArmed = false;
    if (typeof closeModals === 'function') closeModals();
  }
  function isReady(it) { return (it.state === 'ok' || it.state === 'flag') && parseAmtBase(it.amt || '') > 0 && (typeof catValid !== 'function' || catValid(it.cat)); }
  function total(list) { return list.reduce(function (a, it) { return a + (parseAmtBase(it.amt || '') || 0); }, 0); }
  function rowHtml(it, i) {
    const tile = '<div class="r-ico ph" style="background-image:url(' + it.src + ')' + (it.state === 'reading' || it.state === 'new' ? ';opacity:.5' : '') + '" onclick="event.stopPropagation();fhScanPeek(' + i + ')"></div>';
    let title, sub, right;
    if (it.state === 'reading' || it.state === 'new') {
      title = '<div class="r-t" style="color:var(--muted)">' + esc2(L('Đang đọc…', 'Reading…')) + '</div>';
      sub = '<div class="r-s"><span class="scan-skel" style="width:92px;height:13px"></span></div>';
      right = '<div class="r-amt num"><span class="scan-skel" style="min-width:78px;height:17px"></span></div>';
    } else if (it.state === 'bad' || it.state === 'offline') {
      title = '<div class="r-t" style="color:var(--muted)">' + esc2(it.state === 'offline' ? L('Chưa gửi được', 'Not sent yet') : L('Chưa đọc được', 'Not read yet')) + '</div>';
      sub = '<div class="r-s scan-act">' + esc2(L('Chạm để nhập tay', 'Tap to type it in')) + '</div>';
      right = '<div class="r-amt num" style="color:var(--muted-soft)">—</div>';
    } else {
      title = '<div class="r-t">' + esc2(it.note || L('Khoản chi', 'Expense')) + '</div>';
      const noCat = typeof catValid === 'function' && !catValid(it.cat);
      sub = it.state === 'flag'
        ? '<div class="r-s scan-warn">' + esc2(L('Kiểm tra lại số tiền', 'Check the amount')) + '</div>'
        : (noCat ? '<div class="r-s scan-act">' + esc2(L('Chạm để chọn danh mục', 'Tap to pick a category')) + '</div>'
                 : '<div class="r-s">' + esc2(fmtDayMon(new Date(it.date + 'T00:00:00')) + (it.time ? ' · ' + it.time : '')) + '</div>');
      right = '<div class="r-amt num">' + fmt(parseAmtBase(it.amt || '')) + '</div>' + (noCat ? '' : '<div class="r-cat">' + esc2(it.cat) + '</div>');
    }
    return '<div class="row tap" onclick="fhScanRowTap(' + i + ')"><div class="r-ico-wrap">' + tile + '</div><div class="r-body">' + title + sub + '</div><div class="r-right">' + right + '</div></div>';
  }
  function render() {
    if (!S.open) return;
    const items = S.items, n = items.length;
    const reading = items.filter(function (i) { return i.state === 'reading' || i.state === 'new'; }).length;
    const ready = items.filter(isReady);
    const head = $('scan-head'), dest = $('scan-dest'), rows = $('scan-rows'), note = $('scan-note'), save = $('scan-save');
    if (head) head.textContent = reading ? L('Đang đọc ' + n + ' ảnh…', 'Reading ' + n + ' photos…')
      : (items.some(function (i) { return i.state === 'offline'; }) ? L('Đang ngoại tuyến', 'Offline') : L('Đã đọc ' + ready.length + '/' + n, 'Read ' + ready.length + ' of ' + n));
    if (dest) dest.textContent = (S.scope === 'personal' ? L('Sổ cá nhân', 'Personal book') : L('Sổ gia đình', 'Family book')) + (ready.length ? ' · ' + fmt(total(ready)) : '');
    if (rows) rows.innerHTML = items.map(rowHtml).join('')
      + '<div class="row tap" onclick="fhScanMore()"><div class="r-ico-wrap"><div class="pers-r-ico"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg></div></div>'
      + '<div class="r-body"><div class="r-t scan-act">' + esc2(L('Chụp thêm ảnh', 'Capture more')) + '</div></div></div>';
    if (note) {
      const left = items.filter(function (i) { return !isReady(i) && i.state !== 'reading' && i.state !== 'new'; }).length;
      note.textContent = items.some(function (i) { return i.state === 'offline'; })
        ? L('Không có mạng nên chưa gửi ảnh nào đi. Ảnh vẫn ở đây, chạm từng khoản để nhập tay.', 'No connection, so nothing was sent. The photos are still here. Tap each one to type it in.')
        : (left && !reading ? L('Ảnh chưa đọc được vẫn ở đây sau khi lưu, chạm để nhập tay.', 'Photos we could not read stay here after saving. Tap one to type it in.') : '');
    }
    if (save) { save.disabled = ready.length === 0; save.textContent = ready.length ? L('Lưu ' + ready.length, 'Save ' + ready.length) : L('Lưu', 'Save'); }
    const c = $('scan-cancel'); if (c && !S.cancelArmed) { c.classList.remove('armed'); c.textContent = L('Huỷ', 'Cancel'); }
  }

  /* ── reading ────────────────────────────────────────────────────────────── */
  async function token() {
    try { const r = await sb.auth.getSession(); return r && r.data && r.data.session ? r.data.session.access_token : null; } catch (e) { return null; }
  }
  function readAll() {
    const todo = S.items.filter(function (i) { return i.state === 'new'; });
    if (!navigator.onLine) { todo.forEach(function (i) { i.state = 'offline'; }); render(); return; }
    todo.forEach(function (i) { i.state = 'reading'; });
    render();
    let idx = 0;
    const next = async function () {
      while (idx < todo.length) { const it = todo[idx++]; await readOne(it); render(); }
    };
    const lanes = []; for (let k = 0; k < Math.min(CONC, todo.length); k++) lanes.push(next());
    Promise.all(lanes).then(render, render);
  }
  async function readOne(it) {
    try {
      const cmp = await window.fhCompressImage(it.src);
      const m = String(cmp || '').match(/^data:([^;]+);base64,(.*)$/); if (!m) throw new Error('no image');
      const tk = await token(); if (!tk) throw new Error('no session');
      const r = await fetch(ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tk },
        body: JSON.stringify({ image: m[2], mime: m[1], lang: vi() ? 'vi' : 'en' }) });
      if (!r.ok) throw new Error('http ' + r.status);
      apply(it, await r.json());
    } catch (e) { it.state = 'bad'; }
  }
  // Everything below is the ONLY place read values become form values.
  function apply(it, j) {
    if (!j || !j.is_transaction || !(j.amount > 0)) { it.state = 'bad'; return; }
    const cur = (typeof CUR !== 'undefined') ? CUR : 'VND';
    if (j.currency && j.currency !== cur) { it.state = 'bad'; return; }            // a foreign figure is typed by hand, never guessed into ₫
    it.readAmt = j.amount / curMult();                                            // raw units → base units, exactly once
    it.amt = amtToInput(it.readAmt);
    it.note = (j.counterparty || j.memo || '').trim();
    it.cat = (j.category && typeof familyCatForConcept === 'function') ? familyCatForConcept(j.category) : '';
    it.date = j.date || it.taken || isoToday();
    it.time = j.time || '';
    it.state = (j.flags && j.flags.amount_unverified) ? 'flag' : 'ok';
  }

  /* ── a row opens the existing expense form, which hands its fields back ─── */
  window.fhScanRowTap = function (i) {
    const it = S.items[i]; if (!it) return;
    S.editing = i;
    openExpense({ scope: S.scope, date: it.date || isoToday(), photos: [it.src] });
    setTimeout(function () {
      const n = $('ex-note'), a = $('ex-amt'), t = $('ex-time');
      if (n) n.value = it.note || '';
      if (a) a.value = it.amt || '';
      if (it.cat && typeof selectChipByVal === 'function') selectChipByVal('ex-cat', it.cat);
      const tf = $('ex-timefield'); if (tf) tf.style.display = '';
      if (t) t.value = it.time || '';
      if (typeof setTxt === 'function') setTxt('ex-title', L('Sửa khoản ' + (i + 1) + '/' + S.items.length, 'Edit ' + (i + 1) + ' of ' + S.items.length));
      // the card header numbers rows within its own list; this row is item i of the batch
      const idx = document.querySelector('#bulk-list .bulk-idx');
      if (idx) idx.textContent = L('Khoản chi ' + (i + 1), 'Expense ' + (i + 1));
      const del = $('ex-del'); if (del) del.style.display = 'none';
      const add = $('bulk-add'); if (add) add.style.display = 'none';
      if (typeof refreshExCta === 'function') refreshExCta();
      const em = $('expense-modal');
      if (em && typeof MutationObserver !== 'undefined') {
        const obs = new MutationObserver(function () { if (!em.classList.contains('on')) { S.editing = null; obs.disconnect(); if (S.open) openReview(); } });
        obs.observe(em, { attributes: true, attributeFilter: ['class'] });
      }
    }, 60);
  };
  window.fhScanCollectEdit = function () {
    if (S.editing == null) return false;
    const it = S.items[S.editing]; S.editing = null;
    if (!it) return false;
    const amt = parseAmtBase(($('ex-amt') || {}).value || '');
    it.note = (($('ex-note') || {}).value || '').trim();
    it.amt = amt > 0 ? amtToInput(amt) : '';
    it.cat = (typeof chosen === 'function' && chosen('ex-cat')) || it.cat || '';
    it.date = (($('ex-date') || {}).value) || it.date || isoToday();
    it.time = (($('ex-time') || {}).value) || '';
    if (amt > 0 && Math.abs(amt - (it.readAmt || 0)) > 1e-9) it.edited = true;
    it.state = amt > 0 ? 'ok' : 'bad';
    if (typeof closeExpense === 'function') closeExpense();
    openReview();
    return true;
  };

  /* ── the receipt, large, with retake (never delete: this is not an expense yet) ─ */
  window.fhScanPeek = function (i) {
    const it = S.items[i]; if (!it) return;
    const frame = $('peek-frame'), img = $('peek-img'), peek = $('peek');
    if (!frame || !img || !peek) return;
    frame.className = 'peek-frame'; img.src = it.src; img.alt = it.note || L('Hóa đơn', 'Receipt');
    if (typeof setTxt === 'function') setTxt('peek-cap', (it.note ? it.note + ' · ' : '') + (parseAmtBase(it.amt || '') > 0 ? fmt(parseAmtBase(it.amt)) : L('Hóa đơn ' + (i + 1), 'Receipt ' + (i + 1))));
    if (typeof peekHideActions === 'function') peekHideActions();
    const del = peek.querySelector('.peek-del');
    if (del) {
      S.peekRestore = { text: del.textContent, onclick: del.getAttribute('onclick') };
      del.textContent = L('Chụp lại', 'Retake'); del.classList.remove('armed');
      del.setAttribute('onclick', 'event.stopPropagation();fhScanRetake(' + i + ')');
      const obs = new MutationObserver(function () {
        if (!peek.classList.contains('on')) {
          if (S.peekRestore) { del.textContent = S.peekRestore.text; if (S.peekRestore.onclick) del.setAttribute('onclick', S.peekRestore.onclick); S.peekRestore = null; }
          obs.disconnect();
        }
      });
      obs.observe(peek, { attributes: true, attributeFilter: ['class'] });
    }
    peek.classList.add('on');
  };
  window.fhScanRetake = function (i) {
    if (typeof closePeek === 'function') closePeek();
    const it = S.items[i]; if (!it) return;
    S.items.splice(i, 1); S.receipt.delete(it.src);
    render();
    window.fhScanMore();
  };

  /* ── cancel (armed) and commit ──────────────────────────────────────────── */
  window.fhScanReviewCancel = function () {
    const b = $('scan-cancel');
    if (S.items.length && !S.cancelArmed) {
      S.cancelArmed = true;
      if (b) { b.classList.add('armed'); b.textContent = L('Bỏ ' + S.items.length + ' ảnh?', 'Discard ' + S.items.length + '?'); }
      toast(L('Chạm lần nữa để bỏ cả loạt ảnh này', 'Tap again to discard this whole batch'));
      clearTimeout(S.cancelTimer); S.cancelTimer = setTimeout(function () { S.cancelArmed = false; render(); }, 3500);
      return;
    }
    S.items.forEach(function (i) { S.receipt.delete(i.src); });
    closeReview();
  };
  window.fhScanSave = async function (btn) {
    const ready = S.items.filter(isReady);
    if (!ready.length) return;
    if (btn) { btn.disabled = true; btn.textContent = L('Đang lưu…', 'Saving…'); }
    const rest = S.items.filter(function (i) { return !isReady(i); });
    const rows = ready.map(function (it) {
      return { note: it.note, amt: it.amt, cat: it.cat, date: it.date, time: it.time, _catTouched: true, _timeAuto: false,
               photos: [it.src], source: it.edited ? 'scan-edited' : 'scan' };
    });
    const n = rows.length, sum = total(ready);
    S.items = rest;                                    // what is left stays in the review; an empty rest lets closeModals close it
    window.bulkRows = rows; window.bulkActive = 0; window.exType = 'expense';
    if (typeof buildExCatChips === 'function') buildExCatChips();   // addExpense reads the chips; a scan may never have opened the form
    let ok = true;
    try {
      if (S.scope === 'personal') { await _submitPersonalExpense(); }
      else { submitBulk({ prepared: true, stay: true }); }
    } catch (e) { ok = false; toast(_friendly(e)); }
    if (!ok) { S.items = ready.concat(rest); render(); if (btn) btn.disabled = false; return; }
    // landing: the list, with the rows this batch just wrote marked briefly
    if (S.scope === 'personal') { if (typeof go === 'function') go('personal'); }
    else {
      if (typeof go === 'function') go('spending');
      if (typeof segTo === 'function') segTo('activity');
      // hydrate rebuilds rows 700ms after a write, so the mark keys on what survives it: note + amount
      S.newSig = rows.map(function (r) { return r.note + '|' + parseAmtBase(r.amt || ''); });
      if (typeof renderTxns === 'function') renderTxns();
      setTimeout(function () { S.newSig = []; if (typeof renderTxns === 'function') renderTxns(); }, 4000);
    }
    toast(L('Đã ghi ' + n + ' khoản từ hóa đơn · ' + fmt(sum), 'Logged ' + n + ' from receipts · ' + fmt(sum)));
    if (rest.length) openReview(); else closeReview();
  };

  /* ── harness seam (tools/ui-harness only): render states without a camera or a network ── */
  window.__fhScanSeed = function (o) {
    o = o || {};
    S.scope = o.scope === 'personal' ? 'personal' : 'family';
    S.items = (o.items || []).map(function (it) {
      S.receipt.add(it.src);
      const amt = it.amt != null ? Number(it.amt) : 0;
      return { src: it.src, taken: (window.fhPhotoTakenOn ? window.fhPhotoTakenOn(it.src) : null) || null, state: it.state || 'ok', amt: amt ? amtToInput(amt) : '', readAmt: amt, note: it.note || '', cat: it.cat || '', date: it.date || isoToday(), time: it.time || '', edited: false };
    });
    if (o.camera) {
      const c = $('scan-cam'), v = $('scan-video'), f = $('scan-frame');
      if (v) v.hidden = true;
      if (f && o.still && !f.querySelector('img')) { const im = document.createElement('img'); im.src = o.still; f.insertBefore(im, f.firstChild); }
      if (c) c.classList.add('on');
      renderTray();
      say(o.say || L('Đưa hóa đơn vào khung', 'Line the receipt up in the frame'));
      return;
    }
    openReview();
  };
})();
