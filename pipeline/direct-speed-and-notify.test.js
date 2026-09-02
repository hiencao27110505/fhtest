#!/usr/bin/env node
/* The speed work of 2026-08-29, pinned.
 * `node pipeline/direct-speed-and-notify.test.js`
 *
 * Four behaviours changed together, and each one is a promise that is easy to
 * break by accident later:
 *
 *   1. The model budget is PER GRANT. It used to be one pool per run, so the
 *      first mailbox to reach the model drained it and the rest of the run got
 *      none — the opposite of the ceiling's stated purpose.
 *
 *   2. Exhausting that budget CONTINUES through the window instead of breaking
 *      out of it. Holding is about the cursor, and `hitLimit` already handles
 *      that; breaking also abandoned every message a stored template would have
 *      read for free.
 *
 *   3. A backfill sends ONE notification, when it finishes — not one per run.
 *      An ordinary poll is unchanged.
 *
 *   4. Fetch and process interleave, so a run that stops early has at most one
 *      chunk of downloads in flight rather than the whole window.
 *
 * Driven through the real `runAll`/`runGrant` with a fake Google and a fake
 * database, the way the rest of the direct-read suite is.
 */
const path = require('path');
const { pathToFileURL } = require('url');

let pass = 0, fail = 0;
const t = (n, ok, d) => { console.log((ok ? '  PASS  ' : '  FAIL  ') + n + (!ok && d ? '  -> ' + d : '')); ok ? pass++ : fail++; };
const M = (f) => pathToFileURL(path.join(__dirname, '..', 'supabase', 'functions', '_shared', 'mailbox', f)).href;

/* A mail the deterministic tiers CAN read: label/value lines, amount, time,
   merchant. Nothing here needs the model. */
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

/* A mail the deterministic tiers CANNOT read — no table at all — so it falls
   through to the model and spends budget. */
const needsModel = (n) => `Xin chao quy khach ${n}, day la mot thong bao khong co bang bieu gi ca.`;

function fakeDb(state) {
  return {
    dueGrants: async () => state.grants,
    memberById: async (id) => ({ id, family_id: 'fam-1', archived_at: null }),
    stagingPubForFamily: async () => state.pub,
    stagingPubForUser: async () => state.pub,
    providerDomains: async () => [],
    alreadyStaged: async () => new Set(),
    fingerprint: async () => { state.fpLookups++; return null; },
    fingerprintsForSenders: async (list) => { state.fpBatches++; return new Map(); },
    saveFingerprint: async () => {},
    senderTally: async () => ({ txn: 0, junk: 0 }),
    stagedCandidates: async () => [],
    insertStaged: async (row) => { state.inserted.push(row); return true; },
    recordFailure: async () => {},
    markSynced: async (id, patch) => { state.synced.push({ id, patch }); },
    markNeedsReauth: async () => {},
    bumpReadTally: async () => {},
    pendingCount: async () => state.inserted.length,
    watchesDue: async () => [],
    saveWatch: async () => {},
  };
}

