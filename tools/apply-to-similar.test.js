#!/usr/bin/env node
/* Corrections that carry. `node tools/apply-to-similar.test.js`
 *
 * One edit on one queue card stays visible under a filter (A1), can be carried to the
 * payee's other cards in every bucket without moving them (A2, A12, A14), teaches one
 * lesson per row at that row's own band and nothing wider (A5), and is fully undone —
 * rows and lessons — by one tap (A11). Plus A15: a personal row's payee is `who`, and
 * fhPersonKeyRow must never read it because on a family row `who` is the member.
 * (docs/specs/apply-to-similar-spec.md). Real functions, sliced whole from 56/57, over
 * the real tree and the real person key.
 *
 * 2026-10-02 (A16–A21): the block is the ONE carry surface. Edits stack, one line and
 * one undo per field (A17); a row the person set by hand is never overwritten (A18);
 * the count can be looked at first (A19); Loại khoản carries with its follow-up, over
 * the ready list only (A16); a row with no payee falls back to its wording (A20); the
 * bottom bar's "Áp cho N khoản giống" is gone (A21).
 *
 * 2026-10-02, later (A22, A23, L1–L7): the card shows a dot on changed rows and ONE
 * full-width button in the bottom bar; a sheet lists what changes and which rows,
 * each tickable; the same sheet serves the ledger detail after Lưu.
 */
const fs=require('fs'),vm=require('vm'),path=require('path');
const ROOT=path.join(__dirname,'..');
let pass=0,fail=0; const t=(n,ok,d)=>{console.log((ok?'  PASS  ':'  FAIL  ')+n+(!ok&&d!==undefined?'  -> '+JSON.stringify(d):'')); ok?pass++:fail++;};
const rd=f=>fs.readFileSync(path.join(ROOT,f),'utf8');
const sliceFn=(src,name)=>{const k=src.indexOf('function '+name+'('); if(k<0) throw new Error('no '+name); return src.slice(k,src.indexOf('\n}',k)+2);};
const sliceVar=(src,name)=>{const m=src.match(new RegExp('^var '+name+' = .*$','m')); if(!m) throw new Error('no var '+name); return m[0];};
const S56=rd('src/js-ui/56-csv-import-ui.js'), S57=rd('src/js-ui/57-csv-import-review.js');

function mk(){
  const ctx={window:{csvStagedMode:false},localStorage:{getItem:()=>null,setItem:()=>{}},L:v=>v,console,renders:0,
    deburr:s=>String(s||'').normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/đ/g,'d').replace(/Đ/g,'D'),
    curMult:()=>1000, esc:s=>String(s), escAttr:s=>String(s), fmt:n=>String(n), csvCatLabel:s=>String(s), csvTxrLbl:s=>String(s),
    csvTreeLeafOf:()=>({leaf:'Y'}), navigator:{onLine:true}, clearTimeout:()=>{}, setTimeout:()=>0};
  vm.createContext(ctx);
  vm.runInContext(rd('src/js-ui/11-taxonomy.js'),ctx); vm.runInContext(rd('src/js-ui/13-partition.js'),ctx);
  ctx.window.FH_TAX=ctx.FH_TAX;
  // the key's halves and the label store, whole, from 57
  vm.runInContext([sliceVar(S57,'CSV_GATEWAYS'),sliceVar(S57,'CSV_BANK_NOISE'),sliceFn(S57,'csvPatternKey'),sliceFn(S57,'csvAmountBand'),
    sliceFn(S57,'csvLearnKeyBase'),sliceFn(S57,'csvLearnKey'),sliceVar(S57,'csvLearned'),'function csvLearnSave(){ globalThis.saves=(globalThis.saves||0)+1; }'].join('\n'),ctx);
  // a tiny node-lesson store keyed by the REAL person key, so bands are real
  // In the browser window === globalThis, so the file guards on window.x and then calls x bare; the vm
  // context has a plain `window` object, so the stubs must exist both ways.
  vm.runInContext(`var LESS={}; var lk=function(i){ return fhPersonKey(i.counterparty,i.memo,i.amount); };
    function fhLessonNode(i){ return LESS[lk(i)]||null; }
    function fhLessonLearnNode(i){ LESS[lk(i)]=i.node; }
    function fhLessonForgetNode(i){ delete LESS[lk(i)]; }
    window.fhLessonNode=fhLessonNode; window.fhLessonLearnNode=fhLessonLearnNode; window.fhLessonForgetNode=fhLessonForgetNode;
    function fhSyncMerchantCorrection(){} function renderCsvReview(){ renders++; } var csvReview=null; var csvCatFilter=null;
    function csvStagedProvider(c){ return c._bank||''; } function csvRowScope(c){ return c._scope||'personal'; }
    var CARDS=[{id:'card1',name:'VIB thẻ'}], ACCTS=[{id:'acc1',name:'VCB ••1234'},{id:'acc2',name:'MB ••9'}];
    function csvCreditCards(){ return CARDS; } function csvInvPositions(){ return []; }
    function csvXferAccounts(r){ return ACCTS.filter(function(a){ return a.id!==r._ownAcct; }); }
    function csvPayCardFor(r){ return r._payCardId || r._mailCard || ''; }
    function csvAmtDisp(r){ return String(r.amount); } function csvExpandedCandidate(){ return null; } var csvRowSheet=null;`,ctx);
  // the machinery, whole, from 56
  const fns=['csvScopeClearKinds','csvNodeNotSpending','csvRowGroup','csvPersonKeyOf','csvIsP2P','csvCatHide','csvRowKindCur','csvSimKey','csvHandMark','csvFixKindRow',
    'csvFixKey','csvFixPayee','csvKindLbl','csvFixKindLabel','csvFixValLabel','csvFixSnap','csvFixRestore','csvFixLessonPrev','csvFixTeach','csvFixUnteach',
    'csvFixHolds','csvFixPrune','csvFixDrop','csvFixRecord','csvFixKindTouch','csvFixClearAll','csvFixCandidates','csvFixXferOk','csvFixKindSame','csvFixKindCopy',
    'csvFixSame','csvFixRowsFor','csvFixPending','csvFixSimilar','csvFixAppliedRows','csvFixApply','csvFixUnapply','csvFixUndo','csvFixPayeeName',
    'csvFixLedgerScan','csvFixLedgerItems','csvFixLedgerCount','csvFixSheetRows','csvFixBarBtnHTML','csvFixTick','fhCarryBodyHTML','csvFixRowWhen','csvFixRowWas','csvFixSheetHTML'];
  vm.runInContext([sliceVar(S56,'csvPersonFilter'),sliceVar(S56,'csvFixes'),sliceVar(S56,'CSV_FIX_LBL'),sliceVar(S56,'CSV_FIX_ORDER')].join('\n')+'\n'+fns.map(n=>sliceFn(S56,n)).join('\n'),ctx);
  return ctx;
}
const P='13610000120606 - LE KHA NIN';
function seed(c){
  return vm.runInContext(`(function(){
    var A0={_node:'p2p',counterparty:'${P}',description:'Cam on anh',amount:5000000};
    var A1={_node:null,counterparty:'1361 - LE KHA NIN',description:'ca phe',amount:16000};
    var A2={_node:'p2p',counterparty:'${P}',description:'',amount:200000};
    var A3={_node:'p2p',counterparty:'${P}',description:'',amount:300000,isIncome:true};
    var A4={_node:'p2p',counterparty:'${P}',description:'gop tien',amount:3000000};
    var K ={_node:'p2p',counterparty:'${P}',description:'',amount:5000000,_xfer:true};
    var B ={_node:'p2p',counterparty:'VO DINH PHUC 0912',description:'',amount:5000000};
    csvReview={ready:[A0,A1,K,B], groups:[{key:'g',items:[A4]}], dup:[{c:A2,resolved:null}], deferred:[A3]};
    return {A0:A0,A1:A1,A2:A2,A3:A3,A4:A4,K:K,B:B}; })()`,c);
}

