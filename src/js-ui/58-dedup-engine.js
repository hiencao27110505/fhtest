/* ═══ Duplicate engine — one verdict per staged / imported row ═══════════════
   docs/specs/dedup-flaws-review.md Part E. Replaces the first-match-wins tiers
   that used to live inside bucketCsvCandidates (amount-only ledger match, near
   miss, pipeline flag, cross-source) with ONE pure function that returns, per
   candidate, either nothing or a verdict it can show evidence for:

     sure    — "Đã có trong sổ". Same amount, same calendar day, and either a
               shared merchant word or the same minute; or a rounded amount
               (under 1.000đ apart) with a shared merchant word. Measured on a
               real queue: 70 of 70 correct.
     likely  — "Có thể trùng". Same amount, same day, no text agreement, on the
               person's own row; a card posting within 3.5 days of an earlier
               email row; a kind conflict on an identical long text; two
               notices of one purchase inside the queue; a pipeline flag the
               screen cannot overrule. The person decides.
     (none)  — everything else. Same amount three days later in another
               member's book, same round amount on a different day: no chip,
               the row stays ticked. All ten false flags on the measured queue
               were in this class.

   Two passes: every candidate is scored against an amount-bucketed ledger
   index (O(n) lookups, never O(n×m)), then ledger rows are claimed one-to-one
   by descending evidence, so two candidates can never both be "sure" against
   the one row that can only explain one of them. In-queue pairing runs last
   and only for rows the ledger did not already explain.

   Global scope on purpose (js-ui): bucketCsvCandidates (57), the review chips
   (56) and quick review (76, via window) all call it. It owns no DOM and reads
   no state except through fhDedupLedgerIndex(). */

var FH_DEDUP_STOP = { vn:1, hcm:1, ho:1, chi:1, minh:1, cty:1, tnhh:1, viet:1, nam:1, vietnam:1,
  ctcp:1, the:1, va:1, den:1, tien:1, chuyen:1, thanh:1, toan:1, dich:1, vu:1, hang:1, hoa:1,
  tai:1, mpos:1, customer:1, retailmastercard:1, ltd:1, com:1, pos:1, thanhtoan:1, giao:1, dv:1 };
var FH_DEDUP_NOISE = ['internetbanking', 'mobilebanking', 'onlinebanking', 'smartbanking',
                      'ebanking', 'digibank', 'banking', 'ebank', 'bank', 'jsc'];

