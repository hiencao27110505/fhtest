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
/* The bank-email "Review transactions" modal reuses this whole review engine
   (72-txn-review). When true, renderCsvReview drops the file-only chrome (add-a-
   file / start-over / filename chip) and swaps "file" wording for "email", so the
   shared screen reads as a transaction review rather than a half-dressed importer.
   Every file entry point (openCsvImport / csvPickAnother) clears it. */
var csvStagedMode = false;

/* One Save button, two flows: the file import (csvPromote) and the bank-email
   staged review (fhPromoteStaged). The button's onclick is FIXED to this
   dispatcher — never rewired per entry — so a stale handler can't bleed from one
   flow into the other (a file import must never run the staged-promote path,
   which would delete un-reviewed email rows). The mode is the single source. */
function csvSaveDispatch(){ return csvStagedMode ? fhPromoteStaged() : csvPromote(); }

/* WHERE a reviewed bank transaction lands. Two destinations, and the difference
   is who ELSE can see it:
     family   -> transactions (the shared ledger). The personal mirror then copies
                 it into your own ledger too, so "family" means BOTH, not "not mine".
     personal -> personal_transactions with space_id null. Private, permanently.
                 The family never sees it and there is no un-share.

   One control for the whole pass rather than a toggle per row, because the row
   checkboxes already give per-row control: tick the shared ones, import, flip the
   scope, import the rest. Selection × scope covers a mixed batch in two taps
   instead of N, and keeps the collapsed cards as quiet as they were asked to be.

   Remembered across sessions: someone whose bank mail is mostly personal should
   not re-pick it every morning. Never remembered as 'personal' when the personal
   ledger cannot actually be written to — see csvScopeReady. */
var CSV_SCOPE_KEY = 'fh-staged-scope';
function csvScopeReady(){
  var pd = window.fhPersonalData && window.fhPersonalData();
  return !!(pd && pd.key);
}
function csvStagedScope(){
  if(!csvScopeReady()) return 'family';            // locked ledger -> never offer to lose the row
  try{ return localStorage.getItem(CSV_SCOPE_KEY)==='personal' ? 'personal' : 'family'; }
  catch(e){ return 'family'; }
}
/* Persist only. Split out from csvPickScope because an ENTRY POINT needs to
   pre-scope before the review screen exists — opening the queue from the Cá nhân
   tab means personal, the same way openPersonalExpense() presets the expense
   modal. Returns whether it took, so a caller can tell refusal from success.

   Refusing when the ledger is locked is the point: csvStagedScope() would fall
   back to family anyway, and persisting a choice that does not apply would make
   the picker disagree with itself the moment the ledger unlocks. */
function csvSetScope(v){
  if(v==='personal' && !csvScopeReady()) return false;
  try{ localStorage.setItem(CSV_SCOPE_KEY, v); }catch(e){}
  return true;
}
function csvPickScope(v){
  if(!csvSetScope(v)){
    window.toast && window.toast(L('Mở khoá sổ cá nhân ở tab Cá nhân trước','Unlock your personal ledger first'));
    return;
  }
  renderCsvReview();
}
/* The summary line now describes the MIX, because the destination is per row.
   "2 vào sổ gia đình · 1 riêng tư" is checkable at a glance against what the
   cards say; a single label could only have described a default nobody set. */
function csvScopeSummary(){
  var rows = (typeof csvStagedSelected === 'function') ? csvStagedSelected() : [];
  var p = 0, f = 0;
  rows.forEach(function(c){ if(csvRowScope(c)==='personal') p++; else f++; });
  if(!p) return L('vào sổ gia đình, cả nhà cùng thấy','to the family ledger, everyone sees it');
  if(!f) return L('vào sổ cá nhân, chỉ mình bạn thấy','to your personal ledger, only you see it');
  return L(f+' khoản vào sổ gia đình · '+p+' khoản riêng tư',
           f+' to the family · '+p+' private');
}
function csvRowScopeField(c){
  var sc = csvRowScope(c), locked = !csvScopeReady();
  var chip = function(v, label){
    return '<button type="button" class="choice'+(sc===v?' on':'')+'"'
      + (v==='personal' && locked ? ' aria-disabled="true"' : '')
      + ' aria-pressed="'+(sc===v?'true':'false')+'"'
      + ' onclick="csvPickRowScope(\''+v+'\')">'+esc(label)+'</button>';
  };
  return '<div class="field csv-scope">'
    + '<label>'+esc(L('Ghi vào đâu?','Where does this go?'))+'</label>'
    + '<div class="choices">'+chip('personal', L('🔒 Cá nhân','🔒 Personal'))+chip('family', L('🏡 Gia đình','🏡 Family'))+'</div>'
    + (locked ? '<div class="csv-scope-note">'+esc(L('Sổ cá nhân đang khoá — mở ở tab Cá nhân để chọn được.','Personal ledger is locked — unlock it on the Cá nhân tab to pick it.'))+'</div>' : '')
    + '</div>';
}

function openCsvImport(){
  csvStagedMode = false;               // this is the file flow, not the staged review
  if(typeof csvTxrHeadSync === 'function') csvTxrHeadSync();   // staged tools header clears itself
  var input=document.getElementById('csv-file-input'); if(input) input.value='';
  var out=document.getElementById('csv-result'); if(out) out.innerHTML='';
  csvReview = null; csvExpand = null;
  var pick=document.getElementById('csv-pick'); if(pick) pick.style.display='';
  // Restore this flow's own title — the staged review borrows the same modal and
  // retitles it, so the file entry must reclaim its title rather than inherit it.
  var ttl=document.querySelector('#csv-import-modal .modal-title'); if(ttl) ttl.textContent=L('Nhập từ file','Import from file');
  var save=document.getElementById('csv-save'); if(save){ save.disabled=true; save.textContent=L('Nhập','Import'); }
  csvLearnLoad();                      // corrections this family made before
  openSheet('csv-import-modal');
  csvTryRestoreDraft();          // pick up a review left behind by an accidental close
}

// Back to the picker without closing the modal (the quiet escape under the review).
/* Drops everything learned on this device and re-reads the file from scratch,
   so a lesson that generalised badly can be undone in one tap. */
function csvForgetLearned(){
  if(typeof csvLearnForget === 'function') csvLearnForget();
  if(csvReview && csvReview.sources){
    csvBuildReview(csvReview.sources);
    renderCsvReview();
  }
}

function csvPickAnother(){
  csvStagedMode = false;         // back to the file picker -> leave staged mode
  if(typeof csvTxrHeadSync === 'function') csvTxrHeadSync();   // staged tools header clears itself
  csvClearDraft();               // deliberately starting over
  var input=document.getElementById('csv-file-input'); if(input) input.value='';
  var out=document.getElementById('csv-result'); if(out) out.innerHTML='';
  csvReview = null; csvExpand = null;
  var pick=document.getElementById('csv-pick'); if(pick) pick.style.display='';
  var save=document.getElementById('csv-save'); if(save){ save.disabled=true; save.textContent=L('Nhập','Import'); }
}

/* Reads ONE file to {headers, rows}. .xlsx goes through the native reader
   (42-xlsx-parse.js); everything else is read as text. */
function csvReadOneFile(file, password){
  return new Promise(function(resolve, reject){
    // .xls is the common one (old Excel, and some bank exports), so it gets
    // its own line instead of a generic "unsupported format".
    if(/\.xls$/i.test(file.name)){
      reject(new Error(L('File này ở định dạng Excel đời cũ (.xls). Bạn mở ra rồi lưu lại thành .xlsx hoặc CSV là tụi mình đọc được nhé.','This is an older Excel format (.xls). Open it and save it again as .xlsx or CSV and we can read it.')));
      return;
    }
    if(/\.(numbers|ods)$/i.test(file.name)){
      reject(new Error(L('Tụi mình đọc được file CSV và Excel (.xlsx). Với định dạng này, bạn mở ra rồi lưu thành CSV hoặc .xlsx nhé.','We can read CSV and Excel (.xlsx). For this format, open it and save as CSV or .xlsx.')));
      return;
    }
    if(/\.xlsx$/i.test(file.name)){
      if(!(window.fhXlsxSupported && window.fhXlsxSupported())){
        reject(new Error(L('Trình duyệt này chưa đọc được file Excel. Bạn lưu thành CSV giúp nhé.','This browser can\'t open Excel files yet. Save it as CSV instead.')));
        return;
      }
      window.fhParseXlsxFile(file, password).then(resolve, function(err){
        var code = (err && err.message) || '';
        // Not an error yet -- the caller turns this into a password prompt.
        if(code === 'xlsx_encrypted'){ var e2 = new Error('xlsx_encrypted'); e2.locked = true; reject(e2); return; }
        if(code === 'bad_password'){ var e3 = new Error('bad_password'); e3.locked = true; e3.wrong = true; reject(e3); return; }
        if(code === 'xlsx_enc_unsupported'){
          reject(new Error(L('File này được khoá bằng một kiểu mã hoá tụi mình chưa mở được. Bạn mở bằng Excel rồi lưu một bản không đặt mật khẩu giúp nhé.','This file uses an encryption scheme we can\'t open yet. Open it in Excel and save a copy without the password.')));
          return;
        }
        // Locked workbooks are common here -- banks send statements protected
        // with a phone number or date of birth. Say so, and say what to do.
        if(code === 'xls_legacy'){
          reject(new Error(L('File này ở định dạng Excel đời cũ (.xls). Bạn mở ra rồi lưu lại thành .xlsx hoặc CSV giúp nhé.','This is an older Excel format (.xls). Open it and save it again as .xlsx or CSV.')));
          return;
        }
        reject(new Error(L('Không đọc được file Excel này.','Couldn\'t read this Excel file.')));
      });
      return;
    }
    /* Read bytes first and let the BOM say what the text is. Excel's
       "Unicode Text" export is UTF-16, and forcing utf-8 onto it turns every
       header into noise -- the file then fails with no hint why. */
    var reader = new FileReader();
    reader.onload = function(){
      var u = new Uint8Array(reader.result), encoding = 'utf-8';
      if(u.length >= 2 && u[0] === 0xFF && u[1] === 0xFE) encoding = 'utf-16le';
      else if(u.length >= 2 && u[0] === 0xFE && u[1] === 0xFF) encoding = 'utf-16be';
      else {
        // No BOM, but NUL bytes: text never contains them, UTF-16 is half them.
        var zeroEven = 0, zeroOdd = 0, scan = Math.min(u.length, 512);
        for(var zi = 0; zi < scan; zi++){ if(u[zi] === 0){ if(zi % 2) zeroOdd++; else zeroEven++; } }
        if(zeroOdd + zeroEven > scan / 8) encoding = (zeroOdd > zeroEven) ? 'utf-16le' : 'utf-16be';
      }
      var text;
      try { text = new TextDecoder(encoding).decode(u); }
      catch(e){ text = new TextDecoder('utf-8').decode(u); }
      if(text.charCodeAt(0) === 0xFEFF) text = text.slice(1);   // strip any BOM
      var parsed = window.fhParseCsvFile ? window.fhParseCsvFile(text) : null;
      if(!parsed || !parsed.headers.length) reject(new Error(L('Không đọc được file này.','Could not read this file.')));
      else resolve(parsed);
    };
    reader.onerror = function(){ reject(new Error(L('Không đọc được file này.','Could not read this file.'))); };
    reader.readAsArrayBuffer(file);
  });
}

/* Several files at once, or more files added to a review already open.

   Each file keeps its OWN column mapping -- a bank export and a budgeting-app
   export have nothing in common -- but they land in a single candidate list,
   which is what makes cross-file duplicates catchable: exported statements
   very often overlap by a few days, and importing both would otherwise double
   those transactions. */
/* Files still waiting on a password, and the passwords already accepted.
   csvPasswords lives for this import only -- never persisted, never sent. */
var csvLocked = [];
var csvPasswords = {};

function onCsvFileSelected(input){
  var files = Array.prototype.slice.call((input && input.files) || []);
  if(!files.length) return;
  csvImportFiles(files, input);
}

function csvImportFiles(files, input){
  /* The same statement picked twice -- in one selection, or added again with
     "Thêm file" -- would flag every single row as a cross-file duplicate.
     One copy is kept and the double pick is named, since silently reading a
     file the person deliberately chose twice would look like a bug too. */
  var have = {};
  ((csvReview && csvReview.sources) || []).forEach(function(src){ have[src.name] = 1; });
  var uniq = [], doubled = [];
  files.forEach(function(f){
    var k = f.name + '|' + f.size;
    if (have[k] || have[f.name]) { doubled.push(f.name); return; }
    have[k] = 1; uniq.push(f);
  });
  files = uniq;
  if(doubled.length && !files.length){
    var out0 = document.getElementById('csv-result');
    if(out0 && csvReview) { renderCsvReview(); }
    return;
  }
  var out = document.getElementById('csv-result');
  var appending = !!(csvReview && csvReview.sources && csvReview.sources.length);
  if(out) out.innerHTML = '<div class="sheet-sub csv-reading">'
    + esc(files.length > 1 ? L('Đang đọc '+files.length+' file…','Reading '+files.length+' files…')
                           : L('Đang đọc file…','Reading your file…')) + '</div>';

  var problems = [];
  doubled.forEach(function(n){ problems.push(n + ' — ' + L('đã chọn 2 lần, tụi mình đọc một lần thôi','picked twice, read once')); });
  csvLocked = [];
  csvSkipLocked = false;
  Promise.all(files.map(function(f){
    return csvReadOneFile(f, csvPasswords[f.name])
      .then(function(parsed){ parsed = csvReseatHeader(parsed); return window.fhResolveCsvMapping(parsed.headers, parsed.rows)
        .then(function(result){ return { parsed:parsed, result:result, name:f.name }; }); })
      .catch(function(e){
        // A locked file isn't a failure -- it's a question we haven't asked yet.
        if(e && e.locked){ csvLocked.push({ file:f, wrong:!!e.wrong }); return null; }
        problems.push(f.name + ' — ' + ((e && e.message) || e)); return null;
      });
  })).then(function(loaded){
    var sources = loaded.filter(Boolean);
    if(appending) sources = csvReview.sources.concat(sources);
    if(csvLocked.length && !csvSkipLocked){ csvRenderUnlock(files, problems); return; }
    if(!sources.length){
      if(out) out.innerHTML = '<div class="sheet-sub">'+esc(problems.join(' · ') || L('Không đọc được file này.','Could not read this file.'))+'</div>';
      return;
    }
    csvBuildReview(sources);
    csvReview.problems = problems;      // named, never swallowed
    csvReview.pending = files;          // so a password can re-read the locked ones
    renderCsvReview();
    if(input) input.value = '';          // so re-picking the same file still fires
  });
}

