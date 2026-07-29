/* ---------- Home — the emotional feed ("moment engine") ----------
   Home isn't a dashboard: it surfaces ONE warm moment a day woven from
   everything the family has (an on-this-day memory, an upcoming occasion, a
   spend that became a photo) — now with the FAMILY made visible (who added
   what) — plus a "money, felt" pulse and a quiet look-ahead. The tabs do. */

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
  var html = '', usedRef = null;

  // upcoming real occasions (not achieved, not a photo-expense mirror), nearest first
  var up = ord.filter(function(k){ return evs[k] && evs[k].d && !isMirrorK(k) && !achievedNow(evs[k]); })
              .sort(function(a, b){ return evs[a].d.getTime() - evs[b].d.getTime(); });
  // a memory from a prior year, near today's date — "on this day"
  var onThis = memRecords.filter(function(r){
    if(!r.d || r.d.getFullYear() >= TODAY.getFullYear()) return false;
    var a = new Date(TODAY.getFullYear(), r.d.getMonth(), r.d.getDate());
    return Math.abs((a - TODAY) / 86400000) <= 3;                       // within 3 days of the anniversary (handles month edges)
  });

  /* ---- centerpiece: the daily moment (on-this-day → anticipation → recent → invite) ---- */
  if(onThis.length){                                       // nostalgia, un-gameable + date-driven
    var rr = onThis[0]; usedRef = rr.type + ':' + rr.ref;
    html += hMemMoment(rr, L('Ngày này năm xưa', 'On this day'));
  } else if(up.length){                                    // anticipation, saving woven in
    var k = up[0], e = evs[k], dl = daysLeft(e.d);
    var pct = e.target > 0 ? Math.min(100, Math.round(e.saved / e.target * 100)) : 0;
    var emm = (e.memories && e.memories[0]) || null;                 // a saved photo makes the anticipation real
    var eSrc = (emm && emm.src) ? emm.src : '', eCls = (emm && emm.cls) ? emm.cls : 'ph-hike';
    usedRef = 'event:' + k;
    var eye = dl === 0 ? L('Hôm nay', 'Today') : (dl === 1 ? L('Ngày mai', 'Tomorrow') : L('Còn ' + dl + ' ngày', dl + ' days to go'));
    var money = e.target > 0
      ? (pct >= 85 ? L('Cả nhà đã để dành gần đủ rồi 🌿', 'Almost there together 🌿')
        : (pct >= 35 ? L('Cả nhà đang để dành dần 🌿', 'Saving up together 🌿')
          : L('Cùng để dành cho dịp này nhé 🌿', 'Saving toward it together 🌿')))
      : L('Điều cả nhà đang mong 💛', 'Something to look forward to 💛');
    html += '<button class="hmoment" onclick="openEvent(&#39;' + escAttr(k) + '&#39;)">' + hVisual(eCls, eSrc, e.emoji)
      + '<div class="hm-cap"><div class="hm-eye">' + esc(eye) + '</div><div class="hm-title">' + esc(e.name)
      + '</div><div class="hm-sub">' + money + '</div></div>'
      + (e.target > 0 ? '<div class="hm-prog"><i style="width:' + pct + '%"></i></div>' : '') + '</button>';
  } else if(memRecords.length){                            // a resurfaced moment
    var r = memRecords[0]; usedRef = r.type + ':' + r.ref;
    html += hMemMoment(r, L('Khoảnh khắc gần đây', 'A recent moment'));
  } else {                                                 // a new family — a gentle invitation, still a feeling
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
  var nk = (up.length > (onThis.length ? 0 : 1)) ? up[onThis.length ? 0 : 1] : null;

  /* ---- woven beats: up to 2 more moments, each with its author ---- */
  var seen = {}; if(usedRef) seen[usedRef] = 1; if(nk) seen['event:' + nk] = 1;   // one beat per distinct source
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
    html += '<div class="hlook" onclick="openEvent(&#39;' + escAttr(nk) + '&#39;)">' + esc(e2.emoji) + ' '
      + L('Sắp tới', 'Coming up') + ': <b>' + esc(e2.name) + '</b> · '
      + (dl2 === 0 ? L('hôm nay', 'today') : L('còn ' + dl2 + ' ngày', dl2 + ' days')) + '</div>';
  }

  setHTMLIf(box, html);
}
window.renderHome = renderHome;
