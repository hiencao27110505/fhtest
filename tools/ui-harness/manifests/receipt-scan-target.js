/* Target pictures for receipt scan: stage 2 of docs/WORKFLOW.md.
   Every shot opens the real surface and injects the TARGET state with the app's own
   classes and L('vi','en'), so fonts, tokens and both languages are real. None of this
   is product code. The built manifest (receipt-scan.js) reuses these shot names.

   Capture follows Apple's document scanner (VNDocumentCameraViewController): a
   full-screen camera, a tray that counts what has been captured, one commit verb.
   Review reuses the ledger's own row, with the receipt as the row tile, so a scanned
   expense reads exactly like every other expense in the app. */
const H = `
try{ if(window._closeOv) _closeOv(); var _pk=document.getElementById('peek'); if(_pk) _pk.classList.remove('on'); var _ts=document.getElementById('toast'); if(_ts) _ts.classList.remove('on'); }catch(e){}
try{ window.scrollTo(0,0); var _sc=document.getElementById('scroll'); if(_sc) _sc.scrollTop=0; var _ph=document.querySelector('.phone'); if(_ph) _ph.scrollTop=0; }catch(e){}
['mock-cam','mock-review'].forEach(function(id){ var e=document.getElementById(id); if(e) e.remove(); });
if(!window.__rcpt){
  window.__rcpt=function(shop,rows,total,blur){
    var c=document.createElement('canvas'); c.width=360; c.height=540; var x=c.getContext('2d');
    x.fillStyle='#fbfaf6'; x.fillRect(0,0,360,540);
    if(blur) x.filter='blur(5px)';
    x.fillStyle='#222'; x.textAlign='center'; x.font='bold 24px sans-serif'; x.fillText(shop,180,56);
    x.font='13px sans-serif'; x.fillStyle='#777'; x.fillText('HÓA ĐƠN BÁN HÀNG',180,82); x.fillText('15/09/2026 14:23',180,102);
    x.fillStyle='#333'; x.font='16px monospace'; var y=150;
    rows.forEach(function(r){ x.textAlign='left'; x.fillText(r[0],26,y); x.textAlign='right'; x.fillText(r[1],334,y); y+=32; });
    x.strokeStyle='#bbb'; x.setLineDash([5,5]); x.beginPath(); x.moveTo(26,y); x.lineTo(334,y); x.stroke(); y+=40;
    x.font='bold 20px monospace'; x.textAlign='left'; x.fillText('TỔNG',26,y); x.textAlign='right'; x.fillText(total,334,y);
    return c.toDataURL('image/jpeg',0.85);
  };
}
if(!window.__R){
  window.__R=[
    {thumb:__rcpt('CIRCLE K',[['Nước suối','15.000'],['Bánh mì','25.000'],['Sữa chua','45.000']],'85.000'), note:'CIRCLE K', amt:85, cat:'Ăn uống', time:'08:12'},
    {thumb:__rcpt('HIGHLANDS COFFEE',[['Phin sữa đá x2','78.000'],['Bánh chuối','40.000']],'118.000'), note:'HIGHLANDS COFFEE', amt:118, cat:'Ăn uống', time:'09:40'},
    {thumb:__rcpt('NHÀ THUỐC LONG CHÂU',[['Vitamin C','96.000'],['Khẩu trang','60.000'],['Nước muối','80.000']],'236.000'), note:'NHÀ THUỐC LONG CHÂU', amt:236, cat:'Sức khoẻ', time:'16:05'},
    {thumb:__rcpt('BÚN BÒ HUẾ',[['Bún bò','55.000']],'55.000',true), note:'', amt:0, cat:'', time:''}
  ];
}
window.__camSvg='<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>';
window.__scanSvg='<path d="M5 4.5h8.5L19 10v9.5H5z"/><path d="M13.5 4.5V10H19"/><path d="M8 13h7M8 16.2h4.5"/>';
window.__sheet=function(inner){
  document.getElementById('fh-sheet-body').innerHTML=inner;
  document.getElementById('scrim').classList.add('on'); document.getElementById('fh-sheet').classList.add('on');
  __settle();
};
window.__cstRow=function(q,a){ return '<div class="cst-row"><div class="cst-rt">'+q+'</div><div class="cst-rs">'+a+'</div></div>'; };
window.__settle=function(fn){
  setTimeout(function(){
    try{ if(document.activeElement && document.activeElement.blur) document.activeElement.blur(); }catch(e){}
    window.scrollTo(0,0);
    var ph=document.querySelector('.phone'); if(ph) ph.scrollTop=0;
    var b=document.querySelector('#expense-modal .modal-body'); if(b) b.scrollTop=0;
    var s=document.getElementById('fh-sheet'), sb=document.getElementById('fh-sheet-body');
    if(s) s.scrollTop=0; if(sb) sb.scrollTop=0;
    if(fn) fn();
  },520);
};

/* ── capture: Apple's document scanner skeleton ───────────────────────────── */
window.__cam=function(shot, narrator){
  var ph=document.querySelector('.phone');
  var corner=function(pos){
    var b='3px solid var(--brand)', s='position:absolute;width:26px;height:26px;'+pos+';';   // corner brackets carry no radius of their own
    return '<span style="'+s+'border-top:'+(/top/.test(pos)?b:'0')+';border-bottom:'+(/bottom/.test(pos)?b:'0')+';border-left:'+(/left/.test(pos)?b:'0')+';border-right:'+(/right/.test(pos)?b:'0')+';border-radius:0"></span>';
  };
  var tray = shot
    ? '<button type="button" style="justify-self:end;display:flex;align-items:center;gap:8px;background:none;border:0;color:#fff;font:600 16px/1 inherit;min-height:44px">'
      +   '<span style="position:relative;display:block;width:42px;height:54px;border-radius:10px;border:2px solid rgba(255,255,255,.9);background:center/cover no-repeat url('+__R[shot-1].thumb+')">'
      +     '<span style="position:absolute;top:-8px;right:-8px;min-width:22px;height:22px;border-radius:11px;background:var(--brand);color:#fff;font:700 12px/22px inherit;text-align:center">'+shot+'</span>'
      +   '</span>'+L('Xong','Done')+'</button>'
    : '<span></span>';
  var d=document.createElement('div');
  d.id='mock-cam';
  // layer 66: above modals (62) and sheets (60), below the photo viewer (68). The build
  // names this surface .scan-cam with a --scan-bg token; DESIGN §4 gains the row.
  d.style.cssText='position:absolute;inset:0;z-index:66;--scan-bg:#0b0d0c;background:var(--scan-bg);display:flex;flex-direction:column';
  d.innerHTML=
    '<div style="display:flex;align-items:center;justify-content:space-between;padding:calc(env(safe-area-inset-top) + 16px) 18px 10px;color:#fff">'
    +  '<button type="button" style="background:none;border:0;color:#fff;font:400 17px/1 inherit;min-height:44px;min-width:44px;padding:0 8px;text-align:left">'+L('Huỷ','Cancel')+'</button>'
    +  '<div style="font:600 17px/1 inherit">'+L('Quét hóa đơn','Scan receipts')+'</div>'
    +  '<button type="button" style="background:none;border:0;color:#fff;font:400 17px/1 inherit;opacity:.9;min-height:44px;min-width:44px;padding:0 8px;text-align:right">'+L('Đèn','Flash')+'</button>'
    + '</div>'
    +'<div style="flex:1;position:relative;display:flex;align-items:center;justify-content:center;padding:8px 26px">'
    +  '<div style="position:relative">'
    +    '<img src="'+__R[0].thumb+'" style="display:block;width:100%;max-height:52vh;object-fit:contain;border-radius:12px;box-shadow:0 14px 44px rgba(0,0,0,.55)">'
    +    corner('top:-10px;left:-10px')+corner('top:-10px;right:-10px')+corner('bottom:-10px;left:-10px')+corner('bottom:-10px;right:-10px')
    +  '</div>'
    +  '<div style="position:absolute;left:0;right:0;bottom:6px;text-align:center;color:rgba(255,255,255,.92);font:500 14px/1.4 inherit">'+narrator+'</div>'
    + '</div>'
    // three fixed columns so the shutter never moves when the tray appears
    +'<div style="display:grid;grid-template-columns:1fr 1fr 1fr;align-items:center;padding:14px 26px calc(env(safe-area-inset-bottom) + 26px)">'
    +  '<button type="button" aria-label="'+L('Thư viện','Library')+'" style="justify-self:start;width:44px;height:44px;border-radius:12px;border:2px solid rgba(255,255,255,.75);background:none;color:#fff;display:flex;align-items:center;justify-content:center">'
    +    '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="M3 15l5-4 4 3 3-2 6 5"/></svg></button>'
    +  '<button type="button" aria-label="'+L('Chụp','Capture')+'" style="justify-self:center;width:74px;height:74px;border-radius:50%;background:#fff;border:4px solid rgba(255,255,255,.35);box-shadow:0 0 0 3px #0b0d0c inset"></button>'
    +  tray
    + '</div>';
  ph.appendChild(d);
  __settle();
};

/* ── review: the ledger's own row, with the receipt as the tile ───────────── */
window.__row=function(c,st){
  var tile = st==='reading'
    ? '<div class="r-ico ph" style="background-image:url('+c.thumb+');opacity:.5"></div>'
    : '<div class="r-ico ph" style="background-image:url('+c.thumb+')"></div>';
  var title, sub, right;
  if(st==='reading'){
    title='<div class="r-t" style="color:var(--muted)">'+L('Đang đọc…','Reading…')+'</div>';
    sub='<div class="r-s" style="display:inline-block;width:92px;height:13px;border-radius:10px;background:var(--fill-neutral)"></div>';   // the date is not read yet either
    right='<div class="r-amt num" style="min-width:78px;height:17px;border-radius:10px;background:var(--fill-neutral)"></div>';
  } else if(st==='bad'){
    title='<div class="r-t" style="color:var(--muted)">'+L('Chưa đọc được','Not read yet')+'</div>';
    sub='<div class="r-s" style="color:var(--brand-ink)">'+L('Chạm để nhập tay','Tap to type it in')+'</div>';   // an affordance, not a warning
    right='<div class="r-amt num" style="color:var(--muted-soft)">—</div>';
  } else {
    title='<div class="r-t">'+c.note+'</div>';
    sub= st==='flag'
      ? '<div class="r-s" style="color:var(--amber)">'+L('Kiểm tra lại số tiền','Check the amount')+'</div>'
      : '<div class="r-s">'+fmtDayMon(new Date())+' · '+c.time+'</div>';
    right='<div class="r-amt num">'+fmt(c.amt)+'</div><div class="r-cat">'+c.cat+'</div>';
  }
  return '<div class="row tap"><div class="r-ico-wrap">'+tile+'</div><div class="r-body">'+title+sub+'</div><div class="r-right">'+right+'</div></div>';
};
window.__review=function(states, head, saveLabel, dest, leftover){
  var ph=document.querySelector('.phone');
  var d=document.createElement('div');
  // layer 61: above sheets (60), below the expense form (62) it drills into. DESIGN §4 gains the row.
  d.id='mock-review'; d.className='modal on'; d.style.zIndex='61';
  /* Same grammar as the CSV import review: nav Cancel · Title · Save, the count
     in the Save label and grey until there is something to save; a section header
     narrates state; rows keep their own 16px margin, so the body has no side padding. */
  d.innerHTML='<div class="modal-grip"></div>'
    +'<div class="modal-nav"><button class="modal-cancel">'+L('Huỷ','Cancel')+'</button>'
    +  '<div class="modal-title">'+L('Quét hóa đơn','Scan receipts')+'</div>'
    +  '<button class="modal-save"'+(saveLabel?'':' disabled')+'>'+(saveLabel||L('Lưu','Save'))+'</button></div>'
    +'<div class="modal-body" style="padding-left:0;padding-right:0">'
    +  '<div class="section-h" style="margin-top:6px"><span class="t">'+head+'</span><span class="sh-note">'+dest+'</span></div>'
    +  '<div class="rows">'+__R.map(function(c,i){ return __row(c,states[i]); }).join('')
    +    '<div class="row tap"><div class="r-ico-wrap"><div class="pers-r-ico">'
    +      '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">'+__camSvg+'</svg></div></div>'
    +    '<div class="r-body"><div class="r-t" style="color:var(--brand-ink)">'+L('Chụp thêm ảnh','Capture more')+'</div></div></div>'
    +  '</div>'
    +  (leftover?'<div class="field-hint" style="margin:10px 22px 0">'+leftover+'</div>':'')
    +'</div>';
  ph.appendChild(d);
  __settle();
};
`;

