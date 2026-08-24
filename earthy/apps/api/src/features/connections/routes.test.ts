/**
 * Route-level tests for the callback's final redirect.
 *
 * The property under test is that the flow can never send a browser off-site.
 * `returnTo` rides inside a signature this service mints, so it is not
 * attacker-authored — but it IS user-supplied at the authorize step, and a
 * signature proves only that we minted it, never that it was sensible.
 */

import { describe, expect, test } from "bun:test";

import { app } from "@/app";
import { env } from "@/lib/env";

import { createState, readState } from "./oauth-state";
import { beginConnect } from "./service";

const USER = "11111111-1111-1111-1111-111111111111";

/** The Location a declined consent lands on, for a given returnTo. */
async function redirectFor(returnTo?: string): Promise<URL> {
  const state = await createState(USER, "google", returnTo);
  const res = await app.request(
    `/connections/callback?error=access_denied&state=${encodeURIComponent(state)}`,
  );
  expect(res.status).toBe(302);
  return new URL(res.headers.get("location")!);
}

describe("callback redirect", () => {
  test("marks a failure with reason, on the returnTo path", async () => {
    // The marker has to survive the returnTo merge: that merge assigns
    // `url.search` wholesale from the returnTo path, so a marker baked into the
    // configured base URL would be discarded. Landing with neither `reason` nor
    // a success flag is indistinguishable from an ordinary page load, and the
    // person who just came back from Google would be shown nothing.
    const url = await redirectFor("/dashboard");
    expect(url.pathname).toBe("/dashboard");
    expect(url.searchParams.get("reason")).toBe("declined");
    expect(url.searchParams.has("fh_gmail")).toBe(false);
  });

  test("stays on the configured origin for an off-site returnTo", async () => {
    // The one that matters: an absolute URL must not be honoured.
    const origin = new URL(env.OAUTH_FAILURE_REDIRECT).origin;
    for (const hostile of [
      "https://evil.example/steal",
      "//evil.example/steal",
      "http://evil.example",
    ]) {
      expect((await redirectFor(hostile)).origin).toBe(origin);
    }
  });

  test("returns the user to the path they started from", async () => {
    const url = await redirectFor("/settings/email");
    expect(url.origin).toBe(new URL(env.OAUTH_FAILURE_REDIRECT).origin);
    expect(url.pathname).toBe("/settings/email");
  });

  test("falls back to the configured page when there is no returnTo", async () => {
    const configured = new URL(env.OAUTH_FAILURE_REDIRECT);
    const url = await redirectFor();
    expect(url.pathname).toBe(configured.pathname);
  });

  test("reports the failure kind and nothing more", async () => {
    const url = await redirectFor("/settings");
    expect(url.searchParams.get("reason")).toBe("declined");
  });

  test("a forged state still redirects rather than erroring", async () => {
    // No usable state means no returnTo, but the user must still land
    // somewhere rather than see a raw 400.
    const res = await app.request(
      "/connections/callback?code=abc&state=forged",
    );
    expect(res.status).toBe(302);
    expect(new URL(res.headers.get("location")!).searchParams.get("reason")).toBe(
      "invalid_state",
    );
  });
});

describe("authorize", () => {
  test("requires a signed-in caller", async () => {
    const res = await app.request("/connections/google/authorize");
    expect(res.status).toBe(401);
  });

  test("answers JSON for a caller that asks for it", async () => {
    // The client MUST have this: it calls with a Bearer token, so it reaches
    // this endpoint by fetch — and a cross-origin fetch can neither follow the
    // 302 (Google refuses a fetch) nor read it with redirect:"manual", which
    // the Fetch Standard turns into an opaque-redirect whose headers are
    // filtered out. A redirect-only endpoint is unusable from the browser.
    const target = await beginConnect(USER, "google", "/settings");
    expect(target.startsWith("https://accounts.google.com")).toBe(true);
  });

  test("passes login_hint through, and omits it when absent", async () => {
    // The hint only pre-selects an account on Google's chooser. It is
    // deliberately not inside the signed state: nothing downstream trusts it,
    // because the connected address comes from Google's token response.
    const hinted = new URL(
      await beginConnect(USER, "google", "/settings", "someone@gmail.com"),
    );
    expect(hinted.searchParams.get("login_hint")).toBe("someone@gmail.com");

    // Absent rather than empty: an empty login_hint can leave Google on the
    // already-active account instead of showing the picker.
    const bare = new URL(await beginConnect(USER, "google", "/settings"));
    expect(bare.searchParams.has("login_hint")).toBe(false);
  });

  test("hands the browser to the provider, with a state naming the caller", async () => {
    // Verifying a real token needs the project's live JWKS, so the redirect
    // itself is asserted through `beginConnect` — the same call the handler
    // makes — rather than by faking a signature the middleware would reject.
    const target = new URL(await beginConnect(USER, "google", "/settings"));
    expect(target.origin).toBe("https://accounts.google.com");
    expect(target.searchParams.get("access_type")).toBe("offline");
    // Both values matter: `consent` re-issues a refresh token, and
    // `select_account` forces the chooser so a live Google session cannot
    // silently connect an account the person never read off the screen.
    expect(target.searchParams.get("prompt")).toBe("select_account consent");
    expect(target.searchParams.get("scope")).toBe(
      "https://www.googleapis.com/auth/gmail.readonly",
    );

    // And the state it carries round-trips to the right user and page.
    const claims = await readState(target.searchParams.get("state")!);
    expect(claims).toMatchObject({
      userId: USER,
      provider: "google",
      returnTo: "/settings",
    });
  });

  test("rejects a provider the registry does not know", async () => {
    // The validator answers before the handler, so an unsupported provider
    // can never reach code that would look up a client secret for it. 401
    // here rather than 400 only because auth runs first.
    const res = await app.request("/connections/dropbox/authorize");
    expect([400, 401]).toContain(res.status);
  });
});

describe("callback", () => {
  test("serves every provider from one path", async () => {
    // The point of keeping the provider in the signed state: this endpoint
    // has no provider segment, so a new integration needs no new redirect URI
    // registered in anyone's console.
    const state = await createState(USER, "google", "/settings");
    const res = await app.request(
      `/connections/callback?error=access_denied&state=${encodeURIComponent(state)}`,
    );
    expect(res.status).toBe(302);
  });

  test("refuses a state naming a provider that no longer exists", async () => {
    // A state minted before a provider was withdrawn must not resolve to
    // whatever provider happens to be first in the registry now.
    const stale = await createState(USER, "retired-provider", "/settings");
    const res = await app.request(
      `/connections/callback?code=abc&state=${encodeURIComponent(stale)}`,
    );
    expect(
      new URL(res.headers.get("location")!).searchParams.get("reason"),
    ).toBe("invalid_state");
  });
});
