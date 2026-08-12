/* ---------- onboarding ----------
   Curated 2-step flow (0050): intro + Google sign-in → your family (join the
   invite waiting for you, or name a new home) → straight into the app. Locale
   is device-detected (no picker); budget, members, theme all moved into the
   app where they belong. The Key Card intro still lands right after create. */
var FAM={
  user:{name:'Emma',role:'Parent',color:'#6f3fc0'},
  familyName:'The Reeds', mode:'create',
  members:[{name:'Emma',color:'#6f3fc0'},{name:'James',color:'#0e8478'},{name:'Mia',color:'#f0701a'},{name:'Leo',color:'#e03d86'}],
  budget:9000
};
var OB_COLORS=['#6f3fc0','#0e8478','#f0701a','#e03d86','#1e74d0','#B8730B','#7A5AE0','#1a9d5f'];
var obOrder=['welcome','start','budget'];
function inits(n){ return ((n||'').trim().split(/\s+/).map(function(w){return w[0]||'';}).join('').slice(0,2)||'?').toUpperCase(); }
/* light tactile tick — vibration is a no-op where unsupported (iOS Safari) */
function obBuzz(p){ try{ if(navigator.vibrate) navigator.vibrate(p); }catch(e){} }
function obGo(name){
  var ci=obOrder.indexOf(name);
  document.querySelectorAll('#onboarding .ob-screen').forEach(function(s){
    var i=obOrder.indexOf(s.dataset.ob);
    s.classList.toggle('on', i===ci); s.classList.toggle('past', i<ci);
  });
  if(name==='start'){
    obAcctLine();
    var bk=document.getElementById('ob-start-back');
    if(bk) bk.style.visibility = window.__obFromPicker ? 'visible' : 'hidden';   // back only leads somewhere when the picker opened us
  }
}
/* back from "Your family" → the family picker that opened it (multi-family only) */
function obStartBack(){ if(window.fhSwitchFamily) window.fhSwitchFamily(); }
function renderCodeBoxes(val){
  val=val||''; var box=document.getElementById('ob-code-boxes'); if(!box)return;
  var html=''; for(var i=0;i<6;i++){ var ch=val[i]||''; html+='<div class="ob-code-box'+(ch?' filled':(i===val.length?' cursor':''))+'">'+ch+'</div>'; }
  box.innerHTML=html;
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
/* kept for the family-picker "create another family" path (10-client-auth) */
function obChoose(mode){ FAM.mode=mode||'create'; obGo('start'); }
// Identity comes from the Google account (afterLogin seeds FAM.user.name/email).
// Give the member a stable avatar color derived from the email/name; both are
// editable later in Settings → My profile. Onboarding never asks for name/role/color.
function obUserColor(){ var s=(FAM.user.email||FAM.user.name||'x'), h=0,i; for(i=0;i<s.length;i++){ h=((h*31)+s.charCodeAt(i))>>>0; } return OB_COLORS[h%OB_COLORS.length]; }
function obEnsureUserIdentity(){
  if(!FAM.user.name){ var em=FAM.user.email||''; FAM.user.name = em ? em.split('@')[0] : L('Tôi','Me'); }
  FAM.user.color = obUserColor();
}
/* Placeholder pair — the data module (65-passcode-ui) replaces both with the
   real find-invite + join_with_passcode flow. Offline/CDN-blocked, joining is
   impossible, so the mock only keeps the input tidy and never fakes a family. */
function obCodeInput(el){
  el.value=el.value.replace(/\D/g,'').slice(0,6);
  renderCodeBoxes(el.value);
  if(typeof fhClearInvalid==='function') fhClearInvalid('ob-code-boxes');   // clear the red as they type (Join stays enabled, DESIGN §4.4)
}
function obJoin(){
  var el=document.getElementById('ob-code'), code=(el?el.value:'').trim();
  if(!/^\d{6}$/.test(code)){ if(typeof fhFlagField==='function') fhFlagField(document.getElementById('ob-code-boxes')); if(el)el.focus(); toast(L('Nhập đủ 6 chữ số','Enter all 6 digits')); return; }
  toast(L('Không kết nối được máy chủ. Kiểm tra mạng và thử lại','Can’t reach the server. Check your connection and try again'));
}
/* quiet footer line: which Google account this home will belong to */
function obAcctLine(){
  var el=document.getElementById('ob-acct'); if(!el) return;
  var em=(FAM.user&&FAM.user.email)||'';
  el.innerHTML = em
    ? esc(em)+' · <button class="ob-acct-link" onclick="if(window.fhSignOut)fhSignOut()">'+L('Đổi tài khoản','Switch account')+'</button>'
    : '';
}
/* The default categories a brand-new family gets. MUST mirror
   seed_default_categories() (0003) in the SAME ORDER — the server seeds these at
   create_family, and the app renders from catOrder until the first hydrate lands
   (catOrder starts empty otherwise). */
var DEFAULT_CATS=[
  {concept:'Housing',   vi:'Nhà ở',   en:'Housing',   emoji:'🏠', color:'#7E6BE0'},
  {concept:'Groceries', vi:'Đi chợ',  en:'Groceries', emoji:'🛒', color:'#1FA971'},
  {concept:'Dining',    vi:'Ăn ngoài',en:'Dining',    emoji:'🍽️', color:'#E14B8A'},
  {concept:'Transport', vi:'Đi lại',  en:'Transport', emoji:'🚗', color:'#12B5A6'},
  {concept:'Fun',       vi:'Giải trí',en:'Fun',       emoji:'🎉', color:'#9D4EFF'},
  {concept:'Shopping',  vi:'Mua sắm', en:'Shopping',  emoji:'🛍️', color:'#E8843C'}
];
// "Con cái"/Kids is intentionally NOT a default category — a family without kids
// shouldn't start with an empty kids line, and those who want it can add it. Kids
// spending falls under Groceries/Fun/Others until then. Its old budget weight is
// reallocated to the remaining defaults in CATW (20-budget.js).
function obSeedCats(){
  var names=DEFAULT_CATS.map(function(d){ return (LANG==='vi'?d.vi:d.en); });
  catOrder=names.slice(); catStyle={};
  DEFAULT_CATS.forEach(function(d,i){ catStyle[names[i]]=[d.emoji,'#f2eef6',d.color]; });
  ensureFallbackCat(catOrder,catStyle,catBudget||(catBudget={}));   // append the "Others" catch-all
}
/* Create: validate the name + seed the member/categories, then step into the
   budget setup screen (obBudgetNext/obBudgetSkip finish from there → create_family
   → fullscreen Key Card intro). A joiner never sees this — they inherit the
   family's categories + budget. */
function obCreateFamily(){
  var inp=document.getElementById('ob-famname'), fn=(inp?inp.value:'').trim();
  if(!fhCheck([{el:inp, ok:!!fn}], L('Đặt tên cho gia đình đã nhé','Give your family a name first'))) return;
  obEnsureUserIdentity();
  FAM.mode='create'; FAM.familyName=fn;
  FAM.members=[{name:FAM.user.name,email:FAM.user.email||'',color:FAM.user.color,me:true}];
  FAM.catBudget=null;
  obSeedCats();
  obPrefillBudget();
  obGo('budget');
  return;
}
/* Budget setup step (create only). Categories are already seeded (obSeedCats);
   this renders one budget field + a per-category list that auto-splits from the
   total using the app's own weights (CATW, 20-budget.js), so onboarding and the
   in-app editor suggest the same thing. Everything is optional — Continue with an
   empty budget (or "Set up later") just leaves the home/finance nudges to catch it. */
function obPrefillBudget(){
  var body=document.getElementById('ob-budget-body'); if(!body) return;
  var sym=curSym();
  var rows=catOrder.filter(function(c){ return !isFallbackCat(c); }).map(function(c){
    var s=catStyle[c]||['🏷️','#f2eef6','#7a5a6e'];
    return '<div class="ob-catbud"><span class="ob-catbud-ic" style="background:'+s[1]+';color:'+s[2]+'">'+s[0]+'</span>'
      +'<span class="ob-catbud-n">'+esc(c)+'</span>'
      +'<span class="ob-catbud-in">'+sym+'<input class="ob-cat-bud num" data-cat="'+escAttr(c)+'" inputmode="numeric" placeholder="0" oninput="this.dataset.touched=\'1\'"></span></div>';
  }).join('');
  body.innerHTML =
    '<div class="ob-head st" style="--i:0"><h1 class="ob-h1">'+L('Ngân sách của nhà','Your budget')+'</h1>'
    +'<div class="ob-sub">'+L('Đặt mục tiêu chi tiêu hằng tháng cho cả nhà. Chỉnh lúc nào cũng được.','A monthly spending target for the family. Change it anytime.')+'</div></div>'
    +'<div class="ob-total-card st" style="--i:1"><label>'+L('Ngân sách hằng tháng','Monthly budget')+'</label>'
    +'<div class="ob-total-in"><span class="ob-total-sym" id="ob-budget-sym">'+sym+'</span>'
    +'<input class="ob-total-input num" id="ob-budget" inputmode="numeric" enterkeyhint="done" placeholder="'+(CUR==='VND'?'20.000.000':'9,000')+'" oninput="obSuggestBudgets()"></div></div>'
    +'<div class="ob-catbud-lead st" style="--i:2"><div class="ob-lab">'+L('Ngân sách theo hạng mục','Category budgets')+'</div>'
    +'<div class="ob-catbud-hint">'+L('Tụi mình gợi ý sẵn từ tổng, chỉnh thoải mái nha.','We suggest a split from your total. Adjust freely.')+'</div></div>'
    +'<div class="ob-group st" id="ob-catbudgets" style="--i:3">'+rows+'</div>';
  var cta=document.getElementById('ob-budget-cta'); if(cta) cta.textContent=L('Tiếp tục','Continue');
  var sk=document.getElementById('ob-budget-skip'); if(sk) sk.textContent=L('Để sau','Set up later');
  setTimeout(function(){ var b=document.getElementById('ob-budget'); if(b) try{ b.focus(); }catch(e){} }, 460);
}
/* Auto-split the monthly total across untouched categories (touched ones are left
   as the user set them). Mirrors suggestBudgetSplit() in 20-budget.js. */
function obSuggestBudgets(){
  var el=document.getElementById('ob-budget'); if(!el) return;
  var total=parseAmtBase(el.value); if(!total) return;
  var inputs=[].slice.call(document.querySelectorAll('#ob-catbudgets .ob-cat-bud'));
  var free=inputs.filter(function(i){ return i.dataset.touched!=='1'; });
  if(!free.length) return;
  var spoken=0; inputs.forEach(function(i){ if(i.dataset.touched==='1') spoken+=parseAmtBase(i.value)||0; });
  var pool=Math.max(0,total-spoken);
  var ws=free.map(function(i){ var n=(i.getAttribute('data-cat')||'').trim().toLowerCase(); return (typeof CATW!=='undefined'&&CATW[n]!==undefined)?CATW[n]:0.08; });
  var sum=ws.reduce(function(a,b){return a+b;},0)||1;
  free.forEach(function(i,k){ var base=Math.round(pool*(ws[k]/sum)/10)*10; i.value=base?amtToInput(base):''; });
}
function obBudgetNext(){
  FAM.budget=parseAmtBase((document.getElementById('ob-budget')||{value:''}).value)||0;
  FAM.catBudget={};
  document.querySelectorAll('#ob-catbudgets .ob-cat-bud').forEach(function(inp){
    var c=inp.getAttribute('data-cat'), v=parseAmtBase(inp.value)||0; if(v>0) FAM.catBudget[c]=v;
  });
  finishOnboarding();
}
function obBudgetSkip(){ FAM.budget=0; FAM.catBudget=null; finishOnboarding();
}
function applyFam(){
  if(FAM.budget) months[curMonthKey()].budget=FAM.budget;
  if(FAM.catBudget) Object.keys(FAM.catBudget).forEach(function(c){ if(FAM.catBudget[c]) catBudget[c]=FAM.catBudget[c]; });
  var box=document.getElementById('hero-fam');
  if(box) box.innerHTML=FAM.members.slice(0,5).map(function(mm){ return '<div class="av av-hero" style="background:'+mm.color+'">'+esc(inits(mm.name))+'</div>'; }).join('')+'<span class="hero-fam-cap">'+esc(FAM.familyName)+'</span>';
  setGreeting(); renderAll();
  try{ localStorage.setItem('fh-fam',JSON.stringify(FAM)); }catch(e){}
}
function applyCurrency(){                         // re-render every money figure in the chosen currency
  document.documentElement.classList.toggle('cur-vnd', CUR==='VND');   // longer VND figures → tighter hero type
  renderBudget(); renderEvents(); renderTxns(); renderMembers();
  try{ renderHome(); }catch(e){ if(typeof console!=='undefined') console.error('renderHome', e); }
  document.querySelectorAll('[data-amt]').forEach(function(el){         // static demo amounts (base units → display currency)
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
  try{ if(window.fhMarkReleasesSeen) fhMarkReleasesSeen(); }catch(e){}   // fresh user starts clean — no past-release backlog
  obBuzz([10,40,16]);                                                    // the "you're in" moment
  document.getElementById('onboarding').classList.add('done');
  go('home');
  try{ if(window.fhInstallNudge) window.fhInstallNudge(); }catch(e){}   // earned-moment install nudge (once, dismissible, only if installable)
}
/* device locale, re-derived (mirrors the LANG bootstrap in 70-theme-i18n) */
function obDeviceLang(){
  try{
    var n=(navigator.language||navigator.userLanguage||navigator.languages&&navigator.languages[0]||'').toLowerCase();
    return n.indexOf('vi')===0 ? 'vi' : 'en';
  }catch(e){ return 'en'; }
}
function restartOnboarding(){
  try{ localStorage.removeItem('fh-onboarded'); localStorage.removeItem('fh-fam'); localStorage.removeItem('fh-lang'); localStorage.removeItem('fh-cur'); }catch(e){}
  LANG=obDeviceLang(); CUR='VND'; applyLang();   // VND-only frontend (USD is a legacy-render fallback, never produced here)
  FAM={ user:{name:'',email:'',color:OB_COLORS[0]}, familyName:'', mode:'create', members:[], budget:0, catBudget:null };
  window.__obFromPicker=false;
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
    FAM={ user:{name:'',email:'',color:OB_COLORS[0]}, familyName:'', mode:'create', members:[], budget:0, catBudget:null };  // fresh: name/color seeded from the Google account after sign-in
    CUR='VND';                       // VND-only frontend — every new family is VND (no locale picker; LANG still follows the device)
    try{ applyLang(); }catch(e){}    // a Vietnamese device reads the intro in Vietnamese
  }
}
/* haptics: a light tick on every onboarding button press (Android; iOS ignores) */
(function(){
  var ob=document.getElementById('onboarding');
  if(ob) ob.addEventListener('pointerdown',function(ev){ if(ev.target && ev.target.closest && ev.target.closest('button')) obBuzz(6); },{passive:true});
})();

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
var _snapSaveAt=0;
function fhSaveSnapshot(){
  // Hydrate now runs often (windowed refresh on focus/realtime/every write), so coalesce
  // save bursts — warm-boot data is allowed to be seconds stale, and this avoids
  // re-serializing (and, for a large family, re-writing to IndexedDB) on every tick.
  if(Date.now()-_snapSaveAt < 2500) return;
  _snapSaveAt=Date.now();
  try{
    var ev={};                                          // events carry a live Date — store epoch ms
    Object.keys(events||{}).forEach(function(k){ var e=events[k], c={}; for(var p in e) c[p]=e[p]; c.d=e.d?e.d.getTime():null; ev[k]=c; });
    var data={
      v:FH_SNAP_V, at:Date.now(),
      FAM:FAM, membersMeta:membersMeta, catOrder:catOrder, catStyle:catStyle, catBudget:catBudget,
      txns:txns, months:months, monthOrder:monthOrder, selMonth:selMonth,
      events:ev, order:order, savings:savings, curEvent:curEvent,
      LANG:LANG, CUR:CUR, DB:window.DB || null
    };
    // The module writer (17-snap-restore) chooses the tier: small plaintext →
    // localStorage (sync warm boot), large plaintext or committed-enc → IndexedDB
    // (async restore; enc is a v3 AES-GCM envelope so plaintext never hits disk).
    if(window.fhSnapStore){ window.fhSnapStore(data); return; }
    localStorage.setItem(FH_SNAP, JSON.stringify(data));   // fallback only if the module hasn't loaded
  }catch(e){}                                            // quota/private-mode: warm start is optional
}
function fhRestoreSnapshot(){
  try{
    var raw=localStorage.getItem(FH_SNAP);
    if(raw){                                             // small plaintext (or a legacy v3 enc envelope) in localStorage
      var s=JSON.parse(raw);
      if(s && s.v===3 && s.ct){                          // legacy enc envelope in LS → module decrypts + applies async
        if(!(s.at && Date.now()-s.at > FH_SNAP_TTL)) window.__fhSnapEnc=s;
        return false;
      }
      if(!s || s.v!==FH_SNAP_V || !s.catOrder || !s.months) return false;
      if(s.at && Date.now()-s.at > FH_SNAP_TTL) return false;
      return fhApplySnapshot(s);                          // SYNC apply → instant, no splash (the common case)
    }
    // Spilled to IndexedDB (large plaintext or committed-enc): hand the marker to the
    // module's async restore; the splash covers the read. Returns false (not sync-ready).
    var m=localStorage.getItem('fh-snap-idb');
    if(m){ var mm=JSON.parse(m); if(mm && !(mm.at && Date.now()-mm.at > FH_SNAP_TTL)) window.__fhSnapIdb=mm; }
    return false;
  }catch(e){ return false; }
}
/* apply a parsed snapshot to the app globals — shared by the sync (plaintext)
   path above and the module's async decrypt path (encrypted families) */
function fhApplySnapshot(s){
  try{
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
window.fhApplySnapshot=fhApplySnapshot;
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

/* ---------- service worker + updates ----------
   A new build no longer reloads the page mid-session. It installs and WAITS; we
   show the #fh-newver chip and let the user tap to apply — or apply it silently the
   next time the app is hidden with nothing in flight. enc-recovery is the one
   exception: it forces an immediate swap (65-passcode-ui.js) to self-heal a stale
   build. reg.waiting.postMessage('SKIP_WAITING') → the SW activates → controllerchange
   → reload into the new build. */
var __fhSWReg=null, __fhSwapping=false;
function fhUpdateReady(reg){
  __fhSWReg=reg||__fhSWReg;
  if(__fhSWReg && __fhSWReg.waiting) document.documentElement.classList.add('fh-newver');   // reveal the chip
}
function fhApplyUpdate(){
  var reg=__fhSWReg;
  document.documentElement.classList.remove('fh-newver');
  if(!reg || !reg.waiting){ return; }
  __fhSwapping=true;
  document.documentElement.classList.add('fh-stale');   // reuse the quiet "Updating…" chip while the swap + reload happens
  try{ reg.waiting.postMessage({type:'SKIP_WAITING'}); }catch(e){ location.reload(); }
}
window.fhUpdateReady=fhUpdateReady;
window.fhApplyUpdate=fhApplyUpdate;
/* Apply a waiting update silently when the app goes to the background — but only if
   nothing is mid-edit, no sheet/modal/overlay is open, and no offline write is still
   queued (fhOutboxEmpty). The user just comes back to the new build, no chip needed. */
function fhMaybeAutoSwap(){
  if(__fhSwapping || !__fhSWReg || !__fhSWReg.waiting) return;
  if(window.editingTx!=null) return;
  if(document.querySelector('.sheet.on, .modal.on, .overlay.on')) return;
  var apply=function(){ if(!__fhSwapping && __fhSWReg && __fhSWReg.waiting){ __fhSwapping=true; try{ __fhSWReg.waiting.postMessage({type:'SKIP_WAITING'}); }catch(e){} } };
  if(typeof window.fhOutboxEmpty==='function') window.fhOutboxEmpty().then(function(empty){ if(empty) apply(); });
  else apply();
}
if('serviceWorker' in navigator){
  window.addEventListener('load',function(){
    try{ if(navigator.storage && navigator.storage.persist) navigator.storage.persist(); }catch(e){}   // keep the offline outbox + crypto keys from being evicted
    var hadController=!!navigator.serviceWorker.controller;   // false on the very first install → don't reload for that one
    var refreshing=false;
    navigator.serviceWorker.addEventListener('controllerchange',function(){
      if(refreshing) return; refreshing=true;
      if(hadController) location.reload();   // a real update took over → reload into it; first-ever install just claims control silently
    });
    navigator.serviceWorker.register('sw.js').then(function(reg){
      __fhSWReg=reg;
      if(reg.waiting && navigator.serviceWorker.controller) fhUpdateReady(reg);   // an update was already waiting from a previous visit
      reg.addEventListener('updatefound',function(){
        var sw=reg.installing; if(!sw) return;
        sw.addEventListener('statechange',function(){
          if(sw.state==='installed' && navigator.serviceWorker.controller) fhUpdateReady(reg);   // installed beside a live controller = an update (not first install)
        });
      });
      reg.update();
      document.addEventListener('visibilitychange',function(){
        if(document.visibilityState==='visible') reg.update();   // check for updates on foreground
        else fhMaybeAutoSwap();                                  // …and quietly apply a pending one on background
      });
    }).catch(function(){});
  });
}