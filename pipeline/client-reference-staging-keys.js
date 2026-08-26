/**
 * REFERENCE IMPLEMENTATION — client side of sealed staging.
 *
 * NOT WIRED IN. This file is a proposal for the encryption owner to review and
 * fold into `src/js-data/15-crypto.js`. It deliberately lives in pipeline/ so it
 * doesn't collide with the Key Card work in progress in that file.
 *
 * Counterpart to `pipeline/sealed-box.gs` (seal side, built + tested). Design and
 * rationale: `pipeline/SEALED-STAGING-DESIGN.md`. Test vector: AGENT_SYNC.md.
 *
 * The crypto here is tested against that vector (13 assertions, including the
 * relocation and tamper cases). Storage and the first-writer-wins race are
 * settled by migration 0051. What remains for the reviewer is only:
 *   ⚙ call fhStagingEnsureKeypair() + fhStagingVerifyServerKey() at unlock
 *   ⚙ decide how the mismatch alarm surfaces (UI drafted: prototype screen 5)
 *   ⚙ swap _rpc() for the app's own rpc helper if there is one
 *
 * DEPENDENCY: TweetNaCl in the client bundle (per constraint 4 — TweetNaCl for
 * the envelope, WebCrypto only for the private-key wrap, which is what fhEnc/
 * fhDec already do).
 *
 * Conventions followed from 15-crypto.js: `fh` prefix, window exports, fhEnc/
 * fhDec for DEK operations, fhKeyReady() as the "is the safe open" test,
 * window.DB.fid as the active family.
 */

