// Verifies the sealed-box construction end to end against real TweetNaCl,
// with Apps Script's Utilities/PropertiesService shimmed.
const nacl = require('tweetnacl');
const crypto = require('crypto');

// ── Apps Script shims ───────────────────────────────────────────────────────
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
  computeDigest: (_alg, data) => toSigned(crypto.createHash('sha256').update(Buffer.from(data, 'utf8')).digest()),
  computeHmacSha256Signature: (data, key) =>
    toSigned(crypto.createHmac('sha256', Buffer.from(key.map(b => b & 0xff))).update(Buffer.from(data.map(b => b & 0xff))).digest()),
  base64Encode: bytes => Buffer.from(bytes.map(b => b & 0xff)).toString('base64'),
  base64Decode: b64 => toSigned(Buffer.from(b64, 'base64')),
  newBlob: str => ({ getBytes: () => toSigned(Buffer.from(str, 'utf8')) }),
};
global.Logger = { log: m => console.log('   [log] ' + m) };
global.nacl = nacl;

// ── load the module under test ──────────────────────────────────────────────
const fs = require('fs');
const src = fs.readFileSync('/Users/thutrang290902gmail.com/Desktop/Projects/fhtest/pipeline/sealed-box.gs', 'utf8');
eval(src);

let pass = 0, fail = 0;
const t = (name, ok, detail) => {
  console.log((ok ? '  PASS  ' : '  FAIL  ') + name + (detail && !ok ? '  -> ' + detail : ''));
  ok ? pass++ : fail++;
};

console.log('\n── DRBG ──');
const a = sealedBoxRandomBytes(32);
const b = sealedBoxRandomBytes(32);
t('returns requested length', a.length === 32);
t('values in byte range 0..255', Array.from(a).every(x => x >= 0 && x <= 255));
t('consecutive calls differ (counter advances)', Buffer.compare(Buffer.from(a), Buffer.from(b)) !== 0);
const big = sealedBoxRandomBytes(100);
t('spans multiple HMAC blocks correctly', big.length === 100 && Array.from(big).every(x => x >= 0 && x <= 255));
// crude sanity: 1000 bytes should have decent spread, not a stuck pattern
const many = sealedBoxRandomBytes(1000);
const distinct = new Set(Array.from(many)).size;
t('distribution not degenerate (>200 distinct byte values in 1000)', distinct > 200, 'distinct=' + distinct);

console.log('\n── seal / open round trip ──');
const familyKp = nacl.box.keyPair.fromSecretKey(Buffer.from('AQIDBAUGBwgJCgsMDQ4PEBESExQVFhcYGRobHB0eHyA=', 'base64'));
const familyPubB64 = Buffer.from(familyKp.publicKey).toString('base64');

const payload = { amount: 2000, currency: 'VND', counterparty: 'NGUYEN THU TRANG - 0944684991', raw_body: 'Ngày, giờ giao dịch 01-08-2026' };
const row = sealForFamily(payload, familyPubB64, 'fam-1', 'gmail-1');

t('emits sealed/eph_pub/nonce/enc_v', !!(row.sealed && row.eph_pub && row.nonce && row.enc_v === 1));
t('eph_pub is 32 bytes', Buffer.from(row.eph_pub, 'base64').length === 32);
t('nonce is 24 bytes', Buffer.from(row.nonce, 'base64').length === 24);

// the client's open path
const opened = nacl.box.open(
  new Uint8Array(Buffer.from(row.sealed, 'base64')),
  new Uint8Array(Buffer.from(row.nonce, 'base64')),
  new Uint8Array(Buffer.from(row.eph_pub, 'base64')),
  familyKp.secretKey
);
t('family can open it', opened !== null);
const got = opened ? JSON.parse(Buffer.from(opened).toString('utf8')) : {};
t('amount survives', got.amount === 2000);
t('unicode counterparty survives', got.counterparty === 'NGUYEN THU TRANG - 0944684991');
t('vietnamese diacritics survive', got.raw_body === 'Ngày, giờ giao dịch 01-08-2026');
t('family_id bound inside', got.family_id === 'fam-1');
t('gmail_message_id bound inside', got.gmail_message_id === 'gmail-1');

console.log('\n── the security properties we actually claim ──');
const wrongKp = nacl.box.keyPair();
t('a DIFFERENT family cannot open it', nacl.box.open(
  new Uint8Array(Buffer.from(row.sealed, 'base64')),
  new Uint8Array(Buffer.from(row.nonce, 'base64')),
  new Uint8Array(Buffer.from(row.eph_pub, 'base64')), wrongKp.secretKey) === null);

// the robot's own leftovers must not open it: eph_pub + family_pub + BASE is all
// the server retains, and none of it is a secret
t('eph_pub alone cannot open it (no secret retained server-side)', nacl.box.open(
  new Uint8Array(Buffer.from(row.sealed, 'base64')),
  new Uint8Array(Buffer.from(row.nonce, 'base64')),
  familyKp.publicKey, new Uint8Array(32)) === null);

const tampered = Buffer.from(row.sealed, 'base64'); tampered[5] ^= 0xff;
t('tampered ciphertext is rejected (Poly1305 auth)', nacl.box.open(
  new Uint8Array(tampered),
  new Uint8Array(Buffer.from(row.nonce, 'base64')),
  new Uint8Array(Buffer.from(row.eph_pub, 'base64')), familyKp.secretKey) === null);

const row2 = sealForFamily(payload, familyPubB64, 'fam-1', 'gmail-2');
t('same payload seals differently each time (fresh eph + nonce)', row2.sealed !== row.sealed && row2.eph_pub !== row.eph_pub);

console.log('\n── key pinning ──');
assertFamilyPubPinned('fam-1', familyPubB64);
let pinned = true;
try { assertFamilyPubPinned('fam-1', familyPubB64); } catch (e) { pinned = false; }
t('same key passes on later calls', pinned);
let swapped = false;
try { assertFamilyPubPinned('fam-1', Buffer.from(wrongKp.publicKey).toString('base64')); }
catch (e) { swapped = String(e).indexOf('SEALED_BOX_PIN_MISMATCH') !== -1; }
t('swapped key is refused', swapped);

console.log('\n── guards ──');
let noPub = false;
try { sealForFamily(payload, '', 'f', 'g'); } catch (e) { noPub = String(e).indexOf('SEALED_BOX_NO_FAMILY_PUB') !== -1; }
t('refuses to seal without a family_pub', noPub);
let badLen = false;
try { sealForFamily(payload, Buffer.from('short').toString('base64'), 'f', 'g'); }
catch (e) { badLen = String(e).indexOf('SEALED_BOX_BAD_PUB_LENGTH') !== -1; }
t('refuses a malformed family_pub', badLen);

console.log('\n' + (fail === 0 ? 'ALL ' + pass + ' PASSED' : pass + ' passed, ' + fail + ' FAILED'));
process.exit(fail === 0 ? 0 : 1);
