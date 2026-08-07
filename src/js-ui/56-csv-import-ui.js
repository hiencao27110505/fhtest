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
  if(out) out.innerHTML='<div class="sheet-sub csv-reading">'+L('✨ Đang đọc file của bạn…','✨ Reading your file…')+'</div>';

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
    dup: buckets.possibleDuplicate.map(function(c){ return { c:c, resolved:null }; }), // null | 'skip' | 'done' (moved on)
    deferred: buckets.deferred,
    mixedSignsNote: mixed,
    fileCats: csvUnknownFileCategories(candidates),
  };
  csvExpand = null;
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

/* One tap: the family adopts the file's own categories, then everything
   re-categorizes -- a first import arrives not just populated but organized,
   with the structure carried over from the old app. Client-side only here;
   the DB rows are created lazily at promote time by _categoryIdForName(). */
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
   uses. attn carries the amber left-accent for rows needing attention
   (accent line, not a fill, per the info-card rule). Tap toggles the inline
   editor; the chevron marks expandable rows and rotates while open. */
function csvDenseRow(cat, title, sub, amount, onclick, extraClass, open){
  var s = (cat && window.catStyle && window.catStyle[cat]) || ['🧾','#f2eef6','var(--cat-other)'];
  return '<div class="row'+(onclick?' tap':'')+(extraClass?' '+extraClass:'')+(open?' csv-open':'')+'"'+(onclick?' onclick="'+onclick+'"':'')+'>'
    + '<div class="r-ico-wrap"><div class="r-ico" style="background:'+s[1]+';color:'+s[2]+'">'+s[0]+'</div></div>'
    + '<div class="r-body"><div class="r-t">'+esc(title)+'</div><div class="r-s">'+esc(sub)+'</div></div>'
    + (amount!=null?'<div class="r-amt num">'+fmt(amount)+'</div>':'')
    + (onclick?'<svg class="chev csv-chev" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18l6-6-6-6"/></svg>':'')
    + '</div>';
}

function csvAmtInputVal(n){ return Number(n).toLocaleString(CUR==='VND'?'vi-VN':'en-US'); }

/* The inline editor, unfolded beneath its row inside the .rows container.
   fields:false gives the chips-only variant (merchant groups -- pure picker,
   chips apply instantly per the house rule); with fields, chips select and
   the primary button commits, same as the expense modal. */
