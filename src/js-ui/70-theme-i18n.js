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
  var g=(h>=5&&h<12)?t('morning'):(h>=12&&h<18?t('afternoon'):t('evening'));   // before 5am the sky is night — greet accordingly
  // No time-of-day emoji here — the family sky below carries the weather, and a
  // sun/moon in the greeting only duplicated the moods a few pixels down.
  setTxt('greet',g+', '+firstName(FAM.user.name));
  // greet-sub is owned by renderHome now (it shows the family mood read); don't fight it here.
}

/* ---------- i18n (English · Tiếng Việt) ----------
   English is the source of truth and lives in EN_DEFAULT (the HTML literals are
   English too). I18N.vi holds the Vietnamese overrides. BOTH tables are kept
   complete — every key present in both — so a lookup never leaks the wrong
   language or a raw key. Vietnamese voice is warm & casual (family-texting
   register: "tụi mình", "bạn", soft particles), sentence case, full diacritics. */

/* Default language follows the device: a Vietnamese device opens in Vietnamese,
   everything else in English. localStorage 'fh-lang' (restored in onboard-boot)
   still overrides this once the user has made a choice. */
var LANG=(function(){
  try{
    var n=(navigator.language||navigator.userLanguage||navigator.languages&&navigator.languages[0]||'').toLowerCase();
    return n.indexOf('vi')===0 ? 'vi' : 'en';
  }catch(e){ return 'en'; }
})();

