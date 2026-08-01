/* ---------- What's new (release notes) ----------
   A hand-curated log, NOT a commit feed. Deploys land all day from several
   people; an entry here exists only when someone decides a change is worth
   telling a family about. Each note is framed problem-first, in the user's
   own words, so they see what the feature is a solution FOR — then what we did.

   To publish a note: prepend one entry to RELEASES (newest first), ship it.
   The SW auto-reloads users into the new build, and this surfaces the note.

   Shape of an entry:
     { id, date:'YYYY-MM-DD', kind:'new'|'better', icon,
       vi:{ t, problem, sol }, en:{ t, problem, sol } }
   - id must be unique and monotonically increasing (date-prefixed keeps it so);
     it is what we store as "last seen" to decide what's unread.
*/
var RELEASES = [
  { id:'2026-08-01-reactions', date:'2026-08-01', kind:'new', icon:'💞',
    vi:{ t:'Thả cảm xúc lên chi tiêu của nhau',
      problem:'Ai đó trong nhà vừa ghi một khoản chi, mà bạn chẳng có cách nào phản hồi — thấy thương, thấy vui, hay thấy “ơ, sao lại mua cái này”.',
      sol:'Giờ bạn thả được tim, haha, wow… lên từng giao dịch. Người kia thấy ngay, có cả chút confetti cho vui.' },
    en:{ t:'React to each other’s spending',
      problem:'Someone just logged an expense, and you had no easy way to respond — a heart, a laugh, or a “wait, why this?”.',
      sol:'Now you can drop a reaction on any transaction. They see it right away, confetti and all.' } },

  { id:'2026-08-01-future', date:'2026-08-01', kind:'new', icon:'🗓️',
    vi:{ t:'Cùng nhau xem trước các khoản sắp chi',
      problem:'Những khoản sắp phải chi thường chỉ nằm trong đầu một người; cả nhà không cùng thấy để bàn trước hay chuẩn bị tiền.',
      sol:'Khoản chi tương lai giờ hiện chung cho cả nhà — ai cũng xem và duyệt được, tự đồng bộ giữa các máy.' },
    en:{ t:'Plan upcoming expenses together',
      problem:'Money you’ll need soon usually lived in one person’s head — the rest of the family couldn’t see it to plan ahead.',
      sol:'Upcoming expenses are now shared with everyone — all of you can review them, synced across devices.' } },

  { id:'2026-07-31-timeline', date:'2026-07-31', kind:'better', icon:'🧵',
    vi:{ t:'Kế hoạch và kỷ niệm chung một dòng thời gian',
      problem:'Việc sắp tới nằm một nơi, kỷ niệm đã qua nằm một nơi — phải nhảy qua lại mới hình dung được dòng chảy của nhà.',
      sol:'Giờ gộp thành một dải theo ngày: nhìn một mạch từ hôm nay tới những dự định phía trước, và ngược về những gì đã qua.' },
    en:{ t:'Plans and memories on one timeline',
      problem:'Upcoming plans lived in one place, past memories in another — you had to hop between them to see the family’s flow.',
      sol:'Now they’re one day-by-day rail: glance from today into what’s ahead, and back through what’s passed.' } },

  { id:'2026-07-30-weather', date:'2026-07-30', kind:'new', icon:'🌤️',
    vi:{ t:'Bầu trời của nhà',
      problem:'Tiền nong thì thấy rõ, nhưng tâm trạng của nhau trong ngày lại khó mà biết.',
      sol:'Đặt tâm trạng của bạn, cả nhà sẽ thấy “bầu trời” đổi màu theo — kèm chút hiệu ứng thời tiết cho có cảm xúc.' },
    en:{ t:'Your family’s sky',
      problem:'The money was easy to see, but how everyone was actually feeling that day wasn’t.',
      sol:'Set your mood and the family’s “sky” shifts to match — with a little weather to make it felt.' } },

  { id:'2026-07-30-home', date:'2026-07-30', kind:'better', icon:'🏠',
    vi:{ t:'Trang chủ “Hôm nay” mới',
      problem:'Mở app ra mà chẳng biết nhìn vào đâu trước — số liệu thì nhiều, nhưng không cái nào nói “hôm nay nhà mình thế nào”.',
      sol:'Trang chủ mới gom đúng thứ đáng xem: một khoảnh khắc trong ngày, tiền nong gọn gàng, và việc sắp tới.' },
    en:{ t:'A new “Today” home',
      problem:'Opening the app, you didn’t know where to look first — lots of numbers, but nothing that said “here’s your family today”.',
      sol:'The new home gathers what actually matters: a moment from the day, money at a glance, and what’s coming up.' } },

  { id:'2026-07-29-bilingual', date:'2026-07-29', kind:'new', icon:'🌏',
    vi:{ t:'Tiếng Việt / English, đổi một chạm',
      problem:'Không phải ai trong nhà cũng đọc tiếng Anh (hay tiếng Việt) thoải mái như nhau.',
      sol:'Chuyển cả app qua lại giữa Tiếng Việt và English chỉ bằng một chạm trong Cài đặt.' },
    en:{ t:'Vietnamese / English, one tap',
      problem:'Not everyone in the family reads English (or Vietnamese) equally comfortably.',
      sol:'Switch the whole app between Vietnamese and English with a single tap in Settings.' } },

  { id:'2026-07-29-finance', date:'2026-07-29', kind:'better', icon:'📊',
    vi:{ t:'Nhìn ra tiền đi đâu, nhanh hơn',
      problem:'Khó thấy nhanh tháng này tiền chia cho những gì và còn lại bao nhiêu.',
      sol:'Vòng phân bổ mới cho thấy ngay tiền dành cho từng nhóm; vuốt để xem chi tiêu từng ngày.' },
    en:{ t:'See where the money goes, faster',
      problem:'It was hard to tell at a glance where this month’s money went and how much was left.',
      sol:'A new allocation ring shows each category’s share at once; swipe to see daily spending.' } },

  { id:'2026-07-28-moments', date:'2026-07-28', kind:'better', icon:'📸',
    vi:{ t:'Khoảnh Khắc: một cuốn album chung',
      problem:'Ảnh chi tiêu, sự kiện và kỷ niệm nằm rải rác, khó xem lại như một cuốn album của cả nhà.',
      sol:'Khoảnh Khắc gộp tất cả vào một trang — dòng thời gian và album chung, xem lại gọn gàng theo ngày.' },
    en:{ t:'Moments: one shared album',
      problem:'Expense photos, events and memories were scattered — hard to revisit as one family album.',
      sol:'Moments brings them together — a shared timeline and album you can browse neatly by day.' } },

  { id:'2026-07-26-tabs', date:'2026-07-26', kind:'better', icon:'🧭',
    vi:{ t:'Gọn lại còn 3 tab',
      problem:'App có nhiều mục, dễ lạc và không rõ nên bắt đầu từ đâu.',
      sol:'Giờ chỉ còn ba nơi rõ ràng: Nhà · Thu Chi · Khoảnh Khắc.' },
    en:{ t:'Down to three tabs',
      problem:'The app had many sections — easy to get lost and unsure where to start.',
      sol:'Now there are just three clear places: Home · Money · Moments.' } },

  { id:'2026-07-20-invite', date:'2026-07-20', kind:'new', icon:'✉️',
    vi:{ t:'Mời người nhà bằng một mã duy nhất',
      problem:'Rủ thêm người vào nhà mà không rõ chia sẻ mã kiểu gì, mã cũ mã mới lẫn lộn.',
      sol:'Mỗi nhà giờ có một mã mời đang hiệu lực, chia sẻ là vào được; đổi mã bất cứ lúc nào. Có nhiều nhà thì chuyển qua lại trong Cài đặt.' },
    en:{ t:'Invite family with one code',
      problem:'Adding someone to the family was fuzzy — which code to share, old ones mixing with new.',
      sol:'Each family now has one live invite code; share it to let someone in, rotate it anytime. In more than one family? Switch between them in Settings.' } }
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
function fhReleaseDate(iso){
  var p=(iso||'').split('-'); if(p.length<3) return iso||'';
  var y=+p[0], m=+p[1]-1, d=+p[2]; if(isNaN(m)) return iso;
  return isVi() ? (d+' '+FH_MONTHS_VI[m]+', '+y) : (FH_MONTHS_EN[m]+' '+d+', '+y);
}

function fhRenderWhatsNew(){
  var wrap=document.getElementById('whatsnew-list'); if(!wrap) return;
  var newLbl=L('Mới','New'), betterLbl=L('Cải tiến','Improved');
  var probLbl=L('Vấn đề','The problem'), solLbl=L('Giải pháp','What’s new');
  var html='';
  for(var i=0;i<RELEASES.length;i++){
    var r=RELEASES[i], c=isVi()?r.vi:r.en;
    var tagCls = r.kind==='new' ? 'wn-tag-new' : 'wn-tag-better';
    var tagTxt = r.kind==='new' ? newLbl : betterLbl;
    html+='<article class="wn-item">'
        +   '<div class="wn-head">'
        +     '<span class="wn-ic">'+r.icon+'</span>'
        +     '<div class="wn-htext">'
        +       '<div class="wn-t">'+c.t+'</div>'
        +       '<div class="wn-meta"><span class="wn-tag '+tagCls+'">'+tagTxt+'</span><span class="wn-date">'+fhReleaseDate(r.date)+'</span></div>'
        +     '</div>'
        +   '</div>'
        +   '<div class="wn-block wn-prob"><span class="wn-lbl">'+probLbl+'</span><p>'+c.problem+'</p></div>'
        +   '<div class="wn-block wn-sol"><span class="wn-lbl">'+solLbl+'</span><p>'+c.sol+'</p></div>'
        + '</article>';
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
