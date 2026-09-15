/* ── Cá nhân tab (personal ledger) ──
   Renders window.fhPersonalData() into #v-personal, using the SAME visual system
   and composition as the Finance tab: a focal cash-flow card (Còn lại + In/Out
   tiles + week-over-week chart + note + daily "còn tiêu được" guide) followed by
   section cards. Reuses the finance widget's own helpers (cfWeekChartHTML,
   cfWaterSVG, DG_CLASS, dgKey) so it stays in lockstep with the family version.
   Icons are drawn SVG (app convention); emoji appear only as category marks. */
var PIC = {
  house: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/></svg>',
  lock:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="4.5" y="10.5" width="15" height="10" rx="2.3"/><path d="M8 10.5V7a4 4 0 0 1 8 0v3.5"/></svg>',
  plus:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
  mail:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 5h18v14H3z"/><path d="M3 6l9 7 9-7"/></svg>',
  chev:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m9 6 6 6-6 6"/></svg>',
  chart: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19V9M9 19V5M14 19v-7M19 19v-11"/></svg>',
  list:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/></svg>'
};
var _ccChev='<svg class="cc-chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m9 6 6 6-6 6"/></svg>';
/* ── The eye: per-section stat masking (shoulder-surf guard). Device-local
   like the period choice — which sections a person hides is their business,
   not synced state. Masked = the section's VALUES blur (CSS .sec-masked);
   layout, labels and taps stay, so the tab never reflows. ── */
var PERS_EYE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/></svg>';
var PERS_EYE_OFF = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3l18 18"/><path d="M10.6 6.1A9.7 9.7 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a17.6 17.6 0 0 1-3 3.9M6.4 6.9A17.4 17.4 0 0 0 2.5 12S6 18.5 12 18.5c1.3 0 2.5-.3 3.6-.8"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/></svg>';
function _persMask(){ try{ return JSON.parse(localStorage.getItem('fh-pers-mask')||'{}'); }catch(e){ return {}; } }
window.persMaskIs = function(k){ return !!_persMask()[k]; };
window.persMaskToggle = function(k){
  var m=_persMask(); m[k]=!m[k];
  try{ localStorage.setItem('fh-pers-mask', JSON.stringify(m)); }catch(e){}
  renderPersonal();
};
window.persEyeHTML = function(k){
  var on = persMaskIs(k);
  return '<a class="sec-eye'+(on?' on':'')+'" onclick="persMaskToggle(\''+k+'\')" aria-label="'+(on?'Hiện số':'Ẩn số')+'">'+(on?PERS_EYE_OFF:PERS_EYE)+'</a>';
};
/* LOCAL 'YYYY-MM' — never toISOString() (UTC shifts midnight into the prev month
   in UTC+7, which silently broke the last-month key → daily guide hidden). */
