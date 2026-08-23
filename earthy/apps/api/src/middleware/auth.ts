import type { Context } from "hono";
import { getCookie } from "hono/cookie";
import { createMiddleware } from "hono/factory";
import { HTTPException } from "hono/http-exception";
import { createRemoteJWKSet, jwtVerify } from "jose";
import isNull from "lodash/isNull";
import isUndefined from "lodash/isUndefined";

import { env } from "@/lib/env";

/**
 * Working out who is calling, from a Supabase session.
 *
 * Three steps, in order: find the access token on the request, prove our
 * project issued it, and attach the caller to the context. They live in one
 * file because none is useful alone — the cookie format only matters because a
 * JWT has to come out of it, and the verifier only ever sees tokens found here.
 */

/**
 * The authenticated caller, as attached to the context by `requireAuth`.
 *
 * `id` is the Supabase `auth.users.id` uuid, not a local serial — it is the
 * value foreign keys like `connected_accounts.user_id` point at, so anything
 * that narrows it to a number would silently file rows under the wrong owner.
 */
export type AuthUser = {
  id: string;
  email: string;
};

/**
 * Context shape for authenticated routes. A private chain must be built as
 * `new Hono<AuthEnv>()` for `c.get('user')` to be typed.
 */
export type AuthEnv = {
  Variables: {
    user: AuthUser;
  };
};

// ── Finding the token ──────────────────────────────────────────────────────

/**
 * The cookie name `@supabase/ssr` writes, derived from the project URL.
 *
 * The ref is the first label of the Supabase hostname
 * (`https://abcdefgh.supabase.co` → `abcdefgh`), which is how the library
 * builds `storageKey`. Verified against @supabase/ssr 0.12.4, which reports
 * exactly `sb-abcdefgh-auth-token` for that URL.
 */
export const AUTH_COOKIE_NAME = `sb-${new URL(env.SUPABASE_URL).hostname.split(".")[0]}-auth-token`;

/**
 * How many chunk suffixes to look for.
 *
 * A session is split at 3180 bytes per cookie, so ten covers roughly 32KB —
 * far past anything a browser will keep. The bound exists so a request stuffed
 * with `…auth-token.N` cookies cannot make this loop unbounded work.
 */
const MAX_CHUNKS = 10;

/**
 * Reassembles the cookie value, chunked or not.
 *
 * The unchunked name is checked first because that is the common case; the
 * scan then stops at the first missing index, which is the library's own
 * reassembly rule — a gap means the later chunks belong to a stale,
 * partially-overwritten session, and concatenating past it yields garbage.
 */
function readRawCookie(c: Context): string | undefined {
  const single = getCookie(c, AUTH_COOKIE_NAME);
  if (single) return single;

  let value = "";
  for (let index = 0; index < MAX_CHUNKS; index++) {
    const chunk = getCookie(c, `${AUTH_COOKIE_NAME}.${index}`);
    if (isUndefined(chunk)) break;
    value += chunk;
  }
  return value || undefined;
}

/** Decodes base64url, tolerating the padding the library strips. */
function decodeBase64Url(value: string): string {
  const padded = value
    .replace(/-/g, "+")
    .replace(/_/g, "/")
    .padEnd(Math.ceil(value.length / 4) * 4, "=");
  return new TextDecoder().decode(
    Uint8Array.from(atob(padded), (ch) => ch.charCodeAt(0)),
  );
}

/**
 * The access token out of a Supabase session cookie, if there is a usable one.
 *
 * The cookie is NOT a bare JWT, which is the thing worth knowing here: the web
 * app signs in with `createBrowserClient`, and what lands in the cookie is
 *
 *   sb-<ref>-auth-token = "base64-" + base64url(JSON.stringify(session))
 *
 * where `session` holds `access_token`, `refresh_token`, `expires_at`, `user`
 * and more. Only `access_token` is a JWT, so passing the cookie value straight
 * to `jwtVerify` fails every time. Sessions over 3180 bytes are split across
 * `.0`, `.1`, … and must be concatenated first — a session with sizeable
 * `user_metadata` crosses that line, so chunking is normal traffic.
 *
 * The `base64-` marker arrived in @supabase/ssr 0.3.0; older clients and
 * `cookieEncoding: 'none'` store raw JSON, so both forms are accepted.
 *
 * Reading only. Refreshing an expired session and rotating refresh tokens are
 * `@supabase/ssr`'s job on the web side; this API takes the access token as it
 * finds it and lets verification reject it if it has expired.
 *
 * Returns undefined rather than throwing on every malformed case: the value is
 * attacker-controllable, and a stale, truncated, or hand-edited cookie should
 * read as "not signed in", never as a 500.
 */
