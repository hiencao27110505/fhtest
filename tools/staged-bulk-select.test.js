#!/usr/bin/env node
/* Acting on the whole selection in the bank-email review queue — through the
   tools header (#txh: rooms, staged picks, one Áp dụng).
 * `node tools/staged-bulk-select.test.js`
 *
 * Every staged row arrives TICKED, because the common case is "import the lot".
 * That default is what makes these operations sharp: a bulk action reached
 * without deselecting anything acts on the entire overnight backfill. So the
 * properties worth pinning are all about the boundary of the selection.
 *
 *   • deselect-all really clears it, and select-all really restores it
 *   • category and destination touch the SELECTED rows and nothing else
 *   • destination does NOT move the remembered default — bulk-marking three rows
 *     private must not redirect the thirty-seven nobody selected
 *   • the bulk ✕ arms first, and when it fires it removes exactly the selection
 *     and retires it in ONE call, not one per row
 *   • any other tap disarms it, including a tick
 *
 * The real functions are extracted from source by name.
 */
// NOT 'use strict': eval'd declarations must land in this scope.
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'js-ui', '56-csv-import-ui.js'), 'utf8');

const start = src.indexOf('function csvStagedSelected()');
const end = src.indexOf('function csvGroupPick');
if (start < 0 || end < 0) {
  console.error('staged selection block not found — renamed?');
  process.exit(1);
}

let pass = 0, fail = 0;
const t = (n, ok, d) => { console.log((ok ? '  PASS  ' : '  FAIL  ') + n + (!ok && d ? '  -> ' + d : '')); ok ? pass++ : fail++; };

// Stubs for everything the block touches.
var csvReview, csvStagedMode, csvExpand, renders, dropped, toasts, learned, scopeSaves, personalReady;
function renderCsvReview(){ renders++; }
function fmt(n){ return String(n); }
var LANG = 'vi';
function csvAllCats2(){}
function csvBaseAmt(n){ return Number(n) || 0; }
// the header syncs against a DOM; in this harness there is none, and that is
// fine — csvTxrHeadSync bails on the missing #txh element
global.document = { getElementById: function(){ return { children: [], innerHTML: '', classList: { toggle: function(){} } }; },
                    querySelector: function(){ return null; },
                    querySelectorAll: function(){ return []; } };
function csvFlushExpand(){}
function toast(m){ toasts.push(m); }
function esc(s){ return String(s == null ? '' : s); }
function escAttr(s){ return String(s == null ? '' : s); }
function L(vi, en){ return vi; }
function csvAllCats(){ return ['Ăn uống', 'Đi lại']; }
function csvScopeReady(){ return personalReady; }
function csvSetScope(v){ scopeSaves.push(v); return true; }
function csvLearnFrom(c){ learned.push(c); }
global.window = {
  catStyle: { 'Ăn uống': ['🍜'], 'Đi lại': ['🚌'] },
  fhStagedDropMany: function (list) { dropped.push(list); },
  fhStagedDropOne: function (c) { dropped.push([c]); }
};

eval(src.slice(start, end));

function reset(){
  csvReview = { ready: [ { rowIndex:0, id:'a', amount:1 }, { rowIndex:1, id:'b', amount:2 },
                         { rowIndex:2, id:'c', amount:3 } ] };
  csvStagedMode = true; csvExpand = null; csvArmedRemove = null;
  csvBulkReset();
  renders = 0; dropped = []; toasts = []; learned = []; scopeSaves = []; personalReady = true;
}
const ids = () => csvReview.ready.map(r => r.id).join(',');
const picked = () => csvStagedSelected().map(r => r.id).join(',');

console.log('\n-- the default really is "everything selected" --');
reset();
t('all three arrive selected', picked() === 'a,b,c');

console.log('\n-- deselect all, then select all --');
csvStagedSelectAll(false);
t('nothing is selected', picked() === '');
t('but no row was removed', ids() === 'a,b,c');
t('every row carries the skip flag', csvReview.ready.every(c => c._skipImport === true));
csvStagedSelectAll(true);
t('select-all brings them all back', picked() === 'a,b,c');

console.log('\n-- category applies to the selection only --');
reset();
csvStagedSelectAll(false);
csvStagedToggle(1);                       // just row b
t('only b is selected', picked() === 'b');
csvBulkCat('Ăn uống');
t('b took the category', csvReview.ready[1].categoryName === 'Ăn uống');
t('a was left alone', csvReview.ready[0].categoryName === undefined);
t('c was left alone', csvReview.ready[2].categoryName === undefined);
t('it counts as an explicit human pick', csvReview.ready[1].catSource === 'user');
t('and it is learned from, like a per-row chip', learned.length === 1 && learned[0].id === 'b');

console.log('\n-- destination applies to the selection and moves no default --');
reset();
csvStagedSelectAll(false);
csvStagedToggle(0);
csvBulkScope('personal');
t('a is private', csvReview.ready[0]._scope === 'personal');
t('b was not redirected', csvReview.ready[1]._scope === undefined);
t('c was not redirected', csvReview.ready[2]._scope === undefined);
t('the remembered default was NOT moved', scopeSaves.length === 0, scopeSaves.join(','));

console.log('\n-- personal is refused while the personal ledger is locked --');
reset();
personalReady = false;
csvBulkScope('personal');
t('no row was stranded in a ledger that cannot be written', csvReview.ready.every(c => c._scope === undefined));
t('and it said why', toasts.length === 1);

