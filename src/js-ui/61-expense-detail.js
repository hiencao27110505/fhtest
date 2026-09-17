/* ---------- expense detail — view first, edit second ----------
   Every tap on a ledger row (txRow) now lands here instead of opening the editor
   straight away. It's a read-first screen anyone in the family can open: the
   expense laid out large, any photos, and the reactions left on it — with Update
   (opens the existing edit modal) and Delete (arm-then-confirm) as the CTAs.

   It reuses the reaction plumbing from 62-reactions.js (RX, rxMessage, _rxFace,
   _rxMineOn, throwReaction) and hands Delete to the persisting deleteExpense()
   path in 55/50 by seeding editingTx + delArmed before calling it. All functions
   share the js-ui global scope, so barewords cross files freely. */
var _expDetailId=null, _exdDelArmed=false, _exdDelT=null;

/* who paid → { name, initials, colour }. Prefers live membersMeta; falls back to
   the demo member palette (matches the token colours) so the signed-out preview
   still reads with the right person's colour. */
function _whoDisp(who){
  var raw=String(who||''), isShared=/^(both|shared)$/i.test(raw), key=isShared?'Shared':raw;
  var mm=(window.membersMeta&&membersMeta[key])||null;
  var demoCol={emma:'#6f3fc0',james:'#0e8478',mia:'#f0701a',leo:'#e03d86'}, lk=raw.toLowerCase();
  var col=mm?mm.col:(isShared?'var(--id-none)':(demoCol[lk]||'var(--id-none)'));
  var ini=mm?mm.ini:((typeof inits==='function')?inits(key||'?'):(key.slice(0,2).toUpperCase()||'?'));
  var name=isShared?L('Chi tiêu chung','Shared'):(key||L('Ai đó','Someone'));
  return { name:name, ini:ini, col:col, av:mm?mm.av:'' };
}
function _exdDate(t){
  if(t._d) return fmtDateLong(t._d);                       // LANG-gated: "Thứ Ba, 26 thg 7" / "Tuesday, July 26"
  if(t.date==='Today') return L('Hôm nay','Today');
  if(t.date==='Just now') return L('Vừa xong','Just now');
  return t.date||'';
}
function _exdMetaRow(label, val){
  return '<div class="exd-mrow"><span class="exd-ml">'+label+'</span><span class="exd-mv">'+val+'</span></div>';
}
/* ── restyle #5: the meta is the review card's settings-rows stack ──────────
   One row per fact; editable rows carry a chevron and open a picker sheet;
   a value someone changed wears the brand dot (.chg) until Lưu lands —
   staged commit (Q8b), nothing saves per-field. */
var EXD={}, _exdEdit=false;   // pending family-detail changes: {cat, who, amtDisp, note, dateIso, timeStr, photos}; _exdEdit = view (false) or edit (true)
function _exdDirty(){ return Object.keys(EXD).length>0; }
function _exdRow(opts){   // {label, val, chg, ro, soft, hot, fn}
  var chev=opts.ro?'':'<svg class="csv-schev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m9 6 6 6-6 6"/></svg>';
  var cls='csv-srow'+(opts.ro?' ro':'')+(opts.soft?' soft':'')+(opts.hot?' hot':'')+(opts.chg?' chg':'');
  var inner='<small>'+opts.label+'</small><span class="csv-sval">'+opts.val+chev+'</span>';
  return opts.ro
    ? '<div class="'+cls+'">'+inner+'</div>'
    : '<button type="button" class="'+cls+'" onclick="'+opts.fn+'">'+inner+'</button>';
}
function _exdSecH(title, count){
  return '<div class="exd-sec-h"><span class="t">'+title+'</span>'+(count?'<span class="c">'+count+'</span>':'')+'</div>';
}
/* the reactions block: the family's takes (newest first) + a react bar.
   The bar only appears on a persisted row (t._dbId) — reacting has nowhere to
   write otherwise, exactly like the ledger long-press picker. */
