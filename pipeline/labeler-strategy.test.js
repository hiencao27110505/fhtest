#!/usr/bin/env node
/* The labeling lane's strategy seam: Gemini or Jev, chosen by configuration.
 * `node pipeline/labeler-strategy.test.js`
 *
 * Pins (supabase/functions/_shared/mailbox/labelers/):
 *   • default is gemini; LABELER=jev or jev,gemini picks the order; an unknown name
 *     asks nobody (a typo must not route family data to a service nobody chose)
 *   • fallback fires only on "could not ask", never on a real "cannot tell"
 *   • Jev's probabilities become a node by subtree mass: leaf when sure, group
 *     when split inside it, null when spread or on "unknown"
 *   • a Jev 429/529 is "not tried": nothing cached, rate_limited logged
 *   • the statement Noul leans to yes; the request carries only what Gemini's does
 *   • Jev is sent merchant NAMES only, the same as Gemini (classify-consent)
 */
let called = 0, r;
const url = await import('node:url');
const crypto = await import('node:crypto').then(m => m.default || m);
const HERE = url.fileURLToPath(new URL('.', import.meta.url));
const M = HERE + '../supabase/functions/_shared/mailbox/';
const L = await import(M + 'labelers/index.mjs');
const J = await import(M + 'labelers/jev.mjs');
const C = await import(M + 'classify.mjs');
const S = await import(M + 'statement.mjs');

let pass = 0, fail = 0;
const t = (n, ok, d) => { console.log((ok ? '  PASS  ' : '  FAIL  ') + n + (!ok && d !== undefined ? '  -> ' + JSON.stringify(d) : '')); ok ? pass++ : fail++; };

const res = (status, body) => ({ ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(body), json: async () => body });

/* A fake Jev: answers every node_j / concept_j question with `probs(line)`. */
function fakeJev(opts) {
  const calls = [];
  const fetch = async (u, init) => {
    const body = JSON.parse(init.body);
    calls.push({ url: u, headers: init.headers, body });
    if (opts.status) return res(opts.status, { detail: 'slow down' });
    const answers = {};
    for (const [name, q] of Object.entries(body.questions)) {
      if (q.type === 'noul') { answers[name] = { type: 'noul', noul: opts.noul }; continue; }
      const probs = opts.probs(name, q);
      const choice = Object.entries(probs).sort((a, b) => b[1] - a[1])[0][0];
      answers[name] = { type: 'choice', choice, confidence: 0.5, probabilities: probs };
    }
    return res(200, { model: body.model, answers, usage: { input_tokens: 1200, output_tokens: 3 } });
  };
  return { fetch, calls };
}
const geminiFetch = (answerObj, calls) => async (u, init) => {
  calls && calls.push({ url: u, body: JSON.parse(init.body) });
  const body = { candidates: [{ content: { parts: [{ text: JSON.stringify(answerObj) }] } }] };
  return res(200, body);
};

console.log('\n-- selection --');
t('default is gemini', L.labelerName({}, 'classify_merchant') === 'gemini');
t('LABELER picks the lane', L.labelerName({ labeler: 'jev' }, 'classify_merchant') === 'jev');
t('a list is an order', L.labelerChain({ labeler: ' Jev , gemini ' }).join() === 'jev,gemini');
t('duplicates collapse', L.labelerChain({ labeler: 'jev,jev' }).join() === 'jev');
const fromEnv = L.labelerCfgFromEnv((k) => ({ LABELER: 'jev,gemini', JEV_API_KEY: 'jk' })[k]);
t('env → cfg: just two names', fromEnv.labeler === 'jev,gemini' && fromEnv.jev.apiKey === 'jk' && Object.keys(fromEnv).join() === 'labeler,jev', fromEnv);
t('empty env = gemini', L.labelerName(L.labelerCfgFromEnv(() => '')) === 'gemini');
called = 0;
r = await C.classifyMerchant('HIGHLANDS', { labeler: 'jevv,gemini', apiKey: 'g' }, async () => { called++; return res(200, {}); });
t('an unknown FIRST name asks nobody, not even the fallback', r.ok === false && called === 0);

