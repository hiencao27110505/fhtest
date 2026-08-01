/* ---------- What's new (release notes) ----------
   A hand-curated log, NOT a commit feed. Deploys land all day from several
   people; an entry here exists only when someone decides a change is worth
   telling a family about.

   Presentation follows Apple's "What's New" pattern: a tinted line glyph, a
   headline, a small date · time · version line, and one plain-language
   description that says what wasn't working and what changed.

   Copy voice: write like a person telling their family what's new. Warm,
   plain Vietnamese with full diacritics; calm plain English. No em-dashes,
   no semicolons in the prose, no templated "problem. Now solution." rhythm
   repeated across every note, no marketing gloss.

   To publish a note: prepend one entry to RELEASES (newest first), ship it.
   The SW auto-reloads users into the new build, and this surfaces the note.

   Shape of an entry:
     { id, date:'YYYY-MM-DD', time:'HH:MM', ver:'vNNN', icon:<svg-inner>,
       vi:{ t, problem, sol }, en:{ t, problem, sol } }
   - id: date-prefixed + unique, sortable so RELEASES[0] is newest; it is what
     we store as "last seen" to decide what's unread.
   - ver: the service-worker build the change shipped in.
   - problem + sol render as one paragraph.
*/
var FH_VERSION = '__FH_VERSION__';   // current running build, injected by build.js from sw.js

var ICO = {
  heart:'<path d="M12 20s-6.6-4.3-9.1-8.1C1.4 9.3 2.9 5.7 6.2 5.7c1.9 0 3.1 1.2 3.9 2.4.8-1.2 2-2.4 3.9-2.4 3.3 0 4.8 3.6 3.3 6.2C18.6 15.7 12 20 12 20z"/>',
  calendar:'<rect x="3.5" y="5" width="17" height="15" rx="2.5"/><path d="M3.5 9.5h17M8 3.5v3M16 3.5v3"/>',
  timeline:'<circle cx="4.5" cy="6" r="1.4"/><circle cx="4.5" cy="12" r="1.4"/><circle cx="4.5" cy="18" r="1.4"/><path d="M9 6h11M9 12h11M9 18h11"/>',
  sun:'<circle cx="12" cy="12" r="4.3"/><path d="M12 2.5v2.2M12 19.3v2.2M4.4 12H2.2M21.8 12h-2.2M6 6l-1.5-1.5M19.5 19.5 18 18M18 6l1.5-1.5M4.5 19.5 6 18"/>',
  house:'<path d="M4 10.5 12 4l8 6.5"/><path d="M6 9.6V19a1 1 0 001 1h10a1 1 0 001-1V9.6"/>',
  globe:'<circle cx="12" cy="12" r="8.4"/><path d="M3.6 12h16.8M12 3.6c2.5 2.4 2.5 14.4 0 16.8M12 3.6c-2.5 2.4-2.5 14.4 0 16.8"/>',
  pie:'<circle cx="12" cy="12" r="8.4"/><path d="M12 12V3.6M12 12l6.2 5.7"/>',
  camera:'<rect x="3" y="6.6" width="18" height="12.9" rx="2.6"/><circle cx="12" cy="13" r="3.4"/><path d="M8.4 6.6 9.6 4.6h4.8l1.2 2"/>',
  grid:'<rect x="4" y="4" width="7" height="7" rx="1.7"/><rect x="13" y="4" width="7" height="7" rx="1.7"/><rect x="4" y="13" width="7" height="7" rx="1.7"/><rect x="13" y="13" width="7" height="7" rx="1.7"/>',
  envelope:'<rect x="3" y="5.5" width="18" height="13" rx="2.6"/><path d="M3.8 7 12 13l8.2-6"/>'
};

