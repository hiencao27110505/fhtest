/* ---------- expense detail — view first, edit second ----------
   Every tap on a ledger row (txRow) now lands here instead of opening the editor
   straight away. It's a read-first screen anyone in the family can open: the
   expense laid out large, any photos, and the reactions left on it — with Update
   (opens the existing edit modal) and Delete (arm-then-confirm) as the CTAs.

   It reuses the reaction plumbing from 62-reactions.js (RX, rxMessage, _rxFace,
   _rxMineOn, throwReaction) and hands Delete to the persisting deleteExpense()
   path in 55/50 by seeding editingTx + delArmed before calling it. All functions
   share the js-ui global scope, so barewords cross files freely. */
var _expDetailId=null, _exdDelArmed=false, _exdDelT=null;

/* who paid → { name, initials, colour }. Prefers live membersMeta; falls back to
   the demo member palette (matches the token colours) so the signed-out preview
   still reads with the right person's colour. */
function _whoDisp(who){
  var raw=String(who||''), isShared=/^(both|shared)$/i.test(raw), key=isShared?'Shared':raw;
  var mm=(window.membersMeta&&membersMeta[key])||null;
  var demoCol={emma:'#6f3fc0',james:'#0e8478',mia:'#f0701a',leo:'#e03d86'}, lk=raw.toLowerCase();
  var col=mm?mm.col:(isShared?'#8f8a99':(demoCol[lk]||'#8a8494'));
  var ini=mm?mm.ini:((typeof inits==='function')?inits(key||'?'):(key.slice(0,2).toUpperCase()||'?'));
  var name=isShared?L('Chi tiêu chung','Shared'):(key||L('Ai đó','Someone'));
  return { name:name, ini:ini, col:col };
}
function _exdDate(t){
  if(t._d) return fmtDateLong(t._d);                       // LANG-gated: "Thứ Ba, 26 thg 7" / "Tuesday, July 26"
  if(t.date==='Today') return L('Hôm nay','Today');
  if(t.date==='Just now') return L('Vừa xong','Just now');
  return t.date||'';
}
function _exdMetaRow(label, val){
  return '<div class="exd-mrow"><span class="exd-ml">'+label+'</span><span class="exd-mv">'+val+'</span></div>';
}
function _exdSecH(title, count){
  return '<div class="exd-sec-h"><span class="t">'+title+'</span>'+(count?'<span class="c">'+count+'</span>':'')+'</div>';
}
/* the reactions block: the family's takes (newest first) + a react bar.
   The bar only appears on a persisted row (t._dbId) — reacting has nowhere to
   write otherwise, exactly like the ledger long-press picker. */