called = 0;
r = await C.classifyMerchant('HIGHLANDS', { labeler: 'jevv', apiKey: 'g', jev: { apiKey: 'j' } }, async () => { called++; return res(200, {}); });
t('an unknown labeler name asks nobody', r.ok === false && called === 0);

console.log('\n-- gemini unchanged by default --');
var gcalls = [];
r = await C.classifyMerchant('HIGHLANDS', { apiKey: 'g', jev: { apiKey: 'j' } }, geminiFetch({ node: 'coffee', concept: null, pool: null }, gcalls));
t('a jev key alone does not switch provider', gcalls.length === 1 && /generativelanguage/.test(gcalls[0].url) && r.node === 'coffee', r);

console.log('\n-- jev: probabilities to a node --');
t('a sure leaf answers the leaf', J.resolveNode({ coffee: 0.9, milktea: 0.05, unknown: 0.05 }, 0.5) === 'coffee');
t('split inside a group answers the group', J.resolveNode({ coffee: 0.35, milktea: 0.35, unknown: 0.3 }, 0.5) === 'drinks');
t('mass on unknown answers null', J.resolveNode({ coffee: 0.1, unknown: 0.9 }, 0.5) === null);
t('spread thin answers null', J.resolveNode({ coffee: 0.2, fuel: 0.2, electric: 0.2, unknown: 0.4 }, 0.5) === null);
t('codes outside the menu are ignored', J.resolveNode({ wage: 0.95 }, 0.5) === null);

var jv = fakeJev({ probs: (name) => name.startsWith('node_') ? { coffee: 0.92, unknown: 0.08 } : { Dining: 0.9, unknown: 0.1 } });
var logs = [];
r = await C.classifyMerchant('HIGHLANDS COFFEE', { labeler: 'jev', jev: { apiKey: 'jk' }, logLlm: (x) => logs.push(x) }, jv.fetch);
t('jev answers through classifyMerchant', r.ok && r.node === 'coffee' && r.concept === 'Dining' && r.pool === 'coffee', r);
t('bearer key + pinned model', jv.calls[0].headers.Authorization === 'Bearer jk' && jv.calls[0].body.model === 'jev-1.14.0' && jv.calls[0].url === J.JEV_URL);
t('node criteria carry the whole menu plus unknown', Object.keys(jv.calls[0].body.questions.node_0.criteria).length === C.CLASSIFY_NODES.length + 1);
t('usage row is content-free', logs.length === 1 && logs[0].outcome === 'ok' && logs[0].prompt_tokens === 1200 && !JSON.stringify(logs[0]).includes('HIGHLANDS'), logs);

console.log('\n-- jev: pool, like Gemini\'s legacy answer --');
jv = fakeJev({ probs: (name) => name.startsWith('node_') ? { unknown: 0.9, coffee: 0.1 }
  : name.startsWith('concept_') ? { Dining: 0.8, unknown: 0.2 } : { coffee: 0.85, none: 0.15 } });
