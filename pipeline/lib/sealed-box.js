// Sealed staging — the Node seal side, for the direct-read (OAuth) path.
//
// Third implementation of ONE envelope format. The other two:
//   * `pipeline/sealed-box.gs`      — seal side, Apps Script (forwarding path)
//   * `src/js-data/18-staging-keys.js` — open side, browser (the review screen)
//
// All three are pinned to the same published test vector (AGENT_SYNC
// 2026-08-09), which is what `pipeline/sealed-box-node.test.js` checks. If this
// file drifts, that test fails rather than the review screen quietly showing
// "unreadable" to a real family.
//
// ── What it is for ──────────────────────────────────────────────────────────
//
// The pipeline writes staged rows it can never read back. Each row is sealed to
// the family's staging PUBLIC key; the private half is DEK-wrapped and only
// exists on an unlocked family device. So the queue between "email arrived" and
// "human approved it" is not readable by the database, by an operator, or by
// the code doing the sealing.
//
// That matters more under direct read than under forwarding. With forwarding
// the user hand-picked every message we saw. Here we hold a grant over the
// whole mailbox and pull what matches a query — so "we cannot read what we
// store" is doing much more work in the promise, and has to be actually true.
//
// ── One deliberate difference from the .gs ──────────────────────────────────
//
// The .gs hand-rolls an HMAC-counter DRBG because Apps Script has no
// `crypto.getRandomValues` — flagged in SEALED-STAGING-DESIGN.md §8 as "the
// difference between real encryption and decoration". Node has a real CSPRNG,
// so that entire construction is gone: `crypto.randomBytes` here, and
// tweetnacl's own PRNG for the ephemeral keypair. This was listed in
// OAUTH-DIRECT-READ.md §2 as one of the three real wins of moving off Apps
// Script. It is the only difference; the bytes on the wire are identical.

'use strict';

const crypto = require('crypto');
const nacl = require('tweetnacl');

const SEALED_BOX_VERSION = 1;

// tweetnacl asks for randomness through this hook. Node's CSPRNG, directly —
// no DRBG, no seed material in a properties store, nothing to get wrong.
nacl.setPRNG((x, n) => {
  const b = crypto.randomBytes(n);
  for (let i = 0; i < n; i++) x[i] = b[i];
  b.fill(0);
});

const _b64 = (bytes) => Buffer.from(bytes).toString('base64');
const _unb64 = (b64) => new Uint8Array(Buffer.from(String(b64), 'base64'));
const _utf8 = (str) => new Uint8Array(Buffer.from(String(str), 'utf8'));

/**
 * Seals a payload to a family's staging public key.
 *
 * family_id and gmail_message_id are injected into the sealed plaintext and
 * verified by the opener. That is the anti-relocation binding: a ciphertext
 * moved to another row or another family opens to a payload whose bound ids
 * disagree with the row it was found in, and the client rejects it. Callers
 * must not rely on having set them.
 *
 * @param {Object} payload        the sensitive fields
 * @param {string} familyPubB64   family staging X25519 public key, base64
 * @param {string} familyId       bound inside, verified on open
 * @param {string} gmailMessageId bound inside, verified on open
 * @return {{sealed:string, eph_pub:string, nonce:string, enc_v:number}}
 */
function sealForFamily(payload, familyPubB64, familyId, gmailMessageId) {
  if (!familyPubB64) throw new Error('SEALED_BOX_NO_FAMILY_PUB');
  if (!familyId) throw new Error('SEALED_BOX_NO_FAMILY_ID');
  if (!gmailMessageId) throw new Error('SEALED_BOX_NO_MESSAGE_ID');

  const bound = Object.assign({}, payload, {
    family_id: familyId,
    gmail_message_id: gmailMessageId,
    enc_v: SEALED_BOX_VERSION,
  });

  const familyPub = _unb64(familyPubB64);
  if (familyPub.length !== 32) throw new Error('SEALED_BOX_BAD_PUB_LENGTH: ' + familyPub.length);

  const eph = nacl.box.keyPair();                 // secretKey dies with this scope
  const nonce = new Uint8Array(crypto.randomBytes(nacl.box.nonceLength));
  const sealed = nacl.box(_utf8(JSON.stringify(bound)), nonce, familyPub, eph.secretKey);
  if (!sealed) throw new Error('SEALED_BOX_SEAL_FAILED');

  // Best-effort scrub. JS gives no guarantee, but zeroing removes the value
  // from the buffer that would otherwise sit in memory until GC.
  eph.secretKey.fill(0);

  return {
    sealed: _b64(sealed),
    eph_pub: _b64(eph.publicKey),
    nonce: _b64(nonce),
    enc_v: SEALED_BOX_VERSION,
  };
}

// Trust-on-first-use pin (defense 1, AGENT_SYNC 2026-08-09). The .gs keeps its
// pin in Script Properties — a different trust domain from Supabase, so a
// database-only attacker who swaps family_pub cannot also move the pin.
//
// In serverless there is no equivalent local store, so the pin has to be
// supplied by the caller from somewhere outside the row being sealed to. The
// caller passes the previously-seen fingerprint; a mismatch REFUSES to seal.
// Refusing costs one retry cycle. Sealing to an unrecognised key hands new rows
// to whoever swapped it, permanently.
//
// This does nothing against an operator who controls both stores — that case is
// covered by the device-side self-check (fhStagingVerifyServerKey), which is
// the actual detector.
function fingerprintFamilyPub(familyPubB64) {
  return crypto.createHash('sha256').update(String(familyPubB64), 'utf8').digest('base64');
}

function assertFamilyPubPinned(familyPubB64, seenFingerprint) {
  const fp = fingerprintFamilyPub(familyPubB64);
  if (!seenFingerprint) return fp;                 // first sight — caller stores it
  if (seenFingerprint !== fp) {
    throw new Error('SEALED_BOX_PIN_MISMATCH: family staging key changed (expected ' +
      seenFingerprint + ', got ' + fp + ')');
  }
  return fp;
}

// Opens a sealed row. NOT used in production by this side — the whole point is
// that the pipeline cannot read what it wrote. It exists so the tests can prove
// the envelope round-trips against the published vector, and so a developer
// holding a family private key can debug one row by hand.
function openSealedRow(row, familyPrivBytes) {
  if (row.enc_v !== SEALED_BOX_VERSION) throw new Error('staging_enc_version_unsupported:' + row.enc_v);
  const opened = nacl.box.open(_unb64(row.sealed), _unb64(row.nonce), _unb64(row.eph_pub), familyPrivBytes);
  if (!opened) throw new Error('staging_open_failed');
  const payload = JSON.parse(Buffer.from(opened).toString('utf8'));
  if (row.family_id && payload.family_id !== row.family_id) throw new Error('staging_family_mismatch');
  if (row.gmail_message_id && payload.gmail_message_id !== row.gmail_message_id) throw new Error('staging_row_mismatch');
  return payload;
}

module.exports = {
  SEALED_BOX_VERSION,
  sealForFamily,
  openSealedRow,
  fingerprintFamilyPub,
  assertFamilyPubPinned,
};
