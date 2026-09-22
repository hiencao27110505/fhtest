#!/usr/bin/env node
/* The format store over mail_formats (email-reading-v2 §8.2; 0147).
 * `node pipeline/format-store.test.js`
 *
 * db.formats is the store readTransaction reads through, and formats.mjs
 * memoryFormatStore is its contract: a seed answers first; put refuses a key
 * a seed holds. Pinned here against the REAL createDb over a recording
 * PostgREST stand-in, so the URLs and verbs are the ones production sends:
 *   1. get: seed first, then the row, fetched ONCE per handle (one run)
 *   2. hits bumped once per run, fire-and-forget, never on a seed
 *   3. put: false and no request for a seed's key; an upsert with source and
 *      reader_build otherwise; NO write when the row already holds the same
 *      format (jsonb reorders keys, so the comparison is canonical)
 *   4. providerHasAny: seeds in code, then one row read, cached per provider
 *   5. the dry run's proxy: get is a read, put is a would-write
 *   6. the fingerprint reads select the 0147 columns; the grant reads reader_v
 */
let pass = 0, fail = 0;
const t = (n, ok, d) => { console.log((ok ? '  PASS  ' : '  FAIL  ') + n + (!ok && d !== undefined ? '  -> ' + JSON.stringify(d) : '')); ok ? pass++ : fail++; };
const FN = new URL('../supabase/functions/', import.meta.url);
const DB = await import(new URL('_shared/mailbox/db.mjs', FN));
const F  = await import(new URL('_shared/mailbox/formats.mjs', FN));
const D  = await import(new URL('mailbox-dryrun/dry-db.mjs', FN));

/* A PostgREST stand-in with one mail_formats row. */
function server(rows) {
  const reqs = [];
  const fetchImpl = async (u, init) => {
    const method = String((init && init.method) || 'GET').toUpperCase();
    const url = new URL(String(u));
    reqs.push({ method, path: url.pathname, q: Object.fromEntries(url.searchParams), body: init && init.body ? JSON.parse(init.body) : null });
    let out = [];
    if (method === 'GET' && url.pathname.endsWith('/mail_formats')) {
      const p = (url.searchParams.get('provider') || '').replace(/^eq\./, '');
      const sg = (url.searchParams.get('sig') || '').replace(/^eq\./, '');
      out = rows.filter((r) => r.provider === p && (!sg || r.sig === sg));
    }
    return { ok: true, status: 200, headers: { get: () => '0-0/0' }, text: async () => JSON.stringify(out), json: async () => out };
  };
  return { reqs, fetchImpl, writes: () => reqs.filter((r) => r.method !== 'GET' && r.method !== 'HEAD') };
}
const learned = { v: 1, source: 'table', provider: 'ACB', sig: 'sig-learned', labels: ['a', 'b', 'c'], map: { a: 'amount', b: 'occurred_at', c: 'merchant' }, parse: { amount: 'vnd' }, facts: {}, direction: null, signal: null, signal_subject: null };
const seed = (await F.seedFormats())[0];

console.log('\n-- 1. get: seed first, then the row, once per handle --');
{
  const srv = server([{ provider: 'ACB', sig: 'sig-learned', format: { ...learned, map: { c: 'merchant', b: 'occurred_at', a: 'amount' } }, source: 'table', hits: 4 }]);
  const db = DB.createDb('https://db.example', 'key', srv.fetchImpl, { readerBuild: 'b1' });
  const s = await db.formats.get(seed.provider, seed.sig);
  t('a seed answers, and costs no request', s && s.id === seed.id && srv.reqs.length === 0, srv.reqs);
  const a = await db.formats.get('ACB', 'sig-learned');
  const b = await db.formats.get('ACB', 'sig-learned');
  t('a learned row answers with its format', a && a.map && a.map.a === 'amount' && b === a, a);
  const gets = srv.reqs.filter((r) => r.method === 'GET');
  t('fetched ONCE for the two gets', gets.length === 1 && gets[0].q.provider === 'eq.ACB' && gets[0].q.sig === 'eq.sig-learned', gets);
  const miss = await db.formats.get('ACB', 'nope');
  const miss2 = await db.formats.get('ACB', 'nope');
  t('a miss is null, and remembered', miss === null && miss2 === null && srv.reqs.filter((r) => r.method === 'GET').length === 2);
  await new Promise((r) => setTimeout(r, 5));
  const bumps = srv.writes();
  t('hits bumped once, +1 on what the row held, by PATCH', bumps.length === 1 && bumps[0].method === 'PATCH' && bumps[0].body.hits === 5 && bumps[0].q.provider === 'eq.ACB', bumps);
  t('...and the bump touches nothing else (updated_at means "changed", not "seen")', Object.keys(bumps[0].body).join() === 'hits', bumps[0].body);
}

