-- 0076 — Personal ledger substrate (double-entry re-architecture, Phase 0)
--
-- Model: every user gets a PERSONAL container (a families row, type='personal',
-- single member, own DEK + own Key Card). A shared transaction is authored as a
-- MASTER row in the personal container and PUBLISHED as a linked copy in the
-- space (family) container — two rows, same link_id, two encryption audiences.
-- Family tab reads are untouched: they filter by family_id and ignore the new
-- columns entirely. See docs/features/personal-ledger.md.
--
-- Additive only. No row moves, no destructive change.

-- ── 1. families.type ─────────────────────────────────────────────────────────
alter table public.families
  add column if not exists type text not null default 'family'
  check (type in ('family','personal','friend','trip'));

-- one personal ledger per user, forever
create unique index if not exists families_one_personal_per_owner
  on public.families (owner_id) where (type = 'personal' and archived_at is null);

-- ── 2. transactions: double-entry linkage + kind (transfer-ready) ────────────
alter table public.transactions add column if not exists link_id uuid;
alter table public.transactions add column if not exists version int not null default 1;
alter table public.transactions add column if not exists kind text not null default 'expense'
  check (kind in ('expense','transfer'));
alter table public.transactions add column if not exists transfer_id uuid;
alter table public.transactions add column if not exists transfer_dir text
  check (transfer_dir in ('out','in'));
-- masters record which space the row flows to (null = private). This is what
-- lets the personal key ALONE rebuild the per-space roll-up (resilience).
alter table public.transactions add column if not exists space_id uuid references public.families(id) on delete set null;

create index if not exists transactions_link_id_idx on public.transactions (link_id) where link_id is not null;
create index if not exists transactions_space_id_idx on public.transactions (space_id) where space_id is not null;

-- guard: link_id is write-once (null → value only); version never decreases.
-- Family-tab updates never touch either column, so OLD values carry through.
create or replace function public._fh_link_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if old.link_id is not null and new.link_id is distinct from old.link_id then
    raise exception 'link_immutable';
  end if;
  if new.version < old.version then
    raise exception 'version_regress';
  end if;
  return new;
end $$;
revoke execute on function public._fh_link_guard() from public, anon, authenticated;

drop trigger if exists trg_fh_link_guard on public.transactions;
create trigger trg_fh_link_guard before update on public.transactions
  for each row execute function public._fh_link_guard();

-- ── 3. create_personal_ledger ────────────────────────────────────────────────
-- Card-born, enc-from-birth (same posture as init_family_card): container +
-- self-member + family_keys(enc) + live card wrap + default categories, one txn.
create or replace function public.create_personal_ledger(
  p_kdf_salt text, p_kdf_iters int, p_kdf_version int, p_wrapped_dek text,
  p_member_name text default null, p_language language_code default 'vi'
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_fid uuid;
  v_name text;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;

  select id into v_fid from families
   where owner_id = v_uid and type = 'personal' and archived_at is null;
  if v_fid is not null then return v_fid; end if;   -- idempotent

  v_name := coalesce(nullif(trim(p_member_name), ''), 'Tôi');

  insert into families (name, owner_id, currency, default_language, type)
  values ('Cá nhân', v_uid, 'VND', p_language, 'personal')
  returning id into v_fid;
  -- NOTE: deliberately does NOT touch profiles.family_id — the personal ledger
  -- is never the "active family" for the family tabs.

  insert into members (family_id, user_id, name, is_shared)
  values (v_fid, v_uid, v_name, false);

  insert into family_keys (family_id, enc_state, kdf_salt, kdf_iters, kdf_version)
  values (v_fid, 'enc', p_kdf_salt, p_kdf_iters, p_kdf_version);

  insert into family_key_wraps (family_id, kind, kdf_salt, kdf_iters, kdf_version, wrapped_dek)
  values (v_fid, 'card', p_kdf_salt, p_kdf_iters, p_kdf_version, p_wrapped_dek);

  perform seed_default_categories(v_fid, p_language);
  return v_fid;
end $$;
revoke execute on function public.create_personal_ledger(text,int,int,text,text,language_code) from public, anon;
grant execute on function public.create_personal_ledger(text,int,int,text,text,language_code) to authenticated;

-- ── 4. my_families: expose type so the client can tell spaces from the ledger ─
create or replace function public.my_families() returns json
language sql stable security definer set search_path to 'public' as $$
  select coalesce(json_agg(json_build_object(
    'family_id', f.id, 'name', f.name,
    'type',      f.type,
    'is_owner',  (f.owner_id = auth.uid()),
    'is_active', (f.id = (select family_id from profiles where id = auth.uid()))
  ) order by f.created_at), '[]'::json)
  from families f
  where f.archived_at is null
    and exists (select 1 from members m where m.family_id = f.id and m.user_id = auth.uid() and m.archived_at is null);
$$;
