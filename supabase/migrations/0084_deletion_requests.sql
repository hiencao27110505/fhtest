-- ============================================================================
-- FamilyHub — 0084: erasure as a SCHEDULED, CANCELLABLE request
--
-- Why this exists, from a real incident: 0082 shipped erasure as a two-tap
-- arm-then-confirm that deleted immediately. On 2026-08-24 a founder testing
-- the flow lost her mailbox connection and every pending staged row to a
-- mis-tap, and there was nothing to undo. The friction was also mismatched --
-- a two-tap arm is a mid-tier pattern and erasure is the highest-blast-radius
-- action in the app.
--
-- The fix is the pattern the research converges on: prefer undo over
-- confirmation. The 72 hours our consent text already promises becomes a
-- VISIBLE, CANCELLABLE window instead of an invisible operational SLA.
-- Requesting sets a date; the user can cancel any time before it; only then
-- is anything erased.
--
-- Deliberately NOT deleted at request time: the ledger, photos, and pending
-- staged rows. Those go at execution. What DOES stop immediately is
-- collection -- the mailbox connection is removed, because consent has been
-- withdrawn and new mail must not keep arriving. Reconnecting is one flow if
-- the request is cancelled, and the confirm sheet says so.
--
-- Next free migration number after this one: 0085. Verify against
-- `git ls-tree origin/main supabase/migrations/` -- this range has collided
-- seven times.
-- ============================================================================

create table public.deletion_requests (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null default auth.uid() references auth.users (id) on delete cascade,
  requested_at  timestamptz not null default now(),
  scheduled_for timestamptz not null,
  cancelled_at  timestamptz,
  executed_at   timestamptz
);

comment on table public.deletion_requests is
  'Scheduled erasure. A row with cancelled_at and executed_at both null is a live request: the user asked to be deleted and can still cancel until scheduled_for. Rows are kept after execution as the record that the request was honoured.';

-- One live request per user. Partial, so a cancelled or executed request never
-- blocks a new one.
create unique index deletion_requests_one_live
  on public.deletion_requests (user_id)
  where cancelled_at is null and executed_at is null;

alter table public.deletion_requests enable row level security;

-- Read-only to the client; both mutations go through the RPCs below so the
-- 72-hour window and the collection stop cannot be set from a browser.
create policy deletion_requests_select_own on public.deletion_requests
  for select to authenticated
  using (user_id = (select auth.uid()));

-- ----------------------------------------------------------------------------
-- Request erasure. Idempotent: asking twice returns the same live request
-- rather than moving the date, so a double-tap cannot extend or shorten the
-- window. Stops collection immediately by removing the mailbox connection.
create or replace function public.request_my_deletion()
returns json
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_member uuid;
  v_row deletion_requests;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;

  select * into v_row from deletion_requests
   where user_id = v_uid and cancelled_at is null and executed_at is null
   limit 1;

  if v_row.id is null then
    insert into deletion_requests (user_id, scheduled_for)
    values (v_uid, now() + interval '72 hours')
    returning * into v_row;

    -- Consent is withdrawn, so new mail must stop arriving now. The pending
    -- rows and the ledger are NOT touched here: they are what the scheduled
    -- window exists to protect.
    select id into v_member from members
     where user_id = v_uid and is_shared = false limit 1;
    if v_member is not null then
      delete from mailbox_connections where member_id = v_member;
    end if;
  end if;

  return json_build_object(
    'requested_at',  v_row.requested_at,
    'scheduled_for', v_row.scheduled_for);
end $$;

revoke all on function public.request_my_deletion() from public;
grant execute on function public.request_my_deletion() to authenticated;

-- ----------------------------------------------------------------------------
-- Cancel. The undo the whole design turns on: nothing has been erased yet, so
-- this simply retires the request. Bank email needs reconnecting afterwards,
-- which the UI states before the user commits.
create or replace function public.cancel_my_deletion()
returns json
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_n int;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  update deletion_requests set cancelled_at = now()
   where user_id = v_uid and cancelled_at is null and executed_at is null;
  get diagnostics v_n = row_count;
  return json_build_object('cancelled', v_n);
end $$;

revoke all on function public.cancel_my_deletion() from public;
grant execute on function public.cancel_my_deletion() to authenticated;
