#!/usr/bin/env node
/* Inbox retention + the mailbox-verified write.
 * `node pipeline/retention.test.js`
 *
 * Retention deletes other people's banking out of a live mailbox, so the parts
 * worth testing are the refusals: off by default, never the wrong label, never a
 * thread that is only half old, never a hard delete. A bug here is not a wrong
 * number on a screen, it is mail nobody can get back.
 *
 * The verified half is here because it is the same paste: `markMailboxVerified`
 * existed, was documented as being called from processOneMessage, and was never
 * called by anything. The unit test below would have passed the whole time — so
 * the test that actually matters is the source assertion that the call site is
 * there at all.
 */
// NOT 'use strict': the eval'd .gs declarations must land in this scope.
const fs = require('fs');
const path = require('path');

let pass = 0, fail = 0;
const t = (n, ok, d) => { console.log((ok ? '  PASS  ' : '  FAIL  ') + n + (!ok && d ? '  -> ' + d : '')); ok ? pass++ : fail++; };

const gs = fs.readFileSync(path.join(__dirname, 'bank-email-pipeline.gs'), 'utf8');

// ── stubs ───────────────────────────────────────────────────────────────────
let _props = {};
global.PropertiesService = {
  getScriptProperties: () => ({
    getProperty: (k) => (k in _props ? _props[k] : null),
    setProperty: (k, v) => { _props[k] = v; },
  }),
};
global.Logger = { log: () => {} };

let SEARCHES = [];
let THREADS = [];
global.GmailApp = {
  search: (q, start, max) => { SEARCHES.push({ q, start, max }); return THREADS; },
};

// A thread records what was done to it. Only moveToTrash is offered: if the
// sweep ever reaches for a harder delete, it throws here instead of succeeding.
function mkThread(id, opts) {
  const o = opts || {};
  return {
    id,
    trashed: false,
    moveToTrash() {
      if (o.throws) throw new Error('cannot trash ' + id);
      this.trashed = true;
    },
  };
}

let NOW = 1_700_000_000_000;
const RealDate = Date;
global.Date = class extends RealDate {
  constructor(...a) { if (a.length) return new RealDate(...a); super(NOW); }
  getTime() { return NOW; }
};

eval(gs.slice(gs.indexOf('var PIPELINE_VERSION'), gs.indexOf('function processEmails')));
eval(gs.slice(gs.indexOf('function retentionEnabled'), gs.indexOf('// ---------- Stage 1 helpers')));

function reset(props) {
  _props = Object.assign({}, props);
  SEARCHES = [];
  THREADS = [];
}

// ── it is off until someone turns it on ─────────────────────────────────────
// The whole point of the Script Property is that this lands in a live mailbox
// switched off. A default that deletes is not a default.
console.log('\n-- off unless explicitly armed --');

reset({});
t('no property at all: deletes nothing', sweepProcessedMail() === 0);
t('and does not even spend a Gmail search', SEARCHES.length === 0);

reset({ INBOX_RETENTION_ENABLED: 'false' });
t("'false' deletes nothing", sweepProcessedMail() === 0 && SEARCHES.length === 0);

reset({ INBOX_RETENTION_ENABLED: 'TRUE' });
t("'TRUE' is not 'true' — no accidental arming on a typo",
  sweepProcessedMail() === 0 && SEARCHES.length === 0);

reset({ INBOX_RETENTION_ENABLED: '1' });
t("'1' does not arm it either", sweepProcessedMail() === 0 && SEARCHES.length === 0);

// ── what it is allowed to look at ───────────────────────────────────────────
console.log('\n-- the query is the safety boundary --');

reset({ INBOX_RETENTION_ENABLED: 'true' });
sweepProcessedMail();
const q = SEARCHES[0] ? SEARCHES[0].q : '';
t('only txn/processed is swept', q.indexOf('label:txn/processed') >= 0, q);
t('txn/parse-failed is never in scope — it is the record of what went wrong',
  q.indexOf('parse-failed') === -1, q);
t('bounded below: older_than the window', q.indexOf('older_than:7d') >= 0, q);
t('bounded above: -newer_than, so a thread with anything recent is left alone',
  q.indexOf('-newer_than:7d') >= 0, q);
t('the batch is capped so one sweep cannot run out the 6-minute limit',
  SEARCHES[0].max === RETENTION_MAX_THREADS_PER_SWEEP, String(SEARCHES[0].max));

// `older_than:` alone matches a thread on its OLDEST message. Without the upper
// bound, one ancient message in a live thread takes every newer message in that
// thread with it — the hidden-later-message trap, made permanent.
t('both bounds are present together, not one or the other',
  q.indexOf('older_than:7d') >= 0 && q.indexOf('-newer_than:7d') >= 0, q);

// ── the window ──────────────────────────────────────────────────────────────
console.log('\n-- the window falls back rather than widening --');

reset({ INBOX_RETENTION_ENABLED: 'true', INBOX_RETENTION_DAYS: '30' });
sweepProcessedMail();
t('an explicit window is honoured', SEARCHES[0].q.indexOf('older_than:30d') >= 0, SEARCHES[0].q);

for (const bad of ['0', '-3', 'abc', '', 'seven']) {
  reset({ INBOX_RETENTION_ENABLED: 'true', INBOX_RETENTION_DAYS: bad });
  sweepProcessedMail();
  t('a bad window (' + JSON.stringify(bad) + ') falls back to ' + RETENTION_DAYS + 'd, never 0d',
    SEARCHES[0].q.indexOf('older_than:' + RETENTION_DAYS + 'd') >= 0, SEARCHES[0].q);
}

