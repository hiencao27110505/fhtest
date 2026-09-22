#!/usr/bin/env node
/* Park the mail, do not hold the mailbox (email-reading-v2 §10.4; 0146/0147).
 * `node pipeline/parking.test.js`
 *
 * Until 2026-09-22 one model-needing mail with no quota held the whole mailbox:
 * the cursor froze and the window was re-read every poll. mailbox_message_attempts
 * had 0 rows against 732,343 `held` tallies. Driven through the real runGrant
 * with a stubbed Gmail and a model that fails on one of three mails:
 *   1. the other two stage, the cursor advances, the one is recorded
 *   2. a second run with the model working reads the parked one and clears it
 *   3. a 'multi' answer is given up on at once (cap 1), never retried
 *   4. a db from before 0146 holds the mailbox exactly as before
 *   5. give-ups are released once per build, and only an older build's
 */
import { W, L, makeCtx, memoryDb, mailFor, settled, reporter, TXN_ANSWER, MULTI_ANSWER, DAY_429 } from './v2-harness.mjs';
const { t, done } = reporter();

const kinds = { 'm-table': 'table', 'm-model-ok': 'model', 'm-model-bad': 'model' };
const mail = (id) => mailFor(id, kinds[id] || 'model', id);

console.log('\n-- 1. the model fails on one of three: the other two stage, the cursor moves, the id is recorded --');
const db = memoryDb();
{
  /* m-model-bad's prompt names its subject; answer it with an outage. */
  const ctx = makeCtx({ db, queue: ['m-table', 'm-model-ok', 'm-model-bad'], mail,
    llm: (n, init) => (/m-model-bad/.test(init.body) ? { status: 503, body: 'down' } : { status: 200, body: TXN_ANSWER }) });
  const r = await W.runGrant(settled(), ctx);
  t('two rows staged', r.staged === 2, r);
  t('one parked, none held', r.parked === 1 && r.held === 0, r);
  t('the run is "ok", not "held"', r.status === 'ok', r.status);
  t('THE CURSOR ADVANCED: markSynced was written', db.calls.some((c) => c[0] === 'markSynced'), db.calls);
  const h = db.holds.get('m-model-bad');
  t('the parked message is recorded with its reason and the build', h && h.attempts === 1 && !h.gave_up && h.reason === 'model_unavailable' && h.build === W.BUILD_ID, h);
  t('tallied as parked', db.tallies.parked === 1 && !db.tallies.held, db.tallies);
  t('the two staged rows are txn rows and the banner counts them', ctx.banners.length === 1 && ctx.banners[0].count === 2, ctx.banners);
}

console.log('\n-- 2. the next run, model working: the parked one is read by the slow lane and cleared --');
{
  const ctx = makeCtx({ db, queue: ['m-table', 'm-model-ok', 'm-model-bad'], mail,
    llm: () => ({ status: 200, body: TXN_ANSWER }) });
  const r = await W.runGrant(settled(), ctx);
  t('the window itself has nothing new (the two are staged, the parked one is the lane\'s)', r.fetched === 3 && r.skipped === 3, r);
  t('the slow lane retried exactly the parked one', r.retried === 1, r);
  t('...and staged it', r.staged === 1 && db.staged.has('m-model-bad'), r);
  t('its attempts were cleared', !db.holds.has('m-model-bad') && db.calls.some((c) => c[0] === 'clearMessageHold' && c[1] === 'm-model-bad'));
  t('it was fetched by id, not re-listed: one body fetch, no header fetch', ctx.fetched.filter((f) => f.startsWith('m-model-bad')).join() === 'm-model-bad:body', ctx.fetched);
}

