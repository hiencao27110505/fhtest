/* ---------- budget + run-rate ---------- */
function renderBudget(){
  syncFallbackBudget();                                  // catch-all always holds the unallocated remainder
  var m=M(), done=m.done, spent=m.spent, dim=m.dim, dom=m.dom, budget=m.budget;
  // First-run nudge, top of the tab (above the still-empty hero): no monthly
  // budget yet → set up categories + budget. Clears itself the moment one exists.
  var _fs=document.getElementById('fin-setup');
  if(_fs) _fs.innerHTML = (budget>0) ? '' :
    '<button class="fin-setup-card" onclick="openSheet(&#39;sheet-budget&#39;)">'
    + '<span class="fsc-ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 19V9M9 19V5M14 19v-7M19 19v-11"/></svg></span>'
    + '<span class="fsc-txt"><span class="fsc-t">'+L('Lập ngân sách cho cả nhà','Set up your budget')+'</span>'
    + '<span class="fsc-s">'+L('Đặt hạn mức cho từng hạng mục để theo dõi chi tiêu','A limit per category to track your spending')+'</span></span>'
    + '<svg class="fsc-chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M9 18l6-6-6-6"/></svg></button>';
  var reserved=done?0:monthReserved();                 // set-aside for events (unrealized)
  var pctSpent=budget>0?Math.min(100,spent/budget*100):0;
  var pctRes=budget>0?Math.max(0,Math.min(100-pctSpent, reserved/budget*100)):0;
  var pctPace=done?100:dom/dim*100;                    // pace = REALIZED only
  var overBudget=spent>budget;
  var safe=Math.max(0,budget-spent-reserved);          // safe to spend = budget − spent − set aside
  setTxt('hero-month',m.label);
  var moAb=m._iso?moAbbr(new Date(m._iso+'T00:00:00').getMonth()):m.short;
  setTxt('sp-month',m.label); setTxt('b-lab-mo',' · '+moAb); setTxt('m-lab',' · '+moAb);
  // home overview (light): spending tile — one number = spent + future spending
  setTxt('ht-spend-l',L('Chi tiêu · ','Spending · ')+moAb);
  setTxt('ht-spent',fmt(spent+reserved));
  // Thu Chi snapshot mini-row: income (informational) · spent · savings pool
  setTxt('snap-in', fmt(window.monthIncome||0));
  setTxt('inc-month', fmt(window.monthIncome||0));
  setTxt('snap-out', fmt(spent));
  setTxt('snap-pool', fmt(window.savings||0));
  if(done){
    var diff=budget-spent;
    setTxt('ht-spend-s', diff>=0 ? fmt(diff)+L(' dưới ngân sách',' under budget') : fmt(-diff)+L(' vượt ngân sách',' over budget'));
  } else {
    setTxt('ht-spend-s', fmt(safe)+L(' còn lại',' left'));
  }
  // reserved (striped) segment on the hero bar, sitting right after the realized spend
  var bres=document.getElementById('bres');
  if(bres){ if(!done && pctRes>0){ bres.style.display='block'; bres.style.left=pctSpent+'%'; bres.style.width=pctRes+'%'; } else bres.style.display='none'; }
  if(document.getElementById('b-safe')){
    var bmk=document.getElementById('bmark'); bmk.style.left=pctPace+'%'; bmk.style.display=done?'none':'block';
    setHTML('b-left', reserved>0 ? '<b>'+fmt(spent)+'</b> '+L('đã chi','spent')+' · <b>'+fmt(reserved)+'</b> '+L('sắp tới','future') : '<b>'+fmt(spent)+'</b> '+L('trên','of')+' '+fmt(budget)+' '+L('đã chi','spent'));
    if(done){
      var diff2=budget-spent, okc=diff2>=0;
      var bf=document.getElementById('bfill'); bf.className=okc?'fill-ok':'fill-red'; bf.style.width=pctSpent+'%';
      setTxt('b-safe', okc?fmt(diff2):'—');
      setTxt('b-safe-sub', okc? L('còn dư khi '+moAb+' khép lại','left unspent when '+moAb+' closed') : L(moAb+' kết thúc vượt ngân sách',moAb+' finished over budget'));
      setTxt('b-days',L('Đã chốt tháng','Month closed'));
    } else {
      var safeDaily=Math.round(safe/Math.max(1,dim-dom));
      var st=overBudget?'red':((spent/dom*dim)-budget>budget*0.01?'over':'ok');
      var bf2=document.getElementById('bfill'); bf2.className=st==='red'?'fill-red':(st==='over'?'fill-over':'fill-ok'); bf2.style.width=pctSpent+'%';
      setTxt('b-safe', fmt(safe));
      setTxt('b-safe-sub', overBudget ? L('vượt ngân sách, nên tạm dừng những khoản chưa cần','over budget, best to pause non-essentials') : L('khoảng '+fmt(safeDaily)+' mỗi ngày cho '+(dim-dom)+' ngày còn lại','about '+fmt(safeDaily)+' a day for the '+(dim-dom)+' days left'));
      setTxt('b-days',(dim-dom)+L(' ngày còn lại',' days left'));
    }
  }
  renderTrend();
  renderCatBudget();
  renderFinanceHero();
  renderCashflow();
}
/* Widget A — cash flow: what's LEFT this month (income − spent), the In/Out pair, and a
   swipeable chart + guide. On the current live month it becomes three periods — Day (buổi),
   Week (7 ngày), Month (4 tuần) — sharing one bar language and one guide tile; swipe or tap
   the dots to switch. Closed / past months keep the classic week chart + week-over-week note
   (no periods). Reuses renderBudget's month model + the same per-day spend source. */
