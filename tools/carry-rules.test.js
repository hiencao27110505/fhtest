#!/usr/bin/env node
/* Rules for later rows. `node tools/carry-rules.test.js`
 *
 * docs/specs/carry-rules-spec.md. A rule is the carry extended to rows that have not
 * arrived yet: made in the carry sheet, kept in the encrypted lessons record, applied
 * to waiting rows over every machine tier and under the person's own pick. Real
 * functions throughout: 66-rules.js and 24-lessons.js whole, the carry machinery sliced
 * whole from 56/57, the real tree and the real person-to-person test from 13.
 */
const fs=require('fs'),vm=require('vm'),path=require('path');
const ROOT=path.join(__dirname,'..');
let pass=0,fail=0; const t=(n,ok,d)=>{console.log((ok?'  PASS  ':'  FAIL  ')+n+(!ok&&d!==undefined?'  -> '+JSON.stringify(d):'')); ok?pass++:fail++;};
const rd=f=>fs.readFileSync(path.join(ROOT,f),'utf8');
const sliceFn=(src,name)=>{const k=src.indexOf('function '+name+'('); if(k<0) throw new Error('no '+name); return src.slice(k,src.indexOf('\n}',k)+2);};
const sliceVar=(src,name)=>{const m=src.match(new RegExp('^var '+name+' = .*$','m')); if(!m) throw new Error('no var '+name); return m[0];};
const S56=rd('src/js-ui/56-csv-import-ui.js'), S57=rd('src/js-ui/57-csv-import-review.js'), S61=rd('src/js-ui/61-expense-detail.js');
const S66=rd('src/js-ui/66-rules.js'), S24=rd('src/js-data/24-lessons.js'), S72=rd('src/js-data/72-txn-review.js'), S76=rd('src/js-data/76-quick-review.js');

function mk(server){
  const db={ row: server==null ? null : JSON.stringify(server), pushes:0 };
  const q={ select(){return q;}, eq(){return q;},
    async maybeSingle(){ return { data: db.row==null?null:{lessons_enc:db.row}, error:null }; },
    async upsert(r){ db.pushes++; db.row=r.lessons_enc; return { error:null }; } };
  const timers=[];
  const ctx={ console, Date, JSON, Object, String, Promise, Math, Number, Array,
    localStorage:{getItem:()=>null,setItem:()=>{},removeItem:()=>{}}, L:v=>v, esc:s=>String(s), escAttr:s=>String(s), fmt:n=>String(n),
    csvCatLabel:s=>String(s), csvTxrLbl:s=>String(s), curMult:()=>1000, navigator:{onLine:true},
    setTimeout:(f)=>{ timers.push(f); return timers.length; }, clearTimeout(){},
    FHCrypto:{ encVal:async(k,v)=>v, decVal:async(k,v)=>v }, fhPersonalData:()=>({uid:'u1',key:'k'}),
    deburr:s=>String(s||'').normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/đ/g,'d').replace(/Đ/g,'D'), toast(){} };
  ctx.window=ctx; ctx.sb={ from:()=>q }; ctx.fhPersonalKeyReady=()=>!ctx.__locked;
  vm.createContext(ctx);
  vm.runInContext(rd('src/js-ui/11-taxonomy.js'),ctx); vm.runInContext(rd('src/js-ui/13-partition.js'),ctx);
  vm.runInContext([sliceVar(S57,'CSV_GATEWAYS'),sliceVar(S57,'CSV_BANK_NOISE'),sliceFn(S57,'csvPatternKey'),sliceFn(S57,'csvAmountBand')].join('\n'),ctx);
  vm.runInContext(`var csvReview=null, csvStagedMode=true, csvFixes={}, csvFixSeq=0, renders=0, csvRowSheet=null, csvExpand=null;
    function renderCsvReview(){ renders++; } function csvStagedProvider(c){ return c._bank||''; }
    function csvScopeReady(){ return true; } function csvStagedScope(){ return 'personal'; } var csvTxrRoutes={};
    function csvRowScope(c){ return c._scope || csvTxrRoutes[c._bank] || 'personal'; }
    function csvXferAccounts(){ return []; } function csvPayCardFor(r){ return r._payCardId||''; }
    function csvStagedSelected(){ return ((csvReview&&csvReview.ready)||[]).filter(function(c){ return !c._skipImport; }); }
    function csvFxUnresolved(){ return false; } function fhProviderName(s){ return s; }`,ctx);
  vm.runInContext(['CSV_FIX_LBL','CSV_FIX_ORDER'].map(n=>sliceVar(S56,n)).join('\n'),ctx);
  vm.runInContext(['csvScopeClearKinds','csvRowKindCur','csvSimKey','csvHandMark','csvFixKindRow','csvFixKey','csvFixPayee','csvFixPayeeName','csvKindLbl',
    'csvFixSnap','csvFixRestore','csvFixCandidates','csvFixXferOk','csvFixKindCopy'].map(n=>sliceFn(S56,n)).join('\n'),ctx);
  vm.runInContext(S24,ctx);
  vm.runInContext(S66,ctx);
  const flush=async()=>{ while(timers.length){ timers.shift()(); } for(let i=0;i<30;i++) await Promise.resolve(); };
  return { ctx, db, flush, run:(code)=>vm.runInContext(code,ctx) };
}

