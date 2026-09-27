#!/usr/bin/env node
/* What a subject leaves in the shared cache: a shape, or a hash. Never a number.
 * `node pipeline/subject-hygiene.test.js`
 *
 * `sender_fingerprints.subject_template` is plaintext, in a table every family
 * shares. Found there on 2026-09-21: two subjects carrying a masked account
 * token, and a run of hand-written subjects with phone numbers typed with
 * spaces and dots (docs/specs/email-reading-v2-spec.md §7, §8.1, §11).
 *
 * Pinned:
 *   • the masked-token rule and the separated-phone rule, in BOTH normalisers
 *   • the Apps Script twin now has the two month rules too, so the two
 *     transports key a statement sender identically
 *   • HASH ON DOUBT: a subject that still looks dirty after normalising is
 *     keyed 'h:' + sha256. A plain year is not dirt.
 *   • the digest is pinned to a literal, and the .gs twin (run here against a
 *     Utilities stub that returns SIGNED bytes, as Apps Script does) produces
 *     the identical key, or the shared cache splits in two
 *   • ONE string for lookup, save, derive-failure recording and the worker's
 *     metadata-first pass, or the cache is written and never hit
 *   • rows written under the older readable keys still answer (read-only)
 *
 * All fixtures synthetic.
 */
const fs = await import('node:fs');
const nodeCrypto = await import('node:crypto').then(m => m.default || m);
const nacl = await import('tweetnacl').then(m => m.default || m);
const url = await import('node:url');
const HERE = url.fileURLToPath(new URL('.', import.meta.url));
const ROOT = HERE + '../supabase/functions/_shared/mailbox/';
const X  = await import(ROOT + 'extract.mjs');
const W  = await import(ROOT + 'worker.mjs');
const TC = await import(ROOT + 'token-crypto.mjs');

let pass = 0, fail = 0;
const t = (n, ok, d) => { console.log((ok ? '  PASS  ' : '  FAIL  ') + n + (!ok && d !== undefined ? '  -> ' + JSON.stringify(d) : '')); ok ? pass++ : fail++; };
const N = X.normalizeSubjectTemplate;
const SEP = String.fromCharCode(0);

console.log('\n-- the two new rules --');
t('a masked account token goes', N('Thong bao so du TK 0123-XXXX-456') === 'Thong bao so du TK', N('Thong bao so du TK 0123-XXXX-456'));
t('...with stars, and with no tail', N('Ma KH 12-***-34 thong bao') === 'Ma KH thong bao' && N('The 4111-xxxx da kich hoat') === 'The da kich hoat');
t('two mails differing only in the masked token are one shape', N('So du TK 0123-XXXX-456') === N('So du TK 9876-XXXX-001'));
t('a phone typed with spaces goes', N('Lien he 090 123 4567 de duoc ho tro') === 'Lien he de duoc ho tro', N('Lien he 090 123 4567 de duoc ho tro'));
t('...with dots and a country code', N('Goi +84.90.123.4567') === 'Goi', N('Goi +84.90.123.4567'));
t('...with dashes', N('Hotline 028-3812-3456 ho tro') === 'Hotline ho tro', N('Hotline 028-3812-3456 ho tro'));
t('an ordinary subject is untouched', N('Thong bao giao dich the tin dung') === 'Thong bao giao dich the tin dung');
t('a small count is not a phone', N('Ban co 3 giao dich moi') === 'Ban co 3 giao dich moi');
t('the month rules still hold', N('Bang sao ke tai khoan ky 09/2026') === N('Bang sao ke tai khoan ky 10/2026'));
t('the legacy reader is unchanged: it still keeps the month', /09\/2026/.test(X.legacySubjectTemplate('Bang sao ke tai khoan ky 09/2026')));

console.log('\n-- hash on doubt --');
t('a 5-digit contract number is dirt', X.subjectLooksDirty(N('Hop dong 48213 da giai ngan')) === true);
t('a plain year is NOT (36 live rows are year-only)', X.subjectLooksDirty('Sao ke nam 2026') === false && X.subjectLooksDirty('Tong ket 1999') === false);
t('a four-digit run that is not a year is', X.subjectLooksDirty('Ma 4821 da duyet') === true);
t('eight digits strung together by spaces are', X.subjectLooksDirty('Ve tau 12 34 56 78') === true);
t('a clean subject is not', X.subjectLooksDirty('Thong bao giao dich') === false);

