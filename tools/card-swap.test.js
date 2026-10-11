#!/usr/bin/env node
/* The in-place card swap finds its card.
 * `node tools/card-swap.test.js`
 *
 * device-heat B8: opening, closing or arming one card of the review queue
 * swaps that card and leaves the rest of the body alone (csvCardPatch). It
 * finds the card by `.bulk-card[data-ck="ready:N"]`. From the day it shipped
 * until 2026-10-11 both card builders wrote the key INSIDE the class
 * attribute (class="bulk-card attn data-ck="ready:0""), so in a browser no
 * card carried data-ck, the swap returned false on every call, and every tap
 * rebuilt the whole body. tools/heat-queue-render.test.js could not see it:
 * it replaces both builders with flat stubs that write the attribute right.
 *
 * So this file uses the REAL builders, and a fake body that finds a card the
 * way a browser does (a real attribute, a matching close tag). It pins:
 *   1. every card the builders draw carries its key as its own attribute;
 *   2. the swap carries each fold, close and arm, and paints nothing else;
 *   3. THE INVARIANT: after a swap the body is byte for byte what a full
 *      render of the same state paints. A swap that drifts from the render
 *      is a screen that lies until the next unrelated repaint;
 *   4. where a full render would move more than the card (an armed header, a
 *      folded "Cần bạn xem"), the swap stands down.
 * (docs/specs/device-heat-spec.md §13)
 */
const fs = require('fs'), vm = require('vm'), path = require('path');
const ROOT = path.join(__dirname, '..');
const rd = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
let pass = 0, fail = 0;
const t = (n, ok, d) => { console.log((ok ? '  PASS  ' : '  FAIL  ') + n + (!ok && d !== undefined ? '  -> ' + (typeof d === 'string' ? d : JSON.stringify(d)) : '')); ok ? pass++ : fail++; };

/* [start, end) of the card whose root carries data-ck="key" as a REAL attribute */
function findCard(html, key) {
  const m = new RegExp('<div class="bulk-card[^"]*" data-ck="' + key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '"[^>]*>').exec(html);
  if (!m) return null;
  const tag = /<div\b|<\/div>/g; tag.lastIndex = m.index + m[0].length;
  let depth = 1, x;
  while ((x = tag.exec(html))) { depth += x[0] === '</div>' ? -1 : 1; if (depth === 0) return [m.index, x.index + 6]; }
  return null;
}
function fakeEl(id) {
  let html = '';
  const el = { id, paints: 0, classList: { toggle() {}, contains() { return false; }, add() {}, remove() {} }, style: {}, children: [], setAttribute() {}, getAttribute() { return null; }, scrollTop: 0,
    get innerHTML() { return html; }, set innerHTML(v) { html = String(v); el.paints++; },
    get lastElementChild() { return html ? { getAttribute: (a) => (a === 'data-csv-sig' && /<i data-csv-sig="1" hidden><\/i>$/.test(html)) ? '1' : null } : null; },
    get firstElementChild() { return html ? { outerHTML: html } : null; },
    querySelector(sel) {
      if (sel === '.csv-attn-h .csv-linkbtn.armed') return /class="csv-linkbtn armed"/.test(html) ? {} : null;
      const m = /^\.bulk-card\[data-ck="([^"]+)"\]$/.exec(sel); if (!m) return null;
      if (!findCard(html, m[1])) return null;
      /* a node, not an offset: located again when it is replaced, as two cards
         swapped in one call move each other's position in the string */
      return { replaceWith(n) { const at = findCard(html, m[1]); el.swaps++; html = html.slice(0, at[0]) + n.outerHTML + html.slice(at[1]); } };
    },
    querySelectorAll() { return []; }, swaps: 0 };
  return el;
}
function mk() {
  const els = {}; ['csv-result', 'csv-save'].forEach((id) => { els[id] = fakeEl(id); });
  const doc = { getElementById: (id) => els[id] || null, querySelector: () => null, querySelectorAll: () => [], createElement: () => fakeEl('') };
  const ctx = {
    console, document: doc, navigator: { onLine: true }, setTimeout: () => 0, clearTimeout() {}, requestAnimationFrame: () => 0,
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    LANG: 'vi', CUR: 'VND', curMult: () => 1000, catOrder: ['Ăn uống', 'Đi lại', 'Khác'], catStyle: { 'Ăn uống': ['🍜'], 'Đi lại': ['🛵'], 'Khác': ['🏷️'] },
    CAT_FALLBACK: 'Others', isFallbackCat: (n) => String(n || '').toLowerCase() === 'others',
    deburr: (s) => String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D'),
    normDescForDedup: (x) => String(x || '').trim().toLowerCase().replace(/\s+/g, ' '),
    L: (vi) => vi, esc: (s) => String(s == null ? '' : s), escAttr: (s) => String(s == null ? '' : s),
    fmt: (n) => Math.round(n * 1000).toLocaleString('vi-VN') + ' ₫', fmtK: (n) => String(n), fmtDayMon: (d) => d.getDate() + ' thg ' + (d.getMonth() + 1), amtPlaceholder: () => '9.000.000',
    toast() {}, chosen: () => '', bulkDate: (s) => s, bulkSummary: () => '', TODAY: new Date(2026, 6, 5),
  };
  ctx.catValid = (c) => !!c && ctx.catOrder.indexOf(c) >= 0;
  ctx.window = ctx; ctx.globalThis = ctx;
  vm.createContext(ctx);
  ['src/js-ui/09-providers.js', 'src/js-ui/09-source-face.js', 'src/js-ui/12-format-helpers.js'].forEach((f) => {
    try { vm.runInContext(rd(f), ctx); } catch (e) { console.error('could not load ' + f + ': ' + e.message); process.exit(1); }
  });
  vm.runInContext(rd('src/js-ui/57-csv-import-review.js'), ctx);
  vm.runInContext(rd('src/js-ui/58-dedup-engine.js'), ctx);
  vm.runInContext(rd('src/js-ui/56-csv-import-ui.js'), ctx);
  /* the chart and the strips sit above the cards and are not what a swap touches */
  vm.runInContext("csvSumHTML = function(){ return ''; }; csvCatWidgetsHTML = function(){ return ''; }; csvSpendPanel = function(){ return ''; }; csvRulesSumHTML = function(){ return ''; }; csvSumAfterRender = function(){};", ctx);
  /* note whether the swap carried the last interaction */
  vm.runInContext('var _swap = null, _patch = csvCardPatch; csvCardPatch = function(idxs){ _swap = _patch(idxs); return _swap; };', ctx);
  return ctx;
}
const run = (ctx, code) => vm.runInContext(code, ctx);
const out = (ctx) => ctx.document.getElementById('csv-result');

