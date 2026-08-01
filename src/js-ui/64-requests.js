/* ---------- collaborative future-expense requests ----------
   A future expense is a *proposal*, not a done deal. It reserves nothing until at
   least one family member OTHER than its creator throws 🥰 (the ledger's "approve"
   reaction) at it — then it's set aside for real. Reviewing reuses the exact five
   ledger reactions (😱🤨😂🥰😤): the reviewer expresses HOW they feel, the system
   reads WHETHER it's aligned. Only 🥰 sets it aside; the other four keep it pending
   and pass the feeling back to the creator so it stays a conversation, never a reject.

   Surfaces: a "Needs your OK" widget on Home + Finance (deep-links to one request
   or the hub), a Requests hub (two lanes), and a review sheet. Alignment persists +
   syncs for free when live via fhReact + the reactions table; the local review state
   drives the demo. futureAligned()/futurePending() live in 10-nav-model.js. */

function _reqMe(){ return (typeof _meName==='function') ? _meName() : ((window.FAM&&FAM.user&&FAM.user.name)||''); }
function _firstNm(n){ return (typeof firstName==='function') ? firstName(n||'') : ((n||'').split(/\s+/)[0]||n||''); }
function _reqMem(name){
  var mems=(window.FAM&&FAM.members)||[];
  for(var i=0;i<mems.length;i++){ if(mems[i].name===name) return {name:name,color:mems[i].color,ini:inits(name)}; }
  return {name:name||'?',color:'#8a8494',ini:(typeof inits==='function')?inits(name||'?'):'?'};
}
function _reqAv(name,cls){ var m=_reqMem(name); return '<span class="req-av'+(cls?' '+cls:'')+'" style="background:'+m.color+'">'+esc(m.ini)+'</span>'; }
function _reqChev(){ return '<svg class="req-chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18l6-6-6-6"/></svg>'; }
function _catLabel(c){ var s=(window.catStyle&&catStyle[c]); return (s?s[0]+' ':'')+(c||''); }
function _reqDate(t){ return t.date || ''; }

/* the review vocabulary — the ledger's exact five, re-voiced for a proposal.
   Only 🥰 aligns (sets it aside); the rest are feedback that keeps it pending. */
function _reqReviewSet(){ return [
  { e:'🥰', vi:'Thương',    en:'Love it',  dvi:'Đồng ý — để dành luôn', den:'I’m in — set it aside' },
  { e:'😂', vi:'Vui ghê',   en:'Ha, love it', dvi:'Thích cái vụ này',   den:'Love the energy' },
  { e:'😱', vi:'Bất ngờ',   en:'Whoa',     dvi:'Hơi nhiều đấy',         den:'That’s a lot' },
  { e:'🤨', vi:'Nghĩ đã',   en:'Hmm',      dvi:'Bàn thêm chút nha',     den:'Let’s talk first' },
  { e:'😤', vi:'Chưa nên',  en:'Not now',  dvi:'Chưa hợp lúc này',      den:'Not right now' }
];}
function _reqCfg(e){ var a=_reqReviewSet(); for(var i=0;i<a.length;i++){ if(a[i].e===e) return a[i]; } return a[0]; }

/* ---- request lists (a future expense == a request) ---- */
function _reqAll(){ return (window.txns||[]).filter(function(t){ return t.future; }); }
function reqIncoming(){ var me=_reqMe(); return _reqAll().filter(function(t){ return (t.by||'')!==me && !futureAligned(t); }); }
function reqMine(){ var me=_reqMe(); return _reqAll().filter(function(t){ return (t.by||'')===me; }); }
function _reqMyReaction(t){ var me=_reqMe(); var r=(t.reviews||[]).filter(function(x){ return (x.by||'')===me; })[0]; return r?r.emoji:null; }
function _alignedBy(t){
  var r=(t.reviews||[]).filter(function(x){ return x.emoji==='🥰'; })[0];
  var nm=r?_firstNm(r.byName||r.by):L('Ai đó','Someone');
  return '✓ '+esc(nm)+' '+L('đã đồng ý · đã để dành','is in · set aside');
}
function _reqSafeAfter(t){
  var m=(typeof M==='function')?M():null; if(!m||!m.budget) return null;
  var safe=Math.max(0, m.budget - m.spent - monthReserved());
  return Math.max(0, safe - (t.amt||0));   // aligning would reserve t.amt
}

/* demo seed: a couple of incoming requests so the loop is visible signed-out.
   Live mode gets its requests from real data, so it never seeds. Runs once. */
