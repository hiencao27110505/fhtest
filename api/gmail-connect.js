// Vercel serverless function — step 1 of connecting a mailbox.
//
// POST { memberId }  (Authorization: Bearer <supabase access token>)
//   → { url } — the Google consent URL to send the user to.
//
// Grants nothing by itself. It authenticates the caller, checks the member row
// really belongs to them, and hands back a consent URL whose state is signed so
// the callback can trust who started the flow.
//
// The scope requested is gmail.readonly and nothing else. It is a RESTRICTED
// scope: read pipeline/OAUTH-COMPLIANCE-FINDINGS.md before touching this list.
// Adding a second scope is not a code change, it is a compliance change.

'use strict';

const gmail = require('../pipeline/lib/gmail.js');
const db = require('../pipeline/lib/supabase.js');
const state = require('../pipeline/lib/oauth-state.js');

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';

module.exports = async (req, res) => {
  if (req.method !== 'POST') { res.status(405).json({ error: 'POST only' }); return; }

  try {
    const env = process.env;
    for (const k of ['GOOGLE_OAUTH_CLIENT_ID', 'GOOGLE_OAUTH_REDIRECT_URI', 'OAUTH_STATE_SECRET']) {
      if (!env[k]) { res.status(500).json({ error: `${k} not configured` }); return; }
    }

    const authz = req.headers['authorization'] || req.headers['Authorization'] || '';
    const uid = await db.verifyUser(env, String(authz).replace(/^Bearer\s+/i, ''));
    if (!uid) { res.status(401).json({ error: 'sign-in required' }); return; }

    const memberId = (req.body && req.body.memberId) || '';
    if (!memberId) { res.status(400).json({ error: 'memberId required' }); return; }

    // The member must belong to the caller. Without this check a signed-in user
    // could start a flow naming someone else's member row and, on callback,
    // attach their own mailbox to that person's ledger.
    const members = await db.get(env, 'members', { id: 'eq.' + memberId, user_id: 'eq.' + uid }, { select: 'id,user_id' });
    if (!members.length) { res.status(403).json({ error: 'not your member row' }); return; }

    const pkce = state.createPkce();
    const signed = state.createState({ uid, mid: memberId }, env);

    const params = new URLSearchParams({
      client_id: env.GOOGLE_OAUTH_CLIENT_ID,
      redirect_uri: env.GOOGLE_OAUTH_REDIRECT_URI,
      response_type: 'code',
      scope: gmail.GMAIL_SCOPE,
      // offline + consent: we need a refresh token, and Google only re-issues
      // one when consent is re-granted. Without prompt=consent a user who
      // reconnects gets an access token only, and background sync silently
      // never works again.
      access_type: 'offline',
      prompt: 'consent',
      include_granted_scopes: 'false',
      state: signed,
      code_challenge: pkce.challenge,
      code_challenge_method: 'S256',
      login_hint: (req.body && req.body.email) || '',
    });

    res.setHeader('Set-Cookie', state.pkceCookie(pkce.verifier));
    res.status(200).json({ url: `${AUTH_URL}?${params.toString()}` });
  } catch (e) {
    res.status(500).json({ error: 'connect_failed', detail: String(e && e.message || e) });
  }
};
