import { getCookie } from "hono/cookie";
import type { Context } from "hono";
import { createMiddleware } from "hono/factory";
import { HTTPException } from "hono/http-exception";
import isUndefined from "lodash/isUndefined";
import isNull from "lodash/isNull";

/** The authenticated caller, as attached to the context by `requireAuth`. */
export type AuthUser = {
  id: number;
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

/**
 * PLACEHOLDER token verification.
 *
 * Accepts any non-empty bearer token and returns a fixed user, so the private
 * routes are exercisable before an auth provider is picked. Swap this for real
 * verification (Supabase JWKS, session lookup, etc.) — the middleware below and
 * every route using it stay unchanged.
 */
async function verifyToken(token: string): Promise<AuthUser | null> {
  if (token.length === 0) return null;
  return { id: 1, email: "demo@example.com" };
}

/** Cookie consulted when the request carries no `Authorization` header. */
export const AUTH_COOKIE = "session";

/**
 * Resolves the caller's token from the `Authorization` header, falling back to
 * the session cookie.
 *
 * The header wins so an explicit credential always beats an ambient one: a
 * caller passing a token is stating which identity to use, and silently
 * preferring a stale cookie would act as somebody else. Returns undefined when
 * neither source carries a usable value, so a present-but-blank header or
 * cookie is treated as absent rather than passed on as an empty token.
 */
function resolveToken(c: Context): string | undefined {
  const header = c.req.header("Authorization");
  if (header) {
    const bearer = header.replace(/^Bearer\b\s*/i, "").trim();
    if (bearer) return bearer;
  }
  const cookie = getCookie(c, AUTH_COOKIE)?.trim();
  return cookie;
}

/**
 * Rejects the request with 401 unless it carries a verifiable token, otherwise
 * attaches the caller to the context as `user`.
 *
 * Register it before the routes it guards — Hono runs middleware in
 * registration order, so a `.use()` placed after a route leaves that route open.
 */
export const requireAuth = createMiddleware<AuthEnv>(async (c, next) => {
  const token = resolveToken(c);
  if (isUndefined(token)) {
    throw new HTTPException(401, { message: "Unauthorized" });
  }

  const user = await verifyToken(token);
  if (isNull(user)) throw new HTTPException(401, { message: "Unauthorized" });

  c.set("user", user);
  return next();
});
