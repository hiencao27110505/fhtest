#!/usr/bin/env node
/* Transfers to people, by person. `node tools/p2p-person-groups.test.js`
 *
 * "Chuyển cho người khác" is the one node whose axis is WHO, and the design's load-bearing
 * claim is that a person group IS a lesson: the key the queue and the breakdown group on is
 * the very key 24-lessons stores a node lesson under, produced by the same function
 * (fhPersonKey, p2p-breakdown-spec P4). This pins that, the '@key' selection form (P5), the
 * đồng contract (P10: the ledger used to pass thousands and no ledger-taught lesson ever
 * fired in the queue), the queue's person rows (P7: one row is not a group), and the three
 * children under p2p (P3). Real files, loaded whole where they can be.
 */
const fs=require('fs'),vm=require('vm'),path=require('path');
const ROOT=path.join(__dirname,'..');
let pass=0,fail=0; const t=(n,ok,d)=>{console.log((ok?'  PASS  ':'  FAIL  ')+n+(!ok&&d!==undefined?'  -> '+JSON.stringify(d):'')); ok?pass++:fail++;};
const rd=f=>fs.readFileSync(path.join(ROOT,f),'utf8');
const sliceFn=(src,name)=>{const k=src.indexOf('function '+name+'('); if(k<0) throw new Error('no '+name); return src.slice(k,src.indexOf('\n}',k)+2);};
const sliceVar=(src,name)=>{const m=src.match(new RegExp('^var '+name+' = .*$','m')); if(!m) throw new Error('no var '+name); return m[0];};

const S57=rd('src/js-ui/57-csv-import-review.js'), S56=rd('src/js-ui/56-csv-import-ui.js');
function ctxWithTree(){
  const ctx={window:{},localStorage:{getItem:()=>null,setItem:()=>{}},L:v=>v,console,
    deburr:s=>String(s||'').normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/đ/g,'d').replace(/Đ/g,'D'),
    curMult:()=>1000, esc:s=>String(s), escAttr:s=>String(s), fmt:n=>String(n)};
  vm.createContext(ctx);
  vm.runInContext(rd('src/js-ui/11-taxonomy.js'),ctx); vm.runInContext(rd('src/js-ui/13-partition.js'),ctx);
  ctx.window.FH_TAX=ctx.FH_TAX;
  // the key's two halves, whole, from the file that owns them
  vm.runInContext([sliceVar(S57,'CSV_GATEWAYS'),sliceVar(S57,'CSV_BANK_NOISE'),sliceFn(S57,'csvPatternKey'),sliceFn(S57,'csvAmountBand')].join('\n'),ctx);
  return ctx;
}

console.log('\n-- the person key is the lesson key --');
{
  const c=ctxWithTree();
  const r=vm.runInContext(`({
    key: fhPersonKey('13610000120606 - LE KHA NIN','Cam on anh Lam hehe',5000000),
    same: csvPatternKey({counterparty:'13610000120606 - LE KHA NIN',description:'Cam on anh Lam hehe'})+'|'+csvAmountBand(5000000),
    small: fhPersonKey('13610000120606 - LE KHA NIN','',16000),
    digits: fhPersonKey('13610000120606','',5000000),
    short: fhPersonKey('LE AN','',5000000),
    row: fhPersonKeyRow({counterparty:'13610000120606 - LE KHA NIN',note:'x',amt:5000,node:'p2p'}),
    rowCp: fhPersonKeyRow({_cp:'13610000120606 - LE KHA NIN',note:'x',amt:5000,node:'p2p'})
  })`,c);
  t('fhPersonKey = csvPatternKey + | + csvAmountBand, the lesson store\'s own shape', r.key===r.same && r.key==='le kha nin|d', r);
  t('the account number is not part of who a person is (digits dropped)', r.key.indexOf('1361')<0, r.key);
  t('the same person at 16k and at 5tr are two groups and two lessons (band)', r.small==='le kha nin|a' && r.small!==r.key, r);
  t('a digits-only counterparty has no key: never grouped, never taught', r.digits==='', r);
  t('a name too short to mean one person has no key (same floor as the lesson store)', r.short==='', r);
  t('a ledger row keys in đồng: 5000 base units is the 5tr band, not the 5k band (P10)', r.row==='le kha nin|d', r);
  t('the list\'s _cp carries the counterparty into the key', r.rowCp==='le kha nin|d', r);
}

