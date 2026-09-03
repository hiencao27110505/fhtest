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
  async function fhFetchStagedTxns() {
    var res = await sb.from('email_transactions')
      .select('id,member_id,owner_user_id,staging_scope,gmail_message_id,source_provider,occurred_at,amount,currency,direction,counterparty,reference_number,transaction_type,raw_extracted,duplicate_of_id,sealed,eph_pub,nonce,enc_v,created_at')
      .eq('review_status', 'pending')
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
      .limit(TXN_REVIEW_PAGE);
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
        var cnt = await sb.from('email_transactions')
          .select('id', { count: 'exact', head: true })
          .eq('review_status', 'pending');
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
    try { if (typeof window.renderCashflowEmailCta === 'function') window.renderCashflowEmailCta(); } catch (e) {}
    // The Cá nhân tab carries the same CTA and the same badge; it has to hear
    // the count change too, or one of the two goes stale after every promote.
    try { if (typeof window.renderPersonal === 'function') window.renderPersonal(); } catch (e) {}
  };

  /* The always-visible "Khoản thu chi từ email" CTA routes by setup state:
       • no linked email  → the setup intro (null state + "Get started" CTA)
       • linked           → the review sheet, which itself shows an empty modal
                            when there is nothing, or the list of cards. */
  window.fhEmailTxnCta = async function (preset) {
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
      var isPerson = x.transaction_type === 'p2p_transfer';
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
      var _fxHome = String(window.CUR || 'VND').toUpperCase();
      var _fxCur = String(r.currency || '').toUpperCase();
      var _fxEst = (_fxCur && _fxCur !== _fxHome && window.fhFxEstimate)
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
  window.fhStagedFx = function (rowIndex) {
    var rows = window._fhStagedRows;
    var r = (rows && typeof rowIndex === 'number') ? rows[rowIndex] : null;
    if (!r || r._unreadable) return null;
    var home = String(window.CUR || 'VND').toUpperCase();
    var cur = String(r.currency || '').toUpperCase();
    if (cur && cur !== home) {
      return { kind: 'foreign', currency: cur, amount: r.amount,
               est: window.fhFxEstimate(r.amount, cur) };
    }
    var x = r.raw_extracted || {};
    if (x.fx_amount != null && x.fx_currency && String(x.fx_currency).toUpperCase() !== home) {
      return { kind: 'converted', currency: String(x.fx_currency).toUpperCase(), amount: x.fx_amount };
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
     sealed boxes can never be amended — so for those only one LOCAL signal
     stands in: the wallet providers are wallets by identity. A full-length
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
    var kind = x.account_kind || null;
    if (!kind) {
      var prov = String(r.source_provider || '').toLowerCase();
      if (/momo|zalopay|shopeepay/.test(prov)) kind = 'ewallet';
    }
    if (!kind) return null;
    return { kind: kind,
             tail: masked.replace(/\D/g, '').slice(-4) || null,
             provider: (r && r.source_provider) || null };
  };

  /* Card-payment candidates still waiting in the inbox — for the card detail's
     "Ghi thanh toán thẻ" sheet, which lets a person assign one to a SPECIFIC
     card (the sending bank mail can't say which). Fetch + open + filter, read
     only: never touches the review's own _fhStagedRows state. A row is a
     card-payment candidate when the pipeline called it a transfer, when it is a
     credit-card "payment received" (credit into a card), or when its memo says
     so. Returns display-currency amounts, like the review's candidates. */
  var _CARD_PAY_RX = /thanh toan (sao ke |du no )?the|tt the tin dung|tra no the|thanh toan the (visa|master|jcb)|tra tien the tin dung/;
  window.fhStagedCardPayments = async function () {
    var raw;
    try { raw = await fhFetchStagedTxns(); } catch (e) { return []; }
    var out = [];
    for (var i = 0; i < raw.length; i++) {
      var r = await fhReadStagedRow(raw[i]);
      if (i % 25 === 0) { await new Promise(function (res) { setTimeout(res, 0); }); }   // yield, keep the tap alive
      if (!r || r._unreadable) continue;
      var re = r.raw_extracted || {};
      var memo = String(re.memo_display != null ? re.memo_display : (re.memo || r.counterparty || '')).toLowerCase();
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

  /* Retire specific staged rows by id — local-first (survives a failed server
     delete), so a row assigned to a card from the detail screen cannot also
     reappear in the review to be imported twice. */
  window.fhStagedRetireIds = async function (ids) {
    if (!ids || !ids.length) return false;
    _stagedRetiredAdd(ids);
    try { await _rpc('resolve_email_transactions', { p_ids: ids }); return true; }
    catch (e) { console.warn('staged retire (targeted) failed', e, { ids: ids }); return false; }
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
    if (d.getUTCHours() === 0 && d.getUTCMinutes() === 0 && d.getUTCSeconds() === 0) return undefined;  // date-only placeholder
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

    if (!readable.length) {
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

    /* Eager account materialization (0109): the queue is a CENSUS of the
       person's instruments — every staged row names the account it moved
       through (classifier kind · provider · tail). Materialize each distinct
       one now, not at import, so every picker (transfer counterpart, which-card)
       is complete the moment it renders and never asks the person to create an
       account the app has already seen. Names go through fhProviderName so a
       created account reads "VIB ••1234", not "vib ••1234". Fire-and-forget —
       a slow insert must never hold the list — and idempotent: ensure() keys
       on (kind, provider, tail), so reopening the queue creates nothing twice. */
    (async function () {
      try {
        var pdE = window.fhPersonalData && window.fhPersonalData();
        if (!pdE || pdE.state !== 'ready' || !window.fhPersonalAccountEnsure) return;   // locked ledger — pickers fall back as today
        var seenAi = {}, made = false;
        for (var ei = 0; ei < readable.length; ei++) {
          var aiE = null;
          try { aiE = window.fhStagedAcct ? window.fhStagedAcct({ rowIndex: ei }) : null; } catch (eA) {}
          if (!aiE) continue;
          var aiKey = aiE.kind + '|' + (aiE.provider || '') + '|' + (aiE.tail || '');
          if (seenAi[aiKey]) continue; seenAi[aiKey] = 1;
          var disp = (window.fhProviderName ? window.fhProviderName(aiE.provider || '') : (aiE.provider || '')) || '';
          try {
            var idE = await window.fhPersonalAccountEnsure(Object.assign({}, aiE,
              { name: disp ? (disp + (aiE.tail ? ' ••' + aiE.tail : '')) : null }));
            if (idE) made = true;
          } catch (eB) {}
        }
        if (made) { try { window.renderPersonal && window.renderPersonal(); } catch (eC) {} }
      } catch (eD) {}
    })();

    window.csvStagedMode = true;   // reuse the review engine, drop its file-only chrome
    csvLearnLoad();
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
      var removed = await _rpc('resolve_email_transactions', { p_ids: [id] });
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
      var removed = await _rpc('resolve_email_transactions', { p_ids: ids });
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
  window.fhPromoteStaged = async function () {
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
      else if (c.isIncome && !c._xfer && !c._repay) famInc.push(c);
      else theirs.push(c);
    });
    if (!picked.length) return;

    try {
      /* Model Y (0079): personal rows are their own owner-scoped table under a
         per-user key, so this is a different write, not a flag on the same one.
         space_id stays null — a bank transaction sent here is private and there
         is no un-share.

         If ANY personal row fails we stop before the family write and before
         retiring anything: a partly-done batch that has already deleted its
         staged rows has nothing left to retry from. */
      for (var i = 0; i < mine.length; i++) {
        var c = mine[i];
        /* c.amount is DISPLAY currency (a bank email's "45.000" is 45000 here),
           exactly like the CSV review. The personal writes store BASE units
           (÷curMult, 1000 for VND) — the same conversion the family write does
           via parseAmtBase. Passing c.amount raw stored 1000× too much (the
           ".000đ" inflation), so run it through csvBaseAmt first, identical to
           what the review already showed. */
        var base = window.csvBaseAmt ? window.csvBaseAmt(c.amount)
          : Math.round(Number(c.amount || 0) / (window.curMult ? window.curMult() : 1));
        var _t = window.csvRowTime ? window.csvRowTime(c) : undefined;   // reviewed time (edited value wins, else derived from occurred_at)
        var src = window.fhStagedSource ? window.fhStagedSource(c) : null;  // 'direct-email' | 'forwarding-email' (0100 provenance)
        /* Instrument (0105): the classifier's verdict rides in raw_extracted.
           Never lets a resolution error block the import — the row just lands
           untagged. */
        var ai = null;
        try { ai = window.fhStagedAcct ? window.fhStagedAcct(c) : null; } catch (eAcct) { ai = null; }
        var pd = (window.fhPersonalData && window.fhPersonalData()) || { accounts: [] };
        /* The captured "Số dư" (balance_after) rides along at commit: stored on
           the resolved NON-card account so the drift badge argues against the
           bank's own number (0109 §5.2). Base units, newest-wins. */
        var _sx2 = null;
        try { _sx2 = window.fhStagedRawX ? window.fhStagedRawX(c.rowIndex) : null; } catch (eSx) {}
        var _extBal = function (acctId) {
          try {
            var b = _sx2 && Number(_sx2.balance);
            if (!acctId || !(b > 0) || !window.fhPersonalExtBalanceSet) return;
            var acct = (pd.accounts || []).find(function (a) { return a.id === acctId; });
            if (acct && acct.kind === 'credit_card') return;
            var bb = window.csvBaseAmt ? window.csvBaseAmt(b) : b;
            window.fhPersonalExtBalanceSet(acctId, bb, c.dateDisplay || undefined);
          } catch (eB) {}
        };
        var ok;
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
          var credit = !!c.isIncome;
          if (ownId && otherId && ownId !== otherId) {
            ok = await window.fhPersonalAddTransferPair(base,
              credit ? otherId : ownId, credit ? ownId : otherId,
              c.description || 'Chuyển khoản nội bộ', c.dateDisplay || undefined, src);
          } else {
            var legAcct = ownId || otherId;
            var legAmt = legAcct === ownId ? (credit ? base : -base) : (credit ? -base : base);
            ok = await window.fhPersonalAddTransfer(legAmt, legAcct, c.description || 'Chuyển khoản nội bộ', c.dateDisplay || undefined, src);
          }
          if (ok && ownId) _extBal(ownId);
        } else if (c._repay) {
          /* Repayment received (0109): draws the counterparty's balance down —
             the review-side entry the borrowing-lending spec §5 wanted. +X =
             they repaid me (credit rows are the only ones offered this kind). */
          var who = (c._repayWho || '').trim() || (c.counterparty || '').trim() || '—';
          ok = await window.fhPersonalAddRepayment(base, who, c.description || null, c.dateDisplay || undefined, src);
          if (ok && ai && ai.kind !== 'credit_card' && window.fhPersonalAccountEnsure) {
            try { _extBal(await window.fhPersonalAccountEnsure(ai)); } catch (eR) {}
          }
        } else if (c.isIncome) {
          /* Income is first-class on the spine since 0109: category (the
             income-side set), the receiving account (what makes a deposit
             balance computable), and the bank's real time all ride along. */
          var incAcct = null;
          if (ai && ai.kind !== 'credit_card' && window.fhPersonalAccountEnsure) {
            try { incAcct = await window.fhPersonalAccountEnsure(ai); } catch (e3) {}
          }
          var incEmoji = ({ 'Lương': '💼', 'Thưởng': '🎁', 'Hoàn tiền': '💸' })[c._incomeCat] || '💰';
          ok = await window.fhPersonalAddIncome(base, c.description || '', c.dateDisplay || undefined, src,
            { catName: c._incomeCat || 'Khác', catEmoji: incEmoji, accountId: incAcct, time: _t });
          if (ok) _extBal(incAcct);
        } else if (c.isTransfer) {
          /* A card payment pays off a CARD — drawing its balance down — not the
             bank account the money left. So it is tagged to the card, never to
             the sending instrument. The card is known when the mail is the
             card's own "payment received" alert (ai.kind === 'credit_card');
             otherwise a one-card wallet has only one answer. Ambiguous (several
             cards) → untagged, and assignable later from the card's own detail
             screen. Either way it is a transfer, out of every spend total. */
          var payCard = c._payCardId || null;   // an explicit pick in the expanded review card wins
          if (!payCard) {
            if (ai && ai.kind === 'credit_card' && window.fhPersonalAccountEnsure) {
              try { payCard = await window.fhPersonalAccountEnsure(ai); } catch (e1) {}
            } else {
              var _cards = (pd.accounts || []).filter(function (a) { return a.kind === 'credit_card'; });
              if (_cards.length === 1) payCard = _cards[0].id;
            }
          }
          ok = await window.fhPersonalAddTransfer(base, payCard, c.description || 'Thanh toán thẻ', c.dateDisplay || undefined, src);
        } else {
          /* An expense tags its instrument (a credit-card purchase is what
             BUILDS that card's balance). Auto-materializes the account (Q15). */
          var acctId = null;
          if (ai && window.fhPersonalAccountEnsure) { try { acctId = await window.fhPersonalAccountEnsure(ai); } catch (e2) {} }
          var emoji = (window.catStyle && window.catStyle[c.categoryName] && window.catStyle[c.categoryName][0]) || '🗂️';
          ok = await window.fhPersonalAddExpense(base, c.description || '', c.categoryName || null, emoji, c.dateDisplay || undefined, _t, src, { accountId: acctId });
          if (ok) _extBal(acctId);
        }
        if (!ok) throw new Error('personal write failed at row ' + i);
      }

      /* Family-scoped income → the family income book (never the expense
         importer). Same base-unit conversion as the personal writes. */
      for (var fi2 = 0; fi2 < famInc.length; fi2++) {
        var cf = famInc[fi2];
        var fBase = window.csvBaseAmt ? window.csvBaseAmt(cf.amount)
          : Math.round(Number(cf.amount || 0) / (window.curMult ? window.curMult() : 1));
        var fOk = window.fhAddFamilyIncome ? await window.fhAddFamilyIncome(fBase, cf.description || '', cf.dateDisplay || undefined) : false;
        if (!fOk) throw new Error('family income write failed at row ' + fi2);
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
        if (typeof window.renderPersonal === 'function') window.renderPersonal();
      }
    } catch (e) {
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
      var removed = await _rpc('resolve_email_transactions', { p_ids: ids });   // 0060
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

    /* They have just reviewed real transactions by hand, which is exactly the
       evidence that nothing told them the queue had filled. Offered here, once,
       and only if this member has never been asked (71-mailbox-ui). Placed after
       the cleanup rather than inside the success branch: the ledger write landed
       either way, so the moment is earned either way. */
    _mbxPushOfferOnce();
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
  };
