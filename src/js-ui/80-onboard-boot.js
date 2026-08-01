/* ---------- onboarding ---------- */
var FAM={
  user:{name:'Emma',role:'Parent',color:'#6f3fc0'},
  familyName:'The Reeds', mode:'create',
  members:[{name:'Emma',color:'#6f3fc0'},{name:'James',color:'#0e8478'},{name:'Mia',color:'#f0701a'},{name:'Leo',color:'#e03d86'}],
  budget:9000
};
var OB_COLORS=['#6f3fc0','#0e8478','#f0701a','#e03d86','#1e74d0','#B8730B','#7A5AE0','#1a9d5f'];
var OB_ROLES=['Mom','Dad','Husband','Wife','Boyfriend','Girlfriend','Partner','Sweetheart','Sweetie','Coldheart','Man of steel','Parent','Son','Daughter','Kid','Teen','Sibling','Guardian','Grandma','Grandpa','Other'];
var obOrder=['welcome','locale','auth','choice','join','profile','family','budget','theme','done'];
var obProg={welcome:0,locale:.1,auth:.2,choice:.34,join:.52,profile:.6,family:.74,budget:.86,theme:.93,done:1};
function obPickLang(btn){ pick('ob-lang',btn); LANG=btn.dataset.v; applyLang(); }
function obPickCur(btn){ pick('ob-cur',btn); CUR=btn.dataset.v; }
function inits(n){ return ((n||'').trim().split(/\s+/).map(function(w){return w[0]||'';}).join('').slice(0,2)||'?').toUpperCase(); }
var OB_ROLE_LABELS={Mom:['Mẹ','Mom'],Dad:['Bố','Dad'],Husband:['Chồng','Husband'],Wife:['Vợ','Wife'],Boyfriend:['Bạn trai','Boyfriend'],Girlfriend:['Bạn gái','Girlfriend'],Partner:['Bạn đời','Partner'],Sweetheart:['Người thương','Sweetheart'],Sweetie:['Cưng','Sweetie'],Coldheart:['Tảng băng','Coldheart'],'Man of steel':['Người sắt','Man of steel'],Parent:['Phụ huynh','Parent'],Son:['Con trai','Son'],Daughter:['Con gái','Daughter'],Kid:['Nhóc','Kid'],Teen:['Tuổi teen','Teen'],Sibling:['Anh chị em','Sibling'],Guardian:['Người giám hộ','Guardian'],Grandma:['Bà','Grandma'],Grandpa:['Ông','Grandpa'],Other:['Khác','Other']};
function roleLabel(r){ var m=OB_ROLE_LABELS[r]; return m?L(m[0],m[1]):r; }   // localized display; value stays English (data)
function roleOpts(sel){ return OB_ROLES.map(function(r){ return '<option value="'+r+'"'+(r===sel?' selected':'')+'>'+roleLabel(r)+'</option>'; }).join(''); }
function obGo(name){
  var ci=obOrder.indexOf(name);
  document.querySelectorAll('#onboarding .ob-screen').forEach(function(s){
    var i=obOrder.indexOf(s.dataset.ob);
    s.classList.toggle('on', i===ci); s.classList.toggle('past', i<ci);
  });
  var p = (name==='profile' && FAM.mode==='join') ? .78 : (obProg[name]||0);
  document.getElementById('ob-bar').style.width=(p*100)+'%';
  document.getElementById('ob-progress').classList.toggle('show', name!=='welcome');
  if(name==='join'){ var c=document.getElementById('ob-code'); renderCodeBoxes(c.value); setTimeout(function(){ c.focus(); },320); }
  if(name==='theme') buildObThemes();
}
function renderCodeBoxes(val){
  val=val||''; var box=document.getElementById('ob-code-boxes'); if(!box)return;
  var html=''; for(var i=0;i<6;i++){ var ch=val[i]||''; html+='<div class="ob-code-box'+(ch?' filled':(i===val.length?' cursor':''))+'">'+ch+'</div>'; }
  box.innerHTML=html;
}
function buildObThemes(){
  var box=document.getElementById('ob-theme-grid'); if(!box)return;
  box.innerHTML=THEMES.map(function(t){
    return '<div class="theme-opt'+(t.k===curTheme?' on':'')+'" onclick="applyTheme(\''+t.k+'\');buildObThemes()">'
      +'<div class="sw" style="background:'+t.grad+'"><div class="chk"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#191022" stroke-width="3.2"><path d="M5 12l5 5L20 7"/></svg></div></div>'
      +'<div class="nm">'+t.name+'</div></div>';
  }).join('');
}
/* Placeholder only. The auth module replaces this with the real Supabase flow as
   soon as it loads. If it never does (offline, CDN blocked), this must NOT wave the
   user through: it used to advance to 'choice', let them complete every onboarding
   step, and then write the whole family to localStorage only — nothing reached the
   database and nothing said so. Failing loudly here is the honest outcome. */
