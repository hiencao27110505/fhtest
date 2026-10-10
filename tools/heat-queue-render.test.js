#!/usr/bin/env node
/* The review queue stops repainting what did not change (device-heat fix, approach B).
 * `node tools/heat-queue-render.test.js`
 *
 * renderCsvReview used to rebuild the whole body with one innerHTML write from ~110
 * call sites, and the long sections drew every row. Four properties now hold:
 *   1. a render SIGNATURE: the same state yields the same string, and every kind of
 *      state change the markup depends on yields a different one — so a render call
 *      with nothing changed paints nothing, and one with a change paints once;
 *   2. csvLendingPass answers exactly as the old O(n²) `candidates.some` did, on a
 *      300-row fixture (the old body is kept here as the oracle);
 *   3. the transfer pairing is memoised on what it reads and recomputed on change;
 *   4. "Đã có trong sổ" draws a reveal window, its header still counts every row,
 *      and select-all / skip-all still act on every row, drawn or not;
 * plus the in-place fold: opening, closing and arming a card swaps that card and
 * paints nothing else.
 *
 * 56 and 57 are loaded WHOLE into a vm context (globals, as the browser has them),
 * then the heavy card builders are replaced with flat stubs so the body can be
 * walked without the composer, the tree or the chart.
 */
const fs = require('fs'), vm = require('vm'), path = require('path');
const ROOT = path.join(__dirname, '..');
const rd = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
let pass = 0, fail = 0;
const t = (n, ok, d) => { console.log((ok ? '  PASS  ' : '  FAIL  ') + n + (!ok && d !== undefined ? '  -> ' + (typeof d === 'string' ? d : JSON.stringify(d)) : '')); ok ? pass++ : fail++; };

/* ── a flat fake DOM: enough for the body, the sentinel and one-card swaps ── */
function fakeEl(doc, id) {
  let html = '';
  const el = {
    id, paints: 0, classList: { toggle() {}, contains() { return false; }, add() {}, remove() {} }, style: {}, disabled: false, textContent: '',
    children: [], setAttribute() {}, getAttribute() { return null; }, scrollTop: 0, scrollLeft: 0, scrollWidth: 0,
    get innerHTML() { return html; },
    set innerHTML(v) { html = String(v); el.paints++; },
    get lastElementChild() {
      if (!html) return null;
      const sentinel = /<i data-csv-sig="1" hidden><\/i>$/.test(html);
      return { getAttribute: (a) => (sentinel && a === 'data-csv-sig') ? '1' : null };
    },
    get firstElementChild() { return html ? { outerHTML: html } : null; },
    querySelector(sel) {
      const m = /\[data-ck="([^"]+)"\]/.exec(sel); if (!m) return null;
      const rx = new RegExp('<div class="bulk-card[^"]*" data-ck="' + m[1].replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '"[^>]*>[\\s\\S]*?</div>');
      const hit = rx.exec(html); if (!hit) return null;
      return { replaceWith(n) { html = html.replace(hit[0], n.outerHTML); } };
    },
    querySelectorAll() { return []; },
  };
  return el;
}
function fakeDoc() {
  const doc = { els: {} };
  ['csv-result', 'csv-save'].forEach((id) => { doc.els[id] = fakeEl(doc, id); });
  doc.getElementById = (id) => doc.els[id] || null;
  doc.querySelector = () => null; doc.querySelectorAll = () => [];
  doc.createElement = () => fakeEl(doc, '');
  return doc;
}

