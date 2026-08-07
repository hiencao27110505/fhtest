  /* ═══ Warm-boot snapshot storage (localStorage → IndexedDB spill) ═══════════
     fh-snap holds the whole decrypted family (amounts, notes, names) so the app
     can open on real data. Two storage tiers:

       • SMALL + plaintext → localStorage key 'fh-snap' (a JSON object). The
         pre-paint gate sees it and the js-ui boot restores it SYNCHRONOUSLY, so a
         returning user opens straight onto real data with no splash. This is the
         common case and its instant paint is preserved exactly.

       • LARGE plaintext, or ANY committed-enc family → IndexedDB (store 'snap',
         key 'current'), with a tiny 'fh-snap-idb' marker left in localStorage so
         the gate/boot know a snapshot exists. Restore is async (IDB read, plus an
         AES-GCM decrypt for enc), so a brief splash covers the read — the same UX
         encrypted families already had. Spilling to IDB avoids the ~5MB
         localStorage quota cliff (which would otherwise silently kill warm boot for
         a heavy multi-year family) and the main-thread cost of parsing a big JSON.

     For a committed-enc family the on-disk bytes are a v3 envelope (AES-GCM under
     the cached DEK) — plaintext family data never touches disk. Migration is
     automatic: a legacy 'fh-snap' (plaintext v2, or a v3 enc envelope) still
     restores, and the next save rewrites it into the right tier. */
  const _SNAP_LS_MAX = 1200000;                            // chars; well under the localStorage budget shared with fh-fam/etc.
  const _SNAP_DB = 'fh-snap', _SNAP_STORE = 'snap', _SNAP_KEY = 'current';

  function _snapIdbOpen() {
    return new Promise((res, rej) => {
      let rq; try { rq = indexedDB.open(_SNAP_DB, 1); } catch (e) { return rej(e); }
      rq.onupgradeneeded = () => { const db = rq.result; if (!db.objectStoreNames.contains(_SNAP_STORE)) db.createObjectStore(_SNAP_STORE); };
      rq.onsuccess = () => res(rq.result); rq.onerror = () => rej(rq.error);
    });
  }
  async function _snapIdbPut(val) { const db = await _snapIdbOpen(); return new Promise((res, rej) => { const tx = db.transaction(_SNAP_STORE, 'readwrite'); tx.objectStore(_SNAP_STORE).put(val, _SNAP_KEY); tx.oncomplete = () => res(true); tx.onerror = () => rej(tx.error); }); }
  async function _snapIdbGet() { try { const db = await _snapIdbOpen(); return await new Promise((res) => { const tx = db.transaction(_SNAP_STORE, 'readonly'); const rq = tx.objectStore(_SNAP_STORE).get(_SNAP_KEY); rq.onsuccess = () => res(rq.result || null); rq.onerror = () => res(null); }); } catch (e) { return null; } }
  async function _snapIdbDel() { try { const db = await _snapIdbOpen(); return await new Promise((res) => { const tx = db.transaction(_SNAP_STORE, 'readwrite'); tx.objectStore(_SNAP_STORE).delete(_SNAP_KEY); tx.oncomplete = () => res(true); tx.onerror = () => res(false); }); } catch (e) { return false; } }

  window.fhSnapStore = async function (data) {
    try {
      const enc = fhEncState() === 'enc';
      if (enc && !fhKeyReady()) return;                    // locked: better no snapshot than a plaintext one
      let payload, isEnc = false;
      if (enc) {
        const ct = await fhEnc(JSON.stringify(data)); if (!ct) return;
        payload = { v: 3, at: data.at, fid: window.DB.fid, ct: ct }; isEnc = true;
      } else {
        payload = data;
      }
      // Plaintext + small enough → keep it in localStorage for a SYNC (no-splash) warm boot.
      if (!isEnc) {
        const str = JSON.stringify(payload);
        if (str.length <= _SNAP_LS_MAX) {
          try { localStorage.setItem('fh-snap', str); localStorage.removeItem('fh-snap-idb'); _snapIdbDel(); return; }
          catch (e) { /* quota exceeded → fall through to IndexedDB */ }
        }
      }
      // Large plaintext, encrypted, or localStorage full → IndexedDB + a tiny marker.
      try {
        await _snapIdbPut(payload);
        localStorage.setItem('fh-snap-idb', JSON.stringify({ v: 4, at: data.at, fid: window.DB.fid, enc: isEnc ? 1 : 0 }));
        localStorage.removeItem('fh-snap');
      } catch (e) { }
    } catch (e) { }                                        // quota/private-mode/no-key: warm start is optional
  };

  // Wipe every snapshot copy (both localStorage keys + the IndexedDB store). Called on
  // sign-out and leave-family so no decrypted family data is left behind on a shared
  // device — the plain localStorage.removeItem('fh-snap') the callers used to do would
  // miss the IndexedDB tier entirely.
  window.fhSnapClear = async function () {
    try { localStorage.removeItem('fh-snap'); localStorage.removeItem('fh-snap-idb'); } catch (e) { }
    try { await _snapIdbDel(); } catch (e) { }
  };

  /* Async warm restore — handles both the legacy in-localStorage enc envelope
     (window.__fhSnapEnc, stashed by the sync boot) and the IndexedDB tier
     (window.__fhSnapIdb marker). Deliberately NOT top-level awaited: an auth
     callback interleaving into a blocked module would meet half-initialized state.
     The DB maps land a beat after the js-ui boot initialized window.DB, so we merge
     them in unless a real hydrate already replaced them. */
  async function _snapAsyncRestore() {
    try {
      let payload = null;
      if (window.__fhSnapEnc) { payload = window.__fhSnapEnc; window.__fhSnapEnc = null; }   // legacy: enc envelope was in localStorage
      else if (window.__fhSnapIdb) { window.__fhSnapIdb = null; payload = await _snapIdbGet(); }
      if (!payload) return;

      let s = null;
      if (payload.v === 3 && payload.ct) {                 // encrypted envelope → unwrap
        if (!payload.fid || !(await fhKeyLoad(payload.fid))) return;   // no cached key on this device: cold start, unlock later
        s = JSON.parse(await fhDec(payload.ct));
      } else {
        s = payload;                                       // plaintext object spilled to IndexedDB
      }
      if (!s || !s.catOrder || !s.months) return;
      if (!(window.fhApplySnapshot && window.fhApplySnapshot(s))) return;
      if (window.DB && !window.DB._hydrated && s.DB) {
        const keep = { rtFid: window.DB.rtFid, fid: window.DB.fid || s.DB.fid };
        Object.assign(window.DB, s.DB, keep);
      }
      try { window.applyFam && window.applyFam(); window.applyLang && window.applyLang(); } catch (e) { }
      const ob = document.getElementById('onboarding'); if (ob) ob.classList.add('done');
      document.documentElement.classList.add('fh-warm', 'fh-stale');   // "Updating…" until fresh data lands
      try { window.setGreeting && window.setGreeting(); } catch (e) { }
      try {
        window.renderEvents && window.renderEvents();
        window.renderAll && window.renderAll();
        window.renderTxns && window.renderTxns();
        window.applyCurrency && window.applyCurrency();
      } catch (e) { console.warn('warm render failed', e); }
    } catch (e) { }                                        // wrong/stale/absent snapshot: the hydrate takes it from here
  }
  _snapAsyncRestore();