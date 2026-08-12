/* ---------- Home — the emotional feed ("moment engine") ----------
   Home isn't a dashboard: it surfaces ONE warm moment a day woven from
   everything the family has, with the family made VISIBLE (who added what) and
   the loop's hooks strengthened — a welcome-back line, milestone celebrations,
   a shared-dream avatar stack, a gentle seed. The tabs do; home makes you feel.
   Facilitator ethic: warmth, never streaks / guilt / scores. */

/* ---------- Thời tiết cảm xúc — a two-sided emotional loop ----------
   (1) Anyone sets today's weather in one tap. (2) EVERYONE feels it in the sky:
   the scene takes on the family's weather (ambient rain/storm/mist/sunbeams —
   anonymous, like real weather). (3) When someone you love is having
   a rough day, you're handed a caring, BUILD-something action FOR them
   (⛈️ upset → a make-up jar; 🌧️ down → plan a treat they'll look forward to).
   (4) They feel seen. Backed by the realtime member_weather table so a mood set on
   one phone appears on the others. The reveal is GATED: until you light your own
   window, the others stay curtained. Offers use the ONE consistent .woffer card. */
var WEATHER = [
  { k:'sun',   e:'☀️', vi:'nắng',       en:'sunny',   fvi:'vui',        fen:'happy',    rough:false },
  { k:'fire',  e:'🔥', vi:'bừng',       en:'buzzing', fvi:'hứng khởi',  fen:'inspired', rough:false },
  { k:'ok',    e:'⛅', vi:'bình thường', en:'okay',    fvi:'ổn',         fen:'okay',     rough:false },
  { k:'rain',  e:'🌧️', vi:'hơi buồn',   en:'down',    fvi:'hơi buồn',   fen:'down',     rough:true },
  { k:'tired', e:'🌫️', vi:'mệt',        en:'drained', fvi:'mệt',        fen:'drained',  rough:true },
  { k:'anger', e:'⛈️', vi:'bực bội',    en:'stormy',  fvi:'bực bội',    fen:'upset',    rough:true }
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

/* ---------- the living hillside scene ---------- */
/* the sky follows the REAL clock (not the demo's pinned TODAY) */
function _skyPhase(){ var h = new Date().getHours(); if(h >= 5 && h < 8) return 'dawn'; if(h >= 8 && h < 17) return 'day'; if(h >= 17 && h < 20) return 'dusk'; return 'night'; }
/* the phase the scene is PAINTED in — may lag the clock until the next render.
   Tap reactions and re-measures key off this, so they match what's on screen. */
function _scenePhase(){
  var sky = document.getElementById('home-sky');
  var m = sky && /sky-(dawn|day|dusk|night)\b/.exec(sky.className);
  return m ? m[1] : _skyPhase();
}
window._scenePhase = _scenePhase;
/* fixed star field ([%left, px-top]) — deterministic so re-renders don't shuffle the sky */
var _STARS = [[6,14],[14,36],[24,8],[33,24],[44,15],[55,6],[63,28],[72,12],[81,32],[88,8],[93,22],[38,40],[68,44],[18,54]];
/* GIÓ — mỗi lần mở app trời bốc một cấp gió (lặng / hiu hiu / lộng gió).
   Một lớp .wind-* trên #home-scene chỉnh nhịp đưa của tán cây, cỏ lau, mây;
   lộng gió thì hạt bồ công anh bay. Cùng một khung cảnh nhưng không lần mở
   nào chuyển động giống lần nào. Reset khi rời app đủ lâu (cùng nhịp với
   weather-FX replay ở cuối file). */
function _windLevel(){
  if(!window._windK){
    var r = Math.random();
    window._windK = r < .3 ? 'calm' : (r < .82 ? 'breeze' : 'gust');
  }
  return window._windK;
}
/* the whole scene — pure nature, no man-made props: sky bits → far hills →
   the big crest → grass & flowers breathing in the wind → the savings tree on
   the slope → phase wildlife → the pet. The family's moods still live here,
   anonymously, as WEATHER over the scene (amb + the weather FX replay) behind
   the same share-first gate. Expects buildMemRecords() to have run. */
function renderScene(){
  var mems = ((window.FAM && FAM.members) || []), myW = myWeather();
  var gate = !myW || window._wpick, ph = _skyPhase();
  var cfg = (window.houseCfg ? houseCfg() : { tree: 'oak', pet: null });

  // "the family did something today" — the old chimney smoke, now a livelier
  // meadow: butterflies by day, more fireflies after dark
  var act = false;
  try{
    var n = new Date();
    act = (window.memRecords || []).some(function(r){ return r.d && r.d.getFullYear() === n.getFullYear() && r.d.getMonth() === n.getMonth() && r.d.getDate() === n.getDate(); });
    if(!act && window.memberWeather){ for(var id in memberWeather){ if(_wIsToday(memberWeather[id].at)){ act = true; break; } } }
    if(!act) act = !!myW;
  }catch(e){}

  // the savings tree grows with total goal progress (floor keeps it a tree, not a shrub)
  var goals = window.goals || {}, gord = window.goalOrder || [], tt = 0, ts = 0;
  gord.forEach(function(g){ var e = goals[g]; if(e && e.target > 0){ tt += e.target; ts += Math.min(e.saved || 0, e.target); } });
  var grow = tt > 0 ? (0.7 + 0.42 * (ts / tt)) : 0.62;

  var stars = '';
  if(ph === 'night'){ _STARS.forEach(function(s, i){ stars += '<i class="sc-star" style="left:' + s[0] + '%;top:' + s[1] + 'px;animation-delay:' + ((i % 5) * 0.6).toFixed(1) + 's"></i>'; }); }

  // ambient weather over the scene — the hillside feels whoever's having a day
  var amb = '';
  if(!gate){
    var shared = []; mems.forEach(function(m){ var w = memberWeatherOf(m.name); if(w) shared.push(w); });
    var has = function(k){ return shared.indexOf(k) >= 0; };
    if(has('anger')) amb = '<div class="amb"><i class="a-storm"></i><i class="a-bolt"></i></div>';
    else if(has('rain')){ var d = '', i; for(i = 0; i < 7; i++){ d += '<i class="a-drop" style="left:' + (8 + i * 13) + '%;animation-delay:' + (i * 0.23).toFixed(2) + 's"></i>'; } amb = '<div class="amb">' + d + '</div>'; }
    else if(has('tired')) amb = '<div class="amb"><i class="a-mist"></i></div>';
    else if(shared.length >= 2 && shared.every(function(w){ return w === 'sun' || w === 'fire'; })) amb = '<div class="amb"><i class="a-beam b1"></i><i class="a-beam b2"></i></div>';
  }

  // the land: two hazy far ridges behind one big near crest
  var land = '<i class="sc-far f1"></i><i class="sc-far f2"></i><i class="sc-crest"></i>'
    + (ph === 'day' ? '<i class="sc-cshadow"></i>' : '');

  // grass tufts, wildflowers, dandelions — % positions hold on every phone width
  // (the crest's surface height is width-independent: its height is fixed px)
  var T = [[8,26,0],[16,32,0],[24,37,1],[37,43,0],[47,46,1],[58,46,0],[67,44,0],[78,38,1],[90,26,0]];
  var flora = T.map(function(t, i){       // staggered delays so the grass ripples, not marches
    return '<i class="tuft' + (t[2] ? ' tall' : '') + '" style="left:' + t[0] + '%;bottom:' + t[1] + 'px;animation-delay:-' + (i * .53).toFixed(2) + 's"><i></i><i></i><i></i><i></i></i>';
  }).join('')
    + '<i class="wfl" style="left:31%;bottom:40px;--c:#fbd9e4"></i>'
    + '<i class="wfl" style="left:65%;bottom:46px;--c:#f5c64f"></i>'
    + '<i class="wfl" style="left:85%;bottom:31px;--c:#f2b3c9"></i>'
    + '<i class="dande" style="left:72%;bottom:44px"></i>'
    + '<i class="dande" style="left:82%;bottom:35px"></i>'
    + '<i class="seed" style="left:73%;bottom:62px"></i>'
    + '<i class="seed sd2" style="left:83%;bottom:54px"></i>'
    + '<i class="seed sd3" style="left:76%;bottom:58px"></i>';

  // phase wildlife: grazing wild rabbits by day, swifts at dusk, fireflies +
  // the occasional shooting star at night, rolling mist at dawn
  var life = '';
  if(ph === 'day') life += '<i class="graze" style="left:20%;bottom:31px"><i></i><i></i><u></u></i>'
    + '<i class="graze g2" style="left:28%;bottom:26px"><i></i><i></i><u></u></i>';
  if(ph === 'dusk') life += '<i class="swifts"><i class="swift"></i><i class="swift s2"></i><i class="swift s3"></i><i class="swift s4"></i></i>';
  if(ph === 'night'){
    life += '<i class="shoot"></i>'
      + '<i class="ffly" style="left:48%;top:118px"></i><i class="ffly f2" style="left:61%;top:136px"></i><i class="ffly f3" style="left:70%;top:124px"></i>'
      + (act ? '<i class="ffly f4" style="left:42%;top:142px"></i><i class="ffly f5" style="left:55%;top:150px"></i>' : '');
  }
  if(act && (ph === 'day' || ph === 'dawn')){
    life += '<i class="bfly" style="left:38%;bottom:70px;--c:#f2b3c9"><i></i><i></i><u></u></i>'
      + '<i class="bfly b2" style="left:66%;bottom:88px;--c:#f5c64f"><i></i><i></i><u></u></i>';
  }
  if(ph === 'dawn') life += '<i class="sc-mist"></i>';

  // Phòng khách #8: the newest family reaction drifts up as a small speech
  // bubble by the tree — the living room breathing inside the scene. Tap → jump.
  var say = '';
  try{
    var rn = window.rxNewestForScene && window.rxNewestForScene();
    if(rn) say = '<button class="sc-say" onclick="rxJumpTo(&#39;' + rn.txDbId + '&#39;)" aria-label="' + escAttr(L('Xem phòng khách', 'See the living room')) + '"><span class="sc-say-e">' + rn.emoji + '</span></button>';
  }catch(e){}

  // gesture-native mood: a transparent full-scene layer (behind the tree/pet)
  // opens the mood picker — the only way to CHANGE your mood now the windows
  // are gone. Decor is pointer-events:none in CSS so empty-area taps reach it.
  return '<button class="sc-tap" onclick="openWeatherPick()" aria-label="' + escAttr(L('Đổi tâm trạng của bạn', 'Change your mood')) + '"></button>'
    + '<i class="sc-orb"></i>' + stars
    + '<i class="sc-cloud c1"></i><i class="sc-cloud c2"></i>'
    + land + flora + life
    + '<button class="sc-tree tree-' + cfg.tree + '" style="transform:scale(' + grow.toFixed(2) + ')" onclick="pokeTree()" aria-label="' + escAttr(L('Chạm vào cây', 'Tap the tree')) + '">'
      + (window.TREEFN ? TREEFN[cfg.tree](ph) : '<i class="tr-tr"></i><i class="tr-f f1"></i><i class="tr-f f2"></i><i class="tr-f f3"></i>') + '</button>'
    + (cfg.pet && window.PETFN ? '<button class="sc-pet k-' + cfg.pet + '" onclick="pokePet()" aria-label="' + escAttr(L('Cưng nựng thú cưng', 'Pet your buddy')) + '">' + PETFN[cfg.pet](ph) + '</button>' : '')
    + say + amb;
}
/* place the pet on the slope relative to the REAL tree rect (its x shifts with
   the savings scale and the phone's width, so a CSS % can't be trusted —
   measure after paint). Dawn greets the sun left of the tree, day roams the
   open slope to the right, dusk wanders back, night curls up at the trunk. */
function _placePet(scene){
  var pet = scene && scene.querySelector('.sc-pet'); if(!pet) return;
  var sr = scene.getBoundingClientRect(); if(!sr.width) return;   // hidden view: keep the CSS fallback
  var tree = scene.querySelector('.sc-tree');
  var pw = pet.getBoundingClientRect().width || 46;
  var tL = tree ? tree.getBoundingClientRect().left - sr.left : sr.width * .5;
  var tR = tree ? tree.getBoundingClientRect().right - sr.left : sr.width * .62;
  var ph = _scenePhase(), x;
  if(ph === 'night')     x = tR - pw * .55;                       // asleep against the trunk
  else if(ph === 'dawn') x = tL - pw - 12;                        // catching first light, left of the tree
  else if(ph === 'dusk') x = tR + 10;                             // drifting home to the tree
  else                   x = tR + Math.max(18, (sr.width - tR - pw) * .42);  // day: out on the open slope
  pet.style.left = Math.max(6, Math.min(x, sr.width - pw - 6)) + 'px';
}
/* rotation / resize: the house re-anchors instantly (CSS) but the pet's px spot
   goes stale — re-measure it (debounced; a full re-render isn't needed) */
try{
  window.addEventListener('resize', function(){
    clearTimeout(window._petRsz);
    window._petRsz = setTimeout(function(){ var s = document.getElementById('home-scene'); if(s) _placePet(s); }, 160);
  });
}catch(e){}
/* ONE time-shared strip under the scene (the old mood card + the "Chăm chút
   tổ ấm" entry were two fragmented cards competing for the prime slot). Before
   you've checked in today it's the mood picker; once you've shared, the SAME
   slot yields to the tổ-ấm (tree/pet) nudge. Mood itself is re-openable any
   time by tapping the scene — openWeatherPick() flips _wpick and re-renders. */
function renderHearth(){
  var mems = (window.FAM && FAM.members) || [], meName = _meName(), myW = myWeather();
  if(!myW || window._wpick){
    var btns = WEATHER.map(function(w){ return '<button class="wpk" onclick="setWeather(&#39;' + w.k + '&#39;)" aria-label="' + escAttr(L(w.vi, w.en)) + '">' + w.e + '</button>'; }).join('');
    var others = mems.filter(function(m){ return m.name !== meName; });
    var hint = others.length ? '<div class="hearth-hint">' + L('Chia sẻ rồi sẽ thấy bầu trời của cả nhà', 'Share yours to see the family’s sky') + '</div>' : '';
    // re-opening an already-set mood → a quiet way back to the tổ-ấm nudge
    var later = myW ? '<button class="hearth-later" onclick="closeWeatherPick()">' + L('Để sau', 'Later') + '</button>' : '';
    return '<div class="hearth"><div class="hearth-q">' + L('Trời trong bạn hôm nay thế nào?', 'How’s your weather today?') + later + '</div>'
      + '<div class="wrow">' + btns + '</div>' + hint + '</div>';
  }
  return (window._houseEntryHTML ? _houseEntryHTML() : '');   // mood shared → the strip becomes the tổ-ấm nudge
}
/* the escape hatch when you tapped the scene but didn't want to change your mood */
function closeWeatherPick(){ window._wpick = false; if(typeof renderHome === 'function') renderHome(); }
window.closeWeatherPick = closeWeatherPick;

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
  var nm = who, col = '#8f8a99', ini = (typeof inits === 'function') ? inits(who) : ('' + who).charAt(0).toUpperCase(), mmx = null;
  if(typeof membersMeta !== 'undefined' && membersMeta){ for(var n in membersMeta){ if(n.toLowerCase() === w){ mmx = membersMeta[n]; col = mmx.col; ini = mmx.ini; nm = n; break; } } }
  var fn = (typeof firstName === 'function') ? firstName(nm) : nm;
  var _pm = mmx || { col: col, ini: ini };
  return '<div class="bp-by"><span class="av" style="' + window.fhAvStyle(_pm) + '">' + esc(window.fhAvIni(_pm)) + '</span><span>' + esc(fn) + '</span></div>';
}
/* which scene-style cover fits an occasion? keyword + emoji matched, vi + en */
function occCover(name, emoji){
  var t = ((name || '') + ' ' + (emoji || '')).toLowerCase();
  var has = function(arr){ for(var i = 0; i < arr.length; i++){ if(t.indexOf(arr[i]) >= 0) return true; } return false; };
  if(has(['đi ','du lịch','du lich','trip','travel','biển','bien','beach','về quê','ve que','cắm trại','cam trai','camping','🚗','🚙','✈','🛫','🏖','⛰','🏔','🗻','🌊','⛺','🚌','🚆','🧳'])) return 'travel';
  if(has(['sinh nhật','sinh nhat','birthday','tiệc','tiec','party','cưới','cuoi','wedding','kỷ niệm','ky niem','anniversary','tết','tet ','noel','giáng sinh','giang sinh','christmas','trung thu','🎂','🥳','🎉','🎊','🎁','🎄','💍','👰'])) return 'party';
  return 'outing';
}
/* the cover's layers — drawn with the house scene's own shapes.
   All fills are explicit elements (no box-shadow tricks — Safari paints those
   differently and floods the band). Static by design. */
