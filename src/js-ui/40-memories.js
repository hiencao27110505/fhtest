/* ---------- memories photo calendar ---------- */
var mcalY=null, mcalM=null;
function memCalInit(){
  var latest=null;
  order.forEach(function(k){ var e=events[k]; if(e.memories&&e.memories.length){ if(!latest||e.d>latest)latest=e.d; } });
  var d=latest||TODAY; mcalY=d.getFullYear(); mcalM=d.getMonth();
}
function mcalNav(delta){ if(mcalY===null)memCalInit(); mcalM+=delta; if(mcalM<0){mcalM=11;mcalY--;} if(mcalM>11){mcalM=0;mcalY++;} mcalSel=null; renderMemCalendar(); renderMemoriesTab(); }
/* The date inputs used to carry min="2026-07-01" hardcoded in the markup, so the
   floor drifted out of date the moment the month turned — by September it still
   said July. Compute it instead. The floor is also widened to whatever date is
   being prefilled, so a day picked from the calendar can never be rejected by the
   very input we just put it in. */
function setDateFloor(id, floorIso, valueIso){
  var el=document.getElementById(id); if(!el)return;
  if(valueIso && valueIso<floorIso) floorIso=valueIso;   // ISO strings compare correctly
  el.min=floorIso;
}
// Clamped to the target month's last day: a naive +1 month on Jan 31 lands on
// Mar 3, which reads as a typo in a date field.
function isoShiftMonths(n){
  var d=new Date(TODAY.getFullYear(),TODAY.getMonth()+n,1);
  var last=new Date(d.getFullYear(),d.getMonth()+1,0).getDate();
  d.setDate(Math.min(TODAY.getDate(),last));
  return isoDate(d);
}
function isoMonthStart(n){ return isoDate(new Date(TODAY.getFullYear(),TODAY.getMonth()+n,1)); }
function renderMemCalendar(){
  var grid=document.getElementById('mcal-grid'); if(!grid)return;
  if(mcalY===null) memCalInit();
  setTxt('mcal-mon', fmtMonYear(mcalM, mcalY));
  var firstDow=new Date(mcalY,mcalM,1).getDay();
  var dim=new Date(mcalY,mcalM+1,0).getDate();
  var byDay={};
  order.forEach(function(k){ var e=events[k]; if(e.memories&&e.memories.length&&e.d.getFullYear()===mcalY&&e.d.getMonth()===mcalM&&byDay[e.d.getDate()]===undefined){ byDay[e.d.getDate()]={m:e.memories[0],type:'event',ref:k}; } });
  var html='';
  (isVi()?['CN','2','3','4','5','6','7']:['S','M','T','W','T','F','S']).forEach(function(d){ html+='<div class="dow">'+d+'</div>'; });
  for(var i=0;i<firstDow;i++) html+='<div class="mcell mute"></div>';
  for(var d=1;d<=dim;d++){
    var isToday=(mcalY===TODAY.getFullYear()&&mcalM===TODAY.getMonth()&&d===TODAY.getDate());
    var info=byDay[d];
    if(info){
      var m=info.m, cls='mcell photo'+(isToday?' today':''), style='';
      if(m.src){ style=' style="background-image:url('+m.src+')"'; } else { cls+=' '+(m.cls||'ph-park'); }
      html+='<div class="'+cls+'"'+style+' onclick="openPhotosForDate('+mcalY+','+mcalM+','+d+')"><div class="scrim"></div><span class="mday">'+d+'</span></div>';
    } else {
      // A real <button> so it is focusable and reads as an action to VoiceOver —
      // the photo cells predate this and stay divs.
      var sel=mcalSel&&mcalSel.y===mcalY&&mcalSel.m===mcalM&&mcalSel.d===d;
      var lab=isVi()?(d+' '+moFull(mcalM)+', chưa có gì, thêm một khoảnh khắc.'):(MONF[mcalM]+' '+d+', nothing yet. Add something.');
      html+='<button type="button" class="mcell day open'+(isToday?' today':'')+(sel?' sel':'')+'"'
        +' aria-pressed="'+(sel?'true':'false')+'" aria-label="'+escAttr(lab)+'"'
        +' onclick="mcalPick('+mcalY+','+mcalM+','+d+')">'+d+'</button>';
    }
  }
  grid.innerHTML=html;
  renderMcalPrompt();
}
/* Tapping an empty day selects it and reveals a prompt under the grid, rather
   than throwing a full-screen form up immediately: a stray tap while scrolling
   the Memories tab shouldn't cost a dismissal, and the selection undoes itself
   on a second tap. Selection lives in a variable, not the DOM, so the hydrate's
   re-render on focus/realtime/write can't silently clear it. */
