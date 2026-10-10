/* Statement balance (docs/specs/statement-balance-spec.md): what an account looks
   like when its number came from a statement.
   node tools/ui-harness/shots.js tools/ui-harness/manifests/statement-balance.js --langs vi --themes sage

   The seed writes straight into the personal snapshot the harness painted (the
   harness hangs personal reads, so nothing replaces it): accounts in every state
   the spec names, and ledger rows around each statement's last day. */
const SEED = `(function(){
  var P = fhPersonalData();
  var iso = function(d){ return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); };
  var day = function(n){ var d = new Date(); d.setDate(d.getDate()+n); return iso(d); };
  var asof = day(-12), from = day(-42);
  var meta = function(state, k, open, rows, how){ return { v:1, src:'stmt', state:state, k:k, sid:'S', asof:asof, from:from, open:open, how:how||'closing', rows:rows }; };
  var at = fhAnchorAtOf(asof);
  var acct = function(o){ return Object.assign({ tail:'', provider:'', providerKey:null, humanVerified:true, statementDay:null, dueDay:null, limitK:null,
    anchorK:null, anchorAt:null, extK:null, extDate:null, setupSkippedAt:null, anchorMeta:null, assetSymbol:null, assetUnit:null, assetClass:null, manualPriceK:null, manualPriceAt:null, accountNumber:null }, o); };
  var fileB = [[day(-30), 18000000], [day(-25), -2000000], [day(-20), -350000], [day(-14), -80000]];
  P.accounts = [
    acct({ id:'a-vib', kind:'deposit', name:'VIB ••5140', anchorMeta: meta('offer', 132615.72, 1, fileB) }),
    acct({ id:'a-card', kind:'credit_card', name:'VIB ••4751', limitK:200000, statementDay:31, dueDay:25, anchorMeta: meta('offer', -253.9, 5, [[day(-13), -253900]], 'debt') }),
    acct({ id:'a-momo', kind:'ewallet', name:'MoMo ••1217', anchorK:3003.878, anchorAt:at, anchorMeta: meta('set', 3003.878, 1, [[day(-12), -39000]], 'chain') }),
    acct({ id:'a-vcb', kind:'deposit', name:'Vietcombank ••2279', anchorK:48200, anchorAt:at, anchorMeta: meta('set', 48200, 1, fileB) }),
    acct({ id:'a-tcb', kind:'deposit', name:'Techcombank ••8890', anchorK:76400, anchorAt:at, anchorMeta: meta('set', 76400, 1, fileB) }),
    acct({ id:'a-vp', kind:'credit_card', name:'VPBank ••3321', limitK:60000, statementDay:20, dueDay:5, anchorK:-4120.5, anchorAt:at, anchorMeta: meta('set', -4120.5, 5, [[day(-20), -350000], [day(-14), -80000]], 'debt') }),
    acct({ id:'a-cash', kind:'cash', name:'Tiền mặt', anchorK:1250, anchorAt:new Date().toISOString() })
  ];
  var n = 0;
  var row = function(a, d, kind, amt, src, note){ return { id:'r'+(++n), accountId:a, date:d, kind:kind, amt:amt, ts:d+'T05:00:00.000Z', src:src||'direct-email', note:note||'', cat:'', emoji:'🧾', who:null, transferGroupId:null, positionId:null, qty:null, _unreadable:false }; };
  P.debts = [
    /* Vietcombank: the ledger already knew every row of the file, and three came after */
    row('a-vcb', day(-30), 'income', 18000, null, 'Lương'), row('a-vcb', day(-25), 'expense', 2000, null, 'Tiền nhà'),
    row('a-vcb', day(-20), 'expense', 350, null, 'Điện'), row('a-vcb', day(-14), 'expense', 80, null, 'Cà phê'),
    row('a-vcb', day(-8), 'expense', 420, null, 'Siêu thị'), row('a-vcb', day(-5), 'expense', 95, null, 'Grab'), row('a-vcb', day(-2), 'expense', 1300, null, 'Bảo hiểm'),
    /* Techcombank: only the money out was known (the pay never reached the ledger), and two came after */
    row('a-tcb', day(-25), 'expense', 2000, null, 'Tiền nhà'), row('a-tcb', day(-20), 'expense', 350, null, 'Điện'), row('a-tcb', day(-14), 'expense', 80, null, 'Cà phê'),
    row('a-tcb', day(-6), 'expense', 3900, null, 'Học phí'), row('a-tcb', day(-3), 'expense', 300, null, 'Xăng'),
    /* VPBank card: everything on the statement known, two purchases since */
    row('a-vp', day(-20), 'expense', 350, null, 'Shopee'), row('a-vp', day(-14), 'expense', 80, null, 'Highlands'),
    row('a-vp', day(-7), 'expense', 890, null, 'Uniqlo'), row('a-vp', day(-1), 'expense', 215, null, 'Foody')
  ];
  if (window.fhPersonalMatchSliceInvalidate) { try { fhPersonalMatchSliceInvalidate(); } catch (e) {} }
  /* the harness leaves the ledger 'loading' behind its painted snapshot, and a
     loading tab keeps the view it has: say ready so the seed is what gets drawn */
  P.state = 'ready';
  go('personal'); renderPersonal();
})();`;
/* The Tài sản tiles sit below the fold: scroll whichever ancestor actually scrolls.
   Everything waits a beat after the seed: the tab paints its sections on the next
   frame, and the account screens read the totals that paint computed. */
const after = (js) => SEED + 'setTimeout(function(){' + js + '}, 350);';
const TILES = after(`var b = document.getElementById('pers-debts-h'); if (!b) return;
  for (var e = b.parentElement; e; e = e.parentElement) { var cs = getComputedStyle(e);
    if (/(auto|scroll)/.test(cs.overflowY) && e.scrollHeight > e.clientHeight + 4) { e.scrollTop += b.getBoundingClientRect().top - e.getBoundingClientRect().top - 24; return; } }
  window.scrollTo(0, window.scrollY + b.getBoundingClientRect().top - 24);`);

module.exports = {
  feature: 'statement-balance',
  langs: ['vi'],
  themes: ['sage'],
  shots: [
    { name: 'tiles',           setup: TILES, settleMs: 1100 },
    { name: 'wizard-account',  setup: after(`fhAcctSetupWizard(['a-vib'], { intro: true });`), settleMs: 1100 },
    { name: 'wizard-card',     setup: after(`fhAcctSetupWizard(['a-card']);`), settleMs: 1100 },
    { name: 'account-covered', setup: after(`openBalAccount('a-vcb');`), settleMs: 1100 },
    { name: 'account-dated',   setup: after(`openBalAccount('a-tcb');`), settleMs: 1100 },
    { name: 'card-statement',  setup: after(`openDebtAccount('a-vp');`), settleMs: 1100 }
  ]
};
