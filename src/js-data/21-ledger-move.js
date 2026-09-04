  /* ═══ Cross-ledger move (0114) — docs/specs/cross-ledger-move-spec.md ═══════
     Move a logged expense between the personal and family books. A move is a
     STATE TRANSITION riding the mirror pairing, never a copy-paste:

       personal→family: insert the family row (link_id pre-set — the write-once
         trigger allows the initial set), then CONVERT the private row in place
         into the mirror master (space_id + link_id). The row keeps its id,
         created_at and account_id, so the account's anchored balance stays
         correct for free. Personal month totals never change — only the label.

       family→personal: convert my master BACK into a private row (clear
         space_id/link_id first, so no reconcile pass can tombstone it when the
         family row disappears), then delete the family row.

     Photos travel: bytes are re-encrypted from the source book's key to the
     destination's before anything is removed; ANY photo failure aborts the
     whole move (edge rule 2). Destination is written first, source removed
     last (rule 1). A local-first journal covers the crash window between the
     two halves; fhPersonalMirror calls fhLedgerMoveResume at the top of every
     pass — the one moment both ledgers are known ready (rule 3).

     The conversion here is THE one sanctioned write that adds a link to a
     personal row (rule 8); every ordinary personal writer keeps its
     `link_id is null` filter. */
  (function () {
    const _mv = () => window.sb;
    const _mvUid = () => { const p = window.fhPersonalData && fhPersonalData(); return p ? p.uid : null; };
    const _mvKey = () => 'fh-move-journal:' + (_mvUid() || '');
    function _mvJGet() { try { return JSON.parse(localStorage.getItem(_mvKey()) || 'null'); } catch (e) { return null; } }
    function _mvJSet(j) { try { localStorage.setItem(_mvKey(), JSON.stringify(j)); } catch (e) {} }
    function _mvJClear() { try { localStorage.removeItem(_mvKey()); } catch (e) {} }

    // Both keys, online, and a family to move against. The family side needs
    // its key only when encryption is on (photos + fhField both fail closed).
    function _mvGuards() {
      const p = window.fhPersonalData && fhPersonalData();
      if (!p || !p.key) return 'personal_locked';
      if (!(window.DB && DB.fid && DB.ownerMemberId)) return 'no_family';
      if (fhEncState() !== 'off' && !fhKeyReady()) return 'family_locked';
      if (navigator.onLine === false) return 'offline';
      return null;
    }
    window.fhLedgerMoveGuard = _mvGuards;

    const _extOf = (path) => ((String(path).match(/\.(\w+)\.enc$/) || [])[1] || 'jpg');
    const _mime = (ext) => ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : ext === 'gif' ? 'image/gif' : 'image/jpeg';

    /* One personal photo object → a family-media object (bytes re-encrypted
       from the personal DEK to the family's rules: ciphertext when the family
       is enc-committed, plaintext bytes otherwise — the same rule every family
       photo upload follows). Returns the new storage path or throws. */
    async function _photoP2F(fid, path) {
      const resp = await fetch(window.fhPersonalPhotoUrl(path));
      if (!resp.ok) throw new Error('photo_fetch');
      let bytes = await window.fhPersonalDecBytes(new Uint8Array(await resp.arrayBuffer()));
      const ext = _extOf(path);
      let outExt = ext, ctype = _mime(ext);
      if (fhEncState() === 'enc' && fhKeyReady()) { bytes = await fhEncBytes(bytes); outExt = ext + '.enc'; ctype = 'application/octet-stream'; }
      const np = fid + '/' + Date.now() + '_' + Math.random().toString(36).slice(2, 8) + '.' + outExt;
      const up = await _mv().storage.from('family-media').upload(np, bytes, { contentType: ctype, cacheControl: '31536000' });
      if (up.error) throw up.error;
      return np;
    }
    /* One family photo URL → a personal-media object (always ciphertext under
       the personal DEK — the personal book has no plaintext state). */
    async function _photoF2P(url) {
      const resp = await fetch(url);
      if (!resp.ok) throw new Error('photo_fetch');
      let bytes = new Uint8Array(await resp.arrayBuffer());
      if (String(url).indexOf('.enc') >= 0) bytes = await fhDecBytes(bytes);
      const m = String(url).match(/\.(\w+)(?:\.enc)?(?:$|\?)/);
      const ext = ((m && m[1]) || 'jpg') + '.enc';
      const enc = await window.fhPersonalEncBytes(bytes);
      const np = _mvUid() + '/' + Date.now() + '_' + Math.random().toString(36).slice(2, 8) + '.' + ext;
      const up = await _mv().storage.from('personal-media').upload(np, enc, { contentType: 'application/octet-stream', cacheControl: '31536000' });
      if (up.error) throw up.error;
      return np;
    }

    /* ── personal → family (spec §8.1) ──────────────────────────────────────── */
    window.fhLedgerMoveToFamily = async function (pid, opts) {
      opts = opts || {};
      const bad = _mvGuards(); if (bad) return { ok: false, error: bad };
      const p = fhPersonalData();
      const t = (p.txns || []).find((x) => x.id === pid);
      if (!t || t.spaceId || t.linkId || t.kind !== 'expense' || t._unreadable) return { ok: false, error: 'ineligible' };
      // M6: a future-dated private row would materialize as a proposal needing
      // someone's 🥰 — surprising enough to be out of scope. Realized only.
      const _now = new Date();
      const _todayIso = _now.getFullYear() + '-' + String(_now.getMonth() + 1).padStart(2, '0') + '-' + String(_now.getDate()).padStart(2, '0');
      if (t.date && t.date > _todayIso) return { ok: false, error: 'future' };
      const fid = DB.fid, me = DB.ownerMemberId;
      const payer = opts.payerMemberId || me;
      const linkId = crypto.randomUUID();
      _mvJSet({ dir: 'p2f', pid: pid, linkId: linkId, fid: fid });
      try {
        // photos first — part of the destination write; any failure aborts
        const pRows = await window.fhPersonalTxnPhotoRows(pid);
        const famPhotos = [];
        try {
          for (const r of pRows) famPhotos.push({ path: await _photoP2F(fid, r.photo_url), taken_on: r.taken_on || null });
        } catch (e) {
          try { if (famPhotos.length) await _mv().storage.from('family-media').remove(famPhotos.map((x) => x.path)); } catch (e2) {}
          _mvJClear(); return { ok: false, error: 'photos' };
        }
        // category: resolve against (or create in) the family's own set
        let catId = null;
        try { catId = await window._categoryIdForName(t.cat || window.CAT_FALLBACK, t.emoji || '🗂️', (window.catOrder || []).length + 1); } catch (e) {}
        if (!catId) catId = (DB.catByName && (DB.catByName[t.cat] || DB.catByName[window.CAT_FALLBACK])) || null;
        if (!catId) { _mvJClear(); return { ok: false, error: 'category' }; }
        // the family row, link_id pre-set (write-once trigger allows the initial set)
        const row = Object.assign(
          { family_id: fid, category_id: catId, member_id: payer, txn_date: t.date, status: 'realized',
            created_by: me, link_id: linkId, source: null },
          await fhField('amount', t.amt), await fhField('note', t.note || ''),
          await fhField('occurred_time', t.time || null));
        const ins = await _mv().from('transactions').insert(row).select('id').single();
        if (ins.error || !ins.data) {
          try { if (famPhotos.length) await _mv().storage.from('family-media').remove(famPhotos.map((x) => x.path)); } catch (e2) {}
          _mvJClear(); return { ok: false, error: 'insert' };
        }
        for (let i = 0; i < famPhotos.length; i++) {
          await _mv().from('transaction_photos').insert({ family_id: fid, transaction_id: ins.data.id, photo_url: famPhotos[i].path, sort_order: i, taken_on: famPhotos[i].taken_on });
        }
        // convert the private row in place into the mirror master (account_id survives)
        const cv = await _mv().from('personal_transactions').update({ space_id: fid, link_id: linkId, version: 1 })
          .eq('id', pid).eq('owner_user_id', p.uid).is('link_id', null);
        if (cv.error) return { ok: false, error: 'convert', pending: true };   // journal stays — resume finishes this half
        // the master is photo-less (M7): the photos live with the family row now
        try { await window.fhPersonalRemovePhotoRows(pid); } catch (e) {}
        _mvJClear();
        // a family-visible expense just appeared — nudge the household exactly
        // like a freshly-logged one (payload carries no amount, as ever)
        try { window.fhNotify && fhNotify('expense_new', { tx: ins.data.id }); } catch (e) {}
        try { window.loadFamilyData && loadFamilyData(); } catch (e) {}
        try { await window.fhPersonalHydrate(); } catch (e) {}
        try { window.fhPersonalMirrorSoon && fhPersonalMirrorSoon(); } catch (e) {}
        return { ok: true };
      } catch (e) {
        console.warn('move to family failed', e);
        return { ok: false, error: 'failed', pending: !!_mvJGet() };
      }
    };

    /* ── family → personal (spec §8.2) ──────────────────────────────────────── */
    window.fhLedgerMoveToPersonal = async function (localId, opts) {
      opts = opts || {};
      const bad = _mvGuards(); if (bad) return { ok: false, error: bad };
      const p = fhPersonalData();
      const t = (typeof txById === 'function') ? txById(localId) : null;
      if (!t || t.future || !t._dbId) return { ok: false, error: 'ineligible' };
      if (!t._createdBy || t._createdBy !== DB.ownerMemberId) return { ok: false, error: 'not_author' };   // M2: author-only
      const famId = t._dbId;
      const acctId = opts.accountId || null;
      // where is my master? (may lag if the mirror hasn't caught up)
      const lk = await _mv().from('transactions').select('link_id').eq('id', famId).single();
      if (lk.error) return { ok: false, error: 'read' };
      let pid = null;
      if (lk.data && lk.data.link_id) {
        const m = await _mv().from('personal_transactions').select('id').eq('owner_user_id', p.uid).eq('link_id', lk.data.link_id).maybeSingle();
        pid = (m.data && m.data.id) || null;
      }
      _mvJSet({ dir: 'f2p', famId: famId, pid: pid, converted: false });
      try {
        if (pid) {
          // photos onto the (still-)master row, then convert it back to private.
          // Convert BEFORE the family delete: once link_id is cleared, no
          // reconcile pass can tombstone this row when its family twin vanishes.
          // A master is photo-less by invariant (M7), so clearing first only
          // removes debris from a prior failed attempt — retries stay idempotent.
          try { await window.fhPersonalRemovePhotoRows(pid); } catch (e) {}
          try { await _f2pPhotos(t, pid); } catch (e) { _mvJClear(); return { ok: false, error: 'photos' }; }
          const cv = await _mv().from('personal_transactions')
            .update({ space_id: null, link_id: null, account_id: acctId })
            .eq('id', pid).eq('owner_user_id', p.uid);
          if (cv.error) { _mvJClear(); return { ok: false, error: 'convert' }; }
        } else {
          // mirror lag — no master yet: a fresh private row, same net effect
          const dateIso = t._d ? (t._d.getFullYear() + '-' + String(t._d.getMonth() + 1).padStart(2, '0') + '-' + String(t._d.getDate()).padStart(2, '0')) : null;
          const nid = await window.fhPersonalAddExpense(t.amt, t.note || '', t.cat || null, t.ico || '🗂️', dateIso || undefined, t.time || undefined, null, { accountId: acctId });
          if (!nid) { _mvJClear(); return { ok: false, error: 'insert' }; }
          pid = (typeof nid === 'string') ? nid : null;
          try { if (pid) await _f2pPhotos(t, pid); } catch (e) { /* row landed; photos best-effort in this rare lag path */ }
        }
        _mvJSet({ dir: 'f2p', famId: famId, pid: pid, converted: true });
        // now remove the family side: mirror event first (same order as the
        // wrapped delete — FK RESTRICT on fundings), then storage, then the row
        const mirrorId = (t.linkedEvent && window.events && events[t.linkedEvent]) ? events[t.linkedEvent]._dbId : null;
        if (mirrorId) { try { await _mv().rpc('archive_event', { p_event_id: mirrorId }); } catch (e) {} }
        await _famRowDelete(famId);
        _mvJClear();
        try { window.loadFamilyData && loadFamilyData(); } catch (e) {}
        try { await window.fhPersonalHydrate(); } catch (e) {}
        try { window.fhPersonalMirrorSoon && fhPersonalMirrorSoon(); } catch (e) {}
        return { ok: true };
      } catch (e) {
        console.warn('move to personal failed', e);
        return { ok: false, error: 'failed', pending: !!_mvJGet() };
      }
    };
    async function _f2pPhotos(t, pid) {
      const urls = (t.photos || (t.photo ? [t.photo] : [])).filter((u) => typeof u === 'string' && u.indexOf('data:') !== 0);
      for (let i = 0; i < urls.length; i++) {
        const np = await _photoF2P(urls[i]);
        // the family taken_on isn't in the local model — the capture date stays unknown
        await _mv().from('personal_transaction_photos').insert({ owner_user_id: _mvUid(), transaction_id: pid, photo_url: np, sort_order: i, taken_on: null });
      }
    }
    async function _famRowDelete(famId) {
      try {
        const phr = (await _mv().from('transaction_photos').select('photo_url').eq('transaction_id', famId)).data || [];
        const files = phr.map((r) => r.photo_url).filter((x) => x && x.indexOf('http') !== 0);
        if (files.length) await _mv().storage.from('family-media').remove(files);
      } catch (e) {}
      const del = await _mv().from('transactions').delete().eq('id', famId);
      if (del.error) throw del.error;
    }

    /* ── crash repair (spec §8.3) — idempotent, run from fhPersonalMirror ───── */
    window.fhLedgerMoveResume = async function () {
      const j = _mvJGet(); if (!j) return;
      const p = window.fhPersonalData && fhPersonalData(); if (!p || !p.key) return;
      if (j.dir === 'p2f') {
        const fam = await _mv().from('transactions').select('id').eq('link_id', j.linkId).maybeSingle();
        if (fam.error) return;                       // can't tell — try again next pass
        if (!fam.data) { _mvJClear(); return; }      // nothing committed (orphaned uploads are debris only)
        // finish the conversion (no-op when it already happened)…
        await _mv().from('personal_transactions').update({ space_id: j.fid, link_id: j.linkId, version: 1 })
          .eq('id', j.pid).eq('owner_user_id', p.uid).is('link_id', null);
        // …and remove any reconcile-minted duplicate master born in the window
        const dups = await _mv().from('personal_transactions').select('id').eq('owner_user_id', p.uid).eq('link_id', j.linkId).neq('id', j.pid);
        for (const d of (dups.data || [])) await _mv().from('personal_transactions').delete().eq('id', d.id);
        try { await window.fhPersonalRemovePhotoRows(j.pid); } catch (e) {}
        _mvJClear();
        try { await window.fhPersonalHydrate(); } catch (e) {}
      } else if (j.dir === 'f2p') {
        const fam = await _mv().from('transactions').select('id').eq('id', j.famId).maybeSingle();
        if (fam.error) return;
        if (!fam.data) { _mvJClear(); return; }      // family row already gone → move finished
        if (!j.converted) { _mvJClear(); return; }   // died before the point of no return → the user simply retries
        try { await _famRowDelete(j.famId); _mvJClear(); try { window.loadFamilyData && loadFamilyData(); } catch (e) {} } catch (e) {}
      } else { _mvJClear(); }
    };
  })();
