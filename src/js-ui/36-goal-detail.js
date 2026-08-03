/* ---------- saving-goal detail — view first, act second ----------
   The read-first screen a tap on a goal row (or a goal request card) now lands
   on, mirroring the expense detail (61-expense-detail.js): the goal laid out
   large with its progress, a light meta list, the family's review takes when it's
   still a proposal — with Add funds (primary CTA), Edit, and Delete as the actions.

   It reuses the request/review plumbing from 64-requests.js (_entNorm, _entPending,
   _entAligned, _isMine, _reqStatusLine, _reqReactLabel, _reqName) and hands the
   money actions to fundGoal (35-goals.js) + the persisting fhEditGoal / fhDeleteGoal
   (70-goals-income-onboard-ui.js). All js-ui functions share the global scope. */
var _goalDetailId=null;
function _gldById(id){ return (window.goals||{})[id]||null; }
function _gldRow(label, val){
  return '<div class="exd-mrow"><span class="exd-ml">'+label+'</span><span class="exd-mv">'+val+'</span></div>';
}
/* name of the occasion a goal is linked to (occasion_id is a db id; demo events are
   keyed by name) — best-effort, falls back to a generic label. */
function _gldOccName(occId){
  var evs=window.events||{};
  for(var k in evs){ if(evs[k] && (evs[k]._dbId===occId || k===occId)) return evs[k].name; }
  return L('dịp liên kết','linked occasion');
}
/* the review block — the family's takes on a goal proposal, same vocabulary as the
   requests follow-view (48-requests.css classes). Only shown when there's a creator. */
