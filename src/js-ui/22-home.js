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

/* a full-bleed cover: a real photo (src) or a scene gradient (cls), with scrim + subject emoji */
function hVisual(cls, src, subj){
  var bg = src ? '<div class="hm-bg" style="background-image:url(' + escAttr(src) + ')"></div>'
               : '<div class="hm-bg ' + esc(cls || 'ph-park') + '"></div>';
  return bg + '<div class="hm-scrim"></div>' + (subj ? '<div class="hm-subj">' + esc(subj) + '</div>' : '');
}
/* a small square thumb for a woven beat */
function hThumb(cls, src, subj){
  var st = src ? ' style="background-image:url(' + escAttr(src) + ')"' : '';
  return '<div class="hb-thumb ' + (src ? '' : esc(cls || 'ph-park')) + '"' + st + '>'
    + '<div class="hm-scrim"></div>' + (subj ? '<div class="hb-subj">' + esc(subj) + '</div>' : '') + '</div>';
}
/* family presence: a small avatar + first name of who added it — a face, never a score */
function hByline(who){
  if(!who) return '';
  var w = ('' + who).toLowerCase();
  if(w === 'both' || w === 'shared' || w === 'chung') return '';        // collective → no single author
  var nm = ('' + who).charAt(0).toUpperCase() + ('' + who).slice(1), av = '', mm = null;
  if(typeof membersMeta !== 'undefined' && membersMeta){               // real family palette (mirrors spAv)
    for(var n in membersMeta){ if(n.toLowerCase() === w){ mm = membersMeta[n]; nm = n; break; } }
  }
  if(mm){ av = '<span class="av hby-av" style="background:' + mm.col + ';color:#fff">' + esc(mm.ini) + '</span>'; }
  else { var a = (typeof spMap !== 'undefined' && spMap[w]) || null; if(a) av = '<span class="av hby-av ' + a[0] + '">' + a[1] + '</span>'; }
  if(typeof firstName === 'function') nm = firstName(nm);
  return '<span class="hby">' + av + esc(nm) + '</span>';
}
/* a small overlapping stack of the family's avatars (for "saving together") */
function hFamAvs(n){
  var mems = (window.FAM && FAM.members) || [];
  return mems.slice(0, n || 4).map(function(mm){
    var ini = (typeof inits === 'function') ? inits(mm.name) : ('' + (mm.name || '?')).charAt(0).toUpperCase();
    return '<span class="av hby-av" style="background:' + (mm.color || '#8f8a99') + ';color:#fff">' + esc(ini) + '</span>';
  }).join('');
}
/* a memory record rendered as the centerpiece moment (on-this-day / recent) */
function hMemMoment(r, eye){
  var i = memRecords.indexOf(r), by = hByline(r.who);
  return '<button class="hmoment" onclick="openMemory(' + i + ')">' + hVisual(r.cls, r.src, r.emoji)
    + '<div class="hm-cap"><div class="hm-eye">' + eye + '</div><div class="hm-title">' + esc(r.cap) + '</div>'
    + '<div class="hm-sub">' + esc(r.meta || '') + '</div>' + (by ? '<div class="hm-by">' + by + '</div>' : '') + '</div></button>';
}

/* ============================================================================
   Home recommendation FORMS — the Apple-kit widgets. Each takes an opts object
   and returns HTML. The engine (renderHome) picks WHICH form to use per trigger,
   rotating by day so the same trigger lands from a different angle each time.
   ============================================================================ */
