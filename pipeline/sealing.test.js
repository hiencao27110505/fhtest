#!/usr/bin/env node
/* Sealed staging: the seal side, the pipeline wiring, and the one property
 * everything stands on — with sealing on, there is NO path from "could not
 * seal" to a readable row.
 * `node pipeline/sealing.test.js`
 *
 * The decisive test here is the cross-implementation one: rows sealed by the
 * REAL Apps Script code are opened by the REAL client code from
 * src/js-data/18-staging-keys.js, not by a reimplementation. The family_id
 * blocker this review caught — the opener verifying a column the table does
 * not have — lived precisely in the seam between the two sides, which is why
 * both real sides are in this file.
 */
// NOT 'use strict': the eval'd .gs declarations must land in this scope.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const nacl = require('tweetnacl');

let pass = 0, fail = 0;
const t = (n, ok, d) => { console.log((ok ? '  PASS  ' : '  FAIL  ') + n + (!ok && d ? '  -> ' + d : '')); ok ? pass++ : fail++; };

const gs = fs.readFileSync(path.join(__dirname, 'bank-email-pipeline.gs'), 'utf8');
const sealedBoxSrc = fs.readFileSync(path.join(__dirname, 'sealed-box.gs'), 'utf8');
const clientSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'js-data', '18-staging-keys.js'), 'utf8');
const reviewSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'js-data', '72-txn-review.js'), 'utf8');

// ── GAS stubs. Byte arrays are SIGNED (-128..127) exactly as Apps Script
//    returns them — the & 0xff normalisations in the code under test are load-
//    bearing, and an unsigned stub would hide their absence. ────────────────
function signed(buf) { const a = []; for (const b of buf) a.push(b > 127 ? b - 256 : b); return a; }
function unsigned(arr) { return Buffer.from(arr.map((b) => b & 0xff)); }

let _props = {};
let _propLog = [];
global.PropertiesService = {
  getScriptProperties: () => ({
    getProperty: (k) => (k in _props ? _props[k] : null),
    setProperty: (k, v) => { _props[k] = String(v); _propLog.push(k); },
  }),
};
let LOGS = [];
global.Logger = { log: (m) => LOGS.push(String(m)) };
global.Utilities = {
  Charset: { UTF_8: 'utf8' },
  DigestAlgorithm: { SHA_256: 'sha256' },
  getUuid: () => crypto.randomUUID(),
  newBlob: (s) => ({ getBytes: () => signed(Buffer.from(String(s), 'utf8')) }),
  base64Encode: (x) => (typeof x === 'string' ? Buffer.from(x, 'utf8') : unsigned(x)).toString('base64'),
  base64Decode: (b64) => signed(Buffer.from(b64, 'base64')),
  computeDigest: (alg, s) => signed(crypto.createHash('sha256').update(String(s), 'utf8').digest()),
  computeHmacSha256Signature: (msgBytes, keyBytes) =>
    signed(crypto.createHmac('sha256', unsigned(keyBytes)).update(unsigned(msgBytes)).digest()),
};
global.nacl = nacl;

eval(sealedBoxSrc);

// A fixed family keypair, standing in for what 18-staging-keys generates.
const familyKp = nacl.box.keyPair();
const familyPubB64 = Buffer.from(familyKp.publicKey).toString('base64');

// ── the envelope, opened by the REAL client code ────────────────────────────
console.log('\n-- seal here, open with the shipped client --');

global.window = {};
global.atob = (b) => Buffer.from(b, 'base64').toString('binary');
global.btoa = (b) => Buffer.from(b, 'binary').toString('base64');
eval(clientSrc);

_props = {};
const PAYLOAD = { amount: 576820, currency: 'VND', direction: 'debit', counterparty: 'AEON',
                  memo: 'di sieu thi', transaction_type: 'ecommerce_receipt' };
const env = sealForFamily(PAYLOAD, familyPubB64, 'fam-1', 'gmail-1');
t('the envelope carries all four wire fields',
  !!(env.sealed && env.eph_pub && env.nonce && env.enc_v === 1));

