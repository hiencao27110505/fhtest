import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";

import { env } from "@/lib/env";
import { type AuthEnv, requireAuth } from "@/middleware/auth";

import { ConnectError, type ConnectFailure } from "./errors";
import { listAccounts, unlinkAccount } from "./repository";
import { PROVIDER_IDS, PROVIDERS } from "./providers";
import { beginConnect, completeConnect } from "./service";

/**
 * HTTP for the connect flow. Transport only: parse, delegate, render.
 *
 *   GET    /connections                      → the caller's links
 *   GET    /connections/:provider/authorize  → 302 to the provider
 *   DELETE /connections/:provider            → disconnect
 *   GET    /connections/callback             → redirect back into the app
 *
 * The provider is a path segment on the routes a user drives, and the set of
 * valid values comes from `providers.ts` — adding one is a record there, not
 * another copy of these endpoints.
 *
 * The callback is the exception: ONE endpoint for every provider, with the
 * provider read from the signed state. Per-provider callback paths would each
 * need their own redirect URI registered by hand in that provider's console,
 * so every new integration would mean console work before the code could run.
 *
 * Authorize answers `302` to the provider, so the page starts the flow with a
 * plain link or `window.location` — no fetch, no JSON, no client code.
 *
 * That works because the API is served from the same site as the web app. The
 * Supabase session cookie is `SameSite=Lax`, which is sent on exactly this
 * kind of request: a top-level GET navigation. `requireAuth` therefore sees
 * the caller, and can sign a state naming them.
 *
 * It is the same-site deployment that this depends on, not the redirect. If
 * the API ever moves to a different site, the cookie stops being sent — it
 * belongs to the web app's host, so there is simply nothing to send — and this
 * endpoint 401s on every navigation. The fix then is to return the URL as JSON
 * and have the page fetch it with `credentials: "include"`, because a fetch
 * cannot act on a cross-origin redirect in either mode: `follow` chases it to
 * the provider, which sends no CORS headers, and `manual` yields an
 * `opaqueredirect` whose `Location` is hidden from JavaScript.
 *
 * The callback is unauthenticated and cannot be otherwise: it is a plain
 * browser GET arriving from accounts.google.com with no header of ours. The
 * signed `state` is what identifies the user there, which is why it is signed
 * at all — it is the only thing standing between this endpoint and someone
 * grafting a mailbox onto another account.
 */

/**
 * `returnTo` is where in the web app the user was when they reached for the
 * feature. Bounded in length so a caller cannot use the signed state as a
 * storage bucket, and confined to a path before use (see `confineToPath`).
 */
const authorizeQuery = z.object({
  returnTo: z.string().max(512).optional(),
  // Which account to open Google's chooser on. An email shape is required so a
  // junk value is a 400 here rather than a puzzling consent screen, but it is
  // never treated as the connected address — that comes from Google.
  login_hint: z.email().max(320).optional(),
});

/**
 * The provider segment, narrowed to what the registry actually supports.
 *
 * A `z.enum` rather than a free string, so an unknown provider is a 400 from
 * the validator instead of something a handler has to remember to check.
 */
const providerParam = z.object({
  provider: z.enum(PROVIDER_IDS),
});

const callbackQuery = z.object({
  code: z.string().optional(),
  state: z.string().optional(),
  error: z.string().optional(),
});

