#!/usr/bin/env node
/* The pipeline reports whether it is working. (0119)
 * `node pipeline/pipeline-health.test.js`
 *
 * WHAT THIS EXISTS FOR. On 2026-08-29 the forwarding pipeline stopped staging
 * anything and nobody knew for six days. Every obvious monitor would have
 * missed it: the runs were SUCCEEDING (so a heartbeat is green), there were no
 * errors (so an error rate is flat), and "time since the last staged row" is
 * indistinguishable from a user who simply did not spend money that week.
 *
 * The number that was climbing in plain sight the whole time is how long the
 * oldest unprocessed message had been sitting in the queue. These pin the two
 * halves of making that visible: the .gs counting it for free out of the batch
 * it already walked, and 0119 alerting on it.
 *
 * WHY held IS COUNTED BY ELIMINATION. There are many ways to hold a message and
 * exactly two ways to finish one — relabel the thread, or trash it. Counting
 * the finishes and calling the rest held means a hold path added later is
 * counted automatically. Instrumenting the holds instead would mean the safe
 * default is the one you get by REMEMBERING, which is how the original bug
 * stayed invisible.
 */
const fs = require('fs');
const path = require('path');

const gs = fs.readFileSync(path.join(__dirname, 'bank-email-pipeline.gs'), 'utf8');
const sql = fs.readFileSync(
  path.join(__dirname, '..', 'supabase', 'migrations', '0119_pipeline_health.sql'), 'utf8');

let pass = 0, fail = 0;
const t = (n, ok, d) => { console.log((ok ? '  PASS  ' : '  FAIL  ') + n + (!ok && d ? '  -> ' + d : '')); ok ? pass++ : fail++; };

function codeOnly(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, ' ')
            .split('\n').map(l => l.replace(/\/\/.*$/, '')).join('\n');
}
function topLevelFn(src, name) {
  const start = src.indexOf('function ' + name);
  if (start === -1) return null;
  const next = src.indexOf('\nfunction ', start + 1);
  return src.slice(start, next === -1 ? undefined : next);
}

// ── 1. the terminal flag is set by the ACTIONS, not at each return ────────
const relabel = codeOnly(topLevelFn(gs, 'relabelThread') || '');
t('relabelThread marks the message terminal', /_MSG_TERMINAL = true;/.test(relabel));
// relabelMessageThread delegates to relabelThread, so one site covers both.
const relabelMsg = codeOnly(topLevelFn(gs, 'relabelMessageThread') || '');
t('relabelMessageThread reaches it by delegating', /relabelThread\(thread, labelName\)/.test(relabelMsg));
const pom = codeOnly(topLevelFn(gs, 'processOneMessage') || '');
t('trashing a retired alias is terminal too',
  /_MSG_TERMINAL = true;[\s\S]{0,120}moveToTrash/.test(pom));

// ── 2. the run counts what it saw, for free ───────────────────────────────
const proc = codeOnly(topLevelFn(gs, '_processEmailsLocked') || '');
t('the flag is reset before each message', /_MSG_TERMINAL = false;/.test(proc));
t('and reset BEFORE processOneMessage runs, not after',
  proc.indexOf('_MSG_TERMINAL = false;') < proc.indexOf('processOneMessage(messages[m]'));