function _exdReactions(t){
  var rs=(t.reactions||[]).slice();
  var html=_exdSecH(L('Cả nhà nói gì','Reactions'), rs.length||'');
  if(rs.length){
    rs.sort(function(a,b){ return a.at<b.at?1:a.at>b.at?-1:0; });
    html+='<div class="exd-rx-list">'+rs.map(function(r){
      return '<div class="exd-rx"><span class="exd-rx-e">'+r.emoji+'</span>'
        +'<span class="exd-rx-msg">'+rxMessage(r,t)+'</span>'+_rxFace(r.memberId)+'</div>';
    }).join('')+'</div>';
  } else {
    html+='<div class="exd-rx-empty">'+L('Chưa có cảm xúc nào — thả một cái nào 👇','No reactions yet — leave one 👇')+'</div>';
  }
  if(t._dbId){
    var mine=_rxMineOn(t._dbId);
    html+='<div class="exd-rx-bar">'+RX.map(function(r){
      return '<button class="exd-rx-bk'+(mine===r.e?' on':'')+'" onclick="expDetailReact(\''+r.e+'\')" aria-label="'+escAttr(L(r.vi,r.en))+'">'+r.e+'</button>';
    }).join('')+'</div>';
  }
  return html;
}
function renderExpenseDetail(){
  var t=(typeof txById==='function')?txById(_expDetailId):null;
  if(!t){ closeExpenseDetail(); return; }
  var body=document.getElementById('exd-body'); if(!body) return;
  var s=catStyle[t.cat]||['🧾','#f2eef6','var(--cat-other)'], wd=_whoDisp(t.who);
  var html='<div class="exd-focal">'
    +'<div class="exd-ico" style="background:'+s[1]+';color:'+s[2]+'">'+t.ico+'</div>'
    +'<div class="exd-amt num">'+fmt(t.amt)+'</div>'
    +'<div class="exd-note">'+esc(t.note||L('Khoản chi','Expense'))+'</div>'
    +(t.future?('<div class="exd-plan">📅 '+L('Chi tiêu dự kiến','Planned')+'</div>'):'')
    +'</div>';
  html+='<div class="exd-meta">'
    + _exdMetaRow(L('Danh mục','Category'), '<span class="exd-catico">'+s[0]+'</span>'+esc(t.cat))
    + _exdMetaRow(L('Người trả','Paid by'), '<span class="exd-av" style="background:'+wd.col+'">'+esc(wd.ini)+'</span>'+esc(wd.name))
    + _exdMetaRow(L('Ngày','Date'), esc(_exdDate(t)))
    +'</div>';
  var ph=t.photos||(t.photo?[t.photo]:[]);
  if(ph.length){
    html+=_exdSecH(L('Ảnh','Photos'), ph.length)
      +'<div class="exd-photos">'+ph.map(function(src){ return '<div class="exd-photo" style="background-image:url('+src+')"></div>'; }).join('')+'</div>';
  }
  // A future expense is a proposal: show the family's REVIEW state (distinct from the
  // ledger reactions a realized expense carries). incoming = someone else's proposal →
  // Review is the only action; mine/planned → Update + Delete like a realized row.
  var isFuture=!!t.future;
  var item=(isFuture && typeof _entNorm==='function')?_entNorm('expense',t,t.id):null;
  var incoming=!!(item && typeof _entPending==='function' && _entPending(item) && typeof _isMine==='function' && !_isMine(item));
  if(isFuture){
    if(item && item.creatorId && typeof _gldReviewBlock==='function'){
      html+='<div class="exd-sec-h"><span class="t">'+L('Cả nhà cùng duyệt','Review')+'</span></div>'
        +'<div style="margin:0 16px">'+_gldReviewBlock(item)+'</div>';
    }
  } else {
    html+=_exdReactions(t);
  }
  // Delete lives at the foot of the scroll as low-prominence text (arm-then-confirm),
  // per the destructive-button rule — never a red button in the CTA bar. Someone else's
  // pending proposal isn't yours to delete, so hide it there (Review only).
  if(!incoming){
    html+='<button class="exd-del" id="exd-del" onclick="expDetailDelete()">'+L('Xoá khoản chi','Delete expense')+'</button>';
  }
  body.innerHTML=html;
  var cta=document.getElementById('exd-cta');
  if(cta){
    cta.innerHTML=incoming
      ? '<button class="cta" onclick="expDetailReview()">'+L('Duyệt','Review')+'</button>'                    // decide someone else's proposal
      : '<button class="cta" onclick="expDetailEdit()">'+L('Cập nhật','Update')+'</button>';                  // single bottom-anchored primary
  }
  _resetExdDel();
}
/* Review → the existing react-to-align picker (64-requests.js), opened over the detail. */
function expDetailReview(){ if(_expDetailId!=null && typeof openReview==='function') openReview('expense', _expDetailId); }
window.expDetailReview=expDetailReview;
window.renderExpenseDetail=renderExpenseDetail;
function openExpenseDetail(id){
  var t=(typeof txById==='function')?txById(id):null; if(!t) return;
  _expDetailId=id;
  renderExpenseDetail();
  document.getElementById('exp-overlay').classList.add('on');
  var sc=document.querySelector('#exp-overlay .cd-scroll'); if(sc) sc.scrollTop=0;
}
window.openExpenseDetail=openExpenseDetail;
function closeExpenseDetail(){
  _resetExdDel();
  var o=document.getElementById('exp-overlay'); if(o) o.classList.remove('on');
  _expDetailId=null;
}
window.closeExpenseDetail=closeExpenseDetail;
/* re-render if the detail is on screen (after an edit, a delete, or a reaction —
   local or arrived over realtime); if its expense is gone, back out cleanly. */
function renderExpenseDetailIfOpen(){
  var o=document.getElementById('exp-overlay'); if(!o || !o.classList.contains('on')) return;
  if(!txById(_expDetailId)){ closeExpenseDetail(); return; }
  renderExpenseDetail();
}
window.renderExpenseDetailIfOpen=renderExpenseDetailIfOpen;

/* Update → the existing edit modal, opened over the detail. On save/cancel it
   closes and the detail (still underneath) refreshes via renderExpenseDetailIfOpen. */
function expDetailEdit(){ if(_expDetailId!=null && typeof openEditExpense==='function') openEditExpense(_expDetailId); }
window.expDetailEdit=expDetailEdit;
function expDetailReact(emoji){
  var t=(typeof txById==='function')?txById(_expDetailId):null;
  if(t && t._dbId && typeof throwReaction==='function') throwReaction(t._dbId, emoji);   // throwReaction re-renders the detail via renderExpenseDetailIfOpen
}
window.expDetailReact=expDetailReact;

/* Delete — its own arm-then-confirm, then hands off to the persisting delete path
   (55/50 wrap deleteExpense by name and key off editingTx). Seeding delArmed=true
   lets that one call execute instead of re-arming the modal's hidden button. */
function _resetExdDel(){
  _exdDelArmed=false; clearTimeout(_exdDelT);
  var b=document.getElementById('exd-del'); if(b){ b.classList.remove('armed'); b.textContent=L('Xoá','Delete'); }
}
function expDetailDelete(){
  var b=document.getElementById('exd-del');
  if(!_exdDelArmed){
    _exdDelArmed=true; if(b){ b.classList.add('armed'); b.textContent=L('Chạm lần nữa để xoá','Tap again to delete'); }
    clearTimeout(_exdDelT); _exdDelT=setTimeout(_resetExdDel,3000); return;
  }
  _resetExdDel();
  if(_expDetailId==null){ closeExpenseDetail(); return; }
  editingTx=_expDetailId; delArmed=true;                  // hand off to the wrapped, persisting deleteExpense()
  if(typeof deleteExpense==='function') deleteExpense();
  closeExpenseDetail();
}
window.expDetailDelete=expDetailDelete;
