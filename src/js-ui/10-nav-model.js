/* Shared avatar rendering. Defined here in the classic js-ui layer so it is
   available at parse-time boot render (before the js-data module loads). A
   member with an encrypted photo (mm.av = the '.enc' public URL, decrypted in
   place by the photo observer) shows the photo; the initials stay as a genuine
   fallback and are hidden (color:transparent) ONLY once the photo actually
   paints — see _phSwapBg — so a locked device or a failed decrypt still shows
   initials, never a blank disc. Accepts a membersMeta entry ({col,av,ini}) or a
   FAM.members entry ({color,av}). */
window.fhAvStyle = function(mm){
  var c = (mm && (mm.col || mm.color)) || '#8f8a99';
  return (mm && mm.av)
    ? ('background:' + c + ';background-image:url(' + mm.av + ');background-size:cover;background-position:center')
    : ('background:' + c);
};
window.fhAvIni = function(mm){ return (mm && mm.ini) || ''; };

function go(name){
  document.querySelectorAll('.view').forEach(function(v){ v.classList.remove('on'); });
  document.getElementById('v-'+name).classList.add('on');
  document.querySelectorAll('.tab').forEach(function(t){ t.classList.remove('on'); });
  var t=document.getElementById('t-'+name); if(t)t.classList.add('on');
  document.getElementById('scroll').scrollTop=0;
  if(name==='home' && typeof renderHome==='function'){ try{ renderHome(); }catch(e){} }   // fresh home (milestone shows on open)
}
/* Khoảnh Khắc has three inner sections: Dự định (plans) · Kỷ niệm (memories) · Album gia đình (album). */
/* Khoảnh Khắc is one flat scroll now (like Tài Chính) — momSec glides to a section
   instead of toggling a hidden panel. Map each former segment to its anchor. */
function momSec(which){
  // A deep link to memories expands the (preview-limited) Đáng nhớ list first.
  if(which==='memories' && typeof memOpen!=='undefined' && !memOpen){ memOpen=true; if(typeof applyPastPreview==='function') applyPastPreview(); }
  // "plans" now lands on the plan trigger (the occasions section's action); memories on its header.
  var map={plans:'plan-trigger', memories:'past-head', album:'mem-grid'};
  var sc=document.getElementById('scroll'), el=document.getElementById(map[which]||'mcal-grid');
  if(el && el.offsetParent===null) el=document.getElementById('plan-trigger');   // target hidden → fall back to the always-visible trigger
  if(!sc||!el)return;
  var y=Math.max(0, el.getBoundingClientRect().top - sc.getBoundingClientRect().top + sc.scrollTop - 78);
  sc.scrollTo({top:y,behavior:'smooth'});
}
function goMoments(section){ go('events'); if(section) requestAnimationFrame(function(){ momSec(section); }); }
// Spending is one flat scroll now — "segTo" just glides to the right section.
function segTo(which){
  var map={overview:null,breakdown:'cat-budget-rows',activity:'tx-rows'};
  var sc=document.getElementById('scroll'); if(!sc)return;
  var id=map[which], el=id&&document.getElementById(id);
  var y=el?Math.max(0,el.getBoundingClientRect().top - sc.getBoundingClientRect().top + sc.scrollTop - 78):0;
  sc.scrollTo({top:y,behavior:'smooth'});
}

