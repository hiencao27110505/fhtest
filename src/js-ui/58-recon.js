/* ═══ Reconcile matcher — docs/specs/reconcile-spec.md Part 3 (§9 to §13) ═══
   One money event is one row. This pairs the copies of one event by the facts
   BOTH copies carry, whatever produced them and whichever arrived first (R10):

     must agree      direction of money; amount to the đồng (or under 1.000 đ
                     when the booked row was typed by hand and a word agrees);
                     days at most one apart; the account when both sides name
                     an owned one.
     proves two      two owned accounts; two machine-read clocks 120 minutes
                     or more apart; two source IDs of one kind that differ;
                     two queue rows of one lane in one shape; opts.notDup (R17).
                     (Opposite directions are their own question, R13, and
                     never for a refund or a transfer leg.)
     raises to sure  the same source ID; the same account and a shared word or
                     the same memo; the same account and the same minute; the
                     same account and mutual uniqueness; no account on the
                     booked side and mutual uniqueness in the book (R15).
                     Across a day, only with the same ID or a shift the
                     clock explains (R12 as amended; _fhRcShiftOk).
     everything else that agrees and is not proved different: likely.

   Same contract as fhDedupAssess (58-dedup-engine.js): an array parallel to
   `cands`, each null or { tier, why, twin, twinKind, twinIndex?, shared,
   dayShift }, dayShift = the candidate's day minus its twin's. The matcher is
   pure: it reads only its arguments and writes nothing (the one exception is a
   memo of the book's lookup tables on the index object it is handed, which is
   built per bucketing and never enumerated). No DOM, no storage.

   Below the matcher: the input builders (account lookup, candidate facts, the
   slice range) and the R20 mode and shadow counters. Those read app state; the
   matcher never calls them. */

var FH_RECON_DEFAULT = 'shadow';     // R20: the build default; localStorage 'fh-recon' overrides it per device
var FH_RECON_BOOK_MIN = 200000;      // R15: đồng; below this a book-wide uniqueness needs a shared word
/* R13: a refund is never anyone's duplicate through the opposite-direction rule.
   Run on deburred, lower-cased, space-separated text ("hoàn tiền", "hoan tra"). */
var FH_RECON_REFUND = /\bhoan\b|\brefund|\breversal/;

