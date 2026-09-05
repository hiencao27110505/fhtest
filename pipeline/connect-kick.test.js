#!/usr/bin/env node
/* The connect-time kick: one named mailbox, right now.
 * `node pipeline/connect-kick.test.js`
 *
 * Diagnosed 2026-09-05: nothing in the connect callback started a read, so the
 * first rows always waited for the once-a-minute backfill lane — measured at
 * exactly 60s of pure scheduling delay on every connect, which the person
 * spends staring at an empty screen deciding the feature does not work.
 *
 * The fix is worker.runOne(grantId, ctx), fired by mailbox-connect through the
 * {grant} body on mailbox-sync. These are the promises:
 *
 *   1. it runs exactly the named grant — never the whole due list
 *   2. a small first backfill that finishes in this one run notifies, by the
 *      NORMAL completion rule — the kick adds no new notify path
 *   3. an unknown id is a quiet result, not a throw (the caller is
 *      fire-and-forget; the minute lane owns whatever was declined)
 *   4. grantById carries dueGrants' own needs_reauth filter, so the kick can
 *      never run a mailbox the poll would refuse
 *   5. a held mailbox stays held and silent, same as under runAll
 *
 * Driven through the real runOne with a fake Google and a fake database, the
 * way the rest of the direct-read suite is.
 */
const path = require('path');
const { pathToFileURL } = require('url');
const { webcrypto } = require('crypto');

let pass = 0, fail = 0;
const t = (n, ok, d) => { console.log((ok ? '  PASS  ' : '  FAIL  ') + n + (!ok && d ? '  -> ' + d : '')); ok ? pass++ : fail++; };
const M = (f) => pathToFileURL(path.join(__dirname, '..', 'supabase', 'functions', '_shared', 'mailbox', f)).href;
const nacl = require(path.join(__dirname, '..', 'node_modules', 'tweetnacl'));

/* A mail the deterministic tiers CAN read — no model call, hermetic. */
const readable = (n) => `MB TK chạm
x5249
Ngày, giờ giao dịch
2026-08-2${n % 9} 07:57:21
Điểm giao dịch
SHOP ${n}
Số tiền
-14,700 VND
Số dư
53,346,051 VND`;

function fakeDb(state) {
  return {
    dueGrants: async () => { state.dueGrantsCalls++; return state.grants; },
    grantById: async (id) => {
      state.grantByIdCalls.push(id);
      // dueGrants' own filter, mirrored — promise 4 rides on this.
      return state.grants.find((g) => g.id === id && !g.needs_reauth) || null;
    },
    memberById: async (id) => ({ id, family_id: 'fam-1', archived_at: null }),
    stagingPubForFamily: async () => state.pub,
    stagingPubForUser: async () => state.pub,
    providerDomains: async () => [],
    stagedState: async () => ({ staged: new Set(), resolved: new Map() }),
    saveCoverageCandidates: async () => {},
    fingerprint: async () => null,
    fingerprintsForSenders: async () => new Map(),
    saveFingerprint: async () => {},
    senderTally: async () => ({ txn: 0, junk: 0 }),
    stagedCandidates: async () => [],
    loadLearnedLabels: async () => new Map(),
    insertStaged: async (row) => { state.inserted.push(row); return true; },
    recordFailure: async () => {},
    markSynced: async (id, patch) => { state.synced.push({ id, patch }); },
    markNeedsReauth: async () => {},
    bumpReadTally: async () => {},
    recordStall: async () => {},
    clearStall: async () => {},
    pendingCount: async () => state.inserted.length,
    watchesDue: async () => [],
    saveWatch: async () => {},
  };
}

