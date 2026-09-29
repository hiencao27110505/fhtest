#!/usr/bin/env node
/* The review asks the memo's SHAPE before its words. `node tools/review-shape-tier.test.js`
 *
 * 2026-09-29, the founder's own queue: "Chuyển cho người khác" ×113 for 966tr — 78% of
 * the queue's outflow — while the same node on the booked ledger read 8,5tr. The
 * ledger sweep has asked fhTransferShape first among the machine tiers since E2
 * (a 20-digit exchange-desk order id, an ATM line, "chuyen tien den <own name>");
 * the review never called it, and the server cannot (broker_funding needs a broker
 * as sender; an exchange desk is paid through the person's own bank). Then three
 * downstream gates — the queue's grouping/sum, the family import, the personal
 * import — each rejected a transfer-kind node on an expense row, so even a
 * correctly shaped row would have lost its node on Nhập. (docs/specs/p2p-breakdown-spec.md P6)
 *
 * The real buildCsvCandidates runs here against an empty ledger, with the real
 * taxonomy and the real partition; the DOM-only helpers are stubbed, as in
 * review-history-evidence.test.js. Then the three pure gates in 56, sliced whole.
 */
const fs=require('fs'),vm=require('vm'),path=require('path');
const ROOT=path.join(__dirname,'..');
let pass=0,fail=0; const t=(n,ok,d)=>{console.log((ok?'  PASS  ':'  FAIL  ')+n+(!ok&&d!==undefined?'  -> '+JSON.stringify(d):'')); ok?pass++:fail++;};
const rd=f=>fs.readFileSync(path.join(ROOT,f),'utf8');
const slice=(src,name)=>{const k=src.indexOf('function '+name); if(k<0) throw new Error('no '+name); return src.slice(k,src.indexOf('\n}',k)+2);};

function review(row, opts){
  opts=opts||{};
  const src=rd('src/js-ui/57-csv-import-review.js');
  let fn=slice(src,'buildCsvCandidates');
  for (const name of ['fhIsV2','fhKindFromSignal','_isSelfTransfer']) fn=slice(src,name)+'\n'+fn;
  const ctx={window:{txns:[],catClaims:{},csvStagedMode:true,fhStagedNode:()=>({node:opts.pipeline||null,concept:null,receipt:false}),
      fhPersonalData:()=>({txns:[],labels:[]}), fhLessonNode:opts.lesson?(()=>opts.lesson):null},
    localStorage:{getItem:()=>null,setItem:()=>{}},L:v=>v,console,
    normDescForDedup:x=>String(x||'').trim().toLowerCase().replace(/\s+/g,' '),deburr:s=>String(s||'').normalize('NFD').replace(/[̀-ͯ]/g,''),
    csvHistoryCategoryMap:()=>({}),matchCategoryName:()=>null,csvLearnedCat:()=>null,csvCatOk:()=>true,familyCatForConcept:()=>null,
    CAT_FALLBACK:'Others',parseCsvAmount:x=>Number(x),parseCsvDate:()=>({date:new Date('2026-09-20'),display:'20/09'}),curMult:1,parseCsvDateValue:()=>null};
  ctx.fhPersonalData=ctx.window.fhPersonalData; ctx.csvMerchantConcept=()=>null; vm.createContext(ctx);
  vm.runInContext(rd('src/js-data/45-csv-import.js').replace(/^\s*(import|export) .*$/mg,''),ctx);
  vm.runInContext(rd('src/js-ui/11-taxonomy.js'),ctx); vm.runInContext(rd('src/js-ui/13-partition.js'),ctx);
  vm.runInContext(fn+';globalThis.__B=buildCsvCandidates;',ctx);
  const parsed={rows:[row]};
  const result={columnMap:{0:{field:'occurred_at',confidence:1},1:{field:'amount',confidence:1},2:{field:'description',confidence:1},3:{field:'counterparty',confidence:1}}};
  try{ const out=ctx.__B(parsed,result)[0]; return {node:out._node,source:out._nodeSource}; }catch(e){ return {error:String(e.stack).slice(0,300)}; }
}

