#!/usr/bin/env node
/* A statement's merchants, categorised in ONE model call.
 * `node pipeline/merchant-concepts-batch.test.js`
 *
 * The project runs on the Gemini free tier, so what this pins is mostly cost:
 * the free tiers answer first, the model is asked once for everything left, every
 * answer (including "cannot tell") is cached for every user, and a rate-limited
 * model is "not tried" -- never cached as "unknowable".
 * (docs/specs/statement-capture-spec.md section 11 and 13)
 */
const crypto = await import('node:crypto').then(m => m.default || m);
const url = await import('node:url');
const HERE = url.fileURLToPath(new URL('.', import.meta.url));
const C = await import(HERE + '../supabase/functions/_shared/mailbox/classify.mjs');

let pass = 0, fail = 0;
const t = (n, ok, d) => { console.log((ok ? '  PASS  ' : '  FAIL  ') + n + (!ok && d !== undefined ? '  -> ' + JSON.stringify(d) : '')); ok ? pass++ : fail++; };
const subtle = crypto.webcrypto.subtle;
const hashOf = async (name) => C.hashKey(C.merchantKey(name, ''), subtle);

function makeCtx(opts) {
  opts = opts || {};
  const store = { cache: new Map(opts.cache || []), corrections: new Map(opts.corrections || []), calls: [], puts: [] };
  return { store, subtle, llm: { apiKey: opts.noKey ? null : 'k' },
    db: {
      async merchantCorrectionGet(uid, hash) { return store.corrections.get(uid + '|' + hash) || null; },
      async merchantConceptGet(hash) { return store.cache.has(hash) ? store.cache.get(hash) : null; },
      async merchantConceptPut(hash, concept, pool) { store.puts.push({ hash, concept, pool }); store.cache.set(hash, { concept, pool }); },
    },
    fetch: async (u, init) => {
      const asked = JSON.parse(init.body).contents[0].parts[0].text;
      store.calls.push(asked);
      if (opts.limited) return { ok: false, status: 429, json: async () => ({}), text: async () => '{"error":{"code":429}}' };
      const items = asked.split('\n').map((line) => {
        const i = parseInt(line, 10);
        return { i, concept: /ZQ BETA/.test(line) ? 'Others' : /ZQ ALPHA/.test(line) ? 'Dining' : null, pool: null };
      });
      const body = { candidates: [{ content: { parts: [{ text: JSON.stringify({ items }) }] } }] };
      return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) };
    } };
}

console.log('\n-- the free tiers answer first --');
var ctx = makeCtx({ corrections: [['u1|' + await hashOf('REVI COFFEE'), 'Dining']], cache: [[await hashOf('DONG TAY BARBER'), { concept: 'Others', pool: null }], [await hashOf('QX77 PAYGATE'), { concept: null, pool: null }]] });
var out = await C.conceptsForMerchants(['REVI COFFEE', 'HIGHLANDS COFFEE', 'DONG TAY BARBER', 'QX77 PAYGATE'], 'u1', ctx);
t('the person\'s own correction wins', out.concepts['REVI COFFEE'] === 'Dining');
t('the curated dictionary needs no model', out.concepts['HIGHLANDS COFFEE'] === 'Dining', out.concepts);
t('the shared cache answers', out.concepts['DONG TAY BARBER'] === 'Others');
t('a cached "cannot tell" is an answer too: null, and NOT re-asked', out.concepts['QX77 PAYGATE'] === null && ctx.store.calls.length === 0, ctx.store.calls.length);

console.log('\n-- everything left rides ONE call --');
ctx = makeCtx({});
out = await C.conceptsForMerchants(['ZQ ALPHA 1', 'ZQ BETA 2', 'ZZ OPAQUE 1', 'ZQ ALPHA 1', '  '], 'u1', ctx);
t('one model call for three unknown merchants', ctx.store.calls.length === 1 && out.asked === 3, { calls: ctx.store.calls.length, asked: out.asked });
t('duplicates and blanks are dropped before anything is sent', out.total === 3 && !/ {2}/.test(ctx.store.calls[0]));
t('answers mapped back by position', out.concepts['ZQ ALPHA 1'] === 'Dining' && out.concepts['ZQ BETA 2'] === 'Others' && out.concepts['ZZ OPAQUE 1'] === null, out.concepts);
t('every answer cached, the "cannot tell" included', ctx.store.puts.length === 3 && ctx.store.puts.some(p => p.concept === null));
t('only names reach the model: no digits-only lines, no amounts', ctx.store.calls[0].split('\n').every(l => /^\d+\. \S/.test(l)));
var again = await C.conceptsForMerchants(['ZQ ALPHA 1', 'ZZ OPAQUE 1'], 'u2', ctx);
t('a second user asking the same merchants costs nothing', ctx.store.calls.length === 1 && again.concepts['ZQ ALPHA 1'] === 'Dining');

console.log('\n-- a limit slows, never poisons --');
ctx = makeCtx({ limited: true });
out = await C.conceptsForMerchants(['ZQ ALPHA 1', 'ZQ BETA 2'], 'u1', ctx);
t('rate-limited: nulls and limited=true', out.limited === true && out.concepts['ZQ ALPHA 1'] === null);
t('...and NOTHING cached, so the next statement asks again', ctx.store.puts.length === 0);
ctx = makeCtx({ noKey: true });
out = await C.conceptsForMerchants(['ZQ ALPHA 1'], 'u1', ctx);
t('no model key: same, not tried and not cached', out.limited === true && ctx.store.puts.length === 0 && ctx.store.calls.length === 0);
var many = []; for (let i = 0; i < 100; i++) many.push('MERCHANT ABCD' + String.fromCharCode(65 + (i % 26)) + String.fromCharCode(65 + Math.floor(i / 26)));
ctx = makeCtx({});
out = await C.conceptsForMerchants(many, 'u1', ctx);
t('at most ' + C.BATCH_MAX + ' names accepted, at most ' + C.BATCH_MODEL_MAX + ' sent', out.total === C.BATCH_MAX && out.asked === C.BATCH_MODEL_MAX && ctx.store.calls.length === 1, { total: out.total, asked: out.asked });

console.log('\n' + (fail ? fail + ' FAILED, ' : 'ALL ') + pass + ' PASSED');
process.exit(fail ? 1 : 0);
