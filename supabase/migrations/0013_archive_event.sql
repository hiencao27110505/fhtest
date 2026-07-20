-- FamilyHub — 0013: delete (archive) an event, reversing all of its funding
--
-- APPLIED (confirmed 2026-07-20 against fhtest; header was stale).
--
-- Product decision: deleting a goal is a FULL reversal. Every event_fundings row
-- for the event is removed, so savings-source money returns to the savings pool
-- (the pool subtracts savings-source fundings) and budget-source money comes back
-- off that month's spending (budget-source funding is folded into month spend).
-- This deliberately rewrites past-month totals — chosen over stranding the money
-- in an event the user can no longer see.
--
-- The event row itself is SOFT-deleted (archived_at), matching the soft-delete-only
-- convention already used for members and categories. Because nothing is hard
-- deleted, the event_fundings.event_id RESTRICT FK is never hit and needs no change.
-- event_memories rows and their storage files are left intact, so an archived event
-- remains recoverable from the database.
--
-- Any member of the family may delete an event, consistent with expenses (there is
-- no per-member permission model in the app).
create or replace function public.archive_event(p_event_id uuid)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v_uid uuid := auth.uid(); v_family uuid; v_ev_family uuid;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  select family_id into v_family from profiles where id = v_uid;
  if v_family is null then raise exception 'no family'; end if;
  select family_id into v_ev_family from events where id = p_event_id;
  if v_ev_family is null then raise exception 'event not found'; end if;
  if v_ev_family <> v_family then raise exception 'that event is not in your family'; end if;

  delete from event_fundings where event_id = p_event_id and family_id = v_family;
  update events set archived_at = now() where id = p_event_id and family_id = v_family;
end $function$;

revoke execute on function public.archive_event(uuid) from public, anon;
grant  execute on function public.archive_event(uuid) to authenticated;
