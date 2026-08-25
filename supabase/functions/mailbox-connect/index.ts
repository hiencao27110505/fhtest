/* FamilyHub — mailbox-connect Edge Function.
   The consent round trip for direct mailbox read: hand the browser a Google
   consent URL, then turn the callback into an encrypted grant row.

   Deployed with --no-verify-jwt, and it has to be. The callback is a plain
   browser GET arriving from accounts.google.com with no header of ours on it,
   so the gateway has nothing to verify. Each route therefore does its own
   authentication, and they are different by necessity:

     /authorize  a Supabase access token, verified against /auth/v1/user
     /callback   the signed state, which is the ONLY thing standing between
                 this endpoint and someone grafting their mailbox onto another
                 person's ledger

   Everything substantive lives in ../_shared/mailbox/*.mjs, shared with the
   worker and exercised by the Node tests. */
import {
  completeConnect,
  authorizationUrl,
  ConnectError,
} from "../_shared/mailbox/google-oauth.mjs";
import { createState, readState, confineToPath } from "../_shared/mailbox/oauth-state.mjs";
import { accessToken, watch } from "../_shared/mailbox/gmail.mjs";
import { encryptToken, toBytea } from "../_shared/mailbox/token-crypto.mjs";

const env = (k: string) => Deno.env.get(k) || "";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};
const json = (o: unknown, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { ...CORS, "Content-Type": "application/json" } });

function googleCfg() {
  return {
    clientId: env("GOOGLE_OAUTH_CLIENT_ID"),
    clientSecret: env("GOOGLE_OAUTH_CLIENT_SECRET"),
    redirectUri: env("GOOGLE_OAUTH_REDIRECT_URI"),
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const url = new URL(req.url);
  // The function name is part of the path Supabase routes on, so the route is
  // whatever follows it.
  const route = url.pathname.replace(/^.*\/mailbox-connect/, "") || "/";

  if (route === "/authorize") return authorize(req, url);
  if (route === "/callback") return callback(url);
  return json({ error: "not found" }, 404);
});

/* Answers with the URL as JSON, not a 302.
   A cross-origin fetch cannot act on a redirect in either mode: `follow` chases
   it to Google, which sends no CORS headers, and `manual` yields an opaque
   redirect whose Location the Fetch Standard filters out entirely, so it reads
   back as null. Handing the URL over as data lets the page navigate itself,
   which is also what the consent screen needs — a real top-level navigation
   rather than a fetch Google would refuse. */
async function authorize(req: Request, url: URL): Promise<Response> {
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer /i, "");
  const userId = await verifyUser(token);
  if (!userId) return json({ error: "unauthorized" }, 401);

  const cfg = googleCfg();
  if (!cfg.clientId || !cfg.redirectUri) return json({ error: "oauth not configured" }, 500);

  const secret = env("MAILBOX_STATE_SECRET");
  if (!secret) return json({ error: "MAILBOX_STATE_SECRET is not configured" }, 500);

  const returnTo = url.searchParams.get("returnTo") || undefined;
  // A hint, never a claim: it only pre-selects an account on Google's chooser,
  // and the address we store comes from Google's own profile call.
  const loginHint = url.searchParams.get("login_hint") || undefined;

  const state = await createState({ userId, returnTo }, secret);
  return json({ url: authorizationUrl(state, cfg, loginHint) });
}