function _pMonKey(d){ return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0'); }

/* Selected scope for the personal view: a 'YYYY-MM' month, or 'all' for the
   whole history. Defaults to the live month — a month is home, "Toàn thời
   gian" is a pick in the month sheet, never the landing. */
try{ window.persSelMon = window.persSelMon || _pMonKey(new Date()); }catch(e){ window.persSelMon = _pMonKey(new Date()); }

/* Distinct months (newest first) carrying any personal txn or income, always
   including the live month even when still empty. The 2-month hydrate cache
   seeds it instantly; once the full-history slice has loaded
   (fhPersonalStatsSlice, 19-personal.js) every month ever logged joins in. */
function persAvailableMonths(){
  var P=window.fhPersonalData?fhPersonalData():null, set={};
  set[_pMonKey(new Date())]=1;
  if(P){
    (P.txns||[]).forEach(function(t){ var k=(t.date||'').slice(0,7); if(k) set[k]=1; });
    (P.incomes||[]).forEach(function(i){ var k=(i.date||'').slice(0,7); if(k) set[k]=1; });
  }
  var SL=window.fhPersonalStatsSliceCached && fhPersonalStatsSliceCached();
  if(SL) SL.rows.forEach(function(r){ var k=(r.date||'').slice(0,7); if(k) set[k]=1; });
  return Object.keys(set).sort().reverse();
}
/* 'YYYY-MM'/'all' → "Thg 8"/"Tất cả" (short, caret) or "Tháng 8, 2026"/"Toàn thời gian" (long, sheet). */
function persMonLabel(key, long){
  if(key==='all') return long ? L('Toàn thời gian','All time') : L('Tất cả','All');
  var p=(key||'').split('-'), mo=(parseInt(p[1],10)||1)-1, yr=p[0]||'';
  return long ? ((isVi()?('Tháng '+(mo+1)):MONA[mo])+', '+yr) : moAbbr(mo);
}
/* Paint the current user's avatar into the header disc (#pers-av). Sourced from
   the FAMILY membersMeta (own member), so it shows regardless of personal-ledger
   lock state; the photo observer decrypts an '.enc' face in place, initials are
   the fallback. */
var _persAvTries = 0, _persAvTimer = null;
function persRenderAvatar(){
  var el=document.getElementById('pers-av'); if(!el) return;
  var mid=window.DB && window.DB.ownerMemberId;
  var m=mid && window.DB.memberById && window.DB.memberById[mid];
  var key=m?(m.is_shared?'Shared':m.name):null;
  var mm=(key && window.membersMeta)?window.membersMeta[key]:null;
  if(!mm){
    /* Family state hasn't hydrated yet — this tab often paints first. Never
       blank a disc that already shows a face; when nothing is showing yet,
       hold the neutral disc and retry briefly so it fills the moment the
       member data lands (nothing else re-renders this tab for it). */
    /* No member face yet (often: no family at all). Initials from the
       signed-in account beat a grey disc that reads as loading. Swapped for
       the member face the moment family data lands, never the other way. */
    if(!el.textContent || el.classList.contains('av-you')){
      var u = window.fhUser, nm = u && ((u.user_metadata && (u.user_metadata.full_name || u.user_metadata.name)) || u.email) || '';
      var parts = String(nm).split('@')[0].trim().split(/[\s._-]+/).filter(Boolean);
      var ini = parts.length ? (parts[0][0] + (parts.length>1 ? parts[parts.length-1][0] : '')).toUpperCase() : '';
      if(ini){ el.className='av av-40 av-you'; el.removeAttribute('style'); el.textContent=ini; }
      else if(!el.textContent){ el.className='av av-40 av-shared'; el.removeAttribute('style'); }
    }
    if(_persAvTries < 12 && !_persAvTimer){
      _persAvTimer = setTimeout(function(){ _persAvTimer=null; _persAvTries++; persRenderAvatar(); }, 500);
    }
    return;
  }
  _persAvTries = 0;
  el.className='av av-40';
  el.setAttribute('style', window.fhAvStyle(mm));
  el.textContent = window.fhAvIni(mm);
}
/* Month-picker sheet body: "Toàn thời gian" on top, then every month with
   data. Sums come from the full-history slice once it has loaded; until then
   the 2-month cache answers for the months it holds. */
window.buildPMonthChoices = function(){
  var box=document.getElementById('pmonth-list'); if(!box) return;
  var P=window.fhPersonalData?fhPersonalData():null, cur=_pMonKey(new Date()), html='';
  var SL=window.fhPersonalStatsSliceCached && fhPersonalStatsSliceCached();
  persEnsureSlice();                       // history not here yet → fetch; this sheet repaints when it lands
  var monSum=function(k){
    var inc=0,out=0;
    if(SL){ SL.rows.forEach(function(r){ if((r.date||'').slice(0,7)!==k) return; if(r.kind==='income') inc+=r.amt; else out+=r.amt; }); }
    else if(P){
      (P.txns||[]).forEach(function(t){ if(t.kind==='expense' && !t._unreadable && (t.date||'').slice(0,7)===k) out+=(t.amt||0); });
      (P.incomes||[]).forEach(function(i){ if(!i._unreadable && (i.date||'').slice(0,7)===k) inc+=(i.amt||0); });
    }
    return {inc:inc,out:out};
  };
  var allSub = SL
    ? (function(){ var i=0,o=0; SL.rows.forEach(function(r){ if(r.kind==='income') i+=r.amt; else o+=r.amt; }); return fmt(i-o)+L(' còn lại',' left'); })()
    : L('Đang tải…','Loading…');
  html+='<button class="qa" onclick="persSelectMonth(\'all\')"><div><div class="qt">'+persMonLabel('all',true)+(window.persSelMon==='all'?'  ✓':'')+'</div>'
    +'<div class="qs">'+allSub+'</div></div></button>';
  persAvailableMonths().forEach(function(k){
    var sel=k===window.persSelMon, sums=monSum(k);
    var sub = k===cur ? L('Đang diễn ra','In progress') : (fmt(sums.inc-sums.out)+L(' còn lại',' left'));
    html+='<button class="qa" onclick="persSelectMonth(\''+k+'\')"><div><div class="qt">'+persMonLabel(k,true)+(sel?'  ✓':'')+'</div>'
      +'<div class="qs">'+sub+'</div></div></button>';
  });
  box.innerHTML=html;
};
window.persSelectMonth = function(k){ window.persSelMon=k; persStripScroll=null; persPinKey=null; closeSheet(); renderPersonal(); };

/* Recent photos of the ACTIVE family, newest first — same unified source the
   Memories tab renders from (buildMemRecords: event memories + expense photos).
   .enc URLs decrypt via the photo observer like everywhere else; a locked or
   not-yet-hydrated family state just yields no photos, never an error. */
function persFamPhotos(){
  try{
    if(typeof buildMemRecords==='function') buildMemRecords();
    var recs=(window.memRecords||[]).filter(function(r){ return r.src; });
    var weekAgo=Date.now()-7*86400000;
    var srcs=recs.slice(0,3).map(function(r){ return r.src; });
    var fresh=recs.filter(function(r){ return r.d && r.d.getTime()>=weekAgo; }).length;
    /* strip shows 3 thumbs; "+N" is the fresh moments beyond those 3, so the
       strip and the "N ảnh mới" subtitle describe the same 7-day window. */
    return { srcs: srcs, fresh: fresh, more: Math.max(0, fresh - srcs.length) };
  }catch(e){ return {srcs:[], fresh:0, more:0}; }
}

/* Loading-state watch: stamps when the loading note first painted, clears when
   any real state lands. The retry goes through fhPersonalRetry — the hard,
   force-unlatching path — because the soft fhPersonalBoot() no-ops while a hung
   attempt still holds the re-entrancy latch (the exact freeze being escaped). */
function persLoadWatchClear(){ window._persLoadT=null; clearTimeout(window._persLoadTimer); }
window.persRetryBoot = function(){
  window._persLoadT = Date.now();
  try{ if(window.fhPersonalRetry) fhPersonalRetry(); else if(window.fhPersonalBoot) fhPersonalBoot(); }catch(e){}
  try{ renderPersonal(); }catch(e){}
};

/* ═══ Activation states (personal-activation-spec) ═══════════════════════════
   The tab used to render the full dashboard with zero data: six empty
   sections, three 0 ₫ figures and a blank chart. Now it reads the ledger and
   picks one of four states:
     1  nothing yet            → one start card (connect email), then "sau đó bạn sẽ thấy"
     2  mail on, queue waiting → the same card, the newest staged row as the top of a
                                 deck; tapping the card opens the review queue
     3  rows exist, setup open → three-step widget above the real dashboard, and the
                                 feature sections' empty states built from the rows
     4  all set (or hidden)    → the dashboard as before, no widget
   Every input is data the app already holds: the hydrated ledger, the staged
   badge count, the mailbox state, anchors, the budget row. Only the "Ẩn" of
   the widget is a stored flag. Vietnamese-only like the rest of the tab. */
var _PI = {
  mail:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="3"/><path d="M3.5 7.5 12 13l8.5-5.5"/></svg>',
  list:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round"><path d="M8 6h12M8 12h12M8 18h12"/><circle cx="4" cy="6" r="1" fill="currentColor"/><circle cx="4" cy="12" r="1" fill="currentColor"/><circle cx="4" cy="18" r="1" fill="currentColor"/></svg>',
  bars:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round"><path d="M5 20V10M12 20V4M19 20v-7"/></svg>',
  card:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3" y="6" width="18" height="12" rx="3"/><path d="M3 10h18"/></svg>',
  trend:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><path d="M4 17l5-6 4 3 7-8"/><path d="M15 6h5v5"/></svg>',
  flame:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3c1 4 5 5.5 5 10a5 5 0 0 1-10 0c0-2 1-3.5 2-4.5 0 2 1 3 2 3 0-3 0-6 1-8.5z"/></svg>',
  lock:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round"><rect x="5" y="11" width="14" height="10" rx="2.5"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>',
  check:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7"/></svg>'
};
var _persMail = null, _persMailAt = 0, _persMailBusy = false;
/* both transports, like fhEmailTxnCta: either one means "mail is on" */
function _persMailKey(){ var P = window.fhPersonalData ? fhPersonalData() : null; return 'fh-pers-mail:' + (P && P.uid || ''); }
/* last answer, remembered on the device: a returning user must not see the
   start card for the half second the probe takes (the state 1 → 2 flash) */
function persMailSeed(){
  if(_persMail) return;
  try{ var v = JSON.parse(localStorage.getItem(_persMailKey()) || 'null'); if(v && typeof v==='object') _persMail = { fwd: !!v.fwd, oauth: !!v.oauth }; }catch(e){}
}
var _persActLast = 0;
window.persActState = function(){ return _persActLast; };
function persMailProbe(){
  if(_persMailBusy || (Date.now() - _persMailAt) < 60000) return;
  _persMailBusy = true;
  var fwd=false, oauth=false;
  Promise.all([
    (async function(){ try{ var st = window.fhMailboxState ? await fhMailboxState() : null; fwd = !!(st && st.forwarding_alias); }catch(e){} })(),
    (async function(){ try{ var c = window.fhAutoTxnConnection ? await fhAutoTxnConnection() : null; oauth = !!c; }catch(e){} })()
  ]).then(function(){
    var next = { fwd: fwd, oauth: oauth };
    var changed = !_persMail || _persMail.fwd !== fwd || _persMail.oauth !== oauth;
    _persMail = next; _persMailAt = Date.now(); _persMailBusy = false;
    try{ localStorage.setItem(_persMailKey(), JSON.stringify(next)); }catch(e){}
    if(changed) try{ renderPersonal(); }catch(e){}
  });
}
function persSetupHiddenKey(P){ return 'fh-pers-setup-hide:' + (P && P.uid || ''); }
function persSetupHidden(P){ try{ return localStorage.getItem(persSetupHiddenKey(P)) === '1'; }catch(e){ return false; } }
window.persSetupHide = function(){
  var P = window.fhPersonalData ? fhPersonalData() : null;
  try{ localStorage.setItem(persSetupHiddenKey(P), '1'); }catch(e){}
  renderPersonal();
};
/* the three steps, each derived from live data */
function persSetupSteps(P){
  var accts = (P.accounts||[]).filter(function(a){ return a.kind!=='investment'; });
  var need = accts.filter(function(a){ return a.anchorK==null && !a.setupSkippedAt; });
  var nm = function(a){ return a.name || (a.provider ? String(a.provider).toUpperCase() : 'Tài khoản') + (a.tail ? ' ••'+a.tail : ''); };
  var s2 = accts.length>0 && need.length===0;
  return [
    { n:1, done:true, t:'Có khoản đầu tiên', s:'Sổ đã có giao dịch', act:'expense' },
    { n:2, done:s2, t:'Cài đặt tài khoản, thẻ', act:'acct', needIds: need.map(function(a){ return a.id; }),
      s: accts.length ? (need.length ? need.slice(0,3).map(nm).join(', ') + (need.length>3 ? ' và '+(need.length-3)+' nữa' : '') : 'Đã chốt số dư')
                      : 'Kết nối email để app nhận diện tài khoản' },
    { n:3, done:P.budget>0, t:'Lập ngân sách tháng', s:'Biết mỗi ngày còn tiêu được bao nhiêu', act:'budget' }
  ];
}
window.persStepTap = function(act){
  var P = window.fhPersonalData ? fhPersonalData() : null; if(!P) return;
  if(act==='expense'){ if(typeof openPersonalExpense==='function') openPersonalExpense(); return; }
  if(act==='budget'){ if(typeof openPersonalBudget==='function') openPersonalBudget(); return; }
  if(act==='acct'){
    var st = persSetupSteps(P)[1];
    if(st.needIds.length && window.fhAcctSetupWizard){ fhAcctSetupWizard(st.needIds, { intro: true }); return; }
    if(window.fhEmailTxnCta) fhEmailTxnCta({ scope:'personal' });
  }
};
function persActivation(P, SL){
  var hasTx = (P.txns||[]).length>0 || (P.debts||[]).length>0 || (P.unreadable||0)>0
    || !!(SL && SL.rows && SL.rows.length) || ((P.txnsOld||[]).length>0);
  var queue = window.fhStagedCount||0;
  if(!hasTx){
    persMailSeed(); persMailProbe();
    var mailOn = !!(_persMail && (_persMail.fwd || _persMail.oauth));
    _persActLast = (queue>0 || mailOn) ? 2 : 1;
    return { state: _persActLast, queue: queue, mail: _persMail };
  }
  var steps = persSetupSteps(P);
  var open = steps.filter(function(x){ return !x.done; });
  _persActLast = (!open.length || persSetupHidden(P)) ? 4 : 3;
  return { state: _persActLast, steps: steps, open: open, queue: queue };
}
/* state 1 + 2: the one card */
function persActCard(act, mon){
  var link = '<button class="ob-textlink pact-link" onclick="openPersonalExpense()">Hoặc ghi tay một khoản</button>';
  /* the one line that earns the Gmail tap: what is read, who can see it, how long */
  var trust = '<div class="pact-trust">'+_PI.lock+'<div><b>Chỉ đọc email báo giao dịch từ ngân hàng.</b> Không ai khác xem được, kể cả gia đình. Khoảng 1 phút.</div></div>';
  if(act.state===1){
    return '<section class="cf-card"><div class="cf-lbl">Sổ cá nhân</div><div class="pact-h">Bắt đầu sổ của bạn</div>'
      + '<p class="pact-p">Kết nối email ngân hàng, app tự ghi lại vài tháng giao dịch gần nhất. Bạn chỉ duyệt, không nhập tay.</p>'
      + '<button class="cta pact-cta" onclick="fhEmailTxnCta({scope:\'personal\'})">'+_PI.mail+'Kết nối email ngân hàng</button>'+trust+link+'</section>';
  }
  var rx = (typeof window.fhReauthState==='function') ? fhReauthState() : null;
  var pg = (typeof window.fhBackfillProgress==='function') ? fhBackfillProgress() : null;
  if(rx){
    return '<section class="cf-card"><div class="cf-lbl">Email ngân hàng</div><div class="pact-h">Kết nối email cần làm mới</div>'
      + '<p class="pact-p">Ngân hàng vẫn gửi email, nhưng app không đọc được nữa cho tới khi bạn kết nối lại.</p>'
      + '<button class="cta pact-cta" onclick="fhEmailTxnCta({scope:\'personal\'})">'+_PI.mail+'Làm mới kết nối</button>'+link+'</section>';
  }
  if(!act.queue && pg && pg.phase==='reading'){
    var pct = pg.windowDays>0 ? Math.min(100, Math.round(pg.daysRead/pg.windowDays*100)) : 0;
    return '<section class="cf-card"><div class="cf-lbl">Email ngân hàng · đang đọc</div><div class="pact-h">Đang dò hộp thư của bạn</div>'
      + '<p class="pact-p">'+(pg.front ? 'Đã đọc tới '+esc(fmtDayMon(new Date(pg.front)))+'. ' : '')+'Xong là mọi khoản tìm thấy về đây để bạn duyệt.</p>'
      + '<span class="cc-prog" style="margin-top:14px"><i style="width:'+pct+'%"></i></span>'
      + '<button class="ob-textlink pact-link" onclick="fhEmailTxnCta({scope:\'personal\'})">Xem tiến độ</button></section>';
  }
  if(!act.queue){
    return '<section class="cf-card"><div class="cf-lbl">Email ngân hàng · đã kết nối</div><div class="pact-h">Chưa thấy giao dịch nào trong email</div>'
      + '<p class="pact-p">Khi ngân hàng gửi email báo giao dịch, khoản sẽ tự về đây để bạn duyệt.</p>'
      + '<button class="cta pact-cta" onclick="openPersonalExpense()">Ghi tay một khoản</button>'
      + '<button class="ob-textlink pact-link m" onclick="fhEmailTxnCta({scope:\'personal\'})">Kiểm tra kết nối</button></section>';
  }
  var n = act.queue;
  return '<section class="cf-card"><div class="cf-lbl">Email ngân hàng · đã đọc xong</div><div class="pact-h">'+n+' khoản đang chờ bạn duyệt</div>'
    + persQueueDeckHTML(n)
    + '<button class="cta pact-cta" onclick="fhEmailTxnCta({scope:\'personal\'})">'+_PI.list+'Kiểm tra '+n+' giao dịch</button>'+link+'</section>';
}
/* The queue as a deck: the newest staged row on top (two lines, read-only,
   the tap opens the review queue), two blank cards behind. Shared by the
   state 2 card and the standalone widget below. */
function persQueueDeckHTML(n){
  var pk = window.fhStagedPeekCached ? fhStagedPeekCached() : null;
  if(window.fhStagedPeek && (!pk || window._persPeekFor !== n)){
    window._persPeekFor = n;
    fhStagedPeek(n).then(function(){ try{ renderPersonal(); }catch(e){} });
  }
  var top;
  if(pk && pk.id && !pk.foreign){
    var mult = (typeof curMult==='function') ? curMult() : 1000;
    var pos = pk.flow==='income';
    var amt = fmt(pk.amount/mult);
    var when = (pk.dateIso ? pk.dateIso.slice(8,10)+'/'+pk.dateIso.slice(5,7) : '') + (pk.time ? ' · '+pk.time : '');
    var prov = pk.provider ? ((typeof window.fhProviderName==='function' && fhProviderName(pk.provider)) || String(pk.provider).toUpperCase()) : '';
    var src = prov + (pk.tail ? ' ••'+pk.tail : '');
    top = '<button class="pq-card" onclick="fhEmailTxnCta({scope:\'personal\'})">'
      + '<div class="pq-line"><div class="pq-name"><span class="pq-emo">'+(pk.emoji||'🗂️')+'</span>'+esc(pk.desc || (pos?'Tiền vào':'Giao dịch'))+'</div>'
      + '<div class="pq-amt'+(pos?' pos':'')+'">'+(pos?'+':'−')+amt+'</div></div>'
      + '<div class="pq-meta"><span>'+esc(when)+'</span><span>'+esc(src)+'</span></div></button>';
  } else {
    top = '<button class="pq-card" aria-label="Mở hàng chờ duyệt" onclick="fhEmailTxnCta({scope:\'personal\'})"><div class="pq-line"><span class="pq-sk" style="width:52%"></span><span class="pq-sk" style="width:24%"></span></div>'
      + '<div class="pq-meta"><span class="pq-sk" style="width:30%;height:10px"></span><span class="pq-sk" style="width:22%;height:10px"></span></div></button>';
  }
  return '<div class="pq-deck">'+top+'<i class="k2"></i><i class="k3"></i></div>';
}
/* States 3 and 4: the same deck as a standalone card whenever rows are
   waiting, right under the first widget. The review door people already
   learned in state 2 stays where they learned it. "Kiểm tra N giao dịch":
   a check, not a chore. Hidden while a first read
   is still running (the queue is held then) and while the grant is dead (the
   email row carries that warning); the tinted button is a secondary action,
   the screen's one primary stays with the dashboard. */
function persQueueWidgetHTML(act){
  var n = act.queue || 0; if(!n) return '';
  if(typeof window.fhBackfillHolds==='function' && fhBackfillHolds()) return '';
  if(typeof window.fhReauthState==='function' && fhReauthState()) return '';
  return '<section class="cf-card pq-widget"><div class="cf-lbl">Email ngân hàng</div><div class="pact-h sm">'+n+' khoản đang chờ bạn duyệt</div>'
    + persQueueDeckHTML(n)
    + '<div class="dbt-empty-cta"><button onclick="fhEmailTxnCta({scope:\'personal\'})">Kiểm tra '+n+' giao dịch</button></div></section>';
}
function persWillSeeHTML(){
  var row = function(ic, t, s2){ return '<div class="row"><div class="r-ico personal-ico">'+ic+'</div><div class="r-body"><div class="r-t">'+t+'</div><div class="r-s">'+s2+'</div></div></div>'; };
  return '<div class="section-h"><span class="t">Sau đó bạn sẽ thấy</span></div><div class="rows pact-rows">'
    + row(_PI.bars, 'Tiền đi đâu mỗi tháng', 'Theo danh mục, theo tuần')
    + row(_PI.card, 'Thẻ tín dụng và khoản nợ', 'Đang nợ bao nhiêu, đến hạn khi nào')
    + row(_PI.trend, 'Đầu tư', 'Crypto, vàng, chứng khoán')
    + row(_PI.flame, 'Chuỗi thói quen', '7 ngày không Grab, app tự đếm')
    + '</div>';
}
/* state 3: the widget, remaining steps only */
function persSetupWidgetHTML(act){
  var done = act.steps.filter(function(x){ return x.done; }).length;
  var h = '<section class="cf-card psu-card"><div class="cf-lblrow"><div class="cf-lbl">Thiết lập · '+done+' / 3</div><button class="psu-hide" onclick="persSetupHide()">Ẩn</button></div>'
    + '<div class="psu-segs">'+act.steps.map(function(x){ return '<i class="'+(x.done?'on':'')+'"></i>'; }).join('')+'</div><div class="psu-steps">';
  act.open.forEach(function(x, i){
    h += '<button class="psu-step'+(i===0?' now':'')+'" onclick="persStepTap(\''+x.act+'\')"><div class="psu-ring">'+x.n+'</div>'
      + '<div class="psu-b"><div class="psu-t">'+x.t+'</div><div class="psu-s">'+esc(x.s)+'</div></div>'+_ccChev+'</button>';
  });
  return h + '</div></section>';
}
/* The one empty-state card every section on this tab uses (mockups/
   personal-empty-states.html, E3): a mark, a question with a verb, one line
   of why, and the tinted action row the debts card already had; the first
   button is filled brand so the invitation is unmistakable. Centered, like
   the streak card was. `btns`: [{t, on, pri}], `on` is the inline onclick. */
window.fhEmptyCard = function(o){
  var b = (o.btns||[]).map(function(x, i){ return '<button class="'+(x.pri || (i===0 && x.pri!==false) ? 'pri' : '')+'" onclick="'+x.on+'">'+x.t+'</button>'; }).join('');
  return '<section class="emp">'+(o.e ? '<div class="emp-mark">'+o.e+'</div>' : '')
    + '<div class="emp-t">'+o.t+'</div>'+(o.s ? '<div class="emp-s">'+o.s+'</div>' : '')
    + (b ? '<div class="dbt-empty-cta">'+b+'</div>' : '')+'</section>';
};
/* state 3: empty states that name something from the person's own rows */
function _persMonRows(P, mon){
  return (P.txns||[]).filter(function(t){ return (t.date||'').slice(0,7)===mon && t.kind==='expense' && !t._unreadable && !t.spaceId; });
}
function _persFold(s2){ return String(s2||'').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/đ/g,'d'); }
function persStreakDriven(P, mon){
  var base = window.persStreakSection ? persStreakSection() : '';
  var cnt = window.fhStreakDefsCount ? fhStreakDefsCount() : null;
  if(cnt !== 0) return base;
  var seen = {};
  _persMonRows(P, mon).forEach(function(t){
    var w = _persFold(t.note).replace(/[^a-z ]/g,' ').trim().split(/\s+/)[0] || '';
    if(w.length<3) return;
    var g = seen[w] || (seen[w] = { n:0, sum:0, label:(t.note||'').trim().split(/\s+/)[0] });
    g.n++; g.sum += (t.amt||0);
  });
  var top = Object.keys(seen).map(function(k){ return seen[k]; }).sort(function(a,b){ return b.n-a.n; })[0];
  if(!top || top.n<3) return base;
  var lab = esc(top.label);
  return '<div class="section-h"><span class="t">Chuỗi thói quen</span><span class="acts"><a onclick="fhStreakNewSheet()">＋ Thêm</a></span></div>'
    + fhEmptyCard({ e:'🎯', t: lab+' '+top.n+' lần tháng này, '+fmt(top.sum), s: 'Thử 7 ngày không '+lab+'? App tự đếm từ sổ của bạn.',
        btns: [{ t:'Bắt đầu chuỗi 7 ngày', on:'fhStreakNewSheet()' }] });
}
var _PERS_INV_RE = /binance|okx|bybit|mexc|remitano|coinbase|kucoin|huobi|gate ?io|usdt|\bbtc\b|\beth\b|\bsjc\b|\bpnj\b|\bdoji\b|\bvang\b|chung khoan|vndirect|tcbs|\bssi\b|\bvps\b|fmarket|dragon capital|\bccq\b/;
function persInvestDriven(P, mon){
  var base = window.persInvestSection ? persInvestSection() : '';
  var v = window.fhInvPositions ? fhInvPositions() : null;
  if(!v || (v.positions||[]).length) return base;
  var hits = _persMonRows(P, mon).filter(function(t){ return _PERS_INV_RE.test(_persFold(t.note)); });
  if(!hits.length) return base;
  var sum = hits.reduce(function(a,t){ return a+(t.amt||0); },0);
  return '<div class="section-h"><span class="tl"><span class="t">Đầu tư</span>'+persEyeHTML('invest')+'</span><span class="acts"><a onclick="fhInvNewPositionSheet()">＋ Vị thế</a></span></div>'
    + fhEmptyCard({ e:'📈', t: hits.length+' khoản có thể là đầu tư tháng này', s: 'Nếu là mua coin, vàng hay cổ phiếu, chuyển thành đầu tư để '+fmt(sum)+' không bị tính là chi tiêu.',
        btns: [{ t:'Xem khoản', on:"openPersonalTxDetail('"+hits[0].id+"')" }, { t:'Thêm vị thế', on:'fhInvNewPositionSheet()' }] });
}
/* shared paint: skip the innerHTML swap when nothing changed (flicker) */
function _persCommit(host, h, isCur, full){
  if(h === window._persLastHTML){
    if(full){ persChartAfterRender(isCur); if(window.persDebtAfterRender) persDebtAfterRender(); }
    return;
  }
  window._persLastHTML = h;
  window._persHadReady = true;
  host.innerHTML = h;
  if(!full) return;
  persChartAfterRender(isCur);   // strip scroll + auto label + (current month) guide & sync note
  if(window.persDebtAfterRender) persDebtAfterRender();   // async space balances → section refreshes in place
  if(window.persInvestAfterRender) persInvestAfterRender();   // throttled price refresh → bento redraws in place
}
function renderPersonal(){
  var host = document.getElementById('pers-body'); if(!host) return;
  persRenderAvatar();     // header disc — independent of personal-ledger state
  var P = window.fhPersonalData ? fhPersonalData() : null;
  // The data module hasn't loaded yet (this is now the landing tab, painted at
  // parse-time boot) — show the same preparing note the boot states use, never a blank.
  if(!P){ host.innerHTML = '<div class="empty-note">Đang chuẩn bị sổ cá nhân của bạn…</div>'; return; }

  if(P.state==='provisioning' || P.state==='boot' || P.state==='loading'){
    /* Every write and mirror pass re-hydrates through 'loading'. With a ready
       view already on screen, keep it — the fresh numbers repaint quietly in a
       moment; flashing a note over good data reads as the tab breaking. */
    if(P.state==='loading' && window._persHadReady){ persLoadWatchClear(); return; }
    window._persLastHTML='';
    /* A loading note with no exit was the freeze: if a request stalls, this
       screen used to be terminal. After 8s the note grows a "Thử lại" that goes
       through the hard retry (fhPersonalRetry force-unlatches the boot guard). */
    if(!window._persLoadT) window._persLoadT = Date.now();
    var _waited = (Date.now() - window._persLoadT) > 8000;
    host.innerHTML = '<div class="empty-note">Đang chuẩn bị sổ cá nhân của bạn…'
      + (_waited ? '<br><a class="pers-link" onclick="persRetryBoot()">Mạng chậm? Thử lại</a>' : '') + '</div>';
    if(!_waited){
      clearTimeout(window._persLoadTimer);
      window._persLoadTimer = setTimeout(function(){ try{ renderPersonal(); }catch(e){} }, 8200);
    }
    return;
  }
  persLoadWatchClear();
  if(P.state==='error'){
    window._persHadReady=false; window._persLastHTML='';
    host.innerHTML = '<div class="empty-note">Chưa tải được sổ cá nhân. <a class="pers-link" onclick="persRetryBoot()">Thử lại</a></div>'; return;
  }
  if(P.state==='locked'){
    window._persHadReady=false; window._persLastHTML='';
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
  var curMon = _pMonKey(new Date());
  var avail = persAvailableMonths();
  if(window.persSelMon!=='all' && avail.indexOf(window.persSelMon)<0) window.persSelMon = curMon;   // stale pick (data changed) → snap to live
  var mon = window.persSelMon, isAll = (mon==='all'), isCur = (mon===curMon);
  var lastMon = (function(){ var d=new Date(); d.setDate(1); d.setMonth(d.getMonth()-1); return _pMonKey(d); })();
  var inWin = !isAll && (mon===curMon || mon===lastMon);   // the 2-month hydrate cache covers it
  var SL = window.fhPersonalStatsSliceCached && fhPersonalStatsSliceCached();
  /* Anything past the cache needs the full-history slice: all-time, an older
     month, or the months timeline (Tháng zoom). Kick the fetch; everything
     below degrades to a quiet loading note until it lands. */
  if(isAll || !inWin || persZoom()==='month') persEnsureSlice();
  var slReady = inWin || !!SL;
  /* activation (spec): states 1 and 2 replace the dashboard with one card */
  var act = persActivation(P, SL);
  if(act.state<=2){
    if(!SL) persEnsureSlice();   // rows older than the 2-month cache still count as "has transactions"
    _persCommit(host, persActCard(act, mon) + persWillSeeHTML(), isCur, false);
    return;
  }
  /* _unreadable rows are EXCLUDED from every total rather than counted as 0.
     `t.amt||0` used to fold a row we could not decrypt into the month at zero,
     so a wrong key understated spending instead of saying so (19-personal).
     Everything downstream derives from txM — the category card and the space
     roll-up included — so they are covered by this one filter. */
  var txM, out, inc;
  if(inWin){
    txM = P.txns.filter(function(t){ return (t.date||'').slice(0,7)===mon && t.kind==='expense' && !t._unreadable; });
    out = txM.reduce(function(s,t){ return s+(t.amt||0); },0);
    inc = P.incomes.filter(function(i){ return (i.date||'').slice(0,7)===mon && !i._unreadable; }).reduce(function(s,i){ return s+(i.amt||0); },0);
  } else {
    /* All-time or an older month: the slice is the book. Unreadable amounts
       were excluded at decrypt and counted — the banner by the list says so. */
    var slRows = SL ? SL.rows.filter(function(r){ return isAll || (r.date||'').slice(0,7)===mon; }) : [];
    txM = slRows.filter(function(r){ return r.kind==='expense'; });
    out = txM.reduce(function(s,t){ return s+(t.amt||0); },0);
    inc = slRows.reduce(function(s,r){ return s+(r.kind==='income'?r.amt:0); },0);
  }
  /* Lending flow (0122, spec Q5): a loan out is NOT consumption — it stays out
     of "Ra" and every category stat — but it IS cash gone. "Còn lại" claims to
     be money you can still spend this month, so it must feel the loan leave
     (and a repayment received come back). Current-window months only: the
     all-time stats slice deliberately carries expense/income alone. */
  var lendCash = 0;
  if(inWin){
    P.txns.forEach(function(t){
      if((t.date||'').slice(0,7)!==mon || t._unreadable) return;
      if(t.kind==='loan') lendCash -= (t.amt||0);
      else if(t.kind==='repayment') lendCash += (t.amt||0);
    });
  }
  /* Investment flow (0123, spec I6/I8): a buy is NOT consumption — it stays
     out of "Ra" and every category stat — but the cash genuinely left the
     spendable pool, so "Còn lại" must feel it (and a sell's proceeds come
     back). Same shape as the lending dent above; amounts carry their sign
     inside the row (buy −X, sell +X). Current-window months only. */
  var invOut = 0, invIn = 0;
  if(inWin){
    P.txns.forEach(function(t){
      if((t.date||'').slice(0,7)!==mon || t._unreadable || t.kind!=='investment') return;
      if((t.amt||0) < 0) invOut += -(t.amt||0); else invIn += (t.amt||0);
    });
  }
  var invCash = invIn - invOut;
  var left = inc-out+lendCash+invCash;
  /* Active family's real name comes from FAM (hydrate); P.fams was never
     populated, so without this the card said a faceless "Nhóm". */
  var famName = function(fid){
    if(window.DB && DB.fid===fid && window.FAM && FAM.familyName) return FAM.familyName;
    var f=(P.fams||[]).find(function(x){return x.family_id===fid;}); return f? f.name : 'Nhóm';
  };

  /* Scope caret — always shown: "Toàn thời gian" exists from day one, so
     there are always at least two choices in the sheet. */
  var moCaret = '<button class="pers-mp" onclick="openSheet(\'sheet-pmonth\')">'+persMonLabel(mon,false)
      + '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6"><path d="M6 9l6 6 6-6"/></svg></button>';
  var cfLbl = 'Còn lại · cá nhân';

  var h = act.state===3 ? persSetupWidgetHTML(act) + persQueueWidgetHTML(act) : '';
  h += '<section class="cf-card'+(persMaskIs('cf')?' sec-masked':'')+'">'
     + '<div class="cf-lblrow"><span class="tl"><div class="cf-lbl">'+cfLbl+'</div>'+persEyeHTML('cf')+'</span>'+moCaret+'</div>'
     + '<div class="cf-big num'+(left<0&&slReady?' neg':'')+'">'+(slReady?fmt(left):'…')+'</div>'
     + '<div class="cf-tiles">'
     +   '<button class="cf-tile" onclick="fhIncome(\'personal\')"><span class="cf-tl"><span class="cf-ar up">↑</span> Vào</span><span class="cf-tv num">'+(slReady?fmt(inc):'…')+'</span></button>'
     +   '<button class="cf-tile" onclick="persScrollTx()"><span class="cf-tl"><span class="cf-ar dn">↓</span> Ra</span><span class="cf-tv num">'+(slReady?fmt(out):'…')+'</span></button>'
     + '</div>'
     /* the loan's dent in Còn lại, said out loud — the tiles above don't carry
        it (Ra is consumption only), so without this line the math looks off */
     + (slReady && Math.round(Math.abs(lendCash))>=1
         ? '<div class="cf-lend num">🤝 Cho vay & trả nợ riêng: '+(lendCash>0?'+':'')+fmt(lendCash)+'</div>' : '')
     /* the buy's dent, said out loud the same way — not spent, not available */
     + (slReady && (Math.round(invOut)>=1 || Math.round(invIn)>=1)
         ? '<div class="cf-lend num">📈 '
           + (Math.round(invOut)>=1 ? 'Đầu tư tháng này: −'+fmt(invOut) : '')
           + (Math.round(invOut)>=1 && Math.round(invIn)>=1 ? ' · ' : '')
           + (Math.round(invIn)>=1 ? 'Rút đầu tư: +'+fmt(invIn) : '')
           + '</div>' : '')
     /* One chart for every scope: the pannable stacked Thu/Chi strip with its
        zoom row. The note + guide stay current-month only — the guide's whole
        job is today, and an old month (or all of history) has none. */
     + '<div class="pz" id="pcf-zoom">'+persZoomRowHTML()+'</div>'
     + persStripHTML(P, SL, mon, isAll, inWin)
     + (isCur ? ('<div class="cf-note" id="pcf-note"></div>'
               + '<div class="cf-daily" id="pcf-daily" style="display:none"></div>') : '')
     /* "Hẹn trả" heads-up (0122, spec Q19ii): fires on the due day and stays
        while overdue, gone the moment the balance clears. Today only — an old
        month has no "today" (same rule as the guide above). */
     + (isCur ? (function(){
         if(!window.fhPersonalDebts || !window.persDebtDueInfo) return '';
         var _n=new Date(), _tiso=_n.getFullYear()+'-'+String(_n.getMonth()+1).padStart(2,'0')+'-'+String(_n.getDate()).padStart(2,'0');
         var lines='';
         (fhPersonalDebts().people||[]).forEach(function(p){
           var dd=persDebtDueInfo(p);
           if(!dd || !(dd.overdue || dd.due===_tiso)) return;
           lines+='<div class="cf-duealert">⏰ '+esc(p.who)+' hẹn trả <b class="num">'+fmt(p.balance)+'</b>'
             +(dd.overdue?' — quá hẹn '+dd.days+' ngày':' — hôm nay')+'</div>';
         });
         return lines;
       })() : '')
     + '<div class="cf-cta">'
     +   '<button class="cc-row" onclick="openPersonalBudget()"><span class="cc-ic">'+PIC.chart+'</span><span class="cc-t">'+(P.budget>0?'Ngân sách cá nhân':'Lập ngân sách cá nhân')+'</span>'+_ccChev+'</button>'
     +   '<button class="cc-row" onclick="openTxns(\'personal\')"><span class="cc-ic">'+PIC.list+'</span><span class="cc-t">Xem giao dịch</span>'+_ccChev+'</button>'
     +   '<button class="cc-row" onclick="openPersonalExpense()"><span class="cc-ic">'+PIC.plus+'</span><span class="cc-t">Ghi giao dịch</span>'+_ccChev+'</button>'
     /* Fourth row of the SAME list, not a card of its own — it is one of the
        things you can do from here, and floating it outside the card made it
        read as a stray. Last on purpose: the three above are what you do with
        the ledger; this is where transactions come IN from.

        Opening from this tab presets the review screen's destination to
        personal, exactly as openPersonalExpense() above presets the expense
        modal. Badge off the same window.fhStagedCount Widget A reads. */
     +   _persEmailRow()
     + '</div>'
     + '</section>';

  /* The Cá nhân copy of Widget A's email row. It was a hardcoded duplicate, which
   is how it missed the first-read progress entirely: renderCashflowEmailCta
   grew a held state and this one kept printing a bare count. Same three states,
   same reasons (see renderCashflowEmailCta in 20-budget.js) — while a first
   read is running the badge is a FRACTION, not a count, because a count is a
   summons at the moment acting on it is unsafe. Kept as its own function rather
   than shared markup because this row carries the personal entry scope. */
function _persEmailRow(){
  var n=window.fhStagedCount||0;
  var p=(typeof window.fhBackfillProgress==='function') ? window.fhBackfillProgress() : null;
  var reading=!!(p && p.phase==='reading');
  /* A DEAD CONNECTION OUTRANKS PROGRESS — there is nothing to be making
     progress on. This is the surface that survives "Nhắc tôi sau", so it is not
     dismissible and carries no count: a number here would read as work waiting,
     when the truth is that nothing is arriving at all. */
  var rx=(typeof window.fhReauthState==='function') ? window.fhReauthState() : null;
  var rxGap = (rx && rx.since) ? fmtGap(Date.now()-Date.parse(rx.since)) : '';
  var ic=PIC.mail, badge, sub='', prog='', warn=false;
  if(rx){
    warn=true;
    badge='<span class="cc-badge warn">!</span>';
    sub='<span class="cc-sub warn">'+esc(rxGap
      ? L('Ngắt kết nối '+rxGap+' · cần làm mới','Disconnected '+rxGap+' · needs refreshing')
      : L('Cần làm mới kết nối','Connection needs refreshing'))+'</span>';
  } else if(reading){
    badge='<span class="cc-badge run"><span class="cc-dot"></span>'+p.daysRead+'/'+p.windowDays+'</span>';
    sub='<span class="cc-sub">'+esc(p.front
      ? L('Đang đọc… đã tới '+fmtDayMon(new Date(p.front))+' · '+n+' khoản',
          'Reading… back to '+fmtDayMon(new Date(p.front))+' · '+n+' found')
      : L('Đang dò hộp thư của bạn…','Looking through your mailbox…'))+'</span>';
    var pct=p.windowDays>0 ? Math.min(100,Math.round(p.daysRead/p.windowDays*100)) : 0;
    prog='<span class="cc-prog"><i style="width:'+pct+'%"></i></span>';
  } else {
    badge = n>0 ? '<span class="cc-badge num">'+n+'</span>' : '';
  }
  return '<button class="cc-row" onclick="fhEmailTxnCta({scope:\'personal\'})">'
    +'<span class="'+(warn?'cc-ic warn':(reading?'cc-ic run':'cc-ic'))+'">'+ic+'</span>'
    +'<span class="cc-t">'+L('Khoản thu chi từ email','Income & expenses from email')+sub+prog+'</span>'
    +badge+_ccChev+'</button>';
}

/* ── Chuỗi thói quen — no-spend streaks (0132), the behaviour dimension.
     Built by 27-streaks.js (js-data); counts derive from the ledger + the
     email review queue, so this section may re-render itself once the async
     compute lands. ── */
  if(act.state===4) h += persQueueWidgetHTML(act);   // right under the first widget
  h += act.state===3 ? persStreakDriven(P, mon) : (window.persStreakSection ? persStreakSection() : '');

/* ── Nợ & cho vay — the balance-sheet dimension (stocks, not flows), between
     the month's cash-flow card and the month's spending cards. Built by
     23-debts-ui.js (js-data) so it can share the modal helper + space keys. ── */
  h += (window.persDebtSection ? persDebtSection() : '');

  /* ── Đầu tư — the asset dimension, the debts bento's sibling (0123). Built
     by 26-investment-ui.js (js-data) for the same modal-helper reason. ── */
  h += act.state===3 ? persInvestDriven(P, mon) : (window.persInvestSection ? persInvestSection() : '');

  /* ── Tiền đi đâu tháng này — one card per space, that space's categories
     nested inside (the old "Các nhóm của tôi" roll-up and the separate
     "Chi theo danh mục" card were two cuts of the same money with no visual
     thread between them; here the space is the unit and the category split
     lives inside it). Photos are the active family's recent moments — that
     state is already hydrated and decrypted when this tab is usable. ── */
  var bySpace = {}, catBySpace = {};
  txM.forEach(function(t){ var k=t.spaceId||'_p'; bySpace[k]=(bySpace[k]||0)+(t.amt||0);
    var cats=catBySpace[k]||(catBySpace[k]={}), ck=(t.cat||'Khác');
    if(!cats[ck]) cats[ck]={name:ck, emoji:t.emoji||'🗂️', v:0};
    cats[ck].v+=(t.amt||0);
  });
  var spKeys = Object.keys(bySpace).filter(function(k){ return k!=='_p'; });
  function pspCatRows(cats){
    var rows=Object.keys(cats||{}).map(function(k){return cats[k];}).sort(function(a,b){return b.v-a.v;});
    return rows.map(function(c){
      return '<div class="psp-mini"><span class="psp-mico">'+(c.emoji||'🗂️')+'</span><span class="psp-mname">'+esc(c.name||'Khác')+'</span><span class="psp-mval num">'+fmt(c.v)+'</span></div>';
    }).join('');
  }
  /* A family space wears a Wallet-style gradient "pass" (its identity band);
     photos + the subtitle come from the ACTIVE family only — that is the one
     whose moments are in local state. Non-active spaces get the same pass sans
     photos. Riêng tư is intentionally NOT a pass; it stays a quiet white card. */
  var ph = persFamPhotos();
  var phStrip = ph.srcs.length
    ? '<div class="psp-pass-ph">'+ph.srcs.map(function(src){ return '<span class="psp-thumb" style="background-image:url('+src+')"></span>'; }).join('')
      + (ph.more>0 ? '<span class="psp-pass-more num">+'+ph.more+'</span>' : '')+'</div>'
    : '';
  var actSub = ph.fresh ? '<b>'+ph.fresh+' ảnh mới</b>' : (ph.srcs.length ? 'Khoảnh khắc gần đây' : 'Nhóm của bạn');
  function passHead(name, sub, amt, strip){
    return '<div class="psp-pass"><div class="psp-pass-r1">'
      + '<div class="psp-pass-bd"><div class="psp-pass-t">'+esc(name)+'</div><div class="psp-pass-s">'+sub+'</div></div>'
      + (amt!=null ? '<div class="psp-pass-r"><div class="psp-pass-amt num">'+fmt(amt)+'</div><div class="psp-pass-al">bạn đã góp</div></div>' : '')
      + '</div>'+(strip||'')+'</div>';
  }
  h += '<div class="section-h" id="pers-cats"><span class="tl"><span class="t">'+(isAll?'Tiền đi đâu':'Tiền đi đâu tháng này')+'</span>'+persEyeHTML('cats')+'</span>'
     + '<span class="acts"><a onclick="openPersonalBudget()">'+(P.budget>0?'Ngân sách':'Lập ngân sách')+'</a></span></div>';
  h += '<div id="pers-cats-wrap"'+(persMaskIs('cats')?' class="sec-masked"':'')+'>';
  if(!slReady){
    h += '<section class="psp-card"><div class="empty-note">Đang tải lịch sử chi tiêu…</div></section>';
  } else if(!spKeys.length && !bySpace['_p']){
    h += '<section class="psp-card"><div class="empty-note">'+(isAll?'Chưa có chi tiêu.':'Chưa có chi tiêu tháng này.')+'</div></section>';
  }
  spKeys.forEach(function(k){
    var isActive = !!(window.DB && DB.fid===k);
    h += '<section class="psp-card">'
       + passHead(famName(k), isActive?actSub:'Nhóm của bạn', bySpace[k], isActive?phStrip:'')
       + '<div class="psp-rows">'+pspCatRows(catBySpace[k])+'</div></section>';
  });
  if(!spKeys.length && bySpace['_p'] && window.DB && DB.fid){
    /* has a family but nothing mirrored yet this month — keep the promise (and
       the family's moments, if any) visible; no amount block on the empty pass. */
    h += '<section class="psp-card">'
       + passHead(famName(DB.fid), ph.srcs.length?actSub:'Nhóm của bạn', null, phStrip)
       + '<div class="psp-note">Các khoản bạn ghi cho gia đình sẽ tự xuất hiện ở đây.</div></section>';
  }
  if(bySpace['_p']){
    h += '<section class="psp-card"><div class="psp-h">'
       + '<div class="psp-em priv">'+PIC.lock+'</div>'
       + '<div class="psp-bd"><div class="psp-t">Riêng tư</div><div class="psp-s">Chỉ mình bạn thấy</div></div>'
       + '<div class="psp-r"><div class="psp-amt num">'+fmt(bySpace['_p'])+'</div></div>'
       + '</div><div class="psp-rows">'+pspCatRows(catBySpace['_p'])+'</div></section>';
  }

  /* ── Giao dịch của bạn — category emoji is the only emoji (content mark) ── */
  /* Transactions for the SELECTED month only (newest first), so the list matches
     the totals + space cards above. Unreadable rows keep a plaintext date, so the
     per-month warning count is honest too. Since 0109 the spine carries every
     kind — expense, income, transfer legs, loans — and the list shows them all
     (a full ledger hides nothing), each styled by what it is. A transfer PAIR
     renders once, not twice: the out-leg carries the row, the in-leg is folded
     into it (same group id), so "VIB → VCB" reads as one event. */
  /* All-time shows the newest rows the cache holds (full detail only exists
     for the 2-month window); an older month has no detail rows at all, and
     the empty note below says so instead of pretending an empty month. */
  var txAll = isAll ? P.txns.slice() : P.txns.filter(function(t){ return (t.date||'').slice(0,7)===mon; });
  var seenXfer = {}, txList = [];
  txAll.forEach(function(t){
    if(t.kind==='transfer' && t.transferGroupId){
      if(seenXfer[t.transferGroupId]) return;   // second leg of a pair already listed
      seenXfer[t.transferGroupId] = 1;
    }
    txList.push(t);
  });
  var acctName = function(id){
    var a = id && (P.accounts||[]).find(function(x){ return x.id===id; });
    return a ? (a.name||'Tài khoản') : null;
  };
  /* the pair's two ends, from either leg: negative leg = from, positive = to */
  var pairEnds = function(t){
    var legs = txAll.filter(function(x){ return x.kind==='transfer' && x.transferGroupId===t.transferGroupId; });
    var from=null, to=null;
    legs.forEach(function(l){ if((l.amt||0)<0) from=l.accountId; else to=l.accountId; });
    return { from: acctName(from), to: acctName(to) };
  };
  var monUnread = (!inWin && SL) ? SL.unreadable : txList.filter(function(t){ return t._unreadable; }).length;
  h += '</div>';   // /#pers-cats-wrap
  h += '<div class="section-h" id="pers-tx"><span class="tl"><span class="t">'+(isAll?'Giao dịch gần đây':'Giao dịch của bạn')+'</span>'+persEyeHTML('txns')+'</span></div>'
     + '<div class="rows'+(persMaskIs('txns')?' sec-masked':'')+'">';
  /* Say it before the list, not inside it. A count kept out of the totals has to
     be visible or the totals are quietly wrong -- which is the whole reason this
     stopped being a 0đ row. */
  if(monUnread){
    h += '<div class="cf-note warn p-unread"><span class="ni">'+PIC.lock+'</span>'
       + (monUnread===1 ? 'Có <b>1 khoản</b> chưa đọc được' : 'Có <b>'+monUnread+' khoản</b> chưa đọc được')
       + ' — chưa tính vào tổng. Mở khoá lại bằng thẻ cá nhân để xem.</div>';
  }
  if(txList.length){
    txList.slice(0,30).forEach(function(t){
      /* Unified row anatomy (txn-listing revamp): the subline holds only quiet
         dot-joined facts — date · time · money source; the KIND/place moved to
         the right column under the amount (r-cat), exactly like the Giao dịch
         screen. No em-dashes; "không tính thu chi" reads from the muted amount
         plus the kind word, not from a clause. */
      if(t._unreadable){
        h += '<div class="row is-locked"><div class="r-ico pers-r-ico priv">'+PIC.lock+'</div>'
           + '<div class="r-body"><div class="r-t">Chưa đọc được</div>'
           + '<div class="r-s">'+t.date.slice(8,10)+'/'+t.date.slice(5,7)+' · không tính vào tổng</div></div>'
           + '<div class="r-right"><div class="r-amt num">—</div></div></div>';
        return;
      }
      var meta = t.date.slice(8,10)+'/'+t.date.slice(5,7)+(t.time?' · '+t.time:'');
      /* closes BOTH .r-right and the .row itself — every branch ends with it */
      var right = function(amtHtml, catTxt){
        return '<div class="r-right"><div class="r-amt num'+(amtHtml.cls?' '+amtHtml.cls:'')+'">'+amtHtml.v+'</div>'
             + (catTxt?'<div class="r-cat">'+catTxt+'</div>':'')+'</div></div>';
      };
      if(t.kind==='income'){
        // taps into the income edit sheet — amount · date · note · receiving account
        var _inAcct = acctName(t.accountId);
        h += '<div class="row tap" onclick="fhIncomeRowSheet(\''+t.id+'\')"><div class="r-ico personal-ico">'+(t.emoji||'💰')+'</div>'
           + '<div class="r-body"><div class="r-t">'+((t.note||t.cat||'Thu nhập').replace(/</g,'&lt;'))+'</div>'
           + '<div class="r-s">'+meta+(_inAcct?' · '+_inAcct.replace(/</g,'&lt;'):'')+'</div></div>'
           + right({v:'+'+fmt(t.amt||0), cls:'pos'}, 'Thu nhập');
      } else if(t.kind==='transfer'){
        var ends = t.transferGroupId ? pairEnds(t) : null;
        var xt = ends && ends.from && ends.to ? (ends.from+' → '+ends.to) : ((t.note||'Chuyển khoản').replace(/</g,'&lt;'));
        // a pair taps into its edit sheet (both legs in lockstep); a legacy
        // one-leg card payment has no pair sheet and stays inert
        var xTap = t.transferGroupId ? ' tap" onclick="fhXferPairSheet(\''+t.transferGroupId+'\')"' : '"';
        h += '<div class="row'+xTap+'><div class="r-ico personal-ico">🔁</div>'
           + '<div class="r-body"><div class="r-t">'+xt+'</div>'
           + '<div class="r-s">'+meta+' · không tính thu chi</div></div>'
           + right({v:fmt(Math.abs(t.amt||0)), cls:'xfer'}, 'Chuyển khoản');
      } else if(t.kind==='investment'){
        /* One leg, signed inside the ciphertext: buy −X, sell +X (0123). Taps
           into the same row sheet the position zoom-in uses. */
        var _iP = (P.accounts||[]).find(function(a){ return a.id===t.positionId; });
        var _sell = (t.amt||0) > 0;
        h += '<div class="row tap" onclick="fhInvRowSheet(\''+t.id+'\')"><div class="r-ico personal-ico">📈</div>'
           + '<div class="r-body"><div class="r-t">'+((_sell?'Bán':'Mua')+(_iP&&_iP.name?' '+_iP.name:' đầu tư')).replace(/</g,'&lt;')+'</div>'
           + '<div class="r-s">'+meta+' · không tính thu chi</div></div>'
           + right({v:(_sell?'+':'−')+fmt(Math.abs(t.amt||0)), cls:'xfer'}, 'Đầu tư');
      } else if(t.kind==='loan' || t.kind==='repayment'){
        /* Counterparty + hẹn trả live on the all-time debt read (P.debts), not
           the month-window row — join by id. Tapping opens the same row sheet
           the person zoom-in uses (edit · hẹn trả · convert-back · delete), so
           a loan is correctable wherever it is seen (0122). */
        var _dR = (P.debts||[]).filter(function(d){ return d.id===t.id; })[0];
        var _who = (_dR && _dR.who) ? ' · '+_dR.who.replace(/</g,'&lt;') : '';
        var _due = (_dR && t.kind==='loan' && _dR.due) ? ' · hẹn trả '+_dR.due.slice(8,10)+'/'+_dR.due.slice(5,7) : '';
        var _lbl = t.kind==='loan' ? ((t.amt||0)>0?'Cho vay':'Đi mượn') : 'Trả nợ';
        h += '<div class="row tap" onclick="fhDebtRowSheet(\''+t.id+'\')"><div class="r-ico personal-ico">'+(t.kind==='loan'?'💵':'✅')+'</div>'
           + '<div class="r-body"><div class="r-t">'+((t.note||(t.kind==='loan'?'Cho vay / mượn':'Trả nợ')).replace(/</g,'&lt;'))+_who+'</div>'
           + '<div class="r-s">'+meta+_due+'</div></div>'
           + right({v:fmt(Math.abs(t.amt||0)), cls:'xfer'}, _lbl);
      } else {
        /* 0114: private rows tap into their edit sheet; mirror rows tap through
           to the family expense detail (M10) and wear the 🏡 badge on the tile
           corner — the family name sits under the amount where the category
           would; a private row shows its own category there. */
        var _tap = t.spaceId ? ' onclick="fhMirrorRowTap(\''+t.id+'\')"'
                 : (!t.linkId ? ' onclick="openPersonalTxDetail(\''+t.id+'\')"' : '');
        var _tile = (t.photos&&t.photos.length)
          ? '<div class="r-ico ph" style="background-image:url('+escAttr(t.photos[0])+')"></div>'
          : '<div class="r-ico personal-ico">'+(t.emoji||'🗂️')+'</div>';
        if(t.spaceId) _tile='<div class="r-ico-wrap">'+_tile+'<div class="r-scope">🏡</div></div>';
        var _acct = !t.spaceId ? acctName(t.accountId) : null;
        var _catTxt = t.spaceId ? famName(t.spaceId).replace(/</g,'&lt;') : ((t.cat||'Khoản chi').replace(/</g,'&lt;'));
        h += '<div class="row'+(_tap?' tap':'')+'"'+_tap+'>'+_tile
           + '<div class="r-body"><div class="r-t">'+((t.note||t.cat||'Khoản chi').replace(/</g,'&lt;'))+'</div>'
           + '<div class="r-s">'+meta+(_acct?' · '+_acct.replace(/</g,'&lt;'):'')+'</div></div>'
           + right({v:'−'+fmt(t.amt||0), cls:''}, _catTxt);
      }
    });
  } else {
    h += '<div class="empty-note">'+(isCur||isAll ? 'Chưa có giao dịch nào trong sổ cá nhân.'
        : (inWin ? 'Không có giao dịch nào trong tháng này.'
                 : 'Chi tiết từng giao dịch chỉ lưu sẵn cho tháng này và tháng trước. Tổng và biểu đồ phía trên vẫn tính đủ tháng đã chọn.'))+'</div>';
  }
  h += '</div>';
  /* Re-renders arrive in bursts around boot (hydrate, mirror, slice, staged
     count). When nothing in the template changed, skip the innerHTML swap —
     a rebuild of identical markup is pure flicker, and it would also wipe the
     debt section's in-place async updates. */
  _persCommit(host, h, isCur, true);
}
function persScrollTx(){ _persScrollTo('pers-tx'); }
function persScrollCats(){ _persScrollTo('pers-cats'); }
function _persScrollTo(id){ var el=document.getElementById(id), sc=document.getElementById('scroll'); if(el&&sc){ var y=Math.max(0, el.getBoundingClientRect().top - sc.getBoundingClientRect().top + sc.scrollTop - 70); sc.scrollTo({top:y,behavior:'smooth'}); } }
/* personal budget now uses the SAME per-category sheet as the family Finance tab
   (openPersonalBudget → #sheet-budget, scope 'personal'). The old single-amount
   sheet-pbudget + persBudget* helpers are retired. */

/* ── the unified cash-flow chart: one pannable strip of stacked Thu/Chi bars ──
   Replaces the three-chart swipe deck (buổi day view, week-vs-last,
   month-vs-last). One component, three zooms, every scope:
     · Ngày / Tuần bars span the SELECTED scope — a month, or everything;
     · Tháng bars always span the whole history, so zooming out of a month
       shows the months around it, the selected one highlighted.
   Bars are spending only, in the same green the old chart wore; income keeps
   its place in the tiles and in a bar's tap label. Tap a bar to pin its ↑↓
   figures; the auto label rides the tallest bar in view. The strip owns
   horizontal drag, so the old card-wide swipe-to-switch-period is retired —
   zoom is a tap.
   Every bar carries a grey "before" bar behind it (period-comparison-spec.md;
   the rules live in 19-period-compare.js and are shared with the family
   deck): a day vs the same weekday last week, a week vs the matching week of
   last month, a month vs the previous month plus a tick for the same month
   last year, a buổi vs the same buổi a week earlier. Red = passed the grey.
   Slots still ahead in the current period show grey only. A fourth zoom,
   Buổi, splits each day of the selected month into Sáng·Trưa·Chiều·Tối
   (month scope only — a whole history at four bars a day is noise). */
try{ window.persZoomM = localStorage.getItem('fh-pzoom-m') || 'week'; }catch(e){ window.persZoomM = 'week'; }
try{ window.persZoomA = localStorage.getItem('fh-pzoom-all') || 'month'; }catch(e){ window.persZoomA = 'month'; }
if(['buoi','day','week','month'].indexOf(window.persZoomM)<0) window.persZoomM='week';
if(['day','week','month'].indexOf(window.persZoomA)<0) window.persZoomA='month';
var persStripScroll = null;   // strip scrollLeft; null = pin to the scope's "now"
var persPinKey = null;        // tapped bar key ('YYYY-MM-DD' | week Monday | 'YYYY-MM')
function persZoom(){ return window.persSelMon==='all' ? window.persZoomA : window.persZoomM; }
function persSetZoom(z){
  if(window.persSelMon==='all'){ window.persZoomA=z; try{localStorage.setItem('fh-pzoom-all',z);}catch(e){} }
  else { window.persZoomM=z; try{localStorage.setItem('fh-pzoom-m',z);}catch(e){} }
  persStripScroll=null; persPinKey=null;
  renderPersonal();
}
/* The full-history slice, fetched at most once per session. Anything that
   needs it before it lands renders a quiet loading note; this re-render (and
   a repaint of the month sheet, if it is open) delivers the real thing. */
var _persSliceReq = false;
function persEnsureSlice(){
  var SL = window.fhPersonalStatsSliceCached && fhPersonalStatsSliceCached();
  if(SL || _persSliceReq || !window.fhPersonalStatsSlice) return !!SL;
  _persSliceReq = true;
  fhPersonalStatsSlice().then(function(){
    _persSliceReq = false;
    renderPersonal();
    var sh = document.getElementById('sheet-pmonth');
    if(sh && sh.classList.contains('on') && window.buildPMonthChoices) buildPMonthChoices();
  });
  return false;
}
/* Local YYYY-MM-DD (avoids the UTC date-shift in UTC+7). */
function _pDate(dt){ return dt.getFullYear()+'-'+String(dt.getMonth()+1).padStart(2,'0')+'-'+String(dt.getDate()).padStart(2,'0'); }
/* Sum personal expense spend over an inclusive date range [aStr,bStr] ('YYYY-MM-DD'). */
function persSpendRange(aStr, bStr){
  var P=fhPersonalData(), s=0;
  (P.txns||[]).forEach(function(t){ if(t.kind==='expense' && t.date && t.date>=aStr && t.date<=bStr) s+=(t.amt||0); });
  return s;
}
/* Period parts for the current month — mirrors cfGuideParts. budgetAllow is SELF-CORRECTING
   (remaining month budget ÷ remaining days × this period's remaining days), so a blown month
   makes Day/Week read "over" too; spentPTD/prevPTD are the like-for-like to-date trend. */
function persGuideParts(periodKey){
  var P=fhPersonalData(), now=new Date(), dim=new Date(now.getFullYear(),now.getMonth()+1,0).getDate();
  var dom=now.getDate(), wd=(now.getDay()+6)%7, budget=P.budget||0;
  var d0=function(off){ return _pDate(new Date(now.getFullYear(),now.getMonth(),now.getDate()+off)); };
  var spentToday=persSpendRange(d0(0),d0(0));
  var spentMTD=persSpendRange(_pDate(new Date(now.getFullYear(),now.getMonth(),1)), d0(0));
  var daysLeftMonth=Math.max(1, dim-dom+1);
  var daysLeftPeriod = periodKey==='day'?1:(periodKey==='week'?Math.min(7-wd,daysLeftMonth):daysLeftMonth);
  var perDay=(budget>0)?((budget-(spentMTD-spentToday))/daysLeftMonth):null;
  var budgetAllow=(perDay!=null)?perDay*daysLeftPeriod:null;
  var spentPTD, prevPTD;
  if(periodKey==='day'){ spentPTD=spentToday; prevPTD=persSpendRange(d0(-30),d0(-1))/30; }
  else if(periodKey==='week'){ spentPTD=persSpendRange(d0(-wd),d0(0)); prevPTD=persSpendRange(d0(-wd-7),d0(-7)); }
  else { spentPTD=spentMTD; var pm=new Date(now.getFullYear(),now.getMonth()-1,1), pdim=new Date(now.getFullYear(),now.getMonth(),0).getDate();
    prevPTD=persSpendRange(_pDate(pm), _pDate(new Date(pm.getFullYear(),pm.getMonth(),Math.min(dom,pdim)))); }
  return {spentToday:spentToday, budgetAllow:budgetAllow, spentPTD:spentPTD, prevPTD:prevPTD};
}

/* Cache window start ('YYYY-MM-01' of last month) — mirrors _winFrom in 19-personal.js. */
function _persWinFrom(){ var d=new Date(); d.setDate(1); d.setMonth(d.getMonth()-1); return _pDate(d); }
var _persOldMap=null;   // last derived old-history map — kept while the slice is being re-fetched after a write, so old greys don't blink
/* Day-keyed {chi,thu}, the four buổi of each date, the untimed remainder per
   date, and the ledger's first date — over the WIDEST data we hold: the
   2-month cache for its window (fresh on every write), the full slice for
   everything older. Unreadable amounts never reach here — the cache filters
   them, the slice excluded them at decrypt; the banner by the list carries
   the count. `first` is the coverage yardstick (fhCovered): while the slice
   has not landed it is the cache's earliest date, so any comparison that
   starts before the window reads as not covered until the history is in.
   `complete` = old history is in (or a kept copy of it). */
function persCmpData(P, SL){
  var win=_persWinFrom(), byDay={}, buoi={}, untimed={}, first=null;
  var addTo=function(M, date, kind, amt, time, ts){
    if(!date) return;
    if(M.first==null || date<M.first) M.first=date;
    var e=M.byDay[date]||(M.byDay[date]={chi:0,thu:0});
    if(kind==='income'){ e.thu+=amt; return; }
    e.chi+=amt;
    var b=fhBuoiOf(date, time, ts);
    if(b==null) M.untimed[date]=(M.untimed[date]||0)+amt;
    else (M.buoi[date]||(M.buoi[date]=[0,0,0,0]))[b]+=amt;
  };
  var cur={byDay:byDay, buoi:buoi, untimed:untimed, first:null};
  (P.txns||[]).forEach(function(t){
    if(t._unreadable || (t.kind!=='expense' && t.kind!=='income') || !t.date || t.date<win) return;
    addTo(cur, t.date, t.kind, t.amt||0, t.time, t.ts);
  });
  var old=null;
  if(SL){
    old={byDay:{}, buoi:{}, untimed:{}, first:null};
    SL.rows.forEach(function(r){
      if(!r.date) return;
      if(old.first==null || r.date<old.first) old.first=r.date;   // first over the WHOLE ledger
      if(r.date<win) addTo(old, r.date, r.kind, r.amt, r.time, r.ts);
    });
    _persOldMap=old;
  } else old=_persOldMap;
  if(old){
    Object.keys(old.byDay).forEach(function(k){ byDay[k]=old.byDay[k]; });
    Object.keys(old.buoi).forEach(function(k){ buoi[k]=old.buoi[k]; });
    Object.keys(old.untimed).forEach(function(k){ untimed[k]=old.untimed[k]; });
    first=old.first;
  }
  if(cur.first!=null && (first==null || cur.first<first)) first=cur.first;
  return {byDay:byDay, buoi:buoi, untimed:untimed, first:first, complete:!!old};
}
var _NO_DATA_LBL=function(){ return L('chưa có dữ liệu','no data yet'); };
/* → [{k,label,chi,thu,prev,ly,fut,on,sel,cmpLabel,(buổi: day,b,now,untimed)}]
   for the active zoom+scope, zero slots kept so the axis stays honest; null
   while the needed slice is still loading. prev/ly null = not covered → no
   grey bar. fut = a slot still ahead → grey only. cmpLabel names the "before"
   for the tap label. */
function persSeries(P, SL, mon, isAll, inWin){
  var z=persZoom(), curMonK=_pMonKey(new Date()), today=_pDate(new Date());
  var useSlice = isAll || !inWin || z==='month';
  if(useSlice && !SL) return null;
  var D=persCmpData(P, SL);
  if(!D.complete) persEnsureSlice();   // a comparison may reach past the cache — greys land on the re-render
  var byDay=D.byDay, keys=Object.keys(byDay).sort();
  var chiOf=function(k){ var e=byDay[k]; return e?e.chi:0; };
  var rangeChi=function(a,b){ var s=0; keys.forEach(function(dk){ if(dk>=a && dk<=b) s+=byDay[dk].chi; }); return s; };
  var amtOr=function(v){ return v==null ? _NO_DATA_LBL() : fmtK(v); };
  var live = isAll || mon===curMonK;   // the range ends today → upcoming slots show grey only
  var bars=[];
  if(z==='month'){
    var firstK = keys.length ? keys[0].slice(0,7) : curMonK;
    var d=new Date(+firstK.slice(0,4), +firstK.slice(5,7)-1, 1);
    var end=new Date(); end.setDate(1);
    var curY=new Date().getFullYear();
    var monChi=function(mk){ var s=0; keys.forEach(function(dk){ if(dk.slice(0,7)===mk) s+=byDay[dk].chi; }); return s; };
    while(d<=end){
      var mk=_pMonKey(d), chi=0, thu=0;
      keys.forEach(function(dk){ if(dk.slice(0,7)===mk){ chi+=byDay[dk].chi; thu+=byDay[dk].thu; } });
      var c=fhCmpMonth(mk);
      var prev = fhCovered(c.prev+'-01', D.first) ? monChi(c.prev) : null;
      var ly   = fhCovered(c.ly+'-01',   D.first) ? monChi(c.ly)   : null;
      bars.push({ k:mk, chi:chi, thu:thu, prev:prev, ly:ly, fut:false, on:mk===curMonK, sel:!isAll && mk===mon,
        label: d.getFullYear()===curY ? moAbbr(d.getMonth()) : moAbbr(d.getMonth())+' '+String(d.getFullYear()).slice(2),
        cmpLabel: 'T'+(+c.prev.slice(5,7))+': '+amtOr(prev) + (ly!=null ? ' · T'+(+c.ly.slice(5,7))+'/'+c.ly.slice(2,4)+': '+fmtK(ly) : '') });
      d.setMonth(d.getMonth()+1);
    }
  } else {
    var a, b;
    if(isAll){ a = keys.length ? new Date(keys[0]+'T00:00:00') : new Date(); b=new Date(); }
    else {
      a = new Date(+mon.slice(0,4), +mon.slice(5,7)-1, 1);
      b = (mon===curMonK) ? new Date() : new Date(+mon.slice(0,4), +mon.slice(5,7), 0);
    }
    if(z==='day'){
      var d2=new Date(a), bEnd=_pDate(b);
      if(live) bEnd=fhAddDays(fhMondayOf(today), 6);   // through Sunday of this week, grey only past today
      while(_pDate(d2)<=bEnd){
        var dk2=_pDate(d2), e=byDay[dk2]||{chi:0,thu:0}, fut=dk2>today, p=fhCmpDay(dk2);
        var pv = fhCovered(p, D.first) ? chiOf(p) : null;
        bars.push({ k:dk2, label:d2.getDate()+'/'+(d2.getMonth()+1), chi:fut?0:e.chi, thu:fut?0:e.thu, prev:pv, ly:null, fut:fut, on:dk2===today, sel:false,
          cmpLabel: fhWdShort(p)+' '+fhDM(p)+': '+amtOr(pv) });
        d2.setDate(d2.getDate()+1);
      }
    } else if(z==='week'){
      var wm=new Date(a); wm.setDate(wm.getDate()-((wm.getDay()+6)%7));   // Monday of the first week
      var thisWeekK=fhMondayOf(today);
      var wEnd=_pDate(b);
      if(live){ var me=new Date(); me.setMonth(me.getMonth()+1); me.setDate(0); wEnd=_pDate(me); }   // through the last week that starts this month
      while(_pDate(wm)<=wEnd){
        var ws=_pDate(wm), we=fhAddDays(ws,6), futW=ws>thisWeekK, pw=fhCmpWeek(ws);
        var pvw = fhCovered(pw, D.first) ? rangeChi(pw, fhAddDays(pw,6)) : null;
        var c2=0, t2=0;
        if(!futW) keys.forEach(function(dk){ if(dk>=ws && dk<=we){ c2+=byDay[dk].chi; t2+=byDay[dk].thu; } });
        bars.push({ k:ws, label:wm.getDate()+'/'+(wm.getMonth()+1), chi:c2, thu:t2, prev:pvw, ly:null, fut:futW, on:ws===thisWeekK, sel:false,
          cmpLabel: L('tuần ','week of ')+fhDM(pw)+': '+amtOr(pvw) });
        wm.setDate(wm.getDate()+7);
      }
    } else {   // buổi — the selected month, four bars a day, today's remaining buổi grey only
      var LB=fhBuoiLabels(), curB=fhBuoiIdx(new Date().getHours()), Z4=[0,0,0,0];
      var d3=new Date(a), dEnd=_pDate(b);
      while(_pDate(d3)<=dEnd){
        var dk3=_pDate(d3), pd=fhCmpDay(dk3), covered=fhCovered(pd, D.first);
        var curA=D.buoi[dk3]||Z4, prevA=D.buoi[pd]||Z4, un=D.untimed[dk3]||0;
        for(var bb=0; bb<4; bb++){
          var futB = dk3===today && bb>curB;
          var pvb = covered ? prevA[bb] : null;
          bars.push({ k:dk3+'#'+bb, day:dk3, b:bb, title:LB[bb], label:fhDM(dk3), chi:futB?0:curA[bb], thu:0, prev:pvb, ly:null, fut:futB,
            on:dk3===today, now:dk3===today && bb===curB, sel:false, untimed:un,
            cmpLabel: fhWdShort(pd)+' '+fhDM(pd)+' '+LB[bb].toLowerCase()+': '+amtOr(pvb) + (un>0 ? ' · '+L('chưa rõ giờ: ','no time: ')+fmtK(un) : '') });
        }
        d3.setDate(d3.getDate()+1);
      }
    }
  }
  return bars;
}
function persZoomRowHTML(){
  var z=persZoom();
  var b=function(k,vi,en){ return '<button class="'+(z===k?'on':'')+'" onclick="persSetZoom(\''+k+'\')">'+L(vi,en)+'</button>'; };
  return (window.persSelMon==='all' ? '' : b('buoi','Buổi','Daypart'))+b('day','Ngày','Day')+b('week','Tuần','Week')+b('month','Tháng','Month');
}
/* One column: grey "before" behind, the coloured bar on top (red when it has
   passed a non-zero grey), the last-year tick line across, and the amount
   label riding the tallest of the three. Heights are a first paint at the
   whole-strip max; persStripLabelSync re-scales to what is in view. */
function _persColHTML(b, max, z){
  var hc=b.chi>0?Math.max(Math.round(b.chi/max*100),4):0;
  var hp=b.prev!=null?Math.round(b.prev/max*100):null;
  var hy=b.ly!=null?Math.round(b.ly/max*100):null;
  var over=!b.fut && b.prev!=null && b.prev>0 && b.chi>b.prev;
  var top='bottom:calc('+Math.max(hc, hp||0, hy||0)+'% + 3px)';
  var line1 = z==='buoi' ? b.title+': '+fmtK(b.chi) : '↓'+fmtK(b.chi)+(b.thu>0?' ↑'+fmtK(b.thu):'');
  return '<div class="pst-c'+(b.now?' now':'')+'" data-k="'+b.k+'" data-chi="'+b.chi+'" data-prev="'+(b.prev==null?'':b.prev)+'" data-ly="'+(b.ly==null?'':b.ly)+'" onclick="persBarTap(\''+b.k+'\')">'
    +'<span class="pst-bars">'
    +(persPinKey===b.k
        ? '<span class="pst-pin num" style="'+top+'">'+line1+'<small>'+esc(b.cmpLabel)+'</small></span>'
        : (b.chi>0 ? '<span class="pst-val num" style="'+top+'">'+fmtK(b.chi)+'</span>' : ''))
    +(hp!=null ? '<i class="pst-p" style="height:'+hp+'%"></i>' : '')
    +(hc && !b.fut ? '<i class="pst-b'+(over?' over':'')+'" style="height:'+hc+'%"></i>' : '')
    +(hy!=null ? '<i class="pst-y" style="bottom:'+hy+'%"></i>' : '')
    +'</span>'
    +(z==='buoi' ? '' : '<span class="pst-l'+(b.on?' on':'')+(b.sel?' sel':'')+'">'+b.label+'</span>')
    +'</div>';
}
function persStripHTML(P, SL, mon, isAll, inWin){
  var bars = persSeries(P, SL, mon, isAll, inWin);
  if(!bars) return '<div class="pst-load">Đang tải lịch sử…</div>';
  if(!bars.length) return '';
  var z=persZoom(), max=1;
  bars.forEach(function(b){ if(b.chi>max) max=b.chi; if(b.prev!=null && b.prev>max) max=b.prev; if(b.ly!=null && b.ly>max) max=b.ly; });
  var h='<div class="pst'+(z==='buoi'?' buoi':'')+'" id="pcf-strip" onscroll="persStripOnScroll(this)">';
  if(z==='buoi'){
    /* four narrow columns per day, the date once under the group */
    var i=0;
    while(i<bars.length){
      var day=bars[i].day, g='';
      while(i<bars.length && bars[i].day===day){ g+=_persColHTML(bars[i], max, z); i++; }
      h+='<div class="pst-g"><div class="pst-gr">'+g+'</div><span class="pst-l'+(bars[i-1].on?' on':'')+'">'+bars[i-1].label+'</span></div>';
    }
  } else bars.forEach(function(b){ h+=_persColHTML(b, max, z); });
  return h+'</div>';
}
/* Tap pins a bar's ↑↓ figures; the same tap lets go. The strip keeps its
   place through the re-render this triggers. */
function persBarTap(k){
  persPinKey = (persPinKey===k)?null:k;
  var el=document.getElementById('pcf-strip');
  if(el) persStripScroll = el.scrollLeft;
  renderPersonal();
}
var _pstRaf=0;
function persStripOnScroll(el){
  persStripScroll = el.scrollLeft;   // survives every re-render
  if(_pstRaf) return;
  _pstRaf=requestAnimationFrame(function(){ _pstRaf=0; persStripLabelSync(); });
}
/* The strip rescales to the tallest bar IN VIEW, not the whole timeline's —
   one 40tr outlier months back must not squash this week to unreadable nubs.
   Every scroll frame recomputes the visible max and re-heights every bar (the
   CSS height transition turns that into a smooth breathe as giants enter and
   leave). Visibility counts any overlap, so an outlier starts driving the
   scale at the edge instead of popping at its midpoint. The auto amount label
   rides the tallest visible bar — and yields the stage entirely while a
   tapped bar holds a pinned label, so the two never talk over each other. */
function persStripLabelSync(){ fhStripSync(document.getElementById('pcf-strip'), !!persPinKey); }
/* The body, shared: the transaction review's summary strip (56-csv-import-ui)
   wears the same .pst markup and calls this with its own element. `pinned`
   means a tapped bar holds a label, so the auto label stays out of its way. */
function fhStripSync(el, pinned){
  if(!el) return;
  var sr=el.getBoundingClientRect(), kids=el.querySelectorAll('.pst-c'), i, c;
  var num=function(c,a){ var s=c.getAttribute(a); return (s==null||s==='')?null:(Number(s)||0); };
  var vis=[], visMax=0;
  for(i=0;i<kids.length;i++){
    c=kids[i]; var r=c.getBoundingClientRect();
    vis[i]=(r.right>sr.left && r.left<sr.right);   // any overlap counts — an outlier starts driving the scale at the edge
    if(!vis[i]) continue;
    var v=num(c,'data-chi')||0, p=num(c,'data-prev'), y=num(c,'data-ly');   // greys + ticks count toward the scale
    if(v>visMax) visMax=v; if(p!=null && p>visMax) visMax=p; if(y!=null && y>visMax) visMax=y;
  }
  if(!(visMax>0)) visMax=1;
  var best=null, bestV=0;
  for(i=0;i<kids.length;i++){
    c=kids[i];
    var chi=num(c,'data-chi')||0, prev=num(c,'data-prev'), ly=num(c,'data-ly');
    var hc=chi>0?Math.min(100,Math.max(4,Math.round(chi/visMax*100))):0;
    var hp=prev!=null?Math.min(100,Math.round(prev/visMax*100)):0;
    var hy=ly!=null?Math.min(100,Math.round(ly/visMax*100)):0;
    var bar=c.querySelector('.pst-b'); if(bar) bar.style.height=hc+'%';
    var pb=c.querySelector('.pst-p'); if(pb) pb.style.height=hp+'%';
    var yb=c.querySelector('.pst-y'); if(yb) yb.style.bottom=hy+'%';
    var lab=c.querySelector('.pst-val, .pst-pin'); if(lab) lab.style.bottom='calc('+Math.max(hc,hp,hy)+'% + 3px)';
    if(vis[i] && chi>bestV){ bestV=chi; best=c; }
  }
  for(i=0;i<kids.length;i++){
    var s=kids[i].querySelector('.pst-val');
    if(s) s.style.opacity=(!pinned && kids[i]===best)?'1':'0';
  }
}
function persChartAfterRender(isCur){
  var P=fhPersonalData(); if(!P||P.state!=='ready') return;
  var el=document.getElementById('pcf-strip');
  if(el){
    if(persStripScroll!=null) el.scrollLeft=persStripScroll;
    else{
      /* pin to "now": the right end — except month zoom in a month scope,
         which centers the selected month in the timeline */
      var target=el.scrollWidth;
      if(persZoom()==='month' && window.persSelMon!=='all'){
        var selL=el.querySelector('.pst-l.sel');
        if(selL && selL.parentNode) target=selL.parentNode.offsetLeft - el.clientWidth/2 + 20;
      }
      el.scrollLeft=Math.max(0,target);
    }
    persStripLabelSync();
  }
  /* today's guide — the current month only: an old month has no "today", and
     all-time is a history view (the guide's whole job is now) */
  if(isCur){
    var pk=persZoom(), blockWin=false;
    if(pk==='buoi') pk='day';   // the guide has no buổi granularity: today is its unit (spec: guide unchanged)
    if(pk!=='month' && typeof fhGuideCompute==='function'){ var gm=fhGuideCompute(persGuideParts('month'), 1); blockWin=!!(gm && gm.state==='worse' && gm.hasBudget); }   // MoM gate: month failing ⇒ no day/week win
    if(typeof fhGuideRender==='function') fhGuideRender('pcf-daily', pk, persGuideParts(pk), 1, blockWin);
    var note=document.getElementById('pcf-note');
    if(note){ if(!P.mirrorRan){ note.className='cf-note flat'; note.innerHTML='Đang đồng bộ các khoản bạn đã ghi cho gia đình…'; } else { note.className='cf-note'; note.innerHTML=''; } }
  }
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

/* personal income now goes through the SAME sheet as the family Finance tab —
   fhIncome('personal') — which lists, adds and deletes. Expense capture likewise
   shares openPersonalExpense → openExpense({scope:'personal'}). One flow each,
   scope-picked; the old bespoke persAddIncome / sheet-pincome are retired. */