export function readAccessTokenFromCookie(c: Context): string | undefined {
  const raw = readRawCookie(c);
  if (isUndefined(raw)) return;

  let json: string;
  if (raw.startsWith("base64-")) {
    try {
      json = decodeBase64Url(raw.slice("base64-".length));
    } catch {
      return;
    }
  } else {
    json = raw;
  }

  try {
    const session = JSON.parse(json) as { access_token?: unknown };
    return typeof session.access_token === "string" && session.access_token
      ? session.access_token
      : undefined;
  } catch {
    return;
  }
}

/**
 * Resolves the caller's access token from the `Authorization` header, falling
 * back to the Supabase session cookie.
 *
 * The header wins so an explicit credential always beats an ambient one: a
 * caller passing a token is stating which identity to use, and silently
 * preferring a stale cookie would act as somebody else. Returns undefined when
 * neither source carries a usable value, so a present-but-blank header is
 * treated as absent rather than passed on as an empty token.
 */
function resolveToken(c: Context): string | undefined {
  const header = c.req.header("Authorization");
  if (header) {
    const bearer = header.replace(/^Bearer\b\s*/i, "").trim();
    if (bearer) return bearer;
  }
  return readAccessTokenFromCookie(c);
}

// ── Verifying it ───────────────────────────────────────────────────────────

/**
 * Supabase signs project JWTs with asymmetric keys published at the project's
 * JWKS endpoint, so verification needs no shared secret here — which matters,
 * because the alternative (holding the project's signing secret in this
 * service) would make this API able to MINT tokens, not just check them.
 *
 * `createRemoteJWKSet` caches the key set and refetches only on an unknown
 * `kid`, so this is one network call at startup rather than one per request,
 * and it survives a Supabase key rotation without a redeploy.
 */
const JWKS = createRemoteJWKSet(
  new URL("/auth/v1/.well-known/jwks.json", env.SUPABASE_URL),
);

/**
 * Returns the caller, or null if the token is expired, malformed, or not
 * signed by this project.
 *
 * `issuer` is pinned as well as the signature: a validly-signed token from a
 * *different* Supabase project would otherwise be accepted, and its `sub`
 * would be a uuid that means nothing in our auth.users.
 */
export async function verifySupabaseToken(
  token: string,
): Promise<AuthUser | null> {
  try {
    const { payload } = await jwtVerify(token, JWKS, {
      issuer: new URL("/auth/v1", env.SUPABASE_URL).toString(),
    });

    const id = payload.sub;
    const email = payload.email as string;
    if (isUndefined(id)) return null;

    return { id, email };
  } catch {
    // Any verification failure is one answer to the caller: unauthorized. The
    // reason is deliberately not surfaced — distinguishing "expired" from
    // "bad signature" tells an attacker which half to work on.
    return null;
  }
}

// ── The middleware ─────────────────────────────────────────────────────────

/**
 * Rejects the request with 401 unless it carries a verifiable token, otherwise
 * attaches the caller to the context as `user`.
 *
 * Register it before the routes it guards — Hono runs middleware in
 * registration order, so a `.use()` placed after a route leaves that route open.
 */
export const requireAuth = createMiddleware<AuthEnv>(async (c, next) => {
  const token = resolveToken(c);
  if (isUndefined(token) || token.length === 0) {
    throw new HTTPException(401, { message: "Unauthorized" });
  }

  const user = await verifySupabaseToken(token);
  if (isNull(user)) throw new HTTPException(401, { message: "Unauthorized" });

  c.set("user", user);
  return next();
});
