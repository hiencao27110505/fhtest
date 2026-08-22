-- 0070_family_save_goal.sql
-- Shared, per-family saving goal for the daily guide: "spend X% less than before".
-- It is a small SETTING (a percentage, never a money amount, so it is E2EE-neutral),
-- stored on the families row, written via a security-definer setter that any member
-- may call, read by members through the existing families RLS select, and pushed to
-- other members live through the families realtime channel added in 0026.
--
-- Shape: families.save_goal_pct ∈ 0..90  (0 = "tiêu hoang như trước" / no goal)
-- Additive and safe against older clients: absent → the client treats it as 0.

-- 1. storage ---------------------------------------------------------------
alter table families
  add column if not exists save_goal_pct smallint not null default 0
    check (save_goal_pct >= 0 and save_goal_pct <= 90);

-- 2. setter: any authenticated member may set their own family's saving goal
create or replace function public.set_family_save_goal(p_pct smallint)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_fid uuid := auth_family_id();
begin
  if v_fid is null then
    raise exception 'not in a family';
  end if;
  update families
     set save_goal_pct = greatest(0, least(90, coalesce(p_pct, 0))),
         updated_at = now()
   where id = v_fid;
end $$;

revoke execute on function public.set_family_save_goal(smallint) from public, anon;
grant  execute on function public.set_family_save_goal(smallint) to authenticated;

-- families is already in the supabase_realtime publication (0026), and members can
-- already SELECT their own family row (0004 families_select) — so no snapshot change
-- is needed: the client reads save_goal_pct with a small select and re-reads on the
-- families realtime event.
