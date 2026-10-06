/* ═══ Recurring charges — the engine (recurring-charges-spec.md) ══════════════
   A transaction may carry a RECURRENCE (weekly | monthly | yearly) and how we
   know it (receipt | pattern | person). Everything here is a pure function
   over decrypted rows on the device: amounts are ciphertext on the server, so
   series, next dates, totals and price creep can exist nowhere else.

   Series are a VIEW (RR3): merchant key + period (+ product signature when a
   receipt gave one), no amount in the key so a price change stays in the same
   series, nothing stored per series. Detection (RR4) marks the LATEST row of a
   series the ledger shows repeating; a person's own mark is final (RR5).

   Row shape read here (both ledgers, after hydrate):
     { id, date:'YYYY-MM-DD', amt, who, note, cat, catId, kind,
       recur:'weekly'|'monthly'|'yearly'|null, recurSrc:'receipt'|'pattern'|'person'|null,
       recurSig: 'sub|google|google one'|null, renewsOn:'YYYY-MM-DD'|null }
   Only expense rows take part. */
(function () {
  'use strict';

  const WINDOWS = { weekly: [6, 8], monthly: [26, 35], yearly: [350, 380] };
  const TOL = 0.10;          // amount tolerance between consecutive charges (RR4)
  const CREEP = 0.05;        // price-creep floor: below it is FX noise (RR8)
  const UPCOMING_DAYS = 30;  // the tile's horizon (RR7)

  const _norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'd')
    .toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
  const _dayMs = 86400000;
  const _dateOf = (iso) => { const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) : NaN; };
  const _iso = (ms) => new Date(ms).toISOString().slice(0, 10);

  function periodOf(gapDays) {
    for (const p of ['weekly', 'monthly', 'yearly']) { const w = WINDOWS[p]; if (gapDays >= w[0] && gapDays <= w[1]) return p; }
    return null;
  }

  /* The merchant key. Personal rows carry a counterparty (`who`); the same
     folding fhPersonKey applies to lessons is reused when present so a payee
     lesson that renames a merchant moves its series too. Family rows have no
     merchant column: the note's first three words plus the category, or the
     category plus an amount band when the note is empty (RR4, weakest). */
  function merchantKey(row) {
    if (!row) return '';
    const who = row.who || row.counterparty || '';
    if (who) {
      if (typeof window.fhPersonKey === 'function') { try { const k = fhPersonKey(who, '', 0); if (k) return 'm|' + String(k); } catch (e) { /* fall through */ } }
      return 'm|' + _norm(who);
    }
    const words = _norm(row.note).split(' ').filter(Boolean).slice(0, 3).join(' ');
    const cat = row.catId || row.cat || '';
    if (words) return 'n|' + words + '|' + cat;
    const band = row.amt > 0 ? Math.round(row.amt / 50000) : 0;
    return cat ? 'c|' + cat + '|' + band : '';
  }

  function seriesKey(row, period) {
    const mk = merchantKey(row); if (!mk) return '';
    return mk + '|' + period + (row.recurSig ? '|' + row.recurSig : '');
  }

  /* Next charge (RR2): a renew date the receipt stated wins; else the latest
     date plus the period, clamped to the shorter month's last day. */
  function addPeriod(iso, period) {
    const ms = _dateOf(iso); if (!isFinite(ms)) return null;
    const d = new Date(ms);
    if (period === 'weekly') return _iso(ms + 7 * _dayMs);
    const y = d.getUTCFullYear(), m = d.getUTCMonth(), day = d.getUTCDate();
    const ny = period === 'yearly' ? y + 1 : y, nm = period === 'yearly' ? m : m + 1;
    const last = new Date(Date.UTC(ny, nm + 1, 0)).getUTCDate();
    return _iso(Date.UTC(ny, nm, Math.min(day, last)));
  }
  function nextDate(latestIso, period, renewsOn) {
    if (renewsOn && /^\d{4}-\d{2}-\d{2}/.test(renewsOn)) return renewsOn.slice(0, 10);
    return period ? addPeriod(latestIso, period) : null;
  }
  function creep(latestAmt, prevAmt) {
    if (!(latestAmt > 0) || !(prevAmt > 0)) return 0;
    return latestAmt > prevAmt * (1 + CREEP) ? latestAmt - prevAmt : 0;
  }
  const labelVi = (p) => p === 'weekly' ? 'hàng tuần' : p === 'yearly' ? 'hàng năm' : p === 'monthly' ? 'hàng tháng' : '';
  const labelEn = (p) => p === 'weekly' ? 'weekly' : p === 'yearly' ? 'yearly' : p === 'monthly' ? 'monthly' : '';
  const perMonth = (amt, p) => p === 'weekly' ? amt * 52 / 12 : p === 'yearly' ? amt / 12 : amt;

  /* Group expense rows by merchant, walk each group by date, and decide a
     period per consecutive pair. Returns { series:[…], patches:[…] }:
       series  — what the tile and sheet show (every merchant that repeats or
                 carries a mark), newest first by next date;
       patches — rows detection would mark now: the latest row of a series
                 the ledger shows repeating, when it has no mark yet and its
                 merchant has no person-declined row. */
  function analyse(rows, todayIso) {
    const today = _dateOf(todayIso || new Date().toISOString());
    const groups = new Map();
    for (const r of rows || []) {
      if (!r || (r.kind && r.kind !== 'expense') || !(r.amt > 0) || !r.date) continue;
      const mk = merchantKey(r); if (!mk) continue;
      const g = groups.get(mk) || []; g.push(r); groups.set(mk, g);
    }
    const series = [], patches = [];
    for (const [mk, g] of groups) {
      g.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
      const declined = g.some((r) => r.recurSrc === 'person' && !r.recur);
      // A person's or a receipt's mark anchors the period for the whole merchant.
      const marked = g.filter((r) => r.recur).sort((a, b) => (a.recurSrc === 'person' ? -1 : 1) - (b.recurSrc === 'person' ? -1 : 1));
      let period = marked.length ? marked[0].recur : null;
      let source = marked.length ? marked[0].recurSrc : null;
      let count = 0, lastFits = false;
      if (!period && !declined && g.length >= 2) {
        // Consecutive pairs that agree on a period and stay within tolerance.
        const votes = {};
        for (let i = 1; i < g.length; i++) {
          const gap = Math.round((_dateOf(g[i].date) - _dateOf(g[i - 1].date)) / _dayMs);
          const p = periodOf(gap); if (!p) continue;
          const prev = g[i - 1].amt, cur = g[i].amt;
          if (Math.abs(cur - prev) > prev * TOL) continue;
          votes[p] = (votes[p] || 0) + 1;
        }
        const best = Object.keys(votes).sort((a, b) => votes[b] - votes[a])[0];
        if (best) { period = best; source = 'pattern'; count = votes[best] + 1; }
        /* Detection marks the latest row only when IT continues the chain: the
           gap before it fits the period and the amount is within tolerance. A
           hot month breaks the chain; the series still shows, softly. */
        if (best && g.length >= 2) {
          const l = g[g.length - 1], pr = g[g.length - 2];
          const gap = Math.round((_dateOf(l.date) - _dateOf(pr.date)) / _dayMs);
          lastFits = periodOf(gap) === best && Math.abs(l.amt - pr.amt) <= pr.amt * TOL;
        }
      }
      if (!period) continue;
      // The series proper: rows that fit the period's chain, newest last.
      const chain = g.filter((r) => !(r.recurSrc === 'person' && !r.recur));
      const latest = chain[chain.length - 1], previous = chain.length > 1 ? chain[chain.length - 2] : null;
      const soft = source === 'pattern' && chain.length < 3;
      const s = {
        key: seriesKey(latest, period), merchantKey: mk, period, source, soft,
        name: latest.who || latest.counterparty || latest.note || latest.cat || '',
        product: latest.recurSig ? String(latest.recurSig).split('|').pop() : null,
        latest, previous, rows: chain, count: chain.length,
        amount: latest.amt,
        next: nextDate(latest.date, period, latest.renewsOn || null),
        creep: previous ? creep(latest.amt, previous.amt) : 0,
        perMonth: perMonth(latest.amt, period),
      };
      s.dueInDays = s.next ? Math.round((_dateOf(s.next) - today) / _dayMs) : null;
      series.push(s);
      if (source === 'pattern' && lastFits && !latest.recur && !declined) {
        patches.push({ id: latest.id, recurrence: period, recurrence_source: 'pattern', _row: latest });
      }
    }
    series.sort((a, b) => {
      const da = a.dueInDays == null ? 1e9 : a.dueInDays, db = b.dueInDays == null ? 1e9 : b.dueInDays;
      return da - db;
    });
    return { series, patches };
  }

  function upcoming(series, days) {
    const h = days || UPCOMING_DAYS;
    return (series || []).filter((s) => s.dueInDays != null && s.dueInDays >= -3 && s.dueInDays <= h);
  }
  function monthlyTotal(series) {
    return (series || []).reduce((sum, s) => sum + (s.soft ? 0 : s.perMonth), 0);
  }

  window.FH_RECUR = Object.freeze({
    WINDOWS, TOL, CREEP, UPCOMING_DAYS,
    periodOf, merchantKey, seriesKey, addPeriod, nextDate, creep, labelVi, labelEn, perMonth,
    analyse, upcoming, monthlyTotal,
  });

  /* ── runners: detection over each ledger, written through its own door ──
     Both run in the deferred slot the receipt join uses (after hydrate), and
     again after an edit. A patch is one plaintext enum per row, never money. */
  let _persBusy = false;
  window.fhRecurRunPersonal = async function () {
    if (_persBusy || typeof window.fhPersonalData !== 'function' || typeof window.fhPersonalPatchMany !== 'function') return 0;
    const P = fhPersonalData(); if (!P || !P.uid) return 0;
    const rows = [].concat(P.txns || [], P.txnsOld || []).filter((t) => t && t.kind === 'expense' && !t._unreadable);
    const seen = new Set(); const uniq = [];
    for (const t of rows) { if (!seen.has(t.id)) { seen.add(t.id); uniq.push(t); } }
    const { patches } = analyse(uniq);
    if (!patches.length) return 0;
    _persBusy = true;
    try {
      const ok = await fhPersonalPatchMany(patches.map((p) => ({ id: p.id, fields: { recur: p.recurrence, recurSrc: 'pattern' } })));
      if (ok) for (const p of patches) { p._row.recur = p.recurrence; p._row.recurSrc = 'pattern'; }
      return patches.length;
    } catch (e) { return 0; } finally { _persBusy = false; }
  };
  window.fhRecurRunFamily = async function () {
    if (typeof window.fhTxnBulkPatch !== 'function' || !Array.isArray(window.txns)) return 0;
    const rows = window.txns.filter((t) => t && t._dbId && !t.future && (t.amt > 0));
    const { patches } = analyse(rows.map((t) => ({ id: t._dbId, date: _txnIsoOf(t), amt: t.amt, who: null, note: t.note, cat: t.cat, catId: t._catId,
      kind: 'expense', recur: t.recur || null, recurSrc: t.recurSrc || null, recurSig: null, renewsOn: null, _t: t })));
    for (const p of patches) {
      try { await fhTxnBulkPatch(p.id, { recurrence: p.recurrence, recurrence_source: 'pattern' }); p._row._t.recur = p.recurrence; p._row._t.recurSrc = 'pattern'; } catch (e) { /* next */ }
    }
    return patches.length;
  };
  function _txnIsoOf(t) {
    if (t.dateIso) return t.dateIso;
    const d = t._d instanceof Date ? t._d : null;
    return d ? (d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')) : '';
  }
  window._fhRecurTxnIso = _txnIsoOf;

  /* Series over the personal ledger, for the tile and the sheet. */
  window.fhRecurPersonalSeries = function () {
    if (typeof window.fhPersonalData !== 'function') return [];
    const P = fhPersonalData(); if (!P) return [];
    const rows = [].concat(P.txns || [], P.txnsOld || []).filter((t) => t && t.kind === 'expense' && !t._unreadable);
    const seen = new Set(); const uniq = [];
    for (const t of rows) { if (!seen.has(t.id)) { seen.add(t.id); uniq.push(t); } }
    return analyse(uniq).series;
  };
  window.fhRecurFamilySeries = function () {
    if (!Array.isArray(window.txns)) return [];
    const rows = window.txns.filter((t) => t && t._dbId && !t.future && (t.amt > 0)).map((t) => ({ id: t._dbId, date: _txnIsoOf(t), amt: t.amt, who: null,
      note: t.note, cat: t.cat, catId: t._catId, kind: 'expense', recur: t.recur || null, recurSrc: t.recurSrc || null, recurSig: null, renewsOn: null, _t: t }));
    return analyse(rows).series;
  };
})();
