/* ---------- saving goals (Thu Chi · Tiết kiệm) ---------- */
// A saving goal is "done" when it's fully FUNDED — never merely because its
// target date has passed (an underfunded goal past its date is overdue, not done).
function achievedGoal(g){ return !!(g && (g.achieved || (g.target>0 && g.saved>=g.target))); }
// Completed goals collapse into one summary row; this remembers open/closed across re-renders.
var goalsDoneOpen=false;
function toggleGoalsDone(){ goalsDoneOpen=!goalsDoneOpen; renderGoals(); }
function renderGoals(){
  var goals=window.goals||{}, ord=window.goalOrder||[];
  var hasGoals=ord.length>0;
  // The Tích lũy card always shows — the savings total is worth seeing even with no
  // goals. When there are none, the goal list is replaced by a create-first-goal CTA.
  var gc=document.getElementById('goal-card'); if(gc) gc.style.display='';
  var live=ord.filter(function(g){ return !achievedGoal(goals[g]); });   // active goals only
  var pool=(window.savings!==undefined?window.savings:savings)||0;
  var totalTarget=live.reduce(function(s,g){return s+(goals[g].target||0);},0);
  var totalSaved=live.reduce(function(s,g){return s+(goals[g].saved||0);},0);
  var totSav=totalSaved+pool, goal=totalTarget, still=Math.max(0,goal-totSav);
  var savPct=goal?Math.min(100,Math.round(totSav/goal*100)):0;
  // --- Brief: lead with the one number that matters — how much is still needed to reach
  // every goal — kept terse. The bar and % carry progress, so the words stay short. ---
  var labTxt, labDue=false, heroHTML, fillPct;
  if(goal<=0){                       // only fully-funded goals remain — don't show "0đ left"
    labTxt=L('Hoàn tất','Done'); heroHTML=L('Đã hoàn thành tất cả','All goals complete'); fillPct=100;
  } else if(still<=0){               // enough saved to cover every active goal
    labTxt=L('Hoàn tất','Done'); heroHTML=L('Đã đủ mọi mục tiêu','All goals funded'); fillPct=100;
  } else {
    fillPct=savPct;
    var dueSoon=live.filter(function(g){var e=goals[g]; return e.d&&daysLeft(e.d)<=30;})
                    .reduce(function(s,g){return s+Math.max(0,goals[g].target-goals[g].saved);},0);
    if(dueSoon>0){ labDue=true; labTxt=fmtK(dueSoon)+' '+L('sắp đến hạn','due soon'); }
    else labTxt=L('Cần thêm','To go');
    heroHTML='<em>'+fmtK(still)+'</em>';
  }
  if(!hasGoals){ labTxt=''; labDue=false; }   // no goals → no "Done"/"To go" framing; the CTA speaks for itself
  var lab=document.getElementById('sav-lab'); if(lab){ lab.className='til-sub'+(labDue?' due':''); lab.textContent=labTxt; }
  // Tích lũy header: the pot total (pool + everything saved toward goals) + this-month momentum
  setTxt('til-total', fmt(totSav));
  var _sm=window.savingsThisMonth||0;
  setHTMLIf('til-spark', _sm>0
    ? '<svg viewBox="0 0 52 24" width="52" height="24" aria-hidden="true"><polyline points="2,20 12,16 22,17 32,11 42,8 50,4" fill="none" stroke="var(--brand)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><circle cx="50" cy="4" r="2.4" fill="var(--brand)"/></svg><span>'+L('Tháng này để dành thêm ','Saved ')+'<b>'+fmt(_sm)+'</b>'+L('',' more this month')+'</span>'
    : '');
  setHTML('sav-hero',heroHTML);
  var sf=document.getElementById('sav-fill'); if(sf)sf.style.width=fillPct+'%';
  setHTML('sav-foot-l',L('Đã để dành ','Saved ')+'<b>'+fmtK(totSav)+'</b>');
  setHTML('sav-foot-r','<b>'+fillPct+'%</b>');
  // Rows in the finance-final "goals-status" style: emoji · name + saved/target on one
  // line · a slim progress track whose fill deepens as the goal fills.
  function goalRow(g, done){
    var e=goals[g], pct=e.target>0?Math.min(100,Math.round(e.saved/e.target*100)):(e.saved>0?100:0);
    var occ=e.occasion_id?'<span class="goal-link">🔗</span>':'';
    var overdue=(!done && e.d && e.d<TODAY)?' · <span class="goal-od">'+L('quá hạn','overdue')+'</span>':'';
    var op=done?1:(0.4+pct/100*0.6).toFixed(2);   // fuller goal → more opaque bar (a status cue)
    return '<div class="goal-row" onclick="openGoalDetail(&#39;'+escAttr(g)+'&#39;)">'
      +'<div class="goal-ico">'+esc(e.emoji)+'</div>'
      +'<div class="goal-mid">'
        +'<div class="goal-top"><span class="goal-lead"><span class="goal-name">'+esc(e.name)+'</span>'+(done?'<span class="goal-check">✓</span>':'')+occ+'</span>'
          +'<span class="goal-amt num">'+fmtK(e.saved)+' / '+fmtK(e.target)+overdue+'</span></div>'
        +'<div class="goal-meter"><i style="width:'+pct+'%;opacity:'+op+'"></i></div>'
      +'</div>'
    +'</div>';
  }
  // active goals first (by date), then every finished goal grouped under "Completed goals"
  var byDate=function(a,b){ var da=goals[a].d?goals[a].d.getTime():Infinity, db=goals[b].d?goals[b].d.getTime():Infinity; return da-db; };
  var activeRows=live.slice().sort(byDate).map(function(g){ return goalRow(g,false); }).join('');
  var doneG=ord.filter(function(g){ return achievedGoal(goals[g]); }).sort(byDate);
  var doneRows=doneG.map(function(g){ return goalRow(g,true); }).join('');
  var listHTML='';
  if(activeRows) listHTML+='<div class="goal-group">'+activeRows+'</div>';
  // Completed goals fold into ONE row — tap to expand the list, tap again to hide.
  if(doneRows){
    var doneSaved=doneG.reduce(function(s,g){ return s+(goals[g].saved||0); },0);
    listHTML+='<button class="goal-done-row'+(goalsDoneOpen?' open':'')+'" onclick="toggleGoalsDone()">'
      +'<span class="gdr-ic">✓</span>'
      +'<span class="gdr-mid"><span class="gdr-t">'+L('Đã hoàn thành','Completed')+'</span>'
        +'<span class="gdr-c num">'+doneG.length+' '+L('mục tiêu','goals')+' · '+fmtK(doneSaved)+'</span></span>'
      +'<svg class="gdr-chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>'
      +'</button>';
    if(goalsDoneOpen) listHTML+='<div class="goal-group done">'+doneRows+'</div>';
  }
  // With goals → the grouped list. Without → an in-card CTA to create the first one, so the
  // savings total in the header still stands on its own.
  setHTML('goals-list', hasGoals
    ? listHTML
    : '<button class="til-goal-cta" onclick="openGoal()"><span class="tgc-ic">🎯</span>'
      +'<span class="tgc-txt"><span class="tgc-t">'+L('Tạo mục tiêu đầu tiên','Create your first goal')+'</span>'
      +'<span class="tgc-s">'+L('Để dành cho điều bạn muốn mua hoặc làm','Save up for something you want to buy or do')+'</span></span>'
      +'<span class="tgc-plus">＋</span></button>');
  // The standalone empty prompt is now folded into the card above.
  setHTML('goals-empty', '');
}
function onGoalInput(){ if(typeof fhClearInvalid==='function') fhClearInvalid('goal-modal'); }   // Save stays enabled (DESIGN §4.4)
function openGoal(){
  ['goal-name','goal-amt','goal-date','goal-init'].forEach(function(id){ var e=document.getElementById(id); if(e)e.value=''; });
  if(typeof fhClearInvalid==='function') fhClearInvalid('goal-modal');
  openSheet('goal-modal');
  setTimeout(function(){ var n=document.getElementById('goal-name'); if(n)n.focus(); },260);
}
function submitGoal(){
  var nameEl=document.getElementById('goal-name'), amtEl=document.getElementById('goal-amt');
  var name=(nameEl.value||'').trim();
  var target=parseAmtBase(amtEl.value);
  if(!fhCheck([
    {el:nameEl, ok:!!name},
    {el:amtEl, ok:target>0}
  ], L('Nhập tên và số tiền mục tiêu','Enter a name and target amount'))) return;
  var pool=(window.savings!==undefined?window.savings:savings)||0;
  var data={ name:name, target:target, date:(document.getElementById('goal-date').value||null),
    init:Math.min(parseAmtBase(document.getElementById('goal-init').value)||0, pool),
    emoji:chosen('goal-emoji')||'🎯' };
  closeModals();
  toast(L('Đã tạo mục tiêu · ','Goal created · ')+name); floatEmojis(data.emoji); go('spending');
  if(typeof window.fhCreateGoal==='function') window.fhCreateGoal(data);
}
var _fundGoalId=null;
function fundGoal(id){
  _fundGoalId=id;
  var g=(window.goals||{})[id]; var pool=(window.savings!==undefined?window.savings:savings)||0;
  if(g) setHTML('gf-sub',L('Thêm vào <b>','Add to <b>')+esc(g.name)+'</b> · '+fmt(pool)+L(' sẵn có trong quỹ.',' available in the fund.'));
  var a=document.getElementById('gf-amt'); if(a)a.value='';
  if(typeof fhClearInvalid==='function') fhClearInvalid('goal-fund');
  openSheet('goal-fund');
  setTimeout(function(){ var a2=document.getElementById('gf-amt'); if(a2)a2.focus(); },260);
}
function onGoalFundInput(){ if(typeof fhClearInvalid==='function') fhClearInvalid('goal-fund'); }
function submitGoalFund(){
  var amtEl=document.getElementById('gf-amt');
  var amt=parseAmtBase(amtEl.value);
  if(!fhCheck([{el:amtEl, ok:amt>0}], L('Nhập số tiền','Enter an amount'))) return;
  var pool=(window.savings!==undefined?window.savings:savings)||0;
  amt=Math.min(amt,pool);
  if(amt<=0){ toast(L('Quỹ tiết kiệm chưa đủ','Not enough in savings')); return; }
  var id=_fundGoalId; closeModals();
  toast(L('Đã bỏ ống ','Saved ')+fmt(amt)); floatEmojis('🪙');
  if(typeof window.fhFundGoal==='function') window.fhFundGoal(id, amt);
}