function _reqEnsureSeed(){
  if(window._reqSeeded) return;
  if(typeof _wIsReal==='function' && _wIsReal()){ window._reqSeeded=true; return; }   // live: real requests
  if(!window.txns || typeof txSeq==='undefined'){ return; }
  window._reqSeeded=true;
  var dim=new Date(TODAY.getFullYear(),TODAY.getMonth()+1,0).getDate();
  function futD(add){ var day=Math.min(TODAY.getDate()+add,dim); var d=new Date(TODAY.getFullYear(),TODAY.getMonth(),day);
    if(d<=TODAY) d=new Date(TODAY.getFullYear(),TODAY.getMonth()+1,Math.min(5,add)); return d; }
  function mk(by,note,cat,amt,add){ var d=futD(add); var s=(window.catStyle&&catStyle[cat])||['📅'];
    return {id:'t'+(txSeq++),ico:s[0],cat:cat,note:note,date:MONA[d.getMonth()]+' '+d.getDate(),who:by,amt:amt,future:true,by:by,reviews:[],month:curMonthKey(),_d:d}; }
  txns.unshift(mk('Mia',   L('Giày bóng đá','Football boots'),      'Others', 60, 9));
  txns.unshift(mk('James', L('Vé xem bóng cuối tuần','Weekend match tickets'), 'Fun', 80, 5));
}

/* ---- widget (Home + Finance) — only shows when something is waiting on me ---- */
function requestsWidgetHTML(){
  _reqEnsureSeed();
  var inc=reqIncoming(); if(!inc.length) return '';
  var rows=inc.slice(0,2).map(function(t){
    return '<button class="req-wrow" onclick="openReview(\''+t.id+'\')">'+_reqAv(t.by)
      +'<span class="req-wrb"><span class="req-wrt">'+esc(_firstNm(t.by))+' '+L('muốn để dành','wants to set aside')+'</span>'
      +'<span class="req-wrs">'+esc(t.note)+' · '+_catLabel(t.cat)+'</span></span>'
      +'<span class="req-wamt num">'+fmt(t.amt)+'</span>'+_reqChev()+'</button>';
  }).join('');
  var more=inc.length>2 ? '<button class="req-wmore" onclick="openRequests()">'+L('+ '+(inc.length-2)+' yêu cầu khác','+ '+(inc.length-2)+' more')+'</button>' : '';
  return '<div class="req-widget">'
    +'<div class="req-wh"><div class="req-wh-l"><span class="req-wh-t">'+L('Cần bạn duyệt','Needs your OK')+'</span><span class="req-badge">'+inc.length+'</span></div>'
    +'<a class="req-wh-all" onclick="openRequests()">'+L('Xem tất cả','View all')+'</a></div>'
    +'<div class="req-wrows">'+rows+more+'</div></div>';
}
window.requestsWidgetHTML=requestsWidgetHTML;
function renderReqMounts(){ var el=document.getElementById('fin-requests'); if(el) el.innerHTML=requestsWidgetHTML(); }
window.renderReqMounts=renderReqMounts;

/* ---- the hub — every request, two lanes ---- */
function openRequests(){
  renderRequests();
  var t=document.getElementById('req-title'); if(t) t.textContent=L('Yêu cầu','Requests');
  document.getElementById('requests-overlay').classList.add('on');
  var sc=document.querySelector('#requests-overlay .cd-scroll'); if(sc) sc.scrollTop=0;
}
window.openRequests=openRequests;
function closeRequests(){ document.getElementById('requests-overlay').classList.remove('on'); }
window.closeRequests=closeRequests;
function _reqCard(t, actionable){
  var av=_reqAv(t.by), amt=fmt(t.amt);
  if(actionable){
    return '<button class="req-card" onclick="openReview(\''+t.id+'\')">'+av
      +'<span class="req-cb"><span class="req-ct">'+esc(_firstNm(t.by))+' '+L('muốn để dành','wants to set aside')+'</span>'
      +'<span class="req-cs">'+esc(t.note)+' · '+_catLabel(t.cat)+' · '+_reqDate(t)+'</span></span>'
      +'<span class="req-camt num">'+amt+'</span>'+_reqChev()+'</button>';
  }
  var st = futureAligned(t)
    ? '<span class="req-status ok">'+_alignedBy(t)+'</span>'
    : '<span class="req-status wait">'+L('Đang chờ cả nhà đồng ý','Waiting for the family')+'</span>';
  return '<div class="req-card static">'+av
    +'<span class="req-cb"><span class="req-ct">'+esc(t.note)+'</span>'
    +'<span class="req-cs">'+_catLabel(t.cat)+' · '+_reqDate(t)+'</span>'+st+'</span>'
    +'<span class="req-camt num">'+amt+'</span></div>';
}
function renderRequests(){
  _reqEnsureSeed();
  var box=document.getElementById('requests-body'); if(!box) return;
  var inc=reqIncoming(), mine=reqMine(), html='';
  html+='<div class="req-lane-h">'+L('Chờ bạn duyệt','Waiting for you')+' · '+inc.length+'</div>';
  html+= inc.length ? inc.map(function(t){ return _reqCard(t,true); }).join('')
                    : '<div class="req-empty">'+L('Không có yêu cầu nào đang chờ bạn.','Nothing waiting on you.')+'</div>';
  html+='<div class="req-lane-h" style="margin-top:22px">'+L('Yêu cầu của bạn','Your requests')+' · '+mine.length+'</div>';
  html+= mine.length ? mine.map(function(t){ return _reqCard(t,false); }).join('')
                     : '<div class="req-empty">'+L('Bạn chưa gửi yêu cầu nào.','You haven’t sent any yet.')+'</div>';
  box.innerHTML=html;
}
window.renderRequests=renderRequests;

