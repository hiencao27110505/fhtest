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
    /* 0144 — a node code is kept only when the running tree knows it; a decrypt
       failure or a code from a newer tree reads as "no node" (rollup rule). */
    function _okNode(v) { return (typeof v === 'string' && window.FH_TAX && window.FH_TAX.get(v)) ? v : null; }
    P.labels = P.labels || [];
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

    /* ── warm snapshot — the landing tab's instant paint ─────────────────────
       Cá nhân is the landing tab, yet every open used to be a cold boot: nothing
       painted until auth + hydrate + a whole-ledger decrypt finished. The family
       tab solved this years ago with fh-snap; this is the personal twin. The
       last hydrated display slice is serialized, encrypted under the personal
       DEK (plaintext never hits disk — same stance as 17-snap-restore's enc
       tier), and stored in the fh-keys IDB — which the sign-out wipe already
       deletes wholesale, so it can never outlive the account on this device.
       Restore paints 'ready' before the first network round trip; the real
       hydrate then refreshes quietly (the ready view is kept through 'loading').
       Trust model: the snapshot sits beside the cached DEK itself, so it adds
       zero exposure an unlocked device didn't already have. */
    const _SNAP_TTL = 14 * 86400000;
    let _snapSavedAt = 0;
    const _incomesView = (txns) => txns.filter((t) => t.kind === 'income')
      .map((t) => ({ id: t.id, date: t.date, amt: t.amt, _unreadable: t._unreadable, note: t.note, cat: t.cat, accountId: t.accountId }));
    async function _snapRestore() {
      try {
        const rec = await _kGet('psnap:' + P.uid);
        if (!rec || !rec.key || (rec.at && Date.now() - rec.at > _SNAP_TTL)) return false;
        const s = JSON.parse(await FHCrypto.decVal(P.key, rec.key));
        if (!s || s.v !== 1 || s.uid !== P.uid || !Array.isArray(s.txns)) return false;
        P.txns = s.txns; P.debts = s.debts || []; P.accounts = s.accounts || []; P.memory = s.memory || []; P.labels = s.labels || [];
        P.budget = s.budget || 0; P.catBudget = s.catBudget || {};
        P.unreadable = s.unreadable || 0; P.debtsComplete = s.debtsComplete !== false;
        P.incomes = _incomesView(P.txns);
        P.fromSnapshot = true;                     // cleared by the first fresh hydrate
        _setState('ready');
        return true;
      } catch (e) { return false; }                // undecryptable/corrupt → cold boot, never an error
    }
    function _snapSave() {
      if (!P.key || !P.uid || P.fromSnapshot) return;          // only persist FRESH data
      if (Date.now() - _snapSavedAt < 2500) return;            // coalesce write bursts
      _snapSavedAt = Date.now();
      (async () => {
        try {
          const s = { v: 1, uid: P.uid, unreadable: P.unreadable || 0, debtsComplete: P.debtsComplete !== false,
            budget: P.budget || 0, catBudget: P.catBudget || {},
            txns: (P.txns || []).slice(0, 4000), accounts: P.accounts || [],
            debts: (P.debts || []).slice(0, 8000), memory: P.memory || [], labels: P.labels || [] };
          const ct = await FHCrypto.encVal(P.key, JSON.stringify(s));
          if (ct) await _kPut('psnap:' + P.uid, ct);
        } catch (e) {}                                          // a failed save only costs the next warm start
      })();
    }

    /* ── boot resilience ──────────────────────────────────────────────────────
       _booting is a re-entrancy latch, and it used to be a trap: if any await in
       the chain stalled (no fetch had a deadline), the finally never ran, the
       latch stayed true forever, and every later fhPersonalBoot call — tab tap,
       hydrate tail, even the error screen's own "Thử lại" — was a silent no-op.
       The only way out was killing the app. Three guards now:
       - a WATCHDOG that, after 12s of a boot that hasn't reached ready/locked,
         unlatches and shows the error state (which carries the retry link);
       - a GENERATION counter so a hung attempt that eventually resolves cannot
         clobber the state a newer attempt owns;
       - fhPersonalRetry, a hard retry that force-unlatches — wired to every
         retry affordance, so recovery never depends on the latch being honest.
       A completed boot also debounces 2.5s so the cold-open double-fire
       (afterLogin + the family hydrate's refresh call) costs one hydrate. */
    let _booting = false, _bootGen = 0, _bootDoneAt = 0;
    window.fhPersonalRetry = function () { _booting = false; _bootGen++; _bootDoneAt = 0; return window.fhPersonalBoot(); };
    window.fhPersonalBoot = async function () {
      if (_booting || !_sb()) return;
      if (P.state === 'ready' && Date.now() - _bootDoneAt < 2500) return;   // just refreshed — collapse the double-fire
      _booting = true;
      const gen = ++_bootGen;
      const watch = setTimeout(() => {
        if (gen !== _bootGen || !_booting) return;
        _booting = false;                                   // unlatch no matter what
        if (P.state === 'ready' || P.state === 'locked') return;
        /* A snapshot-painted tab sits in 'loading' while the background refresh
           hangs — that view is GOOD data. Settle it back to ready (stale, quiet)
           rather than tearing it down; only a tab with nothing gets the error. */
        if (window._persHadReady) _setState('ready'); else _setState('error');
      }, 12000);
      _decCache.clear();   // boot is the one place identity can change
      const setS = (s) => { if (gen === _bootGen) _setState(s); };   // stale attempts may not write state
      try {
        P.uid = await _uid(); if (!P.uid) { setS('error'); return; }
        const kc = await _kGet('p:' + P.uid);
        if (kc && kc.key) {
          P.key = kc.key;
          /* Warm start for the landing tab: paint the last-known ledger from the
             encrypted device snapshot BEFORE any network round trip, then let
             the hydrate refresh it quietly (same posture as the family tab's
             fh-snap). A missing/stale/undecryptable snapshot just stays cold. */
          if (P.state !== 'ready') await _snapRestore();
          await _afterKey(); return;
        }
        const wr = await _sb().from('personal_keys').select('kdf_salt,kdf_iters,kdf_version,wrapped_dek').eq('user_id', P.uid).maybeSingle();
        // NEVER provision on a read failure. A transient error (auth token not yet
        // refreshed on cold open, network blip, a 401 racing session restore) sets
        // wr.error and leaves wr.data null. Treating that as "no key exists" mints a
        // brand-new card every reopen — init_personal_key is ON CONFLICT DO NOTHING,
        // so the server wrap survives, but the user is shown a fresh (mismatched)
        // card each time and the real key scrolls away. Only provision when the read
        // DEFINITIVELY succeeded and returned no row.
        if (wr.error) { console.warn('personal_keys read failed', wr.error); setS('error'); return; }
        if (wr.data) { P.wrap = wr.data; setS('locked'); }
        else { await _provision(); }
      } catch (e) { console.warn('fhPersonalBoot failed', e); if (gen === _bootGen) _setState('error'); }
      finally {
        clearTimeout(watch);
        // Only this attempt's own latch: a hung attempt resolving late must not
        // release (or time-stamp) the boot a newer generation is running.
        if (gen === _bootGen) { _booting = false; _bootDoneAt = Date.now(); }
      }
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
      const gen = _bootGen;   // a retry-triggered newer boot orphans this pass: it must not write P
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
        /* Photos + review memory ride the SAME barrier now. They used to run
           serially after the decrypt loop — two extra round trips the landing
           tab waited on before 'ready', for data that is decorative. Both are
           failure-tolerant (a lost photo strip or pre-selection never costs the
           ledger), so they resolve to empty on error instead of failing the all. */
        const [tr, bd, ac, dr, pp, mm, lb] = await Promise.all([
          _pageAll(() => _sb().from('personal_transactions').select('id,amount_enc,note_enc,cat_name_enc,cat_emoji,occurred_time_enc,txn_date,kind,space_id,link_id,version,updated_at,created_at,account_id,transfer_group_id,position_account_id,quantity_enc,source,node_enc,label_id').eq('owner_user_id', P.uid).gte('txn_date', from).order('txn_date', { ascending: false }).order('id')),
          _sb().from('personal_budgets').select('total_enc,cats_enc').eq('owner_user_id', P.uid).eq('month', _monISO()).maybeSingle(),
          _sb().from('personal_accounts').select('id,kind,name_enc,tail,provider,credit_limit_enc,human_verified,statement_day,due_day,anchor_balance_enc,anchor_at,ext_balance_enc,ext_balance_date,account_number_enc,asset_symbol_enc,asset_unit_enc,asset_class_enc,manual_price_enc,manual_price_at,setup_skipped_at').eq('owner_user_id', P.uid).is('archived_at', null),
          _pageAll(() => _sb().from('personal_transactions').select('id,amount_enc,note_enc,counterparty_enc,cat_name_enc,cat_emoji,txn_date,kind,account_id,transfer_group_id,position_account_id,quantity_enc,due_date,created_at,node_enc,label_id').eq('owner_user_id', P.uid).or('kind.neq.expense,account_id.not.is.null').order('txn_date', { ascending: false }).order('id')),
          _sb().from('personal_transaction_photos').select('transaction_id,photo_url,sort_order').eq('owner_user_id', P.uid).order('sort_order').limit(800).then((r) => r, () => ({ data: null })),
          _sb().from('personal_review_memory').select('id,key_enc,position_account_id').eq('owner_user_id', P.uid).limit(500).then((r) => r, () => ({ data: null })),
          /* 0144 — the person's own labels (the L2 partition of the category tree).
             Best-effort like photos: a ledger must still load for someone whose
             labels row read failed, and an empty list simply means "not set up yet". */
          _sb().from('personal_labels').select('id,name_enc,emoji,sort_order,claims_enc').eq('owner_user_id', P.uid).is('archived_at', null).order('sort_order').limit(200).then((r) => r, () => ({ data: null })),
        ]);
        if (gen !== _bootGen) return;   // a newer boot owns P now — abandon before touching anything
        /* Ceiling honesty, same stance as the stats slice's `truncated`: a
           short debt read understates balances, so it is counted and declared,
           never silent. Nothing renders differently yet; the flag exists so a
           view CAN say so the day anyone reaches it. */
        /* Decode into LOCALS, assign to P in one block at the end. Two hydrates
           can overlap now (a hard retry racing a slow first pass); interleaved
           pushes into shared arrays once meant a merged, doubled ledger. Locals
           make each pass atomic; the generation guard decides who may land. */
        const debtsComplete = !!(tr.complete && dr.complete);
        if (!debtsComplete) console.warn('personal hydrate hit the page ceiling', { tr: tr.complete, dr: dr.complete });
        /* Their budget read goes through _decP too, so an unreadable budget must
           not become a number either — the sentinel is a string and Number() of
           it is NaN. Explicit rather than relying on `|| 0` to absorb it. */
        const _bRaw = (bd && bd.data) ? await _decP(bd.data.total_enc) : null;
        const budget = (_bRaw == null || _bRaw === _DEC_FAILED) ? 0 : (Number(_bRaw) || 0);
        /* Per-category budgets (0090): an encrypted JSON map { name: amount }.
           Same fail-closed stance — an unreadable map becomes {}, never a partial. */
        const _cRaw = (bd && bd.data && bd.data.cats_enc) ? await _decP(bd.data.cats_enc) : null;
        const catBudget = {};
        if (_cRaw != null && _cRaw !== _DEC_FAILED) {
          try { const m = JSON.parse(_cRaw); if (m && typeof m === 'object') for (const k in m) catBudget[k] = Number(m[k]) || 0; } catch (e) {}
        }
        /* Unreadable is a property of the AMOUNT only. A note or category that
           will not open costs a label; an amount that will not open corrupts
           money, so only that one takes the row out of every total. */
        const txns = []; let unreadable = 0;
        for (const t of tr.rows) {
          const a = await _decP(t.amount_enc), bad = (a === _DEC_FAILED);
          if (bad) unreadable++;
          const qRaw = t.quantity_enc ? await _decP(t.quantity_enc) : null;
          txns.push({ id: t.id, date: t.txn_date, kind: t.kind, spaceId: t.space_id, linkId: t.link_id,
            version: t.version || 1, updatedAt: t.updated_at, ts: t.created_at,
            src: t.source || null,
            accountId: t.account_id, transferGroupId: t.transfer_group_id,
            positionId: t.position_account_id || null,
            qty: (qRaw == null || qRaw === _DEC_FAILED) ? null : (Number(qRaw) || null),
            amt: bad ? null : Number(a), _unreadable: bad,
            note: await _decTxt(t.note_enc), cat: await _decTxt(t.cat_name_enc), node: _okNode(await _decTxt(t.node_enc)), labelId: t.label_id || null, emoji: t.cat_emoji,
            time: await _decTxt(t.occurred_time_enc) });   // local "HH:MM" if the time was known, else null (day-only)
        }
        /* 0144 — labels decode like every other personal value: fail-closed, and
           an unreadable claims blob costs the label its claims, never the label. */
        const labels = [];
        for (const l of (lb && lb.data) || []) {
          let claims = [];
          const cRaw = l.claims_enc ? await _decTxt(l.claims_enc) : null;
          if (cRaw) { try { const arr = JSON.parse(cRaw); if (Array.isArray(arr)) claims = arr.filter((x) => typeof x === 'string'); } catch (e) {} }
          labels.push({ id: l.id, name: await _decTxt(l.name_enc), emoji: l.emoji || '🏷️', sortOrder: l.sort_order || 0, claims: claims });
        }
        /* Photos (0114): attach public URLs to the window's rows; the photo
           observer decrypts /personal-media/ bytes in place. One owner-scoped
           query (never an id-list URL — the 891-id Cloudflare refusal scar). */
        const byTx = {};
        for (const p of (pp.data || [])) (byTx[p.transaction_id] = byTx[p.transaction_id] || []).push(_pPhotoUrl(p.photo_url));
        for (const t of txns) if (byTx[t.id]) t.photos = byTx[t.id];
        /* Instruments + debt rows. Same fail-closed stance: an unreadable amount
           takes the row out of every balance, counted and declared, never 0đ. */
        const accounts = [];
        for (const a of (ac.data || [])) {
          const lim = a.credit_limit_enc ? await _decP(a.credit_limit_enc) : null;
          const anch = a.anchor_balance_enc ? await _decP(a.anchor_balance_enc) : null;
          const ext = a.ext_balance_enc ? await _decP(a.ext_balance_enc) : null;
          const mpx = a.manual_price_enc ? await _decP(a.manual_price_enc) : null;
          accounts.push({ id: a.id, kind: a.kind, tail: a.tail, provider: a.provider,
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
            /* account setup (0134): "Để sau" on the setup wizard — the account
               stays unverified (no number) but is never re-asked at import */
            setupSkippedAt: a.setup_skipped_at || null,
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
        const debts = [];
        for (const t of dr.rows) {
          const a = await _decP(t.amount_enc), bad = (a === _DEC_FAILED);
          if (bad) unreadable++;
          const qRaw = t.quantity_enc ? await _decP(t.quantity_enc) : null;
          debts.push({ id: t.id, date: t.txn_date, kind: t.kind, accountId: t.account_id,
            transferGroupId: t.transfer_group_id, ts: t.created_at, due: t.due_date || null,
            positionId: t.position_account_id || null,
            qty: (qRaw == null || qRaw === _DEC_FAILED) ? null : (Number(qRaw) || null),
            amt: bad ? null : Number(a), _unreadable: bad,
            note: await _decTxt(t.note_enc), cat: await _decTxt(t.cat_name_enc), node: _okNode(await _decTxt(t.node_enc)), labelId: t.label_id || null, emoji: t.cat_emoji,
            who: await _decTxt(t.counterparty_enc) });
        }
        /* Review memory (0122): counterparty → position pre-selection for the
           review screen. An unreadable memory row is dropped (it only costs a
           pre-selection, never money). */
        const memory = [];
        for (const m of (mm.data || [])) {
          const k = await _decTxt(m.key_enc);
          if (k) memory.push({ id: m.id, key: k, positionId: m.position_account_id });
        }
        if (gen !== _bootGen) return;   // orphaned by a newer boot while decrypting
        P.debtsComplete = debtsComplete; P.budget = budget; P.catBudget = catBudget;
        P.txns = txns; P.unreadable = unreadable;
        /* Income lives on the spine since 0109 (kind='income'); P.incomes stays
           as a derived view so every existing reader (the income sheet, the
           month totals, the month picker) keeps its shape without knowing. */
        P.incomes = _incomesView(txns);
        P.accounts = accounts; P.debts = debts; P.memory = memory; P.labels = labels;
        P.fromSnapshot = false;                    // this is fresh data —
        _snapSave();                               // — worth caching for the next cold open
        _setState('ready');
        _accountHealSoon();                        // once per session: fold tail-less twins, canonical names
        /* 0144 — the tree, after the ledger is up and never before it: seed the
           person's labels on their first hydrate, then let the idle sweep give
           old rows a node. Both are best-effort; neither may cost a hydrate. */
        try { if (window.fhPersonalLabelsEnsureDefaults) window.fhPersonalLabelsEnsureDefaults(); } catch (e) {}
        try { if (window.fhTreeBackfill) window.fhTreeBackfill('personal'); } catch (e) {}

      } catch (e) {
        console.warn('personal hydrate failed', e);
        if (gen !== _bootGen) return;              // an orphaned pass may not flip state either
        /* A background refresh failing must not tear down a tab that is already
           showing good data (snapshot or a previous hydrate) — keep it, stale
           and quiet; only a tab with nothing on it gets the error screen. */
        if (window._persHadReady) _setState('ready'); else _setState('error');
      }
    };

    /* ── older history, on demand (txn-listing revamp Q17/Q20) ───────────────
       The tab hydrate stays 2 months — boot is sacred — so the Giao dịch
       screen, whose whole job is history, pays for its own depth: one fetch of
       months 3–6 back, decrypted into P.txnsOld. Never into P.txns: the
       mirror engine, budgets and tab math all key off the 2-month window and
       must not widen silently. Session-cached; sign-out drops P wholesale. */
    window.fhPersonalOlder = { state: 'idle' };            // idle | loading | done | error
    window.fhPersonalFetchOlder = async function () {
      const O = window.fhPersonalOlder;
      if (O.state === 'done') return true;
      if (O.state === 'loading') return false;
      if (!P.uid || !P.key) return false;
      O.state = 'loading';
      try {
        const to = _winFrom();
        const d = new Date(); d.setMonth(d.getMonth() - 5); d.setDate(1);
        const from = _localDate(d);
        const tr = await _pageAll(() => _sb().from('personal_transactions')
          .select('id,amount_enc,note_enc,cat_name_enc,cat_emoji,occurred_time_enc,txn_date,kind,space_id,link_id,account_id,transfer_group_id,position_account_id,source,node_enc,label_id')
          .eq('owner_user_id', P.uid).gte('txn_date', from).lt('txn_date', to)
          .order('txn_date', { ascending: false }).order('id'));
        const old = [];
        for (const t of tr.rows) {
          const a = await _decP(t.amount_enc), bad = (a === _DEC_FAILED);
          old.push({ id: t.id, date: t.txn_date, kind: t.kind, spaceId: t.space_id, linkId: t.link_id,
            src: t.source || null, accountId: t.account_id, transferGroupId: t.transfer_group_id,
            positionId: t.position_account_id || null, qty: null,
            amt: bad ? null : Number(a), _unreadable: bad,
            note: await _decTxt(t.note_enc), cat: await _decTxt(t.cat_name_enc), node: _okNode(await _decTxt(t.node_enc)), labelId: t.label_id || null, emoji: t.cat_emoji,
            time: await _decTxt(t.occurred_time_enc) });
        }
        P.txnsOld = old;
        O.state = 'done';
        return true;
      } catch (e) { console.warn('older history fetch failed', e); O.state = 'error'; return false; }
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
        /* Every kind, and the mirror link: the dedup engine (58) gates on kind
           itself and DROPS mirrors — a family row the person authored is copied
           here with link_id set, and indexing both let two staged copies of one
           purchase each claim "their own" booked row. */
        const r = await _pageAll(() => _sb().from('personal_transactions')
          .select('id,amount_enc,note_enc,cat_name_enc,txn_date,kind,link_id,occurred_time_enc,source,account_id,node_enc,label_id')
          .eq('owner_user_id', P.uid)
          .gte('txn_date', from)
          .order('txn_date', { ascending: false }).order('id'));
        const out = [];
        for (const t of r.rows) {
          const a = await _decP(t.amount_enc);
          if (a == null || a === _DEC_FAILED) continue;   // unreadable amount → cannot match, skip (fail closed)
          out.push({ id: t.id, date: t.txn_date, kind: t.kind, amt: Number(a), link: t.link_id || null, src: t.source || null, acct: t.account_id || null,
            note: await _decTxt(t.note_enc), cat: await _decTxt(t.cat_name_enc), node: _okNode(await _decTxt(t.node_enc)), labelId: t.label_id || null,
            time: t.occurred_time_enc ? (await _decTxt(t.occurred_time_enc)) : '' });
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
        /* occurred_time_enc + created_at ride along so the Buổi zoom works on
           any month (period-comparison-spec.md §6): the time is decrypted only
           for rows that have one, created_at is plain. */
        const r = await _pageAll(() => _sb().from('personal_transactions')
          .select('amount_enc,cat_name_enc,cat_emoji,txn_date,kind,space_id,occurred_time_enc,created_at,node_enc,label_id')
          .eq('owner_user_id', P.uid)
          .in('kind', ['expense', 'income'])
          .order('txn_date', { ascending: false }).order('id'));
        const rows = []; let unreadable = 0;
        for (const t of r.rows) {
          const a = await _decP(t.amount_enc);
          if (a === _DEC_FAILED) { unreadable++; continue; }
          if (a == null) continue;
          rows.push({ date: t.txn_date, kind: t.kind, amt: Number(a),
            cat: await _decTxt(t.cat_name_enc), node: _okNode(await _decTxt(t.node_enc)), labelId: t.label_id || null, emoji: t.cat_emoji, spaceId: t.space_id,
            time: t.occurred_time_enc ? await _decTxt(t.occurred_time_enc) : null, ts: t.created_at || null });
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
        account_id: (opts && opts.accountId) || null,
        node_enc: (opts && _okNode(opts.node)) ? await _encP(opts.node) : null,   // 0144: tree node
        label_id: (opts && opts.labelId) || null };
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
    /* `quiet` (bulk edit, txn-listing revamp): skip the per-call re-hydrate so a
       batch of N edits costs one hydrate at the end, not N — the caller MUST
       await fhPersonalHydrate() itself after the batch. */
    /* The AMOUNT only, every other field left exactly as it is. fhPersonalUpdateExpense
       below rewrites the whole row from `fields` -- hand it just an amount and it nulls
       the note, the category and the time. This exists for the one caller that has
       nothing but a better number: a card statement's final figure replacing the
       estimate a foreign purchase was booked at (56 csvFxAdopt). Private rows only,
       like every personal write; returns false when nothing matched (a mirror row). */
    /* The ACCOUNT only, and only where there was none. A statement row that the
       review proves is already booked knows what the booked row could not: which
       account it moved on (56 csvStmtTagTwin). Rows tagged by hand or by an earlier
       import keep their tag; this fills blanks, it never overrules. Private rows only. */
    window.fhPersonalSetAccount = async function (id, accountId) {
      if (!P.uid || !P.key || !id || !accountId) return false;
      const r = await _sb().from('personal_transactions').update({ account_id: accountId })
        .eq('id', id).eq('owner_user_id', P.uid).is('link_id', null).is('account_id', null).select('id');
      if (r.error) { console.warn('personal account tag failed', r.error); return false; }
      if (!r.data || !r.data.length) return false;
      const t = (P.txns || []).find((x) => x.id === id); if (t) t.accountId = accountId;
      if (window.fhPersonalMatchSliceInvalidate) window.fhPersonalMatchSliceInvalidate();
      return true;
    };

    window.fhPersonalSetAmount = async function (id, amt) {
      if (!P.uid || !P.key || !id || !(Number(amt) > 0)) return false;
      const r = await _sb().from('personal_transactions').update({ amount_enc: await _encP(Number(amt)) })
        .eq('id', id).eq('owner_user_id', P.uid).is('link_id', null).select('id');
      if (r.error) { console.warn('personal amount update failed', r.error); return false; }
      if (!r.data || !r.data.length) return false;
      await window.fhPersonalHydrate();
      return true;
    };

    window.fhPersonalUpdateExpense = async function (id, fields, quiet) {
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
      // 0144: node / labelId follow the same undefined = untouched, null = clear rule
      if (fields.hasOwnProperty('node')) row.node_enc = _okNode(fields.node) ? await _encP(fields.node) : null;
      if (fields.hasOwnProperty('labelId')) row.label_id = fields.labelId || null;
      const r = await _sb().from('personal_transactions').update(row).eq('id', id).eq('owner_user_id', P.uid).is('link_id', null);
      if (r.error) { console.warn('personal expense update failed', r.error); return false; }
      if (!quiet) await window.fhPersonalHydrate();
      return true;
    };
    window.fhPersonalDeleteExpense = async function (id, quiet) {
      if (!P.uid || !id) return false;
      // storage objects don't cascade — remove the photo files (and rows) first
      try { await window.fhPersonalRemovePhotoRows(id); } catch (e) {}
      const r = await _sb().from('personal_transactions').delete().eq('id', id).eq('owner_user_id', P.uid).is('link_id', null);
      if (r.error) { console.warn('personal expense delete failed', r.error); return false; }
      if (!quiet) await window.fhPersonalHydrate();
      return true;
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
    /* Income edit (same accountId contract as fhPersonalUpdateExpense: undefined =
       leave untouched, null = clear, id = set). Category and time are not touched —
       a review-committed income keeps its Lương/Thưởng tag through an edit. */
    window.fhPersonalUpdateIncome = async function (id, fields, quiet) {
      if (!P.uid || !P.key || !id) return false;
      const row = { amount_enc: await _encP(Number(fields.amt)),
        note_enc: fields.note ? await _encP(fields.note) : null };
      if (fields.dateIso) row.txn_date = fields.dateIso;
      if (fields.hasOwnProperty('accountId')) row.account_id = fields.accountId || null;
      if (fields.hasOwnProperty('time')) row.occurred_time_enc = fields.time ? await _encP(fields.time) : null;   // detail screen (2026-09-18)
      if (fields.hasOwnProperty('cat')) { row.cat_name_enc = fields.cat ? await _encP(fields.cat) : null; row.cat_emoji = fields.emoji || null; }
      if (fields.hasOwnProperty('node')) row.node_enc = _okNode(fields.node) ? await _encP(fields.node) : null;   // 0144
      const r = await _sb().from('personal_transactions').update(row).eq('id', id).eq('owner_user_id', P.uid).eq('kind', 'income').is('link_id', null);
      if (r.error) { console.warn('personal income update failed', r.error); return false; }
      if (!quiet) await window.fhPersonalHydrate();   // bulk batches hydrate once at the end
      return true;
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
      if (fields.hasOwnProperty('who')) row.counterparty_enc = fields.who ? await _encP(fields.who) : null;        // detail screen (2026-09-18)
      if (fields.hasOwnProperty('accountId')) row.account_id = fields.accountId || null;
      if (fields.hasOwnProperty('time')) row.occurred_time_enc = fields.time ? await _encP(fields.time) : null;
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
    /* An expense that was never consumption: money moved to another account of
       yours (a broker, a savings book, a second bank). The row is flipped IN
       PLACE into the out-leg of a transfer pair and the in-leg is inserted, so
       the money leaves the spending total and lands in the destination's
       balance instead of vanishing — a lone leg is exactly how a balance rots
       (full-ledger T4).

       Why a repair path at all: these arrive from bank mail as debits with a
       bare reference for a memo ("22853744443228090368"), which nothing can
       read as anything but spending. Five of them in one real ledger were
       ~200tr of investment funding counted as money spent. */
    window.fhPersonalConvertToTransfer = async function (id, toAccountId) {
      if (!P.uid || !P.key || !id || !toAccountId) return false;
      const cur = (P.txns || []).find((t) => t.id === id);
      if (!cur || cur.amt == null || cur._unreadable) return false;
      if (cur.accountId && cur.accountId === toAccountId) return false;   // a transfer to itself is not a transfer
      const amt = Math.abs(Number(cur.amt));
      if (!(amt > 0)) return false;
      const gid = crypto.randomUUID();
      const note = cur.note || null;
      /* Out-leg first and gated on kind='expense': if the in-leg insert then
         fails we are left with a lone leg, which the pair-repair affordance
         already knows how to show — never with a duplicate. */
      const up = await _sb().from('personal_transactions').update({
        kind: 'transfer', transfer_group_id: gid,
        amount_enc: await _encP(-amt),
        cat_name_enc: null, cat_emoji: null, node_enc: null,
      }).eq('id', id).eq('owner_user_id', P.uid).eq('kind', 'expense').is('link_id', null).select('id');
      if (up.error || !up.data || up.data.length !== 1) { console.warn('convert to transfer failed', up.error); return false; }
      const ins = await _sb().from('personal_transactions').insert({
        owner_user_id: P.uid, txn_date: cur.date, kind: 'transfer', space_id: null, link_id: null,
        amount_enc: await _encP(amt), note_enc: note ? await _encP(note) : null,
        account_id: toAccountId, transfer_group_id: gid, source: cur.src || null,
      });
      if (ins.error) console.warn('transfer in-leg failed', ins.error);   // the out-leg stands; the pair repairs
      await window.fhPersonalHydrate();
      return true;
    };
    /* And back: a transfer leg that was a plain expense after all. Removes the
       partner leg with it, so the pair never half-survives. */
    window.fhPersonalConvertTransferToExpense = async function (id, catName, catEmoji) {
      if (!P.uid || !P.key || !id) return false;
      const cur = (P.txns || []).find((t) => t.id === id);
      if (!cur || cur.amt == null || cur._unreadable) return false;
      if (cur.transferGroupId) {
        await _sb().from('personal_transactions').delete()
          .eq('owner_user_id', P.uid).eq('transfer_group_id', cur.transferGroupId).neq('id', id);
      }
      const r = await _sb().from('personal_transactions').update({
        kind: 'expense', transfer_group_id: null,
        amount_enc: await _encP(Math.abs(Number(cur.amt))),
        cat_name_enc: catName ? await _encP(catName) : null, cat_emoji: catEmoji || null,
      }).eq('id', id).eq('owner_user_id', P.uid).eq('kind', 'transfer').is('link_id', null);
      if (r.error) { console.warn('convert transfer to expense failed', r.error); return false; }
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
          node_enc: _okNode(s.node) ? await _encP(s.node) : null,   // 0144: the tree node the review decided
          label_id: s.labelId || null,
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
        if (fields.hasOwnProperty('time')) row.occurred_time_enc = fields.time ? await _encP(fields.time) : null;   // detail screen (2026-09-18): one time for both legs
        const legAcct = (leg.amt != null && leg.amt < 0) ? fields.fromAccountId : fields.toAccountId;   // the debit leg is "from", the credit leg is "to"
        if (legAcct) row.account_id = legAcct;
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
      /* No tail: identity is the PROVIDER, still never the kind — a VCB credit
         alert without a number and a VCB balance alert without a number are
         one bank seen through two mail shapes, and matching on kind minted a
         "Vietcombank" twin (found 2026-09-13). Prefer a same-kind tail-less
         account when several exist, else any tail-less one for the provider. */
      const _match = (a) => tail
        ? ((a.provider || '') === (prov || '') && (a.tail || '') === tail)
        : ((a.provider || '') === (prov || '') && !a.tail);
      let hit = tail ? P.accounts.find(_match)
        : (P.accounts.find((a) => _match(a) && a.kind === info.kind) || P.accounts.find(_match));
      /* No tail but a provider that owns exactly ONE account: adopt it. A bank
         that prints its number on some mails and not others is one account,
         not two; a provider with several accounts stays ambiguous → tail-less. */
      if (!hit && !tail && prov) {
        const byProv = P.accounts.filter((a) => (a.provider || '') === prov && a.kind !== 'investment');
        if (byProv.length === 1) hit = byProv[0];
      }
      /* A caller with a tail but NO provider still means one specific
         instrument. If exactly one active account carries that tail, adopt it
         rather than minting a provider-null twin (the "Tài khoản ••4751"
         duplicate, 2026-09-06). Two accounts sharing a tail is ambiguous —
         fall through to the exact match's verdict. */
      if (!hit && tail && !prov) {
        const byTail = P.accounts.filter((a) => (a.tail || '') === tail);
        if (byTail.length === 1) hit = byTail[0];
      }
      if (hit) return hit.id;
      /* No tail, and the provider already has SEVERAL accounts: this row cannot say
         which one it belongs to, and the old answer -- mint a tail-less "VIB" beside
         "VIB ••4751" and "VIB ••5140" -- was a ghost that collected 75 rows nobody
         could place (2026-09-19). An untagged row is one tap from right; a ghost
         account is a wrong balance and a picker entry that means nothing. So: no
         account. The census and every import path already treat null as "untagged". */
      if (!tail && prov && P.accounts.some((a) => (a.provider || '') === prov && a.kind !== 'investment')) return null;
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
    /* One-time-per-session self-heal of the account list (2026-09-13):
         1. a tail-less twin — an un-anchored, never-verified account with a
            provider but no number, whose provider has another account — is
            folded into that sibling (its rows re-tagged, then archived). The
            kind-keyed tail-less match that minted these is gone from ensure();
            this cleans up what it already made. Prefers a tail-less sibling,
            else the provider's single account; several tailed siblings and no
            tail-less one stays ambiguous and is left alone.
         2. a default name from the old ensure() ("Vib ••5140") is rewritten
            to the provider canon ("VIB ••5140") while the person has never
            renamed it (human_verified false).
       Fire-and-forget after the first ready hydrate; re-hydrates on change. */
    let _healed = false;
    function _accountHealSoon() {
      if (_healed || !P.uid || !P.key) return;
      _healed = true;
      setTimeout(() => { _accountHeal().catch((e) => console.warn('account heal failed', e)); }, 1500);
    }
    async function _accountHeal() {
      const live = (P.accounts || []).filter((a) => a.kind !== 'investment');
      const gone = {}; let changed = false;
      for (const a of live) {
        if (gone[a.id] || a.tail || !a.provider || a.anchorK != null || a.humanVerified) continue;
        const sibs = live.filter((b) => b.id !== a.id && !gone[b.id] && (b.provider || '') === a.provider);
        if (!sibs.length) continue;
        const target = sibs.find((b) => !b.tail) || (sibs.length === 1 ? sibs[0] : null);
        if (!target) continue;
        const mv = await _sb().from('personal_transactions').update({ account_id: target.id }).eq('owner_user_id', P.uid).eq('account_id', a.id);
        if (mv.error) { console.warn('account heal: retag failed', mv.error); continue; }
        const ar = await _sb().from('personal_accounts').update({ archived_at: new Date().toISOString() }).eq('id', a.id).eq('owner_user_id', P.uid);
        if (ar.error) { console.warn('account heal: archive failed', ar.error); continue; }
        gone[a.id] = 1; changed = true;
      }
      const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
      for (const a of live) {
        if (gone[a.id] || a.humanVerified || !a.provider || !a.name) continue;
        if (a.name !== cap(a.provider) + (a.tail ? ' ••' + a.tail : '')) continue;   // only the old default, never a person's name
        const disp = (typeof window.fhProviderName === 'function') ? window.fhProviderName(a.provider) : '';
        if (!disp || disp === cap(a.provider)) continue;
        const r = await _sb().from('personal_accounts').update({ name_enc: await _encP(disp + (a.tail ? ' ••' + a.tail : '')) }).eq('id', a.id).eq('owner_user_id', P.uid);
        if (!r.error) changed = true;
      }
      if (changed) await window.fhPersonalHydrate();
    }
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
      /* Setup wizard "Để sau" (0134): remembered per account so the next import
         never re-asks; setting an anchor later clears it implicitly (the
         wizard filters on anchorK first). */
      if (fields.hasOwnProperty('setupSkipped')) row.setup_skipped_at = fields.setupSkipped ? new Date().toISOString() : null;
      /* The setup wizard sets name/kind/card config AND the anchor in one
         write (one hydrate per account, not two). Same semantics as
         fhPersonalAnchorSet: declared truth now, older bank numbers dropped.
         Cards pass a NEGATIVE value (a liability is a negative asset). */
      if (fields.hasOwnProperty('anchorK') && isFinite(fields.anchorK)) {
        row.anchor_balance_enc = await _encP(Number(fields.anchorK)); row.anchor_at = new Date().toISOString();
        row.ext_balance_enc = null; row.ext_balance_date = null;
      }
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
        /* Account setup (0134): a card's outstanding is TRUSTED only once the
           person has anchored it ("dư nợ hiện tại", stored as a negative asset
           balance so fhPersonalBalance serves every kind). Until then the
           window-derived Σ purchases − Σ payments is kept for the detail
           screen's reconcile copy, but the card is unverified: no number on
           the tile, and it stays OUT of the Tôi nợ / Được nợ totals — a
           lookback window of email cannot know the balance carried in from
           before it, and a pre-window statement payment once flipped a card
           to "Đang dư" and inflated Được nợ on day one. */
        const bal = a.anchorK != null ? window.fhPersonalBalance(a.id) : null;
        const verified = bal != null;
        cards.push({ acct: a, outstanding: verified ? -bal : (b.spend - b.paid), verified: verified, rows: b.rows });
      }
      const persons = Object.values(people).map((p) => ({ who: p.who, balance: p.loan - p.repaid, rows: p.rows }));
      let owe = 0, owed = 0;
      for (const c of cards) { if (!c.verified) continue; if (c.outstanding > 0) owe += c.outstanding; else owed += -c.outstanding; }
      for (const p of persons) { if (p.balance > 0) owed += p.balance; else owe += -p.balance; }
      /* accounts still awaiting setup — cards and balance accounts alike,
         skipped ones included: they are still "chưa thiết lập" */
      const unverified = P.accounts.filter((a) => a.kind !== 'investment' && a.anchorK == null).length;
      return { cards: cards, people: persons, byAcct: byAcct, owe: owe, owed: owed, unverified: unverified };
    };
    /* The accounts the setup wizard should walk (0134): every non-investment
       account with no anchor and no "Để sau", optionally narrowed to a set of
       ids (the accounts an import just touched). Ordered cards → bank →
       e-wallet → cash (spec Q20): a wrong card number damages trust most, cash
       is the one people most want to skip. */
    window.fhPersonalAccountSetupNeeded = function (onlyIds) {
      const rank = { credit_card: 0, deposit: 1, ewallet: 2, cash: 3 };
      return (P.accounts || [])
        .filter((a) => a.kind !== 'investment' && a.anchorK == null && !a.setupSkippedAt && (!onlyIds || onlyIds.indexOf(a.id) >= 0))
        .sort((a, b) => (rank[a.kind] == null ? 9 : rank[a.kind]) - (rank[b.kind] == null ? 9 : rank[b.kind]));
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
       Since 0134 CARDS use this too: the anchor is the declared "dư nợ hiện
       tại" stored NEGATIVE (a liability is a negative asset), so a purchase
       (−amt) deepens the debt, a payment or reconcile adjustment (+amt) draws
       it down, and fhPersonalDebts reads outstanding = −balance. Un-anchored
       cards return null here and fall back to the window-derived sum there. */
    window.fhPersonalBalance = function (acctId) {
      const a = P.accounts.find((x) => x.id === acctId);
      if (!a || a.anchorK == null) return null;
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
      /* A bank-stated balance OLDER than the anchor is stale by definition —
         the anchor superseded it. Without this, the first setup after a
         backfill argued against a "Số dư" from weeks ago (spec cause 6). */
      if (a.anchorAt && a.extDate && a.extDate < _localDate(new Date(a.anchorAt))) return null;
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
        /* the anchor is newer truth than any captured "Số dư" — drop the old
           bank number so drift can only argue from mail dated after this */
        ext_balance_enc: null, ext_balance_date: null,
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
      if (a && a.anchorAt && day < _localDate(new Date(a.anchorAt))) return true;   // pre-anchor mail is already inside the anchor (0134)
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
      /* No family, or nothing this account authored there: there is nothing to
         mirror, and the tab's "Đang đồng bộ…" note must not wait for a pass
         that will never come. Only a family key still warming up earns retries;
         when those run out the note clears too (it stayed forever before). */
      if (!fid || !myMem) { if (!P.mirrorRan) { P.mirrorRan = true; if (P.state === 'ready') _setState('ready'); } return; }
      if (!window.fhKeyReady || !fhKeyReady()) {
        if (_mirrorTries++ < 5) { _mirrorSoon(4000); return; }
        if (!P.mirrorRan) { P.mirrorRan = true; if (P.state === 'ready') _setState('ready'); }
        return;
      }
      _mirroring = true;
      try {
        /* Cross-ledger move journal repair (0114 spec §8.3) — this is the one
           moment both ledgers are known ready, so an interrupted move finishes
           its second half here. Idempotent; a no-op when the journal is empty. */
        try { if (window.fhLedgerMoveResume) await fhLedgerMoveResume(); } catch (e) {}
        const fc = await _sb().from('categories').select('id,name,name_enc,emoji').eq('family_id', fid).is('archived_at', null);
        const famCat = {}; for (const c of (fc.data || [])) famCat[c.id] = { name: c.name != null ? c.name : await fhDecStr(c.name_enc), emoji: c.emoji };
        const from = _winFrom();

        const un = await _sb().from('transactions').select('id,txn_date,category_id,amount,amount_enc,note,note_enc,occurred_time,occurred_time_enc,node,node_enc').eq('family_id', fid).eq('created_by', myMem).eq('status', 'realized').eq('kind', 'expense').is('link_id', null).gte('txn_date', from).limit(100);
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
          await _insertMaster(linkId, fid, rr.txn_date, amt, note, fc2.name, fc2.emoji, time, null, await _famNode(rr));
        }

        const ln = await _sb().from('transactions').select('id,link_id,txn_date,category_id,amount,amount_enc,note,note_enc,occurred_time,occurred_time_enc,updated_at,node,node_enc').eq('family_id', fid).eq('created_by', myMem).not('link_id', 'is', null).gte('txn_date', from).limit(400);
        const famBy = {}; (ln.data || []).forEach((r) => { famBy[r.link_id] = r; });
        const mq = await _sb().from('personal_transactions').select('id,link_id,txn_date,amount_enc,note_enc,occurred_time_enc,updated_at,version,created_at,node_enc').eq('owner_user_id', P.uid).eq('space_id', fid).not('link_id', 'is', null).gte('txn_date', from).order('created_at');
        const mastersBy = {};
        for (const r of (mq.data || [])) {
          if (mastersBy[r.link_id]) { await _sb().from('personal_transactions').delete().eq('id', r.id); continue; }   // self-heal dup
          mastersBy[r.link_id] = { id: r.id, updatedAt: r.updated_at, version: r.version || 1, amt: Number(await _decP(r.amount_enc)), note: await _decP(r.note_enc), time: await _decTxt(r.occurred_time_enc), node: _okNode(await _decTxt(r.node_enc)) };
        }
        for (const lid of Object.keys(famBy)) {
          const f = famBy[lid], m = mastersBy[lid];
          const amtS = f.amount != null ? String(f.amount) : await fhDecStr(f.amount_enc);
          if (amtS == null || amtS === '') continue;
          const amt = Number(amtS); if (!isFinite(amt)) continue;
          const note = f.note != null ? f.note : await fhDecStr(f.note_enc);
          const time = await _famTime(f);
          const fc2 = (f.category_id && famCat[f.category_id]) || {};
          const fNode = await _famNode(f);
          if (!m) { await _insertMaster(lid, fid, f.txn_date, amt, note, fc2.name, fc2.emoji, time, null, fNode); }
          else if (f.updated_at > m.updatedAt && (amt !== m.amt || (note || '') !== (m.note || '') || (time || '') !== (m.time || '') || (fNode || '') !== (m.node || ''))) {
            await _sb().from('personal_transactions').update({ amount_enc: await _encP(amt), note_enc: note ? await _encP(note) : null, cat_name_enc: fc2.name ? await _encP(fc2.name) : null, cat_emoji: fc2.emoji || null, txn_date: f.txn_date, occurred_time_enc: time ? await _encP(time) : null, node_enc: _okNode(fNode) ? await _encP(fNode) : null, version: (m.version || 1) + 1 }).eq('id', m.id);
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
        const tr = await _sb().from('personal_transactions').select('id,amount_enc,note_enc,cat_name_enc,counterparty_enc,occurred_time_enc,quantity_enc,node_enc').eq('owner_user_id', P.uid);
        const lb = await _sb().from('personal_labels').select('id,name_enc,claims_enc').eq('owner_user_id', P.uid);
        const ac = await _sb().from('personal_accounts').select('id,name_enc,credit_limit_enc,anchor_balance_enc,ext_balance_enc,account_number_enc,asset_symbol_enc,asset_unit_enc,asset_class_enc,manual_price_enc').eq('owner_user_id', P.uid);
        const bg = await _sb().from('personal_budgets').select('owner_user_id,month,total_enc,cats_enc').eq('owner_user_id', P.uid);
        const ls = await _sb().from('personal_lessons').select('owner_user_id,lessons_enc').eq('owner_user_id', P.uid);
        const rm = await _sb().from('personal_review_memory').select('id,key_enc').eq('owner_user_id', P.uid);
        const ph = await _sb().from('personal_transaction_photos').select('id,photo_url').eq('owner_user_id', P.uid);
        const tot = (tr.data || []).length + (ac.data || []).length + (bg.data || []).length + (ls.data || []).length + (rm.data || []).length + (ph.data || []).length + (lb.data || []).length; let n = 0;
        for (const r of (lb.data || [])) {   // 0144: personal labels ride the same sweep
          const u = await _sb().from('personal_labels').update({ name_enc: await reEnc(r.name_enc), claims_enc: await reEnc(r.claims_enc) }).eq('id', r.id);
          if (u.error) throw u.error; n++; if (onProgress) onProgress(n, tot);
        }
        for (const r of (tr.data || [])) {
          const u = await _sb().from('personal_transactions').update({ amount_enc: await reEnc(r.amount_enc), note_enc: await reEnc(r.note_enc), cat_name_enc: await reEnc(r.cat_name_enc), node_enc: await reEnc(r.node_enc), counterparty_enc: await reEnc(r.counterparty_enc), occurred_time_enc: await reEnc(r.occurred_time_enc), quantity_enc: await reEnc(r.quantity_enc) }).eq('id', r.id);
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

    async function _insertMaster(linkId, fid, dateIso, amt, note, catName, catEmoji, timeStr, accountId, node) {
      return _sb().from('personal_transactions').insert({ owner_user_id: P.uid, space_id: fid, link_id: linkId, txn_date: dateIso, kind: 'expense', version: 1,
        amount_enc: await _encP(amt), note_enc: note ? await _encP(note) : null, cat_name_enc: catName ? await _encP(catName) : null, cat_emoji: catEmoji || null,
        occurred_time_enc: timeStr ? await _encP(timeStr) : null,   // carry the family expense's time into the personal copy
        account_id: accountId || null,        // 0134: the author's instrument, known only on their device
        node_enc: _okNode(node) ? await _encP(node) : null });   // 0144: the family row's tree node
    }
    /* Account tag on a mirror master (0134, account-setup-spec §6). A family
       expense paid with the author's card must reach that card's outstanding,
       and only the author's device knows the card. The writer that creates the
       family row calls this right after the insert (link_id pre-set on the
       family row, exactly like publishing a private row); the mirror engine
       then finds the master already there and leaves it alone. If this insert
       fails (offline, a race), the engine repairs a tag-less master later and
       the person can tag it by hand from the detail screen. */
    window.fhPersonalInsertMaster = async function (linkId, fid, dateIso, amt, note, catName, catEmoji, timeStr, accountId, node) {
      if (!P.uid || !P.key || !linkId || !fid || !dateIso || !(isFinite(amt))) return false;
      const r = await _insertMaster(linkId, fid, dateIso, Number(amt), note, catName, catEmoji, timeStr, accountId, node);
      if (r.error) { console.warn('master insert failed', r.error); return false; }
      return true;
    };
    /* ── 0144: personal labels (the L2 partition) ───────────────────────────
       A label is the person's own bucket: a name, an emoji, and the tree nodes
       it claims. Names and claims are ciphertext like everything else here.
       cat_name_enc on each row keeps holding the label's NAME, so every reader
       written before labels existed keeps working unchanged. */
    window.fhPersonalLabelSave = async function (spec) {
      if (!P.uid || !P.key || !spec || !spec.name) return false;
      const claims = (spec.claims || []).filter((c) => c === '*' || (window.FH_TAX && FH_TAX.get(c)));
      const row = { name_enc: await _encP(String(spec.name)), emoji: spec.emoji || '🏷️',
        claims_enc: await _encP(JSON.stringify(claims)) };
      if (spec.hasOwnProperty('sortOrder')) row.sort_order = Number(spec.sortOrder) || 0;
      let r;
      if (spec.id) r = await _sb().from('personal_labels').update(row).eq('id', spec.id).eq('owner_user_id', P.uid);
      else r = await _sb().from('personal_labels').insert(Object.assign({ owner_user_id: P.uid, sort_order: (P.labels || []).length }, row));
      if (r.error) { console.warn('personal label save failed', r.error); return false; }
      await window.fhPersonalHydrate(); return true;
    };
    /* Archived, never deleted: rows point at the label and history must stay
       resolvable (the same rule the family categories follow). */
    window.fhPersonalLabelArchive = async function (id) {
      if (!P.uid || !P.key || !id) return false;
      const r = await _sb().from('personal_labels').update({ archived_at: new Date().toISOString() }).eq('id', id).eq('owner_user_id', P.uid);
      if (r.error) return false;
      await window.fhPersonalHydrate(); return true;
    };
    /* First-run partition for a person who has no labels yet: one label per
       distinct category name already on their rows (that IS their vocabulary),
       each claiming what the tree says the name means, plus a catch-all. Runs
       once, silently, and never overwrites a label the person already has. */
    window.fhPersonalLabelsEnsureDefaults = async function () {
      if (!P.uid || !P.key || (P.labels || []).length) return false;
      const seen = {}, out = [];
      for (const t of (P.txns || [])) {
        const nm = (t.cat || '').trim();
        if (!nm || seen[nm.toLowerCase()]) continue;
        seen[nm.toLowerCase()] = 1;
        out.push({ name: nm, emoji: t.emoji || '🏷️',
          claims: (typeof fhDefaultClaimsFor === 'function') ? fhDefaultClaimsFor(nm, t.emoji) : [] });
        if (out.length >= 24) break;
      }
      out.push({ name: 'Khác', emoji: '🗂️', claims: ['*'] });
      const rows = [];
      for (let i = 0; i < out.length; i++) {
        rows.push({ owner_user_id: P.uid, sort_order: i, emoji: out[i].emoji,
          name_enc: await _encP(out[i].name), claims_enc: await _encP(JSON.stringify(out[i].claims)) });
      }
      const r = await _sb().from('personal_labels').insert(rows);
      if (r.error) { console.warn('personal labels seed failed', r.error); return false; }
      await window.fhPersonalHydrate(); return true;
    };
    /* Patch ONLY the node of a personal row — the backfill's write. Private rows
       and mirror masters alike: the node describes what was bought, which is true
       of a master too, and it never touches the label or the amount. */
    window.fhPersonalSetNode = async function (id, node) {
      if (!P.uid || !P.key || !id) return false;
      const r = await _sb().from('personal_transactions').update({ node_enc: _okNode(node) ? await _encP(node) : null })
        .eq('id', id).eq('owner_user_id', P.uid);
      return !r.error;
    };
    /* Edit the account tag on a MIRROR master (the one field the personal
       side owns on a machine-owned row: the family ledger has no accounts, so
       nothing here can disagree with it). Private rows use fhPersonalUpdateExpense. */
    window.fhPersonalMasterSetAccount = async function (id, accountId) {
      if (!P.uid || !P.key || !id) return false;
      const r = await _sb().from('personal_transactions').update({ account_id: accountId || null })
        .eq('id', id).eq('owner_user_id', P.uid).not('link_id', 'is', null);
      if (r.error) { console.warn('master account set failed', r.error); return false; }
      await window.fhPersonalHydrate(); return true;
    };
    // Resolve a family row's occurred_time (plaintext for off/dual, ciphertext for enc).
    async function _famTime(r) { return r.occurred_time != null ? r.occurred_time : (r.occurred_time_enc ? await fhDecStr(r.occurred_time_enc) : null); }
    async function _famNode(r) { try { return _okNode(r.node != null ? r.node : (r.node_enc ? await fhDecStr(r.node_enc) : null)); } catch (e) { return null; } }
  })();
