/* ---- CSV import: pick a file, review, promote into the real ledger --------
   Parse (44-csv-parse.js) -> map columns (45-csv-import.js, masked via
   43-redact-for-sharing.js for encrypted families) -> build + bucket
   candidates (57-csv-import-review.js) -> this file renders the review and
   promotes approved rows by feeding bulkRows into the existing submitBulk()
   machinery (50-sheets-expense-capture.js) rather than a bespoke insert --
   inherits fhField()/_fhWriteLocked() correctness for free. Expense-only
   this pass: transactions has no direction column, income lives in a
   separate table this doesn't write to (see 57's header comment).

   Interaction model ("quick pick -> sheet", DESIGN.md &sect;4): the review is
   pure dense rows -- the same .rows/.row list the Finance tab uses, grouped
   by date. Nothing ever expands inside the list. Every decision or edit
   opens a bottom sheet (#sheet-csvcat / #sheet-csvdup, .over-modal so they
   rise above the import modal); once resolved, the item dissolves into the
   date-grouped ready list. csvIncludedCount === ready.length, always. */
var csvReview = null;      // { ready[], groups[], dup[], deferred[], mixedSignsNote }
var csvPickTarget = null;  // { type:'ready'|'group'|'dup', idx } -- what #sheet-csvcat is editing

function openCsvImport(){
  var input=document.getElementById('csv-file-input'); if(input) input.value='';
  var out=document.getElementById('csv-result'); if(out) out.innerHTML='';
  csvReview = null; csvPickTarget = null;
  var save=document.getElementById('csv-save'); if(save){ save.disabled=true; save.textContent=L('Nhập','Import'); }
  openSheet('csv-import-modal');
}

function onCsvFileSelected(input){
  var file=input.files && input.files[0]; if(!file) return;
  var out=document.getElementById('csv-result');
  if(out) out.innerHTML='<div class="sheet-sub">'+L('✨ Đang đọc file của bạn…','✨ Reading your file…')+'</div>';

  var reader=new FileReader();
  reader.onload=function(){
    var parsed = window.fhParseCsvFile ? window.fhParseCsvFile(reader.result) : null;
    if(!parsed || !parsed.headers.length){
      if(out) out.innerHTML='<div class="sheet-sub">'+L('Không đọc được file này.','Could not read this file.')+'</div>';
      return;
    }
    window.fhResolveCsvMapping(parsed.headers, parsed.rows).then(function(result){
      csvBuildReview(parsed, result);
      renderCsvReview();
    }).catch(function(e){
      if(out) out.innerHTML='<div class="sheet-sub">'+L('Có lỗi khi phân tích file: ','Something went wrong analyzing this file: ')+esc(String((e&&e.message)||e))+'</div>';
    });
  };
  reader.onerror=function(){
    if(out) out.innerHTML='<div class="sheet-sub">'+L('Không đọc được file này.','Could not read this file.')+'</div>';
  };
  reader.readAsText(file,'utf-8');
}

function csvIncludedCount(){ return csvReview ? csvReview.ready.length : 0; }

/* Builds (or REbuilds, after adopting the file's categories) the whole review
   state from the parsed file + resolved mapping, which stay stored so
   adoption can re-run categorization from scratch. */
function csvBuildReview(parsed, result){
  var candidates = buildCsvCandidates(parsed, result);
  var mixed = csvColumnHasMixedSigns(candidates);
  var buckets = bucketCsvCandidates(candidates, mixed);
  csvReview = {
    parsed: parsed, mapResult: result,
    ready: buckets.ready,
    groups: Object.keys(buckets.needsCategoryGroups).map(function(k){ return { key:k, items:buckets.needsCategoryGroups[k] }; }),
    dup: buckets.possibleDuplicate.map(function(c){ return { c:c, resolved:null }; }), // null | 'skip' | 'done' (moved to ready)
    deferred: buckets.deferred,
    mixedSignsNote: mixed,
    fileCats: csvUnknownFileCategories(candidates),
  };
}

/* Distinct category names the FILE uses that the family doesn't have yet --
   the raw material for the first-run magic. Deduped diacritic-insensitively
   ("Nha cua" / "nha cua" / "NHA CUA" collapse to one), preferring the variant
   that carries diacritics, then the most frequent spelling. */