console.log('\n-- the shape tier, through the real review cascade --');
let r=review(['20/09/2026','-45000000','12345678901234567890','LE VAN HOANG - 0912345678']);
t('a 20-digit exchange-desk order id files as investfund, source "shape" (E18 reaches the queue)', r.node==='investfund'&&r.source==='shape', r);
r=review(['20/09/2026','-25123456','NGUYEN THU TRANG chuyen tien 123456','NGUYEN THU TRANG']);
t('"<sender> chuyen tien <6 digits>" at an amount nobody rounds to is the desk\'s second shape', r.node==='investfund'&&r.source==='shape', r);
r=review(['20/09/2026','-2000000','Rút tiền tại ATM','VIB ATM Q1']);
t('an ATM line is cashout by shape, not spending', r.node==='cashout'&&r.source==='shape', r);
r=review(['20/09/2026','-45000000','12345678901234567890','LE VAN HOANG - 0912345678'],{lesson:'coffee'});
t('a person\'s own lesson still outranks the shape', r.node==='coffee'&&r.source==='learned', r);
r=review(['20/09/2026','-45000000','12345678901234567890','LE VAN HOANG - 0912345678'],{pipeline:'software'});
t('a sealed pipeline node still outranks the shape', r.node==='software'&&r.source==='pipeline', r);
r=review(['20/09/2026','-500000','Cam on anh Lam hehe','13610000120606 - LE KHA NIN']);
t('an ordinary transfer to a person is untouched: still p2p from the who-tier, never a shape', r.node==='p2p'&&r.source!=='shape', r);
r=review(['20/09/2026','-150000','Highlands Coffee','HIGHLANDS COFFEE LE LOI']);
t('a purchase with real words is untouched by the shape tier', r.source!=='shape'&&r.node!=='investfund', r);

console.log('\n-- the three gates below the cascade, sliced whole from 56 --');
{
  const src=rd('src/js-ui/56-csv-import-ui.js');
  const ctx={window:{},localStorage:{getItem:()=>null,setItem:()=>{}},L:v=>v,console};
  vm.createContext(ctx);
  vm.runInContext(rd('src/js-ui/11-taxonomy.js'),ctx); vm.runInContext(rd('src/js-ui/13-partition.js'),ctx);
  ctx.window.FH_TAX=ctx.FH_TAX;
  vm.runInContext(['csvNodeNotSpending','csvRowGroup','csvPromoteNode'].map(n=>slice(src,n)).join('\n')
    +';globalThis.__G={csvNodeNotSpending,csvRowGroup,csvPromoteNode};',ctx);
  const G=ctx.__G;
  t('csvRowGroup: a shape-named transfer on an expense candidate groups as "other", out of TIỀN ĐI ĐÂU', G.csvRowGroup({_node:'investfund'})==='other');
  t('csvRowGroup: a real expense node stays "expense"', G.csvRowGroup({_node:'coffee'})==='expense');
  t('csvRowGroup: a candidate with no node stays "expense" (nothing changes for it)', G.csvRowGroup({})==='expense');
  t('csvNodeNotSpending is the ledger\'s own predicate (fhCountsAsSpending), not a second one', G.csvNodeNotSpending({_node:'bankbank'})===true && G.csvNodeNotSpending({_node:'rent'})===false);
  t('csvPromoteNode: the family import carries a transfer node on an expense row', G.csvPromoteNode({_node:'investfund',_nodeSource:'shape'})==='investfund');
  t('csvPromoteNode: an income node still never rides an expense row', G.csvPromoteNode({_node:'wage',_nodeSource:'shape'})===null);
  t('csvPromoteNode: a loan node still never rides an expense row (only transfer crosses)', G.csvPromoteNode({_node:'toperson',_nodeSource:'shape'})===null);
}

console.log('\n-- the sweep looks again --');
t('the backfill cursor moved with the rule (E10): v10', /fh-tree-bf:v10:/.test(rd('src/js-data/28-tree-backfill.js')) && !/fh-tree-bf:v9:/.test(rd('src/js-data/28-tree-backfill.js')));

console.log('\n'+(fail?fail+' FAILED, ':'ALL ')+pass+' PASSED'); process.exit(fail?1:0);
