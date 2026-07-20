-- FamilyHub — 0010: income ledger, savings-set, family/member soft-delete + member mgmt

-- ── income (separate from saved-for-events) ────────────────────────────────
create table incomes (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references families(id),
  member_id uuid,
  amount numeric(14,2) not null check (amount > 0),
  note text,
  income_date date not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (member_id, family_id) references members(id, family_id) on delete set null
);
create index incomes_family_month_idx on incomes(family_id, income_date);
alter table incomes enable row level security;
create policy incomes_select on incomes for select using (family_id = auth_family_id());
create policy incomes_insert on incomes for insert with check (family_id = auth_family_id());
create policy incomes_update on incomes for update using (family_id = auth_family_id()) with check (family_id = auth_family_id());
create policy incomes_delete on incomes for delete using (family_id = auth_family_id());
grant select, insert, update, delete on incomes to authenticated;
create trigger trg_incomes_updated before update on incomes for each row execute function set_updated_at();
do $$ begin
  begin execute 'alter publication supabase_realtime add table public.incomes'; exception when duplicate_object then null; end;
  execute 'alter table public.incomes replica identity full';
end $$;

create or replace view v_income with (security_invoker = on) as
select family_id, date_trunc('month', income_date)::date as month, sum(amount) as income
from incomes group by family_id, date_trunc('month', income_date)::date;
grant select on v_income to authenticated;

-- ── families: soft-delete ──────────────────────────────────────────────────
alter table families add column archived_at timestamptz;

-- my_families excludes archived
create or replace function my_families() returns json
language sql stable security definer set search_path = public as $$
  select coalesce(json_agg(json_build_object(
    'family_id', f.id, 'name', f.name,
    'is_owner', (f.owner_id = auth.uid()),
    'is_active', (f.id = (select family_id from profiles where id = auth.uid()))
  ) order by f.created_at), '[]'::json)
  from families f
  where f.archived_at is null
    and exists (select 1 from members m where m.family_id = f.id and m.user_id = auth.uid() and m.archived_at is null);
$$;

-- helper: is caller the owner of a family
create or replace function _is_owner(p_family uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from families where id = p_family and owner_id = auth.uid());
$$;

-- archive the whole family (owner only); boot all members to the picker
create or replace function archive_family(p_family_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if not _is_owner(p_family_id) then raise exception 'only the owner can archive the family'; end if;
  update families set archived_at = now() where id = p_family_id;
  update profiles set family_id = null where family_id = p_family_id;
end $$;

-- archive a member (owner only); if it was a linked login, detach them
create or replace function archive_member(p_member_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_family uuid; v_user uuid;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  select family_id, user_id into v_family, v_user from members where id = p_member_id;
  if v_family is null then raise exception 'member not found'; end if;
  if not _is_owner(v_family) then raise exception 'only the owner can remove members'; end if;
  update members set archived_at = now() where id = p_member_id;
  if v_user is not null then update profiles set family_id = null where id = v_user and family_id = v_family; end if;
end $$;

-- add an (unlinked) member seat (owner only)
create or replace function add_member(p_name text, p_color text default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_family uuid; v_id uuid;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  select family_id into v_family from profiles where id = auth.uid();
  if not _is_owner(v_family) then raise exception 'only the owner can add members'; end if;
  insert into members (family_id, name, color) values (v_family, p_name, p_color) returning id into v_id;
  return v_id;
end $$;

-- update a member: owner may edit anyone; a member may edit only themselves
create or replace function update_member(p_member_id uuid, p_name text, p_color text default null) returns void
language plpgsql security definer set search_path = public as $$
declare v_family uuid; v_user uuid;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  select family_id, user_id into v_family, v_user from members where id = p_member_id;
  if v_family is null then raise exception 'member not found'; end if;
  if not (_is_owner(v_family) or v_user = auth.uid()) then raise exception 'you can only edit your own profile'; end if;
  update members set name = coalesce(p_name, name), color = coalesce(p_color, color) where id = p_member_id;
end $$;

-- leave the current family (any member); switch active family to another or null
create or replace function leave_family() returns uuid
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_family uuid; v_next uuid;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  select family_id into v_family from profiles where id = v_uid;
  if v_family is null then raise exception 'no active family'; end if;
  update members set archived_at = now() where family_id = v_family and user_id = v_uid;
  select f.id into v_next from families f
   join members m on m.family_id = f.id and m.user_id = v_uid and m.archived_at is null
   where f.archived_at is null and f.id <> v_family order by f.created_at limit 1;
  update profiles set family_id = v_next where id = v_uid;
  return v_next;
end $$;

-- switch_family also rejects archived families
create or replace function switch_family(p_family_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  if not exists (select 1 from members where family_id = p_family_id and user_id = v_uid and archived_at is null)
     or exists (select 1 from families where id = p_family_id and archived_at is not null) then
    raise exception 'you are not a member of that family';
  end if;
  update profiles set family_id = p_family_id where id = v_uid;
end $$;

-- set the saved-for-events pool to an exact amount (inserts the adjusting entry)
create or replace function set_savings(p_amount numeric) returns void
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_family uuid; v_bal numeric; v_delta numeric; v_mid uuid;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  if p_amount < 0 then raise exception 'amount must be >= 0'; end if;
  select family_id into v_family from profiles where id = v_uid;
  if v_family is null then raise exception 'no family'; end if;
  select coalesce(sum(case when kind='deposit' then amount else -amount end),0) into v_bal
    from savings_entries where family_id = v_family;
  v_bal := v_bal - coalesce((select sum(amount) from event_fundings where family_id = v_family and source='savings'),0);
  v_delta := p_amount - v_bal;
  if v_delta = 0 then return; end if;
  select id into v_mid from members where family_id = v_family and user_id = v_uid and not is_shared limit 1;
  insert into savings_entries (family_id, member_id, kind, amount, note, entry_date)
  values (v_family, v_mid, case when v_delta > 0 then 'deposit' else 'withdrawal' end, abs(v_delta), 'Adjust savings', current_date);
end $$;

-- tighten member UPDATE at the RLS layer too (owner or self)
drop policy if exists members_update on members;
create policy members_update on members for update
  using (family_id = auth_family_id() and (user_id = auth.uid() or (select owner_id from families where id = members.family_id) = auth.uid()))
  with check (family_id = auth_family_id() and (user_id = auth.uid() or (select owner_id from families where id = members.family_id) = auth.uid()));

-- grants: entrypoints authenticated-only; helpers to nobody
revoke execute on function public._is_owner(uuid) from public, anon, authenticated;
revoke execute on function public.archive_family(uuid)  from public, anon;
revoke execute on function public.archive_member(uuid)   from public, anon;
revoke execute on function public.add_member(text, text) from public, anon;
revoke execute on function public.update_member(uuid, text, text) from public, anon;
revoke execute on function public.leave_family()         from public, anon;
revoke execute on function public.set_savings(numeric)   from public, anon;
grant  execute on function public.archive_family(uuid)   to authenticated;
grant  execute on function public.archive_member(uuid)   to authenticated;
grant  execute on function public.add_member(text, text) to authenticated;
grant  execute on function public.update_member(uuid, text, text) to authenticated;
grant  execute on function public.leave_family()         to authenticated;
grant  execute on function public.set_savings(numeric)   to authenticated;