function renderCashflow(){
  var host=document.getElementById('cf-left'); if(!host) return;
  var m=M(), spent=m.spent||0, income=window.monthIncome||0, left=income-spent;
  setTxt('cf-left', fmt(left)); host.classList.toggle('neg', left<0);
  setTxt('cf-in', fmt(income)); setTxt('cf-out', fmt(spent));

  var dim=m.dim, dom=m.dom, done=m.done;
  var daily=[]; for(var i=0;i<=dim;i++) daily[i]=0;
  (window.txns||[]).forEach(function(t){ if(!t.future && t.month===window.selMonth && t._d){ var dd=t._d.getDate(); if(dd>=1&&dd<=dim) daily[dd]+=t.amt; } });

  if(!window._cfSwipeBound){ cfBindSwipe(); window._cfSwipeBound=true; }
  var live = (selMonth===curMonthKey() && !done);

  if(!live){
    // Classic view (past / closed month): week chart + week-over-week note, no periods.
    var d0=cfWeekData(m, daily, done, dom, dim);
    setHTMLIf('cf-wow', cfWeekChartHTML(d0, done));
    setHTMLIf('cf-daily', '');
    cfSetDots(-1);
    cfWowNote(d0);
    renderRequestsCta(); renderCashflowEmailCta();
    return;
  }

  // Live month → three swipeable periods. The state-change push always tracks the DAY
  // state (the meaningful daily alert), independent of which period is on screen.
  cfMaybePush(m, daily);
  var cfn0=document.getElementById('cf-note'); if(cfn0){ cfn0.className='cf-note'; cfn0.innerHTML=''; }

  var period = window.cfPeriod|0;                        // 0 Day · 1 Week · 2 Month
  if(period===0) cfRenderDay(m, daily);
  else if(period===2) cfRenderMonth(m, daily);
  else cfRenderWeek(m, daily, done, dom, dim);
  cfSetDots(period);
  renderRequestsCta(); renderCashflowEmailCta();
}
/* ----- period state + swipe / dots / auto-rotate ----- */
try{ window.cfPeriod=parseInt(localStorage.getItem('fh-cfperiod')||'0',10); if(!(window.cfPeriod>=0&&window.cfPeriod<=2)) window.cfPeriod=0; }catch(e){ window.cfPeriod=0; }
function cfApplyPeriod(i, persist){                        // change the view; persist only for manual picks
  i=Math.max(0,Math.min(2,i|0)); if(i===(window.cfPeriod|0)) return;
  window.cfPeriod=i; if(persist){ try{localStorage.setItem('fh-cfperiod',String(i));}catch(e){} } renderCashflow();
}
function setCfPeriod(i){ cfPauseAuto(); cfApplyPeriod(i, true); }   // dot tap / swipe: remember it + pause auto-rotate
window.setCfPeriod=setCfPeriod;
/* Auto-rotate Day → Week → Month every few seconds so all three are seen without swiping.
   Any press pauses it; it resumes cfAuto.IDLE after the last touch. Runs only when the card is
   on-screen, the tab is visible, and on the live month — and never under reduced motion. */
