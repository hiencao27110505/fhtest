/* ---- CSV import: row-level parsing, grouping, dedup, promotion -------------
   Turns a resolved column mapping (45-csv-import.js) + every real row into
   candidate transactions, buckets them (ready / needs-category / possible
   duplicate / deferred), and promotes approved ones by feeding the existing
   bulk-expense-logging machinery (bulkRows + submitBulk()) rather than a
   bespoke insert -- inherits fhField()/_fhWriteLocked() encryption-
   correctness for free, per CSV-IMPORT-ENCRYPTION.md.

   Scope for this pass: EXPENSE rows only. transactions has no direction
   column -- income lives in a separate `incomes` table this doesn't write
   to. A row is only treated as an expense when every amount in the source
   column was consistently unsigned or consistently negative; a column that
   mixes signs (a real income-and-expense statement) gets every row deferred
   rather than guessed at, since mis-filing income as an expense corrupts
   the ledger, not just mis-categorizes it. */

var MONTH_ABBR = { jan:0, feb:1, mar:2, apr:3, may:4, jun:5, jul:6, aug:7, sep:8, oct:9, nov:10, dec:11 };

function parseCsvDateValue(raw, format, convention) {
  var v = (raw || '').trim();
  if (!v) return null;
  var mmFirst = convention === 'mm/dd/yyyy';
  var m;

  // Strip a trailing time — "2026-08-01 14:30:00" is still 1 Aug.
  v = v.replace(/[ T]\d{1,2}:\d{2}(:\d{2})?(\s*[AaPp][Mm])?(\s*Z)?.*$/, '').trim();

  if (format === 'iso' || format === 'iso_slash') {
    m = v.match(/^(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})$/);
    if (m) return _csvDate(+m[1], +m[2], +m[3]);
  }
  if (format === 'compact') {
    m = v.match(/^(\d{4})(\d{2})(\d{2})$/);
    if (m) return _csvDate(+m[1], +m[2], +m[3]);
  }
  if (format === 'd_mon_y') {
    m = v.match(/^(\d{1,2})[ -]([A-Za-z]{3,})[ -](\d{4})$/);
    if (m) { var mi1 = _csvMonth(m[2]); if (mi1 != null) return _csvDate(+m[3], mi1 + 1, +m[1]); }
  }
  if (format === 'mon_d_y') {
    m = v.match(/^([A-Za-z]{3,})\s+(\d{1,2}),?\s+(\d{4})$/);
    if (m) { var mi2 = _csvMonth(m[1]); if (mi2 != null) return _csvDate(+m[3], mi2 + 1, +m[2]); }
  }
  if (format === 'vi_thg') {
    m = v.match(/^(\d{1,2})\s*(?:thg|thang)\s*(\d{1,2}),?\s*(\d{4})$/i);
    if (m) return _csvDate(+m[3], +m[2], +m[1]);
  }
  if (format === 'dmy_4' || format === 'dmy_2') {
    m = v.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})$/);
    if (m) {
      var a = +m[1], b = +m[2], y = +m[3];
      if (y < 100) y += 2000;
      // A value over 12 can only be the day, whichever order the file uses --
      // that beats the file-level convention, which is only a best guess.
      if (a > 12) return _csvDate(y, b, a);
      if (b > 12) return _csvDate(y, a, b);
      return mmFirst ? _csvDate(y, a, b) : _csvDate(y, b, a);
    }
  }
  if (format === 'dm_noyear') {
    m = v.match(/^(\d{1,2})[\/.-](\d{1,2})$/);
    if (m) {
      var a2 = +m[1], b2 = +m[2], y2 = (new Date()).getFullYear();
      if (a2 > 12) return _csvDate(y2, b2, a2);
      if (b2 > 12) return _csvDate(y2, a2, b2);
      return mmFirst ? _csvDate(y2, a2, b2) : _csvDate(y2, b2, a2);
    }
  }
  return null;
}

// Rejects impossible dates (13th month, 31 Feb) instead of letting Date roll
// them into the next month, which would silently file a row on the wrong day.
function _csvDate(y, mo, d) {
  if (!(mo >= 1 && mo <= 12) || !(d >= 1 && d <= 31)) return null;
  var dt = new Date(y, mo - 1, d);
  return (dt.getFullYear() === y && dt.getMonth() === mo - 1 && dt.getDate() === d) ? dt : null;
}

function _csvMonth(name) {
  var n = deburr(String(name || '').toLowerCase()).slice(0, 3);
  var i = MONTH_ABBR[n];
  return i === undefined ? null : i;
}

