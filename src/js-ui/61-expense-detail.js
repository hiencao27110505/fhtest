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
function _exdRow(opts){   // {label, val, chg, ro, soft, miss, hot, fn}
  var chev=opts.ro?'':'<svg class="csv-schev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m9 6 6 6-6 6"/></svg>';
  var cls='csv-srow'+(opts.ro?' ro':'')+(opts.soft?' soft':'')+(opts.miss?' miss':'')+(opts.hot?' hot':'')+(opts.chg?' chg':'');
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
    rows+=_exdNodeRow(t, false);
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
    rows+=_exdNodeRow(t, true);
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
        +(t._dbId?'<label class="exd-photo add" aria-label="'+escAttr(L('Thêm ảnh','Add a photo'))+'">＋<input type="file" accept="image/*" multiple onchange="exdDoorPick(this)" hidden></label>':'')+'</div>';
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
/* ── the photo ask on a family row (1A): the cash-flow card's action row,
   opening the shared Chụp / Thư viện sheet; the write is the photo-assign path
   (paApply, wrapped in 50-writethrough → _dbSyncTxnPhotos), which encrypts for
   an enc family and refuses on a locked device. ── */
function _exdDoorHTML(t){
  return '<div class="exd-meta flush">'+_pexdCC(_PEXD_ICO.cam,L('Thêm ảnh hoá đơn','Add a receipt photo'),'exdPhotoSheet()')+'</div>';
}
function exdPhotoSheet(){ _pexdPhotoSheetOpen('exdDoorPick'); }
window.exdPhotoSheet=exdPhotoSheet;
function exdDoorPick(input){
  var files=Array.prototype.slice.call(input.files||[]); input.value='';
  closeSheet();
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
/* 0144 — "Tiêu vào gì" (income: "Tiền từ đâu"): the tree's read of what the
   money bought. Read-only
   in the view state, a picker in edit. Staged like every other edited field, so
   Lưu is what commits it; a pick also teaches the merchant lesson after the save.
   Hidden entirely while the tree is switched off (C8). */
function _exdNodeRow(t, editable, mode){
  if(typeof fhTreeOn!=='function' || !fhTreeOn() || typeof FH_TAX==='undefined') return '';
  var staged=(mode==='pers')?PXD.node:EXD.node;
  var cur=(staged!==undefined)?staged:(t.node||null);
  var kind=(mode==='pers')?(t.kind==='income'?'income':'expense'):'expense';
  var val;
  if(cur){
    var path=FH_TAX.pathVi(cur), leaf=path[path.length-1], up=path.slice(0,-1).join(' › ');
    val=(up?'<span class="exd-node-up">'+esc(up)+' › </span>':'')+'<b>'+esc(leaf)+'</b>';
  } else val='<b>'+L('Chưa rõ','Not sure yet')+'</b>';
  var lbl=(kind==='income')?L('Tiền từ đâu','Where it came from'):L('Tiêu vào gì','What it was');
  return _exdRow({label:lbl, ro:!editable, soft:!cur, chg:staged!==undefined,
    val:val, fn:editable?("exdSheetNode(&#39;"+(mode==='pers'?'pers':'fam')+"&#39;,&#39;"+escAttr(kind)+"&#39;)"):''});
}
function exdSheetNode(mode, kind){
  _exdMode=(mode==='pers')?'pers':'fam';
  var t=_exdRowOf(); if(!t) return;
  var staged=(mode==='pers')?PXD.node:EXD.node;
  var cur=(staged!==undefined)?staged:(t.node||null);
  fhNodePickOpen(cur, kind||'expense', 'exdPickNode');
}
function exdPickNode(code){ _exdStage('node', code||null); }

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
  if(p.node!==undefined && typeof window.fhSetExNode==='function'){
    window.fhSetExNode(p.node||'');                        // 0144: a human pick; the composer's own guess may not overwrite it
    t.node=p.node||null;                                   // in-memory row shows it at once
    if(p.node && typeof window.fhLessonLearnNode==='function'){
      try{ window.fhLessonLearnNode({ note:(p.note!=null?p.note:t.note), amount:t.amt, node:p.node }); }catch(e){}
    }
  }
  saveExpenseEdit();                                       // wrapped → persists + renderExpenseDetailIfOpen
}
window.exdSave=exdSave;

/* ═══ the PERSONAL transaction detail — every kind, one screen (2026-09-18) ═══
   One renderer for expense · income · loan · repayment · investment · transfer
   pair · card payment · reconcile adjustment. The frame never changes: nav
   (‹ back · Sửa, then Huỷ · title · Lưu), the receipt, rows in the review
   card's order (Ghi vào đâu · Loại khoản · the kind's own rows · Ngày · Giờ ·
   Nguồn tiền), one staged Lưu, delete as the muted foot line. Three slots vary
   per kind and per arrival (mockups/txn-detail-kinds.html,
   mockups/txn-detail-slot-variants.html: 1A · 2B · 3B):
     ask     — one action row under the receipt: add a photo (expense, income,
               loan, investment), or the way out for an adjustment; empty otherwise
     rows    — the kind's own rows; a broken pair's missing leg is the amber
               "Chọn tài khoản" row itself (2B), tappable even in view
     context — a second rows card under the rows (3B): the person's balance,
               the position, the two balances of a pair, the card's debt; shown
               when opened from a list, hidden when opened from the screen that
               already shows it (opts.from === 'zoom')
   Landing: view, except a transfer / card payment / repayment opened from its
   own zoom-in, which lands in edit (opts.edit) and Huỷ returns there. A pair
   is one entry loaded by transfer_group_id; edit and delete touch both legs. */
var _pexdId=null, _pexdOpts={}, PXD={}, _pexdEdit=false, _pexdDelArmed=false, _pexdDelT=null;
function _pxdDirty(){ return Object.keys(PXD).length>0; }
/* rows live in three places: the 2-month window (photos, time), the all-time
   debt read (who, due, qty, position) and the older-history page — merge */
function _pexdRow(id){
  var P=window.fhPersonalData&&fhPersonalData(); if(!P||id==null) return null;
  var f=function(a){ return (a||[]).filter(function(t){ return t.id===id; })[0]; };
  var d=f(P.debts), w=f(P.txns)||f(P.txnsOld);
  if(!d&&!w) return null;
  return Object.assign({}, d||{}, w||{}, (d&&w)?{who:d.who, due:d.due, qty:(w.qty!=null?w.qty:d.qty), positionId:w.positionId||d.positionId}:{});
}
function _pexdKindOf(t){
  if(t.kind==='income') return 'income';
  if(t.kind==='loan') return 'loan';
  if(t.kind==='repayment') return 'repay';
  if(t.kind==='investment') return 'invest';
  if(t.kind==='transfer'){ if(t.transferGroupId) return 'xfer'; if(String(t.note||'').indexOf('Điều chỉnh')===0) return 'adjust'; return 'cardpay'; }
  return 'expense';
}
function _pexdEntry(){
  var t=_pexdRow(_pexdId); if(!t) return null;
  var pd=fhPersonalData(), k=_pexdKindOf(t);
  var E={t:t, k:k, id:t.id, amt:Math.abs(Number(t.amt)||0), pd:pd, out:null, inn:null, broken:false, gid:t.transferGroupId||null};
  if(k==='xfer'){
    var legs=(pd.debts||[]).filter(function(d){ return d.transferGroupId===t.transferGroupId; });
    E.out=legs.filter(function(d){ return (d.amt||0)<0; })[0]||null;
    E.inn=legs.filter(function(d){ return (d.amt||0)>0; })[0]||null;
    var anchor=E.out||E.inn||t;                        // the debit leg is the entry: photos, time, note
    E.t=Object.assign({}, anchor, _pexdRow(anchor.id)||{}); E.id=anchor.id; E.amt=Math.abs(Number(anchor.amt)||0);
    E.broken=!(E.out&&E.inn);
  }
  E.isIn=(k==='income')||(k==='repay'&&(t.amt||0)>0)||(k==='invest'&&(t.amt||0)>0);
  E.lent=(k==='loan')?((t.amt||0)>0):null;
  return E;
}
function _pexdAcct(id){ var pd=fhPersonalData(); return id?((pd.accounts||[]).find(function(a){ return a.id===id; })||null):null; }
function _pexdAcctName(id, fallback){ var a=_pexdAcct(id); return a?esc(a.name||'Tài khoản'):(fallback||'Chưa rõ'); }
var _PEXD_KIND={ expense:'Chi tiêu', income:'Thu nhập', loan:'🤝 Cho vay', borrow:'🤝 Đi mượn', repayIn:'🤝 Thu nợ', repayOut:'🤝 Trả nợ',
  buy:'📈 Đầu tư', sell:'📈 Bán đầu tư', xfer:'🔁 Chuyển khoản nội bộ', cardpay:'💳 Trả nợ thẻ', adjust:'Điều chỉnh dư nợ' };
function _pexdKindLbl(E){
  var k=E.k, t=E.t;
  if(k==='loan') return E.lent?_PEXD_KIND.loan:_PEXD_KIND.borrow;
  if(k==='repay') return E.isIn?_PEXD_KIND.repayIn:_PEXD_KIND.repayOut;
  if(k==='invest') return E.isIn?_PEXD_KIND.sell:_PEXD_KIND.buy;
  return _PEXD_KIND[k]||'Chi tiêu';
}
function _pexdTitle(E){
  return {expense:'Sửa khoản chi', income:'Sửa khoản thu', loan:E.lent?'Sửa khoản cho vay':'Sửa khoản mượn', repay:'Sửa khoản trả nợ',
    invest:E.isIn?'Sửa khoản bán':'Sửa khoản mua', xfer:'Sửa chuyển khoản', cardpay:'Sửa khoản trả thẻ', adjust:''}[E.k];
}
function _pexdDelLbl(E){
  return {expense:'Xoá khoản này', income:'Xoá khoản thu này', loan:E.lent?'Xoá khoản cho vay này':'Xoá khoản mượn này', repay:'Xoá khoản trả nợ này',
    invest:E.isIn?'Xoá khoản bán này':'Xoá khoản mua này', xfer:'Xoá cả hai đầu', cardpay:'Xoá khoản trả thẻ này', adjust:'Bỏ điều chỉnh này'}[E.k];
}
function _pexdNoteLbl(E){ return E.k==='expense'?'Chi cho gì?':(E.k==='income'?'Tiền gì vậy?':'Ghi chú'); }
function _pexdDateLong(iso){
  if(!iso) return '';
  var d=new Date(iso+'T00:00:00');
  return (typeof fmtDateLong==='function')?fmtDateLong(d):iso;
}
/* the two top inputs → PXD, read before every re-render and before Lưu */
function pexdReadFields(){
  var E=_pexdEntry(); if(!E) return;
  var a=document.getElementById('pexd-amt'), n=document.getElementById('pexd-note');
  if(a){ var v=a.value.trim(), base=(typeof amtToInput==='function')?amtToInput(E.amt):String(E.amt||''); if(v && v!==base) PXD.amtDisp=v; else delete PXD.amtDisp; }
  if(n){ var nv=n.value.trim(); if(nv!==(E.t.note||'')) PXD.note=nv; else delete PXD.note; }
}
window.pexdReadFields=pexdReadFields;

/* ── open / close / states ── */
function openPersonalTxDetail(id, opts){
  var t=_pexdRow(id);
  if(!t || t._unreadable) return;
  if(t.spaceId || t.linkId){ if(typeof fhMirrorRowTap==='function') fhMirrorRowTap(id); return; }   // a mirror master: its family twin is the detail
  _pexdId=id; _pexdOpts=opts||{}; PXD={};
  var k=_pexdKindOf(t);
  _pexdEdit=!!(_pexdOpts.edit || (_pexdOpts.from==='zoom' && (k==='xfer'||k==='cardpay'||k==='repay')));
  if(k==='adjust') _pexdEdit=false;
  if(_pexdEdit) _pexdOpts.edit=true;                                // Huỷ then closes, back to where we came from
  renderPersonalTxDetail();
  document.getElementById('pexd-overlay').classList.add('on');
  var sc=document.querySelector('#pexd-overlay .cd-scroll'); if(sc) sc.scrollTop=0;
}
window.openPersonalTxDetail=openPersonalTxDetail;
function openPersonalTransferDetail(gid, opts){
  var pd=window.fhPersonalData&&fhPersonalData(); if(!pd||!gid) return;
  var legs=(pd.debts||[]).filter(function(d){ return d.transferGroupId===gid; });
  var leg=legs.filter(function(d){ return (d.amt||0)<0; })[0]||legs[0]; if(!leg) return;
  openPersonalTxDetail(leg.id, opts);
}
window.openPersonalTransferDetail=openPersonalTransferDetail;
function closePersonalTxDetail(){
  _pxdResetDel();
  var o=document.getElementById('pexd-overlay'); if(o) o.classList.remove('on');
  var re=_pexdOpts.reopen;
  _pexdId=null; PXD={}; _pexdEdit=false; _pexdOpts={};
  if(re&&re.length){ try{ if(re[0]==='person'&&window.openDebtPerson) openDebtPerson(re[1]); else if(re[0]==='acct'&&window.openDebtAccount) openDebtAccount(re[1]); else if(re[0]==='pos'&&window.openInvPosition) openInvPosition(re[1]); }catch(e){} }   // refresh the zoom-in underneath
}
window.closePersonalTxDetail=closePersonalTxDetail;
function pexdEdit(){ if(_pexdId==null) return; PXD={}; _pexdEdit=true; renderPersonalTxDetail(); }
function pexdCancel(){ PXD={}; if(_pexdOpts.edit){ closePersonalTxDetail(); return; } _pexdEdit=false; _pxdResetDel(); renderPersonalTxDetail(); }
var _PEXD_BACK='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M15 18l-6-6 6-6"/></svg>';
function _pexdNavHTML(E){
  var back=esc(_pexdOpts.back||'Cá nhân');
  if(!_pexdEdit) return '<button type="button" class="cd-back" onclick="closePersonalTxDetail()">'+_PEXD_BACK+'<span>'+back+'</span></button><span></span>'
    +(E.k==='adjust'?'<span></span>':'<button type="button" class="cd-act" onclick="pexdEdit()">Sửa</button>');
  return '<button type="button" class="cd-act cancel" onclick="pexdCancel()">Huỷ</button><span class="cd-navtitle">'+_pexdTitle(E)+'</span>'
    +'<button type="button" class="cd-act" id="pexd-save" onclick="pexdSave()">Lưu</button>';
}

/* ── glyphs: SVG only (DESIGN.md §2.6) ── */
function _pexdSvg(d){ return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">'+d+'</svg>'; }
var _PEXD_ICO={
  cam:_pexdSvg('<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.2"/>'),
  lib:_pexdSvg('<rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="m4 17 5-5 4 4 3-3 4 4"/><circle cx="16" cy="9.5" r="1.4"/>'),
  wallet:_pexdSvg('<path d="M3 7h16a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M3 7l12-3v3"/><path d="M16 14h3"/>'),
  swap:_pexdSvg('<path d="M4 8h13l-3-3"/><path d="M20 16H7l3 3"/>'),
  card:_pexdSvg('<rect x="3" y="6" width="18" height="12" rx="2.5"/><path d="M3 10h18"/>'),
  iou:_pexdSvg('<path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6"/><path d="M9 13c1-1.5 2 1.5 3 0s2 1.5 3 0"/>'),
  hand:_pexdSvg('<path d="M12 3v9"/><path d="M8 7l4-4 4 4"/><path d="M4 14h3l3 3h4l3-3h3"/><path d="M4 14v6h16v-6"/>'),
  chart:_pexdSvg('<path d="M4 19h16"/><path d="M6 15l4-4 3 3 5-6"/>'),
  scale:_pexdSvg('<path d="M12 4v16"/><path d="M6 20h12"/><path d="M5 8h14"/><path d="M5 8l-2 6h4z"/><path d="M19 8l-2 6h4z"/>'),
  bell:_pexdSvg('<path d="M6 16V11a6 6 0 0 1 12 0v5l2 2H4z"/><path d="M10 21h4"/>'),
  refresh:_pexdSvg('<path d="M4 12a8 8 0 0 1 14-5l2 2"/><path d="M20 4v5h-5"/>')
};
var _PEXD_CHEV='<svg class="csv-schev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m9 6 6 6-6 6"/></svg>';
/* the cash-flow card's own action row (.cc-row / .cc-ic, 40-spending-tabs.css) */
function _pexdCC(ico, txt, fn, cls){
  return '<button type="button" class="cc-row" onclick="'+fn+'"><span class="cc-ic'+(cls?' '+cls:'')+'">'+ico+'</span><span class="cc-t">'+txt+'</span>'+_PEXD_CHEV+'</button>';
}

/* ── the ask slot (1A) ── */
function _pexdAskHTML(E){
  if(E.k==='adjust' && E.t.accountId) return '<div class="exd-meta flush">'+_pexdCC(_PEXD_ICO.card,'Sửa ở màn thẻ',"openDebtAccount('"+escAttr(E.t.accountId)+"')")+'</div>';
  if(E.broken) return '';                                          // the fix is the row itself (2B)
  var ph=E.t.photos||[]; if(ph.length) return '';
  var lbl={expense:'Thêm ảnh hoá đơn', income:'Thêm phiếu lương', loan:'Thêm giấy hẹn', invest:E.isIn?'Thêm ảnh lệnh bán':'Thêm ảnh lệnh mua'}[E.k];
  if(!lbl) return '';
  return '<div class="exd-meta flush">'+_pexdCC(_PEXD_ICO.cam, lbl, 'pexdPhotoSheet()')+'</div>';
}
/* the photo sheet: Chụp ảnh / Thư viện as choice labels around real file inputs */
function _pexdPhotoSheetOpen(handler){
  setTxt('exdphoto-h','Thêm ảnh');
  setHTML('exdphoto-list',
    '<label class="choice">'+_PEXD_ICO.cam+'Chụp ảnh<input type="file" accept="image/*" capture="environment" onchange="'+handler+'(this)" hidden></label>'
    +'<label class="choice">'+_PEXD_ICO.lib+'Thư viện<input type="file" accept="image/*" multiple onchange="'+handler+'(this)" hidden></label>');
  openSheet('sheet-exd-photo');
}
function pexdPhotoSheet(){ _pexdPhotoSheetOpen('pexdDoorPick'); }
window.pexdPhotoSheet=pexdPhotoSheet;
function pexdDoorPick(input){
  var files=Array.prototype.slice.call(input.files||[]); input.value='';
  closeSheet();
  var E=_pexdEntry(); if(!files.length || !E) return;
  if(!(window.fhPersonalKeyReady && fhPersonalKeyReady())){ toast('Mở khoá sổ cá nhân trước đã'); return; }
  if(navigator.onLine===false){ toast('Cần mạng để thêm ảnh'); return; }
  var room=10-((E.t.photos)||[]).length;
  if(room<=0){ toast('Tối đa 10 ảnh'); return; }
  if(files.length>room){ toast('Tối đa 10 ảnh'); files=files.slice(0,room); }
  var id=E.id, srcs=[], left=files.length;
  files.forEach(function(f){ readPhoto(f, function(src){ if(src) srcs.push(src); if(--left===0) _pexdDoorUpload(id, srcs); }); });
}
window.pexdDoorPick=pexdDoorPick;
async function _pexdDoorUpload(id, srcs){
  if(!srcs.length) return;
  var ok=false;
  try{ ok=await window.fhPersonalUploadTxnPhotos(id, srcs); await window.fhPersonalHydrate(); }catch(e){}
  if(_pexdId!=null) renderPersonalTxDetail();
  if(typeof renderPersonal==='function'){ try{ renderPersonal(); }catch(e){} }
  if(typeof refreshPersonalTxnOverlay==='function') refreshPersonalTxnOverlay();
  toast(ok?'Đã thêm ảnh':'Chưa lưu được ảnh, thử lại nhé');
}
function pexdPhotoRemove(i){
  var E=_pexdEntry(); if(!E) return;
  var cur=(PXD.photos!==undefined?PXD.photos:(E.t.photos||[])).slice();
  cur.splice(i,1); PXD.photos=cur;
  renderPersonalTxDetail();
}
window.pexdPhotoRemove=pexdPhotoRemove;

/* ── the context slot (3B): a second rows card under the rows ── */
function _pexdCtxHTML(E){
  if(_pexdEdit || _pexdOpts.from==='zoom') return '';
  var pd=E.pd, rows='', title='', act='';
  var R=function(l,v,cls){ return '<div class="csv-srow ro'+(cls?' '+cls:'')+'"><small>'+l+'</small><span class="csv-sval"><b>'+v+'</b></span></div>'; };
  if(E.k==='loan'||E.k==='repay'){
    var who=E.t.who; if(!who) return '';
    var d=fhPersonalDebts(), idx=d.people.findIndex(function(p){ return p.who===who; }); if(idx<0) return '';
    var bal=d.people[idx].balance; title=esc(who);
    rows+=bal>0.5?R('Còn nợ bạn','<span class="num">'+fmt(bal)+'</span>','good'):(bal<-0.5?R('Bạn còn nợ','<span class="num">'+fmt(-bal)+'</span>','bad'):R('Đã trả hết','<span class="num">0 ₫</span>'));
    if(E.k==='loan'&&E.t.due) rows+=R('Hẹn trả','<span class="num">'+esc(E.t.due.slice(8,10)+'/'+E.t.due.slice(5,7))+'</span>');
    if(bal>0.5) act=_pexdCC(_PEXD_ICO.bell,'Nhắc '+esc(who)+' trả','fhDebtRemindSheet('+idx+')');
  } else if(E.k==='invest'){
    var v=window.fhInvPositions?fhInvPositions():null; var p=v&&v.positions.find(function(x){ return x.id===E.t.positionId; }); if(!p) return '';
    title=esc(p.name);
    if(p.holding!=null) rows+=R('Đang giữ','<span class="num">'+esc(String(p.holding))+(p.unit?' '+esc(p.unit):'')+'</span>');
    rows+=R('Vốn','<span class="num">'+fmt(p.netK)+'</span>');
    if(p.valueK!=null) rows+=R('Giá trị','<span class="num">'+fmt(p.valueK)+'</span>');
    if(p.plK!=null) rows+=R(p.plK>=0?'Lãi':'Lỗ','<span class="num">'+(p.plK>=0?'+':'−')+fmt(Math.abs(p.plK))+(p.pctPl!=null?' ('+(p.pctPl>=0?'+':'')+Math.round(p.pctPl)+'%)':'')+'</span>', p.plK>=0?'good':'bad');
    act=_pexdCC(_PEXD_ICO.refresh,'Cập nhật giá',"fhInvPriceSheet('"+escAttr(p.id)+"')");
  } else if(E.k==='xfer'){
    if(E.broken) return '';
    title='Số dư';
    [E.out,E.inn].forEach(function(leg){
      var a=_pexdAcct(leg.accountId); if(!a) return;
      var b=window.fhPersonalBalance?fhPersonalBalance(a.id):null;
      rows+=b!=null?R(esc(a.name||'Tài khoản'),'<span class="num">'+fmt(b)+'</span>'):R(esc(a.name||'Tài khoản'),'Chưa có mốc số dư','soft');
    });
  } else if(E.k==='cardpay'){
    var a2=_pexdAcct(E.t.accountId); if(!a2) return '';
    var dd=fhPersonalDebts(), c=(dd.cards||[]).find(function(x){ return x.acct.id===a2.id; });
    title=esc(a2.name||'Thẻ');
    rows+=(c&&c.verified)?(c.outstanding>0?R('Còn nợ','<span class="num">'+fmt(c.outstanding)+'</span>','bad'):R('Đang dư','<span class="num">'+fmt(-c.outstanding)+'</span>','good')):R('Dư nợ','Chưa thiết lập','soft');
    if(a2.dueDay) rows+=R('Đến hạn','Ngày '+esc(String(a2.dueDay))+' hằng tháng');
    act=_pexdCC(_PEXD_ICO.card,'Mở thẻ',"openDebtAccount('"+escAttr(a2.id)+"')");
  } else return '';
  if(!rows) return '';
  return _exdSecH(title,'')+'<div class="exd-meta flush"><div class="csv-srows pad">'+rows+'</div>'+act+'</div>';
}

/* ── render ── */
function renderPersonalTxDetail(){
  var E=_pexdEntry();
  if(!E){ closePersonalTxDetail(); return; }
  var body=document.getElementById('pexd-body'); if(!body) return;
  if(_pexdEdit) pexdReadFields();
  var nav=document.getElementById('pexd-nav'); if(nav) nav.innerHTML=_pexdNavHTML(E);
  var t=E.t, k=E.k, pd=E.pd;
  var vAmtDisp=PXD.amtDisp!=null?PXD.amtDisp:((typeof amtToInput==='function')?amtToInput(E.amt):String(E.amt||''));
  var vNote=PXD.note!=null?PXD.note:(t.note||'');
  var vTime=PXD.timeStr!==undefined?PXD.timeStr:(t.time||'');
  var vDate=PXD.dateIso!=null?PXD.dateIso:(t.date||'');
  var vCat=PXD.cat!=null?PXD.cat:(t.cat||'');
  var vWho=PXD.who!==undefined?PXD.who:(t.who||'');
  var vDue=PXD.dueIso!==undefined?PXD.dueIso:(t.due||'');
  var vQty=PXD.qty!==undefined?PXD.qty:(t.qty!=null?Math.abs(t.qty):null);
  var vPos=PXD.positionId!==undefined?PXD.positionId:(t.positionId||null);
  var acctId=PXD.hasOwnProperty('accountId')?PXD.accountId:(t.accountId||null);
  var vFrom=PXD.fromAccountId!==undefined?PXD.fromAccountId:(E.out?E.out.accountId:null);
  var vTo=PXD.toAccountId!==undefined?PXD.toAccountId:(E.inn?E.inn.accountId:null);
  var vCard=PXD.cardId!==undefined?PXD.cardId:(t.accountId||null);
  var dateVal=vDate?vDate.slice(8,10)+'/'+vDate.slice(5,7):'';
  var ph=(PXD.photos!==undefined)?PXD.photos:(t.photos||[]);
  /* receipt: icon per kind, amount (+ and green for money in), a note that
     says what the row is when the person typed none */
  var em=(k==='expense')?(PXD.cat!=null?((catStyle[vCat]||['🏷️'])[0]):(t.emoji||'🗂️')):null;
  var ico={income:['wallet','good'], loan:['iou','id3'], repay:['hand','good'], invest:['chart','id1'], xfer:['swap','id1'], cardpay:['card','id6'], adjust:['scale','']}[k];
  var posName=vPos?_pexdAcctName(vPos,'Vị thế'):'';
  var noteShow=vNote||{expense:vCat||'Khoản chi', income:vCat||'Thu nhập', loan:(vWho?(E.lent?'Cho '+vWho+' mượn':'Mượn '+vWho):'Cho vay'), repay:(vWho?(E.isIn?vWho+' trả':'Trả '+vWho):'Trả nợ'),
    invest:((E.isIn?'Bán ':'Mua ')+(posName||'đầu tư')), xfer:(_pexdAcctName(vFrom,'?')+' → '+_pexdAcctName(vTo,'?')), cardpay:'Thanh toán thẻ', adjust:'Điều chỉnh dư nợ'}[k];
  var heroHTML='<div class="exd-focal">'
    +(em!=null?'<div class="exd-ico" style="background:var(--fill-neutral)">'+esc(em)+'</div>':'<div class="exd-ico svg '+ico[1]+'">'+_PEXD_ICO[ico[0]]+'</div>')
    +'<div class="exd-amt num'+(E.isIn?' in':'')+'">'+(E.isIn?'+':'')+esc(vAmtDisp)+(CUR==='VND'?' ₫':'')+'</div>'
    +'<div class="exd-note">'+noteShow+'</div>'
    +'<div class="exd-prov">'+esc(_pexdDateLong(vDate))+(vTime?'<span class="sep">·</span>'+esc(vTime):'')+'</div>'
    +'</div>';
  /* rows: one builder, read-only in view (unless the row is the fix itself) */
  var ed=_pexdEdit;
  var R=function(lbl,val,o){ o=o||{}; return _exdRow({label:lbl, val:'<b>'+val+'</b>', ro:(o.live?false:(!ed||o.ro)), soft:o.soft, miss:o.miss, chg:o.chg, fn:o.fn}); };
  var rows='';
  rows+=R('Ghi vào đâu','🔒 Cá nhân',{ro:k!=='expense', fn:'pexdMove()'});
  rows+=R('Loại khoản',_pexdKindLbl(E),{ro:!(k==='expense'||k==='loan'||k==='invest'), fn:'pexdSheetKind()'});
  if(k==='expense') rows+=R('Danh mục',esc(em)+' '+esc(vCat||'Chưa rõ'),{chg:PXD.cat!=null, soft:!vCat, fn:"exdSheetCat('pers')"});
  if(k==='expense'||k==='income') rows+=_exdNodeRow(t, !!ed, 'pers');
  if(k==='income') rows+=R('Danh mục',esc(vCat||'Khác'),{chg:PXD.cat!=null, fn:'pexdSheetIncCat()'});
  if(k==='loan'){
    rows+=R(E.lent?'Cho ai mượn':'Mượn của ai',vWho?esc(vWho):'Chọn',{chg:PXD.who!==undefined, soft:!vWho, fn:"pexdSheetText('who')"});
    if(ed) rows+=fhPickRow({label:'Hẹn trả', type:'date', value:vDue||'', on:'pexdPickDue', clear:true, chg:PXD.dueIso!==undefined, soft:!vDue,
      val:'<b class="num">'+(vDue?esc(vDue.slice(8,10)+'/'+vDue.slice(5,7)):'Chưa hẹn')+'</b>'});
    else rows+=R('Hẹn trả',vDue?'<span class="num">'+esc(vDue.slice(8,10)+'/'+vDue.slice(5,7))+'</span>':'Chưa hẹn',{soft:!vDue});
  }
  if(k==='repay') rows+=R(E.isIn?'Ai trả bạn':'Trả nợ cho ai',vWho?esc(vWho):'Chọn',{chg:PXD.who!==undefined, soft:!vWho, fn:"pexdSheetText('who')"});
  if(k==='invest'){
    rows+=R('Vị thế',posName||'Chọn',{chg:PXD.positionId!==undefined, soft:!vPos, fn:'pexdSheetPos()'});
    rows+=R('Số lượng',(vQty>0)?'<span class="num">'+esc(String(vQty).replace('.',','))+'</span>':'Tuỳ chọn',{chg:PXD.qty!==undefined, soft:!(vQty>0), fn:"pexdSheetText('qty')"});
  }
  if(k==='xfer'){
    var noFrom=!vFrom, noTo=!vTo;
    rows+=R('Từ tài khoản',noFrom?'Chọn tài khoản':_pexdAcctName(vFrom),{miss:noFrom, live:noFrom, chg:PXD.fromAccountId!==undefined, fn:"pexdSheetAcct('from')"});
    rows+=R('Đến tài khoản',noTo?'Chọn tài khoản':_pexdAcctName(vTo),{miss:noTo, live:noTo, chg:PXD.toAccountId!==undefined, fn:"pexdSheetAcct('to')"});
  }
  if(k==='cardpay') rows+=R('Trả cho thẻ',_pexdAcctName(vCard,'Chưa rõ'),{chg:PXD.cardId!==undefined, soft:!vCard, fn:"pexdSheetAcct('card')"});
  if(k==='adjust') rows+=R('Thẻ',_pexdAcctName(t.accountId,'Chưa rõ'),{ro:true});
  if(ed && k!=='adjust'){
    rows+=fhPickRow({label:'Ngày', type:'date', value:vDate||'', on:'exdPickDate', arg:'pers', chg:PXD.dateIso!=null, val:'<b class="num">'+esc(dateVal)+'</b>'});
    rows+=fhPickRow({label:'Giờ', type:'time', value:vTime||'', on:'exdPickTime', arg:'pers', clear:true, chg:PXD.timeStr!==undefined, soft:!vTime,
      val:'<b class="num">'+(vTime?esc(vTime):'Chỉ tính theo ngày')+'</b>'});
  } else {
    rows+=R('Ngày','<span class="num">'+esc(dateVal)+'</span>',{ro:true});
    rows+=R('Giờ',vTime?'<span class="num">'+esc(vTime)+'</span>':'Chỉ tính theo ngày',{ro:true, soft:!vTime});
  }
  if(k==='expense'||k==='loan'||k==='repay'||k==='invest'||k==='income'){
    var toLbl=(E.isIn)?'Vào tài khoản nào':'Nguồn tiền';
    rows+=R(toLbl,_pexdAcctName(acctId,'Chưa rõ'),{chg:PXD.hasOwnProperty('accountId'), soft:!acctId, fn:"pexdSheetAcct('acct')"});
  }
  var html;
  if(!ed){
    html='<div class="exd-view">'+heroHTML+_pexdAskHTML(E)
      +'<div class="exd-meta srows"><div class="csv-srows">'+rows+'</div></div>';
    if(ph.length) html+=_exdSecH('Ảnh', ph.length)+'<div class="exd-photos">'+ph.map(function(src){ return '<div class="exd-photo" style="background-image:url('+src+')"></div>'; }).join('')+'</div>';
    html+=_pexdCtxHTML(E);
    if(k==='adjust') html+='<button type="button" class="exd-del" id="pexd-del" onclick="pexdDelete()">'+_pexdDelLbl(E)+'</button>';
    html+='</div>';
  } else {
    html='<div class="exd-edit"><div class="exd-meta srows top">'
      +'<div class="field"><label>Số tiền</label><input class="num" id="pexd-amt" inputmode="numeric" onblur="snapAmtInput(this);pexdReadFields()" placeholder="'+escAttr((typeof amtPlaceholder==='function')?amtPlaceholder():'')+'" value="'+escAttr(vAmtDisp)+'"></div>'
      +'<div class="field"><label>'+_pexdNoteLbl(E)+'</label><textarea id="pexd-note" rows="2" onblur="pexdReadFields()">'+esc(vNote)+'</textarea></div>'
      +'<div class="csv-srows">'+rows+'</div></div>'
      +(k==='xfer'?'<div class="exd-hint">Sửa sẽ đổi cả hai đầu.</div>':'');
    if(ph.length){
      html+=_exdSecH('Ảnh', ph.length)
        +'<div class="exd-photos">'+ph.map(function(src,i){ return '<div class="exd-photo" style="background-image:url('+src+')"><button type="button" class="x" onclick="pexdPhotoRemove('+i+')" aria-label="Bỏ ảnh này">✕</button></div>'; }).join('')
        +'<label class="exd-photo add" aria-label="Thêm ảnh">＋<input type="file" accept="image/*" multiple onchange="pexdDoorPick(this)" hidden></label></div>';
    } else html+=_pexdAskHTML(E);
    html+='<button type="button" class="exd-del" id="pexd-del" onclick="pexdDelete()">'+_pexdDelLbl(E)+'</button></div>';
  }
  body.innerHTML=html;
  var cta=document.getElementById('pexd-cta'); if(cta) cta.innerHTML='';
  _pxdResetDel();
}
window.renderPersonalTxDetail=renderPersonalTxDetail;

/* ── pickers ── */
function _pexdChoices(title, sub, listHtml){ setTxt('exdacct-h', title); setTxt('exdacct-sub', sub||''); setHTML('exdacct-list', listHtml); openSheet('sheet-exd-acct'); }
var _pexdAcctWhich='acct';
function pexdSheetAcct(which){
  var E=_pexdEntry(); if(!E) return; _pexdAcctWhich=which;
  var pd=E.pd, ico={deposit:'🏦',ewallet:'📱',credit_card:'💳',cash:'💵'};
  var cur, list, title, sub='Thay đổi chờ Lưu';
  if(which==='card'){ title='Trả cho thẻ'; cur=PXD.cardId!==undefined?PXD.cardId:E.t.accountId; list=(pd.accounts||[]).filter(function(a){ return a.kind==='credit_card'&&!a.archivedAt; }); }
  else if(which==='from'||which==='to'){
    title=which==='from'?'Từ tài khoản':'Đến tài khoản';
    cur=which==='from'?(PXD.fromAccountId!==undefined?PXD.fromAccountId:(E.out?E.out.accountId:null)):(PXD.toAccountId!==undefined?PXD.toAccountId:(E.inn?E.inn.accountId:null));
    var other=which==='from'?(PXD.toAccountId!==undefined?PXD.toAccountId:(E.inn?E.inn.accountId:null)):(PXD.fromAccountId!==undefined?PXD.fromAccountId:(E.out?E.out.accountId:null));
    list=(pd.accounts||[]).filter(function(a){ return (a.kind==='deposit'||a.kind==='ewallet'||a.kind==='cash')&&!a.archivedAt&&a.id!==other; });
    if(E.broken && !_pexdEdit) sub='Chọn xong là ghi ngay, để số dư hai bên khớp';
  } else { title=E.isIn?'Vào tài khoản nào':'Nguồn tiền'; cur=PXD.hasOwnProperty('accountId')?PXD.accountId:(E.t.accountId||null); list=(pd.accounts||[]).filter(function(a){ return a.kind!=='investment'&&!a.archivedAt; }); sub='Gắn để số dư tài khoản tính được · thay đổi chờ Lưu'; }
  var h=(which==='from'||which==='to')?'':'<button type="button" class="choice'+(cur?'':' on')+'" onclick="pexdPickAcct(&#39;&#39;)">Chưa gắn</button>';
  list.forEach(function(a){ h+='<button type="button" class="choice'+(a.id===cur?' on':'')+'" onclick="pexdPickAcct(&#39;'+escAttr(a.id)+'&#39;)">'+(ico[a.kind]||'🏦')+' '+esc(a.name||'Tài khoản')+'</button>'; });
  _pexdChoices(title, sub, h);
}
window.pexdSheetAcct=pexdSheetAcct;
async function pexdPickAcct(id){
  closeSheet(); var E=_pexdEntry(); if(!E) return; id=id||null;
  var w=_pexdAcctWhich;
  if((w==='from'||w==='to') && E.broken && !_pexdEdit){ await _pexdRepairPair(w, id); return; }
  if(w==='card') PXD.cardId=id; else if(w==='from') PXD.fromAccountId=id; else if(w==='to') PXD.toAccountId=id; else PXD.accountId=id;
  renderPersonalTxDetail();
}
window.pexdPickAcct=pexdPickAcct;
/* 2B: a pair missing one leg — picking the account writes the counterpart at once */
async function _pexdRepairPair(which, acctId){
  var E=_pexdEntry(); if(!E||!acctId||!E.gid) return;
  var have=E.out||E.inn; if(!have) return;
  var signed=(which==='from')?-E.amt:E.amt;
  var ok=false;
  try{ ok=await window.fhPersonalAddTransfer(signed, acctId, have.note||null, have.date, null, E.gid); if(ok) await window.fhPersonalHydrate(); }catch(e){}
  if(!ok){ toast('Chưa ghi được, thử lại nhé'); return; }
  renderPersonalTxDetail();
  if(typeof renderPersonal==='function'){ try{ renderPersonal(); }catch(e){} }
  if(typeof refreshPersonalTxnOverlay==='function') refreshPersonalTxnOverlay();
  toast('Đã ghi đầu còn lại');
}
function pexdSheetIncCat(){
  var E=_pexdEntry(); if(!E) return;
  var cur=PXD.cat!=null?PXD.cat:(E.t.cat||'Khác');
  var cats=(window.FH_INCOME_CATS||['Lương','Thưởng','Hoàn tiền','Khác']).slice(); if(cur&&cats.indexOf(cur)<0) cats.unshift(cur);
  setTxt('exdcat-h','Danh mục'); setTxt('exdcat-sub','Thay đổi chờ Lưu');
  setHTML('exdcat-list', cats.map(function(c){ return '<button type="button" class="choice'+(c===cur?' on':'')+'" onclick="pexdPickIncCat(&#39;'+escAttr(c)+'&#39;)">'+esc(c)+'</button>'; }).join(''));
  openSheet('sheet-exd-cat');
}
function pexdPickIncCat(c){ closeSheet(); PXD.cat=c; renderPersonalTxDetail(); }
window.pexdSheetIncCat=pexdSheetIncCat; window.pexdPickIncCat=pexdPickIncCat;
function pexdSheetPos(){
  var E=_pexdEntry(); if(!E) return;
  var cur=PXD.positionId!==undefined?PXD.positionId:(E.t.positionId||null);
  var list=(E.pd.accounts||[]).filter(function(a){ return a.kind==='investment'&&!a.archivedAt; });
  var h=list.map(function(a){ return '<button type="button" class="choice'+(a.id===cur?' on':'')+'" onclick="pexdPickPos(&#39;'+escAttr(a.id)+'&#39;)">'+esc(a.name||'Vị thế')+'</button>'; }).join('');
  _pexdChoices('Vị thế','Thay đổi chờ Lưu', h||'<div class="dbt-note">Chưa có vị thế nào.</div>');
}
function pexdPickPos(id){ closeSheet(); PXD.positionId=id||null; renderPersonalTxDetail(); }
window.pexdSheetPos=pexdSheetPos; window.pexdPickPos=pexdPickPos;
/* a one-line text sheet: counterparty name, quantity */
var _pexdTxtField=null;
function pexdSheetText(field){
  var E=_pexdEntry(); if(!E) return; _pexdTxtField=field;
  var isQty=field==='qty';
  var cur=isQty?(PXD.qty!==undefined?PXD.qty:(E.t.qty!=null?Math.abs(E.t.qty):'')):(PXD.who!==undefined?PXD.who:(E.t.who||''));
  setTxt('exdtxt-h', isQty?'Số lượng':(E.k==='loan'?(E.lent?'Cho ai mượn':'Mượn của ai'):(E.isIn?'Ai trả bạn':'Trả nợ cho ai')));
  setTxt('exdtxt-sub', isQty?'Số đã mua, ví dụ 0,0025 · thay đổi chờ Lưu':'Thay đổi chờ Lưu');
  var h='<input class="crs-in'+(isQty?' num':'')+'" id="exd-in-txt" '+(isQty?'inputmode="decimal"':'')+' value="'+escAttr(cur==null?'':String(cur).replace('.',','))+'" placeholder="'+(isQty?'0':'Tên')+'">';
  if(!isQty){
    var names={}; (E.pd.debts||[]).forEach(function(d){ if(d.who) names[d.who]=1; });
    var chips=Object.keys(names).filter(function(n){ return n!==cur; }).slice(0,8).map(function(n){ return '<button type="button" class="choice" onclick="pexdTxtDone(&#39;'+escAttr(n)+'&#39;)">'+esc(n)+'</button>'; }).join('');
    if(chips) h+='<div class="choices" style="margin-top:12px">'+chips+'</div>';
  }
  h+='<button type="button" class="crs-done" onclick="pexdTxtDone()">Xong</button>';
  setHTML('exdtxt-body', h);
  openSheet('sheet-exd-txt');
  setTimeout(function(){ var i=document.getElementById('exd-in-txt'); if(i&&isQty) i.focus(); },350);
}
function pexdTxtDone(v){
  var i=document.getElementById('exd-in-txt'); var val=(v!=null?v:((i&&i.value)||'')).trim();
  closeSheet();
  if(_pexdTxtField==='qty'){ var n=Number(val.replace(/\./g,'').replace(',','.')); PXD.qty=(n>0)?n:null; }
  else PXD.who=val;
  renderPersonalTxDetail();
}
window.pexdSheetText=pexdSheetText; window.pexdTxtDone=pexdTxtDone;
function pexdPickDue(v, final){
  PXD.dueIso=v||'';
  if(!final) return '<b class="num">'+(v?esc(v.slice(8,10)+'/'+v.slice(5,7)):'Chưa hẹn')+'</b>';
  renderPersonalTxDetail();
}
window.pexdPickDue=pexdPickDue;
/* Loại khoản: the conversions that exist for a booked row, each an in-place
   flip. Expense → loan / investment ask one more step in their own sheet;
   loan / investment → expense flip at once. The detail stays open and
   re-reads the row as its new kind. */
function pexdSheetKind(){
  var E=_pexdEntry(); if(!E) return;
  setTxt('exdkind-h','Loại khoản');
  setTxt('exdkind-sub','Đổi loại sẽ lưu ngay, không chờ Lưu.');
  var h='';
  if(E.k==='expense') h='<button type="button" class="choice on" onclick="closeSheet()">Chi tiêu</button><button type="button" class="choice" onclick="pexdPickKind(&#39;xfer&#39;)">🔁 Chuyển khoản nội bộ</button><button type="button" class="choice" onclick="pexdPickKind(&#39;loan&#39;)">🤝 Cho vay</button><button type="button" class="choice" onclick="pexdPickKind(&#39;invest&#39;)">📈 Đầu tư</button>';
  else if(E.k==='loan') h='<button type="button" class="choice on" onclick="closeSheet()">'+_pexdKindLbl(E)+'</button><button type="button" class="choice" onclick="pexdPickKind(&#39;expense&#39;)">Chi tiêu</button>';
  else if(E.k==='invest') h='<button type="button" class="choice on" onclick="closeSheet()">'+_pexdKindLbl(E)+'</button><button type="button" class="choice" onclick="pexdPickKind(&#39;expense&#39;)">Chi tiêu</button>';
  /* A lone converted leg can go back too — the pair goes with it. */
  else if(E.k==='xfer') h='<button type="button" class="choice on" onclick="closeSheet()">'+_pexdKindLbl(E)+'</button><button type="button" class="choice" onclick="pexdPickKind(&#39;expense&#39;)">Chi tiêu</button>';
  setHTML('exdkind-list', h);
  openSheet('sheet-exd-kind');
}
async function pexdPickKind(k){
  closeSheet(); var E=_pexdEntry(); if(!E) return; var id=E.id;
  if(k==='loan'||k==='invest'){ closePersonalTxDetail(); if(k==='loan'&&window.fhExpenseToLoanSheet) fhExpenseToLoanSheet(id); else if(window.fhExpenseToInvestSheet) fhExpenseToInvestSheet(id); return; }
  if(k==='xfer'){ pexdToTransferSheet(id); return; }
  var ok=false;
  try{
    ok = E.k==='loan'  ? await window.fhPersonalConvertToExpense(id,'Khác','🗂️')
       : E.k==='xfer'  ? await window.fhPersonalConvertTransferToExpense(id,'Khác','🗂️')
       :                 await window.fhPersonalConvertInvestmentToExpense(id,'Khác','🗂️');
    if(ok) await window.fhPersonalHydrate();
  }catch(e){}
  if(!ok){ toast('Chưa chuyển được, thử lại nhé'); return; }
  PXD={}; renderPersonalTxDetail();
  if(typeof renderPersonal==='function'){ try{ renderPersonal(); }catch(e){} }
  if(typeof refreshPersonalTxnOverlay==='function') refreshPersonalTxnOverlay();
  toast('Đã chuyển thành chi tiêu');
}
window.pexdSheetKind=pexdSheetKind; window.pexdPickKind=pexdPickKind;
var _pexdXferId=null;
function pexdToTransferSheet(id){
  _pexdXferId=id;
  var pd=(window.fhPersonalDebts&&fhPersonalDebts())||{accounts:[]};
  var P=window.fhPersonalData?fhPersonalData():null;
  var row=((P&&P.txns)||[]).find(function(t){ return t.id===id; });
  var ico={deposit:'🏦',ewallet:'📱',credit_card:'💳',cash:'💵',investment:'📈'};
  var list=((pd.accounts)||[]).filter(function(a){ return !a.archivedAt && a.id!==(row&&row.accountId); });
  var h=list.map(function(a){
    return '<button type="button" class="choice" onclick="pexdPickXferTo(&#39;'+escAttr(a.id)+'&#39;)">'
      +(ico[a.kind]||'🏦')+' '+esc(a.name||'Tài khoản')+'</button>';
  }).join('');
  if(!h) h='<div class="exd-rx-empty">Chưa có tài khoản nào để chuyển tới. Thêm ở mục Tài sản trước nhé.</div>';
  _pexdChoices('Tiền này đi đâu?', 'Chọn nơi nhận để hai bên số dư khớp nhau', h);
}
async function pexdPickXferTo(acctId){
  closeSheet();
  var id=_pexdXferId; _pexdXferId=null; if(!id||!acctId) return;
  var ok=false;
  try{ ok=await window.fhPersonalConvertToTransfer(id, acctId); }catch(e){}
  if(!ok){ toast('Chưa chuyển được, thử lại nhé'); return; }
  PXD={}; renderPersonalTxDetail();
  if(typeof renderPersonal==='function'){ try{ renderPersonal(); }catch(e){} }
  if(typeof refreshPersonalTxnOverlay==='function') refreshPersonalTxnOverlay();
  toast('Đã chuyển thành chuyển khoản, không còn tính là chi tiêu');
}
window.pexdToTransferSheet=pexdToTransferSheet; window.pexdPickXferTo=pexdPickXferTo;
/* Ghi vào đâu → the existing move confirm (59-ledger-move-ui) */
function pexdMove(){
  if(_pexdId==null) return;
  if(navigator.onLine===false){ toast('Cần mạng để chuyển sổ'); return; }
  if(!(window.DB&&DB.fid)){ toast('Vào một nhóm gia đình trước đã'); return; }
  _mvCtx={dir:'p2f', pid:_pexdId, cur:'personal'};
  fhMoveSheetOpen();
}

/* ── Lưu: one write per kind, through that kind's own writer ── */
async function pexdSave(){
  var E=_pexdEntry(); if(!E) return;
  pexdReadFields();
  if(!_pxdDirty()){ if(_pexdOpts.edit){ closePersonalTxDetail(); return; } _pexdEdit=false; renderPersonalTxDetail(); return; }
  var p=PXD, t=E.t, k=E.k;
  var amtBase=p.amtDisp!=null?parseAmtBase(p.amtDisp):E.amt;
  if(!(amtBase>0)){ toast('Nhập số tiền trước đã'); var ai=document.getElementById('pexd-amt'); if(ai) ai.focus(); return; }
  var go=document.getElementById('pexd-save');
  if(go){ if(go.disabled) return; go.disabled=true; go.textContent='Đang lưu…'; }
  var note=(p.note!=null?p.note:(t.note||'')), dateIso=(p.dateIso!=null?p.dateIso:t.date);
  var fieldsChanged=Object.keys(p).some(function(x){ return x!=='photos'; });
  var ok=false;
  try{
    if(!fieldsChanged) ok=true;
    else if(k==='expense'){
      var f={ amt:amtBase, note:note, cat:(p.cat!=null?p.cat:(t.cat||'')), emoji:(p.cat!=null?((catStyle[p.cat]||['🏷️'])[0]):(t.emoji||null)), time:(p.timeStr!==undefined?p.timeStr:(t.time||'')), dateIso:dateIso };
      if(p.hasOwnProperty('accountId')) f.accountId=p.accountId;
      if(p.node!==undefined){                              // 0144: the tree node, staged like every other field
        f.node=p.node||null;
        if(p.node && typeof window.fhLessonLearnNode==='function'){
          try{ window.fhLessonLearnNode({ note:note, amount:amtBase, node:p.node }); }catch(e){}
        }
      }
      ok=await window.fhPersonalUpdateExpense(E.id, f);
    } else if(k==='income'){
      var fi={ amt:amtBase, note:note, dateIso:dateIso };
      if(p.hasOwnProperty('accountId')) fi.accountId=p.accountId;
      if(p.timeStr!==undefined) fi.time=p.timeStr;
      if(p.cat!=null){ fi.cat=p.cat; fi.emoji=null; }
      if(p.node!==undefined) fi.node=p.node||null;   // 0144: income rows carry a node too (Lương, Hoàn tiền…)
      ok=await window.fhPersonalUpdateIncome(E.id, fi);
    } else if(k==='loan'||k==='repay'||k==='cardpay'){
      var sign=(t.amt!=null&&t.amt<0)?-1:1;
      var fd={ amtK:sign*amtBase, note:note||null, dateIso:dateIso };
      if(k==='loan'&&p.dueIso!==undefined) fd.dueDate=p.dueIso||null;
      if(p.who!==undefined) fd.who=p.who||null;
      if(p.hasOwnProperty('accountId')) fd.accountId=p.accountId;
      if(p.cardId!==undefined) fd.accountId=p.cardId;
      if(p.timeStr!==undefined) fd.time=p.timeStr;
      ok=await window.fhPersonalDebtRowUpdate(E.id, fd);
    } else if(k==='invest'){
      var fv={ amtK:amtBase, note:note||null, dateIso:dateIso };
      if(p.qty!==undefined) fv.qty=p.qty||0;
      if(p.positionId!==undefined) fv.positionId=p.positionId;
      if(p.hasOwnProperty('accountId')) fv.accountId=p.accountId;
      if(p.timeStr!==undefined) fv.time=p.timeStr;
      ok=await window.fhInvRowUpdate(E.id, fv);
    } else if(k==='xfer'){
      var fx={ amtK:amtBase, note:note||null, dateIso:dateIso };
      if(p.fromAccountId!==undefined) fx.fromAccountId=p.fromAccountId;
      if(p.toAccountId!==undefined) fx.toAccountId=p.toAccountId;
      if(p.timeStr!==undefined) fx.time=p.timeStr;
      ok=await window.fhPersonalUpdateTransferPair(E.gid, fx);
    }
    if(ok && p.photos!==undefined && window.fhPersonalSyncTxnPhotos){ ok=await fhPersonalSyncTxnPhotos(E.id, p.photos); await window.fhPersonalHydrate(); }
  }catch(e){ ok=false; }
  if(go){ go.disabled=false; go.textContent='Lưu'; }
  if(!ok){ toast('Chưa lưu được, thử lại nhé'); return; }
  PXD={};
  if(typeof renderPersonal==='function'){ try{ renderPersonal(); }catch(e){} }
  if(typeof refreshPersonalTxnOverlay==='function') refreshPersonalTxnOverlay();
  toast('Đã lưu');
  if(_pexdOpts.edit){ closePersonalTxDetail(); return; }
  _pexdEdit=false; renderPersonalTxDetail();
}
window.pexdSave=pexdSave;
function _pxdResetDel(){
  _pexdDelArmed=false; clearTimeout(_pexdDelT);
  var b=document.getElementById('pexd-del'); if(b){ var E=_pexdEntry(); b.classList.remove('armed'); b.textContent=E?_pexdDelLbl(E):'Xoá khoản này'; }
}
async function pexdDelete(){
  var b=document.getElementById('pexd-del');
  if(!_pexdDelArmed){
    _pexdDelArmed=true; if(b){ b.classList.add('armed'); b.textContent='Chạm lần nữa để xoá'; }
    clearTimeout(_pexdDelT); _pexdDelT=setTimeout(_pxdResetDel,3000); return;
  }
  _pxdResetDel();
  var E=_pexdEntry(); if(!E){ closePersonalTxDetail(); return; }
  if(b){ b.disabled=true; }
  var ok=false;
  try{ ok=E.k==='xfer'?await window.fhPersonalDeleteTransferPair(E.gid):await window.fhPersonalDeleteExpense(E.id); }catch(e){}
  if(b){ b.disabled=false; }
  if(!ok){ toast('Chưa xoá được, thử lại nhé'); return; }
  closePersonalTxDetail();
  if(typeof renderPersonal==='function'){ try{ renderPersonal(); }catch(e){} }
  if(typeof refreshPersonalTxnOverlay==='function') refreshPersonalTxnOverlay();
  toast('Đã xoá');
}
window.pexdDelete=pexdDelete;