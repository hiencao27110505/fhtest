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
      var candidates = buildCsvCandidates(parsed, result);
      var mixed = csvColumnHasMixedSigns(candidates);
      var buckets = bucketCsvCandidates(candidates, mixed);
      csvReview = {
        ready: buckets.ready,
        groups: Object.keys(buckets.needsCategoryGroups).map(function(k){ return { key:k, items:buckets.needsCategoryGroups[k] }; }),
        dup: buckets.possibleDuplicate.map(function(c){ return { c:c, resolved:null }; }), // null | 'skip' | 'done' (moved to ready)
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

function csvIncludedCount(){ return csvReview ? csvReview.ready.length : 0; }

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

/* ---- category sheet: ONE picker for every case ---------------------------- */
function csvOpenCatSheet(type, idx){
  csvPickTarget = { type:type, idx:idx };
  var cur=null, subject='', removeLbl='';
  if(type==='ready'){ var c=csvReview.ready[idx]; cur=c.categoryName; subject=c.description; removeLbl=L('Bỏ khoản này','Don\'t import this one'); }
  else if(type==='group'){ var g=csvReview.groups[idx]; subject=g.items[0].description+(g.items.length>1?' · '+g.items.length+' '+L('giao dịch','txns'):''); removeLbl=L('Bỏ nhóm này','Don\'t import these'); }
  else { var d=csvReview.dup[idx]; cur=d.c.categoryName; subject=d.c.description; removeLbl=L('Bỏ khoản này','Don\'t import this one'); }
  setTxt('csvcat-h', L('Chọn danh mục','Pick a category'));
  setTxt('csvcat-sub', subject);
  var list=document.getElementById('csvcat-list');
  if(list) list.innerHTML = (window.catOrder||[]).map(function(name){
    var s=(window.catStyle&&window.catStyle[name])||['🏷️'];
    return '<button class="choice'+(name===cur?' on':'')+'" onclick="csvCatSheetPick(\''+escAttr(name)+'\')">'+s[0]+' '+esc(name)+'</button>';
  }).join('');
  var rm=document.getElementById('csvcat-remove'); if(rm) rm.textContent=removeLbl;
  openSheet('sheet-csvcat');
}

function csvCatSheetPick(name){
  var t=csvPickTarget; if(!t||!csvReview) return;
  if(t.type==='ready'){
    var c=csvReview.ready[t.idx]; if(c){ c.categoryName=name; c.catSource='user'; }
  } else if(t.type==='group'){
    var g=csvReview.groups.splice(t.idx,1)[0];
    if(g) g.items.forEach(function(c){ c.categoryName=name; c.catSource='user'; csvReview.ready.push(c); });
  } else {
    var d=csvReview.dup[t.idx];
    if(d){ d.c.categoryName=name; d.c.catSource='user'; d.resolved='done'; csvReview.ready.push(d.c); }
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
  renderBulk();
  loadRow(0);
  submitBulk();
}
