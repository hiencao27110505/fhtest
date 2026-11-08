/* Built states for PDF statements (docs/specs/pdf-statements-spec.md §3, §5).
   Real code throughout: the statement card is drawn by 77's own builder from a
   card object pushed into its list; the password step is painted by the real
   flow after pdf.js (served from vendor/pdfjs/) refuses the locked fixture
   without a password; the reader then runs on the synthetic locked PDF the
   tests use (tools/fixtures/statements/). The unreadable-type card (§3) is
   pictured by stubbing this build's reader set, i.e. an older client. */
const H = `
try{ if(window._closeOv) _closeOv(); closeModals(); closeSheet(); }catch(e){}
try{ var _ts=document.getElementById('toast'); if(_ts) _ts.classList.remove('on'); }catch(e){}
window.__pdf = window.__pdf || {};
__pdf.card = function(ext){
  return { id:'stm-'+ext, gmail_message_id:'g-'+ext, part_index:0, source_provider:'Techcombank', received_at:new Date().toISOString(), file_ext:ext, byte_size:39658,
    object_path:'u/stm-'+ext+'.sealed', status:'pending', backfill:false, keyLocked:false,
    meta:{ filename:'19736101992011_Stmt.'+ext, subject:'Techcombank – Thong bao sao ke the tin dung – Statement - 10-2026', part_index:0, file_sha256:'fixture', byte_size:39658, period_month:'2026-10', account_tail:'7890' } };
};
__pdf.queueWithCard = function(ext){
  /* the queue, seeded the way queue-perf does it, with the statement card on top */
  window.csvEntryScope = window.fhNormScope ? fhNormScope({ kind:'personal' }) : { kind:'personal' };
  window._fhStagedRows = []; window._fhQueueNewAccts = []; window.csvStagedMode = true;
  try{ csvLearnLoad(); }catch(e){}
  var COLS=['occurred_at','description','amount','counterparty','category'], columnMap={};
  COLS.forEach(function(f,i){ columnMap[i]={ field:f, confidence:1 }; });
  csvBuildReview([{ name:'staged', parsed:{ headers:COLS, rows:[] }, result:{ columnMap:columnMap } }], {});
  var cards = fhStmtCards(); cards.length = 0; cards.push(__pdf.card(ext));
  renderCsvReview();
  var pick=document.getElementById('csv-pick'); if(pick) pick.style.display='none';
  openSheet('csv-import-modal');
};
__pdf.fixtureFile = function(){
  return fetch('tools/fixtures/statements/credit-card-techcombank.locked.pdf').then(function(r){ return r.arrayBuffer(); })
    .then(function(ab){ return new File([ab], 'credit-card-techcombank.locked.pdf', { type:'application/pdf' }); });
};
`;

module.exports = {
  feature: 'pdf-statements',
  langs: ['vi', 'en'],
  themes: ['sage'],
  shots: [
    /* §3: a PDF card in a build with no PDF reader (an older client): the card says so and points at the file door */
    { name: '01-card-unread', settleMs: 1100, setup: H + `
      window.fhStmtReaders = function(){ return { xlsx:true, csv:true }; };
      __pdf.queueWithCard('pdf');` },
    /* this build: the same card opens */
    { name: '02-card-pdf', settleMs: 1100, setup: H + `
      window.fhStmtReaders = function(){ return { xlsx:true, csv:true, pdf:true }; };   /* shots share a page: undo 01's stub */
      __pdf.queueWithCard('pdf');` },
    /* the file door, then pdf.js refuses the locked file: the real password step */
    { name: '03-password', settleMs: 2500, setup: H + `
      __pdf.queueWithCard('pdf');
      setTimeout(function(){ fhStmtOpenFile('stm-pdf');
        __pdf.fixtureFile().then(function(f){ fhStmtFilePicked({ files:[f] }); });
      }, 400);` },
    /* the right password: the reader runs, the proof passes (no column check), the
       rows are written. The stub has no stage_statement_rows RPC, so that one call
       is answered here as the server would; everything else is the real path. */
    { name: '04-read', settleMs: 5000, setup: H + `
      (function(){ var o = window.sb.rpc; if(!window.__pdfRpc){ window.__pdfRpc = true; window.sb.rpc = function(fn, args){
        if(fn === 'stage_statement_rows') return Promise.resolve({ data: { inserted: (args && args.p_rows || []).length }, error: null });
        return o.call(this, fn, args); }; } })();
      __pdf.queueWithCard('pdf');
      setTimeout(function(){ fhStmtOpenFile('stm-pdf');
        __pdf.fixtureFile().then(function(f){ fhStmtFilePicked({ files:[f] });
          setTimeout(function(){ var pw=document.getElementById('stm-pw'); if(pw){ pw.value='01011990'; fhStmtUnlock(); } }, 1600);
        });
      }, 400);` }
  ]
};
