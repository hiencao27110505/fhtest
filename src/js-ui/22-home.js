/* ---------- Home — the emotional feed ("moment engine") ----------
   Home isn't a dashboard: it surfaces ONE warm moment a day woven from
   everything the family has, with the family made VISIBLE (who added what) and
   the loop's hooks strengthened — a welcome-back line, milestone celebrations,
   a shared-dream avatar stack, a gentle seed. The tabs do; home makes you feel.
   Facilitator ethic: warmth, never streaks / guilt / scores. */

/* ---------- Thời tiết cảm xúc — a two-sided emotional loop ----------
   (1) Anyone sets today's weather in one tap. (2) EVERYONE sees it in the house:
   each member is a WINDOW, lit by their mood. (3) When someone you love is having
   a rough day, you're handed a caring, BUILD-something action FOR them
   (⛈️ upset → a make-up jar; 🌧️ down → plan a treat they'll look forward to).
   (4) They feel seen. Backed by the realtime member_weather table so a mood set on
   one phone appears on the others. The reveal is GATED: until you light your own
   window, the others stay curtained. Offers use the ONE consistent .woffer card. */
var WEATHER = [
  { k:'sun',   e:'☀️', vi:'nắng',       en:'sunny',   fvi:'vui',        fen:'happy',    rough:false, oico:'✈️', ovi:'Rủ nhau đi chơi',          oen:'Go somewhere together',                 act:"openSheet(&#39;sheet-event&#39;)" },
  { k:'fire',  e:'🔥', vi:'bừng',       en:'buzzing', fvi:'hứng khởi',  fen:'inspired', rough:false, oico:'🎯', ovi:'Cùng mơ điều lớn',                   oen:'Dream big together',      act:"openGoal()" },
  { k:'ok',    e:'⛅', vi:'bình thường', en:'okay',    fvi:'ổn',         fen:'okay',     rough:false, oico:'📸', ovi:'Giữ một khoảnh khắc',   oen:'Save a moment',   act:"openSheet(&#39;sheet-add&#39;)" },
  { k:'rain',  e:'🌧️', vi:'hơi buồn',   en:'down',    fvi:'hơi buồn',   fen:'down',     rough:true,  oico:'🌤️', ovi:'Hẹn một niềm vui nhỏ',           oen:'Plan a little joy', act:"openSheet(&#39;sheet-event&#39;)" },
  { k:'tired', e:'🌫️', vi:'mệt',        en:'drained', fvi:'mệt',        fen:'drained',  rough:true,  oico:'🫖', ovi:'Một tối nhẹ nhàng',          oen:'A cozy evening',        act:"openSheet(&#39;sheet-event&#39;)" },
  { k:'anger', e:'⛈️', vi:'bực bội',    en:'stormy',  fvi:'bực bội',    fen:'upset',    rough:true,  oico:'🕊️', ovi:'Một hũ làm hòa',                     oen:'A make-up jar',          act:"openGoal()" }
];
function _wdef(k){ for(var i=0;i<WEATHER.length;i++){ if(WEATHER[i].k===k) return WEATHER[i]; } return null; }
/* weather is a real daily mood — freshness is judged against the real clock, not the demo's pinned TODAY */
function _wkey(){ var n=new Date(); return n.getFullYear()+'-'+(n.getMonth()+1)+'-'+n.getDate(); }
function _wIsToday(at){ if(!at) return false; try{ var d=new Date(at), n=new Date(); return d.getFullYear()===n.getFullYear() && d.getMonth()===n.getMonth() && d.getDate()===n.getDate(); }catch(e){ return true; } }
function _wIsReal(){ return !!(window.DB && window.DB.memberByAppName && window.DB.ownerMemberId); }
function _meName(){
  var mems = (window.FAM && FAM.members) || [];
  for(var i=0;i<mems.length;i++){ if(mems[i].me) return mems[i].name; }
  return (window.FAM && FAM.user && FAM.user.name) || (mems[0] && mems[0].name) || '';
}
/* my own mood — from the live table when signed in, else a local same-day fallback */
function myWeather(){
  if(_wIsReal()){ var id=window.DB.ownerMemberId, r=window.memberWeather && window.memberWeather[id]; return (r && _wIsToday(r.at)) ? r.weather : null; }
  try{ var w = JSON.parse(localStorage.getItem('fh-weather') || '{}'); return (w && w.date === _wkey()) ? w.k : null; }catch(e){ return null; }
}
/* another member's mood; in the signed-out preview, seed a couple so the loop is visible */
function _demoWeather(name){ var d={ James:'anger', Mia:'rain', Leo:'sun' }; return d[name] || null; }
function memberWeatherOf(name){
  if(name === _meName()) return myWeather();
  if(_wIsReal()){ var id=window.DB.memberByAppName[name], r=id && window.memberWeather && window.memberWeather[id]; return (r && _wIsToday(r.at)) ? r.weather : null; }
  return _demoWeather(name);
}
function setWeather(k){
  window._wpick = false;
  if(k) window._wxMine = k;                       // animate my own change immediately (self-feedback)
  if(_wIsReal() && typeof window.saveWeather === 'function'){ window.saveWeather(k); }
  else { try{ localStorage.setItem('fh-weather', JSON.stringify({ date: _wkey(), k: k })); }catch(e){} }
  if(typeof renderHome === 'function') renderHome();
}
function clearWeather(){                       // signed-out reset (kept for compatibility)
  window._wpick = true;
  if(_wIsReal() && typeof window.saveWeather === 'function'){ window.saveWeather(null); }
  else { try{ localStorage.removeItem('fh-weather'); }catch(e){} }
  if(typeof renderHome === 'function') renderHome();
}
function openWeatherPick(){ window._wpick = true; if(typeof renderHome === 'function') renderHome(); }
window.setWeather = setWeather; window.clearWeather = clearWeather; window.openWeatherPick = openWeatherPick;

