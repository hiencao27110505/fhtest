#!/usr/bin/env node
/* Regression guard: rows promoted from a review screen must reach the ledger
   exactly as reviewed.  `node tools/bulk-promote.test.js`

   The bug this exists for: csvPromote() builds bulkRows in code and calls
   submitBulk(), which opened with commitActiveRow() — the parse step meant for
   whatever a human is still typing in #ex-note. Run over a prepared row it
   corrupts bulkRows[bulkActive] two independent ways:

     • a description containing a comma ("CHUYEN TIEN, CAM ON") is read as two
       comma-separated entries and split into extra rows with no amount;
     • the reviewed category is re-guessed from the note (prepared rows never
       set _catTouched) and wiped to '' when the keyword dictionary doesn't
       recognise the bank's wording.

   Either one makes submitBulk() abort with "Hãy hoàn tất các khoản được tô đỏ"
   on a screen where every field was visibly filled — and only ever on the first
   card, since commitActiveRow touches bulkActive alone. Cost a debugging session
   in the bank-email review; the same code path is CSV import's.

   The functions under test are extracted from src/js-ui by name and run for
   real — no re-implementation to drift from the shipped behaviour. */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const CAPTURE = fs.readFileSync(path.join(ROOT, 'src/js-ui/50-sheets-expense-capture.js'), 'utf8');
const CSVUI = fs.readFileSync(path.join(ROOT, 'src/js-ui/56-csv-import-ui.js'), 'utf8');

let failed = 0;
function ok(cond, what) {
  console.log((cond ? '  ok   ' : '  FAIL ') + what);
  if (!cond) failed++;
}

/* Pull a top-level `function NAME(…){…}` / `var NAME={…}` out of the real file
   by brace matching. */
function grab(src, header) {
  const at = src.indexOf(header);
  if (at < 0) throw new Error('not found in source: ' + header);
  let i = src.indexOf('{', at), depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (!depth) break; }
  }
  return src.slice(at, i + 1) + (header.startsWith('var') ? ';' : '');
}

const REAL = [
  'function deburr(', 'var KW_SHARED=', 'var KW_VI=', 'var KW_EN=', 'var CONCEPT_MATCH=',
  'function _scanConcepts(', 'function conceptFromNote(', 'function familyCatForConcept(',
  'function guessCat(', 'function _cleanNum(', 'function matchAmount(', 'function parseBulkLine(',
  'function parseEntries(', 'function applyParsed(', 'function rowFromParsed(', 'function blankRow(',
  'function catValid(', 'function safeDefaultCat(', 'function flushActiveRow(',
  'function commitActiveRow(', 'function pad2(', 'function isoDate(',
].map((h) => grab(CAPTURE, h)).join('\n') + '\n' + CAPTURE.match(/var CONCEPT_ORDER=\[[^\]]*\];/)[0];

const FAMILY_CATS = ['Ăn uống', 'Đi chợ', 'Nhà cửa', 'Đi lại', 'Khác'];

/* A family device mid-review: loadRow() has just pushed row 0 into the #ex-*
   fields and selected its category chip, which is what commitActiveRow reads. */
function sandbox(row) {
  const fields = { 'ex-note': row.note, 'ex-amt': row.amt, 'ex-date': row.date };
  const ctx = {
    console, LANG: 'vi', CUR: 'VND', TODAY: new Date(2026, 7, 13),
    catOrder: FAMILY_CATS.slice(),
    catStyle: { 'Ăn uống': ['🍜'], 'Đi chợ': ['🛒'], 'Nhà cửa': ['🏠'], 'Đi lại': ['🚗'], 'Khác': ['🗂️'] },
    editingTx: null, lastWho: 'Bố', lastCat: '', bulkRows: null, bulkActive: 0,
    isVi: () => true,
    curMult: () => 1000,
    parseAmt: (s) => parseInt(String(s || '').replace(/[^0-9]/g, '')) || 0,
    document: { getElementById: (id) => (id in fields ? { value: fields[id] } : null), querySelector: () => null },
    chosen: (g) => (g === 'ex-cat' ? row.cat : row.who),
    setDateFloor: () => {}, isoMonthStart: () => '2024-01-01',
  };
  ctx.parseAmtBase = (s) => Math.round(ctx.parseAmt(s) / ctx.curMult());
  vm.createContext(ctx);
  vm.runInContext(REAL, ctx);
  return ctx;
}

