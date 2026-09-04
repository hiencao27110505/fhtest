/* ── Cross-ledger move UI (0114) — docs/specs/cross-ledger-move-spec.md ──
   The scope chips (🏡/🔒), hidden in edit mode until this epic, become the
   move affordance: for a move-eligible row the chips reappear selected on the
   row's current book, and flipping them opens #sheet-move — the confirm sheet
   that names every consequence (family visibility, photos, reactions, the
   optional account tag) before the one tap that commits. A flip never moves
   anything silently (M4); cancel restores the chip to the row's real book.
   The engine lives in js-data/21-ledger-move.js. */
var _mvCtx=null;   // {dir:'p2f'|'f2p', pid?|localId?, cur:'personal'|'family'}

/* Is the row being edited movable — and which book does it live in now?
   personal→family needs the family side writable (key when enc is on);
   family→personal is author-only (M2) and needs the personal ledger open. */
function fhMoveEligibleEdit(){
  if(typeof editingPTx!=='undefined' && editingPTx){
    var t=(typeof _pTxById==='function')?_pTxById(editingPTx):null;
    if(!t || t.spaceId || t.linkId || t.kind!=='expense' || t._unreadable) return null;
    if(t.date && t.date>isoDate(TODAY)) return null;                                  // M6: realized only
    if(!(window.DB && DB.fid && DB.ownerMemberId)) return null;
    if(window.fhEncState && fhEncState()!=='off' && !(window.fhKeyReady && fhKeyReady())) return null;
    return {cur:'personal'};
  }
  if(typeof editingTx!=='undefined' && editingTx){
    var f=(typeof txById==='function')?txById(editingTx):null;
    if(!f || f.future || !f._dbId) return null;
    if(!f._createdBy || !window.DB || f._createdBy!==DB.ownerMemberId) return null;   // M2: author-only
    var pd=window.fhPersonalData && fhPersonalData();
    if(!pd || !pd.key) return null;
    return {cur:'family'};
  }
  return null;
}
/* A chip tap in edit mode. Tapping the row's own book does nothing; tapping
   the other book opens the confirm sheet. The chip selection is deliberately
   NOT changed here — it flips only once the move actually commits. */