var cfAuto={ paused:0, vis:false, timer:null, INT:4200, IDLE:8000 };
function cfPauseAuto(){ cfAuto.paused=Date.now()+cfAuto.IDLE; }
function cfStartAuto(card){
  if(cfAuto.timer || !card) return;
  if(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches) return;   // respect reduced motion
  if('IntersectionObserver' in window){ try{ new IntersectionObserver(function(es){ cfAuto.vis=es[0].isIntersecting; },{threshold:.5}).observe(card); }catch(e){ cfAuto.vis=true; } }
  else cfAuto.vis=true;
  cfAuto.timer=setInterval(function(){
    if(document.hidden || !cfAuto.vis) return;             // off-screen or backgrounded → hold
    if(!(selMonth===curMonthKey()) || M().done) return;    // periods exist only on the live month
    if(Date.now()<cfAuto.paused) return;                   // still cooling down after a manual touch
    cfApplyPeriod(((window.cfPeriod|0)+1)%3, false);       // rotate (does not overwrite the saved pick)
  }, cfAuto.INT);
}
function cfSetDots(active){
  var box=document.getElementById('cf-dots'); if(!box) return;
  if(active<0){ setHTMLIf(box, ''); return; }
  var h=''; for(var i=0;i<3;i++) h+='<i class="'+(i===active?'on':'')+'" onclick="setCfPeriod('+i+')"></i>';
  setHTMLIf(box, h);
}
function cfBindSwipe(){
  var card=document.querySelector('.cf-card'); if(!card) return;
  var x0=0,y0=0;
  card.addEventListener('pointerdown', cfPauseAuto, {passive:true});   // any press (touch or mouse) pauses auto-rotate
  card.addEventListener('touchstart',function(e){ var t=e.changedTouches[0]; x0=t.clientX; y0=t.clientY; },{passive:true});
  card.addEventListener('touchend',function(e){
    if(!(selMonth===curMonthKey()) || M().done) return;   // swipe only on the live month
    var t=e.changedTouches[0], dx=t.clientX-x0, dy=t.clientY-y0;
    if(Math.abs(dx)<40 || Math.abs(dx)<Math.abs(dy)*1.4) return;   // ignore taps + vertical scrolls
    setCfPeriod((window.cfPeriod|0)+(dx<0?1:-1));           // left → later period, right → earlier
  },{passive:true});
  cfStartAuto(card);
}
/* ----- Week (period 1 = the classic chart) ----- */
function cfWeekData(m, daily, done, dom, dim){
  var today=done?dim:dom;                                 // "today" = dom live, else last day
  var iso=m._iso||((m.short||curMonthKey())+'-01');
  var base=new Date(iso.slice(0,7)+'-01T00:00:00'); base.setDate(today);
  var wd=(base.getDay()+6)%7;                             // 0=Mon … 6=Sun
  var monThis=today-wd;                                   // day-of-month of this week's Monday
  var cur=[], prev=[], maxV=1;
  for(var k=0;k<7;k++){
    var dc=monThis+k, dp=monThis-7+k;
    var vc=(dc>=1&&dc<=dim&&(done||dc<=today))?daily[dc]:null;   // future days → null (no cur bar)
    var vp=(dp>=1&&dp<=dim)?daily[dp]:0;                          // days outside the month → 0
    cur.push(vc); prev.push(vp);
    if(vc!=null&&vc>maxV) maxV=vc; if(vp>maxV) maxV=vp;
  }
  return {cur:cur, prev:prev, monThis:monThis, today:today, maxV:maxV};
}
function cfWeekChartHTML(d, done){
  var DAYS=isVi()?['T2','T3','T4','T5','T6','T7','CN']:['M','T','W','T','F','S','S'], cols='';
  for(var c=0;c<7;c++){
    var ph=Math.round(d.prev[c]/d.maxV*100), fut=d.cur[c]==null;
    var over=!fut && d.prev[c]>0 && d.cur[c]>d.prev[c];   // spent more than the same day last week
    var ch=fut?0:(d.cur[c]>0?Math.max(Math.round(d.cur[c]/d.maxV*100),4):0);
    var isToday=!done && (d.monThis+c)===d.today;
    cols+='<div class="wcol"><span class="wbars">'
      +'<i class="wb prev" style="height:'+ph+'%"></i>'
      +(fut?'':'<i class="wb cur'+(over?' over':'')+'" style="height:'+ch+'%"></i>')
      +'</span><span class="wd'+(isToday?' on':'')+'">'+DAYS[c]+'</span></div>';
  }
  return cols;
}
function cfWowNote(d){                                     // classic week-over-week note (past months)
  var days=0, ts=0, ls=0;
  for(var i=0;i<7;i++){ if(d.cur[i]!=null){ days++; ts+=d.cur[i]; ls+=d.prev[i]; } }
  var diff=ts-ls, st='', note='';
  if(days>0 && ls>0){
    if(diff<0){ st='ok'; note='<span class="ni">▼</span>'+L('Giảm ','Down ')+'<b>'+fmt(-diff)+'</b> '+L('so với cùng kỳ tuần trước','vs the same days last week'); }
    else if(diff>0){ st='over'; note='<span class="ni">▲</span>'+L('Tăng ','Up ')+'<b>'+fmt(diff)+'</b> '+L('so với cùng kỳ tuần trước','vs the same days last week'); }
    else { st='flat'; note=L('Ngang cùng kỳ tuần trước','On par with last week'); }
  } else if(days>0 && ts>0){
    st='flat'; note=L('Tuần này đã chi ','Spent ')+'<b>'+fmt(ts)+'</b>'+L('',' this week');
  }
  var cfn=document.getElementById('cf-note');
  if(cfn){ cfn.className='cf-note'+(st?' '+st:''); if(cfn.innerHTML!==note) cfn.innerHTML=note; }
}
function cfRenderWeek(m, daily, done, dom, dim){
  var d=cfWeekData(m, daily, done, dom, dim);
  setHTMLIf('cf-wow', cfWeekChartHTML(d, done));
  cfPeriodGuide(m, daily, 'week');
}
/* ----- Day (period 0 = buổi breakdown: today vs yesterday) ----- */
function cfBuoiIdx(h){ return (h>=5&&h<11)?0:(h>=11&&h<14)?1:(h>=14&&h<18)?2:3; }   // Sáng·Trưa·Chiều·Tối
function cfRenderDay(m, daily){
  var dom=m.dom, yday=dom-1, curB=cfBuoiIdx(new Date().getHours());
  var cur=[0,0,0,0], prev=[0,0,0,0];                       // today's buổi vs yesterday's (same faint reference as Week/Month)
  (window.txns||[]).forEach(function(t){
    if(t.future || t.month!==window.selMonth || !t._d) return;
    var d=t._d.getDate(); if(d!==dom && d!==yday) return;
    var h=t._ts ? t._ts.getHours() : null, b=(h==null?curB:cfBuoiIdx(h));   // logged-time proxy; unknown → current buổi
    if(d===dom) cur[b]+=t.amt; else prev[b]+=t.amt;
  });
  var LB=isVi()?['Sáng','Trưa','Chiều','Tối']:['Morning','Midday','Afternoon','Evening'];
  var maxV=1; for(var i=0;i<4;i++){ if(cur[i]>maxV) maxV=cur[i]; if(prev[i]>maxV) maxV=prev[i]; }
  var cols='';
  for(var j=0;j<4;j++){
    var ph=Math.round(prev[j]/maxV*100), fut=j>curB;       // a buổi still ahead today → yesterday's bar only (no cur)
    var over=!fut && prev[j]>0 && cur[j]>prev[j];          // more than the same buổi yesterday
    var ch=fut?0:(cur[j]>0?Math.max(Math.round(cur[j]/maxV*100),4):0);
    cols+='<div class="wcol"><span class="wbars">'
      +'<i class="wb prev" style="height:'+ph+'%"></i>'
      +(fut?'':'<i class="wb cur'+(over?' over':'')+'" style="height:'+ch+'%"></i>')
      +'</span><span class="wd'+(j===curB?' on':'')+'">'+LB[j]+'</span></div>';
  }
  setHTMLIf('cf-wow', cols);
  cfPeriodGuide(m, daily, 'day');
}
/* ----- Month (period 2 = 4 tuần, this month vs last) ----- */
function cfMonthBuckets(daily, dim){
  var b=[0,0,0,0], hi=[7,14,21,dim];
  for(var i=0;i<4;i++){ var lo=[1,8,15,22][i]; for(var d=lo; d<=hi[i]; d++){ if(daily[d]) b[i]+=daily[d]; } }
  return b;
}
function cfPrevMonthDaily(m){                              // last calendar month's per-day spend (for faint bars)
  var iso=m._iso||((m.short||curMonthKey())+'-01');
  var d0=new Date(iso.slice(0,7)+'-01T00:00:00'), pd=new Date(d0.getFullYear(), d0.getMonth()-1, 1);
  var pkey=_MOA[pd.getMonth()], pmObj=months[pkey];
  var pdim=pmObj?pmObj.dim:new Date(pd.getFullYear(), pd.getMonth()+1, 0).getDate();
  var arr=[]; for(var i=0;i<=pdim;i++) arr[i]=0;
  (window.txns||[]).forEach(function(t){ if(!t.future && t.month===pkey && t._d){ var dd=t._d.getDate(); if(dd>=1&&dd<=pdim) arr[dd]+=t.amt; } });
  return {arr:arr, dim:pdim};
}
function cfRenderMonth(m, daily){
  var dim=m.dim, dom=m.dom;
  var cur=cfMonthBuckets(daily, dim);
  var pv=cfPrevMonthDaily(m), prev=cfMonthBuckets(pv.arr, pv.dim);
  var curW=dom<=7?0:dom<=14?1:dom<=21?2:3, starts=[1,8,15,22];
  var LB=isVi()?['Tuần 1','Tuần 2','Tuần 3','Tuần 4']:['W1','W2','W3','W4'];
  var maxV=1; for(var i=0;i<4;i++){ if(cur[i]>maxV) maxV=cur[i]; if(prev[i]>maxV) maxV=prev[i]; }
  var cols='';
  for(var j=0;j<4;j++){
    var fut=starts[j]>dom;                                 // a week that hasn't started yet → no cur bar
    var ph=Math.round(prev[j]/maxV*100);
    var over=!fut && prev[j]>0 && cur[j]>prev[j];
    var ch=fut?0:(cur[j]>0?Math.max(Math.round(cur[j]/maxV*100),4):0);
    cols+='<div class="wcol"><span class="wbars">'
      +'<i class="wb prev" style="height:'+ph+'%"></i>'
      +(fut?'':'<i class="wb cur'+(over?' over':'')+'" style="height:'+ch+'%"></i>')
      +'</span><span class="wd'+(j===curW?' on':'')+'">'+LB[j]+'</span></div>';
  }
  setHTMLIf('cf-wow', cols);
  cfPeriodGuide(m, daily, 'month');
}
/* Daily guide — "Hôm nay còn tiêu được": a per-day allowance minus what's been spent today.
   The allowance is the SAVER of (a) last month's daily average and (b) the budget-pace daily
   allowance, tightened by the family's saving goal (window.saveGoalPct). Colour + water level
   read how much room is left; tapping the tile opens the goal sheet. */