/* The unlock prompt.

   Everything here happens on the device: the password derives a key, opens the
   file, and is dropped. It is never stored and never sent -- worth saying on
   the screen, because being asked for a bank password is exactly the moment a
   person should be suspicious. */
function csvRenderUnlock(files, problems){
  var out = document.getElementById('csv-result'); if(!out) return;
  var names = csvLocked.map(function(l){ return l.file.name; });
  var wrong = csvLocked.some(function(l){ return l.wrong; });
  var others = (files || []).length - csvLocked.length;
  out.innerHTML = '<div class="csv-unlock">'
    + '<div class="csv-unlock-title">' + esc(L('File này có mật khẩu','This file needs a password')) + '</div>'
    + '<div class="csv-unlock-sub">' + esc(names.join(', ')) + '</div>'
    + '<input id="csv-pw" type="password" class="csv-pw" autocomplete="off" '
      + 'placeholder="' + escAttr(L('Nhập mật khẩu mở file','Enter the password')) + '" '
      + 'onkeydown="if(event.key===\'Enter\'){event.preventDefault();csvUnlock();}">'
    + (wrong ? '<div class="csv-unlock-err">' + esc(L('Mật khẩu chưa đúng, thử lại nhé','That password didn\'t work, try again')) + '</div>' : '')
    + '<button type="button" class="btn-line csv-unlock-go" onclick="csvUnlock()">' + L('Mở file','Unlock') + '</button>'
    + '<div class="csv-unlock-note">' + esc(L('Mật khẩu chỉ dùng ngay trên máy bạn để mở file, tụi mình không lưu và không gửi đi đâu.','The password is used on your device to open the file. We do not store it or send it anywhere.')) + '</div>'
    + '<button type="button" class="csv-linkbtn csv-unlock-skip" onclick="csvSkipLockedFiles()">'
      + esc(others > 0
          ? L('Không biết mật khẩu, nhập '+others+' file còn lại','Skip it and import the other '+others)
          : L('Không biết mật khẩu, bỏ qua file này','Skip this file'))
    + '</button>'
    + (problems && problems.length ? '<div class="csv-unlock-err">' + esc(problems.join(' · ')) + '</div>' : '')
    + '</div>';
  /* Deliberately NOT clearing csvReview: when the locked file was added to
     an already-open review with "Thêm file", that review -- possibly edited
     -- must survive both the prompt and a "skip it" answer. */
  var pick = document.getElementById('csv-pick'); if(pick) pick.style.display = 'none';
  var f = document.getElementById('csv-pw'); if(f) f.focus();
  csvUnlockFiles = files;
}

var csvUnlockFiles = null;
var csvSkipLocked = false;
var csvInflowOpen = false;
var csvInflowDetail = null;
function csvToggleInflow(){ csvInflowOpen = !csvInflowOpen; csvInflowDetail = null; renderCsvReview(); }
function csvInflowToggle(di){ csvInflowDetail = (csvInflowDetail === di) ? null : di; renderCsvReview(); }

function csvSkipLockedFiles(){
  var drop = {};
  csvLocked.forEach(function(l){ drop[l.file.name] = 1; });
  var rest = (csvUnlockFiles || []).filter(function(f){ return !drop[f.name]; });
  csvSkipLocked = true;
  if(!rest.length && csvReview && csvReview.sources && csvReview.sources.length){
    csvLocked = []; csvSkipLocked = false;
    renderCsvReview();          // the review that was open before the locked pick
    return;
  }
  if(!rest.length){
    var out = document.getElementById('csv-result');
    if(out) out.innerHTML = '<div class="sheet-sub">'+esc(L('Chưa có file nào để nhập. Bạn chọn file khác nhé.','Nothing to import yet. Pick another file.'))+'</div>';
    var pick = document.getElementById('csv-pick'); if(pick) pick.style.display='';
    csvSkipLocked = false; csvLocked = [];
    return;
  }
  csvImportFiles(rest, null);
}

function csvUnlock(){
  var f = document.getElementById('csv-pw');
  var pw = f ? f.value : '';
  if(!pw) { if(f) f.focus(); return; }
  csvLocked.forEach(function(l){ csvPasswords[l.file.name] = pw; });
  var go = document.querySelector('.csv-unlock-go');
  if(go){ go.disabled = true; go.textContent = L('Đang mở…','Unlocking…'); }
  // Let the button paint before the key derivation takes the thread.
  setTimeout(function(){ csvImportFiles(csvUnlockFiles || [], null); }, 30);
}

/* Shared tail for both readers: once a file is {headers, rows}, CSV and xlsx
   are indistinguishable from here on -- same column mapping, same review. */
function csvReseatHeader(parsed){
  if(!window.fhFindHeaderRow) return parsed;
  var f = window.fhFindHeaderRow(parsed.headers, parsed.rows);
  if(!f.skipped) return parsed;
  return { headers:f.headers, rows:f.rows, skippedPreamble:f.skipped };
}

function csvResolveAndRender(parsed, out){
  return window.fhResolveCsvMapping(parsed.headers, parsed.rows).then(function(result){
    csvBuildReview(parsed, result);
    renderCsvReview();
  }).catch(function(e){
    if(out) out.innerHTML='<div class="sheet-sub">'+L('Có lỗi khi phân tích file: ','Something went wrong analyzing this file: ')+esc(String((e&&e.message)||e))+'</div>';
  });
}

/* ---- draft, mirroring the composer's persistDrafts() ----------------------
   A 59-row review is real work; closing the modal by accident shouldn't lose
   it. Same shape as bulk logging's draft: on-device only, and for a
   committed-enc family the payload is ENCRYPTED before it touches
   localStorage (a locked device simply doesn't persist, since it couldn't
   import anyway). Cleared once the rows are actually imported. */
var FH_CSV_DRAFT = 'fh-csv-import-draft';
var _csvDraftSeq = 0;

function csvDraftPayload(){
  if(!csvReview) return null;
  var slim = function(c){ return { description:c.description, amount:c.amount, dateDisplay:c.dateDisplay,
    categoryName:c.categoryName, catSource:c.catSource, who:c.who, flags:c.flags||[], raw:c.raw||[] }; };
  return { v:1, cur:CUR,
    ready: csvReview.ready.map(slim),
    groups: csvReview.groups.map(function(g){ return { key:g.key, items:g.items.map(slim) }; }),
    dup: csvReview.dup.map(function(d){ return { c:slim(d.c), resolved:d.resolved,
      hadExisting:!!d.c.duplicateOfExisting, hadBatch:!!d.c.duplicateOfBatch }; }),
    deferred: csvReview.deferred.map(slim),
    mixedSignsNote: csvReview.mixedSignsNote, rowsRead: (csvReview.parsed&&csvReview.parsed.rows.length)||0 };
}

function csvPersistDraft(){
  // Never persist a staged bank-email review as a "file import draft": it would
  // be restored later by openCsvImport into the file flow, rendering staged rows
  // with file chrome and an Import button wired to the wrong promote path. The
  // staged queue is re-fetched from the server each time anyway.
  if(csvStagedMode){ return; }
  try{
    var data = csvDraftPayload();
    if(!data || (!data.ready.length && !data.groups.length && !data.dup.length && !data.deferred.length)){
      localStorage.removeItem(FH_CSV_DRAFT); return;
    }
    if(window.fhEncState && window.fhEncState()==='enc'){
      if(!(window.fhKeyReady && window.fhKeyReady()) || !window.fhEncStr) return;
      var seq = ++_csvDraftSeq;
      window.fhEncStr(JSON.stringify(data)).then(function(ct){
        if(!ct || seq!==_csvDraftSeq) return;          // a stale encrypt must not stomp a newer draft
        try{ localStorage.setItem(FH_CSV_DRAFT, JSON.stringify({ v:2, enc:1, cur:CUR, ct:ct })); }catch(e){}
      });
      return;
    }
    localStorage.setItem(FH_CSV_DRAFT, JSON.stringify(data));
  }catch(e){}
}

function csvClearDraft(){ try{ localStorage.removeItem(FH_CSV_DRAFT); }catch(e){} }

function csvHydrateDraft(d){
  if(!d || d.cur !== CUR) return false;
  var thaw = function(c){ if(c.dateDisplay) c.date = new Date(c.dateDisplay+'T00:00:00'); return c; };
  csvReview = {
    parsed: { headers:[], rows:new Array(d.rowsRead||0) }, mapResult: null,
    ready: (d.ready||[]).map(thaw),
    groups: (d.groups||[]).map(function(g){ return { key:g.key, items:g.items.map(thaw) }; }),
    dup: (d.dup||[]).map(function(x){ var c=thaw(x.c);
      if(x.hadExisting) c.duplicateOfExisting = true; if(x.hadBatch) c.duplicateOfBatch = true;
      return { c:c, resolved:x.resolved }; }),
    deferred: (d.deferred||[]).map(thaw),
    mixedSignsNote: !!d.mixedSignsNote,
    fileCats: [], adoptedCats: [], catMerges: [], fallbackCount: 0, declinedAdopt: true,
  };
  csvExpand = null;
  renderCsvReview();
  return true;
}