/* ---------- the living house scene ---------- */
/* the sky follows the REAL clock (not the demo's pinned TODAY) */
function _skyPhase(){ var h = new Date().getHours(); if(h >= 5 && h < 8) return 'dawn'; if(h >= 8 && h < 17) return 'day'; if(h >= 17 && h < 20) return 'dusk'; return 'night'; }
/* fixed star field ([%left, px-top]) — deterministic so re-renders don't shuffle the sky */
var _STARS = [[6,14],[14,36],[24,8],[33,24],[44,15],[55,6],[63,28],[72,12],[81,32],[88,8],[93,22],[38,40],[68,44],[18,54]];
/* one member = one window; the pane is the light their mood casts */
function _hwCell(m, meName, gate){
  var mine = (m.name === meName);
  var w = memberWeatherOf(m.name), wd = w && _wdef(w);
  var pane, emo = '';
  if(mine && gate){ pane = 'ask'; emo = '🕯️'; }
  else if(gate){ pane = 'cur'; }                       // curtained until you light yours
  else if(wd){ pane = wd.k; emo = wd.e; }
  else { pane = 'wait'; }                              // they haven't shared — light's off
  var lit = (pane === 'sun' || pane === 'fire' || pane === 'ok');
  var nm = esc((typeof firstName === 'function') ? firstName(m.name) : m.name);
  var inner = '<span class="hw-pane p-' + pane + (lit ? ' lit' : '') + '">' + emo + '</span><span class="hw-name">' + nm + '</span>';
  var dn = ' data-name="' + escAttr(m.name) + '"';
  return mine
    ? '<button class="hw me"' + dn + ' onclick="openWeatherPick()" aria-label="' + escAttr(L('Đổi cảm xúc', 'Change your mood')) + '">' + inner + '</button>'
    : '<span class="hw' + (pane === 'wait' ? ' waiting' : '') + '"' + dn + '>' + inner + '</span>';
}
/* the whole scene: sky bits → hills/ground → clothesline memories → tree → house.
   Expects buildMemRecords() to have run (renderHome does). */