function scene(ctx) {
  ctx.csvStagedMode = true;
  run(ctx, `
    var day = function(s){ return new Date(s + 'T00:00:00'); };
    var R = function(i, o){ var c = { rowIndex:i, _hasDesc:true, flags:[], categoryName:'Ăn uống', catSource:'merchant' }; for(var k in o) c[k] = o[k]; c.date = day(c.dateDisplay); return c; };
    var ledger = function(id, d, amt, note, o){ var t = { id:id, _d:day(d), day:d, amtD:amt, note:note, book:'personal', time:'', src:'direct-email' }; for(var k in (o||{})) t[k] = o[k]; return t; };
    var twinA = ledger('t1', '2026-07-01', 253900, 'Foody', { time:'10:17' }), twinB = ledger('t2', '2026-07-04', 130000, 'ZALOPAY', { time:'12:38' }), twinS = ledger('t4', '2026-07-04', 59000, 'HIGHLANDS COFFEE', { time:'08:15' });
    var rows = [
      R(0, { description:'Ngân hàng TMCP Quốc tế Việt Nam', counterparty:'Ngân hàng TMCP Quốc tế Việt Nam', amount:253900, dateDisplay:'2026-07-04', time:'11:28', _skipImport:true, _dupTier:'likely', _dupWhy:'card_posting', _dupTwin:twinA, _dupTwinKind:'ledger', duplicateOfExisting:twinA }),
      R(1, { description:'ARTISAN PATINA', counterparty:'ARTISAN PATINA', amount:130000, dateDisplay:'2026-07-04', time:'12:41', _skipImport:true, _dupTier:'likely', _dupWhy:'exact_day', _dupTwin:twinB, _dupTwinKind:'ledger', duplicateOfExisting:twinB }),
      R(2, { description:'CAO THAI DUY HIEN chuyen tien', counterparty:'CAO THAI DUY HIEN', amount:2000000, dateDisplay:'2026-07-03', time:'09:02', categoryName:'Khác', _srcAttn:true }),
      R(3, { description:'HIGHLANDS COFFEE', counterparty:'HIGHLANDS COFFEE', amount:59000, dateDisplay:'2026-07-04', time:'08:15', _skipImport:true, _dupTier:'sure', _dupWhy:'exact_merchant', _dupShared:'highlands', _dupTwin:twinS, _dupTwinKind:'ledger', duplicateOfExisting:twinS }),
      R(4, { description:'GRAB', counterparty:'GRAB', amount:45000, dateDisplay:'2026-07-03', time:'18:22', categoryName:'Đi lại' }),
      R(5, { description:'CIRCLE K', counterparty:'CIRCLE K', amount:25000, dateDisplay:'2026-07-02', time:'07:40' }),
      R(6, { description:'PHUC LONG', counterparty:'PHUC LONG', amount:65000, dateDisplay:'2026-07-02', time:'15:10' })
    ];
    window._fhStagedRows = rows.map(function(c){ return { id:'srow-'+c.rowIndex, source_provider:'VIB', occurred_at:c.dateDisplay+'T'+(c.time||'00:00')+':00+07:00', counterparty:c.counterparty,
      raw_extracted:{ account_masked:'****4751', account_kind:'credit_card', _transport:'oauth_direct', transaction_type:'bank_txn' } }; });
    csvReview = { ready: rows, groups: [], dup: [], deferred: [], problems: [], sources: [], parsed: { headers: [], rows: [] } };
    csvExpand = null; csvArmedRemove = null; csvBulkArmed = false; csvCatFilter = null; csvPersonFilter = null;
    csvRevealSec = csvRevealSecBlank(); csvRevealCount = CSV_REVEAL_STEP; csvReviewSig = null; csvAttnFold = false; csvLikelyArmed = false; csvAttnJustOpened = false;
    renderCsvReview();
  `);
  return ctx;
}

