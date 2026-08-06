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
    const m = kind === 'checksum' ? L('Thẻ khóa nhập chưa đúng, kiểm tra lại giúp mình', 'That card doesn’t look right, check it again')
      : kind === 'length' ? L('Thẻ khóa chưa đủ, nhập hoặc quét lại nha', 'That card looks incomplete, enter or scan it again')
      : kind === 'wrong' ? L('Thẻ khóa không mở được dữ liệu của nhà này', 'That card doesn’t open this family’s data')
      : L('Thẻ khóa không hợp lệ', 'That card isn’t valid');
    const e = new Error('card_' + kind); e.fhMsg = m; return e;
  }

  /* ── Local card cache ──
     We never store the card on the server (only its wrap). A device that HAS
     the card (created it, or entered it to unlock) caches the string locally so
     "xem/lưu thẻ" works on that device later. Same sensitivity as the DEK, so
     it lives in IndexedDB, never localStorage, and is dropped on key-drop. */
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
    try { const db = await _cardDbOpen(); await new Promise((res, rej) => { const tx = db.transaction(_CARD_STORE, 'readwrite'); tx.objectStore(_CARD_STORE).put({ fid: fid, card: display, at: Date.now() }); tx.oncomplete = () => res(true); tx.onerror = () => rej(tx.error); }); } catch (e) {}
  }
  async function _cardCacheGet(fid) {
    try { const db = await _cardDbOpen(); return await new Promise((res) => { const tx = db.transaction(_CARD_STORE, 'readonly'); const rq = tx.objectStore(_CARD_STORE).get(fid); rq.onsuccess = () => res(rq.result ? rq.result.card : null); rq.onerror = () => res(null); }); } catch (e) { return null; }
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
    if (!fhKeyReady() || !_fhDekRaw) throw new Error('locked');
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

  /* ── Unlock this device with a card (adopt the DEK) ──
     Offline-capable: a wrong card simply fails the AES-GCM unwrap, no server
     needed. On success the card is cached locally so this device can show it. */
  async function fhCardUnlock(input) {
    const wrap = _fhCardWrap();
    if (!wrap) throw _cardErr('wrong');
    const p = FHCrypto.parseCard(input);
    if (!p.ok) throw _cardErr(p.error);
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
  window.fhCardCopyText = function () { try { if (_cardShown) navigator.clipboard.writeText(_cardShown.display); window.toast && window.toast(L('Đã sao chép thẻ khóa', 'Card copied')); } catch (e) {} };
  window.fhCardSaveFile = function () {
    if (!_cardShown) return;
    try {
      const body = 'FamilyHub — Thẻ khóa của nhà / Family Key Card\n\n' + _cardShown.display + '\n\n'
        + 'Đây là chìa khóa duy nhất mở dữ liệu của nhà mình.\n'
        + 'Mất thẻ và mất hết điện thoại là mất dữ liệu, không ai lấy lại được.\n'
        + 'Giữ kỹ như giữ sổ đỏ.\n';
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([body], { type: 'text/plain' }));
      a.download = 'FamilyHub-KeyCard.txt';
      document.body.appendChild(a); a.click();
      setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 4000);
    } catch (e) {}
  };
  window.fhCardCopyLink = function () {
    if (!_cardShown) return;
    try { navigator.clipboard.writeText(_cardShown.url || FHCrypto.cardUrl(_cardShown.display)); window.toast && window.toast(L('Đã sao chép link thẻ khóa', 'Card link copied')); } catch (e) {}
  };
  // QR sheet: the self-contained card as a scannable code, with share + save-photo.
  window.fhCardQrSheet = function () {
    if (!_cardShown) return;
    const url = _cardShown.url || FHCrypto.cardUrl(_cardShown.display);
    const cv = window.fhQrCanvas(url, 6, 4);
    cv.style.cssText = 'width:220px;height:220px;image-rendering:pixelated;border-radius:8px;display:block;margin:8px auto';
    window.__fhQrCanvas = cv;
    _fhSheet('<div class="fh-s-h">' + L('Mã QR thẻ khóa', 'Key Card QR') + '</div>'
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
      if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: L('Thẻ khóa của nhà', 'Family Key Card') }); }
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
    return '<div class="fh-s-h">' + L('Thẻ khóa của nhà mình', 'Your family’s Key Card') + '</div>'
      + '<div class="fh-s-sub">' + L('Mọi thứ nhà mình ghi lại, từ tiền nong, hình ảnh tới tên gọi, đều được khóa bằng tấm thẻ này.',
                                     'Everything your family logs, money, photos, names, is locked with this one card.') + '</div>'
      + '<div class="fh-s-sub">' + L('Máy chủ chỉ giữ bản đã khóa. Không ai mở được nếu không có thẻ, kể cả tụi mình làm ra app.',
                                     'Our server only keeps the locked copy. Without the card nobody can open it, not even us who built the app.') + '</div>'
      + '<div class="fh-s-sub">' + L('Giữ thẻ kỹ nha. Mất thẻ và mất hết điện thoại là mất luôn dữ liệu, không ai lấy lại được. Đó cũng chính là lý do không ai ngoài nhà mình đọc được.',
                                     'Keep it safe. Lose the card and all your phones and the data is gone for good, nobody can bring it back. That is exactly why nobody outside your family can read it.') + '</div>';
  }
  // Show a specific card object (post-create/regenerate) with the save actions.
  window.fhCardShow = function (card) {
    if (!card || !card.display) return;
    _fhSheet(_cardIntroCopy() + _cardActions(card) + _btn(L('Xong', 'Done'), '_closeOv()', _S.ghost));
  };
  // Show the card cached on THIS device (Settings → "Xem thẻ khóa"). If this
  // device never held the card, offer regenerate instead.
  window.fhCardShowCached = async function () {
    const disp = await _cardCacheGet(window.DB.fid);
    if (disp) { const p = FHCrypto.parseCard(disp); return window.fhCardShow(p.ok ? { display: p.display, url: FHCrypto.cardUrl(p.display) } : { display: disp, url: FHCrypto.cardUrl(disp) }); }
    _fhSheet('<div class="fh-s-h">' + L('Thẻ khóa của nhà', 'Family Key Card') + '</div>'
      + '<div class="fh-s-sub">' + L('Máy này chưa giữ bản thẻ khóa. Bạn có thể tạo lại một tấm mới (tấm cũ sẽ ngừng dùng), rồi lưu và đưa cho người nhà.',
                                     'This device doesn’t hold a copy of the card. You can make a fresh one (the old card stops working), then save and share it.') + '</div>'
      + _btn(L('Tạo lại thẻ khóa', 'Make a new card'), 'fhCardRegenerate(this)', _S.cta)
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
      window.toast && window.toast(L('Đã tạo thẻ khóa cho nhà ✓. Lưu lại và đưa cho người thân nha.', 'Your family Key Card is ready ✓. Save it and share with your family.'));
    } catch (e) {
      if (btn) { btn.disabled = false; btn.textContent = L('Nâng cấp lên thẻ khóa của nhà', 'Upgrade to a family Key Card'); }
      window.toast && window.toast(_friendly(e));
    }
  };

  /* Proactive migration intro (returning owner, no card yet) — the USP moment,
     surfaced on open instead of buried in Settings. Tapping mints + shows the
     card to save; the old 6-digit code keeps working until Phase D removes it. */
  window.fhCardMigrateIntro = function () {
    _fhSheet('<div class="fh-s-h">' + L('Nhà mình vừa có thẻ khóa riêng', 'Your family just got its own Key Card') + '</div>'
      + '<div class="fh-s-sub">' + L('Trước giờ tiền nong đã được khóa. Giờ có một tấm thẻ khóa mạnh hơn nhiều, khóa hết mọi thứ và không ai bẻ được, kể cả tụi mình.',
                                     'Your money was already locked. Now there’s a much stronger card that locks everything, one nobody can break, us included.') + '</div>'
      + '<div class="fh-s-sub">' + L('Bấm để tạo thẻ khóa của nhà rồi lưu lại. Mã 6 số cũ vẫn dùng được cho tới khi bạn gỡ.',
                                     'Tap to create your family’s card and save it. The old 6-digit code keeps working until you remove it.') + '</div>'
      + _btn(L('Tạo thẻ khóa của nhà', 'Create the family Key Card'), 'fhCardMigrate(this)', _S.cta)
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
      window.toast && window.toast(L('Đã gỡ mã 6 số. Giờ nhà mình chỉ dùng thẻ khóa.', 'Code removed. Your family now uses just the Key Card.'));
    } catch (e) {
      if (btn) { btn.disabled = false; btn.classList.remove('armed'); btn.textContent = L('Gỡ mã 6 số cũ', 'Remove the old 6-digit code'); }
      window.toast && window.toast(/no_card/i.test(String((e && e.message) || '')) ? L('Hãy tạo thẻ khóa trước khi gỡ mã.', 'Create the Key Card before removing the code.') : _friendly(e));
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
      window.toast && window.toast(L('Đã tạo thẻ khóa mới. Tấm cũ ngừng dùng.', 'New card made. The old one no longer works.'));
    } catch (e) {
      if (btn) { btn.disabled = false; btn.textContent = L('Tạo lại thẻ khóa', 'Make a new card'); }
      window.toast && window.toast(_friendly(e));
    }
  };

  // Card entry modal (the unlock prompt for a card family). Plain forgiving
  // input; validation + friendly error on submit.
  window.fhCardEnterPrompt = function () {
    _fhModal({
      title: L('Nhập thẻ khóa của nhà', 'Enter your family’s Key Card'),
      saveLabel: L('Mở khóa', 'Unlock'),
      body: '<div class="fh-s-sub">' + L('Máy này cần thẻ khóa của nhà để mở dữ liệu. Dán, quét hoặc gõ tấm thẻ vào đây.',
                                         'This device needs your family’s card to open the data. Paste, scan or type it here.') + '</div>'
        + '<div class="field"><input id="fh-card-in" placeholder="FH-XXXX-XXXX-…" autocapitalize="characters" autocomplete="off" spellcheck="false" oninput="fhModalDirty()"></div>'
        // dual-wrap fallback: while the family still has a 6-digit code, offer it
        // so nobody is ever stuck mid-migration before they've received the card
        + ((window.DB && window.DB.enc && window.DB.enc.wrapped_dek)
            ? '<div style="text-align:center;margin-top:4px"><button class="fh-s-ghost" onclick="_closeOv();fhPasscodeUnlockPrompt()">' + L('Hoặc dùng mã 6 số', 'Or use the 6-digit code') + '</button></div>'
            : ''),
      required: () => [{ el: 'fh-card-in', ok: FHCrypto.parseCard((document.getElementById('fh-card-in') || {}).value || '').ok }],
      reqMsg: L('Thẻ khóa chưa đúng, kiểm tra lại nha', 'That card doesn’t look right, check it again'),
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
      if (standalone) {
        window.__fhPendingCard = parsed.display;               // applied at the end of the next hydrate
        return;
      }
      // Browser tab (iOS Safari): the installed PWA has separate storage, so the
      // card can't ride the link in. Hand it off by copy-paste.
      const ov = document.createElement('div');
      ov.style.cssText = 'position:fixed;inset:0;z-index:9999;background:var(--canvas);color:var(--ink);display:flex;align-items:center;justify-content:center;padding:24px;font-family:inherit';
      ov.innerHTML = '<div style="max-width:420px;text-align:center">'
        + '<div style="font-size:19px;font-weight:700;margin-bottom:14px">' + L('Mở FamilyHub để nhận thẻ khóa', 'Open FamilyHub to add the card') + '</div>'
        + '<div style="color:var(--muted);line-height:1.6;margin-bottom:18px">' + L('Thêm FamilyHub vào Màn hình chính, mở app rồi dán thẻ khóa này vào.', 'Add FamilyHub to your Home Screen, open it, then paste this card in.') + '</div>'
        + '<div style="font-family:monospace;font-size:16px;letter-spacing:1px;word-break:break-all;padding:12px;border:1px solid var(--hairline);border-radius:6px;background:var(--white);margin-bottom:16px">' + _esc(parsed.display) + '</div>'
        + '<button id="fh-handoff-copy" style="background:var(--brand);color:var(--white);border:none;border-radius:9999px;padding:13px 22px;font-size:15px;font-weight:700;font-family:inherit;cursor:pointer">' + L('Sao chép thẻ khóa', 'Copy the card') + '</button>'
        + '<div><button id="fh-handoff-close" style="background:none;border:none;color:var(--muted);margin-top:14px;font-size:14px;font-family:inherit;cursor:pointer">' + L('Đóng', 'Close') + '</button></div>'
        + '</div>';
      const mount = () => {
        document.body.appendChild(ov);
        const c = document.getElementById('fh-handoff-copy');
        if (c) c.onclick = () => { try { navigator.clipboard && navigator.clipboard.writeText(parsed.display); c.textContent = L('Đã sao chép ✓', 'Copied ✓'); } catch (e) {} };
        const x = document.getElementById('fh-handoff-close'); if (x) x.onclick = () => ov.remove();
      };
      if (document.body) mount(); else document.addEventListener('DOMContentLoaded', mount);
    } catch (e) { /* a bad fragment must never break boot */ }
  })();