function obGoogle(){
  var b=document.getElementById('ob-gbtn');
  if(b){ b.disabled=true; b.style.opacity='.7'; b.querySelector('span').textContent=t('signingIn'); }
  // give a slow module a moment to arrive and overwrite this function
  setTimeout(function(){
    if(window.obGoogle!==obGoogle){ window.obGoogle(); return; }   // real one landed → hand over
    if(b){ b.disabled=false; b.style.opacity=''; b.querySelector('span').textContent=t('continueGoogle'); }
    toast(L('Không kết nối được máy chủ. Kiểm tra mạng và thử lại','Can’t reach the server. Check your connection and try again'));
  }, 1200);
}
function obChoose(mode){
  FAM.mode=mode;
  if(mode==='join'){ obGo('join'); }
  else { document.getElementById('ob-profile-back').setAttribute('onclick',"obGo('choice')"); obPrefillProfile(); obGo('profile'); }
}
function obCodeInput(el){
  el.value=el.value.toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,6);
  renderCodeBoxes(el.value);
  var ok=el.value.length>=6, pv=document.getElementById('ob-join-preview');
  document.getElementById('ob-join-cta').disabled=!ok;
  if(ok){ pv.style.display='flex'; pv.innerHTML='<div class="ob-preview-ic">🏡</div><div><div class="ob-preview-fam">The Reeds</div><div class="ob-preview-sub">'+L('4 thành viên · James mời bạn','4 members · invited by James')+'</div></div>'; }
  else pv.style.display='none';
}
function obJoin(){
  FAM.mode='join'; FAM.familyName='The Reeds';
  document.getElementById('ob-profile-back').setAttribute('onclick',"obGo('join')");
  obPrefillProfile(); obGo('profile');
}
function renderObColors(){
  document.getElementById('ob-colors').innerHTML=OB_COLORS.map(function(c){
    return '<button class="ob-swatch'+(c===FAM.user.color?' on':'')+'" style="background:'+c+'" onclick="obPickColor(\''+c+'\')"></button>';
  }).join('');
}
function obPickColor(c){ FAM.user.color=c; renderObColors(); obNameInput(); }
function obNameInput(){
  var a=document.getElementById('ob-avatar'), n=document.getElementById('ob-name').value;
  a.textContent=inits(n); a.style.background=FAM.user.color;
}
function obPrefillProfile(){ document.getElementById('ob-name').value=''; renderObColors(); obNameInput(); }
function obProfileNext(){
  var n=document.getElementById('ob-name').value.trim(); if(!n){ document.getElementById('ob-name').focus(); return; }
  FAM.user.name=n; FAM.user.role=chosen('ob-role')||'Parent';
  if(FAM.mode==='create'){ obPrefillFamily(); obGo('family'); }
  else { FAM.members=[{name:n,email:FAM.user.email||'',color:FAM.user.color,role:FAM.user.role,me:true}]; document.getElementById('ob-theme-back').setAttribute('onclick',"obGo('profile')"); obGo('theme'); }
}
function obMemberRowHTML(name,email,role,color,me){
  return '<div class="ob-mcard">'
    +'<div class="ob-mrow"><div class="ob-mav" style="background:'+color+'">'+inits(name)+'</div>'
    +'<input class="ob-mname" value="'+String(name||'').replace(/"/g,'&quot;')+'" placeholder="'+L('vd. Mai','e.g. Emma')+'"'+(me?' readonly':'')+' oninput="obSyncMav(this)">'
    +(me?'<span class="ob-mtag">'+t('you')+'</span>':'<button class="ob-mdel" onclick="this.closest(\'.ob-mcard\').remove()" aria-label="'+L('Xoá','Remove')+'"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg></button>')
    +'</div>'
    +'<div class="ob-mfields">'
    +'<input class="ob-memail" type="email" inputmode="email" autocapitalize="off" placeholder="name@gmail.com" value="'+String(email||'').replace(/"/g,'&quot;')+'"'+(me?' readonly':'')+'>'
    +'<select class="ob-mrole">'+roleOpts(role)+'</select>'
    +'</div></div>';
}
function obSyncMav(inp){ var av=inp.previousElementSibling; if(av) av.textContent=inits(inp.value); }
function obPrefillFamily(){
  document.getElementById('ob-famname').value='';                 // start empty — the user names it
  document.getElementById('ob-members').innerHTML=obMemberRowHTML(FAM.user.name,FAM.user.email||'',FAM.user.role,FAM.user.color,true);
}
function obAddMember(){
  var used=document.querySelectorAll('#ob-members .ob-mcard').length;
  document.getElementById('ob-members').insertAdjacentHTML('beforeend', obMemberRowHTML('','','Kid',OB_COLORS[(used+2)%OB_COLORS.length],false));
}
function obFamilyNext(){
  var fn=document.getElementById('ob-famname').value.trim(); if(!fn){ document.getElementById('ob-famname').focus(); return; }
  FAM.familyName=fn;
  var mems=[];
  document.querySelectorAll('#ob-members .ob-mcard').forEach(function(row,i){
    var nm=row.querySelector('.ob-mname').value.trim(); if(!nm)return;
    mems.push({name:nm, email:(row.querySelector('.ob-memail')||{value:''}).value.trim(), role:row.querySelector('.ob-mrole').value, color:row.querySelector('.ob-mav').style.background||OB_COLORS[i%OB_COLORS.length], me:!!row.querySelector('.ob-mtag')});
  });
  FAM.members=mems.length?mems:[{name:FAM.user.name,email:FAM.user.email||'',color:FAM.user.color,role:FAM.user.role,me:true}];
  obPrefillBudget(); obGo('budget');
}
var BUDGET_PROPS={Housing:.30,Groceries:.14,Transport:.10,Others:.08,Dining:.08,Fun:.06};   // best-practice proportions
function obPrefillBudget(){
  var sym=document.getElementById('ob-budget-sym'); if(sym) sym.textContent=curSym();
  document.getElementById('ob-budget').setAttribute('placeholder', CUR==='VND'?'30.000.000':'9,000');
  document.getElementById('ob-catbudgets').innerHTML = catOrder.map(function(c){
    var s=catStyle[c]||['🏷️'];
    return '<div class="ob-catbud"><span class="ob-catbud-ic" style="background:'+s[1]+';color:'+s[2]+'">'+s[0]+'</span><span class="ob-catbud-n">'+c+'</span>'
      +'<span class="cat-bud-wrap">'+curSym()+'<input class="cat-bud num" data-cat="'+c+'" inputmode="numeric" placeholder="0"></span></div>';
  }).join('');
}
function obSuggestBudgets(){
  var total=parseAmtBase(document.getElementById('ob-budget').value); if(!total) return;   // total in base units
  var loc = CUR==='VND'?'vi-VN':'en-US';
  document.querySelectorAll('#ob-catbudgets .cat-bud').forEach(function(inp){
    var c=inp.getAttribute('data-cat'), prop=(BUDGET_PROPS[c]!==undefined)?BUDGET_PROPS[c]:(0.7/Math.max(1,catOrder.length));
    var base=Math.round(total*prop/10)*10;                        // round base value
    inp.value = base ? (base*curMult()).toLocaleString(loc) : '';  // shown in the display currency
  });
}
function obBudgetNext(){
  FAM.budget=parseAmtBase(document.getElementById('ob-budget').value)||9000;
  FAM.catBudget={};
  document.querySelectorAll('#ob-catbudgets .cat-bud').forEach(function(inp){
    var c=inp.getAttribute('data-cat'), v=parseAmtBase(inp.value)||catBudget[c]||0; FAM.catBudget[c]=v;
  });
  document.getElementById('ob-theme-back').setAttribute('onclick',"obGo('budget')");
  obGo('theme');
}
function obThemeNext(){ obPrepDone(); obGo('done'); }
function obPrepDone(){
  var nm=firstName(FAM.user.name), n=FAM.members.length, vi=(LANG==='vi');
  setTxt('ob-done-title', vi ? ('Chào mừng, '+nm+'!') : ('Welcome, '+nm+'!'));
  setTxt('ob-done-sub', FAM.mode==='join'
    ? (vi ? ('Bạn đã tham gia '+FAM.familyName+'.') : ('You\'ve joined '+FAM.familyName+'.'))
    : (vi ? (FAM.familyName+' đã sẵn sàng với '+n+' thành viên.') : (FAM.familyName+' is ready with '+n+' member'+(n!==1?'s':'')+'.')));
}
function applyFam(){
  if(FAM.budget) months[curMonthKey()].budget=FAM.budget;
  if(FAM.catBudget) Object.keys(FAM.catBudget).forEach(function(c){ if(FAM.catBudget[c]) catBudget[c]=FAM.catBudget[c]; });
  var box=document.getElementById('hero-fam');
  if(box) box.innerHTML=FAM.members.slice(0,5).map(function(mm){ return '<div class="av av-hero" style="background:'+mm.color+'">'+inits(mm.name)+'</div>'; }).join('')+'<span class="hero-fam-cap">'+FAM.familyName+'</span>';
  setGreeting(); renderAll();
  try{ localStorage.setItem('fh-fam',JSON.stringify(FAM)); }catch(e){}
}
function applyCurrency(){                         // re-render every money figure in the chosen currency
  document.documentElement.classList.toggle('cur-vnd', CUR==='VND');   // longer VND figures → tighter hero type
  renderBudget(); renderEvents(); renderTxns(); renderMembers();
  try{ renderHome(); }catch(e){ if(typeof console!=='undefined') console.error('renderHome', e); }
  document.querySelectorAll('[data-amt]').forEach(function(el){         // static demo amounts (base USD units)
    var base=parseFloat(el.getAttribute('data-amt'))||0;
    el.textContent=(el.getAttribute('data-amt-pre')||'')+fmt(base)+(el.getAttribute('data-amt-suf')||'');
  });
  ['ex-amt','ng-amt','fn-amt'].forEach(function(id){ var el=document.getElementById(id); if(el) el.setAttribute('placeholder',amtPlaceholder()); });
  var bg=document.getElementById('bg-amt'); if(bg) bg.setAttribute('placeholder',amtPlaceholder());
}
function fnPreset(base){ setV('fn-amt',(base*curMult()).toLocaleString(CUR==='VND'?'vi-VN':'en-US')); }   // preset → display currency
function finishOnboarding(){
  FAM.lang=LANG; FAM.cur=CUR;
  applyFam(); applyLang(); applyCurrency();
  try{ localStorage.setItem('fh-onboarded','1'); localStorage.setItem('fh-lang',LANG); localStorage.setItem('fh-cur',CUR); }catch(e){}
  document.getElementById('onboarding').classList.add('done');
  go('home');
}
function restartOnboarding(){
  try{ localStorage.removeItem('fh-onboarded'); localStorage.removeItem('fh-fam'); localStorage.removeItem('fh-lang'); localStorage.removeItem('fh-cur'); }catch(e){}
  LANG='en'; CUR='USD'; applyLang();
  FAM={ user:{name:'',email:'',role:'Mom',color:OB_COLORS[0]}, familyName:'', mode:'create', members:[], budget:0, catBudget:null };
  document.querySelectorAll('#ob-lang .choice').forEach(function(b){ b.classList.toggle('on',b.dataset.v==='en'); });
  document.querySelectorAll('#ob-cur .choice').forEach(function(b){ b.classList.toggle('on',b.dataset.v==='USD'); });
  document.querySelectorAll('#ob-role .choice').forEach(function(b,i){ b.classList.toggle('on',i===0); });
  document.getElementById('onboarding').classList.remove('done'); obGo('welcome');
}
function obInit(){
  var done=false; try{ done=localStorage.getItem('fh-onboarded')==='1'; }catch(e){}
  if(done){
    try{ var saved=localStorage.getItem('fh-fam'); if(saved) FAM=JSON.parse(saved); }catch(e){}
    try{ var sl=localStorage.getItem('fh-lang'); if(sl) LANG=sl; }catch(e){}
    try{ var sc=localStorage.getItem('fh-cur'); if(sc) CUR=sc; }catch(e){}
    applyFam(); applyLang(); applyCurrency();
    document.getElementById('onboarding').classList.add('done');
  } else {
    FAM={ user:{name:'',email:'',role:'Mom',color:OB_COLORS[0]}, familyName:'', mode:'create', members:[], budget:0, catBudget:null };  // fresh: everything entered manually
  }
}

/* ---------- warm start ----------
   The DB hydrate needs a module import + ~10 network round-trips, so a signed-in
   user used to stare at a splash every launch. We cache the last-known state and
   replay it here — synchronously, before the first render — so the app opens on
   real data. loadFamilyData() then refreshes in the background and re-renders.
   Cache is display state only; it is never trusted for writes (the DB maps it
   carries are replaced wholesale by the hydrate). */
// v2: v1 snapshots cached expired *signed* photo URLs, which would warm-boot into
// broken images now that photos resolve to stable public URLs. Bumping discards
// them — one cold start for existing users, then clean.
var FH_SNAP='fh-snap', FH_SNAP_V=2, FH_SNAP_TTL=14*86400000;   // a fortnight of staleness is plenty
function fhSaveSnapshot(){
  try{
    var ev={};                                          // events carry a live Date — store epoch ms
    Object.keys(events||{}).forEach(function(k){ var e=events[k], c={}; for(var p in e) c[p]=e[p]; c.d=e.d?e.d.getTime():null; ev[k]=c; });
    localStorage.setItem(FH_SNAP, JSON.stringify({
      v:FH_SNAP_V, at:Date.now(),
      FAM:FAM, membersMeta:membersMeta, catOrder:catOrder, catStyle:catStyle, catBudget:catBudget,
      txns:txns, months:months, monthOrder:monthOrder, selMonth:selMonth,
      events:ev, order:order, savings:savings, curEvent:curEvent,
      LANG:LANG, CUR:CUR, DB:window.DB || null
    }));
  }catch(e){}                                            // quota/private-mode: warm start is optional
}
function fhRestoreSnapshot(){
  try{
    var raw=localStorage.getItem(FH_SNAP); if(!raw) return false;
    var s=JSON.parse(raw);
    if(!s || s.v!==FH_SNAP_V || !s.catOrder || !s.months) return false;
    if(s.at && Date.now()-s.at > FH_SNAP_TTL) return false;
    FAM=s.FAM||FAM; membersMeta=s.membersMeta||membersMeta;
    catOrder=s.catOrder; catStyle=s.catStyle||{}; catBudget=s.catBudget||{};
    txns=s.txns||[]; months=s.months||{}; monthOrder=s.monthOrder||[]; selMonth=s.selMonth||selMonth;
    order=s.order||[]; savings=s.savings||0; curEvent=s.curEvent||null;
    events={}; Object.keys(s.events||{}).forEach(function(k){ var e=s.events[k]; e.d=e.d?new Date(e.d):null; events[k]=e; });
    if(s.LANG) LANG=s.LANG; if(s.CUR) CUR=s.CUR;
    window.__fhSnapDB=s.DB||null;                        // handed to the module's DB init below
    return true;
  }catch(e){ return false; }
}
// fresh data has landed (or we gave up): retire the "Updating…" chip. Defined FIRST so a
// later boot error can't leave it undefined (the hydrate calls it).
window.fhFresh=function(){ document.documentElement.classList.remove('fh-stale'); };
/* EVERY fragile boot step is isolated: a throw in any one of them must NOT halt this script,
   because the gesture wiring at the bottom (sheet drag-to-dismiss + photo-peek handlers) is
   attached here — and losing it silently breaks "drag to close" / "tap to close" everywhere.
   The Supabase hydrate re-renders regardless, so a skipped initial render is invisible. */
try{ obInit(); }catch(e){ if(typeof console!=='undefined') console.error('obInit failed', e); }   // restore lang/currency + family before first paint
var fhWarm=false;
try{ fhWarm=fhRestoreSnapshot(); }catch(e){}   // richer snapshot wins over fh-fam/lang/cur
if(fhWarm){                                              // cached state is on screen — no splash, no sign-in flash
  try{ applyFam(); applyLang(); }catch(e){ if(typeof console!=='undefined') console.error('warm apply failed', e); }
  var _obEl=document.getElementById('onboarding'); if(_obEl) _obEl.classList.add('done');
  document.documentElement.classList.add('fh-warm','fh-stale');   // fh-stale → "Updating…" until fresh data lands
} else {
  document.documentElement.classList.remove('fh-warm-boot');   // no cache — let the splash cover the mock data
}
try{ setGreeting(); }catch(e){}
try{ renderEvents(); renderAll(); renderTxns(); applyCurrency(); }
catch(e){ if(typeof console!=='undefined') console.error('initial render failed', e); }
document.querySelectorAll('.sheet').forEach(function(s){ initSheetDrag(s, closeSheet); });   // drag-down-to-dismiss on every bottom sheet
document.querySelectorAll('.modal').forEach(function(m){ initSheetDrag(m, closeModals); });  // …and every full-screen modal

/* peek: tapping the blurred surround dismisses; tapping the photo reveals the
   delete CTA. Bound here rather than inline so the two targets can't be confused. */
(function(){
  var pk=document.getElementById('peek'); if(!pk)return;
  // Tap anywhere closes (photo, backdrop, ✕) — the delete pill is the only exception,
  // and it runs its own arm-then-confirm.
  document.getElementById('peek-actions').addEventListener('click', function(ev){ ev.stopPropagation(); });
  pk.addEventListener('click', function(ev){ if(!(ev.target.closest && ev.target.closest('#peek-actions'))) closePeek(); });
  // swipe down to dismiss, matching the app's other rising layers
  var y0=null;
  pk.addEventListener('touchstart', function(ev){ y0=ev.touches[0].clientY; }, {passive:true});
  pk.addEventListener('touchend', function(ev){
    if(y0===null)return;
    var dy=(ev.changedTouches[0].clientY-y0); y0=null;
    // iOS doesn't fire `click` on taps of plain <div>s, so the click handler above only
    // covers desktop — close here on a swipe-down OR a tap anywhere except the delete pill.
    if(ev.target.closest && ev.target.closest('#peek-actions')) return;
    if(dy>70 || Math.abs(dy)<12) closePeek();
  }, {passive:true});
})();

/* ---------- deep links ---------- */
(function(){
  var h=(location.hash||'').replace('#','');
  if(!h)return;
  if(h.indexOf('event-')===0){ openEvent(h.slice(6)); return; }
  if(h.indexOf('sheet-')===0){ openSheet(h); return; }
  if(['overview','budget'].indexOf(h)>=0){ go('spending'); return; }
  if(['breakdown','member'].indexOf(h)>=0){ go('spending'); segTo('breakdown'); return; }
  if(['activity','tx'].indexOf(h)>=0){ go('spending'); segTo('activity'); return; }
  if(h==='memories'){ goMoments('album'); return; }
  if(h==='events'){ goMoments('plans'); return; }
  if(['home','spending'].indexOf(h)>=0) go(h);
})();

/* ---------- connectivity ----------
   Writes are optimistic and fire-and-forget, so going offline silently would let
   someone log a whole evening of expenses that never leave the device. */
function fhSyncOnline(){
  var off = (navigator.onLine===false);
  document.documentElement.classList.toggle('fh-offline', off);
  if(!off && window.DB && window.DB.fid && window.loadFamilyData) window.loadFamilyData();  // catch up
}
window.addEventListener('online', fhSyncOnline);
window.addEventListener('offline', fhSyncOnline);
fhSyncOnline();

if('serviceWorker' in navigator){
  window.addEventListener('load',function(){
    var refreshing=false;
    navigator.serviceWorker.addEventListener('controllerchange',function(){ if(refreshing)return; refreshing=true; location.reload(); });   // new build activated → reload into it
    navigator.serviceWorker.register('sw.js').then(function(reg){
      reg.update();
      document.addEventListener('visibilitychange',function(){ if(document.visibilityState==='visible') reg.update(); });   // check for updates on foreground
    }).catch(function(){});
  });
}