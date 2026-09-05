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
/* And one press = one import. A staged promote is a real multi-second batch
   (200 backfilled emails on a low-end phone), and this button used to stay
   live the whole time — every extra tap launched ANOTHER import of the same
   selection, each writing the same transactions again. Latched for both
   flows, relabelled so the press visibly took, and recomputed from state in
   finally: after a successful import the modal re-rendered or closed (label
   already right), so the recompute really exists for the failure path, where
   nothing re-renders and a stuck "Đang nhập…" would be the same silent button
   this latch replaces. */
var csvSaving = false;
function csvSaveDispatch(){
  if(csvSaving) return;
  csvSaving = true;
  var save = document.getElementById('csv-save');
  if(save){ save.disabled = true; save.textContent = L('Đang nhập…','Importing…'); }
  return Promise.resolve(csvStagedMode ? fhPromoteStaged() : csvPromote())
    .catch(function(e){ console.warn('import dispatch failed', e); window.toast && toast(L('Chưa lưu được','Could not save')); })
    .finally(function(){
      csvSaving = false;
      var s = document.getElementById('csv-save');
      if(s && window.csvReview){
        var n = csvStagedMode ? csvStagedSelected().length : ((csvReview.ready||[]).length);
        s.disabled = (n===0);
        s.textContent = n>0 ? L('Nhập '+n,'Import '+n) : L('Nhập','Import');
      }
    });
}

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
/* ── Destination scope: contextual, not sticky ───────────────────────────────
   Where an UNDECIDED card goes is the ENTRY CONTEXT — the ledger the review
   screen was opened from. Open the queue from the Cá nhân (Personal) tab and cards
   default to your personal ledger; open it from a space (family) ledger and they
   default to that space. The context is set fresh at every open (fhTxnReviewSheet)
   and never persisted, so the entry source is always the source of truth and one
   tab's choice can never leak into the other's next open — the bug this replaces,
   where a persisted 'fh-staged-scope' global let a Personal open bleed into a
   later Family open, and the Family entry (which set nothing) simply inherited
   whatever was last chosen.

   window.csvEntryScope is a DESCRIPTOR — {kind:'personal'} | {kind:'space', id}.
   Today there is exactly one space (the active family), so a space descriptor
   resolves to the legacy 'family' key the rest of this engine still compares
   against. csvStagedScope is the SINGLE seam a future multi-space world changes:
   give the descriptor a real space id and resolve it to that ledger there. */
window.fhNormScope = function(scope){
  var fid = window.DB && window.DB.fid;
  if(!scope) return { kind:'space', id:fid };                 // no entry hint -> the shared ledger
  if(typeof scope === 'string')
    return scope==='personal' ? { kind:'personal' } : { kind:'space', id:fid };
  if(scope.kind==='personal') return { kind:'personal' };
  return { kind:'space', id: scope.id || fid };               // a space; carries its own id for the future
};
function csvEntryScopeDesc(){
  var d = window.csvEntryScope;
  return (d && d.kind) ? d : window.fhNormScope(null);
}
function csvScopeReady(){
  var pd = window.fhPersonalData && window.fhPersonalData();
  return !!(pd && pd.key);
}
/* The default destination for an undecided card: the entry context, resolved to
   today's ledger keys. A personal context on a LOCKED personal ledger falls back
   to the space, so a row is never stranded where it cannot be written. */
function csvStagedScope(){
  var d = csvEntryScopeDesc();
  if(d.kind==='personal') return csvScopeReady() ? 'personal' : 'family';
  return 'family';                                            // a space; today the active family
}
/* Set the SESSION context (never persisted). Used by the entry point's pre-scope
   and by in-session overrides — a per-row pick's cascade to still-undecided rows,
   and the tools-header default setter. Reset on the next open (fhTxnReviewSheet),
   so it can never become the sticky global that caused cross-tab leakage. Returns
   whether it took, so a caller can tell refusal (locked) from success. */
