#!/usr/bin/env node
/* The work that ran in production 15-20/09, was never committed, and was
 * overwritten by a deploy from `main`. Re-landed 2026-09-21 from
 * docs/archive/mailbox-sync-live-v49/. `node pipeline/relanded-live-work.test.js`
 *
 * Its own tests were lost with the session that wrote it, which is half of how
 * it got lost: nothing in the suite failed when it disappeared. These drive the
 * real modules, because a line-matching test would have passed on the day the
 * behaviour vanished.
 *   1. a shape learned mid-run reaches the next message  (162 Gemini calls for
 *      25 shapes on 2026-09-15, against a 20-per-minute free-tier wall)
 *   2. a month in the subject is not a new shape          (every statement sender
 *      relearned itself monthly), without orphaning what was already learned
 *   3. one reader per mailbox                             (41 Gmail 403s in six hours)
 *   4. learned sender skips ride in the Gmail query       (the only free skip)
 */
let pass = 0, fail = 0;
const t = (n, ok, d) => { console.log((ok ? '  PASS  ' : '  FAIL  ') + n + (!ok && d !== undefined ? '  -> ' + JSON.stringify(d) : '')); ok ? pass++ : fail++; };
const SEP = String.fromCharCode(0);   // the separator extract.mjs keys its cache with

