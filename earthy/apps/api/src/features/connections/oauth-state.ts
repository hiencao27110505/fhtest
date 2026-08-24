import { env } from "@/lib/env";

/**
 * The `state` parameter, as a short-lived signed token.
 *
 * It carries two things across the redirect to Google and back: which of our
 * users started the flow, and proof that we started it. Both are needed —
 * the callback arrives as a plain browser GET with no Authorization header, so
 * without the first there is nobody to attach the mailbox to, and without the
 * second anyone could replay a callback URL and graft their own mailbox onto
 * someone else's account.
 *
 * Signed rather than stored: a server-side state table would need eviction and
 * would not survive a restart mid-flow, and there is nothing here worth
 * keeping that the signature does not already protect. It is not encrypted —
 * the user id is not a secret, and the browser holding it is that user's.
 */

const TTL_SECONDS = 10 * 60;

/**
 * Signed with the OAuth client secret rather than a key of its own. Same trust
 * boundary — anyone holding it can already impersonate this app to Google — so
 * a second secret would be one more thing to rotate for no added protection.
 */
async function signingKey(): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(env.GOOGLE_OAUTH_CLIENT_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

function base64url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64url(value: string): Uint8Array {
  const padded = value
    .replace(/-/g, "+")
    .replace(/_/g, "/")
    .padEnd(Math.ceil(value.length / 4) * 4, "=");
  return Uint8Array.from(atob(padded), (ch) => ch.charCodeAt(0));
}

type StatePayload = {
  /** Supabase auth.users.id of whoever started the flow. */
  sub: string;
  /**
   * Which provider this flow is for.
   *
   * Carried here so ONE callback endpoint can serve every provider. The
   * alternative — `/connections/{provider}/callback` — means a separate
   * redirect URI registered by hand in each provider's console, and a new one
   * every time a provider is added. Signing it also means the callback cannot
   * be tricked into exchanging a code against the wrong provider's client.
   */
  prv: string;
  /** Expiry, epoch seconds. */
  exp: number;
  /** Makes two states for the same user in the same second distinct. */
  nonce: string;
  /**
   * Path in the web app to return the user to, if they started somewhere
   * other than the default.
   *
   * Carried here rather than as a query parameter on the callback URL
   * precisely because this payload is signed: a `?returnTo=` Google echoed
   * back would be attacker-controlled, and redirecting to it unchecked is an
   * open redirect. Inside the signature it cannot be edited, and the route
   * still confines it to a path (see `resolveReturnTo`).
   */
  returnTo?: string;
};

/** What a verified state token yields. */
export type StateClaims = {
  userId: string;
  provider: string;
  returnTo?: string;
};

/** Mints a state token for `userId`, valid for ten minutes. */
export async function createState(
  userId: string,
  provider: string,
  returnTo?: string,
  now: Date = new Date(),
): Promise<string> {
  const payload: StatePayload = {
    sub: userId,
    prv: provider,
    exp: Math.floor(now.getTime() / 1000) + TTL_SECONDS,
    nonce: base64url(crypto.getRandomValues(new Uint8Array(9))),
    ...(returnTo ? { returnTo } : {}),
  };
  const body = base64url(
    new TextEncoder().encode(JSON.stringify(payload)),
  );
  const mac = new Uint8Array(
    await crypto.subtle.sign(
      "HMAC",
      await signingKey(),
      new TextEncoder().encode(body),
    ),
  );
  return `${body}.${base64url(mac)}`;
}

/**
 * Returns the claims carried by `state`, or null if it is malformed, forged,
 * or expired.
 *
 * Verification uses `crypto.subtle.verify` rather than comparing strings, so
 * the comparison does not leak the signature a byte at a time.
 */
export async function readState(state: string): Promise<StateClaims | null> {
  const [body, mac] = state.split(".");
  if (!body || !mac) return null;

  let valid: boolean;
  try {
    valid = await crypto.subtle.verify(
      "HMAC",
      await signingKey(),
      fromBase64url(mac),
      new TextEncoder().encode(body),
    );
  } catch {
    return null;
  }
  if (!valid) return null;

  try {
    const payload = JSON.parse(
      new TextDecoder().decode(fromBase64url(body)),
    ) as StatePayload;
    if (payload.exp * 1000 < Date.now()) return null;
    if (!payload.sub || !payload.prv) return null;
    return {
      userId: payload.sub,
      provider: payload.prv,
      returnTo: payload.returnTo,
    };
  } catch {
    return null;
  }
}
