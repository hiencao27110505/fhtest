#!/usr/bin/env node
/* A withdrawn user's mail is deleted, not held for a fortnight.
 * `node pipeline/retired-alias.test.js`
 *
 * THE BUG THIS PINS, live from 0059 until 2026-09-04:
 *
 * disconnect_my_mailbox() DELETES the mailbox_connections row. That is the
 * right thing — it is what stops us reading — but it is also the only evidence
 * that the alias ever existed, and Gmail keeps forwarding regardless: that rule
 * lives in the person's own mailbox and is not ours to revoke. So the pipeline
 * saw mail arrive at an address it did not recognise, read that absence as
 * *onboarding has not finished yet*, and HELD it for ROUTING_GRACE_DAYS.
 *
 * Two situations, one signal, opposite correct responses. The cost of getting
 * it backwards is not a delay: txn/inbox is swept by nothing, so a withdrawn
 * user's real bank mail sat in a shared inbox for 14 days, then 90 more as
 * txn/parse-failed with a parse_failures row — roughly 104 days of banking that
 * no consent text covers, regenerating every time they used their card. It also
 * cost 1,440 Supabase lookups per held message per day, which is what exhausted
 * Apps Script's 20,000/day UrlFetch cap and finally made the whole thing
 * visible.
 *
 * WHY THE ASSERTIONS ARE MOSTLY STRUCTURAL. The retired branch's whole point is
 * what it does NOT do — no staging, no parse_failures row, no relabel, no hold —
 * and "did not happen" is not observable from a return value. So these read the
 * control flow that decides trash-vs-hold, and run the one function (
 * isRetiredAlias) that can be lifted out and executed honestly.
 */
const fs = require('fs');
const path = require('path');

const gs = fs.readFileSync(path.join(__dirname, 'bank-email-pipeline.gs'), 'utf8');
const sql = fs.readFileSync(
  path.join(__dirname, '..', 'supabase', 'migrations', '0117_retired_aliases.sql'), 'utf8');

let pass = 0, fail = 0;
const t = (n, ok, d) => { console.log((ok ? '  PASS  ' : '  FAIL  ') + n + (!ok && d ? '  -> ' + d : '')); ok ? pass++ : fail++; };

/* Same two helpers as gs-429-requeue.test.js, and for the same reasons: the .gs
 * documents this failure at length in prose, so any check for "the old
 * behaviour is gone" must read code or it punishes its own documentation; and
 * a lazy /function x[\s\S]*?\n\}/ truncates at the first flush-left brace. */
function codeOnly(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .split('\n').map(l => l.replace(/\/\/.*$/, '')).join('\n');
}
function topLevelFn(src, name) {
  const start = src.indexOf('function ' + name);
  if (start === -1) return null;
  const next = src.indexOf('\nfunction ', start + 1);
  return src.slice(start, next === -1 ? undefined : next);
}

// ── 1. isRetiredAlias, lifted and run for real ────────────────────────────
const fnSrc = topLevelFn(gs, 'isRetiredAlias');
t('isRetiredAlias exists in the .gs', !!fnSrc);