(async () => {
const X = await import('../supabase/functions/_shared/mailbox/extract.mjs');
const S = await import('../supabase/functions/_shared/mailbox/senders.mjs');
const W = await import('../supabase/functions/_shared/mailbox/worker.mjs');

console.log('\n-- 1. a shape learned on this message reaches the next one --');
{
  let modelCalls = 0;
  const deps = () => ({
    llm: { apiKey: 'test-key' },
    fetch: async () => { modelCalls++; return { ok: true, text: async () => JSON.stringify({
      candidates: [{ content: { parts: [{ text: JSON.stringify({ is_transaction: false }) }] } }] }) }; },
  });
  const table = new Map();
  const db = {
    fingerprint: async (s, tpl) => table.get(s + SEP + tpl) || null,
    saveFingerprint: async (row) => { table.set(row.sender_address + SEP + row.subject_template, row); },
  };
  const mail = (n) => ({ from: 'Shop <news@shop.example>', subject: 'Uu dai cuoi tuan danh cho ban', body: 'Giam gia ' + n + '% tat ca san pham. Xem ngay.' });
  /* The worker warms ONE map per run and hands the same map to every message. */
  const warm = new Map();
  await X.readTransaction(mail(10), db, { ...deps(), fingerprints: warm });
  const afterFirst = modelCalls;
  await X.readTransaction(mail(20), db, { ...deps(), fingerprints: warm });
  await X.readTransaction(mail(30), db, { ...deps(), fingerprints: warm });
  t('the first mail of an unknown shape pays for one model call', afterFirst === 1, afterFirst);
  t('...and the next two of the same shape, in the same run, pay for none', modelCalls === 1, modelCalls);
  t('the verdict was still written to the table: one source of truth', table.size >= 1, table.size);
  t('the caller\'s db object is not mutated by the write-through', db._warmThrough === undefined);
}

console.log('\n-- 2. a month in the subject is not a new shape --');
{
  const a = X.normalizeSubjectTemplate('Bang sao ke tai khoan ky 09/2026');
  const b = X.normalizeSubjectTemplate('Bang sao ke tai khoan ky 10/2026');
  t('September\'s and October\'s statement mail are one template', a === b, [a, b]);
  t('"tháng 9/2026" and "tháng 10/2026" likewise', X.normalizeSubjectTemplate('Sao kê thẻ tháng 9/2026') === X.normalizeSubjectTemplate('Sao kê thẻ tháng 10/2026'));
  t('a subject with no month reads the same under both keys', X.normalizeSubjectTemplate('Thong bao giao dich') === X.legacySubjectTemplate('Thong bao giao dich'));
  /* The key changed, so a row learned under the OLD key must still answer, or
     every backfill stalls behind a cache that just went cold (the b0d5fdd lesson). */
  const subject = 'Bang sao ke tai khoan ky 09/2026';
  const legacyKey = 'bank@vib.example' + SEP + X.legacySubjectTemplate(subject);
  t('the old key really is different, so the fallback has something to do', X.legacySubjectTemplate(subject) !== X.normalizeSubjectTemplate(subject));
  let modelCalls = 0; const queried = [];
  const learned = { sender_address: 'bank@vib.example', subject_template: X.legacySubjectTemplate(subject), is_transaction_source: false, transaction_type: null, extraction_regex: null };
  const db = { fingerprint: async (s, tpl) => { queried.push(tpl); return (s + SEP + tpl) === legacyKey ? learned : null; }, saveFingerprint: async () => {} };
  const deps = { llm: { apiKey: 'k' }, fetch: async () => { modelCalls++; return { ok: true, text: async () => '{}' }; } };
  await X.readTransaction({ from: 'VIB <bank@vib.example>', subject: subject, body: 'x' }, db, deps);
  t('a row learned under the old key still answers by query, with no model call', modelCalls === 0 && queried.length === 2, { modelCalls, queried });
  modelCalls = 0;
  await X.readTransaction({ from: 'VIB <bank@vib.example>', subject: subject, body: 'x' }, db, { ...deps, fingerprints: new Map([[legacyKey, learned]]) });
  t('...and from the warm map', modelCalls === 0, modelCalls);
}

console.log('\n-- 3. one reader per mailbox --');
{
  const grant = { id: 'g1', user_id: 'u1', member_id: 'm1', family_id: 'f1', email: 'me@gmail.com', needs_reauth: false,
    refresh_token_enc: 'x', last_synced_at: null, backfilled_at: null, backfill_days: 30, default_scope: 'family' };
  const mk = (lease) => {
    const calls = [];
    const db = { calls,
      async memberById() { calls.push('read'); return null; },      // the first thing a real read does; null ends it early
      async markNeedsReauth() {}, async recordFailure() {}, async markSynced() {} };
    if (lease !== 'absent') {
      db.takeMailboxLease = async (id, ttl) => { calls.push('take:' + ttl); if (lease === 'throws') throw new Error('rpc missing'); return lease; };
      db.releaseMailboxLease = async (id, l) => { calls.push('release:' + l); };
    }
    return db;
  };
  const ctx = (db) => ({ db, fetch: async () => { throw new Error('no network'); } });
  const run = async (db) => { try { return await W.runGrant(grant, ctx(db)); } catch (e) { return { status: 'threw' }; } };

  let db = mk(null); let r = await run(db);
  t('a second reader is told "busy" at once', r.status === 'busy', r.status);
  t('...having read nothing and spent nothing', db.calls.indexOf('read') < 0 && r.fetched === 0 && r.staged === 0, db.calls);
  t('...and releases nothing, because it holds nothing', !db.calls.some((c) => c.startsWith('release')), db.calls);

  db = mk('lease-1'); r = await run(db);
  t('the holder reads', db.calls.indexOf('read') >= 0 && r.status !== 'busy', [db.calls, r.status]);
  t('and hands the SAME lease back when it is done, however the run ended', db.calls[db.calls.length - 1] === 'release:lease-1', db.calls);
  t('the lease is short: a crashed holder blocks a mailbox for about a minute and a half, not for good', db.calls[0] === 'take:' + W.LEASE_TTL_S && W.LEASE_TTL_S <= 120, db.calls[0]);

  db = mk('throws'); r = await run(db);
  t('THE LEASE IS NEVER WHY A MAILBOX GOES UNREAD: a broken lease call reads as before', db.calls.indexOf('read') >= 0 && r.status !== 'busy', [db.calls, r.status]);

  db = mk('absent'); r = await run(db);
  t('a database that offers no lease reads exactly as before', db.calls.indexOf('read') >= 0 && r.status !== 'busy', [db.calls, r.status]);
}

console.log('\n-- 4. learned sender skips ride in the Gmail query --');
{
  const base = S.inboxQuery(30, []);
  t('no skips: the query is what it always was', S.inboxQuery(30, [], { skip: [] }) === base && S.inboxQuery(30, [], undefined) === base);
  const q = S.inboxQuery(30, [], { skip: ['News@Shop.Example', 'news@shop.example', ' promo@x.example '] });
  t('a learned sender is excluded in the query itself, so it is never listed or fetched', q.indexOf(' -from:news@shop.example') >= 0 && q.indexOf(' -from:promo@x.example') >= 0, q);
  t('...once, however it was spelled', q.split('-from:news@shop.example').length === 2, q);
  const bad = S.inboxQuery(30, [], { skip: ['two words@x.example', 'quo"te@x.example', '', null] });
  t('an address that would break the query is dropped, not sent', bad === base, bad);
  const many = Array.from({ length: 200 }, (_, i) => 'n' + i + '@x.example');
  const capped = S.inboxQuery(30, [], { skip: many });
  const own = (base.match(/ -from:/g) || []).length;      // the query excludes a few senders of its own
  t('the query is a URL: one noisy mailbox cannot grow it without bound', (capped.match(/ -from:/g) || []).length - own === S.SKIP_MAX && S.SKIP_MAX <= 40, (capped.match(/ -from:/g) || []).length - own);
  t('the window still closes the query', /newer_than:30d$/.test(capped));
}

console.log('\n' + (fail === 0 ? 'ALL ' + pass + ' PASSED' : pass + ' passed, ' + fail + ' FAILED'));
process.exit(fail ? 1 : 0);
})();
