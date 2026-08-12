  /* ═══ Key Card UI (0042) — the safe key that replaces the passcode ═══════════
     DORMANT until a family has a card wrap. This file only ACTS when
     window.DB.keyWraps carries a kind='card' wrap (created by fhCardCreate) or
     a #fh-key= fragment arrives. In production today neither happens, so every
     entry point here is unreachable and behaviour is unchanged.

     Module scope is shared across all js-data files, so this reuses FHCrypto,
     the DEK session (_fhDekRaw / fhKeyAdopt / fhKeyReady), _rpc, sb, and the
     sheet/modal chrome (_fhModal / _fhSheet / _btn / _S / _friendly) from the
     earlier files verbatim. */

  // the family's live card wrap (from snap.key_wraps), or null
  function _fhCardWrap() {
    const ws = (window.DB && window.DB.keyWraps) || [];
    for (const w of ws) if (w && w.kind === 'card') return w;
    return null;
  }
  window.fhHasCard = function () { return !!_fhCardWrap(); };

  function _cardErr(kind) {
    const m = kind === 'checksum' ? L('Mã khóa nhập chưa đúng, kiểm tra lại giúp mình', 'That code doesn’t look right, check it again')
      : kind === 'length' ? L('Mã khóa chưa đủ, nhập hoặc quét lại nha', 'That code looks incomplete, enter or scan it again')
      : kind === 'wrong' ? L('Mã khóa không mở được dữ liệu của nhà này', 'That code doesn’t open this family’s data')
      : L('Mã khóa không hợp lệ', 'That code isn’t valid');
    const e = new Error('card_' + kind); e.fhMsg = m; return e;
  }

  /* ── Local card cache ──
     We never store the card on the server (only its wrap). A device that HAS the
     card (created it, or entered it to unlock) caches the string locally so
     "xem/lưu thẻ" works on that device later.

     At rest it is ENCRYPTED under the family DEK (fhEnc), never plaintext: the DEK
     is a non-extractable CryptoKey (0057), so an offline IndexedDB dump yields only
     ciphertext + an unexportable key handle — it can't recover the card, and thus
     can't re-derive the DEK. This closes the last plaintext-key-at-rest hole. The
     key is always present when we cache (right after create/adopt/unlock); if it
     somehow isn't, we skip caching rather than write the card in the clear. Legacy
     {card:<plaintext>} rows are upgraded to {enc:<ct>} on first read. Dropped on
     key-drop. */
  const _CARD_DB = 'fh-card', _CARD_STORE = 'c';
  function _cardDbOpen() {
    return new Promise((resolve, reject) => {
      let rq; try { rq = indexedDB.open(_CARD_DB, 1); } catch (e) { return reject(e); }
      rq.onupgradeneeded = () => { const db = rq.result; if (!db.objectStoreNames.contains(_CARD_STORE)) db.createObjectStore(_CARD_STORE, { keyPath: 'fid' }); };
      rq.onsuccess = () => resolve(rq.result);
      rq.onerror = () => reject(rq.error);
    });
  }
  async function _cardCachePut(fid, display) {
    if (fid == null || !display) return;
    let ct = null;
    try { if (fhKeyReady()) ct = await fhEnc(display); } catch (e) { ct = null; }
    if (!ct) return;                                   // no key to protect it → don't cache in the clear
    try { const db = await _cardDbOpen(); await new Promise((res, rej) => { const tx = db.transaction(_CARD_STORE, 'readwrite'); tx.objectStore(_CARD_STORE).put({ fid: fid, enc: ct, at: Date.now() }); tx.oncomplete = () => res(true); tx.onerror = () => rej(tx.error); }); } catch (e) {}
  }
  async function _cardCacheGet(fid) {
    let rec = null;
    try { const db = await _cardDbOpen(); rec = await new Promise((res) => { const tx = db.transaction(_CARD_STORE, 'readonly'); const rq = tx.objectStore(_CARD_STORE).get(fid); rq.onsuccess = () => res(rq.result || null); rq.onerror = () => res(null); }); } catch (e) { return null; }
    if (!rec) return null;
    if (rec.enc) { try { return fhKeyReady() ? await fhDec(rec.enc) : null; } catch (e) { return null; } }
    if (rec.card) {                                    // legacy plaintext → return it and silently re-store encrypted
      const disp = rec.card;
      try { if (fhKeyReady()) await _cardCachePut(fid, disp); } catch (e) {}
      return disp;
    }
    return null;
  }
  async function _cardCacheDel(fid) {
    try { const db = await _cardDbOpen(); await new Promise((res) => { const tx = db.transaction(_CARD_STORE, 'readwrite'); tx.objectStore(_CARD_STORE).delete(fid); tx.oncomplete = () => res(true); tx.onerror = () => res(false); }); } catch (e) {}
  }
  window.fhCardCacheDrop = function (fid) { if (fid != null) _cardCacheDel(fid); };   // called from fhKeyDrop path (leave/delete family)
  window.fhCardCacheStore = function (fid, display) { if (fid != null && display) _cardCachePut(fid, display); };   // onboarding caches the new card on the creating device

  /* ── Create / rotate the family card (needs the DEK; produces a wrap) ──
     rpcName = 'set_family_card' (owner, creation/migration) or
     'rotate_family_card' (any keyed member, regeneration). Returns the generated
     card object so the caller can display it. The plaintext card exists only
     here, at generation time; only the wrap reaches the server. */
  async function fhCardCreate(rpcName) {
    if (!fhKeyReady()) throw new Error('locked');
    // Re-wrapping needs the raw DEK, which now lives in memory only (0057: the DEK
    // is cached as a non-extractable CryptoKey, so a cold start has no raw bytes).
    // Recover them transparently from THIS device's cached card + current wrap so
    // rotate still works cold; only if the card isn't cached here do we ask for it.
    if (!_fhDekRaw) {
      try {
        const disp = await _cardCacheGet(window.DB.fid);
        const wrap = _fhCardWrap();
        if (disp && wrap) {
          const p = _parseCardInput(disp);
          if (p && p.ok) {
            const k = await FHCrypto.deriveKeys(p.key, wrap.kdf_salt, wrap.kdf_iters, wrap.kdf_version);
            const raw = await FHCrypto.unwrapDek(wrap.wrapped_dek, k.kWrap);
            await fhKeyAdopt(window.DB.fid, raw);   // repopulates _fhDekRaw for the re-wrap below
          }
        }
      } catch (e) {}
    }
    if (!_fhDekRaw) { const e = new Error('need_reunlock'); e.fhMsg = L('Mở khoá lại bằng mã khóa hiện tại của nhà một lần, rồi đổi mã nhé', 'Unlock once with your current family code, then change it'); throw e; }
    const card = FHCrypto.genCard();
    const salt = FHCrypto.genSaltHex();
    const keys = await FHCrypto.deriveKeys(card.key, salt, FH_KDF_ITERS_CARD, FH_KDF_VERSION);
    const wrapped = await FHCrypto.wrapDek(_fhDekRaw, keys.kWrap);
    await _rpc(rpcName || 'set_family_card', {
      p_kdf_salt: salt, p_kdf_iters: FH_KDF_ITERS_CARD, p_kdf_version: FH_KDF_VERSION, p_wrapped_dek: wrapped, p_label: null
    });
    await _cardCachePut(window.DB.fid, card.display);
    return card;
  }
  window.fhCardCreate = fhCardCreate;

  // Accept either the raw card (FH-…) OR a pasted card link/URL (#fh-k=…), so
  // "copy from the handoff, paste in the app" works and a stray URL still opens.
  function _parseCardInput(input) {
    const s = String(input == null ? '' : input);
    if (/#|fh-k=|https?:/i.test(s)) { const f = FHCrypto.parseKeyFragment(s); if (f && f.ok) return f; }
    return FHCrypto.parseCard(s);
  }
  window.fhParseCardInput = _parseCardInput;

  /* ── Unlock this device with a card (adopt the DEK) ──
     Offline-capable: a wrong card simply fails the AES-GCM unwrap, no server
     needed. On success the card is cached locally so this device can show it. */
  async function fhCardUnlock(input) {
    const wrap = _fhCardWrap();
    if (!wrap) throw _cardErr('wrong');
    const p = _parseCardInput(input);
    if (!p || !p.ok) throw _cardErr((p && p.error) || 'checksum');
    const keys = await FHCrypto.deriveKeys(p.key, wrap.kdf_salt, wrap.kdf_iters, wrap.kdf_version);
    let dekRaw;
    try { dekRaw = await FHCrypto.unwrapDek(wrap.wrapped_dek, keys.kWrap); }
    catch (e) { throw _cardErr('wrong'); }
    await fhKeyAdopt(window.DB.fid, dekRaw);
    await _cardCachePut(window.DB.fid, p.display);
    try { _rpc('mark_key_unlocked'); } catch (e) {}
    return true;
  }
  window.fhCardUnlock = fhCardUnlock;

  /* ── Deliver actions ──
     Two kinds, kept distinct: DURABLE self-backup (copy text / save file — the
     real card the family keeps privately, forever) and OPAQUE invite (QR / share
     link — a one-time claim, 0044, that never carries the card in the clear and
     expires in 15 min). The card the owner is looking at is remembered for the
     QR/link actions so the onclicks stay tiny. */
  let _cardShown = null;   // the card object currently on screen
  window.fhCardCopyText = function () { try { if (_cardShown) navigator.clipboard.writeText(_cardShown.display); window.toast && window.toast(L('Đã sao chép mã khóa', 'Code copied')); } catch (e) {} };
  window.fhCardSaveFile = function () {
    if (!_cardShown) return;
    try {
      const body = 'FamilyHub — Mã khóa của nhà / Family code\n\n' + _cardShown.display + '\n\n'
        + 'Đây là mã duy nhất mở dữ liệu của nhà mình.\n'
        + 'Mất mã và mất hết điện thoại là mất dữ liệu, không ai lấy lại được.\n'
        + 'Giữ kỹ như giữ sổ đỏ.\n';
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([body], { type: 'text/plain' }));
      a.download = 'FamilyHub-code.txt';
      document.body.appendChild(a); a.click();
      setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 4000);
    } catch (e) {}
  };
  window.fhCardCopyLink = function () {
    if (!_cardShown) return;
    try { navigator.clipboard.writeText(_cardShown.url || FHCrypto.cardUrl(_cardShown.display)); window.toast && window.toast(L('Đã sao chép link mã khóa', 'Code link copied')); } catch (e) {}
  };
  // QR sheet: the self-contained card as a scannable code, with share + save-photo.
  window.fhCardQrSheet = function () {
    if (!_cardShown) return;
    const url = _cardShown.url || FHCrypto.cardUrl(_cardShown.display);
    const cv = window.fhQrCanvas(url, 6, 4);
    cv.style.cssText = 'width:220px;height:220px;image-rendering:pixelated;border-radius:8px;display:block;margin:8px auto';
    window.__fhQrCanvas = cv;
    _fhSheet('<div class="fh-s-h">' + L('Mã khóa dạng QR', 'Your code as a QR') + '</div>'
      + '<div id="fh-qr-wrap" style="text-align:center"></div>'
      + '<div class="fh-s-sub" style="text-align:center">' + L('Cho người nhà quét để nhận. Mã này cũng là chìa khóa, giữ kỹ nha.', 'Have your family scan it. This is your key too, so keep it safe.') + '</div>'
      + _btn(L('Chia sẻ ảnh', 'Share image'), 'fhCardQrShare(this)', _S.line)
      + _btn(L('Lưu ảnh', 'Save image'), 'fhCardQrSave()', _S.line)
      + _btn(L('Xong', 'Done'), '_closeOv()', _S.ghost));
    const wrap = document.getElementById('fh-qr-wrap'); if (wrap) wrap.appendChild(cv);
  };
  function _qrBlob() { return new Promise((res) => { try { window.__fhQrCanvas.toBlob((b) => res(b), 'image/png'); } catch (e) { res(null); } }); }
  window.fhCardQrSave = async function () {
    const b = await _qrBlob(); if (!b) return;
    const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = 'FamilyHub-invite-QR.png';
    document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 4000);
  };
  window.fhCardQrShare = async function (btn) {
    const b = await _qrBlob(); if (!b) return;
    try {
      const file = new File([b], 'FamilyHub-invite-QR.png', { type: 'image/png' });
      if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: L('Mã khóa của nhà', 'Family code') }); }
      else { window.fhCardQrSave(); }   // no file share (desktop) → fall back to saving
    } catch (e) {}
  };
  function _cardActions(card) {
    _cardShown = card;
    return '<div class="fh-s-sub" style="font-family:monospace;font-size:17px;letter-spacing:1px;word-break:break-all;padding:12px;border:1px solid var(--hairline);border-radius:6px;text-align:center">' + _esc(card.display) + '</div>'
      + '<div class="fh-s-lab" style="margin-top:14px">' + L('Giữ cho nhà mình', 'Keep for your family') + '</div>'
      + _btn(L('Sao chép chữ', 'Copy text'), 'fhCardCopyText()', _S.line)
      + _btn(L('Lưu file', 'Save file'), 'fhCardSaveFile()', _S.line)
      + '<div class="fh-s-lab" style="margin-top:14px">' + L('Chia sẻ với người nhà', 'Share with your family') + '</div>'
      + _btn(L('Mã QR', 'QR code'), 'fhCardQrSheet()', _S.cta)
      + _btn(L('Sao chép link', 'Copy link'), 'fhCardCopyLink()', _S.line);
  }

  /* ── Intro / display sheet (Appendix A copy) ──
     Shown proactively at onboarding + on return (wired in Phase B/C). In Phase A
     it is reachable only via fhCardShow() for testing. */
  function _cardIntroCopy() {
    return '<div class="fh-s-h">' + L('Lưu mã khóa của nhà', 'Save your family code') + '</div>'
      + '<div class="fh-s-sub">' + L('Chỉ nhà mình mở được, tụi mình cũng chịu.',
                                     'Only your family can open it, us included.') + '</div>'
      + '<div class="fh-s-sub">' + L('Giữ kỹ. Mã mở mọi thứ, không có bản sao. Mất là mất luôn.',
                                     'Keep it safe. It opens everything and there is no backup. Lose it and it is gone.') + '</div>';
  }
  // Show a specific card object (post-create/regenerate) with the save actions.
  window.fhCardShow = function (card) {
    if (!card || !card.display) return;
    _fhSheet(_cardIntroCopy() + _cardActions(card) + _btn(L('Xong', 'Done'), '_closeOv()', _S.ghost));
  };

  /* ── Fullscreen "save your family code" intro (post-onboarding) ──
     A brand-new owner has never seen the key before, so it owns the whole screen
     (not a dismissible sheet) the first time. It shows ONLY the save-it-for-yourself
     actions — copy / save a file — because the one thing a new owner must do is
     secure the key; inviting the rest of the family (QR, link) waits for Settings,
     once it's safe. Modeled on the lock wall's fullscreen scaffold. */
  const _CI_KEY = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="8.5" cy="8.5" r="5.5"/><path d="M12.5 12.5L21 21M17.5 17.5l2.2-2.2M14.5 14.5l2.2-2.2"/></svg>';
  const _CI_WARN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/></svg>';
  window.fhCardIntro = function (card) {
    if (!card || !card.display) return;
    if (document.getElementById('fh-cardintro')) return;
    _cardShown = card;
    const el = document.createElement('div');
    el.id = 'fh-cardintro';
    el.innerHTML = '<div class="fh-ci-inner">'
      + '<div class="fh-ci-hero"><div class="fh-ci-badge">' + _CI_KEY + '</div>'
      + '<div class="fh-ci-title">' + L('Lưu mã khóa của nhà', 'Save your family code') + '</div>'
      + '<div class="fh-ci-sub">' + L('Đây là chìa khóa mở dữ liệu của nhà mình. Chỉ nhà mình mở được, tụi mình cũng chịu.',
                                       'This is the key to your family’s data. Only your family can open it, us included.') + '</div></div>'
      + '<div class="fh-ci-code">' + _esc(card.display) + '</div>'
      + '<div class="fh-ci-warn">' + _CI_WARN + '<span>' + L('Giữ kỹ nha. Mã mở mọi thứ và không có bản sao, mất mã là mất dữ liệu.',
                                                              'Keep it safe. It opens everything and there is no backup, so lose it and the data is gone.') + '</span></div>'
      + '<button class="fh-ci-cta" type="button" onclick="fhCardCopyText()">' + L('Sao chép mã khóa', 'Copy the code') + '</button>'
      + '<button class="fh-ci-line" type="button" onclick="fhCardSaveFile()">' + L('Lưu thành file', 'Save it as a file') + '</button>'
      + '<button class="fh-ci-done" type="button" onclick="fhCardIntroClose()">' + L('Đã lưu, vào nhà mình', 'Saved it, enter home') + '</button>'
      + '</div>';
    (document.getElementById('phone') || document.body).appendChild(el);
  };
  window.fhCardIntroClose = function () { const el = document.getElementById('fh-cardintro'); if (el) el.remove(); };
  // Show the card cached on THIS device (Settings → "Xem mã khóa"). If this
  // device never held the card, offer regenerate instead.
  window.fhCardShowCached = async function () {
    const disp = await _cardCacheGet(window.DB.fid);
    if (disp) { const p = FHCrypto.parseCard(disp); return window.fhCardShow(p.ok ? { display: p.display, url: FHCrypto.cardUrl(p.display) } : { display: disp, url: FHCrypto.cardUrl(disp) }); }
    _fhSheet('<div class="fh-s-h">' + L('Mã khóa của nhà', 'Family code') + '</div>'
      + '<div class="fh-s-sub">' + L('Máy này chưa giữ mã khóa. Bạn có thể tạo mã mới (mã cũ sẽ ngừng dùng), rồi lưu và đưa cho người nhà.',
                                     'This device doesn’t hold the code. You can make a new one (the old code stops working), then save and share it.') + '</div>'
      + _btn(L('Tạo lại mã khóa', 'Make a new code'), 'fhCardRegenerate(this)', _S.cta)
      + _btn(L('Đóng', 'Close'), '_closeOv()', _S.ghost));
  };

  /* Migrate the family onto the card (owner, one tap, on an unlocked device).
     Adds a card wrap BESIDE the existing passcode wrap — both keep working, so
     no device is locked out — and re-wraps the SAME DEK, so nothing
     re-encrypts. Then shows the intro + the card to save. */
  window.fhCardMigrate = async function (btn) {
    if (!fhKeyReady()) { window.fhUnlockPrompt && window.fhUnlockPrompt(); return; }
    if (btn) { btn.disabled = true; btn.textContent = L('Đang tạo…', 'Making…'); }
    try {
      const card = await fhCardCreate('set_family_card');
      await window.loadFamilyData();
      window.fhCardShow(card);
      window.toast && window.toast(L('Đã tạo mã khóa cho nhà ✓. Lưu lại và đưa cho người thân nha.', 'Your family code is ready ✓. Save it and share with your family.'));
    } catch (e) {
      if (btn) { btn.disabled = false; btn.textContent = L('Nâng cấp lên mã khóa của nhà', 'Upgrade to a family code'); }
      window.toast && window.toast(_friendly(e));
    }
  };

  /* Proactive migration intro (returning owner, no card yet) — the USP moment,
     surfaced on open instead of buried in Settings. Tapping mints + shows the
     card to save; the old 6-digit code keeps working until Phase D removes it. */
  window.fhCardMigrateIntro = function () {
    _fhSheet('<div class="fh-s-h">' + L('Khóa dữ liệu bằng mã riêng', 'Lock your data with your own code') + '</div>'
      + '<div class="fh-s-sub">' + L('Một mã khóa hết tiền, ảnh và tên. Chỉ nhà mình có, tụi mình cũng chịu.',
                                     'One code locks money, photos and names. Only your family holds it, us included.') + '</div>'
      + '<div class="fh-s-sub">' + L('Mã 6 số cũ vẫn dùng được cho tới khi bạn gỡ.',
                                     'Your old 6-digit code keeps working until you remove it.') + '</div>'
      + _btn(L('Tạo mã khóa', 'Create the code'), 'fhCardMigrate(this)', _S.cta)
      + _btn(L('Để sau', 'Later'), '_fhCardLater();_closeOv()', _S.ghost));
  };
  window._fhCardLater = function () { try { localStorage.setItem('fh-card-later', String(Date.now())); } catch (e) {} };
  // Once per session, surface the intro for an owner whose family has no card
  // yet. "Để sau" snoozes it ~5 days. Members can't mint, so they're skipped
  // (their locked devices already get the card prompt via the lock bar).
  window.fhCardProactive = async function () {
    try {
      if (fhEncState() === 'off' || !fhKeyReady()) return;
      if (window.fhHasCard && window.fhHasCard()) return;
      if (window.__fhCardPromptShown) return; window.__fhCardPromptShown = 1;
      let later = 0; try { later = Number(localStorage.getItem('fh-card-later') || 0); } catch (e) {}
      if (later && Date.now() - later < 5 * 86400000) return;
      let owner = false;
      try { const r = await sb.from('families').select('owner_id').eq('id', window.DB.fid).maybeSingle(); owner = !!(r.data && window.fhUser && r.data.owner_id === window.fhUser.id); } catch (e) {}
      if (!owner) return;
      if (document.querySelector('.sheet.on, .modal.on')) return;
      window.fhCardMigrateIntro();
    } catch (e) {}
  };

  /* Retire the old 6-digit passcode (owner, after the family is on the card).
     Arm-then-confirm; server refuses unless a live card wrap exists. */
  window.fhDropPasscode = async function (btn) {
    if (btn && !btn.classList.contains('armed')) {
      btn.classList.add('armed'); btn.textContent = L('Chạm lần nữa để gỡ mã 6 số', 'Tap again to remove the 6-digit code');
      clearTimeout(window._fhDropT);
      window._fhDropT = setTimeout(() => { if (!btn.isConnected) return; btn.classList.remove('armed'); btn.textContent = L('Gỡ mã 6 số cũ', 'Remove the old 6-digit code'); }, 4000);
      return;
    }
    clearTimeout(window._fhDropT);
    if (btn) { btn.disabled = true; btn.textContent = L('Đang gỡ…', 'Removing…'); }
    try {
      await _rpc('drop_family_passcode');
      await window.loadFamilyData();
      window.fhEncryptionSheet && window.fhEncryptionSheet();
      window.toast && window.toast(L('Đã gỡ mã 6 số. Giờ nhà mình chỉ dùng mã khóa.', 'Code removed. Your family now uses just the code.'));
    } catch (e) {
      if (btn) { btn.disabled = false; btn.classList.remove('armed'); btn.textContent = L('Gỡ mã 6 số cũ', 'Remove the old 6-digit code'); }
      window.toast && window.toast(/no_card/i.test(String((e && e.message) || '')) ? L('Hãy tạo mã khóa trước khi gỡ mã.', 'Create the family code before removing the 6-digit code.') : _friendly(e));
    }
  };

  // Regenerate (any keyed member): rotate the wrap, show + cache the new card.
  window.fhCardRegenerate = async function (btn) {
    if (!fhKeyReady()) { window.fhUnlockPrompt && window.fhUnlockPrompt(); return; }
    if (btn) { btn.disabled = true; btn.textContent = L('Đang tạo…', 'Making…'); }
    try {
      const card = await fhCardCreate('rotate_family_card');
      await window.loadFamilyData();
      window.fhCardShow(card);
      window.toast && window.toast(L('Đã tạo mã khóa mới. Tấm cũ ngừng dùng.', 'New code made. The old one no longer works.'));
    } catch (e) {
      if (btn) { btn.disabled = false; btn.textContent = L('Tạo lại mã khóa', 'Make a new code'); }
      window.toast && window.toast(_friendly(e));
    }
  };

  // One-tap paste into the card field (reads the clipboard — the button tap is
  // the user gesture iOS requires). Fills, validates, and clears any red flag.
  window.fhCardPasteInput = async function (btn) {
    try {
      const t = await navigator.clipboard.readText();
      const el = document.getElementById('fh-card-in');
      if (el && t) { el.value = t.trim(); window.fhModalDirty && window.fhModalDirty(); el.focus(); }
    } catch (e) { window.toast && window.toast(L('Chưa dán được, thử gõ tay nhé', 'Couldn’t paste, try typing it')); }
  };

  // Card entry modal (the unlock prompt for a card family). Plain forgiving
  // input; validation + friendly error on submit.
  window.fhCardEnterPrompt = function () {
    _fhModal({
      title: L('Nhập mã khóa của nhà', 'Enter your family code'),
      saveLabel: L('Mở khóa', 'Unlock'),
      body: '<div class="fh-s-sub">' + L('Dán mã khóa vào đây để mở dữ liệu của nhà.',
                                         'Paste your family code here to open the data.') + '</div>'
        + '<div class="field"><input id="fh-card-in" placeholder="FH-XXXX-XXXX-…" autocapitalize="characters" autocomplete="off" spellcheck="false" oninput="fhModalDirty()"></div>'
        + _btn(L('Dán mã khóa', 'Paste'), 'fhCardPasteInput(this)', _S.line)
        // dual-wrap fallback: while the family still has a 6-digit code, offer it
        // so nobody is ever stuck mid-migration before they've received the card
        + ((window.DB && window.DB.enc && window.DB.enc.wrapped_dek)
            ? '<div style="text-align:center;margin-top:4px"><button class="fh-s-ghost" onclick="_closeOv();fhPasscodeUnlockPrompt()">' + L('Hoặc dùng mã 6 số', 'Or use the 6-digit code') + '</button></div>'
            : ''),
      required: () => [{ el: 'fh-card-in', ok: _parseCardInput((document.getElementById('fh-card-in') || {}).value || '').ok }],
      reqMsg: L('Mã khóa chưa đúng, kiểm tra lại nha', 'That code doesn’t look right, check it again'),
      save: async () => {
        await fhCardUnlock((document.getElementById('fh-card-in').value || ''));
        window.fhLockBanner && window.fhLockBanner(false);
        window.toast && window.toast(L('Đã mở khóa ✓', 'Unlocked ✓'));
        if (window.fhOutboxFlush) setTimeout(() => window.fhOutboxFlush(), 400);
        if (window.loadFamilyData) window.loadFamilyData();
      }
    });
  };

  /* ── #fh-k= landing (runs once at module load; FHCrypto is defined here) ──
     A card link opens the app with #fh-key=… . Grab it, EAT it from the URL
     (never leave a secret in the bar/history/share sheet), then either stash it
     for post-hydrate unlock (installed PWA) or show the iOS Safari handoff. */
  (function _fhBootCard() {
    try {
      const standalone = (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || window.navigator.standalone === true;
      const parsed = FHCrypto.parseKeyFragment(location.hash) || FHCrypto.parseKeyFragment(location.href);
      const hadFrag = /[#&]fh-k=|[#&]fh-key=/i.test(location.hash) || /[#&]fh-k=|[#&]fh-key=/i.test(location.href);
      if (hadFrag) { try { history.replaceState(null, '', location.pathname + location.search); } catch (e) {} }   // eat-on-arrival
      if (!parsed) return;
      // Stash in EVERY context (installed PWA or a plain browser tab): once the
      // person signs in HERE and the family hydrates, the post-hydrate hook
      // unlocks with it automatically. Sign-in is in-app (no page reload), so a
      // window var survives it. The card is the safe key, not a login — this is
      // what makes "scan → sign in → you're in" work for a signed-out user.
      window.__fhPendingCard = parsed.display;
      if (standalone) return;
      /* Plain browser tab: show a light, dismissible sheet. Primary path is
         "sign in here" (the stashed card then auto-applies); the copy button is
         the fallback for someone who will instead open the INSTALLED app, whose
         storage this tab can't reach. */
      const ov = document.createElement('div');
      ov.style.cssText = 'position:fixed;inset:0;z-index:9999;background:var(--canvas);color:var(--ink);display:flex;align-items:center;justify-content:center;padding:24px;font-family:inherit';
      const _hbtn = 'width:100%;border-radius:12px;padding:14px 22px;font-size:15px;font-weight:700;font-family:inherit;cursor:pointer;box-sizing:border-box';
      ov.innerHTML = '<div style="max-width:420px;width:100%;text-align:center">'
        + '<div style="font-size:19px;font-weight:700;margin-bottom:12px">' + L('Đã nhận mã khóa của nhà', 'Got your family code') + '</div>'
        + '<div style="color:var(--muted);line-height:1.6;margin-bottom:22px">' + L('Mã khóa đã lưu trên máy này. Chọn cách bạn muốn vào nhà.', 'Your code is saved on this device. Choose how you’d like to get in.') + '</div>'
        + '<button id="fh-handoff-go" style="' + _hbtn + ';background:var(--brand);color:var(--white);border:none">' + L('Đăng nhập bằng Google', 'Sign in with Google') + '</button>'
        + '<div style="height:12px"></div>'
        + '<button id="fh-handoff-copy" style="' + _hbtn + ';background:none;color:var(--brand);border:1.5px solid var(--brand)">' + L('Chép mã khóa', 'Copy the code') + '</button>'
        + '<div style="color:var(--muted);font-size:12px;line-height:1.5;margin-top:14px">' + L('Dùng “Chép mã khóa” nếu bạn sẽ mở app đã cài trên máy.', 'Use “Copy the code” if you’ll open the installed app instead.') + '</div>'
        + '</div>';
      const mount = () => {
        document.body.appendChild(ov);
        const go = document.getElementById('fh-handoff-go'); if (go) go.onclick = () => ov.remove();
        const c = document.getElementById('fh-handoff-copy');
        if (c) c.onclick = () => { try { navigator.clipboard && navigator.clipboard.writeText(parsed.display); c.textContent = L('Đã chép ✓', 'Copied ✓'); } catch (e) {} };
      };
      if (document.body) mount(); else document.addEventListener('DOMContentLoaded', mount);
    } catch (e) { /* a bad fragment must never break boot */ }
  })();