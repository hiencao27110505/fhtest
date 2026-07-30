/* ---------- Home — the emotional feed ("moment engine") ----------
   Home isn't a dashboard: it surfaces ONE warm moment a day woven from
   everything the family has, with the family made VISIBLE (who added what) and
   the loop's hooks strengthened — a welcome-back line, milestone celebrations,
   a shared-dream avatar stack, a gentle seed. The tabs do; home makes you feel.
   Facilitator ethic: warmth, never streaks / guilt / scores. */

/* ---------- Thời tiết cảm xúc — a two-sided emotional loop ----------
   (1) Anyone sets today's weather in one tap. (2) EVERYONE sees it in a shared
   "family sky" — a row of faces, each with their mood. (3) When someone you love
   is having a rough day, you're handed a caring, BUILD-something action FOR them
   (⛈️ upset → a make-up jar; 🌧️ down → plan a treat they'll look forward to).
   (4) They feel seen. Backed by the realtime member_weather table so a mood set on
   one phone appears on the others. Self-care is only a quiet fallback when you're
   the only one who's shared. Every offer uses the ONE consistent .woffer card. */
var WEATHER = [
  { k:'sun',   e:'☀️', vi:'nắng',       en:'sunny',   fvi:'vui',        fen:'happy',    rough:false, oico:'✈️', ovi:'Rủ {n} lên kế hoạch một chuyến đi',          oen:'Plan a trip with {n}',                 act:"openSheet(&#39;sheet-event&#39;)" },
  { k:'fire',  e:'🔥', vi:'bừng',       en:'buzzing', fvi:'hứng khởi',  fen:'inspired', rough:false, oico:'🎯', ovi:'Cùng {n} mơ một điều lớn',                   oen:'Dream up something big with {n}',      act:"openGoal()" },
  { k:'ok',    e:'⛅', vi:'bình thường', en:'okay',    fvi:'ổn',         fen:'okay',     rough:false, oico:'📸', ovi:'Giữ một khoảnh khắc nhỏ cùng {n} hôm nay',   oen:'Keep a small moment with {n} today',   act:"openSheet(&#39;sheet-add&#39;)" },
  { k:'rain',  e:'🌧️', vi:'hơi buồn',   en:'down',    fvi:'hơi buồn',   fen:'down',     rough:true,  oico:'🌤️', ovi:'Hẹn một điều nhỏ để {n} mong tới',           oen:'Plan a little thing for {n} to enjoy', act:"openSheet(&#39;sheet-event&#39;)" },
  { k:'tired', e:'🌫️', vi:'mệt',        en:'drained', fvi:'mệt',        fen:'drained',  rough:true,  oico:'🫖', ovi:'Chuẩn bị một buổi tối nhẹ cho {n}',          oen:'Set up a cozy evening for {n}',        act:"openSheet(&#39;sheet-event&#39;)" },
  { k:'anger', e:'⛈️', vi:'bực bội',    en:'stormy',  fvi:'bực bội',    fen:'upset',    rough:true,  oico:'🕊️', ovi:'Gửi {n} một hũ làm hòa',                     oen:'Start a make-up jar for {n}',          act:"openGoal()" }
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

/* one avatar for the sky: real family palette (membersMeta) → FAM color fallback */
function _skyAv(m){
  var ini = (typeof inits === 'function') ? inits(m.name) : ('' + (m.name || '?')).charAt(0).toUpperCase();
  var col = (typeof membersMeta !== 'undefined' && membersMeta[m.name] && membersMeta[m.name].col) || m.color || '#8f8a99';
  return '<span class="fs-av av" style="background:' + col + '">' + esc(ini) + '</span>';
}
/* ONE connected card that straddles the hero and body.
   The reveal is GATED: until you share your own mood you can't see the family's —
   only locked silhouettes hinting they're there. Express → the sky opens, showing
   each member EMOTION-FIRST (a big mood, the face small beneath it), then the
   caring offers for whoever's having a rough day. */
function renderWeather(){
  var mems = (window.FAM && FAM.members) || [];
  var meName = _meName();
  var myW = myWeather();

  // (1) NOT expressed yet → ask + a locked teaser of the family (reciprocity gate)
  if(!myW || window._wpick){
    var btns = WEATHER.map(function(w){ return '<button class="wpk" onclick="setWeather(&#39;' + w.k + '&#39;)" aria-label="' + escAttr(L(w.vi, w.en)) + '">' + w.e + '</button>'; }).join('');
    var others = mems.filter(function(m){ return m.name !== meName; });
    var lock = others.length
      ? '<div class="wsky-lock"><span class="wsky-locks">' + others.slice(0, 5).map(function(m){ return '<span class="fs-lock">' + _skyAv(m) + '</span>'; }).join('')
        + '</span><span class="wsky-lockcap">' + L('Chia sẻ để xem cả nhà hôm nay thế nào', 'Share to see how your family is today') + '</span></div>'
      : '';
    return '<div class="wsky wsky-ask"><div class="wsky-q">' + L('Hôm nay bạn thế nào?', 'How are you today?') + '</div>'
      + '<div class="wrow">' + btns + '</div>' + lock + '</div>';
  }

  // (2) EXPRESSED → the family sky. Each cell is just the emotion + a name label —
  //     no avatar, no status text. Those who haven't shared read as a soft cloud.
  var sky = mems.map(function(m){
    var mine = (m.name === meName);
    var w = memberWeatherOf(m.name), wd = w && _wdef(w);
    var nm = esc((typeof firstName === 'function') ? firstName(m.name) : m.name);
    var emo = wd ? '<span class="fs-emo">' + wd.e + '</span>' : '<span class="fs-emo fs-emo-wait">☁️</span>';
    var inner = emo + '<span class="fs-n">' + nm + '</span>';
    var dn = ' data-name="' + escAttr(m.name) + '"';
    return mine
      ? '<button class="fs-c me"' + dn + ' onclick="openWeatherPick()" aria-label="' + escAttr(L('Đổi cảm xúc', 'Change your mood')) + '">' + inner + '</button>'
      : '<span class="fs-c' + (wd ? '' : ' waiting') + '"' + dn + '>' + inner + '</span>';
  }).join('');

  // caring, build-something offers for the OTHERS — rough moods first, at most two.
  // They live INSIDE the card (a footer under the faces).
  var offers = [];
  mems.forEach(function(m){
    if(m.name === meName) return;
    var w = memberWeatherOf(m.name), wd = w && _wdef(w); if(!wd) return;
    offers.push({ nm: (typeof firstName === 'function') ? firstName(m.name) : m.name, wd: wd });
  });
  offers.sort(function(a, b){ return (b.wd.rough ? 1 : 0) - (a.wd.rough ? 1 : 0); });
  var offHtml = offers.slice(0, 2).map(function(o){
    var nm = esc(o.nm);
    var eye = nm + ' ' + L('đang ' + o.wd.fvi, 'is ' + o.wd.fen);
    var line = L(o.wd.ovi, o.wd.oen).replace(/\{n\}/g, nm);
    return '<button class="woffer" onclick="' + o.wd.act + '"><div class="wo-ico">' + o.wd.oico + '</div>'
      + '<div class="wo-body"><div class="wo-k">' + eye + '</div><div class="wo-t">' + line + '</div></div>'
      + '<svg class="chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18l6-6-6-6"/></svg></button>';
  }).join('');

  // faces → caring things to do. The collective "read" now lives in the page
  // subtitle (renderHome sets it via moodRead()), so it isn't repeated here.
  return '<div class="wsky wsky-open">'
    + '<div class="fsky-row">' + sky + '</div>'
    + (offHtml ? '<div class="sky-acts">' + offHtml + '</div>' : '')
    + '</div>';
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

  // subtitle under the greeting = the family mood read (or the check-in prompt)
  setTxt('greet-sub', (!myW || window._wpick) ? L('Hôm nay bạn thế nào?', 'How are you today?') : moodRead());

  var html = renderWeather();                           // focal mood card (peer of the ring/calendar)

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
  var usedRef = null;

  /* ============ KHOẢNH KHẮC ============ */
  var kh = '';
  if(fresh && homeVis){                                 // a shared dream reached — celebrated once
    milestones.forEach(function(mi){ celebrated[mi.key] = 1; });
    try{ localStorage.setItem('fh-celebrated', JSON.stringify(celebrated)); }catch(e){}
    usedRef = fresh.key;
    kh += '<button class="hmoment" onclick="go(&#39;spending&#39;)">' + hVisual(fresh.cls, '', '🎉')
      + '<div class="hm-cap"><div class="hm-eye">' + L('Vừa đủ rồi', 'Goal reached') + '</div><div class="hm-title">' + esc(fresh.name) + '</div>'
      + '<div class="hm-sub">' + L('Giấc mơ chung đã thành hình 🎉', 'A shared dream, reached 🎉') + '</div>'
      + '<div class="hm-fam">' + hFamAvs(4) + '</div></div></button>';
  } else if(onThis.length){                             // nostalgia — rotate the angle: photo · question · then↔now
    var rr = onThis[0], i0 = memRecords.indexOf(rr), yrs = TODAY.getFullYear() - rr.d.getFullYear();
    var agoVi = yrs <= 1 ? 'năm ngoái' : (yrs + ' năm trước'), agoEn = yrs <= 1 ? 'last year' : (yrs + ' years ago');
    usedRef = rr.type + ':' + rr.ref;
    var f = rot % 3;
    if(f === 0){ kh += hMemMoment(rr, L('Ngày này ' + agoVi, 'On this day · ' + agoEn)); }
    else if(f === 1){ kh += fPeek({ cls: rr.cls, src: rr.src, emoji: rr.emoji, title: L('Còn nhớ hôm này ' + agoVi + '?', 'Remember this day, ' + agoEn + '?'), sub: esc(rr.cap || L('Chạm để mở lại', 'Tap to look back')), act: 'openMemory(' + i0 + ')' }); }
    else { kh += fThenNow({ cls: rr.cls, src: rr.src, emoji: rr.emoji, thenL: esc(rr.cap || agoVi), nowL: L('Hôm nay?', 'Today?'), cap: L('Thêm hôm nay vào bộ sưu tập', 'Add today to the collection'), act: 'openSheet(&#39;sheet-add&#39;)' }); }
  } else if(memRecords.length){                         // a recent moment resurfaced
    var r0 = memRecords[0]; usedRef = r0.type + ':' + r0.ref;
    kh += hMemMoment(r0, L('Khoảnh khắc gần đây', 'A recent moment'));
  } else {                                              // a new family — a gentle invitation
    kh += '<button class="hmoment" onclick="openSheet(&#39;sheet-add&#39;)"><div class="hm-bg ph-park"></div><div class="hm-scrim"></div><div class="hm-subj">🌿</div>'
      + '<div class="hm-cap"><div class="hm-eye">' + L('Bắt đầu', 'Begin') + '</div><div class="hm-title">' + L('Câu chuyện của cả nhà', 'Your family’s story') + '</div>'
      + '<div class="hm-sub">' + L('Thêm khoảnh khắc đầu tiên 💛', 'Add your first moment 💛') + '</div></div></button>';
  }

  // relatives' data — what the family added while you were away
  if(window._homeSess === undefined){
    try{ var _ls = localStorage.getItem('fh-lastseen'); window._homeSess = _ls ? (parseInt(_ls, 10) || 0) : Date.now(); localStorage.setItem('fh-lastseen', '' + Date.now()); }catch(e){ window._homeSess = Date.now(); }
  }
  var away = memRecords.filter(function(r){ var w = ('' + (r.who || '')).toLowerCase(); return w && w !== meName && w !== 'both' && w !== 'shared' && w !== 'chung' && r.d && r.d.getTime() > window._homeSess; });
  if(away.length){
    var nm0 = (typeof firstName === 'function') ? firstName(away[0].who) : away[0].who;
    kh += fRelational({ name: away[0].who, emoji: '💛', html: L('<b>' + esc(nm0) + '</b> vừa thêm ' + away.length + ' khoảnh khắc lúc bạn vắng', '<b>' + esc(nm0) + '</b> added ' + away.length + ' moment' + (away.length > 1 ? 's' : '') + ' while you were away'), act: 'goMoments(&#39;album&#39;)' });
  }

  // reflection from history — a warm count, never a scoreboard
  var monCount = memRecords.filter(function(r){ return r.d && r.d.getFullYear() === TODAY.getFullYear() && r.d.getMonth() === TODAY.getMonth(); }).length;
  if(monCount >= 3){
    kh += fReflect({ ico: '💛', html: L('Tháng này cả nhà đã cùng lưu <b>' + monCount + ' khoảnh khắc</b> 🌿', 'This month you’ve saved <b>' + monCount + ' moments</b> together 🌿') });
  }

  // build a memory — capture today (rotate a chips prompt with a plain act-row)
  if(rot % 2 === 0){
    kh += fChips({ q: L('Hôm nay có gì đáng nhớ không?', 'Anything worth remembering today?'), chips: [
      { label: '📸 ' + L('Thêm ảnh', 'Add a photo'), act: 'openSheet(&#39;sheet-add&#39;)', br: true },
      { label: '✍️ ' + L('Ghi một dòng', 'Jot a line'), act: 'openSheet(&#39;sheet-add&#39;)' }] });
  } else {
    kh += fActRow({ ico: '📸', eye: L('Giữ lại hôm nay', 'Keep today'), title: L('Thêm một khoảnh khắc mới', 'Add a new moment'), act: 'openSheet(&#39;sheet-add&#39;)' });
  }
  html += _sectionH(L('Khoảnh khắc', 'Moments'), 'goMoments()') + kh;

  /* ============ TÀI CHÍNH ============ */
  var m = (typeof M === 'function') ? M() : null;
  if(m && m.budget > 0){
    var reserved = m.done ? 0 : monthReserved();
    var safe = Math.max(0, m.budget - m.spent - reserved), over = m.spent > m.budget;
    var proj = !m.done && m.dom > 0 && ((m.spent / m.dom * m.dim) - m.budget > m.budget * 0.01);
    var mood, ico, tt, ss;
    if(over){ mood = 'over'; ico = '🍂'; tt = L('Hơi quá tay một chút rồi', 'A little over this month');
      ss = L('Vượt ' + fmtK(m.spent - m.budget) + ' · cùng nhau chỉnh lại nha', 'Over by ' + fmtK(m.spent - m.budget) + ' · ease back together'); }
    else if(proj){ mood = 'pace'; ico = '⚡'; tt = L('Tháng này tiêu hơi nhanh tay', 'Spending a touch fast');
      ss = L('Nhẹ nhàng chút là vẫn dư · còn ' + fmtK(safe), 'Ease up · ' + fmtK(safe) + ' left'); }
    else { mood = 'ok'; ico = '🌿'; tt = L('Tháng này cả nhà đang thong thả', 'Comfortable this month');
      ss = L('Còn ' + fmtK(safe) + ' để cả nhà thoải mái tận hưởng', fmtK(safe) + ' left to enjoy together'); }
    var ps = Math.min(100, Math.round(m.spent / m.budget * 100));
    html += _sectionH(L('Tài chính', 'Finance'), 'go(&#39;spending&#39;)')
      + '<button class="hpulse ' + mood + '" onclick="go(&#39;spending&#39;)"><div class="hp-ico">' + ico + '</div>'
      + '<div class="hp-body"><div class="hp-title">' + tt + '</div><div class="hp-sub">' + ss + '</div>'
      + '<div class="hp-bar"><i style="width:' + ps + '%"></i></div></div></button>';
  }

  /* ============ SẮP TỚI ============ */
  var st = '', firstUp = null;
  if(up.length){
    firstUp = up[0]; var e = evs[firstUp], dl = daysLeft(e.d);
    var emm = (e.memories && e.memories[0]) || null, eSrc = (emm && emm.src) ? emm.src : '', eCls = (emm && emm.cls) ? emm.cls : 'ph-hike';
    if(e.target > 0){                                   // saving together → a progress widget
      var pct = Math.min(100, Math.round(e.saved / e.target * 100));
      st += fProgress({ cls: eCls, src: eSrc, emoji: e.emoji, title: esc(e.name), sub: L('còn ' + dl + ' ngày · cả nhà đang để dành', dl + ' days · saving together'), pct: pct, avlbl: L('cả nhà cùng góp', 'saving together'), act: 'openEvent(&#39;' + escAttr(firstUp) + '&#39;)' });
    } else {                                            // pure anticipation → a countdown
      st += fCountdown({ n: dl, unit: L('ngày nữa', 'days'), title: esc(e.name) + (e.emoji ? ' ' + esc(e.emoji) : ''), sub: L('điều cả nhà đang mong 💛', 'something to look forward to 💛'), act: 'openEvent(&#39;' + escAttr(firstUp) + '&#39;)' });
    }
  }
  // dream a goal — finances comfortable and no active goal yet
  if(m && m.budget > 0 && m.spent <= m.budget && gord.length === 0){
    st += fActRow({ ico: '🎯', eye: L('Cả nhà đang thong thả', 'Comfortable this month'), title: L('Cùng mơ một điều lớn — đặt mục tiêu chung?', 'Dream big — set a shared goal?'), act: 'openGoal()' });
  }
  // a quiet look-ahead whisper to the next occasion
  var nk = up.length > 1 ? up[1] : null;
  if(nk){
    var e2 = evs[nk], dl2 = daysLeft(e2.d);
    st += fWhisper({ ico: esc(e2.emoji || '🗓️'), html: L('Rồi tới <b>' + esc(e2.name) + '</b> · còn ' + dl2 + ' ngày', 'Then <b>' + esc(e2.name) + '</b> · ' + dl2 + ' days'), act: 'openEvent(&#39;' + escAttr(nk) + '&#39;)' });
  }
  if(st) html += _sectionH(L('Sắp tới', 'Coming up'), 'goMoments(&#39;plans&#39;)') + st;

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
  var cells = host.querySelectorAll('.fs-c');
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
  // Only on the OPEN sky (home visible). In the locked "share first" state the host
  // is absent, so a member's change defers — it neither leaks past the reciprocity
  // gate nor gets marked seen, and animates once the user shares and the sky opens.
  var host = document.querySelector('#v-home.on .wsky.wsky-open'); if(!host) return;
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