function csvUnknownFileCategories(candidates){
  var seen = {};
  candidates.forEach(function(c){
    var g = (c.categoryGuess||'').trim();
    if(!g || matchCategoryName(g)) return;
    var k = deburr(g.toLowerCase());
    var e = (seen[k] = seen[k] || {});
    e[g] = (e[g]||0) + 1;
  });
  return Object.keys(seen).map(function(k){
    var best = null;
    Object.keys(seen[k]).forEach(function(v){
      if(best===null){ best=v; return; }
      var vD = /[^\x00-\x7f]/.test(v), bD = /[^\x00-\x7f]/.test(best);
      if(vD && !bD) best = v;
      else if(vD===bD && seen[k][v] > seen[k][best]) best = v;
    });
    return best;
  });
}

// A reasonable starter emoji per adopted category -- editable later in the
// budget editor, same as any other category.
function csvCatEmoji(name){
  var n = deburr(name.toLowerCase());
  if(n.indexOf('nha')>=0) return '🏠';
  if(n.indexOf('an ngoai')>=0 || n.indexOf('quan')>=0) return '🍽️';
  if(n.indexOf('an uong')>=0 || n.indexOf('cho')>=0 || n.indexOf('thuc pham')>=0) return '🛒';
  if(n.indexOf('di chuyen')>=0 || n.indexOf('xe')>=0 || n.indexOf('xang')>=0) return '🛵';
  if(n.indexOf('giai tri')>=0 || n.indexOf('vui')>=0) return '🎬';
  if(n.indexOf('mua sam')>=0) return '🛍️';
  if(n.indexOf('suc khoe')>=0 || n.indexOf('y te')>=0) return '💊';
  if(n.indexOf('hoc')>=0) return '📚';
  return '🏷️';
}

/* One tap: the family adopts the file's own categories, then everything
   re-categorizes -- a first import arrives not just populated but organized,
   with the structure carried over from the old app. Client-side only here;
   the DB rows are created lazily at promote time by _categoryIdForName(),
   the same path any brand-new category takes. Rebuilds the whole review, so
   decisions made before adopting reset -- the card sits at the very top, so
   in practice nothing has been decided yet when it's tapped. */
function csvAdoptFileCategories(){
  if(!csvReview || !csvReview.fileCats.length) return;
  csvReview.fileCats.forEach(function(name){
    if(catValid(name)) return;
    catOrder.push(name);
    catStyle[name] = [csvCatEmoji(name)].concat(CATPAL[catOrder.length % CATPAL.length]);
    if(typeof catBudget !== 'undefined') catBudget[name] = catBudget[name] || 0;
  });
  csvBuildReview(csvReview.parsed, csvReview.mapResult);
  renderCsvReview();
}

/* Dense row -- the SAME .row component the Finance tab's transaction list
   uses (60-transactions.js): emoji tile, title, subtitle, right-aligned
   amount. chev adds the tappable-row disclosure chevron (DESIGN.md &sect;3)
   on rows whose tap opens a decision sheet. */
function csvDenseRow(cat, title, sub, amount, onclick, extraClass, chev){
  var s = (cat && window.catStyle && window.catStyle[cat]) || ['🧾','#f2eef6','var(--cat-other)'];
  return '<div class="row'+(onclick?' tap':'')+(extraClass?' '+extraClass:'')+'"'+(onclick?' onclick="'+onclick+'"':'')+'>'
    + '<div class="r-ico-wrap"><div class="r-ico" style="background:'+s[1]+';color:'+s[2]+'">'+s[0]+'</div></div>'
    + '<div class="r-body"><div class="r-t">'+esc(title)+'</div><div class="r-s">'+esc(sub)+'</div></div>'
    + (amount!=null?'<div class="r-amt num">'+fmt(amount)+'</div>':'')
    + (chev?'<svg class="chev" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18l6-6-6-6"/></svg>':'')
    + '</div>';
}