console.log('\n-- 3. one mail, several transactions: given up on at once, never retried --');
{
  const db3 = memoryDb();
  const ctx = makeCtx({ db: db3, queue: ['m-multi'], mail, llm: () => ({ status: 200, body: MULTI_ANSWER }) });
  const r = await W.runGrant(settled(), ctx);
  const h = db3.holds.get('m-multi');
  t('recorded as a give-up with cap 1', h && h.gave_up && h.reason === 'multi' && db3.calls.some((c) => c[0] === 'recordMessageHold' && c[3] === 1), h);
  t('summary: givenUp 1, parked 0, status ok', r.givenUp === 1 && r.parked === 0 && r.status === 'ok', r);
  t('tallied given_up and multi', db3.tallies.given_up === 1 && db3.tallies.multi === 1, db3.tallies);
  const ctx2 = makeCtx({ db: db3, queue: ['m-multi'], mail, llm: () => ({ status: 200, body: MULTI_ANSWER }) });
  const r2 = await W.runGrant(settled(), ctx2);
  t('the next run steps over it: no fetch, no model call, no new attempt', ctx2.model.calls === 0 && r2.retried === 0 && h.attempts === 1 && ctx2.fetched.length === 0, [ctx2.fetched, r2]);
}

console.log('\n-- 4. a database from before 0146 holds the mailbox exactly as before --');
{
  const ctx = makeCtx({ dbOpts: { parking: false }, queue: ['m-table', 'm-model-bad'], mail, llm: () => ({ status: 503, body: 'down' }) });
  const r = await W.runGrant(settled(), ctx);
  t('held, cursor not moved', r.status === 'held' && r.held === 1 && r.parked === 0 && !ctx.db.calls.some((c) => c[0] === 'markSynced'), r);
  t('the table-readable mail still staged (continue, not break)', r.staged === 1, r);
}

console.log('\n-- 5. a code bug is NOT parked: it holds, and is never given up on --');
{
  const ctx = makeCtx({ db: memoryDb(), queue: ['m-model-bad'], mail, llm: () => ({ status: 200, body: TXN_ANSWER }) });
  ctx.db.saveFingerprint = async () => { throw new TypeError('bug'); };
  const r = await W.runGrant(settled(), ctx);
  t('a non-model throw still holds the mailbox', r.status === 'held' && r.held === 1 && r.parked === 0 && ctx.db.holds.size === 0, r);
}

console.log('\n-- 6. give-ups come back with a new build, once per build --');
{
  const db6 = memoryDb();
  db6.holds.set('old', { attempts: 1, gave_up: true, reason: 'format_cap', build: 'build-A', at: 1 });
  db6.holds.set('mine', { attempts: 1, gave_up: true, reason: 'format_cap', build: 'build-B', at: 2 });
  const run = () => W.runGrant(settled(), makeCtx({ db: db6, queue: [], mail, ctx: { build: 'build-B' } }));
  await run(); await run();
  const releases = db6.calls.filter((c) => c[0] === 'releaseReaderGiveups');
  t('release_reader_giveups is called with the build, ONCE for this process', releases.length === 1 && releases[0][1] === 'build-B', releases);
  t('the older build\'s give-up is released, this build\'s is kept', !db6.holds.get('old').gave_up && db6.holds.get('mine').gave_up, [...db6.holds]);
}

console.log('\n-- 7. the parked list is a slow lane: at most PARKED_PER_RUN per run, oldest first, inside the model budget --');
{
  const db7 = memoryDb();
  for (let i = 0; i < 25; i++) db7.holds.set('p' + i, { attempts: 1, gave_up: false, reason: 'model_budget', build: 'x', at: i });
  const ctx = makeCtx({ db: db7, queue: [], mail, llm: () => ({ status: 200, body: TXN_ANSWER }), maxModelCalls: 5 });
  const r = await W.runGrant(settled(), ctx);
  t('stops at the run\'s model budget', r.retried === 5 && ctx.model.calls === 5 && r.staged === 5, r);
  t('oldest holds first', ['p0', 'p1', 'p2', 'p3', 'p4'].every((id) => db7.staged.has(id)), [...db7.staged.keys()]);
  t('PARKED_PER_RUN caps the lane', W.PARKED_PER_RUN === 20);
}

done();
