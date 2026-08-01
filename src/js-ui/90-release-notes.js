/* ---------- What's new (release notes) ----------
   A hand-curated log, NOT a commit feed. Deploys land all day from several
   people; an entry here exists only when someone decides a change is worth
   telling a family about.

   Presentation follows Apple's "What's New" pattern: a tinted line glyph, a
   headline, and one plain-language description that reads problem → fix, so the
   user sees what the feature is a solution FOR without any labelled chrome.

   To publish a note: prepend one entry to RELEASES (newest first), ship it.
   The SW auto-reloads users into the new build, and this surfaces the note.

   Shape of an entry:
     { id, date:'YYYY-MM-DD', icon:<svg-inner-markup>,
       vi:{ t, problem, sol }, en:{ t, problem, sol } }
   - id must be unique and monotonically increasing (date-prefixed keeps it so);
     it is what we store as "last seen" to decide what's unread.
   - problem + sol are rendered as one paragraph; write them so they flow as
     two sentences ("Before… / Now…").
*/
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
  { id:'2026-08-01-reactions', date:'2026-08-01', icon:ICO.heart,
    vi:{ t:'Thả cảm xúc lên chi tiêu của nhau',
      problem:'Ai đó trong nhà vừa ghi một khoản chi, mà bạn chẳng có cách nào phản hồi — thấy thương, thấy vui, hay thấy “ơ, sao lại mua cái này”.',
      sol:'Giờ bạn thả được tim, haha, wow… lên từng giao dịch. Người kia thấy ngay, có cả chút confetti cho vui.' },
    en:{ t:'React to each other’s spending',
      problem:'Someone just logged an expense, and you had no easy way to respond — a heart, a laugh, or a “wait, why this?”.',
      sol:'Now you can drop a reaction on any transaction. They see it right away, confetti and all.' } },

  { id:'2026-08-01-future', date:'2026-08-01', icon:ICO.calendar,
    vi:{ t:'Cùng nhau xem trước các khoản sắp chi',
      problem:'Những khoản sắp phải chi thường chỉ nằm trong đầu một người; cả nhà không cùng thấy để bàn trước hay chuẩn bị tiền.',
      sol:'Giờ khoản chi tương lai hiện chung cho cả nhà — ai cũng xem và duyệt được, tự đồng bộ giữa các máy.' },
    en:{ t:'Plan upcoming expenses together',
      problem:'Money you’ll need soon usually lived in one person’s head — the rest of the family couldn’t see it to plan ahead.',
      sol:'Now upcoming expenses are shared with everyone — all of you can review them, synced across devices.' } },

  { id:'2026-07-31-timeline', date:'2026-07-31', icon:ICO.timeline,
    vi:{ t:'Kế hoạch và kỷ niệm chung một dòng thời gian',
      problem:'Việc sắp tới nằm một nơi, kỷ niệm đã qua nằm một nơi — phải nhảy qua lại mới hình dung được dòng chảy của nhà.',
      sol:'Giờ tất cả gộp thành một dải theo ngày: nhìn một mạch từ hôm nay tới những dự định phía trước, và ngược về những gì đã qua.' },
    en:{ t:'Plans and memories on one timeline',
      problem:'Upcoming plans lived in one place, past memories in another — you had to hop between them to see the family’s flow.',
      sol:'Now they’re one day-by-day rail: glance from today into what’s ahead, and back through what’s passed.' } },

  { id:'2026-07-30-weather', date:'2026-07-30', icon:ICO.sun,
    vi:{ t:'Bầu trời của nhà',
      problem:'Tiền nong thì thấy rõ, nhưng tâm trạng của nhau trong ngày lại khó mà biết.',
      sol:'Giờ đặt tâm trạng của bạn, cả nhà sẽ thấy “bầu trời” đổi màu theo — kèm chút hiệu ứng thời tiết cho có cảm xúc.' },
    en:{ t:'Your family’s sky',
      problem:'The money was easy to see, but how everyone was actually feeling that day wasn’t.',
      sol:'Now, set your mood and the family’s “sky” shifts to match — with a little weather to make it felt.' } },

  { id:'2026-07-30-home', date:'2026-07-30', icon:ICO.house,
    vi:{ t:'Trang chủ “Hôm nay” mới',
      problem:'Mở app ra mà chẳng biết nhìn vào đâu trước — số liệu thì nhiều, nhưng không cái nào nói “hôm nay nhà mình thế nào”.',
      sol:'Trang chủ mới gom đúng thứ đáng xem: một khoảnh khắc trong ngày, tiền nong gọn gàng, và việc sắp tới.' },
    en:{ t:'A new “Today” home',
      problem:'Opening the app, you didn’t know where to look first — lots of numbers, but nothing that said “here’s your family today”.',
      sol:'The new home gathers what actually matters: a moment from the day, money at a glance, and what’s coming up.' } },

  { id:'2026-07-29-bilingual', date:'2026-07-29', icon:ICO.globe,
    vi:{ t:'Tiếng Việt / English, đổi một chạm',
      problem:'Không phải ai trong nhà cũng đọc tiếng Anh (hay tiếng Việt) thoải mái như nhau.',
      sol:'Giờ chuyển cả app qua lại giữa Tiếng Việt và English chỉ bằng một chạm trong Cài đặt.' },
    en:{ t:'Vietnamese / English, one tap',
      problem:'Not everyone in the family reads English (or Vietnamese) equally comfortably.',
      sol:'Now you can switch the whole app between Vietnamese and English with a single tap in Settings.' } },

  { id:'2026-07-29-finance', date:'2026-07-29', icon:ICO.pie,
    vi:{ t:'Nhìn ra tiền đi đâu, nhanh hơn',
      problem:'Khó thấy nhanh tháng này tiền chia cho những gì và còn lại bao nhiêu.',
      sol:'Vòng phân bổ mới cho thấy ngay tiền dành cho từng nhóm; vuốt để xem chi tiêu từng ngày.' },
    en:{ t:'See where the money goes, faster',
      problem:'It was hard to tell at a glance where this month’s money went and how much was left.',
      sol:'A new allocation ring shows each category’s share at once; swipe to see daily spending.' } },

  { id:'2026-07-28-moments', date:'2026-07-28', icon:ICO.camera,
    vi:{ t:'Khoảnh Khắc: một cuốn album chung',
      problem:'Ảnh chi tiêu, sự kiện và kỷ niệm nằm rải rác, khó xem lại như một cuốn album của cả nhà.',
      sol:'Giờ Khoảnh Khắc gộp tất cả vào một trang — dòng thời gian và album chung, xem lại gọn gàng theo ngày.' },
    en:{ t:'Moments: one shared album',
      problem:'Expense photos, events and memories were scattered — hard to revisit as one family album.',
      sol:'Now Moments brings them together — a shared timeline and album you can browse neatly by day.' } },

  { id:'2026-07-26-tabs', date:'2026-07-26', icon:ICO.grid,
    vi:{ t:'Gọn lại còn 3 tab',
      problem:'App có nhiều mục, dễ lạc và không rõ nên bắt đầu từ đâu.',
      sol:'Giờ chỉ còn ba nơi rõ ràng: Nhà · Thu Chi · Khoảnh Khắc.' },
    en:{ t:'Down to three tabs',
      problem:'The app had many sections — easy to get lost and unsure where to start.',
      sol:'Now there are just three clear places: Home · Money · Moments.' } },

  { id:'2026-07-20-invite', date:'2026-07-20', icon:ICO.envelope,
    vi:{ t:'Mời người nhà bằng một mã duy nhất',
      problem:'Rủ thêm người vào nhà mà không rõ chia sẻ mã kiểu gì, mã cũ mã mới lẫn lộn.',
      sol:'Giờ mỗi nhà có một mã mời đang hiệu lực, chia sẻ là vào được, đổi mã bất cứ lúc nào. Có nhiều nhà thì chuyển qua lại trong Cài đặt.' },
    en:{ t:'Invite family with one code',
      problem:'Adding someone to the family was fuzzy — which code to share, old ones mixing with new.',
      sol:'Now each family has one live invite code; share it to let someone in, rotate it anytime. In more than one family? Switch between them in Settings.' } }
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

function fhRenderWhatsNew(){
  var wrap=document.getElementById('whatsnew-list'); if(!wrap) return;
  var html='';
  for(var i=0;i<RELEASES.length;i++){
    var r=RELEASES[i], c=isVi()?r.vi:r.en;
    html+='<div class="wn-row">'
        +   '<span class="wn-ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">'+r.icon+'</svg></span>'
        +   '<div class="wn-txt">'
        +     '<div class="wn-t">'+c.t+'</div>'
        +     '<p class="wn-desc">'+c.problem+' '+c.sol+'</p>'
        +   '</div>'
        + '</div>';
  }
  wrap.innerHTML=html;
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
