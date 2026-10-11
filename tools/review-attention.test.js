#!/usr/bin/env node
/* "Cần bạn xem": the fold, the reason on the card, and skip-all.
 * `node tools/review-attention.test.js`
 *
 * docs/specs/transaction-review-spec.md §3a. Three things were added to the
 * staged queue's "Cần bạn xem" section, and each can fail without an error:
 *   A1  the section folds under its header, which keeps the count;
 *   A2  a "có thể trùng" card says why it is asked about while collapsed, in
 *       one sentence plus the row it was matched against, and says the same
 *       two lines when open;
 *   A3  "Bỏ qua N khoản có thể trùng" retires every open duplicate question,
 *       drawn or not, after an arm-then-confirm, and nothing else.
 *
 * 57, 58 and 56 are loaded WHOLE into a vm context with the REAL card
 * builders (tools/heat-queue-render.test.js stubs them; this test is about
 * what they draw). The chart, the category strip and the rules strip are
 * stubbed out: they sit above the section and are not under test.
 */
const fs = require('fs'), vm = require('vm'), path = require('path');
const ROOT = path.join(__dirname, '..');
const rd = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
let pass = 0, fail = 0;
const t = (n, ok, d) => { console.log((ok ? '  PASS  ' : '  FAIL  ') + n + (!ok && d !== undefined ? '  -> ' + (typeof d === 'string' ? d : JSON.stringify(d)) : '')); ok ? pass++ : fail++; };

function fakeEl(id) {
  let html = '';
  const el = { id, paints: 0, classList: { toggle() {}, contains() { return false; }, add() {}, remove() {} }, style: {}, children: [], setAttribute() {}, getAttribute() { return null; }, scrollTop: 0,
    get innerHTML() { return html; }, set innerHTML(v) { html = String(v); el.paints++; },
    get lastElementChild() { return html ? { getAttribute: (a) => (a === 'data-csv-sig' && /<i data-csv-sig="1" hidden><\/i>$/.test(html)) ? '1' : null } : null; },
    /* enough of querySelector for csvCardPatch: the armed skip-all in the header,
       and a card by its key (a real data-ck attribute, as a browser reads it) */
    querySelector(sel) {
      if (sel === '.csv-attn-h .csv-linkbtn.armed') return /class="csv-linkbtn armed"/.test(html) ? {} : null;
      const m = /\[data-ck="([^"]+)"\]/.exec(sel); if (!m) return null;
      const rx = new RegExp('<div class="bulk-card[^"]*" data-ck="' + m[1] + '"[^>]*></div>');
      const hit = rx.exec(html); if (!hit) return null;
      return { replaceWith(n) { html = html.replace(hit[0], n.outerHTML); } };
    },
    get firstElementChild() { return html ? { outerHTML: html } : null; },
    querySelectorAll() { return []; } };
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
    chosen: () => '', bulkDate: (s) => s, bulkSummary: () => '', TODAY: new Date(2026, 6, 5), toasts: [], dropped: [],
  };
  ctx.toast = (m) => ctx.toasts.push(m);
  ctx.catValid = (c) => !!c && ctx.catOrder.indexOf(c) >= 0;
  ctx.fhStagedDropMany = (rows) => { ctx.dropped.push(rows.map((c) => c.rowIndex)); return Promise.resolve(rows.length); };
  ctx.window = ctx; ctx.globalThis = ctx;
  vm.createContext(ctx);
  /* What the real card builders reach for: the provider registry (the bank's name
     on the eyebrow), the source faces, and the picker rows of the open card. */
  ['src/js-ui/09-providers.js', 'src/js-ui/09-source-face.js', 'src/js-ui/12-format-helpers.js'].forEach((f) => {
    try { vm.runInContext(rd(f), ctx); } catch (e) { console.error('could not load ' + f + ': ' + e.message); process.exit(1); }
  });
  vm.runInContext(rd('src/js-ui/57-csv-import-review.js'), ctx);
  vm.runInContext(rd('src/js-ui/58-dedup-engine.js'), ctx);
  vm.runInContext(rd('src/js-ui/56-csv-import-ui.js'), ctx);
  vm.runInContext("csvSumHTML = function(){ return ''; }; csvCatWidgetsHTML = function(){ return ''; }; csvSpendPanel = function(){ return ''; }; csvRulesSumHTML = function(){ return ''; };", ctx);
  return ctx;
}
const run = (ctx, code) => vm.runInContext(code, ctx);
const body = (ctx) => { run(ctx, 'renderCsvReview()'); return ctx.document.getElementById('csv-result').innerHTML; };
const count = (h, rx) => (h.match(rx) || []).length;

