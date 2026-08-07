/* ---------- collaborative requests ----------
   A proposal — a future EXPENSE, a saving GOAL, or a future OCCASION — must be
   reviewed and aligned by at least one OTHER family member before it counts. One
   generalized surface: a "Waiting for your OK" widget (Home + Finance), a Requests
   hub (two lanes), and a review sheet. Reviewing reuses the ledger's five reactions
   (😱🤨😂🥰😤): the reviewer expresses HOW they feel, the system reads WHETHER it's
   aligned — only 🥰 (from someone other than the requester) aligns it.

   Persistence (migration 0024): created_by marks the REQUESTER on each entity
   (distinct from the payer); reviews live in request_reviews, keyed 'type:dbId',
   and sync across devices via realtime. A DISTINCT feature from ledger reactions.
   _entCreatorId / _entReviews / _entAlignedBy live in 10-nav-model.js. */

/* ---- identity ---- */
function _memName(id){ var db=window.DB; return (db && db.memberById && db.memberById[id] && db.memberById[id].name) || ''; }
function _memColor(idOrName){
  var db=window.DB;
  if(db && db.memberById && db.memberById[idOrName] && db.memberById[idOrName].color) return db.memberById[idOrName].color;
  var mems=(window.FAM&&FAM.members)||[]; for(var i=0;i<mems.length;i++){ if(mems[i].name===idOrName) return mems[i].color; }
  return '#8a8494';
}
function _futMeId(){ var db=window.DB; if(db && db.ownerMemberId) return db.ownerMemberId; return (typeof _meName==='function')?_meName():''; }
function _reqName(idOrName){ var nm=_memName(idOrName)||idOrName||''; var f=(''+nm).trim().split(/\s+/)[0]; return f || L('Người nhà','a family member'); }

/* ---- the review vocabulary — the ledger's exact five, re-voiced for a proposal.
   Uniform rows (no highlighted CTA); only 🥰 aligns, said in the sub-label. ---- */
function _reqReviewSet(){ return [
  { e:'🥰', vi:'Thương',   en:'Love it',  dvi:'Đồng ý — chốt luôn',    den:'I’m in — count me' },
  { e:'😂', vi:'Vui ghê',  en:'Ha, love it', dvi:'Thích cái vụ này',   den:'Love the energy' },
  { e:'😱', vi:'Bất ngờ',  en:'Whoa',     dvi:'Hơi bất ngờ đấy',       den:'That’s a surprise' },
  { e:'🤨', vi:'Nghĩ đã',  en:'Hmm',      dvi:'Bàn thêm chút nha',     den:'Let’s talk first' },
  { e:'😤', vi:'Chưa nên', en:'Not now',  dvi:'Chưa hợp lúc này',      den:'Not right now' }
];}
function _reqCfg(e){ var a=_reqReviewSet(); for(var i=0;i<a.length;i++){ if(a[i].e===e) return a[i]; } return a[0]; }
function _reqReactLabel(e){ var c=_reqCfg(e); return esc(L(c.vi,c.en)); }

/* ---- entity normalization (expense · goal · occasion) ---- */
function _entMeta(type){
  if(type==='goal')     return { icon:'🎯', verb:L('muốn lập mục tiêu','wants to start a goal'),  unit:L('mục tiêu','goal') };
  if(type==='occasion') return { icon:'🎈', verb:L('muốn thêm một dịp','wants to plan an occasion'), unit:L('dịp','occasion') };
  return { icon:'📅', verb:L('muốn để dành','wants to set aside'), unit:L('khoản chi','expense') };
}
function _reqObj(type, ref){
  if(type==='expense') return (typeof txById==='function')?txById(ref):null;
  if(type==='goal')     return (window.goals||{})[ref] || null;
  if(type==='occasion') return (window.events||{})[ref] || null;
  return null;
}
function _entNorm(type, obj, ref){
  var amount = type==='expense' ? obj.amt : obj.target;
  var title  = type==='expense' ? obj.note : obj.name;
  var icon   = type==='expense' ? (obj.ico||'📅') : (obj.emoji || _entMeta(type).icon);
  return { type:type, ref:ref, dbId:obj._dbId||null, key:type+':'+(obj._dbId||ref), obj:obj,
    title:title||_entMeta(type).unit, amount:amount||0, icon:icon, dateTxt:obj.date||'',
    creatorId:_entCreatorId(type,obj), reviews:_entReviews(type,obj._dbId,obj) };
}
function _entAligned(item){ var c=item.creatorId; return item.reviews.some(function(r){ return r.emoji==='🥰' && r.by!==c; }); }
function _entPending(item){ return !!(item.creatorId && !_entAligned(item)); }
function _isMine(item){ var c=item.creatorId; return c!=null && c===_futMeId(); }
function _creatorName(item){ return _memName(item.creatorId) || item.creatorId || ''; }
function _entAv(item,cls){ var col=_memColor(item.creatorId), nm=_creatorName(item);
  return '<span class="req-av'+(cls?' '+cls:'')+'" style="background:'+col+'">'+esc((typeof inits==='function')?inits(nm||'?'):'?')+'</span>'; }

