/* ---------- collaborative future-expense requests ----------
   A future expense is a *proposal*, not a done deal. It reserves nothing until at
   least one family member OTHER than its creator approves it with 🥰 — then it's set
   aside for real. Reviewing reuses the ledger's exact five reactions (😱🤨😂🥰😤):
   the reviewer expresses HOW they feel, the system reads WHETHER it's aligned. Only
   🥰 sets it aside; the other four keep it pending and pass the feeling back so it
   stays a conversation, never a hard reject.

   This is a DISTINCT feature from ledger reactions, even though it persists through
   the same reactions table (so it syncs across devices for free): a review is a
   reaction on a future-dated transaction, whose creator is t._memberId. Requests
   never appear in the Phòng khách feed, and decisions arrive with their OWN
   confetti + toast (reqCheckArrivals), separate from the reactions arrival.

   Identity resolves in both modes: live = DB member ids (window.DB); demo = names.
   futureAligned()/futurePending()/_futReviews() live in 10-nav-model.js. */

/* ---- identity (live: DB member ids · demo: names) ---- */
function _memName(id){ var db=window.DB; return (db && db.memberById && db.memberById[id] && db.memberById[id].name) || ''; }
function _memColor(idOrName){
  var db=window.DB;
  if(db && db.memberById && db.memberById[idOrName] && db.memberById[idOrName].color) return db.memberById[idOrName].color;
  var mems=(window.FAM&&FAM.members)||[]; for(var i=0;i<mems.length;i++){ if(mems[i].name===idOrName) return mems[i].color; }
  return '#8a8494';
}
function _futMeId(){ var db=window.DB; if(db && db.ownerMemberId) return db.ownerMemberId; return (typeof _meName==='function')?_meName():''; }
function _futCreatorId(t){ return (t && t._memberId) ? t._memberId : ((t && t.by) || null); }
function _futCreatorName(t){ if(!t) return ''; return _memName(_futCreatorId(t)) || t.by || t.who || ''; }
function _isMyReq(t){ var c=_futCreatorId(t); return c!=null && c===_futMeId(); }
function _reqName(name){ var f=(name||'').trim().split(/\s+/)[0]; return f || L('Người nhà','a family member'); }

/* ---- the review vocabulary — the ledger's exact five, re-voiced for a proposal.
   Only 🥰 aligns (sets it aside); the rest are feedback that keeps it pending. ---- */
function _reqReviewSet(){ return [
  { e:'🥰', vi:'Thương',   en:'Love it',  dvi:'Đồng ý — để dành luôn', den:'I’m in — set it aside' },
  { e:'😂', vi:'Vui ghê',  en:'Ha, love it', dvi:'Thích cái vụ này',   den:'Love the energy' },
  { e:'😱', vi:'Bất ngờ',  en:'Whoa',     dvi:'Hơi nhiều đấy',         den:'That’s a lot' },
  { e:'🤨', vi:'Nghĩ đã',  en:'Hmm',      dvi:'Bàn thêm chút nha',     den:'Let’s talk first' },
  { e:'😤', vi:'Chưa nên', en:'Not now',  dvi:'Chưa hợp lúc này',      den:'Not right now' }
];}
function _reqCfg(e){ var a=_reqReviewSet(); for(var i=0;i<a.length;i++){ if(a[i].e===e) return a[i]; } return a[0]; }
function _reqReactLabel(e){ var c=_reqCfg(e); return esc(L(c.vi,c.en)); }

/* ---- shared bits ---- */
function _reqAvOf(t,cls){ var nm=_futCreatorName(t), col=_memColor(_futCreatorId(t))||_memColor(nm);
  return '<span class="req-av'+(cls?' '+cls:'')+'" style="background:'+col+'">'+esc((typeof inits==='function')?inits(nm||'?'):'?')+'</span>'; }
