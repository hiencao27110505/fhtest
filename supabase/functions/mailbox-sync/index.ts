/* FamilyHub — mailbox-sync Edge Function.
   Polls every connected mailbox, stages what it reads into email_transactions
   sealed to the family's staging key, and notifies the owner that something is
   waiting for review.

   Deployed with --no-verify-jwt and gated on a shared secret instead: the
   caller is pg_cron via net.http_post (migration 0088), which has no user JWT
   to present. The secret is compared in full rather than short-circuited, and a
   missing one refuses the run rather than defaulting open.

   All of the logic lives in lib/*.mjs so the same bytes run under the Node test
   runner. This file is transport: read the environment, build the context,
   report what happened. */
import nacl from "npm:tweetnacl@1.0.3";
import { runAll, runPush, renewWatches } from "../_shared/mailbox/worker.mjs";
import { runIngest } from "../_shared/mailbox/ingest.mjs";
import { createDb } from "../_shared/mailbox/db.mjs";
import { fromBytea } from "../_shared/mailbox/token-crypto.mjs";
import { decodePushEnvelope } from "../_shared/mailbox/gmail.mjs";

const env = (k: string) => Deno.env.get(k) || "";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, x-sync-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (o: unknown, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { ...CORS, "Content-Type": "application/json" } });

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const url = new URL(req.url);
  const route = url.pathname.replace(/^.*\/mailbox-sync/, "") || "/";

  /* Two callers, two shapes of proof, one secret.

     pg_cron sets the header. Pub/Sub cannot set arbitrary headers on a push
     subscription, so it carries the secret in the endpoint URL instead — the
     pattern Google documents for push endpoints that do not verify an OIDC
     token. Compared in full either way rather than short-circuiting on the
     first differing byte. */
  const expected = env("MAILBOX_SYNC_SECRET");
  if (!expected) return json({ error: "MAILBOX_SYNC_SECRET is not configured" }, 500);
  const offered = req.headers.get("x-sync-secret") || url.searchParams.get("secret") || "";
  if (!timingSafeEqual(offered, expected)) return json({ error: "forbidden" }, 403);

  const dedupKey = env("DEDUP_FP_KEY");
  const tokenKey = env("MAILBOX_TOKEN_KEY");
  // Refusing rather than running degraded. Without the dedup key every row
  // would stage unfingerprinted and cross-source duplicates would stop being
  // caught silently, which reads exactly like a week with no duplicates in it.
  if (!dedupKey || !tokenKey) return json({ error: "missing DEDUP_FP_KEY or MAILBOX_TOKEN_KEY" }, 500);

  const supabaseUrl = env("SUPABASE_URL");
  const serviceKey = env("SUPABASE_SERVICE_ROLE_KEY");
  const db = createDb(supabaseUrl, serviceKey, fetch);
  const ctx = baseCtx(db, supabaseUrl, serviceKey, dedupKey, tokenKey);

  /* ── push: one mailbox, right now ──────────────────────────────────────────
     This is the path that makes a notification arrive with the bank email
     rather than up to five minutes later. Gmail rings, we read that one
     mailbox, and the person's phone buzzes.

     It ALWAYS answers 200 when the work is done or could not be retried into
     success. Pub/Sub redelivers anything else for as long as the topic retains
     it, and a malformed message or a disconnected mailbox will fail identically
     every time — so those are acknowledged, not fought. A genuinely transient
     failure is left unacknowledged, and even that is a belt-and-braces case:
     the 5-minute poll would have caught it anyway. */
  if (route === "/push") {
    let body: unknown = null;
    try { body = await req.json(); } catch { /* malformed: acked below */ }
    const notification = decodePushEnvelope(body);
    try {
      const out = await runPush(notification, ctx);
      return json(out, 200);
    } catch (e) {
      console.error("mailbox-sync push failed:", e);
      // 500 = do not ack. Pub/Sub retries with backoff.
      return json({ error: String((e as Error)?.message || e) }, 500);
    }
  }

  /* ── ingest: a mail somebody ELSE read ─────────────────────────────────────
     The Python pipeline on Cloud Run already reads mailboxes, parses Vietnamese
     bank mail and announces it. What it does not do is persist — its main.py
     ends at `# TODO: persist`. This is that line's other end: it hands over what
     it parsed and we do the half that has to happen on this side, because the
     seal is a security boundary rather than a step. One implementation of the
     construction, one DEDUP_FP_KEY, one place where plaintext becomes
     ciphertext.

     SAME SECRET, SAME COMPARISON as the tick and the push above — the check has
     already run by the time control reaches here, so this route cannot be
     reached unauthenticated even if it is edited later.

     It answers 200 for every outcome a retry cannot improve, including a HOLD.
     That is deliberate and it is explained at length in ingest.mjs: a hold is a
     property of the mailbox rather than of the message, so redelivery cannot fix
     it, and what actually heals it is the poll below leaving its cursor alone on
     the very same condition. 5xx is reserved for a genuine fault, where a retry
     is worth something. */
  if (route === "/ingest") {
    let body: unknown = null;
    try { body = await req.json(); } catch { /* refused as malformed below */ }
    try {
      const out = await runIngest(body, ctx);
      return json(out, 200);
    } catch (e) {
      console.error("mailbox-sync ingest failed:", e);
      return json({ error: String((e as Error)?.message || e) }, 500);
    }
  }

  /* ── the tick: the safety net, plus keeping the doorbell wired ────────────
     Push is the optimisation; this is the guarantee. A watch lapses after 7
     days and Gmail then stops publishing SILENTLY, a notification can be
     dropped, and a mailbox can be connected while the topic is misconfigured —
     all of which look exactly like a quiet mailbox. The poll catches every one
     of them, and the renewal keeps the fast path alive.

     Renewal runs first: a mailbox whose watch is about to lapse is one we want
     re-registered even if the poll below later runs out of its per-run budget. */
  try {
    const watches = await renewWatches(ctx);
    const out = await runAll(ctx);
    return json({ ...out, watches });
  } catch (e) {
    console.error("mailbox-sync run failed:", e);
    return json({ error: String((e as Error)?.message || e) }, 500);
  }
});

