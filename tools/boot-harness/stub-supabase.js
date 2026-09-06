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

  var UID = '00000000-0000-4000-8000-000000000001';
  var FID = '00000000-0000-4000-8000-0000000000fa';
  var LOG = (window.__stubLog = []);
  function log(route, phase) { LOG.push({ t: Math.round(performance.now()), route: route, phase: phase }); }

  var SESSION = {
    access_token: 'stub-token', token_type: 'bearer', expires_in: 3600,
    user: { id: UID, email: 'stub@test.local', user_metadata: { full_name: 'Stub User' } }
  };

  function mkTxnRows(n) {
    var out = [], today = new Date();
    for (var i = 0; i < n; i++) {
      var d = new Date(today); d.setDate(d.getDate() - (i % 45));
      var iso = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
      out.push({ id: 'tx-' + i, owner_user_id: UID, amount_enc: 'AAAAAAAA', note_enc: null,
        cat_name_enc: null, counterparty_enc: null, cat_emoji: '🍜', occurred_time_enc: null,
        txn_date: iso, kind: 'expense', space_id: null, link_id: null, version: 1,
        updated_at: d.toISOString(), created_at: d.toISOString(), account_id: null,
        transfer_group_id: null, position_account_id: null, quantity_enc: null, due_date: null });
    }
    return out;
  }

  function route(name, ctx) {
    if (name === 'rpc:my_families') return [{ family_id: FID, name: 'Test Fam', is_active: true, is_owner: true, type: 'family' }];
    if (name === 'rpc:device_active') return true;
    if (name === 'rpc:get_personal_staging_key') return { staging_pub: null, staging_priv_enc: null };
    if (name === 'rpc:get_family_snapshot') return null;      // loadFamilyData tolerates a null snapshot via fallback… its failure is caught
    if (name.indexOf('rpc:') === 0) return null;
    if (name === 'from:profiles') return { language: 'vi', family_id: FID };
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
    var ctx = { single: false };
    var b = {};
    ['select', 'insert', 'update', 'upsert', 'delete', 'eq', 'neq', 'is', 'in', 'or', 'gte', 'lte', 'gt', 'lt',
     'like', 'ilike', 'not', 'order', 'range', 'limit', 'filter', 'match'].forEach(function (m) {
      b[m] = function () { return b; };
    });
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
    rpc: function (fn) { return settle('rpc:' + fn, {}); },
    channel: function () { var ch = { on: function () { return ch; }, subscribe: function () { return ch; }, unsubscribe: function () {} }; return ch; },
    removeChannel: function () {}, removeAllChannels: function () {},
    realtime: { setAuth: function () {} },
    storage: { from: function () { return { getPublicUrl: function () { return { data: { publicUrl: '' } }; }, upload: function () { return Promise.resolve({ data: null, error: null }); } }; } },
    functions: { invoke: function () { return Promise.resolve({ data: null, error: null }); } }
  };

  window.supabase = { createClient: function () { return client; } };
})();