function _exdReactions(t){
  var rs=(t.reactions||[]).slice();
  var html=_exdSecH(L('Cả nhà nói gì','Reactions'), rs.length||'');
  if(rs.length){
    rs.sort(function(a,b){ return a.at<b.at?1:a.at>b.at?-1:0; });
    html+='<div class="exd-rx-list">'+rs.map(function(r){
      return '<div class="exd-rx"><span class="exd-rx-e">'+r.emoji+'</span>'
        +'<span class="exd-rx-msg">'+rxMessage(r,t)+'</span>'+_rxFace(r.memberId)+'</div>';
    }).join('')+'</div>';
  } else {
    html+='<div class="exd-rx-empty">'+L('Chưa có cảm xúc nào — thả một cái nào 👇','No reactions yet — leave one 👇')+'</div>';
  }
  if(t._dbId){
    var mine=_rxMineOn(t._dbId);
    html+='<div class="exd-rx-bar">'+RX.map(function(r){
      return '<button class="exd-rx-bk'+(mine===r.e?' on':'')+'" onclick="expDetailReact(\''+r.e+'\')" aria-label="'+escAttr(L(r.vi,r.en))+'">'+r.e+'</button>';
    }).join('')+'</div>';
  }
  return html;
}
function renderExpenseDetail(){
  var t=(typeof txById==='function')?txById(_expDetailId):null;
  if(!t){ closeExpenseDetail(); return; }
  var body=document.getElementById('exd-body'); if(!body) return;
  if(_exdEdit) exdReadFields();
  // pending values paint over the row's own — with the .chg dot — until Lưu
  var vCat=EXD.cat!=null?EXD.cat:t.cat;
  var vWho=EXD.who!=null?EXD.who:((/^(both|shared)$/i.test(String(t.who||'')))?'Both':t.who);
  var vAmtDisp=EXD.amtDisp!=null?EXD.amtDisp:(typeof amtToInput==='function'?amtToInput(t.amt):String(t.amt));
  var vNote=EXD.note!=null?EXD.note:(t.note||'');
  var vTime=EXD.timeStr!==undefined?EXD.timeStr:(t.time||'');
  var s=catStyle[vCat]||catStyle[t.cat]||['🧾','var(--id-none-tint)','var(--id-none)'];
  var wd=_whoDisp(vWho);
  var isFuture=!!t.future;
  var item=(isFuture && typeof _entNorm==='function')?_entNorm('expense',t,t.id):null;
  var incoming=!!(item && typeof _entPending==='function' && _entPending(item) && typeof _isMine==='function' && !_isMine(item));
  var canEdit=!incoming;
  if(incoming) _exdEdit=false;                                   // someone else's proposal: review only, never edit
  var nav=document.getElementById('exd-nav'); if(nav) nav.innerHTML=_exdNavHTML(canEdit);
  var famName=(window.FAM&&FAM.familyName)||L('Gia đình','Family');
  var mm=_exdMasterOf(t);
  var isAuthor=!!(window.DB&&DB.ownerMemberId&&t._createdBy===DB.ownerMemberId);
  var mAcct=(mm&&mm.accountId&&mm.pd)?((mm.pd.accounts||[]).find(function(a){ return a.id===mm.accountId; })||null):null;
  var acctVal=mAcct?esc(mAcct.name||L('Tài khoản','Account')):(t.inst?esc(t.inst):L('Chưa gắn','Not tagged'));
  var ph=(EXD.photos!==undefined)?EXD.photos:(t.photos||(t.photo?[t.photo]:[]));
  var fIso=(EXD.dateIso!=null)?EXD.dateIso:((typeof txDateInput==='function')?txDateInput(t):'');
  var fDateLbl=(EXD.dateIso!=null)?fmtDateLong(new Date(EXD.dateIso+'T00:00:00')):_exdDate(t);
  var whoLbl=isFuture?L('Đề xuất bởi','Proposed by'):L('Ai trả','Who paid');
  var whoVal='<span class="exd-av" style="'+window.fhAvStyle(wd)+'">'+esc(window.fhAvIni(wd))+'</span><b>'+esc(wd.name)+'</b>';
  var html, rows='';
  if(!_exdEdit){
    /* VIEW — the receipt, the review card's rows read-only, the photo door
       when the row has none, then the family's reactions or the review state. */
    html='<div class="exd-view"><div class="exd-focal">'
      +'<div class="exd-ico" style="background:'+s[1]+';color:'+s[2]+'">'+esc(EXD.cat!=null?s[0]:t.ico)+'</div>'
      +'<div class="exd-amt num">'+esc(vAmtDisp)+(CUR==='VND'?' ₫':'')+'</div>'
      +'<div class="exd-note">'+esc(vNote||L('Khoản chi','Expense'))+'</div>'
      +'<div class="exd-prov">'+esc(_exdDate(t))+(vTime?'<span class="sep">·</span>'+esc(vTime):'')
        +(t.inst?'<span class="sep">·</span>'+esc(t.inst):'')+'</div>'
      +(isFuture?('<div class="exd-plan'+(incoming?' wait':'')+'">'+(incoming?L('chờ bạn duyệt','awaiting your review'):('📅 '+L('Chi tiêu dự kiến','Planned')))+'</div>'):'')
      +'</div>'
      +((!ph.length && canEdit && t._dbId)?_exdDoorHTML(t):'');
    rows+=_exdRow({label:L('Ghi vào đâu','Where to'), ro:true, val:'<b>🏡 '+esc(famName)+'</b>'});
    rows+=_exdRow({label:L('Loại khoản','Kind'), ro:true, val:'<b>'+(isFuture?L('Chi tiêu dự kiến','Planned expense'):L('Chi tiêu','Spending'))+'</b>'});
    rows+=_exdRow({label:L('Danh mục','Category'), ro:true, val:'<b>'+s[0]+' '+esc(vCat)+'</b>'});
    rows+=_exdRow({label:whoLbl, ro:true, val:whoVal});
    rows+=_exdRow({label:L('Ngày','Date'), ro:true, val:'<b class="num">'+esc(_exdDate(t))+'</b>'});
    rows+=_exdRow({label:L('Giờ','Time'), ro:true, soft:!vTime, val:'<b class="num">'+(vTime?esc(vTime):L('Chỉ tính theo ngày','Day only'))+'</b>'});
    if(mm||t.inst) rows+=_exdRow({label:L('Nguồn tiền','Money source'), ro:true, soft:!(mAcct||t.inst), val:'<b>'+acctVal+'</b>'});
    html+='<div class="exd-meta srows"><div class="csv-srows">'+rows+'</div></div>';
    if(ph.length){
      html+=_exdSecH(L('Ảnh','Photos'), ph.length)
        +'<div class="exd-photos">'+ph.map(function(src){ return '<div class="exd-photo" style="background-image:url('+src+')"></div>'; }).join('')+'</div>';
    }
    // A future expense is a proposal: show the family's REVIEW state (distinct
    // from the ledger reactions a realized expense carries).
    if(isFuture){
      if(item && item.creatorId && typeof _gldReviewBlock==='function'){
        html+='<div class="exd-sec-h"><span class="t">'+L('Cả nhà cùng duyệt','Review')+'</span></div>'
          +'<div style="margin:0 16px">'+_gldReviewBlock(item)+'</div>';
      }
    } else {
      html+=_exdReactions(t);
    }
    html+='</div>';
  } else {
    /* EDIT — the review card: Số tiền and Chi cho gì? as top inputs, then the
       rows as pickers. Ghi vào đâu is the author's door back to the private
       book (the move confirm names every consequence, M4); Loại khoản stays a
       fact on a family row (liabilities and portfolios are personal). */
    html='<div class="exd-edit"><div class="exd-meta srows top">'
      +'<div class="field"><label>'+L('Số tiền','Amount')+'</label><input class="num" id="exd-amt-in" inputmode="numeric" onblur="snapAmtInput(this);exdReadFields()" placeholder="'+escAttr((typeof amtPlaceholder==='function')?amtPlaceholder():'')+'" value="'+escAttr(vAmtDisp)+'"></div>'
      +'<div class="field"><label>'+L('Chi cho gì?','What for?')+'</label><textarea id="exd-note-in" rows="2" onblur="exdReadFields()">'+esc(vNote)+'</textarea></div>';
    var canMove=isAuthor && !isFuture && !!t._dbId;
    rows+=_exdRow({label:L('Ghi vào đâu','Where to'), ro:!canMove, val:'<b>🏡 '+esc(famName)+'</b>', fn:'exdMove()'});
    rows+=_exdRow({label:L('Loại khoản','Kind'), ro:true, val:'<b>'+(isFuture?L('Chi tiêu dự kiến','Planned expense'):L('Chi tiêu','Spending'))+'</b>'});
    rows+=_exdRow({label:L('Danh mục','Category'), chg:EXD.cat!=null, val:'<b>'+s[0]+' '+esc(vCat)+'</b>', fn:"exdSheetCat('fam')"});
    rows+=_exdRow({label:whoLbl, chg:EXD.who!=null, ro:isFuture, val:whoVal, fn:"exdSheetWho()"});
    rows+=fhPickRow({label:L('Ngày','Date'), type:'date', value:fIso, on:'exdPickDate', arg:'fam', chg:EXD.dateIso!=null,
      val:'<b class="num">'+esc(fDateLbl)+'</b>'});
    rows+=fhPickRow({label:L('Giờ','Time'), type:'time', value:vTime||'', on:'exdPickTime', arg:'fam', clear:true, chg:EXD.timeStr!==undefined, soft:!vTime,
      val:'<b class="num">'+(vTime?esc(vTime):L('Chỉ tính theo ngày','Day only'))+'</b>'});
    /* Nguồn tiền: the 0131 display string, read-only for everyone except the
       AUTHOR, whose mirror master carries the real account tag (0134,
       account-setup-spec §6). That pick writes straight away (its sheet says so). */
    if(mm) rows+=_exdRow({label:L('Nguồn tiền','Money source'), soft:!mm.accountId, val:'<b>'+acctVal+'</b>', fn:'exdSheetAcctFam()'});
    else if(t.inst) rows+=_exdRow({label:L('Nguồn tiền','Money source'), ro:true, val:'<b>'+esc(t.inst)+'</b>'});
    html+='<div class="csv-srows">'+rows+'</div></div>';
    if(ph.length){
      html+=_exdSecH(L('Ảnh','Photos'), ph.length)
        +'<div class="exd-photos">'+ph.map(function(src,i){ return '<div class="exd-photo" style="background-image:url('+src+')"><button type="button" class="x" onclick="exdPhotoRemove('+i+')" aria-label="'+escAttr(L('Bỏ ảnh này','Remove this photo'))+'">✕</button></div>'; }).join('')
        +(t._dbId?'<label class="exd-photo add" aria-label="'+escAttr(L('Thêm ảnh','Add a photo'))+'">＋'+_exdPickInput(false)+'</label>':'')+'</div>';
    } else if(t._dbId) html+=_exdDoorHTML(t);
    html+='<button type="button" class="exd-del" id="exd-del" onclick="expDetailDelete()">'+L('Xoá khoản này','Delete this expense')+'</button></div>';
  }
  body.innerHTML=html;
  var cta=document.getElementById('exd-cta');
  if(cta) cta.innerHTML=incoming ? '<button class="cta" onclick="expDetailReview()">'+L('Duyệt','Review')+'</button>' : '';   // decide someone else's proposal; otherwise no bar
  _resetExdDel();
}
var _EXD_BACK='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M15 18l-6-6 6-6"/></svg>';
function _exdNavHTML(canEdit){
  if(!_exdEdit) return '<button type="button" class="cd-back" onclick="closeExpenseDetail()">'+_EXD_BACK+'<span>'+L('Quay lại','Back')+'</span></button><span></span>'
    +(canEdit?'<button type="button" class="cd-act" onclick="exdEdit()">'+L('Sửa','Edit')+'</button>':'<span></span>');
  return '<button type="button" class="cd-act cancel" onclick="exdCancel()">'+L('Huỷ','Cancel')+'</button><span class="cd-navtitle">'+L('Sửa khoản chi','Edit expense')+'</span>'
    +'<button type="button" class="cd-act" id="exd-save" onclick="exdSave()">'+L('Lưu','Save')+'</button>';
}
function exdEdit(){ if(_expDetailId==null) return; EXD={}; _exdEdit=true; renderExpenseDetail(); }
function exdCancel(){ EXD={}; _exdEdit=false; _resetExdDel(); renderExpenseDetail(); }
/* the two top inputs → EXD, read before every re-render and before Lưu */
function exdReadFields(){
  var t=(typeof txById==='function')?txById(_expDetailId):null; if(!t) return;
  var a=document.getElementById('exd-amt-in'), n=document.getElementById('exd-note-in');
  if(a){ var v=a.value.trim(), base=(typeof amtToInput==='function')?amtToInput(t.amt):String(t.amt||''); if(v && v!==base) EXD.amtDisp=v; else delete EXD.amtDisp; }
  if(n){ var nv=n.value.trim(); if(nv!==(t.note||'')) EXD.note=nv; else delete EXD.note; }
}
window.exdReadFields=exdReadFields;
/* Ghi vào đâu → the existing move confirm (59-ledger-move-ui), author-only,
   realized rows only — the same engine the composer's chip flip used. */
