/* FamilyHub — push-send Edge Function.
   Fans a VAPID-signed Web Push out to the caller's family after a social write
   (reaction, mood, request). The client invokes it fire-and-forget right after
   the row lands; this covers the closed-app case that realtime can't reach.

   Privacy: the payload carries only actor name + kind + emoji. Never titles,
   never amounts — E2EE families' plaintext must not transit the server.

   VAPID keys live in public.push_config (RLS locked, service-role only) so the
   whole pipeline deploys via MCP without a secrets CLI. Deployed with
   verify_jwt=true; the user's JWT is also parsed here to resolve family. */
import { createClient } from "jsr:@supabase/supabase-js@2";
import * as webpush from "jsr:@negrel/webpush@0.3";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (obj: unknown, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { ...CORS, "Content-Type": "application/json" } });

const admin = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

let _srv: webpush.ApplicationServer | null = null;
async function getAppServer(): Promise<webpush.ApplicationServer | null> {
  if (_srv) return _srv;
  const { data } = await admin.from("push_config").select("k,v");
  const cfg: Record<string, string> = {};
  (data || []).forEach((r: { k: string; v: string }) => { cfg[r.k] = r.v; });
  if (!cfg.vapid_jwk) return null;
  const vapidKeys = await webpush.importVapidKeys(JSON.parse(cfg.vapid_jwk), { extractable: false });
  _srv = await webpush.ApplicationServer.new({
    contactInformation: cfg.vapid_subject || "mailto:gichisreading@gmail.com",
    vapidKeys,
  });
  return _srv;
}

const KINDS = ["reaction", "weather", "request_new", "request_response"];

function copyFor(kind: string, name: string, emoji: string, lang: string): string {
  const vi = lang !== "en";
  let t: string;
  if (kind === "reaction") {
    t = vi ? `${name} thả ${emoji} cho một khoản chi` : `${name} reacted ${emoji} to an expense`;
  } else if (kind === "weather") {
    t = vi ? `${name} vừa chia sẻ cảm xúc hôm nay ${emoji}` : `${name} shared today's mood ${emoji}`;
  } else if (kind === "request_new") {
    t = vi ? `${name} có một yêu cầu cần bạn duyệt 🙌` : `${name} sent a request for you to review 🙌`;
  } else if (emoji === "🥰") {
    t = vi ? `${name} đã đồng ý với yêu cầu của bạn 🥰` : `${name} is in on your request 🥰`;
  } else {
    t = vi ? `${name} vừa phản hồi yêu cầu của bạn ${emoji}` : `${name} responded to your request ${emoji}`;
  }
  return t.replace(/\s+/g, " ").trim();
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    const { data: { user } } = await admin.auth.getUser(jwt);
    if (!user) return json({ error: "unauthorized" }, 401);

    const body = await req.json().catch(() => ({}));
    const kind = String(body.kind || "");
    const emoji = typeof body.emoji === "string" ? body.emoji.slice(0, 8) : "";
    const target = typeof body.target === "string" ? body.target : null;
    if (KINDS.indexOf(kind) < 0) return json({ error: "bad kind" }, 400);

    // the caller's active family + member seat (server-derived, never trusted from the body)
    const { data: prof } = await admin.from("profiles").select("family_id").eq("id", user.id).maybeSingle();
    const fid = prof && prof.family_id;
    if (!fid) return json({ error: "no family" }, 400);
    const { data: actor } = await admin.from("members").select("id,name")
      .eq("family_id", fid).eq("user_id", user.id).is("archived_at", null).maybeSingle();
    if (!actor) return json({ error: "no member" }, 400);

    const { data: fam } = await admin.from("families").select("default_language").eq("id", fid).maybeSingle();
    const lang = fam && fam.default_language === "en" ? "en" : "vi";

    // recipients: every opted-in device in the family except the actor's;
    // a target member id (the requester on request_response) narrows it further
    let q = admin.from("push_subscriptions").select("id,endpoint,p256dh,auth")
      .eq("family_id", fid).neq("member_id", actor.id);
    if (target) q = q.eq("member_id", target);
    const { data: subs } = await q;
    if (!subs || !subs.length) return json({ sent: 0, pruned: 0 });

    const srv = await getAppServer();
    if (!srv) return json({ error: "push not configured" }, 500);

    const firstName = (actor.name || "").trim().split(/\s+/)[0] || actor.name || "FamilyHub";
    const payload = JSON.stringify({
      title: "FamilyHub",
      body: copyFor(kind, firstName, emoji, lang),
      tag: "fh-" + kind,
      url: "./",
    });

    let sent = 0;
    const dead: string[] = [];
    await Promise.all(subs.map(async (s: { id: string; endpoint: string; p256dh: string; auth: string }) => {
      try {
        const subscriber = srv.subscribe({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } });
        await subscriber.pushTextMessage(payload, { ttl: 3600 });
        sent++;
      } catch (err) {
        // a gone endpoint (404/410) is an uninstalled/revoked device: prune its row
        if (err instanceof webpush.PushMessageError && err.isGone()) dead.push(s.id);
      }
    }));
    if (dead.length) await admin.from("push_subscriptions").delete().in("id", dead);
    return json({ sent, pruned: dead.length });
  } catch (e) {
    return json({ error: String((e && (e as Error).message) || e) }, 500);
  }
});
