/* ---- CSV import: pick a file, review, promote into the real ledger --------
   Parse (44-csv-parse.js) -> map columns (45-csv-import.js, masked via
   43-redact-for-sharing.js for encrypted families) -> build + bucket
   candidates (57-csv-import-review.js) -> this file renders the review and
   promotes approved rows by feeding bulkRows into the existing submitBulk()
   machinery (50-sheets-expense-capture.js) rather than a bespoke insert --
   inherits fhField()/_fhWriteLocked() correctness for free. Expense-only
   this pass: transactions has no direction column, income lives in a
   separate table this doesn't write to (see 57's header comment).

   Interaction model: dense .rows lists (same component as the Finance tab),
   with INLINE expansion -- tapping a row unfolds its editor in place, like
   bulk logging's accordion, so browsing and correcting stay on one surface.
   Everything needing attention (unresolved categories, duplicates, rescuable
   and stuck rows) sits in ONE section on top, rows carrying an amber accent;
   the ready list follows, grouped by date. One row expands at a time; a
   ready row's field edits flush when switching rows, same as bulk logging.
   A trust strip above Import answers "is this right?" before anything
   writes: count, total, date span, rows read, and what's being left out. */
var csvReview = null;   // { parsed, mapResult, ready[], groups[], dup[], deferred[], mixedSignsNote, fileCats[] }
var csvExpand = null;   // { kind:'ready'|'group'|'dup'|'defer', idx } -- the one open row

function openCsvImport(){
  var input=document.getElementById('csv-file-input'); if(input) input.value='';
  var out=document.getElementById('csv-result'); if(out) out.innerHTML='';
  csvReview = null; csvExpand = null;
  var pick=document.getElementById('csv-pick'); if(pick) pick.style.display='';
  var save=document.getElementById('csv-save'); if(save){ save.disabled=true; save.textContent=L('Nhập','Import'); }
  openSheet('csv-import-modal');
}

// Back to the picker without closing the modal (the quiet escape under the review).
function csvPickAnother(){
  var input=document.getElementById('csv-file-input'); if(input) input.value='';
  var out=document.getElementById('csv-result'); if(out) out.innerHTML='';
  csvReview = null; csvExpand = null;
  var pick=document.getElementById('csv-pick'); if(pick) pick.style.display='';
  var save=document.getElementById('csv-save'); if(save){ save.disabled=true; save.textContent=L('Nhập','Import'); }
}

function onCsvFileSelected(input){
  var file=input.files && input.files[0]; if(!file) return;
  var out=document.getElementById('csv-result');
  /* .xlsx is read natively (42-xlsx-parse.js). The other spreadsheet formats
     are different beasts -- .xls is old binary BIFF, .numbers and .ods are
     their own zip layouts -- so name the one-step fix instead of failing with
     "couldn't read this file", which tells the user nothing. */
  if(/\.(xls|numbers|ods)$/i.test(file.name)){
    if(out) out.innerHTML='<div class="sheet-sub">'+L('Tụi mình đọc được file CSV và Excel (.xlsx). Với định dạng này, bạn mở ra rồi chọn File → Lưu dưới dạng (Save as) → CSV hoặc .xlsx nhé.','We can read CSV and Excel (.xlsx) files. For this format, open it and choose File → Save As → CSV or .xlsx.')+'</div>';
    input.value='';
    return;
  }
  if(/\.xlsx$/i.test(file.name)){
    if(!(window.fhXlsxSupported && window.fhXlsxSupported())){
      if(out) out.innerHTML='<div class="sheet-sub">'+L('Trình duyệt này chưa đọc được file Excel. Bạn lưu thành CSV rồi tải lại giúp nhé.','This browser can\'t open Excel files yet. Save it as CSV and try again.')+'</div>';
      input.value='';
      return;
    }
    if(out) out.innerHTML='<div class="sheet-sub csv-reading">'+L('✨ Đang đọc file của bạn…','✨ Reading your file…')+'</div>';
    window.fhParseXlsxFile(file).then(function(parsed){
      if(!parsed || !parsed.headers.length){
        if(out) out.innerHTML='<div class="sheet-sub">'+L('Sheet đầu tiên trong file này trống.','The first sheet in this file is empty.')+'</div>';
        return;
      }
      return csvResolveAndRender(parsed, out);
    }).catch(function(e){
      if(out) out.innerHTML='<div class="sheet-sub">'+L('Không đọc được file Excel này. Bạn thử lưu thành CSV giúp nhé.','Couldn\'t read this Excel file. Try saving it as CSV instead.')+'</div>';
    });
    return;
  }
  if(out) out.innerHTML='<div class="sheet-sub csv-reading">'+L('✨ Đang đọc file của bạn…','✨ Reading your file…')+'</div>';

  var reader=new FileReader();
  reader.onload=function(){
    var parsed = window.fhParseCsvFile ? window.fhParseCsvFile(reader.result) : null;
    if(!parsed || !parsed.headers.length){
      if(out) out.innerHTML='<div class="sheet-sub">'+L('Không đọc được file này.','Could not read this file.')+'</div>';
      return;
    }
    csvResolveAndRender(parsed, out);
  };
  reader.onerror=function(){
    if(out) out.innerHTML='<div class="sheet-sub">'+L('Không đọc được file này.','Could not read this file.')+'</div>';
  };
  reader.readAsText(file,'utf-8');
}

