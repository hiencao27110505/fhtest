/* ---- expense photos → memories (multi, max 10) ---- */
var exPhotos=[];
function onExPhoto(input){
  var files=Array.prototype.slice.call(input.files||[]);
  files.forEach(function(f){
    if(exPhotos.length>=10){ toast(L('Tối đa 10 ảnh','Up to 10 photos')); return; }
    readPhoto(f, function(src){ if(src && exPhotos.length<10){ exPhotos.push(src); renderExPhoto(); onExInput(); } });
  });
  input.value='';
}
function removeExPhoto(i){ exPhotos.splice(i,1); renderExPhoto(); onExInput(); }
function clearExPhoto(){ exPhotos=[]; renderExPhoto(); onExInput(); }

/* ---- bulk photo → expense assignment -------------------------------------
   Photos are held in memory and nothing is uploaded until Done, so a batch the
   user abandons costs no storage quota. The price of that choice is that the
   batch is fragile: it dies with the page. Hence the 20-photo cap (keeps the
   held bytes small enough that iOS is unlikely to reclaim the tab) and the
   arm-then-confirm on Cancel.

   Matching is by date only, which NARROWS rather than resolves — a normal day
   has several expenses, and EXIF gives a capture time that txn_date has nothing
   to compare against. So the UI never auto-assigns; it puts each day's photos
   next to that day's expenses and lets the tap decide. */
var PA_MAX = 20;
var paBatch = [];                     // {src, taken:'YYYY-MM-DD'|null, txId:string|null}
var paSel = {};                       // index → true
var paBusy = false;

