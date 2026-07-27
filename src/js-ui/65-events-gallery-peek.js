/* ---------- events fund/create ---------- */
var CIRC=496.4, curEvent='japan';
var savings=0; // saved-for-events pool (hydrated from DB)
function openEvent(id){
  closeCat();
  curEvent=id; var e=events[id], dl=daysLeft(e.d), ach=achievedNow(e);
  document.getElementById('ov-hero').className='ov-hero';
  setTxt('ov-em',e.emoji); setTxt('ov-name',e.name);
  setTxt('ov-meta', ach ? L('Đã đạt · kỉ niệm từ '+(e.d?fmtDayMon(e.d):e.date),'Achieved · a memory from '+e.date) : ((e.d?fmtDayMon(e.d):e.date)+' · '+(dl===0?L('đến hạn hôm nay','due today'):L('còn '+dl+' ngày',dl+' days to go'))));
  document.getElementById('ov-funding').style.display=ach?'none':'block';
  document.getElementById('ov-memories').style.display=ach?'block':'none';
  var cta=document.getElementById('ov-cta');
  if(ach){ renderGallery('ov-gallery'); cta.textContent=L('Thêm ảnh & chú thích','Add photos & caption'); cta.setAttribute('onclick','openMemorySheet()'); }
  else { renderRing(); renderGallery('ov-fund-gallery'); cta.textContent=L('Góp quỹ','Add funds'); cta.setAttribute('onclick','openFund()'); }
  // photo-events mirror an expense's photos — those are removed from the expense, not here
  var evd=document.getElementById('ov-del'); if(evd) evd.style.display=e.fromExpense?'none':'block';
  document.getElementById('event-overlay').classList.add('on');
}
function renderGallery(boxId){
  boxId=boxId||'ov-gallery';
  var e=events[curEvent], box=document.getElementById(boxId); if(!box)return;
  if(!e.memories||!e.memories.length){
    box.innerHTML = boxId==='ov-fund-gallery' ? ''    // funding view: the "Add a photo" button is the invite
      : '<div class="mem-empty"><div class="me-emoji">📸</div><div class="me-t">No memories yet</div><p>Add a photo and caption to remember this event.</p></div>';
    delete box.dataset.sig;      // or deleting the last photo and re-adding it would match a stale sig and leave the empty state up
    return;
  }
  /* The hydrate re-renders on focus, on realtime and after every write. Rewriting
     innerHTML each time throws away the <img> nodes and builds new ones, which
     restarts every image's load and makes an already-cached gallery flash empty.
     Nothing to do unless the photo list actually changed. Keyed by event too —
     openPeek() indexes into events[curEvent], so a stale gallery from another
     event would open the wrong photo. */
  var sig=curEvent+'␝'+e.memories.map(function(m){ return (m.src||m.emoji||'')+'␟'+(m.caption||''); }).join('␞');
  if(box.dataset.sig===sig) return;

  var html='';
  e.memories.forEach(function(m,i){
    var cap=m.caption?'<div class="scrim"></div><div class="m-cap">'+esc(m.caption)+'</div>':'';
    // no delete button on the tile — it lives in the peek (see openPeek)
    if(m.src){
      /* These photos are the whole point of the screen, so they must not wait on
         an intersection check — lazy meant arriving on a detail view and watching
         images that were already in cache (the Memories mosaic painted them)
         resolve one by one. Load the first few eagerly; anything below the fold
         on a long event can still defer. */
      var eager=i<4;
      html+='<div class="mem-full tap" onclick="openPeek('+i+')"><img src="'+escAttr(m.src)+'" alt="'+escAttr(m.caption||'Memory photo')+'"'
        +(eager?' fetchpriority="high"':' loading="lazy"')+' decoding="async">'+cap+'</div>';
    } else {
      html+='<div class="mem-full tile tap '+esc(m.cls||'ph-park')+'" onclick="openPeek('+i+')"><div class="subj">'+esc(m.emoji||'📸')+'</div>'+cap+'</div>';
    }
  });
  box.innerHTML=html;
  box.dataset.sig=sig;
}

/* ---------- photo peek ----------
   Tap once: the photo lifts out, everything behind it blurs. Tap the photo
   again: the delete CTA appears. That second tap is what makes a quick
   double-tap from the gallery land straight on "Delete photo" — no tap-delay
   timer needed, because the first tap has already done something useful. */
