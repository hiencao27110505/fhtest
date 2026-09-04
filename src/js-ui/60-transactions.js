/* ---------- expense ---------- */
var catStyle={};
/* ---------- transactions (with spender avatar) ---------- */
// Seed transactions — per-category sums ARE the category totals (aggregates derived below).
var txns=[];
// Derive the current month's category + member totals from the transactions so everything reconciles.
(function(){
  var cs={}, ms={}, total=0;
  catOrder.forEach(function(c){ cs[c]=0; });
  txns.forEach(function(t){
    if(t.month!==curMonthKey() || t.future) return;
    cs[t.cat]=(cs[t.cat]||0)+t.amt; total+=t.amt;
    var w=(t.who||'').toLowerCase(), mk=(w==='both'||w==='shared')?'Shared':(w.charAt(0).toUpperCase()+w.slice(1));
    ms[mk]=(ms[mk]||0)+t.amt;
  });
  months[curMonthKey()].catSpent=cs; months[curMonthKey()].spent=total; months[curMonthKey()].memberSpent=ms;
})();
var txSeq=0;
txns.forEach(function(t){ t.id='t'+(txSeq++); });
function txById(id){ for(var i=0;i<txns.length;i++){ if(txns[i].id===id) return txns[i]; } return null; }
// Newest first everywhere. Sorts on the real date (_d, set at hydrate / on edit); a
// freshly-added local item has no _d yet, so it floats to the top until the next
// hydrate stamps its date. Replaces the old txDay() which sorted by day-of-month only
// (so "Jun 30" wrongly beat "Jul 5").
function txNewestFirst(a,b){ var ta=a._d?a._d.getTime():Infinity, tb=b._d?b._d.getTime():Infinity; return tb-ta; }
txns.sort(txNewestFirst);
var spMap={emma:['av-emma','EM'],james:['av-james','JR'],mia:['av-mia','MR'],leo:['av-leo','LR'],both:['av-shared','👥'],shared:['av-shared','👥']};
function spAv(who){ var a=spMap[(who||'').toLowerCase()]||['av-shared','👥']; return '<div class="r-sp av '+a[0]+'">'+a[1]+'</div>'; }

/* ── Expense-list scope ──────────────────────────────────────────────────────
   The full-screen list (#txn-overlay: search · sort · category hero · month
   groups) is shared between the family Finance tab and the personal tab. The
   render functions read their data through the accessors below instead of the
   family globals directly, so `window.__txnScope==='personal'` swaps the source
   without duplicating the screen. Family (the default) reads live globals exactly
   as before — nothing changes on that path. */
window.__txnScope='family';
var _pTxnCtx=null;                     // built on open from fhPersonalData()
function _txnPersonal(){ return window.__txnScope==='personal'; }
function _txList(){ return _txnPersonal() ? (_pTxnCtx?_pTxnCtx.rows:[]) : (window.txns||[]); }
function _txCatOrder(){ return _txnPersonal() ? (_pTxnCtx?_pTxnCtx.catOrder:[]) : (window.catOrder||[]); }
/* Normalise the personal ledger into the row shape txRow/renderTxnScreen expect.
   Unreadable rows are skipped here (their amount is null and would misstate every
   total); they stay visible with their lock note on the personal tab itself. */