function exdMove(){
  if(_expDetailId==null) return;
  if(navigator.onLine===false){ toast(L('Cần mạng để chuyển sổ','You need to be online to move this')); return; }
  _mvCtx={dir:'f2p', localId:_expDetailId, cur:'family'};
  fhMoveSheetOpen();
}
window.exdMove=exdMove;
/* ── the photo door on a family row: same card, same copy rules as the
   personal side (pexdDoorCopy); the write is the photo-assign path (paApply,
   wrapped in 50-writethrough → _dbSyncTxnPhotos), which encrypts for an enc
   family and refuses on a locked device. ── */
function _exdPickInput(cam){
  return '<input type="file" accept="image/*"'+(cam?' capture="environment"':' multiple')+' onchange="exdDoorPick(this)" hidden>';
}
function _exdDoorHTML(t){
  var c=pexdDoorCopy({cat:t.cat, note:t.note, amt:t.amt, src:t.inst||null, date:(typeof txDateInput==='function')?txDateInput(t):''});
  var cam='<label class="pdoor-btn'+(c.pri==='cam'?' pri':'')+'">'+_PEXD_ICO.cam+L('Chụp ảnh','Take a photo')+_exdPickInput(true)+'</label>';
  var lib='<label class="pdoor-btn'+(c.pri==='lib'?' pri':'')+'">'+_PEXD_ICO.lib+L('Thư viện','Library')+_exdPickInput(false)+'</label>';
  return '<div class="pdoor"><span class="pdoor-mk">'+_PEXD_ICO.receipt+'</span>'
    +'<div class="pdoor-q">'+esc(c.q)+'</div><div class="pdoor-w">'+esc(c.w)+'</div>'
    +'<div class="pdoor-acts">'+(c.pri==='cam'?cam+lib:lib+cam)+'</div></div>';
}
function exdDoorPick(input){
  var files=Array.prototype.slice.call(input.files||[]); input.value='';
  var id=_expDetailId; if(!files.length || id==null) return;
  var t=(typeof txById==='function')?txById(id):null; if(!t||!t._dbId) return;
  if(navigator.onLine===false){ toast(L('Cần mạng để thêm ảnh','You need to be online to add photos')); return; }
  var room=10-((t.photos||(t.photo?[t.photo]:[])).length);
  if(room<=0){ toast(L('Tối đa 10 ảnh','Up to 10 photos')); return; }
  if(files.length>room){ toast(L('Tối đa 10 ảnh','Up to 10 photos')); files=files.slice(0,room); }
  var srcs=[], left=files.length;
  files.forEach(function(f){ readPhoto(f, function(src){ if(src) srcs.push(src); if(--left===0) _exdDoorUpload(id, srcs); }); });
}
window.exdDoorPick=exdDoorPick;
async function _exdDoorUpload(id, srcs){
  if(!srcs.length) return;
  var r=null;
  try{ r=await window.paApply(id, srcs); }catch(e){ r=null; }   // null = write-locked (the wrapper's own refusal) or row gone
  if(_expDetailId===id) renderExpenseDetailIfOpen();
  toast(r?L('Đã thêm ảnh','Photos added'):L('Chưa thêm được ảnh, thử lại nhé','Couldn’t add the photos, try again'));
}
/* removing a photo is staged: the strip shows the kept set, Lưu hands the kept
   list to the composer's own save path, which reconciles rows + storage. */
function exdPhotoRemove(i){
  var t=(typeof txById==='function')?txById(_expDetailId):null; if(!t) return;
  var cur=(EXD.photos!==undefined?EXD.photos:(t.photos||(t.photo?[t.photo]:[]))).slice();
  cur.splice(i,1); EXD.photos=cur;
  renderExpenseDetail();
}
window.exdPhotoRemove=exdPhotoRemove;
/* Review → the existing react-to-align picker (64-requests.js), opened over the detail. */
function expDetailReview(){ if(_expDetailId!=null && typeof openReview==='function') openReview('expense', _expDetailId); }
window.expDetailReview=expDetailReview;
window.renderExpenseDetail=renderExpenseDetail;
/* The author's mirror master for a family row (0134). Cached per family row
   id; resolved async on first ask (one select for link_id, then a P.txns
   lookup), re-rendering the open detail when it lands. null = not the author,
   ledger locked, or the master is outside the loaded window → the row stays
   the read-only 0131 string. */
