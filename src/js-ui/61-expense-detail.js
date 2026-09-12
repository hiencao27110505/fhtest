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
  var col=mm?mm.col:(isShared?'#8f8a99':(demoCol[lk]||'#8a8494'));
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
   a value someone changed wears the brand dot (.chg) until Cập nhật lands —
   staged commit (Q8b), nothing saves per-field. */
var EXD={};   // pending family-detail changes: {cat, who, amtDisp, note, dateIso, timeStr}
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
  // pending values paint over the row's own — with the .chg dot — until Cập nhật
  var vCat=EXD.cat!=null?EXD.cat:t.cat;
  var vWho=EXD.who!=null?EXD.who:((/^(both|shared)$/i.test(String(t.who||'')))?'Both':t.who);
  var vAmtDisp=EXD.amtDisp!=null?EXD.amtDisp:(typeof amtToInput==='function'?amtToInput(t.amt):String(t.amt));
  var vNote=EXD.note!=null?EXD.note:(t.note||'');
  var vTime=EXD.timeStr!==undefined?EXD.timeStr:(t.time||'');
  var s=catStyle[vCat]||catStyle[t.cat]||['🧾','#f2eef6','var(--cat-other)'];
  var wd=_whoDisp(vWho);
  var isFuture=!!t.future;
  var item=(isFuture && typeof _entNorm==='function')?_entNorm('expense',t,t.id):null;
  var incoming=!!(item && typeof _entPending==='function' && _entPending(item) && typeof _isMine==='function' && !_isMine(item));
  var canEdit=!incoming;
  var html='<div class="exd-focal">'
    +'<div class="exd-ico" style="background:'+s[1]+';color:'+s[2]+'">'+esc(EXD.cat!=null?s[0]:t.ico)+'</div>'
    +'<div class="exd-amt num">'+esc(vAmtDisp)+(CUR==='VND'?' ₫':'')+'</div>'
    +'<div class="exd-note">'+esc(vNote||L('Khoản chi','Expense'))+'</div>'
    +'<div class="exd-prov">'+esc(_exdDate(t))+(vTime?'<span class="sep">·</span>'+esc(vTime):'')
      +(t.inst?'<span class="sep">·</span>'+esc(t.inst):'')+'</div>'
    +(isFuture?('<div class="exd-plan'+(incoming?' wait':'')+'">'+(incoming?L('chờ bạn duyệt','awaiting your review'):('📅 '+L('Chi tiêu dự kiến','Planned')))+'</div>'):'')
    +'</div>';
  // meta = settings-rows: editable rows open their sheet; provenance stays read-only
  var rows='';
  rows+=_exdRow({label:L('Danh mục','Category'), chg:EXD.cat!=null, ro:!canEdit,
    val:'<b>'+s[0]+' '+esc(vCat)+'</b>', fn:"exdSheetCat('fam')"});
  rows+=_exdRow({label:isFuture?L('Đề xuất bởi','Proposed by'):L('Ai trả','Who paid'), chg:EXD.who!=null, ro:!canEdit||isFuture,
    val:'<span class="exd-av" style="'+window.fhAvStyle(wd)+'">'+esc(window.fhAvIni(wd))+'</span><b>'+esc(wd.name)+'</b>', fn:"exdSheetWho()"});
  rows+=_exdRow({label:L('Số tiền & ghi chú','Amount & note'), chg:(EXD.amtDisp!=null||EXD.note!=null), ro:!canEdit,
    val:'<b class="num">'+esc(vAmtDisp)+(CUR==='VND'?' ₫':'')+'</b>', fn:"exdSheetAmt('fam')"});
  rows+=_exdRow({label:L('Khi nào','When'), chg:(EXD.dateIso!=null||EXD.timeStr!==undefined), ro:!canEdit,
    val:'<b class="num">'+esc(_exdDate(t))+(vTime?' · '+esc(vTime):'')+'</b>', fn:"exdSheetWhen('fam')"});
  if(t.inst) rows+=_exdRow({label:L('Nguồn tiền','Money source'), ro:true, val:'<b>'+esc(t.inst)+'</b>'});
  rows+=_exdRow({label:L('Sổ','Book'), ro:true, val:'<b>🏡 '+esc((window.FAM&&FAM.familyName)||L('Gia đình','Family'))+'</b>'});
  html+='<div class="exd-meta srows"><div class="csv-srows">'+rows+'</div></div>';
  var ph=t.photos||(t.photo?[t.photo]:[]);
  html+=_exdSecH(L('Ảnh','Photos'), ph.length||L('Thêm','Add'))
    +'<div class="exd-photos">'+ph.map(function(src){ return '<div class="exd-photo" style="background-image:url('+src+')"></div>'; }).join('')
    +(canEdit?'<button type="button" class="exd-photo add" onclick="expDetailEdit()" aria-label="'+escAttr(L('Thêm ảnh','Add a photo'))+'">＋</button>':'')
    +'</div>';
  // A future expense is a proposal: show the family's REVIEW state (distinct from the
  // ledger reactions a realized expense carries). incoming = someone else's proposal →
  // Review is the only action; mine/planned → edit + delete like a realized row.
  if(isFuture){
    if(item && item.creatorId && typeof _gldReviewBlock==='function'){
      html+='<div class="exd-sec-h"><span class="t">'+L('Cả nhà cùng duyệt','Review')+'</span></div>'
        +'<div style="margin:0 16px">'+_gldReviewBlock(item)+'</div>';
    }
  } else {
    html+=_exdReactions(t);
  }
  body.innerHTML=html;
  var cta=document.getElementById('exd-cta');
  if(cta){
    cta.innerHTML=incoming
      ? '<button class="cta" onclick="expDetailReview()">'+L('Duyệt','Review')+'</button>'   // decide someone else's proposal
      // trash (arm-then-confirm, the review card's small square) + staged Cập nhật —
      // quiet until something is pending, then it fills and commits everything at once
      : '<button type="button" class="exd-cta-del" id="exd-del" onclick="expDetailDelete()" aria-label="'+escAttr(L('Xoá khoản chi','Delete expense'))+'">'+_exdTrash()+'</button>'
       +'<button type="button" class="exd-go'+(_exdDirty()?'':' quiet')+'" onclick="exdSave()">'+L('Cập nhật','Update')+'</button>';
  }
  _resetExdDel();
}
function _exdTrash(){ return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M10 11v6M14 11v6"/></svg>'; }
/* Review → the existing react-to-align picker (64-requests.js), opened over the detail. */
function expDetailReview(){ if(_expDetailId!=null && typeof openReview==='function') openReview('expense', _expDetailId); }
window.expDetailReview=expDetailReview;
window.renderExpenseDetail=renderExpenseDetail;
function openExpenseDetail(id){
  var t=(typeof txById==='function')?txById(id):null; if(!t) return;
  _expDetailId=id;
  EXD={};                                   // fresh open, no pending edits
  renderExpenseDetail();
  document.getElementById('exp-overlay').classList.add('on');
  var sc=document.querySelector('#exp-overlay .cd-scroll'); if(sc) sc.scrollTop=0;
}
window.openExpenseDetail=openExpenseDetail;
function closeExpenseDetail(){
  _resetExdDel();
  var o=document.getElementById('exp-overlay'); if(o) o.classList.remove('on');
  _expDetailId=null; EXD={};
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
  var b=document.getElementById('exd-del'); if(b){ b.classList.remove('armed'); b.innerHTML=_exdTrash(); }
}
function expDetailDelete(){
  var b=document.getElementById('exd-del');
  if(!_exdDelArmed){
    _exdDelArmed=true; if(b){ b.classList.add('armed'); b.textContent=L('Xoá?','Delete?'); }
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
   nothing is written until Cập nhật. ═══ */
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
  setTxt('exdcat-sub', L('Thay đổi chờ tới khi bấm Cập nhật','Waits for Update to save'));
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
  setTxt('exdwho-sub', L('Thay đổi chờ tới khi bấm Cập nhật','Waits for Update to save'));
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
  setTxt('exdamt-sub', L('Gõ thì cần Xong · thay đổi chờ Cập nhật','Type, then Done · saves with Update'));
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
function exdSheetWhen(mode){
  _exdMode=mode; var t=_exdRowOf(); if(!t) return;
  var dIso=_exdCur('dateIso', (_exdMode==='fam')?((typeof txDateInput==='function')?txDateInput(t):'') : (t.date||''));
  var tm=_exdCur('timeStr', t.time||'');
  setTxt('exdwhen-h', L('Khi nào','When'));
  setTxt('exdwhen-sub', L('Giờ để trống là chỉ tính theo ngày','Leave the time empty for day-only'));
  setHTML('exdwhen-body',
    '<span class="crs-lbl">'+L('Ngày','Date')+'</span>'
    +'<input class="crs-in num" type="date" id="exd-in-date" value="'+escAttr(dIso)+'">'
    +'<span class="crs-lbl" style="margin-top:14px">'+L('Giờ','Time')+' <span style="text-transform:none;font-weight:600">· '+L('tuỳ chọn','optional')+'</span></span>'
    +'<input class="crs-in num" type="time" id="exd-in-time" value="'+escAttr(tm)+'">'
    +'<button type="button" class="crs-done" onclick="exdWhenDone()">'+L('Xong','Done')+'</button>');
  openSheet('sheet-exd-when');
}
function exdWhenDone(){
  var d=(document.getElementById('exd-in-date')||{}).value||'';
  var tm=(document.getElementById('exd-in-time')||{}).value||'';
  if(!d){ var el=document.getElementById('exd-in-date'); if(el) el.focus(); return; }
  closeSheet();
  var P=(_exdMode==='fam')?EXD:PXD;
  P.dateIso=d; P.timeStr=tm;
  if(_exdMode==='fam') renderExpenseDetail(); else renderPersonalTxDetail();
}
/* Cập nhật (family): apply the staged set through the composer's own persisting
   path — fill the editor fields invisibly, overlay the pendings, then call the
   WRAPPED saveExpenseEdit(), which does the aggregates, the enc-correct write
   and the re-render. One write, all fields, same code path as a manual edit. */
function exdSave(){
  if(!_exdDirty()) return;
  var t=(typeof txById==='function')?txById(_expDetailId):null; if(!t) return;
  var p=EXD; EXD={};
  editingTx=_expDetailId;
  if(typeof buildExCatChips==='function') buildExCatChips();   // chips must exist before chosen('ex-cat') reads them
  if(typeof fillExpenseFromTx==='function') fillExpenseFromTx();
  if(p.note!=null) document.getElementById('ex-note').value=p.note;
  if(p.amtDisp!=null) document.getElementById('ex-amt').value=p.amtDisp;
  if(p.cat!=null && typeof selectChipByVal==='function') selectChipByVal('ex-cat', p.cat);
  if(p.who!=null && typeof selectChipByVal==='function') selectChipByVal('ex-who', p.who);
  if(p.dateIso!=null) document.getElementById('ex-date').value=p.dateIso;
  if(p.timeStr!==undefined){ var te=document.getElementById('ex-time'); if(te){ te.value=p.timeStr; if(typeof onExTimeTouched==='function') onExTimeTouched(); } }
  saveExpenseEdit();                                       // wrapped → persists + renderExpenseDetailIfOpen
}
window.exdSave=exdSave;

/* ═══ the PERSONAL expense detail — a private row's own receipt screen ═══
   Entry for list taps (replaces the straight-to-editor door); the composer
   remains reachable through the photo tile for photo work. Staged commit:
   Cập nhật fires ONE fhPersonalUpdateExpense with the merged row. */
var _pexdId=null, PXD={}, _pexdDelArmed=false, _pexdDelT=null;
function _pxdDirty(){ return Object.keys(PXD).length>0; }
function openPersonalTxDetail(id){
  var t=(typeof _pTxById==='function')?_pTxById(id):null;
  if(!t || t._unreadable || t.spaceId || t.linkId) return;         // private, readable rows only
  if(t.kind && t.kind!=='expense'){ if(typeof openPersonalTxEdit==='function') openPersonalTxEdit(id); return; }   // kinds keep their own sheets
  _pexdId=id; PXD={};
  renderPersonalTxDetail();
  document.getElementById('pexd-overlay').classList.add('on');
  var sc=document.querySelector('#pexd-overlay .cd-scroll'); if(sc) sc.scrollTop=0;
}
window.openPersonalTxDetail=openPersonalTxDetail;
function closePersonalTxDetail(){
  _pxdResetDel();
  var o=document.getElementById('pexd-overlay'); if(o) o.classList.remove('on');
  _pexdId=null; PXD={};
}
window.closePersonalTxDetail=closePersonalTxDetail;
function _pexdDateLong(iso){
  if(!iso) return '';
  var d=new Date(iso+'T00:00:00');
  return (typeof fmtDateLong==='function')?fmtDateLong(d):iso;
}
function renderPersonalTxDetail(){
  var t=(typeof _pTxById==='function')?_pTxById(_pexdId):null;
  if(!t){ closePersonalTxDetail(); return; }
  var body=document.getElementById('pexd-body'); if(!body) return;
  var vCat=PXD.cat!=null?PXD.cat:(t.cat||'');
  var vAmtDisp=PXD.amtDisp!=null?PXD.amtDisp:((typeof amtToInput==='function')?amtToInput(t.amt):String(t.amt||''));
  var vNote=PXD.note!=null?PXD.note:(t.note||'');
  var vTime=PXD.timeStr!==undefined?PXD.timeStr:(t.time||'');
  var vDate=PXD.dateIso!=null?PXD.dateIso:(t.date||'');
  var em=PXD.cat!=null?((catStyle[vCat]||['🏷️'])[0]):(t.emoji||'🗂️');
  var pd=window.fhPersonalData?fhPersonalData():null;
  var acctId=PXD.hasOwnProperty('accountId')?PXD.accountId:(t.accountId||null);
  var acct=acctId&&pd?((pd.accounts||[]).find(function(a){ return a.id===acctId; })||null):null;
  var html='<div class="exd-focal">'
    +'<div class="exd-ico" style="background:var(--fill-neutral)">'+esc(em)+'</div>'
    +'<div class="exd-amt num">'+esc(vAmtDisp)+(CUR==='VND'?' ₫':'')+'</div>'
    +'<div class="exd-note">'+esc(vNote||vCat||'Khoản chi')+'</div>'
    +'<div class="exd-prov">'+esc(_pexdDateLong(vDate))+(vTime?'<span class="sep">·</span>'+esc(vTime):'')+'</div>'
    +'</div>';
  var rows='';
  // Ghi vào — the cross-ledger door: never a silent re-scope, the confirm sheet
  // names every consequence (M4) before the one tap that commits.
  rows+=_exdRow({label:'Ghi vào', val:'<b>🔒 Cá nhân</b>', fn:'pexdMove()'});
  rows+=_exdRow({label:'Danh mục', chg:PXD.cat!=null,
    val:'<b>'+esc(em)+' '+esc(vCat||'Chưa rõ')+'</b>', soft:!vCat, fn:"exdSheetCat('pers')"});
  rows+=_exdRow({label:'Số tiền & ghi chú', chg:(PXD.amtDisp!=null||PXD.note!=null),
    val:'<b class="num">'+esc(vAmtDisp)+(CUR==='VND'?' ₫':'')+'</b>', fn:"exdSheetAmt('pers')"});
  rows+=_exdRow({label:'Khi nào', chg:(PXD.dateIso!=null||PXD.timeStr!==undefined),
    val:'<b class="num">'+esc(vDate?vDate.slice(8,10)+'/'+vDate.slice(5,7):'')+(vTime?' · '+esc(vTime):'')+'</b>', fn:"exdSheetWhen('pers')"});
  rows+=_exdRow({label:'Nguồn tiền', chg:PXD.hasOwnProperty('accountId'), soft:!acctId,
    val:'<b>'+(acct?esc(acct.name||'Tài khoản'):(acctId?'Tài khoản':'Chưa rõ'))+'</b>', fn:'pexdSheetAcct()'});
  html+='<div class="exd-meta srows"><div class="csv-srows">'+rows+'</div></div>';
  var ph=t.photos||[];
  html+=_exdSecH('Ảnh', ph.length||'Thêm')
    +'<div class="exd-photos">'+ph.map(function(src){ return '<div class="exd-photo" style="background-image:url('+src+')"></div>'; }).join('')
    +'<button type="button" class="exd-photo add" onclick="pexdPhotoDoor()" aria-label="Thêm ảnh">＋</button></div>';
  body.innerHTML=html;
  var cta=document.getElementById('pexd-cta');
  if(cta){
    cta.innerHTML='<button type="button" class="exd-cta-del" id="pexd-del" onclick="pexdDelete()" aria-label="Xoá khoản này">'+_exdTrash()+'</button>'
      +'<button type="button" class="exd-go'+(_pxdDirty()?'':' quiet')+'" id="pexd-go" onclick="pexdSave()">Cập nhật</button>';
  }
  _pxdResetDel();
}
window.renderPersonalTxDetail=renderPersonalTxDetail;
function pexdSheetAcct(){
  var t=(typeof _pTxById==='function')?_pTxById(_pexdId):null; if(!t) return;
  var pd=window.fhPersonalData?fhPersonalData():null;
  var cur=PXD.hasOwnProperty('accountId')?PXD.accountId:(t.accountId||null);
  setTxt('exdacct-h', 'Nguồn tiền');
  setTxt('exdacct-sub', 'Gắn để số dư tài khoản tính được · thay đổi chờ Cập nhật');
  var ico={deposit:'🏦',ewallet:'📱',credit_card:'💳',cash:'💵'};
  var h='<button type="button" class="choice'+(cur?'':' on')+'" onclick="pexdPickAcct(&#39;&#39;)">Chưa gắn</button>';
  ((pd&&pd.accounts)||[]).forEach(function(a){
    h+='<button type="button" class="choice'+(a.id===cur?' on':'')+'" onclick="pexdPickAcct(&#39;'+escAttr(a.id)+'&#39;)">'+(ico[a.kind]||'🏦')+' '+esc(a.name||'Tài khoản')+'</button>';
  });
  setHTML('exdacct-list', h);
  openSheet('sheet-exd-acct');
}
function pexdPickAcct(id){ closeSheet(); PXD.accountId=id||null; renderPersonalTxDetail(); }
/* Ghi vào → the existing move confirm (59-ledger-move-ui): same sheet, same
   consequences, same engine — only the entrance moved from the chip flip. */
function pexdMove(){
  if(_pexdId==null) return;
  if(navigator.onLine===false){ toast('Cần mạng để chuyển sổ'); return; }
  if(!(window.DB&&DB.fid)){ toast('Vào một nhóm gia đình trước đã'); return; }
  _mvCtx={dir:'p2f', pid:_pexdId, cur:'personal'};
  fhMoveSheetOpen();
}
function pexdPhotoDoor(){   // photos keep riding the composer (EXIF/encrypt pipeline lives there)
  if(_pexdId==null) return;
  var id=_pexdId;
  if(typeof openPersonalTxEdit==='function') openPersonalTxEdit(id);
}
async function pexdSave(){
  if(!_pxdDirty()) return;
  var t=(typeof _pTxById==='function')?_pTxById(_pexdId):null; if(!t) return;
  var p=PXD;
  var amtBase=p.amtDisp!=null?parseAmtBase(p.amtDisp):t.amt;
  if(!(amtBase>0)){ toast('Nhập số tiền trước đã'); return; }
  var go=document.getElementById('pexd-go');
  if(go){ if(go.disabled) return; go.disabled=true; go.textContent='Đang lưu…'; }
  var fields={ amt:amtBase,
    note:(p.note!=null?p.note:(t.note||'')),
    cat:(p.cat!=null?p.cat:(t.cat||'')),
    emoji:(p.cat!=null?((catStyle[p.cat]||['🏷️'])[0]):(t.emoji||null)),
    time:(p.timeStr!==undefined?p.timeStr:(t.time||'')),
    dateIso:(p.dateIso!=null?p.dateIso:t.date) };
  if(p.hasOwnProperty('accountId')) fields.accountId=p.accountId;
  var ok=false;
  try{ ok=await window.fhPersonalUpdateExpense(_pexdId, fields); }catch(e){}
  if(go){ go.disabled=false; go.textContent='Cập nhật'; }
  if(!ok){ toast('Chưa lưu được, thử lại nhé'); return; }
  PXD={};
  if(typeof renderPersonal==='function'){ try{ renderPersonal(); }catch(e){} }
  if(typeof refreshPersonalTxnOverlay==='function') refreshPersonalTxnOverlay();
  renderPersonalTxDetail();
  toast('Đã cập nhật');
}
window.pexdSave=pexdSave;
function _pxdResetDel(){
  _pexdDelArmed=false; clearTimeout(_pexdDelT);
  var b=document.getElementById('pexd-del'); if(b){ b.classList.remove('armed'); b.innerHTML=_exdTrash(); }
}
async function pexdDelete(){
  var b=document.getElementById('pexd-del');
  if(!_pexdDelArmed){
    _pexdDelArmed=true; if(b){ b.classList.add('armed'); b.textContent='Xoá?'; }
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