function _pBuildTxnCtx(){
  var P = window.fhPersonalData ? fhPersonalData() : null;
  var PAL=['#f2eef6','#eef4fb','#eefaf3','#fdf4e8','#f6eefb','#eef9fb'];
  var rows=[], style={}, order=[], spent={}, other=L('Khác','Others');
  var now=new Date(), ym=now.getFullYear()+'-'+String(now.getMonth()+1).padStart(2,'0');
  (P&&P.txns||[]).forEach(function(t){
    if(t.kind!=='expense' || t._unreadable) return;
    var cat=t.cat||other, _d=t.date?new Date(t.date+'T00:00:00'):null;
    if(!style[cat]){ style[cat]=[t.emoji||'🗂️', PAL[order.length%PAL.length], 'var(--cat-other)']; order.push(cat); }
    // Only PRIVATE rows are editable here; mirror rows (spaceId/linkId set) are a
    // family expense shown in the personal book — write-inert, but tappable
    // since 0114 (fhMirrorRowTap → the family expense detail, M10).
    rows.push({ id:t.id, cat:cat, note:t.note||cat, amt:t.amt||0, _d:_d, ico:t.emoji||'🗂️', who:null, _style:style[cat], _edit:!t.spaceId&&!t.linkId, _mirror:!!(t.spaceId||t.linkId), photos:t.photos||undefined, time:t.time||null });
    if((t.date||'').slice(0,7)===ym) spent[cat]=(spent[cat]||0)+(t.amt||0);   // hero = this month only (parity with family M())
  });
  order.sort(function(a,b){ return (spent[b]||0)-(spent[a]||0); });
  _pTxnCtx={ rows:rows, catOrder:order, catStyle:style, catSpent:spent, catBudget:(P&&P.catBudget)||{} };
}
function txRow(t){
  // personal rows carry their own style + no member/reactions/detail screen;
  // family rows keep the avatar, reaction chip and tap-through to the detail.
  var personal=_txnPersonal();
  var s=t._style||catStyle[t.cat]||['🧾','#f2eef6','var(--cat-other)'];
  // Localize the display date/payer; the stored t.date/t.who strings stay as-is
  // (they are parsed by _txnIso / mapped by _memberIdForWho — display only here).
  var dstr=(t.date==='Just now')?L('Vừa xong','Just now'):((t._d?sameDay(t._d,TODAY):(t.date==='Today'))?L('Hôm nay','Today'):(t._d?(sameDay(t._d,new Date(TODAY.getTime()-86400000))?L('Hôm qua','Yesterday'):fmtDayMon(t._d)):t.date));
  // data-rxid (only persisted rows) arms the long-press reaction picker; rxChip appends any reactions inline
  var rxid=(!personal && t._dbId)?(' data-rxid="'+escAttr(t._dbId)+'"'):'';
  var chip=(!personal && typeof rxChip==='function')?rxChip(t):'';
  // C1 anatomy: a row with photos shows its first photo AS the tile (the enc
  // observer decrypts .enc backgrounds in place); category text moves under the
  // bold amount, so the subline holds only the date.
  var ph=(t.photos&&t.photos.length)?t.photos[0]:t.photo;
  var tile=ph?'<div class="r-ico ph" style="background-image:url('+escAttr(ph)+')"></div>'
            :'<div class="r-ico" style="background:'+s[1]+';color:'+s[2]+'">'+esc(t.ico)+'</div>';
  var av=personal?'':spAv(t.who);                                 // personal ledger has no members
  // Family rows open the detail screen; private personal rows open the edit sheet;
  // mirror personal rows (a family expense) are view-only but tap through to
  // the family expense detail (0114, M10).
  var open=personal?(t._edit?(' onclick="openPersonalTxEdit(\''+t.id+'\')"')
                            :(t._mirror?(' onclick="fhMirrorRowTap(\''+t.id+'\')"'):''))
                    :(' onclick="openExpenseDetail(\''+t.id+'\')"');
  var tapCls=(personal? ((t._edit||t._mirror)?' tap':'') : ' tap');
  return '<div class="row'+tapCls+(chip?' has-rx':'')+'"'+rxid+open+'><div class="r-ico-wrap">'+tile+av+'</div>'
    +'<div class="r-body"><div class="r-t">'+esc(t.note)+'</div><div class="r-s">'+dstr+(t.time?' · '+esc(t.time):'')+'</div></div>'
    +'<div class="r-right"><div class="r-amt num">'+fmt(t.amt)+'</div><div class="r-cat">'+esc(t.cat)+'</div></div>'+chip+'</div>';
}
var txFilter=null; // {type:'cat'|'mem', val:'Fun'|'Emma'}
function txMatch(t){
  if(!txFilter)return true;
  if(txFilter.type==='cat')return t.cat===txFilter.val;
  var w=(t.who||'').toLowerCase(), v=txFilter.val.toLowerCase();
  if(v==='shared'||v==='both')return w==='shared'||w==='both';
  return w===v;
}
/* ---- future rows: in-card, same anatomy as history (U6.1 / F8 / G1+G7) ----
   One timeline: future rows sit above today's inside the same card. The tense
   mark is the brand-colored amount; the due date sits under it where history
   rows show their category. The subline says who proposed the plan and where
   the review stands — the status word alone wears the state color (amber
   waiting, green settled). */
