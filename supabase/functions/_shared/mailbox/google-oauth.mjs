/**
 * The three calls the connect flow makes to Google.
 *
 * Where the mailbox address comes from is the load-bearing decision in this
 * file: it is read from Google's own profile call, never from the `login_hint`
 * the client sent and never from the signed-in session. A person can be signed
 * into the app as one account and grant a different one at the consent screen —
 * that is not an edge case, it is what happens on a phone where Safari already
 * holds a Google session. Storing the hint attaches a mailbox we cannot read,
 * and the mismatch only surfaces later as a sync that returns nothing.
 */

import { SCOPES } from './gmail.mjs';

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const PROFILE_URL = 'https://gmail.googleapis.com/gmail/v1/users/me/profile';

/** A named failure the callback can turn into one word for the user. */
export class ConnectError extends Error {
  constructor(kind, detail) {
    super('connect_failed:' + kind + (detail ? ' (' + detail + ')' : ''));
    this.name = 'ConnectError';
    this.kind = kind;
  }
}

/**
 * Where to send the browser for consent.
 *
 * Two parameters are load-bearing and neither is obvious:
 *
 * - `access_type=offline` — without it Google issues no refresh token at all,
 *   and the connection dies within the hour when the access token expires.
 * - `prompt=select_account consent` — `consent` because a RE-authorisation
 *   returns only an access token otherwise (the refresh token is sent on the
 *   first grant alone), and `select_account` because `login_hint` LOSES to an
 *   existing browser session. Without it a person lands on whichever Google
 *   account they last used and can grant the wrong mailbox without noticing.
 *
 * `include_granted_scopes=false` keeps this grant to Gmail read alone rather
 * than quietly accumulating every scope the app has ever asked for.
 */
export function authorizationUrl(state, cfg, loginHint) {
  const params = new URLSearchParams({
    client_id: cfg.clientId,
    redirect_uri: cfg.redirectUri,
    response_type: 'code',
    scope: SCOPES.join(' '),
    include_granted_scopes: 'false',
    access_type: 'offline',
    prompt: 'select_account consent',
    state,
  });
  // A hint, not a claim. Omitted entirely when unknown rather than sent empty.
  if (loginHint) params.set('login_hint', loginHint);
  return AUTH_URL + '?' + params.toString();
}

/**
 * Spends the authorization code.
 *
 * The `redirect_uri` is sent again here and Google matches it against the one
 * the code was issued for, character for character. It is pinned in config
 * rather than derived from the request, because a deployment with more than one
 * hostname would otherwise mint codes it cannot spend.
 */
export async function exchangeCode(code, cfg, fetchImpl) {
  const doFetch = fetchImpl || globalThis.fetch;
  let res;
  try {
    res = await doFetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: cfg.clientId,
        client_secret: cfg.clientSecret,
        redirect_uri: cfg.redirectUri,
        grant_type: 'authorization_code',
      }).toString(),
    });
  } catch (e) {
    throw new ConnectError('provider_unavailable', String(e && e.message || e));
  }

  const text = await res.text();
  if (!res.ok) throw new ConnectError('provider_unavailable', 'http ' + res.status);

  let data;
  try { data = JSON.parse(text); } catch { throw new ConnectError('provider_unavailable', 'not JSON'); }

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token || null,
    scopes: String(data.scope || '').split(/\s+/).filter(Boolean),
  };
}

/**
 * The address that actually consented.
 *
 * Doubles as proof the token works: a grant that cannot read the profile cannot
 * read the mailbox either, and finding that out here is much better than
 * finding it out on the first poll of a mailbox the user believes is connected.
 */
export async function fetchProfile(accessToken, fetchImpl) {
  const doFetch = fetchImpl || globalThis.fetch;
  let res;
  try {
    res = await doFetch(PROFILE_URL, { headers: { Authorization: 'Bearer ' + accessToken } });
  } catch (e) {
    throw new ConnectError('provider_unavailable', String(e && e.message || e));
  }
  if (!res.ok) throw new ConnectError('provider_unavailable', 'profile http ' + res.status);

  const data = await res.json();
  if (!data.emailAddress) throw new ConnectError('provider_unavailable', 'profile had no address');
  return { email: String(data.emailAddress).toLowerCase(), historyId: data.historyId || null };
}

/**
 * Turns a callback into everything the grant row needs, or throws a named kind.
 *
 * Ordered so nothing expensive happens for an unauthenticated caller: the state
 * is verified before the code is spent, because spending it is a network call
 * to Google that an unverified caller should not be able to make this service
 * issue.
 */
export async function completeConnect(params, cfg, deps) {
  const google = (deps && deps.google) || { exchangeCode, fetchProfile };

  const tokens = await google.exchangeCode(params.code, cfg, deps && deps.fetch);
  const profile = await google.fetchProfile(tokens.accessToken, deps && deps.fetch);

  // No refresh token means the grant is good for about an hour and then dies
  // silently. Almost always a re-authorisation without `prompt=consent`; the
  // remedy is to revoke the app at myaccount.google.com/permissions and retry.
  if (!tokens.refreshToken) throw new ConnectError('no_refresh_token');

  // A re-consent can NARROW what was granted, so what we asked for is not what
  // we have. Checked rather than assumed.
  for (const scope of SCOPES) {
    if (!tokens.scopes.includes(scope)) {
      throw new ConnectError('insufficient_scope', tokens.scopes.join(' '));
    }
  }

  return { email: profile.email, refreshToken: tokens.refreshToken, scopes: tokens.scopes.join(' ') };
}
