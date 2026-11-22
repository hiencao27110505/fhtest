/* ── Spaces: "Tính thế nào?" — one control, three homes ───────────────────────
   Chung or Chia, who paid, who in the space shares, into how many shares, or
   exact amounts (spaces-spec 5.1, 7.4). The same control sits inline on the
   expense sheet, in the picker sheet of a review card, and on the edit sheet of
   a saved expense, so the three can never count a bill differently. The
   arithmetic is fhSplitCompute (15-spaces-core.js).

   State lives in FH_SPLIT while a host is open. Hosts call fhSplitStart(o),
   put fhSplitHTML() inside an element with id "spx", and read fhSplitResult(). */
var FH_SPLIT = null;
/* o: { fid, amt (base units, may be 0 while typing), mode, payer, lockPayer,
        members:[ids ticked], parts, exact:{id:amt}|null, outName, onChange } */
function fhSplitStart(o){
  var mem = (window.fhSpaceMembers ? fhSpaceMembers(o.fid) : []);
  var my = window.fhSpaceMyMemberId ? fhSpaceMyMemberId(o.fid) : null;
  var ticked = {};
  (o.members && o.members.length ? o.members : mem.map(function(m){ return m.id; })).forEach(function(id){ ticked[id] = true; });
  var n = Object.keys(ticked).length;
  FH_SPLIT = { fid:o.fid, amt:Number(o.amt)||0, mode:o.mode || (fhSpaceProfileOf('friend',null).mode), payer:o.payer || my, lockPayer:!!o.lockPayer,
    ticked:ticked, parts:Math.max(n, Number(o.parts)||n), exact:o.exact || null, outName:o.outName || '', custom:false, onChange:o.onChange || null };
  return FH_SPLIT;
}
function fhSplitEnd(){ FH_SPLIT = null; }
function _spxMembers(){ return (FH_SPLIT && window.fhSpaceMembers) ? fhSpaceMembers(FH_SPLIT.fid) : []; }
function _spxTicked(){ var s = FH_SPLIT; return _spxMembers().filter(function(m){ return s.ticked[m.id]; }).map(function(m){ return m.id; }); }
/* The computed split for the amount now in the host, or { ok:false, err }. */
function fhSplitResult(){
  var s = FH_SPLIT; if(!s) return null;
  if(s.mode !== 'chia') return { mode:'chung', payer:s.payer };
  var ids = _spxTicked();
  var r = fhSplitCompute(s.exact ? { amt:s.amt, members:ids, exact:s.exact } : { amt:s.amt, members:ids, parts:s.parts });
  if(!r.ok) return { mode:'chia', payer:s.payer, ok:false, err:r.err, sum:r.sum };
  return { mode:'chia', payer:s.payer, ok:true, r:r, rule:s.exact ? 'exact' : 'equal', payload:fhSplitPayload(r, s.amt), outName:(r.out > 0 ? (s.outName || '') : '') };
}
function _spxChip(label, on, act, cls){
  return (on ? '<button type="button" class="choice on'+(cls||'')+'" onclick="'+act+'">' : '<button type="button" class="choice'+(cls||'')+'" onclick="'+act+'">')+label+'</button>';
}
function _spxHint(){
  var s = FH_SPLIT, res = fhSplitResult();
  if(!res || res.mode !== 'chia') return '';
  if(!(s.amt > 0)) return L('Nhập số tiền để xem mỗi phần.','Enter the amount to see each share.');
  if(!res.ok){
    if(res.err === 'members') return '<span class="warn">'+L('Chọn ít nhất một người trong nhóm.','Pick at least one member.')+'</span>';
    if(res.err === 'over') return '<span class="warn">'+L('Các phần đang nhiều hơn hoá đơn ','The shares add up to more than the bill by ')+fmt(fhK3(res.sum - s.amt))+'.</span>';
    return '';
  }
  var r = res.r, n = fhSplitMembers(r.map).length;
  if(s.exact) return r.out > 0 ? L('Còn ','Left over: ')+fmt(r.out)+L(' là phần ngoài nhóm.',', counted as outside the space.') : L('Các phần cộng đúng bằng hoá đơn.','The shares add up to the bill.');
  if(r.out > 0) return r.parts+L(' phần, mỗi phần ',' shares, ')+fmt(r.per)+L('. ',' each. ')+n+L(' phần trong nhóm, ',' in the space, ')+(r.parts - n)+L(' phần ngoài nhóm.',' outside.');
  return L('Chia đều, mỗi người ','Split equally, ')+fmt(r.per)+L('.',' each.');
}
function fhSplitHTML(){
  var s = FH_SPLIT; if(!s) return '';
  var mem = _spxMembers(), ids = _spxTicked(), n = ids.length, h = '';
  if(!mem.length) return '<div class="field-hint">'+L('Đang tải thành viên của nhóm…','Loading the members…')+'</div>';
  h += '<div class="field"><label>'+L('Tính thế nào?','How is it counted?')+'</label><div class="choices">'
    + _spxChip(L('Chung','Shared'), s.mode !== 'chia', "fhSplitAct('mode','chung')") + _spxChip(L('Chia','Split'), s.mode === 'chia', "fhSplitAct('mode','chia')") + '</div>'
    + '<div class="field-hint">'+L('Chia: một người ứng trước, mỗi người nợ phần của mình. Chung: không ai nợ ai.','Split: one person fronts it and each owes their share. Shared: nobody owes anybody.')+'</div></div>';
  if(s.mode !== 'chia') return h;
  if(!s.lockPayer){
    h += '<div class="field"><label>'+L('Ai trả?','Who paid?')+'</label><div class="choices">'
      + mem.map(function(m){ return _spxChip(esc(m.name), s.payer === m.id, "fhSplitAct('payer','"+m.id+"')"); }).join('') + '</div></div>';
  }
  h += '<div class="field"><label>'+L('Ai trong nhóm?','Who in the space?')+'</label><div class="choices">'
    + mem.map(function(m){ return _spxChip(esc(m.name), !!s.ticked[m.id], "fhSplitAct('tick','"+m.id+"')"); }).join('') + '</div></div>';
  if(s.exact){
    h += '<div class="field"><label>'+L('Từng phần','Each share')+'</label>'
      + mem.filter(function(m){ return s.ticked[m.id]; }).map(function(m){
          var v = s.exact[m.id];
          return '<div class="field-row dbt-exrow"><span class="dbt-exn">'+esc(m.name)+'</span><input class="num" inputmode="numeric" data-mid="'+m.id+'" placeholder="0 ₫" value="'+((v > 0 && typeof amtToInput === 'function') ? escAttr(amtToInput(v)) : '')+'" onblur="if(typeof snapAmtInput===\'function\')snapAmtInput(this)" oninput="fhSplitAct(\'exact-in\',this)"></div>';
        }).join('')
      + '<div class="field-hint" id="spx-hint">'+_spxHint()+'</div>'
      + '<div class="field-hint"><a onclick="fhSplitAct(\'exact\',\'0\')">'+L('Chia đều','Split equally instead')+'</a></div></div>';
  } else {
    /* number chips start at the count of ticked members: that many shares
       means nobody outside. Anything above it is an outside share (S32). */
    var nums = [n, n+1, n+2, n+3], isPre = nums.indexOf(s.parts) >= 0 && !s.custom;
    h += '<div class="field"><label>'+L('Chia mấy phần?','How many shares?')+'</label><div class="choices">'
      + nums.map(function(k){ return _spxChip(String(k), isPre && s.parts === k, "fhSplitAct('parts','"+k+"')", ' sp-num'); }).join('')
      + _spxChip(L('Số khác','Other'), !isPre, "fhSplitAct('parts','x')") + '</div>'
      + (!isPre ? '<input class="num" id="spx-parts-in" inputmode="numeric" placeholder="'+L('Số phần','Number of shares')+'" value="'+(s.parts > n+3 || s.custom ? s.parts : '')+'" oninput="fhSplitAct(\'parts-in\',this)">' : '')
      + '<div class="field-hint" id="spx-hint">'+_spxHint()+'</div>'
      + (s.parts > n
          ? '<div class="field-hint">'+L('Phần ngoài nhóm không vào nhóm. Nó nằm trong sổ của người trả là khoản cần thu.','An outside share stays out of the space. It sits in the payer’s own book as money to collect.')+'</div>'
            + '<input id="spx-outname" placeholder="'+L('Tên người đó · tuỳ chọn','Their name · optional')+'" maxlength="40" value="'+escAttr(s.outName||'')+'" oninput="fhSplitAct(\'outname\',this)">'
          : '')
      + '<div class="field-hint"><a onclick="fhSplitAct(\'exact\',\'1\')">'+L('Tự nhập từng phần','Enter amounts')+'</a></div></div>';
  }
  return h;
}
function fhSplitPaint(){
  var box = document.getElementById('spx'); if(box && FH_SPLIT) box.innerHTML = fhSplitHTML();
}
function _spxHintPaint(){ var el = document.getElementById('spx-hint'); if(el) el.innerHTML = _spxHint(); }
/* The host's amount changed (typing on the expense sheet). */
function fhSplitSetAmt(amt){ if(!FH_SPLIT) return; FH_SPLIT.amt = Number(amt) || 0; _spxHintPaint(); }
function fhSplitAct(a, v){
  var s = FH_SPLIT; if(!s) return;
  var full = true;
  if(a === 'mode'){ s.mode = (v === 'chia') ? 'chia' : 'chung'; }
  else if(a === 'payer'){ if(!s.lockPayer) s.payer = v; }
  else if(a === 'tick'){
    var before = _spxTicked().length, outside = Math.max(0, s.parts - before);
    if(s.ticked[v]) delete s.ticked[v]; else s.ticked[v] = true;
    var now = _spxTicked().length;
    s.parts = Math.max(now, now + outside);              // the outside shares stay as they were
    if(s.exact && !s.ticked[v]) delete s.exact[v];
  }
  else if(a === 'parts'){
    if(v === 'x'){ s.custom = true; }
    else { s.custom = false; s.parts = Math.max(_spxTicked().length, parseInt(v, 10) || 0); }
  }
  else if(a === 'parts-in'){ var k = parseInt(String(v.value||'').replace(/\D/g,''), 10); s.parts = Math.max(_spxTicked().length, Math.min(99, k || 0)); s.custom = true; full = false; }
  else if(a === 'outname'){ s.outName = String(v.value||'').slice(0, 40); full = false; if(s.onChange) s.onChange(); return; }
  else if(a === 'exact'){ s.exact = (v === '1') ? {} : null; if(!s.exact) s.custom = false; }
  else if(a === 'exact-in'){ var id = v.getAttribute('data-mid'); s.exact[id] = (typeof parseAmtBase === 'function') ? parseAmtBase(v.value||'') : Number(v.value)||0; full = false; }
  if(full) fhSplitPaint(); else _spxHintPaint();
  if(s.onChange) s.onChange();
}