// Binary status, said with a wink: "sếp" is the reviewing family member —
// the vợ/chồng-là-sếp joke everyone already makes.
function _futSub(creatorId, pending){
  var st = pending ? '<span class="st-wait">'+L('chờ sếp duyệt','awaiting the boss')+'</span>'
                   : '<span class="st-ok">'+L('sếp duyệt rồi','boss said yes')+'</span>';
  var nm = (creatorId && typeof _reqName==='function') ? _reqName(creatorId) : '';
  return nm ? (esc(nm)+' '+L('đề xuất','proposed')+' · '+st) : st;
}
function _futDue(d){ return (d && sameDay(d,TODAY)) ? L('Hôm nay','Today') : (d ? fmtDayMon(d) : curMoName()); }
// Unrealized "set aside" row — money reserved from this month's budget toward an event.
function resRow(k){   // an event funded from this month → an "Events" future item
  var e=events[k];
  var ph=(e.memories&&e.memories.length&&e.memories[0].src)?e.memories[0].src:null;
  var tile=ph?'<div class="r-ico ph" style="background-image:url('+escAttr(ph)+')"></div>'
            :'<div class="r-ico res-ico">'+esc(e.emoji)+'</div>';
  var cid=(typeof _entCreatorId==='function')?_entCreatorId('occasion',e):null;
  var pend=false;
  if(cid && typeof _entNorm==='function' && typeof _entPending==='function'){ try{ pend=_entPending(_entNorm('occasion',e,k)); }catch(_x){} }
  return '<div class="row tap" onclick="openEvent(&#39;'+escAttr(k)+'&#39;)"><div class="r-ico-wrap">'+tile+'</div>'
    +'<div class="r-body"><div class="r-t">'+esc(e.name)+'</div><div class="r-s">'+_futSub(cid,pend)+'</div></div>'
    +'<div class="r-right"><div class="r-amt num plan">'+fmt(e.setAside)+'</div><div class="r-cat due">'+_futDue(e.d)+'</div></div></div>';
}
function futRow(t){   // a standalone future expense logged in the expense sheet
  var s=catStyle[t.cat]||['🧾','#f2eef6','var(--cat-other)'];
  var ph=(t.photos&&t.photos.length)?t.photos[0]:null;
  var tile=ph?'<div class="r-ico ph" style="background-image:url('+escAttr(ph)+')"></div>'
            :'<div class="r-ico" style="background:'+s[1]+';color:'+s[2]+'">'+esc(t.ico||'📅')+'</div>';
  var pend=(typeof futurePending==='function')&&futurePending(t);
  var cid=(typeof _entCreatorId==='function')?_entCreatorId('expense',t):null;
  // Every future row lands on the read-first expense detail, same as a past row;
  // the detail decides the CTA (Review for someone else's proposal, Update/Delete for mine).
  return '<div class="row tap" onclick="openExpenseDetail(\''+t.id+'\')"><div class="r-ico-wrap">'+tile+'</div>'
    +'<div class="r-body"><div class="r-t">'+esc(t.note)+'</div><div class="r-s">'+_futSub(cid,pend)+'</div></div>'
    +'<div class="r-right"><div class="r-amt num plan">'+fmt(t.amt)+'</div><div class="r-cat due">'+_futDue(txPhotoDate(t)||t._d)+'</div></div></div>';
}
function renderTxns(){
  var tx=document.getElementById('tx-rows');
  var evRes=(selMonth===curMonthKey()) ? order.filter(function(k){return !achievedNow(events[k]) && (events[k].setAside||0)>0;}) : [];
  var futT=txns.filter(function(t){return t.future;});
  var anyFuture = evRes.length>0 || futT.length>0;
  setTxt('tx-head', anyFuture ? L('Hoạt động','Activity') : L('Giao dịch gần đây','Recent transactions'));
  if(tx){
    var realAll=txns.filter(function(t){return !t.future;});
    var f=txFilter, out;
    if(f && f.type==='cat' && f.val==='Events') out=evRes.map(resRow).join('');      // Events future items
    else if(f && f.type==='cat' && f.val==='Future expenses') out=futT.map(futRow).join(''); // standalone future items
    else if(f) out=realAll.filter(txMatch).map(txRow).join('');                      // realized, filtered
    else{
      // One timeline in one card: future rows first (farthest due date at the
      // top, nearest just above today), then today's + yesterday's history —
      // the full history is the Giao dịch drill-in (openTxns / "See all").
      var futRows=[];
      evRes.forEach(function(k){ futRows.push({d:events[k].d, h:resRow(k)}); });
      futT.forEach(function(t){ futRows.push({d:txPhotoDate(t)||t._d, h:futRow(t)}); });
      futRows.sort(function(a,b){ return (b.d?b.d.getTime():0)-(a.d?a.d.getTime():0); });
      // A fresh local row has no _d yet ("Just now"), so it counts as today.
      var yd=new Date(TODAY.getTime()-86400000);
      out=futRows.map(function(r){return r.h;}).join('')
        +realAll.filter(function(t){ return !t._d || sameDay(t._d,TODAY) || sameDay(t._d,yd); }).map(txRow).join('');
    }
    // Three empty shapes: a filter that matched nothing → a plain note; a ledger
    // with history but nothing today/yesterday → a quiet pointer to See all; a
    // brand-new family with no ledger at all → a first-run prompt inviting the
    // first expense (mirrors the "Tạo mục tiêu đầu tiên" goal empty-state).
    var emptyHTML=txFilter
      ? '<div class="empty-note">'+L('Không có giao dịch phù hợp.','No transactions match this filter.')+'</div>'
      : (realAll.length
        ? '<div class="empty-note">'+L('Chưa có khoản chi nào hôm nay hay hôm qua. Bấm Xem tất cả để coi lại lịch sử.','Nothing logged today or yesterday. Tap See all for the full history.')+'</div>'
        : '<div class="mem-empty" style="margin:0 16px"><div class="me-emoji">🧾</div><div class="me-t">'+L('Ghi khoản chi đầu tiên','Log your first expense')+'</div><p>'+L('Thêm một khoản chi để cả nhà cùng nắm được tiền đang đi đâu.','Add an expense so the family can see where the money goes.')+'</p><button class="empty-cta" style="margin-top:18px" onclick="openExpense()">＋ '+L('Thêm khoản chi','Add expense')+'</button></div>');
    setHTMLIf(tx, out||emptyHTML);
  }
  var af=document.getElementById('act-filter');
  if(af){
    af.innerHTML=txFilter?('<div class="filter-chip">'+esc(txFilter.val)+'<button onclick="clearFilter()" aria-label="'+L('Xoá','Clear')+'">&times;</button></div>'):'';
  }
  var htx=document.getElementById('home-tx'); if(htx)setHTMLIf(htx, txns.filter(function(t){return !t.future;}).slice(0,3).map(txRow).join(''));
  if(typeof renderRxWall==='function') renderRxWall();   // keep the Phòng khách feed in sync with the ledger
}
function drillTo(type,val){ txFilter={type:type,val:val}; go('spending'); renderTxns(); segTo('activity'); }
function clearFilter(){ txFilter=null; renderTxns(); }
/* ---------- full transactions screen (drill-in: search · category · sort) ---------- */
var txnCat=null, txnSort='date';
function openTxns(scope){
  window.__txnScope=(scope==='personal')?'personal':'family';
  if(_txnPersonal()) _pBuildTxnCtx();                             // snapshot the personal ledger into row shape
  // Title + back-label track the scope (personal vs the family Finance tab).
  var titleEl=document.querySelector('#txn-overlay .txn-title'); if(titleEl) titleEl.textContent=_txnPersonal()?L('Chi tiêu cá nhân','Your spending'):L('Giao dịch','Transactions');
  var backEl=document.querySelector('#txn-overlay .cd-back span'); if(backEl) backEl.textContent=_txnPersonal()?L('Cá nhân','Personal'):L('Gia đình','Family');
  txnCat=null; txnSort='date';
  var q=document.getElementById('txn-q'); if(q)q.value='';
  setTxt('txn-sort-lab',L('Mới nhất','Newest')); var _cl=document.getElementById('txn-clear'); if(_cl)_cl.style.display='none';
  buildTxnChips(); renderTxnScreen();
  if(typeof renderFinanceHero==='function') renderFinanceHero();   // month's category breakdown at the top
  document.getElementById('txn-overlay').classList.add('on');
  var sc=document.getElementById('txn-scroll'); if(sc)sc.scrollTop=0;
}
// Reset scope on close: txRow is shared with the family activity list, so it must
// never be left in personal mode once the overlay is gone.
function closeTxns(){ document.getElementById('txn-overlay').classList.remove('on'); window.__txnScope='family'; _pTxnCtx=null; }
/* Re-pull the personal ledger into the open overlay after an edit/delete made
   from a row here. No-op unless the overlay is on AND in personal scope. */
