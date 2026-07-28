/* ---------- budget + run-rate ---------- */
function renderBudget(){
  syncFallbackBudget();                                  // catch-all always holds the unallocated remainder
  var m=M(), done=m.done, spent=m.spent, dim=m.dim, dom=m.dom, budget=m.budget;
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
      setTxt('b-safe-sub', okc? L('còn dư khi '+m.short+' khép lại','left unspent when '+m.short+' closed') : L(m.short+' kết thúc vượt ngân sách',m.short+' finished over budget'));
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
}
/* The "whole": one allocation ring — inner arcs = the spending composition (by category)
   + green quỹ (kept); outer ring = budget with a pace tick (run-rate). Below it, the same
   categories as a compact budget list. One view, no switcher. Uses renderBudget's numbers. */
function renderFinanceHero(){
  var g = document.getElementById('fh-segs'); if(!g) return;
  var m = M(), spent = m.spent || 0, budget = m.budget || 0, saved = window.savings || 0;
  var reserved = m.done ? 0 : monthReserved(), safe = Math.max(0, budget - spent - reserved), over = spent > budget;
  // ── Inner ring: the composition — category arcs (where money went) + green quỹ (kept).
  var R = 33, C = 2 * Math.PI * R, GAP = 1.6, total = (spent + saved) || 1;
  var segs = catOrder.map(function(c){ return { v:(m.catSpent[c]||0), color:((catStyle[c]||[])[2]||'var(--cat-other)') }; }).filter(function(s){ return s.v > 0; });
  segs.push({ v:saved, color:'var(--good)' });
  // arcs (dash-offset donut; the svg's -90deg CSS rotation lifts the 3-o'clock start to the top)
  var cum = 0, html = '';
  segs.forEach(function(s){
    var len = s.v / total * C, drawn = Math.max(len - GAP, 0.5);
    html += '<circle cx="50" cy="50" r="' + R + '" fill="none" style="stroke:' + s.color + '" stroke-width="11" stroke-linecap="butt" stroke-dasharray="' + drawn.toFixed(2) + ' ' + (C - drawn).toFixed(2) + '" stroke-dashoffset="' + (-cum).toFixed(2) + '"></circle>';
    cum += len;
  });
  g.innerHTML = html;

  // ── Outer ring (Apple Activity style): budget is the full track, spend fills it, a tick marks
  // today's pace. Fill reaching past the tick = spending ahead of run-rate; a full red ring = over.
  var Ro = 45, Co = 2 * Math.PI * Ro;
  var spentFrac = budget > 0 ? spent / budget : 0;
  var pace = m.done ? 1 : (m.dim ? m.dom / m.dim : 0);
  var projected = (!m.done && m.dom) ? spent / m.dom * m.dim : spent;    // run-rate projection to month end
  var projOver = !m.done && budget > 0 && projected > budget * 1.02;
  var status = over ? 'over' : (projOver ? 'pace' : 'ok');
  var bfEl = document.getElementById('fh-bfill');
  if(bfEl){
    var fl = Math.min(spentFrac, 1) * Co;
    bfEl.setAttribute('stroke-dasharray', fl.toFixed(2) + ' ' + (Co - fl).toFixed(2));
    bfEl.setAttribute('class', 'fh-bfill ' + status);
  }
  var pk = document.getElementById('fh-pace');
  if(pk){
    if(!m.done && pace > 0.02 && pace < 0.99){
      var pa = pace * 2 * Math.PI;
      pk.setAttribute('x1', (50 + Math.cos(pa) * 47.6).toFixed(2)); pk.setAttribute('y1', (50 + Math.sin(pa) * 47.6).toFixed(2));
      pk.setAttribute('x2', (50 + Math.cos(pa) * 42.4).toFixed(2)); pk.setAttribute('y2', (50 + Math.sin(pa) * 42.4).toFixed(2));
      pk.style.display = '';
    } else pk.style.display = 'none';
  }

  setTxt('fh-lbl', L('Đã chi','Spent')); setTxt('fh-saved-lbl', L('để dành','saved'));
  // Center shows the bare compact number (unit stripped — it's tight in the hole, and the
  // currency is right there in the legend + note below).
  setTxt('fh-spent', fmtK(spent).replace(/[\s₫$]/g, '')); setTxt('fh-saved', fmtK(saved).replace(/[\s₫$]/g, ''));
  // Note: run-rate verdict (colored), with the budget number kept in view (muted).
  var verdict = over ? (L('Vượt ','Over by ') + fmtK(spent - budget))
    : projOver ? L('Nhanh hơn tiến độ','Ahead of pace')
    : L('Đúng tiến độ','On pace');
  setHTMLIf('fh-note', '<b class="' + status + '">' + verdict + '</b> · ' + L('ngân sách ','budget ') + fmtK(budget));
  // ── Category budget exposure — the outer ring's story one level down: each category's
  // spend against ITS budget, as an Apple inset list. Tap a row to drill into the category.
  setTxt('fh-cats-lbl', L('Ngân sách theo hạng mục','Budget by category'));
  setTxt('fh-cats-edit', L('Chỉnh','Edit'));
  var legend = (catOrder || []).map(function(c){
    var sp = m.catSpent[c] || 0, bd = catBudget[c] || 0, col = (catStyle[c] || [])[2] || 'var(--cat-other)';
    var pct = bd > 0 ? Math.min(100, sp / bd * 100) : (sp > 0 ? 100 : 0);
    var overB = bd > 0 && sp > bd, overP = !m.done && bd > 0 && (sp / bd) > (pace + 0.12);
    var barCol = overB ? 'var(--danger)' : (overP ? 'var(--amber)' : col);
    // Whole row IS the progress bar: a low-opacity tint fills to spent/budget, label rides on top.
    return '<button type="button" class="fh-lrow" onclick="openCat(&#39;cat&#39;,&#39;' + escAttr(c) + '&#39;)">'
      + '<span class="fh-fill" style="width:' + pct.toFixed(0) + '%;background:' + barCol + '"></span>'
      + '<span class="fh-lname">' + esc(c) + '</span>'
      + '<span class="fh-lamt num">' + fmtK(sp) + (bd > 0 ? ' <span class="fh-lof">/' + fmtK(bd) + '</span>' : '') + '</span>'
      + '<svg class="fh-chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18l6-6-6-6"/></svg></button>';
  }).join('');
  legend += '<div class="fh-lrow save">'
    + '<span class="fh-lname">' + L('Quỹ tiết kiệm','Savings') + '</span>'
    + '<span class="fh-lamt num">' + fmtK(saved) + '</span></div>';
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
    if(overBud){ statusText='Over budget'; statusCol='var(--danger)'; }
    else if(overPace){ statusText='Over pace'; statusCol='var(--amber)'; }
    else if(fut>0){ statusText='＋'+fmt(fut)+' upcoming'; statusCol='var(--brand-ink)'; }
    else { statusText=''; }
    var barCol=overBud?'#FF375F':(overPace?'#FFB020':s[2]);
    var mark=done?'display:none':('left:'+(pace*100)+'%');
    html+='<div class="crow tap" onclick="openCat(\'cat\',\''+c+'\')"><div class="cico" style="background:'+s[1]+';color:'+s[2]+'">'+s[0]+'</div>'
      +'<div class="r-body"><div class="r-t" style="display:flex;justify-content:space-between;align-items:center">'
      +'<span>'+c+'</span><span class="num" style="font-weight:600">'+fmt(sp)
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
    +'<span>'+label+'</span><span class="num" style="font-weight:600">'+fmt(amt)+'</span></div>'
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
    legend+='<div class="item wp" onclick="openCat(\'mem\',\''+k+'\')"><span class="dot" style="background:'+mt.col+'"></span>'+k+' <b class="num">'+fmt(v)+'</b></div>';
  });
  setHTML('member-split',split); setHTML('member-legend',legend);
}
function renderAll(){ renderBudget(); renderMembers(); }

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
    +'<input class="cat-name" placeholder="Name" value="'+String(name||'').replace(/"/g,'&quot;')+'"'+(lock?' readonly':' oninput="bgDirty()"')+'>'
    // symbol sits on the same side as fmt() puts it: ₫ after, $ before
    +'<span class="cat-bud-wrap">'+(CUR==='VND'?'':curSym())
      +'<input class="cat-bud num" inputmode="numeric" placeholder="0" value="'+amtToInput(budget)+'"'
      +(budget?' data-touched="1"':'')
      +(lock?' readonly title="Whatever the other categories leave unallocated">'
            :' oninput="markCatTouched(this);syncFallbackRow()" onblur="snapAmtInput(this);syncFallbackRow()">')
      +(CUR==='VND'?curSym():'')+'</span>'
    +(lock
      ? '<span class="cat-del cat-del-off" title="Everything uncategorised lands here"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 018 0v3"/></svg></span>'
      : '<button class="cat-del" aria-label="Remove category" onclick="armCatDelete(this)"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg></button>')
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
    if(over) note.textContent='Categories add up to '+fmt(used-total)+' more than the monthly budget, so Others is at 0.';
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
function bgDirty(){
  var b=document.getElementById('bg-save'); if(!b) return;
  b.disabled = !(bgValid() && bgSig()!==bgSnap);
}
function addCatRow(){                                       // new rows go above the catch-all, which stays last
  var box=document.getElementById('bg-rows'), lock=box.querySelector('.cat-row-lock'), html=catRowHTML('🏷️','','','');
  if(lock) lock.insertAdjacentHTML('beforebegin',html); else box.insertAdjacentHTML('beforeend',html);
  bgDirty();
  var rows=box.querySelectorAll('.cat-row:not(.cat-row-lock) .cat-name');
  if(rows.length) rows[rows.length-1].focus();               // land the cursor in the new row
}
// best-practice weights (EN + seeded VI names); unknown categories default to 0.08, then normalised
var CATW={housing:.30,'nhà ở':.30,rent:.30,groceries:.14,'đi chợ':.14,dining:.08,'ăn ngoài':.08,transport:.10,'đi lại':.10,fun:.06,'giải trí':.06,kids:.08,'con cái':.08,others:.08,shopping:.10,clothing:.06};
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
      btn.setAttribute('aria-label','Remove category');
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
  var v=parseAmtBase(document.getElementById('bg-amt').value); if(v)M().budget=v;
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