/* ── the context: 57 + 56 whole, over the handful of globals they read ── */
function mk() {
  const doc = fakeDoc();
  const ctx = {
    console, document: doc, navigator: { onLine: true }, setTimeout: () => 0, clearTimeout() {}, requestAnimationFrame: () => 0,
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    LANG: 'vi', CUR: 'VND', curMult: () => 1000, catOrder: ['Ăn uống', 'Đi lại'], catStyle: { 'Ăn uống': ['🍜'], 'Đi lại': ['🛵'] },
    CAT_FALLBACK: 'Others', isFallbackCat: (n) => String(n || '').toLowerCase() === 'others',
    catValid: (c) => !!c && ctx.catOrder.indexOf(c) >= 0,
    deburr: (s) => String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D'),
    normDescForDedup: (x) => String(x || '').trim().toLowerCase().replace(/\s+/g, ' '),
    L: (vi) => vi, esc: (s) => String(s == null ? '' : s), escAttr: (s) => String(s == null ? '' : s),
    fmt: (n) => String(n), fmtK: (n) => String(n), fmtDayMon: (d) => d.getDate() + ' thg ' + (d.getMonth() + 1), amtPlaceholder: () => '9.000.000',
    toast() {}, chosen: () => '', bulkDate: (s) => s, bulkSummary: () => '', TODAY: new Date(),
  };
  ctx.window = ctx; ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(rd('src/js-ui/57-csv-import-review.js'), ctx);
  vm.runInContext(rd('src/js-ui/56-csv-import-ui.js'), ctx);
  /* flat stubs for the heavy builders: a card is one div carrying its key and state */
  vm.runInContext(`
    csvCollapsedCard = function(c, o){ return '<div class="bulk-card" data-ck="'+(o.key||'')+'" data-open="0" data-armed="'+(o.armed?1:0)+'" data-on="'+(o.checked?1:0)+'"></div>'; };
    csvActiveCard = function(c, o){ return '<div class="bulk-card active" data-ck="'+(o.key||'')+'" data-open="1" data-armed="'+(csvArmedRemove===o.ctaIdx?1:0)+'"></div>'; };
    csvSumHTML = function(){ return '<div class="csum"></div>'; };
    csvCatWidgetsHTML = function(){ return ''; };
    csvSpendPanel = function(){ return ''; };
    csvRulesSumHTML = function(){ return ''; };
    csvDupWhy = function(){ return 'why'; };
  `, ctx);
  return ctx;
}
const run = (ctx, code) => vm.runInContext(code, ctx);

/* a staged ready row: rowIndex is the staged row's slot, like 57 builds them */
function row(i, o) {
  const day = '2026-09-' + String(1 + (i % 28)).padStart(2, '0');
  return Object.assign({ rowIndex: i, description: 'Row ' + i, counterparty: 'SHOP ' + (i % 7), amount: 10000 + (i % 13) * 1000,
    dateDisplay: day, date: new Date(day + 'T00:00:00'), categoryName: 'Ăn uống', catSource: 'merchant', flags: [] }, o || {});
}
function staged(ctx, rows, sure) {
  ctx.csvStagedMode = true;
  ctx._fhStagedRows = rows.map((c) => ({ id: 'srow-' + c.rowIndex, source_provider: 'VIB', raw_extracted: { account_masked: '****3444', account_kind: 'deposit' } }));
  ctx.csvReview = { ready: rows, groups: [], dup: [], deferred: [], problems: [], sources: [], parsed: { headers: [], rows: [] } };
  run(ctx, 'csvExpand = null; csvArmedRemove = null; csvBulkArmed = false; csvCatFilter = null; csvPersonFilter = null; csvRevealSec = csvRevealSecBlank(); csvRevealCount = CSV_REVEAL_STEP; csvReviewSig = null;');
  return ctx.csvReview;
}