var mcalSel=null;                                   // {y,m,d} of the tapped empty day
function mcalPick(y,m,d){
  var same=mcalSel&&mcalSel.y===y&&mcalSel.m===m&&mcalSel.d===d;
  mcalSel=same?null:{y:y,m:m,d:d};
  renderMemCalendar();
}
function mcalDate(){ return mcalSel?new Date(mcalSel.y,mcalSel.m,mcalSel.d):null; }
function renderMcalPrompt(){
  var box=document.getElementById('mcal-prompt'); if(!box)return;
  var dt=mcalDate();
  if(!dt){ box.classList.remove('on'); box.innerHTML=''; return; }
  // The date decides the offer, so the user never picks between "event" and
  // "expense" — a past day can only be something that happened, a future day can
  // only be something planned.
  var past=dt.getTime()<TODAY.getTime();
  box.innerHTML='<div class="mcal-prompt-in"><div class="mcp-txt">'
    +'<div class="mcp-d">'+esc(isVi()?(mcalSel.d+' '+moFull(mcalSel.m)):(MONF[mcalSel.m]+' '+mcalSel.d))+'</div>'
    +'<div class="mcp-h">'+(past?L('Chưa lưu gì cho ngày này.','Nothing saved on this day yet.'):L('Chưa có kế hoạch cho ngày này.','Nothing planned for this day yet.'))+'</div></div>'
    +'<button type="button" class="mcp-go" onclick="mcalCreate()">'+(past?L('Ghi một khoản chi','Log an expense'):L('Lên kế hoạch','Plan an event'))+'</button></div>';
  box.classList.add('on');
}
function mcalCreate(){
  var dt=mcalDate(); if(!dt)return;
  var iso=isoDate(dt), past=dt.getTime()<TODAY.getTime();
  mcalSel=null; renderMemCalendar();                // clear it behind the modal, not on return
  if(past) openExpense({date:iso});
  else openEventModal({date:iso});
}
// Every memory (from an event or a photo-expense) is a record; the tab is a photo grid into these.
var memRecords=[];
// A photo-expense is mirrored into a linked (achieved) event so it shows in Events + Memories.
function syncExpenseEvent(t){
  var has=t.photos && t.photos.length;
  if(has){
    var key=t.linkedEvent||('xp-'+t.id); t.linkedEvent=key;
    var s=catStyle[t.cat]||['📸'];
    var prev=events[key]||{};
    // Update in place. Replacing the object wholesale dropped _dbId/_srcTxn, so
    // the write-through saw an event with no DB id and inserted a second row.
    events[key]={name:t.note,emoji:s[0]||'📸',cov:'sun',date:t.date,d:txPhotoDate(t),
      target:t.amt,saved:t.amt,achieved:true,fromExpense:t.id,
      memories:t.photos.map(function(src){return {src:src};}),
      _dbId:prev._dbId, _srcTxn:prev._srcTxn||t._dbId||null, _dbPending:prev._dbPending};
    if(order.indexOf(key)<0) order.unshift(key);
  } else if(t.linkedEvent){
    delete events[t.linkedEvent]; var i=order.indexOf(t.linkedEvent); if(i>=0) order.splice(i,1); delete t.linkedEvent;
  }
}
function buildMemRecords(){
  memRecords=[];
  // EXPERIMENT (unify "memory"): a memory is any photographed moment in the past —
  // whether it hangs off an event (a savings goal) or an expense. So the feed is built
  // from two sources directly, and no longer relies on the mirror-event bridge to
  // surface expense photos.
  //   1. Real events contribute their memories as captioned event blocks (unchanged).
  //   2. Mirror events (those standing in for a photo-expense, marked by _srcTxn /
  //      fromExpense) are SKIPPED here — their photos come straight from the expense
  //      in step 3, so we don't double-count them.
  order.forEach(function(k){ var e=events[k];
    if(e._srcTxn||e.fromExpense) return;                 // mirror event → handled via its expense below
    if(!achievedNow(e)) return;                          // hasn't happened yet → belongs in Sắp tới, not Khoảnh khắc
    (e.memories||[]).forEach(function(m){
      memRecords.push({src:m.src||'',cls:m.src?'':(m.cls||'ph-park'),emoji:m.emoji||e.emoji,cap:m.caption||e.name,meta:m.caption?(e.emoji+' '+e.name):e.date,type:'event',ref:k,d:e.d,who:(m.who||e.who||'')});
    });
  });
  //   3. Every expense photo IS a memory — pull them from the ledger directly, shown as
  //      everyday moments grouped by their capture date (txPhotoDate → EXIF or txn_date).
  (window.txns||[]).forEach(function(t){
    if(!t.photos||!t.photos.length) return;
    if(t.future) return;                                  // a planned expense's photo is a preview, not a memory yet
    var d=(typeof txPhotoDate==='function')?txPhotoDate(t):null, ico=t.ico||'📸';
    t.photos.forEach(function(src){
      memRecords.push({src:src||'',cls:src?'':'ph-park',emoji:ico,cap:t.note||L('Khoản chi','Expense'),meta:fmt(t.amt),type:'expense',ref:t.id,d:d,who:(t.who||'')});
    });
  });
  memRecords.sort(function(a,b){ return (b.d?b.d.getTime():0)-(a.d?a.d.getTime():0); });
}
// Group photo memories by their source (event or expense). memRecords is newest-first,
// so the first record of each group is its cover and groups come out newest-cover-first.
function memGroups(){
  var order=[], by={};
  memRecords.forEach(function(r){
    if(!r.src) return;                                    // covers are photos only
    var rk=r.type+':'+r.ref;
    if(!by[rk]){ by[rk]={type:r.type,ref:r.ref,cover:r.src,title:r.cap,emoji:r.emoji,d:r.d,items:[]}; order.push(by[rk]); }
    by[rk].items.push(r);
  });
  return order;
}
// Home carousel tile: one cover per memory (event or expense) — title + date · count, no money.
function memCoverHTML(g){
  var idx=memRecords.indexOf(g.items[0]), c=g.items.length;
  var sub=(g.d?fmtDayMon(g.d):'')+' · '+c+' '+(isVi()?'ảnh':('photo'+(c!==1?'s':'')));
  return '<div class="memory" style="background-image:url('+g.cover+');background-size:cover;background-position:center" onclick="openMemory('+idx+')"><div class="scrim"></div><div class="m-cap">'+esc(g.title||L('Kỷ niệm','Memory'))+'</div><div class="m-date">'+esc(sub)+'</div></div>';
}
// Home photo feed item: full-size photo + title (no money), lazy-loaded.
function memFeedHTML(r){
  var idx=memRecords.indexOf(r);
  return '<div class="mem-feed-item" onclick="openMemory('+idx+')"><img src="'+escAttr(r.src)+'" alt="" loading="lazy" decoding="async"><div class="mff-cap"><div class="mff-t">'+esc(r.cap||L('Kỷ niệm','Memory'))+'</div><div class="mff-s">'+esc(fmtDateLong(r.d))+'</div></div></div>';
}
// Collage template chosen by photo count (Apple-style, dynamic).
function collageClasses(n){
  if(n<=1) return ['c-hero'];
  if(n===2) return ['c-half','c-half'];
  if(n===3) return ['c-big','c-sm','c-sm'];
  if(n===4) return ['c-half','c-half','c-half','c-half'];
  /* 5+: a full-width hero, then the remaining (n-1) split into rows that each fill
     ALL 6 columns, so the grid never has empty cells (the "holes"). A row of 3 →
     three span-2 squares (c-sm); a row of 2 → two span-3 landscapes (c-half2);
     both are span-2 rows tall, so rows pack with a uniform height. A "3+1" tail is
     rewritten to "2+2" so there's never a lonely cell. */
  var cls=['c-hero'], m=n-1, rows=[];
  while(m>4){ rows.push(3); m-=3; }            // leaves m in {2,3,4}
  if(m===2) rows.push(2);
  else if(m===3) rows.push(3);
  else if(m===4) rows.push(2,2);
  rows.forEach(function(k){
    if(k===3) cls.push('c-sm','c-sm','c-sm');  // 3 across (span 2 cols each)
    else      cls.push('c-half2','c-half2');   // 2 across (span 3 cols each)
  });
  return cls;
}
function pmTile(r,cls){
  var idx=memRecords.indexOf(r);
  var c='pm '+(cls||'c-sm');
  var style=r.src?'style="background-image:url('+r.src+')"':'';
  var inner=r.src?'':'<div class="subj">'+(r.emoji||'📸')+'</div>';
  return '<div class="'+(r.src?c:c+' '+(r.cls||'ph-park'))+'" '+style+' onclick="openMemory('+idx+')">'+inner+'</div>';
}
function mosaicHTML(items){
  if(items.length===1 && items[0].src){                    // a lone photo shows full-width at its natural aspect
    var r=items[0], idx=memRecords.indexOf(r);
    return '<div class="photo-mosaic-wrap"><div class="pm-single" onclick="openMemory('+idx+')"><img src="'+r.src+'" alt="" loading="lazy" decoding="async"></div></div>';
  }
  var cc=collageClasses(items.length);
  return '<div class="photo-mosaic-wrap"><div class="photo-mosaic">'+items.map(function(r,i){ return pmTile(r,cc[i]); }).join('')+'</div></div>';
}
function secHTML(titleHTML,count,mosaic){
  return '<div class="photo-sec"><div class="photo-sec-h"><div>'+titleHTML+'</div><div class="photo-sec-sub">'+count+' '+(isVi()?'ảnh':('photo'+(count!==1?'s':'')))+'</div></div>'+mosaic+'</div>';
}
/* ---------- reactions surfaced onto memories ----------
   A photographed expense IS a memory (buildMemRecords step 3), and that same expense
   already carries the family's reactions (t.reactions, keyed by _dbId in js-data).
   So the emotion left on the ledger row is surfaced back onto the photo here — as a
   passive cluster on the album block, and as a live react-list + bar in the memory
   detail. Reuses the RX plumbing from 62-reactions.js (RX, rxMessage, _rxFace,
   _rxMineOn, throwReaction). Only expense-backed memories have reactions; savings-goal
   event memories have none (reactions are transaction-scoped), so memTxFor returns null. */