console.log('\n-- similar: same payee, any size, every bucket, never a kind row, same direction --');
{
  const c=mk(); const R=seed(c); c.__R=R;
  const r=vm.runInContext(`(function(R){
    R.A0._node='rent'; csvFixRecord(R.A0,'node','rent',{_node:'p2p'},null);
    var s=csvFixSimilar(R.A0);
    return { n:s.length, hasA1:s.indexOf(R.A1)>=0, hasA2:s.indexOf(R.A2)>=0, hasA4:s.indexOf(R.A4)>=0, hasA3:s.indexOf(R.A3)>=0, hasK:s.indexOf(R.K)>=0, hasB:s.indexOf(R.B)>=0, self:s.indexOf(R.A0)>=0 };
  })(__R)`,c);
  t('three cards from the payee, across ready, a merchant group and the duplicates bucket', r.n===3 && r.hasA1 && r.hasA2 && r.hasA4, r);
  t('the card itself, another payee, a transfer leg and money-in are not similar', !r.self && !r.hasB && !r.hasK && !r.hasA3, r);
}

console.log('\n-- apply: the field moves, the bucket does not, one lesson per band touched (A5, A14) --');
{
  const c=mk(); const R=seed(c); c.__R=R;
  const r=vm.runInContext(`(function(R){
    LESS['le kha nin|b']='coffee';                       // a lesson that already existed at the 200k band
    R.A0._node='rent'; csvFixRecord(R.A0,'node','rent',{_node:'p2p'},null);
    csvFixApply(R.A0._fix.id);
    return { nodes:[R.A1._node,R.A2._node,R.A4._node,R.K._node,R.B._node,R.A3._node], src:[R.A1._nodeSource,R.A2._nodeSource],
      dupStill:csvReview.dup[0].c===R.A2, deferStill:csvReview.deferred[0]===R.A3, groupStill:csvReview.groups[0].items[0]===R.A4,
      less:Object.assign({},LESS), applied:R.A0._fix.items.node.applied.rows.length };
  })(__R)`,c);
  t('the three similar rows take the node, marked as the person\'s pick', JSON.stringify(r.nodes.slice(0,3))==='["rent","rent","rent"]' && r.src.every(s=>s==='user'), r);
  t('untouched: the transfer leg, the other payee, the money-in row', r.nodes[3]==='p2p' && r.nodes[4]==='p2p' && r.nodes[5]==='p2p', r.nodes);
  t('nothing left its bucket (A14): dup stays dup, deferred stays deferred, group stays group', r.dupStill && r.deferStill && r.groupStill, r);
  t('one lesson per band actually touched: a (16k), b (200k), c (3tr) — and no d beyond the card\'s own', r.less['le kha nin|a']==='rent' && r.less['le kha nin|b']==='rent' && r.less['le kha nin|c']==='rent', r.less);
  t('the pre-existing 200k lesson was overwritten by the apply (it will be restored on undo)', r.less['le kha nin|b']==='rent' && r.applied===3, r.less);
}

console.log('\n-- undo: rows back, lessons back — a previous lesson restored, a fresh one forgotten (A11) --');
{
  const c=mk(); const R=seed(c); c.__R=R;
  const r=vm.runInContext(`(function(R){
    LESS['le kha nin|b']='coffee';
    var snap=csvFixSnap(R.A0,'node'), lp=csvFixLessonPrev('node',R.A0);
    R.A0._node='rent'; R.A0._nodeSource='user';   // the real flow: snapshot, then the pick writes, then the record
    csvFixRecord(R.A0,'node','rent',snap,lp);
    var id=R.A0._fix.id; csvFixApply(id); csvFixUndo(id,'node');
    return { card:[R.A0._node,R.A0._nodeSource], rows:[R.A1._node,R.A2._node,R.A4._node], less:Object.assign({},LESS), fixGone:!R.A0._fix, reg:Object.keys(csvFixes).length };
  })(__R)`,c);
  t('the card and the three rows are back to what they were', r.card[0]==='p2p' && JSON.stringify(r.rows)==='[null,"p2p","p2p"]', r);
  t('the 200k lesson is "coffee" again; the fresh 16k and 3tr lessons are gone', r.less['le kha nin|b']==='coffee' && !('le kha nin|a' in r.less) && !('le kha nin|c' in r.less), r.less);
  t('the block is gone and the registry is empty', r.fixGone && r.reg===0, r);
}

