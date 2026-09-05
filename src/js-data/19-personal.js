  /* ═══ Personal ledger — Model Y (0074) ══════════════════════════════════════
     The PERSON is the root. Personal data lives in its own owner-scoped tables
     (personal_transactions, one spine since 0109: expense · income · transfer ·
     loan · repayment) encrypted under a per-USER key (personal_keys), NOT in any
     family. The family `transactions` table is never touched by this module.
     Tables are ciphertext-only (no plaintext columns), so E2EE is by
     construction.

     Double-entry: a family transaction the user authored is mirrored here as a
     personal master (space_id = the family it flows to, link_id → the family
     copy). Reserve link_id on the family row FIRST (crash-safe), then insert the
     master; reconcile repairs/refreshes/tombstones. Idempotent by link_id. */
  (function () {
    const P = { uid: null, key: null, rawKey: null, wrap: null, txns: [], incomes: [], budget: 0, catBudget: {}, state: 'boot', mirrorRan: false,
      accounts: [], debts: [] };   // Borrowing & Lending (0105): instruments + ALL-TIME debt-relevant rows
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
    /* Decrypt cache, keyed by the CIPHERTEXT itself. Correct by construction:
       a sealed value decrypts to exactly one plaintext, and any edit
       re-encrypts under a fresh nonce — which is a brand-new key in this map,
       so staleness cannot exist. What it buys: every hydrate re-decrypts the
       WHOLE ledger, and that cost now grows with history (the paged debt
       read); with the cache only rows never seen this session pay WebCrypto,
       so hydrate №2 onward is network + JSON. Failures are never cached — a
       locked→unlocked transition must retry, not remember the lock. Bounded so
       a pathological session cannot grow without limit; cleared on boot, the
       one place identity can change. */
    const _decCache = new Map();
    const _decP = async (b64) => {
      if (!b64) return null;
      const hit = _decCache.get(b64);
      if (hit !== undefined) return hit;
      try {
        const v = await FHCrypto.decVal(P.key, b64);
        if (_decCache.size < 30000) _decCache.set(b64, v);
        return v;
      } catch (e) { return _DEC_FAILED; }
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
      _decCache.clear();   // boot is the one place identity can change
      try {
        P.uid = await _uid(); if (!P.uid) { _setState('error'); return; }
        const kc = await _kGet('p:' + P.uid);
        if (kc && kc.key) { P.key = kc.key; await _afterKey(); return; }
        const wr = await _sb().from('personal_keys').select('kdf_salt,kdf_iters,kdf_version,wrapped_dek').eq('user_id', P.uid).maybeSingle();
        // NEVER provision on a read failure. A transient error (auth token not yet
        // refreshed on cold open, network blip, a 401 racing session restore) sets
        // wr.error and leaves wr.data null. Treating that as "no key exists" mints a
        // brand-new card every reopen — init_personal_key is ON CONFLICT DO NOTHING,
        // so the server wrap survives, but the user is shown a fresh (mismatched)
        // card each time and the real key scrolls away. Only provision when the read
        // DEFINITIVELY succeeded and returned no row.
        if (wr.error) { console.warn('personal_keys read failed', wr.error); _setState('error'); return; }
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
      // personal photos blanked while this ledger was locked can decrypt now
      try { window.__fhPhotoRefresh && __fhPhotoRefresh(); } catch (e) {}
      /* Fire-and-forget, after the data the person is waiting for. A staging
         keypair they do not have yet only costs them latency on mail that has
         not arrived; failing hydrate over it would cost them their ledger. */
      try { await window.fhPersonalStagingEnsure(); } catch (e) { window.fhLogErr && window.fhLogErr('personal_staging_ensure', e); }
    }

    /* Bulk-import hold. Every write funnels through a full re-hydrate — four
       queries, a whole-ledger decrypt, and two _setState repaints (loading →
       ready) of the Cá nhân tab AND the staged review modal. Right for the one
       row a person hand-types; quadratic for a 200-row email backfill, where it
       was the "screen flashing continuously for minutes" bug. While held,
       hydrate defers to a single flag; release runs the ONE hydrate the whole
       batch needs. A counter, not a boolean, so nested holds cannot release
       early. */
    let _hydHold = 0, _hydWanted = false;
    window.fhPersonalHydrateHold = function () { _hydHold++; };
    window.fhPersonalHydrateRelease = async function () {
      if (_hydHold > 0) _hydHold--;
      if (!_hydHold && _hydWanted) { _hydWanted = false; await window.fhPersonalHydrate(); }
    };

    /* Fetch EVERY row of a query that can outgrow one page. PostgREST caps any
       single select at 1000 rows server-side, and the debt read below wore an
       explicit limit(2000) — sized when account-tagged rows were genuinely
       rare. Bank-email import changed that: it tags EVERY expense with an
       account_id, so a year of backfill walks straight through the cap. Past
       it, rows silently fell out of every balance derivation — card
       outstandings and account balances quietly wrong, the drift badge arguing
       against the bank with an incomplete sum, no error anywhere.
       Offset pages over a stable (txn_date, id) order; `complete:false` only
       at the hard safety ceiling, which callers must DECLARE, never absorb —
       30 pages is 30k rows, decades at the busiest observed rate. */
    async function _pageAll(build, hardPages) {
      const SIZE = 1000, out = [];
      for (let p = 0; p < (hardPages || 30); p++) {
        const r = await build().range(p * SIZE, p * SIZE + SIZE - 1);
        if (r.error) throw r.error;
        const rows = r.data || [];
        for (const x of rows) out.push(x);
        if (rows.length < SIZE) return { rows: out, complete: true };
      }
      return { rows: out, complete: false };
    }

    window.fhPersonalHydrate = async function () {
      if (!P.uid || !P.key) return;
      if (_hydHold) { _hydWanted = true; return; }
      // Every write path funnels through a re-hydrate, so this is the one spot
      // that keeps the review screen's duplicate-match slice from going stale.
      try { window.fhPersonalMatchSliceInvalidate && window.fhPersonalMatchSliceInvalidate(); } catch (e) {}
      try { window.fhPersonalStatsSliceInvalidate && window.fhPersonalStatsSliceInvalidate(); } catch (e) {}
      _setState('loading');
      try {
        const from = _winFrom();
        /* Debt rows (loans / repayments / transfers, plus any expense tagged to
           an account) are fetched ALL-TIME, unlike the month-windowed expense
           reads: a balance is a stock, not a flow — truncating it to two months
           would understate every card and IOU. Paged without a working cap
           (_pageAll) because bank import made them common, not rare; the
           partial indexes from 0105 still carry the scan. The month window is
           paged too — a heavy import month can clear 1000 rows on its own,
           and PostgREST's own 1000-row default would have clipped it as
           silently as the old limit(2000). */
        const [tr, bd, ac, dr] = await Promise.all([
          _pageAll(() => _sb().from('personal_transactions').select('id,amount_enc,note_enc,cat_name_enc,cat_emoji,occurred_time_enc,txn_date,kind,space_id,link_id,version,updated_at,created_at,account_id,transfer_group_id,position_account_id,quantity_enc').eq('owner_user_id', P.uid).gte('txn_date', from).order('txn_date', { ascending: false }).order('id')),
          _sb().from('personal_budgets').select('total_enc,cats_enc').eq('owner_user_id', P.uid).eq('month', _monISO()).maybeSingle(),
          _sb().from('personal_accounts').select('id,kind,name_enc,tail,provider,credit_limit_enc,human_verified,statement_day,due_day,anchor_balance_enc,anchor_at,ext_balance_enc,ext_balance_date,account_number_enc,asset_symbol_enc,asset_unit_enc,asset_class_enc,manual_price_enc,manual_price_at').eq('owner_user_id', P.uid).is('archived_at', null),
          _pageAll(() => _sb().from('personal_transactions').select('id,amount_enc,note_enc,counterparty_enc,cat_name_enc,cat_emoji,txn_date,kind,account_id,transfer_group_id,position_account_id,quantity_enc,due_date,created_at').eq('owner_user_id', P.uid).or('kind.neq.expense,account_id.not.is.null').order('txn_date', { ascending: false }).order('id')),
        ]);
        /* Ceiling honesty, same stance as the stats slice's `truncated`: a
           short debt read understates balances, so it is counted and declared,
           never silent. Nothing renders differently yet; the flag exists so a
           view CAN say so the day anyone reaches it. */
        P.debtsComplete = !!(tr.complete && dr.complete);
        if (!P.debtsComplete) console.warn('personal hydrate hit the page ceiling', { tr: tr.complete, dr: dr.complete });
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
        for (const t of tr.rows) {
          const a = await _decP(t.amount_enc), bad = (a === _DEC_FAILED);
          if (bad) P.unreadable++;
          const qRaw = t.quantity_enc ? await _decP(t.quantity_enc) : null;
          P.txns.push({ id: t.id, date: t.txn_date, kind: t.kind, spaceId: t.space_id, linkId: t.link_id,
            version: t.version || 1, updatedAt: t.updated_at, ts: t.created_at,
            accountId: t.account_id, transferGroupId: t.transfer_group_id,
            positionId: t.position_account_id || null,
            qty: (qRaw == null || qRaw === _DEC_FAILED) ? null : (Number(qRaw) || null),
            amt: bad ? null : Number(a), _unreadable: bad,
            note: await _decTxt(t.note_enc), cat: await _decTxt(t.cat_name_enc), emoji: t.cat_emoji,
            time: await _decTxt(t.occurred_time_enc) });   // local "HH:MM" if the time was known, else null (day-only)
        }
        /* Photos (0114): attach public URLs to the window's rows; the photo
           observer decrypts /personal-media/ bytes in place. One owner-scoped
           query (never an id-list URL — the 891-id Cloudflare refusal scar). */
        try {
          const pp = await _sb().from('personal_transaction_photos').select('transaction_id,photo_url,sort_order').eq('owner_user_id', P.uid).order('sort_order').limit(800);
          const byTx = {};
          for (const p of (pp.data || [])) (byTx[p.transaction_id] = byTx[p.transaction_id] || []).push(_pPhotoUrl(p.photo_url));
          for (const t of P.txns) if (byTx[t.id]) t.photos = byTx[t.id];
        } catch (e) {}
        /* Income lives on the spine since 0109 (kind='income'); P.incomes stays
           as a derived view so every existing reader (the income sheet, the
           month totals, the month picker) keeps its shape without knowing. */
        P.incomes = P.txns.filter((t) => t.kind === 'income')
          .map((t) => ({ id: t.id, date: t.date, amt: t.amt, _unreadable: t._unreadable, note: t.note, cat: t.cat, accountId: t.accountId }));
        /* Instruments + debt rows. Same fail-closed stance: an unreadable amount
           takes the row out of every balance, counted and declared, never 0đ. */
        P.accounts = [];
        for (const a of (ac.data || [])) {
          const lim = a.credit_limit_enc ? await _decP(a.credit_limit_enc) : null;
          const anch = a.anchor_balance_enc ? await _decP(a.anchor_balance_enc) : null;
          const ext = a.ext_balance_enc ? await _decP(a.ext_balance_enc) : null;
          const mpx = a.manual_price_enc ? await _decP(a.manual_price_enc) : null;
          P.accounts.push({ id: a.id, kind: a.kind, tail: a.tail, provider: a.provider,
            humanVerified: a.human_verified,
            statementDay: a.statement_day || null, dueDay: a.due_day || null,
            name: await _decTxt(a.name_enc),
            limitK: (lim == null || lim === _DEC_FAILED) ? null : (Number(lim) || null),
            /* balance anchor (0109): null = never set → no balance is shown.
               An unreadable anchor is also null — a wrong number is worse. */
            anchorK: (anch == null || anch === _DEC_FAILED) ? null : Number(anch),
            anchorAt: a.anchor_at || null,
            extK: (ext == null || ext === _DEC_FAILED) ? null : Number(ext),
            extDate: a.ext_balance_date || null,
            /* position identity (0122): only kind='investment' rows carry these.
               An unreadable manual price is null — the value falls back to
               giá vốn, never to a wrong number (same stance as the anchor). */
            assetSymbol: await _decTxt(a.asset_symbol_enc),
            assetUnit: await _decTxt(a.asset_unit_enc),
            assetClass: await _decTxt(a.asset_class_enc),
            manualPriceK: (mpx == null || mpx === _DEC_FAILED) ? null : (Number(mpx) || null),
            manualPriceAt: a.manual_price_at || null,
            accountNumber: a.account_number_enc ? await _decTxt(a.account_number_enc) : null });
        }
        P.debts = [];
        for (const t of dr.rows) {
          const a = await _decP(t.amount_enc), bad = (a === _DEC_FAILED);
          if (bad) P.unreadable++;
          const qRaw = t.quantity_enc ? await _decP(t.quantity_enc) : null;
          P.debts.push({ id: t.id, date: t.txn_date, kind: t.kind, accountId: t.account_id,
            transferGroupId: t.transfer_group_id, ts: t.created_at, due: t.due_date || null,
            positionId: t.position_account_id || null,
            qty: (qRaw == null || qRaw === _DEC_FAILED) ? null : (Number(qRaw) || null),
            amt: bad ? null : Number(a), _unreadable: bad,
            note: await _decTxt(t.note_enc), cat: await _decTxt(t.cat_name_enc), emoji: t.cat_emoji,
            who: await _decTxt(t.counterparty_enc) });
        }
        /* Review memory (0122): counterparty → position pre-selection for the
           review screen. Fire-and-forget shape — an unreadable memory row is
           dropped (it only costs a pre-selection, never money). */
        P.memory = [];
        try {
          const mm = await _sb().from('personal_review_memory').select('id,key_enc,position_account_id').eq('owner_user_id', P.uid).limit(500);
          for (const m of (mm.data || [])) {
            const k = await _decTxt(m.key_enc);
            if (k) P.memory.push({ id: m.id, key: k, positionId: m.position_account_id });
          }
        } catch (e) {}
        _setState('ready');
      } catch (e) { console.warn('personal hydrate failed', e); _setState('error'); }
    };

    /* Duplicate-match slice for the staged review screen. The tab cache above
       reaches back one month — a stock the tab needs — but a re-staged bank
       mail can carry an occurred_at a year old (the mailbox backfill window is
       up to 365 days), and matched against a two-month ledger an old import
       came back clean. This fetches expense+income rows to that horizon,
       amount/note/cat only, decrypted once and cached per session; the review
       screen awaits it BEFORE bucketing because the matcher is synchronous.
       Returns [] rather than throwing — a locked ledger degrades to the short
       cache, never blocks the queue from opening. */
    let _matchSlice = null;
    window.fhPersonalMatchSlice = async function () {
      if (!P.uid || !P.key) return [];
      if (_matchSlice) return _matchSlice;
      try {
        const d = new Date(); d.setDate(d.getDate() - 365);
        const from = _localDate(d);
        const r = await _pageAll(() => _sb().from('personal_transactions')
          .select('id,amount_enc,note_enc,cat_name_enc,txn_date,kind')
          .eq('owner_user_id', P.uid)
          .in('kind', ['expense', 'income'])
          .gte('txn_date', from)
          .order('txn_date', { ascending: false }).order('id'));
        const out = [];
        for (const t of r.rows) {
          const a = await _decP(t.amount_enc);
          if (a == null || a === _DEC_FAILED) continue;   // unreadable amount → cannot match, skip (fail closed)
          out.push({ id: t.id, date: t.txn_date, kind: t.kind, amt: Number(a),
            note: await _decTxt(t.note_enc), cat: await _decTxt(t.cat_name_enc) });
        }
        _matchSlice = out;
        return out;
      } catch (e) { console.warn('personal match slice failed', e); return []; }
    };
    /* A write through this module makes the cached slice stale by definition. */
    window.fhPersonalMatchSliceInvalidate = function () { _matchSlice = null; };

    /* ── Full-history stats slice — "Toàn thời gian" and the months timeline ──
       The tab cache reaches back one month (a flow view); lifetime totals and
       a bar-per-month chart need every year, and the server cannot sum
       ciphertext. So the whole history is fetched THIN (amount, kind, date,
       category, space — no notes, no times) and decrypted once per session.
       Same contract as the match slice: cached until a write invalidates it,
       null rather than a throw, and an unreadable amount is excluded from
       every figure but counted, so the view can say so instead of lying. */
    let _statsSlice = null;
    window.fhPersonalStatsSlice = async function () {
      if (!P.uid || !P.key) return null;
      if (_statsSlice) return _statsSlice;
      try {
        const r = await _pageAll(() => _sb().from('personal_transactions')
          .select('amount_enc,cat_name_enc,cat_emoji,txn_date,kind,space_id')
          .eq('owner_user_id', P.uid)
          .in('kind', ['expense', 'income'])
          .order('txn_date', { ascending: false }).order('id'));
        const rows = []; let unreadable = 0;
        for (const t of r.rows) {
          const a = await _decP(t.amount_enc);
          if (a === _DEC_FAILED) { unreadable++; continue; }
          if (a == null) continue;
          rows.push({ date: t.txn_date, kind: t.kind, amt: Number(a),
            cat: await _decTxt(t.cat_name_enc), emoji: t.cat_emoji, spaceId: t.space_id });
        }
        // Paged to the _pageAll hard ceiling (30k rows — decades). If that ever
        // fills, the OLDEST months are the ones missing — flagged so the view
        // can disclose, not guess.
        _statsSlice = { rows: rows, unreadable: unreadable, truncated: !r.complete };
        return _statsSlice;
      } catch (e) { console.warn('personal stats slice failed', e); return null; }
    };
    window.fhPersonalStatsSliceCached = function () { return _statsSlice; };
    window.fhPersonalStatsSliceInvalidate = function () { _statsSlice = null; };

    /* ═══ Personal photos (0114) — capture parity with the family book ═══════
       Bytes are ALWAYS ciphertext under the personal DEK ('.enc' objects in the
       public personal-media bucket — privacy from the key, not the address);
       the photo observer (57-photo-enc) decrypts /personal-media/ URLs with
       this key. Paths embed a timestamp + random suffix (immutable → long
       cache), owner-scoped by the 0114 storage policies. The compressor is the
       family one (fhCompressImage) so EXIF/GPS stripping stays a single
       implementation. */
    const _pPhotoUrl = (path) => SUPABASE_URL + '/storage/v1/object/public/personal-media/' + String(path).split('/').map(encodeURIComponent).join('/');
    window.fhPersonalPhotoUrl = _pPhotoUrl;
    window.fhPersonalKeyReady = function () { return !!P.key; };
    window.fhPersonalEncBytes = async function (bytes) { if (!P.key) throw new Error('personal_locked'); return FHCrypto.encBytes(P.key, bytes); };
    window.fhPersonalDecBytes = async function (all) { if (!P.key) throw new Error('personal_locked'); return FHCrypto.decBytes(P.key, all); };
    async function _pUploadPhoto(dataUri) {
      if (!P.uid || !P.key || !dataUri || dataUri.indexOf('data:') !== 0) return null;
      const src = window.fhCompressImage ? await fhCompressImage(dataUri) : dataUri;
      const m = String(src).match(/^data:([^;]+);base64,(.*)$/); if (!m) return null;
      const bin = atob(m[2]); let arr = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
      const plain = arr;
      const ext = (((m[1].split('/')[1]) || 'jpg').replace('jpeg', 'jpg')) + '.enc';
      arr = await window.fhPersonalEncBytes(arr);
      const path = P.uid + '/' + Date.now() + '_' + Math.random().toString(36).slice(2, 8) + '.' + ext;
      const up = await _sb().storage.from('personal-media').upload(path, arr, { contentType: 'application/octet-stream', cacheControl: '31536000' });
      if (up.error) { console.warn('personal photo upload failed', up.error); return null; }
      // seed the render cache with the plaintext we already hold — the fresh
      // photo shows instantly instead of blank→fetch→decrypt
      if (window.__fhPhotoSeed) { try { window.__fhPhotoSeed(_pPhotoUrl(path), plain, m[1]); } catch (e) {} }
      return path;
    }
    window.fhPersonalUploadTxnPhotos = async function (txnId, photos) {
      if (!txnId || !photos || !photos.length) return true;
      let failed = 0;
      try { window.fhUploadBusy && fhUploadBusy(photos.length); } catch (e) {}
      try {
        for (let i = 0; i < photos.length; i++) {
          const takenOn = window.fhPhotoTakenOn ? fhPhotoTakenOn(photos[i]) : null;
          const path = await _pUploadPhoto(photos[i]);
          if (path) { const r = await _sb().from('personal_transaction_photos').insert({ owner_user_id: P.uid, transaction_id: txnId, photo_url: path, sort_order: i, taken_on: takenOn }); if (r.error) failed++; }
          else failed++;
        }
      } catch (e) { console.warn('personal txn photos failed', e); failed++; }
      finally { try { window.fhUploadBusy && fhUploadBusy(-photos.length); } catch (e) {} }
      return failed === 0;
    };
    /* Edit-time reconcile — mirror of the family _dbSyncTxnPhotos: keep the
       existing URL entries, upload the new data: entries, delete the removed
       (rows + storage objects). */
    window.fhPersonalSyncTxnPhotos = async function (txnId, photos) {
      if (!P.uid || !txnId) return false;
      photos = photos || [];
      const cur = (await _sb().from('personal_transaction_photos').select('id,photo_url').eq('transaction_id', txnId)).data || [];
      const kept = new Set(); const uploads = [];
      photos.forEach((p) => {
        if (typeof p !== 'string') return;
        if (p.indexOf('data:') === 0) { uploads.push(p); return; }
        const mm = p.match(/\/personal-media\/([^?]+)/);
        if (mm) kept.add(decodeURIComponent(mm[1]));
      });
      const removed = cur.filter((r) => !kept.has(r.photo_url));
      if (removed.length) {
        await _sb().from('personal_transaction_photos').delete().in('id', removed.map((r) => r.id));
        try { await _sb().storage.from('personal-media').remove(removed.map((r) => r.photo_url)); } catch (e) {}
      }
      let sort = cur.length - removed.length;
      for (const dataUri of uploads) {
        const takenOn = window.fhPhotoTakenOn ? fhPhotoTakenOn(dataUri) : null;
        const path = await _pUploadPhoto(dataUri);
        if (path) await _sb().from('personal_transaction_photos').insert({ owner_user_id: P.uid, transaction_id: txnId, photo_url: path, sort_order: sort++, taken_on: takenOn });
      }
      return true;
    };
    /* Photo rows for one txn (path + taken_on) — the move engine reads these. */
    window.fhPersonalTxnPhotoRows = async function (txnId) {
      const r = await _sb().from('personal_transaction_photos').select('id,photo_url,sort_order,taken_on').eq('transaction_id', txnId).order('sort_order');
      if (r.error) throw r.error;
      return r.data || [];
    };
    window.fhPersonalRemovePhotoRows = async function (txnId) {
      const rows = await window.fhPersonalTxnPhotoRows(txnId);
      if (!rows.length) return true;
      await _sb().from('personal_transaction_photos').delete().eq('transaction_id', txnId);
      try { await _sb().storage.from('personal-media').remove(rows.map((r) => r.photo_url)); } catch (e) {}
      return true;
    };

    // Only a real local "HH:MM" is stored; anything else is treated as "no time
    // known" (null → day-only) so a clock time is never fabricated.
    const _okTime = (v) => (typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v)) ? v : null;
    /* writes — private (space-less) rows.
       `opts.accountId` (0105) tags the instrument the money moved through — a
       credit-card-tagged expense is what builds that card's derived balance. */
    window.fhPersonalAddExpense = async function (amt, note, catName, catEmoji, dateIso, timeStr, source, opts) {
      if (!P.uid || !P.key) return false;
      const t = _okTime(timeStr);
      const row = { owner_user_id: P.uid, txn_date: dateIso || _localDate(new Date()), kind: 'expense', space_id: null, link_id: null,
        amount_enc: await _encP(Number(amt)), note_enc: note ? await _encP(note) : null, cat_name_enc: catName ? await _encP(catName) : null, cat_emoji: catEmoji || null,
        occurred_time_enc: t ? await _encP(t) : null, source: source || null,   // 0100 provenance ('direct-email' | 'forwarding-email'); null = hand-entered
        account_id: (opts && opts.accountId) || null };
      // Returns the new row's id (truthy — every boolean caller keeps working);
      // the photo path needs it to attach personal_transaction_photos rows.
      const r = await _sb().from('personal_transactions').insert(row).select('id').single();
      if (r.error) { console.warn('personal expense failed', r.error); return false; }
      await window.fhPersonalHydrate(); return (r.data && r.data.id) || true;
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
      // accountId (M9): undefined = leave untouched, null = clear, id = set —
      // this is what makes a row that landed untagged taggable at all.
      if (fields.hasOwnProperty('accountId')) row.account_id = fields.accountId || null;
      const r = await _sb().from('personal_transactions').update(row).eq('id', id).eq('owner_user_id', P.uid).is('link_id', null);
      if (r.error) { console.warn('personal expense update failed', r.error); return false; }
      await window.fhPersonalHydrate(); return true;
    };
    window.fhPersonalDeleteExpense = async function (id) {
      if (!P.uid || !id) return false;
      // storage objects don't cascade — remove the photo files (and rows) first
      try { await window.fhPersonalRemovePhotoRows(id); } catch (e) {}
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
    /* Income writes to the SPINE since 0109 (kind='income'). Same signature the
       income sheet has always called, plus opts for what the full ledger adds:
       { catName, catEmoji, accountId, time } — which account it landed in is
       what makes a deposit balance computable at all. */
    window.fhPersonalAddIncome = async function (amt, note, dateIso, source, opts) {
      if (!P.uid || !P.key) return false;
      opts = opts || {};
      const t = _okTime(opts.time);
      const row = { owner_user_id: P.uid, txn_date: dateIso || _localDate(new Date()), kind: 'income',
        space_id: null, link_id: null,
        amount_enc: await _encP(Number(amt)), note_enc: note ? await _encP(note) : null,
        cat_name_enc: opts.catName ? await _encP(opts.catName) : null, cat_emoji: opts.catEmoji || null,
        occurred_time_enc: t ? await _encP(t) : null,
        account_id: opts.accountId || null, source: source || null };
      const r = await _sb().from('personal_transactions').insert(row);
      if (r.error) { console.warn('personal income failed', r.error); return false; }
      await window.fhPersonalHydrate(); return true;
    };
    window.fhPersonalDelIncome = async function (id) {
      if (!P.uid || !id) return false;
      const r = await _sb().from('personal_transactions').delete().eq('id', id).eq('owner_user_id', P.uid).eq('kind', 'income').is('link_id', null);
      if (r.error) { console.warn('personal income delete failed', r.error); return false; }
      await window.fhPersonalHydrate(); return true;
    };

    /* ═══ Borrowing & Lending (0105) — docs/specs/borrowing-lending-spec.md ═══
       One primitive: a counterparty balance, DERIVED from rows (Q5).
       Sign convention, inside the ciphertext, from MY point of view:
         loan  +X = I lent X (they owe me)   ·   loan  −X = I borrowed X
         repayment +X = they repaid me X     ·   repayment −X = I repaid X
       so a person's balance = Σ loan − Σ repayment (positive = they owe me).
       A card payment is ONE transfer row tagged to the card account:
         card outstanding = Σ expenses tagged to it − Σ transfers tagged to it.
       The settlement leg is a transfer — never income, never expense. */

    async function _debtInsert(kind, amt, extra) {
      if (!P.uid || !P.key) return false;
      const row = Object.assign({ owner_user_id: P.uid, txn_date: extra.dateIso || _localDate(new Date()),
        kind: kind, space_id: null, link_id: null,
        amount_enc: await _encP(Number(amt)),
        note_enc: extra.note ? await _encP(extra.note) : null,
        counterparty_enc: extra.who ? await _encP(extra.who) : null,
        account_id: extra.accountId || null,
        transfer_group_id: extra.transferGroupId || null,
        due_date: extra.dueDate || null,
        source: extra.source || null });
      const r = await _sb().from('personal_transactions').insert(row);
      if (r.error) { console.warn('personal ' + kind + ' failed', r.error); return false; }
      await window.fhPersonalHydrate(); return true;
    }
    // amtK signed (see convention above); who = tên người, required for loans.
    // dueDate (0122) = "hẹn trả", optional, loans only.
    window.fhPersonalAddLoan = function (amtK, who, note, dateIso, source, dueDate) {
      if (!who) return Promise.resolve(false);
      return _debtInsert('loan', amtK, { who: who, note: note, dateIso: dateIso, source: source, dueDate: dueDate });
    };
    window.fhPersonalAddRepayment = function (amtK, who, note, dateIso, source) {
      if (!who) return Promise.resolve(false);
      return _debtInsert('repayment', amtK, { who: who, note: note, dateIso: dateIso, source: source });
    };
    /* ═══ Kind flips (0122, lending-capture-spec §4) ═══════════════════════════
       A committed expense that was really a loan: flip the row IN PLACE — same
       id, same amount, same date — so history and photos survive. The category
       is dropped (a loan is not consumption), the counterparty becomes the
       receivable's name. Private rows only (link_id null): a mirror master is
       owned by the family reconciliation and must be moved before flipping. */
    window.fhPersonalConvertToLoan = async function (id, who, dueDate) {
      if (!P.uid || !P.key || !id || !who) return false;
      const r = await _sb().from('personal_transactions').update({
        kind: 'loan', counterparty_enc: await _encP(who),
        cat_name_enc: null, cat_emoji: null,
        due_date: dueDate || null,
      }).eq('id', id).eq('owner_user_id', P.uid).eq('kind', 'expense').is('link_id', null);
      if (r.error) { console.warn('convert to loan failed', r.error); return false; }
      await window.fhPersonalHydrate(); return true;
    };
    /* The way back — a loan that was a plain expense after all. */
    window.fhPersonalConvertToExpense = async function (id, catName, catEmoji) {
      if (!P.uid || !P.key || !id) return false;
      const r = await _sb().from('personal_transactions').update({
        kind: 'expense', counterparty_enc: null, due_date: null,
        cat_name_enc: catName ? await _encP(catName) : null, cat_emoji: catEmoji || null,
      }).eq('id', id).eq('owner_user_id', P.uid).eq('kind', 'loan').is('link_id', null);
      if (r.error) { console.warn('convert to expense failed', r.error); return false; }
      await window.fhPersonalHydrate(); return true;
    };
    /* The same flip one shelf over (0123, investment-spec §8): a committed
       expense that was really an investment buy — the miscounted OTC transfer.
       In-place: same id, date, account, note, photos. The category drops (a
       buy is not consumption) and the amount RE-SIGNS to the investment
       convention (buy = −X): expenses store +X, so the readable amount is
       looked up in the hydrated cache and re-encrypted negative. */
    window.fhPersonalConvertToInvestment = async function (id, positionId, qty) {
      if (!P.uid || !P.key || !id || !positionId) return false;
      const cur = P.txns.find((t) => t.id === id) || P.debts.find((d) => d.id === id);
      if (!cur || cur.amt == null || cur._unreadable) return false;
      const r = await _sb().from('personal_transactions').update({
        kind: 'investment', position_account_id: positionId,
        amount_enc: await _encP(-Math.abs(Number(cur.amt))),
        quantity_enc: (qty > 0) ? await _encP(Number(qty)) : null,
        cat_name_enc: null, cat_emoji: null,
      }).eq('id', id).eq('owner_user_id', P.uid).eq('kind', 'expense').is('link_id', null);
      if (r.error) { console.warn('convert to investment failed', r.error); return false; }
      await window.fhPersonalHydrate(); return true;
    };
    /* And back — an investment row that was a plain expense after all. */
    window.fhPersonalConvertInvestmentToExpense = async function (id, catName, catEmoji) {
      if (!P.uid || !P.key || !id) return false;
      const cur = P.txns.find((t) => t.id === id) || P.debts.find((d) => d.id === id);
      if (!cur || cur.amt == null || cur._unreadable) return false;
      const r = await _sb().from('personal_transactions').update({
        kind: 'expense', position_account_id: null, quantity_enc: null,
        amount_enc: await _encP(Math.abs(Number(cur.amt))),
        cat_name_enc: catName ? await _encP(catName) : null, cat_emoji: catEmoji || null,
      }).eq('id', id).eq('owner_user_id', P.uid).eq('kind', 'investment').is('link_id', null);
      if (r.error) { console.warn('convert investment→expense failed', r.error); return false; }
      await window.fhPersonalHydrate(); return true;
    };
    /* Edit a loan/repayment row's own fields (the person zoom-in's row sheet). */
    window.fhPersonalDebtRowUpdate = async function (id, fields) {
      if (!P.uid || !P.key || !id) return false;
      const row = {};
      if (fields.amtK != null && isFinite(fields.amtK)) row.amount_enc = await _encP(Number(fields.amtK));
      if (fields.hasOwnProperty('note')) row.note_enc = fields.note ? await _encP(fields.note) : null;
      if (fields.dateIso) row.txn_date = fields.dateIso;
      if (fields.hasOwnProperty('dueDate')) row.due_date = fields.dueDate || null;
      const r = await _sb().from('personal_transactions').update(row).eq('id', id).eq('owner_user_id', P.uid).is('link_id', null);
      if (r.error) { console.warn('debt row update failed', r.error); return false; }
      await window.fhPersonalHydrate(); return true;
    };
    // A transfer tagged to an account (card payment, wallet top-up). amtK > 0.
    window.fhPersonalAddTransfer = function (amtK, accountId, note, dateIso, source, transferGroupId) {
      return _debtInsert('transfer', amtK, { accountId: accountId, note: note, dateIso: dateIso, source: source, transferGroupId: transferGroupId });
    };
    /* ═══ Full ledger (0109) — the transfer PAIR (spec T4/T5) ═══════════════════
       An own-account transfer is TWO rows sharing one transfer_group_id: the
       out-leg (−amt, from-account) and the in-leg (+amt, to-account). Both are
       kind='transfer', so both stay out of every income/expense total; the sign
       lives inside amount_enc like everywhere else. Cash is a normal account, so
       an ATM withdrawal is the same shape. Legacy one-leg card payments keep
       transfer_group_id null. amtK > 0. */
    window.fhPersonalAddTransferPair = async function (amtK, fromAccountId, toAccountId, note, dateIso, source) {
      if (!P.uid || !P.key || !(amtK > 0) || !fromAccountId || !toAccountId || fromAccountId === toAccountId) return false;
      const gid = crypto.randomUUID();
      const date = dateIso || _localDate(new Date());
      const mk = async (amt, acct) => ({ owner_user_id: P.uid, txn_date: date, kind: 'transfer',
        space_id: null, link_id: null,
        amount_enc: await _encP(Number(amt)), note_enc: note ? await _encP(note) : null,
        account_id: acct, transfer_group_id: gid, source: source || null });
      const r = await _sb().from('personal_transactions').insert([await mk(-amtK, fromAccountId), await mk(amtK, toAccountId)]);
      if (r.error) { console.warn('personal transfer pair failed', r.error); return false; }
      await window.fhPersonalHydrate(); return true;
    };
    /* Bulk write — the bank-email import's fast path. One row per spec
       ({kind, amt, note, catName, catEmoji, dateIso, time, who, accountId,
       transferGroupId, source}), encrypted locally and inserted in CHUNKS
       rather than one awaited round trip per row: 200 reviewed emails used to
       mean 200 inserts × a full re-hydrate each — minutes of silent work on a
       low-end phone. Encryption is cheap and local; the network is the cost,
       so the network is what gets batched.

       A chunk is one INSERT, so it fully lands or fully fails — `written` is
       therefore exact, and the caller retires precisely the staged rows whose
       ledger copies exist and re-offers the rest. A transfer PAIR is never
       split across a chunk boundary: a failure there would strand one leg
       written and one not, which retire-by-range cannot express.
       onChunk(written, total) is awaited between chunks — progress UI and a
       paint yield live there, not here. */
    window.fhPersonalAddMany = async function (specs, onChunk) {
      if (!P.uid || !P.key || !specs || !specs.length) return { ok: false, written: 0 };
      const rows = [];
      for (const s of specs) {
        const t = _okTime(s.time);
        rows.push({ owner_user_id: P.uid, txn_date: s.dateIso || _localDate(new Date()),
          kind: s.kind, space_id: null, link_id: null,
          amount_enc: await _encP(Number(s.amt)),
          note_enc: s.note ? await _encP(s.note) : null,
          cat_name_enc: s.catName ? await _encP(s.catName) : null,
          cat_emoji: s.catEmoji || null,
          occurred_time_enc: t ? await _encP(t) : null,
          counterparty_enc: s.who ? await _encP(s.who) : null,
          account_id: s.accountId || null,
          transfer_group_id: s.transferGroupId || null,
          due_date: s.dueDate || null,
          position_account_id: s.positionId || null,
          quantity_enc: (s.qty != null && isFinite(s.qty)) ? await _encP(Number(s.qty)) : null,
          source: s.source || null });
      }
      const CHUNK = 50;
      let written = 0;
      while (written < rows.length) {
        let end = Math.min(rows.length, written + CHUNK);
        while (end < rows.length && rows[end].transfer_group_id
               && rows[end].transfer_group_id === rows[end - 1].transfer_group_id) end++;
        const r = await _sb().from('personal_transactions').insert(rows.slice(written, end));
        if (r.error) { console.warn('personal bulk insert failed after ' + written, r.error); return { ok: false, written: written }; }
        written = end;
        if (onChunk) { try { await onChunk(written, rows.length); } catch (e) {} }
      }
      await window.fhPersonalHydrate();
      return { ok: true, written: written };
    };
    /* Pair integrity (T10): the two legs can never diverge, so editing goes
       through the group and deleting takes both. Editing only amount/note/date —
       the accounts are the pair's identity; changing those is delete + re-add. */
    window.fhPersonalUpdateTransferPair = async function (groupId, fields) {
      if (!P.uid || !P.key || !groupId) return false;
      const legs = P.debts.filter((d) => d.transferGroupId === groupId);
      if (!legs.length) return false;
      for (const leg of legs) {
        const row = {};
        if (fields.amtK > 0) row.amount_enc = await _encP((leg.amt != null && leg.amt < 0 ? -1 : 1) * Number(fields.amtK));
        if (fields.hasOwnProperty('note')) row.note_enc = fields.note ? await _encP(fields.note) : null;
        if (fields.dateIso) row.txn_date = fields.dateIso;
        const r = await _sb().from('personal_transactions').update(row).eq('id', leg.id).eq('owner_user_id', P.uid).is('link_id', null);
        if (r.error) { console.warn('transfer pair update failed', r.error); return false; }
      }
      await window.fhPersonalHydrate(); return true;
    };
    window.fhPersonalDeleteTransferPair = async function (groupId) {
      if (!P.uid || !groupId) return false;
      const r = await _sb().from('personal_transactions').delete().eq('owner_user_id', P.uid).eq('transfer_group_id', groupId).is('link_id', null);
      if (r.error) { console.warn('transfer pair delete failed', r.error); return false; }
      await window.fhPersonalHydrate(); return true;
    };
    window.fhPersonalDeleteDebtRow = window.fhPersonalDeleteExpense;   // same guard: private rows only

    /* Accounts auto-materialize (Q15): first sight of a (kind, provider, tail)
       creates the instrument; the user renames/limits it later. Client-side
       match is enough — owner-only table, single writer per user in practice;
       a lost race hits the 0105 partial-unique index and we refetch. */
    window.fhPersonalAccountEnsure = async function (info) {
      if (!P.uid || !P.key || !info || !info.kind) return null;
      const prov = (info.provider || '').toLowerCase() || null;
      const tail = (info.tail || '').replace(/\D/g, '').slice(-4) || null;
      /* Identity is the NUMBER, not our guess of the kind. A (provider, tail)
         pair names one instrument; matching kind too is how one heuristic
         mis-guess minted a phantom duplicate of a real account (2026-09-02).
         Kind only participates when there is no tail to identify by. */
      const _match = (a) => tail
        ? ((a.provider || '') === (prov || '') && (a.tail || '') === tail)
        : (a.kind === info.kind && (a.provider || '') === (prov || '') && !a.tail);
      const hit = P.accounts.find(_match);
      if (hit) return hit.id;
      const name = info.name || ((prov ? prov.charAt(0).toUpperCase() + prov.slice(1) : 'Tài khoản') + (tail ? ' ••' + tail : ''));
      const r = await _sb().from('personal_accounts').insert({ owner_user_id: P.uid, kind: info.kind,
        provider: prov, tail: tail, name_enc: await _encP(name) }).select('id').single();
      if (r.error) {   // lost a race with ourselves → the row exists; refetch and rematch
        await window.fhPersonalHydrate();
        const again = P.accounts.find(_match);
        return again ? again.id : null;
      }
      P.accounts.push({ id: r.data.id, kind: info.kind, provider: prov, tail: tail, name: name, limitK: null, humanVerified: false });
      return r.data.id;
    };
    window.fhPersonalCashAccount = function () {
      const hit = P.accounts.find((a) => a.kind === 'cash');
      return hit ? Promise.resolve(hit.id) : window.fhPersonalAccountEnsure({ kind: 'cash', name: 'Tiền mặt' });
    };
    /* Manual account creation (0109): for instruments capture never sees — a
       bank that sends no alert emails, a savings account. Deliberately NOT
       ensure(): two manual deposit accounts share (kind, provider null, tail
       null) and ensure would collapse them; here the NAME is the identity. */
    window.fhPersonalAccountCreate = async function (name, kind) {
      if (!P.uid || !P.key || !name) return null;
      const r = await _sb().from('personal_accounts').insert({ owner_user_id: P.uid,
        kind: kind || 'deposit', provider: null, tail: null,
        name_enc: await _encP(name), human_verified: true }).select('id').single();
      if (r.error) { console.warn('account create failed', r.error); return null; }
      await window.fhPersonalHydrate();
      return r.data.id;
    };
    window.fhPersonalAccountUpdate = async function (id, fields) {
      if (!P.uid || !P.key || !id) return false;
      const row = {};
      if (fields.name != null) row.name_enc = await _encP(fields.name);
      if (fields.limitK != null) row.credit_limit_enc = fields.limitK > 0 ? await _encP(Number(fields.limitK)) : null;
      if (fields.kind) row.kind = fields.kind;
      if (fields.humanVerified != null) row.human_verified = !!fields.humanVerified;
      if (fields.hasOwnProperty('statementDay')) row.statement_day = fields.statementDay || null;
      if (fields.hasOwnProperty('dueDay')) row.due_day = fields.dueDay || null;
      /* Full receiving account number (0122) — typed once for VietQR, sealed. */
      if (fields.hasOwnProperty('accountNumber')) row.account_number_enc = fields.accountNumber ? await _encP(String(fields.accountNumber)) : null;
      if (fields.archived) row.archived_at = new Date().toISOString();
      const r = await _sb().from('personal_accounts').update(row).eq('id', id).eq('owner_user_id', P.uid);
      if (r.error) { console.warn('account update failed', r.error); return false; }
      await window.fhPersonalHydrate(); return true;
    };

    /* The zoom-out numbers. Pure derivation over P.debts/P.accounts — spaces
       are merged in by the UI from the spaces module (different key domain). */
    window.fhPersonalDebts = function () {
      const cards = [], people = {}, byAcct = {};
      for (const d of P.debts) {
        if (d._unreadable) continue;
        if (d.accountId) {
          const b = byAcct[d.accountId] || (byAcct[d.accountId] = { spend: 0, paid: 0, rows: [] });
          if (d.kind === 'expense') b.spend += d.amt;
          else if (d.kind === 'transfer') b.paid += d.amt;
          b.rows.push(d);
        }
        if (d.kind === 'loan' || d.kind === 'repayment') {
          const k = d.who || '—';
          const p = people[k] || (people[k] = { who: k, loan: 0, repaid: 0, rows: [] });
          if (d.kind === 'loan') p.loan += d.amt; else p.repaid += d.amt;
          p.rows.push(d);
        }
      }
      for (const a of P.accounts) {
        if (a.kind !== 'credit_card') continue;
        const b = byAcct[a.id] || { spend: 0, paid: 0, rows: [] };
        cards.push({ acct: a, outstanding: b.spend - b.paid, rows: b.rows });
      }
      const persons = Object.values(people).map((p) => ({ who: p.who, balance: p.loan - p.repaid, rows: p.rows }));
      let owe = 0, owed = 0;
      for (const c of cards) { if (c.outstanding > 0) owe += c.outstanding; else owed += -c.outstanding; }
      for (const p of persons) { if (p.balance > 0) owed += p.balance; else owe += -p.balance; }
      return { cards: cards, people: persons, byAcct: byAcct, owe: owe, owed: owed };
    };

    /* ═══ Account balances (0109, spec §5) ══════════════════════════════════════
       For every NON-card account: balance = anchor ± rows since the anchor.
       No anchor → no number (a derived balance with no anchor would be
       confidently wrong, which is worse than absent). "Since the anchor" =
       txn_date after the anchor's local day, plus same-day rows created after
       anchor_at — a row backdated to before the anchor deliberately does NOT
       move the balance, because the anchor already contained it.
       Contribution: expense −amt · income +amt · transfer +amt (pair legs carry
       their sign inside the ciphertext; a legacy top-up is +amt by the same
       0105 convention). Since 0122 an account-tagged loan/repayment moves the
       balance too — the money really left/entered the account: loan −amt
       (+X lent drains X; −X borrowed adds X), repayment +amt (+X received
       adds; −X paid drains). Untagged (manual) debt rows still skip.
       Since 0123 an investment leg moves it like a signed transfer leg:
       buy −X drains the funding account, sell +X fills the receiving one.
       Cards keep their outstanding derivation in fhPersonalDebts, untouched. */
    window.fhPersonalBalance = function (acctId) {
      const a = P.accounts.find((x) => x.id === acctId);
      if (!a || a.kind === 'credit_card' || a.anchorK == null) return null;
      const anchorDay = a.anchorAt ? _localDate(new Date(a.anchorAt)) : null;
      let bal = a.anchorK;
      for (const d of P.debts) {
        if (d.accountId !== acctId || d._unreadable || d.amt == null) continue;
        if (d.kind !== 'expense' && d.kind !== 'income' && d.kind !== 'transfer'
            && d.kind !== 'loan' && d.kind !== 'repayment' && d.kind !== 'investment') continue;
        if (anchorDay) {
          if (d.date < anchorDay) continue;
          if (d.date === anchorDay && (!d.ts || d.ts <= a.anchorAt)) continue;
        }
        bal += (d.kind === 'expense' || d.kind === 'loan') ? -d.amt : d.amt;
      }
      return bal;
    };
    /* Drift (spec §5.2): the bank's last self-stated balance vs the derived one.
       Only meaningful when both exist; a hair of float noise is not a drift. */
    window.fhPersonalDrift = function (acctId) {
      const a = P.accounts.find((x) => x.id === acctId);
      if (!a || a.extK == null) return null;
      const bal = window.fhPersonalBalance(acctId);
      if (bal == null) return null;
      const d = a.extK - bal;
      return Math.abs(d) < 0.5 ? null : { drift: d, extK: a.extK, extDate: a.extDate };
    };
    /* The anchor: "Số dư hiện tại", declared truth at this moment. */
    window.fhPersonalAnchorSet = async function (acctId, amtK) {
      if (!P.uid || !P.key || !acctId || !(isFinite(amtK))) return false;
      const r = await _sb().from('personal_accounts').update({
        anchor_balance_enc: await _encP(Number(amtK)), anchor_at: new Date().toISOString(),
      }).eq('id', acctId).eq('owner_user_id', P.uid);
      if (r.error) { console.warn('anchor set failed', r.error); return false; }
      await window.fhPersonalHydrate(); return true;
    };
    /* The bank's own "Số dư" from a captured mail — stored newest-wins so the
       drift badge always argues against the freshest statement, never an old one. */
    window.fhPersonalExtBalanceSet = async function (acctId, amtK, dateIso) {
      if (!P.uid || !P.key || !acctId || !(isFinite(amtK))) return false;
      const a = P.accounts.find((x) => x.id === acctId);
      const day = dateIso || _localDate(new Date());
      if (a && a.extDate && a.extDate > day) return true;   // an older statement never overwrites a newer one
      const r = await _sb().from('personal_accounts').update({
        ext_balance_enc: await _encP(Number(amtK)), ext_balance_date: day,
      }).eq('id', acctId).eq('owner_user_id', P.uid);
      if (r.error) { console.warn('ext balance set failed', r.error); return false; }
      if (a) { a.extK = Number(amtK); a.extDate = day; }   // local update — no full rehydrate for a side-signal
      return true;
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
        /* Cross-ledger move journal repair (0114 spec §8.3) — this is the one
           moment both ledgers are known ready, so an interrupted move finishes
           its second half here. Idempotent; a no-op when the journal is empty. */
        try { if (window.fhLedgerMoveResume) await fhLedgerMoveResume(); } catch (e) {}
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
        /* EVERY personal-DEK ciphertext, one sweep: the spine (income folded in
           since 0109 — no separate incomes pass any more), the accounts (names,
           limits, the 0109 anchor + bank-stated balance) and the budgets. A
           rotation that misses a field makes that field unreadable forever, so
           the list here must grow with every _enc column the schema gains. */
        const tr = await _sb().from('personal_transactions').select('id,amount_enc,note_enc,cat_name_enc,counterparty_enc,occurred_time_enc,quantity_enc').eq('owner_user_id', P.uid);
        const ac = await _sb().from('personal_accounts').select('id,name_enc,credit_limit_enc,anchor_balance_enc,ext_balance_enc,account_number_enc,asset_symbol_enc,asset_unit_enc,asset_class_enc,manual_price_enc').eq('owner_user_id', P.uid);
        const bg = await _sb().from('personal_budgets').select('owner_user_id,month,total_enc,cats_enc').eq('owner_user_id', P.uid);
        const ls = await _sb().from('personal_lessons').select('owner_user_id,lessons_enc').eq('owner_user_id', P.uid);
        const rm = await _sb().from('personal_review_memory').select('id,key_enc').eq('owner_user_id', P.uid);
        const ph = await _sb().from('personal_transaction_photos').select('id,photo_url').eq('owner_user_id', P.uid);
        const tot = (tr.data || []).length + (ac.data || []).length + (bg.data || []).length + (ls.data || []).length + (rm.data || []).length + (ph.data || []).length; let n = 0;
        for (const r of (tr.data || [])) {
          const u = await _sb().from('personal_transactions').update({ amount_enc: await reEnc(r.amount_enc), note_enc: await reEnc(r.note_enc), cat_name_enc: await reEnc(r.cat_name_enc), counterparty_enc: await reEnc(r.counterparty_enc), occurred_time_enc: await reEnc(r.occurred_time_enc), quantity_enc: await reEnc(r.quantity_enc) }).eq('id', r.id);
          if (u.error) throw u.error; n++; if (onProgress) onProgress(n, tot);
        }
        for (const r of (ac.data || [])) {
          const u = await _sb().from('personal_accounts').update({ name_enc: await reEnc(r.name_enc), credit_limit_enc: await reEnc(r.credit_limit_enc), anchor_balance_enc: await reEnc(r.anchor_balance_enc), ext_balance_enc: await reEnc(r.ext_balance_enc), account_number_enc: await reEnc(r.account_number_enc), asset_symbol_enc: await reEnc(r.asset_symbol_enc), asset_unit_enc: await reEnc(r.asset_unit_enc), asset_class_enc: await reEnc(r.asset_class_enc), manual_price_enc: await reEnc(r.manual_price_enc) }).eq('id', r.id);
          if (u.error) throw u.error; n++; if (onProgress) onProgress(n, tot);
        }
        for (const r of (rm.data || [])) {
          const u = await _sb().from('personal_review_memory').update({ key_enc: await reEnc(r.key_enc) }).eq('id', r.id);
          if (u.error) throw u.error; n++; if (onProgress) onProgress(n, tot);
        }
        for (const r of (bg.data || [])) {
          const u = await _sb().from('personal_budgets').update({ total_enc: await reEnc(r.total_enc), cats_enc: await reEnc(r.cats_enc) }).eq('owner_user_id', P.uid).eq('month', r.month);
          if (u.error) throw u.error; n++; if (onProgress) onProgress(n, tot);
        }
        for (const r of (ls.data || [])) {
          const u = await _sb().from('personal_lessons').update({ lessons_enc: await reEnc(r.lessons_enc) }).eq('owner_user_id', P.uid);
          if (u.error) throw u.error; n++; if (onProgress) onProgress(n, tot);
        }
        /* Photo OBJECTS (0114) are ciphertext under the personal DEK too — a
           rotation that skipped them would strand every receipt photo behind a
           retired key. Resumable like the columns: bytes already readable under
           the new key are skipped; a photo that cannot rotate aborts (throws)
           BEFORE the wrap swap, so the old card still opens everything. New
           path per object (paths are immutable-cache), old object removed. */
        for (const r of (ph.data || [])) {
          const resp = await fetch(_pPhotoUrl(r.photo_url));
          if (resp.ok) {
            const ct = new Uint8Array(await resp.arrayBuffer());
            let migrated = false;
            try { await FHCrypto.decBytes(newKey, ct); migrated = true; } catch (e) {}
            if (!migrated) {
              const pt = await FHCrypto.decBytes(P.key, ct);
              const enc = await FHCrypto.encBytes(newKey, pt);
              const ext = (r.photo_url.match(/\.(\w+\.enc)$/) || [])[1] || 'jpg.enc';
              const np = P.uid + '/' + Date.now() + '_' + Math.random().toString(36).slice(2, 8) + '.' + ext;
              const up = await _sb().storage.from('personal-media').upload(np, enc, { contentType: 'application/octet-stream', cacheControl: '31536000' });
              if (up.error) throw up.error;
              const uu = await _sb().from('personal_transaction_photos').update({ photo_url: np }).eq('id', r.id);
              if (uu.error) throw uu.error;
              try { await _sb().storage.from('personal-media').remove([r.photo_url]); } catch (e) {}
            }
          }
          n++; if (onProgress) onProgress(n, tot);
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
