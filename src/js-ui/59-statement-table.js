/* ═══ Statement table reader (docs/specs/statement-capture-spec.md §10, §11) ═══
   A statement file is not a tidy export. The table header sits on row 25 under a
   merged-cell preamble; sub-header rows interrupt the table ("Số thẻ/Số tài khoản:
   …"); totals rows follow it; credits are printed as negative numbers; rows run
   newest-first; a wallet lists failed attempts with their amounts. This file turns
   the raw cell grid from the spreadsheet reader into rows, and PROVES the column
   reading with the file's own arithmetic before anyone is shown a thing.

   Pure on purpose: no DOM, no network, no app globals. tools/statement-table.test.js
   drives it under Node against synthetic copies of three real layouts.

   The proof is about the COLUMNS, not about each row. A wrong reading (balance
   taken for amount, debit for credit, the wrong row order) reconciles roughly
   nothing; a right one reconciles nearly everything. Rows that break a proven
   reading are information: in a wallet they are payments funded from elsewhere. */

var STMT_PROOF_MIN = 0.9;          // share of consecutive rows that must reconcile
var STMT_STRICT_MIN = 0.6;         // ...of which this share must reconcile to the đồng
var STMT_TOL = 1;                  // đồng of slack for float noise

function stmtDeburr(s){
  return String(s == null ? '' : s).normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase();
}
/* A header or label cell, reduced to spaced plain words so vocabulary is matched
   as whole phrases: "Ghi nợ/Debit\n(VND)" -> " ghi no debit vnd ". */
function stmtWords(s){
  return ' ' + stmtDeburr(s).replace(/[^a-z0-9]+/g, ' ').trim() + ' ';
}
function _stmtHas(words, list){
  for (var i = 0; i < list.length; i++) { if (words.indexOf(' ' + list[i] + ' ') >= 0) return true; }
  return false;
}

/* "185000", "-2150000.0", ": 6,636,000 VND", "6.636.000", "1.519.522,00" -> number.
   Both separators present: the LAST one is the decimal point. One kind only: it is
   a thousands separator when it repeats or is followed by exactly three digits. */
function fhStmtNum(v){
  if (typeof v === 'number') return isFinite(v) ? v : null;
  var s = String(v == null ? '' : v).replace(/[^\d.,\-()]/g, '');
  if (!/\d/.test(s)) return null;
  var neg = /^\(.*\)$/.test(s) || s.indexOf('-') >= 0;
  s = s.replace(/[()\-]/g, '');
  var ld = s.lastIndexOf('.'), lc = s.lastIndexOf(',');
  if (ld >= 0 && lc >= 0) {
    var dec = ld > lc ? '.' : ',', tho = dec === '.' ? ',' : '.';
    s = s.split(tho).join('').replace(dec, '.');
  } else if (ld >= 0 || lc >= 0) {
    var ch = ld >= 0 ? '.' : ',', parts = s.split(ch);
    var thousands = parts.length > 2 || (parts.length === 2 && parts[1].length === 3 && parts[0].length <= 3 && parts[0] !== '0');
    s = thousands ? parts.join('') : parts.join('.');
  }
  var n = parseFloat(s);
  return isFinite(n) ? (neg ? -n : n) : null;
}

/* "dd/mm/yyyy", "dd/mm/yyyy HH:MM:SS", "dd-mm-yyyy HH:MM", ISO. Statements here are
   Vietnamese: day comes first. Returns { date, time, key } or null; `key` orders
   rows in time and is only ever compared, never shown. A row with no clock gets
   time '' -- the app never invents a time it was not given. */
function fhStmtDate(v){
  var s = String(v == null ? '' : v).trim(), m, d, mo, y, hh = '', mi = '', ss = '00';
  if ((m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?/.exec(s))) {
    y = +m[1]; mo = +m[2]; d = +m[3]; hh = m[4] || ''; mi = m[5] || ''; ss = m[6] || '00';
  } else if ((m = /^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})(?:[ T,]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/.exec(s))) {
    d = +m[1]; mo = +m[2]; y = +m[3]; hh = m[4] || ''; mi = m[5] || ''; ss = m[6] || '00';
  } else return null;
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || y < 2000 || y > 2100) return null;
  var p2 = function(n){ n = String(n); return n.length < 2 ? '0' + n : n; };
  var date = y + '-' + p2(mo) + '-' + p2(d);
  var time = hh !== '' ? p2(hh) + ':' + p2(mi) : '';
  return { date: date, time: time, key: date + ' ' + (time || '00:00') + ':' + p2(ss) };
}