function renderCsvReview(){
  var out=document.getElementById('csv-result'); if(!out || !csvReview) return;
  var r = csvReview;
  var total = r.ready.length + r.groups.reduce(function(n,g){return n+g.items.length;},0)
    + r.dup.filter(function(d){return d.resolved===null;}).length + r.deferred.length;

  var html = '';

  if(r.mixedSignsNote){
    html += '<div class="notice-card"><svg class="notice-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16h.01"/></svg>'
      + '<div class="notice-text">'+L('File này có cả số dương và âm trong cột số tiền — có thể lẫn cả thu lẫn chi, nên tụi mình không tự nhập khoản nào. Khoản nào đúng là khoản chi, bạn chạm vào để đưa vào.','This file mixes positive and negative amounts — possibly income and expenses together, so nothing was imported automatically. Tap any row that really is an expense to bring it in.')+'</div></div>';
  }

  /* First-run magic: the file's own categories, offered in one tap. Shown
     above everything -- for a brand-new family this single button turns a
     wall of "needs your eye" into a sorted, organized ledger. */
  if(!r.mixedSignsNote && r.fileCats && r.fileCats.length){
    html += '<div class="notice-card" style="flex-direction:column">'
      + '<div class="notice-text"><b>'+esc(L('File này dùng '+r.fileCats.length+' danh mục bạn chưa có:','This file uses '+r.fileCats.length+(r.fileCats.length===1?' category':' categories')+' you don\'t have yet:'))+'</b> '
      + esc(r.fileCats.map(function(n){ return csvCatEmoji(n)+' '+n; }).join(' · '))+'</div>'
      + '<button type="button" class="btn-line" style="width:100%;margin:10px 0 0" onclick="csvAdoptFileCategories()">'+L('✨ Thêm và tự xếp giúp tôi','✨ Add them and sort for me')+'</button>'
      + '</div>';
  }

  /* Decisions FIRST -- a handful of tappable rows, each opening a sheet. */
  var decisionsHtml = '';
  r.groups.forEach(function(g, gi){
    var sum = g.items.reduce(function(s,it){return s+it.amount;},0);
    var sub = g.items.length>1
      ? g.items.length+' '+L('giao dịch · chạm để chọn danh mục','txns · tap to pick a category')
      : L('Chạm để chọn danh mục','Tap to pick a category');
    decisionsHtml += csvDenseRow(null, g.items[0].description, sub, sum, 'csvOpenCatSheet(\'group\','+gi+')', null, true);
  });
  r.dup.forEach(function(d, di){
    if(d.resolved!==null) return;
    decisionsHtml += csvDenseRow(d.c.categoryName, d.c.description, L('Có thể trùng · chạm để xem','Possible duplicate · tap to review'), d.c.amount, 'csvOpenDupSheet('+di+')', null, true);
  });
  var decisionCount = r.groups.length + r.dup.filter(function(d){return d.resolved===null;}).length;

  // Lead with the win, not the workload.
  var readyCount = r.ready.length;
  var summaryLine;
  if(r.mixedSignsNote) summaryLine = esc(L(total+' giao dịch tìm thấy', total+' transactions found'));
  else if(decisionCount===0 && readyCount>0) summaryLine = esc(L('✨ Cả '+readyCount+' khoản đã xếp xong — lướt qua rồi nhập thôi','✨ All '+readyCount+' sorted — skim and import'));
  else if(readyCount>0) summaryLine = esc(L('✨ Đã tự xếp '+readyCount+' khoản — chỉ còn '+decisionCount+' cần bạn xem','✨ '+readyCount+' sorted automatically — just '+decisionCount+(decisionCount===1?' needs':' need')+' your eye'));
  else summaryLine = esc(L(total+' giao dịch tìm thấy', total+' transactions found'));
  html += '<div class="review-summary">'+summaryLine+'</div>';

  if(decisionsHtml){
    html += '<div class="group-h">'+L('Cần bạn xem','Needs your eye')+'</div><div class="rows csv-rows">'+decisionsHtml+'</div>';
  }

  /* Ready list, grouped by date (newest first), like the ledger it becomes.
     Subtitle is just the category -- the date lives in the section header. */
  if(r.ready.length){
    var buckets = {};
    r.ready.forEach(function(c, i){ var k = c.dateDisplay || ''; (buckets[k] = buckets[k] || []).push({ c:c, i:i }); });
    var keys = Object.keys(buckets).sort().reverse();
    html += '<div class="group-h">'+L('Sẵn sàng','Ready')+' · '+readyCount+'</div>';
    keys.forEach(function(k){
      var label = k ? fmtDayMon(buckets[k][0].c.date) : L('Không rõ ngày','No date');
      html += '<div class="group-h" style="margin-top:10px">'+esc(label)+'</div><div class="rows csv-rows">';
      buckets[k].forEach(function(e){
        html += csvDenseRow(e.c.categoryName, e.c.description, e.c.categoryName, e.c.amount, 'csvOpenCatSheet(\'ready\','+e.i+')');
      });
      html += '</div>';
    });
  }

  if(r.deferred.length){
    html += '<div class="group-h defer">'+L('Cần xem lại','Needs your look')+'</div><div class="rows csv-rows">';
    r.deferred.forEach(function(c, di){
      // A row is only stuck for real when its date or amount is unreadable.
      // A row deferred purely on the mixed-signs suspicion has everything a
      // valid expense needs -- one tap confirms it's an expense.
      var rescuable = c.date && c.amount !== null
        && c.flags.indexOf('date_missing')<0 && c.flags.indexOf('amount_missing')<0;
      var title = c.description||c.raw.join(', ');
      if(rescuable){
        html += csvDenseRow(null, title, L('Có thể là thu nhập? Chạm nếu là khoản chi','Possibly income? Tap if it\'s an expense'), c.amount, 'csvRescueDeferred('+di+')');
      } else {
        var why = c.flags.indexOf('date_missing')>=0 ? L('thiếu ngày','missing date') : L('không đọc được số tiền','unreadable amount');
        html += csvDenseRow(null, title, why, c.amount, null, 'defer-card');
      }
    });
    html += '</div>';
  }

  out.innerHTML = html;

  // Nav-bar Save, gated -- the app's form-modal convention (Cancel · Title ·
  // Save, DESIGN.md &sect;3 Buttons): always reachable, grey until importable.
  var save = document.getElementById('csv-save');
  if(save){ save.disabled = (readyCount===0); save.textContent = readyCount>0 ? L('Nhập '+readyCount,'Import '+readyCount) : L('Nhập','Import'); }
}

