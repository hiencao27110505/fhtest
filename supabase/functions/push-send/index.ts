/* FamilyHub — push-send Edge Function (v2: emotional copy + tap routing).
   Fans a VAPID-signed Web Push out to the caller's family after a social write
   (reaction, mood, request). The client invokes it fire-and-forget right after
   the row lands; this covers the closed-app case that realtime can't reach.

   Copy voice: each push reads like a text message from that person, never a
   system log. Title = "{firstName} + feeling", body = one warm line. Rough
   moods ask the family to check in. Request responses quote the reviewer's
   exact in-app words (keep REVIEW_LINES in sync with _reqReviewSet() in
   src/js-ui/64-requests.js).

   Privacy: payloads carry actor name + kind + emoji + opaque row ids for tap
   routing. Never titles, never amounts — E2EE plaintext must not transit here.

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
const ENTITY_TYPES = ["expense", "goal", "occasion"];

// The reviewer's exact in-app words (64-requests.js _reqReviewSet), label + line.
const REVIEW_LINES: Record<string, { vi: string; en: string }> = {
  "😂": { vi: "Vui ghê. Thích cái vụ này.", en: "Ha, love it. Love the energy." },
  "😱": { vi: "Bất ngờ. Hơi bất ngờ đấy.", en: "Whoa. That’s a surprise." },
  "🤨": { vi: "Nghĩ đã. Bàn thêm chút nha.", en: "Hmm. Let’s talk first." },
  "😤": { vi: "Chưa nên. Chưa hợp lúc này.", en: "Not now. Not right now." },
};

function buildCopy(
  kind: string, name: string, emoji: string, rough: boolean, lang: string,
): { title: string; body: string } {
  const vi = lang !== "en";
  let title: string, body: string;
  if (kind === "reaction") {
    if (emoji === "🥰") {
      title = `${name} 🥰`;
      body = vi ? "Vừa thả tim cho một khoản chi của nhà nè." : "Just dropped a heart on one of the family's expenses.";
    } else {
      title = `${name} ${emoji}`;
      body = vi ? `Vừa thả ${emoji} cho một khoản chi. Vào xem là khoản nào.` : `Left ${emoji} on an expense. Come see which one.`;
    }
  } else if (kind === "weather") {
    title = `${name} ${emoji}`;
    body = rough
      ? (vi ? `Hôm nay ${name} không được vui lắm. Hỏi thăm một câu nha.` : `${name} is having a rough day. Maybe ask how they're doing.`)
      : (vi ? `Hôm nay ${name} thấy vui. Hỏi thử xem có chuyện gì hay ho đi.` : `${name} is having a good day. Ask what the good news is.`);
  } else if (kind === "request_new") {
    title = vi ? `${name} cần cả nhà 🙌` : `${name} needs the family 🙌`;
    body = vi
      ? `Có một dự định mới chờ bạn duyệt. Xem rồi cho ${name} biết ý nhé.`
      : `A new plan is waiting for your OK. Tell ${name} what you think.`;
  } else if (emoji === "🥰") {
    title = vi ? `${name} đồng ý rồi 🥰` : `${name} said yes 🥰`;
    body = vi ? "Yêu cầu của bạn được chốt. Triển thôi." : "Your request is a go.";
  } else {
    title = `${name} ${emoji}`;
    const q = REVIEW_LINES[emoji];
    body = q
      ? (vi ? q.vi : q.en)
      : (vi ? `Vào xem ${name} nói gì nhé.` : "Come see what they said.");
  }
  return { title: title.replace(/\s+/g, " ").trim(), body: body.replace(/\s+/g, " ").trim() };
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
    const rough = body.rough === true;
    if (KINDS.indexOf(kind) < 0) return json({ error: "bad kind" }, 400);

    // tap-routing context: opaque row ids only, sanity-capped
    const nav: Record<string, string> = { k: kind };
    if (typeof body.tx === "string" && body.tx.length < 64) nav.tx = body.tx;
    if (typeof body.et === "string" && ENTITY_TYPES.indexOf(body.et) >= 0) nav.et = body.et;
    if (typeof body.eid === "string" && body.eid.length < 64) nav.eid = body.eid;

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
    const copy = buildCopy(kind, firstName, emoji, rough, lang);
    const payload = JSON.stringify({
      title: copy.title,
      body: copy.body,
      tag: "fh-" + kind,
      url: "./",
      nav,
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