/* ── home 1: the expense sheet ────────────────────────────────────────────── */
/* Shown for a NEW expense filed to the open space when that space has Chia
   tiền. The field that used to ask "Ai trả" stays for a Chung expense and
   steps aside for a Chia one, whose payer is chosen here. */
function fhExSplitActive(){
  if(typeof editingTx !== 'undefined' && (editingTx || editingPTx)) return false;
  if(typeof exType !== 'undefined' && exType === 'income') return false;
  if(typeof chosen !== 'function' || chosen('ex-scope') !== 'family') return false;
  return typeof fhSpaceHas === 'function' && fhSpaceHas('split') && !fhSpaceClosed();
}
function fhExSplitSync(){
  var box = document.getElementById('ex-splitfield'); if(!box) return;
  if(!fhExSplitActive()){ if(box.innerHTML){ box.innerHTML = ''; } fhSplitEnd(); return; }
  var fid = fhSpaceActiveId();
  if(!FH_SPLIT || FH_SPLIT.fid !== fid || FH_SPLIT._host !== 'ex'){
    fhSplitStart({ fid:fid, mode:window.fhSpaceProfile().mode, amt:_exSplitAmt(), onChange:_exSplitLayout });
    FH_SPLIT._host = 'ex';
    /* outside a family there is no shared seat: the recorder is the default payer (S20) */
    if(!fhSpaceIsFamily() && typeof selectChipByVal === 'function'){ var _me = fhSpaceMemberName(fhSpaceMyMemberId(fid)); if(_me) selectChipByVal('ex-who', _me); }
    /* members are read on the light path; if they are not here yet, ask and repaint */
    if(!fhSpaceMembers(fid).length && window.fhSpaceHydrate && fhSpacesData().keys[fid]){
      fhSpaceHydrate(fid).then(function(){ if(FH_SPLIT && FH_SPLIT._host === 'ex'){ var keep = FH_SPLIT.mode; fhSplitStart({ fid:fid, mode:keep, amt:_exSplitAmt(), onChange:_exSplitLayout }); FH_SPLIT._host = 'ex'; fhExSplitSync(); } });
    }
  }
  box.innerHTML = '<div id="spx">'+fhSplitHTML()+'</div>';
  _exSplitLayout();
}
function _exSplitAmt(){ var el = document.getElementById('ex-amt'); return (el && typeof parseAmtBase === 'function') ? parseAmtBase(el.value || '') : 0; }
function _exSplitLayout(){
  var chia = !!(FH_SPLIT && FH_SPLIT._host === 'ex' && FH_SPLIT.mode === 'chia');
  var who = document.getElementById('ex-whofield'); if(who && fhExSplitActive()) who.style.display = chia ? 'none' : '';
  var bulk = document.getElementById('bulk-add'); if(bulk && chia) bulk.style.display = 'none';   // one bill, one split
}
function fhExSplitOnAmt(){ if(FH_SPLIT && FH_SPLIT._host === 'ex') fhSplitSetAmt(_exSplitAmt()); }
/* Called by submitExpense just before the family write. Returns false to stop
   the save (the split does not add up, or there is no network to seal it). */
