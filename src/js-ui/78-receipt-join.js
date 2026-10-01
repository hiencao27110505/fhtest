  (function () {
    /* ═══ Receipt join — a merchant receipt annotates the transaction it
       describes (docs/specs/receipt-enrichment-spec.md §11) ═══════════════════

       The pipeline stages a Shopee / Grab / Apple order mail as a sealed row
       with row_kind = 'receipt' (0154): never a review card, never in the
       badge, never a transaction. This module is the receipt's whole life on
       the device:

         fetch pending receipt rows → open (the same sealed-box opener the
         queue uses) → collapse copies of one order (payment mail + delivered
         mail share an order id; the richest survives) → give each item a
         category from the tree's own keywords, on the device → JOIN:

           queue first — an open review's staged bank rows, matched on the
           exact paid total, ±1 day, with the card tail as confirm/veto. The
           bank row's card gets the receipt's description and its 🧾 badge —
           never its category: a receipt annotates, it does not re-file. On
           import the blob is written with the ledger row and the receipt
           retires with the batch.

           ledger second — an already-imported PRIVATE personal expense
           (link_id null; mirrors are machine-owned) with no receipt yet. The
           blob is written retroactively; note and category are NOT touched —
           the person may have edited them.

         Unmatched: wait. After RECEIPT_GRACE_DAYS with no match anywhere the
         receipt retires quietly — a receipt with no captured payment
         describes money this ledger never saw (COD, an unconnected card),
         and inventing a transaction from it is the double-count the feature
         exists to avoid (spec RC2 — strictly annotate, never create).

       Mis-attachment is worse than no attachment (RC10): exact amount only,
       tail disagreement is a veto, ambiguity attaches nothing, one receipt to
       one transaction. */

    var RECEIPT_GRACE_DAYS = 14;

    /* The queue's own column list (72-txn-review fhFetchStagedTxns), pending
       receipt rows only. 42703 = the 0154 column is not applied yet: the
       feature simply is not live, return nothing. */
    /* EVERY pending receipt, a page at a time (spec RC26). A first connect
       with a long look-back stages more than one page, and reading only the
       newest 200 left the older ones unseen until they aged out. */
    var RJ_PAGE = 200, RJ_MAX = 2000;
    async function _rjFetch() {
      var out = [];
      try {
        for (var from = 0; from < RJ_MAX; from += RJ_PAGE) {
          var res = await sb.from('email_transactions')
            .select('id,member_id,owner_user_id,staging_scope,gmail_message_id,source_provider,occurred_at,amount,currency,direction,counterparty,reference_number,transaction_type,raw_extracted,duplicate_of_id,resolved_before,sealed,eph_pub,nonce,enc_v,created_at')
            .eq('review_status', 'pending').eq('row_kind', 'receipt')
            .order('occurred_at', { ascending: false }).order('id')
            .range(from, from + RJ_PAGE - 1);
          if (res.error) break;
          var page = res.data || [];
          out = out.concat(page);
          if (page.length < RJ_PAGE) break;
        }
      } catch (e) { /* what was read stands */ }
      return out;
    }

    /* When the newest UNOPENED statement arrived (spec RC25). Its rows are the
       likeliest home for an unmatched receipt and they do not exist until the
       person opens it, so grace must not run out underneath them.
       null = no statement is waiting. Infinity = could not be asked, which
       holds everything: a receipt retired on a failed read is gone for good. */
    async function _rjStmtHold() {
      try {
        var res = await sb.from('statement_files').select('received_at')
          .eq('status', 'pending').order('received_at', { ascending: false }).limit(1);
        if (res.error) return Infinity;
        var f = (res.data || [])[0];
        if (!f) return null;
        var t = Date.parse(f.received_at || '');
        return isFinite(t) ? t : Infinity;
      } catch (e) { return Infinity; }
    }

    function _rjTail(s) {
      var m = String(s || '').match(/(\d{4})(?!.*\d)/);
      return m ? m[1] : null;
    }
    function _rjDayMs(iso) { var t = Date.parse(iso || ''); return isFinite(t) ? t : null; }

    /* The instant a row states, or null when it states only a day (spec RC23).
       v2 says so outright (time_precision); a statement row and a v1 row use
       the day-only spelling, midnight UTC, which no real bank clock prints. */
    var RJ_CLOCK_WINDOW = 30 * 60e3;
    function _rjClock(occurredAt, precision) {
      var t = Date.parse(occurredAt || '');
      if (!isFinite(t) || precision === 'day') return null;
      if (precision !== 'second' && precision !== 'minute' && t % 864e5 === 0) return null;
      return t;
    }
    /* A ledger row's instant: its date plus the HH:MM it was booked with. */
    function _rjLedgerClock(t) {
      var m = String((t && t.time) || '').match(/^(\d{1,2}):(\d{2})/);
      if (!m || !t.date) return null;
      var ms = Date.parse(String(t.date).slice(0, 10) + 'T' + ('0' + m[1]).slice(-2) + ':' + m[2] + ':00+07:00');
      return isFinite(ms) ? ms : null;
    }
    /* A clock breaks a tie and only a tie: exactly ONE candidate within the
       window wins; none or several leaves the ambiguity where it was. */
    function _rjByClock(rClock, cands, clockOf) {
      if (rClock == null) return null;
      var near = cands.filter(function (c) {
        var k = clockOf(c);
        return k != null && Math.abs(k - rClock) <= RJ_CLOCK_WINDOW;
      });
      return near.length === 1 ? near[0] : null;
    }

    /* An item's category may only REFINE the transaction's, never contradict
       it (receipt-enrichment §RC9, revised 2026-09-29). The transaction's node
       comes from the bank-side cascade, which exists for every row; a receipt
       exists for a minority and its items are the weaker signal. So an item
       node is kept when it IS the transaction's node or sits under it, and
       dropped otherwise — a swim cap may sharpen "Mua sắm" to "Đồ thể thao",
       but nothing on a receipt may move a purchase to another root.
       A transaction with no node of its own has no branch to contradict. */
    function _rjInBranch(itemNode, txnNode) {
      if (!itemNode || !window.FH_TAX || !FH_TAX.get(itemNode)) return false;
      if (!txnNode || !FH_TAX.get(txnNode)) return true;
      if (itemNode === txnNode) return true;
      try { return FH_TAX.ancestors(itemNode).indexOf(txnNode) >= 0; } catch (e) { return false; }
    }
    function _rjConstrain(rcpt, txnNode) {
      ((rcpt && rcpt.items) || []).forEach(function (it) {
        if (_rjFromLesson && _rjFromLesson.has(it)) return;        // a person's pick stands
        if (it && it.node && !_rjInBranch(it.node, txnNode)) it.node = null;
      });
    }

    /* Item → node, on the device, in this order (spec §20.4, RC19):
         1. the person's own lesson for this item's SIGNATURE — what they said
            a "mũ bơi" is, last time, from any shop;
         2. the node the worker's ladder sealed beside the item (a proposal);
         3. the tree's keywords, for blobs written before Phase 2.
       Nothing here calls anyone. A lesson-resolved item is remembered in a
       WeakSet so the branch constraint leaves it alone: a human pick is the
       one thing allowed outside the transaction's branch. */
    var _rjFromLesson = (typeof WeakSet === 'function') ? new WeakSet() : null;
    function _rjItemSig(it) {
      if (it.sig) return String(it.sig);
      try {
        var hn = (window.FH_TAX && FH_TAX.itemSignature) ? FH_TAX.itemSignature(it.name) : null;
        return hn ? 'hn|' + hn : null;
      } catch (e) { return null; }
    }
    function _rjItemNodes(receipts) {
      receipts.forEach(function (r) {
        ((r._rcpt && r._rcpt.items) || []).forEach(function (it) {
          if (!it || !it.name) return;
          var sig = _rjItemSig(it);
          var lesson = (sig && window.fhLessonItemNode) ? fhLessonItemNode(sig) : null;
          if (lesson) { it.node = lesson; if (_rjFromLesson) _rjFromLesson.add(it); return; }
          if (it.node && window.FH_TAX && FH_TAX.get(it.node)) return;
          var nd = null;
          try { nd = (window.FH_TAX && FH_TAX.keywordNode) ? FH_TAX.keywordNode(it.name, 'expense') : null; } catch (e) { nd = null; }
          it.node = (nd && FH_TAX.get(nd)) ? nd : null;
        });
      });
    }

    /* The description the receipt supplies (spec RC13): one item → its name;
       an agreeing basket → first name + "+N món"; a mixed basket → seller (or
       provider) + count — generic, never clueless. */
    function _rjDesc(rc, provider) {
      var items = rc.items || [];
      if (items.length === 1 && items[0].name) return String(items[0].name).slice(0, 120);
      if (items.length > 1) {
        var nodes = items.map(function (it) { return it.node || null; });
        var resolved = nodes.filter(Boolean);
        var unanimous = resolved.length === items.length && resolved.every(function (n) { return n === resolved[0]; });
        if (unanimous && items[0].name) {
          return String(items[0].name).slice(0, 80) + ' +' + (items.length - 1) + ' món';
        }
        return (rc.seller || provider || 'Hoá đơn') + ' · ' + items.length + ' món';
      }
      /* Order-level, but the merchant named what was bought (a Grab ride's
         "Car 6 chỗ ngồi"): that still answers "chi cho gì" (spec RC24). */
      if (rc.service_label) return (provider ? provider + ' \u00b7 ' : '') + rc.service_label;
      return null;   // order-level only: the cascade keeps its answer
    }

    /* Open + shape one receipt row. Returns null for unreadable (leave it
       pending; unlocking heals it) and for rows with no receipt block. */
    async function _rjOpen(row) {
      if (!window.fhReadStagedRow) return null;
      var r = await window.fhReadStagedRow(row);
      if (!r || r._unreadable) return null;
      var x = r.raw_extracted || {};
      var rc = x.receipt;
      if (!rc || typeof rc !== 'object') rc = null;
      return {
        id: row.id, created_at: row.created_at, occurred_at: row.occurred_at,
        provider: row.source_provider || null,
        paid: rc ? Number(rc.paid != null ? rc.paid : x.amount) : Number(x.amount),
        tail: rc ? _rjTail(rc.paid_with_tail) : null,
        clock: _rjClock(row.occurred_at, x.time_precision),
        orderId: (rc && rc.order_id) || x.reference_number || null,
        _rcpt: rc ? {
          v: 1, source: 'email', provider: row.source_provider || null,
          service_type: rc.service_type || null, order_id: rc.order_id || null,
          /* A link cell leaves "olanevietnam ." — trimmed here so every blob
             ever written is clean, not only what the fixed reader emits. */
          seller: String(rc.seller || '').replace(/[\s.·|•-]+$/, '').trim() || null,
          items: Array.isArray(rc.items) ? rc.items.map(function (it) {
            return { name: (it && it.name) || null, qty: it && it.qty != null ? it.qty : null,
              unit_price: it && it.unit_price != null ? it.unit_price : null,
              line_discount: it && it.line_discount != null ? it.line_discount : null,
              variant: (it && it.variant) || null,
              /* Phase 2 (§20): the worker's ladder seals a node PROPOSAL and the
                 signature it was learned under; both ride through, and the
                 precedence below decides what is shown. */
              node: (it && it.node) || null, sig: (it && it.sig) || null };
          }) : null,
          items_total: rc.items_total != null ? rc.items_total : null,
          discount: rc.discount != null ? rc.discount : null,
          shipping_fee: rc.shipping_fee != null ? rc.shipping_fee : null,
          paid: rc.paid != null ? rc.paid : null,
          paid_with_tail: _rjTail(rc.paid_with_tail),
          service_label: rc.service_label ? String(rc.service_label).slice(0, 60) : null,
          points_discount: rc.points_discount != null ? rc.points_discount : null,
        } : null,
      };
    }

    function _rjScore(r) {
      if (!r._rcpt) return -1;
      return ((r._rcpt.items || []).length * 10) + (r._rcpt.seller ? 1 : 0) + (r._rcpt.paid_with_tail ? 1 : 0);
    }

    /* One shared pass. `queueRows` — the review's OPENED staged rows when the
       queue is on screen (queue beats ledger, RC10), else null. Returns the
       receipts it attached to queue rows so the caller can render them. */
    async function _rjRun(queueRows) {
      var raw = await _rjFetch();
      if (!raw.length) return;
      var receipts = [];
      for (var i = 0; i < raw.length; i++) {
        var o = await _rjOpen(raw[i]);
        if (o) receipts.push(o);
      }
      if (!receipts.length) return;

      /* Collapse copies of one order — richest wins, losers retire. */
      var byOrder = {}, keep = [], retire = [];
      receipts.forEach(function (r) {
        var k = r.orderId ? (r.provider + '|' + r.orderId) : ('row|' + r.id);
        var held = byOrder[k];
        if (!held) { byOrder[k] = r; keep.push(r); return; }
        if (_rjScore(r) > _rjScore(held)) {
          retire.push(held.id);
          keep[keep.indexOf(held)] = r; byOrder[k] = r;
        } else retire.push(r.id);
      });
      receipts = keep.filter(function (r) { return r._rcpt && r.paid > 0; });

      _rjItemNodes(receipts);
      receipts.forEach(function (r) {
        if (!r._rcpt) return;
        r._desc = _rjDesc(r._rcpt, r.provider);
      });

      /* ── queue first ── */
      var claimedRows = {};
      if (queueRows && queueRows.length) {
        receipts.forEach(function (r) {
          if (r._joined || !r.paid) return;
          var rDay = _rjDayMs(r.occurred_at);
          var hits = [];
          queueRows.forEach(function (q) {
            if (!q || q._unreadable || q._rcpt || claimedRows[q.id]) return;
            var x = q.raw_extracted || {};
            if (x.receipt) return;                       // a receipt row is never a target
            /* The cash fields are read where EVERY opened row carries them, at
               the top (fhReadStagedRow, fhStmtAsStaged). Reading the inner copy
               alone skipped every statement row (spec §21, RC20). */
            var qDir = q.direction != null ? q.direction : x.direction;
            var qAmt = q.amount != null ? q.amount : x.amount;
            if (String(qDir) !== 'debit') return;
            if (Math.round(Number(qAmt)) !== Math.round(r.paid)) return;
            var qDay = _rjDayMs(q.occurred_at);
            if (rDay != null && qDay != null && Math.abs(rDay - qDay) > 1.5 * 864e5) return;
            var qTail = _rjTail(x.account_masked) || _rjTail(x.card_masked);
            if (r.tail && qTail && r.tail !== qTail) return;   // veto
            hits.push({ q: q, tailHit: !!(r.tail && qTail && r.tail === qTail) });
          });
          var hit = null;
          if (hits.length === 1) hit = hits[0].q;
          else if (hits.length > 1) {
            var tails = hits.filter(function (h) { return h.tailHit; });
            if (tails.length === 1) hit = tails[0].q;    // the tail decides
            else if (!tails.length) {
              var near = _rjByClock(r.clock, hits, function (h) {
                return _rjClock(h.q.occurred_at, (h.q.raw_extracted || {}).time_precision);
              });
              if (near) hit = near.q;                    // the minute decides; else ambiguity → nothing
            }
          }
          if (!hit) return;
          claimedRows[hit.id] = true;
          r._joined = 'queue';
          _rjConstrain(r._rcpt, (hit.raw_extracted && hit.raw_extracted.node) || null);
          hit._rcpt = r._rcpt;
          hit._rcptRowId = r.id;
          hit._rcptDesc = r._desc || null;
        });
      }

      /* ── ledger second — retroactive, PRIVATE personal expenses only ── */
      var rest = receipts.filter(function (r) { return !r._joined; });
      if (rest.length && window.fhPersonalMatchSlice && window.fhPersonalSetReceipt) {
        var slice = [];
        try { slice = await fhPersonalMatchSlice() || []; } catch (e) { slice = []; }
        var mult = window.curMult ? curMult() : 1000;
        var claimedLedger = {};
        for (var ri = 0; ri < rest.length; ri++) {
          var r2 = rest[ri];
          var born2 = Date.parse(r2.created_at || '') || 0;
          var rDay2 = _rjDayMs(r2.occurred_at);
          var cands = slice.filter(function (t) {
            if (t.kind !== 'expense' || t.link || claimedLedger[t.id]) return false;
            if (Math.round(t.amt * mult) !== Math.round(r2.paid)) return false;
            var tDay = _rjDayMs(t.date);
            return !(rDay2 != null && tDay != null && Math.abs(rDay2 - tDay) > 1.5 * 864e5);
          });
          var clockHit = _rjByClock(r2.clock, cands, _rjLedgerClock);
          if (cands.length > 1 && clockHit) cands = [clockHit];   // the minute breaks the tie (RC23)
          if (cands.length !== 1) continue;              // ambiguity (or nothing): attach nothing
          /* What the row already holds decides whether this write is an attach
             or an UPGRADE. A row with a receipt that has no items (a poor read,
             or a mail that only stated the order) may be deepened by one that
             does; a row already carrying items is left alone, and an unreadable
             blob is never overwritten — it may be perfectly good ciphertext
             this device simply cannot open. */
          var have = null;
          try { have = window.fhPersonalGetReceipt ? await fhPersonalGetReceipt(cands[0].id) : null; } catch (e) { have = null; }
          if (have === '_unreadable') continue;
          /* A young receipt waits for the review BEFORE it may claim a bare
             ledger row: its bank twin usually arrives within hours and is
             imported through the queue, where the match has the tail and the
             person's eyes, and attaching a fresh receipt to an older
             same-amount row here would be the coincidence the ambiguity rule
             exists to refuse (this pass cannot see pending twins — their
             amounts are sealed), so time stands in for it. An UPGRADE needs no
             such wait: the row already carries this order's own receipt, which
             is proof the transaction is booked and there is no twin to wait
             for. */
          /* A matching minute IS the evidence that wait stands in for: the
             row and the receipt name the same payment, so there is nothing
             left to wait for (RC23). */
          if (!have && !clockHit && born2 > Date.now() - 2 * 864e5) continue;
          var mine = ((r2._rcpt && r2._rcpt.items) || []).length;
          var theirs = ((have && have.items) || []).length;
          if (have && (theirs || !mine)) continue;       // already as rich, or this one adds nothing
          _rjConstrain(r2._rcpt, cands[0].node || null);
          var ok = await fhPersonalSetReceipt(cands[0].id, r2._rcpt, { upgrade: !!have });
          if (ok) {
            claimedLedger[cands[0].id] = true;
            r2._joined = 'ledger';
            retire.push(r2.id);
          }
        }
      }

      /* ── grace: unmatched anywhere, older than the window → retire quietly ── */
      var cutoff = Date.now() - RECEIPT_GRACE_DAYS * 864e5;
      var aged = receipts.filter(function (r) {
        if (r._joined) return false;
        var born = Date.parse(r.created_at || '') || Date.parse(r.occurred_at || '') || Date.now();
        return born < cutoff;
      });
      if (aged.length) {
        /* A statement can only explain purchases made before it was sent; a
           day of slack covers the merchant's clock against the bank's. */
        var hold = await _rjStmtHold();
        aged.forEach(function (r) {
          var at = _rjDayMs(r.occurred_at);
          if (hold != null && (at == null || at <= hold + 864e5)) return;   // an unopened statement may still claim it
          retire.push(r.id);
        });
      }

      if (retire.length && window.fhStagedRetireIds) {
        try { await fhStagedRetireIds(Array.from(new Set(retire))); } catch (e) { /* still pending; next pass retries */ }
      }
    }

    /* Review open: enrich the opened rows in place (72 calls this after the
       decrypt loop, before candidates are built). Failure never blocks the
       queue. */
    window.fhReceiptJoinQueue = async function (openedRows) {
      try { await _rjRun(openedRows || []); } catch (e) { console.warn('receipt join failed', e); }
    };

    /* Retroactive pass, debounced behind the personal hydrate. No queue rows
       here: a receipt whose bank twin is still PENDING must wait for the
       review (queue beats ledger), so this pass only ever attaches to rows
       already imported — and pending twins are exactly the rows whose amount
       equality this pass cannot see (their amounts are sealed), so it cannot
       steal them by construction. */
    var _rjTimer = null, _rjBusy = false;
    window.fhReceiptLedgerSoon = function () {
      if (_rjTimer) clearTimeout(_rjTimer);
      _rjTimer = setTimeout(async function () {
        _rjTimer = null;
        if (_rjBusy) return;
        _rjBusy = true;
        try { await _rjRun(null); } catch (e) { /* next hydrate retries */ }
        finally { _rjBusy = false; }
      }, 4000);
    };
  })();
