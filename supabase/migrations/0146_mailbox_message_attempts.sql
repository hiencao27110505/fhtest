-- 0146_mailbox_message_attempts.sql
--
-- RECORD-ONLY. Everything below is ALREADY LIVE; it was created outside the repo
-- (the functions' own live comments call it "0146", in another session's
-- numbering), and nothing in the repo had a copy. Taken from the catalog with
-- pg_get_functiondef / information_schema on 2026-09-22. Idempotent: applying it
-- to production changes nothing.
--
-- Why it is recorded now: email reading v2 (docs/specs/email-reading-v2-spec.md
-- §10) parks a single mail that needs the model instead of holding the whole
-- mailbox, and this table IS the parking lot. It already existed and had never
-- received a write: 0 rows and 0 inserts, against 732,343 `held` tallies over
-- the same weeks. The mechanism was built and never wired. 0147 adds the two
-- things it lacks; the worker wiring lands with it.
--
-- One known gap, left as found: `grant_id` has no foreign key, so
-- disconnect_my_mailbox() leaves orphans behind. 0147 sweeps them.

begin;

create table if not exists public.mailbox_message_attempts (
  grant_id          uuid        not null,
  gmail_message_id  text        not null,
  attempts          integer     not null default 1,
  first_held_at     timestamptz not null default now(),
  last_held_at      timestamptz not null default now(),
  last_reason       text,
  gave_up_at        timestamptz,
  primary key (grant_id, gmail_message_id)
);

create index if not exists mailbox_message_attempts_gaveup_idx
  on public.mailbox_message_attempts (grant_id) where gave_up_at is not null;

alter table public.mailbox_message_attempts enable row level security;
revoke all on public.mailbox_message_attempts from anon, authenticated;
grant all on public.mailbox_message_attempts to service_role;

-- One more failed attempt at one message. Returns true once the cap is reached:
-- the caller stops retrying it and the run is allowed to finish.
create or replace function public.record_message_hold(
  p_grant uuid, p_msg text, p_reason text default null, p_cap integer default 5)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_attempts int;
  v_cap int := greatest(1, least(20, coalesce(p_cap, 5)));
begin
  insert into public.mailbox_message_attempts (grant_id, gmail_message_id, attempts, last_reason)
       values (p_grant, p_msg, 1, left(coalesce(p_reason, ''), 200))
  on conflict (grant_id, gmail_message_id) do update
     set attempts = public.mailbox_message_attempts.attempts + 1,
         last_held_at = now(),
         last_reason = left(coalesce(p_reason, public.mailbox_message_attempts.last_reason, ''), 200)
  returning attempts into v_attempts;
  if v_attempts >= v_cap then
    update public.mailbox_message_attempts
       set gave_up_at = coalesce(gave_up_at, now())
     where grant_id = p_grant and gmail_message_id = p_msg;
    return true;
  end if;
  return false;
end;
$$;

-- The message was read after all: forget the attempts. A message already given
-- up on is kept, so the count the person sees does not move backwards.
create or replace function public.clear_message_hold(p_grant uuid, p_msg text)
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.mailbox_message_attempts
   where grant_id = p_grant and gmail_message_id = p_msg and gave_up_at is null;
$$;

create or replace function public.abandoned_messages(p_grant uuid)
returns setof text
language sql
stable
security definer
set search_path = ''
as $$
  select gmail_message_id from public.mailbox_message_attempts
   where grant_id = p_grant and gave_up_at is not null;
$$;

revoke all on function public.record_message_hold(uuid, text, text, integer) from public, anon, authenticated;
revoke all on function public.clear_message_hold(uuid, text) from public, anon, authenticated;
revoke all on function public.abandoned_messages(uuid) from public, anon, authenticated;
grant execute on function public.record_message_hold(uuid, text, text, integer) to service_role;
grant execute on function public.clear_message_hold(uuid, text) to service_role;
grant execute on function public.abandoned_messages(uuid) to service_role;

commit;
