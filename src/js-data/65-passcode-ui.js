  /* ═══ Passcode door + whitelist UI (0030) ═══════════════════════════════════
     Joining is strict two-factor: the owner whitelists the invitee's Google
     email (whitelist_add) AND tells them the 6-digit family passcode. The
     passcode is derived client-side (15-crypto) — the server only ever sees
     K_auth. On success the joiner unwraps the family DEK locally and caches it.
     The owner's "Invite" sheet becomes: manage whitelist + passcode lifecycle. */

  let _fhJoinCtx = null;              // find_my_invite() payload while on the join screen

  const _pcDigits = (el) => { el.value = (el.value || '').replace(/\D/g, '').slice(0, 6); };
  const _pcField = (id, label) =>
    '<div class="field"><label>' + label + '</label>'
    + '<input id="' + id + '" class="num big" inputmode="numeric" pattern="[0-9]*" maxlength="6" autocomplete="one-time-code"'
    + ' oninput="this.value=this.value.replace(/\\D/g,\'\').slice(0,6);fhModalDirty()"></div>';
  const _pcVal = (id) => (document.getElementById(id) ? document.getElementById(id).value : '') || '';
  const _pcOk = (id) => /^\d{6}$/.test(_pcVal(id));
  // The one honest warning, shown wherever the passcode is created or changed.
  const _pcWarn = () => '<div class="field-hint" style="margin-top:10px">'
    + L('Mã này là chìa khóa duy nhất khi bật mã hóa tài chính. Nếu cả nhà quên mã và không còn thiết bị nào đang đăng nhập, dữ liệu đã mã hóa sẽ mất vĩnh viễn, chúng tôi cũng không thể khôi phục.',
        'This code is the only key once money encryption is on. If everyone forgets it and no signed-in device remains, encrypted money data is gone for good. We can’t recover it either.')
    + '</div>';

  function _fhLockedMsg(secs) {
    const mins = Math.max(1, Math.ceil((Number(secs) || 900) / 60));
    return L('Sai mã quá 5 lần. Thử lại sau ' + mins + ' phút.', 'Too many wrong tries. Try again in ' + mins + ' min.');
  }
  /* wrong_passcode / locked_out arrive as PAYLOAD values, not thrown errors —
     the server returns them so the failed-attempt row commits (an exception
     would roll the throttle's own bookkeeping back). Normalize to throws here. */
  function _fhThrowPcError(data) {
    if (!data || !data.error) return data;
    const err = new Error(data.error);
    err.retrySecs = data.retry_secs;
    throw err;
  }
  const _fhErr = (msg) => { const e = new Error(msg); e.fhMsg = msg; return e; };   // survives _friendly()

  /* Recovery for a server-rejected plaintext write (0033 'enc_required'). The
     goal is that the user continues, not just learns why they failed:
       1. an immediate SW update check — if this build is stale, the new sw.js
          installs, controllerchange fires and the app reloads itself into the
          current build (the queued entry survives the reload in IndexedDB);
       2. a state refresh — hydrate re-learns enc_state so the client guards
          and the lock widget engage without waiting for realtime;
       3. the passcode prompt — after unlock the outbox flush lands anything
          that was held.
     Debounced: one recovery per 10s no matter how many writes bounced. */
  let _fhRecovAt = 0;
  window._fhEncRecover = async function () {
    if (Date.now() - _fhRecovAt < 10000) return;
    _fhRecovAt = Date.now();
    /* Builds now WAIT by default (no skipWaiting) — but recovery MUST self-heal now,
       not on the next tap, so force the freshly-installed worker to take over: it
       activates, controllerchange fires, and the app reloads into the current build.
       The queued write survives the reload in IndexedDB and lands on the flush. */
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      if (reg) {
        try { await reg.update(); } catch (e) {}
        const force = () => { if (reg.waiting) { try { reg.waiting.postMessage({ type: 'SKIP_WAITING' }); } catch (e) {} return true; } return false; };
        if (!force() && reg.installing) {
          const sw = reg.installing;
          sw.addEventListener('statechange', () => { if (sw.state === 'installed') force(); });
        }
      }
    } catch (e) {}
    try { if (window.loadFamilyData) await window.loadFamilyData(); } catch (e) {}
    if (window.DB && window.DB.enc && window.DB.enc.enc_state !== 'off' && !fhKeyReady()) { if (window.fhLockWall) window.fhLockWall({ auto: true }); }
  };

  // ── Joiner: the "Your family" screen — every pending invite for this email
  //    (0-3+), plus a create path. Rendered by obRenderStart(); the footer holds
  //    exactly ONE primary CTA (Join in invite mode, Create in create mode). ──
  const _obTreeMark = '<svg viewBox="0 0 64 64" aria-hidden="true"><circle cx="32" cy="32" r="32" fill="var(--brand-tint)"/><ellipse cx="32" cy="50" rx="14" ry="2.4" fill="var(--gshadow)"/><rect x="29.2" y="34" width="5.6" height="15" rx="2.8" fill="var(--wood)"/><circle cx="32" cy="24" r="11.5" fill="var(--brand-2)"/><circle cx="23" cy="31" r="7" fill="var(--brand-2)"/><circle cx="41.5" cy="30" r="8" fill="var(--brand-2)"/><path d="M23 34 A13 13 0 0 0 41 33.5" fill="none" stroke="rgba(26,90,60,.10)" stroke-width="3" stroke-linecap="round"/></svg>';
  const _obCheck = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12l5 5L20 7"/></svg>';
  let _obInvites = [], _obMode = 'create', _obSel = 0, _obEmail = '', _obChecking = false;
  const _g = (id) => document.getElementById(id);

  function _obInviteCard(inv, i, on) {
    const by = _esc(inv.invited_by || L('chủ gia đình', 'the owner'));
    const sub = L('Mời bởi ' + by, 'Invited by ' + by);   // passcode vs card is conveyed by the code row that unfolds under the picked one
    return '<button type="button" class="ob-invcard' + (on ? ' on' : '') + '" role="radio" aria-checked="' + (on ? 'true' : 'false') + '" onclick="obSelInvite(' + i + ')">'
      + '<span class="ob-preview-ic">' + _obTreeMark + '</span>'
      + '<span class="ob-invcard-txt"><span class="ob-preview-fam">' + _esc(inv.family_name || 'Family') + '</span>'
      + '<span class="ob-preview-sub">' + sub + '</span></span>'
      + '<span class="ob-invcard-tick">' + _obCheck + '</span></button>';
  }
  function _obCodeBlock() {
    const lbl = _escAttr(L('Mã gia đình 6 số', '6-digit family passcode'));
    return '<div class="ob-code-wrap" id="ob-code-wrap">'
      + '<div class="ob-code-boxes" id="ob-code-boxes" role="group" aria-label="' + lbl + '"></div>'
      + '<input class="ob-code" id="ob-code" maxlength="6" inputmode="numeric" pattern="[0-9]*" autocomplete="one-time-code" oninput="obCodeInput(this)" aria-label="' + lbl + '"></div>';
  }
  // Paint the body + primary CTA for the current mode. Idempotent — called on
  // entry, on invite selection, and on the create/invite toggle.
  window.obRenderStart = function () {
    const body = _g('ob-start-body'), sub = _g('ob-start-sub'), cta = _g('ob-primary-cta'), hint = _g('ob-join-hint');
    if (!body || !cta) return;
    if (_obMode === 'create') {
      if (sub) sub.textContent = _obInvites.length
        ? L('Đặt tên cho tổ ấm mới của bạn.', 'Name your new home.')
        : L('Đặt tên cho tổ ấm của mình để bắt đầu.', 'Name your home and you’re in.');
      body.innerHTML =
        '<div class="field"><label>' + L('Tên gia đình', 'Family name') + '</label>'
        + '<input id="ob-famname" value="' + _escAttr((window.FAM && window.FAM.familyName) || '') + '" placeholder="' + _escAttr(L('vd. Nhà mình', 'e.g. The Reeds')) + '" maxlength="40" enterkeyhint="done" autocomplete="off"></div>'
        + (_obInvites.length ? '<button type="button" class="ob-linkback" onclick="obShowInvites()">' + L('Quay lại lời mời', 'Back to your invites') + '</button>' : '');
      cta.textContent = L('Tạo gia đình', 'Create family');
      if (hint) {
        if (_obChecking) hint.textContent = L('Đang tìm lời mời cho bạn…', 'Checking for an invite…');
        else if (_obInvites.length) hint.textContent = '';
        else hint.innerHTML = L(
          'Được người thân mời? Nhờ họ thêm đúng email <b>' + _esc(_obEmail) + '</b> vào danh sách mời (Cài đặt → Mời thành viên), lời mời sẽ hiện ở đây. ',
          'Expecting an invite? Ask them to add exactly <b>' + _esc(_obEmail) + '</b> to the invite list (Settings → Invite a member) and it shows up here. ')
          + '<button class="ob-hint-link" onclick="obJoinPrep()">' + L('Kiểm tra lại', 'Check again') + '</button>';
      }
    } else {
      const sel = _obInvites[_obSel] || {};
      if (sub) sub.textContent = _obInvites.length > 1
        ? L('Chọn gia đình để tham gia, hoặc tạo tổ ấm riêng.', 'Pick a family to join, or start your own.')
        : L('Tham gia gia đình đang mời bạn, hoặc tạo tổ ấm riêng.', 'Join the family that invited you, or start your own.');
      // the 6-digit code row unfolds directly beneath the PICKED passcode invite,
      // so with several invites it's never ambiguous which family it belongs to
      const list = _obInvites.map(function (inv, i) {
        return _obInviteCard(inv, i, i === _obSel) + (i === _obSel && !inv.card_only ? _obCodeBlock() : '');
      }).join('');
      body.innerHTML =
        '<div class="ob-lab">' + (_obInvites.length > 1 ? L('Lời mời cho bạn', 'Your invites') : L('Lời mời cho bạn', 'Your invite')) + '</div>'
        + '<div id="ob-invite-list" role="radiogroup">' + list + '</div>'
        + '<div class="ob-or"><span>' + L('hoặc', 'or') + '</span></div>'
        + '<button type="button" class="ob-ghost-btn" onclick="obShowCreate()">' + L('Tạo gia đình mới', 'Create a new family') + '</button>';
      cta.textContent = L('Tham gia', 'Join family');
      if (hint) hint.textContent = (!sel.card_only && sel.passcode_set === false)
        ? L('Gia đình này chưa đặt mã. Nhờ chủ gia đình đặt mã trước.', 'This family has no passcode yet. Ask the owner to set one first.')
        : '';
      if (!sel.card_only) { if (window.renderCodeBoxes) window.renderCodeBoxes(''); setTimeout(function () { const c = _g('ob-code'); if (c) c.focus(); }, 80); }
    }
    const back = _g('ob-start-back'); if (back) back.style.visibility = (window.__obFromPicker || window.__obFromApp) ? 'visible' : 'hidden';
  };

  window.obSelInvite = function (i) {
    if (i < 0 || i >= _obInvites.length) return;
    _obSel = i; _fhJoinCtx = _obInvites[i] || null;
    if (window.obBuzz) window.obBuzz(6);
    window.obRenderStart();
  };
  window.obShowCreate = function () { _obMode = 'create'; window.obRenderStart(); setTimeout(function () { const f = _g('ob-famname'); if (f) f.focus(); }, 80); };
  window.obShowInvites = function () { if (!_obInvites.length) return; _obMode = 'invite'; window.obRenderStart(); };
  // The single footer CTA dispatches by mode.
  window.obPrimary = function () { if (_obMode === 'create') { if (window.obCreateFamily) window.obCreateFamily(); } else { window.obJoin(); } };

  window.obJoinPrep = async function () {
    const hint = _g('ob-join-hint');
    _obChecking = true;
    if (_obMode !== 'invite') _obMode = 'create';     // paint something immediately (no blank flash) while the lookup runs
    window.obRenderStart();
    try { const s = (await sb.auth.getSession()).data.session; _obEmail = (s && s.user && s.user.email) || ''; } catch (e) {}
    let invs = null;
    try { invs = await _rpc('find_my_invites'); }
    catch (e) {
      // plural RPC not on this DB yet (older deploy) → fall back to the singular one
      try { const one = await _rpc('find_my_invite'); invs = one ? [one] : []; }
      catch (e2) {
        _obChecking = false; _obInvites = []; _obMode = 'create'; window.obRenderStart();
        if (hint) hint.innerHTML = _esc(_friendly(e2)) + ' <button class="ob-hint-link" onclick="obJoinPrep()">' + L('Thử lại', 'Try again') + '</button>';
        return;
      }
    }
    _obChecking = false;
    _obInvites = Array.isArray(invs) ? invs : (invs ? [invs] : []);
    /* Friend/trip SPACE invites (0106b exposes family_type) do not belong to
       this door — joining one must never run family onboarding or move the
       active-family slot. They surface on the Tài Chính tab's Nợ & cho vay
       section instead (23-debts-ui). Absent field (older deploy) = family. */
    _obInvites = _obInvites.filter(function (inv) { return (inv.family_type || 'family') === 'family'; });
    _obSel = 0;
    _obMode = _obInvites.length ? 'invite' : 'create';
    _fhJoinCtx = _obInvites.length ? _obInvites[0] : null;
    window.obRenderStart();
  };

  // digits-only passcode entry (replaces the 6-char alphanumeric mock)
  window.obCodeInput = function (el) {
    el.value = el.value.replace(/\D/g, '').slice(0, 6);
    if (typeof window.renderCodeBoxes === 'function') window.renderCodeBoxes(el.value);
    if (typeof window.fhClearInvalid === 'function') window.fhClearInvalid('ob-code-boxes');   // Join stays enabled; obJoin() gates on tap (DESIGN §4.4)
  };

  // A stale JWT (its user/profile was deleted server-side, e.g. after a test-user
  // reset, but the browser kept the session) surfaces as an auth/foreign-key error
  // no message-mapping can "fix" — the only cure is to sign out and back in. Detect
  // it and recover instead of showing the opaque "something went wrong".
  function _obStaleSession(raw) {
    return /members_user_id_fkey|violates foreign key|not authenticated|profiles?_id_fkey|invalid claim|jwt|stale_session|user.*not.*found/i.test(raw || '');
  }
  function _obRecoverStale() {
    window.toast && window.toast(L('Phiên đăng nhập không còn hợp lệ. Đang đưa bạn về đăng nhập lại…', 'Your sign-in is no longer valid. Taking you back to sign in…'));
    setTimeout(function () { if (window.fhSignOut) window.fhSignOut(); }, 1700);
  }

  // Joiner identity comes from the Google account (the profile step was retired):
  // seed the single "you" member with the Google name + auto color, then finish —
  // finishOnboarding runs joinFinalizeDB and lands on Home. Budget and theme are
  // Settings' job now.
  function _obJoinFinish() {
    if (window.obEnsureUserIdentity) window.obEnsureUserIdentity();
    const u = (window.FAM && window.FAM.user) || {};
    if (window.FAM) window.FAM.members = [{ name: u.name || '', email: u.email || '', color: u.color, me: true }];
    window.finishOnboarding();
  }

  window.obJoin = async function () {
    if (!_fhJoinCtx) { try { await window.obJoinPrep(); } catch (e) {} }
    const cta = _g('ob-primary-cta'), hint = _g('ob-join-hint');
    const label = cta ? cta.textContent : '';
    const busy = (on) => { if (cta) { cta.disabled = on; cta.textContent = on ? L('Đang tham gia…', 'Joining…') : label; } };
    // ── Card family: no code. Whitelist + Google SSO is the door; the card
    //    (to read data) comes separately and unlocks after joining. ──
    if (_fhJoinCtx && _fhJoinCtx.card_only) {
      busy(true);
      try {
        const data = await _rpc('join_with_whitelist', { p_family_id: _fhJoinCtx.family_id });
        if (window.DB) { window.DB.fid = data.family_id; window.DB.enc = null; window.DB.keyWraps = []; }
        if (window.FAM) { window.FAM.mode = 'join'; window.FAM.joinFamilyId = data.family_id; window.FAM.familyName = data.family_name || ''; window.FAM.joinEncState = data.enc_state || 'off'; }
      } catch (e) {
        const raw = String((e && e.message) || '');
        if (_obStaleSession(raw)) { busy(false); _obRecoverStale(); return; }
        let msg;
        if (/not_whitelisted|no rows/i.test(raw)) msg = null;
        else if (/invite_expired/i.test(raw)) msg = L('Lời mời đã hết hạn. Nhờ chủ gia đình mời lại.', 'The invite expired. Ask the owner to re-add you.');
        else if (/passcode_required/i.test(raw)) msg = L('Gia đình này dùng mã 6 số. Nhập mã để vào nhé.', 'This family uses a 6-digit code. Enter it to join.');
        else msg = _friendly(e);
        if (msg) { window.toast && window.toast(msg); if (hint) hint.textContent = msg; } else await window.obJoinPrep();
        busy(false);
        return;
      }
      busy(false);
      _obJoinFinish();
      return;
    }
    const el = _g('ob-code');
    const code = (el ? el.value : '').trim();
    if (!/^\d{6}$/.test(code)) {
      if (typeof window.fhFlagField === 'function') window.fhFlagField(_g('ob-code-boxes'));
      if (el) el.focus();
      window.toast && window.toast(L('Nhập đủ 6 chữ số', 'Enter all 6 digits'));
      return;
    }
    busy(true);
    try {
      if (!_fhJoinCtx) await window.obJoinPrep();
      if (!_fhJoinCtx) throw new Error('not_whitelisted');
      if (!_fhJoinCtx.passcode_set) throw new Error('no_passcode');
      const keys = await FHCrypto.deriveKeys(code, _fhJoinCtx.kdf_salt, _fhJoinCtx.kdf_iters, _fhJoinCtx.kdf_version);
      const data = _fhThrowPcError(await _rpc('join_with_passcode', { p_family_id: _fhJoinCtx.family_id, p_k_auth: keys.kAuthHex }));
      const dekRaw = await FHCrypto.unwrapDek(data.wrapped_dek, keys.kWrap);
      await fhKeyAdopt(data.family_id, dekRaw);
      try { _rpc('mark_key_unlocked'); } catch (e) {}         // joiner's device holds the key now
      if (window.DB) {
        window.DB.fid = data.family_id;
        window.DB.enc = { enc_state: data.enc_state, kdf_salt: data.kdf_salt, kdf_iters: data.kdf_iters, kdf_version: data.kdf_version, wrapped_dek: data.wrapped_dek };
      }
      if (window.FAM) { window.FAM.mode = 'join'; window.FAM.joinFamilyId = data.family_id; window.FAM.familyName = data.family_name || ''; window.FAM.joinEncState = data.enc_state || 'off'; }
    } catch (e) {
      const raw = String((e && e.message) || '');
      if (_obStaleSession(raw)) { busy(false); _obRecoverStale(); return; }
      let msg;
      if (/not_whitelisted|no rows/i.test(raw)) msg = null;                       // hint already explains, refresh it
      else if (/wrong_passcode/i.test(raw)) msg = L('Mã không đúng. Kiểm tra với chủ gia đình nhé.', 'That code isn’t right. Double-check with the owner.');
      else if (/locked_out/i.test(raw)) msg = _fhLockedMsg(e.retrySecs);
      else if (/invite_expired/i.test(raw)) msg = L('Lời mời đã hết hạn. Nhờ chủ gia đình mời lại.', 'The invite expired. Ask the owner to re-add you.');
      else if (/no_passcode/i.test(raw)) msg = L('Gia đình chưa đặt mã. Nhờ chủ gia đình đặt mã trước.', 'The family has no passcode yet. Ask the owner to set one.');
      else msg = _friendly(e);
      if (msg) { window.toast && window.toast(msg); if (hint) hint.textContent = msg; }
      else await window.obJoinPrep();
      busy(false);
      return;
    }
    busy(false);
    _obJoinFinish();
  };

  // entering the family screen loads the pending invite (wraps the js-ui obGo)
  (function () {
    const _origObGo = window.obGo;
    if (typeof _origObGo === 'function') window.obGo = function (name) {
      _origObGo.apply(this, arguments);
      if (name === 'start') { try { window.obJoinPrep(); } catch (e) {} }
    };
  })();

  // ── Owner: invite sheet = passcode + whitelist ──
  window.fhInvite = async function () {
    if (!window.DB.fid) { window.toast && window.toast(L('Hãy mở một gia đình trước', 'Open a family first')); return; }
    if (!window.DB.enc) { window.fhSetPasscode(); return; }        // no passcode yet → create it first
    let list;
    try { list = await _rpc('whitelist_list'); }
    catch (e) { window.toast && window.toast(_friendly(e)); return; }
    _fhWhitelistSheet(list || []);
  };

  function _fhWhitelistSheet(list) {
    const days = (iso) => Math.max(1, Math.ceil((new Date(iso) - Date.now()) / 86400000));
    const rows = (list || []).map((r) =>
      '<div class="fh-s-row">'
      + '<div class="fh-s-grow"><div class="fh-s-name">' + _esc(r.email) + '</div>'
      + '<div class="fh-s-meta">' + L('còn ' + days(r.expires_at) + ' ngày', 'expires in ' + days(r.expires_at) + ' days') + '</div></div>'
      + _btn(_ICO.trash, "fhWhitelistRemove('" + _esc(r.email) + "',this)", 'fh-s-act danger')
      + '</div>').join('');
    _fhSheet(
      '<div class="fh-s-h">' + L('Mời thành viên', 'Invite a member') + '</div>'
      + '<div class="fh-s-sub">' + L('Hai bước: thêm email Google của người thân vào danh sách, rồi cho họ biết mã 6 số của gia đình. Họ phải đăng nhập đúng email này.',
                                     'Two steps: add their Google email to the list, then tell them the family’s 6-digit code. They must sign in with exactly this email.') + '</div>'
      + '<div class="field"><label>Email</label>'
      + '<input id="fh-wl-email" type="email" inputmode="email" autocapitalize="off" placeholder="name@gmail.com"></div>'
      + _btn(L('Thêm vào danh sách', 'Add to the list'), 'fhWhitelistAdd(this)', _S.cta)
      + (rows ? '<div class="fh-s-lab" style="margin-top:18px">' + L('Đang chờ tham gia', 'Waiting to join') + '</div>' + rows : '')
      + '<div class="fh-s-lab" style="margin-top:18px">' + L('Mã gia đình', 'Family passcode') + '</div>'
      + '<div class="fh-s-row"><div class="fh-s-grow"><div class="fh-s-name num">••••••</div>'
      + '<div class="fh-s-meta">' + L('Chỉ gia đình bạn biết mã này. Hệ thống không lưu mã gốc', 'Only your family knows it. The raw code is never stored') + '</div></div>'
      + _btn(L('Đổi mã', 'Change'), 'fhChangePasscode()', 'fh-s-edit') + '</div>'
      + _btn(L('Xong', 'Done'), '_closeOv()', _S.ghost)
    );
  }

  window.fhWhitelistAdd = async function (btn) {
    const el = document.getElementById('fh-wl-email');
    const email = ((el && el.value) || '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { window.toast && window.toast(L('Email chưa đúng', 'That email doesn’t look right')); return; }
    if (btn) { btn.disabled = true; btn.textContent = L('Đang thêm…', 'Adding…'); }
    let list;
    try { list = await _rpc('whitelist_add', { p_email: email }); }
    catch (e) {
      if (btn) { btn.disabled = false; btn.textContent = L('Thêm vào danh sách', 'Add to the list'); }
      const raw = String((e && e.message) || '');
      window.toast && window.toast(
        /already_member/i.test(raw) ? L('Người này đã ở trong gia đình rồi', 'They’re already in the family')
        : /no_passcode/i.test(raw) ? L('Hãy đặt mã gia đình trước', 'Set the family passcode first')
        : /bad_email/i.test(raw) ? L('Email chưa đúng', 'That email doesn’t look right')
        : _friendly(e));
      return;
    }
    window.toast && window.toast(L('Đã thêm. Giờ cho họ biết mã 6 số nhé.', 'Added. Now tell them the 6-digit code.'));
    _fhWhitelistSheet(list || []);
  };

  window.fhWhitelistRemove = async function (email, btn) {
    if (btn && !btn.classList.contains('armed')) {
      btn.classList.add('armed'); btn.textContent = L('Xoá?', 'Remove?');
      clearTimeout(window._fhWlArmT);
      window._fhWlArmT = setTimeout(() => {
        if (!btn.isConnected) return;
        btn.classList.remove('armed'); btn.innerHTML = _ICO.trash;
      }, 3000);
      return;
    }
    clearTimeout(window._fhWlArmT);
    let list;
    try { list = await _rpc('whitelist_remove', { p_email: email }); }
    catch (e) { window.toast && window.toast(_friendly(e)); return; }
    _fhWhitelistSheet(list || []);
  };

  // ── Owner: first-time passcode setup (creates the family DEK) ──
  window.fhSetPasscode = function () {
    _fhModal({
      title: L('Đặt mã gia đình', 'Set the family passcode'),
      saveLabel: L('Đặt mã', 'Set code'),
      body: '<div class="fh-s-sub">' + L('Mã 6 số để người thân vào gia đình, như mã cửa nhà mình. Cả nhà dùng chung một mã.',
                                          'A 6-digit code your family uses to enter, like the door code of your house. Everyone shares the same code.') + '</div>'
        + _pcField('fh-pc-new', L('Mã 6 số', '6-digit code'))
        + _pcField('fh-pc-new2', L('Nhập lại mã', 'Repeat the code'))
        + _pcWarn(),
      required: () => {
        const full = _pcOk('fh-pc-new');
        return [
          { el: 'fh-pc-new', ok: full },
          { el: 'fh-pc-new2', ok: full && _pcVal('fh-pc-new') === _pcVal('fh-pc-new2') }
        ];
      },
      reqMsg: L('Nhập mã 6 số, giống nhau ở cả hai ô', 'Enter a 6-digit code, the same in both boxes'),
      save: async () => {
        const code = _pcVal('fh-pc-new');
        const salt = FHCrypto.genSaltHex();
        const keys = await FHCrypto.deriveKeys(code, salt, FH_KDF_ITERS, FH_KDF_VERSION);
        const dekRaw = await FHCrypto.genDekRaw();
        const wrapped = await FHCrypto.wrapDek(dekRaw, keys.kWrap);
        await _rpc('set_family_passcode', { p_k_auth: keys.kAuthHex, p_kdf_salt: salt, p_kdf_iters: FH_KDF_ITERS, p_kdf_version: FH_KDF_VERSION, p_wrapped_dek: wrapped });
        await fhKeyAdopt(window.DB.fid, dekRaw);
        window.DB.enc = { enc_state: 'off', kdf_salt: salt, kdf_iters: FH_KDF_ITERS, kdf_version: FH_KDF_VERSION, wrapped_dek: wrapped };
        window.toast && window.toast(L('Đã đặt mã gia đình ✓', 'Family passcode set ✓'));
        return window.fhInvite;                       // straight into the whitelist sheet
      }
    });
  };

  // ── Owner: change passcode (same DEK, new wrap — instant, nothing re-encrypts) ──
  window.fhChangePasscode = function () {
    _fhModal({
      title: L('Đổi mã gia đình', 'Change the passcode'),
      saveLabel: L('Đổi mã', 'Change'),
      body: _pcField('fh-pc-old', L('Mã hiện tại', 'Current code'))
        + _pcField('fh-pc-new', L('Mã mới', 'New code'))
        + _pcField('fh-pc-new2', L('Nhập lại mã mới', 'Repeat the new code'))
        + '<div class="field-hint">' + L('Thành viên đang dùng app không bị ảnh hưởng, chỉ người vào sau cần mã mới.',
                                          'Members already in the app aren’t affected. Only future joins need the new code.') + '</div>'
        + _pcWarn(),
      required: () => {
        const nn = _pcOk('fh-pc-new');
        return [
          { el: 'fh-pc-old', ok: _pcOk('fh-pc-old') },
          { el: 'fh-pc-new', ok: nn },
          { el: 'fh-pc-new2', ok: nn && _pcVal('fh-pc-new') === _pcVal('fh-pc-new2') }
        ];
      },
      reqMsg: L('Nhập mã hiện tại và mã mới 6 số (giống nhau ở cả hai ô)', 'Enter the current code and a matching 6-digit new code'),
      save: async () => {
        const enc = window.DB.enc; if (!enc) throw new Error('no_passcode');
        const oldK = await FHCrypto.deriveKeys(_pcVal('fh-pc-old'), enc.kdf_salt, enc.kdf_iters, enc.kdf_version);
        // recover the DEK: cached raw if we have it, else unwrap with the old code
        let dekRaw = (fhKeyReady() && _fhDekRaw) ? _fhDekRaw : null;
        if (!dekRaw) {
          try { dekRaw = await FHCrypto.unwrapDek(enc.wrapped_dek, oldK.kWrap); }
          catch (e) { throw _fhErr(L('Mã hiện tại không đúng', 'The current code isn’t right')); }
        }
        const salt = FHCrypto.genSaltHex();
        const newK = await FHCrypto.deriveKeys(_pcVal('fh-pc-new'), salt, FH_KDF_ITERS, FH_KDF_VERSION);
        const wrapped = await FHCrypto.wrapDek(dekRaw, newK.kWrap);
        try {
          _fhThrowPcError(await _rpc('change_family_passcode', { p_old_k_auth: oldK.kAuthHex, p_new_k_auth: newK.kAuthHex, p_new_kdf_salt: salt, p_new_kdf_iters: FH_KDF_ITERS, p_new_kdf_version: FH_KDF_VERSION, p_new_wrapped_dek: wrapped }));
        } catch (e) {
          const raw = String((e && e.message) || '');
          if (/wrong_passcode/i.test(raw)) throw _fhErr(L('Mã hiện tại không đúng', 'The current code isn’t right'));
          if (/locked_out/i.test(raw)) throw _fhErr(_fhLockedMsg(e.retrySecs));
          throw e;
        }
        await fhKeyAdopt(window.DB.fid, dekRaw);
        window.DB.enc = Object.assign({}, enc, { kdf_salt: salt, kdf_iters: FH_KDF_ITERS, kdf_version: FH_KDF_VERSION, wrapped_dek: wrapped });
        window.toast && window.toast(L('Đã đổi mã gia đình ✓', 'Passcode changed ✓'));
      }
    });
  };

  // ── Any member: unlock this device with the passcode (offline-capable —
  //    a wrong code simply fails the AES-GCM unwrap, no server needed) ──
  window.fhUnlockPrompt = function () {
    // Card families unlock with the card; passcode families with the code. This
    // routes every caller (lock bar, write-lock, nudge). During the dual-wrap
    // window the card prompt itself links to the code as a fallback.
    if (window.fhHasCard && window.fhHasCard() && window.fhCardEnterPrompt) { return window.fhCardEnterPrompt(); }
    return window.fhPasscodeUnlockPrompt();
  };
  /* Reusable 6-digit unlock (offline AES-GCM unwrap — no server, no throttle).
     Adopts the DEK on success; throws a friendly _fhErr on a wrong code. Shared
     by the passcode sheet and the fullscreen lock wall. */
  window.fhPasscodeUnlock = async function (code) {
    const enc = window.DB && window.DB.enc;
    if (!enc || !enc.wrapped_dek) throw _fhErr(L('Gia đình chưa đặt mã', 'No passcode set yet'));
    const keys = await FHCrypto.deriveKeys(code, enc.kdf_salt, enc.kdf_iters, enc.kdf_version);
    let dekRaw;
    try { dekRaw = await FHCrypto.unwrapDek(enc.wrapped_dek, keys.kWrap); }
    catch (e) { throw _fhErr(L('Mã không đúng', 'That code isn’t right')); }
    await fhKeyAdopt(window.DB.fid, dekRaw);
    try { _rpc('mark_key_unlocked'); } catch (e) {}          // roster stamp, fire-and-forget
    return true;
  };

  /* Shared post-unlock teardown for BOTH paths (card or passcode, sheet or wall):
     drop every lock affordance (banner + wall), flush money rows held for the
     key, refresh, then let a fresh key retire tolerated plaintext. */
  window.fhAfterUnlock = function () {
    window.fhLockBanner && window.fhLockBanner(false);
    if (window.fhLockWallClose) window.fhLockWallClose();
    if (window.fhOutboxFlush) setTimeout(() => window.fhOutboxFlush(), 400);
    if (window.loadFamilyData) window.loadFamilyData();
    setTimeout(() => { try { window.fhEncCoverSweep && window.fhEncCoverSweep(); } catch (e) {} }, 2500);
  };

  // The 6-digit passcode unlock sheet — kept for reference/back-compat; the
  // fullscreen wall is now the primary surface (fhUnlockPrompt → fhLockWall).
  window.fhPasscodeUnlockPrompt = function () {
    const enc = window.DB && window.DB.enc;
    if (!enc || !enc.wrapped_dek) { window.toast && window.toast(L('Gia đình chưa đặt mã', 'No passcode set yet')); return; }
    const why = enc.enc_state === 'dual'
      ? L('Gia đình đang bật mã hóa tài chính. Nhập mã 6 số một lần để tiếp tục ghi chép trên máy này.',
          'Your family is turning on money encryption. Enter the 6-digit code once to keep logging on this device.')
      : L('Thiết bị này cần mã 6 số của gia đình để hiện số tiền và ghi chép.',
          'This device needs the family’s 6-digit code to show amounts and log entries.');
    _fhModal({
      title: L('Nhập mã gia đình', 'Enter the family passcode'),
      saveLabel: L('Mở khóa', 'Unlock'),
      body: '<div class="fh-s-sub">' + why + '</div>'
        + _pcField('fh-pc-unlock', L('Mã 6 số', '6-digit code')),
      required: () => [{ el: 'fh-pc-unlock', ok: _pcOk('fh-pc-unlock') }],
      reqMsg: L('Nhập mã 6 số', 'Enter the 6-digit code'),
      save: async () => {
        await window.fhPasscodeUnlock(_pcVal('fh-pc-unlock'));
        window.toast && window.toast(L('Đã mở khóa ✓', 'Unlocked ✓'));
        window.fhAfterUnlock();
      }
    });
  };

  /* Permanent lock widget — lives in #phone so it rides above EVERY screen and
     tab until this device holds the key; tapping it opens the passcode prompt.
     It never auto-hides: only a successful unlock (or encryption turning off)
     removes it. Styled to the design system, not ad hoc: brand gradient pill
     (CTA anatomy), floating shadow with the theme's brand glow, inline-SVG
     icon (emoji are content marks, never control icons — DESIGN §2.6), the
     shared `rise` entrance and the standard press scale (§2.5). */
  window.fhLockBanner = function (on, state) {
    let el = document.getElementById('fh-lockbar');
    if (on) {
      if (!document.getElementById('fh-lockbar-css')) {
        const st = document.createElement('style'); st.id = 'fh-lockbar-css';
        st.textContent = '#fh-lockbar:active{transform:scale(.97)}';
        document.head.appendChild(st);
      }
      if (!el) {
        el = document.createElement('button'); el.id = 'fh-lockbar';
        el.style.cssText = 'position:absolute;left:16px;right:16px;margin:0 auto;bottom:calc(80px + env(safe-area-inset-bottom));z-index:64;width:max-content;max-width:calc(100% - 32px);background:var(--grad-brand,var(--brand));color:#fff;border:none;box-shadow:0 8px 22px rgba(25,16,34,.14),0 12px 28px var(--brand-glow);border-radius:9999px;padding:14px 20px;font-size:14px;font-weight:700;font-family:inherit;display:flex;gap:9px;align-items:center;cursor:pointer;text-align:left;animation:rise .4s cubic-bezier(.32,.72,0,1);transition:transform .15s cubic-bezier(.4,0,.2,1)';
        el.onclick = () => window.fhUnlockPrompt();
        (document.getElementById('phone') || document.body).appendChild(el);
      }
      el.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" style="flex:none"><rect x="5" y="10.5" width="14" height="9.5" rx="2.6"/><path d="M8 10.5V7.8a4 4 0 018 0v2.7"/></svg><span>' + (state === 'dual'
        ? L('Gia đình đang bật mã hóa, chạm để nhập mã 6 số', 'Your family is turning on encryption. Tap to enter the 6-digit code')
        : L('Chạm để nhập mã gia đình và mở số tiền', 'Tap to enter the family code and unlock amounts')) + '</span>';
      el.style.display = 'flex';
    } else if (el) el.style.display = 'none';
  };