const rowOK = Object.assign({ family_id: 'fam-1', gmail_message_id: 'gmail-1' }, env);
let opened = window.fhStagingOpenRow(rowOK, familyKp.secretKey);
t('the shipped opener reads back what was sealed',
  opened.amount === 576820 && opened.memo === 'di sieu thi' && opened.counterparty === 'AEON',
  JSON.stringify(opened).slice(0, 120));
t('family_id + gmail_message_id + enc_v were bound inside the box',
  opened.family_id === 'fam-1' && opened.gmail_message_id === 'gmail-1' && opened.enc_v === 1);

// Relocation: same ciphertext presented as another family's / another row's.
let threw = '';
try { window.fhStagingOpenRow(Object.assign({}, rowOK, { family_id: 'fam-2' }), familyKp.secretKey); }
catch (e) { threw = String(e.message); }
t('moved to another family: rejected', threw === 'staging_identity_mismatch', threw);
threw = '';
try { window.fhStagingOpenRow(Object.assign({}, rowOK, { gmail_message_id: 'other' }), familyKp.secretKey); }
catch (e) { threw = String(e.message); }
t('moved to another row: rejected', threw === 'staging_identity_mismatch', threw);

// Tamper: flip one ciphertext byte.
const tampered = Buffer.from(env.sealed, 'base64'); tampered[3] ^= 1;
threw = '';
try { window.fhStagingOpenRow(Object.assign({}, rowOK, { sealed: tampered.toString('base64') }), familyKp.secretKey); }
catch (e) { threw = String(e.message); }
t('one flipped byte: Poly1305 rejects it', threw === 'staging_open_failed', threw);

t('wrong key cannot open it', (() => {
  try { window.fhStagingOpenRow(rowOK, nacl.box.keyPair().secretKey); return false; }
  catch (e) { return String(e.message) === 'staging_open_failed'; }
})());

// ── the DRBG's write-ahead counter ──────────────────────────────────────────
// The bug this kills: counter persisted AFTER output, so a crash (or an
// overlapping run) replays it — two rows get the same eph_priv AND nonce, and
// XSalsa20 keystream reuse hands an observer payload XORs. Write-ahead burns
// counter values on a crash, which costs nothing.
console.log('\n-- DRBG: reserve, then generate --');

_props = {}; _propLog = [];
sealedBoxRandomBytes(24);
t('the counter is persisted during generation',
  _propLog.filter((k) => k === 'SEALED_BOX_DRBG_COUNTER').length >= 1);

// Crash mid-generation: the HMAC throws AFTER the counter was reserved. The
// retry must land on FRESH counter values, not replay the burned ones.
_props = {}; _propLog = [];
_drbgSeedBytes();                                   // mint the seed first
const ctrBefore = _props.SEALED_BOX_DRBG_COUNTER;
const realHmac = Utilities.computeHmacSha256Signature;
Utilities.computeHmacSha256Signature = () => { throw new Error('crash mid-generation'); };
try { sealedBoxRandomBytes(24); } catch (e) { /* the simulated crash */ }
Utilities.computeHmacSha256Signature = realHmac;
t('a crashed call still advanced the counter (write-ahead, not write-behind)',
  Number(_props.SEALED_BOX_DRBG_COUNTER) > Number(ctrBefore || 0),
  'counter=' + _props.SEALED_BOX_DRBG_COUNTER);
const afterCrash = sealedBoxRandomBytes(24);
const replay = signed(crypto.createHmac('sha256',
  Buffer.from(_props.SEALED_BOX_DRBG_SEED, 'base64')).update('0').digest());
t('post-crash bytes are NOT the counter-0 bytes the crashed call reserved',
  Buffer.compare(unsigned(Array.from(afterCrash).map((b) => (b > 127 ? b - 256 : b))),
                 unsigned(replay).subarray(0, 24)) !== 0);

// Two consecutive draws never repeat.
const d1 = sealedBoxRandomBytes(24), d2 = sealedBoxRandomBytes(24);
t('consecutive draws differ', Buffer.compare(Buffer.from(d1), Buffer.from(d2)) !== 0);

// ── the TOFU pin ────────────────────────────────────────────────────────────
console.log('\n-- key pin --');

