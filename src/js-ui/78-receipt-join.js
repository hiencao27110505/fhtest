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

       Mis-attachment is worse than no attachment (RC10): tail disagreement
       is a veto, ambiguity attaches nothing, one receipt to one transaction.

       Since 2026-10-09 (spec §22, RC27–RC31), after a morning of Grab rides
       where two of four receipts found no row and one was deleted:
         - A COPY is the same order AND the same paid total. A tip mail carries
           its ride's Booking ID and is a different payment (RC27).
         - A copy is never deleted on sight. It waits with its winner and
           retires only when the winner does (RC28).
         - THE MINUTE DECIDES among rows of one amount: receipts and rows are
           paired closest-first, and a pair is taken only when nothing else is
           within five minutes of being as good (RC29).
         - A CHARGE LATER ADJUSTED still finds its receipt: charge minus a
           refund from the same account equals the receipt (RC30).
         - What the rules cannot settle, the person can: fitting receipts are
           offered on the card, and a pick or a "not this one" is remembered
           (RC31). */

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
    var RJ_CLOCK_MARGIN = 5 * 60e3;     // a pair wins only when the runner-up is this much farther (RC29)
    var RJ_HOLD_BEFORE = 90 * 60e3;     // a hold may be placed this long before its refund lands (RC30)
    var RJ_HOLD_AFTER = 10 * 60e3;      // ...or the two may print a few minutes apart either way
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
      /* A tip is its own payment and says so (RC27): "Grab · Tip tài xế", not
         the ride's name a second time. */
      if (rc.tip != null && rc.paid != null && Math.round(rc.tip) === Math.round(rc.paid)) return (provider ? provider + ' \u00b7 ' : '') + 'Tip t\u00e0i x\u1ebf';
      if (rc.service_label) return (provider ? provider + ' \u00b7 ' : '') + rc.service_label;
      return null;   // order-level only: the cascade keeps its answer
    }

    /* Opened receipt payloads, kept across runs (2026-10-10). The ledger pass
       runs four seconds after EVERY personal hydrate and used to open every
       pending receipt again each time: up to two thousand nacl opens for a
       set that had not changed. Keyed by id + nonce (the ciphertext's own
       identity, as 18's shared cache keys it); only readable results are kept,
       so a locked ledger is retried after unlock. The shaping below reads the
       cached payload and never writes into it. */
    var _rjOpened = new Map(), RJ_OPEN_MAX = 3000;
    function _rjOpenKey(row) { return row.id + '|' + (row.nonce || row.updated_at || row.created_at || ''); }
    /* Open + shape one receipt row. Returns null for unreadable (leave it
       pending; unlocking heals it) and for rows with no receipt block. */
    async function _rjOpen(row) {
      if (!window.fhReadStagedRow) return null;
      var k = _rjOpenKey(row), r = _rjOpened.get(k);
      if (!r) {
        r = await window.fhReadStagedRow(row);
        if (!r || r._unreadable) return null;
        _rjOpened.set(k, r);
        if (_rjOpened.size > RJ_OPEN_MAX) { for (var kk of _rjOpened.keys()) { if (_rjOpened.size <= RJ_OPEN_MAX) break; _rjOpened.delete(kk); } }
      }
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
          /* receipt-providers-spec §12: a printed tax line and the billing
             period (recurring-charges-spec RR1 reads `period`). */
          tax: rc.tax != null ? rc.tax : null,
          period: rc.period || null,
          tip: rc.tip != null ? rc.tip : null,
        } : null,
      };
    }

    function _rjScore(r) {
      if (!r._rcpt) return -1;
      return ((r._rcpt.items || []).length * 10) + (r._rcpt.seller ? 1 : 0) + (r._rcpt.paid_with_tail ? 1 : 0);
    }

    /* ── what the person settled (RC31) ───────────────────────────────────────
       A pick ("this receipt is this row's") and a block ("not this one") are
       remembered on the device by row id and receipt id alone: no amount, no
       name. They outlive a reopened queue and die with the rows they name. */
    var RJ_PICK_KEY = 'fh-rj-picks:v1';
    var _rjMem = null;
    function _rjPicks() {
      if (_rjMem) return _rjMem;
      var st = { p: {}, b: {} };
      try { var raw = window.localStorage && localStorage.getItem(RJ_PICK_KEY); if (raw) { var o = JSON.parse(raw); if (o && o.p && o.b) st = o; } } catch (e) { /* in-memory only */ }
      _rjMem = st; return st;
    }
    function _rjPicksSave() { try { if (window.localStorage) localStorage.setItem(RJ_PICK_KEY, JSON.stringify(_rjMem || { p: {}, b: {} })); } catch (e) { /* in-memory only */ } }
    function _rjBlocked(rowId, rcptId) { var b = _rjPicks().b[rowId]; return !!(b && b.indexOf(rcptId) >= 0); }

    /* The last opened receipts and queue rows, so a pick on a card can be
       applied and the rest re-settled without another fetch. `byId` is the
       queue indexed once (fhReceiptOffers is asked per card per render, and
       56 now asks it per statement card too); `offers` memoizes each row's
       answer for one settled state and is dropped whenever that state moves. */
    var RJ = { receipts: [], queue: null, at: 0, byId: new Map(), offers: new Map() };
    function _rjSetState(receipts, queueRows) {
      RJ.receipts = receipts; RJ.queue = queueRows; RJ.at = Date.now();
      RJ.byId = new Map();
      (queueRows || []).forEach(function (q) { if (q && q.id != null && !RJ.byId.has(q.id)) RJ.byId.set(q.id, q); });
      RJ.offers = new Map();
    }
    function _rjSettled() { RJ.offers = new Map(); }

    function _rjRowCash(q) {
      var x = q.raw_extracted || {};
      /* The cash fields are read where EVERY opened row carries them, at the
         top (fhReadStagedRow, fhStmtAsStaged). Reading the inner copy alone
         skipped every statement row (spec §21, RC20). */
      return { dir: String(q.direction != null ? q.direction : x.direction),
        amt: Math.round(Number(q.amount != null ? q.amount : x.amount)),
        tail: _rjTail(x.account_masked) || _rjTail(x.card_masked),
        clock: _rjClock(q.occurred_at, x.time_precision),
        day: _rjDayMs(q.occurred_at),
        acct: String(q.source_provider || x.source_provider || '') + '|' + (_rjTail(x.account_masked) || _rjTail(x.card_masked) || '') };
    }
    function _rjIsTarget(q) { return !!q && !q._unreadable && !(q.raw_extracted || {}).receipt; }
    function _rjDayOk(r, c) { var rDay = _rjDayMs(r.occurred_at); return !(rDay != null && c.day != null && Math.abs(rDay - c.day) > 1.5 * 864e5); }
    function _rjFold(s) { return String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ''); }
    /* Does the row's own text name the receipt's provider ("GRAB" on a wallet
       statement row, for a Grab receipt)? What lets a receipt of a different
       total be OFFERED, never auto-attached. */
    function _rjNames(q, provider) {
      var p = _rjFold(provider); if (p.length < 3) return false;
      var x = q.raw_extracted || {};
      return _rjFold([q.counterparty, x.counterparty, x.memo, x.memo_display, q.description].join(' ')).indexOf(p) >= 0;
    }

    function _rjAttachQueue(r, q, how, adj) {
      r._joined = 'queue';
      _rjConstrain(r._rcpt, (q.raw_extracted && q.raw_extracted.node) || null);
      q._rcpt = r._rcpt;
      q._rcptRowId = r.id;
      q._rcptCopyIds = (r._copies || []).slice();
      q._rcptDesc = r._desc || null;
      q._rcptHow = how;                       // 'amount' | 'tail' | 'clock' | 'net' | 'pick'
      q._rcptAdj = adj || null;
      /* The blob that will be written says so itself: the row is the charge,
         the receipt is what was finally paid. */
      if (adj) q._rcpt.adjusted = { charged: adj.charged, refunded: adj.refunded }; else if (q._rcpt.adjusted) delete q._rcpt.adjusted;
    }

    /* ── the queue pass: pure over what is in memory ────────────────────────── */
    function _rjQueuePass(receipts, queueRows) {
      var rows = (queueRows || []).filter(_rjIsTarget);
      if (!rows.length) return;
      var cash = {}; rows.forEach(function (q) { cash[q.id] = _rjRowCash(q); });
      var byId = {}; receipts.forEach(function (r) { byId[r.id] = r; });
      /* The debit rows by exact amount, and the credit rows apart. Every match
         below starts from "the paid total equals the row's amount", so the
         bucket is the amount itself and each receipt reads only the rows that
         could be its own, not the whole queue (2026-10-10: receipts × rows,
         then receipts × credits × rows, on a thousand-row queue). */
      var byAmt = {}, credits = [];
      rows.forEach(function (q) {
        var c = cash[q.id];
        if (c.dir === 'debit') (byAmt[c.amt] || (byAmt[c.amt] = [])).push(q);
        else if (c.dir === 'credit') credits.push(q);
      });
      var st = _rjPicks();

      /* 0. What the person picked stands first. */
      rows.forEach(function (q) {
        var rid = st.p[q.id]; if (!rid || q._rcpt) return;
        var r = byId[rid]; if (!r || r._joined || !r._rcpt) return;
        var c = cash[q.id];
        var adj = (c.amt > Math.round(r.paid)) ? { charged: c.amt, refunded: c.amt - Math.round(r.paid), refundRowId: null } : null;
        _rjAttachQueue(r, q, 'pick', adj);
      });

      /* 1. Exact paid total, within a day and a half, tail as confirm or veto. */
      var hitsOf = {};
      receipts.forEach(function (r) {
        if (r._joined || !r.paid) return;
        var hits = [];
        (byAmt[Math.round(r.paid)] || []).forEach(function (q) {
          var c = cash[q.id];
          if (!_rjDayOk(r, c)) return;
          if (r.tail && c.tail && r.tail !== c.tail) return;          // veto
          if (_rjBlocked(q.id, r.id)) return;                         // the person said no
          hits.push({ q: q, tailHit: !!(r.tail && c.tail && r.tail === c.tail) });
        });
        hitsOf[r.id] = hits;
      });
      /* Settle one pair at a time, then look again: a row claimed by a clear
         pair leaves the others' choices narrower, and often decided (RC29).
         Only receipts with at least one fitting row take part, and each round
         settles one of them or ends the loop, so the rounds are bounded by
         their number rather than by a guard. */
      var withHits = receipts.filter(function (r) { return hitsOf[r.id] && hitsOf[r.id].length; });
      for (var guard = 0; guard <= withHits.length; guard++) {
        var open = withHits.filter(function (r) { return !r._joined; });
        var avail = {};
        open.forEach(function (r) { avail[r.id] = hitsOf[r.id].filter(function (h) { return !h.q._rcpt; }); });
        var done = false, i2, r2;
        // a) the card tail names the row
        for (i2 = 0; i2 < open.length && !done; i2++) {
          r2 = open[i2];
          var tails = avail[r2.id].filter(function (h) { return h.tailHit; });
          if (tails.length === 1) { _rjAttachQueue(r2, tails[0].q, 'tail'); done = true; }
        }
        if (done) continue;
        // b) one row fits, and no other waiting receipt wants it
        for (i2 = 0; i2 < open.length && !done; i2++) {
          r2 = open[i2];
          if (avail[r2.id].length !== 1) continue;
          var only = avail[r2.id][0].q;
          var contested = open.some(function (o) { return o !== r2 && avail[o.id].some(function (h) { return h.q === only; }); });
          if (!contested) { _rjAttachQueue(r2, only, 'amount'); done = true; }
        }
        if (done) continue;
        // c) the minute decides: closest pair first, and only a clear winner
        var pairs = [];
        open.forEach(function (r) {
          if (r.clock == null) return;
          if (avail[r.id].some(function (h) { return h.tailHit; })) return;   // tails disagree among themselves: not the clock's call
          avail[r.id].forEach(function (h) {
            var k = cash[h.q.id].clock; if (k == null) return;
            var dt = Math.abs(k - r.clock);
            if (dt <= RJ_CLOCK_WINDOW) pairs.push({ r: r, q: h.q, dt: dt });
          });
        });
        pairs.sort(function (a, b) { return a.dt - b.dt; });
        for (i2 = 0; i2 < pairs.length && !done; i2++) {
          var pr = pairs[i2];
          var clear = pairs.every(function (o) { return o === pr || (o.r !== pr.r && o.q !== pr.q) || (o.dt - pr.dt) >= RJ_CLOCK_MARGIN; });
          if (clear) { _rjAttachQueue(pr.r, pr.q, 'clock'); done = true; }
        }
        if (!done) break;
      }

      /* 2. A charge later adjusted (RC30). The wallet shows the hold and, a
            moment or an hour later, a refund of the difference; the receipt
            states what was finally paid. Only for a receipt whose total equals
            NO row at all, only with clocks on all three, only inside one
            account, and only when exactly one charge-and-refund pair fits. */
      receipts.forEach(function (r) {
        if (r._joined || !r.paid || r.clock == null) return;
        if ((hitsOf[r.id] || []).length) return;                      // an exact row exists: that is the ambiguity rule's business
        var paid = Math.round(r.paid), combos = [];
        credits.forEach(function (C) {
          var c = cash[C.id];
          if (C._adjOf || c.clock == null) return;
          if (Math.abs(c.clock - r.clock) > RJ_CLOCK_WINDOW) return;  // the refund lands as the trip ends, when the receipt is sent
          /* charge minus refund equals the receipt: the charge is in the bucket
             of exactly paid + refund, so only those rows are read */
          (byAmt[paid + c.amt] || []).forEach(function (D) {
            var d = cash[D.id];
            if (D === C || D._rcpt || d.clock == null) return;
            if (d.acct !== c.acct || d.acct.charAt(0) === '|') return; // one account, and a named one
            if (d.clock < c.clock - RJ_HOLD_BEFORE || d.clock > c.clock + RJ_HOLD_AFTER) return;
            if (r.tail && d.tail && r.tail !== d.tail) return;
            if (_rjBlocked(D.id, r.id)) return;
            combos.push({ D: D, C: C, charged: d.amt, refunded: c.amt });
          });
        });
        if (combos.length !== 1) return;
        var k = combos[0];
        _rjAttachQueue(r, k.D, 'net', { charged: k.charged, refunded: k.refunded, refundRowId: k.C.id });
        k.C._adjOf = k.D.id;
        k.C._adjInfo = { charged: k.charged, provider: r.provider || null };
      });
    }

    /* Receipts that could be this row's and are still waiting (RC31): the
       exact total first, then a smaller total from a provider the row names
       (an adjusted fare the rules could not prove). */
    function _rjOffersFor(q) {
      if (!_rjIsTarget(q) || q._rcpt) return [];
      var c = _rjRowCash(q);
      if (c.dir !== 'debit') return [];
      var out = [];
      RJ.receipts.forEach(function (r) {
        if (r._joined || !r._rcpt || !r.paid) return;
        var paid = Math.round(r.paid);
        if (!_rjDayOk(r, c)) return;
        if (r.tail && c.tail && r.tail !== c.tail) return;
        var exact = paid === c.amt;
        if (!exact && !(paid < c.amt && _rjNames(q, r.provider))) return;
        out.push({ id: r.id, provider: r.provider || null, label: (r._rcpt.service_label || r._desc || null), paid: paid, at: r.occurred_at || null,
          exact: exact, dt: (r.clock != null && c.clock != null) ? Math.abs(r.clock - c.clock) : 9e15, said: _rjBlocked(q.id, r.id) });
      });
      out.sort(function (a, b) { return (b.exact - a.exact) || (a.dt - b.dt); });
      return out.slice(0, 6);
    }
    function _rjRowById(id) { return RJ.byId.get(id) || null; }
    /* Forget what this session's pass attached (never a ledger write, never a
       retire) and settle again with the person's word in place. */
    function _rjResettle() {
      (RJ.queue || []).forEach(function (q) {
        if (!q) return;
        if (q._rcptRowId) { delete q._rcpt; delete q._rcptRowId; delete q._rcptCopyIds; delete q._rcptDesc; delete q._rcptHow; delete q._rcptAdj; }
        delete q._adjOf; delete q._adjInfo;
      });
      RJ.receipts.forEach(function (r) { if (r._joined === 'queue') { r._joined = null; if (r._rcpt && r._rcpt.adjusted) delete r._rcpt.adjusted; } });
      _rjQueuePass(RJ.receipts, RJ.queue);
      _rjSettled();
    }
    /* Asked once per card per render, and now per statement card too: the
       answer for a row is computed once per settled state and handed out as a
       copy until a pass, a pick or a detach moves that state. */
    window.fhReceiptOffers = function (stagedRowId) {
      if (RJ.offers.has(stagedRowId)) return RJ.offers.get(stagedRowId).slice();
      var q = _rjRowById(stagedRowId), out = q ? _rjOffersFor(q) : [];
      RJ.offers.set(stagedRowId, out);
      return out.slice();
    };
    window.fhReceiptAttach = function (stagedRowId, receiptId) {
      var st = _rjPicks();
      st.p[stagedRowId] = receiptId;
      Object.keys(st.p).forEach(function (k) { if (k !== stagedRowId && st.p[k] === receiptId) delete st.p[k]; });   // one receipt, one row
      if (st.b[stagedRowId]) st.b[stagedRowId] = st.b[stagedRowId].filter(function (x) { return x !== receiptId; });
      _rjPicksSave(); _rjResettle();
      var q = _rjRowById(stagedRowId); return !!(q && q._rcptRowId === receiptId);
    };
    window.fhReceiptDetach = function (stagedRowId) {
      var q = _rjRowById(stagedRowId); if (!q || !q._rcptRowId) return false;
      var st = _rjPicks(), rid = q._rcptRowId;
      if (st.p[stagedRowId] === rid) delete st.p[stagedRowId];
      (st.b[stagedRowId] || (st.b[stagedRowId] = [])).push(rid);
      _rjPicksSave(); _rjResettle();
      return true;
    };

    /* fetch → open → collapse copies → categories and descriptions */
    async function _rjLoad() {
      var raw = await _rjFetch();
      var receipts = [];
      for (var i = 0; i < raw.length; i++) {
        var o = await _rjOpen(raw[i]);
        if (o) receipts.push(o);
      }
      /* Copies of one PAYMENT: the same order id AND the same paid total (a
         payment mail and a delivered mail). The richest stands for them; the
         others wait behind it and are retired only with it (RC27, RC28). */
      var byPay = {}, keep = [];
      receipts.forEach(function (r) {
        var k = r.orderId ? (r.provider + '|' + r.orderId + '|' + Math.round(r.paid || 0)) : ('row|' + r.id);
        var held = byPay[k];
        if (!held) { byPay[k] = r; r._copies = []; keep.push(r); return; }
        if (_rjScore(r) > _rjScore(held)) {
          r._copies = held._copies.concat([held.id]); held._copies = [];
          keep[keep.indexOf(held)] = r; byPay[k] = r;
        } else held._copies.push(r.id);
      });
      receipts = keep.filter(function (r) { return r._rcpt && r.paid > 0; });
      _rjItemNodes(receipts);
      receipts.forEach(function (r) { r._desc = _rjDesc(r._rcpt, r.provider); });
      return receipts;
    }

    /* One shared pass. `queueRows` — the review's OPENED staged rows when the
       queue is on screen (queue beats ledger, RC10), else null. */
    /* The ledger pass is gated on what it reads (2026-10-10). It ran four
       seconds after EVERY personal hydrate, and a hydrate fires on realtime,
       on focus and after every write, so the same receipts were matched
       against the same 365-day slice many times an hour. The signature is the
       receipt set (ids, which the fetch already told us), the slice's identity
       and length (19 hands back the same array until a write invalidates it),
       the personal ledger's own signature when 19 exposes one, and the day
       (grace is a function of time, so once a day the pass runs regardless).
       A queue open always runs: its rows are new each time. */
    var _rjLast = { sig: null, slice: null };
    function _rjLedgerSig(receipts, slice) {
      var parts = [Math.floor(Date.now() / 864e5), slice ? slice.length : -1,
        (typeof window.fhPersonalSig === 'function') ? String(window.fhPersonalSig()) : ''];
      receipts.forEach(function (r) { parts.push(r.id); });
      return parts.join(',');
    }

    async function _rjRun(queueRows) {
      var receipts = await _rjLoad();
      _rjLedgerCache = null;                 // this pass may attach or retire; the next detail screen reads afresh
      if (queueRows) {
        _rjSetState(receipts, queueRows);
        /* a pick or a block for a row that is gone has nothing left to say */
        var st = _rjPicks(), live = {}, dirty = false;
        queueRows.forEach(function (q) { if (q && q.id) live[q.id] = 1; });
        Object.keys(st.p).forEach(function (k) { if (!live[k]) { delete st.p[k]; dirty = true; } });
        Object.keys(st.b).forEach(function (k) { if (!live[k]) { delete st.b[k]; dirty = true; } });
        if (dirty) _rjPicksSave();
      }
      if (!receipts.length) return;
      var retire = [];
      var retireWith = function (r) { retire.push(r.id); (r._copies || []).forEach(function (id) { retire.push(id); }); };

      /* ── queue first ── */
      if (queueRows && queueRows.length) _rjQueuePass(receipts, queueRows);

      /* ── ledger second — retroactive, PRIVATE personal expenses only ── */
      var rest = receipts.filter(function (r) { return !r._joined; });
      if (rest.length && window.fhPersonalMatchSlice && window.fhPersonalSetReceipt) {
        var slice = [];
        try { slice = await fhPersonalMatchSlice() || []; } catch (e) { slice = []; }
        if (!queueRows) {
          var sig = _rjLedgerSig(receipts, slice);
          if (sig === _rjLast.sig && slice === _rjLast.slice) return;   // nothing this pass reads has moved since it last finished
          _rjLast = { sig: sig, slice: slice };
        }
        var mult = window.curMult ? curMult() : 1000;
        var claimedLedger = {};
        var candsOf = function (r2) {
          var rDay2 = _rjDayMs(r2.occurred_at);
          return slice.filter(function (t) {
            if (t.kind !== 'expense' || t.link || claimedLedger[t.id]) return false;
            if (Math.round(t.amt * mult) !== Math.round(r2.paid)) return false;
            var tDay = _rjDayMs(t.date);
            return !(rDay2 != null && tDay != null && Math.abs(rDay2 - tDay) > 1.5 * 864e5);
          });
        };
        /* The minute, read the same way as in the queue (RC29): the closest
           row wins when no other row, and no other waiting receipt of this
           total, is within five minutes of being as close. */
        var clockPick = function (r2, cands) {
          if (r2.clock == null) return null;
          var near = cands.map(function (t) { var k = _rjLedgerClock(t); return k == null ? null : { t: t, dt: Math.abs(k - r2.clock) }; })
            .filter(function (x) { return x && x.dt <= RJ_CLOCK_WINDOW; }).sort(function (a, b) { return a.dt - b.dt; });
          if (!near.length) return null;
          if (near.length > 1 && near[1].dt - near[0].dt < RJ_CLOCK_MARGIN) return null;
          var rivalK = _rjLedgerClock(near[0].t);
          var rival = rest.some(function (o) {
            return o !== r2 && !o._joined && o.clock != null && Math.round(o.paid) === Math.round(r2.paid) && Math.abs(rivalK - o.clock) - near[0].dt < RJ_CLOCK_MARGIN;
          });
          return rival ? null : near[0].t;
        };
        for (var ri = 0; ri < rest.length; ri++) {
          var r2 = rest[ri];
          var born2 = Date.parse(r2.created_at || '') || 0;
          var cands = candsOf(r2);
          var clockHit = clockPick(r2, cands);
          if (cands.length > 1 && clockHit) cands = [clockHit];   // the minute breaks the tie (RC23, RC29)
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
            retireWith(r2);
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
          retireWith(r);
        });
      }

      if (retire.length && window.fhStagedRetireIds) {
        try { await fhStagedRetireIds(Array.from(new Set(retire))); } catch (e) { /* still pending; next pass retries */ }
      }
      _rjSettled();                          // the ledger pass may have claimed receipts the cards were offered
    }

    /* Review open: enrich the opened rows in place (72 calls this after the
       decrypt loop, before candidates are built). Failure never blocks the
       queue. */
    window.fhReceiptJoinQueue = async function (openedRows) {
      try { await _rjRun(openedRows || []); } catch (e) { console.warn('receipt join failed', e); }
    };

    /* ── a ledger row's own door (RC31) ────────────────────────────────────────
       The detail screen of an imported private expense may attach a waiting
       receipt by hand. `t` = { id, date, time, amt (app units), note, who, node }. */
    /* Opening a detail screen must not re-read every waiting receipt each
       time: what was opened is kept for two minutes. */
    var _rjLedgerCache = null;
    window.fhReceiptOffersLedger = async function (t) {
      if (!t || !t.id) return [];
      var receipts;
      try {
        if (!_rjLedgerCache || Date.now() - _rjLedgerCache.at > 120e3) _rjLedgerCache = { at: Date.now(), receipts: await _rjLoad() };
        receipts = _rjLedgerCache.receipts.filter(function (r) { return !r._joined; });
      } catch (e) { return []; }
      var mult = window.curMult ? curMult() : 1000;
      var amt = Math.round(Number(t.amt) * mult), clock = _rjLedgerClock(t), tDay = _rjDayMs(t.date);
      var names = _rjFold([t.note, t.who].join(' '));
      var out = [];
      receipts.forEach(function (r) {
        var paid = Math.round(r.paid), rDay = _rjDayMs(r.occurred_at);
        if (rDay != null && tDay != null && Math.abs(rDay - tDay) > 1.5 * 864e5) return;
        var exact = paid === amt, p = _rjFold(r.provider);
        if (!exact && !(paid < amt && p.length >= 3 && names.indexOf(p) >= 0)) return;
        out.push({ id: r.id, provider: r.provider || null, label: (r._rcpt.service_label || r._desc || null), paid: paid, at: r.occurred_at || null,
          exact: exact, dt: (r.clock != null && clock != null) ? Math.abs(r.clock - clock) : 9e15, _r: r });
      });
      out.sort(function (a, b) { return (b.exact - a.exact) || (a.dt - b.dt); });
      return out.slice(0, 6);
    };
    window.fhReceiptAttachLedger = async function (t, offer) {
      var r = offer && offer._r; if (!t || !r || !window.fhPersonalSetReceipt) return false;
      var mult = window.curMult ? curMult() : 1000, amt = Math.round(Number(t.amt) * mult), paid = Math.round(r.paid);
      if (paid < amt) r._rcpt.adjusted = { charged: amt, refunded: amt - paid };
      _rjConstrain(r._rcpt, t.node || null);
      var ok = await fhPersonalSetReceipt(t.id, r._rcpt, { upgrade: false });
      if (!ok) return false;
      r._joined = 'ledger';
      _rjSettled();
      if (window.fhStagedRetireIds) { try { await fhStagedRetireIds([r.id].concat(r._copies || [])); } catch (e) { /* next pass retries */ } }
      return true;
    };

    /* Retroactive pass, debounced behind the personal hydrate. No queue rows
       here: a receipt whose bank twin is still PENDING must wait for the
       review (queue beats ledger), so this pass only ever attaches to rows
       already imported — and pending twins are exactly the rows whose amount
       equality this pass cannot see (their amounts are sealed), so it cannot
       steal them by construction. */
    var _rjTimer = null, _rjBusy = false;
    /* While the review queue is on screen the queue pass owns the receipts (queue
       beats ledger, RC10) and the person is about to decide rows the ledger pass
       would attach to; the automatic pass waits for the queue to close and then
       runs once. Direct runs are never deferred (2026-10-10, device-heat-spec). */
    var _rjDeferred = false;
    function _rjQueueOnScreen() { try { var m = document.getElementById('csv-import-modal'); return !!(m && m.classList.contains('on') && window.csvStagedMode); } catch (e) { return false; } }
    try { document.addEventListener('fhcover', function () { if (_rjDeferred && !_rjQueueOnScreen()) { _rjDeferred = false; window.fhReceiptLedgerSoon(); } }); } catch (e) { /* tests load this file without a document */ }
    window.fhReceiptLedgerSoon = function () {
      if (_rjTimer) clearTimeout(_rjTimer);
      _rjTimer = setTimeout(async function () {
        _rjTimer = null;
        if (_rjQueueOnScreen()) { _rjDeferred = true; return; }
        if (_rjBusy) return;
        _rjBusy = true;
        try { await _rjRun(null); } catch (e) { /* next hydrate retries */ }
        finally { _rjBusy = false; }
      }, 4000);
    };
  })();