function renderScene(){
  var mems = ((window.FAM && FAM.members) || []).slice(0, 8), meName = _meName(), myW = myWeather();
  var gate = !myW || window._wpick, ph = _skyPhase();

  // windows + the family door (tap the door → add something to the house)
  var door = '<button class="hs-door" onclick="openSheet(&#39;sheet-add&#39;)" aria-label="' + escAttr(L('Thêm', 'Add')) + '"></button>';
  var cells = mems.map(function(m){ return _hwCell(m, meName, gate); }).join('');

  // chimney smokes when the family added something today (memory, mood…)
  var act = false;
  try{
    var n = new Date();
    act = (window.memRecords || []).some(function(r){ return r.d && r.d.getFullYear() === n.getFullYear() && r.d.getMonth() === n.getMonth() && r.d.getDate() === n.getDate(); });
    if(!act && window.memberWeather){ for(var id in memberWeather){ if(_wIsToday(memberWeather[id].at)){ act = true; break; } } }
    if(!act) act = !!myW;
  }catch(e){}

  // the savings tree grows with total goal progress
  var goals = window.goals || {}, gord = window.goalOrder || [], tt = 0, ts = 0;
  gord.forEach(function(g){ var e = goals[g]; if(e && e.target > 0){ tt += e.target; ts += Math.min(e.saved || 0, e.target); } });
  var grow = tt > 0 ? (0.62 + 0.5 * (ts / tt)) : 0.55;

  // up to two recent memories hang on the clothesline (hidden for big families)
  var pols = '';
  if(mems.length < 5){                                   // 5+: the wide house needs the sky (.full-house also hides via CSS)
    var hang = (window.memRecords || []).slice(0, 2), POS = [[5, 14, -6], [24, 26, 4]];
    hang.forEach(function(r, i){
      var idx = memRecords.indexOf(r), p = POS[i];
      var st = r.src ? ' style="background-image:url(' + escAttr(r.src) + ')"' : '';
      pols += '<button class="pol" style="left:' + p[0] + '%;top:' + p[1] + 'px;--r:' + p[2] + 'deg" onclick="openMemory(' + idx + ')" aria-label="' + escAttr(L('Kỷ niệm', 'Memory')) + '">'
        + '<span class="pol-ph ' + (r.src ? '' : esc(r.cls || 'ph-park')) + '"' + st + '>' + (r.src ? '' : '<span class="pol-emo">' + esc(r.emoji || '📸') + '</span>') + '</span></button>';
    });
    if(pols) pols = '<svg class="sc-line" viewBox="0 0 100 60" preserveAspectRatio="none" aria-hidden="true"><path d="M0 8 Q 55 44 100 34" fill="none" stroke-width="1.2" vector-effect="non-scaling-stroke"/></svg>' + pols;
  }

  var stars = '';
  if(ph === 'night'){ _STARS.forEach(function(s, i){ stars += '<i class="sc-star" style="left:' + s[0] + '%;top:' + s[1] + 'px;animation-delay:' + ((i % 5) * 0.6).toFixed(1) + 's"></i>'; }); }

  // ambient weather over the scene — the house feels whoever's having a day
  var amb = '';
  if(!gate){
    var shared = []; mems.forEach(function(m){ var w = memberWeatherOf(m.name); if(w) shared.push(w); });
    var has = function(k){ return shared.indexOf(k) >= 0; };
    if(has('anger')) amb = '<div class="amb"><i class="a-storm"></i><i class="a-bolt"></i></div>';
    else if(has('rain')){ var d = '', i; for(i = 0; i < 7; i++){ d += '<i class="a-drop" style="left:' + (8 + i * 13) + '%;animation-delay:' + (i * 0.23).toFixed(2) + 's"></i>'; } amb = '<div class="amb">' + d + '</div>'; }
    else if(has('tired')) amb = '<div class="amb"><i class="a-mist"></i></div>';
    else if(shared.length >= 2 && shared.every(function(w){ return w === 'sun' || w === 'fire'; })) amb = '<div class="amb"><i class="a-beam b1"></i><i class="a-beam b2"></i></div>';
  }

  return '<i class="sc-orb"></i>' + stars
    + '<i class="sc-cloud c1"></i><i class="sc-cloud c2"></i>'
    + '<i class="sc-hill h1"></i><i class="sc-hill h2"></i><i class="sc-ground"></i>'
    + pols
    + '<div class="sc-tree" style="transform:scale(' + grow.toFixed(2) + ')"><i class="tr-tr"></i><i class="tr-f f1"></i><i class="tr-f f2"></i><i class="tr-f f3"></i></div>'
    + '<div class="sc-house"><div class="hs-roofwrap"><i class="hs-chim">' + (act ? '<i class="puff p1"></i><i class="puff p2"></i><i class="puff p3"></i>' : '') + '</i><i class="hs-roof"></i></div>'
    + '<div class="hs-wall"><div class="hs-wins">' + door + cells + '</div></div></div>'
    + amb;
}
/* the hearth card under the scene: the mood picker until you've lit your window,
   then the caring offers for whoever's having a rough day. */
