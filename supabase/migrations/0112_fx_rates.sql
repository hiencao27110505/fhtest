-- 0112_fx_rates.sql — a shared FX rate + fee table for foreign-currency emails.
--
-- WHY THIS EXISTS. A bank email for a foreign card charge ("111 USD" for a
-- Claude subscription) has no VND figure the ledger can store, and the app is
-- zero-typing by design: the review screen's job is TAP to confirm, never key
-- in data (effortless-transaction-logging-spec.md). So the client estimates the
-- VND itself and pre-fills it — the person taps import like any other row. This
-- table is the estimate's two inputs, kept in one shared place so every device
-- (and a future rate refresh) reads the same numbers:
--
--   rate_to_vnd  — VND per 1 unit of the currency (a reference/mid rate).
--   fee_pct      — the bank's foreign-transaction markup+fee, as a percent. VN
--                  card issuers bundle a spread into their rate AND often add an
--                  explicit fee; ~3% is the common all-in figure. The estimate
--                  is  round(amount * rate_to_vnd * (1 + fee_pct/100)), so the
--                  pre-filled number lands near the real debit instead of a few
--                  percent low. It is an ESTIMATE, labelled as one on the card,
--                  and always editable — never a silent machine-written amount.
--
-- The real bank-converted VND, when the email prints it, is always preferred
-- over this estimate (foreign-currency-emails-spec.md, Approach 2); this table
-- is only for the USD-only emails that carry no conversion.
--
-- NOT family-scoped. A rate is a property of the world, not of a family, so the
-- table is global and every family reads it. Non-sensitive: RLS allows any
-- authenticated user to read, and only the service role (the refresh function)
-- writes.

create table if not exists public.fx_rates (
  currency    text primary key,
  rate_to_vnd numeric(18,6) not null check (rate_to_vnd > 0),
  fee_pct     numeric(6,3)  not null default 3.0 check (fee_pct >= 0 and fee_pct < 100),
  updated_at  timestamptz   not null default now(),
  source      text
);

comment on table public.fx_rates is
  'Shared FX reference rates + bank foreign-transaction fee, for estimating the VND of a foreign-currency bank email (foreign-currency-emails-spec.md). Global, not family-scoped.';
comment on column public.fx_rates.rate_to_vnd is 'VND per 1 unit of `currency` — a reference/mid rate, refreshed by the fx-refresh Edge Function.';
comment on column public.fx_rates.fee_pct is 'Bank foreign-transaction markup+fee as a percent; folded into the estimate. Policy value, NOT touched by the rate refresh.';

-- Seed with approximate rates (as of 2026-09) so the feature works on day one,
-- before the refresh cron has ever run. The refresh updates rate_to_vnd in
-- place and never disturbs fee_pct. ON CONFLICT DO NOTHING so re-running the
-- migration cannot stomp a freshly-refreshed rate back to the seed.
insert into public.fx_rates (currency, rate_to_vnd, fee_pct, source) values
  ('USD', 26350,   3.0, 'seed'),
  ('EUR', 28500,   3.0, 'seed'),
  ('GBP', 33500,   3.0, 'seed'),
  ('JPY', 178,     3.0, 'seed'),
  ('AUD', 17500,   3.0, 'seed'),
  ('SGD', 19600,   3.0, 'seed'),
  ('CNY', 3700,    3.0, 'seed'),
  ('KRW', 19.5,    3.0, 'seed'),
  ('THB', 740,     3.0, 'seed'),
  ('HKD', 3380,    3.0, 'seed'),
  ('CAD', 19400,   3.0, 'seed'),
  ('CHF', 30500,   3.0, 'seed'),
  ('TWD', 830,     3.0, 'seed'),
  ('MYR', 5900,    3.0, 'seed'),
  ('NZD', 15900,   3.0, 'seed')
on conflict (currency) do nothing;

alter table public.fx_rates enable row level security;

-- Readable by any signed-in user; a rate is not a secret. Writes go only through
-- the service role (RLS-bypassing), which is what the refresh Edge Function uses.
drop policy if exists fx_rates_read on public.fx_rates;
create policy fx_rates_read on public.fx_rates
  for select to authenticated
  using (true);

-- ── the refresh, decoupled from Postgres ─────────────────────────────────────
--
-- pg_net can POST fire-and-forget but reading a JSON response back inside
-- plpgsql is awkward and brittle. The rate fetch therefore lives in an Edge
-- Function (Deno `fetch` + JSON, service-role upsert); this tick only WAKES it,
-- exactly as _mailbox_sync_tick wakes the sync worker (0088). URL + shared
-- secret come from the vault so neither is committed, and the tick no-ops until
-- both are set — the seeded rates carry the app until then.
create or replace function public._fx_refresh_tick()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url    text;
  v_secret text;
begin
  select decrypted_secret into v_url    from vault.decrypted_secrets where name = 'fx_refresh_url';
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'fx_refresh_secret';
  if v_url is null or v_secret is null then
    return;
  end if;
  perform net.http_post(
    url     := v_url,
    body    := '{}'::jsonb,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-fx-secret', v_secret)
  );
end;
$$;

revoke all on function public._fx_refresh_tick() from public, anon, authenticated;

comment on function public._fx_refresh_tick() is
  'Wakes the fx-refresh Edge Function to update fx_rates.rate_to_vnd. Reads its URL and shared secret from the vault. No-ops until both are set; seeded rates carry the app until then.';

-- Daily at 01:00 UTC (08:00 Asia/Ho_Chi_Minh) — rates move slowly and a spend
-- estimate tolerates a day's drift. Unschedule-first so re-running cannot leave
-- two jobs.
do $$
begin
  if exists (select 1 from cron.job where jobname = 'familyhub-fx-refresh') then
    perform cron.unschedule('familyhub-fx-refresh');
  end if;
end $$;

select cron.schedule('familyhub-fx-refresh', '0 1 * * *', 'select public._fx_refresh_tick();');
