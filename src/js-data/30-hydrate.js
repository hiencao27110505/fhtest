  // ---- THE hydrate: pull the whole active family into the app's globals ----
  window.loadFamilyData = async function loadFamilyData() {
    // "have we ever finished a hydrate" needs its own flag now — DB.fid is seeded
    // at login, so it no longer doubles as one.
    if (!window.DB._hydrated) _showLoading();
    try {
      const sess = (await sb.auth.getSession()).data.session;
      if (!sess || !window.FAM) return false;
      const uid = sess.user.id;
      // afterLogin() already learned the active family from my_families(), and it
      // writes it to DB.fid — same value profiles.family_id would give us. Only
      // pay for that round trip when we genuinely don't have it (e.g. a hydrate
      // that somehow beat login). switch_family clears DB.fid so a switch still
      // re-reads rather than reloading the family we just left.
      let fid = window.DB.fid;
      if (!fid) {
        const prof = (await sb.from('profiles').select('family_id').eq('id', uid).maybeSingle()).data;
        fid = prof && prof.family_id;
      }
      if (!fid) return false;
      window.DB.fid = fid;
      const now = new Date(window.TODAY ? window.TODAY.getTime() : Date.now()); now.setHours(0, 0, 0, 0);
      const monthDate = _isoMonth(now); window.DB.month = monthDate; window.DB.monthKey = MO[now.getMonth()];

      // R2: one round trip via get_family_snapshot() instead of 13 parallel table
      // reads. It runs SECURITY DEFINER, so the reads pay zero per-row RLS cost.
      // Falls back to the legacy multi-query hydrate if the RPC is absent or errors,
      // so an unmigrated env or a bad deploy can never take the app down.
      // p_txn_from stays null today (full ledger); it is the R6 windowing hook.
      let fam, mem, cat, cb, mb, tx, ev, ef, se, em, tp, inc, sg, rx, rr, encMeta, keyWraps;
      let snap = null;
      try { const rs = await sb.rpc('get_family_snapshot', { p_txn_from: null }); if (!rs.error && rs.data) snap = rs.data; }
      catch (e) { /* fall through to the multi-query hydrate */ }
      if (snap) {
        fam = snap.family; mem = snap.members || []; cat = snap.categories || [];
        cb = snap.category_budgets || []; mb = snap.monthly_budgets || [];
        tx = snap.transactions || []; ev = snap.events || []; ef = snap.event_fundings || [];
        se = snap.savings_entries || []; em = snap.event_memories || [];
        tp = snap.transaction_photos || []; inc = snap.incomes || []; sg = snap.saving_goals || [];
        rx = snap.reactions || [];                          // reactions arrive in the same payload (0023); [] on a pre-migration RPC
        rr = snap.request_reviews || [];                    // request reviews (0024): future-expense / goal / occasion alignment
        encMeta = snap.enc || null;                         // E2EE recipe (0030): enc_state + kdf + wrapped DEK
        keyWraps = snap.key_wraps || [];                    // Key Card wraps (0042): [] on a pre-migration RPC → dormant
      } else {
        const R = await Promise.all([
          sb.from('families').select('name,currency,default_language').eq('id', fid).maybeSingle(),
          sb.from('members').select('id,name,name_enc,color,is_shared,user_id,created_at,key_unlocked_at').eq('family_id', fid).is('archived_at', null).order('created_at'),
          // archived ones come along so old transactions still resolve their name; they're kept out of catOrder below
          sb.from('categories').select('id,name,name_enc,emoji,color,sort_order,archived_at').eq('family_id', fid).order('sort_order'),
          sb.from('category_budgets').select('category_id,amount,amount_enc,month').eq('family_id', fid),
          sb.from('monthly_budgets').select('month,budget_total,budget_total_enc,closed').eq('family_id', fid),
          sb.from('transactions').select('id,category_id,member_id,note,note_enc,amount,amount_enc,txn_date,status,created_by').eq('family_id', fid).order('txn_date', { ascending: false }),
          sb.from('events').select('id,name,name_enc,emoji,cover,target_amount,target_amount_enc,target_date,achieved,sort_order,source_txn_id,created_by').eq('family_id', fid).is('archived_at', null).order('sort_order'),
          sb.from('event_fundings').select('id,event_id,goal_id,amount,amount_enc,source,month,member_id').eq('family_id', fid),
          sb.from('savings_entries').select('kind,amount,amount_enc').eq('family_id', fid),
          sb.from('event_memories').select('id,event_id,emoji,caption,caption_enc,photo_url,sort_order').eq('family_id', fid).order('sort_order'),
          sb.from('transaction_photos').select('transaction_id,photo_url').eq('family_id', fid),
          sb.from('incomes').select('amount,amount_enc,income_date').eq('family_id', fid),
          sb.from('saving_goals').select('id,name,name_enc,emoji,target_amount,target_amount_enc,target_date,note,note_enc,occasion_id,achieved,sort_order,created_by').eq('family_id', fid).is('archived_at', null).order('sort_order'),
          // reactions (0023): a failed query on a pre-migration env resolves {data:null} → [], never throws, so hydrate survives
          sb.from('reactions').select('id,transaction_id,member_id,emoji,created_at').eq('family_id', fid),
          // request_reviews (0024): same fail-safe — [] on a pre-migration env
          sb.from('request_reviews').select('id,entity_type,entity_id,member_id,emoji,created_at').eq('family_id', fid),
          sb.from('family_keys').select('enc_state,kdf_salt,kdf_iters,kdf_version,wrapped_dek').eq('family_id', fid).maybeSingle(),
          // family_key_wraps (0042): [] on a pre-migration env (table absent → error → null), never throws
          sb.from('family_key_wraps').select('id,kind,kdf_salt,kdf_iters,kdf_version,wrapped_dek').eq('family_id', fid).is('rotated_at', null)
        ]);
        fam = R[0].data; mem = R[1].data || []; cat = R[2].data || []; cb = R[3].data || []; mb = R[4].data || [];
        tx = R[5].data || []; ev = R[6].data || []; ef = R[7].data || []; se = R[8].data || []; em = R[9].data || []; tp = R[10].data || []; inc = R[11].data || []; sg = R[12].data || []; rx = R[13].data || []; rr = R[14].data || [];
        encMeta = (R[15] && R[15].data) || null;
        keyWraps = (R[16] && R[16].data) || [];
      }

      /* ── E2EE (0030): learn the family's enc recipe, load the cached key, then
         resolve every money/name/note field IN PLACE so the mapping below (and
         all downstream UI) keeps seeing plain values. Rows the device can't
         decrypt resolve to null → Number() gives 0, and the lock bar offers the
         passcode prompt. */
      window.DB.enc = encMeta || null;
      window.DB.keyWraps = keyWraps || [];                  // Key Card wraps (0042); [] keeps the card flow dormant
      if (encMeta) { try { await fhKeyLoad(fid); } catch (e) {} }
      /* Encryption is FAMILY-wide and strict (option A): the moment the owner
         turns it on, every device learns it here (realtime on family_keys
         re-runs this hydrate). An un-keyed device gets the passcode prompt on
         app open and on each return to the foreground (re-nudged at most every
         10 minutes so a deliberate dismissal is respected), plus the permanent
         lock bar. Money WRITES are hard-blocked elsewhere until unlocked;
         reading and non-money features stay available, so a member who hasn't
         received the code yet is never locked out of the family. */
      const _needsKey = !!(encMeta && encMeta.enc_state !== 'off' && !fhKeyReady());
      if (window.fhLockBanner) window.fhLockBanner(_needsKey, encMeta && encMeta.enc_state);
      const _nudgeDue = _needsKey && (!window.__fhUnlockNudgedAt || Date.now() - window.__fhUnlockNudgedAt > 600000);
      if (_nudgeDue && window.editingTx == null && !document.querySelector('.sheet.on, .modal.on')) {
        window.__fhUnlockNudgedAt = Date.now();
        setTimeout(() => { try { window.fhUnlockPrompt && window.fhUnlockPrompt(); } catch (e) {} }, 700);
      }
      async function _decRows(rows, fields) {
        if (!encMeta) return;                                // no family_keys row → nothing encrypted
        await Promise.all((rows || []).map(async (r) => {
          for (const f of fields) r[f] = await fhRead(r, f);
        }));
      }
      await Promise.all([
        _decRows(tx, ['amount', 'note']),
        _decRows(cb, ['amount']),
        _decRows(mb, ['budget_total']),
        _decRows(ev, ['name', 'target_amount']),
        _decRows(ef, ['amount']),
        _decRows(se, ['amount']),
        _decRows(inc, ['amount']),
        _decRows(sg, ['name', 'target_amount', 'note']),
        _decRows(mem, ['name']),                             // 0038: member names
        _decRows(cat, ['name']),                             // 0038: category names
        _decRows(em, ['caption'])                            // 0038: photo captions
      ]);
      /* a member/category the device can't decrypt yet must not render as blank —
         give it a neutral label until the passcode unlocks the real one */
      mem.forEach((m) => { if (m.name == null) m.name = m.is_shared ? 'Shared' : L('Thành viên', 'Member'); });
      cat.forEach((c) => { if (c.name == null) c.name = '•••'; });

      if (fam) {
        window.FAM.familyName = fam.name;
        if (fam.currency) window.CUR = fam.currency;
        // Language is a per-member preference: a saved choice (Settings → Language) wins;
        // the family default only seeds a member who hasn't picked one yet.
        let _langPref = null; try { _langPref = localStorage.getItem('fh-lang'); } catch (e) {}
        if (_langPref === 'vi' || _langPref === 'en') window.LANG = _langPref;
        else if (fam.default_language) window.LANG = fam.default_language;
      }
      // shared house customization ({house,tree,pet}); [] / null on a pre-migration snapshot → keep whatever we have
      window.FAM.house = (fam && fam.house && typeof fam.house === 'object') ? fam.house : (window.FAM.house || {});

      // members → membersMeta + maps
      window.DB.memberById = {}; window.DB.memberByAppName = {}; window.DB.sharedId = null; window.DB.ownerMemberId = null;
      const mm = {};
      mem.forEach((m) => {
        window.DB.memberById[m.id] = m;
        const appName = m.is_shared ? 'Shared' : m.name;
        mm[appName] = { av: '', ini: inits(m.name), col: m.color || '#8f8a99' };
        window.DB.memberByAppName[appName] = m.id;
        if (m.is_shared) window.DB.sharedId = m.id;
        if (m.user_id === uid && !m.is_shared) window.DB.ownerMemberId = m.id;
      });
      if (!mm['Shared']) mm['Shared'] = { av: '', ini: '👥', col: '#8f8a99' };
      window.membersMeta = mm;
      window.FAM.members = mem.filter((m) => !m.is_shared).map((m) => ({ name: m.name, color: m.color || '#8f8a99', me: m.user_id === uid }));
      _rebuildWhoChips();

      // categories → catOrder / catStyle
      const order = [], style = {};
      window.DB.catById = {}; window.DB.catByName = {};
      cat.forEach((c) => {
        window.DB.catById[c.id] = c;                       // by id: archived included, so removals resolve to the catch-all
        if (c.archived_at) return;                          // archived: no picker entry, no budget row
        window.DB.catByName[c.name] = c.id;
        order.push(c.name); style[c.name] = [c.emoji || '🏷️', '#f2eef6', c.color || 'var(--cat-other)'];
      });
      window.catStyle = style;
      window.catOrder = ensureFallbackCat(order, style, null);   // the catch-all is always present

      // category budgets for the current month → catBudget
      const cbud = {}; window.catOrder.forEach((n) => { cbud[n] = 0; });
      cb.forEach((b) => { if (b.month === monthDate) { const c = window.DB.catById[b.category_id]; if (c && !c.archived_at) cbud[c.name] = Number(b.amount); } });
      window.catBudget = cbud;                            // catch-all share is derived in renderBudget()

      // photos grouped by transaction
      // The bucket is public, so a storage path maps to a stable URL we can build
      // locally — no round trip, and the same photo always resolves to the same
      // string. That last part is the whole point: the old signed-URL scheme
      // re-signed every photo in the family on every hydrate, and hydrate runs on
      // focus, on realtime, and 700ms after every write. Each fresh signature was
      // a brand-new URL, so the browser cache never hit and every image was
      // re-downloaded from scratch each time the app came to the foreground.
      const _PUB = SUPABASE_URL + '/storage/v1/object/public/family-media/';
      const _url = (p) => p ? (p.indexOf('http') === 0 ? p : (_PUB + p.split('/').map(encodeURIComponent).join('/'))) : p;
      const photosByTx = {}; window.DB.pathByUrl = {};
      tp.forEach((p) => { const u = _url(p.photo_url); (photosByTx[p.transaction_id] = photosByTx[p.transaction_id] || []).push(u); if (p.photo_url) window.DB.pathByUrl[u] = p.photo_url; });

      // months (from budgets) + transactions (derive spent)
      const byKey = {};
      function ensureMonth(iso) {
        const dt = new Date(iso + 'T00:00:00'); const key = MO[dt.getMonth()];
        if (!byKey[key]) {
          const dim = new Date(dt.getFullYear(), dt.getMonth() + 1, 0).getDate();
          const isCur = iso === monthDate;
          byKey[key] = { label: (window.fmtMonYear ? window.fmtMonYear(dt.getMonth(), dt.getFullYear()) : (MOF[dt.getMonth()] + ' ' + dt.getFullYear())), short: key, done: iso < monthDate, dim: dim, dom: isCur ? now.getDate() : dim, spent: 0, budget: 0, catSpent: {}, memberSpent: {}, _iso: iso };
          window.catOrder.forEach((n) => { byKey[key].catSpent[n] = 0; });
        }
        return byKey[key];
      }
      mb.forEach((b) => { const m = ensureMonth(b.month); m.budget = Number(b.budget_total); if (b.closed) m.done = true; });
      ensureMonth(monthDate);
      const newTxns = [];
      tx.forEach((t) => {
        const dt = new Date(t.txn_date + 'T00:00:00'); const mkey = MO[dt.getMonth()];
        const m = ensureMonth(t.txn_date);
        // unknown or since-removed category → the catch-all, never someone else's category
        const c = window.DB.catById[t.category_id];
        const catName = (c && !c.archived_at) ? c.name : CAT_FALLBACK;
        const mrec = t.member_id ? window.DB.memberById[t.member_id] : null;
        const who = mrec ? (mrec.is_shared ? 'Shared' : mrec.name) : 'Shared';
        const realized = (t.status !== 'planned') && (dt <= now);
        const amt = Number(t.amount);
        newTxns.push({ id: 'db_' + t.id, _dbId: t.id, _d: dt, _catId: t.category_id, _memberId: t.member_id, _createdBy: t.created_by || null, ico: (c && c.emoji) || '🧾', cat: catName, note: t.note || '', date: (_isoDate(dt) === _isoDate(now)) ? 'Today' : (MO[dt.getMonth()] + ' ' + dt.getDate()), who: who, amt: amt, month: mkey, future: realized ? undefined : true, photos: photosByTx[t.id] });
        if (realized) { m.spent += amt; m.catSpent[catName] = (m.catSpent[catName] || 0) + amt; m.memberSpent[who] = (m.memberSpent[who] || 0) + amt; }
      });
      newTxns.sort(function(a,b){ var ta=a._d?a._d.getTime():Infinity, tb=b._d?b._d.getTime():Infinity; return tb-ta; }); // newest first, globally
      window.txns = newTxns;

      // ── reactions (0023): group by transaction, hang onto each txn, keep a flat feed ──
      // Each reaction is {id, txId, memberId, emoji, at}. reactionsByTx powers the inline
      // chip; the flat, newest-first list powers the "Phòng khách" wall + the arrival check.
      window.DB.reactionsByTx = {};
      const _rxFlat = [];
      (rx || []).forEach((r) => {
        const rec = { id: r.id, txId: r.transaction_id, memberId: r.member_id, emoji: r.emoji, at: r.created_at };
        (window.DB.reactionsByTx[r.transaction_id] = window.DB.reactionsByTx[r.transaction_id] || []).push(rec);
        _rxFlat.push(rec);
      });
      newTxns.forEach((t) => { t.reactions = (t._dbId && window.DB.reactionsByTx[t._dbId]) || null; });
      _rxFlat.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));   // newest first
      window.reactions = _rxFlat;

      // ── request reviews (0024): group by entity (type:id) for the requests feature ──
      // Each review is {id, entityType, entityId, memberId, emoji, at}. reviewsByEntity
      // keyed 'expense:<id>' / 'goal:<id>' / 'occasion:<id>' powers alignment + the hub.
      window.DB.reviewsByEntity = {};
      (rr || []).forEach((r) => {
        const key = r.entity_type + ':' + r.entity_id;
        const rec = { id: r.id, entityType: r.entity_type, entityId: r.entity_id, memberId: r.member_id, emoji: r.emoji, at: r.created_at };
        (window.DB.reviewsByEntity[key] = window.DB.reviewsByEntity[key] || []).push(rec);
      });

      window.months = byKey;
      window.monthOrder = Object.keys(byKey).sort((a, b) => new Date(byKey[a]._iso) - new Date(byKey[b]._iso));
      window.selMonth = byKey[window.DB.monthKey] ? window.DB.monthKey : (window.monthOrder[window.monthOrder.length - 1] || window.DB.monthKey);

      // events + fundings + memories
      const savedByEvent = {}, setAsideByEvent = {}, fromSavingsByEvent = {}, fromBudgetByEvent = {}, contribByEvent = {};
      ef.forEach((f) => {
        const amt = Number(f.amount);
        savedByEvent[f.event_id] = (savedByEvent[f.event_id] || 0) + amt;
        if (f.source === 'savings') fromSavingsByEvent[f.event_id] = (fromSavingsByEvent[f.event_id] || 0) + amt;
        else fromBudgetByEvent[f.event_id] = (fromBudgetByEvent[f.event_id] || 0) + amt;
        if (f.source === 'budget' && f.month === monthDate) setAsideByEvent[f.event_id] = (setAsideByEvent[f.event_id] || 0) + amt;
        // per-member contributions → the event overlay's real contributor rows (replaces the old demo rows)
        if (f.event_id && f.member_id) { (contribByEvent[f.event_id] = contribByEvent[f.event_id] || {})[f.member_id] = (contribByEvent[f.event_id][f.member_id] || 0) + amt; }
      });
      const memByEvent = {};
      // _id / _path let a single photo be deleted later (row + storage object)
      em.forEach((x) => { (memByEvent[x.event_id] = memByEvent[x.event_id] || []).push(x.photo_url ? { src: _url(x.photo_url), caption: x.caption || '', _id: x.id, _path: x.photo_url } : { emoji: x.emoji || '📸', caption: x.caption || '', cls: 'ph-park', _id: x.id }); });
      const evObj = {}, evOrder = []; window.DB.eventById = {};
      ev.forEach((e) => {
        const d = e.target_date ? new Date(e.target_date + 'T00:00:00') : new Date(now.getTime() + 30 * 86400000);
        window.DB.eventById[e.id] = e;
        /* A mirror event's photos ARE its expense's photos — read them straight
           from transaction_photos rather than keeping a second copy in
           event_memories. One source of truth, and no duplicate uploads. */
        const mirrored = e.source_txn_id
          ? (photosByTx[e.source_txn_id] || []).map((src) => ({ src: src, _txn: e.source_txn_id, _path: (window.DB.pathByUrl || {})[src] || null }))
          : null;
        evObj[e.id] = { _dbId: e.id, name: e.name, emoji: e.emoji || '🎯', cov: e.cover || 'blue', date: e.target_date ? (MO[d.getMonth()] + ' ' + d.getDate()) : '', d: d, target: Number(e.target_amount), saved: savedByEvent[e.id] || 0, setAside: setAsideByEvent[e.id] || 0, fromSavings: fromSavingsByEvent[e.id] || 0, fromBudget: fromBudgetByEvent[e.id] || 0, achieved: !!e.achieved, memories: mirrored || memByEvent[e.id], contribs: contribByEvent[e.id] || null, _srcTxn: e.source_txn_id || null, _createdBy: e.created_by || null };
        evOrder.push(e.id);
      });
      window.events = evObj; window.order = evOrder;

      // ── saving goals (money, first-class) — funding aggregated by goal_id ──
      // The reserved / safe-to-spend engine still runs off `events`; goals are an
      // additive money surface, so no existing number moves. New pure goals are
      // funded from the savings pool (savings-source), which the pool math below
      // already subtracts family-wide.
      const savedByGoal = {}, fromSavingsByGoal = {};
      ef.forEach((f) => {
        if (!f.goal_id) return;
        const amt = Number(f.amount);
        savedByGoal[f.goal_id] = (savedByGoal[f.goal_id] || 0) + amt;
        if (f.source === 'savings') fromSavingsByGoal[f.goal_id] = (fromSavingsByGoal[f.goal_id] || 0) + amt;
      });
      const goalObj = {}, goalOrder = []; window.DB.goalById = {};
      sg.forEach((g) => {
        window.DB.goalById[g.id] = g;
        // A goal backfilled from a photo-expense mirror event is not a real saving
        // goal — it's a shadow of an expense. Keep those out of the Thu Chi list.
        const _occ = g.occasion_id ? window.DB.eventById[g.occasion_id] : null;
        if (_occ && _occ.source_txn_id) return;
        const gd = g.target_date ? new Date(g.target_date + 'T00:00:00') : null;
        goalObj[g.id] = { _dbId: g.id, name: g.name, emoji: g.emoji || '🎯', target: Number(g.target_amount), saved: savedByGoal[g.id] || 0, fromSavings: fromSavingsByGoal[g.id] || 0, d: gd, date: gd ? (MO[gd.getMonth()] + ' ' + gd.getDate()) : '', note: g.note || '', occasion_id: g.occasion_id || null, achieved: !!g.achieved, _createdBy: g.created_by || null };
        goalOrder.push(g.id);
      });
      window.goals = goalObj; window.goalOrder = goalOrder;

      /* Restore the expense↔mirror-event link. This is the step whose absence
         caused clones: syncExpenseEvent() falls back to minting a new key when a
         transaction has no linkedEvent, so without re-attaching it here every
         photo added after a reload created another event (and another funding). */
      const _evByTxn = {};
      ev.forEach((e) => { if (e.source_txn_id) _evByTxn[e.source_txn_id] = e.id; });
      newTxns.forEach((t) => {
        const evId = _evByTxn[t._dbId];
        if (evId) {
          t.linkedEvent = evId;
          if (evObj[evId]) evObj[evId].fromExpense = t.id;   // powers "Open expense" in memory detail
        }
      });
      if (!window.events[window.curEvent]) window.curEvent = window.order[0] || null;

      // savings pool = deposits − withdrawals − savings-source fundings
      let pool = 0;
      se.forEach((s) => { pool += (s.kind === 'deposit' ? 1 : -1) * Number(s.amount); });
      ef.forEach((f) => { if (f.source === 'savings') pool -= Number(f.amount); });
      window.savings = Math.max(0, pool);

      // income this month → the Thu Chi snapshot (informational; never touches safe-to-spend)
      let _mi = 0; const _imk = (monthDate || '').slice(0, 7);
      inc.forEach((r) => { if (((r.income_date) || '').slice(0, 7) === _imk) _mi += Number(r.amount); });
      window.monthIncome = _mi;

      try { localStorage.setItem('fh-fam', JSON.stringify(window.FAM)); localStorage.setItem('fh-lang', window.LANG); localStorage.setItem('fh-cur', window.CUR); } catch (e) {}

      // render everything
      if (typeof window.applyLang === 'function') window.applyLang();
      if (typeof window.applyCurrency === 'function') window.applyCurrency(); else { window.renderAll && window.renderAll(); window.renderEvents && window.renderEvents(); window.renderTxns && window.renderTxns(); }
      if (typeof window.setGreeting === 'function') window.setGreeting();
      updateHeroFam();
      _subscribeRealtime(fid);
      fhFresh();                                        // fresh data is on screen — drop the "Updating…" chip
      // emotional weather: one current mood per member (shared, realtime).
      // Fetched after first paint (it's tiny + off the critical path), then the
      // home sky repaints — this is what makes a mood set on one phone appear on
      // the others when the realtime tick re-runs loadFamilyData.
      try {
        const wr = await sb.from('member_weather').select('member_id,weather,updated_at').eq('family_id', fid);
        const wmap = {}; (wr.data || []).forEach((r) => { wmap[r.member_id] = { weather: r.weather, at: r.updated_at }; });
        window.memberWeather = wmap;
        if (typeof window.renderHome === 'function') window.renderHome();
      } catch (e) { window.memberWeather = window.memberWeather || {}; }
      try { if (window.fhPushResync) window.fhPushResync(); } catch (e) {}   // web push: re-point this device's subscription row (once per session)
      try { if (window.rxAfterHydrate) window.rxAfterHydrate(); } catch (e) {}   // reactions: refresh the wall + play any just-arrived reaction moment
      try { if (window.reqAfterHydrate) window.reqAfterHydrate(); } catch (e) {}   // future-expense requests: refresh mounts/hub + play any just-arrived decision
      window.DB._hydrated = true;                       // later hydrates are background refreshes, not cold starts
      if (window.fhSaveSnapshot) window.fhSaveSnapshot();   // cache it for the next cold start
      /* committed-enc family with the key: once per session, quietly retire any
         plaintext the 0038 valve tolerated + any not-yet-encrypted photos */
      window.__fhCovRan = window.__fhCovRan || {};
      if (!window.__fhCovRan[fid] && fhEncState() === 'enc' && fhKeyReady()) {
        window.__fhCovRan[fid] = 1;
        setTimeout(() => { try { window.fhEncCoverSweep && window.fhEncCoverSweep(); } catch (e) {} }, 3000);
      }
      /* a card link (#fh-key=) opened the app on this installed PWA: now that the
         family + its wraps are loaded, unlock with the stashed card if it fits.
         Guarded by __fhPendingCard, so this is inert in normal boots. */
      if (window.__fhPendingCard && window.fhHasCard && window.fhHasCard() && !fhKeyReady()) {
        const _pc = window.__fhPendingCard; window.__fhPendingCard = null;
        setTimeout(() => { try { window.fhCardUnlock && window.fhCardUnlock(_pc); } catch (e) {} }, 300);
      }
      // opaque claim link (#fh-claim=) stashed at boot: redeem it now that we're authenticated
      if (window.__fhPendingClaim && window.fhRedeemPendingClaim) {
        setTimeout(() => { try { window.fhRedeemPendingClaim(); } catch (e) {} }, 400);
      }
      return true;
    } catch (e) { console.warn('loadFamilyData failed', e); return false; }
    finally { _hideLoading(); fhFresh(); }     // the chip must clear even if the hydrate failed
  };
