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
    /* 0144: `node` joins kind/cat in the same encrypted blob. carry-rules-spec §7:
       `rule` (the person's standing rules), `pin` (values held on waiting rows
       after a rule changed under them) and `route` (Theo nguồn, per bank). */
    let L = { kind: {}, cat: {}, node: {}, tomb: {}, rule: {}, pin: {}, route: {}, recur: {} };
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

    /* 0144 — the tree node this person taught for a merchant, at this SIZE.
       Same key shape as the category lesson (merchant + amount band), because
       the reason is the same: "… chuyen tien" covers a 35k coffee and a 7M rent,
       and a lesson at one size must not relabel the other. The node is checked
       against the running tree on the way out, so a code from a newer build
       reads as "nothing taught" rather than a stray string. */
    function _nodeKey(input) {
      /* p2p-breakdown-spec P4: THE person key — fhPersonKey in 13-partition — so a
         person group in the queue or the breakdown and the lesson it teaches can
         never be keyed differently. `amount` is in ĐỒNG. Until 2026-09-29 the
         review passed đồng and every ledger caller passed base units, so a 5tr row
         was band d from the queue and band a from the ledger, and no ledger-taught
         lesson ever fired in the queue (P10). */
      if (typeof fhPersonKey === 'function') return fhPersonKey((input && input.counterparty) || '', (input && (input.memo || input.note)) || '', (input && input.amount) || 0);
      if (typeof csvPatternKey !== 'function' || typeof csvAmountBand !== 'function') return '';
      const k = csvPatternKey({ counterparty: (input && input.counterparty) || '',
        description: (input && (input.memo || input.note)) || '' });
      if (!k || k.length < 6) return '';
      return k + '|' + csvAmountBand((input && input.amount) || 0);
    }
    /* carry-rules-spec §9 (2, 3): a merchant also gets an amount-free lesson, as
       the category store has had all along — Grab is Grab at 30k and at 300k. A
       person-to-person transfer does not: the same name is rent at 7tr and a
       coffee repaid at 35k. The banded key is read first and always wins. */
    function _nodeBare(input) {
      const key = _nodeKey(input); if (!key) return '';
      const cp = (input && input.counterparty) || '', memo = (input && (input.memo || input.note)) || '';
      if (typeof window.fhLooksPersonToPerson === 'function') {
        try { if (window.fhLooksPersonToPerson({ note: memo, counterparty: cp, memo: memo })) return ''; } catch (e) { return ''; }
      } else return '';
      return 'm|' + key.slice(0, key.lastIndexOf('|'));
    }
    function _nodeAt(key) {
      const l = key && L.node[key]; if (!l || !l.node) return null;
      const tomb = L.tomb['node|' + key];
      if (tomb && !(l.t > tomb.t)) return null;
      return (window.FH_TAX && FH_TAX.get(l.node)) ? l.node : null;
    }
    window.fhLessonNode = function (input) {
      const key = _nodeKey(input); if (!key) return null;
      return _nodeAt(key) || _nodeAt(_nodeBare(input));
    };
    window.fhLessonLearnNode = function (input) {
      const node = input && input.node;
      if (!node || !(window.FH_TAX && FH_TAX.get(node))) return;
      const key = _nodeKey(input); if (!key) return;
      L.node[key] = { node: node, t: _now() };
      delete L.tomb['node|' + key];
      const bare = _nodeBare(input);
      if (bare) { L.node[bare] = { node: node, t: _now() }; delete L.tomb['node|' + bare]; }
      _saveSoon();
    };
    /* ── receipt ITEMS (receipt-enrichment-spec §20.4) ────────────────────
       The same encrypted node store, keyed by the item's SIGNATURE — the
       type phrase or Apple slot the worker sealed beside the node — so what
       a person says a "mũ bơi" is applies to the next one from any shop,
       with no call to anyone. Tombstoned like every other lesson, so a
       forgotten pick does not come back on the next sync. */
    window.fhLessonItemNode = function (sig) {
      if (!sig) return null;
      const key = 'item|' + sig;
      const l = L.node[key]; if (!l || !l.node) return null;
      const tomb = L.tomb['node|' + key];
      if (tomb && !(l.t > tomb.t)) return null;
      return (window.FH_TAX && FH_TAX.get(l.node)) ? l.node : null;
    };
    window.fhLessonLearnItemNode = function (sig, node) {
      if (!sig || !node || !(window.FH_TAX && FH_TAX.get(node))) return;
      const key = 'item|' + sig;
      L.node[key] = { node: node, t: _now() };
      delete L.tomb['node|' + key];
      _saveSoon();
    };
    window.fhLessonForgetItemNode = function (sig) {
      if (!sig) return;
      const key = 'item|' + sig;
      delete L.node[key];
      L.tomb['node|' + key] = { t: _now() };
      _saveSoon();
    };
    /* recurring-charges-spec RR5: a receipt's or a person's recurrence mark
       teaches the MERCHANT, so the next row from it is pre-marked before any
       receipt arrives. Key is the merchant key the engine derives
       (FH_RECUR.merchantKey); value is the period and who said so. A person's
       Không is a tombstone: it forgets AND blocks the pattern from re-marking. */
    window.fhLessonRecur = function (mkey) {
      if (!mkey) return null;
      const key = 'recur|' + mkey;
      const l = L.recur && L.recur[key]; if (!l || !l.period) return null;
      const tomb = L.tomb[key];
      if (tomb && !(l.t > tomb.t)) return null;
      return { period: l.period, source: l.source || 'person', amt: l.amt > 0 ? l.amt : null };
    };
    window.fhLessonRecurDeclined = function (mkey) {
      if (!mkey) return false;
      const key = 'recur|' + mkey;
      const tomb = L.tomb[key], l = L.recur && L.recur[key];
      return !!(tomb && !(l && l.t > tomb.t));
    };
    /* `amt` (detection v2, §18.6): the charge the lesson was taught about, in
       ledger units. One payee can bill a subscription AND one-off purchases
       (Apple), so the lesson applies to charges near that amount, not to
       everything the payee ever charges. */
    window.fhLessonLearnRecur = function (mkey, period, source, amt) {
      if (!mkey || ['weekly', 'monthly', 'yearly'].indexOf(period) < 0) return;
      const key = 'recur|' + mkey;
      if (!L.recur) L.recur = {};
      L.recur[key] = { period: period, source: source || 'person', t: _now() };
      if (Number(amt) > 0) L.recur[key].amt = Number(amt);
      delete L.tomb[key];
      _saveSoon();
    };
    window.fhLessonForgetRecur = function (mkey) {
      if (!mkey) return;
      const key = 'recur|' + mkey;
      if (L.recur) delete L.recur[key];
      L.tomb[key] = { t: _now() };
      _saveSoon();
    };
    window.fhLessonForgetNode = function (input) {
      const key = _nodeKey(input); if (!key) return;
      const was = L.node[key] && L.node[key].node, bare = _nodeBare(input);
      delete L.node[key];
      L.tomb['node|' + key] = { t: _now() };
      /* the amount-free lesson goes with it only when it says the same thing:
         forgetting one size must not erase what another size taught */
      if (bare && L.node[bare] && L.node[bare].node === was) { delete L.node[bare]; L.tomb['node|' + bare] = { t: _now() }; }
      _saveSoon();
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
      if (r.error || !r.data || !r.data.lessons_enc) return r.error ? null : { kind: {}, cat: {}, node: {}, tomb: {}, rule: {}, pin: {}, route: {}, recur: {} };
      try {
        const pt = await FHCrypto.decVal(P.key, r.data.lessons_enc);
        const d = JSON.parse(pt);
        return { kind: d.kind || {}, cat: d.cat || {}, node: d.node || {}, tomb: d.tomb || {},   // 2026-10-03: `node` was left out here, so every node lesson died on reload
                 rule: d.rule || {}, pin: d.pin || {}, route: d.route || {},
                 recur: d.recur || {} };   // recurring-charges-spec RR5: merchant → period
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
      /* 0144 — node lessons merge newest-wins, like kind. An older blob has no
         `node` map at all, which is simply "nothing taught yet". */
      for (const k in (remote.node || {})) {
        const r = remote.node[k], mine = L.node[k];
        if (!mine || r.t > mine.t) { L.node[k] = r; changed = true; }
      }
      /* rules, pins and routes: newest wins per id; a tombstone (rule|id, pin|id)
         newer than the copy keeps a deletion from coming back */
      ['rule', 'pin', 'route'].forEach(function (ns) {
        const src = remote[ns] || {};
        for (const k in src) {
          const r = src[k], mine = L[ns][k];
          if (!r || typeof r !== 'object') continue;
          if (!mine || (r.t || 0) > (mine.t || 0)) { L[ns][k] = r; changed = true; }
        }
      });
      return changed;
    }
    /* Load before the first save, always. The blob is ONE row that a save
       replaces whole, and the pull used to happen only when the review queue
       opened: a lesson taught from the ledger first (the detail screen, the
       carry) uploaded this session's few keys over everything the server held —
       loans, tombstones, every node lesson. A pull that fails, or a blob that
       will not decrypt, means NO save at all: the server copy is the only one
       and it is left alone until a later save can read it. */
    let _loading = null;
    async function _ensureLoaded() {
      if (_loaded) return true;
      if (!_loading) _loading = (async () => {
        const remote = await _pull();
        if (!remote) return false;
        if (_mergeIn(remote) && typeof window.csvLearnedMergeIn === 'function') { try { window.csvLearnedMergeIn(L.cat); } catch (e) {} }
        _loaded = true;
        if (typeof window.csvTxrRoutesMergeIn === 'function') { try { window.csvTxrRoutesMergeIn(window.fhRoutesSynced()); } catch (e) {} }
        return true;
      })().finally(() => { _loading = null; });
      return _loading;
    }
    async function _push() {
      const P = _P(); if (!P || !P.uid || !P.key) return;
      if (!(await _ensureLoaded())) return;               // never overwrite a copy we have not read
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
      await _ensureLoaded();
      _saveSoon();
      return true;
    };
    /* A category lesson just changed locally — mirror + schedule a push. */
    window.fhLessonsCatChanged = function (map) {
      L.cat = Object.assign({}, map || {});
      _saveSoon();
    };

    /* ═══ Rules (carry-rules-spec §7) ═════════════════════════════════════════
       A rule is { id, k, dir, band, set, name, t } — see 66-rules.js for what
       each part means. This module only keeps them: encrypted with everything
       else, merged newest-wins across devices, deleted by tombstone. */
    const _live = (ns, id) => {
      const r = L[ns][id]; if (!r) return null;
      const tomb = L.tomb[ns + '|' + id];
      return (tomb && !((r.t || 0) > tomb.t)) ? null : r;
    };
    window.fhRulesReady = function () { return _ensureLoaded(); };
    window.fhRulesAll = function () {
      return Object.keys(L.rule).map(function (id) { return _live('rule', id); }).filter(Boolean);
    };
    window.fhRuleGet = function (id) { return id ? _live('rule', id) : null; };
    window.fhRuleSave = function (rule) {
      if (!rule || !rule.id) return null;
      const r = JSON.parse(JSON.stringify(rule));
      r.t = Math.max(_now(), ((L.tomb['rule|' + r.id] || {}).t || 0) + 1);
      L.rule[r.id] = r;
      _saveSoon();
      return r;
    };
    window.fhRuleDelete = function (id) {
      if (!id) return;
      delete L.rule[id];
      L.tomb['rule|' + id] = { t: _now() };
      _saveSoon();
    };
    /* Pins: values held on ONE waiting row (by its staged id) after the rule that
       filled it was deleted or changed and the person chose to keep them. */
    window.fhRulePins = function () {
      const out = {};
      Object.keys(L.pin).forEach(function (id) { const p = _live('pin', id); if (p) out[id] = p; });
      return out;
    };
    window.fhRulePinSet = function (ids, set) {
      (ids || []).forEach(function (id) {
        if (!id) return;
        const cur = _live('pin', id);
        L.pin[id] = { set: Object.assign({}, (cur && cur.set) || {}, set || {}), t: _now() };
        delete L.tomb['pin|' + id];
      });
      _saveSoon();
    };
    window.fhRulePinDrop = function (ids) {
      let n = 0;
      (ids || []).forEach(function (id) { if (L.pin[id]) { delete L.pin[id]; L.tomb['pin|' + id] = { t: _now() }; n++; } });
      if (n) _saveSoon();
    };
    /* Theo nguồn, per bank: { bank: { v:'personal'|'family', t } }. The queue keeps
       its own map (56 csvTxrRoutes); this is the copy that travels. */
    window.fhRoutesSynced = function () {
      const out = {};
      Object.keys(L.route).forEach(function (b) { const r = L.route[b]; if (r && (r.v === 'personal' || r.v === 'family')) out[b] = r.v; });
      return out;
    };
    window.fhRoutesChanged = function (map) {
      let n = 0;
      Object.keys(map || {}).forEach(function (b) {
        const v = map[b]; if (v !== 'personal' && v !== 'family') return;
        if (!L.route[b] || L.route[b].v !== v) { L.route[b] = { v: v, t: _now() }; n++; }
      });
      if (n) _saveSoon();
    };
    /* The silent lessons, counted and forgotten as one thing: the list's last line
       (carry-rules-spec §5.3). Category lessons live in 57's store and are
       counted and cleared there. */
    window.fhLessonsCount = function () {
      let n = 0;
      Object.keys(L.node).forEach(function (k) {
        if (k.indexOf('m|') === 0) return;                 // the amount-free twin is the same lesson
        const l = L.node[k], tomb = L.tomb['node|' + k];
        if (l && l.node && !(tomb && !(l.t > tomb.t))) n++;
      });
      Object.keys(L.kind).forEach(function (k) {
        const l = L.kind[k], tomb = L.tomb['kind|' + k];
        if (l && l.n > 0 && !(tomb && !(l.t > tomb.t))) n++;
      });
      return n;
    };
    window.fhLessonsForgetAll = function () {
      const t = _now();
      Object.keys(L.node).forEach(function (k) { L.tomb['node|' + k] = { t: t }; });
      Object.keys(L.kind).forEach(function (k) { L.tomb['kind|' + k] = { t: t }; });
      L.node = {}; L.kind = {};
      _saveSoon();
    };
  })();
