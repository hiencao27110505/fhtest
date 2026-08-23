import { env } from "@/lib/env";

/**
 * The Google OAuth authorization-code flow, as this API drives it.
 *
 * Read-only Gmail, nothing wider: this product reads transaction mail and
 * never sends, modifies, or deletes it, and a narrow scope is a smaller blast
 * radius if a token leaks. The value must stay identical to `SCOPES` in
 * `serverless/shared/accounts.py` — the jobs assume the grant they were given.
 */
export const GMAIL_SCOPES = ["https://www.googleapis.com/auth/gmail.readonly"];

const AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const PROFILE_ENDPOINT =
  "https://gmail.googleapis.com/gmail/v1/users/me/profile";

/**
 * The URL to send the user's browser to for consent.
 *
 * `access_type=offline` is what makes Google issue a refresh token at all, and
 * `prompt=consent` forces the screen even for an account that already granted
 * access — without it, a re-authorization returns an access token and NO
 * refresh token, because Google sends one only on the first grant. For a
 * background pipeline, both are required, not optional.
 *
 * This IS an incremental authorization — the user signed in with Google
 * earlier, without the Gmail scope, and is being asked for it now that they
 * have reached a feature that reads their mail. Google shows a consent screen
 * for the new scope alone.
 *
 * `include_granted_scopes` is nonetheless omitted. It would fold the scopes
 * granted at sign-in into this grant, so the token coming back would be wider
 * than what `scopes` on the row records, and Google answers `invalid_request`
 * when it is combined with scopes the user has already granted to the project.
 * Asking for exactly the one scope keeps the stored row an honest description
 * of what the pipeline may do.
 */
export function authorizationUrl(state: string): string {
  const url = new URL(AUTH_ENDPOINT);
  url.searchParams.set("client_id", env.GOOGLE_OAUTH_CLIENT_ID);
  url.searchParams.set("redirect_uri", env.GOOGLE_OAUTH_REDIRECT_URI);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", GMAIL_SCOPES.join(" "));
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("state", state);
  return url.toString();
}

export type GoogleTokens = {
  accessToken: string;
  /**
   * Absent when Google decides this is not a first grant. Treated as a hard
   * error by the caller rather than stored as null: a row without one is a
   * mailbox the pipeline can never read.
   */
  refreshToken?: string;
  /** What was actually granted, which can be narrower than what we asked. */
  scopes: string[];
};

/** Exchanges the one-time code from the callback for tokens. */
export async function exchangeCode(code: string): Promise<GoogleTokens> {
  const response = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: env.GOOGLE_OAUTH_CLIENT_ID,
      client_secret: env.GOOGLE_OAUTH_CLIENT_SECRET,
      redirect_uri: env.GOOGLE_OAUTH_REDIRECT_URI,
      grant_type: "authorization_code",
    }),
  });

  if (!response.ok) {
    // Google's body names the fault (redirect_uri_mismatch, invalid_grant) and
    // is not sensitive, but it is for the operator, not the user — the caller
    // logs it and shows the user something plain.
    throw new Error(`Token exchange failed: ${await response.text()}`);
  }

  const body = (await response.json()) as {
    access_token: string;
    refresh_token?: string;
    scope?: string;
  };

  return {
    accessToken: body.access_token,
    refreshToken: body.refresh_token,
    scopes: body.scope ? body.scope.split(" ") : [],
  };
}

export type GmailProfile = {
  emailAddress: string;
  historyId?: string;
};

/**
 * The mailbox the grant is actually for.
 *
 * Called rather than trusting the redirect: it confirms the token works, and
 * it names the mailbox authoritatively. The address cannot be taken from the
 * signed-in user's own profile — someone can be signed in as one person and
 * grant access to a different Google account in the consent screen.
 */
export async function fetchProfile(accessToken: string): Promise<GmailProfile> {
  const response = await fetch(PROFILE_ENDPOINT, {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) {
    throw new Error(`Gmail profile lookup failed: ${await response.text()}`);
  }
  return (await response.json()) as GmailProfile;
}
