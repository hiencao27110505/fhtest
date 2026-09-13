  /* ═══ Habit streaks — "Chuỗi thói quen" (0132) ═══════════════════════════════
     docs/specs/habit-streak-spec.md. No-spend streaks by merchant or category.

     Counts are DERIVED, never stored: current run = f(rule, ledger rows since
     started_on, staged email rows). A retroactive import retro-breaks; a staged
     row removed at review heals — there is no state to reconcile. The one
     persisted cache is the personal best (record_enc), merged by max.

     Matching:
       merchant — fhMerchantKey-normalized (57-csv-import-review, shared law)
                  CONTAINS the rule key. Structured counterparty first
                  (counterparty_enc, written by the promote path since this
                  module shipped), decrypted note as the fallback for
                  hand-typed and historic rows.
       category — case-folded exact match on the row's category name. Staged
                  rows match via the sealed category_hint (transport B carries
                  it; transport A rows simply can't match — stated in spec).

     Personal scope counts private rows + the user's own mirrors (evasion
     loophole otherwise), expenses only. Queue rows count debit-only.

     Lives in js-data like 23-debts-ui / 26-investment-ui so the section
     builder + sheets share the data layer. UI helpers (esc, fmt, L,
     fhMerchantKey, catStyle) are classic-script globals — guarded at call
     time, never at load time. */
  (function () {
    const _sb = () => window.sb;
    const _P = () => (window.fhPersonalData ? fhPersonalData() : null);
    const _L = (vi, en) => (typeof L === 'function' ? L(vi, en) : vi);
    const MAX_ACTIVE = 3, MILESTONES = [7, 14, 30, 100];

    const S = { defs: null, res: null, computing: false, sig: '', pendingQ: 0, arch: null, archOpen: false };
    window.fhStreakState = () => S;

    /* ── local-date helpers (never toISOString — the UTC month-shift scar) ── */
    const _d2 = (n) => String(n).padStart(2, '0');
    const _iso = (d) => d.getFullYear() + '-' + _d2(d.getMonth() + 1) + '-' + _d2(d.getDate());
    const _today = () => _iso(new Date());
    const _shift = (iso, n) => { const p = iso.split('-'); const d = new Date(+p[0], +p[1] - 1, +p[2]); d.setDate(d.getDate() + n); return _iso(d); };
    const _days = (a, b) => Math.round((new Date(b + 'T00:00:00') - new Date(a + 'T00:00:00')) / 864e5);

    function _norm(cp, memo) {
      if (typeof fhMerchantKey === 'function') return fhMerchantKey(cp, memo);
      return (String(cp || '') + ' ' + String(memo || '')).toLowerCase().trim();
    }
    const _foldCat = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();

    /* row: {who, note, cat}; staged rows map to the same shape. */
    function _matches(rule, row) {
      if (rule.type === 'category') return _foldCat(row.cat) === _foldCat(rule.key) && !!row.cat;
      const t = _norm(row.who || '', row.note || '');
      return !!rule.key && t.indexOf(rule.key) >= 0;
    }

    /* ── defs CRUD ─────────────────────────────────────────────────────────── */
    async function _loadDefs() {
      const P = _P(); if (!P || !P.uid || !P.key) return null;
      const r = await _sb().from('personal_streaks')
        .select('id,rule_enc,started_on,record_enc')
        .eq('owner_user_id', P.uid).is('archived_at', null).order('created_at');
      if (r.error) return null;
      const out = [];
      for (const row of (r.data || [])) {
        try {
          const rule = JSON.parse(await FHCrypto.decVal(P.key, row.rule_enc));
          let rec = 0;
          if (row.record_enc) { const v = await FHCrypto.decVal(P.key, row.record_enc); rec = Number(v) || 0; }
          out.push({ id: row.id, rule: rule, startedOn: row.started_on, record: rec });
        } catch (e) { /* unreadable def: skip, never guess */ }
      }
      return out;
    }
    window.fhStreakCreate = async function (rule) {
      const P = _P(); if (!P || !P.uid || !P.key) return false;
      if ((S.defs || []).length >= MAX_ACTIVE) return 'cap';
      rule = { type: rule.type, key: rule.key, label: rule.label, emoji: rule.emoji || '🎯', milestone: rule.milestone || 7 };
      if (rule.type === 'merchant') rule.key = _norm(rule.key, '');
      if (!rule.key) return false;
      const r = await _sb().from('personal_streaks').insert({
        owner_user_id: P.uid,
        rule_enc: await FHCrypto.encVal(P.key, JSON.stringify(rule)),
        started_on: _today(),
        record_enc: await FHCrypto.encVal(P.key, '0')
      });
      if (r.error) { console.warn('streak create failed', r.error); return false; }
      S.defs = null; S.sig = ''; return true;
    };
    window.fhStreakArchive = async function (id) {
      const r = await _sb().from('personal_streaks').update({ archived_at: new Date().toISOString() }).eq('id', id);
      if (r.error) return false;
      S.defs = null; S.sig = ''; S.arch = null; return true;
    };
    window.fhStreakSetMilestone = async function (id, m) {
      const P = _P(); const d = (S.defs || []).find((x) => x.id === id);
      if (!P || !P.key || !d) return false;
      d.rule.milestone = m;
      const r = await _sb().from('personal_streaks').update({
        rule_enc: await FHCrypto.encVal(P.key, JSON.stringify(d.rule)),
        updated_at: new Date().toISOString()
      }).eq('id', id);
      if (r.error) return false;
      S.sig = ''; return true;
    };
    async function _saveRecord(d, n) {
      const P = _P(); if (!P || !P.key || !(n > d.record)) return;
      d.record = n;
      await _sb().from('personal_streaks').update({
        record_enc: await FHCrypto.encVal(P.key, String(n)),
        updated_at: new Date().toISOString()
      }).eq('id', d.id);
    }

    /* ── the deep read — expenses since min(started_on) − 60d ─────────────────
       P.txns only covers the 2-month hydrate window; streaks need the run's
       whole life plus a 60-day pre-start slice for the money-kept average
       (fhPersonalMatchSlice precedent for the deliberate older read). */
    async function _rows(fromIso) {
      const P = _P(); if (!P || !P.uid || !P.key) return null;
      const r = await _sb().from('personal_transactions')
        .select('id,txn_date,kind,amount_enc,note_enc,cat_name_enc,cat_emoji,counterparty_enc')
        .eq('owner_user_id', P.uid).eq('kind', 'expense').gte('txn_date', fromIso)
        .order('txn_date', { ascending: false }).limit(4000);
      if (r.error) return null;
      const out = [];
      for (const t of r.data || []) {
        let amt = null, bad = false;
        try { amt = Number(await FHCrypto.decVal(P.key, t.amount_enc)); } catch (e) { bad = true; }
        const dec = async (c) => { if (!c) return null; try { return await FHCrypto.decVal(P.key, c); } catch (e) { return null; } };
        out.push({ date: t.txn_date, amt: bad ? null : amt, _unreadable: bad,
          note: await dec(t.note_enc), cat: await dec(t.cat_name_enc), emoji: t.cat_emoji,
          who: await dec(t.counterparty_enc) });
      }
      return out;
    }

    /* ── compute — pure over (defs, rows, staged, today) ─────────────────────── */
    function _compute(defs, rows, staged, today) {
      const res = {};
      for (const d of defs) {
        const from60 = _shift(d.startedOn, -60);
        const matchDates = [];       // dates with a matching txn ON/AFTER start
        let pre = { fares: [], first: null };   // pre-start slice: the money-kept model
        let lastBreakRow = null, unreadableOverlap = false, queued = 0;
        for (const r of rows) {
          if (r._unreadable) { if (r.date >= d.startedOn) unreadableOverlap = true; continue; }
          if (!_matches(d.rule, r)) continue;
          if (r.date >= d.startedOn && r.date <= today) {
            matchDates.push(r.date);
            if (!lastBreakRow || r.date > lastBreakRow.date) lastBreakRow = r;
          } else if (r.date >= from60 && r.date < d.startedOn) {
            pre.fares.push(r.amt || 0);
            if (!pre.first || r.date < pre.first) pre.first = r.date;
          }
        }
        for (const q of staged) {
          if (q.date < d.startedOn || q.date > today) continue;
          if (!_matches(d.rule, q)) continue;
          queued++;
          matchDates.push(q.date);
          if (!lastBreakRow || q.date > lastBreakRow.date) lastBreakRow = { date: q.date, amt: q.amt, staged: true };
        }
        matchDates.sort();
        const lastBreak = matchDates.length ? matchDates[matchDates.length - 1] : null;
        const anchor = lastBreak ? _shift(lastBreak, 1) : d.startedOn;
        const current = Math.max(0, _days(anchor, today) + 1);   // break today → 0
        /* best run inside the window (gaps between breaks), then the cache */
        let best = current, prev = _shift(d.startedOn, -1);
        for (const m of matchDates) { best = Math.max(best, _days(prev, m) - 1); prev = m; }
        best = Math.max(best, d.record || 0);
        /* Money kept — frequency × typical fare, not mean-over-60-days.
           Validated against real Grab history: the old `sum/60` undercounted
           dense/recent spend ~4× (9 days of rides divided by 60), and the mean
           fare was doubled by two atypical long trips. So instead:
             • typical fare = MEDIAN of matching fares (outlier-robust)
             • λ = matching events per day over the OBSERVED span (first
               matching txn → start, clamped 7–60d), not a fixed 60
             • confidence = min(1, n/6) shrinks the estimate on thin data
           perDay = λ × median × confidence; rides/day = λ × confidence.
           This reads as "~9 lần đã nhịn · ~425k" for a week of that commute —
           a figure the user can eyeball against their own ride list. */
        let avgDay = null, ridesDay = null;
        if (pre.fares.length >= 3) {
          const fs = pre.fares.slice().sort((a, b) => a - b), fn = fs.length;
          const median = (fs[(fn - 1) >> 1] + fs[fn >> 1]) / 2;
          const spanDays = Math.min(60, Math.max(7, _days(pre.first, d.startedOn)));
          const confidence = Math.min(1, fn / 6);
          ridesDay = (fn / spanDays) * confidence;
          avgDay = median * ridesDay;
        }
        res[d.id] = {
          current: current, record: best,
          weeks: Math.floor(current / 7), rem: current % 7,
          brokeOn: lastBreak, brokeAmt: lastBreakRow ? lastBreakRow.amt : null,
          brokeStaged: !!(lastBreakRow && lastBreakRow.staged),
          brokeRecent: lastBreak ? (_days(lastBreak, today) <= 6) : false,
          saved: avgDay != null ? Math.round(avgDay * current) : null,
          avgDay: avgDay, ridesDay: ridesDay,   // per-day spend + per-day events avoided (base units)
          queued: queued, unreadable: unreadableOverlap,
          milestone: d.rule.milestone || 7,
          breaks: matchDates.slice(), startedOn: d.startedOn   // per-day calendar in the detail sheet
        };
      }
      return res;   // record caches are persisted by each caller (personal vs family)
    }

    /* ── 6AM digest snapshot (0133) ──────────────────────────────────────────
       The SW composes the morning push from this — it can reach neither app
       state nor localStorage. Plaintext, on-device only, same exposure class
       as the card display cache. Own IDB ('fh-streaks'), never 'fh-keys':
       a version bump there from the SW would break the key cache. */
    function _digestPut(fam, defs, res) {
      try {
        const req = indexedDB.open('fh-streaks', 1);
        req.onupgradeneeded = function () { req.result.createObjectStore('kv'); };
        req.onsuccess = function () {
          const db = req.result;
          try {
            const tx = db.transaction('kv', 'readwrite'), st = tx.objectStore('kv');
            const g = st.get('digest');
            g.onsuccess = function () {
              const cur = (g.result && g.result.items) ? g.result : { items: [] };
              const keep = cur.items.filter((i) => !!i.fam !== !!fam);   // other scope's items survive
              const mine = defs.map((d) => {
                const r = res[d.id]; if (!r) return null;
                return { label: d.rule.label, cur: r.current, brokeOn: r.brokeOn, record: r.record, milestone: r.milestone, fam: !!fam };
              }).filter(Boolean);
              st.put({ t: Date.now(), day: _today(), items: keep.concat(mine) }, 'digest');
            };
            tx.oncomplete = function () { db.close(); };
          } catch (e) { db.close(); }
        };
      } catch (e) {}
    }

    /* ── staged peek adapter ── */
    async function _staged() {
      if (!window.fhStagedStreakPeek) return [];
      try { return await window.fhStagedStreakPeek(); } catch (e) { return []; }
    }

    /* ── orchestration — section render calls ensure(); recompute re-renders ── */
    window.fhStreaksEnsure = function () {
      const P = _P(); if (!P || !P.uid || !P.key) return;
      const sig = _today() + ':' + ((P.txns || []).length) + ':' + (S.defs ? S.defs.map((d) => d.id + (d.rule.milestone || 7)).join(',') : '?');
      if (sig === S.sig || S.computing) return;
      S.computing = true;
      (async () => {
        try {
          if (!S.defs) S.defs = await _loadDefs();
          if (!S.defs) return;                       // read error: keep last painted state
          if (S.defs.length) {
            let from = S.defs[0].startedOn;
            for (const d of S.defs) if (d.startedOn < from) from = d.startedOn;
            from = _shift(from, -60);
            const floor = _shift(_today(), -425);    // 365d run + 60d pre-slice cap
            if (from < floor) from = floor;
            const rows = await _rows(from);
            if (!rows) return;                       // read error: never render "broken" from an error
            const staged = await _staged();
            S.res = _compute(S.defs, rows, staged, _today());
            for (const d of S.defs) { const rr = S.res[d.id]; if (rr) _saveRecord(d, rr.record); }
            _digestPut(false, S.defs, S.res);
          } else { S.res = {}; _digestPut(false, [], {}); }
          S.sig = sig;
        } finally {
          S.computing = false;
          if (typeof renderPersonal === 'function') { try { renderPersonal(); } catch (e) {} }
        }
      })();
    };
    window.fhStreaksInvalidate = function () { S.sig = ''; };

    /* ═══ UI — the section (mockup #6, stamp card) ═══════════════════════════ */
    const _esc = (s) => (typeof esc === 'function' ? esc(s) : String(s || ''));

    /* ═══ The outside card (Option 8) — money band + 2-week calendar + medal
       shelf carrying each milestone's projected savings. A compressed twin of
       the detail sheet: same .stk-cc cells, same .stk-medal tiles, so tapping
       the card grows it into the sheet. ─────────────────────────────────────── */
    // A 2-week window (this week + next), so recent clean days AND the upcoming
    // milestone flag are both on screen; the detail shows the whole month.
    function _cardCal(r) {
      const today = _today();
      const now = new Date(today + 'T00:00:00');
      const monday = _shift(today, -((now.getDay() + 6) % 7));
      const brk = {}; (r.breaks || []).forEach((b) => { brk[b] = 1; });
      const started = r.startedOn || today;
      const msIso = {}; if (r.current > 0) for (const m of MILESTONES) msIso[_shift(today, m - r.current)] = _MEDAL[m];
      const dows = _L('T2 T3 T4 T5 T6 T7 CN', 'Mo Tu We Th Fr Sa Su').split(' ');
      let head = ''; for (const w of dows) head += '<span class="stk-dow">' + w + '</span>';
      let cells = '';
      for (let i = 0; i < 14; i++) {
        const iso = _shift(monday, i), dd = Number(iso.slice(8, 10));
        const cls = iso > today ? 'fut' : (iso < started ? 'pre' : (brk[iso] ? 'x' : (iso === today ? 'today' : 'ok')));
        const flag = msIso[iso] ? '<i class="stk-cc-flag">' + msIso[iso] + '</i>' : '';
        cells += '<span class="stk-cc ' + cls + (flag ? ' ms' : '') + ' num">' + dd + flag + '</span>';
      }
      return '<div class="stk-cal-wrap"><div class="stk-cal-h"><span>' + _L('Tháng ' + (now.getMonth() + 1), _MON_EN[now.getMonth()]) + '</span>'
        + '<span class="stk-legend"><i class="ok"></i>' + _L('sạch', 'clean') + '<i class="today"></i>' + _L('nay', 'today') + '<i class="x"></i>' + _L('lỡ', 'slip') + '</span></div>'
        + '<div class="stk-dows">' + head + '</div><div class="stk-cal" style="margin-top:4px">' + cells + '</div></div>';
    }
    // Medal shelf, display-only (the whole card is one tap into the detail).
    // With money known, each tile shows the savings at that milestone; earned
    // shows "đã đạt". Without money, it degrades to the detail's aim/day labels.
    function _cardMedals(d, r, hasMoney) {
      const cur = r.current || 0, rec = r.record || 0, ms = r.milestone || 7;
      let h = '';
      for (const m of MILESTONES) {
        const earned = Math.max(rec, cur) >= m;
        const cls = earned ? 'earned' : (m === ms ? 'target' : 'lock');
        let sub, subCls;
        if (earned) { sub = _L('đã đạt', 'done'); subCls = 'stk-medal-s'; }
        else if (hasMoney) { sub = '~' + fmt(Math.round(r.avgDay * m)); subCls = 'stk-medal-m'; }
        else { sub = (m === ms ? _L('nhắm', 'aim') : _L('ngày', 'days')); subCls = 'stk-medal-s'; }
        h += '<div class="stk-medal ' + cls + '"><div class="stk-medal-e">' + _MEDAL[m] + '</div><div class="stk-medal-n">' + m + '</div><div class="' + subCls + '">' + sub + '</div></div>';
      }
      return h;
    }
    function _cardWarn(r) {
      let h = '';
      if (r.queued > 0 && r.brokeOn !== _today()) h += '<div class="stk-warn">' + _L('Còn ' + r.queued + ' khoản email chưa duyệt trùng chuỗi', r.queued + ' unreviewed email item(s) overlap') + '</div>';
      if (r.unreadable) h += '<div class="stk-warn">' + _L('Có khoản chưa đọc được trong khoảng này', 'Some rows in range are unreadable') + '</div>';
      return h;
    }
    // The full card body: header + band + calendar + medals + warnings.
    function _cardBody(d, r, fam, avs) {
      const nm = '<div class="stk-head"><span class="stk-emo">' + _esc(d.rule.emoji) + '</span>'
        + '<span class="stk-name">' + _L(fam ? 'Cả nhà không ' : 'Không ', 'No ') + _esc(d.rule.label) + '</span>'
        + (fam ? '<span class="stk-avs">' + (avs || '') + '</span>' : '<span class="stk-chevr"></span>') + '</div>';
      if (!r) return nm + '<div class="stk-foot">' + _L('Đang tính…', 'Computing…') + '</div>';
      const cur = r.current || 0, brokeToday = r.brokeOn === _today();
      const hasMoney = (r.avgDay != null && r.avgDay > 0 && cur > 0 && typeof fmt === 'function');
      let band;
      if (hasMoney) {
        // Right side leads with the tangible "events avoided" count — a figure
        // the user can eyeball against their own history; falls back to the
        // per-day money when the rate is too low to round to a whole event.
        const rides = Math.round((r.ridesDay || 0) * cur);
        const rside = rides >= 1
          ? '≈' + rides + ' ' + _L('lần', 'times') + '<br>' + _L('đã nhịn', 'skipped')
          : '≈' + fmt(Math.round(r.avgDay)) + '<br>' + _L('mỗi ngày', 'per day');
        band = '<div class="stk-cband money"><div class="stk-cband-main"><div class="stk-cband-l">' + _L('Ở lại ví · ngày ' + cur, 'Kept · day ' + cur) + '</div>'
          + '<div class="stk-cband-v num">~' + fmt(r.saved) + '</div></div>'
          + '<div class="stk-cband-r">' + rside + '</div></div>';
      } else {
        band = '<div class="stk-cband day"><div class="stk-cband-main"><div class="stk-cband-l">' + (brokeToday ? _L('Đứt hôm nay', 'Broke today') : _L('Đang giữ', 'Holding')) + '</div>'
          + '<div class="stk-cband-v num">' + cur + ' <span class="stk-cband-u">' + _L('ngày', 'days') + '</span></div></div>'
          + '<div class="stk-cband-r">' + (brokeToday ? '' : _L('hôm nay<br>đang tính', 'today<br>counting')) + '</div></div>';
      }
      return nm + band + _cardCal(r) + '<div class="stk-medals stk-card-medals">' + _cardMedals(d, r, hasMoney) + '</div>' + _cardWarn(r);
    }

    window.persStreakSection = function () {
      const P = _P(); if (!P || !P.uid || !P.key) return '';
      window.fhStreaksEnsure();
      let h = '<div class="section-h"><span class="t">' + _L('Chuỗi thói quen', 'Habit streaks') + '</span>';
      if ((S.defs || []).length < MAX_ACTIVE) h += '<a onclick="fhStreakNewSheet()">＋ ' + _L('Thêm', 'Add') + '</a>';
      h += '</div>';
      if (S.defs === null) return h + '<div class="card stk-empty"><div class="stk-empty-s">' + _L('Đang tính chuỗi…', 'Computing…') + '</div></div>';
      if (!S.defs.length) {
        h += '<div class="card stk-empty" onclick="fhStreakNewSheet()"><div class="stk-empty-e">🎯</div>'
          + '<div class="stk-empty-t">' + _L('Thử nhịn một thói quen?', 'Try quitting a habit?') + '</div>'
          + '<div class="stk-empty-s">' + _L('Ví dụ: 7 ngày không Grab. App tự đếm từ sổ của bạn.', 'e.g. 7 days without Grab. Counted from your ledger.') + '</div></div>';
      } else for (const d of S.defs) {
        h += '<div class="card stk-card" onclick="fhStreakDetail(\'' + d.id + '\')">' + _cardBody(d, (S.res || {})[d.id], false, '') + '</div>';
      }
      return h + _archSection(false);
    };

    /* ═══ Family streaks (0132 §6) — the social variant ═══════════════════════
       Same engine over the FAMILY ledger: every member's realized expenses,
       any keyed member's device computes. Definitions ride family_streaks
       under the fhField enc convention. Matching is note/category only (the
       family table has no counterparty column — stated in spec §15). Queue
       rows count only when staged family-scope; another member's staged rows
       are invisible to this device (RLS) — partial queue coverage, honest.
       Attribution: the breaking TRANSACTION shows (amount + date), never a
       "who broke it" headline. Governance v1: any member creates; archive is
       arm-then-confirm and open to any member (the roster carries no role the
       client can check — revisit if it's ever abused). */
    const F = { defs: null, res: null, computing: false, sig: '', arch: null, archOpen: false };
    const _famOk = () => !!(window.DB && DB.fid && window.fhKeyReady && fhKeyReady());

    async function _famLoadDefs() {
      if (!_famOk()) return null;
      const r = await _sb().from('family_streaks')
        .select('id,rule,rule_enc,record,record_enc,started_on,created_by')
        .eq('family_id', DB.fid).is('archived_at', null).order('created_at');
      if (r.error) return null;
      const out = [];
      for (const row of (r.data || [])) {
        try {
          const rs = await fhRead(row, 'rule'); if (!rs) continue;
          const rec = Number(await fhRead(row, 'record')) || 0;
          out.push({ id: row.id, rule: JSON.parse(rs), startedOn: row.started_on, record: rec, createdBy: row.created_by, fam: true });
        } catch (e) { /* unreadable def: skip */ }
      }
      return out;
    }
    window.fhFamStreakCreate = async function (rule) {
      if (!_famOk()) return false;
      if ((F.defs || []).length >= MAX_ACTIVE) return 'cap';
      rule = { type: rule.type, key: rule.key, label: rule.label, emoji: rule.emoji || '🎯', milestone: rule.milestone || 7 };
      if (rule.type === 'merchant') rule.key = _norm(rule.key, '');
      if (!rule.key) return false;
      const ins = Object.assign({ family_id: DB.fid, created_by: DB.ownerMemberId || null, started_on: _today() },
        await fhField('rule', JSON.stringify(rule)), await fhField('record', '0'));
      const r = await _sb().from('family_streaks').insert(ins);
      if (r.error) { console.warn('family streak create failed', r.error); return false; }
      F.defs = null; F.sig = ''; return true;
    };
    window.fhFamStreakArchive = async function (id) {
      const r = await _sb().from('family_streaks').update({ archived_at: new Date().toISOString() }).eq('id', id);
      if (r.error) return false;
      F.defs = null; F.sig = ''; F.arch = null; return true;
    };
    window.fhFamStreakSetMilestone = async function (id, m) {
      const d = (F.defs || []).find((x) => x.id === id); if (!d || !_famOk()) return false;
      d.rule.milestone = m;
      const r = await _sb().from('family_streaks').update(Object.assign(
        { updated_at: new Date().toISOString() }, await fhField('rule', JSON.stringify(d.rule)))).eq('id', id);
      if (r.error) return false;
      F.sig = ''; return true;
    };
    async function _famSaveRecord(d, n) {
      if (!_famOk() || !(n > d.record)) return;
      d.record = n;
      await _sb().from('family_streaks').update(Object.assign(
        { updated_at: new Date().toISOString() }, await fhField('record', String(n)))).eq('id', d.id);
    }

    async function _famRows(fromIso) {
      if (!_famOk()) return null;
      const fc = await _sb().from('categories').select('id,name,name_enc').eq('family_id', DB.fid);
      if (fc.error) return null;
      const catName = {};
      for (const c of (fc.data || [])) catName[c.id] = c.name != null ? c.name : await fhRead(c, 'name');
      const r = await _sb().from('transactions')
        .select('id,txn_date,amount,amount_enc,note,note_enc,category_id')
        .eq('family_id', DB.fid).eq('status', 'realized').eq('kind', 'expense')
        .gte('txn_date', fromIso).order('txn_date', { ascending: false }).limit(4000);
      if (r.error) return null;
      const out = [];
      for (const t of (r.data || [])) {
        const amtS = await fhRead(t, 'amount');
        const amt = amtS != null && amtS !== '' ? Number(amtS) : null;
        out.push({ date: t.txn_date, amt: isFinite(amt) ? amt : null, _unreadable: !(amt != null && isFinite(amt)),
          note: await fhRead(t, 'note'), cat: catName[t.category_id] || null, who: null });
      }
      return out;
    }

    window.fhFamStreaksEnsure = function () {
      if (!_famOk()) return;
      const sig = _today() + ':' + DB.fid + ':' + (F.defs ? F.defs.map((d) => d.id + (d.rule.milestone || 7)).join(',') : '?');
      if (sig === F.sig || F.computing) return;
      F.computing = true;
      (async () => {
        try {
          if (!F.defs) F.defs = await _famLoadDefs();
          if (!F.defs) return;
          if (F.defs.length) {
            let from = F.defs[0].startedOn;
            for (const d of F.defs) if (d.startedOn < from) from = d.startedOn;
            from = _shift(from, -60);
            const floor = _shift(_today(), -425);
            if (from < floor) from = floor;
            const rows = await _famRows(from);
            if (!rows) return;
            const staged = (await _staged()).filter((q) => q.scope === 'family');
            F.res = _compute(F.defs, rows, staged, _today());
            for (const d of F.defs) { const rr = F.res[d.id]; if (rr) _famSaveRecord(d, rr.record); }
            _digestPut(true, F.defs, F.res);
          } else { F.res = {}; _digestPut(true, [], {}); }
          F.sig = sig;
        } finally {
          F.computing = false;
          const host = document.getElementById('fam-streaks');
          if (host && window.famStreakFill) { try { famStreakFill(host); } catch (e) {} }
        }
      })();
    };

    window.famStreakFill = function (host) {
      if (!_famOk()) { host.innerHTML = ''; return; }
      window.fhFamStreaksEnsure();
      const avs = ((window.FAM && FAM.members) || []).slice(0, 5).map((m) =>
        '<span class="av stk-av" style="background:' + _esc(m.color || 'var(--id-none)') + '">'
        + (m.av ? '<img src="' + _esc(m.av) + '" alt="">' : _esc(String(m.name || '?').trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase()))
        + '</span>').join('');
      let h = '<div class="section-h"><span class="t">' + _L('Chuỗi cả nhà', 'Family streaks') + '</span>';
      if ((F.defs || []).length < MAX_ACTIVE) h += '<a onclick="fhStreakNewSheet(\'family\')">＋ ' + _L('Thêm', 'Add') + '</a>';
      h += '</div>';
      if (F.defs === null) { host.innerHTML = ''; return; }   // quiet until first load — no placeholder card on the family tab
      if (!F.defs.length) {
        h += '<div class="card stk-empty" onclick="fhStreakNewSheet(\'family\')"><div class="stk-empty-e">🤝</div>'
          + '<div class="stk-empty-t">' + _L('Cả nhà cùng nhịn một thứ?', 'Quit something together?') + '</div>'
          + '<div class="stk-empty-s">' + _L('Ví dụ: 7 ngày không trà sữa, tính từ sổ chung, cả nhà cùng giữ.', 'e.g. 7 days without bubble tea, counted from the shared ledger.') + '</div></div>';
      } else for (const d of F.defs) {
        h += '<div class="card stk-card" onclick="fhStreakDetail(\'' + d.id + '\',1)">' + _cardBody(d, (F.res || {})[d.id], true, avs) + '</div>';
      }
      host.innerHTML = h + _archSection(true);
    };

    /* ═══ Archived streaks — the "Đã lưu trữ" drawer + restore/delete ═════════
       Archiving soft-deletes (archived_at set); this is the only door back.
       Loaded lazily (one query per tab session), a collapsed bar that expands
       to the archived list; each row opens a light detail with Khôi phục
       (restore, cap-guarded, fresh start keeping the record) and Xoá hẳn
       (permanent delete, arm-then-confirm). */
    async function _loadArch(fam) {
      if (fam) {
        if (!_famOk()) { F.arch = []; return; }
        const r = await _sb().from('family_streaks').select('id,rule,rule_enc,record,record_enc,started_on,archived_at')
          .eq('family_id', DB.fid).not('archived_at', 'is', null).order('archived_at', { ascending: false });
        if (r.error) { F.arch = []; return; }
        const out = [];
        for (const row of (r.data || [])) {
          try { const rs = await fhRead(row, 'rule'); if (!rs) continue;
            out.push({ id: row.id, rule: JSON.parse(rs), startedOn: row.started_on, record: Number(await fhRead(row, 'record')) || 0, archivedAt: row.archived_at });
          } catch (e) {}
        }
        F.arch = out;
        const host = document.getElementById('fam-streaks'); if (host && window.famStreakFill) famStreakFill(host);
      } else {
        const P = _P(); if (!P || !P.uid || !P.key) { S.arch = []; return; }
        const r = await _sb().from('personal_streaks').select('id,rule_enc,record_enc,started_on,archived_at')
          .eq('owner_user_id', P.uid).not('archived_at', 'is', null).order('archived_at', { ascending: false });
        if (r.error) { S.arch = []; return; }
        const out = [];
        for (const row of (r.data || [])) {
          try { const rule = JSON.parse(await FHCrypto.decVal(P.key, row.rule_enc));
            let rec = 0; if (row.record_enc) rec = Number(await FHCrypto.decVal(P.key, row.record_enc)) || 0;
            out.push({ id: row.id, rule: rule, startedOn: row.started_on, record: rec, archivedAt: row.archived_at });
          } catch (e) {}
        }
        S.arch = out;
        if (typeof renderPersonal === 'function') renderPersonal();
      }
    }
    function _archSection(fam) {
      const st = fam ? F : S;
      if (st.arch === null) { _loadArch(fam); return ''; }   // lazy; re-renders when loaded
      if (!st.arch.length) return '';
      const tog = fam ? 'fhStreakArchToggle(1)' : 'fhStreakArchToggle()';
      let h = '<div class="stk-arch"><div class="stk-arch-bar" onclick="' + tog + '">'
        + '<span>' + _L('Đã lưu trữ', 'Archived') + ' (' + st.arch.length + ')</span>'
        + '<span class="stk-arch-cv' + (st.archOpen ? ' open' : '') + '">⌄</span></div>';
      if (st.archOpen) for (const a of st.arch) {
        const op = fam ? 'fhStreakArchivedOpen(\'' + a.id + '\',1)' : 'fhStreakArchivedOpen(\'' + a.id + '\')';
        h += '<div class="stk-arch-row" onclick="' + op + '"><span class="stk-emo">' + _esc(a.rule.emoji || '🎯') + '</span>'
          + '<span class="stk-arch-name">' + _L(fam ? 'Cả nhà không ' : 'Không ', 'No ') + _esc(a.rule.label) + '</span>'
          + '<span class="stk-arch-rec">' + (a.record > 0 ? _L('kỷ lục ' + a.record, 'best ' + a.record) : _L('chưa có kỷ lục', 'no record')) + '</span></div>';
      }
      return h + '</div>';
    }
    window.fhStreakArchToggle = function (fam) { const st = fam ? F : S; st.archOpen = !st.archOpen; _afterChange(!!fam); };

    let _archArm = null;
    window.fhStreakArchivedOpen = function (id, fam) {
      const st = fam ? F : S; const a = (st.arch || []).find((x) => x.id === id); if (!a) return;
      const box = document.getElementById('stk-detail-body'); if (!box) return;
      _archArm = null;
      const fa = fam ? ',1' : '';
      let h = '<div class="stk-dh"><div class="stk-dh-big"><span>' + _L(fam ? 'Cả nhà không ' : 'Không ', 'No ') + '<b>' + _esc(a.rule.label) + '</b></span></div>'
        + '<div class="stk-arch-badge">' + _L('ĐÃ LƯU TRỮ', 'ARCHIVED') + '</div></div>';
      const meta = [];
      meta.push(a.record > 0 ? _L('Kỷ lục ', 'Best ') + '<b class="num">' + a.record + '</b> ' + _L('ngày', 'days') : _L('Chưa lập kỷ lục', 'No record set'));
      meta.push(_L('Bắt đầu ', 'Since ') + a.startedOn.slice(8, 10) + '/' + a.startedOn.slice(5, 7));
      if (a.archivedAt) meta.push(_L('Lưu trữ ', 'Archived ') + a.archivedAt.slice(8, 10) + '/' + a.archivedAt.slice(5, 7));
      h += '<div class="stk-d-meta">' + meta.join(' · ') + '</div>';
      h += '<button class="cta stk-restore" onclick="fhStreakRestore(\'' + id + '\'' + fa + ')">' + _L('Khôi phục chuỗi', 'Restore streak') + '</button>';
      h += '<div class="stk-d-del" id="stk-del2" onclick="fhStreakDeleteForever(\'' + id + '\'' + fa + ')">' + _L('Xoá hẳn', 'Delete permanently') + '</div>';
      box.innerHTML = h;
      if (typeof openSheet === 'function') openSheet('sheet-streak-detail');
    };
    window.fhStreakRestore = async function (id, fam) {
      const active = ((fam ? F.defs : S.defs) || []).length;
      if (active >= MAX_ACTIVE) { window.toast && toast(_L('Đang có 3 chuỗi chạy — lưu trữ bớt một cái trước nhé', '3 active already — archive one first')); return; }
      const tbl = fam ? 'family_streaks' : 'personal_streaks';
      // Fresh start on restore: run recomputes from today; record_enc is left
      // untouched so the personal best carries over.
      const r = await _sb().from(tbl).update({ archived_at: null, started_on: _today(), updated_at: new Date().toISOString() }).eq('id', id);
      if (r.error) { window.toast && toast(_L('Chưa khôi phục được', 'Could not restore')); return; }
      if (fam) { F.defs = null; F.sig = ''; F.arch = null; } else { S.defs = null; S.sig = ''; S.arch = null; }
      if (typeof closeSheet === 'function') closeSheet();
      window.toast && toast(_L('Đã khôi phục — bắt đầu lại từ hôm nay', 'Restored — starting fresh today'));
      _afterChange(!!fam);
    };
    window.fhStreakDeleteForever = async function (id, fam) {
      const el = document.getElementById('stk-del2');
      if (_archArm !== id) {
        _archArm = id;
        if (el) el.textContent = _L('Bấm lần nữa để xoá hẳn', 'Tap again to delete');
        setTimeout(() => { if (_archArm === id) { _archArm = null; if (el) el.textContent = _L('Xoá hẳn', 'Delete permanently'); } }, 3000);
        return;
      }
      _archArm = null;
      const tbl = fam ? 'family_streaks' : 'personal_streaks';
      const r = await _sb().from(tbl).delete().eq('id', id);
      if (r.error) { window.toast && toast(_L('Chưa xoá được', 'Could not delete')); return; }
      if (fam) { F.arch = null; } else { S.arch = null; }
      if (typeof closeSheet === 'function') closeSheet();
      window.toast && toast(_L('Đã xoá', 'Deleted'));
      _afterChange(!!fam);
    };

    /* ── creation sheet — consolidated picker ── */
    async function _mine() {
      const P = _P();
      const seen = {}, cats = {};
      const rows = (P && P.txns) || [];
      for (const t of rows) {
        if (t.kind !== 'expense' || t._unreadable) continue;
        if (t.cat) { const ck = t.cat; cats[ck] = cats[ck] || { n: 0, emoji: t.emoji || '🗂️' }; cats[ck].n++; }
        const raw = (t.who || '').trim() || null;
        const k = raw ? _norm(raw, '') : '';
        if (k && k.length >= 2) { seen[k] = seen[k] || { n: 0, label: raw }; seen[k].n++; }
      }
      const merch = Object.keys(seen).map((k) => ({ type: 'merchant', key: k, label: seen[k].label, n: seen[k].n }))
        .sort((a, b) => b.n - a.n).slice(0, 10);
      const catList = Object.keys(cats).map((c) => ({ type: 'category', key: c, label: c, emoji: cats[c].emoji, n: cats[c].n }))
        .sort((a, b) => b.n - a.n).slice(0, 10);
      return { merch, cats: catList };
    }
    let _newScope = 'personal';
    window.fhStreakNewSheet = async function (scope) {
      _newScope = scope === 'family' ? 'family' : 'personal';
      const defs = _newScope === 'family' ? F.defs : S.defs;
      if ((defs || []).length >= MAX_ACTIVE) { window.toast && toast(_L('Tối đa 3 chuỗi. Lưu trữ bớt một chuỗi trước nhé', 'Max 3 streaks. Archive one first')); return; }
      const box = document.getElementById('stk-new-list'); if (!box) return;
      box.innerHTML = '<div class="stk-empty-s">' + _L('Đang gom gợi ý…', 'Mining…') + '</div>';
      if (typeof openSheet === 'function') openSheet('sheet-streak-new');
      const m = _newScope === 'family' ? await _mineFam() : await _mine();
      let h = '';
      const row = (o) => '<div class="stk-pick" onclick=\'fhStreakPick(' + JSON.stringify(JSON.stringify(o)) + ')\'>'
        + '<span class="stk-pick-e">' + _esc(o.emoji || '🏷️') + '</span><span class="stk-pick-t">' + _esc(o.label) + '</span>'
        + '<span class="stk-pick-k">' + (o.type === 'merchant' ? _L('thương hiệu', 'merchant') : _L('danh mục', 'category')) + '</span></div>';
      if (m.merch.length) { h += '<div class="stk-pick-lbl">' + _L('Từ chi tiêu gần đây', 'From recent spending') + '</div>'; m.merch.forEach((o) => h += row(o)); }
      if (m.cats.length) { h += '<div class="stk-pick-lbl">' + _L('Theo danh mục', 'By category') + '</div>'; m.cats.forEach((o) => h += row(o)); }
      h += '<div class="stk-pick-lbl">' + _L('Hoặc từ khoá khác', 'Or another keyword') + '</div>'
        + '<div class="stk-free"><input id="stk-free-in" placeholder="' + _L('vd: grab, aeon, trà sữa…', 'e.g. grab, aeon…') + '">'
        + '<button class="btn-line stk-free-go" onclick="fhStreakPickFree()">' + _L('Tạo chuỗi', 'Create') + '</button></div>';
      box.innerHTML = h;
    };
    /* Family mining: categories only — family rows carry no structured
       counterparty, and a note-mined "merchant" list would surface raw memo
       fragments as buttons. Free keyword covers merchants there. */
    async function _mineFam() {
      const cats = {};
      if (_famOk()) {
        const fc = await _sb().from('categories').select('id,name,name_enc,emoji').eq('family_id', DB.fid).is('archived_at', null);
        for (const c of (fc.data || [])) {
          const n = c.name != null ? c.name : await fhRead(c, 'name');
          if (n) cats[n] = { emoji: c.emoji || '🗂️', n: 1 };
        }
      }
      return { merch: [], cats: Object.keys(cats).map((c) => ({ type: 'category', key: c, label: c, emoji: cats[c].emoji, n: 1 })) };
    }
    window.fhStreakPick = async function (json) {
      let o; try { o = JSON.parse(json); } catch (e) { return; }
      const rule = { type: o.type, key: o.key, label: o.label, emoji: o.emoji || (o.type === 'merchant' ? '🏷️' : '🗂️'), milestone: 7 };
      const ok = _newScope === 'family' ? await window.fhFamStreakCreate(rule) : await window.fhStreakCreate(rule);
      if (ok === 'cap') { window.toast && toast(_L('Tối đa 3 chuỗi', 'Max 3 streaks')); return; }
      if (!ok) { window.toast && toast(_L('Chưa tạo được, thử lại nhé', 'Could not create, please retry')); return; }
      if (typeof closeSheet === 'function') closeSheet();
      window.toast && toast(_L('Bắt đầu! Hôm nay là ngày 1', 'Started! Today is day 1'));
      if (_newScope === 'family') {
        const host = document.getElementById('fam-streaks');
        if (host && window.famStreakFill) famStreakFill(host);
      } else if (typeof renderPersonal === 'function') renderPersonal();
    };
    window.fhStreakPickFree = function () {
      const el = document.getElementById('stk-free-in');
      const v = el && el.value.trim();
      if (!v) return;
      window.fhStreakPick(JSON.stringify({ type: 'merchant', key: v, label: v, emoji: '🏷️' }));
    };

    /* ── detail sheet ── */
    /* Month calendar (option-5 blend): this month's days, one glance at which
       were held vs lost. Clean day green, break red, today a live ring, days
       before the streak started or in the future stay faded. Today is NEVER a
       finished ✓ — it is an open ring until the day concludes. */
    const _MON_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    function _calHtml(r) {
      const today = _today();
      const now = new Date(today + 'T00:00:00');
      const y = now.getFullYear(), mo = now.getMonth();
      const lead = (new Date(y, mo, 1).getDay() + 6) % 7;   // Monday-first
      const dim = new Date(y, mo + 1, 0).getDate();
      const brk = {}; (r.breaks || []).forEach((b) => { brk[b] = 1; });
      const started = r.startedOn || today, pfx = y + '-' + _d2(mo + 1) + '-';
      // Milestone days of the CURRENT run: milestone m lands on today+(m−current).
      const msIso = {};
      if (r.current > 0) for (const m of MILESTONES) msIso[_shift(today, m - r.current)] = _MEDAL[m];
      const dows = _L('T2 T3 T4 T5 T6 T7 CN', 'Mo Tu We Th Fr Sa Su').split(' ');
      let head = '';
      for (const w of dows) head += '<span class="stk-dow">' + w + '</span>';
      let cells = '';
      for (let i = 0; i < lead; i++) cells += '<span class="stk-cc empty"></span>';
      for (let day = 1; day <= dim; day++) {
        const iso = pfx + _d2(day);
        let cls = iso > today ? 'fut' : (iso < started ? 'pre' : (brk[iso] ? 'x' : (iso === today ? 'today' : 'ok')));
        const flag = msIso[iso] ? '<i class="stk-cc-flag">' + msIso[iso] + '</i>' : '';
        cells += '<span class="stk-cc ' + cls + (flag ? ' ms' : '') + ' num">' + day + flag + '</span>';
      }
      return '<div class="stk-cal-h"><span>' + _L('Tháng ' + (mo + 1), _MON_EN[mo] + ' ' + y) + '</span>'
        + '<span class="stk-legend"><i class="ok"></i>' + _L('sạch', 'clean') + '<i class="today"></i>' + _L('hôm nay', 'today') + '<i class="x"></i>' + _L('lỡ', 'slip') + '</span></div>'
        + '<div class="stk-dows">' + head + '</div><div class="stk-cal">' + cells + '</div>';
    }

    /* Milestone medal shelf (option-8 blend) — and the milestone PICKER in one:
       tapping a medal sets it as the celebrate target. Earned (best run reached
       it) shows in colour; the aimed-at one glows; the rest wait, locked. */
    const _MEDAL = { 7: '🥉', 14: '🥈', 30: '🥇', 100: '🏆' };
    function _medalHtml(id, r, ms, fa) {
      let h = '<div class="stk-medals">';
      for (const m of MILESTONES) {
        const earned = Math.max(r.record || 0, r.current || 0) >= m;
        const cls = earned ? 'earned' : (m === ms ? 'target' : 'lock');
        const sub = earned ? _L('đã đạt', 'done') : (m === ms ? _L('đang nhắm', 'aiming') : _L('ngày', 'days'));
        h += '<div class="stk-medal ' + cls + '" onclick="fhStreakMs(\'' + id + '\',' + m + fa + ')">'
          + '<div class="stk-medal-e">' + _MEDAL[m] + '</div>'
          + '<div class="stk-medal-n num">' + m + '</div><div class="stk-medal-s">' + sub + '</div></div>';
      }
      return h + '</div>';
    }

    let _detailArm = null;
    window.fhStreakDetail = function (id, fam) {
      const d = ((fam ? F.defs : S.defs) || []).find((x) => x.id === id); if (!d) return;
      const r = ((fam ? F.res : S.res) || {})[id] || {};
      const box = document.getElementById('stk-detail-body'); if (!box) return;
      _detailArm = null;
      const fa = fam ? ',1' : '';
      const ms = (d.rule.milestone || 7);
      const cur = (r.current != null ? r.current : 0);
      // Header, kept deliberately bare: just "N ngày không <label>". Everything
      // else (holding state, days-to-milestone, start date) is carried by the
      // calendar + medal shelf below, so the top stays clean.
      let h = '<div class="stk-dh"><div class="stk-dh-big"><span class="num">' + cur + '</span> <span>'
        + _L(fam ? 'ngày cả nhà không' : 'ngày không', 'days without') + ' <b>' + _esc(d.rule.label) + '</b></span></div></div>';
      // Calendar + milestone medals
      h += '<div class="stk-cal-wrap">' + _calHtml(r) + '</div>';
      h += '<div class="stk-pick-lbl">' + _L('Mốc ăn mừng', 'Milestone') + '</div>' + _medalHtml(id, r, ms, fa);
      h += '<div class="stk-d-del" id="stk-del" onclick="fhStreakDel(\'' + id + '\'' + fa + ')">' + _L('Lưu trữ chuỗi này', 'Archive this streak') + '</div>';
      box.innerHTML = h;
      if (typeof openSheet === 'function') openSheet('sheet-streak-detail');
    };
    function _afterChange(fam) {
      if (fam) { const host = document.getElementById('fam-streaks'); if (host && window.famStreakFill) famStreakFill(host); }
      else if (typeof renderPersonal === 'function') renderPersonal();
    }
    window.fhStreakMs = async function (id, m, fam) {
      const ok = fam ? await window.fhFamStreakSetMilestone(id, m) : await window.fhStreakSetMilestone(id, m);
      if (ok) { window.fhStreakDetail(id, fam); _afterChange(fam); }
    };
    window.fhStreakDel = async function (id, fam) {
      const el = document.getElementById('stk-del');
      if (_detailArm !== id) {
        _detailArm = id;
        if (el) el.textContent = _L('Bấm lần nữa để lưu trữ', 'Tap again to archive');
        setTimeout(() => { if (_detailArm === id) { _detailArm = null; if (el) el.textContent = _L('Lưu trữ chuỗi này', 'Archive this streak'); } }, 3000);
        return;
      }
      _detailArm = null;
      const ok = fam ? await window.fhFamStreakArchive(id) : await window.fhStreakArchive(id);
      if (ok) { if (typeof closeSheet === 'function') closeSheet(); window.toast && toast(_L('Đã lưu trữ', 'Archived')); _afterChange(fam); }
    };
  })();
