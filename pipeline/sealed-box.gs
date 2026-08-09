/**
 * Sealed-box staging encryption — Apps Script (seal side).
 *
 * Design + rationale: pipeline/SEALED-STAGING-DESIGN.md
 * Construction agreed with the encryption owner (AGENT_SYNC 2026-08-09):
 *   1. family_id + gmail_message_id are bound INSIDE the sealed payload and
 *      verified on open (blocks ciphertext relocation between rows/families).
 *   2. dedup moves client-side (no server-readable amount index).
 *   3. family keypair is generated on-device with the DEK present; family_pub
 *      stored clear, family_priv stored as encVal(DEK, family_priv).
 *   4. TweetNaCl on both ends for the envelope; WebCrypto only for the
 *      private-key wrap (client side, not here).
 *
 * DEPENDENCY: add TweetNaCl as a second script file in the same Apps Script
 * project (nacl-fast.js from https://github.com/dchest/tweetnacl-js, v1.0.3).
 * Apps Script concatenates files into one global scope, so `nacl` is visible
 * here with no import. Do NOT paste it into this file — keep it separate so it
 * can be replaced wholesale when upgrading.
 *
 * WIRE FORMAT (v1) — what lands on an email_transactions row:
 *   sealed   : base64( nacl.box(payloadUtf8, nonce, family_pub, eph_priv) )
 *   eph_pub  : base64( 32-byte ephemeral public key )
 *   nonce    : base64( 24-byte nonce )
 *   enc_v    : 1
 * Opening (client): nacl.box.open(sealed, nonce, eph_pub, family_priv).
 * This is ephemeral-static X25519 + XSalsa20-Poly1305. The ephemeral secret is
 * destroyed immediately after sealing, so the only remaining route to the
 * shared secret runs through family_priv, which never leaves a family device.
 */

var SEALED_BOX_VERSION = 1;

// ─────────────────────────────────────────────────────────────────────────────
// Randomness
//
// Apps Script has NO crypto.getRandomValues and NO nacl.setPRNG source of its
// own. TweetNaCl refuses to generate keys without a PRNG, and Math.random() is
// a seeded 32-bit-ish PRNG — predictable ephemeral keys would make EVERY sealed
// box openable by anyone who can replay it. This is the single most dangerous
// line in the pipeline (SEALED-STAGING-DESIGN.md §8).
//
// So: one high-entropy seed, created once and stored in Script Properties, is
// stretched by an HMAC-SHA256 counter DRBG (NIST SP 800-90A HMAC_DRBG shape,
// simplified: no additional input, no prediction resistance — appropriate here
// because the seed never leaves Google's property store and the consumer is a
// single-threaded script).
//
// The seed itself is built from Utilities.getUuid() — Java's UUID.randomUUID()
// underneath, which is seeded from the platform CSPRNG — plus per-call clock
// jitter, folded through SHA-256. Multiple UUIDs are mixed so a weakness in any
// single draw doesn't determine the seed.
// ─────────────────────────────────────────────────────────────────────────────

var _DRBG_SEED_PROP = 'SEALED_BOX_DRBG_SEED';
var _DRBG_CTR_PROP = 'SEALED_BOX_DRBG_COUNTER';

function _drbgSeedBytes() {
  var props = PropertiesService.getScriptProperties();
  var seedB64 = props.getProperty(_DRBG_SEED_PROP);
  if (!seedB64) {
    // First run on this project: mint a seed. 8 UUIDs = 8 * 122 bits of
    // platform CSPRNG entropy, folded to 256 bits by SHA-256.
    var material = '';
    for (var i = 0; i < 8; i++) {
      material += Utilities.getUuid() + ':' + new Date().getTime() + ':' + i + ';';
    }
    var digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, material, Utilities.Charset.UTF_8);
    seedB64 = Utilities.base64Encode(digest);
    props.setProperty(_DRBG_SEED_PROP, seedB64);
    props.setProperty(_DRBG_CTR_PROP, '0');
  }
  return Utilities.base64Decode(seedB64);
}

// Returns n cryptographically-suitable random bytes as a Uint8Array.
// Each call advances a persistent counter, so two calls never produce the same
// output even within the same millisecond or across executions.
function sealedBoxRandomBytes(n) {
  var props = PropertiesService.getScriptProperties();
  var seed = _drbgSeedBytes();
  var counter = Number(props.getProperty(_DRBG_CTR_PROP) || '0');

  var out = new Uint8Array(n);
  var filled = 0;
  while (filled < n) {
    // HMAC-SHA256(seed, counter) — 32 bytes per block
    var block = Utilities.computeHmacSha256Signature(
      Utilities.newBlob(String(counter)).getBytes(), seed);
    counter++;
    for (var i = 0; i < block.length && filled < n; i++) {
      // Apps Script byte[] is signed (-128..127); normalise to 0..255
      out[filled++] = block[i] & 0xff;
    }
  }
  props.setProperty(_DRBG_CTR_PROP, String(counter));
  return out;
}