// Restores a previous review if one was left behind. Returns true if it did.
function csvTryRestoreDraft(){
  var raw; try{ raw = localStorage.getItem(FH_CSV_DRAFT); }catch(e){ return false; }
  if(!raw) return false;
  var d; try{ d = JSON.parse(raw); }catch(e){ csvClearDraft(); return false; }
  if(d && d.enc){
    if(d.cur!==CUR || !window.fhDecStr) return false;
    window.fhDecStr(d.ct).then(function(pt){
      if(!pt) return;
      try{ csvHydrateDraft(JSON.parse(pt)); }catch(e){}
    });
    return true;
  }
  return csvHydrateDraft(d);
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
function csvBuildReview(sources, opts){
  csvInflowOpen = false;   // a fresh review starts with the money-in line folded
  csvInflowDetail = null;
  csvBulkReset();          // ...and with no pane open and no delete left armed

  opts = opts || {};
  csvCatMerges = {}; csvCatAmbiguous = {};   // recomputed every build
  csvPendingCats = [];                       // adoption is re-decided each build
  csvFuzzyCats = !opts.declined;             // undo also turns off name-merging

  var build = function(){
    var all = [];
    sources.forEach(function(src){
      var part = buildCsvCandidates(src.parsed, src.result);
      part.forEach(function(c){ c.sourceName = src.name; });
      all = all.concat(part);
    });
    return all;
  };

  var candidates = build();
  var unknown = csvUnknownFileCategories(candidates);
  var adopted = [];
  if(unknown.length && !opts.declined){
    adopted = csvAdoptCategories(unknown);
    if(adopted.length){ candidates = build(); unknown = csvUnknownFileCategories(candidates); }
  }

  var blanks = csvDropBlankRows(candidates);   // spacers and account-header rows
  candidates = blanks.kept;

  csvMarkSummaryRows(candidates);      // a trailing total is not a transaction
  csvPatternPass(candidates);          // habits the dictionary can't name
  var signMode = csvResolveSignMode(candidates);
  var mixed = (signMode === 'ambiguous');   // only a genuine 50/50 split stops everything
  var buckets = bucketCsvCandidates(candidates, mixed);
  var rowsRead = sources.reduce(function(n, src){ return n + src.parsed.rows.length; }, 0);

  csvReview = {
    sources: sources,
    parsed: { headers:[], rows:new Array(rowsRead) },   // trust strip reads .rows.length
    ready: buckets.ready,
    groups: Object.keys(buckets.needsCategoryGroups).map(function(k){ return { key:k, items:buckets.needsCategoryGroups[k] }; }),
    /* Staged (bank-email) mode has no parking lot: Trang's call — one dated
       list, every transaction reviewable in place. A suspected repeat joins
       ready UNTICKED (excluded from Nhập until a human says otherwise, so
       nothing double-imports silently) and keeps its duplicate flags, which
       the card wears as the "lặp lại" chip. One tap includes it. The file
       import keeps its dup section — files have no timestamps, so their
       suspects genuinely need the ruling treatment. */
    dup: csvStagedMode
      ? (buckets.possibleDuplicate.forEach(function(c){ c._skipImport = true; buckets.ready.push(c); }), [])
      : buckets.possibleDuplicate.map(function(c){ return { c:c, resolved:null }; }),
    deferred: buckets.deferred.filter(function(c){ return !c.isSummaryRow; }),
    mergedCount: buckets.mergedCount || 0,   // copies of one payment folded away; the header says how many
    mixedSignsNote: mixed,
    signMode: signMode,
    blankCount: blanks.dropped,
    fileCats: unknown,
    adoptedCats: adopted,
    /* Only report a merge into a category that already existed. After
       adoption the second pass legitimately "merges" into a name we just
       created, which is true but reads as a contradiction next to "added". */
    catMerges: Object.keys(csvCatMerges)
      .filter(function(k){ return adopted.indexOf(csvCatMerges[k]) < 0; })
      .map(function(k){ return { from:k, to:csvCatMerges[k] }; }),
    summaryCount: candidates.filter(function(c){ return c.isSummaryRow; }).length,
    fallbackCount: buckets.ready.filter(function(c){ return c.catSource === 'fallback'; }).length,
    patternCount: buckets.ready.filter(function(c){ return c.catSource === 'pattern'; }).length,
    declinedAdopt: !!opts.declined,
  };
  csvExpand = null;
}

/* Adds category names to the family's client-side list (DB rows are created
   lazily at promote time by _categoryIdForName(), the same path any new
   category takes). Returns the names actually added. */
function csvAdoptCategories(names){
  var added = [];
  names.forEach(function(raw){
    // Create it under the app's language, so a Vietnamese family never ends up
    // with an English category just because their export was labelled that way.
    var name = (typeof csvLocalizedCatName === 'function' && csvLocalizedCatName(raw)) || raw;
    if(csvCatOk(name)) return;
    csvPendingCats.push(name);                       // pending, NOT the live list
    catStyle[name] = [csvCatEmoji(name)].concat(CATPAL[(csvAllCats().length) % CATPAL.length]);
    added.push(name);
  });
  return added;
}

/* Undo: drop the categories this import added and re-bucket without them.
   Safe because nothing has been written yet -- these exist only client-side
   until Import, and only names WE added this build are removed. */
function csvUndoAdopt(){
  if(!csvReview) return;
  csvPendingCats = [];                               // nothing global to unwind
  csvBuildReview(csvReview.sources, { declined:true });
  renderCsvReview();
}

// Re-adopt after an undo (the offer card's action).
function csvAdoptFileCategories(){
  if(!csvReview || !csvReview.sources) return;
  csvBuildReview(csvReview.sources);
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
/* Display currency → base units, WITHOUT rounding.
   Math.round here quietly destroyed every imported figure: VND base units are
   thousands, so a 337.900đ card charge became 338 and redisplayed as 338.000đ
   — every bank row wrong by up to 500đ, and the ledger's totals wrong with
   them. Hand entry is unaffected (someone typing "45" still means 45.000đ, a
   whole 45); only amounts that CARRY sub-thousand digits keep them now, which
   is exactly the imported ones. transactions.amount is numeric(14,2) and holds
   the decimals; fmt() rounds at the point of DISPLAY, where rounding belongs.

   The residual limit is 10đ, not 500đ: two decimals of a 1.000đ base unit.
   Every VN bank figure we have seen is a multiple of 100đ (337.900, 95.500,
   13.000) and survives exactly. Going đồng-exact would mean scale 3, which
   means dropping and recreating the four views built on this column — a live
   ledger rewrite to chase 2đ on an FX or interest line. Not worth it; recorded
   here so the next person does not rediscover the ceiling by surprise. */
function csvBaseAmt(n){ return Number(n||0)/curMult(); }
function csvFmt(n){ return fmt(csvBaseAmt(n)); }
/* Whoever is importing is the payer, unless the file says otherwise.
   lastWho is the wrong default here -- it's the first member in the family
   list (or whoever logged an expense last), so an import by Trang could land
   on Hiền. _meName() is the signed-in member. Still just a default: the file's
   own "Ai trả" column wins, and every row's chip is editable. */
function csvDefaultWho(){
  /* Resolve the signed-in member the way hydrate records it: ownerMemberId is
     set from m.user_id === auth uid. _meName() looks for a `me` flag that
     hydrate never sets, so it silently fell through to FAM.user.name (the
     Google display name, which needn't match a member) or members[0] -- which
     is how an import by one person landed on another. */
  try{
    var db = window.DB;
    if(db && db.ownerMemberId && db.memberById){
      var m = db.memberById[db.ownerMemberId];
      if(m && m.name) return m.name;
    }
  }catch(e){}
  return (typeof _meName === 'function' && _meName()) || window.lastWho || '';
}

function csvAmtInputVal(n){ return Number(n).toLocaleString(CUR==='VND'?'vi-VN':'en-US'); }

/* What the file adds up to, shown before the row-by-row work.
   The rows below answer "is each one right?"; this answers the question people
   actually opened the file for -- where did the money go. It reads only rows
   that are going in, so the number always matches the Import button. */
function csvSpendPanel(r){
  var rows = (r.ready || []);
  if(rows.length < 3) return '';                    // two rows don't need a breakdown

  var byCat = {}, totalBase = 0;
  rows.forEach(function(c){
    var b = csvBaseAmt(c.amount);
    if(!(b > 0)) return;
    totalBase += b;
    var k = c.categoryName || CAT_FALLBACK;
    byCat[k] = (byCat[k] || 0) + b;
  });
  if(!totalBase) return '';

  var cats = Object.keys(byCat).map(function(k){ return { name:k, base:byCat[k] }; })
                   .sort(function(a,b){ return b.base - a.base; });
  var top = cats.slice(0, 3), max = top[0].base;

  // Months covered, so a 3-month statement doesn't read as one month of spending.
  var months = {};
  rows.forEach(function(c){ if(c.date) months[c.date.getFullYear()+'-'+c.date.getMonth()] = 1; });
  var nMonths = Object.keys(months).length;
  var sub = nMonths > 1
    ? L('trong ' + nMonths + ' tháng, ' + rows.length + ' khoản', 'across ' + nMonths + ' months, ' + rows.length + ' items')
    : L(rows.length + ' khoản', rows.length + ' items');

  var bars = top.map(function(t){
    var st = (window.catStyle && window.catStyle[t.name]) || ['\ud83c\udff7\ufe0f'];
    var pct = Math.round(t.base / totalBase * 100);
    return '<div class="csv-sum-row">'
      + '<div class="csv-sum-ico">' + st[0] + '</div>'
      + '<div class="csv-sum-body">'
        + '<div class="csv-sum-line"><span class="csv-sum-name">' + esc(t.name) + '</span>'
        + '<span class="csv-sum-amt">' + fmt(t.base) + '</span></div>'
        + '<div class="csv-sum-track"><i style="width:' + Math.max(6, Math.round(t.base / max * 100)) + '%"></i></div>'
      + '</div>'
      + '<div class="csv-sum-pct">' + pct + '%</div>'
    + '</div>';
  }).join('');

  var rest = cats.length - top.length;
  return '<div class="csv-sum">'
    + '<div class="csv-sum-cap">' + esc(L('Tổng chi trong file này','Total spending in this file')) + '</div>'
    + '<div class="csv-sum-total">' + fmt(totalBase) + '</div>'
    + '<div class="csv-sum-sub">' + esc(sub) + '</div>'
    + '<div class="csv-sum-bars">' + bars + '</div>'
    + (rest > 0 ? '<div class="csv-sum-rest">' + esc(L('và ' + rest + ' danh mục khác', 'and ' + rest + ' more categories')) + '</div>' : '')
    + '</div>';
}

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

/* isError separates "this can't go in" (red) from "worth a glance" (amber).
   Both live in the same section, but only one of them is a problem. */
/* Effective transaction time for a review row: an explicit edit (c.time, which
   may be '' to mean day-only) wins; otherwise derive the bank email's real time
   from its occurred_at. '' = no time (day-only). This is what the card shows and
   what promote stores, so the reviewed value is exactly what lands. */
function csvRowTime(c){
  if(c && c.time!==undefined) return c.time || '';
  return (window.fhStagedRowTime ? (window.fhStagedRowTime(c)||'') : '');
}
window.csvRowTime = csvRowTime;
/* The bank a staged row came from (source_provider — a clear column already
   fetched and used for dedup). Shown as plain text on the review cards so a
   reviewer can see at a glance whether a row is VIB, Vietcombank, MB… Empty
   outside staged mode and for file-import rows, which have no provider. */
function csvStagedProvider(c){
  if(!window.csvStagedMode || !c || typeof c.rowIndex!=='number') return '';
  var rows = window._fhStagedRows, r = rows && rows[c.rowIndex];
  var raw = (r && r.source_provider) || '';
  // one reader, one name: cards, Theo nguồn groups and standing routes all
  // pass through here, so canonicalising this line unifies all three
  return (typeof fhProviderName === 'function') ? fhProviderName(raw) : raw;
}
function csvCardHead(label, dateIso, removeFn, attn, isError, timeStr, provider, scope){
  var tone = isError ? ' attn' : (attn ? ' warn' : '');
  // Staged (bank-email) rows: ONE quiet meta line — scope · bank · date · time.
  // The generic "Khoản chi N" index says nothing here and stacking it beside the
  // rest overflowed the header into a broken two-line wrap; the description below
  // carries the real identity. Scope rides here too rather than on its own line.
  if (provider) {
    var when = dateIso ? esc(bulkDate(dateIso)) + (timeStr ? ' · ' + esc(timeStr) : '') : '';
    var parts = [];
    if (scope) parts.push('<span class="bulk-scope">'+esc(scope)+'</span>');
    parts.push('<span class="bulk-src'+tone+'">'+esc(provider)+'</span>');
    if (when) parts.push('<span class="bulk-when">'+when+'</span>');
    return '<span class="bulk-head bulk-head-src"><span class="bulk-meta">'
      + parts.join('<span class="bulk-sep">·</span>') + '</span></span>';
  }
  var meta = dateIso ? '<span class="bulk-date">'+esc(bulkDate(dateIso))+(timeStr?' · '+esc(timeStr):'')+'</span>' : '';
  return '<span class="bulk-head"><span class="bulk-idx'+tone+'">'+esc(label)+'</span>' + meta + '</span>';
}

function csvCollapsedCard(c, opts){
  var rm = opts.removeFn
    ? '<button type="button" class="bulk-x'+(opts.armed?' armed':'')+'" onclick="'+opts.removeFn+'"'
      + ' aria-label="'+escAttr(opts.armed ? L('Xác nhận xoá khoản này','Confirm removing this item') : L('Xoá khoản này','Remove this item'))+'">'
      + (opts.armed ? esc(L('Xoá?','Delete?')) : '✕') + '</button>'
    : '';
  /* A third 44px target, leading the row. Its own button rather than part of
     .bulk-tap, so ticking never opens the editor by accident — the same reason
     the ✕ is a sibling and not inside the tap area. */
  var ck = opts.checkFn
    ? '<button type="button" class="bulk-check'+(opts.checked?' on':'')+'" onclick="'+opts.checkFn+'"'
      + ' role="checkbox" aria-checked="'+(opts.checked?'true':'false')+'"'
      + ' aria-label="'+escAttr(L('Chọn khoản này để nhập','Select this item to import'))+'">'
      + '<i><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12.5 4.5 4.5L19 7"/></svg></i></button>'
    : '';
  return '<div class="bulk-card'+(opts.invalid?' invalid':(opts.attn?' attn':''))+'">' + ck
    + '<button type="button" class="bulk-tap" onclick="'+opts.tapFn+'" aria-label="'+L('Sửa khoản này','Edit this item')+'">'
    /* Scope now rides in the header meta line (csvCardHead), not on its own row.
       Both destinations are marked so the line always reads scope · bank · time. */
    + csvCardHead(opts.label, opts.dateIso, null, opts.invalid || opts.attn, opts.invalid, opts.timeStr, csvStagedProvider(c),
        (csvStagedMode && !opts.isDup) ? (csvRowScope(c)==='personal' ? L('🔒 Riêng tư','🔒 Private') : L('🏡 Gia đình','🏡 Family')) : '')
    + (opts.noPick
        ? '<span class="bc-note">'+esc(c.description||'')+'</span><span class="bc-meta">'+(c.amount!=null?'<span class="bc-amt">'+csvFmt(c.amount)+'</span>':'')+'</span>'
        : bulkSummary(csvRowShape(c, opts.isDup || opts.repeat)))
    + '</button>' + rm + '</div>';
}

/* Active card: the composer's expanded layout, rebuilt with its own fields.

   An earlier version MOUNTED the composer's live #ex-editor node here. That
   was elegant on paper and fragile in practice: one node, two modals, and
   promoting yanks it away mid-review (renderBulk() reclaims it), which left
   an expanded card with nothing in it. Same classes, same order, same look --
   but its own inputs, so neither surface can empty the other. */
function csvActiveCard(c, opts){
  var rm = opts.removeFn ? '<button type="button" class="bulk-x" onclick="'+opts.removeFn+'" aria-label="'+L('Xoá khoản này','Remove this item')+'">✕</button>' : '';
  var catChips = csvAllCats().map(function(name){
    var st=(window.catStyle&&window.catStyle[name])||['🏷️'];
    var act = opts.instantChips ? 'csvGroupPick(\''+escAttr(name)+'\')' : 'pick(\'csvedit-cats\',this)';
    return '<button type="button" class="choice'+(c && name===c.categoryName?' on':'')+'" data-v="'+escAttr(name)+'" onclick="'+act+'">'+st[0]+' '+esc(name)+'</button>';
  }).join('');

  var body = '';
  if(opts.note) body += '<div class="csv-expand-note">'+opts.note+'</div>';
  if(opts.fields){
    var mems = (window.FAM && window.FAM.members) || [];
    var whoSel = (c && c.who) || csvDefaultWho();
    var whoChips = mems.map(function(m){
      return '<button type="button" class="choice'+(m.name===whoSel?' on':'')+'" data-v="'+escAttr(m.name)+'" onclick="pick(\'csvedit-who\',this)">'+esc(m.name)+'</button>';
    }).join('') + '<button type="button" class="choice'+(whoSel==='Both'?' on':'')+'" data-v="Both" onclick="pick(\'csvedit-who\',this)">'+esc(LANG==='vi'?'Chung':'Both')+'</button>';

    body += '<div class="field"><label>'+L('Chi cho gì?','What for?')+'</label>'
      + '<input id="csvedit-note" value="'+escAttr(c.description||'')+'"/>'
      + '<div class="choices" id="csvedit-cats" style="margin-top:10px">'+catChips+'</div></div>'
      + '<div class="field-row">'
      + '<div class="field"><label>'+L('Số tiền','Amount')+'</label><input class="num" id="csvedit-amt" inputmode="numeric" onblur="snapAmtInput(this)" placeholder="'+escAttr(amtPlaceholder())+'" value="'+escAttr(c.amount!=null?csvAmtInputVal(c.amount):'')+'"/></div>'
      + '<div class="field"><label>'+L('Khi nào','When')+'</label><input type="date" id="csvedit-date" value="'+escAttr(c.dateDisplay||'')+'"/></div>'
      + '</div>'
      // Time carried from the bank email (occurred_at) — shown so the reviewer can
      // verify, correct or clear it before it's stored. Empty = day-only. Income
      // rows have no time column, so no field for them.
      + (!c.isIncome ? '<div class="field"><label>'+L('Giờ','Time')+' <span class="opt">'+L('tuỳ chọn','optional')+'</span></label><input type="time" id="csvedit-time" value="'+escAttr(csvRowTime(c))+'"/></div>' : '')
      + (csvStagedMode ? csvRowScopeField(c) : '')
      /* A private row has no member split — the same reason #ex-whofield hides
         when the expense modal is scoped personal. Asking "who paid" about a
         ledger with one member in it is a question with no wrong answer, which
         makes it noise. */
      + ((mems.length && !(csvStagedMode && csvRowScope(c)==='personal'))
          ? '<div class="field" style="margin-bottom:0"><label>'+L('Ai trả','Who paid')+'</label><div class="choices" id="csvedit-who">'+whoChips+'</div></div>' : '');
  } else {
    body += '<div class="field" style="margin-bottom:0"><label>'+L('Danh mục','Category')+'</label>'
      + '<div class="choices" id="csvedit-cats">'+catChips+'</div></div>';
  }
  if(opts.buttons) body += '<div class="dup-actions" style="margin-top:14px">'+opts.buttons+'</div>';

  // Tapping the header of an OPEN card collapses it — opts.tapFn is the same
  // csvToggleExpand that opened it, and it toggles, so re-firing it closes.
  // Expanding was tappable but collapsing wasn't; an up-chevron marks the header
  // as the way back. The × (remove) stays a separate sibling so the two 44px
  // targets never overlap.
  var headInner = csvCardHead(opts.label, opts.dateIso, null, opts.invalid || opts.attn, opts.invalid, opts.timeStr, csvStagedProvider(c), '');
  var head = opts.tapFn
    ? '<button type="button" class="bulk-collapse" onclick="'+opts.tapFn+'" aria-expanded="true" aria-label="'+escAttr(L('Thu gọn','Collapse'))+'">'
        + headInner
        + '<span class="bulk-chev" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 15 6-6 6 6"/></svg></span>'
      + '</button>'
    : headInner;
  return '<div class="bulk-card active'+(opts.invalid?' invalid':(opts.attn?' attn':''))+'">'
    + '<div class="bulk-head">'+head+rm+'</div>'
    + '<div class="csv-card-body">'+body+'</div></div>';
}

// Reads the expanded card's fields back onto its candidate.
function csvReadEditor(c){
  if(!c) return;
  var n=document.getElementById('csvedit-note');
  if(n && n.value.trim()) c.description = n.value.trim();
  var a=document.getElementById('csvedit-amt');
  if(a){ var v = window.classifyAmount ? window.classifyAmount(a.value||'') : null;
         if(v && v.status==='ok' && v.value > 0) c.amount = v.value; }
  var d=document.getElementById('csvedit-date');
  if(d && d.value){ c.dateDisplay = d.value; c.date = new Date(d.value+'T00:00:00'); }
  var ti=document.getElementById('csvedit-time');
  if(ti) c.time = ti.value || '';   // explicit reviewed value (incl. '' to clear → day-only)
  if(document.getElementById('csvedit-cats')){ var cat = chosen('csvedit-cats'); if(cat){ c.categoryName = cat; c.catSource='user'; } }
  if(document.getElementById('csvedit-who')){ var w = chosen('csvedit-who'); if(w) c.who = w; }
}

/* Per-ROW destination. It was one control for the whole pass, and the argument
   for that was real — selection x batch-scope covers a mixed batch in two taps.
   But it made the destination a property of the IMPORT when it is a property of
   the TRANSACTION: a lunch with the family and a private coffee arrive in the
   same email batch, and asking about them together is asking the wrong question.

   c._scope holds it. Unset means "not decided yet", which falls back to the
   remembered default rather than being written eagerly — so a row you never
   opened still goes where you last said, and a row you DID open remembers what
   you said about that row. */
function csvRowScope(c){
  if(!c) return csvStagedScope();
  if(c._scope === 'personal' && !csvScopeReady()) return 'family';   // locked ledger: never strand a row
  if(c._scope) return c._scope;
  /* standing per-source route (Theo nguồn): later arrivals from a routed bank
     default to its ledger without anyone re-picking */
  var p = (typeof csvStagedProvider === 'function' && csvStagedProvider(c)) || '';
  var routed = p && typeof csvTxrRoutes !== 'undefined' && csvTxrRoutes[p];
  if(routed === 'personal' && !csvScopeReady()) routed = null;
  return routed || csvStagedScope();
}
/* Acts on whichever row is open — only one ever is (csvExpand). Reads the rest
   of the editor first, or switching destination would discard an amount or a
   category typed a moment earlier. */
function csvPickRowScope(v){
  var c = csvExpandedCandidate();
  if(!c) return;
  if(v==='personal' && !csvScopeReady()){
    window.toast && window.toast(L('Mở khoá sổ cá nhân ở tab Cá nhân trước','Unlock your personal ledger first'));
    return;
  }
  csvReadEditor(c);
  c._scope = v;
  csvSetScope(v);              // and it becomes the default for rows not yet decided
  renderCsvReview();
}
function csvExpandedCandidate(){
  if(!csvExpand || !csvReview) return null;
  if(csvExpand.kind==='ready') return csvReview.ready[csvExpand.idx] || null;
  if(csvExpand.kind==='dup')   return (csvReview.dup[csvExpand.idx]||{}).c || null;
  if(csvExpand.kind==='defer') return csvReview.deferred[csvExpand.idx] || null;
  if(csvExpand.kind==='group'){
    var g = csvReview.groups[csvExpand.gi]; return g ? (g.items[csvExpand.idx]||null) : null;
  }
  return null;
}

function csvIsOpen(kind, idx){ return csvExpand && csvExpand.kind===kind && csvExpand.idx===idx; }

function renderCsvReview(){
  var out=document.getElementById('csv-result'); if(!out || !csvReview) return;
  var r = csvReview;
  var unresolvedDup = r.dup.filter(function(d){return d.resolved===null;});
  var total = r.ready.length + r.groups.reduce(function(n,g){return n+g.items.length;},0)
    + unresolvedDup.length + r.deferred.length;

  // File-only header (filename chip + Add-another-file + Start-over). Staged bank-
  // email review has no file to add or re-pick, so this whole block is suppressed
  // there -- leaving it in put a file picker and a flow-resetting "Start over" in
  // a screen that has neither, which is what read as broken.
  var fileNames = csvStagedMode ? [] : (r.sources||[]).map(function(s){ return s.name; }).filter(Boolean);
  var html = csvStagedMode ? '' : ('<div class="csv-files">'
    + (fileNames.length ? '<div class="csv-files-list">'+esc(fileNames.join(' · '))+'</div>' : '')
    + '<div class="dup-actions">'
    + '<button type="button" class="btn-line" onclick="document.getElementById(\'csv-file-input\').click()">'+L('Thêm file','Add another file')+'</button>'
    + '<button type="button" class="btn-text-quiet" onclick="csvPickAnother()">'+L('Bắt đầu lại','Start over')+'</button>'
    + '</div></div>');
  if(r.problems && r.problems.length){
    html += '<div class="notice-card stack"><div class="notice-text"><b>'+esc(L('Không đọc được:','Couldn\'t read:'))+'</b> '+esc(r.problems.join(' · '))+'</div></div>';
  }

  if(r.mixedSignsNote){
    html += '<div class="notice-card"><svg class="notice-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16h.01"/></svg>'
      + '<div class="notice-text">'+(csvStagedMode
          ? L('Có cả số tiền dương và âm, nên có thể lẫn cả tiền vào lẫn tiền ra. Tụi mình chưa nhập khoản nào. Khoản nào đúng là khoản chi, bạn chạm để xác nhận.','These have both positive and negative amounts, so money in may be mixed with money out. Nothing was imported. Tap any row that really is an expense to confirm it.')
          : L('Cột số tiền có cả số dương và số âm, nên file này có thể lẫn cả tiền vào lẫn tiền ra. Tụi mình chưa nhập khoản nào. Khoản nào đúng là khoản chi, bạn chạm để xác nhận.','The amount column has both positive and negative numbers, so this file may mix money in with money out. Nothing was imported. Tap any row that really is an expense to confirm it.'))+'</div></div>';
  }

  /* Category disclosure. Default path: we already adopted the file's own
     names -- say so plainly, with an undo. After an undo it flips back to an
     offer, so the choice is never one-way. */
  // Staged bank-email review is a short, human list, not a file-import workbench:
  // the whole category-disclosure notice (merges / adds / "N unclear, filed under
  // Others") is import-batch bookkeeping. Each card already carries its own status
  // label, so this block is pure noise here — suppress it entirely in staged mode.
  var didMerge = (r.catMerges||[]).length, didAdd = (r.adoptedCats||[]).length;
  if(!csvStagedMode && (didMerge || didAdd || r.fallbackCount || r.patternCount || r.summaryCount || (csvReview.ready||[]).some(function(c){return c.catSource==='learned';}))){
    /* Two volumes only. The bold line is what CHANGED the family's data --
       categories merged or created -- because that's the one auto-applied
       decision someone might want to reverse, and the undo sits under it.
       Every routine mechanic (skipped totals, blanks, learned repeats,
       pattern guesses, Others fallbacks) collapses to one muted line of
       counts: disclosed, never dropped, but no longer shouting. */
    var lines = [];
    if(didMerge || didAdd){
      var catBits = [];
      if(didMerge) catBits.push(esc(L('Đã gộp: ','Merged: ')) + esc(r.catMerges.map(function(m){ return '"'+m.from+'" → '+m.to; }).join(' · ')));
      if(didAdd) catBits.push(esc(L('Thêm mới: ','Added: ')) + esc(r.adoptedCats.map(function(n){ return csvCatEmoji(n)+' '+n; }).join(' · ')));
      lines.push('<div class="notice-text"><b>'+catBits.join('&ensp;·&ensp;')+'</b></div>');
    }
    var learnedCount = (csvReview.ready||[]).filter(function(c){ return c.catSource==='learned'; }).length;
    var mech = [];
    if(r.summaryCount) mech.push(esc(L(r.summaryCount+' dòng tổng', r.summaryCount+' total row'+(r.summaryCount===1?'':'s'))));
    if(r.blankCount) mech.push(esc(L(r.blankCount+' dòng không phải giao dịch', r.blankCount+' non-transaction row'+(r.blankCount===1?'':'s'))));
    if(r.summaryCount || r.blankCount) mech[0] = esc(L('bỏ qua ','skipped ')) + mech[0];
    if(learnedCount) mech.push(esc(L(learnedCount+' khoản xếp theo lần sửa trước', learnedCount+' from your past corrections'))
      + ' <button type="button" class="csv-linkbtn" onclick="csvForgetLearned()">'+L('quên đi','forget')+'</button>');
    if(r.patternCount) mech.push(esc(L(r.patternCount+' theo thói quen', r.patternCount+' from habits')));
    if(r.fallbackCount) mech.push(esc(L(r.fallbackCount+' chưa rõ, tạm để '+CAT_FALLBACK, r.fallbackCount+' unclear, filed under '+CAT_FALLBACK)));
    if(mech.length) lines.push('<div class="notice-text notice-tip"'+(lines.length?' style="margin-top:6px"':'')+'>'
      + mech.join(' · ') + '</div>');
    html += '<div class="notice-card stack">' + lines.join('')
      + ((didMerge||didAdd) ? '<button type="button" class="btn-text-quiet" style="width:100%;margin:6px 0 0" onclick="csvUndoAdopt()">'+L('Để tôi tự chọn danh mục','Let me pick categories myself')+'</button>' : '')
      + '</div>';
  } else if(!csvStagedMode && !r.mixedSignsNote && r.fileCats && r.fileCats.length){
    html += '<div class="notice-card stack">'
      + '<div class="notice-text"><b>'+esc(L('File này dùng '+r.fileCats.length+' danh mục bạn chưa có:','This file uses '+r.fileCats.length+(r.fileCats.length===1?' category':' categories')+' you don\'t have yet:'))+'</b> '
      + esc(r.fileCats.map(function(n){ return csvCatEmoji(n)+' '+n; }).join(' · '))+'</div>'
      + '<button type="button" class="btn-line" style="width:100%;margin:10px 0 0" onclick="csvAdoptFileCategories()">'+L('Thêm và xếp giúp tôi','Add them and sort for me')+'</button>'
      + '</div>';
  }

  /* "Cần bạn xem" is for rows that genuinely can't go in -- no date, no
     amount, or no category to file them under. Everything we could resolve
     imports, even when we had to guess: a guess still carries its amber
     label and stays one tap from being changed, which is a better trade than
     making someone confirm forty rows we already got right.

     handledHtml is the middle ground: money in and duplicates, both decided
     for the user and both reversible, shown so neither disappears quietly. */
  var attnHtml = '', handledHtml = '';
  r.groups.forEach(function(g, gi){
    var head = g.items[0].description + (g.items.length>1 ? ' · '+g.items.length+' '+L('khoản','items') : '');
    var proxy = { description:g.items[0].description, amount:g.items.reduce(function(s,it){return s+it.amount;},0), categoryName:null, dateDisplay:g.items[0].dateDisplay, rowIndex:g.items[0] && g.items[0].rowIndex };
    var o = { label:head, dateIso:g.items[0].dateDisplay, attn:true,
              tapFn:"csvToggleExpand('group',"+gi+")", removeFn:"csvSkipGroup("+gi+")" };
    attnHtml += csvIsOpen('group', gi)
      ? csvActiveCard(proxy, Object.assign({}, o, { instantChips:true }))
      : csvCollapsedCard(proxy, o);
  });
  r.dup.forEach(function(d, di){
    if(d.resolved!==null) return;
    var o = { label:L('Có thể trùng','Possible duplicate'), dateIso:d.c.dateDisplay, attn:true, isDup:true,
              _handled:true,
              tapFn:"csvToggleExpand('dup',"+di+")", removeFn:"csvDupSkip("+di+")" };
    /* The tick is the ONE include verb, parked rows included: on a duplicate it
       IS "Vẫn nhập" — unchecked at rest (parked = out of the import, honestly),
       one tap moves the row into the ready list, checked and counted. The
       expand path with its explanation stays for anyone who wants the why. */
    if(csvStagedMode){
      o.checkFn = "csvDupTick("+di+")"; o.checked = false;
      /* Hien's card law (a34d6d2): a collapsed card is tick-to-include, and
         delete lives only one deliberate step away. The tick claims the right
         gutter; Bỏ qua stays on the expanded card where its explanation is. */
      o.removeFn = null;
    }
    if(!csvIsOpen('dup', di)){ handledHtml += csvCollapsedCard(d.c, o); return; }
    /* duplicateOfPipeline and duplicateOfSource are the same finding from two
       places -- the pipeline spotted it at 3am, this screen spotted it just now
       -- and which layer noticed is not something anyone reviewing a receipt
       cares about. One line for both; the flags stay separate for tests. */
    var why = d.c.duplicateOfExisting
      ? L('Trùng với một giao dịch đã có trong sổ: cùng số tiền, trong vòng 3 ngày.','Matches a transaction already in your ledger: same amount, within 3 days.')
      : (d.c.duplicateOfPipeline || d.c.duplicateOfSource)
      ? L('Có một email khác cùng số tiền, từ nguồn khác, trong vòng 3 ngày. Có thể là một lần chi được báo hai lần.','There is another email for the same amount, from a different source, within 3 days. This may be one purchase reported twice.')
      : csvStagedMode
        ? L('Xuất hiện 2 lần với cùng nội dung và số tiền.','Appears twice with the same description and amount.')
        : L('Xuất hiện 2 lần trong file này với cùng nội dung và số tiền.','Appears twice in this file with the same description and amount.');
    handledHtml += csvActiveCard(d.c, Object.assign({}, o, { fields:true, note:esc(why),
      buttons: '<button type="button" class="btn-line" onclick="csvDupInclude('+di+')">'+L('Vẫn nhập','Import anyway')+'</button>'
             + '<button type="button" class="btn-text-quiet" onclick="csvDupSkip('+di+')">'+L('Bỏ qua','Skip')+'</button>' }));
  });
  /* Money in doesn't get cards at all. The ledger records expenses only, so
     there is no decision to put in front of anyone -- a stack of bordered
     cards implied one. One quiet line says what was left out and expands to
     show the rows; a mislabelled expense has its own way back in there. */
  var inflow = [];
  r.deferred.forEach(function(c, di){
    if(c.isIncome || c.isTransfer){ inflow.push({ c:c, di:di }); return; }
    var why = c.flags.indexOf('date_missing')>=0 ? L('Thiếu ngày','Missing date')
      : c.flags.indexOf('amount_missing')>=0 ? L('Thiếu số tiền','Missing amount')
      : L('Chờ bạn xác nhận','Waiting on you');
    var blocking = c.flags.indexOf('date_missing')>=0 || c.flags.indexOf('amount_missing')>=0;
    var o = { label:why, dateIso:c.dateDisplay, timeStr:csvRowTime(c), invalid:blocking, attn:!blocking,
              tapFn:"csvToggleExpand('defer',"+di+")", removeFn:"csvDeferDrop("+di+")" };
    if(!csvIsOpen('defer', di)){
      if(blocking) attnHtml += csvCollapsedCard(c, o); else handledHtml += csvCollapsedCard(c, o);
      return;
    }
    var card = csvActiveCard(c, Object.assign({}, o, { fields: true,
      note: (c.flags.indexOf('date_missing')<0 && c.flags.indexOf('amount_missing')<0)
        ? esc(csvStagedMode
            ? L('Có cả số tiền dương và âm, nên tụi mình chưa rõ khoản nào là chi. Nếu đây là khoản chi, bấm Nhập khoản này.','The amounts are both positive and negative, so we can\'t tell which rows are spending. If this one is, tap Import this one.')
            : L('Cột số tiền trong file này vừa có số dương vừa có số âm, nên tụi mình chưa rõ khoản nào là chi. Nếu đây là khoản chi, bấm Nhập khoản này.','This file\'s amount column mixes positive and negative numbers, so we can\'t tell which rows are spending. If this one is, tap Import this one.')) : null,
      buttons: '<button type="button" class="btn-line" onclick="csvDeferConfirm('+di+')">'+L('Nhập khoản này','Import this one')+'</button>'
             + '<button type="button" class="btn-text-quiet" onclick="csvDeferDrop('+di+')">'+L('Bỏ khỏi danh sách','Remove from list')+'</button>' }));
    if(blocking) attnHtml += card; else handledHtml += card;
  });
  /* Anything we had to GUESS at joins the review section, even though it's
     importable: a catch-all default or a pattern hunch is exactly what someone
     wants to glance at, and burying it under 40 confident rows hides it.
     Confidence decides WHERE a row renders, never whether it imports. */
  var lowConf = [];
  r.ready.forEach(function(c, i){
    if(c.catSource === 'fallback' || c.catSource === 'pattern') lowConf.push({ c:c, i:i });
  });
  var lowConfLabel = {};
  lowConf.forEach(function(e){
    lowConfLabel[e.i] = e.c.catSource === 'fallback'
      ? L('Chưa rõ danh mục','No clear category')
      : L('Đoán theo thói quen','Guessed from your habits');
  });

  var blockedCount = r.deferred.filter(function(c){
    return c.flags.indexOf('date_missing')>=0 || c.flags.indexOf('amount_missing')>=0;
  }).length;
  var decisionCount = r.groups.length + blockedCount;
  var inflowCount = r.deferred.filter(function(c){ return c.isIncome || c.isTransfer; }).length;
  var handledCount = unresolvedDup.length + (r.deferred.length - blockedCount - inflowCount);

  // Lead with the win, not the workload.
  // In staged mode this is what will ACTUALLY be written, so the top summary, the
  // Import label and its disabled state all agree with the ticks.
  var readyCount = csvStagedMode ? csvStagedSelected().length : r.ready.length;
  if(csvStagedMode){
    /* No in-list summary here any more. The staged review's summary, selection
       tools all live in the #txh header BETWEEN the nav and
       this scroller (csvTxrHeadSync below) — in the flow they kept sliding
       under whatever was sticky, which is the complaint that redesign answered. */
  } else {
    var summaryLine;
    if(r.mixedSignsNote) summaryLine = esc(L(total+' giao dịch tìm thấy', total+' transactions found'));
    else if(decisionCount===0 && readyCount>0) summaryLine = esc(L('Đã xếp xong cả '+readyCount+' khoản. Lướt qua rồi nhập thôi.','All '+readyCount+' sorted. Skim and import.'));
    else if(readyCount>0) summaryLine = esc(L('Đã xếp '+readyCount+' khoản, còn '+decisionCount+' khoản thiếu thông tin.',readyCount+' sorted, '+decisionCount+' missing something.'));
    else summaryLine = esc(L(total+' giao dịch tìm thấy', total+' transactions found'));
    html += '<div class="review-summary">'+summaryLine+'</div>';
    html += csvSpendPanel(r);   // the file breakdown panel is import-only
  }

  if(attnHtml){
    html += '<div class="group-h attn">'+L('Cần bạn xem','Needs a look')+'</div><div class="csv-cards">'+attnHtml+'</div>';
  }
  /* Decided, not asked: money in and duplicates stay out of the import, and
     each card still offers the way back in. */
  if(handledHtml){
    html += '<div class="group-h">'+L('Tụi mình để riêng','Set aside')+' · '+handledCount+'</div>'
          + '<div class="csv-cards">'+handledHtml+'</div>';
  }
  if(inflow.length){
    var inflowSum = inflow.reduce(function(t,e){ return t + csvBaseAmt(e.c.amount); }, 0);
    var nIn = inflow.filter(function(e){ return e.c.isIncome; }).length;
    var nTr = inflow.length - nIn;
    var inflowTitle = nIn && nTr ? L('Tiền vào & trả nợ thẻ · '+inflow.length+' khoản','Money in & card payments · '+inflow.length)
                    : nTr ? L('Trả nợ thẻ · '+nTr+' khoản','Card payments · '+nTr)
                    : L('Tiền vào · '+nIn+' khoản','Money in · '+nIn);
    var inflowSub = nTr
      ? L('Không nhập, vì khoản chi thật nằm trong sao kê thẻ. Nhập cả hai sẽ bị tính hai lần.','Not imported: the real spending is on the card statement, and importing both counts it twice.')
      : L('Không nhập, tụi mình chỉ ghi khoản chi','Not imported, spending only');
    html += '<div class="csv-inflow">'
      + '<button type="button" class="csv-inflow-head" onclick="csvToggleInflow()">'
        + '<span class="csv-inflow-txt"><span class="csv-inflow-t">'+esc(inflowTitle)+'</span>'
        + '<span class="csv-inflow-s">'+esc(inflowSub)+'</span></span>'
        + '<span class="csv-inflow-amt">'+esc(fmt(inflowSum))+'</span>'
        + '<span class="csv-inflow-chev">'+(csvInflowOpen?'▴':'▾')+'</span>'
      + '</button>';
    if(csvInflowOpen){
      inflow.forEach(function(e){
        var open = csvInflowDetail === e.di;
        html += '<button type="button" class="csv-inflow-row'+(open?' open':'')+'" onclick="csvInflowToggle('+e.di+')">'
          + '<span class="csv-inflow-d">'+esc(e.c.dateDisplay ? fmtDayMon(e.c.date) : '')+'</span>'
          + '<span class="csv-inflow-n">'+esc(e.c.description)+'</span>'
          + '<span class="csv-inflow-a">'+esc(csvFmt(e.c.amount))+'</span>'
        + '</button>';
        if(open){
          /* The open row above already shows date, memo (now unclipped) and
             amount -- the detail only ADDS what the row can't: who the money
             went to, why it was held (only when that isn't the section's own
             title), and the way back in. */
          html += '<div class="csv-inflow-detail">'
            + (e.c.counterparty ? '<div class="csv-inflow-meta">'+esc(e.c.counterparty)+'</div>' : '')
            + (e.c.isTransfer && nIn ? '<div class="csv-inflow-meta">'+esc(L('Giữ lại vì là khoản trả nợ thẻ','Held as a card payment'))+'</div>' : '')
            + '<button type="button" class="csv-linkbtn csv-inflow-take" onclick="csvDeferConfirm('+e.di+')">'+L('Là khoản chi, nhập vào','It\'s spending, import it')+'</button>'
          + '</div>';
        }
      });
    }
    html += '</div>';
  }

  /* Ready list, grouped by date (newest first) -- same cards, no red border. */
  if(r.ready.length){
    var dateBuckets = {};
    r.ready.forEach(function(c, i){
      var k = c.dateDisplay || ''; (dateBuckets[k] = dateBuckets[k] || []).push({ c:c, i:i });
    });
    var keys = Object.keys(dateBuckets).sort().reverse();
    // The "Ready · N" banner is import-batch framing; staged review is already all
    // ready, so it just adds a count nobody needs. Keep the per-date headers only.
    if(!csvStagedMode) html += '<div class="group-h">'+L('Sẵn sàng','Ready')+' · '+readyCount+'</div>';
    keys.forEach(function(k){
      var label = k ? fmtDayMon(dateBuckets[k][0].c.date) : L('Không rõ ngày','No date');
      html += '<div class="group-h" style="margin-top:10px">'+esc(label)+'</div><div class="csv-cards">';
      dateBuckets[k].forEach(function(e){
        var isRepeat = !!(e.c.duplicateOfBatch || e.c.duplicateOfExisting
                          || e.c.duplicateOfPipeline || e.c.duplicateOfSource);
        var o = { label:lowConfLabel[e.i] || (L('Khoản chi ','Item ')+(e.i+1)), dateIso:e.c.dateDisplay,
                  timeStr:csvRowTime(e.c),
                  attn:!!lowConfLabel[e.i], repeat:isRepeat,
                  tapFn:"csvToggleExpand('ready',"+e.i+")", removeFn:"csvReadyRemove("+e.i+")" };
        if(csvStagedMode){ o.checkFn = "csvStagedToggle("+e.i+")"; o.checked = !e.c._skipImport;
                           o.armed = (csvArmedRemove === e.i); }
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
  // Staged mode shows its single summary at the TOP (csv-staged-sum) instead, so
  // the bottom trust strip — a second box saying the same count + total — is gone.
  if(!csvStagedMode && (readyCount > 0 || decisionCount > 0)){
    var sumBase = r.ready.reduce(function(s,c){ return s + csvBaseAmt(c.amount); }, 0);
    var dates = r.ready.map(function(c){ return c.date; }).filter(Boolean).sort(function(a,b){ return a-b; });
    var span = dates.length ? (fmtDayMon(dates[0]) + (dates.length>1 ? ' – ' + fmtDayMon(dates[dates.length-1]) : '')) : '';
    var skippedDup = r.dup.filter(function(d){ return d.resolved==='skip'; }).length;
    // Staged mode gets the total line only — the "read N rows from the file" and
    // "not importing…" disclosures are file-import accounting, and the nav Save
    // already says "Nhập N", so anything more is the exact clutter to cut.
    html += '<div class="csv-check">'
      + '<div class="csv-check-main">'+esc(L('Sẽ nhập '+readyCount+' khoản · tổng '+fmt(sumBase), 'Importing '+readyCount+' · total '+fmt(sumBase)))+'</div>'
      + (csvStagedMode ? '' : (
          (span ? '<div class="csv-check-sub">'+esc(span)+' · '+esc((r.sources&&r.sources.length>1)
            ? L('đọc '+r.parsed.rows.length+' dòng từ '+r.sources.length+' file','read '+r.parsed.rows.length+' rows from '+r.sources.length+' files')
            : L('đọc '+r.parsed.rows.length+' dòng từ file','read '+r.parsed.rows.length+' rows from the file'))+'</div>' : '')
        + (decisionCount+skippedDup+inflowCount > 0
            ? '<div class="csv-check-sub">'+esc(L('Không nhập: ','Not importing: '))
              + esc([ decisionCount ? decisionCount+' '+L('chưa quyết định','undecided') : null,
                      inflowCount ? inflowCount+' '+L('tiền vào / trả thẻ','money in / card payments') : null,
                      skippedDup ? skippedDup+' '+L('bỏ qua vì trùng','skipped as duplicates') : null ]
                    .filter(Boolean).join(' · '))+'</div>'
            : '')))
      + '</div>';
  }

  out.classList.toggle('staged', !!csvStagedMode);   // scopes the calm-list CSS overrides (74-mailbox.css)
  out.innerHTML = html;
  var pick=document.getElementById('csv-pick'); if(pick) pick.style.display='none';

  csvPersistDraft();

  // Nav-bar Save, gated -- always reachable, grey until importable.
  var save = document.getElementById('csv-save');
  if(save){ save.disabled = (readyCount===0); save.textContent = readyCount>0 ? L('Nhập '+readyCount,'Import '+readyCount) : L('Nhập','Import'); }

  // The tools header lives OUTSIDE this scroller; sync it with every render so
  // its counts always agree with the ticks. Clears itself in the file flow.
  csvTxrHeadSync();
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
  if(c){ csvReadEditor(c); if(typeof csvLearnFrom === 'function') csvLearnFrom(c); }
}

function csvToggleExpand(kind, idx){
  csvDisarmRemove();                 // a tap elsewhere is not a confirmation
  if(csvIsOpen(kind, idx)){ csvFlushExpand(); csvExpand = null; }
  else { csvFlushExpand(); csvExpand = { kind:kind, idx:idx }; }
  renderCsvReview();
}

function csvExpandDone(){ csvFlushExpand(); csvExpand = null; renderCsvReview(); }

/* Learning happens on the way OUT of an edit, and only from an explicit pick
   -- csvReadEditor stamps catSource:'user' when the person chose a chip. */
function csvLearnFromOpen(){
  if(!csvExpand || !csvReview) return;
  var c = csvExpand.kind==='ready' ? csvReview.ready[csvExpand.idx]
        : csvExpand.kind==='dup'   ? (csvReview.dup[csvExpand.idx]||{}).c
        : csvExpand.kind==='defer' ? csvReview.deferred[csvExpand.idx] : null;
  if(c && typeof csvLearnFrom === 'function') csvLearnFrom(c);
}

function csvSkipGroup(gi){ if(!csvReview) return; csvReview.groups.splice(gi,1); csvExpand=null; renderCsvReview(); }
/* Selection in the bank-email queue. Absence of a flag means INCLUDED, so a row
   arriving in ready() later — a group that just got a category, a duplicate the
   person included — is imported by default like every other ready row, without
   anything having to remember to tick it.

   Unticking is how you say "not this time". It is not a dismissal: the row is
   never handed to retirement, so it is still in the queue tomorrow. That is the
   difference between this and the ✕, which retires the row for good. */
function csvStagedSelected(){
  return ((csvReview && csvReview.ready) || []).filter(function(c){ return !c._skipImport; });
}
function csvStagedToggle(i){
  if(!csvReview) return;
  var c = csvReview.ready[i]; if(!c) return;
  if(typeof csvTxrSmartKey !== 'undefined') csvTxrSmartKey = null;   // a hand-tick overrides the chip's claim
  csvDisarmRemove();                 // ticking is not confirming a delete
  c._skipImport = !c._skipImport;
  csvSelTouched = true;              // a tick is the person saying "I am picking"
  /* Close whatever row was open, like every other row action here does. Flush
     FIRST: csvFlushExpand reads the open editor's fields back onto its candidate,
     and re-rendering without it throws away a description or amount someone was
     part-way through typing. The handlers that skip the flush (csvReadyRemove and
     friends) can only do so because the row they touch is being removed anyway. */
  csvFlushExpand(); csvExpand = null;
  renderCsvReview();                 // count, total and the Import label all follow
}

/* ---- acting on the whole selection -------------------------------------- */
/* Every staged row arrives ticked, because the common case is "import the lot".
   That made the tick a one-way control: fine for importing, useless for picking
   out three rows to recategorise, and impossible to clear without N taps.

   So the ticks become a real selection, and the summary that describes it also
   controls it. What acts on that selection:
     Import  — already did (csvStagedSelected feeds fhPromoteStaged); it now has
               a way to mean "these three" instead of only "all of them".
     Category / destination — one pass instead of opening each card.
     ✕       — retire the selection, one RPC (fhStagedDropMany).

   Deliberately NOT a separate "edit mode" behind a Select button: the checkboxes
   are already on screen and already load-bearing for import, so a mode toggle
   would add a step to the common path to serve the rare one. */
var csvBulkArmed = false;    // the bulk delete has been tapped once (arm-then-confirm)
/* Has the person touched the selection at all?

   Gating the toolbar on "something is selected" would show it always, because
   every row arrives ticked — permanent chrome over the common path, which is
   glance and import. Gating it on INTENT keeps that path exactly as it was and
   brings the toolbar in the moment selecting starts, the way Photos only shows
   its action bar once you are picking. Reset on every rebuild. */
var csvSelTouched = false;

function csvBulkReset(){
  csvBulkArmed = false; csvSelTouched = false;
  csvTxrOpen = null; csvTxrRoom = 'sel'; csvTxrDim = 'all';
  csvTxrPendCat = null; csvTxrPendAll = null; csvTxrSrcStage = {};
  csvTxrSmartKey = null;
  csvTxrAuto = false; csvTxrKey = null;
}

function csvStagedSelectAll(on){
  if(!csvReview) return;
  csvDisarmRemove();
  csvFlushExpand(); csvExpand = null;   // an open editor's edits are kept, not dropped
  csvReview.ready.forEach(function(c){ c._skipImport = !on; });
  csvSelTouched = true;
  renderCsvReview();
}

/* One category across the selection. Learned from, exactly as a per-row chip is:
   this is the same explicit human pick, made once instead of forty times, and a
   lesson that generalised badly is undone the same way. */
function csvBulkCat(name){
  if(!csvReview) return;
  var sel = csvStagedSelected(); if(!sel.length) return;
  sel.forEach(function(c){
    c.categoryName = name; c.catSource = 'user';
    if(typeof csvLearnFrom === 'function') csvLearnFrom(c);
  });
  renderCsvReview();
  toast(esc(L('Đã xếp '+sel.length+' khoản vào '+name, 'Filed '+sel.length+' under '+name)));
}

/* One destination across the selection.

   It sets _scope on each SELECTED row and deliberately does not move the
   remembered default (csvSetScope), which the per-row picker does. Bulk-marking
   three rows private must not quietly redirect the thirty-seven nobody touched —
   those have no _scope, so they follow the default, and changing it here would
   move rows the person never selected. Explicit on the selection, untouched
   everywhere else. */
function csvBulkScope(v){
  if(!csvReview) return;
  var sel = csvStagedSelected(); if(!sel.length) return;
  if(v==='personal' && !csvScopeReady()){
    toast(L('Mở khoá sổ cá nhân ở tab Cá nhân trước','Unlock your personal ledger first'));
    return;
  }
  sel.forEach(function(c){ c._scope = v; });
  renderCsvReview();
}

/* Retire the selection. Arm-then-confirm (DESIGN: destructive is low-prominence
   and never one tap), and the armed label carries the COUNT — with everything
   ticked by default, "Xoá" and "Xoá 47 khoản?" are very different sentences and
   the person is entitled to read the second one before it happens.

   Keeps the unticked rows by filtering rather than splicing indices: the ticked
   set is scattered through ready[], and splicing it by index while iterating is
   the classic way to delete the wrong rows. */
function csvBulkDelete(){
  if(!csvReview) return;
  var sel = csvStagedSelected(); if(!sel.length) return;
  if(!csvBulkArmed){ csvBulkArmed = true; renderCsvReview(); return; }
  csvBulkArmed = false;
  csvReview.ready = csvReview.ready.filter(function(c){ return !!c._skipImport; });
  csvArmedRemove = null; csvExpand = null;
  renderCsvReview();
  // Same order as the single ✕: forget locally first, then tell the server.
  if(window.fhStagedDropMany) window.fhStagedDropMany(sel);
  toast(L('Đã xoá '+sel.length+' khoản','Removed '+sel.length));
}

/* ---- The staged-review tools header (#txh) --------------------------------

   One card between the nav and the scroller. The header row is the panel's
   whole voice — count, instruction, or what Xong is about to do — beside one
   text action (Thao tác hàng loạt ⇄ Xong). The panel below leads with its
   room pill (mode before matter), then the room.

   THE GRAMMAR, one verb per layer: a tap STAGES a draft (elevation, never a
   stroke — selection rises, it is not outlined); drafts are MECE across rooms
   and survive switching, and the header narrates the whole basket; XONG
   commits everything staged and closes; the ledger's true write stays Nhập.
   Delete is the one exception — its own room, arm-then-confirm with the
   count, and Xong never touches it.

   Rooms: Danh mục (the Telegram rail — rests as bare discs, blooms labels
   under the finger, the container height animating so growth is caused only
   by touch) · Ghi vào (dimension tabs: Tất cả = two-disc rail for the queue's
   default; Theo nguồn = one row per bank with a tiny two-icon switcher that
   LIFTS on press — haptic-touch lift: the control rises as an overlay, the
   panel softens behind a blur, choices appear at full identity, release
   stages) · Xoá (unchanged).

   Per-source routes persist (FH_SRC_ROUTES) and feed csvRowScope as the
   default for rows that arrive later — client-side "tự động từ giờ"; the
   pipeline-level version (sealing to the right key at staging time) is a
   planned follow-up, deliberately not smuggled in here.

   Motion rules: FLIP the panel between rooms (hold old height, swap, ease);
   in-place class updates for picks — a rebuild under the finger resets the
   rail's bloom, which reads as a dead control. */
var csvTxrOpen = null;        // null | 'bulk'
var csvTxrRoom = 'sel';       // 'sel' | 'cat' | 'scope' | 'del' — Chọn first: select, then edit
var csvTxrDim = 'all';        // Ghi vào dimension: 'all' | 'src'
var csvTxrPendCat = null;     // staged category
var csvTxrPendAll = null;     // staged default ledger ('personal'|'family')
var csvTxrSrcStage = {};      // staged per-source routes: provider -> ledger
var csvTxrAuto = false;       // auto-opened the panel once this build
var csvTxrKey = null;         // panel content key — rebuild only when it changes

var CSV_TXR_I_SEL = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6h9M4 12h9M4 18h9"/><path d="m15.5 11.5 2.5 2.5 5-5.5"/></svg>';

function csvTxrEmo(v){ return v === 'personal' ? '🔒' : '🏡'; }
function csvTxrLbl(v){ return v === 'personal' ? L('🔒 Cá nhân','🔒 Personal') : L('🏡 Gia đình','🏡 Family'); }

/* Standing per-source routes, remembered like the scope default is. Mirrored
   in a var so a blocked localStorage (private mode) degrades to session-only
   rules instead of none. */
var FH_SRC_ROUTES = 'fh-source-routes';
var csvTxrRoutes = (function(){
  try{
    var raw = JSON.parse(localStorage.getItem(FH_SRC_ROUTES) || '{}') || {};
    var out = {};
    Object.keys(raw).forEach(function(k){
      var ck = (typeof fhProviderName === 'function') ? fhProviderName(k) : k;
      out[ck] = out[ck] || raw[k];         // a route saved under 'MBBank' still routes 'MB Bank'
    });
    return out;
  }catch(e){ return {}; }
})();
function csvTxrRouteSave(){
  try{ localStorage.setItem(FH_SRC_ROUTES, JSON.stringify(csvTxrRoutes)); }catch(e){}
}

/* The queue grouped by source bank — the unit the Theo nguồn tab routes. */
function csvTxrGroups(){
  var groups = {};
  ((csvReview && csvReview.ready) || []).forEach(function(c, i){
    var p = (typeof csvStagedProvider === 'function' && csvStagedProvider(c)) || L('Khác','Other');
    (groups[p] = groups[p] || { n:0, sum:0, idx:[] });
    groups[p].n++; groups[p].sum += csvBaseAmt(c.amount); groups[p].idx.push(i);
  });
  return groups;
}

/* ---- the header row: one narrator ---- */
function csvTxrBasketHTML(){
  var bits = [];
  if(csvTxrPendCat){
    var st = (window.catStyle && window.catStyle[csvTxrPendCat]) || ['🏷️'];
    bits.push(st[0] + ' ' + csvTxrPendCat);
  }
  if(csvTxrPendAll) bits.push(csvTxrLbl(csvTxrPendAll));
  var routes = Object.keys(csvTxrSrcStage).length;
  if(routes) bits.push(routes + ' ' + L('tuyến nguồn','source routes'));
  return bits.length ? bits.join(' · ') : null;
}
function csvTxrRowHTML(){
  var sel = csvStagedSelected(), n = sel.length, sum = 0;
  sel.forEach(function(c){ sum += csvBaseAmt(c.amount); });
  var fig = n ? esc(fmt(sum)) : '<span class="dim">—</span>';
  var open = csvTxrOpen === 'bulk';
  if(!open){
    var cap = n ? L('Sẽ nhập '+n+' khoản','Importing '+n) : L('Chưa chọn khoản nào','Nothing selected');
    return '<span class="txh-sum"><small>'+esc(cap)+'</small><b>'+fig+'</b></span>'
      + '<button type="button" class="txh-act" onclick="csvTxrTool(\'bulk\')">'
      + esc(L('Chỉnh sửa hàng loạt','Bulk edit')) + '</button>';
  }
  /* A FIXED SHAPE: the words never change, only the two numbers do (and they
     are tabular, so even digits hold their ground). A caption that reshaped
     per state — narration here, instruction there — flicked with every tap;
     stability is the header keeping its word about where things live. The
     edit-count turns brand when the basket has content: color signals, length
     never does. Xong's toast still names the edits in full. */
  var k = (csvTxrPendCat ? 1 : 0) + (csvTxrPendAll ? 1 : 0) + Object.keys(csvTxrSrcStage).length;
  var allOn = n > 0 && n === csvReview.ready.length;
  var mg = (csvReview && csvReview.mergedCount) || 0;
  var small = '<span class="'+(k ? 'arm' : '')+'">'
    + esc(L('Sẽ nhập ','Importing ')) + '<span class="num">'+n+'</span>' + esc(L(' khoản',''))
    + ' · <span class="num">'+k+'</span> ' + esc(L('thao tác','edits'))
    + '</span>'
    /* Merged copies are counted out loud. They are gone from the list because
       there is nothing to decide about them, but a row that disappears without
       a word is the one failure this screen exists to prevent. */
    + (mg ? '<span class="txh-merged"> · ' + esc(L('đã gộp ' + mg + ' bản trùng', mg + ' merged')) + '</span>' : '')
    + ' <button type="button" class="txh-sublink" onclick="csvStagedSelectAll(' + (allOn ? 'false' : 'true') + ')">'
    + esc(allOn ? L('Bỏ chọn','Clear') : L('Chọn tất cả','Select all')) + '</button>';
  return '<span class="txh-sum"><small>'+small+'</small><b>'+fig+'</b></span>'
    + '<button type="button" class="txh-act on" onclick="csvTxrTool(\'bulk\')">'+esc(L('Xong','Done'))+'</button>';
}

/* ---- room bodies ---- */
function csvTxrCatRail(){
  return '<div class="txh-rail" id="txh-rail">' + csvAllCats().map(function(name){
    var st = (window.catStyle && window.catStyle[name]) || ['🏷️'];
    return '<button type="button" class="txh-it'+(csvTxrPendCat===name?' on':'')+'" data-v="'+escAttr(name)+'" onclick="csvTxrPickCat(this)">'
      + '<span class="e">'+st[0]+'</span><span class="l">'+esc(name)+'</span></button>';
  }).join('') + '</div>';
}
function csvTxrAllRail(){
  var it = function(v, vi, en){
    var cls = csvTxrPendAll === v ? ' on' : (csvStagedScope() === v && !csvTxrPendAll ? ' setd' : '');
    return '<button type="button" class="txh-it'+cls+'" data-v="'+v+'" onclick="csvTxrAllPick(\''+v+'\')">'
      + '<span class="e">'+csvTxrEmo(v)+'</span><span class="l">'+L(vi,en)+'</span></button>';
  };
  return '<div class="txh-rail txh-allrail" id="txh-rail">'
    + it('personal','Cá nhân','Personal') + it('family','Gia đình','Family') + '</div>';
}
function csvTxrSrcRows(){
  var g = csvTxrGroups(), ps = Object.keys(g).sort();
  return '<div class="txh-srcs">' + ps.map(function(p){
    var staged = csvTxrSrcStage[p];
    var cur = staged || csvTxrRoutes[p] || csvStagedScope();
    var seg = function(v){ return '<span class="'+(cur===v?'cur':'')+'">'+csvTxrEmo(v)+'</span>'; };
    return '<div class="txh-srcrow"><b>'+esc(p)+'</b>'
      + '<span class="m">'+g[p].n+' · '+esc(fmt(g[p].sum))+'</span>'
      + '<button type="button" class="txh-mini'+(staged?' on':(csvTxrRoutes[p]?'':' inh'))+'"'
        + ' data-p="'+escAttr(p)+'" data-cur="'+cur+'">'
        + seg('personal') + seg('family') + '</button>'
      + '</div>';
  }).join('') + '</div>';
}
/* ---- the Chọn room: select BEFORE you edit --------------------------------
   Rows arrive all-ticked for Import, so "selection" never used to happen as an
   intentional act — the panel now LANDS here. Chips name the sets that exist
   in the queue, with live counts: one tap claims a set, the same tap releases
   it, and a hand-tick anywhere releases the chip's claim (the person is
   overriding). Foraging by kind — pick "all ripe berries", never berry by
   berry. */
var csvTxrSmartKey = null;
function csvTxrSmartSets(){
  var ready = (csvReview && csvReview.ready) || [], maxT = 0;
  ready.forEach(function(c){ if(c.date && +c.date > maxT) maxT = +c.date; });
  var sets = [
    { k:'all',   label:L('Tất cả','All'),                   test:function(){ return true; } },
    { k:'nocat', label:L('Chưa có danh mục','No category'),  test:function(c){ return !c.categoryName; } },
    { k:'week',  label:L('Tuần này','This week'),            test:function(c){ return c.date && (maxT - +c.date) < 7 * 864e5; } },
  ];
  var banks = {};
  ready.forEach(function(c){ var p = (typeof csvStagedProvider === 'function' && csvStagedProvider(c)) || ''; if(p) banks[p] = 1; });
  Object.keys(banks).sort().forEach(function(p){
    sets.push({ k:'bank:'+p, label:L('Từ '+p,'From '+p), test:function(c){ return csvStagedProvider(c) === p; } });
  });
  return sets.map(function(x){ x.n = ready.filter(function(c){ return x.test(c); }).length; return x; })
             .filter(function(x){ return x.n > 0; });
}
function csvTxrSmartPick(k){
  var hit = null; csvTxrSmartSets().forEach(function(x){ if(x.k === k) hit = x; });
  if(!hit) return;
  if(csvTxrSmartKey === k){
    csvTxrSmartKey = null;
    (csvReview.ready || []).forEach(function(c){ c._skipImport = true; });
  } else {
    csvTxrSmartKey = k;
    (csvReview.ready || []).forEach(function(c){ c._skipImport = !hit.test(c); });
  }
  csvSelTouched = true; csvTxrKey = null;
  renderCsvReview();
}
function csvTxrSmartHTML(){
  return '<div class="txh-smart">' + csvTxrSmartSets().map(function(x){
    return '<button type="button" class="' + (csvTxrSmartKey === x.k ? 'on' : '') + '"'
      + ' onclick="csvTxrSmartPick(\'' + escAttr(x.k) + '\')">' + esc(x.label) + ' <span>' + x.n + '</span></button>';
  }).join('') + '</div>';
}

function csvTxrDimTabs(){
  var tab = function(d, label){
    return '<button type="button" class="'+(csvTxrDim===d?'on':'')+'" onclick="csvTxrDimGo(\''+d+'\')">'+esc(label)+'</button>';
  };
  return '<div class="txh-tabs">'+tab('all',L('Tất cả','All'))+tab('src',L('Theo nguồn','By source'))+'</div>';
}

function csvTxrBulkHTML(){
  var n = csvStagedSelected().length, dis = n ? '' : ' disabled';
  var room = function(k, label){
    return '<button type="button" class="'+(csvTxrRoom===k?'on ':'')+(k==='del'?'danger':'')+'" onclick="csvTxrRoomGo(\''+k+'\')">'+esc(label)+'</button>';
  };
  var h = '<div class="txh-bot"><span class="txh-rooms"><span>'
    + room('sel', L('Chọn','Select'))
    + room('cat', L('Danh mục','Category'))
    + room('scope', L('Ghi vào','Where'))
    + room('del', L('Xoá','Delete'))
    + '</span></span></div>';
  if(csvTxrRoom === 'sel'){
    h += csvTxrSmartHTML();
  } else if(csvTxrRoom === 'cat'){
    h += csvTxrCatRail();
  } else if(csvTxrRoom === 'scope'){
    h += csvTxrDimTabs() + (csvTxrDim === 'src' ? csvTxrSrcRows() : csvTxrAllRail());
  } else {
    h += '<div class="txh-del">'
      + '<span class="txh-del-txt'+(csvBulkArmed?' armed':'')+'">'
        + '<b>'+esc(csvBulkArmed ? L('Chắc chưa? Không hoàn tác được.','Sure? This cannot be undone.')
                                 : L('Gỡ '+n+' khoản đã chọn khỏi hàng chờ','Remove the '+n+' selected from the queue'))+'</b>'
        + '<span>'+esc(csvBulkArmed ? L('Chạm nút lần nữa để xoá.','Tap the button again to delete.')
                                    : L('Không hoàn tác được.','Cannot be undone.'))+'</span>'
      + '</span>'
      + '<button type="button" class="txh-delbtn'+(csvBulkArmed?' armed':'')+'"'+dis+' onclick="csvTxrDel()">'
        + esc(csvBulkArmed ? L('Xoá '+n+' khoản?','Delete '+n+'?') : L('Xoá '+n,'Delete '+n))+'</button>'
      + '</div>';
  }
  return h;
}

/* ---- sync: persistent skeleton, one key, FLIP between states ---- */
function csvTxrHeadSync(){
  var head = document.getElementById('txh'); if(!head) return;
  if(!csvStagedMode || !csvReview){ head.innerHTML = ''; csvTxrKey = null; csvTxrLiftClose(); return; }
  if(!head.firstChild){
    head.innerHTML = '<div class="txh-card">'
      + '<div class="txh-row" id="txh-row"></div>'
      + '<div class="txh-fold" id="txh-fold"><div><div class="txh-panel" id="txh-panel"></div></div></div>'
      + '</div>';
    csvTxrKey = null;
  }
  if(csvSelTouched && !csvTxrAuto){ csvTxrAuto = true; if(!csvTxrOpen) csvTxrOpen = 'bulk'; }

  document.getElementById('txh-row').innerHTML = csvTxrRowHTML();

  var n = csvStagedSelected().length;
  var stageKey = Object.keys(csvTxrSrcStage).sort().map(function(k){ return k + '=' + csvTxrSrcStage[k]; }).join(',');
  var key = [csvTxrOpen, csvTxrRoom, csvTxrDim, n, csvBulkArmed?1:0, LANG, csvReview.ready.length,
             csvTxrPendCat||'', csvTxrPendAll||'', csvTxrSmartKey||'', stageKey].join('|');
  var panel = document.getElementById('txh-panel');
  if(key !== csvTxrKey){
    /* FLIP: hold the height the eye already has, swap, ease to the new one.
       A teleport between room heights reads as breakage. */
    var before = panel.offsetHeight;
    csvTxrKey = key;
    panel.innerHTML = !csvTxrOpen ? '' : csvTxrBulkHTML();
    if(csvTxrOpen === 'bulk'){ csvTxrRailWire(); csvTxrLiftWire(); }
    var after = panel.scrollHeight;
    if(before && Math.abs(after - before) >= 3){
      panel.style.height = before + 'px';
      panel.offsetHeight;                        // commit the starting frame
      panel.style.height = after + 'px';
      var done = function(){ panel.style.height = ''; panel.removeEventListener('transitionend', done); };
      panel.addEventListener('transitionend', done);
    }
  }
  var fold = document.getElementById('txh-fold');
  if(csvTxrOpen && !fold.classList.contains('open')){
    (window.requestAnimationFrame || function(f){ f(); })(function(){ fold.classList.add('open'); });
  } else {
    fold.classList.toggle('open', !!csvTxrOpen);
  }
}

/* The rail grows under a touch and shrinks when it leaves — the container's
   own height animates, so the growth is smooth and caused only by the finger.
   Also grabbable with a mouse (drag → scrollLeft); a drag past 4px suppresses
   the click it would otherwise spawn. */
var csvTxrRailDragged = false;
function csvTxrRailWire(){
  var rail = document.getElementById('txh-rail'); if(!rail) return;
  var t = null;
  var big = function(){ clearTimeout(t); rail.classList.add('big'); };
  var calm = function(ms){ clearTimeout(t); t = setTimeout(function(){ rail.classList.remove('big'); }, ms); };
  rail.addEventListener('pointerenter', big);
  rail.addEventListener('pointerleave', function(){ calm(250); });
  rail.addEventListener('touchstart', big, { passive:true });
  rail.addEventListener('touchend', function(){ calm(900); }, { passive:true });
  rail.addEventListener('scroll', function(){ big(); calm(900); }, { passive:true });

  var sx = 0, sl = 0, down = false;
  rail.addEventListener('pointerdown', function(e){
    if(e.pointerType === 'touch') return;
    sx = e.clientX; sl = rail.scrollLeft; down = true;
  });
  rail.addEventListener('pointermove', function(e){
    if(!down) return;
    var dx = e.clientX - sx;
    if(Math.abs(dx) > 4){
      csvTxrRailDragged = true;
      rail.classList.add('dragging');
      try{ rail.setPointerCapture(e.pointerId); }catch(err){}
    }
    if(csvTxrRailDragged) rail.scrollLeft = sl - dx;
  });
  var end = function(){
    down = false; rail.classList.remove('dragging');
    setTimeout(function(){ csvTxrRailDragged = false; }, 0);
  };
  rail.addEventListener('pointerup', end);
  rail.addEventListener('pointercancel', end);
}

/* ---- the haptic-touch lift (Theo nguồn's ledger switch) ----
   Press the tiny two-icon switcher and it RISES out of the row as an overlay
   (the row provably never moves), the panel softening behind a blur; the two
   ledgers appear at full identity with a sliding thumb; swipe or tap; release
   stages. Scrim-tap cancels without staging — forgiveness. */
function csvTxrLiftClose(commitV, provider){
  var wrap = document.getElementById('txh-lift'); if(!wrap) return;
  wrap.classList.remove('show');
  setTimeout(function(){ if(wrap.parentNode) wrap.parentNode.removeChild(wrap); }, 240);
  if(commitV) csvTxrPickSrc(provider, commitV);
}
function csvTxrLiftOpen(btn){
  csvTxrLiftClose();
  var p = btn.getAttribute('data-p');
  var cur = btn.getAttribute('data-cur');
  var host = document.getElementById('csv-import-modal'); if(!host) return;
  var r = btn.getBoundingClientRect(), hr = host.getBoundingClientRect();
  var W = 188, H = 52;
  var left = Math.max(8, Math.min(r.right - hr.left - W, hr.width - W - 8));
  var top = r.top - hr.top + r.height / 2 - H / 2;
  var wrap = document.createElement('div');
  wrap.id = 'txh-lift'; wrap.className = 'txh-lift';
  wrap.innerHTML = '<div class="txh-lift-s"></div>'
    + '<div class="txh-lift-c" style="left:'+left+'px;top:'+top+'px;width:'+W+'px;height:'+H+'px">'
      + '<span class="txh-lift-th'+(cur==='family'?' r':'')+'"></span>'
      + '<button type="button" data-v="personal">🔒 '+L('Cá nhân','Personal')+'</button>'
      + '<button type="button" data-v="family">🏡 '+L('Gia đình','Family')+'</button>'
    + '</div>';
  host.appendChild(wrap);
  (window.requestAnimationFrame || function(f){ f(); })(function(){ wrap.classList.add('show'); });

  var card = wrap.querySelector('.txh-lift-c');
  var th = wrap.querySelector('.txh-lift-th');
  var side = cur;
  var setSide = function(v){ side = v; th.classList.toggle('r', v === 'family'); };
  wrap.querySelector('.txh-lift-s').addEventListener('pointerup', function(){ csvTxrLiftClose(); });
  var opts = card.querySelectorAll('button');
  for(var i = 0; i < opts.length; i++)(function(o){
    o.addEventListener('pointerup', function(e){
      e.stopPropagation();
      var v = o.getAttribute('data-v');
      setSide(v); setTimeout(function(){ csvTxrLiftClose(v, p); }, 140);
    });
  })(opts[i]);
  var sx = null;
  card.addEventListener('pointerdown', function(e){ sx = e.clientX; try{ card.setPointerCapture(e.pointerId); }catch(err){} });
  card.addEventListener('pointermove', function(e){
    if(sx == null) return;
    var dx = e.clientX - sx;
    if(dx > 24) setSide('family'); else if(dx < -24) setSide('personal');
  });
  card.addEventListener('pointerup', function(){
    if(sx == null) return; sx = null;
    var v = side;
    setTimeout(function(){ csvTxrLiftClose(v, p); }, 120);
  });
}
function csvTxrLiftWire(){
  var els = document.querySelectorAll('#txh .txh-mini');
  for(var k = 0; k < els.length; k++)(function(el){
    el.addEventListener('pointerdown', function(e){ e.preventDefault(); csvTxrLiftOpen(el); });
  })(els[k]);
}

/* ---- handlers: tap stages, rooms keep the basket, Xong commits ---- */
function csvTxrTool(k){
  csvDisarmRemove();
  if(csvTxrOpen === 'bulk'){                         // Xong: commit the basket, then close
    csvTxrCommitAll();
    csvTxrOpen = null; csvTxrRoom = 'sel'; csvTxrDim = 'all'; csvBulkArmed = false;
    csvTxrLiftClose();
    csvTxrKey = null; csvTxrHeadSync();
    return;
  }
  csvTxrOpen = 'bulk'; csvTxrRoom = 'sel'; csvBulkArmed = false;
  csvTxrKey = null; csvTxrHeadSync();
}
function csvTxrRoomGo(a){
  csvTxrRoom = a; csvBulkArmed = false;              // drafts SURVIVE the hop — rooms are MECE
  csvTxrKey = null; csvTxrHeadSync();
}
function csvTxrDimGo(d){ csvTxrDim = d; csvTxrKey = null; csvTxrHeadSync(); }

function csvTxrPickCat(btn){
  if(csvTxrRailDragged) return;                      // that was a pull, not a pick
  if(!csvStagedSelected().length) return;
  var v = btn.getAttribute('data-v');
  csvTxrPendCat = (csvTxrPendCat === v) ? null : v;  // toggle the stage
  var rail = document.getElementById('txh-rail');
  if(rail) for(var i = 0; i < rail.children.length; i++)
    rail.children[i].classList.toggle('on', !!csvTxrPendCat && rail.children[i].getAttribute('data-v') === csvTxrPendCat);
  var row = document.getElementById('txh-row'); if(row) row.innerHTML = csvTxrRowHTML();
}
function csvTxrAllPick(v){
  if(v === 'personal' && !csvScopeReady()){
    toast(L('Mở khoá sổ cá nhân ở tab Cá nhân trước','Unlock your personal ledger first'));
    return;
  }
  csvTxrPendAll = (csvTxrPendAll === v) ? null : v;
  /* in place — a rebuild here would swap the rail mid-touch and reset its
     bloom, which reads as a dead control next to the category rail */
  var rail = document.getElementById('txh-rail');
  if(rail) for(var i = 0; i < rail.children.length; i++){
    var el = rail.children[i], ev = el.getAttribute('data-v');
    el.classList.toggle('on', csvTxrPendAll === ev);
    el.classList.toggle('setd', csvStagedScope() === ev && !csvTxrPendAll);
  }
  var row = document.getElementById('txh-row'); if(row) row.innerHTML = csvTxrRowHTML();
}
function csvTxrPickSrc(p, v){
  if(v === 'personal' && !csvScopeReady()){
    toast(L('Mở khoá sổ cá nhân ở tab Cá nhân trước','Unlock your personal ledger first'));
    return;
  }
  if(csvTxrSrcStage[p] === v) delete csvTxrSrcStage[p];   // toggle the stage
  else csvTxrSrcStage[p] = v;
  csvTxrKey = null; csvTxrHeadSync();
}

/* Xong's commit: everything staged, at once, then one toast naming it all.
   Category goes through csvBulkCat (which learns); ledgers stamp _scope —
   still only staging for Nhập, the ledger's true write. Per-source picks also
   persist as standing routes, so later arrivals from that bank default right;
   one more pick is the undo. */
function csvTxrCommitAll(){
  var bits = [], n = csvStagedSelected().length;
  if(csvTxrPendCat){
    var st = (window.catStyle && window.catStyle[csvTxrPendCat]) || ['🏷️'];
    csvBulkCat(csvTxrPendCat);
    bits.push(st[0] + ' ' + csvTxrPendCat);
    csvTxrPendCat = null;
  }
  if(csvTxrPendAll){
    var v0 = csvTxrPendAll;
    csvSetScope(v0);
    (csvReview.ready || []).forEach(function(c){ c._scope = v0; });
    bits.push(csvTxrLbl(v0));
    csvTxrPendAll = null;
  }
  var g = csvTxrGroups(), routes = 0;
  Object.keys(csvTxrSrcStage).forEach(function(p){
    var v = csvTxrSrcStage[p]; routes++;
    csvTxrRoutes[p] = v;
    (g[p] ? g[p].idx : []).forEach(function(i){ var c = csvReview.ready[i]; if(c) c._scope = v; });
  });
  if(routes){ csvTxrRouteSave(); bits.push(routes + ' ' + L('tuyến nguồn','source routes')); }
  csvTxrSrcStage = {};
  if(bits.length){
    renderCsvReview();
    toast(esc(L('Đã áp dụng cho ' + n + ' khoản: ', 'Applied to ' + n + ': ') + bits.join(' · ')));
  }
}
function csvTxrDel(){ csvBulkDelete(); csvTxrHeadSync(); }

/* Removing a staged row used to be in-memory only: the splice lived in
   csvReview, and nothing was retired until an Import. Close the sheet without
   importing — or remove every row, which greys Import out — and the removals
   evaporated. Reopening refetched the same rows from the server, so a ✕ appeared
   to do nothing and every new receipt brought the old rows back with it.

   So in the bank-email queue ✕ now takes effect at once. It deletes a staged
   transaction and its stored email, so it arms first (DESIGN: destructive is
   arm-then-confirm): one tap marks the row, a second carries it out. Any other
   tap disarms, so a stray touch cannot become a delete on the next one.

   The CSV file flow is untouched — there is nothing to retire there, the rows
   only exist in the page. */
var csvArmedRemove = null;

/* One disarm for both the per-row ✕ and the bulk ✕ — "any other tap disarms"
   has to mean any, or a tick could leave a loaded bulk delete behind it. */
function csvDisarmRemove(){
  var was = (csvArmedRemove !== null) || csvBulkArmed;
  csvArmedRemove = null; csvBulkArmed = false;
  return was;
}

function csvReadyRemove(i){
  if(!csvReview) return;
  if(csvStagedMode){
    if(csvArmedRemove !== i){ csvArmedRemove = i; renderCsvReview(); return; }
    csvArmedRemove = null;
    var gone = csvReview.ready[i];
    csvReview.ready.splice(i,1); csvExpand = null; renderCsvReview();
    // Retire it now, not at the next Import that may never come.
    if(window.fhStagedDropOne) window.fhStagedDropOne(gone);
    return;
  }
  csvReview.ready.splice(i,1); csvExpand = null; renderCsvReview();
}

// Group expansion: pure picker, so a chip tap applies instantly (house rule).
function csvGroupPick(name){
  var t=csvExpand; if(!t||t.kind!=='group'||!csvReview) return;
  var g=csvReview.groups.splice(t.idx,1)[0];
  if(g) g.items.forEach(function(it){ it.categoryName=name; it.catSource='user';
    if(typeof csvLearnFrom === 'function') csvLearnFrom(it);
    csvReview.ready.push(it); });
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
/* The parked card's tick: include-anyway in one tap. Same machinery as the
   expanded card's "Vẫn nhập" button, so the two paths can never disagree. */
function csvDupTick(di){ csvDisarmRemove(); csvDupInclude(di); }

/* Deferred row confirmed as a real expense (or completed, for stuck rows).
   Re-enters the normal flow -- INCLUDING the dedup checks the mixed-signs
   early exit skipped for the whole file, so nothing bypasses them now.
   Incomplete rows stay put with the editor open rather than half-importing. */
function csvDeferConfirm(di){
  var c = csvReview.deferred[di]; if(!c) return;
  // Only read the editor back when one is actually open for this row -- the
  // inflow list confirms rows with no editor mounted, and reading absent
  // fields onto the candidate would blank the very row being rescued.
  if(csvIsOpen('defer', di)) csvReadEditor(c);
  if(!(c.amount > 0) || !c.date){ renderCsvReview(); return; }
  // "Là khoản chi" is the person overruling the income/transfer call.
  c.isIncome = false; c.isTransfer = false;
  var fi = c.flags.indexOf('income_row'); if(fi >= 0) c.flags.splice(fi, 1);
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
/* subset: promote only these candidates instead of everything ready. The
   bank-email queue passes the TICKED rows (csvStagedSelected), because a staged
   row someone is not ready to file must survive the import of one they are.
   opts is forwarded to submitBulk.
   Called with no arguments this is exactly what it was, which is what the CSV
   file flow still wants: everything reviewed goes in. */
function csvPromote(subset, opts){
  var rows = subset || (csvReview && csvReview.ready);
  if(!csvReview || !rows || !rows.length) return;
  if(window._fhWriteLocked && window._fhWriteLocked()) return;

  /* submitBulk() fires addExpense() per row WITHOUT awaiting -- fine for the
     2-3 rows someone hand-types, fatal for an import: 59 rows all miss the
     category cache at once and every one of them tries to CREATE the same
     category, which collides and fails the batch. Resolving each distinct
     category once, up front, fills window.DB.catByName so the writes find it
     instead of racing. */
  /* Now -- and only now -- do the file's new categories join the real list.
     Up to this point they existed only inside the review. */
  csvPendingCats.forEach(function(name){
    if((window.catOrder||[]).indexOf(name) < 0){
      catOrder.push(name);
      if(typeof catBudget !== 'undefined') catBudget[name] = catBudget[name] || 0;
    }
  });
  csvPendingCats = [];

  var names = [];
  rows.forEach(function(c){ if(c.categoryName && names.indexOf(c.categoryName)<0) names.push(c.categoryName); });

  var chain = Promise.resolve();
  if(window._categoryIdForName && navigator.onLine !== false){
    names.forEach(function(name){
      chain = chain.then(function(){
        return window._categoryIdForName(name, (window.catStyle[name]||[])[0], (window.catOrder||[]).indexOf(name)+1);
      }).catch(function(e){ console.warn('category pre-resolve failed', name, e); });
    });
  }

  return chain.then(function(){
    bulkRows = rows.map(function(c){
      // _catTouched: the category came out of review (cascade or a human tap), so
      // it is deliberate — never something for the note-keyword guesser to revise.
      // time: a staged bank email carries its real HH:MM (a CSV file row has none).
      // _timeAuto:false so submitBulk's loadRow/_syncExTime keeps this exact value
      // rather than re-deriving now/'' from the (usually back-dated) import date.
      return { note: c.description, amt: String(Math.round(c.amount)), cat: c.categoryName,
               who: c.who || csvDefaultWho(), date: c.dateDisplay, _invalid: false,
               _catTouched: true,
               // 0100 provenance: a staged row's transport ('direct-email'/'forwarding-email'),
               // or 'csv-import' for a file. submitBulk hands this to the writethrough.
               source: csvStagedMode ? (window.fhStagedSource ? window.fhStagedSource(c) : 'forwarding-email') : 'csv-import',
               time: csvRowTime(c), _timeAuto: false };   // reviewed time (edited value wins, else derived); '' = day-only
    });
    bulkActive = 0;
    exPhotos = [];
    csvClearDraft();             // these rows are becoming real transactions now
    buildExCatChips();
    renderBulk();
    loadRow(0);
    // prepared LAST so no caller can turn it off: it is what stops the
    // interactive parse corrupting prepared rows (see submitBulk's own note).
    submitBulk(Object.assign({}, opts || {}, { prepared: true }));
  });
}