/* ---- review one request — the ledger reactions as vertical rows ---- */
function openReview(id){
  window._reviewId=id;
  renderReview(id);
  var t=document.getElementById('rv-title'); if(t) t.textContent=L('Xem lại','Review');
  document.getElementById('scrim').classList.add('on');
  var m=document.getElementById('review-modal'); m.style.transform=''; m.style.transition=''; m.classList.add('on');
  var b=m.querySelector('.modal-body'); if(b) b.scrollTop=0;
}
window.openReview=openReview;
function closeReview(){
  var m=document.getElementById('review-modal'); if(m){ m.classList.remove('on'); m.style.transform=''; m.style.transition=''; }
  var ov=document.getElementById('requests-overlay');
  if(!(ov && ov.classList.contains('on'))){ var s=document.getElementById('scrim'); if(s) s.classList.remove('on'); }
}
window.closeReview=closeReview;
function renderReview(id){
  var t=(typeof txById==='function')?txById(id):null; if(!t){ closeReview(); return; }
  var box=document.getElementById('review-body'); if(!box) return;
  var safe=_reqSafeAfter(t);
  var impact = safe!=null ? '<div class="rv-impact">'+L('Còn ','Leaves ')+'<b>'+fmt(safe)+'</b> '+L('an toàn để tiêu sau khoản này','safe to spend after this')+'</div>' : '';
  var head='<div class="rv-plan">'
    +'<div class="rv-top">'+_reqAv(t.by,'lg')
      +'<div class="rv-tb"><div class="rv-t">'+esc(_firstNm(t.by))+' '+L('muốn để dành','wants to set aside')+'</div>'
      +'<div class="rv-s">'+L('cho một dự định sắp tới','for an upcoming plan')+'</div></div>'
      +'<div class="rv-amt num">'+fmt(t.amt)+'</div></div>'
    +'<div class="rv-note">'+(t.ico||'📅')+' '+esc(t.note)+' · '+_catLabel(t.cat)+' · '+_reqDate(t)+'</div>'
    +impact+'</div>';
  var mine=_reqMyReaction(t);
  var rows=_reqReviewSet().map(function(o){
    var yes=(o.e==='🥰'), on=(mine===o.e);
    return '<button class="rv-opt'+(yes?' yes':'')+(on?' on':'')+'" onclick="submitReview(\''+t.id+'\',\''+o.e+'\')">'
      +'<span class="rv-e">'+o.e+'</span>'
      +'<span class="rv-ob"><span class="rv-on">'+esc(L(o.vi,o.en))+'</span><span class="rv-od">'+esc(L(o.dvi,o.den))+'</span></span>'
      +(yes ? '<span class="rv-tag">'+L('để dành','set aside')+'</span>' : '<svg class="rv-chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18l6-6-6-6"/></svg>')
      +'</button>';
  }).join('');
  box.innerHTML=head+'<div class="rv-prompt">'+L('Bạn thấy khoản này thế nào?','How do you feel about it?')+'</div><div class="rv-opts">'+rows+'</div>';
}
window.renderReview=renderReview;

/* throw a review reaction · 🥰 aligns (sets it aside), the rest stay pending */
function submitReview(id, emoji){
  var t=(typeof txById==='function')?txById(id):null; if(!t){ closeReview(); return; }
  var me=_reqMe();
  t.reviews=(t.reviews||[]).filter(function(r){ return (r.by||'')!==me; });   // replace my prior take
  t.reviews.push({ emoji:emoji, by:me, byName:me, at:new Date().toISOString() });
  if(t._dbId && typeof window.fhReact==='function'){ try{ window.fhReact(t._dbId, emoji); }catch(e){} }   // persist + sync when live
  var aligned=(emoji==='🥰');
  closeReview();
  try{ if(typeof renderTxns==='function') renderTxns(); }catch(e){}
  selMonth=curMonthKey();
  try{ if(typeof renderAll==='function') renderAll(); }catch(e){}
  try{ var ov=document.getElementById('requests-overlay'); if(ov && ov.classList.contains('on')) renderRequests(); }catch(e){}
  if(aligned){
    if(typeof floatEmojis==='function') floatEmojis('🥰');
    toast(L('Đã đồng ý · để dành '+fmt(t.amt)+' cho '+_firstNm(t.by), 'You’re in · '+fmt(t.amt)+' set aside for '+_firstNm(t.by)));
  } else {
    toast(L('Đã gửi cảm nhận cho '+_firstNm(t.by), 'Sent your take to '+_firstNm(t.by)));
  }
}
window.submitReview=submitReview;