if (fnSrc) {
  let CACHE = '';
  global.RETIRED_CACHE_PROP = 'RETIRED_ALIAS_CACHE';
  global.PropertiesService = { getScriptProperties: () => ({ getProperty: () => CACHE }) };
  // The real ones, not lookalikes: a forwarding chain can stack several aliases
  // in one header, and taking only the first is a bug this codebase has already
  // had once (see extractPlusTags' own comment).
  // One contiguous slice, recipientForRouting through extractPlusTags. Lifting
  // them separately means picking apart a run of functions whose comment blocks
  // sit between them, which truncated mid-comment and cost a phantom failure.
  eval(gs.slice(gs.indexOf('function recipientForRouting('), gs.indexOf('function markMailboxVerified')));
  // The newline before the `)` is load-bearing. topLevelFn reads to the next
  // top-level `function`, so the slice ends inside the NEXT function's leading
  // `//` comment block — and a closing paren appended to a comment line is a
  // commented-out paren, which fails as "Unexpected end of input" pointing at
  // prose two functions away.
  const isRetiredAlias = eval('(' + fnSrc + '\n)');

  const msg = (deliveredTo) => ({
    getHeader: (h) => (h === 'Delivered-To' ? deliveredTo : null),
    getTo: () => deliveredTo,
  });

  CACHE = '8xr4ed9vr8,eqqedh3pju';
  t('a retired tag is recognised', isRetiredAlias(msg('gichisreading+8xr4ed9vr8@gmail.com')) === true);
  t('a live tag is not', isRetiredAlias(msg('gichisreading+ab3kd9x2mq@gmail.com')) === false);
  t('the second entry matches too (not just the first)',
    isRetiredAlias(msg('gichisreading+eqqedh3pju@gmail.com')) === true);
  // A chain that passed through two forwarding rules carries several tags. If
  // ANY of them is retired the mail is arriving by a route its owner revoked.
  t('a forwarding chain matches on any of its tags',
    isRetiredAlias(msg('gichisreading+ab3kd9x2mq@gmail.com, gichisreading+8xr4ed9vr8@gmail.com')) === true);
  // Tags are compared whole. A substring match would retire live aliases that
  // merely share a prefix, silently deleting mail nobody asked us to delete —
  // the worst failure this file could have.
  t('matching is exact, never a substring',
    isRetiredAlias(msg('gichisreading+8xr4ed9vr8xx@gmail.com')) === false);
  t('an untagged address is not retired', isRetiredAlias(msg('gichisreading@gmail.com')) === false);

  // The safe default, and the one that holds on a fresh paste or before 0117 is
  // applied: answer false, and the message lands back on the routing grace —
  // the behaviour that held before any of this existed. Never trash on an
  // empty cache.
  CACHE = '';
  t('an empty cache retires nothing', isRetiredAlias(msg('gichisreading+8xr4ed9vr8@gmail.com')) === false);
  CACHE = null;
  t('an absent cache retires nothing', isRetiredAlias(msg('gichisreading+8xr4ed9vr8@gmail.com')) === false);
}

// ── 2. the trash-vs-hold decision, and its ORDER ──────────────────────────
// The ordering is the fix. Checked after resolveMailbox (a tag that resolves is
// live, whatever the table remembers, so a re-issued alias can never be
// shadowed) and before the grace (or the 14-day hold happens anyway).
const pom = topLevelFn(gs, 'processOneMessage');
t('processOneMessage found', !!pom);
if (pom) {
  const src = codeOnly(pom);
  const resolveAt = src.indexOf('resolveMailbox(message)');
  const retiredAt = src.indexOf('isRetiredAlias(message)');
  const graceAt = src.indexOf('ROUTING_GRACE_DAYS');
  t('the retired check runs AFTER resolveMailbox',
    resolveAt !== -1 && retiredAt !== -1 && retiredAt > resolveAt, resolveAt + ' vs ' + retiredAt);
  t('and BEFORE the routing grace',
    retiredAt !== -1 && graceAt !== -1 && retiredAt < graceAt, retiredAt + ' vs ' + graceAt);

  // Per MESSAGE. A thread can hold mail from a live alias too, and the decision
  // is about the address this one message arrived at.
  t('it trashes the message, not the whole thread',
    /message\.moveToTrash\(\)/.test(src) && !/getThread\(\)\.moveToTrash/.test(src));
  // Trashing must never be able to stop the batch: one message Gmail will not
  // move cannot be allowed to strand every transaction behind it.
  t('the trash is wrapped so it cannot stop the run',
    /try \{ message\.moveToTrash\(\); \}[\s\S]{0,120}catch/.test(src));

  // What must NOT happen on this path. A withdrawn user's mail is not evidence
  // to keep — recording sender+subject in parse_failures is the same mistake
  // 0115 purged, one table over.
  const branch = src.slice(retiredAt, graceAt);
  t('the retired branch writes no parse_failures row', !/insertParseFailure/.test(branch), branch);
  t('and stages nothing', !/insertEmailTransaction|queueReviewNotice/.test(branch));
  t('and does not relabel it into a 90-day bucket', !/relabelMessageThread/.test(branch));
  t('and returns without spending a model call',
    /return runCallCount;/.test(branch) && !/classifyAndExtract/.test(branch));
}

