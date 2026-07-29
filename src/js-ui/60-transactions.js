/* ---------- expense ---------- */
var catStyle={};
/* ---------- transactions (with spender avatar) ---------- */
// July transactions — per-category sums ARE the category totals (aggregates derived below).
var txns=[];
// Derive July's category + member totals from the transactions so everything reconciles.
(function(){
  var cs={}, ms={}, total=0;
  catOrder.forEach(function(c){ cs[c]=0; });
  txns.forEach(function(t){
    if(t.month!=='Jul' || t.future) return;
    cs[t.cat]=(cs[t.cat]||0)+t.amt; total+=t.amt;
    var w=(t.who||'').toLowerCase(), mk=(w==='both'||w==='shared')?'Shared':(w.charAt(0).toUpperCase()+w.slice(1));
    ms[mk]=(ms[mk]||0)+t.amt;
  });
  months.Jul.catSpent=cs; months.Jul.spent=total; months.Jul.memberSpent=ms;
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
function txRow(t){
  var s=catStyle[t.cat]||['🧾','#f2eef6','var(--cat-other)'];
  // Localize the display date/payer; the stored t.date/t.who strings stay as-is
  // (they are parsed by _txnIso / mapped by _memberIdForWho — display only here).
  var dstr=(t.date==='Today')?L('Hôm nay','Today'):(t.date==='Just now')?L('Vừa xong','Just now'):(t._d?fmtDayMon(t._d):t.date);
  return '<div class="row tap" onclick="openEditExpense(\''+t.id+'\')"><div class="r-ico-wrap"><div class="r-ico" style="background:'+s[1]+';color:'+s[2]+'">'+t.ico+'</div>'+spAv(t.who)+'</div>'
    +'<div class="r-body"><div class="r-t">'+t.note+'</div><div class="r-s">'+dstr+' · '+t.cat+'</div></div>'
    +'<div class="r-amt num">'+fmt(t.amt)+'</div></div>';
}
var txFilter=null; // {type:'cat'|'mem', val:'Fun'|'Emma'}
function txMatch(t){
  if(!txFilter)return true;
  if(txFilter.type==='cat')return t.cat===txFilter.val;
  var w=(t.who||'').toLowerCase(), v=txFilter.val.toLowerCase();
  if(v==='shared'||v==='both')return w==='shared'||w==='both';
  return w===v;
}
// Unrealized "set aside" row — money reserved from this month's budget toward an event.
function resRow(k){   // an event funded from this month → an "Events" future item
  var e=events[k], today=sameDay(e.d,TODAY);
  return '<div class="row res" onclick="openEvent(&#39;'+escAttr(k)+'&#39;)"><div class="r-ico-wrap"><div class="r-ico">'+e.emoji+'</div></div>'
    +'<div class="r-body"><div class="r-t">'+e.name+'</div><div class="r-s"><span class="res-tag'+(today?' now':'')+'">'+(today?L('hôm nay','today'):L('sắp tới','future'))+'</span>'+L('Sự kiện','Events')+' · '+(today?L('hôm nay','today'):L('trong tháng 7','in July'))+'</div></div>'
    +'<div class="r-amt num">'+fmt(e.setAside)+'</div></div>';
}
function futRow(t){   // a standalone future expense logged in the expense sheet
  var today=sameDay(txPhotoDate(t),TODAY);
  return '<div class="row res" onclick="openEditExpense(\''+t.id+'\')"><div class="r-ico-wrap"><div class="r-ico">'+(t.ico||'📅')+'</div></div>'
    +'<div class="r-body"><div class="r-t">'+t.note+'</div><div class="r-s"><span class="res-tag'+(today?' now':'')+'">'+(today?L('hôm nay','today'):L('sắp tới','future'))+'</span>'+(today?L('Chi tiêu dự kiến · hôm nay','Planned expense · today'):L('Chi tiêu tương lai · trong tháng 7','Future expense · in July'))+'</div></div>'
    +'<div class="r-amt num">'+fmt(t.amt)+'</div></div>';
}
function renderTxns(){
  var tx=document.getElementById('tx-rows');
  var evRes=(selMonth==='Jul') ? order.filter(function(k){return !achievedNow(events[k]) && (events[k].setAside||0)>0;}) : [];
  var anyFuture = evRes.length>0 || txns.some(function(t){return t.future;});
  setTxt('tx-head', anyFuture ? L('Hoạt động','Activity') : L('Giao dịch gần đây','Recent transactions'));
  if(tx){
    var evHtml=evRes.map(resRow).join('');
    var futHtml=txns.filter(function(t){return t.future;}).map(futRow).join('');
    var realAll=txns.filter(function(t){return !t.future;});
    var f=txFilter, out;
    if(f && f.type==='cat' && f.val==='Events') out=evHtml;                          // Events future items
    else if(f && f.type==='cat' && f.val==='Future expenses') out=futHtml;           // standalone future items
    else if(f) out=realAll.filter(txMatch).map(txRow).join('');                      // realized, filtered
    else out=evHtml+futHtml+realAll.slice(0,8).map(txRow).join('');                  // preview — full list is the Giao dịch drill-in (openTxns)
    setHTMLIf(tx, out||'<div class="empty-note">'+L('Chưa có giao dịch nào ở đây.','No transactions here yet.')+'</div>');
  }
  var af=document.getElementById('act-filter');
  if(af){
    af.innerHTML=txFilter?('<div class="filter-chip">'+txFilter.val+'<button onclick="clearFilter()" aria-label="'+L('Xoá','Clear')+'">&times;</button></div>'):'';
  }
  var htx=document.getElementById('home-tx'); if(htx)setHTMLIf(htx, txns.filter(function(t){return !t.future;}).slice(0,3).map(txRow).join(''));
}
function drillTo(type,val){ txFilter={type:type,val:val}; go('spending'); renderTxns(); segTo('activity'); }
function clearFilter(){ txFilter=null; renderTxns(); }
/* ---------- full transactions screen (drill-in: search · category · sort) ---------- */
var txnCat=null, txnSort='date';
function openTxns(){
  txnCat=null; txnSort='date';
  var q=document.getElementById('txn-q'); if(q)q.value='';
  setTxt('txn-sort-lab',L('Mới nhất','Newest')); var _cl=document.getElementById('txn-clear'); if(_cl)_cl.style.display='none';
  buildTxnChips(); renderTxnScreen();
  document.getElementById('txn-overlay').classList.add('on');
  var sc=document.getElementById('txn-scroll'); if(sc)sc.scrollTop=0;
}
function closeTxns(){ document.getElementById('txn-overlay').classList.remove('on'); }
function buildTxnChips(){
  var html='<button class="txn-chip'+(!txnCat?' on':'')+'" onclick="setTxnCat(null)">'+L('Tất cả','All')+'</button>';
  (window.catOrder||[]).forEach(function(c){
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
  var list=(window.txns||[]).filter(function(t){
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
  setTxt('cd-name',val); setTxt('cd-lab',lab); setTxt('cd-num',num); setTxt('cd-listhead',listHead);
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
    Object.keys(M().memberSpent).forEach(function(k){ html+='<button class="choice'+(k===v?' on':'')+'" onclick="pickCatFilter(\'mem\',\''+k+'\')">'+k+'</button>'; });
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
  if(cat==='Event'){                                        // the "Event" category → a real event
    var eid='e'+order.length+Math.floor(amt);
    var past=dObj<TODAY;                                    // a past date = it already happened (realized), not upcoming
    var ev={name:note,emoji:'🎈',cov:'pink',date:(MONA[dObj.getMonth()]+' '+dObj.getDate()),d:dObj,target:amt,saved:amt,setAside:past?0:amt};
    if(past){ ev.achieved=true; months.Jul.spent+=amt; }   // spent already · goes straight to Memories
    if(exPhotos.length) ev.memories=exPhotos.map(function(s,i){ return i===0?{src:s,caption:note}:{src:s}; }); // photos become memories right away
    events[eid]=ev; order.unshift(eid); renderEvents(); renderTxns(); selMonth='Jul'; renderAll();
    document.getElementById('ex-amt').value=''; document.getElementById('ex-note').value=''; exPhotos=[];
    closeExpense();
    if(past){ toast(L(note+' đã lưu · thêm ảnh để ghi nhớ nhé 📸',note+' saved · add a photo to remember it 📸')); floatEmojis('📸'); goMoments('memories'); }
    else { toast(L(note+' đã thêm vào Sự kiện · còn '+fmt(Math.max(0,months.Jul.budget-months.Jul.spent-monthReserved()))+' an toàn để tiêu',note+' added to Events · '+fmt(Math.max(0,months.Jul.budget-months.Jul.spent-monthReserved()))+' safe to spend')); floatEmojis('🎈'); goMoments('plans'); }
    return;
  }
  if(dObj>TODAY){                                           // future date → a future expense (reserved, not spent)
    var fwho=chosen('ex-who')||'Emma', fwhoStore=(fwho==='Both')?'Shared':fwho;
    txns.unshift({id:'t'+(txSeq++),ico:s[0],cat:cat,note:note,date:dstr,who:fwhoStore,amt:amt,future:true,month:'Jul',photos:exPhotos.length?exPhotos.slice():undefined});
    renderTxns(); selMonth='Jul'; renderAll();
    document.getElementById('ex-amt').value=''; document.getElementById('ex-note').value=''; exPhotos=[];
    closeExpense();
    toast(L('Đã để dành '+fmt(amt)+' · còn '+fmt(Math.max(0,months.Jul.budget-months.Jul.spent-monthReserved()))+' an toàn để tiêu',fmt(amt)+' set aside · '+fmt(Math.max(0,months.Jul.budget-months.Jul.spent-monthReserved()))+' safe to spend'));
    go('spending'); segTo('overview'); return;
  }
  var who=chosen('ex-who')||'Emma'; lastWho=who;
  var mkey=who==='Both'?'Shared':who, whoStore=who==='Both'?'both':who;
  var hadPhoto=exPhotos.length>0;
  txns.unshift({id:'t'+(txSeq++),ico:s[0],cat:cat,note:note,date:dstr,who:whoStore,amt:amt,month:'Jul',photos:exPhotos.length?exPhotos.slice():undefined});
  if(hadPhoto) syncExpenseEvent(txns[0]);                   // photos → a linked event for Events + Memories
  renderTxns();
  var jul=months.Jul;
  var wasUnder=(jul.catSpent[cat]||0)<=(catBudget[cat]||Infinity);
  jul.spent+=amt; jul.catSpent[cat]=(jul.catSpent[cat]||0)+amt; jul.memberSpent[mkey]=(jul.memberSpent[mkey]||0)+amt;
  selMonth='Jul'; renderAll(); if(hadPhoto) renderEvents();   // photo → shows in Memories
  document.getElementById('ex-amt').value=''; document.getElementById('ex-note').value=''; exPhotos=[];
  var catOv=document.getElementById('cat-overlay').classList.contains('on');
  closeExpense();
  if(hadPhoto){ toast(L('Đã ghi '+fmt(amt)+' · lưu vào Kỷ niệm 📸','Logged '+fmt(amt)+' · saved to Memories 📸')); floatEmojis('📸'); }
  else if(catBudget[cat] && wasUnder && jul.catSpent[cat]>catBudget[cat]) toast(L('Lưu ý: '+cat+' đã vượt ngân sách','Heads up: '+cat+' is now over budget'));
  else toast(L('Đã ghi '+fmt(amt)+' · còn '+fmt(Math.max(0,months.Jul.budget-jul.spent))+' an toàn để tiêu','Logged '+fmt(amt)+' · '+fmt(Math.max(0,months.Jul.budget-jul.spent))+' safe to spend'));
  if(catOv && curDetail){ openCat(curDetail.type,curDetail.val); }   // logged from a category detail → refresh it
  else { go('spending'); segTo('overview'); }
}