function renderHearth(){
  var mems = (window.FAM && FAM.members) || [], meName = _meName(), myW = myWeather();
  if(!myW || window._wpick){
    var btns = WEATHER.map(function(w){ return '<button class="wpk" onclick="setWeather(&#39;' + w.k + '&#39;)" aria-label="' + escAttr(L(w.vi, w.en)) + '">' + w.e + '</button>'; }).join('');
    var others = mems.filter(function(m){ return m.name !== meName; });
    var hint = others.length ? '<div class="hearth-hint">' + L('Thắp đèn rồi sẽ thấy đèn của cả nhà', 'Light yours to see everyone’s windows') + '</div>' : '';
    return '<div class="hearth"><div class="hearth-q">' + L('Thắp đèn phòng bạn nhé. Hôm nay bạn thế nào?', 'Light your window. How are you today?') + '</div>'
      + '<div class="wrow">' + btns + '</div>' + hint + '</div>';
  }
  var offers = [];
  mems.forEach(function(m){
    if(m.name === meName) return;
    var w = memberWeatherOf(m.name), wd = w && _wdef(w); if(!wd) return;
    offers.push({ nm: (typeof firstName === 'function') ? firstName(m.name) : m.name, wd: wd });
  });
  offers.sort(function(a, b){ return (b.wd.rough ? 1 : 0) - (a.wd.rough ? 1 : 0); });
  var offHtml = offers.slice(0, 2).map(function(o){
    var line = L(o.wd.ovi, o.wd.oen).replace(/\{n\}/g, esc(o.nm));   // no "X đang vui" label — the windows already show the mood
    return '<button class="woffer" onclick="' + o.wd.act + '"><div class="wo-ico">' + o.wd.oico + '</div>'
      + '<div class="wo-t">' + line + '</div>'
      + '<svg class="chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18l6-6-6-6"/></svg></button>';
  }).join('');
  return offHtml ? '<div class="hearth hearth-off">' + offHtml + '</div>' : '';
}

/* the collective mood read — shown as the home subtitle under the greeting */
function moodRead(){
  var mems = (window.FAM && FAM.members) || [], meName = _meName();
  var oth = mems.filter(function(m){ return m.name !== meName; });
  var othShared = oth.filter(function(m){ return memberWeatherOf(m.name); });
  var roughAny = othShared.some(function(m){ var d = _wdef(memberWeatherOf(m.name)); return d && d.rough; });
  return roughAny ? L('Có người đang cần một cái ôm 💛', 'Someone could use a hug 💛')
       : othShared.length ? L('Nhà mình đang ổn cả 🌿', 'Everyone’s doing alright 🌿')
       : oth.length ? L('Đợi cả nhà cùng ghé vào nhé 🌤️', 'Waiting for the family to drop in 🌤️')
       : L('Một ngày nữa bên nhau 🌿', 'Another day, together 🌿');
}
window.moodRead = moodRead;

/* ============================================================================
   The keepsake kit — the feed is the house's interior, in the scene's own
   materials: memories hang as FRAMED PRINTS on the wall (an empty frame waits
   for today), plans are NOTES PINNED with a pushpin, the month's money is THE
   FAMILY JAR. Each builder takes an opts object and returns HTML.
   ============================================================================ */
