/* Stub vendor/supabase.js for the FamilyHub boot-timing harness.
   Replicates just enough of supabase-js v2's surface for the app's boot path.
   Latency + hang injection via window.__STUB (seeded by the harness):
     __STUB.lat      — ms added to every DB/RPC call (simulated RTT)
     __STUB.hang     — substring; any route containing it NEVER resolves
     __STUB.rows     — how many personal_transactions rows to return
   Every call start/end is appended to window.__stubLog for the waterfall. */
(function () {
  var CFG = (window.__STUB = window.__STUB || {});
  if (CFG.lat == null) CFG.lat = Number(localStorage.getItem('stub-lat') || 300);
  if (CFG.hang == null) CFG.hang = localStorage.getItem('stub-hang') || '';
  if (CFG.rows == null) CFG.rows = Number(localStorage.getItem('stub-rows') || 800);
  // UI harness (tools/ui-harness): a full get_family_snapshot payload, JSON in
  // localStorage. Unset → null snapshot, exactly the boot harness's behaviour.
  if (CFG.family === undefined) { try { CFG.family = JSON.parse(localStorage.getItem('stub-family') || 'null'); } catch (e) { CFG.family = null; } }
  if (CFG.lang == null) CFG.lang = localStorage.getItem('stub-lang') || 'vi';   // profiles.language: the app copies it into LANG on login
  /* Spaces (docs/specs/spaces-spec.md). 'stub-space' = { type, profile, name, closed }
     for the ACTIVE container (default: a plain family); 'stub-spaces' = extra
     roster rows [{ family_id, name, type, profile, members, is_owner }];
     'stub-invites' = find_my_invites rows. txn_shares and settle_ups are kept in
     a tiny table store so a split written in a flow comes back on the next read. */
  if (CFG.space === undefined) { try { CFG.space = JSON.parse(localStorage.getItem('stub-space') || 'null'); } catch (e) { CFG.space = null; } }
  if (CFG.spaces === undefined) { try { CFG.spaces = JSON.parse(localStorage.getItem('stub-spaces') || '[]') || []; } catch (e) { CFG.spaces = []; } }
  if (CFG.invites === undefined) { try { CFG.invites = JSON.parse(localStorage.getItem('stub-invites') || '[]') || []; } catch (e) { CFG.invites = []; } }
  var TABLES = (CFG.tables = CFG.tables || { txn_shares: [], settle_ups: [] });
  var ACTIVE = null;                                    // set by switch_family; null = the fixture family

  var UID = '00000000-0000-4000-8000-000000000001';
  var FID = '00000000-0000-4000-8000-0000000000fa';
  var LOG = (window.__stubLog = []);
  var WRITES = (window.__stubWrites = []);   // every insert/update/upsert/delete: {t, table, op, payload, eq}
  var SEQ = 0;
  function log(route, phase) { LOG.push({ t: Math.round(performance.now()), route: route, phase: phase }); }

  var SESSION = {
    access_token: 'stub-token', token_type: 'bearer', expires_in: 3600,
    user: { id: UID, email: 'stub@test.local', user_metadata: { full_name: CFG.family ? 'Minh' : 'Stub User' } }
  };

  function mkTxnRows(n) {
    var out = [], today = new Date();
    for (var i = 0; i < n; i++) {
      var d = new Date(today); d.setDate(d.getDate() - (i % 45));
      var iso = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
      out.push({ id: 'tx-' + i, owner_user_id: UID, amount_enc: 'AAAAAAAA', note_enc: null,
        cat_name_enc: null, counterparty_enc: null, cat_emoji: '🍜', occurred_time_enc: null,
        txn_date: iso, kind: 'expense', space_id: null, link_id: null, version: 1,
        updated_at: new Date(Math.floor(d.getTime() / 864e5) * 864e5).toISOString(), created_at: new Date(Math.floor(d.getTime() / 864e5) * 864e5).toISOString(),   /* day-truncated: a row must look the same on every fetch or every hydrate reads as new data */ account_id: null,
        transfer_group_id: null, position_account_id: null, quantity_enc: null, due_date: null });
    }
    return out;
  }

  /* Writes against the fixture family behave like a tiny database so a flow
     (add → re-hydrate → delete) sees its own rows come back. Other tables just
     get an id minted for inserts. Reads never change. */
  function applyWrite(table, ctx) {
    var F = CFG.family;
    var rows = Array.isArray(ctx.payload) ? ctx.payload : [ctx.payload || {}];
    if (TABLES[table]) {                                 // spaces: txn_shares (one per txn_id) and settle_ups
      var T = TABLES[table], hit = function (r) { return Object.keys(ctx.eq || {}).every(function (k) { return r[k] === ctx.eq[k]; }); };
      if (ctx.op === 'insert' || ctx.op === 'upsert') {
        var made = rows.map(function (r) {
          var old = (table === 'txn_shares') ? T.filter(function (x) { return x.txn_id === r.txn_id; })[0] : null;
          if (old) { Object.assign(old, r); return old; }
          var n = Object.assign({ id: 'stub-' + table + '-' + (++SEQ) }, r); T.push(n); return n;
        });
        return ctx.single ? made[0] : made;
      }
      if (ctx.op === 'delete') TABLES[table] = T.filter(function (r) { return !hit(r); });
      if (ctx.op === 'update') T.forEach(function (r) { if (hit(r)) Object.assign(r, ctx.payload); });
      return null;
    }
    if (ctx.op === 'insert' || ctx.op === 'upsert') {
      var out = rows.map(function (r) { return Object.assign({ id: 'stub-' + table + '-' + (++SEQ) }, r); });
      if (F && Array.isArray(F[table])) out.forEach(function (r) { F[table].push(r); });
      return ctx.single ? out[0] : out;
    }
    if (F && Array.isArray(F[table]) && ctx.eq) {
      var match = function (r) { return Object.keys(ctx.eq).every(function (k) { return r[k] === ctx.eq[k]; }); };
      if (ctx.op === 'delete') F[table] = F[table].filter(function (r) { return !match(r); });
      if (ctx.op === 'update') F[table].forEach(function (r) { if (match(r)) Object.assign(r, ctx.payload); });
    }
    return null;
  }

  function route(name, ctx) {
    var F = CFG.family;
    if (ctx && ctx.op) { WRITES.push({ t: Math.round(performance.now()), table: ctx.table, op: ctx.op, payload: ctx.payload, eq: ctx.eq || null }); return applyWrite(ctx.table, ctx); }
    if (F && name === 'rpc:get_family_snapshot' && ctx && ctx.args && ctx.args.p_txn_from) {
      // windowed refresh: only the ledger slice from p_txn_from on (the client merges it onto its baseline)
      var from = ctx.args.p_txn_from, keep = new Set();
      var W = Object.assign({}, F);
      W.transactions = F.transactions.filter(function (r) { if (r.txn_date >= from) { keep.add(r.id); return true; } return false; });
      W.transaction_photos = (F.transaction_photos || []).filter(function (p) { return keep.has(p.transaction_id); });
      W.reactions = (F.reactions || []).filter(function (r) { return keep.has(r.transaction_id); });
      return W;
    }
    if (name === 'rpc:my_families') {
      var sp0 = CFG.space || {};
      var act = ACTIVE || FID;
      return [{ family_id: FID, name: sp0.name || (F && F.family ? F.family.name : 'Test Fam'), is_active: act === FID, is_owner: sp0.is_owner !== false, type: sp0.type || 'family',
        profile: sp0.profile || {}, closed: !!sp0.closed, members: F && F.members ? F.members.filter(function (m) { return !m.is_shared; }).length : 1 }]
        .concat((CFG.spaces || []).map(function (r) { return Object.assign({ is_owner: false, type: 'friend', profile: {}, closed: false, members: 1 }, r, { is_active: act === r.family_id }); }));
    }
    if (name === 'rpc:switch_family') { ACTIVE = ctx.args.p_family_id; return null; }
    if (name === 'rpc:create_space') { var nid = 'aaaaaaaa-0000-4000-8000-' + String(++SEQ).padStart(12, '0'); CFG.spaces.push({ family_id: nid, name: ctx.args.p_name, type: ctx.args.p_type || 'friend', profile: ctx.args.p_profile || {}, is_owner: true, members: 1 }); return nid; }
    if (name === 'rpc:init_space_card') return 'stub-wrap';
    if (name === 'rpc:space_update') {
      var tgt = ctx.args.p_family_id === FID ? (CFG.space = CFG.space || {}) : (CFG.spaces || []).filter(function (r) { return r.family_id === ctx.args.p_family_id; })[0];
      if (tgt) { if (ctx.args.p_name) tgt.name = ctx.args.p_name; if (ctx.args.p_profile) tgt.profile = ctx.args.p_profile; }
      return { family_id: ctx.args.p_family_id };
    }
    if (name === 'rpc:space_close') { var c0 = ctx.args.p_family_id === FID ? (CFG.space = CFG.space || {}) : (CFG.spaces || []).filter(function (r) { return r.family_id === ctx.args.p_family_id; })[0]; if (c0) c0.closed = ctx.args.p_closed !== false; return null; }
    if (name === 'rpc:find_my_invites') return CFG.invites || [];
    if (name === 'rpc:space_whitelist_list' || name === 'rpc:space_whitelist_add' || name === 'rpc:space_whitelist_cancel') return [];
    if (TABLES[name.replace('from:', '')]) {
      var tn = name.replace('from:', ''), q = (ctx && ctx.eq) || {};
      var out = TABLES[tn].filter(function (r) { return Object.keys(q).every(function (k) { return r[k] === q[k]; }); });
      return ctx && ctx.single ? (out[0] || null) : out;
    }
    if (F && name === 'rpc:get_family_snapshot') return F;
    /* the spaces light path (22-spaces.js fhSpaceHydrate) reads the fixture's own
       rows by explicit id; recognised by its column list so no other read changes */
    if (F && name === 'from:transactions' && ctx && ctx.sel && ctx.sel.indexOf('amount,amount_enc,note,note_enc') >= 0) return (F.transactions || []).filter(function (r) { return r.status !== 'planned'; }).slice().sort(function (a, b) { return a.txn_date < b.txn_date ? 1 : -1; });
    if (F && name === 'from:categories' && ctx && ctx.sel === 'id,name,name_enc,emoji') return F.categories || [];
    if (F && name === 'from:members') return F.members;
    if (F && name === 'from:user_consents') {   // a consented user: both gates (bank_email v4, app_data v1) already agreed
      var rows = [{ kind: 'app_data', version: 1, consented_at: '2026-01-01T00:00:00Z' }, { kind: 'bank_email', version: 4, consented_at: '2026-01-01T00:00:00Z' }];
      if (ctx && ctx.eq && ctx.eq.kind) rows = rows.filter(function (r) { return r.kind === ctx.eq.kind; });
      return ctx && ctx.single ? (rows[0] || null) : rows;
    }
    if (F && name === 'from:families') return ctx && ctx.single ? F.family : [F.family];
    if (name === 'rpc:device_active') return true;
    if (name === 'rpc:get_personal_staging_key') return { staging_pub: null, staging_priv_enc: null };
    if (name === 'rpc:get_family_snapshot') return null;      // loadFamilyData tolerates a null snapshot via fallback… its failure is caught
    if (name.indexOf('rpc:') === 0) return null;
    if (name === 'from:profiles') return { language: CFG.lang, family_id: FID };
    if (name === 'from:personal_keys') return { kdf_salt: 'aa', kdf_iters: 600000, kdf_version: 1, wrapped_dek: 'AAAA' };
    if (name === 'from:personal_transactions') return mkTxnRows(CFG.rows);
    if (name === 'from:personal_budgets') return null;
    if (name === 'from:personal_accounts') return [];
    if (name === 'from:personal_transaction_photos') return [];
    if (name === 'from:personal_review_memory') return [];
    if (name === 'from:members') return [{ name: 'Stub User', color: '#8f8a99', is_shared: false, user_id: UID }];
    if (name === 'from:families') return { name: 'Test Fam', currency: 'VND', default_language: 'vi' };
    return ctx && ctx.single ? null : [];
  }

  function settle(name, ctx) {
    log(name, 'start');
    return new Promise(function (res) {
      if (CFG.hang && name.indexOf(CFG.hang) >= 0) { log(name, 'HUNG'); return; }   // never resolves
      setTimeout(function () {
        var data = route(name, ctx);
        log(name, 'end');
        res({ data: data, error: null, count: null, status: 200, statusText: 'OK' });
      }, CFG.lat);
    });
  }

  function builder(table) {
    var ctx = { single: false, table: table };
    var b = {};
    b.select = function (cols) { if (!ctx.op) ctx.sel = String(cols || ''); return b; };
    ['neq', 'is', 'in', 'or', 'gte', 'lte', 'gt', 'lt',
     'like', 'ilike', 'not', 'order', 'range', 'limit', 'filter', 'match'].forEach(function (m) {
      b[m] = function () { return b; };
    });
    ['insert', 'update', 'upsert', 'delete'].forEach(function (m) {
      b[m] = function (payload) { ctx.op = m; ctx.payload = payload; return b; };
    });
    b.eq = function (k, v) { ctx.eq = ctx.eq || {}; ctx.eq[k] = v; return b; };
    b.maybeSingle = function () { ctx.single = true; return b; };
    b.single = function () { ctx.single = true; return b; };
    b.then = function (onOk, onErr) { return settle('from:' + table, ctx).then(onOk, onErr); };
    b.catch = function (fn) { return b.then(null, fn); };
    b.finally = function (fn) { return settle('from:' + table, ctx).finally(fn); };
    return b;
  }

  var client = {
    auth: {
      getSession: function () { log('auth.getSession', 'sync'); return Promise.resolve({ data: { session: SESSION }, error: null }); },
      getUser: function () { return Promise.resolve({ data: { user: SESSION.user }, error: null }); },
      onAuthStateChange: function () { return { data: { subscription: { unsubscribe: function () {} } } }; },
      signOut: function () { return Promise.resolve({ error: null }); },
      signInWithIdToken: function () { return Promise.resolve({ data: {}, error: { message: 'stub' } }); },
      signInWithOAuth: function () { return Promise.resolve({ data: {}, error: { message: 'stub' } }); }
    },
    from: function (t) { return builder(t); },
    rpc: function (fn, args) { return settle('rpc:' + fn, { args: args || {} }); },
    channel: function () { var ch = { on: function () { return ch; }, subscribe: function () { return ch; }, unsubscribe: function () {} }; return ch; },
    removeChannel: function () {}, removeAllChannels: function () {},
    realtime: { setAuth: function () {} },
    storage: { from: function () { return { getPublicUrl: function () { return { data: { publicUrl: '' } }; }, upload: function () { return Promise.resolve({ data: null, error: null }); }, remove: function () { return Promise.resolve({ data: null, error: null }); } }; } },
    functions: { invoke: function () { return Promise.resolve({ data: null, error: null }); } }
  };

  window.supabase = { createClient: function () { return client; } };
})();
