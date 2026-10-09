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
    if(window.FH_RECUR && !isFuture) rows+=_exdRecurRow(t, 'fam');
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
    : _pexdRow(_pexdId);   // the detail's own lookup: the window, the debt read AND the older months. _pTxById saw only
                           // this month and last, so on a row from the 6-month history every picker returned without opening.
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
      try{ window.fhLessonLearnNode({ note:(p.note!=null?p.note:t.note), counterparty:null, amount:(Number(t.amt)||0)*curMult(), node:p.node }); }catch(e){}   // P10: đồng · A15: a FAMILY row's `who` is the member, never the payee
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
  if(_pexdCarry && _pexdCarry.id!==id) _pexdCarry=null;   // the offer belongs to the row that was just saved
  _pexdPre=null;
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
  if(!(_pexdCarry && _pexdCarry.state==='busy')) _pexdCarry=null;
  _pexdPre=null;
  _pexdId=null; PXD={}; _pexdEdit=false; _pexdOpts={};
  if(re&&re.length){ try{ if(re[0]==='person'&&window.openDebtPerson) openDebtPerson(re[1]); else if(re[0]==='acct'&&window.openDebtAccount) openDebtAccount(re[1]); else if(re[0]==='pos'&&window.openInvPosition) openInvPosition(re[1]); }catch(e){} }   // refresh the zoom-in underneath
}
window.closePersonalTxDetail=closePersonalTxDetail;
function pexdEdit(){ if(_pexdId==null) return; PXD={}; _pexdPre=null; _pexdEdit=true; renderPersonalTxDetail(); }
function pexdCancel(){ PXD={}; if(_pexdOpts.edit){ closePersonalTxDetail(); return; } _pexdPre=null; _pexdEdit=false; _pxdResetDel(); renderPersonalTxDetail(); }
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
  if(k==='expense') rows+=R('Danh mục',esc(em)+' '+esc(vCat||'Chưa rõ'),{chg:PXD.cat!=null, soft:!vCat, fn:"exdSheetCat('pers')"})+(ed?_pexdPreSubHTML(t,'cat'):'');
  if(k==='expense'||k==='income') rows+=_exdNodeRow(t, !!ed, 'pers')+((ed&&k==='expense')?_pexdPreSubHTML(t,'node'):'');
  if(k==='expense' && window.FH_RECUR) rows+=_exdRecurRow(t, 'pers');
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
    /* 0154 receipt enrichment: the joined merchant receipt, decrypted on this
       open only (the hydrate carries presence, never contents). A placeholder
       fills in when the blob arrives; unreadable says so instead of nothing. */
    if(t.hasReceipt){ html+='<div id="pexd-receipt"></div>'; _pexdReceiptLoad(t.id); }
    /* RC31: a private expense with no receipt may have one waiting that the
       rules could not place. Asked on this open only; nothing shows unless a
       receipt fits. */
    else if(k==='expense' && !t.spaceId && !t.linkId){ html+='<div id="pexd-receipt"></div>'; _pexdOfferLoad(t); }
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
    if(k==='expense') html+=_pexdPreFootHTML(t);          // apply-to-similar-spec §16: the carry, offered while the edit is still staged
    html+='<button type="button" class="exd-del" id="pexd-del" onclick="pexdDelete()">'+_pexdDelLbl(E)+'</button></div>';
  }
  body.innerHTML=html;
  _pexdCarryPaint();                       // the view state's one foot action, when a saved change can be carried (apply-to-similar-spec §14)
  _pxdResetDel();
}
window.renderPersonalTxDetail=renderPersonalTxDetail;

/* ── 0154: the Hoá đơn section — what the money actually bought ───────────────
   receipt-enrichment-spec RC12: seller, each item (qty × unit price), and the
   honest math — tổng tiền − voucher (− phí ship) = đã trả — so the paid figure
   on the row is explained, never contradicted. Read-only always: a receipt is
   the merchant's record, not an editable list. */
async function _pexdReceiptLoad(id){
  if(!window.fhPersonalGetReceipt) return;
  var rc=null;
  try{ rc=await fhPersonalGetReceipt(id); }catch(e){ rc=null; }
  var host=document.getElementById('pexd-receipt');
  if(!host || _pexdId!==id) return;                        // screen moved on while decrypting
  if(!rc){ host.innerHTML=''; _pexdRcCache=null; return; }
  if(rc==='_unreadable'){ _pexdRcCache=null;
    host.innerHTML=_exdSecH('Hoá đơn','')+'<div class="exd-meta"><div class="pexd-rc-miss">'+L('Chi tiết hoá đơn không đọc được trên máy này.','Receipt detail could not be read on this device.')+'</div></div>';
    return;
  }
  _pexdRcCache=rc;
  host.innerHTML=_pexdReceiptHTML(rc);
}
/* ── correcting an item's category (spec §20.4, RC19) ─────────────────────
   The pill is the affordance, and the pick takes effect at once: it rewrites
   the receipt blob AND is learned per person, encrypted, under the item's
   signature — so the next "mũ bơi" from any shop lands where this person
   said, with no call to anyone. The same tree picker every category row
   opens; only the subtitle differs, because nothing here waits for Lưu. */
var _pexdRcCache=null, _pexdRcIdx=null;
function _pexdRcSig(it){
  if(!it) return null;
  if(it.sig) return String(it.sig);
  try{ var hn=(typeof FH_TAX!=='undefined'&&FH_TAX.itemSignature)?FH_TAX.itemSignature(it.name):null; return hn?('hn|'+hn):null; }catch(e){ return null; }
}
function pexdRcItemPick(i){
  var rc=_pexdRcCache, it=rc&&rc.items&&rc.items[i]; if(!it||typeof fhNodePickOpen!=='function') return;
  _pexdRcIdx=i;
  fhNodePickOpen(it.node||null,'expense','pexdRcItemPicked',
    L('Chọn loại cho món này. Ghi nhớ luôn cho món cùng loại lần sau.','Pick what this item is. Remembered for the same kind next time.'));
}
window.pexdRcItemPick=pexdRcItemPick;
window.pexdRcItemPicked=async function(code){
  var rc=_pexdRcCache, i=_pexdRcIdx, id=_pexdId; if(!rc||i==null||!id) return;
  var it=rc.items&&rc.items[i]; if(!it) return;
  var node=(code&&typeof FH_TAX!=='undefined'&&FH_TAX.get(code))?code:null;
  it.node=node;
  var sig=_pexdRcSig(it);
  if(sig){ if(node){ if(window.fhLessonLearnItemNode) fhLessonLearnItemNode(sig,node); } else if(window.fhLessonForgetItemNode) fhLessonForgetItemNode(sig); }
  var ok=false;
  try{ ok=window.fhPersonalSetReceipt?await fhPersonalSetReceipt(id,rc,{upgrade:true}):false; }catch(e){ ok=false; }
  if(!ok){ window.toast&&toast(L('Chưa lưu được','Could not save')); return; }
  if(sig&&node&&window.toast) toast(L('Đã ghi nhớ cho món cùng loại','Remembered for items of this kind'));
  _pexdReceiptLoad(id);
};
/* A personal device is not information about the purchase. Apple prints the
   Mac or iPhone a rental was watched on as the last attribute; it reads as
   noise beside the genre and the kind. Dropped at render so blobs written
   before this still clean up. */
