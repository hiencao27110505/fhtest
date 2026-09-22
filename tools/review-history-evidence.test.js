#!/usr/bin/env node
/* The review must not copy a wrong node out of the ledger. `node tools/review-history-evidence.test.js`
 *
 * 2026-09-22, a real card: "Thanh toán GRAB", a MoMo statement row, label "Đi lại",
 * tree node "Thanh toán cho người bán". Nothing in the RULES said that: the v565
 * sweep had written that node onto every logged Grab row, and the review's history
 * tier copied it onto each new one, ahead of the server hint and the label that
 * knew better. The real buildCsvCandidates is run here against a seeded ledger;
 * the parsers it needs are the real ones, the DOM-only helpers are stubbed.
 */
const fs=require('fs'),vm=require('vm'),path=require('path'),cp=require('child_process');
const ROOT=path.join(__dirname,'..');
let pass=0,fail=0; const t=(n,ok,d)=>{console.log((ok?'  PASS  ':'  FAIL  ')+n+(!ok&&d!==undefined?'  -> '+JSON.stringify(d):'')); ok?pass++:fail++;};
function run(rev, ledger){
  const rd=f=>rev?cp.execSync(`git -C ${ROOT} show ${rev}:${f}`,{maxBuffer:1e8}).toString():fs.readFileSync(path.join(ROOT,f),'utf8');
  const src=rd('src/js-ui/57-csv-import-review.js'); const j=src.indexOf('function buildCsvCandidates'); let fn=src.slice(j,src.indexOf('\n}',j)+2);
  // the small top-level helpers buildCsvCandidates calls in this file, taken whole from the same source
  for (const name of ['fhIsV2','fhKindFromSignal','_isSelfTransfer']) { const k=src.indexOf('function '+name); if (k>=0) fn=src.slice(k,src.indexOf('\n}',k)+2)+'\n'+fn; }
  // a ledger the v565 sweep poisoned: a logged Grab row filed as "paid to a seller" under the label Đi lại
  const ctx={window:{txns:[],catClaims:{},csvStagedMode:true,fhStagedNode:()=>null,fhPersonalData:()=>({txns:ledger,labels:[]})},localStorage:{getItem:()=>null,setItem:()=>{}},L:v=>v,console,
    normDescForDedup:x=>String(x||'').trim().toLowerCase().replace(/\s+/g,' '),deburr:s=>String(s||'').normalize('NFD').replace(/[̀-ͯ]/g,''),
    csvHistoryCategoryMap:()=>({}),matchCategoryName:()=>null,csvLearnedCat:()=>null,csvCatOk:()=>true,familyCatForConcept:c=>c==='Transport'?'Đi lại':null,
    CAT_FALLBACK:'Others',parseCsvAmount:x=>Number(x),parseCsvDate:()=>({date:new Date('2026-05-22'),display:'22/05'}),fhLessonNode:null,curMult:1,parseCsvDateValue:()=>null};
  ctx.fhPersonalData=ctx.window.fhPersonalData; ctx.csvMerchantConcept=()=>null; vm.createContext(ctx);
  vm.runInContext(rd('src/js-data/45-csv-import.js').replace(/^\s*(import|export) .*$/mg,''),ctx);
  vm.runInContext(rd('src/js-ui/11-taxonomy.js'),ctx); vm.runInContext(rd('src/js-ui/13-partition.js'),ctx);
  vm.runInContext(fn+';globalThis.__B=buildCsvCandidates;',ctx);
  // the staged statement row exactly as the screenshot shows it
  ctx.window.fhStagedNode=()=>({node:null,concept:'Transport',receipt:false});
  const parsed={rows:[['22/05/2026','-56000','Thanh toán GRAB','GRAB']]};
  const result={columnMap:{0:{field:'occurred_at',confidence:1},1:{field:'amount',confidence:1},2:{field:'description',confidence:1},3:{field:'counterparty',confidence:1}}};
  try{ const out=ctx.__B(parsed,result)[0]; return {node:out._node,source:out._nodeSource}; }catch(e){ return {error:String(e.message).slice(0,140)}; }
}

const GRAB=(node,cat)=>({id:'g1',kind:'expense',note:'Thanh toán GRAB',cat:cat||'Đi lại',emoji:'🚗',amt:52000,node:node,labelId:null});
let r=run(null,[GRAB('purchase')]);
t('a logged Grab row poisoned with "paid to a seller" is NOT copied; the hint answers "Đi lại"', r.node==='transport'&&r.source==='concept', r);
r=run(null,[GRAB('carhail')]);
t('a logged Grab row a person filed as "Ô tô công nghệ" IS copied: history that says WHAT still wins', r.node==='carhail'&&r.source==='history', r);
r=run(null,[GRAB('coffee','Đi lại')]);
t('a logged node the row\'s own label contradicts is a stale guess, not history', r.node==='transport'&&r.source==='concept', r);
r=run(null,[]);
t('with no history at all the hint still answers', r.node==='transport'&&r.source==='concept', r);
console.log('\n'+(fail?fail+' FAILED, ':'ALL ')+pass+' PASSED'); process.exit(fail?1:0);