/* Rows are built INSIDE the context, so their Dates are the context's Dates. */
function scene(ctx, extra) {
  ctx.csvStagedMode = true;
  run(ctx, `
    var day = function(s){ return new Date(s + 'T00:00:00'); };
    var R = function(i, o){ var c = { rowIndex:i, _hasDesc:true, flags:[], categoryName:'Ăn uống', catSource:'merchant' }; for(var k in o) c[k] = o[k]; c.date = day(c.dateDisplay); return c; };
    var ledger = function(id, d, amt, note, o){ var t = { id:id, _d:day(d), day:d, amtD:amt, note:note, book:'personal', time:'', src:'direct-email' }; for(var k in (o||{})) t[k] = o[k]; return t; };
    var twinA = ledger('t1', '2026-07-01', 253900, 'Foody', { time:'10:17' });
    var twinB = ledger('t2', '2026-07-04', 130000, 'ZALOPAY', { time:'12:38' });
    var twinC = ledger('t3', '2026-07-03', 89000, 'Hải Sản Biển Đông', { book:'family', who:'Trang' });
    var twinS = ledger('t4', '2026-07-04', 59000, 'HIGHLANDS COFFEE', { time:'08:15' });
    var rows = [
      R(0, { description:'Ngân hàng TMCP Quốc tế Việt Nam', counterparty:'Ngân hàng TMCP Quốc tế Việt Nam', amount:253900, dateDisplay:'2026-07-04', time:'11:28', _skipImport:true, _dupTier:'likely', _dupWhy:'card_posting', _dupTwin:twinA, _dupTwinKind:'ledger', duplicateOfExisting:twinA }),
      R(1, { description:'ARTISAN PATINA', counterparty:'ARTISAN PATINA', amount:130000, dateDisplay:'2026-07-04', time:'12:41', _skipImport:true, _dupTier:'likely', _dupWhy:'exact_day', _dupTwin:twinB, _dupTwinKind:'ledger', duplicateOfExisting:twinB }),
      R(2, { description:'NHA HANG HAI SAN BIEN DONG', counterparty:'NHA HANG HAI SAN BIEN DONG', amount:89000, dateDisplay:'2026-07-04', time:'', _skipImport:true, _dupTier:'likely', _dupWhy:'card_posting', _dupShared:'bien', _dupTwin:twinC, _dupTwinKind:'ledger', duplicateOfExisting:twinC }),
      R(3, { description:'CAO THAI DUY HIEN chuyen tien', counterparty:'CAO THAI DUY HIEN', amount:2000000, dateDisplay:'2026-07-03', time:'09:02', categoryName:'Khác', _srcAttn:true }),
      R(4, { description:'HIGHLANDS COFFEE', counterparty:'HIGHLANDS COFFEE', amount:59000, dateDisplay:'2026-07-04', time:'08:15', _skipImport:true, _dupTier:'sure', _dupWhy:'exact_merchant', _dupShared:'highlands', _dupTwin:twinS, _dupTwinKind:'ledger', duplicateOfExisting:twinS }),
      R(5, { description:'GRAB', counterparty:'GRAB', amount:45000, dateDisplay:'2026-07-03', time:'18:22', categoryName:'Đi lại' }),
      R(6, { description:'CIRCLE K', counterparty:'CIRCLE K', amount:25000, dateDisplay:'2026-07-02', time:'07:40' })
    ];
    ${extra || ''}
    window._fhStagedRows = rows.map(function(c){ return { id:'srow-'+c.rowIndex, source_provider:'VIB', occurred_at:c.dateDisplay+'T'+(c.time||'00:00')+':00+07:00', counterparty:c.counterparty,
      raw_extracted:{ account_masked:'****4751', account_kind:'credit_card', _transport:'oauth_direct', transaction_type:'bank_txn' } }; });
    csvReview = { ready: rows, groups: [], dup: [], deferred: [], problems: [], sources: [], parsed: { headers: [], rows: [] } };
    csvExpand = null; csvArmedRemove = null; csvBulkArmed = false; csvCatFilter = null; csvPersonFilter = null;
    csvRevealSec = csvRevealSecBlank(); csvRevealCount = CSV_REVEAL_STEP; csvReviewSig = null; csvAttnFold = false; csvLikelyArmed = false; csvAttnJustOpened = false;
  `);
  return ctx;
}
/* the slice of the body that is one card, by its ready index */
function card(h, i) {
  const at = h.indexOf('onclick="csvToggleExpand(\'ready\',' + i + ')"'); if (at < 0) return '';
  const start = h.lastIndexOf('<div class="bulk-card', at), next = h.indexOf('<div class="bulk-card', at);
  return h.slice(start, next < 0 ? h.length : next);
}
const header = (h) => { const m = /<div class="group-h attn csv-attn-h[^"]*">[\s\S]*?<\/div>/.exec(h); return m ? m[0] : ''; };