/* Column roles, by header vocabulary. Order is priority: a cell takes the FIRST
   role it matches and a role takes the first cell that claims it, so the names
   ("Tên định danh tài khoản chuyển") are tried before the accounts they contain,
   the post date before the date, and the balance before the amount. */
var STMT_ROLES = [
  ['fromName',    ['ten dinh danh tai khoan chuyen', 'ten nguoi chuyen', 'sender name']],
  ['toName',      ['ten dinh danh tai khoan nhan', 'ten nguoi nhan', 'ten nguoi thu huong', 'beneficiary name', 'receiver name']],
  ['fromAcct',    ['tai khoan chuyen', 'tai khoan nguon', 'from account']],
  ['toAcct',      ['tai khoan nhan', 'tai khoan thu huong', 'to account', 'beneficiary account']],
  ['postDate',    ['ngay hach toan', 'ngay ghi so', 'post date', 'posting date', 'value date', 'ngay hieu luc']],
  ['date',        ['ngay giao dich', 'ngay gd', 'thoi gian giao dich', 'thoi gian', 'transaction date', 'trans date', 'ngay', 'date']],
  ['balance',     ['so du', 'balance', 'du no']],
  ['debit',       ['ghi no', 'debit', 'phat sinh no', 'rut ra', 'so tien ghi no', 'tien ra', 'withdrawal']],
  ['credit',      ['ghi co', 'credit', 'phat sinh co', 'gui vao', 'so tien ghi co', 'tien vao', 'deposit']],
  ['amount',      ['so tien', 'amount', 'gia tri']],
  ['ref',         ['ma giao dich', 'ma gd', 'so tham chieu', 'so but toan', 'so ct', 'so chung tu', 'reference', 'transaction id', 'ref no', 'ref']],
  ['mcc',         ['mcc']],
  ['status',      ['trang thai', 'status']],
  ['description', ['noi dung', 'dien giai', 'mo ta', 'loai giao dich', 'ghi chu', 'description', 'details', 'remark', 'narrative']]
];
function fhStmtRoles(headerCells){
  var roles = {};
  for (var c = 0; c < headerCells.length; c++) {
    var w = stmtWords(headerCells[c]);
    if (w.trim() === '') continue;
    for (var r = 0; r < STMT_ROLES.length; r++) {
      if (_stmtHas(w, STMT_ROLES[r][1])) { if (roles[STMT_ROLES[r][0]] === undefined) roles[STMT_ROLES[r][0]] = c; break; }
    }
  }
  return roles;
}
function _stmtRolesUsable(roles){
  return roles.date !== undefined && (roles.amount !== undefined || roles.debit !== undefined || roles.credit !== undefined);
}
/* A signature of the header row: the key a confirmed mapping is remembered under.
   Header labels only -- no value from any row. */
function fhStmtHeaderSig(headerCells){
  return (headerCells || []).map(function(h){ return stmtWords(h).trim(); }).join('|');
}

/* grid (array of rows, each an array of cell strings) -> the table.
   The header is the first row, within the first 80, whose cells name a date and an
   amount. Body rows are the rows under it whose date cell is a date; everything
   else (preamble, sub-headers, totals) is kept as `notes` for the summary reader. */
function fhStmtFindTable(grid, rolesOverride){
  var headerIdx = -1, roles = null;
  for (var i = 0; i < grid.length && i < 80; i++) {
    var r = fhStmtRoles(grid[i] || []);
    if (_stmtRolesUsable(r)) { headerIdx = i; roles = r; break; }
  }
  if (headerIdx < 0) return null;
  if (rolesOverride) roles = rolesOverride;
  var body = [], notes = [];
  for (var j = 0; j < grid.length; j++) {
    if (j === headerIdx) continue;
    var cells = grid[j] || [];
    if (j > headerIdx && fhStmtDate(cells[roles.date])) body.push({ i: j, cells: cells });
    else if (cells.some(function(x){ return String(x == null ? '' : x).trim() !== ''; })) notes.push(cells);
  }
  return { headerIdx: headerIdx, headers: (grid[headerIdx] || []).map(String), roles: roles, body: body, notes: notes };
}

