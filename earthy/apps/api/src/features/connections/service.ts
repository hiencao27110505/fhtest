import { fernetEncrypt } from "./fernet";
import {
  authorizationUrl,
  exchangeCode,
  fetchProfile,
  type GoogleTokens,
} from "./google-oauth";
import { isProvider, PROVIDERS, type ProviderId } from "./providers";
import { createState, readState } from "./oauth-state";

import { ConnectError } from "./errors";
import { linkAccount, type Database } from "./repository";

/**
 * The connect flow, as steps rather than as an HTTP handler.
 *
 * Everything here is about mailboxes and grants; nothing here knows about
 * requests, redirects, or status codes. That split is what makes the flow
 * testable — `completeGoogleConnect` can be driven end to end with fake
 * provider calls, which is not possible once the logic lives inside a handler
 * that only speaks `Context`.
 *
 * The provider calls and the encryption key are injected for the same reason.
 * Defaults are the real ones, so production reads as if they were not.
 */



/** The provider calls this flow makes. Swapped wholesale in tests. */
export type GoogleClient = {
  exchangeCode: (code: string) => Promise<GoogleTokens>;
  fetchProfile: (accessToken: string) => Promise<{ emailAddress: string }>;
};

const liveGoogle: GoogleClient = { exchangeCode, fetchProfile };

export type ConnectDeps = {
  google?: GoogleClient;
  db?: Database;
  /** Fernet key. Injected so a test never needs the production secret. */
  tokenKey: string;
};

/**
 * Where to send the browser to obtain consent, for a signed-in user.
 *
 * `returnTo` is the page they were on when they reached for the feature. It
 * travels inside the signed state rather than on the callback URL, so Google
 * echoing it back cannot turn it into an open redirect.
 */
export async function beginConnect(
  userId: string,
  provider: ProviderId,
  returnTo?: string,
  loginHint?: string,
): Promise<string> {
  // `loginHint` stays OUTSIDE the signed state, unlike `returnTo`. It is not a
  // claim we act on — it only pre-selects an account on Google's chooser, and
  // the address we store comes from Google's token response, never from here.
  // Nothing downstream trusts it, so nothing needs to prove we minted it.
  return authorizationUrl(
    await createState(userId, provider, returnTo),
    loginHint,
  );
}

/** What Google puts on the callback URL. Either shape is valid. */
export type CallbackParams = {
  code?: string;
  state?: string;
  error?: string;
};

/**
 * Turns a consent callback into a stored, encrypted mailbox link.
 *
 * Ordered so nothing expensive happens on an unauthenticated request: the
 * state is verified before the code is spent, because the exchange is a
 * network call to Google and an unverified caller should not be able to make
 * this service issue one.
 *
 * Every failure leaves the database untouched — the write is the last step.
 * Throws `ConnectError`; returns the connected address on success.
 */
export async function completeConnect(
  params: CallbackParams,
  deps: ConnectDeps,
): Promise<{ email: string; returnTo?: string }> {
  const google = deps.google ?? liveGoogle;

  // The state is read FIRST, before the outcome is even looked at. Google
  // echoes it back on a decline too, and a declined consent is the most
  // ordinary ending this flow has — reading it here is what lets the user land
  // back on the page they started from instead of a default one.
  const claims = params.state ? await readState(params.state) : null;
  const returnTo = claims?.returnTo;

  if (params.error) {
    throw new ConnectError(
      { kind: "declined", providerError: params.error },
      returnTo,
    );
  }
  if (!params.code || !params.state) {
    throw new ConnectError({ kind: "malformed_callback" }, returnTo);
  }
  if (!claims) throw new ConnectError({ kind: "invalid_state" });
  const { userId, provider } = claims;

  // The provider comes out of the signature, so it cannot be steered by the
  // callback URL — but it was a path segment when the state was minted, and a
  // provider removed from the registry since then would reach here as a name
  // nothing can service.
  if (!isProvider(provider)) {
    throw new ConnectError({ kind: "invalid_state" });
  }

  let tokens: GoogleTokens;
  let email: string;
  try {
    tokens = await google.exchangeCode(params.code);
    // The profile is fetched rather than trusting the redirect: it proves the
    // token works, and it names the mailbox authoritatively. A user can be
    // signed in as one account and grant a different one at the consent
    // screen, so the address cannot be taken from the session.
    email = (await google.fetchProfile(tokens.accessToken)).emailAddress;
  } catch (cause) {
    throw new ConnectError({ kind: "provider_unavailable", cause }, returnTo);
  }

  if (!tokens.refreshToken) {
    throw new ConnectError({ kind: "no_refresh_token" }, returnTo);
  }
  if (!PROVIDERS[provider].scopes.every((scope) => tokens.scopes.includes(scope))) {
    throw new ConnectError(
      { kind: "insufficient_scope", granted: tokens.scopes },
      returnTo,
    );
  }

  try {
    await linkAccount(
      {
        userId,
        provider,
        providerAccountId: email,
        email,
        // Encrypted here, once, and never again in plaintext beyond this
        // line. Fernet is not a preference: the Python jobs in `serverless/`
        // decrypt these rows with the same key, so the format is fixed by the
        // reader.
        refreshTokenEnc: await fernetEncrypt(tokens.refreshToken, deps.tokenKey),
        scopes: tokens.scopes,
      },
      deps.db,
    );
  } catch (err) {
    // The repository has no idea where the user started, so its failure is
    // re-thrown with that context attached.
    if (err instanceof ConnectError) {
      throw new ConnectError(err.failure, returnTo);
    }
    throw err;
  }

  // The Gmail watch is deliberately NOT registered here. `gmail-watch-renew`
  // owns it and seeds the history cursor when it does; writing that cursor
  // from two places risks one of them skipping the messages in between.
  return { email, returnTo };
}
