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

/* ---------- theme ---------- */
/* The picker is still here, and still works. What changed is that it now says
   out loud where it is going: Sage becomes the single theme, because Sage is the
   one the rest of the app is actually tuned against.

   THREE THINGS THIS SCREEN HAS TO DO, in the order someone reads them:
     1. Say the picker is going away, before they invest a tap in it.
     2. Let them pick anyway. Taking the control away the same day we announce
        it would make the announcement pointless and the change feel done TO
        them rather than told to them.
     3. If they are on a non-Sage colour, own the actual reason honestly: the
        other components were never finished for it, so parts of the app look
        unpolished in their colour. That is our unfinished work, not their bad
        taste, and it is the real reason Sage is winning.

   The apology and the "keep mine" route are CONDITIONAL on being off Sage. To a
   Sage user none of it applies, and an apology for a problem they do not have
   is just noise. buildThemeChoices re-runs on every pick, so the notes appear
   and disappear live as someone tries colours. */
var THEMES=[
  {k:'sage',name:'Sage',grad:'linear-gradient(150deg,#4CB584,#2E9E6B 52%,#8FC97E)',bar:'#2E9E6B'},
  {k:'ocean',name:'Ocean',grad:'linear-gradient(150deg,#2AA9E0,#1E74D0 52%,#4FC2C9)',bar:'#1E74D0'},
  {k:'lavender',name:'Lavender',grad:'linear-gradient(150deg,#9270E8,#7A5AE0 50%,#B98BE0)',bar:'#7A5AE0'},
  {k:'blossom',name:'Blossom',grad:'linear-gradient(150deg,#F07898,#E0567F 50%,#D98AB0)',bar:'#E0567F'},
  {k:'twilight',name:'Twilight',grad:'linear-gradient(150deg,#4A54C4,#3B3F86 55%,#6A5FC0)',bar:'#3B3F86'}
];
var curTheme='sage';
function applyTheme(k){
  if(!THEMES.some(function(t){return t.k===k;}))return;      // unknown value: keep what we have
  curTheme=k;
  var el=document.getElementById('phone'); if(el) el.className='phone t-'+k;
  var t=THEMES.filter(function(x){return x.k===k;})[0];
  var mt=document.querySelector('meta[name=theme-color]'); if(mt&&t)mt.setAttribute('content',t.bar);
  try{ localStorage.setItem('fh-theme',k); }catch(e){}
  buildThemeChoices();
}
function _themeName(k){ var t=THEMES.filter(function(x){return x.k===k;})[0]; return t?t.name:k; }

function buildThemeChoices(){
  var note=document.getElementById('theme-note');
  if(note) note.textContent=L(
    'Sắp tới tụi mình sẽ bỏ phần chọn giao diện. Cả nhà sẽ dùng chung màu Sage, vì đây là màu ăn ý nhất với mọi phần còn lại của app.',
    'We’re retiring theme choice soon. Everyone moves to Sage, because Sage is the colour the rest of the app is tuned for.');

  var box=document.getElementById('theme-grid');
  if(box) box.innerHTML=THEMES.map(function(t){
    /* A real <button>, not the <div> this used to be: iOS Safari does not fire
       click on a bare div (CLAUDE.md §3), and this control has no business
       depending on a cursor:pointer rule to work on a phone. */
    return '<button type="button" class="theme-opt'+(t.k===curTheme?' on':'')+'" onclick="applyTheme(\''+t.k+'\')">'
      +'<div class="sw" style="background:'+t.grad+'"><div class="chk"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#191022" stroke-width="3.2"><path d="M5 12l5 5L20 7"/></svg></div></div>'
      +'<div class="nm">'+t.name+'</div></button>';
  }).join('');

  var keep=document.getElementById('theme-keep'); if(!keep) return;
  if(curTheme==='sage'){ keep.style.display='none'; keep.innerHTML=''; return; }
  var nm=_themeName(curTheme);
  keep.style.display='';
  keep.innerHTML='<div class="tk-txt">'+esc(L(
      'Bạn đang dùng '+nm+'. Thú thật là tụi mình chưa phối xong màu này cho những phần khác của app, nên vài chỗ nhìn chưa được đẹp. Tụi mình sẽ làm tiếp.',
      'You’re on '+nm+'. Honestly, we haven’t finished tuning the rest of the app for it, so a few places don’t look their best yet. We’re still working on it.'))+'</div>'
    +'<button type="button" class="tk-btn" onclick="fhThemeKeep()">'+esc(L(
      'Mình muốn giữ màu này', 'I’d like to keep this colour'))+'</button>';
}

/* "Keep my colour" opens Góp ý with the note already written, naming their
   theme. Asking someone to argue for their own colour from a blank textarea is
   how you get no replies and no idea which colours people actually care about;
   this way the tap IS the answer, and anything they add on top is a bonus. */
