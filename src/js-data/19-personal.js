  /* ═══ Personal ledger — Model Y (0074) ══════════════════════════════════════
     The PERSON is the root. Personal data lives in its own owner-scoped tables
     (personal_transactions / personal_incomes) encrypted under a per-USER key
     (personal_keys), NOT in any family. The family `transactions` table is never
     touched by this module. Tables are ciphertext-only (no plaintext columns),
     so E2EE is by construction.

     Double-entry: a family transaction the user authored is mirrored here as a
     personal master (space_id = the family it flows to, link_id → the family
     copy). Reserve link_id on the family row FIRST (crash-safe), then insert the
     master; reconcile repairs/refreshes/tombstones. Idempotent by link_id. */
  (function () {
    const P = { uid: null, key: null, rawKey: null, wrap: null, txns: [], incomes: [], budget: 0, state: 'boot', mirrorRan: false };
    const _monISO = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-01'; };
    // LOCAL YYYY-MM-DD — toISOString() is UTC and would log yesterday's date when
    // capturing after midnight in UTC+7.
    const _localDate = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    window.fhPersonalData = function () { return P; };
    const _sb = () => window.sb;
    async function _uid() { try { const s = await _sb().auth.getSession(); return s.data.session ? s.data.session.user.id : null; } catch (e) { return null; } }

    /* fh-keys IDB (shared store, keyPath 'fid'); personal key stored under 'p:'+uid */
    function _kOpen() {
      return new Promise((res, rej) => { let rq; try { rq = indexedDB.open('fh-keys', 1); } catch (e) { return rej(e); }
        rq.onupgradeneeded = () => { const db = rq.result; if (!db.objectStoreNames.contains('k')) db.createObjectStore('k', { keyPath: 'fid' }); };
        rq.onsuccess = () => res(rq.result); rq.onerror = () => rej(rq.error); });
    }
    async function _kPut(id, key) { try { const db = await _kOpen(); await new Promise((res, rej) => { const tx = db.transaction('k', 'readwrite'); tx.objectStore('k').put({ fid: id, key: key, at: Date.now() }); tx.oncomplete = () => res(1); tx.onerror = () => rej(tx.error); }); } catch (e) {} }
    async function _kGet(id) { try { const db = await _kOpen(); return await new Promise((res) => { const tx = db.transaction('k', 'readonly'); const rq = tx.objectStore('k').get(id); rq.onsuccess = () => res(rq.result || null); rq.onerror = () => res(null); }); } catch (e) { return null; } }

    // Cache the personal card DISPLAY on this device so Settings → "Mã hoá tài
    // chính" can show it later (parity with the family card cache). Same
    // exposure as the family card: plaintext on the owner's own device only.
    const _pcardKey = () => 'fh-pcard:' + (P.uid || '');
    function _pcardCache(disp) { try { if (disp) localStorage.setItem(_pcardKey(), disp); } catch (e) {} }
    window.fhPersonalCardCached = function () { try { return localStorage.getItem(_pcardKey()); } catch (e) { return null; } };

    const _encP = (v) => FHCrypto.encVal(P.key, v);
    const _decP = async (b64) => { try { return b64 ? await FHCrypto.decVal(P.key, b64) : null; } catch (e) { return null; } };
    function _setState(s) { P.state = s; try { if (window.renderPersonal) renderPersonal(); } catch (e) {} }
    function _winFrom() { const d = new Date(); d.setMonth(d.getMonth() - 1); d.setDate(1); return _localDate(d); }

    let _booting = false;
    window.fhPersonalBoot = async function () {
      if (_booting || !_sb()) return; _booting = true;
      try {
        P.uid = await _uid(); if (!P.uid) { _setState('error'); return; }
        const kc = await _kGet('p:' + P.uid);
        if (kc && kc.key) { P.key = kc.key; await _afterKey(); return; }
        const wr = await _sb().from('personal_keys').select('kdf_salt,kdf_iters,kdf_version,wrapped_dek').eq('user_id', P.uid).maybeSingle();
        if (wr.data) { P.wrap = wr.data; _setState('locked'); }
        else { await _provision(); }
      } catch (e) { console.warn('fhPersonalBoot failed', e); _setState('error'); }
      finally { _booting = false; }
    };

    async function _provision() {
      _setState('provisioning');
      const card = FHCrypto.genCard(), salt = FHCrypto.genSaltHex();
      const keys = await FHCrypto.deriveKeys(card.key, salt, window.FH_KDF_ITERS_CARD, 1);
      const dekRaw = await FHCrypto.genDekRaw();
      const wrapped = await FHCrypto.wrapDek(dekRaw, keys.kWrap);
      const r = await _sb().rpc('init_personal_key', { p_kdf_salt: salt, p_kdf_iters: window.FH_KDF_ITERS_CARD, p_kdf_version: 1, p_wrapped_dek: wrapped });
      if (r.error) { console.warn('init_personal_key failed', r.error); _setState('error'); return; }
      P.key = await FHCrypto.importDek(dekRaw);
      P.rawKey = new Uint8Array(dekRaw);              // in-memory only (never persisted) — enables card regen this session
      await _kPut('p:' + P.uid, P.key);
      window.__fhPersonalCard = card;                 // the one secret to protect — shown once
      _pcardCache(card.display);                       // …and viewable later in Settings
      try { if (window.fhPCardIntro) fhPCardIntro(); } catch (e) {}
      await _afterKey();
    }

    window.fhPersonalUnlock = async function (input) {
      const p = FHCrypto.parseCard(input); if (!p.ok) return { ok: false, error: p.error };
      if (!P.wrap) { const wr = await _sb().from('personal_keys').select('kdf_salt,kdf_iters,kdf_version,wrapped_dek').eq('user_id', P.uid).maybeSingle(); P.wrap = wr.data || null; }
      if (!P.wrap) return { ok: false, error: 'no_wrap' };
      try {
        const keys = await FHCrypto.deriveKeys(p.key, P.wrap.kdf_salt, P.wrap.kdf_iters, P.wrap.kdf_version);
        const raw = await FHCrypto.unwrapDek(P.wrap.wrapped_dek, keys.kWrap);
        P.key = await FHCrypto.importDek(raw);
        P.rawKey = new Uint8Array(raw);
        await _kPut('p:' + P.uid, P.key);
        _pcardCache(p.display);                         // remember the entered card so it's viewable in Settings
        await _afterKey();
        return { ok: true };
      } catch (e) { return { ok: false, error: 'wrong_card' }; }
    };

    async function _afterKey() { await window.fhPersonalHydrate(); _mirrorSoon(); }

    window.fhPersonalHydrate = async function () {
      if (!P.uid || !P.key) return;
      _setState('loading');
      try {
        const from = _winFrom();
        const [tr, ir, bd] = await Promise.all([
          _sb().from('personal_transactions').select('id,amount_enc,note_enc,cat_name_enc,cat_emoji,txn_date,kind,space_id,link_id,version,updated_at,created_at').eq('owner_user_id', P.uid).gte('txn_date', from).order('txn_date', { ascending: false }),
          _sb().from('personal_incomes').select('id,amount_enc,note_enc,income_date').eq('owner_user_id', P.uid).gte('income_date', from),
          _sb().from('personal_budgets').select('total_enc').eq('owner_user_id', P.uid).eq('month', _monISO()).maybeSingle(),
        ]);
        P.budget = (bd && bd.data) ? Number(await _decP(bd.data.total_enc)) || 0 : 0;
        P.txns = [];
        for (const t of (tr.data || [])) P.txns.push({ id: t.id, date: t.txn_date, kind: t.kind, spaceId: t.space_id, linkId: t.link_id, version: t.version || 1, updatedAt: t.updated_at, ts: t.created_at, amt: Number(await _decP(t.amount_enc)), note: await _decP(t.note_enc), cat: await _decP(t.cat_name_enc), emoji: t.cat_emoji });
        P.incomes = [];
        for (const i of (ir.data || [])) P.incomes.push({ id: i.id, date: i.income_date, amt: Number(await _decP(i.amount_enc)), note: await _decP(i.note_enc) });
        _setState('ready');
      } catch (e) { console.warn('personal hydrate failed', e); _setState('error'); }
    };

    /* writes — private (space-less) rows */
    window.fhPersonalAddExpense = async function (amt, note, catName, catEmoji, dateIso) {
      if (!P.uid || !P.key) return false;
      const row = { owner_user_id: P.uid, txn_date: dateIso || _localDate(new Date()), kind: 'expense', space_id: null, link_id: null,
        amount_enc: await _encP(Number(amt)), note_enc: note ? await _encP(note) : null, cat_name_enc: catName ? await _encP(catName) : null, cat_emoji: catEmoji || null };
      const r = await _sb().from('personal_transactions').insert(row);
      if (r.error) { console.warn('personal expense failed', r.error); return false; }
      await window.fhPersonalHydrate(); return true;
    };
    window.fhPersonalSetBudget = async function (amt) {
      if (!P.uid || !P.key) return false;
      const r = await _sb().from('personal_budgets').upsert(
        { owner_user_id: P.uid, month: _monISO(), total_enc: await _encP(Number(amt)), updated_at: new Date().toISOString() },
        { onConflict: 'owner_user_id,month' });
      if (r.error) { console.warn('personal budget failed', r.error); return false; }
      await window.fhPersonalHydrate(); return true;
    };
    window.fhPersonalAddIncome = async function (amt, note) {
      if (!P.uid || !P.key) return false;
      const row = { owner_user_id: P.uid, income_date: _localDate(new Date()),
        amount_enc: await _encP(Number(amt)), note_enc: note ? await _encP(note) : null };
      const r = await _sb().from('personal_incomes').insert(row);
      if (r.error) { console.warn('personal income failed', r.error); return false; }
      await window.fhPersonalHydrate(); return true;
    };

    /* mirror — active family, my authored realized expenses → personal masters */
    let _mirrorTries = 0, _mirroring = false, _debounce = null;
    function _mirrorSoon(ms) { setTimeout(() => { window.fhPersonalMirror(); }, ms || 1200); }
    window.fhPersonalMirrorSoon = function () { _mirrorTries = 0; if (_debounce) clearTimeout(_debounce); _debounce = setTimeout(() => { _debounce = null; window.fhPersonalMirror(); }, 1500); };

    window.fhPersonalMirror = async function () {
      if (_mirroring) return;
      if (!P.uid || !P.key) return;
      const fid = window.DB && DB.fid, myMem = window.DB && DB.ownerMemberId;
      if (!fid || !myMem || !window.fhKeyReady || !fhKeyReady()) { if (_mirrorTries++ < 5) _mirrorSoon(4000); return; }
      _mirroring = true;
      try {
        const fc = await _sb().from('categories').select('id,name,name_enc,emoji').eq('family_id', fid).is('archived_at', null);
        const famCat = {}; for (const c of (fc.data || [])) famCat[c.id] = { name: c.name != null ? c.name : await fhDecStr(c.name_enc), emoji: c.emoji };
        const from = _winFrom();

        const un = await _sb().from('transactions').select('id,txn_date,category_id,amount,amount_enc,note,note_enc').eq('family_id', fid).eq('created_by', myMem).eq('status', 'realized').eq('kind', 'expense').is('link_id', null).gte('txn_date', from).limit(100);
        for (const rr of (un.data || [])) {
          const amtS = rr.amount != null ? String(rr.amount) : await fhDecStr(rr.amount_enc);
          if (amtS == null || amtS === '') continue;
          const amt = Number(amtS); if (!isFinite(amt)) continue;
          const note = rr.note != null ? rr.note : await fhDecStr(rr.note_enc);
          const fc2 = (rr.category_id && famCat[rr.category_id]) || {};
          const linkId = crypto.randomUUID();
          const u = await _sb().from('transactions').update({ link_id: linkId }).eq('id', rr.id).is('link_id', null).select('id');
          if (u.error || !u.data || u.data.length !== 1) continue;
          await _insertMaster(linkId, fid, rr.txn_date, amt, note, fc2.name, fc2.emoji);
        }

        const ln = await _sb().from('transactions').select('id,link_id,txn_date,category_id,amount,amount_enc,note,note_enc,updated_at').eq('family_id', fid).eq('created_by', myMem).not('link_id', 'is', null).gte('txn_date', from).limit(400);
        const famBy = {}; (ln.data || []).forEach((r) => { famBy[r.link_id] = r; });
        const mq = await _sb().from('personal_transactions').select('id,link_id,txn_date,amount_enc,note_enc,updated_at,version,created_at').eq('owner_user_id', P.uid).eq('space_id', fid).not('link_id', 'is', null).gte('txn_date', from).order('created_at');
        const mastersBy = {};
        for (const r of (mq.data || [])) {
          if (mastersBy[r.link_id]) { await _sb().from('personal_transactions').delete().eq('id', r.id); continue; }   // self-heal dup
          mastersBy[r.link_id] = { id: r.id, updatedAt: r.updated_at, version: r.version || 1, amt: Number(await _decP(r.amount_enc)), note: await _decP(r.note_enc) };
        }
        for (const lid of Object.keys(famBy)) {
          const f = famBy[lid], m = mastersBy[lid];
          const amtS = f.amount != null ? String(f.amount) : await fhDecStr(f.amount_enc);
          if (amtS == null || amtS === '') continue;
          const amt = Number(amtS); if (!isFinite(amt)) continue;
          const note = f.note != null ? f.note : await fhDecStr(f.note_enc);
          const fc2 = (f.category_id && famCat[f.category_id]) || {};
          if (!m) { await _insertMaster(lid, fid, f.txn_date, amt, note, fc2.name, fc2.emoji); }
          else if (f.updated_at > m.updatedAt && (amt !== m.amt || (note || '') !== (m.note || ''))) {
            await _sb().from('personal_transactions').update({ amount_enc: await _encP(amt), note_enc: note ? await _encP(note) : null, cat_name_enc: fc2.name ? await _encP(fc2.name) : null, cat_emoji: fc2.emoji || null, txn_date: f.txn_date, version: (m.version || 1) + 1 }).eq('id', m.id);
          }
        }
        for (const lid of Object.keys(mastersBy)) { if (!famBy[lid]) await _sb().from('personal_transactions').delete().eq('id', mastersBy[lid].id); }   // tombstone
        P.mirrorRan = true;
        await window.fhPersonalHydrate();
      } catch (e) { console.warn('personal mirror failed', e); if (_mirrorTries++ < 5) _mirrorSoon(6000); }
      finally { _mirroring = false; }
    };

    /* Recover a lost personal card: mint a NEW card + DEK, re-encrypt every
       personal row from the cached (decrypt-capable) key to the new key, then
       swap the wrap. Works from a cold-boot cached DEK (which can decrypt but not
       export raw). Resumable: a field already under the new key is left as-is, so
       a re-run after an interruption completes cleanly. Wrap is swapped LAST, so
       until it succeeds the old key still opens everything. */
    let _regenning = false;
    window.fhPersonalRegen = async function (onProgress) {
      if (_regenning) return { ok: false, error: 'busy' };
      if (!P.uid || !P.key) return { ok: false, error: 'locked' };
      _regenning = true;
      try {
        const card = FHCrypto.genCard(), salt = FHCrypto.genSaltHex();
        const keys = await FHCrypto.deriveKeys(card.key, salt, window.FH_KDF_ITERS_CARD, 1);
        const newRaw = await FHCrypto.genDekRaw();
        const newWrapped = await FHCrypto.wrapDek(newRaw, keys.kWrap);
        const newKey = await FHCrypto.importDek(newRaw);
        const reEnc = async (b64) => {
          if (!b64) return null;
          try { await FHCrypto.decVal(newKey, b64); return b64; } catch (e) {}   // already migrated → keep
          const pt = await FHCrypto.decVal(P.key, b64); return FHCrypto.encVal(newKey, pt);
        };
        const tr = await _sb().from('personal_transactions').select('id,amount_enc,note_enc,cat_name_enc').eq('owner_user_id', P.uid);
        const inc = await _sb().from('personal_incomes').select('id,amount_enc,note_enc').eq('owner_user_id', P.uid);
        const tot = (tr.data || []).length + (inc.data || []).length; let n = 0;
        for (const r of (tr.data || [])) {
          const u = await _sb().from('personal_transactions').update({ amount_enc: await reEnc(r.amount_enc), note_enc: await reEnc(r.note_enc), cat_name_enc: await reEnc(r.cat_name_enc) }).eq('id', r.id);
          if (u.error) throw u.error; n++; if (onProgress) onProgress(n, tot);
        }
        for (const r of (inc.data || [])) {
          const u = await _sb().from('personal_incomes').update({ amount_enc: await reEnc(r.amount_enc), note_enc: await reEnc(r.note_enc) }).eq('id', r.id);
          if (u.error) throw u.error; n++; if (onProgress) onProgress(n, tot);
        }
        const rr = await _sb().rpc('rotate_personal_key', { p_kdf_salt: salt, p_kdf_iters: window.FH_KDF_ITERS_CARD, p_kdf_version: 1, p_wrapped_dek: newWrapped });
        if (rr.error) throw rr.error;
        P.key = newKey; P.rawKey = new Uint8Array(newRaw); P.wrap = null;
        await _kPut('p:' + P.uid, newKey); _pcardCache(card.display); window.__fhPersonalCard = card;
        await window.fhPersonalHydrate();
        return { ok: true, card: card };
      } catch (e) { console.warn('personal regen failed', e); return { ok: false, error: 'failed' }; }
      finally { _regenning = false; }
    };

    async function _insertMaster(linkId, fid, dateIso, amt, note, catName, catEmoji) {
      return _sb().from('personal_transactions').insert({ owner_user_id: P.uid, space_id: fid, link_id: linkId, txn_date: dateIso, kind: 'expense', version: 1,
        amount_enc: await _encP(amt), note_enc: note ? await _encP(note) : null, cat_name_enc: catName ? await _encP(catName) : null, cat_emoji: catEmoji || null });
    }
  })();
