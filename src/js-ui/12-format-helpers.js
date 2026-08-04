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
