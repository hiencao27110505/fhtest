/* ═══ Recurring charges — the engine, detection v2 (recurring-charges-spec.md §18)
   A transaction may carry a RECURRENCE (weekly | monthly | yearly) and how we
   know it (receipt | pattern | person). Everything here runs on the device over
   decrypted rows: amounts are ciphertext on the server, so series, next dates,
   totals and price creep can exist nowhere else.

   WHY THIS IS v2 (docs/incidents/2026-10-06-recurring-detection.md). v1 let
   one pair of charges a week apart mark a coffee shop "weekly", read five
   weeks of a thirteen-month ledger, and called two charges "the same merchant"
   when the first three words of their notes and their category matched. So:
     - CADENCE, not a pair: at most one charge per period, most gaps the length
       of one (§18.3). Softness counts charges IN CADENCE, never rows.
     - IDENTITY is the payee, then a recurring leaf of the tree, then an exact
       amount; the category is in no key (§18.2).
     - A PATTERN MARK IS DERIVED, NEVER TRUSTED: only a person's mark, a receipt
       or a lesson anchors a merchant; a stored `pattern` mark that no series
       explains is cleared (§18.6).
     - ONE VIEW: tile, sheet, detail row and queue card all read analyse()'s
       result; the stored column is its durable trace (§18.7).

   Row shape (both ledgers):
     { id, date:'YYYY-MM-DD', amt, payee, note, node,
       recur, recurSrc, rcPeriod, recurSig, renewsOn }
   Only expense rows with a positive amount take part. analyse() is PURE: the
   lessons and the tree arrive as callbacks in `opts`. */
