/* FamilyHub — merchant-concepts Edge Function.
   (docs/specs/statement-capture-spec.md section 11, decision S22)

   A statement lands thirty merchants on a device at once, and the device's own
   category cascade (history, learned corrections, MCC, brand, keyword) cannot place
   the ones nobody in the family has seen. A transaction EMAIL gets help with that on
   the server (classify.mjs, the shared `merchant_concepts` cache); a statement is
   parsed on the device and would get none. This function is that help, reached
   from the device:

       POST { merchants: ["HIGHLANDS COFFEE", "DONG TAY BARBER", ...] }
       ->   { concepts: { "HIGHLANDS COFFEE": "Dining", "DONG TAY BARBER": null }, limited: false }

   WHAT IT IS SENT. Merchant names, and nothing else: no amount, no date, no
   account, and never a counterparty that is a person -- the device filters those
   out before calling (77-statement-capture.js), because "NGUYEN VAN A" is not a
   merchant and has no business reaching a model. The server already sees merchant
   names in every bank email it parses, so this opens no new class of data.

   WHAT IT COSTS. Cache first; ONE batched model call for whatever is left; every
   answer stored for every user. The project runs on the Gemini free tier: a
   rate-limited model returns `limited: true` and nulls, the rows land in "Cần bạn
   xem" without a category, and opening a statement never waits on it.

   Deployed with verify_jwt=true, and gated on the same beta allowlist as the
   mailbox features (can_use_mailbox), so it is not an open proxy to the model. */
import { createClient } from "jsr:@supabase/supabase-js@2";
import { createDb } from "../_shared/mailbox/db.mjs";
import { conceptsForMerchants, BATCH_MAX } from "../_shared/mailbox/classify.mjs";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (obj: unknown, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { ...CORS, "Content-Type": "application/json" } });

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const admin = createClient(SUPABASE_URL, SERVICE_KEY);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "method" }, 405);
  try {
    const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    const { data: { user } } = await admin.auth.getUser(jwt);
    if (!user) return json({ error: "unauthorized" }, 401);

    // The allowlist is asked AS THE USER, so the answer is theirs, not the service role's.
    const asUser = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY") || SERVICE_KEY, {
      global: { headers: { Authorization: "Bearer " + jwt } },
    });
    const gate = await asUser.rpc("can_use_mailbox");
    if (gate.error || gate.data !== true) return json({ error: "not_enabled" }, 403);

    const body = await req.json().catch(() => ({}));
    const list = Array.isArray(body.merchants) ? body.merchants : [];
    const names = list.filter((x: unknown) => typeof x === "string").map((x: string) => x.slice(0, 80)).slice(0, BATCH_MAX);
    if (!names.length) return json({ concepts: {}, limited: false });

    const db = createDb(SUPABASE_URL, SERVICE_KEY, fetch);
    const out = await conceptsForMerchants(names, user.id, {
      db, fetch, subtle: crypto.subtle,
      llm: {
        apiKey: Deno.env.get("GEMINI_CLASSIFY") === "off" ? null : Deno.env.get("GEMINI_API_KEY"),
        model: Deno.env.get("GEMINI_MODEL") || undefined,
        logLlm: (rec: Record<string, unknown>) => db.recordLlmCall(rec),
      },
    });
    // Counts only. Never the names.
    console.log(JSON.stringify({ ev: "merchant_concepts", n: out.total, asked: out.asked, limited: out.limited }));
    return json({ concepts: out.concepts, limited: out.limited });
  } catch (e) {
    console.log(JSON.stringify({ ev: "merchant_concepts_err", err: String(e).slice(0, 200) }));
    return json({ error: "failed" }, 500);
  }
});