var peekIdx=-1, peekDelT=null;
function openPeek(i){
  var e=events[curEvent]; if(!e||!e.memories||!e.memories[i])return;
  peekIdx=i;
  var m=e.memories[i];
  var frame=document.getElementById('peek-frame');
  var img=document.getElementById('peek-img'), tile=document.getElementById('peek-tile');
  if(m.src){
    frame.className='peek-frame';
    img.src=m.src; img.alt=m.caption||'Memory photo';
  } else {
    frame.className='peek-frame is-tile '+(m.cls||'ph-park');
    img.removeAttribute('src'); tile.textContent=m.emoji||'📸';
  }
  setTxt('peek-cap', m.caption||'');
  peekHideActions();
  document.getElementById('peek').classList.add('on');
}
function closePeek(){
  document.getElementById('peek').classList.remove('on');
  peekHideActions(); peekIdx=-1;
  var img=document.getElementById('peek-img'); if(img) img.removeAttribute('src');   // free the decoded bitmap
}
function peekHideActions(){
  clearTimeout(peekDelT);
  document.getElementById('peek-actions').classList.remove('on');
  var d=document.getElementById('peek-del');
  if(d){ d.classList.remove('armed'); d.textContent=L('Xoá ảnh','Delete photo'); }
}
function peekToggleActions(){
  var a=document.getElementById('peek-actions');
  if(a.classList.contains('on')) peekHideActions(); else a.classList.add('on');
}
function peekDelete(btn){
  if(!btn.classList.contains('armed')){          // still arm-then-confirm — this is permanent
    btn.classList.add('armed'); btn.textContent=L('Chạm lần nữa để xoá','Tap again to delete');
    clearTimeout(peekDelT);
    peekDelT=setTimeout(function(){
      if(!btn.isConnected)return;
      btn.classList.remove('armed'); btn.textContent=L('Xoá ảnh','Delete photo');
    },3000);
    return;
  }
  clearTimeout(peekDelT);
  var i=peekIdx;
  closePeek();
  deleteMemoryPhoto(i);
}
// Local removal; the DB module wraps this to delete the row + storage object.
function deleteMemoryPhoto(i){
  var e=events[curEvent]; if(!e||!e.memories||!e.memories[i])return;
  e.memories.splice(i,1);
  renderGallery('ov-gallery'); renderGallery('ov-fund-gallery');
  renderEvents(); renderMemCalendar();
  toast(L('Đã xoá ảnh','Photo deleted'));
}
var memPick=null, memPickMulti=null;
function openMemorySheet(){
  memPick=null; memPickMulti=null; document.getElementById('mem-cap').value='';
  setTxt('mem-ico', (events[curEvent]&&events[curEvent].emoji)||'📸');
  document.querySelectorAll('#mem-scenes button').forEach(function(b){ b.classList.remove('on'); });
  var pv=document.getElementById('mem-preview'); pv.className='mem-preview'; pv.style.backgroundImage='';
  openSheet('sheet-memory');
}
function showMemPreview(){
  var pv=document.getElementById('mem-preview');
  if(memPickMulti && memPickMulti.length){
    pv.className='mem-preview show'; pv.style.backgroundImage='url('+memPickMulti[0].src+')';
    setTxt('mem-prev-cap', memPickMulti.length+' photos selected'); return;
  }
  if(!memPick){ pv.className='mem-preview'; pv.style.backgroundImage=''; setTxt('mem-prev-cap',''); return; }
  if(memPick.src){ pv.className='mem-preview show'; pv.style.backgroundImage='url('+memPick.src+')'; }
  else { pv.className='mem-preview show '+memPick.cls; pv.style.backgroundImage=''; }
  setTxt('mem-prev-cap',L('Đã chọn ảnh','Photo selected'));
}
function pickMemScene(btn){
  memPickMulti=null;
  document.querySelectorAll('#mem-scenes button').forEach(function(b){ b.classList.remove('on'); });
  btn.classList.add('on'); memPick={cls:btn.dataset.c,emoji:btn.dataset.e}; showMemPreview();
}
function onMemFile(input){
  var files=input.files; if(!files||!files.length)return;
  var arr=Array.prototype.slice.call(files,0,10);            // max 10 at once
  var capped=files.length>10;
  document.querySelectorAll('#mem-scenes button').forEach(function(b){ b.classList.remove('on'); });
  if(arr.length>1){
    memPick=null; memPickMulti=new Array(arr.length); var loaded=0;
    arr.forEach(function(f,i){ readPhoto(f, function(src){ memPickMulti[i]={src:src}; if(++loaded===arr.length){ showMemPreview(); if(capped) toast(L('Đã thêm 10 ảnh đầu tiên','Added the first 10 photos')); } }); });
  } else {
    memPickMulti=null; readPhoto(arr[0], function(src){ memPick={src:src}; showMemPreview(); });
  }
  input.value='';
}
function addMemory(){
  var e=events[curEvent]; if(!e.memories)e.memories=[];
  if(memPickMulti && memPickMulti.length){                   // multiple photos → one memory each
    memPickMulti.slice().reverse().forEach(function(p){ e.memories.unshift({src:p.src}); });
    renderEvents(); openEvent(curEvent); closeModals();
    floatEmojis('📸'); return;
  }
  var cap=document.getElementById('mem-cap').value.trim(), m={};
  if(memPick){ if(memPick.src){ m.src=memPick.src; } else { m.cls=memPick.cls; m.emoji=memPick.emoji; } }
  else { m.cls='ph-park'; m.emoji='📸'; }
  if(cap) m.caption=cap;
  e.memories.unshift(m);                                     // a photo doesn't complete an event
  renderEvents(); openEvent(curEvent);
  closeModals(); floatEmojis('📸');
  if(!m.src) toast(L('Đã lưu kỉ niệm 📸','Memory saved 📸'));   // emoji tile → nothing to upload, so confirm now
}
function renderRing(){
  var e=events[curEvent], pct=e.target>0?Math.round(e.saved/e.target*100):0;
  var funded=e.saved>=e.target, dl=daysLeft(e.d);
  var frac=e.target>0?Math.min(1,e.saved/e.target):0;   // a 0 target used to yield NaN and a broken arc
  var rf=document.getElementById('ring-fill');
  rf.setAttribute('stroke-dashoffset',(CIRC*(1-frac)).toFixed(1));
  rf.style.stroke=funded?'var(--good)':'';              // the full ring turns celebratory green when funded
  if(funded){                                            // ready state: countdown leads, money demoted, no "0 still to save"
    setTxt('ring-pct','✓'); setTxt('ring-lab','Ready');
    setHTML('ov-cur', dl===0?'The day is here! 🎉':(dl+' day'+(dl!==1?'s':'')+' to go 🎉'));
    setTxt('ov-left', fmt(e.saved)+' set aside');
  } else {
    setTxt('ring-pct',pct+'%'); setTxt('ring-lab','funded');
    setHTML('ov-cur',fmt(e.saved)+' <span class="t">of '+fmt(e.target)+'</span>');
    setTxt('ov-left',fmt(Math.max(0,e.target-e.saved))+' still to save');
  }
}
function closeEvent(){ document.getElementById('event-overlay').classList.remove('on'); }
function addFunds(){
  var id=chosen('fn-event')||curEvent||order[0];
  var amt=parseAmtBase(document.getElementById('fn-amt').value);
  if(!amt){ document.getElementById('fn-amt').focus(); return; }
  var e=events[id];
  if(!e){ toast(L('Chọn một sự kiện để góp quỹ','Select an event to fund')); return; }
  if(e.saved>=e.target){ toast(L(e.name+' đã đủ tiền',e.name+' is already fully funded')); return; }
  if(savings<=0){ toast(L('Không có quỹ tiết kiệm để phân bổ','No savings available to allocate')); return; }
  if(amt>savings){ toast(L('Quỹ chỉ còn '+fmt(savings),'Only '+fmt(savings)+' available in savings')); return; }
  var who=chosen('fn-who')||'Emma', before=e.saved;
  var applied=Math.min(amt, e.target-e.saved);   // never overfund the event
  savings-=applied; e.saved+=applied;
  var justFunded=before<e.target && e.saved>=e.target;
  renderEvents();
  var ovOpen=document.getElementById('event-overlay').classList.contains('on') && id===curEvent;
  if(ovOpen && !achievedNow(e)){
    renderRing();
    document.getElementById('ov-history').insertAdjacentHTML('afterbegin','<div class="row"><div class="r-ico" style="background:var(--brand-tint);color:var(--brand)">＋</div><div class="r-body"><div class="r-t">'+who+L(' góp · từ quỹ tiết kiệm',' added · from savings')+'</div><div class="r-s">'+L('Vừa xong','Just now')+'</div></div><div class="r-amt num pos">+'+fmt(applied)+'</div></div>');
  } else if(ovOpen){ openEvent(id); }
  document.getElementById('fn-amt').value='';
  closeModals();
  if(justFunded){ celebrate('🎉',L(e.name+' đã đủ tiền!',e.name+' is fully funded!'),L('Tiền đã để dành xong, sẵn sàng cho '+(e.d?fmtDayMon(e.d):e.date)+'.','The money\'s set aside, ready for '+e.date+'.')); }
  else { toast(L('Đã thêm '+fmt(applied)+' · quỹ còn '+fmt(savings),'Added '+fmt(applied)+' · '+fmt(savings)+' left in savings')); floatEmojis(e.emoji); }
}
var selSrc='savings';
function pickSrc(btn){
  document.getElementById('ng-src').querySelectorAll('.src-opt').forEach(function(b){ b.classList.remove('on'); });
  btn.classList.add('on'); selSrc=btn.dataset.v;
  updateSrcHint();
}
function updateSrcHint(){
  var safe=Math.max(0,months.Jul.budget-months.Jul.spent-monthReserved());
  setHTML('src-savings', fmt(savings)+' <span class="u">available</span>');
  setHTML('src-month', fmt(safe)+' <span class="u">to spend</span>');
  var cost=parseAmtBase(document.getElementById('ng-amt').value)||0;
  var el=document.getElementById('ng-srchint'); if(!el)return;
  if(cost<=0){ el.textContent=''; return; }
  var avail=selSrc==='savings'?savings:safe;
  if(cost>avail) el.innerHTML='<span class="warn">Short by '+fmt(cost-avail)+', covers '+fmt(avail)+' now</span>';
  else if(selSrc==='savings') el.textContent=L('Đủ trọn '+fmt(cost)+' từ quỹ tiết kiệm','Covers the full '+fmt(cost)+' from savings');
  else el.innerHTML=L('Đủ trọn '+fmt(cost)+' · còn '+fmt(safe-cost)+' trong tháng','Covers the full '+fmt(cost)+' · leaves you '+fmt(safe-cost)+' in July');
}
/* Create is gated on both a name and a real target. The old code defaulted a blank
   target to 1000 and then immediately moved that much out of savings — a half-filled
   form could silently spend money. */
