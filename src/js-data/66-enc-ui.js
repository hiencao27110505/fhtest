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
    { t: 'saving_goals',    num: ['target_amount'], str: ['name', 'note'] }
  ];
  const _encCols = (spec) => ['id'].concat(spec.num, spec.str, spec.num.map((f) => f + '_enc'), spec.str.map((f) => f + '_enc')).join(',');
  let _fhEncBusy = false;

  function _fhEncProg(msg) {
    const el = document.getElementById('fh-enc-prog');
    if (el) el.textContent = msg;
  }

  window.fhEncryptionSheet = async function () {
    const fid = window.DB.fid;
    if (!fid) { window.toast && window.toast(L('Hãy mở một gia đình trước', 'Open a family first')); return; }
    let owner = false;
    try { const r = await sb.from('families').select('owner_id').eq('id', fid).maybeSingle(); owner = !!(r.data && window.fhUser && r.data.owner_id === window.fhUser.id); } catch (e) {}
    const enc = window.DB.enc, st = fhEncState();
    const intro = '<div class="fh-s-h">' + L('Mã hóa tài chính', 'Money encryption') + '</div>'
      + '<div class="fh-s-sub">' + L('Số tiền, ghi chú và tên mục tiêu được mã hóa ngay trên máy bằng mã gia đình — máy chủ chỉ lưu bản đã khóa, kể cả chúng tôi cũng không đọc được.',
                                      'Amounts, notes and goal names are encrypted on-device with the family passcode — the server only ever stores locked values; even we can’t read them.') + '</div>';
    let body = '';
    if (!enc) {
      body = '<div class="fh-s-sub">' + L('Bước đầu tiên là đặt mã gia đình 6 số.', 'First, set the family’s 6-digit passcode.') + '</div>'
        + (owner ? _btn(L('Đặt mã gia đình', 'Set the passcode'), '_closeOv();fhSetPasscode()', _S.cta)
                 : '<div class="fh-s-sub">' + L('Chỉ chủ gia đình đặt được mã.', 'Only the owner can set it.') + '</div>');
    } else if (st === 'off') {
      body = '<div class="fh-s-lab">' + L('Trạng thái: chưa bật', 'Status: off') + '</div>'
        + '<div class="fh-s-sub">' + L('Khi bật: (1) tải một bản sao JSON về máy, (2) mã hóa toàn bộ dữ liệu tiền cạnh bản gốc, (3) vào giai đoạn kiểm chứng — mọi số vẫn hiển thị như cũ, chưa có gì bị xóa.',
                                        'Turning on: (1) downloads a JSON copy to this device, (2) encrypts all money data alongside the originals, (3) enters a verification window — everything still shows as before, nothing is deleted.') + '</div>'
        + (owner ? _btn(L('Bật mã hóa', 'Turn on encryption'), 'fhEncEnable(this)', _S.cta)
                 : '<div class="fh-s-sub">' + L('Chỉ chủ gia đình bật được.', 'Only the owner can turn this on.') + '</div>');
    } else if (st === 'dual') {
      body = '<div class="fh-s-lab">' + L('Trạng thái: giai đoạn kiểm chứng', 'Status: verification window') + '</div>'
        + '<div class="fh-s-sub">' + L('Bản mã và bản gốc đang tồn tại song song; app tự đối chiếu mỗi lần đọc. Dùng thử vài ngày trên đủ các máy. Khi yên tâm, bấm hoàn tất để xóa bản gốc trên máy chủ — bước duy nhất không tự quay lại được nếu cả nhà mất mã.',
                                        'Ciphertext and originals coexist; the app cross-checks them on every read. Use it for a few days on all devices. When confident, finish to erase the plaintext on the server — the one step that can’t be undone if the whole family loses the code.') + '</div>'
        + (owner ? _btn(L('Hoàn tất — xóa bản gốc trên máy chủ', 'Finish — erase server plaintext'), 'fhEncScrub(this)', _S.del)
                 + _btn(L('Mã hóa nốt dòng còn thiếu', 'Re-encrypt any missed rows'), 'fhEncEnable(this)', _S.line)
                 + _btn(L('Tắt mã hóa', 'Turn encryption off'), 'fhEncDisable(this)', _S.ghost)
                 : '<div class="fh-s-sub">' + L('Chủ gia đình sẽ hoàn tất bước này.', 'The owner finishes this step.') + '</div>');
    } else {
      body = '<div class="fh-s-lab">' + L('Trạng thái: đang mã hóa đầu-cuối 🔒', 'Status: end-to-end encrypted 🔒') + '</div>'
        + '<div class="fh-s-sub">' + L('Máy chủ chỉ còn bản đã khóa. Dữ liệu chỉ mở được bằng mã gia đình trên máy của thành viên.',
                                        'The server holds only locked values. Data opens only with the family code, on members’ devices.') + '</div>'
        + (fhKeyReady() ? '' : _btn(L('Mở khóa máy này', 'Unlock this device'), '_closeOv();fhUnlockPrompt()', _S.cta))
        + (owner ? _btn(L('Tắt mã hóa (khôi phục bản gốc)', 'Turn off (restore plaintext)'), 'fhEncDisable(this)', _S.del) : '');
    }
    body += '<div class="fh-s-sub" id="fh-enc-prog" style="min-height:18px"></div>';
    if (enc) body += _btn(L('Tải bản sao JSON', 'Download a JSON copy'), 'fhEncExport(this)', _S.ghost);
    body += _btn(L('Xong', 'Done'), '_closeOv()', _S.ghost);
    _fhSheet(intro + body);
  };

  // Readable copy of every money table (decrypting where needed) → JSON download.
  async function _fhExportPlain() {
    const fid = window.DB.fid, out = { exported_at: new Date().toISOString(), family_id: fid };
    for (const spec of _ENC_TABLES) {
      const r = await sb.from(spec.t).select(_encCols(spec)).eq('family_id', fid);
      if (r.error) throw r.error;
      const rows = [];
      for (const row of (r.data || [])) {
        const o = { id: row.id };
        for (const f of spec.num.concat(spec.str)) o[f] = await fhRead(row, f);
        rows.push(o);
      }
      out[spec.t] = rows;
    }
    const blob = new Blob([JSON.stringify(out, null, 1)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'familyhub-money-' + new Date().toISOString().slice(0, 10) + '.json';
    document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 4000);
  }
  window.fhEncExport = async function (btn) {
    if (btn) btn.disabled = true;
    try { await _fhExportPlain(); window.toast && window.toast(L('Đã tải bản sao về máy', 'Copy downloaded')); }
    catch (e) { window.toast && window.toast(_friendly(e)); }
    if (btn) btn.disabled = false;
  };

  /* off→dual (also "re-encrypt missed rows" while dual): downloads the JSON
     copy, then per table encrypts every row that still lacks ciphertext —
     verify-before-upload (encrypt → decrypt → compare) so a crypto bug can
     never silently write garbage. Plaintext is NOT touched here. */
  window.fhEncEnable = async function (btn) {
    if (_fhEncBusy) return;
    if (!fhKeyReady()) { window.fhUnlockPrompt(); return; }
    _fhEncBusy = true;
    if (btn) btn.disabled = true;
    const wasOff = fhEncState() === 'off';
    try {
      _fhEncProg(L('Đang tải bản sao…', 'Downloading the copy…'));
      try { await _fhExportPlain(); } catch (e) { console.warn('export failed', e); }   // job continues; DB backup still exists
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
      if (mismatches) { const _e = new Error('verify'); _e.fhMsg = L('Có ' + mismatches + ' dòng không kiểm chứng được — chưa bật.', mismatches + ' rows failed verification — not enabled.'); throw _e; }
      if (wasOff) await _rpc('set_family_enc_state', { p_state: 'dual' });
      _fhEncProg('');
      window.toast && window.toast(L('Đã mã hóa ' + total + ' dòng ✓ Giai đoạn kiểm chứng bắt đầu.', total + ' rows encrypted ✓ Verification window started.'));
      await window.loadFamilyData();
      window.fhEncryptionSheet();
    } catch (e) {
      _fhEncProg('');
      window.toast && window.toast(_friendly(e));
      if (btn) btn.disabled = false;
    } finally { _fhEncBusy = false; }
  };

  // dual→enc: THE destructive step. Arm-then-confirm, server double-checks owner+state.
  window.fhEncScrub = async function (btn) {
    if (btn && !btn.classList.contains('armed')) {
      btn.classList.add('armed'); btn.textContent = L('Chạm lần nữa — bản gốc trên máy chủ sẽ bị xóa vĩnh viễn', 'Tap again — server plaintext is erased for good');
      clearTimeout(window._fhScrubT);
      window._fhScrubT = setTimeout(() => {
        if (!btn.isConnected) return;
        btn.classList.remove('armed'); btn.textContent = L('Hoàn tất — xóa bản gốc trên máy chủ', 'Finish — erase server plaintext');
      }, 4000);
      return;
    }
    clearTimeout(window._fhScrubT);
    if (btn) { btn.disabled = true; btn.textContent = L('Đang xóa bản gốc…', 'Erasing plaintext…'); }
    let counts;
    try { counts = await _rpc('scrub_plaintext_amounts'); }
    catch (e) { window.toast && window.toast(_friendly(e)); if (btn) { btn.disabled = false; btn.classList.remove('armed'); } return; }
    const n = Object.values(counts || {}).reduce((s, x) => s + (Number(x) || 0), 0);
    window.toast && window.toast(L('Xong — đã xóa bản gốc của ' + n + ' dòng. Giờ chỉ còn bản mã hóa 🔒', 'Done — plaintext erased on ' + n + ' rows. Only ciphertext remains 🔒'));
    await window.loadFamilyData();
    window.fhEncryptionSheet();
  };

  /* enc→off (or dual→off): decrypt-back. From 'enc' we first drop to 'dual' so
     concurrent writers go back to writing both, then restore plaintext from
     ciphertext row by row (clearing the ciphertext as we go), then land on
     'off'. Interruption-safe: in dual, readers use plaintext when present and
     fall back to ciphertext when not. */
  window.fhEncDisable = async function (btn) {
    if (_fhEncBusy) return;
    if (!fhKeyReady()) { window.fhUnlockPrompt(); return; }
    if (btn && !btn.classList.contains('armed')) {
      btn.classList.add('armed'); btn.textContent = L('Chạm lần nữa để khôi phục bản gốc trên máy chủ', 'Tap again to restore server plaintext');
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
      if (fhEncState() === 'enc') await _rpc('set_family_enc_state', { p_state: 'dual' });
      let total = 0;
      for (const spec of _ENC_TABLES) {
        _fhEncProg(L('Đang khôi phục: ', 'Restoring: ') + spec.t + '…');
        const r = await sb.from(spec.t).select(_encCols(spec)).eq('family_id', window.DB.fid);
        if (r.error) throw r.error;
        for (const row of (r.data || [])) {
          const patch = {}; let touch = false;
          for (const f of spec.num.concat(spec.str)) {
            const ct = row[f + '_enc'];
            if (ct == null) continue;
            const v = await FHCrypto.decVal(_fhSessionDek(), ct);
            patch[f] = spec.num.indexOf(f) >= 0 ? Number(v) : v;
            if (spec.t === 'monthly_budgets' && f === 'budget_total' && patch[f] == null) patch[f] = 0;
            patch[f + '_enc'] = null;
            touch = true;
          }
          if (touch) {
            window.DB._lastLocalWrite = Date.now();
            await _w(sb.from(spec.t).update(patch).eq('id', row.id), 'restore ' + spec.t);
            total++;
          }
        }
      }
      await _rpc('set_family_enc_state', { p_state: 'off' });
      _fhEncProg('');
      window.toast && window.toast(L('Đã tắt mã hóa — khôi phục ' + total + ' dòng.', 'Encryption off — ' + total + ' rows restored.'));
      await window.loadFamilyData();
      window.fhEncryptionSheet();
    } catch (e) {
      _fhEncProg('');
      window.toast && window.toast(_friendly(e));
      if (btn) { btn.disabled = false; btn.classList.remove('armed'); }
    } finally { _fhEncBusy = false; }
  };