var DG_STATES={
  green:{main:'#0f9d84',mut:'#4a917f',bg:'#eaf6f2',trk:'rgba(15,157,132,.18)'},
  yellow:{main:'#e0a500',mut:'#8a6810',bg:'#fdf6df',trk:'rgba(224,165,0,.2)'},
  orange:{main:'#ef5f37',mut:'#a63e22',bg:'#fdeee9',trk:'rgba(239,95,55,.18)'},
  red:{main:'#e0483f',mut:'#a5645c',bg:'#fdeeec',trk:'rgba(224,72,63,.18)'}
};
function dgBase(m, daily){                                    // per-day norm (pre-goal) — used only by the goal-sheet estimate
  var spent=m.spent||0, spentToday=(daily&&daily[m.dom])||0, reserved=m.done?0:monthReserved();
  var prevKey=_MOA[(TODAY.getMonth()+11)%12], pm=months[prevKey];
  var prevDaily=(pm && pm.spent>0 && pm.dim>0) ? pm.spent/pm.dim : null;
  var remBudget=(m.budget||0)-(spent-spentToday)-reserved, daysLeft=Math.max(1, m.dim-m.dom+1);
  var budgetDaily=(m.budget>0 && remBudget>0) ? remBudget/daysLeft : null;
  var cand=[]; if(prevDaily!=null)cand.push(prevDaily); if(budgetDaily!=null)cand.push(budgetDaily);
  if(cand.length) return Math.min.apply(null,cand);
  return (m.budget>0)?m.budget/m.dim:((window.monthIncome||0)/m.dim||0);
}
/* The ONE atomic allowance every period is sliced from — so Day ⊆ Week ⊆ Month always, and
   they can never contradict. It is what's still available from the START of today, spread over
   the days left this month, capped by last month's pace (the saver) and tightened by the goal.
   Crucially it is NOT floored: when the budget is blown it goes negative, so every period reads
   "over" together instead of one staying cheerfully green. Returns null only when there is no
   basis at all (no budget, no history, no income) → the guide hides. */
function cfPerDay(m, daily){
  var spent=m.spent||0, spentToday=(daily&&daily[m.dom])||0, reserved=m.done?0:monthReserved();
  var spentBefore=spent-spentToday, daysLeft=Math.max(1, m.dim-m.dom+1);
  var prevKey=_MOA[(TODAY.getMonth()+11)%12], pm=months[prevKey];
  var prevDaily=(pm && pm.spent>0 && pm.dim>0) ? pm.spent/pm.dim : null;   // last month's daily average
  var budgetPerDay=(m.budget>0) ? ((m.budget-spentBefore-reserved)/daysLeft) : null;   // remaining budget spread over remaining days (may be ≤0)
  var base;
  if(budgetPerDay!=null && prevDaily!=null) base=Math.min(prevDaily, budgetPerDay);    // saver of the two signals
  else if(budgetPerDay!=null) base=budgetPerDay;
  else if(prevDaily!=null) base=prevDaily;
  else { var inc=window.monthIncome||0; base = inc>0 ? inc/m.dim : null; }
  if(base==null) return null;
  return base*(1-(window.saveGoalPct||0)/100);
}
function cfDaysLeftWeek(m, dLeftMonth){                       // today → Sunday (clamped to the month's end)
  var d=new Date((m._iso||((m.short||curMonthKey())+'-01')).slice(0,7)+'-01T00:00:00'); d.setDate(m.dom);
  return Math.min(7-((d.getDay()+6)%7), dLeftMonth);          // Mon=0 … Sun=6 → 7-idx days incl. today
}
function dgKey(remain, threshold){ if(remain<0) return 'red'; var pct=threshold>0?remain/threshold:0; return pct<=0.20?'orange':(pct<=0.50?'yellow':'green'); }
/* State-change push (E2EE-safe · client-side): tracks the DAY state regardless of which period
   is on screen. Only the device that just logged an expense fires (window._dgLocalAdd), only
   when today's state worsens, never on green. The actor gate + fhNotify's per-kind cooldown stop
   other devices' realtime re-renders from double-sending; window.dgStateDay resets each day. */
function cfMaybePush(m, daily){
  var perDay=cfPerDay(m,daily);
  if(perDay==null){ window._dgLocalAdd=false; return; }
  var remain=perDay-(daily[m.dom]||0), key=dgKey(remain, perDay);
  var _ord={green:0,yellow:1,orange:2,red:3};
  var _prev=(window.dgStateDay===m.dom)?(window.dgState||'green'):'green';
  if(window._dgLocalAdd && _ord[key]>_ord[_prev] && key!=='green' && typeof fhNotify==='function'){ fhNotify('dgstate',{state:key}); }
  window.dgState=key; window.dgStateDay=m.dom; window._dgLocalAdd=false;
}
/* One guide, sliced per period: how much MORE can be spent for the rest of this period
   (today → end of day / week / month) = perDay × days-left-in-period − spent today. Same UI,
   same colour states; Day ≤ Week ≤ Month by construction, and all read "over" together. */
