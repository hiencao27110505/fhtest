  /* ═══ Member avatars (0052) ══════════════════════════════════════════════════
     A member photo is imported ONCE from the Google account (best-effort) or
     uploaded in Settings → My profile, then stored as an AES-GCM '.enc' object
     through the shared photo pipeline (fhUploadEncImage). members.avatar_url
     holds the storage PATH; hydrate turns it into membersMeta.av (the decrypt
     URL the render observer swaps). For an encrypted family the FACE is E2EE —
     the server never sees the pixels or a plaintext googleusercontent URL. */

  // Encrypt+upload a data-URL image and point a member row at it. memberId
  // defaults to the current user's own member. Re-hydrates so the new avatar
  // appears everywhere. Returns true on success.
  // opts.silent: suppress all user-facing toasts/prompts (for the best-effort
  // Google auto-seed, which is invisible and must never nag on a failure).
  window.fhAvatarSet = async function (memberId, dataUrl, opts) {
    opts = opts || {};
    const id = memberId || (window.DB && window.DB.ownerMemberId);
    if (!id) { if (!opts.silent) window.toast && window.toast(L('Không tìm thấy hồ sơ', 'Profile not found')); return false; }
    if (!window.fhUploadEncImage || !dataUrl) return false;
    // In an encrypting family the face must be encrypted → refuse when this
    // device has no key, and raise the unlock wall, rather than storing a
    // plaintext photo in the public bucket.
    if (window.fhEncState && window.fhEncState() !== 'off' && !(window.fhKeyReady && window.fhKeyReady())) {
      if (!opts.silent) { window.toast && window.toast(L('Mở khóa để đổi ảnh', 'Unlock to change the photo')); window.fhLockWall && window.fhLockWall(); }
      return false;
    }
    const path = await window.fhUploadEncImage(dataUrl);
    if (!path) { if (!opts.silent) window.toast && window.toast(L('Chưa lưu được ảnh, thử lại', 'Couldn’t save the photo, try again')); return false; }
    try { await _rpc('update_member', { p_member_id: id, p_avatar_url: path }); }
    catch (e) { if (!opts.silent) window.toast && window.toast(_friendly(e)); return false; }
    if (window.loadFamilyData) await window.loadFamilyData();
    return true;
  };

  window.fhAvatarRemove = async function (memberId) {
    const id = memberId || (window.DB && window.DB.ownerMemberId);
    if (!id) return false;
    try { await _rpc('update_member', { p_member_id: id, p_avatar_url: '' }); }   // '' = clear
    catch (e) { window.toast && window.toast(_friendly(e)); return false; }
    if (window.loadFamilyData) await window.loadFamilyData();
    return true;
  };

  // The current user's Google photo URL, normalized to a reasonable size.
  function _googlePic() {
    try {
      const md = (window.fhUser && window.fhUser.user_metadata) || {};
      let u = md.avatar_url || md.picture || '';
      if (!u) return '';
      u = u.replace(/=s\d+(-c)?$/, '');                 // strip any existing size hint
      return u + (u.indexOf('=') < 0 ? '=s256-c' : '');
    } catch (e) { return ''; }
  }

  // Fetch a Google image → data URL. Returns null on CORS/network failure (the
  // manual uploader is always available as the reliable path).
  async function _fetchAsDataUrl(url) {
    try {
      const resp = await fetch(url, { mode: 'cors', credentials: 'omit' });
      if (!resp || !resp.ok) return null;
      const blob = await resp.blob();
      return await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(blob); });
    } catch (e) { return null; }
  }

  // Best-effort one-time seed of my avatar from my Google photo, on first keyed
  // hydrate when I have no photo yet. Silent on any failure.
  window.fhAvatarSeedFromGoogle = async function () {
    try {
      if (window.__fhAvatarSeeded) return;                                   // already attempted this session
      // An encrypting family needs the DEK to encrypt the face; a plaintext
      // ('off') family seeds fine via the plaintext upload path. Don't burn the
      // once-guard while still locked, or the post-unlock re-run would skip.
      if (window.fhEncState && window.fhEncState() !== 'off' && !(window.fhKeyReady && window.fhKeyReady())) return;
      const id = window.DB && window.DB.ownerMemberId; if (!id) return;
      const me = window.DB.memberById && window.DB.memberById[id];
      if (!me || me.avatar_url) return;                                      // already has a photo
      const url = _googlePic(); if (!url) return;
      window.__fhAvatarSeeded = 1;                                           // eligible → burn the once-guard before the await
      const dataUrl = await _fetchAsDataUrl(url);
      if (dataUrl && String(dataUrl).indexOf('data:image') === 0) await window.fhAvatarSet(id, dataUrl, { silent: true });
    } catch (e) {}
  };

  /* ── Settings → My profile pickers (wired into fhEditMember's avatar row) ── */

  // Upload a photo from the device for this member.
  window.fhAvatarPickFor = function (id) {
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = 'image/*'; inp.style.display = 'none';
    inp.onchange = async () => {
      const f = inp.files && inp.files[0]; try { inp.remove(); } catch (e) {}
      if (!f) return;
      const dataUrl = await new Promise((res) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => res(null); r.readAsDataURL(f); });
      if (!dataUrl) return;
      window.toast && window.toast(L('Đang lưu ảnh…', 'Saving photo…'));
      if (window._closeOv) window._closeOv();
      const ok = await window.fhAvatarSet(id, dataUrl);
      if (ok) window.toast && window.toast(L('Đã cập nhật ảnh ✓', 'Photo updated ✓'));
    };
    (document.body || document.documentElement).appendChild(inp); inp.click();
  };

  // Re-pull the current user's Google photo (self only).
  window.fhAvatarFromGoogle = async function (id) {
    const url = _googlePic();
    if (!url) { window.toast && window.toast(L('Không có ảnh Google', 'No Google photo on this account')); return; }
    window.toast && window.toast(L('Đang lấy ảnh Google…', 'Fetching your Google photo…'));
    const dataUrl = await _fetchAsDataUrl(url);
    if (!dataUrl) { window.toast && window.toast(L('Không lấy được ảnh Google, hãy tải ảnh lên', 'Couldn’t fetch the Google photo — upload one instead')); return; }
    if (window._closeOv) window._closeOv();
    const ok = await window.fhAvatarSet(id, dataUrl);
    if (ok) window.toast && window.toast(L('Đã cập nhật ảnh ✓', 'Photo updated ✓'));
  };

  window.fhAvatarClear = async function (id) {
    if (window._closeOv) window._closeOv();
    const ok = await window.fhAvatarRemove(id);
    if (ok) window.toast && window.toast(L('Đã gỡ ảnh', 'Photo removed'));
  };

  // True when the account has a Google photo we could offer (self editor only).
  window.fhHasGooglePic = function () { return !!_googlePic(); };