function paOpen(){ document.getElementById('pa-file').click(); }
function paIngest(input){
  var files = Array.prototype.slice.call(input.files || []);
  input.value = '';
  if(!files.length) return;
  var capped = files.length > PA_MAX;
  files = files.slice(0, PA_MAX);
  paBatch = []; paSel = {}; paBusy = false;
  var loaded = 0, slot = new Array(files.length);
  files.forEach(function(f, i){
    readPhoto(f, function(src, taken){
      slot[i] = src ? { src: src, taken: taken || null, txId: null } : null;
      if(++loaded < files.length) return;
      paBatch = slot.filter(Boolean);
      if(!paBatch.length){ toast(L('Không đọc được những ảnh đó','Could not read those photos')); return; }
      if(capped) toast(L('Đã thêm '+PA_MAX+' ảnh đầu tiên','Added the first ' + PA_MAX + ' photos'));
      paShow();
    });
  });
}
function paShow(){
  document.getElementById('scrim').classList.add('on');
  var m = document.getElementById('photo-assign');
  m.style.transform = ''; m.style.transition = ''; m.classList.add('on');
  var body = m.querySelector('.modal-body'); if(body) body.scrollTop = 0;
  paRender();
}
function paDayLabel(iso){
  if(!iso) return L('Không có ngày','No date');
  var p = iso.split('-'), d = new Date(+p[0], +p[1]-1, +p[2]);
  if(iso === isoDate(TODAY)) return L('Hôm nay','Today');
  return WKD[d.getDay()] + ', ' + MONA[d.getMonth()] + ' ' + d.getDate();
}
function paGroups(){
  var by = {}, keys = [];
  paBatch.forEach(function(p, i){
    var k = p.taken || '';
    if(!by[k]){ by[k] = []; keys.push(k); }
    by[k].push(i);
  });
  keys.sort(function(a, b){                      // newest first, undated last
    if(!a) return 1; if(!b) return -1; return a < b ? 1 : -1;
  });
  return keys.map(function(k){ return { iso: k || null, idx: by[k] }; });
}
function paTxForDay(iso){
  if(!iso) return [];
  return txns.filter(function(t){ return txDateInput(t) === iso; });
}
function paSelCount(){ var n = 0; for(var k in paSel) if(paSel[k]) n++; return n; }
function paRender(){
  var host = document.getElementById('pa-days'); if(!host) return;
  var groups = paGroups();
  var unassigned = paBatch.filter(function(p){ return !p.txId; }).length;
  var undated = paBatch.some(function(p){ return !p.taken; });
  setTxt('pa-hint', unassigned
    ? (L('Chạm vào ảnh, rồi chạm khoản chi tương ứng.','Tap photos, then tap the expense they belong to.') + (undated ? L(' Ảnh không có ngày thì gán vào khoản nào cũng được.',' Undated photos can go on any expense.') : ''))
    : (L('Đã gán hết ','All ') + paBatch.length + L(' ảnh rồi. Chạm Xong để tải lên.',' photos assigned. Tap Done to upload.')));

  host.innerHTML = groups.map(function(g){
    var open = g.idx.filter(function(i){ return !paBatch[i].txId; });
    var tx = paTxForDay(g.iso);
    var h = '<div class="pa-day"><div class="pa-day-h"><span class="pa-day-t">' + esc(paDayLabel(g.iso)) + '</span>'
          + '<span class="pa-day-n">' + g.idx.length + L(' ảnh',' photo' + (g.idx.length !== 1 ? 's' : '')) + '</span></div>';
    h += open.length
      ? '<div class="pa-grid">' + open.map(function(i){
          return '<button class="pa-ph' + (paSel[i] ? ' on' : '') + '" onclick="paToggle(' + i + ')">'
               + '<img src="' + paBatch[i].src + '" alt="" loading="lazy" decoding="async"><span class="pa-tick"><span>✓</span></span></button>';
        }).join('') + '</div>'
      : '<div class="pa-empty">' + L('Ảnh của ngày này đã gán hết rồi.','All of this day\'s photos are assigned.') + '</div>';
    if(tx.length){
      h += '<div class="pa-txs">' + tx.map(function(t){
        var mine = paBatch.map(function(p, i){ return p.txId === t.id ? i : -1; }).filter(function(i){ return i >= 0; });
        var row = '<div class="pa-txw"><button class="pa-tx" onclick="paAssign(\'' + t.id + '\')">'
                + '<span class="pa-tx-ico">' + (t.ico || '🧾') + '</span>'
                + '<span class="pa-tx-b"><span class="pa-tx-n">' + esc(t.note || t.cat) + '</span>'
                + '<span class="pa-tx-c">' + esc(t.cat) + (mine.length ? ' · ' + mine.length + L(' đã thêm',' added') : '') + '</span></span>'
                + '<span class="pa-tx-amt">' + fmt(t.amt) + '</span></button>';
        if(mine.length) row += '<div class="pa-mini">' + mine.map(function(i){
          return '<button onclick="paUnassign(' + i + ')" aria-label="' + L('Bỏ ảnh này','Remove this photo') + '">'
               + '<img src="' + paBatch[i].src + '" alt="" loading="lazy" decoding="async"><span class="pa-un">×</span></button>';
        }).join('') + '</div>';
        return row + '</div>';
      }).join('') + '</div>';
    } else if(g.iso){
      h += '<div class="pa-empty">' + L('Ngày này chưa ghi khoản chi nào.','No expense logged on this day.') + '</div>'
         + '<button class="pa-new" onclick="paNewExpense(\'' + g.iso + '\')">＋ ' + L('Ghi một khoản chi','Log an expense') + '</button>';
    }
    return h + '</div>';
  }).join('');

  var n = paSelCount(), bar = document.getElementById('pa-bar');
  bar.style.display = n ? 'flex' : 'none';
  if(n) setTxt('pa-bar-t', n + L(' đã chọn',' selected'));
  var save = document.getElementById('pa-save');
  save.disabled = paBusy;   // only the async-busy gate (DESIGN §4.2); "nothing assigned yet" is caught by paDone()'s toast, not a greyed button (§4.4)
}
function paToggle(i){ paSel[i] = !paSel[i]; paRender(); }
function paClearSel(){ paSel = {}; paRender(); }
function paAssign(txId){
  var picked = []; for(var k in paSel) if(paSel[k]) picked.push(+k);
  if(!picked.length){ toast(L('Chọn vài ảnh trước','Pick some photos first')); return; }
  picked.forEach(function(i){ if(paBatch[i]) paBatch[i].txId = txId; });
  paSel = {}; paRender();
}
function paUnassign(i){                // one photo back to its day's unassigned grid
  if(paBatch[i]) paBatch[i].txId = null;
  paRender();
}
/* Photos on a day with no expense are often the sign an expense was never
   logged at all, so this opens the normal expense form with the date and the
   photos already filled in. The batch stays alive underneath. */