function fhExSplitBeforeSave(){
  window._exSplitPending = null;
  if(!FH_SPLIT || FH_SPLIT._host !== 'ex' || !fhExSplitActive()) return true;
  if(FH_SPLIT.mode !== 'chia') return true;
  if(typeof bulkRows !== 'undefined' && bulkRows.length > 1){ toast(L('Chia tiền ghi từng khoản một. Bỏ bớt dòng hoặc chọn Chung.','A split is logged one expense at a time. Remove the extra rows or choose Shared.')); return false; }
  if(navigator.onLine === false){ toast(L('Chia tiền cần có mạng. Thử lại khi có mạng, hoặc ghi là Chung.','A split needs a connection. Try again online, or log it as Shared.')); return false; }
  FH_SPLIT.amt = _exSplitAmt();
  var res = fhSplitResult();
  if(!res.ok){
    toast(res.err === 'amount' ? L('Nhập số tiền nhé','Enter the amount') : res.err === 'members' ? L('Chọn ít nhất một người trong nhóm','Pick at least one member') : L('Các phần đang nhiều hơn hoá đơn','The shares add up to more than the bill'));
    return false;
  }
  var payerName = fhSpaceMemberName(res.payer);
  if(!payerName){ toast(L('Chọn người trả nhé','Pick who paid')); return false; }
  if(typeof selectChipByVal === 'function') selectChipByVal('ex-who', payerName);   // the family write reads the payer from this chip
  var amtEl = document.getElementById('ex-amt');
  if(res.r.out > 0 && amtEl && typeof amtToInput === 'function'){
    amtEl.value = amtToInput(res.r.inside);              // the space records the members' part (S32)
    if(typeof bulkRows !== 'undefined' && bulkRows.length === 1) bulkRows[0].amt = amtEl.value;
  }
  window._exSplitPending = { payerId:res.payer, rule:res.rule, payload:res.payload, outName:res.outName || null, out:res.r.out, bill:FH_SPLIT.amt };
  return true;
}