function fhMoveChipTap(v){
  var el=fhMoveEligibleEdit(); if(!el) return;
  if(v===el.cur) return;
  if(navigator.onLine===false){ toast('Cần mạng để chuyển sổ'); return; }
  _mvCtx=(el.cur==='personal') ? {dir:'p2f', pid:editingPTx, cur:el.cur} : {dir:'f2p', localId:editingTx, cur:el.cur};
  fhMoveSheetOpen();
}
function fhMoveSheetOpen(){
  if(!_mvCtx) return;
  var facts='', payer=document.getElementById('mv-payerfield'), acct=document.getElementById('mv-acctfield');
  if(_mvCtx.dir==='p2f'){
    var t=(typeof _pTxById==='function')?_pTxById(_mvCtx.pid):null;
    if(!t){ _mvCtx=null; return; }
    setTxt('mv-h','Chuyển sang sổ gia đình?');
    setTxt('mv-sub','Cả nhà sẽ thấy khoản này. Muốn giấu lại sau cũng không xoá được điều mọi người đã thấy.');
    facts+='<div class="mv-fact">'+esc(t.note||t.cat||'Khoản chi')+' · '+fmt(t.amt||0)+'</div>';
    var ph=(t.photos||[]).length;
    if(ph) facts+='<div class="mv-fact">📷 '+ph+' ảnh đi kèm được giữ nguyên — cả nhà xem được</div>';
    if(t.accountId) facts+='<div class="mv-fact">Tài khoản đã gắn vẫn được giữ trong sổ của bạn</div>';
    if(payer){
      payer.style.display='';
      var mine=(typeof _reqName==='function' && window.DB)?_reqName(DB.ownerMemberId):null;
      var box=document.getElementById('mv-payer');
      if(box) box.innerHTML=Object.keys(window.membersMeta||{}).map(function(n){
        return '<button class="choice'+(n===mine?' on':'')+'" data-v="'+escAttr(n)+'" onclick="pick(\'mv-payer\',this)">'+esc(n)+'</button>';
      }).join('');
    }
    if(acct) acct.style.display='none';
  } else {
    var f=(typeof txById==='function')?txById(_mvCtx.localId):null;
    if(!f){ _mvCtx=null; return; }
    setTxt('mv-h','Chuyển về sổ riêng?');
    setTxt('mv-sub','Khoản này rời khỏi sổ gia đình. Cả nhà đã thấy nó rồi — chuyển sổ chỉ đổi nơi ghi, không đổi điều đó.');
    facts+='<div class="mv-fact">'+esc(f.note||f.cat||'Khoản chi')+' · '+fmt(f.amt||0)+'</div>';
    var rx=(f.reactions||[]).length;
    if(rx) facts+='<div class="mv-fact">💬 '+rx+' cảm xúc của cả nhà sẽ mất</div>';
    var phf=(f.photos||(f.photo?[f.photo]:[])).length;
    if(phf) facts+='<div class="mv-fact">📷 '+phf+' ảnh chuyển theo vào sổ riêng</div>';
    if(payer) payer.style.display='none';
    if(acct){
      acct.style.display='';
      var pd=window.fhPersonalData && fhPersonalData(); var accts=(pd&&pd.accounts)||[];
      var ico={deposit:'🏦',ewallet:'📱'};
      // cards stay out (money into your own card is its own kind — T11);
      // no chip selected = "don't tag", same as the capture sheet
      var h='<button class="choice" data-v="cash" onclick="fhMvAcctPick(this)">💵 Tiền mặt</button>';
      accts.forEach(function(a){
        if(a.kind==='cash'||a.kind==='credit_card') return;
        h+='<button class="choice" data-v="'+escAttr(a.id)+'" onclick="fhMvAcctPick(this)">'+(ico[a.kind]||'🏦')+' '+esc(a.name||'Tài khoản')+'</button>';
      });
      var abox=document.getElementById('mv-acct'); if(abox) abox.innerHTML=h;
    }
  }
  setHTML('mv-facts', facts);
  var go=document.getElementById('mv-go'); if(go){ go.disabled=false; go.textContent='Chuyển'; }
  openSheet('sheet-move');
}
function fhMvAcctPick(btn){   // optional field → tapping the selected chip clears it
  var was=btn.classList.contains('on');
  document.getElementById('mv-acct').querySelectorAll('.choice').forEach(function(b){ b.classList.remove('on'); });
  if(!was) btn.classList.add('on');
}
async function fhMoveConfirm(){
  if(!_mvCtx) return;
  var btn=document.getElementById('mv-go');
  if(btn){ if(btn.disabled) return; btn.disabled=true; btn.textContent='Đang chuyển…'; }
  var r;
  try{
    if(_mvCtx.dir==='p2f'){
      var payerName=chosen('mv-payer');
      var payerId=(payerName && window._memberIdForWho)?_memberIdForWho(payerName):null;
      r=await fhLedgerMoveToFamily(_mvCtx.pid, {payerMemberId:payerId||undefined});
    } else {
      var a=chosen('mv-acct')||'', acctId=null;
      if(a==='cash' && window.fhPersonalCashAccount) acctId=await fhPersonalCashAccount();
      else if(a) acctId=a;
      r=await fhLedgerMoveToPersonal(_mvCtx.localId, {accountId:acctId});
    }
  }catch(e){ r={ok:false, error:'failed'}; }
  if(btn){ btn.disabled=false; btn.textContent='Chuyển'; }
  if(r && r.ok){
    var dir=_mvCtx.dir; _mvCtx=null;
    closeSheet(); closeModals();
    if(typeof closeExpenseDetail==='function') closeExpenseDetail();
    if(typeof renderPersonal==='function') renderPersonal();
    if(typeof refreshPersonalTxnOverlay==='function') refreshPersonalTxnOverlay();
    toast(dir==='p2f'?'Đã chuyển sang sổ gia đình':'Đã chuyển về sổ riêng');
    return;
  }
  if(r && r.pending){
    // the destination write landed; the source removal finishes on the next
    // sync pass (journal repair) — say so instead of pretending it failed
    _mvCtx=null; closeSheet(); closeModals();
    toast('Đang chuyển dở — sẽ tự hoàn tất khi đồng bộ');
    return;
  }
  var msg={ personal_locked:'Mở khoá sổ cá nhân trước đã',
            family_locked:'Nhập mã gia đình trước đã',
            offline:'Cần mạng để chuyển sổ',
            photos:'Chưa chuyển được ảnh — khoản chưa di chuyển, thử lại nhé',
            not_author:'Chỉ người ghi khoản này mới chuyển được' }[(r&&r.error)||'']
          || 'Chưa chuyển được, thử lại nhé';
  toast(msg);
}
function fhMoveCancel(){
  var el=fhMoveEligibleEdit(); _mvCtx=null; closeSheet();
  // the edit modal is still open underneath — keep its scrim up
  var sc=document.getElementById('scrim'); if(sc) sc.classList.add('on');
  if(el) selectChipByVal('ex-scope', el.cur);   // chip back to the row's real book
}
/* Mirror rows in the personal book become tappable (M10): resolve the family
   twin by link_id and open the real family expense detail — one source of
   truth, no bespoke read-only view. Write-inertness is unchanged. */
function fhMirrorRowTap(pid){
  var P=window.fhPersonalData && fhPersonalData(); if(!P) return;
  var t=(P.txns||[]).filter(function(x){ return x.id===pid; })[0];
  if(!t || !t.spaceId) return;
  if(!window.DB || t.spaceId!==DB.fid){ toast('Khoản này thuộc nhóm khác — mở nhóm đó để xem'); return; }
  if(!t.linkId){ toast('Đang đồng bộ khoản này — thử lại sau nhé'); return; }
  window.sb.from('transactions').select('id').eq('link_id', t.linkId).maybeSingle().then(function(r){
    var fid=r && r.data && r.data.id;
    var local=fid && (window.txns||[]).filter(function(x){ return x._dbId===fid; })[0];
    if(local && typeof openExpenseDetail==='function') openExpenseDetail(local.id);
    else toast('Khoản này nằm ngoài các tháng đang tải — xem ở tab Gia đình');
  }).catch(function(){ toast('Chưa mở được, thử lại nhé'); });
}
