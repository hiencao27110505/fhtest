/* ── Spaces: a captured row filed into a space (spaces-spec section 7) ────────
   The review queue's "Ghi vào đâu?" used to know two books: Cá nhân and the
   family. It now lists every space the person belongs to. A row filed to a
   space with Chia tiền also says how the bill is counted.

   The queue's own code (56-csv-import-ui.js) keeps its two scopes: 'personal',
   and 'family' meaning "a shared space". WHICH space is c._spaceId (unset = the
   open one), and how it is split is c._split. Everything here is a helper the
   queue calls; none of it writes. */

/* The space a non-personal row goes to. */
function csvSpaceOf(c){ return (c && c._spaceId) || (window.DB && DB.fid) || null; }
function csvSpaceObj(c){ return window.fhSpaceGet ? fhSpaceGet(csvSpaceOf(c)) : null; }
function csvSpaceLabel(c){
  var sp = csvSpaceObj(c);
  if(!sp) return L('🏡 Gia đình','🏡 Family');
  return fhSpaceMark(sp) + ' ' + fhSpaceName(sp);
}
/* The same, for a scope value with no row behind it (the batch header). */
function csvSpaceLabelOpen(){
  var sp = window.fhSpaceActive ? fhSpaceActive() : null;
  return sp ? (fhSpaceMark(sp) + ' ' + fhSpaceName(sp)) : L('🏡 Gia đình','🏡 Family');
}
function csvSpaceIsOpen(c){ return csvSpaceOf(c) === ((window.DB && DB.fid) || null); }
function csvSpaceSplitOn(c){
  if(!c || c.isIncome || !window.fhSpaceProfile) return false;
  var fid = csvSpaceOf(c); if(!fid) return false;
  return !!fhSpaceProfile(fid).split;
}
/* Can a row be filed into this space from here? The open one always; another
   one only when this device holds its key and has read it (members, categories). */
function csvSpaceReady(fid){
  if(fid === ((window.DB && DB.fid) || null)) return true;
  var S = window.fhSpacesData && fhSpacesData();
  return !!(S && S.keys[fid] && S.data[fid]);
}
/* The row's split, created from the space's default the first time it is asked for. */
function csvSpaceSplit(c){
  var fid = csvSpaceOf(c);
  if(c._split && c._split.fid === fid) return c._split;
  var p = fhSpaceProfile(fid), mem = fhSpaceMembers(fid).map(function(m){ return m.id; });
  c._split = { fid:fid, mode:p.mode, members:mem, parts:mem.length, exact:null, outName:'' };
  return c._split;
}
function csvSpaceAmtK(c){ return (typeof csvBaseAmt === 'function') ? csvBaseAmt(c.amount) : Number(c.amount||0) / ((typeof curMult === 'function' && curMult()) || 1); }
/* The computed split of a row: { mode:'chung' } or { mode:'chia', ok, r, rule, payload, outName, payer }. */
function csvSpaceSplitResult(c){
  if(!csvSpaceSplitOn(c)) return { mode:'chung' };
  var s = csvSpaceSplit(c), fid = s.fid, my = fhSpaceMyMemberId(fid);
  if(s.mode !== 'chia') return { mode:'chung', payer:my };
  var live = fhSpaceMembers(fid).map(function(m){ return m.id; });
  var ids = (s.members && s.members.length ? s.members : live).filter(function(id){ return live.indexOf(id) >= 0; });
  if(!ids.length) ids = live;
  var amt = csvSpaceAmtK(c);
  var r = fhSplitCompute(s.exact ? { amt:amt, members:ids, exact:s.exact } : { amt:amt, members:ids, parts:Math.max(ids.length, s.parts || ids.length) });
  if(!r.ok) return { mode:'chia', ok:false, err:r.err, payer:my };
  return { mode:'chia', ok:true, r:r, rule:s.exact ? 'exact' : 'equal', payload:fhSplitPayload(r, amt), outName:(r.out > 0 ? (s.outName || '') : ''), payer:my, bill:amt };
}
/* What the family write path needs to seal the split after the row is in
   (window._exSplitPending), or null for a Chung row. */
function csvSpaceSplitPending(c){
  var res = csvSpaceSplitResult(c);
  if(res.mode !== 'chia' || !res.ok) return null;
  return { payerId:res.payer, rule:res.rule, payload:res.payload, outName:res.outName || null, out:res.r.out, bill:res.bill, inside:res.r.inside };
}
/* The two rows a space with Chia tiền adds to a card (spec 7.1 step 3). `row`
   is the card's own row builder. */
