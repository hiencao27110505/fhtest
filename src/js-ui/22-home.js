/* ---------- Home — the emotional feed ("moment engine") ----------
   Home isn't a dashboard: it surfaces ONE warm moment a day woven from
   everything the family has (an upcoming occasion, a resurfaced memory, a
   spend that became a photo), plus a "money, felt" pulse — the month's
   financial mood in a glance, never a stat. The tabs stay for the doing. */

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

function renderHome(){
  var box = document.getElementById('home-body'); if(!box) return;
  buildMemRecords();
  var evs = window.events || {}, ord = window.order || [];
  var isMirrorK = function(k){ var e = evs[k]; return !!(e && (e._srcTxn || e.fromExpense)); };
  var html = '', usedRef = null;

  // upcoming real occasions (not achieved, not a photo-expense mirror), nearest first
  var up = ord.filter(function(k){ return evs[k] && evs[k].d && !isMirrorK(k) && !achievedNow(evs[k]); })
              .sort(function(a, b){ return evs[a].d.getTime() - evs[b].d.getTime(); });

  /* ---- centerpiece: the daily moment ---- */
  if(up.length){                                          // anticipation, saving woven in
    var k = up[0], e = evs[k], dl = daysLeft(e.d);
    var pct = e.target > 0 ? Math.min(100, Math.round(e.saved / e.target * 100)) : 0;
    var eye = dl === 0 ? L('Hôm nay', 'Today') : (dl === 1 ? L('Ngày mai', 'Tomorrow') : L('Còn ' + dl + ' ngày', dl + ' days to go'));
    var money = e.target > 0
      ? (pct >= 85 ? L('Cả nhà đã để dành gần đủ rồi 🌿', 'Almost there together 🌿')
        : (pct >= 35 ? L('Cả nhà đang để dành dần 🌿', 'Saving up together 🌿')
          : L('Cùng để dành cho dịp này nhé 🌿', 'Saving toward it together 🌿')))
      : L('Điều cả nhà đang mong 💛', 'Something to look forward to 💛');
    html += '<button class="hmoment" onclick="openEvent(&#39;' + escAttr(k) + '&#39;)">' + hVisual(e.cls, e.cov, e.emoji)
      + '<div class="hm-cap"><div class="hm-eye">' + esc(eye) + '</div><div class="hm-title">' + esc(e.name)
      + '</div><div class="hm-sub">' + money + '</div></div>'
      + (e.target > 0 ? '<div class="hm-prog"><i style="width:' + pct + '%"></i></div>' : '') + '</button>';
  } else if(memRecords.length){                           // a resurfaced moment
    var r = memRecords[0], i = memRecords.indexOf(r); usedRef = r.type + ':' + r.ref;
    html += '<button class="hmoment" onclick="openMemory(' + i + ')">' + hVisual(r.cls, r.src, r.emoji)
      + '<div class="hm-cap"><div class="hm-eye">' + L('Khoảnh khắc gần đây', 'A recent moment') + '</div><div class="hm-title">'
      + esc(r.cap) + '</div><div class="hm-sub">' + esc(r.meta || '') + '</div></div></button>';
  } else {                                                // a new family — a gentle invitation, still a feeling
    html += '<button class="hmoment" onclick="openSheet(&#39;sheet-add&#39;)"><div class="hm-bg ph-park"></div><div class="hm-scrim"></div><div class="hm-subj">🌿</div>'
      + '<div class="hm-cap"><div class="hm-eye">' + L('Bắt đầu', 'Begin') + '</div><div class="hm-title">'
      + L('Câu chuyện của cả nhà', 'Your family’s story') + '</div><div class="hm-sub">'
      + L('Thêm khoảnh khắc đầu tiên, hoặc lên kế hoạch một dịp 💛', 'Add your first moment, or plan an occasion 💛') + '</div></div></button>';
  }

  /* ---- money, felt: the month's financial mood ---- */
  var m = (typeof M === 'function') ? M() : null;
  if(m && m.budget > 0){
    var reserved = m.done ? 0 : monthReserved();
    var safe = Math.max(0, m.budget - m.spent - reserved), over = m.spent > m.budget;
    var proj = m.dom > 0 && ((m.spent / m.dom * m.dim) - m.budget > m.budget * 0.01);
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

  /* ---- woven beats: up to 2 more moments (a memory, a spend-that-became-a-memory) ---- */
  var beats = memRecords.filter(function(r){ return (r.type + ':' + r.ref) !== usedRef; }).slice(0, 2);
  beats.forEach(function(r){
    var i = memRecords.indexOf(r), isExp = r.type === 'expense';
    var eye = isExp ? L('Từ một khoản chi', 'From a spend') : L('Nhớ lại', 'Remember');
    var sub = isExp ? L('Một khoản chi đã thành kỷ niệm 📸', 'A spend that became a memory 📸') : esc(r.meta || '');
    html += '<button class="hbeat" onclick="openMemory(' + i + ')">' + hThumb(r.cls, r.src, r.emoji)
      + '<div class="hb-body"><div class="hb-eye">' + eye + '</div><div class="hb-title">' + esc(r.cap) + '</div>'
      + '<div class="hb-sub">' + sub + '</div></div></button>';
  });

  setHTMLIf(box, html);
}
window.renderHome = renderHome;