_props = {};
assertFamilyPubPinned('fam-9', familyPubB64);
t('first use pins silently', !!_props['FAMILY_PUB_PIN_fam-9']);
threw = '';
try { assertFamilyPubPinned('fam-9', familyPubB64); } catch (e) { threw = String(e); }
t('the same key passes forever', threw === '');
threw = '';
try { assertFamilyPubPinned('fam-9', Buffer.from(nacl.box.keyPair().publicKey).toString('base64')); }
catch (e) { threw = String(e); }
t('a swapped key refuses to seal', threw.indexOf('SEALED_BOX_PIN_MISMATCH') >= 0, threw);

// ── pipeline wiring ─────────────────────────────────────────────────────────
console.log('\n-- pipeline: fingerprint + findDuplicate --');

let GETS = [];
let GET_RESULT = [];
function supabaseGet(table, filters) { GETS.push({ table, filters }); return GET_RESULT; }

eval(gs.slice(gs.indexOf('var PIPELINE_VERSION'), gs.indexOf('function processEmails')));
eval(gs.slice(gs.indexOf('function findDuplicate'), gs.indexOf('// ---------- memo tidying')));

_props = {};
t('sealing is OFF with no property', !sealedStagingEnabled());
_props = { SEALED_STAGING_ENABLED: 'TRUE' };
t("sealing is OFF on 'TRUE' — no accidental arming on a typo", !sealedStagingEnabled());
_props = { SEALED_STAGING_ENABLED: 'true' };
t("sealing is ON only on exactly 'true'", sealedStagingEnabled());

_props = {};
const fp1 = dedupFingerprint(576820, 'debit', 'VND');
const fp2 = dedupFingerprint(576820, 'debit', 'VND');
const fp3 = dedupFingerprint(576821, 'debit', 'VND');
t('the fingerprint is deterministic', fp1 === fp2);
t('and amount-sensitive', fp1 !== fp3);
const keyA = _props.DEDUP_FP_KEY;
_props = {};
t('a different key gives a different fingerprint — it is keyed, not a hash',
  dedupFingerprint(576820, 'debit', 'VND') !== fp1);
t('the key self-mints into Script Properties', !!_props.DEDUP_FP_KEY && _props.DEDUP_FP_KEY !== keyA);

_props = {}; GETS = []; GET_RESULT = [];
findDuplicate(576820, 'debit', '2026-08-15T10:00:00+07:00', 'VCB', 'VND', 'MEMBER-A');
t('sealing OFF: dedup queries by amount, exactly as before',
  GETS[0].filters.amount === 'eq.576820' && GETS[0].filters.direction === 'eq.debit' &&
  !GETS[0].filters.dedup_fp, JSON.stringify(GETS[0].filters));
// Provider left the QUERY in the same-bank-collapse fix (45774f8): raw strings
// are what PostgREST compares and raw strings are exactly what is unreliable.
// Cross-source is decided in the loop, on canonicalProvider names.
t('provider is not a query filter in either mode',
  GETS[0].filters.source_provider === undefined, JSON.stringify(GETS[0].filters));

_props = { SEALED_STAGING_ENABLED: 'true', DEDUP_FP_KEY: keyA }; GETS = [];
findDuplicate(576820, 'debit', '2026-08-15T10:00:00+07:00', 'VCB', 'VND', 'MEMBER-A');
t('sealing ON: dedup queries by fingerprint and NEVER by amount',
  GETS[0].filters.dedup_fp === 'eq.' + fp1 && !GETS[0].filters.amount,
  JSON.stringify(GETS[0].filters));
t('the unmerged filter survives the switch, and provider still is not one',
  GETS[0].filters.duplicate_of_id === 'is.null' &&
  GETS[0].filters.source_provider === undefined);

// The +3d upper bound is enforced in code (PostgREST only gets the lower), and
// the winner must be genuinely cross-source under CANONICAL names — a same-bank
// row with an equal fingerprint is the exact case the fingerprint must not merge.
GET_RESULT = [
  { id: 'far', source_provider: 'Shopee', occurred_at: '2026-08-25T10:00:00+07:00', created_at: '2026-08-25' },
  { id: 'same-bank', source_provider: 'VCB Digibank', occurred_at: '2026-08-15T09:00:00+07:00', created_at: '2026-08-13' },
  { id: 'near-late', source_provider: 'Grab', occurred_at: '2026-08-16T10:00:00+07:00', created_at: '2026-08-16' },
  { id: 'near-early', source_provider: 'Shopee', occurred_at: '2026-08-14T10:00:00+07:00', created_at: '2026-08-14' },
];
const dup = findDuplicate(576820, 'debit', '2026-08-15T10:00:00+07:00', 'VCB', 'VND', 'MEMBER-A');
t('outside-window and same-canonical-bank rows lose; earliest cross-source wins',
  dup && dup.id === 'near-early', JSON.stringify(dup));

