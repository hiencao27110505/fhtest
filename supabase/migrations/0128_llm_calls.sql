-- One row per LLM request the app makes, so usage/spend is actually observable
-- now that more than one feature calls the model (extraction + the merchant
-- classifier, with room for more). Written best-effort by the edge functions
-- through a single choke point (callGemini in llm.mjs) — a logging failure never
-- touches the real capture.
--
-- Privacy: this table holds NO content — no email text, no merchant, no amount,
-- no user. Only which feature called, which model, how it turned out, the token
-- counts the API itself reports, and how long it took.
create table if not exists public.llm_calls (
  id            bigint generated always as identity primary key,
  feature       text        not null,     -- 'extract' | 'classify_merchant' | future callers
  model         text,                     -- e.g. gemini-3.5-flash-lite
  outcome       text        not null,     -- 'ok' | 'rate_limited' | 'error'
  status_code   int,                      -- HTTP status, null on a transport failure
  prompt_tokens int,
  output_tokens int,
  total_tokens  int,
  latency_ms    int,
  created_at    timestamptz not null default now()
);

create index if not exists llm_calls_created_idx         on public.llm_calls (created_at desc);
create index if not exists llm_calls_feature_created_idx on public.llm_calls (feature, created_at desc);

alter table public.llm_calls enable row level security;
-- No policy on purpose: only service_role (the edge functions, and the dashboard
-- SQL editor) reads or writes it. RLS-with-no-policy blocks anon/authenticated.

-- A ready-made roll-up for eyeballing usage per feature per day (VN wall clock).
-- security_invoker so it inherits the caller's RLS instead of the owner's — an
-- authenticated client can never read aggregate usage through it either.
create or replace view public.llm_usage_daily
with (security_invoker = on) as
select
  (created_at at time zone 'Asia/Ho_Chi_Minh')::date       as day,
  feature,
  count(*)                                                  as calls,
  count(*) filter (where outcome = 'ok')                    as ok,
  count(*) filter (where outcome = 'rate_limited')          as rate_limited,
  count(*) filter (where outcome = 'error')                 as errors,
  coalesce(sum(prompt_tokens), 0)                           as prompt_tokens,
  coalesce(sum(output_tokens), 0)                           as output_tokens,
  coalesce(sum(total_tokens), 0)                            as total_tokens
from public.llm_calls
group by 1, 2
order by 1 desc, 2;