function paNewExpense(iso){
  var picked = []; for(var k in paSel) if(paSel[k]) picked.push(+k);
  if(!picked.length) picked = paBatch.map(function(p, i){ return (!p.txId && p.taken === iso) ? i : -1; }).filter(function(i){ return i >= 0; });
  if(!picked.length){ toast(L('Chọn vài ảnh trước','Pick some photos first')); return; }
  paPending = picked.slice();
  editingTx = null;
  openExpense({ date: iso, photos: picked.map(function(i){ return paBatch[i].src; }) });
}
var paPending = null;                 // indices handed to the expense form, dropped from the batch once it saves
function paAdopt(){                   // called after the expense form saves
  if(!paPending) return;
  var drop = {}; paPending.forEach(function(i){ drop[i] = 1; });
  paBatch = paBatch.filter(function(p, i){ return !drop[i]; });
  paSel = {}; paPending = null;
  if(!paBatch.length){ paClose(); toast(L('Đã thêm ảnh','Photos added')); return; }
  paRender();
}
async function paDone(){
  if(paBusy) return;
  var byTx = {};
  paBatch.forEach(function(p){ if(p.txId){ (byTx[p.txId] = byTx[p.txId] || []).push(p.src); } });
  var ids = Object.keys(byTx);
  if(!ids.length){ toast(L('Chưa gán ảnh nào','Nothing assigned yet')); return; }
  var leftover = paBatch.filter(function(p){ return !p.txId; }).length;
  paBusy = true;
  var save = document.getElementById('pa-save');
  save.disabled = true;
  var done = 0, total = paBatch.length - leftover;
  for(var i = 0; i < ids.length; i++){
    save.textContent = L('Đang lưu ','Saving ') + Math.min(done + byTx[ids[i]].length, total) + '/' + total;
    try { await paApply(ids[i], byTx[ids[i]]); } catch(e){ console.warn('assign failed', e); }
    done += byTx[ids[i]].length;
  }
  save.textContent = L('Xong','Done'); paBusy = false;
  paBatch = []; paSel = {}; paClose();
  // Same refresh as saveExpenseEdit. renderEvents() is the one that matters:
  // the Memories tab and its calendar are rebuilt from its tail, so without it
  // the photos are saved but never appear there.
  renderTxns(); renderEvents();
  toast(leftover ? (total + L(' ảnh đã thêm · ',' photos added · ') + leftover + L(' bỏ qua',' skipped')) : (total + L(' ảnh đã thêm',' photos added')));
}
/* Local model update. The data layer wraps this to persist; keeping the split
   means the screen still works unauthenticated, exactly like the expense form. */
window.paApply = function(txId, srcs){
  var t = txById(txId); if(!t) return null;
  t.photos = (t.photos || []).concat(srcs);
  syncExpenseEvent(t);
  return t;
};
function paClose(){
  closeModals();
  var s = document.getElementById('pa-save'); if(s){ s.textContent = L('Xong','Done'); s.disabled = false; }
  document.getElementById('pa-bar').style.display = 'none';
  paSel = {}; paPending = null; paBusy = false;
}
/* Arm-then-confirm rather than a browser confirm() — leaving discards a batch
   that exists nowhere else. */
