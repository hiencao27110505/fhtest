#!/usr/bin/env node
/* The probe finds banks we don't cover, and persists NOTHING but domain+counts.
 * `node pipeline/coverage-probe.test.js`
 *
 * THE BLIND SPOT THIS INSTRUMENTS. Selection is `from:(registry)`; a bank
 * outside the registry is never listed, so no downstream instrument can see it.
 * A user with an uncovered bank experiences "the app doesn't work"; we
 * experience nothing. The probe is the only reader pointed at what we DON'T
 * read.
 *
 * The privacy contract is pinned harder than the counting, deliberately:
 * extract_miss_labels promised "values never leave the mail" in a comment and
 * was found holding amounts, a person's name and cinema seat numbers. Here the
 * assertion inspects the ACTUAL upsert payload — domain, mailboxes, messages,
 * last_seen, and not one other key.
 */
const nacl = await import('/Users/thutrang290902gmail.com/Desktop/Projects/fhtest/node_modules/tweetnacl/nacl-fast.js').then(m => m.default || m);
const crypto = await import('node:crypto').then(m => m.default || m);
const url = await import('node:url');
const HERE = url.fileURLToPath(new URL('.', import.meta.url));
const ROOT = HERE + '../supabase/functions/_shared/mailbox/';
const W  = await import(ROOT + 'worker.mjs');
const TC = await import(ROOT + 'token-crypto.mjs');

let pass = 0, fail = 0;
const t = (n, ok, d) => { console.log((ok ? '  PASS  ' : '  FAIL  ') + n + (!ok && d ? '  -> ' + d : '')); ok ? pass++ : fail++; };

const TOKEN_KEY = crypto.randomBytes(32).toString('base64');
const ENC = await TC.encryptToken('r-<REDACTED>', TOKEN_KEY, { subtle: crypto.webcrypto.subtle });

/* Two mailboxes. A fictional bank (guaranteed outside the registry — the first
   draft used SHB and the probe CORRECTLY refused it, because shb.com.vn is
   registry line 112; the fixture was wrong, not the code) sends
   transaction-shaped mail to both; a shop sends promo to one; MB (registry)
   sends real mail that must NOT be counted — covered is not a gap. */
const MAIL = {
  g1: [
    { id: 'a1', from: 'ExampleBank <ebanking@examplebank.vn>', subject: 'Thông báo giao dịch tài khoản' },
    { id: 'a2', from: 'ExampleBank <ebanking@examplebank.vn>', subject: 'Biên lai chuyển tiền' },
    { id: 'a3', from: 'MB <mbcard@mbbank.com.vn>', subject: 'Thông báo giao dịch TK chạm' },
    { id: 'a4', from: 'Shop <deals@megasale.vn>', subject: 'SALE OFF 70% cuối tuần' },
  ],
  g2: [
    { id: 'b1', from: 'ExampleBank <ebanking@examplebank.vn>', subject: 'Thông báo giao dịch tài khoản' },
  ],
};

const saved = [];
const ctx = {
  db: {
    async dueGrants() {
      return [
        { id: 'g1', email: 'one@gmail.com', refresh_token_enc: ENC, needs_reauth: false },
        { id: 'g2', email: 'two@gmail.com', refresh_token_enc: ENC, needs_reauth: false },
      ];
    },
    async providerDomains() { return []; },
    async saveCoverageCandidates(rows) { saved.push(...rows); },
  },
  subtle: crypto.webcrypto.subtle, tokenKey: TOKEN_KEY, fromBytea: (v) => v,
  google: { clientId: 'c', clientSecret: '<REDACTED>' },
  fetch: (() => {
    let currentGrant = 'g1';
    return async (u) => {
      u = String(u);
      if (u.startsWith('https://oauth2.googleapis.com/token')) {
        // token exchange happens once per grant, in dueGrants order — use it to
        // switch which mailbox the stub is serving
        const grantToken = currentGrant;
        currentGrant = 'g2';
        return { ok: true, status: 200, text: async () => JSON.stringify({ access_token: grantToken, expires_in: 3600 }),
                 json: async () => ({ access_token: grantToken, expires_in: 3600 }) };
      }
      const box = u.includes('Bearer') ? null : null;
      if (u.includes('/messages?') || u.endsWith('/messages')) {
        // which mailbox? the access token is in the Authorization header, which
        // this stub cannot see — so encode it in the query result by URL count
        return { ok: true, status: 200, json: async () => ({ messages: (MAIL[_gmailFor()] || []).map(m => ({ id: m.id })) }),
                 text: async () => '' };
      }
      const m = u.match(/\/messages\/([^?]+)\?format=metadata/);
      if (m) {
        const all = [...MAIL.g1, ...MAIL.g2];
        const msg = all.find(x => x.id === m[1]);
        return { ok: true, status: 200, json: async () => ({
          id: msg.id, threadId: 't', internalDate: '1', payload: { headers: [
            { name: 'From', value: msg.from }, { name: 'Subject', value: msg.subject },
          ] } }), text: async () => '' };
      }
      throw new Error('unstubbed ' + u);
    };
  })(),
};
let _listCalls = 0;
const _gmailFor = () => (_listCalls++ === 0 ? 'g1' : 'g2');

const out = await W.runCoverageProbe(ctx);
console.log('   summary:', JSON.stringify(out), '\n   saved:', JSON.stringify(saved));

t('the uncovered bank is found', saved.some(r => r.domain === 'examplebank.vn'), JSON.stringify(saved));
const shb = saved.find(r => r.domain === 'examplebank.vn') || {};
t('counted across BOTH mailboxes', shb.mailboxes === 2, JSON.stringify(shb));
t('three transaction-shaped messages', shb.messages === 3, JSON.stringify(shb));
t('the registry bank is NOT a candidate — covered is not a gap',
  !saved.some(r => r.domain === 'mbbank.com.vn'), JSON.stringify(saved.map(r => r.domain)));
t('promo without transaction shape is not a candidate',
  !saved.some(r => r.domain === 'megasale.vn'));
t('nothing but domain + counts is persisted',
  saved.every(r => {
    const keys = Object.keys(r).sort().join(',');
    return keys === 'domain,mailboxes,messages';
  }), JSON.stringify(saved[0] && Object.keys(saved[0])));
t('no subject and no address survives anywhere in the payload',
  !/giao dịch|Biên lai|ebanking@|deals@/i.test(JSON.stringify(saved)));

console.log('\n' + pass + ' pass, ' + fail + ' fail\n');
if (fail) process.exit(1);