var _exdMasters={};
function _exdMasterOf(t){
  if(!t||!t._dbId||!window.DB||!DB.ownerMemberId||t._createdBy!==DB.ownerMemberId) return null;
  var pd=window.fhPersonalData?fhPersonalData():null; if(!pd||pd.state!=='ready') return null;
  var c=_exdMasters[t._dbId];
  if(c===undefined){
    _exdMasters[t._dbId]=null;   // in flight
    var fam=t._dbId;
    window.sb.from('transactions').select('link_id').eq('id',fam).maybeSingle().then(function(r){
      var link=r&&r.data&&r.data.link_id;
      var m=link?((pd.txns||[]).find(function(x){ return x.linkId===link; })||null):null;
      _exdMasters[fam]=m?{masterId:m.id, link:link}:false;
      if(m && _expDetailId!=null){ var lt=txById(_expDetailId); if(lt&&lt._dbId===fam) renderExpenseDetailIfOpen(); }
    }).catch(function(){ _exdMasters[fam]=false; });
    return null;
  }
  if(!c) return null;
  var m2=(pd.txns||[]).find(function(x){ return x.id===c.masterId; });
  if(!m2) return null;
  return {masterId:c.masterId, accountId:m2.accountId||null, pd:pd};
}
function exdSheetAcctFam(){
  var t=(typeof txById==='function')?txById(_expDetailId):null; if(!t) return;
  var mm=_exdMasterOf(t); if(!mm) return;
  setTxt('exdacct-h', L('Nguồn tiền','Money source'));
  setTxt('exdacct-sub', L('Gắn để dư nợ thẻ, số dư tài khoản tính đúng · chỉ sổ của bạn biết thẻ nào','Tag it so the card or account balance is right · only your ledger knows which'));
  var ico={deposit:'🏦',ewallet:'📱',credit_card:'💳',cash:'💵'};
  var h='<button type="button" class="choice'+(mm.accountId?'':' on')+'" onclick="exdPickAcctFam(&#39;&#39;)">'+L('Chưa gắn','Not tagged')+'</button>';
  ((mm.pd.accounts||[]).filter(function(a){ return a.kind!=='investment'; })).forEach(function(a){
    h+='<button type="button" class="choice'+(a.id===mm.accountId?' on':'')+'" onclick="exdPickAcctFam(&#39;'+escAttr(a.id)+'&#39;)">'+(ico[a.kind]||'🏦')+' '+esc(a.name||L('Tài khoản','Account'))+'</button>';
  });
  setHTML('exdacct-list', h);
  openSheet('sheet-exd-acct');
}
window.exdSheetAcctFam=exdSheetAcctFam;
/* Writes straight away (no staged Lưu): the tag is the personal side's
   own field, and the family row's display string follows it (spec Q31). */
async function exdPickAcctFam(id){
  closeSheet();
  var t=(typeof txById==='function')?txById(_expDetailId):null; if(!t) return;
  var mm=_exdMasterOf(t); if(!mm||!window.fhPersonalMasterSetAccount) return;
  var ok=false; try{ ok=await fhPersonalMasterSetAccount(mm.masterId, id||null); }catch(e){}
  if(!ok){ toast(L('Chưa lưu được, thử lại nhé','Couldn’t save, try again')); return; }
  var a=id?((mm.pd.accounts||[]).find(function(x){ return x.id===id; })||null):null;
  var inst=a?((window.fhAccountInstString&&fhAccountInstString(a))||a.name||null):null;
  try{ await window.sb.from('transactions').update({instrument:inst}).eq('id',t._dbId); t.inst=inst; }catch(e){}
  toast(id?L('Đã gắn nguồn tiền','Money source tagged'):L('Đã bỏ gắn','Tag removed'));
  renderExpenseDetailIfOpen();
  if(typeof renderPersonal==='function'){ try{ renderPersonal(); }catch(e){} }
}
window.exdPickAcctFam=exdPickAcctFam;
function openExpenseDetail(id){
  var t=(typeof txById==='function')?txById(id):null; if(!t) return;
  _expDetailId=id;
  EXD={}; _exdEdit=false;                   // fresh open, view state, no pending edits
  renderExpenseDetail();
  document.getElementById('exp-overlay').classList.add('on');
  var sc=document.querySelector('#exp-overlay .cd-scroll'); if(sc) sc.scrollTop=0;
}
window.openExpenseDetail=openExpenseDetail;
function closeExpenseDetail(){
  _resetExdDel();
  var o=document.getElementById('exp-overlay'); if(o) o.classList.remove('on');
  _expDetailId=null; EXD={}; _exdEdit=false;
}
window.closeExpenseDetail=closeExpenseDetail;
/* re-render if the detail is on screen (after an edit, a delete, or a reaction —
   local or arrived over realtime); if its expense is gone, back out cleanly. */
function renderExpenseDetailIfOpen(){
  var o=document.getElementById('exp-overlay'); if(!o || !o.classList.contains('on')) return;
  if(!txById(_expDetailId)){ closeExpenseDetail(); return; }
  renderExpenseDetail();
}
window.renderExpenseDetailIfOpen=renderExpenseDetailIfOpen;

/* Update → the existing edit modal, opened over the detail. On save/cancel it
   closes and the detail (still underneath) refreshes via renderExpenseDetailIfOpen. */
function expDetailEdit(){ if(_expDetailId!=null && typeof openEditExpense==='function') openEditExpense(_expDetailId); }
window.expDetailEdit=expDetailEdit;
function expDetailReact(emoji){
  var t=(typeof txById==='function')?txById(_expDetailId):null;
  if(t && t._dbId && typeof throwReaction==='function') throwReaction(t._dbId, emoji);   // throwReaction re-renders the detail via renderExpenseDetailIfOpen
}
window.expDetailReact=expDetailReact;

/* Delete — its own arm-then-confirm, then hands off to the persisting delete path
   (55/50 wrap deleteExpense by name and key off editingTx). Seeding delArmed=true
   lets that one call execute instead of re-arming the modal's hidden button. */
function _resetExdDel(){
  _exdDelArmed=false; clearTimeout(_exdDelT);
  var b=document.getElementById('exd-del'); if(b){ b.classList.remove('armed'); b.textContent=L('Xoá khoản này','Delete this expense'); }
}
function expDetailDelete(){
  var b=document.getElementById('exd-del');
  if(!_exdDelArmed){
    _exdDelArmed=true; if(b){ b.classList.add('armed'); b.textContent=L('Chạm lần nữa để xoá','Tap again to delete'); }
    clearTimeout(_exdDelT); _exdDelT=setTimeout(_resetExdDel,3000); return;
  }
  _resetExdDel();
  if(_expDetailId==null){ closeExpenseDetail(); return; }
  editingTx=_expDetailId; delArmed=true;                  // hand off to the wrapped, persisting deleteExpense()
  if(typeof deleteExpense==='function') deleteExpense();
  closeExpenseDetail();
}
window.expDetailDelete=expDetailDelete;

/* ═══ restyle #5 — the row-picker sheets (shared: family 'fam' / personal 'pers')
   and the staged saves. A pick stages into EXD/PXD and re-renders its detail;
   nothing is written until Lưu. ═══ */
