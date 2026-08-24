/**
 * Fernet encryption, write side only.
 *
 * The refresh tokens this API stores are read back by the Python pipeline in
 * `serverless/`, which decrypts them with `cryptography.fernet.Fernet` and the
 * same GMAIL_TOKEN_KEY. Fernet is therefore not a choice made here — it is the
 * format the other end of the table already speaks. Anything else would write
 * rows the jobs cannot read, and nothing would notice until a notification
 * arrived for that mailbox.
 *
 * The spec (version 0x80): a 32-byte key splits into a 16-byte HMAC signing
 * key and a 16-byte AES key. The token is
 *
 *   base64url( 0x80 | timestamp(8, big-endian) | iv(16) | AES-128-CBC(ct) | HMAC-SHA256(32) )
 *
 * where the HMAC covers everything before it. Only encryption lives here:
 * nothing in this app has a reason to read a token back, and the narrower
 * surface means a bug here cannot turn into a decryption oracle.
 */

const VERSION = 0x80;

/** Fernet's key is urlsafe-base64 of exactly 32 bytes. */
function decodeKey(key: string): Uint8Array {
  const b64 = key.replace(/-/g, "+").replace(/_/g, "/");
  const raw = Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0));
  if (raw.length !== 32) {
    throw new Error(
      `GMAIL_TOKEN_KEY must decode to 32 bytes, got ${raw.length}. ` +
        "Generate one with: python -c \"from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())\"",
    );
  }
  return raw;
}

function base64url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_");
}

/**
 * PKCS#7 pad to the AES block size. WebCrypto's AES-CBC pads on its own, so
 * this is not applied — it is noted here only because the HMAC is computed
 * over the padded ciphertext WebCrypto returns, which is already correct.
 */
const BLOCK_SIZE = 16;

/**
 * Encrypts `plaintext` into a Fernet token.
 *
 * `now` is injectable so a test can assert a fixed token; production always
 * uses the real clock. The timestamp is not a secret and is not verified by
 * the reader (the Python side calls `decrypt` with no TTL), but it is part of
 * the signed bytes, so it cannot be tampered with either.
 */
export async function fernetEncrypt(
  plaintext: string,
  key: string,
  now: Date = new Date(),
): Promise<Uint8Array> {
  const raw = decodeKey(key);
  const signingKey = raw.subarray(0, 16);
  const encryptionKey = raw.subarray(16, 32);

  const iv = crypto.getRandomValues(new Uint8Array(BLOCK_SIZE));

  const aesKey = await crypto.subtle.importKey(
    "raw",
    encryptionKey,
    { name: "AES-CBC" },
    false,
    ["encrypt"],
  );
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-CBC", iv },
      aesKey,
      new TextEncoder().encode(plaintext),
    ),
  );

  // Seconds since the epoch, 8 bytes big-endian. Written through a DataView
  // rather than by hand: the value exceeds 32 bits' worth of seconds only in
  // the far future, but a hand-rolled shift would be wrong long before that.
  const timestamp = new Uint8Array(8);
  new DataView(timestamp.buffer).setBigUint64(
    0,
    BigInt(Math.floor(now.getTime() / 1000)),
    false,
  );

  const signed = new Uint8Array(1 + 8 + iv.length + ciphertext.length);
  signed[0] = VERSION;
  signed.set(timestamp, 1);
  signed.set(iv, 9);
  signed.set(ciphertext, 9 + iv.length);

  const hmacKey = await crypto.subtle.importKey(
    "raw",
    signingKey,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", hmacKey, signed));

  const token = new Uint8Array(signed.length + mac.length);
  token.set(signed, 0);
  token.set(mac, signed.length);

  // The column is bytea and Fernet tokens are ASCII base64url. Storing the
  // encoded form (not the raw bytes) is what `Fernet.decrypt` expects to be
  // handed back, and matches what connect_mailbox.py already writes.
  return new TextEncoder().encode(base64url(token));
}
