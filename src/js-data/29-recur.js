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

   WHY v3 (docs/incidents/2026-10-09-recurring-wrong-member.md). v2 put an
   88.000 ₫ film rental into the YouTube Premium series: both were billed by
   Apple, the amounts were 16% apart, and the rental was the newest row, so the
   series took its amount, its date and its tap target. So:
     - THE PRODUCT IS THE IDENTITY when a receipt names one. Rows of one payee
       are split by what their receipts say they are before any amount is
       compared; a row whose own receipt says it is not a renewal never joins
       a renewal (§19.1).
     - MEMBERSHIP IS TIMED. A row without proof joins a proven series only in
       an empty slot of its cadence, at nearly the same amount; and no series
       keeps two charges inside one period (§19.2).
     - A BILLER IS NOT A SELLER. Apple, Google Play and the payment rails
       collect for many products, so their payee names nothing: there a series
       needs a product, or one exact amount in step, and stays a guess (§19.3).
     - A SERIES IS DESCRIBED BY ITS PROOF: amount, name and tap target come
       from the newest row that carries a receipt or a person's word (§19.4).

   Row shape (both ledgers):
     { id, date:'YYYY-MM-DD', amt, payee, note, node,
       recur, recurSrc, rcPeriod, recurSig, renewsOn, rcHas, rcProd }
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
  const ANCHOR_TOL = 0.10;   // a row with no proof joins a proven series only this close to its neighbour
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
  function clusters(rows, loose, tol) {
    if (loose) return rows.length ? [rows.slice()] : [];
    const T = tol > 0 ? tol : CLUSTER_TOL;
    const out = [];
    for (const r of rows) {
      let best = null, bestD = Infinity;
      for (const c of out) {
        const ref = c[c.length - 1].amt;
        if (!_near(ref, r.amt, T)) continue;
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
  function cadence(rows, strict, leaf, inStep) {
    const G = rows.length - 1;
    if (G < 1) return null;
    const gaps = [];
    for (let i = 1; i < rows.length; i++) gaps.push(_gap(rows[i - 1].date, rows[i].date));
    let best = null;
    for (const p of PERIODS) {
      if (strict && p === 'weekly') continue;
      let fits = 0, skips = 0, shorts = 0;
      for (const g of gaps) { if (_fits(g, p)) fits++; else if (_skips(g, p)) skips++; else if (g < WINDOWS[p][0]) shorts++; }
      /* inStep (a biller's rows, §19.3): every gap is one period or a skipped
         one. A missed month is allowed; a charge out of step is not. */
      const ok = strict ? (fits === G)
        : inStep ? (fits >= 1 && fits + skips === G)
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

  /* ── proof and membership (§19) ────────────────────────────────────────── */
  /** How strongly a row itself says "I recur": 2 a person's word, 1 a receipt
   *  that states a period (read now, or stored when the row was imported), 0 nothing. */
  function _proof(r) {
    if (r.recurSrc === 'person' && _ok(r.recur)) return 2;
    if (_ok(r.rcPeriod) || (r.recurSrc === 'receipt' && _ok(r.recur))) return 1;
    return 0;
  }
  /** The row's own receipt says what it is, and it is not a renewal (two films,
   *  an app, a top-up). Such a row is evidence AGAINST joining a subscription. */
  const _notRenewal = (r) => !!r.rcHas && !_ok(r.rcPeriod) && _proof(r) === 0 && r.recurSrc !== 'person';
  const _inStep = (g, p) => _fits(g, p) || _skips(g, p);

  /** Rows with no proof that may join a PROVEN cluster (§19.2): each must land
   *  in an empty slot of the cadence (one period, or a skipped one, from its
   *  neighbours on both sides) at nearly its neighbour's amount. → the rows
   *  that joined; `members` is extended in place and stays sorted. */
  function attach(members, candidates, period, tol) {
    const joined = [];
    for (const c of candidates) {
      let prev = null, next = null;
      for (const m of members) { if (m.date <= c.date) prev = m; else { next = m; break; } }
      if (!prev && !next) continue;
      const near = prev && next ? (_gap(prev.date, c.date) <= _gap(c.date, next.date) ? prev : next) : (prev || next);
      if (!_near(near.amt, c.amt, tol)) continue;
      if (prev && !_inStep(_gap(prev.date, c.date), period)) continue;
      if (next && !_inStep(_gap(c.date, next.date), period)) continue;
      members.splice(prev ? members.indexOf(prev) + 1 : 0, 0, c);
      joined.push(c);
    }
    return joined;
  }
  /** No series keeps two charges inside one period (§19.2). Walking by date,
   *  a row that lands sooner than the period allows after the last kept one
   *  competes with it for the slot: proof wins, then the one more in step with
   *  the charge before; two proven rows both stay. → { kept, extras }. */
  function prune(rows, period) {
    const kept = [], extras = [], min = WINDOWS[period][0];
    for (const r of rows) {
      const last = kept[kept.length - 1];
      if (!last || _gap(last.date, r.date) >= min) { kept.push(r); continue; }
      const pl = _proof(last), pr = _proof(r);
      if (pl && pr) { kept.push(r); continue; }
      let takeNew = pr > pl;
      if (pr === pl && kept.length >= 2) {
        const before = kept[kept.length - 2], nominal = period === 'weekly' ? 7 : period === 'yearly' ? 365 : 30;
        takeNew = Math.abs(_gap(before.date, r.date) - nominal) < Math.abs(_gap(before.date, last.date) - nominal);
      }
      if (takeNew) { extras.push(kept.pop()); kept.push(r); } else extras.push(r);
    }
    return { kept, extras };
  }

  /* ── receipts (§18.5) ──────────────────────────────────────────────────── */
  const _YEAR_RE = /\(yearly\)|\(annual\)|\byearly\b|\bannual(ly)?\b|\/\s?year\b|\/\s?n[aă]m\b|h[aà]ng n[aă]m/i;
  const _MONTH_RE = /\(monthly\)|\bmonthly\b|auto-?\s?renew|\brenews?\b|subscription|gia h[aạ]n|thu[eê] bao|\/\s?month\b|\/\s?th[aá]ng\b|h[aà]ng th[aá]ng/i;
  const _MON = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
  const _PERIOD_TAIL = /\s*\((monthly|yearly|annual|weekly|h[aà]ng th[aá]ng|h[aà]ng n[aă]m)\)\s*$/i;
  /** A decrypted receipt blob → { period, sig, renewsOn, label }. `period` is
   *  weekly|monthly|yearly or null: the reader's own `period` key, else the
   *  service type, else renewal wording in the items' own text. */
  function receiptMeta(blob) {
    const out = { period: null, sig: null, renewsOn: null, label: null, has: false, prod: null };
    if (!blob || typeof blob !== 'object') return out;
    const items = Array.isArray(blob.items) ? blob.items : [];
    out.has = items.length > 0;                                 // a real receipt, whatever it is for
    const text = items.map((it) => ((it && it.name) || '') + ' ' + ((it && it.variant) || '')).join(' ');
    if (blob.period === 'month') out.period = 'monthly';
    else if (blob.period === 'year') out.period = 'yearly';
    else if (blob.period === 'week') out.period = 'weekly';
    else if (_YEAR_RE.test(text)) out.period = 'yearly';
    else if (blob.service_type === 'subscription' || _MONTH_RE.test(text)) out.period = 'monthly';
    const subItem = items.find((it) => it && typeof it.sig === 'string' && it.sig.indexOf('sub|') === 0);
    if (subItem) { out.sig = subItem.sig; if (!out.period) out.period = 'monthly'; }
    /* The name the receipt itself gives the thing ("YouTube Premium", "100 GB
       (Google One)"): what a person calls the charge, where the bank's payee
       string says only "APPLE.COM/BILL". One item only; a basket has no name. */
    if (out.period && items.length === 1 && items[0] && items[0].name) {
      out.label = String(items[0].name).replace(_PERIOD_TAIL, '').trim().slice(0, 40) || null;
    }
    /* WHAT renews (§19.1): the product, spelled the same whether an older
       receipt gave only a label or a newer one a `sub|vendor|product` key. */
    if (out.period) out.prod = (out.sig ? fold(out.sig.split('|').slice(2).join(' ')) : '') || (out.label ? fold(out.label) : '') || null;
    const m = text.match(/renews?\s+(?:on\s+)?(\d{1,2})\s+([A-Za-z]{3,9})\s+(\d{4})/i);
    if (m && _MON[m[2].slice(0, 3).toLowerCase()]) {
      out.renewsOn = m[3] + '-' + String(_MON[m[2].slice(0, 3).toLowerCase()]).padStart(2, '0') + '-' + String(+m[1]).padStart(2, '0');
    }
    return out;
  }

  /* ── one cluster → a series, a block, or nothing ───────────────────────── */
  function _resolve(rows, groupKey, pass, opts, today, flags) {
    flags = flags || {};
    const tol = flags.biller ? CREEP : CLUSTER_TOL;             // how close a lesson's amount must be
    let latest = rows[rows.length - 1];
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
      /* A biller's lesson holds for one amount only: "Apple, monthly" must
         not mark every Apple purchase (§19.3). */
      if (l && _ok(l.period) && ((!(l.amt > 0) && !flags.biller) || _near(l.amt, latest.amt, tol) || (leaf && leaf.variable && !flags.biller))) { period = l.period; source = 'lesson'; }
    }
    if (!period) {
      const c = cadence(rows, pass === 'C', !!leaf, !!flags.biller);
      if (!c) return null;
      period = c.period; source = 'pattern';
      const need = (leaf ? CONFIRM_LEAF : CONFIRM)[period];
      /* A biller's payee proves nothing about what was bought, so a pattern
         under it is a question for the person, never a fact. */
      soft = (pass === 'C' || flags.biller) ? true : c.inCadence < need;
    }
    /* One charge per period (§19.2). What does not fit is not this series. */
    const pr = prune(rows, period);
    rows = pr.kept; latest = rows[rows.length - 1];
    inCad = _inCadenceFor(rows, period);
    /* Described by its proof (§19.4): the newest row that itself says it
       recurs gives the amount, the name and the row a tap opens. The date
       grid runs from that row and steps past any newer member, so a month
       whose receipt never arrived still moves the next date on. */
    const proven = rows.filter((r) => _proof(r) > 0);
    const face = proven.length ? proven[proven.length - 1] : latest;
    const fi = rows.indexOf(face);
    const previous = fi > 0 ? rows[fi - 1] : null;
    let next = nextDate(face.date, period, face.renewsOn || null);
    for (let i = 0; next && i < 36 && _gap(latest.date, next) < WINDOWS[period][0]; i++) next = addPeriod(next, period);
    const dueInDays = next ? Math.round((_dateOf(next) - today) / _dayMs) : null;
    const sigRow = rows.slice().reverse().find((r) => r.recurSig);
    const lblRow = rows.slice().reverse().find((r) => r.rcLabel);
    return { extras: pr.extras, series: {
      id: face.id, key: groupKey + '|' + period + (sigRow ? '|' + sigRow.recurSig : '') + (flags.prod ? '|' + flags.prod : ''), groupKey, pass,
      period, source, soft, inCadence: inCad, variable: !!(leaf && leaf.variable),
      lapsed: dueInDays != null && dueInDays < -WINDOWS[period][1],
      rows, latest, anchor: face, previous, amount: face.amt, next, dueInDays,
      creep: previous ? creep(face.amt, previous.amt) : 0,
      perMonth: perMonth(face.amt, period),
      name: face.payee || face.note || '', node: face.node || null, emoji: face.emoji || null,
      note: face.note || '', payee: face.payee || null,
      product: lblRow ? lblRow.rcLabel : null, biller: !!flags.biller,
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
      /* A biller collects for many products: its name is not who was paid
         (§19.3). Only a payee can be one; a note-keyed group never is. */
      const biller = !!(opts.biller && fold(g[0].payee).length >= 3 && opts.biller(g[0].payee));
      /* 1. What the receipts name (§19.1). Rows whose receipt states a period
            are split by product first, then by amount inside a product (two
            plans of one vendor), and each such cluster is proven. */
      const named = g.filter((r) => _ok(r.rcPeriod));
      const rest = g.filter((r) => !_ok(r.rcPeriod));
      const free = rest.filter((r) => !_notRenewal(r));          // a row whose receipt says "not a renewal" may not join one
      for (const [prod, pg] of group(named, (r) => r.rcProd || '?')) {
        for (const c of clusters(pg, false)) {
          const period = c[c.length - 1].rcPeriod;
          /* 2. Rows with no proof join only in step, at nearly the same amount (§19.2). */
          const joined = attach(c, free.filter((r) => !claimed.has(r.id)), period, biller ? CREEP : ANCHOR_TOL);
          for (const j of joined) claimed.add(j.id);
          take(_resolve(c, k, 'A', opts, today, { biller, prod: prod === '?' ? null : prod }));
        }
      }
      /* 3. Everything else under this payee. A seller's rows cluster by amount
            band as before; a biller's only by one exact amount, in step. */
      const left = rest.filter((r) => !claimed.has(r.id));
      for (const c of clusters(left, !biller && looseOf(left), biller ? CREEP : 0)) {
        const res = _resolve(c, k, 'A', opts, today, { biller });
        take(res);
        /* rows pruned out of a series get one more chance among themselves */
        if (res && res.extras && res.extras.length > 1) {
          for (const c2 of clusters(res.extras, false, biller ? CREEP : 0)) take(_resolve(c2, k, 'A', opts, today, { biller }));
        }
      }
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
  /* "Sắp tới" is THIS MONTH (RR20): the confirmed charges still expected
     before the month ends, as a person thinks of it ("còn gì phải trả tháng
     này"). When nothing is left this month the view rolls to next month, and
     says so. Lapsed and soft series never enter. */
  function upcomingMonth(series, todayIso) {
    const today = _dateOf(todayIso || new Date().toISOString());
    const d = new Date(today), y = d.getUTCFullYear(), m = d.getUTCMonth();
    const inMonth = (iso, yy, mm) => { const t = new Date(_dateOf(iso)); return t.getUTCFullYear() === yy && t.getUTCMonth() === mm; };
    const pool = live(series).filter((s) => !s.soft && s.next);
    let items = pool.filter((s) => inMonth(s.next, y, m) || (s.dueInDays != null && s.dueInDays < 0 && s.dueInDays >= -3));
    let month = m + 1, year = y, isNext = false;
    if (!items.length) {
      const ny = m === 11 ? y + 1 : y, nm = (m + 1) % 12;
      items = pool.filter((s) => inMonth(s.next, ny, nm));
      month = nm + 1; year = ny; isNext = true;
    }
    items.sort((a, b) => (a.dueInDays == null ? 1e9 : a.dueInDays) - (b.dueInDays == null ? 1e9 : b.dueInDays));
    return { items, total: items.reduce((t, s) => t + s.amount, 0), month, year, isNext };
  }
  /* The month as a whole (tile option "Vòng tháng"): what this month's
     confirmed series have already charged (rows dated in the month) and what
     is still due (upcomingMonth). When the view has rolled to next month,
     paid is empty by definition. */
  function monthView(series, todayIso) {
    const um = upcomingMonth(series, todayIso);
    const paid = [];
    if (!um.isNext) {
      for (const s of live(series)) {
        if (s.soft) continue;
        for (const r of s.rows) {
          const t = new Date(_dateOf(r.date));
          if (t.getUTCFullYear() === um.year && t.getUTCMonth() === um.month - 1) paid.push({ series: s, row: r, amount: r.amt, date: r.date });
        }
      }
      paid.sort((a, b) => (a.date < b.date ? -1 : 1));
    }
    const paidTotal = paid.reduce((t, p) => t + p.amount, 0);
    return { month: um.month, year: um.year, isNext: um.isNext, due: um.items, dueTotal: um.total, paid, paidTotal, total: paidTotal + um.total };
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
    /* The candidate's own receipt says it is not a renewal (§19.1): nothing
       in the ledger can make it one. A person can still say so on the card. */
    if (cand.notRenewal) return null;
    const biller = !!(opts.biller && !bare && opts.biller(cand.payee));
    for (const s of (view && view.series) || []) {
      if (!has(s.groupKey)) continue;
      /* A proven or biller series is continued only by nearly the same amount
         (§19.2, §19.3); a seller's pattern keeps the wide band. */
      const tol = (biller || s.biller) ? CREEP : (s.anchor && _proof(s.anchor) > 0) ? ANCHOR_TOL : CLUSTER_TOL;
      if (!s.variable && !_near(s.amount, cand.amt, tol)) continue;
      const gaps = s.rows.map((r) => Math.abs(_gap(r.date, cand.date)));
      /* in step with some charge, and not a second charge inside one period */
      if (gaps.some((g) => _inStep(g, s.period)) && !gaps.some((g) => g < WINDOWS[s.period][0])) return { period: s.period, source: 'series', soft: s.soft, series: s };
    }
    if (opts.lesson) {
      const l = opts.lesson(primaryKey(cand));
      if (l && _ok(l.period) && ((!(l.amt > 0) && !biller) || _near(l.amt, cand.amt, biller ? CREEP : CLUSTER_TOL))) return { period: l.period, source: 'lesson', soft: false };
    }
    if (leaf && _ok(leaf.period)) return { period: leaf.period, source: 'prior', soft: true };
    return null;
  }

  window.FH_RECUR = Object.freeze({
    WINDOWS, GUESS, CONFIRM, GUESS_LEAF, CONFIRM_LEAF, CLUSTER_TOL, ANCHOR_TOL, CREEP, UPCOMING_DAYS, HISTORY_DAYS,
    fold, periodOf, primaryKey, amountKey, clusters, cadence, attach, prune, addPeriod, nextDate, creep,
    labelVi, labelEn, perMonth, receiptMeta, analyse, live, upcoming, upcomingMonth, monthView, monthlyTotal, matchCandidate,
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
    biller: (payee) => !!(window.FH_BRANDS && typeof window.FH_BRANDS.isBiller === 'function' && window.FH_BRANDS.isBiller(payee)),
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
      id: t._dbId, date: _txnIsoOf(t), amt: t.amt, payee: null, note: t.note, node: t.node || null, emoji: t.ico || null, kind: 'expense',
      recur: t.recur || null, recurSrc: t.recurSrc || null, rcPeriod: null, recurSig: null, rcLabel: null, renewsOn: null, rcHas: false, rcProd: null, _t: t }));
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
