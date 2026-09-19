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
        id: id, _stmt: true, statement_id: p.sid, statement_title: p.stitle || '', row_fp: p.fp || null,
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

    /* SYNCHRONOUS, and it must stay so: fhStagingOpenRow is. Declared `async` it
       handed back a Promise, the caller stored that as `card.meta`, and every field
       read off it was undefined -- no period in the title, no file name, and a
       file hash that could never match, so every statement refused to open with
       "File này không khớp với sao kê" (2026-09-19, the first real run).
       tools/statement-load.test.js opens a really-sealed card to pin this. */
    function _stmOpenMeta(f, priv) {
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
    /* For "Chọn nhanh" (56): which statement, if any, a review candidate came from.
       Rows written before the title rode along fall back to the bank's name. */
    window.fhStmtOfCand = function (c) {
      const r = (c && typeof c.rowIndex === 'number' && window._fhStagedRows) ? window._fhStagedRows[c.rowIndex] : null;
      if (!r || !r._stmt) return null;
      return { id: r.statement_id, title: r.statement_title || (L('Sao kê ', 'Statement · ') + (window.fhProviderName ? window.fhProviderName(r.source_provider) : r.source_provider)) };
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
    /* What the statement is OF, from the mail's own subject: a bank sends a card
       statement and an account statement on the same morning, and "Sao kê VIB · 13/07"
       twice tells the person nothing. Empty when the subject does not say. */
    function _stmKindWord(card) {
      const subj = String((card.meta && card.meta.subject) || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
      if (/the tin dung|credit card/.test(subj)) return L('thẻ tín dụng', 'credit card');
      if (/tai khoan|account/.test(subj)) return L('tài khoản', 'account');
      if (/momo|zalopay|shopeepay|vi dien tu|wallet/.test(subj + ' ' + String(card.source_provider).toLowerCase())) return L('ví', 'wallet');
      return '';
    }
    function _stmTitle(card) {
      const bank = (window.fhProviderName ? window.fhProviderName(card.source_provider) : card.source_provider) + (_stmKindWord(card) ? ' ' + _stmKindWord(card) : '');
      const m = card.meta || {};
      let when = '';
      if (m.period_from && m.period_to) when = _stmDM(m.period_from) + ' – ' + _stmDM(m.period_to);
      else if (m.period_month) when = L('tháng ', '') + m.period_month.slice(5) + '/' + m.period_month.slice(0, 4);
      else when = _stmDM(String(card.received_at).slice(0, 10));
      return L('Sao kê ', 'Statement · ') + bank + (when ? ' · ' + when : '');
    }
    function _stmSub(card) {
      if (card.keyLocked) return L('Mở khoá sổ cá nhân để xem', 'Unlock your personal ledger to view');
      if (card.status === 'expired') return L('Hết hạn lưu file · chọn lại từ máy', 'Stored file expired · pick it from your device');
      const m = card.meta || {}, bits = [];
      const kind = _stmKindWord(card); if (kind) bits.push(kind.charAt(0).toUpperCase() + kind.slice(1));
      if (m.account_tail) bits.push('••' + m.account_tail);
      return bits.join(' ');
    }
    function _stmCardHTML(card) {
      const armed = _stmArmed === card.id, dead = !!card.keyLocked, sub = _stmSub(card);
      return '<div class="stm-card' + (dead ? ' dim' : '') + '">' +
        '<button type="button" class="stm-tap"' + (dead ? ' disabled' : ' onclick="fhStmtOpen(\'' + card.id + '\')"') + '>' +
          '<span class="stm-txt"><span class="stm-title">' + _esc(_stmTitle(card)) + '</span>' +
          (sub ? '<span class="stm-sub">' + _esc(sub) + '</span>' : '') + '</span>' +
          (dead ? '' : '<svg class="chev" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18l6-6-6-6"/></svg>') +
        '</button>' +
        '<button type="button" class="bulk-x' + (armed ? ' armed' : '') + '" aria-label="' + _escAttr(L('Bỏ sao kê', 'Remove statement')) + '" onclick="fhStmtDismiss(\'' + card.id + '\')">' +
          (armed ? _esc(L('Bỏ?', 'Remove?')) : '✕') + '</button>' +
        '</div>';
    }
    /* Filter by bank. Six statements from two banks is already a list worth narrowing,
       and a year of history is thirty. Chips appear only when there is a choice to make;
       the same chip style as "Chọn nhanh", so it reads as the same kind of control. */
    let _stmProvF = null;
    const _stmProvOf = (c) => (window.fhProviderName ? window.fhProviderName(c.source_provider) : c.source_provider) || L('Khác', 'Other');
    window.fhStmtProvTgl = function (p) { _stmProvF = (_stmProvF === p || p === '') ? null : p; window.renderCsvReview && window.renderCsvReview(); };
    function _stmProvChips() {
      const n = {}; _stmCards.forEach((c) => { const p = _stmProvOf(c); n[p] = (n[p] || 0) + 1; });
      const ps = Object.keys(n).sort(); if (ps.length < 2) { _stmProvF = null; return ''; }
      if (_stmProvF && !n[_stmProvF]) _stmProvF = null;
      const chip = (on, label, cnt, arg) => '<button type="button" class="ctp-chip' + (on ? ' on' : '') + '" onclick="fhStmtProvTgl(\'' + _escAttr(arg) + '\')">' + _esc(label) + ' <span class="ctp-n">' + cnt + '</span></button>';
      return '<div class="ctp-r stm-provs">' + chip(!_stmProvF, L('Tất cả', 'All'), _stmCards.length, '') + ps.map((p) => chip(_stmProvF === p, p, n[p], p)).join('') + '</div>';
    }
    window.fhStmtCardsHTML = function () {
      if (!_stmCards.length) return '';
      const chips = _stmProvChips();
      const shown = _stmCards.filter((c) => !_stmProvF || _stmProvOf(c) === _stmProvF);
      const fresh = shown.filter((c) => !c.backfill), old = shown.filter((c) => c.backfill);
      let html = '<div class="group-h attn">' + _esc(L('Sao kê', 'Statements')) + ' · ' + _stmCards.length + '</div>' + chips;
      if (fresh.length) html += '<div class="csv-cards">' + fresh.map(_stmCardHTML).join('') + '</div>';
      if (old.length) {
        html += '<div class="group-h csv-sure-h stm-old-h"><span>' + _esc(L('Sao kê cũ', 'Older')) + ' · ' + old.length + '</span>' +
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
      } catch (e) { window.toast && window.toast(L('Chưa bỏ được, thử lại nhé', 'Could not remove it, try again')); }
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
    function _stmHead(title, sub) { return '<div class="csv-unlock-title">' + _esc(title) + '</div>' + (sub ? '<div class="csv-unlock-sub">' + _esc(sub) + '</div>' : ''); }
    function _stmBusyLine(txt) { return '<div class="stm-wait"><span class="stm-spin" aria-hidden="true"></span>' + _esc(txt) + '</div>'; }
    function _stmBackBtn() { return '<button type="button" class="csv-linkbtn csv-unlock-skip" onclick="fhStmtCancel()">' + _esc(L('Để sau', 'Not now')) + '</button>'; }
    window.fhStmtCancel = function () { S = null; window.renderCsvReview && window.renderCsvReview(); };

    window.fhStmtOpen = async function (id) {
      const card = _stmCards.find((c) => c.id === id); if (!card) return;
      S = { card: card, bytes: null, password: '', remember: false, parsed: null, acct: null };
      if (card.status === 'expired') return _stmAskFile();
      _stmPaint(_stmHead(_stmTitle(card)) + _stmBusyLine(L('Đang tải file…', 'Fetching the file…')));
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
          ? L('File không khớp với sao kê này nên tụi mình không mở.', 'The file does not match this statement, so it stays closed.')
          : L('Chưa tải được file. Thử lại, hoặc chọn file từ máy.', 'Could not fetch the file. Try again, or pick it from your device.'), true);
      }
      S.password = await _stmPwGet(card.source_provider);
      return _stmParse();
    };

    function _stmFail(msg, offerFile) {
      _stmPaint(_stmHead(_stmTitle(S.card)) + '<div class="csv-unlock-err">' + _esc(msg) + '</div>' +
        (offerFile ? '<button type="button" class="btn-line csv-unlock-go" onclick="fhStmtAskFile()">' + _esc(L('Chọn file từ máy', 'Pick file from device')) + '</button>' : '') + _stmBackBtn());
    }
    function _stmAskFile() {
      _stmPaint(_stmHead(_stmTitle(S.card), L('Chọn file sao kê này từ máy.', 'Pick this statement\'s file from your device.')) +
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
        if (code === 'xlsx_enc_unsupported' || code === 'xls_legacy') return _stmFail(L('Kiểu khoá của file này tụi mình chưa mở được.', 'This file is locked in a way we cannot open yet.'), false);
        if (code === 'xlsx_unsupported') return _stmFail(L('Trình duyệt chưa đọc được file Excel. Cập nhật rồi thử lại nhé.', 'This browser cannot read Excel files. Update it and try again.'), false);
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
      if (!parsed.table || !parsed.rows.length) return _stmFail(L('Không thấy bảng giao dịch trong file này.', 'No transaction table found in this file.'), false);
      if (!parsed.proof.ok) return _stmAskMapping();
      return _stmSummary();
    }

    function _stmAskPassword(wrong) {
      const bank = window.fhProviderName ? window.fhProviderName(S.card.source_provider) : S.card.source_provider;
      _stmPaint(_stmHead(L('File này có mật khẩu', 'This file needs a password'), _stmTitle(S.card)) +
        '<input id="stm-pw" type="password" class="csv-pw" autocomplete="off" placeholder="' + _escAttr(L('Nhập mật khẩu mở file', 'Enter the password')) + '" onkeydown="if(event.key===\'Enter\'){event.preventDefault();fhStmtUnlock();}">' +
        (wrong ? '<div class="csv-unlock-err">' + _esc(L('Mật khẩu chưa đúng, thử lại nhé', 'That password didn\'t work, try again')) + '</div>' : '') +
        '<div class="choices stm-rem"><button type="button" class="choice' + (S.remember ? ' on' : '') + '" onclick="fhStmtRememberTgl(this)">' + _esc(L('Nhớ mật khẩu sao kê ' + bank + ' trên máy này', 'Remember ' + bank + ' statement password on this device')) + '</button></div>' +
        '<button type="button" class="btn-line csv-unlock-go" onclick="fhStmtUnlock()">' + _esc(L('Mở file', 'Unlock')) + '</button>' +
        '<div class="csv-unlock-note">' + _esc(L('Mật khẩu chỉ dùng trên máy bạn, không gửi đi đâu. Nếu chọn nhớ, tụi mình giữ nó trên máy này, có mã hoá.', 'The password stays on your device and is never sent anywhere. If you choose to remember it, it is kept on this device, encrypted.')) + '</div>' + _stmBackBtn());
      const el = document.getElementById('stm-pw'); if (el) { try { el.focus(); } catch (e) {} }
    }
    window.fhStmtRememberTgl = function (btn) { if (!S) return; S.remember = !S.remember; if (btn && btn.classList) btn.classList.toggle('on', S.remember); };
    window.fhStmtUnlock = function () {
      if (!S) return;
      const el = document.getElementById('stm-pw');
      S.password = el ? el.value : '';
      if (!S.password) { if (el) { try { el.focus(); } catch (e) {} } return; }
      _stmPaint(_stmHead(_stmTitle(S.card)) + _stmBusyLine(L('Đang mở file…', 'Opening the file…')));
      setTimeout(() => { _stmParse(true); }, 30);     // let the line above paint: the key derivation blocks for a second
    };
    /* The proof could not pass: say what was read and let the person decide. The
       arithmetic is shown, not hidden -- "9 of 40 rows add up" is the reason to doubt. */
    function _stmAskMapping() {
      const p = S.parsed, R = p.table.roles, H = p.table.headers;
      const names = { date: L('Ngày', 'Date'), description: L('Nội dung', 'Description'), amount: L('Số tiền', 'Amount'), debit: L('Tiền ra', 'Money out'), credit: L('Tiền vào', 'Money in'), balance: L('Số dư', 'Balance') };
      const rowsHtml = Object.keys(names).filter((k) => R[k] !== undefined).map((k) =>
        '<div class="stm-maprow"><span>' + _esc(names[k]) + '</span><b>' + _esc(String(H[R[k]] || '').replace(/\s+/g, ' ').slice(0, 40)) + '</b></div>').join('');
      _stmPaint(_stmHead(L('Tụi mình đọc cột thế này, đúng chưa?', 'Did we read the columns right?'),
          L('File không có số dư hay tổng để tự kiểm, nên nhờ bạn xem qua.', 'This file has no balance or totals to check against, so please take a look.')) +
        '<div class="stm-map">' + rowsHtml + '</div>' +
        '<div class="csv-unlock-note">' + _esc(p.rows.length + L(' giao dịch', ' transactions')) + '</div>' +
        '<button type="button" class="btn-line csv-unlock-go" onclick="fhStmtMappingOk()">' + _esc(L('Đúng rồi', 'Looks right')) + '</button>' + _stmBackBtn());
    }
    window.fhStmtMappingOk = function () { if (S && S.parsed) { S.confirmedMap = true; _stmSummary(); } };

    /* Which of the parsed rows the ledger already has -- the same engine the review
       uses, run early so the summary can say "16 mới". A count for the person, never
       a filter: every row is still written (decision S15). */
    async function _stmVerdicts(rows) {
      try {
        if (!window.fhDedupAssess || !window.fhDedupLedgerIndex) return null;
        if (!window._fhPersonalMatchSlice && window.fhPersonalMatchSlice) window._fhPersonalMatchSlice = await window.fhPersonalMatchSlice();
        const cands = rows.map((r) => ({ amount: Math.abs(r.amt), date: new Date(r.date + 'T00:00:00'), dateDisplay: r.date, time: r.time || '',
          description: (r.cls && r.cls.memo) || r.description || '', counterparty: (r.cls && r.cls.counterparty) || '', isIncome: r.amt > 0, isTransfer: false, currency: 'VND', kind: 'bank', provider: S.card.source_provider }));
        return window.fhDedupAssess(cands, window.fhDedupLedgerIndex(), {});
      } catch (e) { return null; }
    }

    /* The rows about to be written, newest first, so the person sees WHAT before they
       agree to it: a summary line alone asks for trust in a parser they have never
       watched work. Read-only on purpose -- editing belongs to the review, where every
       row gets the full card. */
    const STM_PREVIEW_STEP = 40;
    let _stmPreviewN = STM_PREVIEW_STEP;
    window.fhStmtPreviewMore = function () { _stmPreviewN += 200; _stmRenderSummary(); };
    function _stmPreviewHTML() {
      const list = (S.fresh || []).slice().reverse();
      if (!list.length) return '';
      const money = (n) => (typeof csvFmt === 'function' ? csvFmt(Math.abs(n)) : String(Math.abs(n)));
      const rows = list.slice(0, _stmPreviewN).map((x) => {
        const r = x.r, c = r.cls || {}, v = x.verdict, known = !!(v && v.tier === 'sure');
        const what = c.counterparty || c.memo || r.description || '';
        const tag = known ? L('đã có trong sổ', 'already booked')
          : c.flow === 'cardpay' ? L('trả nợ thẻ', 'card payment')
          : (c.flow === 'topup' || c.selfTransfer) ? L('chuyển nội bộ?', 'own transfer?')
          : c.fundedElsewhere ? L('qua ngân hàng liên kết', 'via a linked bank') : '';
        return '<div class="stm-prow' + (known ? ' known' : '') + '">' +
          '<span class="stm-pwhen">' + _esc(_stmDM(r.date)) + '</span>' +
          '<span class="stm-pwhat">' + _esc(what || L('(không có nội dung)', '(no description)')) + (tag ? '<i>' + _esc(tag) + '</i>' : '') + '</span>' +
          '<span class="stm-pamt' + (r.amt > 0 ? ' in' : '') + '">' + (r.amt > 0 ? '+' : '−') + _esc(money(r.amt)) + '</span></div>';
      }).join('');
      const left = list.length - Math.min(list.length, _stmPreviewN);
      return '<div class="stm-preview">' + rows +
        (left > 0 ? '<button type="button" class="stm-pmore" onclick="fhStmtPreviewMore()">' + _esc(L('Xem thêm ' + left + ' khoản', 'Show ' + left + ' more')) + '</button>' : '') + '</div>';
    }
    /* Which kind of account the statement belongs to: a wallet by provider, a card when
       the summary block speaks of debt, otherwise a deposit account. */
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
        /* 50 at a time: a fingerprint is 44 base64 characters and rides in the URL
           (`row_fp=in.(...)`), so a 145-row statement in one request is a ~9 KB query
           string, which is where proxies start refusing. */
        for (let i = 0; i < fps.length; i += 50) {
          const q = await window.sb.from('resolved_statement_rows').select('row_fp').in('row_fp', fps.slice(i, i + 50));
          (q.data || []).forEach((x) => decided.add(x.row_fp));
        }
      } catch (e) { decided = new Set(); }
      const fresh = [];
      p.rows.forEach((r, i) => { if (!decided.has(fps[i])) fresh.push({ r: r, fp: fps[i] }); });
      S.fresh = fresh; S.decidedCount = p.rows.length - fresh.length;
      const verdicts = await _stmVerdicts(fresh.map((x) => x.r));
      if (verdicts) fresh.forEach((x, i) => { x.verdict = verdicts[i] || null; });
      S.known = verdicts ? verdicts.filter((x) => x && x.tier === 'sure').length : null;
      _stmPreviewN = STM_PREVIEW_STEP;
      _stmRenderSummary();
    }

    function _stmRenderSummary() {
      const p = S.parsed, fresh = S.fresh, known = S.known, tail = S.acct.tail;
      const bank = window.fhProviderName ? window.fhProviderName(S.card.source_provider) : S.card.source_provider;
      const kindLabel = { ewallet: L('Ví', 'Wallet'), credit_card: L('Thẻ tín dụng', 'Credit card'), deposit: L('Tài khoản', 'Account') }[S.acct.kind];
      const bits = [];
      if (known !== null) { bits.push((fresh.length - known) + L(' mới', ' new')); if (known) bits.push(known + L(' đã có trong sổ', ' already booked')); }
      else if (fresh.length) bits.push(fresh.length + L(' khoản', ' rows'));
      if (S.decidedCount) bits.push(S.decidedCount + L(' đã xử lý', ' handled before'));
      if (p.failed) bits.push(p.failed + L(' thất bại', ' failed'));
      _stmPaint(_stmHead(p.rows.length + L(' giao dịch', ' transactions'), _stmTitle(S.card)) +
        (bits.length ? '<div class="stm-bits">' + _esc(bits.join(' · ')) + '</div>' : '') +
        '<div class="stm-map"><div class="stm-maprow"><span>' + _esc(L('Thuộc về', 'Belongs to')) + '</span><b>' + _esc(kindLabel + ' · ' + bank + (tail ? ' ••' + tail : '')) + '</b></div></div>' +
        _stmPreviewHTML() +
        '<div class="stm-gobar">' +
          (fresh.length ? '<div class="csv-unlock-note">' + _esc(L('Vào hàng chờ duyệt, chưa ghi vào sổ.', 'Goes to the review queue, not to the ledger.')) + '</div>' : '') +
          '<button type="button" class="cta" id="stm-go" onclick="fhStmtCommit()">' + _esc(fresh.length ? L('Đưa vào hàng chờ duyệt', 'Add to review queue') : L('Xong', 'Done')) + '</button>' +
          '<div id="stm-back">' + _stmBackBtn() + '</div></div>');
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
      if (!S || !S.fresh || S.committing) return;      // a second tap while the first is in flight does nothing
      S.committing = true;
      const btn = document.getElementById('stm-go'), back = document.getElementById('stm-back');
      /* Encrypting a hundred-odd rows and one round trip take a few seconds on a phone.
         A button that just sits there gets tapped again, so it goes busy at once, says
         what it is doing, counts as it goes, and the way out is hidden until it ends. */
      const busy = (txt) => { if (btn) { btn.disabled = true; btn.classList.add('busy'); btn.innerHTML = '<span class="stm-spin" aria-hidden="true"></span>' + _esc(txt); } };
      busy(L('Đang chuẩn bị…', 'Getting ready…'));
      if (back) back.hidden = true;
      const card = S.card;
      try {
        if (S.confirmedMap && S.parsed.table) _stmMapSet(card.source_provider, S.parsed.sig, S.parsed.table.roles);
        if (S.acct && window.fhPersonalAccountEnsure) { try { await window.fhPersonalAccountEnsure({ kind: S.acct.kind, provider: S.acct.provider, tail: S.acct.tail,
          name: (window.fhProviderName ? window.fhProviderName(S.acct.provider) : S.acct.provider) + (S.acct.tail ? ' ••' + S.acct.tail : '') }); } catch (e) {} }
        const stitle = _stmTitle(card);
        const payloads = S.fresh.map((x) => Object.assign(fhStmtRowPayload(x.r, S.acct, card.id), { fp: x.fp, stitle: stitle }));
        busy(L('Đang gợi ý danh mục…', 'Suggesting categories…'));
        await _stmConcepts(payloads);
        const rows = [];
        for (let i = 0; i < payloads.length; i++) {
          rows.push({ id: crypto.randomUUID(), row_index: i, txn_date: payloads[i].date, payload_enc: await _stmEncJson(payloads[i]) });
          if (i % 10 === 0) { busy(L('Đang mã hoá ' + (i + 1) + '/' + payloads.length + '…', 'Encrypting ' + (i + 1) + '/' + payloads.length + '…')); await new Promise((r) => setTimeout(r, 0)); }
        }
        busy(L('Đang đưa vào hàng chờ…', 'Adding to the queue…'));
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
        window.toast && window.toast(L('Đã thêm ' + rows.length + ' khoản vào hàng chờ', rows.length + ' rows added to the queue'));
        window.fhTxnReviewSheet && window.fhTxnReviewSheet(window.csvEntryScope);
      } catch (e) {
        if (S) S.committing = false;
        if (btn) { btn.disabled = false; btn.classList.remove('busy'); btn.textContent = L('Đưa vào hàng chờ duyệt', 'Add to review queue'); }
        if (back) back.hidden = false;
        window.toast && window.toast(L('Chưa lưu được, thử lại nhé', 'Could not save, try again'));
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