/* Shared tail for both readers: once a file is {headers, rows}, CSV and xlsx
   are indistinguishable from here on -- same column mapping, same review. */
function csvResolveAndRender(parsed, out){
  return window.fhResolveCsvMapping(parsed.headers, parsed.rows).then(function(result){
    csvBuildReview(parsed, result);
    renderCsvReview();
  }).catch(function(e){
    if(out) out.innerHTML='<div class="sheet-sub">'+L('Có lỗi khi phân tích file: ','Something went wrong analyzing this file: ')+esc(String((e&&e.message)||e))+'</div>';
  });
}

function csvIncludedCount(){ return csvReview ? csvReview.ready.length : 0; }

/* Builds (or REbuilds) the whole review state from the parsed file + resolved
   mapping, which stay stored so category adoption can re-run categorization
   from scratch.

   The file's category names ARE the family's own naming -- carried over from
   whatever they used before -- so any name we don't have is adopted
   AUTOMATICALLY rather than offered: for a family whose only categories are
   the seeded defaults, being asked to map their own history onto our words is
   a question with one sensible answer. It's disclosed (never silent) and
   undoable, which is what keeps auto-adoption honest rather than presumptuous.
   opts.declined re-runs without adopting, after an undo. */
function csvBuildReview(parsed, result, opts){
  opts = opts || {};
  csvCatMerges = {}; csvCatAmbiguous = {};  // recomputed every build
  csvFuzzyCats = !opts.declined;           // undo also turns off name-merging
  var candidates = buildCsvCandidates(parsed, result);
  var unknown = csvUnknownFileCategories(candidates);
  var adopted = [];

  if(unknown.length && !opts.declined){
    adopted = csvAdoptCategories(unknown);
    if(adopted.length){                       // re-categorize against the now-richer list
      candidates = buildCsvCandidates(parsed, result);
      unknown = csvUnknownFileCategories(candidates);
    }
  }

  var mixed = csvColumnHasMixedSigns(candidates);
  var buckets = bucketCsvCandidates(candidates, mixed);
  csvReview = {
    parsed: parsed, mapResult: result,
    ready: buckets.ready,
    groups: Object.keys(buckets.needsCategoryGroups).map(function(k){ return { key:k, items:buckets.needsCategoryGroups[k] }; }),
    dup: buckets.possibleDuplicate.map(function(c){ return { c:c, resolved:null }; }), // null | 'skip' | 'done' (moved on)
    deferred: buckets.deferred,
    mixedSignsNote: mixed,
    fileCats: unknown,        // still-unknown names (only non-empty after an undo)
    adoptedCats: adopted,     // what we added this build, for the disclosure + undo
    catMerges: Object.keys(csvCatMerges).map(function(k){ return { from:k, to:csvCatMerges[k] }; }),
    fallbackCount: buckets.ready.filter(function(c){ return c.catSource === 'fallback'; }).length,
    declinedAdopt: !!opts.declined,
  };
  csvExpand = null;
}