// Wire TweetNaCl's PRNG to the DRBG above. Must run before any nacl key
// generation. Calling it repeatedly is harmless.
function initSealedBoxPrng() {
  if (typeof nacl === 'undefined') {
    throw new Error('SEALED_BOX_NO_NACL: add the TweetNaCl library as a second script file');
  }
  nacl.setPRNG(function (x, len) {
    var bytes = sealedBoxRandomBytes(len);
    for (var i = 0; i < len; i++) x[i] = bytes[i];
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Seal
// ─────────────────────────────────────────────────────────────────────────────

function _utf8ToBytes(str) {
  var signed = Utilities.newBlob(str).getBytes();
  var out = new Uint8Array(signed.length);
  for (var i = 0; i < signed.length; i++) out[i] = signed[i] & 0xff;
  return out;
}

function _b64(bytes) {
  var arr = [];
  for (var i = 0; i < bytes.length; i++) arr.push(bytes[i] > 127 ? bytes[i] - 256 : bytes[i]);
  return Utilities.base64Encode(arr);
}

function _unb64(b64) {
  var signed = Utilities.base64Decode(b64);
  var out = new Uint8Array(signed.length);
  for (var i = 0; i < signed.length; i++) out[i] = signed[i] & 0xff;
  return out;
}

/**
 * Seals a payload to a family's public key.
 *
 * @param {Object} payload      the sensitive fields. familyId and gmailMessageId
 *                              are injected here — callers must not rely on
 *                              having set them.
 * @param {string} familyPubB64 the family's X25519 public key, base64.
 * @param {string} familyId     bound inside the payload (anti-relocation).
 * @param {string} gmailMessageId bound inside the payload (anti-relocation).
 * @return {{sealed: string, eph_pub: string, nonce: string, enc_v: number}}
 */
function sealForFamily(payload, familyPubB64, familyId, gmailMessageId) {
  if (!familyPubB64) throw new Error('SEALED_BOX_NO_FAMILY_PUB');
  initSealedBoxPrng();

  var bound = {};
  for (var k in payload) bound[k] = payload[k];
  bound.family_id = familyId;               // verified on open
  bound.gmail_message_id = gmailMessageId;  // verified on open
  bound.enc_v = SEALED_BOX_VERSION;

  var familyPub = _unb64(familyPubB64);
  if (familyPub.length !== 32) throw new Error('SEALED_BOX_BAD_PUB_LENGTH: ' + familyPub.length);

  var eph = nacl.box.keyPair();                       // eph.secretKey dies with this scope
  var nonce = sealedBoxRandomBytes(nacl.box.nonceLength);
  var sealed = nacl.box(_utf8ToBytes(JSON.stringify(bound)), nonce, familyPub, eph.secretKey);
  if (!sealed) throw new Error('SEALED_BOX_SEAL_FAILED');

  // Best-effort scrub. JS gives no guarantee, but zeroing removes the value from
  // the buffer that would otherwise sit in memory until GC.
  for (var i = 0; i < eph.secretKey.length; i++) eph.secretKey[i] = 0;

  return {
    sealed: _b64(sealed),
    eph_pub: _b64(eph.publicKey),
    nonce: _b64(nonce),
    enc_v: SEALED_BOX_VERSION,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Key pinning (defense 1, AGENT_SYNC 2026-08-09)
//
// Trust-on-first-use. The pin lives in Script Properties (Google) while the key
// lives in Supabase — different trust domains, so a database-only attacker who
// swaps family_pub cannot also change the pin, and sealing stops. This does
// nothing against an operator who controls both; that case is covered by the
// device-side self-check, which is the actual detector.
// ─────────────────────────────────────────────────────────────────────────────

function assertFamilyPubPinned(familyId, familyPubB64) {
  var props = PropertiesService.getScriptProperties();
  var pinKey = 'FAMILY_PUB_PIN_' + familyId;
  var seen = props.getProperty(pinKey);
  var digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, familyPubB64, Utilities.Charset.UTF_8);
  var fingerprint = Utilities.base64Encode(digest);

  if (!seen) {
    props.setProperty(pinKey, fingerprint);
    return;
  }
  if (seen !== fingerprint) {
    // Refuse to seal. Sealing to an unrecognised key would hand new rows to
    // whoever swapped it; leaving the message queued costs one retry cycle.
    throw new Error('SEALED_BOX_PIN_MISMATCH: family_pub changed for ' + familyId +
      ' (expected ' + seen + ', got ' + fingerprint + ')');
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Test vector generator — run manually, paste output into AGENT_SYNC so the
// client implementation can be checked against the exact same bytes.
// Uses a FIXED keypair (not the DRBG) so the vector is reproducible.
// ─────────────────────────────────────────────────────────────────────────────

function generateSealedBoxTestVector() {
  initSealedBoxPrng();
  // Deliberately non-random fixed secret (bytes 0x01..0x20) so the vector is
  // reproducible on both sides. NEVER use a fixed key outside this generator.
  var familySecret = _unb64('AQIDBAUGBwgJCgsMDQ4PEBESExQVFhcYGRobHB0eHyA=');  // 32 bytes
  var familyKp = nacl.box.keyPair.fromSecretKey(familySecret);

  var payload = { amount: 2000, currency: 'VND', counterparty: 'NGUYEN THU TRANG - 0944684991' };
  var out = sealForFamily(payload, _b64(familyKp.publicKey), 'fam-test-0001', 'gmail-test-0001');

  Logger.log('family_secret (b64): ' + _b64(familySecret));
  Logger.log('family_pub    (b64): ' + _b64(familyKp.publicKey));
  Logger.log('sealed  : ' + out.sealed);
  Logger.log('eph_pub : ' + out.eph_pub);
  Logger.log('nonce   : ' + out.nonce);
  Logger.log('expected plaintext on open: ' + JSON.stringify({
    amount: 2000, currency: 'VND', counterparty: 'NGUYEN THU TRANG - 0944684991',
    family_id: 'fam-test-0001', gmail_message_id: 'gmail-test-0001', enc_v: 1,
  }));
  return out;
}
