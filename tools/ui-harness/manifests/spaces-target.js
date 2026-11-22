/* Target pictures for Spaces (Nhóm), release 1: stage 2 of docs/WORKFLOW.md.
   Brief: docs/briefs/spaces.md. Spec: docs/specs/spaces-spec.md.

   Every shot opens a real surface and injects the TARGET state with the app's own
   classes and L('vi','en'). None of this is product code; the built manifest
   (spaces.js) reuses these shot names. All names, amounts and the invite link are
   made up.

   The space screens are fed through the app's real space state (fhSpacesData()),
   so the balances, the pay-whom list and the settle sheet are computed by the
   shipping functions, not typed in. */
const H = `
try{ if(window._closeOv) _closeOv(); var _pk=document.getElementById('peek'); if(_pk) _pk.classList.remove('on'); var _ts=document.getElementById('toast'); if(_ts) _ts.classList.remove('on'); }catch(e){}
try{ window.scrollTo(0,0); var _sc=document.getElementById('scroll'); if(_sc) _sc.scrollTop=0; var _ph=document.querySelector('.phone'); if(_ph) _ph.scrollTop=0; }catch(e){}
[].forEach.call(document.querySelectorAll('[data-mock]'), function(e){ e.remove(); });
[].forEach.call(document.querySelectorAll('[data-mock-hidden]'), function(e){ e.style.display=''; e.removeAttribute('data-mock-hidden'); });
if(!window.__tabs0){ window.__tabs0={}; ['t-home','t-spending'].forEach(function(id){ var s=document.querySelector('#'+id+' span'); if(s) __tabs0[id]=s.textContent; }); }
Object.keys(window.__tabs0).forEach(function(id){ var s=document.querySelector('#'+id+' span'); if(s) s.textContent=__tabs0[id]; });

window.__captured=false;
window.__CHEV='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6"><path d="M6 9l6 6 6-6"/></svg>';
window.__GO='<svg class="chev" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18l6-6-6-6"/></svg>';
window.__PPL='<circle cx="9" cy="8.5" r="3.2"/><path d="M3 19c0-3.2 2.7-5.2 6-5.2s6 2 6 5.2"/><circle cx="17" cy="9.5" r="2.4"/><path d="M16.5 14c2.6.2 4.5 1.9 4.5 4.6"/>';
window.__hide=function(el){ if(el){ el.style.display='none'; el.setAttribute('data-mock-hidden','1'); } };
window.__mock=function(html){ var d=document.createElement('div'); d.setAttribute('data-mock','1'); d.innerHTML=html; return d; };
window.__settle=function(fn){
  setTimeout(function(){
    try{ if(document.activeElement && document.activeElement.blur) document.activeElement.blur(); }catch(e){}
    window.scrollTo(0,0); var ph=document.querySelector('.phone'); if(ph) ph.scrollTop=0;
    if(fn) fn();
  },420);
};

/* ── the made-up group, loaded into the app's real space state ─────────────── */
window.__SP='sp-ban-than';
window.__space=function(settled){
  var S=fhSpacesData(); S.uid=S.uid||'u-me';
  var M=[{id:'m1',userId:S.uid,name:'Minh'},{id:'m2',userId:'u2',name:'Lan'},{id:'m3',userId:'u3',name:'Khoa'},{id:'m4',userId:'u4',name:'Vy'}];
  var day=function(n){ var d=new Date(Date.now()-n*864e5); return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); };
  var T=[
    {id:'t1',date:day(0),amt:500, note:L('Lẩu cuối tuần','Weekend hotpot'),          emoji:'🍲', payer:'m1', who:['m1','m2','m3','m4']},
    {id:'t2',date:day(3),amt:1500,note:L('Thuê sân cầu lông tháng 11','Badminton court, November'), emoji:'🏸', payer:'m1', who:['m1','m2','m3','m4']},
    {id:'t3',date:day(6),amt:600, note:L('Vé xem phim','Movie tickets'),              emoji:'🎬', payer:'m2', who:['m1','m2','m3']},
    {id:'t4',date:day(9),amt:660, note:L('Quà sinh nhật Vy','Birthday gift for Vy'),   emoji:'🎁', payer:'m3', who:['m1','m2','m3']}
  ];
  if(window.__captured==='outsider') T.unshift({id:'t0',date:day(0),amt:930,note:L('Quán nướng','BBQ dinner'),emoji:'🍖',payer:'m1',who:['m1','m2','m3'],
    sub:L('Hoá đơn ','Bill ')+fmt(1240)+L(' · 1 phần ngoài nhóm',' · 1 share outside')});
  else if(window.__captured) T.unshift({id:'t0',date:day(0),amt:1240,note:L('Quán nướng','BBQ dinner'),emoji:'🍖',payer:'m1',who:['m1','m2','m3','m4']});
  var shares={};
  T.forEach(function(t){ var map={}, per=Math.round(t.amt/t.who.length*10)/10, acc=0;
    t.who.forEach(function(id,i){ var v=(i===t.who.length-1)?(t.amt-acc):per; map[id]=v; acc+=v; });
    shares[t.id]={payer:t.payer,rule:'equal',map:map}; });
  S.list=[{id:__SP,name:L('Hội bạn thân','Close friends'),type:'friend'}];
  S.keys[__SP]=S.keys[__SP]||{}; S.state='ready';
  S.data[__SP]={members:M,txns:T.map(function(t){ return {id:t.id,date:t.date,amt:t.amt,note:t.note,payer:t.payer,by:t.payer}; }),
    shares:shares,settles:[],cats:[{id:'c1',name:L('Ăn uống','Dining'),emoji:'🍜'},{id:'c2',name:L('Vui chơi','Fun'),emoji:'🎉'}],unreadable:0,at:Date.now()};
  if(settled){
    S.data[__SP].settles=fhSpacePairwise(__SP).map(function(p,i){ return {id:'s'+i,from:p.from.id,to:p.to.id,amt:p.amt,date:day(0)}; });
  }
  window.__T=T; window.__M=M;
  return S.data[__SP];
};
window.__name=function(id){ var m=__M.find(function(x){ return x.id===id; }); return m?m.name:'?'; };
window.__av=function(i,name){ return '<span class="dbt-av" style="background:var(--id-'+((i%6)+1)+')">'+name.charAt(0)+'</span>'; };
window.__inSpace=function(){
  var a=document.querySelector('#t-home span'), b=document.querySelector('#t-spending span');
  if(a) a.textContent=L('Nhóm','Space'); if(b) b.textContent=L('Chi tiêu','Spending');
};

/* the chip that names the space you are in, and opens the switcher */
window.__chip=function(){ return '<button class="ch-pill" type="button">🍜 '+L('Hội bạn thân','Close friends')+' '+__CHEV+'</button>'; };

/* balances card: the app's own rows, numbers from fhSpaceBalances / fhSpacePairwise */
window.__balances=function(){
  var bal=fhSpaceBalances(__SP), pairs=fhSpacePairwise(__SP);
  var h='<div class="dbt-sec">'+L('Số dư nhóm','Balances')+'</div><div class="dbt-card">';
  bal.forEach(function(b,i){
    var z=Math.abs(b.net)<0.5;
    h+='<div class="dbt-mb">'+__av(i,b.member.name)+'<span class="dbt-mbn">'+b.member.name+(b.member.id==='m1'?'<i class="dbt-you">'+L('bạn','you')+'</i>':'')+'</span>'
      +(z?'<span class="dbt-mbv num">':(b.net>0?'<span class="dbt-mbv num owed">':'<span class="dbt-mbv num owe">'))+(z?fmt(0):((b.net>0?'+':'−')+fmt(Math.abs(b.net))))+'</span></div>';
  });
  pairs.forEach(function(p){ h+='<div class="dbt-pair">'+p.from.name+' '+L('trả','pays')+' '+p.to.name+'<span class="num">'+fmt(p.amt)+'</span></div>'; });
  if(!pairs.length) h+='<div class="dbt-note">'+L('Không ai nợ ai. Nhóm đã cân bằng.','Nobody owes anybody. The space is square.')+'</div>';
  return h+'</div>';
};

/* a space expense as the ledger's own row: who paid, how it was split, my share */
window.__txRow=function(t){
  var mine=(fhSpacesData().data[__SP].shares[t.id].map||{})['m1']||0;
  var sub=t.sub || (__name(t.payer)+' '+L('trả','paid')+' · '+fmtDayMon(new Date(t.date)));
  return '<div class="row tap"><div class="r-ico-wrap"><div class="r-ico">'+t.emoji+'</div></div>'
    +'<div class="r-body"><div class="r-t">'+t.note+'</div><div class="r-s">'+sub+'</div></div>'
    +'<div class="r-right"><div class="r-amt num">'+fmt(t.amt)+'</div><div class="r-cat">'+L('chia ','split ')+t.who.length+' · '+L('bạn ','you ')+fmtK(mine)+'</div></div></div>';
};
window.__settleRow=function(s){
  return '<div class="row"><div class="r-ico-wrap"><div class="r-ico">✅</div></div>'
    +'<div class="r-body"><div class="r-t">'+__name(s.from)+' '+L('trả','paid')+' '+__name(s.to)+'</div><div class="r-s">'+L('Trả nợ · ','Settle-up · ')+fmtDayMon(new Date(s.date))+'</div></div>'
    +'<div class="r-right"><div class="r-amt num">'+fmt(s.amt)+'</div></div></div>';
};

/* the Nhóm section on Tài chính: every space, families included */
window.__spaceRow=function(o){
  var right = o.net ? '<div class="r-right"><div class="r-amt num"'+(o.net>0?' style="color:var(--good)"':'')+'>'+(o.net>0?'+':'')+fmt(Math.abs(o.net))+'</div><div class="r-cat">'+(o.net>0?L('nhóm nợ bạn','owed to you'):L('bạn nợ nhóm','you owe'))+'</div></div>'
                    : '<div class="r-right">'+__GO+'</div>';
  return '<div class="row tap"><div class="r-ico-wrap"><div class="r-ico">'+o.e+'</div></div>'
    +'<div class="r-body"><div class="r-t">'+o.t+'</div><div class="r-s">'+o.s+'</div></div>'+right+'</div>';
};
window.__section=function(rows, invite){
  return '<div class="section-h"><span class="tl"><span class="t">'+L('Nhóm','Spaces')+'</span></span>'
    +'<span class="acts"><a>'+L('＋ Tạo nhóm','＋ New space')+'</a></span></div>'
    +(invite||'')
    +'<div class="rows">'+rows.map(__spaceRow).join('')+'</div>';
};
window.__personal=function(rows, invite){
  go('personal');
  setTimeout(function(){
    var w=document.getElementById('pers-debts-wrap'); if(!w) return;
    w.parentNode.insertBefore(__mock(__section(rows, invite)), w);
    /* Tài sản stops talking about groups: they have their own section now */
    var s=w.querySelector('.dbt-empty-cta, .ec-btns'); if(s){ var bs=s.querySelectorAll('button'); if(bs[1]) __hide(bs[1]); }
    [].forEach.call(w.querySelectorAll('*'), function(e){ if(e.children.length===0 && /chia tiền nhóm/.test(e.textContent)) e.textContent=L('Thẻ tín dụng, cho vay, cùng một chỗ.','Credit cards and loans, in one place.'); });
    var sc=document.getElementById('scroll'), m=document.querySelector('[data-mock]');
    if(sc && m) sc.scrollTop=Math.max(0, m.offsetTop-130);
  },450);
};
window.__FAM=function(open){ return {e:'🏡', t:(window.FAM&&FAM.familyName)||'Nhà Minh', s:L('Gia đình · 3 thành viên','Family · 3 members')+(open?L(' · đang mở',' · open now'):'')}; };

/* profile switches, in the list-row + iOS-switch shape Settings already uses */
window.__switches=function(on){
  var R=[['split',L('Chia tiền','Splitting'),L('Ai trả, chia cho ai, ai nợ ai','Who paid, who shares, who owes')],
         ['moments',L('Kỷ niệm và ảnh','Moments and photos'),L('Ảnh trên khoản chi, dịp chung','Photos on expenses, shared occasions')],
         ['react',L('Cảm xúc','Reactions'),L('Thả cảm xúc lên khoản chi','React to an expense')],
         ['budget',L('Ngân sách chung','Shared budget'),L('Hạn mức tháng và số còn lại','A monthly limit and what is left')],
         ['goals',L('Mục tiêu tiết kiệm','Saving goals'),L('Cùng để dành cho một việc','Save together toward something')],
         ['ask',L('Đề xuất cần duyệt','Proposals'),L('Khoản lớn cần người khác đồng ý','Big spends need a second yes')],
         ['house',L('Ngôi nhà','The house'),L('Căn nhà và tâm trạng mỗi ngày','The house and daily moods')],
         ['source',L('Hiện nguồn tiền','Show money source'),L('Người khác thấy bạn trả bằng thẻ nào','Others see which card you paid with')]];
  return '<div class="rl-list">'+R.map(function(r){ var o=on.indexOf(r[0])>=0;
    return '<button type="button" class="rl-row" role="switch" aria-checked="'+(o?'true':'false')+'"><span class="rl-t"><b>'+r[1]+'</b><small>'+r[2]+'</small></span>'+(o?'<span class="cry-sw on"></span>':'<span class="cry-sw"></span>')+'</button>'; }).join('')+'</div>';
};
window.__presets=function(sel){
  return '<div class="choices">'+[['family','🏡 '+L('Gia đình','Family')],['friend','🍜 '+L('Bạn bè','Friends')],['other','✨ '+L('Khác','Other')]]
    .map(function(p){ return (p[0]===sel?'<button type="button" class="choice on">':'<button type="button" class="choice">')+p[1]+'</button>'; }).join('')+'</div>';
};
window.__sheet=function(inner){
  document.getElementById('fh-sheet-body').innerHTML=inner;
  document.getElementById('scrim').classList.add('on'); document.getElementById('fh-sheet').classList.add('on');
  __settle();
};

/* the space's money tab, budget off: total, balances, who pays whom, the rows */
window.__money=function(settled){
  __space(settled); go('spending'); __inSpace();
  setTimeout(function(){
    var v=document.getElementById('v-spending'), hdr=v.querySelector('.child-hdr');
    [].forEach.call(v.children, function(c){ if(c!==hdr && !c.classList.contains('safe') && !c.classList.contains('spacer')) __hide(c); });
    var row=hdr.querySelector('.ch-row'); __hide(row);
    hdr.appendChild(__mock('<div style="margin-bottom:12px">'+__chip()+'</div>'
      +'<div class="ch-row"><div><div class="ch-title">'+L('Chi tiêu','Spending')+'</div></div>'
      +'<button class="ch-pill" type="button"><span>'+((document.getElementById('sp-month')||{}).textContent||'')+'</span>'+__CHEV+'</button></div>'));
    var d=fhSpacesData().data[__SP], total=0, paid=0, share=0;
    d.txns.forEach(function(t){ total+=t.amt; if(t.payer==='m1') paid+=t.amt; share+=(d.shares[t.id].map['m1']||0); });
    var net=fhSpaceMyNet(__SP), z=Math.abs(net)<0.5;
    var h='<div class="cf-card"><div class="cf-lbl">'+L('Cả nhóm đã chi tháng này','The space spent this month')+'</div>'
      +'<div class="cf-big num">'+fmt(total)+'</div>'
      +'<div class="cf-tiles">'
      +'<div class="cf-tile"><span class="cf-tl">'+L('Bạn đã trả','You paid')+'</span><span class="cf-tv num">'+fmt(paid)+'</span></div>'
      +'<div class="cf-tile"><span class="cf-tl">'+L('Phần của bạn','Your share')+'</span><span class="cf-tv num">'+fmt(share)+'</span></div></div>'
      +'<div class="cf-note">'+(z?L('Đã cân bằng. Không ai nợ ai.','All square. Nobody owes anybody.')
          :(net>0?L('Nhóm đang nợ bạn ','The space owes you ')+fmt(net)+'.':L('Bạn đang nợ nhóm ','You owe the space ')+fmt(-net)+'.'))+'</div></div>';
    if(!z) h+='<div class="dbt-acts"><button class="dbt-btn primary" type="button">'+L('Ghi trả nợ','Record a settle-up')+'</button></div>';
    h+=__balances();
    h+='<div class="section-h"><span class="t">'+L('Khoản chung tháng này','Shared this month')+'</span></div>'
      +'<div class="rows">'+d.settles.map(__settleRow).join('')+__T.map(__txRow).join('')+'</div>';
    v.insertBefore(__mock(h), v.querySelector('.spacer'));
    if(settled) toast(L('Đã ghi trả nợ. Nhóm đã cân bằng.','Settle-up recorded. The space is square.'));
  },350);
};
`;