/* ---- gather all proposals across the three types ---- */
function _reqItems(){
  _reqEnsureSeed();
  var out=[];
  (window.txns||[]).forEach(function(t){ if(t.future && _entCreatorId('expense',t)) out.push(_entNorm('expense',t,t.id)); });
  var goals=window.goals||{}, gord=window.goalOrder||[];
  gord.forEach(function(k){ var g=goals[k]; if(g && !g.achieved && _entCreatorId('goal',g)) out.push(_entNorm('goal',g,k)); });
  var evs=window.events||{}, eord=window.order||[];
  eord.forEach(function(k){ var e=evs[k];
    if(e && !e._srcTxn && !e.fromExpense && _entCreatorId('occasion',e) && e.d && e.d>TODAY && !(typeof achievedNow==='function'&&achievedNow(e)))
      out.push(_entNorm('occasion',e,k)); });
  return out;
}
function reqIncoming(){ var me=_futMeId(); return _reqItems().filter(function(i){ return i.creatorId!==me && _entPending(i); }); }
function reqMine(){ var me=_futMeId(); return _reqItems().filter(function(i){ return i.creatorId===me; }); }
// Everything still awaiting alignment — mine to follow + others' to review — so BOTH
// roles have one visible home for pending expenses, goals and occasions. Actionable
// (others') first, my own (follow-only) after.
function reqPendingAll(){
  var me=_futMeId();
  return _reqItems().filter(function(i){ return _entPending(i); })
    .sort(function(a,b){ return ((a.creatorId===me)?1:0) - ((b.creatorId===me)?1:0); });
}

/* demo seed (signed-out preview only): a couple of incoming expense requests.
   _wIsReal() alone isn't enough to tell "signed-out preview" apart from "signed-in
   user whose DB hasn't hydrated yet" — both read as false in the first render tick
   of a cold start. Seeding on that false positive mutates the real txns array with
   fake requests that briefly render as if genuine before the hydrate replaces the
   array. The fh-resume flag (localStorage, set once a family has ever been opened)
   is the actual "we expect a real session" signal, so gate on it too: a returning
   user never gets seeded, even mid-load; only a genuinely signed-out visitor does. */
function _reqEnsureSeed(){
  if(window._reqSeeded) return;
  if(typeof _wIsReal==='function' && _wIsReal()){ window._reqSeeded=true; return; }
  if(document.documentElement.classList.contains('fh-resume')) return;   // real session still loading — wait, don't seed
  if(!window.txns || typeof txSeq==='undefined'){ return; }
  window._reqSeeded=true;
  var dim=new Date(TODAY.getFullYear(),TODAY.getMonth()+1,0).getDate();
  function futD(add){ var day=Math.min(TODAY.getDate()+add,dim); var d=new Date(TODAY.getFullYear(),TODAY.getMonth(),day);
    if(d<=TODAY) d=new Date(TODAY.getFullYear(),TODAY.getMonth()+1,Math.min(5,add)); return d; }
  function mk(by,note,cat,amt,add){ var d=futD(add); var s=(window.catStyle&&catStyle[cat])||['📅'];
    return {id:'t'+(txSeq++),ico:s[0],cat:cat,note:note,date:MONA[d.getMonth()]+' '+d.getDate(),who:by,amt:amt,future:true,by:by,_reviews:[],month:curMonthKey(),_d:d}; }
  txns.unshift(mk('Mia',   L('Giày bóng đá','Football boots'),      'Others', 60, 9));
  txns.unshift(mk('James', L('Vé xem bóng cuối tuần','Weekend match tickets'), 'Fun', 80, 5));
}