function _reqChev(){ return '<svg class="req-chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18l6-6-6-6"/></svg>'; }
function _catLabel(c){ var s=(window.catStyle&&catStyle[c]); return (s?s[0]+' ':'')+(c||''); }
function _reqDate(t){ return t.date || ''; }
function _reqSafeAfter(t){
  var m=(typeof M==='function')?M():null; if(!m||!m.budget) return null;
  var safe=Math.max(0, m.budget - m.spent - monthReserved());
  return Math.max(0, safe - (t.amt||0));   // aligning would reserve t.amt
}
function _reqStatusLine(t){
  var rs=_futReviews(t);
  if(futureAligned(t)){
    var a=null; for(var i=0;i<rs.length;i++){ if(rs[i].emoji==='🥰'){ a=rs[i]; break; } }
    return '<span class="req-status ok">'+(a?a.emoji:'🥰')+' '+esc(_reqName(_memName(a&&a.by)|| (a&&a.byName)))+' '+L('đã đồng ý · đã để dành','is in · set aside')+'</span>';
  }
  if(rs.length){ var r=rs[rs.length-1];
    return '<span class="req-status hold">'+r.emoji+' '+esc(_reqName(_memName(r.by)||r.byName))+' '+L('vừa phản hồi','responded')+'</span>'; }
  return '<span class="req-status wait">'+L('Đang chờ cả nhà duyệt','Waiting for the family')+'</span>';
}

/* ---- request lists (a future expense == a request) ---- */
function _reqAll(){ return (window.txns||[]).filter(function(t){ return t.future; }); }
function reqIncoming(){ return _reqAll().filter(function(t){ return !_isMyReq(t) && futurePending(t); }); }
function reqMine(){ return _reqAll().filter(function(t){ return _isMyReq(t); }); }

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

/* ---- the card — one design everywhere (widget · hub · both lanes), matching the
   Phòng khách card language (avatar → body → chevron, neutral surface) ---- */
function _reqCard(t, incoming){
  if(incoming){
    var nm=_reqName(_futCreatorName(t));
    return '<button class="req-card" onclick="openReview(\''+t.id+'\')">'+_reqAvOf(t)
      +'<span class="req-cb"><span class="req-ct">'+esc(nm)+' '+L('muốn để dành','wants to set aside')+'</span>'
      +'<span class="req-cs">'+esc(t.note)+' · '+_catLabel(t.cat)+' · '+_reqDate(t)+'</span></span>'
      +'<span class="req-amt num">'+fmt(t.amt)+'</span>'+_reqChev()+'</button>';
  }
  // my own request → a read-only follow card (tap = follow the decisions, never decide)
  return '<button class="req-card" onclick="openReview(\''+t.id+'\')">'+_reqAvOf(t)
    +'<span class="req-cb"><span class="req-ct">'+esc(t.note)+' · '+fmt(t.amt)+'</span>'
    +_reqStatusLine(t)+'</span>'+_reqChev()+'</button>';
}