// ── trySealRow: seal, or hold — never plaintext ─────────────────────────────
console.log('\n-- trySealRow holds when it cannot seal --');

const PLAIN_ROW = {
  gmail_message_id: 'gmail-7', transaction_type: 'p2p_transfer', source_provider: 'MB',
  occurred_at: '2026-08-16T09:00:00+07:00', amount: 75000, currency: 'VND',
  direction: 'debit', counterparty: 'REVI', reference_number: 'FT123',
  raw_body: '<html>the whole email</html>',
  raw_extracted: { memo: 'tra tien an trua', _sender_auth: { ok: true } },
  review_status: 'pending', duplicate_of_id: null, member_id: 'member-1',
  dedup_fp: 'fp-abc',
};
function memberRows() { return [{ family_id: 'fam-1' }]; }
function keyRows(pub) { return [{ staging_pub: pub }]; }

_props = {}; LOGS = [];
_FAMILY_ID_CACHE = {}; _STAGING_PUB_CACHE = {};
GET_RESULT = []; // members lookup finds nothing
let held = trySealRow(PLAIN_ROW);
t('no family resolvable: hold', held === null);

_FAMILY_ID_CACHE = { 'member-1': 'fam-1' }; _STAGING_PUB_CACHE = { 'fam-1': null };
t('family has no staging key: hold', trySealRow(PLAIN_ROW) === null);

_STAGING_PUB_CACHE = { 'fam-1': familyPubB64 };
_props = { 'FAMILY_PUB_PIN_fam-1': 'a-different-pin' };
LOGS = [];
t('pin mismatch: hold, never seal to the new key', trySealRow(PLAIN_ROW) === null);
t('and it is logged CRITICAL', LOGS.some((l) => l.indexOf('CRITICAL') >= 0), LOGS.join('|'));

const realSeal = sealForFamily;
sealForFamily = undefined;
t('sealed-box.gs not pasted: hold', trySealRow(PLAIN_ROW) === null);
sealForFamily = realSeal;

// The happy path, opened again by the shipped client.
_props = {};
const sealedRow = trySealRow(PLAIN_ROW);
t('a sealed row exists', !!sealedRow);
const FORBIDDEN = ['amount', 'currency', 'direction', 'counterparty', 'reference_number',
  'raw_body', 'raw_extracted', 'transaction_type'];
t('it carries NO plaintext column — the 0068 constraint would reject anything less',
  FORBIDDEN.every((k) => sealedRow[k] === undefined),
  JSON.stringify(Object.keys(sealedRow)));
t('luggage tags + fingerprint survive',
  sealedRow.member_id === 'member-1' && sealedRow.occurred_at === PLAIN_ROW.occurred_at &&
  sealedRow.source_provider === 'MB' && sealedRow.dedup_fp === 'fp-abc' &&
  sealedRow.review_status === 'pending');
const openedRow = window.fhStagingOpenRow(
  Object.assign({ family_id: 'fam-1' }, sealedRow), familyKp.secretKey);
t('the client opens it: amount, memo and sender-auth all inside',
  openedRow.amount === 75000 && openedRow.memo === 'tra tien an trua' &&
  openedRow._sender_auth && openedRow._sender_auth.ok === true &&
  openedRow.transaction_type === 'p2p_transfer');
t('raw_body is NOT in the payload — nothing reads it back, Gmail keeps the source',
  openedRow.raw_body === undefined);

// ── the wiring is actually in the message path ──────────────────────────────
console.log('\n-- source: the pipeline is wired, fail-closed --');

