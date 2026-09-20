  /* ── 0144: the tree backfill — old rows learn their node, on this device ───
     Every row written before the category tree existed has a label and no node.
     The server cannot fill that in: a personal row's category is ciphertext only
     this person can open, and an encrypted family's is no different. So the
     sweep runs HERE, in idle time, under whichever key is already loaded.

     Two steps per row, and the order is the whole safety argument:
       1. COARSE — the node the row's own label implies (a label that claims one
          group means every row under it is at least that group). Never wrong,
          because the person chose the label.
       2. REFINE — the keyword/lesson guess from the note, accepted ONLY when it
          falls under the coarse node's root. A guess that contradicts the label
          is discarded rather than applied: the label is the human's answer and
          this pass is not allowed to overrule it.
     The LABEL IS NEVER TOUCHED. Totals, budgets and every screen read the label,
     so a sweep that cannot move a label cannot move a number — which is what
     "nothing visible changes on day one" means in code.

     Resumable and cheap: 25 rows per idle slice, a cursor per scope in
     localStorage, stop at the first write error and pick it up next boot. */
  const _TBF_BATCH = 12;          // rows per slice
  const _TBF_LANES = 4;           // writes in flight
  const _TBF_SESSION_MAX = 400;   // and then stop until the next launch
  const _TBF_PAUSE = 1200;        // ms of quiet between slices
  let _tbfDoneThisSession = 0;
  const _tbfRunning = {}, _tbfStarted = {};

  function _tbfCursorKey(scope) {
    /* v3: v1 wrote the LABEL's group whenever a keyword
       disagreed, so those rows must be revisited. Bumping the key is what makes
       an already-swept device sweep again. */
    if (scope === 'family') return 'fh-tree-bf:v5:fam:' + ((window.DB && window.DB.fid) || '');
    return 'fh-tree-bf:v5:per:' + ((window.fhPersonalData && fhPersonalData().uid) || '');
  }
  function _tbfDone(scope) { try { return localStorage.getItem(_tbfCursorKey(scope)) === 'done'; } catch (e) { return false; } }
  function _tbfMarkDone(scope) { try { localStorage.setItem(_tbfCursorKey(scope), 'done'); } catch (e) {} }

  /* Deliberately lazy: the first slice waits out the hydrate's own render, and
     every later one leaves a real gap. A sweep nobody asked for must never be
     what the app is doing while someone is reading it. */
  const _tbfIdle = (fn, ms) => setTimeout(function () {
    if (window.requestIdleCallback) requestIdleCallback(fn, { timeout: 4000 }); else fn();
  }, ms || _TBF_PAUSE);

  /* The coarse node for one row, from the claims of the label it already sits in.
     A label that claims several groups ("Con cái") implies nothing, and that is
     an honest null: the row keeps no node until a human or a receipt says more. */
  function _tbfCoarse(scope, row) {
    if (typeof fhNodeFromClaims !== 'function') return null;
    let claims = null;
    if (scope === 'family') {
      claims = (window.catClaims || {})[row.cat];
    } else {
      const P = window.fhPersonalData ? fhPersonalData() : null;
      const lab = row.labelId && (P.labels || []).find((l) => l.id === row.labelId);
      claims = lab ? lab.claims : (typeof fhDefaultClaimsFor === 'function' ? fhDefaultClaimsFor(row.cat, row.emoji) : null);
    }
    return fhNodeFromClaims(claims || []);
  }

  /* The refined node, or the coarse one. `kind` comes from the row itself on the
     personal side (income/transfer/loan rows have their own trees) and is always
     'expense' on the family side, which has no other kind. */
  function _tbfNodeFor(scope, row) {
    const kind = (scope === 'personal' && row.kind) ? row.kind : 'expense';
    if (kind === 'repayment' || kind === 'transfer') return null;   // derived from structure, not from text
    /* EVIDENCE FIRST. The note names a real merchant far more often than the
       label is right about it — the old categories are exactly what this epic
       exists to improve, so letting one veto the other recorded every past
       mis-filing as fact ("QR2CK3U3TT SUPERSPORTS" under Ăn uống). The label
       only answers when the words say nothing at all. */
    /* First: does the row say it was never spending at all? A self-transfer or
       a card repayment sitting in the ledger as an expense gets its TRUE node,
       which both names it and marks the kind as worth fixing. This has to be
       asked before the guess, which reads "chuyen tien den <my own name>" as
       money sent to another person. */
    if (kind === 'expense') {
      try { const xf = fhTransferShape(row.note); if (xf) return xf; } catch (e) {}
    }
    let guess = null;
    try { guess = fhNodeGuess({ kind: kind, note: row.note, amount: row.amt }); }
    catch (e) { guess = null; }
    if (guess) return guess;
    return _tbfCoarse(scope, row);
  }

  /* One pass over one scope. Returns the number of rows written, or -1 when it
     stopped early (no key, write refused) so the caller does not mark it done. */
  /* A row the sweep should look at: one with no node, or one still resting on a
     bare GROUP, which is what the first version wrote whenever it preferred the
     label over the words. A leaf or a mid-level node is left alone — it either
     came from the pipeline, a person, or a keyword, and all three outrank this. */
  function _tbfWants(t) {
    if (t._tbfSkip) return false;
    if (!t.node) return true;
    const n = (typeof FH_TAX !== 'undefined') ? FH_TAX.get(t.node) : null;
    return !!(n && n.depth === 1);
  }
  async function _tbfSlice(scope) {
    if (_tbfDoneThisSession >= _TBF_SESSION_MAX) return 0;
    if (typeof document !== 'undefined' && document.hidden) return -1;   // backgrounded: stop, resume next launch
    const rows = [];
    if (scope === 'family') {
      if (typeof _fhWriteLocked === 'function' && _fhWriteLocked()) return -1;
      for (const t of (window.txns || [])) {
        if (!t._dbId || !_tbfWants(t)) continue;
        rows.push(t);
        if (rows.length >= _TBF_BATCH) break;
      }
    } else {
      const P = window.fhPersonalData ? fhPersonalData() : null;
      if (!P || !P.key || P.state !== 'ready') return -1;
      for (const t of (P.txns || [])) {
        if (t._unreadable || !_tbfWants(t)) continue;
        rows.push(t);
        if (rows.length >= _TBF_BATCH) break;
      }
    }
    if (!rows.length) return 0;
    /* Decide first (pure, instant), then write what actually changed, a few at
       a time. Sequential awaits over a whole ledger is what made the app feel
       stuck on open. */
    const work = [];
    for (const t of rows) {
      const node = _tbfNodeFor(scope, t);
      if (!node || node === t.node) { t._tbfSkip = 1; continue; }
      work.push({ t: t, node: node });
    }
    if (!work.length) return 0;
    let wrote = 0, refused = false;
    for (let i = 0; i < work.length; i += _TBF_LANES) {
      const lane = work.slice(i, i + _TBF_LANES);
      const res = await Promise.all(lane.map(async function (w) {
        try {
          return (scope === 'family')
            ? await window.fhTxnSetNode(w.t._dbId, w.node)
            : await window.fhPersonalSetNode(w.t.id, w.node);
        } catch (e) { return false; }
      }));
      for (let k = 0; k < lane.length; k++) {
        if (res[k]) { lane[k].t.node = lane[k].node; wrote++; _tbfDoneThisSession++; }
        else refused = true;
      }
      if (refused) break;                                       // next launch retries; the cursor stays put
    }
    return refused ? -1 : wrote;
  }

  /* Public entry: called from the family hydrate tail and the personal one.
     Idempotent, one run per scope at a time, and a no-op once the scope has
     nothing left (the cursor) or the tree is switched off. */
  window.fhTreeBackfill = function (scope) {
    scope = (scope === 'personal') ? 'personal' : 'family';
    if (typeof fhTreeOn === 'function' && !fhTreeOn()) return;
    if (typeof FH_TAX === 'undefined') return;
    if (_tbfRunning[scope] || _tbfStarted[scope] || _tbfDone(scope)) return;
    /* Once per page load. The hydrate tail is the trigger, and hydrate also runs
       on realtime, on focus and after every write — without this latch a single
       sweep could restart itself through its own writes. */
    _tbfStarted[scope] = true;
    _tbfRunning[scope] = true;
    const step = () => {
      _tbfSlice(scope).then((n) => {
        if (n > 0) { _tbfIdle(step); return; }                  // more to do, next idle slice
        _tbfRunning[scope] = false;
        if (n === 0) _tbfMarkDone(scope);                       // nothing left: stop asking, this device is current
        /* A skipped row (no node derivable) leaves the sweep "done" — it will be
           retried the next time the person edits it or a newer tree knows more,
           not by re-walking the ledger on every boot. */
        if (n === 0 && scope === 'personal' && window.renderPersonal) { try { renderPersonal(); } catch (e) {} }
      }).catch(() => { _tbfRunning[scope] = false; });
    };
    _tbfIdle(step);
  };
  /* Re-run a scope from scratch: used after a regroup changes what labels claim,
     and available by hand when a tree version lands with new leaves. */
  window.fhTreeBackfillReset = function (scope) {
    scope = (scope === 'personal') ? 'personal' : 'family';
    try { localStorage.removeItem(_tbfCursorKey(scope)); } catch (e) {}
    _tbfStarted[scope] = false; _tbfDoneThisSession = 0;
  };