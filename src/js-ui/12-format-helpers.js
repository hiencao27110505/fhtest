/* ---------- month name lookups (shared) ---------- */
var MONF=['January','February','March','April','May','June','July','August','September','October','November','December'];
var MONA=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
if(events.dinner) events.dinner.date=MONA[TODAY.getMonth()]+' '+TODAY.getDate();   // demo event tracks today
var WKD=['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
/* Vietnamese date lookups + LANG-gated helpers. Vietnamese writes day-before-month
   ("26 thg 7", "Thứ Hai, 26 thg 7") and names months "Tháng 7" — never the English
   month names. Use these (not raw MONF/MONA/WKD) for anything the user reads. */
var MONF_VI=['Tháng 1','Tháng 2','Tháng 3','Tháng 4','Tháng 5','Tháng 6','Tháng 7','Tháng 8','Tháng 9','Tháng 10','Tháng 11','Tháng 12'];
var MONA_VI=['Thg 1','Thg 2','Thg 3','Thg 4','Thg 5','Thg 6','Thg 7','Thg 8','Thg 9','Thg 10','Thg 11','Thg 12'];
var WKD_VI=['Chủ Nhật','Thứ Hai','Thứ Ba','Thứ Tư','Thứ Năm','Thứ Sáu','Thứ Bảy'];
function isVi(){ return LANG==='vi'; }
function L(vi,en){ return isVi()?vi:en; }                       // inline phrase pick
function moFull(i){ return isVi()?MONF_VI[i]:MONF[i]; }         // "Tháng 7" / "July"
function moAbbr(i){ return isVi()?MONA_VI[i]:MONA[i]; }         // "Thg 7" / "Jul"
function fmtMonYear(i,y){ return isVi()?('Tháng '+(i+1)+' '+y):(MONF[i]+' '+y); }
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
/* R5 — dirty-check write. The hydrate re-renders every section on cold start, on
   focus, on realtime and 700ms after every write; most of those produce byte-for-byte
   the same markup. Skipping the innerHTML assignment when the string is unchanged
   preserves the existing DOM — no image re-decode, no scroll reset, no flicker.
   Renders are pure functions of state, so identical html ⇒ identical DOM ⇒ safe to skip.
   Accepts an id or an element; returns true if it actually wrote. */
function setHTMLIf(idOrEl,h){ var e=(typeof idOrEl==='string')?document.getElementById(idOrEl):idOrEl; if(!e)return false; if(e.__sig===h)return false; e.__sig=h; e.innerHTML=h; return true; }
