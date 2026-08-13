/* ---------- sheets ---------- */
function openSheet(id){
  if(id==='sheet-expense'){ openExpense(); return; }        // expense form is a full-screen modal
  if(id==='sheet-event'){ openEventModal(); return; }        // new-event form is a full-screen modal
  if(id==='sheet-fund') buildFundChoices();
  if(id==='sheet-month') buildMonthChoices();
  if(id==='sheet-catpick') buildCatPicker();
  if(id==='sheet-budget'){ if(window.loadFamilyData){ window.loadFamilyData().then(fillBudgetSheet); } else fillBudgetSheet(); }
  if(id==='sheet-theme') buildThemeChoices();
  if(id==='sheet-suggest'){ document.getElementById('sg-msg').value=''; selectChipByVal('sg-type','Idea'); }
  var el=document.getElementById(id);
  document.getElementById('scrim').classList.add('on'); el.classList.add('on');
  if(el.classList.contains('modal')){ el.style.transform=''; el.style.transition=''; var b=el.querySelector('.modal-body'); if(b)b.scrollTop=0; }
}
function closeSheet(){
  document.getElementById('scrim').classList.remove('on'); document.querySelectorAll('.sheet').forEach(function(s){ s.classList.remove('on'); s.style.transform=''; s.style.transition=''; });
}
// Close any open full-screen modal (expense, event, memory, suggest, fund, budget).
function closeModals(){
  // The bulk-assign screen survives a modal opened on top of it (logging an
  // expense for an undated day), because its batch lives only in memory and
  // closing it would silently destroy every photo still held. Both of its own
  // exits empty paBatch first, so this never traps the user inside it.
  var keepPa = (typeof paBatch !== 'undefined') && paBatch.length > 0;
  document.querySelectorAll('.modal.on').forEach(function(m){
    if(keepPa && m.id === 'photo-assign') return;
    m.classList.remove('on'); m.style.transform=''; m.style.transition='';
  });
  if(!keepPa) document.getElementById('scrim').classList.remove('on');
  editingTx=null; editSnap=null; exPhotos=[]; evPhotos=[]; memPick=null; memPickMulti=null;
  setTxt('ex-title',L('Ghi khoản chi','Log an expense')); var del=document.getElementById('ex-del'); if(del)del.style.display='none';
  resetDelArm();
}
/* new-event modal */
var evPhotos=[];
function onEvPhoto(input){
  var files=Array.prototype.slice.call(input.files||[]);
  files.forEach(function(f){ if(evPhotos.length>=10){ toast(L('Tối đa 10 ảnh','Up to 10 photos')); return; } readPhoto(f, function(src){ if(src && evPhotos.length<10){ evPhotos.push(src); renderEvPhoto(); } }); });
  input.value='';
}
function removeEvPhoto(i){ evPhotos.splice(i,1); renderEvPhoto(); }
function renderEvPhoto(){
  var strip=document.getElementById('ev-strip'), up=document.getElementById('ev-upload-txt');
  if(up) up.textContent = evPhotos.length ? L('📷 Thêm ảnh nữa','📷 Add more') : L('📷 Thêm ảnh','📷 Add photos');
  if(!strip)return;
  strip.innerHTML = evPhotos.map(function(src,i){ return '<div class="photo-thumb" style="background-image:url('+src+')"><button type="button" class="x" onclick="removeEvPhoto('+i+')">✕</button></div>'; }).join('')
    + (evPhotos.length ? '<div class="photo-strip-note">'+L('đã thêm '+evPhotos.length+' ảnh',evPhotos.length+' photo'+(evPhotos.length!==1?'s':'')+' added')+'</div>' : '');
}
function openEventModal(preset){
  document.getElementById('ng-name').value=''; document.getElementById('ng-amt').value='';
  // Was hardcoded to 2026-08-15 — a month out from the fixture "today", frozen.
  // Keep the intent (about a month ahead) and let it track the real date.
  var ngIso=(preset&&preset.date)||isoShiftMonths(1);
  document.getElementById('ng-date').value=ngIso;
  setDateFloor('ng-date', isoDate(TODAY), ngIso);   // a goal dated in the past isn't a goal
  selEmoji='🎉';
  document.getElementById('ev-emoji').querySelectorAll('button').forEach(function(b){ b.classList.toggle('on',b.dataset.v==='🎉'); });
  selSrc='savings';
  document.getElementById('ng-src').querySelectorAll('.src-opt').forEach(function(b){ b.classList.toggle('on',b.dataset.v==='savings'); });
  updateSrcHint();
  ngDirty();                                  // Create starts disabled on a blank form
  evPhotos=[]; renderEvPhoto();
  document.getElementById('scrim').classList.add('on');
  var m=document.getElementById('event-modal'); m.style.transform=''; m.style.transition=''; m.classList.add('on');
  var body=m.querySelector('.modal-body'); if(body)body.scrollTop=0;
}
function closeEventModal(){ closeModals(); }
/* expense create/edit modal */
var exPreset=null;
function buildExCatChips(){                                  // category chips reflect the current (editable) categories
  var box=document.getElementById('ex-cat'); if(!box)return;
  box.innerHTML = catOrder.map(function(c){ var s=catStyle[c]||['🏷️']; return '<button class="choice" data-v="'+c+'" onclick="pickExCat(this)">'+s[0]+' '+c+'</button>'; }).join('')
    + '<button class="choice" data-v="Event" onclick="pickExCat(this)">🎈 '+L('Sự kiện','Event')+'</button>';
}
function openExpense(preset){
  exPreset = preset || null;
  buildExCatChips();
  document.getElementById('scrim').classList.add('on');
  var m=document.getElementById('expense-modal'); m.style.transform=''; m.style.transition=''; m.classList.add('on');
  var body=m.querySelector('.modal-body'); if(body)body.scrollTop=0;
  if(editingTx) fillExpenseFromTx(); else prefillExpense();
}
function closeExpense(){ closeModals(); }
/* Drag a bottom sheet / modal DOWN to dismiss — axis-locked so it never fights scrolling. */
function initSheetDrag(sheet, closeFn){
  closeFn = closeFn || closeSheet;
  var scroller = sheet.querySelector('.modal-body, .sh-body') || sheet;   // scrolls its own body, not the sheet/modal shell
  var x0=0, y0=0, dy=0, active=false, dragging=false, decided=false;
  var scrim=function(){ return document.getElementById('scrim'); };
  sheet.addEventListener('touchstart',function(e){
    if(e.touches.length>1){ active=false; return; }
    if(e.target.closest('input,textarea,select,button,a')){ active=false; return; }  // taps on controls aren't drags
    active=true; dragging=false; decided=false; dy=0;
    x0=e.touches[0].clientX; y0=e.touches[0].clientY;
  },{passive:true});
  sheet.addEventListener('touchmove',function(e){
    if(!active) return;
    var ax=e.touches[0].clientX-x0, ay=e.touches[0].clientY-y0;
    if(!decided){
      if(Math.abs(ax)<6 && Math.abs(ay)<6) return;             // wait for a clear direction
      decided=true;
      // engage ONLY for a downward, vertical-dominant drag that starts at the top of the scroll
      if(ay>0 && Math.abs(ay)>Math.abs(ax)*1.3 && scroller.scrollTop<=0){ dragging=true; sheet.style.transition='none'; }
      else { active=false; return; }                           // otherwise let the content scroll natively
    }
    if(!dragging) return;
    dy=Math.max(0, ay);
    e.preventDefault();
    sheet.style.transform='translateY('+dy+'px)';
    var sc=scrim(); if(sc) sc.style.opacity=Math.max(.2, 1-dy/(sheet.offsetHeight||480));
  },{passive:false});
  function end(){
    if(!active) return; active=false;
    if(!dragging) return; dragging=false;
    var sc=scrim();
    sheet.style.transition='transform .32s cubic-bezier(.32,.72,0,1)';
    if(dy>120){
      sheet.style.transform='translateY(102%)';
      if(sc){ sc.style.opacity=''; sc.classList.remove('on'); }
      setTimeout(function(){ closeFn(); },300);
    } else {
      sheet.style.transform='translateY(0)';
      if(sc) sc.style.opacity='';
      setTimeout(function(){ if(sheet.classList.contains('on')){ sheet.style.transition=''; sheet.style.transform=''; } },300);
    }
  }
  sheet.addEventListener('touchend',end);
  sheet.addEventListener('touchcancel',end);
}
function setV(id,v){ document.getElementById(id).value=v; }
function pick(group,btn){ document.getElementById(group).querySelectorAll('.choice').forEach(function(c){ c.classList.remove('on'); }); btn.classList.add('on'); }
function chosen(group){ var b=document.getElementById(group).querySelector('.choice.on'); return b?b.dataset.v:''; }
/* ---- fast expense capture ---- */
var lastCat='Groceries', lastWho='Emma';
/* ---- bulk logging: multiple collapsible forms in one screen ------------------
   The expense modal scales from 1→N draft rows. One live editor (#ex-editor) is
   moved into the active row's card (accordion); the rest show a summary card.
   bulkActive indexes the expanded row bound to the #ex-* fields. BULK_SAVING
   suppresses addExpense()'s per-row close/toast/nav so submitBulk() can loop it. */