var RELEASES = [
  { id:'2026-08-01-house', date:'2026-08-01', time:'19:44', ver:'v236', icon:ICO.house,
    vi:{ t:'Sửa sang ngôi nhà của nhà mình',
      problem:'Ngôi nhà trên màn hình chính bấy lâu ai cũng giống ai, muốn đổi chút cho ra chất nhà mình cũng chịu.',
      sol:'Giờ mở "Chăm chút tổ ấm" là chọn được kiểu nhà, cây trước sân với một bạn thú cưng. Cả nhà thấy chung một cảnh, và cảnh đổi theo sáng trưa chiều tối.' },
    en:{ t:'Make the house your own',
      problem:'The house on your home screen looked the same for every family, with no way to make it feel like yours.',
      sol:'Now open "Chăm chút tổ ấm" to pick a house style, a tree out front, and a pet. Everyone sees the same yard, and it shifts from morning to night.' } },

  { id:'2026-08-01-future', date:'2026-08-01', time:'13:42', ver:'v226', icon:ICO.calendar,
    vi:{ t:'Xem trước các khoản sắp chi, cả nhà cùng thấy',
      problem:'Mấy khoản sắp phải chi hay chỉ nằm trong đầu một người trong nhà.',
      sol:'Giờ cả nhà cùng thấy, cùng duyệt, và tự cập nhật qua lại giữa các máy.' },
    en:{ t:'Upcoming expenses everyone can see',
      problem:'The bills coming up used to live in just one person’s head.',
      sol:'Now the whole family can see them, sign off on them, and they stay in sync across your phones.' } },

  { id:'2026-08-01-reactions', date:'2026-08-01', time:'13:05', ver:'v225', icon:ICO.heart,
    vi:{ t:'Thả cảm xúc lên chi tiêu của nhau',
      problem:'Hồi trước ai chi gì thì người nhà chỉ biết vậy, chẳng nói được gì.',
      sol:'Giờ bạn thả được cái tim hay cái haha lên giao dịch, người kia thấy liền.' },
    en:{ t:'React to each other’s spending',
      problem:'Before, when someone spent money the rest of you could only look at it.',
      sol:'Now you can drop a heart or a laugh on it, and they see it right away.' } },

  { id:'2026-07-31-timeline', date:'2026-07-31', time:'23:27', ver:'v222', icon:ICO.timeline,
    vi:{ t:'Kế hoạch với kỷ niệm chung một dòng',
      problem:'Việc sắp tới để một nơi, kỷ niệm cũ để một nơi, muốn nhìn lại phải lật tới lật lui.',
      sol:'Giờ hai thứ chung một dải theo ngày, kéo một hơi là thấy hết, từ hôm nay cho tới sau này.' },
    en:{ t:'Plans and memories on one line',
      problem:'Upcoming plans sat in one place and old memories in another, so you kept flipping back and forth.',
      sol:'Now they share one line by day that you can scroll straight through.' } },

  { id:'2026-07-30-home', date:'2026-07-30', time:'16:04', ver:'v206', icon:ICO.house,
    vi:{ t:'Trang chủ Hôm nay',
      problem:'Mở app lên nhiều lúc không biết nên nhìn đâu trước.',
      sol:'Trang chủ mới gom đúng thứ đáng xem trong ngày: một khoảnh khắc, tiền nong cho gọn, và việc sắp tới.' },
    en:{ t:'The new Today home',
      problem:'Opening the app, it wasn’t always obvious where to look first.',
      sol:'The new home gathers what’s worth seeing that day: a moment, the money kept short, and what’s next.' } },

  { id:'2026-07-30-weather', date:'2026-07-30', time:'01:38', ver:'v201', icon:ICO.sun,
    vi:{ t:'Bầu trời của nhà',
      problem:'Tiền thì lúc nào cũng thấy, còn hôm nay ai vui ai mệt thì không.',
      sol:'Giờ bạn đặt tâm trạng, cả nhà thấy bầu trời đổi màu theo.' },
    en:{ t:'Your family’s sky',
      problem:'You could always see the money, just not how everyone was doing that day.',
      sol:'Now you set your mood and the family’s sky changes with it.' } },

  { id:'2026-07-29-bilingual', date:'2026-07-29', time:'15:04', ver:'v188', icon:ICO.globe,
    vi:{ t:'Tiếng Việt hay tiếng Anh, tuỳ bạn',
      problem:'Nhà mình đâu phải ai cũng đọc tiếng Anh giống nhau.',
      sol:'Giờ đổi cả app qua tiếng Việt hay tiếng Anh chỉ với một chạm trong Cài đặt.' },
    en:{ t:'Vietnamese or English, your pick',
      problem:'Not everyone at home reads English the same way.',
      sol:'Now one tap in Settings switches the whole app between Vietnamese and English.' } },

  { id:'2026-07-29-finance', date:'2026-07-29', time:'01:31', ver:'v183', icon:ICO.pie,
    vi:{ t:'Thấy tiền đi đâu, nhanh hơn',
      problem:'Trước hơi khó nhìn ra tháng này tiền chia cho những khoản nào.',
      sol:'Giờ có vòng phân bổ cho thấy từng nhóm, vuốt qua là xem được chi tiêu mỗi ngày.' },
    en:{ t:'See where the money goes, sooner',
      problem:'It used to be hard to read where the month’s money actually went.',
      sol:'Now a ring lays out each category, and a swipe shows what you spent each day.' } },

  { id:'2026-07-28-moments', date:'2026-07-28', time:'17:39', ver:'v170', icon:ICO.camera,
    vi:{ t:'Khoảnh Khắc gom về một chỗ',
      problem:'Ảnh chi tiêu, sự kiện, kỷ niệm trước nằm rải rác mỗi thứ một nơi.',
      sol:'Giờ Khoảnh Khắc gộp hết vào một trang, xem lại theo ngày cho dễ.' },
    en:{ t:'Moments, all in one place',
      problem:'Expense photos, events and memories were scattered all over.',
      sol:'Now Moments keeps them on one page you can look back through by day.' } },

  { id:'2026-07-26-tabs', date:'2026-07-26', time:'16:51', ver:'v137', icon:ICO.grid,
    vi:{ t:'Gọn lại còn ba tab',
      problem:'App trước hơi nhiều mục, dễ lạc.',
      sol:'Giờ còn ba chỗ cho dễ nhớ: Nhà, Thu Chi, Khoảnh Khắc.' },
    en:{ t:'Down to three tabs',
      problem:'The app had a few too many sections to get lost in.',
      sol:'Now it’s three: Home, Money, and Moments.' } },

  { id:'2026-07-20-invite', date:'2026-07-20', time:'12:04', ver:'v117', icon:ICO.envelope,
    vi:{ t:'Mời người nhà bằng một mã',
      problem:'Trước rủ thêm người vào nhà hơi lằng nhằng, chẳng biết đưa mã nào.',
      sol:'Giờ mỗi nhà có một mã đang dùng, gửi là vô được, muốn đổi lúc nào cũng được. Nhiều nhà thì chuyển qua lại trong Cài đặt.' },
    en:{ t:'Invite family with one code',
      problem:'Adding someone used to be fiddly, never sure which code to share.',
      sol:'Now each family has one active code. Send it, they’re in, and you can swap it whenever. In more than one family? Switch in Settings.' } }
];