console.log('\n-- 2. put --');
{
  const srv = server([{ provider: 'ACB', sig: 'sig-learned', format: { ...learned, map: { c: 'merchant', b: 'occurred_at', a: 'amount' } }, source: 'table', hits: 0 }]);
  const db = DB.createDb('https://db.example', 'key', srv.fetchImpl, { readerBuild: 'b1' });
  const kept = await db.formats.put({ ...learned, provider: seed.provider, sig: seed.sig });
  t('a seed\'s key is refused: false, and no request at all', kept === false && srv.reqs.length === 0, srv.reqs);
  t('a seed itself is refused', (await db.formats.put(seed)) === false && srv.reqs.length === 0);
  const same = await db.formats.put(learned);
  await new Promise((r) => setTimeout(r, 5));
  t('an identical format already stored (keys in jsonb order): true, ONE read, NO write', same === true && srv.writes().length === 0, srv.reqs);
  const changed = { ...learned, map: { ...learned.map, c: 'counterparty' } };
  const ok = await db.formats.put(changed);
  const w = srv.writes();
  t('a changed format is upserted on (provider, sig)', ok === true && w.length === 1 && w[0].method === 'POST' && w[0].q.on_conflict === 'provider,sig', w);
  t('...with source from the format, the build, and updated_at', w[0].body.source === 'table' && w[0].body.reader_build === 'b1' && typeof w[0].body.updated_at === 'string' && w[0].body.format.map.c === 'counterparty', w[0].body);
  t('...never hits or created_at (the row keeps its own)', !('hits' in w[0].body) && !('created_at' in w[0].body), Object.keys(w[0].body));
  t('and the next get answers the new one without a request', (await db.formats.get('ACB', 'sig-learned')).map.c === 'counterparty' && srv.reqs.filter((r) => r.method === 'GET').length === 1);
  const m = await db.formats.put({ ...learned, sig: 'sig-model', source: 'model' });
  t('a model-taught format writes source model', m === true && srv.writes().slice(-1)[0].body.source === 'model');
}

console.log('\n-- 3. providerHasAny --');
{
  const srv = server([{ provider: 'ACB', sig: 'sig-learned', format: learned, source: 'table', hits: 0 }]);
  const db = DB.createDb('https://db.example', 'key', srv.fetchImpl);
  t('a seeded provider: true, no request', (await db.formats.providerHasAny(seed.provider)) === true && srv.reqs.length === 0);
  t('a provider with a learned row: true, one read', (await db.formats.providerHasAny('ACB')) === true && srv.reqs.length === 1 && srv.reqs[0].q.provider === 'eq.ACB' && srv.reqs[0].q.limit === '1', srv.reqs);
  t('an unknown provider: false', (await db.formats.providerHasAny('Nobody')) === false);
  await db.formats.providerHasAny('ACB'); await db.formats.providerHasAny('Nobody');
  t('cached per provider', srv.reqs.length === 2, srv.reqs.length);
}