var bulkRows=[], bulkActive=0, BULK_SAVING=false;
var bulkSaveTried=false;   // once the user taps Lưu with incomplete rows, those rows show a red border
function selectChipByVal(group,val){
  var picked=false;
  document.getElementById(group).querySelectorAll('.choice').forEach(function(c){
    var on=c.dataset.v===val; c.classList.toggle('on',on); if(on)picked=true;
  });
  return picked;
}
function pickExCat(btn){ pick('ex-cat',btn); lastCat=btn.dataset.v; if(!editingTx && bulkRows[bulkActive]) bulkRows[bulkActive]._catTouched=true; onExInput(); }
function pickExWho(btn){ pick('ex-who',btn); lastWho=btn.dataset.v; onExInput(); }
function setExCta(txt){}   // Save button label is fixed in the modal; the hint below explains the action
// The date decides the kind of expense: after today = a future expense (set aside), else = spent.
function exDate(){ var v=document.getElementById('ex-date').value; if(!v)return TODAY; var p=v.split('-'); return new Date(+p[0],+p[1]-1,+p[2]); }
function isExFuture(){ return exDate()>TODAY; }
// The "Event" category makes it an event; otherwise the date decides spent vs future expense.
function updateExWhen(){
  var isEvent=(chosen('ex-cat')==='Event'), fut=isExFuture(), past=exDate()<TODAY;
  var el=document.getElementById('ex-whenhint');
  var _sv=document.getElementById('ex-save'); if(_sv) _sv.textContent=L('Lưu','Save');   // default; a future date flips it to Send
  if(isEvent){
    setExCta(past ? L('Lưu vào Kỷ niệm','Save to Memories') : L('Thêm vào Sự kiện','Add to Events'));
    if(el) el.innerHTML = past
      ? '<span style="color:var(--brand-ink)">'+L('Đã diễn ra','Already happened')+'</span> · '+L('một kỷ niệm để nhớ về','a memory to look back on')
      : '<span style="color:var(--brand-ink)">'+L('Đã thêm vào Sự kiện','Added to Events')+'</span> · '+L('để dành từ tháng này, thành kỷ niệm khi nó diễn ra','set aside from this month, a memory once it happens');
    return;
  }
  setExCta(L('Lưu khoản chi','Save expense'));
  if(!el)return;
  if(fut){
    if(_sv) _sv.textContent=L('Gửi','Send');   // a future expense is a proposal — the family aligns before it's set aside
    el.innerHTML='<span style="color:var(--brand-ink)">'+L('Chờ cả nhà cùng đồng ý','Waiting for the family to agree')+'</span> · '+L('chưa để dành vào ngân sách','nothing set aside yet');
    return;
  }
  el.textContent='';   // a normal spend → no extra hint
}
function prefillExpense(){
  resetCancelArm();
  // Restore an unsaved draft from a previous (accidental) close — but not when the
  // sheet was opened for a specific category/date (a preset), which means "log this".
  var saved = (!exPreset) ? loadDrafts() : null;
  if(saved){
    bulkRows = saved.rows.map(function(r){ return {note:r.note||'',amt:r.amt||'',cat:r.cat||'',who:r.who||lastWho,date:r.date||isoDate(TODAY),_catTouched:!!r._catTouched}; });
    bulkActive = (typeof saved.active==='number' && saved.active<bulkRows.length) ? saved.active : -1;
    showDraftBanner();
  } else {
    // Start with a single draft row; the modal grows via "+" or a comma in the note.
    bulkRows=[blankRow(exPreset)];
    bulkActive=0;
    hideDraftBanner();
  }
  bulkSaveTried=false;
  // A preset can carry photos (bulk-assign hands off its selection here), so
  // this clears to the preset rather than unconditionally to empty.
  exPhotos = (exPreset && exPreset.photos) ? exPreset.photos.slice() : [];
  renderExPhoto();
  setTxt('ex-title',L('Ghi khoản chi','Log an expense'));
  var del=document.getElementById('ex-del'); if(del)del.style.display='none';
  renderBulk();
  if(bulkActive>=0 && bulkRows[bulkActive]) loadRow(bulkActive);
  updateExWhen(); refreshExCta();
}
/* ---- draft persistence -------------------------------------------------------
   bulkRows is auto-saved to localStorage on every change, so closing the sheet
   (swipe, scrim, an accidental tap) never loses work — reopening restores it.
   Photos aren't persisted (single-row edge, and data URIs would blow the quota). */
