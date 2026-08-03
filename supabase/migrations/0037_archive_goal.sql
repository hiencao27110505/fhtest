-- FamilyHub — 0037: delete (archive) a saving goal, reversing all of its funding
--
-- Mirrors 0013_archive_event.sql for the saving_goals object introduced in 0020.
-- Deleting a goal is a FULL reversal: every event_fundings row for the goal is
-- removed, so savings-source money returns to the savings pool (the pool subtracts
-- savings-source fundings) and any budget-source money comes back off that month's
-- spending. This deliberately rewrites past-month totals — chosen over stranding the
-- money in a goal the user can no longer see.
--
-- The goal row itself is SOFT-deleted (archived_at), matching the soft-delete-only
-- convention used for events, members, and categories. The hydrate already filters
-- archived goals (partial index saving_goals_family_idx WHERE archived_at IS NULL),
-- so an archived goal disappears from the app but stays recoverable in the database.
--
-- Any member of the family may delete a goal, consistent with events and expenses
-- (there is no per-member permission model in the app).
create or replace function public.archive_goal(p_goal_id uuid)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v_uid uuid := auth.uid(); v_family uuid; v_goal_family uuid;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  select family_id into v_family from profiles where id = v_uid;
  if v_family is null then raise exception 'no family'; end if;
  select family_id into v_goal_family from saving_goals where id = p_goal_id;
  if v_goal_family is null then raise exception 'goal not found'; end if;
  if v_goal_family <> v_family then raise exception 'that goal is not in your family'; end if;

  delete from event_fundings where goal_id = p_goal_id and family_id = v_family;
  update saving_goals set archived_at = now() where id = p_goal_id and family_id = v_family;
end $function$;

revoke execute on function public.archive_goal(uuid) from public, anon;
grant  execute on function public.archive_goal(uuid) to authenticated;