console.log('\n-- the bulk ✕ arms before it deletes --');
reset();
csvBulkDelete();
t('nothing removed on the first tap', ids() === 'a,b,c');
t('it is armed', csvBulkArmed === true);
t('nothing retired', dropped.length === 0);

console.log('\n-- ...and on the second tap removes exactly the selection --');
reset();
csvStagedToggle(2);                       // untick c, so a+b are selected
t('c is out of the selection', picked() === 'a,b');
csvBulkDelete();                          // arm
csvBulkDelete();                          // fire
t('the unselected row survives', ids() === 'c');
t('retired in ONE call, not one per row', dropped.length === 1, 'calls=' + dropped.length);
t('and it retired exactly the selection', dropped[0].map(r => r.id).join(',') === 'a,b');
t('disarmed afterwards', csvBulkArmed === false);
t('the open editor reference was cleared', csvExpand === null);

console.log('\n-- an empty selection is a no-op, never a delete-everything --');
reset();
csvStagedSelectAll(false);
csvBulkDelete();
t('does not arm', csvBulkArmed === false);
csvBulkDelete();
t('and never deletes', ids() === 'a,b,c' && dropped.length === 0);

console.log('\n-- any other tap disarms, so a stray touch cannot become a bulk delete --');
reset();
csvBulkDelete();
t('armed', csvBulkArmed === true);
csvStagedToggle(0);                       // ticking is not confirming
t('a tick disarmed it', csvBulkArmed === false);
csvBulkDelete();
t('the next tap only re-arms', ids() === 'a,b,c' && dropped.length === 0);

console.log('\n-- selecting is a mode you enter, not permanent chrome --');
reset();
t('nothing has been touched on a fresh queue', csvSelTouched === false);
csvStagedToggle(0);
t('a single tick enters selection mode', csvSelTouched === true);
reset();
csvStagedSelectAll(false);
t('so does deselect-all', csvSelTouched === true);
reset();
csvBulkReset();
t('a rebuild leaves the mode again', csvSelTouched === false);

console.log('\n-- with nothing selected the panel offers the way back --');
reset();
csvStagedSelectAll(false);
csvTxrRoom = 'del';
const emptyDel = csvTxrBulkHTML();
t('delete is disabled, not silently inert', / disabled/.test(emptyDel));
t('and it offers select-all', /Chọn tất cả/.test(emptyDel));
t('select-all from there restores everything', (csvStagedSelectAll(true), picked() === 'a,b,c'));

console.log('\n-- one grammar: first tap arms, the second tap on the SAME pick applies --');
reset();
const chip = { getAttribute: function(){ return 'Ăn uống'; } };
csvTxrPickCat(chip);
t('first tap arms, writes nothing', csvTxrPendCat === 'Ăn uống' && csvReview.ready.every(c => c.categoryName === undefined));
csvTxrPickCat(chip);
t('second tap applies to every selected row', csvReview.ready.every(c => c.categoryName === 'Ăn uống'));
t('and the arm is spent', csvTxrPendCat === null);

console.log('\n-- a different chip moves the arm; leaving the room clears it --');
reset();
csvTxrPickCat({ getAttribute: function(){ return 'Ăn uống'; } });
csvTxrPickCat({ getAttribute: function(){ return 'Đi lại'; } });
t('the arm moved, nothing applied', csvTxrPendCat === 'Đi lại' && csvReview.ready.every(c => c.categoryName === undefined));
csvTxrRoomGo('scope');
t('switching rooms disarms', csvTxrPendCat === null);

console.log('\n-- scope speaks the same grammar --');
reset();
const disc = { getAttribute: function(){ return 'personal'; } };
csvTxrPickScope(disc);
t('first tap arms only', csvTxrPendScope === 'personal' && csvReview.ready.every(c => c._scope === undefined));
csvTxrPickScope(disc);
t('second tap applies the destination', csvReview.ready.every(c => c._scope === 'personal'));

console.log('\n-- an empty selection cannot arm anything --');
reset();
csvStagedSelectAll(false);
csvTxrPickCat(chip);
t('no arm on nothing', csvTxrPendCat === null);
t('the armed title narrates the confirm', (csvStagedSelectAll(true), csvTxrPendCat = 'Ăn uống', /Chạm lần nữa/.test(csvTxrTitleHTML())));
csvTxrPendCat = null;

console.log('\n-- the armed label states the count, so 47 is never mistaken for 1 --');
reset();
csvTxrRoom = 'del';
csvBulkDelete();
const armedHtml = csvTxrBulkHTML();
t('armed label carries the number', /Xoá 3 khoản\?/.test(armedHtml), armedHtml.slice(0, 200));
t('and the statement turns to the confirm question', /Chắc chưa\? Không hoàn tác được\./.test(armedHtml));
reset();
csvTxrRoom = 'del';
const idleDel = csvTxrBulkHTML();
t('unarmed label carries the number too', /Xoá 3</.test(idleDel));
t('and the statement says what it removes', /Gỡ 3 khoản đã chọn khỏi hàng chờ/.test(idleDel));

console.log('\n' + (fail === 0 ? 'ALL ' + pass + ' PASSED' : pass + ' passed, ' + fail + ' FAILED'));
process.exit(fail ? 1 : 0);
