/**
 * Tests for reading the Supabase session cookie.
 *
 * The fixtures are the format `@supabase/ssr` actually writes, not a guess:
 * each one was fed back through `createServerClient({ cookies })` at 0.12.4,
 * which recovered the same session from it. That check is what this file
 * encodes — the API and the web app have to agree on a format neither of them
 * defines.
 *
 * The verification half of this module is not covered: it needs a live JWKS
 * endpoint, and mocking one would only assert that `jose` was called, which is
 * `jose`'s own test. What is worth testing here is the parsing that happens
 * before it.
 */

import { describe, expect, test } from "bun:test";
import { Hono } from "hono";

import { AUTH_COOKIE_NAME, readAccessTokenFromCookie } from "./auth";

const ACCESS_TOKEN = "aaa.bbb.ccc";

const session = (extra: Record<string, unknown> = {}) => ({
  access_token: ACCESS_TOKEN,
  refresh_token: "rt",
  expires_at: 9_999_999_999,
  token_type: "bearer",
  user: { id: "u1", user_metadata: extra },
});

/** Encodes a session exactly as @supabase/ssr does. */
const encode = (value: unknown) =>
  `base64-${Buffer.from(JSON.stringify(value), "utf8").toString("base64url")}`;

/** Runs the reader behind a request carrying `cookies`. */
async function read(
  cookies: Record<string, string>,
): Promise<string | undefined> {
  let seen: string | undefined;
  const app = new Hono().get("/", (c) => {
    seen = readAccessTokenFromCookie(c);
    return c.body(null, 204);
  });
  await app.request("/", {
    headers: {
      // Percent-encoded, as a browser sends it: a raw JSON value contains `;`
      // and `,`, which would otherwise terminate the cookie mid-value.
      cookie: Object.entries(cookies)
        .map(([name, value]) => `${name}=${encodeURIComponent(value)}`)
        .join("; "),
    },
  });
  return seen;
}

describe("AUTH_COOKIE_NAME", () => {
  test("is derived from the project ref", () => {
    // test-env.ts sets SUPABASE_URL to https://test.supabase.co, and
    // @supabase/ssr reports `sb-test-auth-token` as its storageKey for it.
    expect(AUTH_COOKIE_NAME).toBe("sb-test-auth-token");
  });
});

describe("readAccessTokenFromCookie", () => {
  test("reads a base64 session cookie", async () => {
    expect(await read({ [AUTH_COOKIE_NAME]: encode(session()) })).toBe(
      ACCESS_TOKEN,
    );
  });

  test("reassembles a chunked session", async () => {
    // A session with sizeable user_metadata crosses the 3180-byte chunk
    // threshold, so this is ordinary traffic rather than an edge case.
    const full = encode(session({ pad: "y".repeat(4000) }));
    const half = Math.floor(full.length / 2);
    expect(
      await read({
        [`${AUTH_COOKIE_NAME}.0`]: full.slice(0, half),
        [`${AUTH_COOKIE_NAME}.1`]: full.slice(half),
      }),
    ).toBe(ACCESS_TOKEN);
  });

  test("stops at a gap rather than concatenating a stale chunk", async () => {
    // `.2` without `.1` means a longer session was partially overwritten by a
    // shorter one. Joining across the hole decodes to garbage.
    const full = encode(session());
    expect(
      await read({
        [`${AUTH_COOKIE_NAME}.0`]: full.slice(0, 10),
        [`${AUTH_COOKIE_NAME}.2`]: full.slice(10),
      }),
    ).toBeUndefined();
  });

  test("reads the unprefixed JSON older clients write", async () => {
    // Pre-0.3.0, and `cookieEncoding: 'none'`.
    expect(
      await read({ [AUTH_COOKIE_NAME]: JSON.stringify(session()) }),
    ).toBe(ACCESS_TOKEN);
  });

  test("ignores a cookie belonging to another project", async () => {
    expect(
      await read({ "sb-other-auth-token": encode(session()) }),
    ).toBeUndefined();
  });

  test("returns undefined when there is no cookie", async () => {
    expect(await read({})).toBeUndefined();
  });

  test("treats a session without an access token as signed out", async () => {
    const { access_token: _omitted, ...rest } = session();
    expect(await read({ [AUTH_COOKIE_NAME]: encode(rest) })).toBeUndefined();
  });

  test("does not throw on malformed values", async () => {
    // Every one of these is attacker-controllable, so the answer has to be
    // "not signed in" rather than a 500.
    for (const value of [
      "base64-!!!not-base64!!!",
      "base64-",
      "not-json-at-all",
      "base64-" + Buffer.from("[]").toString("base64url"),
      "base64-" + Buffer.from('{"access_token":123}').toString("base64url"),
    ]) {
      expect(await read({ [AUTH_COOKIE_NAME]: value })).toBeUndefined();
    }
  });
});
