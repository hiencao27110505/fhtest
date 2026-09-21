-- 0145_mailbox_reader_lease — ONE READER PER MAILBOX.  ALREADY LIVE; recorded after the fact.
--
-- Applied to production by hand on 2026-09-15 (no row in the live ledger) and
-- written down on 2026-09-21 from the live catalog (pg_get_functiondef, byte for
-- byte), together with the worker code that calls it. Idempotent: running this
-- against production changes nothing.
--
-- WHY. Three triggers can start a read of the same mailbox and none of them could
-- see the others: the connect kick, the minute lane and the five-minute poll.
-- Gmail's allowance is per USER, so overlapping readers never read more, they
-- spend the same 6,000 units a minute twice and collect 403s: 41 in one six-hour
-- window on 2026-09-15.
--
-- THE LEASE MUST NEVER BE WHY A MAILBOX GOES UNREAD. It expires on its own, so a
-- crashed holder costs one lease period (90 s) rather than a stuck mailbox; only
-- the holder may renew or release, so a slow run that lost its lease cannot clear
-- the new holder's; and the worker reads as before if any of these calls errors.

alter table public.mailbox_grants
  add column if not exists reader_lease_until timestamptz,
  add column if not exists reader_lease_id    uuid;

comment on column public.mailbox_grants.reader_lease_until is
  'While in the future, a reader holds this mailbox and another must not start (0145). Expires on its own, so a crashed run costs one lease period rather than a stuck mailbox.';
comment on column public.mailbox_grants.reader_lease_id is
  'Who holds the lease. Only the holder may renew or release it, so a slow run that lost its lease cannot clear the new holder''s.';

create or replace function public.take_mailbox_lease(p_grant uuid, p_ttl_s integer default 90)
returns uuid
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_id uuid;
begin
  update public.mailbox_grants
     set reader_lease_id    = gen_random_uuid(),
         reader_lease_until = now() + make_interval(secs => greatest(10, least(600, p_ttl_s)))
   where id = p_grant
     and (reader_lease_until is null or reader_lease_until < now())
  returning reader_lease_id into v_id;
  return v_id;   -- null: someone else is reading this mailbox right now
end;
$function$;

create or replace function public.renew_mailbox_lease(p_grant uuid, p_lease uuid, p_ttl_s integer default 90)
returns boolean
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_ok boolean;
begin
  update public.mailbox_grants
     set reader_lease_until = now() + make_interval(secs => greatest(10, least(600, p_ttl_s)))
   where id = p_grant and reader_lease_id = p_lease
  returning true into v_ok;
  return coalesce(v_ok, false);
end;
$function$;

create or replace function public.release_mailbox_lease(p_grant uuid, p_lease uuid)
returns void
language plpgsql
security definer
set search_path to ''
as $function$
begin
  update public.mailbox_grants
     set reader_lease_until = null, reader_lease_id = null
   where id = p_grant and reader_lease_id = p_lease;
end;
$function$;

-- SECURITY DEFINER functions that write a grant: the worker only. Live ACL is
-- service_role + postgres; a fresh database would otherwise hand them to PUBLIC.
revoke all on function public.take_mailbox_lease(uuid, integer)          from public, anon, authenticated;
revoke all on function public.renew_mailbox_lease(uuid, uuid, integer)   from public, anon, authenticated;
revoke all on function public.release_mailbox_lease(uuid, uuid)          from public, anon, authenticated;
grant execute on function public.take_mailbox_lease(uuid, integer)        to service_role;
grant execute on function public.renew_mailbox_lease(uuid, uuid, integer) to service_role;
grant execute on function public.release_mailbox_lease(uuid, uuid)        to service_role;