function paCancel(){
  var btn = document.querySelector('#photo-assign .modal-cancel');
  if(paBusy){ toast(L('Đang tải lên…','Still uploading…')); return; }
  if(!paBatch.length){ paClose(); return; }
  if(btn && !btn.dataset.armed){
    btn.dataset.armed = '1';
    btn.textContent = L('Bỏ ','Discard ') + paBatch.length + L(' ảnh?','?');
    clearTimeout(window._paArmT);
    window._paArmT = setTimeout(function(){
      if(!btn.isConnected) return;
      delete btn.dataset.armed; btn.textContent = L('Huỷ','Cancel');
    }, 3200);
    return;
  }
  if(btn){ delete btn.dataset.armed; btn.textContent = L('Huỷ','Cancel'); }
  paBatch = []; paClose();
}
function renderExPhoto(){
  var strip=document.getElementById('ex-strip'), up=document.getElementById('ex-upload-txt');
  if(up) up.textContent = exPhotos.length ? L('📷 Thêm ảnh nữa','📷 Add more') : L('📷 Thêm ảnh','📷 Add photos');
  if(!strip)return;
  strip.innerHTML = exPhotos.map(function(src,i){
    return '<div class="photo-thumb" style="background-image:url('+src+')"><button type="button" class="x" onclick="removeExPhoto('+i+')">✕</button></div>';
  }).join('') + (exPhotos.length ? '<div class="photo-strip-note">'+exPhotos.length+L(' ảnh',' photo'+(exPhotos.length!==1?'s':''))+L(' · lưu thành kỷ niệm',' · saved as '+(exPhotos.length!==1?'memories':'a memory'))+' 📸</div>' : '');
}
function exFormState(){                                     // snapshot used to detect edits
  return document.getElementById('ex-note').value.trim()
    +'|'+parseAmtBase(document.getElementById('ex-amt').value)
    +'|'+chosen('ex-cat')+'|'+chosen('ex-who')
    +'|'+document.getElementById('ex-date').value
    +'|'+exPhotos.length+':'+exPhotos.map(function(s){return s.length;}).join(',');
}
function refreshExCta(){                                    // nav-bar Save button
  var s=document.getElementById('ex-save'); if(!s)return;
  if(editingTx){
    s.disabled = !(editSnap!==null && exFormState()!==editSnap);  // edit mode: enabled only once something changes
    return;
  }
  // add mode: Save stays enabled whenever there's at least one non-empty row. We do
  // NOT gray it out for incomplete rows — tapping it shakes + red-borders them so the
  // user learns why (a silently-disabled button explains nothing). Count entries for
  // the "(N)" label, treating the input row's note as possibly several entries.
  var rows=(typeof bulkRows!=='undefined')?bulkRows:[];
  var considered=0;
  for(var i=0;i<rows.length;i++){
    var r=rows[i];
    if(i===bulkActive && !parseAmtBase(r.amt||'') && (r.note||'').trim() && typeof parseEntries==='function'){
      considered += Math.max(1, parseEntries(r.note).length);
      continue;
    }
    if((r.note||'').trim() || parseAmtBase(r.amt||'')) considered++;
  }
  s.disabled = !(considered>=1);
  // Label: keep updateExWhen()'s single-row Lưu/Gửi; only override for a true batch.
  if(rows.length>1) s.textContent = L('Lưu tất cả ('+considered+')','Save all ('+considered+')');
}
function onExInput(){ if(!editingTx){ flushActiveRow(); if(typeof persistDrafts==='function') persistDrafts(); } updateExWhen(); refreshExCta(); }
function openEditExpense(id){
  var t=txById(id); if(!t)return;
  editingTx=id;
  openExpense();                                           // opens the modal; fillExpenseFromTx() runs inside
}
function fillExpenseFromTx(){
  var t=txById(editingTx); if(!t){ editingTx=null; prefillExpense(); return; }
  if(typeof renderBulk==='function') renderBulk();          // edit mode → single-form: editor back in the body, no cards
  document.getElementById('ex-note').value=t.note||'';
  document.getElementById('ex-amt').value=t.amt?((t.amt*curMult()).toLocaleString(CUR==='VND'?'vi-VN':'en-US')):'';
  var edIso=txDateInput(t);
  document.getElementById('ex-date').value=edIso;
  setDateFloor('ex-date', isoMonthStart(-24), edIso);   // an old expense must stay editable
  selectChipByVal('ex-cat', t.cat);
  selectChipByVal('ex-who', whoToChip(t.who));
  exPhotos = (t.photos||(t.photo?[t.photo]:[])).slice(); renderExPhoto();
  updateExWhen();
  setTxt('ex-title',L('Sửa khoản chi','Edit expense'));
  var del=document.getElementById('ex-del'); if(del)del.style.display='block';
  resetDelArm();
  editSnap=exFormState();                                  // baseline: no changes yet
  refreshExCta();                                          // Save stays disabled until the first edit
}
function submitExpense(){
  if(!editingTx){
    // Parse/split whatever is still in the input (the user may tap Lưu without blurring first).
    if(typeof commitActiveRow==='function') commitActiveRow();
    if(typeof bulkRows!=='undefined' && bulkRows.length>1){ submitBulk(); return; }
    // Single expense: still block an incomplete row (missing amount or category) — shake it
    // rather than silently saving a phantom category.
    if(typeof bulkRows!=='undefined' && bulkRows.length===1){
      var r=bulkRows[0];
      if(typeof rowHasContent==='function' && rowHasContent(r) && !(parseAmtBase(r.amt||'')>0 && catValid(r.cat))){
        if(typeof bulkShowInvalid==='function'){ bulkShowInvalid(); return; }
      }
      if(typeof loadRow==='function') loadRow(0);   // sync the parsed single entry into the fields addExpense reads
    }
  }
  var adopting = !editingTx && paPending;   // expense created from the bulk-assign screen
  if(editingTx) saveExpenseEdit(); else addExpense();
  // addExpense() bails without closing when the form is invalid; only drop the
  // photos from the batch once the expense actually landed.
  if(adopting && !document.getElementById('expense-modal').classList.contains('on')) paAdopt();
}
function saveExpenseEdit(){
  var t=txById(editingTx); if(!t){ closeExpense(); return; }
  var amt=parseAmtBase(document.getElementById('ex-amt').value);
  if(!amt){ document.getElementById('ex-amt').focus(); return; }
  var note=document.getElementById('ex-note').value.trim()||L('Khoản chi','Expense');
  var cat=chosen('ex-cat')||'Fun', who=chosen('ex-who')||'Emma';
  var whoStore=(who==='Both')?'Shared':who;
  var dObj=exDate(), dstr=(dObj.getTime()===TODAY.getTime())?'Today':(MONA[dObj.getMonth()]+' '+dObj.getDate());
  var s=catStyle[cat]||['🧾','#f2eef6','var(--cat-other)'];
  var jul=months[curMonthKey()], newFuture=dObj>TODAY;      // a future date → reserved (not counted as spent)
  // reverse the OLD contribution (only realized items were ever counted toward spending)
  if(!t.future){
    var oldMk=(t.who==='Shared'||t.who==='both')?'Shared':t.who;
    jul.spent-=t.amt; jul.catSpent[t.cat]=(jul.catSpent[t.cat]||0)-t.amt; jul.memberSpent[oldMk]=(jul.memberSpent[oldMk]||0)-t.amt;
  }
  // write the new values in place (keep the specific icon unless the category changed)
  t.ico=(cat===t.cat && t.ico)?t.ico:s[0]; t.cat=cat; t.note=note; t.amt=amt; t.who=whoStore; t.date=dstr; t._d=dObj; t.future=newFuture?true:undefined;
  t.photos=exPhotos.slice(); delete t.photo;               // add / keep / remove the memory photos
  syncExpenseEvent(t);                                     // keep the linked event in sync (create/update/remove)
  // apply the NEW contribution only if it is realized
  if(!newFuture){
    var newMk=(whoStore==='Shared')?'Shared':whoStore;
    jul.spent+=amt; jul.catSpent[cat]=(jul.catSpent[cat]||0)+amt; jul.memberSpent[newMk]=(jul.memberSpent[newMk]||0)+amt;
  }
  t._d=dObj;                                              // preserve the real date so ordering holds across months
  editingTx=null; editSnap=null; exPhotos=[];
  txns.sort(txNewestFirst);
  selMonth=curMonthKey(); renderAll(); renderTxns(); renderEvents();
  if(curDetail && document.getElementById('cat-overlay').classList.contains('on')) openCat(curDetail.type,curDetail.val);
  if(typeof renderExpenseDetailIfOpen==='function') renderExpenseDetailIfOpen();   // refresh the detail screen underneath, if it launched this edit
  closeExpense();
  toast(L('Đã lưu · ','Changes saved · ')+note);
}
var delArmed=false, delTimer=null;
function resetDelArm(){ delArmed=false; clearTimeout(delTimer); var b=document.getElementById('ex-del'); if(b){ b.classList.remove('armed'); b.textContent=L('Xoá khoản chi','Delete expense'); } }
function deleteExpense(){
  var t=txById(editingTx); if(!t){ closeExpense(); return; }
  var btn=document.getElementById('ex-del');
  if(!delArmed){                                           // first tap arms it — guards against a misclick
    delArmed=true; if(btn){ btn.classList.add('armed'); btn.textContent=L('Chạm lần nữa để xoá','Tap again to delete'); }
    clearTimeout(delTimer); delTimer=setTimeout(resetDelArm,3000); return;
  }
  resetDelArm();
  var note=t.note;
  var jul=months[curMonthKey()];
  if(!t.future && t.month===curMonthKey()){                // remove its realized contribution
    var mk=(t.who==='Shared'||t.who==='both')?'Shared':t.who;
    jul.spent-=t.amt; jul.catSpent[t.cat]=(jul.catSpent[t.cat]||0)-t.amt; jul.memberSpent[mk]=(jul.memberSpent[mk]||0)-t.amt;
  }
  if(t.photos&&t.photos.length){ t.photos=[]; syncExpenseEvent(t); }   // drop its linked event too
  var i=txns.indexOf(t); if(i>=0) txns.splice(i,1);
  editingTx=null; editSnap=null; exPhotos=[];
  selMonth=curMonthKey(); renderAll(); renderTxns(); renderEvents();
  if(curDetail && document.getElementById('cat-overlay').classList.contains('on')) openCat(curDetail.type,curDetail.val);
  closeExpense();
  if(typeof renderExpenseDetailIfOpen==='function') renderExpenseDetailIfOpen();   // the txn is gone → this backs out of an open detail screen
  toast(L('Đã xoá · ','Deleted · ')+note);
}
var selEmoji='🎉', selCov='pink';
function pickEmoji(btn){ document.getElementById('ev-emoji').querySelectorAll('button').forEach(function(b){ b.classList.remove('on'); }); btn.classList.add('on'); selEmoji=btn.dataset.v; }
function pickCov(btn){ document.getElementById('ev-cov').querySelectorAll('button').forEach(function(b){ b.classList.remove('on'); }); btn.classList.add('on'); selCov=btn.dataset.v; }
function buildFundChoices(){
  var box=document.getElementById('fn-event'), html='';
  var up=order.filter(function(k){return !achievedNow(events[k]);});
  var sel=up.indexOf(curEvent)>=0?curEvent:(up[0]||'');
  up.forEach(function(k){ html+='<button class="choice'+(k===sel?' on':'')+'" data-v="'+k+'" onclick="pick(\'fn-event\',this)">'+events[k].emoji+' '+events[k].name+'</button>'; });
  box.innerHTML=html;
  setHTML('fund-avail','💰 <b>'+fmt(savings)+'</b> '+L('đang có trong tiết kiệm','available in savings'));
}
function openFund(){ openSheet('sheet-fund'); }
function sendSuggestion(){
  var el=document.getElementById('sg-msg'), msg=(el.value||'').trim();
  if(!msg){ el.focus(); return; }
  el.value='';
  closeModals();
  toast(L('Gửi rồi nha, cảm ơn bạn 💛 Tụi mình đọc hết mọi góp ý','Got it, thanks! 💛 We read every note'));
  floatEmojis('💛');
}