function fhDedupDeburr(s){ return String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D'); }
/* Merchant words worth agreeing on: 3+ letters, not boilerplate, not a bare
   number (order ids differ between two copies of one purchase). */
function fhDedupTokens(s){
  var out = {};
  fhDedupDeburr(s).toLowerCase().split(/[^a-z0-9]+/).forEach(function(w){
    if(w.length < 3 || FH_DEDUP_STOP[w] || /^\d+$/.test(w)) return;
    out[w] = 1;
  });
  return out;
}
function fhDedupShared(a, b){ for(var w in a){ if(b[w]) return w; } return ''; }
function fhDedupSharedCount(a, b){ var n = 0; for(var w in a){ if(b[w]) n++; } return n; }
function fhDedupCanon(name){
  if(typeof csvCanonicalProvider === 'function') return csvCanonicalProvider(name);
  var s = fhDedupDeburr(name).toLowerCase().replace(/[^a-z0-9]/g, '');
  for(var i = 0; i < FH_DEDUP_NOISE.length; i++) s = s.split(FH_DEDUP_NOISE[i]).join('');
  return s;
}
function fhDedupDay(d){
  if(!(d instanceof Date) || isNaN(d.getTime())) return '';
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
function fhDedupBucket(amtD){ return Math.round(Number(amtD) / 1000); }
/* A counterparty that is literally a bank ("Ngân hàng TMCP Quốc tế Việt Nam")
   is not a merchant: the mail is the card's posting / settlement notice for a
   purchase already announced from the account side. Real queue, 2026-09-16:
   VIB's posting three days after the Foody alert, same amount, both typed
   bank_txn on a credit card — nothing else told the two shapes apart. */
function fhDedupBankNamed(s){ var d = fhDedupDeburr(s).toLowerCase(); return /\bngan hang\b|\bbank\b|\btmcp\b/.test(d); }
/* "₫", "VNĐ", "đồng" and "VND" are one currency. A raw string compare called a
   VIB card posting and its account-side alert two currencies (real queue,
   2026-09-16) and never paired them. fhCurNorm (the FX layer's normaliser)
   when it is loaded; the same synonyms inline otherwise, so the engine and its
   tests never disagree with the app. */
function fhDedupCur(v){
  if(typeof window !== 'undefined' && typeof window.fhCurNorm === 'function') return window.fhCurNorm(v || 'VND');
  var s = fhDedupDeburr(v == null ? '' : v).trim().toUpperCase();
  if(!s || s === 'VND' || s === 'VN\u0110' || s === 'D' || s === '\u20AB' || s === 'DONG' || s === 'VNDONG') return 'VND';
  return s;
}

/* THE LEDGER THIS IMPORT WILL LAND IN — both books, when both are in play.
   Destination is per row and editable until Import, so the index is wider than
   "the book this row is going to": a hit in either book is worth the same tap.

   Every entry carries RAW ĐỒNG (`amtD`): ledger rows store base units, a
   candidate carries the đồng the bank mail stated, and comparing the two raw
   is the 2026-09-03 bug that made the ledger check match nothing for VND.

   Family rows: planned/future rows are NOT existing spending and never match.
   `mine` is whether the current member logged it — another member's row can
   confirm a duplicate only with text or minute agreement, never on amount and
   day alone (five of ten false flags on the measured queue were exactly that).

   Personal rows: the review-time slice (fhPersonalMatchSlice, 365-day horizon,
   all kinds) when present, else the ~2-month tab cache. MIRRORS ARE DROPPED —
   a family row the person authored is copied into their personal book with a
   link, and indexing both let two candidates each claim "their own" copy of
   one purchase. */
function fhDedupLedgerIndex(){
  var mult = (typeof curMult === 'function' ? curMult() : 1) || 1;
  var myMember = (typeof window !== 'undefined' && window.DB && window.DB.ownerMemberId) || null;
  var rows = [], byAmt = {};
  var add = function(r){ rows.push(r); var k = fhDedupBucket(r.amtD); (byAmt[k] = byAmt[k] || []).push(r); };
  ((typeof window !== 'undefined' && window.txns) || []).forEach(function(t){
    if(!t._d || t.amt == null || t.future) return;
    var mine = myMember ? (t._memberId ? t._memberId === myMember : null) : null;
    if(t.who === 'Shared') mine = null;
    add({ id: t.id, amtD: Number(t.amt) * mult, _d: t._d, day: fhDedupDay(t._d), kind: t.kind || 'expense',
          book: 'family', note: t.note || '', cat: t.cat || '', who: t.who || '', mine: mine,
          inst: t.inst || '', src: t.src || '', time: t.time || '' });
  });
  var mineRows = (typeof window !== 'undefined' && window._fhPersonalMatchSlice) || null;
  if(!mineRows || !mineRows.length){
    var pd = (typeof window !== 'undefined' && typeof window.fhPersonalData === 'function') ? window.fhPersonalData() : null;
    mineRows = (pd && pd.txns) || [];
  }
  mineRows.forEach(function(t){
    if(t.amt == null || !t.date) return;
    if(t.link || t.linkId) return;                       // a mirror of a family row already indexed
    var d = new Date(t.date + 'T00:00:00');
    if(isNaN(d.getTime())) return;
    add({ id: t.id, amtD: Number(t.amt) * mult, _d: d, day: fhDedupDay(d), kind: t.kind || 'expense',
          book: 'personal', note: t.note || '', cat: t.cat || '', who: '', mine: true,
          inst: '', src: t.src || '', time: t.time || '' });
  });
  return { rows: rows, byAmt: byAmt };
}

/* One candidate, every ledger row that could explain it, best first.
   Candidate shape (all optional except amount/date):
     amount (đồng), date (Date), dateDisplay 'YYYY-MM-DD', time 'HH:MM' | '',
     description, counterparty, isIncome, isTransfer (card payment / own
     transfer / loan — never matched to spending), accountKind, provider. */
function fhDedupLedgerOptions(c, index){
  if(!c || c.amount == null || !(c.date instanceof Date) || isNaN(c.date.getTime())) return [];
  if(c.isTransfer) return [];
  var amount = Number(c.amount), want = c.isIncome ? 'income' : 'expense';
  var day = c.dateDisplay || fhDedupDay(c.date);
  var ctok = fhDedupTokens((c.description || '') + ' ' + (c.counterparty || ''));
  var k = fhDedupBucket(amount), out = [];
  for(var b = k - 1; b <= k + 1; b++){
    var rows = index.byAmt[b]; if(!rows) continue;
    for(var i = 0; i < rows.length; i++){
      var t = rows[i];
      var diff = Math.abs(t.amtD - amount);
      if(diff >= 1000) continue;
      var dd = Math.abs(t._d.getTime() - c.date.getTime()) / 864e5;
      if(dd > 3.5) continue;
      var exact = diff < 1, sameDay = t.day === day;
      var ttok = fhDedupTokens(t.note);
      var shared = fhDedupShared(ctok, ttok);
      var noteMin = (String(t.note || '').match(/(\d{2}:\d{2})\s*$/) || [])[1] || '';
      var minute = !!(c.time && (t.time === c.time || noteMin === c.time));
      var tier = '', why = '';
      if(t.kind === want){
        if(sameDay && exact && (shared || minute)){ tier = 'sure'; why = shared ? 'exact_merchant' : 'exact_minute'; }
        else if(sameDay && shared){ tier = 'sure'; why = 'rounded_merchant'; }
        else if(sameDay && exact){ if(t.mine !== false){ tier = 'likely'; why = 'exact_day'; } }
        else if(exact && (c.accountKind === 'credit_card' || fhDedupBankNamed(c.counterparty)) && /email/.test(t.src || '')){ tier = 'likely'; why = 'card_posting'; }
      } else if((t.kind === 'expense' || t.kind === 'income') && sameDay && exact && fhDedupSharedCount(ctok, ttok) >= 2){
        tier = 'likely'; why = 'kind_conflict';   // the earlier import filed it the other way round
      }
      if(!tier) continue;
      out.push({ tier: tier, why: why, twin: t, twinKind: 'ledger', shared: shared,
                 score: (tier === 'sure' ? 300 : 200) + (minute ? 3 : 0) + (shared ? 2 : 0) + (exact ? 1 : 0) - dd });
    }
  }
  /* A card STATEMENT's final figure for a foreign purchase (statement-capture-spec.md
     section 3.4). The email that booked this purchase carried our ESTIMATE in VND --
     the promote step says so in the note, "[111 USD @26,350 +3% est.]" -- and the
     statement carries what the bank actually charged. They differ by the rate and
     the fee, which is far outside the 1.000d window above, so without this tier the
     same purchase would arrive a second time as a new row and be counted twice.
     Narrow on purpose: only a statement row, only against a ledger row that SAYS it
     is an estimate, the same merchant word, a few days, and within 6%. */
  if(!out.length && c.statement && !c.isIncome){
    var lo = fhDedupBucket(amount * 0.94), hi = fhDedupBucket(amount * 1.06);
    for(var fb = lo; fb <= hi; fb++){
      var frows = index.byAmt[fb]; if(!frows) continue;
      for(var fi = 0; fi < frows.length; fi++){
        var ft = frows[fi];
        if(ft.kind !== 'expense' || !/\[[\d.,]+ [A-Z]{3}[^\]]*est\.\]/.test(String(ft.note || ''))) continue;
        var fdd = Math.abs(ft._d.getTime() - c.date.getTime()) / 864e5;
        if(fdd > 4.5) continue;
        var fshared = fhDedupShared(ctok, fhDedupTokens(String(ft.note || '').replace(/\[[^\]]*\]/g, ' ')));
        if(!fshared) continue;
        out.push({ tier: 'sure', why: 'fx_final', twin: ft, twinKind: 'ledger', shared: fshared, score: 300 - fdd });
      }
    }
  }
  out.sort(function(a, b){ return b.score - a.score; });
  return out;
}

