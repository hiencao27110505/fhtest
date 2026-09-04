#!/usr/bin/env node
/* A rate-limited mail must come back, not be written off.
 * `node pipeline/gs-429-requeue.test.js`
 *
 * THE BUG THIS PINS, which was live from the first Gemini call until 2026-09-03:
 *
 * `classifyAndExtractViaGemini` fetches with `muteHttpExceptions: true`, so a
 * 429 arrives as an ordinary response object. It then read `.candidates` off an
 * error body, found none, and threw `Gemini returned no candidates`. That string
 * carries no token `processEmails` recognises as transient, so its catch took
 * the OTHER branch: insertParseFailure + relabel to `txn/parse-failed`.
 * Permanently. A real forwarded transaction that arrived while the free tier was
 * exhausted was burned, with no retry and no notification — and the failure is
 * invisible, because a written-off mail looks exactly like a mail that was never
 * a transaction.
 *
 * The Edge worker never had this: llm.mjs throws, the worker holds, the cursor
 * stays put. This was a one-sided defect between two transports that are
 * otherwise deliberate twins, which is precisely the kind of divergence no
 * amount of reading either file alone would surface.
 *
 * WHY THE ASSERTIONS ARE ON SIDE EFFECTS. The return value of the failing path
 * is identical whether the mail is requeued or burned — both throw. What differs
 * is what was WRITTEN: a parse_failures row and a label change. So the harness
 * records calls and asserts on the record, not on what came back.
 *
 * Source-level rather than executing the .gs: Apps Script globals
 * (UrlFetchApp, PropertiesService, GmailApp) have no Node equivalent, and
 * stubbing all of them would test the stubs. These check the CONTROL FLOW that
 * decides burn-vs-requeue, extracted as real functions where possible.
 */
const fs = require('fs');
const path = require('path');

const gs = fs.readFileSync(path.join(__dirname, 'bank-email-pipeline.gs'), 'utf8');

let pass = 0, fail = 0;
const t = (n, ok, d) => { console.log((ok ? '  PASS  ' : '  FAIL  ') + n + (!ok && d ? '  -> ' + d : '')); ok ? pass++ : fail++; };

/* The .gs deliberately DISCUSSES the old failure in its comments — that record
 * is the most useful thing there for whoever reaches for this next — so a check
 * for "the burn-on-sight string is gone" has to read code, never prose, or the
 * test punishes its own documentation. Same stripper as llm-raw-body.test.js. */
function codeOnly(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .split('\n').map(l => l.replace(/\/\/.*$/, '')).join('\n');
}

/* Slices one top-level function out of the source.
 *
 * NOT a lazy /function name[\s\S]*?\n\}/ — that stops at the first `}` in
 * column 0, which for a function whose body contains any nested block written
 * flush left silently returns a fragment. It cost this file four phantom
 * failures: `processEmails` turned out to be a five-line lock wrapper around
 * `_processEmailsLocked`, and the fragment matched neither. Reading to the next
 * top-level `function` is coarse but cannot truncate. */
function topLevelFn(src, name) {
  const start = src.indexOf('function ' + name);
  if (start === -1) return null;
  const next = src.indexOf('\nfunction ', start + 1);
  return src.slice(start, next === -1 ? undefined : next);
}

// ── 1. the classifier, lifted and run for real ────────────────────────────
// Pulled out of the source and eval'd on its own so the assertions below run
// the SHIPPING code rather than a copy that can drift.
const fnSrc = gs.match(/function geminiRateLimitError\(rawBody\) \{[\s\S]*?\n\}/);
t('geminiRateLimitError exists in the .gs', !!fnSrc);
const geminiRateLimitError = fnSrc ? eval('(' + fnSrc[0] + ')') : null;