function cfPeriodGuide(m, daily, periodKey){
  var perDay=cfPerDay(m, daily), dLeftMonth=Math.max(1, m.dim-m.dom+1);
  var days = periodKey==='day' ? 1 : (periodKey==='week' ? cfDaysLeftWeek(m, dLeftMonth) : dLeftMonth);
  var host=document.getElementById('cf-daily'); if(!host) return false;
  if(perDay==null){ setHTMLIf(host, ''); return false; }     // no basis for guidance → hide the tile
  var threshold=perDay*days, remain=threshold-(daily[m.dom]||0), over=remain<0, key=dgKey(remain, threshold);
  window.cfDailyState=key;
  var s=DG_STATES[key], level=(threshold>0)?Math.max(0,Math.min(100,remain/threshold*100)):0;
  var LBL={
    day:  over?L('Hôm nay đã vượt','Over today')       :L('Hôm nay còn tiêu được','Left to spend today'),
    week: over?L('Tuần này đã vượt','Over this week')   :L('Tiêu được tuần này','Left this week'),
    month:over?L('Tháng này đã vượt','Over this month') :L('Tiêu được tháng này','Left this month')
  };
  var amt = over ? fmt(-remain) : fmt(Math.max(0,remain));
  host.style.background=s.bg;
  setHTMLIf(host,
    '<span class="dg-lbl" style="color:'+s.mut+'">'+LBL[periodKey]+'</span>'
    +'<span class="dg-amt num" style="color:'+s.main+'">'+amt+'</span>'
    +'<span class="dg-vis">'+cfWaterSVG(level,s,over)+'</span>');
  return true;
}
function cfWaterSVG(level,s,over){
  if(over){
    return '<svg viewBox="0 0 46 46" width="46" height="46"><circle cx="23" cy="23" r="22" fill="rgba(224,72,63,.08)"/>'
      +'<circle cx="23" cy="23" r="22" fill="none" stroke="rgba(224,72,63,.4)" stroke-width="1.5"/></svg><span class="dg-bang">!</span>';
  }
  var y=(46*(1-level/100)).toFixed(2), WP='M0 0 Q 11.5 -3 23 0 T 46 0 T 69 0 T 92 0 L 92 62 L 0 62 Z';
  return '<svg viewBox="0 0 46 46" width="46" height="46"><defs><clipPath id="cfwclip"><circle cx="23" cy="23" r="22"/></clipPath></defs>'
    +'<circle cx="23" cy="23" r="22" fill="'+s.trk+'"/>'
    +'<g clip-path="url(#cfwclip)"><g class="cf-water" style="--y:'+y+'px;transform:translateY('+y+'px)">'
    +'<path class="cf-w1" d="'+WP+'" fill="'+s.main+'"/><path class="cf-w2" d="'+WP+'" fill="'+s.main+'" opacity=".5"/>'
    +'</g></g><circle cx="23" cy="23" r="22" fill="none" stroke="'+s.main+'" stroke-opacity=".35" stroke-width="1.5"/></svg>';
}
/* Saving-goal sheet — "Tiêu hoang như trước" (0%) + "Tiêu ít hơn 10/15/20/50%". Tapping a
   row applies immediately (like the month picker): sets the goal, re-renders, and closes. */
var SAVE_GOALS=[0,10,15,20,50];
function openSaveGoal(){ openSheet('sheet-savegoal'); }
function buildSaveGoalChoices(){
  var box=document.getElementById('savegoal-list'); if(!box) return;
  setTxt('savegoal-h', L('Mục tiêu tiết kiệm','Saving goal'));
  var cur=window.saveGoalPct||0, base=dgBase(M(),{});
  box.innerHTML=SAVE_GOALS.map(function(p){
    var name = p===0 ? L('Tiêu hoang như trước','Spend like before') : L('Tiêu ít hơn '+p+'%','Spend '+p+'% less');
    var side = p===0 ? '<span class="sg-side zero">—</span>' : '<span class="sg-side">+'+fmtK(base*(p/100)*M().dim)+'</span>';
    return '<button class="sg-row'+(p===cur?' on':'')+'" onclick="setSaveGoal('+p+')"><span class="sg-radio"></span>'
      +'<span class="sg-name">'+name+'</span>'+side+'</button>';
  }).join('');
}
function setSaveGoal(p){
  window.saveGoalPct=p;
  try{ localStorage.setItem('fh-savegoal', String(p)); }catch(e){}
  if(typeof persistSaveGoal==='function') persistSaveGoal(p);   // wired in Phase 2 (Supabase) + Phase 3 (push)
  buildSaveGoalChoices(); renderCashflow(); closeSheet();
}
try{ window.saveGoalPct=parseInt(localStorage.getItem('fh-savegoal')||'0',10)||0; }catch(e){ window.saveGoalPct=0; }
window.openSaveGoal=openSaveGoal; window.setSaveGoal=setSaveGoal; window.buildSaveGoalChoices=buildSaveGoalChoices;
/* Widget A's proposals CTA — "Đề xuất chi tiêu": opens the requests hub (openRequests).
   Shown only when there are still-open future-expense/goal/occasion proposals; the badge
   is how many are open (reqPendingAll). This replaces the standalone #fin-requests widget
   that used to sit above Widget A. Mirrors renderCashflowEmailCta. */
function renderRequestsCta(){
  var slot=document.getElementById('cf-req-cta'); if(!slot) return;
  var n=(typeof reqPendingAll==='function') ? reqPendingAll().length : 0;
  var html = n>0
    ? '<button class="cc-row" onclick="openRequests()">'
      +'<span class="cc-ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg></span>'
      +'<span class="cc-t">'+L('Đề xuất chi tiêu','Expense proposals')+'</span>'
      +'<span class="cc-badge num">'+n+'</span>'
      +'<svg class="cc-chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18l6-6-6-6"/></svg></button>'
    : '';
  if(slot.innerHTML!==html) slot.innerHTML=html;
}
window.renderRequestsCta=renderRequestsCta;
/* Widget A's third CTA — "Khoản thu chi từ email": always shown. A count badge appears
   only when the staged bank-email queue is non-empty. Tapping routes by setup state
   (fhEmailTxnCta): setup intro when no email is linked, else the review sheet (which shows
   its own empty modal when there's nothing). fhStagedCount refreshes on hydrate + promote. */
function renderCashflowEmailCta(){
  var slot=document.getElementById('cf-email-cta'); if(!slot) return;
  var n=window.fhStagedCount||0;
  var badge=n>0 ? '<span class="cc-badge num">'+n+'</span>' : '';
  var html='<button class="cc-row" onclick="fhEmailTxnCta()">'
    +'<span class="cc-ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 5h18v14H3z"/><path d="M3 6l9 7 9-7"/></svg></span>'
    +'<span class="cc-t">'+L('Khoản thu chi từ email','Income & expenses from email')+'</span>'
    +badge
    +'<svg class="cc-chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18l6-6-6-6"/></svg></button>';
  if(slot.innerHTML!==html) slot.innerHTML=html;
}
window.renderCashflowEmailCta=renderCashflowEmailCta;
/* Category breakdown — "Chi tiêu theo danh mục": each category's spend against its budget,
   as an Apple inset list. The allocation ring + daily chart were removed; this is the whole
   card now. Tap a row to drill into the category. Uses renderBudget's numbers. */
