#!/usr/bin/env node
/* Review notifications: batching, targeting, and copy.
 * `node pipeline/review-notify.test.js`
 *
 * These two halves cannot be exercised together anywhere but production — the
 * Apps Script side runs in GAS and the copy side runs in Deno — so each is
 * pulled out and run here against stubs. The parts that matter are the ones a
 * deploy would not catch until a real family got a wrong or leaky banner.
 */
// NOT 'use strict': the eval'd .gs/.ts declarations must land in this scope.
const fs = require('fs');
const path = require('path');
const esbuild = require('esbuild');

let pass = 0, fail = 0;
const t = (n, ok, d) => { console.log((ok ? '  PASS  ' : '  FAIL  ') + n + (!ok && d ? '  -> ' + d : '')); ok ? pass++ : fail++; };

// ── pipeline side: batching + targeting ─────────────────────────────────────
const gs = fs.readFileSync(path.join(__dirname, 'bank-email-pipeline.gs'), 'utf8');

let _props = { SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'srv-key' };
/* Writable now, because notifyStagedReviews HOLDS a running total in Script
   Properties between runs — that is how it batches a drain instead of sending a
   banner a minute (pipeline/notify-debounce.test.js). A read-only stub made
   this suite fail on the scaffolding rather than the targeting rules it exists
   to pin. Nothing here asserts on the held state; it just has to be storable. */
global.PropertiesService = { getScriptProperties: () => ({
  getProperty: (k) => (k in _props ? _props[k] : null),
  setProperty: (k, v) => { _props[k] = String(v); },
  deleteProperty: (k) => { delete _props[k]; },
  getProperties: () => Object.assign({}, _props),
}) };
global.Logger = { log: () => {} };

let CALLS = [];
let THROW_ON = null;
global.UrlFetchApp = {
  fetch: (url, opts) => {
    if (THROW_ON && url.indexOf(THROW_ON) >= 0) throw new Error('network down');
    CALLS.push({ url, opts, body: JSON.parse(opts.payload) });
    return { getResponseCode: () => 200, getContentText: () => '{"sent":1}' };
  },
};

eval(gs.slice(gs.indexOf('function queueReviewNotice'), gs.indexOf('// Resolves which family member')));
eval(gs.slice(gs.indexOf('var _PENDING_NOTIFY'), gs.indexOf('function queueReviewNotice')));

const MEMBER = '11111111-1111-1111-1111-111111111111';
function stage(memberId, times) { for (let i = 0; i < times; i++) queueReviewNotice({ member_id: memberId }); }

/* A fresh scenario, not just a fresh run. notifyStagedReviews now rate-limits
   per member in Script Properties (one banner per NOTIFY_COOLDOWN_MS), so state
   survives between the scenarios below the way it survives between triggers in
   production. Without clearing it, scenario N+1 is silenced by scenario N's
   send and fails for a reason that has nothing to do with what it pins. */
function freshRun() {
  CALLS = []; _PENDING_NOTIFY = {};
  for (const k of Object.keys(_props)) {
    if (k.indexOf('notifyHold:') === 0 || k.indexOf('notifyLast:') === 0) delete _props[k];
  }
}

// ── which rows earn a notice ────────────────────────────────────────────────
// A row the review screen will never show must not produce a banner: an empty
// queue after a tap teaches people the notification is noise. The converse is
// just as true — a row that WILL be shown must announce itself, or it lands in
// the queue and nothing says so.
//
// This assertion was inverted on 2026-08-23. It used to require silence for a
// flagged duplicate, which was right while fhFetchStagedTxns filtered those rows
// out. It no longer does: the flag became a suspicion the reviewer resolves, not
// a delete order the pipeline executes, so the row is really there and really
// needs announcing.
_PENDING_NOTIFY = {};
queueReviewNotice({ member_id: MEMBER, duplicate_of_id: 'dup-1' });
t('a flagged duplicate DOES notify — the review screen shows it now',
  _PENDING_NOTIFY[MEMBER] === 1, JSON.stringify(_PENDING_NOTIFY));

_PENDING_NOTIFY = {};
queueReviewNotice({ member_id: null });
queueReviewNotice({});
t('an unrouted row does NOT notify (0058 shows it to nobody)',
  Object.keys(_PENDING_NOTIFY).length === 0);

/* Post-sealing shape: everything sensitive is ciphertext in `sealed`, and only
   the luggage tags remain readable. The notice rule must still work on that row
   — if it ever needed amount or counterparty, switching sealing on would break
   notifications silently. */