/* Verdicts for a whole batch. Returns an array parallel to `cands`: a verdict
   object or null. opts.kindById(id) answers 'bank' | 'other' | '' for the row
   a pipeline flag points at (the screen can read sealed kinds; the pipeline
   could not). */
function fhDedupAssess(cands, index, opts){
  opts = opts || {};
  index = index || { rows: [], byAmt: {} };
  var n = cands.length, verdict = new Array(n), options = new Array(n);
  var order = [];
  for(var i = 0; i < n; i++){ verdict[i] = null; options[i] = fhDedupLedgerOptions(cands[i], index); if(options[i].length) order.push(i); }
  // One-to-one: the strongest claim on a ledger row wins it; the rest look on.
  order.sort(function(a, b){ return options[b][0].score - options[a][0].score; });
  var claimed = {};
  order.forEach(function(i){
    for(var j = 0; j < options[i].length; j++){
      var o = options[i][j], key = o.twin.book + ':' + o.twin.id;
      if(claimed[key]) continue;
      claimed[key] = 1; verdict[i] = o; return;
    }
  });

  /* In-queue pairing, for rows the ledger did not explain. The earlier row
     (by bank time, then arrival) stays; the later one is the echo asked about. */
  var byAmtQ = {};
  for(var q = 0; q < n; q++){
    var c = cands[q];
    if(!c || c.amount == null || !(c.date instanceof Date) || isNaN(c.date.getTime()) || c.isTransfer) continue;
    var kq = fhDedupBucket(Number(c.amount)); (byAmtQ[kq] = byAmtQ[kq] || []).push(q);
  }
  var earlier = function(a, b){ var da = cands[a].date.getTime(), db = cands[b].date.getTime(); return da !== db ? da < db : a < b; };
  for(var q2 = 0; q2 < n; q2++){
    var b2 = cands[q2];
    if(!b2 || verdict[q2] || b2.amount == null || !(b2.date instanceof Date) || b2.isTransfer) continue;
    var kb = fhDedupBucket(Number(b2.amount)), peers = byAmtQ[kb] || [];
    var mineP = fhDedupCanon(b2.provider), bCur = fhDedupCur(b2.currency);
    var found = null, foundWhy = '';
    for(var p = 0; p < peers.length && !found; p++){
      var ai = peers[p]; if(ai === q2) continue;
      var a2 = cands[ai];
      if(!earlier(ai, q2)) continue;                      // only the later row is the echo
      if(Math.abs(Number(a2.amount) - Number(b2.amount)) >= 1) continue;
      if(fhDedupCur(a2.currency) !== bCur) continue;
      if(!!a2.isIncome !== !!b2.isIncome) continue;
      var dd2 = Math.abs(a2.date.getTime() - b2.date.getTime()) / 864e5;
      var theirs = fhDedupCanon(a2.provider);
      if(!mineP || !theirs) continue;                      // unknown on either side: refuse to guess
      if(theirs !== mineP){
        // One swipe seen from two sides: a bank and a non-bank. Two banks are two accounts.
        if(dd2 > 3 || b2.isIncome) continue;
        if(b2.kind === 'bank' && a2.kind === 'bank') continue;
        found = ai; foundWhy = 'cross_source';
      } else {
        // Same bank twice: two shapes of one purchase (notice + receipt, or a
        // card posting after the account-side alert). The same shape is two
        // real transfers, however close — Trang's 44 same-day topups.
        if(dd2 > 3.5) continue;
        /* A STATEMENT row and an EMAIL row from the same bank: the statement re-reports
           what the alert already reported, so the pair differs by SOURCE even when its
           shape is identical -- and would otherwise both import (statement-capture-spec
           section 11). Tighter than the shape rule because nothing else vouches for it:
           the same calendar day, and within five minutes when both carry a clock. Two
           statement rows are still two purchases; so are two emails. */
        if(!!a2.statement !== !!b2.statement){
          if((a2.dateDisplay || fhDedupDay(a2.date)) !== (b2.dateDisplay || fhDedupDay(b2.date))) continue;
          if(a2.time && b2.time){
            var ma = (+a2.time.slice(0, 2)) * 60 + (+a2.time.slice(3, 5)), mb = (+b2.time.slice(0, 2)) * 60 + (+b2.time.slice(3, 5));
            if(Math.abs(ma - mb) > 5) continue;
          }
          found = ai; foundWhy = 'statement_echo';
          continue;
        }
        var shapeDiff = (a2.shape || '') !== (b2.shape || '') || (a2.accountKind || '') !== (b2.accountKind || '')
                     || fhDedupBankNamed(a2.counterparty) !== fhDedupBankNamed(b2.counterparty);
        if(!shapeDiff) continue;
        found = ai; foundWhy = 'same_bank_pair';
      }
    }
    if(found != null){ verdict[q2] = { tier: 'likely', why: foundWhy, twin: cands[found], twinKind: 'queue', twinIndex: found, shared: '' }; continue; }
    /* The pipeline's verdict, demoted from delete order to suspicion. The screen
       drops a flag it can PROVE wrong (two banks) rather than passing the tap on. */
    if(b2.pipelineDupOf){
      var matchedKind = typeof opts.kindById === 'function' ? opts.kindById(b2.pipelineDupOf) : '';
      if(b2.kind === 'bank' && matchedKind === 'bank'){ b2.pipelineDupOverruled = true; }
      else verdict[q2] = { tier: 'likely', why: 'pipeline', twin: null, twinKind: 'pipeline', shared: '' };
    }
  }
  return verdict;
}
