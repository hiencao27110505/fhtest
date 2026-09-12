/* FamilyHub — streak-digest Edge Function (0133, habit-streak-spec §7).
   The 6AM doorbell: pg_cron fires this once a day (23:00 UTC = 06:00 ICT);
   it fans a CONTENT-FREE push out to every member whose user holds an active
   personal streak, or whose family holds an active family streak. The
   service worker composes the actual verdict copy on-device from its local
   digest snapshot — the server cannot know streak state (E2EE) and pushes
   never carry amounts or merchants; the payload body here is only the
   generic fallback line the SW shows when its snapshot is cold.

   Auth: deployed with verify_jwt=false and gated by a shared secret. The
   secret lives in TWO service-role-only places written by the same change:
   vault.secrets['streak_digest_secret'] (read by the cron tick) and
   push_config k='streak_digest_secret' (read here) — so no manual env-var
   step exists between deploy and working. Compared in constant time. */
import { createClient } from "jsr:@supabase/supabase-js@2";
import * as webpush from "jsr:@negrel/webpush@0.3";

const admin = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const json = (obj: unknown, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json" } });

function timingEq(a: string, b: string): boolean {
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

let _srv: webpush.ApplicationServer | null = null;
async function getAppServer(cfg: Record<string, string>): Promise<webpush.ApplicationServer | null> {
  if (_srv) return _srv;
  if (!cfg.vapid_jwk) return null;
  const vapidKeys = await webpush.importVapidKeys(JSON.parse(cfg.vapid_jwk), { extractable: false });
  _srv = await webpush.ApplicationServer.new({
    contactInformation: cfg.vapid_subject || "mailto:gichisreading@gmail.com",
    vapidKeys,
  });
  return _srv;
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "method" }, 405);
  const url = new URL(req.url);
  const given = url.searchParams.get("secret") || "";

  const { data: cfgRows } = await admin.from("push_config").select("k,v");
  const cfg: Record<string, string> = {};
  (cfgRows || []).forEach((r: { k: string; v: string }) => { cfg[r.k] = r.v; });
  if (!timingEq(given, cfg.streak_digest_secret || "")) return json({ error: "auth" }, 401);

  /* Members to ring: has a push subscription AND (their user owns an active
     personal streak OR their family holds an active family streak). One push
     per member seat; a member with devices in two families rings per seat. */
  const { data: targets, error: tErr } = await admin.rpc("streak_digest_targets");
  if (tErr) return json({ error: "targets", detail: String(tErr.message || tErr) }, 500);
  if (!targets || !targets.length) return json({ sent: 0 });

  const srv = await getAppServer(cfg);
  if (!srv) return json({ error: "no vapid" }, 500);

  /* Body = the SW's cold-cache fallback line (§F of the copy matrix). No
     amounts, no merchants, no counts — the SW replaces it with the real
     verdict when its snapshot is warm. */
  const payload = JSON.stringify({
    k: "streak_digest",
    title: "",
    body: "Chuỗi thói quen của bạn có tin sáng nay — mở app xem nha!",
    tag: "fh-streak",
    url: "./",
  });

  let sent = 0;
  const dead: string[] = [];
  await Promise.all((targets as { sub_id: string; endpoint: string; p256dh: string; auth: string }[])
    .map(async (s) => {
      try {
        const subscriber = srv.subscribe({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } });
        await subscriber.pushTextMessage(payload, { ttl: 6 * 3600 });
        sent++;
      } catch (err) {
        const msg = String(err);
        if (msg.includes("410") || msg.includes("404")) dead.push(s.sub_id);
        else console.log(JSON.stringify({ ev: "streak_send_err", err: msg.slice(0, 200) }));
      }
    }));
  if (dead.length) await admin.from("push_subscriptions").delete().in("id", dead);
  console.log(JSON.stringify({ ev: "streak_digest_done", sent, pruned: dead.length }));
  return json({ sent, pruned: dead.length });
});