var FH_DRAFTS='fh-expense-drafts';
function draftHasContent(){
  for(var i=0;i<bulkRows.length;i++){ var r=bulkRows[i]; if((r.note||'').trim() || parseAmtBase(r.amt||'')) return true; }
  return false;
}
var _draftSeq=0;
function persistDrafts(){
  if(editingTx || exPreset) return;                // editing, or a one-off preset log, is not the bulk draft
  try{
    if(!draftHasContent()){ localStorage.removeItem(FH_DRAFTS); return; }
    var rows=bulkRows.map(function(r){ return {note:r.note||'',amt:r.amt||'',cat:r.cat||'',who:r.who||'',date:r.date||'',_catTouched:!!r._catTouched}; });
    var data={v:1, cur:CUR, active:bulkActive, rows:rows};
    // committed-enc family: amounts + notes never touch disk unencrypted. A
    // locked device just skips persisting (it can't save the expense anyway).
    if(window.fhEncState && window.fhEncState()==='enc'){
      if(!(window.fhKeyReady && window.fhKeyReady()) || !window.fhEncStr) return;
      var seq=++_draftSeq;
      window.fhEncStr(JSON.stringify(data)).then(function(ct){
        if(!ct || seq!==_draftSeq) return;           // stale encrypt must not stomp a newer draft
        try{ localStorage.setItem(FH_DRAFTS, JSON.stringify({v:2, enc:1, cur:CUR, ct:ct})); }catch(e){}
      });
      return;
    }
    localStorage.setItem(FH_DRAFTS, JSON.stringify(data));
  }catch(e){}
}
function clearDrafts(){ if(exPreset) return; _draftSeq++; try{ localStorage.removeItem(FH_DRAFTS); }catch(e){} }   // a preset log must not wipe an unrelated bulk draft
function loadDrafts(){
  try{ var d=JSON.parse(localStorage.getItem(FH_DRAFTS)||'null');
    if(d && d.enc && d.ct){                          // encrypted draft: decrypt off the sync path, apply if still pristine
      if(d.cur===CUR && window.fhDecStr) window.fhDecStr(d.ct).then(function(pt){
        try{ var dd=pt?JSON.parse(pt):null; if(dd && dd.rows && dd.rows.length) applyDecryptedDraft(dd); }catch(e){}
      });
      return null;
    }
    if(d && d.rows && d.rows.length && d.cur===CUR) return d;   // ignore a draft saved under a different currency
  }catch(e){}
  return null;
}
/* the async twin of prefillExpense's restore branch — only lands on an
   untouched sheet, so it can never overwrite something the user just typed */
function applyDecryptedDraft(d){
  if(editingTx || exPreset || draftHasContent()) return;
  bulkRows = d.rows.map(function(r){ return {note:r.note||'',amt:r.amt||'',cat:r.cat||'',who:r.who||lastWho,date:r.date||isoDate(TODAY),_catTouched:!!r._catTouched}; });
  bulkActive = (typeof d.active==='number' && d.active<bulkRows.length) ? d.active : -1;
  showDraftBanner();
  renderBulk();
  if(bulkActive>=0 && bulkRows[bulkActive]) loadRow(bulkActive);
  updateExWhen(); refreshExCta();
}
function showDraftBanner(){ var b=document.getElementById('draft-banner'); if(b){ setTxt('draft-banner-txt', L('Đã khôi phục bản nháp chưa lưu','Restored your unsaved draft')); var f=b.querySelector('.draft-fresh'); if(f) f.textContent=L('Bắt đầu mới','Start fresh'); b.style.display=''; } }
function hideDraftBanner(){ var b=document.getElementById('draft-banner'); if(b) b.style.display='none'; }
/* "Bắt đầu mới" — throw the restored draft away and start clean. */
function startFreshDrafts(){
  clearDrafts();
  bulkRows=[blankRow()]; bulkActive=0; bulkSaveTried=false;
  hideDraftBanner();
  renderBulk(); loadRow(0); updateExWhen(); refreshExCta();
}
/* Light discard-guard on the explicit Huỷ button (arm-then-confirm, the app's
   idiom). Swipe/scrim keep the draft; only Huỷ throws it away, and only on a
   second tap. */
var cancelArmed=false, cancelTimer=null;
function resetCancelArm(){
  cancelArmed=false; clearTimeout(cancelTimer);
  var b=document.querySelector('#expense-modal .modal-cancel');
  if(b){ b.classList.remove('armed'); b.textContent=L('Huỷ','Cancel'); }
}
function cancelExpense(){
  if(editingTx || exPreset || !draftHasContent()){ resetCancelArm(); closeExpense(); return; }   // nothing persisted to lose → just close
  var b=document.querySelector('#expense-modal .modal-cancel');
  if(!cancelArmed){
    cancelArmed=true;
    if(b){ b.classList.add('armed'); b.textContent=L('Bỏ nháp?','Discard?'); }
    toast(L('Chạm lần nữa để bỏ · hoặc vuốt xuống để giữ nháp','Tap again to discard · or swipe down to keep'));
    clearTimeout(cancelTimer); cancelTimer=setTimeout(resetCancelArm, 3500);
    return;
  }
  resetCancelArm(); clearDrafts(); closeExpense();
}
/* A category is usable only if it belongs to THIS family's set (or is the special
   Event). Prevents a stale demo default like 'Groceries'/'Fun' — categories that
   may not exist on a real account — from being written to the ledger. */
function catValid(c){ return c==='Event' || (!!c && (catOrder||[]).indexOf(c)>=0); }
/* The default category for a fresh manual row: the last-used one if it's real,
   otherwise EMPTY (→ unclassified, the user picks) — never a phantom category. */