function occHTML(type){
  var sky = '<i class="oc-sun"></i><i class="oc-cloud a"></i><i class="oc-cloud b"></i>';
  var land = '<i class="oc-hill back"></i><i class="oc-hill h1"></i><i class="oc-hill h2"></i><i class="oc-grass"></i>';
  if(type === 'travel'){
    return sky + land + '<i class="oc-road"></i>'
      + '<span class="oc-car"><i class="sh"></i><i class="cab"></i><i class="bd"></i><i class="win"></i><i class="w wa"></i><i class="w wb"></i></span>';
  }
  if(type === 'party'){
    var cols = ['#e0604c', '#f0b450', 'var(--brand)', '#8f6fd0'], flags = '', pts = [[8,5],[22,9.5],[36,12.5],[50,13.5],[64,12.5],[78,9.5],[92,5]];
    for(var i = 0; i < pts.length; i++){ var x = pts[i][0], y = pts[i][1]; flags += '<polygon points="' + (x-3.2) + ',' + y + ' ' + (x+3.2) + ',' + y + ' ' + x + ',' + (y+7) + '" fill="' + cols[i % 4] + '"/>'; }
    var conf = '', cps = [[12,56],[26,44],[40,62],[58,48],[73,60],[87,46]];
    for(var j = 0; j < cps.length; j++){ conf += '<i class="oc-conf" style="left:' + cps[j][0] + '%;top:' + cps[j][1] + '%;background:' + cols[j % 4] + '"></i>'; }
    return '<i class="oc-pground"></i><svg class="oc-bunting" viewBox="0 0 100 26" preserveAspectRatio="none"><path d="M0 4 Q 50 22 100 4" fill="none" stroke="rgba(120,90,70,.4)" stroke-width="1" vector-effect="non-scaling-stroke"/>' + flags + '</svg>'
      + '<span class="oc-bal" style="left:15%;top:34%;background:#e0604c"><i></i></span>'
      + '<span class="oc-bal" style="left:31%;top:48%;background:#f0b450"><i></i></span>'
      + '<span class="oc-bal" style="right:17%;top:36%;background:#8f6fd0"><i></i></span>' + conf
      + '<span class="oc-gift"><i class="lid"></i><i class="rib"></i></span>';
  }
  return sky + land
    + '<span class="oc-tree"><i class="tr"></i><i class="f1"></i><i class="f2"></i><i class="f3"></i></span>'
    + '<span class="oc-kite"><i class="bd"></i><i class="tl"></i></span>'
    + '<span class="oc-mat"></span><span class="oc-bsk"></span>';
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
var _WICON = {
  budget: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 19V9M9 19V5M14 19v-7M19 19v-11"/></svg>',
  house:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 10.5L12 3l9 7.5V21a1 1 0 01-1 1h-5v-6h-6v6H4a1 1 0 01-1-1z"/></svg>',
  plan:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="5" width="18" height="16" rx="3"/><path d="M3 10h18M8 3v4M16 3v4"/></svg>',
  album:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="16" rx="3"/><circle cx="8.5" cy="9.5" r="1.6"/><path d="M3 16l4.5-4 3.5 3 4-3.5L21 16.5"/></svg>'
};
function wTile(o){      // {ch,chCls,label,val,neg?,foot,act} — ONE strict template, no accessories:
  return '<button class="wtile" onclick="' + o.act + '">'          // chip + label / value / footer.
    + '<div class="wt-head"><span class="wt-ch ' + o.chCls + '">' + _WICON[o.ch] + '</span>' + o.label + '</div>'
    + '<div class="wt-big' + (o.neg ? ' neg' : '') + '">' + o.val + '</div>'
    + '<div class="wt-sub">' + o.foot + '</div></button>';
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
// A Sắp tới card is a smaller bigPhoto: the real uploaded photo when there is
// one, otherwise the same keyword-matched illustrated cover the rest of the
// app uses for undefined media (occCover/occHTML — never an emoji icon).
function upCardHTML(it){      // {kind:occ|goal|exp,d,name,src?,target?,saved?,amt?,act}
  var dl = daysLeft(it.d);
  var dlt = dl === 0 ? L('Hôm nay', 'Today') : (dl === 1 ? L('Ngày mai', 'Tomorrow') : L('Còn ' + dl + ' ngày', dl + ' days'));
  var ill = it.src ? null : occCover(it.name, '');
  var sub, pct;
  if(it.kind === 'exp'){
    sub = fmt(it.amt);
  } else if(it.target > 0){
    pct = Math.min(100, Math.round((it.saved || 0) / it.target * 100));
    sub = pct + '% · ' + fmt(it.saved || 0) + '/' + fmt(it.target);
  } else {
    sub = L('Kế hoạch', 'Plan');
  }
  return bigPhoto({ src: it.src, ill: ill, eye: dlt, title: it.name, sub: sub, pct: pct, act: it.act });
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

  // the living hillside: phase the sky from the real clock, then paint the scene
  var skyEl = document.getElementById('home-sky');
  if(skyEl) skyEl.className = 'home-sky sky-' + _skyPhase();
  var sceneEl = document.getElementById('home-scene');
  if(sceneEl){
    sceneEl.className = 'home-scene wind-' + _windLevel();   // today's wind level (per app open)
    setHTMLIf(sceneEl, renderScene());
    _placePet(sceneEl);                                 // measured slope placement (runs even when HTML is unchanged)
    if(!window._gustDone){                              // one welcome gust ripples through on open
      window._gustDone = true;
      sceneEl.classList.add('gustnow');
      setTimeout(function(){ var s = document.getElementById('home-scene'); if(s) s.classList.remove('gustnow'); }, 1400);
    }
  }

  var html = renderHearth();   // ONE time-shared strip: mood picker until you check in, then the "Chăm chút tổ ấm" nudge
  if(typeof requestsWidgetHTML === 'function') html += requestsWidgetHTML();   // future-expense proposals awaiting my OK
  // one-time nudge so the tap-to-change-mood gesture is discoverable
  try{
    if(myW && !window._wpick && !localStorage.getItem('fh-moodtap')){
      localStorage.setItem('fh-moodtap', '1');
      if(typeof toast === 'function') setTimeout(function(){ toast(L('Chạm vào khung cảnh để đổi tâm trạng 🌤️', 'Tap the scene to change your mood 🌤️')); }, 900);
    }
  }catch(e){}
  // Phòng khách moves BELOW the four stat tiles (the wgrid) — appended after it

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
    var spentFoot = L('Đã tiêu ' + fmtK(m.spent) + ' / ' + fmtK(m.budget), 'Spent ' + fmtK(m.spent) + ' / ' + fmtK(m.budget));
    var foot = reserved > 0                        // spell out the hold so "còn lại" isn't a mystery gap
      ? spentFoot + ' · ' + L('giữ ' + fmtK(reserved), fmtK(reserved) + ' held')
      : spentFoot;
    finV = { mood: fmood, ico: fico, tt: ftt, ss: fss, safe: safe, overAmt: over ? (m.spent - m.budget) : 0, ps: Math.min(100, Math.round(m.spent / m.budget * 100)), foot: foot };
  }
  var mComfortable = !!(finV && finV.mood === 'ok');

  /* ============ WIDGET GRID — four glanceable tiles, always present ============ */
  var goalsLive = gord.filter(function(g){ return !achievedGoal(goals[g]); });
  var tSaved = 0, tTarget = 0;
  goalsLive.forEach(function(g){ var e = goals[g]; if(e && e.target > 0){ tTarget += e.target; tSaved += Math.min(e.saved || 0, e.target); } });
  var tiles = '';
  // every tile: one value, one quiet footer — the same three rows, the same baselines
  if(finV){
    tiles += wTile({ ch: 'budget', chCls: 'wc-brand', label: L('Ngân sách', 'Budget'), neg: finV.mood === 'over',
      val: finV.mood === 'over' ? fmtK(finV.overAmt) + ' <span class="u">' + L('vượt', 'over') + '</span>'
                                : fmtK(finV.safe) + ' <span class="u">' + L('còn lại', 'left') + '</span>',
      foot: finV.foot, act: 'go(&#39;spending&#39;)' });
  } else {
    tiles += wTile({ ch: 'budget', chCls: 'wc-brand', label: L('Ngân sách', 'Budget'), val: '<span class="wt-add">＋</span>', foot: L('Đặt ngân sách tháng này', 'Set this month’s budget'), act: 'openSheet(&#39;sheet-budget&#39;)' });
  }
  if(tTarget > 0){
    tiles += wTile({ ch: 'house', chCls: 'wc-good', label: L('Nhà mình', 'Our house'),
      val: fmtK(tSaved), foot: Math.round(tSaved / tTarget * 100) + '% ' + L('mục tiêu chung', 'of shared goals'), act: 'go(&#39;spending&#39;)' });
  } else {
    tiles += wTile({ ch: 'house', chCls: 'wc-good', label: L('Nhà mình', 'Our house'), val: '<span class="wt-add">＋</span>', foot: L('Trồng một mục tiêu chung', 'Plant a shared goal'), act: 'openGoal()' });
  }
  if(up.length){
    var k0 = up[0], e0 = evs[k0], dl0 = daysLeft(e0.d);
    var cBig = dl0 === 0 ? L('Hôm nay', 'Today') : (dl0 === 1 ? L('Ngày mai', 'Tomorrow') : dl0 + ' <span class="u">' + L('ngày', 'days') + '</span>');
    tiles += wTile({ ch: 'plan', chCls: 'wc-amber', label: L('Sắp tới', 'Coming up'), val: cBig, foot: '<b>' + esc(e0.name) + '</b>', act: 'openEvent(&#39;' + escAttr(k0) + '&#39;)' });
  } else {
    tiles += wTile({ ch: 'plan', chCls: 'wc-amber', label: L('Sắp tới', 'Coming up'), val: '<span class="wt-add">＋</span>', foot: L('Lên một kế hoạch vui', 'Plan something fun'), act: 'goMoments(&#39;plans&#39;);openSheet(&#39;sheet-event&#39;)' });
  }
  var phThis = memRecords.filter(function(r){ return r.d && r.d.getMonth() === TODAY.getMonth() && r.d.getFullYear() === TODAY.getFullYear(); });
  if(memRecords.length){
    tiles += wTile({ ch: 'album', chCls: 'wc-rose', label: L('Album', 'Album'),
      val: memRecords.length + ' <span class="u">' + L('ảnh', 'photos') + '</span>',
      foot: phThis.length ? L('Thêm ' + phThis.length + ' trong tháng này', phThis.length + ' new this month') : L('Kỷ niệm của cả nhà', 'The family’s memories'), act: 'goMoments(&#39;album&#39;)' });
  } else {
    tiles += wTile({ ch: 'album', chCls: 'wc-rose', label: L('Album', 'Album'), val: '<span class="wt-add">＋</span>', foot: L('Thêm tấm ảnh đầu tiên', 'Add the first photo'), act: 'openMomentModal()' });
  }

  html += '<div class="wgrid">' + tiles + '</div>';
  if(typeof rxHomeStripHTML === 'function') html += rxHomeStripHTML();   // Phòng khách: latest reactions, now under the stat tiles

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
    kh += bigPhoto({ ill: 'outing', eye: L('Bắt đầu', 'Begin'), title: L('Câu chuyện của cả nhà', 'Your family’s story'), sub: L('Tấm ảnh đầu tiên bắt đầu từ đây', 'Your first photo starts here'), tall: true, cta: { label: '＋ ' + L('Thêm khoảnh khắc', 'Add a moment') }, act: 'openMomentModal()' });
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
    + qTile({ ic: _QSVG.cam, chCls: 'wc-rose', label: L('Khoảnh khắc', 'Moment'), act: 'openMomentModal()' })
    + qTile({ ic: _QSVG.cal, chCls: 'wc-amber', label: L('Kế hoạch', 'Plan'), act: 'goMoments(&#39;plans&#39;);openSheet(&#39;sheet-event&#39;)' })
    + qTile({ ic: _QSVG.pig, chCls: 'wc-indigo', label: L('Góp quỹ', 'Chip in'), act: 'fhSavings()' })
    + '</div>';

  /* ============ SẮP TỚI — every upcoming thing (occasions, due goals, future expenses),
     nearest first, as a horizontal carousel — not just the single closest occasion. ============ */
  var upAll = [];
  up.forEach(function(k){
    var e = evs[k], m0 = e.memories && e.memories[0];
    upAll.push({ kind: 'occ', d: e.d, name: e.name, src: (m0 && m0.src) || '', target: e.target, saved: e.saved, act: 'openEvent(&#39;' + escAttr(k) + '&#39;)' });
  });
  goalsLive.forEach(function(g){                       // only goals with a due date belong on a timeline
    var e = goals[g]; if(!e.d) return;
    upAll.push({ kind: 'goal', d: e.d, name: e.name, src: '', target: e.target, saved: e.saved, act: 'openGoalDetail(&#39;' + escAttr(g) + '&#39;)' });
  });
  (window.txns || []).forEach(function(t){
    if(!t.future || !t._d) return;
    upAll.push({ kind: 'exp', d: t._d, name: t.note || L('Khoản chi', 'Expense'), src: (t.photos && t.photos[0]) || '', amt: t.amt, act: 'openExpenseDetail(&#39;' + escAttr(t.id) + '&#39;)' });
  });
  upAll.sort(function(a, b){ return a.d.getTime() - b.d.getTime(); });
  if(upAll.length){
    html += _sectionH(L('Sắp tới', 'Coming up') + ' · ' + upAll.length, 'goMoments(&#39;plans&#39;)')
      + '<div class="up-strip">' + upAll.slice(0, 12).map(upCardHTML).join('') + '</div>';
  }

  /* ============ MỤC TIÊU CHUNG — chip in to a shared dream, right here ============ */
  if(goalsLive.length){
    var gRows = goalsLive.slice(0, 2).map(function(g){
      var e = goals[g], pct = e.target > 0 ? Math.min(100, Math.round(e.saved / e.target * 100)) : 0;
      return '<button class="hgoal" onclick="openGoalDetail(&#39;' + escAttr(g) + '&#39;)">'
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
   Session-scoped: the "seen" map lives in memory only, so EVERY app open replays
   today's moods — each shared window pops and the scene takes on the lead mood
   (rough moods lead). During the session, live changes still play as they arrive,
   with the "just changed" note; the reopen replay skips the note (nothing "just"
   happened). Coming back after a long background pause counts as a reopen. */
var _WXFX = { sun:'sun', fire:'spark', ok:'cloud', rain:'rain', tired:'mist', anger:'storm' };
function _wxIdOf(name){
  if(!window.DB) return null;
  if(name === _meName()) return window.DB.ownerMemberId || null;
  return (window.DB.memberByAppName && window.DB.memberByAppName[name]) || null;
}
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
function _wxPlay(host, plays, showNote){
  var lead = plays.filter(function(p){ return !p.mine; })[0] || plays[0];
  var fxType = _WXFX[lead.k] || 'rain';
  var layer = document.createElement('div');
  layer.className = 'wx-fx wx-' + fxType;
  layer.innerHTML = _wxParticles(fxType);
  host.appendChild(layer);
  setTimeout(function(){ if(layer.parentNode) layer.parentNode.removeChild(layer); }, 2700);

  var others = plays.filter(function(p){ return !p.mine; });
  if(showNote && others.length){
    var wd = _wdef(others[0].k), nm = (typeof firstName === 'function') ? firstName(others[0].name) : others[0].name;
    var note = document.createElement('div');
    note.className = 'wx-note';
    note.innerHTML = esc(nm) + (others.length > 1 ? ' +' + (others.length - 1) : '') + ' ' + L('vừa đổi tâm trạng', 'just changed their weather') + ' ' + (wd ? wd.e : '');
    host.appendChild(note);
    setTimeout(function(){ if(note.parentNode) note.parentNode.removeChild(note); }, 3300);
  }
  var cells = host.querySelectorAll('.hw');
  plays.forEach(function(p, i){
    Array.prototype.forEach.call(cells, function(c){
      if(c.getAttribute('data-name') === p.name){
        setTimeout(function(){                        // stagger the pops so a full house reads as a wave
          c.classList.remove('fx'); void c.offsetWidth; c.classList.add('fx');
          setTimeout(function(){ c.classList.remove('fx'); }, 1100);
        }, i * 140);
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
  var mems = (window.FAM && FAM.members) || [], plays = [], nextSeen = {};
  var isReplay = (window._wxSeen === undefined || window._wxSeen === null);
  mems.forEach(function(m){
    if(m.name === meName) return;
    var w = memberWeatherOf(m.name); if(!w) return;    // demo moods play too (keyed by name)
    var id = _wxIdOf(m.name), rec = id && window.memberWeather && window.memberWeather[id];
    var at = (rec && rec.at) ? rec.at : 'today', key = id || m.name;
    nextSeen[key] = at;
    if(isReplay){ plays.push({ name: m.name, k: w, mine: false }); }
    else { var prev = window._wxSeen[key]; if(!prev || at > prev) plays.push({ name: m.name, k: w, mine: false }); }
  });
  if(!window._wxSeen) window._wxSeen = {};
  for(var kk in nextSeen) window._wxSeen[kk] = nextSeen[kk];
  if(window._wxMine){ plays.push({ name: meName, k: window._wxMine, mine: true }); window._wxMine = null; }
  if(!plays.length) return;
  plays.sort(function(a, b){                            // rough moods lead the scene's weather
    var ra = (_wdef(a.k) || {}).rough ? 1 : 0, rb = (_wdef(b.k) || {}).rough ? 1 : 0;
    if(ra !== rb) return rb - ra;
    return (a.mine ? 1 : 0) - (b.mine ? 1 : 0);
  });
  _wxPlay(host, plays, !isReplay);
}
window.runWeatherFx = runWeatherFx;
/* a long time away = a fresh open: replay the family's moods on return */
try{
  document.addEventListener('visibilitychange', function(){
    if(document.hidden){ window._wxHidAt = Date.now(); }
    else if(window._wxHidAt && Date.now() - window._wxHidAt > 15 * 60 * 1000){
      window._wxSeen = undefined;
      window._windK = null; window._gustDone = false;   // a fresh open rolls fresh wind + welcome gust
      if(typeof renderHome === 'function') renderHome();
    }
  });
}catch(e){}