console.log('\n-- \'@key\' is a selection like any other, judged by the row --');
{
  const c=ctxWithTree();
  const r=vm.runInContext(`(function(){
    var out={};
    window.fhNodeSel='@le kha nin|d';
    out.matchRow=fhNodeSelMatchRow({counterparty:'13610000120606 - LE KHA NIN',note:'',amt:5000,node:'p2p'});
    out.otherBand=fhNodeSelMatchRow({counterparty:'13610000120606 - LE KHA NIN',note:'',amt:16,node:'p2p'});
    out.otherPerson=fhNodeSelMatchRow({counterparty:'VO DINH PHUC',note:'',amt:5000,node:'p2p'});
    out.nodeOnly=fhNodeSelMatch('p2p');
    out.code=fhNodeSelCode();
    fhPersonRemember('le kha nin|d','1361… - LE KHA NIN'); fhPersonRemember('le kha nin|d','13610000120606 - LE KHA NIN'); fhPersonRemember('le kha nin|d','LE KHA NIN');
    out.label=fhNodeSelLabel();
    window.fhNodeSel='p2p';
    out.delegates=fhNodeSelMatchRow({node:'split',amt:1});
    window.fhNodeSel=null; out.none=fhNodeSelMatchRow(null);
    return out; })()`,c);
  t('a person selection matches the person\'s rows', r.matchRow===true, r);
  t('…not the same person at another size', r.otherBand===false, r);
  t('…not another person', r.otherPerson===false, r);
  t('a node-only caller under a person selection gets FALSE (hides, never shows everything)', r.nodeOnly===false, r);
  t('a person is not a node scope: fhNodeSelCode is null so the bulk picker opens on every root (P3, file OUT)', r.code===null, r);
  t('the label is the LONGEST printed name, never the key (P8)', r.label==='13610000120606 - LE KHA NIN', r);
  t('a node selection still delegates to the subtree match', r.delegates===true, r);
  t('no selection matches everything', r.none===true, r);
}