/* who added it — a small face + first name inside a frame's caption */
function frBy(who){
  if(!who) return '';
  var w = ('' + who).toLowerCase();
  if(w === 'both' || w === 'shared' || w === 'chung') return '';        // collective → no single face
  var nm = who, col = '#8f8a99', ini = (typeof inits === 'function') ? inits(who) : ('' + who).charAt(0).toUpperCase();
  if(typeof membersMeta !== 'undefined' && membersMeta){ for(var n in membersMeta){ if(n.toLowerCase() === w){ col = membersMeta[n].col; ini = membersMeta[n].ini; nm = n; break; } } }
  var fn = (typeof firstName === 'function') ? firstName(nm) : nm;
  return '<span class="fr-by"><span class="av" style="background:' + col + '">' + esc(ini) + '</span>' + esc(fn) + '</span>';
}
function frameCard(o){   // {src,cls,emoji,who,eye,title,sub,cta,act,tape,tall}
  var ph = '<div class="fr-ph' + (o.src ? '' : ' ' + esc(o.cls || 'ph-park')) + '"' + (o.src ? ' style="background-image:url(' + escAttr(o.src) + ')"' : '') + '>'
    + (o.src ? '' : '<span class="fr-emo">' + esc(o.emoji || '📸') + '</span>') + '</div>';
  var by = frBy(o.who);
  var foot = (by || o.cta) ? '<div class="fr-foot">' + by + (o.cta ? '<span class="fr-cta">' + o.cta + '</span>' : '') + '</div>' : '';
  return '<button class="frame' + (o.tall ? ' tall' : '') + '" onclick="' + o.act + '"><div class="fr-mat">' + ph
    + (o.tape ? '<i class="tape tl"></i><i class="tape tr"></i>' : '') + '</div>'
    + '<div class="fr-cap"><div class="fr-eye">' + o.eye + '</div><div class="fr-ti">' + esc(o.title) + '</div>'
    + (o.sub ? '<div class="fr-sub">' + o.sub + '</div>' : '') + foot + '</div></button>';
}
function emptyFrame(o){  // {big,title,sub,act} — an empty frame on the wall, waiting
  return '<button class="frame frame-empty' + (o.big ? ' big' : '') + '" onclick="' + o.act + '"><div class="fr-mat"><div class="fr-hole"><span class="fh-plus">＋</span></div></div>'
    + '<div class="fr-cap center"><div class="fr-ti' + (o.big ? '' : ' sm') + '">' + o.title + '</div>'
    + (o.sub ? '<div class="fr-sub">' + o.sub + '</div>' : '') + '</div></button>';
}
function pinNote(o){     // {n,unit}|{ico} + {title,sub,pct,src,act} — a note pinned to the wall
  var lead = (o.n != null)
    ? '<div class="pn-n"><b>' + o.n + '</b><span>' + o.unit + '</span></div>'
    : '<div class="pn-ico">' + (o.ico || '📌') + '</div>';
  var snap = o.src ? '<span class="pn-snap"><i style="background-image:url(' + escAttr(o.src) + ')"></i></span>' : '';
  return '<button class="pnote" onclick="' + o.act + '"><i class="pn-pin"></i>' + lead
    + '<div class="pn-b"><div class="pn-t">' + o.title + '</div>' + (o.sub ? '<div class="pn-s">' + o.sub + '</div>' : '')
    + ((typeof o.pct === 'number') ? '<div class="pn-bar"><i style="width:' + o.pct + '%"></i></div>' : '') + '</div>' + snap + '</button>';
}
function jarCard(o){     // {mood,title,sub,fill,foot,act} — fill = what's left in the pot
  return '<button class="jarcard ' + o.mood + '" onclick="' + o.act + '">'
    + '<div class="jar"><i class="jar-lid"></i><div class="jar-glass"><i class="jar-fill" style="height:' + o.fill + '%"></i><i class="jar-shine"></i></div></div>'
    + '<div class="jc-b"><div class="jc-t">' + o.title + '</div><div class="jc-s">' + o.sub + '</div>'
    + '<div class="jc-foot"><span>' + o.foot + '</span><em>' + L('Xem chi tiết', 'View details') + '</em></div></div></button>';
}
function _sectionH(title, link){ return '<div class="section-h"><div class="t">' + title + '</div>' + (link ? '<a onclick="' + link + '">' + L('Xem tất cả', 'See all') + '</a>' : '') + '</div>'; }