(function () {
  'use strict';

  var STAGING_ENC_V = 1;

  // ── byte helpers (match the b64 conventions the .gs side emits) ────────────
  function _b64ToBytes(b64) {
    var bin = atob(b64);
    var out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  function _bytesToB64(bytes) {
    var s = '';
    for (var i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return btoa(s);
  }

  /**
   * Open one sealed staging row.
   *
   * @param {{sealed:string, eph_pub:string, nonce:string, enc_v:number,
   *          family_id:string, gmail_message_id:string}} row  as stored
   * @param {Uint8Array} familyPriv  from fhStagingPrivKey()
   * @return {Object} the payload
   * @throws on a version we don't know, on failed authentication (tamper or
   *         wrong key), or on an identity mismatch (relocated ciphertext).
   */
  function fhStagingOpenRow(row, familyPriv) {
    if (row.enc_v !== STAGING_ENC_V) {
      throw new Error('staging_enc_version_unsupported:' + row.enc_v);
    }
    var opened = nacl.box.open(
      _b64ToBytes(row.sealed),
      _b64ToBytes(row.nonce),
      _b64ToBytes(row.eph_pub),
      familyPriv
    );
    // null means Poly1305 rejected it: either the bytes were tampered with, or
    // this is not our box. Both are integrity failures, not parse errors —
    // surface them as such rather than skipping the row silently.
    if (!opened) throw new Error('staging_open_failed');

    var payload = JSON.parse(new TextDecoder().decode(opened));

    /* Constraint 1: the sealer binds identity INSIDE the box. If the inside
       disagrees with the row it arrived on, someone moved ciphertext between
       rows — the amounts would land on the wrong transaction.

       WHICH identity depends on the scope, and the payload says which by which
       key it carries (0091). A family row binds `family_id`; a PERSONAL row
       binds `owner_user_id`, because a personal-only user has no family at all.
       They are different key names on purpose: reusing one for the other would
       let a payload sealed in one scope satisfy the other's check, which is the
       single thing this binding exists to prevent.

       Both compared values are supplied by the CALLER from what it already
       knows — the active family, or its own user id — never read back from the
       row the server sent. A check against the server's own claim would verify
       nothing. */
    var boundOk = (payload.owner_user_id != null)
      ? payload.owner_user_id === row.owner_user_id
      : payload.family_id === row.family_id;
    if (!boundOk || payload.gmail_message_id !== row.gmail_message_id) {
      throw new Error('staging_identity_mismatch');
    }
    return payload;
  }

  /**
   * The family's staging private key, unwrapped with the DEK.
   * Requires an unlocked safe — fhKeyReady() must be true.
   */
  // Cached per session so unlock costs one round trip, not one per row.
  var _stagingKeyCache = null;
  async function fhStagingKeys() {
    if (_stagingKeyCache) return _stagingKeyCache;
    _stagingKeyCache = await _rpc('get_family_staging_key', {});  // migration 0051
    return _stagingKeyCache;
  }
  function fhStagingKeysForget() { _stagingKeyCache = null; }     // call on sign-out / family switch

  async function fhStagingPrivKey() {
    if (!window.fhKeyReady || !window.fhKeyReady()) throw new Error('locked');
    var keys = await fhStagingKeys();
    if (!keys || !keys.staging_priv_enc) throw new Error('staging_keypair_missing');
    var b64 = await window.fhDecStr(keys.staging_priv_enc);   // DEK unwrap, his fhDecStr
    if (!b64) throw new Error('staging_priv_unwrap_failed');
    return _b64ToBytes(b64);
  }

  /**
   * Ensure the family has a staging keypair; create one if not.
   *
   * MUST run with the DEK present (that is the only moment the private key can
   * be wrapped). MUST be first-writer-wins at the database — two devices opening
   * the app in the same minute must not both generate, or the family ends up with
   * two padlocks and half the boxes unopenable.
   *
   * NEVER regenerates when one already exists: a second keypair orphans every
   * box sealed to the first. Rotation is a separate, deliberate ceremony.
   */
  async function fhStagingEnsureKeypair() {
    if (!window.fhKeyReady || !window.fhKeyReady()) return false;   // try again after unlock
    var keys = await fhStagingKeys();
    if (keys && keys.staging_pub) return false;                     // already provisioned

    var kp = nacl.box.keyPair();                                    // browser CSPRNG
    var wrapped = await window.fhEncStr(_bytesToB64(kp.secretKey)); // ⚙ DEK wrap
    if (!wrapped) throw new Error('staging_priv_wrap_failed');

    // First-writer-wins happens server-side (migration 0051): the RPC only
    // writes when staging_pub is still null, then returns whatever is
    // authoritative — ours if we won the race, the other device's if we lost.
    // Adopt the result either way; never retry with a fresh keypair.
    var winning = await _rpc('set_family_staging_key', {
      p_pub: _bytesToB64(kp.publicKey),
      p_priv_enc: wrapped,
    });

    _stagingKeyCache = winning;
    for (var i = 0; i < kp.secretKey.length; i++) kp.secretKey[i] = 0;
    return true;
  }

  /**
   * Defense 2 — the real detector for key substitution.
   *
   * Re-derives the public key from our own private key and compares it with the
   * copy the server handed us. An operator who swaps the stored key cannot make
   * this pass, because they cannot produce a value derived from a secret they
   * have never held. The robot-side pin only stops database-only attackers; this
   * is what catches everyone.
   *
   * Run on every unlock. Cheap: one scalar multiplication.
   * On false → freeze approval of new staged rows, alert the family, and state
   * plainly that existing ledger data is untouched (prototype screen 5).
   *
   * NOTE for whoever builds key rotation later: a legitimate rotation MUST
   * announce itself through the DEK-authenticated path, or the first real
   * rotation trips this on every device at once and the alarm loses all
   * credibility. It gets zero false positives.
   */
  async function fhStagingVerifyServerKey() {
    var keys = await fhStagingKeys();
    if (!keys || !keys.staging_pub) return true;         // nothing provisioned yet
    var priv = await fhStagingPrivKey();
    var derived = _bytesToB64(nacl.box.keyPair.fromSecretKey(priv).publicKey);
    for (var i = 0; i < priv.length; i++) priv[i] = 0;
    return derived === keys.staging_pub;
  }

  // Minimal supabase-js call; swap for whatever the app's rpc helper is.
  async function _rpc(fn, args) {
    var res = await window.sb.rpc(fn, args);
    if (res.error) throw new Error('rpc_' + fn + ': ' + res.error.message);
    return res.data;
  }

  window.fhStagingOpenRow = fhStagingOpenRow;
  window.fhStagingKeysForget = fhStagingKeysForget;
  window.fhStagingPrivKey = fhStagingPrivKey;
  window.fhStagingEnsureKeypair = fhStagingEnsureKeypair;
  window.fhStagingVerifyServerKey = fhStagingVerifyServerKey;
})();

/* ── Storage: settled in migration 0051 ─────────────────────────────────────
 * family_keys.staging_pub       text  -- base64 X25519 public key, in the clear
 * family_keys.staging_priv_enc  text  -- base64 private key, encVal(DEK, priv)
 * RPCs: set_family_staging_key(p_pub, p_priv_enc) — first-writer-wins, returns
 *       whichever key is authoritative; get_family_staging_key() — reads both.
 * get_family_snapshot is deliberately untouched (see the migration header).
 *
 * STILL OPEN — what should the robot do for a family with no staging_pub yet?
 * Every existing family is in that state today, and a new one is until someone
 * opens the app. (a) hold the email unprocessed until a key appears — clean,
 * but transactions stall silently for inactive families; (b) write plaintext and
 * seal later — reintroduces exactly the window sealing exists to remove.
 * Leaning (a) with a visible "waiting for your first app open" state.
 */