module.exports = {
  feature: 'receipt-scan-target',
  langs: ['vi', 'en'],
  themes: ['sage'],
  shots: [
    { name: '01-whatsnew', settleMs: 900, setup: H + `
      openWhatsNew();
      setTimeout(function(){
        document.getElementById('whatsnew-list').insertAdjacentHTML('afterbegin',
          '<div class="wn-row"><span class="wn-ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">'+__camSvg+'</svg></span>'
          +'<div class="wn-txt"><div class="wn-t">'+L('Chụp hóa đơn, app tự ghi','Snap a receipt, and it’s logged')+'</div>'
          +'<div class="wn-meta">'+fhReleaseMeta({date:'2026-09-30',time:'09:00',ver:'v500'})+'</div>'
          +'<p class="wn-desc">'+L('Trả bằng MoMo hay tiền mặt thì không có email nào báo về. Giờ bạn chụp hóa đơn hoặc chọn ảnh chụp màn hình, một lúc tới 10 tấm, app đọc số tiền và ngày giúp bạn, bạn chỉ cần xem lại rồi lưu.','Paying with MoMo or cash sends no email. Now you can photograph receipts or pick screenshots, up to 10 at once. The app reads the amount and date, and you just check and save.')+'</p></div></div>');
      },120);` },

    { name: '02-addsheet', settleMs: 900, setup: H + `
      openSheet('sheet-add');
      if(!document.getElementById('qa-scan')){
        var first=document.querySelector('#sheet-add .qa'), n=first.cloneNode(true);
        n.id='qa-scan'; n.removeAttribute('onclick');
        var qt=n.querySelector('.qt'), qs=n.querySelector('.qs');
        qt.removeAttribute('data-t'); qs.removeAttribute('data-t');
        qt.textContent=L('Quét hóa đơn','Scan receipts'); qs.textContent=L('Chụp hoặc chọn tới 10 ảnh','Snap or pick up to 10 photos');
        n.querySelector('.qi svg').innerHTML=__scanSvg;   // a document-scan glyph, never the moment camera
        first.parentNode.insertBefore(n, first.nextSibling);
      }` },

    { name: '03-personal', settleMs: 900, setup: H + `
      go('personal');
      setTimeout(function(){
        var t=document.querySelector('.cf-cta .cc-row[onclick="openPersonalExpense()"]');
        if(t && !document.getElementById('cc-scan')){
          var n=t.cloneNode(true); n.id='cc-scan'; n.removeAttribute('onclick');
          n.querySelector('.cc-t').textContent=L('Quét hóa đơn','Scan receipts');
          n.querySelector('.cc-ic').innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">'+__camSvg+'</svg>';
          t.parentNode.insertBefore(n, t.nextSibling);
        }
        var s=document.getElementById('cc-scan'), sc=document.getElementById('scroll');
        if(s && sc) sc.scrollTop=Math.max(0, s.offsetTop-260);
      },300);` },

    { name: '04-consent', newSurface: true, settleMs: 900, setup: H + `
      __sheet('<div class="cst-kicker">'+L('ĐỒNG Ý XỬ LÝ DỮ LIỆU CÁ NHÂN · QUÉT HÓA ĐƠN','PERSONAL DATA CONSENT · RECEIPT SCAN')+'</div>'
        +'<div class="sheet-h">'+L('Bạn chụp, AI đọc, bạn xem lại.','You snap it, AI reads it, you check it.')+'</div>'
        +'<div class="cst-body">'
        +__cstRow(L('Gửi đi những gì?','What is sent?'), L('Một bản sao nhỏ của từng ảnh, đã xoá vị trí và thông tin máy chụp.','A smaller copy of each photo, with location and camera details removed.'))
        +__cstRow(L('Để làm gì?','What for?'), L('Chỉ để đọc số tiền, ngày và nơi mua, rồi điền sẵn khoản chi. Không bán, không quảng cáo.','Only to read the amount, date and shop, then prefill an expense. Never sold, never ads.'))
        +__cstRow(L('Ai đọc ảnh?','Who reads the photo?'), L('AI của Google đọc tự động. Máy chủ Earthy chỉ chuyển ảnh đi, không giữ lại.','Google’s AI reads it automatically. Earthy’s server only passes it on and keeps nothing.'))
        +__cstRow(L('Có tự vào sổ không?','Does anything save by itself?'), L('Không. Bạn xem lại từng khoản rồi mới lưu.','No. You check every item before it is saved.'))
        +__cstRow(L('Giữ bao lâu?','How long is it kept?'), L('Earthy không giữ bản gửi đi. Google xử lý theo điều khoản của gói đang dùng.','Earthy keeps no copy. Google handles it under the terms of the plan in use.'))
        +'</div>'
        +'<div class="cst-meta">'+L('Muốn dừng: Cài đặt, Quyền riêng tư, Quét hóa đơn. Vận hành: Trang và Hiên · gichisreading@gmail.com · Chi tiết: Chính sách quyền riêng tư. Nếu không đồng ý, chỉ tính năng này không bật.','To stop: Settings, Privacy, Receipt scan. Operated by Trang and Hien · gichisreading@gmail.com · Details: Privacy Policy. If you decline, only this feature stays off.')+'</div>'
        +'<button class="cta">'+L('Đồng ý và mở máy ảnh','Agree and open the camera')+'</button>'
        +'<button class="btn-skip">'+L('Để sau','Not now')+'</button>');` },

    { name: '05-camera', newSurface: true, settleMs: 900, setup: H + `__cam(0, L('Đưa hóa đơn vào khung','Line the receipt up in the frame'));` },
    { name: '06-camera-batch', newSurface: true, settleMs: 900, setup: H + `__cam(3, L('Đã chụp 3 · chụp tiếp hoặc chạm Xong','3 captured · keep going or tap Done'));` },

    { name: '07-reading', newSurface: true, settleMs: 900, setup: H + `__review(['reading','reading','reading','reading'], L('Đang đọc 4 ảnh…','Reading 4 photos…'), '', L('Sổ gia đình','Family book'), '');` },
    { name: '08-review', newSurface: true, settleMs: 900, setup: H + `__review(['filled','flag','filled','bad'], L('Đã đọc 3/4','Read 3 of 4'), L('Lưu 3','Save 3'), L('Sổ gia đình · ','Family book · ')+fmt(439), L('Ảnh chưa đọc được vẫn ở đây sau khi lưu, chạm để nhập tay.','The photo we could not read stays here after saving. Tap it to type it in.'));` },

    { name: '09-edit-row', settleMs: 1000, setup: H + `
      openExpense();
      setTimeout(function(){
        document.getElementById('ex-title').textContent=L('Sửa khoản 2/4','Edit 2 of 4');
        setTimeout(function(){ var idx=document.querySelector('#bulk-list .bulk-idx'); if(idx) idx.textContent=L('Khoản chi 2','Expense 2'); },60);
        document.getElementById('ex-note').value='HIGHLANDS COFFEE';
        document.getElementById('ex-amt').value=amtToInput(118);
        [].forEach.call(document.querySelectorAll('#ex-cat .choice'), function(b){ b.classList.toggle('on', /Ăn uống/.test(b.textContent)); });
        [].forEach.call(document.querySelectorAll('#ex-scope .choice'), function(b){ b.classList.toggle('on', b.getAttribute('data-v')==='family'); });
        var acct=document.getElementById('ex-acctfield'); if(acct) acct.style.display='none';
        var del=document.getElementById('ex-del'); if(del) del.style.display='none';
        var add=document.getElementById('bulk-add'); if(add) add.style.display='none';
        exPhotos=[__R[1].thumb]; renderExPhoto();
        var amt=document.getElementById('ex-amt'), anchor=amt.closest('.field-row')||amt.closest('.field')||amt;
        if(!document.getElementById('scan-flag')) anchor.insertAdjacentHTML('afterend','<div id="scan-flag" class="field-hint" style="color:var(--amber);margin-bottom:14px">'+L('Số tiền đọc được không khớp chữ trên ảnh. Chạm ảnh để xem lớn.','The amount read doesn’t match the text on the photo. Tap the photo to see it large.')+'</div>');
        __settle();
      },150);` },

    { name: '10-receipt-large', newSurface: true, settleMs: 1200, setup: H + `
      __review(['filled','flag','filled','bad'], L('Đã đọc 3/4','Read 3 of 4'), L('Lưu 3','Save 3'), L('Sổ gia đình · ','Family book · ')+fmt(439), L('Ảnh chưa đọc được vẫn ở đây sau khi lưu, chạm để nhập tay.','The photo we could not read stays here after saving. Tap it to type it in.'));
      setTimeout(function(){
        var f=document.getElementById('peek-frame'), im=document.getElementById('peek-img');
        if(f) f.className='peek-frame'; if(im){ im.src=__R[1].thumb; im.alt='HIGHLANDS COFFEE'; }
        if(typeof setTxt==='function') setTxt('peek-cap','HIGHLANDS COFFEE · 118.000 đ');
        if(typeof peekHideActions==='function') peekHideActions();
        // opened from a review row the action is Chụp lại: the row is not an expense yet,
        // so there is nothing to delete. The build gives #peek a review mode.
        var del=document.querySelector('#peek .peek-del'); if(del){ del.textContent=L('Chụp lại','Retake'); del.classList.remove('armed'); }
        document.getElementById('peek').classList.add('on');
      },620);` },

    { name: '11-outcome', settleMs: 1000, setup: H + `
      go('spending');
      setTimeout(function(){
        var tx=document.getElementById('tx-rows');
        var row=function(c){ return '<div class="row tap" style="box-shadow:inset 3px 0 0 var(--brand)"><div class="r-ico-wrap"><div class="r-ico ph" style="background-image:url('+c.thumb+')"></div></div><div class="r-body"><div class="r-t">'+c.note+'</div><div class="r-s">'+L('Hôm nay','Today')+' · '+c.time+'</div></div><div class="r-right"><div class="r-amt num">'+fmt(c.amt)+'</div><div class="r-cat">'+c.cat+'</div></div></div>'; };
        if(tx && !document.getElementById('scan-new')) tx.insertAdjacentHTML('afterbegin','<div id="scan-new">'+row(__R[2])+row(__R[1])+row(__R[0])+'</div>');
        segTo('activity');
        toast(L('Đã ghi 3 khoản từ hóa đơn · ','Logged 3 from receipts · ')+fmt(439));
      },250);` },

    { name: '12-settings-privacy', settleMs: 1300, setup: H + `
      /* The REAL privacy sheet (fhPrivacySheet), with the scan consent as one more
         row in its "Điều bạn đã đồng ý" group. Rows use the sheet's own cst-* markup;
         the glyph is a line SVG because DESIGN §2.6 forbids emoji as a functional icon,
         so the build adds a 'cam' key to _MBX_SVG. */
      var CAM='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4.5 8.6h3L9.2 6h5.6l1.7 2.6h3v9.8h-15z"/><circle cx="12" cy="13.2" r="3.1"/></svg>';
      var MAIL='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3.2" y="5.5" width="17.6" height="13" rx="2.8"/><path d="M4.4 7.8 12 13l7.6-5.2"/></svg>';
      var LOCK='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4.5" y="10.5" width="15" height="10" rx="2.6"/><path d="M8 10.5V7.6a4 4 0 0 1 8 0v2.9"/></svg>';
      var CHEV='<svg class="chev" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18l6-6-6-6"/></svg>';
      var row=function(g,t,v){ return '<button type="button" class="cst-lrow"><span class="cst-ic">'+g+'</span><span class="cst-ltxt"><span class="cst-lt">'+t+'</span></span><span class="cst-val">'+v+'</span>'+CHEV+'</button>'; };
      fhPrivacySheet();
      setTimeout(function(){
        var grp=document.querySelector('#fh-sheet-body .cst-group');
        var rows=grp?grp.querySelectorAll('.cst-lrow'):[];
        if(grp && rows.length){
          // plausible consent dates for the two that already exist
          var ago=function(n){ return fmtDayMon(new Date(Date.now()-n*864e5)); };
          var d=[ago(48),ago(33)];
          [].forEach.call(rows,function(r,i){ var v=r.querySelector('.cst-val'); if(v&&d[i]) v.textContent=d[i]; });
          if(!document.getElementById('cst-scan')){
            var n=rows[rows.length-1].cloneNode(true);
            n.id='cst-scan'; n.removeAttribute('onclick');
            n.querySelector('.cst-lt').textContent=L('Quét hóa đơn','Receipt scan');
            var v2=n.querySelector('.cst-val'); if(v2) v2.textContent=fmtDayMon(new Date());
            n.querySelector('.cst-ic').innerHTML=CAM;
            grp.appendChild(n);
          }
        } else {
          var body=document.querySelector('#fh-sheet-body .cst-body');
          if(body) body.insertAdjacentHTML('afterbegin','<div class="cst-sech">'+L('Điều bạn đã đồng ý','What you agreed to')+'</div>'
            +'<div class="cst-group">'+row(LOCK,L('Dữ liệu ứng dụng','App data'),'2 thg 8')+row(MAIL,L('Email ngân hàng','Bank email'),'17 thg 8')+row(CAM,L('Quét hóa đơn','Receipt scan'),fmtDayMon(new Date()))+'</div>'
            +'<div class="cst-foot">'+L('Chạm để đọc lại đúng nội dung bạn đã đồng ý.','Tap to re-read exactly what you agreed to.')+'</div>');
        }
        __settle();
      },520);` },

    { name: '13-stop', newSurface: true, settleMs: 900, setup: H + `
      /* Precedent: fhConsentSheet({readOnly:true}) re-renders the SAME sheet, because the
         privacy row promises "đọc lại đúng nội dung bạn đã đồng ý". The stop action is a
         status row with one trailing .cst-stop, the shape _cstConnRow uses, and it arms
         before it acts like fhMailboxDisconnect. */
      var CAM='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4.5 8.6h3L9.2 6h5.6l1.7 2.6h3v9.8h-15z"/><circle cx="12" cy="13.2" r="3.1"/></svg>';
      __sheet('<div class="cst-kicker">'+L('QUÉT HÓA ĐƠN','RECEIPT SCAN')+'</div>'
        +'<div class="sheet-h">'+L('Bạn chụp, AI đọc, bạn xem lại.','You snap it, AI reads it, you check it.')+'</div>'
        +'<div class="cst-group"><div class="cst-lrow"><span class="cst-ic">'+CAM+'</span>'
        +  '<span class="cst-ltxt"><span class="cst-lt">'+L('Đang gửi ảnh cho AI','Sending photos to AI')+'</span>'
        +  '<span class="cst-ls">'+L('Bạn đã đồng ý ngày ','You agreed on ')+fmtDayMon(new Date())+'</span></span>'
        +  '<button type="button" class="cst-stop">'+L('Dừng','Stop')+'</button></div></div>'
        +'<div class="cst-body">'
        +__cstRow(L('Gửi đi những gì?','What is sent?'), L('Một bản sao nhỏ của từng ảnh, đã xoá vị trí và thông tin máy chụp.','A smaller copy of each photo, with location and camera details removed.'))
        +__cstRow(L('Để làm gì?','What for?'), L('Chỉ để đọc số tiền, ngày và nơi mua, rồi điền sẵn khoản chi. Không bán, không quảng cáo.','Only to read the amount, date and shop, then prefill an expense. Never sold, never ads.'))
        +__cstRow(L('Ai đọc ảnh?','Who reads the photo?'), L('AI của Google đọc tự động. Máy chủ Earthy chuyển đi, không giữ lại.','Google\u2019s AI reads it automatically. Earthy\u2019s server passes it on and keeps nothing.'))
        +__cstRow(L('Nếu dừng','If you stop'), L('Không ảnh nào được gửi nữa. Khoản chi và ảnh đã lưu vẫn ở trong sổ.','No more photos are sent. Saved expenses and their photos stay in your ledger.'))
        +'</div>'
        +'<div class="cst-meta">'+L('Vận hành: Trang và Hiên · gichisreading@gmail.com · Chi tiết: Chính sách quyền riêng tư.','Operated by Trang and Hien · gichisreading@gmail.com · Details: Privacy Policy.')+'</div>'
        +'<button class="btn-skip">'+L('Đóng','Close')+'</button>');` },

    { name: '14-offline', newSurface: true, settleMs: 900, setup: H + `
      __review(['bad','bad','bad','bad'], L('Đang ngoại tuyến','Offline'), '', L('Sổ gia đình','Family book'),
        L('Không có mạng nên chưa gửi ảnh nào đi. Ảnh vẫn ở đây, chạm từng khoản để nhập tay.','No connection, so nothing was sent. The photos are still here. Tap each one to type it in.'));` }

  ]
};