var FH_SEEN_RELEASE = 'fh-seen-release';

function fhLatestReleaseId(){ return RELEASES.length ? RELEASES[0].id : ''; }
function fhSeenReleaseId(){ try{ return localStorage.getItem(FH_SEEN_RELEASE); }catch(e){ return null; } }
function fhHasUnseenRelease(){ var s=fhSeenReleaseId(); return fhLatestReleaseId() !== '' && s !== fhLatestReleaseId(); }
function fhMarkReleasesSeen(){ try{ localStorage.setItem(FH_SEEN_RELEASE, fhLatestReleaseId()); }catch(e){} fhReleaseBadge(); }

/* Reflect unread state on the gear icon and the Settings row dot. */
function fhReleaseBadge(){
  var on = fhHasUnseenRelease();
  ['wn-dot-gear','wn-dot-row'].forEach(function(id){ var el=document.getElementById(id); if(el) el.style.display = on ? '' : 'none'; });
}

var FH_MONTHS_VI = ['Thg 1','Thg 2','Thg 3','Thg 4','Thg 5','Thg 6','Thg 7','Thg 8','Thg 9','Thg 10','Thg 11','Thg 12'];
var FH_MONTHS_EN = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
function fhReleaseMeta(r){
  var p=(r.date||'').split('-'); var human=r.date||'';
  if(p.length===3){ var y=+p[0], m=+p[1]-1, d=+p[2];
    if(!isNaN(m)) human = isVi() ? (d+' '+FH_MONTHS_VI[m]+', '+y) : (FH_MONTHS_EN[m]+' '+d+', '+y);
  }
  var bits=[human]; if(r.time) bits.push(r.time); if(r.ver) bits.push(r.ver);
  return bits.join(' · ');
}

function fhRenderWhatsNew(){
  var wrap=document.getElementById('whatsnew-list'); if(!wrap) return;
  var html='';
  for(var i=0;i<RELEASES.length;i++){
    var r=RELEASES[i], c=isVi()?r.vi:r.en;
    html+='<div class="wn-row">'
        +   '<span class="wn-ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">'+r.icon+'</svg></span>'
        +   '<div class="wn-txt">'
        +     '<div class="wn-t">'+c.t+'</div>'
        +     '<div class="wn-meta">'+fhReleaseMeta(r)+'</div>'
        +     '<p class="wn-desc">'+c.problem+' '+c.sol+'</p>'
        +   '</div>'
        + '</div>';
  }
  wrap.innerHTML=html;
  var cv=document.getElementById('wn-cur-ver'); if(cv) cv.textContent=FH_VERSION;
}

function openWhatsNew(){
  fhRenderWhatsNew();
  var el=document.getElementById('modal-whatsnew'); if(!el) return;
  var scrim=document.getElementById('scrim'); if(scrim) scrim.classList.add('on');
  el.classList.add('on'); el.style.transform=''; el.style.transition='';
  var b=el.querySelector('.modal-body'); if(b) b.scrollTop=0;
  fhMarkReleasesSeen();   // opening it counts as seen — clears the dot even on scrim-dismiss
}

/* Auto-surface once for anyone already onboarded who hasn't seen the latest.
   A brand-new user is marked "seen" the moment they finish onboarding (see
   onboard-boot), so they start clean and never get a wall of past notes. */
(function fhReleaseBoot(){
  function run(){
    fhReleaseBadge();
    var onboarded=false; try{ onboarded = localStorage.getItem('fh-onboarded')==='1'; }catch(e){}
    if(!onboarded || !fhHasUnseenRelease()) return;
    setTimeout(function(){
      if(!fhHasUnseenRelease()) return;                       // seen elsewhere in the meantime
      if(document.querySelector('.modal.on, .sheet.on')) return; // don't interrupt something open
      openWhatsNew();
    }, 900);
  }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded', run);
  else run();
})();