/* Adds category names to the family's client-side list (DB rows are created
   lazily at promote time by _categoryIdForName(), the same path any new
   category takes). Returns the names actually added. */
function csvAdoptCategories(names){
  var added = [];
  names.forEach(function(name){
    if(catValid(name)) return;
    catOrder.push(name);
    catStyle[name] = [csvCatEmoji(name)].concat(CATPAL[catOrder.length % CATPAL.length]);
    if(typeof catBudget !== 'undefined') catBudget[name] = catBudget[name] || 0;
    added.push(name);
  });
  return added;
}

/* Undo: drop the categories this import added and re-bucket without them.
   Safe because nothing has been written yet -- these exist only client-side
   until Import, and only names WE added this build are removed. */
function csvUndoAdopt(){
  // Also reachable when only MERGES happened (nothing was added) -- the undo
  // turns off name-merging too, so the guard can't require adoptedCats.
  if(!csvReview) return;
  (csvReview.adoptedCats||[]).forEach(function(name){
    var i = catOrder.indexOf(name);
    if(i >= 0) catOrder.splice(i, 1);
    delete catStyle[name];
    if(typeof catBudget !== 'undefined') delete catBudget[name];
  });
  csvBuildReview(csvReview.parsed, csvReview.mapResult, { declined:true });
  renderCsvReview();
}

