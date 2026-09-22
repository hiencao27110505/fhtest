  // ═══ bank-email: review staged transactions ═══════════════════════════════
  /* The queue of transactions the pipeline extracted from forwarded bank email,
     waiting for a human before they enter the ledger.

     Reuses the CSV import review screen wholesale rather than building a second
     one. The job is identical — look at rows, fix the description, set a
     category, import — and that screen already solves the hard parts: merchant
     grouping, category suggestions from history, duplicate detection, the
     attention section, and a promotion path (submitBulk -> addExpense) that is
     already encryption-correct. A parallel implementation would drift from it
     within a month.

     The adaptation is to hand it rows shaped like a parsed CSV. Everything
     downstream then works unchanged.

     WHY EVERY ROW IS REVIEWED, never auto-imported: the machine can get amount,
     date and counterparty right, but it cannot know that "NGUYEN THU TRANG
     chuyen tien" was lunch with your mum. The description is the reason this
     screen exists, so pre-filling it is help, not a substitute. */

  /* How many staged rows one open of the queue fetches.
  
     200 was written when a queue meant a handful of forwarded emails. Direct
     read changed the shape of the problem: a first connect reaches back as far
     as the person chose — up to a year — and a real mailbox produced 210 rows
     from 90 days on the first go. The cap silently hid the oldest ten.
  
     Silently is the part that mattered. There was no "showing 200 of 210" and
     no next page, so the hidden rows would reappear only as the person promoted
     enough to drop below the cap — which reads as transactions arriving late
     rather than as a page boundary.
  
     Raised to cover the worst case the backfill window can produce: 365 days at
     the busiest observed rate (~66 a month) is ~800. The cost is bounded and
     local — each row is a sealed box opened on this device, and the loop below
     already handles them one at a time — so the ceiling is the person's
     patience with a long list, which the review screen's own grouping is what
     addresses. A cap that hides rows is worse than a list that is long. */
  var TXN_REVIEW_PAGE = 1000;

  /* Rows this device has already promoted, held locally until the server agrees
     they are gone.

     Retirement is a server-side DELETE (0060). When that call fails — the
     migration is not applied, the network dropped, the RPC errored — the row
     comes back on the next open and the queue looks like the import never
     happened. The real damage is not the clutter: pressing Import again writes
     the SAME transaction to the ledger a SECOND time, and nothing downstream
     would ever catch that.

     So the client remembers what it promoted. The queue then reads correctly
     whether or not the delete landed, and the same row cannot be imported twice
     while the server catches up.

     Per member, because a shared device has separate queues per seat. Pruned
     against what the server actually returns, so it can never grow without
     bound: once a row stops coming back it has really gone, and remembering it
     is pointless. */
  function _stagedRetiredKey() {
    var mid = (window.DB && window.DB.ownerMemberId) || '';
    return mid ? 'fh-staged-retired:' + mid : '';
  }
  function _stagedRetiredGet() {
    try {
      var k = _stagedRetiredKey(); if (!k) return [];
      var v = JSON.parse(localStorage.getItem(k) || '[]');
      return Array.isArray(v) ? v : [];
    } catch (e) { return []; }
  }
  function _stagedRetiredAdd(ids) {
    try {
      var k = _stagedRetiredKey(); if (!k || !ids || !ids.length) return;
      var set = _stagedRetiredGet();
      ids.forEach(function (id) { if (id && set.indexOf(id) === -1) set.push(id); });
      localStorage.setItem(k, JSON.stringify(set));
    } catch (e) {}
  }
  function _stagedRetiredPrune(serverIds) {
    try {
      var k = _stagedRetiredKey(); if (!k) return;
      var live = _stagedRetiredGet().filter(function (id) { return serverIds.indexOf(id) !== -1; });
      localStorage.setItem(k, JSON.stringify(live));
    } catch (e) {}
  }

  /* Fetches this member's pending rows. 0058 scopes SELECT to own rows, so no
     filtering is needed here — the database decides what is visible, which is
     also why an empty result is a real answer and not a permissions bug.

     Columns are named, not '*', for one reason: raw_body. It holds the full
     email HTML at ~20KB a row, nothing on this screen reads it, and pulling it
     on every open of the queue is what was eating the Supabase bandwidth quota.
     Everything else the two row shapes carry is listed — including
     gmail_message_id, which the sealed path verifies against the payload. */
  /* NOTICES ARE NOT TRANSACTIONS (email-reading-v2-spec §6). A card due notice or
     a "statement ready" mail is staged in this same table with the clear column
     row_kind = 'notice' (0147). It moves no money, so it must never be a review
     card and never count toward "N khoản chờ duyệt": every reader of the pending
     queue goes through this one helper.

     The client ships BEFORE the migration, so the column may not exist yet. The
     first query asks with the filter; if the database answers "no such column"
     the helper remembers that for the session and every later query skips the
     filter (until the column exists every row is a transaction, which is exactly
     what an unfiltered read returns). A NULL row_kind reads as 'txn'.

     `build(f)` must apply f() to the query BEFORE any order/limit: PostgREST
     filters are not available on a query once it has been ordered. */
  var _fhRowKindCol;   // undefined: not asked yet · true: the column is there · false: not yet
  function _fhRowKindMissing(err) {
    if (!err) return false;
    return String(err.code || '') === '42703' || /row_kind/i.test(String(err.message || '') + ' ' + String(err.details || ''));
  }
  async function fhStagedTxnOnly(build) {
    if (_fhRowKindCol !== false) {
      var res = await build(function (q) { return q.or('row_kind.is.null,row_kind.neq.notice'); });
      if (!res || !res.error) { _fhRowKindCol = true; return res; }
      if (!_fhRowKindMissing(res.error)) return res;
      _fhRowKindCol = false;
    }
    return build(function (q) { return q; });
  }
  window.fhStagedTxnOnly = fhStagedTxnOnly;

  async function fhFetchStagedTxns() {
    var res = await fhStagedTxnOnly(function (txnOnly) { return txnOnly(sb.from('email_transactions')
      .select('id,member_id,owner_user_id,staging_scope,gmail_message_id,source_provider,occurred_at,amount,currency,direction,counterparty,reference_number,transaction_type,raw_extracted,duplicate_of_id,resolved_before,sealed,eph_pub,nonce,enc_v,created_at')
      .eq('review_status', 'pending'))
      /* duplicate_of_id is a SUSPICION, not a delete order. It used to be
         filtered out here, which gave a guess made blind at 3am the power to
         hide a real transaction AND cancel its notification, with no screen
         showing it and no button to undo it. That is how a genuine 2.000đ
         transfer disappeared: two MB emails, three spellings of one bank name.

         The detection is worth keeping — the pipeline sees a pair the client
         cannot (two unreviewed emails, same amount, different wording). The
         AUTHORITY was the bug. The rows come back now and land in the review
         screen's "Có thể trùng" bucket, which already knows how to ask. */
      .order('occurred_at', { ascending: false })
      .limit(TXN_REVIEW_PAGE); });
    if (res.error) throw res.error;
    var rows = res.data || [];
    /* True pending total for the badge and the "N of M" header. Only when the
       page comes back FULL could there be more than we fetched, so the exact
       count is a separate head-only query paid for just in that case; a queue
       under the cap already knows its own size. The projection above stays
       column-named and raw_body-free — the sealing test guards it — so the
       count cannot ride along on that select. */
    if (rows.length >= TXN_REVIEW_PAGE) {
      try {
        var cnt = await fhStagedTxnOnly(function (txnOnly) { return txnOnly(sb.from('email_transactions')
          .select('id', { count: 'exact', head: true })
          .eq('review_status', 'pending')); });
        window.fhStagedTotal = (cnt && typeof cnt.count === 'number') ? cnt.count : rows.length;
      } catch (e) { window.fhStagedTotal = rows.length; }
    } else {
      window.fhStagedTotal = rows.length;
    }
    // Prune first, against the full server answer, so the local list shrinks as
    // the server catches up rather than accumulating ids nobody will ever see.
    var serverIds = rows.map(function (r) { return r.id; });
    _stagedRetiredPrune(serverIds);
    var retired = _stagedRetiredGet();
    if (!retired.length) return rows;
    return rows.filter(function (r) { return retired.indexOf(r.id) === -1; });
  }

  /* Badge count for the "Khoản thu chi từ email" CTA in Widget A. A cheap pending-rows
     query — 0058's RLS returns [] for anyone without a mailbox, so it is safe to call for
     every user. Cached on window and pushed to the CTA renderer. */
  window.fhStagedCount = 0;
  window.fhRefreshStagedCount = async function () {
    try { var rows = await fhFetchStagedTxns(); window.fhStagedCount = (typeof window.fhStagedTotal === 'number') ? window.fhStagedTotal : (rows || []).length; }
    catch (e) { window.fhStagedCount = 0; }
    // Statement rows and unopened statement cards wait in the same queue, so the
    // same badge counts them. Head-only, and never allowed to zero the email count.
    try { if (window.fhStmtPendingCount) window.fhStagedCount += (await window.fhStmtPendingCount()) || 0; } catch (e) {}
    try { if (typeof window.renderCashflowEmailCta === 'function') window.renderCashflowEmailCta(); } catch (e) {}
    // The Cá nhân tab carries the same CTA and the same badge; it has to hear
    // the count change too, or one of the two goes stale after every promote.
    try { if (typeof window.renderPersonal === 'function') window.renderPersonal(); } catch (e) {}
    // Notices never reach the queue: applied to their account and retired, quietly
    // (fhNoticesApply throttles itself and never blocks the badge).
    try { if (window.fhNoticesApply) window.fhNoticesApply(); } catch (e) {}
  };

  /* The always-visible "Khoản thu chi từ email" CTA routes by setup state:
       • no linked email  → the setup intro (null state + "Get started" CTA)
       • linked           → the review sheet, which itself shows an empty modal
                            when there is nothing, or the list of cards. */
  window.fhEmailTxnCta = async function (preset) {
    /* Consent moved on (v5: statement files)? Offer it here, once a session, without
       blocking: both answers carry on into this same function (75-consent-ui.js). */
    if (window.fhConsentOffer) {
      try { if (!(await window.fhConsentOffer(function () { window.fhEmailTxnCta(preset); }))) return; } catch (e) {}
    }
    /* The entry SOURCE is the context. Opening from the Cá nhân tab means "these
       are mine" and defaults the cards to the personal ledger — the same affordance
       openPersonalExpense() gives the expense modal; opening from a space (family)
       ledger defaults them to that space. Carried as a per-open descriptor (never
       persisted) and applied at the sheet, so the source is always the source of
       truth and neither tab's choice leaks into the other's next open. A future
       space (trip/friends) passes its own {kind:'space', id} and reuses this
       screen unchanged. A personal context on a locked ledger is handled at the
       card default (csvStagedScope falls back to the space), so nothing is refused
       on the tap here. */
    var ctx = window.fhNormScope ? window.fhNormScope(preset && preset.scope) : null;
    /* BOTH transports count as set up, and checking only one was a real bug:
       this asked about the forwarding alias alone, so someone already connected
       by OAuth — no alias, a perfectly working mailbox, transactions arriving —
       was sent to the forwarding setup screen and told to paste a filter into
       Gmail. Either one means "you are set up"; neither means "pick one".

       Asked in parallel because they are independent round trips and this runs
       on a tap; one being slow must not add to the other. Each defaults to
       false on failure, which routes to the chooser — offering setup to someone
       who already has it is a recoverable annoyance, while hiding the queue
       from someone whose mail is arriving is not. */
    var fwd = false, oauth = false;
    await Promise.all([
      (async () => {
        try { var st = window.fhMailboxState ? await window.fhMailboxState() : null; fwd = !!(st && st.forwarding_alias); } catch (e) {}
      })(),
      (async () => {
        try { var c = window.fhAutoTxnConnection ? await window.fhAutoTxnConnection() : null; oauth = !!c; } catch (e) {}
      })(),
    ]);

    /* HELD WHILE A FIRST READ IS STILL RUNNING. This is the door that matters:
       holding someone on the connect sheet does nothing while this row sits on
       the Finance tab (and on Cá nhân) routing straight into the queue.

       The reason is correctness, not tidiness. csvBuildReview's duplicate
       bucketing compares the rows it FETCHED. One purchase often produces two
       emails — a bank debit and a wallet receipt — sharing no identifier but an
       amount; mid-backfill the twin may not be staged yet, so neither is
       flagged and both get imported. The quick-select counts are wrong against
       a partial set for the same reason.

       Sends them to the progress screen instead of refusing: it says how far
       back the read has got and opens the queue itself the moment it finishes.
       `oauth` is re-used rather than re-fetched — _atxConnection already ran
       above and caches the phase. Forwarding has no first pass, so a
       forwarding-only member is never held. */
    /* A DEAD GRANT INTERCEPTS TOO. They came asking for their transactions;
       the honest answer is why there are none, and the way to get them back.
       Opening a queue that stopped filling days ago answers neither. */
    if (oauth && window.fhReauthState && window.fhReauthState()) {
      const c = window.fhAutoTxnConnection ? await window.fhAutoTxnConnection() : null;
      if (c && c.needsReauth && window.fhAutoTxnStatus) return window.fhAutoTxnStatus(c);
    }

    if (oauth && window.fhBackfillHolds && window.fhBackfillHolds()) {
      return window.fhAutoTxnStatus
        ? window.fhAutoTxnStatus(await window.fhAutoTxnConnection())
        : (window.fhTxnReviewSheet && window.fhTxnReviewSheet(ctx));
    }

    if (fwd || oauth) return window.fhTxnReviewSheet && window.fhTxnReviewSheet(ctx);
    return window.fhEmailSetupChooser
      ? window.fhEmailSetupChooser(preset)
      : (window.fhMailboxSheet && window.fhMailboxSheet());
  };

  /* One row -> the fields the review screen needs.

     Handles BOTH shapes on purpose. Rows staged before sealing was switched on
     carry plain columns; rows staged after carry {sealed, eph_pub, nonce} and
     nothing readable. Both will exist in the table during the transition, so the
     branch is here from the start rather than retrofitted — and the sealed path
     degrades to a visible "locked" row instead of silently vanishing. */
  async function fhReadStagedRow(row) {
    if (!row.sealed) return row;                       // plaintext era
    if (!window.fhStagingOpenRow) return null;         // sealed, no decryptor wired yet
    try {
      /* The table has no family_id column (rows scope through member_id — see
         SEALED-STAGING-DESIGN §4.2), but the opener verifies the family_id the
         SEALER bound inside the box. The value it must match is OURS: the
         active family. Without this line row.family_id is undefined, the check
         throws on every row ever sealed, and the whole queue reads as locked. */
      row.family_id = window.DB && window.DB.fid;

      /* Which key opens this, and which identity it must prove.

         A row sealed for the PERSON (0091) is opened with the personal staging
         key and proves `owner_user_id`; a family row uses the family key and
         proves `family_id`. The row says which via `staging_scope` — the client
         cannot guess, because it holds two private keys and a sealed box gives
         no hint which fits. Trying both would turn a wrong key into a silent
         "unreadable row" instead of a clear one.

         `owner_user_id` is set from OUR OWN session, never from the row the
         server sent: the binding is only a check if both sides of it are values
         we already knew. */
      var personal = row.staging_scope === 'personal';
      if (personal) row.owner_user_id = (window.fhUser && window.fhUser.id) || null;
      var priv = personal
        ? await window.fhPersonalStagingPrivKey()
        : await window.fhStagingPrivKey();
      var payload = window.fhStagingOpenRow(row, priv);
      /* Two transports seal two SHAPES. The forwarding pipeline spreads the
         extracted detail fields FLAT into the sealed payload; the direct-read
         worker NESTS them under `raw_extracted` (stage.mjs). This screen reads
         memo_display, category_hint, account_masked, flow and _transport at the
         TOP level — which is where forwarding puts them — so a direct-read row
         silently lost every one: descriptions fell back to the counterparty,
         categories never auto-filled, income mis-routed, and the source tag
         always read "forwarding". Flatten the nested case up so both shapes are
         identical from here down. The duplicated cash fields agree, so the merge
         is lossless. */
      var re = (payload && payload.raw_extracted && typeof payload.raw_extracted === 'object')
        ? Object.assign({}, payload, payload.raw_extracted) : payload;
      return {
        id: row.id, member_id: row.member_id,
        source_provider: row.source_provider, occurred_at: row.occurred_at,
        amount: re.amount, currency: re.currency,
        direction: re.direction, counterparty: re.counterparty,
        /* Workflow columns ride OUTSIDE the box and must survive this rebuild:
           dropping duplicate_of_id here is what made fhStagedMeta's pipelineDup
           read false on every sealed row — the pipeline's whole verdict lost on
           the last hop. resolved_before (0113) is the certainty badge. */
        duplicate_of_id: row.duplicate_of_id || null,
        resolved_before: !!row.resolved_before,
        raw_extracted: re,
      };
    } catch (e) {
      // Tampering, a key mismatch, or a locked device. Never silently skip: a row
      // that cannot be opened is exactly the case a person needs to be told about.
      return { id: row.id, _unreadable: String(e && e.message || e),
               occurred_at: row.occurred_at, source_provider: row.source_provider };
    }
  }

  /* Shapes rows the way buildCsvCandidates() expects: a `parsed` with rows as
     arrays, and a `result` mapping column index -> field. Doing it this way,
     rather than constructing candidates directly, means the whole category
     cascade (file -> history -> learned) and every later improvement to that
     screen applies here for free. */
  /* The bank's own category names for a transaction — the phrases it prints when
     nobody typed anything. They are not wrong and they are not thrown away; they
     simply lose to a merchant read from the same mail (see the description rule
     below). Matched WHOLE, on the accent-stripped form, so "Thanh toán tiền nhà
     cho mẹ" is untouched while "Thanh toán hóa đơn" is recognised. Deliberately
     short: every entry is a phrase a bank generates, never one a person types. */
  var _BANK_GENERIC_MEMOS = [
    'thanh toan dich vu hang hoa', 'thanh toan hang hoa dich vu',
    'thanh toan hoa don', 'thanh toan the', 'thanh toan qr', 'thanh toan truc tuyen',
    'mua hang truc tuyen', 'rut tien tai atm', 'rut tien mat',
    'chuyen tien lien ngan hang', 'chuyen tien nhanh', 'chuyen tien noi bo',
    'giao dich the', 'giao dich the ghi no', 'giao dich the tin dung',
    'thanh toan dich vu', 'nap tien dien thoai',
  ];
  function _bankGenericMemo(s) {
    if (!s) return false;
    var flat = String(s).normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
    return _BANK_GENERIC_MEMOS.indexOf(flat) >= 0;
  }

  function fhStagedAsCsvSource(rows) {
    /* `category` rides along as a fifth column so the pipeline's own guess
       enters the review engine at the top of its cascade, as `catSource:'file'`
       — the same precedence a CSV's own category column gets, and for the same
       reason: it is the source's stated answer rather than something we
       inferred. Everything below it (history, learned, merchant, keyword,
       fallback) still runs when the hint is absent, which is most rows today.

       It was being written by the pipeline (`raw_extracted.category_hint`) and
       read by NOBODY, so every row arrived uncategorised and every one cost a
       manual pick — the single biggest source of review effort. */
    var COLS = ['occurred_at', 'description', 'amount', 'counterparty', 'category'];
    var columnMap = {};
    COLS.forEach(function (f, i) { columnMap[i] = { field: f, confidence: 1 }; });

    var out = rows.map(function (r) {
      var x = r.raw_extracted || {};
      // "Chi cho gì" asks what the money was FOR, and the answer depends on the
      // kind of transaction:
      //   • memo is the payer's own words ("tra tien an trua thu 6") — always the
      //     best answer when it exists.
      //   • a card purchase has no memo, but its counterparty IS the merchant, so
      //     "REVI PHU MY HUNG TOWER" genuinely is what was spent on.
      //   • a p2p transfer's counterparty is a PERSON. "LE VAN HOANG -
      //     0912345678" answers "who received it", not "what for" — filling the
      //     description with it looks answered while telling you nothing, and a
      //     pre-filled wrong answer is worse than an empty field, because it gets
      //     accepted rather than corrected.
      // So a memo-less transfer is left blank for the human, which is the one
      // thing only they know.
      //
      // memo_display is that judgement already made, by whichever transport
      // staged the row: the memo with the bank's auto-fill taken out. Prefer it,
      // because raw memo is exactly where "NGUYEN THU TRANG chuyen tien" lives —
      // prose enough to look answered, empty enough to tell you nothing.
      //
      // An EMPTY memo_display is a VERDICT, not a missing value: it means "this
      // memo says nothing", and it must fall through to the counterparty rule
      // the same way a memo-less card purchase does. So the test is presence,
      // not truthiness — `x.memo_display || x.memo` would resurrect the raw
      // auto-fill in precisely the case the tidy just rejected. Only an ABSENT
      // field falls back, and that is rows staged before the tidy existed.
      var tidied = x.memo_display == null ? x.memo : x.memo_display;
      /* WHO SAYS it is a person. The sealed `transaction_type` on an email row is
         derived from the SENDER's kind (stage.mjs), so it only ever reads bank_txn
         or ecommerce_receipt and this test could never be true for mail: the rule
         above was dead on exactly the rows it was written for. The reader's own
         verdict is sealed beside it as `reader_type` (email-reading-v2-spec §4,
         §15 fix 2) and is asked first. `transaction_type` keeps its meaning and
         its other reader (fhStagedKind, the bank-vs-receipt dedup rule); it still
         answers here for a statement row, which writes p2p_transfer itself, and
         for every row sealed before reader_type existed. */
      /* …but `reader_type` answers "what kind of mail was this", and ANY mail
         carrying a beneficiary row reads as p2p_transfer. A QR payment to a
         SELLER ("VQRQ0001oqplk - VO DINH PHUC", memo "Thanh toan QR" which the
         tidy correctly empties) is such a mail, so the blank-on-purpose rule
         fired on rows whose counterparty IS the answer: measured 19 rows read
         as p2p, 7 of them merchants, 5 rendered blank with a name available.
         payload v2 states the fact the rule actually wants — `counterparty_kind`
         (person | merchant | bank | wallet | self | unknown), about the OTHER
         SIDE rather than about the mail — so ask that when the row carries one.
         `unknown` is "no opinion" and falls through, as do v1 rows and statement
         rows, which carry no counterparty_kind at all and keep today's behaviour
         byte for byte. */
      var ckind = x.counterparty_kind;
      var isPerson = (ckind && ckind !== 'unknown')
        ? (ckind === 'person')
        : ((x.reader_type || x.transaction_type) === 'p2p_transfer');
      /* The memo still comes first — it is the only field that can carry why the
         money moved, and "ca phe" beats "HIGHLANDS COFFEE" for that question.
         ONE EXCEPTION: a memo that is the bank's own CATEGORY NAME. "Thanh toán
         dịch vụ - hàng hoá" is a true sentence about the row and a useless
         answer to "chi cho gì", and it was outranking "GS25 NGUYEN VAN LINH"
         printed in the same mail. Between a generic label and a specific
         merchant, the merchant is the answer.
         RANKED, NOT FILTERED (Trang's call): the phrase is not thrown away, it
         just loses to a merchant. A purchase whose merchant we could not read
         still shows it, because a bank category still beats a blank row. */
      var description = isPerson
        ? (tidied || '')
        : ((_bankGenericMemo(tidied) && r.counterparty)
            ? r.counterparty
            : (tidied || r.counterparty || r.source_provider || ''));
      /* Foreign-currency rows carry the ESTIMATED VND into the amount cell, so
         every downstream reader — totals, the write, csvBaseAmt — works in VND
         and never mistakes "$111" for 111đ. The foreign original stays visible
         via fhStagedFx ("≈ $111 · est."), and the person can edit the estimate.
         When no rate is known the estimate is null and the raw amount rides
         through — the review then shows "$111 → ₫?" and asks for the figure. */
      var _fxHome = window.fhCurNorm ? window.fhCurNorm(window.CUR || 'VND') : 'VND';
      var _fxCur = window.fhCurNorm ? window.fhCurNorm(r.currency) : 'VND';
      var _fxEst = (_fxCur !== 'VND' && _fxCur !== _fxHome && window.fhFxEstimate)
        ? window.fhFxEstimate(r.amount, _fxCur) : null;
      var _amtNum = _fxEst ? _fxEst.vnd : r.amount;
      var amt = (r.direction === 'credit' ? '' : '-') + String(_amtNum);

      /* The pipeline answers in CONCEPTS — Dining, Groceries, Transport — not in
         this family's category names, because it has no idea what they are and
         they are frequently Vietnamese. `familyCatForConcept` is the app's own
         resolver for exactly that: it walks the family's real categories and
         matches on name OR emoji, and returns '' when the family has no
         category for the concept. So a family that has never made a "Dining"
         gets no guess rather than an invented one.

         Resolved HERE rather than downstream because this is the only place
         that knows the value is a concept. Downstream it is indistinguishable
         from a category name a CSV supplied. */
      var concept = x.category_hint || x.category || '';
      var catHint = '';
      if (concept && window.familyCatForConcept) {
        try { catHint = window.familyCatForConcept(concept) || ''; } catch (e) {}
      }
      return [r.occurred_at, description, amt, r.counterparty || '', catHint];
    });

    return { parsed: { rows: out, headers: COLS }, result: { columnMap: columnMap },
             name: L('Email ngân hàng', 'Bank email') };
  }

  /* The four columns above are what the review ENGINE reads. Two more fields
     matter to duplicate detection and survive sealing in the clear, so rather
     than widen the projection (every column there becomes a field the mapper
     has to reason about) they are fetched on demand by row index.

     rowIndex indexes _fhStagedRows because fhStagedAsCsvSource maps that exact
     array in that exact order — the same guarantee retirement already relies on.

     source_provider is the field the pipeline's own rule turns on, and it is
     deliberately NOT sealed: a hash can only match exactly, and bank names need
     fuzzy matching ('MB Bank' / 'MBBank' / 'MB'). Which is precisely why the
     client can run that rule too, with the decrypted amount in hand. */
  /* Two BANKS can never report one purchase. A bank only ever sees movements on
     its own account, so an MB debit and a Vietcombank debit are two different
     pieces of money — not one event described twice, however equal the amounts.
     The genuine duplicate is a bank AND a non-bank: the card issuer says "debit
     200.000đ" and the merchant says "receipt 200.000đ" for one swipe.

     Trang, 2026-08-23, on three live flags that were all bank-vs-bank. The rule
     had only compared provider NAMES, which cannot express this.

     transaction_type is sealed, so `findDuplicate` in the pipeline cannot apply
     this at all: it holds plaintext for the row it is writing and ciphertext for
     every row it compares against. The client holds all of it decrypted. This is
     the sharpest example so far of the review screen being a strictly better
     place to judge than the ingest job. */
  var STAGED_BANK_TYPES = { bank_txn: 1, p2p_transfer: 1 };

  // 'bank' | 'other' | '' when unknown. Empty never concludes anything —
  // bill_payment is deliberately 'other' rather than guessed: a bank and a biller
  // both send them, and mislabelling one as a bank would suppress a real duplicate.
  function fhStagedKind(r) {
    var t = (r && r.raw_extracted && r.raw_extracted.transaction_type) || '';
    if (!t) return '';
    return STAGED_BANK_TYPES[t] ? 'bank' : 'other';
  }

  // The kind of a row named by id — how the screen checks what the PIPELINE
  // matched against. Returns '' when that row is not in this fetch (promoted,
  // retired, or past the page), which leaves the suspicion standing rather than
  // dismissing it on missing evidence.
  function fhStagedKindById(id) {
    var rows = window._fhStagedRows;
    if (!rows || !id) return '';
    for (var i = 0; i < rows.length; i++) if (rows[i] && rows[i].id === id) return fhStagedKind(rows[i]);
    return '';
  }
  window.fhStagedKindById = fhStagedKindById;

  function fhStagedMeta(rowIndex) {
    var rows = window._fhStagedRows;
    if (!rows || typeof rowIndex !== 'number') return null;
    var r = rows[rowIndex];
    if (!r) return null;
    return {
      provider: r.source_provider || '',
      kind: fhStagedKind(r),
      dupOfId: r.duplicate_of_id || '',
      // 200 USD and 200 VND are not the same purchase. dedup_fp has always
      // hashed currency alongside amount; the client-side twin compared the
      // NUMBER alone, so a USD receipt beside a VND row of equal magnitude
      // within 3 days read as one event reported twice.
      currency: (r.currency || '').toUpperCase(),
      occurredAt: r.occurred_at || '',
      pipelineDup: !!r.duplicate_of_id,
    };
  }
  window.fhStagedMeta = fhStagedMeta;

  /* Foreign-currency posture of a staged row, by candidate rowIndex
     (foreign-currency-emails-spec.md). Three answers:

       null                    — a domestic row; nothing special anywhere.
       {kind:'foreign', ...}   — the row is denominated in a currency that is
                                 not the family's. Its amount is NOT a VND
                                 figure: rendering it with curFmt or writing it
                                 through csvBaseAmt is the 111đ corruption.
                                 The card shows "$111" and Import stays gated
                                 until the person types the real VND amount.
       {kind:'converted', ...} — the amount IS VND (the bank's own settled
                                 conversion, preferred at extraction), and the
                                 foreign original rides along for display
                                 ("≈ $111") and note provenance.

     `amount`/`currency` in the answer are always the FOREIGN pair. */
  /* The VND estimate for a foreign amount, from the shared fx_rates table (0112,
     hydrated to window.FX_RATES). round(amount × rate × (1 + fee/100)) — the fee
     is the bank's foreign-transaction markup, so the pre-filled number lands
     near the real debit instead of a few percent low. Rounded to the nearest
     1.000đ because it IS an estimate and a clean number reads as one. Null when
     no rate is known for the currency — the caller then asks for the amount. */
  window.fhFxEstimate = function (amount, currency) {
    var t = window.FX_RATES && window.FX_RATES[String(currency || '').toUpperCase()];
    var a = Number(amount);
    if (!t || !(t.rate > 0) || !(a > 0)) return null;
    var fee = (t.fee > 0) ? t.fee : 0;
    var gross = a * t.rate * (1 + fee / 100);
    var vnd = Math.max(1000, Math.round(gross / 1000) * 1000);
    return { vnd: vnd, rate: t.rate, fee: fee };
  };

  /* Foreign-currency posture of a staged row (foreign-currency-emails-spec.md):
       null                    — domestic, nothing special.
       {kind:'converted', ...} — the amount is already the bank's own VND
                                 conversion; `amount`/`currency` are the foreign
                                 original, shown as "≈ $111" for reference.
       {kind:'foreign', ...}   — the row is denominated in a foreign currency.
                                 `est` is the VND estimate ({vnd,rate,fee}) when a
                                 rate is known — the review pre-fills it so the
                                 person just taps import — or null when it isn't,
                                 the one case where a ₫ amount must be typed. */
  /* A bank email labels its VND amount in many ways — "đ", "VNĐ", "đồng", "₫",
     a bare "" — and the foreign check compared the raw token to "VND" by string.
     So a plain VND row whose currency read "đ" was flagged FOREIGN, had no rate
     to estimate, and rendered the nonsensical "1.000.000 đ → đ?" that also GATED
     its import. Fold every home-currency synonym to the canonical code before any
     compare, so only a genuinely different currency is ever treated as foreign. */
  function fhCurNorm(s) {
    var c = String(s == null ? '' : s).toUpperCase();
    c = c.normalize ? c.normalize('NFD').replace(/[̀-ͯ]/g, '') : c;   // strip diacritics
    c = c.replace(/Đ/g, 'D').replace(/[.\s₫]/g, '');                            // đ/Đ → D, drop dots/spaces/₫
    if (c === '' || c === 'VND' || c === 'VN' || c === 'D' || c === 'DONG') return 'VND';
    return c;
  }
  window.fhCurNorm = fhCurNorm;

  /* 0144 — the tree node the pipeline decided, by row index. Same side-channel
     shape as fhStagedFx: the review engine's five synthetic columns are a CSV
     contract and widening them makes every one a field the column mapper must
     reason about, so the node is fetched on demand instead. 'receipt' rides along
     because the client's join needs to know the mail was a merchant's, not a
     bank's — both live inside the sealed raw_extracted. */
  window.fhStagedNode = function (rowIndex) {
    var rows = window._fhStagedRows;
    var r = (rows && typeof rowIndex === 'number') ? rows[rowIndex] : null;
    if (!r || r._unreadable) return null;
    var x = r.raw_extracted || {};
    var code = x.node || null;
    if (code && !(window.FH_TAX && FH_TAX.get(code))) code = null;   // a newer tree wrote it: unknown here
    return { node: code, concept: x.category_hint || x.category || '',
             source: x.txn_source || null, receipt: x.txn_source === 'receipt' };
  };

  window.fhStagedFx = function (rowIndex) {
    var rows = window._fhStagedRows;
    var r = (rows && typeof rowIndex === 'number') ? rows[rowIndex] : null;
    if (!r || r._unreadable) return null;
    var home = fhCurNorm(window.CUR || 'VND');
    var cur = fhCurNorm(r.currency);
    if (cur !== 'VND' && cur !== home) {
      return { kind: 'foreign', currency: cur, amount: r.amount,
               est: window.fhFxEstimate(r.amount, cur) };
    }
    var x = r.raw_extracted || {};
    var fxc = fhCurNorm(x.fx_currency);
    if (x.fx_amount != null && x.fx_currency && fxc !== 'VND' && fxc !== home) {
      return { kind: 'converted', currency: fxc, amount: x.fx_amount };
    }
    return null;
  };

  /* The full opened payload of a staged row, by candidate rowIndex —
     fhStagedAsCsvSource maps _fhStagedRows in order, the same guarantee
     retirement relies on. Used by the review's transfer wiring (flow /
     account_kind, the 0105 instrument classifier) without widening the
     5-column projection. */
  window.fhStagedRawX = function (rowIndex) {
    var rows = window._fhStagedRows;
    if (!rows || typeof rowIndex !== 'number') return null;
    var r = rows[rowIndex];
    return (r && r.raw_extracted) || null;
  };

  /* Instrument identity of a staged row → exactly what fhPersonalAccountEnsure
     needs to auto-materialize the account (Q15). Null when nothing confident is
     known (Q16: never invent a debt).

     Rows staged BEFORE the classifier existed carry no account_kind, and their
     sealed boxes can never be amended — so for those two LOCAL signals stand
     in: the wallet providers are wallets by identity, and an account the
     person already owns states its own kind (see below). A full-length
     masked PAN is deliberately NOT read as a credit card any more — VN debit
     cards print 16-digit PANs too, and that guess is exactly how a debit
     account became a phantom card (2026-09-02). Anything unconfident stays
     null — an absent chip beats a wrong debt (Q16). */
  window.fhStagedAcct = function (c) {
    var rows = window._fhStagedRows;
    var r = (c && typeof c.rowIndex === 'number' && rows) ? rows[c.rowIndex] : null;
    var x = (r && r.raw_extracted) || null;
    if (!x) return null;
    var masked = String(x.account_masked || '');
    var tail4 = masked.replace(/\D/g, '').slice(-4);
    var kind = x.account_kind || null;
    if (!kind) {
      var prov = String(r.source_provider || '').toLowerCase();
      if (/momo|zalopay|shopeepay/.test(prov)) kind = 'ewallet';
    }
    /* THE PERSON'S OWN RECORD ANSWERS IT (2026-09-22, full-ledger T12). An
       account's identity is (provider, tail); the kind is editable metadata.
       So when the mail prints both and an account the person ALREADY OWNS has
       that identity, the kind is theirs to read off, not ours to guess — and
       throwing a known provider and a known tail away with the unknown kind is
       what put "Nguồn tiền: Chưa rõ" on rows for an account the app has held
       for weeks. We invent nothing: their own record is the evidence.
       Providers fold through fhProviderName + csvCanonicalProvider, so "VIB",
       "Ngân hàng Quốc Tế" and the long official name key ONE account.
       Two owned accounts sharing a tail is ambiguity and resolves to nothing:
       a wrong account is worse than no account. No owned match keeps today's
       null — creating an account still needs a STATED kind (personal_accounts
       .kind is NOT NULL, and a wrong one invents a debt: Q16). */
    if (!kind && tail4.length === 4) {
      try {
        var canonP = function (s) {
          if (typeof window.fhAcctProviderKey === 'function') return window.fhAcctProviderKey(s || '');
          var n = (window.fhProviderName ? (window.fhProviderName(s || '') || s) : s) || '';
          return (typeof csvCanonicalProvider === 'function') ? csvCanonicalProvider(n) : String(n).toLowerCase();
        };
        var pKey = canonP((r && r.source_provider) || '');
        var ownedA = (window.fhPersonalData && (fhPersonalData().accounts || [])) || [];
        if (pKey) {
          var hits = ownedA.filter(function (a) {
            return a && a.kind && (a.tail || '') === tail4 && canonP(a.provider) === pKey;
          });
          if (hits.length === 1) kind = hits[0].kind;
        }
      } catch (eOwn) {}
    }
    if (!kind) return null;
    return { kind: kind,
             tail: tail4 || null,
             provider: (r && r.source_provider) || null };
  };

  /* The OTHER side of an own-account transfer, as an instrument to ensure
     (2026-09-22). A bank only mails about money moving on its own accounts, so
     an account that never emails money-in (a Vietcombank account that only
     receives) is never seen as a row's own instrument, never materializes, and
     "Chuyển đến đâu" has nothing to pre-fill or even offer. The transfer mail
     names it: "Đến tài khoản: <account> - <holder>", "Tại ngân hàng:
     Vietcombank". Three facts, all required, all printed:
       - the mail SAYS own transfer (signal own_transfer, or the printed
         counterparty is the holder), from a printed or template-grade source.
         Never a memo guess: "A chuyen tien den A" is the bank's auto-fill and
         is graded heuristic on the server for exactly that reason;
       - the counterparty's bank;
       - the counterparty's account tail.
     Always a deposit (never a card: a wrongly claimed card invents a debt), and
     never for wallet_move (a top-up's other side is a wallet, which the wallet
     provider rule in fhStagedAcct already covers). Identity is (provider, tail)
     like every ensure(), so a later sighting of the same account as a row's own
     instrument merges into this one instead of minting a twin. The provider
     goes through fhProviderName so "VCB", "Vietcombank" and the long official
     name all key the same account. */
  window.fhStagedCounterpartAcct = function (x) {
    if (!x || !(Number(x.v) >= 2)) return null;
    /* A STATEMENT row never materializes the other side. One mail is one thing
       that just happened and its counterparty is worth an account; a statement
       is bulk history, and 145 rows of it would mint accounts by the handful
       from months-old counterparties. The statement path RESOLVES the other
       side against accounts the person already has (57 _sigCounterpart) and
       leaves the row unfilled when it finds none. */
    if (x._transport === 'statement') return null;
    if (x.signal === 'wallet_move') return null;
    if (!(x.signal === 'own_transfer' || x.counterparty_kind === 'self')) return null;
    var srcSig = (x.src && typeof x.src === 'object') ? x.src.signal : null;
    if (srcSig !== 'printed' && srcSig !== 'template') return null;
    var tail = String(x.counterparty_account_tail || '').replace(/\D/g, '').slice(-4);
    var bank = String(x.counterparty_bank || '').trim();
    if (tail.length !== 4 || !bank) return null;
    var prov = (window.fhProviderName ? window.fhProviderName(bank) : '') || bank;
    return { kind: 'deposit', provider: prov, tail: tail };
  };

  /* Eager account materialization (0109, full-ledger T11): the queue is a
     CENSUS of the person's instruments. Every staged row names the account it
     moved through (classifier kind · provider · tail), and an own-account
     transfer names the account on the other side too. Materialize each
     distinct one at review open, not at import, so every picker (transfer
     counterpart, which-card) is complete the moment it renders and never asks
     the person to create an account the app has already seen. Names go through
     fhProviderName so a created account reads "VIB ••1234", not "vib ••1234".
     Idempotent: ensure() keys on (provider, tail), so reopening the queue
     creates nothing twice. Expects window._fhStagedRows to be `readable`
     already (fhStagedAcct reads rows by index). A window function rather than
     a block inside the open path so a test can run the census over synthetic
     rows. */
  window.fhQueueAccountCensus = async function (readable) {
    var pdE = window.fhPersonalData && window.fhPersonalData();
    if (!pdE || pdE.state !== 'ready' || !window.fhPersonalAccountEnsure) return;   // locked ledger — pickers fall back as today
    var seen = {}, made = false, hadIds = {};
    (pdE.accounts || []).forEach(function (a) { hadIds[a.id] = 1; });
    var acctById = function (id) {
      var pd = window.fhPersonalData && window.fhPersonalData();
      return ((pd && pd.accounts) || []).filter(function (a) { return a.id === id; })[0] || null;
    };
    var ensure = async function (ai) {
      var disp = (window.fhProviderName ? window.fhProviderName(ai.provider || '') : (ai.provider || '')) || '';
      var idE = await window.fhPersonalAccountEnsure(Object.assign({}, ai,
        { name: disp ? (disp + (ai.tail ? ' ••' + ai.tail : '')) : null }));
      if (idE) { made = true; if (!hadIds[idE]) { hadIds[idE] = 1; window._fhQueueNewAccts.push(idE); } }
      return idE;
    };
    for (var ei = 0; ei < (readable || []).length; ei++) {
      var x = (readable[ei] && readable[ei].raw_extracted) || null;
      var aiE = null, cpE = null;
      try { aiE = window.fhStagedAcct ? window.fhStagedAcct({ rowIndex: ei }) : null; } catch (eA) {}
      try { cpE = window.fhStagedCounterpartAcct(x); } catch (eP) {}
      if (aiE) {
        var aiKey = aiE.kind + '|' + String(aiE.provider || '').toLowerCase() + '|' + (aiE.tail || '');
        if (!seen[aiKey]) {
          seen[aiKey] = 1;
          try {
            var idE = await ensure(aiE);
            /* Kind is metadata, identity is the number (full-ledger T12).
               ensure() matched by (provider, tail) and left the kind alone, so
               a row sealed `credit_card` over an account the app already holds
               as a deposit changes nothing: the card guess never re-kinds it.
               The one re-kind that IS made runs the other way: an account held
               as a card that a PRINTED fact (or a verified format's fact) now
               says is a deposit. A fact beats the guess that minted the card;
               a guess never overwrites a fact, and nothing overwrites a kind
               the person set themselves (human_verified). */
            if (idE && aiE.kind === 'deposit' && x && Number(x.v) >= 2 && x.src && typeof x.src === 'object'
                && (x.src.account_kind === 'printed' || x.src.account_kind === 'template')) {
              var cur = acctById(idE);
              if (cur && cur.kind === 'credit_card' && !cur.humanVerified && window.fhPersonalAccountUpdate) {
                try { if (await window.fhPersonalAccountUpdate(idE, { kind: 'deposit' })) { cur.kind = 'deposit'; made = true; } } catch (eK) {}
              }
            }
          } catch (eB) {}
        }
      }
      if (cpE) {
        var cpKey = cpE.kind + '|' + String(cpE.provider || '').toLowerCase() + '|' + cpE.tail;
        if (!seen[cpKey]) { seen[cpKey] = 1; try { await ensure(cpE); } catch (eC) {} }
      }
    }
    if (made) { try { window.renderPersonal && window.renderPersonal(); } catch (eR) {} }
  };

  /* Card-payment candidates still waiting in the inbox — for the card detail's
     "Ghi thanh toán thẻ" sheet, which lets a person assign one to a SPECIFIC
     card (the sending bank mail can't say which). Fetch + open + filter, read
     only: never touches the review's own _fhStagedRows state. A row is a
     card-payment candidate when the pipeline called it a transfer, when it is a
     credit-card "payment received" (credit into a card), or when its memo says
     so. Returns display-currency amounts, like the review's candidates. */
  var _CARD_PAY_RX = /thanh toan (sao ke |du no )?the|tt the tin dung|tra no the|thanh toan the (visa|master|jcb)|tra tien the tin dung/;
  /* Who is on the other side of a repayment: the issuer. A repayment pays the
     BANK, so there is no merchant to name — either the mail carries no memo at
     all (VIB's "Thanh toán thẻ tín dụng thành công" template is memo:null) or
     the counterparty is the bank itself. */
  var _ISSUER_RX = /\bngan hang\b|\bnh tmcp\b|\btmcp\b/;
  /* Card-payment SHAPE of an unsealed payload — shared with the quick sheet and
     the staged parse. Two signals, either suffices:
     1. the memo says so ("thanh toan sao ke the…");
     2. the classifier called the instrument a credit card while the NUMBER
        belongs to a non-card account the user owns. That disagreement is not
        noise — it is exactly what a bank's payment-confirmation mail produces
        (VIB "Thanh toán thẻ tín dụng thành công": account_kind=credit_card,
        account_masked = "Từ tài khoản", i.e. the SENDING deposit). Trusting
        the kind while matching accounts by number filed the payment as a row
        on the deposit (2026-09-06). */
  window.fhCardPayShaped = function (re) {
    if (!re) return false;
    /* WHO IS ON THE OTHER SIDE. memo_display can be an EMPTY STRING while the
       merchant is named in counterparty — Vietcombank's card template does
       exactly that ("MPOS*WAYNESCOFFEE HO CHI MINH VN" in counterparty,
       memo:null, memo_display:"") — so an empty string has to fall through like
       a null. Reading it as "the mail named nobody" is what kept Wayne's Coffee
       and Co.op Mart filed as repayments after the first fix. */
    var memo = String(re.memo_display || re.memo || re.counterparty || '').toLowerCase();
    var flat = memo.normalize ? memo.normalize('NFD').replace(/[̀-ͯ]/g, '') : memo;
    /* A CARD NUMBER IN THE MAIL IS NOT PROOF OF A REPAYMENT, and reading it as
       one turned every card purchase into "Trả nợ thẻ" — APPLE.COM/BILL,
       CO.OP MART, WAYNESCOFFEE. The reason is that two different extractors
       fill this field: llm.mjs is told to set card_masked only on a repayment,
       but the deterministic label table (labeltable.mjs) matches bare "số thẻ"
       / "thẻ tín dụng số" lines, which EVERY card purchase alert prints. So on
       the template path card_masked only means "this mail named a card".
       What separates the two is the other side: a repayment names the issuer or
       nobody, a purchase names the shop. The memo-less VIB confirmation this
       rule exists for still passes, because flat is empty there. */
    if (re.card_masked && (!flat.trim() || _ISSUER_RX.test(flat))) return true;
    if (_CARD_PAY_RX.test(flat)) return true;
    var tail = String(re.account_masked || '').replace(/\D/g, '').slice(-4);
    if (re.account_kind === 'credit_card' && tail && window.fhPersonalData) {
      var accs = (fhPersonalData().accounts || []);
      if (accs.some(function (a) { return (a.tail || '') === tail && a.kind !== 'credit_card'; })) return true;
    }
    return false;
  };
  /* Which OWNED credit card a card-payment row pays off → its account id, or
     null when it can't be named with confidence (card-repayment-routing-spec
     §8.1). One resolver, called by both the review candidate builder (to
     pre-select "Trả cho thẻ") and the promote path (to tag the card's leg).
     Matches an owned credit_card by last-4 tail, most-specific evidence first;
     a card it cannot confidently name stays "Chưa rõ" — a WRONG card moves the
     wrong balance, so ambiguity fails to null, never to a guess.
       rawX  — the staged row's raw_extracted (fhStagedRawX)
       sa    — the instrument chip (fhStagedAcct): {kind, tail, provider}
       desc  — the reviewed description (memo digits are mined as a fallback) */
  window.fhResolveRepaidCard = function (rawX, sa, desc) {
    var pd = window.fhPersonalData ? fhPersonalData() : null;
    var cards = ((pd && pd.accounts) || []).filter(function (a) { return a.kind === 'credit_card'; });
    if (!cards.length) return null;
    var last4 = function (s) { return String(s == null ? '' : s).replace(/\D/g, '').slice(-4); };
    var prov = function (s) { return String(s || '').toLowerCase(); };
    // Match owned cards by tail; a tail shared by several cards is broken only
    // by an explicit provider hint, else it stays ambiguous (→ null).
    var byTail = function (tail, provHint) {
      if (!tail) return null;
      var hits = cards.filter(function (a) { return (a.tail || '') === tail; });
      if (hits.length === 1) return hits[0].id;
      if (hits.length > 1 && provHint) {
        var p = hits.filter(function (a) { return prov(a.provider) === prov(provHint); });
        if (p.length === 1) return p[0].id;
      }
      return null;
    };
    var x = rawX || {};
    // 1. card_masked — the card the mail explicitly named as the repayment
    //    target (Layer 2). The card's own bank need not be the email's sender
    //    (cross-bank repayment), so match by tail; sa.provider only tie-breaks.
    var named = last4(x.card_masked);
    var id = byTail(named, sa && sa.provider);
    if (id) return id;
    /* The mail NAMES a card, in full, and it is not one of the person's cards:
       the answer is "Chưa rõ", not the one card they do own. The one-card
       default below is for a mail that names no card at all; applied here it
       drew down the wrong card's debt on the word of a mail that said otherwise
       (card-repayment-routing-spec §9: never a wrong card). A tail two owned
       cards share is a different case, ambiguity, and keeps falling through. */
    if (named.length === 4 && !cards.some(function (a) { return (a.tail || '') === named; })) return null;
    // 2. account_masked when the classifier called the instrument a credit card
    //    (the card-side alert — the ··5140 in the screenshot). Matches only
    //    against owned CARDS, so a deposit number here finds none and falls
    //    through — the 2026-09-06 VIB deposit hazard cannot re-tag a card.
    if (sa && sa.kind === 'credit_card') { id = byTail(last4(sa.tail), sa.provider); if (id) return id; }
    // 3. a card's tail printed in the memo/counterparty/reference/description
    //    ("…THE MASTER 4751"): a digit-exact token match against owned cards.
    var digits = ' ' + String(
      (x.memo_display != null ? x.memo_display : (x.memo || '')) + ' '
      + (x.counterparty || '') + ' ' + (x.reference_number || '') + ' ' + (desc || '')
    ).replace(/\D+/g, ' ').trim() + ' ';
    var mHits = cards.filter(function (a) { return a.tail && digits.indexOf(' ' + a.tail + ' ') >= 0; });
    if (mHits.length === 1) return mHits[0].id;
    // 4. one owned card → the only possible answer. 5. else null → "Chưa rõ".
    if (cards.length === 1) return cards[0].id;
    return null;
  };
  window.fhStagedCardPayments = async function () {
    var raw;
    try { raw = await fhFetchStagedTxns(); } catch (e) { return []; }
    var out = [];
    for (var i = 0; i < raw.length; i++) {
      var r = await fhReadStagedRow(raw[i]);
      if (i % 25 === 0) { await new Promise(function (res) { setTimeout(res, 0); }); }   // yield, keep the tap alive
      if (!r || r._unreadable) continue;
      var re = r.raw_extracted || {};
      /* Same empty-string hazard as fhCardPayShaped: memo_display is "" on
         Vietcombank/VIB card mails, so a != null test wins and the counterparty
         is never read. The line right below already uses the || form. */
      var memo = String(re.memo_display || re.memo || r.counterparty || '').toLowerCase();
      var flat = memo.normalize ? memo.normalize('NFD').replace(/[̀-ͯ]/g, '') : memo;
      var isPay = re.flow === 'transfer'
        || (re.account_kind === 'credit_card' && r.direction === 'credit')
        || _CARD_PAY_RX.test(flat);
      if (!isPay) continue;
      out.push({ id: r.id, amount: Number(r.amount) || 0, occurredAt: r.occurred_at || '',
        description: re.memo_display || re.memo || r.counterparty || 'Thanh toán thẻ',
        provider: r.source_provider || '',
        tail: String(re.account_masked || '').replace(/\D/g, '').slice(-4) || null });
    }
    return out;
  };

  /* Streak peek (0132) — the queue as the streak engine sees it. Fetch + open,
     READ ONLY, same posture as fhStagedCardPayments: never touches the
     review's _fhStagedRows. Debits only (credits can't break a no-spend
     streak). `cat` is the sealed category hint resolved through
     familyCatForConcept — the same resolver the review pre-fill uses — so a
     category streak and the eventual reviewed row speak the same name; an
     unresolvable concept yields '' and simply can't match (never a guess). */
  window.fhStagedStreakPeek = async function () {
    var raw;
    try { raw = await fhFetchStagedTxns(); } catch (e) { return []; }
    var out = [];
    for (var i = 0; i < raw.length; i++) {
      var r = await fhReadStagedRow(raw[i]);
      if (i % 25 === 0) { await new Promise(function (res) { setTimeout(res, 0); }); }
      if (!r || r._unreadable || r.direction === 'credit') continue;
      var re = r.raw_extracted || {};
      var concept = re.category_hint || re.category || '';
      var cat = '';
      if (concept && window.familyCatForConcept) { try { cat = window.familyCatForConcept(concept) || ''; } catch (e2) {} }
      var d = String(r.occurred_at || '');
      out.push({ date: d.slice(0, 10), amt: Number(r.amount) || null,
        who: r.counterparty || '',
        note: re.memo_display != null ? re.memo_display : (re.memo || ''),
        cat: cat, scope: r.staging_scope || 'family' });
    }
    return out;
  };

  /* Retire specific staged rows by id — local-first (survives a failed server
     delete), so a row assigned to a card from the detail screen cannot also
     reappear in the review to be imported twice. */
  /* Retire staged rows on the server. The queue holds two kinds since statement
     capture (77-statement-capture.js): sealed email rows, deleted by
     resolve_email_transactions, and statement rows, which live in their own table
     and remember a fingerprint so a re-sent statement does not ask twice. Every
     call site hands over ONE list and this splits it; the count returned is the
     total actually removed, which is what the "matched 0 rows" warnings read. */
  async function _stagedResolve(ids) {
    var split = window.fhStmtSplitIds ? window.fhStmtSplitIds(ids) : { email: ids || [], stmt: [] };
    var n = 0;
    if (split.email.length) n += Number(await _rpc('resolve_email_transactions', { p_ids: split.email })) || 0;
    if (split.stmt.length && window.fhStmtRetire) n += Number(await window.fhStmtRetire(split.stmt)) || 0;
    return n;
  }

  window.fhStagedRetireIds = async function (ids) {
    if (!ids || !ids.length) return false;
    _stagedRetiredAdd(ids);
    try { await _stagedResolve(ids); return true; }
    catch (e) { console.warn('staged retire (targeted) failed', e, { ids: ids }); return false; }
  };

  /* ── notices: mail that moves no money (email-reading-v2-spec §6) ───────────
     A card due notice or a "statement ready" mail is sealed and staged like any
     row, with row_kind = 'notice'. It is never a review card, never a toast,
     never a push. This pass opens each one with the same opener, writes what it
     states onto the MATCHING account, and retires it through the same RPC.

     The account is matched, never created: same provider AND the same last four
     digits, among the person's credit cards, exactly one hit. A notice for a
     card the person has not set up is simply retired. "Wrong card is worse than
     no card": anything short of one exact match applies nothing.

     What it writes:
       due_day / statement_day   onto the account, only where the person has not
                                 set one. What they typed is never overwritten.
       this cycle's due date, the minimum payment and the closing debt
                                 kept on THIS device, encrypted under the personal
                                 key, for the one quiet line on the account tile
                                 (23-debts-ui.js). The closing debt is never
                                 written as a balance: cards do not receive a
                                 captured balance (account-setup-spec). */
  var _fhNoticeBusy = false, _fhNoticeAt = 0;
  window.fhAcctNoticeFacts = {};   // accountId -> { due, stmt, minK, debtK, at }, decrypted, in memory only
  function _noticeKey() {
    var uid = (window.fhUser && window.fhUser.id) || '';
    return uid ? 'fh-acct-notice:' + uid : '';
  }
  async function _noticeLoad() {
    try {
      var k = _noticeKey(), pd = window.fhPersonalData && window.fhPersonalData();
      if (!k || !pd || !pd.key || !window.FHCrypto) return;
      var raw = localStorage.getItem(k); if (!raw) return;
      var v = JSON.parse(await FHCrypto.decVal(pd.key, raw));
      if (v && typeof v === 'object') window.fhAcctNoticeFacts = v;
    } catch (e) {}
  }
  async function _noticeSave() {
    try {
      var k = _noticeKey(), pd = window.fhPersonalData && window.fhPersonalData();
      if (!k || !pd || !pd.key || !window.FHCrypto) return;
      localStorage.setItem(k, await FHCrypto.encVal(pd.key, JSON.stringify(window.fhAcctNoticeFacts || {})));
    } catch (e) {}
  }
  /* Which owned card a notice is about → its account, or null. Pure. */
  function fhNoticeTarget(provider, x, accounts) {
    var canon = function (s) { return (typeof csvCanonicalProvider === 'function') ? csvCanonicalProvider(s) : String(s || '').toLowerCase(); };
    var tail = String((x && (x.card_masked || x.account_masked)) || '').replace(/\D/g, '').slice(-4);
    var prov = canon(provider);
    if (tail.length !== 4 || !prov) return null;
    var hits = (accounts || []).filter(function (a) {
      return a.kind === 'credit_card' && (a.tail || '') === tail && canon(a.provider) === prov;
    });
    return hits.length === 1 ? hits[0] : null;
  }
  window.fhNoticeTarget = fhNoticeTarget;
  /* What a notice states, in the ledger's units. Pure. Null when it states nothing usable. */
  function fhNoticeFacts(x) {
    var n = x && x.notice;
    if (!n || typeof n !== 'object') return null;
    var iso = function (v) { var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v || '')); return m ? m[0] : null; };
    var dayOf = function (d) { var k = d ? Number(d.slice(8, 10)) : 0; return (k >= 1 && k <= 31) ? k : null; };
    var base = function (v) {
      var a = Number(v); if (!(a > 0) || !isFinite(a)) return null;
      return window.csvBaseAmt ? window.csvBaseAmt(a) : a / (window.curMult ? window.curMult() : 1);
    };
    var due = iso(n.due_date), stmt = iso(n.statement_date);
    var out = { due: due, stmt: stmt, dueDay: dayOf(due), statementDay: dayOf(stmt),
                minK: base(n.min_payment), debtK: base(n.closing_debt) };
    return (out.due || out.stmt || out.minK != null || out.debtK != null) ? out : null;
  }
  window.fhNoticeFacts = fhNoticeFacts;

  var _fhNoticeLoaded = false;
  window.fhNoticesApply = async function () {
    if (_fhNoticeBusy) return 0;
    var pd = window.fhPersonalData && window.fhPersonalData();
    if (!pd || pd.state !== 'ready' || !pd.key) return 0;          // no ledger to match against: they wait, staged
    _fhNoticeBusy = true;
    try {
      /* What earlier notices said, back into memory once per session, so the tile
         line survives a reload. */
      if (!_fhNoticeLoaded) {
        _fhNoticeLoaded = true;
        await _noticeLoad();
        if (Object.keys(window.fhAcctNoticeFacts || {}).length) { try { window.renderPersonal && window.renderPersonal(); } catch (eL) {} }
      }
      if (_fhRowKindCol === false) return 0;                       // no column yet: there are no notices
      if (Date.now() - _fhNoticeAt < 10 * 60 * 1000) return 0;
      var res = await sb.from('email_transactions')
        .select('id,member_id,owner_user_id,staging_scope,gmail_message_id,source_provider,occurred_at,raw_extracted,sealed,eph_pub,nonce,enc_v,created_at')
        .eq('review_status', 'pending').eq('row_kind', 'notice')
        .order('occurred_at', { ascending: true }).limit(50);
      if (res.error) { if (_fhRowKindMissing(res.error)) _fhRowKindCol = false; return 0; }
      _fhRowKindCol = true; _fhNoticeAt = Date.now();
      var rows = res.data || [];
      if (!rows.length) return 0;
      var done = [], changed = false;
      for (var i = 0; i < rows.length; i++) {                       // oldest first, so the newest notice has the last word
        var r = await fhReadStagedRow(rows[i]);
        if (!r || r._unreadable) continue;                          // locked or wrong key: leave it staged, try again later
        done.push(rows[i].id);
        var x = r.raw_extracted || {};
        var facts = fhNoticeFacts(x);
        var acct = facts ? fhNoticeTarget(rows[i].source_provider, x, pd.accounts) : null;
        if (!acct) continue;                                        // no such account: the notice is simply retired
        var fields = {};
        if (facts.dueDay && !acct.dueDay) fields.dueDay = facts.dueDay;
        if (facts.statementDay && !acct.statementDay) fields.statementDay = facts.statementDay;
        if ((fields.dueDay || fields.statementDay) && window.fhPersonalAccountUpdate) {
          try { await window.fhPersonalAccountUpdate(acct.id, fields); } catch (eU) {}
        }
        window.fhAcctNoticeFacts[acct.id] = { due: facts.due, stmt: facts.stmt, minK: facts.minK, debtK: facts.debtK,
                                              at: String(rows[i].occurred_at || '') };
        changed = true;
      }
      if (changed) { await _noticeSave(); try { window.renderPersonal && window.renderPersonal(); } catch (eR) {} }
      if (done.length) { try { await _rpc('resolve_email_transactions', { p_ids: done }); } catch (eD) { console.warn('notice retire failed', eD); } }
      return done.length;
    } catch (e) { return 0; }
    finally { _fhNoticeBusy = false; }
  };

  /* Which transport imported a staged row → the ledger `source` (0100). The
     sealed payload carries `_transport`: the direct-read worker stamps
     'oauth_direct' (stage.mjs); the forwarding pipeline leaves it absent, so
     anything that is not the direct marker is forwarding. Only ever called for
     staged rows, which are all email. */
  window.fhStagedSource = function (c) {
    var rows = window._fhStagedRows;
    var r = (c && typeof c.rowIndex === 'number' && rows) ? rows[c.rowIndex] : null;
    var tr = r && r.raw_extracted && r.raw_extracted._transport;
    if (tr === 'statement') return 'statement-email';   // parsed from a statement file (statement-capture-spec.md)
    return tr === 'oauth_direct' ? 'direct-email' : 'forwarding-email';
  };

  /* A staged bank-email row's real transaction time → VN-local "HH:MM", for the
     promote path. occurred_at is a timestamptz (the bank's actual moment); we read
     it off the raw staged row via the candidate's rowIndex and format it in the
     device's local zone (VN). A date-only source is stored at UTC midnight — we
     return undefined for that (day-only) rather than fabricating a clock, since a
     real bank timestamp is never exactly 00:00:00 UTC. Returns undefined when there
     is no staged row (e.g. a CSV file candidate) or no usable time. */
  window.fhStagedRowTime = function (c) {
    var rows = window._fhStagedRows;
    if (!(c && typeof c.rowIndex === 'number' && rows && rows[c.rowIndex])) return undefined;
    var oa = rows[c.rowIndex].occurred_at; if (!oa) return undefined;
    var d = new Date(oa); if (isNaN(d.getTime())) return undefined;
    /* v2 STATES whether the mail carried a clock time (time_precision), so a real
       00:00:00 UTC (07:00 in Vietnam) is kept and a day-only mail stamped with any
       other hour is not given a clock it never had. v1 keeps the inference. */
    var tp = (rows[c.rowIndex].raw_extracted || {}).time_precision;
    if (tp === 'day') return undefined;
    if (tp !== 'second' && tp !== 'minute'
        && d.getUTCHours() === 0 && d.getUTCMinutes() === 0 && d.getUTCSeconds() === 0) return undefined;  // date-only placeholder
    return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  };

  /* ---- Review-modal loading overlay + chunked-decrypt progress ---------- */
  function _txrLoadShow(msg) {
    var el = document.getElementById('fh-txn-loading');
    if (!el) {
      el = document.createElement('div');
      el.id = 'fh-txn-loading';
      el.className = 'txr-loading';
      el.innerHTML = '<div class="txr-card"><div class="txr-spin"></div><div class="txr-lmsg"></div></div>';
      document.body.appendChild(el);
    }
    var m = el.querySelector('.txr-lmsg'); if (m) m.textContent = msg || '';
    return el;
  }
  function _txrLoadMsg(msg) {
    var el = document.getElementById('fh-txn-loading');
    var m = el && el.querySelector('.txr-lmsg'); if (m) m.textContent = msg || '';
  }
  function _txrLoadHide() {
    var el = document.getElementById('fh-txn-loading'); if (el) el.remove();
  }
  function _txrYield() {
    return new Promise(function (res) {
      (window.requestAnimationFrame || function (f) { setTimeout(f, 0); })(function () { res(); });
    });
  }

  window.fhTxnReviewSheet = async function (ctx) {
    // Key-mismatch alarm latched (18-staging-keys): approval is frozen for the
    // whole family until a verify passes again. Re-show the explanation rather
    // than a dead queue — the freeze must never look like a bug.
    if (window.fhStagingAlarmActive && window.fhStagingAlarmActive()) {
      window.fhStagingAlarmShow && window.fhStagingAlarmShow();
      return;
    }
    /* Entry context = the source of truth for THIS open, set here because every
       entry funnels through this one function — the two CTAs (which pass a scope)
       and the direct opens from push / OAuth settings / the settings row (which
       pass nothing and so default to the shared ledger). Set fresh each open and
       never persisted, so the card defaults reflect where the screen was opened
       from and a previous open's choice cannot linger. */
    window.csvEntryScope = window.fhNormScope ? window.fhNormScope(ctx) : (ctx || null);
    _txrLoadShow(L('Đang tải giao dịch…', 'Loading transactions…'));
    var raw;
    try {
      raw = await fhFetchStagedTxns();
    } catch (e) {
      _txrLoadHide();
      window.toast && window.toast(L('Chưa tải được giao dịch', 'Could not load transactions'));
      return;
    }

    /* If a page came back FULL, there may be more behind it. Saying so is the
       whole fix: the old cap was not wrong to exist, it was wrong to be
       invisible. */
    var maybeMore = raw.length >= TXN_REVIEW_PAGE;

    // Open each sealed box locally. NaCl open is synchronous CPU work, so a long
    // queue (a backfill of hundreds) would freeze the tap with no sign of life.
    // Decrypt in chunks, yielding to paint between them and showing progress —
    // the design rule is "a real round trip must not look frozen".
    var readable = [], locked = 0;
    for (var i = 0; i < raw.length; i++) {
      var r = await fhReadStagedRow(raw[i]);
      if (!r || r._unreadable) { locked++; }
      else { readable.push(r); }
      if (i % 20 === 0) {
        _txrLoadMsg(L('Đang mở khoá ', 'Unlocking ') + (i + 1) + '/' + raw.length);
        await _txrYield();
      }
    }

    /* Statement capture (77-statement-capture.js): rows already parsed from a
       statement join the SAME array, shaped exactly like an opened email row, so
       every accessor below that indexes _fhStagedRows by rowIndex reads them with
       no second code path. Unopened statements ride beside as cards. A failure
       here costs the statements, never the email queue. */
    var stmtCards = 0;
    if (window.fhStmtLoad) {
      try {
        var stmt = await window.fhStmtLoad();
        readable = readable.concat(stmt.rows || []);
        locked += stmt.locked || 0;
        stmtCards = (stmt.cards || []).length;
      } catch (eS) { console.warn('statement load failed', eS); }
    }

    if (!readable.length && !stmtCards) {
      _txrLoadHide();
      _fhSheet('<div class="mbx-hero">' + _mbxGlyph('mail') + '</div>' +
        '<div class="sheet-h">' + _esc(L('Chưa có giao dịch mới', 'Nothing to review')) + '</div>' +
        '<div class="sheet-sub">' + _esc(locked
          ? L('Có giao dịch đang khoá — mở khoá ứng dụng để xem.',
              'Some transactions are locked — unlock the app to see them.')
          : L('Giao dịch từ email ngân hàng sẽ xuất hiện ở đây để bạn duyệt.',
              'Transactions from your bank email will appear here to review.')) + '</div>' +
        '<button class="btn-skip" onclick="_closeOv()">' + _esc(L('Đóng', 'Close')) + '</button>');
      return;
    }

    /* Keep the ROWS, in the order the review screen is about to receive them.
       Each candidate carries rowIndex (57-csv-import-review.js), an index into
       parsed.rows, and staged mode passes exactly one source — so
       _fhStagedRows[c.rowIndex].id maps a promoted candidate back to its staged
       row exactly, with no key matching to go wrong.

       This replaces a flat list of every id fetched. That list was the wrong
       set: csvPromote() writes only csvReview.ready, while retirement was told
       to delete EVERYTHING readable — so a row the screen parked in its
       duplicates section was deleted without ever reaching the ledger. Retiring
       more than was promoted is silent data loss, which is the one failure this
       screen exists to prevent. */
    window._fhStagedRows = readable;

    /* Eager account materialization (0109, T11): the census of the queue's
       instruments, own and counterpart alike — window.fhQueueAccountCensus,
       above, says what and why. Fire-and-forget: a slow insert must never hold
       the list. */
    window._fhQueueNewAccts = [];   // 0134: accounts this queue session materialized (the wizard treats them as "touched")
    window.fhQueueAccountCensus(readable).catch(function () {});

    window.csvStagedMode = true;   // reuse the review engine, drop its file-only chrome

    /* The duplicate matcher inside csvBuildReview is synchronous, so the
       personal slice it matches against (365-day horizon — a re-staged card can
       be that old, the tab cache reaches back one month) must be here BEFORE
       bucketing runs. Locked or failing personal ledger → empty slice → the
       matcher falls back to the short cache, and the queue still opens. */
    try {
      window._fhPersonalMatchSlice = window.fhPersonalMatchSlice
        ? await window.fhPersonalMatchSlice() : null;
    } catch (e) { window._fhPersonalMatchSlice = null; }

    csvLearnLoad();
    /* Synced lessons (0122): pull + merge the encrypted personal_lessons blob
       before the lending pass reads it. Best-effort — a failed sync degrades
       to whatever this device already knows, never blocks the queue. */
    try { if (window.fhLessonsSync) await window.fhLessonsSync(); } catch (e) {}
    csvBuildReview([fhStagedAsCsvSource(readable)], {});
    renderCsvReview();

    // Same screen, different framing: no file to pick, and the title should say
    // where these came from. The Save button's onclick is NOT rewired here — it's
    // a fixed dispatcher (csvSaveDispatch) that branches on csvStagedMode, so the
    // file flow can never inherit fhPromoteStaged (which would delete staged rows).
    var pick = document.getElementById('csv-pick'); if (pick) pick.style.display = 'none';
    var title = document.querySelector('#csv-import-modal .modal-title');
    if (title) title.textContent = L('Duyệt giao dịch', 'Review transactions');

    /* A partly-locked queue must SAY so. Before this, unopenable rows were
       counted and then shown to no one unless the whole queue was locked — so
       the first symptom of a locked device, a stale shell, or a real integrity
       failure would have been transactions quietly missing from a list that
       looks complete. The design promise is "degrades to a visible locked row,
       never silently vanishing" — this is the visible half. Same element is
       removed and re-added each open so the count never goes stale. */
    var oldNote = document.getElementById('fh-txn-locked-note');
    if (oldNote) oldNote.remove();
    if (locked > 0) {
      var note = document.createElement('div');
      note.id = 'fh-txn-locked-note';
      note.className = 'mbx-locked-note';
      note.textContent = L(
        locked + ' giao dịch chưa mở khoá được. Hãy mở khoá ứng dụng hoặc tải lại trang, rồi mở lại mục này.',
        locked + (locked === 1 ? ' transaction' : ' transactions') + ' could not be unlocked. Unlock the app or reload, then open this again.');
      var modalTitle = document.querySelector('#csv-import-modal .modal-title');
      if (modalTitle && modalTitle.parentNode) modalTitle.parentNode.insertBefore(note, modalTitle.nextSibling);
    }

    /* Same treatment for a full page, and for the same reason the locked note
       exists: the failure this screen must never have is rows that are counted
       and then shown to no one. A truncated queue looks complete, so the person
       promotes everything, sees the list empty, and never learns there was
       more — the rest would surface later and read as transactions arriving
       late rather than as a page they had not reached. */
    var oldMore = document.getElementById('fh-txn-more-note');
    if (oldMore) oldMore.remove();
    if (maybeMore) {
      var more = document.createElement('div');
      more.id = 'fh-txn-more-note';
      more.className = 'mbx-locked-note';
      more.textContent = L(
        'Đang hiện ' + readable.length + ' giao dịch đầu tiên. Duyệt xong nhóm này rồi mở lại để xem tiếp.',
        'Showing the first ' + readable.length + '. Review these, then open this again for the rest.');
      var mt2 = document.querySelector('#csv-import-modal .modal-title');
      if (mt2 && mt2.parentNode) mt2.parentNode.insertBefore(more, mt2.nextSibling);
    }

    _txrLoadHide();
    openSheet('csv-import-modal');
  };

  /* Which staged rows has the person FINISHED with?

     Two answers count as finished, and only one of them is an import:
       • imported — it is in `ready` and about to be written to the ledger.
       • removed on purpose — they tapped ✕ on it, or skipped it as a duplicate.
         0060 retires rejections for exactly this reason: "the user has said this
         is not a transaction they want; keeping it would mean the queue slowly
         fills with things they already dismissed."

     So this is defined by exclusion: everything EXCEPT the rows still waiting for
     a decision. That is the only formulation that catches all of it, because the
     ✕ handlers (csvReadyRemove, csvSkipGroup, csvDeferDrop) SPLICE the candidate
     out of csvReview — after the tap there is nothing left to ask about it, so a
     rule built from "what was removed" cannot see them at all. csvDupSkip is the
     odd one out: it marks resolved='skip' in place rather than splicing.

     Still waiting = groups (need a category), deferred (income/transfer/missing
     field), and duplicates nobody has ruled on. A dup marked 'done' was pushed
     into `ready`, so it is finished, not pending.

     Safe because the builder cannot silently drop a staged row: csvDropBlankRows
     needs BOTH amount and date missing, and a staged row always has both. Every
     disappearance is therefore a person's doing.

     MUST be called BEFORE csvPromote(), which consumes csvReview.ready.

     If the review state is unreadable we retire NOTHING rather than guess. An
     unretired row is visible clutter and a toast; an over-retired one is a
     transaction deleted that never reached the ledger. Only one of those is
     recoverable.

     Extracted by name in tools/staged-retire.test.js; keep the signature. */
  function fhStagedIdsForResolved(rows, review) {
    var src = rows || [];
    if (!src.length) return [];
    if (!review || !Array.isArray(review.ready)) return [];

    var pending = {};
    var hold = function (c) { if (c && typeof c.rowIndex === 'number') pending[c.rowIndex] = 1; };
    (review.groups || []).forEach(function (g) { ((g && g.items) || []).forEach(hold); });
    (review.deferred || []).forEach(hold);
    /* Unticked rows are "not this time", which is a form of still-waiting: they
       were never written, so retiring them would delete a transaction the person
       deliberately kept. The ✕ is how you say never; leaving a tick off is not. */
    (review.ready || []).forEach(function (c) { if (c && c._skipImport) hold(c); });
    (review.dup || []).forEach(function (d) {
      if (!d) return;
      if (d.resolved === 'skip' || d.resolved === 'done') return;   // decided either way
      hold(d.c);
    });

    var out = [];
    for (var i = 0; i < src.length; i++) {
      if (pending[i]) continue;
      if (src[i] && src[i].id) out.push(src[i].id);
    }
    return out;
  }
  window.fhStagedIdsForResolved = fhStagedIdsForResolved;

  /* Retire ONE row, the moment ✕ confirms it.

     Removal used to be banked until an Import, which meant it was banked until
     possibly never: closing the sheet dropped it, and removing every row greyed
     Import out so it could not be spent at all. The row survived, came back on
     the next open, and the ✕ looked broken.

     Same order as the batch path — remember locally first, then ask the server —
     so a failed delete still keeps the row out of this device's queue instead of
     resurrecting something the person has already said no to twice. */
  window.fhStagedDropOne = async function (c) {
    var rows = window._fhStagedRows || [];
    var row = (c && typeof c.rowIndex === 'number') ? rows[c.rowIndex] : null;
    var id = row && row.id;
    if (!id) return;
    _stagedRetiredAdd([id]);
    try {
      var removed = await _stagedResolve([id]);
      if (!removed) console.warn('staged drop: matched 0 rows', { ids: [id] });
    } catch (e) {
      console.warn('staged drop failed', e, { ids: [id] });
    }
    try { if (window.fhRefreshStagedCount) await window.fhRefreshStagedCount(); } catch (e) {}
  };

  /* Retire MANY rows in one call — the bulk ✕ in the review screen.

     Deliberately not a loop over fhStagedDropOne: that would be one RPC per row,
     so clearing forty rows of overnight backfill would be forty round trips, each
     one able to fail on its own and leave the queue half-cleared. The server side
     already takes a list (p_ids), so the honest shape is one call.

     Local-first, same as the single drop: every id is remembered as retired BEFORE
     the server is asked. A failed delete then still keeps the rows out of this
     device's queue, rather than resurrecting a whole batch the person has already
     dismissed. */
  window.fhStagedDropMany = async function (list) {
    var rows = window._fhStagedRows || [];
    var ids = (list || []).map(function (c) {
      var row = (c && typeof c.rowIndex === 'number') ? rows[c.rowIndex] : null;
      return row && row.id;
    }).filter(Boolean);
    if (!ids.length) return 0;
    _stagedRetiredAdd(ids);
    try {
      var removed = await _stagedResolve(ids);
      if (!removed) console.warn('staged drop: matched 0 rows', { ids: ids });
    } catch (e) {
      console.warn('staged bulk drop failed', e, { ids: ids });
    }
    try { if (window.fhRefreshStagedCount) await window.fhRefreshStagedCount(); } catch (e) {}
    return ids.length;
  };

  /* Import, then retire the staged rows.
     Deleting only AFTER the ledger write succeeds — the reverse order would lose
     a transaction outright if the write failed. Duplicating one is recoverable;
     losing one is not. */
  /* ONE press = ONE import. The button used to stay live while a 200-row batch
     ran, so every extra tap launched a full second import of the SAME selection,
     concurrent with the first — each writing the same transactions again. The
     sheet closing on its own while the screen kept flashing was exactly that:
     the first run finishing (closeModals) while its siblings were still
     writing. Latched here at module level, not just at the button, so a
     direct invocation is guarded too. The finally owns the overlay and the
     hydrate hold, so every early return inside the run drops both. */
  var _txrPromoting = false, _txrHeld = false;
  window.fhPromoteStaged = async function () {
    if (_txrPromoting) return;
    _txrPromoting = true; _txrHeld = false;
    try { return await _fhPromoteStagedRun(); }
    finally {
      _txrPromoting = false;
      _txrLoadHide();
      /* The one hydrate the whole batch paid for: after it, the Cá nhân tab
         and (if still open) the review modal repaint once, with everything. */
      if (_txrHeld) { _txrHeld = false; try { await window.fhPersonalHydrateRelease(); } catch (eH) {} }
    }
  };
  async function _fhPromoteStagedRun() {
    // Same freeze as fhTxnReviewSheet — belt and braces in case the alarm
    // latched between opening the sheet and pressing import.
    if (window.fhStagingAlarmActive && window.fhStagingAlarmActive()) {
      window.fhStagingAlarmShow && window.fhStagingAlarmShow();
      return;
    }
    /* FOREIGN CURRENCY at import (foreign-currency-emails-spec.md, zero-typing).
       A foreign row's c.amount is already the ESTIMATED VND (set in
       fhStagedAsCsvSource) or the person's own edited figure, so it writes like
       any VND row. Two things happen here:

       1. Provenance. The foreign original is appended to the note in a fixed,
          machine-readable form so a future multi-currency migration (decision
          #4) can recover it — "[111 USD]" for a person-confirmed or bank-
          converted amount, "[111 USD @26,350 +3% est.]" when the app estimated
          it, so an estimate is never mistaken later for an exact figure.

       2. The one hold that remains: a foreign row whose currency has NO rate,
          so no estimate exists AND the person never typed one. It cannot be
          written (there is no VND), so it is kept staged (_skipImport) rather
          than logged as a wrong number. With USD/EUR/… rates seeded this is the
          rare exotic-currency case, not the common path. */
    var fxHeld = 0;
    ((window.csvReview && csvReview.ready) || []).forEach(function (c) {
      if (!c || typeof c.rowIndex !== 'number' || !window.fhStagedFx) return;
      var fx = window.fhStagedFx(c.rowIndex);
      if (!fx) return;
      var hasEst = !!(fx.est && fx.est.vnd > 0);
      if (fx.kind === 'foreign' && !hasEst && !c._fxVnd) {
        if (!c._skipImport) { c._skipImport = true; fxHeld++; }
        return;
      }
      var orig = Number(fx.amount).toLocaleString('en-US', { maximumFractionDigits: 2 }) + ' ' + fx.currency;
      var estimated = (fx.kind === 'foreign' && hasEst && !c._fxVnd);
      var tag = estimated
        ? '[' + orig + ' @' + Math.round(fx.est.rate).toLocaleString('en-US')
            + (fx.est.fee ? ' +' + fx.est.fee + '%' : '') + ' est.]'
        : '[' + orig + ']';
      if ((c.description || '').indexOf('[' + orig) < 0) {
        c.description = ((c.description || '') + ' ' + tag).trim();
      }
    });
    if (fxHeld && window.toast) {
      toast(L(fxHeld + ' khoản ngoại tệ chưa có tỷ giá — nhập số tiền ₫ giúp nhé',
              fxHeld + ' foreign item(s) have no rate — enter the ₫ amount'));
    }

    /* Everything the person has finished with — imported OR removed on purpose.
       Read BEFORE csvPromote(), which consumes csvReview.ready, and before the
       ✕ handlers' splices become impossible to reason about. */
    var ids = fhStagedIdsForResolved(window._fhStagedRows, window.csvReview);

    /* Destination is per ROW now, so one press can be both. Split first, then
       do the personal writes BEFORE csvPromote — csvPromote consumes
       csvReview.ready, and reading a candidate out of it afterwards reads a list
       that has already been emptied. */
    var picked = (typeof csvStagedSelected === 'function') ? csvStagedSelected() : [];
    var mine = [], theirs = [], famInc = [];
    picked.forEach(function (c) {
      if (typeof csvRowScope === 'function' && csvRowScope(c) === 'personal') mine.push(c);
      /* A family-scoped INCOME row goes to the family income book — the family
         expense importer (csvPromote) writes expenses only, and money-in must
         never ride into it as spending (0109). */
      else if (c.isIncome && !c._xfer && !c._repay && !c._invest) famInc.push(c);
      else theirs.push(c);
    });
    if (!picked.length) return;

    /* From here the press is COMMITTED: overlay up (the same design rule the
       decrypt loop follows — a real round trip must not look frozen), and the
       per-write re-hydrate HELD so 200 rows cost ONE hydrate at the end, not
       200 × (four queries + a whole-ledger decrypt + two repaints of this very
       modal). The wrapper's finally owns both, so every return below drops the
       overlay and releases the hold. */
    _txrLoadShow(L('Đang nhập 0/' + picked.length + '…', 'Importing 0/' + picked.length + '…'));
    if (mine.length && window.fhPersonalHydrateHold) { window.fhPersonalHydrateHold(); _txrHeld = true; }

    var srows = window._fhStagedRows || [];
    var stagedIdOf = function (cc) {
      var r = (cc && typeof cc.rowIndex === 'number') ? srows[cc.rowIndex] : null;
      return (r && r.id) || null;
    };

    /* Phase 1 — resolve every personal candidate to row spec(s), in memory.
       Model Y (0079): personal rows are their own owner-scoped table under a
       per-user key, so these are different writes, not a flag on the family
       ones. space_id stays null — a bank transaction sent here is private and
       there is no un-share. Account ensure() is a P.accounts lookup after the
       queue's eager materialization, so this phase costs no round trips on the
       common path. One candidate can span TWO specs (a transfer pair); ranges
       records the span so progress and retirement speak in candidates. */
    var pd = (window.fhPersonalData && window.fhPersonalData()) || { accounts: [] };
    /* 0144 — the tree node for a personal spec. The review resolved it on the
       candidate (_node); it is accepted only when it belongs to the kind being
       written, so an expense node can never ride an income row. */
    var _specNode = function (c, kind) {
      var nd = c && c._node;
      if (!nd || !window.FH_TAX || !FH_TAX.get(nd)) return null;
      return FH_TAX.kindOf(nd) === kind ? nd : null;
    };
    /* payload v2 seals a node for ANY kind (a transfer is `bankbank`, a payroll
       credit is `wage`). Expense and income have always carried theirs; the other
       four kinds start carrying one only for a v2 row, so a v1 row writes exactly
       what it always wrote. Still guarded by kind, like every node. */
    var _v2Node = function (c, kind) { return (c && c._v2) ? _specNode(c, kind) : null; };
    /* 0144 Q12/Q13 — THE LABEL, stored on the row. Every writer has accepted one
       since the migration (`fhPersonalAddMany` reads `s.labelId`) and nothing
       ever set it: 0 of 240 rows on a real ledger carry a label_id, which leaves
       the per-row override and the regroup's "Áp dụng cho N khoản cũ?" with
       nothing to work on. The node decides it, through the person's own
       partition; a node that resolves to no label passes null, unchanged. */
    var _specLabel = function (node) {
      if (!node || !window.fhPersonalLabelFor) return null;
      try { var hit = fhPersonalLabelFor(node); return (hit && hit.label) || null; } catch (e) { return null; }
    };
    var _labelId = function (node) { var l = _specLabel(node); return (l && l.id) || null; };
    /* …and what the row is CALLED. The review resolves a category name through
       `familyCatForConcept` — the FAMILY's categories — even for a row headed
       for the personal book, which is how those same 240 rows all stored the
       English family catch-all "Others" in cat_name_enc. A personal row belongs
       to the person's own labels, so when the node resolves to a real label of
       theirs, that label names the row. Narrow on purpose: a name the person
       picked on the card is theirs and is never overwritten, and a person with
       no labels keeps today's behaviour exactly. */
    var _persCat = function (node, name, emoji) {
      var l = _specLabel(node);
      var isCatchAll = !!(l && (l.claims || []).length === 1 && l.claims[0] === '*');
      var picked = String(name || '').trim();
      var generic = !picked || (window.isFallbackCat && isFallbackCat(picked));
      if (l && l.name && !isCatchAll && generic) return { name: l.name, emoji: l.emoji || emoji || '🗂️' };
      return { name: name || null, emoji: emoji || '🗂️' };
    };
    /* The other side, as its own encrypted column (counterparty_enc). Expense
       rows have carried it since 0132; income, transfer and investment rows
       dropped it although the writer has always had the column. Only a REAL
       counterparty rides, never the description. On an investment leg it names
       the broker or seller beside the note and tracks nothing: balances are only
       ever built from loan and repayment rows (investment-spec I1 stands). */
    var _who = function (c) { return (c && c.counterparty && String(c.counterparty).trim()) || null; };
    var specs = [], ranges = [], extBals = {}, lessonOps = [], invMemOps = [];
    /* 0134 — every account this import touches (a row landed on it, or the
       queue session materialized it) is what the setup wizard walks afterwards
       (account-setup-spec §4). Filled from the personal specs, the family
       tags, and the queue's census; filtered to un-anchored, un-skipped
       accounts by fhPersonalAccountSetupNeeded when it fires. */
    var touchedAccts = {};
    ((window._fhQueueNewAccts) || []).forEach(function (nid) { touchedAccts[nid] = 1; });
    for (var i = 0; i < mine.length; i++) {
      var c = mine[i];
      /* Lesson bookkeeping (0122, spec Q20c) — resolved AFTER the write lands:
         a confirmed loan (picked or a pre-select left standing) strengthens its
         lesson; a fired lesson the person flipped away weakens it by one. */
      if (window.fhKindLearn && typeof csvLearnKey === 'function') {
        if (c._loan) {
          var _lw = (c._loanWho || '').trim() || (c.counterparty || '').trim();
          var _lk = c._lessonKey || csvLearnKey(c);
          if (_lk && _lw) lessonOps.push({ op: 'learn', key: _lk, who: _lw });
        } else if (c._lessonKey && c._lessonWhy === 'learned') {
          lessonOps.push({ op: 'weaken', key: c._lessonKey });
        }
      }
      /* c.amount is DISPLAY currency (a bank email's "45.000" is 45000 here),
         exactly like the CSV review. The personal writes store BASE units
         (÷curMult, 1000 for VND) — the same conversion the family write does
         via parseAmtBase. Passing c.amount raw stored 1000× too much (the
         ".000đ" inflation), so run it through csvBaseAmt first, identical to
         what the review already showed. */
      var base = window.csvBaseAmt ? window.csvBaseAmt(c.amount)
        : Math.round(Number(c.amount || 0) / (window.curMult ? window.curMult() : 1));
      /* The reviewed time rides EVERY kind below, not only expense and income.
         The writer stores it for any kind, and a transfer, a card payment, a
         loan, a repayment or an investment is as much "at 14:05" as a purchase
         is: five kinds used to land day-only because their specs left it out
         (email-reading-v2-spec §15). Both legs of a pair carry the same time,
         one event. A day-only source gives '' here and stays day-only. */
      var _t = window.csvRowTime ? window.csvRowTime(c) : undefined;   // reviewed time (edited value wins, else derived from occurred_at)
      var src = window.fhStagedSource ? window.fhStagedSource(c) : null;  // 'direct-email' | 'forwarding-email' (0100 provenance)
      /* Which way the money moved. isIncome doubles as the direction under every
         kind (the Kind control never clears it), with one exception: a statement
         row pre-set as an internal transfer has isIncome cleared at build and
         carries its direction on _xferDir instead (57). The same test the review
         card makes, so the sign written is the direction the person was shown. */
      var _moneyIn = !!c.isIncome || c._xferDir === 'in';
      /* Instrument (0105): the classifier's verdict rides in raw_extracted.
         Never lets a resolution error block the import — the row just lands
         untagged. */
      var ai = null;
      try { ai = window.fhStagedAcct ? window.fhStagedAcct(c) : null; } catch (eAcct) { ai = null; }
      var _sx2 = null;
      try { _sx2 = window.fhStagedRawX ? window.fhStagedRawX(c.rowIndex) : null; } catch (eSx) {}
      /* The captured "Số dư" (balance_after): stored on the resolved NON-card
         account so the drift badge argues against the bank's own number (0109
         §5.2). Recorded per ACCOUNT here, newest day wins, and written ONCE
         per account after the batch — the per-row version was one UPDATE round
         trip per row for a value only the newest row decides. */
      var _recBal = function (acctId) {
        var b = _sx2 && Number(_sx2.balance);
        if (!acctId || !(b > 0)) return;
        var acct = (pd.accounts || []).find(function (a) { return a.id === acctId; });
        if (acct && acct.kind === 'credit_card') return;
        var day = c.dateDisplay || '';
        if (!extBals[acctId] || day >= extBals[acctId].day) {
          extBals[acctId] = { day: day, amtK: window.csvBaseAmt ? window.csvBaseAmt(b) : b };
        }
      };
      if (c._xfer) {
        /* An own-account transfer leg (0109 spec T4): ALWAYS a pair. The
           captured side resolves from the classifier; the counterpart is the
           account picked on the card ('_cash' = the Tiền mặt account,
           auto-materialized). Both legs share one transfer_group_id; the sign
           lives inside the ciphertext. If only one side resolves, the leg
           books one-legged (legacy shape), signed by direction, so the money
           is at least recorded rather than lost. */
        var ownId = null, otherId = null;
        if (ai && window.fhPersonalAccountEnsure) { try { ownId = await window.fhPersonalAccountEnsure(ai); } catch (eO) {} }
        if (c._xferOtherId === '_cash' && window.fhPersonalCashAccount) { try { otherId = await window.fhPersonalCashAccount(); } catch (eC) {} }
        else if (c._xferOtherId) otherId = c._xferOtherId;
        var credit = _moneyIn;
        var xNote = c.description || 'Chuyển khoản nội bộ';
        if (ownId && otherId && ownId !== otherId) {
          var gid = crypto.randomUUID();
          specs.push({ kind: 'transfer', amt: -base, note: xNote, dateIso: c.dateDisplay || undefined, time: _t,
            who: _who(c), node: _v2Node(c, 'transfer'),
            accountId: credit ? otherId : ownId, transferGroupId: gid, source: src });
          specs.push({ kind: 'transfer', amt: base, note: xNote, dateIso: c.dateDisplay || undefined, time: _t,
            who: _who(c), node: _v2Node(c, 'transfer'),
            accountId: credit ? ownId : otherId, transferGroupId: gid, source: src });
        } else {
          var legAcct = ownId || otherId;
          specs.push({ kind: 'transfer',
            amt: legAcct === ownId ? (credit ? base : -base) : (credit ? -base : base),
            who: _who(c), node: _v2Node(c, 'transfer'),
            note: xNote, dateIso: c.dateDisplay || undefined, time: _t, accountId: legAcct, source: src });
        }
        if (ownId) _recBal(ownId);
      } else if (c._repay) {
        /* Repayment (0109 credit-side, 0122 both directions): draws the
           counterparty's balance toward zero. Sign follows the money — +X =
           they repaid me (credit row), −X = I repaid them (debit row). Tagged
           to the receiving/sending instrument so the account's derived balance
           moves with it (0122 extended fhPersonalBalance to loan/repayment). */
        var repAcct = null;
        if (ai && ai.kind !== 'credit_card' && window.fhPersonalAccountEnsure) {
          try { repAcct = await window.fhPersonalAccountEnsure(ai); } catch (eR) {}
        }
        specs.push({ kind: 'repayment', amt: _moneyIn ? base : -base,
          who: (c._repayWho || '').trim() || (c.counterparty || '').trim() || '—',
          note: c.description || null, dateIso: c.dateDisplay || undefined, time: _t,
          node: _v2Node(c, 'repayment'),
          accountId: repAcct, source: src });
        if (repAcct) _recBal(repAcct);
      } else if (c._loan) {
        /* Loan out (0122): opens a receivable — NOT an expense (no consumption;
           the money changed shape, not owner). +X = I lent X, per the 0105 sign
           convention. Wears the counterparty the review confirmed, the optional
           "hẹn trả" date, and the sending instrument. */
        var loanAcct = null;
        if (ai && ai.kind !== 'credit_card' && window.fhPersonalAccountEnsure) {
          try { loanAcct = await window.fhPersonalAccountEnsure(ai); } catch (eLn) {}
        }
        /* Money IN marked as a loan is money BORROWED (a lender's "giải ngân"):
           −X by the same 0105 sign convention, so it opens a payable and fills
           the receiving account. Before v2 no credit row could be a loan (the
           credit-side Kind sheet never offered it), so every existing row still
           takes the +X branch. */
        specs.push({ kind: 'loan', amt: _moneyIn ? -base : base,
          node: _v2Node(c, 'loan'),
          who: (c._loanWho || '').trim() || (c.counterparty || '').trim() || '—',
          note: c.description || null, dateIso: c.dateDisplay || undefined, time: _t,
          dueDate: c._loanDue || undefined, accountId: loanAcct, source: src });
        if (loanAcct) _recBal(loanAcct);
      } else if (c._invest) {
        /* Investment (0123, investment-spec §3): ONE leg, one real event — the
           card-payment shape, not a pair. A buy is money OUT (amount −X,
           quantity +q) accruing to the position; a sell is money IN (+X, −q)
           drawing it down. The seller stays in the note — a memo, never a
           counterparty. NOT an expense, NOT income: the money changed shape,
           not owner. No position picked → falls back to a plain row the
           person can convert later, rather than inventing a position. */
        var invAcct = null;
        if (ai && ai.kind !== 'credit_card' && window.fhPersonalAccountEnsure) {
          try { invAcct = await window.fhPersonalAccountEnsure(ai); } catch (eIv) {}
        }
        var invSell = _moneyIn;
        if (c._investPosId) {
          specs.push({ kind: 'investment', amt: invSell ? base : -base,
            positionId: c._investPosId,
            qty: (c._investQty > 0) ? (invSell ? -c._investQty : c._investQty) : undefined,
            who: _who(c), node: _v2Node(c, 'investment'),
            note: c.description || null, dateIso: c.dateDisplay || undefined, time: _t,
            accountId: invAcct, source: src });
          /* remember the seller → position mapping once the write lands (I9) */
          var _ik = (c.counterparty || c.description || '').trim();
          if (_ik) invMemOps.push({ key: _ik, posId: c._investPosId });
        } else if (invSell) {
          var _viNode = _specNode(c, 'income');
          specs.push({ kind: 'income', amt: base, note: c.description || '',
          node: _viNode, labelId: _labelId(_viNode),
            catName: 'Khác', catEmoji: '💰',
            dateIso: c.dateDisplay || undefined, time: _t, accountId: invAcct, source: src });
        } else {
          var _veNode = _specNode(c, 'expense');
          var _veCat = _persCat(_veNode, null, '🗂️');
          specs.push({ kind: 'expense', amt: base, note: c.description || '',
          node: _veNode, labelId: _labelId(_veNode),
            catName: _veCat.name, catEmoji: _veCat.emoji,
            dateIso: c.dateDisplay || undefined, time: _t, accountId: invAcct, source: src });
        }
        if (invAcct) _recBal(invAcct);
      } else if (c.isIncome) {
        /* Income is first-class on the spine since 0109: category (the
           income-side set), the receiving account (what makes a deposit
           balance computable), and the bank's real time all ride along. */
        var incAcct = null;
        if (ai && ai.kind !== 'credit_card' && window.fhPersonalAccountEnsure) {
          try { incAcct = await window.fhPersonalAccountEnsure(ai); } catch (e3) {}
        }
        var _iNode = _specNode(c, 'income');
        specs.push({ kind: 'income', amt: base, note: c.description || '',
          node: _iNode, labelId: _labelId(_iNode),
          who: _who(c),
          catName: c._incomeCat || 'Khác',
          catEmoji: ({ 'Lương': '💼', 'Thưởng': '🎁', 'Hoàn tiền': '💸' })[c._incomeCat] || '💰',
          dateIso: c.dateDisplay || undefined, time: _t, accountId: incAcct, source: src });
        _recBal(incAcct);
      } else if (c.isTransfer) {
        /* A card payment pays off a CARD — drawing its balance down — not the
           bank account the money left. So it is tagged to the card, never to
           the sending instrument. The card is known when the mail is the
           card's own "payment received" alert (ai.kind === 'credit_card');
           otherwise a one-card wallet has only one answer. Ambiguous (several
           cards) → untagged, and assignable later from the card's own detail
           screen. Either way it is a transfer, out of every spend total. */
        var payCard = c._payCardId || null;   // an explicit pick in the expanded review card wins
        var payFrom = null;                   // the SENDING account, when the mail named it
        /* Which card this pays off, from the mail's own evidence: card_masked
           (Layer 2) → the card-side account_masked → a card tail in the memo →
           one-card default. One shared resolver with the review candidate
           builder, so the pre-selected "Trả cho thẻ" and the imported card can
           never disagree (card-repayment-routing-spec.md §8). Owned cards only;
           an unnamed card stays untagged, never guessed. */
        if (!payCard && window.fhResolveRepaidCard) {
          payCard = window.fhResolveRepaidCard(_sx2, ai, c.description) || null;
        }
        /* The classifier's kind is a claim; the resolved account's kind is a
           fact. VIB's payment mail says account_kind=credit_card while its
           account_masked is the sending DEPOSIT — and ensure() matches by
           number (T12), so trusting ai.kind here tagged the payment to the
           deposit and the card's outstanding never moved (2026-09-06). ensure()
           still runs: it names the SENDING account (payFrom) for the two-leg
           pair, and materializes a card-side alert's card when it isn't owned
           yet (the one case the resolver above, which matches owned cards only,
           can't cover). */
        if (ai && window.fhPersonalAccountEnsure) {
          var _ownId = null;
          try { _ownId = await window.fhPersonalAccountEnsure(ai); } catch (e1) {}
          var _ownRec = _ownId && (pd.accounts || []).find(function (a) { return a.id === _ownId; });
          if (_ownRec && _ownRec.kind === 'credit_card') { if (!payCard) payCard = _ownId; }
          else if (_ownRec) payFrom = _ownId;
        }
        var _payNote = c.description || 'Thanh toán thẻ';
        if (payCard && payFrom && payCard !== payFrom) {
          /* Both sides known → the pair the full-ledger spec §7.3 allows: the
             deposit's leg (−) keeps its balance honest, the card's leg (+)
             draws the outstanding down, one group id keeps them one event. */
          var _pgid = crypto.randomUUID();
          specs.push({ kind: 'transfer', amt: -base, note: _payNote, node: _v2Node(c, 'transfer'),
            dateIso: c.dateDisplay || undefined, time: _t, accountId: payFrom, transferGroupId: _pgid, source: src });
          specs.push({ kind: 'transfer', amt: base, note: _payNote, node: _v2Node(c, 'transfer'),
            dateIso: c.dateDisplay || undefined, time: _t, accountId: payCard, transferGroupId: _pgid, source: src });
        } else {
          specs.push({ kind: 'transfer', amt: base, note: _payNote, node: _v2Node(c, 'transfer'),
            dateIso: c.dateDisplay || undefined, time: _t, accountId: payCard, source: src });
        }
        if (payFrom) _recBal(payFrom);   // the mail's "Số dư" is the sending account's
      } else {
        /* An expense tags its instrument (a credit-card purchase is what
           BUILDS that card's balance). Auto-materializes the account (Q15). */
        var acctId = null;
        if (ai && window.fhPersonalAccountEnsure) { try { acctId = await window.fhPersonalAccountEnsure(ai); } catch (e2) {} }
        /* `who` (0132, habit-streak-spec §10): the structured merchant, kept as
           its own encrypted column instead of dying into the note — the streak
           matcher and every later merchant feature read it. Only a REAL
           counterparty rides; a description-only row stays null rather than
           duplicating the note into a second column. */
        var _xNode = _specNode(c, 'expense');
        var _xCat = _persCat(_xNode, c.categoryName,
          (window.catStyle && window.catStyle[c.categoryName] && window.catStyle[c.categoryName][0]) || '🗂️');
        specs.push({ kind: 'expense', amt: base, note: c.description || '',
          node: _xNode, labelId: _labelId(_xNode),
          who: (c.counterparty && String(c.counterparty).trim()) || null,
          catName: _xCat.name,
          catEmoji: _xCat.emoji,
          dateIso: c.dateDisplay || undefined, time: _t, accountId: acctId, source: src });
        _recBal(acctId);
      }
      /* payload v2: the printed fee is its own small expense on the SAME account
         (full-ledger-spec §3.4), so the transfer stays a clean pair and the fee
         still counts as spending. Written in the same INSERT as its parent
         (`withPrev`): a chunk boundary between the two, and a failure on the
         second chunk, would retry the whole candidate and write the parent
         twice. Inside the candidate's range, so it is retired with its parent. */
      if (c._fee && c._fee.on && c._fee.amount > 0) {
        var feeAcct = null;
        if (ai && window.fhPersonalAccountEnsure) { try { feeAcct = await window.fhPersonalAccountEnsure(ai); } catch (eFe) {} }
        var feeBase = window.csvBaseAmt ? window.csvBaseAmt(c._fee.amount)
          : Math.round(Number(c._fee.amount) / (window.curMult ? window.curMult() : 1));
        var _feeNode = (c._fee.node && window.FH_TAX && FH_TAX.get(c._fee.node) && FH_TAX.kindOf(c._fee.node) === 'expense') ? c._fee.node : null;
        var _feeCat = _persCat(_feeNode, null, '🗂️');
        specs.push({ kind: 'expense', amt: feeBase, note: L('Phí giao dịch', 'Transaction fee'),
          node: _feeNode, labelId: _labelId(_feeNode),
          catName: _feeCat.name, catEmoji: _feeCat.emoji, withPrev: true,
          dateIso: c.dateDisplay || undefined, time: _t, accountId: feeAcct, source: src });
      }
      ranges.push({ c: c, to: specs.length });
    }

    /* Phase 2 — ONE bulk write, in chunks. As each chunk lands, its candidates
       are remembered as retired LOCALLY, so a batch killed mid-way (tab
       closed, app backgrounded, network gone) cannot resurrect rows whose
       ledger copies already exist — the previous shape retired nothing until
       every row was written, which turned any interruption into duplicates on
       the next press. */
    var doneCands = [];
    var res = { ok: true, written: 0 };
    if (specs.length) {
      if (!window.fhPersonalAddMany) { window.toast && window.toast(L('Chưa lưu được', 'Could not save')); return; }
      res = await window.fhPersonalAddMany(specs, async function (written) {
        var landed = [];
        for (var ri = 0; ri < ranges.length; ri++) {
          if (ranges[ri].to <= written && doneCands.indexOf(ranges[ri].c) === -1) {
            doneCands.push(ranges[ri].c);
            var sid = stagedIdOf(ranges[ri].c);
            if (sid) landed.push(sid);
          }
        }
        if (landed.length) _stagedRetiredAdd(landed);
        _txrLoadMsg(L('Đang nhập ' + doneCands.length + '/' + picked.length + '…',
                      'Importing ' + doneCands.length + '/' + picked.length + '…'));
        await _txrYield();
      });
      if (!res.ok) {
        /* A chunk failed. Everything before it IS in the ledger — retire those
           staged rows server-side too, then hand the review back with only the
           unwritten remainder so the next press retries just the rest.
           Retiring more than was written is silent data loss; retiring less is
           the duplicate. Exactness is why chunks never split a candidate. */
        var doneIds = doneCands.map(stagedIdOf).filter(Boolean);
        if (doneIds.length) {
          try { await _stagedResolve(doneIds); }
          catch (eRp) { console.warn('partial retire failed', eRp, { ids: doneIds }); }
        }
        // Zero written is not a partial save — it is a plain failure (locked
        // ledger, no network), and "Đã lưu 0/200" would read as progress.
        window.toast && window.toast(doneCands.length
          ? L('Đã lưu ' + doneCands.length + '/' + picked.length + ' khoản — bấm Nhập để tiếp tục phần còn lại.',
              'Saved ' + doneCands.length + ' of ' + picked.length + ' — press Import again for the rest.')
          : L('Chưa lưu được', 'Could not save'));
        try {
          window.csvReview.ready = ((window.csvReview && csvReview.ready) || [])
            .filter(function (cc) { return doneCands.indexOf(cc) === -1; });
          window.renderCsvReview && window.renderCsvReview();
        } catch (eV) {}
        try { window.fhRefreshStagedCount && window.fhRefreshStagedCount(); } catch (eN) {}
        return;
      }
    }

    /* Lessons commit only once the rows they describe are really in the ledger
       — learning from a write that failed would teach a phantom. */
    try {
      lessonOps.forEach(function (o) {
        if (o.op === 'learn') window.fhKindLearn(o.key, o.who);
        else window.fhKindWeaken(o.key);
      });
    } catch (eLo) {}

    /* Seller → position memory (0123, I9) — same posture as the lessons:
       remember only what actually landed in the ledger. Fire-and-forget. */
    try {
      invMemOps.forEach(function (o) {
        if (window.fhInvMemorySave) window.fhInvMemorySave(o.key, o.posId);
      });
    } catch (eIm) {}

    /* The freshest captured "Số dư" per account — a handful of UPDATEs for the
       whole batch, after the rows they describe. Best-effort side-signal. */
    for (var ab in extBals) {
      if (!window.fhPersonalExtBalanceSet) break;
      try { await window.fhPersonalExtBalanceSet(ab, extBals[ab].amtK, extBals[ab].day || undefined); } catch (eEb) {}
    }

    try {
      /* Family-scoped income → the family income book (never the expense
         importer). Same base-unit conversion as the personal writes. */
      for (var fi2 = 0; fi2 < famInc.length; fi2++) {
        var cf = famInc[fi2];
        var fBase = window.csvBaseAmt ? window.csvBaseAmt(cf.amount)
          : Math.round(Number(cf.amount || 0) / (window.curMult ? window.curMult() : 1));
        var fOk = window.fhAddFamilyIncome ? await window.fhAddFamilyIncome(fBase, cf.description || '', cf.dateDisplay || undefined) : false;
        if (!fOk) throw new Error('family income write failed at row ' + fi2);
      }

      /* 0134 — a family-scoped row still names the author's instrument. The
         family ledger has no accounts, so the tag rides to the author's mirror
         master: resolve the account here (a P.accounts lookup after the queue's
         eager materialization), reserve a link_id, and let the family writer
         create the tagged master (account-setup-spec §6). Locked ledger → no
         tag, exactly as before. Never lets a resolution error block the import. */
      if (theirs.length && pd && pd.state === 'ready' && window.fhPersonalAccountEnsure) {
        for (var ti = 0; ti < theirs.length; ti++) {
          var tc = theirs[ti], tAi = null;
          try { tAi = window.fhStagedAcct ? window.fhStagedAcct(tc) : null; } catch (eTa) {}
          if (!tAi) continue;
          try {
            var tId = await window.fhPersonalAccountEnsure(tAi);
            if (tId) { tc._pAcct = tId; tc._link = crypto.randomUUID(); touchedAccts[tId] = 1; }
          } catch (eTb) {}
        }
      }
      // csvPromote() returns its promise chain, so this genuinely waits for the
      // ledger writes. It did not always: an earlier version assumed a promise
      // and resolved instantly, which meant the delete below could race the
      // write and destroy a staged row whose transaction never landed.
      if (theirs.length) await csvPromote(theirs);

      if (mine.length) {
        window.toast && window.toast(theirs.length
          ? L('Đã lưu — ' + mine.length + ' khoản vào sổ cá nhân', 'Saved — ' + mine.length + ' to your personal ledger')
          : L('Đã ghi vào sổ cá nhân', 'Saved to your personal ledger'));
        // No renderPersonal here: the held hydrate's release repaints once,
        // with the data actually on the server.
      }
    } catch (e) {
      /* A family-side failure AFTER the personal rows landed: those are
         written and already retired above, so nothing duplicates — but the
         press did not finish, and saying nothing would repeat the silent-
         button bug this rewrite exists to kill. */
      window.toast && window.toast(L('Chưa lưu được', 'Could not save'));
      return;
    }
    if (!ids.length) return;

    /* Remember locally BEFORE asking the server, and keep it even if the server
       says no. The ledger write has already happened by this point, so from the
       person's side these rows are done — and the one thing that must not happen
       next is seeing them again and importing them twice. */
    _stagedRetiredAdd(ids);

    /* Two failures live here and they need DIFFERENT diagnoses — an earlier
       version of this printed one sentence for both, which made a permanently
       broken retirement look like a momentary lag:

         removed === 0  the function ran and matched nothing. The rows are real
                        and visible, so the mismatch is ownership: p_ids reached
                        a member_id that is not this user's. Retrying never fixes
                        it.
         throw          the call itself failed — 0060 absent, a different
                        argument name (PostgREST resolves by name AND args), a
                        revoked grant, or the network.

       Neither is "catching up", so neither says so. The console carries the
       detail, because this is the one place a person cannot see what went wrong
       and the queue now looks correct either way. */
    try {
      var removed = await _stagedResolve(ids);   // 0060
      window._fhStagedRows = [];
      if (!removed) {
        console.warn('staged retire: matched 0 rows', { ids: ids });
        window.toast && window.toast(L('Đã lưu, nhưng chưa xoá được bản nháp trên máy chủ.',
                                       'Saved, but the drafts could not be removed on the server.'));
      }
    } catch (e2) {
      console.warn('staged retire failed', e2, { ids: ids });
      window.toast && window.toast(L('Đã lưu, nhưng chưa xoá được bản nháp trên máy chủ.',
                                     'Saved, but the drafts could not be removed on the server.'));
    }

    /* Account setup (0134, account-setup-spec §4): the accounts this import
       touched that still have no anchor get the wizard now — the one moment
       the person has just seen the transactions and has the bank app in mind.
       Fired after the review closes below (a modal over a modal is a mess), and
       only from the full queue, never the one-row quick sheet (Q32). The
       once-only push offer that used to sit here moved to the first home
       render (55-push.js), so the two never compete for this moment. */
    specs.forEach(function (s) { if (s && s.accountId) touchedAccts[s.accountId] = 1; });
    var touchedIds = Object.keys(touchedAccts);
    if (touchedIds.length && window.fhAcctSetupAfterImport) {
      setTimeout(function () { try { window.fhAcctSetupAfterImport(touchedIds); } catch (eW) {} }, 650);
    }
    try { window.fhRefreshStagedCount && window.fhRefreshStagedCount(); } catch (e) {}   // queue shrank — update the badge

    /* The screen has to agree with the write. Retirement emptied the server
       queue and _fhStagedRows, but nothing here ever cleared what the person
       was LOOKING at — so imported rows sat on screen as if the press had done
       nothing, and tapping Nhập again would try to import rows that no longer
       exist anywhere. Rebuild from what is actually left: the rows they left
       unticked. Empty means close, because an empty review is not a screen. */
    try {
      var left = ((window.csvReview && window.csvReview.ready) || [])
        .filter(function (c) { return picked.indexOf(c) === -1; });
      if (left.length && typeof window.csvBuildReview === 'function') {
        window.csvReview.ready = left;
        window.renderCsvReview && window.renderCsvReview();
      } else {
        window.csvStagedMode = false;
        window.closeModals && window.closeModals();
      }
    } catch (e) { /* the ledger write already landed; the view is cosmetics */ }
  }
