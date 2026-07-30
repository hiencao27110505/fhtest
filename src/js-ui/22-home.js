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
   The widget kit — standard HIG components for the feed. Small glanceable
   widget tiles, the immersive photo card (Photos-featured style), quick
   actions in the add-sheet's icon language, and grouped goal rows. Each
   builder takes an opts object and returns HTML.
   ============================================================================ */
function _phCls(cls, src){ return 'bp-ph' + (src ? '' : ' ' + esc(cls || 'ph-park')); }
function _phBg(cls, src){ return src ? ' style="background-image:url(' + escAttr(src) + ')"' : ''; }
function _byChip(who){
  if(!who) return '';
  var w = ('' + who).toLowerCase();
  if(w === 'both' || w === 'shared' || w === 'chung') return '';        // collective → no single face
  var nm = who, col = '#8f8a99', ini = (typeof inits === 'function') ? inits(who) : ('' + who).charAt(0).toUpperCase();
  if(typeof membersMeta !== 'undefined' && membersMeta){ for(var n in membersMeta){ if(n.toLowerCase() === w){ col = membersMeta[n].col; ini = membersMeta[n].ini; nm = n; break; } } }
  var fn = (typeof firstName === 'function') ? firstName(nm) : nm;
  return '<div class="bp-by"><span class="av" style="background:' + col + '">' + esc(ini) + '</span><span>' + esc(fn) + '</span></div>';
}
/* which scene-style cover fits an occasion? keyword + emoji matched, vi + en */
function occCover(name, emoji){
  var t = ((name || '') + ' ' + (emoji || '')).toLowerCase();
  var has = function(arr){ for(var i = 0; i < arr.length; i++){ if(t.indexOf(arr[i]) >= 0) return true; } return false; };
  if(has(['đi ','du lịch','du lich','trip','travel','biển','bien','beach','về quê','ve que','cắm trại','cam trai','camping','🚗','🚙','✈','🛫','🏖','⛰','🏔','🗻','🌊','⛺','🚌','🚆','🧳'])) return 'travel';
  if(has(['sinh nhật','sinh nhat','birthday','tiệc','tiec','party','cưới','cuoi','wedding','kỷ niệm','ky niem','anniversary','tết','tet ','noel','giáng sinh','giang sinh','christmas','trung thu','🎂','🥳','🎉','🎊','🎁','🎄','💍','👰'])) return 'party';
  return 'outing';
}
/* the cover's layers — drawn with the house scene's own shapes */
function occHTML(type){
  if(type === 'travel'){
    return '<i class="oc-sun"></i><i class="oc-cloud a"></i><i class="oc-cloud b"></i>'
      + '<i class="oc-hill h1"></i><i class="oc-hill h2"></i><i class="oc-road"></i>'
      + '<span class="oc-car"><span class="cab"></span><span class="bd"></span><span class="w wa"></span><span class="w wb"></span></span>';
  }
  if(type === 'party'){
    var cols = ['#e0604c', '#f0b450', 'var(--brand)', '#8f6fd0'], flags = '', pts = [[8,5],[22,9.5],[36,12.5],[50,13.5],[64,12.5],[78,9.5],[92,5]];
    for(var i = 0; i < pts.length; i++){ var x = pts[i][0], y = pts[i][1]; flags += '<polygon points="' + (x-3.2) + ',' + y + ' ' + (x+3.2) + ',' + y + ' ' + x + ',' + (y+7) + '" fill="' + cols[i % 4] + '"/>'; }
    var conf = '', cps = [[12,60],[26,48],[40,66],[58,52],[73,64],[87,50]];
    for(var j = 0; j < cps.length; j++){ conf += '<i class="oc-conf" style="left:' + cps[j][0] + '%;top:' + cps[j][1] + '%;background:' + cols[j % 4] + '"></i>'; }
    return '<svg class="oc-bunting" viewBox="0 0 100 26" preserveAspectRatio="none"><path d="M0 4 Q 50 22 100 4" fill="none" stroke="rgba(120,90,70,.4)" stroke-width="1" vector-effect="non-scaling-stroke"/>' + flags + '</svg>'
      + '<span class="oc-bal" style="left:14%;top:40%;background:#e0604c"></span>'
      + '<span class="oc-bal" style="left:28%;top:52%;background:#f0b450;animation-delay:1.3s"></span>'
      + '<span class="oc-bal" style="right:16%;top:42%;background:#8f6fd0;animation-delay:.6s"></span>' + conf;
  }
  return '<i class="oc-sun"></i><i class="oc-cloud a"></i>'
    + '<i class="oc-hill h1"></i><i class="oc-hill h2"></i>'
    + '<span class="oc-tree"><i class="tr"></i><i class="f1"></i><i class="f2"></i><i class="f3"></i></span>'
    + '<span class="oc-kite"><i class="bd"></i><i class="tl"></i></span>';
}
function bigPhoto(o){   // {cls,src,subj,who,eye,title,sub,pct,cta:{label},tall,act}
  var cta = o.cta ? '<span class="bp-cta">' + o.cta.label + '</span>' : '';
  var prog = (typeof o.pct === 'number') ? '<div class="bp-prog"><i style="width:' + o.pct + '%"></i></div>' : '';
  var ph = o.ill ? '<div class="bp-ph occ occ-' + o.ill + '">' + occHTML(o.ill) + '</div>'
                 : '<div class="' + _phCls(o.cls, o.src) + '"' + _phBg(o.cls, o.src) + '></div>';
  return '<button class="bigphoto' + (o.tall ? ' tall' : '') + (o.ill ? ' occ-card' : '') + '" onclick="' + o.act + '">'
    + ph + '<div class="bp-sc"></div>'
    + (o.subj ? '<div class="bp-subj">' + esc(o.subj) + '</div>' : '') + _byChip(o.who)
    + '<div class="bp-cap"><div class="bp-eye">' + o.eye + '</div><div class="bp-ti">' + esc(o.title) + '</div>'
    + (o.sub ? '<div class="bp-mt">' + o.sub + '</div>' : '') + prog + cta + '</div></button>';
}
/* Fitness-style mini ring: pct 0–100, tok = semantic token name (good/amber/danger) */
function _ringSVG(pct, tok){
  return '<svg class="wt-ring" viewBox="0 0 36 36" aria-hidden="true"><circle class="tr" cx="18" cy="18" r="15.9" fill="none" stroke-width="3.6"></circle>'
    + '<circle cx="18" cy="18" r="15.9" fill="none" stroke="var(--' + tok + ')" stroke-width="3.6" stroke-linecap="round" stroke-dasharray="' + pct + ' 100" transform="rotate(-90 18 18)"></circle></svg>';
}
/* header-chip icon set — the tab bar's own glyphs, so each tile reads native */
var _WICON = {
  budget: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 19V9M9 19V5M14 19v-7M19 19v-11"/></svg>',
  house:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 10.5L12 3l9 7.5V21a1 1 0 01-1 1h-5v-6h-6v6H4a1 1 0 01-1-1z"/></svg>',
  plan:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="5" width="18" height="16" rx="3"/><path d="M3 10h18M8 3v4M16 3v4"/></svg>',
  album:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="16" rx="3"/><circle cx="8.5" cy="9.5" r="1.6"/><path d="M3 16l4.5-4 3.5 3 4-3.5L21 16.5"/></svg>'
};
/* the savings tree, drawn like the scene's tree (trunk + brand-2 circles), staged 1–3 */
function _treeSVG(stage){
  var f = stage >= 3 ? '<circle cx="22" cy="15" r="10"/><circle cx="13" cy="22" r="7"/><circle cx="31" cy="21" r="8"/>'
        : stage === 2 ? '<circle cx="22" cy="18" r="8"/><circle cx="15" cy="23" r="6"/>'
        : '<circle cx="22" cy="22" r="6"/>';
  return '<svg class="wt-treesvg" viewBox="0 0 44 44" aria-hidden="true"><rect x="20" y="25" width="4" height="12" rx="2" fill="#7d5f45"/><g fill="var(--brand-2)">' + f + '</g></svg>';
}
function wTile(o){      // {ch,chCls,label,mid,sub,act} — one small glanceable widget
  return '<button class="wtile" onclick="' + o.act + '">'
    + '<div class="wt-head"><span class="wt-ch ' + o.chCls + '">' + _WICON[o.ch] + '</span>' + o.label + '</div>'
    + '<div class="wt-mid">' + o.mid + '</div><div class="wt-sub">' + o.sub + '</div></button>';
}
var _QSVG = {
  exp: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"><path d="M4 7h16v13H4zM4 7l2-3h12l2 3M9 12h6"/></svg>',
  cam: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"><rect x="3" y="6" width="18" height="14" rx="3"/><circle cx="12" cy="13" r="3.2"/><path d="M8 6l1.5-2h5L16 6"/></svg>',
  cal: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"><rect x="3" y="5" width="18" height="16" rx="3"/><path d="M3 10h18M8 3v4M16 3v4"/></svg>',
  pig: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M3 10a5 5 0 015-5h5a6 6 0 016 6 6 6 0 01-3 5.2V20h-3v-2h-2v2H7v-3a6 6 0 01-4-5zM8 9h.01"/></svg>'
};
function qTile(o){      // {ic,chCls,label,act} — quick action, same tinted-chip language as the widget tiles
  return '<button class="qtile" onclick="' + o.act + '"><span class="qt-ic ' + o.chCls + '">' + o.ic + '</span>'
    + '<span class="qt-l">' + o.label + '</span></button>';
}
function _sectionH(title, link, label){ return '<div class="section-h"><div class="t">' + title + '</div>' + (link ? '<a onclick="' + link + '">' + (label || L('Xem tất cả', 'See all')) + '</a>' : '') + '</div>'; }

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
    finV = { mood: fmood, ico: fico, tt: ftt, ss: fss, safe: safe, overAmt: over ? (m.spent - m.budget) : 0, ps: Math.min(100, Math.round(m.spent / m.budget * 100)), foot: L('Đã tiêu ' + fmtK(m.spent) + ' / ' + fmtK(m.budget), 'Spent ' + fmtK(m.spent) + ' / ' + fmtK(m.budget)) };
  }
  var mComfortable = !!(finV && finV.mood === 'ok');

  /* ============ WIDGET GRID — four glanceable tiles, always present ============ */
  var goalsLive = gord.filter(function(g){ return !achievedGoal(goals[g]); });
  var tSaved = 0, tTarget = 0;
  goalsLive.forEach(function(g){ var e = goals[g]; if(e && e.target > 0){ tTarget += e.target; tSaved += Math.min(e.saved || 0, e.target); } });
  var tiles = '';
  // 1 · budget — what's left this month, with a mini progress ring
  if(finV){
    var rTok = finV.mood === 'over' ? 'danger' : (finV.mood === 'pace' ? 'amber' : 'good');
    var rPct = finV.mood === 'over' ? 100 : Math.max(0, 100 - finV.ps);
    var bBig = finV.mood === 'over' ? fmtK(finV.overAmt) : fmtK(finV.safe);
    var bUnit = finV.mood === 'over' ? L('vượt', 'over') : L('còn lại', 'left');
    var bSub = finV.mood === 'over' ? L('Cùng nhau chỉnh lại nha', 'Ease back together')
             : finV.mood === 'pace' ? L('Hơi nhanh tay một chút', 'A touch fast')
             : L('Đang thong thả', 'Comfortable');
    tiles += wTile({ ch: 'budget', chCls: 'wc-brand', label: L('Ngân sách', 'Budget'), mid: '<div class="wt-big">' + bBig + ' <span class="u">' + bUnit + '</span></div>' + _ringSVG(rPct, rTok), sub: bSub, act: 'go(&#39;spending&#39;)' });
  } else {
    tiles += wTile({ ch: 'budget', chCls: 'wc-brand', label: L('Ngân sách', 'Budget'), mid: '<span class="wt-add">＋</span>', sub: L('Đặt ngân sách tháng này', 'Set this month’s budget'), act: 'openSheet(&#39;sheet-budget&#39;)' });
  }
  // 2 · the savings tree — invest in the house (drawn like the scene's tree)
  var tStage = tTarget > 0 ? (tSaved / tTarget >= .7 ? 3 : (tSaved / tTarget >= .3 ? 2 : 1)) : 1;
  if(tTarget > 0){
    tiles += wTile({ ch: 'house', chCls: 'wc-good', label: L('Nhà mình', 'Our house'), mid: '<div class="wt-big">' + fmtK(tSaved) + '</div>' + _treeSVG(tStage), sub: L('Cây nhà đã lớn ' + Math.round(tSaved / tTarget * 100) + '%', 'The tree is ' + Math.round(tSaved / tTarget * 100) + '% grown'), act: 'go(&#39;spending&#39;)' });
  } else {
    tiles += wTile({ ch: 'house', chCls: 'wc-good', label: L('Nhà mình', 'Our house'), mid: '<span class="wt-add">＋</span>' + _treeSVG(1), sub: L('Trồng một mục tiêu chung', 'Plant a shared goal'), act: 'openGoal()' });
  }
  // 3 · next plan — countdown; the event's own emoji is the accessory
  if(up.length){
    var k0 = up[0], e0 = evs[k0], dl0 = daysLeft(e0.d);
    var cBig = dl0 === 0 ? L('Hôm nay', 'Today') : (dl0 === 1 ? L('Ngày mai', 'Tomorrow') : dl0 + ' <span class="u">' + L('ngày', 'days') + '</span>');
    var cAcc = e0.emoji ? '<span class="wt-emo">' + esc(e0.emoji) + '</span>' : '';
    tiles += wTile({ ch: 'plan', chCls: 'wc-amber', label: L('Sắp tới', 'Coming up'), mid: '<div class="wt-big">' + cBig + '</div>' + cAcc, sub: '<b>' + esc(e0.name) + '</b>', act: 'openEvent(&#39;' + escAttr(k0) + '&#39;)' });
  } else {
    tiles += wTile({ ch: 'plan', chCls: 'wc-amber', label: L('Sắp tới', 'Coming up'), mid: '<span class="wt-add">＋</span>', sub: L('Lên một kế hoạch vui', 'Plan something fun'), act: 'goMoments(&#39;plans&#39;);openSheet(&#39;sheet-event&#39;)' });
  }
  // 4 · album — count + a live micro-mosaic of the latest shots
  var phThis = memRecords.filter(function(r){ return r.d && r.d.getMonth() === TODAY.getMonth() && r.d.getFullYear() === TODAY.getFullYear(); });
  if(memRecords.length){
    var mz = memRecords.slice(0, 4).map(function(r){
      return r.src ? '<i style="background-image:url(' + escAttr(r.src) + ')"></i>'
                   : '<i class="' + esc(r.cls || 'ph-park') + '"><em>' + esc(r.emoji || '📸') + '</em></i>';
    }).join('');
    tiles += wTile({ ch: 'album', chCls: 'wc-rose', label: L('Album', 'Album'), mid: '<div class="wt-big">' + memRecords.length + ' <span class="u">' + L('ảnh', 'photos') + '</span></div><span class="wt-mosaic">' + mz + '</span>', sub: phThis.length ? L('Thêm ' + phThis.length + ' trong tháng này', phThis.length + ' new this month') : L('Khoảnh khắc của cả nhà', 'The family’s moments'), act: 'goMoments(&#39;album&#39;)' });
  } else {
    tiles += wTile({ ch: 'album', chCls: 'wc-rose', label: L('Album', 'Album'), mid: '<span class="wt-add">＋</span>', sub: L('Thêm tấm ảnh đầu tiên', 'Add the first photo'), act: 'openSheet(&#39;sheet-add&#39;)' });
  }

  html += '<div class="wgrid">' + tiles + '</div>';

  /* ============ KHOẢNH KHẮC — the featured photo card + the memory strip ============ */
  var kh = '', centerRef = null;
  if(fresh && homeVis){                                 // a shared dream reached — celebrated once
    milestones.forEach(function(mi){ celebrated[mi.key] = 1; });
    try{ localStorage.setItem('fh-celebrated', JSON.stringify(celebrated)); }catch(e){}
    kh += bigPhoto({ ill: 'party', eye: L('Vừa đủ rồi', 'Goal reached'), title: fresh.name, sub: L('Giấc mơ chung đã thành hình', 'A shared dream, reached'), tall: true, cta: { label: L('Xem mục tiêu', 'View goal') }, act: 'go(&#39;spending&#39;)' });
  } else if(memRecords.length){                         // the most recent moment, big — with who added it
    var r0 = memRecords[0], i0 = memRecords.indexOf(r0); centerRef = r0.type + ':' + r0.ref;
    var isExp0 = r0.type === 'expense';
    kh += bigPhoto({ src: r0.src, ill: r0.src ? null : occCover(r0.cap, r0.emoji), subj: r0.src ? r0.emoji : '', who: r0.who, eye: isExp0 ? L('Một khoản chi thành kỷ niệm', 'A spend, remembered') : L('Khoảnh khắc gần đây', 'A recent moment'), title: r0.cap, sub: esc(r0.meta || ''), tall: true, act: 'openMemory(' + i0 + ')' });
  } else {                                              // a new family — a warm, photo-shaped invitation
    kh += bigPhoto({ ill: 'outing', eye: L('Bắt đầu', 'Begin'), title: L('Câu chuyện của cả nhà', 'Your family’s story'), sub: L('Tấm ảnh đầu tiên bắt đầu từ đây', 'Your first photo starts here'), tall: true, cta: { label: '＋ ' + L('Thêm khoảnh khắc', 'Add a moment') }, act: 'openSheet(&#39;sheet-add&#39;)' });
  }
  var grps = (typeof memGroups === 'function') ? memGroups() : [];
  if(grps.length >= 2){                                 // more covers to browse, iOS-Photos style
    kh += '<div class="mem-strip home-strip">' + grps.slice(0, 6).map(memCoverHTML).join('') + '</div>';
  }
  html += _sectionH(L('Khoảnh khắc', 'Moments'), 'goMoments()') + kh;

  /* ============ CÙNG NHAU — quick actions for the family ============ */
  html += _sectionH(L('Cùng nhau', 'Together'))
    + '<div class="qgrid">'
    + qTile({ ic: _QSVG.exp, chCls: 'wc-brand', label: L('Chi tiêu', 'Expense'), act: 'go(&#39;spending&#39;);openExpense()' })
    + qTile({ ic: _QSVG.cam, chCls: 'wc-rose', label: L('Khoảnh khắc', 'Moment'), act: 'goMoments(&#39;album&#39;);paOpen()' })
    + qTile({ ic: _QSVG.cal, chCls: 'wc-amber', label: L('Kế hoạch', 'Plan'), act: 'goMoments(&#39;plans&#39;);openSheet(&#39;sheet-event&#39;)' })
    + qTile({ ic: _QSVG.pig, chCls: 'wc-indigo', label: L('Góp quỹ', 'Chip in'), act: 'fhSavings()' })
    + '</div>';

  /* ============ SẮP TỚI — the rich anticipation card (when there's a story to tell) ============ */
  if(up.length){
    var k = up[0], e = evs[k], dl = daysLeft(e.d);
    var emm = (e.memories && e.memories[0]) || null, eSrc = (emm && emm.src) ? emm.src : '', eIll = eSrc ? null : occCover(e.name, e.emoji);
    if(e.target > 0 || emm){
      var eyeU = dl === 0 ? L('Hôm nay', 'Today') : (dl === 1 ? L('Ngày mai', 'Tomorrow') : L('Còn ' + dl + ' ngày', dl + ' days to go'));
      if(e.target > 0){
        var pctU = Math.min(100, Math.round(e.saved / e.target * 100));
        html += _sectionH(L('Sắp tới', 'Coming up'), 'goMoments(&#39;plans&#39;)')
          + bigPhoto({ src: eSrc, ill: eIll, subj: eSrc ? e.emoji : '', eye: eyeU, title: e.name, sub: L('Cả nhà đã để dành được ' + pctU + '% rồi', 'Saved ' + pctU + '% together'), pct: pctU, cta: { label: L('Cùng góp thêm', 'Chip in') }, act: 'openEvent(&#39;' + escAttr(k) + '&#39;)' });
      } else {
        html += _sectionH(L('Sắp tới', 'Coming up'), 'goMoments(&#39;plans&#39;)')
          + bigPhoto({ src: eSrc, ill: eIll, subj: eSrc ? e.emoji : '', eye: eyeU, title: e.name, sub: L('Điều cả nhà đang mong', 'Something to look forward to'), cta: { label: L('Xem kế hoạch', 'View plan') }, act: 'openEvent(&#39;' + escAttr(k) + '&#39;)' });
      }
    }
  }

  /* ============ MỤC TIÊU CHUNG — chip in to a shared dream, right here ============ */
  if(goalsLive.length){
    var gRows = goalsLive.slice(0, 2).map(function(g){
      var e = goals[g], pct = e.target > 0 ? Math.min(100, Math.round(e.saved / e.target * 100)) : 0;
      return '<button class="hgoal" onclick="fundGoal(&#39;' + escAttr(g) + '&#39;)">'
        + '<div class="hg-ic">' + esc(e.emoji || '🎯') + '</div>'
        + '<div class="hg-b"><div class="hg-t">' + esc(e.name) + '</div>'
        + '<div class="hg-bar"><i style="width:' + pct + '%"></i></div>'
        + '<div class="hg-s">' + fmt(e.saved) + ' / ' + fmt(e.target) + '</div></div>'
        + '<span class="hg-pct">' + pct + '%</span></button>';
    }).join('');
    html += _sectionH(L('Mục tiêu chung', 'Shared goals'), 'openGoal()', '＋ ' + L('Mục tiêu', 'Goal')) + '<div class="hgoals">' + gRows + '</div>';
  }

  /* ============ NHỚ LẠI — a big nostalgia photo when a memory shares today's date ============ */
  if(onThis.length){
    var rr = onThis[0], refN = rr.type + ':' + rr.ref;
    if(refN !== centerRef){                              // don't repeat the centerpiece
      var iN = memRecords.indexOf(rr), yrs = TODAY.getFullYear() - rr.d.getFullYear();
      var agoVi = yrs <= 1 ? 'năm ngoái' : (yrs + ' năm trước'), agoEn = yrs <= 1 ? 'last year' : (yrs + ' years ago');
      html += _sectionH(L('Nhớ lại', 'Looking back'), 'goMoments(&#39;album&#39;)')
        + bigPhoto({ src: rr.src, ill: rr.src ? null : occCover(rr.cap, rr.emoji), subj: rr.src ? rr.emoji : '', who: rr.who, eye: L('Ngày này ' + agoVi, 'On this day · ' + agoEn), title: rr.cap, sub: esc(rr.meta || ''), cta: { label: L('Xem lại ngày ấy', 'Look back') }, act: 'openMemory(' + iN + ')' });
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