/* Rows shaped exactly as csvPromote() builds them: every field filled, every
   category one the family actually has. First note carries a comma, second is
   comma-free wording no keyword dictionary knows — the two real-world cases. */
const REVIEWED = [
  { note: 'CHUYEN TIEN, CAM ON', amt: '250000', cat: 'Ăn uống', who: 'Bố', date: '2026-08-11', _invalid: false },
  { note: 'REVI PHU MY HUNG TOWER', amt: '1200000', cat: 'Nhà cửa', who: 'Bố', date: '2026-08-10', _invalid: false },
  { note: 'VNPAY THANH TOAN HOA DON', amt: '430000', cat: 'Khác', who: 'Bố', date: '2026-08-09', _invalid: false },
];

/* submitBulk()'s own validity predicate, verbatim. */
function redCount(ctx) {
  return ctx.bulkRows.filter((r) => !(ctx.parseAmtBase(r.amt || '') > 0 && ctx.catValid(r.cat))).length;
}

function promote(rows, { commit }) {
  const copy = rows.map((r) => Object.assign({}, r));   // commitActiveRow mutates in place
  const ctx = sandbox(copy[0]);
  ctx.bulkRows = copy; ctx.bulkActive = 0;
  if (commit) vm.runInContext('commitActiveRow()', ctx);
  return { rows: ctx.bulkRows, red: redCount(ctx) };
}

console.log('bulk promote — prepared rows survive submitBulk()');

// The fix: prepared rows skip the interactive commit, so they save as reviewed.
const after = promote(REVIEWED, { commit: false });
ok(after.red === 0, 'reviewed rows are all valid → submitBulk() saves');
ok(after.rows.length === REVIEWED.length, 'no row is split or invented (' + after.rows.length + ' in, ' + after.rows.length + ' out)');
ok(after.rows[0].cat === 'Ăn uống', 'the reviewed category survives');
ok(after.rows[0].note === 'CHUYEN TIEN, CAM ON', 'a description with a comma stays one description');

// The two failure modes, kept executable so the reason for the flag is provable
// and nobody re-derives it from the toast text.
const commaSplit = promote(REVIEWED, { commit: true });
ok(commaSplit.red > 0 && commaSplit.rows.length > REVIEWED.length,
   'committing a prepared row still splits on its comma (why {prepared:true} exists)');

const catWipe = promote(REVIEWED.slice(1), { commit: true });
ok(catWipe.red > 0 && catWipe.rows[0].cat === '',
   'committing an untouched-category row still wipes it (the second cause)');

const catWipeGuarded = promote(REVIEWED.slice(1).map((r) => Object.assign({}, r, { _catTouched: true })), { commit: true });
ok(catWipeGuarded.red === 0, '_catTouched suppresses the re-guess');

// Source-level: the call sites that make the above true.
ok(/submitBulk\(\s*\{\s*prepared:\s*true\s*\}\s*\)/.test(CSVUI), 'csvPromote() calls submitBulk({prepared:true})');
ok(/_catTouched:\s*true/.test(CSVUI), 'csvPromote() marks promoted rows _catTouched');
ok(/if\(!\(opts && opts\.prepared\)\) commitActiveRow\(\)/.test(CAPTURE), 'submitBulk() honours opts.prepared');

console.log(failed ? '\n' + failed + ' failed' : '\nall passed');
process.exit(failed ? 1 : 0);