/* ── Release 2: a bank email lands in the review queue and is filed into a space ──
   The queue, its cards and its picker sheet are the app's own (csvBuildReview on
   made-up staged rows, the way tools/boot-harness/queue-perf.js seeds them). Only
   the rows that do not exist yet are swapped in. */
const C = `
try{ if(window.closePersonalTxDetail) closePersonalTxDetail(); }catch(e){}
window.__CH='<svg class="csv-schev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m9 6 6 6-6 6"/></svg>';
window.__q=function(drop){
  var at=function(h){ return new Date(Date.now()-h*3600e3).toISOString(); };
  var mk=function(i,prov,tail,amt,dir,cp,memo,hint,h,rt){ return { id:'stg-'+i, member_id:null, owner_user_id:'00000000-0000-4000-8000-000000000001', staging_scope:'personal', gmail_message_id:'gm'+i, source_provider:prov,
    occurred_at:at(h), amount:amt, currency:'VND', direction:dir, counterparty:cp, reference_number:'FT'+(1000000+i), transaction_type:'bank_txn',
    raw_extracted:{ v:2, amount:amt, currency:'VND', direction:dir, counterparty:cp, memo:memo, memo_display:memo, account_masked:'xxxx'+tail, flow:dir, _transport:'direct', reader_type:rt||'merchant', transaction_type:'bank_txn', category_hint:hint, memo_time:null, source_provider:prov },
    duplicate_of_id:null, resolved_before:false, sealed:null, eph_pub:null, nonce:null, enc_v:null, created_at:at(h) }; };
  var rows=[ mk(0,'VIB','5140',1240000,'debit','QUAN NUONG BA MIEN','Quan nuong Ba Mien','Ăn uống',1),
             mk(1,'Techcombank','8890',59000,'debit','CA PHE GOC PHO','Ca phe Goc Pho','Ăn uống',4),
             mk(2,'VIB','5140',320000,'credit','TRAN THI LAN','Lan tra tien cau long',null,7,'p2p'),
             mk(3,'MoMo','1217',85000,'debit','XE CONG NGHE','Xe cong nghe',null,9) ];
  if(drop) rows.shift();
  window.csvExpand=null; window.csvRowSheet=null;
  window.csvEntryScope = window.fhNormScope ? fhNormScope({ kind:'personal' }) : { kind:'personal' };
  window._fhStagedRows = rows; window._fhQueueNewAccts = []; window.csvStagedMode = true;
  try{ csvLearnLoad(); }catch(e){}
  var COLS=['occurred_at','description','amount','counterparty','category'], columnMap={};
  COLS.forEach(function(f,i){ columnMap[i]={ field:f, confidence:1 }; });
  var cells=rows.map(function(r){ var x=r.raw_extracted; return [r.occurred_at, x.memo_display||'', String(r.direction==='credit'?r.amount:-r.amount), r.counterparty||'', x.category_hint||'']; });
  csvBuildReview([{ name:'staged', rows:cells, parsed:{ headers:COLS, rows:cells }, result:{ columnMap:columnMap } }], {});
  renderCsvReview();
  var pick=document.getElementById('csv-pick'); if(pick) pick.style.display='none';
  var ttl=document.querySelector('#csv-import-modal .modal-title'); if(ttl) ttl.textContent=L('Duyệt giao dịch','Review transactions');
  openSheet('csv-import-modal');
};
/* scroll the queue's own scroller, never the page */
window.__qscroll=function(el,off){
  var sc=document.getElementById('csv-result');
  while(sc && sc!==document.body){ var cs=getComputedStyle(sc); if(/(auto|scroll)/.test(cs.overflowY) && sc.scrollHeight>sc.clientHeight+10) break; sc=sc.parentNode; }
  if(!sc || sc===document.body || !el) return;
  sc.scrollTop+=el.getBoundingClientRect().top-sc.getBoundingClientRect().top-(off||0);
};
window.__qtop=function(){
  var c=document.querySelector('#csv-result .bulk-check'); if(!c) return;
  __qscroll(c, 118);
};
window.__open=function(re, then){
  setTimeout(function(){
    var i=csvReview.ready.findIndex(function(c){ return re.test(c.description||''); });
    csvToggleExpand('ready', i<0?0:i);
    setTimeout(then, 340);
  },300);
};
/* one row of a card, in the card's own shape (csv-srow, and the quiet second line) */
window.__srow=function(lbl,val,o){ o=o||{};
  var sval='<span class="csv-sval"><b>'+val+'</b>'+(o.ro?'':__CH)+'</span>';
  var inner='<small>'+lbl+'</small>'+(o.by?'<span class="rl-col">'+sval+'<span class="rcr-by">'+o.by+'</span></span>':sval);
  if(o.ro) return (o.by?'<div class="csv-srow ro rl-has">':'<div class="csv-srow ro">')+inner+'</div>';
  return (o.by?'<button type="button" class="csv-srow rl-has">':'<button type="button" class="csv-srow">')+inner+'</button>';
};
window.__rowBy=function(root, re){ return [].filter.call(root.querySelectorAll('.csv-srow'), function(r){ var s=r.querySelector('small'); return s && re.test(s.textContent); })[0]; };
window.__swap=function(row, html){ if(!row) return; var t=document.createElement('div'); t.innerHTML=html; while(t.firstChild) row.parentNode.insertBefore(t.firstChild,row); row.remove(); };
window.__ch=function(label,on){ return (on?'<button type="button" class="choice on">':'<button type="button" class="choice">')+label+'</button>'; };
window.__cta=function(txt){ [].forEach.call(document.querySelectorAll('#csv-result button'), function(b){ if(/Nhập khoản này|Import this/.test(b.textContent)) b.textContent='✓ '+txt; }); };
window.__book=function(rowsHtml){
  go('personal');
  var t=((fhPersonalData().txns)||[]).filter(function(x){ return x.kind==='expense' && !x._unreadable; })[0];
  if(t) openPersonalTxDetail(t.id);
  setTimeout(function(){
    var b=document.getElementById('pexd-body'); if(!b) return;
    var q=function(c){ return b.querySelector(c); };
    if(q('.exd-ico')) q('.exd-ico').textContent='🍖';
    if(q('.exd-amt')) q('.exd-amt').textContent=fmt(1240);
    if(q('.exd-note')) q('.exd-note').textContent=L('Quán nướng','BBQ dinner');
    if(q('.exd-prov')) q('.exd-prov').textContent=L('Hôm nay','Today')+' · 19:42';
    __swap(__rowBy(b,/Ghi vào đâu|Where to/), __srow(L('Ghi vào đâu','Where to'), __SPN(), {ro:true}));
    __swap(__rowBy(b,/Loại khoản|Kind/), rowsHtml);
    __swap(__rowBy(b,/Tiêu vào gì|What it was/), __srow(L('Tiêu vào gì','What it was'), L('Nhà hàng','Restaurant'), {ro:true}));
    __swap(__rowBy(b,/Giờ|Time/), __srow(L('Giờ','Time'), '19:42', {ro:true}));
    __swap(__rowBy(b,/Nguồn tiền|Money source|Paid/), __srow(L('Nguồn tiền','Paid with'), 'VIB ••5140', {ro:true, by:L('Chỉ mình bạn thấy','Only you see this')}));
    var rc=__rowBy(b,/Định kỳ|Recurring/); if(rc) rc.style.display='none';
  },350);
};
window.__SPN=function(){ return '🍜 '+L('Hội bạn thân','Close friends'); };
/* the open card, after "Hội bạn thân" was picked */
window.__cardSpace=function(out){
  var rows=document.querySelector('#csv-result .csv-srows'); if(!rows) return;
  __swap(__rowBy(rows,/Ghi vào đâu|Where to/), __srow(L('Ghi vào đâu','Where to'), __SPN()));
  __swap(__rowBy(rows,/Loại khoản|Kind/),
     __srow(L('Ai trả','Who paid'), 'Minh · '+L('bạn','you'), {ro:true, by:L('Tiền đi từ VIB của bạn','It left your VIB account')})
    +__srow(L('Tính thế nào','How it counts'), out?L('Chia 4 phần','Split 4 ways'):L('Chia đều · 4 người','Split equally · 4 people'), {by:out?L('3 trong nhóm · 1 ngoài nhóm','3 in the space · 1 outside'):(L('Phần của bạn ','Your share ')+fmt(310))}));
  var rc=__rowBy(rows,/Định kỳ|Recurring/); if(rc) rc.style.display='none';
  rows.insertAdjacentHTML('afterend','<div class="csv-expand-note" style="margin-top:14px">'+(out
    ? L('Nhóm thấy ','The space sees ')+fmt(930)+L(' chia 3. Phần ngoài nhóm, ',' split 3 ways. The outside share, ')+fmt(310)+L(', ghi vào sổ của bạn là khoản cần thu.',', goes into your own book as money to collect.')
    : L('Cả nhóm thấy khoản này và phần của từng người. Thẻ VIB chỉ mình bạn thấy.','The whole space sees this expense and each share. Only you see the VIB card.'))+'</div>');
  __cta(L('Ghi vào Hội bạn thân','Save to Close friends'));
  __qscroll(document.querySelector('#csv-result .csv-srows'), 150);
};
`;