var _PEXD_RC_DEVICE=/^(iPhone|iPad|iPod|Mac|MacBook|iMac|Apple TV|Apple Watch|Vision Pro)\b|['\u2019]s\s+(MacBook|iPhone|iPad|Mac|iMac|Apple TV|Apple Watch)/i;
function _pexdRcVariant(v){
  if(!v) return '';
  return String(v).split(' \u00b7 ').map(function(x){ return x.trim(); })
    .filter(function(x){ return x && !_PEXD_RC_DEVICE.test(x); }).join(' \u00b7 ');
}
function _pexdReceiptHTML(rc){
  /* Money goes through fmt() like every figure in the app (DESIGN §6.1 — never
     format an amount by hand). Blob amounts are in đồng; fmt() takes base. */
  var money=function(n){ return fmt(Number(n||0)/(typeof curMult==='function'?curMult():1000)); };
  var trim=function(s){ return String(s||'').replace(/[\s.\u00b7|\u2022-]+$/,'').trim(); };
  var items=(rc.items||[]).filter(function(it){ return it && it.name; });
  var h=_exdSecH('Hoá đơn', items.length||'');
  h+='<div class="exd-meta pexd-rc">';
  var head=[trim(rc.seller)||rc.provider, rc.order_id?('#'+rc.order_id):null].filter(Boolean);
  if(head.length) h+='<div class="pexd-rc-head">'+esc(head.join(' \u00b7 '))+'</div>';
  /* An order-level receipt (a Grab ride) has no items; the service's own name
     is the one line that says what was bought (spec §21). */
  if(!items.length && rc.service_label) h+='<div class="pexd-rc-item"><div class="pexd-rc-main">'
    +'<span class="pexd-rc-name">'+esc(rc.service_label)+'</span></div></div>';
  items.forEach(function(it, idx){
    var nd=(it.node && typeof fhNodeShort==='function') ? fhNodeShort(it.node) : '';
    var va=_pexdRcVariant(it.variant);
    var meta='';
    /* Always an affordance: a category to correct, or a soft "Chọn loại" to
       give one. The pill is a real button — the tap target is the pill. */
    meta+='<button type="button" class="pexd-rc-cat'+(nd?'':' soft')+'" onclick="pexdRcItemPick('+idx+')">'
      +esc(nd||L('Chọn loại','Pick a kind'))+'</button>';
    if(va) meta+='<span class="pexd-rc-var">'+esc(va)+'</span>';
    h+='<div class="pexd-rc-item">'
      +'<div class="pexd-rc-main">'
        +'<span class="pexd-rc-name">'+((it.qty&&it.qty>1)?('<b>'+esc(it.qty)+'\u00d7</b> '):'')+esc(it.name)+'</span>'
        +(it.unit_price!=null?'<span class="pexd-rc-amt num">'+esc(money(it.unit_price))+'</span>':'')
      +'</div>'
      +(meta?'<div class="pexd-rc-meta">'+meta+'</div>':'')
      +'</div>';
  });
  /* Only what the screen does not already say: a single-item receipt whose one
     price IS the hero amount needs no "Đã trả" repeating it a third time; the
     voucher line always earns its place, because the gap between what the shop
     charged and what left the account is stated nowhere else. */
  var math=[];
  /* RC30: the account was charged more and part came back. Both lines are
     said, so the paid figure and the row's own amount explain each other. */
  if(rc.adjusted && rc.adjusted.refunded>0){ math.push(['Đã trừ', money(rc.adjusted.charged), '']); math.push(['Hoàn lại', '\u2212'+money(rc.adjusted.refunded), 'good']); }
  if(rc.items_total!=null && rc.items_total!==rc.paid) math.push(['Tổng tiền', money(rc.items_total), '']);
  if(rc.discount) math.push(['Voucher/giảm giá', '\u2212'+money(rc.discount), 'good']);
  if(rc.points_discount) math.push([rc.provider==='Grab'?'GrabCoins':L('Điểm thưởng','Points'), '\u2212'+money(rc.points_discount), 'good']);
  if(rc.shipping_fee) math.push(['Phí vận chuyển', money(rc.shipping_fee), '']);
  if(rc.tax) math.push(['Thuế', money(rc.tax), '']);
  if(rc.paid!=null && (math.length || items.length>1)) math.push([rc.period ? L('Đã trả · '+_pexdPeriodVi(rc.period), 'Paid · '+_pexdPeriodVi(rc.period)) : 'Đã trả', money(rc.paid), 'strong']);
  if(math.length){
    h+='<div class="pexd-rc-math">'+math.map(function(m){
      return '<div class="pexd-rc-mrow'+(m[2]?' '+m[2]:'')+'"><span>'+esc(m[0])+'</span><span class="num">'+esc(m[1])+'</span></div>';
    }).join('')+'</div>';
  }
  h+='</div>';
  /* RC31: not this purchase's receipt? Low-prominence, two taps (DESIGN §7:
     destructive is quiet and confirmed). */
  h+='<button type="button" class="pexd-rc-off" id="pexd-rc-off" onclick="pexdRcDetach()">'+esc(L('Gỡ hoá đơn','Remove receipt'))+'</button>';
  return h;
}

/* ── RC31: attach a waiting receipt, or take one off, by hand ─────────────── */
var _pexdOffers=null, _pexdRcOffArmed=false, _pexdRcOffT=null;
/* "09:18" on the Vietnamese wall clock, or "09/10" when the receipt states only a day. */
function _pexdRcWhen(iso){
  var ms=Date.parse(iso||''); if(!isFinite(ms)) return '';
  var d=new Date(ms+7*3600e3), p2=function(n){ return ('0'+n).slice(-2); };
  return (ms%864e5===0) ? (p2(d.getUTCDate())+'/'+p2(d.getUTCMonth()+1)) : (p2(d.getUTCHours())+':'+p2(d.getUTCMinutes()));
}
async function _pexdOfferLoad(t){
  _pexdOffers=null;
  if(!window.fhReceiptOffersLedger) return;
  var id=t.id, offers=[];
  try{ offers=await fhReceiptOffersLedger({ id:t.id, date:t.date, time:t.time||'', amt:t.amt||0, note:t.note||'', who:t.who||'', node:t.node||null }); }catch(e){ offers=[]; }
  var host=document.getElementById('pexd-receipt');
  if(!host || _pexdId!==id) return;                        // screen moved on while reading
  if(!offers.length){ host.innerHTML=''; return; }
  _pexdOffers={ id:id, t:t, list:offers };
  var money=function(n){ return fmt(Number(n||0)/(typeof curMult==='function'?curMult():1000)); };
  var h=_exdSecH('Hoá đơn','')+'<div class="exd-meta pexd-rc">'
    +'<div class="pexd-rc-head">'+esc(L('Có hoá đơn chưa gắn với khoản nào','A receipt is waiting for its transaction'))+'</div>';
  offers.forEach(function(o, i){
    var prov=String(o.provider||''), lbl=String(o.label||'');
    if(prov && lbl.toLowerCase().indexOf(prov.toLowerCase())===0) prov='';
    h+='<div class="pexd-rc-item"><div class="pexd-rc-main">'
      +'<span class="pexd-rc-name">'+esc([prov,lbl].filter(Boolean).join(' \u00b7 ')||L('Hoá đơn','Receipt'))+'</span>'
      +'<span class="pexd-rc-amt num">'+esc(money(o.paid))+'</span></div>'
      +'<div class="pexd-rc-meta"><span class="pexd-rc-var">'+esc(_pexdRcWhen(o.at))+'</span>'
      +'<button type="button" class="pexd-rc-cat pexd-rc-take" onclick="pexdRcAttach('+i+')">'+esc(L('Gắn vào khoản này','Attach to this'))+'</button></div></div>';
  });
  host.innerHTML=h+'</div>';
}
async function pexdRcAttach(i){
  var o=_pexdOffers; if(!o || o.id!==_pexdId || !o.list[i] || !window.fhReceiptAttachLedger) return;
  var ok=false;
  try{ ok=await fhReceiptAttachLedger(o.t, o.list[i]); }catch(e){ ok=false; }
  if(!ok){ toast(L('Chưa gắn được, thử lại','Could not attach, try again')); return; }
  _pexdOffers=null;
  toast(L('Đã gắn hoá đơn','Receipt attached'));
  if(_pexdId===o.id) renderPersonalTxDetail();
}
function _pexdRcOffReset(){
  _pexdRcOffArmed=false; clearTimeout(_pexdRcOffT);
  var b=document.getElementById('pexd-rc-off'); if(b){ b.classList.remove('armed'); b.textContent=L('Gỡ hoá đơn','Remove receipt'); }
}
async function pexdRcDetach(){
  var b=document.getElementById('pexd-rc-off'), id=_pexdId;
  if(id==null || !window.fhPersonalClearReceipt) return;
  if(!_pexdRcOffArmed){
    _pexdRcOffArmed=true; if(b){ b.classList.add('armed'); b.textContent=L('Chạm lần nữa để gỡ','Tap again to remove'); }
    clearTimeout(_pexdRcOffT); _pexdRcOffT=setTimeout(_pexdRcOffReset,3000); return;
  }
  _pexdRcOffReset();
  if(b) b.disabled=true;
  var ok=false;
  try{ ok=await fhPersonalClearReceipt(id); }catch(e){ ok=false; }
  if(b) b.disabled=false;
  if(!ok){ toast(L('Chưa gỡ được, thử lại','Could not remove, try again')); return; }
  _pexdRcCache=null;
  toast(L('Đã gỡ hoá đơn','Receipt removed'));
  if(_pexdId===id) renderPersonalTxDetail();
}
window.pexdRcAttach=pexdRcAttach; window.pexdRcDetach=pexdRcDetach;

/* "hàng tháng" / "hàng năm" / "hàng tuần" for a receipt's billing period. */
function _pexdPeriodVi(p){ return p==='year' ? L('hàng năm','yearly') : p==='week' ? L('hàng tuần','weekly') : L('hàng tháng','monthly'); }

/* ── Định kỳ (recurring-charges-spec §3.2, §18.7) ────────────────────────
   One row on both ledgers' detail screens, read from the ONE series view
   (29-recur.js): the series this row belongs to; else its stored mark; else
   the leaf's hint ("Có vẻ hàng tháng"); else Không. A pick WRITES AT ONCE
   (like Loại khoản), through the ledger's own door, and teaches the merchant
   under the series' key. */
function _exdRecurInfo(t, mode){
  var scope = mode==='fam' ? 'fam' : 'pers', id = mode==='fam' ? t._dbId : t.id;
  var s = window.fhRecurSeriesOfRow ? fhRecurSeriesOfRow(scope, id) : null;
  var o = { scope:scope, id:id, s:s, period:null, soft:false, hint:false };
  if(s){ o.period = s.period; o.soft = s.soft; }
  else if(t.recur){ o.period = t.recur; }
  else if(t.recurSrc!=='person' && !(window.fhRecurRowDeclined && fhRecurRowDeclined(scope, id))
          && window.FH_TAX && FH_TAX.recursOf){
    var h = FH_TAX.recursOf(t.node);
    if(h){ o.period = h.period; o.soft = true; o.hint = true; }
  }
  return o;
}
function _exdRecurRow(t, mode){
  var o = _exdRecurInfo(t, mode), s = o.s, p = o.period;
  var lbl = p ? FH_RECUR.labelVi(p) : '';
  var txt = !p ? L('Không','No') : (o.soft ? L('Có vẻ '+lbl, 'Maybe '+FH_RECUR.labelEn(p)) : lbl.replace(/^./, function(c){ return c.toUpperCase(); }));
  /* The second line, in the shape the rule line already has under a value
     (.rl-col): when the next charge is due, and whether this one cost more
     than the last. One fact per line; the value itself stays one word. */
  var dm = function(iso){ return iso.slice(8,10).replace(/^0/,'')+'/'+iso.slice(5,7).replace(/^0/,''); };
  var bits = [];
  if(s && !s.lapsed && s.next) bits.push(esc(s.dueInDays<0 ? L('Dự kiến '+dm(s.next),'Expected '+dm(s.next)) : L('Kỳ tới '+dm(s.next),'Next '+dm(s.next))));
  if(s && s.creep>0 && (s.anchor||s.latest).id===o.id) bits.push('<span class="rose">'+esc(L('tăng '+fmt(s.creep),'up '+fmt(s.creep)))+'</span>');
  var chev = '<svg class="csv-schev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m9 6 6 6-6 6"/></svg>';
  var fn = mode==='fam' ? 'exdSheetRecur()' : 'pexdSheetRecur()';
  var cls = 'csv-srow'+((!p||o.soft)?' soft':'')+(bits.length?' rl-has':'');
  var val = '<span class="csv-sval"><b>'+esc(txt)+'</b>'+chev+'</span>';
  return '<button type="button" class="'+cls+'" onclick="'+fn+'"><small>'+L('Định kỳ','Recurring')+'</small>'
    + (bits.length ? '<span class="rl-col">'+val+'<span class="rcr-by">'+bits.join(' · ')+'</span></span>' : val) + '</button>';
}
/* Four options, as chips (single-select, DESIGN §3). A guess selects nothing:
   the person confirms by picking the period, or declines with Không. */
function _exdRecurSheet(o, onPick){
  var cur = (o.period && !o.soft) ? o.period : (o.soft ? null : '');
  var opts=[['','Không','No'],['weekly','Hàng tuần','Weekly'],['monthly','Hàng tháng','Monthly'],['yearly','Hàng năm','Yearly']];
  var h = opts.map(function(x){ return '<button type="button" class="choice'+(cur===x[0]?' on':'')+'" onclick="'+onPick+'(&#39;'+x[0]+'&#39;)">'+esc(L(x[1],x[2]))+'</button>'; }).join('');
  var sub = (o.soft && o.period)
    ? L('Có vẻ lặp lại '+FH_RECUR.labelVi(o.period)+'. Chọn xong là lưu ngay.', 'Looks '+FH_RECUR.labelEn(o.period)+'. Your pick saves at once.')
    : L('Chọn xong là lưu ngay.', 'Your pick saves at once.');
  _pexdChoices(L('Định kỳ','Recurring'), sub, h);
}
/* After a pick: the row's own mark is the answer; the lesson carries it to the
   series (its key) or, for a row in no series, to the payee. */
function _exdRecurTeach(o, t, p){
  try{
    var er = window.fhRecurRowOf ? fhRecurRowOf(o.scope, o.id) : null;
    if(er){ er.recur = p; er.recurSrc = 'person'; }
    var key = o.s ? o.s.groupKey : FH_RECUR.primaryKey(er || { payee:(o.scope==='pers' ? (t.payee||'') : ''), note:t.note||'' });
    var amt = (er && er.amt) || t.amt || 0;
    if(key){ if(p && window.fhLessonLearnRecur) fhLessonLearnRecur(key, p, 'person', amt); else if(!p && window.fhLessonForgetRecur) fhLessonForgetRecur(key); }
  }catch(e){}
  if(window.fhRecurReanalyse) fhRecurReanalyse(o.scope);
  toast(p ? L('Đã đánh dấu '+FH_RECUR.labelVi(p),'Marked '+FH_RECUR.labelEn(p)) : L('Đã bỏ khỏi Định kỳ','Removed from Recurring'));
}
function pexdSheetRecur(){ var E=_pexdEntry(); if(!E) return; _exdRecurSheet(_exdRecurInfo(E.t,'pers'), 'pexdPickRecur'); }
async function pexdPickRecur(v){
  closeSheet(); var E=_pexdEntry(); if(!E) return; var t=E.t;
  var p = (v==='weekly'||v==='monthly'||v==='yearly') ? v : null;
  if(!window.fhPersonalPatchMany) return;
  var o = _exdRecurInfo(t,'pers');
  var ok = await fhPersonalPatchMany([{ id:E.id, fields:{ recur:p, recurSrc:'person' } }]);
  if(!ok || !ok.length){ toast(L('Chưa lưu được, thử lại','Couldn’t save, try again')); return; }
  t.recur=p; t.recurSrc='person';
  if(window.fhPersonalRecurTouch) fhPersonalRecurTouch(E.id, p, 'person');
  _exdRecurTeach(o, t, p);
  renderPersonalTxDetail();
}
function exdSheetRecur(){ var t=(typeof txById==='function')?txById(_expDetailId):null; if(!t) return; _exdRecurSheet(_exdRecurInfo(t,'fam'), 'exdPickRecur'); }
async function exdPickRecur(v){
  closeSheet(); var t=(typeof txById==='function')?txById(_expDetailId):null; if(!t||!t._dbId) return;
  var p = (v==='weekly'||v==='monthly'||v==='yearly') ? v : null;
  if(!window.fhTxnBulkPatch) return;
  var o = _exdRecurInfo(t,'fam');
  try{ await fhTxnBulkPatch(t._dbId, { recurrence:p, recurrence_source:'person' }); }catch(e){ toast(L('Chưa lưu được, thử lại','Couldn’t save, try again')); return; }
  t.recur=p; t.recurSrc='person';
  _exdRecurTeach(o, t, p);
  renderExpenseDetail();
}

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
  /* apply-to-similar-spec §14 (L1): a category-shaped change on a booked expense
     can be carried to the payee's other booked rows. What the row said BEFORE the
     save is captured here: the hydrate after the write replaces `t`. */
  var _cy=null;
  if(k==='expense'){
    var _cf={};
    if(p.cat!=null && p.cat!==(t.cat||'')) _cf.cat=p.cat;
    if(p.node!==undefined && (p.node||null)!==(t.node||null)) _cf.node=p.node||null;
    if(Object.keys(_cf).length) _cy={ id:E.id, who:t.who||'', note:note, amt:amtBase, fields:_cf, old:{ cat:t.cat||'', node:t.node||null } };
  }
  /* §17 (L14): what was switched on before Lưu goes out WITH this row, in one
     transaction — so the job is settled before anything is written. */
  var _job=(_cy && _pexdPre && _pexdPre.id===E.id)?_pexdPreJob(_cy):null, _res=null;
  var ok=false;
  try{
    if(!fieldsChanged) ok=true;
    else if(k==='expense'){
      var f={ amt:amtBase, note:note, cat:(p.cat!=null?p.cat:(t.cat||'')), emoji:(p.cat!=null?((catStyle[p.cat]||['🏷️'])[0]):(t.emoji||null)), time:(p.timeStr!==undefined?p.timeStr:(t.time||'')), dateIso:dateIso };
      if(p.hasOwnProperty('accountId')) f.accountId=p.accountId;
      if(p.node!==undefined){                              // 0144: the tree node, staged like every other field
        f.node=p.node||null;
        if(p.node && typeof window.fhLessonLearnNode==='function'){
          try{ window.fhLessonLearnNode({ note:note, counterparty:t.who||null, amount:(Number(amtBase)||0)*curMult(), node:p.node }); }catch(e){}   // P10: đồng · A15: personal row, `who` is the payee
        }
      }
      if(_job){ _res=await _pexdCarryWrite(_job.fields, _job.rows, { id:E.id, fields:f }); ok=_res.ok; }
      else ok=await window.fhPersonalUpdateExpense(E.id, f);
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
  if(!ok){ if(go){ go.disabled=false; go.textContent='Lưu'; } toast('Chưa lưu được, thử lại nhé'); return; }
  if(_job){ try{ await _pexdCarrySettle(); }catch(e){} }   // §16/§17: one reload for the row and everything it carried
  if(go){ go.disabled=false; go.textContent='Lưu'; }
  var _pre=_pexdPre; _pexdPre=null;
  /* carry-rules-spec §5.1 (R21): a rule switched on before Lưu is saved by Lưu */
  var _ru=null;
  if(_cy && _pre && _pre.rule && typeof fhRuleCommit==='function'){ try{ _ru=fhRuleCommit(fhRuleDraftLedger(_cy, _cy.fields, _pre.name)); }catch(e){ _ru=null; } }
  PXD={};
  if(!_job){
    if(typeof renderPersonal==='function'){ try{ renderPersonal(); }catch(e){} }
    if(typeof refreshPersonalTxnOverlay==='function') refreshPersonalTxnOverlay();
  }
  toast((_res ? ('Đã lưu và đổi '+_res.done.length+' khoản'+(_res.fail?' · '+_res.fail+' khoản không còn':'')) : 'Đã lưu')
    + (_ru ? (_ru.prev ? ' · Đã đổi quy tắc' : ' · Đã tạo quy tắc') : ''));
  if(_pexdOpts.edit){ closePersonalTxDetail(); return; }
  _pexdCarry=null;
  if(_res && _res.done.length){                          // the view state then shows "Đã áp dụng cho K khoản", whose sheet holds the undo (L1)
    _pexdCarry={ id:E.id, key:_pre.key, name:_pre.name, fields:_job.fields, old:_cy.old, rows:_job.rows, off:{}, state:'done', done:_res.done, fail:_res.fail, more:false, prog:0,
                 src:{ who:_cy.who, note:_cy.note, amt:_cy.amt }, ruleU:_ru };
  }
  _pexdEdit=false; renderPersonalTxDetail();
  if(_cy && !_job) pexdCarryScan(_cy);                   // nothing was switched on: the after-save offer still stands
}
window.pexdSave=pexdSave;

/* ═══ Corrections that carry, in the book (apply-to-similar-spec §14, L1–L7) ═══
   The review card's pattern, unchanged: after Lưu the view state shows ONE
   outlined button at the foot; it opens the same sheet (fhCarryBodyHTML, 56):
   what changed, the payee's other booked rows with a tick each, one CTA. Fields:
   Danh mục and Tiêu vào gì. Rows: private expenses in the 365-day match slice,
   same payee key, mirrors excluded. A row whose value is neither empty nor what
   THIS row said before the edit looks deliberate, and arrives unticked (L4). */
var _pexdCarry=null;
function _pexdCarryNodeLbl(n){ return (n && window.FH_TAX && FH_TAX.get(n)) ? FH_TAX.get(n).vi : 'Chưa rõ'; }
function _pexdCarryDiffers(cy, x){
  return (cy.fields.cat!==undefined && (x.cat||'')!==cy.fields.cat)
      || (cy.fields.node!==undefined && (x.node||null)!==(cy.fields.node||null));
}
function _pexdCarryDeliberate(cy, x){
  if(cy.fields.cat!==undefined && (x.cat||'')!==cy.fields.cat && (x.cat||'') && (x.cat||'')!==(cy.old.cat||'')) return true;
  if(cy.fields.node!==undefined && (x.node||null)!==(cy.fields.node||null) && x.node && x.node!==cy.old.node) return true;
  return false;
}
async function pexdCarryScan(cy){
  if(typeof csvPatternKey!=='function' || typeof window.fhPersonalMatchSlice!=='function') return;
  var key=csvPatternKey({ counterparty:cy.who, description:cy.note });
  if(!key || key.length<6) return;
  var name=String(cy.who||'').replace(/^[\d\s.:\-–—]+/,'').trim(); if(name.length<3) name=String(cy.who||'').trim();
  var cur=_pexdCarry={ id:cy.id, key:key, name:name, fields:cy.fields, old:cy.old, rows:[], off:{}, state:'scan', done:null, fail:0, more:false, prog:0,
                       src:{ who:cy.who, note:cy.note, amt:cy.amt }, ruleOn:false, ruleU:null };
  var slice=[]; try{ slice=await window.fhPersonalMatchSlice(); }catch(e){ slice=[]; }
  if(_pexdCarry!==cur) return;                                    // another save or another row since
  cur.rows=(slice||[]).filter(function(x){
    if(x.id===cy.id || x.link || x.kind!=='expense' || !(Number(x.amt)>0)) return false;   // mirror rows follow the family copy (A9)
    if(csvPatternKey({ counterparty:x.who||'', description:x.note||'' })!==key) return false;
    return _pexdCarryDiffers(cur, x);
  });
  cur.rows.forEach(function(x){ if(_pexdCarryDeliberate(cur, x)) cur.off[x.id]=1; });
  cur.state=cur.rows.length?'idle':'none';
  _pexdCarryPaint();
}
function _pexdCarryOn(cy){ return cy.rows.filter(function(x){ return !cy.off[x.id]; }); }
/* The foot of the VIEW state. Absent while scanning, in edit, and when nothing
   similar exists: hidden, never disabled. */
function _pexdCarryPaint(){
  var cta=document.getElementById('pexd-cta'); if(!cta) return;
  var cy=_pexdCarry, h='';
  if(cy && cy.id===_pexdId && !_pexdEdit && (cy.state==='idle'||cy.state==='busy'||cy.state==='done')){
    var txt, cls='csv-cta-sec';
    if(cy.state==='done'){ txt='Đã áp dụng cho '+(cy.done||[]).length+' khoản'; cls+=' done'; }
    else { var n=_pexdCarryOn(cy).length||cy.rows.length; txt=cy.name?('Áp dụng cho '+n+' khoản khác của '+cy.name):('Áp dụng cho '+n+' khoản giống'); }
    h='<button type="button" class="'+cls+'" onclick="pexdCarrySheet()"><span>'+esc(txt)+'</span></button>';
  }
  cta.innerHTML=h;
}
function _pexdCarryWhen(x){
  var d=String(x.date||''), y=d.slice(0,4), now=String((typeof TODAY!=='undefined'&&TODAY.getFullYear)?TODAY.getFullYear():'');
  var s=d.slice(8,10)+'/'+d.slice(5,7)+(y&&now&&y!==now?'/'+y.slice(2):'');
  var t=String(x.note||'').trim().slice(0,26);
  return s+(t?' · '+t:'');
}
function pexdCarryRender(){
  var cy=_pexdCarry, body=document.getElementById('carry-body'); if(!cy || !body) return;
  var CAP=5, top=document.getElementById('sheet-carry'); var st=top?top.scrollTop:0;
  setTxt('carry-h','Áp dụng cho khoản giống');
  setTxt('carry-sub',cy.name?('Cùng người nhận: '+cy.name):'Cùng nội dung');
  var fields=[];
  if(cy.fields.cat!==undefined) fields.push({ label:'Danh mục', value:((catStyle[cy.fields.cat]||['🏷️'])[0])+' '+cy.fields.cat });
  if(cy.fields.node!==undefined) fields.push({ label:'Tiêu vào gì', value:_pexdCarryNodeLbl(cy.fields.node) });
  var was=function(x){ return cy.fields.cat!==undefined ? (x.cat||'Chưa rõ') : _pexdCarryNodeLbl(x.node); };
  var m={ fields:fields, secs:[] };
  if(cy.state==='done'){
    var dn=cy.done||[];
    m.secs.push({ title:'Đã áp dụng · '+dn.length+' khoản', link:{ label:'Hoàn tác', tap:'pexdCarryUndo()' },
      rows:dn.slice(0,CAP).map(function(d){ return { on:true, ro:true, when:_pexdCarryWhen(d.t), amt:fmt(d.t.amt) }; }) });
    if(cy.ruleU) m.rule={ title:'Khoản sau này', done: cy.ruleU.prev ? 'Đã đổi quy tắc' : 'Đã tạo quy tắc' };   // Hoàn tác above takes it back too (R19)
    m.cta={ label:'Xong', tap:'closeSheet()', cls:'cta' };
  } else {
    var shown=cy.more?cy.rows:cy.rows.slice(0,CAP), on=_pexdCarryOn(cy).length;
    m.secs.push({ title:cy.rows.length+' khoản đã ghi',
      rows:shown.map(function(x){ return { on:!cy.off[x.id], ro:cy.state==='busy', tap:"pexdCarryTick('"+escAttr(String(x.id))+"')", when:_pexdCarryWhen(x), was:was(x), amt:fmt(x.amt) }; }),
      more:(cy.rows.length>shown.length && cy.state!=='busy')?{ label:'Xem cả '+cy.rows.length+' khoản', tap:'pexdCarryMore()' }:null });
    if(cy.ruleU) m.rule={ title:'Khoản sau này', done: cy.ruleU.prev ? 'Đã đổi quy tắc' : 'Đã tạo quy tắc', link: cy.state==='busy' ? null : { label:'Hoàn tác', tap:'pexdCarryRuleUndo()' } };
    else if(typeof fhRuleBlock==='function') m.rule=fhRuleBlock(fhRuleDraftLedger(cy.src||{}, cy.fields, cy.name), cy.ruleOn, 'pexdCarryRuleToggle()');
    var _rOnly=!on && cy.ruleOn && !cy.ruleU;
    m.cta=(cy.state==='busy') ? { label:'Đang đổi…', tap:'', busy:true, cls:'cta' }
                              : { label:on?('Áp dụng cho '+on+' khoản'):(_rOnly?'Lưu quy tắc':'Xong'), tap:(on||_rOnly)?'pexdCarryGo()':'closeSheet()', cls:'cta' };
  }
  body.innerHTML=fhCarryBodyHTML(m);
  if(top) top.scrollTop=st;
}
function pexdCarrySheet(){
  var cy=_pexdCarry; if(!cy || cy.id!==_pexdId) return;
  cy.more=false; pexdCarryRender(); openSheet('sheet-carry');
}
function pexdCarryTick(id){
  var cy=_pexdCarry; if(!cy || cy.state!=='idle') return;
  if(cy.off[id]) delete cy.off[id]; else cy.off[id]=1;
  pexdCarryRender(); _pexdCarryPaint();
}
function pexdCarryMore(){ if(_pexdCarry){ _pexdCarry.more=true; pexdCarryRender(); } }
function pexdCarryRuleToggle(){ var cy=_pexdCarry; if(cy && cy.state==='idle' && !cy.ruleU){ cy.ruleOn=!cy.ruleOn; pexdCarryRender(); } }
function pexdCarryRuleUndo(){
  var cy=_pexdCarry; if(!cy || !cy.ruleU || typeof fhRuleRevert!=='function') return;
  fhRuleRevert(cy.ruleU); cy.ruleU=null; toast('Đã hoàn tác'); pexdCarryRender();
}
function _pexdCarryRuleSave(cy){
  if(!cy || !cy.ruleOn || cy.ruleU || typeof fhRuleCommit!=='function') return null;
  var u=null; try{ u=fhRuleCommit(fhRuleDraftLedger(cy.src||{}, cy.fields, cy.name)); }catch(e){ u=null; }
  cy.ruleOn=false; cy.ruleU=u;
  return u;
}
function _pexdCarryLrow(t){ return { counterparty:t.who||'', memo:t.note||'', amount:(Number(t.amt)||0)*curMult() }; }   // the lesson speaks đồng (P10); a personal row's payee is `who` (A15)
/* The writes (§17, L14–L18): ONE request, one transaction, through
   fhPersonalPatchMany. Each row is sent only the columns that change on it — a
   carried label never re-sends that row's amount or note. `lead` is the row
   being saved on the edit screen, when the carry rides with Lưu: it and the
   others land together or not at all. Nothing local is touched until the
   database answers; a node then teaches that row's banded lesson, exactly as a
   pick on the row would. The label store is the review's and is not loaded
   here, so a label teaches nothing from this screen (L6). */
async function _pexdCarryWrite(fields, rows, lead){
  var plan=[], patches=lead?[lead]:[];
  rows.forEach(function(t){
    var f={}, n=0;
    if(fields.cat!==undefined && (t.cat||'')!==fields.cat){ f.cat=fields.cat; f.emoji=((catStyle[fields.cat]||['🏷️'])[0]); n++; }
    if(fields.node!==undefined && (t.node||null)!==(fields.node||null)){ f.node=fields.node||null; n++; }
    if(n){ plan.push({ t:t, f:f }); patches.push({ id:t.id, fields:f }); }
  });
  if(!patches.length) return { ok:true, done:[], fail:0 };
  var ids=null;
  try{ ids=await window.fhPersonalPatchMany(patches); }catch(e){ ids=null; }
  if(!ids) return { ok:false, done:[], fail:plan.length };
  var hit={}, done=[], fail=0; ids.forEach(function(x){ hit[String(x)]=1; });
  plan.forEach(function(p){
    var t=p.t; if(!hit[String(t.id)]){ fail++; return; }       // gone since the list was read
    var prev={ cat:t.cat||'', node:t.node||null }, lp=null, taught=false;
    if(p.f.cat!==undefined) t.cat=p.f.cat;
    if(p.f.node!==undefined){
      if(typeof window.fhLessonNode==='function'){ try{ lp=window.fhLessonNode(_pexdCarryLrow(t))||null; }catch(e){} }
      t.node=p.f.node;
      if(p.f.node && typeof window.fhLessonLearnNode==='function'){ try{ var lr=_pexdCarryLrow(t); lr.node=p.f.node; window.fhLessonLearnNode(lr); taught=true; }catch(e){} }
    }
    done.push({ t:t, prev:prev, lesson:lp, taught:taught });
  });
  return { ok:true, done:done, fail:fail };
}
async function pexdCarryGo(){
  var cy=_pexdCarry; if(!cy || cy.state!=='idle') return;
  var rows=_pexdCarryOn(cy);
  if(!rows.length){                                          // the rule alone: nothing to write in the book
    var u0=_pexdCarryRuleSave(cy); if(!u0) return;
    closeSheet(); toast(u0.prev ? 'Đã đổi quy tắc' : 'Đã tạo quy tắc'); _pexdCarryPaint(); return;
  }
  if(navigator.onLine===false){ toast('Cần mạng để đổi khoản đã ghi'); return; }
  cy.state='busy'; pexdCarryRender(); _pexdCarryPaint();
  var res=await _pexdCarryWrite(cy.fields, rows, null);
  if(!res.ok){                                             // nothing was written: the sheet stays, as it was
    if(_pexdCarry===cy){ cy.state='idle'; pexdCarryRender(); _pexdCarryPaint(); }
    toast('Chưa đổi được, thử lại nhé'); return;
  }
  var done=res.done, fail=res.fail;
  var u=_pexdCarryRuleSave(cy);                              // after the rows landed, never before (R21)
  await _pexdCarrySettle();
  if(_pexdCarry===cy){ cy.done=done; cy.fail=fail; cy.state=done.length?'done':'idle'; }
  closeSheet();
  toast((fail ? ('Đã đổi '+done.length+' khoản · '+fail+' khoản không còn') : ('Đã đổi '+done.length+' khoản'))
    + (u ? (u.prev ? ' · Đã đổi quy tắc' : ' · Đã tạo quy tắc') : ''));
  if(_pexdCarry===cy) _pexdCarryPaint();
}
async function _pexdCarrySettle(){
  if(window.fhPersonalMatchSliceInvalidate) fhPersonalMatchSliceInvalidate();
  try{ if(window.fhPersonalHydrate) await window.fhPersonalHydrate(); }catch(e){}
  if(typeof renderPersonal==='function'){ try{ renderPersonal(); }catch(e){} }
  if(typeof refreshPersonalTxnOverlay==='function'){ try{ refreshPersonalTxnOverlay(); }catch(e){} }
}
async function pexdCarryUndo(){
  var cy=_pexdCarry; if(!cy || cy.state!=='done') return;
  if(navigator.onLine===false){ toast('Cần mạng để đổi khoản đã ghi'); return; }
  cy.state='busy'; _pexdCarryPaint();
  var dn=cy.done||[], plan=[];
  var lk=document.querySelector('#carry-body .cry-sec .cry-link'); if(lk){ lk.disabled=true; lk.textContent='Đang hoàn tác…'; }
  dn.forEach(function(d){                                   // each row back to what IT said, all in one transaction (§17)
    var t=d.t, f={}, n=0;
    if((t.node||null)!==(d.prev.node||null)){ f.node=d.prev.node||null; n++; }
    if((t.cat||'')!==(d.prev.cat||'')){ f.cat=d.prev.cat; f.emoji=((catStyle[d.prev.cat]||['🏷️'])[0]); n++; }
    if(n) plan.push({ d:d, f:f });
  });
  var ids=[];
  if(plan.length){ try{ ids=await window.fhPersonalPatchMany(plan.map(function(p){ return { id:p.d.t.id, fields:p.f }; })); }catch(e){ ids=null; } }
  if(!ids){                                                // nothing was undone: the offer to undo stands
    if(_pexdCarry===cy){ cy.state='done'; _pexdCarryPaint(); }
    if(lk){ lk.disabled=false; lk.textContent='Hoàn tác'; }
    toast('Chưa hoàn tác được, thử lại nhé'); return;
  }
  var hit={}; ids.forEach(function(x){ hit[String(x)]=1; });
  plan.slice().reverse().forEach(function(p){              // lessons unwind newest first: a later row's 'before' may be an earlier row's lesson
    var d=p.d, t=d.t; if(!hit[String(t.id)]) return;        // the row is gone: nothing left to undo on it
    if(p.f.node!==undefined){
      t.node=d.prev.node;
      if(d.taught){ var lr=_pexdCarryLrow(t);
        if(d.lesson && window.fhLessonLearnNode){ lr.node=d.lesson; window.fhLessonLearnNode(lr); }
        else if(window.fhLessonForgetNode) window.fhLessonForgetNode(lr); }
    }
    if(p.f.cat!==undefined) t.cat=d.prev.cat;
  });
  if(cy.ruleU && typeof fhRuleRevert==='function'){ fhRuleRevert(cy.ruleU); cy.ruleU=null; }   // one act, one undo (R19)
  await _pexdCarrySettle();
  if(_pexdCarry===cy){ cy.done=null; cy.state='idle'; }
  closeSheet();
  toast('Đã hoàn tác');
  if(_pexdCarry===cy) _pexdCarryPaint();
}
/* ── before Lưu (apply-to-similar-spec §16, L8–L13) ──────────────────────────
   The same offer while the edit is still staged. Each changed carried row gets a
   switch as its second line ("this change, for the similar rows too"); from the
   first change a foot button, "Áp dụng n thay đổi cho m khoản", opens the sheet
   with every change switched on and the rows listed. The switches, the button
   and the sheet are ONE state (_pexdPre.use + the ticks). Nothing is written
   here: Lưu writes this row and the others, Huỷ drops it all. */
var _pexdPre=null;
function _pexdPreFields(t){
  var f={};
  if(PXD.cat!=null && PXD.cat!==(t.cat||'')) f.cat=PXD.cat;
  if(PXD.node!==undefined && (PXD.node||null)!==(t.node||null)) f.node=PXD.node||null;
  return f;
}
/* Start (once per edit) the read of the payee's other booked rows. */
function _pexdPreEnsure(t){
  if(_pexdPre && _pexdPre.id===t.id) return _pexdPre;
  if(typeof csvPatternKey!=='function' || typeof window.fhPersonalMatchSlice!=='function') return null;
  var key=csvPatternKey({ counterparty:t.who||'', description:t.note||'' });
  if(!key || key.length<6) return null;
  var name=String(t.who||'').replace(/^[\d\s.:\-–—]+/,'').trim(); if(name.length<3) name=String(t.who||'').trim();
  var pre=_pexdPre={ id:t.id, key:key, name:name, slice:null, tick:{}, use:{}, draft:null, more:false, rule:false };
  window.fhPersonalMatchSlice().then(function(sl){
    if(_pexdPre!==pre) return;
    pre.slice=(sl||[]).filter(function(x){
      return x.id!==t.id && !x.link && x.kind==='expense' && Number(x.amt)>0 && csvPatternKey({ counterparty:x.who||'', description:x.note||'' })===key;
    });
    if(_pexdEdit && _pexdId===t.id) renderPersonalTxDetail();
  }, function(){ if(_pexdPre===pre) pre.slice=[]; });
  return pre;
}
function _pexdPreCy(t, fields){ return { fields:fields, old:{ cat:t.cat||'', node:t.node||null } }; }
function _pexdPreTicked(pre, cy, x){
  if(pre.tick[x.id]!==undefined) return !!pre.tick[x.id];
  return !_pexdCarryDeliberate(cy, x);                       // L4: a row that looks deliberate starts unticked
}
/* The rows ONE set of fields would change, and which of them are ticked. */
function _pexdPreRows(t, fields){
  var pre=_pexdPre; if(!pre || pre.id!==t.id || !pre.slice) return { all:[], on:[] };
  var cy=_pexdPreCy(t, fields), all=pre.slice.filter(function(x){ return _pexdCarryDiffers(cy, x); });
  var cyAll=_pexdPreCy(t, _pexdPreFields(t));                // the tick is one answer per row, judged against everything staged
  return { all:all, on:all.filter(function(x){ return _pexdPreTicked(pre, cyAll, x); }) };
}
function _pexdPreOne(f, v){ var o={}; o[f]=v; return o; }
function _pexdPreSubHTML(t, f){
  var fields=_pexdPreFields(t); if(fields[f]===undefined) return '';
  var pre=_pexdPreEnsure(t); if(!pre || !pre.slice) return '';
  var n=_pexdPreRows(t, _pexdPreOne(f, fields[f])).on.length; if(!n) return '';
  var on=!!pre.use[f];
  return '<button type="button" class="exd-sub" role="switch" aria-checked="'+(on?'true':'false')+'" onclick="pexdPreToggle(\''+f+'\')">'
    +'<span class="t">Áp dụng cho '+n+' khoản giống</span><span class="cry-sw'+(on?' on':'')+'"></span></button>';
}
function _pexdPreFootHTML(t){
  var fields=_pexdPreFields(t), n=Object.keys(fields).length; if(!n) return '';
  var pre=_pexdPreEnsure(t); if(!pre || !pre.slice) return '';
  var m=_pexdPreRows(t, fields).on.length;
  if(!m){                                                    // a payee with no similar rows yet: the door to a rule (carry-rules-spec §5.1)
    if(typeof fhRuleDraftLedger!=='function' || typeof fhRulesUsable!=='function' || !fhRulesUsable() || !fhRuleDraftLedger(t, fields, pre.name)) return '';
    return '<div class="exd-carry-foot"><button type="button" class="csv-cta-sec" onclick="pexdPreSheet()"><span>Áp dụng cho khoản sau này</span></button></div>';
  }
  return '<div class="exd-carry-foot"><button type="button" class="csv-cta-sec" onclick="pexdPreSheet()"><span>Áp dụng '+n+' thay đổi cho '+m+' khoản</span></button></div>';
}
function pexdPreToggle(f){
  var pre=_pexdPre; if(!pre) return;
  pre.use[f]=!pre.use[f];
  renderPersonalTxDetail();
}
/* The sheet opens with every staged change switched on (the button means "all
   of them"); "Chọn" commits that to the screen behind, closing it does not. */
function pexdPreSheet(){
  var t=_exdModeRow(); if(!t || !_pexdPre) return;
  pexdReadFields();
  var fields=_pexdPreFields(t); _pexdPre.draft={ rule:!!_pexdPre.rule };
  Object.keys(fields).forEach(function(f){ _pexdPre.draft[f]=true; });
  _pexdPre.more=false;
  pexdPreRender(); openSheet('sheet-carry');
}
function _exdModeRow(){ var E=_pexdEntry(); return E?E.t:null; }
function _pexdPreDraftFields(t){
  var all=_pexdPreFields(t), d=(_pexdPre&&_pexdPre.draft)||{}, out={};
  Object.keys(all).forEach(function(f){ if(d[f]) out[f]=all[f]; });
  return out;
}
function pexdPreRender(){
  var pre=_pexdPre, t=_exdModeRow(), body=document.getElementById('carry-body'); if(!pre || !t || !body) return;
  var CAP=5, top=document.getElementById('sheet-carry'), st=top?top.scrollTop:0;
  setTxt('carry-h','Áp dụng cho khoản giống');
  setTxt('carry-sub',pre.name?('Cùng người nhận: '+pre.name):'Cùng nội dung');
  var all=_pexdPreFields(t), fields=[];
  if(all.cat!==undefined) fields.push({ label:'Danh mục', value:((catStyle[all.cat]||['🏷️'])[0])+' '+all.cat, sw:{ on:!!pre.draft.cat, tap:"pexdPreDraft('cat')" } });
  if(all.node!==undefined) fields.push({ label:'Tiêu vào gì', value:_pexdCarryNodeLbl(all.node), sw:{ on:!!pre.draft.node, tap:"pexdPreDraft('node')" } });
  var df=_pexdPreDraftFields(t), r=_pexdPreRows(t, df), cyAll=_pexdPreCy(t, all);
  var shown=pre.more?r.all:r.all.slice(0,CAP);
  var was=function(x){ return df.cat!==undefined ? (x.cat||'Chưa rõ') : _pexdCarryNodeLbl(x.node); };
  var m={ fields:fields, secs:[{ title:r.all.length+' khoản đã ghi',
    rows:shown.map(function(x){ return { on:_pexdPreTicked(pre, cyAll, x), tap:"pexdPreTick('"+escAttr(String(x.id))+"')", when:_pexdCarryWhen(x), was:was(x), amt:fmt(x.amt) }; }),
    more:(r.all.length>shown.length)?{ label:'Xem cả '+r.all.length+' khoản', tap:'pexdPreMore()' }:null }] };
  if(!r.all.length){ m.secs=[]; m.fields.forEach(function(x){ delete x.sw; }); }   // nothing to carry to: the change is shown, not switched
  if(typeof fhRuleBlock==='function') m.rule=fhRuleBlock(fhRuleDraftLedger(t, all, pre.name), pre.draft.rule, 'pexdPreDraft(&#39;rule&#39;)');
  m.cta=r.on.length ? { label:'Chọn '+r.on.length+' khoản', tap:'pexdPreChoose()', cls:'cta' } : { label:'Xong', tap:'pexdPreChoose()', cls:'cta' };
  body.innerHTML=fhCarryBodyHTML(m);
  if(top) top.scrollTop=st;
}
function pexdPreDraft(f){ if(_pexdPre && _pexdPre.draft){ _pexdPre.draft[f]=!_pexdPre.draft[f]; pexdPreRender(); } }
function pexdPreTick(id){
  var pre=_pexdPre, t=_exdModeRow(); if(!pre || !t || !pre.slice) return;
  var x=pre.slice.filter(function(r){ return String(r.id)===String(id); })[0]; if(!x) return;
  pre.tick[x.id]=!_pexdPreTicked(pre, _pexdPreCy(t, _pexdPreFields(t)), x);
  pexdPreRender();
}
function pexdPreMore(){ if(_pexdPre){ _pexdPre.more=true; pexdPreRender(); } }
function pexdPreChoose(){
  var pre=_pexdPre; if(!pre) return;
  var t=_exdModeRow(), has=t?_pexdPreRows(t, _pexdPreDraftFields(t)).on.length:0;
  pre.use={}; if(has) Object.keys(pre.draft||{}).forEach(function(f){ if(f!=='rule' && pre.draft[f]) pre.use[f]=true; });
  pre.rule=!!(pre.draft && pre.draft.rule);                  // staged with the edit: Lưu saves it, Huỷ drops it (R21)
  pre.draft=null;
  closeSheet(); renderPersonalTxDetail();
}
/* What Lưu will carry: the fields that were both changed and switched on, over
   the ticked rows that differ on them. Null when nothing was switched on. */
function _pexdPreJob(cy){
  var pre=_pexdPre; if(!pre || !pre.slice) return null;
  var fields={}; Object.keys(cy.fields).forEach(function(f){ if(pre.use[f]) fields[f]=cy.fields[f]; });
  if(!Object.keys(fields).length) return null;
  var one={ fields:fields, old:cy.old }, all={ fields:cy.fields, old:cy.old };
  var rows=pre.slice.filter(function(x){ return _pexdCarryDiffers(one, x) && _pexdPreTicked(pre, all, x); });
  return rows.length ? { fields:fields, rows:rows } : null;
}
window.pexdPreToggle=pexdPreToggle; window.pexdPreSheet=pexdPreSheet; window.pexdPreDraft=pexdPreDraft; window.pexdPreTick=pexdPreTick;
window.pexdPreMore=pexdPreMore; window.pexdPreChoose=pexdPreChoose;
window.pexdCarrySheet=pexdCarrySheet; window.pexdCarryTick=pexdCarryTick; window.pexdCarryMore=pexdCarryMore;
window.pexdCarryGo=pexdCarryGo; window.pexdCarryUndo=pexdCarryUndo; window.pexdCarryRuleToggle=pexdCarryRuleToggle; window.pexdCarryRuleUndo=pexdCarryRuleUndo;
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