var csvFuzzyCats = true;   // false while an undo is in effect
var csvCatMerges = {};     // file name (normalized) -> the family category it merged into
var csvCatAmbiguous = {};  // file names that matched 2+ existing categories

/* Match a file's category name against the family's own categories.

   Exact-after-normalization first ("NHA CUA" == "Nhà cửa"). Then the case a
   real ledger hits constantly: people abbreviate. A file saying "Ăn" means
   the family's existing "Ăn uống" -- inventing a second, near-duplicate
   category would quietly split their history in two. So a name that is a
   whole-word prefix of (or contains) exactly ONE existing category merges
   into it, and the merge is reported so it can be reversed.

   "Exactly one" is the safety rule: "Ăn" against BOTH "Ăn uống" and "Ăn
   ngoài" is genuinely ambiguous, and guessing there would file real money
   under the wrong heading -- those fall through to the review for a human. */
function matchCategoryName(guess) {
  var g = deburr((guess || '').trim().toLowerCase());
  if (!g) return null;
  var order = window.catOrder || [], i;
  for (i = 0; i < order.length; i++) {
    if (deburr(order[i].toLowerCase()) === g) return order[i];
  }
  if (!csvFuzzyCats) return null;
  var hits = [];
  for (i = 0; i < order.length; i++) {
    var n = deburr(order[i].toLowerCase());
    if (_csvWordIn(g, n) || _csvWordIn(n, g)) hits.push(order[i]);
  }
  if (hits.length === 1) { csvCatMerges[String(guess).trim()] = hits[0]; return hits[0]; }
  // 2+ hits: "Ăn" could be "Ăn uống" OR "Ăn ngoài". Creating an "Ăn" category
  // would be as wrong as picking one at random, so mark it and let the review
  // ask -- csvUnknownFileCategories skips these when auto-creating.
  if (hits.length > 1) csvCatAmbiguous[g] = true;
  return null;
}

// whole-word containment, so "an" matches "an uong" but not "banh"
function _csvWordIn(needle, hay) {
  return new RegExp('(^|\\s)' + String(needle).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '($|\\s)').test(hay);
}

/* ---- bank-statement merchant recognition ---------------------------------
   guessCat() reads human notes ("đi chợ", "tiền điện"). A bank export doesn't
   write like that: it writes "CUSTOMER MBCT NGUYEN THU TRANG chuyen tien" or
   "CUSTOMER RetailMastercard.PBA-765078" -- protocol noise wrapped around a
   merchant name that may not even be there. So before giving up and filing a
   row under the catch-all, strip the bank's boilerplate and look for a
   merchant SUBSTRING (not whole-word: "momo" hides inside "MBCTMoMo").

   The concept it returns is fed through the app's own familyCatForConcept(),
   so it always lands on a category the family actually has, under their name
   for it -- never a category we invented. */
var CSV_BANK_NOISE = /\b(customer|khach hang|mbct|mbvcb|vcb|tcb|acb|bidv|vietinbank|agribank|napas|ib|ibft|ift|ft|trace|ref|pba|pos|atm|retailmastercard|mastercard|visa|jcb|napas247|ck|tk|stk|so tk|noi dung|nd|gd|tt)\b|[0-9]{4,}|[-_.]{2,}/g;

var CSV_MERCHANTS = [
  ['Transport', ['grab','gojek','be group','beamin','baemin','xanh sm','vinasun','mai linh','uber','vato','petrolimex','pvoil','xang dau','vetc','epass','parking']],
  ['Dining',    ['highlands','phuc long','trung nguyen','katinat','the coffee house','tch','starbucks','passio','cong caphe','coffee','cafe','ca phe','kfc','lotteria','jollibee','mcdonald','burger','pizza','domino','texas chicken','popeyes','sushi','bbq','buffet','nha hang','restaurant','shopeefood','grabfood','now.vn','beefood','bun','pho ','com tam','tra sua','gong cha','tocotoco','phuc tea','mixue']],
  ['Groceries', ['bach hoa xanh','bhx','winmart','vinmart','coopmart','co.opmart','co opmart','big c','go mall','emart','aeon','mega market','lotte mart','satra','circle k','gs25','familymart','ministop','7-eleven','cheers','sieu thi','farmers market','annam']],
  ['Housing',   ['evn','dien luc','sawaco','cap nuoc','fpt telecom','viettel','vnpt','vinaphone','mobifone','internet','tien dien','tien nuoc','chung cu','ban quan ly','quan ly toa nha','pccc','gas','pgas','petrolgas']],
  ['Fun',       ['cgv','lotte cinema','bhd star','galaxy cinema','beta cinema','netflix','spotify','youtube premium','fpt play','vieon','k+','steam','playstation','nintendo','gym','california fitness','citigym','yoga','kara','massage','spa','du lich','booking.com','agoda','traveloka','vietjet','vietnam airlines','bamboo airways','vexere']],
  ['Shopping',  ['shopee','lazada','tiki','sendo','tiktok shop','amazon','apple.com','itunes','icloud','google','play store','uniqlo','zara','h&m','muji','decathlon','nguyen kim','dien may xanh','the gioi di dong','tgdd','fpt shop','cellphones']],
  ['Others',    ['pharmacity','long chau','an khang','guardian','watsons','nha thuoc','benh vien','phong kham','vinmec','medlatec','hoan my','bao hiem','insurance','hoc phi','tuition','truong']],
];

