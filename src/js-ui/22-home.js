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
    return mine
      ? '<button class="fs-c me" onclick="openWeatherPick()" aria-label="' + escAttr(L('Đổi cảm xúc', 'Change your mood')) + '">' + inner + '</button>'
      : '<span class="fs-c' + (wd ? '' : ' waiting') + '">' + inner + '</span>';
  }).join('');

  // a warm, collective read of the whole sky (the emotional payoff, not a stat)
  var oth = mems.filter(function(m){ return m.name !== meName; });
  var othShared = oth.filter(function(m){ return memberWeatherOf(m.name); });
  var roughAny = othShared.some(function(m){ var d = _wdef(memberWeatherOf(m.name)); return d && d.rough; });
  var read = roughAny ? L('Có người đang cần được quan tâm 💛', 'Someone could use a little care 💛')
           : othShared.length ? L('Cả nhà đang ổn cả 🌿', 'Everyone’s doing okay 🌿')
           : oth.length ? L('Chờ cả nhà cùng chia sẻ nhé', 'Waiting for the family to check in')
           : L('Mời thêm cả nhà cùng chia sẻ nhé 💛', 'Invite your family to share 💛');

  var out = '<div class="wsky wsky-open"><div class="wsky-h">' + L('Bầu trời của nhà', 'The family sky') + '</div>'
    + '<div class="fsky-row">' + sky + '</div><div class="sky-read">' + read + '</div></div>';

  // (3) caring, build-something offers for the OTHERS — rough moods first, at most two
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

  // Offers are for the OTHERS only — no self-directed action. If nobody else has
  // shared a mood, the sky simply stands on its own.
  return out + offHtml;
}

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

