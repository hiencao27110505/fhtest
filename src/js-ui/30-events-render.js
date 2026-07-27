/* ---------- events ---------- */
function memTileHTML(k){
  var e=events[k], m=(e.memories&&e.memories[0])||null;
  if(!m){
    return '<div class="memory mem-blank" onclick="openEvent(&#39;'+escAttr(k)+'&#39;)"><div class="mb-em">'+esc(e.emoji)+'</div><div class="mb-cap">'+esc(e.name)+'</div><div class="mb-sub">'+L('Thêm kỉ niệm','Add a memory')+'</div></div>';
  }
  var cls, style, subj;
  if(m.src){ cls=''; style='style="background-image:url('+m.src+');background-size:cover;background-position:center"'; subj=''; }
  else { cls=m.cls||'ph-park'; style=''; subj='<div class="subj">'+(m.emoji||e.emoji)+'</div>'; }
  var c=e.memories.length;
  var sub=(e.d?fmtDayMon(e.d):e.date)+' · '+c+' '+(isVi()?'ảnh':('photo'+(c>1?'s':'')));
  return '<div class="memory '+cls+'" '+style+' onclick="openEvent(&#39;'+escAttr(k)+'&#39;)">'+subj+'<div class="scrim"></div><div class="m-cap">'+esc(e.name)+'</div><div class="m-date">'+esc(sub)+'</div></div>';
}
/* Đáng nhớ (past memories) is collapsed by default so a long timeline never buries the
   Album section below it. State persists across re-renders; renderEvents re-applies it. */
var memOpen=false, PAST_PREVIEW=3;   // show the 3 most recent by default, "Xem tất cả" reveals the rest
function applyPastPreview(){
  var up=window._upItems||'';                 // upcoming plans lead the timeline
  var items=window._pastItems||[];            // past memories (preview-limited)
  var pe=document.getElementById('past-events'), more=document.getElementById('past-more');
  var pastHTML=(memOpen||items.length<=PAST_PREVIEW)?items.join(''):items.slice(0,PAST_PREVIEW).join('');
  if(pe) pe.innerHTML=up+pastHTML+planTriggerHTML();   // plan trigger is the last node on the rail
  if(more){
    if(items.length<=PAST_PREVIEW){ more.style.display='none'; }
    else { more.style.display=''; more.textContent=memOpen?L('Thu gọn','Show less'):L('Xem tất cả','See all'); }
  }
}
function toggleMem(){ memOpen=!memOpen; applyPastPreview(); }
// The final node on the memories timeline: a subtle "add the next moment" prompt on the rail.
function planTriggerHTML(){
  return '<button class="tl-item tl-add" id="plan-trigger" onclick="openSheet(\'sheet-event\')" aria-label="'+L('Lên kế hoạch cho một dịp mới','Plan a new occasion')+'">'
    +'<div class="tl-date"><span class="tl-add-plus">+</span></div>'
    +'<div class="tl-rail"><span class="tl-dot tl-dot-open"></span></div>'
    +'<div class="tl-add-card"><div class="tl-add-t">'+L('Lên kế hoạch cho một dịp mới','Plan a new occasion')+'</div>'
    +'<div class="tl-add-s">'+L('Thêm điều đáng nhớ tiếp theo','Add the next thing worth remembering')+'</div></div>'
  +'</button>';
}
/* Shared empty state for the "Sắp tới" (upcoming plans) section — ONE pattern (icon →
   title → action, per Apple's empty-state shape) so both instances read the same, but
   two weights for context: `compact` on the Home dashboard (a quiet glance inside its
   card) vs the full treatment on the Khoảnh Khắc tab (the dedicated place to plan, so it
   earns the explanatory line). Same title/icon/button = consistency; different prominence
   = context-fit. */
