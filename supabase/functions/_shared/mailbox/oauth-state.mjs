/**
 * The signed state that carries who started an OAuth flow.
 *
 * The callback arrives as a plain browser GET from accounts.google.com. It has
 * no session, no Authorization header, and nothing of ours on it except what we
 * put in `state` and Google echoed back. So `state` is the ONLY thing standing
 * between the callback and someone grafting their mailbox onto another person's
 * ledger, and it has to be unforgeable rather than merely opaque.
 *
 * An earlier client-side design sent `base64url({uid, mid})` UNSIGNED, on the
 * reasoning that a browser cannot hold a signing key. That is true and it is
 * why the state is minted SERVER-side here: the authorize endpoint authenticates
 * the caller with their Supabase JWT, and only then signs a state naming them.
 * The browser never sees the key and never needs to.
 *
 * HMAC-SHA256 rather than a JWT library: the payload is three short fields, the
 * verifier and the signer are the same process, and there is no third party to
 * interoperate with. A dependency here would buy nothing and add a parser.
 */

const VERSION = 1;

/** Default lifetime. Long enough to read a consent screen, short enough that a
 *  state left in a browser tab overnight is not still usable. */
export const DEFAULT_TTL_SECONDS = 900;

function b64urlEncode(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlDecode(str) {
  const b64 = String(str).replace(/-/g, '+').replace(/_/g, '/');
  const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
  const bin = atob(padded);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function hmac(payloadB64, secret, subtle) {
  const crypt = subtle || (globalThis.crypto && globalThis.crypto.subtle);
  if (!crypt) throw new Error('STATE_NO_SUBTLE_CRYPTO');
  if (!secret) throw new Error('STATE_NO_SECRET');
  const key = await crypt.importKey(
    'raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const sig = await crypt.sign('HMAC', key, new TextEncoder().encode(payloadB64));
  return b64urlEncode(new Uint8Array(sig));
}

/**
 * Signs `{userId, returnTo}` into a state string.
 *
 * `nowMs` is injected so a test can prove expiry rather than sleep through it.
 */
export async function createState(claims, secret, opts) {
  const o = opts || {};
  const now = o.nowMs || Date.now();
  const payload = {
    v: VERSION,
    uid: claims.userId,
    rt: claims.returnTo || undefined,
    iat: Math.floor(now / 1000),
    exp: Math.floor(now / 1000) + (o.ttlSeconds || DEFAULT_TTL_SECONDS),
  };
  const body = b64urlEncode(new TextEncoder().encode(JSON.stringify(payload)));
  return body + '.' + await hmac(body, secret, o.subtle);
}

/**
 * Verifies and unpacks a state, or returns null.
 *
 * Null for every failure — bad shape, bad signature, expired, wrong version.
 * The caller cannot do anything different for any of them and a distinguishable
 * error would tell whoever is probing the callback which half they got wrong.
 */
export async function readState(state, secret, opts) {
  const o = opts || {};
  if (typeof state !== 'string') return null;
  const dot = state.indexOf('.');
  if (dot <= 0) return null;

  const body = state.slice(0, dot);
  const sig = state.slice(dot + 1);

  let expected;
  try { expected = await hmac(body, secret, o.subtle); } catch { return null; }
  // Constant-time-ish: compare every character rather than bailing at the first
  // difference. The timing signal on a base64 HMAC is not a practical attack
  // here, but writing the fast version invites copying it somewhere it is.
  if (sig.length !== expected.length) return null;
  let diff = 0;
  for (let i = 0; i < sig.length; i++) diff |= sig.charCodeAt(i) ^ expected.charCodeAt(i);
  if (diff !== 0) return null;

  let payload;
  try { payload = JSON.parse(new TextDecoder().decode(b64urlDecode(body))); } catch { return null; }
  if (!payload || payload.v !== VERSION || !payload.uid) return null;

  const now = Math.floor((o.nowMs || Date.now()) / 1000);
  if (typeof payload.exp !== 'number' || payload.exp < now) return null;

  return { userId: payload.uid, returnTo: payload.rt };
}

/**
 * Reduces a `returnTo` to a same-site path, or nothing.
 *
 * The value is inside a signature we produced, so it is not attacker-authored —
 * but a signature only proves we minted it, not that it was sensible, and it
 * started life as a query parameter. Confining it here means the worst a
 * `?returnTo=https://evil.example` can do is be ignored.
 *
 * A protocol-relative `//evil.example` is a URL to a browser, not a path, which
 * is why the second test is not redundant.
 */
export function confineToPath(returnTo) {
  if (!returnTo || typeof returnTo !== 'string') return null;
  if (!returnTo.startsWith('/') || returnTo.startsWith('//')) return null;
  return returnTo;
}