function renderFinanceHero(){
  var box = document.getElementById('fh-legend'); if(!box) return;
  var m = M();
  setTxt('fh-cats-lbl', L('Chi tiêu theo danh mục','Spending by category'));
  setTxt('fh-cats-edit', L('Chỉnh','Edit'));
  var legend = (catOrder || []).map(function(c){
    var sp = m.catSpent[c] || 0, bd = catBudget[c] || 0, ico = (catStyle[c] || [])[0] || '🏷️';
    var pct = bd > 0 ? Math.min(100, sp / bd * 100) : (sp > 0 ? 100 : 0);
    var overB = bd > 0 && sp > bd;                              // colour appears only when over budget
    return '<button type="button" class="fh-lrow' + (overB ? ' over' : '') + '" onclick="openCat(&#39;cat&#39;,&#39;' + escAttr(c) + '&#39;)">'
      + '<span class="fh-ico">' + esc(ico) + '</span>'
      + '<span class="fh-body"><span class="fh-l1"><span class="fh-lname">' + esc(isFallbackCat(c)?L('Khác','Others'):c) + '</span>'
      + '<span class="fh-lamt num"><b>' + fmtK(sp) + '</b>' + (bd > 0 ? ' / ' + fmtK(bd) : '') + '</span></span>'
      + '<span class="fh-bar"><i style="width:' + pct.toFixed(0) + '%"></i></span></span>'
      + '<svg class="fh-chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18l6-6-6-6"/></svg></button>';
  }).join('');
  setHTMLIf('fh-legend', legend);
}
/* Curated, plain-language insights — the smart core of Spending. */
function catFutureReserved(c){ return txns.reduce(function(s,t){ return (t.future && t.cat===c) ? s+t.amt : s; },0); }
function renderCatBudget(){
  var box=document.getElementById('cat-budget-rows'); if(!box)return;
  var m=M(), done=m.done, pace=done?1:m.dom/m.dim, html='';
  catOrder.forEach(function(c){
    var sp=m.catSpent[c]||0, bd=catBudget[c]||0, pct=bd?Math.min(100,sp/bd*100):0;
    var fut=done?0:catFutureReserved(c), rpct=bd?Math.max(0,Math.min(100-pct, fut/bd*100)):0;   // upcoming, shown after the spent bar
    var s=catStyle[c]||['🧾','#f2eef6','var(--cat-other)'];
    var overBud=sp>bd, overPace=!done && bd && (sp/bd)>(pace+0.14);
    var statusText, statusCol;
    if(overBud){ statusText=L('Vượt ngân sách','Over budget'); statusCol='var(--danger)'; }
    else if(overPace){ statusText=L('Vượt tiến độ','Over pace'); statusCol='var(--amber)'; }
    else if(fut>0){ statusText='＋'+fmt(fut)+L(' sắp tới',' upcoming'); statusCol='var(--brand-ink)'; }
    else { statusText=''; }
    var barCol=overBud?'#FF375F':(overPace?'#FFB020':s[2]);
    var mark=done?'display:none':('left:'+(pace*100)+'%');
    html+='<div class="crow tap" onclick="openCat(\'cat\',\''+c+'\')"><div class="cico" style="background:'+s[1]+';color:'+s[2]+'">'+s[0]+'</div>'
      +'<div class="r-body"><div class="r-t" style="display:flex;justify-content:space-between;align-items:center">'
      +'<span>'+(isFallbackCat(c)?L('Khác','Others'):c)+'</span><span class="num" style="font-weight:600">'+fmt(sp)
      +' <span style="color:var(--muted);font-weight:500">/ '+fmt(bd)+'</span></span></div>'
      +(statusText?'<div class="cstatus" style="color:'+statusCol+'">'+statusText+'</div>':'')
      +'<div class="bcbar"><i style="width:'+pct+'%;background:'+barCol+'"></i>'
      +(rpct>0?'<i class="res-stripe" style="left:'+pct+'%;width:'+rpct+'%"></i>':'')
      +'<span class="cmark" style="'+mark+'"></span></div>'
      +'</div><svg class="chev" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18l6-6-6-6"/></svg></div>';
  });
  if(!done){
    var evRes=eventsReserved();
    if(evRes>0) html+=catFutureRow('Events','🎯',evRes,m.budget);   // events stay a group (not a category)
  }
  box.innerHTML=html;
}
function catFutureRow(label,icon,amt,budget){
  var rpct=Math.min(100,amt/budget*100);
  return '<div class="crow tap events" onclick="openCat(\'cat\',\''+label+'\')"><div class="cico" style="background:var(--brand-tint);color:var(--brand-ink)">'+icon+'</div>'
    +'<div class="r-body"><div class="r-t" style="display:flex;justify-content:space-between;align-items:center">'
    +'<span>'+(label==='Events'?L('Sự kiện','Events'):label)+'</span><span class="num" style="font-weight:600">'+fmt(amt)+'</span></div>'
    +'<div class="bcbar"><i class="res-stripe" style="width:'+rpct+'%"></i></div>'
    +'</div><svg class="chev" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18l6-6-6-6"/></svg></div>';
}
function renderMembers(){
  var box=document.getElementById('member-split'); if(!box)return;
  var ms=M().memberSpent;
  var total=Object.keys(ms).reduce(function(a,k){return a+ms[k];},0)||1;
  var ord=Object.keys(ms).sort(function(a,b){return ms[b]-ms[a];});
  var split='',legend='';
  ord.forEach(function(k){
    var v=ms[k], pct=v/total*100, mt=membersMeta[k];
    split+='<i style="width:'+pct+'%;background:'+mt.col+'" onclick="openCat(\'mem\',\''+k+'\')"></i>';
    legend+='<div class="item wp" onclick="openCat(\'mem\',\''+k+'\')"><span class="dot" style="background:'+mt.col+'"></span>'+whoName(k)+' <b class="num">'+fmt(v)+'</b></div>';
  });
  setHTML('member-split',split); setHTML('member-legend',legend);
}
function renderAll(){ renderBudget(); renderMembers(); try{ if(typeof renderReqMounts==='function') renderReqMounts(); }catch(e){} try{ if(typeof renderHome==='function') renderHome(); }catch(e){} }

/* ---------- month picker ---------- */
function buildMonthChoices(){
  var box=document.getElementById('month-list'), html='';
  monthOrder.forEach(function(k){
    var m=months[k], sel=k===selMonth;
    var status=m.done?(m.spent<=m.budget?fmt(m.budget-m.spent)+L(' dưới ngân sách',' under budget'):fmt(m.spent-m.budget)+L(' vượt ngân sách',' over budget')):L('đang diễn ra','in progress');
    html+='<button class="qa" onclick="selectMonth(\''+k+'\')"><div><div class="qt">'+m.label+(sel?'  ✓':'')+'</div>'
      +'<div class="qs">'+fmt(m.spent)+' '+L('trên','of')+' '+fmt(m.budget)+' · '+status+'</div></div></button>';
  });
  box.innerHTML=html;
}
function selectMonth(k){ selMonth=k; renderAll(); renderTxns(); closeSheet(); if(curDetail && document.getElementById('cat-overlay').classList.contains('on')) openCat(curDetail.type,curDetail.val); }