function csvMerchantConcept(desc) {
  var t = ' ' + deburr(String(desc || '').toLowerCase()).replace(CSV_BANK_NOISE, ' ').replace(/\s+/g, ' ') + ' ';
  if (t.trim().length < 2) return '';
  var i, j;
  for (i = 0; i < CSV_MERCHANTS.length; i++) {
    var concept = CSV_MERCHANTS[i][0], toks = CSV_MERCHANTS[i][1];
    for (j = 0; j < toks.length; j++) {
      if (t.indexOf(deburr(toks[j])) >= 0) return concept;
    }
  }
  /* Then the composer's OWN dictionary (KW_SHARED / KW_VI / KW_EN, the same
     words bulk logging guesses from) applied as substrings. guessCat already
     tried them whole-word and failed, because a bank memo glues tokens
     together ("MBCTMoMo", "GRABVN"). One dictionary, two matching strictnesses
     -- a word added there improves both surfaces. */
  var dicts = [];
  if (typeof KW_SHARED === 'object') dicts.push(KW_SHARED);
  if (typeof KW_VI === 'object') dicts.push(KW_VI);
  if (typeof KW_EN === 'object') dicts.push(KW_EN);
  for (i = 0; i < dicts.length; i++) {
    for (var cpt in dicts[i]) {
      var list = dicts[i][cpt];
      for (j = 0; j < list.length; j++) {
        var w = deburr(String(list[j]).toLowerCase());
        if (w.length >= 3 && t.indexOf(w) >= 0) return cpt;   // >=3 chars: "an"/"xe" would match anything
      }
    }
  }
  return '';
}

/* The family's own history is the strongest category signal there is: if a
   description was categorized by a human before, a new row with the same
   description almost certainly belongs there too. window.txns is newest-first
   and already client-side-decrypted, so the first hit per description is the
   most recent human choice. */
function csvHistoryCategoryMap() {
  var map = {};
  (window.txns || []).forEach(function(t) {
    if (!t.note || !catValid(t.cat)) return;
    var k = normDescForDedup(t.note);
    if (!map[k]) map[k] = t.cat;
  });
  return map;
}

/* One candidate per data row. Never throws on a bad row -- flags it and
   moves on, so one malformed line can't abort the whole import.

   Category resolution tries three signals in confidence order: the file's
   own category column (exact after normalization), then the family's history
   (same description, previously categorized by a human), then guessCat()'s
   keyword matching (the same guesser bulk logging uses). All three only ever
   produce categories the family actually has, and a guess is never silently
   final -- it lands as a visible, tappable-to-change default on the review
   screen, which is the human gate before anything writes. */
