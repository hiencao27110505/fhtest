  /* ═══ Spaces ("Nhóm") — the data side (docs/specs/spaces-spec.md) ═══════════
     A space is any shared container: a family, a group of friends, anything
     else. They differ by a PROFILE of switches (15-spaces-core.js), not by kind.

     Two ways a space is read, and both are live at once:
       · the ACTIVE one runs the whole family stack (profiles.family_id →
         get_family_snapshot, realtime, the session DEK). Any space the person
         belongs to can be made active: fhSpaceOpen → switch_family.
       · every OTHER space with Chia tiền on is read on the light path below, by
         explicit id, so Tài chính can show what is owed without switching and
         review can file a captured row into it.

     Crypto: one DEK per space, enc-from-birth (init_space_card), kept in the same
     fh-keys IDB store the family and personal keys use (keyPath 'fid'), which is
     also where the family path looks when the space becomes active. Ciphertext
     on the light path MUST go through S.keys[fid], never fhEncStr/fhDecStr: those
     are bound to the ACTIVE container's DEK.

     Balances are DERIVED, never stored:
       my net = Σ paid(by me) − Σ my share + Σ settles I sent − Σ settles I got
     Everyone computes the same number from the same shared rows. Settle-ups
     are one person's word. */
  (function () {
    const S = { uid: null, all: [], list: [], keys: {}, data: {}, state: 'boot' };
    window.fhSpacesData = function () { return S; };
    const _sb = () => window.sb;
    const _localDate = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');

    /* fh-keys IDB — same store the personal module uses; own handles because
       that module's helpers are IIFE-private. */
    function _kOpen() {
      return new Promise((res, rej) => { let rq; try { rq = indexedDB.open('fh-keys', 1); } catch (e) { return rej(e); }
        rq.onupgradeneeded = () => { const db = rq.result; if (!db.objectStoreNames.contains('k')) db.createObjectStore('k', { keyPath: 'fid' }); };
        rq.onsuccess = () => res(rq.result); rq.onerror = () => rej(rq.error); });
    }
    async function _kPut(id, key) { try { const db = await _kOpen(); await new Promise((res, rej) => { const tx = db.transaction('k', 'readwrite'); tx.objectStore('k').put({ fid: id, key: key, at: Date.now() }); tx.oncomplete = () => res(1); tx.onerror = () => rej(tx.error); }); } catch (e) {} }
    async function _kGet(id) { try { const db = await _kOpen(); return await new Promise((res) => { const tx = db.transaction('k', 'readonly'); const rq = tx.objectStore('k').get(id); rq.onsuccess = () => res(rq.result || null); rq.onerror = () => res(null); }); } catch (e) { return null; } }

    const _enc = (fid, v) => FHCrypto.encVal(S.keys[fid], v);
    const _DEC_FAILED = '\u0000fh-dec-failed';
    const _dec = async (fid, b64) => { if (!b64) return null; try { return await FHCrypto.decVal(S.keys[fid], b64); } catch (e) { return _DEC_FAILED; } };
    const _decTxt = async (fid, b64) => { const v = await _dec(fid, b64); return v === _DEC_FAILED ? null : v; };
    /* A field that is ciphertext in an encrypted space and plaintext in a family
       that never turned encryption on: ciphertext wins when it is there. */
    const _either = async (fid, ct, pt) => (ct ? await _dec(fid, ct) : (pt == null ? null : pt));

    // Space card display cached per-space on this device (parity with family/personal)
    const _cardLS = (fid) => 'fh-scard:' + fid;
    window.fhSpaceCardCached = function (fid) { try { return localStorage.getItem(_cardLS(fid)); } catch (e) { return null; } };

    window.fhSpaceKeyReady = function (fid) { return !!S.keys[fid]; };

    /* ── roster ───────────────────────────────────────────────────────────── */
    /* The roster is every container the person belongs to except their own
       ledger. It is cached so a cold start knows the active space's profile
       before the network answers: a friend space must not flash the house. */
    const ROSTER_LS = 'fh-spaces';
    function _rosterSave() { try { localStorage.setItem(ROSTER_LS, JSON.stringify({ uid: S.uid, all: S.all })); } catch (e) {} }
    (function _rosterWarm() {
      try { const c = JSON.parse(localStorage.getItem(ROSTER_LS) || 'null'); if (c && Array.isArray(c.all)) { S.all = c.all; S._warmUid = c.uid || null; } } catch (e) {}
    })();
    function _mapRow(f) {
      /* my_families (0076, widened by the spaces migration) names the id
         `family_id` and the owner flag `is_owner`. The first version of this
         module read `id` and `owner_id`, which that function never returned,
         so every space got an undefined id. */
      const profile = (f.profile && typeof f.profile === 'object') ? f.profile : {};
      return { id: f.family_id || f.id, name: f.name, type: f.type || 'family', isOwner: !!f.is_owner, isActive: !!f.is_active,
        profile: profile, closed: !!f.closed, members: (f.members == null ? null : Number(f.members)) };
    }
    function _setRoster(rows) {
      S.all = (rows || []).filter((f) => f && f.type !== 'personal').map(_mapRow).filter((f) => !!f.id);
      /* the light path: every space that keeps balances. A family with Chia
         tiền off has nothing to show there and is not read. */
      S.list = S.all.filter((sp) => fhSpaceProfileOf(sp.type, sp.profile).split);
      _rosterSave();
    }
    /* afterLogin already called my_families: hand its rows over instead of
       asking again. */
    window.fhSpacesSeed = function (rows, uid) {
      if (uid) S.uid = uid;
      if (S._warmUid && uid && S._warmUid !== uid) { S.keys = {}; S.data = {}; }
      _setRoster(rows);
    };
    window.fhSpaceGet = function (fid) { return S.all.find((x) => x.id === fid) || null; };
    /* The open space: the one the hydrate is on, or, between a switch and its
       hydrate (and on a cold start before DB.fid is known), the one the roster
       says is active. */
    window.fhSpaceActive = function () {
      const fid = window.DB && window.DB.fid;
      return (fid && window.fhSpaceGet(fid)) || S.all.find((x) => x.isActive) || null;
    };
    window.fhSpaceProfile = function (fid) {
      const sp = fid ? window.fhSpaceGet(fid) : window.fhSpaceActive();
      return fhSpaceProfileOf(sp ? sp.type : 'family', sp ? sp.profile : null);
    };

    /* Throttled: persDebtAfterRender calls this from EVERY full renderPersonal
       (81 call sites, every hydrate, every tab tap), and each call was an
       auth.getSession + a my_families round trip. The roster changes when the
       person creates, joins or leaves a space, and those paths pass
       {force:true}; everything else is content with a roster at most 60s old.
       The in-flight latch stays. First call (state not yet ready) always runs. */
    let _booting = false, _bootAt = 0;
    const SPACES_BOOT_EVERY = 60000;
    window.fhSpacesBoot = async function (opts) {
      if (_booting || !_sb()) return;
      const force = !!(opts && opts.force);
      if (!force && S.state === 'ready' && Date.now() - _bootAt < SPACES_BOOT_EVERY) return;
      _booting = true;
      try {
        const sess = await _sb().auth.getSession();
        S.uid = sess.data.session ? sess.data.session.user.id : null;
        if (!S.uid) { S.state = 'error'; return; }
        const r = await _sb().rpc('my_families');
        if (r.error) throw r.error;
        const before = JSON.stringify(S.all);
        _setRoster(Array.isArray(r.data) ? r.data : []);
        for (const sp of S.list) {
          if (!S.keys[sp.id]) { const kc = await _kGet(sp.id); if (kc && kc.key) S.keys[sp.id] = kc.key; }
        }
        S.state = 'ready'; _bootAt = Date.now();
        if (before !== JSON.stringify(S.all)) { try { window.fhSpaceShellApply && window.fhSpaceShellApply(); } catch (e) {} }
        _shareQueueFlush();
      } catch (e) { console.warn('spaces boot failed', e); S.state = 'error'; }
      finally { _booting = false; }
    };

    /* ── create (owner mints DEK + Key Card, server holds only the wrap) ──── */
    /* `profile` is the switches chosen on the create sheet. A server that has
       not had the spaces migration yet does not know the fourth argument; the
       space is still created, with its preset's defaults. */
    window.fhSpaceCreate = async function (name, type, profile) {
      const args = { p_name: name, p_type: type || 'friend', p_idempotency_key: crypto.randomUUID() };
      let r = await _sb().rpc('create_space', profile ? Object.assign({ p_profile: profile }, args) : args);
      if (r.error && profile && /p_profile|function|schema cache/i.test(r.error.message || '')) r = await _sb().rpc('create_space', args);
      if (r.error) { console.warn('create_space failed', r.error); return { ok: false, error: r.error.message }; }
      const fid = r.data;
      const card = FHCrypto.genCard(), salt = FHCrypto.genSaltHex();
      const keys = await FHCrypto.deriveKeys(card.key, salt, window.FH_KDF_ITERS_CARD, 1);
      const dekRaw = await FHCrypto.genDekRaw();
      const wrapped = await FHCrypto.wrapDek(dekRaw, keys.kWrap);
      const cr = await _sb().rpc('init_space_card', { p_family_id: fid, p_kdf_salt: salt, p_kdf_iters: window.FH_KDF_ITERS_CARD, p_kdf_version: 1, p_wrapped_dek: wrapped });
      if (cr.error) { console.warn('init_space_card failed', cr.error); return { ok: false, error: cr.error.message }; }
      S.keys[fid] = await FHCrypto.importDek(dekRaw);
      await _kPut(fid, S.keys[fid]);
      try { localStorage.setItem(_cardLS(fid), card.display); } catch (e) {}
      await window.fhSpacesBoot({ force: true });   // the roster just changed
      return { ok: true, fid: fid, card: card };
    };

    /* Owner only: rename, or change the switches. */
    window.fhSpaceUpdate = async function (fid, name, profile) {
      const r = await _sb().rpc('space_update', { p_family_id: fid, p_name: name || null, p_profile: profile || null });
      if (r.error) return { ok: false, error: r.error.message };
      await window.fhSpacesBoot({ force: true });
      return { ok: true };
    };

    /* ── join-side unlock: enter the space's Key Card, unwrap its DEK ─────── */
    window.fhSpaceUnlock = async function (fid, cardInput) {
      let p = FHCrypto.parseCard(cardInput);
      if (!p.ok && /#|fh-k=|https?:/i.test(String(cardInput || ''))) { const f = FHCrypto.parseKeyFragment(cardInput); if (f && f.ok) p = f; }
      if (!p.ok) return { ok: false, error: p.error };
      const wr = await _sb().from('family_key_wraps').select('kdf_salt,kdf_iters,kdf_version,wrapped_dek').eq('family_id', fid).eq('kind', 'card').maybeSingle();
      if (wr.error || !wr.data) return { ok: false, error: 'no_wrap' };
      try {
        const keys = await FHCrypto.deriveKeys(p.key, wr.data.kdf_salt, wr.data.kdf_iters, wr.data.kdf_version);
        const raw = await FHCrypto.unwrapDek(wr.data.wrapped_dek, keys.kWrap);
        S.keys[fid] = await FHCrypto.importDek(raw);
        await _kPut(fid, S.keys[fid]);
        try { localStorage.setItem(_cardLS(fid), p.display); } catch (e) {}
        return { ok: true };
      } catch (e) { return { ok: false, error: 'wrong_card' }; }
    };

    window.fhSpaceInvite = async function (fid, email) {
      const r = await _sb().rpc('space_whitelist_add', { p_family_id: fid, p_email: email });
      return r.error ? { ok: false, error: r.error.message } : { ok: true, list: r.data };
    };
    window.fhSpaceInvites = async function (fid) {
      const r = await _sb().rpc('space_whitelist_list', { p_family_id: fid });
      return r.error ? [] : (Array.isArray(r.data) ? r.data : []);
    };
    window.fhSpaceInviteCancel = async function (fid, email) {
      const r = await _sb().rpc('space_whitelist_cancel', { p_family_id: fid, p_email: email });
      return r.error ? { ok: false, error: r.error.message } : { ok: true, list: r.data };
    };
    window.fhSpaceJoin = async function (fid) {   // member row + accepted invite; the active container does not move (0106b)
      const r = await _sb().rpc('join_with_whitelist', { p_family_id: fid });
      return r.error ? { ok: false, error: r.error.message } : { ok: true };
    };
    window.fhSpaceLeave = async function (fid) {
      const r = await _sb().rpc('leave_space', { p_family_id: fid });
      if (!r.error) { delete S.keys[fid]; delete S.data[fid]; await window.fhSpacesBoot({ force: true }); }   // the roster just changed
      return r.error ? { ok: false, error: r.error.message } : { ok: true };
    };
    window.fhSpaceClose = async function (fid, closed) {
      const r = await _sb().rpc('space_close', { p_family_id: fid, p_closed: closed !== false });
      if (!r.error) await window.fhSpacesBoot({ force: true });
      return r.error ? { ok: false, error: r.error.message } : { ok: true };
    };
    window.fhSpaceRemoveMember = async function (fid, memberId) {
      const r = await _sb().rpc('space_remove_member', { p_family_id: fid, p_member_id: memberId });
      if (!r.error) { await window.fhSpacesBoot({ force: true }); if (S.keys[fid]) await window.fhSpaceHydrate(fid); }
      return r.error ? { ok: false, error: r.error.message } : { ok: true };
    };

    /* ── the key reaches the invitee two ways ─────────────────────────────── */
    /* (1) Sealed to their account (spaces-spec section 21): when the owner adds
       an email, this device seals the space's Key Card to that account's public
       key. Their installed app opens it in one tap; nothing is scanned or typed.
       An email with no account yet has no key to seal to; the owner's device
       tries again whenever it lists the invites. */
    window.fhSpaceSealFor = async function (fid, email) {
      const card = window.fhSpaceCardCached(fid);
      if (!card) return { ok: false, error: 'no_card' };            // this device joined without the card text; another owner device has it
      if (!window.nacl) return { ok: false, error: 'no_nacl' };
      const pk = await _sb().rpc('space_invite_pubkey', { p_family_id: fid, p_email: email });
      if (pk.error) return { ok: false, error: /function|schema cache/i.test(pk.error.message || '') ? 'old_server' : pk.error.message };
      if (!pk.data) return { ok: false, error: 'no_account' };
      let sealed;
      try { sealed = fhSpaceSealMake(window.nacl, fid, email, card, pk.data); } catch (e) { return { ok: false, error: 'seal_failed' }; }
      const r = await _sb().rpc('space_invite_seal', { p_family_id: fid, p_email: email, p_sealed: sealed });
      if (r.error) return { ok: false, error: r.error.message };
      return { ok: true, code: fhSpaceKeyCode(pk.data) };
    };
    /* Seal every pending invite of a space I own that has no key yet. Quiet. */
    window.fhSpaceSealPending = async function (fid, list) {
      const sp = window.fhSpaceGet(fid);
      if (!sp || !sp.isOwner || sp.type === 'family' || !window.fhSpaceCardCached(fid)) return 0;
      const rows = list || await window.fhSpaceInvites(fid);
      let n = 0;
      for (const i of rows) { if (i && i.status === 'pending' && !i.sealed) { const r = await window.fhSpaceSealFor(fid, i.email); if (r.ok) n++; else if (r.error === 'old_server') break; } }
      return n;
    };
    /* The invitee's side: open the box with my own private key and unlock. */
    window.fhSpaceUnlockSealed = async function (fid, sealedStr) {
      try {
        if (!window.nacl || !window.fhPersonalStagingPrivKey) return { ok: false, error: 'no_key' };
        let sealed = sealedStr;
        if (!sealed) {
          const r = await _sb().rpc('space_my_sealed_key', { p_family_id: fid });
          if (r.error || !r.data) return { ok: false, error: 'none' };
          sealed = r.data;
        }
        let priv;
        try { priv = await window.fhPersonalStagingPrivKey(); } catch (e) { return { ok: false, error: 'personal_locked' }; }
        const o = fhSpaceSealOpen(window.nacl, sealed, priv, fid);
        for (let i = 0; i < priv.length; i++) priv[i] = 0;
        if (!o.ok) return o;
        return await window.fhSpaceUnlock(fid, o.card);
      } catch (e) { return { ok: false, error: 'failed' }; }
    };
    /* My own confirmation code: what an owner who invited me should see next to
       my email. Null until the personal safe has made its keypair. */
    window.fhSpaceMyKeyCode = async function () {
      try { const r = await _sb().rpc('get_personal_staging_key', {}); return (r.data && r.data.staging_pub) ? fhSpaceKeyCode(r.data.staging_pub) : null; } catch (e) { return null; }
    };

    /* (2) The invite link: the space id, its Key Card and its name in the
       fragment, which never reaches a server. It is what a person with no
       account yet opens, and what gets pasted into an installed app that a link
       cannot open (every iPhone). The owner still adds the invitee's email: the
       whitelist is the access rule, the link only carries the key. */
    window.fhSpaceInviteUrl = function (fid) {
      const disp = window.fhSpaceCardCached(fid); if (!disp) return null;
      const sp = window.fhSpaceGet(fid);
      const k = FHCrypto.cardUrl(disp); const i = k.indexOf('#fh-k=');
      return k.slice(0, i) + '#fh-s=' + fid + '&fh-k=' + k.slice(i + 6) + (sp && sp.name ? '&fh-n=' + encodeURIComponent(String(sp.name).slice(0, 60)) : '');
    };
    /* A pending invite survives the sign-in redirect in sessionStorage (same
       tab only, gone when the tab closes). It used to live in a window variable,
       which the redirect to Google and back wiped: the person signed in and
       nothing happened. */
    const PEND_SS = 'fh-pending-space';
    function _pendSet(p) { window.__fhPendingSpace = p; try { if (p) sessionStorage.setItem(PEND_SS, JSON.stringify(p)); else sessionStorage.removeItem(PEND_SS); } catch (e) {} }
    window.fhSpacePendingFromText = function (text) {
      const l = fhSpaceLinkParse(text); if (!l) return false;
      const card = l.k ? FHCrypto.parseKeyFragment('#fh-k=' + l.k) : null;
      _pendSet({ fid: l.fid, card: card ? card.display : null, name: l.name || '' });
      return true;
    };
    /* Landing: runs at module load, BEFORE the family card landing in
       67-card-ui.js, which would otherwise take this card for the family's.
       The fragment is eaten on arrival. */
    (function _spaceLinkLanding() {
      try {
        const src = location.hash || '';
        if (fhSpaceLinkParse(src)) {
          const raw = location.href;
          try { history.replaceState(null, '', location.pathname + location.search); } catch (e) {}
          window.fhSpacePendingFromText(src);
          window.__fhPendingSpaceUrl = raw;                          // for the hand-off sheet's copy button; memory only
          window.__fhPendingSpaceFresh = true;
          return;
        }
        const saved = sessionStorage.getItem(PEND_SS);
        if (saved) { const p = JSON.parse(saved); if (p && p.fid) window.__fhPendingSpace = p; }
      } catch (e) {}
    })();
    /* Called once the person is signed in. Joins if they are invited, unlocks
       with the card from the link (or the box sealed to them), opens the space. */
    window.fhSpacePendingJoin = async function () {
      const p = window.__fhPendingSpace; if (!p) return false;
      _pendSet(null);
      try { const ho = document.getElementById('sp-handoff'); if (ho) ho.remove(); } catch (e) {}
      await window.fhSpacesBoot({ force: true });
      let sp = window.fhSpaceGet(p.fid);
      if (!sp) {
        const j = await window.fhSpaceJoin(p.fid);
        if (!j.ok) {
          window.toast && toast(/not_whitelisted/.test(j.error || '')
            ? L('Email này chưa được mời vào nhóm. Nhờ chủ nhóm thêm email của bạn.', 'This email is not invited yet. Ask the owner to add it.')
            : (/invite_expired/.test(j.error || '') ? L('Lời mời đã hết hạn. Nhờ chủ nhóm mời lại.', 'The invite has expired. Ask the owner to invite you again.')
            : L('Chưa vào được nhóm, thử lại sau', 'Could not join the space, try again later')));
          return false;
        }
        await window.fhSpacesBoot({ force: true });
        sp = window.fhSpaceGet(p.fid);
      }
      if (!S.keys[p.fid]) { const kc = await _kGet(p.fid); if (kc && kc.key) S.keys[p.fid] = kc.key; }
      if (!S.keys[p.fid] && p.card) { const u = await window.fhSpaceUnlock(p.fid, p.card); if (!u.ok) window.toast && toast(L('Mã khóa trong link không mở được nhóm này', 'The code in the link does not open this space')); }
      if (!S.keys[p.fid]) await window.fhSpaceUnlockSealed(p.fid);
      if (sp) { await window.fhSpaceOpen(p.fid); return true; }
      return false;
    };

    /* ── open: make a space the active one ────────────────────────────────── */
    /* Everything the other tabs show follows profiles.family_id, so opening a
       space is a server switch plus a full hydrate. The key the family path
       needs is already in fh-keys under this id (create / unlock put it there). */
    let _opening = false;
    window.fhSpaceOpen = async function (fid, opts) {
      opts = opts || {};
      if (_opening) return false;
      if (window.DB && window.DB.fid === fid && !opts.force) { if (opts.tab !== false && typeof window.go === 'function') window.go(opts.tab || 'home'); return true; }
      _opening = true;
      try {
        const r = await _sb().rpc('switch_family', { p_family_id: fid });
        if (r.error) {
          const sp0 = window.fhSpaceGet(fid);
          window.toast && toast((sp0 && sp0.type !== 'family')
            ? L('Chưa mở được nhóm này. Ứng dụng đang được cập nhật, thử lại sau ít phút.', 'This space cannot be opened yet. The app is being updated, try again in a few minutes.')
            : (typeof _friendly === 'function' ? _friendly(r.error) : L('Chưa đổi được nhóm', 'Could not switch')));
          return false;
        }
        S.all.forEach((x) => { x.isActive = (x.id === fid); }); _rosterSave();
        document.documentElement.classList.remove('fh-nofam');
        try { localStorage.removeItem('fh-nofam'); } catch (e) {}
        /* the warm snapshot belongs to the container we just left */
        try { if (window.fhSnapClear) window.fhSnapClear(); } catch (e) {}
        if (window.DB) window.DB.fid = null;   // the hydrate re-reads the active one (same as the old picker)
        try { window.fhSpaceShellApply && window.fhSpaceShellApply(); } catch (e) {}
        if (window.loadFamilyData) await window.loadFamilyData();
        try { window.fhSpaceShellApply && window.fhSpaceShellApply(); } catch (e) {}
        if (S.list.some((x) => x.id === fid) && S.keys[fid]) { try { await window.fhSpaceHydrate(fid); } catch (e) {} }
        try { if (typeof window.renderAll === 'function') window.renderAll(); } catch (e) {}
        try { if (typeof window.renderPersonal === 'function') window.renderPersonal(); } catch (e) {}
        if (opts.tab !== false && typeof window.go === 'function') window.go(opts.tab || 'home');
        return true;
      } catch (e) { console.warn('space open failed', e); return false; }
      finally { _opening = false; }
    };

    /* ── hydrate one space on the light path (refetch; no realtime) ───────── */
    const HYDRATE_LIMIT = 500;
    window.fhSpaceHydrate = async function (fid) {
      if (!S.keys[fid]) return null;
      const [mm, tt, sh, su, cc] = await Promise.all([
        _sb().from('members').select('id,user_id,name,name_enc,is_shared,archived_at').eq('family_id', fid),
        _sb().from('transactions').select('id,txn_date,amount,amount_enc,note,note_enc,occurred_time,occurred_time_enc,category_id,member_id,created_by,status,kind').eq('family_id', fid).eq('status', 'realized').order('txn_date', { ascending: false }).limit(HYDRATE_LIMIT),
        _sb().from('txn_shares').select('id,txn_id,payer_member_id,rule,shares_enc,version').eq('family_id', fid),
        _sb().from('settle_ups').select('id,from_member,to_member,amount_enc,note_enc,settle_date,created_by,transfer_group_id').eq('family_id', fid).order('settle_date', { ascending: false }),
        _sb().from('categories').select('id,name,name_enc,emoji').eq('family_id', fid).is('archived_at', null),
      ]);
      if (mm.error || tt.error) return S.data[fid] || null;      // keep what we had; never replace a read with a failure
      /* Members who left stay in the list (their balance stays on the record
         under their name, spec section 8) but are not offered in any picker. */
      const members = [];
      for (const m of (mm.data || [])) {
        if (m.is_shared) continue;
        const nm = await _either(fid, m.name_enc, m.name);
        members.push({ id: m.id, userId: m.user_id, name: (nm && nm !== _DEC_FAILED) ? nm : (m.name || '?'), gone: !!m.archived_at });
      }
      const cats = [];
      for (const c of (cc.data || [])) { const cn = await _either(fid, c.name_enc, c.name); cats.push({ id: c.id, name: (cn && cn !== _DEC_FAILED) ? cn : (c.name || ''), emoji: c.emoji }); }
      const txns = []; let unreadable = 0;
      for (const t of (tt.data || [])) {
        if (t.kind && t.kind !== 'expense') continue;
        const a = await _either(fid, t.amount_enc, t.amount), bad = (a === _DEC_FAILED || a == null);
        if (bad) unreadable++;
        const nt = await _either(fid, t.note_enc, t.note), tm = await _either(fid, t.occurred_time_enc, t.occurred_time);
        txns.push({ id: t.id, date: t.txn_date, amt: bad ? null : Number(a), _unreadable: bad,
          note: nt === _DEC_FAILED ? null : nt, time: (tm && tm !== _DEC_FAILED) ? String(tm).slice(0, 5) : null,
          catId: t.category_id, payer: t.member_id, by: t.created_by });
      }
      const shares = {};
      for (const s of (sh.data || [])) {
        let map = null;
        const raw = await _decTxt(fid, s.shares_enc);
        if (raw) { try { map = JSON.parse(raw); } catch (e) {} }
        shares[s.txn_id] = { id: s.id, payer: s.payer_member_id, rule: s.rule, map: map };
      }
      const settles = [];
      for (const s of (su.data || [])) {
        const a = await _dec(fid, s.amount_enc), bad = (a === _DEC_FAILED);
        if (bad) unreadable++;
        settles.push({ id: s.id, from: s.from_member, to: s.to_member, amt: bad ? null : Number(a),
          _unreadable: bad, note: await _decTxt(fid, s.note_enc), date: s.settle_date, by: s.created_by, transferGroupId: s.transfer_group_id });
      }
      const full = (tt.data || []).length < HYDRATE_LIMIT;
      S.data[fid] = { members: members, txns: txns, shares: shares, settles: settles, cats: cats, unreadable: unreadable, at: Date.now(),
        /* the oldest day this read covers; null = the space's whole history. The
           book pass never removes a row older than this. */
        since: full ? null : (txns.length ? txns[txns.length - 1].date : null) };
      try { if (window.fhSpaceBookSyncSoon) window.fhSpaceBookSyncSoon(fid); } catch (e) {}
      return S.data[fid];
    };

    /* A local write changed the space: the next refresh must re-read it even
       if the last read is seconds old. */
    window.fhSpaceStale = function (fid) { const d = S.data[fid]; if (d) d.at = 0; };
    /* The amount or the payer of a shared expense was edited through the
       ordinary edit sheet: its share row follows (fhSplitRescale). No share row
       (a Chung expense) → nothing to do. */
    window.fhSpaceRescaleAfterEdit = async function (fid, txnId, newAmt, payerMemberId) {
      const d = S.data[fid], s = d && d.shares[txnId];
      if (!s || !s.map || !S.keys[fid]) return false;
      let sum = 0; fhSplitMembers(s.map).forEach((k) => { sum += Number(s.map[k]) || 0; });
      const payer = payerMemberId || s.payer;
      if (Math.abs(sum - Number(newAmt)) < 0.0005 && payer === s.payer) return false;
      const map = fhSplitRescale(s.map, newAmt); if (!map) return false;
      await window.fhSpaceSetShares(fid, txnId, payer, s.rule, map);
      window.fhSpaceStale(fid);
      return true;
    };
    window.fhSpaceMyMemberId = function (fid) {
      const d = S.data[fid];
      if (d) { const m = d.members.find((m) => m.userId === S.uid && !m.gone); if (m) return m.id; }
      if (window.DB && window.DB.fid === fid && window.DB.ownerMemberId) return window.DB.ownerMemberId;
      return null;
    };
    window.fhSpaceMembers = function (fid) { const d = S.data[fid]; return d ? d.members.filter((m) => !m.gone) : []; };

    /* ── writes ───────────────────────────────────────────────────────────── */
    /* The share row of an expense. The expense itself is written first (by the
       family write path when the space is the active one, by fhSpaceAddExpense
       otherwise); if this second write does not land it is queued, SEALED, and
       retried at the next roster read. Until it lands the row reads as Chung,
       which moves no balance: wrong in the safe direction. */
    const SHQ_LS = 'fh-shq';
    function _shq() { try { return JSON.parse(localStorage.getItem(SHQ_LS) || '[]') || []; } catch (e) { return []; } }
    function _shqSave(q) { try { if (q.length) localStorage.setItem(SHQ_LS, JSON.stringify(q.slice(-50))); else localStorage.removeItem(SHQ_LS); } catch (e) {} }
    async function _sharesUpsert(row) {
      const clean = { family_id: row.family_id, txn_id: row.txn_id, payer_member_id: row.payer_member_id, rule: row.rule, shares_enc: row.shares_enc };
      const r = await _sb().from('txn_shares').upsert(clean, { onConflict: 'txn_id' });
      return !r.error;
    }
    let _flushing = false;
    async function _shareQueueFlush() {
      if (_flushing) return; const q = _shq(); if (!q.length) return;
      _flushing = true;
      try {
        const left = [];
        for (const row of q) { let ok = false; try { ok = await _sharesUpsert(row); } catch (e) {} if (!ok && (row._n || 0) < 20) { row._n = (row._n || 0) + 1; left.push(row); } }
        _shqSave(left);
      } finally { _flushing = false; }
    }
    window.fhSpaceSharesPending = function () { return _shq().length; };
    /* `payload` is fhSplitPayload(...): { memberId: amountK, _out?, _parts?, _bill? }. */
    window.fhSpaceSetShares = async function (fid, txnId, payerMemberId, rule, payload) {
      if (!S.keys[fid]) return { ok: false, error: 'locked' };
      const row = { family_id: fid, txn_id: txnId, payer_member_id: payerMemberId, rule: rule === 'exact' ? 'exact' : 'equal',
        shares_enc: await _enc(fid, JSON.stringify(payload || {})) };
      let ok = false;
      try { ok = await _sharesUpsert(row); } catch (e) { ok = false; }
      if (!ok) { const q = _shq(); q.push(row); _shqSave(q); }
      return { ok: true, queued: !ok };
    };
    window.fhSpaceClearShares = async function (fid, txnId) {
      const r = await _sb().from('txn_shares').delete().eq('family_id', fid).eq('txn_id', txnId);
      return { ok: !r.error };
    };

    /* An expense written into a space on the light path (review filing a
       captured row into a space that is not the open one). `o.shares` is the
       payload, or null for a Chung expense. category is required by the
       transactions schema. */
    window.fhSpaceAddExpense = async function (fid, o) {
      if (!S.keys[fid]) return { ok: false, error: 'locked' };
      const sp = window.fhSpaceGet(fid);
      if (sp && sp.closed) return { ok: false, error: 'closed' };
      const my = window.fhSpaceMyMemberId(fid);
      const d = S.data[fid] || {};
      const catId = o.catId || ((d.cats || [])[0] || {}).id;
      if (!catId) return { ok: false, error: 'no_category' };
      const id = crypto.randomUUID();
      const row = { id: id, family_id: fid, category_id: catId, member_id: o.payerMemberId || my,
        created_by: my, status: 'realized', kind: 'expense',
        txn_date: o.dateIso || _localDate(new Date()),
        amount_enc: await _enc(fid, Number(o.amtK)),
        note_enc: o.note ? await _enc(fid, o.note) : null,
        occurred_time_enc: o.time ? await _enc(fid, o.time) : null,
        source: o.source || null,
        instrument: (o.inst && window.fhSpaceProfile(fid).source) ? o.inst : null,
        /* a Chung row I paid from a known account: its link is reserved so my
           tagged master below is THE master (same hand-off as 0134) */
        link_id: (!o.shares && o.link && o.acct) ? o.link : null };
      const r = await _sb().from('transactions').insert(row).select('id').single();
      if (r.error) { console.warn('space expense failed', r.error); return { ok: false, error: r.error.message }; }
      if (o.shares) {
        /* which of MY accounts paid, and the name typed for an outside share:
           known only here, handed to the book pass that follows the re-read */
        try { if (window.fhSpaceBookHint && (o.acct || o.outName)) window.fhSpaceBookHint(id, { acct: o.acct, outName: o.outName }); } catch (e) {}
        await window.fhSpaceSetShares(fid, id, row.member_id, o.rule || 'equal', o.shares);
      } else if (row.link_id && window.fhPersonalInsertMaster) {
        const cat = (d.cats || []).find((c) => c.id === catId) || {};
        try { await window.fhPersonalInsertMaster(row.link_id, fid, row.txn_date, Number(o.amtK), o.note || null, cat.name, cat.emoji, o.time || null, o.acct, null); } catch (e) {}
      }
      await window.fhSpaceHydrate(fid);
      try { window.fhNotify && window.fhNotify('space_expense', { familyId: fid }); } catch (e) {}
      return { ok: true, txnId: id };
    };
    window.fhSpaceDeleteExpense = async function (fid, txnId) {
      const r = await _sb().from('transactions').delete().eq('family_id', fid).eq('id', txnId);   // txn_shares cascades
      if (r.error) return { ok: false, error: r.error.message };
      if (S.keys[fid]) await window.fhSpaceHydrate(fid);
      return { ok: true };
    };

    window.fhSpaceSettle = async function (fid, o) {
      if (!S.keys[fid]) return { ok: false, error: 'locked' };
      const sp = window.fhSpaceGet(fid);
      if (sp && sp.closed) return { ok: false, error: 'closed' };
      /* a settle-up that came in on my bank account (review): the account rides
         to my book row through the same hint the expenses use */
      const _sid = crypto.randomUUID();
      try { if (o.acct && window.fhSpaceBookHint) window.fhSpaceBookHint(_sid, { acct: o.acct }); } catch (e) {}
      const r = await _sb().from('settle_ups').insert({ id: _sid, family_id: fid,
        from_member: o.fromMember, to_member: o.toMember,
        amount_enc: await _enc(fid, Number(o.amtK)),
        note_enc: o.note ? await _enc(fid, o.note) : null,
        settle_date: o.dateIso || _localDate(new Date()),
        created_by: S.uid, transfer_group_id: o.transferGroupId || null }).select('id').single();
      if (r.error) { console.warn('settle failed', r.error); return { ok: false, error: r.error.message }; }
      await window.fhSpaceHydrate(fid);
      try { window.fhNotify && window.fhNotify('space_settle', { familyId: fid, target: o.toMember === window.fhSpaceMyMemberId(fid) ? o.fromMember : o.toMember }); } catch (e) {}
      return { ok: true, id: r.data && r.data.id };
    };
    window.fhSpaceSettleDelete = async function (fid, id) {
      const r = await _sb().from('settle_ups').delete().eq('family_id', fid).eq('id', id);
      if (r.error) return { ok: false, error: r.error.message };
      await window.fhSpaceHydrate(fid);
      return { ok: true };
    };

    /* ── derivation (the arithmetic is 15-spaces-core.js) ─────────────────── */
    window.fhSpaceBalances = function (fid) { const d = S.data[fid]; return d ? fhSpaceBalancesOf(d) : null; };
    window.fhSpaceMyNet = function (fid) {
      const my = window.fhSpaceMyMemberId(fid); if (!my) return 0;
      const b = (window.fhSpaceBalances(fid) || []).find((r) => r.member.id === my);
      return b ? b.net : 0;
    };
    window.fhSpacePairwise = function (fid) { const bal = window.fhSpaceBalances(fid); return bal ? fhSpacePairwiseOf(bal) : []; };
  })();