/* ---------- celebration ---------- */
function celebrate(emoji,title,sub){
  setTxt('cel-emoji',emoji); setTxt('cel-title',title); setTxt('cel-sub',sub);
  closeSheet(); closeModals(); document.getElementById('celebrate').classList.add('on'); floatEmojis(emoji);
}
function closeCelebrate(){ document.getElementById('celebrate').classList.remove('on'); }
function floatEmojis(emoji){
  var phone=document.getElementById('phone'), pool=[emoji,'✨','🎊','💫','🎈'];
  for(var i=0;i<11;i++){
    (function(i){
      var s=document.createElement('span'); s.className='float-e'; s.textContent=pool[i%pool.length];
      s.style.left=(10+(i*8)%78)+'%'; s.style.fontSize=(20+(i%4)*7)+'px';
      phone.appendChild(s);
      requestAnimationFrame(function(){
        s.style.transition='transform 1.6s cubic-bezier(.2,.6,.3,1), opacity 1.6s ease'; s.style.opacity='1';
        var dx=(i%2?1:-1)*(20+(i%3)*22);
        s.style.transform='translate('+dx+'px,-'+(250+(i%4)*40)+'px) rotate('+dx+'deg)';
      });
      setTimeout(function(){ s.style.opacity='0'; },1150);
      setTimeout(function(){ s.remove(); },1800);
    })(i);
  }
}

/* ---------- theme (personalization) ---------- */
var THEMES=[
  {k:'sage',name:'Sage',grad:'linear-gradient(150deg,#4CB584,#2E9E6B 52%,#8FC97E)',bar:'#2E9E6B'},
  {k:'ocean',name:'Ocean',grad:'linear-gradient(150deg,#2AA9E0,#1E74D0 52%,#4FC2C9)',bar:'#1E74D0'},
  {k:'lavender',name:'Lavender',grad:'linear-gradient(150deg,#9270E8,#7A5AE0 50%,#B98BE0)',bar:'#7A5AE0'},
  {k:'blossom',name:'Blossom',grad:'linear-gradient(150deg,#F07898,#E0567F 50%,#D98AB0)',bar:'#E0567F'},
  {k:'twilight',name:'Twilight',grad:'linear-gradient(150deg,#4A54C4,#3B3F86 55%,#6A5FC0)',bar:'#3B3F86'}
];
var curTheme='sage';
function applyTheme(k){
  if(!THEMES.some(function(t){return t.k===k;}))return;
  curTheme=k;
  document.getElementById('phone').className='phone t-'+k;
  var t=THEMES.filter(function(x){return x.k===k;})[0];
  var mt=document.querySelector('meta[name=theme-color]'); if(mt&&t)mt.setAttribute('content',t.bar);
  try{ localStorage.setItem('fh-theme',k); }catch(e){}
  buildThemeChoices();
}
function buildThemeChoices(){
  var box=document.getElementById('theme-grid'); if(!box)return;
  box.innerHTML=THEMES.map(function(t){
    return '<div class="theme-opt'+(t.k===curTheme?' on':'')+'" onclick="applyTheme(\''+t.k+'\')">'
      +'<div class="sw" style="background:'+t.grad+'"><div class="chk"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#191022" stroke-width="3.2"><path d="M5 12l5 5L20 7"/></svg></div></div>'
      +'<div class="nm">'+t.name+'</div></div>';
  }).join('');
}
(function(){ var s; try{s=localStorage.getItem('fh-theme');}catch(e){} if(s) applyTheme(s); })();

function firstName(n){ return (n||'').trim().split(/\s+/)[0]||'there'; }
function setGreeting(){
  var h=new Date().getHours();
  var g=h<12?t('morning'):(h<18?t('afternoon'):t('evening'));
  var em=h<5?'🌙':(h<12?'☀️':(h<18?'🌤️':'🌙'));
  setTxt('greet',g+', '+firstName(FAM.user.name)+' '+em);
  var gs=document.querySelector('.greet-sub'); if(gs) gs.textContent=t('greetSub');
}

