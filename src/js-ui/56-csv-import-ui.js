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
function csvScopeSubtitle(){
  return csvStagedScope()==='personal'
    ? L('vào sổ cá nhân, chỉ mình bạn thấy','to your personal ledger, only you see it')
    : L('vào sổ gia đình, cả nhà cùng thấy','to the family ledger, everyone sees it');
}
function csvScopePicker(){
  /* Deliberately the SAME control as #ex-scopefield in the expense modal: same
     question, same chips, same order, same glyphs. A second dialect for one
     decision is how a product starts feeling assembled rather than designed —
     and this is the one decision a person makes most often in this screen. */
  var sc = csvStagedScope(), locked = !csvScopeReady();
  var chip = function(v, label){
    var on = sc===v;
    return '<button type="button" class="choice'+(on?' on':'')+'"'
      + (v==='personal' && locked ? ' aria-disabled="true"' : '')
      + ' aria-pressed="'+(on?'true':'false')+'"'
      + ' onclick="csvPickScope(\''+v+'\')">'+esc(label)+'</button>';
  };
  return '<div class="field csv-scope">'
    + '<label>'+esc(L('Ghi vào đâu?','Where does this go?'))+'</label>'
    + '<div class="choices">'
    +   chip('personal', L('🔒 Cá nhân','🔒 Personal'))
    +   chip('family',   L('🏡 Gia đình','🏡 Family'))
    + '</div>'
    + (locked ? '<div class="csv-scope-note">'+esc(L('Sổ cá nhân đang khoá — mở ở tab Cá nhân để chọn được.','Personal ledger is locked — unlock it on the Cá nhân tab to pick it.'))+'</div>' : '')
    + '</div>';
}

function openCsvImport(){
  csvStagedMode = false;               // this is the file flow, not the staged review
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
    dup: buckets.possibleDuplicate.map(function(c){ return { c:c, resolved:null }; }),
    deferred: buckets.deferred.filter(function(c){ return !c.isSummaryRow; }),
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
function csvBaseAmt(n){ return Math.round(Number(n||0)/curMult()); }
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
function csvCardHead(label, dateIso, removeFn, attn, isError){
  var tone = isError ? ' attn' : (attn ? ' warn' : '');
  return '<span class="bulk-head"><span class="bulk-idx'+tone+'">'+esc(label)+'</span>'
    + (dateIso ? '<span class="bulk-date">'+esc(bulkDate(dateIso))+'</span>' : '')
    + '</span>';
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
    + csvCardHead(opts.label, opts.dateIso, null, opts.invalid || opts.attn, opts.invalid)
    + (opts.noPick
        ? '<span class="bc-note">'+esc(c.description||'')+'</span><span class="bc-meta">'+(c.amount!=null?'<span class="bc-amt">'+csvFmt(c.amount)+'</span>':'')+'</span>'
        : bulkSummary(csvRowShape(c, opts.isDup)))
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
      + (mems.length ? '<div class="field" style="margin-bottom:0"><label>'+L('Ai trả','Who paid')+'</label><div class="choices" id="csvedit-who">'+whoChips+'</div></div>' : '');
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
  var headInner = csvCardHead(opts.label, opts.dateIso, null, opts.invalid || opts.attn, opts.invalid);
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
  if(document.getElementById('csvedit-cats')){ var cat = chosen('csvedit-cats'); if(cat){ c.categoryName = cat; c.catSource='user'; } }
  if(document.getElementById('csvedit-who')){ var w = chosen('csvedit-who'); if(w) c.who = w; }
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
    var proxy = { description:g.items[0].description, amount:g.items.reduce(function(s,it){return s+it.amount;},0), categoryName:null, dateDisplay:g.items[0].dateDisplay };
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
    var o = { label:why, dateIso:c.dateDisplay, invalid:blocking, attn:!blocking,
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
    // ONE consolidated summary at the top — count + total — as summary type, not a
    // boxed card (a box here reads as yet another draft row). This replaces BOTH the
    // old top context line and the bottom csv-check strip, which stated the same
    // "what am I about to import" twice. Recomputed each render, so removing a row
    // (the × on a card) keeps the count and total honest.
    if(readyCount > 0){
      var stagedSum = csvStagedSelected().reduce(function(s,c){ return s + csvBaseAmt(c.amount); }, 0);
      html += '<div class="csv-staged-sum">'
        + '<div class="csv-staged-sum-main">'+esc(L('Sẽ nhập '+readyCount+' khoản','Importing '+readyCount))+' · <span class="num">'+esc(fmt(stagedSum))+'</span></div>'
        + '<div class="csv-staged-sum-sub">'+esc(csvScopeSubtitle())+'</div>'
        + '</div>';
      html += csvScopePicker();
    }
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
        var o = { label:lowConfLabel[e.i] || (L('Khoản chi ','Item ')+(e.i+1)), dateIso:e.c.dateDisplay,
                  attn:!!lowConfLabel[e.i],
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
  csvDisarmRemove();                 // ticking is not confirming a delete
  c._skipImport = !c._skipImport;
  /* Close whatever row was open, like every other row action here does. Flush
     FIRST: csvFlushExpand reads the open editor's fields back onto its candidate,
     and re-rendering without it throws away a description or amount someone was
     part-way through typing. The handlers that skip the flush (csvReadyRemove and
     friends) can only do so because the row they touch is being removed anyway. */
  csvFlushExpand(); csvExpand = null;
  renderCsvReview();                 // count, total and the Import label all follow
}

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

function csvDisarmRemove(){ if(csvArmedRemove !== null){ csvArmedRemove = null; return true; } return false; }

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
      return { note: c.description, amt: String(Math.round(c.amount)), cat: c.categoryName,
               who: c.who || csvDefaultWho(), date: c.dateDisplay, _invalid: false,
               _catTouched: true };
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