var EN_DEFAULT={
  /* onboarding */
  welcomeTitle:'Welcome to',
  tagPool:'One shared pool', tagPoolS:"See your family's money in one place — budgets and spending together.",
  tagGoals:'Goals & events', tagGoalsS:'Save toward trips, birthdays and the things that matter.',
  tagMem:'Memories together', tagMemS:'Turn everyday moments into a shared family album.',
  getStarted:'Get started', haveAccount:'I already have an account',
  localeTitle:'Language & currency', localeSub:'Choose how FamilyHub speaks and shows money.', langLabel:'Language', curLabel:'Currency',
  signinT:'Sign in to FamilyHub', signinS:'Sign in with Google — secure and quick.', continueGoogle:'Continue with Google', signingIn:'Signing in…',
  terms:'By continuing, you agree to our Terms & Privacy Policy.',
  familyTitle:'Your family', familySub:"Start a new family, or join one you've been invited to.",
  startFamily:'Start a new family', startFamilyS:"You'll name it and invite others", joinFamily:'Join a family', joinFamilyS:'Enter your family’s passcode',
  joinTitle:'Enter the family passcode', joinSub:'The owner adds your Google email to the invite list, then tells you the family’s 6-digit code.', joinCta:'Join family',
  pcTitle:'Set your family passcode', pcSub:'A 6-digit code, like the door code of your house. Members you invite will enter it to join, and it locks your money data so only your family can read it.', pcCode:'6-digit code', pcRepeat:'Repeat the code', pcWarn:'Encryption is on from the start (you can turn it off later in Settings). If the whole family forgets the code and no signed-in device remains, encrypted money data cannot be recovered. Not even by us.',
  profileTitle:'Set up your profile', profileSub:'This is how your family will see you.', yourName:'Your name', youAreThe:'You are the…', phObName:'e.g. Emma',
  setFamilyTitle:'Set up your family', setFamilySub:"Name it and invite who's in it.", familyName:'Family name', phFamName:'e.g. The Reeds', membersInvites:'Members & invites', inviteMember:'＋ Invite a member',
  budgetTitle:'Set your budget', budgetSub:'A monthly target for the family, then a budget per category.', monthlyBudget:'Monthly budget', categoryBudgets:'Category budgets', categoryBudgetsHint:'Suggested from your total. Adjust anytime.',
  themeTitle:'Pick your look', themeSub:"Choose a color theme for your family's hub. Change it anytime.",
  enterApp:'Enter FamilyHub', continue:'Continue', you:'You',
  doneTitle:"You're all set!", doneSub:'Welcome to FamilyHub.',
  /* tabs */
  tabHome:'Home', tabMoney:'Finance', tabMoments:'Moments',
  /* greeting */
  morning:'Good morning', afternoon:'Good afternoon', evening:'Good evening', greetSub:'Another day, together.',
  budgetBtn:'Budget',
  /* home feed */
  comingUp:'Coming up', recent:'Recent', memories:'Memories', seeAll:'See all',
  savedLbl:'Saved', spentLbl:'Spent', poolLbl:'Pool', latestPhotos:'Latest photos',
  txRecent:'Recent transactions', savingsGoals:'Savings goals', addGoal:'＋ Goal', rxRoom:'The living room',
  trend6:'6-month trend', vsBudget:'vs budget', trendLegend:"Dashed line = that month's budget",
  /* finance view */
  finHead:'Finance', finSub:"The family's spending, income and savings.", incomeLbl:'In', outLbl:'Out',
  /* moments view */
  momentsTitle:'Moments', momentsSub:"The family's plans, memories and album.", recentMemories:'Timeline', addPhotos:'Add photos',
  /* shared buttons */
  cancel:'Cancel', save:'Save', add:'Add', done:'Done', create:'Create', send:'Send', back:'Back', close:'Close',
  setWhatsNew:"What's new", whatsNewTitle:"What's new", whatsNewSub:"The latest updates for your family.",
  whatsNewAsk:"Wish it did something more? Tell us.", whatsNewCur:"You're on version",
  /* add sheet */
  addSheetTitle:'Add something', addSheetSub:'Log money, or save a moment.', grpFinance:'Finance', grpMoments:'Moments',
  qaExpenseT:'Log an expense', qaExpenseS:'Money you just spent',
  qaIncomeT:'Log income', qaIncomeS:'Money coming into the family',
  qaSaveT:'Add to savings', qaSaveS:'Add to the family pool',
  qaGoalT:'Create a goal', qaGoalS:'Save for something you want to buy or do',
  qaPlanT:'Plan something', qaPlanS:'An upcoming family occasion',
  qaPhotoT:'Add a moment', qaPhotoS:'Family photos',
  qaSuggestT:'Share feedback', qaSuggestS:'An idea or something you wish for',
  /* suggest modal */
  suggestTitle:'We hear you 💛', suggestSub:'An idea, a gripe, a feature you wish existed — tell us anything.',
  founderNote:"We're two parents building FamilyHub for families like yours. Your notes shape what we build next.",
  founderSig:'Mira & Sam, founders',
  sgTypeLbl:"What's on your mind", sgIdea:'💡 An idea', sgLove:'💛 Something I love', sgIssue:"🐞 Something's off",
  tellMore:'Tell us more', tellMorePh:'Say it however it comes. No need to be polished.',
  suggestFootHome:"Ideas or gripes? We're always listening",
  /* expense modal */
  expenseTitle:'Log an expense', exWhatFor:'What for?', phExNote:'e.g. Grocery run',
  amountLbl:'Amount', whenLbl:'When', whoPaidLbl:'Who paid', whoBoth:'Both',
  photosOptLbl:'Photos (optional)', addPhotosBtn:'📷 Add photos', deleteExpense:'Delete expense',
  /* event modal */
  eventTitle:'New event', evWhat:'What is it?', phEvName:'e.g. Beach trip', estCost:'Est. cost',
  coverFrom:'Cover the full cost from', srcSavings:'Savings', srcAvailable:'available',
  thisMonthSrc:'This month', toSpendU:'to spend', deleteEventBtn:'Delete event',
  /* photo assign modal */
  photoAssignTitle:'Add photos', clearBtn:'Clear',
  /* goal modal */
  goalTitle:'Savings goal', goalSub:'Set aside money for something you want to buy or do.',
  goalWhat:"What's this goal for?", phGoalName:'e.g. New laptop, Emergency fund', goalIcon:'Icon',
  goalNeed:'How much you need', goalWhen:'When (optional)', goalInit:'Add now (optional)',
  goalInitHint:'Taken from the family savings pool.',
  /* goal fund modal */
  goalFundTitle:'Add to goal', goalFundSub:'Move money into this goal from the shared savings pool.',
  /* event fund modal */
  addFundsTitle:'Add funds', fundSub:'Moved from your family savings into this event.',
  fundAvail:'available in savings', eventLbl:'Event', addedByLbl:'Added by', fundAll:'All',
  /* month sheet */
  monthTitle:'Choose month', monthSub:'See spending and budget for any month.',
  /* category picker sheet */
  catpickTitle:'Category', catpickSub:"Jump to another category's transactions.",
  /* budget modal */
  budgetModalTitle:'Categories & budget', budgetModalSub:'Your monthly target, plus the categories your spending is grouped into. Add, rename, re-budget or remove them.',
  monthlyBudgetOpt:"· fills in categories you haven't set", catsLbl:'Categories',
  budgetOver:'Categories add up to more than the monthly budget, so Others is at 0.', addCategory:'＋ Add category',
  /* memory modal */
  addMemoryTitle:'Add a memory', memorySub:'Save a photo from this event. Caption is optional.',
  photoLbl:'Photo', uploadPhotos:'📷 Upload photos', captionOpt:'Caption (optional)', phMemCap:'e.g. Best day of the trip',
  /* settings sheet */
  settingsTitle:'Settings', settingsSub:'Pick a theme. It applies across the whole app.',
  setSwitchFamily:'Switch family', inviteMember2:'Invite a member', setManageFamily:'Manage family & members', setEncryption:'Money encryption',
  setSavedEvents:'Saved for events', setIncome:'Income', setRestartOnboarding:'Restart onboarding', setSignOut:'Sign out',
  /* generic edit modal */
  fhModalEdit:'Edit',
  /* celebrate */
  celTitle:'Fully funded!', celSub:'You saved it all together.', celBtn:'Woohoo! 🙌',
  /* transactions overlay */
  txnTitle:'Transactions', phTxnSearch:'Search by name, category, person…', txnSortNewest:'Newest', txnHistory:'History', txActivity:'Activity',
  /* category detail */
  cdSpentThisMonth:'Spent this month', cdTransactions:'Transactions', logExpenseBtn:'Log expense',
  /* status & misc */
  savingPhoto:'Saving photo…', updating:'Updating…', offline:"Offline. Changes save here, sync when you're back",
  deletePhoto:'Delete photo', addPhotoLine:'📷 Add a photo', namePh:'Name',
  /* aria labels */
  ariaTheme:'Theme', ariaPrevMonth:'Previous month', ariaNextMonth:'Next month', ariaAdd:'Add', ariaPhoto:'Photo',
  ariaBack:'Back', ariaClose:'Close', ariaClearSearch:'Clear search',
  ariaRemoveCat:'Remove category', ariaRemovePhoto:'Remove photo', ariaRemove:'Remove'
};

