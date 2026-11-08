/* Built states for the consent gate (docs/briefs/consent-gate.md), same shot names
   as consent-gate-target.js. Nothing is injected: every frame is the real code
   drawing from the harness fixture, a bank_email v4 person. The staged queue is
   seeded the way queue-perf.js does (the direct build path), then renderCsvReview
   draws the status block itself. */
const H = `
try{ if(window._closeOv) _closeOv(); closeModals(); closeSheet(); }catch(e){}
try{ var _ts=document.getElementById('toast'); if(_ts) _ts.classList.remove('on'); }catch(e){}
window.__cg = window.__cg || {};
__cg.seedQueue = function(){
  var rows=[], now=Date.now();
  var mk=function(i, cp, memo, amt, income){
    var at=new Date(now - i*5*3600e3);
    return { id:'q'+i, gmail_message_id:'m'+i, occurred_at:at.toISOString(), amount:amt, currency:'VND', direction:income?'in':'out',
      counterparty:cp, source_provider:'VIB', review_status:'pending', staging_scope:'personal', row_kind:'txn',
      raw_extracted:{ v:2, amount:amt, currency:'VND', direction:income?'in':'out', counterparty:cp, memo_display:memo, txn_source:'direct-email', account_kind:'deposit', account_tail:'5140' } };
  };
  rows.push(mk(1,'HIGHLANDS COFFEE','HIGHLANDS COFFEE QUAN 1',65000));
  rows.push(mk(2,'GRAB','GRAB*RIDE',48000));
  rows.push(mk(3,'CO.OPMART','CO.OPMART NHIEU LOC',412000));
  rows.push(mk(4,'NGUYEN THI HOA','NGUYEN THI HOA chuyen tien',2000000,true));
  window.csvEntryScope = window.fhNormScope ? fhNormScope({ kind:'personal' }) : { kind:'personal' };
  window._fhStagedRows = rows; window._fhQueueNewAccts = []; window.csvStagedMode = true;
  try{ csvLearnLoad(); }catch(e){}
  var COLS=['occurred_at','description','amount','counterparty','category'], columnMap={};
  COLS.forEach(function(f,i){ columnMap[i]={ field:f, confidence:1 }; });
  var src={ name:'staged', parsed:{ headers:COLS, rows: rows.map(function(r){ var x=r.raw_extracted||{}; return [r.occurred_at, x.memo_display||'', String(r.direction==='in'?r.amount:-r.amount), r.counterparty||'', '']; }) }, result:{ columnMap:columnMap } };
  csvBuildReview([src], {});
  renderCsvReview();
  var pick=document.getElementById('csv-pick'); if(pick) pick.style.display='none';
  openSheet('csv-import-modal');
};
/* the consent record is read once per tab; make sure it has been, so the first
   paint is the real state and not the "nothing read yet" blank */
__cg.primed = function(fn){ (window.fhConsentState ? fhConsentState() : Promise.resolve()).then(function(){ setTimeout(fn, 80); }); };
`;
const CONN = `{ id:'g1', email:'quang@gmail.com', account_email:'quang@gmail.com', phase:'idle', scope:'personal', last:new Date(Date.now()-3600e3).toISOString(), backfilled:true }`;

module.exports = {
  feature: 'consent-gate',
  langs: ['vi', 'en'],
  themes: ['sage'],
  shots: [
    { name: '01-queue-line', settleMs: 1100, setup: H + `__cg.primed(function(){ __cg.seedQueue(); });` },
    { name: '01-queue-empty', settleMs: 1000, setup: H + `__cg.primed(function(){ fhTxnReviewSheet({ kind:'personal' }); });` },
    { name: '01-settings-rows', settleMs: 1300, setup: H + `__cg.primed(function(){ fhAutoTxnStatus(${CONN}); });` },
    { name: '02-sheet-scoped', settleMs: 1000, setup: H + `__cg.primed(function(){ fhConsentNeed('statements', function(){}); });` },
    /* agree for real against the stub (the write log records the insert), then reopen the queue */
    { name: '03-agreed', settleMs: 1400, setup: H + `__cg.primed(function(){
        fhConsentNeed('statements', function(){}).then(function(){
          setTimeout(function(){ var b=document.getElementById('cst-agree'); if(b) b.click();
            setTimeout(function(){ __cg.seedQueue(); }, 500); }, 250);
        });
      });` },
    /* a v6 person is not in the fixture: this frame shows the real on-row for the
       current record (after the agree above, both rows are on), with the store list */
    { name: '05-stores-off', settleMs: 1300, setup: H + `__cg.primed(function(){
        fhConsentNeed('receipts', function(){}).then(function(){
          setTimeout(function(){ var b=document.getElementById('cst-agree'); if(b) b.click();
            setTimeout(function(){ fhAutoTxnStatus(${CONN}); }, 500); }, 250);
        });
      });` }
  ]
};
