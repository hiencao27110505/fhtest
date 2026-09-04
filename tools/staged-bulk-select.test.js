#!/usr/bin/env node
/* Acting on the whole selection in the bank-email review queue — through the
   toolbox (#txh: ① Chọn nhanh conditions + verbs, ② Chỉnh sửa actions).
 * `node tools/staged-bulk-select.test.js`
 *
 * Every staged row arrives TICKED, because the common case is "import the lot".
 * That default is what makes these operations sharp: a bulk action reached
 * without deselecting anything acts on the entire overnight backfill. So the
 * properties worth pinning are all about the boundary of the selection:
 *
 *   • deselect-all really clears it, and select-all really restores it
 *   • ① composes: OR inside a condition group, AND between groups, and the
 *     three verbs (replace / add / remove) act on exactly the matched set
 *   • the FX gate holds for every verb — an unresolved foreign row is never
 *     selected by machinery, only by a human who typed its ₫ amount
 *   • category and destination touch the SELECTED rows and nothing else;
 *     destination does NOT move the remembered default
 *   • personal is refused with a word while the personal ledger is locked,
 *     and nothing is stamped on refusal
 *   • a route persists and stamps its bank's rows; the bulk ✕ arms first,
 *     fires once for the whole selection, and any other tap disarms it
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
function fhProviderName(n){ return /^(mb|mbank|mbbank)$/i.test(String(n).replace(/\s/g,'')) ? 'MB Bank' : (n === 'VCB' ? 'Vietcombank' : n); }
function csvStagedProvider(c){
  var rows = window._fhStagedRows, i = c && c.rowIndex;
  var r = rows && typeof i === 'number' ? rows[i] : null;
  return fhProviderName((r && r.source_provider) || '');
}
function csvBaseAmt(n){ return Number(n) || 0; }
// the header/sheet sync write into a DOM; the harness's stub swallows it
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
function csvRowScope(c){ return (c && c._scope) || 'family'; }
// FX gating (0112): a row is held back only when the fixture marks it foreign.
function csvFxUnresolved(c){ return !!(c && c._fx); }
function csvFxInfo(){ return null; }
// duplicate suspicion is a per-row flag in the fixture
function csvIsFlaggedDup(c){ return !!(c && c._dupFlag); }
var csvRowSheet = null;
global.window = {
  catStyle: { 'Ăn uống': ['🍜'], 'Đi lại': ['🚌'] },
  fhStagedDropMany: function (list) { dropped.push(list); },
  fhStagedDropOne: function (c) { dropped.push([c]); }
};

eval(src.slice(start, end));

function reset(){
  csvReview = { ready: [
    { rowIndex:0, id:'a', amount:1, date:new Date('2026-08-26T00:00:00') },                 // MB Bank
    { rowIndex:1, id:'b', amount:2, date:new Date('2026-08-25T00:00:00'), _dupFlag:true },  // MB Bank, suspect
    { rowIndex:2, id:'c', amount:3, date:new Date('2026-08-10T00:00:00') },                 // MoMo, old
  ] };
  window._fhStagedRows = [ { source_provider:'MB' }, { source_provider:'MBBank' }, { source_provider:'MoMo' } ];
  csvStagedMode = true; csvExpand = null; csvArmedRemove = null;
  csvBulkReset();
  renders = 0; dropped = []; toasts = []; learned = []; scopeSaves = []; personalReady = true;
}
const ids = () => csvReview.ready.map(r => r.id).join(',');
const picked = () => csvStagedSelected().map(r => r.id).join(',');
const matches = () => csvPickMatches().map(r => r.id).join(',');

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

console.log('\n-- ① conditions: OR inside a group, AND between groups --');
reset();
csvPickSrcTgl('MB Bank');
t('one source names its rows', matches() === 'a,b');
csvPickSrcTgl('MoMo');
t('a second source is OR, not AND', matches() === 'a,b,c');
csvPickSrcTgl('MoMo');
csvPickDupTgl('no');
t('a second GROUP is the intersection', matches() === 'a');   // MB Bank ∩ not-duplicate
csvPickDupTgl('yes');
t('the duplicate side flips, not stacks', matches() === 'b');
csvPickClear();
t('clear really clears', csvPickCount() === 0 && matches() === 'a,b,c');

console.log('\n-- ① verbs: replace, add, remove compose any cut --');
reset();
csvPickSrcTgl('MB Bank'); csvPickDupTgl('no');
csvPickApply('set');
t('Chọn replaces the ticks with the match', picked() === 'a');
t('the verb closed the sheet', csvToolSheet === null);
csvPickClear(); csvPickSrcTgl('MoMo');
csvPickApply('add');
t('Chọn thêm unions the match in', picked() === 'a,c');
csvPickClear(); csvPickDupTgl('no');
csvPickApply('sub');
t('Bỏ chọn removes exactly the match', picked() === '');      // a and c are both clean rows
t('the suspect stayed unselected, untouched', csvReview.ready[1]._skipImport === true);

console.log('\n-- ① the FX gate holds for every verb --');
reset();
csvReview.ready[2]._fx = true;                                 // c has no ₫ amount yet
csvPickApply('set');                                           // no conditions: match = everything
t('a full-queue Chọn still skips the foreign row', picked() === 'a,b');
csvPickApply('add');
t('Chọn thêm cannot sneak it in either', picked() === 'a,b');

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

console.log('\n-- ② category via the sheet: applies and closes --');
reset();
csvToolSheet = 'edit'; csvEditRow = 'cat';
csvEditCat('Đi lại');
t('every selected row took it', csvReview.ready.every(c => c.categoryName === 'Đi lại'));
t('the sheet closed with the act', csvToolSheet === null && csvEditRow === null);

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
csvToolSheet = 'edit';
csvEditScope('personal');
t('the sheet path is refused the same way', csvReview.ready.every(c => c._scope === undefined));
t('and the sheet stays open to try again', csvToolSheet === 'edit');
personalReady = true;
csvEditScope('personal');
t('unlocked, it stamps the selection', csvReview.ready.every(c => c._scope === 'personal'));
t('says where the money is headed', /Cá nhân/.test(toasts[toasts.length - 1]));
t('and closes with the act', csvToolSheet === null);

console.log('\n-- ② a route persists and stamps its bank\'s rows --');
reset();
csvEditRoute('MB Bank', 'personal');
t('the route is remembered under the canonical name', csvTxrRoutes['MB Bank'] === 'personal');
t('both MB rows follow it now', csvReview.ready[0]._scope === 'personal' && csvReview.ready[1]._scope === 'personal');
t('the MoMo row does not', csvReview.ready[2]._scope === undefined);
t('the toast promises the future too', /các lần sau/.test(toasts[toasts.length - 1]));
delete csvTxrRoutes['MB Bank'];
reset();
personalReady = false;
csvEditRoute('MB Bank', 'personal');
t('a locked ledger refuses the route', csvTxrRoutes['MB Bank'] === undefined && csvReview.ready[0]._scope === undefined);

console.log('\n-- ② opens only when there is a selection to edit --');
reset();
csvStagedSelectAll(false);
csvToolOpen('edit');
t('refused with a word, not a dead sheet', csvToolSheet === null && toasts.length === 1);
csvStagedSelectAll(true);
csvToolOpen('edit');
t('with a selection it opens', csvToolSheet === 'edit');

console.log('\n-- the bulk ✕ arms before it deletes --');
reset();
csvBulkDelete();
t('nothing removed on the first tap', ids() === 'a,b,c');
t('it is armed', csvBulkArmed === true);
csvBulkDelete();
t('the second tap removes the selection', ids() === '');
t('one retire call for the whole batch', dropped.length === 1 && dropped[0].length === 3);
t('disarmed afterwards', csvBulkArmed === false);

console.log('\n-- any other tap disarms it --');
reset();
csvStagedSelectAll(false);
csvBulkDelete();
t('does not arm on an empty selection', csvBulkArmed === false);
csvStagedSelectAll(true);
csvBulkDelete();
t('armed', csvBulkArmed === true);
csvStagedToggle(0);
t('a tick disarmed it', csvBulkArmed === false);
t('and deleted nothing', ids() === 'a,b,c');

console.log('\n-- the sheet delete closes with the confirm --');
reset();
csvToolSheet = 'edit';
csvEditDel();
t('first tap arms, sheet stays', csvBulkArmed === true && csvToolSheet === 'edit');
csvEditDel();
t('second tap deletes and closes', ids() === '' && csvToolSheet === null);

console.log('\n-- selection intent, and a rebuild clears it all --');
reset();
t('nothing has been touched on a fresh queue', csvSelTouched === false);
csvStagedToggle(1);
t('a single tick enters selection mode', csvSelTouched === true);
reset();
csvStagedSelectAll(false);
t('so does deselect-all', csvSelTouched === true);
csvToolSheet = 'pick'; csvPickSrcTgl('MB Bank');
csvBulkReset();
t('a rebuild leaves the mode again', csvSelTouched === false);
t('and clears the conditions and the sheet', csvPickCount() === 0 && csvToolSheet === null);

console.log('\n-- the sheets say what they mean (smoke) --');
reset();
csvPickSrcTgl('MB Bank'); csvPickDupTgl('no');
var pickHtml = csvPickSheetHTML();
t('① names the matched count', /Khớp 1 khoản/.test(pickHtml));
t('① offers the way out of the filters', /Xoá lọc/.test(pickHtml));
csvPickClear();
var editHtml = csvEditSheetHTML();
t('② counts the selection in its header', /3 khoản đã chọn/.test(editHtml));
t('② carries all four actions', /Danh mục/.test(editHtml) && /Ghi vào/.test(editHtml)
  && /Theo nguồn/.test(editHtml) && /Xoá khỏi hàng chờ/.test(editHtml));

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