const DIRTY = 'Hop dong 48213 da giai ngan';
const PINNED = 'h:f8a0c47f2a15d04bf1b6ae6ffe9795609c7b2cbff481e73b7e179d4c04c1cc42';
const key = await X.subjectCacheKey(DIRTY);
t('the key is "h:" + sha256(normalised), pinned to a literal', key === PINNED, key);
t('...which IS plain SHA-256 over UTF-8 (what the .gs computes)',
  key === 'h:' + nodeCrypto.createHash('sha256').update(N(DIRTY), 'utf8').digest('hex'));
t('an explicit subtle gives the same key', await X.subjectCacheKey(DIRTY, nodeCrypto.webcrypto.subtle) === PINNED);
t('the key carries none of the digits', !/48213/.test(key));
t('a clean subject keys as itself, readable, exactly as before', await X.subjectCacheKey('Fwd: Thong bao giao dich') === 'Thong bao giao dich');
t('a Vietnamese subject hashes over its UTF-8 bytes',
  await X.subjectCacheKey('Hợp đồng 48213 đã giải ngân') === 'h:' + nodeCrypto.createHash('sha256').update('Hợp đồng 48213 đã giải ngân', 'utf8').digest('hex'));

/* ── the Apps Script twin ────────────────────────────────────────────────── */
console.log('\n-- the Apps Script twin produces the same keys --');
{
  const src = fs.readFileSync(HERE + 'bank-email-pipeline.gs', 'utf8');
  const fnSrc = (name) => { const i = src.indexOf('function ' + name + '('); if (i < 0) throw new Error('missing in .gs: ' + name); return src.slice(i, src.indexOf('\n}\n', i) + 3); };
  const Utilities = {
    DigestAlgorithm: { SHA_256: 'SHA_256' }, Charset: { UTF_8: 'UTF_8' },
    // Apps Script returns SIGNED bytes (-128..127). The stub does too, so a hex
    // encoder that forgets that fails here instead of in production.
    computeDigest: (alg, text) => Array.from(nodeCrypto.createHash('sha256').update(text, 'utf8').digest()).map((b) => (b > 127 ? b - 256 : b)),
  };
  const G = new Function('Utilities', ['normalizeSubjectTemplate', 'legacySubjectTemplate', 'subjectLooksDirty', 'subjectCacheKey'].map(fnSrc).join('\n') +
    '\nreturn { normalizeSubjectTemplate, legacySubjectTemplate, subjectLooksDirty, subjectCacheKey };')(Utilities);

  const CORPUS = ['Thong bao so du TK 0123-XXXX-456', 'Lien he 090 123 4567 de duoc ho tro', 'Goi +84.90.123.4567',
    DIRTY, 'Sao ke nam 2026', 'Ve tau 12 34 56 78 90', 'Bang sao ke tai khoan ky 09/2026', 'Sao kê thẻ tháng 9/2026',
    'Fwd: Fwd: Biên lai chuyển tiền', 'Thong bao giao dich TK cham #12345', 'Hợp đồng 48213 đã giải ngân', 'Hoa don 10/2026', ''];
  let sameNorm = true, sameKey = true, sameLegacy = true;
  for (const s of CORPUS) {
    if (G.normalizeSubjectTemplate(s) !== N(s)) { sameNorm = false; t('normaliser agrees on ' + JSON.stringify(s), false, [G.normalizeSubjectTemplate(s), N(s)]); }
    if (G.subjectCacheKey(s) !== await X.subjectCacheKey(s)) { sameKey = false; t('key agrees on ' + JSON.stringify(s), false, [G.subjectCacheKey(s), await X.subjectCacheKey(s)]); }
    if (G.legacySubjectTemplate(s) !== X.legacySubjectTemplate(s)) sameLegacy = false;
  }
  t('both normalisers agree on every subject in the corpus', sameNorm);
  t('both cache keys agree, hashed ones included', sameKey);
  t('both legacy readers agree', sameLegacy);
  t('the .gs twin reaches the pinned digest through SIGNED bytes', G.subjectCacheKey(DIRTY) === PINNED, G.subjectCacheKey(DIRTY));
  t('the .gs twin has the month rules it was missing', G.normalizeSubjectTemplate('Bang sao ke ky 09/2026') === G.normalizeSubjectTemplate('Bang sao ke ky 10/2026'));
  /* The chain of rules, regex for regex: a rule added to one side only shows
     up here even when no subject in the corpus happens to exercise it. */
  const rules = (text, name) => { const i = text.indexOf('function ' + name + '('); const body = text.slice(i, text.indexOf('\n}\n', i));
    return (body.match(/\.replace\(\/.*?\/[gimu]*, '[^']*'\)/g) || []).join('\n'); };
  const mjs = fs.readFileSync(ROOT + 'extract.mjs', 'utf8');
  t('the two normalisers are the same chain of rules', rules(mjs, 'normalizeSubjectTemplate') === rules(src, 'normalizeSubjectTemplate') && rules(src, 'normalizeSubjectTemplate').split('\n').length >= 9,
    [rules(mjs, 'normalizeSubjectTemplate'), rules(src, 'normalizeSubjectTemplate')]);
  t('the .gs reads and writes the cache by subjectCacheKey', /var template = subjectCacheKey\(subject\);/.test(src));
}

/* ── one string, everywhere: readTransaction ─────────────────────────────── */
console.log('\n-- readTransaction: lookup, save and failure recording share the key --');
{
  const table = new Map(), failures = [];
  const db = {
    fingerprint: async (s, tpl) => table.get(s + SEP + tpl) || null,
    saveFingerprint: async (row) => { table.set(row.sender_address + SEP + row.subject_template, row); },
    recordDeriveFailure: async (s, tpl, step) => { failures.push({ tpl, step }); },
  };
  let modelCalls = 0;
  const answer = { is_transaction: true, transaction_type: 'bank_txn', source_provider: 'ZQ', occurred_at: '2026-09-20T08:15:00+07:00',
    amount: 150000, currency: 'VND', direction: 'debit', counterparty: null, reference_number: null, account_masked: null,
    memo: 'a memo the body never printed' };
  const deps = { llm: { apiKey: 'k' }, fetch: async () => { modelCalls++; return { ok: true, status: 200,
    text: async () => JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(answer) }] } }] }) }; } };
  const mail = { from: 'ZQ <loans@zqbank.example>', subject: DIRTY, body: 'Gia tri: 150,000 VND\nVao luc: 20/09/2026 08:15' };
  await X.readTransaction(mail, db, deps);
  const keys = [...table.keys()];
  t('the row is saved under the hashed key', keys.length === 1 && keys[0] === 'loans@zqbank.example' + SEP + PINNED, keys);
  t('no digit of the subject reached the table', !keys.some((k) => /48213/.test(k)));
  t('the derive failure is recorded under the SAME key', failures.length === 1 && failures[0].tpl === PINNED, failures);

  const junk = new Map();
  const db2 = { fingerprint: async (s, tpl) => junk.get(s + SEP + tpl) || null, saveFingerprint: async (row) => { junk.set(row.sender_address + SEP + row.subject_template, row); } };
  let calls2 = 0;
  const deps2 = { llm: { apiKey: 'k' }, fetch: async () => { calls2++; return { ok: true, status: 200,
    text: async () => JSON.stringify({ candidates: [{ content: { parts: [{ text: '{"is_transaction":false}' }] } }] }) }; } };
  const promo = (n) => ({ from: 'ZQ <news@zqbank.example>', subject: 'Uu dai cho ma KH 48213', body: 'Giam ' + n + '% hom nay.' });
  await X.readTransaction(promo(10), db2, deps2);
  const r2 = await X.readTransaction(promo(20), db2, deps2);
  t('a verdict saved under the hash is FOUND under the hash: one model call, not two', calls2 === 1 && r2.ok === false && r2.reason === 'not_a_transaction', calls2);

  /* The warm map the worker hands over is keyed the same way. */
  const warm = new Map([['news@zqbank.example' + SEP + await X.subjectCacheKey('Uu dai cho ma KH 48213'), { is_transaction_source: false }]]);
  let calls3 = 0;
  const r3 = await X.readTransaction(promo(30), { saveFingerprint: async () => {} },
    { llm: { apiKey: 'k' }, fingerprints: warm, fetch: async () => { calls3++; throw new Error('must not be called'); } });
  t('...and through the warm map too', r3.ok === false && calls3 === 0);

  /* Read-only fallback: a row written before hash-on-doubt sits under the
     readable key and must still answer, or the cache goes cold on deploy. */
  const old = new Map([['news@zqbank.example' + SEP + N('Uu dai cho ma KH 48213'), { is_transaction_source: false }]]);
  let calls4 = 0;
  const r4 = await X.readTransaction(promo(40), { fingerprint: async (s, tpl) => old.get(s + SEP + tpl) || null, saveFingerprint: async () => {} },
    { llm: { apiKey: 'k' }, fetch: async () => { calls4++; throw new Error('must not be called'); } });
  t('a row under the OLD readable key still answers, with no model call', r4.ok === false && calls4 === 0);
}