export const connectionsRoutes = new Hono<AuthEnv>()
  // GET, not POST: this creates nothing and changes nothing — it signs a
  // state token and formats a URL. Both are derived from the request, and a
  // second call is indistinguishable from the first.
  .get(
    "/connections/:provider/authorize",
    requireAuth,
    zValidator("param", providerParam),
    zValidator("query", authorizeQuery),
    async (c) => {
      const { provider } = c.req.valid("param");
      const { returnTo, login_hint: loginHint } = c.req.valid("query");
      const url = await beginConnect(
        c.get("user").id,
        provider,
        returnTo,
        loginHint,
      );

      // A 302 is unreadable to the caller that needs it most. This endpoint
      // requires a Bearer token, so a browser reaches it through fetch, not a
      // navigation — and a cross-origin fetch cannot follow the redirect
      // (Google refuses the request) nor read it with `redirect: "manual"`:
      // per the Fetch Standard that yields an OPAQUE-REDIRECT response, whose
      // headers are filtered out entirely and are "indistinguishable from a
      // network error". `Access-Control-Expose-Headers` cannot lift that — it
      // is a spec-level filter, not a CORS decision. So `Location` reads back
      // as null and the client has nowhere to send anyone.
      //
      // Handing the URL over as JSON is what makes the flow work: the caller
      // navigates itself, which is also what keeps the hand-off a real
      // top-level navigation rather than a fetch Google would reject.
      if (c.req.header("Accept")?.includes("application/json")) {
        return c.json({ url });
      }

      // A plain browser navigation (no Accept: application/json) still gets
      // the redirect, so the endpoint remains usable by simply visiting it.
      return c.redirect(url);
    },
  )

  .get(
    "/connections/callback",
    zValidator("query", callbackQuery),
    async (c) => {
      let returnTo: string | undefined;
      try {
        ({ returnTo } = await completeConnect(c.req.valid("query"), {
          tokenKey: env.GMAIL_TOKEN_KEY,
        }));
      } catch (err) {
        if (err instanceof ConnectError) {
          logFailure(err.failure);
          // A failure sends them back to where they started too — landing on a
          // default page with an error they cannot connect to what they were
          // doing is worse than no message at all.
          return c.redirect(
            endUrl(env.OAUTH_FAILURE_REDIRECT, err.failure.kind, err.returnTo),
          );
        }
        throw err;
      }
      return c.redirect(endUrl(env.OAUTH_SUCCESS_REDIRECT, null, returnTo));
    },
  )

  .get("/connections", requireAuth, async (c) => {
    const accounts = await listAccounts(c.get("user").id);
    return c.json(accounts);
  })

  .delete(
    "/connections/:provider",
    requireAuth,
    zValidator("param", providerParam),
    async (c) => {
      const { provider } = c.req.valid("param");
      const removed = await unlinkAccount(c.get("user").id, provider);
      if (removed === 0) {
        throw new HTTPException(404, {
          message: `No connected ${PROVIDERS[provider].label} account`,
        });
      }
      // The grant at the provider is not revoked. Deleting the row stops the
      // pipeline reading the mailbox; revoking the app entirely is the user's
      // own call, in their account settings at the provider.
      return c.json({ disconnected: removed });
    },
  );

/**
 * The URL the browser is finally sent to.
 *
 * `reason`, when present, is the failure `kind` and nothing else. Details that
 * would help an attacker calibrate — which half of a state token was wrong,
 * what Google said — stay in the log; the user gets a word their settings page
 * can turn into a sentence in their own language.
 */
function endUrl(
  base: string,
  reason: string | null,
  returnTo: string | undefined,
): string {
  const url = new URL(base);
  const path = confineToPath(returnTo);
  if (path) {
    // Replace the path, keep the origin. The origin is ours, from config; the
    // path is the only part the flow is allowed to influence.
    const target = new URL(path, url.origin);
    url.pathname = target.pathname;
    url.search = target.search;
  }
  // Set the outcome AFTER the returnTo merge above, never before: that merge
  // assigns `url.search` wholesale from the returnTo path, so anything written
  // earlier — including an outcome marker baked into the configured base URL —
  // is discarded. Writing both markers here means the signal survives a
  // returnTo, which is the common case rather than the exception.
  if (reason) url.searchParams.set("reason", reason);
  // A positive success marker, not merely the absence of `reason`. The client
  // wakes on a cold boot with no memory of having started a flow, so "no error
  // param" is indistinguishable from an ordinary page load, and the person who
  // just granted access would see nothing at all.
  else url.searchParams.set("fh_gmail", "1");
  return url.toString();
}

/**
 * Reduces `returnTo` to a same-site path, or nothing.
 *
 * The value is already inside a signature this service produced, so it is not
 * attacker-authored — but it is user-supplied at the authorize step, and a
 * signature only proves we minted it, not that it was sensible. Confining it
 * here means the worst a malicious `?returnTo=https://evil.example` can do is
 * be ignored, and the redirect can never leave the configured origin.
 */
function confineToPath(returnTo: string | undefined): string | undefined {
  if (!returnTo) return undefined;
  // A protocol-relative `//evil.example` is a URL to a browser, not a path.
  if (!returnTo.startsWith("/") || returnTo.startsWith("//")) return undefined;
  return returnTo;
}

/**
 * Logs a failure at a severity that matches what it means.
 *
 * The switch is exhaustive over the union, so adding a failure kind fails the
 * build here rather than defaulting into silence.
 */
function logFailure(failure: ConnectFailure): void {
  switch (failure.kind) {
    case "declined":
      // A user changing their mind is not an incident.
      console.info("Gmail connect declined by user:", failure.providerError);
      return;
    case "no_refresh_token":
    case "insufficient_scope":
    case "mailbox_taken":
      // Expected outcomes with a user-facing remedy, worth counting but not
      // worth waking anyone.
      console.warn(`Gmail connect refused: ${failure.kind}`);
      return;
    case "malformed_callback":
    case "invalid_state":
      // Either a stale tab or someone probing the callback. Either way this
      // is the line worth alerting on if these start arriving in volume.
      console.warn(`Suspicious Gmail callback: ${failure.kind}`);
      return;
    case "provider_unavailable":
      console.error("Google OAuth call failed:", failure.cause);
      return;
    default:
      // Unreachable while the switch covers the union; the assignment is what
      // makes the compiler prove it.
      failure satisfies never;
  }
}