/* ---- edit sheet: ONE surface for every correction -------------------------
   For a single row (ready / duplicate) it's a compact full editor --
   description, amount, date, category chips -- so anything the parser got
   wrong is fixable in one place. For a merchant group it collapses to just
   the category chips (per-row fields don't apply to N rows at once).
   Chips select only; Done commits everything at once. */
function csvAmtInputVal(n){ return Number(n).toLocaleString(CUR==='VND'?'vi-VN':'en-US'); }

function csvOpenCatSheet(type, idx){
  csvPickTarget = { type:type, idx:idx };
  var isGroup = (type==='group');
  var c = type==='ready' ? csvReview.ready[idx] : type==='dup' ? csvReview.dup[idx].c : null;
  var g = isGroup ? csvReview.groups[idx] : null;
  setTxt('csvcat-h', isGroup ? L('Chọn danh mục','Pick a category') : L('Sửa khoản chi','Edit expense'));
  setTxt('csvcat-sub', isGroup ? g.items[0].description+(g.items.length>1?' · '+g.items.length+' '+L('giao dịch','txns'):'') : '');
  var f=document.getElementById('csvcat-fields'); if(f) f.style.display = isGroup ? 'none' : '';
  if(c){
    setV('csvedit-note', c.description||'');
    setV('csvedit-amt', c.amount!=null ? csvAmtInputVal(c.amount) : '');
    setV('csvedit-date', c.dateDisplay||'');
  }
  var cur = c ? c.categoryName : null;
  var list=document.getElementById('csvcat-list');
  if(list) list.innerHTML = (window.catOrder||[]).map(function(name){
    var s=(window.catStyle&&window.catStyle[name])||['🏷️'];
    return '<button class="choice'+(name===cur?' on':'')+'" data-v="'+escAttr(name)+'" onclick="pick(\'csvcat-list\',this)">'+s[0]+' '+esc(name)+'</button>';
  }).join('');
  setTxt('csvcat-done', L('Xong','Done'));
  setTxt('csvcat-remove', isGroup ? L('Bỏ nhóm này','Don\'t import these') : L('Bỏ khoản này','Don\'t import this one'));
  openSheet('sheet-csvcat');
}

// Applies a single row's edited fields back onto its candidate.
function csvApplyEditFields(c){
  var note=(document.getElementById('csvedit-note')||{}).value;
  if(note && note.trim()) c.description = note.trim();
  var amt = parseAmt((document.getElementById('csvedit-amt')||{}).value||'');
  if(amt > 0) c.amount = amt;
  var dv=(document.getElementById('csvedit-date')||{}).value;
  if(dv){ c.dateDisplay = dv; c.date = new Date(dv+'T00:00:00'); }
}

function csvEditSheetDone(){
  var t=csvPickTarget; if(!t||!csvReview) return;
  var cat = chosen('csvcat-list');
  if(t.type==='ready'){
    var c=csvReview.ready[t.idx];
    if(c){ csvApplyEditFields(c); if(cat){ c.categoryName=cat; c.catSource='user'; } }
  } else if(t.type==='group'){
    if(cat){
      var g=csvReview.groups.splice(t.idx,1)[0];
      if(g) g.items.forEach(function(it){ it.categoryName=cat; it.catSource='user'; csvReview.ready.push(it); });
    }
  } else {
    var d=csvReview.dup[t.idx];
    if(d){
      csvApplyEditFields(d.c);
      if(cat){ d.c.categoryName=cat; d.c.catSource='user'; }
      if(d.c.categoryName){ d.resolved='done'; csvReview.ready.push(d.c); }
    }
  }
  csvPickTarget=null; closeSheet(); renderCsvReview();
}

