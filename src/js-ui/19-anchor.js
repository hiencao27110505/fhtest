/* ═══ Dated anchors (docs/specs/statement-balance-spec.md §2, §10, §11) ═══════
   An account's anchor used to mean one thing: "this number is true NOW, every
   row before this moment is already inside it" (full-ledger-spec §5.1). A bank
   statement's closing balance is true for a day in the past, so an anchor read
   from a statement carries that day, and the ledger rows the statement does not
   contain bring it forward:

     today = statement balance + rows after its last day
                               + rows on its EDGE that the file does not list

   The edge is the statement's last day for an account or a wallet (a file
   exported at noon misses the afternoon) and its last five days for a card (a
   purchase dated before the statement date can post after it). Rows before the
   edge are inside the balance whether or not the ledger agrees with the file:
   the statement is the authority for its own period.

   Pure on purpose: no DOM, no network, no app state. 19-personal.js hands it the
   account and the account-tagged rows; tools/statement-balance.test.js drives it
   under Node. Amounts on rows are base units (thousands of đồng); the file's
   rows in the anchor's meta are đồng, so every comparison is made in đồng. */

var ANCHOR_COV_MIN = 0.95;        // share of the statement's money the ledger must have known (SB10)
var ANCHOR_EST_TOL = 0.06;        // an estimated foreign amount may sit this far from the settled one
var ANCHOR_ROWS_MAX = 400;        // file rows kept in the meta, newest

var _ANCHOR_KINDS = { expense: 1, income: 1, transfer: 1, loan: 1, repayment: 1, investment: 1 };

/* What one ledger row does to its account, in base units. Expense and loan
   drain; everything else carries its sign inside the amount (0105, 0109, 0122,
   0123). A new kind that moves an account is added HERE. */
function fhAnchorDelta(r){ return (r.kind === 'expense' || r.kind === 'loan') ? -r.amt : r.amt; }