window.fhThemeKeep=function(){
  var nm=_themeName(curTheme);
  var msg=L('Mình muốn giữ giao diện '+nm+'. ', 'I’d like to keep the '+nm+' theme. ');
  try{ if(typeof closeSheet==='function') closeSheet(); }catch(e){}
  try{ openSheet('sheet-suggest'); }catch(e){ return; }
  // openSheet clears sg-msg and resets the chips, so fill in AFTER it has run.
  setTimeout(function(){
    try{
      if(typeof selectChipByVal==='function') selectChipByVal('sg-type','Idea');
      var ta=document.getElementById('sg-msg');
      if(ta){ ta.value=msg; ta.focus(); ta.setSelectionRange(msg.length,msg.length); }
    }catch(e){}
  },0);
};
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
  /* onboarding — curated 2-step flow: intro + sign-in → your family */
  introTitle:'One home for the family’s money',
  sellPrivT:'Truly private', sellPrivS:'End-to-end encrypted, so only your family can read it. Even we can’t look.',
  sellAutoT:'Effortless', sellAutoS:'Transactions log themselves. Nobody has to type them in.',
  continueGoogle:'Continue with Google', signingIn:'Signing in…',
  terms:'By continuing, you agree to our',
  termsLink:'Privacy Policy',
  setPrivacy:'Privacy',
  startTitle:'Your family', startSubNew:'Name your home and you’re in.',
  inviteForYou:'Your invite', joinCta:'Join family', orCreate:'or start your own',
  familyName:'Family name', phFamName:'e.g. The Reeds', createFamilyCta:'Create family',
  ariaCode:'6-digit family passcode',
  monthlyBudget:'Monthly budget',
  /* tabs */
  tabHome:'Home', tabMoney:'Family', tabMoments:'Moments',
  /* greeting */
  morning:'Good morning', afternoon:'Good afternoon', evening:'Good evening', greetSub:'Another day, together.',
  budgetBtn:'Budget',
  /* home feed */
  comingUp:'Coming up', recent:'Recent', memories:'Memories', seeAll:'See all',
  savedLbl:'Saved', spentLbl:'Spent', poolLbl:'Pool', latestPhotos:'Latest photos',
  txRecent:'Recent transactions', savingsGoals:'Savings goals', addGoal:'＋ Goal', rxRoom:'Family activity',
  trend6:'6-month trend', vsBudget:'vs budget', trendLegend:"Dashed line = that month's budget",
  /* finance view */
  finHead:'Family', finSub:"The family's spending, income and savings.", incomeLbl:'In', outLbl:'Out',
  leftThisMonth:'Left this month', savingsPot:'Savings',
  setupBudget:'Set up budget', viewExpenses:'View expenses',
  /* moments view */
  momentsTitle:'Moments', momentsSub:"The family's plans, memories and album.", recentMemories:'Timeline', addPhotos:'Add photos',
  /* shared buttons */
  cancel:'Cancel', save:'Save', add:'Add', done:'Done', create:'Create', send:'Send', back:'Back', close:'Close',
  setWhatsNew:"What's new", whatsNewTitle:"What's new", whatsNewSub:"The latest updates for your family.",
  whatsNewAsk:"Wish it did something more? Tell us.", whatsNewCur:"You're on version",
  /* add sheet */
  addSheetTitle:'Add something', addSheetSub:'Log money, or save a moment.', grpFinance:'Finance', grpMoments:'Moments',
  qaExpenseT:'Log a transaction', qaExpenseS:'Money in or out',
  qaIncomeT:'Log income', qaIncomeS:'Money coming into the family',
  qaSaveT:'Add to savings', qaSaveS:'Add to the family pool',
  qaGoalT:'Create a goal', qaGoalS:'Save for something you want to buy or do',
  qaPlanT:'Plan something', qaPlanS:'An upcoming family occasion',
  qaPhotoT:'Add a moment', qaPhotoS:'Family photos',
  qaSuggestT:'Share feedback', qaSuggestS:'An idea or something you wish for',
  qaCsvT:'Import from file', qaCsvS:'Bring in a CSV from your bank or another app',
  /* csv import modal */
  csvModalTitle:'Import from file', csvEmptyT:'Bring your history along', csvEmptyS:'A CSV or Excel file from your bank or your old expense app — we\'ll read it, sort it, and you check before anything\'s added.', csvChoose:'Choose a file', csvHint:'CSV or Excel (.xlsx) · Vietcombank · MB Bank · Money Lover · Misa', csvPickAgain:'Choose a different file', csvSave:'Import',
  /* suggest modal */
  suggestTitle:'We hear you 💛', suggestSub:'An idea, a gripe, a feature you wish existed — tell us anything.',
  founderNote:'We read every note. Thanks for helping us make it better.',
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
  settingsTitle:'Settings',
  setAutoTxn:'Auto-log transactions', badgeNew:'New',
  setMyProfile:'My profile', setLanguage:'Language', setSwitchFamily:'Switch family', inviteMember2:'Invite a member', setManageFamily:'Manage family & members', setDevices:'Signed-in devices', setEncryption:'Money encryption', setMailbox:'Connect bank email', setReviewTxns:'Review transactions',
  setSavedEvents:'Saved for events', setIncome:'Income', setNotifications:'Notifications', setRestartOnboarding:'Restart onboarding', setSignOut:'Sign out',
  /* generic edit modal */
  fhModalEdit:'Edit',
  /* celebrate */
  celTitle:'Fully funded!', celSub:'You saved it all together.', celBtn:'Woohoo! 🙌',
  /* transactions overlay */
  txnTitle:'Transactions', phTxnSearch:'Search by name, category, person…', txnSortNewest:'Newest', txnHistory:'History', txActivity:'Activity',
  /* category detail */
  cdSpentThisMonth:'Spent this month', cdTransactions:'Transactions', logExpenseBtn:'Log expense',
  /* status & misc */
  savingPhoto:'Saving photo…', updating:'Updating…', offline:"Offline. Changes save here, sync when you're back", newVersion:'New version — tap to update', setInstall:'Add to Home Screen',
  deletePhoto:'Delete photo', addPhotoLine:'📷 Add a photo', namePh:'Name',
  /* aria labels */
  ariaTheme:'Theme', ariaPrevMonth:'Previous month', ariaNextMonth:'Next month', ariaAdd:'Add', ariaPhoto:'Photo',
  ariaBack:'Back', ariaClose:'Close', ariaClearSearch:'Clear search',
  ariaRemoveCat:'Remove category', ariaRemovePhoto:'Remove photo', ariaRemove:'Remove'
};