function csvSpaceRowsHTML(row, c){
  var fid = csvSpaceOf(c), my = fhSpaceMyMemberId(fid), res = csvSpaceSplitResult(c), s = csvSpaceSplit(c);
  var me = (fhSpaceMembers(fid).filter(function(m){ return m.id === my; })[0] || {}).name || L('Bạn','You');
  var h = row('payer', L('Ai trả','Who paid'), esc(me)+' · '+L('bạn','you'), { ro:true, by:'<span class="rcr-by">'+esc(L('Tiền đi từ tài khoản của bạn','It left your own account'))+'</span>' });
  var val, by = '';
  if(res.mode !== 'chia'){ val = L('Chung','Shared'); by = L('Không ai nợ ai','Nobody owes anybody'); }
  else if(!res.ok){ val = L('Chia','Split'); by = res.err === 'over' ? L('Các phần nhiều hơn hoá đơn','Shares exceed the bill') : L('Chọn người chia','Pick who shares'); }
  else {
    var n = fhSplitMembers(res.r.map).length;
    val = s.exact ? L('Chia · tự nhập','Split · typed amounts') : (res.r.out > 0 ? L('Chia ','Split ')+res.r.parts+L(' phần',' ways') : L('Chia đều · ','Split equally · ')+n+L(' người',' people'));
    by = res.r.out > 0 ? (n+L(' trong nhóm · ',' in the space · ')+(s.exact ? fmt(res.r.out) : (res.r.parts - n))+L(' ngoài nhóm',' outside'))
                       : (L('Phần của bạn ','Your share ')+fmt(Number(res.r.map[my]) || 0));
  }
  h += row('split', L('Tính thế nào','How it counts'), esc(val), { by:'<span class="rcr-by">'+esc(by)+'</span>', miss:(res.mode === 'chia' && !res.ok) });
  return h;
}
/* The line above the button: what the others will see. */
function csvSpaceNoteHTML(c){
  var sp = csvSpaceObj(c); if(!sp) return '';
  var res = csvSpaceSplitResult(c), p = fhSpaceProfile(sp.id), txt;
  if(res.mode === 'chia' && res.ok && res.r.out > 0){
    txt = L('Nhóm thấy ','The space sees ')+fmt(res.r.inside)+L(' chia ',' split ')+fhSplitMembers(res.r.map).length+L('. Phần ngoài nhóm, ',' ways. The outside share, ')+fmt(res.r.out)+L(', ghi vào sổ của bạn là khoản cần thu.',', goes into your own book as money to collect.');
  } else if(res.mode === 'chia'){
    txt = L('Cả nhóm thấy khoản này và phần của từng người.','The whole space sees this expense and each share.');
  } else {
    txt = L('Cả nhóm thấy khoản này.','The whole space sees this expense.');
  }
  if(!p.source && typeof csvStagedProvider === 'function' && csvStagedProvider(c)) txt += ' ' + L('Ngân hàng và số thẻ chỉ mình bạn thấy.','Only you see the bank and the card.');
  return '<div class="csv-expand-note sp-capnote">'+esc(txt)+'</div>';
}
function csvSpaceCtaLabel(c){
  if(c && c._spSettle) return L('Ghi trả nợ','Record the settle-up');
  var sp = csvSpaceObj(c);
  return sp ? (L('Ghi vào ','Save to ')+fhSpaceName(sp)) : L('Nhập khoản này','Import this one');
}
/* The chips of "Ghi vào đâu?": Cá nhân, then every space, the open one first. */
function csvSpaceScopeChipsHTML(c, chip, personalLocked){
  var cur = (csvRowScope(c) === 'personal') ? 'personal' : csvSpaceOf(c);
  var S = window.fhSpacesData ? fhSpacesData() : null, all = (S ? S.all.slice() : []);
  var open = (window.DB && DB.fid) || null;
  all.sort(function(a, b){ return (a.id === open ? 0 : 1) - (b.id === open ? 0 : 1); });
  var h = '<div class="choices">' + chip(cur === 'personal', "csvSheetPick('scope','personal')", esc(L('🔒 Cá nhân','🔒 Personal')));
  if(!all.length) h += chip(cur !== 'personal', "csvSheetPick('scope','family')", esc(L('🏡 Gia đình','🏡 Family')));
  all.forEach(function(sp){
    if(sp.closed) return;
    h += chip(cur === sp.id, "csvSheetPick('scope','space:"+sp.id+"')", esc(fhSpaceMark(sp)+' '+fhSpaceName(sp)));
  });
  return h + '</div>';
}
/* Picking a space chip. Returns false when the space cannot take a row from
   here yet (and says why). */
