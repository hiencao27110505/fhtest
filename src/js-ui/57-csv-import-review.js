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
  var m;
  if (format === 'iso') {
    m = v.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (m) return new Date(+m[1], +m[2] - 1, +m[3]);
  }
  if (format === 'month_name') {
    m = v.match(/^([A-Za-z]{3})[a-z]*\s+(\d{1,2})\s+(\d{4})$/);
    if (m) { var mi = MONTH_ABBR[m[1].toLowerCase()]; if (mi !== undefined) return new Date(+m[3], mi, +m[2]); }
  }
  var mmFirst = convention === 'mm/dd/yyyy';
  if (format === 'slash_4' || format === 'dash_4') {
    m = v.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/);
    if (m) { var a=+m[1], b=+m[2], y=+m[3]; return mmFirst ? new Date(y,a-1,b) : new Date(y,b-1,a); }
  }
  if (format === 'slash_2' || format === 'dash_2') {
    m = v.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{2})$/);
    if (m) { var a2=+m[1], b2=+m[2], y2=2000+ +m[3]; return mmFirst ? new Date(y2,a2-1,b2) : new Date(y2,b2-1,a2); }
  }
  if (format === 'slash_noyear' || format === 'dash_noyear') {
    m = v.match(/^(\d{1,2})[\/-](\d{1,2})$/);
    if (m) { var a3=+m[1], b3=+m[2], y3=(new Date()).getFullYear(); return mmFirst ? new Date(y3,a3-1,b3) : new Date(y3,b3-1,a3); }
  }
  return null;
}

// Fuzzy-match a CSV category string against the family's real category names
// (window.catOrder). Exact-after-normalization only -- a wrong guess is worse
// than no guess, since a mismatched category is harder for the reviewer to
// notice than an empty one.
function matchCategoryName(guess) {
  var g = deburr((guess || '').trim().toLowerCase());
  if (!g) return null;
  var order = window.catOrder || [];
  for (var i = 0; i < order.length; i++) {
    if (deburr(order[i].toLowerCase()) === g) return order[i];
  }
  return null;
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
