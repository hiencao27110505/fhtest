  /* ═══ Fullscreen unlock wall (replaces the unlock bottom-sheet) ══════════════
     A signed-in device with no key is genuinely locked, so the unlock is a
     full-screen wall that owns the app — not a swipe-away sheet. It serves both
     a returning-locked user (onboarding is already done) AND a member who just
     joined a card family (the wall appears right after onboarding finishes, once
     the family has hydrated and its card wrap is known).

     It is NOT a trap. The stress-test escapes are all here and mandatory:
       • Browse read-only — drops into the visible-but-masked state (reads work,
         money hidden, writes still blocked) so a member without the code yet is
         never locked out of the family.
       • Both inputs during dual-wrap — while a 6-digit passcode still exists it
         is offered as a first-class alternative to the card.
       • Sign out — for a wrong Google account / wrong family / owner-unreachable.
       • Help — "I don't have the code" points at asking the owner.
     Fail-open: it only shows when the device is truly locked with a usable
     recipe; on any doubt (already keyed, enc off, no recipe/offline, a pending
     card link that will auto-unlock) it does nothing and the non-blocking lock
     bar remains. Reuses the crypto ops (fhCardUnlock / fhPasscodeUnlock) and the
     shared teardown (fhAfterUnlock) — it owns UI, never key material. */

  let _lwMode = 'card';        // 'card' | 'passcode' (the input currently shown)
  let _lwHelp = false;

  function _lwFlags() {
    const enc = window.DB && window.DB.enc;
    return {
      enc: enc,
      hasCard: !!(window.fhHasCard && window.fhHasCard()),
      hasPass: !!(enc && enc.wrapped_dek),
      dual: !!(enc && enc.enc_state === 'dual'),
    };
  }

  const _LW_LOCK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="10.5" width="14" height="9.5" rx="2.6"/><path d="M8 10.5V7.8a4 4 0 018 0v2.7"/></svg>';

  function _lwErr(msg) {
    const e = document.getElementById('fh-lw-err'); if (e) e.textContent = msg || '';
  }

  // (re)draw the wall body for the current mode. Called on open and on toggling
  // between the card and the 6-digit fallback.
  function _lwRenderBody() {
    const f = _lwFlags();
    const card = _lwMode === 'card';
    const title = card
      ? L('Nhập mã khóa của nhà', 'Enter your family code')
      : L('Nhập mã 6 số', 'Enter the 6-digit code');
    const sub = card
      ? L('Máy này cần mã khóa của nhà để mở dữ liệu. Dán, quét hoặc gõ vào đây.',
          'This device needs your family code to open the data. Paste, scan or type it here.')
      : (f.dual
          ? L('Nhập mã 6 số một lần để tiếp tục ghi chép trên máy này.',
              'Enter the 6-digit code once to keep logging on this device.')
          : L('Thiết bị này cần mã 6 số của gia đình để hiện số tiền.',
              'This device needs the family’s 6-digit code to show amounts.'));

    const input = card
      ? '<div class="fh-lw-field">'
          + '<input id="fh-lw-input" placeholder="FH-XXXX-XXXX-…" autocapitalize="characters" autocomplete="off" spellcheck="false" enterkeyhint="go">'
          + '<button class="fh-lw-paste" type="button" onclick="fhLockWallPaste()">' + L('Dán', 'Paste') + '</button>'
        + '</div>'
      : '<div class="fh-lw-field">'
          + '<input id="fh-lw-input" class="pc" inputmode="numeric" pattern="[0-9]*" maxlength="6" autocomplete="one-time-code" enterkeyhint="go" placeholder="••••••">'
        + '</div>';

    // dual-wrap: offer the other credential as a first-class alternative
    let alt = '';
    if (f.hasCard && f.hasPass) {
      alt = card
        ? '<button class="fh-lw-alt" type="button" onclick="fhLockWallMode(\'passcode\')">' + L('Hoặc dùng mã 6 số', 'Or use the 6-digit code') + '</button>'
        : '<button class="fh-lw-alt" type="button" onclick="fhLockWallMode(\'card\')">' + L('Dùng mã khóa của nhà', 'Use the family code') + '</button>';
    }

    const help = card
      ? L('Chưa có mã khóa? Nhờ chủ gia đình chia sẻ mã khóa của nhà cho bạn. Trong lúc chờ, bạn vẫn có thể xem trước.',
          'No code yet? Ask the family owner to share your family code. Meanwhile you can still browse.')
      : L('Chưa có mã? Nhờ chủ gia đình cho bạn mã 6 số. Trong lúc chờ, bạn vẫn có thể xem trước.',
          'No code yet? Ask the owner for the 6-digit code. Meanwhile you can still browse.');

    return '<div class="fh-lw-hero">'
        + '<div class="fh-lw-badge">' + _LW_LOCK + '</div>'
        + '<div class="fh-lw-title">' + title + '</div>'
        + '<div class="fh-lw-sub">' + sub + '</div>'
      + '</div>'
      + input
      + '<div class="fh-lw-err" id="fh-lw-err"></div>'
      + '<button class="fh-lw-cta" id="fh-lw-cta" type="button" onclick="fhLockWallSubmit()">' + L('Mở khóa', 'Unlock') + '</button>'
      + alt
      + '<div class="fh-lw-foot">'
        + '<button class="fh-lw-browse" type="button" onclick="fhLockWallClose(true)">' + L('Xem trước, mở khóa sau', 'Browse for now, unlock later') + '</button>'
        + '<div class="fh-lw-links">'
          + '<button type="button" onclick="fhLockWallHelp()">' + L('Tôi chưa có mã', 'I don’t have the code') + '</button>'
          + '<span style="color:var(--muted)">·</span>'
          + '<button type="button" onclick="fhLockWallSignOut()">' + L('Đăng xuất', 'Sign out') + '</button>'
        + '</div>'
        + '<div class="fh-lw-help' + (_lwHelp ? ' on' : '') + '" id="fh-lw-help">' + help + '</div>'
      + '</div>';
  }

  function _lwWire() {
    const inp = document.getElementById('fh-lw-input');
    if (!inp) return;
    if (_lwMode === 'passcode') {
      inp.addEventListener('input', () => { inp.value = inp.value.replace(/\D/g, '').slice(0, 6); _lwErr(''); });
    } else {
      inp.addEventListener('input', () => _lwErr(''));
    }
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); window.fhLockWallSubmit(); } });
    setTimeout(() => { try { inp.focus(); } catch (e) {} }, 320);
  }

  /* Show the wall. opts.auto = a background trigger (hydrate / foreground): it
     respects a deliberate "browse" choice this session and never covers a live
     onboarding screen. An explicit call (lock bar, blocked write, Settings)
     always shows. */
  window.fhLockWall = function (opts) {
    opts = opts || {};
    if (window.fhKeyReady && window.fhKeyReady()) return;          // already keyed
    // A pending #fh-k= link auto-unlocks — suppress only the AUTO wall so it
    // doesn't race that. An EXPLICIT open (lock bar, blocked write, Settings)
    // must always render, or a stuck flag would dead-button the only way in.
    if (opts.auto && window.__fhPendingCard) return;
    const f = _lwFlags();
    // Not an encrypted family → nothing to unlock. force:true lets a deliberate
    // caller (enable-encryption on a fresh device) still surface the passcode
    // input in the 'off' state, where a wrapped_dek exists but no session key.
    if (!f.enc || (f.enc.enc_state === 'off' && !opts.force)) return;
    if (!f.hasCard && !f.hasPass) return;                         // no recipe on device (offline) → don't trap; lock bar stays
    if (opts.auto && window.__fhLockBrowsed) return;              // respected a deliberate browse this session
    const ob = document.getElementById('onboarding');
    if (opts.auto && ob && !ob.classList.contains('done')) return; // don't cover a live onboarding step
    if (opts.auto && document.querySelector('.sheet.on, .modal.on')) return; // don't slam over an open sheet/modal; lock bar stays, next trigger re-raises
    if (document.getElementById('fh-lockwall')) return;           // already open

    _lwMode = f.hasCard ? 'card' : 'passcode';
    _lwHelp = false;
    const el = document.createElement('div');
    el.id = 'fh-lockwall';
    el.innerHTML = '<div class="fh-lw-inner">' + _lwRenderBody() + '</div>';
    (document.getElementById('phone') || document.body).appendChild(el);
    window.fhLockBanner && window.fhLockBanner(false);            // the wall replaces the pill while it's up
    _lwWire();
  };

  // Switch between the card input and the 6-digit fallback (dual-wrap only).
  window.fhLockWallMode = function (mode) {
    if (mode !== 'card' && mode !== 'passcode') return;
    _lwMode = mode; _lwHelp = false;
    const inner = document.querySelector('#fh-lockwall .fh-lw-inner');
    if (inner) { inner.innerHTML = _lwRenderBody(); _lwWire(); }
  };

  window.fhLockWallHelp = function () {
    _lwHelp = !_lwHelp;
    const h = document.getElementById('fh-lw-help'); if (h) h.classList.toggle('on', _lwHelp);
  };

  window.fhLockWallPaste = async function () {
    try {
      const t = await navigator.clipboard.readText();
      const inp = document.getElementById('fh-lw-input');
      if (inp && t) { inp.value = t.trim(); _lwErr(''); inp.focus(); }
    } catch (e) { window.toast && window.toast(L('Chưa dán được, thử gõ tay nhé', 'Couldn’t paste, try typing it')); }
  };

  window.fhLockWallSignOut = function () {
    window.fhLockWallClose();          // take the wall down first so it can't linger over the reset UI
    if (window.fhSignOut) window.fhSignOut();
  };

  window.fhLockWallSubmit = async function () {
    const inp = document.getElementById('fh-lw-input'); if (!inp) return;
    const val = (inp.value || '').trim();
    _lwErr('');
    if (_lwMode === 'passcode' && !/^\d{6}$/.test(val)) { _lwErr(L('Nhập đủ 6 chữ số', 'Enter all 6 digits')); inp.focus(); return; }
    const cta = document.getElementById('fh-lw-cta');
    if (cta && cta.disabled) return;                              // in-flight (a second Enter/Go keydown) → ignore
    const label = cta ? cta.textContent : '';
    if (cta) { cta.disabled = true; cta.textContent = L('Đang mở…', 'Unlocking…'); }
    try {
      if (_lwMode === 'card') await window.fhCardUnlock(val);
      else await window.fhPasscodeUnlock(val);
    } catch (e) {
      // friendly text only — never echo a raw DOMException / Postgres string
      _lwErr(window._fhFriendly ? window._fhFriendly(e) : ((e && e.fhMsg) || L('Không mở được, thử lại', 'Couldn’t unlock, try again')));
      if (cta) { cta.disabled = false; cta.textContent = label; }
      try { inp.focus(); inp.select && inp.select(); } catch (x) {}
      return;
    }
    window.toast && window.toast(L('Đã mở khóa ✓', 'Unlocked ✓'));
    // fhAfterUnlock drops the lock affordances (incl. closing this wall), flushes
    // held money rows, refreshes, then retires tolerated plaintext.
    if (window.fhAfterUnlock) window.fhAfterUnlock();
    else { window.fhLockWallClose(); if (window.loadFamilyData) window.loadFamilyData(); }
  };

  // Close the wall. browsed=true means the user chose to browse read-only: mark
  // it so the auto-trigger doesn't re-block this session, and restore the
  // non-blocking lock bar as the way back in.
  window.fhLockWallClose = function (browsed) {
    const el = document.getElementById('fh-lockwall'); if (el) el.remove();
    if (browsed) {
      window.__fhLockBrowsed = 1;
      const enc = window.DB && window.DB.enc;
      const keyed = window.fhKeyReady && window.fhKeyReady();
      if (window.fhLockBanner && enc && enc.enc_state !== 'off' && !keyed) window.fhLockBanner(true, enc.enc_state);
    }
  };

  // Every explicit "you need the key" entry point (lock bar tap, blocked write,
  // Settings unlock, card migrate/regenerate) routes here → the wall, always.
  window.fhUnlockPrompt = function () { return window.fhLockWall(); };