function _fhRcDayNum(s){
  var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s || ''));
  return m ? Math.round(Date.UTC(+m[1], +m[2] - 1, +m[3]) / 864e5) : null;
}
function _fhRcText(s){ return fhDedupDeburr(s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(); }
/* "Identical memo text": after normalising, one contains the other. Six
   characters at least, so an empty or two-letter memo never agrees with
   everything. Catches memos made only of stop words or a bare reference
   number, which fhDedupTokens drops. */
function _fhRcMemoSame(a, b){
  if(a.length < 6 || b.length < 6) return false;
  return a.indexOf(b) >= 0 || b.indexOf(a) >= 0;
}
function _fhRcRef(s){ return String(s == null ? '' : s).replace(/\s+/g, '').toUpperCase(); }
/* 1 = the same source ID, -1 = IDs of the same kind that differ (two events),
   0 = nothing comparable. A kind is the issuer (provider key): a wallet's
   transaction id and a bank's reference are never compared. Ledger rows carry
   no refs in this wave; Part 4 fills `refs` and must normalise them alike. */
function _fhRcRefs(x, refs){
  if(!x.ref || !x.refKind || !refs) return 0;
  var other = false;
  for(var i = 0; i < refs.length; i++){
    var r = refs[i];
    if(!r || r.k !== x.refKind || !r.v) continue;
    if(_fhRcRef(r.v) === x.ref) return 1;
    other = true;
  }
  return other ? -1 : 0;
}
/* Two moments (dedup-flaws-review F-R2, generalised): both sides carry a clock
   a machine read and they are FH_DEDUP_MOMENT_GAP minutes or more apart, measured
   across the day boundary. The spec says "or on different days"; measuring the
   real gap instead keeps an alert at 23:58 and its wallet receipt at 00:01 one
   event, and every other different-day pair (a day apart in a ±1 window) is
   still two moments. Day-only rows, hand-typed rows and posting notices have
   no clock here (clock < 0) and never prove anything. */
function _fhRcTwoMoments(a, b, dd){
  if(a.clock < 0 || b.clock < 0) return false;
  return Math.abs(dd * 1440 + a.clock - b.clock) >= FH_DEDUP_MOMENT_GAP;
}
/* R12 as amended (2026-11-25): one day of tolerance makes a pair a CANDIDATE;
   it makes it certain only when the shift is explained. Exactly one side is
   day-only, and the other side's MACHINE clock says why the days differ: the
   day-only row is the day after and the clock is late, or the day before and
   the clock is early. Measured on one bank's year: every next-day account row
   had its alert at 21:12 or later, every day-early card row an alert before
   07:00. Anything else a day off (Monday's unbooked purchase against Tuesday's
   booked twin, a clockless booked row, two clocked rows) stays `likely`. The
   same ID needs no explaining; fx_final keeps its own window. */
var FH_RECON_LATE_MIN = 1200;    // 20:00
var FH_RECON_EARLY_MIN = 420;    // 07:00
function _fhRcShiftOk(a, b, dd){   // dd = a.dn - b.dn
  if(dd === 0) return true;
  if(a.hand || b.hand) return false;    // a typed row's day and time are both the person's, never the bank's cut-off
  var aDay = a.min < 0, bDay = b.min < 0;
  if(aDay === bDay) return false;
  var c = aDay ? b : a;                 // the side with a time
  if(c.clock < 0) return false;         // a typed time or a notice's posting time explains nothing
  var after = aDay ? dd > 0 : dd < 0;   // the day-only row is the day AFTER the clocked one
  return after ? c.clock >= FH_RECON_LATE_MIN : c.clock < FH_RECON_EARLY_MIN;
}
/* `sure` when the days agree or the shift is explained; else the same why, as a guess. */
function _fhRcSure(why, cls, dd, shared, shiftOk){
  return shiftOk ? _fhRcV('sure', why, cls, dd, shared, true) : _fhRcV('likely', why, 5, dd, shared, true);
}

/* Uniqueness without a scan: rows are counted by direction|đồng|day, overall
   and per account (an empty account counted under its own key). The partners
   of a row are the rows on the OTHER side with its direction, its exact
   amount, a day either way and no account that says otherwise: three map
   reads. Pairs a later rule clears still count, so uniqueness errs towards
   "not unique". */
function _fhRcKey(dir, abs, dn){ return dir + '|' + Math.round(abs) + '|' + dn; }
function _fhRcCount(cnt, dir, abs, dn, acct){
  var k = _fhRcKey(dir, abs, dn), ka = k + '|' + (acct || '');
  cnt[k] = (cnt[k] || 0) + 1;
  cnt[ka] = (cnt[ka] || 0) + 1;
}
function _fhRcPartners(cnt, dir, abs, dn, acct){
  var n = 0;
  for(var d = dn - 1; d <= dn + 1; d++){
    var k = _fhRcKey(dir, abs, d);
    n += acct ? (cnt[k + '|' + acct] || 0) + (cnt[k + '|'] || 0) : (cnt[k] || 0);
  }
  return n;
}

/* One candidate, read once. Direction comes from `dir` (the staged row's own
   debit/credit, set by fhReconCandFacts) because isIncome is cleared on every
   transfer-shaped row (57); a candidate without it falls back to isIncome. */
function _fhRcCand(c, i){
  if(!c || c.amount == null || !(c.date instanceof Date) || isNaN(c.date.getTime())) return null;
  var dn = _fhRcDayNum(c.dateDisplay || fhDedupDay(c.date)), abs = Math.abs(Number(c.amount));
  if(dn == null || !isFinite(abs)) return null;
  var words = (c.description || '') + ' ' + (c.counterparty || '');
  var timed = !!c.time && c.timePrecision !== 'day';
  var ref = _fhRcRef(c.ref);
  var refKind = ref ? (c.acctProviderKey || fhDedupCanon(c.provider || '')) : '';
  return { i: i, c: c, abs: abs, dn: dn,
    dir: (c.dir === 'in' || c.dir === 'out') ? c.dir : (c.isIncome ? 'in' : 'out'),
    tok: fhDedupTokens(words), text: _fhRcText(c.description || c.counterparty || ''),
    min: timed ? fhDedupMinutes(c.time) : -1,
    clock: (timed && !fhDedupNotice(c)) ? fhDedupMinutes(c.time) : -1,   // a posting notice's clock is the posting's (F-R2)
    acct: c.acctId || null, ref: ref, refKind: refKind, refs: (ref && refKind) ? [{ k: refKind, v: ref }] : null,
    lane: c.lane || '', stmt: !!c.statement || c.lane === 'statement', xfer: !!c.isTransfer,
    refund: !!c.refundWorded || FH_RECON_REFUND.test(_fhRcText(words)),
    prov: fhDedupCanon(c.provider || ''), cur: fhDedupCur(c.currency),
    shape: (c.shape || '') + '|' + (c.accountKind || '') + '|' + (fhDedupBankNamed(c.counterparty) ? 1 : 0) };
}

/* The book, read once per index. A row typed by hand has no `src`: its time is
   when it was typed and never a clock, and it is the only side a rounded
   amount may come from (the old engine's rounded_merchant). A machine clock is
   the old engine's test: a row imported from mail or a statement. */
function _fhRcBook(index){
  if(index._recon) return index._recon;
  var list = [], byAbs = {}, cnt = {};
  (index.rows || []).forEach(function(t, k){
    var dn = _fhRcDayNum(t.day), amt = Number(t.amtD);
    if(dn == null || !isFinite(amt)) return;
    var abs = t.absD != null ? Number(t.absD) : Math.abs(amt);
    var dir = (t.dir === 'in' || t.dir === 'out') ? t.dir : (fhDedupFlow(t.kind, amt) < 0 ? 'out' : 'in');
    var note = t.note || '', party = t.party || '';
    var nm = (String(note).match(/(\d{2}:\d{2})\s*$/) || [])[1] || '';
    var e = { k: k, t: t, abs: abs, dn: dn, dir: dir, hand: !t.src, acct: t.acct || null,
      xfer: t.kind === 'transfer' || t.kind === 'repayment',
      tok: fhDedupTokens(note + ' ' + party), text: _fhRcText(note),
      min: t.time ? fhDedupMinutes(t.time) : -1, noteMin: nm ? fhDedupMinutes(nm) : -1,
      clock: (t.time && /email/.test(t.src || '')) ? fhDedupMinutes(t.time) : -1,
      refs: t.refs || null, refund: FH_RECON_REFUND.test(_fhRcText(note + ' ' + party)) };
    list.push(e);
    var b = fhDedupBucket(abs); (byAbs[b] = byAbs[b] || []).push(e);
    _fhRcCount(cnt, dir, abs, dn, e.acct);
  });
  index._recon = { list: list, byAbs: byAbs, cnt: cnt };
  return index._recon;
}

/* Pair rank (R16): certain pairs first, ID, then words, then minute, then
   uniqueness; fx_final; then every guess; a direction conflict last. */
function _fhRcV(tier, why, cls, dd, shared, exact){
  return { tier: tier, why: why, cls: cls, dd: dd, shared: shared || '', exact: exact };
}

/* A queue row against one booked row: null (not a candidate, or proved two
   events) or a ranked verdict. `uniq` = mutual uniqueness, already counted. */
function _fhRcJudgeBook(x, e, uniq, opts){
  var dd = x.dn - e.dn;
  if(dd < -1 || dd > 1) return null;                                  // R12: one day either way
  if(x.acct && e.acct && x.acct !== e.acct) return null;              // two owned accounts (Part 5 funding is not in this wave)
  var ref = _fhRcRefs(x, e.refs);
  if(ref < 0) return null;
  if(opts.notDup && opts.notDup(x.c, e.t)) return null;               // R17 hook
  var diff = Math.abs(x.abs - e.abs), exact = diff < 1, sameDay = dd === 0;
  var shared = fhDedupShared(x.tok, e.tok);
  var minute = sameDay && x.min >= 0 && (x.min === e.min || x.min === e.noteMin);
  /* Another member's family row confirms only with a word or the minute
     (dedup-flaws-review FP2: five of ten measured false flags). Kept. */
  if(e.t.mine === false && !shared && !minute && ref <= 0) return null;
  /* A shared source ID is a fact: a clock gap then means one clock is a
     posting's, not that there were two events. */
  if(ref <= 0 && _fhRcTwoMoments(x, e, dd)) return null;
  if(x.dir !== e.dir){
    /* R13: opposite direction is its own question, never a refund's. Nor a
       transfer's: the two legs of one repayment (the deposit's debit, the
       card's "payment received") look exactly like this, and pairing legs is
       Part 5's leg_of_transfer, not a misread. */
    if(exact && sameDay && !x.refund && !e.refund && !x.xfer && !e.xfer && fhDedupSharedCount(x.tok, e.tok) >= 2) return _fhRcV('likely', 'direction_conflict', 6, dd, shared, exact);
    return null;
  }
  if(!exact && !(e.hand && diff < 1000 && shared)) return null;       // rounded: typed by hand, under 1.000 đ, a word agrees
  var sameAcct = !!(x.acct && x.acct === e.acct), shiftOk = _fhRcShiftOk(x, e, dd);
  if(ref > 0) return _fhRcV('sure', 'same_ref', 0, dd, shared, exact);
  if(!exact) return sameDay ? _fhRcV('sure', 'rounded_merchant', 1, dd, shared, false) : _fhRcV('likely', 'rounded_merchant', 5, dd, shared, false);
  if(sameAcct && (shared || _fhRcMemoSame(x.text, e.text))) return _fhRcSure('acct_text', 1, dd, shared, shiftOk);
  if(sameDay && shared) return _fhRcV('sure', 'exact_merchant', 1, dd, shared, true);
  if(sameAcct && minute) return _fhRcV('sure', 'acct_minute', 2, dd, shared, true);
  if(minute) return _fhRcV('sure', 'exact_minute', 2, dd, shared, true);
  /* Uniqueness alone never makes a wallet row sure: a wallet repeats amounts
     (76 genuine repeats measured, 11 within two minutes). R15, Part 6. */
  if(uniq && x.lane !== 'wallet'){
    if(sameAcct) return _fhRcSure('acct_unique', 3, dd, shared, shiftOk);
    if(!e.acct && (x.abs > FH_RECON_BOOK_MIN || shared)) return _fhRcSure('book_unique', 3, dd, shared, shiftOk);
  }
  return _fhRcV('likely', shared ? 'exact_merchant' : 'exact_day', 5, dd, shared, true);
}

/* Two queue rows: `b` is the one that would be flagged, `a` the one kept.
   Same must-agree and proofs as the book, exact amounts only (nothing in the
   queue is typed by hand), plus the queue's own proof: one lane, one shape. */
function _fhRcBankLane(x){ return x.lane === 'alert' || x.lane === 'statement'; }
function _fhRcJudgeQueue(b, a, opts){
  var dd = b.dn - a.dn;
  if(dd < -1 || dd > 1) return null;
  if(Math.abs(a.abs - b.abs) >= 1 || a.cur !== b.cur) return null;
  if(!a.prov || !b.prov) return null;                                 // an unknown source: refuse to guess (as the old engine)
  if(a.acct && b.acct && a.acct !== b.acct) return null;
  var ref = _fhRcRefs(b, a.refs);
  if(ref < 0) return null;
  if(opts.notDup && opts.notDup(b.c, a.c)) return null;
  if(ref <= 0){
    if(a.stmt && b.stmt) return null;                                 // two rows of one statement, or two R9 did not fold
    if(a.prov === b.prov){
      if(a.stmt === b.stmt && a.shape === b.shape) return null;       // one bank, one shape twice: two real movements
    } else if(a.lane === b.lane || (_fhRcBankLane(a) && _fhRcBankLane(b))) return null;   // two banks, or two wallets: two accounts
    if(_fhRcTwoMoments(b, a, dd)) return null;
  }
  var shared = fhDedupShared(b.tok, a.tok), sameDay = dd === 0;
  var minute = sameDay && b.min >= 0 && b.min === a.min;
  if(a.dir !== b.dir){
    if(sameDay && !a.refund && !b.refund && !a.xfer && !b.xfer && fhDedupSharedCount(b.tok, a.tok) >= 2) return _fhRcV('likely', 'direction_conflict', 6, dd, shared, true);   // R13, as for the book
    return null;
  }
  var sameAcct = !!(a.acct && a.acct === b.acct);
  if(ref > 0) return _fhRcV('sure', 'same_ref', 0, dd, shared, true);
  if(sameAcct && (shared || _fhRcMemoSame(b.text, a.text))) return _fhRcSure('acct_text', 1, dd, shared, _fhRcShiftOk(b, a, dd));
  if(sameAcct && minute) return _fhRcV('sure', 'acct_minute', 2, dd, shared, true);
  return _fhRcV('likely', a.prov !== b.prov ? 'cross_source' : (a.stmt !== b.stmt ? 'statement_echo' : 'same_bank_pair'), 5, dd, shared, true);
}
/* Which of two queue copies is kept: the earlier day; on one day the one with
   a machine clock (the poorer copy is flagged); then arrival order. */
function _fhRcKeeps(a, b){
  if(a.dn !== b.dn) return a.dn < b.dn;
  if((a.clock >= 0) !== (b.clock >= 0)) return a.clock >= 0;
  return a.i < b.i;
}
function _fhRcOrder(p, q){
  return (p.cls - q.cls) || (Math.abs(p.dd) - Math.abs(q.dd)) || ((p.exact ? 0 : 1) - (q.exact ? 0 : 1))
      || (p.x.i - q.x.i) || ((p.e ? p.e.k : p.a.i) - (q.e ? q.e.k : q.a.i));
}

/* Verdicts for a whole batch (R16: one-to-one, over the batch, never per row).
   opts.kindById(id) as for fhDedupAssess; opts.notDup(cand, entry) -> true
   proves two events (R17, wired in the next wave). The returned array also
   carries `overruled[i]` for a pipeline flag proved wrong (two banks), which
   the old engine wrote onto the candidate instead. */
function fhReconAssess(cands, index, opts){
  opts = opts || {};
  index = index || { rows: [] };
  var n = cands.length, out = new Array(n), X = new Array(n), qcnt = {}, i;
  for(i = 0; i < n; i++){
    out[i] = null; X[i] = _fhRcCand(cands[i], i);
    if(X[i]) _fhRcCount(qcnt, X[i].dir, X[i].abs, X[i].dn, X[i].acct);
  }
  var book = _fhRcBook(index), pairs = [], paired = {};

  // 1. Every candidate against the book: one amount bucket either side, ±1 day.
  X.forEach(function(x){
    if(!x) return;
    var pc = _fhRcPartners(book.cnt, x.dir, x.abs, x.dn, x.acct), k = fhDedupBucket(x.abs);
    for(var b = k - 1; b <= k + 1; b++){
      var rows = book.byAbs[b]; if(!rows) continue;
      for(var j = 0; j < rows.length; j++){
        var e = rows[j];
        if(e.dn < x.dn - 1 || e.dn > x.dn + 1) continue;
        var uniq = pc === 1 && Math.abs(x.abs - e.abs) < 1 && _fhRcPartners(qcnt, e.dir, e.abs, e.dn, e.acct) === 1;
        var v = _fhRcJudgeBook(x, e, uniq, opts);
        if(v){ v.x = x; v.e = e; pairs.push(v); paired[x.i] = 1; }
      }
    }
  });

  /* 2. R19: a card statement's final figure against a booked foreign-currency
     ESTIMATE. The old engine's fx_final, unchanged (only for a statement row
     that found nothing else, only an expense whose note says "est.", the same
     merchant word, a few days, within 6%), with the account added to "must
     agree", and the direction: the old engine never reached this for a
     transfer (its early return), and with R14 a money-in transfer must not
     match a booked purchase. Its dayShift is the real distance, up to four
     days. */
  X.forEach(function(x){
    var c = x && x.c;
    if(!x || paired[x.i] || !c.statement || c.isIncome) return;
    var lo = fhDedupBucket(x.abs * 0.94), hi = fhDedupBucket(x.abs * 1.06);
    for(var fb = lo; fb <= hi; fb++){
      var rows = book.byAbs[fb]; if(!rows) continue;
      for(var j = 0; j < rows.length; j++){
        var e = rows[j], t = e.t;
        if(t.kind !== 'expense' || !/\[[\d.,]+ [A-Z]{3}[^\]]*est\.\]/.test(String(t.note || ''))) continue;
        if(Math.abs(x.dn - e.dn) > 4 || x.dir !== e.dir) continue;
        if(x.acct && e.acct && x.acct !== e.acct) continue;
        var fshared = fhDedupShared(x.tok, fhDedupTokens(String(t.note || '').replace(/\[[^\]]*\]/g, ' ')));
        if(!fshared) continue;
        var fv = _fhRcV('sure', 'fx_final', 4, x.dn - e.dn, fshared, false);
        fv.x = x; fv.e = e; pairs.push(fv);
      }
    }
  });

  // 3. Claim, best pair first; a booked row explains one candidate.
  pairs.sort(_fhRcOrder);
  var claimed = {};
  pairs.forEach(function(p){
    if(out[p.x.i] || claimed[p.e.k]) return;
    claimed[p.e.k] = 1;
    out[p.x.i] = { tier: p.tier, why: p.why, twin: p.e.t, twinKind: 'ledger', shared: p.shared, dayShift: p.dd };
  });

  /* 4. The queue against itself, for rows the book did not explain. A kept row
     explains at most one row of each other source (lane, statement or not,
     provider), so an alert pairs with one statement row and one wallet row of
     the same event, and a third equal statement row stays its own purchase. */
  var byAbsQ = {}, qpairs = [];
  X.forEach(function(x){ if(x){ var b = fhDedupBucket(x.abs); (byAbsQ[b] = byAbsQ[b] || []).push(x); } });
  X.forEach(function(b){
    if(!b || out[b.i]) return;
    var peers = byAbsQ[fhDedupBucket(b.abs)] || [];
    for(var p = 0; p < peers.length; p++){
      var a = peers[p];
      if(a === b || !_fhRcKeeps(a, b)) continue;
      var v = _fhRcJudgeQueue(b, a, opts);
      if(v){ v.x = b; v.a = a; qpairs.push(v); }
    }
  });
  qpairs.sort(_fhRcOrder);
  var qclaimed = {};
  qpairs.forEach(function(p){
    var key = p.a.i + '|' + p.x.lane + '|' + (p.x.stmt ? 1 : 0) + '|' + p.x.prov;
    if(out[p.x.i] || qclaimed[key]) return;
    qclaimed[key] = 1;
    out[p.x.i] = { tier: p.tier, why: p.why, twin: cands[p.a.i], twinKind: 'queue', twinIndex: p.a.i, shared: p.shared, dayShift: p.dd };
  });

  /* 5. The pipeline's flag, as the old engine treats it: a suspicion, dropped
     when it can be proved wrong (two banks). No transfer exemption (R14). */
  var overruled = [];
  for(i = 0; i < n; i++){
    var c = cands[i];
    if(!X[i] || out[i] || !c.pipelineDupOf) continue;
    var mk = typeof opts.kindById === 'function' ? opts.kindById(c.pipelineDupOf) : '';
    if(c.kind === 'bank' && mk === 'bank') overruled[i] = true;
    else out[i] = { tier: 'likely', why: 'pipeline', twin: null, twinKind: 'pipeline', shared: '', dayShift: 0 };
  }
  out.overruled = overruled;
  return out;
}