function csvCatSheetRemove(){
  var t=csvPickTarget; if(!t||!csvReview) return;
  if(t.type==='ready') csvReview.ready.splice(t.idx,1);
  else if(t.type==='group') csvReview.groups.splice(t.idx,1);
  else csvReview.dup[t.idx].resolved='skip';
  csvPickTarget=null; closeSheet(); renderCsvReview();
}

/* ---- duplicate sheet ------------------------------------------------------ */
function csvOpenDupSheet(di){
  csvPickTarget = { type:'dup', idx:di };
  var d=csvReview.dup[di]; if(!d) return;
  setTxt('csvdup-h', L('Có thể trùng','Possible duplicate'));
  setTxt('csvdup-note', d.c.description+' · '+fmt(d.c.amount)+' — '+(d.c.duplicateOfExisting
    ? L('trùng với một giao dịch đã có trong sổ, cùng số tiền, trong vòng 3 ngày.','matches a transaction already in your ledger, same amount, within 3 days.')
    : L('xuất hiện 2 lần trong file này với cùng nội dung và số tiền.','appears twice in this file with the same description and amount.')));
  setTxt('csvdup-include', L('Vẫn nhập','Import anyway'));
  setTxt('csvdup-skip', L('Bỏ qua','Skip'));
  openSheet('sheet-csvdup');
}

function csvDupSheetInclude(){
  var t=csvPickTarget; if(!t||!csvReview) return;
  var d=csvReview.dup[t.idx]; if(!d) return;
  if(d.c.categoryName){ d.resolved='done'; csvReview.ready.push(d.c); csvPickTarget=null; closeSheet(); renderCsvReview(); }
  else { closeSheet(); csvOpenCatSheet('dup', t.idx); }   // needs a category first -- chain into the picker
}

function csvDupSheetSkip(){
  var t=csvPickTarget; if(!t||!csvReview) return;
  csvReview.dup[t.idx].resolved='skip';
  csvPickTarget=null; closeSheet(); renderCsvReview();
}

/* User confirmed a mixed-signs-deferred row really is an expense. It re-enters
   the normal flow -- INCLUDING the dedup checks, which the mixed-signs early
   exit in bucketCsvCandidates() skipped for the whole file, so a rescued row
   must not bypass them now. */
function csvRescueDeferred(di){
  var c = csvReview.deferred.splice(di,1)[0]; if(!c) return;

  // within-review duplicate: same description+amount as anything already included
  var key = normDescForDedup(c.description)+'|'+c.amount;
  var already = csvReview.ready.some(function(x){ return normDescForDedup(x.description)+'|'+x.amount === key; })
    || csvReview.groups.some(function(g){ return g.items.some(function(x){ return normDescForDedup(x.description)+'|'+x.amount === key; }); });
  // cross-source: same amount within ±3 days of an existing ledger transaction
  var crossMatch = !already && (window.txns||[]).find(function(t){
    if(!t._d || !c.date) return false;
    return Math.abs(t._d.getTime()-c.date.getTime())/86400000 <= 3 && Math.abs(Number(t.amt)-c.amount) < 1;
  });
  if(already){ c.duplicateOfBatch = true; csvReview.dup.push({ c:c, resolved:null }); }
  else if(crossMatch){ c.duplicateOfExisting = crossMatch; csvReview.dup.push({ c:c, resolved:null }); }
  else if(c.categoryName){ csvReview.ready.push(c); }
  else {
    var gkey = normDescForDedup(c.description);
    var g = csvReview.groups.find(function(x){ return x.key===gkey; });
    if(g) g.items.push(c);
    else csvReview.groups.push({ key:gkey, items:[c] });
  }
  renderCsvReview();
}

/* Feeds every included candidate into bulkRows + submitBulk() (bulk expense
   logging's own machinery) instead of a bespoke insert -- the actual write
   goes through _dbInsertTxn() -> fhField()/_fhWriteLocked(), same as any
   other expense, so this doesn't need to re-derive encryption correctness.
   Only ready[] promotes: groups/duplicates dissolve into it as they resolve. */
function csvPromote(){
  if(!csvReview || !csvReview.ready.length) return;
  bulkRows = csvReview.ready.map(function(c){
    return { note: c.description, amt: String(Math.round(c.amount)), cat: c.categoryName, who: lastWho, date: c.dateDisplay, _invalid: false };
  });
  bulkActive = 0;
  exPhotos = [];
  buildExCatChips();   // adopted-from-file categories must exist as chips before loadRow() selects them
  renderBulk();
  loadRow(0);
  submitBulk();
}
