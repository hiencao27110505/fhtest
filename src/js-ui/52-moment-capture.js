/* ---------- Log a moment (photo-first) ----------
   The mirror image of the expense form. An expense is money-first with optional
   photos; a moment is PHOTOS-first with an optional related expense.

     • Photos only            → a standalone memory: an achieved, money-less event
                                whose photos live in event_memories (buildMemRecords
                                step 1 surfaces them into Album / calendar / timeline).
     • Photos + amount + cat  → a real expense carrying those photos, logged through
                                the proven addExpense() path (which itself becomes a
                                memory via syncExpenseEvent). No new money plumbing.

   Kept deliberately OUT of the bulk expense modal: that form is coupled to bulkRows,
   draft persistence and the Event/future-proposal branches, and threading a "moment
   mode" through all of it would risk the expense flow. This is its own small modal. */
var momPhotos = [];                         // data-URIs held in memory until Save (like exPhotos)
var momExpOpen = false;                     // is the optional-expense section revealed?

// A pure photographed memory is an achieved, target-less, non-mirror event. Used post-hydrate
// (where the session-only intent flag is gone) to tell a moment apart from a savings occasion.
function isMomentEvent(e){ return !!(e && e.achieved && !e._srcTxn && !e.fromExpense && !(e.target > 0) && e.memories && e.memories.length); }

function openMomentModal(preset){
  preset = preset || {};
  momPhotos = (preset.photos || []).slice();
  momExpOpen = false;
  // date: a moment is something that happened → default today, backdatable, never future.
  var iso = preset.date || isoDate(TODAY);
  var dEl = document.getElementById('mom-date'); if(dEl){ dEl.value = iso; setDateFloor('mom-date', isoMonthStart(-24), iso); dEl.max = isoDate(TODAY); }
  document.getElementById('mom-cap').value = preset.caption || '';
  document.getElementById('mom-amt').value = '';
  buildMomCatChips();
  // labels are set here (not via data-t) so the modal stays self-contained — see file note in build.js
  setTxt('mom-title', L('Khoảnh khắc mới','New moment'));
  setTxt('mom-drop-t', L('Thêm ảnh khoảnh khắc','Add moment photos'));
  setTxt('mom-cap-lbl', L('Kể đôi lời về khoảnh khắc này','Say a little about this moment'));
  setTxt('mom-when-lbl', L('Khi nào','When'));
  setTxt('mom-who-lbl', L('Ai trong ảnh / ai thêm','Who'));
  setTxt('mom-exp-toggle-t', L('Gắn một khoản chi','Add a related expense'));
  setTxt('mom-exp-toggle-s', L('Không bắt buộc','Optional'));
  setTxt('mom-amt-lbl', L('Số tiền','Amount'));
  setTxt('mom-cat-lbl', L('Hạng mục','Category'));
  document.getElementById('mom-save').textContent = L('Lưu','Save');
  document.getElementById('mom-cap').placeholder = L('VD: Bữa tối cuối tuần','e.g. Sunday dinner');
  renderMomExpSection();
  renderMomPhotos();
  fhClearInvalid('moment-modal');
  document.getElementById('scrim').classList.add('on');
  var m = document.getElementById('moment-modal'); m.style.transform=''; m.style.transition=''; m.classList.add('on');
  var body = m.querySelector('.modal-body'); if(body) body.scrollTop = 0;
  refreshMomCta();
}
function closeMomentModal(){ closeModals(); momPhotos=[]; momExpOpen=false; }

/* Photos are the hero. The picker is a big dropzone until the first photo lands,
   then a thumbnail strip + an "add more" affordance. */
function onMomPhoto(input){
  var files = Array.prototype.slice.call(input.files||[]);
  files.forEach(function(f){
    if(momPhotos.length>=10){ toast(L('Tối đa 10 ảnh','Up to 10 photos')); return; }
    readPhoto(f, function(src){ if(src && momPhotos.length<10){ momPhotos.push(src); renderMomPhotos(); refreshMomCta(); } });
  });
  input.value='';
}
function removeMomPhoto(i){ momPhotos.splice(i,1); renderMomPhotos(); refreshMomCta(); }
function renderMomPhotos(){
  // Empty → the big dropzone. One or more photos → the photo IS the hero (large, on
  // top), with a "＋ add more" row beneath it (plus small thumbs for any extra photos).
  var drop=document.getElementById('mom-drop'), gal=document.getElementById('mom-strip');
  var has=momPhotos.length>0;
  if(drop) drop.style.display = has ? 'none' : '';
  if(!gal) return;
  gal.style.display = has ? '' : 'none';
  if(!has){ gal.innerHTML=''; return; }
  var hero='<div class="mom-hero" style="background-image:url('+momPhotos[0]+')">'
    +'<button type="button" class="mom-hero-x" onclick="removeMomPhoto(0)" aria-label="'+L('Xoá ảnh','Remove photo')+'">✕</button>'
    +(momPhotos.length>1?'<span class="mom-hero-n">1 / '+momPhotos.length+'</span>':'')+'</div>';
  var thumbs=momPhotos.slice(1).map(function(src,i){
    var idx=i+1;
    return '<div class="photo-thumb mom-th" style="background-image:url('+src+')"><button type="button" class="x" onclick="removeMomPhoto('+idx+')">✕</button></div>';
  }).join('');
  var add='<label class="mom-add-more" aria-label="'+L('Thêm ảnh','Add photo')+'"><span>＋</span><input type="file" accept="image/*" multiple onchange="onMomPhoto(this)" hidden></label>';
  gal.innerHTML = hero + '<div class="mom-thumbrow">'+thumbs+add+'</div>';
}

