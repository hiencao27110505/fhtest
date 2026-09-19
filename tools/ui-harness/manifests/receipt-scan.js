/* Built states for receipt scan — same shot names as receipt-scan-target.js so the
   storyboard can sit built beside target per journey stage. States are driven through
   the engine's harness seam (window.__fhScanSeed) because headless Chrome has no
   camera and no network; the seam only renders, it never fakes a read. */
const H = `
try{ if(window._closeOv) _closeOv(); var _pk=document.getElementById('peek'); if(_pk) _pk.classList.remove('on'); var _ts=document.getElementById('toast'); if(_ts) _ts.classList.remove('on'); }catch(e){}
try{ window.scrollTo(0,0); var _sc=document.getElementById('scroll'); if(_sc) _sc.scrollTop=0; var _ph=document.querySelector('.phone'); if(_ph) _ph.scrollTop=0; }catch(e){}
try{ var _c=document.getElementById('scan-cam'); if(_c) _c.classList.remove('on'); }catch(e){}
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
  window.__R=[
    {src:__rcpt('CIRCLE K',[['Nước suối','15.000'],['Bánh mì','25.000'],['Sữa chua','45.000']],'85.000'), note:'CIRCLE K', amt:85, cat:'Ăn uống', time:'08:12'},
    {src:__rcpt('HIGHLANDS COFFEE',[['Phin sữa đá x2','78.000'],['Bánh chuối','40.000']],'118.000'), note:'HIGHLANDS COFFEE', amt:118, cat:'Ăn uống', time:'09:40'},
    {src:__rcpt('NHÀ THUỐC LONG CHÂU',[['Vitamin C','96.000'],['Khẩu trang','60.000'],['Nước muối','80.000']],'236.000'), note:'NHÀ THUỐC LONG CHÂU', amt:236, cat:'Sức khoẻ', time:'16:05'},
    {src:__rcpt('BÚN BÒ HUẾ',[['Bún bò','55.000']],'55.000',true)}
  ];
}
window.__batch=function(states){ return __R.map(function(r,i){ return Object.assign({}, r, {state: states[i]}); }); };
`;
module.exports = {
  feature: 'receipt-scan',
  langs: ['vi', 'en'],
  themes: ['sage'],
  shots: [
    { name: '01-whatsnew', settleMs: 900, setup: H + `openWhatsNew();` },
    { name: '02-addsheet', settleMs: 900, setup: H + `openSheet('sheet-add');` },
    { name: '03-personal', settleMs: 1000, setup: H + `go('personal'); setTimeout(function(){ var r=[].find.call(document.querySelectorAll('.cf-cta .cc-row'), function(b){ return /Quét hóa đơn/.test(b.textContent); }); var sc=document.getElementById('scroll'); if(r&&sc) sc.scrollTop=Math.max(0,r.offsetTop-260); },400);` },
    { name: '04-consent', settleMs: 1000, setup: H + `fhScanConsentSheet({});` },
    { name: '05-camera', settleMs: 900, setup: H + `__fhScanSeed({camera:true, still:__R[0].src});` },
    { name: '06-camera-batch', settleMs: 900, setup: H + `__fhScanSeed({camera:true, still:__R[0].src, items:__batch(['ok','ok','ok']).slice(0,3), say:L('Đã chụp 3 · chụp tiếp hoặc chạm Xong','3 captured · keep going or tap Done')});` },
    { name: '07-reading', settleMs: 900, setup: H + `__fhScanSeed({items:__batch(['reading','reading','reading','reading'])});` },
    { name: '08-review', settleMs: 900, setup: H + `__fhScanSeed({items:__batch(['ok','flag','ok','bad'])});` },
    { name: '09-edit-row', settleMs: 1200, setup: H + `__fhScanSeed({items:__batch(['ok','flag','ok','bad'])}); setTimeout(function(){ fhScanRowTap(1); },150);` },
    { name: '10-receipt-large', settleMs: 1100, setup: H + `__fhScanSeed({items:__batch(['ok','flag','ok','bad'])}); setTimeout(function(){ fhScanPeek(1); },200);` },
    { name: '11-outcome', settleMs: 1800, setup: H + `__fhScanSeed({items:__batch(['ok','ok','ok']).slice(0,3)}); setTimeout(function(){ fhScanSave(document.getElementById('scan-save')); },200);` },
    { name: '12-settings-privacy', settleMs: 1200, setup: H + `fhPrivacySheet();` },
    { name: '13-stop', settleMs: 1200, setup: H + `fhScanConsentSheet({readOnly:true});` },
    { name: '14-offline', settleMs: 900, setup: H + `__fhScanSeed({items:__batch(['offline','offline','offline','offline'])});` }
  ]
};