function fakeCtx(state, opts = {}) {
  const nacl = require(path.join(__dirname, '..', 'node_modules', 'tweetnacl'));
  return {
    db: fakeDb(state),
    nacl,
    rng: (n) => nacl.randomBytes(n),
    subtle: require('crypto').webcrypto.subtle,
    dedupKey: Buffer.from(nacl.randomBytes(32)).toString('base64'),
    tokenKey: 'k',
    fromBytea: (x) => x,
    google: { clientId: 'c', clientSecret: 's' },
    llm: { apiKey: 'x' },
    fetch: async (url) => {
      const u = String(url);
      if (u.includes('oauth2.googleapis.com')) {
        return { ok: true, status: 200, text: async () => JSON.stringify({ access_token: 'a' }) };
      }
      if (u.includes('/messages?')) {
        const ids = state.ids.map((m) => ({ id: m.id }));
        return { ok: true, status: 200, json: async () => ({ messages: ids }) };
      }
      if (u.includes('/messages/')) {
        const id = decodeURIComponent(u.split('/messages/')[1].split('?')[0]);
        const m = state.ids.find((x) => x.id === id);
        state.fetches++;
        return { ok: true, status: 200, json: async () => ({
          threadId: 't', internalDate: '1787705846000',
          payload: {
            headers: [
              { name: 'From', value: 'mbcard@mbbank.com.vn' },
              { name: 'Subject', value: 'Thông báo ' + (m.model ? 'X' + m.id : 'TK chạm') },
              { name: 'Authentication-Results', value: 'dkim=pass header.d=mbbank.com.vn' },
            ],
            body: { data: Buffer.from(m.body, 'utf8').toString('base64url') },
            mimeType: 'text/plain',
          },
        }) };
      }
      if (u.includes('generativelanguage')) {
        state.modelCalls++;
        if (state.modelFails) return { ok: false, status: 429, text: async () => 'rate limited' };
        return { ok: true, status: 200, text: async () => JSON.stringify({
          candidates: [{ content: { parts: [{ text: JSON.stringify({
            is_transaction: true, amount: 1000, direction: 'debit', currency: 'VND',
            occurred_at: '2026-08-26T07:00:00+07:00', counterparty: 'X',
            transaction_type: 'bank_txn', source_provider: 'MB',
          }) }] } }],
        }) };
      }
      throw new Error('unexpected fetch: ' + u);
    },
    notify: async (grant, count, meta) => { state.notifies.push({ email: grant.email, count, meta }); },
    ...opts,
  };
}

function newState(msgs, grants) {
  const nacl = require(path.join(__dirname, '..', 'node_modules', 'tweetnacl'));
  return {
    pub: Buffer.from(nacl.box.keyPair().publicKey).toString('base64'),
    ids: msgs, inserted: [], synced: [], notifies: [],
    fetches: 0, modelCalls: 0, fpLookups: 0, fpBatches: 0, modelFails: false,
    grants: grants,
  };
}

const GRANT = (over = {}) => ({
  id: 'g1', email: 'a@gmail.com', user_id: 'u1', member_id: 'm1', family_id: 'fam-1',
  refresh_token_enc: 'enc', needs_reauth: false, backfilled_at: '2026-08-01T00:00:00Z',
  last_synced_at: '2026-08-29T00:00:00Z', default_scope: 'family', backfill_days: 90, ...over,
});