console.log('\n-- the lesson store calls the same function (P4, by construction) --');
{
  const src=rd('src/js-data/24-lessons.js');
  const k=src.indexOf('function _nodeKey'); const body=src.slice(k, src.indexOf('\n    }',k));
  t('24-lessons _nodeKey delegates to fhPersonKey (the spec asks for the SAME call, so this pin is the point)', /return fhPersonKey\(/.test(body));
  const callers=['src/js-ui/60-transactions.js','src/js-ui/61-expense-detail.js'].map(rd).join('\n');
  const learns=callers.match(/fhLessonLearnNode\(\{[^}]*\}/g)||[];
  t('every ledger-side fhLessonLearnNode call converts to đồng (curMult) — P10', learns.length>=3 && learns.every(s=>/curMult\(\)/.test(s)), learns);
  const bf=rd('src/js-data/28-tree-backfill.js');
  t('the sweep hands fhTransferShape and fhNodeGuess đồng, not thousands (P10)', /fhTransferShape\(row\.note, _dong\)/.test(bf) && /amount: _dong, whatOnly/.test(bf));
}

console.log('\n-- the queue groups by person, and one row is not a group (P7) --');
{
  const c=ctxWithTree();
  const fns=['csvNodeNotSpending','csvRowGroup','csvPersonKeyOf','csvIsP2P','csvPersonRows','csvCatHide'].map(n=>sliceFn(S56,n)).join('\n');
  vm.runInContext('var csvCatFilter=null; '+sliceVar(S56,'csvPersonFilter')+'; var csvBaseAmt=function(a){return a;}; var csvTreeLeafOf=function(){return {leaf:"?"};};\n'+fns,c);
  const r=vm.runInContext(`(function(){
    var A1={_node:'p2p',counterparty:'13610000120606 - LE KHA NIN',description:'Cam on',amount:5000000};
    var A2={_node:'split',counterparty:'1361 - LE KHA NIN',description:'tien an',amount:5200000};
    var B ={_node:'p2p',counterparty:'VQRQ0001oqplk - VO DINH PHUC',description:'',amount:200000};
    var X ={_node:'coffee',counterparty:'HIGHLANDS',description:'',amount:60000};
    var N ={_node:'p2p',counterparty:'13610000120606',description:'',amount:300000};
    csvReview={ready:[A1,A2,B,X,N]};
    var pr=csvPersonRows();
    var out={groups:pr.groups.map(function(g){return [g.key,g.name,g.n,g.v];}), singles:pr.singles, singlesSum:pr.singlesSum};
    csvPersonFilter='le kha nin|d';
    out.hide=[csvCatHide(A1),csvCatHide(A2),csvCatHide(B),csvCatHide(X)];
    csvPersonFilter=null; csvCatFilter='Chuyển cho người khác';
    out.hideCat=[csvCatHide(A1)];
    return out; })()`,c);
  t('two rows to one person in one band collapse to one group, keyed on the lesson key, named by the LONGEST print', JSON.stringify(r.groups)===JSON.stringify([['le kha nin|d','13610000120606 - LE KHA NIN',2,10200000]]), r.groups);
  t('a person seen once, and a digits-only payee, are singles, not groups (P7)', r.singles===2 && r.singlesSum===500000, r);
  t('a purchase never enters the person rows', r.groups.every(g=>g[0]!=='highlands|b'), r.groups);
  t('a person filter shows that person across every p2p leaf and hides everyone else', JSON.stringify(r.hide)===JSON.stringify([false,false,true,true]), r.hide);
  t('with no person filter the category filter judges as before', r.hideCat[0]===true, r.hideCat);
}

console.log('\n-- select-all acts on the cards you can SEE --');
{
  const c=ctxWithTree();
  vm.runInContext('var csvCatFilter=null, csvPersonFilter=null, csvSelTouched=false, renders=0; var csvReview=null;'
    +'function csvDisarmRemove(){} function csvFlushExpand(){} function renderCsvReview(){renders++;} function csvFxUnresolved(){return false;}'
    +'var csvTreeLeafOf=function(){return {leaf:"?"};}; var csvBaseAmt=function(a){return a;};\n'
    +['csvNodeNotSpending','csvRowGroup','csvPersonKeyOf','csvIsP2P','csvCatHide','csvStagedSelectAll'].map(n=>sliceFn(S56,n)).join('\n'),c);
  const r=vm.runInContext(`(function(){
    var A={_node:'p2p',counterparty:'13610000120606 - LE KHA NIN',description:'',amount:5000000,_skipImport:true};
    var B={_node:'p2p',counterparty:'VO DINH PHUC 0912',description:'',amount:5000000,_skipImport:true};
    var X={_node:'coffee',counterparty:'HIGHLANDS',description:'',amount:60000,_skipImport:true};
    csvReview={ready:[A,B,X]};
    csvStagedSelectAll(true); var all=[A._skipImport,B._skipImport,X._skipImport];
    A._skipImport=B._skipImport=X._skipImport=true;
    csvPersonFilter='le kha nin|d'; csvStagedSelectAll(true); var person=[A._skipImport,B._skipImport,X._skipImport];
    return {all:all, person:person}; })()`,c);
  t('no filter: select-all ticks every ready row, exactly as before', JSON.stringify(r.all)===JSON.stringify([false,false,false]), r.all);
  t('a person filter on: select-all ticks ONLY that person\'s rows; hidden rows are left as they were', JSON.stringify(r.person)===JSON.stringify([false,true,true]), r.person);
}

console.log('\n-- three children under p2p, client-assignable only (P3) --');
{
  const tax=JSON.parse(rd('taxonomy/taxonomy.json'));
  const kids=tax.nodes.filter(n=>n.parent==='p2p').map(n=>n.code).sort();
  t('p2p has exactly split · payback · onbehalf · regular', JSON.stringify(kids)===JSON.stringify(['onbehalf','payback','regular','split']), kids);
  const nw=tax.nodes.filter(n=>['payback','onbehalf','regular'].includes(n.code));
  t('the new children carry no keywords: no worker tier can ever emit them (no redeploy needed)', nw.every(n=>!n.kw) && nw.every(n=>n.depth===2 && n.kind==='expense'), nw);
  /* The rule is "the tree version moved when the tree changed" — not "it is
     forever 2". The sport split bumped it to 3 on the same day. */
  t('taxonomy version bumped when the tree changed', tax.version>=2 && tax.updated==='2026-09-29', [tax.version,tax.updated]);
  const gen=rd('src/js-ui/11-taxonomy.js');
  t('the generated client tree carries them', /"payback"/.test(gen) && /"onbehalf"/.test(gen) && /"regular"/.test(gen));
}

console.log('\n'+(fail?fail+' FAILED, ':'ALL ')+pass+' PASSED'); process.exit(fail?1:0);