/* Everything the worker needs, built once per request so the push path and the
   tick cannot drift apart in what they hand it. */
function baseCtx(
  db: ReturnType<typeof createDb>,
  supabaseUrl: string,
  serviceKey: string,
  dedupKey: string,
  tokenKey: string,
) {
  return {
    db,
    fetch,
    nacl,
    subtle: crypto.subtle,
    rng: crypto,
    tokenKey,
    dedupKey,
    fromBytea,
    topicName: env("GMAIL_PUSH_TOPIC") || "",
    enforceSenderAuth: env("SENDER_AUTH_ENFORCE") === "true",
    google: {
      clientId: env("GOOGLE_OAUTH_CLIENT_ID"),
      clientSecret: env("GOOGLE_OAUTH_CLIENT_SECRET"),
    },
    llm: { apiKey: env("GEMINI_API_KEY"), model: env("GEMINI_MODEL") || undefined },
    notify: (grant: { user_id: string; member_id: string }, count: number) =>
      notifyReview(supabaseUrl, serviceKey, grant, count),
  };
}

/* Compares every byte rather than stopping at the first difference. The timing
   signal on a shared secret is not a practical attack over the public internet,
   but writing the fast version is how it ends up copied somewhere it is. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/* One push per mailbox per run, carrying no amount and no merchant.
   That is not an oversight in the payload: push travels through a third-party
   service and the whole point of sealing the row is that nobody outside the
   family learns what is in it. "Something is waiting" is the entire message,
   and the tap routes into the review screen where it can be read properly. */
async function notifyReview(
  url: string,
  serviceKey: string,
  grant: { user_id: string; member_id: string },
  count: number,
) {
  await fetch(url.replace(/\/$/, "") + "/functions/v1/push-send", {
    method: "POST",
    headers: { Authorization: "Bearer " + serviceKey, "Content-Type": "application/json" },
    body: JSON.stringify({ kind: "txn_review", member_id: grant.member_id, count }),
  });
}
