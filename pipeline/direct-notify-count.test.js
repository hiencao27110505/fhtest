#!/usr/bin/env node
/* What a direct-read banner SAYS, driven through the real runGrant().
 * `node pipeline/direct-notify-count.test.js`
 *
 * Most of the notification rules in this pipeline are asserted by reading
 * worker.mjs as text, which pins shape rather than behaviour. This file runs the
 * worker: a stubbed Gmail and token endpoint, a real mail body, a real seal, and
 * a `notify` that records what the person would have been shown.
 *
 * THE BUG IT PINS. `pendingCount` — the exact number of rows waiting for review
 * — was asked only when a backfill FINISHED. An ordinary poll therefore
 * announced `summary.staged`, the rows of the run that happened to wake up. Four
 * mails arriving through a day meant four separate banners each saying "1",
 * while four sat unreviewed. The count a person would act on was already
 * computed, on a path they mostly never take.
 *
 * Also pinned, because they are what make the fix safe rather than merely
 * correct: a backfill in progress stays silent, a quiet mailbox sends nothing,
 * and a pendingCount that fails or returns nothing still lets the banner out
 * with this run's share instead of swallowing it.
 */
const nacl = await import('tweetnacl').then(m => m.default || m);
const crypto = await import('node:crypto').then(m => m.default || m);

const url2 = await import('node:url');
const ROOT = url2.fileURLToPath(new URL('../supabase/functions/_shared/mailbox/', import.meta.url));
const W  = await import(ROOT + 'worker.mjs');
const TC = await import(ROOT + 'token-crypto.mjs');

let pass = 0, fail = 0;
const t = (n, ok, d) => { console.log((ok ? '  PASS  ' : '  FAIL  ') + n + (!ok && d ? '  -> ' + d : '')); ok ? pass++ : fail++; };

const FAM_PUB = Buffer.from(nacl.box.keyPair.fromSecretKey(
  new Uint8Array(crypto.randomBytes(32))).publicKey).toString('base64');
const TOKEN_KEY = crypto.randomBytes(32).toString('base64');
const ENC_REFRESH = await TC.encryptToken('refresh-<REDACTED>', TOKEN_KEY, { subtle: crypto.webcrypto.subtle });

const b64u = (s) => Buffer.from(s, 'utf8').toString('base64url');

/* One bank mail. `n` distinct ids so each run sees genuinely NEW mail. */
function mailFor(id) {
  const body = ['MB TK cham', 'x5249', 'Ngay, gio giao dich', '28-08-2026 09:14:02',
    'Diem giao dich', 'GS25 NGUYEN VAN LINH', 'So tien', '-37,000 VND'].join('\n');
  return {
    id, threadId: 'th' + id, internalDate: String(Date.now()),
    payload: {
      headers: [
        { name: 'From', value: 'MB <mbebanking@mbbank.com.vn>' },
        { name: 'Subject', value: 'Thong bao thong tin giao dich TK cham' },
        { name: 'Date', value: new Date().toUTCString() },
        { name: 'Authentication-Results', value: 'mx.google.com; dkim=pass header.d=mbbank.com.vn' },
      ],
      mimeType: 'text/plain',
      body: { data: b64u(body) },
    },
  };
}

/* Serves the token endpoint and the two Gmail calls. `queue` is what this run
   will find; the harness hands it one NEW message per run. */
function makeCtx(queue, banners) {
  return {
    db: {
      async memberById() { return { id: 'm1', family_id: 'f1', archived_at: null }; },
      async stagingPubForFamily() { return FAM_PUB; },
      async stagingPubForUser() { return FAM_PUB; },
      async providerDomains() { return ['mbbank.com.vn']; },
      async alreadyStaged() { return new Set(); },
      async stagedState() { return { staged: new Set(), resolved: new Map() }; },
      async stagedCandidates() { return []; },
      async insertStaged() { return true; },
      async recordFailure() {}, async markSynced() {},
      async fingerprint() { return null; },
      async fingerprintsForSenders() { return new Map(); },
      async saveFingerprint() {}, async bumpReadTally() {},
      async recordStall() {}, async clearStall() {},
      async pendingCount() { return 7; },
    },
    nacl, rng: crypto.webcrypto, subtle: crypto.webcrypto.subtle,
    dedupKey: crypto.randomBytes(32).toString('base64'),
    tokenKey: TOKEN_KEY, fromBytea: (v) => v,
    google: { clientId: 'cid', clientSecret: '<REDACTED>' },
    llm: { apiKey: null },
    notify: async (grant, count, opts) => { banners.push({ count, backfill: !!opts.backfill }); },
    fetch: async (url) => {
      const u = String(url);
      if (u.startsWith('https://oauth2.googleapis.com/token')) {
        return { ok: true, status: 200, json: async () => ({ access_token: 'at', expires_in: 3600 }),
                 text: async () => '{"access_token":"at","expires_in":3600}' };
      }
      if (u.includes('/messages?') || u.endsWith('/messages')) {
        return { ok: true, status: 200,
                 json: async () => ({ messages: queue.map(id => ({ id })) }),
                 text: async () => JSON.stringify({ messages: queue.map(id => ({ id })) }) };
      }
      const m = u.match(/\/messages\/([^?]+)/);
      if (m) {
        const msg = mailFor(m[1]);
        return { ok: true, status: 200, json: async () => msg, text: async () => JSON.stringify(msg) };
      }
      throw new Error('unstubbed fetch: ' + u);
    },
  };
}