var _exdMode='fam';
function _exdCur(field, fallback){   // pending value else the row's own
  var P=(_exdMode==='fam')?EXD:PXD;
  return (P[field]!==undefined)?P[field]:fallback;
}
function _exdStage(field, val){
  var P=(_exdMode==='fam')?EXD:PXD;
  P[field]=val;
  if(_exdMode==='fam') renderExpenseDetail(); else renderPersonalTxDetail();
}
function _exdRowOf(){
  return _exdMode==='fam'
    ? ((typeof txById==='function')?txById(_expDetailId):null)
    : ((typeof _pTxById==='function')?_pTxById(_pexdId):null);
}
function exdSheetCat(mode){
  _exdMode=mode; var t=_exdRowOf(); if(!t) return;
  var cur=_exdCur('cat', t.cat);
  var cats=(window.catOrder||[]).slice();
  if(cur && cats.indexOf(cur)<0) cats.unshift(cur);       // a personal-only name stays pickable
  setTxt('exdcat-h', L('Danh mục','Category'));
  setTxt('exdcat-sub', L('Thay đổi chờ tới khi bấm Lưu','Waits for Save'));
  setHTML('exdcat-list', cats.map(function(c){
    var em=(catStyle[c]||['🏷️'])[0];
    return '<button type="button" class="choice'+(c===cur?' on':'')+'" onclick="exdPickCat(&#39;'+escAttr(c)+'&#39;)">'+em+' '+esc(c)+'</button>';
  }).join(''));
  openSheet('sheet-exd-cat');
}
function exdPickCat(c){ closeSheet(); _exdStage('cat', c); }
function exdSheetWho(){
  _exdMode='fam'; var t=_exdRowOf(); if(!t) return;
  var cur=_exdCur('who', (/^(both|shared)$/i.test(String(t.who||''))?'Both':t.who));
  setTxt('exdwho-h', L('Ai trả','Who paid'));
  setTxt('exdwho-sub', L('Thay đổi chờ tới khi bấm Lưu','Waits for Save'));
  var names=Object.keys(window.membersMeta||{}).filter(function(n){ return n!=='Shared'; });
  setHTML('exdwho-list', names.map(function(n){
    var wd=_whoDisp(n);
    return '<button type="button" class="choice'+(n===cur?' on':'')+'" onclick="exdPickWho(&#39;'+escAttr(n)+'&#39;)">'
      +'<span class="exd-av" style="'+window.fhAvStyle(wd)+'">'+esc(window.fhAvIni(wd))+'</span> '+esc(n)+'</button>';
  }).join('')+'<button type="button" class="choice'+(cur==='Both'?' on':'')+'" onclick="exdPickWho(&#39;Both&#39;)">'+L('Chung','Both')+'</button>');
  openSheet('sheet-exd-who');
}
function exdPickWho(w){ closeSheet(); _exdStage('who', w); }
function exdSheetAmt(mode){
  _exdMode=mode; var t=_exdRowOf(); if(!t) return;
  var amt=_exdCur('amtDisp', (typeof amtToInput==='function')?amtToInput(t.amt):String(t.amt||''));
  var note=_exdCur('note', t.note||'');
  setTxt('exdamt-h', L('Số tiền & ghi chú','Amount & note'));
  setTxt('exdamt-sub', L('Gõ thì cần Xong · thay đổi chờ Lưu','Type, then Done · saves with Save'));
  setHTML('exdamt-body',
    '<span class="crs-lbl">'+L('Số tiền','Amount')+'</span>'
    +'<input class="crs-in num" id="exd-in-amt" inputmode="numeric" onblur="snapAmtInput(this)" value="'+escAttr(amt)+'">'
    +'<span class="crs-lbl" style="margin-top:14px">'+L('Chi cho gì?','What for?')+'</span>'
    +'<input class="crs-in" id="exd-in-note" value="'+escAttr(note)+'">'
    +'<button type="button" class="crs-done" onclick="exdAmtDone()">'+L('Xong','Done')+'</button>');
  openSheet('sheet-exd-amt');
}
function exdAmtDone(){
  var a=(document.getElementById('exd-in-amt')||{}).value||'';
  var n=(document.getElementById('exd-in-note')||{}).value||'';
  if(!(parseAmtBase(a)>0)){ var el=document.getElementById('exd-in-amt'); if(el) el.focus(); return; }
  closeSheet();
  var P=(_exdMode==='fam')?EXD:PXD;
  P.amtDisp=a.trim(); P.note=n.trim();
  if(_exdMode==='fam') renderExpenseDetail(); else renderPersonalTxDetail();
}
/* Ngày / Giờ picker rows (fhPickRow): the OS picker's change lands straight in
   the pending edits — staged like every other row, saved with Lưu. A
   cleared date is ignored (a row always has a day); a cleared time means
   day-only. */
function exdPickDate(mode, v, final){
  if(!v) return null;
  _exdMode=mode; var P=(mode==='fam')?EXD:PXD; P.dateIso=v;
  if(!final) return '<b class="num">'+esc(mode==='fam' ? fmtDateLong(new Date(v+'T00:00:00')) : v.slice(8,10)+'/'+v.slice(5,7))+'</b>';
  if(mode==='fam') renderExpenseDetail(); else renderPersonalTxDetail();
}
function exdPickTime(mode, v, final){
  _exdMode=mode; var P=(mode==='fam')?EXD:PXD; P.timeStr=v||'';
  if(!final) return '<b class="num">'+(v?esc(v):L('Chỉ tính theo ngày','Day only'))+'</b>';
  if(mode==='fam') renderExpenseDetail(); else renderPersonalTxDetail();
}
/* Lưu (family): apply the staged set through the composer's own persisting
   path — fill the editor fields invisibly, overlay the pendings, then call the
   WRAPPED saveExpenseEdit(), which does the aggregates, the enc-correct write
   and the re-render. One write, all fields, same code path as a manual edit. */
function exdSave(){
  var t=(typeof txById==='function')?txById(_expDetailId):null; if(!t) return;
  exdReadFields();
  if(!_exdDirty()){ _exdEdit=false; renderExpenseDetail(); return; }   // nothing changed: Lưu just leaves edit
  var p=EXD; EXD={}; _exdEdit=false;
  editingTx=_expDetailId;
  if(typeof buildExCatChips==='function') buildExCatChips();   // chips must exist before chosen('ex-cat') reads them
  if(typeof fillExpenseFromTx==='function') fillExpenseFromTx();
  if(p.note!=null) document.getElementById('ex-note').value=p.note;
  if(p.amtDisp!=null) document.getElementById('ex-amt').value=p.amtDisp;
  if(p.cat!=null && typeof selectChipByVal==='function') selectChipByVal('ex-cat', p.cat);
  if(p.who!=null && typeof selectChipByVal==='function') selectChipByVal('ex-who', p.who);
  if(p.dateIso!=null) document.getElementById('ex-date').value=p.dateIso;
  if(p.timeStr!==undefined){ var te=document.getElementById('ex-time'); if(te){ te.value=p.timeStr; if(typeof onExTimeTouched==='function') onExTimeTouched(); } }
  if(p.photos!==undefined){ exPhotos=p.photos.slice(); if(typeof renderExPhoto==='function') renderExPhoto(); }   // staged removals ride the composer's photo list
  saveExpenseEdit();                                       // wrapped → persists + renderExpenseDetailIfOpen
}
window.exdSave=exdSave;

/* ═══ the PERSONAL expense detail — view first, edit second (2026-09-17) ═══
   Entry for list taps. The screen opens in VIEW: the receipt read large, the
   row facts with no chevron and no tap, the photos, and nothing that changes
   data. "Sửa" in the nav flips it to EDIT: the review card's own top fields
   (Số tiền, Chi cho gì?) over the same rows now tappable, the nav reads
   Huỷ · Sửa khoản chi · Lưu, and delete is the muted foot line. Everything
   staged in PXD lands in ONE fhPersonalUpdateExpense on Lưu; Huỷ drops it.
   The row set is the review card's, same labels, same order — a queue card and
   a detail are the same object in two states (mockups/txn-detail-view-edit.html
   option 1). The photo door is the tab's empty-card recipe with copy written
   from the row itself (mockups/photo-door-contextual.html option 1). */