/* ═══ 1. the signature ═══════════════════════════════════════════════════════ */
console.log('\n-- signature: same state, same string --');
{
  const ctx = mk();
  const rows = []; for (let i = 0; i < 40; i++) rows.push(row(i, i % 9 === 0 ? { _dupTier: 'sure', _skipImport: true } : {}));
  staged(ctx, rows);
  const a = run(ctx, 'csvReviewSigCompute()'), b = run(ctx, 'csvReviewSigCompute()');
  t('two reads of one state agree', a === b && typeof a === 'string' && a.length > 100, a.length);
  t('the signature is exposed for the harness', run(ctx, 'typeof window.csvReviewSigCompute') === 'function');

  console.log('\n-- signature: each kind of change moves it --');
  const moves = {
    'tick a row': 'csvReview.ready[1]._skipImport = true;',
    'expand a card': "csvExpand = { kind:'ready', idx:2 };",
    'arm a ✕': 'csvArmedRemove = 3;',
    'arm the bulk ✕': 'csvBulkArmed = true;',
    'change a scope': "csvReview.ready[4]._scope = 'personal';",
    'change a kind': 'csvReview.ready[5]._xfer = true;',
    'change a node': "csvReview.ready[6]._node = 'food';",
    'change a category': "csvReview.ready[6].categoryName = 'Đi lại';",
    'change a dup tier': "csvReview.ready[7]._dupTier = 'likely';",
    'flag source attention': 'csvReview.ready[8]._srcAttn = true;',
    'edit the wording': "csvReview.ready[2].description = 'khác';",
    'edit the amount': 'csvReview.ready[2].amount = 1;',
    'move the day': "csvReview.ready[2].dateDisplay = '2026-01-01';",
    'a carry block appears': "csvReview.ready[2]._fix = { id:1, items:{ cat:{ v:'Đi lại' } } };",
    'a joined receipt': "_fhStagedRows[2]._rcpt = { items:[{}], provider:'Grab' };",
    'category filter': "csvCatFilter = 'Ăn uống';",
    'person filter': "csvPersonFilter = 'p1';",
    'chart zoom': "csvSumZoom = 'month';",
    'chart hidden': 'csvSumHidden = true;',
    'reveal more (dated list)': 'csvRevealCount += 300;',
    'reveal more (booked section)': "csvRevealSec.sure += 300;",
    'money-in fold': 'csvInflowOpen = true;',
    'a row sheet opens': "csvRowSheet = 'kind';",
    'the hot field': "csvRowHot = 'amount';",
    'a tool sheet opens': "csvToolSheet = 'pick';",
    'a quick-select condition': "csvPickF.week = true;",
    'a dismissed pair': "csvXferDismissed['a|b'] = 1;",
    'selection touched': 'csvSelTouched = true;',
    'staged mode off': 'csvStagedMode = false;',
    'language': "LANG = 'en';",
    'currency': "CUR = 'USD';",
    'a new review object': 'csvReview = Object.assign({}, csvReview);',
    'the staged rows array is replaced': '_fhStagedRows = _fhStagedRows.slice();',
    'the personal ledger signature': "window.fhPersonalSig = function(){ return 'p2'; };",
    'the statement cards (77)': "window.fhStmtCardsHTML = function(){ return '<div class=stm-card></div>'; };",
    'the rules strip (66)': "csvRulesSumHTML = function(){ return '<div class=rl-sum></div>'; };",
    'an explicit invalidate': 'csvReviewInvalidate();',
  };
  Object.keys(moves).forEach((name) => {
    const c2 = mk(); const r2 = []; for (let i = 0; i < 40; i++) r2.push(row(i, i % 9 === 0 ? { _dupTier: 'sure', _skipImport: true } : {}));
    staged(c2, r2);
    const before = run(c2, 'csvReviewSigCompute()');
    run(c2, moves[name]);
    const after = run(c2, 'csvReviewSigCompute()');
    t(name, before !== after);
  });
}

/* ═══ 2. render: paint once, skip the same, repaint the changed ══════════════ */
console.log('\n-- render: the same state paints nothing; a change paints once --');
{
  const ctx = mk();
  const rows = []; for (let i = 0; i < 30; i++) rows.push(row(i));
  staged(ctx, rows);
  const out = ctx.document.els['csv-result'];
  run(ctx, 'renderCsvReview()');
  t('first call paints', out.paints === 1, out.paints);
  t('the body ends with the sentinel', /<i data-csv-sig="1" hidden><\/i>$/.test(out.innerHTML));
  t('window.csvReviewSig holds what was painted', run(ctx, 'window.csvReviewSig === csvReviewSigCompute()'));
  run(ctx, 'renderCsvReview(); renderCsvReview();');
  t('two more calls with nothing changed paint nothing', out.paints === 1 && run(ctx, 'csvReviewSkips') === 2, [out.paints, run(ctx, 'csvReviewSkips')]);
  run(ctx, 'csvReview.ready[3]._skipImport = true; renderCsvReview();');
  t('a tick repaints once', out.paints === 2, out.paints);
  t('the Import label follows the tick', ctx.document.els['csv-save'].textContent === 'Nhập 29', ctx.document.els['csv-save'].textContent);
  out.innerHTML = '<div class="csv-unlock stm-flow">password step</div>';   // 77 painted over the body
  run(ctx, 'renderCsvReview();');
  t('a body painted by someone else is repainted even with the same state', out.paints === 4 && /data-ck="ready:0"/.test(out.innerHTML), out.paints);
}

