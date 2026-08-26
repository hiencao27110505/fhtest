/**
 * Sealed-box staging encryption — direct-read seal side.
 *
 * Design and rationale: pipeline/SEALED-STAGING-DESIGN.md. This is the second
 * implementation of the seal half; the first is pipeline/sealed-box.gs, which
 * serves the forwarding transport from Apps Script. They MUST agree byte for
 * byte, because one client opener reads rows from both:
 * fhStagingOpenRow in src/js-data/18-staging-keys.js.
 *
 * WIRE FORMAT (v1) — what lands on an email_transactions row:
 *   sealed   : base64( nacl.box(payloadUtf8, nonce, family_pub, eph_priv) )
 *   eph_pub  : base64( 32-byte ephemeral public key )
 *   nonce    : base64( 24-byte nonce )
 *   enc_v    : 1
 * Ephemeral-static X25519 + XSalsa20-Poly1305. The ephemeral secret is
 * destroyed immediately after sealing, so the only remaining route to the
 * shared secret runs through family_priv, which never leaves a family device.
 *
 * WHAT IS DIFFERENT FROM THE APPS SCRIPT VERSION, AND WHY IT MATTERS
 *
 * The .gs file carries an HMAC-SHA256 counter DRBG, roughly 70 lines of it,
 * because Apps Script has no crypto.getRandomValues and TweetNaCl refuses to
 * generate keys without a PRNG. SEALED-STAGING-DESIGN §8 calls that line the
 * difference between real encryption and decoration, and OAUTH-DIRECT-READ §2
 * lists deleting it among the reasons to move off forwarding.
 *
 * None of it is ported. This runtime has a real CSPRNG, so the ephemeral secret
 * comes straight from it. That is the whole of the difference: same curve, same
 * cipher, same envelope, same binding, one less thing to be wrong about.
 *
 * DEPENDENCIES ARE INJECTED, not imported. `nacl` resolves differently in Deno
 * (npm: specifier) and in the Node test runner (node_modules), and a module
 * that picks one cannot be exercised by the other. Injection also means the
 * randomness source is visible in the call, which for this file is the point.
 */

export const SEALED_BOX_VERSION = 1;

const KEY_BYTES = 32;
const NONCE_BYTES = 24;

/**
 * Fills `n` bytes from the platform CSPRNG.
 *
 * Deliberately NOT falling back to anything when `crypto.getRandomValues` is
 * absent. A fallback here is the failure this file exists to avoid: predictable
 * ephemeral keys make every box openable by anyone who can replay them, and
 * unlike a wrong amount it would never surface. Throwing is the correct
 * behaviour — the caller holds a message and will retry it.
 */
export function randomBytes(n, source) {
  const rng = source || (typeof globalThis !== 'undefined' && globalThis.crypto);
  if (!rng || typeof rng.getRandomValues !== 'function') {
    throw new Error('SEALED_BOX_NO_CSPRNG');
  }
  return rng.getRandomValues(new Uint8Array(n));
}

/** base64 of raw bytes. Matches the client's _sbytesToB64 exactly. */
export function b64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