function renderHome(){
  var box = document.getElementById('home-body'); if(!box) return;
  buildMemRecords();
  var evs = window.events || {}, ord = window.order || [];
  var isMirrorK = function(k){ var e = evs[k]; return !!(e && (e._srcTxn || e.fromExpense)); };
  var _meM = ((window.FAM && FAM.members) || []).filter(function(mm){ return mm.me; })[0];
  var meName = (_meM ? _meM.name : ((window.FAM && FAM.user && FAM.user.name) || '')).toLowerCase();
  var homeVis = (function(){ var _hv = document.getElementById('v-home'); return !!(_hv && _hv.classList.contains('on')); })();
  var rot = TODAY.getDate();                            // rotates recommendation FORMS daily
  var myW = myWeather();

  // subtitle under the greeting = the family mood read (the hearth card asks the question)
  setTxt('greet-sub', (!myW || window._wpick) ? L('Một ngày nữa bên nhau 🌿', 'Another day, together 🌿') : moodRead());

  // the living house: phase the sky from the real clock, then paint the scene
  var skyEl = document.getElementById('home-sky');
  if(skyEl) skyEl.className = 'home-sky sky-' + _skyPhase();
  var sceneEl = document.getElementById('home-scene');
  if(sceneEl){
    var _nm = ((window.FAM && FAM.members) || []).length;
    sceneEl.className = 'home-scene' + (_nm >= 4 ? ' big-house' : '') + (_nm >= 5 ? ' full-house' : '');
    setHTMLIf(sceneEl, renderScene());
  }

  var html = renderHearth();                            // the hearth card under the scene

  /* ---- signals from the active user's + relatives' data ---- */
  var up = ord.filter(function(k){ return evs[k] && evs[k].d && !isMirrorK(k) && !achievedNow(evs[k]); })
              .sort(function(a, b){ return evs[a].d.getTime() - evs[b].d.getTime(); });
  var onThis = memRecords.filter(function(r){
    if(!r.d || r.d.getFullYear() >= TODAY.getFullYear()) return false;
    var a = new Date(TODAY.getFullYear(), r.d.getMonth(), r.d.getDate());
    return Math.abs((a - TODAY) / 86400000) <= 3;
  });
  var celebrated = {}; try{ celebrated = JSON.parse(localStorage.getItem('fh-celebrated') || '{}') || {}; }catch(e){ celebrated = {}; }
  var goals = window.goals || {}, gord = window.goalOrder || [], milestones = [];
  gord.forEach(function(g){ var go = goals[g]; if(go && typeof achievedGoal === 'function' && achievedGoal(go)) milestones.push({ key: 'goal:' + g, name: go.name, cls: go.cls || 'ph-park' }); });
  var fresh = milestones.filter(function(mi){ return !celebrated[mi.key]; })[0] || null;
  /* ---- finance signal (computed up-front: the Tài chính card AND the goal nudge use it) ---- */
  var m = (typeof M === 'function') ? M() : null, finV = null;
  if(m && m.budget > 0){
    var reserved = m.done ? 0 : monthReserved();
    var safe = Math.max(0, m.budget - m.spent - reserved), over = m.spent > m.budget;
    var proj = !m.done && m.dom > 0 && ((m.spent / m.dom * m.dim) - m.budget > m.budget * 0.01);
    var fmood, fico, ftt, fss;
    if(over){ fmood = 'over'; fico = '🍂'; ftt = L('Hơi quá tay một chút rồi', 'A little over this month');
      fss = L('Vượt <b>' + fmtK(m.spent - m.budget) + '</b> · cùng nhau chỉnh lại nha', 'Over by <b>' + fmtK(m.spent - m.budget) + '</b> · ease back together'); }
    else if(proj){ fmood = 'pace'; fico = '⚡'; ftt = L('Tháng này tiêu hơi nhanh tay', 'Spending a touch fast');
      fss = L('Nhẹ nhàng chút là vẫn dư · còn <b>' + fmtK(safe) + '</b>', 'Ease up · <b>' + fmtK(safe) + '</b> left'); }
    else { fmood = 'ok'; fico = '🌿'; ftt = L('Tháng này cả nhà đang thong thả', 'Comfortable this month');
      fss = L('Còn <b>' + fmtK(safe) + '</b> để cả nhà thoải mái tận hưởng', '<b>' + fmtK(safe) + '</b> left to enjoy together'); }
    finV = { mood: fmood, ico: fico, tt: ftt, ss: fss, ps: Math.min(100, Math.round(m.spent / m.budget * 100)), foot: L('Đã tiêu ' + fmtK(m.spent) + ' / ' + fmtK(m.budget), 'Spent ' + fmtK(m.spent) + ' / ' + fmtK(m.budget)) };
  }
  var mComfortable = !!(finV && finV.mood === 'ok');

  /* ============ KHOẢNH KHẮC — a framed print on the wall + an empty frame for today ============ */
  var kh = '', centerRef = null;
  if(fresh && homeVis){                                 // a shared dream reached — celebrated once
    milestones.forEach(function(mi){ celebrated[mi.key] = 1; });
    try{ localStorage.setItem('fh-celebrated', JSON.stringify(celebrated)); }catch(e){}
    kh += frameCard({ cls: fresh.cls, emoji: '🎉', eye: L('Vừa đủ rồi', 'Goal reached'), title: fresh.name, sub: L('Giấc mơ chung đã thành hình 🎉', 'A shared dream, reached 🎉'), tall: true, cta: '🎯 ' + L('Xem mục tiêu', 'View goal'), act: 'go(&#39;spending&#39;)' });
  } else if(memRecords.length){                         // the most recent moment, framed — with who added it
    var r0 = memRecords[0], i0 = memRecords.indexOf(r0); centerRef = r0.type + ':' + r0.ref;
    var isExp0 = r0.type === 'expense';
    kh += frameCard({ cls: r0.cls, src: r0.src, emoji: r0.emoji, who: r0.who, eye: isExp0 ? L('Một khoản chi thành kỷ niệm', 'A spend, remembered') : L('Khoảnh khắc gần đây', 'A recent moment'), title: r0.cap, sub: esc(r0.meta || ''), tall: true, act: 'openMemory(' + i0 + ')' });
  } else {                                              // a new family — the first empty frame on the wall
    kh += emptyFrame({ big: true, title: L('Câu chuyện của cả nhà', 'Your family’s story'), sub: L('Tấm ảnh đầu tiên treo lên tường từ đây 💛', 'The first photo on this wall starts here 💛'), act: 'openSheet(&#39;sheet-add&#39;)' });
  }
  if(memRecords.length || fresh){                       // an empty frame always waits for today
    kh += emptyFrame({ title: L('Hôm nay có gì đáng nhớ không?', 'Anything worth remembering today?'), sub: L('Còn một khung trống trên tường cho hôm nay.', 'There’s an empty frame on the wall for today.'), act: 'openSheet(&#39;sheet-add&#39;)' });
  }
  html += _sectionH(L('Khoảnh khắc', 'Moments'), 'goMoments()') + kh;

  /* ============ SẮP TỚI — a note pinned to the wall ============ */
  var st = '';
  if(up.length){
    var k = up[0], e = evs[k], dl = daysLeft(e.d);
    var emm = (e.memories && e.memories[0]) || null, eSrc = (emm && emm.src) ? emm.src : '';
    var lead = dl > 1 ? { n: dl, unit: L('ngày nữa', 'days to go') } : { ico: e.emoji || '📅' };
    var when = dl === 0 ? L('Hôm nay', 'Today') : (dl === 1 ? L('Ngày mai', 'Tomorrow') : '');
    var subU, pctU = null;
    if(e.target > 0){
      pctU = Math.min(100, Math.round(e.saved / e.target * 100));
      subU = (when ? when + ' · ' : '') + L('Cả nhà đã để dành được ' + pctU + '% rồi 🌿', 'Saved ' + pctU + '% together 🌿');
    } else {
      subU = (when ? when + ' · ' : '') + L('Điều cả nhà đang mong 💛', 'Something to look forward to 💛');
    }
    st += pinNote({ n: lead.n, unit: lead.unit, ico: lead.ico, title: esc(e.name), sub: subU, pct: pctU, src: eSrc, act: 'openEvent(&#39;' + escAttr(k) + '&#39;)' });
  }
  if(mComfortable && gord.length === 0){                 // dream a goal — comfortable + no active goal yet
    st += pinNote({ ico: '🎯', title: L('Cùng mơ một điều lớn?', 'Dream something big?'), sub: L('Tháng này thong thả, ghim một mục tiêu chung lên đây nhé.', 'A comfortable month, pin a shared goal up here.'), act: 'openGoal()' });
  }
  if(st) html += _sectionH(L('Sắp tới', 'Coming up'), 'goMoments(&#39;plans&#39;)') + st;

  /* ============ TÀI CHÍNH — the family jar: what's left in the pot this month ============ */
  if(finV){
    var jfill = finV.mood === 'over' ? 6 : Math.max(8, 100 - finV.ps);
    html += _sectionH(L('Tài chính', 'Finance'), 'go(&#39;spending&#39;)')
      + jarCard({ mood: finV.mood, title: finV.tt, sub: finV.ss, fill: jfill, foot: finV.foot, act: 'go(&#39;spending&#39;)' });
  }

  /* ============ NHỚ LẠI — an old print held by washi tape ============ */
  if(onThis.length){
    var rr = onThis[0], refN = rr.type + ':' + rr.ref;
    if(refN !== centerRef){                              // don't repeat the centerpiece
      var iN = memRecords.indexOf(rr), yrs = TODAY.getFullYear() - rr.d.getFullYear();
      var agoVi = yrs <= 1 ? 'năm ngoái' : (yrs + ' năm trước'), agoEn = yrs <= 1 ? 'last year' : (yrs + ' years ago');
      html += _sectionH(L('Nhớ lại', 'Looking back'), 'goMoments(&#39;album&#39;)')
        + frameCard({ cls: rr.cls, src: rr.src, emoji: rr.emoji, who: rr.who, tape: true, eye: L('Ngày này ' + agoVi, 'On this day · ' + agoEn), title: rr.cap, sub: esc(rr.meta || ''), cta: '💛 ' + L('Xem lại ngày ấy', 'Look back'), act: 'openMemory(' + iN + ')' });
    }
  }

  setHTMLIf(box, html);
  try{ runWeatherFx(); }catch(e){}                       // play any just-set / just-arrived mood animations
}
window.renderHome = renderHome;