/* ── one string, everywhere: the worker's metadata-first pass ────────────── */
console.log('\n-- runGrant: the header pass finds a verdict stored under the hash --');
{
  const FAM_PUB = Buffer.from(nacl.box.keyPair.fromSecretKey(new Uint8Array(nodeCrypto.randomBytes(32))).publicKey).toString('base64');
  const TOKEN_KEY = nodeCrypto.randomBytes(32).toString('base64');
  const ENC = await TC.encryptToken('r-token', TOKEN_KEY, { subtle: nodeCrypto.webcrypto.subtle });
  const SUBJECT = 'Uu dai cho ma KH 48213';
  const log = { meta: [], body: [] };
  const tally = [];
  const hashed = 'news@zqbank.example' + SEP + await X.subjectCacheKey(SUBJECT);
  const ctx = {
    db: {
      async memberById() { return { id: 'm1', family_id: 'f1', archived_at: null }; },
      async stagingPubForFamily() { return FAM_PUB; }, async stagingPubForUser() { return FAM_PUB; },
      async providerDomains() { return [{ domain_or_address: 'zqbank.example', provider_name: 'ZQ Bank' }]; },
      async alreadyStaged() { return new Set(); },
      async stagedState() { return { staged: new Set(), resolved: new Map() }; },
      async stagedCandidates() { return []; }, async insertStaged() { return true; },
      async recordFailure() {}, async markSynced() {}, async fingerprint() { return null; },
      async fingerprintsForSenders() { return new Map([[hashed, { is_transaction_source: false }]]); },
      async saveFingerprint() {}, async bumpReadTally(s) { tally.push(s); },
      async recordStall() {}, async clearStall() {}, async pendingCount() { return 0; },
    },
    nacl, rng: nodeCrypto.webcrypto, subtle: nodeCrypto.webcrypto.subtle,
    dedupKey: nodeCrypto.randomBytes(32).toString('base64'), tokenKey: TOKEN_KEY, fromBytea: (v) => v,
    google: { clientId: 'c', clientSecret: 's' }, llm: { apiKey: null }, notify: async () => {},
    fetch: async (u) => {
      u = String(u);
      if (u.startsWith('https://oauth2.googleapis.com/token'))
        return { ok: true, status: 200, json: async () => ({ access_token: 'at', expires_in: 3600 }), text: async () => '{"access_token":"at","expires_in":3600}' };
      if (u.includes('/messages?') || u.endsWith('/messages')) { const p = { messages: [{ id: 'junk-1' }] };
        return { ok: true, status: 200, json: async () => p, text: async () => JSON.stringify(p) }; }
      const m = u.match(/\/messages\/([^?]+)\?format=(\w+)/);
      if (m) {
        log[m[2] === 'metadata' ? 'meta' : 'body'].push(m[1]);
        const msg = { id: m[1], threadId: 't', internalDate: String(Date.now()), payload: { mimeType: 'text/plain',
          headers: [{ name: 'From', value: 'ZQ <news@zqbank.example>' }, { name: 'Subject', value: SUBJECT },
                    { name: 'Date', value: new Date().toUTCString() },
                    { name: 'Authentication-Results', value: 'mx.google.com; dkim=pass header.d=zqbank.example' }] } };
        if (m[2] === 'full') msg.payload.body = { data: Buffer.from('Giam 10% hom nay.', 'utf8').toString('base64url') };
        return { ok: true, status: 200, json: async () => msg, text: async () => JSON.stringify(msg) };
      }
      throw new Error('unstubbed ' + u);
    },
  };
  await W.runGrant({ id: 'g1', user_id: 'u1', member_id: 'm1', family_id: 'f1', email: 'x@gmail.com', needs_reauth: false,
    refresh_token_enc: ENC, last_synced_at: new Date().toISOString(), backfilled_at: '2026-08-28T00:00:00Z',
    backfilled_days: 90, backfill_days: 90, default_scope: 'family', stalled_runs: 0 }, ctx);
  t('its headers were read', log.meta.includes('junk-1'));
  t('its body never was: the hashed junk verdict answered on headers', !log.body.includes('junk-1'), log.body);
  t('and it counted as a junk-cache answer', tally.includes('junk_cache'), tally);
}

console.log('\n' + (fail === 0 ? 'ALL ' + pass + ' PASSED' : pass + ' passed, ' + fail + ' FAILED'));
process.exit(fail ? 1 : 0);