_PENDING_NOTIFY = {};
queueReviewNotice({
  gmail_message_id: 'abc', member_id: MEMBER, source_provider: 'Vietcombank',
  occurred_at: '2026-08-14T00:00:00+07:00', review_status: 'pending',
  sealed: '<ciphertext>', eph_pub: '<pub>', nonce: '<nonce>',
});
t('a SEALED row still notifies — the rule reads only luggage tags',
  _PENDING_NOTIFY[MEMBER] === 1, JSON.stringify(_PENDING_NOTIFY));

// Five emails in one run is one banner, not five.
freshRun();
stage('11111111-1111-1111-1111-111111111111', 5);
notifyStagedReviews();
t('a burst of 5 sends ONE notification', CALLS.length === 1, JSON.stringify(CALLS.length));
t('and carries the count', CALLS[0] && CALLS[0].body.count === 5, CALLS[0] && JSON.stringify(CALLS[0].body));

// Two members in one run get one each — never each other's.
freshRun();
stage('11111111-1111-1111-1111-111111111111', 2);
stage('22222222-2222-2222-2222-222222222222', 1);
notifyStagedReviews();
t('two members get one notification each', CALLS.length === 2);
const byMember = {}; CALLS.forEach((c) => { byMember[c.body.member_id] = c.body.count; });
t('each carries only its own count',
  byMember['11111111-1111-1111-1111-111111111111'] === 2 && byMember['22222222-2222-2222-2222-222222222222'] === 1,
  JSON.stringify(byMember));

// The payload must not be able to leak money detail into a push service.
freshRun();
stage('11111111-1111-1111-1111-111111111111', 1);
notifyStagedReviews();
const keys = CALLS[0] ? Object.keys(CALLS[0].body).sort() : [];
t('payload is exactly {kind, member_id, count} — no amount, merchant or bank',
  JSON.stringify(keys) === JSON.stringify(['count', 'kind', 'member_id']), JSON.stringify(keys));
t('authenticated with the service-role key',
  CALLS[0] && CALLS[0].opts.headers.Authorization === 'Bearer srv-key');

// The queue must not resend on the next tick.
CALLS = [];
notifyStagedReviews();
t('a second run with nothing staged sends nothing', CALLS.length === 0);

// A failed notification must never cost a staged row.
freshRun(); THROW_ON = 'push-send';
stage('11111111-1111-1111-1111-111111111111', 1);
let threw = false;
try { notifyStagedReviews(); } catch (e) { threw = true; }
t('a network failure does not throw into the caller', !threw);
THROW_ON = null;

// Unrouted rows have no member and therefore no audience.
freshRun();
notifyStagedReviews();
t('a run that staged only unrouted rows notifies nobody', CALLS.length === 0);

// ── edge-function side: copy + the service-role gate ─────────────────────────
const ts = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'functions', 'push-send', 'index.ts'), 'utf8');
/* Brace-matching from the first '{' breaks on a TS return type that is itself an
   object ({ title: string; body: string }). These are top-level declarations, so
   the closing brace is the next one in column 0. */
const grab = (header) => {
  const at = ts.indexOf(header);
  if (at < 0) throw new Error('not found: ' + header);
  const end = ts.indexOf('\n}', at);
  return ts.slice(at, end + 2);
};
const DenoEnv = { SUPABASE_SERVICE_ROLE_KEY: 'srv-key' };
global.Deno = { env: { get: (k) => DenoEnv[k] } };
eval(esbuild.transformSync(grab('function isServiceRole') + '\n' + grab('function buildReviewCopy'), { loader: 'ts' }).code);

t('the service-role key opens the pipeline entrance', isServiceRole('srv-key') === true);
t('a user JWT does not', isServiceRole('eyJhbGciOi.some.jwt') === false);
t('a prefix of the key does not', isServiceRole('srv') === false);
t('an empty bearer does not', isServiceRole('') === false);

const vi1 = buildReviewCopy(1, 'vi'), vi3 = buildReviewCopy(3, 'vi'), en3 = buildReviewCopy(3, 'en');
t('VN singular reads naturally', vi1.body.indexOf('Một giao dịch') === 0, vi1.body);
t('VN plural carries the number', vi3.body.indexOf('3 giao dịch') === 0, vi3.body);
t('EN follows the family language', en3.body.indexOf('3 transactions') === 0, en3.body);
t('an unknown language falls back to Vietnamese', buildReviewCopy(1, 'fr').title === vi1.title);

// Currency markers and bank/merchant names only — a bare \d would hit the count,
// which is the one number these are allowed to carry.
const money = /VND|₫|\bđ\b|\bmbbank\b|\bvietcombank\b|REVI PHU/i;
t('no copy variant can carry an amount or a merchant',
  !money.test(vi1.title + vi1.body + vi3.title + vi3.body + en3.title + en3.body));

console.log('\n' + (fail === 0 ? 'ALL ' + pass + ' PASSED' : pass + ' passed, ' + fail + ' FAILED'));
process.exit(fail ? 1 : 0);