t('anything not terminal counts as held', /if \(!_MSG_TERMINAL\) \{[\s\S]{0,80}_held\+\+/.test(proc));
t('the oldest held date is tracked', /_oldestHeld === null \|\| _d < _oldestHeld/.test(proc));
// No extra Gmail or Supabase call may be introduced to gather this: the whole
// point is that the run already walked these messages.
t('counting adds no API call', !/GmailApp\.search|supabaseGet/.test(
  proc.slice(proc.indexOf('threadLoop:'), proc.indexOf('notifyStagedReviews'))));
// A truncated run undercounts, and the alert copy says so — but only if the flag
// actually reaches the report.
t('a quota wall marks the run truncated',
  (proc.match(/_truncated = true;/g) || []).length >= 2, 'expected both day-scope walls');

// ── 3. reporting is last, wrapped, and cannot fail the run ────────────────
t('the report runs after notifyStagedReviews',
  proc.indexOf('notifyStagedReviews()') < proc.indexOf('reportPipelineHealth('));
t('and is wrapped so telemetry never fails a working run',
  /try \{ reportPipelineHealth\([\s\S]{0,120}catch/.test(proc));

const rep = topLevelFn(gs, 'reportPipelineHealth') || '';
const repCode = codeOnly(rep);
t('reportPipelineHealth exists', !!rep);
t('it upserts on transport, so one row per transport',
  /supabasePost\('pipeline_health'[\s\S]{0,600}'transport'\)/.test(repCode));
t('it reports the running version, so a stale paste is visible',
  /version: PIPELINE_VERSION/.test(repCode));

// The throttle is the quota guard, and it must NOT apply when something is
// wrong: a stuck queue is exactly when the number needs to be fresh.
t('a clear queue reports only on the interval', /if \(!held && isFinite\(last\)/.test(repCode));
t('but held mail reports immediately', /!held &&/.test(repCode));
// Stamping before the write would let a failing report look recent, which is
// precisely the "quiet but broken" state this whole feature exists to expose.
t('the timestamp is stamped only AFTER the write lands',
  repCode.indexOf('supabasePost') < repCode.indexOf('setProperty(HEALTH_LAST_PROP'));

// ── 4. 0119 alerts on two DIFFERENT failures ──────────────────────────────
t('pipeline_health is created', /create table if not exists public\.pipeline_health/.test(sql));
t('RLS on, and no client role can read it',
  /alter table public\.pipeline_health enable row level security/.test(sql) &&
  /revoke all on public\.pipeline_health from public, anon, authenticated/.test(sql) &&
  !/grant[^;]*on public\.pipeline_health to authenticated/.test(sql));
t('it holds counts and timestamps, no family data',
  !/amount|counterparty|member_id|personal_email/.test(
    sql.slice(sql.indexOf('create table if not exists public.pipeline_health'),
              sql.indexOf('comment on table'))));

const chk = sql.slice(sql.indexOf('_tg_pipeline_health_check'));
// SILENT catches "not running at all" — the 2026-09-04 failure. STUCK catches
// "running but not draining" — the 2026-08-29 one. Neither subsumes the other.
t('it alerts when the pipeline goes SILENT', /v_kind := 'silent'/.test(chk));
t('and when the queue is STUCK', /v_kind := 'stuck'/.test(chk));
t('silent is checked FIRST — a stale queue reading is not news',
  chk.indexOf("v_kind := 'silent'") < chk.indexOf("v_kind := 'stuck'"));
t('it reuses the existing Telegram channel rather than inventing one',
  /perform public\._tg_send\(v_msg\)/.test(chk));

// Debounce, both directions. Without it a stuck queue alerts every 15 minutes
// until the channel is muted — the failure mode the Apps Script mails hit.
t('alerts are debounced', /c_redo\s+constant interval/.test(chk) &&
  /v_last is null or now\(\) - v_last > c_redo/.test(chk));
t('recovery clears the debounce so the next fault alerts at once',
  /if v_kind is null then[\s\S]{0,300}delete from public\.pipeline_alert_state/.test(chk));
t('switching kind clears the other kind, so it cannot suppress the new one',
  /delete from public\.pipeline_alert_state\s*\n\s*where transport = r\.transport and kind <> v_kind/.test(chk));

// The seed row is what makes SILENT possible at all: with no row the loop runs
// zero times and a pipeline that never reports is watched by nothing.
t('a seed row exists so a never-reporting pipeline is still monitored',
  /insert into public\.pipeline_health \(transport, ran_at, note\)/.test(sql));
t('and it is backdated so the first missed report alerts immediately',
  /now\(\) - interval '1 hour'/.test(sql));
t('the check is scheduled on pg_cron', /cron\.schedule\('familyhub-pipeline-health'/.test(sql));
t('on an off-minute, clear of the founder digest',
  /'7,22,37,52 \* \* \* \*'/.test(sql));
t('and unschedules itself first, so re-applying does not double-schedule',
  /cron\.unschedule\('familyhub-pipeline-health'\)/.test(sql));

// ── 5. the paste marker moved ─────────────────────────────────────────────
// The version is a DATE, so assert it has reached this fix's date rather than
// pinning the literal. PIPELINE_VERSION is one global that every change bumps:
// an exact-string check turns every later fix into a false failure claiming
// THIS one regressed. That has now happened twice (gs-429-requeue on 09-04,
// retired-alias an hour later), which is twice more than a version marker
// should cost.
const _ver = (gs.match(/var PIPELINE_VERSION = '(\d{4}-\d{2}-\d{2})/) || [])[1];
t('PIPELINE_VERSION has reached 2026-09-04 or later', !!_ver && _ver >= '2026-09-04', _ver);

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