function safeDefaultCat(){ return catValid(lastCat) ? lastCat : ''; }
function rowHasContent(r){ return !!(r && ((r.note||'').trim() || parseAmtBase(r.amt||'')>0)); }
/* A fresh draft row. Mirrors the old prefill defaults (last category/payer, today,
   or a preset's category/date) so a single-row modal behaves exactly as before. */
function blankRow(preset){
  var preCat = !!(preset && catValid(preset.cat));
  var cat = preCat ? preset.cat : safeDefaultCat();
  var d   = (preset && preset.date) || isoDate(TODAY);
  // _catTouched = the category was set on purpose (a preset or a manual chip tap);
  // an untouched default yields to the note's guess on commit.
  return { note:'', amt:'', cat:cat, who:lastWho, date:d, _catTouched:preCat };
}
/* Read the live #ex-* fields into the active draft. Called on every edit so the
   summary cards and Save validation always reflect what's on screen. */
function flushActiveRow(){
  if(editingTx || !bulkRows[bulkActive]) return;
  var r=bulkRows[bulkActive];
  r.note = document.getElementById('ex-note').value;
  r.amt  = document.getElementById('ex-amt').value;
  r.cat  = chosen('ex-cat') || r.cat;
  r.who  = chosen('ex-who') || r.who;
  r.date = document.getElementById('ex-date').value || r.date;
}
/* Commit = flush the live fields AND parse the note if the amount wasn't entered
   separately. This is what makes "＋ Thêm khoản" (and leaving a row) behave like a
   comma: "tiền cafe phe 50k" → note "tiền cafe phe", amount 50k, category guessed. */
function commitActiveRow(){
  flushActiveRow();
  var r=bulkRows[bulkActive]; if(!r) return;
  var note=r.note||'';
  // The input may still hold "recent entry, tail" (one comma behind) — split those
  // remaining entries into their own rows before committing.
  if(note.indexOf(',')>=0){
    var entries=parseEntries(note);
    if(entries.length){
      applyParsed(bulkActive, entries[0]);
      var at=bulkActive+1;
      for(var i=1;i<entries.length;i++){ bulkRows.splice(at++,0, rowFromParsed(entries[i])); }
      bulkActive=at-1;
    } else { r.note=''; }
    return;
  }
  if(!parseAmtBase(r.amt||'') && note.trim()){               // pull an amount out of the note if none was typed
    var p=parseBulkLine(note);
    if(p.amt){ r.amt=p.amt; r.note=p.note; }
  }
  if(!r._catTouched && (r.note||'').trim()){                 // category not hand-picked → let the note decide, overriding any default
    var g=guessCat(r.note);
    if(g) r.cat=g;
    else if(bulkRows.length>1) r.cat='';                     // bulk: fail-safe to "Chọn danh mục"; a lone expense keeps its default
  }
}
/* Write a draft row into the live #ex-* fields (reuses the single-form controls). */
function loadRow(i){
  var r=bulkRows[i]; if(!r) return;
  document.getElementById('ex-note').value = r.note||'';
  document.getElementById('ex-amt').value  = r.amt||'';
  var iso = r.date || isoDate(TODAY);
  document.getElementById('ex-date').value = iso;
  setDateFloor('ex-date', isoMonthStart(-24), iso);
  selectChipByVal('ex-cat', catValid(r.cat) ? r.cat : '');   // unclassified → no chip selected
  selectChipByVal('ex-who', r.who||lastWho);
  updateExWhen(); refreshExCta();
}
/* Accordion: expand row i, committing (parse+flush) the current one first. */
function setActiveRow(i){
  commitActiveRow();
  bulkActive=i;
  renderBulk();
  loadRow(i);
  var n=document.getElementById('ex-note'); if(n) n.focus();
}
function bulkAddRow(){
  commitActiveRow();                               // parse "note + 50k" into the row we're leaving
  var nr=blankRow(); nr.cat=''; nr._catTouched=false;   // a new bulk entry starts unclassified — the note decides
  bulkRows.push(nr);
  bulkActive=bulkRows.length-1;
  renderBulk();
  loadRow(bulkActive);
  var n=document.getElementById('ex-note'); if(n) n.focus();
}
function bulkRemoveRow(i){
  if(bulkRows.length<=1) return;                 // always keep at least one form
  if(i!==bulkActive) flushActiveRow();           // removing a collapsed row — preserve the open one's edits
  bulkRows.splice(i,1);
  if(i<bulkActive) bulkActive--;
  else if(bulkActive>=bulkRows.length) bulkActive=bulkRows.length-1;
  renderBulk();
  loadRow(bulkActive);
}
/* Compact date for a card header: today → "Hôm nay", this year → dd/mm, else dd/mm/yyyy. */
function bulkDate(iso){
  iso = iso || isoDate(TODAY);
  if(iso===isoDate(TODAY)) return L('Hôm nay','Today');
  var p=iso.split('-'); if(p.length!==3) return '';
  return p[2]+'/'+p[1]+((+p[0]===TODAY.getFullYear())?'':('/'+p[0]));
}
/* Collapsed-card body: the note on its own full-width row, then amount + category
   (or a red "Chọn danh mục" prompt) on the row below. */
function bulkSummary(r){
  var note=(r.note||'').trim();
  var noteHtml = note
    ? '<span class="bc-note">'+esc(note)+'</span>'
    : '<span class="bc-note bc-empty">'+L('(khoản trống)','(empty item)')+'</span>';
  var base=parseAmtBase(r.amt||'');
  var meta='';
  if(base>0) meta+='<span class="bc-amt">'+fmt(base)+'</span>';
  if(catValid(r.cat)){
    if(r.cat==='Event') meta+='<span class="bc-cat">🎈 '+L('Sự kiện','Event')+'</span>';
    else { var s=catStyle[r.cat]||['🏷️']; meta+='<span class="bc-cat">'+s[0]+' '+esc(r.cat)+'</span>'; }
  } else if(note || base>0){                                  // has content but no real category → prompt to pick
    meta+='<span class="bc-pick">'+L('Chọn danh mục','Pick a category')+'</span>';
  }
  if(r._dup) meta+='<span class="bc-dup">'+L('lặp lại','repeat')+'</span>';
  return noteHtml+'<span class="bc-meta">'+meta+'</span>';
}
/* Rebuild the card list and relocate the single #ex-editor into the active card.
   Edit mode (or an empty model) renders the editor in place with no cards/＋. */
