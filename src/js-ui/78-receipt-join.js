  (function () {
    /* ═══ Receipt join — a merchant receipt annotates the transaction it
       describes (docs/specs/receipt-enrichment-spec.md §11) ═══════════════════

       The pipeline stages a Shopee / Grab / Apple order mail as a sealed row
       with row_kind = 'receipt' (0154): never a review card, never in the
       badge, never a transaction. This module is the receipt's whole life on
       the device:

         fetch pending receipt rows → open (the same sealed-box opener the
         queue uses) → collapse copies of one order (payment mail + delivered
         mail share an order id; the richest survives) → resolve each item's
         tree node (local, then the merchant-concepts backstop, names only) →
         take the basket's deepest common ancestor → JOIN:

           queue first — an open review's staged bank rows, matched on the
           exact paid total, ±1 day, with the card tail as confirm/veto. The
           bank row's card gets the receipt's description, node and 🧾 badge,
           and on import the blob is written with the ledger row and the
           receipt retires with the batch.

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
    async function _rjFetch() {
      try {
        var res = await sb.from('email_transactions')
          .select('id,member_id,owner_user_id,staging_scope,gmail_message_id,source_provider,occurred_at,amount,currency,direction,counterparty,reference_number,transaction_type,raw_extracted,duplicate_of_id,resolved_before,sealed,eph_pub,nonce,enc_v,created_at')
          .eq('review_status', 'pending').eq('row_kind', 'receipt')
          .order('occurred_at', { ascending: false }).limit(200);
        if (res.error) return [];
        return res.data || [];
      } catch (e) { return []; }
    }

    function _rjTail(s) {
      var m = String(s || '').match(/(\d{4})(?!.*\d)/);
      return m ? m[1] : null;
    }
    function _rjDayMs(iso) { var t = Date.parse(iso || ''); return isFinite(t) ? t : null; }

    /* Deepest common ancestor of the item nodes (spec RC9). Null items
       abstain; no resolved node, or a DCA that is a whole kind's root with
       depth 0, means the merchant tier decides as today. */
    function _rjDca(nodes) {
      var chains = [];
      (nodes || []).forEach(function (n) {
        if (!n || !window.FH_TAX || !FH_TAX.get(n)) return;
        var chain = [], cur = n;
        while (cur) { chain.unshift(cur); var nd = FH_TAX.get(cur); cur = nd && nd.parent; }
        chains.push(chain);
      });
      if (!chains.length) return null;
      var out = null;
      for (var d = 0; ; d++) {
        var v = chains[0][d];
        if (!v) break;
        var all = chains.every(function (ch) { return ch[d] === v; });
        if (!all) break;
        out = v;
      }
      return out;
    }

    /* Item → node: the shared concept cache first (statement path's backstop,
       names only — no price, no qty, no seller). Local lessons and keyword
       tiers speak Vietnamese family categories, not tree codes, so the
       backstop IS the local answer's source of nodes here; its cache makes
       repeat names free. Best-effort: unresolved items abstain. */
    async function _rjItemNodes(receipts) {
      var names = [];
      receipts.forEach(function (r) {
        ((r._rcpt && r._rcpt.items) || []).forEach(function (it) {
          if (it && it.name && !it.node) names.push(String(it.name).slice(0, 80));
        });
      });
      names = Array.from(new Set(names)).slice(0, 60);
      if (!names.length) return;
      var nodeMap = {};
      try {
        var res = await sb.functions.invoke('merchant-concepts', { body: { merchants: names } });
        nodeMap = (res && res.data && res.data.nodes) || {};
      } catch (e) { return; }
      receipts.forEach(function (r) {
        ((r._rcpt && r._rcpt.items) || []).forEach(function (it) {
          if (!it || !it.name || it.node) return;
          var nd = nodeMap[String(it.name).slice(0, 80)];
          if (nd && window.FH_TAX && FH_TAX.get(nd)) it.node = nd;
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
        orderId: (rc && rc.order_id) || x.reference_number || null,
        node: (x.node && window.FH_TAX && FH_TAX.get(x.node)) ? x.node : null,
        _rcpt: rc ? {
          v: 1, source: 'email', provider: row.source_provider || null,
          service_type: rc.service_type || null, order_id: rc.order_id || null,
          seller: rc.seller || null,
          items: Array.isArray(rc.items) ? rc.items.map(function (it) {
            return { name: (it && it.name) || null, qty: it && it.qty != null ? it.qty : null,
              unit_price: it && it.unit_price != null ? it.unit_price : null,
              line_discount: it && it.line_discount != null ? it.line_discount : null,
              variant: (it && it.variant) || null, node: null };
          }) : null,
          items_total: rc.items_total != null ? rc.items_total : null,
          discount: rc.discount != null ? rc.discount : null,
          shipping_fee: rc.shipping_fee != null ? rc.shipping_fee : null,
          paid: rc.paid != null ? rc.paid : null,
          paid_with_tail: _rjTail(rc.paid_with_tail),
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

      await _rjItemNodes(receipts);
      receipts.forEach(function (r) {
        if (!r._rcpt) return;
        var itemNodes = (r._rcpt.items || []).map(function (it) { return it.node; }).filter(Boolean);
        /* The basket's deepest common ancestor. A depth-1 answer ("Ăn uống"
           for rau + bún + thịt) is the honest shallow truth RC9 asks for; a
           basket whose chains share nothing (groceries + housewares) yields
           null from the walk itself, and the sealed node — the model's
           merchant-level guess — still stands. */
        var dca = itemNodes.length ? _rjDca(itemNodes) : null;
        r._node = dca || r.node || null;
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
            if (String(x.direction) !== 'debit') return;
            if (Math.round(Number(x.amount)) !== Math.round(r.paid)) return;
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
            if (tails.length === 1) hit = tails[0].q;    // the tail decides; else ambiguity → nothing
          }
          if (!hit) return;
          claimedRows[hit.id] = true;
          r._joined = 'queue';
          hit._rcpt = r._rcpt;
          hit._rcptRowId = r.id;
          hit._rcptDesc = r._desc || null;
          /* The basket's node rides the sealed slot the candidate builder
             already validates — deeper knowledge from the merchant, same
             door (57's receipt tier keeps its deeper-wins posture). */
          if (r._node) {
            var xx = hit.raw_extracted || (hit.raw_extracted = {});
            var deeper = !xx.node || (window.fhNodeDepth && fhNodeDepth(r._node) > fhNodeDepth(xx.node));
            if (deeper) xx.node = r._node;
          }
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
          /* A young receipt waits for the review: its bank twin usually
             arrives within hours and is imported through the queue, where the
             match has the tail and the person's eyes. Attaching a fresh
             receipt to an older same-amount ledger row here would be exactly
             the coincidence the ambiguity rule exists to refuse — it just
             cannot see the pending twin (sealed amount), so time stands in
             for it. */
          var born2 = Date.parse(r2.created_at || '') || 0;
          if (born2 > Date.now() - 2 * 864e5) continue;
          var rDay2 = _rjDayMs(r2.occurred_at);
          var cands = slice.filter(function (t) {
            if (t.kind !== 'expense' || t.link || claimedLedger[t.id]) return false;
            if (Math.round(t.amt * mult) !== Math.round(r2.paid)) return false;
            var tDay = _rjDayMs(t.date);
            return !(rDay2 != null && tDay != null && Math.abs(rDay2 - tDay) > 1.5 * 864e5);
          });
          if (cands.length !== 1) continue;              // ambiguity (or nothing): attach nothing
          /* Only a row that has no receipt yet — asked directly, because the
             slice does not carry the column. One cheap head query per attach. */
          var ok = await fhPersonalSetReceipt(cands[0].id, Object.assign({}, r2._rcpt, { node: r2._node || null }));
          if (ok) {
            claimedLedger[cands[0].id] = true;
            r2._joined = 'ledger';
            retire.push(r2.id);
          }
        }
      }

      /* ── grace: unmatched anywhere, older than the window → retire quietly ── */
      var cutoff = Date.now() - RECEIPT_GRACE_DAYS * 864e5;
      receipts.forEach(function (r) {
        if (r._joined) return;
        var born = Date.parse(r.created_at || '') || Date.parse(r.occurred_at || '') || Date.now();
        if (born < cutoff) retire.push(r.id);
      });

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