/* A grant whose backfill has FINISHED — i.e. ordinary polling, the steady state
   every connected mailbox reaches. */
const settled = () => ({
  id: 'g1', user_id: 'u1', member_id: 'm1', family_id: 'f1', email: 'bf@gmail.com',
  needs_reauth: false, refresh_token_enc: ENC_REFRESH, last_synced_at: new Date().toISOString(),
  backfilled_at: '2026-08-28T00:00:00Z', backfilled_days: 90, backfill_days: 90,
  default_scope: 'family', stalled_runs: 0,
});

console.log('\n-- 1. steady state: one new mail per minute, 10 minutes --');
{
  const banners = [];
  for (let minute = 0; minute < 10; minute++) {
    const ctx = makeCtx(['msg-' + minute], banners);
    await W.runGrant(settled(), ctx);
  }
  console.log('   banners:', banners.length, JSON.stringify(banners.slice(0, 2)));
  /* One banner per run is by design for an ordinary poll — new mail arrived, say
     so. What was wrong was what each one SAID. */
  t('each poll that stages something still speaks', banners.length === 10);
  t('and every banner names the QUEUE DEPTH, not this run\'s one row',
    banners.every(b => b.count === 7 && !b.backfill), JSON.stringify(banners[0]));
  t('none of them says "1" while seven sit unreviewed',
    !banners.some(b => b.count === 1), JSON.stringify(banners.map(b => b.count)));
}

console.log('\n-- 2a. a backfill that PERSISTS its completion --');
{
  const banners = [];
  const g = { ...settled(), backfilled_at: null };
  for (let minute = 0; minute < 10; minute++) {
    const ctx = makeCtx(['bf-' + minute], banners);
    /* faithful: markSynced writes backfilled_at back onto the grant, which is
       what stops `backfilling` being true forever */
    ctx.db.markSynced = async (id, fields) => { Object.assign(g, fields); };
    await W.runGrant({ ...g }, ctx);
  }
  console.log('   banners:', banners.length, JSON.stringify(banners.slice(0, 2)));
  /* The harness keeps feeding new mail after the backfill lands, so runs 2..10
     are ordinary polls and speak. The property here is the TRANSITION: silence
     through the catch-up, then exactly one banner marked as the completion. */
  t('exactly one banner is the backfill completion notice',
    banners.filter(b => b.backfill).length === 1, JSON.stringify(banners.map(b => b.backfill)));
  t('it is the FIRST thing said — the catch-up itself was silent',
    banners[0] && banners[0].backfill === true, JSON.stringify(banners[0]));
  t('and it carries the real queue depth', banners[0] && banners[0].count === 7);
}

console.log('\n-- 2b. the same backfill when completion NEVER persists --');
{
  const banners = [];
  const g = { ...settled(), backfilled_at: null };
  for (let minute = 0; minute < 10; minute++) {
    await W.runGrant({ ...g }, makeCtx(['bf-' + minute], banners));   // markSynced is a no-op
  }
  console.log('   banners:', banners.length, JSON.stringify(banners.slice(0, 2)));
  t('a banner EVERY RUN, each claiming the backfill just finished  <-- storm mode',
    banners.length === 10);
  t('...and each one shouts the full queue depth', banners.every(b => b.count === 7 && b.backfill));
}

console.log('\n-- 2c. a pendingCount that fails must not swallow the banner --');
{
  const banners = [];
  const ctx = makeCtx(['x-1'], banners);
  ctx.db.pendingCount = async () => { throw new Error('count unavailable'); };
  await W.runGrant(settled(), ctx);
  t('the banner still goes out, with what this run knows',
    banners.length === 1 && banners[0].count === 1, JSON.stringify(banners));
}
{
  const banners = [];
  const ctx = makeCtx(['y-1'], banners);
  ctx.db.pendingCount = async () => 0;          // no rows visible to the count
  await W.runGrant(settled(), ctx);
  t('a zero count falls back too, rather than sending nothing',
    banners.length === 1 && banners[0].count === 1, JSON.stringify(banners));
}

console.log('\n-- 3. a genuinely quiet mailbox --');
{
  const banners = [];
  for (let minute = 0; minute < 10; minute++) {
    await W.runGrant(settled(), makeCtx([], banners));
  }
  t('nothing new, nothing sent', banners.length === 0);
}

console.log('\n' + pass + ' pass, ' + fail + ' fail\n');
if (fail) process.exit(1);