console.log('\n-- a label carried writes the banded key only, never the bare cross-size key (A5) --');
{
  const c=mk(); const R=seed(c); c.__R=R;
  const r=vm.runInContext(`(function(R){
    var sc=csvFixSnap(R.A0,'cat'), lc=csvFixLessonPrev('cat',R.A0); R.A0.categoryName='Nhà ở';
    csvFixRecord(R.A0,'cat','Nhà ở',sc,lc);
    csvFixApply(R.A0._fix.id);
    return { keys:Object.keys(csvLearned).sort(), saves:globalThis.saves||0, cats:[R.A1.categoryName,R.A2.categoryName,R.A4.categoryName] };
  })(__R)`,c);
  t('banded keys for the rows touched; NO bare "le kha nin" key', JSON.stringify(r.keys)===JSON.stringify(['le kha nin|a','le kha nin|b','le kha nin|c']), r.keys);
  t('the label lands on the three rows and the store is saved once', r.cats.every(x=>x==='Nhà ở') && r.saves===1, r);
}

console.log('\n-- the corrected card stays visible under a filter until the filter changes (A1) --');
{
  const c=mk(); const R=seed(c); c.__R=R;
  const r=vm.runInContext(`(function(R){
    csvCatFilter='X';                                     // the stubbed leaf is 'Y': every card is hidden by the filter
    var before=csvCatHide(R.A0);
    R.A0._node='rent'; csvFixRecord(R.A0,'node','rent',{_node:'p2p'},null);
    var pinned=csvCatHide(R.A0), other=csvCatHide(R.B);
    csvFixClearAll();
    var after=csvCatHide(R.A0);
    return {before:before, pinned:pinned, other:other, after:after};
  })(__R)`,c);
  t('hidden by the filter → visible once corrected → hidden again when the filter changes', r.before===true && r.pinned===false && r.after===true, r);
  t('only the corrected card is pinned; its neighbours still obey the filter', r.other===true, r);
}