function csvSpacePick(c, fid){
  if(!csvSpaceReady(fid)){
    var S = fhSpacesData();
    if(S.keys[fid] && window.fhSpaceHydrate){ fhSpaceHydrate(fid).then(function(){ if(typeof renderCsvReview === 'function') renderCsvReview(); }); toast(L('Đang đọc nhóm này, bấm lại sau giây lát','Reading that space, tap again in a moment')); }
    else toast(L('Mở nhóm này một lần trên máy này trước đã','Open that space once on this device first'));
    return false;
  }
  c._spaceId = fid;
  if(c._split && c._split.fid !== fid) c._split = null;
  return true;
}

/* ── the split picker inside the card's sheet ─────────────────────────────── */
function csvSpaceSplitSheetStart(c){
  var s = csvSpaceSplit(c);
  fhSplitStart({ fid:s.fid, amt:csvSpaceAmtK(c), mode:s.mode, lockPayer:true, payer:fhSpaceMyMemberId(s.fid), members:s.members, parts:s.parts, exact:s.exact, outName:s.outName,
    onChange:function(){ var f = FH_SPLIT; if(!f) return; s.mode = f.mode; s.members = Object.keys(f.ticked); s.parts = f.parts; s.exact = f.exact; s.outName = f.outName; } });
  FH_SPLIT._host = 'csv';
}
function csvSpaceSplitSheetBody(){
  return '<div id="spx">'+fhSplitHTML()+'</div><button type="button" class="crs-done" onclick="csvRowSheetClose()">'+esc(L('Xong','Done'))+'</button>';
}

/* ── a settle-up that arrives by bank transfer (spec 7.1) ─────────────────── */
/* Money in, from someone who is a member of one of my spaces, for exactly the
   amount the space says they should pay me. Pre-fills the card; never writes. */
function _spNameHit(name, text){
  var norm = function(s){ return (typeof deburr === 'function' ? deburr(String(s||'').toLowerCase()) : String(s||'').toLowerCase()).replace(/[^a-z0-9\s]/g,' ').replace(/\s+/g,' ').trim(); };
  var n = norm(name), t = ' ' + norm(text) + ' ';
  if(n.length < 2) return false;
  if(t.indexOf(' ' + n + ' ') >= 0) return true;                       // the whole name
  var parts = n.split(' ').filter(function(w){ return w.length >= 2; });
  var last = parts[parts.length - 1];                                    // Vietnamese given name comes last
  return !!last && parts.length === 1 && t.indexOf(' ' + last + ' ') >= 0;
}
function csvSpaceSettlePass(candidates){
  var S = window.fhSpacesData ? fhSpacesData() : null;
  if(!S || !S.list.length || !window.csvStagedMode) return;
  var owed = [];                                                          // every "X pays me" the spaces currently propose
  S.list.forEach(function(sp){
    if(sp.closed || !S.data[sp.id]) return;
    var my = fhSpaceMyMemberId(sp.id); if(!my) return;
    fhSpacePairwise(sp.id).forEach(function(p){ if(p.to.id === my) owed.push({ fid:sp.id, from:p.from, amt:p.amt }); });
  });
  if(!owed.length) return;
  (candidates || []).forEach(function(c){
    if(!c || !c.isIncome || c._repay || c._loan || c._xfer || c._invest || c._spSettle || c._spSettleOff) return;
    var amt = csvSpaceAmtK(c), text = (c.counterparty || '') + ' ' + (c.description || '');
    var hits = owed.filter(function(o){ return Math.abs(o.amt - amt) < 0.0005 && _spNameHit(o.from.name, text); });
    if(hits.length !== 1) return;                                         // nothing, or ambiguous: say nothing
    c._spSettle = { fid:hits[0].fid, from:hits[0].from.id, fromName:hits[0].from.name, amt:amt };
    c._spaceId = hits[0].fid; c._scope = 'family';
  });
}
function csvSpaceSettleRowsHTML(row, c){
  var st = c._spSettle;
  return row('spsettle', L('Loại khoản','Kind'), '🤝 '+esc(st.fromName)+' '+esc(L('trả nợ nhóm','settles up')), { by:'<span class="rcr-by">'+esc(L('Khớp số ','Matches what ')+st.fromName+L(' đang nợ bạn',' owes you'))+'</span>' });
}
function csvSpaceSettleNoteHTML(c){
  var st = c._spSettle, sp = csvSpaceObj(c);
  return '<div class="csv-expand-note sp-capnote">'+esc(st.fromName+L(' đang nợ bạn ',' owes you ')+fmt(st.amt)+L(' trong ',' in ')+(sp ? fhSpaceName(sp) : L('nhóm','the space'))+L('. Không phải khoản này thì đổi "Ghi vào đâu" lại Cá nhân.','. If this is something else, set "Where to" back to Personal.'))+'</div>';
}