const pom = gs.slice(gs.indexOf('function processOneMessage'), gs.indexOf('// ---------- Stage 0 helpers'));
t('processOneMessage gates on sealedStagingEnabled()', /if \(sealedStagingEnabled\(\)\)/.test(pom));
t('a null from trySealRow returns WITHOUT relabel — the message stays queued',
  /if \(!sealedRow\) return runCallCount;/.test(pom));
t('the hold happens BEFORE the insert',
  pom.indexOf('trySealRow(row)') < pom.indexOf('var inserted = insertEmailTransaction(row)'));
t('dedup_fp is written in BOTH eras (continuity across the flip)',
  pom.indexOf('row.dedup_fp = dedupFingerprint(') < pom.indexOf('if (sealedStagingEnabled())'));

const pe = gs.slice(gs.indexOf('function processEmails'), gs.indexOf('function processOneMessage'));
t('processEmails takes the script lock', /LockService\.getScriptLock\(\)/.test(pe));
t('with tryLock(0) — a busy tick is skipped, not queued', /tryLock\(0\)/.test(pe));
t('and releases it in finally', /finally\s*\{\s*lock\.releaseLock\(\);/.test(pe));

const ipf = gs.slice(gs.indexOf('function insertParseFailure'), gs.indexOf('// Promotion into the real'));
t('parse_failures no longer stores email bodies', ipf.indexOf('raw_body') === -1 ||
  /No raw_body/.test(ipf), ipf.match(/raw_body[^,\n]*/g) ? ipf.match(/raw_body[^,\n]*/g).join() : '');
t('(behaviorally: the insert object has no raw_body key)', (() => {
  let captured = null;
  const supabasePost = (tbl, row) => { captured = row; };
  const extractEmailAddress = (s) => s;
  eval(ipf.slice(0, ipf.lastIndexOf('}') + 1));
  insertParseFailure({ getId: () => 'x', getFrom: () => 'a@b.c', getSubject: () => 's',
                       getPlainBody: () => 'THE BODY' }, 'reason');
  return captured && !('raw_body' in captured) && captured.error_reason === 'reason';
})());

// ── the client seam ─────────────────────────────────────────────────────────
console.log('\n-- source: the client side of the seam --');

t('fhReadStagedRow supplies the family id the opener verifies (the blocker)',
  /row\.family_id = window\.DB && window\.DB\.fid;/.test(reviewSrc));
t('the review fetch names its columns and excludes raw_body',
  reviewSrc.indexOf(".select('id,member_id,gmail_message_id,") >= 0 &&
  reviewSrc.indexOf("select('*')") === -1);
t('the fetch keeps gmail_message_id (the opener needs it)',
  /select\('[^']*gmail_message_id[^']*'\)/.test(reviewSrc));
t('and keeps the four envelope fields',
  /select\('[^']*sealed,eph_pub,nonce,enc_v[^']*'\)/.test(reviewSrc));
t('a partly-locked queue renders the locked count',
  /fh-txn-locked-note/.test(reviewSrc) && /locked > 0/.test(reviewSrc));

// ── preflight is read-only ──────────────────────────────────────────────────
console.log('\n-- preflight --');

_props = { SEALED_BOX_DRBG_SEED: 'seed', DEDUP_FP_KEY: 'key', 'FAMILY_PUB_PIN_fam-1': 'pin' };
_propLog = []; LOGS = [];
_FAMILY_ID_CACHE = { 'member-1': 'fam-1' }; _STAGING_PUB_CACHE = { 'fam-1': familyPubB64 };
GET_RESULT = [{ forwarding_alias: '8xr4ed9vr8', member_id: 'member-1' }];
sealingPreflight();
t('preflight writes nothing', _propLog.length === 0, JSON.stringify(_propLog));
t('and reports one line per connection',
  LOGS.some((l) => l.indexOf('8xr4ed9vr8') >= 0 && l.indexOf('staging_pub=present') >= 0),
  LOGS.join('\n'));
t('a pin that no longer matches says MISMATCH',
  LOGS.some((l) => l.indexOf('pin=MISMATCH') >= 0), LOGS.filter((l) => l.indexOf('pin=') >= 0).join('|'));

console.log('\n' + (fail ? 'FAILED ' + fail + ' of ' + (pass + fail) : 'ALL ' + pass + ' PASSED'));
process.exit(fail ? 1 : 0);
