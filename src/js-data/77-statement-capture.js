  (function () {
    /* ═══ Statement capture, on the device (docs/specs/statement-capture-spec.md) ═══
       A bank's statement arrives by email as a spreadsheet, usually locked with a
       password. The server's whole part is custody: it seals the file to THIS
       person's personal key and queues one locked card. Everything that needs the
       file's contents happens here:

         card -> download -> open the seal -> (password) -> read the table ->
         prove the column reading -> pick the account -> write N encrypted rows

       Since 2026-10-10 that chain runs with no tap when it has nothing to ask:
       the queue's own open stages a fresh statement whose file is not locked (or
       whose password is remembered here) and whose reading is proved (_stmAuto,
       S31). A tap is for what is left, and it ends at the queue too: there is no
       summary to confirm in between (S30).

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
    /* The PROMISE is what is cached: fingerprints are now taken fifty at a time,
       and fifty first callers must share one derivation, not run fifty. */
    let _stmFpKeyCache = null;
    function _stmFpKey() {
      if (_stmFpKeyCache) return _stmFpKeyCache;
      _stmFpKeyCache = (async () => {
        const priv = await window.fhPersonalStagingPrivKey();
        const base = await crypto.subtle.importKey('raw', priv, 'HKDF', false, ['deriveKey']);
        return crypto.subtle.deriveKey(
          { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(32), info: new TextEncoder().encode('stmt-row-fp-v1') },
          base, { name: 'HMAC', hash: 'SHA-256', length: 256 }, false, ['sign']);
      })();
      _stmFpKeyCache.catch(() => { _stmFpKeyCache = null; });
      return _stmFpKeyCache;
    }
    /* Work in batches of this many, with a breath for the screen between them:
       one awaited WebCrypto call per row serialises a thousand round trips. */
    const STM_BATCH = 50;
    const _stmYield = () => new Promise((r) => setTimeout(r, 0));
    async function _stmBatched(items, fn) {
      const out = new Array(items.length);
      for (let i = 0; i < items.length; i += STM_BATCH) {
        await Promise.all(items.slice(i, i + STM_BATCH).map((x, k) => Promise.resolve(fn(x, i + k)).then((v) => { out[i + k] = v; })));
        if (i + STM_BATCH < items.length) await _stmYield();
      }
      return out;
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
    /* ── payload v2, when the file's issuer was recognised ───────────────────
       (email-reading-v2-spec §4, §5.) The SAME keys the email path seals,
       filled from the statement's own source/destination columns (59
       fhStmtClassify). The review already knows how to read every one of them:
       a signal picks the kind, the bank and the tail find the account on the
       other side, and holder_name is what own-name detection needs.

       `v: 2` is what opens that door, so it is set ONLY when the profile
       actually placed the other side. A file the app has not met carries
       nothing from here and stays a v1 reading, read exactly as before.

       `src` says where each field came from (contract SRC): the file PRINTED
       these, in columns of its own, so they are neither a judgment nor a guess
       and do not by themselves send a row to "Cần bạn xem". A field the file
       did not state gets no source at all — an entry for a NULL field is read
       as "the reader withdrew its answer" and would flag every silent row. A
       pre-selection that rests on a NAME rather than a number is marked weak by
       fhKindFromSignal, which is where that judgment belongs. */
    function _stmV2(p) {
      if (!p.cpKind) return {};                       // issuer not recognised: stay v1
      const x = { v: 2, counterparty_kind: p.cpKind, holder_name: p.holderName || null,
        counterparty_bank: p.cpBank || null, counterparty_account_tail: p.cpTail || null,
        signal: p.signal || null, src: {} };
      ['counterparty_kind', 'holder_name', 'counterparty_bank', 'counterparty_account_tail', 'signal']
        .forEach((k) => { if (x[k] && x[k] !== 'unknown') x.src[k] = 'printed'; });
      return x;
    }
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
        raw_extracted: Object.assign({
          /* The cash fields are mirrored inside, as fhReadStagedRow leaves them
             on an opened email row. They sat at the top only, and the receipt
             join, reading the inner copy, never matched one statement row
             (receipt-enrichment-spec §21, RC20). */
          amount: Math.abs(p.amt), currency: 'VND',
          memo: p.memo, memo_display: p.memo,
          transaction_type: p.person ? 'p2p_transfer' : (p.accountKind === 'ewallet' ? 'ecommerce_receipt' : 'bank_txn'),
          flow: p.flow === 'cardpay' ? 'transfer' : (p.amt < 0 ? 'expense' : 'income'),
          account_kind: p.accountKind || null, account_masked: p.tail || '',
          reference_number: p.ref || '', balance: p.bal == null ? null : p.bal,
          category_hint: p.concept || '', direction: p.amt < 0 ? 'debit' : 'credit',
          /* 0144 — same field the email path seals (stage.mjs), so the review's
             pipeline tier (fhStagedNode → raw_extracted.node) sees a statement
             row exactly as it sees an email row. Null = nothing decided. */
          node: p.node || null,
          counterparty: p.counterparty || '', _transport: 'statement',
          /* `stmt.flow` is the STATEMENT's own word for the row (fhStmtClassify:
             fee, refund, salary, topup, cardpay), not the three-value `flow` above,
             which is the email pipeline's vocabulary and has to stay that way for
             every reader of it. Only cardpay and topup used to survive this
             hand-off (as flow:'transfer' and stmt.xfer); fee, refund and salary
             were classified and then dropped here, and incomeCat was written for
             a reader that did not exist. 57's candidate builder reads both now.
             p.flow has been in every stored payload since the first statement, so
             rows saved before this line carry it too. */
          stmt: { xfer: !!p.xfer, attn: !!p.attn, flow: p.flow || '', incomeCat: p.incomeCat || '', fundedElsewhere: !!p.fundedElsewhere }
        }, _stmV2(p))
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
        /* The file only says "a linked bank". The row must not keep the WALLET's name:
           72's account resolver reads a wallet provider as kind ewallet even with no
           number, and that minted a tail-less "MoMo" beside "MoMo ••1217" on the first
           real run. The file's own words, and no kind, leave the row untagged. */
        else { provider = c.funding || L('Ngân hàng liên kết', 'Linked bank'); kind = null; }
      }
      /* Transfer evidence (spec section 11). Level 2 only: structured evidence on one
         side -- the file's own funding column names a bank on a top-up, or the memo
         says recipient == holder. Both are pre-set AND sent to "Cần bạn xem". A
         holder-name memo alone sets nothing. Level 1 (both legs) is the review's own
         pair matcher, which needs no hint. */
      /* A move between two accounts the person owns, now also when the file's
         own account columns said so rather than its words (59: signal
         own_transfer / wallet_move). Same treatment either way: pre-set to
         transfer AND sent to "Cần bạn xem", because one side of a transfer is
         still a claim the person should see. */
      const xfer = c.flow === 'topup' || !!c.selfTransfer || c.signal === 'own_transfer' || c.signal === 'wallet_move';
      const incomeCat = c.flow === 'salary' ? 'Lương' : (c.flow === 'refund' ? 'Hoàn tiền' : '');
      return {
        sid: sid, date: row.date, time: row.time || '', sec: (row.key || '').slice(17, 19) || '00',
        amt: row.amt, bal: (c.fundedElsewhere ? null : row.bal), ref: row.ref || '',
        memo: c.memo == null ? '' : c.memo, counterparty: c.counterparty || '', person: !!c.person,
        flow: c.flow || '', xfer: xfer, attn: xfer, incomeCat: incomeCat, fundedElsewhere: !!c.fundedElsewhere,
        /* payload v2 — the other side, and whose statement this is. */
        signal: c.signal || '', cpKind: c.cpKind || '', cpBank: c.cpBank || '',
        cpTail: c.cpTail || '', holderName: c.holder || '',
        concept: (row.mcc && STM_MCC()[row.mcc]) || '',
        /* The codes the file itself carries (MCC, MoMo's receiving service) answer
           before any name is sent anywhere; _stmConcepts only fills what is left. */
        node: (typeof window.fhStructNode === 'function' && window.fhStructNode({
          mcc: row.mcc, svc: row.amt < 0 ? row.toAcct : row.fromAcct, desc: row.description, out: row.amt < 0 })) || null,
        provider: provider, accountKind: kind, tail: tail
      };
    }
    window.fhStmtRowPayload = fhStmtRowPayload;

    /* ── load: cards + rows, for the review queue ──────────────────────────── */
    let _stmCards = [];
    window.fhStmtCards = () => _stmCards;
    /* What a statement left behind when its rows went into the queue with no
       summary step (S30): one line where the card stood. This session only. */
    let _stmNotes = [];                              // { sid, title, n, acct, born }
    let _stmLoadSeq = 0;

    /* Decrypted row payloads, kept across queue opens. Keyed by row id and
       checked against the ciphertext string itself (a re-sealed row is a new
       string, so there is no staleness to track), so the second open of a
       thousand-row queue decrypts nothing. The staged row object is rebuilt
       from the payload on every load: downstream mutates those in place
       (receipt join, review edits) and must never see last open's copy. */
    const STM_ROW_CACHE_MAX = 3000;
    const _stmRowCache = new Map();                  // row id -> { enc, p }
    function _stmRowCacheSet(id, enc, p) {
      if (_stmRowCache.has(id)) _stmRowCache.delete(id);
      _stmRowCache.set(id, { enc: enc, p: p });
      while (_stmRowCache.size > STM_ROW_CACHE_MAX) _stmRowCache.delete(_stmRowCache.keys().next().value);
    }
    function _stmRowCachePrune(liveIds) {
      const live = new Set(liveIds);
      Array.from(_stmRowCache.keys()).forEach((k) => { if (!live.has(k)) _stmRowCache.delete(k); });
    }
    window.fhStmtRowCacheSize = () => _stmRowCache.size;

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

    /* `opts.auto` is the review queue's own open (72): fresh statements that ask
       nothing of the person are staged here, before the rows are read, so they
       arrive in this very load as rows. `opts.say` gets one line of progress.
       Every other caller gets the cards and rows as they stand. */
    window.fhStmtLoad = async function (opts) { window.fhHeat && window.fhHeat.tick('fhStmtLoad');
      const out = { rows: [], cards: [], locked: 0, staged: [] };
      if (!window.sb || !_stmUid()) return out;
      _stmLoadSeq++;
      _stmNotes = _stmNotes.filter((n) => n.n > 0 || _stmLoadSeq - n.born < 2);   // "no new rows" is said for one open
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

      if (opts && opts.auto && priv) {
        try {
          out.staged = await _stmAuto(out.cards, opts.say);
          if (out.staged.length) {
            const went = new Set(out.staged.map((s) => s.sid));
            out.cards = out.cards.filter((c) => !went.has(c.id));
            _stmCards = out.cards;
            setTimeout(() => { try { window.fhRefreshStagedCount && window.fhRefreshStagedCount(); } catch (e) {} }, 0);   // one file became N rows
          }
        } catch (e) { out.staged = []; }               // costs the shortcut, never the queue
      }

      const rres = await window.sb.from('statement_rows')
        .select('id,statement_id,row_index,txn_date,payload_enc').order('txn_date', { ascending: false }).limit(STM_ROW_PAGE);
      if (rres.error) throw rres.error;
      const server = rres.data || [];
      _stmRetPrune(server.map((r) => r.id));
      const gone = new Set(_stmRetGet());
      const slots = new Array(server.length).fill(null), todo = [];
      server.forEach((r, i) => {
        if (gone.has(r.id)) return;
        if (!ready) { out.locked++; return; }
        const hit = _stmRowCache.get(r.id);
        if (hit && hit.enc === r.payload_enc) { slots[i] = hit.p; return; }
        todo.push(i);
      });
      await _stmBatched(todo, async (i) => {
        const r = server[i];
        try { const p = await _stmDecJson(r.payload_enc); _stmRowCacheSet(r.id, r.payload_enc, p); slots[i] = p; }
        catch (e) { out.locked++; }
      });
      server.forEach((r, i) => { if (slots[i]) out.rows.push(fhStmtAsStaged(r.id, slots[i])); });
      _stmRowCachePrune(server.map((r) => r.id));      // retired or deleted rows leave with the server copy
      /* A note outlives its rows by nothing: once the statement's last row is
         imported or removed there is nothing left for "Xem" to show. */
      const here = new Set(out.rows.map((r) => r.statement_id));
      _stmNotes = _stmNotes.filter((n) => n.n === 0 || here.has(n.sid));
      return out;
    };

    /* How many statement things are waiting: every parsed row, plus every locked
       card THE REVIEW BODY ACTUALLY SHOWS. Head-only, no decrypt.

       The backlog is excluded on purpose. Since the 2026-09-24 declutter, a
       card found while reading history (backfill) renders only inside the
       toolbox's "Sao kê cũ" drawer, never as a card in the list — so counting
       it here made the badge promise work the screen then refused to show: one
       real mailbox read "25 khoản đang chờ" over a queue of two cards and 23
       invisible files. The badge counts what the list presents; the backlog
       carries its own labelled count on the toolbox button, which is the honest
       place for it. (S15 is about statement ROWS — "the badge counts every row"
       — and is kept verbatim; it never spoke about unopened files.) */
    window.fhStmtPendingCount = async function () {
      if (!window.sb || !_stmUid()) return 0;
      try {
        const a = await window.sb.from('statement_rows').select('id', { count: 'exact', head: true });
        const b = await window.sb.from('statement_files').select('id', { count: 'exact', head: true })
          .eq('status', 'pending').eq('backfill', false);
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
      rows.forEach((r) => _stmRowCache.delete(r.id));
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
      return '<div class="stm-card' + (dead ? ' dim' : '') + '" data-stm="' + _escAttr(card.id) + '">' +
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
    window.fhStmtProvTgl = function (p) {
      _stmProvF = (_stmProvF === p || p === '') ? null : p;
      if (!_stmPatchProv()) window.renderCsvReview && window.renderCsvReview();
    };
    /* In-place repaints. The review body is a long list, and renderCsvReview
       rebuilds all of it; a chip tap or an armed ✕ changes a few elements. Each
       of those is swapped where it stands, and the whole queue is repainted
       only when one of them is not on screen (a list rebuilt meanwhile, or a
       test with no DOM), where the full render is still right. */
    function _stmQ(sel) {
      if (typeof document === 'undefined' || typeof document.querySelectorAll !== 'function') return null;
      try { return Array.prototype.slice.call(document.querySelectorAll(sel)); } catch (e) { return null; }
    }
    function _stmPatchArm(id) {
      const els = _stmQ('.stm-card[data-stm="' + String(id).replace(/["\\]/g, '') + '"]');
      if (!els || !els.length) return false;
      const armed = _stmArmed === id;
      els.forEach((el) => {
        const x = el.querySelector && el.querySelector('.bulk-x'); if (!x) return;
        x.className = 'bulk-x' + (armed ? ' armed' : '');
        x.textContent = armed ? L('Bỏ?', 'Remove?') : '✕';
      });
      return true;
    }
    /* A chip tap changes three things: the chips, the fresh cards in the body,
       and the backlog count on the toolbox button (56's header). */
    function _stmPatchProv() {
      const chips = _stmQ('.stm-provs'), body = _stmQ('#stm-cards');
      if (!chips || !chips.length || !body || !body.length) return false;
      body[0].innerHTML = _stmFreshHTML();
      const html = _stmProvChips();
      chips.forEach((el) => { el.outerHTML = html; });
      try { window.csvTxrHeadSync && window.csvTxrHeadSync(); } catch (e) {}
      return true;
    }
    function _stmProvChips() {
      const n = {}; _stmCards.forEach((c) => { const p = _stmProvOf(c); n[p] = (n[p] || 0) + 1; });
      const ps = Object.keys(n).sort(); if (ps.length < 2) { _stmProvF = null; return ''; }
      if (_stmProvF && !n[_stmProvF]) _stmProvF = null;
      const chip = (on, label, cnt, arg) => '<button type="button" class="ctp-chip' + (on ? ' on' : '') + '" onclick="fhStmtProvTgl(\'' + _escAttr(arg) + '\')">' + _esc(label) + ' <span class="ctp-n">' + cnt + '</span></button>';
      return '<div class="ctp-r stm-provs">' + chip(!_stmProvF, L('Tất cả', 'All'), _stmCards.length, '') + ps.map((p) => chip(_stmProvF === p, p, n[p], p)).join('') + '</div>';
    }
    /* Declutter (activation feedback 2026-09-24): the review body carries only
       the FRESH locked cards under one small header. The provider chips moved
       into the Chọn nhanh drawer (fhStmtPickChipsHTML) and the backlog moved
       into the toolbox as its own tool (fhStmtOldListHTML) — two rows of
       chrome off the top of every open. */
    function _stmFreshHTML() {
      const fresh = _stmCards.filter((c) => !c.backfill && (!_stmProvF || _stmProvOf(c) === _stmProvF));
      if (!fresh.length) return '';
      return '<div class="group-h attn">' + _esc(L('Sao kê', 'Statements')) + ' · ' + fresh.length + '</div>' +
        '<div class="csv-cards">' + fresh.map(_stmCardHTML).join('') + '</div>';
    }
    /* The wrapper stays while there is any fresh card, filtered out or not, so
       a chip tap has somewhere to repaint into; a backlog-only queue adds nothing. */
    window.fhStmtCardsHTML = function () {
      return _stmNotesHTML() + (_stmCards.some((c) => !c.backfill) ? '<div id="stm-cards">' + _stmFreshHTML() + '</div>' : '');
    };
    /* The line a staged statement leaves where its card stood: which statement,
       how many rows went into the queue, and the account they were filed under
       (the one thing the retired summary step said that the queue does not).
       "Xem" narrows the queue to those rows; ✕ only hides the line. */
    function _stmNoteAdd(X, res) {
      const bank = window.fhProviderName ? window.fhProviderName(X.card.source_provider) : X.card.source_provider;
      const kind = { ewallet: L('Ví', 'Wallet'), credit_card: L('Thẻ tín dụng', 'Credit card'), deposit: L('Tài khoản', 'Account') }[X.acct && X.acct.kind] || '';
      const tail = X.acct && X.acct.tail ? ' ••' + X.acct.tail : '';
      _stmNotes = _stmNotes.filter((n) => n.sid !== X.card.id);
      /* No-break spaces inside the account's name: when the line wraps on a phone
         it breaks before the account, never between the bank and its number. */
      _stmNotes.unshift({ sid: X.card.id, title: _stmTitle(X.card), n: res.n, acct: ((kind ? kind + ' ' : '') + bank + tail).replace(/ /g, '\u00a0'), born: X.auto ? _stmLoadSeq - 1 : _stmLoadSeq });
    }
    function _stmNotesHTML() {
      if (!_stmNotes.length) return '';
      return '<div class="csv-cards stm-notes">' + _stmNotes.map((n) =>
        '<div class="stm-note" data-stm-note="' + _escAttr(n.sid) + '">' +
          '<span class="stm-txt"><span class="stm-title">' + _esc(n.title) + '</span>' +
          '<span class="stm-sub">' + _esc(n.n
            ? L(n.n + ' khoản đã vào hàng chờ · ' + n.acct, n.n + ' rows added to the queue · ' + n.acct)
            : L('Không có khoản mới', 'No new rows')) + '</span></span>' +
          (n.n ? '<button type="button" class="stm-note-go" onclick="fhStmtNoteSee(\'' + _escAttr(n.sid) + '\')">' + _esc(L('Xem', 'View')) + '</button>' : '') +
          '<button type="button" class="bulk-x" aria-label="' + _escAttr(L('Ẩn dòng này', 'Hide this line')) + '" onclick="fhStmtNoteHide(\'' + _escAttr(n.sid) + '\')">✕</button>' +
        '</div>').join('') + '</div>';
    }
    function _stmNotesRepaint() {
      if (typeof window.csvStmtCardsRepaint === 'function') window.csvStmtCardsRepaint();
      else window.renderCsvReview && window.renderCsvReview();
    }
    window.fhStmtNotes = () => _stmNotes;
    window.fhStmtNoteHide = function (sid) { _stmNotes = _stmNotes.filter((n) => n.sid !== sid); _stmNotesRepaint(); };
    window.fhStmtNoteSee = function (sid) { if (typeof window.csvPickStmtOnly === 'function') window.csvPickStmtOnly(sid); };
    window.fhStmtPickChipsHTML = function () { return _stmProvChips(); };
    window.fhStmtOldCards = function () {
      return _stmCards.filter((c) => c.backfill && (!_stmProvF || _stmProvOf(c) === _stmProvF));
    };
    window.fhStmtOldListHTML = function () {
      const old = window.fhStmtOldCards();
      let h = '<div class="cts-h"><b>' + _esc(L('Sao kê cũ', 'Older statements')) + (old.length ? ' · ' + old.length : '') + '</b></div>';
      if (!old.length) return h + '<div class="ctp-m"><b>' + _esc(L('Không còn sao kê cũ nào.', 'No older statements left.')) + '</b></div>';
      h += '<div class="cts-sub">' + _esc(L('Sao kê tìm thấy khi đọc lịch sử email. Mở cái nào cần, bỏ cái nào không.',
        'Statements found while reading email history. Open what you need, dismiss the rest.')) + '</div>';
      return h + '<div class="csv-cards">' + old.map(_stmCardHTML).join('') + '</div>';
    };
    /* Kept for the bridge. Nothing reads _stmOldOpen since the backlog moved into
       the toolbox drawer (56 csvToolOpen('stmtold')), so the flip repaints nothing. */
    window.fhStmtToggleOld = function () { _stmOldOpen = !_stmOldOpen; };

    window.fhStmtDismiss = async function (id) {
      if (_stmArmed !== id) {
        /* Arm: this card's ✕ becomes "Bỏ?", a previously armed one goes back to ✕,
           and both revert after 3.5 s. Two button swaps, not two full repaints. */
        const was = _stmArmed; _stmArmed = id;
        const ok = (!was || _stmPatchArm(was)) && _stmPatchArm(id);
        if (!ok) window.renderCsvReview && window.renderCsvReview();
        setTimeout(() => { if (_stmArmed === id) { _stmArmed = null; if (!_stmPatchArm(id)) window.renderCsvReview && window.renderCsvReview(); } }, 3500);
        return;
      }
      _stmArmed = null;
      const card = _stmCards.find((c) => c.id === id);
      try {
        await _rpc('dismiss_statement_file', { p_statement_id: id });
        if (card && card.object_path) { try { await window.sb.storage.from(STM_BUCKET).remove([card.object_path]); } catch (e) {} }
        _stmCards = _stmCards.filter((c) => c.id !== id);
        _stmGridDel(card && card.meta && card.meta.file_sha256);
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

    /* ── the unlock cache: the opened grid, by file hash ──────────────────────
       Opening a locked statement is a download, a sealed-box open, a SHA-256 and
       a 100,000-hash key derivation. None of it changes between taps, and the
       file's identity IS its hash (file_sha256, sealed in the card's details and
       checked on open). So the cell grid the reader produced is kept for the
       session under that hash, and sealed under the personal key into IndexedDB
       for the next session, the twenty most recent. "Để sau" and back, a second
       tap, a backlog card reopened, a remembered password: none spins again. A
       committed or dismissed statement leaves the cache. The raw file is never
       stored -- only what the reader read -- and nothing is written while the
       personal key is locked. Writes are serialised so a delete can never land
       before the put it is meant to undo. */
    const STM_GRID_DB = 'fh-stmt', STM_GRID_STORE = 'grid', STM_GRID_MAX = 20;
    const _stmGridMem = new Map();                   // sha -> grid, this session
    function _stmGridMemSet(sha, grid) {
      if (_stmGridMem.has(sha)) _stmGridMem.delete(sha);
      _stmGridMem.set(sha, grid);
      while (_stmGridMem.size > STM_GRID_MAX) _stmGridMem.delete(_stmGridMem.keys().next().value);
    }
    function _stmGridIdb() {
      return new Promise((res, rej) => {
        if (typeof indexedDB === 'undefined') return rej(new Error('no idb'));
        let rq; try { rq = indexedDB.open(STM_GRID_DB, 1); } catch (e) { return rej(e); }
        rq.onupgradeneeded = () => { const db = rq.result; if (!db.objectStoreNames.contains(STM_GRID_STORE)) db.createObjectStore(STM_GRID_STORE); };
        rq.onsuccess = () => res(rq.result); rq.onerror = () => rej(rq.error);
      });
    }
    function _stmGridTx(mode, fn) {
      return _stmGridIdb().then((db) => new Promise((res, rej) => {
        const tx = db.transaction(STM_GRID_STORE, mode);
        let rq; try { rq = fn(tx.objectStore(STM_GRID_STORE)); } catch (e) { return rej(e); }
        tx.oncomplete = () => res(rq && typeof rq === 'object' && 'result' in rq ? rq.result : undefined);
        tx.onerror = () => rej(tx.error); tx.onabort = () => rej(tx.error);
      }));
    }
    let _stmGridQ = Promise.resolve();
    const _stmGridSeq = (fn) => { const p = _stmGridQ.then(fn, fn); _stmGridQ = p.catch(() => {}); return p; };
    async function _stmGridGet(sha) {
      if (!sha) return null;
      if (_stmGridMem.has(sha)) return _stmGridMem.get(sha);
      if (!(window.fhPersonalKeyReady && window.fhPersonalKeyReady())) return null;
      try {
        const rec = await _stmGridSeq(() => _stmGridTx('readonly', (st) => st.get(sha)));
        if (!rec || rec.uid !== _stmUid() || !rec.ct) return null;
        const grid = JSON.parse(new TextDecoder().decode(await window.fhPersonalDecBytes(rec.ct)));
        if (!Array.isArray(grid)) return null;
        _stmGridMemSet(sha, grid);
        return grid;
      } catch (e) { return null; }
    }
    function _stmGridPut(sha, grid) {
      if (!sha || !grid) return Promise.resolve();
      _stmGridMemSet(sha, grid);
      if (!(window.fhPersonalKeyReady && window.fhPersonalKeyReady())) return Promise.resolve();
      return _stmGridSeq(async () => {
        try {
          const ct = await window.fhPersonalEncBytes(new TextEncoder().encode(JSON.stringify(grid)));
          const rec = { sha: sha, uid: _stmUid(), at: Date.now(), ct: ct };
          await _stmGridTx('readwrite', (st) => st.put(rec, sha));
          const all = (await _stmGridTx('readonly', (st) => st.getAll())) || [];
          const old = all.filter((r) => r && r.sha).sort((a, b) => (b.at || 0) - (a.at || 0)).slice(STM_GRID_MAX);
          if (old.length) await _stmGridTx('readwrite', (st) => { old.forEach((r) => st.delete(r.sha)); });
        } catch (e) { /* no persistence only means a slower next session */ }
      });
    }
    function _stmGridDel(sha) {
      if (!sha) return Promise.resolve();
      _stmGridMem.delete(sha);
      return _stmGridSeq(() => _stmGridTx('readwrite', (st) => st.delete(sha)).catch(() => {}));
    }
    function _stmGridClear() {
      _stmGridMem.clear();
      return _stmGridSeq(() => _stmGridTx('readwrite', (st) => st.clear()).catch(() => {}));
    }
    window.fhStmtGridCached = (sha) => _stmGridMem.has(sha);

    /* ── one statement, card to rows, with no screen of its own ───────────────
       The steps below read and write only the run they are handed (`X`), never
       the screen, so two callers share them: the tap flow further down, which
       paints around them and can ask for a password or a column check, and the
       queue's own open (_stmAuto), which runs them unseen and leaves the card
       alone the moment anything would have to be asked.

       X = { card, bytes, ab, grid, cached, verified, password, localExt, parsed,
             keptMap, confirmedMap, acct, fresh, decidedCount, auto } */

    /* Download the sealed file, open the seal, and check it is THIS card's file. */
    async function _stmFetch(X) {
      const card = X.card;
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
      X.bytes = opened; X.verified = true;             // the hash matched: this grid may be kept under it
    }

    async function _stmGrid(X) {
      if (X.cached && X.grid) return X.grid;
      const ext = X.localExt || X.card.file_ext;
      if (ext === 'csv') {
        const u = X.bytes; let text;
        if (u[0] === 0xFF && u[1] === 0xFE) text = new TextDecoder('utf-16le').decode(u);
        else if (u[0] === 0xFE && u[1] === 0xFF) text = new TextDecoder('utf-16be').decode(u);
        else text = new TextDecoder('utf-8').decode(u);
        const p = window.fhParseCsvFile(text);
        return [p.headers].concat(p.rows);
      }
      // One copy of the bytes per open, however many passwords are tried on it.
      if (!X.ab) X.ab = X.bytes.buffer.slice(X.bytes.byteOffset, X.bytes.byteOffset + X.bytes.byteLength);
      return fhParseXlsxBuffer(X.ab, X.password || undefined);
    }

    /* Grid -> table -> proof. Throws what the reader throws ('xlsx_encrypted',
       'bad_password', ...); a file with no table comes back with `table: null`. */
    async function _stmRead(X) {
      const grid = await _stmGrid(X);
      /* Read from the verified file: keep the grid, so no tap on this card spins again. */
      if (X.verified && !X.cached) { X.cached = true; X.grid = grid; _stmGridPut(X.card.meta && X.card.meta.file_sha256, grid); }

      /* Reading order: the vocabulary, and when its proof does not pass, a reading
         the person confirmed before for this sender and header shape. */
      /* The sender is half of how the issuer profile is recognised (59
         STMT_ISSUERS): the same column names under another bank must not be
         read as this wallet's account ids. */
      const pctx = { provider: X.card.source_provider };
      let parsed = window.fhStmtParse(grid, null, pctx);
      X.keptMap = false;
      if (parsed.table && !parsed.proof.ok) {
        const kept = _stmMapGet(X.card.source_provider, parsed.sig);
        if (kept) { parsed = window.fhStmtParse(grid, kept, pctx); X.keptMap = !!parsed.table; }
      }
      X.parsed = parsed; X.grid = grid;
      return parsed;
    }
    /* Does the reading still need the person? Not when the arithmetic proves it,
       and not when they confirmed this very reading on an earlier statement: a
       file with no balance and no totals can never prove itself, and asking the
       same question every month is the chore the remembered mapping exists to
       remove (spec section 3.3, step 3). */
    const _stmNeedsAsk = (X) => !X.parsed.proof.ok && !X.keptMap;

    /* Which kind of account the statement belongs to: a wallet by provider, a card when
       the summary block speaks of debt, otherwise a deposit account. */
    function _stmAcctKind(X) {
      const prov = String(X.card.source_provider || '').toLowerCase();
      if (/momo|zalopay|shopeepay|viettel|vnpay/.test(prov)) return 'ewallet';
      const sum = X.parsed.summary || {};
      return (sum.prevDebt !== undefined || sum.endDebt !== undefined) ? 'credit_card' : 'deposit';
    }

    /* The account, and which rows are new to this person. Rows they already
       decided on (imported or removed) are not written again -- the one place a
       statement row is dropped unseen, allowed because the key is exact and the
       decision was theirs. */
    async function _stmPlan(X) {
      const p = X.parsed, sum = p.summary || {};
      const tail = sum.accountTail || (X.card.meta && X.card.meta.account_tail) || '';
      X.acct = { provider: X.card.source_provider, kind: _stmAcctKind(X), tail: tail };
      const fps = await _stmBatched(p.rows, (r) => _stmFp(fhStmtCanonical(X.card.source_provider, tail, r)));
      let decided = new Set();
      try {
        /* 50 at a time: a fingerprint is 44 base64 characters and rides in the URL
           (`row_fp=in.(...)`), so a 145-row statement in one request is a ~9 KB query
           string, which is where proxies start refusing. */
        for (let i = 0; i < fps.length; i += 50) {
          const q = await window.sb.from('resolved_statement_rows').select('row_fp').in('row_fp', fps.slice(i, i + 50));
          if (q.error && X.auto) throw q.error;
          (q.data || []).forEach((x) => decided.add(x.row_fp));
        }
      } catch (e) {
        /* On a tap the rows are shown rather than held back. Unseen, a failed
           lookup stops the run instead: staging rows the person already removed,
           with nobody watching, is worse than waiting for the next open. */
        if (X.auto) throw e;
        decided = new Set();
      }
      X.fresh = [];
      p.rows.forEach((r, i) => { if (!decided.has(fps[i])) X.fresh.push({ r: r, fp: fps[i] }); });
      X.decidedCount = p.rows.length - X.fresh.length;
    }

    /* Merchant names only -- never a person, an amount or a date -- to the
       merchant-concepts function. Best-effort: a limited model just means those rows
       arrive without a category. `gate.closed` drops an answer that comes back
       after the caller stopped waiting, so it cannot land on rows already sealed. */
    async function _stmConcepts(payloads, gate) {
      const names = [...new Set(payloads.filter((p) => !p.person && !p.concept && p.amt < 0 && p.flow !== 'cardpay' && !p.xfer && (p.counterparty || p.memo))
        .map((p) => String(p.counterparty || p.memo).slice(0, 80)))].slice(0, 60);
      if (!names.length) return;
      try {
        const res = await window.sb.functions.invoke('merchant-concepts', { body: { merchants: names } });
        if (gate && gate.closed) return;
        const map = (res && res.data && res.data.concepts) || {};
        const nodeMap = (res && res.data && res.data.nodes) || {};   // 0144 — the tree node beside the legacy concept
        payloads.forEach((p) => {
          const key = String(p.counterparty || p.memo).slice(0, 80);
          const c = map[key]; if (c && !p.concept) p.concept = c;
          const nd = nodeMap[key]; if (nd && !p.node && window.FH_TAX && FH_TAX.get(nd)) p.node = nd;
        });
      } catch (e) { /* rows simply arrive without a hint */ }
    }

    /* Write the rows and close the card. `say(text)` is told what is happening.
       Returns { n } = rows written. Throws with nothing half-done: the rows and
       the card change state in ONE transaction. */
    async function _stmWrite(X, say) {
      const card = X.card; say = say || (() => {});
      if (X.confirmedMap && X.parsed.table) _stmMapSet(card.source_provider, X.parsed.sig, X.parsed.table.roles);
      if (X.acct && window.fhPersonalAccountEnsure) {
        try {
          const acctId = await window.fhPersonalAccountEnsure({ kind: X.acct.kind, provider: X.acct.provider, tail: X.acct.tail,
            name: (window.fhProviderName ? window.fhProviderName(X.acct.provider) : X.acct.provider) + (X.acct.tail ? ' ••' + X.acct.tail : '') });
          /* A statement KNOWS what its account is: a running balance is a deposit
             account, a debt summary is a card. The email classifier only guessed, and
             it filed a real VIB account as a credit card. Correct a guessed kind; leave
             one the person set themselves (human_verified) alone. */
          const acct = acctId && window.fhPersonalData ? (window.fhPersonalData().accounts || []).find((a) => a.id === acctId) : null;
          if (acct && acct.kind !== X.acct.kind && !acct.humanVerified && window.fhPersonalAccountUpdate) {
            try { await window.fhPersonalAccountUpdate(acctId, { kind: X.acct.kind }); acct.kind = X.acct.kind; } catch (e) {}
          }
        } catch (e) {}
      }
      const stitle = _stmTitle(card);
      const payloads = X.fresh.map((x) => Object.assign(fhStmtRowPayload(x.r, X.acct, card.id), { fp: x.fp, stitle: stitle }));
      say(L('Đang gợi ý danh mục…', 'Suggesting categories…'));
      if (X.auto) {
        /* Nobody is watching a spinner here, they are waiting for their queue: the
           hint gets a few seconds, and rows it misses are placed by the review's
           own cascade like any row a limited model left bare. */
        const gate = { closed: false };
        await Promise.race([_stmConcepts(payloads, gate), new Promise((r) => setTimeout(r, STM_AUTO_HINT_MS))]);
        gate.closed = true;
      } else await _stmConcepts(payloads);
      const rows = new Array(payloads.length);
      for (let i = 0; i < payloads.length; i += STM_BATCH) {
        say(L('Đang mã hoá ' + (i + 1) + '/' + payloads.length + '…', 'Encrypting ' + (i + 1) + '/' + payloads.length + '…'));
        await Promise.all(payloads.slice(i, i + STM_BATCH).map(async (pl, k) => {
          rows[i + k] = { id: crypto.randomUUID(), row_index: i + k, txn_date: pl.date, payload_enc: await _stmEncJson(pl) };
        }));
        await _stmYield();
      }
      say(L('Đang đưa vào hàng chờ…', 'Adding to the queue…'));
      /* ONE transaction: every row, and the card marked opened. A dropped connection
         leaves the card as it was and no partial rows. A second device that got
         there first makes this a no-op (0139), and the queue reads that device's rows. */
      await _rpc('stage_statement_rows', { p_statement_id: card.id, p_rows: rows });
      /* The queue will read these very rows next; it already holds their plaintext. */
      rows.forEach((r, i) => _stmRowCacheSet(r.id, r.payload_enc, payloads[i]));
      _stmGridDel(card.meta && card.meta.file_sha256);   // the statement is in; its grid has no job left
      /* The rows are in. The sealed file has no job left, so it goes NOW (decision
         S13); the worker's sweep is only the net for a delete that fails here. */
      if (card.object_path) { try { await window.sb.storage.from(STM_BUCKET).remove([card.object_path]); } catch (e) {} }
      /* The statement's balance needs no step of its own here. Every row carries its
         running balance (raw_extracted.balance), and the import already records the
         newest one per account as the bank-stated balance (72 _recBal ->
         fhPersonalExtBalanceSet). From there the existing surfaces take over: an
         account with no anchor is asked for one by the post-import setup, and one
         with an anchor shows the drift badge with its two resolutions. */
      _stmCards = _stmCards.filter((c) => c.id !== card.id);
      return { n: rows.length };
    }

    /* ── no tap at all: a fresh statement that asks nothing stages itself ─────
       (decision S31.) When the review queue opens, each statement that arrived
       since the mailbox was connected is tried here, before the queue paints. One
       that needs nothing from the person -- the file is not locked, or its
       password is remembered on this device, or it was unlocked earlier and its
       grid is kept; and its column reading is proved or was confirmed before --
       becomes rows in this very open. Anything else is left exactly as it was: a
       card, waiting for a tap.

       Never the history backlog ("Sao kê cũ", S11): a first connect can find
       dozens of old statements, and the person decides when each one expands.
       Never more than STM_AUTO_MAX files in one open, and no new file is started
       once STM_AUTO_MS has passed: the person asked for their queue, not for a
       wait.

       WHY A CARD WAS LEFT is remembered per card on this device only when
       finding it out costs a download: 'password' (locked, and no password that
       works is remembered) and 'unsupported' (a lock or a format this device
       cannot read). A locked card is tried again once a password for its bank is
       remembered. A reading that needs confirming leaves no mark: its grid is
       kept, so asking again is free. A failure that may pass (offline, a dropped
       request) is retried in the next session, not on every open of this one. */
    const STM_AUTO_MAX = 2, STM_AUTO_MS = 8000, STM_AUTO_HINT_MS = 4000;
    const _stmAutoKey = () => { const u = _stmUid(); return u ? 'fh-stmt-auto:' + u : ''; };
    function _stmAutoGet() { try { return JSON.parse(localStorage.getItem(_stmAutoKey()) || '{}') || {}; } catch (e) { return {}; } }
    function _stmAutoSet(m) { const k = _stmAutoKey(); if (!k) return; try { localStorage.setItem(k, JSON.stringify(m)); } catch (e) {} }
    const _stmAutoTried = new Set();

    /* One card. Resolves { n } when its rows were written, { left: why } when it
       needs the person (why is '' when nothing is worth remembering). Throws on a
       failure that may pass. */
    async function _stmAutoOne(card, why) {
      const X = { card: card, auto: true, bytes: null, password: '', parsed: null, acct: null };
      const kept = await _stmGridGet(card.meta && card.meta.file_sha256);
      if (kept) { X.grid = kept; X.cached = true; }
      else {
        const pw = await _stmPwGet(card.source_provider);
        if (why === 'password' && !pw) return { left: 'password' };   // still locked, still no password: not worth the download
        await _stmFetch(X);
        X.password = pw;
      }
      let parsed;
      try { parsed = await _stmRead(X); }
      catch (e) {
        const code = String(e && e.message || '');
        if (code === 'bad_password') { await _stmPwSet(card.source_provider, ''); return { left: 'password' }; }   // a remembered password stopped working
        if (code === 'xlsx_encrypted') return { left: 'password' };
        if (code === 'xlsx_enc_unsupported' || code === 'xls_legacy' || code === 'xlsx_unsupported') return { left: 'unsupported' };
        throw e;
      }
      if (!parsed.table || !parsed.rows.length || _stmNeedsAsk(X)) return { left: '' };
      await _stmPlan(X);
      const res = await _stmWrite(X);
      _stmNoteAdd(X, res);
      return res;
    }

    /* Every open of the queue shares one pass: a second open while the first is
       still writing waits for it instead of staging the same file twice. */
    let _stmAutoBusy = null;
    function _stmAuto(cards, say) {
      if (_stmAutoBusy) return _stmAutoBusy;
      _stmAutoBusy = (async () => {
        const done = [], t0 = Date.now(), memo = _stmAutoGet();
        let dirty = false;
        const live = new Set(cards.map((c) => c.id));
        Object.keys(memo).forEach((k) => { if (!live.has(k)) { delete memo[k]; dirty = true; } });
        for (const card of cards) {
          if (done.length >= STM_AUTO_MAX || Date.now() - t0 > STM_AUTO_MS) break;
          if (card.backfill || card.status !== 'pending' || card.keyLocked || !card.meta || !card.object_path) continue;
          if (_stmAutoTried.has(card.id) || memo[card.id] === 'unsupported') continue;
          if (S && S.card && S.card.id === card.id) continue;        // the person is in this one right now
          window.fhHeat && window.fhHeat.tick('fhStmtAuto');
          try { say && say(L('Đang đọc ', 'Reading ') + _stmTitle(card) + '…'); } catch (e) {}
          try {
            const r = await _stmAutoOne(card, memo[card.id] || '');
            if (r && r.left !== undefined) {
              if (r.left && memo[card.id] !== r.left) { memo[card.id] = r.left; dirty = true; }
              continue;
            }
            if (memo[card.id]) { delete memo[card.id]; dirty = true; }
            done.push({ sid: card.id, n: r.n });
          } catch (e) { _stmAutoTried.add(card.id); }
        }
        if (dirty) _stmAutoSet(memo);
        return done;
      })();
      const p = _stmAutoBusy;
      p.then(() => { if (_stmAutoBusy === p) _stmAutoBusy = null; }, () => { if (_stmAutoBusy === p) _stmAutoBusy = null; });
      return p;
    }

    /* ── the tap flow ──────────────────────────────────────────────────────────
       For a card the queue's open left alone, and for every card under "Sao kê
       cũ". Painted INTO the review's own body (#csv-result), like the file
       import's password step: the global sheet layer sits under this modal. `S` is
       the one statement being opened.

       There is no summary step (decision S30, 2026-10-10). It used to stand between
       the reading and the queue: a count, the account, forty rows and a button.
       The rows it guarded go to the REVIEW queue, where every one of them is
       looked at before "Nhập"; the arithmetic proof is what decides whether the
       reading is believed, and a reading it cannot prove still stops and asks. So
       the flow ends the moment nothing is left to ask, and says what it did in
       one line where the card stood (_stmNoteAdd). */
    let S = null;
    const _stmHost = () => document.getElementById('csv-result');
    /* Every step of the flow paints through here, so the takeover belongs here
       too: the toolbox drawer this statement was very likely opened FROM ("Sao
       kê cũ" is the only door to a backlog card) lays a scrim over this very
       element, and a scrim eats the password field's taps. 56's csvStepTakeover
       hides the drawer, the row sheet, the header and Import in one call; its
       counterpart is renderCsvReview, which restores them once S is null. */
    function _stmPaint(inner) {
      try { window.csvStepTakeover && window.csvStepTakeover(); } catch (e) {}
      const h = _stmHost(); if (h) h.innerHTML = '<div class="csv-unlock stm-flow">' + inner + '</div>';
    }
    /* The one predicate 56 asks before repainting the review body. */
    window.fhStmtFlowActive = () => !!S;
    /* A fresh open of the queue abandons a half-finished step (72 calls this), so
       a flow left behind by a closed modal can never hold the body hostage. */
    window.fhStmtFlowReset = function () { S = null; };
    function _stmHead(title, sub) { return '<div class="csv-unlock-title">' + _esc(title) + '</div>' + (sub ? '<div class="csv-unlock-sub">' + _esc(sub) + '</div>' : ''); }
    function _stmBusyLine(txt) { return '<div class="stm-wait"><span class="stm-spin" aria-hidden="true"></span><span id="stm-say">' + _esc(txt) + '</span></div>'; }
    function _stmBackBtn() { return '<button type="button" class="csv-linkbtn csv-unlock-skip" onclick="fhStmtCancel()">' + _esc(L('Để sau', 'Not now')) + '</button>'; }
    window.fhStmtCancel = function () { S = null; window.renderCsvReview && window.renderCsvReview(); };

    window.fhStmtOpen = async function (id) {
      const card = _stmCards.find((c) => c.id === id); if (!card) return;
      const X = S = { card: card, bytes: null, password: '', remember: false, parsed: null, acct: null };
      if (card.status === 'expired') return _stmAskFile();
      /* Opened before, this session or an earlier one: the grid is at hand, so
         there is nothing to fetch, unseal or derive. Straight to the table. */
      const kept = await _stmGridGet(card.meta && card.meta.file_sha256);
      if (S !== X) return;                               // cancelled or reset while the store answered
      if (kept) { X.grid = kept; X.cached = true; return _stmParse(); }
      _stmPaint(_stmHead(_stmTitle(card)) + _stmBusyLine(L('Đang tải file…', 'Fetching the file…')));
      try { await _stmFetch(X); }
      catch (e) {
        if (S !== X) return;
        return _stmFail(e && e.message === 'identity'
          ? L('File không khớp với sao kê này nên tụi mình không mở.', 'The file does not match this statement, so it stays closed.')
          : L('Chưa tải được file. Thử lại, hoặc chọn file từ máy.', 'Could not fetch the file. Try again, or pick it from your device.'), true);
      }
      if (S !== X) return;
      X.password = await _stmPwGet(card.source_provider);
      if (S !== X) return;
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
      S.ab = null; S.grid = null; S.cached = false; S.verified = false;   // a file from the device is not checked against the hash, so it is not kept
      S.localExt = /\.csv$/i.test(f.name) ? 'csv' : 'xlsx';
      return _stmParse();
    };

    async function _stmParse(wrong) {
      const X = S; if (!X) return;
      let parsed;
      try { parsed = await _stmRead(X); }
      catch (e) {
        if (S !== X) return;
        const code = String(e && e.message || '');
        if (code === 'xlsx_encrypted' || code === 'bad_password') {
          if (code === 'bad_password' && X.password && !wrong) { await _stmPwSet(X.card.source_provider, ''); }   // a remembered password stopped working
          return _stmAskPassword(code === 'bad_password' && (wrong || X.password));
        }
        if (code === 'xlsx_enc_unsupported' || code === 'xls_legacy') return _stmFail(L('Kiểu khoá của file này tụi mình chưa mở được.', 'This file is locked in a way we cannot open yet.'), false);
        if (code === 'xlsx_unsupported') return _stmFail(L('Trình duyệt chưa đọc được file Excel. Cập nhật rồi thử lại nhé.', 'This browser cannot read Excel files. Update it and try again.'), false);
        return _stmFail(L('Chưa đọc được file này.', 'Could not read this file.'), false);
      }
      if (S !== X) return;
      if (X.remember && X.password) await _stmPwSet(X.card.source_provider, X.password);
      if (S !== X) return;
      if (!parsed.table || !parsed.rows.length) return _stmFail(L('Không thấy bảng giao dịch trong file này.', 'No transaction table found in this file.'), false);
      if (_stmNeedsAsk(X)) return _stmAskMapping();
      return _stmGo();
    }

    function _stmAskPassword(wrong) {
      const bank = window.fhProviderName ? window.fhProviderName(S.card.source_provider) : S.card.source_provider;
      _stmPaint(_stmHead(L('File này có mật khẩu', 'This file needs a password'), _stmTitle(S.card)) +
        '<input id="stm-pw" type="password" class="csv-pw" autocomplete="off" placeholder="' + _escAttr(L('Nhập mật khẩu mở file', 'Enter the password')) + '" onkeydown="if(event.key===\'Enter\'){event.preventDefault();fhStmtUnlock();}">' +
        (wrong ? '<div class="csv-unlock-err">' + _esc(L('Mật khẩu chưa đúng, thử lại nhé', 'That password didn\'t work, try again')) + '</div>' : '') +
        '<label class="stm-remember"><input type="checkbox" id="stm-rem"' + (S.remember ? ' checked' : '') + '> <span>' + _esc(L('Nhớ mật khẩu sao kê ' + bank + ' trên máy này', 'Remember ' + bank + ' statement password on this device')) + '</span></label>' +
        '<button type="button" class="btn-line csv-unlock-go" onclick="fhStmtUnlock()">' + _esc(L('Mở file', 'Unlock')) + '</button>' +
        '<div class="csv-unlock-note">' + _esc(L('Mật khẩu chỉ dùng trên máy bạn, không gửi đi đâu. Nếu chọn nhớ, tụi mình giữ nó trên máy này, có mã hoá, và sao kê ' + bank + ' lần sau tự vào hàng chờ.', 'The password stays on your device and is never sent anywhere. If you choose to remember it, it is kept on this device, encrypted, and the next ' + bank + ' statement goes into the queue by itself.')) + '</div>' + _stmBackBtn());
      const el = document.getElementById('stm-pw'); if (el) { try { el.focus(); } catch (e) {} }
    }
    window.fhStmtUnlock = function () {
      if (!S) return;
      const el = document.getElementById('stm-pw'), rem = document.getElementById('stm-rem');
      S.password = el ? el.value : ''; S.remember = !!(rem && rem.checked);
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
        '<div class="csv-unlock-note">' + _esc(L(p.rows.length + ' giao dịch. Bấm "Đúng rồi" là vào hàng chờ duyệt, chưa ghi vào sổ.', p.rows.length + ' transactions. "Looks right" sends them to the review queue, not to the ledger.')) + '</div>' +
        '<button type="button" class="btn-line csv-unlock-go" onclick="fhStmtMappingOk()">' + _esc(L('Đúng rồi', 'Looks right')) + '</button>' + _stmBackBtn());
    }
    window.fhStmtMappingOk = function () { if (S && S.parsed) { S.confirmedMap = true; return _stmGo(); } };

    /* Nothing is left to ask: the rows go to the queue. Encrypting a hundred-odd
       rows and one round trip take a few seconds on a phone, so the step says what
       it is doing as it goes, and offers no way out until it ends: a write cannot
       be half-abandoned. However many times it is called, ONE write. */
    async function _stmGo() {
      const X = S; if (!X || !X.parsed || X.committing) return;
      X.committing = true;
      const title = _stmTitle(X.card);
      _stmPaint(_stmHead(title, L('Vào hàng chờ duyệt, chưa ghi vào sổ.', 'Goes to the review queue, not to the ledger.')) + _stmBusyLine(L('Đang chuẩn bị…', 'Getting ready…')));
      const say = (txt) => { if (S !== X) return; const e = document.getElementById('stm-say'); if (e) e.textContent = txt; };
      let res;
      try { await _stmPlan(X); res = await _stmWrite(X, say); }
      catch (e) {
        X.committing = false;
        if (S !== X) return;
        _stmPaint(_stmHead(title) + '<div class="csv-unlock-err">' + _esc(L('Chưa lưu được, thử lại nhé', 'Could not save, try again')) + '</div>' +
          '<button type="button" class="btn-line csv-unlock-go" id="stm-go" onclick="fhStmtCommit()">' + _esc(L('Thử lại', 'Try again')) + '</button>' + _stmBackBtn());
        return;
      }
      _stmNoteAdd(X, res);
      window.toast && window.toast(res.n ? L('Đã thêm ' + res.n + ' khoản vào hàng chờ', res.n + ' rows added to the queue') : L('Sao kê này không có khoản mới', 'No new rows in this statement'));
      /* The modal was closed on the write and the queue opened again meanwhile:
         that open owns the screen now. The rows are in; its next load shows them. */
      if (S !== X) { try { window.fhRefreshStagedCount && window.fhRefreshStagedCount(); } catch (e) {} return; }
      S = null;
      window.fhTxnReviewSheet && window.fhTxnReviewSheet(window.csvEntryScope);
    }
    /* The retry button's handler, and the name every caller has always used. */
    window.fhStmtCommit = function () { return _stmGo(); };

    /* Disconnecting the mailbox deletes what capture stored: the parsed rows, the
       cards, the sealed files, and the two on-device memories. */
    window.fhStmtPurge = async function () {
      try {
        const paths = await _rpc('purge_my_statements', {});
        if (paths && paths.length) { try { await window.sb.storage.from(STM_BUCKET).remove(paths); } catch (e) {} }
      } catch (e) {}
      try { localStorage.removeItem(_stmPwKey()); localStorage.removeItem(_stmMapKey()); localStorage.removeItem(_stmRetKey()); localStorage.removeItem(_stmAutoKey()); } catch (e) {}
      _stmCards = []; _stmNotes = []; _stmRowCache.clear();
      await _stmGridClear();
    };
  })();