function csvExpandHtml(c, opts){
  var h = '<div class="csv-expand">';
  if(opts.note) h += '<div class="csv-expand-note">'+opts.note+'</div>';
  if(opts.fields){
    h += '<div class="field"><label>'+L('Nội dung','Description')+'</label><input id="csvedit-note" value="'+escAttr(c.description||'')+'"></div>'
      + '<div class="csv-2col">'
      + '<div class="field"><label>'+L('Số tiền','Amount')+'</label><input id="csvedit-amt" inputmode="numeric" onblur="snapAmtInput(this)" placeholder="'+escAttr(amtPlaceholder())+'" value="'+escAttr(c.amount!=null?csvAmtInputVal(c.amount):'')+'"></div>'
      + '<div class="field"><label>'+L('Ngày','Date')+'</label><input type="date" id="csvedit-date" value="'+escAttr(c.dateDisplay||'')+'"></div>'
      + '</div>';
  }
  h += '<div class="field" style="margin-bottom:0"><label>'+L('Danh mục','Category')+'</label><div class="choices" id="csvedit-cats">'
    + (window.catOrder||[]).map(function(name){
        var s=(window.catStyle&&window.catStyle[name])||['🏷️'];
        var act = opts.instantChips ? 'csvGroupPick(\''+escAttr(name)+'\')' : 'pick(\'csvedit-cats\',this)';
        return '<button class="choice'+(c && name===c.categoryName?' on':'')+'" data-v="'+escAttr(name)+'" onclick="'+act+'">'+s[0]+' '+esc(name)+'</button>';
      }).join('')
    + '</div></div>';
  if(opts.buttons) h += '<div class="dup-actions" style="margin-top:14px">'+opts.buttons+'</div>';
  h += '</div>';
  return h;
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

  if(!r.mixedSignsNote && r.fileCats && r.fileCats.length){
    html += '<div class="notice-card stack">'
      + '<div class="notice-text"><b>'+esc(L('File này dùng '+r.fileCats.length+' danh mục bạn chưa có:','This file uses '+r.fileCats.length+(r.fileCats.length===1?' category':' categories')+' you don\'t have yet:'))+'</b> '
      + esc(r.fileCats.map(function(n){ return csvCatEmoji(n)+' '+n; }).join(' · '))+'</div>'
      + '<button type="button" class="btn-line" style="width:100%;margin:10px 0 0" onclick="csvAdoptFileCategories()">'+L('✨ Thêm và tự xếp giúp tôi','✨ Add them and sort for me')+'</button>'
      + '</div>';
  }

  /* ONE attention section, always on top: unresolved categories, duplicates,
     and every deferred row -- stuck ones included, now fixable inline (fill
     in the missing date or amount and confirm). */
  var attnHtml = '';
  r.groups.forEach(function(g, gi){
    var sum = g.items.reduce(function(s,it){return s+it.amount;},0);
    var open = csvIsOpen('group', gi);
    attnHtml += csvDenseRow(null, g.items[0].description,
      (g.items.length>1? g.items.length+' '+L('giao dịch · ','txns · '):'')+L('chưa có danh mục','no category yet'),
      sum, 'csvToggleExpand(\'group\','+gi+')', 'attn', open);
    if(open) attnHtml += csvExpandHtml(null, { instantChips:true });
  });
  r.dup.forEach(function(d, di){
    if(d.resolved!==null) return;
    var open = csvIsOpen('dup', di);
    attnHtml += csvDenseRow(d.c.categoryName, d.c.description, L('Có thể trùng lặp','Possible duplicate'), d.c.amount, 'csvToggleExpand(\'dup\','+di+')', 'attn', open);
    if(open){
      var why = d.c.duplicateOfExisting
        ? L('Trùng với một giao dịch đã có trong sổ — cùng số tiền, trong vòng 3 ngày.','Matches a transaction already in your ledger — same amount, within 3 days.')
        : L('Xuất hiện 2 lần trong file này với cùng nội dung và số tiền.','Appears twice in this file with the same description and amount.');
      attnHtml += csvExpandHtml(d.c, { note: esc(why), fields:true,
        buttons: '<button type="button" class="btn-line" onclick="csvDupInclude('+di+')">'+L('Vẫn nhập','Import anyway')+'</button>'
               + '<button type="button" class="btn-text-quiet" onclick="csvDupSkip('+di+')">'+L('Bỏ qua','Skip')+'</button>' });
    }
  });
  r.deferred.forEach(function(c, di){
    var open = csvIsOpen('defer', di);
    var stuckWhy = c.flags.indexOf('date_missing')>=0 ? L('thiếu ngày — chạm để bổ sung','missing date — tap to fill it in')
      : c.flags.indexOf('amount_missing')>=0 ? L('không đọc được số tiền — chạm để bổ sung','unreadable amount — tap to fill it in')
      : L('có thể là thu nhập — chạm để xác nhận','possibly income — tap to confirm');
    attnHtml += csvDenseRow(null, c.description||c.raw.join(', '), stuckWhy, c.amount, 'csvToggleExpand(\'defer\','+di+')', 'attn', open);
    if(open){
      attnHtml += csvExpandHtml(c, { fields:true,
        note: c.flags.indexOf('date_missing')<0 && c.flags.indexOf('amount_missing')<0
          ? esc(L('File này có thể lẫn thu nhập. Nếu đây đúng là khoản chi, kiểm tra rồi bấm Nhập khoản này.','This file may mix in income. If this really is an expense, check it over and tap Import this one.')) : null,
        buttons: '<button type="button" class="btn-line" onclick="csvDeferConfirm('+di+')">'+L('Nhập khoản này','Import this one')+'</button>'
               + '<button type="button" class="btn-text-quiet" onclick="csvDeferDrop('+di+')">'+L('Bỏ qua','Skip')+'</button>' });
    }
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
    html += '<div class="group-h">'+L('Cần bạn xem','Needs your eye')+'</div><div class="rows csv-rows">'+attnHtml+'</div>';
  }

  /* Ready list, grouped by date (newest first), like the ledger it becomes. */
  if(r.ready.length){
    var dateBuckets = {};
    r.ready.forEach(function(c, i){ var k = c.dateDisplay || ''; (dateBuckets[k] = dateBuckets[k] || []).push({ c:c, i:i }); });
    var keys = Object.keys(dateBuckets).sort().reverse();
    html += '<div class="group-h">'+L('Sẵn sàng','Ready')+' · '+readyCount+'</div>';
    keys.forEach(function(k){
      var label = k ? fmtDayMon(dateBuckets[k][0].c.date) : L('Không rõ ngày','No date');
      html += '<div class="group-h" style="margin-top:10px">'+esc(label)+'</div><div class="rows csv-rows">';
      dateBuckets[k].forEach(function(e){
        var open = csvIsOpen('ready', e.i);
        html += csvDenseRow(e.c.categoryName, e.c.description, e.c.categoryName, e.c.amount, 'csvToggleExpand(\'ready\','+e.i+')', null, open);
        if(open){
          html += csvExpandHtml(e.c, { fields:true,
            buttons: '<button type="button" class="btn-line" onclick="csvExpandDone()">'+L('Xong','Done')+'</button>'
                   + '<button type="button" class="btn-text-quiet" onclick="csvReadyRemove('+e.i+')">'+L('Bỏ khoản này','Don\'t import this one')+'</button>' });
        }
      });
      html += '</div>';
    });
  }

  /* Trust strip -- the "am I safe to press Import?" answer, right before the
     decision: what's going in (count, total, date span), what was read from
     the file, and what's being left out. Nothing is ever dropped silently. */
  if(readyCount > 0 || decisionCount > 0){
    var sum = r.ready.reduce(function(s,c){ return s + (c.amount||0); }, 0);
    var dates = r.ready.map(function(c){ return c.date; }).filter(Boolean).sort(function(a,b){ return a-b; });
    var span = dates.length ? (fmtDayMon(dates[0]) + (dates.length>1 ? ' – ' + fmtDayMon(dates[dates.length-1]) : '')) : '';
    var skippedDup = r.dup.filter(function(d){ return d.resolved==='skip'; }).length;
    html += '<div class="csv-check">'
      + '<div class="csv-check-main">'+esc(L('Sẽ nhập '+readyCount+' khoản · tổng '+fmt(sum), 'Importing '+readyCount+' · total '+fmt(sum)))+'</div>'
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

  out.innerHTML = html;
  var pick=document.getElementById('csv-pick'); if(pick) pick.style.display='none';

  // Nav-bar Save, gated -- always reachable, grey until importable.
  var save = document.getElementById('csv-save');
  if(save){ save.disabled = (readyCount===0); save.textContent = readyCount>0 ? L('Nhập '+readyCount,'Import '+readyCount) : L('Nhập','Import'); }
}

/* ---- inline expansion handlers ------------------------------------------- */

// Reads the expansion's fields back onto a candidate (only values that parse).
function csvApplyEditFields(c){
  var noteEl=document.getElementById('csvedit-note');
  if(noteEl && noteEl.value.trim()) c.description = noteEl.value.trim();
  var amtEl=document.getElementById('csvedit-amt');
  if(amtEl){ var amt = parseAmt(amtEl.value||''); if(amt > 0) c.amount = amt; }
  var dEl=document.getElementById('csvedit-date');
  if(dEl && dEl.value){ c.dateDisplay = dEl.value; c.date = new Date(dEl.value+'T00:00:00'); }
  var catsEl=document.getElementById('csvedit-cats');
  if(catsEl){ var cat = chosen('csvedit-cats'); if(cat){ c.categoryName = cat; c.catSource = 'user'; } }
}

/* Commits the open READY row's edits when focus moves (accordion flush, like
   bulk logging). Decision rows (group/dup/defer) only commit through their
   explicit buttons -- flushing a half-made decision would resolve rows the
   user never confirmed. */
function csvFlushExpand(){
  if(!csvExpand || !csvReview) return;
  if(csvExpand.kind==='ready'){ var c=csvReview.ready[csvExpand.idx]; if(c) csvApplyEditFields(c); }
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
  csvApplyEditFields(d.c);
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
  csvApplyEditFields(c);
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
