#!/usr/bin/env node
/* mailbox-dryrun is dry.
 * `node pipeline/dryrun-is-dry.test.js`
 *
 * It handed the REAL database handle to readTransaction and enrichCategory, so a
 * "dry" run wrote fingerprints, read tallies, miss labels, learned-label votes,
 * derive failures, merchant concepts and llm_calls rows into live tables shared
 * by every family (docs/specs/email-reading-v2-spec.md §15 fix 11).
 *
 * Pinned, against the REAL createDb over a recording fetch (so the list of
 * methods is db.mjs's own, not a copy that can fall behind):
 *   • through the proxy, NO method of db.mjs can issue a write request
 *   • every read still reaches the database
 *   • a real readTransaction + enrichCategory run writes nothing and reports
 *     what it would have written
 *   • what a run learns is remembered FOR THAT RUN (a second mail of the same
 *     shape does not pay the model again) and stored nowhere
 *   • modelCalls: missing means 0, not 20; non-numeric means 0 for extract AND
 *     classify (NaN used to let classify run with no budget at all)
 *   • index.ts really does route every handle through the proxy
 */
const fs = await import('node:fs');
const url = await import('node:url');
const HERE = url.fileURLToPath(new URL('.', import.meta.url));
const FN = HERE + '../supabase/functions/';
const D  = await import(FN + 'mailbox-dryrun/dry-db.mjs');
const DB = await import(FN + '_shared/mailbox/db.mjs');
const X  = await import(FN + '_shared/mailbox/extract.mjs');
const C  = await import(FN + '_shared/mailbox/classify.mjs');

let pass = 0, fail = 0;
const t = (n, ok, d) => { console.log((ok ? '  PASS  ' : '  FAIL  ') + n + (!ok && d !== undefined ? '  -> ' + JSON.stringify(d) : '')); ok ? pass++ : fail++; };

/** A PostgREST stand-in that records every request it is sent. */
function recorder() {
  const reqs = [];
  const fetchImpl = async (u, init) => {
    const method = String((init && init.method) || 'GET').toUpperCase();
    reqs.push({ method, path: String(u).replace(/^https?:\/\/[^/]+/, '').split('?')[0] });
    return { ok: true, status: 200, headers: { get: () => '0-0/0' }, text: async () => '[]', json: async () => [] };
  };
  return { reqs, fetchImpl };
}
/* A read is a GET or a HEAD. One read in db.mjs is an RPC, and an RPC is a POST
   whatever it does, so that one path is named. Everything else is a write. */
const READ_RPCS = ['/rest/v1/rpc/statement_sweep_list',
  // 0146 abandoned_messages and 0147 parked_messages are `stable` SELECTs
  '/rest/v1/rpc/parked_messages', '/rest/v1/rpc/abandoned_messages'];
const isWrite = (r) => !(r.method === 'GET' || r.method === 'HEAD' || (r.method === 'POST' && READ_RPCS.includes(r.path)));

console.log('\n-- every method db.mjs exports, called through the proxy --');
{
  const rec = recorder();
  const real = DB.createDb('https://db.example', 'service-key', rec.fetchImpl);
  const { db, wouldWrite } = D.dryDb(real);
  const names = Object.keys(real).filter((k) => typeof real[k] === 'function');
  t('db.mjs exports a real surface to walk', names.length >= 40, names.length);
  const ARGS = ['1', '2', '3', '4'];   // numeric-looking, so a read that does arithmetic on its argument still gets as far as its request
  for (const name of names) {
    const before = rec.reqs.length;
    try { await db[name](...ARGS); } catch { /* a read may dislike dummy arguments; only the REQUESTS matter */ }
    const made = rec.reqs.slice(before);
    const wrote = made.filter(isWrite);
    if (wrote.length) t(name + ' writes through the proxy', false, wrote);
    if (D.DRY_READS.has(name) && made.length === 0 && !['alreadyStaged', 'stagedState', 'statementKnown', 'fingerprintsForSenders'].includes(name)) {
      t(name + ' is listed as a read but never reached the database', false);
    }
  }
  t('NOT ONE write request reached the database', rec.reqs.filter(isWrite).length === 0, rec.reqs.filter(isWrite));
  t('reads did reach it', rec.reqs.length > 10, rec.reqs.length);
  const blocked = names.filter((n) => !D.DRY_READS.has(n));
  t('every non-read method was counted in wouldWrite', blocked.every((n) => wouldWrite[n] >= 1), blocked.filter((n) => !wouldWrite[n]));
  t('the raw request helpers are blocked too (they can carry any verb)', wouldWrite.rest >= 1 && wouldWrite.rpc >= 1, wouldWrite);
  t('every name in the read list exists in db.mjs (no stale entry)', [...D.DRY_READS].every((n) => names.includes(n)), [...D.DRY_READS].filter((n) => !names.includes(n)));

  /* The other direction: called on the REAL handle, the blocked methods DO
     write. This is what proves the walk above can see a write at all. */
  const rec2 = recorder();
  const real2 = DB.createDb('https://db.example', 'service-key', rec2.fetchImpl);
  for (const name of ['saveFingerprint', 'bumpReadTally', 'logMissLabels', 'recordLearnedLabel', 'recordDeriveFailure', 'merchantConceptPut', 'recordLlmCall', 'insertStaged', 'recordFailure', 'markSynced']) {
    const before = rec2.reqs.length;
    try { await real2[name]({ sender_address: 'a', subject_template: 'b' }, ['Some label'], 'c', 'd'); } catch { /* shape of args is not the point */ }
    t('(control) the real ' + name + ' issues a write', rec2.reqs.slice(before).some(isWrite), rec2.reqs.slice(before));
  }
}