console.log('\n-- 4. the dry run: get reads, put is counted, and it remembers for the run --');
{
  const srv = server([{ provider: 'ACB', sig: 'sig-learned', format: learned, source: 'table', hits: 0 }]);
  const real = DB.createDb('https://db.example', 'key', srv.fetchImpl, { readerBuild: 'b1' });
  const { db, wouldWrite } = D.dryDb(real);
  const g = await db.formats.get('ACB', 'sig-learned');
  await new Promise((r) => setTimeout(r, 5));
  t('get reaches the table and bumps nothing', g && g.map.a === 'amount' && srv.reqs.length === 1 && srv.writes().length === 0, srv.reqs);
  t('a seed still answers first', (await db.formats.get(seed.provider, seed.sig)).id === seed.id);
  const p = await db.formats.put({ ...learned, sig: 'sig-new' });
  t('put writes nothing and is counted', p === true && srv.writes().length === 0 && wouldWrite['formats.put'] === 1, wouldWrite);
  t('...but answers the next get of that key, for this run', (await db.formats.get('ACB', 'sig-new')).sig === 'sig-new' && (await db.formats.providerHasAny('ACB')) === true);
  t('parking and pause writes are would-writes with sane answers', (await db.recordMessageHold('g', 'm', 'r', 5)) === false && (await db.spendModelBudget('m', 'live', 1)) === true
    && wouldWrite.recordMessageHold === 1 && wouldWrite.spendModelBudget === 1 && srv.writes().length === 0, wouldWrite);
  await db.pauseModel('m', new Date(), 'x'); await db.clearMessageHold('g', 'm'); await db.releaseReaderGiveups('b');
  t('pauseModel, clearMessageHold, releaseReaderGiveups likewise', wouldWrite.pauseModel === 1 && wouldWrite.clearMessageHold === 1 && wouldWrite.releaseReaderGiveups === 1 && srv.writes().length === 0, wouldWrite);
}

console.log('\n-- 5. the columns the reader now depends on are selected --');
{
  const srv = server([]);
  const db = DB.createDb('https://db.example', 'key', srv.fetchImpl);
  await db.fingerprint('a@b.example', 'x'); await db.fingerprintsForSenders(['a@b.example']);
  t('fingerprint reads select model_reads and model_read_build', srv.reqs.slice(0, 2).every((r) => /model_reads,model_read_build/.test(r.q.select)), srv.reqs.map((r) => r.q.select));
  await db.dueGrants(1); await db.grantById('g'); await db.grantsByEmail('e', 'e');
  t('every grant read selects reader_v', srv.reqs.slice(2).every((r) => /,reader_v/.test(r.q.select)), srv.reqs.slice(2).map((r) => r.q.select));
  /* And the RPC wiring, by name, so the migrations can be checked against it. */
  db.recordMessageHold('g', 'm', 'why', 5, 'b1'); db.clearMessageHold('g', 'm'); db.parkedMessages('g', 20); db.abandonedMessages('g');
  db.releaseReaderGiveups('b1'); db.pauseModel('m', new Date(), 'quota_day'); db.spendModelBudget('m', 'live', 1); db.modelPausedUntil('m');
  await new Promise((r) => setTimeout(r, 5));
  const rpcs = srv.reqs.filter((r) => r.path.indexOf('/rpc/') >= 0).map((r) => r.path.replace(/.*\/rpc\//, ''));
  t('the RPCs: record_message_hold, clear_message_hold, parked_messages, abandoned_messages, release_reader_giveups, pause_model, spend_model_budget',
    ['record_message_hold', 'clear_message_hold', 'parked_messages', 'abandoned_messages', 'release_reader_giveups', 'pause_model', 'spend_model_budget'].every((n) => rpcs.includes(n)), rpcs);
  const hold = srv.reqs.find((r) => /record_message_hold/.test(r.path));
  const stamp = srv.reqs.find((r) => r.method === 'PATCH' && /mailbox_message_attempts/.test(r.path));
  t('record_message_hold carries p_grant, p_msg, p_reason, p_cap; the build is a follow-up PATCH on the row', hold && hold.body.p_cap === 5 && hold.body.p_reason === 'why' && stamp && stamp.body.reader_build === 'b1' && stamp.q.gmail_message_id === 'eq.m' && stamp.q.grant_id === 'eq.g', [hold && hold.body, stamp && stamp.body, stamp && stamp.q]);
  const pm = srv.reqs.find((r) => /model_pause$/.test(r.path));
  t('modelPausedUntil is a GET on model_pause for a future paused_until', pm && pm.method === 'GET' && /^gt\./.test(pm.q.paused_until), pm && pm.q);
}

console.log('\n' + (fail === 0 ? 'ALL ' + pass + ' PASSED' : pass + ' passed, ' + fail + ' FAILED'));
process.exit(fail ? 1 : 0);
