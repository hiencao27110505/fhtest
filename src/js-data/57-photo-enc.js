  /* ═══ Encrypted-photo rendering (0039) ══════════════════════════════════════
     Photo bytes for committed-enc families live in the public bucket as
     AES-GCM ciphertext under '<path>.enc'. The data model keeps carrying the
     stable public URL (snapshots, pathByUrl, delete paths all stay untouched);
     THIS layer alone turns those URLs into pixels: a MutationObserver watches
     every render, and whenever a '.enc' URL lands in an <img src> or an inline
     background-image it fetches the ciphertext (the SW media cache serves it
     like any photo), decrypts with the session DEK, and swaps in a local
     object URL. Decrypted bytes exist only in memory — never in Cache API,
     IndexedDB or localStorage — and every object URL dies with the key
     (fhKeyDrop → __fhPhotoCachePurge).
     No render site knows any of this is happening, which is the point: future
     surfaces get encrypted photos for free.

     LAZY (device heat): a tile is registered with one IntersectionObserver and
     decrypted only when it comes within a viewport of the screen; at most four
     fetch+decrypt jobs run at once, queued in the order tiles appear. A tile
     that scrolls away before its turn is dropped and asks again when it is
     back. The default (viewport) root works through nested scrollers (#txn-
     scroll, modal bodies). Tiles under display:none never intersect; tiles
     under a closed full-screen .modal (visibility:hidden over the viewport) do,
     so visibility is checked and those wait for the next 'fhcover' change
     (10-nav-model.js). The object-URL LRU never revokes a URL whose tile is
     still connected and near the screen. */
  const _PH_BLANK = 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==';
  const _PH_MAX = 300;                                     // object-URL LRU cap (pinned entries do not count against it in practice)
  const _PH_PAR = 4;                                       // concurrent fetch+decrypt jobs
  const _phCache = new Map();                              // publicUrl → {p: Promise<objUrl|null>, u: objUrl|null, pending, els:Set<Element>}
  const _phHidden = new Set();                             // intersecting tiles that sat under a closed screen; re-checked on 'fhcover'
  function _phMime(url) {
    const m = String(url).match(/\.(\w+)\.enc(?:$|\?)/);
    const ext = (m && m[1] || 'jpg').toLowerCase();
    return ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : ext === 'gif' ? 'image/gif' : 'image/jpeg';
  }
  /* An entry is pinned while any tile showing it is in the document and on or
     near the screen (the observer keeps __phNear current for every tile). */
  function _phPinned(e) {
    if (!e || !e.els) return false;
    for (const el of e.els) { if (el.isConnected && el.__phNear) return true; }
    return false;
  }
  function _phAttach(e, el) {
    for (const x of e.els) { if (!x.isConnected) e.els.delete(x); }   // a re-rendered list leaves its old rows behind; do not hold them
    e.els.add(el);
  }
  function _phBlank(el) {
    el.__phDone = null;
    if (el.tagName === 'IMG') el.src = _PH_BLANK; else el.style.backgroundImage = 'none';
  }
  function _phTrim() {
    if (_phCache.size <= _PH_MAX) return;
    for (const k of Array.from(_phCache.keys())) {       // oldest first
      if (_phCache.size <= _PH_MAX) break;
      const e = _phCache.get(k);
      if (!e || e.pending || _phPinned(e)) continue;     // in flight, or still on screen: never revoke under a live tile
      _phCache.delete(k);
      if (e.u) {
        for (const el of e.els) { if (el.isConnected && el.__phDone === k) _phBlank(el); }   // a far-off tile reloads when it is back
        try { URL.revokeObjectURL(e.u) } catch (x) {}
      }
    }
  }
  /* Which key domain owns this URL. personal-media objects (0114) are sealed
     under the PERSONAL DEK; everything else keeps the family key. The branch
     lives here — no render site knows two key domains exist. */
  function _phPersonal(url) { return String(url).indexOf('/personal-media/') >= 0; }
  /* the fetch+decrypt queue: _PH_PAR jobs at a time, FIFO */
  const _phQ = []; let _phBusy = 0;
  function _phPump() {
    while (_phBusy < _PH_PAR && _phQ.length) {
      const job = _phQ.shift(); _phBusy++;
      job().then(() => { _phBusy--; _phPump(); }, () => { _phBusy--; _phPump(); });
    }
  }
  function _phEnqueue(fn) {
    return new Promise((res) => { _phQ.push(() => fn().then(res, () => res(null))); _phPump(); });
  }
  function _phResolve(url, el) {
    // Locked (in the URL's own key domain): return null WITHOUT caching, so the
    // very next attempt (after the key is entered) retries instead of being
    // pinned to this null forever.
    const personal = _phPersonal(url);
    if (personal ? !(window.fhPersonalKeyReady && fhPersonalKeyReady()) : !fhKeyReady()) return Promise.resolve(null);
    const hit = _phCache.get(url);
    if (hit) { if (el) _phAttach(hit, el); _phCache.delete(url); _phCache.set(url, hit); return hit.p; }   // LRU refresh
    const entry = { u: null, pending: true, els: new Set(), p: null };
    if (el) entry.els.add(el);
    entry.p = _phEnqueue(async () => {
      try {
        if (el && !_phPinned(entry)) { _phCache.delete(url); return null; }   // scrolled away before its turn → a later intersect asks again
        const resp = await fetch(url);
        if (!resp.ok) return null;
        const ct = new Uint8Array(await resp.arrayBuffer());
        const pt = personal ? await window.fhPersonalDecBytes(ct) : await fhDecBytes(ct);
        entry.u = URL.createObjectURL(new Blob([pt], { type: _phMime(url) }));
        return entry.u;
      } catch (e) { return null; }
      finally { entry.pending = false; }
    });
    _phCache.set(url, entry); _phTrim();
    return entry.p;
  }
  function _phPaint(el, raw, u) {
    el.__phDone = raw;
    // color:transparent hides an avatar's initials fallback, but ONLY once the
    // photo actually paints — so a locked device / failed decrypt keeps them.
    if (el.tagName === 'IMG') el.src = u; else { el.style.backgroundImage = 'url(' + u + ')'; el.style.color = 'transparent'; }
  }
  /* a closed .modal.fh-screen sits over the viewport with visibility:hidden;
     geometry says its tiles intersect, so ask the style instead where the
     browser can answer (checkVisibility: Safari 17.4+, Chrome 105+) */
  function _phVisible(el) {
    try { return el.checkVisibility ? el.checkVisibility({ visibilityProperty: true }) : true; } catch (e) { return true; }
  }
  function _phLoad(el) {
    const raw = el.getAttribute('data-fhenc'); if (!raw) return;
    if (el.__phDone === raw) return;                       // already painted this url
    if (!_phVisible(el)) { _phHidden.add(el); return; }
    _phHidden.delete(el);
    const hit = _phCache.get(raw);
    if (hit && hit.u) { _phAttach(hit, el); _phCache.delete(raw); _phCache.set(raw, hit); _phPaint(el, raw, hit.u); return; }
    _phResolve(raw, el).then((u) => { if (u && el.getAttribute('data-fhenc') === raw) _phPaint(el, raw, u); });
  }
  let _phIO = null;
  function _phIOGet() {
    if (_phIO !== null) return _phIO;
    try {
      _phIO = new IntersectionObserver((es) => {
        for (const en of es) { en.target.__phNear = en.isIntersecting; if (en.isIntersecting) _phLoad(en.target); }
      }, { rootMargin: '100% 0px' });                      // one viewport ahead and behind
    } catch (e) { _phIO = false; }
    return _phIO;
  }
  /* (re)register a tile: observe() on a target already observed is a no-op, so
     unobserve first — the fresh observe delivers the current state at once */
  function _phWatch(el) {
    const io = _phIOGet();
    if (!io) { el.__phNear = true; _phLoad(el); return; }  // no IntersectionObserver → eager, as before
    io.unobserve(el); io.observe(el);
  }
  function _phSwapImg(img) {
    const raw = img.getAttribute('src') || '';
    if (raw.indexOf('.enc') < 0 || raw.indexOf('blob:') === 0 || raw.indexOf('data:') === 0) return;
    img.setAttribute('data-fhenc', raw); img.__phDone = null;
    const hit = _phCache.get(raw);
    if (hit && hit.u) { _phAttach(hit, img); _phPaint(img, raw, hit.u); }   // already decrypted/seeded → set it, no blank
    else img.src = _PH_BLANK;                              // no broken-image flash while we wait
    _phWatch(img);                                         // always watched: the observer keeps __phNear for the LRU pin
  }
  function _phSwapBg(el) {
    const st = el.getAttribute('style') || '';
    const m = st.match(/url\((["']?)([^"')]+\.enc)\1\)/);
    if (!m) return;
    const raw = m[2];
    el.setAttribute('data-fhenc', raw); el.__phDone = null;
    const hit = _phCache.get(raw);
    if (hit && hit.u) { _phAttach(hit, el); _phPaint(el, raw, hit.u); }
    else el.style.backgroundImage = 'none';
    _phWatch(el);
  }
  function _phSweep(root) {
    if (!root || !root.querySelectorAll) return;
    if (root.matches) {
      if (root.matches('img[src*=".enc"]')) _phSwapImg(root);
      if (root.matches('[style*=".enc"]')) _phSwapBg(root);
    }
    root.querySelectorAll('img[src*=".enc"]').forEach(_phSwapImg);
    root.querySelectorAll('[style*=".enc"]').forEach(_phSwapBg);
  }
  try {
    new MutationObserver((muts) => {
      for (const mu of muts) {
        if (mu.type === 'attributes') { if (mu.target && mu.target.tagName === 'IMG') _phSwapImg(mu.target); continue; }
        mu.addedNodes && mu.addedNodes.forEach((n) => { if (n.nodeType === 1) _phSweep(n); });
      }
    }).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['src'] });
  } catch (e) { console.warn('photo observer failed', e); }
  /* a cover opened or closed: tiles that intersected under a closed screen get
     their visibility asked again (a re-observe delivers the current state) */
  document.addEventListener('fhcover', () => {
    if (!_phHidden.size) return;
    for (const el of Array.from(_phHidden)) { if (el.isConnected) _phWatch(el); else _phHidden.delete(el); }
  });
  _phSweep(document.body);                                 // anything rendered before this module loaded (warm boot)
  window.__fhPhotoCachePurge = function () {
    _phCache.forEach((e) => {
      if (e.els) { for (const el of e.els) el.__phDone = null; }
      if (e.u) { try { URL.revokeObjectURL(e.u) } catch (x) {} }
    });
    _phCache.clear(); _phQ.length = 0;
  };
  /* Seed the cache for a just-uploaded photo (plaintext bytes we already hold),
     keyed by the public .enc URL the render will use. Lets the fresh photo show
     instantly instead of blank→fetch→decrypt. */
  window.__fhPhotoSeed = function (url, bytes, mime) {
    try {
      if (!url || _phCache.get(url)) return;
      const u = URL.createObjectURL(new Blob([bytes], { type: mime || _phMime(url) }));
      _phCache.delete(url); _phCache.set(url, { u: u, p: Promise.resolve(u), pending: false, els: new Set() }); _phTrim();
    } catch (e) {}
  };
  /* Key just became available (device unlocked mid-session with the card/code):
     re-check every encrypted photo already on screen — their <img src> and
     background-image were blanked while locked and, without this, stay blank
     until the app is killed and reopened. Tiles near the screen decrypt now;
     the rest when they scroll in. Called from fhKeyAdopt. */
  window.__fhPhotoRefresh = function () {
    try {
      document.querySelectorAll('[data-fhenc]').forEach((el) => { el.__phDone = null; _phWatch(el); });
      _phSweep(document.body);   // and any still-raw .enc that never got swapped
    } catch (e) {}
  };
