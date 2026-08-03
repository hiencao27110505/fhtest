/* ---- CSV import: technical preview -----------------------------------------
   Wires the already-tested parse → heuristics → Gemini-fallback pipeline
   (src/js-data/44-csv-parse.js, 45-csv-import.js) into a real screen for the
   first time. Deliberately NOT the full review UI (merchant grouping,
   defer-to-queue, category assignment, promotion into `transactions`) — this
   proves the pipeline end-to-end from a real tap and shows what it resolved,
   nothing more. Says so on screen so it never reads as a finished import. */
function openCsvImport(){
  var input=document.getElementById('csv-file-input'); if(input) input.value='';
  var out=document.getElementById('csv-result'); if(out) out.innerHTML='';
  openSheet('csv-import-modal');
}

function csvFieldLabel(field){
  var map={
    occurred_at:L('Ngày','Date'), amount:L('Số tiền','Amount'), description:L('Nội dung','Description'),
    category:L('Danh mục','Category'), counterparty:L('Đối tác','Counterparty'), currency:L('Tiền tệ','Currency'),
    paid_by:L('Người trả','Paid by'), split_with:L('Chia với','Split with'), unmapped:L('Không xác định','Unmapped'),
  };
  return map[field]||field;
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
      renderCsvResult(parsed, result);
    }).catch(function(e){
      if(out) out.innerHTML='<div class="sheet-sub">'+L('Có lỗi khi phân tích file: ','Something went wrong analyzing this file: ')+esc(String((e&&e.message)||e))+'</div>';
    });
  };
  reader.onerror=function(){
    if(out) out.innerHTML='<div class="sheet-sub">'+L('Không đọc được file này.','Could not read this file.')+'</div>';
  };
  reader.readAsText(file,'utf-8');
}

function renderCsvResult(parsed, result){
  var out=document.getElementById('csv-result'); if(!out) return;
  var byLine = result.resolvedBy==='gemini'
    ? L('Nhận diện bằng: Gemini (luật có sẵn không đủ tự tin)','Resolved by: Gemini (heuristics weren’t confident enough)')
    : L('Nhận diện bằng: luật có sẵn, không cần gọi mô hình','Resolved by: heuristics alone, no model call needed');

  var mapping = (result.llm && result.llm.column_mapping) || Object.keys(result.columnMap).map(function(i){
    return { column_index:+i, field:result.columnMap[i].field, confidence:result.columnMap[i].confidence };
  });

  var rows = mapping.map(function(m){
    var header = parsed.headers[m.column_index]||'';
    return '<div class="row"><div class="r-body"><div class="r-t">'+esc(header)+'</div><div class="r-s">'+esc(csvFieldLabel(m.field))+' · '+esc(m.confidence)+'</div></div></div>';
  }).join('');

  var dateNote = (result.llm && result.llm.date_convention)
    ? '<div class="sheet-sub">'+L('Định dạng ngày: ','Date convention: ')+esc(result.llm.date_convention)+'</div>' : '';

  out.innerHTML =
      '<div class="sheet-sub">'+esc(L(parsed.rows.length+' dòng dữ liệu tìm thấy', parsed.rows.length+' data rows found'))+'</div>'
    + '<div class="sheet-sub">'+byLine+'</div>'
    + dateNote
    + '<div class="card" style="margin:14px 0 0">'+rows+'</div>'
    + '<div class="sheet-sub" style="margin-top:14px">'+L('Đây là bản xem trước kỹ thuật — màn hình xem lại đầy đủ và ghi vào sổ chi tiêu chưa được xây dựng.','This is a technical preview — the full review screen and ledger write-through aren’t built yet.')+'</div>';
}
