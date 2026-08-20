/* FamilyHub — push-send Edge Function (v2: emotional copy + tap routing).
   Fans a VAPID-signed Web Push out to the caller's family after a family write
   (reaction, mood, request, a logged expense, or added photos). The client
   invokes it fire-and-forget right after the row lands; this covers the
   closed-app case that realtime can't reach.

   Copy voice: each push reads like a text message from that person, never a
   system log. Title = "{firstName} + feeling", body = one warm line. Mood
   pushes just share the day's weather — no call to action, no repeated name
   (title + the iOS "from {app}" line already carry it). Request responses quote the reviewer's
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

// Deliberately WITHOUT txn_review: this list guards the user-JWT path, and a
// client must never be able to fan a review notice out to the family. The
// service-role branch checks that kind itself.
const KINDS = ["reaction", "weather", "request_new", "request_response", "expense_new", "expense_bulk", "memory_new"];

/* txn_review is the one kind with no human actor and no family audience.
 *
 * Every other kind is invoked by a member's device right after that member does
 * something social, and fans out to the REST of the family. A staged bank
 * transaction is the inverse on both counts: it is produced by the Apps Script
 * with nobody's browser open, and migration 0058 scopes staged rows to their own
 * member — so the family must NOT be told, and the one person who has to act is
 * exactly the one the normal path excludes.
 *
 * Hence a second entrance, reachable only with the service-role key, that takes
 * a member id and notifies that member alone. Compared in constant time so the
 * key cannot be discovered a byte at a time.
 */
function isServiceRole(jwt: string): boolean {
  // Fast path: exact byte match against the injected env key, constant time.
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  if (key && jwt.length === key.length) {
    let diff = 0;
    for (let i = 0; i < key.length; i++) diff |= jwt.charCodeAt(i) ^ key.charCodeAt(i);
    if (diff === 0) return true;
  }
  // Claim path (added 2026-08-20). The byte compare silently broke when the
  // runtime's injected SUPABASE_SERVICE_ROLE_KEY diverged from the legacy
  // service_role JWT the pipeline holds - REST kept accepting the JWT, this
  // compare did not, and every txn_review notify died 401 with no trace
  // (AGENT_SYNC 2026-08-20). Checking the token's own role claim cannot
  // diverge from an env var and survives key rotation.
  // SAFE ONLY BECAUSE this function deploys with verify_jwt=true: the gateway
  // has already verified the signature before we run, so the claim cannot be
  // forged. If verify_jwt is ever disabled, this branch must be removed.
  try {
    const seg = jwt.split(".");
    if (seg.length !== 3) return false;
    const payload = JSON.parse(atob(seg[1].replace(/-/g, "+").replace(/_/g, "/")));
    return payload && payload.role === "service_role";
  } catch {
    return false;
  }
}

/* Count only — never the amount, the merchant, or the bank.
 * The file's standing rule is that E2EE plaintext must not transit a push
 * service, and once sealing is switched on the pipeline could not read those
 * values to send them even if it wanted to. The notification's whole job is
 * "there is something here for you", and the app shows the rest behind the lock. */
function buildReviewCopy(count: number, lang: string): { title: string; body: string } {
  const vi = lang !== "en";
  const n = count > 1 ? count : 1;
  if (vi) {
    return {
      title: "Có giao dịch mới cần bạn duyệt",
      body: n > 1
        ? `${n} giao dịch từ email ngân hàng đang chờ bạn xem và phân loại.`
        : "Một giao dịch từ email ngân hàng đang chờ bạn xem và phân loại.",
    };
  }
  return {
    title: "New transactions to review",
    body: n > 1
      ? `${n} transactions from your bank email are waiting for you to check and categorise.`
      : "A transaction from your bank email is waiting for you to check and categorise.",
  };
}
const ENTITY_TYPES = ["expense", "goal", "occasion"];

// The reviewer's exact in-app words (64-requests.js _reqReviewSet), label + line.
const REVIEW_LINES: Record<string, { vi: string; en: string }> = {
  "😂": { vi: "Vui ghê. Thích cái vụ này.", en: "Ha, love it. Love the energy." },
  "😱": { vi: "Bất ngờ. Hơi bất ngờ đấy.", en: "Whoa. That’s a surprise." },
  "🤨": { vi: "Nghĩ đã. Bàn thêm chút nha.", en: "Hmm. Let’s talk first." },
  "😤": { vi: "Chưa nên. Chưa hợp lúc này.", en: "Not now. Not right now." },
};