var _pexdId=null, PXD={}, _pexdEdit=false, _pexdDelArmed=false, _pexdDelT=null;
function _pxdDirty(){ return Object.keys(PXD).length>0; }
function openPersonalTxDetail(id){
  var t=(typeof _pTxById==='function')?_pTxById(id):null;
  if(!t || t._unreadable || t.spaceId || t.linkId) return;         // private, readable rows only
  if(t.kind && t.kind!=='expense'){ if(typeof openPersonalTxEdit==='function') openPersonalTxEdit(id); return; }   // kinds keep their own sheets
  _pexdId=id; PXD={}; _pexdEdit=false;
  renderPersonalTxDetail();
  document.getElementById('pexd-overlay').classList.add('on');
  var sc=document.querySelector('#pexd-overlay .cd-scroll'); if(sc) sc.scrollTop=0;
}
window.openPersonalTxDetail=openPersonalTxDetail;
function closePersonalTxDetail(){
  _pxdResetDel();
  var o=document.getElementById('pexd-overlay'); if(o) o.classList.remove('on');
  _pexdId=null; PXD={}; _pexdEdit=false;
}
window.closePersonalTxDetail=closePersonalTxDetail;
function pexdEdit(){ if(_pexdId==null) return; PXD={}; _pexdEdit=true; renderPersonalTxDetail(); }
function pexdCancel(){ PXD={}; _pexdEdit=false; _pxdResetDel(); renderPersonalTxDetail(); }
function _pexdDateLong(iso){
  if(!iso) return '';
  var d=new Date(iso+'T00:00:00');
  return (typeof fmtDateLong==='function')?fmtDateLong(d):iso;
}
/* The two top inputs are read into PXD before every re-render and before Lưu,
   so a category pick (which re-renders) never drops a half-typed note. A value
   equal to the row's own is not a change. */
function pexdReadFields(){
  var t=(typeof _pTxById==='function')?_pTxById(_pexdId):null; if(!t) return;
  var a=document.getElementById('pexd-amt'), n=document.getElementById('pexd-note');
  if(a){ var v=a.value.trim(), base=(typeof amtToInput==='function')?amtToInput(t.amt):String(t.amt||''); if(v && v!==base) PXD.amtDisp=v; else delete PXD.amtDisp; }
  if(n){ var nv=n.value.trim(); if(nv!==(t.note||'')) PXD.note=nv; else delete PXD.note; }
}
window.pexdReadFields=pexdReadFields;
var _PEXD_BACK='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M15 18l-6-6 6-6"/></svg>';
function _pexdNavHTML(){
  if(!_pexdEdit) return '<button type="button" class="cd-back" onclick="closePersonalTxDetail()">'+_PEXD_BACK+'<span>Cá nhân</span></button><span></span>'
    +'<button type="button" class="cd-act" onclick="pexdEdit()">Sửa</button>';
  return '<button type="button" class="cd-act cancel" onclick="pexdCancel()">Huỷ</button><span class="cd-navtitle">Sửa khoản chi</span>'
    +'<button type="button" class="cd-act" id="pexd-save" onclick="pexdSave()">Lưu</button>';
}
/* ── the photo door: copy from the row, no emoji, SVG marks (DESIGN.md §2.6) ── */
function _pexdSvg(d){ return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">'+d+'</svg>'; }
var _PEXD_ICO={
  receipt:_pexdSvg('<path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6"/>'),
  cam:_pexdSvg('<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.2"/>'),
  lib:_pexdSvg('<rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="m4 17 5-5 4 4 3-3 4 4"/><circle cx="16" cy="9.5" r="1.4"/>')
};
function _pexdFold(s){ return String(s||'').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/đ/g,'d'); }
/* What the card asks depends on the row: the category and note write the
   question, the amount changes the tone above 5.000.000 ₫ (warranty, not
   memory), and the likelier button leads — an email-captured or older row's
   photo is probably already in the library; today's hand-logged one is still
   in the pocket. */
function pexdDoorCopy(t){
  var cat=_pexdFold(t.cat), note=String(t.note||'').trim();
  var name=(note?note.split(/\s+[-·|]\s+/)[0].slice(0,28):'')||t.cat||'';
  var amt=Number(t.amt)||0, big=amt>=5000;              // base units of 1.000đ
  var q,w;
  if(big){ q='Giữ hoá đơn '+(name||'khoản này')+' để bảo hành?'; w='Khoản '+fmt(amt)+' đáng có chứng từ, đỡ phải tìm sau này.'; }
  else if(/\b(an uong|an ngoai|cafe|ca phe|do an|nha hang|tra sua|food)\b/.test(cat)){ q='Hoá đơn '+(name||'quán')+' đâu?'; w='Chụp lại để nhớ đã gọi gì cho ai.'; }
  else if(/\b(nha o|dien|nuoc|internet|thue nha|hoa don)\b/.test(cat)){ q='Giữ biên lai '+(name||'khoản này')+'?'; w='Để khớp số khi cần tra lại.'; }
  else if(/\b(di lai|xang|grab|taxi|xe|ve)\b/.test(cat)){ q='Có vé hay biên lai '+(name||'chuyến này')+'?'; w='Một tấm ảnh là đủ nhớ chuyến đi.'; }
  else if(/\b(suc khoe|thuoc|benh|kham|y te)\b/.test(cat)){ q='Giữ toa thuốc hay hoá đơn?'; w='Lần khám sau tìm lại rất nhanh.'; }
  else if(/\b(mua sam|quan ao|do dung|dien tu|shopping|gia dung)\b/.test(cat)){ q='Giữ hoá đơn '+(name||'khoản này')+'?'; w='Đổi trả hay bảo hành đều cần nó.'; }
  else { q='Có hoá đơn cho khoản này?'; w='Chụp lại để tháng sau còn nhớ đã mua gì.'; }
  var d=new Date(), today=d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');   // local, never toISOString
  var pri=(t.src || t.date!==today)?'lib':'cam';
  return {q:q, w:w, pri:pri};
}
window.pexdDoorCopy=pexdDoorCopy;
function _pexdPickInput(cam){
  return '<input type="file" accept="image/*"'+(cam?' capture="environment"':' multiple')+' onchange="pexdDoorPick(this)" hidden>';
}
function _pexdDoorHTML(t){
  var c=pexdDoorCopy(t);
  var cam='<label class="pdoor-btn'+(c.pri==='cam'?' pri':'')+'">'+_PEXD_ICO.cam+'Chụp ảnh'+_pexdPickInput(true)+'</label>';
  var lib='<label class="pdoor-btn'+(c.pri==='lib'?' pri':'')+'">'+_PEXD_ICO.lib+'Thư viện'+_pexdPickInput(false)+'</label>';
  return '<div class="pdoor"><span class="pdoor-mk">'+_PEXD_ICO.receipt+'</span>'
    +'<div class="pdoor-q">'+esc(c.q)+'</div><div class="pdoor-w">'+esc(c.w)+'</div>'
    +'<div class="pdoor-acts">'+(c.pri==='cam'?cam+lib:lib+cam)+'</div></div>';
}
/* Adding photos is its own write, not a staged field: the person tapped a
   button that says Chụp ảnh. Read EXIF first (readPhoto), then the personal
   upload path encrypts under the personal key. */
