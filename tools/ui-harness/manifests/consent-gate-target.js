/* Target pictures for the consent gate (docs/briefs/consent-gate.md, stage 2 of
   docs/WORKFLOW.md). Every shot opens the REAL surface and then injects the target
   state with the app's own classes and L('vi','en'); nothing here is product code.
   The built manifest (consent-gate.js) reuses these shot names.

   The harness fixture is a bank_email v4 person (stub-supabase.js), which is exactly
   the person this feature is for. The queue is seeded the way queue-perf.js does
   it (the direct build path), so the cards are real cards.

   Vocabulary: the status rows are the privacy sheet's own rows (_cstNavRow in
   75-consent-ui: .cst-lrow, glyph · title · muted value · chevron, 56px, the whole
   row tappable) inside its grouped container (.cst-group), so the queue, its empty
   sheet and Settings speak with one voice and no class is invented. The glyphs are
   the consent text's own `file` and `receipt` (74-autotxn-ui _ATX_SVG), verbatim.
   An "Đang tắt" row opens the scoped consent sheet; an "Đang bật" row opens the
   read-only sheet (fhConsentReview precedent), so the chevron always navigates. */
const H = `
try{ if(window._closeOv) _closeOv(); closeModals(); closeSheet(); }catch(e){}
try{ var _ts=document.getElementById('toast'); if(_ts) _ts.classList.remove('on'); }catch(e){}
window.__cg = window.__cg || {};
/* the privacy sheet's own row (_cstNavRow in 75-consent-ui: .cst-lrow, 56px, whole
   row tappable): glyph · title · muted state · chevron. The glyphs are the app's
   own _MBX_SVG mail / copy, verbatim. */
__cg.G = { file:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13.5 3.5H8.2a2.6 2.6 0 0 0-2.6 2.6v11.8a2.6 2.6 0 0 0 2.6 2.6h7.6a2.6 2.6 0 0 0 2.6-2.6V8.4z"/><path d="M13.5 3.5v4.9h4.9"/><path d="M9.2 12.6h5.6"/><path d="M9.2 16.2h3.6"/></svg>',
          receipt:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3.6v16.8l2-1.3 2 1.3 2-1.3 2 1.3 2-1.3 2 1.3V3.6z"/><path d="M9.4 8.4h5.2"/><path d="M9.4 12.2h5.2"/></svg>',
          chev:'<svg class="cst-chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 6 6 6-6 6"/></svg>' };
__cg.row = function(feature, on){
  var st = feature==='statements', stores = feature==='stores';
  /* HIG: the trailing text states the VALUE only; the chevron says "this opens a
     sheet"; the verb lives in that sheet's primary button. */
  var lbl = st ? L('Sao kê từ email','Statements from email') : (stores ? L('Chọn cửa hàng','Choose stores') : L('Hoá đơn từ cửa hàng','Store receipts'));
  return '<button type="button" class="cst-lrow" data-cg="'+feature+'" onclick="void 0">'
    + '<span class="cst-ic">'+(st?__cg.G.file:__cg.G.receipt)+'</span>'
    + '<span class="cst-ltxt"><span class="cst-lt">'+lbl+'</span></span>'
    + '<span class="cst-val">'+(on?L('Đang bật','On'):L('Đang tắt','Off'))+'</span>'+__cg.G.chev+'</button>';
};
/* features: ['statements','receipts'] or [['statements',true],['receipts',false]] */
__cg.lines = function(features){
  return '<div class="cst-group" id="cst-lines">'+features.map(function(f){ return Array.isArray(f)?__cg.row(f[0],f[1]):__cg.row(f); }).join('')+'</div>';
};
/* Settings keeps its grammar: eyebrow, then group (the sheet's .atx-seq-lbl / .rcs) */
__cg.settingsBlock = function(features){
  return '<div class="rcs"><div class="atx-seq-lbl">'+L('Đọc từ email','From email')+'</div>'+__cg.lines(features)+'</div>';
};
/* the store list while the registry consent (v7) is off: one row, one footer */
__cg.storesOff = function(){
  var rc=document.getElementById('atx-rc'); if(!rc) return;
  rc.innerHTML = '<div class="rcs"><div class="atx-seq-lbl">'+L('Đọc hoá đơn từ','Reading receipts from')+'</div>'
    + __cg.lines(['stores'])
    + '<div class="cst-foot">'+L('Bật để chọn cửa hàng nào được đọc hoá đơn cho hộp thư này.','Turn on to pick the stores whose receipts we read for this mailbox.')+'</div></div>';
};
/* the scoped consent sheet: the real sheet, re-titled; the feature's own change
   entry stays in the tinted block, the other entries fold into the full text */
__cg.scopeSheet = function(){
  var k=document.querySelector('#fh-sheet-body .cst-kicker'); if(k) k.textContent=L('ĐỒNG Ý XỬ LÝ DỮ LIỆU CÁ NHÂN','PERSONAL DATA PROCESSING CONSENT')+' · '+L('SAO KÊ TỪ EMAIL','STATEMENTS FROM EMAIL');
  var h=document.querySelector('#fh-sheet-body .sheet-h');
  if(h){ h.textContent=L('Bật sao kê từ email','Turn on statements from email');
    h.insertAdjacentHTML('afterend','<div class="sheet-sub">'+L('Để đọc sao kê gửi kèm email, cần bạn đồng ý thêm một điều.','To read statements attached to your emails, there is one more thing to agree to.')+'</div>'); }
  var blk=document.querySelector('#fh-sheet-body .cst-changed'), ul=blk&&blk.querySelector('.cst-changed-l');
  if(ul){ var lis=ul.querySelectorAll('li'), rest=[];
    for(var i=0;i<lis.length;i++){ if(!/sao kê|statement file/i.test(lis[i].textContent)){ rest.push(lis[i].outerHTML); lis[i].remove(); } }
    var f=blk.querySelector('.cst-changed-f'); if(f && rest.length) f.textContent=L('Bản hiện tại cũng gồm '+rest.length+' thay đổi khác, nằm trong toàn văn bên dưới.','The current text also carries '+rest.length+' other changes, in the full text below.');
  }
  var ag=document.getElementById('cst-agree'); if(ag) ag.textContent=L('Tôi hiểu và đồng ý','I understand and agree');
};
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
__cg.topOfQueue = function(html){
  var out=document.getElementById('csv-result'); if(!out) return;
  var old=document.getElementById('cst-lines'); if(old) old.remove();
  out.insertAdjacentHTML('afterbegin', html);
  var m=document.querySelector('#csv-import-modal .modal-body'); if(m) m.scrollTop=0;
};
__cg.toast = function(msg){ if(typeof toast==='function') toast(msg); };
`;