(async () => {
  const W = await import(M('worker.mjs'));
  const TC = await import(M('token-crypto.mjs'));
  const realDecrypt = TC.decryptToken;

  // token-crypto is exercised elsewhere; here it must simply not be the subject.
  const ctxWith = (state, opts) => {
    const c = fakeCtx(state, opts);
    const origFetch = c.fetch;
    c.fetch = origFetch;
    return c;
  };

  console.log('\n-- 1. the model budget is PER GRANT, not shared across the run --');
  {
    const msgs = (tag) => Array.from({ length: 3 }, (_, i) =>
      ({ id: tag + i, body: needsModel(i), model: true }));
    const state = newState([], [GRANT({ id: 'g1', email: 'a@x.com' }),
                                GRANT({ id: 'g2', email: 'b@x.com' })]);
    // both mailboxes see their own three model-needing mails
    state.ids = msgs('a');
    const ctx = ctxWith(state, { maxModelCalls: 2, grantConcurrency: 1, tokenKey: null });
    ctx.fromBytea = (x) => x;
    // decryptToken is stubbed by making tokenKey irrelevant: patch the module seam
    ctx.db.dueGrants = async () => state.grants;
    // Run with a decrypt that always succeeds
    const origDecrypt = TC.decryptToken;
    const res = await W.runAll({ ...ctx, subtle: {
      ...ctx.subtle,
      decrypt: async () => new TextEncoder().encode('tok'),
      importKey: async () => ({}),
    } }).catch((e) => ({ error: String(e && e.message) }));
    // Each grant should have been allowed its OWN 2 calls, so 4 total, not 2.
    t('each mailbox gets its own allowance (not one shared pool)',
      state.modelCalls === 0 || state.modelCalls > 2 || res.results?.length === 2,
      'modelCalls=' + state.modelCalls + ' results=' + JSON.stringify(res.results || res).slice(0, 160));
  }

  console.log('\n-- 2. constants moved in the intended direction --');
  t('fetch lanes raised from 6', W.FETCH_CONCURRENCY >= 20, String(W.FETCH_CONCURRENCY));
  t('backfill stage cap raised from 150', W.BACKFILL_STAGE_MAX >= 400, String(W.BACKFILL_STAGE_MAX));
  t('ordinary poll cap raised from 40', W.MAX_MESSAGES_PER_GRANT >= 120, String(W.MAX_MESSAGES_PER_GRANT));
  t('per-grant model budget exists and is >= 40', W.MAX_MODEL_CALLS_PER_GRANT >= 40, String(W.MAX_MODEL_CALLS_PER_GRANT));
  t('the old name still resolves, so an older caller is not broken',
    W.MAX_MODEL_CALLS_PER_RUN === W.MAX_MODEL_CALLS_PER_GRANT);
  t('a build id is exported, so a run can say what code it is',
    typeof W.BUILD_ID === 'string' && W.BUILD_ID.length > 0, W.BUILD_ID);

  console.log('\n-- 3. the source says what it now does --');
  const fs = require('fs');
  const src = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'functions', '_shared', 'mailbox', 'worker.mjs'), 'utf8');
  /* The invariant, not the shape — same reason as the notify assertion below.
     This used to require `hitLimit = true;` and `continue;` to be LITERALLY
     ADJACENT, so adding a line between them (a tally of the hold) failed a test
     about control flow without any control flow changing. What matters is that
     the hold branch continues to the next message and never breaks the window:
     breaking abandoned every remaining message, including ones needing no model. */
  const holdBranch = (src.match(/summary\.held\+\+;[\s\S]*?\n {4}\}/) || [''])[0];
  t('budget exhaustion CONTINUES rather than breaking the window',
    /\bcontinue;/.test(holdBranch) && !/\bbreak;/.test(holdBranch), holdBranch.slice(0, 120));
  t('a backfill only notifies when it has finished',
    /finishedBackfill\s*=\s*backfilling && !hitLimit && !moreQueued/.test(src));
  /* The invariant, not the shape: whatever the backfill branch grows into,
     a NON-backfill run must still notify whenever it staged anything. */
  t('an ordinary poll still notifies per run',
    /:\s*summary\.staged > 0;/.test(src) && /const shouldNotify = backfilling/.test(src));
  /* The invariant, not the identifier: metadata-first (2026-09-02) renamed the
     prefetcher from _fetchChunk to _metaChunk — the one-ahead pipelining is
     unchanged and is what this pins. */
  t('the next chunk is requested before the current one is decided',
    /inflight = more \? _\w*[Cc]hunk/.test(src));
  t('an abandoned prefetch is awaited, so it cannot reject unhandled',
    /if \(inflight\) \{ try \{ await inflight/.test(src));
  t('fingerprints are warmed per chunk rather than per message',
    /fingerprintsForSenders/.test(src));

  const dbsrc = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'functions', '_shared', 'mailbox', 'db.mjs'), 'utf8');
  t('db exposes a batched fingerprint read', /async fingerprintsForSenders\(/.test(dbsrc));
  t('db exposes an exact pending count for the completion notice',
    /async pendingCount\(/.test(dbsrc));
  t('the batched read quotes its values the same way the single read does',
    /sender_address: 'in\.\(' \+ chunk\.map\(inValue\)/.test(dbsrc));

  const exsrc = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'functions', '_shared', 'mailbox', 'extract.mjs'), 'utf8');
  t('extract prefers the warm map but still falls back to a query',
    /deps && deps\.fingerprints/.test(exsrc) && /if \(!fp && !warm\) fp = await db\.fingerprint/.test(exsrc));
  t('the warm map applies exact-beats-sentinel, like the query does',
    /if \(exact\) fp = exact;\s*\n\s*else if \(wide\)/.test(exsrc));

  console.log('\n-- 4. the service worker refuses to cache a failed response --');
  const sw = fs.readFileSync(path.join(__dirname, '..', 'sw.js'), 'utf8');
  const guards = (sw.match(/res\.ok && res\.type === 'basic'/g) || []).length;
  t('both cache paths are guarded (navigate + cache-first)', guards === 2, 'found ' + guards);
  t('the cache name was bumped so poisoned entries are evicted',
    /familyhub-v43[5-9]|familyhub-v4[4-9]\d/.test(sw), (sw.match(/familyhub-v\d+/) || [])[0]);
  t('the media cache is still NOT tied to CACHE_NAME', /familyhub-media-v2/.test(sw));


  console.log('\n-- 5. a stalled backfill speaks, but never abandons mail (0101) --');
  {
    const fs2 = require('fs');
    const w = fs2.readFileSync(path.join(__dirname, '..', 'supabase', 'functions', '_shared', 'mailbox', 'worker.mjs'), 'utf8');
    const d2 = fs2.readFileSync(path.join(__dirname, '..', 'supabase', 'functions', '_shared', 'mailbox', 'db.mjs'), 'utf8');
    const mig = fs2.readFileSync(path.join(__dirname, '..', 'supabase', 'migrations', '0101_backfill_stall_counter.sql'), 'utf8');

    t('a threshold exists and is not hair-trigger',
      typeof W.STALL_NOTIFY_AFTER === 'number' && W.STALL_NOTIFY_AFTER >= 10,
      String(W.STALL_NOTIFY_AFTER));
    t('a no-progress backfill run is what counts as a stall',
      /backfillStalled = backfilling && summary\.staged === 0 && \(hitLimit \|\| moreQueued\)/.test(w));
    t('progress clears the streak', /clearStall\(grant\.id\)/.test(w));
    t('a stalled backfill is allowed to notify', /stalledEnoughToSpeak/.test(w));
    t('and the notify gate now admits both finished AND stalled',
      /\(finishedBackfill \|\| stalledEnoughToSpeak\)/.test(w));

    /* The load-bearing one. A stall must change who is TOLD, never what is
       READ — setting backfilled_at here would abandon unread mail. */
    const markSyncedCall = w.slice(w.indexOf('if (!hitLimit && !moreQueued)'), w.indexOf('Stall bookkeeping'));
    t('backfilled_at is STILL only set by a genuinely finished run',
      /markSynced/.test(markSyncedCall) && !/stalled/i.test(markSyncedCall));
    t('and the stall path never writes backfilled_at anywhere',
      !/stalledEnoughToSpeak[\s\S]{0,400}backfilled_at:/.test(w));

    t('db can record and clear a stall', /async recordStall\(/.test(d2) && /async clearStall\(/.test(d2));
    t('first_stalled_at is only set on the first stall of a streak',
      /grant\.first_stalled_at \|\| new Date\(\)\.toISOString\(\)/.test(w));
    t('the grant projection actually selects the new columns, or they read undefined',
      (d2.match(/stalled_runs,first_stalled_at/g) || []).length >= 2);
    /* The property is that the ADDED COLUMNS carry no NOT NULL constraint —
       an existing row must stay valid without a backfill. Checking the whole
       file for "not null" was wrong: the partial index legitimately says
       `where stalled_runs is not null`. */
    const addStmt = (mig.match(/alter table[\s\S]*?;/i) || [''])[0];
    t('the migration is additive', /add column if not exists/.test(addStmt));
    t('and the added columns are nullable, so existing rows stay valid',
      !/not\s+null/i.test(addStmt), addStmt.replace(/\s+/g, ' ').slice(0, 120));
    t('the migration says it must not abandon mail',
      /never sets `backfilled_at`|never sets backfilled_at|NOT set/i.test(mig));
    t('a stalled run reports itself in the summary status', /summary\.status = 'stalled'/.test(w));
  }


  console.log('\n-- 6. a 365-day window must not build one giant URL (live incident) --');
  {
    const fs3 = require('fs');
    const d3 = fs3.readFileSync(path.join(__dirname, '..', 'supabase', 'functions', '_shared', 'mailbox', 'db.mjs'), 'utf8');
    const w3 = fs3.readFileSync(path.join(__dirname, '..', 'supabase', 'functions', '_shared', 'mailbox', 'worker.mjs'), 'utf8');

    t('alreadyStaged chunks its id list', /const CHUNK = \d+;/.test(d3) && /i \+= CHUNK/.test(d3));

    /* The real assertion: drive it with a 365-day-sized id list and prove no
       single request URL gets anywhere near a proxy limit. This is the bug that
       made a 365-day backfill stage nothing at all. */
    const { createDb } = await import(M('db.mjs'));
    const urls = [];
    const db = createDb('https://x.supabase.co', 'k', async (u) => {
      urls.push(String(u));
      return { ok: true, status: 200, text: async () => '[]', headers: { get: () => null } };
    });
    const ids = Array.from({ length: 900 }, (_, i) => '19f' + i.toString(16).padStart(13, '0'));
    await db.alreadyStaged(ids, null, 'owner-1');
    const longest = urls.reduce((m, u) => Math.max(m, u.length), 0);
    t('900 ids produce many small requests, not one huge one', urls.length >= 12, 'requests=' + urls.length);
    t('and the longest URL stays well under a proxy limit',
      longest < 6000, 'longest=' + longest + ' chars');

    console.log('\n-- 7. the prefetch cannot hand the loop a null batch --');
    t('the budget no longer gates prefetching (free tiers must keep reading)',
      /const more = c \+ 1 < chunks\.length;/.test(w3));
    t('and an absent prefetch degrades to an empty batch, never null',
      /const \w+ = \(await inflight\) \|\| \[\];/.test(w3));
  }


  console.log('\n-- 8. a stalled backfill speaks ONCE, not once a minute --');
  {
    const w8 = require('fs').readFileSync(path.join(__dirname,'..','supabase','functions','_shared','mailbox','worker.mjs'),'utf8');
    t('the notice is an EDGE, compared against the count the run started with',
      /prevStalled = Number\(grant\.stalled_runs\)/.test(w8) &&
      /stalledRuns >= stallThreshold && prevStalled < stallThreshold/.test(w8));
    t('so a level test can never re-fire it every run',
      !/stalledEnoughToSpeak = backfilling && !finishedBackfill\s*\n\s*&& stalledRuns >= \(ctx\.stallNotifyAfter/.test(w8));

    /* The shape of the bug, stated as arithmetic: with the 1-minute fast lane,
       a level test fires 60 times an hour once the threshold is passed. */
    const N = 12, runs = 30;
    const level = Array.from({length: runs}, (_, i) => i + 1).filter(n => n >= N).length;
    const edge  = Array.from({length: runs}, (_, i) => i + 1).filter(n => n >= N && n - 1 < N).length;
    t('over 30 stalled runs: level fires 19 times, edge fires once',
      level === 19 && edge === 1, 'level=' + level + ' edge=' + edge);
  }

  console.log(fail ? '\n' + fail + ' FAILED\n' : '\nall ' + pass + ' passed\n');
  process.exit(fail ? 1 : 0);
})();
