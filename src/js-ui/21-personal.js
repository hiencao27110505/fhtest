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
  mail:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 5h18v14H3z"/><path d="M3 6l9 7 9-7"/></svg>',
  chev:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m9 6 6 6-6 6"/></svg>',
  chart: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19V9M9 19V5M14 19v-7M19 19v-11"/></svg>',
  list:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/></svg>'
};
var _ccChev='<svg class="cc-chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m9 6 6 6-6 6"/></svg>';
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
function persRenderAvatar(){
  var el=document.getElementById('pers-av'); if(!el) return;
  var mid=window.DB && window.DB.ownerMemberId;
  var m=mid && window.DB.memberById && window.DB.memberById[mid];
  var key=m?(m.is_shared?'Shared':m.name):null;
  var mm=(key && window.membersMeta)?window.membersMeta[key]:null;
  if(!mm){ el.className='av av-40 av-shared'; el.removeAttribute('style'); el.textContent=''; return; }
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

function renderPersonal(){
  var host = document.getElementById('pers-body'); if(!host) return;
  persRenderAvatar();     // header disc — independent of personal-ledger state
  var P = window.fhPersonalData ? fhPersonalData() : null;
  // The data module hasn't loaded yet (this is now the landing tab, painted at
  // parse-time boot) — show the same preparing note the boot states use, never a blank.
  if(!P){ host.innerHTML = '<div class="empty-note">Đang chuẩn bị sổ cá nhân của bạn…</div>'; return; }

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
  var left = inc-out;
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

  var h = '';
  h += '<section class="cf-card">'
     + '<div class="cf-lblrow"><div class="cf-lbl">'+cfLbl+'</div>'+moCaret+'</div>'
     + '<div class="cf-big num'+(left<0&&slReady?' neg':'')+'">'+(slReady?fmt(left):'…')+'</div>'
     + '<div class="cf-tiles">'
     +   '<button class="cf-tile" onclick="fhIncome(\'personal\')"><span class="cf-tl"><span class="cf-ar up">↑</span> Vào</span><span class="cf-tv num">'+(slReady?fmt(inc):'…')+'</span></button>'
     +   '<button class="cf-tile" onclick="persScrollTx()"><span class="cf-tl"><span class="cf-ar dn">↓</span> Ra</span><span class="cf-tv num">'+(slReady?fmt(out):'…')+'</span></button>'
     + '</div>'
     /* One chart for every scope: the pannable stacked Thu/Chi strip with its
        zoom row. The note + guide stay current-month only — the guide's whole
        job is today, and an old month (or all of history) has none. */
     + '<div class="pz" id="pcf-zoom">'+persZoomRowHTML()+'</div>'
     + persStripHTML(P, SL, mon, isAll, inWin)
     + (isCur ? ('<div class="cf-note" id="pcf-note"></div>'
               + '<div class="cf-daily" id="pcf-daily" style="display:none"></div>') : '')
     + '<div class="cf-cta">'
     +   '<button class="cc-row" onclick="openPersonalBudget()"><span class="cc-ic">'+PIC.chart+'</span><span class="cc-t">'+(P.budget>0?'Ngân sách cá nhân':'Lập ngân sách cá nhân')+'</span>'+_ccChev+'</button>'
     +   '<button class="cc-row" onclick="openTxns(\'personal\')"><span class="cc-ic">'+PIC.list+'</span><span class="cc-t">Xem chi tiêu</span>'+_ccChev+'</button>'
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
  var ic=PIC.mail, badge, sub='', prog='';
  if(reading){
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
    +'<span class="'+(reading?'cc-ic run':'cc-ic')+'">'+ic+'</span>'
    +'<span class="cc-t">'+L('Khoản thu chi từ email','Income & expenses from email')+sub+prog+'</span>'
    +badge+_ccChev+'</button>';
}

/* ── Nợ & cho vay — the balance-sheet dimension (stocks, not flows), between
     the month's cash-flow card and the month's spending cards. Built by
     23-debts-ui.js (js-data) so it can share the modal helper + space keys. ── */
  h += (window.persDebtSection ? persDebtSection() : '');

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
  h += '<div class="section-h" id="pers-cats"><span class="t">'+(isAll?'Tiền đi đâu':'Tiền đi đâu tháng này')+'</span>'
     + '<a onclick="openPersonalBudget()">'+(P.budget>0?'Ngân sách':'Lập ngân sách')+'</a></div>';
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
  h += '<div class="section-h" id="pers-tx"><span class="t">'+(isAll?'Giao dịch gần đây':'Giao dịch của bạn')+'</span></div><div class="rows">';
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
      if(t._unreadable){
        h += '<div class="row is-locked"><div class="r-ico pers-r-ico priv">'+PIC.lock+'</div>'
           + '<div class="r-body"><div class="r-t">Chưa đọc được</div>'
           + '<div class="r-s">'+t.date.slice(8,10)+'/'+t.date.slice(5,7)+' · không tính vào tổng</div></div>'
           + '<div class="r-amt num">—</div></div>';
        return;
      }
      var meta = t.date.slice(8,10)+'/'+t.date.slice(5,7)+(t.time?' · '+t.time:'');
      if(t.kind==='income'){
        h += '<div class="row"><div class="r-ico personal-ico">'+(t.emoji||'💰')+'</div>'
           + '<div class="r-body"><div class="r-t">'+((t.note||t.cat||'Thu nhập').replace(/</g,'&lt;'))+'</div>'
           + '<div class="r-s">'+meta+' · thu nhập</div></div>'
           + '<div class="r-amt num pos">+'+fmt(t.amt||0)+'</div></div>';
      } else if(t.kind==='transfer'){
        var ends = t.transferGroupId ? pairEnds(t) : null;
        var xt = ends && ends.from && ends.to ? (ends.from+' → '+ends.to) : ((t.note||'Chuyển khoản').replace(/</g,'&lt;'));
        h += '<div class="row"><div class="r-ico personal-ico">🔁</div>'
           + '<div class="r-body"><div class="r-t">'+xt+'</div>'
           + '<div class="r-s">'+meta+' · chuyển khoản — không tính thu chi</div></div>'
           + '<div class="r-amt num xfer">'+fmt(Math.abs(t.amt||0))+'</div></div>';
      } else if(t.kind==='loan' || t.kind==='repayment'){
        h += '<div class="row"><div class="r-ico personal-ico">'+(t.kind==='loan'?'💵':'✅')+'</div>'
           + '<div class="r-body"><div class="r-t">'+((t.note||(t.kind==='loan'?'Cho vay / mượn':'Trả nợ')).replace(/</g,'&lt;'))+'</div>'
           + '<div class="r-s">'+meta+' · '+(t.kind==='loan'?'khoản vay':'trả nợ')+'</div></div>'
           + '<div class="r-amt num xfer">'+fmt(Math.abs(t.amt||0))+'</div></div>';
      } else {
        /* 0114: private rows tap into their edit sheet; mirror rows tap through
           to the family expense detail (M10 — the natural door for "I spotted
           my mis-filed row in my own book"). A photo wears the tile, exactly
           like the family list; /personal-media/ URLs decrypt in place. */
        var _tap = t.spaceId ? ' onclick="fhMirrorRowTap(\''+t.id+'\')"'
                 : (!t.linkId ? ' onclick="openPersonalTxEdit(\''+t.id+'\')"' : '');
        var _tile = (t.photos&&t.photos.length)
          ? '<div class="r-ico ph" style="background-image:url('+escAttr(t.photos[0])+')"></div>'
          : '<div class="r-ico personal-ico">'+(t.emoji||'🗂️')+'</div>';
        h += '<div class="row'+(_tap?' tap':'')+'"'+_tap+'>'+_tile
           + '<div class="r-body"><div class="r-t">'+((t.note||t.cat||'Khoản chi').replace(/</g,'&lt;'))+'</div>'
           + '<div class="r-s">'+meta+(t.spaceId? ' · '+famName(t.spaceId) : ' · riêng tư')+'</div></div>'
           + '<div class="r-amt num">−'+fmt(t.amt||0)+'</div></div>';
      }
    });
  } else {
    h += '<div class="empty-note">'+(isCur||isAll ? 'Chưa có giao dịch nào trong sổ cá nhân.'
        : (inWin ? 'Không có giao dịch nào trong tháng này.'
                 : 'Chi tiết từng giao dịch chỉ lưu sẵn cho tháng này và tháng trước. Tổng và biểu đồ phía trên vẫn tính đủ tháng đã chọn.'))+'</div>';
  }
  h += '</div>';
  host.innerHTML = h;
  persChartAfterRender(isCur);   // strip scroll + auto label + (current month) guide & sync note
  if(window.persDebtAfterRender) persDebtAfterRender();   // async space balances → section refreshes in place
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
   zoom is a tap. The this-vs-last comparison left the bars and lives on in
   the guide's words ("so với tuần trước"), current month only. */