function fakeCtx(state, tokenKey) {
  return {
    db: fakeDb(state),
    nacl,
    rng: webcrypto,
    subtle: webcrypto.subtle,
    dedupKey: Buffer.from(new Uint8Array(32).fill(7)).toString('base64'),
    tokenKey,
    fromBytea: (x) => x,
    google: { clientId: 'c', clientSecret: 's' },
    llm: { apiKey: '' },
    fetch: async (url) => {
      const u = String(url);
      if (u.includes('oauth2.googleapis.com')) {
        state.tokenExchanges++;
        return { ok: true, status: 200, text: async () => JSON.stringify({ access_token: 'a' }) };
      }
      if (u.includes('/messages?')) {
        return { ok: true, status: 200, json: async () => ({ messages: state.ids.map((m) => ({ id: m.id })) }) };
      }
      if (u.includes('/messages/')) {
        const id = decodeURIComponent(u.split('/messages/')[1].split('?')[0]);
        const m = state.ids.find((x) => x.id === id);
        return { ok: true, status: 200, json: async () => ({
          threadId: 't', internalDate: '1787705846000',
          payload: { headers: [
            { name: 'From', value: 'mbcard@mbbank.com.vn' },
            { name: 'Subject', value: 'Thông báo TK chạm' },
            { name: 'Authentication-Results', value: 'dkim=pass header.d=mbbank.com.vn' },
          ], body: { data: Buffer.from(m.body, 'utf8').toString('base64url') }, mimeType: 'text/plain' },
        }) };
      }
      throw new Error('HERMETIC BREACH — unexpected fetch: ' + u);
    },
    notify: async (grant, count, meta) => { state.notifies.push({ grantId: grant.id, count, meta }); },
  };
}

