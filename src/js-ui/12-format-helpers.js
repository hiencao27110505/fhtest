/* ---------- month name lookups (shared) ---------- */
var MONF=['January','February','March','April','May','June','July','August','September','October','November','December'];
var MONA=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
var WKD=['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
/* Vietnamese date lookups + LANG-gated helpers. Vietnamese writes day-before-month
   ("26 thg 7", "Thứ Hai, 26 thg 7") and names months "Tháng 7" — never the English
   month names. Use these (not raw MONF/MONA/WKD) for anything the user reads. */
var MONF_VI=['Tháng 1','Tháng 2','Tháng 3','Tháng 4','Tháng 5','Tháng 6','Tháng 7','Tháng 8','Tháng 9','Tháng 10','Tháng 11','Tháng 12'];
var MONA_VI=['Thg 1','Thg 2','Thg 3','Thg 4','Thg 5','Thg 6','Thg 7','Thg 8','Thg 9','Thg 10','Thg 11','Thg 12'];
var WKD_VI=['Chủ Nhật','Thứ Hai','Thứ Ba','Thứ Tư','Thứ Năm','Thứ Sáu','Thứ Bảy'];
function isVi(){ return LANG==='vi'; }
function L(vi,en){ return isVi()?vi:en; }                       // inline phrase pick
function whoName(n){ return n==='Shared'?L('Chung','Shared'):n; }   // localize the collective member label ('Shared' is the internal key)
function moFull(i){ return isVi()?MONF_VI[i]:MONF[i]; }         // "Tháng 7" / "July"
function moAbbr(i){ return isVi()?MONA_VI[i]:MONA[i]; }         // "Thg 7" / "Jul"
function fmtMonYear(i,y){ return isVi()?('Tháng '+(i+1)+' '+y):(MONF[i]+' '+y); }
function curMoName(){ return isVi()?('tháng '+(TODAY.getMonth()+1)):MONF[TODAY.getMonth()]; }   // "tháng 8" / "August"
function curMoTxt(){ return isVi()?('trong '+curMoName()):('in '+curMoName()); }                // "trong tháng 8" / "in August"
function fmtDayMon(d){ return isVi()?(d.getDate()+' thg '+(d.getMonth()+1)):(MONA[d.getMonth()]+' '+d.getDate()); }  // "26 thg 7" / "Jul 26"
function fmtDateLong(d){ if(!d) return ''; return isVi()?(WKD_VI[d.getDay()]+', '+d.getDate()+' thg '+(d.getMonth()+1)):(WKD[d.getDay()]+', '+MONF[d.getMonth()]+' '+d.getDate()); }
// Weekday + day only (no month) — for the album's day groups, already scoped to one month.
function fmtWeekdayDay(d){ if(!d) return ''; return isVi()?(WKD_VI[d.getDay()]+', '+d.getDate()):(WKD[d.getDay()]+' '+d.getDate()); }
/* Elapsed time, said the way a person would — for the reconnect screens, which
   have to name an outage ("kết nối đã bị ngắt 3 ngày 4 giờ"). LANG-gated like
   every other helper here: a duration is no more hand-buildable than a date.
   Steps down by scale so the number never reads as an incident report — minutes
   under an hour, hours under a day, days beyond, and no seconds ever. */
function fmtGap(ms){
  var m=Math.max(0,Math.round(ms/60000)), h=Math.floor(m/60), d=Math.floor(h/24);
  if(m<60)  return isVi() ? (m+' phút') : (m+' min');
  if(h<24){ var rm=m-h*60;
    return isVi() ? (h+' giờ'+(rm?' '+rm+' phút':'')) : (h+'h'+(rm?' '+rm+'m':'')); }
  if(d<30){ var rh=h-d*24;
    return isVi() ? (d+' ngày'+(rh?' '+rh+' giờ':'')) : (d+' day'+(d>1?'s':'')+(rh?' '+rh+'h':'')); }
  return isVi() ? (d+' ngày') : (d+' days');
}
function sameDay(a,b){ return !!(a&&b&&a.getFullYear()===b.getFullYear()&&a.getMonth()===b.getMonth()&&a.getDate()===b.getDate()); }
function parseAmt(s){ return parseInt((s||'').replace(/[^0-9]/g,''))||0; }
function daysLeft(d){ return Math.max(0,Math.round((d-TODAY)/86400000)); }
// Signed version — daysLeft() clamps at 0, so past dates all read as "today".
function daysAgo(d){ return Math.max(0,Math.round((TODAY-d)/86400000)); }
function agoLabel(d){
  var n=daysAgo(d);
  if(isVi()){
    if(n===0) return 'hôm nay';
    if(n===1) return 'hôm qua';
    if(n<30)  return n+' ngày trước';
    var moV=Math.round(n/30);
    return moV<12 ? moV+' tháng trước' : Math.round(n/365)+' năm trước';
  }
  if(n===0) return 'today';
  if(n===1) return '1d ago';
  if(n<30)  return n+'d ago';
  var mo=Math.round(n/30);
  return mo<12 ? mo+'mo ago' : Math.round(n/365)+'y ago';
}
function setTxt(id,t){ var e=document.getElementById(id); if(e)e.textContent=t; }
function setHTML(id,h){ var e=document.getElementById(id); if(e)e.innerHTML=h; }
/* ---------- required-field validation (DESIGN §4.4) ----------
   House rule: a submit CTA is NEVER greyed out to signal a missing required field —
   a disabled button explains nothing, it just leaves the user poking a dead pixel.
   The CTA stays live; tapping it with an incomplete form flags each missing field
   (danger border + one shake) + toasts what to finish, then focuses the first.
   This mirrors the bulk-expense flow (submitBulk/bulkShowInvalid) so every form in
   the app fails the same, legible way.

   fhFieldWrap(el) → the .field wrapper to flag (or the element itself if it has none,
   e.g. a bare onboarding input). fhFlagField(el) paints it invalid and (re)plays the
   shake. fhClearInvalid(scope) wipes flags — call it on input so the red clears as the
   user fixes things. fhCheck(rules,msg) is the one entry point most callers use. */
function fhFieldWrap(el){ if(!el) return null; return (el.closest && el.closest('.field')) || el; }
function fhFlagField(el){
  var w=fhFieldWrap(el); if(!w) return null;
  w.classList.add('invalid');
  w.classList.remove('shake'); void w.offsetWidth; w.classList.add('shake');   // restart the shake even if already flagged
  return w;
}
function fhClearInvalid(scope){
  var root = !scope ? document
    : (scope.querySelectorAll ? scope : document.getElementById(scope));
  if(!root) return;
  if(root.classList && root.classList.contains('invalid')) root.classList.remove('invalid','shake');   // scope may itself be the flagged element
  root.querySelectorAll('.invalid').forEach(function(e){ e.classList.remove('invalid','shake'); });
  if(root.removeAttribute && root.getAttribute && root.getAttribute('aria-invalid')) root.removeAttribute('aria-invalid');
  root.querySelectorAll('[aria-invalid]').forEach(function(e){ e.removeAttribute('aria-invalid'); });
}
/* rules: [{el, ok, focus}] where `el` is a field element or its DOM id, `ok` is
   truthy (or a function) when satisfied, and focus:false opts a field out of receiving
   focus. Returns true when every rule passes; otherwise flags the failing fields,
   focuses/shakes the first, toasts `msg`, and returns false. */
/* A settings row whose value is ONE native picker (date or time): the tap opens
   the OS picker directly, no sheet in between (2026-09-14). A transparent
   <input> covers the row so the OS handles the tap itself (iOS opens its wheel
   on the input's own tap; showPicker() where the browser has it, for desktop).
   Its change event calls `on` with the new value ('' when cleared), preceded
   by `arg` when one is given. `clear` adds a ✕ that calls `on` with ''.
   Markup mirrors _exdRow so it sits in a .csv-srows group unchanged. */
function fhPickRow(o){   // {label, val, type:'date'|'time', value, on, arg, soft, chg, hot, clear}
  var cls='csv-srow pick'+(o.soft?' soft':'')+(o.hot?' hot':'')+(o.chg?' chg':'');
  var chev='<svg class="csv-schev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m9 6 6 6-6 6"/></svg>';
  var x=(o.clear&&o.value)?'<button type="button" class="csv-sclear" aria-label="'+escAttr(L('Bỏ','Clear'))+'" onclick="event.stopPropagation();fhPickClear(this)">✕</button>':'';
  return '<div class="'+cls+'"><small>'+o.label+'</small><span class="csv-sval">'+o.val+x+chev+'</span>'
    +'<input class="csv-spick" type="'+(o.type||'date')+'" value="'+escAttr(o.value||'')+'" data-on="'+escAttr(o.on)+'"'+(o.arg!=null?' data-arg="'+escAttr(String(o.arg))+'"':'')
    +' onchange="fhPickChange(this)" onblur="fhPickBlur(this)" onclick="fhPickOpen(this)" aria-label="'+escAttr(String(o.label).replace(/<[^>]*>/g,''))+'"></div>';
}
/* Two phases, because iOS fills an EMPTY date input with today and fires
   `change` the instant its wheel opens — a handler that re-rendered on change
   tore the open picker down, which read as "it confirmed today by itself"
   (2026-09-14). So: on change the handler only records the value and returns
   the row's new label, patched in place under the still-open picker; on blur
   (the picker closed, on iOS and desktop alike) the handler runs again with
   final=true and re-renders. Handler contract: on([arg,] value, final) →
   label HTML when !final. ✕ is always final. */
function _fhPickCall(i, v, final){
  var fn=window[i.getAttribute('data-on')]; if(typeof fn!=='function') return null;
  return i.hasAttribute('data-arg') ? fn(i.getAttribute('data-arg'), v, final) : fn(v, final);
}
function fhPickChange(i){
  i.setAttribute('data-dirty','1');
  var lbl=_fhPickCall(i, i.value, false);
  if(lbl){ var b=i.parentNode&&i.parentNode.querySelector('.csv-sval > b'); if(b) b.outerHTML=lbl; }
}
function fhPickBlur(i){ if(i.getAttribute('data-dirty')!=='1') return; i.removeAttribute('data-dirty'); _fhPickCall(i, i.value, true); }
function fhPickClear(btn){ var i=btn.parentNode&&btn.parentNode.parentNode&&btn.parentNode.parentNode.querySelector('input.csv-spick'); if(!i) return; i.value=''; i.removeAttribute('data-dirty'); _fhPickCall(i, '', true); }
function fhPickOpen(i){ try{ if(typeof i.showPicker==='function') i.showPicker(); }catch(e){} }
function fhCheck(rules, msg){
  var bad=[];
  (rules||[]).forEach(function(r){
    var el=(typeof r.el==='string')?document.getElementById(r.el):r.el;
    var w=el?fhFieldWrap(el):null;
    if(w) w.classList.remove('invalid','shake');                 // reset before re-evaluating
    if(el && el.removeAttribute) el.removeAttribute('aria-invalid');
    var ok=(typeof r.ok==='function')?r.ok():r.ok;
    if(!ok) bad.push({el:el, w:w, focus:r.focus});
  });
  if(!bad.length) return true;
  bad.forEach(function(b){ if(b.w) fhFlagField(b.el); if(b.el && b.el.setAttribute) b.el.setAttribute('aria-invalid','true'); });
  var first=bad[0];
  if(first.el && first.focus!==false && typeof first.el.focus==='function'){ try{ first.el.focus(); }catch(e){} }
  if(typeof toast==='function') toast(msg || L('Vui lòng điền các mục được tô đỏ','Please fill in the highlighted fields'));
  return false;
}
window.fhCheck=fhCheck; window.fhFlagField=fhFlagField; window.fhClearInvalid=fhClearInvalid;
/* R5 — dirty-check write. The hydrate re-renders every section on cold start, on
   focus, on realtime and 700ms after every write; most of those produce byte-for-byte
   the same markup. Skipping the innerHTML assignment when the string is unchanged
   preserves the existing DOM — no image re-decode, no scroll reset, no flicker.
   Renders are pure functions of state, so identical html ⇒ identical DOM ⇒ safe to skip.
   Accepts an id or an element; returns true if it actually wrote. */
function setHTMLIf(idOrEl,h){ var e=(typeof idOrEl==='string')?document.getElementById(idOrEl):idOrEl; if(!e)return false; if(e.__sig===h)return false; e.__sig=h; e.innerHTML=h; return true; }
/* ---------- HTML escaping (single source of truth) ----------
   User text (names, notes, category/event/goal names, captions, emails, CSV cells)
   flows into innerHTML strings and into inline onclick attributes all over the app.
   Because decrypted E2EE fields also render through these same paths, an unescaped
   value is not just a broken apostrophe — it is script running with the family key
   unlocked. Escape EVERYTHING user-authored on the way out: esc() in text position,
   escAttr() for a value sitting inside a quoted on*="fn('…')" handler.
   Defined here (early) so every js-ui builder sees them; mirrored onto window so the
   js-data module (which runs after this classic script) shares the exact same pair. */
function esc(s){ return String(s==null?'':s).replace(/[&<>"']/g,function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); }
function escAttr(s){ return String(s==null?'':s).replace(/\\/g,'\\\\').replace(/'/g,"\\'").replace(/"/g,'&quot;'); }
window.esc=esc; window.escAttr=escAttr;
