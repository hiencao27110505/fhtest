-- 0110: learn which banks we DON'T cover — the only unknown-unknown in selection.
--
-- Selection is `from:(157 hardcoded domains)`. A bank outside that list is
-- never LISTED, so every downstream instrument — template_missed,
-- extract_miss_labels, parse_failures, read_tally — is structurally blind to
-- it. The user with an uncovered bank experiences "the app doesn't work"; we
-- experience nothing at all.
--
-- The probe (worker.mjs runCoverageProbe, weekly cron below) lists
-- `category:updates newer_than:30d`, HEADERS ONLY, drops everything already in
-- the registry, and counts domains whose subjects look transaction-shaped.
--
-- WHAT THIS TABLE HOLDS, BY CONSTRUCTION: a domain and counts. No subjects, no
-- addresses, no message ids, no per-user rows — `mailboxes` is an aggregate
-- computed in memory across one probe run. This is written the way
-- extract_miss_labels had to LEARN to be written, after it was found holding
-- transaction amounts, a person's name and cinema seat numbers under a comment
-- promising values never leave the mail. Here the schema enforces the promise:
-- there is no column a value could go into.
--
-- SURFACING, NOT AUTO-WIDENING. Adding a domain to selection stays a human
-- decision via provider_domains. A heuristic must never decide by itself what
-- mail enters a ledger pipeline.
--
-- Next free migration number after this one: 0112 — renumbered from 0107 in
-- flight, because Hien applied his own 0107–0109 concurrently; the AGENT_SYNC
-- claim existed but was not pulled. Verify against the live schema, not just
-- the file list.

begin;

create table if not exists public.coverage_candidates (
  domain     text        not null primary key,
  mailboxes  int         not null,             -- DISTINCT mailboxes seeing it, this probe
  messages   int         not null,             -- transaction-shaped messages, this probe
  last_seen  timestamptz not null default now()
);

alter table public.coverage_candidates enable row level security;
revoke all on table public.coverage_candidates from public, anon, authenticated;
grant select, insert, update, delete on table public.coverage_candidates to service_role;

comment on table public.coverage_candidates is
  'Domains sending transaction-shaped mail that selection does not cover. Domain + counts only, aggregated in memory per probe run — no subjects, no addresses, no per-user rows. Read it to grow provider_domains deliberately; nothing auto-widens from it.';

-- ── the weekly tick ─────────────────────────────────────────────────────────
-- Same vault entries as the 5-minute tick. Body carries the mode flag; the
-- function routes on it. Sunday 03:00 UTC = Sunday 10:00 VN — quiet hours.
-- timeout_milliseconds is set because the probe does real work: pg_net's 5000ms
-- default abandons any response slower than that (every backfill run's summary
-- was lost to exactly this).
create or replace function public._mailbox_coverage_tick()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url    text;
  v_secret text;
begin
  select decrypted_secret into v_url    from vault.decrypted_secrets where name = 'mailbox_sync_url';
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'mailbox_sync_secret';
  if v_url is null or v_secret is null then return; end if;
  perform net.http_post(
    url     := v_url,
    body    := '{"coverage":true}'::jsonb,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-sync-secret', v_secret),
    timeout_milliseconds := 120000
  );
end;
$$;
revoke all on function public._mailbox_coverage_tick() from public, anon, authenticated;

do $$ begin
  if exists (select 1 from cron.job where jobname = 'familyhub-coverage-probe') then
    perform cron.unschedule('familyhub-coverage-probe');
  end if;
end $$;
select cron.schedule('familyhub-coverage-probe', '0 3 * * 0', 'select public._mailbox_coverage_tick();');

commit;