/* ---- shared bits ---- */
function _reqChev(){ return '<svg class="req-chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18l6-6-6-6"/></svg>'; }
function _reqStatusLine(item){
  var rs=item.reviews, c=item.creatorId;
  if(_entAligned(item)){
    var a=null; for(var i=0;i<rs.length;i++){ if(rs[i].emoji==='🥰' && rs[i].by!==c){ a=rs[i]; break; } }
    return '<span class="req-status ok">'+(a?a.emoji:'🥰')+' '+esc(_reqName(a&&(a.by))||(a&&a.byName))+' '+L('đã đồng ý','is in')+'</span>';
  }
  if(rs.length){ var r=rs[rs.length-1];
    return '<span class="req-status hold">'+r.emoji+' '+esc(_reqName(r.by)||r.byName)+' '+L('vừa phản hồi','responded')+'</span>'; }
  return '<span class="req-status wait">'+L('Đang chờ cả nhà duyệt','Waiting for the family')+'</span>';
}
function _reqTypeChip(item){ var m=_entMeta(item.type); return item.icon+' '+(item.dateTxt||m.unit); }

/* A request card opens the entity's read-first DETAIL screen (not the review picker
   directly) — the detail surfaces the Review CTA when it's someone else's proposal,
   so every tap lands on a consistent detail first. */
function _reqOpenCall(item){
  var ref=esc(item.ref);
  if(item.type==='goal')     return 'openGoalDetail(\''+ref+'\')';
  if(item.type==='occasion') return 'openEvent(\''+ref+'\')';
  return 'openExpenseDetail(\''+ref+'\')';
}
/* ---- the card — one design across widget · hub · both lanes ---- */
function _reqCard(item, incoming){
  if(incoming){
    return '<button class="req-card" onclick="'+_reqOpenCall(item)+'">'+_entAv(item)
      +'<span class="req-cb"><span class="req-ct">'+esc(_reqName(item.creatorId))+' '+_entMeta(item.type).verb+'</span>'
      +'<span class="req-cs">'+esc(item.title)+' · '+_reqTypeChip(item)+'</span></span>'
      +'<span class="req-amt num">'+fmt(item.amount)+'</span>'+_reqChev()+'</button>';
  }
  return '<button class="req-card" onclick="'+_reqOpenCall(item)+'">'+_entAv(item)
    +'<span class="req-cb"><span class="req-ct">'+esc(item.title)+' · '+fmt(item.amount)+'</span>'
    +_reqStatusLine(item)+'</span>'+_reqChev()+'</button>';
}

/* ---- widget (Home + Finance) ---- */
function requestsWidgetHTML(){
  var items=reqPendingAll(); if(!items.length) return '';
  var me=_futMeId();
  var head=(typeof _sectionH==='function') ? _sectionH(L('Cả nhà cùng duyệt','Waiting for the family')+' · '+items.length, 'openRequests()', L('Xem tất cả','See all')) : '';
  // others' → review card; my own → follow card (title + status)
  return head+'<div class="req-list">'+items.slice(0,4).map(function(i){ return _reqCard(i, i.creatorId!==me); }).join('')+'</div>';
}
window.requestsWidgetHTML=requestsWidgetHTML;
function renderReqMounts(){ var el=document.getElementById('fin-requests'); if(el) el.innerHTML=requestsWidgetHTML(); }
window.renderReqMounts=renderReqMounts;

/* ---- the hub ---- */
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
  var box=document.getElementById('requests-body'); if(!box) return;
  var inc=reqIncoming(), mine=reqMine(), html='';
  html+='<div class="req-lane-h">'+L('Chờ bạn duyệt','Waiting for you')+' · '+inc.length+'</div>';
  html+= inc.length ? '<div class="req-list">'+inc.map(function(i){ return _reqCard(i,true); }).join('')+'</div>'
                    : '<div class="req-empty">'+L('Không có yêu cầu nào đang chờ bạn.','Nothing waiting on you.')+'</div>';
  html+='<div class="req-lane-h" style="margin-top:24px">'+L('Yêu cầu của bạn','Your requests')+' · '+mine.length+'</div>';
  html+= mine.length ? '<div class="req-list">'+mine.map(function(i){ return _reqCard(i,false); }).join('')+'</div>'
                     : '<div class="req-empty">'+L('Bạn chưa gửi yêu cầu nào.','You haven’t sent any yet.')+'</div>';
  box.innerHTML=html;
}
window.renderRequests=renderRequests;