function buildCopy(
  kind: string, name: string, emoji: string, rough: boolean, lang: string, count: number,
): { title: string; body: string } {
  const vi = lang !== "en";
  let title: string, body: string;
  if (kind === "expense_new") {
    // a plain everyday log — content-free by rule (no amount, no note, no merchant)
    title = `${name} 🧾`;
    body = vi ? "Vừa ghi một khoản mới cho nhà." : "Just logged a new expense.";
  } else if (kind === "expense_bulk") {
    const n = count > 1 ? count : 2;
    title = `${name} 🧾`;
    body = vi ? `Vừa ghi ${n} khoản mới cho nhà.` : `Just logged ${n} new expenses.`;
  } else if (kind === "memory_new") {
    title = `${name} 📸`;
    body = vi ? "Vừa thêm ảnh mới cho nhà." : "Just added new photos.";
  } else if (kind === "reaction") {
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
      ? (vi ? `Hôm nay là một ngày mưa.` : `It's a rainy one today.`)
      : (vi ? `Hôm nay là một ngày nắng đẹp.` : `Bright and sunny today.`);
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

    // ── service-role entrance: the bank-email pipeline, notifying one member ──
    if (isServiceRole(jwt)) {
      const b = await req.json().catch(() => ({}));
      if (String(b.kind || "") !== "txn_review") return json({ error: "bad kind" }, 400);
      const memberId = typeof b.member_id === "string" ? b.member_id : "";
      if (!/^[0-9a-f-]{36}$/i.test(memberId)) return json({ error: "bad member" }, 400);
      const count = Math.max(1, Math.min(99, Number(b.count) || 1));

      // family is derived from the member row, never taken from the body
      const { data: mem } = await admin.from("members").select("family_id")
        .eq("id", memberId).is("archived_at", null).maybeSingle();
      if (!mem || !mem.family_id) return json({ error: "no member" }, 400);
      const { data: f } = await admin.from("families").select("default_language")
        .eq("id", mem.family_id).maybeSingle();
      const lg = f && f.default_language === "en" ? "en" : "vi";

      // ONLY this member's devices. The inverse of the social path's fan-out.
      const { data: own } = await admin.from("push_subscriptions")
        .select("id,endpoint,p256dh,auth")
        .eq("family_id", mem.family_id).eq("member_id", memberId);
      // This branch logged NOTHING until 2026-08-20, which is why four days of
      // dead notifications were invisible (AGENT_SYNC). Same structured style
      // as the social path's push_fanout/push_done.
      console.log(JSON.stringify({ ev: "txn_review_subs", member: memberId.slice(0, 8), n: own ? own.length : 0 }));
      if (!own || !own.length) return json({ sent: 0, pruned: 0 });

      const srv2 = await getAppServer();
      if (!srv2) return json({ error: "push not configured" }, 500);
      const c = buildReviewCopy(count, lg);
      // tag collapses a burst: three emails in one run replace each other in the
      // tray rather than stacking three identical rows.
      const pl = JSON.stringify({ title: c.title, body: c.body, tag: "fh-txn_review", url: "./", nav: { k: "txn_review" } });

      let n = 0; const gone: string[] = [];
      await Promise.all(own.map(async (s: { id: string; endpoint: string; p256dh: string; auth: string }) => {
        try {
          await srv2.subscribe({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } })
            .pushTextMessage(pl, { ttl: 3600 });
          n++;
        } catch (err) {
          if (err instanceof webpush.PushMessageError && err.isGone()) gone.push(s.id);
          // A non-410 failure used to vanish here. Apple throttling or a bad
          // payload must be readable in the function log, not inferred.
          else console.log(JSON.stringify({ ev: "txn_review_send_err", err: String(err).slice(0, 200) }));
        }
      }));
      if (gone.length) await admin.from("push_subscriptions").delete().in("id", gone);
      console.log(JSON.stringify({ ev: "txn_review_done", sent: n, pruned: gone.length }));
      return json({ sent: n, pruned: gone.length });
    }

    const { data: { user } } = await admin.auth.getUser(jwt);
    if (!user) {
      // Parity with the 2026-08-20 diagnostic deploy: an auth reject leaves a
      // trace with the token LENGTH only, never its bytes.
      console.log(JSON.stringify({ ev: "push_401", jwtLen: jwt.length }));
      return json({ error: "unauthorized" }, 401);
    }

    const body = await req.json().catch(() => ({}));
    const kind = String(body.kind || "");
    const emoji = typeof body.emoji === "string" ? body.emoji.slice(0, 8) : "";
    const target = typeof body.target === "string" ? body.target : null;
    const rough = body.rough === true;
    const count = Math.max(1, Math.min(99, Number(body.n) || 1));   // expense_bulk row count
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

    // E2EE families (0038): members.name is ciphertext-only server-side, so the
    // actor's device sends its own display name. Accepted ONLY when the DB name
    // is null — plaintext families keep the server-derived, unspoofable name.
    let actorName = (actor.name || "").trim();
    if (!actorName && typeof body.actorName === "string") actorName = body.actorName.trim().slice(0, 40);
    const firstName = actorName.split(/\s+/)[0] || "FamilyHub";
    const copy = buildCopy(kind, firstName, emoji, rough, lang, count);
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