/* ---------- budget setup ---------- */
var CATPAL=[['#eeeefc','var(--cat-housing)'],['#eaf7ee','var(--cat-food)'],['#fdeef4','var(--cat-dining)'],['#eafaf9','var(--cat-transport)'],['#f7eefd','var(--cat-fun)'],['#fff2e6','var(--cat-kids)'],['#eef4fb','var(--cat-other)']];
// "Others" is the catch-all: it always exists, can't be renamed away or removed,
// and anything with no category of its own lands here.
var CAT_FALLBACK='Others';
function isFallbackCat(n){ return String(n||'').trim().toLowerCase()===CAT_FALLBACK.toLowerCase(); }
// Guarantee the catch-all sits at the end of a category list (mutates in place).
function ensureFallbackCat(order,style,budget){
  if(order.some(isFallbackCat)) return order;
  order.push(CAT_FALLBACK);
  if(style && !style[CAT_FALLBACK]) style[CAT_FALLBACK]=['🗂️','#eef4fb','var(--cat-other)'];
  if(budget && budget[CAT_FALLBACK]===undefined) budget[CAT_FALLBACK]=0;
  return order;
}
function catRowHTML(emoji,name,budget,orig){
  var lock=isFallbackCat(name);
  return '<div class="cat-row'+(lock?' cat-row-lock':'')+'" data-orig="'+(orig||'')+'">'
    +'<input class="cat-emoji" maxlength="2" value="'+(emoji||'🏷️')+'" oninput="bgDirty()">'
    +'<input class="cat-name" placeholder="'+L('Tên','Name')+'" value="'+esc(name)+'"'+(lock?' readonly':' oninput="bgDirty()"')+'>'
    // symbol sits on the same side as fmt() puts it: ₫ after, $ before
    +'<span class="cat-bud-wrap">'+(CUR==='VND'?'':curSym())
      +'<input class="cat-bud num" inputmode="numeric" placeholder="0" value="'+amtToInput(budget)+'"'
      +(budget?' data-touched="1"':'')
      +(lock?' readonly title="'+L('Phần các danh mục khác chưa dùng tới','Whatever the other categories leave unallocated')+'">'
            :' oninput="markCatTouched(this);syncFallbackRow()" onblur="snapAmtInput(this);syncFallbackRow()">')
      +(CUR==='VND'?curSym():'')+'</span>'
    +(lock
      ? '<span class="cat-del cat-del-off" title="'+L('Mọi khoản chưa phân loại sẽ nằm ở đây','Everything uncategorised lands here')+'"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 018 0v3"/></svg></span>'
      : '<button class="cat-del" aria-label="'+L('Xoá danh mục','Remove category')+'" onclick="armCatDelete(this)"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg></button>')
    +'</div>';
}
// The catch-all is not budgeted by hand — it absorbs whatever the named
// categories leave unallocated: total − sum(everything else), floored at 0.
function fallbackShare(total,budget,order){
  var used=order.reduce(function(s,c){ return isFallbackCat(c)?s:s+(Number(budget[c])||0); },0);
  return Math.max(0,(Number(total)||0)-used);
}
// Recompute the catch-all's budget from the current totals (mutates catBudget).
function syncFallbackBudget(){
  ensureFallbackCat(catOrder,catStyle,catBudget);
  catBudget[CAT_FALLBACK]=fallbackShare(M().budget,catBudget,catOrder);
}
// Same, live inside the sheet, so the row tracks what you type in the others.
function syncFallbackRow(){
  var total=parseAmtBase(document.getElementById('bg-amt').value)||0, used=0, tgt=null;
  document.querySelectorAll('#sheet-budget .cat-row').forEach(function(row){
    var inp=row.querySelector('.cat-bud');
    if(isFallbackCat(row.getAttribute('data-orig'))||isFallbackCat(row.querySelector('.cat-name').value)) tgt=inp;
    else used+=parseAmtBase(inp.value)||0;
  });
  if(tgt) tgt.value=amtToInput(Math.max(0,total-used));
  var note=document.getElementById('bg-over');
  if(note){
    var over = !!(total&&used>total);
    note.style.display = over ? '' : 'none';
    // say by how much, so "Others is at 0" isn't the only signal something's wrong
    if(over) note.textContent=L('Các danh mục cộng lại vượt ngân sách tháng '+fmt(used-total)+', nên '+L('Khác','Others')+' còn 0.','Categories add up to '+fmt(used-total)+' more than the monthly budget, so '+L('Khác','Others')+' is at 0.');
  }
  bgDirty();
}
function fillBudgetSheet(){
  document.getElementById('bg-amt').value=amtToInput(M().budget);
  syncFallbackBudget();
  document.getElementById('bg-rows').innerHTML = catOrder.map(function(c){ var s=catStyle[c]||['🏷️']; return catRowHTML(s[0],c,catBudget[c],c); }).join('');
  document.getElementById('bg-amt').placeholder=amtPlaceholder();
  syncFallbackRow();
  bgSnap=bgSig(); bgDirty();                     // Save stays off until something actually changes
}
/* Save is disabled until the form is both valid and changed (DESIGN §3 .modal-save). */
var bgSnap='';
function bgSig(){
  var parts=[document.getElementById('bg-amt').value];
  document.querySelectorAll('#sheet-budget .cat-row').forEach(function(r){
    parts.push((r.querySelector('.cat-emoji').value||'')+''+(r.querySelector('.cat-name').value||'')+''+(r.querySelector('.cat-bud').value||''));
  });
  return parts.join('');
}
function bgValid(){
  if(!parseAmtBase(document.getElementById('bg-amt').value)) return false;
  var named=0;
  document.querySelectorAll('#sheet-budget .cat-row').forEach(function(r){
    if((r.querySelector('.cat-name').value||'').trim()) named++;
  });
  return named>0;
}
/* Save stays enabled (DESIGN §4.4): bgDirty() only clears the red flag as the user
   types; setBudget() gates on tap and flags the monthly-total field if it's empty. */
