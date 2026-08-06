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
  if(out) out.innerHTML='<div class="sheet-sub">'+L('Đang phân tích…','Analyzing…')+'</div>';

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

// Collapsed, read-only card: matches renderBulk()'s non-active card shape --
// bulk-head + summary inside .bulk-tap, .bulk-x as a sibling after it.
function csvCollapsedCard(label, description, amount, categoryName, removeFn){
  return '<div class="bulk-card"><button type="button" class="bulk-tap">'
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
      + '<div class="notice-text">'+L('File này có cả số dương và âm trong cột số tiền — có thể lẫn cả thu lẫn chi. Tụi mình chưa tự động phân biệt được, nên mọi giao dịch đều chuyển vào mục xem sau để bạn tự kiểm tra.','This file mixes positive and negative amounts — possibly income and expenses together. We can\'t reliably tell them apart yet, so every row is set aside for you to check.')+'</div></div>';
  }

  html += '<div class="review-summary">'+esc(L(total+' giao dịch tìm thấy', total+' transactions found'))+'</div>';
  html += '<div id="bulk-list">';

  r.ready.forEach(function(c, i){
    html += csvCollapsedCard(c.dateDisplay || c.description, c.description, c.amount, c.categoryName, 'csvRemoveReady('+i+')');
  });

  r.groups.forEach(function(g, gi){
    if(g.skipped) return;
    if(g.catName){
      var sum = g.items.reduce(function(s,it){return s+it.amount;},0);
      html += csvCollapsedCard(g.items[0].description+' · '+g.items.length+' '+L('giao dịch','txns'), g.items[0].description, sum, g.catName, 'csvSkipGroup('+gi+')');
      return;
    }
    var chips = (window.catOrder||[]).map(function(name){ return csvCatChip(name, 'csvPickGroupCategory('+gi+',\''+escAttr(name)+'\')', false); }).join('');
    html += '<div class="bulk-card active"><div class="bulk-head"><span class="bulk-idx">'+esc(g.items[0].description)+' · '+g.items.length+' '+L('giao dịch','txns')+'</span>'
      + '<button type="button" class="bulk-x" onclick="csvSkipGroup('+gi+')" aria-label="'+L('Bỏ nhóm này','Remove')+'">✕</button></div>'
      + '<div class="bulk-body"><div class="field-label-mini">'+L('Chọn danh mục','Pick a category')+'</div><div class="choices">'+chips+'</div></div></div>';
  });

  r.dup.forEach(function(d, di){
    if(d.resolved==='skip') return;
    var existingLine = d.c.duplicateOfExisting
      ? L('Trùng với một giao dịch đã có trong sổ, cùng số tiền, trong vòng 3 ngày.','Matches a transaction already in your ledger, same amount, within 3 days.')
      : L('Xuất hiện 2 lần trong file này với cùng nội dung và số tiền.','Appears twice in this file with the same description and amount.');
    if(d.resolved==='include' && d.c.categoryName){
      html += csvCollapsedCard(d.c.dateDisplay || d.c.description, d.c.description, d.c.amount, d.c.categoryName, 'csvDuplicateSkip('+di+')');
      return;
    }
    if(d.resolved==='include'){
      // Included, but this row's source category never matched a real one --
      // same situation as a needs-category group, just for a single row, so
      // it gets the same picker instead of silently blocking submitBulk()'s
      // own validation later with no clue which row was the problem.
      var dchips = (window.catOrder||[]).map(function(name){ return csvCatChip(name, 'csvPickDuplicateCategory('+di+',\''+escAttr(name)+'\')', false); }).join('');
      html += '<div class="bulk-card active"><div class="bulk-head"><span class="bulk-idx">'+esc(d.c.description)+'</span>'
        + '<button type="button" class="bulk-x" onclick="csvDuplicateSkip('+di+')" aria-label="'+L('Bỏ khoản này','Remove')+'">✕</button></div>'
        + '<div class="bulk-body"><div class="field-label-mini">'+L('Chọn danh mục','Pick a category')+'</div><div class="choices">'+dchips+'</div></div></div>';
      return;
    }
    html += '<div class="bulk-card active"><div class="bulk-head"><span class="bulk-idx">'+esc(d.c.description)+' · -'+esc(String(Math.round(d.c.amount)))+'</span></div>'
      + '<div class="bulk-body"><div class="dup-note">'+existingLine+'</div><div class="dup-actions">'
      + '<button type="button" class="btn-line" onclick="csvDuplicateInclude('+di+')">'+L('Vẫn nhập','Import anyway')+'</button>'
      + '<button type="button" class="btn-text-quiet" onclick="csvDuplicateSkip('+di+')">'+L('Bỏ qua','Skip')+'</button>'
      + '</div></div></div>';
  });

  html += '</div>';

  if(r.deferred.length){
    html += '<div class="group-h defer">'+L('Cần xem lại sau','Set aside for later')+'</div><div id="bulk-list">';
    r.deferred.forEach(function(c){
      var why = c.flags.indexOf('date_missing')>=0 ? L('thiếu ngày','missing date')
        : c.flags.indexOf('amount_missing')>=0 ? L('không đọc được số tiền','unreadable amount')
        : r.mixedSignsNote ? L('có thể là thu nhập','possibly income') : L('cần kiểm tra','needs a look');
      html += '<div class="bulk-card defer-card"><div class="bulk-tap"><span class="bulk-head"><span class="bulk-idx">'+esc(why)+'</span></span>'
        + csvCardSummary(c.description||c.raw.join(', '), c.amount, null) + '</div></div>';
    });
    html += '</div>';
  }

  var n = csvIncludedCount();
  html += '<div class="cta-wrap"><button class="cta" onclick="csvPromote()"'+(n===0?' disabled style="opacity:.5"':'')+'>'+esc(L('Nhập '+n+' giao dịch','Import '+n+' transactions'))+'</button></div>';

  out.innerHTML = html;
}

function csvRemoveReady(i){ csvReview.ready.splice(i,1); renderCsvReview(); }
function csvPickGroupCategory(gi, name){ csvReview.groups[gi].catName = name; renderCsvReview(); }
function csvSkipGroup(gi){ csvReview.groups[gi].skipped = true; renderCsvReview(); }
function csvDuplicateInclude(di){ csvReview.dup[di].resolved = 'include'; renderCsvReview(); }
function csvDuplicateSkip(di){ csvReview.dup[di].resolved = 'skip'; renderCsvReview(); }
function csvPickDuplicateCategory(di, name){ csvReview.dup[di].c.categoryName = name; renderCsvReview(); }

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
