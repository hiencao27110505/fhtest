  (function () {
    /* ═══ Statement capture, on the device (docs/specs/statement-capture-spec.md) ═══
       A bank's statement arrives by email as a spreadsheet, usually locked with a
       password. The server's whole part is custody: it seals the file to THIS
       person's personal key and queues one locked card. Everything that needs the
       file's contents happens here, after a tap:

         card -> download -> open the seal -> (password) -> read the table ->
         prove the column reading -> pick the account -> write N encrypted rows

       From that last step on, a statement row is an ordinary staged row. It is
       shaped exactly like an opened email_transactions row (fhStmtAsStaged), so the
       review screen, the kinds, the dedup engine, import and retirement are the
       ones in 72 / 56 / 57 / 58 -- this file adds no second review.

       ALWAYS PERSONAL (decision S24). The file and the rows are under the personal
       key whatever the mailbox default is: a real statement carries an ID number, a
       home address and a full account number. A locked personal ledger therefore
       means a statement cannot be opened on this device, and the card says so.

       The password is used here and thrown away, unless the person opts to have it
       remembered -- then it is kept on THIS device only, encrypted under the
       personal key, and never sent anywhere. */

    const STM_BUCKET = 'statement-files';
    const STM_ROW_PAGE = 1000;
    const STM_SOURCE = 'statement-email';            // 0100 provenance stamp on imported rows

    const _stmU8 = (b64) => { const bin = atob(b64); const o = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) o[i] = bin.charCodeAt(i); return o; };
    const _stmB64 = (u8) => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); };
    const _stmUid = () => (window.fhUser && window.fhUser.id) || null;

    async function _stmEncJson(obj) { return _stmB64(await window.fhPersonalEncBytes(new TextEncoder().encode(JSON.stringify(obj)))); }
    async function _stmDecJson(b64) { return JSON.parse(new TextDecoder().decode(await window.fhPersonalDecBytes(_stmU8(b64)))); }

    /* ── locally retired rows ────────────────────────────────────────────────
       Same reason as 72's set: the ledger write lands first and the server delete
       second, so a failed delete must not put an imported row back in the queue.
       Its OWN key: 72 prunes its set against email ids only, which would drop
       statement ids the moment it ran. */
    const _stmRetKey = () => { const u = _stmUid(); return u ? 'fh-stmt-retired:' + u : ''; };
    function _stmRetGet() { try { return JSON.parse(localStorage.getItem(_stmRetKey()) || '[]'); } catch (e) { return []; } }
    function _stmRetAdd(ids) { const k = _stmRetKey(); if (!k || !ids || !ids.length) return; const s = new Set(_stmRetGet()); ids.forEach((i) => s.add(i)); try { localStorage.setItem(k, JSON.stringify([...s].slice(-4000))); } catch (e) {} }
    function _stmRetPrune(serverIds) { const k = _stmRetKey(); if (!k) return; const live = new Set(serverIds); try { localStorage.setItem(k, JSON.stringify(_stmRetGet().filter((i) => live.has(i)))); } catch (e) {} }

    /* ── fingerprints: "already decided", unreadable by the server ───────────
       HMAC under a key derived (HKDF) from the personal staging PRIVATE key, which
       only this person's devices can unwrap. The canonical string is the bank's own
       transaction id when the file has one -- an exact key -- else the row's facts. */
    let _stmFpKeyCache = null;
    async function _stmFpKey() {
      if (_stmFpKeyCache) return _stmFpKeyCache;
      const priv = await window.fhPersonalStagingPrivKey();
      const base = await crypto.subtle.importKey('raw', priv, 'HKDF', false, ['deriveKey']);
      _stmFpKeyCache = await crypto.subtle.deriveKey(
        { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(32), info: new TextEncoder().encode('stmt-row-fp-v1') },
        base, { name: 'HMAC', hash: 'SHA-256', length: 256 }, false, ['sign']);
      return _stmFpKeyCache;
    }
    function fhStmtCanonical(provider, tail, row) {
      const p = String(provider || '').toLowerCase().replace(/\s+/g, '');
      if (row.ref) return 'v1|ref|' + p + '|' + String(row.ref).trim();
      return 'v1|row|' + p + '|' + (tail || '') + '|' + row.date + '|' + Math.round(row.amt) + '|' +
        String(row.description || '').toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 80);
    }
    async function _stmFp(canonical) {
      const sig = await crypto.subtle.sign('HMAC', await _stmFpKey(), new TextEncoder().encode(canonical));
      return _stmB64(new Uint8Array(sig));
    }
    window.fhStmtCanonical = fhStmtCanonical;

    /* ── a parsed row -> the shape of an OPENED email_transactions row ────────
       Everything downstream reads these fields (72's accessors index
       _fhStagedRows by rowIndex), so matching the shape exactly is what makes a
       statement row reviewable with no second code path. `_stmt` is the only
       discriminator, and only retirement looks at it. */
    function fhStmtAsStaged(id, p) {
      return {
        id: id, _stmt: true, statement_id: p.sid, row_fp: p.fp || null,
        member_id: null, source_provider: p.provider,
        /* A day-only row is stored at UTC midnight -- the convention fhStagedRowTime
           and the richest-copy merge already read as "no clock", so neither invents
           a time nor merges two honest same-amount purchases of one day. */
        /* A timed row is written the way PostgREST writes a timestamptz
           ("...T01:29:06+00:00"), not as VN local text: the review's richest-copy merge
           keys on this STRING plus the amount, so a statement row and a still-pending
           email for the same second collapse into one card only if both spell the
           instant identically. Statements here are Vietnamese: the clock is +07:00. */
        occurred_at: p.time
          ? new Date(p.date + 'T' + p.time + ':' + (p.sec || '00') + '+07:00').toISOString().replace('.000Z', '+00:00')
          : (p.date + 'T00:00:00Z'),
        amount: Math.abs(p.amt), currency: 'VND', direction: p.amt < 0 ? 'debit' : 'credit',
        counterparty: p.counterparty || '',
        duplicate_of_id: null, resolved_before: false,
        raw_extracted: {
          memo: p.memo, memo_display: p.memo,
          transaction_type: p.person ? 'p2p_transfer' : (p.accountKind === 'ewallet' ? 'ecommerce_receipt' : 'bank_txn'),
          flow: p.flow === 'cardpay' ? 'transfer' : (p.amt < 0 ? 'expense' : 'income'),
          account_kind: p.accountKind || null, account_masked: p.tail || '',
          reference_number: p.ref || '', balance: p.bal == null ? null : p.bal,
          category_hint: p.concept || '', direction: p.amt < 0 ? 'debit' : 'credit',
          counterparty: p.counterparty || '', _transport: 'statement',
          stmt: { xfer: !!p.xfer, attn: !!p.attn, incomeCat: p.incomeCat || '', fundedElsewhere: !!p.fundedElsewhere }
        }
      };
    }
    window.fhStmtAsStaged = fhStmtAsStaged;

    /* What one parsed row becomes. Pure: no network, no key -- unit-tested.
       `acct` = { provider, kind, tail } of the account the statement belongs to. */
    const STM_MCC = () => (typeof CSV_MCC_CONCEPT === 'object' && CSV_MCC_CONCEPT) || {};
    function fhStmtRowPayload(row, acct, sid) {
      const c = row.cls || {};
      let provider = acct.provider, kind = acct.kind, tail = acct.tail || '';
      /* A wallet payment that did not move the wallet balance was paid from a linked
         bank. It belongs to THAT bank's account -- named when the file names it,
         otherwise left unplaced rather than booked against the wallet, which would
         pull the wallet's balance away from the real one with every such payment. */
      if (c.fundedElsewhere) {
        tail = '';
        if (c.fundingIsBank && !/ngan hang lien ket/i.test(String(c.funding).normalize('NFD').replace(/[\u0300-\u036f]/g, ''))) { provider = c.funding; kind = 'deposit'; }
        else { kind = null; }
      }
      /* Transfer evidence (spec section 11). Level 2 only: structured evidence on one
         side -- the file's own funding column names a bank on a top-up, or the memo
         says recipient == holder. Both are pre-set AND sent to "Cần bạn xem". A
         holder-name memo alone sets nothing. Level 1 (both legs) is the review's own
         pair matcher, which needs no hint. */
      const xfer = c.flow === 'topup' || !!c.selfTransfer;
      const incomeCat = c.flow === 'salary' ? 'Lương' : (c.flow === 'refund' ? 'Hoàn tiền' : '');
      return {
        sid: sid, date: row.date, time: row.time || '', sec: (row.key || '').slice(17, 19) || '00',
        amt: row.amt, bal: (c.fundedElsewhere ? null : row.bal), ref: row.ref || '',
        memo: c.memo == null ? '' : c.memo, counterparty: c.counterparty || '', person: !!c.person,
        flow: c.flow || '', xfer: xfer, attn: xfer, incomeCat: incomeCat, fundedElsewhere: !!c.fundedElsewhere,
        concept: (row.mcc && STM_MCC()[row.mcc]) || '',
        provider: provider, accountKind: kind, tail: tail
      };
    }
    window.fhStmtRowPayload = fhStmtRowPayload;

    /* ── load: cards + rows, for the review queue ──────────────────────────── */
    let _stmCards = [];
    window.fhStmtCards = () => _stmCards;

    async function _stmOpenMeta(f, priv) {
      return window.fhStagingOpenRow({ sealed: f.meta_sealed, nonce: f.meta_nonce, eph_pub: f.meta_eph_pub, enc_v: f.enc_v,
        owner_user_id: _stmUid(), gmail_message_id: f.gmail_message_id }, priv);
    }

    window.fhStmtLoad = async function () {
      const out = { rows: [], cards: [], locked: 0 };
      if (!window.sb || !_stmUid()) return out;
      const ready = !!(window.fhPersonalKeyReady && window.fhPersonalKeyReady());

      const fres = await window.sb.from('statement_files')
        .select('id,gmail_message_id,part_index,source_provider,received_at,file_ext,byte_size,object_path,meta_sealed,meta_eph_pub,meta_nonce,enc_v,status,backfill,expires_at')
        .in('status', ['pending', 'expired']).order('received_at', { ascending: false }).limit(60);
      if (fres.error) throw fres.error;
      let priv = null;
      if (ready && (fres.data || []).length) { try { priv = await window.fhPersonalStagingPrivKey(); } catch (e) { priv = null; } }
      out.cards = (fres.data || []).map((f) => {
        const card = Object.assign({}, f, { meta: null, keyLocked: !priv });
        if (priv && f.meta_sealed) { try { card.meta = _stmOpenMeta(f, priv); } catch (e) { card.keyLocked = true; } }
        return card;
      });
      _stmCards = out.cards;

      const rres = await window.sb.from('statement_rows')
        .select('id,statement_id,row_index,txn_date,payload_enc').order('txn_date', { ascending: false }).limit(STM_ROW_PAGE);
      if (rres.error) throw rres.error;
      const server = rres.data || [];
      _stmRetPrune(server.map((r) => r.id));
      const gone = new Set(_stmRetGet());
      for (const r of server) {
        if (gone.has(r.id)) continue;
        if (!ready) { out.locked++; continue; }
        try { out.rows.push(fhStmtAsStaged(r.id, await _stmDecJson(r.payload_enc))); } catch (e) { out.locked++; }
      }
      return out;
    };

    /* How many statement things are waiting: every row plus every locked card
       (decision S15: the badge counts everything). Head-only, no decrypt. */
    window.fhStmtPendingCount = async function () {
      if (!window.sb || !_stmUid()) return 0;
      try {
        const a = await window.sb.from('statement_rows').select('id', { count: 'exact', head: true });
        const b = await window.sb.from('statement_files').select('id', { count: 'exact', head: true }).eq('status', 'pending');
        return Math.max(0, (a.count || 0) - _stmRetGet().length) + (b.count || 0);
      } catch (e) { return 0; }
    };

    /* ── retirement ────────────────────────────────────────────────────────── */
    /* ids -> the statement rows among them (looked up in the live queue). */
    function _stmPick(ids) {
      const byId = {}; (window._fhStagedRows || []).forEach((r) => { if (r && r._stmt) byId[r.id] = r; });
      return (ids || []).map((i) => byId[i]).filter(Boolean);
    }
    /* Splits a mixed id list. 72 calls this wherever it used to hand every id to
       resolve_email_transactions: email ids go on to that RPC, statement ids are
       retired here -- local record first, then fingerprints + delete in one RPC. */
    window.fhStmtSplitIds = function (ids) {
      const mine = new Set(_stmPick(ids).map((r) => r.id));
      return { email: (ids || []).filter((i) => !mine.has(i)), stmt: [...mine] };
    };
    window.fhStmtRetire = async function (ids) {
      const rows = _stmPick(ids); if (!rows.length) return 0;
      _stmRetAdd(rows.map((r) => r.id));
      return _rpc('resolve_statement_rows', { p_ids: rows.map((r) => r.id), p_fps: rows.map((r) => r.row_fp).filter(Boolean) });
    };

    /* ── the locked cards, rendered at the top of the review ─────────────────
       Called from renderCsvReview (56) in staged mode. Statements found while
       reading history fold under "Sao kê cũ" so a first connect does not open on a
       wall of backlog. */
    let _stmOldOpen = false, _stmArmed = null;
    const _stmDM = (iso) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || ''); return m ? m[3] + '/' + m[2] : ''; };
    function _stmTitle(card) {
      const bank = window.fhProviderName ? window.fhProviderName(card.source_provider) : card.source_provider;
      const m = card.meta || {};
      let when = '';
      if (m.period_from && m.period_to) when = _stmDM(m.period_from) + ' – ' + _stmDM(m.period_to);
      else if (m.period_month) when = L('tháng ', '') + m.period_month.slice(5) + '/' + m.period_month.slice(0, 4);
      else when = _stmDM(String(card.received_at).slice(0, 10));
      return L('Sao kê ', 'Statement · ') + bank + (when ? ' · ' + when : '');
    }
    function _stmCardHTML(card) {
      const expired = card.status === 'expired';
      const sub = card.keyLocked ? L('Mở khoá sổ cá nhân ở tab Cá nhân để mở sao kê này.', 'Unlock your personal ledger on the Personal tab to open this.')
        : expired ? L('File đã hết hạn lưu. Chọn file từ máy để mở.', 'The stored file has expired. Pick the file from your device.')
        : ((card.meta && card.meta.filename) || '') ;
      const armed = _stmArmed === card.id;
      return '<div class="stm-card">' +
        '<div class="stm-main"><div class="stm-title">' + _esc(_stmTitle(card)) + '</div>' +
        (sub ? '<div class="stm-sub">' + _esc(sub) + '</div>' : '') + '</div>' +
        '<div class="stm-actions">' +
        (card.keyLocked ? '' : '<button type="button" class="stm-open" onclick="fhStmtOpen(\'' + card.id + '\')">' +
          _esc(expired ? L('Chọn file', 'Pick file') : L('Mở sao kê', 'Open')) + '</button>') +
        '<button type="button" class="stm-x' + (armed ? ' armed' : '') + '" aria-label="' + _escAttr(L('Bỏ sao kê này', 'Remove this statement')) + '" onclick="fhStmtDismiss(\'' + card.id + '\')">' +
          (armed ? _esc(L('Bỏ?', 'Remove?')) : '✕') + '</button>' +
        '</div></div>';
    }
    window.fhStmtCardsHTML = function () {
      if (!_stmCards.length) return '';
      const fresh = _stmCards.filter((c) => !c.backfill), old = _stmCards.filter((c) => c.backfill);
      let html = '';
      if (fresh.length) html += '<div class="group-h attn">' + _esc(L('Sao kê chờ mở', 'Statements to open')) + ' · ' + fresh.length + '</div><div class="csv-cards">' + fresh.map(_stmCardHTML).join('') + '</div>';
      if (old.length) {
        html += '<div class="group-h csv-sure-h"><span>' + _esc(L('Sao kê cũ', 'Older statements')) + ' · ' + old.length + '</span>' +
          '<button type="button" class="csv-linkbtn" onclick="fhStmtToggleOld()">' + _esc(_stmOldOpen ? L('Thu gọn', 'Hide') : L('Xem', 'Show')) + '</button></div>';
        if (_stmOldOpen) html += '<div class="csv-cards">' + old.map(_stmCardHTML).join('') + '</div>';
      }
      return html;
    };
    window.fhStmtToggleOld = function () { _stmOldOpen = !_stmOldOpen; window.renderCsvReview && window.renderCsvReview(); };

    window.fhStmtDismiss = async function (id) {
      if (_stmArmed !== id) { _stmArmed = id; window.renderCsvReview && window.renderCsvReview(); setTimeout(() => { if (_stmArmed === id) { _stmArmed = null; window.renderCsvReview && window.renderCsvReview(); } }, 3500); return; }
      _stmArmed = null;
      const card = _stmCards.find((c) => c.id === id);
      try {
        await _rpc('dismiss_statement_file', { p_statement_id: id });
        if (card && card.object_path) { try { await window.sb.storage.from(STM_BUCKET).remove([card.object_path]); } catch (e) {} }
        _stmCards = _stmCards.filter((c) => c.id !== id);
        window.fhRefreshStagedCount && window.fhRefreshStagedCount();
      } catch (e) { window.toast && window.toast(L('Chưa bỏ được sao kê, thử lại nhé', 'Could not remove it, try again')); }
      window.renderCsvReview && window.renderCsvReview();
    };

    /* ── the remembered password: opt-in, this device only ─────────────────── */
    const _stmPwKey = () => 'fh-stmt-pw:' + (_stmUid() || '');
    async function _stmPwAll() { try { const raw = localStorage.getItem(_stmPwKey()); return raw ? await _stmDecJson(raw) : {}; } catch (e) { return {}; } }
    async function _stmPwGet(provider) { return (await _stmPwAll())[String(provider || '').toLowerCase()] || ''; }
    async function _stmPwSet(provider, pw) {
      const all = await _stmPwAll(); const k = String(provider || '').toLowerCase();
      if (pw) all[k] = pw; else delete all[k];
      try { localStorage.setItem(_stmPwKey(), await _stmEncJson(all)); } catch (e) {}
    }
    window.fhStmtForgetPasswords = function () { try { localStorage.removeItem(_stmPwKey()); } catch (e) {} };

    /* ── the remembered column reading: per sender + header shape, this device ── */
    const _stmMapKey = () => 'fh-stmt-map:' + (_stmUid() || '');
    function _stmMapGet(provider, sig) { try { return (JSON.parse(localStorage.getItem(_stmMapKey()) || '{}'))[String(provider).toLowerCase() + '|' + sig] || null; } catch (e) { return null; } }
    function _stmMapSet(provider, sig, roles) { try { const all = JSON.parse(localStorage.getItem(_stmMapKey()) || '{}'); all[String(provider).toLowerCase() + '|' + sig] = roles; localStorage.setItem(_stmMapKey(), JSON.stringify(all)); } catch (e) {} }

    /* ── the unlock flow ───────────────────────────────────────────────────────
       Painted INTO the review's own body (#csv-result), like the file import's
       password step: the global sheet layer sits under this modal. `S` is the one
       statement being opened. */
    let S = null;
    const _stmHost = () => document.getElementById('csv-result');
    function _stmPaint(inner) { const h = _stmHost(); if (h) h.innerHTML = '<div class="csv-unlock stm-flow">' + inner + '</div>'; }
    function _stmBackBtn() { return '<button type="button" class="csv-linkbtn csv-unlock-skip" onclick="fhStmtCancel()">' + _esc(L('Để sau', 'Not now')) + '</button>'; }
    window.fhStmtCancel = function () { S = null; window.renderCsvReview && window.renderCsvReview(); };

    window.fhStmtOpen = async function (id) {
      const card = _stmCards.find((c) => c.id === id); if (!card) return;
      S = { card: card, bytes: null, password: '', remember: false, parsed: null, acct: null };
      if (card.status === 'expired') return _stmAskFile();
      _stmPaint('<div class="csv-unlock-title">' + _esc(_stmTitle(card)) + '</div><div class="csv-unlock-sub">' + _esc(L('Đang tải file…', 'Fetching the file…')) + '</div>');
      try {
        const dl = await window.sb.storage.from(STM_BUCKET).download(card.object_path);
        if (dl.error || !dl.data) throw new Error('download');
        const blob = new Uint8Array(await dl.data.arrayBuffer());
        const priv = await window.fhPersonalStagingPrivKey();
        const opened = window.nacl.box.open(blob.subarray(56), blob.subarray(32, 56), blob.subarray(0, 32), priv);
        if (!opened) throw new Error('open');
        /* The blob carries no identity of its own. The sealed METADATA does (owner +
           message, checked in fhStagingOpenRow) and names this file's hash -- so a
           blob moved under another card is refused here rather than parsed. */
        const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', opened))).map((b) => b.toString(16).padStart(2, '0')).join('');
        if (!card.meta || card.meta.file_sha256 !== hash) throw new Error('identity');
        S.bytes = opened;
      } catch (e) {
        return _stmFail(e && e.message === 'identity'
          ? L('File này không khớp với sao kê. Tụi mình không mở để an toàn.', 'This file does not match its statement, so it was not opened.')
          : L('Chưa tải được file. Kiểm tra mạng rồi thử lại, hoặc chọn file từ máy.', 'Could not fetch the file. Check your connection, or pick the file from your device.'), true);
      }
      S.password = await _stmPwGet(card.source_provider);
      return _stmParse();
    };

    function _stmFail(msg, offerFile) {
      _stmPaint('<div class="csv-unlock-title">' + _esc(_stmTitle(S.card)) + '</div><div class="csv-unlock-err">' + _esc(msg) + '</div>' +
        (offerFile ? '<button type="button" class="btn-line csv-unlock-go" onclick="fhStmtAskFile()">' + _esc(L('Chọn file từ máy', 'Pick the file from your device')) + '</button>' : '') + _stmBackBtn());
    }
    function _stmAskFile() {
      _stmPaint('<div class="csv-unlock-title">' + _esc(_stmTitle(S.card)) + '</div>' +
        '<div class="csv-unlock-sub">' + _esc(L('Chọn đúng file sao kê này từ máy của bạn.', 'Pick this statement\'s file from your device.')) + '</div>' +
        '<input type="file" id="stm-file" accept=".xlsx,.csv" hidden onchange="fhStmtFilePicked(this)">' +
        '<button type="button" class="btn-line csv-unlock-go" onclick="document.getElementById(\'stm-file\').click()">' + _esc(L('Chọn file', 'Pick file')) + '</button>' + _stmBackBtn());
    }
    window.fhStmtAskFile = _stmAskFile;
    window.fhStmtFilePicked = async function (input) {
      const f = input && input.files && input.files[0]; if (!f || !S) return;
      S.bytes = new Uint8Array(await f.arrayBuffer());
      S.localExt = /\.csv$/i.test(f.name) ? 'csv' : 'xlsx';
      return _stmParse();
    };

    async function _stmGrid() {
      const ext = S.localExt || S.card.file_ext;
      if (ext === 'csv') {
        const u = S.bytes; let text;
        if (u[0] === 0xFF && u[1] === 0xFE) text = new TextDecoder('utf-16le').decode(u);
        else if (u[0] === 0xFE && u[1] === 0xFF) text = new TextDecoder('utf-16be').decode(u);
        else text = new TextDecoder('utf-8').decode(u);
        const p = window.fhParseCsvFile(text);
        return [p.headers].concat(p.rows);
      }
      return fhParseXlsxBuffer(S.bytes.buffer.slice(S.bytes.byteOffset, S.bytes.byteOffset + S.bytes.byteLength), S.password || undefined);
    }

    async function _stmParse(wrong) {
      let grid;
      try { grid = await _stmGrid(); }
      catch (e) {
        const code = String(e && e.message || '');
        if (code === 'xlsx_encrypted' || code === 'bad_password') {
          if (code === 'bad_password' && S.password && !wrong) { await _stmPwSet(S.card.source_provider, ''); }   // a remembered password stopped working
          return _stmAskPassword(code === 'bad_password' && (wrong || S.password));
        }
        if (code === 'xlsx_enc_unsupported' || code === 'xls_legacy') return _stmFail(L('File này được khoá bằng một kiểu mã hoá tụi mình chưa mở được.', 'This file is locked with a scheme we cannot open yet.'), false);
        if (code === 'xlsx_unsupported') return _stmFail(L('Trình duyệt này chưa đọc được file Excel. Cập nhật trình duyệt rồi thử lại nhé.', 'This browser cannot read Excel files yet. Update it and try again.'), false);
        return _stmFail(L('Chưa đọc được file này.', 'Could not read this file.'), false);
      }
      if (S.remember && S.password) await _stmPwSet(S.card.source_provider, S.password);

      /* Reading order: a confirmed reading for this sender and header shape, else the
         vocabulary. The proof below decides whether either is believed. */
      let parsed = window.fhStmtParse(grid);
      if (parsed.table) {
        const kept = _stmMapGet(S.card.source_provider, parsed.sig);
        if (kept && !parsed.proof.ok) parsed = window.fhStmtParse(grid, kept);
      }
      S.parsed = parsed; S.grid = grid;
      if (!parsed.table || !parsed.rows.length) return _stmFail(L('Tụi mình chưa tìm thấy bảng giao dịch trong file này.', 'We could not find a transaction table in this file.'), false);
      if (!parsed.proof.ok) return _stmAskMapping();
      return _stmSummary();
    }

    function _stmAskPassword(wrong) {
      const bank = window.fhProviderName ? window.fhProviderName(S.card.source_provider) : S.card.source_provider;
      _stmPaint('<div class="csv-unlock-title">' + _esc(L('File này có mật khẩu', 'This file needs a password')) + '</div>' +
        '<div class="csv-unlock-sub">' + _esc(_stmTitle(S.card)) + '</div>' +
        '<input id="stm-pw" type="password" class="csv-pw" autocomplete="off" placeholder="' + _escAttr(L('Nhập mật khẩu mở file', 'Enter the password')) + '" onkeydown="if(event.key===\'Enter\'){fhStmtUnlock();}">' +
        (wrong ? '<div class="csv-unlock-err">' + _esc(L('Mật khẩu chưa đúng, thử lại nhé', 'That password didn\'t work, try again')) + '</div>' : '') +
        '<label class="stm-remember"><input type="checkbox" id="stm-rem"' + (S.remember ? ' checked' : '') + '> <span>' + _esc(L('Nhớ mật khẩu cho sao kê ' + bank + ' trên máy này', 'Remember the password for ' + bank + ' statements on this device')) + '</span></label>' +
        '<button type="button" class="btn-line csv-unlock-go" onclick="fhStmtUnlock()">' + _esc(L('Mở file', 'Open file')) + '</button>' +
        '<div class="csv-unlock-note">' + _esc(L('Mật khẩu chỉ dùng ngay trên máy bạn để mở file. Nếu bạn chọn nhớ, tụi mình lưu nó trên máy này, có mã hoá, và không gửi đi đâu.', 'The password is only used on your device to open the file. If you choose to remember it, it is kept on this device, encrypted, and never sent anywhere.')) + '</div>' + _stmBackBtn());
      const el = document.getElementById('stm-pw'); if (el) { try { el.focus(); } catch (e) {} }
    }
    window.fhStmtUnlock = function () {
      if (!S) return;
      const el = document.getElementById('stm-pw'), rem = document.getElementById('stm-rem');
      S.password = el ? el.value : ''; S.remember = !!(rem && rem.checked);
      if (!S.password) return;
      _stmPaint('<div class="csv-unlock-title">' + _esc(_stmTitle(S.card)) + '</div><div class="csv-unlock-sub">' + _esc(L('Đang mở file…', 'Opening the file…')) + '</div>');
      setTimeout(() => { _stmParse(true); }, 30);     // let the line above paint: the key derivation blocks for a second
    };

    /* The proof could not pass: say what was read and let the person decide. The
       arithmetic is shown, not hidden -- "9 of 40 rows add up" is the reason to doubt. */
    function _stmAskMapping() {
      const p = S.parsed, R = p.table.roles, H = p.table.headers;
      const names = { date: L('Ngày', 'Date'), description: L('Nội dung', 'Description'), amount: L('Số tiền', 'Amount'), debit: L('Tiền ra', 'Money out'), credit: L('Tiền vào', 'Money in'), balance: L('Số dư', 'Balance') };
      const rowsHtml = Object.keys(names).filter((k) => R[k] !== undefined).map((k) =>
        '<div class="stm-maprow"><span>' + _esc(names[k]) + '</span><b>' + _esc(String(H[R[k]] || '').replace(/\s+/g, ' ').slice(0, 40)) + '</b></div>').join('');
      _stmPaint('<div class="csv-unlock-title">' + _esc(L('Bạn xem giúp tụi mình đọc cột đúng chưa', 'Check that we read the columns right')) + '</div>' +
        '<div class="csv-unlock-sub">' + _esc(L('File này không có số dư hoặc tổng để tụi mình tự kiểm tra, nên cần bạn xác nhận.', 'This file has no balance or totals for us to check against, so we need you to confirm.')) + '</div>' +
        '<div class="stm-map">' + rowsHtml + '</div>' +
        '<div class="csv-unlock-note">' + _esc(p.rows.length + L(' giao dịch tìm được', ' transactions found')) + '</div>' +
        '<button type="button" class="btn-line csv-unlock-go" onclick="fhStmtMappingOk()">' + _esc(L('Đúng rồi', 'Looks right')) + '</button>' + _stmBackBtn());
    }
    window.fhStmtMappingOk = function () { if (S && S.parsed) { S.confirmedMap = true; _stmSummary(); } };

    /* Which of the parsed rows the ledger already has -- the same engine the review
       uses, run early so the summary can say "16 mới". A count for the person, never
       a filter: every row is still written (decision S15). */
    async function _stmKnownCount(rows) {
      try {
        if (!window.fhDedupAssess || !window.fhDedupLedgerIndex) return null;
        if (!window._fhPersonalMatchSlice && window.fhPersonalMatchSlice) window._fhPersonalMatchSlice = await window.fhPersonalMatchSlice();
        const cands = rows.map((r) => ({ amount: Math.abs(r.amt), date: new Date(r.date + 'T00:00:00'), dateDisplay: r.date, time: r.time || '',
          description: (r.cls && r.cls.memo) || r.description || '', counterparty: (r.cls && r.cls.counterparty) || '', isIncome: r.amt > 0, isTransfer: false, currency: 'VND', kind: 'bank', provider: S.card.source_provider }));
        const v = window.fhDedupAssess(cands, window.fhDedupLedgerIndex(), {});
        return v.filter((x) => x && x.tier === 'sure').length;
      } catch (e) { return null; }
    }

    function _stmAcctKind() {
      const prov = String(S.card.source_provider || '').toLowerCase();
      if (/momo|zalopay|shopeepay|viettel|vnpay/.test(prov)) return 'ewallet';
      const sum = S.parsed.summary || {};
      return (sum.prevDebt !== undefined || sum.endDebt !== undefined) ? 'credit_card' : 'deposit';
    }

    async function _stmSummary() {
      const p = S.parsed, sum = p.summary || {};
      const tail = sum.accountTail || (S.card.meta && S.card.meta.account_tail) || '';
      S.acct = { provider: S.card.source_provider, kind: _stmAcctKind(), tail: tail };

      /* Rows this person already decided on (imported or removed) are not written
         again -- the one place a statement row is dropped unseen, allowed because the
         key is exact and the decision was theirs. */
      S.payloads = [];
      const fps = [];
      for (const r of p.rows) { const fp = await _stmFp(fhStmtCanonical(S.card.source_provider, tail, r)); fps.push(fp); }
      let decided = new Set();
      try {
        for (let i = 0; i < fps.length; i += 200) {
          const q = await window.sb.from('resolved_statement_rows').select('row_fp').in('row_fp', fps.slice(i, i + 200));
          (q.data || []).forEach((x) => decided.add(x.row_fp));
        }
      } catch (e) { decided = new Set(); }
      const fresh = [];
      p.rows.forEach((r, i) => { if (!decided.has(fps[i])) fresh.push({ r: r, fp: fps[i] }); });
      S.fresh = fresh; S.decidedCount = p.rows.length - fresh.length;
      const known = await _stmKnownCount(fresh.map((x) => x.r));

      const bank = window.fhProviderName ? window.fhProviderName(S.card.source_provider) : S.card.source_provider;
      const kindLabel = { ewallet: L('Ví điện tử', 'E-wallet'), credit_card: L('Thẻ tín dụng', 'Credit card'), deposit: L('Tài khoản', 'Account') }[S.acct.kind];
      const parts = [p.rows.length + L(' giao dịch', ' transactions')];
      if (known !== null) { parts.push((fresh.length - known) + L(' mới', ' new')); if (known) parts.push(known + L(' đã có trong sổ', ' already in your ledger')); }
      if (S.decidedCount) parts.push(S.decidedCount + L(' bạn đã xử lý trước đó', ' you already handled'));
      if (p.failed) parts.push(p.failed + L(' thất bại đã bỏ qua', ' failed, skipped'));
      _stmPaint('<div class="csv-unlock-title">' + _esc(L('Tìm được ', 'Found ') + parts.join(' · ')) + '</div>' +
        '<div class="csv-unlock-sub">' + _esc(_stmTitle(S.card)) + '</div>' +
        '<div class="stm-map"><div class="stm-maprow"><span>' + _esc(L('Thuộc về', 'Belongs to')) + '</span><b>' + _esc(kindLabel + ' · ' + bank + (tail ? ' ••' + tail : '')) + '</b></div></div>' +
        '<div class="csv-unlock-note">' + _esc(fresh.length
          ? L('Các khoản sẽ vào "Duyệt giao dịch" để bạn xem từng khoản. Chưa có gì được ghi vào sổ.', 'The rows go to your review queue. Nothing is written to a ledger yet.')
          : L('Bạn đã xử lý hết các khoản trong sao kê này rồi.', 'You have already handled every row in this statement.')) + '</div>' +
        '<button type="button" class="btn-line csv-unlock-go" id="stm-go" onclick="fhStmtCommit()">' + _esc(fresh.length ? L('Đưa vào hàng chờ duyệt', 'Add to the review queue') : L('Xong', 'Done')) + '</button>' + _stmBackBtn());
    }

    /* Merchant names only -- never a person, an amount or a date -- to the
       merchant-concepts function. Best-effort: a limited model just means those rows
       arrive without a category. */
    async function _stmConcepts(payloads) {
      const names = [...new Set(payloads.filter((p) => !p.person && !p.concept && p.amt < 0 && p.flow !== 'cardpay' && !p.xfer && (p.counterparty || p.memo))
        .map((p) => String(p.counterparty || p.memo).slice(0, 80)))].slice(0, 60);
      if (!names.length) return;
      try {
        const res = await window.sb.functions.invoke('merchant-concepts', { body: { merchants: names } });
        const map = (res && res.data && res.data.concepts) || {};
        payloads.forEach((p) => { const c = map[String(p.counterparty || p.memo).slice(0, 80)]; if (c && !p.concept) p.concept = c; });
      } catch (e) { /* rows simply arrive without a hint */ }
    }

    window.fhStmtCommit = async function () {
      if (!S || !S.fresh) return;
      const btn = document.getElementById('stm-go'); if (btn) btn.disabled = true;
      const card = S.card;
      try {
        if (S.confirmedMap && S.parsed.table) _stmMapSet(card.source_provider, S.parsed.sig, S.parsed.table.roles);
        if (S.acct && window.fhPersonalAccountEnsure) { try { await window.fhPersonalAccountEnsure({ kind: S.acct.kind, provider: S.acct.provider, tail: S.acct.tail,
          name: (window.fhProviderName ? window.fhProviderName(S.acct.provider) : S.acct.provider) + (S.acct.tail ? ' ••' + S.acct.tail : '') }); } catch (e) {} }
        const payloads = S.fresh.map((x) => Object.assign(fhStmtRowPayload(x.r, S.acct, card.id), { fp: x.fp }));
        await _stmConcepts(payloads);
        const rows = [];
        for (let i = 0; i < payloads.length; i++) {
          rows.push({ id: crypto.randomUUID(), row_index: i, txn_date: payloads[i].date, payload_enc: await _stmEncJson(payloads[i]) });
        }
        /* ONE transaction: every row, and the card marked opened. A dropped connection
           leaves the card as it was and no partial rows. */
        await _rpc('stage_statement_rows', { p_statement_id: card.id, p_rows: rows });
        /* The rows are in. The sealed file has no job left, so it goes NOW (decision
           S13); the worker's sweep is only the net for a delete that fails here. */
        if (card.object_path) { try { await window.sb.storage.from(STM_BUCKET).remove([card.object_path]); } catch (e) {} }
        /* The statement's balance needs no step of its own here. Every row carries its
           running balance (raw_extracted.balance), and the import already records the
           newest one per account as the bank-stated balance (72 _recBal ->
           fhPersonalExtBalanceSet). From there the existing surfaces take over: an
           account with no anchor is asked for one by the post-import setup, and one
           with an anchor shows the drift badge with its two resolutions. */
        S = null;
        window.toast && window.toast(L('Đã đưa ' + rows.length + ' khoản vào hàng chờ duyệt', rows.length + ' rows added to your review queue'));
        window.fhTxnReviewSheet && window.fhTxnReviewSheet(window.csvEntryScope);
      } catch (e) {
        if (btn) btn.disabled = false;
        window.toast && window.toast(L('Chưa lưu được, thử lại nhé. Chưa có gì thay đổi.', 'Could not save, try again. Nothing was changed.'));
      }
    };

    /* Disconnecting the mailbox deletes what capture stored: the parsed rows, the
       cards, the sealed files, and the two on-device memories. */
    window.fhStmtPurge = async function () {
      try {
        const paths = await _rpc('purge_my_statements', {});
        if (paths && paths.length) { try { await window.sb.storage.from(STM_BUCKET).remove(paths); } catch (e) {} }
      } catch (e) {}
      try { localStorage.removeItem(_stmPwKey()); localStorage.removeItem(_stmMapKey()); localStorage.removeItem(_stmRetKey()); } catch (e) {}
      _stmCards = [];
    };
  })();