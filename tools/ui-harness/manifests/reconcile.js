/* Built states for reconcile-spec Part 2 (statement safety), the two places the
   person sees a difference: the confirm screen now says what "Đúng rồi" will do
   (R6), and a points statement says what it is instead of asking (R1).
   Real code throughout: the statement card is drawn by 77's own builder, the
   file goes in through the real file door, and the reader runs on a synthetic
   CSV written here (every value invented). */
const H = `
try{ if(window._closeOv) _closeOv(); closeModals(); closeSheet(); }catch(e){}
try{ var _ts=document.getElementById('toast'); if(_ts) _ts.classList.remove('on'); }catch(e){}
window.__rc = window.__rc || {};
__rc.card = function(id){
  return { id:id, gmail_message_id:'g-'+id, part_index:0, source_provider:'VIB', received_at:new Date().toISOString(), file_ext:'csv', byte_size:1200,
    object_path:'u/'+id+'.sealed', status:'pending', backfill:false, keyLocked:false,
    meta:{ filename:id+'.csv', subject:'SAO KE THE TIN DUNG VIB CASH BACK THANG 10 NAM 2026', part_index:0, file_sha256:'fixture', byte_size:1200, period_month:'2026-10', account_tail:'' } };
};
__rc.queueWithCard = function(id){
  window.csvEntryScope = window.fhNormScope ? fhNormScope({ kind:'personal' }) : { kind:'personal' };
  window._fhStagedRows = []; window._fhQueueNewAccts = []; window.csvStagedMode = true;
  try{ csvLearnLoad(); }catch(e){}
  var COLS=['occurred_at','description','amount','counterparty','category'], columnMap={};
  COLS.forEach(function(f,i){ columnMap[i]={ field:f, confidence:1 }; });
  csvBuildReview([{ name:'staged', parsed:{ headers:COLS, rows:[] }, result:{ columnMap:columnMap } }], {});
  var cards = fhStmtCards(); cards.length = 0; cards.push(__rc.card(id));
  renderCsvReview();
  var pick=document.getElementById('csv-pick'); if(pick) pick.style.display='none';
  openSheet('csv-import-modal');
};
__rc.PRE = 'Sao kê giao dịch thẻ tín dụng\\nSố thẻ chính (Primary Card Number),512345******6789\\nSố tài khoản thẻ (Card Account Number),C000000000123456\\n';
/* one signed amount column, purchases printed positive, no totals: cannot prove itself */
__rc.SIGNED = __rc.PRE + 'Ngày giao dịch,Ngày hạch toán,Diễn giải,MCC,Số tiền (VND)\\n' +
  '02/10/2026,04/10/2026,Mua Hàng / Foody,5812,185000\\n06/10/2026,07/10/2026,Mua Hàng / WINMART Q1,5411,412300\\n' +
  '10/10/2026,12/10/2026,Mua Hàng / GRAB,4121,64000\\n12/10/2026,12/10/2026,Hoàn Trả Mua Hàng / Shopee,5311,-236000\\n';
/* the weekly points statement: a points column, no balance, no debt, no totals */
__rc.POINTS = __rc.PRE + 'Ngày giao dịch,Ngày hạch toán,Diễn giải,MCC,Số tiền (VND),Số điểm (Loyalty points)\\n' +
  '02/10/2026,04/10/2026,Mua Hàng / Foody,5812,185000,9250\\n06/10/2026,07/10/2026,Mua Hàng / WINMART Q1,5411,412300,412\\n';
__rc.pick = function(id, text){
  fhStmtOpenFile(id);
  fhStmtFilePicked({ files:[ new File([text], id+'.csv', { type:'text/csv' }) ] });
};
`;

module.exports = {
  feature: 'reconcile',
  langs: ['vi', 'en'],
  themes: ['sage'],
  shots: [
    /* R6 + R3: a file that cannot prove itself asks, and the screen says which
       account, what kind, how many rows and how much goes each way, already the
       right way round by the file's own wording */
    { name: '01-confirm-says-what-happens', settleMs: 2600, setup: H + `
      __rc.queueWithCard('stm-signed');
      setTimeout(function(){ __rc.pick('stm-signed', __rc.SIGNED); }, 400);` },
    /* R1: a points statement is named, no question, no rows */
    { name: '02-points-statement', settleMs: 2600, setup: H + `
      __rc.queueWithCard('stm-points');
      setTimeout(function(){ __rc.pick('stm-points', __rc.POINTS); }, 400);` },
    /* R1: and the card in the list says so afterwards */
    { name: '03-points-card', settleMs: 3000, setup: H + `
      __rc.queueWithCard('stm-points');
      setTimeout(function(){ __rc.pick('stm-points', __rc.POINTS); }, 400);
      setTimeout(function(){ fhStmtCancel(); }, 2000);` }
  ]
};