function _gldReviewBlock(item){
  var rs=(item.reviews||[]).slice();
  var aligned=(typeof _entAligned==='function')&&_entAligned(item);
  var banner=aligned
    ? '<div class="rv-follow ok">✓ '+L('Đã được duyệt','Aligned — a family member is in')+'</div>'
    : '<div class="rv-follow wait">'+L('Đang chờ ít nhất 1 người trong nhà đồng ý','Waiting for one family member to agree')+'</div>';
  var list=rs.length
    ? '<div class="rv-revs" style="margin-top:8px">'+rs.sort(function(a,b){ return a.at<b.at?1:-1; }).map(function(r){
        return '<div class="rv-rev"><span class="rv-rev-e">'+r.emoji+'</span>'
          +'<span class="rv-rev-b"><span class="rv-rev-n">'+esc(_reqName(r.by)||r.byName||'')+'</span>'
          +'<span class="rv-rev-l">'+_reqReactLabel(r.emoji)+'</span></span></div>';
      }).join('')+'</div>'
    : '<div class="rv-empty">'+L('Chưa có ai phản hồi. Cả nhà sẽ được nhắc nhẹ nhé.','No responses yet — the family has been nudged.')+'</div>';
  return banner+list;
}
function renderGoalDetail(){
  var g=_gldById(_goalDetailId); if(!g){ closeGoalDetail(); return; }
  var body=document.getElementById('gld-body'); if(!body) return;
  var pct=g.target>0?Math.min(100,Math.round(g.saved/g.target*100)):0;
  var funded=(typeof achievedGoal==='function')?achievedGoal(g):(g.target>0&&g.saved>=g.target);
  var still=Math.max(0,g.target-g.saved);
  var item=(typeof _entNorm==='function')?_entNorm('goal',g,_goalDetailId):null;
  var pending=!!(item && typeof _entPending==='function' && _entPending(item));
  var mine=!!(item && typeof _isMine==='function' && _isMine(item));
  var incoming=pending && !mine;

  var html='<div class="exd-focal">'
    +'<div class="exd-ico" style="background:var(--brand-tint);color:var(--brand-ink)">'+esc(g.emoji||'🎯')+'</div>'
    +'<div class="exd-amt num">'+fmt(g.saved)+'</div>'
    +'<div class="exd-note">'+esc(g.name)+'</div>'
    +(funded?'<div class="exd-plan ok">✓ '+L('Đã đủ tiền','Fully funded')+'</div>'
            :'<div class="exd-plan">🎯 '+L('Đang để dành','Saving up')+'</div>')
    +'</div>';
  html+='<div class="gld-meter'+(funded?' done':'')+'"><i style="width:'+pct+'%"></i></div>';

  var dueTxt='';
  if(g.d){
    dueTxt=fmtDayMon(g.d);
    var dl=(typeof daysLeft==='function')?daysLeft(g.d):null;
    if(!funded && g.d<TODAY) dueTxt+=' · '+L('quá hạn','overdue');
    else if(dl===0) dueTxt+=' · '+L('đến hạn hôm nay','due today');
    else if(dl>0) dueTxt+=' · '+L('còn '+dl+' ngày',dl+' days to go');
  }
  html+='<div class="exd-meta">'
    + _gldRow(L('Mục tiêu','Target'), fmt(g.target))
    + _gldRow(L('Đã để dành','Saved'), fmt(g.saved)+' <span style="color:var(--muted);font-weight:500">('+pct+'%)</span>')
    + (still>0?_gldRow(L('Còn phải để dành','Still to save'), fmt(still)):'')
    + (dueTxt?_gldRow(L('Ngày','Date'), esc(dueTxt)):'')
    + (g.occasion_id?_gldRow(L('Dịp','Occasion'), '<span class="gld-occ">🔗 '+esc(_gldOccName(g.occasion_id))+'</span>'):'')
    +'</div>';

  if(item && item.creatorId){                                // a goal proposal → show its review state
    html+='<div class="exd-sec-h"><span class="t">'+L('Cả nhà cùng duyệt','Review')+'</span></div>'
      +'<div style="margin:0 16px">'+_gldReviewBlock(item)+'</div>';
  }

  html+='<div class="gld-edit"><button class="fh-s-line" onclick="goalDetailEdit()">'+L('Sửa mục tiêu','Edit goal')+'</button></div>';
  // Delete opens the persisting confirm sheet (fhDeleteGoal) — it names the funding
  // reversal and arms-then-confirms there, matching how events are deleted.
  html+='<button class="exd-del gld-del" id="gld-del" onclick="goalDetailDelete()">'+L('Xoá mục tiêu','Delete goal')+'</button>';
  body.innerHTML=html;

  var cta=document.getElementById('gld-cta');
  if(cta){
    if(incoming) cta.innerHTML='<button class="cta" onclick="goalDetailReview()">'+L('Duyệt','Review')+'</button>';
    else if(!funded) cta.innerHTML='<button class="cta" onclick="goalDetailFund()">'+L('Góp quỹ','Add funds')+'</button>';
    else cta.innerHTML='';
    cta.style.display=cta.innerHTML?'':'none';
  }
}
window.renderGoalDetail=renderGoalDetail;
function openGoalDetail(id){
  var g=_gldById(id); if(!g) return;
  _goalDetailId=id;
  renderGoalDetail();
  document.getElementById('goal-overlay').classList.add('on');
  var sc=document.querySelector('#goal-overlay .cd-scroll'); if(sc) sc.scrollTop=0;
}
window.openGoalDetail=openGoalDetail;
function closeGoalDetail(){
  var o=document.getElementById('goal-overlay'); if(o) o.classList.remove('on');
  _goalDetailId=null;
}
window.closeGoalDetail=closeGoalDetail;
/* re-render if the detail is on screen (after a fund, an edit, a review — local or
   over realtime); if its goal is gone (deleted/archived), back out cleanly. */
function renderGoalDetailIfOpen(){
  var o=document.getElementById('goal-overlay'); if(!o || !o.classList.contains('on')) return;
  if(!_gldById(_goalDetailId)){ closeGoalDetail(); return; }
  renderGoalDetail();
}
window.renderGoalDetailIfOpen=renderGoalDetailIfOpen;

function goalDetailEdit(){ if(_goalDetailId!=null && typeof window.fhEditGoal==='function') window.fhEditGoal(_goalDetailId); }
window.goalDetailEdit=goalDetailEdit;
function goalDetailFund(){ if(_goalDetailId!=null && typeof fundGoal==='function') fundGoal(_goalDetailId); }
window.goalDetailFund=goalDetailFund;
function goalDetailReview(){ if(_goalDetailId!=null && typeof openReview==='function') openReview('goal', _goalDetailId); }
window.goalDetailReview=goalDetailReview;
function goalDetailDelete(){ if(_goalDetailId!=null && typeof window.fhDeleteGoal==='function') window.fhDeleteGoal(_goalDetailId); }
window.goalDetailDelete=goalDetailDelete;