function emptyPlansHTML(compact){
  // Even spacing scale, symmetric padding: icon → 12 → title → 7 → body → 18 → button.
  return '<div style="padding:'+(compact?'22px 20px':'30px 22px')+';text-align:center">'
    +'<div style="font-size:'+(compact?'32px':'38px')+';line-height:1">🗓️</div>'
    +'<div style="font-family:var(--disp);font-weight:700;font-size:'+(compact?'16px':'18px')+';letter-spacing:-.2px;color:var(--ink);margin-top:12px">'+L('Chưa có dự định nào','Nothing planned yet')+'</div>'
    +(compact ? '' : '<p style="color:var(--muted);font-size:14px;line-height:1.5;margin:7px auto 0;max-width:30ch">'+L('Lên kế hoạch cho một dịp của gia đình: chuyến đi, sinh nhật hay một bữa tối đáng nhớ.','Plan a family occasion: a trip, a birthday, a dinner worth remembering.')+'</p>')
    +'<button class="empty-cta" style="margin-top:18px" onclick="openSheet(\'sheet-event\')">'+L('Lên kế hoạch','Plan something')+'</button></div>';
}
function renderEvents(){
  // Mirror events (shadow events standing in for a photo-expense) no longer appear in
  // the Events tab — their photos live in Memories directly (see buildMemRecords). Real
  // savings goals, including genuinely achieved ones, are unaffected. The mirror is still
  // CREATED under the hood (syncExpenseEvent) — only its display here is suppressed.
  var isMirror=function(k){ var e=events[k]; return !!(e&&(e._srcTxn||e.fromExpense)); };
  var up=order.filter(function(k){return !isMirror(k)&&!achievedNow(events[k]);});
  var mem=order.filter(function(k){return !isMirror(k)&&achievedNow(events[k]);});
  var upS=up.slice().sort(function(a,b){return events[a].d-events[b].d;});
  // compact stats summary (home)
  var toSave=upS.reduce(function(s,k){return s+Math.max(0,events[k].target-events[k].saved);},0);
  var saved=upS.reduce(function(s,k){return s+events[k].saved;},0);
  var nextDl=upS.length?daysLeft(events[upS[0]].d):0;
  var sum=document.getElementById('home-ev-sum');
  if(sum) sum.innerHTML=upS.length
    ? '<div class="s"><div class="sv num">'+fmt(toSave)+'</div><div class="sl">'+L('cần thêm','still to save')+'</div></div>'
      +'<div class="s"><div class="sv num">'+upS.length+'</div><div class="sl">'+L('sự kiện','events')+'</div></div>'
      +'<div class="s"><div class="sv num">'+(nextDl===0?L('hôm nay','today'):nextDl+L(' ngày','d'))+'</div><div class="sl">'+L('kế tiếp','next due')+'</div></div>'
    : '';
  // ---- Events tab insightful stats ----
  var totalTarget=upS.reduce(function(s,k){return s+events[k].target;},0);
  var totalSaved=upS.reduce(function(s,k){return s+events[k].saved;},0);
  var pctF=totalTarget?Math.round(totalSaved/totalTarget*100):0;
  var dueSoon=upS.filter(function(k){return daysLeft(events[k].d)<=30;});
  var thisMonth=dueSoon.reduce(function(s,k){return s+Math.max(0,events[k].target-events[k].saved);},0);
  // one focal number: total savings (allocated + available) vs the goal (sum of targets)
  var totSav=totalSaved+savings, goal=totalTarget, stillToHave=Math.max(0,goal-totSav);
  var savPct=(goal?Math.min(100,totSav/goal*100):0);
  setTxt('sav-total',fmt(totSav)); setTxt('ev-goal',fmt(goal));
  var sf=document.getElementById('sav-fill'); if(sf)sf.style.width=savPct+'%';
  setHTML('ev-tosave','<b>'+fmt(stillToHave)+'</b> '+L('cần tiết kiệm thêm','still to save'));
  setTxt('sav-avail-lbl',fmt(savings)+L(' sẵn có',' ready'));
  // hero savings summary tile
  setTxt('ht-sav',fmt(totSav));
  // warm the abstract savings figure into concrete progress toward the next goal
  var nextEv=upS.length?events[upS[0]]:null;
  if(nextEv){ var np=Math.min(100,Math.round(nextEv.saved/nextEv.target*100)); setHTML('ht-sav-s', np+'% '+L('tới','to')+' '+esc(nextEv.name)); }
  else setTxt('ht-sav-s', fmt(stillToHave)+L(' còn lại',' to go'));
  var eb=document.getElementById('ev-badge');
  if(eb){ if(thisMonth>0){ eb.className='b-badge over'; eb.textContent=fmt(thisMonth)+L(' sắp tới hạn',' due soon'); }
          else { eb.className='b-badge ok'; eb.textContent=L('không có gì sắp tới hạn','nothing due soon'); } }
  // compact rows (home) — this month's upcoming; if none this month, just the next one
  var thisMon=upS.filter(function(k){ return events[k].d.getMonth()===TODAY.getMonth() && events[k].d.getFullYear()===TODAY.getFullYear(); });
  var homeUp = thisMon.length ? thisMon : upS.slice(0,1);
  var rows='';
  homeUp.forEach(function(k){
    var e=events[k], pct=Math.round(e.saved/e.target*100), dl=daysLeft(e.d), funded=e.saved>=e.target;
    var evCov=(e.memories&&e.memories[0]&&e.memories[0].src);   // a saved photo makes the goal feel real, not just a number
    var thumb=evCov?'<div class="em-sm" style="background-image:url('+evCov+');background-size:cover;background-position:center"></div>':'<div class="em-sm">'+e.emoji+'</div>';
    var dueTxt=(dl===0?L('hôm nay','today'):L('còn '+dl+' ngày','in '+dl+' day'+(dl!==1?'s':'')));
    rows+='<div class="ev-row" onclick="openEvent(&#39;'+escAttr(k)+'&#39;)">'+thumb
      +(funded
        ? '<div class="evb"><div class="evt"><span>'+e.name+'</span><span class="ev-ready">✓ '+L('Sẵn sàng','Ready')+'</span></div><div class="evs">'+L('Đã đủ tiền','Fully funded')+' · '+dueTxt+'</div></div></div>'
        : '<div class="evb"><div class="evt"><span>'+e.name+'</span><span class="p num">'+pct+'%</span></div>'
          +'<div class="evs">'+dueTxt+' · '+fmt(Math.max(0,e.target-e.saved))+L(' còn lại',' to go')+'</div>'
          +'<div class="evbar"><i style="width:'+pct+'%"></i></div></div></div>');
  });
  setHTMLIf('home-events', rows||emptyPlansHTML(true));   // Home = compact glance (dashboard card)
  // full cards (Events tab) — neutral, no avatars
  var full='';
  upS.forEach(function(k){
    var e=events[k], pct=Math.round(e.saved/e.target*100), dl=daysLeft(e.d);
    var tlDate = e.noDay
      ? '<div class="tl-date"><div class="d num" style="font-size:17px;letter-spacing:-.3px">'+moAbbr(e.d.getMonth()).toUpperCase()+'</div><div class="dl">'+L('tháng này','this month')+'</div></div>'
      : '<div class="tl-date"><div class="d num">'+e.d.getDate()+'</div><div class="mo">'+moAbbr(e.d.getMonth())+'</div><div class="dl">'+(dl===0?L('hôm nay','today'):L('còn '+dl+'n','in '+dl+'d'))+'</div></div>';
    var card=funded
      ? '<div class="tl-card ready">'
          +'<div class="tl-top"><span class="tl-emoji">'+e.emoji+'</span><span class="tl-name">'+e.name+'</span><span class="tl-ready">✓ '+L('Sẵn sàng','Ready to go')+'</span></div>'
          +'<div class="tl-count">🎉 '+L('Đã đủ tiền','Fully funded')+', '+(dl===0?L('đến ngày rồi!','the day is here!'):L('còn '+dl+' ngày',dl+' day'+(dl!==1?'s':'')+' to go'))+'</div>'
          +'<div class="tl-fig num">'+L('đã để dành '+fmt(e.saved),fmt(e.saved)+' set aside')+'</div>'
        +'</div>'
      : '<div class="tl-card">'
          +'<div class="tl-top"><span class="tl-emoji">'+e.emoji+'</span><span class="tl-name">'+e.name+'</span><span class="tl-pct num">'+pct+'%</span></div>'
          +'<div class="bar" style="margin:11px 0 8px"><i style="width:'+pct+'%"></i></div>'
          +'<div class="tl-fig num"><b>'+fmt(e.saved)+'</b> '+L('trên','of')+' '+fmt(e.target)+' · '+fmt(Math.max(0,e.target-e.saved))+L(' còn lại',' to go')+'</div>'
        +'</div>';
    full+='<div class="tl-item" onclick="openEvent(&#39;'+escAttr(k)+'&#39;)">'+tlDate+'<div class="tl-rail"><span class="tl-dot"></span></div>'+card+'</div>';
  });
  // Upcoming plans now lead the Đáng nhớ occasions timeline (no separate "Sắp tới").
  window._upItems = full;
  // ---- Past events (Events tab): nudge to add photos → memories ----
  function noPhotos(k){ return !(events[k].memories&&events[k].memories.length); }
  // Strictly reverse-chronological. This used to float photo-less events to the
  // top as a nudge, but on a dated timeline that produced a rail running
  // May → Jul → Jun, which reads as broken. The "N need photos" count in the
  // section header carries the nudge instead.
  var past=mem.slice().sort(function(a,b){ return events[b].d-events[a].d; });
  var needy=past.filter(noPhotos).length;
  var plItems=[];
  past.forEach(function(k){
    var e=events[k];
    // same timeline rail as upcoming, so the tab reads as one continuous story
    var tlDate='<div class="tl-date"><div class="d num">'+e.d.getDate()+'</div><div class="mo">'+moAbbr(e.d.getMonth())+'</div>'
      +'<div class="dl">'+agoLabel(e.d)+'</div></div>';
    var body;
    if(noPhotos(k)){
      body='<div class="tl-fig">'+L('Chưa có ảnh','No photos yet')+'</div>'
        +'<span class="past-add" style="margin-top:10px"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6"><path d="M12 5v14M5 12h14" stroke-linecap="round"/></svg>'+L('Thêm ảnh','Add photos')+'</span>';
    } else {
      var c=e.memories.length;
      // the photos are the point of a past event — show them, don't hide them behind a thumbnail
      body='<div class="tl-photos">'+e.memories.slice(0,4).map(function(m,i){
        var more=(i===3 && c>4) ? '<span class="tl-more">+'+(c-4)+'</span>' : '';
        return m.src
          ? '<span class="tl-ph"><img src="'+escAttr(m.src)+'" alt="'+escAttr(m.caption||e.name)+'" loading="lazy" decoding="async">'+more+'</span>'
          : '<span class="tl-ph tile '+esc(m.cls||'ph-park')+'">'+esc(m.emoji||'📸')+more+'</span>';
      }).join('')+'</div>'
        +'<div class="tl-fig">'+c+' '+(isVi()?'ảnh':('photo'+(c>1?'s':'')))+'</div>';
    }
    plItems.push('<div class="tl-item" onclick="openEvent(&#39;'+escAttr(k)+'&#39;)">'
      +tlDate
      +'<div class="tl-rail"><span class="tl-dot done"></span></div>'
      +'<div class="tl-card">'
        +'<div class="tl-top"><span class="tl-emoji">'+esc(e.emoji)+'</span><span class="tl-name">'+esc(e.name)+'</span></div>'
        +body
      +'</div></div>');
  });
  // Header shows whenever there are occasions (upcoming or past); when there are none,
  // the section is just the plan trigger below.
  var ph=document.getElementById('past-head'); if(ph)ph.style.display=(past.length||upS.length)?'':'none';
  window._pastItems=plItems;
  applyPastPreview();   // renders upcoming + past + the plan-trigger node
  // Home memories: cover tiles up top (events + expenses, newest 10) + a full-size photo
  // feed below the expenses (up to 50, lazy-loaded), "See all" → Memories tab.
  buildMemRecords();
  var groups=memGroups(), feedPhotos=memRecords.filter(function(r){return r.src;});
  var tiles=groups.slice(0,10).map(memCoverHTML).join('');
  var empty='<div class="mem-empty"><div class="me-emoji">📸</div><div class="me-t">'+L('Chưa có kỉ niệm nào','No memories yet')+'</div><p>'+L('Thêm ảnh vào một khoản chi hoặc sự kiện để bắt đầu.','Add a photo to an expense or event to start your memories.')+'</p></div>';
  setHTMLIf('home-memories', tiles||empty);
  var fb=document.getElementById('home-feed'); if(fb) setHTMLIf(fb, feedPhotos.slice(0,50).map(memFeedHTML).join(''));
  var fhh=document.getElementById('home-feed-h'); if(fhh) fhh.style.display=feedPhotos.length?'':'none';
  renderMemoriesTab(mem);
  renderMemCalendar();
  if(typeof renderGoals==='function') renderGoals();   // first-class saving goals (Thu Chi)
}