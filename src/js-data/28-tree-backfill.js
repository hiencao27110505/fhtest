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
  const _TBF_BATCH = 25;
  const _tbfRunning = {};

  function _tbfCursorKey(scope) {
    if (scope === 'family') return 'fh-tree-bf:fam:' + ((window.DB && window.DB.fid) || '');
    return 'fh-tree-bf:per:' + ((window.fhPersonalData && fhPersonalData().uid) || '');
  }
  function _tbfDone(scope) { try { return localStorage.getItem(_tbfCursorKey(scope)) === 'done'; } catch (e) { return false; } }
  function _tbfMarkDone(scope) { try { localStorage.setItem(_tbfCursorKey(scope), 'done'); } catch (e) {} }

  const _tbfIdle = (fn) => (window.requestIdleCallback ? requestIdleCallback(fn, { timeout: 4000 }) : setTimeout(fn, 900));

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
    const coarse = _tbfCoarse(scope, row);
    let guess = null;
    try {
      guess = fhNodeGuess({ kind: kind, note: row.note, amount: row.amt,
        labelClaims: scope === 'family' ? (window.catClaims || {})[row.cat] : null });
    } catch (e) { guess = null; }
    if (guess && (!coarse || fhNodeGroup(guess) === fhNodeGroup(coarse))) return guess;
    return coarse;
  }

  /* One pass over one scope. Returns the number of rows written, or -1 when it
     stopped early (no key, write refused) so the caller does not mark it done. */
  async function _tbfSlice(scope) {
    const rows = [];
    if (scope === 'family') {
      if (typeof _fhWriteLocked === 'function' && _fhWriteLocked()) return -1;
      for (const t of (window.txns || [])) {
        if (t.node || !t._dbId) continue;
        rows.push(t);
        if (rows.length >= _TBF_BATCH) break;
      }
    } else {
      const P = window.fhPersonalData ? fhPersonalData() : null;
      if (!P || !P.key || P.state !== 'ready') return -1;
      for (const t of (P.txns || [])) {
        if (t.node || t._unreadable) continue;
        rows.push(t);
        if (rows.length >= _TBF_BATCH) break;
      }
    }
    if (!rows.length) return 0;
    let wrote = 0;
    for (const t of rows) {
      const node = _tbfNodeFor(scope, t);
      if (!node) { t.node = null; t._tbfSkip = 1; continue; }   // nothing to say about this row; never retried this session
      let ok = false;
      try {
        ok = (scope === 'family')
          ? await window.fhTxnSetNode(t._dbId, node)
          : await window.fhPersonalSetNode(t.id, node);
      } catch (e) { ok = false; }
      if (!ok) return -1;                                       // stop at the first refusal; next boot retries
      t.node = node; wrote++;
    }
    return wrote;
  }

  /* Public entry: called from the family hydrate tail and the personal one.
     Idempotent, one run per scope at a time, and a no-op once the scope has
     nothing left (the cursor) or the tree is switched off. */
  window.fhTreeBackfill = function (scope) {
    scope = (scope === 'personal') ? 'personal' : 'family';
    if (typeof fhTreeOn === 'function' && !fhTreeOn()) return;
    if (typeof FH_TAX === 'undefined') return;
    if (_tbfRunning[scope] || _tbfDone(scope)) return;
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
    try { localStorage.removeItem(_tbfCursorKey(scope === 'personal' ? 'personal' : 'family')); } catch (e) {}
  };