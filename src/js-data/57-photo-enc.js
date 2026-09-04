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
     surfaces get encrypted photos for free. */
  const _PH_BLANK = 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==';
  const _PH_MAX = 150;                                     // object-URL LRU cap (~30-45MB of decoded images)
  const _phCache = new Map();                              // publicUrl → {p: Promise<objUrl|null>, u: objUrl|null}
  function _phMime(url) {
    const m = String(url).match(/\.(\w+)\.enc(?:$|\?)/);
    const ext = (m && m[1] || 'jpg').toLowerCase();
    return ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : ext === 'gif' ? 'image/gif' : 'image/jpeg';
  }
  function _phTrim() {
    while (_phCache.size > _PH_MAX) {
      const k = _phCache.keys().next().value;
      const e = _phCache.get(k); _phCache.delete(k);
      if (e && e.u) { try { URL.revokeObjectURL(e.u) } catch (x) {} }
    }
  }
  /* Which key domain owns this URL. personal-media objects (0114) are sealed
     under the PERSONAL DEK; everything else keeps the family key. The branch
     lives here — no render site knows two key domains exist. */
  function _phPersonal(url) { return String(url).indexOf('/personal-media/') >= 0; }
  function _phResolve(url) {
    // Locked (in the URL's own key domain): return null WITHOUT caching, so the
    // very next attempt (after the key is entered) retries instead of being
    // pinned to this null forever.
    const personal = _phPersonal(url);
    if (personal ? !(window.fhPersonalKeyReady && fhPersonalKeyReady()) : !fhKeyReady()) return Promise.resolve(null);
    const hit = _phCache.get(url);
    if (hit) { _phCache.delete(url); _phCache.set(url, hit); return hit.p; }   // LRU refresh
    const entry = {
      u: null,
      p: (async () => {
        try {
          const resp = await fetch(url);
          if (!resp.ok) return null;
          const ct = new Uint8Array(await resp.arrayBuffer());
          const pt = personal ? await window.fhPersonalDecBytes(ct) : await fhDecBytes(ct);
          entry.u = URL.createObjectURL(new Blob([pt], { type: _phMime(url) }));
          return entry.u;
        } catch (e) { return null; }
      })()
    };
    _phCache.set(url, entry); _phTrim();
    return entry.p;
  }
  function _phSwapImg(img) {
    const raw = img.getAttribute('src') || '';
    if (raw.indexOf('.enc') < 0 || raw.indexOf('blob:') === 0 || raw.indexOf('data:') === 0) return;
    img.setAttribute('data-fhenc', raw);
    const hit = _phCache.get(raw);
    if (hit && hit.u) { img.src = hit.u; return; }         // already decrypted/seeded → set it, no blank
    img.src = _PH_BLANK;                                   // no broken-image flash while we decrypt
    _phResolve(raw).then((u) => { if (u && img.getAttribute('data-fhenc') === raw) img.src = u; });
  }
  function _phSwapBg(el) {
    const st = el.getAttribute('style') || '';
    const m = st.match(/url\((["']?)([^"')]+\.enc)\1\)/);
    if (!m) return;
    const raw = m[2];
    el.setAttribute('data-fhenc', raw);
    const hit = _phCache.get(raw);
    // color:transparent hides an avatar's initials fallback, but ONLY once the
    // photo actually paints — so a locked device / failed decrypt keeps them.
    if (hit && hit.u) { el.style.backgroundImage = 'url(' + hit.u + ')'; el.style.color = 'transparent'; return; }
    el.style.backgroundImage = 'none';
    _phResolve(raw).then((u) => { if (u && el.getAttribute('data-fhenc') === raw) { el.style.backgroundImage = 'url(' + u + ')'; el.style.color = 'transparent'; } });
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
  _phSweep(document.body);                                 // anything rendered before this module loaded (warm boot)
  window.__fhPhotoCachePurge = function () {
    _phCache.forEach((e) => { if (e.u) { try { URL.revokeObjectURL(e.u) } catch (x) {} } });
    _phCache.clear();
  };
  /* Seed the cache for a just-uploaded photo (plaintext bytes we already hold),
     keyed by the public .enc URL the render will use. Lets the fresh photo show
     instantly instead of blank→fetch→decrypt. */
  window.__fhPhotoSeed = function (url, bytes, mime) {
    try {
      if (!url || _phCache.get(url)) return;
      const u = URL.createObjectURL(new Blob([bytes], { type: mime || _phMime(url) }));
      _phCache.delete(url); _phCache.set(url, { u: u, p: Promise.resolve(u) }); _phTrim();
    } catch (e) {}
  };
  /* Key just became available (device unlocked mid-session with the card/code):
     re-decrypt every encrypted photo already on screen — their <img src> and
     background-image were blanked while locked and, without this, stay blank
     until the app is killed and reopened. Called from fhKeyAdopt. */
  window.__fhPhotoRefresh = function () {
    try {
      document.querySelectorAll('[data-fhenc]').forEach((el) => {
        const raw = el.getAttribute('data-fhenc'); if (!raw) return;
        _phResolve(raw).then((u) => {
          if (!u || el.getAttribute('data-fhenc') !== raw) return;
          if (el.tagName === 'IMG') el.src = u; else { el.style.backgroundImage = 'url(' + u + ')'; el.style.color = 'transparent'; }
        });
      });
      _phSweep(document.body);   // and any still-raw .enc that never got swapped
    } catch (e) {}
  };