var I18N={
  vi:{
    /* onboarding */
    welcomeTitle:'Chào mừng đến với',
    tagPool:'Một ví chung của cả nhà', tagPoolS:'Tiền của cả nhà gom về một chỗ: ngân sách với chi tiêu, xem là thấy hết.',
    tagGoals:'Mục tiêu & sự kiện', tagGoalsS:'Để dành cho những chuyến đi, sinh nhật và những điều quan trọng.',
    tagMem:'Kỷ niệm cùng nhau', tagMemS:'Gom những khoảnh khắc thường ngày thành album của cả nhà.',
    getStarted:'Bắt đầu nào', haveAccount:'Mình đã có tài khoản rồi',
    localeTitle:'Ngôn ngữ & tiền tệ', localeSub:'Chọn ngôn ngữ và cách hiển thị tiền cho FamilyHub.', langLabel:'Ngôn ngữ', curLabel:'Tiền tệ',
    signinT:'Đăng nhập FamilyHub', signinS:'Đăng nhập bằng Google — an toàn, nhanh gọn.', continueGoogle:'Tiếp tục với Google', signingIn:'Đang đăng nhập…',
    terms:'Khi tiếp tục, bạn đồng ý với Điều khoản & Chính sách bảo mật.',
    familyTitle:'Gia đình của bạn', familySub:'Tạo gia đình mới, hoặc tham gia gia đình đã mời bạn.',
    startFamily:'Tạo gia đình mới', startFamilyS:'Bạn đặt tên rồi mời mọi người vào', joinFamily:'Tham gia gia đình', joinFamilyS:'Nhập mã gia đình',
    joinTitle:'Nhập mã gia đình', joinSub:'Chủ gia đình thêm email Google của bạn vào danh sách mời, rồi cho bạn mã 6 số.', joinCta:'Tham gia',
    pcTitle:'Đặt mã gia đình', pcSub:'Mã 6 số, như mã cửa nhà mình. Người thân bạn mời sẽ nhập mã này để vào, và mã cũng khóa dữ liệu tiền nong để chỉ gia đình bạn đọc được.', pcCode:'Mã 6 số', pcRepeat:'Nhập lại mã', pcWarn:'Mã hóa được bật ngay từ đầu (có thể tắt sau trong Cài đặt). Nếu cả nhà quên mã và không còn thiết bị nào đang đăng nhập, dữ liệu tiền đã mã hóa sẽ không thể khôi phục, kể cả chúng tôi.',
    profileTitle:'Thiết lập hồ sơ', profileSub:'Đây là cách cả nhà nhìn thấy bạn.', yourName:'Tên của bạn', youAreThe:'Bạn là…', phObName:'vd. Hân',
    setFamilyTitle:'Thiết lập gia đình', setFamilySub:'Đặt tên và mời mọi người vào nhà.', familyName:'Tên gia đình', phFamName:'vd. Nhà mình', membersInvites:'Thành viên & lời mời', inviteMember:'＋ Mời thành viên',
    budgetTitle:'Đặt ngân sách', budgetSub:'Mục tiêu hằng tháng của cả nhà, rồi ngân sách cho từng danh mục.', monthlyBudget:'Ngân sách hằng tháng', categoryBudgets:'Ngân sách theo danh mục', categoryBudgetsHint:'Tụi mình gợi ý sẵn từ tổng ngân sách, bạn chỉnh lúc nào cũng được.',
    themeTitle:'Chọn giao diện', themeSub:'Chọn màu chủ đề cho nhà mình, đổi lúc nào cũng được.',
    enterApp:'Vào FamilyHub', continue:'Tiếp tục', you:'Bạn',
    doneTitle:'Xong hết rồi!', doneSub:'Chào mừng bạn đến với FamilyHub.',
    /* tabs */
    tabHome:'Nhà', tabMoney:'Tài chính', tabMoments:'Khoảnh khắc',
    /* greeting */
    morning:'Chào buổi sáng', afternoon:'Chào buổi chiều', evening:'Chào buổi tối', greetSub:'Một ngày nữa bên nhau.',
    budgetBtn:'Ngân sách',
    /* home feed */
    comingUp:'Sắp tới', recent:'Gần đây', memories:'Kỷ niệm', seeAll:'Xem tất cả',
    savedLbl:'Đã để dành', spentLbl:'Đã chi', poolLbl:'Quỹ', latestPhotos:'Ảnh mới nhất',
    txRecent:'Giao dịch gần đây', savingsGoals:'Mục tiêu tiết kiệm', addGoal:'＋ Mục tiêu', rxRoom:'Phòng khách',
    trend6:'Xu hướng 6 tháng', vsBudget:'so với ngân sách', trendLegend:'Đường nét đứt là ngân sách của tháng đó',
    /* finance view */
    finHead:'Tài chính', finSub:'Chi tiêu, thu nhập và tiết kiệm của cả nhà.', incomeLbl:'Thu', outLbl:'Chi',
    /* moments view */
    momentsTitle:'Khoảnh khắc', momentsSub:'Dự định, kỷ niệm và album của cả nhà.', recentMemories:'Dòng thời gian', addPhotos:'Thêm ảnh',
    /* shared buttons */
    cancel:'Huỷ', save:'Lưu', add:'Thêm', done:'Xong', create:'Tạo', send:'Gửi', back:'Quay lại', close:'Đóng',
    setWhatsNew:'Có gì mới', whatsNewTitle:'Có gì mới', whatsNewSub:'Những cập nhật mới nhất cho nhà bạn.',
    whatsNewAsk:'Mong app có thêm gì đó? Kể tụi mình nghe.', whatsNewCur:'Bạn đang dùng phiên bản',
    /* add sheet */
    addSheetTitle:'Thêm mới', addSheetSub:'Ghi lại tiền bạc, hoặc lưu một khoảnh khắc.', grpFinance:'Tài chính', grpMoments:'Khoảnh khắc',
    qaExpenseT:'Ghi khoản chi', qaExpenseS:'Khoản tiền vừa chi',
    qaIncomeT:'Ghi thu nhập', qaIncomeS:'Tiền vào của gia đình',
    qaSaveT:'Bỏ ống tiết kiệm', qaSaveS:'Thêm vào quỹ chung của nhà',
    qaGoalT:'Tạo mục tiêu', qaGoalS:'Để dành cho điều bạn muốn mua hoặc làm',
    qaPlanT:'Lên kế hoạch', qaPlanS:'Một dịp sắp tới của cả nhà',
    qaPhotoT:'Thêm khoảnh khắc', qaPhotoS:'Ảnh của gia đình',
    qaSuggestT:'Góp ý', qaSuggestS:'Một ý tưởng hay điều bạn mong muốn',
    /* suggest modal */
    suggestTitle:'Tụi mình nghe bạn nè 💛', suggestSub:'Một ý tưởng, một điều chưa ưng, hay tính năng bạn ước có — kể tụi mình nghe hết nha.',
    founderNote:'Tụi mình cũng là cha mẹ, làm FamilyHub cho những gia đình như nhà bạn. Góp ý của bạn giúp tụi mình biết nên làm gì tiếp theo.',
    founderSig:'Mira & Sam, người sáng lập',
    sgTypeLbl:'Bạn đang nghĩ gì', sgIdea:'💡 Một ý tưởng', sgLove:'💛 Điều mình thích', sgIssue:'🐞 Có gì đó chưa ổn',
    tellMore:'Kể thêm nha', tellMorePh:'Nói theo cách của bạn thôi, không cần trau chuốt đâu.',
    suggestFootHome:'Có ý tưởng hay muốn góp ý? Kể tụi mình nghe nha 💛',
    /* expense modal */
    expenseTitle:'Ghi một khoản chi', exWhatFor:'Chi cho gì?', phExNote:'vd. Đi chợ',
    amountLbl:'Số tiền', whenLbl:'Khi nào', whoPaidLbl:'Ai trả', whoBoth:'Cả hai',
    photosOptLbl:'Ảnh (tuỳ chọn)', addPhotosBtn:'📷 Thêm ảnh', deleteExpense:'Xoá khoản chi',
    /* event modal */
    eventTitle:'Sự kiện mới', evWhat:'Sự kiện gì?', phEvName:'vd. Đi biển', estCost:'Chi phí dự kiến',
    coverFrom:'Lấy trọn chi phí từ', srcSavings:'Tiết kiệm', srcAvailable:'đang có',
    thisMonthSrc:'Tháng này', toSpendU:'để tiêu', deleteEventBtn:'Xoá sự kiện',
    /* photo assign modal */
    photoAssignTitle:'Thêm ảnh', clearBtn:'Bỏ chọn',
    /* goal modal */
    goalTitle:'Mục tiêu tiết kiệm', goalSub:'Để dành tiền cho điều bạn muốn mua hoặc làm.',
    goalWhat:'Mục tiêu này để làm gì?', phGoalName:'vd. Laptop mới, Quỹ khẩn cấp', goalIcon:'Biểu tượng',
    goalNeed:'Cần bao nhiêu', goalWhen:'Khi nào (tuỳ chọn)', goalInit:'Bỏ ống ngay (tuỳ chọn)',
    goalInitHint:'Lấy từ quỹ tiết kiệm chung của cả nhà.',
    /* goal fund modal */
    goalFundTitle:'Bỏ ống cho mục tiêu', goalFundSub:'Thêm tiền vào mục tiêu, lấy từ quỹ tiết kiệm chung.',
    /* event fund modal */
    addFundsTitle:'Góp quỹ', fundSub:'Chuyển từ quỹ tiết kiệm của nhà vào sự kiện này.',
    fundAvail:'đang có trong quỹ tiết kiệm', eventLbl:'Sự kiện', addedByLbl:'Người thêm', fundAll:'Tất cả',
    /* month sheet */
    monthTitle:'Chọn tháng', monthSub:'Xem chi tiêu và ngân sách của bất kỳ tháng nào.',
    /* category picker sheet */
    catpickTitle:'Danh mục', catpickSub:'Xem giao dịch của danh mục khác.',
    /* budget modal */
    budgetModalTitle:'Danh mục & ngân sách', budgetModalSub:'Mục tiêu hằng tháng, cùng các danh mục gom chi tiêu của bạn. Thêm, đổi tên, chỉnh ngân sách hoặc xoá thoải mái.',
    monthlyBudgetOpt:'· tự điền cho các danh mục bạn chưa đặt', catsLbl:'Danh mục',
    budgetOver:'Các danh mục cộng lại vượt quá ngân sách tháng, nên mục Khác đang là 0.', addCategory:'＋ Thêm danh mục',
    /* memory modal */
    addMemoryTitle:'Thêm kỷ niệm', memorySub:'Lưu một tấm ảnh từ sự kiện này. Chú thích tuỳ bạn thôi.',
    photoLbl:'Ảnh', uploadPhotos:'📷 Tải ảnh lên', captionOpt:'Chú thích (tuỳ chọn)', phMemCap:'vd. Ngày vui nhất chuyến đi',
    /* settings sheet */
    settingsTitle:'Cài đặt', settingsSub:'Chọn giao diện, áp dụng cho cả ứng dụng.',
    setSwitchFamily:'Đổi gia đình', inviteMember2:'Mời thành viên', setManageFamily:'Quản lý gia đình & thành viên', setEncryption:'Mã hóa tài chính',
    setSavedEvents:'Quỹ cho sự kiện', setIncome:'Thu nhập', setRestartOnboarding:'Chạy lại phần giới thiệu', setSignOut:'Đăng xuất',
    /* generic edit modal */
    fhModalEdit:'Chỉnh sửa',
    /* celebrate */
    celTitle:'Đủ tiền rồi!', celSub:'Cả nhà để dành đủ rồi đó.', celBtn:'Tuyệt vời! 🙌',
    /* transactions overlay */
    txnTitle:'Giao dịch', phTxnSearch:'Tìm theo tên, danh mục, người…', txnSortNewest:'Mới nhất', txnHistory:'Lịch sử', txActivity:'Hoạt động',
    /* category detail */
    cdSpentThisMonth:'Đã chi tháng này', cdTransactions:'Giao dịch', logExpenseBtn:'Ghi khoản chi',
    /* status & misc */
    savingPhoto:'Đang lưu ảnh…', updating:'Đang cập nhật…', offline:'Đang ngoại tuyến. Thay đổi vẫn lưu ở đây, có mạng lại là tự đồng bộ.',
    deletePhoto:'Xoá ảnh', addPhotoLine:'📷 Thêm ảnh', namePh:'Tên',
    /* aria labels */
    ariaTheme:'Giao diện', ariaPrevMonth:'Tháng trước', ariaNextMonth:'Tháng sau', ariaAdd:'Thêm', ariaPhoto:'Ảnh',
    ariaBack:'Quay lại', ariaClose:'Đóng', ariaClearSearch:'Xoá tìm kiếm',
    ariaRemoveCat:'Xoá danh mục', ariaRemovePhoto:'Xoá ảnh', ariaRemove:'Xoá'
  }
};