/* ---- widget (Home + Finance) — section header + card list, like the reactions strip ---- */
function requestsWidgetHTML(){
  _reqEnsureSeed();
  var inc=reqIncoming(); if(!inc.length) return '';
  var head=(typeof _sectionH==='function') ? _sectionH(L('Cần bạn duyệt','Waiting for your OK'), 'openRequests()', L('Xem tất cả','See all')) : '';
  return head+'<div class="req-list">'+inc.slice(0,3).map(function(t){ return _reqCard(t,true); }).join('')+'</div>';
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
function renderRequests(){
  _reqEnsureSeed();
  var box=document.getElementById('requests-body'); if(!box) return;
  var inc=reqIncoming(), mine=reqMine(), html='';
  html+='<div class="req-lane-h">'+L('Chờ bạn duyệt','Waiting for you')+' · '+inc.length+'</div>';
  html+= inc.length ? '<div class="req-list">'+inc.map(function(t){ return _reqCard(t,true); }).join('')+'</div>'
                    : '<div class="req-empty">'+L('Không có yêu cầu nào đang chờ bạn.','Nothing waiting on you.')+'</div>';
  html+='<div class="req-lane-h" style="margin-top:24px">'+L('Yêu cầu của bạn','Your requests')+' · '+mine.length+'</div>';
  html+= mine.length ? '<div class="req-list">'+mine.map(function(t){ return _reqCard(t,false); }).join('')+'</div>'
                     : '<div class="req-empty">'+L('Bạn chưa gửi yêu cầu nào.','You haven’t sent any yet.')+'</div>';
  box.innerHTML=html;
}
window.renderRequests=renderRequests;

/* ---- open a request: reviewers DECIDE, the requester only FOLLOWS ---- */
function openReview(id){
  var t=(typeof txById==='function')?txById(id):null; if(!t) return;
  window._reviewId=id;
  renderReview(id);
  var mine=_isMyReq(t), ttl=document.getElementById('rv-title'); if(ttl) ttl.textContent = mine ? L('Yêu cầu của bạn','Your request') : L('Xem lại','Review');
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
function _reqPlanHead(t){
  var safe=_reqSafeAfter(t), nm=_reqName(_futCreatorName(t));
  var impact = safe!=null ? '<div class="rv-impact">'+L('Còn ','Leaves ')+'<b>'+fmt(safe)+'</b> '+L('an toàn để tiêu sau khoản này','safe to spend after this')+'</div>' : '';
  return '<div class="rv-plan">'
    +'<div class="rv-top">'+_reqAvOf(t,'lg')
      +'<div class="rv-tb"><div class="rv-t">'+esc(nm)+' '+L('muốn để dành','wants to set aside')+'</div>'
      +'<div class="rv-s">'+L('cho một dự định sắp tới','for an upcoming plan')+'</div></div>'
      +'<div class="rv-amt num">'+fmt(t.amt)+'</div></div>'
    +'<div class="rv-note">'+(t.ico||'📅')+' '+esc(t.note)+' · '+_catLabel(t.cat)+' · '+_reqDate(t)+'</div>'
    +impact+'</div>';
}
function renderReview(id){
  var t=(typeof txById==='function')?txById(id):null; if(!t){ closeReview(); return; }
  var box=document.getElementById('review-body'); if(!box) return;
  var head=_reqPlanHead(t);

  if(_isMyReq(t)){   // ---- FOLLOW view: the requester watches, can't decide ----
    var rs=_futReviews(t);
    var banner = futureAligned(t)
      ? '<div class="rv-follow ok">✓ '+L('Đã được duyệt · đã để dành','Aligned · set aside')+'</div>'
      : '<div class="rv-follow wait">'+L('Đang chờ ít nhất 1 người trong nhà đồng ý','Waiting for one family member to agree')+'</div>';
    var list = rs.length
      ? '<div class="rv-revs">'+rs.slice().sort(function(a,b){ return (a.at<b.at)?1:-1; }).map(function(r){
          return '<div class="rv-rev"><span class="rv-rev-e">'+r.emoji+'</span>'
            +'<span class="rv-rev-b"><span class="rv-rev-n">'+esc(_reqName(_memName(r.by)||r.byName))+'</span>'
            +'<span class="rv-rev-l">'+_reqReactLabel(r.emoji)+'</span></span></div>';
        }).join('')+'</div>'
      : '<div class="rv-empty">'+L('Chưa có ai phản hồi. Cả nhà sẽ được nhắc nhẹ nhé.','No responses yet — the family has been nudged.')+'</div>';
    box.innerHTML=head+banner+'<div class="rv-prompt">'+L('Phản hồi từ cả nhà','From the family')+'</div>'+list;
    return;
  }

  // ---- DECIDE view: the ledger reactions as vertical rows ----
  var meId=_futMeId(), myPick=null;
  _futReviews(t).forEach(function(r){ if(r.by===meId) myPick=r.emoji; });
  var rows=_reqReviewSet().map(function(o){
    var yes=(o.e==='🥰'), on=(myPick===o.e);
    return '<button class="rv-opt'+(yes?' yes':'')+(on?' on':'')+'" onclick="submitReview(\''+t.id+'\',\''+o.e+'\')">'
      +'<span class="rv-e">'+o.e+'</span>'
      +'<span class="rv-ob"><span class="rv-on">'+esc(L(o.vi,o.en))+'</span><span class="rv-od">'+esc(L(o.dvi,o.den))+'</span></span>'
      +(yes ? '<span class="rv-tag">'+L('để dành','set aside')+'</span>' : '<svg class="rv-chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18l6-6-6-6"/></svg>')
      +'</button>';
  }).join('');
  box.innerHTML=head+'<div class="rv-prompt">'+L('Bạn thấy khoản này thế nào?','How do you feel about it?')+'</div><div class="rv-opts">'+rows+'</div>';
}
window.renderReview=renderReview;

/* throw a review reaction · 🥰 aligns (sets it aside), the rest stay pending.
   Persists through the reactions table (fhReact) so it syncs to every device. */
function submitReview(id, emoji){
  var t=(typeof txById==='function')?txById(id):null; if(!t){ closeReview(); return; }
  if(_isMyReq(t)){ closeReview(); return; }   // guard: a requester can never decide their own
  var me=_futMeId();
  var mine=(t.reviews||[]).filter(function(r){ return (r.by||'')!==me; });   // replace my prior take
  mine.push({ emoji:emoji, by:me, byName:_memName(me)||(typeof _meName==='function'?_meName():''), at:new Date().toISOString() });
  t.reviews=mine;                                                            // optimistic (hydrate re-derives from reactions)
  if(t._dbId && typeof window.fhReact==='function'){ try{ window.fhReact(t._dbId, emoji); }catch(e){} }
  var aligned=(emoji==='🥰');
  closeReview();
  try{ if(typeof renderTxns==='function') renderTxns(); }catch(e){}
  selMonth=curMonthKey();
  try{ if(typeof renderAll==='function') renderAll(); }catch(e){}
  try{ var ov=document.getElementById('requests-overlay'); if(ov && ov.classList.contains('on')) renderRequests(); }catch(e){}
  var nm=_reqName(_futCreatorName(t));
  if(aligned){
    if(typeof floatEmojis==='function') floatEmojis('🥰');
    toast(L('Đã đồng ý · để dành '+fmt(t.amt)+' cho '+nm, 'You’re in · '+fmt(t.amt)+' set aside for '+nm));
  } else {
    toast(L('Đã gửi cảm nhận cho '+nm, 'Sent your take to '+nm));
  }
}
window.submitReview=submitReview;

/* ---- arrival: a decision landed on MY request — its OWN confetti + toast,
   distinct from the ledger-reaction arrival. Watermark-gated, plays on hydrate. ---- */
function _reqSeen(){ try{ return localStorage.getItem('fh-req-seen')||''; }catch(e){ return ''; } }
function _reqSetSeen(v){ try{ if(v) localStorage.setItem('fh-req-seen', v); }catch(e){} }
function reqCheckArrivals(){
  var me=_futMeId(); if(!me || document.hidden) return;
  var got=[];
  _reqAll().forEach(function(t){
    if(!_isMyReq(t)) return;
    _futReviews(t).forEach(function(r){ if(r.by!==me && r.at) got.push({ t:t, r:r }); });
  });
  if(!got.length) return;
  var maxAt=got.reduce(function(m,e){ return e.r.at>m?e.r.at:m; }, '');
  var seen=_reqSeen();
  if(!seen){ _reqSetSeen(maxAt); return; }                 // seed the watermark, don't replay history
  var fresh=got.filter(function(e){ return e.r.at>seen; });
  if(!fresh.length) return;
  _reqSetSeen(maxAt);
  fresh.sort(function(a,b){ return (a.r.at<b.r.at)?1:-1; });
  var lead=fresh[0], nm=_reqName(_memName(lead.r.by)||lead.r.byName), aligned=(lead.r.emoji==='🥰');
  if(typeof floatEmojis==='function') floatEmojis(lead.r.emoji);
  if(typeof toast==='function'){
    if(aligned) toast(L(nm+' đã đồng ý · đã để dành '+fmt(lead.t.amt), nm+' is in · '+fmt(lead.t.amt)+' set aside'));
    else toast(L(nm+' vừa phản hồi khoản “'+lead.t.note+'”', nm+' responded to “'+lead.t.note+'”'));
  }
}
window.reqCheckArrivals=reqCheckArrivals;

/* run after every hydrate: refresh the mounts + hub, then play any just-arrived decision */
function reqAfterHydrate(){
  try{ renderReqMounts(); }catch(e){}
  try{ var ov=document.getElementById('requests-overlay'); if(ov && ov.classList.contains('on')) renderRequests(); }catch(e){}
  try{ reqCheckArrivals(); }catch(e){}
}
window.reqAfterHydrate=reqAfterHydrate;
