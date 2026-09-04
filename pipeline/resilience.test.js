#!/usr/bin/env node
/* Transient-failure classification + message-level idempotency.
 * `node pipeline/resilience.test.js`
 *
 * Both of these exist because of a real incident on 2026-08-15: the Supabase
 * project went over its free-tier bandwidth quota, and three parse_failures rows
 * recorded the result —
 *
 *   Exception: Bandwidth quota exceeded: .../rest/v1/mailbox_connections?...
 *   Exception: Address unavailable:      .../rest/v1/mailbox_connections?...
 *
 * processEmails decides whether a failure is the MESSAGE's fault or the
 * DATABASE's by looking for "SUPABASE_" in the error. Those two strings are
 * thrown by UrlFetchApp itself, before any response exists, and contain no such
 * token — so an outage was read as "this email is bad", a parse_failure was
 * written, and the thread was relabelled txn/parse-failed, which the inbox query
 * excludes permanently. Good bank mail was discarded because the database was
 * briefly over quota.
 */
// NOT 'use strict': eval'd .gs declarations must land in this scope.
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, 'bank-email-pipeline.gs'), 'utf8');

let pass = 0, fail = 0;
const t = (n, ok, d) => { console.log((ok ? '  PASS  ' : '  FAIL  ') + n + (!ok && d ? '  -> ' + d : '')); ok ? pass++ : fail++; };

let _props = { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'k' };
global.PropertiesService = { getScriptProperties: () => ({ getProperty: (k) => _props[k] || null }) };
global.Logger = { log: () => {} };

let FETCH;                                   // swapped per case
global.UrlFetchApp = { fetch: (u, o) => FETCH(u, o) };

eval(src.slice(src.indexOf('function _supabaseFetch'), src.indexOf('function supabasePost')));
eval(src.slice(src.indexOf('function isAlreadyStaged'), src.indexOf('// ---------- review notifications')));

/* processEmails' own rule for "is this the database's problem, not the email's".
 *
 * READ OUT OF THE SOURCE, not restated here. This was a hardcoded
 * `indexOf('SUPABASE_')` — a copy of the guard rather than the guard — and on
 * 2026-09-04 the real one grew APPSCRIPT_QUOTA_ (the platform's own UrlFetch day
 * cap is not a Supabase failure and no longer wears its name). The copy went on
 * asserting the old rule and failed the case it was written to protect, while
 * the shipping behaviour was correct. A test that duplicates the logic it
 * guards eventually tests only the duplicate. */
const _guard = src.match(/if \((\/\([^)]*\)\/)\.test\(String\(err\)\)\) \{/);
if (!_guard) throw new Error('could not find the transient guard in processEmails');
const _guardRe = eval(_guard[1]);
const treatedAsTransient = (err) => _guardRe.test(String(err));

const throwsWith = (msg) => { FETCH = () => { throw new Error(msg); }; };
const capture = (fn) => { try { fn(); return null; } catch (e) { return e; } };

console.log('\n-- the outage strings that actually cost us emails --');
[
  'Address unavailable: https://iizyukzfsbdkbrgfupwq.supabase.co/rest/v1/mailbox_connections?forwarding_alias=eq.trang',
  'Bandwidth quota exceeded: https://iizyukzfsbdkbrgfupwq.supabase.co/rest/v1/mailbox_connections. Try reducing the rate of data transfer.',
  'Timeout',
  'DNS error',
  'Service invoked too many times for one day: urlfetch.',
].forEach((raw) => {
  throwsWith(raw);
  const err = capture(() => supabaseGet('email_transactions', { id: 'eq.1' }));
  t('transient: ' + raw.slice(0, 42), !!err && treatedAsTransient(err), String(err));
});

console.log('\n-- an HTTP error still classifies as transient, as before --');
FETCH = () => ({ getResponseCode: () => 503, getContentText: () => 'upstream down' });
t('HTTP 5xx keeps its SUPABASE_HTTP_ token',
  treatedAsTransient(capture(() => supabaseGet('email_transactions', { id: 'eq.1' }))));
FETCH = () => ({ getResponseCode: () => 409, getContentText: () => 'duplicate key' });
t('a 409 is reported rather than swallowed',
  treatedAsTransient(capture(() => supabaseGet('email_transactions', { id: 'eq.1' }))));

console.log('\n-- a genuinely bad message must NOT look like an outage --');
t('a parse error is the message\'s own problem',
  !treatedAsTransient(new Error('Cannot read property amount of null')));

console.log('\n-- message-level idempotency --');
FETCH = () => ({ getResponseCode: () => 200, getContentText: () => '[{"id":"row-1"}]' });
t('a message already in email_transactions is recognised', isAlreadyStaged('abc123') === true);
FETCH = () => ({ getResponseCode: () => 200, getContentText: () => '[]' });
t('an unseen message is not', isAlreadyStaged('abc123') === false);
t('a missing id is not a lookup', isAlreadyStaged(null) === false);

let asked = null;
FETCH = (u) => { asked = u; return { getResponseCode: () => 200, getContentText: () => '[]' }; };
isAlreadyStaged('msg-42');
t('it queries the unique key, not a scan', asked.indexOf('gmail_message_id=eq.msg-42') > -1, asked);
t('and asks for one column only', asked.indexOf('select=id') > -1, asked);

console.log('\n-- the dangerous case: never conclude "not staged" from an outage --');
throwsWith('Address unavailable: https://x.supabase.co');
const dur = capture(() => isAlreadyStaged('msg-42'));
t('an unreachable database throws instead of answering false', !!dur, String(dur));
t('and the throw is classified transient, so the message is retried',
  !!dur && treatedAsTransient(dur));

console.log('\n' + (fail === 0 ? 'ALL ' + pass + ' PASSED' : pass + ' passed, ' + fail + ' FAILED'));
process.exit(fail ? 1 : 0);