try{ window.persZoomM = localStorage.getItem('fh-pzoom-m') || 'week'; }catch(e){ window.persZoomM = 'week'; }
try{ window.persZoomA = localStorage.getItem('fh-pzoom-all') || 'month'; }catch(e){ window.persZoomA = 'month'; }
if(['day','week','month'].indexOf(window.persZoomM)<0) window.persZoomM='week';
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

/* Day-keyed {chi,thu} over the best source for the job: the 2-month cache for
   an in-window month at Ngày/Tuần zoom (free), the slice everywhere else.
   Unreadable amounts never reach here — the cache filters them, the slice
   excluded them at decrypt; the banner by the list carries the count. */
function persFlowByDay(P, SL, useSlice){
  var map={};
  var add=function(date,kind,amt){ if(!date) return; var e=map[date]||(map[date]={chi:0,thu:0}); if(kind==='income') e.thu+=amt; else e.chi+=amt; };
  if(useSlice && SL) SL.rows.forEach(function(r){ add(r.date, r.kind, r.amt); });
  else (P.txns||[]).forEach(function(t){ if(t._unreadable) return; if(t.kind==='expense'||t.kind==='income') add(t.date,t.kind,t.amt||0); });
  return map;
}
/* → [{k,label,chi,thu,on,sel}] for the active zoom+scope, zero slots kept so
   the axis stays honest; null while the needed slice is still loading. */