const CONN = `{ id:'g1', email:'quang@gmail.com', account_email:'quang@gmail.com', phase:'idle', scope:'personal', last:new Date(Date.now()-3600e3).toISOString(), backfilled:true }`;

module.exports = {
  feature: 'consent-gate-target',
  langs: ['vi', 'en'],
  themes: ['sage'],
  shots: [
    /* 1. the queue says what is off, on every open */
    { name: '01-queue-line', settleMs: 1000, setup: H + `
      __cg.seedQueue();
      setTimeout(function(){ __cg.topOfQueue(__cg.lines(['statements','receipts'])); }, 300);` },

    { name: '01-queue-empty', settleMs: 900, setup: H + `
      fhTxnReviewSheet({ kind:'personal' });
      setTimeout(function(){
        /* after the two doors the body sentence introduces, above Đóng, with the
           same eyebrow + group block Settings uses (.rcs gives it its spacing) */
        var cta=document.querySelector('#fh-sheet-body .cf-cta'); if(!cta) return;
        cta.insertAdjacentHTML('afterend', __cg.settingsBlock(['statements','receipts']));
      }, 450);` },

    { name: '01-settings-rows', settleMs: 1200, setup: H + `
      fhAutoTxnStatus(${CONN});
      setTimeout(function(){
        var pg=document.getElementById('atx-pg'); if(!pg) return;
        pg.insertAdjacentHTML('beforebegin', __cg.settingsBlock(['statements','receipts']));
        __cg.storesOff();   /* one record state (v4) paints one screen: the store list is off too */
      }, 500);` },

    /* 2. the sheet, scoped to the feature that was tapped: with only the feature's
       own entry in the change block, title · lead · entry · fold · primary · Để sau
       fit one frame */
    { name: '02-sheet-scoped', settleMs: 1000, setup: H + `
      fhConsentSheet({ prior:{ version:4, consented_at:'2026-08-01T00:00:00Z' }, priorKnown:true });
      setTimeout(__cg.scopeSheet, 400);` },


    /* 3. agreed: the statements line is gone, receipts still off, one toast */
    { name: '03-agreed', settleMs: 1000, setup: H + `
      __cg.seedQueue();
      setTimeout(function(){
        __cg.topOfQueue(__cg.lines(['receipts']));
        __cg.toast(L('Đã bật sao kê từ email','Statements from email are on'));
      }, 300);` },

    /* 5. a v6 person: statements and receipts on (an on-row opens the read-only
       sheet), the store list stands aside while the registry consent (v7) is off */
    { name: '05-stores-off', settleMs: 1200, setup: H + `
      fhAutoTxnStatus(${CONN});
      setTimeout(function(){
        var pg=document.getElementById('atx-pg'); if(pg) pg.insertAdjacentHTML('beforebegin', __cg.settingsBlock([['statements',true],['receipts',true]]));
        __cg.storesOff();
        var rc=document.getElementById('atx-rc'), s=document.getElementById('fh-sheet'), b=document.getElementById('fh-sheet-body');
        if(rc){ [b,s].forEach(function(e){ if(e) e.scrollTop = rc.offsetTop - 24; }); }
      }, 500);` }
  ]
};