/* ═══ A1. the header: count, fold, and what the section holds ════════════════ */
console.log('\n-- the header counts every card the section holds --');
{
  const ctx = scene(mk()); const h = body(ctx), hd = header(h);
  t('"Cần bạn xem · 4": three open duplicate questions and one guessed kind', /Cần bạn xem · 4</.test(hd), hd);
  t('the header is a button that says it is open', /<button type="button" class="csv-fold" onclick="csvAttnToggle\(\)" aria-expanded="true">/.test(hd));
  t('the chevron is an inline SVG, not a text glyph', /class="csv-fold-chev" aria-hidden="true"><svg /.test(hd) && !/[▾▴▸›]/.test(hd));
  t('all four cards are drawn under it', [0, 1, 2, 3].every((i) => card(h, i)));
  t('the booked row sits in its own section, the rest in the dated list', /Đã có trong sổ · 1/.test(h) && card(h, 5) && card(h, 6));
}

console.log('\n-- folded: the header and its count stay, the cards are not built --');
{
  const ctx = scene(mk()); body(ctx);
  const sigOpen = run(ctx, 'csvReviewSigCompute()');
  run(ctx, 'csvAttnToggle()');
  const h = ctx.document.getElementById('csv-result').innerHTML, hd = header(h);
  t('the toggle painted', ctx.document.getElementById('csv-result').paints === 2, ctx.document.getElementById('csv-result').paints);
  t('aria-expanded is false and the count is still 4', /aria-expanded="false"/.test(hd) && /Cần bạn xem · 4</.test(hd), hd);
  t('none of its four cards is in the body', [0, 1, 2, 3].every((i) => !card(h, i)));
  t('the booked section and the dated list are untouched', /Đã có trong sổ · 1/.test(h) && card(h, 4) && card(h, 5) && card(h, 6));
  t('the skip-all steps aside: it would act on cards nobody can see', !/csvLikelySkipAll/.test(h));
  t('the signature moved, so the fold is a paint and not a skip', run(ctx, 'csvReviewSigCompute()') !== sigOpen);
  run(ctx, 'csvAttnToggle()');
  const h2 = ctx.document.getElementById('csv-result').innerHTML;
  t('unfolded: the four cards are back', [0, 1, 2, 3].every((i) => card(h2, i)) && /aria-expanded="true"/.test(header(h2)));
  {
    /* not drawn is not enough: folded, the cards must not be BUILT (device heat) */
    const c2 = scene(mk());
    run(c2, 'var _built = 0, _dupCard = csvStagedDupCard, _srcCard = csvStagedSrcCard; csvStagedDupCard = function(c, i, tier){ if(tier === "likely") _built++; return _dupCard.apply(null, arguments); }; csvStagedSrcCard = function(){ _built++; return _srcCard.apply(null, arguments); };');
    body(c2);
    const open = run(c2, '_built');
    run(c2, '_built = 0; csvAttnToggle();');
    t('open, its four cards are built; folded, none is', open === 4 && run(c2, '_built') === 0, [open, run(c2, '_built')]);
  }
  t('and ease in once', /class="csv-cards csv-attn-in"/.test(h2));
  run(ctx, 'csvReviewInvalidate()');
  t('the next paint does not replay the ease', !/csv-attn-in/.test(body(ctx)));
}

