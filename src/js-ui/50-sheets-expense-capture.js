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
    + '<button class="choice" data-v="Event" onclick="pickExCat(this)">🎈 Event</button>';
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
  var scroller = sheet.querySelector('.modal-body') || sheet;   // the modal scrolls its body, not itself
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
var exRecents=[
  {note:'Grocery run',cat:'Groceries',who:'Emma'},
  {note:'Coffee',cat:'Dining',who:'James'},
  {note:'Gas',cat:'Transport',who:'James'},
  {note:'Pharmacy',cat:'Others',who:'Emma'}
];
function selectChipByVal(group,val){
  var picked=false;
  document.getElementById(group).querySelectorAll('.choice').forEach(function(c){
    var on=c.dataset.v===val; c.classList.toggle('on',on); if(on)picked=true;
  });
  return picked;
}
function pickExCat(btn){ pick('ex-cat',btn); lastCat=btn.dataset.v; onExInput(); }
function pickExWho(btn){ pick('ex-who',btn); lastWho=btn.dataset.v; onExInput(); }
function setExCta(txt){}   // Save button label is fixed in the modal; the hint below explains the action
// The date decides the kind of expense: after today = a future expense (set aside), else = spent.
function exDate(){ var v=document.getElementById('ex-date').value; if(!v)return TODAY; var p=v.split('-'); return new Date(+p[0],+p[1]-1,+p[2]); }
function isExFuture(){ return exDate()>TODAY; }
// The "Event" category makes it an event; otherwise the date decides spent vs future expense.
function updateExWhen(){
  var isEvent=(chosen('ex-cat')==='Event'), fut=isExFuture(), past=exDate()<TODAY;
  var el=document.getElementById('ex-whenhint');
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
    var safe=Math.max(0,months[curMonthKey()].budget-months[curMonthKey()].spent-monthReserved());
    el.innerHTML='<span style="color:var(--brand-ink)">'+L('Sắp tới, để dành từ tháng này','Upcoming, set aside from this month')+'</span> · '+fmt(safe)+L(' vẫn an toàn để tiêu',' still safe to spend');
    return;
  }
  el.textContent='';   // a normal spend → no extra hint
}
function prefillExpense(){
  document.getElementById('ex-note').value='';
  document.getElementById('ex-amt').value='';
  var preCat = (exPreset && exPreset.cat && catBudget[exPreset.cat]) ? exPreset.cat : lastCat;
  selectChipByVal('ex-cat', preCat);
  selectChipByVal('ex-who', lastWho);
  var exIso = (exPreset && exPreset.date) || isoDate(TODAY);   // default: today
  document.getElementById('ex-date').value = exIso;
  // 24 months of backdating: the memory calendar lets you page back freely, and a
  // day you can tap has to be a day you can file something on.
  setDateFloor('ex-date', isoMonthStart(-24), exIso);
  // A preset can carry photos (bulk-assign hands off its selection here), so
  // this clears to the preset rather than unconditionally to empty.
  exPhotos = (exPreset && exPreset.photos) ? exPreset.photos.slice() : [];
  renderExPhoto();
  setTxt('ex-title',L('Ghi khoản chi','Log an expense'));
  var del=document.getElementById('ex-del'); if(del)del.style.display='none';
  updateExWhen(); refreshExCta();
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