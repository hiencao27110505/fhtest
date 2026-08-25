#!/usr/bin/env node
/* The two transports must dedup against each other's rows.
 * `node pipeline/direct-dedup.test.js`
 *
 * A household can have a bank forwarding to their alias and a wallet read over
 * OAuth at the same time, and that is exactly the case cross-source dedup
 * exists for: the bank says "debit 200.000đ", the wallet says "receipt
 * 200.000đ", one purchase. The two rows are written by two different code
 * bases, and they meet only through `dedup_fp` — a keyed HMAC over a string
 * both sides build by hand.
 *
 * If the string, the key handling or the base64 differ by one byte, the
 * fingerprints stop matching and duplicates stop being caught. Nothing throws,
 * nothing logs, and the symptom is a queue that quietly contains both halves of
 * every purchase — indistinguishable from a week with no duplicates in it.
 *
 * So this file computes the same fingerprints with BOTH implementations and
 * compares them: ours from supabase/functions/mailbox-sync/lib/dedup.mjs, the
 * forwarding one eval'd straight out of pipeline/bank-email-pipeline.gs. Same
 * slice dedup-provider.test.js uses.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// ── Apps Script shims, enough for the slice under test ──────────────────────
const _props = {};
global.PropertiesService = {
  getScriptProperties: () => ({
    getProperty: k => (k in _props ? _props[k] : null),
    setProperty: (k, v) => { _props[k] = String(v); },
  }),
};
const toSigned = b => Array.from(b).map(x => (x > 127 ? x - 256 : x));
global.Utilities = {
  DigestAlgorithm: { SHA_256: 'SHA_256' },
  Charset: { UTF_8: 'UTF_8' },
  getUuid: () => crypto.randomUUID(),
  computeDigest: (_a, data) => toSigned(crypto.createHash('sha256').update(Buffer.from(data, 'utf8')).digest()),
  computeHmacSha256Signature: (data, key) =>
    toSigned(crypto.createHmac('sha256', Buffer.from(key.map(b => b & 0xff)))
      .update(Buffer.from(data.map(b => b & 0xff))).digest()),
  base64Encode: bytes => Buffer.from(bytes.map(b => b & 0xff)).toString('base64'),
  base64Decode: b64 => toSigned(Buffer.from(b64, 'base64')),
  newBlob: str => ({ getBytes: () => toSigned(Buffer.from(str, 'utf8')) }),
};

// The slice carries findDuplicate, dedupFingerprint and canonicalProvider.
var DEDUPE_WINDOW_DAYS = 3;
var _stubRows = [];
function supabaseGet() { return _stubRows; }
function sealedStagingEnabled() { return true; }
const src = fs.readFileSync(path.join(__dirname, 'bank-email-pipeline.gs'), 'utf8');
eval(src.slice(src.indexOf('function findDuplicate'), src.indexOf('// ---------- memo tidying')));

// One key, seeded before either side runs. The forwarding side self-mints when
// the property is empty — which is right for the only implementation there is,
// and is precisely what our side must never do (two mints, two key spaces, no
// error anywhere).
const KEY = crypto.randomBytes(32).toString('base64');
_props.DEDUP_FP_KEY = KEY;

let pass = 0, fail = 0;
const t = (n, ok, d) => { console.log((ok ? '  PASS  ' : '  FAIL  ') + n + (!ok && d ? '  -> ' + d : '')); ok ? pass++ : fail++; };

(async () => {
const D = await import('../supabase/functions/mailbox-sync/lib/dedup.mjs');

console.log('\n-- fingerprint parity with the forwarding pipeline --');
const CASES = [
  [200000, 'debit', 'VND'],
  [2000, 'credit', 'VND'],
  [165000, 'debit', 'VND'],
  [200, 'debit', 'USD'],          // the currency bug: 200 USD is not 200 VND
  [1000, 'debit', null],          // a row with no currency read
  [4210000, 'credit', 'VND'],
];
for (const [amount, direction, currency] of CASES) {
  const theirs = dedupFingerprint(amount, direction, currency);
  const ours = await D.dedupFingerprint(amount, direction, currency, KEY);
  t(`fp(${amount}, ${direction}, ${currency}) matches`, ours === theirs,
    'ours=' + ours + ' theirs=' + theirs);
}

console.log('\n-- the distinctions the fingerprint must keep --');
const fp = (a, d, c) => D.dedupFingerprint(a, d, c, KEY);
t('direction changes the fingerprint', await fp(200000, 'debit', 'VND') !== await fp(200000, 'credit', 'VND'));
t('currency changes the fingerprint', await fp(200, 'debit', 'USD') !== await fp(200, 'debit', 'VND'));
t('amount changes the fingerprint', await fp(200000, 'debit', 'VND') !== await fp(200001, 'debit', 'VND'));
t('the same triple is stable across calls', await fp(200000, 'debit', 'VND') === await fp(200000, 'debit', 'VND'));

console.log('\n-- the key is configuration, never minted here --');
let keyErr = null;
try { await D.dedupFingerprint(1000, 'debit', 'VND', ''); } catch (e) { keyErr = e.message; }
t('refuses to fingerprint without a key', keyErr === 'DEDUP_FP_KEY_MISSING', String(keyErr));
const OTHER = crypto.randomBytes(32).toString('base64');
t('a different key produces a different fingerprint',
  await fp(200000, 'debit', 'VND') !== await D.dedupFingerprint(200000, 'debit', 'VND', OTHER));

console.log('\n-- provider canonicalisation parity --');
// Verbatim from the live rows that caused the 2026-08-16 regression.
const NAMES = ['MB', 'MBBank', 'MB eBanking', 'MB Bank', 'mb ebanking', 'MB  E-Banking',
               'Vietcombank', 'VCB', 'Techcombank', 'Ky Thuong', 'Kỹ Thương',
               'Sacombank Internet Banking', 'MoMo', 'momo.vn', '', null];
for (const n of NAMES) {
  t(`canonicalProvider(${JSON.stringify(n)}) matches`,
    D.canonicalProvider(n) === canonicalProvider(n),
    'ours=' + D.canonicalProvider(n) + ' theirs=' + canonicalProvider(n));
}
t('every MB spelling reduces to one identity',
  new Set(['MB', 'MBBank', 'MB eBanking', 'MB Bank'].map(D.canonicalProvider)).size === 1);
t('accents fold, so Kỹ Thương meets Ky Thuong',
  D.canonicalProvider('Kỹ Thương') === D.canonicalProvider('Ky Thuong'));

console.log('\n-- findDuplicate: a suspicion, and only across sources --');
const now = '2026-08-24T10:00:00.000Z';
const near = '2026-08-24T12:00:00.000Z';
const far = '2026-08-30T10:00:00.000Z';
const mkRow = over => ({
  amount: 200000, direction: 'debit', currency: 'VND', occurredAt: now,
  sourceProvider: 'MoMo', memberId: 'mem-1', dedupFp: 'FP', ...over,
});
const db = rows => ({ stagedCandidates: async () => rows });

const bankRow = { id: 'r1', source_provider: 'MB Bank', occurred_at: now, created_at: now };
t('a bank row and a wallet row are one purchase',
  (await D.findDuplicate(mkRow(), db([bankRow])) || {}).id === 'r1');
t('two MB rows are two transactions, not one reported twice',
  await D.findDuplicate(mkRow({ sourceProvider: 'MBBank' }), db([bankRow])) === null);
t('a row outside the window is not a duplicate',
  await D.findDuplicate(mkRow(), db([{ ...bankRow, occurred_at: far }])) === null);
t('a row inside the window still matches',
  (await D.findDuplicate(mkRow(), db([{ ...bankRow, occurred_at: near }])) || {}).id === 'r1');
t('an unknown provider on either side is not guessed at',
  await D.findDuplicate(mkRow(), db([{ ...bankRow, source_provider: '' }])) === null);
t('an unrouted row is deduped against nothing',
  await D.findDuplicate(mkRow({ memberId: null }), db([bankRow])) === null);
t('a row with no fingerprint is deduped against nothing',
  await D.findDuplicate(mkRow({ dedupFp: null }), db([bankRow])) === null);

const earlier = { id: 'r0', source_provider: 'VCB', occurred_at: now, created_at: '2026-08-24T09:00:00.000Z' };
t('the EARLIEST candidate wins, so the pair is stable',
  (await D.findDuplicate(mkRow(), db([bankRow, earlier])) || {}).id === 'r0');

console.log('\n' + (fail ? 'FAILED ' + fail + ' of ' + (pass + fail)
                         : 'ALL ' + pass + ' assertions passed'));
process.exit(fail ? 1 : 0);
})();