function t(k){ if(LANG==='vi' && I18N.vi[k]!==undefined) return I18N.vi[k]; if(EN_DEFAULT[k]!==undefined) return EN_DEFAULT[k]; var el=document.querySelector('[data-t="'+k+'"]'); return el?el.getAttribute('data-en')||el.textContent:k; }
function applyLang(){
  document.querySelectorAll('[data-t]').forEach(function(el){
    var k=el.getAttribute('data-t');
    if(!el.getAttribute('data-en')) el.setAttribute('data-en', el.textContent);   // capture the original English once
    el.textContent = (LANG==='vi' && I18N.vi[k]!==undefined) ? I18N.vi[k] : (EN_DEFAULT[k]!==undefined ? EN_DEFAULT[k] : el.getAttribute('data-en'));
  });
  document.querySelectorAll('[data-tp]').forEach(function(el){
    var k=el.getAttribute('data-tp');
    if(!el.getAttribute('data-enp')) el.setAttribute('data-enp', el.getAttribute('placeholder')||'');
    el.setAttribute('placeholder', (LANG==='vi' && I18N.vi[k]!==undefined) ? I18N.vi[k] : (EN_DEFAULT[k]!==undefined ? EN_DEFAULT[k] : el.getAttribute('data-enp')));
  });
  document.querySelectorAll('[data-ta]').forEach(function(el){
    var k=el.getAttribute('data-ta');
    if(!el.getAttribute('data-ena')) el.setAttribute('data-ena', el.getAttribute('aria-label')||'');
    el.setAttribute('aria-label', (LANG==='vi' && I18N.vi[k]!==undefined) ? I18N.vi[k] : (EN_DEFAULT[k]!==undefined ? EN_DEFAULT[k] : el.getAttribute('data-ena')));
  });
  document.documentElement.lang = LANG==='vi'?'vi':'en';
  setGreeting();
}