function memTxFor(r){
  if(!r || typeof txById!=='function') return null;
  if(r.type==='expense') return txById(r.ref);
  if(r.type==='event'){ var e=events[r.ref]; if(e && e.fromExpense) return txById(e.fromExpense); }   // safety: a mirror event's source expense
  return null;
}
// Album block: a compact, non-interactive cluster over the photo — unique emojis +
// up to 3 reactor faces (+N) — so the family's take reads while scrolling Khoảnh Khắc.
function memRxClusterHTML(t){
  var rs=t && t.reactions; if(!rs || !rs.length) return '';
  var emos='', seen={};
  rs.forEach(function(r){ if(!seen[r.emoji]){ seen[r.emoji]=1; emos+='<span class="pm-rx-e">'+r.emoji+'</span>'; } });
  var faces='', sm={}, nExtra=0;
  rs.forEach(function(r){ if(!sm[r.memberId]){ sm[r.memberId]=1; if(Object.keys(sm).length<=3) faces+=_rxFace(r.memberId); else nExtra++; } });
  if(nExtra>0) faces+='<span class="rx-more">+'+nExtra+'</span>';
  return '<div class="pm-rx"><span class="pm-rx-es">'+emos+'</span><span class="pm-rx-faces">'+faces+'</span></div>';
}
// Timeline card: the family's reactions seated under the photos — ONE row per reaction,
// never grouped, because each member left their own emoji AND their own one-liner, and
// folding them into a single "+N" line misattributes the copy. Newest first, each row is
// the inline-chip language (.rx-chip: emoji + italic copy). Capped so a dense day-stack
// stays even; the tapped card opens the memory detail with the full, un-capped list. */
function memRxLineHTML(t){
  var rs=(t && t.reactions)?t.reactions.slice():[]; if(!rs.length) return '';
  rs.sort(function(a,b){ return a.at<b.at?1:a.at>b.at?-1:0; });   // newest first
  var MAX=3, shown=rs.slice(0,MAX), extra=rs.length-shown.length;
  var rows=shown.map(function(r){
    return '<div class="tl-rx-row"><span class="tl-rx-e">'+r.emoji+'</span><span class="tl-rx-msg">'+rxMessage(r,t)+'</span></div>';
  }).join('');
  if(extra>0) rows+='<div class="tl-rx-more">'+L('còn '+extra+' cảm xúc nữa','+'+extra+' more')+'</div>';
  return '<div class="tl-rx-list">'+rows+'</div>';
}
window.memRxLineHTML=memRxLineHTML;
// Memory detail: the family's takes (newest first) + a react bar you can throw from
// while looking at the photo. Mirrors _exdReactions (46/61) but scoped to the overlay.
function memReactionsHTML(t){
  var rs=(t.reactions||[]).slice();
  var h='<div class="mo-rx-h">'+L('Cả nhà nói gì','Reactions')+(rs.length?' <span class="mo-rx-c">'+rs.length+'</span>':'')+'</div>';
  if(rs.length){
    rs.sort(function(a,b){ return a.at<b.at?1:a.at>b.at?-1:0; });
    h+='<div class="mo-rx-list">'+rs.map(function(r){
      return '<div class="exd-rx"><span class="exd-rx-e">'+r.emoji+'</span><span class="exd-rx-msg">'+rxMessage(r,t)+'</span>'+_rxFace(r.memberId)+'</div>';
    }).join('')+'</div>';
  } else {
    h+='<div class="exd-rx-empty">'+L('Chưa có cảm xúc nào — thả một cái nào 👇','No reactions yet — leave one 👇')+'</div>';
  }
  if(t._dbId){
    var mine=_rxMineOn(t._dbId);
    h+='<div class="mo-rx-bar">'+RX.map(function(r){
      return '<button class="exd-rx-bk'+(mine===r.e?' on':'')+'" onclick="memReact(\''+r.e+'\')" aria-label="'+escAttr(L(r.vi,r.en))+'">'+r.e+'</button>';
    }).join('')+'</div>';
  }
  return h;
}
// Throw (or clear) a reaction on the memory currently open. throwReaction persists +
// re-renders every reaction surface, including this overlay (renderMemoryIfOpen).
function memReact(emoji){
  var t=memTxFor(curMemory);
  if(t && t._dbId && typeof throwReaction==='function') throwReaction(t._dbId, emoji);
}
window.memReact=memReact;
// Re-render the open memory overlay after a reaction (local throw or one arrived over realtime).
function renderMemoryIfOpen(){
  var o=document.getElementById('memory-overlay'); if(!o || !o.classList.contains('on')) return;
  if(curMemory) _renderMemoryDetail();
}
window.renderMemoryIfOpen=renderMemoryIfOpen;
// Re-render the Khoảnh Khắc album if it's the visible tab, so its reaction clusters stay live.
function renderMemoriesTabIfOpen(){
  var v=document.getElementById('v-events'); if(!v || !v.classList.contains('on')) return;
  if(typeof renderEvents==='function') renderEvents();          // refreshes both the timeline clusters and the album
  else if(typeof renderMemoriesTab==='function') renderMemoriesTab();
}
window.renderMemoriesTabIfOpen=renderMemoriesTabIfOpen;
// What an event actually cost, if anything was put toward it.
function evAmount(e){ var v=(e.saved>0?e.saved:(e.target||0)); return v>0?v:0; }
// A collage for one event, captioned on the photo (name + amount) — no sub-heading above it.
function evBlockHTML(items,k){
  var cap='', c=items.length, ct=c+' '+(isVi()?'ảnh':('photo'+(c!==1?'s':'')));
  if(k){                                                  // an event: title from the event record
    var e=events[k], amt=evAmount(e);
    var sub=(amt?fmt(amt)+' · ':'')+ct;
    cap='<div class="pm-cap"><div class="pm-cap-t">'+esc(e.emoji)+' '+esc(e.name)+'</div><div class="pm-cap-s">'+esc(sub)+'</div></div>';
  } else if(items[0] && items[0].type==='expense'){       // an expense: titled just like an event (emoji + note · amount · N photos)
    var r0=items[0], sub2=(r0.meta?r0.meta+' · ':'')+ct;
    cap='<div class="pm-cap"><div class="pm-cap-t">'+esc(r0.emoji||'📸')+' '+esc(r0.cap||L('Khoản chi','Expense'))+'</div><div class="pm-cap-s">'+esc(sub2)+'</div>'+memRxClusterHTML(memTxFor(r0))+'</div>';
  }
  return '<div class="pm-block">'+mosaicHTML(items)+cap+'</div>';
}
// Memories tab: one section per DATE (date is the only title), one captioned collage per event inside it.
function photoSectionsByDate(recs){
  var groups=[], by={};
  recs.forEach(function(r){
    var key=r.d?(r.d.getFullYear()+'-'+r.d.getMonth()+'-'+r.d.getDate()):'x';
    if(!by[key]){ by[key]={d:r.d,items:[],order:[],byRef:{},moments:[]}; groups.push(by[key]); }
    by[key].items.push(r);
    if(r.type==='event'||r.type==='expense'){             // both events and expenses get their own titled block
      var rk=r.type+':'+r.ref;
      if(!by[key].byRef[rk]){ by[key].byRef[rk]=[]; by[key].order.push(rk); }
      by[key].byRef[rk].push(r);
    } else by[key].moments.push(r);
  });
  return groups.map(function(g){
    var body=g.order.map(function(rk){ var items=g.byRef[rk]; return evBlockHTML(items, items[0].type==='event'?items[0].ref:null); }).join('');
    if(g.moments.length) body+=evBlockHTML(g.moments,null);
    return secHTML('<div class="photo-sec-title">'+fmtWeekdayDay(g.d)+'</div>', g.items.length, body);
  }).join('');
}
// Photos-by-date screen: group by EVENT (name links to the event) + an "Everyday moments" section.
function photoSectionsByEvent(recs){
  var order2=[], byRef={}, moments=[];
  recs.forEach(function(r){
    if(r.type==='event'||r.type==='expense'){
      var rk=r.type+':'+r.ref;
      if(!byRef[rk]){ byRef[rk]={type:r.type,ref:r.ref,items:[]}; order2.push(byRef[rk]); }
      byRef[rk].items.push(r);
    } else moments.push(r);
  });
  var html='';
  order2.forEach(function(g){
    var titleHTML;
    if(g.type==='event'){ var e=events[g.ref];
      titleHTML='<button class="photo-sec-title" onclick="openEvent(&#39;'+escAttr(g.ref)+'&#39;)">'+esc(e.emoji)+' '+esc(e.name)+' ›</button>';
    } else { var r0=g.items[0];                            // an expense — title links to the expense
      titleHTML='<button class="photo-sec-title" onclick="openExpenseDetail(&#39;'+escAttr(g.ref)+'&#39;)">'+esc(r0.emoji||'📸')+' '+esc(r0.cap||L('Khoản chi','Expense'))+' ›</button>';
    }
    html+=secHTML(titleHTML, g.items.length, mosaicHTML(g.items));
  });
  if(moments.length) html+=secHTML('<div class="photo-sec-title">'+L('Khoảnh khắc thường ngày','Everyday moments')+'</div>', moments.length, mosaicHTML(moments));
  return html;
}
function renderMemoriesTab(){
  var box=document.getElementById('mem-grid'); if(!box)return;
  buildMemRecords();
  if(mcalY===null) memCalInit();
  var monthRecs=memRecords.filter(function(r){ return r.d && r.d.getFullYear()===mcalY && r.d.getMonth()===mcalM; });
  // Album section title states the hero month (G3 scope) + a count.
  var at=document.getElementById('album-title');
  if(at) at.textContent = isVi()
    ? ('Ảnh ' + moFull(mcalM).toLowerCase() + (monthRecs.length ? ' · ' + monthRecs.length : ''))
    : ((MONF[mcalM]) + ' photos' + (monthRecs.length ? ' · ' + monthRecs.length : ''));
  if(!monthRecs.length){
    box.innerHTML='<div class="mem-empty"><div class="me-emoji">📸</div><div class="me-t">'+L('Chưa có ảnh trong '+moFull(mcalM).toLowerCase(),'No photos in '+MONF[mcalM])+'</div><p>'+(memRecords.length?L('Dùng lịch để xem tháng khác.','Use the calendar to browse another month.'):L('Thêm ảnh khi bạn ghi một khoản chi, hoặc vào một sự kiện.','Add a photo when you log an expense, or to a saved event.'))+'</p></div>';
    return;
  }
  box.innerHTML=photoSectionsByDate(monthRecs);
}
// Photos taken on one date, grouped by event — opened from the calendar.
function openPhotosForDate(y,m,d){
  mcalSel=null;                                     // a day with photos isn't an empty-day selection
  buildMemRecords();
  var recs=memRecords.filter(function(r){ return r.d && r.d.getFullYear()===y && r.d.getMonth()===m && r.d.getDate()===d; });
  if(!recs.length) return;
  setTxt('po-title', isVi()?(d+' '+moFull(m)+', '+y):(MONF[m]+' '+d+', '+y));
  document.getElementById('po-body').innerHTML=photoSectionsByEvent(recs);
  var sc=document.querySelector('#photos-overlay .mo-scroll'); if(sc)sc.scrollTop=0;
  document.getElementById('photos-overlay').classList.add('on');
}
function closePhotos(){ document.getElementById('photos-overlay').classList.remove('on'); }
var curMemory=null;
// The one rich memory view, opened by BOTH the timeline nodes and the Album: the whole
// item (all photos of the tapped occasion/expense) stacked full-width, tap-to-zoom, with a
// header and a single action that defers to the source record (event funding / expense).
function openMemory(i){
  var r=memRecords[i]; if(!r)return; curMemory=r;
  // Peek context so zoom + delete index the right gallery: an occasion is its own event; a
  // photo-expense borrows its mirror event, whose memories carry _txn so a delete hits
  // transaction_photos. Rendering the stack straight from events[curEvent].memories keeps
  // each tapped index aligned with what openPeek()/deleteMemoryPhoto() expect.
  if(r.type==='event'){ curEvent=r.ref; }
  else { var t=(typeof txById==='function')?txById(r.ref):null; curEvent=(t&&t.linkedEvent)||null; }
  _renderMemoryDetail();
  var sc=document.querySelector('#memory-overlay .mo-scroll'); if(sc)sc.scrollTop=0;
  document.getElementById('memory-overlay').classList.add('on');
}
// Renders the memory-overlay body from curMemory/curEvent. Re-called after a photo delete
// so the stack stays honest.
function _renderMemoryDetail(){
  var r=curMemory; if(!r)return;
  var ev=events[r.ref];
  var gal=(curEvent && events[curEvent] && events[curEvent].memories) ? events[curEvent].memories : null;
  var list=gal || memRecords.filter(function(m){ return m.type===r.type && m.ref===r.ref; });
  var titleName  = (r.type==='event' && ev) ? ev.name  : (r.cap||L('Kỷ niệm','Memory'));
  var titleEmoji = (r.type==='event' && ev) ? ev.emoji : r.emoji;
  var cnt=list.length;
  setTxt('mo-cap', (titleEmoji?titleEmoji+' ':'')+titleName);
  setTxt('mo-meta', fmtDateLong(r.d)+(cnt>1?' · '+cnt+' '+(isVi()?'ảnh':'photos'):''));
  document.getElementById('mo-photo').innerHTML=list.map(function(m,idx){
    var cls='mem-full'+(gal?' tap':'')+(m.src?'':' tile '+esc(m.cls||'ph-park'));
    var on=gal?' onclick="openPeek('+idx+')"':'';
    var inner=m.src
      ? '<img src="'+escAttr(m.src)+'" alt="'+escAttr(m.caption||m.cap||titleName||'')+'" decoding="async">'
      : '<div class="subj">'+esc(m.emoji||'📸')+'</div>';
    return '<div class="'+cls+'"'+on+'>'+inner+'</div>';
  }).join('');
  // Reactions block: the family's takes + a react bar, shown only for expense-backed
  // memories (the ones that carry reactions). Populated above the deep-link action.
  var rxBox=document.getElementById('mo-rx');
  if(rxBox){ var mtx=memTxFor(r); rxBox.innerHTML=mtx?memReactionsHTML(mtx):''; rxBox.style.display=mtx?'':'none'; }
  var act=document.getElementById('mo-action'), chev=' <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18l6-6-6-6"/></svg>';
  if(r.type==='event' && ev && ev.fromExpense){ act.innerHTML=L('Mở khoản chi','Open expense')+chev; act.setAttribute('onclick','closeMemory();openExpenseDetail(\''+ev.fromExpense+'\')'); }
  else if(r.type==='expense'){ act.innerHTML=L('Mở khoản chi','Open expense')+chev; act.setAttribute('onclick','closeMemory();openExpenseDetail(\''+r.ref+'\')'); }
  else { act.innerHTML=L('Mở sự kiện','Open event')+chev; act.setAttribute('onclick','closeMemory();openEvent(\''+r.ref+'\')'); }
}
function openMemoryByRef(type,ref){ for(var i=0;i<memRecords.length;i++){ if(memRecords[i].type===type&&memRecords[i].ref===ref){ openMemory(i); return; } } }
function closeMemory(){ document.getElementById('memory-overlay').classList.remove('on'); }