/* ---------- i18n (English · Tiếng Việt) ---------- */
var LANG='en';
var I18N={
  en:{}, // English = the literal strings already in the HTML; en falls back to the DOM default
  vi:{
    welcomeTitle:'Chào mừng đến với', tagPool:'Một ví chung', tagPoolS:"Xem tiền của cả nhà ở một nơi: ngân sách và chi tiêu cùng nhau.",
    tagGoals:'Mục tiêu & sự kiện', tagGoalsS:'Tiết kiệm cho những chuyến đi, sinh nhật và điều quan trọng.',
    tagMem:'Kỷ niệm cùng nhau', tagMemS:'Biến những khoảnh khắc thường ngày thành album của gia đình.',
    getStarted:'Bắt đầu', haveAccount:'Tôi đã có tài khoản',
    localeTitle:'Ngôn ngữ & tiền tệ', localeSub:'Chọn ngôn ngữ và cách hiển thị tiền của FamilyHub.', langLabel:'Ngôn ngữ', curLabel:'Tiền tệ',
    signinT:'Đăng nhập FamilyHub', signinS:'Tiếp tục với tài khoản Google, an toàn và chỉ một chạm.', continueGoogle:'Tiếp tục với Google', signingIn:'Đang đăng nhập…',
    terms:'Khi tiếp tục, bạn đồng ý với Điều khoản & Chính sách bảo mật.',
    familyTitle:'Gia đình của bạn', familySub:'Tạo một gia đình mới, hoặc tham gia gia đình đã mời bạn.',
    startFamily:'Tạo gia đình mới', startFamilyS:'Bạn sẽ đặt tên và mời người khác', joinFamily:'Tham gia gia đình', joinFamilyS:'Nhập mã mời',
    joinTitle:'Nhập mã mời', joinSub:'Xin mã 6 ký tự từ lời mời của người thân.', joinCta:'Tham gia gia đình',
    profileTitle:'Thiết lập hồ sơ', profileSub:'Đây là cách gia đình nhìn thấy bạn.', yourName:'Tên của bạn', youAreThe:'Bạn là…',
    setFamilyTitle:'Thiết lập gia đình', setFamilySub:'Đặt tên và mời các thành viên.', familyName:'Tên gia đình', membersInvites:'Thành viên & lời mời', inviteMember:'＋ Mời thành viên',
    budgetTitle:'Đặt ngân sách', budgetSub:'Mục tiêu hằng tháng cho gia đình, rồi ngân sách cho từng danh mục.', monthlyBudget:'Ngân sách hằng tháng', categoryBudgets:'Ngân sách theo danh mục', categoryBudgetsHint:'Gợi ý sẵn từ tổng ngân sách, bạn có thể chỉnh bất cứ lúc nào.',
    themeTitle:'Chọn giao diện', themeSub:'Chọn màu chủ đề cho gia đình, có thể đổi bất cứ lúc nào.',
    enterApp:'Vào FamilyHub', continue:'Tiếp tục', you:'Bạn',
    tabHome:'Nhà', tabMoney:'Tài Chính', tabMoments:'Khoảnh Khắc', tabSpending:'Chi tiêu', tabEvents:'Sự kiện', tabMemories:'Kỷ niệm',
    morning:'Chào buổi sáng', afternoon:'Chào buổi chiều', evening:'Chào buổi tối', greetSub:'Tình hình tiền của gia đình hôm nay.',
    comingUp:'Sắp tới', recent:'Gần đây', activity:'Hoạt động', memories:'Kỷ niệm', whereGoing:'Tiền đi đâu', allPhotos:'Tất cả ảnh', all:'Tất cả',
    save:'Lưu', amountLbl:'Số tiền', thisMonthSrc:'Tháng này', toSpendU:'để tiêu', inviteMember2:'Mời thành viên', tellMore:'Kể thêm', tellMorePh:'Nói theo cách của bạn, không cần trau chuốt.', namePh:'Tên',
    savingPhoto:'Đang lưu ảnh…', suggestFootHome:'Ý tưởng hay góp ý? Chúng tôi luôn lắng nghe', deleteEventBtn:'Xoá sự kiện', logExpenseBtn:'Ghi khoản chi', addFundsTitle:'Góp quỹ', addMemoryTitle:'Thêm kỉ niệm'
  }
};
var EN_DEFAULT={welcomeTitle:'Welcome to',getStarted:'Get started',haveAccount:'I already have an account',continue:'Continue',continueGoogle:'Continue with Google',signingIn:'Signing in…',joinCta:'Join family',enterApp:'Enter FamilyHub',you:'You',categoryBudgetsHint:'Suggested from your total. Adjust anytime.',tabHome:'Home',tabMoney:'Finance',tabMoments:'Moments',tabSpending:'Spending',tabEvents:'Events',tabMemories:'Memories',morning:'Good morning',afternoon:'Good afternoon',evening:'Good evening',greetSub:"Here's how the family's money looks today.",recent:'Recent',activity:'Activity'};
function t(k){ if(LANG==='vi' && I18N.vi[k]!==undefined) return I18N.vi[k]; if(EN_DEFAULT[k]!==undefined) return EN_DEFAULT[k]; var el=document.querySelector('[data-t="'+k+'"]'); return el?el.getAttribute('data-en')||el.textContent:k; }
function applyLang(){
  document.querySelectorAll('[data-t]').forEach(function(el){
    var k=el.getAttribute('data-t');
    if(!el.getAttribute('data-en')) el.setAttribute('data-en', el.textContent);   // capture the original English once
    el.textContent = (LANG==='vi' && I18N.vi[k]!==undefined) ? I18N.vi[k] : el.getAttribute('data-en');
  });
  document.querySelectorAll('[data-tp]').forEach(function(el){
    var k=el.getAttribute('data-tp');
    if(!el.getAttribute('data-enp')) el.setAttribute('data-enp', el.getAttribute('placeholder')||'');
    el.setAttribute('placeholder', (LANG==='vi' && I18N.vi[k]!==undefined) ? I18N.vi[k] : el.getAttribute('data-enp'));
  });
  document.documentElement.lang = LANG==='vi'?'vi':'en';
  setGreeting();
}