/* User text (event names, captions, notes) goes into innerHTML and into inline
   onclick attributes all over this file. An apostrophe — "Emma's party" — was
   enough to break the markup or the handler, so everything user-authored is
   escaped on the way out. esc() for text nodes, escAttr() for quoted attributes. */
function esc(s){ return String(s==null?'':s).replace(/[&<>"']/g,function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); }
function escAttr(s){ return String(s==null?'':s).replace(/\\/g,'\\\\').replace(/'/g,"\\'").replace(/"/g,'&quot;'); }

/* Photo uploads compress + POST each image; on cellular that's tens of seconds.
   The app used to toast "Memory saved 📸" the instant the modal closed, before
   anything had been attempted — so a failed upload looked like a success and the
   photo silently vanished on the next reload. Saving is now only claimed once the
   bytes are actually stored; until then this counter shows real progress. */
var fhUpN=0, fhUpDone=0;
function fhUploadBusy(add){
  fhUpN+=add; if(fhUpN<0)fhUpN=0;
  if(add>0) fhUpDone=0;
  var el=document.getElementById('fh-uploading'); if(!el)return;
  if(fhUpN>0){
    el.querySelector('.fu-txt').textContent = fhUpN===1 ? L('Đang lưu ảnh…','Saving photo…') : L('Đang lưu ','Saving ')+fhUpN+L(' ảnh…',' photos…');
    el.classList.add('on');
  } else el.classList.remove('on');
}

var tt;
function toast(msg){
  var el=document.getElementById('toast');
  el.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M5 12l5 5L20 7"/></svg>'+msg;
  el.classList.add('on'); clearTimeout(tt); tt=setTimeout(function(){ el.classList.remove('on'); },2400);
}
