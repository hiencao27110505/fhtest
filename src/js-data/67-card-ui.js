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

  /* ── Deliver actions (text · link · print · save; QR = TODO, see below) ──
     TODO(card-qr): render `card.url` as a scannable QR. Needs a vendored
     encoder (repo forbids CDN); until then in-person delivery uses the link and
     the printed text. Not on the crypto/migration critical path. */
  window.fhCardCopyText = function (display) { try { navigator.clipboard && navigator.clipboard.writeText(display); window.toast && window.toast(L('Đã sao chép thẻ khóa', 'Card copied')); } catch (e) {} };
  window.fhCardCopyLink = function (url) { try { navigator.clipboard && navigator.clipboard.writeText(url); window.toast && window.toast(L('Đã sao chép link thẻ khóa', 'Card link copied')); } catch (e) {} };
  window.fhCardSaveFile = function (display) {
    try {
      const body = 'FamilyHub — Thẻ khóa của nhà / Family Key Card\n\n' + display + '\n\n'
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
  window.fhCardPrint = function (display) {
    try {
      const w = window.open('', '_blank');
      if (!w) return;
      w.document.write('<title>FamilyHub Key Card</title><body style="font-family:sans-serif;text-align:center;padding:48px">'
        + '<div style="font-size:20px;font-weight:700;margin-bottom:24px">🏠 Thẻ khóa của nhà</div>'
        + '<div style="font-size:22px;letter-spacing:2px;font-family:monospace;margin:24px 0;padding:16px;border:2px solid #333;border-radius:8px;display:inline-block">' + _esc(display) + '</div>'
        + '<p style="max-width:420px;margin:24px auto;color:#444;line-height:1.6">Đây là chìa khóa duy nhất mở dữ liệu của nhà mình. Mất thẻ và mất hết điện thoại là mất dữ liệu, không ai lấy lại được. In hai bản, giữ như giữ sổ đỏ.</p>'
        + '</body>');
      w.document.close(); w.focus(); setTimeout(() => { try { w.print(); } catch (e) {} }, 300);
    } catch (e) {}
  };
  function _cardActions(card) {
    return '<div class="fh-s-sub" style="font-family:monospace;font-size:17px;letter-spacing:1px;word-break:break-all;padding:12px;border:1px solid var(--hairline);border-radius:6px;text-align:center">' + _esc(card.display) + '</div>'
      + _btn(L('Sao chép chữ', 'Copy text'), "fhCardCopyText('" + card.display + "')", _S.line)
      + _btn(L('Sao chép link', 'Copy link'), "fhCardCopyLink('" + card.url + "')", _S.line)
      + _btn(L('Lưu file', 'Save file'), "fhCardSaveFile('" + card.display + "')", _S.line)
      + _btn(L('In thẻ', 'Print'), "fhCardPrint('" + card.display + "')", _S.line);
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
        + '<div class="field"><input id="fh-card-in" placeholder="FH-XXXX-XXXX-…" autocapitalize="characters" autocomplete="off" spellcheck="false" oninput="fhModalDirty()"></div>',
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

  /* ── #fh-key= landing (runs once at module load; FHCrypto is defined here) ──
     A card link opens the app with #fh-key=… . Grab it, EAT it from the URL
     (never leave a secret in the bar/history/share sheet), then either stash it
     for post-hydrate unlock (installed PWA) or show the iOS Safari handoff. */
  (function _fhBootCard() {
    try {
      const parsed = FHCrypto.parseKeyFragment(location.hash) || FHCrypto.parseKeyFragment(location.href);
      const hadFrag = /[#&]fh-key=/i.test(location.hash) || /[#&]fh-key=/i.test(location.href);
      if (hadFrag) { try { history.replaceState(null, '', location.pathname + location.search); } catch (e) {} }   // eat-on-arrival
      if (!parsed) return;
      const standalone = (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || window.navigator.standalone === true;
      if (standalone) {
        window.__fhPendingCard = parsed.display;               // applied at the end of the next hydrate
        return;
      }
      // Browser tab (iOS Safari): the installed PWA has separate storage, so the
      // card can't ride the link in. Hand it off by copy-paste.
      const ov = document.createElement('div');
      ov.style.cssText = 'position:fixed;inset:0;z-index:9999;background:var(--canvas,#f2eff0);display:flex;align-items:center;justify-content:center;padding:24px;font-family:inherit';
      ov.innerHTML = '<div style="max-width:420px;text-align:center">'
        + '<div style="font-size:19px;font-weight:700;margin-bottom:14px">' + L('Mở FamilyHub để nhận thẻ khóa', 'Open FamilyHub to add the card') + '</div>'
        + '<div style="color:var(--muted,#7a5a6e);line-height:1.6;margin-bottom:18px">' + L('Thêm FamilyHub vào Màn hình chính, mở app rồi dán thẻ khóa này vào.', 'Add FamilyHub to your Home Screen, open it, then paste this card in.') + '</div>'
        + '<div style="font-family:monospace;font-size:16px;letter-spacing:1px;word-break:break-all;padding:12px;border:1px solid var(--hairline,#e4dbe0);border-radius:6px;background:#fff;margin-bottom:16px">' + _esc(parsed.display) + '</div>'
        + '<button id="fh-handoff-copy" style="background:var(--brand,#ae2070);color:#fff;border:none;border-radius:9999px;padding:13px 22px;font-size:15px;font-weight:700;font-family:inherit;cursor:pointer">' + L('Sao chép thẻ khóa', 'Copy the card') + '</button>'
        + '<div><button id="fh-handoff-close" style="background:none;border:none;color:var(--muted,#7a5a6e);margin-top:14px;font-size:14px;font-family:inherit;cursor:pointer">' + L('Đóng', 'Close') + '</button></div>'
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