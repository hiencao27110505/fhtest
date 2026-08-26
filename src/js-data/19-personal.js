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
    const P = { uid: null, key: null, rawKey: null, wrap: null, txns: [], incomes: [], budget: 0, catBudget: {}, state: 'boot', mirrorRan: false };
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

    /* null means "nothing was stored"; _DEC_FAILED means "something WAS stored
       and we could not read it". Collapsing the two is how an unreadable row
       became a 0đ row: decVal threw, the catch returned null, Number(null) is 0,
       and `s + (t.amt || 0)` folded it into the month's total. A wrong key or a
       half-finished rotation therefore UNDERSTATED spending, silently, while the
       tab still reported itself ready.

       The staged review screen already takes the opposite position — a row that
       cannot be opened is exactly the case a person needs told (72-txn-review).
       This brings the personal ledger in line with it. */
    const _DEC_FAILED = '\u0000fh-dec-failed';
    const _decP = async (b64) => {
      if (!b64) return null;
      try { return await FHCrypto.decVal(P.key, b64); } catch (e) { return _DEC_FAILED; }
    };
    const _decTxt = async (b64) => { const v = await _decP(b64); return v === _DEC_FAILED ? null : v; };
    /* The bank-email review screen offers "Ghi vào đâu? — Cá nhân", and that chip
       is disabled while this ledger has no key. fhPersonalBoot is fired from
       hydrate and NOT awaited, so a queue opened in the window before the key
       resolves showed the chip locked and then never corrected itself: nothing
       re-rendered that screen, and the only way out was closing the sheet.

       So the state change tells it too. Guarded on the staged review actually
       being on screen, because re-rendering a file import from here would throw
       away an in-progress edit. */
    function _setState(s) {
      P.state = s;
      try { if (window.renderPersonal) renderPersonal(); } catch (e) {}
      try {
        if (window.csvStagedMode && window.csvReview && window.renderCsvReview) window.renderCsvReview();
      } catch (e) {}
    }
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

    /* ── the personal STAGING keypair (0091) ─────────────────────────────────
       Distinct from P.key, and the distinction is the whole point. P.key is the
       personal DEK: it encrypts what this device writes. The staging pair is
       what a SERVER-SIDE writer seals to — the mailbox worker holds the public
       half and can never read back what it wrote. Same construction the family
       has, one level down.

       Wrapped by the personal DEK and NEVER by a family DEK. A family-wrapped
       copy "for convenience" would quietly make personal money readable by the
       household again, which is the thing the personal ledger exists to prevent.

       FIRST WRITER WINS, server-side: `set_personal_staging_key` writes only
       while staging_pub is null and returns whatever is authoritative. Two
       devices unlocking at once must not mint two keypairs, because the second
       orphans every box sealed to the first — and there is no way to tell that
       has happened except that rows stop opening. Adopt the winner; never retry
       with a fresh pair. Rotation is a separate, deliberate ceremony. */
    let _pStagingCache = null;
    window.fhPersonalStagingKeysForget = function () { _pStagingCache = null; };

    async function _pStagingKeys() {
      if (_pStagingCache) return _pStagingCache;
      const r = await _sb().rpc('get_personal_staging_key', {});
      if (r.error) throw r.error;
      _pStagingCache = r.data;
      return _pStagingCache;
    }

    /* Provision if absent. MUST run with the personal DEK present — that is the
       only moment the private half can be wrapped. Returns true only if we were
       the device that minted it. */
    window.fhPersonalStagingEnsure = async function () {
      if (!P.key || !window.nacl) return false;          // locked, or vendor script blocked
      const keys = await _pStagingKeys();
      if (keys && keys.staging_pub) return false;        // already provisioned

      const kp = window.nacl.box.keyPair();              // browser CSPRNG
      const wrapped = await _encP(_pB64(kp.secretKey));
      if (!wrapped) throw new Error('personal_staging_wrap_failed');

      const r = await _sb().rpc('set_personal_staging_key', {
        p_pub: _pB64(kp.publicKey), p_priv_enc: wrapped,
      });
      for (let i = 0; i < kp.secretKey.length; i++) kp.secretKey[i] = 0;
      if (r.error) throw r.error;
      _pStagingCache = r.data;
      return true;
    };

    /* The private half, unwrapped with the personal DEK. Requires the personal
       safe to be open — the family DEK is no help here and must not be tried. */
    window.fhPersonalStagingPrivKey = async function () {
      if (!P.key) throw new Error('personal_locked');
      const keys = await _pStagingKeys();
      if (!keys || !keys.staging_priv_enc) throw new Error('personal_staging_missing');
      const b64 = await _decTxt(keys.staging_priv_enc);
      if (!b64) throw new Error('personal_staging_unwrap_failed');
      return _pBytes(b64);
    };

    /* Same key-substitution detector the family side runs: re-derive the public
       key from our own private key and compare with the server's copy. An
       operator who swapped the stored key cannot produce a value derived from a
       secret they never held. */
    window.fhPersonalStagingVerify = async function () {
      const keys = await _pStagingKeys();
      if (!keys || !keys.staging_pub) return true;       // nothing provisioned yet
      const priv = await window.fhPersonalStagingPrivKey();
      const derived = _pB64(window.nacl.box.keyPair.fromSecretKey(priv).publicKey);
      for (let i = 0; i < priv.length; i++) priv[i] = 0;
      return derived === keys.staging_pub;
    };

    function _pB64(bytes) {
      let s = '';
      for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
      return btoa(s);
    }
    function _pBytes(b64) {
      const bin = atob(b64), out = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
      return out;
    }

    async function _afterKey() {
      await window.fhPersonalHydrate();
      _mirrorSoon();
      /* Fire-and-forget, after the data the person is waiting for. A staging
         keypair they do not have yet only costs them latency on mail that has
         not arrived; failing hydrate over it would cost them their ledger. */
      try { await window.fhPersonalStagingEnsure(); } catch (e) { window.fhLogErr && window.fhLogErr('personal_staging_ensure', e); }
    }

    window.fhPersonalHydrate = async function () {
      if (!P.uid || !P.key) return;
      _setState('loading');
      try {
        const from = _winFrom();
        const [tr, ir, bd] = await Promise.all([
          _sb().from('personal_transactions').select('id,amount_enc,note_enc,cat_name_enc,cat_emoji,occurred_time_enc,txn_date,kind,space_id,link_id,version,updated_at,created_at').eq('owner_user_id', P.uid).gte('txn_date', from).order('txn_date', { ascending: false }),
          _sb().from('personal_incomes').select('id,amount_enc,note_enc,income_date').eq('owner_user_id', P.uid).gte('income_date', from),
          _sb().from('personal_budgets').select('total_enc,cats_enc').eq('owner_user_id', P.uid).eq('month', _monISO()).maybeSingle(),
        ]);
        /* Their budget read goes through _decP too, so an unreadable budget must
           not become a number either — the sentinel is a string and Number() of
           it is NaN. Explicit rather than relying on `|| 0` to absorb it. */
        const _bRaw = (bd && bd.data) ? await _decP(bd.data.total_enc) : null;
        P.budget = (_bRaw == null || _bRaw === _DEC_FAILED) ? 0 : (Number(_bRaw) || 0);
        /* Per-category budgets (0090): an encrypted JSON map { name: amount }.
           Same fail-closed stance — an unreadable map becomes {}, never a partial. */
        const _cRaw = (bd && bd.data && bd.data.cats_enc) ? await _decP(bd.data.cats_enc) : null;
        P.catBudget = {};
        if (_cRaw != null && _cRaw !== _DEC_FAILED) {
          try { const m = JSON.parse(_cRaw); if (m && typeof m === 'object') for (const k in m) P.catBudget[k] = Number(m[k]) || 0; } catch (e) {}
        }
        /* Unreadable is a property of the AMOUNT only. A note or category that
           will not open costs a label; an amount that will not open corrupts
           money, so only that one takes the row out of every total. */
        P.txns = []; P.unreadable = 0;
        for (const t of (tr.data || [])) {
          const a = await _decP(t.amount_enc), bad = (a === _DEC_FAILED);
          if (bad) P.unreadable++;
          P.txns.push({ id: t.id, date: t.txn_date, kind: t.kind, spaceId: t.space_id, linkId: t.link_id,
            version: t.version || 1, updatedAt: t.updated_at, ts: t.created_at,
            amt: bad ? null : Number(a), _unreadable: bad,
            note: await _decTxt(t.note_enc), cat: await _decTxt(t.cat_name_enc), emoji: t.cat_emoji,
            time: await _decTxt(t.occurred_time_enc) });   // local "HH:MM" if the time was known, else null (day-only)
        }
        P.incomes = [];
        for (const i of (ir.data || [])) {
          const a = await _decP(i.amount_enc), bad = (a === _DEC_FAILED);
          if (bad) P.unreadable++;
          P.incomes.push({ id: i.id, date: i.income_date, amt: bad ? null : Number(a),
            _unreadable: bad, note: await _decTxt(i.note_enc) });
        }
        _setState('ready');
      } catch (e) { console.warn('personal hydrate failed', e); _setState('error'); }
    };

    // Only a real local "HH:MM" is stored; anything else is treated as "no time
    // known" (null → day-only) so a clock time is never fabricated.
    const _okTime = (v) => (typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v)) ? v : null;
    /* writes — private (space-less) rows */
    window.fhPersonalAddExpense = async function (amt, note, catName, catEmoji, dateIso, timeStr) {
      if (!P.uid || !P.key) return false;
      const t = _okTime(timeStr);
      const row = { owner_user_id: P.uid, txn_date: dateIso || _localDate(new Date()), kind: 'expense', space_id: null, link_id: null,
        amount_enc: await _encP(Number(amt)), note_enc: note ? await _encP(note) : null, cat_name_enc: catName ? await _encP(catName) : null, cat_emoji: catEmoji || null,
        occurred_time_enc: t ? await _encP(t) : null };
      const r = await _sb().from('personal_transactions').insert(row);
      if (r.error) { console.warn('personal expense failed', r.error); return false; }
      await window.fhPersonalHydrate(); return true;
    };
    /* Edit / delete — PRIVATE rows only (space_id null AND link_id null). A mirror
       row (a family expense the user authored, space_id set, link_id → the family
       copy) is owned by the reconciliation in fhPersonalMirror; editing it here
       would just be undone on the next mirror pass, so both writes are guarded on
       `link_id is null` server-side as well as being offered only for private rows
       in the UI. */
    window.fhPersonalUpdateExpense = async function (id, fields) {
      if (!P.uid || !P.key || !id) return false;
      fields = fields || {};
      const t = _okTime(fields.time);
      const row = { amount_enc: await _encP(Number(fields.amt)),
        note_enc: fields.note ? await _encP(fields.note) : null,
        cat_name_enc: fields.cat ? await _encP(fields.cat) : null,
        cat_emoji: fields.emoji || null,
        occurred_time_enc: t ? await _encP(t) : null };   // always set → clearing the time drops back to day-only
      if (fields.dateIso) row.txn_date = fields.dateIso;
      const r = await _sb().from('personal_transactions').update(row).eq('id', id).eq('owner_user_id', P.uid).is('link_id', null);
      if (r.error) { console.warn('personal expense update failed', r.error); return false; }
      await window.fhPersonalHydrate(); return true;
    };
    window.fhPersonalDeleteExpense = async function (id) {
      if (!P.uid || !id) return false;
      const r = await _sb().from('personal_transactions').delete().eq('id', id).eq('owner_user_id', P.uid).is('link_id', null);
      if (r.error) { console.warn('personal expense delete failed', r.error); return false; }
      await window.fhPersonalHydrate(); return true;
    };
    /* Monthly budget. `cats` (optional) is a per-category map { name: amount };
       when present it is stored encrypted in cats_enc, giving the personal ledger
       the same per-category budgets as the family sheet. Omitting `cats` leaves any
       existing map untouched (upsert only writes the columns it is given). */
    window.fhPersonalSetBudget = async function (amt, cats) {
      if (!P.uid || !P.key) return false;
      const row = { owner_user_id: P.uid, month: _monISO(), total_enc: await _encP(Number(amt)), updated_at: new Date().toISOString() };
      if (cats && typeof cats === 'object') {
        const clean = {}; for (const k in cats) { const v = Number(cats[k]) || 0; if (v > 0) clean[k] = v; }
        row.cats_enc = await _encP(JSON.stringify(clean));
      }
      const r = await _sb().from('personal_budgets').upsert(row, { onConflict: 'owner_user_id,month' });
      if (r.error) { console.warn('personal budget failed', r.error); return false; }
      await window.fhPersonalHydrate(); return true;
    };
    window.fhPersonalAddIncome = async function (amt, note, dateIso) {
      if (!P.uid || !P.key) return false;
      const row = { owner_user_id: P.uid, income_date: dateIso || _localDate(new Date()),
        amount_enc: await _encP(Number(amt)), note_enc: note ? await _encP(note) : null };
      const r = await _sb().from('personal_incomes').insert(row);
      if (r.error) { console.warn('personal income failed', r.error); return false; }
      await window.fhPersonalHydrate(); return true;
    };
    window.fhPersonalDelIncome = async function (id) {
      if (!P.uid || !id) return false;
      const r = await _sb().from('personal_incomes').delete().eq('id', id).eq('owner_user_id', P.uid);
      if (r.error) { console.warn('personal income delete failed', r.error); return false; }
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

        const un = await _sb().from('transactions').select('id,txn_date,category_id,amount,amount_enc,note,note_enc,occurred_time,occurred_time_enc').eq('family_id', fid).eq('created_by', myMem).eq('status', 'realized').eq('kind', 'expense').is('link_id', null).gte('txn_date', from).limit(100);
        for (const rr of (un.data || [])) {
          const amtS = rr.amount != null ? String(rr.amount) : await fhDecStr(rr.amount_enc);
          if (amtS == null || amtS === '') continue;
          const amt = Number(amtS); if (!isFinite(amt)) continue;
          const note = rr.note != null ? rr.note : await fhDecStr(rr.note_enc);
          const time = await _famTime(rr);
          const fc2 = (rr.category_id && famCat[rr.category_id]) || {};
          const linkId = crypto.randomUUID();
          const u = await _sb().from('transactions').update({ link_id: linkId }).eq('id', rr.id).is('link_id', null).select('id');
          if (u.error || !u.data || u.data.length !== 1) continue;
          await _insertMaster(linkId, fid, rr.txn_date, amt, note, fc2.name, fc2.emoji, time);
        }

        const ln = await _sb().from('transactions').select('id,link_id,txn_date,category_id,amount,amount_enc,note,note_enc,occurred_time,occurred_time_enc,updated_at').eq('family_id', fid).eq('created_by', myMem).not('link_id', 'is', null).gte('txn_date', from).limit(400);
        const famBy = {}; (ln.data || []).forEach((r) => { famBy[r.link_id] = r; });
        const mq = await _sb().from('personal_transactions').select('id,link_id,txn_date,amount_enc,note_enc,occurred_time_enc,updated_at,version,created_at').eq('owner_user_id', P.uid).eq('space_id', fid).not('link_id', 'is', null).gte('txn_date', from).order('created_at');
        const mastersBy = {};
        for (const r of (mq.data || [])) {
          if (mastersBy[r.link_id]) { await _sb().from('personal_transactions').delete().eq('id', r.id); continue; }   // self-heal dup
          mastersBy[r.link_id] = { id: r.id, updatedAt: r.updated_at, version: r.version || 1, amt: Number(await _decP(r.amount_enc)), note: await _decP(r.note_enc), time: await _decTxt(r.occurred_time_enc) };
        }
        for (const lid of Object.keys(famBy)) {
          const f = famBy[lid], m = mastersBy[lid];
          const amtS = f.amount != null ? String(f.amount) : await fhDecStr(f.amount_enc);
          if (amtS == null || amtS === '') continue;
          const amt = Number(amtS); if (!isFinite(amt)) continue;
          const note = f.note != null ? f.note : await fhDecStr(f.note_enc);
          const time = await _famTime(f);
          const fc2 = (f.category_id && famCat[f.category_id]) || {};
          if (!m) { await _insertMaster(lid, fid, f.txn_date, amt, note, fc2.name, fc2.emoji, time); }
          else if (f.updated_at > m.updatedAt && (amt !== m.amt || (note || '') !== (m.note || '') || (time || '') !== (m.time || ''))) {
            await _sb().from('personal_transactions').update({ amount_enc: await _encP(amt), note_enc: note ? await _encP(note) : null, cat_name_enc: fc2.name ? await _encP(fc2.name) : null, cat_emoji: fc2.emoji || null, txn_date: f.txn_date, occurred_time_enc: time ? await _encP(time) : null, version: (m.version || 1) + 1 }).eq('id', m.id);
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

    async function _insertMaster(linkId, fid, dateIso, amt, note, catName, catEmoji, timeStr) {
      return _sb().from('personal_transactions').insert({ owner_user_id: P.uid, space_id: fid, link_id: linkId, txn_date: dateIso, kind: 'expense', version: 1,
        amount_enc: await _encP(amt), note_enc: note ? await _encP(note) : null, cat_name_enc: catName ? await _encP(catName) : null, cat_emoji: catEmoji || null,
        occurred_time_enc: timeStr ? await _encP(timeStr) : null });   // carry the family expense's time into the personal copy
    }
    // Resolve a family row's occurred_time (plaintext for off/dual, ciphertext for enc).
    async function _famTime(r) { return r.occurred_time != null ? r.occurred_time : (r.occurred_time_enc ? await fhDecStr(r.occurred_time_enc) : null); }
  })();