function refreshPersonalTxnOverlay(){
  var o=document.getElementById('txn-overlay');
  if(!o || !o.classList.contains('on') || !_txnPersonal()) return;
  _pBuildTxnCtx();
  if(txnCat && (_pTxnCtx.catOrder||[]).indexOf(txnCat)<0) txnCat=null;   // filtered category may be gone
  buildTxnChips(); renderTxnScreen(); if(typeof renderFinanceHero==='function') renderFinanceHero();
}
function buildTxnChips(){
  var html='<button class="txn-chip'+(!txnCat?' on':'')+'" onclick="setTxnCat(null)">'+L('Tất cả','All')+'</button>';
  (_txCatOrder()||[]).forEach(function(c){
    html+='<button class="txn-chip'+(txnCat===c?' on':'')+'" onclick="setTxnCat(&#39;'+escAttr(c)+'&#39;)">'+esc(c)+'</button>';
  });
  setHTML('txn-chips', html);
}
function setTxnCat(c){ txnCat=c; buildTxnChips(); renderTxnScreen(); }
function toggleTxnSort(){ txnSort=(txnSort==='amount'?'date':'amount'); setTxt('txn-sort-lab', txnSort==='amount'?L('Số tiền','Amount'):L('Mới nhất','Newest')); renderTxnScreen(); }
function onTxnQ(){ var v=(document.getElementById('txn-q').value||''); var c=document.getElementById('txn-clear'); if(c)c.style.display=v?'grid':'none'; renderTxnScreen(); }
function txnClear(){ var q=document.getElementById('txn-q'); if(q){ q.value=''; q.focus(); } var c=document.getElementById('txn-clear'); if(c)c.style.display='none'; renderTxnScreen(); }
function renderTxnScreen(){
  var q=(document.getElementById('txn-q').value||'').trim().toLowerCase();
  var list=(_txList()||[]).filter(function(t){
    if(txnCat && t.cat!==txnCat) return false;
    if(q){ var hay=((t.note||'')+' '+(t.cat||'')+' '+(t.who||'')).toLowerCase(); if(hay.indexOf(q)<0) return false; }
    return true;
  });
  var ts=document.getElementById('txn-sum'); if(ts) ts.style.display='none';   // count + total removed — less detail
  var html='';
  if(!list.length){
    html='<div class="mem-empty" style="margin:22px 16px"><div class="me-emoji">🔍</div><div class="me-t">'+L('Không tìm thấy','No results')+'</div><p>'+L('Thử từ khoá khác hoặc đổi bộ lọc.','Try another keyword or change the filter.')+'</p></div>';
  } else if(txnSort==='amount'){
    html='<div class="rows">'+list.slice().sort(function(a,b){return b.amt-a.amt;}).map(txRow).join('')+'</div>';
  } else {
    var sorted=list.slice().sort(function(a,b){ var ta=a._d?a._d.getTime():0, tb=b._d?b._d.getTime():0; return tb-ta; });
    var groups=[], idx={};
    sorted.forEach(function(t){
      var d=t._d||TODAY, key=d.getFullYear()+'-'+d.getMonth();
      if(idx[key]===undefined){ idx[key]=groups.length; groups.push({label:(isVi()?('Tháng '+(d.getMonth()+1)):moAbbr(d.getMonth()))+' '+d.getFullYear(), rows:''}); }
      groups[idx[key]].rows+=txRow(t);
    });
    html=groups.map(function(g){ return '<div class="txn-mhead">'+g.label+'</div><div class="rows">'+g.rows+'</div>'; }).join('');
  }
  setHTML('txn-list', html);
}
function memMatch(who,member){ var w=(who||'').toLowerCase(), v=member.toLowerCase(); if(v==='shared'||v==='both')return w==='shared'||w==='both'; return w===v; }
// Push a focused, reusable detail screen. Optional `month` presets the month (contextual entry).
var curDetail=null;
function openCat(type,val,month){
  if(month && months[month] && month!==selMonth){ selMonth=month; renderAll(); renderTxns(); }
  curDetail={type:type,val:val};
  var m=M(), ico=document.getElementById('cd-ico');
  var moAb=m._iso?moAbbr(new Date(m._iso+'T00:00:00').getMonth()):m.short;
  setTxt('cd-monname', moAb);                              // month filter button
  ico.className='cd-fico';
  var rows='', lab='', num='', line='', lineCol='var(--muted)', listHead=L('Giao dịch','Transactions'), showBar=false, showFoot=false, fl='', fr='', count=0, unit=L('khoản','item');
  if(type==='mem'){
    var mt=membersMeta[val], v=(m.memberSpent[val]||0);
    var tot=Object.keys(m.memberSpent).reduce(function(a,k){return a+m.memberSpent[k];},0)||1;
    ico.style.cssText='border-radius:50%;background:'+mt.col; ico.textContent='';
    lab=L('Đã trả · ','Paid · ')+moAb; num=fmt(v); line=Math.round(v/tot*100)+L('% trong tổng chi của cả nhà','% of what the family paid');
    var mtx=txns.filter(function(t){return !t.future && t.month===selMonth && memMatch(t.who,val);}); count=mtx.length; rows=mtx.map(txRow).join('');
  } else if(val==='Events' || val==='Future expenses'){
    var isEv=(val==='Events');
    ico.style.cssText='background:var(--brand-tint);color:var(--brand-ink)'; ico.textContent=isEv?'🎯':'📅';
    lab=L('Để dành · ','Reserved · ')+moAb; num=fmt(isEv?eventsReserved():futureExpReserved()); lineCol='var(--brand-ink)';
    line=isEv?L('Dành cho các sự kiện sắp tới','Held for upcoming events'):L('Dành cho chi tiêu đã lên kế hoạch','Held for planned spending');
    var evks=isEv?order.filter(function(k){return !achievedNow(events[k])&&(events[k].setAside||0)>0;}):[], ftx=isEv?[]:txns.filter(function(t){return t.future;});
    count=isEv?evks.length:ftx.length; rows=isEv?evks.map(resRow).join(''):ftx.map(futRow).join('');
    listHead=isEv?L('Sự kiện sắp tới','Upcoming events'):L('Chi tiêu dự kiến','Planned expenses'); unit=isEv?L('sự kiện','event'):L('khoản','item');
  } else {
    var s=catStyle[val]||['🧾','#f2eef6','var(--cat-other)'], sp=m.catSpent[val]||0, bd=catBudget[val]||0, done=m.done, pace=done?1:m.dom/m.dim;
    ico.style.cssText='background:'+s[1]+';color:'+s[2]; ico.textContent=s[0];
    var overBud=sp>bd, overPace=!done&&bd&&(sp/bd)>(pace+0.14), under=bd&&(sp/bd)<pace-0.05;
    lab=L('Đã chi · ','Spent · ')+moAb; num=fmt(sp);
    line=overBud?L('Vượt ngân sách','Over budget'):(overPace?L('Đang tiêu nhanh hơn dự kiến','Running over pace'):(under?L('Thoải mái dưới mức','Comfortably under pace'):L('Đúng nhịp','On track')));
    lineCol=overBud?'var(--danger)':(overPace?'var(--amber)':(under?'var(--good)':'var(--muted)'));
    showBar=true; showFoot=true; fl='<b>'+fmt(sp)+'</b> '+L('trên','of')+' '+fmt(bd); fr=done?L('Đã chốt tháng','Month closed'):(m.dim-m.dom)+L(' ngày còn lại',' days left');
    var bar=document.getElementById('cd-bar'); bar.style.width=(bd?Math.min(100,sp/bd*100):0)+'%'; bar.style.background=overBud?'#F5694F':(overPace?'#FFB020':s[2]);
    document.getElementById('cd-mark').style.cssText=done?'display:none':('left:'+(pace*100)+'%');
    var ctx=txns.filter(function(t){return !t.future && t.month===selMonth && t.cat===val;}); count=ctx.length; rows=ctx.map(txRow).join('');
  }
  setTxt('cd-name',whoName(val)); setTxt('cd-lab',lab); setTxt('cd-num',num); setTxt('cd-listhead',listHead);
  setTxt('cd-count', count? (count+' '+unit+(isVi()?'':(count===1?'':'s'))) : '');
  setHTML('cd-line','<span style="color:'+lineCol+';font-weight:600">'+line+'</span>');
  document.getElementById('cd-barbox').style.display=showBar?'':'none';
  var ft=document.getElementById('cd-foot'); ft.style.display=showFoot?'':'none';
  if(showFoot){ setHTML('cd-foot-l',fl); setTxt('cd-foot-r',fr); }
  var empty = m.done ? L('Các tháng trước chỉ hiển thị tổng, không liệt kê từng giao dịch.','Earlier months show totals only. Individual transactions aren’t itemized.') : L('Chưa có giao dịch nào ở đây.','No transactions here yet.');
  document.getElementById('cd-rows').innerHTML=rows||'<div class="empty-note">'+empty+'</div>';
  var sc=document.querySelector('#cat-overlay .cd-scroll'); if(sc)sc.scrollTop=0;
  var realCat = type==='cat' && val!=='Events' && val!=='Future expenses' && !m.done;   // can log into a real, open-month category
  document.getElementById('cd-cta-bar').style.display = realCat ? '' : 'none';
  document.getElementById('cat-overlay').classList.add('on');
}
function logFromCat(){ if(curDetail && curDetail.type==='cat') openExpense({cat:curDetail.val, date:isoDate(TODAY)}); }
function openCatPicker(){ openSheet('sheet-catpick'); }
function buildCatPicker(){
  if(!curDetail)return; var t=curDetail.type, v=curDetail.val, html='';
  if(t==='mem'){
    setTxt('catpick-h',L('Ai đã trả','Who paid')); setTxt('catpick-sub',L('Xem chi tiêu của người khác.',"Jump to another person's spending."));
    Object.keys(M().memberSpent).forEach(function(k){ html+='<button class="choice'+(k===v?' on':'')+'" onclick="pickCatFilter(\'mem\',\''+k+'\')">'+whoName(k)+'</button>'; });
  } else {
    setTxt('catpick-h',L('Danh mục','Category')); setTxt('catpick-sub',L('Chuyển tới giao dịch của danh mục khác.',"Jump to another category's transactions."));
    catOrder.forEach(function(c){ html+='<button class="choice'+(c===v?' on':'')+'" onclick="pickCatFilter(\'cat\',\''+c+'\')">'+((catStyle[c]||[''])[0])+' '+c+'</button>'; });
    if(eventsReserved()>0) html+='<button class="choice'+(v==='Events'?' on':'')+'" onclick="pickCatFilter(\'cat\',\'Events\')">🎯 '+L('Sự kiện','Events')+'</button>';
    if(futureExpReserved()>0) html+='<button class="choice'+(v==='Future expenses'?' on':'')+'" onclick="pickCatFilter(\'cat\',\'Future expenses\')">📅 '+L('Sắp tới','Future')+'</button>';
  }
  setHTML('catpick-list',html);
}
function pickCatFilter(t,v){ closeSheet(); openCat(t,v); }
function closeCat(){ document.getElementById('cat-overlay').classList.remove('on'); }
function addExpense(){
  var amt=parseAmtBase(document.getElementById('ex-amt').value);
  if(!amt){ document.getElementById('ex-amt').focus(); return; }
  var note=document.getElementById('ex-note').value.trim()||L('Khoản chi','Expense');
  var cat=chosen('ex-cat')||'Fun'; lastCat=cat;
  var s=catStyle[cat]||['🧾','#f2eef6','var(--cat-other)'];
  var dObj=exDate(), dstr=(dObj.getTime()===TODAY.getTime())?'Today':(MONA[dObj.getMonth()]+' '+dObj.getDate());
  // Per-row time: in a bulk save, submitBulk loadRow(i)s each row into the fields
  // first, so #ex-time already holds this row's own time (or '' → day-only).
  var _time=(document.getElementById('ex-time')||{}).value||null;
  if(cat==='Event'){                                        // the "Event" category → a real event
    var eid='e'+order.length+Math.floor(amt);
    var past=dObj<TODAY;                                    // a past date = it already happened (realized), not upcoming
    var ev={name:note,emoji:'🎈',cov:'pink',date:(MONA[dObj.getMonth()]+' '+dObj.getDate()),d:dObj,target:amt,saved:amt,setAside:past?0:amt};
    if(past){ ev.achieved=true; months[curMonthKey()].spent+=amt; }   // spent already · goes straight to Memories
    if(exPhotos.length) ev.memories=exPhotos.map(function(s,i){ return i===0?{src:s,caption:note}:{src:s}; }); // photos become memories right away
    events[eid]=ev; order.unshift(eid); renderEvents(); renderTxns(); selMonth=curMonthKey(); renderAll();
    if(!BULK_SAVING){                                        // in a bulk loop, defer close/toast/nav to submitBulk()
      if(typeof clearDrafts==='function') clearDrafts();
      document.getElementById('ex-amt').value=''; document.getElementById('ex-note').value=''; exPhotos=[];
      closeExpense();
      if(past){ toast(L(esc(note)+' đã lưu · thêm ảnh để ghi nhớ nhé 📸',esc(note)+' saved · add a photo to remember it 📸')); floatEmojis('📸'); goMoments('memories'); }
      else { toast(L(esc(note)+' đã thêm vào Sự kiện · còn '+fmt(Math.max(0,months[curMonthKey()].budget-months[curMonthKey()].spent-monthReserved()))+' an toàn để tiêu',esc(note)+' added to Events · '+fmt(Math.max(0,months[curMonthKey()].budget-months[curMonthKey()].spent-monthReserved()))+' safe to spend')); floatEmojis('🎈'); goMoments('plans'); }
    }
    return;
  }
  if(dObj>TODAY){                                           // future date → a *proposal* (reserves nothing until the family aligns)
    var fwho=chosen('ex-who')||'Emma', fwhoStore=(fwho==='Both')?'Shared':fwho;
    var fby=(typeof _futMeId==='function')?_futMeId():((typeof _meName==='function')?_meName():fwhoStore);   // creator id (live) / name (demo)
    txns.unshift({id:'t'+(txSeq++),ico:s[0],cat:cat,note:note,date:dstr,_d:dObj,who:fwhoStore,amt:amt,time:_time,future:true,by:fby,reviews:[],month:curMonthKey(),photos:exPhotos.length?exPhotos.slice():undefined});
    renderTxns(); selMonth=curMonthKey(); renderAll();
    if(!BULK_SAVING){                                        // bulk loop → submitBulk() handles the tail
      if(typeof clearDrafts==='function') clearDrafts();
      document.getElementById('ex-amt').value=''; document.getElementById('ex-note').value=''; exPhotos=[];
      closeExpense();
      toast(L('Đã gửi cho cả nhà duyệt · sẽ để dành khi có người đồng ý','Sent to the family · set aside once someone agrees'));
      if(typeof openRequests==='function') openRequests(); else { go('spending'); segTo('overview'); }
    }
    return;
  }
  var who=chosen('ex-who')||'Emma'; lastWho=who;
  var mkey=who==='Both'?'Shared':who, whoStore=who==='Both'?'both':who;
  var hadPhoto=exPhotos.length>0;
  txns.unshift({id:'t'+(txSeq++),ico:s[0],cat:cat,note:note,date:dstr,_d:dObj,_ts:new Date(),who:whoStore,amt:amt,time:_time,month:curMonthKey(),photos:exPhotos.length?exPhotos.slice():undefined});
  if(hadPhoto) syncExpenseEvent(txns[0]);                   // photos → a linked event for Events + Memories
  renderTxns();
  var jul=months[curMonthKey()];
  var wasUnder=(jul.catSpent[cat]||0)<=(catBudget[cat]||Infinity);
  jul.spent+=amt; jul.catSpent[cat]=(jul.catSpent[cat]||0)+amt; jul.memberSpent[mkey]=(jul.memberSpent[mkey]||0)+amt;
  selMonth=curMonthKey(); renderAll(); if(hadPhoto) renderEvents();   // photo → shows in Memories
  if(!BULK_SAVING){                                          // bulk loop → submitBulk() fires one summary toast + nav
    if(typeof clearDrafts==='function') clearDrafts();
    document.getElementById('ex-amt').value=''; document.getElementById('ex-note').value=''; exPhotos=[];
    var catOv=document.getElementById('cat-overlay').classList.contains('on');
    closeExpense();
    if(hadPhoto){ toast(L('Đã ghi '+fmt(amt)+' · lưu vào Kỷ niệm 📸','Logged '+fmt(amt)+' · saved to Memories 📸')); floatEmojis('📸'); }
    else if(catBudget[cat] && wasUnder && jul.catSpent[cat]>catBudget[cat]) toast(L('Lưu ý: '+esc(cat)+' đã vượt ngân sách','Heads up: '+esc(cat)+' is now over budget'));
    else toast(L('Đã ghi '+fmt(amt)+' · còn '+fmt(Math.max(0,months[curMonthKey()].budget-jul.spent))+' an toàn để tiêu','Logged '+fmt(amt)+' · '+fmt(Math.max(0,months[curMonthKey()].budget-jul.spent))+' safe to spend'));
    if(catOv && curDetail){ openCat(curDetail.type,curDetail.val); }   // logged from a category detail → refresh it
    else { go('spending'); segTo('overview'); }
  }
}