function momToggleExp(){ momExpOpen=!momExpOpen; renderMomExpSection(); if(momExpOpen){ var a=document.getElementById('mom-amt'); if(a) setTimeout(function(){ a.focus(); },80); } }
function renderMomExpSection(){
  var body=document.getElementById('mom-exp-body'), tog=document.getElementById('mom-exp-toggle');
  if(body) body.style.display = momExpOpen ? '' : 'none';
  if(tog) tog.classList.toggle('open', momExpOpen);
}
function buildMomCatChips(){
  var box=document.getElementById('mom-cat'); if(!box)return;
  box.innerHTML = (catOrder||[]).map(function(c,i){ var s=catStyle[c]||['🏷️']; return '<button type="button" class="choice'+(i===0?' on':'')+'" data-v="'+esc(c)+'" onclick="pick(\'mom-cat\',this)">'+s[0]+' '+esc(c)+'</button>'; }).join('');
}
function pickMomWho(btn){ pick('mom-who',btn); }
function momDirty(){ fhClearInvalid('moment-modal'); refreshMomCta(); }
function refreshMomCta(){
  // Save stays enabled once there's at least one photo. An empty amount is fine
  // (photos-only moment); a filled amount with no category is caught on submit
  // (shake), never a silently-disabled button — same stance as the expense form.
  var s=document.getElementById('mom-save'); if(!s)return;
  s.disabled = !(momPhotos.length>0);
}
function momDateObj(){ var v=document.getElementById('mom-date').value; if(!v)return TODAY; var p=v.split('-'); return new Date(+p[0],+p[1]-1,+p[2]); }

function saveMoment(){
  if(!momPhotos.length){
    var drop=document.getElementById('mom-drop');
    if(drop){ drop.classList.remove('shake'); void drop.offsetWidth; drop.classList.add('shake'); }
    toast(L('Thêm ít nhất một tấm ảnh','Add at least one photo')); return;
  }
  var d=momDateObj(), iso=isoDate(d);
  var cap=(document.getElementById('mom-cap').value||'').trim();
  var whoRaw=chosen('mom-who')||(window.lastWho||'Emma');
  var whoStore=(whoRaw==='Both'||whoRaw==='Chung')?'Shared':whoRaw;
  var amt=momExpOpen?parseAmtBase(document.getElementById('mom-amt').value):0;

  // --- optional related expense: hand off to the proven expense path -----------
  if(amt>0){
    var catEl=document.getElementById('mom-cat'), cat=chosen('mom-cat');
    if(!cat){ if(catEl){ catEl.classList.remove('shake'); void catEl.offsetWidth; catEl.classList.add('shake'); } toast(L('Chọn một hạng mục','Pick a category')); return; }
    // Populate the (hidden) expense form and reuse addExpense — it logs the txn,
    // attaches the photos, and mirrors them into Memories, with real budget math.
    editingTx=null; exPreset=null; buildExCatChips();
    document.getElementById('ex-note').value = cap || L('Khoản chi','Expense');
    document.getElementById('ex-amt').value  = (amt*curMult()).toLocaleString(CUR==='VND'?'vi-VN':'en-US');
    document.getElementById('ex-date').value = iso;
    setDateFloor('ex-date', isoMonthStart(-24), iso);
    selectChipByVal('ex-cat', cat);
    selectChipByVal('ex-who', whoToChip(whoStore));
    exPhotos = momPhotos.slice();
    momPhotos=[]; momExpOpen=false;
    window.addExpense();                       // wrapped in js-data → persists txn + photos + mirror event
    // addExpense navigates to Finance; a moment save belongs on the Album.
    requestAnimationFrame(function(){ goMoments('album'); });
    return;
  }

  // --- photos-only: a standalone, money-less memory ----------------------------
  var name=cap||L('Khoảnh khắc','A moment');
  var id='m'+order.length+Date.now();
  var ev={ name:name, emoji:'📸', cov:'sun', date:(MONA[d.getMonth()]+' '+d.getDate()), d:d,
    target:0, saved:0, setAside:0, achieved:true, momentOnly:true, who:whoStore,
    memories: momPhotos.map(function(s,i){ return i===0?{src:s,caption:name}:{src:s}; }) };
  var n=momPhotos.length;
  events[id]=ev; order.unshift(id);
  momPhotos=[]; momExpOpen=false;
  renderEvents(); renderAll(); renderTxns();
  closeMomentModal();
  toast(n>1?L(n+' ảnh đã lưu 📸',n+' photos saved 📸'):L('Đã lưu khoảnh khắc 📸','Moment saved 📸'));
  floatEmojis('📸'); goMoments('album');
}
window.openMomentModal=openMomentModal; window.saveMoment=saveMoment;