function csvSetScope(v){
  if(v==='personal' && !csvScopeReady()) return false;
  window.csvEntryScope = window.fhNormScope(v);
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
  var rs=document.getElementById('csv-rowsheet'); if(rs) rs.innerHTML='';   // no stale staged picker over the file picker
  csvReview = null; csvExpand = null; csvRowSheet = null; csvRowHot = null;
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
  var rs=document.getElementById('csv-rowsheet'); if(rs) rs.innerHTML='';   // no stale staged picker over the file picker
  csvReview = null; csvExpand = null; csvRowSheet = null; csvRowHot = null;
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
  /* Sign-majority guessing is for FILES, whose one amount column hides the
     direction. A staged bank-email row carries `direction` from the pipeline —
     authoritative, per row — so a queue that is 60% debits and 40% credits is
     not ambiguous, it is a working full ledger (0109). */
  var mixed = (signMode === 'ambiguous') && !csvStagedMode;
  var buckets = bucketCsvCandidates(candidates, mixed);
  var rowsRead = sources.reduce(function(n, src){ return n + src.parsed.rows.length; }, 0);

  csvSumZoom='week'; csvSumScroll=null;   // fresh batch → the summary opens at Week, pinned newest

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

/* Foreign-currency helpers (foreign-currency-emails-spec.md). A staged row can
   be denominated in a currency that is not the family's — a $111 Claude
   subscription off a VN bank card. The app pre-fills a VND ESTIMATE (rate ×
   amount × (1+fee), from fx_rates) so the person just taps import; the foreign
   original stays visible for reference. Null everywhere outside staged mode, so
   the file-import flow is untouched. */
function csvFxInfo(c){
  if(!window.csvStagedMode || !c || typeof c.rowIndex!=='number' || !window.fhStagedFx) return null;
  return window.fhStagedFx(c.rowIndex);
}
/* The rare fallback: a foreign row whose currency has NO rate, so no estimate
   exists and the person hasn't typed a ₫ amount. Only THIS state blocks totals,
   selection and import — an estimated row (USD/EUR/…) is a normal VND row. */
function csvFxUnresolved(c){
  var fx = csvFxInfo(c);
  return !!(fx && fx.kind==='foreign' && !(fx.est && fx.est.vnd>0) && !c._fxVnd);
}
/* The foreign original as a short string ("$111" / "111 USD"). */
function csvFxOrigStr(fx){
  var n = Number(fx.amount)||0;
  var s = n.toLocaleString('en-US',{maximumFractionDigits:2});
  return fx.currency==='USD' ? '$'+s : s+' '+fx.currency;
}
/* Is this foreign row showing an app ESTIMATE (vs the bank's own conversion or
   a figure the person typed)? Drives the "· est." marker. */
function csvFxIsEstimate(c){
  var fx = csvFxInfo(c);
  return !!(fx && fx.kind==='foreign' && fx.est && fx.est.vnd>0 && !c._fxVnd);
}
/* One amount string for any card/list line: the honest "$111" only when we
   truly cannot estimate, the normal VND format (estimate or real) otherwise. */
function csvAmtDisp(c){
  var fx = csvFxInfo(c);
  if(fx && csvFxUnresolved(c)) return csvFxOrigStr(fx);
  return csvFmt(c.amount!=null ? c.amount : 0);
}

/* What the file adds up to, shown before the row-by-row work.
   The rows below answer "is each one right?"; this answers the question people
   actually opened the file for -- where did the money go. It reads only rows
   that are going in, so the number always matches the Import button. */
function csvSpendPanel(r){
  var rows = (r.ready || []);
  if(rows.length < 3) return '';                    // two rows don't need a breakdown

  var byCat = {}, totalBase = 0;
  rows.forEach(function(c){
    if(csvFxUnresolved(c)) return;      // a foreign amount is not a VND figure
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
  var fx = csvFxInfo(c);
  return { note: c.description || '', amt: c.amount != null ? String(Math.round(c.amount)) : '',
           cat: (c.isIncome && !c._xfer && !c._repay) ? (c._incomeCat || '') : (c.categoryName || ''),
           /* Foreign currency (foreign-currency-emails-spec.md): _fxAmt is the
              card's WHOLE amount only in the no-rate fallback ("$111", asks for
              a ₫ figure); _fxRef is a quiet "≈ $111" beside the VND amount
              (estimate or real); _fxEst marks the VND as an app estimate. */
           _fxAmt: csvFxUnresolved(c) && fx ? csvFxOrigStr(fx) : '',
           _fxRef: (fx && !csvFxUnresolved(c)) ? csvFxOrigStr(fx) : '',
           _fxEst: csvFxIsEstimate(c),
           _dup: !!isDup, _transfer: !!(c && c.isTransfer),
           _xfer: !!(c && c._xfer), _repay: !!(c && c._repay),
           _income: !!(c && c.isIncome && !c._xfer && !c._repay) };
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

/* Which transport imported this staged row → a short tag for the review card.
   Reads the same _transport marker the promote path uses (fhStagedSource): the
   direct-read worker stamps 'oauth_direct', forwarding leaves it absent. Staged
   rows only; a file-import card has no transport. */
function csvStagedSourceTag(c){
  if(!window.csvStagedMode || !window.fhStagedSource || !c || typeof c.rowIndex!=='number') return '';
  var s = window.fhStagedSource(c);
  return s==='direct-email' ? L('Trực tiếp','Direct') : (s==='forwarding-email' ? L('Chuyển tiếp','Forwarded') : '');
}
/* Instrument chip (0105): the classifier's verdict, quiet plain text in the meta
   line — "tín dụng ••1234" / "TK ••5678" / "ví". Empty when the classifier had
   no confident answer (Q16), which reads as today's header, not as "unknown". */
function csvStagedAcctChip(c){
  if(!csvStagedMode || !window.fhStagedAcct) return '';
  var ai = fhStagedAcct(c); if(!ai) return '';
  var k = ai.kind==='credit_card' ? L('tín dụng','credit') : (ai.kind==='ewallet' ? L('ví','wallet') : 'TK');
  return k + (ai.tail ? ' ••'+ai.tail : '');
}
function csvCardHead(label, dateIso, removeFn, attn, isError, timeStr, provider, scope, source, acct){
  var tone = isError ? ' attn' : (attn ? ' warn' : '');
  // Staged (bank-email) rows: a small source tag, then ONE quiet meta line —
  // scope · bank · account · date · time. The generic "Khoản chi N" index says
  // nothing here and stacking it beside the rest overflowed the header into a
  // broken two-line wrap; the description below carries the real identity.
  if (provider) {
    var when = dateIso ? esc(bulkDate(dateIso)) + (timeStr ? ' · ' + esc(timeStr) : '') : '';
    var parts = [];
    if (scope) parts.push('<span class="bulk-scope">'+esc(scope)+'</span>');
    parts.push('<span class="bulk-src'+tone+'">'+esc(provider)+'</span>');
    if (acct) parts.push('<span class="bulk-when">'+esc(acct)+'</span>');   // instrument chip (0105): tín dụng ••1234 / TK / ví
    if (when) parts.push('<span class="bulk-when">'+when+'</span>');
    var tag = source ? '<span class="bulk-transport">'+esc(source)+'</span>' : '';
    return '<span class="bulk-head bulk-head-src">' + tag + '<span class="bulk-meta">'
      + parts.join('<span class="bulk-sep">·</span>') + '</span></span>';
  }
  var meta = dateIso ? '<span class="bulk-date">'+esc(bulkDate(dateIso))+(timeStr?' · '+esc(timeStr):'')+'</span>' : '';
  return '<span class="bulk-head"><span class="bulk-idx'+tone+'">'+esc(label)+'</span>' + meta + '</span>';
}

/* The datetime line on a collapsed card, now led by the weekday — "Thứ 5, 03/09"
   — so a bank date reads as a day, not just a number. Year appended only when it
   isn't the current one; time appended when known. Falls back to bulkDate if the
   row has no parseable date. */
var FH_WD_VI=['Chủ nhật','Thứ 2','Thứ 3','Thứ 4','Thứ 5','Thứ 6','Thứ 7'];
var FH_WD_EN=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
function csvWhenLine(c, opts){
  var d = (c && c.date instanceof Date && !isNaN(c.date)) ? c.date
        : (opts.dateIso ? new Date(opts.dateIso+'T00:00:00') : null);
  if(!d || isNaN(d)) return opts.dateIso ? (bulkDate(opts.dateIso)+(opts.timeStr?' · '+opts.timeStr:'')) : '';
  var wd = (typeof LANG!=='undefined' && LANG==='vi' ? FH_WD_VI : FH_WD_EN)[d.getDay()];
  var s = wd + ', ' + String(d.getDate()).padStart(2,'0') + '/' + String(d.getMonth()+1).padStart(2,'0');
  if(typeof TODAY!=='undefined' && TODAY && d.getFullYear()!==TODAY.getFullYear()) s += '/' + d.getFullYear();
  if(opts.timeStr) s += ' · ' + opts.timeStr;
  return s;
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
  /* Staged review wears the amount-anchor card: scope eyebrow, the AMOUNT as the
     scannable hero next to its category, the raw bank memo demoted to a quiet
     line (up to 2 lines), and the fixed provenance — money source · date-time ·
     transport — on the bottom line. When reviewing 75 bank rows the eye scans
     the amount and whether it is classified right; the memo is the noise. */
  if(csvStagedMode){
    var r = csvRowShape(c, opts.isDup || opts.repeat);
    var scope = !opts.isDup ? (csvRowScope(c)==='personal' ? L('🔒 Riêng tư','🔒 Private') : L('🏡 Gia đình','🏡 Family')) : '';
    var catTxt;
    if(r._transfer)      catTxt = '💳 '+L('Trả nợ thẻ','Card payment');
    else if(r._xfer)     catTxt = '🔁 '+L('Chuyển khoản nội bộ','Internal transfer');
    else if(r._repay)    catTxt = '🤝 '+L('Thu nợ','Repayment in');
    else if(r._income)   catTxt = esc(r.cat||L('Thu nhập','Income'));
    else if(r.cat && (typeof catValid!=='function' || catValid(r.cat))){
      var s=(window.catStyle&&catStyle[r.cat])||['🏷️']; catTxt = s[0]+' '+esc(r.cat);
    } else catTxt = null;
    var catHtml = catTxt
      ? '<span class="scv-cat">'+catTxt+'</span>'
      : '<span class="scv-cat unset">'+L('Chọn danh mục','Pick a category')+'</span>';
    /* Three chips, three degrees of belief: message-id equality is a FACT and
       wears the strong chip; a rounded-amount neighbour is the weakest guess
       and says so; everything between keeps the familiar "lặp lại". */
    var dupHtml = c.duplicateResolvedBefore
      ? '<span class="scv-dup sure">'+L('đã nhập trước đó','imported before')+'</span>'
      : c.duplicateNearMiss && !c.duplicateOfExisting
      ? '<span class="scv-dup soft">'+L('gần trùng','near match')+'</span>'
      : r._dup ? '<span class="scv-dup">'+L('lặp lại','repeat')+'</span>' : '';
    var amtHtml = (c.amount!=null)
      ? '<span class="scv-amt num">'+esc(csvAmtDisp(c))+'</span>'
      : '<span class="scv-amt num warn">'+L('Thiếu số tiền','No amount')+'</span>';
    var note = (c.description||'').trim();
    var memoHtml = note
      ? '<span class="scv-memo">'+esc(note)+'</span>'
      : '<span class="scv-memo scv-empty">'+L('(khoản trống)','(empty item)')+'</span>';
    /* Top line: scope + money source (bank · instrument), one eyebrow in one
       style — the fixed "where it lives / where it came from". */
    var prov = csvStagedProvider(c), acct = csvStagedAcctChip(c);
    var topBits = [scope, prov, acct].filter(Boolean).map(function(x){ return esc(x); });
    var topHtml = topBits.length ? '<span class="scv-scope">'+topBits.join('<span class="scv-sep">·</span>')+'</span>' : '';
    /* Bottom line: the datetime (with weekday) then the import method, inline —
       quiet provenance you rarely read. */
    var whenTxt = csvWhenLine(c, opts);
    var tag = csvStagedSourceTag(c);
    var footBits = [whenTxt, tag].filter(Boolean).map(function(x){ return esc(x); });
    var footHtml = footBits.length ? '<span class="scv-foot">'+footBits.join('<span class="scv-sep">·</span>')+'</span>' : '';
    return '<div class="bulk-card'+(opts.invalid?' invalid':(opts.attn?' attn':''))+(opts.dim?' is-dim':'')+'">' + ck
      + '<button type="button" class="bulk-tap scv-tap" onclick="'+opts.tapFn+'" aria-label="'+L('Sửa khoản này','Edit this item')+'">'
      + topHtml
      + '<span class="scv-money">'+amtHtml+catHtml+dupHtml+'</span>'
      + memoHtml + footHtml
      + '</button>' + rm + '</div>';
  }

  // File-import flow: unchanged — index label + date header, note, amount·category.
  return '<div class="bulk-card'+(opts.invalid?' invalid':(opts.attn?' attn':''))+(opts.dim?' is-dim':'')+'">' + ck
    + '<button type="button" class="bulk-tap" onclick="'+opts.tapFn+'" aria-label="'+L('Sửa khoản này','Edit this item')+'">'
    + csvCardHead(opts.label, opts.dateIso, null, opts.invalid || opts.attn, opts.invalid, opts.timeStr, csvStagedProvider(c), '', '', '')
    + (opts.noPick
        ? '<span class="bc-note">'+esc(c.description||'')+'</span><span class="bc-meta">'+(c.amount!=null?'<span class="bc-amt">'+esc(csvAmtDisp(c))+'</span>':'')+'</span>'
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
  /* Settings-rows redesign (staged review): the ✕ leaves the header — deleting
     moved to the bottom CTA bar, one deliberate step away — and the header's
     right slot holds the same tick as the collapsed card, so the checkbox sits
     at the SAME top-right corner in both states. */
  if(csvStagedMode && opts.fields){
    rm = opts.checkFn
      ? '<button type="button" class="bulk-check'+(opts.checked?' on':'')+'" onclick="'+opts.checkFn+'"'
        + ' role="checkbox" aria-checked="'+(opts.checked?'true':'false')+'"'
        + ' aria-label="'+escAttr(L('Chọn khoản này để nhập','Select this item to import'))+'">'
        + '<i><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12.5 4.5 4.5L19 7"/></svg></i></button>'
      : '';
  }
  var catChips = csvAllCats().map(function(name){
    var st=(window.catStyle&&window.catStyle[name])||['🏷️'];
    var act = opts.instantChips ? 'csvGroupPick(\''+escAttr(name)+'\')' : 'pick(\'csvedit-cats\',this)';
    return '<button type="button" class="choice'+(c && name===c.categoryName?' on':'')+'" data-v="'+escAttr(name)+'" onclick="'+act+'">'+st[0]+' '+esc(name)+'</button>';
  }).join('');

  var body = '';
  if(opts.note) body += '<div class="csv-expand-note">'+opts.note+'</div>';
  if(opts.fields && csvStagedMode){
    /* Staged review wears the settings-rows card: note (2 lines) on top, then
       one slim label/value row per decision, each opening a picker sheet. The
       file-import flow below keeps its chip workbench untouched. */
    body += csvStagedRowsCard(c, opts);
  } else if(opts.fields){
    var mems = (window.FAM && window.FAM.members) || [];
    var whoSel = (c && c.who) || csvDefaultWho();
    var whoChips = mems.map(function(m){
      return '<button type="button" class="choice'+(m.name===whoSel?' on':'')+'" data-v="'+escAttr(m.name)+'" onclick="pick(\'csvedit-who\',this)">'+esc(m.name)+'</button>';
    }).join('') + '<button type="button" class="choice'+(whoSel==='Both'?' on':'')+'" data-v="Both" onclick="pick(\'csvedit-who\',this)">'+esc(LANG==='vi'?'Chung':'Both')+'</button>';

    // Which face this row wears right now (0109): income keeps its own category
    // set; a transfer leg / repayment / card payment has no category at all.
    var isIncomeNow = !!(c.isIncome && !c._xfer && !c._repay);
    var noCat = c.isTransfer || c._xfer || c._repay;
    var incChips = FH_INCOME_CATS.map(function(name){
      return '<button type="button" class="choice'+(name===(c._incomeCat||'Khác')?' on':'')+'" data-v="'+escAttr(name)+'" onclick="pick(\'csvedit-inccats\',this)">'+esc(name)+'</button>';
    }).join('');
    body += '<div class="field"><label>'+(noCat?L('Ghi chú','Note'):(isIncomeNow?L('Tiền gì vậy?','What money is this?'):L('Chi cho gì?','What for?')))+'</label>'
      + '<input id="csvedit-note" value="'+escAttr(c.description||'')+'"/>'
      // a transfer / repayment has no category — the chips are hidden so
      // csvReadEditor never reads one, and the row keeps its kind. Income gets
      // the income-side set (Lương · Thưởng · Hoàn tiền · Khác), never the
      // family expense picker.
      + (noCat ? '' : (isIncomeNow
          ? '<div class="choices" id="csvedit-inccats" style="margin-top:10px">'+incChips+'</div>'
          : '<div class="choices" id="csvedit-cats" style="margin-top:10px">'+catChips+'</div>'))+'</div>'
      + '<div class="field-row">'
      /* A foreign-denominated row opens with an EMPTY amount and its original
         as the placeholder ("$111 → ₫?"): pre-filling the foreign number would
         let one accidental Done commit 111 as 111đ — the exact corruption the
         FX gate exists to stop. Typing a value here is what resolves the row. */
      + '<div class="field"><label>'+L('Số tiền','Amount')+'</label><input class="num" id="csvedit-amt" inputmode="numeric" onblur="snapAmtInput(this)" placeholder="'+escAttr(csvFxUnresolved(c) ? csvFxOrigStr(csvFxInfo(c))+' → ₫?' : amtPlaceholder())+'" value="'+escAttr(!csvFxUnresolved(c) && c.amount!=null?csvAmtInputVal(c.amount):'')+'"/></div>'
      + '<div class="field"><label>'+L('Khi nào','When')+'</label><input type="date" id="csvedit-date" value="'+escAttr(c.dateDisplay||'')+'"/></div>'
      + '</div>'
      // Time carried from the bank email (occurred_at) — shown so the reviewer can
      // verify, correct or clear it before it's stored. Empty = day-only. Since
      // 0109 income lives on the spine and carries a time too.
      + '<div class="field"><label>'+L('Giờ','Time')+' <span class="opt">'+L('tuỳ chọn','optional')+'</span></label><input type="time" id="csvedit-time" value="'+escAttr(csvRowTime(c))+'"/></div>'
      + (csvStagedMode ? csvRowScopeField(c) : '')
      // "Trả nợ thẻ" is a PERSONAL liability by nature — a card is never a
      // space's debt. So the Kind control only appears for a personal-scoped
      // row; a shared row is a plain expense (its transfer flag is cleared on
      // the scope flip below). The "space payable" kind is a separate deferred
      // flow (routing a settle-up out of the review). Credit rows carry their
      // own 3-way control (Thu nhập / Chuyển khoản nội bộ / Thu nợ).
      + (csvStagedMode && csvRowScope(c)==='personal' ? csvRowKindField(c) : '')
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
  var headInner;
  if(csvStagedMode && opts.fields){
    /* The top line IS the fixed provenance now — bank · instrument · transport
       (nguồn tiền + nguồn nhập). None of it is adjustable, so it is stated here
       once instead of eating read-only rows below. Scope, date and time stay OUT
       of this line: each is an editable row in the card body. */
    var _bits = [csvStagedProvider(c), csvStagedAcctChip(c), csvStagedSourceTag(c)]
      .filter(Boolean).map(function(x){ return '<span class="bulk-when">'+esc(x)+'</span>'; });
    var _fb = opts.dateIso ? esc(bulkDate(opts.dateIso)) + (opts.timeStr ? ' · '+esc(opts.timeStr) : '') : L('Giao dịch','Transaction');
    headInner = '<span class="bulk-head bulk-head-src"><span class="bulk-meta">'
      + (_bits.length ? _bits.join('<span class="bulk-sep">·</span>') : '<span class="bulk-when">'+esc(_fb)+'</span>')
      + '</span></span>';
  } else {
    headInner = csvCardHead(opts.label, opts.dateIso, null, opts.invalid || opts.attn, opts.invalid, opts.timeStr, csvStagedProvider(c), '', csvStagedMode ? '' : csvStagedSourceTag(c));
  }
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

/* ── Settings-rows card (staged review redesign) ────────────────────────────
   The expanded card stopped being a chip workbench: every decision is one slim
   label/value row (iOS Settings grammar), so the card's height is field COUNT,
   not option count. Tapping a row opens a small picker sheet over the modal;
   the picked value writes straight onto the candidate and the row re-renders,
   briefly tinted (csvRowHot). Amount/date demote to rows too — bank data is
   trusted, editing it is the rare path. */
var csvRowSheet = null;   // which field's picker sheet is open ('scope'|'kind'|...)
var csvRowHot = null;     // last field changed — its row wears the brand tint

function csvRowKindCur(c){
  return c._xfer ? 'xfer' : (c._repay ? 'repay' : (c.isTransfer ? 'cardpay' : (c.isIncome ? 'income' : 'expense')));
}
function csvStagedRowsCard(c, opts){
  var isIncomeNow = !!(c.isIncome && !c._xfer && !c._repay);
  var noCat = c.isTransfer || c._xfer || c._repay;
  var noteLbl = noCat ? L('Ghi chú','Note') : (isIncomeNow ? L('Tiền gì vậy?','What money is this?') : L('Chi cho gì?','What for?'));
  /* Amount leads as a top input field — the number people most want to see and
     change — above the description. csvReadEditor(#csvedit-amt) reads it back with
     full FX handling (a typed ₫ figure resolves a no-rate foreign row). */
  var _fx = csvFxInfo(c);
  var fxUn = csvFxUnresolved(c);
  var fxHint = fxUn
    ? '<div class="csv-amt-hint warn">'+esc(L('Nhập số tiền ₫ để nhập khoản này','Enter the ₫ amount to import'))+'</div>'
    : (_fx ? '<div class="csv-amt-hint">≈ '+esc(csvFxOrigStr(_fx))+(csvFxIsEstimate(c)?' '+esc(L('ước tính','est.')):'')+'</div>' : '');
  var h = '<div class="field csv-amtf'+(fxUn?' need':'')+'"><label>'+L('Số tiền','Amount')+'</label>'
    + '<input class="num" id="csvedit-amt" inputmode="numeric" onblur="csvAmtBlur(this)" placeholder="'+escAttr(fxUn ? csvFxOrigStr(_fx)+' → ₫?' : amtPlaceholder())+'" value="'+escAttr(!fxUn && c.amount!=null?csvAmtInputVal(c.amount):'')+'"/>'
    + fxHint + '</div>'
    + '<div class="field csv-notef"><label>'+noteLbl+'</label>'
    + '<textarea id="csvedit-note" rows="2">'+esc(c.description||'')+'</textarea></div>';

  /* Two "not filled" states, deliberately different colours:
       miss (amber) — BLOCKING: import is gated until this is set (the no-rate
                      foreign amount is the only one).
       soft (grey)  — OPTIONAL: the row imports fine unset and can be refined
                      later (which card, which account, category). Painting these
                      amber made a card with nothing wrong look like it had two
                      problems. */
  var row = function(f, lbl, val, mods){
    mods = mods || {};
    var cls = 'csv-srow'+(mods.ro?' ro':'')+(csvRowHot===f && !mods.ro?' hot':'')+(mods.miss?' miss':'')+(mods.soft?' soft':'');
    var inner = '<small>'+lbl+'</small><span class="csv-sval"><b>'+val+'</b>'
      + (mods.ro ? '' : '<svg class="csv-schev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m9 6 6 6-6 6"/></svg>')
      + '</span>';
    return mods.ro ? '<div class="'+cls+'">'+inner+'</div>'
      : '<button type="button" class="'+cls+'" onclick="csvRowSheetOpen(\''+f+'\')">'+inner+'</button>';
  };
  var rows = '';
  var sc = csvRowScope(c);
  rows += row('scope', L('Ghi vào đâu','Where to'),
    sc==='personal' ? L('🔒 Cá nhân','🔒 Personal') : L('🏡 Gia đình','🏡 Family'));
  if(sc==='personal'){
    var cur = csvRowKindCur(c);
    var kindLbls = { expense:L('Chi tiêu','Spending'), cardpay:L('💳 Trả nợ thẻ','💳 Card payment'),
                     xfer:L('🔁 Chuyển khoản nội bộ','🔁 Internal transfer'),
                     income:L('Thu nhập','Income'), repay:L('🤝 Thu nợ','🤝 Repayment in') };
    rows += row('kind', L('Loại khoản','Kind'), kindLbls[cur] || '');
    if(cur==='cardpay'){
      var cards = csvCreditCards();
      var pc = c._payCardId || (cards.length===1 ? cards[0].id : '');
      var cardName = '';
      cards.forEach(function(a){ if(a.id===pc) cardName = a.name || L('Thẻ','Card'); });
      rows += row('paycard', L('Trả cho thẻ','Which card'),
        cardName ? esc(cardName) : L('Chưa rõ','Not sure'), { soft: !cardName && cards.length>0 });
    }
    if(cur==='xfer'){
      var accts = csvXferAccounts(c), sel = c._xferOtherId || '', an = '';
      accts.forEach(function(a){ if(a.id===sel) an = a.name || L('Tài khoản','Account'); });
      if(sel==='_cash') an = L('Tiền mặt','Cash');
      rows += row('xferacct',
        (c.isIncome ? L('Chuyển từ đâu','From where') : L('Chuyển đến đâu','To where')),
        an ? esc(an) : L('Chọn tài khoản','Pick one'), { soft: !an });
    }
    if(cur==='repay'){
      rows += row('repay', L('Ai trả bạn','Who repaid'),
        c._repayWho ? esc(c._repayWho) : L('Chọn','Pick'), { soft: !c._repayWho });
    }
  }
  if(!noCat){
    if(isIncomeNow){
      rows += row('inccat', L('Danh mục','Category'), esc(c._incomeCat || 'Khác'));
    } else {
      rows += row('cat', L('Danh mục','Category'),
        c.categoryName ? (csvCatEmoji(c.categoryName)+' '+esc(c.categoryName)) : L('Chưa rõ','Not set'),
        { soft: !c.categoryName });
    }
  }
  var mems = (window.FAM && FAM.members) || [];
  if(mems.length && sc!=='personal' && !opts.isDup){
    var whoSel = c.who || csvDefaultWho();
    rows += row('who', L('Ai trả','Who paid'), whoSel==='Both' ? L('Chung','Both') : esc(whoSel || ''));
  }
  // Amount now leads as a top input field (above the note) — see the h assembly
  // above; it is no longer a row here.
  var t = csvRowTime(c);
  rows += row('when', L('Khi nào','When'),
    '<span class="num">'+esc(bulkDate(c.dateDisplay))+(t ? ' · '+esc(t) : '')+'</span>');
  /* Nguồn tiền (bank · instrument) and Nguồn nhập (transport) used to be two
     read-only rows here. They are fixed provenance, so they moved up to the
     card's top line (csvActiveCard header) and no longer take a row. */

  h += '<div class="csv-srows">'+rows+'</div>';

  /* Bottom CTA bar (ready rows only — dup/defer cards keep their own verbs):
     delete (moved down from the old header ✕, same arm-then-confirm), apply
     this classification to lookalike rows, and import just this one now. */
  if(opts.ctaIdx !== undefined){
    var i = opts.ctaIdx, sims = csvSimilarRows(c).length;
    h += '<div class="csv-cta">'
      + '<button type="button" class="csv-cta-del'+(csvArmedRemove===i?' armed':'')+'" onclick="csvReadyRemove('+i+')"'
      + ' aria-label="'+escAttr(csvArmedRemove===i ? L('Xác nhận xoá khoản này','Confirm removing this item') : L('Xoá khoản này','Remove this item'))+'">'
      + (csvArmedRemove===i ? esc(L('Xoá?','Delete?'))
          : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M10 11v6M14 11v6"/></svg>')
      + '</button>'
      + (sims ? '<button type="button" class="csv-cta-ghost" onclick="csvApplySimilar('+i+')">'
          + esc(L('Áp cho '+sims+' khoản giống','Apply to '+sims+' similar'))+'</button>' : '')
      + '<button type="button" class="csv-cta-go" onclick="csvImportOne('+i+')">✓ '+esc(L('Nhập khoản này','Import this one'))+'</button>'
      + '</div>';
  }
  return h;
}

/* ── the row-picker sheet ── */
function csvRowSheetOpen(f){
  var c = csvExpandedCandidate(); if(!c) return;
  csvReadEditor(c);          // keep a note someone was mid-typing
  csvDisarmRemove();
  csvRowSheet = f;
  renderCsvReview();
}
function csvRowSheetClose(){ csvRowSheet = null; renderCsvReview(); }

/* One dispatcher for every chip in the sheet: closes the sheet, marks the row
   hot, then routes to the SAME pick handlers the chip workbench used — the
   data path is unchanged, only the surface moved. */
function csvSheetPick(f, v){
  csvRowSheet = null; csvRowHot = f;
  if(f==='scope'){ csvPickRowScope(v); renderCsvReview(); return; }   // locked pick refuses without rendering
  if(f==='kind'){ csvPickRowKind(v); return; }
  if(f==='paycard'){ csvPickPayCard(v); return; }
  if(f==='xferacct'){ csvPickXferAcct(v); return; }
  if(f==='repay'){ csvPickRepayWho(v); return; }
  var c = csvExpandedCandidate(); if(!c){ renderCsvReview(); return; }
  if(f==='cat'){ c.categoryName = v; c.catSource = 'user'; if(typeof csvLearnFrom === 'function') csvLearnFrom(c); }
  else if(f==='inccat'){ c._incomeCat = v; }
  else if(f==='who'){ c.who = v; }
  renderCsvReview();
}
/* Sheets with typed input (amount / date+time / repay free-text) commit on Xong. */
window.csvSheetValDone = function(){
  var c = csvExpandedCandidate();
  var f = csvRowSheet;
  if(c && f==='amount'){
    var a = document.getElementById('csvsheet-amt');
    var v = (a && window.classifyAmount) ? classifyAmount(a.value||'') : null;
    if(v && v.status==='ok' && v.value > 0){
      // A typed ₫ figure on a foreign row is the person's own number, not the
      // app's estimate: mark it (clears the "est." tag) and, if it was the
      // no-rate fallback, select it — entering the amount is choosing to import.
      if(csvFxInfo(c)){ if(csvFxUnresolved(c)) c._skipImport = false; c._fxVnd = true; }
      c.amount = v.value;
    }
  } else if(c && f==='when'){
    var d = document.getElementById('csvsheet-date');
    if(d && d.value){ c.dateDisplay = d.value; c.date = new Date(d.value+'T00:00:00'); }
    var t = document.getElementById('csvsheet-time');
    if(t) c.time = t.value || '';
  } else if(c && f==='repay'){
    var r = document.getElementById('csvsheet-repwho');
    if(r && r.value.trim()) c._repayWho = r.value.trim();
  }
  csvRowHot = f; csvRowSheet = null;
  renderCsvReview();
};
/* "+ Tài khoản khác" inside the transfer-counterpart sheet: toggle the inline
   name field (sheet stays open), then Create materializes + selects + closes. */
function csvSheetXferAddNew(){
  var c = csvExpandedCandidate(); if(!c) return;
  c._xferAddingNew = !c._xferAddingNew;
  renderCsvReview();
}
window.csvSheetXferCreate = async function(){
  var c = csvExpandedCandidate(); if(!c) return;
  var el = document.getElementById('csvsheet-newacct');
  var name = ((el && el.value) || '').trim();
  if(!name){ window.toast && toast(L('Đặt tên tài khoản nhé','Name the account first')); return; }
  var id = window.fhPersonalAccountCreate ? await fhPersonalAccountCreate(name, 'deposit') : null;
  if(!id){ window.toast && toast(L('Chưa tạo được, thử lại','Couldn\'t create, try again')); return; }
  c._xferOtherId = id; c._xferAddingNew = false; c._xferNewName = null;
  csvRowSheet = null; csvRowHot = 'xferacct';
  window.toast && toast(L('Đã tạo tài khoản '+name,'Created '+name));
  renderCsvReview();
};

function csvRowSheetHTML(c){
  var f = csvRowSheet;
  var title = '', body = '';
  var chip = function(on, click, label){
    return '<button type="button" class="choice'+(on?' on':'')+'" onclick="'+click+'">'+label+'</button>';
  };
  if(f==='scope'){
    var sc = csvRowScope(c), locked = !csvScopeReady();
    title = L('Ghi vào đâu?','Where does this go?');
    body = '<div class="choices">'
      + chip(sc==='personal', "csvSheetPick('scope','personal')", esc(L('🔒 Cá nhân','🔒 Personal')))
      + chip(sc==='family', "csvSheetPick('scope','family')", esc(L('🏡 Gia đình','🏡 Family')))
      + '</div>'
      + (locked ? '<div class="csv-scope-note">'+esc(L('Sổ cá nhân đang khoá — mở ở tab Cá nhân để chọn được.','Personal ledger is locked — unlock it on the Cá nhân tab to pick it.'))+'</div>' : '');
  } else if(f==='kind'){
    var credit = !!c.isIncome || c._xferDir === 'in';
    var cur = csvRowKindCur(c);
    title = L('Loại khoản','Kind');
    body = '<div class="choices">' + (credit
      ? chip(cur==='income', "csvSheetPick('kind','income')", esc(L('Thu nhập','Income')))
        + chip(cur==='xfer', "csvSheetPick('kind','xfer')", esc(L('🔁 Chuyển khoản nội bộ','🔁 Internal transfer')))
        + chip(cur==='repay', "csvSheetPick('kind','repay')", esc(L('🤝 Thu nợ','🤝 Repayment in')))
      : chip(cur==='expense', "csvSheetPick('kind','expense')", esc(L('Chi tiêu','Spending')))
        + chip(cur==='cardpay', "csvSheetPick('kind','transfer')", esc(L('💳 Trả nợ thẻ','💳 Card payment')))
        + chip(cur==='xfer', "csvSheetPick('kind','xfer')", esc(L('🔁 Chuyển đi nội bộ','🔁 Internal transfer')))
    ) + '</div>';
  } else if(f==='paycard'){
    var cards = csvCreditCards();
    var pc = c._payCardId || (cards.length===1 ? cards[0].id : '');
    title = L('Trả cho thẻ nào','Which card');
    body = '<div class="choices">'
      + cards.map(function(a){ return chip(pc===a.id, "csvSheetPick('paycard','"+a.id+"')", esc(a.name||L('Thẻ','Card'))); }).join('')
      + chip(!pc, "csvSheetPick('paycard','')", esc(L('Chưa rõ','Not sure')))
      + '</div>'
      + (cards.length ? '' : '<div class="csv-scope-note">'+esc(L('Chưa có thẻ tín dụng nào — vẫn ghi được, gán thẻ sau ở mục Nợ & cho vay.','No credit card yet — it still imports, assign a card later in Owing & lending.'))+'</div>');
  } else if(f==='xferacct'){
    var accts = csvXferAccounts(c), sel = c._xferOtherId || '';
    title = c.isIncome ? L('Chuyển từ đâu?','From which account?') : L('Chuyển đến đâu?','To which account?');
    body = '<div class="choices">'
      + accts.map(function(a){ return chip(sel===a.id, "csvSheetPick('xferacct','"+a.id+"')", esc(a.name||L('Tài khoản','Account'))); }).join('')
      + chip(sel==='_cash', "csvSheetPick('xferacct','_cash')", esc(L('Tiền mặt','Cash')))
      + chip(!!c._xferAddingNew, "csvSheetXferAddNew()", '＋ '+esc(L('Tài khoản khác','Other account')))
      + '</div>'
      + (c._xferAddingNew
          ? '<div class="csv-newacct"><input id="csvsheet-newacct" class="crs-in" placeholder="'+escAttr(L('Tên tài khoản, vd. VCB tiết kiệm','Account name, e.g. VCB savings'))+'" value="'+escAttr(c._xferNewName||'')+'"/>'
            + '<button type="button" class="btn-line" onclick="csvSheetXferCreate()">'+esc(L('Tạo','Create'))+'</button></div>'
          : '')
      + '<div class="csv-scope-note">'+esc(L('Ghi thành một cặp chuyển khoản — không tính là chi tiêu hay thu nhập.','Recorded as a transfer pair — never spending, never income.'))+'</div>';
  } else if(f==='repay'){
    var pd = (window.fhPersonalDebts && fhPersonalDebts()) || { people: [] };
    var names = pd.people.filter(function(p){ return p.balance > 0.5; }).map(function(p){ return p.who; });
    title = L('Ai trả bạn?','Who repaid you?');
    body = (names.length ? '<div class="choices" style="margin-bottom:10px">'
        + names.map(function(n){ return chip(c._repayWho===n, "csvSheetPick('repay','"+escAttr(n)+"')", esc(n)); }).join('')+'</div>' : '')
      + '<input id="csvsheet-repwho" class="crs-in" placeholder="'+escAttr(L('vd. Thằng em','e.g. a name'))+'" value="'+escAttr(c._repayWho||'')+'"/>'
      + '<div class="csv-scope-note">'+esc(L('Trừ vào số họ đang nợ bạn — không tính là thu nhập.','Draws down what they owe you — never income.'))+'</div>'
      + '<button type="button" class="crs-done" onclick="csvSheetValDone()">'+esc(L('Xong','Done'))+'</button>';
  } else if(f==='cat'){
    title = L('Danh mục','Category');
    body = '<div class="choices">'
      + csvAllCats().map(function(name){
          var st = (window.catStyle && catStyle[name]) || ['🏷️'];
          return chip(c.categoryName===name, "csvSheetPick('cat','"+escAttr(name)+"')", st[0]+' '+esc(name));
        }).join('')
      + '</div>';
  } else if(f==='inccat'){
    title = L('Tiền gì vậy?','What money is this?');
    body = '<div class="choices">'
      + FH_INCOME_CATS.map(function(name){
          return chip((c._incomeCat||'Khác')===name, "csvSheetPick('inccat','"+escAttr(name)+"')", esc(name));
        }).join('')
      + '</div>';
  } else if(f==='who'){
    var mems = (window.FAM && FAM.members) || [];
    var whoSel = c.who || csvDefaultWho();
    title = L('Ai trả','Who paid');
    body = '<div class="choices">'
      + mems.map(function(m){ return chip(m.name===whoSel, "csvSheetPick('who','"+escAttr(m.name)+"')", esc(m.name)); }).join('')
      + chip(whoSel==='Both', "csvSheetPick('who','Both')", esc(L('Chung','Both')))
      + '</div>';
  } else if(f==='amount'){
    title = L('Số tiền','Amount');
    // Foreign rows open empty with the original as placeholder — see csvedit-amt.
    body = '<input id="csvsheet-amt" class="crs-in num" inputmode="numeric" placeholder="'+escAttr(csvFxUnresolved(c) ? csvFxOrigStr(csvFxInfo(c))+' → ₫?' : amtPlaceholder())+'" value="'+escAttr(!csvFxUnresolved(c) && c.amount!=null ? csvAmtInputVal(c.amount) : '')+'"/>'
      + '<button type="button" class="crs-done" onclick="csvSheetValDone()">'+esc(L('Xong','Done'))+'</button>';
  } else if(f==='when'){
    title = L('Khi nào','When');
    body = '<div class="crs-row2">'
      + '<div><span class="crs-lbl">'+esc(L('Ngày','Date'))+'</span><input type="date" id="csvsheet-date" class="crs-in" value="'+escAttr(c.dateDisplay||'')+'"/></div>'
      + '<div><span class="crs-lbl">'+esc(L('Giờ','Time'))+' <span style="text-transform:none;letter-spacing:0;font-weight:500">'+esc(L('tuỳ chọn','optional'))+'</span></span><input type="time" id="csvsheet-time" class="crs-in" value="'+escAttr(csvRowTime(c))+'"/></div>'
      + '</div>'
      + '<button type="button" class="crs-done" onclick="csvSheetValDone()">'+esc(L('Xong','Done'))+'</button>';
  } else { return ''; }
  var sub = '<span class="num">'+esc(csvAmtDisp(c))+'</span>'
    + (c.description ? ' · '+esc(String(c.description).slice(0,36)) : '');
  return '<div class="crs-scrim" onclick="csvRowSheetClose()"></div>'
    + '<div class="crs-sheet"><div class="modal-grip"></div>'
    + '<div class="crs-t">'+esc(title)+'</div><div class="crs-sub">'+sub+'</div>'
    + '<div class="crs-body">'+body+'</div></div>';
}
/* Paint (or clear) the picker overlay. Runs on every review render, so the
   sheet's chips always reflect the candidate's current values, and a sheet
   whose row vanished (collapse, import, delete) closes itself. */
function csvRowSheetSync(){
  var m = document.getElementById('csv-rowsheet'); if(!m) return;
  var c = (csvRowSheet && csvStagedMode) ? csvExpandedCandidate() : null;
  if(!c){ if(m.innerHTML) m.innerHTML=''; csvRowSheet = null; return; }
  m.innerHTML = csvRowSheetHTML(c);
}

/* ── CTA bar actions ── */
/* Lookalike rows: same bank, same direction, same memo once numbers are
   stripped. Deliberately conservative — a too-short key matches everything,
   so anything under 6 meaningful chars proposes nothing. */
function csvSimKey(c){
  var s = (c.description||'').toLowerCase().replace(/\d+/g,' ').replace(/\s+/g,' ').trim();
  return s.length >= 6 ? s : '';
}
function csvSimilarRows(c){
  if(!csvReview || !csvStagedMode) return [];
  var k = csvSimKey(c); if(!k) return [];
  var prov = csvStagedProvider(c);
  return (csvReview.ready||[]).filter(function(r){
    return r !== c && csvSimKey(r) === k && csvStagedProvider(r) === prov
      && !!r.isIncome === !!c.isIncome;
  });
}
/* Copy this row's decisions onto its lookalikes: destination, kind (with the
   kind's follow-up picks), category, payer. Facts (amount, date, time, memo)
   stay each row's own. */
function csvApplySimilar(i){
  if(!csvReview) return;
  var c = csvReview.ready[i]; if(!c) return;
  csvReadEditor(c);
  var sims = csvSimilarRows(c); if(!sims.length) return;
  sims.forEach(function(r){
    r._scope = csvRowScope(c);
    r.isTransfer = c.isTransfer; r._xfer = c._xfer; r._repay = c._repay; r.isIncome = c.isIncome;
    r._payCardId = c._payCardId; r._xferOtherId = c._xferOtherId; r._repayWho = c._repayWho;
    if(c.categoryName){ r.categoryName = c.categoryName; r.catSource = 'user';
      if(typeof csvLearnFrom === 'function') csvLearnFrom(r); }
    if(c._incomeCat) r._incomeCat = c._incomeCat;
    if(c.who) r.who = c.who;
  });
  window.toast && toast(L('Đã áp cho '+sims.length+' khoản giống','Applied to '+sims.length+' similar'));
  renderCsvReview();
}
/* Import exactly one row, now. Rides the whole fhPromoteStaged machinery —
   write, retire, view rebuild — by borrowing the selection for one call:
   everything else is unticked for the duration and restored after, so the
   real selection survives whether the write lands or fails. */
window.csvImportOne = async function(i){
  if(!csvReview || !csvStagedMode || !window.fhPromoteStaged) return;
  var c = csvReview.ready[i]; if(!c) return;
  csvReadEditor(c);
  c._skipImport = false;              // importing it IS selecting it
  csvRowSheet = null; csvExpand = null;
  var stash = csvReview.ready.map(function(r){ return [r, !!r._skipImport]; });
  csvReview.ready.forEach(function(r){ r._skipImport = (r !== c); });
  try { await fhPromoteStaged(); }
  finally {
    stash.forEach(function(p){ if(p[0] !== c) p[0]._skipImport = p[1]; });
    if(window.csvReview && document.getElementById('csv-result')) renderCsvReview();
  }
};

// Reads the expanded card's fields back onto its candidate.
/* Amount is a plain top input now (not a sheet that committed on "Xong"), so it
   only lands on the candidate when csvReadEditor runs. Flush on blur so a typed
   figure survives a straight tap to the nav Import, not only a row/collapse. */
window.csvAmtBlur = function(el){
  if(typeof snapAmtInput==='function') snapAmtInput(el);
  var c = (typeof csvExpandedCandidate==='function') ? csvExpandedCandidate() : null;
  if(c) csvReadEditor(c);
};
function csvReadEditor(c){
  if(!c) return;
  var n=document.getElementById('csvedit-note');
  if(n && n.value.trim()) c.description = n.value.trim();
  var a=document.getElementById('csvedit-amt');
  if(a){ var v = window.classifyAmount ? window.classifyAmount(a.value||'') : null;
         if(v && v.status==='ok' && v.value > 0){
           // A typed ₫ figure is the person's own number (see csvSheetValDone);
           // it overrides the estimate and, for the no-rate fallback, selects
           // the row. The estimate is pre-filled, so leaving it untouched keeps
           // it — which is the whole zero-typing point.
           if(csvFxInfo(c)){ if(csvFxUnresolved(c)) c._skipImport = false; c._fxVnd = true; }
           c.amount = v.value;
         } }
  var d=document.getElementById('csvedit-date');
  if(d && d.value){ c.dateDisplay = d.value; c.date = new Date(d.value+'T00:00:00'); }
  var ti=document.getElementById('csvedit-time');
  if(ti) c.time = ti.value || '';   // explicit reviewed value (incl. '' to clear → day-only)
  if(document.getElementById('csvedit-cats')){ var cat = chosen('csvedit-cats'); if(cat){ c.categoryName = cat; c.catSource='user'; } }
  if(document.getElementById('csvedit-inccats')){ var ic = chosen('csvedit-inccats'); if(ic) c._incomeCat = ic; }
  if(document.getElementById('csvedit-repwho')){ c._repayWho = (document.getElementById('csvedit-repwho').value||'').trim() || c._repayWho; }
  if(document.getElementById('csvedit-newacct')){ c._xferNewName = document.getElementById('csvedit-newacct').value || ''; }   // keep a half-typed account name across re-renders
  if(document.getElementById('csvedit-who')){ var w = chosen('csvedit-who'); if(w) c.who = w; }
}
/* The income-side category set (0109) — its own small list, never the family
   expense categories. */
var FH_INCOME_CATS = ['Lương','Thưởng','Hoàn tiền','Khác'];

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
  // A card payment is personal — a shared row can never be one, so leaving it
  // family-scoped would import "trả nợ thẻ" as a family expense and double-count.
  if(v!=='personal'){ c.isTransfer = false; c._payCardId = null; c._xfer = false; c._xferOtherId = null; c._repay = false; c._repayWho = null; }
  csvSetScope(v);              // and it becomes the default for rows not yet decided
  renderCsvReview();
}
/* Kind control for a STAGED row: the pipeline guessed "trả nợ thẻ" (a transfer)
   or a normal spend, and the guess can be wrong — this lets a person correct it
   in the expanded card. "Trả nợ thẻ" also asks WHICH card (the bank mail that
   pays a card rarely names it). Flipping to "Chi tiêu" restores the category
   chips so it imports as a normal expense. (Routing a transfer to a group
   settle-up is deferred — a bank debit rarely names the group.) */
function csvCreditCards(){
  return ((window.fhPersonalData && fhPersonalData().accounts) || []).filter(function(a){ return a.kind==='credit_card'; });
}
/* Non-card accounts a transfer leg can pair with (0109) — the "other side"
   picker. Excludes the row's own instrument when it is knowable. */
function csvXferAccounts(c){
  var mine = (window.fhStagedAcct && c) ? fhStagedAcct(c) : null;
  return ((window.fhPersonalData && fhPersonalData().accounts) || []).filter(function(a){
    if(a.kind === 'credit_card') return false;
    if(mine && mine.tail && a.tail && a.tail === mine.tail && (a.provider||'') === (mine.provider||'').toLowerCase()) return false;
    return true;
  });
}
function csvRowKindField(c){
  var credit = !!c.isIncome || c._xferDir === 'in';
  /* which face is on: expense | cardpay | xfer | income | repay */
  var cur = c._xfer ? 'xfer' : (c._repay ? 'repay' : (c.isTransfer ? 'cardpay' : (c.isIncome ? 'income' : 'expense')));
  var kchip = function(v,label){
    return '<button type="button" class="choice'+(cur===v?' on':'')+'" onclick="csvPickRowKind(\''+v+'\')">'+esc(label)+'</button>';
  };
  var h = '<div class="field csv-kindf"><label>'+esc(L('Loại khoản','Kind'))+'</label><div class="choices">';
  if(credit){
    h += kchip('income',L('Thu nhập','Income'))
       + kchip('xfer',L('🔁 Chuyển khoản nội bộ','🔁 Internal transfer'))
       + kchip('repay',L('🤝 Thu nợ','🤝 Repayment in'));
  } else {
    h += kchip('expense',L('Chi tiêu','Spending'))
       + kchip('transfer',L('💳 Trả nợ thẻ','💳 Card payment'))
       + kchip('xfer',L('🔁 Chuyển đi nội bộ','🔁 Internal transfer'));
  }
  h += '</div></div>';
  if(cur==='cardpay'){
    var cards = csvCreditCards();
    var pc = c._payCardId || (cards.length===1 ? cards[0].id : '');
    h += '<div class="field csv-paycardf"><label>'+esc(L('Trả cho thẻ nào','Which card'))+'</label><div class="choices">'
      + cards.map(function(a){ return '<button type="button" class="choice'+(pc===a.id?' on':'')+'" onclick="csvPickPayCard(\''+a.id+'\')">'+esc(a.name||'Thẻ')+'</button>'; }).join('')
      + '<button type="button" class="choice'+(!pc?' on':'')+'" onclick="csvPickPayCard(\'\')">'+esc(L('Chưa rõ','Not sure'))+'</button>'
      + '</div>'
      + (cards.length ? '' : '<div class="csv-scope-note">'+esc(L('Chưa có thẻ tín dụng nào — vẫn ghi được, gán thẻ sau ở mục Nợ & cho vay.','No credit card yet — it still imports, assign a card later in Owing & lending.'))+'</div>')
      + '</div>';
  }
  if(cur==='xfer'){
    /* the counterpart account — the leg this mail never saw. A pair is always
       written (spec T4): confirming creates the other-side row too. Some banks
       never email money-in at all, so the destination may be an account capture
       has never seen — "+ Tài khoản khác" names it into existence right here. */
    var accts = csvXferAccounts(c);
    var sel = c._xferOtherId || '';
    h += '<div class="field csv-paycardf"><label>'+esc(credit?L('Chuyển từ đâu?','From which account?'):L('Chuyển đến đâu?','To which account?'))+'</label><div class="choices">'
      + accts.map(function(a){ return '<button type="button" class="choice'+(sel===a.id?' on':'')+'" onclick="csvPickXferAcct(\''+a.id+'\')">'+esc(a.name||'Tài khoản')+'</button>'; }).join('')
      + '<button type="button" class="choice'+(sel==='_cash'?' on':'')+'" onclick="csvPickXferAcct(\'_cash\')">'+esc(L('Tiền mặt','Cash'))+'</button>'
      + '<button type="button" class="choice'+(c._xferAddingNew?' on':'')+'" onclick="csvXferAddNew()">＋ '+esc(L('Tài khoản khác','Other account'))+'</button>'
      + '</div>'
      + (c._xferAddingNew
          ? '<div class="csv-newacct"><input id="csvedit-newacct" placeholder="'+escAttr(L('Tên tài khoản, vd. VCB tiết kiệm','Account name, e.g. VCB savings'))+'" value="'+escAttr(c._xferNewName||'')+'"/>'
            + '<button type="button" class="btn-line" onclick="csvXferCreateAcct()">'+esc(L('Tạo','Create'))+'</button></div>'
          : '')
      + '<div class="csv-scope-note">'+esc(L('Ghi thành một cặp chuyển khoản — không tính là chi tiêu hay thu nhập.','Recorded as a transfer pair — never spending, never income.'))+'</div></div>';
  }
  if(cur==='repay'){
    var pd = (window.fhPersonalDebts && fhPersonalDebts()) || { people: [] };
    var names = pd.people.filter(function(p){ return p.balance > 0.5; }).map(function(p){ return p.who; });
    h += '<div class="field csv-paycardf"><label>'+esc(L('Ai trả bạn?','Who repaid you?'))+'</label>'
      + (names.length ? '<div class="choices" style="margin-bottom:8px">'
          + names.map(function(n){ return '<button type="button" class="choice'+(c._repayWho===n?' on':'')+'" onclick="csvPickRepayWho(\''+escAttr(n)+'\')">'+esc(n)+'</button>'; }).join('')+'</div>' : '')
      + '<input id="csvedit-repwho" placeholder="'+escAttr(L('vd. Thằng em','e.g. a name'))+'" value="'+escAttr(c._repayWho||'')+'"/>'
      + '<div class="csv-scope-note">'+esc(L('Trừ vào số họ đang nợ bạn — không tính là thu nhập.','Draws down what they owe you — never income.'))+'</div></div>';
  }
  return h;
}
function csvPickRowKind(v){
  var c = csvExpandedCandidate(); if(!c) return;
  csvReadEditor(c);
  c.isTransfer = (v==='transfer');
  c._xfer = (v==='xfer');
  c._repay = (v==='repay');
  if(v==='income'){ c.isIncome = true; }
  else if(v==='expense'){ c.isIncome = false; }
  if(!c.isTransfer){ c._payCardId = null; }
  else if(!c._payCardId){ var cards = csvCreditCards(); if(cards.length===1) c._payCardId = cards[0].id; }
  if(!c._xfer){ c._xferOtherId = null; }
  if(!c._repay){ c._repayWho = null; }
  renderCsvReview();          // stays expanded (csvExpand unchanged); shows/hides the pickers + category
}
function csvPickXferAcct(id){
  var c = csvExpandedCandidate(); if(!c) return;
  csvReadEditor(c);
  c._xferOtherId = id || null;
  c._xferAddingNew = false;
  renderCsvReview();
}
/* "+ Tài khoản khác" — the counterpart bank capture has never seen (it sends
   no money-in emails). Toggles an inline name field; Create materializes a
   deposit account on the spot and selects it as the pair's other side. */
function csvXferAddNew(){
  var c = csvExpandedCandidate(); if(!c) return;
  csvReadEditor(c);
  c._xferAddingNew = !c._xferAddingNew;
  renderCsvReview();
}
window.csvXferCreateAcct = async function(){
  var c = csvExpandedCandidate(); if(!c) return;
  var el = document.getElementById('csvedit-newacct');
  var name = ((el && el.value) || '').trim();
  if(!name){ window.toast && toast(L('Đặt tên tài khoản nhé','Name the account first')); return; }
  csvReadEditor(c);
  var id = window.fhPersonalAccountCreate ? await fhPersonalAccountCreate(name, 'deposit') : null;
  if(!id){ window.toast && toast(L('Chưa tạo được, thử lại','Couldn\'t create, try again')); return; }
  c._xferOtherId = id; c._xferAddingNew = false; c._xferNewName = null;
  window.toast && toast(L('Đã tạo tài khoản '+name,'Created '+name));
  renderCsvReview();
};
function csvPickRepayWho(name){
  var c = csvExpandedCandidate(); if(!c) return;
  csvReadEditor(c);
  c._repayWho = name || null;
  renderCsvReview();
}
function csvPickPayCard(id){
  var c = csvExpandedCandidate(); if(!c) return;
  csvReadEditor(c);
  c._payCardId = id || null;
  renderCsvReview();
}
/* ── the internal-transfer matcher (0109, spec §8) ──────────────────────────
   pairable(debit, credit): opposite directions · two different own instruments ·
   EXACT amount (VN internal transfers are fee-free — no tolerance) · txn_date
   within ±1 day · neither is a card leg (those keep the card-payment flow).
   Greedy, one partner each; any ambiguity proposes nothing. */
var csvXferDismissed = {};
function csvXferProposals(){
  if(!csvStagedMode || !csvReview) return [];
  var credits = [], debits = [];
  (csvReview.ready||[]).forEach(function(c){
    if(c._xfer || c.isTransfer || c._repay || c._skipImport) return;
    if(!(c.amount > 0) || !c.date) return;
    var ai = window.fhStagedAcct ? fhStagedAcct(c) : null;
    if(!ai || ai.kind === 'credit_card') return;
    (c.isIncome ? credits : debits).push({ c: c, ai: ai });
  });
  var used = {}, out = [];
  credits.forEach(function(cr){
    var matches = debits.filter(function(db){
      if(used[db.c.rowIndex]) return false;
      if(Math.abs(db.c.amount - cr.c.amount) >= 1) return false;
      if(Math.abs(db.c.date.getTime() - cr.c.date.getTime())/86400000 > 1.5) return false;
      if((db.ai.provider||'') === (cr.ai.provider||'') && (db.ai.tail||'') === (cr.ai.tail||'')) return false;   // same instrument — not a move between two
      return true;
    });
    if(matches.length !== 1) return;   // zero or ambiguous → no proposal
    var db = matches[0];
    var rows = window._fhStagedRows || [];
    var key = ((rows[db.c.rowIndex]||{}).id || db.c.rowIndex) + '|' + ((rows[cr.c.rowIndex]||{}).id || cr.c.rowIndex);
    if(csvXferDismissed[key]) return;
    used[db.c.rowIndex] = 1;
    out.push({ key: key, debit: db, credit: cr });
  });
  return out;
}
/* A captured "Số dư" rides along at commit: store it on the account so the
   drift badge argues against the bank's own number (spec §5.2). Base units. */
function csvXferCaptureBal(c, acctId){
  try{
    var x = window.fhStagedRawX ? fhStagedRawX(c.rowIndex) : null;
    var b = x && Number(x.balance);
    if(acctId && b > 0 && window.fhPersonalExtBalanceSet) fhPersonalExtBalanceSet(acctId, csvBaseAmt(b), c.dateDisplay || undefined);
  }catch(e){}
}
window.csvXferConfirm = async function(key){
  var p = (window._csvXferProps||{})[key]; if(!p) return;
  var pd = window.fhPersonalData ? fhPersonalData() : null;
  if(!pd || pd.state !== 'ready'){ window.toast && toast(L('Mở khoá sổ cá nhân trước','Unlock your personal ledger first')); return; }
  var fromId = null, toId = null;
  try{ fromId = await fhPersonalAccountEnsure(p.debit.ai); toId = await fhPersonalAccountEnsure(p.credit.ai); }catch(e){}
  if(!fromId || !toId || fromId === toId){ window.toast && toast(L('Chưa nhận diện được hai tài khoản','Couldn\'t resolve the two accounts')); return; }
  var base = csvBaseAmt(p.debit.c.amount);
  var note = p.debit.c.description || p.credit.c.description || L('Chuyển khoản nội bộ','Internal transfer');
  var src = window.fhStagedSource ? fhStagedSource(p.debit.c) : null;
  var ok = await fhPersonalAddTransferPair(base, fromId, toId, note, p.debit.c.dateDisplay || undefined, src);
  if(!ok){ window.toast && toast(L('Chưa ghi được, thử lại','Couldn\'t save, try again')); return; }
  csvXferCaptureBal(p.debit.c, fromId);
  csvXferCaptureBal(p.credit.c, toId);
  var rows = window._fhStagedRows || [];
  var ids = [rows[p.debit.c.rowIndex], rows[p.credit.c.rowIndex]].map(function(r){ return r && r.id; }).filter(Boolean);
  if(ids.length && window.fhStagedRetireIds){ try{ await fhStagedRetireIds(ids); }catch(e){} }
  csvReview.ready = (csvReview.ready||[]).filter(function(c){ return c !== p.debit.c && c !== p.credit.c; });
  window.toast && toast(L('Đã ghi chuyển khoản nội bộ','Internal transfer recorded'));
  if(window.renderPersonal) renderPersonal();
  renderCsvReview();
};
window.csvXferDismiss = function(key){
  csvXferDismissed[key] = 1;
  renderCsvReview();
};

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

/* Every way a card can be suspected (or known) to repeat something. One
   predicate, because the chip, the evidence note, the header count and the
   filter must all agree on what "trùng" means or the counts read as lies. */
function csvIsFlaggedDup(c){
  return !!(c && (c.duplicateOfBatch || c.duplicateOfExisting || c.duplicateOfPipeline
                  || c.duplicateOfSource || c.duplicateResolvedBefore || c.duplicateNearMiss));
}

/* The WHY behind a flag, with the evidence attached. "Is this the same
   purchase?" is unanswerable from memory — the card must show the other
   half: what the ledger row says, how much, when, which book, who logged it.
   Certainty and suspicion read differently on purpose: a resolved_before hit
   is message-id equality (a fact), an amount-within-3-days hit is a guess
   worth one look. */
function csvDupWhy(c){
  var mult = (typeof curMult === 'function' ? curMult() : 1) || 1;
  var ev = function(t){
    if(!t || !t._d) return '';
    var bits = [];
    var label = String(t.note || t.cat || '').trim();
    if(label) bits.push('“' + label + '”');
    if(t.amtD != null) bits.push(fmt(t.amtD / mult));
    if(typeof fmtDayMon === 'function') bits.push(fmtDayMon(t._d));
    bits.push(t.book === 'personal' ? L('sổ Riêng tư','Personal book') : L('sổ Gia đình','Family book'));
    if(t.book === 'family' && t.who && t.who !== 'Shared') bits.push(L(t.who + ' đã ghi', 'logged by ' + t.who));
    return bits.join(' · ');
  };
  if(c.duplicateResolvedBefore)
    return L('Đúng email này đã được nhập hoặc bỏ qua trong lần kết nối trước — chắc chắn, vì trùng từng email. Nếu bạn đã xoá giao dịch đó khỏi sổ thì cứ nhập lại.',
             'This exact email was imported or dismissed in a previous connection — certain, same message. If you have since deleted that transaction, just import it again.');
  if(c.duplicateOfExisting){
    var e1 = ev(c.duplicateOfExisting);
    return L('Trùng với một giao dịch đã có trong sổ (cùng số tiền, trong vòng 3 ngày)','Matches a transaction already in your ledger (same amount, within 3 days)')
      + (e1 ? ': ' + e1 : '.');
  }
  if(c.duplicateNearMiss){
    var t2 = c.duplicateNearMiss;
    var d2 = Math.round(Math.abs(t2.amtD - Number(c.amount)));
    var e2 = ev(t2);
    return L('Gần trùng — cùng nơi chi, cùng ngày, lệch ' + d2.toLocaleString('vi-VN') + 'đ (có thể do làm tròn khi ghi tay)',
             'Near match — same place, same day, ' + d2.toLocaleString('en-US') + 'đ apart (possibly a rounded manual entry)')
      + (e2 ? ': ' + e2 : '.');
  }
  if(c.duplicateOfPipeline || c.duplicateOfSource)
    return L('Có một email khác cùng số tiền, từ nguồn khác, trong vòng 3 ngày. Có thể là một lần chi được báo hai lần.',
             'There is another email for the same amount, from a different source, within 3 days. This may be one purchase reported twice.');
  if(c.duplicateOfBatch)
    return window.csvStagedMode
      ? L('Xuất hiện 2 lần với cùng nội dung và số tiền.','Appears twice with the same description and amount.')
      : L('Xuất hiện 2 lần trong file này với cùng nội dung và số tiền.','Appears twice in this file with the same description and amount.');
  return '';
}

/* Staged review's check-count line: the diligence made visible. A card that
   is NOT flagged carries an invisible claim — "we compared this against your
   books and it looks new" — and until this line existed there was no way to
   know the comparison even ran. The filter narrows the list to flagged cards
   so ruling on ten suspects is not a hunt through eighty rows; ticking is the
   one include verb it already has. */
window.csvDupFilter = false;
function csvDupStrip(total, dupN){
  var on = !!window.csvDupFilter;
  var line = esc(L('Đã đối chiếu ' + total + ' thẻ với sổ chi tiêu','Checked ' + total + ' cards against your ledgers'));
  line += dupN
    ? ' — <b>' + dupN + '</b> ' + esc(L('có thể trùng','possible duplicate' + (dupN === 1 ? '' : 's')))
    : ' — ' + esc(L('không thấy trùng','no matches found'));
  var act = '';
  if(dupN){
    act += '<button type="button" class="txh-sublink" onclick="csvDupFilterToggle()">'
        + esc(on ? L('Hiện tất cả','Show all') : L('Chỉ xem thẻ trùng','Only duplicates')) + '</button>';
    if(on){
      var flagged = (csvReview && csvReview.ready || []).filter(csvIsFlaggedDup);
      var allOn = flagged.length > 0 && flagged.every(function(c){ return !c._skipImport; });
      act += '<button type="button" class="txh-sublink" onclick="csvDupSelectFlagged(' + (allOn ? 'false' : 'true') + ')">'
          + esc(allOn ? L('Bỏ chọn tất cả','Clear all') : L('Chọn tất cả để nhập','Select all to import')) + '</button>';
    }
  }
  return '<div class="csv-dupstrip"><span>' + line + '</span>' + act + '</div>';
}
window.csvDupFilterToggle = function(){
  window.csvDupFilter = !window.csvDupFilter;
  csvExpand = null; renderCsvReview();
};
window.csvDupSelectFlagged = function(on){
  ((csvReview && csvReview.ready) || []).forEach(function(c){
    if(csvIsFlaggedDup(c)) c._skipImport = !on;
  });
  renderCsvReview(); csvPersistDraft();
};

/* ── In-review summary — brief line + Ngày/Tuần/Tháng zoom + pannable Chi bars ──
   A whole-batch overview at the top of BOTH review flows (staged bank-email and
   file import): every readable row in the queue counts, no exception — ready,
   folded-in duplicate suspects, held-back money-in, needs-category — because the
   question it answers is "how big is what I'm looking at?", not "what's ticked?"
   (the Import button already answers that). It deliberately ignores the dup
   filter for the same reason.

   Membership is the correctness spine:
     · Thu  = isIncome rows.
     · Chi  = plain expenses (!isIncome && !isTransfer && !_xfer).
     · Transfers / card repayments / self-transfers count in the row total but
       in NEITHER amount — money moving is not money spent or earned, and
       adding a card repayment to Chi double-counts the month (the same reason
       the review holds them back from import).
     · Merged-away richer-copy twins are in no bucket, so they're excluded by
       construction — counting both copies of one payment double-counts it.
     · FX-unresolved rows count as rows but contribute 0đ until a real ₫
       amount exists — a foreign number added raw would be wrong in any unit.
   Bars are Chi-only (income in a review batch is a handful of held-back
   credits; paired bars would be mostly-empty stubs). No-date rows are in the
   brief's count but can't sit on a timeline.

   TWO LAYERS per bar, same anatomy as the finance widget but a different
   meaning: the grey back bar is the period's WHOLE queue (the honest total
   above), the green front bar is the portion currently ticked for import —
   "of what's here, this much is going into my ledger", live as ticks flip.
   Green means accepted here, not compared: the widget's this-vs-last-period
   baseline has no equivalent in a one-off batch. Held-out buckets and folded
   dup suspects (unticked) are grey-only by construction; in the file flow
   every ready row imports, so ready bars read fully green — also true. */
var csvSumZoom = 'week';     // 'day' | 'week' | 'month' — reset per batch in csvBuildReview
var csvSumScroll = null;     // strip scrollLeft; null = pin to newest (right end)
var csvSumRaf = 0;

function csvSumData(){
  var r = csvReview; if(!r) return null;
  var cands = [];
  // _sel marks the green layer: a ready row going into the import — ticked in
  // staged mode, every ready row in the file flow. Held-out buckets never are.
  r.ready.forEach(function(c){ cands.push({ c:c, sel:(csvStagedMode ? !c._skipImport : true) }); });
  r.groups.forEach(function(g){ g.items.forEach(function(c){ cands.push({ c:c }); }); });
  r.dup.forEach(function(d){ if(d.resolved===null) cands.push({ c:d.c }); });   // resolved dups moved into ready/groups (keep) or out (skip)
  r.deferred.forEach(function(c){ cands.push({ c:c }); });
  var n=0, thu=0, chi=0, byDay={}, bySel={};
  cands.forEach(function(e){
    var c=e.c; n++;
    var a = (typeof csvFxUnresolved==='function' && csvFxUnresolved(c)) ? 0 : csvBaseAmt(c.amount||0);
    if(c.isIncome){ thu+=a; return; }
    if(c.isTransfer || c._xfer) return;
    chi+=a;
    if(a>0 && c.dateDisplay){
      byDay[c.dateDisplay]=(byDay[c.dateDisplay]||0)+a;
      if(e.sel) bySel[c.dateDisplay]=(bySel[c.dateDisplay]||0)+a;
    }
  });
  return { n:n, thu:thu, chi:chi, byDay:byDay, bySel:bySel };
}
/* byDay (ISO 'YYYY-MM-DD' → base đ) → chronological buckets for the zoom.
   Day collapses to days that have spend (a 90-day backfill in day view is
   otherwise mostly gaps); Week/Month keep empty periods as zero slots so the
   time axis stays honest — a gap reads as "nothing that week". */
function csvSumBuckets(byDay, bySel){
  var days = Object.keys(byDay).sort();
  if(!days.length) return [];
  bySel = bySel || {};
  var out=[];
  var iso=function(d){ return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); };
  if(csvSumZoom==='day'){
    days.forEach(function(k){
      var d=new Date(k+'T00:00:00');
      out.push({ s:k, e:k, lbl:d.getDate()+'/'+(d.getMonth()+1), amt:byDay[k], sel:bySel[k]||0 });
    });
    return out;
  }
  var d0=new Date(days[0]+'T00:00:00'), d1=new Date(days[days.length-1]+'T00:00:00');
  if(csvSumZoom==='week'){
    var mon=new Date(d0); mon.setDate(mon.getDate()-((mon.getDay()+6)%7));   // Monday of the first week
    while(mon<=d1){
      var end=new Date(mon); end.setDate(end.getDate()+6);
      var ws=iso(mon), we=iso(end), wa=0, wsel=0;
      days.forEach(function(k){ if(k>=ws&&k<=we){ wa+=byDay[k]; wsel+=bySel[k]||0; } });
      out.push({ s:ws, e:we, lbl:mon.getDate()+'/'+(mon.getMonth()+1), amt:wa, sel:wsel });
      mon.setDate(mon.getDate()+7);
    }
    return out;
  }
  var m=new Date(d0.getFullYear(), d0.getMonth(), 1);
  while(m<=d1){
    var mEnd=new Date(m.getFullYear(), m.getMonth()+1, 0);
    var ms=iso(m), me=iso(mEnd), ma=0, msel=0;
    days.forEach(function(k){ if(k>=ms&&k<=me){ ma+=byDay[k]; msel+=bySel[k]||0; } });
    out.push({ s:ms, e:me, lbl:moAbbr(m.getMonth()), amt:ma, sel:msel });
    m.setMonth(m.getMonth()+1);
  }
  return out;
}
function csvSumHTML(){
  var d = csvSumData(); if(!d || !d.n) return '';
  var html = '<div class="csum">'
    + '<div class="csum-brief">'+d.n+' '+L('giao dịch','transactions')
    + ' · <span class="csum-dn">↓ '+esc(fmt(d.chi))+'</span>'
    + ' · <span class="csum-up">↑ '+esc(fmt(d.thu))+'</span></div>';
  var buckets = csvSumBuckets(d.byDay, d.bySel);
  if(buckets.length){
    var Z=[['day',L('Ngày','Day')],['week',L('Tuần','Week')],['month',L('Tháng','Month')]];
    html += '<div class="csum-zoom">'+Z.map(function(z){
      return '<button type="button" class="csum-z'+(csvSumZoom===z[0]?' on':'')+'" onclick="csvSumZoomGo(\''+z[0]+'\')">'+z[1]+'</button>';
    }).join('')+'</div>';
    var max=1; buckets.forEach(function(b){ if(b.amt>max) max=b.amt; });
    html += '<div class="csum-strip" id="csum-strip" onscroll="csvSumOnScroll(this)">';
    buckets.forEach(function(b){
      var h = b.amt>0 ? Math.max(Math.round(b.amt/max*100),4) : 0;
      // green front bar = the ticked share, same overlay as the widget's
      // .prev/.cur pair; sel ≤ amt always, so it sits inside the grey
      var hs = b.sel>0 ? Math.max(Math.round(b.sel/max*100),4) : 0;
      html += '<div class="csum-col" data-amt="'+b.amt+'" data-s="'+b.s+'" data-e="'+b.e+'" onclick="csvSumTap(this)">'
        + '<span class="csum-bars">'
        + (b.amt>0
            ? '<span class="csum-val num" style="bottom:calc('+h+'% + 3px)">'+esc(fmtK(b.amt))+'</span><i class="csum-bar" style="height:'+h+'%"></i>'
              + (hs ? '<i class="csum-bar sel" style="height:'+hs+'%"></i>' : '')
            : '')
        + '</span><span class="csum-lbl">'+esc(b.lbl)+'</span></div>';
    });
    html += '</div>';
  }
  return html + '</div>';
}
function csvSumZoomGo(z){ csvSumZoom=z; csvSumScroll=null; renderCsvReview(); }
function csvSumOnScroll(el){
  csvSumScroll = el.scrollLeft;   // survives the full innerHTML re-render every edit triggers
  if(csvSumRaf) return;
  csvSumRaf = requestAnimationFrame(function(){ csvSumRaf=0; csvSumLabelSync(); });
}
/* The amount label rides the tallest bar CURRENTLY IN VIEW, recomputed as the
   strip pans — a label pinned to an off-screen global max helps nobody. */
function csvSumLabelSync(){
  var el=document.getElementById('csum-strip'); if(!el) return;
  var x0=el.scrollLeft, x1=x0+el.clientWidth, best=null, bestAmt=0;
  for(var i=0;i<el.children.length;i++){
    var c=el.children[i], mid=c.offsetLeft + c.offsetWidth/2;
    if(mid<x0 || mid>x1) continue;
    var a=Number(c.getAttribute('data-amt'))||0;
    if(a>bestAmt){ bestAmt=a; best=c; }
  }
  for(var j=0;j<el.children.length;j++){
    var v=el.children[j].querySelector('.csum-val');
    if(v) v.style.opacity = (el.children[j]===best)?'1':'0';
  }
}
function csvSumAfterRender(){
  var el=document.getElementById('csum-strip'); if(!el) return;
  el.scrollLeft = (csvSumScroll==null) ? el.scrollWidth : csvSumScroll;   // newest sits at the right end
  csvSumLabelSync();
}
/* Tap a bar → scroll the list to the earliest day-group inside that bar's
   period. Day groups exist only in the dated ready list; a period whose rows
   all sit in the held-out sections has no anchor and the tap is a gentle
   no-op. The scroller is the MODAL body — _persScrollTo is hardcoded to the
   main #scroll container and would scroll the wrong element here. */
function csvSumTap(col){
  var s=col.getAttribute('data-s'), e=col.getAttribute('data-e');
  var anchors=document.querySelectorAll('#csv-result [id^="csvday-"]');
  var bestIso=null;
  for(var i=0;i<anchors.length;i++){
    var dIso=anchors[i].id.slice(7);
    if(dIso>=s && dIso<=e && (bestIso===null || dIso<bestIso)) bestIso=dIso;
  }
  if(!bestIso) return;
  var body=document.querySelector('#csv-import-modal .modal-body');
  var el=document.getElementById('csvday-'+bestIso);
  if(!body || !el) return;
  var y=el.getBoundingClientRect().top - body.getBoundingClientRect().top + body.scrollTop - 8;
  body.scrollTo({ top:Math.max(0,y), behavior:'smooth' });
}

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
    var why = csvDupWhy(d.c)
      || (csvStagedMode
        ? L('Xuất hiện 2 lần với cùng nội dung và số tiền.','Appears twice with the same description and amount.')
        : L('Xuất hiện 2 lần trong file này với cùng nội dung và số tiền.','Appears twice in this file with the same description and amount.'));
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

  // In-review summary — above the first bucket in both flows (top of the list
  // in staged mode, after the file chrome in import mode). Non-sticky by
  // design: tapping a bar scrolls the list DOWN to that period, so the chart
  // naturally leaves the viewport, like the personal tab's own card.
  html += csvSumHTML();

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
          + '<span class="csv-inflow-a">'+esc(csvAmtDisp(e.c))+'</span>'
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

  /* ── Chuyển khoản nội bộ? (0109, spec §8) — propose-only pairing. A captured
     debit and credit that look like two legs of one own-account transfer are
     grouped into ONE card; a tap commits the pair (both legs, one
     transfer_group_id) and retires both staged rows. Ambiguity (two possible
     partners) proposes nothing; a dismissed pair stays dismissed this open. ── */
  if(csvStagedMode){
    var props = csvXferProposals();
    window._csvXferProps = {};
    if(props.length){
      html += '<div class="group-h">'+esc(L('Chuyển khoản nội bộ?','Internal transfer?'))+'</div>';
      props.forEach(function(p){
        window._csvXferProps[p.key] = p;
        var fromN = fhProviderName(p.debit.ai.provider||'') || L('Tài khoản','Account');
        var toN = fhProviderName(p.credit.ai.provider||'') || L('Tài khoản','Account');
        html += '<div class="bulk-card csv-xfer-prop">'
          + '<div class="csv-xfer-t"><span class="route">🔁 '+esc(fromN)+(p.debit.ai.tail?' ••'+esc(p.debit.ai.tail):'')+' → '+esc(toN)+(p.credit.ai.tail?' ••'+esc(p.credit.ai.tail):'')+'</span>'
          + '<span class="csv-xfer-amt num">'+esc(csvFmt(p.debit.c.amount))+'</span></div>'
          + '<div class="csv-xfer-s">'+esc(L('Hai giao dịch này khớp số tiền và ngày — có vẻ là bạn chuyển giữa tài khoản của mình. Ghi thành một cặp chuyển khoản, không tính thu chi.','These two match on amount and date — looks like a move between your own accounts. Records as one transfer pair, never income or spending.'))+'</div>'
          + '<div class="dup-actions">'
          + '<button type="button" class="btn-line" onclick="csvXferConfirm(\''+escAttr(p.key)+'\')">'+esc(L('Đúng, ghi chuyển khoản','Yes, record the transfer'))+'</button>'
          + '<button type="button" class="btn-text-quiet" onclick="csvXferDismiss(\''+escAttr(p.key)+'\')">'+esc(L('Không phải','Not a transfer'))+'</button>'
          + '</div></div>';
      });
    }
  }

  /* Ready list, grouped by date (newest first) -- same cards, no red border. */
  if(r.ready.length){
    /* The comparison happened either way; staged mode SAYS so, with the count
       of suspects and the filter that narrows the list to them. */
    if(csvStagedMode){
      html += csvDupStrip(r.ready.length, r.ready.filter(csvIsFlaggedDup).length);
    }
    var dateBuckets = {};
    r.ready.forEach(function(c, i){
      if(csvStagedMode && window.csvDupFilter && !csvIsFlaggedDup(c)) return;
      var k = c.dateDisplay || ''; (dateBuckets[k] = dateBuckets[k] || []).push({ c:c, i:i });
    });
    var keys = Object.keys(dateBuckets).sort().reverse();
    // Chọn nhanh's conditions mark the list: matches keep full ink, the rest
    // fade. A highlight, never a hide — every row stays on screen and tickable.
    var pickOn = csvStagedMode && csvPickCount() > 0;
    var pickWk = pickOn ? csvPickWeekMax() : 0;
    // The "Ready · N" banner is import-batch framing; staged review is already all
    // ready, so it just adds a count nobody needs. Keep the per-date headers only.
    if(!csvStagedMode) html += '<div class="group-h">'+L('Sẵn sàng','Ready')+' · '+readyCount+'</div>';
    keys.forEach(function(k){
      var label = k ? fmtDayMon(dateBuckets[k][0].c.date) : L('Không rõ ngày','No date');
      // id anchors the summary's tap-a-bar scroll (csvSumTap); k is the ISO date
      html += '<div class="group-h"'+(k?' id="csvday-'+k+'"':'')+' style="margin-top:10px">'+esc(label)+'</div><div class="csv-cards">';
      dateBuckets[k].forEach(function(e){
        var isRepeat = csvIsFlaggedDup(e.c);
        var o = { label:lowConfLabel[e.i] || (L('Khoản chi ','Item ')+(e.i+1)), dateIso:e.c.dateDisplay,
                  timeStr:csvRowTime(e.c),
                  attn:!!lowConfLabel[e.i], repeat:isRepeat,
                  tapFn:"csvToggleExpand('ready',"+e.i+")", removeFn:"csvReadyRemove("+e.i+")" };
        if(csvStagedMode){ o.checkFn = "csvStagedToggle("+e.i+")"; o.checked = !e.c._skipImport;
                           o.armed = (csvArmedRemove === e.i);
                           o.dim = pickOn && !csvPickMatch(e.c, pickWk); }
        /* Staged expanded card wears the settings-rows layout with its own CTA
           bar (delete / apply-to-similar / import-one) — the explicit Xong
           button belongs to the file workbench; here the header collapse and
           the accordion flush already close a card safely. */
        html += csvIsOpen('ready', e.i)
          ? csvActiveCard(e.c, Object.assign({}, o, csvStagedMode
              /* A flagged card opened is a person asking "same purchase or
                 not?" — the evidence (what matched, how much, when, whose
                 entry) belongs right there, not behind a chip. */
              ? { fields:true, ctaIdx:e.i, note:(isRepeat ? esc(csvDupWhy(e.c)) : null) }
              : { fields:true,
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
  csvSumAfterRender();   // re-pin the summary strip (zoom + scroll survive the innerHTML rebuild)
  var pick=document.getElementById('csv-pick'); if(pick) pick.style.display='none';

  csvPersistDraft();

  // Nav-bar Save, gated -- always reachable, grey until importable.
  var save = document.getElementById('csv-save');
  if(save){ save.disabled = (readyCount===0); save.textContent = readyCount>0 ? L('Nhập '+readyCount,'Import '+readyCount) : L('Nhập','Import'); }

  // The tools header lives OUTSIDE this scroller; sync it with every render so
  // its counts always agree with the ticks. Clears itself in the file flow.
  csvTxrHeadSync();

  // Same contract for the row-picker overlay: repaint from state every render,
  // clear itself whenever its card is gone.
  csvRowSheetSync();
  csvToolSheetSync();
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
  csvRowSheet = null; csvRowHot = null;   // a picker belongs to the card that opened it
  if(csvIsOpen(kind, idx)){ csvFlushExpand(); csvExpand = null; }
  else { csvFlushExpand(); csvExpand = { kind:kind, idx:idx }; }
  renderCsvReview();
}

function csvExpandDone(){ csvRowSheet = null; csvRowHot = null; csvFlushExpand(); csvExpand = null; renderCsvReview(); }

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
  /* A foreign-denominated row cannot be SELECTED until someone types its VND
     amount — selecting is asking to import, and there is no figure to import
     (foreign-currency-emails-spec.md, the FX gate). Deselecting stays free. */
  if(c._skipImport && csvFxUnresolved(c)){
    window.toast && toast(L('Nhập số tiền ₫ cho khoản ngoại tệ này trước nhé','Enter the ₫ amount for this foreign-currency item first'));
    csvFlushExpand(); csvExpand = { kind:'ready', idx:i }; csvRowHot = 'amount';
    renderCsvReview();
    return;
  }
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
  csvToolSheet = null; csvEditRow = null;
  csvPickF = { src:{}, dup:null, nocat:false, week:false };
}

function csvStagedSelectAll(on){
  if(!csvReview) return;
  csvDisarmRemove();
  csvFlushExpand(); csvExpand = null;   // an open editor's edits are kept, not dropped
  // Select-all never selects a foreign row with no VND amount — the FX gate.
  csvReview.ready.forEach(function(c){ c._skipImport = !on || csvFxUnresolved(c); });
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
  if(!csvReview) return false;
  var sel = csvStagedSelected(); if(!sel.length) return false;
  if(v==='personal' && !csvScopeReady()){
    toast(L('Mở khoá sổ cá nhân ở tab Cá nhân trước','Unlock your personal ledger first'));
    return false;
  }
  sel.forEach(function(c){ c._scope = v; });
  renderCsvReview();
  return true;
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

/* ---- The staged toolbox (#txh): two tools, one handoff --------------------

   Redesigned from the four-room header (mockups/bulk-select-tools.html, B).
   The old smart-set chips were radios: one claim owned the whole selection,
   so "from MB Bank AND not a duplicate" was unsayable, and the duplicate flag
   only ever filtered the view. Two named tools replace the rooms:

   ① Chọn nhanh — condition chips. OR inside a group (tick MB and VCB),
     AND between groups (Nguồn ∩ Không trùng). Three verbs act on the matched
     set: Chọn (replace the ticks), Chọn thêm (add), Bỏ chọn (remove) — chained
     verbs compose any combination without a query language. Conditions stay on
     after the sheet closes: the button wears their count and non-matching
     cards fade, so the cut stays visible in the list itself.

   ② Chỉnh sửa — acts on the ticked rows: category, destination, standing
     per-source routes, delete. Every action applies at once — the card marks,
     the ticks and the Nhập label are the receipt; a toast names what happened.
     The old basket-then-Xong step is gone: one tap staged, a second committed,
     and nobody could tell which state they were in.

   Both tools are sheets INSIDE the modal — the global .sheet layer (z 60)
   sits under modals (z 62), the same reason #csv-rowsheet lives here.
   csvTxrHeadSync keeps its name and call sites; it now paints two buttons. */
var CSV_TXR_I_SEL = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6h9M4 12h9M4 18h9"/><path d="m15.5 11.5 2.5 2.5 5-5.5"/></svg>';
var CSV_TXB_I_EDIT = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>';
var CSV_TXB_I_TAG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8Z"/><path d="M7.5 7.5h.01"/></svg>';
var CSV_TXB_I_BOOK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.5 5h13l3.5 7v5a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-5Z"/></svg>';
var CSV_TXB_I_BANK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9.5 12 4l9 5.5"/><path d="M5 10v7M9.7 10v7M14.3 10v7M19 10v7"/><path d="M3 20h18"/></svg>';
var CSV_TXB_I_TRASH = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M6.5 7l1 13h9l1-13"/></svg>';

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

/* The queue grouped by source bank — the unit ② routes and ① filters by. */
function csvTxrGroups(){
  var groups = {};
  ((csvReview && csvReview.ready) || []).forEach(function(c, i){
    var p = (typeof csvStagedProvider === 'function' && csvStagedProvider(c)) || L('Khác','Other');
    (groups[p] = groups[p] || { n:0, sum:0, idx:[] });
    groups[p].n++; groups[p].sum += csvBaseAmt(c.amount); groups[p].idx.push(i);
  });
  return groups;
}

/* ---- toolbox state ---- */
var csvToolSheet = null;   // null | 'pick' | 'edit'
var csvEditRow = null;     // ②'s open accordion row: null | 'cat' | 'scope' | 'src'
/* ①'s conditions. src is a set (OR between its keys); dup is three-valued
   (null = either, 'no' = only clean, 'yes' = only suspects); the rest are
   plain toggles. AND between the groups is just every check having to pass. */
var csvPickF = { src:{}, dup:null, nocat:false, week:false };

function csvPickCount(){
  return Object.keys(csvPickF.src).length + (csvPickF.dup ? 1 : 0)
    + (csvPickF.nocat ? 1 : 0) + (csvPickF.week ? 1 : 0);
}
/* "Tuần này" is anchored to the QUEUE's newest row, not the wall clock — a
   backfill reviewed on Monday is all last week, and a clock-anchored week
   would match nothing while looking broken. */
function csvPickWeekMax(){
  var maxT = 0;
  ((csvReview && csvReview.ready) || []).forEach(function(c){ if(c.date && +c.date > maxT) maxT = +c.date; });
  return maxT;
}
function csvPickMatch(c, weekMax){
  var srcs = Object.keys(csvPickF.src);
  if(srcs.length){
    var p = (typeof csvStagedProvider === 'function' && csvStagedProvider(c)) || L('Khác','Other');
    if(!csvPickF.src[p]) return false;
  }
  if(csvPickF.dup === 'no' && csvIsFlaggedDup(c)) return false;
  if(csvPickF.dup === 'yes' && !csvIsFlaggedDup(c)) return false;
  if(csvPickF.nocat && c.categoryName) return false;
  if(csvPickF.week && !(c.date && (weekMax - +c.date) < 7 * 864e5)) return false;
  return true;
}
function csvPickMatches(){
  var wk = csvPickWeekMax();
  return ((csvReview && csvReview.ready) || []).filter(function(c){ return csvPickMatch(c, wk); });
}

/* Condition toggles. Each one re-renders the whole review, so the sheet's
   live count, the button badge and the card fading move together. */
function csvPickSrcTgl(p){
  if(csvPickF.src[p]) delete csvPickF.src[p]; else csvPickF.src[p] = 1;
  renderCsvReview();
}
function csvPickDupTgl(v){ csvPickF.dup = (csvPickF.dup === v) ? null : v; renderCsvReview(); }
function csvPickNocatTgl(){ csvPickF.nocat = !csvPickF.nocat; renderCsvReview(); }
function csvPickWeekTgl(){ csvPickF.week = !csvPickF.week; renderCsvReview(); }
function csvPickClear(){ csvPickF = { src:{}, dup:null, nocat:false, week:false }; renderCsvReview(); }

/* The three verbs. 'set' replaces the ticks with the matched set, 'add' unions
   it in, 'sub' takes it out — run twice with different conditions they compose
   any AND/OR/NOT combination. The FX gate holds everywhere: an unresolved
   foreign row is never ticked by a verb, same as by hand (0112). */
function csvPickApply(mode){
  if(!csvReview) return;
  var wk = csvPickWeekMax();
  csvDisarmRemove(); csvFlushExpand(); csvExpand = null;
  (csvReview.ready || []).forEach(function(c){
    var m = csvPickMatch(c, wk);
    if(mode === 'set') c._skipImport = !m || csvFxUnresolved(c);
    else if(mode === 'add'){ if(m && !csvFxUnresolved(c)) c._skipImport = false; }
    else if(m) c._skipImport = true;
  });
  csvSelTouched = true;
  csvToolSheet = null;               // one gesture, one outcome: the verb closes the sheet
  renderCsvReview();
}

/* ---- opening and closing ---- */
function csvToolOpen(which){
  if(which === 'edit' && !csvStagedSelected().length){
    toast(L('Chưa chọn khoản nào. Chạm ô chọn trên thẻ trước nhé.','Nothing selected yet. Tap a checkbox on a card first.'));
    return;
  }
  csvDisarmRemove(); csvFlushExpand(); csvExpand = null; csvRowSheet = null;
  csvToolSheet = which; csvEditRow = null;
  renderCsvReview();
}
function csvToolClose(){ csvToolSheet = null; csvBulkArmed = false; renderCsvReview(); }

/* ---- the header: two named buttons ---- */
function csvTxrHeadSync(){
  var head = document.getElementById('txh'); if(!head) return;
  if(!csvStagedMode || !csvReview){ head.innerHTML = ''; csvToolSheet = null; return; }
  var n = csvStagedSelected().length, f = csvPickCount();
  head.innerHTML = '<div class="txb">'
    + '<button type="button" class="txb-b'+(f ? ' on' : '')+'" onclick="csvToolOpen(\'pick\')">'
      + '<span class="txb-ic">'+CSV_TXR_I_SEL+'</span>'+esc(L('Chọn nhanh','Quick select'))
      + (f ? '<span class="txb-n">'+f+'</span>' : '')+'</button>'
    + '<button type="button" class="txb-b" onclick="csvToolOpen(\'edit\')">'
      + '<span class="txb-ic">'+CSV_TXB_I_EDIT+'</span>'+esc(L('Chỉnh sửa','Edit'))
      + '<span class="txb-n">'+n+'</span></button>'
    + '</div>';
}

/* ---- sheet ①: Chọn nhanh ---- */
function csvPickChip(on, label, cnt, fn){
  return '<button type="button" class="ctp-chip'+(on ? ' on' : '')+'" onclick="'+fn+'">'
    + esc(label)+(cnt != null ? ' <span class="ctp-n">'+cnt+'</span>' : '')+'</button>';
}
function csvPickSheetHTML(){
  var ready = (csvReview && csvReview.ready) || [];
  var g = csvTxrGroups(), ps = Object.keys(g).sort();
  var dupN = ready.filter(csvIsFlaggedDup).length;
  var nocatN = ready.filter(function(c){ return !c.categoryName; }).length;
  var wk = csvPickWeekMax();
  var weekN = ready.filter(function(c){ return c.date && (wk - +c.date) < 7 * 864e5; }).length;
  var f = csvPickCount();
  var m = csvPickMatches(), sum = 0;
  m.forEach(function(c){ if(!csvFxUnresolved(c)) sum += csvBaseAmt(c.amount); });

  var h = '<div class="cts-h"><b>'+esc(L('Chọn nhanh','Quick select'))+'</b>'
    + (f ? '<button type="button" class="cts-link" onclick="csvPickClear()">'+esc(L('Xoá lọc','Clear filters'))+'</button>' : '')
    + '</div>';
  h += '<div class="ctp-g"><div class="ctp-l">'+esc(L('Nguồn','Source'))+'</div><div class="ctp-r">'
    + ps.map(function(p){ return csvPickChip(!!csvPickF.src[p], p, g[p].n, "csvPickSrcTgl('"+escAttr(p)+"')"); }).join('')
    + '</div></div>';
  if(dupN){
    h += '<div class="ctp-g"><div class="ctp-l">'+esc(L('Trùng lặp','Duplicates'))+'</div><div class="ctp-r">'
      + csvPickChip(csvPickF.dup === 'no', L('Không trùng','Not duplicates'), ready.length - dupN, "csvPickDupTgl('no')")
      + csvPickChip(csvPickF.dup === 'yes', L('Có thể trùng','Possible duplicates'), dupN, "csvPickDupTgl('yes')")
      + '</div></div>';
  }
  if(nocatN || weekN){
    h += '<div class="ctp-g"><div class="ctp-l">'+esc(L('Thêm nữa','More'))+'</div><div class="ctp-r">'
      + (nocatN ? csvPickChip(csvPickF.nocat, L('Chưa có danh mục','No category yet'), nocatN, 'csvPickNocatTgl()') : '')
      + (weekN ? csvPickChip(csvPickF.week, L('Tuần này','This week'), weekN, 'csvPickWeekTgl()') : '')
      + '</div></div>';
  }
  h += '<div class="ctp-m">'
    + (m.length
        ? '<b>'+esc(L('Khớp '+m.length+' khoản','Matches '+m.length))+'</b><span class="num">'+esc(fmt(sum))+'</span>'
        : '<b>'+esc(L('Không khoản nào khớp. Nới bớt điều kiện nhé.','Nothing matches. Loosen a condition.'))+'</b>')
    + '</div>';
  var dis = m.length ? '' : ' disabled';
  h += '<div class="cts-verbs">'
    + '<button type="button" class="cts-btn ter"'+dis+' onclick="csvPickApply(\'sub\')">'+esc(L('Bỏ chọn','Unselect'))+'</button>'
    + '<button type="button" class="cts-btn sec"'+dis+' onclick="csvPickApply(\'add\')">'+esc(L('Chọn thêm','Add'))+'</button>'
    + '<button type="button" class="cts-btn pri"'+dis+' onclick="csvPickApply(\'set\')">'+esc(L('Chọn '+m.length,'Select '+m.length))+'</button>'
    + '</div>';
  return h;
}

/* ---- sheet ②: Chỉnh sửa ---- */
function csvEditRowGo(k){ csvEditRow = (csvEditRow === k) ? null : k; csvBulkArmed = false; renderCsvReview(); }

function csvEditCat(name){
  csvToolSheet = null; csvEditRow = null;
  csvBulkCat(name);                  // stamps, learns, re-renders, says so
}
function csvEditScope(v){
  if(v === 'personal' && !csvScopeReady()){
    toast(L('Mở khoá sổ cá nhân ở tab Cá nhân trước','Unlock your personal ledger first'));
    return;
  }
  var n = csvStagedSelected().length; if(!n) return;
  csvToolSheet = null; csvEditRow = null;
  csvBulkScope(v);                   // stamps the selection only, re-renders
  toast(esc(v === 'personal'
    ? L(n + ' khoản sẽ vào sổ Cá nhân', n + ' will go to your personal book')
    : L(n + ' khoản sẽ vào sổ Gia đình', n + ' will go to the family book')));
}
/* A route is a standing rule: this bank's rows go to that book, now and every
   time after. Saved under the canonical bank name and applied to the bank's
   rows in the queue right away, exactly what the old Theo nguồn commit did. */
function csvEditRoute(p, v){
  if(v === 'personal' && !csvScopeReady()){
    toast(L('Mở khoá sổ cá nhân ở tab Cá nhân trước','Unlock your personal ledger first'));
    return;
  }
  if(csvTxrRoutes[p] === v) return;   // already routed there; nothing to say
  csvTxrRoutes[p] = v;
  csvTxrRouteSave();
  var g = csvTxrGroups();
  (g[p] ? g[p].idx : []).forEach(function(i){ var c = csvReview.ready[i]; if(c) c._scope = v; });
  renderCsvReview();
  toast(esc(v === 'personal'
    ? L(p + ' sẽ vào sổ Cá nhân, cả các lần sau', p + ' goes to your personal book from now on')
    : L(p + ' sẽ vào sổ Gia đình, cả các lần sau', p + ' goes to the family book from now on')));
}
function csvEditDel(){
  var armed = csvBulkArmed;
  if(armed) csvToolSheet = null;      // the confirm closes the sheet with the act
  csvBulkDelete();                    // arms on the first call, deletes on the second
}

function csvEditSheetHTML(){
  var sel = csvStagedSelected(), n = sel.length, sum = 0;
  sel.forEach(function(c){ sum += csvBaseAmt(c.amount); });

  /* Row values tell the truth about a mixed selection: a shared value is
     named, anything else reads "Chọn…" and the fold does the talking. */
  var cat0 = n ? (sel[0].categoryName || null) : null;
  var catAll = cat0 && sel.every(function(c){ return c.categoryName === cat0; });
  var catV = catAll ? ((window.catStyle && catStyle[cat0] ? catStyle[cat0][0] + ' ' : '') + cat0) : L('Chọn…','Pick…');
  var sc0 = n ? csvRowScope(sel[0]) : null;
  var scAll = sc0 && sel.every(function(c){ return csvRowScope(c) === sc0; });
  var scV = scAll ? csvTxrLbl(sc0) : L('Chọn…','Pick…');
  var routeN = Object.keys(csvTxrRoutes).length;

  var row = function(k, ic, label, value, danger){
    return '<button type="button" class="cte-row'+(danger ? ' dgr' : '')+(csvEditRow === k ? ' open' : '')+'"'
      + ' onclick="csvEditRowGo(\''+k+'\')">'
      + '<span class="cte-ic">'+ic+'</span><span class="cte-t">'+esc(label)+'</span>'
      + '<span class="cte-v">'+value+'<i>›</i></span></button>';
  };

  var h = '<div class="cts-h"><b>'+esc(L('Chỉnh sửa','Edit'))+'</b>'
    + '<span class="cts-sub">'+esc(L(n+' khoản đã chọn',n+' selected'))+' · <span class="num">'+esc(fmt(sum))+'</span></span></div>';

  h += row('cat', CSV_TXB_I_TAG, L('Danh mục','Category'), esc(catV));
  if(csvEditRow === 'cat'){
    h += '<div class="cte-fold"><div class="ctp-r">'
      + csvAllCats().map(function(name){
          var st = (window.catStyle && window.catStyle[name]) || ['🏷️'];
          return '<button type="button" class="ctp-chip'+(catAll && cat0 === name ? ' on' : '')+'"'
            + ' onclick="csvEditCat(\''+escAttr(name)+'\')">'+st[0]+' '+esc(name)+'</button>';
        }).join('')
      + '</div></div>';
  }
  h += row('scope', CSV_TXB_I_BOOK, L('Ghi vào','Goes to'), esc(scV));
  if(csvEditRow === 'scope'){
    h += '<div class="cte-fold">'
      + '<div class="cte-note">'+esc(L('Chỉ đổi '+n+' khoản đã chọn, không đổi mặc định.','Changes only the '+n+' selected, the default stays.'))+'</div>'
      + '<div class="ctp-r">'
      + '<button type="button" class="ctp-chip'+(scAll && sc0 === 'personal' ? ' on' : '')+'" onclick="csvEditScope(\'personal\')">'+csvTxrLbl('personal')+'</button>'
      + '<button type="button" class="ctp-chip'+(scAll && sc0 === 'family' ? ' on' : '')+'" onclick="csvEditScope(\'family\')">'+csvTxrLbl('family')+'</button>'
      + '</div></div>';
  }
  h += row('src', CSV_TXB_I_BANK, L('Theo nguồn','By source'),
    esc(routeN ? L(routeN+' tuyến',routeN+' route'+(routeN === 1 ? '' : 's')) : L('Chưa đặt','Not set')));
  if(csvEditRow === 'src'){
    var g = csvTxrGroups(), ps = Object.keys(g).sort();
    h += '<div class="cte-fold">'
      + '<div class="cte-note">'+esc(L('Đặt một lần, các lần sau tự vào đúng sổ.','Set once, later arrivals go to the right book on their own.'))+'</div>'
      + ps.map(function(p){
          var cur = csvTxrRoutes[p] || null;
          var seg = function(v){
            return '<button type="button" class="cte-seg'+(cur === v ? ' on' : '')+'"'
              + ' onclick="csvEditRoute(\''+escAttr(p)+'\',\''+v+'\')">'+csvTxrEmo(v)+'</button>';
          };
          return '<div class="cte-src"><b>'+esc(p)+'</b><span class="m">'+g[p].n+' · '+esc(fmt(g[p].sum))+'</span>'
            + '<span class="cte-segs">'+seg('personal')+seg('family')+'</span></div>';
        }).join('')
      + '</div>';
  }
  /* Delete has no fold: one tap arms it in place with the count spelled out,
     a second carries it out. Any other tap disarms (csvDisarmRemove). */
  h += csvBulkArmed
    ? '<div class="cte-delrow"><span class="cte-deltxt">'+esc(L('Chắc chưa? Không hoàn tác được.','Sure? This cannot be undone.'))+'</span>'
      + '<button type="button" class="cts-btn dgr" onclick="csvEditDel()">'+esc(L('Xoá '+n+' khoản?','Delete '+n+'?'))+'</button></div>'
    : '<button type="button" class="cte-row dgr" onclick="csvEditDel()">'
      + '<span class="cte-ic">'+CSV_TXB_I_TRASH+'</span><span class="cte-t">'+esc(L('Xoá khỏi hàng chờ','Remove from the queue'))+'</span>'
      + '<span class="cte-v">'+esc(L(n+' khoản',String(n)))+'<i>›</i></span></button>';
  return h;
}

/* Paint (or clear) whichever tool sheet is open. Runs on every review render,
   like #csv-rowsheet: counts stay live, and a sheet whose subject vanished
   (selection emptied, mode left) closes itself instead of going stale. */
function csvToolSheetSync(){
  var m = document.getElementById('csv-toolsheet'); if(!m) return;
  if(!csvToolSheet || !csvStagedMode || !csvReview){ if(m.innerHTML) m.innerHTML = ''; csvToolSheet = null; return; }
  if(csvToolSheet === 'edit' && !csvStagedSelected().length){ m.innerHTML = ''; csvToolSheet = null; return; }
  m.innerHTML = '<div class="cts-scrim" onclick="csvToolClose()"></div>'
    + '<div class="cts">'
    + (csvToolSheet === 'pick' ? csvPickSheetHTML() : csvEditSheetHTML())
    + '</div>';
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
  /* Ledger amounts are stored in base units (÷curMult); c.amount is raw đồng.
     Compare in đồng — comparing raw was the bug that kept this check silent. */
  var _cm = (typeof curMult === 'function' ? curMult() : 1) || 1;
  var crossMatch = !already && (window.txns||[]).find(function(t){
    if(!t._d || !c.date || t.amt == null) return false;
    return Math.abs(t._d.getTime()-c.date.getTime())/86400000 <= 3 && Math.abs(Number(t.amt)*_cm - c.amount) < 1;
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
