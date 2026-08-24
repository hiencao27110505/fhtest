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
  chev:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m9 6 6 6-6 6"/></svg>'
};

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
  var mon = new Date().toISOString().slice(0,7);
  var txM = P.txns.filter(function(t){ return (t.date||'').slice(0,7)===mon && t.kind==='expense'; });
  var out = txM.reduce(function(s,t){ return s+(t.amt||0); },0);
  var inc = P.incomes.filter(function(i){ return (i.date||'').slice(0,7)===mon; }).reduce(function(s,i){ return s+(i.amt||0); },0);
  var left = inc-out;
  var famName = function(fid){ var f=(P.fams||[]).find(function(x){return x.family_id===fid;}); return f? f.name : 'Nhóm'; };

  /* ── week-over-week chart (reuse the finance chart builder) ── */
  var pd=persDaily(), wk=persWeekData(pd.daily, pd.dom, pd.dim);
  var chart = (typeof cfWeekChartHTML==='function') ? cfWeekChartHTML(wk, false) : '';

  /* ── note: this week vs the same days last week (mirror cfWowNote) ── */
  var noteState='', noteHTML='';
  if(!P.mirrorRan){ noteState='flat'; noteHTML='Đang đồng bộ các khoản bạn đã ghi cho gia đình…'; }
  else {
    var wdays=0, ts=0, ls=0;
    for(var i=0;i<7;i++){ if(wk.cur[i]!=null){ wdays++; ts+=wk.cur[i]; ls+=wk.prev[i]; } }
    var diff=ts-ls;
    if(wdays>0 && ls>0){
      if(diff<0){ noteState='ok'; noteHTML='<span class="ni">▼</span>Giảm <b>'+fmt(-diff)+'</b> so với cùng kỳ tuần trước'; }
      else if(diff>0){ noteState='over'; noteHTML='<span class="ni">▲</span>Tăng <b>'+fmt(diff)+'</b> so với cùng kỳ tuần trước'; }
      else { noteState='flat'; noteHTML='Ngang cùng kỳ tuần trước'; }
    } else if(wdays>0 && ts>0){ noteState='flat'; noteHTML='Tuần này đã chi <b>'+fmt(ts)+'</b>'; }
  }

  /* ── daily guide: "Hôm nay còn tiêu được" (remaining money spread over days left) ── */
  var dailyHTML='';
  var spentToday=pd.daily[pd.dom]||0, daysLeft=Math.max(1, pd.dim-pd.dom+1);
  var avail=inc-(out-spentToday);                          // money for the rest of the month, today included
  var threshold=(inc>0 && avail>0)? avail/daysLeft : 0;    // needs income to have a meaningful allowance
  if(threshold>0 && typeof cfWaterSVG==='function' && typeof DG_STATES!=='undefined'){
    var remain=threshold-spentToday, over=remain<0;
    var key=(typeof dgKey==='function')? dgKey(remain,threshold) : (remain<0?'red':(remain/threshold<=.2?'orange':(remain/threshold<=.5?'yellow':'green')));
    var s=DG_STATES[key], level=Math.max(0,Math.min(100,remain/threshold*100));
    var amt=over? fmt(-remain) : fmt(Math.max(0,remain));
    dailyHTML='<div class="cf-daily" style="background:'+s.bg+'">'
      +'<span class="dg-lbl" style="color:'+s.mut+'">'+(over?'Hôm nay đã vượt':'Hôm nay còn tiêu được')+'</span>'
      +'<span class="dg-amt num" style="color:'+s.main+'">'+amt+'</span>'
      +'<span class="dg-vis">'+cfWaterSVG(level,s,over)+'</span></div>';
  }

  var h = '';
  h += '<section class="cf-card">'
     + '<div class="cf-lbl">Còn lại tháng này · cá nhân</div>'
     + '<div class="cf-big num'+(left<0?' neg':'')+'">'+fmt(left)+'</div>'
     + '<div class="cf-tiles">'
     +   '<button class="cf-tile" onclick="openSheet(\'sheet-pincome\')"><span class="cf-tl"><span class="cf-ar up">↑</span> Vào</span><span class="cf-tv num">'+fmt(inc)+'</span></button>'
     +   '<button class="cf-tile" onclick="persScrollTx()"><span class="cf-tl"><span class="cf-ar dn">↓</span> Ra</span><span class="cf-tv num">'+fmt(out)+'</span></button>'
     + '</div>'
     + '<div class="wow" aria-hidden="true">'+chart+'</div>'
     + '<div class="cf-note '+noteState+'">'+noteHTML+'</div>'
     + dailyHTML
     + '<div class="cf-cta"><button class="cc-row" onclick="openPersonalExpense()"><span class="cc-ic">'+PIC.plus+'</span><span class="cc-t">Ghi khoản chi riêng tư</span><svg class="cc-chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m9 6 6 6-6 6"/></svg></button></div>'
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
}
function persScrollTx(){ var el=document.getElementById('pers-tx'), sc=document.getElementById('scroll'); if(el&&sc){ var y=Math.max(0, el.getBoundingClientRect().top - sc.getBoundingClientRect().top + sc.scrollTop - 70); sc.scrollTo({top:y,behavior:'smooth'}); } }

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