/* The summary block: label cell, then the first cell to its right that reads as
   what the label promises. A row may hold two label/value pairs side by side. */
var STMT_LABELS = [
  ['opening',     ['so du dau ky', 'so du dau', 'opening balance']],
  ['closing',     ['so du cuoi ky', 'closing balance', 'ending balance']],
  ['prevDebt',    ['du no ky truoc', 'previous balance']],
  ['endDebt',     ['du no cuoi ky', 'end balance']],
  ['totalDebit',  ['phat sinh no', 'tong ghi no', 'total debit']],
  ['totalCredit', ['phat sinh co', 'tong ghi co', 'total credit']],
  ['holder',      ['chu tai khoan', 'account holder', 'ten chu the', 'cardholder']],
  ['period',      ['thoi gian sao ke', 'ky sao ke', 'period covered', 'statement period']],
  ['account',     ['so tai khoan', 'account number', 'so the chinh', 'primary card number', 'so vi']]
];
function fhStmtSummary(notes){
  var out = {};
  (notes || []).forEach(function(cells){
    for (var c = 0; c < cells.length; c++) {
      var w = stmtWords(cells[c]); if (w.trim() === '') continue;
      for (var k = 0; k < STMT_LABELS.length; k++) {
        var key = STMT_LABELS[k][0];
        if (out[key] !== undefined || !_stmtHas(w, STMT_LABELS[k][1])) continue;
        for (var v = c + 1; v < cells.length; v++) {
          var raw = String(cells[v] == null ? '' : cells[v]).replace(/^\s*:\s*/, '').trim();
          if (raw === '') continue;
          if (key === 'holder') out.holder = raw;
          else if (key === 'period') {
            var ds = raw.match(/\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{4}/g) || [];
            var a = fhStmtDate(ds[0]), b = fhStmtDate(ds[1]);
            if (a && b) out.period = { from: a.date, to: b.date };
          } else if (key === 'account') {
            /* Only the masked tail is ever kept. The full number stays in the file. */
            var dg = raw.replace(/\D/g, ''); if (dg.length >= 4) out.accountTail = dg.slice(-4);
          } else { var n = fhStmtNum(raw); if (n !== null) out[key] = Math.abs(n); }
          break;
        }
        break;
      }
    }
  });
  return out;
}

var STMT_FAILED = ['that bai', 'khong thanh cong', 'failed', 'fail', 'da huy', 'bi huy', 'cancelled', 'canceled', 'declined', 'tu choi', 'rejected'];

/* Body rows -> neutral row objects, in FILE order. `amt` is signed: money out is
   negative. Two-column files print a credit as a positive OR a negative number
   (one real card statement does the latter), so both columns are read by
   magnitude and the column decides the sign. */
function fhStmtRead(table){
  var R = table.roles, rows = [], failed = 0;
  var cell = function(cells, role){ return R[role] === undefined ? '' : String(cells[R[role]] == null ? '' : cells[R[role]]).trim(); };
  table.body.forEach(function(b){
    var when = fhStmtDate(b.cells[R.date]); if (!when) return;
    var amt = null;
    if (R.amount !== undefined) amt = fhStmtNum(b.cells[R.amount]);
    else {
      var db = Math.abs(fhStmtNum(b.cells[R.debit]) || 0), cr = Math.abs(fhStmtNum(b.cells[R.credit]) || 0);
      if (db || cr) amt = cr - db;
    }
    if (amt === null || amt === 0) return;
    if (R.status !== undefined && _stmtHas(stmtWords(b.cells[R.status]), STMT_FAILED)) { failed++; return; }
    var bal = R.balance !== undefined ? fhStmtNum(b.cells[R.balance]) : null;
    rows.push({
      i: b.i, date: when.date, time: when.time, key: when.key, amt: amt, bal: bal,
      description: cell(b.cells, 'description').replace(/\s+/g, ' '),
      ref: cell(b.cells, 'ref'), mcc: (cell(b.cells, 'mcc').match(/\d{4}/) || [''])[0],
      fromAcct: cell(b.cells, 'fromAcct'), fromName: cell(b.cells, 'fromName'),
      toAcct: cell(b.cells, 'toAcct'), toName: cell(b.cells, 'toName')
    });
  });
  return { rows: rows, failed: failed };
}