/* ── Inputs (reconcile-spec §11). Read app state; never called by the matcher. ── */

/* The person's owned accounts by "providerKey|tail" -> [ids]. Built once per
   bucketing. Synchronous on purpose: fhPersonalAccountEnsure creates accounts
   and is async, and the matcher must not wait on, or cause, a write. The
   `alias` namespace (R8) is Part 2's and is not read yet. */
function _fhRcProvKey(name){
  try {
    if(typeof fhAcctProviderKey === 'function' && typeof window !== 'undefined' && window.FH_PROVIDERS) return fhAcctProviderKey(name || '') || '';
  } catch(e){}
  return fhDedupCanon(name || '');
}
function fhReconAcctIndex(accounts){
  var list = accounts;
  if(!list){
    try {
      var pd = (typeof window !== 'undefined' && typeof window.fhPersonalData === 'function') ? window.fhPersonalData() : null;
      list = (pd && pd.accounts) || [];
    } catch(e){ list = []; }
  }
  var idx = {};
  list.forEach(function(a){
    if(!a || !a.id || a.kind === 'investment') return;
    var tail = String(a.tail == null ? '' : a.tail).replace(/\D/g, '').slice(-4);
    var key = a.providerKey || _fhRcProvKey(a.provider);
    if(tail.length !== 4 || !key) return;
    (idx[key + '|' + tail] = idx[key + '|' + tail] || []).push(a.id);
  });
  return idx;
}

