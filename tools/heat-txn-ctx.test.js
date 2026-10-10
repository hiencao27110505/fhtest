#!/usr/bin/env node
/* _pBuildTxnCtx (60-transactions.js) normalises the personal ledger into the
 * Giao dịch screen's row shape. It used to scan the whole ledger once per
 * transfer pair and once per loan row (O(n²), on every open and every edit);
 * it now builds three lookups in one pre-pass. This pins that the output did
 * not move: the PRE-CHANGE function body is kept below, verbatim, as the
 * oracle, and both run over the same 500-row fixture in the same vm context.
 * `node tools/heat-txn-ctx.test.js`
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');
const SRC = fs.readFileSync(path.join(__dirname, '..', 'src/js-ui/60-transactions.js'), 'utf8');

let n = 0;
const t = (name, fn) => { fn(); n++; console.log('  ✓ ' + name); };

/* ── the new function, cut from the source file ── */
const start = SRC.indexOf('function _pBuildTxnCtx(){');
const end = SRC.indexOf('\nfunction txRow(t){', start);
assert.ok(start > 0 && end > start, '_pBuildTxnCtx found in 60-transactions.js');
const NEW_SRC = SRC.slice(start, end);
assert.ok(/new Map\(\)/.test(NEW_SRC), 'the new body builds Maps');
assert.ok(!/txs\.forEach\(function\(x\)\{ if\(x\.kind==='transfer'&&x\.transferGroupId===t\.transferGroupId\)/.test(NEW_SRC), 'the per-pair inner scan is gone');
assert.ok(!/\.filter\(function\(d\)\{ return d\.id===t\.id; \}\)\[0\]/.test(NEW_SRC), 'the per-loan debts filter is gone');

/* ── the oracle: the function as it was before the change, body verbatim
      (only renamed, and returning the ctx instead of assigning _pTxnCtx) ── */
function _pBuildTxnCtxOld(){
  var P = window.fhPersonalData ? fhPersonalData() : null;
  var PAL=[1,2,3,4,5,6].map(function(n){ return 'var(--id-'+n+'-tint)'; });
  var rows=[], style={}, order=[], spent={}, other=L('Khác','Others');
  var now=new Date(), ym=now.getFullYear()+'-'+String(now.getMonth()+1).padStart(2,'0');
  /* the 2-month tab window + the on-demand months 3–6 (fhPersonalFetchOlder) */
  var txs=((P&&P.txns)||[]).concat((P&&P.txnsOld)||[]);
  var acctName=function(id){ var a=id&&(P&&P.accounts||[]).find(function(x){ return x.id===id; }); return a?(a.name||L('Tài khoản','Account')):null; };
  var K_INC=L('Thu nhập','Income'), K_XFER=L('Chuyển khoản','Transfers'), K_DEBT=L('Cho vay & nợ','Loans & debts'), K_INV=L('Đầu tư','Investments');
  var kstyle={}; kstyle[K_INC]=['💰','#eefaf3','var(--good)']; kstyle[K_XFER]=['🔁','#eef4fb','var(--cat-other)']; kstyle[K_DEBT]=['💵','#fdf4e8','var(--cat-other)']; kstyle[K_INV]=['📈','#f6eefb','var(--cat-other)'];
  var kindOrder=[], kseen={}, seenXfer={}, treeRows=[];
  txs.forEach(function(t){
    if(t._unreadable) return;
    var _d=t.date?new Date(t.date+'T00:00:00'):null;
    if(t.kind==='expense'){
      /* While the person's partition is nothing but a catch-all, every row would
         read "Khác" — so the tree's own name for the row's group stands in
         (fhPersonalRowLabel, display only, nothing written). */
      var _rl=(typeof fhPersonalRowLabel==='function')?fhPersonalRowLabel(t):null;
      var cat=(_rl&&_rl.name)||t.cat||other, _ico=(_rl&&_rl.emoji)||t.emoji||'🗂️';
      if(!style[cat]){ style[cat]=[_ico, PAL[order.length%PAL.length], 'var(--cat-other)']; order.push(cat); }
      // Only PRIVATE rows are editable here; mirror rows (spaceId/linkId set) are a
      // family expense shown in the personal book — write-inert, but tappable
      // since 0114 (fhMirrorRowTap → the family expense detail, M10).
      var eOpen=(t.spaceId||t.linkId)?(t.spaceId?"fhMirrorRowTap('"+t.id+"')":''):"openPersonalTxDetail('"+t.id+"')";
      /* _kg/_net/_src/_acct feed the Giao dịch screen's filters + net heads:
         expense = money out (0109 stores it positive), so its cash flow is −amt. */
      rows.push({ id:t.id, cat:cat, note:t.note||cat, amt:t.amt||0, _d:_d, ico:_ico, who:null, _style:style[cat], _open:eOpen, photos:t.photos||undefined, time:t.time||null, hasReceipt:t.hasReceipt||undefined,
        node:t.node||null,                                      // 0144 — what the tree filter and the chip sheet read
        _cp:t.who||null,                                        // P5/A15 — a personal row's payee is `who` (counterparty_enc); the person filter ('@key') keys on this
        _kg:'chi', _net:-(t.amt||0), _src:t.src||null, _acct:t.accountId||null, _mirror:!!(t.spaceId||t.linkId) });
      if((t.date||'').slice(0,7)===ym){
        /* Not spending → out of the label totals too, so "Danh mục của tôi" and
           "Tiêu vào gì" add up to the same money. treeRows still gets the row:
           the tree shows it under "Không tính là chi tiêu" rather than hiding it. */
        if(fhCountsAsSpending(t.node)) spent[cat]=(spent[cat]||0)+(t.amt||0);   // hero = this month only (parity with family M())
        treeRows.push({ node:t.node||null, amt:t.amt||0, cp:t.who||null, note:t.note||null });   // 0144: the SAME rows, so both views of this card agree; cp/note feed the person rows under p2p (P1, A15: who = payee on a personal row)
      }
      return;
    }
    var kcat, note, sign='', cls='xfer', open='', ico=null;
    /* cash-flow of a non-expense row (23-debts-ui:1114 sign law):
       loan negates its amount (lent > 0 = money out); everything else is
       already signed. A folded transfer PAIR nets 0 by construction. */
    var kg='ck', netv=(t.amt||0);
    if(t.kind==='income'){ kg='thu'; }
    else if(t.kind==='loan'){ kg='vay'; netv=-(t.amt||0); }
    else if(t.kind==='repayment'){ kg='vay'; }
    else if(t.kind==='investment'){ kg='dautu'; }
    if(t.kind==='income'){
      kcat=K_INC; note=t.note||t.cat||K_INC; sign='+'; cls='pos'; ico=t.emoji||'💰';
      open="openPersonalTxDetail('"+t.id+"')";
    } else if(t.kind==='transfer'){
      kcat=K_XFER;
      if(t.transferGroupId){
        if(seenXfer[t.transferGroupId]) return;             // second leg of a pair already listed
        seenXfer[t.transferGroupId]=1;
        netv=0;                                             // the pair's two legs cancel
        var from=null,to=null;
        txs.forEach(function(x){ if(x.kind==='transfer'&&x.transferGroupId===t.transferGroupId){ if((x.amt||0)<0) from=x.accountId; else to=x.accountId; } });
        var fn=acctName(from), tn=acctName(to);
        note=(fn&&tn)?(fn+' → '+tn):(t.note||K_XFER);
        open="openPersonalTransferDetail('"+t.transferGroupId+"')";
      } else {
        // legacy one-leg transfer = a card payment tagged to the card (0105) — no pair sheet
        var cn=acctName(t.accountId);
        note=t.note||(cn?L('Trả nợ thẻ ','Card payment ')+cn:L('Chuyển khoản','Transfer'));
      }
    } else if(t.kind==='loan'||t.kind==='repayment'){
      kcat=K_DEBT; ico=(t.kind==='loan')?'💵':'✅';
      var dR=(P&&P.debts||[]).filter(function(d){ return d.id===t.id; })[0];
      var who=(dR&&dR.who)?(' · '+dR.who):'';
      note=(t.note||(t.kind==='loan'?((t.amt||0)>0?L('Cho vay','Lent'):L('Đi mượn','Borrowed')):L('Trả nợ','Repayment')))+who;
      open="openPersonalTxDetail('"+t.id+"')";
    } else if(t.kind==='investment'){
      kcat=K_INV;
      var pos=(P&&P.accounts||[]).find(function(a){ return a.id===t.positionId; });
      note=((t.amt||0)>0?L('Bán','Sell'):L('Mua','Buy'))+(pos&&pos.name?' '+pos.name:L(' đầu tư',' investment'));
      open="openPersonalTxDetail('"+t.id+"')";
    } else return;
    if(!kseen[kcat]){ kseen[kcat]=1; kindOrder.push(kcat); }
    rows.push({ id:t.id, cat:kcat, note:note, amt:Math.abs(t.amt||0), _d:_d, ico:ico||kstyle[kcat][0], who:null, _style:kstyle[kcat], _open:open, _sign:sign, _amtCls:cls, time:t.time||null,
      node:t.node||null,
      _kg:kg, _net:netv, _src:t.src||null, _acct:t.accountId||null });
  });
  order.sort(function(a,b){ return (spent[b]||0)-(spent[a]||0); });
  /* account names for the Nguồn tiền filter section (personal only) */
  var acctDefs=((P&&P.accounts)||[]).map(function(a){ return { k:a.id, lbl:a.name||L('Tài khoản','Account') }; });
  return { rows:rows, catOrder:order, catStyle:style, catSpent:spent, catBudget:(P&&P.catBudget)||{}, kindOrder:kindOrder, acctDefs:acctDefs, treeRows:treeRows };
}

/* ── fixture: 500 personal rows across every kind the loop handles ── */
function fixture(seed) {
  let s = seed;
  const rnd = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  const now = new Date();
  const ym = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
  const date = () => {
    if (rnd() < 0.5) return ym + '-' + String(1 + Math.floor(rnd() * 28)).padStart(2, '0');
    const d = new Date(now.getFullYear(), now.getMonth() - 1 - Math.floor(rnd() * 5), 1 + Math.floor(rnd() * 27));
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  };
  const accounts = [
    { id: 'a1', name: 'VIB' }, { id: 'a2', name: 'VCB' }, { id: 'a3', name: null }, { id: 'a4', name: 'Momo' },
    { id: 'a1', name: 'DUPLICATE id: the first must win' },
    { id: 'p1', name: 'VN30 ETF' }, { id: 'p2' },
  ];
  const cats = ['Ăn uống', 'Đi lại', 'Nhà cửa', 'Mua sắm', 'Khác'];
  const nodes = ['coffee', 'grocery', null, 'xfer', 'transport', undefined];
  const txns = [], old = [], debts = [];
  let id = 1, grp = 1;
  for (let i = 0; i < 500; i++) {
    const r = rnd(), row = { id: 't' + (id++), date: date(), time: rnd() < 0.6 ? (String(Math.floor(rnd() * 24)).padStart(2, '0') + ':15') : null, note: rnd() < 0.8 ? ('note ' + i) : '', src: pick([null, 'email', 'csv-import']) };
    if (r < 0.55) {
      Object.assign(row, { kind: 'expense', amt: Math.round(rnd() * 900) / 1 + 10, cat: rnd() < 0.9 ? pick(cats) : null, emoji: rnd() < 0.7 ? '🍜' : null, node: pick(nodes), who: rnd() < 0.3 ? 'Chị Lan' : null, accountId: pick(['a1', 'a2', null]), photos: rnd() < 0.2 ? ['https://x/p.jpg.enc'] : undefined, hasReceipt: rnd() < 0.1 });
      if (rnd() < 0.08) row.spaceId = 'sp1';
      if (rnd() < 0.05) row.linkId = 'lk1';
      if (rnd() < 0.03) row._unreadable = true;
    } else if (r < 0.65) {
      Object.assign(row, { kind: 'income', amt: Math.round(rnd() * 5000) + 100, cat: rnd() < 0.5 ? 'Lương' : null, emoji: rnd() < 0.5 ? '💰' : null, accountId: 'a1', node: null });
    } else if (r < 0.80) {
      /* a transfer PAIR (sometimes a stray third leg, to exercise last-leg-wins) */
      const g = 'g' + (grp++), amt = Math.round(rnd() * 2000) + 50, from = pick(['a1', 'a2', 'a3', 'a4']), to = pick(['a1', 'a2', 'a3', 'a4']);
      Object.assign(row, { kind: 'transfer', amt: -amt, transferGroupId: g, accountId: from, note: rnd() < 0.5 ? row.note : '' });
      txns.push({ id: 't' + (id++), kind: 'transfer', amt: amt, transferGroupId: g, accountId: to, date: row.date, time: row.time, src: row.src });
      if (rnd() < 0.15) txns.push({ id: 't' + (id++), kind: 'transfer', amt: -amt, transferGroupId: g, accountId: 'a4', date: row.date, time: null, src: null });
    } else if (r < 0.84) {
      Object.assign(row, { kind: 'transfer', amt: -(Math.round(rnd() * 800) + 20), accountId: pick(['a1', 'a3', 'zz', null]) });   // legacy one-leg card payment
    } else if (r < 0.90) {
      Object.assign(row, { kind: 'loan', amt: (rnd() < 0.5 ? 1 : -1) * (Math.round(rnd() * 3000) + 100), note: rnd() < 0.5 ? row.note : '' });
      if (rnd() < 0.7) debts.push({ id: row.id, who: 'Anh Tú' });
      if (rnd() < 0.2) debts.push({ id: row.id, who: 'DUPLICATE: the first must win' });
    } else if (r < 0.95) {
      Object.assign(row, { kind: 'repayment', amt: Math.round(rnd() * 1000) + 10, note: rnd() < 0.5 ? row.note : '' });
      if (rnd() < 0.5) debts.push({ id: row.id, who: 'Cô Hoa' });
    } else if (r < 0.985) {
      Object.assign(row, { kind: 'investment', amt: (rnd() < 0.5 ? 1 : -1) * (Math.round(rnd() * 4000) + 100), positionId: pick(['p1', 'p2', 'none', undefined]) });
    } else {
      Object.assign(row, { kind: 'mystery', amt: 1 });   // an unknown kind is skipped
    }
    (rnd() < 0.2 ? old : txns).push(row);
  }
  return { txns, txnsOld: old, accounts, debts, catBudget: { 'Ăn uống': 300 } };
}

/* ── run both in one vm context with the same stubs ── */
function run(P, rowLabel) {
  const ctx = {
    L: (vi) => vi,
    fhCountsAsSpending: (node) => node !== 'xfer',
    fhPersonalData: () => P,
    console,
  };
  if (rowLabel) ctx.fhPersonalRowLabel = (t) => (t.node === 'coffee' ? { name: 'Cà phê', emoji: '☕' } : null);
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext('var _pTxnCtx=null;\n' + NEW_SRC + '\n' + _pBuildTxnCtxOld.toString(), ctx);
  ctx._pBuildTxnCtx();
  return { fresh: ctx._pTxnCtx, old: ctx._pBuildTxnCtxOld() };
}

for (const seed of [7, 2026, 99991]) {
  const P = fixture(seed);
  const total = P.txns.length + P.txnsOld.length;
  t('seed ' + seed + ': ' + total + ' rows, no row-label hook: new ctx equals the oracle', () => {
    const r = run(P, false);
    assert.ok(r.old.rows.length > 300, 'fixture produces rows (' + r.old.rows.length + ')');
    assert.ok(r.old.rows.some((x) => /→/.test(x.note)), 'fixture has named transfer pairs');
    assert.ok(r.old.rows.some((x) => / · Anh Tú$/.test(x.note)), 'fixture has loans with a debt counterparty');
    assert.deepStrictEqual(r.fresh, r.old);
  });
  t('seed ' + seed + ': with fhPersonalRowLabel: new ctx equals the oracle', () => {
    const r = run(P, true);
    assert.ok(r.old.catOrder.indexOf('Cà phê') >= 0, 'the tree name stands in for a label');
    assert.deepStrictEqual(r.fresh, r.old);
  });
}

t('an empty ledger and a missing fhPersonalData both agree', () => {
  const a = run({ txns: [], txnsOld: [], accounts: [], debts: [] }, false);
  assert.deepStrictEqual(a.fresh, a.old);
  const ctx = { L: (vi) => vi, fhCountsAsSpending: () => true, console };
  ctx.window = ctx; vm.createContext(ctx);
  vm.runInContext('var _pTxnCtx=null;\n' + NEW_SRC + '\n' + _pBuildTxnCtxOld.toString(), ctx);
  ctx._pBuildTxnCtx();
  assert.deepStrictEqual(ctx._pTxnCtx, ctx._pBuildTxnCtxOld());
});

console.log('\nALL ' + n + ' checks passed');
