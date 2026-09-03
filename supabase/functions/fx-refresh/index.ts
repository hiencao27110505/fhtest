/* FamilyHub — fx-refresh Edge Function.

   Updates public.fx_rates.rate_to_vnd from a public FX feed, so the client's
   foreign-currency estimate (foreign-currency-emails-spec.md) stays near the
   real bank debit without anyone typing a rate. Woken daily by pg_cron via
   _fx_refresh_tick (migration 0112); reads nothing user-scoped and writes only
   the shared, non-secret rate table.

   Deployed with --no-verify-jwt and gated on a shared secret (x-fx-secret),
   exactly like mailbox-sync: the caller is pg_cron, which has no user JWT. A
   missing or wrong secret refuses the run rather than defaulting open.

   fee_pct is NEVER touched here — it is a policy value set in the migration and
   editable by hand, not something a rate feed knows. This function moves only
   rate_to_vnd + updated_at + source.

   Fail-soft: an unreachable feed, a bad shape, or a missing currency leaves the
   existing (seeded or previously-refreshed) rates in place. A stale rate is a
   slightly-off estimate; a cleared rate would break the estimate entirely, so
   this never deletes or nulls. */
import { createClient } from "npm:@supabase/supabase-js@2";

const env = (k: string) => Deno.env.get(k) || "";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, x-fx-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (o: unknown, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { ...CORS, "Content-Type": "application/json" } });

/* The currencies we estimate for — the same set the migration seeds. A feed
   currency we do not list is ignored; a listed currency the feed omits keeps
   its existing rate. */
const CURRENCIES = ["USD", "EUR", "GBP", "JPY", "AUD", "SGD", "CNY", "KRW", "THB", "HKD", "CAD", "CHF", "TWD", "MYR", "NZD"];

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const secret = env("FX_REFRESH_SECRET");
  if (!secret || req.headers.get("x-fx-secret") !== secret) {
    return json({ error: "unauthorized" }, 401);
  }

  const url = env("SUPABASE_URL");
  const serviceKey = env("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceKey) return json({ error: "not_configured" }, 500);

  /* USD-based feed: rates[X] is units of X per 1 USD. VND per 1 X is therefore
     rates.VND / rates[X] (and rates.USD === 1, so USD → rates.VND directly).
     open.er-api.com is keyless and returns { result, rates: {...} }. */
  let feed: any;
  try {
    const r = await fetch("https://open.er-api.com/v6/latest/USD");
    if (!r.ok) return json({ error: "feed_http_" + r.status }, 502);
    feed = await r.json();
  } catch (e) {
    return json({ error: "feed_unreachable", detail: String(e) }, 502);
  }

  const rates = feed && feed.rates;
  const vndPerUsd = rates && Number(rates.VND);
  if (!rates || !(vndPerUsd > 0)) return json({ error: "feed_no_vnd" }, 502);

  const now = new Date().toISOString();
  const rows: Array<{ currency: string; rate_to_vnd: number; updated_at: string; source: string }> = [];
  for (const c of CURRENCIES) {
    const perUsd = c === "USD" ? 1 : Number(rates[c]);
    if (!(perUsd > 0)) continue;               // feed omitted it → keep existing
    const rate = vndPerUsd / perUsd;
    if (!(rate > 0) || !isFinite(rate)) continue;
    rows.push({ currency: c, rate_to_vnd: Number(rate.toFixed(6)), updated_at: now, source: "open.er-api.com" });
  }
  if (!rows.length) return json({ error: "no_rows" }, 502);

  const sb = createClient(url, serviceKey, { auth: { persistSession: false } });
  /* Upsert rate_to_vnd/updated_at/source only. fee_pct is omitted from the
     payload so the DB default/existing value stands — an upsert that named it
     would reset every hand-tuned fee to the default on each run. */
  const { error } = await sb.from("fx_rates")
    .upsert(rows, { onConflict: "currency" });
  if (error) return json({ error: "db", detail: error.message }, 500);

  return json({ ok: true, updated: rows.length, at: now });
});