function renderBulk(){
  var body   = document.querySelector('#expense-modal .modal-body');
  var list   = document.getElementById('bulk-list');
  var editor = document.getElementById('ex-editor');
  var addBtn = document.getElementById('bulk-add');
  if(!body || !list || !editor) return;
  if(editingTx || !bulkRows.length){
    if(editor.parentNode!==body) body.insertBefore(editor, addBtn);   // editor sits directly in the body
    list.innerHTML='';
    if(addBtn) addBtn.style.display='none';
    togglePhotoField(true);
    return;
  }
  pruneEmptyRows();                                 // drop leftover empty cards (keeps the active input row)
  // Park the editor outside #bulk-list before the innerHTML rebuild would destroy it.
  var holder=document.getElementById('bulk-holder');
  if(!holder){ holder=document.createElement('div'); holder.id='bulk-holder'; holder.style.display='none'; document.getElementById('expense-modal').appendChild(holder); }
  holder.appendChild(editor);
  markDuplicates();                                 // flag same note+amount rows (non-blocking hint)
  var html='';
  for(var i=0;i<bulkRows.length;i++){
    var r=bulkRows[i];
    // Every card — collapsed or open — carries the same header: "Khoản chi N" + date.
    // Missing category is signalled by the "Chọn danh mục" label inside the card, not
    // by highlighting the whole card, so every card stays visually consistent.
    var head='<span class="bulk-idx">'+L('Khoản chi ','Item ')+(i+1)+'</span><span class="bulk-date">'+bulkDate(r.date)+'</span>';
    var rm=(bulkRows.length>1) ? '<button type="button" class="bulk-x" onclick="bulkRemoveRow('+i+')" aria-label="'+L('Xoá khoản ','Remove item ')+(i+1)+'">✕</button>' : '';
    // After a save attempt, an incomplete row (no amount or no category) gets a red border.
    var bad=(bulkSaveTried && rowHasContent(r) && !(parseAmtBase(r.amt||'')>0 && catValid(r.cat)))?' invalid':'';
    if(i===bulkActive){
      html+='<div class="bulk-card active'+bad+'"><div class="bulk-head">'+head+rm+'</div><div id="ex-editor-mount"></div></div>';
    } else {
      html+='<div class="bulk-card'+bad+'">'
        +  '<button type="button" class="bulk-tap" onclick="setActiveRow('+i+')" aria-label="'+L('Sửa khoản ','Edit item ')+(i+1)+'">'
        +    '<span class="bulk-head">'+head+'</span>'+bulkSummary(r)
        +  '</button>'+rm
        +  '</div>';
    }
  }
  list.innerHTML=html;
  var mount=document.getElementById('ex-editor-mount');
  if(mount) mount.appendChild(editor);
  if(addBtn){ addBtn.style.display=''; addBtn.textContent=L('＋ Thêm khoản','＋ Add item'); }
  togglePhotoField(bulkRows.length===1);          // photos only in single-row mode (bulk photos = separate OCR feature)
  persistDrafts();                                 // keep the auto-saved draft in sync with the on-screen state
}
function togglePhotoField(show){
  var f=document.getElementById('ex-photofield'); if(f) f.style.display=show?'':'none';
}
/* Remove empty draft cards (no note & no amount) except the one being edited, so a
   comma-then-move-on doesn't leave "(khoản trống)" cards behind. Keeps ≥1 row. */
function pruneEmptyRows(){
  if(bulkRows.length<=1) return;
  if(bulkActive<0){                                 // "nothing open" list — drop empties, keep no active row
    bulkRows=bulkRows.filter(function(r){ return (r.note||'').trim() || parseAmtBase(r.amt||''); });
    if(!bulkRows.length){ bulkRows=[blankRow()]; bulkActive=0; }
    return;
  }
  var active=bulkRows[bulkActive];
  var kept=bulkRows.filter(function(r){
    if(r===active) return true;
    return (r.note||'').trim() || parseAmtBase(r.amt||'');
  });
  if(!kept.length) kept=[active||blankRow()];
  bulkActive=kept.indexOf(active); if(bulkActive<0) bulkActive=kept.length-1;
  bulkRows=kept;
}
/* Flag later rows that repeat an earlier row's note + amount — a gentle "lặp lại"
   hint, never blocking (the family may legitimately buy the same thing twice). */
function markDuplicates(){
  var seen={};
  bulkRows.forEach(function(r){
    r._dup=false;
    var note=(r.note||'').trim(); if(!note) return;
    var key=deburr(note.toLowerCase())+'|'+parseAmtBase(r.amt||'');
    if(seen[key]) r._dup=true; else seen[key]=true;
  });
}
/* ---- comma-triggered NL line parsing ---------------------------------------
   A comma marks the END of an entry, but we DON'T split on it — splitting the
   moment the comma is typed would drop an empty form on screen with nothing to
   parse. Instead we wait: only once the user starts the NEXT entry (text appears
   after the comma) do we peel the completed entries off into parsed cards, and the
   active input keeps the just-started text. So a new card only ever appears with
   real, parsed data, and there's never a stray empty form. */
/* No live splitting: commas are just characters while typing, so the user can
   write the whole line ("cafe 50k, chợ 200k, đi chơi 800k") at their own pace. */
function onExNoteInput(){ onExInput(); }
/* Parse when the note field loses focus (or on Save/＋): split any comma-separated
   entries into their own cards and autofill each one's amount + guessed category.
   A single "cafe 50k" is parsed in place → note "cafe", amount 50k, category filled. */
function onExNoteBlur(){
  if(editingTx || !bulkRows[bulkActive]) return;
  var before=bulkRows.length;
  commitActiveRow();                               // split multi-entry + pull amount out of the note + guess category
  if(bulkRows.length!==before){                    // a split created several cards → land on the collapsed list
    bulkActive=-1;                                  // nothing open; the user taps a card to edit it
    var n=document.getElementById('ex-note'); if(n) n.value='';
    renderBulk();
    if(typeof refreshExCta==='function') refreshExCta();
  } else {
    loadRow(bulkActive);                            // a single entry parsed in place → stay open with the autofilled fields
  }
}
/* Split a raw input string into parsed entries (used when several comma-separated
   entries are still sitting in the input at commit/validation time). */