/* ---------- model ---------- */
var budget=9000;
var catBudget={};
var catOrder=[];
// Real current date — the app is live in production, so TODAY is always the
// actual device date, never clamped to a fixed demo month.
var TODAY=(function(){ var d=new Date(); d.setHours(0,0,0,0); return d; })();
// Month-abbreviation lookup (defined locally — this file loads before
// 12-format-helpers.js's MONA, and curMonthKey() must work at seed time below).
var _MOA=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
function curMonthKey(){ return _MOA[TODAY.getMonth()]; }
var months={};
months[curMonthKey()]={label:'',short:curMonthKey(),done:false,dim:new Date(TODAY.getFullYear(),TODAY.getMonth()+1,0).getDate(),dom:TODAY.getDate(),spent:0,budget:0,catSpent:{},memberSpent:{}};
var monthOrder=[curMonthKey()];
var selMonth=curMonthKey();
function M(){ return months[selMonth]; }
var membersMeta={};
var events={};
var order=[];
// A fully-funded event is "ready", not done — it becomes a memory only once its date passes.
function achievedNow(e){ return e.achieved===true || (e.d && e.d<TODAY); }
// Money set aside from THIS month's budget (unrealized — reserved, not spent):
// events funded from this month, plus standalone "future expenses" logged in the expense sheet.
function eventsReserved(){ return order.reduce(function(s,k){ return achievedNow(events[k]) ? s : s+(events[k].setAside||0); },0); }
// A future expense is a *proposal* until at least one family member other than its
// creator approves it with 🥰 — collaborative future expenses (see 64-requests.js).
// Reviews live on t.reviews when freshly created / in demo; once persisted they are
// reactions on the transaction (creator = t._memberId), so alignment syncs across
// devices for free. Only an *aligned* proposal reserves money from this month.
// Reviews for a proposable entity — a future expense, a saving goal, or a future
// occasion (collaborative requests, see 64-requests.js). Local optimistic reviews
// live on obj._reviews; persisted ones in window.DB.reviewsByEntity keyed 'type:dbId'
// (migration 0024). created_by is the REQUESTER (distinct from the payer), and is
// excluded from the alignment tally — only ANOTHER member's 🥰 aligns it.
function _entCreatorId(type, obj){ return obj ? (obj._createdBy || obj.by || obj._by || null) : null; }
function _entReviews(type, dbId, obj){
  if(obj && obj._reviews && obj._reviews.length) return obj._reviews;
  if(obj && obj.reviews && obj.reviews.length) return obj.reviews;          // legacy local field (expense)
  var db=window.DB;
  if(db && db.reviewsByEntity && dbId){
    return (db.reviewsByEntity[type+':'+dbId]||[]).map(function(r){
      return { emoji:r.emoji, by:r.memberId, byName:(db.memberById&&db.memberById[r.memberId])?db.memberById[r.memberId].name:'', at:r.at };
    });
  }
  return [];
}
function _entAlignedBy(type, obj){ var c=_entCreatorId(type,obj); return _entReviews(type, obj&&obj._dbId, obj).some(function(r){ return r.emoji==='🥰' && r.by!==c; }); }
// expense money-reserve: a proposal (has a creator) reserves only once aligned; a
// legacy future expense with no creator reserves exactly as before.
function futureAligned(t){ return _entAlignedBy('expense', t); }
function futurePending(t){ return !!(t && t.future && _entCreatorId('expense',t) && !futureAligned(t)); }
function futureExpReserved(){ return txns.reduce(function(s,t){ return s+((t.future && (_entCreatorId('expense',t) ? futureAligned(t) : true))?t.amt:0); },0); }
function monthReserved(){ return eventsReserved()+futureExpReserved(); }
/* ---- currency (USD $ · VND ₫, VND display ×1000 so amounts read realistically) ---- */
var CUR='USD';
function curMult(){ return CUR==='VND'?1000:1; }
function curSym(){ return CUR==='VND'?'₫':'$'; }
function fmt(n){
  var v=Math.round(n*curMult());
  return CUR==='VND' ? v.toLocaleString('vi-VN')+' ₫' : '$'+v.toLocaleString('en-US');
}
/* Compact form for charts. Symbol placement follows fmt(): VND suffixes, USD prefixes —
   both are labelled, so a VND chart is never left as bare unlabelled numbers. */
function fmtK(n){
  var v=n*curMult();
  if(CUR==='VND') return (v>=1000000 ? (v/1000000).toFixed(1).replace(/\.0$/,'')+'tr' : Math.round(v/1000)+'k')+' ₫';
  return n>=1000 ? '$'+(n/1000).toFixed(1).replace(/\.0$/,'')+'k' : '$'+Math.round(n);
}
/* VND is stored in units of 1,000đ, so sub-1,000 input can't be represented.
   parseAmtBase still rounds — but snapAmtInput() writes the rounded value back into
   the field on blur, so the user sees what will actually be saved instead of having
   it silently changed underneath them. */
function parseAmtBase(s){ return Math.round(parseAmt(s)/curMult()); }   // input is in display currency → store base
// base → the number an amount input should show (display currency, grouped, no symbol)
function amtToInput(n){ n=Number(n)||0; return n?(n*curMult()).toLocaleString(CUR==='VND'?'vi-VN':'en-US'):''; }
function snapAmtInput(el){
  if(!el) return;
  var raw=(el.value||'').trim(); if(!raw) return;
  var base=parseAmtBase(raw); if(!base){ el.value=''; return; }
  el.value=amtToInput(base);                       // canonical grouping + the real stored value
}
/* One placeholder source, so the separator always matches what the field produces
   (vi-VN uses dots, en-US commas — hardcoding either taught the wrong format). */
function amtPlaceholder(){ return CUR==='VND' ? (9000000).toLocaleString('vi-VN') : (9000).toLocaleString('en-US'); }
function renderTrend(){
  var box=document.getElementById('trend-chart'); if(!box)return;
  var maxV=Math.max.apply(null, monthOrder.map(function(k){return Math.max(months[k].spent,months[k].budget);}));
  var scale=maxV*1.14;
  var html='';
  monthOrder.forEach(function(k){
    var mo=months[k], pct=mo.spent/scale*100, budPct=mo.budget/scale*100;
    var over=mo.spent>mo.budget, cur=!mo.done, sel=(k===selMonth);
    html+='<div class="tr-col'+(sel?' sel':'')+'" onclick="selectMonth(\''+k+'\')">'
      +'<div class="tr-barwrap">'
        +'<div class="tr-val" style="bottom:'+pct+'%">'+fmtK(mo.spent)+'</div>'
        +'<div class="tr-bar'+(over?' over':'')+(cur?' cur':'')+'" style="height:'+pct+'%"></div>'
        +'<div class="tr-budget" style="bottom:'+budPct+'%"></div>'
      +'</div></div>';
  });
  box.innerHTML=html;
  document.getElementById('trend-labels').innerHTML=monthOrder.map(function(k){
    return '<div class="tr-m'+(k===selMonth?' sel':'')+'">'+(months[k]._iso?moAbbr(new Date(months[k]._iso+'T00:00:00').getMonth()):months[k].short.slice(0,3))+'</div>';
  }).join('');
}