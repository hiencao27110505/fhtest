#!/usr/bin/env node
/* Notifications batch ACROSS runs, not just within one.
 * `node pipeline/notify-debounce.test.js`
 *
 * THE BUG, as it was reported: "my bf got notified once every minute."
 *
 * The trigger fires every minute and each firing is a FRESH Apps Script
 * execution, so `_PENDING_NOTIFY` only ever batched the rows of ONE run. That
 * was enough for a forwarding burst landing in a single pass, and wrong for a
 * queue draining one message per minute: thirty minutes of catching up sent
 * thirty banners, each saying "1", none saying how many were waiting.
 *
 * The direct-read worker was given this fix on 2026-08-30 (silent while a
 * backfill runs, one notice at the end). This file pins the equivalent rule for
 * the transport that never got it — expressed without any notion of "backfill",
 * which the Apps Script does not have and should not grow:
 *
 *   nothing sent recently  -> send NOW, with everything held
 *   inside the cooldown    -> add to the held total, say nothing
 *   cooldown expires       -> the held total goes out on the next run
 *
 * LEADING edge, and that half is load-bearing. A trailing-edge version was
 * written first — hold everything, send when a run goes quiet — and it delayed
 * EVERY notification by a trigger cycle, including one mail arriving on a quiet
 * afternoon. review-notify.test.js caught it, because it already pinned "a burst
 * of 5 sends ONE notification" on the same run. Quietening a storm must not slow
 * the common case down.
 *
 * The properties pinned below are one per way this can regress: a storm coming
 * back, a drain going silent, the single-burst case breaking, state leaking for
 * an idle mailbox, members bleeding into each other, and a failed send
 * re-firing forever — which would be a notification storm caused by the code
 * written to prevent one.
 */
const fs = require('fs');
let pass = 0, fail = 0;
const t = (n, ok, d) => { console.log((ok ? '  PASS  ' : '  FAIL  ') + n + (!ok && d ? '  -> ' + d : '')); ok ? pass++ : fail++; };

const gs = fs.readFileSync(require('path').join(__dirname, 'bank-email-pipeline.gs'), 'utf8');

let STORE = {};
global.PropertiesService = { getScriptProperties: () => ({
  getProperty: (k) => (k in STORE ? STORE[k] : null),
  setProperty: (k, v) => { STORE[k] = String(v); },
  deleteProperty: (k) => { delete STORE[k]; },
  getProperties: () => Object.assign({}, STORE),
}) };
global.Logger = { log: () => {} };
let BANNERS = [];
global.UrlFetchApp = { fetch: (url, o) => { BANNERS.push(JSON.parse(o.payload));
  return { getResponseCode: () => 200, getContentText: () => '{}' }; } };

eval(gs.slice(gs.indexOf('function queueReviewNotice'), gs.indexOf('// Resolves which family member')));

const M = 'member-1';
let NOW = 1_700_000_000_000;
const realNow = Date.now;
Date.now = () => NOW;

function reset() { STORE = { SUPABASE_URL: 'https://x', SUPABASE_SERVICE_ROLE_KEY: '<REDACTED>' }; BANNERS = []; }
/* one trigger run: fresh execution, so module state resets */
function run(n) {
  for (const k of Object.keys(_PENDING_NOTIFY)) delete _PENDING_NOTIFY[k];
  for (let i = 0; i < n; i++) queueReviewNotice({ member_id: M });
  notifyStagedReviews();
  NOW += 60_000;
}

console.log('\n-- the reported storm: one row per run, for 30 minutes --');
reset();
for (let i = 0; i < 30; i++) run(1);
console.log('   banners during the drain:', BANNERS.length);
t('QUIET while the queue drains — not one a minute', BANNERS.length <= 3, JSON.stringify(BANNERS));
run(0);
/* 31 minutes of continuous arrival: one banner immediately (the leading edge —
   the person is told the moment something lands), then one per cooldown window.
   Three instead of thirty, and every row is still accounted for, which is the
   property that actually matters. The first banner saying "1" is not the bug
   that was reported; THIRTY of them was. */
t('at most three banners for a 31-minute drain (was 30)', BANNERS.length <= 3, String(BANNERS.length));
t('the first goes out immediately, so nothing is delayed by the fix',
  BANNERS[0] && BANNERS[0].count === 1, JSON.stringify(BANNERS[0]));
t('and between them they account for every row', BANNERS.reduce((a, b) => a + b.count, 0) === 30,
  JSON.stringify(BANNERS));
t('every banner after the first carries a BATCH, never another "1"',
  BANNERS.slice(1).every(b => b.count > 1), JSON.stringify(BANNERS));

console.log('\n-- a long drain is not silent forever --');
reset();
for (let i = 0; i < 40; i++) run(1);      // 40 minutes, past the 15-minute hold
t('speaks more than once over 40 minutes of continuous arrival', BANNERS.length >= 2);
t('...but nothing like one a minute', BANNERS.length <= 4, String(BANNERS.length));

console.log('\n-- the case that already worked must keep working --');
reset();
run(5); run(0);
t('five rows in one burst -> ONE banner saying 5',
  BANNERS.length === 1 && BANNERS[0].count === 5, JSON.stringify(BANNERS));

console.log('\n-- a quiet mailbox stays quiet, and stores nothing --');
reset();
for (let i = 0; i < 10; i++) run(0);
t('no banners', BANNERS.length === 0);
t('no leftover state for an idle member',
  !Object.keys(STORE).some(k => k.indexOf('notifyHold:') === 0), JSON.stringify(STORE));

console.log('\n-- two members do not interfere --');
reset();
for (const k of Object.keys(_PENDING_NOTIFY)) delete _PENDING_NOTIFY[k];
queueReviewNotice({ member_id: 'a' }); queueReviewNotice({ member_id: 'b' });
notifyStagedReviews(); NOW += 60_000;
run(0);
t('both are told, each with its own count',
  BANNERS.length === 2 && BANNERS.every(b => b.count === 1),
  JSON.stringify(BANNERS));

console.log('\n-- a failed send does not re-fire forever --');
reset();
global.UrlFetchApp = { fetch: () => { throw new Error('push-send down'); } };
run(3); run(0); run(0); run(0);
t('the hold is cleared even when the send throws',
  !Object.keys(STORE).some(k => k.indexOf('notifyHold:') === 0), JSON.stringify(STORE));

Date.now = realNow;
console.log('\n' + pass + ' pass, ' + fail + ' fail\n');
if (fail) process.exit(1);
