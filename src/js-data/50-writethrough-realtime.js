  const _origAddExpense = window.addExpense;
  window.addExpense = function () {
    if (_fhWriteLocked()) return;                            // guard BEFORE the optimistic local row exists
    const before = {}; (window.txns || []).forEach((t) => { before[t.id] = 1; });
    const beforeOrder = (window.order || []).slice();
    const exD = (typeof window.exDate === 'function') ? window.exDate() : null;
    _origAddExpense.apply(this, arguments);
    let nt = null; for (let i = 0; i < window.txns.length; i++) { if (!before[window.txns[i].id]) { nt = window.txns[i]; break; } }
    const newKeys = (window.order || []).filter((k) => beforeOrder.indexOf(k) < 0);
    const inserted = nt ? _dbInsertTxn(nt, exD) : Promise.resolve();
    // a future expense is a proposal — nudge the family's closed-app devices to review it
    if (nt && nt.future) inserted.then(() => { window.fhNotify && window.fhNotify('request_new', { et: 'expense', eid: nt._dbId || null }); });
    if (newKeys.length) {
      // Wait for the transaction's id before writing its mirror event — the
      // event must carry source_txn_id, or the link isn't durable and the next
      // photo-add spawns a duplicate.
      inserted.then(() => {
        newKeys.forEach((k) => {
          const e = window.events[k];
          if (e && nt && nt._dbId) { e._srcTxn = nt._dbId; nt.linkedEvent = k; }
          _dbInsertEvent(k);
        });
      });
    }
  };
  const _origSaveEdit = window.saveExpenseEdit;
  window.saveExpenseEdit = function () {
    if (_fhWriteLocked()) return;
    const id = window.editingTx;
    const tx = (id != null && typeof txById === 'function') ? txById(id) : null;
    const dbId = tx ? tx._dbId : null;
    const exD = (typeof window.exDate === 'function') ? window.exDate() : null;
    const beforeOrder = (window.order || []).slice();
    _origSaveEdit.apply(this, arguments);
    if (dbId && tx) _dbUpdateTxn(dbId, tx, exD);
    // adding a photo during an edit can spawn a linked "memory" event via syncExpenseEvent — persist it too
    (window.order || []).filter((k) => beforeOrder.indexOf(k) < 0).forEach((k) => {
      const e = window.events[k];
      if (e && dbId) e._srcTxn = dbId;      // bind the mirror to the expense it came from
      _dbInsertEvent(k);
    });
  };
  /* Bulk-assign write-through. Awaited by paDone() so its "Saving n/N" counter
     tracks real uploads rather than finishing before the bytes land — a toast
     fired at close time would be a lie if the upload then failed. */
  const _origPaApply = window.paApply;
  window.paApply = async function (txId, srcs) {
    if (_fhWriteLocked()) return null;                       // spawns mirror events + fundings — money writes
    const beforeOrder = (window.order || []).slice();
    const t = _origPaApply.apply(this, arguments);
    if (!t) return null;
    const dbId = t._dbId;
    if (dbId) {
      /* Diff the order and bind the mirror BEFORE the first await. A hydrate
         (realtime, window focus, an earlier _syncSoon) replaces window.events and
         window.order wholesale, so a diff taken after an await can find the key
         gone — _dbInsertEvent then bails on its `!e` guard and no events row is
         ever written. The photos still land in transaction_photos, so the expense
         shows them while Memories stays empty: silent, and permanent until the
         next photo on that expense happens to win the race.

         The inserts are also awaited, and run before the photo sync, so the
         700ms _syncSoon reload cannot overtake them. */
      const fresh = (window.order || []).filter((k) => beforeOrder.indexOf(k) < 0);
      fresh.forEach((k) => { const e = window.events[k]; if (e) e._srcTxn = dbId; });
      for (const k of fresh) await _dbInsertEvent(k);
      await _dbSyncTxnPhotos(dbId, t.photos);
      _syncSoon();
    }
    return t;
  };
  const _origDelete = window.deleteExpense;
  window.deleteExpense = function () {
    const tx = (window.editingTx != null && typeof txById === 'function') ? txById(window.editingTx) : null;
    const dbId = tx ? tx._dbId : null;
    // Its mirror event has to go first, through archive_event — that reverses the
    // funding and soft-deletes, matching how Delete Event behaves. Leaving it to
    // the FK would either strand a live orphan event or (with a hard cascade)
    // fail against the RESTRICT constraint on event_fundings.
    const mirrorId = (tx && tx.linkedEvent && window.events[tx.linkedEvent])
      ? window.events[tx.linkedEvent]._dbId : null;
    const before = (window.txns || []).length;
    _origDelete.apply(this, arguments);
    if (dbId && window.txns.length < before) {
      (async () => {
        try { if (mirrorId) await _rpc('archive_event', { p_event_id: mirrorId }); }
        catch (e) { _writeErr('mirror event archive failed', e); }
        _dbDeleteTxn(dbId);
      })();
    }
  };

  // ---- write-through: events & funding ----
  async function _dbInsertEvent(localKey, opts) {
    opts = opts || {};
    if (_fhWriteLocked()) return;
    try {
      const fid = window.DB.fid; if (!fid) return;
      const e = window.events[localKey]; if (!e || e._dbId) return;
      const iso = e.d ? _isoDate(e.d) : null;
      // created_by marks a user-proposed occasion (a request). Mirror events (born from
      // an expense) are never proposals, so they carry no creator.
      const _evCb = e._srcTxn ? null : (e._createdBy != null ? e._createdBy : ((window.DB && window.DB.ownerMemberId) || null));
      const row = Object.assign(
        { family_id: fid, emoji: e.emoji, cover: e.cov, target_date: iso, achieved: !!e.achieved, sort_order: 0, created_by: _evCb },
        await fhField('name', e.name), await fhField('target_amount', e.target || null));

      /* A mirror event belongs to its transaction. Looking the live mirror up by
         source_txn_id (rather than a re-insert) means a re-sync that lost the
         local link can't create a second one.
         This used to be sb.upsert(row, {onConflict:'source_txn_id'}), which reads as
         equivalent but silently dropped EVERY mirror-event write: the uniqueness on
         source_txn_id is a PARTIAL index (WHERE archived_at IS NULL, so an archived
         mirror frees the slot for a new one), and Postgres can't match a plain
         ON CONFLICT(source_txn_id) to a partial index — it throws 42P10 ("no unique
         or exclusion constraint matching"), which the catch below swallowed. Selecting
         the live row explicitly and updating/inserting by hand sidesteps that entirely. */
      let res;
      if (e._srcTxn) {
        row.source_txn_id = e._srcTxn;
        const existing = await sb.from('events').select('id').eq('source_txn_id', e._srcTxn).is('archived_at', null).maybeSingle();
        if (existing.error) throw existing.error;
        res = existing.data
          ? await sb.from('events').update(row).eq('id', existing.data.id).select('id').single()
          : await sb.from('events').insert(row).select('id').single();
      } else {
        res = await sb.from('events').insert(row).select('id').single();
      }
      if (res.error) throw res.error;
      const evId = res.data.id; e._dbId = evId; window.DB.eventById[evId] = res.data;
      // Mirror events read their photos from transaction_photos, so copying them
      // into event_memories would re-upload every image to storage on each sync.
      if (!e._srcTxn && e.memories && e.memories.length) _dbUploadEventMemories(evId, e.memories);
      const who = window.DB.ownerMemberId;
      const budgetAmt = e.achieved ? (e.saved || 0) : (e.setAside || 0);
      // tag budget-sourced funding with the month being viewed, not always "today's" month
      const _vm = window.months[window.selMonth] || {}; const fMonth = _vm._iso || window.DB.month;
      // One budget reservation per (event, month), so a re-sync can't reserve
      // the same money twice. This CANNOT be a plain upsert(onConflict:
      // 'event_id,month'): the uniqueness is a PARTIAL index
      // (event_fundings_budget_uniq WHERE source='budget', 0015), and Postgres
      // can't match ON CONFLICT to a partial index — it throws 42P10 ("no unique
      // or exclusion constraint matching"), which surfaced as a spurious "Có lỗi
      // xảy ra" toast on every photo-expense whose mirror event carries a budget.
      // Select the live budget row explicitly, then update or insert — same
      // shape the mirror-event write above uses for its own partial-index case.
      if (budgetAmt > 0) {
        const bf = await fhField('amount', budgetAmt);
        const ex = await sb.from('event_fundings').select('id').eq('event_id', evId).eq('month', fMonth).eq('source', 'budget').maybeSingle();
        if (ex.error) throw ex.error;
        if (ex.data) await _w(sb.from('event_fundings').update(bf).eq('id', ex.data.id), 'write event_fundings');
        else await _w(sb.from('event_fundings').insert(Object.assign({ family_id: fid, event_id: evId, member_id: who, source: 'budget', month: fMonth }, bf)), 'write event_fundings');
      }
      const sp = (e.saved || 0) - (e.setAside || 0);
      if (sp > 0 && opts.savingsSource) await _w(sb.from('event_fundings').insert(Object.assign({ family_id: fid, event_id: evId, member_id: who, source: 'savings', month: null }, await fhField('amount', sp))), 'write event_fundings');
      _syncSoon();
    } catch (e) { _writeErr('event insert failed', e); }
  }
  const _origAddEvent = window.addEvent;
  window.addEvent = function () {
    if (_fhWriteLocked()) return;
    const beforeOrder = (window.order || []).slice();
    _origAddEvent.apply(this, arguments);
    (window.order || []).filter((k) => beforeOrder.indexOf(k) < 0).forEach((k) => {
      const p = _dbInsertEvent(k, { savingsSource: (window.selSrc === 'savings') }); const ev = window.events[k]; if (ev) ev._dbPending = p;
      // a future occasion is a proposal (created_by is stamped in _dbInsertEvent) — same nudge as a future expense
      if (ev && !ev._srcTxn && ev.d && window.TODAY && ev.d > window.TODAY) p.then(() => { window.fhNotify && window.fhNotify('request_new', { et: 'occasion', eid: ev._dbId || null }); });
    });
  };
  const _origAddFunds = window.addFunds;
  window.addFunds = function () {
    if (_fhWriteLocked()) return;
    const evKey = (typeof chosen === 'function' && chosen('fn-event')) || window.curEvent || (window.order || [])[0];
    const who = (typeof chosen === 'function' && chosen('fn-who')) || null;
    const savingsBefore = window.savings;
    _origAddFunds.apply(this, arguments);
    const applied = savingsBefore - window.savings;
    const ev = window.events[evKey];
    if (applied > 0 && ev) {
      (async () => {
        try {
          if (!ev._dbId && ev._dbPending) { try { await ev._dbPending; } catch (e) {} }
          if (ev._dbId) { await _w(sb.from('event_fundings').insert(Object.assign({ family_id: window.DB.fid, event_id: ev._dbId, member_id: _memberIdForWho(who), source: 'savings', month: null }, await fhField('amount', applied))), 'write event_fundings'); _syncSoon(); }
        } catch (e) { _writeErr('funding insert failed', e); }
      })();
    }
  };

  // ---- write-through: memories added to an existing event ----
  const _origAddMemory = window.addMemory;
  if (typeof _origAddMemory === 'function') window.addMemory = function () {
    const ev = window.events[window.curEvent];
    const before = ev && ev.memories ? ev.memories.length : 0;
    _origAddMemory.apply(this, arguments);
    if (!ev || !ev.memories || ev.memories.length <= before) return;
    const added = ev.memories.slice(0, ev.memories.length - before);   // newest are unshifted to the front
    (async () => {
      try {
        if (!ev._dbId && ev._dbPending) { try { await ev._dbPending; } catch (e) {} }
        if (ev._dbId) await _dbUploadEventMemories(ev._dbId, added, before);
      } catch (e) { _writeErr('memory save failed', e); }
    })();
  };

  /* ---- write-through: deleting a single photo ----
     Two storage shapes to handle. A normal event's photos are event_memories
     rows; a photo-expense's mirror event reads straight from transaction_photos,
     so deleting there has to hit the expense's photo (and the in-memory txn, or
     the next expense save would re-upload what was just deleted). */
  const _origDelMemPhoto = window.deleteMemoryPhoto;
  if (typeof _origDelMemPhoto === 'function') window.deleteMemoryPhoto = function (i) {
    const ev = window.events[window.curEvent];
    const m = (ev && ev.memories) ? ev.memories[i] : null;
    _origDelMemPhoto.apply(this, arguments);
    if (!m) return;
    (async () => {
      try {
        if (m._txn) {
          const path = m._path || _storagePathFromUrl(m.src);
          if (path) await _w(sb.from('transaction_photos').delete().eq('transaction_id', m._txn).eq('photo_url', path), 'delete transaction photo');
          const tx = (window.txns || []).find((t) => t._dbId === m._txn);   // keep local state honest
          if (tx && tx.photos) {
            tx.photos = tx.photos.filter((p) => p !== m.src);
            if (!tx.photos.length) delete tx.photos;
          }
        } else if (m._id) {
          await _w(sb.from('event_memories').delete().eq('id', m._id), 'delete memory');
        }
        if (m._path) { try { await sb.storage.from('family-media').remove([m._path]); } catch (e) {} }
        _syncSoon();
      } catch (e) { _writeErr('photo delete failed', e); }
    })();
  };

  // ---- write-through: budget ----
  async function _dbSaveBudget() {
    try {
      const fid = window.DB.fid; if (!fid) return;
      const m = window.months[window.selMonth] || {};
      const month = m._iso || window.DB.month;
      // apply pending category renames as DB updates (avoids duplicate categories)
      const rn = window.__catRenames || []; window.__catRenames = [];
      for (const pr of rn) {
        const oldId = window.DB.catByName[pr[0]];
        if (oldId) { try { await _w(sb.from('categories').update(await fhField('name', pr[1])).eq('id', oldId), 'rename category'); window.DB.catByName[pr[1]] = oldId; delete window.DB.catByName[pr[0]]; if (window.DB.catById[oldId]) window.DB.catById[oldId].name = pr[1]; } catch (e) {} }
      }
      // removed categories → soft-delete (archived_at); history keeps its category_id, pickers drop it
      const del = window.__catDeletes || []; window.__catDeletes = [];
      for (const name of del) {
        const cid = window.DB.catByName[name]; if (!cid) continue;
        try {
          await _w(sb.from('category_budgets').delete().eq('family_id', fid).eq('category_id', cid), 'write category_budgets');
          await _w(sb.from('categories').update({ archived_at: new Date().toISOString() }).eq('id', cid), 'write categories');
          delete window.DB.catByName[name];
        } catch (e) { _writeErr('category remove failed', e); }
      }
      // monthly cap: the plaintext column stays NOT NULL (0 = scrubbed placeholder),
      // so an encrypted-only write still carries budget_total: 0 beside the ciphertext
      const mbf = await fhField('budget_total', m.budget || 0);
      if (mbf.budget_total == null) mbf.budget_total = 0;
      await _w(sb.from('monthly_budgets').upsert(Object.assign({ family_id: fid, month: month }, mbf), { onConflict: 'family_id,month' }), 'write monthly_budgets');
      for (let i = 0; i < window.catOrder.length; i++) {
        const name = window.catOrder[i]; const amt = window.catBudget[name] || 0;
        const cid = window.DB.catByName[name] || await _categoryIdForName(name, (window.catStyle[name] || [])[0], i + 1);
        if (!cid) continue;
        if (amt > 0) await _w(sb.from('category_budgets').upsert(Object.assign({ family_id: fid, month: month, category_id: cid }, await fhField('amount', amt)), { onConflict: 'family_id,month,category_id' }), 'write category_budgets');
        else await _w(sb.from('category_budgets').delete().eq('family_id', fid).eq('month', month).eq('category_id', cid), 'clear category budget');
      }
      _syncSoon();
    } catch (e) { _writeErr('budget save failed', e); }
  }
  const _origSetBudget = window.setBudget;
  window.setBudget = function () { if (_fhWriteLocked()) return; _origSetBudget.apply(this, arguments); _dbSaveBudget(); };

  // ---- write-through: theme ----
  const _origApplyTheme = window.applyTheme;
  window.applyTheme = function (k) {
    _origApplyTheme.apply(this, arguments);
    try { if (window.fhUser && window.DB.fid && k) sb.from('profiles').update({ theme: k }).eq('id', window.fhUser.id); } catch (e) {}
  };

  // ---- write-through: emotional weather (one shared mood per member) ----
  window.saveWeather = async function (weather) {
    try {
      const fid = window.DB && window.DB.fid, mid = window.DB && window.DB.ownerMemberId;
      if (!sb || !fid || !mid) return false;
      const now = new Date().toISOString();
      window.memberWeather = window.memberWeather || {};
      if (weather) window.memberWeather[mid] = { weather: weather, at: now };   // optimistic local echo
      else delete window.memberWeather[mid];
      window.DB._lastLocalWrite = Date.now();
      const res = weather
        ? await sb.from('member_weather').upsert({ family_id: fid, member_id: mid, weather: weather, updated_at: now }, { onConflict: 'family_id,member_id' })
        : await sb.from('member_weather').delete().eq('family_id', fid).eq('member_id', mid);
      if (res && res.error) console.warn('saveWeather', res.error);
      if (weather && !(res && res.error) && window.fhNotify) {
        const wd = window._wdef && window._wdef(weather);            // key → emoji + rough flag (22-home.js WEATHER table)
        window.fhNotify('weather', { emoji: (wd && wd.e) || '', rough: !!(wd && wd.rough) });
      }
      return true;
    } catch (e) { console.warn('saveWeather', e); return false; }
  };

  // ---- write-through: house customization (one shared {house,tree,pet} per family) ----
  // Optimistic local echo + set_family_house() RPC, then a debounced reload. Same
  // fire-and-persist shape as saveWeather; errors go through _writeErr like the rest.
  window.setFamilyHouse = async function (cfg) {
    try {
      const fid = window.DB && window.DB.fid;
      if (!sb || !fid) return false;
      window.FAM = window.FAM || {};
      window.FAM.house = cfg;                            // optimistic
      window.DB._lastLocalWrite = Date.now();
      const res = await sb.rpc('set_family_house', { p_house: cfg });
      if (res && res.error) { _writeErr('house save failed', res.error); return false; }
      _syncSoon();
      return true;
    } catch (e) { _writeErr('house save failed', e); return false; }
  };

  // ---- write-through: reactions (collaborative emoji on a transaction) ----
  // Upsert on (transaction_id, member_id) — re-reacting REPLACES, so the feed never
  // fills with one member's rapid taps; a null emoji (tapping your current reaction
  // again) removes it. The optimistic local update + re-render already happened in the
  // UI; this just persists. Not queued offline — reactions are ephemeral social
  // signals, same call shape as saveWeather().
  window.fhReact = async function (txDbId, emoji) {
    try {
      const fid = window.DB && window.DB.fid, mid = window.DB && window.DB.ownerMemberId;
      if (!sb || !fid || !mid || !txDbId) return false;
      window.DB._lastLocalWrite = Date.now();
      const nowIso = new Date().toISOString();
      const res = emoji
        ? await sb.from('reactions').upsert(
            { family_id: fid, transaction_id: txDbId, member_id: mid, emoji: emoji, created_at: nowIso, updated_at: nowIso },
            { onConflict: 'transaction_id,member_id' })
        : await sb.from('reactions').delete().eq('family_id', fid).eq('transaction_id', txDbId).eq('member_id', mid);
      if (res && res.error) { _writeErr('reaction failed', res.error); return false; }
      if (emoji && window.fhNotify) window.fhNotify('reaction', { emoji: emoji, tx: txDbId });   // nudge closed-app devices; tx routes the tap
      _syncSoon();
      return true;
    } catch (e) { _writeErr('reaction failed', e); return false; }
  };

  // ---- write-through: request reviews (align a future expense / goal / occasion) ----
  // Upsert on (entity_type, entity_id, member_id) — re-reviewing REPLACES; a null emoji
  // clears my review. Same call shape as fhReact, but polymorphic across the three
  // proposable entity types. Optimistic local update happens in the UI; this persists.
  window.fhReviewEntity = async function (entityType, entityId, emoji) {
    try {
      const fid = window.DB && window.DB.fid, mid = window.DB && window.DB.ownerMemberId;
      if (!sb || !fid || !mid || !entityType || !entityId) return false;
      window.DB._lastLocalWrite = Date.now();
      const nowIso = new Date().toISOString();
      const res = emoji
        ? await sb.from('request_reviews').upsert(
            { family_id: fid, entity_type: entityType, entity_id: entityId, member_id: mid, emoji: emoji, created_at: nowIso, updated_at: nowIso },
            { onConflict: 'entity_type,entity_id,member_id' })
        : await sb.from('request_reviews').delete().eq('family_id', fid).eq('entity_type', entityType).eq('entity_id', entityId).eq('member_id', mid);
      if (res && res.error) { _writeErr('request review failed', res.error); return false; }
      _syncSoon();
      return true;
    } catch (e) { _writeErr('request review failed', e); return false; }
  };

  // ---- realtime: reload on any change to this family's rows ----
  let _rtTimer = null;
  async function _subscribeRealtime(fid) {
    if (window.DB.rtFid === fid || !sb.channel) return;
    window.DB.rtFid = fid;
    try {
      // authenticate the realtime socket so RLS-gated postgres_changes are delivered
      try { const { data: { session } } = await sb.auth.getSession(); if (session && sb.realtime && sb.realtime.setAuth) await sb.realtime.setAuth(session.access_token); } catch (e) {}
      const ch = sb.channel('fam-' + fid);
      ['transactions', 'events', 'event_fundings', 'savings_entries', 'category_budgets', 'monthly_budgets', 'members', 'categories', 'event_memories', 'transaction_photos', 'incomes', 'saving_goals', 'member_weather', 'reactions', 'request_reviews', 'family_keys'].forEach((tbl) => {
        ch.on('postgres_changes', { event: '*', schema: 'public', table: tbl, filter: 'family_id=eq.' + fid }, () => {
          // Echo suppression (R3): our own writes already schedule a _syncSoon reload,
          // and realtime replays them straight back. Ignore ticks inside the local-write
          // window so a local change causes ONE reload, not two. Remote changes (no recent
          // local write) fall through and reload as before.
          if (Date.now() - (window.DB._lastLocalWrite || 0) < 2500) return;
          clearTimeout(_rtTimer); _rtTimer = setTimeout(() => { if (window.editingTx != null) return; window.loadFamilyData && window.loadFamilyData(); }, 900);
        });
      });
      // the families row itself (house customization lives here) — keyed on id, not family_id
      ch.on('postgres_changes', { event: '*', schema: 'public', table: 'families', filter: 'id=eq.' + fid }, () => {
        if (Date.now() - (window.DB._lastLocalWrite || 0) < 2500) return;
        clearTimeout(_rtTimer); _rtTimer = setTimeout(() => { if (window.editingTx != null) return; window.loadFamilyData && window.loadFamilyData(); }, 900);
      });
      ch.subscribe();
    } catch (e) { console.warn('realtime subscribe failed', e); }
  }

  // re-sync whenever the app is brought back to the foreground (iOS PWAs resume without reloading)
  let _lastRefresh = 0;
  function _refreshOnResume() {
    if (document.visibilityState === 'hidden') return;
    if (!window.DB || !window.DB.fid || window.editingTx != null) return;
    const now = Date.now();
    if (now - _lastRefresh < 2000) return;
    _lastRefresh = now;
    window.loadFamilyData && window.loadFamilyData();
  }
  document.addEventListener('visibilitychange', _refreshOnResume);
  window.addEventListener('focus', _refreshOnResume);
