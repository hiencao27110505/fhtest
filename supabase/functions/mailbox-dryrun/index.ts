/* FamilyHub — mailbox-dryrun Edge Function (evaluation tooling, 2026-09-20).

   Reads ONE connected mailbox through the exact extraction path the worker uses
   (junk cache → stored template → label-table → Gemini, then the category
   cascade) and RETURNS the readings instead of sealing and staging them.

   What it deliberately does NOT do: seal, insert into email_transactions, move
   the grant's cursor, notify, or record parse_failures.

   AND IT WRITES NOTHING ELSE EITHER (2026-09-22). This paragraph used to say
   "the only writes are the ones readTransaction/enrichCategory already make:
   learned templates, the junk cache, the merchant-concept cache and the LLM
   usage log, all of which are caches". Those caches are live and shared by
   every family, so a "dry" run pointed at a mailbox wrote that mailbox's
   subjects into sender_fingerprints, and tallies, miss labels, learned-label
   votes, derive failures, merchant concepts and llm_calls rows into
   production. Every database handle below is now the read-only proxy from
   dry-db.mjs: reads pass through, every write is a no-op, and the reply says
   what WOULD have been written (`wouldWrite: {method: count}`). The real
   handle is never bound to a name here, so no later edit can reach past the
   proxy by accident. pipeline/dryrun-is-dry.test.js pins all of it.

   Purpose: measure a proposed category tree against original bank mail, with
   the owner's consent, without touching the live queue. Gated on the same
   MAILBOX_SYNC_SECRET as mailbox-sync; deployed --no-verify-jwt like it.

   Body: { grant: <mailbox_grants.id>, days?: 1..365 (default 90),
           skip?: 0.. (page start), max?: 1..200 (page size, default 120),
           modelCalls?: 0..40 (default 0: a missing or non-numeric value
                        sends NOTHING to the model, for extract and classify
                        alike; ask for calls explicitly),
           readerV?: 1 | 2 (default 1: what payload each row WOULD seal, as
                        stage.mjs buildPayload builds it for that reader
                        version; 2 shows the v2 keys, src map included) }
   Each row carries `raw`, the raw_extracted that would be sealed, and the
   tally counts the v2 outcomes too: notice, multi, format_cap.
   Reply carries `next` (the skip for the following page) or null when the
   window is exhausted. See research/statements/dryrun.sh for the loop. */
import { createDb } from "../_shared/mailbox/db.mjs";
import { fromBytea, decryptToken } from "../_shared/mailbox/token-crypto.mjs";
import { readTransaction } from "../_shared/mailbox/extract.mjs";
import { enrichCategory } from "../_shared/mailbox/classify.mjs";
import { buildPayload } from "../_shared/mailbox/stage.mjs";
import { toReading, BUILD_ID } from "../_shared/mailbox/worker.mjs";
import * as senders from "../_shared/mailbox/senders.mjs";
import * as gmail from "../_shared/mailbox/gmail.mjs";
import * as mailtext from "../_shared/mailbox/mailtext.mjs";
import { dryDb, parseModelCalls } from "./dry-db.mjs";

const env = (k: string) => Deno.env.get(k) || "";
const json = (o: unknown, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { "Content-Type": "application/json" } });

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function budget(max: number) {
  let used = 0;
  return { spend: () => (used < max ? (used++, true) : false), used: () => used, left: () => max - used };
}

