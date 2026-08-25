/**
 * Wrapping a refresh token before it reaches Postgres.
 *
 * A Google refresh token is standing read access to somebody's entire mailbox,
 * for as long as they do not revoke it. `mailbox_grants.refresh_token_enc` holds
 * ciphertext so that a database dump is not a permanent grant on every connected
 * mailbox at once.
 *
 * THE KEY BELONGS TO THE APPLICATION, NOT TO POSTGRES. Encrypting inside the
 * database (pgcrypto, a column key) would put the key and the data in the same
 * place and defeat the entire point. `MAILBOX_TOKEN_KEY` lives in the function's
 * secrets.
 *
 * AES-256-GCM via WebCrypto: authenticated, available in Deno and Node without a
 * dependency, and the nonce travels with the ciphertext so there is no second
 * column to keep in step. `v1:` prefixes the format so a future rotation is a
 * new prefix rather than a guess about what old rows contain.
 *
 * This is deliberately NOT the Fernet format that `earthy/` uses for the same
 * job. Sharing a format would mean sharing a key, and a key shared between two
 * systems is a key neither can rotate.
 *
 * WHAT THIS DOES NOT PROTECT AGAINST: anyone who can read the function's
 * environment. That is the same operator tier that can read the mail itself, so
 * the boundary this draws is against the database, honestly and no further.
 */

const PREFIX = 'v1:';
const IV_BYTES = 12;   // 96 bits, the size GCM is specified for

async function _key(rawKeyB64, subtle) {
  const crypt = subtle || (globalThis.crypto && globalThis.crypto.subtle);
  if (!crypt) throw new Error('TOKEN_NO_SUBTLE_CRYPTO');
  if (!rawKeyB64) throw new Error('MAILBOX_TOKEN_KEY is not set; refusing to handle tokens');
  const raw = _unb64(rawKeyB64);
  if (raw.length !== 32) {
    throw new Error('MAILBOX_TOKEN_KEY must be 32 bytes of base64, got ' + raw.length);
  }
  return crypt.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

/** Ciphertext as a string: `v1:<base64(iv)>:<base64(ct)>`. */
export async function encryptToken(plaintext, keyB64, opts) {
  const o = opts || {};
  const crypt = o.subtle || (globalThis.crypto && globalThis.crypto.subtle);
  const rng = o.rng || globalThis.crypto;
  if (!rng || typeof rng.getRandomValues !== 'function') throw new Error('TOKEN_NO_CSPRNG');

  const key = await _key(keyB64, crypt);
  const iv = rng.getRandomValues(new Uint8Array(IV_BYTES));
  const ct = await crypt.encrypt(
    { name: 'AES-GCM', iv }, key, new TextEncoder().encode(String(plaintext)),
  );
  return PREFIX + _b64(iv) + ':' + _b64(new Uint8Array(ct));
}

/**
 * Back to a usable token.
 *
 * Every failure throws, and none of them says which part failed. A wrong key
 * and a tampered row are the same event from here: something is wrong with the
 * stored credential and it must not be treated as a token.
 */
export async function decryptToken(stored, keyB64, opts) {
  const o = opts || {};
  const crypt = o.subtle || (globalThis.crypto && globalThis.crypto.subtle);
  const s = String(stored || '');
  if (!s.startsWith(PREFIX)) throw new Error('stored token is not in a known format');

  const parts = s.slice(PREFIX.length).split(':');
  if (parts.length !== 2) throw new Error('stored token is malformed');

  const key = await _key(keyB64, crypt);
  let plain;
  try {
    plain = await crypt.decrypt(
      { name: 'AES-GCM', iv: _unb64(parts[0]) }, key, _unb64(parts[1]),
    );
  } catch {
    // Never log or return the value. Wrong key, tampered ciphertext, or a row
    // written by something else all land here.
    throw new Error('stored token could not be decrypted');
  }
  return new TextDecoder().decode(plain);
}

/**
 * Postgres `bytea` wants hex on the way in over PostgREST. The column is bytea
 * because 0084 declares it so, and the string above is ASCII, so the conversion
 * is lossless in both directions.
 */
export function toBytea(s) {
  const bytes = new TextEncoder().encode(s);
  let hex = '\\x';
  for (const b of bytes) hex += b.toString(16).padStart(2, '0');
  return hex;
}

export function fromBytea(v) {
  const s = String(v || '');
  if (!s.startsWith('\\x')) return s;      // already text
  const hex = s.slice(2);
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
  return new TextDecoder().decode(bytes);
}

function _b64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

function _unb64(str) {
  const bin = atob(String(str));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
