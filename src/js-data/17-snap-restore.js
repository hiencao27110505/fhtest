  /* ═══ Encrypted warm-boot snapshot (device-at-rest hardening) ═══════════════
     fh-snap holds the whole decrypted family (amounts, notes, names) so the
     app can open on real data. For a committed-enc family that plaintext must
     not sit on disk: fhSnapStore wraps the snapshot in a v3 envelope —
     AES-GCM under the cached family DEK — and this restore path unwraps it.
     Decryption is async by nature, so the encrypted warm boot is a two-step:
     the sync js-ui boot stashes the envelope (window.__fhSnapEnc) and paints
     the splash; this module then decrypts (~tens of ms), applies the same
     fhApplySnapshot the plaintext path uses, and repaints. Deliberately NOT
     top-level awaited: an auth callback interleaving into a blocked module
     would meet half-initialized state. The only cost is that the DB maps from
     the snapshot land a beat later, which the merge below handles. */
  window.fhSnapStore = async function (data) {
    try {
      if (fhEncState() === 'enc') {
        if (!fhKeyReady()) return;                       // locked: better no snapshot than a plaintext one
        const ct = await fhEnc(JSON.stringify(data));
        if (ct) localStorage.setItem('fh-snap', JSON.stringify({ v: 3, at: data.at, fid: window.DB.fid, ct: ct }));
        return;
      }
      localStorage.setItem('fh-snap', JSON.stringify(data));
    } catch (e) {}                                       // quota/private-mode: warm start is optional
  };
  (async () => {
    const rec = window.__fhSnapEnc; window.__fhSnapEnc = null;
    if (!rec || !rec.fid || !rec.ct) return;
    try {
      if (!(await fhKeyLoad(rec.fid))) return;           // no cached key on this device: cold start, unlock later
      const s = JSON.parse(await fhDec(rec.ct));
      if (!s || !s.catOrder || !s.months) return;
      if (!(window.fhApplySnapshot && window.fhApplySnapshot(s))) return;
      // the module's DB was initialized before this decrypt finished — merge the
      // snapshot maps in unless a real hydrate already replaced them
      if (window.DB && !window.DB._hydrated && s.DB) {
        const keep = { rtFid: window.DB.rtFid, fid: window.DB.fid || s.DB.fid };
        Object.assign(window.DB, s.DB, keep);
      }
      try { window.applyFam && window.applyFam(); window.applyLang && window.applyLang(); } catch (e) {}
      const ob = document.getElementById('onboarding'); if (ob) ob.classList.add('done');
      document.documentElement.classList.add('fh-warm', 'fh-stale');   // "Updating…" until fresh data lands
      try { window.setGreeting && window.setGreeting(); } catch (e) {}
      try {
        window.renderEvents && window.renderEvents();
        window.renderAll && window.renderAll();
        window.renderTxns && window.renderTxns();
        window.applyCurrency && window.applyCurrency();
      } catch (e) { console.warn('enc warm render failed', e); }
    } catch (e) {}                                       // wrong/stale envelope: the hydrate takes it from here
  })();
