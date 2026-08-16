// Signed, expiring OAuth state + PKCE helpers.
//
// Serverless has no session between the consent redirect and the callback, so
// the state parameter has to carry its own integrity. It is HMAC-signed with a
// server secret, carries who started the flow, and expires.
//
// What this stops:
//   * Login CSRF — an attacker cannot craft a callback that attaches THEIR
//     mailbox to YOUR member row, because they cannot sign a state naming your
//     member id.
//   * Replay — states expire, so a captured callback URL is not reusable later.
//   * Tampering — flipping the member id invalidates the signature.
//
// PKCE runs alongside: the verifier never appears in a URL (it goes in an
// httpOnly cookie), so an intercepted authorization code cannot be redeemed
// without it. Belt and braces given we are a confidential client with a secret,
// but the code is short and code interception is exactly the attack that has
// bitten real OAuth deployments.

'use strict';

const crypto = require('crypto');

const STATE_TTL_MS = 10 * 60 * 1000;   // consent should take a minute; ten is generous
const COOKIE_NAME = 'fh_gmail_pkce';

const b64u = {
  enc: (buf) => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''),
  dec: (s) => Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64'),
};

function secretOf(env) {
  const s = env.OAUTH_STATE_SECRET;
  if (!s || String(s).length < 32) {
    throw new Error('OAUTH_STATE_SECRET must be set to at least 32 characters');
  }
  return String(s);
}

function sign(payloadB64, env) {
  return b64u.enc(crypto.createHmac('sha256', secretOf(env)).update(payloadB64).digest());
}

function createState(claims, env, nowMs) {
  const now = typeof nowMs === 'number' ? nowMs : Date.now();
  const payload = Object.assign({}, claims, { iat: now, exp: now + STATE_TTL_MS, n: b64u.enc(crypto.randomBytes(9)) });
  const body = b64u.enc(Buffer.from(JSON.stringify(payload), 'utf8'));
  return body + '.' + sign(body, env);
}

// Throws on anything wrong. There is no "probably fine" path here — a state we
// cannot fully verify means we do not know whose mailbox we are about to
// attach, and that is the one mistake this whole file exists to prevent.
function verifyState(state, env, nowMs) {
  const parts = String(state || '').split('.');
  if (parts.length !== 2) throw new Error('malformed state');
  const [body, mac] = parts;
  const expected = sign(body, env);
  const a = Buffer.from(mac), b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) throw new Error('bad state signature');

  let claims;
  try { claims = JSON.parse(b64u.dec(body).toString('utf8')); } catch (e) { throw new Error('malformed state payload'); }
  const now = typeof nowMs === 'number' ? nowMs : Date.now();
  if (!claims.exp || now > claims.exp) throw new Error('state expired');
  if (!claims.uid || !claims.mid) throw new Error('state missing subject');
  return claims;
}

// PKCE S256.
function createPkce() {
  const verifier = b64u.enc(crypto.randomBytes(32));
  const challenge = b64u.enc(crypto.createHash('sha256').update(verifier).digest());
  return { verifier, challenge };
}

function pkceCookie(verifier) {
  return `${COOKIE_NAME}=${verifier}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600`;
}

function clearPkceCookie() {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

function readPkceCookie(cookieHeader) {
  const m = String(cookieHeader || '').match(new RegExp('(?:^|;\\s*)' + COOKIE_NAME + '=([^;]+)'));
  return m ? m[1] : null;
}

module.exports = {
  STATE_TTL_MS,
  COOKIE_NAME,
  createState,
  verifyState,
  createPkce,
  pkceCookie,
  clearPkceCookie,
  readPkceCookie,
};