function buildCsvCandidates(parsed, result) {
  var mapping = (result.llm && result.llm.column_mapping) || Object.keys(result.columnMap).map(function(i){
    return { column_index:+i, field:result.columnMap[i].field, confidence:result.columnMap[i].confidence };
  });
  // First-wins: a file can have two columns mapping to the same field (e.g.
  // "description" AND "note" are both description aliases) -- the earlier
  // column is the primary one; last-wins silently swapped every description
  // for the note text.
  var colFor = {};
  mapping.forEach(function(m){ if(colFor[m.field] === undefined) colFor[m.field] = m.column_index; });
  var convention = result.llm && result.llm.date_convention;
  var historyMap = csvHistoryCategoryMap();

  return parsed.rows.map(function(row, i) {
    var flags = [];
    var dateRaw = colFor.occurred_at !== undefined ? row[colFor.occurred_at] : '';
    var amtRaw = colFor.amount !== undefined ? row[colFor.amount] : '';
    var desc = colFor.description !== undefined ? (row[colFor.description] || '').trim() : '';
    var catGuess = colFor.category !== undefined ? (row[colFor.category] || '').trim() : '';

    var dclass = classifyDate(dateRaw);
    var date = dclass.status === 'matched' ? parseCsvDateValue(dateRaw, dclass.format, convention) : null;
    if (!date) flags.push('date_missing');

    var aclass = classifyAmount(amtRaw);
    var amount = (aclass.status === 'ok') ? Math.abs(aclass.value) : null;
    if (amount === null) flags.push('amount_missing');

    if (!desc) flags.push('description_missing');

    var catName = matchCategoryName(catGuess);
    var catSource = catName ? 'file' : null;
    if (!catName && desc) {
      var h = historyMap[normDescForDedup(desc)];
      if (h) { catName = h; catSource = 'history'; }
    }
    if (!catName && desc && typeof guessCat === 'function') {
      var g = guessCat(desc);
      if (g && catValid(g)) { catName = g; catSource = 'keyword'; }
    }
    /* Least steps wins: if the file's own label, the family's history and the
       keyword guess all come up empty, file it under the catch-all rather
       than making someone tap a category for every row. It's disclosed in the
       summary and one tap on the row changes it -- an editable default beats
       a blocking question. */
    // bank-memo merchant recognition, before giving up on the row
    if (!catName && desc && typeof familyCatForConcept === 'function') {
      var mc = csvMerchantConcept(desc);
      if (mc) { var fc = familyCatForConcept(mc); if (fc && catValid(fc)) { catName = fc; catSource = 'merchant'; } }
    }
    if (!catName && catValid(CAT_FALLBACK)) { catName = CAT_FALLBACK; catSource = 'fallback'; }
    if (!catName) flags.push('needs_category');

    return {
      rowIndex: i, raw: row, flags: flags,
      date: date, dateDisplay: date ? (date.getFullYear()+'-'+String(date.getMonth()+1).padStart(2,'0')+'-'+String(date.getDate()).padStart(2,'0')) : '',
      amount: amount, negative: aclass.status === 'ok' && String(amtRaw).trim().indexOf('-') === 0,
      description: desc || catGuess || L('(không có mô tả)','(no description)'),
      categoryGuess: catGuess, categoryName: catName, catSource: catSource,
    };
  });
}

// A column that mixes signed and unsigned amounts is a real bank statement
// (income + expense together) -- this pass doesn't distinguish them, so
// every row gets deferred rather than silently filed as an expense.
function csvColumnHasMixedSigns(candidates) {
  var seenNeg = false, seenPos = false;
  candidates.forEach(function(c){ if (c.amount === null) return; if (c.negative) seenNeg = true; else seenPos = true; });
  return seenNeg && seenPos;
}

function normDescForDedup(s) { return deburr((s||'').trim().toLowerCase()).replace(/\s+/g,' '); }

/* Buckets: ready / needsCategory (grouped by merchant) / possibleDuplicate /
   deferred. Self-dedup and cross-source dedup both happen here, before
   bucketing, so a row can't land in "ready" while also being a duplicate. */
function bucketCsvCandidates(candidates, mixedSigns) {
  var seen = {}; // normDesc+amount -> first candidate seen
  var existingTxns = window.txns || [];

  var ready = [], needsCategoryGroups = {}, possibleDuplicate = [], deferred = [];

  candidates.forEach(function(c) {
    if (mixedSigns || c.flags.indexOf('date_missing') >= 0 || c.flags.indexOf('amount_missing') >= 0) {
      deferred.push(c); return;
    }

    var key = normDescForDedup(c.description) + '|' + c.amount;
    if (seen[key]) { c.duplicateOfBatch = true; possibleDuplicate.push(c); return; }
    seen[key] = c;

    var crossMatch = existingTxns.find(function(t) {
      if (!t._d || !c.date) return false;
      var daysApart = Math.abs(t._d.getTime() - c.date.getTime()) / 86400000;
      return daysApart <= 3 && Math.abs(Number(t.amt) - c.amount) < 1;
    });
    if (crossMatch) { c.duplicateOfExisting = crossMatch; possibleDuplicate.push(c); return; }

    if (!c.categoryName) {
      var gkey = normDescForDedup(c.description);
      (needsCategoryGroups[gkey] = needsCategoryGroups[gkey] || []).push(c);
      return;
    }

    ready.push(c);
  });

  return { ready: ready, needsCategoryGroups: needsCategoryGroups, possibleDuplicate: possibleDuplicate, deferred: deferred };
}