var _CHEVSVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18l6-6-6-6"/></svg>';
function _rvAvs(n){
  var mems = (window.FAM && FAM.members) || [];
  return mems.slice(0, n || 3).map(function(m){
    var ini = (typeof inits === 'function') ? inits(m.name) : ('' + (m.name || '?')).charAt(0);
    var col = (typeof membersMeta !== 'undefined' && membersMeta[m.name] && membersMeta[m.name].col) || m.color || '#8f8a99';
    return '<span class="rav" style="background:' + col + '">' + esc(ini) + '</span>';
  }).join('');
}
function _rBg(cls, src){ return src ? '' : (' ' + esc(cls || 'ph-park')); }
function _rSt(cls, src){ return src ? ' style="background-image:url(' + escAttr(src) + ')"' : ''; }
function fActRow(o){                                    // icon → eyebrow/title → chevron
  return '<button class="ract" onclick="' + o.act + '"><div class="ract-ico' + (o.tone ? ' ' + o.tone : '') + '">' + o.ico + '</div>'
    + '<div class="ract-b">' + (o.eye ? '<div class="ract-k">' + o.eye + '</div>' : '') + '<div class="ract-t">' + o.title + '</div></div>'
    + '<span class="chev">' + _CHEVSVG + '</span></button>';
}
function fReflect(o){ return '<div class="rrefl"><div class="rrefl-h">' + o.ico + '</div><div class="rrefl-t">' + o.html + '</div></div>'; }
function fWhisper(o){ return '<button class="rwhis" onclick="' + o.act + '"><span class="rwhis-i">' + o.ico + '</span><span class="rwhis-t">' + o.html + '</span></button>'; }
function fChips(o){
  var c = o.chips.map(function(ch){ return '<button class="rchip' + (ch.br ? ' br' : '') + '" onclick="' + ch.act + '">' + ch.label + '</button>'; }).join('');
  return '<div class="rchips"><div class="rchips-q">' + o.q + '</div><div class="rchips-r">' + c + '</div></div>';
}
function fCountdown(o){
  return '<button class="rcd" onclick="' + o.act + '"><div class="rcd-n"><b>' + o.n + '</b><span>' + o.unit + '</span></div>'
    + '<div class="rcd-b"><div class="rcd-t">' + o.title + '</div>' + (o.sub ? '<div class="rcd-s">' + o.sub + '</div>' : '') + '</div>'
    + '<span class="chev">' + _CHEVSVG + '</span></button>';
}
function fRelational(o){
  var ini = (typeof inits === 'function') ? inits(o.name) : ('' + (o.name || '?')).charAt(0);
  var col = (typeof membersMeta !== 'undefined' && membersMeta[o.name] && membersMeta[o.name].col) || o.color || '#8f8a99';
  return '<button class="rrel" onclick="' + o.act + '"><span class="rrel-av" style="background:' + col + '">' + esc(ini) + (o.emoji ? '<span class="em">' + o.emoji + '</span>' : '') + '</span>'
    + '<span class="rrel-t">' + o.html + '</span><span class="chev">' + _CHEVSVG + '</span></button>';
}
function fProgress(o){
  var thumb = '<div class="rprog-th' + _rBg(o.cls, o.src) + '"' + _rSt(o.cls, o.src) + '><div class="sc"></div>' + (o.emoji ? '<div class="em">' + o.emoji + '</div>' : '') + '</div>';
  var avs = o.avlbl ? '<div class="rav-stack">' + _rvAvs(3) + '<span class="lbl">' + o.avlbl + '</span></div>' : '';
  return '<button class="rprog" onclick="' + o.act + '"><div class="rprog-top">' + thumb
    + '<div class="rprog-b"><div class="rprog-t">' + o.title + '</div>' + (o.sub ? '<div class="rprog-s">' + o.sub + '</div>' : '') + '</div>'
    + '<span class="rprog-pct">' + o.pct + '%</span></div>'
    + '<div class="rprog-bar"><i style="width:' + o.pct + '%"></i></div>' + avs + '</button>';
}
function fPeek(o){
  return '<button class="rpeek" onclick="' + o.act + '"><div class="rpeek-th' + _rBg(o.cls, o.src) + '"' + _rSt(o.cls, o.src) + '>' + (o.emoji ? '<div class="em">' + o.emoji + '</div>' : '') + '</div>'
    + '<div class="rpeek-b"><div class="rpeek-t">' + o.title + '</div>' + (o.sub ? '<div class="rpeek-s">' + o.sub + '</div>' : '') + '</div>'
    + '<span class="chev">' + _CHEVSVG + '</span></button>';
}
function fThenNow(o){
  return '<button class="rtn" onclick="' + o.act + '"><div class="rtn-g">'
    + '<div class="rtn-p' + _rBg(o.cls, o.src) + '"' + _rSt(o.cls, o.src) + '>' + (o.src ? '' : '<div class="em">' + (o.emoji || '📷') + '</div>') + '<div class="l">' + o.thenL + '</div></div>'
    + '<div class="rtn-p now"><div class="em">＋</div><div class="l">' + o.nowL + '</div></div></div>'
    + '<div class="rtn-cap">' + o.cap + '</div></button>';
}
function _sectionH(title, link){ return '<div class="section-h"><div class="t">' + title + '</div>' + (link ? '<a onclick="' + link + '">' + L('Xem tất cả', 'See all') + '</a>' : '') + '</div>'; }