function ngDirty(){
  var b=document.getElementById('ng-save'); if(!b) return;
  var name=(document.getElementById('ng-name').value||'').trim();
  var target=parseAmtBase(document.getElementById('ng-amt').value)||0;
  b.disabled=!(name && target>0);
}
function addEvent(){
  var name=document.getElementById('ng-name').value.trim();
  if(!name){ document.getElementById('ng-name').focus(); return; }
  var target=parseAmtBase(document.getElementById('ng-amt').value)||0;
  if(!target){ document.getElementById('ng-amt').focus(); return; }
  var raw=document.getElementById('ng-date').value;       // "YYYY-MM-DD" from the date picker
  var src=selSrc;
  var id='e'+order.length+Math.floor(target);
  var d;
  if(raw){ var p=raw.split('-'); d=new Date(+p[0],+p[1]-1,+p[2]); }
  else { d=new Date(TODAY.getTime()+30*86400000); }
  var date=MONA[d.getMonth()]+' '+d.getDate();
  var ev={name:name,emoji:selEmoji,cov:selCov,date:date,d:d,target:target,saved:0,setAside:0};
  if(evPhotos.length) ev.memories=evPhotos.map(function(s){ return {src:s}; });   // photos added at creation
  events[id]=ev; order.unshift(id);
  // 100% cover the full cost by default, from the chosen source (capped by what's available)
  var msg=L('Đã tạo sự kiện 🎯','Event created 🎯');
  if(src==='month'){
    var safe=Math.max(0,months.Jul.budget-months.Jul.spent-monthReserved());
    var use=Math.min(target,safe);
    ev.saved+=use; ev.setAside+=use;
    msg='Created · '+fmt(use)+' set aside from July 🎯';
  } else {
    var use2=Math.min(target,savings);
    ev.saved+=use2; savings-=use2;
    msg='Created · '+fmt(use2)+' from savings 🎯';
  }
  renderEvents(); renderAll(); renderTxns();
  document.getElementById('ng-name').value=''; document.getElementById('ng-amt').value=''; document.getElementById('ng-date').value='';
  closeEventModal(); toast(msg); goMoments('plans'); floatEmojis(selEmoji);
}
