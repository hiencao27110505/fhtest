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
    function fhSyncMerchantCorrection(){} function renderCsvReview(){ renders++; } var csvReview=null; var csvCatFilter=null;`,ctx);
  // the machinery, whole, from 56
  const fns=['csvScopeClearKinds','csvNodeNotSpending','csvRowGroup','csvPersonKeyOf','csvIsP2P','csvCatHide','csvFixValLabel','csvFixPayee','csvFixKindRow',
    'csvFixSnap','csvFixRestore','csvFixLessonPrev','csvFixTeach','csvFixUnteach','csvFixRecord','csvFixClearAll','csvFixCandidates','csvFixSimilar',
    'csvFixApply','csvFixUndo','csvFixLedgerScan','csvFixBlockHTML'];
  vm.runInContext([sliceVar(S56,'csvPersonFilter'),sliceVar(S56,'csvFixes'),sliceVar(S56,'CSV_FIX_LBL')].join('\n')+'\n'+fns.map(n=>sliceFn(S56,n)).join('\n'),ctx);
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
    csvFixRecord(R.A0,'node','rent',csvFixSnap(R.A0,'node'),csvFixLessonPrev('node',R.A0));
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
    csvFixRecord(R.A0,'node','rent',csvFixSnap(R.A0,'node'),csvFixLessonPrev('node',R.A0));
    csvFixApply(R.A0._fix.id);
    return { nodes:[R.A1._node,R.A2._node,R.A4._node,R.K._node,R.B._node,R.A3._node], src:[R.A1._nodeSource,R.A2._nodeSource],
      dupStill:csvReview.dup[0].c===R.A2, deferStill:csvReview.deferred[0]===R.A3, groupStill:csvReview.groups[0].items[0]===R.A4,
      less:Object.assign({},LESS), applied:R.A0._fix.applied.rows.length };
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
    csvFixRecord(R.A0,'node','rent',csvFixSnap(R.A0,'node'),csvFixLessonPrev('node',R.A0));
    R.A0._node='rent'; R.A0._nodeSource='user';   // what the pick itself does, before csvFixRecord in the real flow (snapshot taken before)
    var id=R.A0._fix.id; csvFixApply(id); csvFixUndo(id);
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
    csvFixRecord(R.A0,'cat','Nhà ở',csvFixSnap(R.A0,'cat'),csvFixLessonPrev('cat',R.A0));
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
    csvFixRecord(R.A0,'node','rent',csvFixSnap(R.A0,'node'),null);
    var pinned=csvCatHide(R.A0), other=csvCatHide(R.B);
    csvFixClearAll();
    var after=csvCatHide(R.A0);
    return {before:before, pinned:pinned, other:other, after:after};
  })(__R)`,c);
  t('hidden by the filter → visible once corrected → hidden again when the filter changes', r.before===true && r.pinned===false && r.after===true, r);
  t('only the corrected card is pinned; its neighbours still obey the filter', r.other===true, r);
}

console.log('\n-- the block: names the payee and the count, hides the pill at zero, shows the done line after --');
{
  const c=mk(); const R=seed(c); c.__R=R;
  const r=vm.runInContext(`(function(R){
    csvFixRecord(R.A0,'node','rent',csvFixSnap(R.A0,'node'),null);
    var h1=csvFixBlockHTML(R.A0);
    csvFixApply(R.A0._fix.id);
    var h2=csvFixBlockHTML(R.A0);
    csvFixRecord(R.B,'node','rent',csvFixSnap(R.B,'node'),null);
    var h3=csvFixBlockHTML(R.B);
    return {h1:h1,h2:h2,h3:h3};
  })(__R)`,c);
  t('before: "Áp dụng cho 3 khoản khác của <payee>" with the printed name and an undo', /Áp dụng cho 3 khoản khác của 13610000120606 - LE KHA NIN/.test(r.h1) && /Hoàn tác/.test(r.h1) && /Tiền nhà/.test(r.h1), r.h1);
  t('after: "Đã áp dụng cho 3 khoản …" and no pill', /Đã áp dụng cho 3 khoản/.test(r.h2) && !/csv-fix-cta/.test(r.h2), r.h2);
  t('a payee with no other cards gets the status line and undo, but no pill (N = 0 is hidden, not disabled)', /Hoàn tác/.test(r.h3) && !/Áp dụng cho/.test(r.h3), r.h3);
  t('44px reach and tokens only: every control is a real <button>', (r.h1.match(/<button /g)||[]).length===2 && !/#[0-9a-f]{3,6}/i.test(r.h1), r.h1);
}

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

console.log('\n'+(fail?fail+' FAILED, ':'ALL ')+pass+' PASSED'); process.exit(fail?1:0);