/* The lane a queue row came by (reconcile-spec §9). From the transport and
   the sealed sender kind, wallet first because R15 is about wallets however
   their rows arrive:
     file       not a staged row (a CSV/XLSX the person picked);
     scan       a merchant's own receipt mail (sender_kind 'receipt', the
                receipt flag), or any other non-bank sender (transaction_type
                is derived from the sender kind: anything but bank_txn /
                p2p_transfer is not a bank). Same facts as a scan: the
                seller's words, often a clock, no account. No photo scan
                reaches the queue today (78-receipt-scan books directly);
     wallet     an e-wallet account, a wallet-grained sender kind, or a
                wallet provider (the fhStagedAcct list);
     statement  a row read from a statement file (_transport 'statement');
     alert      every other staged row: a bank's mail. */
function fhReconLane(src){
  if(!src || !src.staged) return 'file';
  var rx = src.rx || {}, sk = rx.sender_kind || '';
  if(src.receipt || sk === 'receipt') return 'scan';
  if(rx.account_kind === 'ewallet' || (sk && sk !== 'bank')
     || /momo|zalopay|shopeepay|viettelmoney/.test(fhDedupCanon(src.provider || ''))) return 'wallet';
  if(rx._transport === 'statement') return 'statement';
  if(src.otherKind) return 'scan';
  return 'alert';
}

