  // ═══ Web Push: lock-screen notifications when the app is closed ═════════════
  /* Realtime covers the open app; this covers the pocket. A device opts in from
     Settings → Notifications: permission → PushManager.subscribe (the VAPID
     public key below) → one push_subscriptions row per device, upserted on
     endpoint so switching families re-points the same device. Social writes
     then call fhNotify(), which invokes the push-send Edge Function
     fire-and-forget; the server fans out to every other opted-in device in the
     family and prunes endpoints that have gone stale.
     iOS only delivers Web Push to a Home-Screen-installed PWA (16.4+), so the
     sheet shows an install hint instead of the toggle in a plain Safari tab. */
  const _PUSH_PUB = 'BOOaWs1sTWAdVTud79oSJE0lIgT_3HpH8DGApHSiEkLosfsRI-sekc-m-Nc6d0AFStBR8fN9h8B7FzNTO2mV1qM';
  function _pushSupported() { return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window; }
  function _pushIOSNeedsInstall() {
    const ios = /iphone|ipad|ipod/i.test(navigator.userAgent || '');
    const installed = (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || window.navigator.standalone === true;
    return ios && !installed;
  }
  function _pushB64ToU8(s) {
    const pad = '='.repeat((4 - (s.length % 4)) % 4);
    const raw = atob((s + pad).replace(/-/g, '+').replace(/_/g, '/'));
    const a = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) a[i] = raw.charCodeAt(i);
    return a;
  }
  async function _pushGetSub() {
    try { const reg = await navigator.serviceWorker.ready; return await reg.pushManager.getSubscription(); }
    catch (e) { return null; }
  }
  async function _pushSaveSub(sub) {
    /* User-scoped since 0152: the family seat is optional. A famless account
       saves a personal row (family/member null) that the pipeline reaches via
       owner_user_id; once a family exists the resync re-points the row at it. */
    const fid = (window.DB && window.DB.fid) || null, mid = (window.DB && window.DB.ownerMemberId) || null;
    const uid = window.fhUser && window.fhUser.id;
    if (!uid || !sub) return false;
    const seated = !!(fid && mid);
    const j = sub.toJSON ? sub.toJSON() : sub;
    const res = await sb.from('push_subscriptions').upsert({
      owner_user_id: uid,
      family_id: seated ? fid : null, member_id: seated ? mid : null, endpoint: sub.endpoint,
      p256dh: (j.keys && j.keys.p256dh) || '', auth: (j.keys && j.keys.auth) || '',
      ua: (navigator.userAgent || '').slice(0, 200)
    }, { onConflict: 'endpoint' });
    // RLS blocks re-pointing a row owned by another account's member seat (a
    // shared device that switched accounts): surface it instead of failing mute.
    if (res && res.error) { console.warn('push save', res.error); return false; }
    return true;
  }
  /* Sign-out / account-switch teardown. The subscription row is keyed on this
     device's endpoint and carries the leaving family + member; if it survives,
     that family keeps pushing here after the next account logs in — and RLS
     forbids the new account from re-pointing a row it doesn't own. So we clear
     it HERE, while the leaving account's auth still satisfies the delete policy,
     and drop the browser subscription too: a shared device shouldn't inherit
     the previous person's opt-in. Must run BEFORE sb.auth.signOut(). */
  window.fhPushTeardown = async function () {
    try {
      const sub = await _pushGetSub();
      if (sub) {
        try { await sb.from('push_subscriptions').delete().eq('endpoint', sub.endpoint); } catch (e) {}
        try { await sub.unsubscribe(); } catch (e) {}
      }
      window._fhPushSyncedFid = null;
    } catch (e) {}
  };
  // 'unsupported' | 'ios-install' | 'denied' | 'on' | 'off'
  window.fhPushState = async function () {
    if (!_pushSupported()) return _pushIOSNeedsInstall() ? 'ios-install' : 'unsupported';
    if (Notification.permission === 'denied') return 'denied';
    const sub = await _pushGetSub();
    return (Notification.permission === 'granted' && sub) ? 'on' : 'off';
  };
  /* fhPushState() is async; the Tài Chính row renders inside one synchronous
     innerHTML. So the row reads the last known answer and kicks a probe, and a
     CHANGED answer repaints the tab once. Without this the row would show a
     stale switch after someone flips permission in system settings and comes
     back to the app (notification-activation-spec.md §2.1). */
  let _pushRepaintQueued = false;
  window._fhPushSt = null;
  window.fhPushStateSync = function () { return window._fhPushSt; };
  window.fhPushStateProbe = async function () {
    try {
      const st = await window.fhPushState();
      if (st === window._fhPushSt) return st;
      window._fhPushSt = st;
      if (_pushRepaintQueued) return st;
      _pushRepaintQueued = true;
      /* Out of band: the probe is called FROM a render, so repainting inline
         would recurse through renderPersonal on every paint. */
      setTimeout(function () {
        _pushRepaintQueued = false;
        try {
          if (typeof window.renderPersonal === 'function' && document.getElementById('pers-body')) window.renderPersonal();
        } catch (e) {}
      }, 0);
      return st;
    } catch (e) { return window._fhPushSt; }
  };

  window.fhPushEnable = async function () {
    try {
      /* No family gate any more (0152): a solo account's queue push is the
         whole return loop, and "mở một gia đình trước" refused exactly the
         person the feature serves. Only a session is required. */
      if (!(window.fhUser && window.fhUser.id)) { window.toast && window.toast(L('Bạn cần đăng nhập trước đã', 'Please sign in first')); return false; }
      // permission FIRST: iOS drops the user-gesture context after an await
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') { window.fhPushSheet && window.fhPushSheet(); return false; }
      const reg = await navigator.serviceWorker.ready;
      let sub = await reg.pushManager.getSubscription();
      if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: _pushB64ToU8(_PUSH_PUB) });
      const ok = await _pushSaveSub(sub);
      if (!ok) { window.toast && window.toast(L('Không lưu được thiết bị này, thử lại', 'Could not save this device, try again')); return false; }
      window._closeOv && window._closeOv();
      window._fhPushSt = 'on'; window.fhPushStateProbe && window.fhPushStateProbe();
      window.toast && window.toast(L('Đã bật thông báo cho máy này', 'Notifications are on for this device'));
      return true;
    } catch (e) {
      console.warn('push enable', e);
      window.toast && window.toast(_friendly(e));
      return false;
    }
  };
  window.fhPushDisable = async function () {
    try {
      const sub = await _pushGetSub();
      if (sub) {
        try { await sb.from('push_subscriptions').delete().eq('endpoint', sub.endpoint); } catch (e) {}
        try { await sub.unsubscribe(); } catch (e) {}
      }
      window._closeOv && window._closeOv();
      window._fhPushSt = 'off'; window.fhPushStateProbe && window.fhPushStateProbe();
      window.toast && window.toast(L('Đã tắt thông báo cho máy này', 'Notifications are off for this device'));
      return true;
    } catch (e) { console.warn('push disable', e); return false; }
  };
  /* Silent re-sync after each hydrate: endpoints rotate and the active family
     can change (a same-account family switch, or a fresh sign-in after reload),
     so an opted-in device re-points its row at whatever family it wakes up in.
     Keyed on the active family, not once-per-session, so switching families
     without a reload still re-points. Cross-account switches can't self-heal
     here (RLS owns that boundary) — fhPushTeardown clears the old row instead. */
  window.fhPushResync = async function () {
    try {
      const uid = window.fhUser && window.fhUser.id; if (!uid) return;
      const fid = (window.DB && window.DB.fid) || null;
      const key = fid || ('p:' + uid);          // famless rows re-sync too (0152)
      if (window._fhPushSyncedFid === key) return;
      if (!_pushSupported() || Notification.permission !== 'granted') return;
      const sub = await _pushGetSub(); if (!sub) return;
      if (await _pushSaveSub(sub)) window._fhPushSyncedFid = key;
    } catch (e) {}
  };
  // Settings → Notifications sheet: state-aware, one clear action per state
  window.fhPushSheet = async function () {
    const st = await window.fhPushState();
    window._fhPushSt = st;
    let title = L('Thông báo', 'Notifications');
    let sub = '', act = '', prev = '';
    if (st === 'unsupported') {
      sub = L('Trình duyệt này chưa hỗ trợ thông báo đẩy.', 'This browser does not support push notifications.');
      act = _btn(L('Đã hiểu', 'Got it'), '_closeOv()', _S.cta);
    } else if (st === 'ios-install') {
      sub = L('Trên iPhone, hãy thêm Earthy vào Màn hình chính trước: bấm nút Chia sẻ rồi chọn “Thêm vào MH chính”. Sau đó mở app từ biểu tượng mới và bật thông báo ở đây.', 'On iPhone, first add Earthy to your Home Screen: tap Share, then “Add to Home Screen”. Then open the app from its new icon and turn notifications on here.');
      act = _btn(L('Đã hiểu', 'Got it'), '_closeOv()', _S.cta);
    } else if (st === 'denied') {
      sub = L('Thông báo đang bị chặn trong cài đặt hệ thống. Hãy mở Cài đặt của máy, tìm Earthy và cho phép thông báo, rồi quay lại đây.', 'Notifications are blocked in system settings. Open your device Settings, find Earthy, allow notifications, then come back here.');
      act = _btn(L('Đã hiểu', 'Got it'), '_closeOv()', _S.cta);
    } else if (st === 'on') {
      sub = document.documentElement.classList.contains('fh-nofam')
        ? L('Máy này sẽ nhắc bạn khi có khoản mới từ email, kể cả khi app đang đóng.', 'This device tells you when a new transaction arrives by email, even with the app closed.')
        : L('Máy này sẽ nhận thông báo khi cả nhà ghi một khoản, thêm ảnh, thả cảm xúc, gửi yêu cầu hoặc chia sẻ tâm trạng, kể cả khi app đang đóng.', 'This device gets a heads-up when the family logs an expense, adds a photo, reacts, sends a request or shares a mood, even with the app closed.');
      act = _btn(L('Tắt thông báo trên máy này', 'Turn off on this device'), 'fhPushDisable()', _S.line)
          + _btn(L('Xong', 'Done'), '_closeOv()', _S.cta);
    } else {
      /* THE ASK (notification-activation-spec.md §2.2). One line, then the real
         thing: two notifications built from this person's own newest rows, with
         their real times, chosen by the same function push-send uses. A written
         sample would be a promise the product can break the first time the copy
         tables change — which is exactly why the tables are generated into both
         runtimes from one source (spec §6). */
      title = L('Lần sau bạn biết ngay', 'You will know right away');
      sub = L('Có khoản mới là Earthy nhắc bạn, kể cả khi app đang đóng.',
              'Earthy tells you when something new arrives, even with the app closed.');
      prev = await _pushPreviewHTML();
      act = _btn(L('Bật thông báo', 'Turn on notifications'), 'fhPushEnable()', _S.cta);
    }
    _fhSheet('<div class="fh-s-h">' + title + '</div>'
      + '<div class="fh-s-sub">' + sub + '</div>' + prev + act);
  };
  /* ── Asking for permission (notification-activation-spec.md §3) ───────────
     The old rule was one ask per member seat, recorded the moment a sheet
     opened, and read forever after as a refusal. So a person who brushed the
     sheet away in their first thirty seconds was never asked again — and UT
     2026-09-26 (problem 13) found they then could not find the switch either.

     The record now holds how many times we have asked and when we last did.
     Three asks, fourteen days apart, and granting or reaching three ends it.
     A sheet we DECIDE not to open costs nothing: only a sheet that actually
     appeared spends an ask. */
  const _ASK_MAX = 3;
  const _ASK_GAP_MS = 14 * 24 * 60 * 60 * 1000;
  function _askId() {
    return (window.DB && window.DB.ownerMemberId) || (window.fhUser && window.fhUser.id) || '';
  }
  function _askRec(id) {
    let r = null;
    try { r = JSON.parse(localStorage.getItem('fh-push-asks:' + id) || 'null'); } catch (e) {}
    if (!r || typeof r.n !== 'number') {
      /* Honour the two legacy one-shot flags as ONE ask already spent, at time
         zero — so someone the old code silenced forever becomes askable again
         now, rather than starting over with a clean slate they never had. */
      let spent = false;
      try {
        spent = localStorage.getItem('fh-push-nudged:' + id) === '1'
             || localStorage.getItem('fh-mbx-push-nudged:' + id) === '1';
      } catch (e) {}
      r = { n: spent ? 1 : 0, t: 0 };
    }
    return r;
  }
  function _askSpend(id, r) {
    try { localStorage.setItem('fh-push-asks:' + id, JSON.stringify({ n: r.n + 1, t: Date.now() })); } catch (e) {}
  }
  /* Everything that must be true before ANY surface may ask. Sync, so a caller
     can cheaply decide whether to even build its card. */
  window.fhPushAskable = function () {
    const id = _askId(); if (!id) return false;
    const ob = document.getElementById('onboarding');
    if (ob && !ob.classList.contains('done')) return false;      // mid-onboarding
    const r = _askRec(id);
    if (r.n >= _ASK_MAX) return false;
    if (r.t && Date.now() - r.t < _ASK_GAP_MS) return false;
    return true;
  };
  /* The one door every surface goes through. `why` is for logs only. */
  window.fhPushAsk = async function (why) {
    try {
      if (!window.fhPushAskable()) return false;
      if ((await window.fhPushState()) !== 'off') return false;  // on / denied / iOS / unsupported
      const scrim = document.getElementById('scrim');
      if (scrim && scrim.classList.contains('on')) return false; // another sheet owns this moment
      if (window._fhPushAsking) return false;
      window._fhPushAsking = true;
      const id = _askId();
      _askSpend(id, _askRec(id));
      window.fhPushSheet();
      return true;
    } catch (e) { return false; }
  };
  /* Surface 2: the first mailbox read has just finished, in this session. */
  window.fhPushOfferAfterRead = function () {
    if (window._fhPushAskedThisSession) return;
    setTimeout(function () {
      if (window._fhPushAskedThisSession) return;
      window.fhPushAsk('read-finished').then(function (ok) { if (ok) window._fhPushAskedThisSession = true; });
    }, 1400);
  };
  /* Surface 3: the person's first import into the ledger just completed. It
     beats surface 2 when both land in one session — an ask after something you
     CHOSE to do reads better than one after something that happened to you. */
  window.fhPushOfferAfterImport = function () {
    if (window._fhPushAskedThisSession) return;
    window.fhPushAsk('first-import').then(function (ok) { if (ok) window._fhPushAskedThisSession = true; });
  };
  /* Retired. The first-home-visit offer asked before the person had any idea
     what would be sent; surfaces 2 and 3 replaced it. Kept as a no-op because
     boot and hydrate both call it, and it still does one useful thing: warm the
     state cache so the Tài Chính row paints correctly on first render. */
  window.fhPushFirstVisitOffer = function () {
    try { window.fhPushStateProbe && window.fhPushStateProbe(); } catch (e) {}
  };

  /* The live preview inside the ask. Built from the person's OWN newest rows
     through the same line-selection the server uses, so what they are shown is
     what they would actually have received. Any failure returns '' and the
     sheet stands on its subtitle: the ask must never be blocked by its garnish. */
  const _PUSH_BELL = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8.5a6 6 0 0 0-12 0c0 6-2.2 7.5-2.2 7.5h16.4S18 14.5 18 8.5"/><path d="M13.7 19.5a2 2 0 0 1-3.4 0"/></svg>';
  function _pEsc(v) {
    return String(v == null ? '' : v).replace(/[&<>"]/g, function (c) {
      return c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : '&quot;';
    });
  }
  async function _pushPreviewHTML() {
    try {
      if (typeof window.fhNotifyPreview !== 'function') return '';
      if (!window.FH_NOTIFY || typeof window.FH_NOTIFY.body !== 'function') return '';
      const items = await window.fhNotifyPreview(2);
      if (!items || !items.length) return '';
      const lang = (window.LANG === 'en') ? 'en' : 'vi';
      let cards = '';
      items.forEach(function (it, i) {
        let line = null;
        try { line = window.FH_NOTIFY.body(it.meta, lang, Math.random()); } catch (e) { line = null; }
        if (!line || !line.body) return;
        cards += '<div class="np-card' + (i ? ' np-dim' : '') + '">'
          + '<span class="np-ic">' + _PUSH_BELL + '</span>'
          + '<span class="np-tx">'
          +   '<span class="np-hd"><b>' + _pEsc(line.title || '') + '</b><i>' + _pEsc(it.time || '') + '</i></span>'
          +   '<span class="np-bd">' + _pEsc(line.body) + '</span>'
          + '</span></div>';
      });
      if (!cards) return '';
      return '<div class="np-wrap" onclick="fhPushSheet()">' + cards + '</div>'
        + '<div class="np-note">' + L('Khoản thật của bạn. Không số tiền, không tên cửa hàng.',
                                      'Your own transactions. No amounts, no merchant names.') + '</div>';
    } catch (e) { return ''; }
  }

  /* Fire-and-forget nudge to the family's other devices after a social write.
     Never blocks or fails the write it follows; a rapid re-tap REPLACES the
     row (upsert), so it should not re-buzz — hence the per-kind cooldown. */
  const _pushLastSent = {};
  window.fhNotify = function (kind, data) {
    try {
      if (!window.DB || !window.DB.fid || !window.fhUser) return;
      const now = Date.now();
      if (_pushLastSent[kind] && now - _pushLastSent[kind] < 12000) return;
      _pushLastSent[kind] = now;
      const body = Object.assign({ kind: kind }, data || {});
      /* committed-enc family: members.name is ciphertext server-side, so the
         edge function can't derive the actor's first name anymore. The sender's
         device supplies it — same trust boundary as the payload it already
         builds, and the function only accepts it when the DB name is null. */
      if (fhEncState() === 'enc') {
        const me = window.DB.memberById && window.DB.memberById[window.DB.ownerMemberId];
        if (me && me.name) body.actorName = String(me.name).slice(0, 40);
      }
      sb.functions.invoke('push-send', { body: body }).catch(() => {});
    } catch (e) {}
  };
  /* ---- arrival routing: a tapped notification lands on the thing itself ----
     Warm path: sw.js posts {type:'fh-nav', nav} into the already-open page.
     Cold path: sw.js launches ./#n=<nav>; we read the hash at boot and strip it
     so a manual reload never replays the jump. Either way the nav WAITS for the
     first hydrate: a cold start can't open a detail screen before the family
     data exists. Routes mirror _reqOpenCall (64-requests.js), so a notification
     tap lands exactly where the matching in-app card would go. */
  function _fhNavGo(nav) {
    try {
      if (!nav || !nav.k) return;
      if (nav.k === 'weather') { window.go && window.go('home'); return; }   // moods live on the home sky
      /* Staged bank transactions: the notification says only that something is
         waiting, so the tap has to land on the queue itself for it to mean
         anything. fhTxnReviewSheet fetches fresh — no row id is carried in the
         payload, deliberately, since it would be a plaintext handle to a private
         row travelling through a push service.

         Sits above the tx routes on purpose: a staged row is not in window.txns
         and has no _dbId to find, so it must be answered before anything tries
         to look one up. */
      if (nav.k === 'txn_review') {
        /* s:'personal' (2026-09-04): the pipeline staged into the PERSONAL
           scope, so the tap lands on the Cá nhân tab with the quick-review
           sheet forced open — a tap is explicit intent, so the once-only seen
           marker is bypassed. Rows the quick sheet won't handle (transfer,
           foreign currency, locked ledger) fall back to the full queue inside
           fhQuickReviewMaybe itself. Family scope keeps the classic landing. */
        if (nav.s === 'personal' && window.fhQuickReviewMaybe) {
          if (window.go) window.go('personal');
          window.fhQuickReviewMaybe({ force: true });
          return;
        }
        if (window.fhTxnReviewSheet) { window.fhTxnReviewSheet(); return; }
        if (window.go) window.go('spending');                                 // not yet loaded: the ledger is next best
        return;
      }
      if (nav.k === 'expense_bulk') { window.go && window.go('spending'); return; }   // a batch → the ledger
      // an expense to open: a reaction, a freshly logged expense, or a photo-expense (memory carries tx)
      if (nav.tx && (nav.k === 'reaction' || nav.k === 'expense_new' || nav.k === 'memory_new')) {
        const t = (window.txns || []).find((x) => x._dbId === nav.tx);
        if (t && window.openExpenseDetail) { window.openExpenseDetail(t.id); return; }
        if (window.go) window.go('spending');                                // expense gone: the ledger is next best
        return;
      }
      const eid = nav.eid;                                                    // request_new / request_response / memory_new (event)
      if (nav.et === 'expense') {
        const tx = (window.txns || []).find((x) => x._dbId === eid);
        if (tx && window.openExpenseDetail) { window.openExpenseDetail(tx.id); return; }
      } else if (nav.et === 'goal') {
        const gs = window.goals || {};
        const gk = (window.goalOrder || []).find((k) => gs[k] && (gs[k]._dbId === eid || k === eid));
        if (gk && window.openGoalDetail) { window.openGoalDetail(gk); return; }
      } else if (nav.et === 'occasion') {
        const evs = window.events || {};
        const ek = (window.order || []).find((k) => evs[k] && (evs[k]._dbId === eid || k === eid));
        if (ek && window.openEvent) { window.openEvent(ek); return; }
      }
      if (window.openRequests) window.openRequests();                         // entity gone or unknown: the hub explains itself
    } catch (e) {}
  }
  let _navTimer = null;
  window.fhNavTo = function (nav) {
    clearTimeout(_navTimer);
    const t0 = Date.now();
    (function _wait() {
      if (window.DB && window.DB._hydrated) { _fhNavGo(nav); return; }
      if (Date.now() - t0 > 20000) return;                                    // data never came: stay put
      _navTimer = setTimeout(_wait, 300);
    })();
  };
  // warm path: the service worker relays the tapped notification's destination
  try {
    if (navigator.serviceWorker) navigator.serviceWorker.addEventListener('message', (ev) => {
      const d = ev && ev.data;
      if (d && d.type === 'fh-nav') window.fhNavTo(d.nav);
    });
  } catch (e) {}
  // cold path: the destination rode in on the launch URL's hash
  try {
    const _nm = /[#&]n=([^&]+)/.exec(location.hash || '');
    if (_nm) {
      const _nav = JSON.parse(decodeURIComponent(_nm[1]));
      history.replaceState(null, '', location.pathname + location.search);
      window.fhNavTo(_nav);
    }
  } catch (e) {}