function pexdDoorPick(input){
  var files=Array.prototype.slice.call(input.files||[]); input.value='';
  var id=_pexdId; if(!files.length || id==null) return;
  if(!(window.fhPersonalKeyReady && fhPersonalKeyReady())){ toast('Mở khoá sổ cá nhân trước đã'); return; }
  if(navigator.onLine===false){ toast('Cần mạng để thêm ảnh'); return; }
  var t=(typeof _pTxById==='function')?_pTxById(id):null;
  var room=10-((t&&t.photos)||[]).length;
  if(room<=0){ toast('Tối đa 10 ảnh'); return; }
  if(files.length>room){ toast('Tối đa 10 ảnh'); files=files.slice(0,room); }
  var srcs=[], left=files.length;
  files.forEach(function(f){ readPhoto(f, function(src){ if(src) srcs.push(src); if(--left===0) _pexdDoorUpload(id, srcs); }); });
}
window.pexdDoorPick=pexdDoorPick;
async function _pexdDoorUpload(id, srcs){
  if(!srcs.length) return;
  var ok=false;
  try{ ok=await window.fhPersonalUploadTxnPhotos(id, srcs); await window.fhPersonalHydrate(); }catch(e){}
  if(_pexdId===id) renderPersonalTxDetail();
  if(typeof renderPersonal==='function'){ try{ renderPersonal(); }catch(e){} }
  if(typeof refreshPersonalTxnOverlay==='function') refreshPersonalTxnOverlay();
  toast(ok?'Đã thêm ảnh':'Chưa lưu được ảnh, thử lại nhé');
}
/* removing a photo is staged like a field: the strip shows the kept set, Lưu
   reconciles through fhPersonalSyncTxnPhotos (rows + storage objects). */
function pexdPhotoRemove(i){
  var t=(typeof _pTxById==='function')?_pTxById(_pexdId):null; if(!t) return;
  var cur=(PXD.photos!==undefined?PXD.photos:(t.photos||[])).slice();
  cur.splice(i,1); PXD.photos=cur;
  renderPersonalTxDetail();
}
window.pexdPhotoRemove=pexdPhotoRemove;
function renderPersonalTxDetail(){
  var t=(typeof _pTxById==='function')?_pTxById(_pexdId):null;
  if(!t){ closePersonalTxDetail(); return; }
  var body=document.getElementById('pexd-body'); if(!body) return;
  if(_pexdEdit) pexdReadFields();
  var nav=document.getElementById('pexd-nav'); if(nav) nav.innerHTML=_pexdNavHTML();
  var vCat=PXD.cat!=null?PXD.cat:(t.cat||'');
  var vAmtDisp=PXD.amtDisp!=null?PXD.amtDisp:((typeof amtToInput==='function')?amtToInput(t.amt):String(t.amt||''));
  var vNote=PXD.note!=null?PXD.note:(t.note||'');
  var vTime=PXD.timeStr!==undefined?PXD.timeStr:(t.time||'');
  var vDate=PXD.dateIso!=null?PXD.dateIso:(t.date||'');
  var em=PXD.cat!=null?((catStyle[vCat]||['🏷️'])[0]):(t.emoji||'🗂️');
  var pd=window.fhPersonalData?fhPersonalData():null;
  var acctId=PXD.hasOwnProperty('accountId')?PXD.accountId:(t.accountId||null);
  var acct=acctId&&pd?((pd.accounts||[]).find(function(a){ return a.id===acctId; })||null):null;
  var acctVal=acct?esc(acct.name||'Tài khoản'):(acctId?'Tài khoản':'Chưa rõ');
  var dateVal=vDate?vDate.slice(8,10)+'/'+vDate.slice(5,7):'';
  var ph=(PXD.photos!==undefined)?PXD.photos:(t.photos||[]);
  var html, rows='';
  if(!_pexdEdit){
    /* VIEW — the receipt, read-only rows in the review card's vocabulary,
       the photo door when the row has none, the strip when it has some. */
    html='<div class="exd-view"><div class="exd-focal">'
      +'<div class="exd-ico" style="background:var(--fill-neutral)">'+esc(em)+'</div>'
      +'<div class="exd-amt num">'+esc(vAmtDisp)+(CUR==='VND'?' ₫':'')+'</div>'
      +'<div class="exd-note">'+esc(vNote||vCat||'Khoản chi')+'</div>'
      +'<div class="exd-prov">'+esc(_pexdDateLong(vDate))+(vTime?'<span class="sep">·</span>'+esc(vTime):'')+'</div>'
      +'</div>'
      +(ph.length?'':_pexdDoorHTML(t));
    rows+=_exdRow({label:'Ghi vào đâu', ro:true, val:'<b>🔒 Cá nhân</b>'});
    rows+=_exdRow({label:'Loại khoản', ro:true, val:'<b>Chi tiêu</b>'});
    rows+=_exdRow({label:'Danh mục', ro:true, soft:!vCat, val:'<b>'+esc(em)+' '+esc(vCat||'Chưa rõ')+'</b>'});
    rows+=_exdRow({label:'Ngày', ro:true, val:'<b class="num">'+esc(dateVal)+'</b>'});
    rows+=_exdRow({label:'Giờ', ro:true, soft:!vTime, val:'<b class="num">'+(vTime?esc(vTime):'Chỉ tính theo ngày')+'</b>'});
    rows+=_exdRow({label:'Nguồn tiền', ro:true, soft:!acctId, val:'<b>'+acctVal+'</b>'});
    html+='<div class="exd-meta srows"><div class="csv-srows">'+rows+'</div></div>';
    if(ph.length){
      html+=_exdSecH('Ảnh', ph.length)
        +'<div class="exd-photos">'+ph.map(function(src){ return '<div class="exd-photo" style="background-image:url('+src+')"></div>'; }).join('')+'</div>';
    }
    html+='</div>';
  } else {
    /* EDIT — the review card: Số tiền and Chi cho gì? as top inputs, then the
       rows as pickers. Ghi vào đâu is the cross-ledger door (never a silent
       re-scope, M4); Loại khoản opens the kind sheet. */
    html='<div class="exd-edit"><div class="exd-meta srows top">'
      +'<div class="field"><label>Số tiền</label><input class="num" id="pexd-amt" inputmode="numeric" onblur="snapAmtInput(this);pexdReadFields()" placeholder="'+escAttr((typeof amtPlaceholder==='function')?amtPlaceholder():'')+'" value="'+escAttr(vAmtDisp)+'"></div>'
      +'<div class="field"><label>Chi cho gì?</label><textarea id="pexd-note" rows="2" onblur="pexdReadFields()">'+esc(vNote)+'</textarea></div>';
    rows+=_exdRow({label:'Ghi vào đâu', val:'<b>🔒 Cá nhân</b>', fn:'pexdMove()'});
    rows+=_exdRow({label:'Loại khoản', val:'<b>Chi tiêu</b>', fn:'pexdSheetKind()'});
    rows+=_exdRow({label:'Danh mục', chg:PXD.cat!=null, soft:!vCat, val:'<b>'+esc(em)+' '+esc(vCat||'Chưa rõ')+'</b>', fn:"exdSheetCat('pers')"});
    rows+=fhPickRow({label:'Ngày', type:'date', value:vDate||'', on:'exdPickDate', arg:'pers', chg:PXD.dateIso!=null,
      val:'<b class="num">'+esc(dateVal)+'</b>'});
    rows+=fhPickRow({label:'Giờ', type:'time', value:vTime||'', on:'exdPickTime', arg:'pers', clear:true, chg:PXD.timeStr!==undefined, soft:!vTime,
      val:'<b class="num">'+(vTime?esc(vTime):'Chỉ tính theo ngày')+'</b>'});
    rows+=_exdRow({label:'Nguồn tiền', chg:PXD.hasOwnProperty('accountId'), soft:!acctId, val:'<b>'+acctVal+'</b>', fn:'pexdSheetAcct()'});
    html+='<div class="csv-srows">'+rows+'</div></div>';
    if(ph.length){
      html+=_exdSecH('Ảnh', ph.length)
        +'<div class="exd-photos">'+ph.map(function(src,i){ return '<div class="exd-photo" style="background-image:url('+src+')"><button type="button" class="x" onclick="pexdPhotoRemove('+i+')" aria-label="Bỏ ảnh này">✕</button></div>'; }).join('')
        +'<label class="exd-photo add" aria-label="Thêm ảnh">＋'+_pexdPickInput(false)+'</label></div>';
    } else html+=_pexdDoorHTML(t);
    html+='<button type="button" class="exd-del" id="pexd-del" onclick="pexdDelete()">Xoá khoản này</button></div>';
  }
  body.innerHTML=html;
  var cta=document.getElementById('pexd-cta'); if(cta) cta.innerHTML='';
  _pxdResetDel();
}
window.renderPersonalTxDetail=renderPersonalTxDetail;
function pexdSheetAcct(){
  var t=(typeof _pTxById==='function')?_pTxById(_pexdId):null; if(!t) return;
  var pd=window.fhPersonalData?fhPersonalData():null;
  var cur=PXD.hasOwnProperty('accountId')?PXD.accountId:(t.accountId||null);
  setTxt('exdacct-h', 'Nguồn tiền');
  setTxt('exdacct-sub', 'Gắn để số dư tài khoản tính được · thay đổi chờ Lưu');
  var ico={deposit:'🏦',ewallet:'📱',credit_card:'💳',cash:'💵'};
  var h='<button type="button" class="choice'+(cur?'':' on')+'" onclick="pexdPickAcct(&#39;&#39;)">Chưa gắn</button>';
  ((pd&&pd.accounts)||[]).forEach(function(a){
    h+='<button type="button" class="choice'+(a.id===cur?' on':'')+'" onclick="pexdPickAcct(&#39;'+escAttr(a.id)+'&#39;)">'+(ico[a.kind]||'🏦')+' '+esc(a.name||'Tài khoản')+'</button>';
  });
  setHTML('exdacct-list', h);
  openSheet('sheet-exd-acct');
}
function pexdPickAcct(id){ closeSheet(); PXD.accountId=id||null; renderPersonalTxDetail(); }
/* Loại khoản — the review card's kind control, for a committed row. The two
   conversions that exist for a booked expense (0122 loan, 0123 investment)
   are in-place flips with their own follow-up sheet, so they save on their
   own; the detail closes first, as the composer's "Đây là khoản…" links do. */
