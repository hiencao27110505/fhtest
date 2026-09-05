  /* ═══ Personal lessons — synced, encrypted (0122) ═══════════════════════════
     docs/specs/lending-capture-spec.md §3.

     What the review screen learns from THIS person's corrections, kept in ONE
     JSON blob encrypted under the personal DEK and synced through
     personal_lessons — the personal_budgets pattern: server stores ciphertext,
     every unlocked device decrypts. Two namespaces:

       kind — "transfers to <payee> at <this size> are loans": key =
              normalized-payee|amount-band (BANDED ONLY, no bare-key fallback —
              a wrong category is cosmetic, a wrong loan INVENTS a receivable,
              so precision beats recall everywhere a debt can be minted).
              Value { who, n, t }: the counterparty name the balance uses, a
              confirmation count, and the last-confirmed timestamp.
       cat  — the category lessons 57-csv-import-review already keeps in
              localStorage (fh-csv-learned), mirrored here so a phone upgrade
              stops erasing them. localStorage stays the fast local cache and
              the offline fallback; this blob is what survives the device.

     tomb — "quên đi" tombstones. A deletion must not be resurrected by an old
     device's blob, so forgetting writes an explicit { t } marker; a lesson
     re-learned AFTER its tombstone (t newer) revives. Without this, forget is
     unreliable in a two-device life — worse than no sync.

     Merge (two devices diverge): union by key; for kind lessons the higher
     confirmation count wins (tie → newer t); tombstones apply after. Category
     lessons are plain strings — local wins, missing keys adopt the server's.

     Weaken/kill (spec Q20c): flipping a fired lesson back to Chi tiêu drops
     its count by one (at zero it dies + tombstones); the explicit "đừng gợi ý
     nữa" kills immediately. One genuine dinner-split must not erase five
     confirmed loans; a repeating mis-fire must be killable on the spot. */
  (function () {
    const _sb = () => window.sb;
    const _P = () => (window.fhPersonalData ? fhPersonalData() : null);
    let L = { kind: {}, cat: {}, tomb: {} };
    let _loaded = false, _saveSeq = 0, _saveTimer = null;

    const _now = () => Date.now();
    const _key = (s) => String(s || '');

    /* ── read side ── */
    window.fhKindLesson = function (key) {
      key = _key(key); if (!key) return null;
      const l = L.kind[key]; if (!l || !(l.n > 0)) return null;
      const tomb = L.tomb['kind|' + key];
      if (tomb && !(l.t > tomb.t)) return null;          // killed, not re-learned since
      return { who: l.who, n: l.n };
    };

    /* ── write side ── */
    window.fhKindLearn = function (key, who) {
      key = _key(key); who = String(who || '').trim();
      if (key.length < 6 || !who) return;
      const l = L.kind[key];
      if (l && l.who === who) { l.n = (l.n || 0) + 1; l.t = _now(); }
      else L.kind[key] = { who: who, n: 1, t: _now() };   // new person at this key replaces, back to n=1
      delete L.tomb['kind|' + key];                        // an explicit re-teach revives a killed lesson
      _saveSoon();
    };
    window.fhKindWeaken = function (key) {
      key = _key(key); const l = L.kind[key]; if (!l) return;
      l.n = (l.n || 1) - 1;
      if (l.n <= 0) { delete L.kind[key]; L.tomb['kind|' + key] = { t: _now() }; }
      _saveSoon();
    };
    window.fhKindKill = function (key) {
      key = _key(key); if (!key) return;
      delete L.kind[key];
      L.tomb['kind|' + key] = { t: _now() };
      _saveSoon();
    };
    /* Manual entries teach too (spec Q10): the loan sheet and the committed-row
       flip only know a NAME + display amount, so the key is built from those.
       If the typed name never matches a bank memo, the lesson simply never
       fires — harmless. Needs the js-ui key helpers (classic scripts, loaded
       before this module). */
    window.fhKindLearnManual = function (who, amountDisp) {
      if (typeof csvPatternKey !== 'function' || typeof csvAmountBand !== 'function') return;
      const k = csvPatternKey({ counterparty: who, description: '' });
      if (!k || k.length < 6) return;
      window.fhKindLearn(k + '|' + csvAmountBand(amountDisp), who);
    };

    /* ── sync ── */
    async function _pull() {
      const P = _P(); if (!P || !P.uid || !P.key) return null;
      const r = await _sb().from('personal_lessons').select('lessons_enc').eq('owner_user_id', P.uid).maybeSingle();
      if (r.error || !r.data || !r.data.lessons_enc) return r.error ? null : { kind: {}, cat: {}, tomb: {} };
      try {
        const pt = await FHCrypto.decVal(P.key, r.data.lessons_enc);
        const d = JSON.parse(pt);
        return { kind: d.kind || {}, cat: d.cat || {}, tomb: d.tomb || {} };
      } catch (e) { return null; }                        // unreadable blob: leave the server copy alone
    }
    function _mergeIn(remote) {
      let changed = false;
      for (const k in remote.tomb) {
        const mine = L.tomb[k];
        if (!mine || remote.tomb[k].t > mine.t) { L.tomb[k] = remote.tomb[k]; changed = true; }
      }
      for (const k in remote.kind) {
        const r = remote.kind[k], mine = L.kind[k];
        if (!mine || r.n > mine.n || (r.n === mine.n && r.t > mine.t)) { L.kind[k] = r; changed = true; }
      }
      for (const k in remote.cat) {
        if (L.cat[k] === undefined) { L.cat[k] = remote.cat[k]; changed = true; }
      }
      return changed;
    }
    async function _push() {
      const P = _P(); if (!P || !P.uid || !P.key) return;
      const seq = ++_saveSeq;
      const ct = await FHCrypto.encVal(P.key, JSON.stringify(L));
      if (!ct || seq !== _saveSeq) return;                // a newer save superseded this one
      const r = await _sb().from('personal_lessons').upsert(
        { owner_user_id: P.uid, lessons_enc: ct, updated_at: new Date().toISOString() },
        { onConflict: 'owner_user_id' });
      if (r.error) console.warn('personal lessons save failed', r.error);
    }
    function _saveSoon() {
      if (_saveTimer) clearTimeout(_saveTimer);
      _saveTimer = setTimeout(() => { _saveTimer = null; _push(); }, 800);
    }

    /* Pull + merge, then adopt the merged category map into 57's local store
       (and push if this device knew things the server didn't). Called before
       the review screen builds its candidates; cheap after the first time. */
    window.fhLessonsSync = async function () {
      const P = _P(); if (!P || !P.uid || !P.key) return false;
      /* Mirror the local category lessons in before comparing. */
      if (typeof window.csvLearnedExport === 'function') {
        const local = window.csvLearnedExport() || {};
        for (const k in local) if (L.cat[k] !== local[k]) L.cat[k] = local[k];
      }
      const remote = _loaded ? null : await _pull();
      let changed = false;
      if (remote) { changed = _mergeIn(remote); _loaded = true; }
      if (changed && typeof window.csvLearnedMergeIn === 'function') window.csvLearnedMergeIn(L.cat);
      _saveSoon();
      return true;
    };
    /* A category lesson just changed locally — mirror + schedule a push. */
    window.fhLessonsCatChanged = function (map) {
      L.cat = Object.assign({}, map || {});
      _saveSoon();
    };
  })();