function parseEntries(note){
  return (note||'').split(',').map(function(s){return s.trim();}).filter(function(s){return s!=='';}).map(function(s){ return parseBulkLine(s); });
}
function applyParsed(i, p){
  var r=bulkRows[i]; if(!r) return;
  r.note=p.note;
  if(p.amt) r.amt=p.amt;
  r.cat=catValid(p.cat) ? p.cat : '';        // failed guess → unclassified (the user picks), never a stale default
}
function rowFromParsed(p){
  var r=blankRow();
  r.note=p.note||'';
  if(p.amt) r.amt=p.amt;
  r.cat=catValid(p.cat) ? p.cat : '';
  return r;
}
/* Parse one segment → {note, amt (display-currency string), cat}. */
function parseBulkLine(text){
  var raw=(text||'').replace(/^[\s,]+|[\s,]+$/g,'');   // drop stray leading/trailing commas & spaces
  var amt='', note=raw;
  var m=matchAmount(raw);
  if(m){ amt=String(m.display); note=(raw.slice(0,m.index)+raw.slice(m.index+m.len)).replace(/\s+/g,' ').trim(); }
  var cat=guessCat(note||raw);
  return { note:note, amt:amt, cat:cat };
}
function _cleanNum(s){ return parseInt((s||'').replace(/[^0-9]/g,''),10)||0; }
/* Currency-aware amount detection. Returns the DISPLAY-currency integer the user
   would type into #ex-amt (existing parseAmtBase converts it to the stored base).
   Handles VN shorthand (k/nghìn/ngàn ×1e3, tr/triệu ×1e6, tỷ/tỉ ×1e9, 1tr2=1.2M)
   and the bare-number split: USD literal; VND <1000 ⇒ ×1000 (so "45" = 45.000₫). */
function matchAmount(s){
  var m;
  m=s.match(/(\d[\d.,]*)\s*(?:tr(?:iệu|ieu)?)\s*(\d*)/i);          // millions, incl. 1tr2 / 1 triệu 200
  if(m){
    var whole=_cleanNum(m[1]), frac=m[2]||'';
    var val=frac ? parseFloat(whole+'.'+frac)*1000000 : whole*1000000;
    if(val>0) return { display:Math.round(val), index:m.index, len:m[0].length };
  }
  m=s.match(/(\d[\d.,]*)\s*(?:tỷ|tỉ)\b/i);                          // billions
  if(m && _cleanNum(m[1])>0) return { display:Math.round(_cleanNum(m[1])*1e9), index:m.index, len:m[0].length };
  m=s.match(/(\d[\d.,]*)\s*(?:k|nghìn|nghin|ngàn|ngan)\b/i);        // thousands
  if(m && _cleanNum(m[1])>0) return { display:Math.round(_cleanNum(m[1])*1000), index:m.index, len:m[0].length };
  var re=/\d[\d.,]*/g, mt, last=null;                               // bare number → take the last one in the segment
  while((mt=re.exec(s))!==null){ last=mt; }
  if(last){
    var n=_cleanNum(last[0]);
    var disp=(CUR==='VND') ? (n<1000 ? n*1000 : n) : n;
    if(disp>0) return { display:Math.round(disp), index:last.index, len:last[0].length };
  }
  return null;
}
/* Diacritic-insensitive category guess from note keywords (EN + VN). Only returns
   a category the family actually has (iterates catOrder); otherwise '' → keep last. */
function deburr(s){ return String(s==null?'':s).normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/đ/g,'d').replace(/Đ/g,'D'); }
/* ---- bilingual category guessing -------------------------------------------
   Two independent axes, deliberately NOT conflated:
   • note LANGUAGE → tied to the UI language (isVi()). Keyword lists are split so a
     word that means different things across languages resolves by the user's own
     language first. Classic trap: "gas" = fuel (Transport) in EN, but cooking gas
     (Housing) in VN. Brand/loan words (grab, kfc…) live in a SHARED list matched in
     both. The other language is a best-effort fallback only.
   • note keywords → an abstract CONCEPT; the CONCEPT then maps to the FAMILY's own
     category by NAME or EMOJI (see CONCEPT_MATCH), so it works whatever language the
     family named their categories in, and never invents a category they don't have.
   (Amount MAGNITUDE is a third axis, tied to CURRENCY not language — see matchAmount.) */
var KW_SHARED={   // brand / loan words, safe in either language
  'Transport':['grab','gojek','uber','taxi','grabbike','grabcar'],
  'Dining':['cafe','kfc','lotteria','starbucks','highland','pizza','burger','sushi'],
  'Groceries':['coopmart','bigc','winmart','vinmart','emart'],
  'Fun':['netflix','spotify','karaoke']
};
var KW_VI={
  'Housing':['dien','tien dien','nuoc','tien nuoc','internet','wifi','mang','tien nha','thue nha','tien phong','quan ly','phi quan ly','tien internet','cap','rac','phi chung cu','sua nha','noi that','gas','tien gas','binh gas'],
  'Groceries':['cho','di cho','sieu thi','rau','thit','ca hoi','ca thu','bach hoa','gao','trai cay','do kho','thuc pham','nhu yeu pham','do an'],
  'Clothing':['quan ao','ao quan','ao','quan jean','quan tay','quan short','vay','ao dai','ao thun','giay','dep','giay dep','thoi trang','tui xach'],
  'Shopping':['mua sam','sam do','sam sua'],
  'Transport':['xang','do xang','xe','xe om','xe buyt','bus','gui xe','ve xe','ve tau','ve may bay','sua xe','rua xe','phi cau duong'],
  'Dining':['ca phe','an','an uong','com','pho','bun','mi','bun bo','nha hang','bia','ruou','banh','nhau','tra sua','tra','tiem','an sang','an trua','an toi','quan an','quan nhau','quan oc','quan cafe','quan bia','lau','nuong','che'],
  'Fun':['phim','xem phim','choi','di choi','du lich','game','net','bi a','concert','ve xem','giai tri','massage','spa','gym','the thao','sach','ca hat','hat karaoke'],
  'Others':['khac','linh tinh','thuoc','y te','benh vien','hoc','hoc phi','tien hoc']
};
var KW_EN={
  'Housing':['electricity','water','rent','utilities','bills','gas bill','internet bill','maintenance','furniture','wifi'],
  'Groceries':['grocery','groceries','market','supermarket','vegetable','vegetables','fruit','fruits','meat','fish','rice'],
  'Clothing':['clothes','clothing','shirt','tshirt','t-shirt','dress','shoes','jeans','jacket','apparel','skirt','sneakers','bag'],
  'Shopping':['shopping','mall'],
  'Transport':['gas','fuel','petrol','bus','parking','fare','flight','train ticket','ride'],
  'Dining':['coffee','restaurant','lunch','dinner','breakfast','brunch','beer','wine','tea','snack','eat','food','meal','drinks','dining'],
  'Fun':['movie','cinema','game','games','travel','trip','concert','massage','spa','gym','book','books','music'],
  'Others':['other','others','misc','medicine','pharmacy','hospital','tuition','school']
};
/* CONCEPT → how to recognise the FAMILY's own category for it, by NAME (deburred
   substring) OR emoji — never by an English key. */