/* The fields §11 adds to a candidate, for both call sites (57, 76):
     src = { rx: the opened payload or null, provider: source_provider,
             staged, receipt, otherKind, isIncome, xferDir, text }
   `dir` comes from the payload's own debit/credit when it has one (57 clears
   isIncome on every transfer-shaped row, so isIncome alone cannot say which
   way a card repayment moved); a file row falls back to isIncome / _xferDir. */
function fhReconCandFacts(src, acctIdx){
  src = src || {};
  var rx = src.rx || null, prov = src.provider || '';
  var tail = rx ? String(rx.account_masked || '').replace(/\D/g, '').slice(-4) : '';
  if(tail.length !== 4) tail = '';
  var pkey = prov ? _fhRcProvKey(prov) : '';
  var hits = (acctIdx && pkey && tail) ? (acctIdx[pkey + '|' + tail] || []) : [];
  var dw = rx && rx.direction;
  return {
    acctTail: tail || null, acctProviderKey: pkey || null,
    acctId: hits.length === 1 ? hits[0] : null,                          // exactly one owned match, else unknown
    ref: (rx && rx.reference_number) ? String(rx.reference_number) : '',
    timePrecision: (rx && rx.time_precision) || '',
    lane: fhReconLane(src),
    dir: dw === 'credit' ? 'in' : dw === 'debit' ? 'out' : ((src.isIncome || src.xferDir === 'in') ? 'in' : 'out'),
    refundWorded: !!(rx && rx.stmt && rx.stmt.flow === 'refund') || FH_RECON_REFUND.test(_fhRcText(src.text || ''))
  };
}

