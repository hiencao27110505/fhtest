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

  var TXN_REVIEW_PAGE = 200;   // a family's queue is small; one page is plenty

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
     also why an empty result is a real answer and not a permissions bug. */
  async function fhFetchStagedTxns() {
    var res = await sb.from('email_transactions')
      .select('*')
      .eq('review_status', 'pending')
      .is('duplicate_of_id', null)          // merged duplicates are never promoted
      .order('occurred_at', { ascending: false })
      .limit(TXN_REVIEW_PAGE);
    if (res.error) throw res.error;
    var rows = res.data || [];
    // Prune first, against the full server answer, so the local list shrinks as
    // the server catches up rather than accumulating ids nobody will ever see.
    var serverIds = rows.map(function (r) { return r.id; });
    _stagedRetiredPrune(serverIds);
    var retired = _stagedRetiredGet();
    if (!retired.length) return rows;
    return rows.filter(function (r) { return retired.indexOf(r.id) === -1; });
  }

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
      var priv = await window.fhStagingPrivKey();
      var payload = window.fhStagingOpenRow(row, priv);
      return {
        id: row.id, member_id: row.member_id,
        source_provider: row.source_provider, occurred_at: row.occurred_at,
        amount: payload.amount, currency: payload.currency,
        direction: payload.direction, counterparty: payload.counterparty,
        raw_extracted: payload,
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
  function fhStagedAsCsvSource(rows) {
    var COLS = ['occurred_at', 'description', 'amount', 'counterparty'];
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
      var isPerson = x.transaction_type === 'p2p_transfer';
      var description = x.memo || (isPerson ? '' : (r.counterparty || r.source_provider || ''));
      var amt = (r.direction === 'credit' ? '' : '-') + String(r.amount);
      return [r.occurred_at, description, amt, r.counterparty || ''];
    });

    return { parsed: { rows: out, headers: COLS }, result: { columnMap: columnMap },
             name: L('Email ngân hàng', 'Bank email') };
  }

  window.fhTxnReviewSheet = async function () {
    // Key-mismatch alarm latched (18-staging-keys): approval is frozen for the
    // whole family until a verify passes again. Re-show the explanation rather
    // than a dead queue — the freeze must never look like a bug.
    if (window.fhStagingAlarmActive && window.fhStagingAlarmActive()) {
      window.fhStagingAlarmShow && window.fhStagingAlarmShow();
      return;
    }
    var raw;
    try {
      raw = await fhFetchStagedTxns();
    } catch (e) {
      window.toast && window.toast(L('Chưa tải được giao dịch', 'Could not load transactions'));
      return;
    }

    var readable = [], locked = 0;
    for (var i = 0; i < raw.length; i++) {
      var r = await fhReadStagedRow(raw[i]);
      if (!r) { locked++; continue; }
      if (r._unreadable) { locked++; continue; }
      readable.push(r);
    }

    if (!readable.length) {
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
    /* Everything the person has finished with — imported OR removed on purpose.
       Read BEFORE csvPromote(), which consumes csvReview.ready, and before the
       ✕ handlers' splices become impossible to reason about. */
    var ids = fhStagedIdsForResolved(window._fhStagedRows, window.csvReview);

    try {
      // csvPromote() returns its promise chain, so this genuinely waits for the
      // ledger writes. It did not always: an earlier version assumed a promise
      // and resolved instantly, which meant the delete below could race the
      // write and destroy a staged row whose transaction never landed.
      await csvPromote();
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

    try {
      var removed = await _rpc('resolve_email_transactions', { p_ids: ids });   // 0060
      window._fhStagedRows = [];
      if (!removed) {
        // The RPC ran but matched nothing — usually 0060 is not applied, or the
        // rows belong to a different member. The queue now looks right either
        // way, but say so rather than let a broken retirement pass as working.
        window.toast && window.toast(L('Đã lưu. Danh sách sẽ tự dọn khi máy chủ bắt kịp.',
                                       'Saved. The queue will clear once the server catches up.'));
      }
    } catch (e2) {
      window.toast && window.toast(L('Đã lưu. Danh sách sẽ tự dọn khi máy chủ bắt kịp.',
                                     'Saved. The queue will clear once the server catches up.'));
    }

    /* They have just reviewed real transactions by hand, which is exactly the
       evidence that nothing told them the queue had filled. Offered here, once,
       and only if this member has never been asked (71-mailbox-ui). Placed after
       the cleanup rather than inside the success branch: the ledger write landed
       either way, so the moment is earned either way. */
    _mbxPushOfferOnce();
  };
