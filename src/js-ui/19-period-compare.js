/* ── Period comparison — which earlier period does a bar compare with?
   (docs/specs/period-comparison-spec.md)

   The ONE place that decides the "before" behind every bar of both cash-flow
   charts: the family deck (20-budget.js) and the personal strip
   (21-personal.js). Pure date math over 'YYYY-MM-DD' strings and buổi
   indexes — no data access, no DOM — so the two charts can only agree.

   Rules:  buổi ↔ same buổi 7 days earlier · day ↔ 7 days earlier ·
           week ↔ its Monday shifted one month back, snapped to that Monday ·
           month ↔ the previous month (+ same month last year as a tick).
   Covered: the comparison period starts on/after the ledger's first row —
           otherwise there is NO grey bar (which is not the same as a zero one). */

/* Sáng 5–10 · Trưa 11–13 · Chiều 14–17 · Tối 18–4. Hours 0–4 are Tối of the
   SAME calendar date, so a day's buổi never disagree with its day bar. */
function fhBuoiIdx(h){ return (h>=5&&h<11)?0:(h>=11&&h<14)?1:(h>=14&&h<18)?2:3; }
function fhBuoiLabels(){ return (typeof isVi==='function' && !isVi()) ? ['Morning','Midday','Afternoon','Evening'] : ['Sáng','Trưa','Chiều','Tối']; }
/* Buổi of one row, or null when its clock time is unknown:
   1. its own occurred time ('HH:MM' / 'HH:MM:SS');
   2. else the moment it was logged — only if logged on the SAME calendar day;
   3. else null: the row stays in the day's total and out of the buổi bars. */
function fhBuoiOf(date, time, ts){
  if(typeof time==='string' && /^\d{1,2}:\d{2}/.test(time)) return fhBuoiIdx(parseInt(time,10));
  if(ts){
    var d=(ts instanceof Date)?ts:new Date(ts);
    if(!isNaN(d.getTime()) && fhDateStr(d)===date) return fhBuoiIdx(d.getHours());
  }
  return null;
}
/* Local 'YYYY-MM-DD' (never toISOString: UTC+7 would shift the date). */
function fhDateStr(d){ return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); }
function fhParseDate(s){ return new Date(+s.slice(0,4), +s.slice(5,7)-1, +s.slice(8,10)); }
function fhAddDays(s, n){ var d=fhParseDate(s); d.setDate(d.getDate()+n); return fhDateStr(d); }
function fhMondayOf(s){ var d=fhParseDate(s); d.setDate(d.getDate()-((d.getDay()+6)%7)); return fhDateStr(d); }
/* Day ↔ the same weekday last week. */
function fhCmpDay(s){ return fhAddDays(s, -7); }
/* Week ↔ "the same week of last month": shift the Monday one calendar month
   back (clamped to that month's length: 30 Mar → 28 Feb), then snap to the
   Monday of the week that date falls in. Weekdays stay aligned; the week
   lands within three days of the same point in the pay cycle; and there is
   always a partner — a fifth week too. */
function fhCmpWeek(mondayStr){
  var d=fhParseDate(mondayStr), y=d.getFullYear(), m=d.getMonth()-1;
  var dimPrev=new Date(y, m+1, 0).getDate();
  var p=new Date(y, m, Math.min(d.getDate(), dimPrev));
  return fhMondayOf(fhDateStr(p));
}
/* Month ↔ {prev: previous month, ly: same month last year}, 'YYYY-MM'. */
function fhCmpMonth(monKey){
  var y=+monKey.slice(0,4), m=+monKey.slice(5,7);
  var pm = m===1 ? (y-1)+'-12' : y+'-'+String(m-1).padStart(2,'0');
  return { prev: pm, ly: (y-1)+'-'+monKey.slice(5,7) };
}
/* Is a comparison period covered by the ledger? Its START must be on/after
   the first row's date. `first` null = the ledger's start is not known yet
   (personal: the full slice has not landed) → not covered. */
function fhCovered(periodStartStr, first){ return !!first && periodStartStr>=first; }
/* 'T2'…'CN' / 'Mon'…'Sun' for a date string. */
function fhWdShort(s){
  var wd=fhParseDate(s).getDay();   // 0=Sun
  return (typeof isVi==='function' && !isVi()) ? ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][wd] : (wd===0?'CN':'T'+(wd+1));
}
/* 'd/m' for a date string. */
function fhDM(s){ return (+s.slice(8,10))+'/'+(+s.slice(5,7)); }