function persSeries(P, SL, mon, isAll, inWin){
  var z=persZoom(), curMonK=_pMonKey(new Date()), today=_pDate(new Date());
  var useSlice = isAll || !inWin || z==='month';
  if(useSlice && !SL) return null;
  var byDay=persFlowByDay(P, SL, useSlice), keys=Object.keys(byDay).sort();
  var bars=[];
  if(z==='month'){
    var firstK = keys.length ? keys[0].slice(0,7) : curMonK;
    var d=new Date(+firstK.slice(0,4), +firstK.slice(5,7)-1, 1);
    var end=new Date(); end.setDate(1);
    var curY=new Date().getFullYear();
    while(d<=end){
      var mk=_pMonKey(d), chi=0, thu=0;
      keys.forEach(function(dk){ if(dk.slice(0,7)===mk){ chi+=byDay[dk].chi; thu+=byDay[dk].thu; } });
      bars.push({ k:mk, chi:chi, thu:thu, on:mk===curMonK, sel:!isAll && mk===mon,
        label: d.getFullYear()===curY ? moAbbr(d.getMonth()) : moAbbr(d.getMonth())+' '+String(d.getFullYear()).slice(2) });
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
      var d2=new Date(a);
      while(d2<=b){
        var dk2=_pDate(d2), e=byDay[dk2]||{chi:0,thu:0};
        bars.push({ k:dk2, label:d2.getDate()+'/'+(d2.getMonth()+1), chi:e.chi, thu:e.thu, on:dk2===today, sel:false });
        d2.setDate(d2.getDate()+1);
      }
    } else {
      var wm=new Date(a); wm.setDate(wm.getDate()-((wm.getDay()+6)%7));   // Monday of the first week
      var tw=new Date(); tw.setDate(tw.getDate()-((tw.getDay()+6)%7));
      var thisWeekK=_pDate(tw);
      while(wm<=b){
        var ws=_pDate(wm), weD=new Date(wm); weD.setDate(weD.getDate()+6);
        var we=_pDate(weD), c2=0, t2=0;
        keys.forEach(function(dk){ if(dk>=ws && dk<=we){ c2+=byDay[dk].chi; t2+=byDay[dk].thu; } });
        bars.push({ k:ws, label:wm.getDate()+'/'+(wm.getMonth()+1), chi:c2, thu:t2, on:ws===thisWeekK, sel:false });
        wm.setDate(wm.getDate()+7);
      }
    }
  }
  return bars;
}
function persZoomRowHTML(){
  var z=persZoom();
  var b=function(k,vi,en){ return '<button class="'+(z===k?'on':'')+'" onclick="persSetZoom(\''+k+'\')">'+L(vi,en)+'</button>'; };
  return b('day','Ngày','Day')+b('week','Tuần','Week')+b('month','Tháng','Month');
}
function persStripHTML(P, SL, mon, isAll, inWin){
  var bars = persSeries(P, SL, mon, isAll, inWin);
  if(!bars) return '<div class="pst-load">Đang tải lịch sử…</div>';
  if(!bars.length) return '';
  var max=1; bars.forEach(function(b){ if(b.chi>max) max=b.chi; });
  var h='<div class="pst" id="pcf-strip" onscroll="persStripOnScroll(this)">';
  bars.forEach(function(b){
    var hc=b.chi>0?Math.max(Math.round(b.chi/max*100),4):0;
    var top='bottom:calc('+hc+'% + 3px)';
    h+='<div class="pst-c" data-k="'+b.k+'" data-chi="'+b.chi+'" onclick="persBarTap(\''+b.k+'\')">'
      +'<span class="pst-bars">'
      +(persPinKey===b.k
          ? '<span class="pst-pin num" style="'+top+'">↓'+fmtK(b.chi)+(b.thu>0?' ↑'+fmtK(b.thu):'')+'</span>'
          : (b.chi>0 ? '<span class="pst-val num" style="'+top+'">'+fmtK(b.chi)+'</span>' : ''))
      +(hc?'<i class="pst-b" style="height:'+hc+'%"></i>':'')
      +'</span><span class="pst-l'+(b.on?' on':'')+(b.sel?' sel':'')+'">'+b.label+'</span></div>';
  });
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
/* The auto amount label rides the tallest CHI bar currently in view. A pinned
   bar keeps its own label regardless — that one the person asked for. */
function persStripLabelSync(){
  var el=document.getElementById('pcf-strip'); if(!el) return;
  var x0=el.scrollLeft, x1=x0+el.clientWidth, best=null, bestV=0;
  for(var i=0;i<el.children.length;i++){
    var c=el.children[i], mid=c.offsetLeft+c.offsetWidth/2;
    if(mid<x0||mid>x1) continue;
    var v=Number(c.getAttribute('data-chi'))||0;
    if(v>bestV){ bestV=v; best=c; }
  }
  for(var j=0;j<el.children.length;j++){
    var s=el.children[j].querySelector('.pst-val');
    if(s) s.style.opacity=(el.children[j]===best)?'1':'0';
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