/* ---- review (others DECIDE) / follow (requester WATCHES) ---- */
function openReview(type, ref){
  var obj=_reqObj(type, ref); if(!obj) return;
  window._reviewType=type; window._reviewRef=ref;
  renderReview(type, ref);
  var item=_entNorm(type,obj,ref), ttl=document.getElementById('rv-title');
  if(ttl) ttl.textContent = _isMine(item) ? L('Yêu cầu của bạn','Your request') : L('Xem lại','Review');
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
function _reqPlanHead(item){
  var nm=_reqName(item.creatorId);
  return '<div class="rv-plan">'
    +'<div class="rv-top">'+_entAv(item,'lg')
      +'<div class="rv-tb"><div class="rv-t">'+esc(nm)+' '+_entMeta(item.type).verb+'</div>'
      +'<div class="rv-s">'+esc(_entMeta(item.type).unit)+(item.dateTxt?(' · '+esc(item.dateTxt)):'')+'</div></div>'
      +'<div class="rv-amt num">'+fmt(item.amount)+'</div></div>'
    +'<div class="rv-note">'+item.icon+' '+esc(item.title)+'</div></div>';
}
function renderReview(type, ref){
  var obj=_reqObj(type, ref); if(!obj){ closeReview(); return; }
  var box=document.getElementById('review-body'); if(!box) return;
  var item=_entNorm(type,obj,ref), head=_reqPlanHead(item);

  if(_isMine(item)){   // FOLLOW view — read-only, the requester can't decide
    var rs=item.reviews;
    var banner = _entAligned(item)
      ? '<div class="rv-follow ok">✓ '+L('Đã được duyệt','Aligned — a family member is in')+'</div>'
      : '<div class="rv-follow wait">'+L('Đang chờ ít nhất 1 người trong nhà đồng ý','Waiting for one family member to agree')+'</div>';
    var list = rs.length
      ? '<div class="rv-revs">'+rs.slice().sort(function(a,b){ return (a.at<b.at)?1:-1; }).map(function(r){
          return '<div class="rv-rev"><span class="rv-rev-e">'+r.emoji+'</span>'
            +'<span class="rv-rev-b"><span class="rv-rev-n">'+esc(_reqName(r.by)||r.byName)+'</span>'
            +'<span class="rv-rev-l">'+_reqReactLabel(r.emoji)+'</span></span></div>';
        }).join('')+'</div>'
      : '<div class="rv-empty">'+L('Chưa có ai phản hồi. Cả nhà sẽ được nhắc nhẹ nhé.','No responses yet — the family has been nudged.')+'</div>';
    box.innerHTML=head+banner+'<div class="rv-prompt">'+L('Phản hồi từ cả nhà','From the family')+'</div>'+list;
    return;
  }

  // DECIDE view — the five reactions as uniform rows (no highlighted CTA)
  var meId=_futMeId(), myPick=null;
  item.reviews.forEach(function(r){ if(r.by===meId) myPick=r.emoji; });
  var rows=_reqReviewSet().map(function(o){
    var on=(myPick===o.e);
    return '<button class="rv-opt'+(on?' on':'')+'" onclick="submitReview(\''+item.type+'\',\''+esc(item.ref)+'\',\''+o.e+'\')">'
      +'<span class="rv-e">'+o.e+'</span>'
      +'<span class="rv-ob"><span class="rv-on">'+esc(L(o.vi,o.en))+'</span><span class="rv-od">'+esc(L(o.dvi,o.den))+'</span></span>'
      +'<svg class="rv-chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18l6-6-6-6"/></svg>'
      +'</button>';
  }).join('');
  box.innerHTML=head+'<div class="rv-prompt">'+L('Bạn thấy sao?','How do you feel about it?')+'</div><div class="rv-opts">'+rows+'</div>';
}
window.renderReview=renderReview;

/* throw a review · 🥰 (from a non-requester) aligns; the rest are feedback.
   Persists via request_reviews so it syncs to every device. */
function submitReview(type, ref, emoji){
  var obj=_reqObj(type, ref); if(!obj){ closeReview(); return; }
  var item=_entNorm(type,obj,ref);
  if(_isMine(item)){ closeReview(); return; }   // requester can never decide their own
  var me=_futMeId();
  obj._reviews=(_entReviews(type, obj._dbId, obj)||[]).filter(function(r){ return r.by!==me; }).map(function(r){ return {emoji:r.emoji,by:r.by,byName:r.byName,at:r.at}; });
  obj._reviews.push({ emoji:emoji, by:me, byName:_memName(me)||(typeof _meName==='function'?_meName():''), at:new Date().toISOString() });
  if(obj._dbId && typeof window.fhReviewEntity==='function'){ try{ window.fhReviewEntity(type, obj._dbId, emoji); }catch(e){} }
  /* push the decision to the REQUESTER only (their closed-app devices) — the
     in-app arrival moment for open apps stays with reqCheckArrivals */
  if(obj._dbId && item.creatorId && window.fhNotify){ try{ window.fhNotify('request_response', { emoji:emoji, target:item.creatorId, et:type, eid:obj._dbId }); }catch(e){} }
  var aligned=(emoji==='🥰');
  closeReview();
  try{ if(typeof renderTxns==='function') renderTxns(); }catch(e){}
  selMonth=curMonthKey();
  try{ if(typeof renderAll==='function') renderAll(); }catch(e){}
  try{ var ov=document.getElementById('requests-overlay'); if(ov && ov.classList.contains('on')) renderRequests(); }catch(e){}
  // the review was launched FROM a detail screen — refresh whichever is underneath so its CTA flips
  try{ if(typeof renderExpenseDetailIfOpen==='function') renderExpenseDetailIfOpen(); }catch(e){}
  try{ if(typeof renderGoalDetailIfOpen==='function') renderGoalDetailIfOpen(); }catch(e){}
  try{ var eo=document.getElementById('event-overlay'); if(eo && eo.classList.contains('on') && typeof openEvent==='function' && window.curEvent) openEvent(window.curEvent); }catch(e){}
  var nm=_reqName(item.creatorId);
  if(aligned){ if(typeof floatEmojis==='function') floatEmojis('🥰'); toast(L('Đã đồng ý với '+esc(nm)+' 🥰','You’re in with '+esc(nm)+' 🥰')); }
  else { toast(L('Đã gửi cảm nhận cho '+esc(nm), 'Sent your take to '+esc(nm))); }
}
window.submitReview=submitReview;

/* ---- realtime arrivals: a NEW request appears (notify reviewers) OR a decision
   lands on MY request (notify me) — each with confetti + toast, watermark-gated.
   Distinct from the ledger-reaction arrival. ---- */
function _ls(k,v){ try{ if(v===undefined) return localStorage.getItem(k); localStorage.setItem(k, v); }catch(e){ return null; } }
function reqCheckArrivals(){
  if(document.hidden) return;
  var me=_futMeId(); if(!me) return;

  // (A) new incoming requests → nudge the reviewer
  var inc=reqIncoming(), incKeys=inc.map(function(i){ return i.key; });
  var seenNew=_ls('fh-reqnew-seen');
  if(seenNew==null){ _ls('fh-reqnew-seen', incKeys.join('|')); }
  else {
    var seenArr=seenNew?seenNew.split('|'):[];
    var freshReqs=inc.filter(function(i){ return seenArr.indexOf(i.key)<0; });
    _ls('fh-reqnew-seen', incKeys.join('|'));
    if(freshReqs.length){
      var lr=freshReqs[0], nm=_reqName(lr.creatorId);
      if(typeof floatEmojis==='function') floatEmojis('🙌');
      if(typeof toast==='function') toast(L(nm+' có một yêu cầu cần bạn duyệt', nm+' has a request for you to review'));
    }
  }

  // (B) decisions on MY requests → tell me who's in
  var got=[];
  reqMine().forEach(function(i){ i.reviews.forEach(function(r){ if(r.by!==me && r.at) got.push({ i:i, r:r }); }); });
  var maxAt=got.reduce(function(m,e){ return e.r.at>m?e.r.at:m; }, '');
  var seenDec=_ls('fh-reqdec-seen');
  if(seenDec==null){ if(maxAt) _ls('fh-reqdec-seen', maxAt); return; }
  var fresh=got.filter(function(e){ return e.r.at>seenDec; });
  if(!fresh.length) return;
  if(maxAt) _ls('fh-reqdec-seen', maxAt);
  fresh.sort(function(a,b){ return (a.r.at<b.r.at)?1:-1; });
  var lead=fresh[0], who=_reqName(lead.r.by)||lead.r.byName, isYes=(lead.r.emoji==='🥰');
  if(typeof floatEmojis==='function') floatEmojis(lead.r.emoji);
  if(typeof toast==='function'){
    if(isYes) toast(L(esc(who)+' đã đồng ý với “'+esc(lead.i.title)+'” 🥰', esc(who)+' is in on “'+esc(lead.i.title)+'” 🥰'));
    else      toast(L(esc(who)+' vừa phản hồi “'+esc(lead.i.title)+'”', esc(who)+' responded to “'+esc(lead.i.title)+'”'));
  }
}
window.reqCheckArrivals=reqCheckArrivals;

function reqAfterHydrate(){
  try{ renderReqMounts(); }catch(e){}
  try{ var ov=document.getElementById('requests-overlay'); if(ov && ov.classList.contains('on')) renderRequests(); }catch(e){}
  try{ if(typeof renderExpenseDetailIfOpen==='function') renderExpenseDetailIfOpen(); }catch(e){}   // a review that arrived over realtime → refresh an open detail
  try{ reqCheckArrivals(); }catch(e){}
}
window.reqAfterHydrate=reqAfterHydrate;