/* R18: the period the queue is judging, as the match slice's lower bound:
   the earliest row minus 4 days (the latest plus 4 is informational; the slice
   has no upper bound). Null when no row has a readable date. */
function fhReconSliceRange(dates){
  var lo = null, hi = null;
  (dates || []).forEach(function(v){
    var d = v instanceof Date ? v : (v ? new Date(v) : null);
    if(!d || isNaN(d.getTime())) return;
    if(lo === null || d < lo) lo = d;
    if(hi === null || d > hi) hi = d;
  });
  if(!lo) return null;
  var a = new Date(lo.getTime()), b = new Date(hi.getTime());
  a.setDate(a.getDate() - 4); b.setDate(b.getDate() + 4);
  return { from: fhDedupDay(a), to: fhDedupDay(b) };
}

/* ── R20: mode and shadow ─────────────────────────────────────────────────── */

function fhReconMode(){
  var v = '';
  try { v = (typeof localStorage !== 'undefined' && localStorage) ? (localStorage.getItem('fh-recon') || '') : ''; } catch(e){ v = ''; }
  return (v === 'off' || v === 'shadow' || v === 'on') ? v : FH_RECON_DEFAULT;
}

/* Shadow record: COUNTS ONLY. No amount, name, memo, id or date is kept, in
   memory or on disk; why codes appear only as keys. `last` is the latest
   bucketing, `total` the running sum on this device. */
