-- ---------------------------------------------------------------------------
-- 0142 — a deleted statement_files row must not strand its sealed file.
--
-- THE GAP. An account deletion cascades `statement_files` away (`on delete cascade`
-- from auth.users), but the sealed object in the `statement-files` bucket is bytes in
-- Storage, and SQL cannot delete those (a row removed from storage.objects orphans
-- the bytes). With the row gone nothing pointed at the file any more, so the sweep
-- could never find it: a deleted person's sealed statement would have sat in the
-- bucket forever. Sealed, unreadable without a key that no longer exists -- but
-- "we deleted your data" has to be true of the bytes too.
--
-- THE FIX, entirely in the database, so the deployed worker needs no change:
--   * a BEFORE DELETE trigger on statement_files writes the path into
--     statement_orphan_objects. Cascaded deletes fire row triggers, so this catches
--     an account deletion as well as any direct delete.
--   * statement_sweep_list returns those paths alongside the ones it already
--     returned; the worker deletes them through the Storage API as before.
--   * statement_sweep_done removes the orphan rows it is told were deleted.
-- Rehearsed inside a rolled-back transaction against the live database before it
-- was applied: one delete, one orphan row recorded, nothing left behind.
--
-- APPLIED live 2026-09-19 and verified (trigger present, sweep callable, no
-- anon/authenticated privilege on the table or the functions).
--
-- Next free migration number after this one: 0143. Verify against
-- `git ls-tree origin/main supabase/migrations/` and AGENT_SYNC.md before claiming it.
-- ---------------------------------------------------------------------------
create table if not exists public.statement_orphan_objects (
  id          uuid primary key default gen_random_uuid(),
  object_path text not null,
  queued_at   timestamptz not null default now()
);
comment on table public.statement_orphan_objects is
  'Sealed statement files whose statement_files row was deleted (account deletion cascades the row; SQL cannot delete Storage bytes). The worker sweep removes each object through the Storage API, then the row here. Paths only. service_role only.';

alter table public.statement_orphan_objects enable row level security;
revoke all on public.statement_orphan_objects from anon, authenticated;
grant select, insert, delete on public.statement_orphan_objects to service_role;

create or replace function public._statement_file_orphan()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if old.object_path is not null then
    insert into statement_orphan_objects (object_path) values (old.object_path);
  end if;
  return old;
end $$;
revoke all on function public._statement_file_orphan() from public, anon, authenticated;

drop trigger if exists statement_files_orphan on public.statement_files;
create trigger statement_files_orphan
  before delete on public.statement_files
  for each row execute function public._statement_file_orphan();

create or replace function public.statement_sweep_list(p_limit int default 20)
returns table (id uuid, object_path text)
language plpgsql security definer set search_path = public as $$
declare v_limit int := greatest(1, least(coalesce(p_limit, 20), 100));
begin
  update statement_files f set status = 'expired'
   where f.status = 'pending' and f.expires_at < now();

  update statement_files f set status = 'dismissed'
   where f.status in ('pending', 'expired')
     and not exists (select 1 from mailbox_grants g where g.user_id = f.owner_user_id);
  delete from statement_rows r
   where not exists (select 1 from mailbox_grants g where g.user_id = r.owner_user_id);

  return query
    (select o.id, o.object_path from statement_orphan_objects o order by o.queued_at limit v_limit)
    union all
    (select f.id, f.object_path from statement_files f
      where f.object_path is not null and f.status <> 'pending'
      order by f.created_at limit v_limit)
    limit v_limit;
end $$;

create or replace function public.statement_sweep_done(p_ids uuid[])
returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_ids is null or array_length(p_ids, 1) is null then return; end if;
  update statement_files set object_path = null where id = any(p_ids) and status <> 'pending';
  delete from statement_orphan_objects where id = any(p_ids);
end $$;

revoke all on function public.statement_sweep_list(int)   from public, anon, authenticated;
revoke all on function public.statement_sweep_done(uuid[]) from public, anon, authenticated;
grant execute on function public.statement_sweep_list(int)   to service_role;
grant execute on function public.statement_sweep_done(uuid[]) to service_role;