function renderHome(){
  var box = document.getElementById('home-body'); if(!box) return;
  buildMemRecords();
  var evs = window.events || {}, ord = window.order || [];
  var isMirrorK = function(k){ var e = evs[k]; return !!(e && (e._srcTxn || e.fromExpense)); };
  var _meM = ((window.FAM && FAM.members) || []).filter(function(mm){ return mm.me; })[0];   // the in-family member name (who is tagged with)
  var meName = (_meM ? _meM.name : ((window.FAM && FAM.user && FAM.user.name) || '')).toLowerCase();
  var _hv = document.getElementById('v-home'); var homeVis = !!(_hv && _hv.classList.contains('on'));
  var html = renderWeather(), usedRef = null;                          // Thời tiết cảm xúc — express + a matched offer, always on top

  // upcoming real occasions (not achieved, not a photo-expense mirror), nearest first
  var up = ord.filter(function(k){ return evs[k] && evs[k].d && !isMirrorK(k) && !achievedNow(evs[k]); })
              .sort(function(a, b){ return evs[a].d.getTime() - evs[b].d.getTime(); });
  // a memory from a prior year, near today's date — "on this day"
  var onThis = memRecords.filter(function(r){
    if(!r.d || r.d.getFullYear() >= TODAY.getFullYear()) return false;
    var a = new Date(TODAY.getFullYear(), r.d.getMonth(), r.d.getDate());
    return Math.abs((a - TODAY) / 86400000) <= 3;                       // within 3 days of the anniversary
  });

  /* ---- #4 welcome-back: what the family added while you were away (top) ---- */
  if(window._homeSess === undefined){                                   // capture last-seen once per page load, then advance it
    try{ var _ls = localStorage.getItem('fh-lastseen'); window._homeSess = _ls ? (parseInt(_ls, 10) || 0) : Date.now(); localStorage.setItem('fh-lastseen', '' + Date.now()); }catch(e){ window._homeSess = Date.now(); }
  }
  var lastSeen = window._homeSess;
  var others = memRecords.filter(function(r){
    var w = ('' + (r.who || '')).toLowerCase();
    return w && w !== meName && w !== 'both' && w !== 'shared' && w !== 'chung' && r.d && r.d.getTime() > lastSeen;
  });
  if(others.length){
    var byWho = {}, seq = [];
    others.forEach(function(r){ var w = r.who; if(!byWho[w]){ byWho[w] = 0; seq.push(w); } byWho[w]++; });
    var parts = seq.slice(0, 2).map(function(w){ var c = byWho[w]; return '<b>' + esc((typeof firstName === 'function' ? firstName(w) : w)) + '</b> ' + L('thêm ' + c + ' khoảnh khắc', 'added ' + c + (c === 1 ? ' moment' : ' moments')); });
    html += '<button class="hwelcome" onclick="goMoments(&#39;album&#39;)">' + L('Trong lúc bạn vắng', 'While you were away') + ': ' + parts.join(' · ') + ' 💛</button>';
  }

  /* ---- #5 milestone: a goal/occasion just fully funded — celebrated once ---- */
  var celebrated = {}; try{ celebrated = JSON.parse(localStorage.getItem('fh-celebrated') || '{}') || {}; }catch(e){ celebrated = {}; }
  var milestones = [];
  var goals = window.goals || {}, gord = window.goalOrder || [];
  gord.forEach(function(g){ var go = goals[g]; if(go && typeof achievedGoal === 'function' && achievedGoal(go)) milestones.push({ key: 'goal:' + g, name: go.name, cls: go.cls || 'ph-park' }); });
  var fresh = milestones.filter(function(mi){ return !celebrated[mi.key]; })[0] || null;

  /* ---- centerpiece: milestone → on-this-day → anticipation → recent → invite ---- */
  if(fresh && homeVis){                                                 // a shared dream, reached — celebrate only when home is the visible view
    milestones.forEach(function(mi){ celebrated[mi.key] = 1; });        // clear the backlog once; future completions celebrate one by one
    try{ localStorage.setItem('fh-celebrated', JSON.stringify(celebrated)); }catch(e){}
    usedRef = fresh.key;
    html += '<button class="hmoment" onclick="go(&#39;spending&#39;)">' + hVisual(fresh.cls, '', '🎉')
      + '<div class="hm-cap"><div class="hm-eye">' + L('Vừa đủ rồi', 'Goal reached') + '</div><div class="hm-title">' + esc(fresh.name) + '</div>'
      + '<div class="hm-sub">' + L('Giấc mơ chung đã thành hình 🎉', 'A shared dream, reached 🎉') + '</div>'
      + '<div class="hm-fam">' + hFamAvs(4) + '</div></div></button>';
  } else if(onThis.length){                                             // nostalgia, un-gameable + date-driven
    var rr = onThis[0]; usedRef = rr.type + ':' + rr.ref;
    html += hMemMoment(rr, L('Ngày này năm xưa', 'On this day'));
  } else if(up.length){                                                 // anticipation, saving woven in
    var k = up[0], e = evs[k], dl = daysLeft(e.d);
    var pct = e.target > 0 ? Math.min(100, Math.round(e.saved / e.target * 100)) : 0;
    var emm = (e.memories && e.memories[0]) || null;
    var eSrc = (emm && emm.src) ? emm.src : '', eCls = (emm && emm.cls) ? emm.cls : 'ph-hike';
    usedRef = 'event:' + k;
    var eye = dl === 0 ? L('Hôm nay', 'Today') : (dl === 1 ? L('Ngày mai', 'Tomorrow') : L('Còn ' + dl + ' ngày', dl + ' days to go'));
    var money = e.target > 0
      ? (pct >= 85 ? L('Cả nhà đã để dành gần đủ rồi 🌿', 'Almost there together 🌿')
        : (pct >= 35 ? L('Cả nhà đang để dành dần 🌿', 'Saving up together 🌿')
          : L('Cùng để dành cho dịp này nhé 🌿', 'Saving toward it together 🌿')))
      : L('Điều cả nhà đang mong 💛', 'Something to look forward to 💛');
    var famRow = (e.target > 0 && (e.saved > 0 || e.setAside > 0)) ? '<div class="hm-fam">' + hFamAvs(4) + '<span class="hm-fam-t">' + L('cả nhà cùng góp', 'saving together') + '</span></div>' : '';
    html += '<button class="hmoment" onclick="openEvent(&#39;' + escAttr(k) + '&#39;)">' + hVisual(eCls, eSrc, e.emoji)
      + '<div class="hm-cap"><div class="hm-eye">' + esc(eye) + '</div><div class="hm-title">' + esc(e.name)
      + '</div><div class="hm-sub">' + money + '</div>' + famRow + '</div>'
      + (e.target > 0 ? '<div class="hm-prog"><i style="width:' + pct + '%"></i></div>' : '') + '</button>';
  } else if(memRecords.length){                                        // a resurfaced moment
    var r = memRecords[0]; usedRef = r.type + ':' + r.ref;
    html += hMemMoment(r, L('Khoảnh khắc gần đây', 'A recent moment'));
  } else {                                                             // a new family — a gentle invitation, still a feeling
    html += '<button class="hmoment" onclick="openSheet(&#39;sheet-add&#39;)"><div class="hm-bg ph-park"></div><div class="hm-scrim"></div><div class="hm-subj">🌿</div>'
      + '<div class="hm-cap"><div class="hm-eye">' + L('Bắt đầu', 'Begin') + '</div><div class="hm-title">'
      + L('Câu chuyện của cả nhà', 'Your family’s story') + '</div><div class="hm-sub">'
      + L('Thêm khoảnh khắc đầu tiên, hoặc lên kế hoạch một dịp 💛', 'Add your first moment, or plan an occasion 💛') + '</div></div></button>';
  }

  /* ---- money, felt: the month's financial mood (collective — no byline) ---- */
  var m = (typeof M === 'function') ? M() : null;
  if(m && m.budget > 0){
    var reserved = m.done ? 0 : monthReserved();
    var safe = Math.max(0, m.budget - m.spent - reserved), over = m.spent > m.budget;
    var proj = !m.done && m.dom > 0 && ((m.spent / m.dom * m.dim) - m.budget > m.budget * 0.01);
    var mood, ico, tt, ss;
    if(over){ mood = 'over'; ico = '🍂'; tt = L('Hơi quá tay một chút rồi', 'A little over this month');
      ss = L('Vượt ' + fmtK(m.spent - m.budget) + ' · cùng nhau chỉnh lại nha', 'Over by ' + fmtK(m.spent - m.budget) + ' · let’s ease back together'); }
    else if(proj){ mood = 'pace'; ico = '⚡'; tt = L('Tháng này tiêu hơi nhanh tay', 'Spending a touch fast');
      ss = L('Nhẹ nhàng chút là vẫn dư · còn ' + fmtK(safe), 'Ease up a little · ' + fmtK(safe) + ' left'); }
    else { mood = 'ok'; ico = '🌿'; tt = L('Tháng này cả nhà đang thong thả', 'Comfortable this month');
      ss = L('Còn ' + fmtK(safe) + ' để cả nhà thoải mái tận hưởng', fmtK(safe) + ' left to enjoy together'); }
    var ps = Math.min(100, Math.round(m.spent / m.budget * 100));
    html += '<button class="hpulse ' + mood + '" onclick="go(&#39;spending&#39;)"><div class="hp-ico">' + ico + '</div>'
      + '<div class="hp-body"><div class="hp-title">' + tt + '</div><div class="hp-sub">' + ss + '</div>'
      + '<div class="hp-bar"><i style="width:' + ps + '%"></i></div></div></button>';
  }

  /* ---- look-ahead target (chosen first, so a photo-bearing occasion can't also surface as a beat) ---- */
  var nk = (up.length > (onThis.length || fresh ? 0 : 1)) ? up[onThis.length || fresh ? 0 : 1] : null;

  /* ---- woven beats: up to 2 more moments, each with its author ---- */
  var seen = {}; if(usedRef) seen[usedRef] = 1; if(nk) seen['event:' + nk] = 1;
  var beats = [];
  memRecords.forEach(function(r){ var rk = r.type + ':' + r.ref; if(seen[rk]) return; seen[rk] = 1; beats.push(r); });
  beats.slice(0, 2).forEach(function(r){
    var i = memRecords.indexOf(r), isExp = r.type === 'expense', by = hByline(r.who);
    var eye = isExp ? L('Từ một khoản chi', 'From a spend') : L('Nhớ lại', 'Remember');
    var sub = isExp ? L('Một khoản chi đã thành kỷ niệm 📸', 'A spend that became a memory 📸') : esc(r.meta || '');
    html += '<button class="hbeat" onclick="openMemory(' + i + ')">' + hThumb(r.cls, r.src, r.emoji)
      + '<div class="hb-body"><div class="hb-eye">' + eye + '</div><div class="hb-title">' + esc(r.cap) + '</div>'
      + '<div class="hb-sub">' + sub + '</div>' + (by ? '<div class="hb-by">' + by + '</div>' : '') + '</div></button>';
  });

  /* ---- the quiet look-ahead whisper ---- */
  if(nk){
    var e2 = evs[nk], dl2 = daysLeft(e2.d);
    html += '<button class="hlook" onclick="openEvent(&#39;' + escAttr(nk) + '&#39;)">' + esc(e2.emoji) + ' '
      + L('Sắp tới', 'Coming up') + ': <b>' + esc(e2.name) + '</b> · '
      + (dl2 === 0 ? L('hôm nay', 'today') : L('còn ' + dl2 + ' ngày', dl2 + ' days')) + '</button>';
  }

  /* ---- #11 seed the feed: a gentle nudge only when it's genuinely thin ---- */
  if(memRecords.length > 0 && memRecords.length < 3){
    html += '<button class="hseed" onclick="openSheet(&#39;sheet-add&#39;)">📸 ' + L('Hôm nay có gì đáng nhớ không?', 'Anything to remember today?') + '</button>';
  }

  setHTMLIf(box, html);
}
window.renderHome = renderHome;