var FH_RECON_SHADOW = null, FH_RECON_SHADOW_FP = '';
var FH_RECON_COUNTS = ['judged', 'oldSure', 'oldLikely', 'newSure', 'newLikely', 'same', 'twinDiffers', 'oldOnly', 'newOnly', 'tierDiffers'];
function _fhRcZero(){ var z = { newWhy: {} }; FH_RECON_COUNTS.forEach(function(k){ z[k] = 0; }); return z; }
function _fhRcNum(v){ v = Number(v); return isFinite(v) && v >= 0 ? Math.floor(v) : 0; }
function _fhRcClean(p){
  var z = _fhRcZero();
  if(!p || typeof p !== 'object') return z;
  FH_RECON_COUNTS.forEach(function(k){ z[k] = _fhRcNum(p[k]); });
  var w = p.newWhy;
  if(w && typeof w === 'object') for(var k in w){ if(/^[a-z_]{1,32}$/.test(k)) z.newWhy[k] = _fhRcNum(w[k]); }
  return z;
}
function fhReconShadow(){
  if(!FH_RECON_SHADOW){
    var s = { runs: 0, errors: 0, last: _fhRcZero(), total: _fhRcZero() };
    try {
      var raw = (typeof localStorage !== 'undefined' && localStorage) ? localStorage.getItem('fh-recon-shadow') : null;
      var p = raw ? JSON.parse(raw) : null;
      if(p && typeof p === 'object'){ s.runs = _fhRcNum(p.runs); s.errors = _fhRcNum(p.errors); s.last = _fhRcClean(p.last); s.total = _fhRcClean(p.total); }
    } catch(e){}
    FH_RECON_SHADOW = s;
  }
  return FH_RECON_SHADOW;
}
if(typeof window !== 'undefined') window.fhReconShadow = fhReconShadow;
function _fhRcSave(s){
  try { if(typeof localStorage !== 'undefined' && localStorage) localStorage.setItem('fh-recon-shadow', JSON.stringify(s)); } catch(e){}
}
function _fhRcSameTwin(o, v){
  if(o.twinKind !== v.twinKind) return false;
  return o.twinKind === 'queue' ? o.twinIndex === v.twinIndex : o.twin === v.twin;
}
function fhReconShadowRecord(oldV, newV){
  var s = fhReconShadow(), z = _fhRcZero();
  for(var i = 0; i < oldV.length; i++){
    var o = oldV[i] || null, v = (newV && newV[i]) || null;
    z.judged++;
    if(o) z[o.tier === 'sure' ? 'oldSure' : 'oldLikely']++;
    if(v){ z[v.tier === 'sure' ? 'newSure' : 'newLikely']++; z.newWhy[v.why] = (z.newWhy[v.why] || 0) + 1; }
    if(!o && !v) z.same++;
    else if(o && !v) z.oldOnly++;
    else if(!o && v) z.newOnly++;
    else if(o.tier !== v.tier) z.tierDiffers++;
    else { z.same++; if(!_fhRcSameTwin(o, v)) z.twinDiffers++; }
  }
  s.last = z;
  /* One open queue is bucketed many times (every rebuild), so a total that
     added every run would count the same rows again and again. A run whose
     counts equal the previous run's is the same queue: `last` is replaced,
     `total` and `runs` are not. The fingerprint lives in memory only (it is
     a string; the stored record holds numbers). */
  var fp = JSON.stringify(z) + '|' + oldV.length;
  if(fp !== FH_RECON_SHADOW_FP){
    FH_RECON_SHADOW_FP = fp;
    FH_RECON_COUNTS.forEach(function(k){ s.total[k] += z[k]; });
    for(var w in z.newWhy) s.total.newWhy[w] = (s.total.newWhy[w] || 0) + z.newWhy[w];
    s.runs++;
  }
  _fhRcSave(s);
}

/* The one dispatch both call sites use. 'off': the old engine. 'shadow': the
   old engine decides, exactly as before; then this one runs on the same
   inputs, inside a catch, and only counts. 'on': this one decides, and a throw
   falls back to the old engine. Cheap by construction: no read beyond the
   index already built, nothing per repaint (bucketing runs per build). */
function fhReconRun(cands, index, opts){
  var mode = fhReconMode();
  if(mode === 'on'){
    try { return fhReconAssess(cands, index, opts); }
    catch(e){ try { fhReconShadow().errors++; } catch(e2){} }
  }
  var old = (typeof fhDedupAssess === 'function') ? fhDedupAssess(cands, index, opts) : cands.map(function(){ return null; });
  if(mode === 'shadow'){
    try { fhReconShadowRecord(old, fhReconAssess(cands, index, opts)); }
    catch(e){ try { var s = fhReconShadow(); s.errors++; _fhRcSave(s); } catch(e2){} }
  }
  return old;
}