console.log('\n-- a real read, through the proxy: nothing written, everything reported --');
{
  const rec = recorder();
  const { db, wouldWrite } = D.dryDb(DB.createDb('https://db.example', 'service-key', rec.fetchImpl));
  let modelCalls = 0;
  const answer = { is_transaction: true, transaction_type: 'ecommerce_receipt', source_provider: 'ZQ', occurred_at: '2026-09-20T08:15:00+07:00',
    amount: 150000, currency: 'VND', direction: 'debit', counterparty: 'ZQ OPAQUE TRADING', reference_number: null, account_masked: null, memo: null };
  const llmFetch = async () => { modelCalls++; return { ok: true, status: 200,
    text: async () => JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(modelCalls === 1 || modelCalls === 3 ? answer : { node: null, concept: 'Others', pool: null }) }] } }] }) }; };
  const llm = { apiKey: 'k', logLlm: (r) => db.recordLlmCall(r) };
  const mail = (amt, when) => ({ from: 'ZQ <card@zqbank.example>', subject: 'Thong bao giao dich the',
    body: 'Quy khach vua giao dich.\nGia tri: ' + amt + ' VND\nVao luc: ' + when + '\nDia diem: ZQ OPAQUE TRADING' });
  const budget = (() => { let u = 0; return { spend: () => (u < 5 ? (u++, true) : false), used: () => u, left: () => 5 - u }; })();

  const r1 = await X.readTransaction(mail('150,000', '20/09/2026 08:15'), db, { llm, fetch: llmFetch, budget, fingerprints: null });
  t('the first mail is read by the model', r1.ok && r1.stage === 'llm' && modelCalls === 1, { stage: r1.stage, modelCalls });
  await C.enrichCategory(r1.extraction, { user_id: 'u1' }, { db, llm, fetch: llmFetch, subtle: globalThis.crypto.subtle, classifyBudget: { left: 5 } });
  t('its merchant is classified by the model', modelCalls === 2 && r1.extraction.category === 'Others', { modelCalls, category: r1.extraction.category });

  const r2 = await X.readTransaction(mail('92,500', '21/09/2026 10:00'), db, { llm, fetch: llmFetch, budget, fingerprints: null });
  t('the second mail of the shape is read by the template learned IN THIS RUN', r2.ok && r2.stage === 'template' && r2.extraction.amount === 92500 && modelCalls === 2, { stage: r2.stage, modelCalls });
  await C.enrichCategory(r2.extraction, { user_id: 'u1' }, { db, llm, fetch: llmFetch, subtle: globalThis.crypto.subtle, classifyBudget: { left: 5 } });
  t('and its merchant answered from the concept remembered in this run', modelCalls === 2 && r2.extraction.category === 'Others', modelCalls);

  t('NOT ONE write request reached the database', rec.reqs.filter(isWrite).length === 0, rec.reqs.filter(isWrite));
  t('the reads did (fingerprint lookups, the merchant cache)', rec.reqs.some((r) => /sender_fingerprints/.test(r.path)) && rec.reqs.some((r) => /merchant_concepts/.test(r.path)), rec.reqs.map((r) => r.path));
  t('wouldWrite names the fingerprint it would have saved', wouldWrite.saveFingerprint === 1, wouldWrite);
  t('...the tallies', wouldWrite.bumpReadTally >= 3, wouldWrite);
  t('...the merchant concept', wouldWrite.merchantConceptPut === 1, wouldWrite);
  t('...and the llm_calls rows, one per real model call', wouldWrite.recordLlmCall === 2, wouldWrite);
  t('wouldWrite is counts only: no mail text in it', Object.values(wouldWrite).every((v) => typeof v === 'number') && !/ZQ|giao dich/.test(JSON.stringify(wouldWrite)));
}