if (geminiRateLimitError) {
  const quota = (id) => ({
    '@type': 'type.googleapis.com/google.rpc.QuotaFailure',
    violations: [{ quotaId: id }],
  });
  const body = (...details) => JSON.stringify({ error: { code: 429, details } });

  t('a per-day body produces a day token',
    /^GEMINI_RATE_LIMIT_day/.test(geminiRateLimitError(body(quota('...PerDay...')))));
  t('a per-minute body produces a minute token with a wait',
    /^GEMINI_RATE_LIMIT_minute_30000ms/.test(geminiRateLimitError(body(quota('...PerMinute...')))));
  t('RetryInfo is honoured',
    /_7500ms/.test(geminiRateLimitError(JSON.stringify({
      error: { details: [quota('...PerMinute...'),
        { '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '7.5s' }] },
    }))));
  t('minute AND day named together reads as day',
    /^GEMINI_RATE_LIMIT_day/.test(geminiRateLimitError(body(quota('...PerMinute...'), quota('...PerDay...')))));
  // The asymmetry, same as llm.mjs. A test that ever "fixes" these to day has
  // broken the thing they protect — see pipeline/llm-429.test.js.
  for (const [name, raw] of [
    ['an unknown quota id', body(quota('Whatever'))],
    ['a non-JSON body', '<html>429</html>'],
    ['an empty body', ''],
  ]) {
    t(name + ' falls back to minute, never day',
      /^GEMINI_RATE_LIMIT_minute/.test(geminiRateLimitError(raw)), geminiRateLimitError(raw));
  }
}

// ── 2. the burn-vs-requeue decision ───────────────────────────────────────
// The single regex in processEmails' catch is what stands between a
// rate-limited transaction and permanent loss.
const guard = gs.match(/if \((\/\([^)]*\)\/)\.test\(String\(err\)\)\) \{/);
t('the transient guard is a regex test over the error text', !!guard);
if (guard) {
  const re = eval(guard[1]);
  t('SUPABASE_ errors still requeue (unchanged behaviour)', re.test('SUPABASE_HTTP_500: boom'));
  t('a rate limit requeues', re.test('GEMINI_RATE_LIMIT_day: quota'));
  t('an unavailable model requeues', re.test('GEMINI_UNAVAILABLE_HTTP_503: boom'));
  t('an empty candidate list requeues', re.test('GEMINI_UNAVAILABLE_NOCAND: {}'));
  // The other half of the contract: a genuine per-message fault must STILL be
  // recorded and stop retrying, or a permanently broken mail loops forever.
  t('a real parse fault is NOT requeued', !re.test('TypeError: cannot read amount of undefined'));
  t('and neither is an unrouted mail', !re.test('unroutable_after_grace: no mailbox_connections match'));
}

// ── 3. the status code is inspected before the body is trusted ────────────
const call = topLevelFn(gs, 'classifyAndExtractViaGemini');
t('classifyAndExtractViaGemini found', !!call);
if (call) {
  const src = codeOnly(call);
  const codeAt = src.indexOf('getResponseCode()');
  const parseAt = src.search(/JSON\.parse\(raw\)/);
  t('it reads getResponseCode()', codeAt !== -1);
  t('and does so BEFORE parsing the body as a success payload',
    codeAt !== -1 && parseAt !== -1 && codeAt < parseAt, codeAt + ' vs ' + parseAt);
  t('429 routes to the classifier', /code === 429/.test(src) && /geminiRateLimitError\(raw\)/.test(src));
  t('every other non-2xx throws a requeueable token',
    /GEMINI_UNAVAILABLE_HTTP_/.test(src));
  t('the old burn-on-sight string is gone',
    !/Gemini returned no candidates/.test(src));
}

// ── 4. a day wall ends the run WITHOUT losing the notification ────────────
// Returning early here would have skipped notifyStagedReviews(), so rows staged
// before the wall would sit unannounced — the quota failure silently taking the
// notification for work that had actually succeeded.
// `_processEmailsLocked`, not `processEmails` — the latter is a lock wrapper
// that delegates. Naming the wrong one here passed vacuously for three checks.
const proc = topLevelFn(gs, '_processEmailsLocked');
t('_processEmailsLocked found (processEmails is only the lock wrapper)', !!proc);
if (proc) {
  // codeOnly again: the fix's own comment names notifyStagedReviews() while
  // explaining why the break must not skip it, and a raw indexOf finds the
  // sentence before the call — reading the ordering backwards.
  const src = codeOnly(proc);
  t('the outer thread loop is labelled', /threadLoop:/.test(src));
  t('a day wall breaks the labelled loop rather than returning',
    /GEMINI_RATE_LIMIT_day[\s\S]{0,300}break threadLoop;/.test(src));
  const breakAt = src.indexOf('break threadLoop;');
  const notifyAt = src.indexOf('notifyStagedReviews()');
  t('so notifyStagedReviews() is still reached afterwards',
    breakAt !== -1 && notifyAt !== -1 && notifyAt > breakAt, breakAt + ' vs ' + notifyAt);
}

// ── 5. the paste marker moved ─────────────────────────────────────────────
// The .gs only reaches production by hand, so an unbumped version is how a fix
// silently stays un-deployed while the repo says it shipped.
// Asserted as "moved past the last version that had the bug", not as an exact
// string. PIPELINE_VERSION is ONE global that every change bumps, so pinning
// the literal here made this file fail on the next unrelated fix (it did, on
// 2026-09-04) and quietly claim the 429 work had regressed.
t('PIPELINE_VERSION moved off the version that burned rate-limited mail',
  !/var PIPELINE_VERSION = '2026-09-02-graduate'/.test(gs),
  (gs.match(/var PIPELINE_VERSION = '[^']*'/) || [])[0]);

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
