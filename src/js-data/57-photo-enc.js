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
  function _phResolve(url) {
    const hit = _phCache.get(url);
    if (hit) { _phCache.delete(url); _phCache.set(url, hit); return hit.p; }   // LRU refresh
    const entry = {
      u: null,
      p: (async () => {
        try {
          if (!fhKeyReady()) return null;                  // locked: placeholder stays until the post-unlock re-render
          const resp = await fetch(url);
          if (!resp.ok) return null;
          const pt = await fhDecBytes(new Uint8Array(await resp.arrayBuffer()));
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
    img.src = _PH_BLANK;                                   // no broken-image flash while we decrypt
    _phResolve(raw).then((u) => { if (u && img.getAttribute('data-fhenc') === raw) img.src = u; });
  }
  function _phSwapBg(el) {
    const st = el.getAttribute('style') || '';
    const m = st.match(/url\((["']?)([^"')]+\.enc)\1\)/);
    if (!m) return;
    const raw = m[2];
    el.setAttribute('data-fhenc', raw);
    el.style.backgroundImage = 'none';
    _phResolve(raw).then((u) => { if (u && el.getAttribute('data-fhenc') === raw) el.style.backgroundImage = 'url(' + u + ')'; });
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
