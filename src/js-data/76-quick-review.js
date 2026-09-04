  // ═══ quick review: one fresh email transaction, one tap into the ledger ═══
  /* The proactive companion to 72-txn-review's full queue. When a bank email
     lands in the PERSONAL staging scope, the person is offered exactly ONE
     sheet: the newest pending transaction, decrypted on this device, with a
     one-tap "Duyệt · <category>" and, for expenses over 30.000đ, a camera-first
     photo beat right after — import first, then attach, reusing the shipped
     personal photo plumbing (0114) on the now-real row.

     Two entrances, one surface: opening the Cá nhân tab auto-pops it for an
     UNSEEN row and a notification tap forces it regardless, because a tap is
     explicit intent. The person has three answers: Duyệt (import), "Để lúc
     khác" (defer — pops again the next app open), and "Bỏ qua" (stop
     auto-prompting; the row still lives in the full queue). After Duyệt the
     sheet closes; no conveyor belt, the badge carries the rest of the queue.

     SCOPE: only personal-STAGED rows are fetched (the mailbox scope the row was
     sealed under), and only simple VND expense/income. The DESTINATION is then
     the person's choice — Personal (default) or the family book, picked on the
     "Ghi vào sổ" row; the family write reuses the full screen's prepared-bulk
     path. Transfers, repayments, foreign currency and duplicate suspicions stay
     judgment calls the full review screen handles — a forced open falls back to
     it, an auto-pop just stays quiet. This file talks ONLY to window-exported
     APIs (72's file-local helpers are out of reach behind its wrapper), so the
     small decrypt/describe duplications below are annotated with their 72
     originals and must follow them if those change. */

  (function () {
    var QR = null;          // state of the currently shown sheet, null when closed
    var _qrInFlight = false;

    /* Two-tier suppression, so "remind me next time" and "stop reminding me"
       are different answers:
         • SESSION set (in-memory, below) — cleared only when the app is
           relaunched. Stops a row re-popping on every tab switch inside one
           run, and it is where "Để lúc khác" leaves a row: eligible again the
           NEXT app open, suppressed until then.
         • PERSISTENT seen marker (localStorage, _qrSeen*) — written only when
           the person explicitly picks "Bỏ qua". That is the "don't auto-prompt
           me about this one again" choice; the row still lives in the full
           queue and its badge. */
    var _qrSessionSkip = {};

    /* Live in-modal camera (photo step). The MediaStream MUST be stopped on
       every exit — capture, library, "Để sau", _qrClose, and any sheet
       dismissal (drag/scrim), which the observer below catches — or the camera
       light stays on after the sheet is gone.
       _qrCamPending holds the getUserMedia promise pre-acquired inside the
       Duyệt tap (iOS keeps the camera gesture only if getUserMedia is called
       within it, before the awaited write); _qrStopCam releases it too. */
    var _qrCamStream = null, _qrCamObs = null, _qrCamPending = null;

    /* ---- persistent seen marker: written only on an explicit "Bỏ qua" ------
       Same shape as 72's fh-staged-retired ledger: per-user key, pruned against
       the server's answer so it cannot grow without bound. (A deferred row is
       held in the in-memory session set instead — see _qrSessionSkip.) */
    function _qrSeenKey() {
      var uid = (window.fhUser && window.fhUser.id) || '';
      return uid ? 'fh-qr-seen:' + uid : '';
    }
    function _qrSeenGet() {
      try {
        var k = _qrSeenKey(); if (!k) return [];
        var v = JSON.parse(localStorage.getItem(k) || '[]');
        return Array.isArray(v) ? v : [];
      } catch (e) { return []; }
    }
    function _qrSeenAdd(id) {
      try {
        var k = _qrSeenKey(); if (!k || !id) return;
        var set = _qrSeenGet();
        if (set.indexOf(id) === -1) set.push(id);
        localStorage.setItem(k, JSON.stringify(set.slice(-80)));
      } catch (e) {}
    }
    function _qrSeenPrune(liveIds) {
      try {
        var k = _qrSeenKey(); if (!k) return;
        var live = _qrSeenGet().filter(function (id) { return liveIds.indexOf(id) !== -1; });
        localStorage.setItem(k, JSON.stringify(live));
      } catch (e) {}
    }

    /* Rows this device already retired locally (promoted/dismissed) while the
       server delete may still be catching up — 72 owns that ledger; reading its
       key here keeps a just-imported row from popping back up. */
    function _qrRetired() {
      try {
        var mid = (window.DB && window.DB.ownerMemberId) || '';
        var v = JSON.parse(localStorage.getItem('fh-staged-retired:' + mid) || '[]');
        return Array.isArray(v) ? v : [];
      } catch (e) { return []; }
    }

    /* ---- one personal row, fetched + opened -------------------------------
       Mirrors 72-txn-review's fhFetchStagedTxns projection (column-named, no
       raw_body) and fhReadStagedRow's PERSONAL branch, via the same window-
       exported openers. */
    var _QR_COLS = 'id,member_id,owner_user_id,staging_scope,gmail_message_id,source_provider,occurred_at,duplicate_of_id,resolved_before,sealed,eph_pub,nonce,enc_v,created_at';
    async function _qrFetch() {
      var res = await window.sb.from('email_transactions')
        .select(_QR_COLS)
        .eq('review_status', 'pending')
        .eq('staging_scope', 'personal')
        .is('duplicate_of_id', null)
        .order('occurred_at', { ascending: false })
        .limit(30);
      if (res.error) throw res.error;
      var rows = res.data || [];
      _qrSeenPrune(rows.map(function (r) { return r.id; }));
      var retired = _qrRetired();
      /* resolved_before (0113): this message was promoted or dismissed in a
         PREVIOUS connection and re-staged by a re-scan. The full review screen
         surfaces it with an "đã nhập trước đó" badge so the person decides;
         one-tap approve here would risk re-importing something already in the
         ledger. Keep those out of the quick path — they stay in the full queue
         with their badge intact. */
      return rows.filter(function (r) { return retired.indexOf(r.id) === -1 && !r.resolved_before; });
    }
    async function _qrOpen(row) {
      if (!row.sealed || !window.fhStagingOpenRow || !window.fhPersonalStagingPrivKey) return null;
      try {
        row.family_id = window.DB && window.DB.fid;            // opener verifies OUR family (see 72)
        row.owner_user_id = (window.fhUser && window.fhUser.id) || null;   // OUR session, never the server's
        var priv = await window.fhPersonalStagingPrivKey();
        var payload = window.fhStagingOpenRow(row, priv);
        // direct-read nests detail under raw_extracted; forwarding spreads it flat (72)
        return (payload && payload.raw_extracted && typeof payload.raw_extracted === 'object')
          ? Object.assign({}, payload, payload.raw_extracted) : payload;
      } catch (e) { return null; }                             // locked / mismatch → stay quiet
    }

    /* "Chi cho gì" — same judgement 72's fhStagedAsCsvSource makes: the tidied
       memo wins; a memo-less p2p transfer stays blank (a person's name answers
       "who", not "what for"); a card purchase's counterparty IS the merchant. */
    function _qrDesc(re) {
      var tidied = re.memo_display == null ? re.memo : re.memo_display;
      if (tidied) return String(tidied);
      if (re.transaction_type === 'p2p_transfer') return '';
      return String(re.counterparty || '');
    }
    function _qrAcct(re) {
      var masked = String(re.account_masked || '');
      var kind = re.account_kind || null;
      if (!kind) {
        var prov = String(re.source_provider || '').toLowerCase();
        if (/momo|zalopay|shopeepay/.test(prov)) kind = 'ewallet';
      }
      if (!kind) return null;
      return { kind: kind, tail: masked.replace(/\D/g, '').slice(-4) || null, provider: re.source_provider || null };
    }
    /* Category suggestion — the SAME cascade the bulk review screen runs, in
       the same confidence order, so the quick sheet never knows less than the
       big screen about an identical row (parity fix, 2026-09-04):
         1. the pipeline's own concept hint (catSource:'file' over there)
         2. merchant memory — what this device was taught about this merchant
            (csvLearnedCat; gateway-stripped, amount-banded with bare fallback)
         3. keyword guess on the human-ish description (guessCat)
         4. the bank-statement merchant table + brand substrings
            (csvMerchantConcept over counterparty + memo)
       Every arm resolves through the family's OWN category names and each is
       optional — a helper missing behind its wrapper just skips its turn. */
    function _qrSuggestCat(re, desc) {
      try {
        var hint = re.category_hint && typeof familyCatForConcept === 'function'
          ? familyCatForConcept(re.category_hint) : '';
        if (hint) return hint;
        if (typeof csvLearnedCat === 'function') {
          var learned = csvLearnedCat({ counterparty: re.counterparty || '', description: desc, amount: Number(re.amount) || 0 });
          if (learned) return learned;
        }
        var kw = typeof guessCat === 'function' ? guessCat(desc) : '';
        if (kw) return kw;
        if (typeof csvMerchantConcept === 'function' && typeof familyCatForConcept === 'function') {
          var concept = csvMerchantConcept((re.counterparty || '') + ' ' + (desc || ''));
          if (concept) return familyCatForConcept(concept) || '';
        }
      } catch (e) {}
      return '';
    }
    function _qrLocalIso(d) {
      return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    }
    // bank timestamp → local "HH:MM"; a date-only UTC-midnight placeholder stays timeless (72's rule)
    function _qrTime(oa) {
      if (!oa) return undefined;
      var d = new Date(oa); if (isNaN(d.getTime())) return undefined;
      if (d.getUTCHours() === 0 && d.getUTCMinutes() === 0 && d.getUTCSeconds() === 0) return undefined;
      return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
    }

    /* ---- entry point ------------------------------------------------------
       opts.force: a notification tap — ignores the seen marker, and a row the
       quick sheet cannot handle falls back to the full review screen. */
    window.fhQuickReviewMaybe = async function (opts) {
      opts = opts || {};
      if (_qrInFlight) return;
      _qrInFlight = true;
      try {
        var sheetEl = document.getElementById('fh-sheet');
        if (!window.DB || !window.DB._hydrated) return;
        if (sheetEl && sheetEl.classList.contains('on')) return;         // something else is up
        if (window.fhStagingAlarmActive && window.fhStagingAlarmActive()) return;   // key alarm freezes approval
        // promoting needs the personal DEK; a locked ledger gets no teaser
        if (!window.fhPersonalKeyReady || !window.fhPersonalKeyReady()) {
          if (opts.force && window.fhTxnReviewSheet) window.fhTxnReviewSheet();
          return;
        }

        /* Merchant memory loads lazily (the bulk screen calls this at open);
           kick it BEFORE the fetch/unseal awaits so an enc family's async
           decrypt has landed by the time _qrSuggestCat consults it. */
        try { if (typeof csvLearnLoad === 'function') csvLearnLoad(); } catch (e) {}

        var rows;
        try { rows = await _qrFetch(); } catch (e) { return; }
        if (!rows.length) { if (opts.force && window.fhTxnReviewSheet) window.fhTxnReviewSheet(); return; }
        var seen = _qrSeenGet();
        var row = opts.force ? rows[0]
          : rows.find(function (r) { return seen.indexOf(r.id) === -1 && !_qrSessionSkip[r.id]; });
        if (!row) return;

        var re = await _qrOpen(row);
        if (!re) { if (opts.force && window.fhTxnReviewSheet) window.fhTxnReviewSheet(); return; }

        var flow = re.flow || (re.direction === 'credit' ? 'income' : 'expense');
        var foreign = re.currency && re.currency !== 'VND';
        if (flow === 'transfer' || foreign) {
          // a judgment-call row belongs to the full review screen
          if (opts.force && window.fhTxnReviewSheet) window.fhTxnReviewSheet();
          return;
        }

        var desc = _qrDesc(re);
        var cat = flow !== 'income' ? _qrSuggestCat(re, desc) : '';
        var oa = row.occurred_at ? new Date(row.occurred_at) : new Date();
        QR = {
          row: row, re: re, flow: flow, state: 'review', edit: null,
          amount: Number(re.amount) || 0,                       // display units (full VND)
          desc: desc, cat: cat,
          dest: 'personal',                                     // default = the staged scope; tappable to 'family'
          acctId: null,                                         // null = auto-resolve the bank instrument; else an explicit personal account
          dateIso: _qrLocalIso(isNaN(oa.getTime()) ? new Date() : oa),
          time: _qrTime(row.occurred_at),
          queue: rows.length, txnId: null, busy: false,
        };
        _qrSessionSkip[row.id] = true;                          // shown this run — no re-pop on the next tab switch
        _qrRender();
      } finally { _qrInFlight = false; }
    };

    /* ---- rendering --------------------------------------------------------
       Lives on the app's own #fh-sheet layer (DESIGN §4): device frame,
       drag-to-dismiss, below the toast. */
    function _qrShow(html) {
      var body = document.getElementById('fh-sheet-body'); if (!body) return;
      body.innerHTML = html;
      document.getElementById('scrim').classList.add('on');
      document.getElementById('fh-sheet').classList.add('on');
    }
    function _esc2(s) { return window.esc ? window.esc(String(s == null ? '' : s)) : String(s == null ? '' : s); }
    function _qrFmt(displayAmt) {
      var base = Number(displayAmt || 0) / (typeof curMult === 'function' ? curMult() : 1000);
      return typeof fmt === 'function' ? fmt(base) : displayAmt + ' ₫';
    }
    function _qrDateLabel() {
      var d = new Date(QR.dateIso + 'T00:00:00');
      var today = new Date(); today.setHours(0, 0, 0, 0);
      var diff = Math.round((today - d) / 86400000);
      var vi = (typeof isVi === 'function') ? isVi() : true;
      // "Hôm nay, 04/09, 07:55" — day word + date + time (time only when known).
      var dayWord;
      if (diff === 0) dayWord = L('Hôm nay', 'Today');
      else if (diff === 1) dayWord = L('Hôm qua', 'Yesterday');
      else if (vi && typeof WKD_VI !== 'undefined') dayWord = WKD_VI[d.getDay()];
      else if (!vi && typeof WKD !== 'undefined') dayWord = WKD[d.getDay()];
      else dayWord = '';
      var dd = String(d.getDate()).padStart(2, '0');
      var mm = String(d.getMonth() + 1).padStart(2, '0');
      var datePart = vi ? (dd + '/' + mm)
        : ((typeof MONA !== 'undefined' ? MONA[d.getMonth()] : mm) + ' ' + d.getDate());
      var parts = [];
      if (dayWord) parts.push(dayWord);
      parts.push(datePart);
      if (QR.time) parts.push(QR.time);
      return parts.join(', ');
    }
    /* Slim provenance eyebrow above the form: "TỪ EMAIL · VIB". The account tail
       now lives in the "Trả bằng gì?" field, so it is dropped here. */
    function _qrSrcLabel() {
      var prov = String(QR.row.source_provider || '').replace(/[_-]/g, ' ').trim();
      return L('Từ email', 'From email') + (prov ? ' · ' + prov.toUpperCase() : '');
    }
    function _qrKindEmoji(k) { return k === 'credit_card' ? '💳' : k === 'ewallet' ? '📱' : k === 'cash' ? '💵' : '🏦'; }
    // The bank instrument this row came in on, e.g. "💳 VIB ••4751".
    function _qrInstrLabel() {
      var re = QR.re || {};
      var tail = String(re.account_masked || '').replace(/\D/g, '').slice(-4);
      var prov = String(re.source_provider || '').replace(/[_-]/g, ' ').trim();
      return _qrKindEmoji(re.account_kind) + ' ' + (prov || L('Tài khoản', 'Account')) + (tail ? ' ••' + tail : '');
    }
    function _qrAcctVal() {
      if (QR.acctId) {
        var pd = (window.fhPersonalData && fhPersonalData()) || { accounts: [] };
        var a = (pd.accounts || []).find(function (x) { return x.id === QR.acctId; });
        if (a) return _qrKindEmoji(a.kind) + ' ' + a.name;
      }
      return _qrInstrLabel();
    }
    function _qrDestVal() { return QR.dest === 'family' ? L('🏡 Gia đình', '🏡 Family') : L('🔒 Cá nhân', '🔒 Personal'); }
    function _qrCatCell() {
      if (QR.flow === 'income') return '💰 ' + L('Thu nhập', 'Income');
      if (!QR.cat) return L('Chưa chọn', 'Not set');
      var emo = (window.catStyle && window.catStyle[QR.cat] && window.catStyle[QR.cat][0]) || '';
      return (emo ? emo + ' ' : '') + QR.cat + (QR.editedCat ? '' : ' · ' + L('gợi ý', 'suggested'));
    }
    /* Chip groups — the app's global .choices/.choice components, so they are
       pixel-identical to the ones in the expense sheet. */
    function _qrCatChips() {
      return '<div class="choices">' + (window.catOrder || []).map(function (c) {
        var emo = (window.catStyle && window.catStyle[c] && window.catStyle[c][0]) || '';
        return '<button class="choice' + (c === QR.cat ? ' on' : '') + '" onclick="fhQrAct(\'cat-pick\',this.dataset.c)" data-c="' + _esc2(c) + '">' + _esc2((emo ? emo + ' ' : '') + c) + '</button>';
      }).join('') + '</div>';
    }
    function _qrDestChips() {
      var locked = _qrFamilyLocked();
      return '<div class="choices">' +
        '<button class="choice' + (QR.dest === 'personal' ? ' on' : '') + '" onclick="fhQrAct(\'dest-pick\',\'personal\')">' + L('🔒 Cá nhân', '🔒 Personal') + '</button>' +
        '<button class="choice' + (QR.dest === 'family' ? ' on' : '') + (locked ? ' qr-off' : '') + '" onclick="fhQrAct(\'dest-pick\',\'family\')">' + L('🏡 Gia đình', '🏡 Family') + '</button>' +
        '</div>' +
        (locked ? '<div class="qr-inline-note">' + L('Sổ gia đình đang khoá.', 'The family ledger is locked.') + '</div>' : '');
    }
    function _qrAcctChips() {
      var pd = (window.fhPersonalData && fhPersonalData()) || { accounts: [] };
      var chips = '<button class="choice' + (!QR.acctId ? ' on' : '') + '" onclick="fhQrAct(\'acct-pick\',\'\')">' + _esc2(L('Tự động', 'Auto') + ' · ' + _qrInstrLabel()) + '</button>';
      chips += (pd.accounts || []).map(function (a) {
        return '<button class="choice' + (QR.acctId === a.id ? ' on' : '') + '" onclick="fhQrAct(\'acct-pick\',this.dataset.id)" data-id="' + _esc2(a.id) + '">' + _esc2(_qrKindEmoji(a.kind) + ' ' + a.name) + '</button>';
      }).join('');
      return '<div class="choices">' + chips + '</div>';
    }
    /* One accordion picker row — the app's .field.ex-arow, collapsed by default
       (label left, value right, chevron), tapping the label expands its body
       inline. Single-open via QR.edit. labelHtml may carry markup (the "· tuỳ
       chọn" hint); valText is escaped by the caller. */
    function _qrArow(key, labelHtml, valText, bodyHtml) {
      var open = QR.edit === key;
      return '<div class="field ex-arow' + (open ? ' open' : '') + '">' +
        '<label onclick="fhQrAct(\'edit\',\'' + key + '\')">' + labelHtml + '<span class="ex-arow-val">' + valText + '</span></label>' +
        bodyHtml + '</div>';
    }
    function _qrRender() {
      if (!QR) return;
      if (QR.state === 'photo') return _qrRenderPhoto();
      var income = QR.flow === 'income';
      var amtStr = Number(QR.amount).toLocaleString('vi-VN');
      var noteVal = _esc2(QR.desc || '');   // esc() HTML-escapes quotes for the value="" attribute
      var noteLbl = income ? L('Tiền gì vậy?', 'What money is this?') : L('Chi cho gì', 'What for?');
      var notePh = income ? L('vd. Lương', 'e.g. Salary') : L('vd. Đi chợ', 'e.g. Groceries');
      var ctaLabel = income ? L('Duyệt thu nhập', 'Approve income')
        : (QR.cat ? L('Duyệt · ', 'Approve · ') + _esc2(QR.cat) : L('Duyệt', 'Approve'));
      var others = Math.max(0, (QR.queue || 1) - 1);

      // Text fields: label above + input box (Số tiền, Chi cho gì) — exactly the
      // expense sheet's .field. Amount reads green for income (.inc-amt).
      var fields = '<div class="field"><label>' + L('Số tiền', 'Amount') + '</label>' +
        '<input id="qr-amt-in" class="big num' + (income ? ' inc-amt' : '') + '" inputmode="numeric" autocomplete="off" value="' + _esc2(amtStr) + '" oninput="fhQrAct(\'amt-live\',this.value)"></div>' +
        '<div class="field"><label>' + noteLbl + '</label>' +
        '<input id="qr-note-in" value="' + noteVal + '" placeholder="' + notePh + '" oninput="fhQrAct(\'note-live\',this.value)"></div>' +
        _qrArow('dest', L('Ghi vào đâu?', 'Where to?'), _esc2(_qrDestVal()), _qrDestChips());
      if (!income) {
        fields += _qrArow('acct', L('Trả bằng gì?', 'Paid with?') + ' <span class="opt">' + L('· tuỳ chọn', '· optional') + '</span>', _esc2(_qrAcctVal()), _qrAcctChips());
        fields += _qrArow('cat', L('Danh mục', 'Category'), _esc2(_qrCatCell()), _qrCatChips());
      }
      fields += _qrArow('date', L('Khi nào', 'When'), _esc2(_qrDateLabel()),
        '<input id="qr-in-date" type="date" value="' + _esc2(QR.dateIso) + '" onchange="fhQrAct(\'date-ok\')">');

      _qrShow(
        '<div class="qr">' +
          '<div class="qr-src"><span class="qr-eyebrow">' + _esc2(_qrSrcLabel()) + '</span></div>' +
          '<div class="qr-form">' + fields + '</div>' +
          '<button class="qr-cta" id="qr-go" onclick="fhQrAct(\'approve\')">' + ctaLabel + '</button>' +
          '<div class="qr-actrow">' +
            '<button class="qr-ghost" onclick="fhQrAct(\'later\')">' + L('Để lúc khác', 'Later') + '</button>' +
            '<button class="qr-skip qr-skip-inline" onclick="fhQrAct(\'dismiss\')">' + L('Bỏ qua', 'Skip') + '</button>' +
          '</div>' +
          (others > 0
            ? '<div class="qr-foot">' + L('Còn ' + others + ' khoản trong hàng chờ', others + ' more in the queue') + ' · <b onclick="fhQrAct(\'all\')">' + L('Xem tất cả', 'View all') + '</b></div>'
            : '') +
        '</div>');
    }
    function _qrRenderPhoto() {
      _qrShow(
        '<div class="qr qr-photo">' +
          '<div class="qr-done"><span class="qr-ck">✓</span>' + _esc2(L('Đã vào sổ', 'Saved') + ' · ' + _qrFmt(QR.amount) + (QR.cat ? ' ' + QR.cat : '')) + '</div>' +
          '<div class="qr-ph-h">' + L('Giữ lại khoảnh khắc này?', 'Keep this moment?') + '</div>' +
          '<div class="qr-ph-sub">' + L('Chụp ngay tại đây — một tấm ảnh làm khoản chi này dễ nhớ hơn nhiều.', 'Snap it right here — a photo makes this one much easier to remember.') + '</div>' +
          // Live camera preview inside the sheet; the shutter grabs the frame.
          '<div class="qr-cam-wrap" id="qr-cam-wrap">' +
            '<video id="qr-cam" autoplay playsinline muted webkit-playsinline></video>' +
            '<div class="qr-cam-hint" id="qr-cam-hint">' + L('Đang mở máy ảnh…', 'Opening the camera…') + '</div>' +
          '</div>' +
          '<button class="qr-shutter" id="qr-shutter" onclick="fhQrAct(\'capture\')" disabled aria-label="' + L('Chụp', 'Capture') + '"><span></span></button>' +
          // Fallback (iOS gesture / permission blocked): the system camera app.
          '<button class="qr-cta qr-cam-fallback" id="qr-cam-fallback" style="display:none" onclick="fhQrAct(\'cam\')">' +
            '<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="7" width="18" height="13" rx="3"/><path d="M8.5 7 10 4.5h4L15.5 7"/><circle cx="12" cy="13.5" r="3.5"/></svg>' +
            L('Chụp bằng máy ảnh', 'Use the camera app') + '</button>' +
          '<div class="qr-ph-row">' +
            '<button class="qr-ghost" onclick="fhQrAct(\'lib\')">' + L('Chọn từ thư viện', 'From library') + '</button>' +
            '<button class="qr-skip qr-skip-inline" onclick="fhQrAct(\'later\')">' + L('Để sau', 'Later') + '</button>' +
          '</div>' +
          '<input type="file" id="qr-file-cam" accept="image/*" capture="environment" hidden onchange="fhQrAct(\'files\',this)">' +
          '<input type="file" id="qr-file-lib" accept="image/*" multiple hidden onchange="fhQrAct(\'files\',this)">' +
        '</div>');
    }

    /* ---- family destination ----------------------------------------------
       Redirecting a personal-staged row to the family book. The seal only
       governed who could READ the queue; the plaintext is in hand, so this is
       an ordinary family write (re-encrypted under the family DEK). */
    function _qrFamilyLocked() {
      return !!(window._fhWriteLocked && window._fhWriteLocked());
    }
    /* Mirrors csvPromote for ONE row: family income → fhAddFamilyIncome;
       expense → the supported prepared-bulk path (bulkRows + submitBulk), which
       is exactly how the full review promotes family rows. Returns truthy on a
       started write; submitBulk's own writes are fire-and-forget like the full
       path, and the local-first retire guards a failure. */
    async function _qrWriteFamily(src) {
      if (QR.flow === 'income') {
        var b = Number(QR.amount || 0) / (typeof curMult === 'function' ? curMult() : 1000);
        if (!(b > 0)) return false;
        return await window.fhAddFamilyIncome(b, QR.desc || '', QR.dateIso);
      }
      var name = QR.cat;
      // Pre-resolve the category id so the write finds it instead of racing to
      // create it (harmless for one row, but keeps parity with csvPromote).
      if (window._categoryIdForName && navigator.onLine !== false) {
        try { await window._categoryIdForName(name, (window.catStyle[name] || [])[0], (window.catOrder || []).indexOf(name) + 1); } catch (e) {}
      }
      window.bulkRows = [{
        note: QR.desc || '', amt: String(Math.round(QR.amount)), cat: name,
        who: (typeof csvDefaultWho === 'function' ? csvDefaultWho() : (window.lastWho || '')),
        date: QR.dateIso, _invalid: false, _catTouched: true,
        source: src, time: QR.time || '', _timeAuto: false,
      }];
      window.bulkActive = 0; window.exPhotos = [];
      try { if (typeof buildExCatChips === 'function') buildExCatChips(); } catch (e) {}
      try { if (typeof renderBulk === 'function') renderBulk(); } catch (e) {}
      try { if (typeof loadRow === 'function') loadRow(0); } catch (e) {}
      if (typeof submitBulk !== 'function') return false;
      // prepared → no interactive re-parse; stay → don't bounce off the tab
      submitBulk({ prepared: true, stay: true });
      return true;
    }

    /* ---- actions ---------------------------------------------------------- */
    async function _qrApprove() {
      if (!QR || QR.busy) return;
      QR.busy = true;
      var btn = document.getElementById('qr-go');
      if (btn) { btn.disabled = true; btn.textContent = L('Đang lưu…', 'Saving…'); }
      /* Pre-acquire the camera NOW, still inside the tap gesture, when this row
         will reach the photo step (personal expense over 30k). iOS loses the
         camera gesture across the awaited write below, so asking afterwards
         fails; asking here keeps it. Released by _qrStopCam on every path that
         does not open the photo step (write failure, no id, or a close). */
      if (QR.dest !== 'family' && QR.flow !== 'income' && Number(QR.amount) > 30000) _qrCamPreacquire();
      try {
        var src = QR.re._transport === 'oauth_direct' ? 'direct-email' : 'forwarding-email';   // 0100 provenance
        var toFamily = QR.dest === 'family';
        /* A family EXPENSE needs a real family category — submitBulk validates it
           and would otherwise bounce to the full composer. Personal allows an
           unclassified row, so this gate is family-only. */
        if (toFamily && QR.flow !== 'income' && !(typeof catValid === 'function' && catValid(QR.cat))) {
          window.toast && window.toast(L('Chọn danh mục trước khi ghi vào sổ gia đình', 'Pick a category before logging to the family'));
          QR.busy = false; if (btn) { btn.disabled = false; } QR.edit = 'cat'; _qrRender(); return;
        }
        var ok;
        if (toFamily) {
          ok = await _qrWriteFamily(src);
        } else {
          var base = Number(QR.amount || 0) / (typeof curMult === 'function' ? curMult() : 1000);
          if (!(base > 0)) throw new Error('bad amount');
          // "Trả bằng gì?": an explicit pick wins; otherwise auto-resolve the
          // bank instrument (creating the account if needed), as before.
          var ai = _qrAcct(QR.re);
          var autoIsCard = !!(ai && ai.kind === 'credit_card');
          var acctId = QR.acctId || null;
          if (!acctId && ai && window.fhPersonalAccountEnsure) { try { acctId = await window.fhPersonalAccountEnsure(ai); } catch (e) {} }
          if (QR.flow === 'income') {
            // income never lands on a credit card; keep the auto card-exclusion,
            // but honour an explicit account pick.
            ok = await window.fhPersonalAddIncome(base, QR.desc || '', QR.dateIso, src,
              { catName: 'Khác', catEmoji: '💰', accountId: QR.acctId ? QR.acctId : (autoIsCard ? null : acctId), time: QR.time });
          } else {
            var emoji = (window.catStyle && window.catStyle[QR.cat] && window.catStyle[QR.cat][0]) || '🗂️';
            ok = await window.fhPersonalAddExpense(base, QR.desc || '', QR.cat || null, emoji, QR.dateIso, QR.time, src, { accountId: acctId });
          }
        }
        if (!ok) throw new Error('write failed');
        /* A hand-picked category is a lesson: teach the shared merchant memory
           (csvLearnFrom only accepts catSource:'user'), so the NEXT quick sheet
           and the bulk screen both already know this merchant. */
        if (QR.editedCat && QR.cat && typeof csvLearnFrom === 'function') {
          try {
            csvLearnFrom({ counterparty: QR.re.counterparty || '', description: QR.desc || '',
              amount: Number(QR.amount) || 0, categoryName: QR.cat, catSource: 'user' });
          } catch (e) {}
        }
        // ledger write landed → retire the staged row (local-first inside 72's helper)
        try { await window.fhStagedRetireIds([QR.row.id]); } catch (e) {}
        try { window.fhRefreshStagedCount && window.fhRefreshStagedCount(); } catch (e) {}
        try { typeof renderPersonal === 'function' && renderPersonal(); } catch (e) {}
        /* The photo beat is PERSONAL-only: it uses the personal photo path and
           the id fhPersonalAddExpense returns. A family expense goes through
           submitBulk (no id handed back) and its photos live in a different
           table — those can be added from the family expense's own detail
           screen. So a family import ends here; submitBulk already toasted. */
        QR.txnId = (!toFamily && typeof ok === 'string') ? ok : null;
        if (!toFamily && QR.flow !== 'income' && QR.amount > 30000 && QR.txnId) {
          QR.state = 'photo'; QR.busy = false; _qrRender(); _qrStartCam(); return;
        }
        if (!toFamily) window.toast && window.toast(L('Đã lưu vào sổ Cá nhân', 'Saved to your personal ledger'));
        _qrClose();
      } catch (e) {
        console.warn('quick review approve failed', e);
        _qrStopCam();   // the write failed → release the camera pre-acquired in the tap
        window.toast && window.toast(L('Chưa lưu được', 'Could not save'));
        QR.busy = false;
        if (btn) { btn.disabled = false; }
        _qrRender();
      }
    }
    function _qrFilesToDataUris(input, cb) {
      var files = Array.prototype.slice.call(input.files || []).slice(0, 10);
      if (!files.length) return cb([]);
      var out = [], left = files.length;
      files.forEach(function (f, i) {
        var r = new FileReader();
        r.onload = function () { out[i] = r.result; if (!--left) cb(out.filter(Boolean)); };
        r.onerror = function () { if (!--left) cb(out.filter(Boolean)); };
        r.readAsDataURL(f);
      });
    }
    /* ---- live camera ------------------------------------------------------ */
    function _qrStopCam() {
      try { if (_qrCamStream) _qrCamStream.getTracks().forEach(function (t) { try { t.stop(); } catch (e) {} }); } catch (e) {}
      _qrCamStream = null;
      // Release a still-in-flight pre-acquire too: stop its stream once it
      // resolves (and swallow a rejection) so a camera opened in the tap can't
      // outlive a sheet that closed before the photo step showed.
      var p = _qrCamPending; _qrCamPending = null;
      if (p) p.then(function (s) { try { s.getTracks().forEach(function (t) { t.stop(); }); } catch (e) {} }, function () {});
      var v = document.getElementById('qr-cam'); if (v) { try { v.srcObject = null; } catch (e) {} }
      try { if (_qrCamObs) { _qrCamObs.disconnect(); _qrCamObs = null; } } catch (e) {}
    }
    /* iOS keeps the camera gesture only if getUserMedia is CALLED synchronously
       inside the tap — the permission/gesture is checked at call time, not when
       the promise resolves. So the Duyệt handler kicks this off before its
       awaited write; _qrStartCam then just awaits the result. */
    function _qrCamPreacquire() {
      if (_qrCamPending || _qrCamStream) return;
      if (!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia)) return;
      try {
        _qrCamPending = navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
        _qrCamPending.catch(function () {});   // keep an early rejection from going unhandled
      } catch (e) { _qrCamPending = null; }
    }
    /* Stop the stream the moment the sheet leaves the screen by ANY path — a
       drag-dismiss or scrim tap goes through _closeOv, never our buttons. */
    function _qrCamWatch() {
      try {
        var sheet = document.getElementById('fh-sheet');
        if (!sheet || typeof MutationObserver === 'undefined') return;
        _qrCamObs = new MutationObserver(function () { if (!sheet.classList.contains('on')) _qrStopCam(); });
        _qrCamObs.observe(sheet, { attributes: true, attributeFilter: ['class'] });
      } catch (e) {}
    }
    function _qrCamFail(reason) {
      _qrStopCam();
      var wrap = document.getElementById('qr-cam-wrap'); if (wrap) wrap.classList.add('failed');
      var hint = document.getElementById('qr-cam-hint');
      if (hint) { hint.style.display = ''; hint.textContent = reason === 'denied'
        ? L('Chưa được phép dùng máy ảnh trong app', 'Camera access is blocked in the app')
        : L('Máy ảnh không khả dụng ở đây', 'Camera is not available here'); }
      var sh = document.getElementById('qr-shutter'); if (sh) sh.style.display = 'none';
      var fb = document.getElementById('qr-cam-fallback'); if (fb) fb.style.display = '';   // system-camera fallback
    }
    /* Attach the camera when the photo step appears — awaiting the stream the
       Duyệt tap pre-acquired (the iOS-safe path); if there was none (re-entry,
       or the pre-acquire was skipped) it falls back to a fresh getUserMedia,
       which still works on Android/desktop and degrades to the system-camera
       button on iOS. */
    async function _qrStartCam() {
      var video = document.getElementById('qr-cam');
      if (!video) return;
      var pending = _qrCamPending; _qrCamPending = null;
      if (!pending && !(navigator.mediaDevices && navigator.mediaDevices.getUserMedia)) { _qrCamFail('unsupported'); return; }
      try {
        var stream = pending
          ? await pending
          : await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
        if (!QR || QR.state !== 'photo') {   // sheet closed while permission was pending
          try { stream.getTracks().forEach(function (t) { t.stop(); }); } catch (e) {}
          return;
        }
        _qrCamStream = stream;
        video.srcObject = stream;
        video.onloadedmetadata = function () { try { video.play(); } catch (e) {} };
        video.onplaying = function () {
          var sh = document.getElementById('qr-shutter'); if (sh) sh.disabled = false;
          var wrap = document.getElementById('qr-cam-wrap'); if (wrap) wrap.classList.add('live');
        };
        _qrCamWatch();
      } catch (e) {
        _qrCamFail(e && (e.name === 'NotAllowedError' || e.name === 'SecurityError') ? 'denied' : 'error');
      }
    }
    /* Grab the current frame → a JPEG data URI → the existing upload path (which
       compresses again). The long edge is capped so a 4K sensor frame isn't
       shuttled around at full size. Canvas output carries no EXIF. */
    function _qrCapture() {
      var video = document.getElementById('qr-cam');
      if (!video || !video.videoWidth) return;
      try {
        var w = video.videoWidth, h = video.videoHeight;
        var scale = Math.min(1, 1600 / Math.max(w, h));
        var canvas = document.createElement('canvas');
        canvas.width = Math.round(w * scale); canvas.height = Math.round(h * scale);
        canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
        var uri = canvas.toDataURL('image/jpeg', 0.9);
        _qrStopCam();
        _qrPhotos([uri]);
      } catch (e) {
        window.toast && window.toast(L('Chưa chụp được, thử lại', 'Could not capture, try again'));
      }
    }
    async function _qrPhotos(uris) {
      if (!QR || !QR.txnId || !uris.length) return _qrClose();
      window.toast && window.toast(L('Đang lưu ảnh…', 'Saving photo…'));
      try {
        var ok = await window.fhPersonalUploadTxnPhotos(QR.txnId, uris);
        try { await window.fhPersonalHydrate(); } catch (e) {}
        try { typeof renderPersonal === 'function' && renderPersonal(); } catch (e) {}
        window.toast && window.toast(ok ? L('Đã lưu ảnh vào khoản chi 📸', 'Photo saved to the expense 📸')
                                        : L('Có ảnh chưa lưu được', 'Some photos could not be saved'));
      } catch (e) {
        window.toast && window.toast(L('Chưa lưu được ảnh', 'Could not save the photo'));
      }
      _qrClose();
    }
    function _qrClose() {
      _qrStopCam();
      QR = null;
      window._closeOv && window._closeOv();
    }

    window.fhQrAct = function (a, v) {
      if (!QR) return;
      if (a === 'edit') { QR.edit = (QR.edit === v) ? null : v; _qrRender(); return; }
      if (a === 'amt-live') {
        // Live update from the amount input; never re-render, or it loses focus.
        var n = (typeof parseAmt === 'function') ? parseAmt(v) : (parseInt(String(v || '').replace(/\D/g, ''), 10) || 0);
        if (n >= 0) QR.amount = n;
        return;
      }
      if (a === 'note-live') { QR.desc = String(v == null ? '' : v); return; }   // live, no re-render
      if (a === 'acct-pick') { QR.acctId = v || null; QR.edit = null; _qrRender(); return; }
      if (a === 'date-ok') {
        var d = document.getElementById('qr-in-date');
        if (d && /^\d{4}-\d{2}-\d{2}$/.test(d.value)) { QR.dateIso = d.value; QR.time = undefined; }
        QR.edit = null; _qrRender(); return;
      }
      if (a === 'cat-pick') { QR.cat = v || QR.cat; QR.editedCat = true; QR.edit = null; _qrRender(); return; }
      if (a === 'dest-pick') {
        if (v === 'family' && _qrFamilyLocked()) { window.toast && window.toast(L('Sổ gia đình đang khoá', 'The family ledger is locked')); return; }
        QR.dest = v || QR.dest; QR.edit = null; _qrRender(); return;
      }
      if (a === 'approve') { _qrApprove(); return; }
      if (a === 'later') { _qrClose(); return; }             // session-suppressed only → eligible again next app open
      if (a === 'dismiss') { _qrSeenAdd(QR.row.id); _qrClose(); return; }   // persistent → won't auto-pop again (stays in the full queue)
      if (a === 'all') { _qrClose(); window.fhTxnReviewSheet && window.fhTxnReviewSheet(); return; }
      if (a === 'capture') { _qrCapture(); return; }
      if (a === 'cam') { _qrStopCam(); var c = document.getElementById('qr-file-cam'); c && c.click(); return; }
      if (a === 'lib') { _qrStopCam(); var l = document.getElementById('qr-file-lib'); l && l.click(); return; }
      if (a === 'files') { _qrStopCam(); _qrFilesToDataUris(v, function (uris) { _qrPhotos(uris); }); return; }
    };
  })();