console.log('\n-- A22: the card shows ONE button; the name drops the account digits; hidden at zero; quiet after --');
{
  const c=mk(); const R=seed(c); c.__R=R;
  const r=vm.runInContext(`(function(R){
    R.A0._node='rent'; csvFixRecord(R.A0,'node','rent',{_node:'p2p'},null);
    var h1=csvFixBarBtnHTML(R.A0), sh=csvFixSheetHTML(R.A0);
    csvFixApply(R.A0._fix.id);
    var h2=csvFixBarBtnHTML(R.A0), sh2=csvFixSheetHTML(R.A0);
    R.B._node='rent'; csvFixRecord(R.B,'node','rent',{_node:'p2p'},null);
    return {h1:h1,h2:h2,h3:csvFixBarBtnHTML(R.B),sh:sh,sh2:sh2};
  })(__R)`,c);
  t('before: one outlined button, "Áp dụng cho 3 khoản khác của LE KHA NIN" (no account number)', (r.h1.match(/<button /g)||[]).length===1 && /csv-cta-sec/.test(r.h1) && />Áp dụng cho 3 khoản khác của LE KHA NIN</.test(r.h1) && !/1361/.test(r.h1), r.h1);
  t('after: the same button turns quiet and keeps the count', /csv-cta-sec done/.test(r.h2) && /Đã áp dụng cho 3 khoản/.test(r.h2), r.h2);
  t('nothing to carry to → no button at all (hidden, not disabled)', r.h3==='', r.h3);
  t('the sheet: what changes with its undo, the three rows ticked, one CTA', /Sẽ đổi/.test(r.sh) && /Tiền nhà/.test(r.sh) && /csvFixUndo\(\d+,'node'\)/.test(r.sh) && (r.sh.match(/cry-tick on/g)||[]).length===3 && /Áp dụng cho 3 khoản</.test(r.sh) && /3 khoản chờ duyệt/.test(r.sh), r.sh);
  t('the sheet after: the applied rows with one "Hoàn tác" for the carry, and the CTA is "Xong"', /Đã áp dụng · 3 khoản/.test(r.sh2) && /csvFixUnapply\(\d+\)/.test(r.sh2) && />Xong</.test(r.sh2), r.sh2);
  t('tokens only in the sheet and the button', !/#[0-9a-f]{3,6}\b/i.test(r.h1+r.sh));
}

console.log('\n-- A23: the ticks decide; a hand-set row arrives unticked and can be ticked on purpose --');
{
  const c=mk(); const R=seed(c); c.__R=R;
  const r=vm.runInContext(`(function(R){
    R.A1._node='coffee'; csvHandMark(R.A1,'node');
    R.A0._node='rent'; csvFixRecord(R.A0,'node','rent',{_node:'p2p'},null);
    var id=R.A0._fix.id, rows=csvFixSheetRows(R.A0);
    var shape=rows.map(function(x){ return [x.hand,x.on]; });
    var iA2=rows.findIndex(function(x){ return x.r===R.A2; }), iA1=rows.findIndex(function(x){ return x.r===R.A1; });
    csvFixTick(id, iA2);                                   // untick A2
    var btn1=csvFixBarBtnHTML(R.A0);
    csvFixTick(id, iA1);                                   // tick the hand-set A1 on purpose
    var n=csvFixApply(id);
    var after={a1:R.A1._node,a2:R.A2._node,a4:R.A4._node,n:n, btn:csvFixBarBtnHTML(R.A0)};
    csvFixUnapply(id);
    after.back=[R.A1._node,R.A4._node,R.A0._node]; after.items=Object.keys(R.A0._fix.items);
    return {shape:shape, btn1:btn1, after:after, sheet:csvFixSheetHTML(R.A0)};
  })(__R)`,c);
  t('two ticked candidates, then the hand-set row last and unticked', JSON.stringify(r.shape)==='[[false,true],[false,true],[true,false]]', r.shape);
  t('the button counts only what is ticked', /Áp dụng cho 1 khoản khác/.test(r.btn1), r.btn1);
  t('apply follows the ticks: the unticked row is left, the hand-set row ticked on purpose is changed', r.after.a2==='p2p' && r.after.a1==='rent' && r.after.a4==='rent' && r.after.n===2, r.after);
  t('with the unticked row still differing, the button says done, not "apply to 1"', /Đã áp dụng cho 2 khoản/.test(r.after.btn), r.after.btn);
  t('undoing the carry puts the rows back and keeps the card\'s own edit and its line', r.after.back.join()==='coffee,p2p,rent' && r.after.items.join()==='node', r.after);
  t('the hand-set row is labelled in the sheet', /đã tự sửa/.test(r.sheet), r.sheet);
}

console.log('\n-- A17: edits stack, one line and one undo per field; one pill carries them all --');
{
  const c=mk(); const R=seed(c); c.__R=R;
  const r=vm.runInContext(`(function(R){
    var sn=csvFixSnap(R.A0,'node'); R.A0._node='rent'; R.A0._nodeSource='user'; csvFixRecord(R.A0,'node','rent',sn,null);
    var sc=csvFixSnap(R.A0,'cat'); R.A0.categoryName='Nhà ở'; R.A0.catSource='user'; csvFixRecord(R.A0,'cat','Nhà ở',sc,null);
    var h=csvFixSheetHTML(R.A0), id=R.A0._fix.id, fields=Object.keys(R.A0._fix.items).sort();
    csvFixApply(id);
    var both=[R.A1._node,R.A1.categoryName,R.A4._node,R.A4.categoryName];
    csvFixUndo(id,'node');
    var after=[R.A0._node,R.A0.categoryName,R.A1._node,R.A1.categoryName], left=R.A0._fix?Object.keys(R.A0._fix.items):[];
    // the same field picked twice keeps the FIRST snapshot
    var s2=csvFixSnap(R.A0,'cat'); R.A0.categoryName='Ăn uống'; csvFixRecord(R.A0,'cat','Ăn uống',s2,null);
    csvFixUndo(id,'cat');
    return {h:h, fields:fields, both:both, after:after, left:left, catBack:R.A0.categoryName, gone:!R.A0._fix};
  })(__R)`,c);
  t('two fields, two lines in the sheet, each with its own undo, one CTA', r.fields.join()==='cat,node' && /csvFixUndo\(\d+,'node'\)/.test(r.h) && /csvFixUndo\(\d+,'cat'\)/.test(r.h) && (r.h.match(/cry-cta/g)||[]).length===1, r.h);
  t('the pill carried both edits', r.both.join()==='rent,Nhà ở,rent,Nhà ở', r.both);
  t('undoing the node line takes the node back everywhere and leaves the label standing', r.after[0]==='p2p' && r.after[1]==='Nhà ở' && r.after[2]===null && r.after[3]==='Nhà ở' && r.left.join()==='cat', r);
  t('a field picked twice undoes to what the card said before the FIRST pick, and the block goes with its last line', r.catBack===undefined && r.gone, r);
}

console.log('\n-- A18: a row the person set by hand is never overwritten, and the block says so --');
{
  const c=mk(); const R=seed(c); c.__R=R;
  const r=vm.runInContext(`(function(R){
    R.A1._node='coffee'; csvHandMark(R.A1,'node');                      // the person filed this one themselves
    R.A0._node='rent'; csvFixRecord(R.A0,'node','rent',{_node:'p2p'},null);
    var p=csvFixPending(R.A0), h=csvFixSheetHTML(R.A0);
    csvFixApply(R.A0._fix.id);
    return { n:p.rows.length, skipped:p.skipped, a1:R.A1._node, a2:R.A2._node, h:h, carriedHand:!!(R.A2._hand&&R.A2._hand.node), cardHand:!!(R.A0._hand&&R.A0._hand.node) };
  })(__R)`,c);
  t('the hand-set row is not counted and not touched', r.n===2 && r.skipped===1 && r.a1==='coffee' && r.a2==='rent', r);
  t('the sheet lists it unticked, marked as set by the person', /đã tự sửa/.test(r.h) && (r.h.match(/cry-tick on/g)||[]).length===2, r.h);
  t('a carry is not a hand pick: the card is marked, the rows it reached are not', r.cardHand && !r.carriedHand, r);
}

console.log('\n-- rows that already say it are not counted --');
{
  const c=mk(); const R=seed(c); c.__R=R;
  const r=vm.runInContext(`(function(R){
    R.A2._node='rent';
    R.A0._node='rent'; csvFixRecord(R.A0,'node','rent',{_node:'p2p'},null);
    var n1=csvFixSimilar(R.A0).length; csvFixApply(R.A0._fix.id);
    return { n1:n1, n2:csvFixSimilar(R.A0).length, done:csvFixAppliedRows(R.A0).length };
  })(__R)`,c);
  t('two rows to change, none after the apply, and the done line counts what was changed', r.n1===2 && r.n2===0 && r.done===2, r);
}

console.log('\n-- A16: Loại khoản carries with its follow-up, over the ready list only --');
{
  const c=mk(); const R=seed(c); c.__R=R;
  const r=vm.runInContext(`(function(R){
    R.A2._scope='family';
    var sk=csvFixSnap(R.A0,'kind');
    R.A0._loan=true; R.A0._loanWho='LE KHA NIN'; R.A0._loanDue='2026-11-01'; R.A0._scope='personal';
    csvFixRecord(R.A0,'kind',csvRowKindCur(R.A0),sk,null);
    var h=csvFixSheetHTML(R.A0), rows=csvFixSimilar(R.A0), id=R.A0._fix.id;
    csvFixApply(id);
    var a1={loan:R.A1._loan, who:R.A1._loanWho, due:R.A1._loanDue, scope:R.A1._scope, picked:R.A1._kindPicked};
    var notReady=[!!R.A2._loan, !!R.A4._loan, !!R.A3._loan], k=[R.K._xfer, !!R.K._loan];
    csvFixUndo(id,'kind');
    return { h:h, n:rows.length, hasK:rows.indexOf(R.K)>=0, a1:a1, notReady:notReady, k:k, back:[!!R.A1._loan, R.A1._loanWho, !!R.K._loan, R.K._xfer, !!R.A0._loan] };
  })(__R)`,c);
  t('the sheet names the kind and who: "Loại khoản · 🤝 Cho vay · LE KHA NIN"', /Loại khoản/.test(r.h) && /🤝 Cho vay · LE KHA NIN/.test(r.h), r.h);
  t('ready rows only, and a row of another kind IS a candidate for a kind carry', r.n===2 && r.hasK && r.notReady.every(x=>!x), r);
  t('the row takes the kind, the person and the private book; the due date stays its own', r.a1.loan===true && r.a1.who==='LE KHA NIN' && !r.a1.due && r.a1.scope==='personal' && r.a1.picked===true, r.a1);
  t('the transfer leg became a loan, its counterpart cleared', r.k[0]===false && r.k[1]===true, r.k);
  t('undo puts every row back, the transfer leg included', r.back.join()==='false,,false,true,false' || (r.back[0]===false && !r.back[1] && r.back[2]===false && r.back[3]===true && r.back[4]===false), r.back);
}
{
  const c=mk(); const R=seed(c); c.__R=R;
  const r=vm.runInContext(`(function(R){
    R.A1._ownAcct='acc1';                                                // A1's own instrument is the account the card picked
    var sk=csvFixSnap(R.A0,'kind'); R.A0._xfer=true; R.A0._xferOtherId='acc1';
    csvFixKindTouch(R.A0, sk, null);
    csvFixApply(R.A0._fix.id);
    var x={a1:[R.A1._xfer,R.A1._xferOtherId], h:csvFixSheetHTML(R.A0)};
    // a card payment: each row asks its own mail unless the person picked the card
    var R2=R; R2.B.counterparty=R2.A0.counterparty; R2.B._mailCard='cardB';
    csvFixUndo(R.A0._fix.id,'kind');
    var s2=csvFixSnap(R.A0,'kind'); R.A0.isTransfer=true; R.A0._payCardId='card1'; csvFixRecord(R.A0,'kind','cardpay',s2,null);
    csvFixApply(R.A0._fix.id); var auto=R.B._payCardId;
    csvFixUndo(R.A0._fix.id,'kind');
    var s3=csvFixSnap(R.A0,'kind'); R.A0.isTransfer=true; R.A0._payCardId='card1'; csvFixKindTouch(R.A0,s3,'paycard');
    csvFixApply(R.A0._fix.id);
    x.auto=auto; x.hand=R.B._payCardId; return x;
  })(__R)`,c);
  t('a transfer carries its counterpart, but never onto the row whose own account that is', r.a1[0]===true && r.a1[1]===null && /Chuyển khoản nội bộ · VCB ••1234/.test(r.h), r);
  t('a card payment: the row\'s own mail names its card; a card the person picked is carried as picked', r.auto==='cardB' && r.hand==='card1', r);
}

console.log('\n-- A17: a later pick that takes an earlier one back drops its line --');
{
  const c=mk(); const R=seed(c); c.__R=R;
  const r=vm.runInContext(`(function(R){
    var sn=csvFixSnap(R.A0,'node'); R.A0._node='rent'; csvFixRecord(R.A0,'node','rent',sn,null);
    var sk=csvFixSnap(R.A0,'kind'); R.A0._loan=true; R.A0._loanWho='X'; csvFixRecord(R.A0,'kind','loan',sk,null);
    var a=Object.keys(R.A0._fix.items);
    var ss=csvFixSnap(R.A0,'scope'); R.A0._scope='family'; csvScopeClearKinds(R.A0); csvFixRecord(R.A0,'scope','family',ss,null);
    var b=Object.keys(R.A0._fix.items);
    csvFixUndo(R.A0._fix.id,'scope');
    return {a:a, b:b, loanBack:R.A0._loan===true && R.A0._loanWho==='X'};
  })(__R)`,c);
  t('a loan has no category: the node line goes when the kind becomes a loan', r.a.join()==='kind', r);
  t('Gia đình clears the kind: the kind line goes, and undoing the scope line restores the loan', r.b.join()==='scope' && r.loanBack, r);
}

console.log('\n-- A20: no payee → the wording from the same bank --');
{
  const c=mk();
  const r=vm.runInContext(`(function(){
    var W0={counterparty:'0912',description:'TT HD 1234 tien dien',amount:500000,_bank:'VIB',_node:null,dateDisplay:'2026-10-01'};
    var W1={counterparty:'0912',description:'TT HD 9876 tien dien',amount:520000,_bank:'VIB',_node:null,dateDisplay:'2026-09-01'};
    var W2={counterparty:'0912',description:'TT HD 5555 tien dien',amount:510000,_bank:'MB',_node:null};
    csvReview={ready:[W0,W1,W2],groups:[],dup:[],deferred:[]};
    W0._node='electric'; csvFixRecord(W0,'node','electric',{_node:null},null);
    var s=csvFixSimilar(W0);
    return {n:s.length, w1:s[0]===W1, btn:csvFixBarBtnHTML(W0), sh:csvFixSheetHTML(W0), key:csvFixKey(W0)};
  })()`,c);
  t('same wording, same bank; another bank is not similar', r.n===1 && r.w1 && r.key.indexOf('w:')===0, r);
  t('the button says "cùng nội dung", never a payee it does not have', /Áp dụng cho 1 khoản cùng nội dung/.test(r.btn), r.btn);
  t('the sheet row shows the day and the memo', /01\/09 · TT HD 9876 tien dien/.test(r.sh) && /Cùng nội dung</.test(r.sh), r.sh);
}

console.log('\n-- income category carries between money-in rows --');
{
  const c=mk();
  const r=vm.runInContext(`(function(){
    var I0={counterparty:'CONG TY ABC',description:'luong t9',amount:20000000,isIncome:true}, I1={counterparty:'CONG TY ABC',description:'luong t8',amount:20000000,isIncome:true};
    var E ={counterparty:'CONG TY ABC',description:'hoan ung',amount:100000};
    csvReview={ready:[I0,I1,E],groups:[],dup:[],deferred:[]};
    var s=csvFixSnap(I0,'inccat'); I0._incomeCat='Lương'; csvFixRecord(I0,'inccat','Lương',s,null);
    csvFixApply(I0._fix.id);
    return {i1:I1._incomeCat, e:E._incomeCat};
  })()`,c);
  t('the other money-in row takes it; money out does not', r.i1==='Lương' && r.e===undefined, r);
}

console.log('\n-- A21: one carry surface --');
{
  t('the bottom bar\'s "Áp cho N khoản giống" is gone', !/csvApplySimilar|csvSimilarRows|' khoản giống'/.test(S56.replace(/\/\*[\s\S]*?\*\//g,'')) && !/csv-cta-ghost/.test(rd('src/css/74-mailbox.css')));
  t('the old block, the look filter and the timed ledger confirm are gone', !/csvFixBlockHTML|csvFixPeek|csvFixLedgerTap|csv-fix-/.test(S56) && !/\.csv-fix/.test(rd('src/css/74-mailbox.css')));
  t('the card: changed rows wear the dot, the bar carries the door, the row sheet knows "carry"', /c\._fix && c\._fix\.items\[f\]/.test(S56) && /'<div class="csv-cta">' \+ fixBtn/.test(S56) && /if\(f==='carry'\) return c\._fix \? csvFixSheetHTML\(c\)/.test(S56));
  t('every hand pick records: kind, its follow-ups, income category', /csvFixRecord\(c, 'kind', csvRowKindCur\(c\), _fxPrevK, null\)/.test(S56) && (S56.match(/csvFixKindTouch\(c, _fx/g)||[]).length>=8 && /csvFixRecord\(c, 'inccat'/.test(S56));
  t('the bulk verbs mark the hand too', /csvHandMark\(c, 'cat'\)/.test(S56) && /csvHandMark\(c, 'node'\)/.test(S56) && /csvHandMark\(c, 'scope'\)/.test(S56));
}

console.log('\n-- L1–L7: the same carry in the book, after Lưu on the personal detail --');
const LEDGER=(async()=>{
  const S61=rd('src/js-ui/61-expense-detail.js');
  const ctx={window:{},console,esc:x=>String(x),escAttr:x=>String(x),fmt:n=>String(n),curMult:()=>1000,catStyle:{},navigator:{onLine:true},TODAY:new Date(2026,9,2),
    setTxt:()=>{}, document:{getElementById:()=>null,querySelector:()=>null}, toast:()=>{}, closeSheet:()=>{}, openSheet:()=>{}};
  vm.createContext(ctx);
  vm.runInContext(rd('src/js-ui/11-taxonomy.js'),ctx); ctx.window.FH_TAX=ctx.FH_TAX;
  vm.runInContext([sliceVar(S57,'CSV_GATEWAYS'),sliceVar(S57,'CSV_BANK_NOISE'),sliceFn(S57,'csvPatternKey'),
    "function deburr(s){ return String(s||'').normalize('NFD').replace(/[\\u0300-\\u036f]/g,''); }",
    'var _pexdCarry=null, _pexdId="me", _pexdEdit=false;',
    'var _pexdPre=null, PXD={}, renders=0; function renderPersonalTxDetail(){ renders++; } function pexdReadFields(){} function _pexdEntry(){ return { t:ROW }; } var ROW=null;',
    ...['_pexdCarryNodeLbl','_pexdCarryDiffers','_pexdCarryDeliberate','_pexdCarryOn','_pexdCarryPaint','_pexdCarryWhen','_pexdCarryLrow','pexdCarryTick',
        '_pexdPreFields','_pexdPreEnsure','_pexdPreCy','_pexdPreTicked','_pexdPreRows','_pexdPreOne','_pexdPreSubHTML','_pexdPreFootHTML','pexdPreToggle','_exdModeRow',
        '_pexdPreDraftFields','pexdPreTick','pexdPreChoose','_pexdPreJob'].map(n=>sliceFn(S61,n)),
    ...['pexdCarryScan','_pexdCarrySettle','_pexdCarryWrite','pexdCarryGo','pexdCarryUndo'].map(n=>'async '+sliceFn(S61,n)),
    'function pexdCarryRender(){} function pexdPreRender(){}'].join('\n'),ctx);
  const P2='970400123456 - TRAN MINH KHOA';
  const r=await vm.runInContext(`(async function(){
    var W=[], LESS={}, P2='${P2}';
    var slice=[
      {id:'me', kind:'expense', amt:5000, who:P2, note:'chuyen tien', cat:'Nhà ở', node:'rent', date:'2026-10-01'},
      {id:'a',  kind:'expense', amt:5000, who:P2, note:'chuyen tien', cat:'Khác',  node:'p2p',  date:'2026-09-01'},
      {id:'b',  kind:'expense', amt:5000, who:P2, note:'',            cat:'',      node:null,   date:'2025-12-01'},
      {id:'c',  kind:'expense', amt:200,  who:P2, note:'cam on anh',  cat:'Ăn ngoài', node:'eatout', date:'2026-07-14'},
      {id:'d',  kind:'expense', amt:5000, who:P2, note:'x', cat:'Nhà ở', node:'rent', date:'2026-08-01'},
      {id:'m',  kind:'expense', amt:5000, who:P2, note:'x', cat:'Khác',  node:'p2p', link:'L1', date:'2026-08-02'},
      {id:'i',  kind:'income',  amt:5000, who:P2, note:'x', cat:'Khác',  node:'p2p', date:'2026-08-03'},
      {id:'o',  kind:'expense', amt:5000, who:'VO DINH PHUC', note:'x', cat:'Khác', node:'p2p', date:'2026-08-04'}];
    window.fhPersonalMatchSlice=async function(){ return slice; };
    window.fhPersonalSetNode=async function(id,n){ W.push(['node',id,n]); return true; };
    window.fhPersonalUpdateExpense=async function(id,f,q){ W.push(['cat',id,f.cat,q]); return true; };
    window.fhLessonNode=function(i){ return LESS[i.counterparty+'|'+i.amount]||null; };
    window.fhLessonLearnNode=function(i){ LESS[i.counterparty+'|'+i.amount]=i.node; };
    window.fhLessonForgetNode=function(i){ delete LESS[i.counterparty+'|'+i.amount]; };
    window.fhPersonalHydrate=async function(){ W.push(['hydrate']); };
    await pexdCarryScan({ id:'me', who:P2, note:'chuyen tien', fields:{cat:'Nhà ở', node:'rent'}, old:{cat:'Khác', node:'p2p'} });
    var cy=_pexdCarry, ids=cy.rows.map(function(x){return x.id;}).join(), off=Object.keys(cy.off).join(), name=cy.name;
    await pexdCarryGo();
    var w1=W.slice(), st1=cy.state, n1=(cy.done||[]).length, less1=Object.assign({},LESS);
    W.length=0; await pexdCarryUndo();
    return {ids:ids, off:off, name:name, w1:w1, st1:st1, n1:n1, less1:less1, w2:W.slice(), st2:cy.state, less2:Object.assign({},LESS), a:slice[1], b:slice[2]};
  })()`,ctx);
  t('similar = the payee\'s other private expense rows that differ; never the row itself, a mirror, income, another payee, or one already right', r.ids==='a,b,c', r);
  t('a row whose category is neither empty nor what this row said before arrives unticked (L4)', r.off==='c' && r.name==='TRAN MINH KHOA', r);
  t('the writes: label quietly through the expense writer, node through the node writer, then ONE hydrate', JSON.stringify(r.w1)===JSON.stringify([['cat','a','Nhà ở',true],['node','a','rent'],['cat','b','Nhà ở',true],['node','b','rent'],['hydrate']]), r.w1);
  t('one node lesson per row, in đồng, keyed on the payee (P10, A15)', r.less1[P2+'|5000000']==='rent' && r.st1==='done' && r.n1===2, r.less1);
  t('undo replays backwards through the same writers and forgets the fresh lessons', r.st2==='idle' && r.w2.filter(w=>w[0]!=='hydrate').length===4 && Object.keys(r.less2).length===0 && r.a.cat==='Khác' && r.a.node==='p2p' && r.b.node===null, r);
  /* ── before Lưu (L8–L13) ── */
  const q=await vm.runInContext(`(async function(){
    var P2='${P2}';
    var slice=[
      {id:'me', kind:'expense', amt:5000, who:P2, note:'chuyen tien', cat:'Khác', node:'p2p', date:'2026-10-01'},
      {id:'a',  kind:'expense', amt:5000, who:P2, note:'chuyen tien', cat:'Khác',  node:'p2p',  date:'2026-09-01'},
      {id:'b',  kind:'expense', amt:5000, who:P2, note:'',            cat:'Nhà ở', node:null,   date:'2025-12-01'},
      {id:'c',  kind:'expense', amt:200,  who:P2, note:'cam on anh',  cat:'Ăn ngoài', node:'eatout', date:'2026-07-14'}];
    window.fhPersonalMatchSlice=async function(){ return slice; };
    ROW=slice[0]; _pexdId='me'; _pexdEdit=true; _pexdPre=null; _pexdCarry=null;
    PXD={};
    var none=_pexdPreFootHTML(ROW);                      // nothing staged
    PXD={cat:'Nhà ở'};
    _pexdPreFootHTML(ROW); await Promise.resolve(); await Promise.resolve(); await Promise.resolve();   // first paint starts the read; the read re-renders
    var sub1=_pexdPreSubHTML(ROW,'cat'), subN=_pexdPreSubHTML(ROW,'node'), foot1=_pexdPreFootHTML(ROW), job0=_pexdPreJob({fields:{cat:'Nhà ở'},old:{cat:'Khác',node:'p2p'}});
    pexdPreToggle('cat');
    var sub1on=_pexdPreSubHTML(ROW,'cat');
    PXD={cat:'Nhà ở', node:'rent'};
    var foot2=_pexdPreFootHTML(ROW), sub2=_pexdPreSubHTML(ROW,'node');
    var jobCat=_pexdPreJob({fields:{cat:'Nhà ở',node:'rent'},old:{cat:'Khác',node:'p2p'}});
    _pexdPre.draft={cat:true,node:true}; pexdPreChoose();                         // the button: every change
    var jobAll=_pexdPreJob({fields:{cat:'Nhà ở',node:'rent'},old:{cat:'Khác',node:'p2p'}});
    pexdPreTick('c');                                                             // tick the deliberate row on purpose
    var jobC=_pexdPreJob({fields:{cat:'Nhà ở',node:'rent'},old:{cat:'Khác',node:'p2p'}});
    return { none:none, sub1:sub1, subN:subN, foot1:foot1, job0:job0, sub1on:sub1on, foot2:foot2, sub2:sub2,
      jobCat:jobCat&&{f:Object.keys(jobCat.fields).join(), r:jobCat.rows.map(function(x){return x.id;}).join()},
      jobAll:jobAll&&{f:Object.keys(jobAll.fields).join(), r:jobAll.rows.map(function(x){return x.id;}).join()},
      jobC:jobC&&jobC.rows.map(function(x){return x.id;}).join(), use:Object.keys(_pexdPre.use).join() };
  })()`,ctx);
  t('L8: nothing staged → nothing offered; a staged Danh mục → the switch under that row, off, and the foot button', q.none==='' && /role="switch" aria-checked="false"/.test(q.sub1) && /Áp dụng cho 1 khoản giống/.test(q.sub1) && q.subN==='', q);
  t('L9: the button says "Áp dụng 1 thay đổi cho 1 khoản", then recounts to 2 thay đổi cho 2 khoản', />Áp dụng 1 thay đổi cho 1 khoản</.test(q.foot1) && />Áp dụng 2 thay đổi cho 2 khoản</.test(q.foot2), [q.foot1,q.foot2]);
  t('L10: off by default → Lưu carries nothing', q.job0===null, q.job0);
  t('L10: one switch on carries that field only, to the rows that differ on it and are ticked', /aria-checked="true"/.test(q.sub1on) && q.jobCat.f==='cat' && q.jobCat.r==='a' && /aria-checked="false"/.test(q.sub2), q);
  t('L11: the sheet\'s "Chọn" switches every change on; the rows are the union, the deliberate one still out', q.use==='cat,node' && q.jobAll.f==='cat,node' && q.jobAll.r==='a,b', q.jobAll);
  t('L4/L12: a deliberate row ticked on purpose is carried', q.jobC==='a,b,c', q.jobC);
  t('L13: Lưu runs the staged carry before it reports, and the after-save offer stands only when nothing was switched on', /_res=await _pexdCarryWrite\(_job\.fields, _job\.rows, null\)/.test(S61) && /'Đã lưu và đổi '\+_res\.done\.length\+' khoản'/.test(S61) && /return; \} _pexdPre=null; _pexdEdit=false;/.test(S61));
  t('61: Lưu captures the before-values and scans only for an expense whose Danh mục or Tiêu vào gì changed', /if\(p\.cat!=null && p\.cat!==\(t\.cat\|\|''\)\) _cf\.cat=p\.cat;/.test(S61) && /if\(_cy && !_job\) pexdCarryScan\(_cy\);/.test(S61));
  t('61: the view state paints the foot button; the sheet body is the shared one', /_pexdCarryPaint\(\);\s+\/\/ the view state/.test(S61) && /body\.innerHTML=fhCarryBodyHTML\(m\);/.test(S61) && /id="sheet-carry"/.test(rd('src/index.html')));
})().catch(e=>{ t('the ledger block ran', false, String(e && e.stack || e)); });

console.log('\n-- A15: the payee on a personal row is `who`; the key function never reads it --');
{
  const c=mk();
  const r=vm.runInContext(`({ who:fhPersonKeyRow({who:'${P}',note:'x',amt:5000,node:'p2p'}), cp:fhPersonKeyRow({_cp:'${P}',note:'x',amt:5000,node:'p2p'}) })`,c);
  t('fhPersonKeyRow ignores `who` (a family row\'s member would poison the key)', r.who==='' , r);
  t('…and reads `_cp`, which the personal callers fill from `who`', r.cp==='le kha nin|d', r);
  const body=sliceFn(rd('src/js-ui/13-partition.js'),'fhPersonKeyRow').replace(/\/\*[\s\S]*?\*\//g,'');   // the comment names the hazard; the code must not
  t('source: fhPersonKeyRow has no `.who` read', !/row\.who/.test(body));
  const s60=rd('src/js-ui/60-transactions.js'), s21=rd('src/js-ui/21-personal.js'), s28=rd('src/js-data/28-tree-backfill.js'), s19=rd('src/js-data/19-personal.js'), s61=rd('src/js-ui/61-expense-detail.js');
  t('60: the personal list rows and treeRows carry who → _cp/cp', /_cp:t\.who\|\|null/.test(s60) && /cp:t\.who\|\|null/.test(s60));
  t('60: the bulk verb passes the payee only for a personal row', /counterparty:\(personal\?\(raw\.who\|\|null\):null\)/.test(s60));
  t('21: the chart\'s _keep maps who → _cp', /_cp:t\.who\|\|null/.test(s21));
  t('28: the sweep reads who only for scope === personal', /\(scope === 'personal'\) \? \(row\.who \|\| null\) : null/.test(s28));
  t('61: the family composer passes no payee; the personal detail passes who', /counterparty:null, amount:\(Number\(t\.amt\)/.test(s61) && /counterparty:t\.who\|\|null, amount:\(Number\(amtBase\)/.test(s61));
  t('19: the 365-day match slice decrypts the payee for the ledger half', /counterparty_enc,cat_name_enc,txn_date,kind,link_id/.test(s19) && /who: t\.counterparty_enc \? await _decTxt\(t\.counterparty_enc\)/.test(s19));
  const vs=[...new Set(s28.match(/fh-tree-bf:v(\d+):/g)||[])];
  t('the sweep cursor moved with the rules (E10): one version, ≥ 12', vs.length===1 && Number(vs[0].match(/v(\d+):/)[1])>=12, vs);
}

LEDGER.then(()=>{ console.log('\n'+(fail?fail+' FAILED, ':'ALL ')+pass+' PASSED'); process.exit(fail?1:0); });
