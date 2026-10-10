-- 0159 ▸ scan_read_log: how long a receipt read takes, and where the time goes
-- (docs/features/receipt-scan.md, "Measuring a read").
--
-- The first real scans in production (2026-10-10) took about a minute per photo
-- on 4G, and nothing recorded which leg was slow: the phone shrinking the image,
-- the upload, the sign-in check, Gemini, or the validator. The site's request
-- logs live in a hosting account this side cannot read, so two fixes went out as
-- guesses. This table is the measurement: one row per read, written by the
-- device after the read settles, carrying the device's own timings plus the ones
-- api/receipt-extract.js hands back.
--
-- WHAT IS DELIBERATELY NOT HERE: who. No user id, no family id, no device id, and
-- nothing that was read (no amount, merchant, date, text or image). The consent
-- sheet says nothing read is stored on the server, and a duration is not a read.
-- A row cannot be tied to a person or to a ledger row; it answers "how slow, and
-- where", which is all it is for.
--
-- Insert-only for signed-in clients; nobody reads it through the API. It is read
-- with the SQL editor / CLI. The CHECKs bound every number so a client cannot
-- park junk in it. Safe to drop at any time: nothing depends on it.

create table if not exists public.scan_read_log (
  id            uuid primary key default gen_random_uuid(),
  created_at    timestamptz not null default now(),
  outcome       text not null check (outcome in ('ok','flag','credit','unread','err','offline')),
  err           text check (err is null or length(err) <= 12),          -- http status, 'net', 'auth'
  net           text check (net is null or length(net) <= 12),          -- navigator.connection.effectiveType where the browser has it
  lang          text check (lang is null or lang in ('vi','en')),
  doc_kind      text check (doc_kind is null or length(doc_kind) <= 24),
  bytes_sent    integer check (bytes_sent is null or bytes_sent between 0 and 20000000),
  -- device legs, milliseconds
  ms_total      integer check (ms_total    is null or ms_total    between 0 and 600000),
  ms_compress   integer check (ms_compress is null or ms_compress between 0 and 600000),
  ms_token      integer check (ms_token    is null or ms_token    between 0 and 600000),
  ms_request    integer check (ms_request  is null or ms_request  between 0 and 600000),   -- fetch sent → response parsed: upload + server + download
  -- server legs, milliseconds (null when the server never answered)
  ms_server     integer check (ms_server   is null or ms_server   between 0 and 600000),
  ms_auth       integer check (ms_auth     is null or ms_auth     between 0 and 600000),
  ms_gemini     integer check (ms_gemini   is null or ms_gemini   between 0 and 600000),
  ms_validate   integer check (ms_validate is null or ms_validate between 0 and 600000),
  retried       boolean,                                                                    -- the thinking setting was refused and the call repeated
  model         text check (model is null or length(model) <= 48),
  tok_in        integer check (tok_in    is null or tok_in    between 0 and 10000000),
  tok_out       integer check (tok_out   is null or tok_out   between 0 and 10000000),
  tok_think     integer check (tok_think is null or tok_think between 0 and 10000000)
);

create index if not exists scan_read_log_created_at_idx on public.scan_read_log (created_at desc);

alter table public.scan_read_log enable row level security;

revoke all on public.scan_read_log from anon, authenticated;
grant insert on public.scan_read_log to authenticated;

drop policy if exists scan_read_log_insert on public.scan_read_log;
create policy scan_read_log_insert on public.scan_read_log
  for insert to authenticated with check (true);