var I18N={
  vi:{
    /* onboarding — curated 2-step flow: intro + sign-in → your family */
    introTitle:'Một tổ ấm cho tiền nong của cả nhà',
    sellPrivT:'Riêng tư tuyệt đối', sellPrivS:'Mã hóa đầu cuối, chỉ gia đình bạn đọc được. Tụi mình cũng không xem được.',
    sellAutoT:'Nhẹ tênh', sellAutoS:'Giao dịch tự vào sổ, cả nhà khỏi nhập tay từng khoản.',
    continueGoogle:'Tiếp tục với Google', signingIn:'Đang đăng nhập…',
    terms:'Khi tiếp tục, bạn đồng ý với',
    termsLink:'Chính sách quyền riêng tư',
    setPrivacy:'Quyền riêng tư',
    startTitle:'Nhà của bạn', startSubNew:'Đặt tên cho tổ ấm của mình để bắt đầu.',
    inviteForYou:'Lời mời cho bạn', joinCta:'Tham gia', orCreate:'hoặc tạo tổ ấm riêng',
    familyName:'Tên gia đình', phFamName:'vd. Nhà mình', createFamilyCta:'Tạo gia đình',
    ariaCode:'Mã gia đình 6 số',
    monthlyBudget:'Ngân sách hằng tháng',
    /* tabs */
    tabHome:'Nhà', tabMoney:'Gia đình', tabMoments:'Khoảnh khắc',
    /* greeting */
    morning:'Chào buổi sáng', afternoon:'Chào buổi chiều', evening:'Chào buổi tối', greetSub:'Một ngày nữa bên nhau.',
    budgetBtn:'Ngân sách',
    /* home feed */
    comingUp:'Sắp tới', recent:'Gần đây', memories:'Kỷ niệm', seeAll:'Xem tất cả',
    savedLbl:'Đã để dành', spentLbl:'Đã chi', poolLbl:'Quỹ', latestPhotos:'Ảnh mới nhất',
    txRecent:'Giao dịch gần đây', savingsGoals:'Mục tiêu tiết kiệm', addGoal:'＋ Mục tiêu', rxRoom:'Hoạt động gia đình',
    trend6:'Xu hướng 6 tháng', vsBudget:'so với ngân sách', trendLegend:'Đường nét đứt là ngân sách của tháng đó',
    /* finance view */
    finHead:'Gia đình', finSub:'Chi tiêu, thu nhập và tiết kiệm của cả nhà.', incomeLbl:'Thu', outLbl:'Chi',
    leftThisMonth:'Còn lại tháng này', savingsPot:'Tích lũy',
    setupBudget:'Lập ngân sách', viewExpenses:'Xem chi tiêu',
    /* moments view */
    momentsTitle:'Khoảnh khắc', momentsSub:'Dự định, kỷ niệm và album của cả nhà.', recentMemories:'Dòng thời gian', addPhotos:'Thêm ảnh',
    /* shared buttons */
    cancel:'Huỷ', save:'Lưu', add:'Thêm', done:'Xong', create:'Tạo', send:'Gửi', back:'Quay lại', close:'Đóng',
    setWhatsNew:'Có gì mới', whatsNewTitle:'Có gì mới', whatsNewSub:'Những cập nhật mới nhất cho nhà bạn.',
    whatsNewAsk:'Mong app có thêm gì đó? Kể tụi mình nghe.', whatsNewCur:'Bạn đang dùng phiên bản',
    /* add sheet */
    addSheetTitle:'Thêm mới', addSheetSub:'Ghi lại tiền bạc, hoặc lưu một khoảnh khắc.', grpFinance:'Tài chính', grpMoments:'Khoảnh khắc',
    qaExpenseT:'Ghi giao dịch', qaExpenseS:'Tiền vào hoặc ra',
    qaIncomeT:'Ghi thu nhập', qaIncomeS:'Tiền vào của gia đình',
    qaSaveT:'Bỏ ống tiết kiệm', qaSaveS:'Thêm vào quỹ chung của nhà',
    qaGoalT:'Tạo mục tiêu', qaGoalS:'Để dành cho điều bạn muốn mua hoặc làm',
    qaPlanT:'Lên kế hoạch', qaPlanS:'Một dịp sắp tới của cả nhà',
    qaPhotoT:'Thêm khoảnh khắc', qaPhotoS:'Ảnh của gia đình',
    qaSuggestT:'Góp ý', qaSuggestS:'Một ý tưởng hay điều bạn mong muốn',
    qaCsvT:'Nhập từ file', qaCsvS:'Đưa dữ liệu CSV từ ngân hàng hoặc app khác vào',
    /* csv import modal */
    csvModalTitle:'Nhập từ file', csvEmptyT:'Mang cả lịch sử chi tiêu theo nhé', csvEmptyS:'File CSV hoặc Excel từ ngân hàng hay app chi tiêu cũ — tụi mình đọc và tự xếp, bạn xem lại rồi mới nhập.', csvChoose:'Chọn file', csvHint:'File CSV hoặc Excel (.xlsx) · Vietcombank · MB Bank · Money Lover · Misa', csvPickAgain:'Chọn file khác', csvSave:'Nhập',
    /* suggest modal */
    suggestTitle:'Tụi mình nghe bạn nè 💛', suggestSub:'Một ý tưởng, một điều chưa ưng, hay tính năng bạn ước có — kể tụi mình nghe hết nha.',
    founderNote:'Tụi mình đọc hết mọi góp ý. Cảm ơn bạn đã giúp app tốt hơn nha.',
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
    settingsTitle:'Cài đặt',
    setAutoTxn:'Tự động ghi giao dịch', badgeNew:'Mới',
    setMyProfile:'Hồ sơ của tôi', setLanguage:'Ngôn ngữ', setSwitchFamily:'Đổi gia đình', inviteMember2:'Mời thành viên', setManageFamily:'Quản lý gia đình & thành viên', setDevices:'Thiết bị đăng nhập', setEncryption:'Mã hóa tài chính', setMailbox:'Kết nối email ngân hàng', setReviewTxns:'Duyệt giao dịch',
    setSavedEvents:'Quỹ cho sự kiện', setIncome:'Thu nhập', setNotifications:'Thông báo', setRestartOnboarding:'Chạy lại phần giới thiệu', setSignOut:'Đăng xuất',
    /* generic edit modal */
    fhModalEdit:'Chỉnh sửa',
    /* celebrate */
    celTitle:'Đủ tiền rồi!', celSub:'Cả nhà để dành đủ rồi đó.', celBtn:'Tuyệt vời! 🙌',
    /* transactions overlay */
    txnTitle:'Giao dịch', phTxnSearch:'Tìm theo tên, danh mục, người…', txnSortNewest:'Mới nhất', txnHistory:'Lịch sử', txActivity:'Hoạt động',
    /* category detail */
    cdSpentThisMonth:'Đã chi tháng này', cdTransactions:'Giao dịch', logExpenseBtn:'Ghi khoản chi',
    /* status & misc */
    savingPhoto:'Đang lưu ảnh…', updating:'Đang cập nhật…', offline:'Đang ngoại tuyến. Thay đổi vẫn lưu ở đây, có mạng lại là tự đồng bộ.', newVersion:'Có bản mới — chạm để cập nhật', setInstall:'Thêm vào màn hình chính',
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