(async () => {
  const W = await import(M('worker.mjs'));
  const { encryptToken } = await import(M('token-crypto.mjs'));
  const TOKEN_KEY = Buffer.from(new Uint8Array(32).fill(3)).toString('base64');
  const ENC = await encryptToken('refresh-token', TOKEN_KEY, { subtle: webcrypto.subtle, rng: webcrypto });

  const GRANT = (over = {}) => ({
    id: 'g1', email: 'a@gmail.com', user_id: 'u1', member_id: 'm1', family_id: 'fam-1',
    provider: 'google', refresh_token_enc: ENC, scopes: 'gmail.readonly',
    needs_reauth: false, history_id: null,
    last_synced_at: null, backfilled_at: null, connected_at: '2026-09-05T00:00:00Z',
    default_scope: 'personal', backfill_days: 90, stalled_runs: 0, first_stalled_at: null, ...over,
  });

  function newState(msgCount, grants) {
    return {
      pub: Buffer.from(nacl.box.keyPair().publicKey).toString('base64'),
      ids: Array.from({ length: msgCount }, (_, i) => ({ id: 'm' + i, body: readable(i) })),
      inserted: [], synced: [], notifies: [],
      dueGrantsCalls: 0, grantByIdCalls: [], tokenExchanges: 0,
      grants,
    };
  }

  console.log('\n-- 1+2: the kick runs the named grant, and a finished first read speaks --');
  {
    const state = newState(6, [GRANT(), GRANT({ id: 'g2', email: 'b@gmail.com', user_id: 'u2', member_id: 'm2' })]);
    const out = await W.runOne('g2', fakeCtx(state, TOKEN_KEY));
    t('exactly the named grant ran', out.polled === 1 && out.results[0].grantId === 'g2',
      JSON.stringify(out.results));
    t('the due list was never consulted', state.dueGrantsCalls === 0, 'dueGrantsCalls=' + state.dueGrantsCalls);
    t('one mailbox, one token exchange', state.tokenExchanges === 1, String(state.tokenExchanges));
    t('the whole small backfill staged in this run', out.results[0].staged === 6,
      JSON.stringify(out.results[0]));
    t('the completed first read notifies by the NORMAL rule — no new notify path',
      state.notifies.length === 1 && state.notifies[0].grantId === 'g2'
      && !!(state.notifies[0].meta && state.notifies[0].meta.backfill),
      JSON.stringify(state.notifies));
    t('the finished backfill is marked, so the cron lane will not redo it',
      state.synced.length === 1 && !!state.synced[0].patch.backfilled_at,
      JSON.stringify(state.synced));
    t('the result mirrors runAll\'s shape', 'polled' in out && 'modelCalls' in out
      && Array.isArray(out.results) && typeof out.build === 'string');
  }

  console.log('\n-- 3: an unknown id is a quiet result, not a throw --');
  {
    const state = newState(3, [GRANT()]);
    const out = await W.runOne('nope', fakeCtx(state, TOKEN_KEY));
    t('polled nothing, said why', out.polled === 0 && out.reason === 'no_grant', JSON.stringify(out));
    t('and read nothing', state.tokenExchanges === 0 && state.inserted.length === 0);
  }

  console.log('\n-- 4: a grant the poll would refuse, the kick refuses too --');
  {
    const state = newState(3, [GRANT({ needs_reauth: true })]);
    const out = await W.runOne('g1', fakeCtx(state, TOKEN_KEY));
    t('needs_reauth is filtered at the same fence as dueGrants',
      out.polled === 0 && out.reason === 'no_grant', JSON.stringify(out));
  }

  console.log('\n-- 4b: the REAL grantById carries the filter the fake mirrors --');
  {
    /* Promise 4 above rides on the fake's filter; this pins the real one. The
       query string db.mjs builds IS the behaviour — PostgREST applies exactly
       what it says. */
    const { createDb } = await import(M('db.mjs'));
    const urls = [];
    const db = createDb('https://x.supabase.co', 'sk', async (u) => {
      urls.push(String(u));
      return { ok: true, status: 200, json: async () => [], text: async () => '[]' };
    });
    await db.grantById('abc-123');
    const q = urls[0] || '';
    t('one lookup, filtered to the id AND needs_reauth=false',
      q.includes('id=eq.abc-123') && q.includes('needs_reauth=eq.false'), q);
    t('asking for the same columns dueGrants reads',
      q.includes('backfill_days') && q.includes('stalled_runs') && q.includes('refresh_token_enc'), q);
  }

  console.log('\n-- 5: a held mailbox stays held and silent --');
  {
    const state = newState(3, [GRANT()]);
    const ctx = fakeCtx(state, TOKEN_KEY);
    ctx.db.stagingPubForUser = async () => null;   // personal grant, never unlocked
    ctx.db.stagingPubForFamily = async () => null;
    const out = await W.runOne('g1', ctx);
    t('held, not errored', out.results[0].status === 'held', JSON.stringify(out.results[0]));
    t('nothing read, nobody buzzed', state.tokenExchanges === 0 && state.notifies.length === 0,
      'exchanges=' + state.tokenExchanges + ' notifies=' + state.notifies.length);
  }

  console.log('\n-- 6: the callback is actually wired to fire this --');
  {
    /* mailbox-connect/index.ts is Deno transport, so it cannot run under this
       runner; what CAN be pinned is the invariant, not the shape (the
       direct-speed suite's pattern): the callback names the sync function,
       authenticates with the shared secret, sends a grant body, and kicks
       BEFORE the watch registration — the kick is why the first minute has
       something on screen, the watch merely speeds up minute two onward. */
    const fs = require('fs');
    const connectSrc = fs.readFileSync(
      path.join(__dirname, '..', 'supabase', 'functions', 'mailbox-connect', 'index.ts'), 'utf8');
    const kickAt = connectSrc.indexOf('/functions/v1/mailbox-sync');
    t('the callback names the sync function', kickAt >= 0);
    t('...authenticated by the shared secret, never a user token',
      connectSrc.includes('x-sync-secret') && connectSrc.includes('MAILBOX_SYNC_SECRET'));
    t('...carrying the grant id in the body', /grant:\s*grantId/.test(connectSrc));
    t('...and the kick comes before the watch registration',
      kickAt < connectSrc.indexOf('GMAIL_PUSH_TOPIC'),
      'kick@' + kickAt + ' watch@' + connectSrc.indexOf('GMAIL_PUSH_TOPIC'));
    t('...and the watch never blocks the redirect (named, invoked, not awaited)',
      /registerWatchBestEffort\(/.test(connectSrc)
      && !/await\s+registerWatchBestEffort/.test(connectSrc)
      && connectSrc.includes('waitUntil'));
  }

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