/* ---------- weather FX — a felt moment when a mood is set or arrives ----------
   A persisted "seen" map (member_id → last-seen timestamp) is diffed on every
   home render: your own change plays instantly (A: cell pop), and any OTHER
   member whose mood is newer than last seen plays the full moment (B: the whole
   card takes on that weather; C: a short "just changed" note). Because the map is
   persisted, a change made while you were away replays once on your next open.
   First-ever load seeds silently so nothing animates on a cold start. */
var _WXFX = { sun:'sun', fire:'spark', ok:'cloud', rain:'rain', tired:'mist', anger:'storm' };
function _wxIdOf(name){
  if(!window.DB) return null;
  if(name === _meName()) return window.DB.ownerMemberId || null;
  return (window.DB.memberByAppName && window.DB.memberByAppName[name]) || null;
}
function _wxPersist(){ try{ localStorage.setItem('fh-wx-seen', JSON.stringify(window._wxSeen)); }catch(e){} }
function _wxParticles(t){
  var s = '', i, n;
  if(t === 'rain' || t === 'storm'){
    n = (t === 'storm') ? 22 : 14;
    for(i = 0; i < n; i++){ s += '<i class="wx-drop" style="left:' + (Math.random()*100).toFixed(1) + '%;animation-delay:' + (Math.random()*1.1).toFixed(2) + 's;animation-duration:' + (0.62 + Math.random()*0.4).toFixed(2) + 's"></i>'; }
    if(t === 'storm') s += '<i class="wx-flash"></i>';
  } else if(t === 'sun'){
    s += '<i class="wx-glow"></i>';
    for(i = 0; i < 8; i++){ s += '<i class="wx-spark" style="left:' + (10 + Math.random()*80).toFixed(1) + '%;top:' + (8 + Math.random()*60).toFixed(1) + '%;animation-delay:' + (Math.random()*1).toFixed(2) + 's"></i>'; }
  } else if(t === 'spark'){
    for(i = 0; i < 12; i++){ s += '<i class="wx-ember" style="left:' + (Math.random()*100).toFixed(1) + '%;animation-delay:' + (Math.random()*1.2).toFixed(2) + 's"></i>'; }
  } else if(t === 'cloud'){
    s += '<i class="wx-cloud"></i>';
  } else if(t === 'mist'){
    s += '<i class="wx-mist"></i>';
  }
  return s;
}
function _wxPlay(host, plays){
  var lead = plays.filter(function(p){ return !p.mine; })[0] || plays[0];
  var fxType = _WXFX[lead.k] || 'rain';
  var layer = document.createElement('div');
  layer.className = 'wx-fx wx-' + fxType;
  layer.innerHTML = _wxParticles(fxType);
  host.appendChild(layer);
  setTimeout(function(){ if(layer.parentNode) layer.parentNode.removeChild(layer); }, 2700);

  var others = plays.filter(function(p){ return !p.mine; });
  if(others.length){
    var wd = _wdef(others[0].k), nm = (typeof firstName === 'function') ? firstName(others[0].name) : others[0].name;
    var note = document.createElement('div');
    note.className = 'wx-note';
    note.innerHTML = esc(nm) + (others.length > 1 ? ' +' + (others.length - 1) : '') + ' ' + L('vừa đổi tâm trạng', 'just changed their weather') + ' ' + (wd ? wd.e : '');
    host.appendChild(note);
    setTimeout(function(){ if(note.parentNode) note.parentNode.removeChild(note); }, 3300);
  }
  var cells = host.querySelectorAll('.hw');
  plays.forEach(function(p){
    Array.prototype.forEach.call(cells, function(c){
      if(c.getAttribute('data-name') === p.name){
        c.classList.remove('fx'); void c.offsetWidth; c.classList.add('fx');
        setTimeout(function(){ c.classList.remove('fx'); }, 1100);
      }
    });
  });
}
function runWeatherFx(){
  if(document.hidden) return;
  // Only on the OPEN house (home visible, own mood shared). In the curtained
  // "light yours first" state a member's change defers — it neither leaks past the
  // reciprocity gate nor gets marked seen, and animates once the windows open.
  if(!myWeather() || window._wpick) return;
  var host = document.querySelector('#v-home.on #home-scene'); if(!host) return;
  var meName = _meName();
  if(window._wxSeen === undefined){
    var raw = null; try{ raw = localStorage.getItem('fh-wx-seen'); }catch(e){}
    try{ window._wxSeen = raw ? (JSON.parse(raw) || {}) : null; }catch(e){ window._wxSeen = null; }
  }
  var plays = [];
  if(window._wxMine){ plays.push({ name: meName, k: window._wxMine, mine: true }); window._wxMine = null; }
  var mems = (window.FAM && FAM.members) || [], nextSeen = {}, hasData = false;
  mems.forEach(function(m){
    var id = _wxIdOf(m.name); if(!id) return;
    var rec = window.memberWeather && window.memberWeather[id];
    if(!rec || !rec.weather || !rec.at) return;
    hasData = true; nextSeen[id] = rec.at;
    if(window._wxSeen && m.name !== meName){
      var prev = window._wxSeen[id];
      if(!prev || rec.at > prev) plays.push({ name: m.name, k: rec.weather, mine: false });
    }
  });
  if(window._wxSeen === null){ if(hasData){ window._wxSeen = nextSeen; _wxPersist(); } }      // first-ever: seed silently
  else if(hasData){ for(var id in nextSeen) window._wxSeen[id] = nextSeen[id]; _wxPersist(); }
  if(plays.length) _wxPlay(host, plays);
}
window.runWeatherFx = runWeatherFx;