/* ═══ 1. the key is an attribute ═════════════════════════════════════════════ */
console.log('\n-- every card carries its key as an attribute of its own --');
{
  const ctx = scene(mk()); const h = out(ctx).innerHTML;
  const cards = h.match(/<div class="bulk-card[^>]*>/g) || [];
  t('seven cards are drawn', cards.length === 7, cards.length);
  t('each opens with class="…" closed before data-ck="ready:N"', cards.every((c) => /^<div class="bulk-card[a-z -]*" data-ck="ready:\d+">$/.test(c)), cards.filter((c) => !/^<div class="bulk-card[a-z -]*" data-ck="ready:\d+">$/.test(c))[0]);
  t('no class attribute swallows the key (the bug this file exists for)', !/class="[^"]*data-ck/.test(h));
  t('a browser-style lookup finds every one of them', [0, 1, 2, 3, 4, 5, 6].every((i) => findCard(h, 'ready:' + i)));
  run(ctx, "csvExpand = { kind:'ready', idx:4 }; renderCsvReview();");
  t('the open card too', /<div class="bulk-card active" data-ck="ready:4">/.test(out(ctx).innerHTML) && !!findCard(out(ctx).innerHTML, 'ready:4'));
  const c2 = scene(mk());
  run(c2, 'csvStagedMode = false; csvExpand = null; csvReviewInvalidate(); renderCsvReview();');
  const fh = out(c2).innerHTML, fcards = fh.match(/<div class="bulk-card[^>]*>/g) || [];
  t('and the file-import flow\'s cards', fcards.length > 0 && fcards.every((c) => /^<div class="bulk-card[a-z -]*" data-ck="ready:\d+">$/.test(c)), fcards[0]);
}

/* ═══ 2 + 3. the swap carries the tap, and matches the full render ═══════════ */
console.log('\n-- each fold, close and arm is one swap, and the body equals a full render --');
{
  const ctx = scene(mk()); const o = out(ctx);
  const step = (name, code, wantSwap) => {
    const paints = o.paints; run(ctx, '_swap = null;'); run(ctx, code);
    const swapped = run(ctx, '_swap'), after = o.innerHTML, painted = o.paints - paints;
    run(ctx, 'csvReviewInvalidate(); renderCsvReview();');
    const full = o.innerHTML;
    let where = '';
    if (after !== full) { let i = 0; while (i < after.length && after[i] === full[i]) i++; where = 'differs at ' + i + ': ' + after.slice(Math.max(0, i - 60), i + 80) + '  VS  ' + full.slice(Math.max(0, i - 60), i + 80); }
    t(name + (wantSwap ? ' (swapped, 0 body paints)' : ' (full render)'), after === full && swapped === wantSwap && (wantSwap ? painted === 0 : painted >= 1), where || { swapped, painted });
  };
  step('open a dated-list card', "csvToggleExpand('ready', 4)", true);
  step('open another: the first one closes', "csvToggleExpand('ready', 5)", true);
  step('close it by its own header', "csvToggleExpand('ready', 5)", true);
  step('open a "có thể trùng" card', "csvToggleExpand('ready', 1)", true);
  step('arm its delete', 'csvReadyRemove(1)', true);
  step('open a different card: the armed one disarms and closes', "csvToggleExpand('ready', 0)", true);
  step('open a guessed-kind card', "csvToggleExpand('ready', 2)", true);
  step('open a booked card', "csvToggleExpand('ready', 3)", true);
  step('close through csvExpandDone', 'csvExpandDone()', true);
  step('repaint one card for another file (csvCardRepaintFor)', 'csvCardRepaintFor(csvReview.ready[6])', true);
  t('the swaps above replaced cards, never the body', o.swaps >= 12, o.swaps);
  {
    /* the swap advances the signature, so the render call that follows a tap
       (there is always one: a hydrate, a badge refresh) finds nothing to do */
    run(ctx, "csvToggleExpand('ready', 6)");
    const paints = o.paints; run(ctx, 'renderCsvReview(); renderCsvReview();');
    t('a render right after a swap paints nothing', o.paints === paints, o.paints - paints);
    run(ctx, "csvToggleExpand('ready', 6)");
  }

  console.log('\n-- where a full render would move more than the card, the swap stands down --');
  step('an armed skip-all, then a card is opened: the header must repaint', "csvLikelySkipAll(); csvToggleExpand('ready', 4)", false);
  step('and the next tap is a swap again', "csvToggleExpand('ready', 4)", true);
  run(ctx, 'csvAttnToggle()');
  step('"Cần bạn xem" folded, a dated card opens', "csvToggleExpand('ready', 5)", true);
  run(ctx, 'csvExpand = null; csvReviewInvalidate(); renderCsvReview();');
  step('folded, one of its own cards is opened from elsewhere: the section has to appear', "csvToggleExpand('ready', 1)", false);
  step('and closing it folds the section away again', "csvToggleExpand('ready', 1)", false);
  run(ctx, 'csvAttnToggle()');
}

console.log('\n-- an edit is never swapped: a changed row takes the full render --');
{
  const ctx = scene(mk()); const o = out(ctx);
  run(ctx, "csvToggleExpand('ready', 4)");
  /* the flush that closes the card finds a typed note on it */
  run(ctx, "var _realFlush = csvFlushExpand; csvFlushExpand = function(){ if(csvExpand && csvReview.ready[csvExpand.idx]) csvReview.ready[csvExpand.idx].description = 'GRAB về nhà'; };");
  const paints = o.paints; run(ctx, "_swap = null; csvToggleExpand('ready', 4)");
  t('closing a card whose note changed repaints the body', o.paints === paints + 1 && run(ctx, '_swap') !== true, { paints: o.paints - paints, swap: run(ctx, '_swap') });
  t('and the new words are on the collapsed card', /GRAB về nhà/.test(o.innerHTML));
}

console.log('\n-- a card that is not on screen is not swapped --');
{
  const ctx = scene(mk());
  run(ctx, "csvCatFilter = 'Đi lại'; renderCsvReview();");
  t('under a category filter a hidden card refuses the swap', run(ctx, 'csvCardPatch([5])') === false);
  t('a shown one accepts it', run(ctx, 'csvCardPatch([4])') === true);
  t('an index past the list refuses', run(ctx, 'csvCardPatch([99])') === false);
  out(ctx).innerHTML = '<div>a statement step painted here</div>';
  t('a body someone else painted refuses (no sentinel)', run(ctx, 'csvCardPatch([4])') === false);
}

console.log('\n' + (fail === 0 ? 'ALL ' + pass + ' PASSED' : pass + ' passed, ' + fail + ' FAILED'));
process.exit(fail ? 1 : 0);
