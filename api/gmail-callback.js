// Vercel serverless function — step 2 of connecting a mailbox.
//
// GET /api/gmail-callback?code=...&state=...
//   → redirects back into the app with a short status in the hash.
//
// This is where the refresh token first exists in plaintext, for the length of
// one function invocation. It is sealed before it is written, and never logged.
// If you add logging to this file, log `Object.keys(tokens)`, never `tokens`.

'use strict';

const gmail = require('../pipeline/lib/gmail.js');
const db = require('../pipeline/lib/supabase.js');
const state = require('../pipeline/lib/oauth-state.js');
const tokenCrypto = require('../pipeline/lib/token-crypto.js');

// Where the user lands afterwards. A hash, not a query param, so the status
// never reaches a server log or a Referer header.
function backToApp(res, env, status, extraCookie) {
  const base = env.APP_URL || '/';
  const cookies = [state.clearPkceCookie()];
  if (extraCookie) cookies.push(extraCookie);
  res.setHeader('Set-Cookie', cookies);
  res.writeHead(302, { Location: `${base}#mailbox-${status}` });
  res.end();
}

module.exports = async (req, res) => {
  const env = process.env;
  const url = new URL(req.url, 'https://placeholder.local');
  const code = url.searchParams.get('code');
  const rawState = url.searchParams.get('state');
  const denied = url.searchParams.get('error');

  // The user pressing "cancel" on the consent screen is a normal outcome, not
  // a failure to report loudly.
  if (denied) { backToApp(res, env, 'cancelled'); return; }
  if (!code || !rawState) { backToApp(res, env, 'invalid'); return; }

  let claims;
  try {
    claims = state.verifyState(rawState, env);
  } catch (e) {
    // A bad state means we cannot tell whose mailbox this is. Never guess.
    backToApp(res, env, 'invalid');
    return;
  }

  const verifier = state.readPkceCookie(req.headers && req.headers.cookie);
  if (!verifier) { backToApp(res, env, 'expired'); return; }

  let connectionId = null;
  try {
    // ── exchange ────────────────────────────────────────────────────────────
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: env.GOOGLE_OAUTH_CLIENT_ID,
        client_secret: env.GOOGLE_OAUTH_CLIENT_SECRET,
        redirect_uri: env.GOOGLE_OAUTH_REDIRECT_URI,
        grant_type: 'authorization_code',
        code_verifier: verifier,
      }).toString(),
    });
    const tokens = await tokenRes.json().catch(() => ({}));
    if (!tokenRes.ok || !tokens.refresh_token) {
      // No refresh token usually means Google decided this was a re-grant and
      // reused the existing one — which we cannot see. prompt=consent in
      // gmail-connect.js is what prevents it; if this fires, that was dropped.
      backToApp(res, env, tokenRes.ok ? 'norefresh' : 'failed');
      return;
    }

    // Confirm the granted scope is the one we asked for and nothing wider. If
    // Google ever hands back more than requested, that is worth refusing.
    const granted = String(tokens.scope || '');
    if (granted.indexOf(gmail.GMAIL_SCOPE) === -1) { backToApp(res, env, 'scope'); return; }

    // Which mailbox did we just get? Needed so the user can see, and so a
    // second connection of the same account updates rather than duplicates.
    const profile = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/profile', {
      headers: { Authorization: 'Bearer ' + tokens.access_token },
    }).then((r) => r.json()).catch(() => ({}));
    const mailboxEmail = profile.emailAddress || null;
    if (!mailboxEmail) { backToApp(res, env, 'failed'); return; }

    // ── store ───────────────────────────────────────────────────────────────
    // Two steps on purpose: the token envelope is bound to the row id, so the
    // row must exist before the token can be sealed. The window in between
    // holds a row with no token, which is a valid, inert state.
    const existing = await db.get(env, 'mailbox_connections', {
      member_id: 'eq.' + claims.mid,
      oauth_email: 'eq.' + mailboxEmail,
      connection_source: 'eq.oauth',
    }, { select: 'id' });

    if (existing.length) {
      connectionId = existing[0].id;
    } else {
      const created = await db.post(env, 'mailbox_connections', {
        member_id: claims.mid,
        connection_source: 'oauth',
        oauth_email: mailboxEmail,
        personal_email: mailboxEmail,
        oauth_status: 'none',
        verified: true,          // the grant IS the proof — no confirmation mail to wait for
        backfill_status: 'pending',
      });
      connectionId = created && created.id;
    }
    if (!connectionId) { backToApp(res, env, 'failed'); return; }

    const sealed = tokenCrypto.sealToken(
      tokens.refresh_token,
      { connectionId, memberId: claims.mid, purpose: 'gmail_refresh' },
      env,
    );

    await db.patch(env, 'mailbox_connections', { id: 'eq.' + connectionId }, {
      oauth_refresh_enc: sealed,
      oauth_scope: granted,
      oauth_status: 'active',
      oauth_last_error: null,
      oauth_connected_at: new Date().toISOString(),
      backfill_status: 'pending',
    });

    backToApp(res, env, 'connected');
  } catch (e) {
    // Never leak the exception text to the browser here — it can contain the
    // token exchange response. The row (if any) is left without a token, which
    // is inert, and the user is told to try again.
    if (connectionId) {
      try {
        await db.patch(env, 'mailbox_connections', { id: 'eq.' + connectionId }, {
          oauth_status: 'needs_reconnect',
          oauth_last_error: 'connect failed',
        });
      } catch (e2) { /* best effort */ }
    }
    backToApp(res, env, 'failed');
  }
};