(function () {
  'use strict';

  const WINDOWS = { weekly: [6, 8], monthly: [25, 37], yearly: [350, 380] };
  const PERIODS = ['monthly', 'yearly', 'weekly'];            // tie-break order: monthly first
  /* Charges IN CADENCE needed to be a series at all (a guess, "có vẻ"), and to
     be shown as fact and counted. Off a recurring leaf, two charges a month
     apart are a coincidence far more often than a subscription — any shop
     visited twice does it, and a year of history is full of them — so the
     guess starts at three there. On a leaf (rent, a bill, a subscription) the
     tree has already said what kind of charge it is, so two are a guess and
     three are fact. Two are never fact for a monthly charge: two film rentals
     a month apart sit on the streaming leaf too. */
  const GUESS = { monthly: 3, yearly: 2, weekly: 4 };
  const CONFIRM = { monthly: 4, yearly: 3, weekly: 6 };
  const GUESS_LEAF = { monthly: 2, yearly: 2, weekly: 4 };
  const CONFIRM_LEAF = { monthly: 3, yearly: 2, weekly: 6 };
  const CLUSTER_TOL = 0.25;  // one subscription's price may move this much and stay one series
  const CREEP = 0.05;        // price-creep floor: below it is FX noise (RR8)
  const UPCOMING_DAYS = 30;  // the tile's horizon (RR7)
  const HISTORY_DAYS = 760;  // what the slice reads: two yearly charges stay visible for a year

  const _dayMs = 86400000;
  const fold = (s) => String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'd')
    .toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
  const _dateOf = (iso) => { const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) : NaN; };
  const _iso = (ms) => new Date(ms).toISOString().slice(0, 10);
  const _gap = (a, b) => Math.round((_dateOf(b) - _dateOf(a)) / _dayMs);
  const _near = (a, b, tol) => a > 0 && b > 0 && Math.abs(a - b) <= Math.max(a, b) * tol;
  const _ok = (p) => p === 'weekly' || p === 'monthly' || p === 'yearly';

  function periodOf(gapDays) {
    for (const p of PERIODS) { const w = WINDOWS[p]; if (gapDays >= w[0] && gapDays <= w[1]) return p; }
    return null;
  }
  const _fits = (g, p) => g >= WINDOWS[p][0] && g <= WINDOWS[p][1];
  const _skips = (g, p) => g >= 2 * WINDOWS[p][0] && g <= 2 * WINDOWS[p][1];

  /* ── identity (§18.2) ──────────────────────────────────────────────────── */
  /** Pass-A key: the payee when the row has one, else the note's first three
   *  words (family rows, hand-typed rows). Never the category. */
  function primaryKey(row) {
    if (!row) return '';
    const p = fold(row.payee);
    if (p.length >= 3) return 'p|' + p;
    const w = fold(row.note).split(' ').filter(Boolean).slice(0, 3).join(' ');
    return w.length >= 4 ? 'n|' + w : '';
  }
  const amountKey = (amt) => 'a|' + Math.round(Number(amt) * 1000);

  /* ── amount clusters ───────────────────────────────────────────────────── */
  /** Rows sorted by date → clusters; each row joins the cluster whose LATEST
   *  amount is nearest within CLUSTER_TOL, else starts one. `loose` (a bill
   *  whose amount is expected to move) keeps everything together. */
  function clusters(rows, loose) {
    if (loose) return rows.length ? [rows.slice()] : [];
    const out = [];
    for (const r of rows) {
      let best = null, bestD = Infinity;
      for (const c of out) {
        const ref = c[c.length - 1].amt;
        if (!_near(ref, r.amt, CLUSTER_TOL)) continue;
        const d = Math.abs(ref - r.amt);
        if (d < bestD) { bestD = d; best = c; }
      }
      if (best) best.push(r); else out.push([r]);
    }
    return out;
  }

  /* ── cadence (§18.3) ───────────────────────────────────────────────────── */
  /** Is this cluster (sorted by date) in cadence for some period?
   *  → { period, fits, skips, shorts, inCadence } or null. `strict` (pass C)
   *  demands every gap fit and never reads weekly. `leaf`: the cluster sits on
   *  a recurring leaf, which lowers the bar (see GUESS). */
  function cadence(rows, strict, leaf) {
    const G = rows.length - 1;
    if (G < 1) return null;
    const gaps = [];
    for (let i = 1; i < rows.length; i++) gaps.push(_gap(rows[i - 1].date, rows[i].date));
    let best = null;
    for (const p of PERIODS) {
      if (strict && p === 'weekly') continue;
      let fits = 0, skips = 0, shorts = 0;
      for (const g of gaps) { if (_fits(g, p)) fits++; else if (_skips(g, p)) skips++; else if (g < WINDOWS[p][0]) shorts++; }
      const ok = strict
        ? (fits === G)
        : (fits >= 1 && shorts <= Math.floor(0.2 * G) && (fits + skips) / G >= 0.6);
      if (!ok || fits + 1 < (leaf ? GUESS_LEAF : GUESS)[p]) continue;
      if (!best || fits > best.fits) best = { period: p, fits, skips, shorts, inCadence: fits + 1 };
    }
    return best;
  }
  /** Charges in cadence for a GIVEN period (an anchored series still reports how many). */
  function _inCadenceFor(rows, p) {
    let fits = 0;
    for (let i = 1; i < rows.length; i++) if (_fits(_gap(rows[i - 1].date, rows[i].date), p)) fits++;
    return fits + 1;
  }

  /* ── dates and money ───────────────────────────────────────────────────── */
  function addPeriod(iso, period) {
    const ms = _dateOf(iso); if (!isFinite(ms)) return null;
    const d = new Date(ms);
    if (period === 'weekly') return _iso(ms + 7 * _dayMs);
    const y = d.getUTCFullYear(), m = d.getUTCMonth(), day = d.getUTCDate();
    const ny = period === 'yearly' ? y + 1 : y, nm = period === 'yearly' ? m : m + 1;
    const last = new Date(Date.UTC(ny, nm + 1, 0)).getUTCDate();
    return _iso(Date.UTC(ny, nm, Math.min(day, last)));
  }
  /** Next charge (RR2): a renew date the receipt stated wins when it is after
   *  the charge; else the latest date plus the period. */
  function nextDate(latestIso, period, renewsOn) {
    if (renewsOn && /^\d{4}-\d{2}-\d{2}/.test(renewsOn) && renewsOn.slice(0, 10) > String(latestIso).slice(0, 10)) return renewsOn.slice(0, 10);
    return period ? addPeriod(latestIso, period) : null;
  }
  function creep(latestAmt, prevAmt) {
    if (!(latestAmt > 0) || !(prevAmt > 0)) return 0;
    return latestAmt > prevAmt * (1 + CREEP) ? latestAmt - prevAmt : 0;
  }
  const labelVi = (p) => p === 'weekly' ? 'hàng tuần' : p === 'yearly' ? 'hàng năm' : p === 'monthly' ? 'hàng tháng' : '';
  const labelEn = (p) => p === 'weekly' ? 'weekly' : p === 'yearly' ? 'yearly' : p === 'monthly' ? 'monthly' : '';
  const perMonth = (amt, p) => p === 'weekly' ? amt * 52 / 12 : p === 'yearly' ? amt / 12 : amt;

  /* ── receipts (§18.5) ──────────────────────────────────────────────────── */
  const _YEAR_RE = /\(yearly\)|\(annual\)|\byearly\b|\bannual(ly)?\b|\/\s?year\b|\/\s?n[aă]m\b|h[aà]ng n[aă]m/i;
  const _MONTH_RE = /\(monthly\)|\bmonthly\b|auto-?\s?renew|\brenews?\b|subscription|gia h[aạ]n|thu[eê] bao|\/\s?month\b|\/\s?th[aá]ng\b|h[aà]ng th[aá]ng/i;
  const _MON = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
  /** A decrypted receipt blob → { period, sig, renewsOn }. `period` is
   *  weekly|monthly|yearly or null: the reader's own `period` key, else the
   *  service type, else renewal wording in the items' own text. */
  function receiptMeta(blob) {
    const out = { period: null, sig: null, renewsOn: null };
    if (!blob || typeof blob !== 'object') return out;
    const items = Array.isArray(blob.items) ? blob.items : [];
    const text = items.map((it) => ((it && it.name) || '') + ' ' + ((it && it.variant) || '')).join(' ');
    if (blob.period === 'month') out.period = 'monthly';
    else if (blob.period === 'year') out.period = 'yearly';
    else if (blob.period === 'week') out.period = 'weekly';
    else if (_YEAR_RE.test(text)) out.period = 'yearly';
    else if (blob.service_type === 'subscription' || _MONTH_RE.test(text)) out.period = 'monthly';
    const subItem = items.find((it) => it && typeof it.sig === 'string' && it.sig.indexOf('sub|') === 0);
    if (subItem) { out.sig = subItem.sig; if (!out.period) out.period = 'monthly'; }
    const m = text.match(/renews?\s+(?:on\s+)?(\d{1,2})\s+([A-Za-z]{3,9})\s+(\d{4})/i);
    if (m && _MON[m[2].slice(0, 3).toLowerCase()]) {
      out.renewsOn = m[3] + '-' + String(_MON[m[2].slice(0, 3).toLowerCase()]).padStart(2, '0') + '-' + String(+m[1]).padStart(2, '0');
    }
    return out;
  }

  /* ── one cluster → a series, a block, or nothing ───────────────────────── */
  function _resolve(rows, groupKey, pass, opts, today) {
    const latest = rows[rows.length - 1];
    const leaf = opts.prior ? opts.prior(latest.node) : null;
    /* The person's latest word on this cluster decides it either way. */
    const said = rows.filter((r) => r.recurSrc === 'person');
    const person = said.length ? said[said.length - 1] : null;
    if (person && !_ok(person.recur)) return { blocked: { groupKey, amount: latest.amt, rows } };

    let period = null, source = null, soft = false, inCad = 0;
    if (person) { period = person.recur; source = 'person'; }
    if (!period) {
      const rc = rows.filter((r) => _ok(r.rcPeriod) || (r.recurSrc === 'receipt' && _ok(r.recur)));
      if (rc.length) { const r = rc[rc.length - 1]; period = _ok(r.rcPeriod) ? r.rcPeriod : r.recur; source = 'receipt'; }
    }
    if (!period && opts.lesson) {
      const l = opts.lesson(groupKey);
      if (l && _ok(l.period) && (!(l.amt > 0) || _near(l.amt, latest.amt, CLUSTER_TOL) || (leaf && leaf.variable))) { period = l.period; source = 'lesson'; }
    }
    if (period) inCad = _inCadenceFor(rows, period);
    else {
      const c = cadence(rows, pass === 'C', !!leaf);
      if (!c) return null;
      period = c.period; source = 'pattern'; inCad = c.inCadence;
      const need = (leaf ? CONFIRM_LEAF : CONFIRM)[period];
      soft = pass === 'C' ? true : inCad < need;
    }
    const previous = rows.length > 1 ? rows[rows.length - 2] : null;
    const next = nextDate(latest.date, period, latest.renewsOn || null);
    const dueInDays = next ? Math.round((_dateOf(next) - today) / _dayMs) : null;
    const sigRow = rows.slice().reverse().find((r) => r.recurSig);
    return { series: {
      id: latest.id, key: groupKey + '|' + period + (sigRow ? '|' + sigRow.recurSig : ''), groupKey, pass,
      period, source, soft, inCadence: inCad, variable: !!(leaf && leaf.variable),
      lapsed: dueInDays != null && dueInDays < -WINDOWS[period][1],
      rows, latest, previous, amount: latest.amt, next, dueInDays,
      creep: previous ? creep(latest.amt, previous.amt) : 0,
      perMonth: perMonth(latest.amt, period),
      name: latest.payee || latest.note || '', node: latest.node || null,
      product: sigRow ? String(sigRow.recurSig).split('|').pop() : null,
    } };
  }

  /* ── the view ──────────────────────────────────────────────────────────── */
  /** rows → { series, blocked, byRow, patches }.
   *  opts: { lesson(key) → {period, source, amt}|null, prior(node) → {period, variable, code}|null }
   *  patches (§18.6): { id, recur, src } to write, { id, recur:null, src:null } to clear. */
  function analyse(rows, todayIso, opts) {
    opts = opts || {};
    const today = _dateOf(todayIso || new Date().toISOString());
    const all = [];
    for (const r of rows || []) {
      if (!r || (r.kind && r.kind !== 'expense') || !(r.amt > 0) || !isFinite(_dateOf(r.date))) continue;
      all.push(r);
    }
    all.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    const series = [], blocked = [], byRow = new Map(), claimed = new Set();
    const take = (res) => {
      if (!res) return;
      const rs = res.series ? res.series.rows : res.blocked.rows;
      for (const r of rs) claimed.add(r.id);
      if (res.series) { series.push(res.series); for (const r of rs) byRow.set(r.id, res.series); }
      else blocked.push(res.blocked);
    };
    const group = (list, keyOf) => {
      const g = new Map();
      for (const r of list) { const k = keyOf(r); if (!k) continue; const a = g.get(k) || []; a.push(r); g.set(k, a); }
      return g;
    };
    const looseOf = (list) => {
      if (!opts.prior) return false;
      let v = 0; for (const r of list) { const p = opts.prior(r.node); if (p && p.variable) v++; }
      return v * 2 > list.length;
    };

    // Pass A — who it was paid to. A row with NO payee that sits on a recurring
    // leaf waits for pass B: its note is free text ("Em gui tien nha" one
    // month, "Em chuyen tien nha" the next), and grouping by it first would
    // strand the series at two charges — the incident's third cause again.
    const keyA = (r) => (fold(r.payee).length < 3 && opts.prior && opts.prior(r.node)) ? '' : primaryKey(r);
    for (const [k, g] of group(all, keyA)) {
      for (const c of clusters(g, looseOf(g))) take(_resolve(c, k, 'A', opts, today));
    }
    // Pass B — a recurring leaf of the tree, for rows with NO payee (rent paid
    // with new wording each month). A row that has a payee was offered to pass A
    // under it; gathering such rows by leaf would chain two unrelated software
    // purchases from two vendors into one "subscription".
    if (opts.prior) {
      const rest = all.filter((r) => !claimed.has(r.id) && fold(r.payee).length < 3);
      for (const [k, g] of group(rest, (r) => { const p = opts.prior(r.node); return p ? 'k|' + (p.code || r.node) : ''; })) {
        for (const c of clusters(g, looseOf(g))) take(_resolve(c, k, 'B', opts, today));
      }
    }
    // Pass C — the same exact amount, hand-typed rows only; strict and always soft.
    {
      const rest = all.filter((r) => !claimed.has(r.id) && fold(r.payee).length < 3);
      for (const [k, g] of group(rest, (r) => amountKey(r.amt))) {
        if (g.length >= 3) take(_resolve(g, k, 'C', opts, today));
      }
    }

    // The stored column, reconciled with the view (§18.6).
    const patches = [];
    for (const s of series) {
      if (s.source === 'pattern' && !s.soft && !s.latest.recurSrc) patches.push({ id: s.latest.id, recur: s.period, src: 'pattern', _row: s.latest });
    }
    for (const r of all) {
      if (_ok(r.rcPeriod) && !r.recurSrc) patches.push({ id: r.id, recur: r.rcPeriod, src: 'receipt', _row: r });
      else if (r.recurSrc === 'pattern' && !byRow.has(r.id)) patches.push({ id: r.id, recur: null, src: null, _row: r });
    }

    series.sort((a, b) => (a.dueInDays == null ? 1e9 : a.dueInDays) - (b.dueInDays == null ? 1e9 : b.dueInDays));
    return { series, blocked, byRow, patches };
  }

  const live = (series) => (series || []).filter((s) => !s.lapsed);
  function upcoming(series, days) {
    const h = days || UPCOMING_DAYS;
    return live(series).filter((s) => !s.soft && s.dueInDays != null && s.dueInDays <= h);
  }
  function monthlyTotal(series) {
    return live(series).reduce((sum, s) => sum + (s.soft ? 0 : s.perMonth), 0);
  }

  /* ── the queue card (§18.8) ────────────────────────────────────────────── */
  /** Does a waiting candidate { payee, note, amt, node, date } continue a
   *  series the ledger already shows? → { period, source, soft } | null.
   *  source: 'person' (a declined cluster: period null) | 'series' (continues
   *  one in the ledger) | 'lesson' | 'prior' (the leaf's hint, always soft). */
  function matchCandidate(view, cand, opts) {
    opts = opts || {};
    if (!cand || !(cand.amt > 0)) return null;
    const leaf = opts.prior ? opts.prior(cand.node) : null;
    const bare = fold(cand.payee).length < 3;   // the leaf and amount passes only ever hold payee-less rows
    const keys = [primaryKey(cand), (leaf && bare) ? 'k|' + (leaf.code || cand.node) : '', bare ? amountKey(cand.amt) : ''].filter(Boolean);
    const has = (k) => keys.indexOf(k) >= 0;
    for (const b of (view && view.blocked) || []) {
      if (has(b.groupKey) && _near(b.amount, cand.amt, CLUSTER_TOL)) return { period: null, source: 'person', soft: false };
    }
    for (const s of (view && view.series) || []) {
      if (!has(s.groupKey)) continue;
      if (!s.variable && !_near(s.amount, cand.amt, CLUSTER_TOL)) continue;
      const inStep = s.rows.some((r) => { const g = Math.abs(_gap(r.date, cand.date)); return _fits(g, s.period) || _skips(g, s.period); });
      if (inStep) return { period: s.period, source: 'series', soft: s.soft, series: s };
    }
    if (opts.lesson) {
      const l = opts.lesson(primaryKey(cand));
      if (l && _ok(l.period) && (!(l.amt > 0) || _near(l.amt, cand.amt, CLUSTER_TOL))) return { period: l.period, source: 'lesson', soft: false };
    }
    if (leaf && _ok(leaf.period)) return { period: leaf.period, source: 'prior', soft: true };
    return null;
  }

  window.FH_RECUR = Object.freeze({
    WINDOWS, GUESS, CONFIRM, GUESS_LEAF, CONFIRM_LEAF, CLUSTER_TOL, CREEP, UPCOMING_DAYS, HISTORY_DAYS,
    fold, periodOf, primaryKey, amountKey, clusters, cadence, addPeriod, nextDate, creep,
    labelVi, labelEn, perMonth, receiptMeta, analyse, live, upcoming, monthlyTotal, matchCandidate,
  });

  /* ═══ the two ledgers ══════════════════════════════════════════════════════
     State per scope: the last view and the rows it was built from. The tile,
     the sheet, the detail row and the queue card read it synchronously; the
     refresh below is the only thing that rebuilds it. */
  const _empty = () => ({ ready: false, series: [], blocked: [], blockedIds: new Set(), byRow: new Map(), rows: [], rowById: new Map(), at: 0 });
  const ST = { pers: _empty(), fam: _empty() };
  const _opts = () => ({
    lesson: (k) => (typeof window.fhLessonRecur === 'function' ? window.fhLessonRecur(k) : null),
    prior: (node) => (window.FH_TAX && typeof window.FH_TAX.recursOf === 'function' ? window.FH_TAX.recursOf(node) : null),
  });
  window.fhRecurOpts = _opts;
  const _todayIso = () => { const d = window.TODAY ? new Date(window.TODAY.getTime()) : new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };

  function _build(scope, rows) {
    const v = analyse(rows, _todayIso(), _opts());
    const st = ST[scope];
    st.series = v.series; st.blocked = v.blocked; st.byRow = v.byRow; st.rows = rows;
    st.blockedIds = new Set(); for (const b of v.blocked) for (const r of b.rows) st.blockedIds.add(r.id);
    st.rowById = new Map(rows.map((r) => [r.id, r])); st.ready = true; st.at = Date.now();
    return v;
  }
  function _painted(scope) { try { if (typeof window.fhRecurPainted === 'function') window.fhRecurPainted(scope); } catch (e) { /* a repaint never fails a pass */ } }

  window.fhRecurState = function (scope) { return ST[scope === 'fam' ? 'fam' : 'pers']; };
  window.fhRecurPersonalSeries = function () { return ST.pers.series; };
  window.fhRecurFamilySeries = function () { return ST.fam.series; };
  /** The series a ledger row belongs to, or null. */
  window.fhRecurSeriesOfRow = function (scope, id) { return ST[scope === 'fam' ? 'fam' : 'pers'].byRow.get(id) || null; };
  window.fhRecurRowOf = function (scope, id) { return ST[scope === 'fam' ? 'fam' : 'pers'].rowById.get(id) || null; };
  /** Is this row in a cluster the person answered Không to? (The leaf's hint stays quiet there.) */
  window.fhRecurRowDeclined = function (scope, id) { return ST[scope === 'fam' ? 'fam' : 'pers'].blockedIds.has(id); };
  /** Rebuild the view from the rows already held (after a person's pick). */
  window.fhRecurReanalyse = function (scope) {
    const k = scope === 'fam' ? 'fam' : 'pers';
    if (!ST[k].ready) return;
    _build(k, ST[k].rows); _painted(k);
  };

  /* Personal: the recurrence slice (19-personal.js fhPersonalRecurRows), then
     the reconcile — one personal_txn_patch call. Writes and clears happen only
     over a COMPLETE slice: clearing a mark because the rows that explain it
     were not loaded is the one mistake this pass must not make. */
  let _persBusy = null;
  window.fhRecurRunPersonal = function () {
    if (_persBusy) return _persBusy;
    _persBusy = (async function () {
      try {
        if (typeof window.fhPersonalRecurRows !== 'function') return 0;
        const got = await window.fhPersonalRecurRows();
        if (!got || !Array.isArray(got.rows)) return 0;
        const v = _build('pers', got.rows);
        _painted('pers');
        if (!got.complete || !v.patches.length || typeof window.fhPersonalPatchMany !== 'function') return 0;
        const batch = v.patches.slice(0, 400);
        const ok = await window.fhPersonalPatchMany(batch.map((p) => ({ id: p.id, fields: { recur: p.recur, recurSrc: p.src } })));
        if (!ok || !ok.length) return 0;
        const done = new Set(ok.map(String));   // only rows the database says it wrote
        let n = 0;
        for (const p of batch) {
          if (!done.has(String(p.id))) continue;
          p._row.recur = p.recur; p._row.recurSrc = p.src; n++;
          if (typeof window.fhPersonalRecurTouch === 'function') window.fhPersonalRecurTouch(p.id, p.recur, p.src);
        }
        _build('pers', got.rows); _painted('pers');
        return n;
      } catch (e) { return 0; } finally { _persBusy = null; }
    })();
    return _persBusy;
  };

  /* Family: window.txns already holds the full ledger (the first hydrate of a
     session is never windowed). No payee column, so identity is the note, the
     leaf, the amount. Writes go row by row and each is a realtime event on
     every other device, hence the small cap. */
  function _txnIsoOf(t) {
    if (t.dateIso) return t.dateIso;
    const d = t._d instanceof Date ? t._d : null;
    return d ? (d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')) : '';
  }
  window._fhRecurTxnIso = _txnIsoOf;
  function _famRows() {
    if (!Array.isArray(window.txns)) return [];
    return window.txns.filter((t) => t && t._dbId && !t.future && (t.amt > 0)).map((t) => ({
      id: t._dbId, date: _txnIsoOf(t), amt: t.amt, payee: null, note: t.note, node: t.node || null, kind: 'expense',
      recur: t.recur || null, recurSrc: t.recurSrc || null, rcPeriod: null, recurSig: null, renewsOn: null, _t: t }));
  }
  let _famBusy = false;
  window.fhRecurRunFamily = async function () {
    if (_famBusy) return 0;
    _famBusy = true;
    try {
      const v = _build('fam', _famRows());
      _painted('fam');
      const full = !!(window.DB && window.DB._hydrated && window.DB._lastFullAt);
      if (!full || !v.patches.length || typeof window.fhTxnBulkPatch !== 'function') return 0;
      let n = 0;
      for (const p of v.patches.slice(0, 12)) {
        try {
          await window.fhTxnBulkPatch(p.id, { recurrence: p.recur, recurrence_source: p.src });
          p._row.recur = p.recur; p._row.recurSrc = p.src;
          if (p._row._t) { p._row._t.recur = p.recur; p._row._t.recurSrc = p.src; }
          n++;
        } catch (e) { /* the next run retries */ }
      }
      if (n) { _build('fam', _famRows()); _painted('fam'); }
      return n;
    } finally { _famBusy = false; }
  };
})();