var CONCEPT_MATCH={
  'Housing':  {names:['nha o','nha cua','housing','sinh hoat','hoa don','tien nha','rent','utilities','bills'], emojis:['🏠','🏡','💡','🧾','🔌']},
  'Groceries':{names:['di cho','cho bua','groceries','grocery','thuc pham','sieu thi','nhu yeu pham','mart','market','minimart','tap hoa'], emojis:['🛒','🥬','🥦']},
  'Clothing': {names:['clothing','thoi trang','quan ao','clothes','apparel'],                emojis:['👕','👗','🧥','👖','👚','👟']},
  'Shopping': {names:['shopping','mua sam','mall'],                                          emojis:['🛍️','🎁']},
  'Transport':{names:['di chuyen','di lai','transport','transportation','giao thong','commute'], emojis:['🚗','🚕','🛵','⛽','🚌','✈️']},
  'Dining':   {names:['an uong','am thuc','dining','food','eating'],                         emojis:['🍽️','🍜','🍔','☕','🍲','🥘']},
  'Fun':      {names:['giai tri','vui choi','fun','entertainment','leisure'],                emojis:['🎉','🎈','🎮','🎬','🎡']},
  'Others':   {names:['khac','other','others','linh tinh','misc'],                           emojis:['🗂️','📦','🏷️']}
};
/* Specific concepts before broad ones so e.g. "quần áo"→Clothing (not Dining's 'an')
   and "mua sắm"→Shopping win before Dining/Fun. */
var CONCEPT_ORDER=['Housing','Groceries','Clothing','Shopping','Transport','Fun','Dining','Others'];
function _scanConcepts(padded, dicts){
  for(var k=0;k<CONCEPT_ORDER.length;k++){
    var cpt=CONCEPT_ORDER[k];
    for(var d=0;d<dicts.length;d++){
      var kws=dicts[d][cpt]; if(!kws) continue;
      for(var j=0;j<kws.length;j++){
        var kw=deburr(kws[j].toLowerCase()).trim();
        if(kw && padded.indexOf(' '+kw+' ')>=0) return cpt;
      }
    }
  }
  return '';
}
function conceptFromNote(note){
  var t=deburr((note||'').toLowerCase()).replace(/\s+/g,' ').trim();
  if(!t) return '';
  var padded=' '+t+' ';
  var vi=(typeof isVi==='function' && isVi());
  var primary = vi ? KW_VI : KW_EN, secondary = vi ? KW_EN : KW_VI;
  return _scanConcepts(padded, [KW_SHARED, primary])   // shared + the user's language win
      || _scanConcepts(padded, [secondary])            // other language: best-effort for cross-language terms
      || '';
}
function familyCatForConcept(concept){
  var m=CONCEPT_MATCH[concept]; if(!m) return '';
  for(var i=0;i<catOrder.length;i++){
    var c=catOrder[i], name=deburr(String(c).toLowerCase()), emoji=(catStyle[c]||[])[0];
    for(var n=0;n<m.names.length;n++){ if(name.indexOf(deburr(m.names[n]))>=0) return c; }
    if(emoji && m.emojis.indexOf(emoji)>=0) return c;
  }
  return '';   // family has no category for this concept → leave unclassified (user picks)
}
/* Guess the family's category from a note. Returns '' (unclassified) when unsure. */
function guessCat(note){
  var concept=conceptFromNote(note||'');
  return concept ? familyCatForConcept(concept) : '';
}
/* Persist every draft row in one shot through the durable public addExpense
   (its write-through wrapper fires per call). BULK_SAVING mutes each call's own
   close/toast/nav so the loop can run; the modal closes once at the end. */
function submitBulk(opts){
  /* opts.prepared = the rows were built in code (CSV import / bank-email review),
     not typed here. Only a hand-typed save has a trailing entry sitting in the
     input to commit; running the interactive parse over prepared rows CORRUPTS
     bulkRows[bulkActive] two ways, both of which surface as "hoàn tất các khoản
     được tô đỏ" on a screen where every field was visibly filled:
       • a description containing a comma ("CHUYEN TIEN, CAM ON") is treated as
         "note, note" and split into extra amount-less rows;
       • the reviewed category is re-guessed from the note (these rows never set
         _catTouched) and, when the keyword dictionary doesn't recognise a bank
         memo, wiped to '' — see the bulkRows.length>1 branch in commitActiveRow.
     Both hit row 0 only, which is why the first card is the red one. */
  if(!(opts && opts.prepared)) commitActiveRow();  // parse the trailing entry still sitting in the input
  // parse-on-save: a row whose note still embeds a number but has no amount yet
  bulkRows.forEach(function(r){
    if(!parseAmtBase(r.amt||'') && (r.note||'').trim()){
      var p=parseBulkLine(r.note);
      if(p.amt){ r.amt=p.amt; if(!r.cat) r.cat=p.cat; r.note=p.note; }
    }
  });
  var rows=bulkRows.filter(function(r){ return (r.note||'').trim() || parseAmtBase(r.amt||''); });  // drop blank rows
  if(!rows.length){ toast(L('Chưa có khoản nào để lưu','Nothing to save yet')); return; }
  bulkRows=rows;                                    // keep only the real rows in the model
  var bad=bulkRows.some(function(r){ return !(parseAmtBase(r.amt||'')>0 && catValid(r.cat)); });
  if(bad){ bulkShowInvalid(); return; }             // red-border + shake the incomplete cards; don't save
  var total=0, n=rows.length;
  var savedPhotos=exPhotos.slice();                 // photos only ride the first row (single-row is the only way to attach them)
  for(var k=0;k<rows.length;k++){
    loadRow(k);                                     // push this row into the #ex-* fields addExpense reads
    exPhotos = (k===0) ? savedPhotos.slice() : [];
    total+=parseAmtBase(rows[k].amt||'');
    BULK_SAVING=true;
    try{ window.addExpense(); } finally{ BULK_SAVING=false; }
  }
  exPhotos=[];
  bulkSaveTried=false;
  clearDrafts();                                   // saved for real → drop the auto-saved draft
  renderAll(); renderTxns();
  closeExpense();
  toast(L('Đã ghi '+n+' khoản · '+fmt(total),'Logged '+n+' · '+fmt(total)));
  if(typeof floatEmojis==='function') floatEmojis('🎉');
  go('spending'); if(typeof segTo==='function') segTo('overview');
}
/* Reveal the incomplete cards (missing amount or category) after a failed save:
   land on the list so every red card is visible, then shake them once. */