function _anchorLocalDay(iso){
  var d = new Date(iso);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
function _anchorAddDays(day, n){
  var d = new Date(day + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
/* The meta of an anchor that came from a statement and was accepted, else null. */
function fhAnchorMetaSet(a){
  var m = a && a.anchorMeta;
  return (a && a.anchorK != null && m && m.src === 'stmt' && m.state === 'set' && m.asof) ? m : null;
}
/* A statement's number waiting on an account that has none yet, else null. */
function fhAnchorOffer(a){
  var m = a && a.anchorMeta;
  return (a && a.anchorK == null && m && m.src === 'stmt' && m.state === 'offer' && m.asof && isFinite(m.k)) ? m : null;
}
/* The day an anchor is true for. On a statement anchor `anchor_at` is the END of
   that day, not the moment it was written, so every reader asks here. */
function fhAnchorAsof(a){
  var m = fhAnchorMetaSet(a);
  if (m) return m.asof;
  return (a && a.anchorK != null && a.anchorAt) ? _anchorLocalDay(a.anchorAt) : null;
}
/* The instant stored in anchor_at for a statement anchor. Statements here are
   Vietnamese: the day ends at +07:00. A client older than this release reads it
   as "typed at the end of that day", which is right for every later row. */
function fhAnchorAtOf(asof){ return new Date(asof + 'T23:59:59+07:00').toISOString(); }

function _anchorEst(r){ return /est\.\]/.test(String(r.note || '')); }

/* The file's rows on the edge, as a multiset: each one can absorb ONE ledger row. */
function _anchorEdgePool(m){
  var from = _anchorAddDays(m.asof, -(Math.max(1, m.open || 1) - 1)), pool = {}, byDay = {};
  (m.rows || []).forEach(function(x){
    var day = x[0], dong = Math.round(x[1]);
    if (day < from || day > m.asof) return;
    var k = day + '|' + dong; pool[k] = (pool[k] || 0) + 1;
    (byDay[day] = byDay[day] || []).push(dong);
  });
  return { from: from, pool: pool, byDay: byDay };
}

/* The balance. `rows` = the account-tagged ledger rows (all months); `opts.mult`
   = đồng per base unit; `opts.upto` stops at a day (the drift badge compares
   like with like). Returns null for an account with no anchor. */
function fhAnchorWalk(acct, rows, opts){
  if (!acct || acct.anchorK == null) return null;
  opts = opts || {};
  var mult = opts.mult || 1000, upto = opts.upto || null;
  var m = fhAnchorMetaSet(acct);
  var anchorDay = (!m && acct.anchorAt) ? _anchorLocalDay(acct.anchorAt) : null;
  var bal = acct.anchorK, later = { n: 0, sum: 0 }, edgeRows = [];
  var edge = m ? _anchorEdgePool(m) : null;
  var add = function(r){ var d = fhAnchorDelta(r); bal += d; later.n++; later.sum += d; };
  for (var i = 0; i < (rows || []).length; i++) {
    var r = rows[i];
    if (!r || r.accountId !== acct.id || r._unreadable || r.amt == null || !_ANCHOR_KINDS[r.kind]) continue;
    if (upto && r.date > upto) continue;
    if (m) {
      if (r.date > m.asof) { add(r); continue; }
      if (r.date < edge.from) continue;                      // before the edge: inside the statement
      edgeRows.push(r);
    } else {
      if (anchorDay) {
        if (r.date < anchorDay) continue;
        if (r.date === anchorDay && (!r.ts || r.ts <= acct.anchorAt)) continue;
      }
      add(r);
    }
  }
  if (m && edgeRows.length) {
    /* Order-independent: exact matches claim their file row first, then a row
       marked as an estimate may take what is left of its day within tolerance. */
    edgeRows.sort(function(a, b){ return a.date < b.date ? -1 : (a.date > b.date ? 1 : String(a.id || '').localeCompare(String(b.id || ''))); });
    var left = [];
    edgeRows.forEach(function(r){
      var k = r.date + '|' + Math.round(fhAnchorDelta(r) * mult);
      if (edge.pool[k] > 0) { edge.pool[k]--; var a = edge.byDay[r.date], ix = a.indexOf(Math.round(fhAnchorDelta(r) * mult)); if (ix >= 0) a.splice(ix, 1); }
      else left.push(r);
    });
    left.forEach(function(r){
      if (_anchorEst(r)) {
        var mine = fhAnchorDelta(r) * mult, day = edge.byDay[r.date] || [];
        for (var j = 0; j < day.length; j++) {
          var x = day[j];
          if (x !== 0 && (x < 0) === (mine < 0) && Math.abs(mine - x) <= Math.abs(x) * ANCHOR_EST_TOL) { day.splice(j, 1); return; }
        }
      }
      add(r);                                                // on the edge and not in the file: after the statement
    });
  }
  return { bal: bal, base: acct.anchorK, later: later, asof: m ? m.asof : anchorDay, stmt: !!m };
}

/* How much of the statement the ledger already knew, by money. Each file row is
   looked up by (day, đồng) among this account's ledger rows; rows that entered
   the ledger FROM a statement do not count, or importing a statement would
   prove its own coverage. Returns null when the meta holds no rows. */
function fhAnchorCoverage(acct, rows, opts){
  var m = fhAnchorMetaSet(acct) || fhAnchorOffer(acct);
  if (!m || !m.rows || !m.rows.length) return null;
  var mult = (opts && opts.mult) || 1000, pool = {};
  (rows || []).forEach(function(r){
    if (!r || r.accountId !== acct.id || r._unreadable || r.amt == null || !_ANCHOR_KINDS[r.kind]) return;
    if (r.src === 'statement-email') return;
    if (r.date > m.asof || (m.from && r.date < m.from)) return;
    var k = r.date + '|' + Math.round(fhAnchorDelta(r) * mult); pool[k] = (pool[k] || 0) + 1;
  });
  var sum = 0, got = 0, n = 0, k = 0;
  m.rows.forEach(function(x){
    var a = Math.abs(Math.round(x[1])), key = x[0] + '|' + Math.round(x[1]);
    n++; sum += a;
    if (pool[key] > 0) { pool[key]--; k++; got += a; }
  });
  return { n: n, k: k, sum: sum, got: got, share: sum > 0 ? got / sum : 0 };
}

/* What a surface shows for an account. `shown` is the figure a tile leads with:
   the brought-forward balance, or the dated statement number when rows came
   after the statement and the ledger had not known enough of it (SB10). Totals
   read `bal`, always. */
function fhAnchorView(acct, rows, opts){
  var w = fhAnchorWalk(acct, rows, opts);
  if (!w) return null;
  var out = { bal: w.bal, base: w.base, later: w.later, asof: w.asof, src: w.stmt ? 'stmt' : 'typed', mode: 'current', shown: w.bal, cov: null };
  if (w.stmt && w.later.n > 0) {
    var c = fhAnchorCoverage(acct, rows, opts);
    out.cov = c ? c.share : 0;
    if (!(out.cov >= ANCHOR_COV_MIN)) { out.mode = 'dated'; out.shown = w.base; }
  }
  return out;
}

/* What a statement's balance may do to an account (SB6, SB7):
     'offer' the account has no number; the wizard will pre-fill this one
     'set'   the account was confirmed once and this statement is newer
     'keep'  an equal or newer starting point is already there
     'none'  the statement carries no balance */
function fhAnchorDecide(acct, facts){
  if (!acct || !facts || !facts.ok || !facts.asof || !isFinite(facts.balDong)) return 'none';
  if (acct.anchorK == null) { var o = fhAnchorOffer(acct); return (!o || facts.asof >= o.asof) ? 'offer' : 'keep'; }
  var cur = fhAnchorAsof(acct);
  return (!cur || facts.asof > cur) ? 'set' : 'keep';
}

/* The meta written beside the anchor. `k` is base units, asset view. */
function fhAnchorMetaOf(facts, state, mult){
  var rows = (facts.rows || []).slice(-ANCHOR_ROWS_MAX);
  return { v: 1, src: 'stmt', state: state, k: facts.balDong / (mult || 1000), sid: facts.sid || null,
    asof: facts.asof, from: facts.from || (rows.length ? rows[0][0] : facts.asof), open: facts.open || 1, how: facts.how || '', rows: rows };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { fhAnchorDelta: fhAnchorDelta, fhAnchorMetaSet: fhAnchorMetaSet, fhAnchorOffer: fhAnchorOffer, fhAnchorAsof: fhAnchorAsof,
    fhAnchorAtOf: fhAnchorAtOf, fhAnchorWalk: fhAnchorWalk, fhAnchorCoverage: fhAnchorCoverage, fhAnchorView: fhAnchorView,
    fhAnchorDecide: fhAnchorDecide, fhAnchorMetaOf: fhAnchorMetaOf, ANCHOR_COV_MIN: ANCHOR_COV_MIN };
}