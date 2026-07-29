/* ---------- saving goals (Thu Chi · Tiết kiệm) ---------- */
// A saving goal is "done" when it's fully FUNDED — never merely because its
// target date has passed (an underfunded goal past its date is overdue, not done).
function achievedGoal(g){ return !!(g && (g.achieved || (g.target>0 && g.saved>=g.target))); }
function renderGoals(){
  var goals=window.goals||{}, ord=window.goalOrder||[];
  var live=ord.filter(function(g){ return !achievedGoal(goals[g]); });   // active goals only
  var pool=(window.savings!==undefined?window.savings:savings)||0;
  var totalTarget=live.reduce(function(s,g){return s+(goals[g].target||0);},0);
  var totalSaved=live.reduce(function(s,g){return s+(goals[g].saved||0);},0);
  var totSav=totalSaved+pool, goal=totalTarget, still=Math.max(0,goal-totSav);
  var savPct=goal?Math.min(100,totSav/goal*100):0;
  setTxt('sav-total',fmt(totSav)); setTxt('ev-goal',fmt(goal));
  var sf=document.getElementById('sav-fill'); if(sf)sf.style.width=savPct+'%';
  setHTML('ev-tosave','<b>'+fmt(still)+'</b> '+L('còn phải để dành','left to save'));
  setTxt('sav-avail-lbl',fmt(pool)+' '+L('sẵn có','available'));
  var eb=document.getElementById('ev-badge');
  if(eb){ var dueSoon=live.filter(function(g){var e=goals[g]; return e.d&&daysLeft(e.d)<=30;})
            .reduce(function(s,g){return s+Math.max(0,goals[g].target-goals[g].saved);},0);
          if(dueSoon>0){ eb.className='b-badge over'; eb.textContent=fmt(dueSoon)+' '+L('sắp đến hạn','due soon'); }
          else { eb.className='b-badge ok'; eb.textContent=L('không có hạn gấp','nothing due soon'); } }
  // show every goal (active first, then fully-funded) — nothing a user makes vanishes
  var listed=ord.slice().sort(function(a,b){
    var aa=achievedGoal(goals[a])?1:0, bb=achievedGoal(goals[b])?1:0; if(aa!==bb) return aa-bb;
    var da=goals[a].d?goals[a].d.getTime():Infinity, db=goals[b].d?goals[b].d.getTime():Infinity; return da-db;
  });
  var rows=listed.map(function(g){
    var e=goals[g], pct=e.target>0?Math.min(100,Math.round(e.saved/e.target*100)):0, funded=e.saved>=e.target;
    var occ=e.occasion_id?' · 🔗 '+L('dịp','occasion'):'';
    var overdue=(!funded && e.d && e.d<TODAY)?' · <span style="color:var(--amber)">'+L('quá hạn','overdue')+'</span>':'';
    return '<div class="goal-row" onclick="fundGoal(&#39;'+escAttr(g)+'&#39;)">'
      +'<div class="goal-ico">'+esc(e.emoji)+'</div>'
      +'<div class="goal-mid"><div class="r-t">'+esc(e.name)+(funded?' <span class="ev-ready">✓</span>':'')+'</div>'
        +'<div class="r-s">'+fmt(e.saved)+' / '+fmt(e.target)+occ+overdue+'</div>'
        +'<div class="goal-meter"><i style="width:'+pct+'%"></i></div></div>'
      +'<div class="goal-pct">'+pct+'%</div>'
    +'</div>';
  }).join('');
  setHTML('goals-list', rows ? '<div class="goal-group">'+rows+'</div>'
    : '<div class="mem-empty" style="margin:0 16px"><div class="me-emoji">🎯</div><div class="me-t">'+L('Chưa có mục tiêu','No goals yet')+'</div><p>'+L('Để dành tiền cho điều bạn muốn mua hoặc làm.','Save up for something you want to buy or do.')+'</p><span onclick="openGoal()" style="display:inline-block;margin-top:12px;color:var(--brand-ink);font-size:14px;font-weight:600;cursor:pointer">＋ '+L('Tạo mục tiêu đầu tiên','Create your first goal')+'</span></div>');
}
function onGoalInput(){
  var name=(document.getElementById('goal-name').value||'').trim();
  var amt=parseAmtBase(document.getElementById('goal-amt').value);
  var b=document.getElementById('goal-save'); if(b) b.classList.toggle('on', !!(name&&amt>0));
}
function openGoal(){
  ['goal-name','goal-amt','goal-date','goal-init'].forEach(function(id){ var e=document.getElementById(id); if(e)e.value=''; });
  var b=document.getElementById('goal-save'); if(b)b.classList.remove('on');
  openSheet('goal-modal');
  setTimeout(function(){ var n=document.getElementById('goal-name'); if(n)n.focus(); },260);
}
function submitGoal(){
  var name=(document.getElementById('goal-name').value||'').trim();
  var target=parseAmtBase(document.getElementById('goal-amt').value);
  if(!name||!target){ toast(L('Nhập tên và số tiền mục tiêu','Enter a name and target amount')); return; }
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
  var sv=document.getElementById('gf-save'); if(sv)sv.classList.remove('on');
  openSheet('goal-fund');
  setTimeout(function(){ var a2=document.getElementById('gf-amt'); if(a2)a2.focus(); },260);
}
function onGoalFundInput(){ var amt=parseAmtBase(document.getElementById('gf-amt').value); var b=document.getElementById('gf-save'); if(b) b.classList.toggle('on', amt>0); }
function submitGoalFund(){
  var amt=parseAmtBase(document.getElementById('gf-amt').value);
  if(!amt){ toast(L('Nhập số tiền','Enter an amount')); return; }
  var pool=(window.savings!==undefined?window.savings:savings)||0;
  amt=Math.min(amt,pool);
  if(amt<=0){ toast(L('Quỹ tiết kiệm chưa đủ','Not enough in savings')); return; }
  var id=_fundGoalId; closeModals();
  toast(L('Đã bỏ ống ','Saved ')+fmt(amt)); floatEmojis('🪙');
  if(typeof window.fhFundGoal==='function') window.fhFundGoal(id, amt);
}