function pexdSheetKind(){
  var t=(typeof _pTxById==='function')?_pTxById(_pexdId):null; if(!t) return;
  setTxt('exdkind-h', 'Loại khoản');
  setTxt('exdkind-sub', 'Đổi loại sẽ lưu ngay, không chờ Lưu. Cho vay và Đầu tư hỏi thêm một bước.');
  setHTML('exdkind-list',
    '<button type="button" class="choice on" onclick="closeSheet()">Chi tiêu</button>'
    +'<button type="button" class="choice" onclick="pexdPickKind(&#39;loan&#39;)">🤝 Cho vay</button>'
    +'<button type="button" class="choice" onclick="pexdPickKind(&#39;invest&#39;)">📈 Đầu tư</button>');
  openSheet('sheet-exd-kind');
}
function pexdPickKind(k){
  closeSheet(); var id=_pexdId; if(id==null) return;
  closePersonalTxDetail();
  if(k==='loan' && window.fhExpenseToLoanSheet) fhExpenseToLoanSheet(id);
  else if(k==='invest' && window.fhExpenseToInvestSheet) fhExpenseToInvestSheet(id);
}
/* Ghi vào đâu → the existing move confirm (59-ledger-move-ui): same sheet, same
   consequences, same engine — only the entrance moved from the chip flip. */
function pexdMove(){
  if(_pexdId==null) return;
  if(navigator.onLine===false){ toast('Cần mạng để chuyển sổ'); return; }
  if(!(window.DB&&DB.fid)){ toast('Vào một nhóm gia đình trước đã'); return; }
  _mvCtx={dir:'p2f', pid:_pexdId, cur:'personal'};
  fhMoveSheetOpen();
}
async function pexdSave(){
  var t=(typeof _pTxById==='function')?_pTxById(_pexdId):null; if(!t) return;
  pexdReadFields();
  if(!_pxdDirty()){ _pexdEdit=false; renderPersonalTxDetail(); return; }   // nothing changed: Lưu just leaves edit
  var p=PXD;
  var amtBase=p.amtDisp!=null?parseAmtBase(p.amtDisp):t.amt;
  if(!(amtBase>0)){ toast('Nhập số tiền trước đã'); var ai=document.getElementById('pexd-amt'); if(ai) ai.focus(); return; }
  var go=document.getElementById('pexd-save');
  if(go){ if(go.disabled) return; go.disabled=true; go.textContent='Đang lưu…'; }
  var fields={ amt:amtBase,
    note:(p.note!=null?p.note:(t.note||'')),
    cat:(p.cat!=null?p.cat:(t.cat||'')),
    emoji:(p.cat!=null?((catStyle[p.cat]||['🏷️'])[0]):(t.emoji||null)),
    time:(p.timeStr!==undefined?p.timeStr:(t.time||'')),
    dateIso:(p.dateIso!=null?p.dateIso:t.date) };
  if(p.hasOwnProperty('accountId')) fields.accountId=p.accountId;
  var fieldsChanged=Object.keys(p).some(function(k){ return k!=='photos'; });
  var ok=false;
  try{
    ok=fieldsChanged?await window.fhPersonalUpdateExpense(_pexdId, fields):true;
    if(ok && p.photos!==undefined && window.fhPersonalSyncTxnPhotos){ ok=await fhPersonalSyncTxnPhotos(_pexdId, p.photos); await window.fhPersonalHydrate(); }
  }catch(e){ ok=false; }
  if(go){ go.disabled=false; go.textContent='Lưu'; }
  if(!ok){ toast('Chưa lưu được, thử lại nhé'); return; }
  PXD={}; _pexdEdit=false;
  if(typeof renderPersonal==='function'){ try{ renderPersonal(); }catch(e){} }
  if(typeof refreshPersonalTxnOverlay==='function') refreshPersonalTxnOverlay();
  renderPersonalTxDetail();
  toast('Đã lưu');
}
window.pexdSave=pexdSave;
function _pxdResetDel(){
  _pexdDelArmed=false; clearTimeout(_pexdDelT);
  var b=document.getElementById('pexd-del'); if(b){ b.classList.remove('armed'); b.textContent='Xoá khoản này'; }
}
async function pexdDelete(){
  var b=document.getElementById('pexd-del');
  if(!_pexdDelArmed){
    _pexdDelArmed=true; if(b){ b.classList.add('armed'); b.textContent='Chạm lần nữa để xoá'; }
    clearTimeout(_pexdDelT); _pexdDelT=setTimeout(_pxdResetDel,3000); return;
  }
  _pxdResetDel();
  var id=_pexdId; if(id==null){ closePersonalTxDetail(); return; }
  if(b){ b.disabled=true; }
  var ok=false;
  try{ ok=await window.fhPersonalDeleteExpense(id); }catch(e){}
  if(b){ b.disabled=false; }
  if(!ok){ toast('Chưa xoá được, thử lại nhé'); return; }
  closePersonalTxDetail();
  if(typeof renderPersonal==='function'){ try{ renderPersonal(); }catch(e){} }
  if(typeof refreshPersonalTxnOverlay==='function') refreshPersonalTxnOverlay();
  toast('Đã xoá');
}
window.pexdDelete=pexdDelete;