module.exports = {
  feature: 'spaces-target',
  langs: ['vi', 'en'],
  themes: ['sage'],
  shots: [
    { name: '01-whatsnew', settleMs: 900, setup: H + `
      openWhatsNew();
      setTimeout(function(){
        document.getElementById('whatsnew-list').insertAdjacentHTML('afterbegin',
          '<div class="wn-row" data-mock="1"><span class="wn-ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">'+__PPL+'</svg></span>'
          +'<div class="wn-txt"><div class="wn-t">'+L('Gia đình hay bạn bè, đều là một Nhóm','Family or friends, every group is a Space')+'</div>'
          +'<div class="wn-meta">'+fhReleaseMeta({date:'2026-12-05',time:'09:00',ver:'v640'})+'</div>'
          +'<p class="wn-desc">'+L('Gia đình hay nhóm bạn, giờ đều là một "Nhóm" trong Earthy: chọn những gì nhóm cần, mời bạn bằng một đường link, rồi ghi khoản chung hoặc chia đều cho từng người. Mọi nhóm của bạn nằm chung một chỗ trong Tài chính, kèm số bạn đang nợ hay được nợ.','Family or friends, every group is now a Space in Earthy: pick what the group needs, invite people with a link, then log shared expenses or split them between members. All your spaces sit in one place on the Finance tab, with what you owe or are owed.')+'</p></div></div>');
      },120);` },

    { name: '02-nhom-section', settleMs: 1300, setup: H + `
      __personal([ __FAM(true),
        {e:'🍜', t:L('Hội bạn thân','Close friends'), s:L('Bạn bè · 4 thành viên','Friends · 4 members'), net:1080},
        {e:'🏸', t:L('Cầu lông thứ 5','Thursday badminton'), s:L('Bạn bè · 6 thành viên','Friends · 6 members'), net:-150} ]);` },

    { name: '03-create', settleMs: 1100, setup: H + `
      fhSpaceCreateSheet();
      setTimeout(function(){
        document.getElementById('fh-modal-title').textContent=L('Nhóm mới','New space');
        document.getElementById('fh-modal-save').textContent=L('Tạo nhóm','Create');
        document.getElementById('fh-modal-body').innerHTML=
           '<div class="field"><label>'+L('Tên nhóm','Name')+'</label><input value="'+L('Hội bạn thân','Close friends')+'"></div>'
          +'<div class="field"><label>'+L('Nhóm này là','This space is')+'</label>'+__presets('friend')+'</div>'
          +'<div class="field"><label>'+L('Nhóm này dùng','This space uses')+'</label>'+__switches(['split','moments','react'])+'</div>'
          +'<div class="dbt-note">'+L('Bật tắt lại lúc nào cũng được. Tắt một mục chỉ ẩn nó đi, không xoá gì.','Change these any time. Switching one off only hides it. Nothing is deleted.')+'</div>';
      },200);` },

    { name: '04-invite', settleMs: 1200, setup: H + `
      __space(); fhSpaceInviteSheet(__SP);
      setTimeout(function(){
        document.getElementById('fh-modal-title').textContent=L('Mời vào nhóm','Invite to the space');
        document.getElementById('fh-modal-save').textContent=L('Xong','Done');
        var cv=fhQrCanvas('https://earthy.example/#fh-k=FH-7K2M-Q9XD-4TNB-HW6C&s=ban-than', 6, 4);
        cv.style.cssText='width:200px;height:200px;image-rendering:pixelated;border-radius:8px;display:block;margin:4px auto 12px';
        var b=document.getElementById('fh-modal-body');
        b.innerHTML='<div id="mock-qr"></div>'
          +'<div class="dbt-note" style="text-align:center;padding-top:0">'+L('Bạn bè quét mã hoặc mở link là vào nhóm, không phải gõ gì. Link mang theo mã khóa của nhóm, chỉ gửi cho người bạn mời.','Friends scan the code or open the link to join, with nothing to type. The link carries the space key, so send it only to people you invite.')+'</div>'
          +'<button type="button" class="fh-s-cta">'+L('Chia sẻ link mời','Share the invite link')+'</button>'
          +'<button type="button" class="fh-s-line">'+L('Sao chép link','Copy link')+'</button>'
          +'<div class="field" style="margin-top:22px"><label>'+L('Email Google của người được mời','Invitee Google email')+'</label><input inputmode="email" placeholder="ban@gmail.com"></div>'
          +'<div class="dbt-note" style="padding-left:0;padding-right:0">'+L('Chỉ email bạn thêm ở đây mới vào được nhóm.','Only the emails you add here can join.')+'</div>';
        document.getElementById('mock-qr').appendChild(cv);
      },200);` },

    { name: '05-invited', settleMs: 1300, setup: H + `
      __personal([ __FAM(true) ],
        '<section class="dbt-empty dbt-invite"><div class="dbt-empty-t"><b>Lan</b> '+L('mời bạn vào nhóm','invited you to')+' <b>'+L('Hội bạn thân','Close friends')+'</b>.</div>'
        +'<div class="dbt-empty-cta"><button type="button">'+L('Tham gia','Join')+'</button></div></section>');` },

    { name: '06-space-home', settleMs: 1300, setup: H + `
      __space(); go('home'); __inSpace();
      setTimeout(function(){
        var v=document.getElementById('v-home');
        __hide(document.getElementById('home-sky')); __hide(v.querySelector('.suggest-foot'));
        var body=document.getElementById('home-body');
        [].forEach.call(body.querySelectorAll('.hearth, .wgrid, .hgoals'), __hide);
        [].forEach.call(body.querySelectorAll('.section-h .t, .section-h'), function(e){ if(e.children.length===0 && /gia đình|Family/i.test(e.textContent)) e.textContent=L('Hoạt động','Activity'); });
        var net=fhSpaceMyNet(__SP), mine=fhSpacePairwise(__SP).filter(function(p){ return p.to.id==='m1' || p.from.id==='m1'; });
        var h='<div class="safe"></div><div class="child-hdr"><div class="ch-row"><div>'
          +'<div class="ch-title">'+L('Hội bạn thân','Close friends')+'</div>'
          +'<div class="ch-sub">'+L('Minh, Lan, Khoa và Vy','Minh, Lan, Khoa and Vy')+'</div></div>'
          +'<button class="ch-pill" type="button"><span>'+L('Đổi nhóm','Switch')+'</span>'+__CHEV+'</button></div></div>'
          +'<div class="dbt-hero2"><div class="dbt-hk">'+L('Nhóm đang nợ bạn','The space owes you')+'</div>'
          +'<div class="dbt-hv num owed">'+fmt(net)+'</div></div>'
          +'<div class="dbt-acts"><button class="dbt-btn primary" type="button">'+L('Ghi khoản chung','Log a shared expense')+'</button>'
          +'<button class="dbt-btn tinted" type="button">'+L('Ghi trả nợ','Record a settle-up')+'</button></div>'
          +'<div class="dbt-sec">'+L('Ai trả ai','Who pays whom')+'</div><div class="dbt-card">'
          +mine.map(function(p){ var i=__M.findIndex(function(m){ return m.id===p.from.id; });
              return '<div class="dbt-mb">'+__av(i,p.from.name)+'<span class="dbt-mbn">'+p.from.name+' '+L('trả bạn','pays you')+'</span><span class="dbt-mbv num owed">'+fmt(p.amt)+'</span></div>'; }).join('')
          +'</div>'
          +'<div class="section-h"><span class="t">'+L('Mới đây','Recently')+'</span><span class="acts"><a>'+L('Xem tất cả','See all')+'</a></span></div>'
          +'<div class="rows">'+__T.slice(0,3).map(__txRow).join('')+'</div>';
        v.insertBefore(__mock(h), v.firstChild);
      },350);` },

    { name: '07-switcher', newSurface: true, settleMs: 1100, setup: H + `
      __space(); go('home');
      var item=function(e,t,s,on){ return '<button type="button" class="rl-row"><span class="r-ico">'+e+'</span><span class="rl-t"><b>'+t+'</b><small>'+s+'</small></span>'
        +(on?'<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="var(--brand)" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>':'')+'</button>'; };
      __sheet('<div class="sheet-h">'+L('Nhóm của bạn','Your spaces')+'</div>'
        +'<div class="rl-list" style="margin-top:14px">'
        + item('🏡',(window.FAM&&FAM.familyName)||'Nhà Minh',L('Gia đình · 3 thành viên','Family · 3 members'),true)
        + item('🍜',L('Hội bạn thân','Close friends'),L('Nhóm nợ bạn ','Owes you ')+fmt(1080),false)
        + item('🏸',L('Cầu lông thứ 5','Thursday badminton'),L('Bạn nợ nhóm ','You owe ')+fmt(150),false)
        +'</div>'
        +'<button type="button" class="fh-s-line" style="margin-top:16px">'+L('＋ Tạo nhóm','＋ New space')+'</button>');` },

    { name: '08-expense-chia', settleMs: 1300, setup: H + `
      __space(); __inSpace(); openExpense();
      setTimeout(function(){
        document.getElementById('ex-note').value=L('Lẩu cuối tuần','Weekend hotpot');
        document.getElementById('ex-amt').value=amtToInput(500);
        var sc=document.getElementById('ex-scope');
        sc.innerHTML='<button type="button" class="choice">🔒 '+L('Cá nhân','Personal')+'</button><button type="button" class="choice on">🍜 '+L('Hội bạn thân','Close friends')+'</button>';
        var f=document.getElementById('ex-scopefield');
        var ch=function(label,on){ return (on?'<button type="button" class="choice on">':'<button type="button" class="choice">')+label+'</button>'; };
        var extra=__mock(
           '<div class="field ex-arow"><label>'+L('Ai trả?','Who paid?')+'</label><div class="choices">'
          +  ch('Minh · '+L('bạn','you'),true)+ch('Lan')+ch('Khoa')+ch('Vy')+'</div></div>'
          +'<div class="field ex-arow"><label>'+L('Tính thế nào?','How is it counted?')+'</label><div class="choices">'
          +  ch(L('Chung','Shared'))+ch(L('Chia','Split'),true)+'</div>'
          +'<div class="field-hint">'+L('Chia: bạn ứng trước, mỗi người nợ phần của mình. Chung: không ai nợ ai.','Split: you front it and each person owes their share. Shared: nobody owes anybody.')+'</div></div>'
          +'<div class="field ex-arow"><label>'+L('Chia cho ai?','Split between')+'</label><div class="choices">'
          +  ch('Minh',true)+ch('Lan',true)+ch('Khoa',true)+ch('Vy',true)+'</div>'
          +'<div class="field-hint">'+L('Chia đều, mỗi người ','Split equally, ')+fmt(125)+L('. ',' each. ')+'<a>'+L('Tự nhập từng phần','Enter amounts')+'</a></div></div>');
        f.parentNode.insertBefore(extra, f.nextSibling);
        var acct=document.getElementById('ex-acctfield'); if(acct) __hide(acct);
        var b=document.querySelector('#expense-modal .modal-body'); if(b) b.scrollTop=0;
      },250);` },

    { name: '09-space-money', settleMs: 1300, setup: H + `__money(false);` },

    { name: '10-settle', settleMs: 1200, setup: H + `
      __space(); __inSpace(); fhSpaceSettleSheet(__SP);
      setTimeout(function(){
        var p=fhSpacePairwise(__SP)[0], a=document.getElementById('dbt-amt'); if(a&&p) a.value=amtToInput(p.amt);
        var n=document.querySelector('#fh-modal-body .dbt-note');
        if(n) n.textContent=L('Ai trong nhóm cũng ghi được. Người kia sẽ nhận được thông báo.','Anyone in the space can record this. The other person is notified.');
      },200);` },

    { name: '11-profile', settleMs: 1200, setup: H + `
      __space(); fhSpaceCreateSheet();
      setTimeout(function(){
        document.getElementById('fh-modal-title').textContent=L('Hội bạn thân','Close friends');
        document.getElementById('fh-modal-save').textContent=L('Lưu','Save');
        var mem=function(i,n,role){ return '<div class="rl-row">'+__av(i,n)+'<span class="rl-t"><b>'+n+'</b><small>'+role+'</small></span></div>'; };
        document.getElementById('fh-modal-body').innerHTML=
           '<div class="field"><label>'+L('Tên nhóm','Name')+'</label><input value="'+L('Hội bạn thân','Close friends')+'"></div>'
          +'<div class="field"><label>'+L('Thành viên','Members')+'</label><div class="rl-list">'
          +  mem(0,'Minh',L('Chủ nhóm · bạn','Owner · you'))+mem(1,'Lan',L('Thành viên','Member'))+mem(2,'Khoa',L('Thành viên','Member'))+mem(3,'Vy',L('Thành viên','Member'))+'</div></div>'
          +'<button type="button" class="fh-s-line">'+L('Mời thêm người','Invite someone')+'</button>'
          +'<div class="field" style="margin-top:22px"><label>'+L('Nhóm này dùng','This space uses')+'</label>'+__switches(['split','moments','react','goals'])+'</div>'
          +'<div class="dbt-note">'+L('Chỉ chủ nhóm đổi được các mục này.','Only the owner can change these.')+'</div>';
      },200);` },

    { name: '12-outcome', settleMs: 1400, setup: H + `__money(true);` },

    /* ── release 2 (spec section 7): a captured bank email, filed into a space ── */
    { name: '13-capture-queue', settleMs: 1400, setup: H + C + `
      __q();
      setTimeout(__qtop, 400);` },

    { name: '13-capture-open', settleMs: 1500, setup: H + C + `
      __q(); __open(/nuong/i, function(){ __qscroll(document.querySelector('#csv-result .csv-srows'), 330); });` },

    { name: '14-capture-where', settleMs: 1500, setup: H + C + `
      __q();
      __open(/nuong/i, function(){
        csvRowSheetOpen('scope');
        setTimeout(function(){
          var m=document.getElementById('csv-rowsheet'), b=m && m.querySelector('.crs-body'); if(!b) return;
          b.innerHTML='<div class="choices">'+__ch('🔒 '+L('Cá nhân','Personal'),true)+__ch('🏡 '+((window.FAM&&FAM.familyName)||'Nhà Minh'))
            +__ch(__SPN())+__ch('🏸 '+L('Cầu lông thứ 5','Thursday badminton'))+'</div>';
          __qscroll(document.querySelector('#csv-result .csv-srows'), 330);
        },200);
      });` },

    { name: '15-capture-card', settleMs: 1500, setup: H + C + `
      __q(); __open(/nuong/i, __cardSpace);` },

    { name: '16-capture-split', settleMs: 1600, setup: H + C + `
      __q();
      __open(/nuong/i, function(){
        csvRowSheetOpen('scope');
        setTimeout(function(){
          __cardSpace();
          var m=document.getElementById('csv-rowsheet'); if(!m) return;
          m.querySelector('.crs-t').textContent=L('Tính thế nào?','How is it counted?');
          m.querySelector('.crs-body').innerHTML=
             '<div class="choices">'+__ch(L('Chung','Shared'))+__ch(L('Chia','Split'),true)+'</div>'
            +'<div class="field-hint">'+L('Chia: bạn ứng trước, mỗi người nợ phần của mình. Chung: không ai nợ ai.','Split: you front it and each person owes their share. Shared: nobody owes anybody.')+'</div>'
            +'<div class="field" style="margin-top:18px"><label>'+L('Chia cho ai?','Split between')+'</label><div class="choices">'
            +  __ch('Minh',true)+__ch('Lan',true)+__ch('Khoa',true)+__ch('Vy',true)+'</div>'
            +'<div class="field-hint">'+L('Chia đều, mỗi người ','Split equally, ')+fmt(310)+L('. ',' each. ')+'<a>'+L('Tự nhập từng phần','Enter amounts')+'</a></div></div>';
        },200);
      });` },

    { name: '17-capture-done', settleMs: 1500, setup: H + C + `
      __q(true);
      setTimeout(function(){
        __qtop();
        toast(L('Đã ghi vào Hội bạn thân, chia 4 người','Saved to Close friends, split 4 ways'));
      },400);` },

    { name: '18-capture-space', settleMs: 1500, setup: H + `window.__captured=true; __money(false);
      setTimeout(function(){ var sc=document.getElementById('scroll'), h=document.querySelector('#v-spending [data-mock] .dbt-sec'); if(sc && h) sc.scrollTop+=h.getBoundingClientRect().top-110; },700);` },

    { name: '19-capture-book', settleMs: 1400, setup: H + C + `
      __book(__srow(L('Phần của bạn','Your share'), fmt(310), {ro:true, by:L('Tính vào chi tiêu','Counts as your spending')})
            +__srow(L('Nhóm nợ bạn','The space owes you'), fmt(930), {ro:true, by:L('Lan, Khoa, Vy · không tính vào chi tiêu','Lan, Khoa, Vy · not spending')}));` },

    { name: '20-capture-settle', settleMs: 1500, setup: H + C + `
      __space(); __q();
      __open(/Lan tra/i, function(){
        var rows=document.querySelector('#csv-result .csv-srows'); if(!rows) return;
        [].forEach.call(rows.querySelectorAll('.csv-srow'), function(r){ var s=r.querySelector('small'); if(s && !/Ghi vào đâu|Where to|Loại khoản|Kind|Ngày|Date|Giờ|Time/.test(s.textContent)) r.style.display='none'; });
        __swap(__rowBy(rows,/Ghi vào đâu|Where to/), __srow(L('Ghi vào đâu','Where to'), __SPN(), {by:L('Gợi ý','Suggested')}));
        __swap(__rowBy(rows,/Loại khoản|Kind/), __srow(L('Loại khoản','Kind'), '🤝 '+L('Lan trả nợ nhóm','Lan settles up'), {by:L('Khớp số Lan đang nợ bạn','Matches what Lan owes you')}));
        rows.insertAdjacentHTML('afterend','<div class="csv-expand-note" style="margin-top:14px">'+L('Lan đang nợ bạn ','Lan owes you ')+fmt(320)+L(' trong Hội bạn thân. Không phải khoản này thì đổi lại Cá nhân.',' in Close friends. If this is something else, switch it back to Personal.')+'</div>');
        __cta(L('Ghi trả nợ','Record the settle-up'));
        __qscroll(document.querySelector('#csv-result .csv-srows'), 330);
      });` },

    /* ── one sharer is not in the space: their share stays in the payer's own book (S32) ── */
    { name: '21-outsider-split', settleMs: 1600, setup: H + C + `
      __q();
      __open(/nuong/i, function(){
        csvRowSheetOpen('scope');
        setTimeout(function(){
          __cardSpace(true);
          var m=document.getElementById('csv-rowsheet'); if(!m) return;
          m.querySelector('.crs-t').textContent=L('Tính thế nào?','How is it counted?');
          m.querySelector('.crs-body').innerHTML=
             '<div class="choices">'+__ch(L('Chung','Shared'))+__ch(L('Chia','Split'),true)+'</div>'
            +'<div class="field" style="margin-top:18px"><label>'+L('Ai trong nhóm?','Who in the space?')+'</label><div class="choices">'
            +  __ch('Minh',true)+__ch('Lan',true)+__ch('Khoa',true)+__ch('Vy')+'</div></div>'
            +'<div class="field" style="margin-top:18px"><label>'+L('Chia mấy phần?','How many shares?')+'</label><div class="choices">'
            +  __ch('3')+__ch('4',true)+__ch('5')+__ch('6')+__ch(L('Số khác','Other'))+'</div>'
            +'<div class="field-hint">'+L('4 phần, mỗi phần ','4 shares, ')+fmt(310)+L('. 3 phần trong nhóm, 1 phần ngoài nhóm.',' each. 3 in the space, 1 outside.')+'</div>'
            +'<div class="field-hint">'+L('Phần ngoài nhóm không vào nhóm. Nó nằm trong sổ của bạn là khoản cần thu. ','The outside share stays out of the space. It sits in your own book as money to collect. ')+'<a>'+L('Ghi tên người đó','Add their name')+'</a></div></div>';
        },200);
      });` },

    { name: '22-outsider-card', settleMs: 1500, setup: H + C + `
      __q(); __open(/nuong/i, function(){ __cardSpace(true); });` },

    { name: '23-outsider-space', settleMs: 1500, setup: H + `window.__captured='outsider'; __money(false);
      setTimeout(function(){ var sc=document.getElementById('scroll'), h=document.querySelector('#v-spending [data-mock] .dbt-sec'); if(sc && h) sc.scrollTop+=h.getBoundingClientRect().top-110; },700);` },

    { name: '24-outsider-book', settleMs: 1400, setup: H + C + `
      __book(__srow(L('Phần của bạn','Your share'), fmt(310), {ro:true, by:L('Tính vào chi tiêu','Counts as your spending')})
            +__srow(L('Nhóm nợ bạn','The space owes you'), fmt(620), {ro:true, by:L('Lan, Khoa · không tính vào chi tiêu','Lan, Khoa · not spending')})
            +__srow(L('Ngoài nhóm nợ bạn','Owed from outside'), fmt(310), {by:L('1 phần · chưa ghi tên','1 share · no name yet')}));` }
  ]
};
