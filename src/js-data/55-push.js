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
    const fid = window.DB && window.DB.fid, mid = window.DB && window.DB.ownerMemberId;
    if (!fid || !mid || !sub) return false;
    const j = sub.toJSON ? sub.toJSON() : sub;
    const res = await sb.from('push_subscriptions').upsert({
      family_id: fid, member_id: mid, endpoint: sub.endpoint,
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
  window.fhPushEnable = async function () {
    try {
      const fid = window.DB && window.DB.fid, mid = window.DB && window.DB.ownerMemberId;
      if (!fid || !mid) { window.toast && window.toast(L('Hãy mở một gia đình trước', 'Open a family first')); return false; }
      // permission FIRST: iOS drops the user-gesture context after an await
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') { window.fhPushSheet && window.fhPushSheet(); return false; }
      const reg = await navigator.serviceWorker.ready;
      let sub = await reg.pushManager.getSubscription();
      if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: _pushB64ToU8(_PUSH_PUB) });
      const ok = await _pushSaveSub(sub);
      if (!ok) { window.toast && window.toast(L('Không lưu được thiết bị này, thử lại', 'Could not save this device, try again')); return false; }
      window._closeOv && window._closeOv();
      window.toast && window.toast(L('Đã bật thông báo cho máy này 🔔', 'Notifications are on for this device 🔔'));
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
      const fid = window.DB && window.DB.fid; if (!fid) return;
      if (window._fhPushSyncedFid === fid) return;
      if (!_pushSupported() || Notification.permission !== 'granted') return;
      const sub = await _pushGetSub(); if (!sub) return;
      if (await _pushSaveSub(sub)) window._fhPushSyncedFid = fid;
    } catch (e) {}
  };
  // Settings → Notifications sheet: state-aware, one clear action per state
  window.fhPushSheet = async function () {
    const st = await window.fhPushState();
    const h = '<div class="fh-s-h">' + L('Thông báo', 'Notifications') + '</div>';
    let sub = '', act = '';
    if (st === 'unsupported') {
      sub = L('Trình duyệt này chưa hỗ trợ thông báo đẩy.', 'This browser does not support push notifications.');
      act = _btn(L('Đã hiểu', 'Got it'), '_closeOv()', _S.cta);
    } else if (st === 'ios-install') {
      sub = L('Trên iPhone, hãy thêm FamilyHub vào Màn hình chính trước: bấm nút Chia sẻ rồi chọn “Thêm vào MH chính”. Sau đó mở app từ biểu tượng mới và bật thông báo ở đây.', 'On iPhone, first add FamilyHub to your Home Screen: tap Share, then “Add to Home Screen”. Then open the app from its new icon and turn notifications on here.');
      act = _btn(L('Đã hiểu', 'Got it'), '_closeOv()', _S.cta);
    } else if (st === 'denied') {
      sub = L('Thông báo đang bị chặn trong cài đặt hệ thống. Hãy mở Cài đặt của máy, tìm FamilyHub và cho phép thông báo, rồi quay lại đây.', 'Notifications are blocked in system settings. Open your device Settings, find FamilyHub, allow notifications, then come back here.');
      act = _btn(L('Đã hiểu', 'Got it'), '_closeOv()', _S.cta);
    } else if (st === 'on') {
      sub = L('Máy này sẽ nhận thông báo khi cả nhà thả cảm xúc, gửi yêu cầu hoặc chia sẻ tâm trạng, kể cả khi app đang đóng.', 'This device gets a heads-up when the family reacts, sends a request or shares a mood, even with the app closed.');
      act = _btn(L('Tắt thông báo trên máy này', 'Turn off on this device'), 'fhPushDisable()', _S.line)
          + _btn(L('Xong', 'Done'), '_closeOv()', _S.cta);
    } else {
      sub = L('Nhận thông báo khi cả nhà thả cảm xúc, gửi yêu cầu hoặc chia sẻ tâm trạng, kể cả khi app đang đóng.', 'Get a heads-up when the family reacts, sends a request or shares a mood, even with the app closed.');
      act = _btn(L('Bật thông báo 🔔', 'Turn on notifications 🔔'), 'fhPushEnable()', _S.cta);
    }
    _fhSheet(h + '<div class="fh-s-sub">' + sub + '</div>' + act);
  };
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
      if (nav.k === 'reaction') {
        const t = (window.txns || []).find((x) => x._dbId === nav.tx);
        if (t && window.openExpenseDetail) { window.openExpenseDetail(t.id); return; }
        if (window.go) window.go('spending');                                // expense gone: the ledger is next best
        return;
      }
      const eid = nav.eid;                                                    // request_new / request_response
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
