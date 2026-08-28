-- 0099: fingerprint cache hygiene + read-tier telemetry.
--
-- WHY. The shared learning cache (sender_fingerprints) was fragmenting two
-- ways, and both were found by tracing real mailboxes, not by review:
--   • case-split keys — the forwarding writer never lowercased the sender, so
--     VCBDigibank@… and vcbdigibank@… accumulated as two separate piles and
--     neither ever got tall enough to graduate a template;
--   • forwarded shapes keyed with their "Fwd: " prefix intact, splitting them
--     from the same mail arriving directly.
-- Both writers are fixed in code alongside this migration; this merges the
-- damage they already caused. Merging a CACHE is safe by construction — the
-- worst possible outcome of a wrong merge is a relearn.
--
-- Also: two small telemetry objects, because the cache's failure mode was
-- indistinguishable from its warm-up. read_tally counts which tier answered
-- each read per day; extract_miss_labels records the label VOCABULARY of a
-- transaction the deterministic tier could not read — labels are bank
-- boilerplate, the values never leave the mail. Both are service-role only.

begin;

-- ── merge the fragmented cache ─────────────────────────────────────────────
with ranked as (
  select id,
         row_number() over (
           partition by
             lower(sender_address),
             trim(regexp_replace(subject_template, '^\s*((fwd|fw|re|chuyen tiep|chuyển tiếp)\s*:\s*)+', '', 'i'))
           order by (extraction_regex is not null) desc,
                    coalesce(human_verified, false) desc,
                    last_verified_at desc nulls last,
                    created_at desc
         ) as rn
  from public.sender_fingerprints
)
delete from public.sender_fingerprints f
 using ranked r
 where f.id = r.id and r.rn > 1;

update public.sender_fingerprints
   set sender_address  = lower(sender_address),
       subject_template = trim(regexp_replace(subject_template, '^\s*((fwd|fw|re|chuyen tiep|chuyển tiếp)\s*:\s*)+', '', 'i'))
 where sender_address <> lower(sender_address)
    or subject_template ~* '^\s*(fwd|fw|re|chuyen tiep|chuyển tiếp)\s*:';

-- ── which tier answered, per day ───────────────────────────────────────────
create table public.read_tally (
  day   date   not null,
  stage text   not null,
  n     bigint not null default 0,
  primary key (day, stage)
);
alter table public.read_tally enable row level security;
revoke all on table public.read_tally from anon, authenticated;

create or replace function public.bump_read_tally(p_stage text)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.read_tally as t (day, stage, n)
  values (current_date, p_stage, 1)
  on conflict (day, stage) do update set n = t.n + 1;
$$;
revoke all on function public.bump_read_tally(text) from public, anon, authenticated;
grant execute on function public.bump_read_tally(text) to service_role;

-- ── the dictionary's misses, labels only ───────────────────────────────────
create table public.extract_miss_labels (
  id             bigint generated always as identity primary key,
  sender_address text        not null,
  labels         text[]      not null,
  seen_at        timestamptz not null default now()
);
alter table public.extract_miss_labels enable row level security;
revoke all on table public.extract_miss_labels from anon, authenticated;

commit;
