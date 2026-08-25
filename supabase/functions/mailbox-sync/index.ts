/* FamilyHub — mailbox-sync Edge Function.
   Polls every connected mailbox, stages what it reads into email_transactions
   sealed to the family's staging key, and notifies the owner that something is
   waiting for review.

   Deployed with --no-verify-jwt and gated on a shared secret instead: the
   caller is pg_cron via net.http_post (migration 0085), which has no user JWT
   to present. The secret is compared in full rather than short-circuited, and a
   missing one refuses the run rather than defaulting open.

   All of the logic lives in lib/*.mjs so the same bytes run under the Node test
   runner. This file is transport: read the environment, build the context,
   report what happened. */
import nacl from "npm:tweetnacl@1.0.3";
import { runAll } from "./lib/worker.mjs";
import { createDb } from "./lib/db.mjs";
import { fromBytea } from "./lib/token-crypto.mjs";

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

  const expected = env("MAILBOX_SYNC_SECRET");
  if (!expected) return json({ error: "MAILBOX_SYNC_SECRET is not configured" }, 500);
  if (req.headers.get("x-sync-secret") !== expected) return json({ error: "forbidden" }, 403);

  const dedupKey = env("DEDUP_FP_KEY");
  const tokenKey = env("MAILBOX_TOKEN_KEY");
  // Refusing rather than running degraded. Without the dedup key every row
  // would stage unfingerprinted and cross-source duplicates would stop being
  // caught silently, which reads exactly like a week with no duplicates in it.
  if (!dedupKey || !tokenKey) return json({ error: "missing DEDUP_FP_KEY or MAILBOX_TOKEN_KEY" }, 500);

  const supabaseUrl = env("SUPABASE_URL");
  const serviceKey = env("SUPABASE_SERVICE_ROLE_KEY");
  const db = createDb(supabaseUrl, serviceKey, fetch);

  try {
    const out = await runAll({
      db,
      fetch,
      nacl,
      subtle: crypto.subtle,
      rng: crypto,
      tokenKey,
      dedupKey,
      fromBytea,
      enforceSenderAuth: env("SENDER_AUTH_ENFORCE") === "true",
      google: {
        clientId: env("GOOGLE_OAUTH_CLIENT_ID"),
        clientSecret: env("GOOGLE_OAUTH_CLIENT_SECRET"),
      },
      llm: { apiKey: env("GEMINI_API_KEY"), model: env("GEMINI_MODEL") || undefined },
      notify: (grant: { user_id: string; member_id: string }, count: number) =>
        notifyReview(supabaseUrl, serviceKey, grant, count),
    });
    return json(out);
  } catch (e) {
    console.error("mailbox-sync run failed:", e);
    return json({ error: String((e as Error)?.message || e) }, 500);
  }
});

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