/* The proof. Returns { ok, how, ratio, order, totals, oldestFirst } and marks each
   row that broke a proven running balance: `unmoved` when the balance simply did
   not change (paid from somewhere else), `broken` otherwise. */
function fhStmtProve(rows, summary){
  summary = summary || {};
  var out = { ok: false, how: '', ratio: 0, order: 'file', totals: false, oldestFirst: rows.slice() };
  if (!rows.length) return out;
  var withBal = rows.filter(function(r){ return r.bal !== null; });
  /* `strict` = the balance moved by exactly the amount. `soft` also accepts a DEBIT
     after which the balance did not move at all: a wallet payment funded from a
     linked bank. That pattern is real (9 of 141 rows in one real statement), so it
     must not sink the proof -- but it only counts once most rows reconcile
     strictly, or a constant column mistaken for the balance would "prove" itself. */
  var score = function(list){
    var hit = 0, still = 0, n = 0;
    for (var i = 1; i < list.length; i++) {
      n++;
      if (Math.abs(list[i - 1].bal + list[i].amt - list[i].bal) <= STMT_TOL) hit++;
      else if (list[i].amt < 0 && Math.abs(list[i].bal - list[i - 1].bal) <= STMT_TOL) still++;
    }
    return { strict: n ? hit / n : 0, soft: n ? (hit + still) / n : 0 };
  };
  if (withBal.length >= 3) {
    var fwd = score(withBal), rev = score(withBal.slice().reverse());
    var best = rev.strict > fwd.strict ? rev : fwd;
    out.strict = best.strict;
    out.ratio = best.strict >= STMT_STRICT_MIN ? best.soft : best.strict;
    out.order = rev.strict > fwd.strict ? 'newest-first' : 'oldest-first';
  } else {
    /* No balance column: the dates say which way the file runs. */
    out.order = rows[0].key > rows[rows.length - 1].key ? 'newest-first' : 'oldest-first';
  }
  out.oldestFirst = out.order === 'newest-first' ? rows.slice().reverse() : rows.slice();

  var db = 0, cr = 0;
  rows.forEach(function(r){ if (r.amt < 0) db += -r.amt; else cr += r.amt; });
  var near = function(a, b){ return Math.abs(a - b) <= STMT_TOL; };
  var checks = [];
  if (summary.totalDebit !== undefined) checks.push(near(db, summary.totalDebit));
  if (summary.totalCredit !== undefined) checks.push(near(cr, summary.totalCredit));
  if (summary.opening !== undefined && summary.closing !== undefined) checks.push(near(summary.opening + cr - db, summary.closing));
  /* A card's balance is a debt: spending raises it, a payment lowers it. */
  if (summary.prevDebt !== undefined && summary.endDebt !== undefined) checks.push(near(summary.prevDebt + db - cr, summary.endDebt));
  out.totals = checks.length >= 2 && checks.every(Boolean);

  if (out.ratio >= STMT_PROOF_MIN) { out.ok = true; out.how = 'running'; }
  else if (out.totals) { out.ok = true; out.how = 'totals'; }

  if (out.how === 'running' || (out.ok && withBal.length >= 3)) {
    var seq = out.oldestFirst.filter(function(r){ return r.bal !== null; });
    for (var i = 1; i < seq.length; i++) {
      if (Math.abs(seq[i - 1].bal + seq[i].amt - seq[i].bal) <= STMT_TOL) continue;
      if (Math.abs(seq[i].bal - seq[i - 1].bal) <= STMT_TOL) seq[i].unmoved = true; else seq[i].broken = true;
    }
  }
  return out;
}

/* What a row is, from the statement's own words. These are HINTS for the review
   card's Kind control and description, and every one stays overridable there.
   Transfers need evidence (spec §11): a holder-name memo alone is never one. */
