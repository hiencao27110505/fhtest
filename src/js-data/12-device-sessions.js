  /* ═══ Device session registry + cooperative revocation (trust rec #6) ═══════
     Every signed-in device registers under the account so the owner can see it in
     Settings → "Thiết bị đăng nhập" and cut off a lost / lent / sold phone. Supabase
     JWTs are stateless, so a revoked device can't be force-killed from the client —
     instead each device re-checks device_active() on resume AND on foreground and
     signs ITSELF out (+ wipes local secrets) the instant it sees a revocation. The
     stable per-device id lives in localStorage; clearing it just mints a new row on
     the next sign-in. Shares the js-data module scope (sb, _rpc). */
  const _DEV_ID_KEY = 'fh-device-id';
  function fhDeviceId() {
    let id = null;
    try { id = localStorage.getItem(_DEV_ID_KEY); } catch (e) {}
    if (!id) {
      try { id = (crypto.randomUUID ? crypto.randomUUID() : ('dev-' + Date.now() + '-' + Math.floor(Math.random() * 1e9).toString(16))); }
      catch (e) { id = 'dev-' + Date.now(); }
      try { localStorage.setItem(_DEV_ID_KEY, id); } catch (e) {}
    }
    return id;
  }
  window.fhDeviceId = fhDeviceId;

  function _devStandalone() {
    try { return !!((window.matchMedia && matchMedia('(display-mode: standalone)').matches) || navigator.standalone); } catch (e) { return false; }
  }
  // A coarse, privacy-light label ("Android · Chrome · App"). No fingerprinting.
  function _devLabel() {
    const ua = navigator.userAgent || '';
    let os = L('Thiết bị', 'Device');
    if (/android/i.test(ua)) os = 'Android';
    else if (/iphone/i.test(ua)) os = 'iPhone';
    else if (/ipad/i.test(ua)) os = 'iPad';
    else if (/mac os x|macintosh/i.test(ua)) os = 'Mac';
    else if (/windows/i.test(ua)) os = 'Windows';
    else if (/linux/i.test(ua)) os = 'Linux';
    let br = '';
    if (/edg\//i.test(ua)) br = 'Edge';
    else if (/opr\/|opera/i.test(ua)) br = 'Opera';
    else if (/chrome|crios/i.test(ua)) br = 'Chrome';
    else if (/firefox|fxios/i.test(ua)) br = 'Firefox';
    else if (/safari/i.test(ua)) br = 'Safari';
    return os + (br ? ' · ' + br : '') + (_devStandalone() ? ' · App' : '');
  }

  async function _devActive() {
    // Unknown / offline / RPC-missing → fail-open (true): never lock out a legit
    // user because the check couldn't run. Only an explicit false revokes.
    try { const a = await _rpc('device_active', { p_device_id: fhDeviceId() }); return a !== false; }
    catch (e) { return true; }
  }
  async function _devEnforce() {
    if (await _devActive()) return true;
    window.toast && window.toast(L('Thiết bị này đã được đăng xuất từ xa', 'This device was signed out remotely'));
    if (window.fhSignOut) await window.fhSignOut();   // the single sign-out: erases local data + drops this device
    return false;
  }

  function fhDeviceRegister() {
    try { _rpc('register_device', { p_device_id: fhDeviceId(), p_label: _devLabel(), p_user_agent: (navigator.userAgent || '').slice(0, 300), p_platform: _devStandalone() ? 'pwa' : 'browser' }); } catch (e) {}
  }
  window.fhDeviceRegister = fhDeviceRegister;

  let _devHbArmed = false;
  function _devArmHeartbeat() {
    if (_devHbArmed) return; _devHbArmed = true;
    document.addEventListener('visibilitychange', async () => {
      if (document.visibilityState !== 'visible') return;
      try { _rpc('touch_device', { p_device_id: fhDeviceId() }); } catch (e) {}   // "seen recently"
      await _devEnforce();                                                         // revoked while backgrounded → out now
    });
  }

  /* Boot/resume gate — called from afterLogin BEFORE the app lands on Home.
     Returns false (and signs the device out) if this device was revoked; true to
     proceed. Registers the device + arms the heartbeat on the way through. */
  window.fhDeviceCheck = async function () {
    const ok = await _devEnforce();
    if (!ok) return false;
    fhDeviceRegister();
    _devArmHeartbeat();
    return true;
  };

  // ── Settings → "Signed-in devices" ─────────────────────────────────────────
  function _devWhen(ts) {
    if (!ts) return '';
    const t = new Date(ts).getTime(); if (!t) return '';
    const s = Math.max(0, (Date.now() - t) / 1000);
    if (s < 90) return L('vừa xong', 'just now');
    if (s < 3600) return L('' + Math.round(s / 60) + ' phút trước', Math.round(s / 60) + ' min ago');
    if (s < 86400) return L('' + Math.round(s / 3600) + ' giờ trước', Math.round(s / 3600) + 'h ago');
    return L('' + Math.round(s / 86400) + ' ngày trước', Math.round(s / 86400) + 'd ago');
  }
  window.fhDevicesSheet = async function () {
    let devs = [];
    try { devs = (await _rpc('my_devices')) || []; }
    catch (e) { window.toast && window.toast(window._fhFriendly ? window._fhFriendly(e) : L('Không tải được danh sách thiết bị', 'Couldn’t load your devices')); return; }
    const meId = fhDeviceId();
    const rows = (devs || []).map((d) => {
      const me = d.device_id === meId, rev = !!d.revoked_at;
      return '<div class="fh-dev-row' + (rev ? ' rev' : '') + '">'
        + '<div class="fh-dev-main"><div class="fh-dev-name">' + window.esc(d.label || L('Thiết bị', 'Device'))
        + (me ? '<span class="fh-dev-me">' + L('máy này', 'this device') + '</span>' : '') + '</div>'
        + '<div class="fh-dev-meta">' + (rev ? L('Đã đăng xuất', 'Signed out') : (L('Hoạt động ', 'Active ') + _devWhen(d.last_seen_at))) + '</div></div>'
        + ((!me && !rev) ? '<button class="fh-dev-revoke" onclick="fhRevokeDevice(\'' + window.esc(d.device_id) + '\',this)">' + L('Đăng xuất', 'Sign out') + '</button>' : '')
        + '</div>';
    }).join('');
    _fhSheet('<div class="fh-s-h">' + L('Thiết bị đăng nhập', 'Signed-in devices') + '</div>'
      + '<div class="fh-s-sub">' + L('Những máy đang đăng nhập vào tài khoản này. Thấy máy lạ thì đăng xuất để cắt quyền truy cập của nó.',
          'Devices signed in to this account. Sign out any you don’t recognise to cut its access.') + '</div>'
      + '<div class="fh-dev-list">' + (rows || ('<div class="fh-s-sub">' + L('Chưa có thiết bị nào', 'No devices yet') + '</div>')) + '</div>'
      + '<button class="fh-s-cta" onclick="_closeOv()">' + L('Xong', 'Done') + '</button>');
  };
  window.fhRevokeDevice = async function (id, btn) {
    if (btn) { btn.disabled = true; btn.classList.add('fh-busy'); }
    try { await _rpc('revoke_device', { p_device_id: id }); }
    catch (e) { if (btn) { btn.disabled = false; btn.classList.remove('fh-busy'); } window.toast && window.toast(window._fhFriendly ? window._fhFriendly(e) : L('Không thực hiện được, thử lại', 'Couldn’t do that, try again')); return; }
    window.toast && window.toast(L('Đã đăng xuất thiết bị đó', 'That device was signed out'));
    if (window.fhDevicesSheet) window.fhDevicesSheet();   // refresh
  };