function bgDirty(){ if(typeof fhClearInvalid==='function') fhClearInvalid('sheet-budget'); }
function addCatRow(){                                       // new rows go above the catch-all, which stays last
  var box=document.getElementById('bg-rows'), lock=box.querySelector('.cat-row-lock'), html=catRowHTML('🏷️','','','');
  if(lock) lock.insertAdjacentHTML('beforebegin',html); else box.insertAdjacentHTML('beforeend',html);
  bgDirty();
  var rows=box.querySelectorAll('.cat-row:not(.cat-row-lock) .cat-name');
  if(rows.length) rows[rows.length-1].focus();               // land the cursor in the new row
}
// best-practice weights (EN + seeded VI names); unknown categories default to 0.08, then normalised.
// The six default categories (housing, groceries, transport, dining, shopping, fun) sum to 1.0.
// "Others" is excluded from the split (the catch-all takes the remainder), so it carries no weight.
// clothing is a hint for a hand-added category; kids/con cái omitted (take the 0.08 unknown-default).
var CATW={housing:.32,'nhà ở':.32,rent:.32,groceries:.20,'đi chợ':.20,transport:.15,'đi lại':.15,dining:.13,'ăn ngoài':.13,shopping:.10,'mua sắm':.10,fun:.10,'giải trí':.10,clothing:.06};
/* Auto-split fills in categories the user hasn't set themselves. It must never
   overwrite a hand-typed figure: editing the monthly total after tuning categories
   used to wipe that work on every keystroke, with no undo. A row is "touched" once
   it's edited by hand (or arrives with a saved budget), and touched rows are left
   exactly as they are. */
function markCatTouched(inp){ if(inp) inp.dataset.touched='1'; }
/* Removing a category archives it server-side on Save, so a stray tap on a small
   icon shouldn't do it. First tap arms (row goes red + label), second removes. */
var catArmT=null;
function armCatDelete(btn){
  var row=btn.closest('.cat-row');
  if(!btn.classList.contains('armed')){
    document.querySelectorAll('.cat-row .cat-del.armed').forEach(function(b){ b.classList.remove('armed'); b.closest('.cat-row').classList.remove('arming'); });
    btn.classList.add('armed'); row.classList.add('arming');
    btn.setAttribute('aria-label',L('Chạm lần nữa để xoá','Tap again to remove'));
    clearTimeout(catArmT);
    catArmT=setTimeout(function(){
      if(!btn.isConnected) return;
      btn.classList.remove('armed'); row.classList.remove('arming');
      btn.setAttribute('aria-label',L('Xoá danh mục','Remove category'));
    },3000);
    return;
  }
  clearTimeout(catArmT);
  row.remove(); syncFallbackRow();
}
function suggestBudgetSplit(){
  var total=parseAmtBase(document.getElementById('bg-amt').value); if(!total)return;
  // the catch-all is left out of the split — it takes the remainder afterwards
  var rows=[].slice.call(document.querySelectorAll('#sheet-budget .cat-row')).filter(function(r){
    return !isFallbackCat(r.getAttribute('data-orig')) && !isFallbackCat(r.querySelector('.cat-name').value);
  });
  var free=rows.filter(function(r){ var i=r.querySelector('.cat-bud'); return i && i.dataset.touched!=='1'; });
  if(!free.length){ syncFallbackRow(); return; }        // everything is hand-set — nothing to do
  // only the budget not already claimed by hand-set rows gets divided up
  var spoken=0;
  rows.forEach(function(r){ var i=r.querySelector('.cat-bud'); if(i&&i.dataset.touched==='1') spoken+=parseAmtBase(i.value)||0; });
  var pool=Math.max(0,total-spoken);
  var ws=free.map(function(r){ var n=(r.querySelector('.cat-name').value||'').trim().toLowerCase(); return CATW[n]!==undefined?CATW[n]:0.08; });
  var sum=ws.reduce(function(a,b){return a+b;},0)||1;
  free.forEach(function(r,i){ var base=Math.round(pool*(ws[i]/sum)/10)*10; var inp=r.querySelector('.cat-bud'); if(inp) inp.value=amtToInput(base); });
  syncFallbackRow();
}
function setBudget(){
  var amtEl=document.getElementById('bg-amt');
  var v=parseAmtBase(amtEl.value);
  if(!fhCheck([{el:amtEl, ok:v>0}], L('Hãy nhập ngân sách hằng tháng','Add a monthly budget'))) return;
  M().budget=v;
  var newOrder=[], newStyle={}, newBudget={}, renames=[], seen={};
  document.querySelectorAll('#sheet-budget .cat-row').forEach(function(row){
    var name=row.querySelector('.cat-name').value.trim(); if(!name || seen[name.toLowerCase()]) return; seen[name.toLowerCase()]=1;
    var emoji=row.querySelector('.cat-emoji').value.trim()||'🏷️';
    var bud=parseAmtBase(row.querySelector('.cat-bud').value)||0;
    var orig=row.getAttribute('data-orig');
    if(isFallbackCat(orig)) name=CAT_FALLBACK;               // the catch-all keeps its name whatever the input says
    var style = (orig&&catStyle[orig]) ? [emoji,catStyle[orig][1],catStyle[orig][2]] : [emoji].concat(CATPAL[newOrder.length%CATPAL.length]);
    newOrder.push(name); newStyle[name]=style; newBudget[name]=bud;
    if(orig && orig!==name) renames.push([orig,name]);
  });
  if(!newOrder.length){ toast(L('Giữ lại ít nhất một danh mục','Keep at least one category')); return; }
  ensureFallbackCat(newOrder,newStyle,newBudget);             // catch-all is never lost, however the rows were edited
  newBudget[CAT_FALLBACK]=fallbackShare(M().budget,newBudget,newOrder);   // and is always the unallocated remainder
  renames.forEach(function(pr){                              // cascade renames to transactions + month totals
    txns.forEach(function(t){ if(t.cat===pr[0]) t.cat=pr[1]; });
    Object.keys(months).forEach(function(mk){ var cs=months[mk].catSpent; if(cs && cs[pr[0]]!==undefined){ cs[pr[1]]=(cs[pr[1]]||0)+cs[pr[0]]; delete cs[pr[0]]; } });
  });
  window.__catRenames=renames;                              // hand renames to the DB write-through
  // categories whose row was removed (a rename is not a removal) → archive them server-side
  var kept={}; newOrder.forEach(function(n){ kept[n]=1; });
  renames.forEach(function(pr){ kept[pr[0]]=1; });
  window.__catDeletes=catOrder.filter(function(c){ return !kept[c]; });
  catOrder=newOrder; catStyle=newStyle; catBudget=newBudget;
  renderAll(); renderTxns(); closeModals(); toast(L('Đã cập nhật danh mục','Categories updated'));
}
