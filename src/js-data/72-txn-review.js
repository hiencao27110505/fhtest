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
    return res.data || [];
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
      // memo is the payer's own words ("tra tien an trua thu 6") and the best
      // description we will ever have. Card purchases have no memo — there the
      // merchant IS the description, so counterparty stands in.
      var description = x.memo || r.counterparty || r.source_provider || '';
      var amt = (r.direction === 'credit' ? '' : '-') + String(r.amount);
      return [r.occurred_at, description, amt, r.counterparty || ''];
    });

    return { parsed: { rows: out, headers: COLS }, result: { columnMap: columnMap },
             name: L('Email ngân hàng', 'Bank email') };
  }

  window.fhTxnReviewSheet = async function () {
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
      _fhSheet('<div class="grab"></div>' +
        '<div class="sheet-h">' + _esc(L('Chưa có giao dịch mới', 'Nothing to review')) + '</div>' +
        '<div class="sheet-sub">' + _esc(locked
          ? L('Có giao dịch đang khoá — mở khoá ứng dụng để xem.',
              'Some transactions are locked — unlock the app to see them.')
          : L('Giao dịch từ email ngân hàng sẽ xuất hiện ở đây để bạn duyệt.',
              'Transactions from your bank email will appear here to review.')) + '</div>' +
        '<button class="btn-skip" onclick="_closeOv()">' + _esc(L('Đóng', 'Close')) + '</button>');
      return;
    }

    // Keep the ids so the staged rows can be retired once imported. The review
    // screen works in its own candidate objects and does not carry them.
    window._fhStagedIds = readable.map(function (r) { return r.id; });

    csvLearnLoad();
    csvBuildReview([fhStagedAsCsvSource(readable)], {});
    renderCsvReview();

    // Same screen, different framing: no file to pick, and the title should say
    // where these came from.
    var pick = document.getElementById('csv-pick'); if (pick) pick.style.display = 'none';
    var title = document.querySelector('#csv-import-modal .modal-title');
    if (title) title.textContent = L('Duyệt giao dịch', 'Review transactions');
    var save = document.getElementById('csv-save');
    if (save) save.setAttribute('onclick', 'fhPromoteStaged()');
    openSheet('csv-import-modal');
  };

  /* Import, then retire the staged rows.
     Deleting only AFTER the ledger write succeeds — the reverse order would lose
     a transaction outright if the write failed. Duplicating one is recoverable;
     losing one is not. */
  window.fhPromoteStaged = async function () {
    var ids = (window._fhStagedIds || []).slice();
    try {
      await csvPromote();
    } catch (e) {
      window.toast && window.toast(L('Chưa lưu được', 'Could not save'));
      return;
    }
    if (!ids.length) return;
    try {
      await _rpc('resolve_email_transactions', { p_ids: ids });   // 0060
      window._fhStagedIds = [];
    } catch (e2) {
      // The money is safely in the ledger; these rows will simply be offered
      // again. Say so rather than reporting a clean success.
      window.toast && window.toast(L('Đã lưu, nhưng danh sách chưa dọn — sẽ hiện lại',
                                     'Saved, but the queue did not clear — these may reappear'));
    }
  };