(async()=>{
  const P2='970400123456 - TRAN MINH KHOA';

  console.log('\n-- the match (R6, R17, R23) --');
  {
    const { run }=mk();
    const r=run(`(function(){
      var rules=[
        { id:'merch', k:'p:grab', dir:'out', band:null, set:{ cat:'Đi lại' }, t:1 },
        { id:'old',   k:'p:x',    dir:'out', band:null, set:{ cat:'A', node:'rent' }, t:1 },
        { id:'new',   k:'p:x',    dir:'out', band:null, set:{ cat:'B' }, t:5 },
        { id:'band',  k:'p:x',    dir:'out', band:'d',  set:{ cat:'C' }, t:2 },
        { id:'in',    k:'p:x',    dir:'in',  band:null, set:{ inccat:'Hoàn tiền' }, t:9 }];
      var a=fhRuleMatch({k:'p:grab',dir:'out',amount:30000},rules), b=fhRuleMatch({k:'p:grab',dir:'out',amount:3000000},rules);
      var c=fhRuleMatch({k:'p:x',dir:'out',amount:100000},rules), d=fhRuleMatch({k:'p:x',dir:'out',amount:7000000},rules);
      var e=fhRuleMatch({k:'p:x',dir:'in',amount:7000000},rules), f=fhRuleMatch({k:'p:y',dir:'out',amount:1},rules);
      return { a:a.cat&&a.cat.v, b:b.cat&&b.cat.v, c:c.cat.v, cn:c.node&&c.node.v, d:d.cat.v, dn:d.node&&d.node.v, e:Object.keys(e).join(), ein:e.inccat&&e.inccat.v, f:Object.keys(f).length };
    })()`);
    t('a merchant rule matches at any amount', r.a==='Đi lại' && r.b==='Đi lại', r);
    t('per field: the newer rule wins, and an older one still gives the field only it sets', r.c==='B' && r.cn==='rent', r);
    t('a banded rule beats an amount-free one inside its band', r.d==='C' && r.dn==='rent', r);
    t('a rule only matches its own direction of money', r.e==='inccat' && r.ein==='Hoàn tiền', r);
    t('another key matches nothing', r.f===0, r);
  }

  console.log('\n-- the pass over waiting rows (R7, R15) --');
  {
    const { run }=mk();
    const r=run(`(function(){
      var rules=[{ id:'r1', k:'p:'+csvPatternKey({counterparty:'${P2}',description:''}), dir:'out', band:'d', set:{ scope:'family', cat:'Nhà ở', node:'rent' }, t:1 }];
      window.fhRulesAll=function(){ return rules; };
      var mach={ counterparty:'${P2}', description:'chuyen tien', amount:7000000, isIncome:false, categoryName:'Khác', catSource:'fallback', _node:'p2p', _nodeSource:'pipeline', _stagedId:'s1' };
      var hand=Object.assign({}, mach, { _stagedId:'s2', categoryName:'Ăn ngoài', catSource:'user', _hand:{ cat:1 } });
      var small=Object.assign({}, mach, { _stagedId:'s3', amount:200000 });
      var loan=Object.assign({}, mach, { _stagedId:'s4', _loan:true, _loanWho:'Khoa' });
      csvReview={ ready:[mach, hand, small, loan], groups:[], dup:[], deferred:[] };
      var n=csvRulesApplyQueue([{id:'s1'},{id:'s2'},{id:'s3'},{id:'s4'}]);
      var marked=csvRulesRows().length;
      var line=csvRuleLineHTML(mach,'cat'), line2=csvRuleLineHTML(hand,'cat');
      var m=[mach._scope, mach.categoryName, mach.catSource, mach._node, mach._nodeSource, mach._rule.cat].join('|');
      csvRuleUnwrite(mach, ['r1']);
      return { n:n, m:m,
        h:[hand.categoryName, hand._node, hand._scope].join('|'), s:[small.categoryName, small._node].join('|'), l:[loan.categoryName, loan._node, !!loan._loan].join('|'),
        marked:marked, line:line, line2:line2, back:[mach._scope||'', mach.categoryName, mach.catSource, mach._node, mach._nodeSource, JSON.stringify(mach._rule)].join('|') };
    })()`);
    t('a rule fills a waiting row over the machine: Phạm vi, Danh mục and Tiêu vào gì', r.m==='family|Nhà ở|rule|rent|rule|r1', r);
    t('a field set by hand is never overwritten; the rest of that row still follows the rule', r.h==='Ăn ngoài|rent|family', r);
    t('a banded rule leaves a row of another size alone', r.s==='Khác|p2p', r);
    t('a rule that sends the row to Gia đình clears a personal-only kind the machine guessed, then fills it', r.l==='Nhà ở|rent|false', r);
    t('the card says "Theo quy tắc" and opens the rule; not on a field set by hand', /Theo quy tắc/.test(r.line) && /fhRuleOpen\('r1'\)/.test(r.line) && r.line2==='', r);
    t('the summary counts rows a rule filled, the hand-set one included (two of its fields are the rule\'s); not the other size', r.marked===3, r);
    t('a removed rule puts back exactly what the machine said', r.back==='|Khác|fallback|p2p|pipeline|{}', r);
  }

  console.log('\n-- pins: values kept on one waiting row after its rule changed (R24) --');
  {
    const { run, flush, ctx }=mk({ kind:{}, cat:{}, node:{}, tomb:{}, rule:{}, pin:{}, route:{} });
    await run(`fhRulesReady()`);
    const r=run(`(function(){
      var k='p:'+csvPatternKey({counterparty:'HIGHLANDS COFFEE',description:''});
      fhRuleSave({ id:'r1', k:k, dir:'out', band:null, set:{ cat:'Đi lại' }, name:'GRAB' });
      var a={ counterparty:'HIGHLANDS COFFEE', description:'highlands', amount:50000, isIncome:false, categoryName:'Khác', _stagedId:'s1' };
      var b={ counterparty:'HIGHLANDS COFFEE', description:'highlands', amount:50000, isIncome:false, categoryName:'Khác', _stagedId:'s2' };
      csvReview={ ready:[a,b], groups:[], dup:[], deferred:[] };
      csvRulesApplyQueue([{id:'s1'},{id:'s2'}]);
      var waiting=csvRuleWaiting('r1').length;
      csvRulePinRows([a], 'r1');                 // "giữ như cũ" for a
      fhRuleDelete('r1'); csvRuleRefill([b], 'r1');
      var a2={ counterparty:'HIGHLANDS COFFEE', description:'highlands', amount:50000, isIncome:false, categoryName:'Khác', _stagedId:'s1' };
      var b2={ counterparty:'HIGHLANDS COFFEE', description:'highlands', amount:50000, isIncome:false, categoryName:'Khác', _stagedId:'s2' };
      csvReview={ ready:[a2,b2], groups:[], dup:[], deferred:[] };
      fhStagedTotal=2; csvRulesApplyQueue([{id:'s1'},{id:'s2'}]);    // the next open
      var mark=csvRuleMarked(a2);
      csvReview={ ready:[b2], groups:[], dup:[], deferred:[] };
      fhStagedTotal=1; csvRulesApplyQueue([{id:'s2'}]);               // s1 was imported
      return { waiting:waiting, a:a.categoryName, b:b.categoryName, a2:a2.categoryName, b2:b2.categoryName, mark:mark, pins:Object.keys(fhRulePins()).join() };
    })()`);
    await flush();
    t('the rule\'s screen knows how many waiting rows it filled', r.waiting===2, r);
    t('"xếp lại" puts the machine\'s answer back; "giữ như cũ" keeps the row as it is', r.b==='Khác' && r.a==='Đi lại', r);
    t('a pin survives the next open, and shows no "Theo quy tắc" (the rule is gone)', r.a2==='Đi lại' && r.b2==='Khác' && r.mark===false, r);
    t('a pin is dropped once its row is no longer waiting', r.pins==='', r);
  }

  console.log('\n-- the store: encrypted, synced, deletions stick (R10) --');
  {
    const A=mk({ kind:{}, cat:{}, node:{}, tomb:{}, rule:{ r9:{ id:'r9', k:'p:x', dir:'out', set:{cat:'A'}, t:1 } }, pin:{}, route:{ VIB:{ v:'family', t:1 } } });
    await A.run(`fhRulesReady()`);
    A.run(`fhRuleSave({ id:'r1', k:'p:grab', dir:'out', band:null, set:{ cat:'Đi lại' }, name:'GRAB' }); fhRuleDelete('r9');`);
    await A.flush();
    const blob=JSON.parse(A.db.row);
    t('a saved rule is in the record, a deleted one is gone with a tombstone', !!blob.rule.r1 && !blob.rule.r9 && !!blob.tomb['rule|r9'], blob);
    const B=mk(Object.assign({}, blob, { rule:Object.assign({}, blob.rule, { r9:{ id:'r9', k:'p:x', dir:'out', set:{cat:'A'}, t:1 } }) }));   // an older device still holds r9
    await B.run(`fhRulesReady()`);
    t('an older device cannot bring a deleted rule back', B.run(`fhRulesAll().map(function(r){return r.id;}).join()`)==='r1');
    t('bank routes come back from the record', B.run(`JSON.stringify(fhRoutesSynced())`)==='{"VIB":"family"}');
  }

  console.log('\n-- making one from the carry (R5, R11, R19) --');
  {
    const { run }=mk({ kind:{}, cat:{}, node:{}, tomb:{}, rule:{}, pin:{}, route:{} });
    await run(`fhRulesReady()`);
    const r=run(`(function(){
      var c={ counterparty:'${P2}', description:'chuyen tien', amount:7000000, isIncome:false, categoryName:'Nhà ở', _node:'rent',
              _fix:{ id:1, items:{ cat:{f:'cat',v:'Nhà ở'}, node:{f:'node',v:'rent'} } } };
      var d=csvRuleDraft(c);
      var blk=fhRuleBlock(d, false, 'x()');
      var u1=fhRuleCommit(d), n1=fhRulesAll().length;
      var d2=csvRuleDraft({ counterparty:'${P2}', description:'chuyen tien', amount:6000000, isIncome:false, _fix:{ id:2, items:{ cat:{f:'cat',v:'Khác'} } } });
      var blk2=fhRuleBlock(d2, false, 'x()');
      var u2=fhRuleCommit(d2), r2=fhRuleGet(u1.id);
      fhRuleRevert(u2); var r3=fhRuleGet(u1.id);
      fhRuleRevert(u1);
      var m={ counterparty:'Grab', description:'GRAB*FOOD', amount:85000, isIncome:false, _bank:'VIB', _fix:{ id:3, items:{ cat:{f:'cat',v:'Ăn uống'} } } };
      var dm=csvRuleDraft(m);
      return { band:d.band, name:d.name, k:d.k.slice(0,2), label:blk.label, sub:blk.sub, n1:n1, upd:u2.id===u1.id, label2:blk2.label, cat2:r2.set.cat, node2:r2.set.node,
               back:r3.set.cat, gone:fhRulesAll().length, mband:dm.band };
    })()`);
    t('a person\'s rule takes the edited row\'s amount band; a merchant\'s matches any amount', r.band==='d' && r.mband===null, r);
    t('the switch says "Cả các khoản sau này" and spells the rule out in one line', r.label==='Cả các khoản sau này' && r.sub==='Chi từ 5tr cho TRAN MINH KHOA: Nhà ở, Tiền nhà', r);
    t('the payee\'s name loses the account digits', r.name==='TRAN MINH KHOA', r);
    t('the same payee, size and direction again changes that rule ("Đổi quy tắc"), never a second one', r.n1===1 && r.upd && r.label2==='Đổi quy tắc' && r.cat2==='Khác' && r.node2==='rent', r);
    t('undo puts the rule back as it was, or removes the one it made', r.back==='Nhà ở' && r.gone===0, r);
    const lk=run(`(function(){ var d={ k:'p:abcdefg', dir:'out', band:null, set:{cat:'A'}, name:'X' };
      var on=!!fhRuleBlock(d,false,''); window.__locked=true; var off=fhRuleBlock(d,false,''); window.__locked=false;
      csvStagedMode=false; var file=csvFixRuleBlock({ counterparty:'HIGHLANDS COFFEE', description:'', amount:1, _fix:{ id:9, items:{ cat:{f:'cat',v:'A'} } } }); csvStagedMode=true;
      return { on:on, off:off, file:file }; })()`);
    t('no switch when the personal ledger is locked, and none in the file import', lk.on===true && lk.off===null && lk.file===null, lk);
  }

  console.log('\n-- the ledger and quick review use the same rules (R21, R28) --');
  {
    const { run }=mk({ kind:{}, cat:{}, node:{}, tomb:{}, rule:{}, pin:{}, route:{} });
    await run(`fhRulesReady()`);
    const r=run(`(function(){
      var d=fhRuleDraftLedger({ who:'${P2}', note:'chuyen tien', amt:7000 }, { cat:'Nhà ở', node:'rent' }, 'TRAN MINH KHOA');
      var c={ counterparty:'${P2}', description:'chuyen tien', amount:7000000, isIncome:false };
      var same=d.k===csvFixKey(c);
      fhRuleCommit(d);
      var q=fhRuleForQuick({ counterparty:'${P2}', description:'chuyen tien', amount:7000000, dir:'out', stagedId:'s1' });
      fhRuleCommit({ k:'p:'+csvPatternKey({counterparty:'NGUYEN VAN AN',description:''}), dir:'out', band:null, name:'AN', set:{ kind:{ cur:'loan', loan:true, loanWho:'An' } } });
      var q2=fhRuleForQuick({ counterparty:'NGUYEN VAN AN', description:'', amount:1000000, dir:'out' });
      return { band:d.band, same:same, qcat:q&&q.m.cat.v, qfull:q&&q.full, q2full:q2&&q2.full };
    })()`);
    t('a rule made in the book has the queue\'s key, so it fills the queue', r.same && r.band==='d', r);
    t('quick review gets the same values; a loan rule sends the row to the full queue', r.qcat==='Nhà ở' && r.qfull===false && r.q2full===true, r);
  }

  console.log('\n-- the merchant lesson without a size (carry-rules-spec §9) --');
  {
    const { run, flush }=mk({ kind:{}, cat:{}, node:{}, tomb:{}, rule:{}, pin:{}, route:{} });
    await run(`fhRulesReady()`);
    const r=run(`(function(){
      fhLessonLearnNode({ counterparty:'HIGHLANDS COFFEE', memo:'HIGHLANDS', amount:30000, node:'eatout' });
      fhLessonLearnNode({ counterparty:'${P2}', memo:'chuyen tien', amount:7000000, node:'rent' });
      var m=fhLessonNode({ counterparty:'HIGHLANDS COFFEE', memo:'HIGHLANDS', amount:300000 });
      var p=fhLessonNode({ counterparty:'${P2}', memo:'chuyen tien', amount:30000 });
      var n=fhLessonsCount();
      fhLessonForgetNode({ counterparty:'HIGHLANDS COFFEE', memo:'HIGHLANDS', amount:30000 });
      var g=fhLessonNode({ counterparty:'HIGHLANDS COFFEE', memo:'HIGHLANDS', amount:300000 });
      return { m:m, p:p, n:n, g:g };
    })()`);
    await flush();
    t('a merchant taught at 30k is known at 300k', r.m==='eatout', r);
    t('a person taught at 7tr is NOT carried to a 30k transfer', r.p===null, r);
    t('the count is one per lesson, not one per key', r.n===2, r);
    t('forgetting the lesson forgets its amount-free twin when they agree', r.g===null, r);
  }

  console.log('\n-- wiring --');
  t('72: the pass runs after the stamp, before the first paint', /_stamp\(_rv\.ready\)[\s\S]{0,700}csvRulesApplyQueue\(readable\)[\s\S]{0,200}renderCsvReview\(\)/.test(S72));
  t('56: the sheet\'s CTA saves the rule after the rows; undo takes it back', /var ru = rl && typeof csvFixRuleSave === 'function' \? csvFixRuleSave\(c\) : null;/.test(S56) && /fhRuleRevert\(fx\.rule\); fx\.rule = null;/.test(S56));
  t('56: a node a rule set is not replaced by the composer\'s guess at import', /c\._nodeSource === 'user' \|\| c\._nodeSource === 'rule'\) return nd;/.test(S56));
  t('56: the summary row sits on top of the queue; Chỉnh sửa opens the rules', /csvRulesSumHTML\(\)/.test(S56) && /csvEditRules\(\)/.test(S56));
  t('61: Lưu saves a rule switched on before it; the after-save sheet saves after the rows', /_ru=fhRuleCommit\(fhRuleDraftLedger\(_cy, _cy\.fields, _pre\.name\)\)/.test(S61) && /var u=_pexdCarryRuleSave\(cy\);\s+\/\/ after the rows landed/.test(S61));
  t('76: quick review asks the rules and says "theo quy tắc" instead of "gợi ý"', /fhRuleForQuick\(/.test(S76) && /L\('theo quy tắc', 'by rule'\)/.test(S76));
  t('rules never write to merchant_corrections', !/fhSyncMerchantCorrection\(|from\('merchant_corrections'\)/.test(S66));
  const HTML=rd('src/index.html');
  t('the modal and the Cài đặt row exist', /id="rule-modal"/.test(HTML) && /onclick="closeSheet\(\);fhRulesOpen\(\)"/.test(HTML) && /setRules:'Quy tắc'/.test(rd('src/js-ui/70-theme-i18n.js')));

  console.log('\n'+(fail?fail+' FAILED, ':'ALL ')+pass+' PASSED');
  process.exit(fail?1:0);
})().catch(e=>{ console.log('  FAIL  the test ran  -> '+(e&&e.stack||e)); process.exit(1); });