// Re-adopt after an undo (the offer card's action).
function csvAdoptFileCategories(){
  if(!csvReview) return;
  csvBuildReview(csvReview.parsed, csvReview.mapResult);
  renderCsvReview();
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
    if(csvCatAmbiguous[deburr(g.toLowerCase())]) return;   // needs a human, not a new category
    var k = deburr(g.toLowerCase());
    var e = (seen[k] = seen[k] || {});
    e[g] = (e[g]||0) + 1;
  });
  return Object.keys(seen).map(function(k){
    var best = null;
    Object.keys(seen[k]).forEach(function(v){
      if(best===null){ best=v; return; }
      var vD = deburr(v)!==v, bD = deburr(best)!==best;
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

/* A file's amounts are DISPLAY currency (45000 in a cell means 45.000 d), but
   fmt() takes the STORED base and multiplies by curMult() -- 1000 for VND.
   csvBaseAmt does the display->base conversion the write path does, so what
   the review shows is exactly what will be saved, rounding included. */
function csvBaseAmt(n){ return Math.round(Number(n||0)/curMult()); }
function csvFmt(n){ return fmt(csvBaseAmt(n)); }
function csvAmtInputVal(n){ return Number(n).toLocaleString(CUR==='VND'?'vi-VN':'en-US'); }

/* EXACT bulk-logging card (renderBulk/bulkSummary, 50-sheets-expense-capture.js).
   Same markup, same classes, same summary function -- so the import review and
   the multi-expense composer are literally one component, and a change to that
   card lands here for free instead of drifting into a lookalike.

   Collapsed: .bulk-card > .bulk-tap(.bulk-head + summary) + .bulk-x
   Active:    .bulk-card.active > .bulk-head + the editor fields
   .invalid is the composer's own "this card isn't complete" red border. */

// A candidate rendered as one of the composer's row objects, so bulkSummary()
// produces byte-identical markup (bc-note / bc-amt / bc-cat / bc-pick / bc-dup).
function csvRowShape(c, isDup){
  return { note: c.description || '', amt: c.amount != null ? String(Math.round(c.amount)) : '',
           cat: c.categoryName || '', _dup: !!isDup };
}

function csvCardHead(label, dateIso, removeFn){
  return '<span class="bulk-head"><span class="bulk-idx">'+esc(label)+'</span>'
    + (dateIso ? '<span class="bulk-date">'+esc(bulkDate(dateIso))+'</span>' : '')
    + '</span>';
}

function csvCollapsedCard(c, opts){
  var rm = opts.removeFn ? '<button type="button" class="bulk-x" onclick="'+opts.removeFn+'" aria-label="'+L('Xoá khoản này','Remove this item')+'">✕</button>' : '';
  return '<div class="bulk-card'+(opts.invalid?' invalid':'')+'">'
    + '<button type="button" class="bulk-tap" onclick="'+opts.tapFn+'" aria-label="'+L('Sửa khoản này','Edit this item')+'">'
    + csvCardHead(opts.label, opts.dateIso) + bulkSummary(csvRowShape(c, opts.isDup))
    + '</button>' + rm + '</div>';
}

/* Active card: the composer's expanded shape, mounting the composer's OWN
   editor node (#ex-editor) via #ex-editor-mount -- the exact technique
   renderBulk() uses to move that single live editor between cards. Not a
   rebuild of the fields: the same inputs, the same category chips, the same
   who-paid chips, the same photo row, because it is the same DOM. Rebuilding
   them would have been a lookalike that drifts the first time that editor
   changes. */
function csvActiveCard(c, opts){
  var rm = opts.removeFn ? '<button type="button" class="bulk-x" onclick="'+opts.removeFn+'" aria-label="'+L('Xoá khoản này','Remove this item')+'">✕</button>' : '';
  var body = '';
  if(opts.note) body += '<div class="csv-expand-note">'+opts.note+'</div>';
  body += '<div id="ex-editor-mount"></div>';
  if(opts.buttons) body += '<div class="dup-actions" style="margin:4px 14px 14px">'+opts.buttons+'</div>';
  return '<div class="bulk-card active'+(opts.invalid?' invalid':'')+'">'
    + '<div class="bulk-head">'+csvCardHead(opts.label, opts.dateIso)+rm+'</div>'
    + body + '</div>';
}

/* Binds the mounted editor to one candidate by borrowing the composer's own
   row model: bulkRows becomes this single candidate, so every existing
   handler (pickExCat, pickExWho, onExInput, flushActiveRow) works untouched. */
function csvBindEditor(c){
  var editor = document.getElementById('ex-editor');
  var mount  = document.getElementById('ex-editor-mount');
  if(!editor || !mount) return;
  mount.appendChild(editor);
  bulkRows = [{ note: c.description || '', amt: c.amount != null ? csvAmtInputVal(c.amount) : '',
                cat: c.categoryName || '', who: c.who || lastWho,
                date: c.dateDisplay || isoDate(TODAY), _invalid:false }];
  bulkActive = 0;
  buildExCatChips();          // chips must exist before loadRow selects one
  loadRow(0);
  togglePhotoField(false);    // a CSV row has no photos to attach
}

// Reads the mounted editor back onto the candidate (the composer's own flush).
function csvReadEditor(c){
  if(!document.getElementById('ex-editor-mount') || !bulkRows.length) return;
  flushActiveRow();
  var r = bulkRows[0];
  if(r.note && r.note.trim()) c.description = r.note.trim();
  var a = window.classifyAmount ? window.classifyAmount(r.amt||'') : null;
  if(a && a.status==='ok' && a.value > 0) c.amount = a.value;
  if(r.date){ c.dateDisplay = r.date; c.date = new Date(r.date+'T00:00:00'); }
  if(r.cat && catValid(r.cat)){ c.categoryName = r.cat; c.catSource = 'user'; }
  if(r.who) c.who = r.who;
}

function csvIsOpen(kind, idx){ return csvExpand && csvExpand.kind===kind && csvExpand.idx===idx; }

function renderCsvReview(){
  var out=document.getElementById('csv-result'); if(!out || !csvReview) return;
  var r = csvReview;
  var unresolvedDup = r.dup.filter(function(d){return d.resolved===null;});
  var total = r.ready.length + r.groups.reduce(function(n,g){return n+g.items.length;},0)
    + unresolvedDup.length + r.deferred.length;

  var html = '';

  if(r.mixedSignsNote){
    html += '<div class="notice-card"><svg class="notice-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16h.01"/></svg>'
      + '<div class="notice-text">'+L('File này có cả số dương và âm trong cột số tiền — có thể lẫn cả thu lẫn chi, nên tụi mình không tự nhập khoản nào. Khoản nào đúng là khoản chi, bạn chạm vào để xác nhận.','This file mixes positive and negative amounts — possibly income and expenses together, so nothing was imported automatically. Tap any row that really is an expense to confirm it.')+'</div></div>';
  }

  /* Category disclosure. Default path: we already adopted the file's own
     names -- say so plainly, with an undo. After an undo it flips back to an
     offer, so the choice is never one-way. */
  var didMerge = (r.catMerges||[]).length, didAdd = (r.adoptedCats||[]).length;
  if(didMerge || didAdd || r.fallbackCount){
    var lines = [];
    if(didMerge) lines.push('<div class="notice-text">'
      + '<b>'+esc(L('Đã gộp vào danh mục sẵn có:','Merged into categories you already have:'))+'</b> '
      + esc(r.catMerges.map(function(m){ return '"'+m.from+'" → '+m.to; }).join(' · '))+'</div>');
    if(r.fallbackCount) lines.push('<div class="notice-text"'+((didMerge||didAdd)?' style="margin-top:6px"':'')+'>'
      + '<b>'+esc(L(r.fallbackCount+' khoản chưa rõ danh mục', r.fallbackCount+(r.fallbackCount===1?' row':' rows')+' had no clear category'))+'</b> '
      + esc(L('— tạm để ở "'+CAT_FALLBACK+'", chạm vào khoản để đổi.','— filed under "'+CAT_FALLBACK+'" for now; tap a row to change it.'))+'</div>');
    if(didAdd) lines.push('<div class="notice-text"'+(didMerge?' style="margin-top:6px"':'')+'>'
      + '<b>'+esc(L('Đã thêm danh mục mới từ file:','Added new categories from your file:'))+'</b> '
      + esc(r.adoptedCats.map(function(n){ return csvCatEmoji(n)+' '+n; }).join(' · '))+'</div>');
    html += '<div class="notice-card stack">' + lines.join('')
      + ((didMerge||didAdd) ? '<button type="button" class="btn-text-quiet" style="width:100%;margin:6px 0 0" onclick="csvUndoAdopt()">'+L('Để tôi tự chọn danh mục','Let me pick categories myself')+'</button>' : '')
      + '</div>';
  } else if(!r.mixedSignsNote && r.fileCats && r.fileCats.length){
    html += '<div class="notice-card stack">'
      + '<div class="notice-text"><b>'+esc(L('File này dùng '+r.fileCats.length+' danh mục bạn chưa có:','This file uses '+r.fileCats.length+(r.fileCats.length===1?' category':' categories')+' you don\'t have yet:'))+'</b> '
      + esc(r.fileCats.map(function(n){ return csvCatEmoji(n)+' '+n; }).join(' · '))+'</div>'
      + '<button type="button" class="btn-line" style="width:100%;margin:10px 0 0" onclick="csvAdoptFileCategories()">'+L('✨ Thêm và tự xếp giúp tôi','✨ Add them and sort for me')+'</button>'
      + '</div>';
  }

  /* ONE attention section, always on top: unresolved categories, duplicates,
     and every deferred row -- stuck ones included, fixable inline. Each is a
     bulk-card; .invalid gives them the composer's own incomplete-card border,
     and bulkSummary's bc-pick / bc-dup badges say why. */
  var attnHtml = '';
  r.groups.forEach(function(g, gi){
    var head = g.items[0].description + (g.items.length>1 ? ' · '+g.items.length+' '+L('khoản','items') : '');
    var proxy = { description:g.items[0].description, amount:g.items.reduce(function(s,it){return s+it.amount;},0), categoryName:null, dateDisplay:g.items[0].dateDisplay };
    var o = { label:head, dateIso:g.items[0].dateDisplay, invalid:true,
              tapFn:"csvToggleExpand('group',"+gi+")", removeFn:"csvSkipGroup("+gi+")" };
    attnHtml += csvIsOpen('group', gi)
      ? csvActiveCard(proxy, Object.assign({}, o, { instantChips:true }))
      : csvCollapsedCard(proxy, o);
  });
  r.dup.forEach(function(d, di){
    if(d.resolved!==null) return;
    var o = { label:L('Có thể trùng','Possible duplicate'), dateIso:d.c.dateDisplay, invalid:true, isDup:true,
              tapFn:"csvToggleExpand('dup',"+di+")", removeFn:"csvDupSkip("+di+")" };
    if(!csvIsOpen('dup', di)){ attnHtml += csvCollapsedCard(d.c, o); return; }
    var why = d.c.duplicateOfExisting
      ? L('Trùng với một giao dịch đã có trong sổ — cùng số tiền, trong vòng 3 ngày.','Matches a transaction already in your ledger — same amount, within 3 days.')
      : L('Xuất hiện 2 lần trong file này với cùng nội dung và số tiền.','Appears twice in this file with the same description and amount.');
    attnHtml += csvActiveCard(d.c, Object.assign({}, o, { fields:true, note:esc(why),
      buttons: '<button type="button" class="btn-line" onclick="csvDupInclude('+di+')">'+L('Vẫn nhập','Import anyway')+'</button>'
             + '<button type="button" class="btn-text-quiet" onclick="csvDupSkip('+di+')">'+L('Bỏ qua','Skip')+'</button>' }));
  });
  r.deferred.forEach(function(c, di){
    var why = c.flags.indexOf('date_missing')>=0 ? L('Thiếu ngày','Missing date')
      : c.flags.indexOf('amount_missing')>=0 ? L('Thiếu số tiền','Missing amount')
      : L('Có thể là thu nhập','Possibly income');
    var o = { label:why, dateIso:c.dateDisplay, invalid:true,
              tapFn:"csvToggleExpand('defer',"+di+")", removeFn:"csvDeferDrop("+di+")" };
    if(!csvIsOpen('defer', di)){ attnHtml += csvCollapsedCard(c, o); return; }
    attnHtml += csvActiveCard(c, Object.assign({}, o, { fields:true,
      note: (c.flags.indexOf('date_missing')<0 && c.flags.indexOf('amount_missing')<0)
        ? esc(L('File này có thể lẫn thu nhập. Nếu đây đúng là khoản chi, kiểm tra rồi bấm Nhập khoản này.','This file may mix in income. If this really is an expense, check it over and tap Import this one.')) : null,
      buttons: '<button type="button" class="btn-line" onclick="csvDeferConfirm('+di+')">'+L('Nhập khoản này','Import this one')+'</button>'
             + '<button type="button" class="btn-text-quiet" onclick="csvDeferDrop('+di+')">'+L('Bỏ qua','Skip')+'</button>' }));
  });
  var decisionCount = r.groups.length + unresolvedDup.length + r.deferred.length;

  // Lead with the win, not the workload.
  var readyCount = r.ready.length;
  var summaryLine;
  if(r.mixedSignsNote) summaryLine = esc(L(total+' giao dịch tìm thấy', total+' transactions found'));
  else if(decisionCount===0 && readyCount>0) summaryLine = esc(L('✨ Cả '+readyCount+' khoản đã xếp xong — lướt qua rồi nhập thôi','✨ All '+readyCount+' sorted — skim and import'));
  else if(readyCount>0) summaryLine = esc(L('✨ Đã tự xếp '+readyCount+' khoản — chỉ còn '+decisionCount+' cần bạn xem','✨ '+readyCount+' sorted automatically — just '+decisionCount+(decisionCount===1?' needs':' need')+' your eye'));
  else summaryLine = esc(L(total+' giao dịch tìm thấy', total+' transactions found'));
  html += '<div class="review-summary">'+summaryLine+'</div>';

  if(attnHtml){
    html += '<div class="group-h">'+L('Cần bạn xem','Needs your eye')+'</div><div class="csv-cards">'+attnHtml+'</div>';
  }

  /* Ready list, grouped by date (newest first) -- same cards, no red border. */
  if(r.ready.length){
    var dateBuckets = {};
    r.ready.forEach(function(c, i){ var k = c.dateDisplay || ''; (dateBuckets[k] = dateBuckets[k] || []).push({ c:c, i:i }); });
    var keys = Object.keys(dateBuckets).sort().reverse();
    html += '<div class="group-h">'+L('Sẵn sàng','Ready')+' · '+readyCount+'</div>';
    keys.forEach(function(k){
      var label = k ? fmtDayMon(dateBuckets[k][0].c.date) : L('Không rõ ngày','No date');
      html += '<div class="group-h" style="margin-top:10px">'+esc(label)+'</div><div class="csv-cards">';
      dateBuckets[k].forEach(function(e){
        var o = { label:L('Khoản chi ','Item ')+(e.i+1), dateIso:e.c.dateDisplay,
                  tapFn:"csvToggleExpand('ready',"+e.i+")", removeFn:"csvReadyRemove("+e.i+")" };
        html += csvIsOpen('ready', e.i)
          ? csvActiveCard(e.c, Object.assign({}, o, { fields:true,
              buttons:'<button type="button" class="btn-line" onclick="csvExpandDone()">'+L('Xong','Done')+'</button>' }))
          : csvCollapsedCard(e.c, o);
      });
      html += '</div>';
    });
  }

  /* Trust strip -- the "am I safe to press Import?" answer, right before the
     decision: what's going in (count, total, date span), what was read from
     the file, and what's being left out. Nothing is ever dropped silently. */
  if(readyCount > 0 || decisionCount > 0){
    var sumBase = r.ready.reduce(function(s,c){ return s + csvBaseAmt(c.amount); }, 0);
    var dates = r.ready.map(function(c){ return c.date; }).filter(Boolean).sort(function(a,b){ return a-b; });
    var span = dates.length ? (fmtDayMon(dates[0]) + (dates.length>1 ? ' – ' + fmtDayMon(dates[dates.length-1]) : '')) : '';
    var skippedDup = r.dup.filter(function(d){ return d.resolved==='skip'; }).length;
    html += '<div class="csv-check">'
      + '<div class="csv-check-main">'+esc(L('Sẽ nhập '+readyCount+' khoản · tổng '+fmt(sumBase), 'Importing '+readyCount+' · total '+fmt(sumBase)))+'</div>'
      + (span ? '<div class="csv-check-sub">'+esc(span)+' · '+esc(L('đọc '+r.parsed.rows.length+' dòng từ file','read '+r.parsed.rows.length+' rows from the file'))+'</div>' : '')
      + (decisionCount+skippedDup > 0
          ? '<div class="csv-check-sub">'+esc(L('Không nhập: ','Not importing: '))
            + esc([ decisionCount ? decisionCount+' '+L('chưa quyết định','undecided') : null,
                    skippedDup ? skippedDup+' '+L('bỏ qua vì trùng','skipped as duplicates') : null ]
                  .filter(Boolean).join(' · '))+'</div>'
          : '')
      + '</div>';
  }

  html += '<button type="button" class="btn-text-quiet" style="width:100%;margin-top:10px" onclick="csvPickAnother()">'+L('Chọn file khác','Choose a different file')+'</button>';

  /* Park the live editor before innerHTML would destroy it -- the same
     hidden holder renderBulk() uses, so both surfaces hand it back and forth
     safely. */
  var _ed = document.getElementById('ex-editor');
  if(_ed){
    var holder = document.getElementById('bulk-holder');
    if(!holder){ holder = document.createElement('div'); holder.id='bulk-holder'; holder.style.display='none'; document.body.appendChild(holder); }
    holder.appendChild(_ed);
  }

  out.innerHTML = html;
  var pick=document.getElementById('csv-pick'); if(pick) pick.style.display='none';

  if(csvExpand){
    var openC = csvExpand.kind==='ready' ? r.ready[csvExpand.idx]
              : csvExpand.kind==='dup'   ? (r.dup[csvExpand.idx]||{}).c
              : csvExpand.kind==='defer' ? r.deferred[csvExpand.idx]
              : null;                                    // groups use chips only
    if(openC) csvBindEditor(openC);
  }

  // Nav-bar Save, gated -- always reachable, grey until importable.
  var save = document.getElementById('csv-save');
  if(save){ save.disabled = (readyCount===0); save.textContent = readyCount>0 ? L('Nhập '+readyCount,'Import '+readyCount) : L('Nhập','Import'); }
}

/* ---- inline expansion handlers ------------------------------------------- */

// Reads the expansion's fields back onto a candidate (only values that parse).
/* Commits the open READY row's edits when focus moves (accordion flush, like
   bulk logging). Decision rows (group/dup/defer) only commit through their
   explicit buttons -- flushing a half-made decision would resolve rows the
   user never confirmed. */
function csvFlushExpand(){
  if(!csvExpand || !csvReview) return;
  var c = csvExpand.kind==='ready' ? csvReview.ready[csvExpand.idx]
        : csvExpand.kind==='dup'   ? (csvReview.dup[csvExpand.idx]||{}).c
        : csvExpand.kind==='defer' ? csvReview.deferred[csvExpand.idx]
        : null;
  if(c) csvReadEditor(c);
}

function csvToggleExpand(kind, idx){
  if(csvIsOpen(kind, idx)){ csvFlushExpand(); csvExpand = null; }
  else { csvFlushExpand(); csvExpand = { kind:kind, idx:idx }; }
  renderCsvReview();
}

function csvExpandDone(){ csvFlushExpand(); csvExpand = null; renderCsvReview(); }

function csvReadyRemove(i){ csvReview.ready.splice(i,1); csvExpand = null; renderCsvReview(); }

// Group expansion: pure picker, so a chip tap applies instantly (house rule).
function csvGroupPick(name){
  var t=csvExpand; if(!t||t.kind!=='group'||!csvReview) return;
  var g=csvReview.groups.splice(t.idx,1)[0];
  if(g) g.items.forEach(function(it){ it.categoryName=name; it.catSource='user'; csvReview.ready.push(it); });
  csvExpand = null; renderCsvReview();
}

function csvDupInclude(di){
  var d=csvReview.dup[di]; if(!d) return;
  csvReadEditor(d.c);
  if(d.c.categoryName){ d.resolved='done'; csvReview.ready.push(d.c); }
  else {
    // still uncategorized -- joins (or starts) a needs-category group
    var gkey = normDescForDedup(d.c.description);
    var g = csvReview.groups.find(function(x){ return x.key===gkey; });
    if(g) g.items.push(d.c); else csvReview.groups.push({ key:gkey, items:[d.c] });
    d.resolved='done';
  }
  csvExpand = null; renderCsvReview();
}

function csvDupSkip(di){ csvReview.dup[di].resolved='skip'; csvExpand = null; renderCsvReview(); }

/* Deferred row confirmed as a real expense (or completed, for stuck rows).
   Re-enters the normal flow -- INCLUDING the dedup checks the mixed-signs
   early exit skipped for the whole file, so nothing bypasses them now.
   Incomplete rows stay put with the editor open rather than half-importing. */
function csvDeferConfirm(di){
  var c = csvReview.deferred[di]; if(!c) return;
  csvReadEditor(c);
  if(!(c.amount > 0) || !c.date){ renderCsvReview(); return; }
  csvReview.deferred.splice(di,1);

  var key = normDescForDedup(c.description)+'|'+c.amount;
  var already = csvReview.ready.some(function(x){ return normDescForDedup(x.description)+'|'+x.amount === key; })
    || csvReview.groups.some(function(g){ return g.items.some(function(x){ return normDescForDedup(x.description)+'|'+x.amount === key; }); });
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
  csvExpand = null; renderCsvReview();
}

function csvDeferDrop(di){ csvReview.deferred.splice(di,1); csvExpand = null; renderCsvReview(); }

/* Feeds every included candidate into bulkRows + submitBulk() (bulk expense
   logging's own machinery) instead of a bespoke insert -- the actual write
   goes through _dbInsertTxn() -> fhField()/_fhWriteLocked(), same as any
   other expense. Only ready[] promotes. */
function csvPromote(){
  if(!csvReview || !csvReview.ready.length) return;
  /* Encryption gate, checked ONCE for the whole batch. _dbInsertTxn() carries
     its own per-row _fhWriteLocked() guard, but that guard silently returns
     per row -- so on a locked device the loop would write nothing while
     submitBulk() still fired its success toast (and the guard would stack one
     unlock prompt per row). Every card-born family is enc-from-birth, so this
     is the default path on a device that hasn't unlocked yet, not an edge
     case. Bail before touching bulkRows: the review stays intact behind the
     prompt, so Import just works after unlocking. */
  if(window._fhWriteLocked && window._fhWriteLocked()) return;
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