console.log('\n-- folding and the open editor --');
{
  const ctx = scene(mk());
  run(ctx, "csvFlushExpand = function(){ window._flushed = (window._flushed || 0) + 1; }; csvExpand = { kind:'ready', idx:1 };");
  run(ctx, 'csvAttnToggle()');
  t('folding closes an editor inside the section, through the flush', run(ctx, 'csvExpand') === null && ctx._flushed === 1, ctx._flushed);
  run(ctx, "csvAttnToggle(); csvExpand = { kind:'ready', idx:5 }; csvAttnToggle();");
  t('an editor open in the dated list is left alone', run(ctx, 'csvExpand && csvExpand.idx') === 5 && run(ctx, 'csvAttnFold') === true);
  run(ctx, "csvExpand = { kind:'ready', idx:0 };");
  t('csvAttnHolds knows which editors are the section\'s', run(ctx, "csvAttnHolds({kind:'ready',idx:0}) && csvAttnHolds({kind:'ready',idx:3}) && !csvAttnHolds({kind:'ready',idx:4}) && !csvAttnHolds({kind:'ready',idx:5}) && csvAttnHolds({kind:'group',idx:0}) && !csvAttnHolds(null)") === true);
}
{
  /* the real editor this time: a card opened from elsewhere while the section is folded */
  const ctx = scene(mk()); body(ctx);
  run(ctx, "csvAttnFold = true; csvExpand = { kind:'ready', idx:1 };");
  const h = body(ctx);
  t('a card opened while the section is folded is still drawn', /aria-expanded="true"/.test(header(h)) && /class="bulk-card active/.test(h));
  t('and the fold itself was not thrown away', run(ctx, 'csvAttnFold') === true);
}

/* ═══ A2. the reason, on the collapsed card ═══════════════════════════════════ */
console.log('\n-- a collapsed "có thể trùng" card says why, and shows the other row --');
{
  const ctx = scene(mk()); const h = body(ctx);
  const c0 = card(h, 0), c1 = card(h, 1), c2 = card(h, 2);
  t('the posting notice: the sentence counts the days', /<span class="scv-why-r">Cùng số tiền với một khoản đã nhập 3 ngày trước<\/span>/.test(c0), c0.slice(-330));
  t('and the booked row follows: words, day and clock, book', /<span class="scv-why-t">“Foody” · 1 thg 7 10:17 · sổ Riêng tư<\/span>/.test(c0), c0.slice(-330));
  t('the equal amount is not repeated on the second line', !/scv-why-t">[^<]*253/.test(c0));
  t('same day: the sentence says so', /<span class="scv-why-r">Cùng số tiền, cùng ngày với một khoản trong sổ<\/span><span class="scv-why-t">“ZALOPAY” · 4 thg 7 12:38 · sổ Riêng tư<\/span>/.test(c1), c1.slice(-330));
  t('same merchant, one day before: "hôm trước", and who logged it in the family book', /Cùng số tiền, cùng nơi chi với một khoản đã nhập hôm trước<\/span><span class="scv-why-t">“Hải Sản Biển Đông” · 3 thg 7 · sổ Gia đình · Trang đã ghi</.test(c2), c2.slice(-330));
  t('the reason sits inside the tap area, after the row\'s own lines', /scv-foot[\s\S]*<span class="scv-why">[\s\S]*<\/button>/.test(c0));
  t('a guessed-kind card has no reason block (it has no matched row)', card(h, 3) && !/scv-why/.test(card(h, 3)));
  t('a booked card keeps its collapsed shape', card(h, 4) && !/scv-why/.test(card(h, 4)));
  t('a dated-list card has none', !/scv-why/.test(card(h, 5)));
  t('exactly three reason blocks on the screen', count(h, /class="scv-why"/g) === 3, count(h, /class="scv-why"/g));
}

console.log('\n-- every open question has a sentence, and none of them hedges with a dash --');
{
  const ctx = scene(mk());
  const ask = (why, more) => run(ctx, `(function(){ var c = { _dupTier:'likely', _dupWhy:'${why}', amount:130000, date:new Date('2026-07-04T00:00:00') }; ${more || ''} var a = csvDupAsk(c); return a ? a.why + '|' + a.twin : null; })()`);
  const want = {
    exact_day: 'Cùng số tiền, cùng ngày với một khoản trong sổ',
    card_posting: 'Cùng số tiền với một khoản đã nhập mấy ngày trước',
    kind_conflict: 'Trùng nội dung, số tiền và ngày với một khoản ghi ngược chiều thu chi',
    cross_source: 'Một nguồn khác cũng báo số tiền này trong 3 ngày',
    same_bank_pair: 'Cùng ngân hàng báo số tiền này hai lần',
    statement_echo: 'Sao kê và email cùng báo số tiền này trong một ngày',
    pipeline: 'Một email từ nguồn khác cũng báo số tiền này trong 3 ngày',
    in_batch: 'Xuất hiện hai lần với cùng nội dung và số tiền',
  };
  Object.keys(want).forEach((w) => { const got = ask(w); t(w + ': ' + want[w], got === want[w] + '|', got); });
  const all = Object.keys(want).map((w) => ask(w)).join(' ');
  t('no em dash, no en dash, no arrow, no ellipsis, no "nhé" in any of them', !/[—–→…]|\.\.\.|nhé/.test(all));
  t('a queue twin shows its words, day, clock and bank', ask('cross_source', "c._dupTwin = { description:'Nha hang ABC', amount:130000, date:new Date('2026-07-04T00:00:00'), time:'10:05', rowIndex:0 }; c._dupTwinKind = 'queue';") === 'Một nguồn khác cũng báo số tiền này trong 3 ngày|“Nha hang ABC” · 4 thg 7 10:05 · VIB', ask('cross_source', "c._dupTwin = { description:'Nha hang ABC', amount:130000, date:new Date('2026-07-04T00:00:00'), time:'10:05', rowIndex:0 }; c._dupTwinKind = 'queue';"));
  t('a legacy flag with no reason code still gets a sentence', run(ctx, "(function(){ var a = csvDupAsk({ duplicateOfExisting:{ _d:new Date('2026-07-02T00:00:00'), amtD:5000, note:'x', book:'personal' }, amount:5000 }); return a && a.why; })()") === 'Cùng số tiền với một khoản trong sổ, cách nhau không quá 3 ngày');
  t('a booked row is not an open question', run(ctx, "csvDupAsk({ _dupTier:'sure', _dupWhy:'exact_merchant' })") === null);
  t('nor is an unflagged row', run(ctx, 'csvDupAsk({ amount: 1 })') === null && run(ctx, 'csvDupAsk(null)') === null);
  t('the long evidence line keeps its amount (the booked note still reads as before)', run(ctx, "csvDupTwinLine({ _d:new Date('2026-07-01T00:00:00'), amtD:130000, note:'Thanh toán GRAB', book:'personal', time:'12:38' }, false)") === '“Thanh toán GRAB” · 130.000 ₫ · 1 thg 7 12:38 · sổ Riêng tư');
}

console.log('\n-- open, the card says the same two lines --');
{
  const ctx = scene(mk());
  run(ctx, "csvExpand = { kind:'ready', idx:1 };");
  let h; try { h = body(ctx); } catch (e) { h = ''; t('the real open card renders in this harness', false, e.message); }
  if (h) {
    const m = /<div class="csv-expand-note">([\s\S]*?)<\/div>/.exec(h);
    t('the note is the reason block', !!m && m[1] === '<span class="scv-why"><span class="scv-why-r">Cùng số tiền, cùng ngày với một khoản trong sổ</span><span class="scv-why-t">“ZALOPAY” · 4 thg 7 12:38 · sổ Riêng tư</span></span>', m && m[1]);
    run(ctx, "csvExpand = { kind:'ready', idx:4 };");
    const m2 = /<div class="csv-expand-note">([\s\S]*?)<\/div>/.exec(body(ctx));
    t('a booked card keeps its own, longer note', !!m2 && /^Đã có trong sổ: cùng số tiền, cùng ngày, cùng nơi chi/.test(m2[1]), m2 && m2[1]);
  }
}

/* ═══ A3. skip all the open duplicate questions ══════════════════════════════ */
console.log('\n-- "Bỏ qua N khoản có thể trùng": arm, then carry out --');
{
  const ctx = scene(mk()); let h = body(ctx);
  t('the button names what it acts on and how many', />Bỏ qua 3 khoản có thể trùng<\/button>/.test(header(h)) && !/csv-linkbtn armed/.test(h), header(h));
  run(ctx, 'csvLikelySkipAll()'); h = ctx.document.getElementById('csv-result').innerHTML;
  t('one tap arms it: the label asks, with the count', /<button type="button" class="csv-linkbtn armed" onclick="csvLikelySkipAll\(\)">Bỏ qua 3 khoản\?<\/button>/.test(header(h)), header(h));
  t('and nothing has been removed or sent', run(ctx, 'csvReview.ready.length') === 7 && ctx.dropped.length === 0);
  run(ctx, 'csvStagedToggle(5)'); h = ctx.document.getElementById('csv-result').innerHTML;
  t('any other tap disarms it, and the header is repainted', run(ctx, 'csvLikelyArmed') === false && />Bỏ qua 3 khoản có thể trùng<\/button>/.test(header(h)) && !/csv-linkbtn armed/.test(h), header(h));
  run(ctx, 'csvLikelySkipAll(); csvToggleExpand("ready", 6);'); h = ctx.document.getElementById('csv-result').innerHTML;
  t('opening a card disarms it too', run(ctx, 'csvLikelyArmed') === false && !/csv-linkbtn armed/.test(h));
  run(ctx, 'csvToggleExpand("ready", 6); csvLikelySkipAll(); csvLikelySkipAll();'); h = ctx.document.getElementById('csv-result').innerHTML;
  t('two taps in a row carry it out: the three rows leave the queue', run(ctx, 'csvReview.ready.map(function(c){ return c.rowIndex; }).join(",")') === '3,4,5,6', run(ctx, 'csvReview.ready.map(function(c){ return c.rowIndex; }).join(",")'));
  t('one retire call, with exactly those three', ctx.dropped.length === 1 && ctx.dropped[0].join(',') === '0,1,2', ctx.dropped);
  t('the guessed-kind card stays, the header says 1, and the button is gone', /Cần bạn xem · 1</.test(header(h)) && card(h, 0) && !/csvLikelySkipAll/.test(h), header(h));
  t('the booked row and the dated list were not touched', /Đã có trong sổ · 1/.test(h) && count(h, /class="bulk-card/g) === 4, count(h, /class="bulk-card/g));
  return Promise.resolve().then(() => Promise.resolve()).then(() => {
    t('the toast says what happened, in the screen\'s words', ctx.toasts.length === 1 && ctx.toasts[0] === 'Đã bỏ qua 3 khoản có thể trùng', ctx.toasts);
    more();
  });
}
function more() {
  console.log('\n-- the button never claims less than it does --');
  {
    const ctx = scene(mk());
    run(ctx, "csvCatFilter = 'Ăn uống';");
    t('under a category filter it steps aside', !/csvLikelySkipAll/.test(body(ctx)));
    const ctx2 = scene(mk(), "rows = rows.filter(function(c){ return c._dupTier !== 'likely'; }).map(function(c, i){ c.rowIndex = i; return c; });");
    const h2 = body(ctx2);
    t('with no duplicate question in the section there is no button', /Cần bạn xem · 1</.test(header(h2)) && !/csvLikelySkipAll/.test(h2), header(h2));
    const ctx3 = scene(mk(), "rows = rows.filter(function(c){ return !c._srcAttn && c._dupTier !== 'likely'; }).map(function(c, i){ c.rowIndex = i; return c; });");
    t('with nothing to look at there is no section', !/csv-attn-h/.test(body(ctx3)));
  }

  console.log('\n-- a long section: the window draws 150, the header and the button count them all --');
  {
    const ctx = scene(mk(), `
      rows = [];
      for(var i = 0; i < 180; i++) rows.push(R(i, { description:'SHOP '+i, counterparty:'SHOP '+i, amount:10000 + i, dateDisplay:'2026-07-04', time:'10:00', _skipImport:true, _dupTier:'likely', _dupWhy:'exact_day',
        _dupTwin: ledger('L'+i, '2026-07-04', 10000 + i, 'x'), _dupTwinKind:'ledger' }));
      rows.push(R(180, { description:'GRAB', counterparty:'GRAB', amount:45000, dateDisplay:'2026-07-03', time:'18:22' }));`);
    let h = body(ctx);
    t('150 cards drawn, "Hiện thêm 30 khoản" offered', count(h, /class="scv-why"/g) === 150 && /Hiện thêm 30 khoản/.test(h), count(h, /class="scv-why"/g));
    t('the header says 180 and the button says 180', /Cần bạn xem · 180</.test(header(h)) && />Bỏ qua 180 khoản có thể trùng</.test(header(h)), header(h));
    run(ctx, 'csvLikelySkipAll(); csvLikelySkipAll();');
    t('carried out, it retires all 180, drawn or not', ctx.dropped.length === 1 && ctx.dropped[0].length === 180 && run(ctx, 'csvReview.ready.length') === 1, ctx.dropped[0] && ctx.dropped[0].length);
    const ctx2 = scene(mk(), `
      rows = [];
      for(var i = 0; i < 180; i++) rows.push(R(i, { description:'SHOP '+i, counterparty:'SHOP '+i, amount:10000 + i, dateDisplay:'2026-07-04', time:'10:00', _skipImport:true, _dupTier:'likely', _dupWhy:'exact_day', _dupTwin: ledger('L'+i, '2026-07-04', 10000 + i, 'x'), _dupTwinKind:'ledger' }));`);
    body(ctx2); run(ctx2, 'csvAttnToggle()');
    t('folded, a 180-card section costs no card at all', count(ctx2.document.getElementById('csv-result').innerHTML, /class="bulk-card/g) === 0);
  }

  console.log('\n-- one disarm for every armed thing; the patch never leaves a loaded header behind --');
  {
    const ctx = scene(mk()); body(ctx);
    run(ctx, 'csvLikelySkipAll()');
    t('csvDisarmRemove reports and clears it', run(ctx, 'csvDisarmRemove()') === true && run(ctx, 'csvLikelyArmed') === false);
    run(ctx, 'csvBulkArmed = true; csvLikelySkipAll();');
    t('arming the skip-all disarms the bulk delete', run(ctx, 'csvBulkArmed') === false && run(ctx, 'csvLikelyArmed') === true);
    /* The in-place card swap (csvCardPatch) repaints cards and nothing else, so it
       must stand down while the body still shows an armed header. Flat card stubs
       here, as in heat-queue-render: the swap finds a card by its data-ck. */
    const c2 = scene(mk());
    run(c2, `csvCollapsedCard = function(c, o){ return '<div class="bulk-card" data-ck="'+(o.key||'')+'"></div>'; };
             csvActiveCard = function(c, o){ return '<div class="bulk-card active" data-ck="'+(o.key||'')+'"></div>'; };`);
    body(c2);
    t('with a calm header the swap works (the control)', run(c2, 'csvCardPatch([5])') === true);
    run(c2, 'csvLikelySkipAll(); csvLikelyArmed = false;');
    t('csvCardPatch refuses while the painted header is still armed', run(c2, 'csvCardPatch([5])') === false);
  }

  console.log('\n-- the file-import flow is not touched --');
  {
    const ctx = scene(mk());
    run(ctx, "csvStagedMode = false; csvReview.groups = [{ key:'k', items:[csvReview.ready[5]] }]; csvReview.ready = [csvReview.ready[6]];");
    const h = body(ctx);
    t('its "Cần bạn xem" is the plain header, with no fold and no button', /<div class="group-h attn">Cần bạn xem<\/div>/.test(h) && !/csv-fold/.test(h) && !/csvLikelySkipAll/.test(h), h.slice(0, 200));
  }

  console.log('\n-- a fresh review starts with the section open --');
  {
    const src = rd('src/js-ui/56-csv-import-ui.js');
    const at = src.indexOf('function csvBuildReview('), blk = src.slice(at, at + 1200);
    t('csvBuildReview unfolds it unless the view is being kept', /if\(!opts\.keepView\)\{[^}]*csvAttnFold = false;[^}]*\}/.test(blk));
    t('and never carries an armed skip-all across a rebuild', /csvLikelyArmed = false;/.test(blk));
  }

  console.log('\n' + (fail === 0 ? 'ALL ' + pass + ' PASSED' : pass + ' passed, ' + fail + ' FAILED'));
  process.exit(fail ? 1 : 0);
}