console.log('\n-- a second run starts from nothing: what the first learned was stored nowhere --');
{
  const rec = recorder();
  const { db } = D.dryDb(DB.createDb('https://db.example', 'service-key', rec.fetchImpl));
  t('no fingerprint', await db.fingerprint('card@zqbank.example', 'Thong bao giao dich the') === null);
  t('an optional method the real handle lacks stays absent through the proxy', D.dryDb({ fingerprint: async () => null }).db.recordDeriveFailure === undefined);
}

console.log('\n-- modelCalls: missing or nonsense means ZERO, for both budgets --');
t('missing → 0 (it used to be 20)', D.parseModelCalls(undefined) === 0);
t('null → 0', D.parseModelCalls(null) === 0);
t('"abc" → 0 (NaN used to leave classify unbudgeted)', D.parseModelCalls('abc') === 0);
t('NaN, Infinity, an object, an array, true → 0', [NaN, Infinity, {}, [5], true].every((v) => D.parseModelCalls(v) === 0));
t('"" → 0', D.parseModelCalls('') === 0 && D.parseModelCalls('   ') === 0);
t('15 → 15, "15" → 15', D.parseModelCalls(15) === 15 && D.parseModelCalls('15') === 15);
t('capped at 40, floored at 0, whole numbers only', D.parseModelCalls(999) === 40 && D.parseModelCalls(-3) === 0 && D.parseModelCalls(7.9) === 7);
{
  /* The value feeds TWO budgets; zero must close both. */
  const n = D.parseModelCalls('abc');
  const rec = recorder();
  const { db } = D.dryDb(DB.createDb('https://db.example', 'service-key', rec.fetchImpl));
  let asked = 0;
  const x = { transaction_type: 'ecommerce_receipt', counterparty: 'ZQ OPAQUE TRADING', memo: null, category: null };
  await C.enrichCategory(x, { user_id: 'u1' }, { db, llm: { apiKey: 'k' }, subtle: globalThis.crypto.subtle, classifyBudget: { left: n },
    fetch: async () => { asked++; return { ok: true, status: 200, text: async () => '{}' }; } });
  t('classify makes no call on a non-numeric modelCalls', asked === 0, asked);
  let used = 0; const bud = { spend: () => (used < n ? (used++, true) : false) };
  let threw = false;
  try { await X.readTransaction({ from: 'ZQ <card@zqbank.example>', subject: 'x', body: 'khong co gi' }, db, { llm: { apiKey: 'k' }, budget: bud, fetch: async () => { asked++; throw new Error('no'); } }); } catch { threw = true; }
  t('nor does extract: it holds', threw && asked === 0, { threw, asked });
}

console.log('\n-- index.ts is wired to it --');
{
  const src = fs.readFileSync(FN + 'mailbox-dryrun/index.ts', 'utf8');
  t('imports the proxy and the parser', /import \{ dryDb, parseModelCalls \} from "\.\/dry-db\.mjs";/.test(src));
  t('createDb is called exactly once, INSIDE dryDb(...): the real handle is never named', (src.match(/createDb\(/g) || []).length === 1 && /dryDb\(createDb\(/.test(src));
  t('modelCalls goes through parseModelCalls', /const modelCalls = parseModelCalls\(body\.modelCalls\);/.test(src) && !/modelCalls \?\? 20/.test(src));
  t('the reply carries wouldWrite', /wouldWrite: dry\.wouldWrite/.test(src));
  t('the secret gate is still there, unchanged', /timingSafeEqual\(offered, expected\)/.test(src) && /x-sync-secret/.test(src) && /MAILBOX_SYNC_SECRET/.test(src));
}

console.log('\n' + (fail === 0 ? 'ALL ' + pass + ' PASSED' : pass + ' passed, ' + fail + ' FAILED'));
process.exit(fail ? 1 : 0);