/** raw bytes from base64. Matches the client's _sb64ToBytes exactly. */
export function unb64(s) {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function utf8(str) {
  return new TextEncoder().encode(str);
}

/**
 * Seals a payload to a family's staging public key.
 *
 * `familyId` and `gmailMessageId` are injected into the plaintext here rather
 * than trusted from the caller's payload — the opener verifies them against the
 * row's own columns, so this is the anti-relocation binding and it must not be
 * something a caller can forget to set. Without it, anyone with database write
 * access could move a ciphertext onto another row of the same family and land
 * the wrong amount on the wrong transaction.
 *
 * Throws on every failure. There is no shape of return value that means "could
 * not seal, carry on" — see stage.mjs, where a throw becomes a HOLD.
 *
 * @param {object} payload         the sensitive fields
 * @param {string} familyPubB64    the family's X25519 public key, base64
 * @param {string} scopeId         the family id, or the owner's user id for a
 *                                 personal row — bound inside, verified on open
 * @param {string} gmailMessageId  bound inside, verified on open
 * @param {{nacl: object, rng?: object}} deps
 * @return {{sealed: string, eph_pub: string, nonce: string, enc_v: number}}
 */
export function sealForFamily(payload, familyPubB64, scopeId, gmailMessageId, deps, scope) {
  const nacl = deps && deps.nacl;
  if (!nacl || !nacl.box) throw new Error('SEALED_BOX_NO_NACL');
  if (!familyPubB64) throw new Error('SEALED_BOX_NO_FAMILY_PUB');
  if (!scopeId) throw new Error('SEALED_BOX_NO_FAMILY_ID');
  if (!gmailMessageId) throw new Error('SEALED_BOX_NO_MESSAGE_ID');

  const familyPub = unb64(familyPubB64);
  if (familyPub.length !== KEY_BYTES) {
    throw new Error('SEALED_BOX_BAD_PUB_LENGTH: ' + familyPub.length);
  }

  /* WHAT IDENTITY IS BOUND INSIDE, and why it is not always the family.
     The binding exists so that ciphertext moved between rows is detected rather
     than decrypted onto the wrong transaction: the opener re-checks it against
     the row it arrived on. For a family row that identity is the family. For a
     PERSONAL row (0091) there may be no family at all — the person is the root
     — so the owner's user id plays exactly the same part.

     Written under DIFFERENT KEY NAMES on purpose. Reusing `family_id` for a
     user id would let a payload sealed in one scope satisfy the other's check,
     which is the single thing this binding exists to prevent. The family path
     is byte-identical to before, so the Apps Script and every already-sealed
     row are unaffected. */
  const bound = { ...payload };
  if (scope === 'personal') bound.owner_user_id = scopeId;
  else bound.family_id = scopeId;
  bound.gmail_message_id = gmailMessageId;
  bound.enc_v = SEALED_BOX_VERSION;

  // The ephemeral secret comes from the platform CSPRNG rather than from
  // nacl.box.keyPair(), so this file never depends on TweetNaCl finding a PRNG
  // for itself — which is exactly what it fails to do on some runtimes, and it
  // fails by throwing at key generation rather than by producing weak keys.
  const ephSecret = randomBytes(KEY_BYTES, deps && deps.rng);
  const eph = nacl.box.keyPair.fromSecretKey(ephSecret);
  const nonce = randomBytes(NONCE_BYTES, deps && deps.rng);

  const sealed = nacl.box(utf8(JSON.stringify(bound)), nonce, familyPub, eph.secretKey);
  if (!sealed) throw new Error('SEALED_BOX_SEAL_FAILED');

  // Best-effort scrub of both copies. JS guarantees nothing here, but zeroing
  // removes the value from buffers that would otherwise sit in memory until GC
  // — and on a warm serverless instance that can be a long time.
  ephSecret.fill(0);
  eph.secretKey.fill(0);

  return {
    sealed: b64(sealed),
    eph_pub: b64(eph.publicKey),
    nonce: b64(nonce),
    enc_v: SEALED_BOX_VERSION,
  };
}

/**
 * Opens a sealed row. Present for TESTS and for operational verification, not
 * for the worker: the worker holds no family private key and must not be able
 * to acquire one, which is the property the whole design rests on.
 *
 * Mirrors fhStagingOpenRow in src/js-data/18-staging-keys.js, including the
 * identity check, so a test here proves what the client will do rather than
 * something adjacent to it.
 */
export function openSealedRow(row, familyPriv, deps) {
  const nacl = deps && deps.nacl;
  if (!nacl || !nacl.box) throw new Error('SEALED_BOX_NO_NACL');
  if (row.enc_v !== SEALED_BOX_VERSION) {
    throw new Error('staging_enc_version_unsupported:' + row.enc_v);
  }
  const opened = nacl.box.open(
    unb64(row.sealed), unb64(row.nonce), unb64(row.eph_pub), familyPriv,
  );
  if (!opened) throw new Error('staging_open_failed');

  const payload = JSON.parse(new TextDecoder().decode(opened));
  if (payload.family_id !== row.family_id ||
      payload.gmail_message_id !== row.gmail_message_id) {
    throw new Error('staging_identity_mismatch');
  }
  return payload;
}
