/* ── Cá nhân tab (personal ledger) ──
   Renders window.fhPersonalData() into #v-personal, using the SAME visual system
   and composition as the Finance tab: a focal cash-flow card (Còn lại + In/Out
   tiles + week-over-week chart + note + daily "còn tiêu được" guide) followed by
   section cards. Reuses the finance widget's own helpers (cfWeekChartHTML,
   cfWaterSVG, DG_STATES, dgKey) so it stays in lockstep with the family version.
   Icons are drawn SVG (app convention); emoji appear only as category marks. */
var PIC = {
  house: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/></svg>',
  lock:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="4.5" y="10.5" width="15" height="10" rx="2.3"/><path d="M8 10.5V7a4 4 0 0 1 8 0v3.5"/></svg>',
  plus:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
  chev:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m9 6 6 6-6 6"/></svg>',
  chart: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19V9M9 19V5M14 19v-7M19 19v-11"/></svg>',
  list:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/></svg>'
};
var _ccChev='<svg class="cc-chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m9 6 6 6-6 6"/></svg>';
/* LOCAL 'YYYY-MM' — never toISOString() (UTC shifts midnight into the prev month
   in UTC+7, which silently broke the last-month key → daily guide hidden). */
function _pMonKey(d){ return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0'); }

/* personal per-day spend for the live month → daily[], dim, dom */
function persDaily(){
  var P=fhPersonalData(), now=new Date(), y=now.getFullYear(), mo=now.getMonth();
  var dim=new Date(y,mo+1,0).getDate(), dom=now.getDate(), daily=[];
  for(var i=0;i<=dim;i++) daily[i]=0;
  (P.txns||[]).forEach(function(t){
    if(t.kind!=='expense' || !t.date) return;
    var d=new Date(t.date+'T00:00:00'); if(d.getFullYear()!==y || d.getMonth()!==mo) return;
    var dd=d.getDate(); if(dd>=1 && dd<=dim) daily[dd]+=(t.amt||0);
  });
  return {daily:daily, dim:dim, dom:dom};
}
/* this week (Mon→Sun containing today) vs last week — shape cfWeekChartHTML expects */
function persWeekData(daily, dom, dim){
  var base=new Date(); base.setDate(dom); var wd=(base.getDay()+6)%7, monThis=dom-wd;
  var cur=[], prev=[], maxV=1;
  for(var k=0;k<7;k++){
    var dc=monThis+k, dp=monThis-7+k;
    var vc=(dc>=1&&dc<=dim&&dc<=dom)?daily[dc]:null, vp=(dp>=1&&dp<=dim)?daily[dp]:0;
    cur.push(vc); prev.push(vp);
    if(vc!=null&&vc>maxV)maxV=vc; if(vp>maxV)maxV=vp;
  }
  return {cur:cur, prev:prev, monThis:monThis, today:dom, maxV:maxV};
}

function renderPersonal(){
  var host = document.getElementById('pers-body'); if(!host) return;
  var P = window.fhPersonalData ? fhPersonalData() : null;
  if(!P){ host.innerHTML=''; return; }

  if(P.state==='provisioning' || P.state==='boot' || P.state==='loading'){
    host.innerHTML = '<div class="empty-note">Đang chuẩn bị sổ cá nhân của bạn…</div>'; return;
  }
  if(P.state==='error'){
    host.innerHTML = '<div class="empty-note">Chưa tải được sổ cá nhân. <a class="pers-link" onclick="fhPersonalBoot()">Thử lại</a></div>'; return;
  }
  if(P.state==='locked'){
    host.innerHTML =
      '<div class="card pers-lock">'+
      '<div class="pers-lock-ic">'+PIC.lock+'</div>'+
      '<div class="pers-lock-t">Sổ cá nhân đang khóa</div>'+
      '<div class="pers-lock-s">Nhập thẻ khóa <b>cá nhân</b> của bạn (khác thẻ của gia đình) để mở trên máy này.</div>'+
      '<div class="field pers-lock-field"><input id="pers-card-in" placeholder="FH-XXXX-XXXX-…" autocomplete="off" autocapitalize="characters"></div>'+
      '<button class="cta" onclick="persUnlock()">Mở sổ cá nhân</button>'+
      '<div id="pers-unlock-err" class="pers-lock-err"></div>'+
      '</div>';
    return;
  }

  /* ready — amounts are base units (thousands of VND); fmt() applies curMult(). */
  var mon = _pMonKey(new Date());
  var txM = P.txns.filter(function(t){ return (t.date||'').slice(0,7)===mon && t.kind==='expense'; });
  var out = txM.reduce(function(s,t){ return s+(t.amt||0); },0);
  var inc = P.incomes.filter(function(i){ return (i.date||'').slice(0,7)===mon; }).reduce(function(s,i){ return s+(i.amt||0); },0);
  var left = inc-out;
  var famName = function(fid){ var f=(P.fams||[]).find(function(x){return x.family_id===fid;}); return f? f.name : 'Nhóm'; };

  var h = '';
  h += '<section class="cf-card">'
     + '<div class="cf-lbl">Còn lại tháng này · cá nhân</div>'
     + '<div class="cf-big num'+(left<0?' neg':'')+'">'+fmt(left)+'</div>'
     + '<div class="cf-tiles">'
     +   '<button class="cf-tile" onclick="openSheet(\'sheet-pincome\')"><span class="cf-tl"><span class="cf-ar up">↑</span> Vào</span><span class="cf-tv num">'+fmt(inc)+'</span></button>'
     +   '<button class="cf-tile" onclick="persScrollTx()"><span class="cf-tl"><span class="cf-ar dn">↓</span> Ra</span><span class="cf-tv num">'+fmt(out)+'</span></button>'
     + '</div>'
     + '<div class="wow" id="pcf-wow" aria-hidden="true"></div>'
     + '<div class="cf-note" id="pcf-note"></div>'
     + '<div class="cf-daily" id="pcf-daily" style="display:none"></div>'
     + '<div class="cf-dots" id="pcf-dots" aria-hidden="true"></div>'
     + '<div class="cf-cta">'
     +   '<button class="cc-row" onclick="openSheet(\'sheet-pbudget\')"><span class="cc-ic">'+PIC.chart+'</span><span class="cc-t">'+(P.budget>0?'Ngân sách cá nhân':'Lập ngân sách cá nhân')+'</span>'+_ccChev+'</button>'
     +   '<button class="cc-row" onclick="persScrollCats()"><span class="cc-ic">'+PIC.list+'</span><span class="cc-t">Xem chi tiêu</span>'+_ccChev+'</button>'
     +   '<button class="cc-row" onclick="openPersonalExpense()"><span class="cc-ic">'+PIC.plus+'</span><span class="cc-t">Ghi khoản chi riêng tư</span>'+_ccChev+'</button>'
     + '</div>'
     + '</section>';

  /* ── Các nhóm của tôi — per-space roll-up (drawn icons) ── */
  var bySpace = {};
  txM.forEach(function(t){ var k=t.spaceId||'_p'; bySpace[k]=(bySpace[k]||0)+(t.amt||0); });
  var spKeys = Object.keys(bySpace).filter(function(k){ return k!=='_p'; });
  h += '<div class="section-h"><span class="t">Các nhóm của tôi</span></div><div class="rows">';
  if(spKeys.length){
    spKeys.forEach(function(k){
      h += '<div class="row"><div class="r-ico pers-r-ico">'+PIC.house+'</div><div class="r-body"><div class="r-t">'+famName(k)+'</div>'
         + '<div class="r-s">Bạn đã chi cho nhóm tháng này</div></div><div class="r-amt num">'+fmt(bySpace[k])+'</div></div>';
    });
  } else {
    h += '<div class="empty-note">Các khoản bạn ghi cho gia đình sẽ tự xuất hiện ở đây.</div>';
  }
  if(bySpace['_p']) {
    h += '<div class="row"><div class="r-ico pers-r-ico priv">'+PIC.lock+'</div><div class="r-body"><div class="r-t">Riêng tư</div>'
       + '<div class="r-s">Chỉ mình bạn thấy</div></div><div class="r-amt num">'+fmt(bySpace['_p'])+'</div></div>';
  }
  h += '</div>';

  /* ── Chi theo danh mục (Xem chi tiêu) — spend by category, vs personal budget ── */
  var byCat={};
  txM.forEach(function(t){ var k=(t.cat||'Khác'); if(!byCat[k]) byCat[k]={name:k, emoji:t.emoji||'🗂️', v:0}; byCat[k].v+=(t.amt||0); });
  var catRows=Object.keys(byCat).map(function(k){return byCat[k];}).sort(function(a,b){return b.v-a.v;});
  var pOver = P.budget>0 && out>P.budget;
  h += '<section class="fin-cats-card" id="pers-cats"><div class="fin-cats-h"><span>Chi theo danh mục</span>'
     + '<a onclick="openSheet(\'sheet-pbudget\')">'+(P.budget>0?'Ngân sách':'Lập ngân sách')+'</a></div>';
  if(P.budget>0){
    h += '<div class="cf-note '+(pOver?'over':'ok')+'" style="margin:6px 0 4px"><span class="ni">'+(pOver?'▲':'▾')+'</span>Đã chi <b>'+fmt(out)+'</b> / '+fmt(P.budget)+(pOver?' — vượt '+fmt(out-P.budget):' — còn '+fmt(P.budget-out))+'</div>'
       + '<div class="pbud-bar"><i style="width:'+Math.min(100,P.budget?out/P.budget*100:0)+'%;background:'+(pOver?'var(--danger)':'var(--brand)')+'"></i></div>';
  }
  h += '<div class="fin-legend">';
  if(catRows.length){
    var maxV=catRows[0].v||1;
    catRows.forEach(function(c){
      var pct=P.budget>0 ? Math.min(100,c.v/P.budget*100) : (c.v/maxV*100);
      h += '<div class="fh-lrow"><div class="fh-ico">'+(c.emoji||'🗂️')+'</div><div class="fh-body"><div class="fh-l1"><span class="fh-lname">'+((c.name||'Khác').replace(/</g,'&lt;'))+'</span><span class="fh-lamt"><b>'+fmt(c.v)+'</b></span></div><div class="fh-bar"><i style="width:'+pct+'%"></i></div></div></div>';
    });
  } else { h += '<div class="empty-note">Chưa có chi tiêu tháng này.</div>'; }
  h += '</div></section>';

  /* ── Giao dịch của bạn — category emoji is the only emoji (content mark) ── */
  h += '<div class="section-h" id="pers-tx"><span class="t">Giao dịch của bạn</span></div><div class="rows">';
  if(P.txns.length){
    P.txns.slice(0,30).forEach(function(t){
      h += '<div class="row"><div class="r-ico personal-ico">'+(t.emoji||'🗂️')+'</div>'
         + '<div class="r-body"><div class="r-t">'+((t.note||t.cat||'Khoản chi').replace(/</g,'&lt;'))+'</div>'
         + '<div class="r-s">'+t.date.slice(8,10)+'/'+t.date.slice(5,7)+(t.spaceId? ' · '+famName(t.spaceId) : ' · riêng tư')+'</div></div>'
         + '<div class="r-amt num">−'+fmt(t.amt||0)+'</div></div>';
    });
  } else {
    h += '<div class="empty-note">Chưa có giao dịch nào trong sổ cá nhân.</div>';
  }
  h += '</div>';
  host.innerHTML = h;
  persRenderPeriod();          // fills the swipeable Day/Week/Month chart + guide + dots
  persBindSwipe();
}
function persScrollTx(){ _persScrollTo('pers-tx'); }
function persScrollCats(){ _persScrollTo('pers-cats'); }
function _persScrollTo(id){ var el=document.getElementById(id), sc=document.getElementById('scroll'); if(el&&sc){ var y=Math.max(0, el.getBoundingClientRect().top - sc.getBoundingClientRect().top + sc.scrollTop - 70); sc.scrollTo({top:y,behavior:'smooth'}); } }
/* personal budget sheet */
function persBudgetSubmit(){
  var amt=parseAmtBase((document.getElementById('pbud-amt')||{}).value||'');
  if(!amt || amt<=0){ window.toast && toast('Nhập số tiền'); return; }
  fhPersonalSetBudget(amt).then(function(ok){ if(ok){ closeModals(); renderPersonal(); window.toast && toast('Đã đặt ngân sách cá nhân'); } });
}
function persBudgetPrefill(){ var el=document.getElementById('pbud-amt'); var P=window.fhPersonalData?fhPersonalData():null; if(el&&P){ el.value = P.budget>0 ? (P.budget*curMult()).toLocaleString(CUR==='VND'?'vi-VN':'en-US') : ''; } }
function persBudgetOpen(){ persBudgetPrefill(); persBudgetOpen(); }

/* ── swipeable Day / Week / Month cash-flow — clone of the finance widget,
   contextualised to the personal ledger (income/spend, last-month pace). ── */
try{ window.persPeriod=parseInt(localStorage.getItem('fh-pcfperiod')||'1',10); if(!(window.persPeriod>=0&&window.persPeriod<=2)) window.persPeriod=1; }catch(e){ window.persPeriod=1; }
function persSetPeriod(i){ i=Math.max(0,Math.min(2,i|0)); window.persPeriod=i; try{localStorage.setItem('fh-pcfperiod',String(i));}catch(e){} persRenderPeriod(); }
function persBindSwipe(){
  var card=document.querySelector('#v-personal .cf-card'); if(!card || card._pbound) return; card._pbound=1;
  var x0=0,y0=0;
  card.addEventListener('touchstart',function(e){ var t=e.changedTouches[0]; x0=t.clientX; y0=t.clientY; },{passive:true});
  card.addEventListener('touchend',function(e){ var t=e.changedTouches[0], dx=t.clientX-x0, dy=t.clientY-y0; if(Math.abs(dx)<40||Math.abs(dx)<Math.abs(dy)*1.4) return; persSetPeriod((window.persPeriod|0)+(dx<0?1:-1)); },{passive:true});
}
function persLastMonthDaily(){
  var P=fhPersonalData(), now=new Date(), pd=new Date(now.getFullYear(),now.getMonth()-1,1);
  var key=_pMonKey(pd), dim=new Date(now.getFullYear(),now.getMonth(),0).getDate(), arr=[];
  for(var i=0;i<=dim;i++) arr[i]=0;
  (P.txns||[]).forEach(function(t){ if(t.kind==='expense'&&(t.date||'').slice(0,7)===key){ var dd=+t.date.slice(8,10); if(dd>=1&&dd<=dim) arr[dd]+=(t.amt||0); } });
  return {arr:arr, dim:dim};
}
/* Local YYYY-MM-DD (avoids the UTC date-shift in UTC+7). */
function _pDate(dt){ return dt.getFullYear()+'-'+String(dt.getMonth()+1).padStart(2,'0')+'-'+String(dt.getDate()).padStart(2,'0'); }
/* Sum personal expense spend over an inclusive date range [aStr,bStr] ('YYYY-MM-DD'). */
function persSpendRange(aStr, bStr){
  var P=fhPersonalData(), s=0;
  (P.txns||[]).forEach(function(t){ if(t.kind==='expense' && t.date && t.date>=aStr && t.date<=bStr) s+=(t.amt||0); });
  return s;
}
/* Period spend/baseline for the current month — like-for-like and to-date, mirrors cfGuideParts:
   spent = this period so far; budget = pro-rated budget for elapsed days; prev = the same span
   in the previous equivalent period (day → rolling 30-day average, a "usual day"). */
function persGuideParts(periodKey){
  var P=fhPersonalData(), now=new Date(), dim=new Date(now.getFullYear(),now.getMonth()+1,0).getDate();
  var dom=now.getDate(), wd=(now.getDay()+6)%7, budget=P.budget||0;
  var d0=function(off){ return _pDate(new Date(now.getFullYear(),now.getMonth(),now.getDate()+off)); };
  var elapsed = periodKey==='day' ? 1 : (periodKey==='week' ? (wd+1) : dom);
  var budgetToDate = budget>0 ? (budget/dim)*elapsed : null;
  var spent, prevRaw;
  if(periodKey==='day'){ spent=persSpendRange(d0(0),d0(0)); prevRaw=persSpendRange(d0(-30),d0(-1))/30; }
  else if(periodKey==='week'){ spent=persSpendRange(d0(-wd),d0(0)); prevRaw=persSpendRange(d0(-wd-7),d0(-7)); }
  else { spent=persSpendRange(_pDate(new Date(now.getFullYear(),now.getMonth(),1)), d0(0));
    var pm=new Date(now.getFullYear(),now.getMonth()-1,1), pdim=new Date(now.getFullYear(),now.getMonth(),0).getDate();
    prevRaw=persSpendRange(_pDate(pm), _pDate(new Date(pm.getFullYear(),pm.getMonth(),Math.min(dom,pdim)))); }
  return {spent:spent, budgetToDate:budgetToDate, prevRaw:prevRaw};
}
/* Day period: today vs yesterday, bucketed by buổi (Sáng·Trưa·Chiều·Tối) via logged time. */
function persDayChartHTML(pd){
  var P=fhPersonalData(), now=new Date(), y=now.getFullYear(), mo=now.getMonth(), dom=pd.dom;
  var curB=(typeof cfBuoiIdx==='function')?cfBuoiIdx(now.getHours()):3, cur=[0,0,0,0], prev=[0,0,0,0];
  (P.txns||[]).forEach(function(t){
    if(t.kind!=='expense'||!t.date) return;
    var d=new Date(t.date+'T00:00:00'); if(d.getFullYear()!==y||d.getMonth()!==mo) return;
    var dd=d.getDate(); if(dd!==dom && dd!==dom-1) return;
    var h=t.ts?new Date(t.ts).getHours():null, b=(h==null?curB:((typeof cfBuoiIdx==='function')?cfBuoiIdx(h):3));
    if(dd===dom) cur[b]+=(t.amt||0); else prev[b]+=(t.amt||0);
  });
  var LB=['Sáng','Trưa','Chiều','Tối'], maxV=1; for(var i=0;i<4;i++){ if(cur[i]>maxV)maxV=cur[i]; if(prev[i]>maxV)maxV=prev[i]; }
  var cols='';
  for(var j=0;j<4;j++){ var ph=Math.round(prev[j]/maxV*100), fut=j>curB, over=!fut&&prev[j]>0&&cur[j]>prev[j], ch=fut?0:(cur[j]>0?Math.max(Math.round(cur[j]/maxV*100),4):0);
    cols+='<div class="wcol"><span class="wbars"><i class="wb prev" style="height:'+ph+'%"></i>'+(fut?'':'<i class="wb cur'+(over?' over':'')+'" style="height:'+ch+'%"></i>')+'</span><span class="wd'+(j===curB?' on':'')+'">'+LB[j]+'</span></div>'; }
  return {html:cols, spent:pd.daily[dom]||0};
}
/* Month period: 4 weeks this month vs last. */
function persMonthChartHTML(pd, lm){
  var buckets=function(arr,dim){ var b=[0,0,0,0], hi=[7,14,21,dim]; for(var i=0;i<4;i++){ var lo=[1,8,15,22][i]; for(var d=lo;d<=hi[i];d++){ if(arr[d])b[i]+=arr[d]; } } return b; };
  var cur=buckets(pd.daily,pd.dim), prev=buckets(lm.arr,lm.dim);
  var curW=pd.dom<=7?0:pd.dom<=14?1:pd.dom<=21?2:3, LB=['Tuần 1','Tuần 2','Tuần 3','Tuần 4'];
  var maxV=1; for(var i=0;i<4;i++){ if(cur[i]>maxV)maxV=cur[i]; if(prev[i]>maxV)maxV=prev[i]; }
  var cols='';
  for(var j=0;j<4;j++){ var ph=Math.round(prev[j]/maxV*100), fut=j>curW, over=!fut&&prev[j]>0&&cur[j]>prev[j], ch=fut?0:(cur[j]>0?Math.max(Math.round(cur[j]/maxV*100),4):0);
    cols+='<div class="wcol"><span class="wbars"><i class="wb prev" style="height:'+ph+'%"></i>'+(fut?'':'<i class="wb cur'+(over?' over':'')+'" style="height:'+ch+'%"></i>')+'</span><span class="wd'+(j===curW?' on':'')+'">'+LB[j]+'</span></div>'; }
  var spent=0; for(var k=0;k<4;k++) spent+=cur[k];
  return {html:cols, spent:spent};
}
function persRenderPeriod(){
  var P=fhPersonalData(); if(!P||P.state!=='ready') return;
  var wowEl=document.getElementById('pcf-wow'); if(!wowEl) return;
  var pd=persDaily(), lm=persLastMonthDaily(), p=window.persPeriod|0;
  var pk = p===0?'day':(p===2?'month':'week');
  if(p===0){ var d=persDayChartHTML(pd); wowEl.innerHTML=d.html; }
  else if(p===2){ var mo=persMonthChartHTML(pd, lm); wowEl.innerHTML=mo.html; }
  else { var wk=persWeekData(pd.daily, pd.dom, pd.dim); wowEl.innerHTML=(typeof cfWeekChartHTML==='function')?cfWeekChartHTML(wk,false):''; }
  var gp=persGuideParts(pk);
  if(typeof fhGuideRender==='function') fhGuideRender('pcf-daily', pk, gp.spent, gp.budgetToDate, gp.prevRaw, 1);
  var dots=document.getElementById('pcf-dots'); if(dots){ var dh=''; for(var k=0;k<3;k++) dh+='<i class="'+(k===p?'on':'')+'" onclick="persSetPeriod('+k+')"></i>'; dots.innerHTML=dh; }
  var note=document.getElementById('pcf-note');
  if(note){ if(!P.mirrorRan){ note.className='cf-note flat'; note.innerHTML='Đang đồng bộ các khoản bạn đã ghi cho gia đình…'; } else { note.className='cf-note'; note.innerHTML=''; } }
}

function persUnlock(){
  var el=document.getElementById('pers-card-in'), err=document.getElementById('pers-unlock-err');
  if(!el) return;
  fhPersonalUnlock(el.value).then(function(r){
    if(!r.ok && err) err.textContent = (r.error==='checksum'||r.error==='wrong_card') ? 'Thẻ không đúng — kiểm tra lại từng nhóm ký tự.' : 'Chưa mở được ('+r.error+').';
  });
}

/* personal card intro — the ONE secret to protect */
function fhPCardIntro(){
  var c = window.__fhPersonalCard; if(!c) return;
  var d = document.getElementById('pcard-display'); if(d) d.textContent = c.display;
  openSheet('sheet-pcard');
}
/* View the personal code later (Settings → Mã hoá tài chính). Shows the card
   cached on this device; save/copy reuse the same sheet-pcard buttons. */
window.fhPersonalCardShow = function(){
  var disp = window.fhPersonalCardCached && fhPersonalCardCached();
  if(disp){
    window.__fhPersonalCard = { display: disp };
    var d = document.getElementById('pcard-display'); if(d) d.textContent = disp;
    openSheet('sheet-pcard');
    return;
  }
  // DEK is on the device (ledger opens) but the card string was never saved here
  // (provisioned before caching shipped). Re-enter the card you saved to re-cache it.
  var e2=document.getElementById('pcode-err'); if(e2) e2.textContent='';
  var inp=document.getElementById('pcode-in'); if(inp) inp.value='';
  openSheet('sheet-pcode');
};
/* re-enter the personal card to re-cache it on this device, then show it */
function persCodeSubmit(){
  var el=document.getElementById('pcode-in'), err=document.getElementById('pcode-err');
  if(!el) return;
  fhPersonalUnlock(el.value).then(function(r){
    if(r.ok){ closeModals(); setTimeout(function(){ if(window.fhPersonalCardShow) fhPersonalCardShow(); }, 260); }
    else if(err){ err.textContent = (r.error==='checksum'||r.error==='wrong_card') ? 'Mã không đúng — kiểm tra lại từng nhóm ký tự.' : (r.error==='no_wrap'?'Không tìm thấy khóa của sổ cá nhân.':'Chưa mở được ('+r.error+').'); }
  });
}
/* Lost the card entirely? Mint a new one from the DEK still on this device. */
function persCodeRegen(){
  var err=document.getElementById('pcode-err');
  var P=window.fhPersonalData?fhPersonalData():null;
  if(!P||!P.key){ if(err) err.textContent='Cần mở sổ cá nhân trước (dữ liệu đang khóa).'; return; }
  if(err){ err.style.color='var(--muted)'; err.textContent='Đang tạo mã khóa mới & mã hóa lại dữ liệu…'; }
  fhPersonalRegen(function(n,tot){ if(err) err.textContent='Đang mã hóa lại… '+n+'/'+tot; }).then(function(r){
    if(err) err.style.color='';
    if(r.ok){ closeModals(); setTimeout(function(){ renderPersonal(); if(window.fhPersonalCardShow) fhPersonalCardShow(); }, 200); window.toast && toast(L('Đã tạo mã khóa cá nhân mới — nhớ lưu lại nhé','New personal code created — save it this time')); }
    else if(err){ err.style.color='var(--danger)'; err.textContent = r.error==='busy'?'Đang xử lý…':(r.error==='locked'?'Cần mở sổ cá nhân trước.':'Chưa tạo được, thử lại.'); }
  });
}
function persCardCopy(){
  var c = window.__fhPersonalCard; if(!c) return;
  (navigator.clipboard && navigator.clipboard.writeText(c.display)).then(function(){ window.toast && toast('Đã sao chép thẻ khóa'); });
}
function persCardSave(){
  var c = window.__fhPersonalCard; if(!c) return;
  var blob = new Blob(['FamilyHub — Thẻ khóa CÁ NHÂN của bạn\n\n'+c.display+'\n\nĐây là chìa khóa dữ liệu cá nhân. Cất kỹ — mất thẻ là mất dữ liệu, không ai khôi phục được (kể cả chúng tôi).'], {type:'text/plain'});
  var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'FamilyHub-The-khoa-ca-nhan.txt'; a.click();
  setTimeout(function(){ URL.revokeObjectURL(a.href); }, 4000);
}

/* personal income quick-add (expense now goes through the shared expense modal
   via openPersonalExpense — one capture flow, scope-picked). */
function persAddIncome(){
  var amt = parseAmtBase((document.getElementById('pinc-amt')||{}).value||'');
  var note = ((document.getElementById('pinc-note')||{}).value||'').trim();
  if(!amt || amt<=0){ window.toast && toast('Nhập số tiền'); return; }
  fhPersonalAddIncome(amt, note).then(function(ok){ if(ok){ closeModals(); renderPersonal(); window.toast && toast('Đã ghi thu nhập'); } });
}