function bulkShowInvalid(){
  bulkSaveTried=true;
  if(bulkRows.length>1) bulkActive=-1;              // multi → show the whole list; single → keep the open editor
  renderBulk();
  if(typeof refreshExCta==='function') refreshExCta();
  if(typeof requestAnimationFrame==='function'){
    requestAnimationFrame(function(){
      var cards=document.querySelectorAll('#bulk-list .bulk-card.invalid');
      for(var i=0;i<cards.length;i++){ cards[i].classList.remove('shake'); void cards[i].offsetWidth; cards[i].classList.add('shake'); }
    });
  }
  toast(L('Hãy hoàn tất các khoản được tô đỏ','Please complete the highlighted items'));
}
/* ---- edit a logged expense ---- */
var editingTx=null, editSnap=null;
function pad2(n){ return n<10?'0'+n:''+n; }
function isoDate(d){ return d.getFullYear()+'-'+pad2(d.getMonth()+1)+'-'+pad2(d.getDate()); }
function txDateInput(t){                                    // stored 'Jul 8' / 'Today' → yyyy-mm-dd for the date field
  var d=t.date||'';
  if(d==='Today'||d==='Just now') return isoDate(TODAY);
  var m=d.match(/([A-Za-z]+)\s+(\d{1,2})/);
  if(m){ var mi=MONA.indexOf(m[1]); if(mi<0)mi=TODAY.getMonth(); return '2026-'+pad2(mi+1)+'-'+pad2(+m[2]); }
  return isoDate(TODAY);
}
function whoToChip(w){ return (w==='Shared'||w==='both'||w==='Both')?'Both':(w||'Emma'); }
function txPhotoDate(t){ var p=txDateInput(t).split('-'); return new Date(+p[0],+p[1]-1,+p[2]); }
/* ---- EXIF capture date --------------------------------------------------
   _compressImage() redraws every photo on a <canvas>, and canvas output has no
   EXIF at all — so the capture date has to be read from the ORIGINAL File before
   compression ever runs, or it is gone for good.

   PHOTO_TAKEN maps a pre-compression data URI → 'YYYY-MM-DD'. Keying on the URI
   rather than threading a new field through exPhotos/evPhotos/memPickMulti keeps
   every existing array shape (and every splice/reorder) untouched; _uploadPhoto
   receives that same pre-compression URI, so the lookup still resolves there.
   Two identical photos collide on one key, which is harmless — same bytes, same
   date.

   We read DateTimeOriginal (0x9003) as a plain string and slice it. Building a
   Date and calling toISOString() would push anything shot between midnight and
   07:00 back a day in UTC+7 and match it to yesterday's expense. */
var PHOTO_TAKEN = new Map();

function _exifTakenOn(buf){
  try{
    var v = new DataView(buf);
    if(v.byteLength < 4 || v.getUint16(0) !== 0xFFD8) return null;      // JPEG only (HEIC/PNG → null)
    var off = 2;
    while(off + 4 <= v.byteLength){
      if(v.getUint8(off) !== 0xFF) return null;                          // out of marker sync
      var marker = v.getUint8(off + 1), size = v.getUint16(off + 2);
      if(marker === 0xE1){                                               // APP1 — the Exif segment
        var base = off + 4;
        if(v.getUint32(base) !== 0x45786966) return null;                // not "Exif"
        var tiff = base + 6;
        var le = v.getUint16(tiff) === 0x4949;                           // II = little-endian, MM = big
        var ifd0 = tiff + v.getUint32(tiff + 4, le);
        // DateTimeOriginal lives in the Exif sub-IFD, reachable via tag 0x8769 in IFD0.
        var sub = _exifTag(v, tiff, ifd0, 0x8769, le, true);
        var d = sub ? _exifTag(v, tiff, tiff + sub, 0x9003, le, false) : null;
        if(!d) d = _exifTag(v, tiff, ifd0, 0x0132, le, false);           // fall back to DateTime
        // Format is "YYYY:MM:DD HH:MM:SS"; an unset clock reads all zeroes.
        if(d && /^\d{4}:\d{2}:\d{2}/.test(d) && d.slice(0,4) !== '0000')
          return d.slice(0,4) + '-' + d.slice(5,7) + '-' + d.slice(8,10);
        return null;
      }
      if(marker === 0xDA) return null;                                   // start of scan — no Exif
      off += 2 + size;
    }
  }catch(e){}
  return null;
}
function _exifTag(v, tiff, dir, tag, le, isPointer){
  if(dir + 2 > v.byteLength) return null;
  var n = v.getUint16(dir, le);
  for(var i = 0; i < n; i++){
    var e = dir + 2 + i * 12;
    if(e + 12 > v.byteLength) return null;
    if(v.getUint16(e, le) !== tag) continue;
    if(isPointer) return v.getUint32(e + 8, le);
    var len = v.getUint32(e + 4, le);
    if(len < 1 || len > 64) return null;
    var at = tiff + v.getUint32(e + 8, le), s = '';
    for(var j = 0; j < len - 1 && at + j < v.byteLength; j++) s += String.fromCharCode(v.getUint8(at + j));
    return s;
  }
  return null;
}
/* Reads one File → { src, takenOn } and records the date in PHOTO_TAKEN.
   Parse and read run off the same File so the order is always parse-then-hold;
   compression happens later, inside _uploadPhoto, on the already-keyed URI. */
function readPhoto(file, cb){
  var fr = new FileReader();
  fr.onload = function(){
    var takenOn = _exifTakenOn(fr.result);
    var br = new FileReader();
    br.onload = function(){
      if(takenOn) PHOTO_TAKEN.set(br.result, takenOn);
      cb(br.result, takenOn);
    };
    br.onerror = function(){ cb(null, null); };
    br.readAsDataURL(file);
  };
  fr.onerror = function(){                                               // unreadable EXIF ≠ unusable photo
    var br = new FileReader();
    br.onload = function(){ cb(br.result, null); };
    br.onerror = function(){ cb(null, null); };
    br.readAsDataURL(file);
  };
  fr.readAsArrayBuffer(file.slice(0, 262144));                           // EXIF sits in the first bytes
}