/* ---- CSV import: pick a file, review, promote into the real ledger --------
   Parse (44-csv-parse.js) -> map columns (45-csv-import.js, masked via
   43-redact-for-sharing.js for encrypted families) -> build + bucket
   candidates (57-csv-import-review.js) -> this file renders the review and
   promotes approved rows by feeding bulkRows into the existing submitBulk()
   machinery (50-sheets-expense-capture.js) rather than a bespoke insert --
   inherits fhField()/_fhWriteLocked() correctness for free. Expense-only
   this pass: transactions has no direction column, income lives in a
   separate table this doesn't write to (see 57's header comment). */
var csvReview = null; // { ready, groups: {key:{items,catName}}, dup, deferred }

function openCsvImport(){
  var input=document.getElementById('csv-file-input'); if(input) input.value='';
  var out=document.getElementById('csv-result'); if(out) out.innerHTML='';
  csvReview = null;
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
      var candidates = buildCsvCandidates(parsed, result);
      var mixed = csvColumnHasMixedSigns(candidates);
      var buckets = bucketCsvCandidates(candidates, mixed);
      csvReview = {
        ready: buckets.ready,
        groups: Object.keys(buckets.needsCategoryGroups).map(function(k){ return { key:k, items:buckets.needsCategoryGroups[k], catName:null, skipped:false }; }),
        dup: buckets.possibleDuplicate.map(function(c){ return { c:c, resolved:null }; }), // resolved: null | 'include' | 'skip'
        deferred: buckets.deferred,
        mixedSignsNote: mixed,
        editingReady: null,
      };
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

function csvIncludedCount(){
  if(!csvReview) return 0;
  var n = csvReview.ready.length;
  csvReview.groups.forEach(function(g){ if(g.catName && !g.skipped) n += g.items.length; });
  csvReview.dup.forEach(function(d){ if(d.resolved==='include' && d.c.categoryName) n += 1; });
  return n;
}

function csvCatChip(name, onclick, selected){
  var s = (window.catStyle && window.catStyle[name]) || ['🏷️'];
  return '<button type="button" class="choice'+(selected?' on':'')+'" onclick="'+onclick+'">'+s[0]+' '+esc(name)+'</button>';
}

/* Reuses the real bulkSummary() (50-sheets-expense-capture.js) instead of a
   parallel reimplementation -- same note/amount/category markup the actual
   bulk-logging cards use, so this can't quietly drift out of sync with that
   component the way an earlier version of this file already did once. */
function csvCardSummary(description, amount, categoryName){
  return bulkSummary({ note: description, amt: amount != null ? String(Math.round(amount)) : '', cat: categoryName || '' });
}

// Collapsed card: matches renderBulk()'s non-active card shape -- bulk-head +
// summary inside .bulk-tap, .bulk-x as a sibling after it. tapFn (optional)
// makes the card body tappable, e.g. to correct a guessed category.
function csvCollapsedCard(label, description, amount, categoryName, removeFn, tapFn){
  return '<div class="bulk-card"><button type="button" class="bulk-tap"'+(tapFn?' onclick="'+tapFn+'"':'')+'>'
    + '<span class="bulk-head"><span class="bulk-idx">'+esc(label)+'</span></span>'
    + csvCardSummary(description, amount, categoryName)
    + '</button><button type="button" class="bulk-x" onclick="'+removeFn+'" aria-label="'+L('Bỏ khoản này','Remove')+'">✕</button></div>';
}

function renderCsvReview(){
  var out=document.getElementById('csv-result'); if(!out || !csvReview) return;
  var r = csvReview;
  var total = r.ready.length + r.groups.reduce(function(n,g){return n+g.items.length;},0) + r.dup.length + r.deferred.length;

  var html = '';

  if(r.mixedSignsNote){
    html += '<div class="notice-card"><svg class="notice-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16h.01"/></svg>'
      + '<div class="notice-text">'+L('File này có cả số dương và âm trong cột số tiền — có thể lẫn cả thu lẫn chi, nên tụi mình không tự nhập khoản nào. Khoản nào đúng là khoản chi, bạn bấm “Đây là khoản chi” để đưa vào.','This file mixes positive and negative amounts — possibly income and expenses together, so nothing was imported automatically. For any row that really is an expense, tap “This is an expense” to bring it in.')+'</div></div>';
  }

  /* Two lists, decisions FIRST: on a 100-row file where 95 sorted themselves,
     the 5 that need a human must not be buried under the 95 that don't. The
     ready list below is a scannable receipt of what the guessing already did,
     not a to-do. */
  var decisionsHtml = '', readyHtml = '';

  r.ready.forEach(function(c, i){
    if(r.editingReady === i){
      // Correcting a guessed category: same picker card a needs-category
      // group gets, with the current guess pre-selected.
      var echips = (window.catOrder||[]).map(function(name){ return csvCatChip(name, 'csvSetReadyCategory('+i+',\''+escAttr(name)+'\')', name===c.categoryName); }).join('');
      readyHtml += '<div class="bulk-card active"><div class="bulk-head"><span class="bulk-idx">'+esc(c.description)+'</span>'
        + '<button type="button" class="bulk-x" onclick="csvRemoveReady('+i+')" aria-label="'+L('Bỏ khoản này','Remove')+'">✕</button></div>'
        + '<div class="bulk-body"><div class="field-label-mini">'+L('Chọn danh mục','Pick a category')+'</div><div class="choices">'+echips+'</div></div></div>';
      return;
    }
    readyHtml += csvCollapsedCard(c.dateDisplay || c.description, c.description, c.amount, c.categoryName, 'csvRemoveReady('+i+')', 'csvEditReady('+i+')');
  });

  r.groups.forEach(function(g, gi){
    if(g.skipped) return;
    if(g.catName){
      var sum = g.items.reduce(function(s,it){return s+it.amount;},0);
      readyHtml += csvCollapsedCard(g.items[0].description+' · '+g.items.length+' '+L('giao dịch','txn'+(g.items.length===1?'':'s')), g.items[0].description, sum, g.catName, 'csvSkipGroup('+gi+')', 'csvUngroupCategory('+gi+')');
      return;
    }
    var chips = (window.catOrder||[]).map(function(name){ return csvCatChip(name, 'csvPickGroupCategory('+gi+',\''+escAttr(name)+'\')', false); }).join('');
    decisionsHtml += '<div class="bulk-card active"><div class="bulk-head"><span class="bulk-idx">'+esc(g.items[0].description)+' · '+g.items.length+' '+L('giao dịch','txn'+(g.items.length===1?'':'s'))+'</span>'
      + '<button type="button" class="bulk-x" onclick="csvSkipGroup('+gi+')" aria-label="'+L('Bỏ nhóm này','Remove')+'">✕</button></div>'
      + '<div class="bulk-body"><div class="field-label-mini">'+L('Chọn danh mục','Pick a category')+'</div><div class="choices">'+chips+'</div></div></div>';
  });

  r.dup.forEach(function(d, di){
    if(d.resolved==='skip') return;
    var existingLine = d.c.duplicateOfExisting
      ? L('Trùng với một giao dịch đã có trong sổ, cùng số tiền, trong vòng 3 ngày.','Matches a transaction already in your ledger, same amount, within 3 days.')
      : L('Xuất hiện 2 lần trong file này với cùng nội dung và số tiền.','Appears twice in this file with the same description and amount.');
    if(d.resolved==='include' && d.c.categoryName){
      readyHtml += csvCollapsedCard(d.c.dateDisplay || d.c.description, d.c.description, d.c.amount, d.c.categoryName, 'csvDuplicateSkip('+di+')');
      return;
    }
    if(d.resolved==='include'){
      // Included, but this row's source category never matched a real one --
      // same situation as a needs-category group, just for a single row, so
      // it gets the same picker instead of silently blocking submitBulk()'s
      // own validation later with no clue which row was the problem.
      var dchips = (window.catOrder||[]).map(function(name){ return csvCatChip(name, 'csvPickDuplicateCategory('+di+',\''+escAttr(name)+'\')', false); }).join('');
      decisionsHtml += '<div class="bulk-card active"><div class="bulk-head"><span class="bulk-idx">'+esc(d.c.description)+'</span>'
        + '<button type="button" class="bulk-x" onclick="csvDuplicateSkip('+di+')" aria-label="'+L('Bỏ khoản này','Remove')+'">✕</button></div>'
        + '<div class="bulk-body"><div class="field-label-mini">'+L('Chọn danh mục','Pick a category')+'</div><div class="choices">'+dchips+'</div></div></div>';
      return;
    }
    decisionsHtml += '<div class="bulk-card active"><div class="bulk-head"><span class="bulk-idx">'+esc(d.c.description)+' · -'+esc(String(Math.round(d.c.amount)))+'</span></div>'
      + '<div class="bulk-body"><div class="dup-note">'+existingLine+'</div><div class="dup-actions">'
      + '<button type="button" class="btn-line" onclick="csvDuplicateInclude('+di+')">'+L('Vẫn nhập','Import anyway')+'</button>'
      + '<button type="button" class="btn-text-quiet" onclick="csvDuplicateSkip('+di+')">'+L('Bỏ qua','Skip')+'</button>'
      + '</div></div></div>';
  });

  // Lead with the win, not the workload. The summary is the "magic moment"
  // line: most of the file sorted itself; here's the little that didn't.
  var readyCount = csvIncludedCount();
  var decisionCount = (decisionsHtml.match(/bulk-card active/g)||[]).length;
  var summaryLine;
  if(r.mixedSignsNote) summaryLine = esc(L(total+' giao dịch tìm thấy', total+' transactions found'));
  else if(decisionCount===0 && readyCount>0) summaryLine = esc(L('✨ Cả '+readyCount+' khoản đã xếp xong — lướt qua rồi nhập thôi','✨ All '+readyCount+' sorted — skim and import'));
  else if(readyCount>0) summaryLine = esc(L('✨ Đã tự xếp '+readyCount+' khoản — chỉ còn '+decisionCount+' cần bạn xem','✨ '+readyCount+' sorted automatically — just '+decisionCount+(decisionCount===1?' needs':' need')+' your eye'));
  else summaryLine = esc(L(total+' giao dịch tìm thấy', total+' transactions found'));
  html += '<div class="review-summary">'+summaryLine+'</div>';

  if(decisionsHtml){
    html += '<div class="group-h">'+L('Cần bạn xem','Needs your eye')+'</div><div class="csv-list">'+decisionsHtml+'</div>';
  }
  if(readyHtml){
    html += '<div class="group-h">'+L('Sẵn sàng','Ready')+' · '+readyCount+'</div><div class="csv-list">'+readyHtml+'</div>';
  }

  if(r.deferred.length){
    html += '<div class="group-h defer">'+L('Cần xem lại','Needs your look')+'</div><div class="csv-list">';
    r.deferred.forEach(function(c, di){
      // A row is only stuck for real when its date or amount is unreadable.
      // A row deferred purely on the mixed-signs suspicion has everything a
      // valid expense needs -- the user can confirm it with one tap instead
      // of hitting a dead end with no action at all.
      var rescuable = c.date && c.amount !== null
        && c.flags.indexOf('date_missing')<0 && c.flags.indexOf('amount_missing')<0;
      var why = c.flags.indexOf('date_missing')>=0 ? L('thiếu ngày','missing date')
        : c.flags.indexOf('amount_missing')>=0 ? L('không đọc được số tiền','unreadable amount')
        : L('có thể là thu nhập','possibly income');
      // bc-pick ("Pick a category") is deliberately suppressed here -- these
      // cards have no category picker, so bulkSummary()'s badge would dangle.
      var summary = '<span class="bc-note">'+esc(c.description||c.raw.join(', '))+'</span>'
        + '<span class="bc-meta">'+(c.amount!=null?'<span class="bc-amt">'+fmt(c.amount)+'</span>':'')+'</span>';
      if(rescuable){
        html += '<div class="bulk-card active"><div class="bulk-head"><span class="bulk-idx">'+esc(why)+'</span></div>'
          + '<div class="bulk-body">'+summary
          + '<div class="dup-actions" style="margin-top:10px"><button type="button" class="btn-line" onclick="csvRescueDeferred('+di+')">'+L('Đây là khoản chi — nhập','This is an expense — import')+'</button></div>'
          + '</div></div>';
      } else {
        html += '<div class="bulk-card defer-card"><div class="bulk-tap"><span class="bulk-head"><span class="bulk-idx">'+esc(why)+'</span></span>'+summary+'</div></div>';
      }
    });
    html += '</div>';
  }

  var n = csvIncludedCount();
  html += '<div class="cta-wrap"><button class="cta" onclick="csvPromote()"'+(n===0?' disabled style="opacity:.5"':'')+'>'+esc(L('Nhập '+n+' giao dịch','Import '+n+' transactions'))+'</button></div>';

  out.innerHTML = html;
}

function csvRemoveReady(i){ csvReview.ready.splice(i,1); csvReview.editingReady = null; renderCsvReview(); }
function csvEditReady(i){ csvReview.editingReady = i; renderCsvReview(); }
function csvSetReadyCategory(i, name){ csvReview.ready[i].categoryName = name; csvReview.ready[i].catSource = 'user'; csvReview.editingReady = null; renderCsvReview(); }
function csvPickGroupCategory(gi, name){ csvReview.groups[gi].catName = name; renderCsvReview(); }
function csvSkipGroup(gi){ csvReview.groups[gi].skipped = true; renderCsvReview(); }
function csvUngroupCategory(gi){ csvReview.groups[gi].catName = null; renderCsvReview(); }
function csvDuplicateInclude(di){ csvReview.dup[di].resolved = 'include'; renderCsvReview(); }
function csvDuplicateSkip(di){ csvReview.dup[di].resolved = 'skip'; renderCsvReview(); }
function csvPickDuplicateCategory(di, name){ csvReview.dup[di].c.categoryName = name; renderCsvReview(); }

/* User confirmed a mixed-signs-deferred row really is an expense. It re-enters
   the normal flow -- INCLUDING the dedup checks, which the mixed-signs early
   exit in bucketCsvCandidates() skipped for the whole file, so a rescued row
   must not bypass them now. */
function csvRescueDeferred(di){
  var c = csvReview.deferred.splice(di,1)[0]; if(!c) return;

  // within-review duplicate: same description+amount as anything already included
  var key = normDescForDedup(c.description)+'|'+c.amount;
  var already = csvReview.ready.some(function(x){ return normDescForDedup(x.description)+'|'+x.amount === key; })
    || csvReview.groups.some(function(g){ return !g.skipped && g.items.some(function(x){ return normDescForDedup(x.description)+'|'+x.amount === key; }); });
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
    var g = csvReview.groups.find(function(x){ return x.key===gkey && !x.skipped; });
    if(g) g.items.push(c);
    else csvReview.groups.push({ key:gkey, items:[c], catName:null, skipped:false });
  }
  renderCsvReview();
}

/* Feeds every included candidate into bulkRows + submitBulk() (bulk expense
   logging's own machinery) instead of a bespoke insert -- the actual write
   goes through _dbInsertTxn() -> fhField()/_fhWriteLocked(), same as any
   other expense, so this doesn't need to re-derive encryption correctness. */
function csvPromote(){
  if(!csvReview) return;
  var included = csvReview.ready.slice();
  csvReview.groups.forEach(function(g){ if(g.catName && !g.skipped) g.items.forEach(function(c){ c.categoryName = g.catName; included.push(c); }); });
  csvReview.dup.forEach(function(d){ if(d.resolved==='include' && d.c.categoryName) included.push(d.c); });
  if(!included.length) return;

  bulkRows = included.map(function(c){
    return { note: c.description, amt: String(Math.round(c.amount)), cat: c.categoryName, who: lastWho, date: c.dateDisplay, _invalid: false };
  });
  bulkActive = 0;
  exPhotos = [];
  renderBulk();
  loadRow(0);
  submitBulk();
}