var STMT_BANK_WORDS = ['vietcombank', 'vcb', 'vib', 'techcombank', 'tcb', 'mb bank', 'mbbank', 'acb', 'bidv', 'vietinbank', 'vpbank', 'tpbank', 'sacombank', 'hdbank', 'ocb', 'shb', 'msb', 'agribank', 'ngan hang', 'bank'];
function _stmtIsPersonAcct(a){ a = String(a || '').trim(); return /^\*+\d{2,4}$/.test(a) || /^0\d{8,10}$/.test(a); }
function fhStmtClassify(row, ctx){
  ctx = ctx || {};
  var w = stmtWords(row.description), out = { flow: '', counterparty: '', person: false, funding: '', holderMemo: false, memo: row.description };
  var isOut = row.amt < 0;
  out.counterparty = isOut ? (row.toName || '') : (row.fromName || '');
  out.person = _stmtIsPersonAcct(isOut ? row.toAcct : row.fromAcct);
  if (isOut && row.fromName) out.funding = row.fromName;

  if (_stmtHas(w, ['thanh toan sao ke the', 'thanh toan the tin dung', 'tra no the', 'thanh toan du no the', 'credit card payment'])) out.flow = 'cardpay';
  else if (!isOut && (_stmtHas(w, ['hoan tien', 'refund', 'thu hoi tien hoan']) || /^ hoan /.test(w))) out.flow = 'refund';
  else if (!isOut && _stmtHas(w, ['luong', 'salary', 'nhan luong'])) out.flow = 'salary';
  else if (_stmtHas(w, ['nap tien vao vi', 'nap tien vi', 'nap vi', 'top up wallet', 'wallet top up']) ||
           (!isOut && row.fromName && _stmtHas(stmtWords(row.fromName), STMT_BANK_WORDS) && _stmtHas(w, ['nap tien']))) out.flow = 'topup';
  else if (isOut && (_stmtHas(w, ['phi']) || /^ phi /.test(w)) && !_stmtHas(w, ['hoc phi'])) out.flow = 'fee';

  /* "<HOLDER> chuyen tien den <RECIPIENT> - <account>": the bank's auto-fill for an
     outgoing transfer. It names who sent and who received, never what for -- so the
     purpose is left blank for the person to fill, exactly as a p2p email is. Only
     when the recipient IS the holder does the memo say "between my own accounts". */
  var tm = /^(.+?) chuyen (?:tien|khoan)(?: (?:den|toi|cho|sang) (.+))?$/.exec(w.trim());
  if (tm && ctx.holder) {
    var h = stmtWords(ctx.holder).trim(), sender = tm[1].trim();
    var recip = (tm[2] || '').replace(/(?: \d+)+$/, '').trim();
    if (h && sender === h) {
      out.holderMemo = true; out.memo = '';
      if (recip) { out.counterparty = recip.toUpperCase(); out.person = true; }
      if (recip && recip.length >= 6 && recip === h) { out.selfTransfer = true; out.person = false; }
    }
  }
  /* A wallet debit after which the wallet balance did not move was paid from a
     linked bank: it belongs to that bank's account, and the bank has its own row. */
  out.fundedElsewhere = !!(isOut && row.unmoved);
  out.fundingIsBank = !!(out.funding && _stmtHas(stmtWords(out.funding), STMT_BANK_WORDS));
  return out;
}

/* One call for the whole file. `rolesOverride` is a remembered or hand-confirmed
   mapping. Never throws on a strange file: `table: null` means "no table found". */
function fhStmtParse(grid, rolesOverride){
  var table = fhStmtFindTable(grid || [], rolesOverride);
  if (!table) return { table: null, rows: [], failed: 0, summary: {}, proof: { ok: false, how: '', ratio: 0 } };
  var summary = fhStmtSummary(table.notes);
  var read = fhStmtRead(table);
  var proof = fhStmtProve(read.rows, summary);
  var rows = proof.oldestFirst.map(function(r){
    var c = fhStmtClassify(r, { holder: summary.holder });
    return Object.assign({}, r, { cls: c });
  });
  return { table: table, sig: fhStmtHeaderSig(table.headers), rows: rows, failed: read.failed, summary: summary, proof: proof };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { fhStmtNum: fhStmtNum, fhStmtDate: fhStmtDate, fhStmtRoles: fhStmtRoles, fhStmtFindTable: fhStmtFindTable,
    fhStmtSummary: fhStmtSummary, fhStmtRead: fhStmtRead, fhStmtProve: fhStmtProve, fhStmtClassify: fhStmtClassify,
    fhStmtParse: fhStmtParse, fhStmtHeaderSig: fhStmtHeaderSig };
}