r = await C.classifyMerchant('ZQ CAFE', { labeler: 'jev', jev: { apiKey: 'jk' } }, jv.fetch);
t('no node: concept and pool stand on their own', r.ok && r.node === null && r.concept === 'Dining' && r.pool === 'coffee', r);
t('pool question carries the four kinds + none', Object.keys(jv.calls[0].body.questions.pool_0.criteria).sort().join() === 'cinema,coffee,milktea,none,ride');
jv = fakeJev({ probs: (name) => name.startsWith('node_') ? { unknown: 0.9, coffee: 0.1 } : name.startsWith('concept_') ? { Others: 0.7, unknown: 0.3 } : { none: 0.9, coffee: 0.1 } });
r = await C.classifyMerchant('ZQ BARBER', { labeler: 'jev', jev: { apiKey: 'jk' } }, jv.fetch);
t('"none" is pool null', r.ok && r.pool === null && r.concept === 'Others', r);
jv = fakeJev({ probs: (name) => name.startsWith('node_') ? { fuel: 0.9, unknown: 0.1 } : name.startsWith('concept_') ? { Dining: 0.9, unknown: 0.1 } : { coffee: 0.9, none: 0.1 } });
r = await C.classifyMerchant('ZQ PETRO', { labeler: 'jev', jev: { apiKey: 'jk' } }, jv.fetch);
t('a node wins: concept and pool derived from it, the side answers ignored', r.node === 'fuel' && r.concept === 'Transport' && r.pool === null, r);
t('a choice outside the criteria is dropped', J.resolveChoice({ choice: 'Dining', probabilities: { Dining: 0.9 } }, 0.5, J.JEV_CRITERIA().pool) === null);
const cap = [];
jv = fakeJev({ probs: () => ({ coffee: 0.9, unknown: 0.1 }) });
await C.classifyMerchantsBatch(['A1', 'B2'], { labeler: 'jev', jev: { apiKey: 'jk', capture: cap } }, jv.fetch);
t('capture hands the raw answers to the bench', cap.length === 2 && cap[0].node.coffee === 0.9 && cap[1].line === 'B2');

console.log('\n-- jev: batch --');
const names = Array.from({ length: 19 }, (_, i) => 'ZQ SHOP ' + String.fromCharCode(65 + i));
jv = fakeJev({ probs: () => ({ unknown: 0.95, coffee: 0.05 }) });
var batch = await C.classifyMerchantsBatch(names, { labeler: 'jev', jev: { apiKey: 'jk' } }, jv.fetch);
t('chunked by JEV_CHUNK', jv.calls.length === Math.ceil(19 / J.JEV_CHUNK), jv.calls.length);
t('aligned answers; "unknown" is a real all-null answer', batch && batch.length === 19 && batch.every((a) => a.node === null && a.concept === null));

jv = fakeJev({ status: 429 });
logs = [];
batch = await C.classifyMerchantsBatch(names, { labeler: 'jev', jev: { apiKey: 'jk' }, logLlm: (x) => logs.push(x) }, jv.fetch);
t('429 is "not tried" (null)', batch === null);
t('429 logged rate_limited', logs[0] && logs[0].outcome === 'rate_limited');
jv = fakeJev({ status: 529 });
t('529 overloaded is "not tried" too', (await C.classifyMerchantsBatch(names, { labeler: 'jev', jev: { apiKey: 'jk' } }, jv.fetch)) === null);

console.log('\n-- fallback --');
gcalls = [];
let jevAsked = 0;
const mixed = async (u, init) => {
  if (u === J.JEV_URL) { jevAsked++; return res(429, {}); }
  return geminiFetch({ node: 'fuel', concept: null, pool: null }, gcalls)(u, init);
};
r = await C.classifyMerchant('PETROLIMEX', { labeler: 'jev,gemini', apiKey: 'g', jev: { apiKey: 'jk' } }, mixed);
t('jev 429 falls back to gemini', jevAsked === 1 && gcalls.length === 1 && r.node === 'fuel', r);
jv = fakeJev({ probs: () => ({ unknown: 0.99, coffee: 0.01 }) });
gcalls = [];
const unknownFirst = async (u, init) => (u === J.JEV_URL ? jv.fetch(u, init) : geminiFetch({ node: 'fuel' }, gcalls)(u, init));
r = await C.classifyMerchant('QX77', { labeler: 'jev,gemini', apiKey: 'g', jev: { apiKey: 'jk' } }, unknownFirst);
t('a real "cannot tell" is NOT second-guessed', r.ok && r.node === null && gcalls.length === 0, { r, g: gcalls.length });
r = await C.classifyMerchant('PETROLIMEX', { labeler: 'jev,gemini', apiKey: 'g', jev: {} }, mixed);
t('jev without a key: the fallback answers', r.ok && r.node === 'fuel');

