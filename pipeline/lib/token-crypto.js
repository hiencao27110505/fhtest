// Refresh-token envelope — AES-256-GCM, bound to the row it belongs to.
//
// ── What this protects, stated honestly ─────────────────────────────────────
//
// A Gmail refresh token is standing access to a user's ENTIRE mailbox until
// they revoke it. It is a bigger secret than anything else this project holds:
// the ledger is money data, this is a key to the source.
//
// It cannot be end-to-end encrypted the way transaction data is. E2EE works
// there because the family's DEK is present whenever the data is read — on
// their device, after unlock. Mailbox sync must run while every family member
// is asleep, so the server has to be able to use the token unattended, which
// means the server has to be able to decrypt it. There is no construction that
// avoids that and still delivers background sync. Anyone who tells you
// otherwise is describing a product that polls only while the app is open.
//
// So the claim here is deliberately narrower than the sealed-staging claim in
// SEALED-STAGING-DESIGN.md §1, and must be written that way anywhere it is
// shown to a user:
//
//   BLOCKED    — an attacker with the database (dump, backup, leaked
//                service-role key, SQL injection) gets ciphertext and nothing
//                else. The key is not in the database.
//   BLOCKED    — an attacker who moves a ciphertext to another row, or another
//                member, gets a decryption failure, not someone else's token.
//   NOT BLOCKED — an attacker holding BOTH the database and the server's
//                environment. Splitting those two is the entire protection.
//                Keep MAILBOX_TOKEN_KEY out of the repo, out of Supabase, and
//                out of anything the database credentials can reach.
//
// ── Row binding ─────────────────────────────────────────────────────────────
//
// The connection id and member id go into GCM's additional authenticated data,
// not into the plaintext. AAD is authenticated but not stored, so a ciphertext
// lifted out of row A and pasted into row B fails its tag check — the same
// property the sealed-box envelope gets by binding family_id + row id inside
// the sealed payload (the encryption owner's build constraint 1, AGENT_SYNC
// 2026-08-07). Same idea, same reason: ciphertext relocation is a real attack
// against a table an operator can write.
//
// ── Rotation ────────────────────────────────────────────────────────────────
//
// The envelope carries a key id, so MAILBOX_TOKEN_KEY can be rotated by adding
// a new key while keeping the old one readable. Rotation is a re-encrypt pass
// over mailbox_connections, not a migration. If a key is ever suspected lost,
// rotation is NOT sufficient — the tokens themselves must be revoked at Google,
// because a copy of the old ciphertext plus the old key still opens.

'use strict';

const crypto = require('crypto');

const ENVELOPE_VERSION = 'v1';
const ALGO = 'aes-256-gcm';
const IV_BYTES = 12;    // GCM standard; 96-bit nonce, never reused under one key
const TAG_BYTES = 16;
const KEY_BYTES = 32;

const b64u = {
  enc: (buf) => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''),
  dec: (s) => Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64'),
};

// Keys come from the environment as `<id>:<base64 32 bytes>`, comma-separated
// for rotation windows. The FIRST entry is the one new writes use.
//
//   MAILBOX_TOKEN_KEY="k2:base64newkey,k1:base64oldkey"
//
// Parsed per call rather than cached at module load: serverless instances are
// recycled constantly, and a stale key cache outliving a rotation is a
// debugging nightmare for no measurable gain.
function parseKeys(env) {
  const raw = (env && env.MAILBOX_TOKEN_KEY) || '';
  if (!raw) throw new Error('MAILBOX_TOKEN_KEY is not configured');
  const keys = [];
  for (const part of String(raw).split(',')) {
    const s = part.trim();
    if (!s) continue;
    const i = s.indexOf(':');
    if (i < 1) throw new Error('MAILBOX_TOKEN_KEY entry must look like "id:base64key"');
    const id = s.slice(0, i);
    const key = Buffer.from(s.slice(i + 1), 'base64');
    if (key.length !== KEY_BYTES) {
      throw new Error(`MAILBOX_TOKEN_KEY "${id}" must decode to ${KEY_BYTES} bytes, got ${key.length}`);
    }
    if (/[.,]/.test(id)) throw new Error('MAILBOX_TOKEN_KEY id must not contain "." or ","');
    keys.push({ id, key });
  }
  if (!keys.length) throw new Error('MAILBOX_TOKEN_KEY is empty');
  return keys;
}

// The binding. Anything in here must be identical at seal and open time, and
// is authenticated without being stored.
function aad(binding) {
  if (!binding || !binding.connectionId || !binding.memberId) {
    throw new Error('token envelope requires { connectionId, memberId }');
  }
  return Buffer.from(JSON.stringify({
    v: ENVELOPE_VERSION,
    c: String(binding.connectionId),
    m: String(binding.memberId),
    p: binding.purpose || 'gmail_refresh',
  }), 'utf8');
}

// → "v1.<keyId>.<iv>.<ciphertext+tag>"
function sealToken(plaintext, binding, env) {
  if (typeof plaintext !== 'string' || !plaintext) throw new Error('nothing to seal');
  const { id, key } = parseKeys(env)[0];
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  cipher.setAAD(aad(binding));
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [ENVELOPE_VERSION, id, b64u.enc(iv), b64u.enc(Buffer.concat([ct, tag]))].join('.');
}

// Throws on ANY failure — wrong key, wrong row, wrong member, flipped byte,
// truncated envelope. There is deliberately no "best effort" path: a token that
// does not open cleanly is a token we must not use, and the caller's job is to
// mark the connection as needing re-consent, not to guess.
function openToken(envelope, binding, env) {
  const parts = String(envelope || '').split('.');
  if (parts.length !== 4) throw new Error('malformed token envelope');
  const [version, keyId, ivB64, bodyB64] = parts;
  if (version !== ENVELOPE_VERSION) throw new Error(`unknown token envelope version "${version}"`);

  const match = parseKeys(env).find((k) => k.id === keyId);
  if (!match) throw new Error(`token sealed with unknown key "${keyId}" — rotation window closed too early?`);

  const iv = b64u.dec(ivB64);
  const body = b64u.dec(bodyB64);
  if (iv.length !== IV_BYTES || body.length <= TAG_BYTES) throw new Error('malformed token envelope');

  const ct = body.subarray(0, body.length - TAG_BYTES);
  const tag = body.subarray(body.length - TAG_BYTES);
  const decipher = crypto.createDecipheriv(ALGO, match.key, iv);
  decipher.setAAD(aad(binding));
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
}

// True when this envelope was sealed with a key that is no longer the primary —
// i.e. it should be re-sealed on next write. Never throws; a malformed envelope
// is simply not re-sealable.
function needsResealing(envelope, env) {
  try {
    const keyId = String(envelope || '').split('.')[1];
    return !!keyId && keyId !== parseKeys(env)[0].id;
  } catch (e) { return false; }
}

// Convenience for generating a key when setting the project up. Printed by
// `node pipeline/lib/token-crypto.js keygen`, never called in request paths.
function generateKey() {
  return crypto.randomBytes(KEY_BYTES).toString('base64');
}

if (require.main === module && process.argv[2] === 'keygen') {
  const id = 'k' + String(process.argv[3] || 1);
  console.log(`${id}:${generateKey()}`);
  console.log('\nSet this as MAILBOX_TOKEN_KEY in the Vercel project environment.');
  console.log('Do NOT put it in Supabase, in the repo, or anywhere the database credentials reach —');
  console.log('splitting those two is the whole protection (see the header of this file).');
}

module.exports = {
  ENVELOPE_VERSION,
  parseKeys,
  sealToken,
  openToken,
  needsResealing,
  generateKey,
};