console.log('\n-- render: the file flow (not staged) paints and skips the same way --');
{
  const ctx = mk();
  const rows = []; for (let i = 0; i < 8; i++) rows.push(row(i));
  staged(ctx, rows); ctx.csvStagedMode = false; ctx._fhStagedRows = null;
  const out = ctx.document.els['csv-result'];
  run(ctx, 'renderCsvReview(); renderCsvReview();');
  t('the file flow paints once and skips the repeat', out.paints === 1 && /Sẵn sàng · 8/.test(out.innerHTML) && (out.innerHTML.match(/data-ck="ready:/g) || []).length === 8, [out.paints, out.innerHTML.slice(0, 120)]);
  run(ctx, "csvToggleExpand('ready', 2)");
  t('the fold is in place here too', out.paints === 1 && /data-ck="ready:2" data-open="1"/.test(out.innerHTML));
  run(ctx, 'csvExpandDone()');
  t('Xong closes it in place', out.paints === 1 && /data-ck="ready:2" data-open="0"/.test(out.innerHTML) && run(ctx, 'csvExpand') === null);
}

/* ═══ 3. the in-place fold ═══════════════════════════════════════════════════ */
console.log('\n-- expand / collapse / arm swap one card, paint nothing else --');
{
  const ctx = mk();
  const rows = []; for (let i = 0; i < 12; i++) rows.push(row(i));
  staged(ctx, rows);
  const out = ctx.document.els['csv-result'];
  run(ctx, 'renderCsvReview()');
  const paints0 = out.paints;
  run(ctx, "csvToggleExpand('ready', 3)");
  t('opening card 3 does not repaint the body', out.paints === paints0, out.paints - paints0);
  t('...and card 3 is now the open card', /data-ck="ready:3" data-open="1"/.test(out.innerHTML) && run(ctx, 'csvExpand && csvExpand.idx') === 3);
  t('...and the signature matches a fresh compute, so the next render call skips', run(ctx, 'csvReviewSig === csvReviewSigCompute()'));
  run(ctx, 'renderCsvReview()');
  t('(it does)', out.paints === paints0, out.paints - paints0);
  run(ctx, "csvToggleExpand('ready', 5)");
  t('opening card 5 closes 3 and opens 5, both in place', out.paints === paints0 && /data-ck="ready:3" data-open="0"/.test(out.innerHTML) && /data-ck="ready:5" data-open="1"/.test(out.innerHTML));
  run(ctx, 'csvReadyRemove(7)');
  t('the first ✕ tap arms card 7 in place', out.paints === paints0 && /data-ck="ready:7" data-open="0" data-armed="1"/.test(out.innerHTML) && run(ctx, 'csvArmedRemove') === 7);
  run(ctx, 'csvReadyRemove(8)');
  t('arming 8 disarms 7, both in place', out.paints === paints0 && /data-ck="ready:7" data-open="0" data-armed="0"/.test(out.innerHTML) && /data-ck="ready:8" data-open="0" data-armed="1"/.test(out.innerHTML));
  run(ctx, "csvToggleExpand('ready', 5)");
  t('collapsing the open card disarms 8 and closes 5, in place', out.paints === paints0 && /data-ck="ready:8" data-open="0" data-armed="0"/.test(out.innerHTML) && /data-ck="ready:5" data-open="0"/.test(out.innerHTML) && run(ctx, 'csvExpand') === null);
  run(ctx, "csvCatFilter = 'Đi lại'; renderCsvReview(); csvToggleExpand('ready', 2)");
  t('a card not on screen (hidden by a filter) falls back to the full render', out.paints === paints0 + 2, out.paints - paints0);
  t('the second ✕ tap still removes the row (the arm path is unchanged)', (() => {
    run(ctx, 'csvCatFilter = null; csvArmedRemove = null; csvExpand = null; renderCsvReview(); csvReadyRemove(1); csvReadyRemove(1);');
    return run(ctx, 'csvReview.ready.length') === 11 && run(ctx, 'csvArmedRemove') === null;
  })());
}

console.log('\n-- the two helpers offered to 66 and 77 --');
{
  const ctx = mk();
  const rows = []; for (let i = 0; i < 6; i++) rows.push(row(i));
  staged(ctx, rows);
  run(ctx, "window.stm = '<div id=\"stm-cards\"><div class=\"stm-card\">A</div></div>'; window.fhStmtCardsHTML = function(){ return stm; };");
  const out = ctx.document.els['csv-result'];
  /* the fake DOM has no id lookup inside the body; give it one for the wrapper */
  ctx.document.els['csv-stm-cards'] = { set innerHTML(v) { out.innerHTML = out.innerHTML.replace(/<div id="csv-stm-cards">[\s\S]*?<\/div><\/div><\/div>/, '<div id="csv-stm-cards">' + v + '</div>'); out.paints--; } };
  run(ctx, 'renderCsvReview()');
  const p0 = out.paints;
  t('the statement cards sit in their own wrapper', /<div id="csv-stm-cards"><div id="stm-cards">/.test(out.innerHTML));
  run(ctx, "stm = '<div id=\"stm-cards\"><div class=\"stm-card armed\">A</div></div>'; csvStmtCardsRepaint();");
  t('csvStmtCardsRepaint swaps the block without a body paint, and the next render skips', out.paints === p0 && /stm-card armed/.test(out.innerHTML) && (run(ctx, 'renderCsvReview()'), out.paints === p0), out.paints - p0);
  run(ctx, "csvExpand = { kind:'ready', idx:4 }; renderCsvReview(); csvReview.ready[4]._fix = { id:9, items:{ cat:{ v:'Đi lại' } }, ruleOn:true }; csvCardRepaintFor(csvReview.ready[4]);");
  t('csvCardRepaintFor redraws the one card in place', out.paints === p0 + 1 && /data-ck="ready:4" data-open="1"/.test(out.innerHTML) && run(ctx, 'csvReviewSig === csvReviewSigCompute()'), out.paints - p0);
  run(ctx, "csvCardRepaintFor({ not:'a row' })");
  const skips0 = run(ctx, 'csvReviewSkips');
  run(ctx, 'csvCardRepaintFor({ not:"a row" })');
  t('...and falls back to renderCsvReview for anything else (which, with nothing changed, skips)', out.paints === p0 + 1 && run(ctx, 'csvReviewSkips') === skips0 + 1, out.paints - p0);
}

/* ═══ 4. the booked section: a window, a full count, bulk verbs over all ═════ */
console.log('\n-- "Đã có trong sổ": 150 drawn, 200 counted, every row still acted on --');
{
  const ctx = mk();
  const rows = [];
  for (let i = 0; i < 200; i++) rows.push(row(i, { _dupTier: 'sure', _skipImport: true }));
  for (let i = 200; i < 210; i++) rows.push(row(i));
  staged(ctx, rows);
  const out = ctx.document.els['csv-result'];
  run(ctx, 'renderCsvReview()');
  const html = out.innerHTML;
  const sureAt = html.indexOf('csv-sure-h'), sureEnd = html.indexOf('Hiện thêm 50 khoản', sureAt);
  const sureCards = (html.slice(sureAt, sureEnd).match(/data-ck="ready:/g) || []).length;
  t('the header counts all 200', /Đã có trong sổ · 200/.test(html));
  t('the skip-all button names all 200', /Bỏ qua cả 200/.test(html));
  t('only 150 cards are drawn', sureCards === 150, sureCards);
  t('one honest "Hiện thêm 50 khoản" button, wired to this section', /onclick="csvRevealMoreIn\('sure'\)"/.test(html));
  t('the dated list is unaffected (10 cards)', (html.slice(sureEnd).match(/data-ck="ready:/g) || []).length === 10);
  run(ctx, 'csvStagedSelectAll(true)');
  t('select-all ticks every one of the 210, drawn or not', run(ctx, 'csvStagedSelected().length') === 210, run(ctx, 'csvStagedSelected().length'));
  run(ctx, "csvRevealMoreIn('sure')");
  t('"Hiện thêm" draws the remaining 50', (out.innerHTML.match(/data-ck="ready:/g) || []).length === 210);
  run(ctx, 'csvStagedSelectAll(false); csvSureSkipAll()');
  t('skip-all retires all 200 booked rows, not the drawn 150', run(ctx, 'csvReview.ready.length') === 10, run(ctx, 'csvReview.ready.length'));
  /* the open editor is always drawn, even past the window */
  const c2 = mk(); const r2 = []; for (let i = 0; i < 200; i++) r2.push(row(i, { _dupTier: 'sure', _skipImport: true }));
  staged(c2, r2); run(c2, "csvExpand = { kind:'ready', idx:190 }; renderCsvReview()");
  t('a card past the window that holds the open editor is drawn anyway', /data-ck="ready:190" data-open="1"/.test(c2.document.els['csv-result'].innerHTML) && /Hiện thêm 49 khoản/.test(c2.document.els['csv-result'].innerHTML));
  /* the same window on "Cần bạn xem" and the money-in list */
  const c3 = mk(); const r3 = []; for (let i = 0; i < 180; i++) r3.push(row(i, { _dupTier: 'likely', _skipImport: true }));
  staged(c3, r3); run(c3, 'renderCsvReview()');
  const h3 = c3.document.els['csv-result'].innerHTML;
  t('"Cần bạn xem" draws 150 of 180 and offers the rest', (h3.match(/data-ck="ready:/g) || []).length === 150 && /onclick="csvRevealMoreIn\('attn'\)"/.test(h3) && /Hiện thêm 30 khoản/.test(h3));
  const c4 = mk(); const r4 = []; for (let i = 0; i < 160; i++) r4.push(row(i, { isIncome: true }));
  staged(c4, []); c4.csvReview.deferred = r4; run(c4, 'csvInflowOpen = true; renderCsvReview()');
  const h4 = c4.document.els['csv-result'].innerHTML;
  t('the money-in list opens 150 of 160 rows and offers the rest', (h4.match(/csvInflowToggle\(/g) || []).length === 150 && /Tiền vào · 160 khoản/.test(h4) && /onclick="csvRevealMoreIn\('inflow'\)"/.test(h4));
}

/* ═══ 5. csvLendingPass: the indexed pass equals the O(n²) oracle ═══════════ */
console.log('\n-- csvLendingPass: same answers as the old candidates.some, 300 rows --');
{
  const ctx = mk();
  /* the old body, verbatim but for the name: the oracle */
  const oldBody = `function csvLendingPassOld(candidates){
  if (!window.csvStagedMode) return;
  if (typeof csvScopeReady === 'function' && !csvScopeReady()) return;
  var pd = window.fhPersonalDebts ? fhPersonalDebts() : null;
  var people = (pd && pd.people) || [];
  var iOwe = people.filter(function(p){ return p.balance < -0.5; });
  var oweMe = people.filter(function(p){ return p.balance > 0.5; });
  var haveLessons = !!window.fhKindLesson;
  if (!iOwe.length && !oweMe.length && !haveLessons) return;
  candidates.forEach(function(c){
    if (c.isTransfer || c._xfer || c._repay || c._loan || c._invest || c.amount == null) return;
    if (c._sigHold) return;
    var text = (c.counterparty || '') + ' ' + (c.description || '');
    if (c.isIncome){
      var owed = _debtNameHit(oweMe, text);
      if (owed){ c._repay = true; c._repayWho = owed.who; c._scope = 'personal'; c._lessonWhy = 'owed'; return; }
      var vpos = window.fhInvMemoryMatch ? fhInvMemoryMatch(c.counterparty || c.description) : null;
      if (vpos){ c._invest = true; c._investPosId = vpos; c._scope = 'personal'; c._lessonWhy = 'invest'; }
      return;
    }
    var owe = _debtNameHit(iOwe, text);
    if (owe){ c._repay = true; c._repayWho = owe.who; c._scope = 'personal'; c._lessonWhy = 'owe'; _lendClearCat(c); return; }
    var paired = candidates.some(function(o){
      return o !== c && o.isIncome && o.amount === c.amount && o.date && c.date
        && Math.abs(o.date.getTime() - c.date.getTime()) <= 1.5 * 86400000;
    });
    if (paired) return;
    var ipos = window.fhInvMemoryMatch ? fhInvMemoryMatch(c.counterparty || c.description) : null;
    if (ipos){
      c._invest = true; c._investPosId = ipos; c._scope = 'personal';
      c._lessonWhy = 'invest';
      _lendClearCat(c);
      return;
    }
    var key = (typeof csvLearnKey === 'function') ? csvLearnKey(c) : '';
    var lesson = (key && haveLessons) ? fhKindLesson(key) : null;
    if (lesson){
      c._loan = true; c._loanWho = lesson.who; c._scope = 'personal';
      c._lessonWhy = 'learned'; c._lessonKey = key;
      _lendClearCat(c);
    }
  });
}`;
  run(ctx, oldBody);
  run(ctx, `
    csvStagedMode = true;
    window.fhPersonalData = function(){ return { key: 'k' }; };
    window.fhPersonalDebts = function(){ return { people: [ { who:'Nguyen Van Minh', balance: 500 }, { who:'Tran Thi Hoa', balance: -300 }, { who:'Le Kha Nin', balance: 0 } ] }; };
    window.fhKindLesson = function(key){ return /SELLER 3/i.test(key) || /anh bay/.test(key) ? { who:'Anh Bay' } : null; };
    window.fhInvMemoryMatch = function(s){ return /GOLD DESK/i.test(String(s||'')) ? 'pos-gold' : null; };
  `);
  /* 300 rows: a few amounts, so pairs happen; names that hit people, sellers that hit lessons, a gold desk */
  const mkRows = () => {
    const out = [];
    for (let i = 0; i < 300; i++) {
      const amt = [50000, 120000, 200000, 350000, 1000000, null][i % 6];
      const day = 1 + (i * 7) % 27, iso = '2026-08-' + String(day).padStart(2, '0');
      const party = ['Nguyen Van Minh chuyen tien', 'TRAN THI HOA', 'SELLER 3', 'GOLD DESK CO', 'CONG TY ABC', 'anh bay gop', ''][i % 7];
      out.push({ rowIndex: i, isIncome: i % 4 === 0, amount: amt, date: (i % 11 === 10) ? null : new Date(iso + 'T00:00:00'), dateDisplay: iso,
        counterparty: party, description: 'row ' + i + (i % 5 === 0 ? ' Nguyen Van Minh' : ''), categoryName: 'Others', catSource: 'fallback',
        flags: i % 3 === 0 ? ['needs_category'] : [], isTransfer: i % 29 === 0, _sigHold: i % 31 === 0, _xfer: i % 37 === 0 });
    }
    return out;
  };
  const A = mkRows(), B = mkRows();
  ctx.__A = A; ctx.__B = B;
  run(ctx, 'csvLendingPassOld(__A); csvLendingPass(__B);');
  const pick = (c) => JSON.stringify([c._repay, c._repayWho, c._loan, c._loanWho, c._invest, c._investPosId, c._scope, c._lessonWhy, c._lessonKey, c.categoryName, c.catSource, c.flags]);
  let same = 0, diff = [];
  for (let i = 0; i < 300; i++) { if (pick(A[i]) === pick(B[i])) same++; else diff.push(i); }
  t('all 300 rows carry the same marks under the indexed pass', same === 300, diff.slice(0, 5));
  const touched = B.filter((c) => c._repay || c._loan || c._invest).length;
  t('the fixture actually exercises the pass (rows pre-selected)', touched > 20 && touched < 300, touched);
  const paired = B.filter((c) => !c.isIncome && !c._repay && !c._loan && !c._invest && B.some((o) => o !== c && o.isIncome && o.amount === c.amount && o.date && c.date && Math.abs(o.date - c.date) <= 1.5 * 864e5)).length;
  t('...and the pair rule fired on some of them (the part that was n²)', paired > 10, paired);
}

/* ═══ 6. the transfer pairing memo ═══════════════════════════════════════════ */
console.log('\n-- csvXferProposals: memoised on what it reads, recomputed on change --');
{
  const ctx = mk();
  const rows = [
    row(0, { amount: 500000, isIncome: false, dateDisplay: '2026-09-10', date: new Date('2026-09-10T00:00:00') }),
    row(1, { amount: 500000, isIncome: true, dateDisplay: '2026-09-10', date: new Date('2026-09-10T00:00:00') }),
    row(2, { amount: 70000, isIncome: false }),
  ];
  staged(ctx, rows);
  ctx._fhStagedRows[1].raw_extracted = { account_masked: '****9999', account_kind: 'deposit' };
  ctx._fhStagedRows[1].source_provider = 'MB';
  run(ctx, `
    window.acctCalls = 0;
    window.fhStagedAcct = function(c){ acctCalls++; var r = _fhStagedRows[c.rowIndex]; return { kind:'deposit', tail: r.raw_extracted.account_masked.slice(-4), provider: r.source_provider }; };
    csvXferDismissed = {};
  `);
  const p1 = run(ctx, 'csvXferProposals()');
  t('one pair proposed (VIB → MB, same amount, same day)', p1.length === 1 && p1[0].debit.c.rowIndex === 0 && p1[0].credit.c.rowIndex === 1, p1.length);
  const calls1 = run(ctx, 'acctCalls');
  const p2 = run(ctx, 'csvXferProposals()');
  t('asked again with nothing changed: the same array, no new fhStagedAcct calls', p2 === p1 && run(ctx, 'acctCalls') === calls1, [p2 === p1, run(ctx, 'acctCalls') - calls1]);
  t('the memo lives on the review', run(ctx, 'csvReview._xferMemo && csvReview._xferMemo.props') === p1);
  run(ctx, "csvXferDismissed[csvReview._xferMemo.props[0].key] = 1;");
  t('dismissing the pair recomputes: nothing proposed', run(ctx, 'csvXferProposals()').length === 0);
  run(ctx, 'csvXferDismissed = {}; csvReview.ready[1]._skipImport = true;');
  t('unticking a leg recomputes: nothing proposed', run(ctx, 'csvXferProposals()').length === 0);
  run(ctx, 'csvReview.ready[1]._skipImport = false; csvReview.ready[0].amount = 500001;');
  t('changing a leg\'s amount recomputes: nothing proposed', run(ctx, 'csvXferProposals()').length === 0);
  run(ctx, 'csvReview.ready[0].amount = 500000;');
  t('restoring it: the pair is back', run(ctx, 'csvXferProposals()').length === 1);
  run(ctx, 'csvRenderTick++; _fhStagedRows = _fhStagedRows.slice(); _fhStagedRows[1] = Object.assign({}, _fhStagedRows[1], { source_provider:"VIB", raw_extracted:{ account_masked:"****3444", account_kind:"deposit" } });');
  t('a new render over replaced rows re-reads the instruments (same account on both legs now: no pair)', run(ctx, 'csvXferProposals()').length === 0);
  run(ctx, 'csvRenderTick++;');
  const before = run(ctx, 'acctCalls');
  run(ctx, 'csvAcctOf(csvReview.ready[0]); csvAcctOf(csvReview.ready[0]); csvAcctOf(csvReview.ready[2]); csvAcctOf(csvReview.ready[2]);');
  t('csvAcctOf asks fhStagedAcct once per row per render', run(ctx, 'acctCalls') - before === 2, run(ctx, 'acctCalls') - before);
}

/* ═══ 7. csvFixKey memo ══════════════════════════════════════════════════════ */
console.log('\n-- csvFixKey: memoised on the card, moves with its text --');
{
  const ctx = mk();
  run(ctx, 'csvStagedMode = true; _fhStagedRows = [{ source_provider:"VIB" }]; csvStagedProvider = function(){ return "VIB"; };');   // 09-providers is not loaded here
  const c = { rowIndex: 0, counterparty: '13610000120606 - LE KHA NIN', description: 'Cam on anh', amount: 5000 };
  ctx.__c = c;
  const k1 = run(ctx, 'csvFixKey(__c)'), k2 = run(ctx, 'csvFixKey(__c)');
  t('same card, same key, served from the memo', k1 === k2 && k1.indexOf('p:') === 0 && c._fixKeyMemo && c._fixKeyMemo.k === k1, k1);
  c.counterparty = ''; c.description = 'tien dien thang 9 nha';
  const k3 = run(ctx, 'csvFixKey(__c)');
  t('a changed payee / wording recomputes', k3 !== k1 && c._fixKeyMemo.k === k3, k3);
  c.description = 'ok'; const k4 = run(ctx, 'csvFixKey(__c)');
  t('a wording too short for the payee key falls to the wording key, and that is too short too: empty, like before', k4 === '', k4);
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