console.log('\n-- statement verdict (Noul) --');
const msg = { from: 'Bank <noreply@bank.vn>', subject: 'Sao kê tháng 10', body: 'Kính gửi quý khách, sao kê đính kèm.' };
const files = [{ filename: 'saoke.xlsx' }];
for (const [p, want] of [[0.9, true], [0.35, true], [0.1, false]]) {
  jv = fakeJev({ noul: p });
  const v = await S.statementVerdict(msg, files, { labeler: 'jev', jev: { apiKey: 'jk' } }, jv.fetch);
  t('noul ' + p + ' → ' + want, v === want, v);
}
jv = fakeJev({ noul: 0.9 });
await S.statementVerdict(msg, files, { labeler: 'jev', jev: { apiKey: 'jk' } }, jv.fetch);
const st = jv.calls[0].body.state;
t('statement state is the same text Gemini gets', typeof st === 'string' && st.includes('Subject: Sao kê tháng 10') && st.includes('saoke.xlsx'));
jv = fakeJev({ status: 429 });
t('statement 429 → null (undecided, never false)', (await S.statementVerdict(msg, files, { labeler: 'jev', jev: { apiKey: 'jk' } }, jv.fetch)) === null);

console.log('\n-- what reaches jev from the cascade: the name only --');
jv = fakeJev({ probs: () => ({ coffee: 0.9, unknown: 0.1 }) });
const ctx = { subtle: crypto.webcrypto.subtle, fetch: jv.fetch, classifyBudget: { left: 3 }, llm: { labeler: 'jev', jev: { apiKey: 'jk' } },
  db: { async merchantCorrectionGet() { return null; }, async merchantConceptGet() { return null; }, async merchantConceptPut() {} } };
const ex = { counterparty: 'ZQ TRADING 0912345678', memo: 'xyzq qwerty ghi rieng', category: null, node: null };
await C.enrichCategory(ex, { user_id: 'u' }, ctx);
const sent = JSON.stringify(jv.calls.map((c) => c.body));
t('jev was asked', jv.calls.length === 1);
t('no memo reaches jev', !/qwerty/.test(sent));
t('no long digit run reaches jev', !/0912345678/.test(sent));

console.log('\n-- labelerStatus: what the logs say is on --');
var st0 = L.labelerStatus({ apiKey: 'SECRET-G' });
t('unset: gemini active', st0.chain === 'gemini' && st0.active === 'gemini' && st0.keys.gemini === true, st0);
var st1 = L.labelerStatus({ labeler: 'jev,gemini', apiKey: 'SECRET-G', jev: { apiKey: 'SECRET-J' } });
t('jev,gemini with both keys: jev active', st1.active === 'jev' && st1.keys.jev === true && st1.keys.gemini === true, st1);
var st2 = L.labelerStatus({ labeler: 'jev,gemini', apiKey: 'SECRET-G', jev: {} });
t('jev key missing: gemini is what actually runs', st2.active === 'gemini' && st2.keys.jev === false, st2);
var st3 = L.labelerStatus({ labeler: 'jevv,gemini', apiKey: 'SECRET-G' });
t('typo first: nothing active, the typo is named', st3.active === null && st3.keys.jevv === 'unknown_provider', st3);
t('never a key in the status', !/SECRET/.test(JSON.stringify([st0, st1, st2, st3])));
t('status agrees with what runs', L.labelerReady({ gemini: { ready: (c) => !!c.apiKey } , jev: { ready: (c) => !!(c.jev && c.jev.apiKey) } }, { labeler: 'jevv,gemini', apiKey: 'g' }) === false);

console.log('\n' + (fail ? fail + ' FAILED, ' : 'ALL ') + pass + ' PASSED');
process.exit(fail ? 1 : 0);