/* The browser comes back here from Google. Unauthenticated by nature. */
async function callback(url: URL): Promise<Response> {
  const secret = env("MAILBOX_STATE_SECRET");
  const code = url.searchParams.get("code") || "";
  const state = url.searchParams.get("state") || "";
  const error = url.searchParams.get("error") || "";

  // Read FIRST, before the outcome is even looked at: Google echoes the state
  // back on a decline too, and a declined consent is the most ordinary ending
  // this flow has. Reading it here is what lets the person land back on the
  // page they started from rather than on a default one.
  const claims = state && secret ? await readState(state, secret) : null;
  const returnTo = claims?.returnTo;

  if (error) return bounce("declined", returnTo);
  if (!code || !claims) return bounce(claims ? "malformed_callback" : "invalid_state", returnTo);

  let grant;
  let grantId: string | null = null;
  try {
    grant = await completeConnect({ code }, googleCfg(), {});
  } catch (e) {
    const kind = e instanceof ConnectError ? e.kind : "provider_unavailable";
    // The reason is a single word. Anything that would help someone calibrate
    // an attack — which half of the state was wrong, what Google said — stays
    // in the log.
    console.warn("mailbox connect failed:", kind, String((e as Error)?.message || e));
    return bounce(kind, returnTo);
  }

  try {
    const enc = await encryptToken(grant.refreshToken, env("MAILBOX_TOKEN_KEY"));
    const res = await fetch(
      env("SUPABASE_URL").replace(/\/$/, "") + "/rest/v1/rpc/grant_mailbox_access",
      {
        method: "POST",
        headers: {
          apikey: env("SUPABASE_SERVICE_ROLE_KEY"),
          Authorization: "Bearer " + env("SUPABASE_SERVICE_ROLE_KEY"),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          p_user_id: claims.userId,
          p_email: grant.email,
          p_token: toBytea(enc),
          p_scopes: grant.scopes,
        }),
      },
    );
    if (!res.ok) {
      const detail = await res.text();
      console.error("grant_mailbox_access refused:", detail.slice(0, 300));
      // The function raises `no_member_row` for a user with no member in a real
      // family. That is a product state, not a fault: they granted access before
      // finishing onboarding, and the app can tell them so.
      return bounce(detail.includes("no_member_row") ? "no_member" : "store_failed", returnTo);
    }
    grantId = (await res.json()) as string;
  } catch (e) {
    console.error("storing the grant failed:", e);
    return bounce("store_failed", returnTo);
  }

  /* Ring the doorbell from the very first minute.

     Registered HERE rather than left to the renewal sweep because this is the
     one moment the flow already holds a working refresh token and the person is
     still watching the screen. Waiting for the next tick would mean their first
     bank email arrives on the slow path, which is the first impression the
     feature gets to make.

     BEST EFFORT, and deliberately so. A failure here costs latency, not
     transactions: the 5-minute poll reads the mailbox regardless, and the
     renewal sweep treats a null expiry as due and tries again. Bouncing someone
     to an error screen after they successfully granted access, because a
     notification channel could not be wired, would be the wrong trade. */
  if (grantId && env("GMAIL_PUSH_TOPIC")) {
    try {
      const access = await accessToken(grant.refreshToken, googleCfg());
      const registered = await watch(env("GMAIL_PUSH_TOPIC"), access);
      await fetch(
        env("SUPABASE_URL").replace(/\/$/, "") + "/rest/v1/mailbox_grants?id=eq." + grantId,
        {
          method: "PATCH",
          headers: {
            apikey: env("SUPABASE_SERVICE_ROLE_KEY"),
            Authorization: "Bearer " + env("SUPABASE_SERVICE_ROLE_KEY"),
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            watch_expires_at: registered.expiration
              ? new Date(registered.expiration).toISOString()
              : null,
          }),
        },
      );
    } catch (e) {
      console.warn("watch registration failed; the poll still covers this mailbox:", e);
    }
  }

  return bounce(null, returnTo);
}

/* Back into the app, with one word about how it went.
   The success marker is POSITIVE rather than merely the absence of an error:
   the client can wake on a cold boot with no memory of having started a flow,
   so "no error param" is indistinguishable from an ordinary page load and the
   person who just granted access would see nothing at all. */
function bounce(reason: string | null, returnTo?: string): Response {
  const target = new URL(env("APP_ORIGIN") || "https://fhtest-opal.vercel.app");
  const path = confineToPath(returnTo);
  if (path) {
    const merged = new URL(path, target.origin);
    target.pathname = merged.pathname;
    target.search = merged.search;
  }
  // Written AFTER the returnTo merge, never before: that merge assigns `search`
  // wholesale, so a marker set earlier would be silently discarded.
  if (reason) target.searchParams.set("reason", reason);
  else target.searchParams.set("fh_gmail", "1");
  return Response.redirect(target.toString(), 302);
}

/* Verifies a Supabase access token by asking Supabase, rather than by parsing
   it here. Same approach as api/csv-column-mapping.js: no JWT library, no
   signing key in this function, and it cannot drift from what the rest of the
   platform considers a valid session. */
async function verifyUser(token: string): Promise<string | null> {
  if (!token) return null;
  try {
    const res = await fetch(env("SUPABASE_URL").replace(/\/$/, "") + "/auth/v1/user", {
      headers: { apikey: env("SUPABASE_ANON_KEY"), Authorization: "Bearer " + token },
    });
    if (!res.ok) return null;
    const user = await res.json();
    return user?.id || null;
  } catch {
    return null;
  }
}