async function pooled<T, R>(items: T[], limit: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  const lanes = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k]); }
  });
  await Promise.all(lanes);
  return out;
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  const expected = env("MAILBOX_SYNC_SECRET");
  if (!expected) return json({ error: "MAILBOX_SYNC_SECRET is not configured" }, 500);
  const offered = req.headers.get("x-sync-secret") || "";
  if (!timingSafeEqual(offered, expected)) return json({ error: "forbidden" }, 403);

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { return json({ error: "malformed body" }, 400); }
  const grantId = typeof body.grant === "string" ? body.grant : "";
  if (!grantId) return json({ error: "grant required" }, 400);
  const days = Math.min(365, Math.max(1, Number(body.days) || 90));
  /* One isolate cannot hold a year of full bodies (WORKER_RESOURCE_LIMIT at
     905 messages), so a call is one PAGE: list the whole window (ids are
     cheap), take `max` of them from `skip`, and process each message as it
     arrives rather than fetching the batch first. Callers loop over `skip`. */
  const max = Math.min(200, Math.max(1, Number(body.max) || 120));
  const skip = Math.max(0, Number(body.skip) || 0);
  const modelCalls = parseModelCalls(body.modelCalls);
  const readerV = Number(body.readerV) === 2 ? 2 : 1;

  /* The real handle never leaves this line. Everything below sees `db`, the
     read-only proxy: reads pass through, writes are counted and dropped. */
  const dry = dryDb(createDb(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), fetch, { readerBuild: BUILD_ID }));
  const db = dry.db;
  const grant = await db.grantById(grantId);
  if (!grant) return json({ error: "no_grant" }, 404);

  let token: string;
  try {
    token = await decryptToken(fromBytea(grant.refresh_token_enc), env("MAILBOX_TOKEN_KEY"), { subtle: crypto.subtle });
  } catch { return json({ error: "token_unreadable" }, 500); }
  let access: string;
  try {
    access = await gmail.accessToken(token, { clientId: env("GOOGLE_OAUTH_CLIENT_ID"), clientSecret: env("GOOGLE_OAUTH_CLIENT_SECRET") }, fetch);
  } catch (e) { return json({ error: "needs_reauth", detail: String((e as Error)?.message || e) }, 502); }

  const domains = await db.providerDomains();
  const allIds: string[] = await gmail.listMessageIds(senders.inboxQuery(days, domains), 2000, access, fetch);
  const ids = allIds.slice(skip, skip + max);

  let learnedLabels = null;
  if (db.loadLearnedLabels) { try { learnedLabels = await db.loadLearnedLabels(); } catch { /* optional */ } }
  const llm = {
    apiKey: env("GEMINI_API_KEY"),
    model: env("GEMINI_MODEL") || undefined,
    // Through the proxy like every other write: counted, not stored.
    logLlm: (rec: Record<string, unknown>) => db.recordLlmCall(rec),
  };
  // `subtle` was missing here, so the cascade could not hash a merchant key and
  // silently skipped its correction and cache tiers: the dry run measured a
  // classifier production does not run.
  const ctx = { db, fetch, llm, subtle: crypto.subtle, classifyBudget: { left: modelCalls } };
  const bud = budget(modelCalls);

  /* Fewer lanes than the worker and one retry with backoff: the first run of
     this function lost 659 of 905 fetches with no detail recorded, so the
     error text is now kept (first 120 chars, counted by shape) and a transient
     Gmail refusal gets a second chance before it is written off. */
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const rows: Record<string, unknown>[] = [];
  const tally: Record<string, number> = { window: allIds.length, page: ids.length, fetch_error: 0, not_sender: 0, not_a_transaction: 0, notice: 0, multi: 0, format_cap: 0, unreadable: 0, held: 0, ok: 0 };
  const stages: Record<string, number> = {};
  const fetchErrors: Record<string, number> = {};

  /* Fetch, read, and drop the body in one lane step, so at most `lanes`
     bodies exist at any moment. Rows keep only the extraction. */
  await pooled(ids, 4, async (id) => {
    let message = null;
    let error = "";
    for (let attempt = 0; attempt < 3; attempt++) {
      try { message = await gmail.getMessage(id, access, fetch, mailtext); error = ""; break; }
      catch (e) {
        error = String((e as Error)?.message || e);
        if (!/429|5\d\d|rate|quota|timeout|ECONN|network/i.test(error)) break;
        await sleep(1500 * (attempt + 1));
      }
    }
    if (error || !message) {
      tally.fetch_error++;
      const shape = (error || "empty").replace(/[0-9a-f]{12,}/gi, "#").slice(0, 80);
      fetchErrors[shape] = (fetchErrors[shape] || 0) + 1;
      return;
    }
    const sender = senders.match(message.from, domains);
    if (!sender) { tally.not_sender++; return; }
    let read;
    try {
      read = await readTransaction(message, db, {
        llm, fetch, budget: bud, subtle: crypto.subtle, fingerprints: null, learnedLabels,
        // As the worker passes them: the sender's class and provider, the
        // format store (read-only here), and the build the format cap is keyed on.
        senderKind: sender.senderKind || sender.kind, provider: sender.provider,
        formats: db.formats, build: BUILD_ID,
      });
    } catch (e) {
      tally.held++;
      rows.push({ id, date: message.date, from: message.from, subject: message.subject, outcome: "held", detail: String((e as Error)?.message || e).slice(0, 160) });
      return;
    }
    if (!read.ok) {
      const k = read.mailKind === "notice" ? "notice"
        : (read.reason === "multi" || read.reason === "format_cap" || read.reason === "not_a_transaction") ? read.reason : "unreadable";
      tally[k]++;
      const row: Record<string, unknown> = { id, date: message.date, from: message.from, subject: message.subject, outcome: k, detail: read.detail || read.reason || null };
      if (k === "notice") {
        // What a notice row WOULD seal (row_kind 'notice', no amount, no dedup).
        row.raw = buildPayload({ rowKind: "notice", readerV, senderKind: sender.senderKind || sender.kind,
          reading: toReading({ mail_kind: "notice", signal: read.notice.signal || null, notice: read.notice.fields || null, loan: read.notice.loan || null }, message) }).raw_extracted;
      }
      rows.push(row);
      return;
    }
    try { await enrichCategory(read.extraction, grant, ctx); } catch { /* garnish */ }
    tally.ok++;
    stages[read.stage] = (stages[read.stage] || 0) + 1;
    const x = read.extraction;
    rows.push({
      id, date: message.date, from: message.from, subject: message.subject, outcome: "ok", stage: read.stage,
      provider: x.source_provider || sender.provider, sender_kind: sender.kind,
      direction: x.direction, amount: x.amount, currency: x.currency, occurred_at: x.occurred_at,
      counterparty: x.counterparty, memo: x.memo, memo_display: x.memo_display, type_code: x.type_code,
      transaction_type: x.transaction_type, counterparty_row: x.counterparty_row ?? null,
      account_kind: x.account_kind, account_masked: x.account_masked,
      card_masked: x.card_masked, flow: x.flow, status: x.status, balance: x.balance,
      category: x.category, pool: x.pool, node: x.node ?? null, channel: x.channel, reference: x.reference_number,
      // The payload as the worker would seal it for a mailbox on `readerV`.
      raw: buildPayload({ reading: toReading(x, message), senderKind: sender.senderKind || sender.kind, readerV }).raw_extracted,
    });
  });
  return json({ grant: grant.id, email: grant.email, days, skip, max, next: skip + max < allIds.length ? skip + max : null, modelCalls, modelCallsUsed: bud.used(), classifyCallsLeft: ctx.classifyBudget.left, readerV, build: BUILD_ID, wouldWrite: dry.wouldWrite, tally, fetchErrors, stages, rows });
});
