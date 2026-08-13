  /* ═══ Money-encryption lifecycle (0030) ═════════════════════════════════════
     Staged, reversible rollout — nothing destructive ever happens as a side
     effect:
       off  → [export JSON] → [encrypt alongside, verify-before-upload] → dual
       dual → run for as long as you like (reads self-check ct==pt loudly)
       dual → scrub (owner, arm-confirm, THE one destructive step) → enc
       enc  → decrypt-back (restore plaintext from ciphertext) → dual → off
     Bank-import / legacy rows without ciphertext are never scrubbed and stay
     readable in every state. */

  // one logical money field-set per table; the job covers ARCHIVED rows too —
  // scrub only nulls rows that HAVE ciphertext, so anything missed would keep
  // plaintext forever.
  const _ENC_TABLES = [
    { t: 'transactions',    num: ['amount'],        str: ['note'] },
    { t: 'incomes',         num: ['amount'],        str: ['note'] },
    { t: 'savings_entries', num: ['amount'],        str: ['note'] },
    { t: 'event_fundings',  num: ['amount'],        str: [] },
    { t: 'category_budgets',num: ['amount'],        str: [] },
    { t: 'monthly_budgets', num: ['budget_total'],  str: [] },
    { t: 'events',          num: ['target_amount'], str: ['name'] },
    { t: 'saving_goals',    num: ['target_amount'], str: ['name', 'note'] },
    // 0038: user-typed text joins the same lifecycle (enable covers, verify
    // compares, scrub retires the plaintext)
    { t: 'categories',      num: [],                str: ['name'] },
    { t: 'members',         num: [],                str: ['name'] },
    { t: 'event_memories',  num: [],                str: ['caption'] }
  ];
  const _encCols = (spec) => ['id'].concat(spec.num, spec.str, spec.num.map((f) => f + '_enc'), spec.str.map((f) => f + '_enc')).join(',');
  let _fhEncBusy = false;

  function _fhEncProg(msg) {
    const el = document.getElementById('fh-enc-prog');
    if (el) el.textContent = msg;
  }

  /* Who has entered the code on at least one device (members.key_unlocked_at,
     stamped by mark_key_unlocked). Informational: it tells the owner when the
     scrub is comfortable — a member who never unlocked keeps writing plaintext
     rows during dual, which the "re-encrypt missed rows" pass then covers. */
  function _fhUnlockRoster() {
    const mem = Object.values((window.DB && window.DB.memberById) || {})
      .filter((m) => m && m.user_id && !m.is_shared);
    if (!mem.length) return { html: '', pending: [] };
    const pending = mem.filter((m) => !m.key_unlocked_at).map((m) => m.name);
    const rows = mem.map((m) =>
      '<div class="fh-s-row"><div class="fh-s-grow"><div class="fh-s-name">' + _esc(m.name) + '</div></div>'
      + '<span class="fh-s-meta">' + (m.key_unlocked_at ? L('đã nhập mã ✓', 'entered the code ✓') : L('chưa nhập mã', 'not yet')) + '</span></div>').join('');
    return { html: '<div class="fh-s-lab" style="margin-top:18px">' + L('Thành viên đã nhập mã', 'Members with the code') + '</div>' + rows, pending: pending };
  }

  window.fhEncryptionSheet = async function () {
    const fid = window.DB.fid;
    if (!fid) { window.toast && window.toast(L('Hãy mở một gia đình trước', 'Open a family first')); return; }
    let owner = false;
    try { const r = await sb.from('families').select('owner_id').eq('id', fid).maybeSingle(); owner = !!(r.data && window.fhUser && r.data.owner_id === window.fhUser.id); } catch (e) {}
    const enc = window.DB.enc, st = fhEncState();
    const intro = '<div class="fh-s-h">' + L('Mã hóa tài chính', 'Money encryption') + '</div>'
      + '<div class="fh-s-sub">' + L('Số tiền, ghi chú và tên mục tiêu được mã hóa ngay trên máy bằng mã gia đình. Máy chủ chỉ lưu bản đã khóa, kể cả chúng tôi cũng không đọc được.',
                                      'Amounts, notes and goal names are encrypted on your device with the family code. The server only ever stores locked values, and even we can’t read them.') + '</div>';
    let body = '';
    if (!enc) {
      body = '<div class="fh-s-sub">' + L('Bước đầu tiên là đặt mã gia đình 6 số.', 'First, set the family’s 6-digit passcode.') + '</div>'
        + (owner ? _btn(L('Đặt mã gia đình', 'Set the passcode'), '_closeOv();fhSetPasscode()', _S.cta)
                 : '<div class="fh-s-sub">' + L('Chỉ chủ gia đình đặt được mã.', 'Only the owner can set it.') + '</div>');
    } else if (st === 'off') {
      body = '<div class="fh-s-lab">' + L('Trạng thái: chưa bật', 'Status: off') + '</div>'
        + '<div class="fh-s-sub">' + L('Khi bật, app tải một bản sao Excel về máy, mã hóa toàn bộ dữ liệu tiền cạnh bản gốc, rồi vào giai đoạn kiểm chứng. Mọi số vẫn hiển thị như cũ, chưa có gì bị xóa.',
                                        'Turning it on downloads an Excel copy to this device, encrypts all money data alongside the originals, then enters a verification window. Everything still shows as before and nothing is deleted.') + '</div>'
        + (owner ? _btn(L('Bật mã hóa', 'Turn on encryption'), 'fhEncEnable(this)', _S.cta)
                 : '<div class="fh-s-sub">' + L('Chỉ chủ gia đình bật được.', 'Only the owner can turn this on.') + '</div>');
    } else if (st === 'dual') {
      const roster = _fhUnlockRoster();
      const pendWarn = roster.pending.length
        ? '<div class="fh-s-sub">' + L('Chưa nhập mã: ' + roster.pending.join(', ') + '. Máy của họ sẽ hỏi mã khi mở app, và không ghi chép tiền được cho tới khi nhập. Bạn có thể hoàn tất bất cứ lúc nào. Sau đó họ chỉ cần nhập mã là xem được như thường.',
                                        'Not yet entered: ' + roster.pending.join(', ') + '. Their devices ask for the code on open and can’t log money until it’s entered. You can finish anytime. Afterwards they just enter the code to read as usual.') + '</div>'
        : '';
      body = '<div class="fh-s-lab">' + L('Trạng thái: giai đoạn kiểm chứng', 'Status: verification window') + '</div>'
        + '<div class="fh-s-sub">' + L('Bản mã và bản gốc đang tồn tại song song; app tự đối chiếu mỗi lần đọc, và máy chủ đã chặn mọi cách ghi không mã hóa. Khi yên tâm, bấm hoàn tất để xóa bản gốc trên máy chủ. Sau bước này không còn đường quay lại bản không mã hóa, với bất kỳ ai.',
                                        'Ciphertext and originals coexist; the app cross-checks them on every read, and the server already refuses any unencrypted write. When confident, finish to erase the plaintext on the server. After that there is no way back to unencrypted data, for anyone.') + '</div>'
        + roster.html + pendWarn
        + _btn(L('Đối chiếu giải mã toàn bộ', 'Verify all decryption'), 'fhEncVerifyAll(this)', _S.line)
        + (owner ? _btn(L('Hoàn tất và xóa bản gốc trên máy chủ', 'Finish and erase server plaintext'), 'fhEncScrub(this)', _S.del)
                 + _btn(L('Tắt mã hóa', 'Turn encryption off'), 'fhEncDisable(this)', _S.ghost)
                 : '<div class="fh-s-sub">' + L('Chủ gia đình sẽ hoàn tất bước này.', 'The owner finishes this step.') + '</div>');
      /* interrupted enable? cover the backlog silently — no button, no step */
      if (owner && fhKeyReady() && !_fhEncBusy) {
        _fhUncoveredCount().then((n) => {
          if (n > 0) { _fhEncProg(L('Đang mã hóa nốt ' + n + ' dòng…', 'Covering ' + n + ' remaining rows…')); window.fhEncEnable(null, { resume: true }); }
        }).catch(() => {});
      }
    } else {
      const roster = _fhUnlockRoster();
      body = '<div class="fh-s-lab">' + L('Trạng thái: đang mã hóa đầu-cuối', 'Status: end-to-end encrypted') + '</div>'
        + '<div class="fh-s-sub">' + L('Máy chủ chỉ còn bản đã khóa, gồm cả tên, chú thích và ảnh của gia đình. Dữ liệu chỉ mở được bằng mã gia đình trên máy của thành viên. Quyết định này là vĩnh viễn, không ai đưa được bản không mã hóa trở lại máy chủ, kể cả gia đình bạn.',
                                        'The server holds only locked values, including names, captions and the family’s photos. Data opens only with the family code, on members’ devices. This is permanent. No one can put unencrypted data back on the server, not even your family.') + '</div>'
        + roster.html
        + (fhKeyReady() ? '' : _btn(L('Mở khóa máy này', 'Unlock this device'), '_closeOv();fhUnlockPrompt()', _S.cta));
      /* Key Card (0042): once unlocked, offer the card. No card yet → the owner
         upgrades (adds a card wrap beside the passcode, both keep working — no
         lockout, nothing re-encrypts). Card exists → view/regenerate it. */
      if (fhKeyReady() && window.fhHasCard) {
        if (window.fhHasCard()) {
          body += _btn(L('Xem hoặc tạo lại mã khóa', 'View or remake the code'), '_closeOv();fhCardShowCached()', _S.line);
          // Phase D: once on the card, the owner can retire the old 6-digit code.
          // Shown only while a passcode still exists (enc.wrapped_dek non-null).
          if (owner && enc && enc.wrapped_dek) body += _btn(L('Gỡ mã 6 số cũ', 'Remove the old 6-digit code'), 'fhDropPasscode(this)', _S.del);
        } else {
          body += (owner ? _btn(L('Nâng cấp lên mã khóa của nhà', 'Upgrade to a family code'), 'fhCardMigrate(this)', _S.cta)
                         : '<div class="fh-s-sub">' + L('Chủ gia đình sẽ tạo mã khóa cho nhà.', 'The owner will create the family code.') + '</div>');
        }
      }
      /* anything the valve tolerated (server-side inserts, pre-0038 rows) plus
         any not-yet-encrypted photos: cover silently, same shape as the dual
         resume hook above */
      if (fhKeyReady()) setTimeout(() => { window.fhEncCoverSweep && window.fhEncCoverSweep(); }, 400);
    }
    body += '<div class="fh-s-sub" id="fh-enc-prog" style="min-height:18px"></div>';
    /* Excel-copy CTA temporarily hidden by product decision (2026-08-03) — the
       entry point will live somewhere better later. fhEncExport() and the
       whole _fhXlsx writer stay wired; re-exposing is one _btn() line. The
       automatic safety download inside the enable flow still runs. */
    // if (enc) body += _btn(L('Tải bản sao Excel', 'Download an Excel copy'), 'fhEncExport(this)', _S.ghost);
    body += _btn(L('Xong', 'Done'), '_closeOv()', _S.ghost);
    _fhSheet(intro + body);
  };

  /* Readable family copy → a real .xlsx with one tab per section (Sổ ghi chép ·
     Mục tiêu · Ngân sách), so people scan it the way they scan any spreadsheet.
     xlsx is just a ZIP of small XML files; a STORED (uncompressed) zip plus
     inline-string worksheets is ~150 lines and keeps the app dependency-free.
     Numbers are real number cells (Excel can sum them), text is inline UTF-8
     (diacritics safe), amounts in full currency units (the app stores VND/1000).
     Decrypts on-device via fhRead, so it works in every enc state. */
  const _xmlEsc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const _CRC_T = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1); t[n] = c >>> 0; } return t; })();
  function _crc32(u8) { let c = 0xFFFFFFFF; for (let i = 0; i < u8.length; i++) c = _CRC_T[(c ^ u8[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
  // STORED zip: local headers + central directory + EOCD, no compression
  function _zipStore(files) {
    const enc = new TextEncoder(); const chunks = []; const central = []; let off = 0;
    const le = (n, bytes) => { const a = []; for (let i = 0; i < bytes; i++) a.push((n >>> (8 * i)) & 0xFF); return a; };
    for (const f of files) {
      const name = enc.encode(f.name), data = f.u8, crc = _crc32(data);
      const head = new Uint8Array([0x50, 0x4B, 0x03, 0x04, ...le(20, 2), ...le(0x0800, 2), ...le(0, 2), ...le(0, 2), ...le(0x21, 2),
        ...le(crc, 4), ...le(data.length, 4), ...le(data.length, 4), ...le(name.length, 2), ...le(0, 2)]);
      chunks.push(head, name, data);
      central.push({ name, crc, size: data.length, off });
      off += head.length + name.length + data.length;
    }
    let cdLen = 0; const cdStart = off;
    for (const c of central) {
      const rec = new Uint8Array([0x50, 0x4B, 0x01, 0x02, ...le(20, 2), ...le(20, 2), ...le(0x0800, 2), ...le(0, 2), ...le(0, 2), ...le(0x21, 2),
        ...le(c.crc, 4), ...le(c.size, 4), ...le(c.size, 4), ...le(c.name.length, 2), ...le(0, 2), ...le(0, 2), ...le(0, 2), ...le(0, 2),
        ...le(0, 4), ...le(c.off, 4)]);
      chunks.push(rec, c.name); cdLen += rec.length + c.name.length;
    }
    chunks.push(new Uint8Array([0x50, 0x4B, 0x05, 0x06, ...le(0, 2), ...le(0, 2), ...le(central.length, 2), ...le(central.length, 2), ...le(cdLen, 4), ...le(cdStart, 4), ...le(0, 2)]));
    return new Blob(chunks, { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  }
  const _colRef = (i) => { let s = ''; i++; while (i) { s = String.fromCharCode(65 + ((i - 1) % 26)) + s; i = Math.floor((i - 1) / 26); } return s; };
  function _sheetXml(rows, widths) {
    let cols = '';
    if (widths && widths.length) cols = '<cols>' + widths.map((w, i) => '<col min="' + (i + 1) + '" max="' + (i + 1) + '" width="' + w + '" customWidth="1"/>').join('') + '</cols>';
    const body = rows.map((row, r) =>
      '<row r="' + (r + 1) + '">' + row.map((v, c) => {
        const ref = _colRef(c) + (r + 1);
        if (typeof v === 'number' && isFinite(v)) return '<c r="' + ref + '"><v>' + v + '</v></c>';
        if (v == null || v === '') return '';
        return '<c r="' + ref + '" t="inlineStr"><is><t xml:space="preserve">' + _xmlEsc(v) + '</t></is></c>';
      }).join('') + '</row>').join('');
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
      + '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' + cols + '<sheetData>' + body + '</sheetData></worksheet>';
  }
  // sheets: [{name, rows, widths}] → downloadable .xlsx Blob
  function _fhXlsx(sheets) {
    const enc = new TextEncoder();
    const files = [];
    files.push({ name: '[Content_Types].xml', u8: enc.encode('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
      + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
      + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
      + '<Default Extension="xml" ContentType="application/xml"/>'
      + '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
      + sheets.map((s, i) => '<Override PartName="/xl/worksheets/sheet' + (i + 1) + '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>').join('')
      + '</Types>') });
    files.push({ name: '_rels/.rels', u8: enc.encode('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
      + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
      + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>') });
    files.push({ name: 'xl/workbook.xml', u8: enc.encode('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
      + '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>'
      + sheets.map((s, i) => '<sheet name="' + _xmlEsc(s.name) + '" sheetId="' + (i + 1) + '" r:id="rId' + (i + 1) + '"/>').join('')
      + '</sheets></workbook>') });
    files.push({ name: 'xl/_rels/workbook.xml.rels', u8: enc.encode('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
      + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
      + sheets.map((s, i) => '<Relationship Id="rId' + (i + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet' + (i + 1) + '.xml"/>').join('')
      + '</Relationships>') });
    sheets.forEach((s, i) => files.push({ name: 'xl/worksheets/sheet' + (i + 1) + '.xml', u8: enc.encode(_sheetXml(s.rows, s.widths)) }));
    return _zipStore(files);
  }
  async function _fhExportPlain() {
    const fid = window.DB.fid;
    const mult = (window.CUR === 'VND') ? 1000 : 1;
    const sym = window.curSym ? window.curSym() : '₫';
    const money = (v) => (v == null || v === '' ? '' : Math.round(Number(v) * mult));
    const catName = (id) => { const c = window.DB.catById && window.DB.catById[id]; return c ? c.name : ''; };
    const memName = (id) => { const m = window.DB.memberById && window.DB.memberById[id]; return m ? (m.is_shared ? L('Chung', 'Shared') : m.name) : ''; };
    const R = await Promise.all([
      sb.from('transactions').select('amount,amount_enc,note,note_enc,txn_date,category_id,member_id').eq('family_id', fid),
      sb.from('incomes').select('amount,amount_enc,note,note_enc,income_date,member_id').eq('family_id', fid),
      sb.from('savings_entries').select('amount,amount_enc,note,note_enc,kind,entry_date,member_id').eq('family_id', fid),
      sb.from('event_fundings').select('amount,amount_enc,created_at,event_id,goal_id,member_id').eq('family_id', fid),
      sb.from('saving_goals').select('name,name_enc,target_amount,target_amount_enc,note,note_enc,achieved').eq('family_id', fid).is('archived_at', null),
      sb.from('events').select('name,name_enc,target_amount,target_amount_enc,target_date').eq('family_id', fid).is('archived_at', null).not('target_amount_enc', 'is', null),
      sb.from('monthly_budgets').select('month,budget_total,budget_total_enc').eq('family_id', fid),
      sb.from('category_budgets').select('month,amount,amount_enc,category_id').eq('family_id', fid)
    ]);
    for (const r of R) if (r.error) throw r.error;
    const [tx, inc, se, ef, sg, ev, mb, cb] = R.map((r) => r.data || []);

    const ledger = [];
    for (const t of tx) ledger.push([t.txn_date, L('Chi tiêu', 'Expense'), money(await fhRead(t, 'amount')), await fhRead(t, 'note') || '', catName(t.category_id), memName(t.member_id)]);
    for (const t of inc) ledger.push([t.income_date, L('Thu nhập', 'Income'), money(await fhRead(t, 'amount')), await fhRead(t, 'note') || '', '', memName(t.member_id)]);
    for (const t of se) ledger.push([t.entry_date, t.kind === 'deposit' ? L('Bỏ ống tiết kiệm', 'Into savings') : L('Rút tiết kiệm', 'Out of savings'), money(await fhRead(t, 'amount')), await fhRead(t, 'note') || '', '', memName(t.member_id)]);
    for (const t of ef) {
      const g = (t.goal_id && window.DB.goalById && window.DB.goalById[t.goal_id]) || (t.event_id && window.DB.eventById && window.DB.eventById[t.event_id]) || null;
      ledger.push([String(t.created_at || '').slice(0, 10), L('Góp mục tiêu', 'Toward a goal'), money(await fhRead(t, 'amount')), (g && g.name) || '', '', memName(t.member_id)]);
    }
    ledger.sort((a, b) => (a[0] < b[0] ? 1 : -1));
    const ledgerRows = [[L('Ngày', 'Date'), L('Loại', 'Type'), L('Số tiền', 'Amount') + ' (' + sym + ')', L('Ghi chú', 'Note'), L('Danh mục', 'Category'), L('Thành viên', 'Member')]].concat(ledger);

    const goalRows = [[L('Tên', 'Name'), L('Mục tiêu', 'Target') + ' (' + sym + ')', L('Ghi chú', 'Note')]];
    for (const g of sg) goalRows.push([await fhRead(g, 'name') || '', money(await fhRead(g, 'target_amount')), await fhRead(g, 'note') || '']);
    for (const e of ev) goalRows.push([await fhRead(e, 'name') || '', money(await fhRead(e, 'target_amount')), e.target_date || '']);

    const budgetRows = [[L('Tháng', 'Month'), L('Danh mục', 'Category'), L('Ngân sách', 'Budget') + ' (' + sym + ')']];
    for (const m of mb) { const v = await fhRead(m, 'budget_total'); if (Number(v)) budgetRows.push([String(m.month).slice(0, 7), L('Tổng', 'Total'), money(v)]); }
    for (const c of cb) budgetRows.push([String(c.month).slice(0, 7), catName(c.category_id), money(await fhRead(c, 'amount'))]);

    const blob = _fhXlsx([
      { name: L('Sổ ghi chép', 'Ledger'), rows: ledgerRows, widths: [12, 16, 14, 42, 16, 14] },
      { name: L('Mục tiêu', 'Goals'), rows: goalRows, widths: [42, 14, 24] },
      { name: L('Ngân sách', 'Budgets'), rows: budgetRows, widths: [10, 18, 14] }
    ]);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'Earthy-' + new Date().toISOString().slice(0, 10) + '.xlsx';
    document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 4000);
  }
  window.fhEncExport = async function (btn) {
    if (btn) btn.disabled = true;
    try { await _fhExportPlain(); window.toast && window.toast(L('Đã tải bản sao về máy, mở được bằng Excel', 'Copy downloaded, opens in Excel')); }
    catch (e) { window.toast && window.toast(_friendly(e)); }
    if (btn) btn.disabled = false;
  };

  /* How many logical fields still lack ciphertext (drives auto-resume; with
     the 0033 triggers, new uncovered rows can no longer be created, so this
     can only be a backlog from an interrupted enable). */
  async function _fhUncoveredCount() {
    let n = 0;
    for (const spec of _ENC_TABLES) {
      const r = await sb.from(spec.t).select(_encCols(spec)).eq('family_id', window.DB.fid);
      for (const row of ((r && r.data) || [])) {
        for (const f of spec.num.concat(spec.str)) {
          let v = row[f];
          if (spec.t === 'monthly_budgets' && f === 'budget_total' && Number(v) === 0) v = null;
          if (v !== null && v !== undefined && v !== '' && row[f + '_enc'] == null) { n++; break; }
        }
      }
    }
    return n;
  }

  /* off→dual, and the auto-resume worker for an interrupted enable. The state
     flips to 'dual' FIRST: from that moment the database itself (0033) rejects
     plaintext-only money writes, so no new uncovered rows can appear while —
     or after — the backlog below is covered. Then the JSON copy downloads and
     every row still lacking ciphertext is covered, verify-before-upload.
     Plaintext is NOT touched here. opts.resume skips the export re-download. */
  window.fhEncEnable = async function (btn, opts) {
    opts = opts || {};
    if (_fhEncBusy) return;
    if (!fhKeyReady()) { window.fhLockWall ? window.fhLockWall({ force: true }) : window.fhUnlockPrompt(); return; }   // force: reach the passcode input even in 'off' state
    _fhEncBusy = true;
    if (btn) btn.disabled = true;
    try {
      if (fhEncState() === 'off') {
        await _rpc('set_family_enc_state', { p_state: 'dual' });
        if (window.DB.enc) window.DB.enc.enc_state = 'dual';   // this device writes both from right now
      }
      if (!opts.resume) {
        _fhEncProg(L('Đang tải bản sao…', 'Downloading the copy…'));
        try { await _fhExportPlain(); } catch (e) { console.warn('export failed', e); }   // job continues; DB backup still exists
      }
      let total = 0, mismatches = 0;
      for (const spec of _ENC_TABLES) {
        _fhEncProg(L('Đang mã hóa: ', 'Encrypting: ') + spec.t + '…');
        const r = await sb.from(spec.t).select(_encCols(spec)).eq('family_id', window.DB.fid);
        if (r.error) throw r.error;
        for (const row of (r.data || [])) {
          const patch = {};
          for (const f of spec.num.concat(spec.str)) {
            const v = row[f];
            if (v === null || v === undefined || v === '') continue;    // nothing to protect
            if (row[f + '_enc'] != null) continue;                       // already covered
            const ct = await FHCrypto.encVal(_fhSessionDek(), v);
            const back = await FHCrypto.decVal(_fhSessionDek(), ct);
            const same = back === String(v) || Number(back) === Number(v);
            if (!same) { mismatches++; console.error('FH ENC VERIFY FAIL', spec.t, row.id, f); continue; }
            patch[f + '_enc'] = ct;
          }
          if (Object.keys(patch).length) {
            window.DB._lastLocalWrite = Date.now();                      // keep realtime echo suppression on
            await _w(sb.from(spec.t).update(patch).eq('id', row.id), 'encrypt ' + spec.t);
            total++;
          }
        }
      }
      if (mismatches) { const _e = new Error('verify'); _e.fhMsg = L('Có ' + mismatches + ' dòng không kiểm chứng được.', mismatches + ' rows failed verification.'); throw _e; }
      _fhEncProg('');
      if (!opts.resume || total) window.toast && window.toast(L('Đã mã hóa ' + total + ' dòng ✓', total + ' rows encrypted ✓'));
      await window.loadFamilyData();
      window.fhEncryptionSheet();
    } catch (e) {
      _fhEncProg('');
      window.toast && window.toast(_friendly(e));
      if (btn) btn.disabled = false;
    } finally { _fhEncBusy = false; }
  };

  /* One-tap proof before the scrub: decrypt EVERY ciphertext in the family and
     compare it to the plaintext still sitting beside it. Only 'dual' offers
     this ground truth, which is exactly why the check lives here. Any device
     holding the key can run it; a mismatch names itself in the console. */
  window.fhEncVerifyAll = async function (btn) {
    if (_fhEncBusy) return;
    if (!fhKeyReady()) { window.fhLockWall ? window.fhLockWall({ force: true }) : window.fhUnlockPrompt(); return; }   // force: reach the passcode input even in 'off' state
    _fhEncBusy = true;
    if (btn) btn.disabled = true;
    let ok = 0, bad = 0;
    try {
      for (const spec of _ENC_TABLES) {
        _fhEncProg(L('Đang đối chiếu: ', 'Checking: ') + spec.t + '…');
        const r = await sb.from(spec.t).select(_encCols(spec)).eq('family_id', window.DB.fid);
        if (r.error) throw r.error;
        for (const row of (r.data || [])) {
          for (const f of spec.num.concat(spec.str)) {
            const ct = row[f + '_enc'];
            let pt = row[f];
            if (spec.t === 'monthly_budgets' && f === 'budget_total' && Number(pt) === 0) pt = null;
            if (ct == null || pt == null) continue;            // no pair, nothing to compare
            const dec = await FHCrypto.decVal(_fhSessionDek(), ct).catch(() => null);
            const same = spec.num.indexOf(f) >= 0 ? Number(dec) === Number(pt) : String(dec) === String(pt);
            if (same) ok++;
            else { bad++; console.error('FH VERIFY MISMATCH', spec.t, row.id, f, { plaintext: pt, decrypted: dec }); }
          }
        }
      }
      _fhEncProg('');
      if (bad) window.toast && window.toast(L('Có ' + bad + ' giá trị không khớp. Đừng hoàn tất vội, xem console giúp mình nhé.', bad + ' values don’t match. Don’t finish yet, check the console.'));
      else window.toast && window.toast(L('Đã đối chiếu ' + ok + ' giá trị, khớp toàn bộ. An toàn để hoàn tất.', ok + ' values checked, everything matches. Safe to finish.'));
    } catch (e) { _fhEncProg(''); window.toast && window.toast(_friendly(e)); }
    finally { _fhEncBusy = false; if (btn) btn.disabled = false; }
  };

  // dual→enc: THE destructive step. Arm-then-confirm, server double-checks owner+state.
  window.fhEncScrub = async function (btn) {
    if (btn && !btn.classList.contains('armed')) {
      btn.classList.add('armed'); btn.textContent = L('Chạm lần nữa, bản gốc trên máy chủ sẽ bị xóa vĩnh viễn', 'Tap again and the server plaintext is erased for good');
      clearTimeout(window._fhScrubT);
      window._fhScrubT = setTimeout(() => {
        if (!btn.isConnected) return;
        btn.classList.remove('armed'); btn.textContent = L('Hoàn tất và xóa bản gốc trên máy chủ', 'Finish and erase server plaintext');
      }, 4000);
      return;
    }
    clearTimeout(window._fhScrubT);
    if (btn) { btn.disabled = true; btn.textContent = L('Đang xóa bản gốc…', 'Erasing plaintext…'); }
    let counts;
    try { counts = await _rpc('scrub_plaintext_amounts'); }
    catch (e) {
      const raw = String((e && e.message) || '');
      const m = raw.match(/uncovered_rows:(\d+)/);
      if (m) {
        // server refused: a backlog exists (interrupted enable) — cover it now
        window.toast && window.toast(L('Còn ' + m[1] + ' dòng chưa mã hóa, app đang tự xử lý, bạn thử lại sau giây lát nhé', m[1] + ' rows aren’t covered yet. Encrypting them now, try again in a moment'));
        window.fhEncEnable(null, { resume: true });
      } else window.toast && window.toast(_friendly(e));
      if (btn) { btn.disabled = false; btn.classList.remove('armed'); }
      return;
    }
    const n = Object.values(counts || {}).reduce((s, x) => s + (Number(x) || 0), 0);
    window.toast && window.toast(L('Xong, đã xóa bản gốc của ' + n + ' dòng, giờ chỉ còn bản mã hóa', 'Done. Plaintext erased on ' + n + ' rows, only ciphertext remains'));
    await window.loadFamilyData();
    window.fhEncryptionSheet();
  };

  /* ═══ Coverage sweep for COMMITTED families ('enc') ═════════════════════════
     Enc-from-birth families (0032) and server-side flows (redeem_invite,
     create_family seeding) leave plaintext names/captions the 0038 valve
     tolerates; and a family that just finished the scrub still has its whole
     photo history as plaintext objects. This sweep — silent, idempotent,
     resumable — retires both:
       text:   pt without ct → write ct; committed → also null the pt
       photos: plaintext bucket object → fetch → AES-GCM → upload '<path>.enc'
               → repoint the row → delete the plaintext object
     Runs from the encryption sheet, after an unlock, and once per session
     after hydrate. Order inside a photo is safe against interruption: the old
     object is deleted only after its row points at the encrypted one. */
  const _TXT_COVER = [
    { t: 'categories',     f: 'name' },
    { t: 'members',        f: 'name' },
    { t: 'event_memories', f: 'caption' }
  ];
  let _fhCovBusy = false;
  window.fhEncCoverSweep = async function () {
    if (_fhCovBusy || !window.DB || !window.DB.fid) return;
    if (fhEncState() !== 'enc' || !fhKeyReady()) return;    // dual is covered by the enable/resume job
    _fhCovBusy = true;
    const fid = window.DB.fid;
    let nTxt = 0, nPhoto = 0;
    try {
      for (const spec of _TXT_COVER) {
        const r = await sb.from(spec.t).select('id,' + spec.f + ',' + spec.f + '_enc').eq('family_id', fid);
        if (r.error) continue;
        for (const row of (r.data || [])) {
          const pt = row[spec.f];
          if (pt === null || pt === undefined || pt === '') continue;
          const patch = {};
          patch[spec.f] = null;                              // committed: ciphertext is the only copy
          patch[spec.f + '_enc'] = row[spec.f + '_enc'] != null ? row[spec.f + '_enc'] : await fhEnc(pt);
          window.DB._lastLocalWrite = Date.now();
          try { await _w(sb.from(spec.t).update(patch).eq('id', row.id), 'cover ' + spec.t); nTxt++; } catch (e) {}
        }
      }
      const P = SUPABASE_URL + '/storage/v1/object/public/family-media/';
      for (const tbl of ['transaction_photos', 'event_memories']) {
        const r = await sb.from(tbl).select('id,photo_url').eq('family_id', fid);
        if (r.error) continue;
        for (const row of (r.data || [])) {
          const p = row.photo_url;
          if (!p || p.indexOf('http') === 0 || /\.enc$/.test(p)) continue;
          try {
            _fhEncProg(L('Đang bảo vệ ảnh… ', 'Protecting photos… ') + (nPhoto + 1));
            const resp = await fetch(P + p.split('/').map(encodeURIComponent).join('/'));
            if (!resp.ok) continue;
            const ct = await fhEncBytes(new Uint8Array(await resp.arrayBuffer()));
            const newPath = p + '.enc';
            const up = await sb.storage.from('family-media').upload(newPath, ct, { contentType: 'application/octet-stream', cacheControl: '31536000' });
            if (up.error && !/already exists|duplicate/i.test(String(up.error.message || ''))) continue;
            window.DB._lastLocalWrite = Date.now();
            await _w(sb.from(tbl).update({ photo_url: newPath }).eq('id', row.id), 'protect photo');
            try { await sb.storage.from('family-media').remove([p]); } catch (e) {}
            nPhoto++;
          } catch (e) { console.warn('photo cover failed', tbl, row.id, e); }
        }
      }
      /* member avatars (0052): a face set while the family was 'off'/'dual' is a
         plaintext bucket object — same treatment as photos. Repoint via
         update_member, which authorises owner-or-self; only sweep rows this device
         can actually update (the owner, enabling encryption, covers everyone). */
      {
        const _uid = window.fhUser && window.fhUser.id;
        const _own = (await sb.from('families').select('owner_id').eq('id', fid).maybeSingle()).data;
        const _isOwner = !!(_own && _uid && _own.owner_id === _uid);
        const rm = await sb.from('members').select('id,user_id,avatar_url').eq('family_id', fid).is('archived_at', null);
        if (!rm.error) for (const row of (rm.data || [])) {
          const p = row.avatar_url;
          if (!p || p.indexOf('http') === 0 || /\.enc$/.test(p)) continue;
          if (!_isOwner && row.user_id !== _uid) continue;                  // can't update this row → skip (owner's sweep covers it)
          try {
            _fhEncProg(L('Đang bảo vệ ảnh… ', 'Protecting photos… ') + (nPhoto + 1));
            const resp = await fetch(P + p.split('/').map(encodeURIComponent).join('/'));
            if (!resp.ok) continue;
            const ct = await fhEncBytes(new Uint8Array(await resp.arrayBuffer()));
            const newPath = p + '.enc';
            const up = await sb.storage.from('family-media').upload(newPath, ct, { contentType: 'application/octet-stream', cacheControl: '31536000' });
            if (up.error && !/already exists|duplicate/i.test(String(up.error.message || ''))) continue;
            window.DB._lastLocalWrite = Date.now();
            await _rpc('update_member', { p_member_id: row.id, p_avatar_url: newPath });
            try { await sb.storage.from('family-media').remove([p]); } catch (e) {}
            nPhoto++;
          } catch (e) { console.warn('avatar cover failed', row.id, e); }
        }
      }
      _fhEncProg('');
      if (nPhoto) window.toast && window.toast(L('Đã mã hóa ' + nPhoto + ' ảnh của gia đình ✓', nPhoto + ' family photos encrypted ✓'));
      if (nTxt || nPhoto) { window.DB._lastLocalWrite = 0; window.loadFamilyData && window.loadFamilyData(); }
    } catch (e) { _fhEncProg(''); console.warn('cover sweep failed', e); }
    finally { _fhCovBusy = false; }
  };

  /* dual→off ONLY: abort the trial window. In dual the plaintext never left
     the server, so nothing is "restored" — the server just drops the trial's
     ciphertext (0035 wipes it inside the state change) and the family is back
     exactly where it started. Once a family COMMITS ('enc'), there is no off
     switch: 0035 makes 'enc' terminal and this button never renders there. */
  window.fhEncDisable = async function (btn) {
    if (_fhEncBusy || fhEncState() !== 'dual') return;
    if (btn && !btn.classList.contains('armed')) {
      btn.classList.add('armed'); btn.textContent = L('Chạm lần nữa để tắt, mọi số liệu giữ nguyên', 'Tap again to turn off, all data stays as it is');
      clearTimeout(window._fhDisArmT);
      window._fhDisArmT = setTimeout(() => {
        if (!btn.isConnected) return;
        btn.classList.remove('armed'); btn.textContent = L('Tắt mã hóa', 'Turn encryption off');
      }, 4000);
      return;
    }
    clearTimeout(window._fhDisArmT);
    _fhEncBusy = true;
    if (btn) btn.disabled = true;
    try {
      await _rpc('set_family_enc_state', { p_state: 'off' });
      window.toast && window.toast(L('Đã tắt mã hóa, dữ liệu giữ nguyên như cũ.', 'Encryption off. Your data stays as it was.'));
      await window.loadFamilyData();
      window.fhEncryptionSheet();
    } catch (e) {
      window.toast && window.toast(_friendly(e));
      if (btn) { btn.disabled = false; btn.classList.remove('armed'); }
    } finally { _fhEncBusy = false; }
  };