// ── 3. the list costs nothing per message ─────────────────────────────────
// Consulted once per message, so a per-message round trip would reproduce the
// very cost that made this visible. It rides the 5-minute alias cache instead.
const biq = topLevelFn(gs, 'buildInboxQuery');
t('buildInboxQuery found', !!biq);
if (biq) {
  const src = codeOnly(biq);
  t('the retired list is fetched inside the cached block',
    /supabaseGet\('retired_aliases'/.test(src));
  t('and written to the cache property', /setProperty\(RETIRED_CACHE_PROP/.test(src));
  // The .gs is pasted by hand, so it can be live before 0117 is applied. A
  // missing table must degrade to the old hold, never take down the query every
  // transaction depends on.
  t('a missing table degrades instead of throwing',
    /try \{[^}]*retired_aliases[\s\S]{0,200}catch/.test(src));
  t('isRetiredAlias reads the cache, not the table',
    !/supabaseGet/.test(codeOnly(topLevelFn(gs, 'isRetiredAlias') || '')));
}

// ── 4. 0117 records the tag before it destroys it ─────────────────────────
t('retired_aliases is created', /create table if not exists public\.retired_aliases/.test(sql));
t('RLS is on', /alter table public\.retired_aliases enable row level security/.test(sql));
t('and no client role can read it',
  /revoke all on public\.retired_aliases from public, anon, authenticated/.test(sql) &&
  !/grant[^;]*on public\.retired_aliases to authenticated/.test(sql));
// It holds one fact about a dead tag and nothing about the person who held it.
t('it stores no member, email or family',
  !/member_id|personal_email|family_id/.test(sql.slice(sql.indexOf('create table'), sql.indexOf('comment on table'))));

const fn = sql.slice(sql.indexOf('create or replace function public.disconnect_my_mailbox'));
const insertAt = fn.indexOf('insert into retired_aliases');
const deleteAt = fn.indexOf('delete from mailbox_connections');
t('the withdrawal retires the alias', insertAt !== -1);
t('and does so BEFORE deleting the row that names it',
  insertAt !== -1 && deleteAt !== -1 && insertAt < deleteAt, insertAt + ' vs ' + deleteAt);
t('disconnecting twice is success, not an error', /on conflict \(forwarding_alias\) do nothing/.test(fn));
// Everything 0087 did still happens: this is a replacement, not a rewrite.
t('it still deletes the pending staged rows', /delete from email_transactions/.test(fn));
t('it still deletes the OAuth grant', /delete from mailbox_grants where user_id = v_uid/.test(fn));
t('the return shape gains a key rather than changing one',
  /'connections', v_conns/.test(fn) && /'pending_deleted', v_rows/.test(fn) &&
  /'grants', v_grants/.test(fn) && /'aliases_retired', v_retired/.test(fn));

// ── 5. the invariant holds in BOTH directions (0118) ─────────────────────
// retired_aliases means "no live connection holds this tag". 0117 maintains the
// insert side; without 0118 nothing maintained the other, because the minter
// tests uniqueness against mailbox_connections — a table retired tags are by
// construction no longer in. A tag could be live AND tombstoned at once, and
// which fact wins would depend only on the order two checks happen to run in.
const mint = fs.readFileSync(
  path.join(__dirname, '..', 'supabase', 'migrations', '0118_alias_issue_unretires.sql'), 'utf8');
t('0118 replaces the minter', /create or replace function public\.get_or_create_mailbox_alias/.test(mint));
t('issuing a tag clears its tombstone',
  /delete from retired_aliases where forwarding_alias = v_tag;/.test(mint));
// Inside the loop, after the insert: the tag does not exist before it succeeds.
const insAt = mint.indexOf('insert into mailbox_connections');
const delAt = mint.indexOf('delete from retired_aliases');
t('and does so AFTER the insert that names the tag',
  insAt !== -1 && delAt !== -1 && delAt > insAt, insAt + ' vs ' + delAt);
// 0067's behaviour must survive the replacement, or applying this locks out
// the beta users or the already-connected ones.
t('the beta gate survives the replacement', /mailbox_not_in_beta/.test(mint));
t('and the pre-gate "already issued" return still comes first',
  mint.indexOf("'created',          false") < mint.indexOf('mailbox_not_in_beta'));
t('withdrawal is untouched by 0118', !/disconnect_my_mailbox/.test(
  mint.replace(/--[^\n]*/g, '')));

// ── 6. a quota trip DEGRADES, it does not kill every run ─────────────────
// The production symptom on 2026-09-04, after the held-mail backlog was already
// cleared: the work queue was EMPTY and the script still failed 1,440 times in
// a row, one alert email each. buildInboxQuery sits outside the per-message
// try/catch, and its cache timestamp is written only on success — so the first
// failure made the cache permanently stale and every later tick failed the same
// way, with the last good query sitting unread in Script Properties.
const biq2 = codeOnly(topLevelFn(gs, 'buildInboxQuery') || '');
t('the alias refresh is wrapped', /try \{[\s\S]{0,200}supabaseGet\('mailbox_connections'[\s\S]{0,200}catch/.test(biq2));
t('a failed refresh serves the stale cached query',
  /getProperty\(ALIAS_CACHE_PROP\)[\s\S]{0,300}return _wrapInboxQuery\(stale\)/.test(biq2));
// Never invent a query from nothing: with no cache there is genuinely nothing
// to serve, and guessing would search the whole mailbox.
t('but rethrows when there has never been a successful read', /if \(stale === null\) throw e;/.test(biq2));
// The timestamp must NOT be restamped on the fallback path, or one outage
// would freeze the query for a full cache window past recovery.
t('and does not restamp the cache on the fallback path',
  !/ALIAS_CACHE_AT_PROP/.test(biq2.slice(biq2.indexOf('catch'), biq2.indexOf('return _wrapInboxQuery(stale)'))));
t('fresh and fallback paths return the SAME shape',
  (biq2.match(/_wrapInboxQuery\(/g) || []).length >= 2);

// The platform quota is not a Supabase failure and must not be labelled one.
const sf = codeOnly(topLevelFn(gs, '_supabaseFetch') || '');
t('the UrlFetch day cap gets its own token',
  /too many times for one day/i.test(sf) && /APPSCRIPT_QUOTA_URLFETCH/.test(sf));
t('and is classified BEFORE the generic SUPABASE_NET label',
  sf.indexOf('APPSCRIPT_QUOTA_URLFETCH') < sf.indexOf("'SUPABASE_NET: '"));
const proc2 = codeOnly(topLevelFn(gs, '_processEmailsLocked') || '');
t('a quota trip is transient, so mail is requeued not burned',
  /APPSCRIPT_QUOTA_/.test((proc2.match(/if \(\/\([^)]*\)\/\.test\(String\(err\)\)\)/) || [''])[0]));
t('and it ends the run rather than walking the batch into the same wall',
  /APPSCRIPT_QUOTA_URLFETCH[\s\S]{0,300}break threadLoop;/.test(proc2));

// ── 7. the paste marker moved ─────────────────────────────────────────────
// The .gs only reaches production by hand, so an unbumped version is how a fix
// silently stays un-deployed while the repo says it shipped.
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