/* ---- BIG media-rich widgets (immersive photo · friendly CTA · finance stat) ---- */
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
function bigPhoto(o){   // {cls,src,subj,who,eye,title,sub,pct,cta:{label},tall,act}
  var cta = o.cta ? '<span class="bp-cta">' + o.cta.label + '</span>' : '';
  var prog = (typeof o.pct === 'number') ? '<div class="bp-prog"><i style="width:' + o.pct + '%"></i></div>' : '';
  return '<button class="bigphoto' + (o.tall ? ' tall' : '') + '" onclick="' + o.act + '">'
    + '<div class="' + _phCls(o.cls, o.src) + '"' + _phBg(o.cls, o.src) + '></div><div class="bp-sc"></div>'
    + (o.subj ? '<div class="bp-subj">' + esc(o.subj) + '</div>' : '') + _byChip(o.who)
    + '<div class="bp-cap"><div class="bp-eye">' + o.eye + '</div><div class="bp-ti">' + esc(o.title) + '</div>'
    + (o.sub ? '<div class="bp-mt">' + o.sub + '</div>' : '') + prog + cta + '</div></button>';
}
function ctaCard(o){    // {ill,title,sub,cta:{label,act},row2:[{label,act}]}
  var btn = o.cta ? '<button class="btn-fill" onclick="' + o.cta.act + '">' + o.cta.label + '</button>' : '';
  var row = o.row2 ? '<div class="cc-row2">' + o.row2.map(function(b){ return '<button class="btn-soft" onclick="' + b.act + '">' + b.label + '</button>'; }).join('') + '</div>' : '';
  return '<div class="ctacard"><div class="cc-ill">' + o.ill + '</div><div class="cc-t">' + o.title + '</div>'
    + (o.sub ? '<div class="cc-s">' + o.sub + '</div>' : '') + btn + row + '</div>';
}
function finCard(o){    // {mood,ico,title,sub,pct,foot,act}
  return '<button class="fincard ' + o.mood + '" onclick="' + o.act + '"><div class="fc-top"><div class="fc-i">' + o.ico + '</div>'
    + '<div><div class="fc-t">' + o.title + '</div><div class="fc-s">' + o.sub + '</div></div></div>'
    + '<div class="fc-bar"><i style="width:' + o.pct + '%"></i></div>'
    + (o.foot ? '<div class="fc-foot"><span>' + o.foot + '</span><em>' + L('Xem chi tiết →', 'View details →') + '</em></div>' : '') + '</button>';
}

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

  /* ============ KHOẢNH KHẮC — a big, media-rich centerpiece + a warm capture CTA ============ */
  var kh = '', centerRef = null;
  if(fresh && homeVis){                                 // a shared dream reached — celebrated once
    milestones.forEach(function(mi){ celebrated[mi.key] = 1; });
    try{ localStorage.setItem('fh-celebrated', JSON.stringify(celebrated)); }catch(e){}
    kh += bigPhoto({ cls: fresh.cls, subj: '🎉', eye: L('Vừa đủ rồi', 'Goal reached'), title: fresh.name, sub: L('Giấc mơ chung đã thành hình 🎉', 'A shared dream, reached 🎉'), tall: true, cta: { label: '🎯 ' + L('Xem mục tiêu', 'View goal') }, act: 'go(&#39;spending&#39;)' });
  } else if(memRecords.length){                         // the most recent moment, big — with the real photo + who added it
    var r0 = memRecords[0], i0 = memRecords.indexOf(r0); centerRef = r0.type + ':' + r0.ref;
    var isExp0 = r0.type === 'expense';
    kh += bigPhoto({ cls: r0.cls, src: r0.src, subj: r0.emoji, who: r0.who, eye: isExp0 ? L('Một khoản chi thành kỷ niệm', 'A spend, remembered') : L('Khoảnh khắc gần đây', 'A recent moment'), title: r0.cap, sub: esc(r0.meta || ''), tall: true, act: 'openMemory(' + i0 + ')' });
  } else {                                              // a new family — a warm, photo-shaped invitation
    kh += bigPhoto({ cls: 'ph-park', subj: '🌿', eye: L('Bắt đầu', 'Begin'), title: L('Câu chuyện của cả nhà', 'Your family’s story'), sub: L('Tấm ảnh đầu tiên bắt đầu từ đây 💛', 'Your first photo starts here 💛'), tall: true, cta: { label: '＋ ' + L('Thêm khoảnh khắc', 'Add a moment') }, act: 'openSheet(&#39;sheet-add&#39;)' });
  }
  if(memRecords.length || fresh){                       // a big, friendly capture CTA under the centerpiece
    kh += ctaCard({ ill: '📸', title: L('Hôm nay có gì đáng nhớ không?', 'Anything worth remembering today?'), sub: L('Một tấm ảnh, một dòng ngắn — để dành cho cả nhà xem lại sau này.', 'A photo, a line — to look back on together.'), cta: { label: '＋ ' + L('Thêm một khoảnh khắc', 'Add a moment'), act: 'openSheet(&#39;sheet-add&#39;)' } });
  }
  html += _sectionH(L('Khoảnh khắc', 'Moments'), 'goMoments()') + kh;

  /* ============ SẮP TỚI — a big anticipation card with a real CTA ============ */
  var st = '';
  if(up.length){
    var k = up[0], e = evs[k], dl = daysLeft(e.d);
    var emm = (e.memories && e.memories[0]) || null, eSrc = (emm && emm.src) ? emm.src : '', eCls = (emm && emm.cls) ? emm.cls : 'ph-hike';
    var eyeU = dl === 0 ? L('Hôm nay', 'Today') : (dl === 1 ? L('Ngày mai', 'Tomorrow') : L('Còn ' + dl + ' ngày', dl + ' days to go'));
    if(e.target > 0){
      var pctU = Math.min(100, Math.round(e.saved / e.target * 100));
      st += bigPhoto({ cls: eCls, src: eSrc, subj: e.emoji, eye: eyeU, title: e.name, sub: L('Cả nhà đã để dành được ' + pctU + '% rồi 🌿', 'Saved ' + pctU + '% together 🌿'), pct: pctU, cta: { label: '🌱 ' + L('Cùng góp thêm', 'Chip in') }, act: 'openEvent(&#39;' + escAttr(k) + '&#39;)' });
    } else {
      st += bigPhoto({ cls: eCls, src: eSrc, subj: e.emoji, eye: eyeU, title: e.name, sub: L('Điều cả nhà đang mong 💛', 'Something to look forward to 💛'), cta: { label: L('Xem kế hoạch', 'View plan') }, act: 'openEvent(&#39;' + escAttr(k) + '&#39;)' });
    }
  }
  if(mComfortable && gord.length === 0){                 // dream a goal — comfortable + no active goal yet
    st += ctaCard({ ill: '🎯', title: L('Cùng mơ một điều lớn?', 'Dream something big?'), sub: L('Tháng này cả nhà thong thả — đặt một mục tiêu chung để cùng hướng tới.', 'A comfortable month — set a shared goal to grow toward.'), cta: { label: L('Đặt mục tiêu chung', 'Set a shared goal'), act: 'openGoal()' } });
  }
  if(st) html += _sectionH(L('Sắp tới', 'Coming up'), 'goMoments(&#39;plans&#39;)') + st;

  /* ============ TÀI CHÍNH — one distinct, warm stat card ============ */
  if(finV){
    html += _sectionH(L('Tài chính', 'Finance'), 'go(&#39;spending&#39;)')
      + finCard({ mood: finV.mood, ico: finV.ico, title: finV.tt, sub: finV.ss, pct: finV.ps, foot: finV.foot, act: 'go(&#39;spending&#39;)' });
  }

  /* ============ NHỚ LẠI — a big nostalgia photo when a memory shares today's date ============ */
  if(onThis.length){
    var rr = onThis[0], refN = rr.type + ':' + rr.ref;
    if(refN !== centerRef){                              // don't repeat the centerpiece
      var iN = memRecords.indexOf(rr), yrs = TODAY.getFullYear() - rr.d.getFullYear();
      var agoVi = yrs <= 1 ? 'năm ngoái' : (yrs + ' năm trước'), agoEn = yrs <= 1 ? 'last year' : (yrs + ' years ago');
      html += _sectionH(L('Nhớ lại', 'Looking back'), 'goMoments(&#39;album&#39;)')
        + bigPhoto({ cls: rr.cls, src: rr.src, subj: rr.emoji, who: rr.who, eye: L('Ngày này ' + agoVi, 'On this day · ' + agoEn), title: rr.cap, sub: esc(rr.meta || ''), cta: { label: '💛 ' + L('Xem lại ngày ấy', 'Look back') }, act: 'openMemory(' + iN + ')' });
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