// 0d would mean "everything, including mail that arrived this morning". That is
// the one failure mode that cannot be walked back, so it gets its own assertion.
reset({ INBOX_RETENTION_ENABLED: 'true', INBOX_RETENTION_DAYS: '0' });
sweepProcessedMail();
t('0 days can never reach the query', SEARCHES[0].q.indexOf('older_than:0d') === -1, SEARCHES[0].q);

// ── what it does to what it finds ───────────────────────────────────────────
console.log('\n-- trashing, not deleting --');

reset({ INBOX_RETENTION_ENABLED: 'true' });
THREADS = [mkThread('a'), mkThread('b'), mkThread('c')];
let n = sweepProcessedMail();
t('every matching thread is trashed', THREADS.every((x) => x.trashed));
t('and the count comes back', n === 3, String(n));

reset({ INBOX_RETENTION_ENABLED: 'true' });
THREADS = [mkThread('a'), mkThread('stuck', { throws: true }), mkThread('c')];
n = sweepProcessedMail();
t('one thread that will not move does not strand the rest',
  THREADS[0].trashed && THREADS[2].trashed, JSON.stringify(THREADS.map((x) => x.trashed)));
t('and it is not counted as trashed', n === 2, String(n));

t('the source reaches for moveToTrash and nothing harder',
  /moveToTrash\(\)/.test(gs) && !/Messages\.remove|\.deletePermanently|permanentlyDelete/.test(gs));

// ── it does not run every tick ──────────────────────────────────────────────
// A Gmail search is the dominant cost of an idle tick and this rides a trigger
// that fires 1,440 times a day against a ~90-minute budget.
console.log('\n-- rate limiting --');

reset({ INBOX_RETENTION_ENABLED: 'true' });
THREADS = [mkThread('a')];
sweepProcessedMail();
const after = SEARCHES.length;
SEARCHES = [];
t('a second call a minute later does nothing', sweepProcessedMail() === 0);
t('and costs no Gmail search', SEARCHES.length === 0 && after === 1);

NOW += RETENTION_SWEEP_INTERVAL_MIN * 60000 + 1000;
THREADS = [mkThread('b')];
t('once the interval has passed it runs again', sweepProcessedMail() === 1);

// If the timestamp were written after the work, a sweep that died partway would
// retry on every one of the next 1,440 ticks.
NOW += RETENTION_SWEEP_INTERVAL_MIN * 60000 + 1000;
reset({ INBOX_RETENTION_ENABLED: 'true' });
THREADS = [mkThread('x', { throws: true })];
sweepProcessedMail();
t('a sweep that trashes nothing still records that it ran',
  _props.INBOX_RETENTION_LAST_RUN === String(NOW), String(_props.INBOX_RETENTION_LAST_RUN));

// ── mailbox verified ────────────────────────────────────────────────────────
console.log('\n-- the verified write --');

let PATCHES = [];
function supabasePatch(table, filters, updates) { PATCHES.push({ table, filters, updates }); }
eval(gs.slice(gs.indexOf('function markMailboxVerified'), gs.indexOf('function insertParseFailure')));

PATCHES = [];
markMailboxVerified('8xr4ed9vr8');
t('it patches mailbox_connections', PATCHES.length === 1 && PATCHES[0].table === 'mailbox_connections');
t('for that alias only', PATCHES[0].filters.forwarding_alias === 'eq.8xr4ed9vr8', JSON.stringify(PATCHES[0].filters));
t('setting verified true', PATCHES[0].updates.verified === true, JSON.stringify(PATCHES[0].updates));

// Cosmetic only: the transaction is already written, so a failure here must not
// take the run down with it.
supabasePatch = () => { throw new Error('network down'); };
let threw = false;
try { markMailboxVerified('x'); } catch (e) { threw = true; }
t('a failed patch is swallowed — the row is already staged', !threw);

// The one that matters. Every assertion above passed for the entire time this
// function was dead code, because nothing called it.
console.log('\n-- the call site exists (this is the regression) --');

const pom = gs.slice(gs.indexOf('function processOneMessage'), gs.indexOf('// ---------- Stage 0 helpers'));
t('processOneMessage actually calls markMailboxVerified', /markMailboxVerified\(/.test(pom));
t('it passes the routed alias', /markMailboxVerified\(mailbox\.forwarding_alias\)/.test(pom));
t('guarded on !mailbox.verified, so it is not a PATCH per message forever',
  /if\s*\(!mailbox\.verified\)\s*markMailboxVerified\(/.test(pom));

// It has to sit after the insert is confirmed: claiming forwarding works on the
// strength of a write that failed is the same lie the confirmation fetch made.
t('and only after the insert is confirmed',
  pom.indexOf('markMailboxVerified(') > pom.indexOf('if (!inserted)'));

// ── the sweep is actually wired to the trigger ──────────────────────────────
console.log('\n-- the sweep is reachable --');

const pe = gs.slice(gs.indexOf('function processEmails'), gs.indexOf('function processOneMessage'));
t('processEmails calls the sweep', /sweepProcessedMail\(\)/.test(pe));
t('wrapped, so a sweep failure cannot stop transactions', /try\s*\{\s*sweepProcessedMail\(\)/.test(pe));
// Both early returns below it would skip the sweep, and an idle inbox is exactly
// when the backlog still needs draining. Anchored on the code rather than on the
// log copy: the comment above the call quotes that copy, so the phrase matches
// twice and the first hit is the comment.
t('before the early returns, so an idle inbox still drains',
  pe.indexOf('sweepProcessedMail()') < pe.indexOf('var q = buildInboxQuery()'));

console.log('\n' + (fail ? 'FAILED ' + fail + ' of ' + (pass + fail) : 'ALL ' + pass + ' PASSED'));
process.exit(fail ? 1 : 0);
