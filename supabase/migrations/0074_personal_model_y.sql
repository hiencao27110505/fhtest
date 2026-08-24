-- 0074 — Personal ledger, Model Y: the PERSON is the root, not a fake family.
--
-- Replaces Model X (0071/0072, where "personal" was a families row of
-- type='personal'). Personal data now lives in its own owner-scoped tables with
-- a per-USER key. The family `transactions`/`categories`/`incomes` tables are
-- left completely untouched (no nullable family_id, no enc-guard/RLS rework) —
-- the safest way to ship this on live prod.
--
-- E2EE by construction: the personal tables have NO plaintext columns, only
-- *_enc. Nothing to enforce with a guard — plaintext literally can't be stored.
-- The personal key is always enc-from-birth (single user, own Key Card).

-- ── 1. per-user key (mirror of family_key_wraps, keyed by user) ───────────────
create table if not exists public.personal_keys (
  user_id      uuid primary key references auth.users(id) on delete cascade,
  kdf_salt     text not null,
  kdf_iters    int  not null,
  kdf_version  int  not null default 1,
  wrapped_dek  text not null,
  created_at   timestamptz not null default now()
);
alter table public.personal_keys enable row level security;
drop policy if exists personal_keys_select on public.personal_keys;
create policy personal_keys_select on public.personal_keys
  for select to authenticated using (user_id = (select auth.uid()));
-- writes go through init_personal_key / rotate only

create or replace function public.init_personal_key(
  p_kdf_salt text, p_kdf_iters int, p_kdf_version int, p_wrapped_dek text
) returns void language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  insert into personal_keys (user_id, kdf_salt, kdf_iters, kdf_version, wrapped_dek)
  values (v_uid, p_kdf_salt, p_kdf_iters, p_kdf_version, p_wrapped_dek)
  on conflict (user_id) do nothing;   -- idempotent; rotation is a separate action
end $$;
revoke execute on function public.init_personal_key(text,int,int,text) from public, anon;
grant execute on function public.init_personal_key(text,int,int,text) to authenticated;

-- ── 2. personal transactions (ciphertext-only, owner-scoped) ─────────────────
create table if not exists public.personal_transactions (
  id             uuid primary key default gen_random_uuid(),
  owner_user_id  uuid not null references auth.users(id) on delete cascade,
  amount_enc     text not null,
  note_enc       text,
  cat_name_enc   text,           -- category denormalised (name + emoji), no personal-category table for MVP
  cat_emoji      text,
  txn_date       date not null,
  kind           text not null default 'expense' check (kind in ('expense','transfer')),
  space_id       uuid references public.families(id) on delete set null,  -- the space this master is mirrored to (NULL = private)
  link_id        uuid,           -- ties to transactions.link_id (the family copy)
  version        int not null default 1,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
alter table public.personal_transactions enable row level security;
create index if not exists ptx_owner_idx on public.personal_transactions (owner_user_id, txn_date desc);
create index if not exists ptx_link_idx  on public.personal_transactions (link_id) where link_id is not null;
create index if not exists ptx_space_idx on public.personal_transactions (space_id) where space_id is not null;
drop policy if exists ptx_all on public.personal_transactions;
create policy ptx_all on public.personal_transactions
  for all to authenticated
  using (owner_user_id = (select auth.uid()))
  with check (owner_user_id = (select auth.uid()));

-- ── 3. personal incomes (ciphertext-only, owner-scoped) ──────────────────────
create table if not exists public.personal_incomes (
  id             uuid primary key default gen_random_uuid(),
  owner_user_id  uuid not null references auth.users(id) on delete cascade,
  amount_enc     text not null,
  note_enc       text,
  income_date    date not null,
  created_at     timestamptz not null default now()
);
alter table public.personal_incomes enable row level security;
create index if not exists pinc_owner_idx on public.personal_incomes (owner_user_id, income_date desc);
drop policy if exists pinc_all on public.personal_incomes;
create policy pinc_all on public.personal_incomes
  for all to authenticated
  using (owner_user_id = (select auth.uid()))
  with check (owner_user_id = (select auth.uid()));

-- ── 4. revert Model X (0072) RLS back to family-only ─────────────────────────
alter policy transactions_select on public.transactions using (family_id = (select auth_family_id()));
alter policy transactions_insert on public.transactions with check (family_id = (select auth_family_id()));
alter policy transactions_update on public.transactions using (family_id = (select auth_family_id())) with check (family_id = (select auth_family_id()));
alter policy transactions_delete on public.transactions using (family_id = (select auth_family_id()));
alter policy incomes_select on public.incomes using (family_id = (select auth_family_id()));
alter policy incomes_insert on public.incomes with check (family_id = (select auth_family_id()));
alter policy incomes_update on public.incomes using (family_id = (select auth_family_id())) with check (family_id = (select auth_family_id()));
alter policy incomes_delete on public.incomes using (family_id = (select auth_family_id()));
alter policy categories_select on public.categories using (family_id = (select auth_family_id()));
alter policy categories_insert on public.categories with check (family_id = (select auth_family_id()));
alter policy categories_update on public.categories using (family_id = (select auth_family_id()));
alter policy members_select on public.members using (family_id = (select auth_family_id()));
alter policy family_keys_select on public.family_keys using (family_id = (select auth_family_id()));
alter policy fkw_select on public.family_key_wraps using (family_id = (select auth_family_id()));

-- ── 5. retire Model X server surface ─────────────────────────────────────────
-- Stale (v375) clients may still call create_personal_ledger; make it an inert
-- no-op so they fail soft instead of minting a new personal family. Dropped for
-- real once every client is on the Model-Y build.
create or replace function public.create_personal_ledger(
  p_kdf_salt text, p_kdf_iters int, p_kdf_version int, p_wrapped_dek text,
  p_member_name text default null, p_language language_code default 'vi'
) returns uuid language sql security definer set search_path = public as $$
  select null::uuid;
$$;
drop function if exists public.auth_personal_id();

-- ── 6. clean up Model X data — RUN SEPARATELY (0075), destructive ────────────
-- The type='personal' families from Model X are now INERT: the Model-Y client
-- ignores them, 0073 already excludes type<>'family' from all metrics, and the
-- client filters them from every picker. They can be purged safely at any time
-- via 0075_drop_model_x_personal.sql (kept separate so the destructive delete is
-- reviewed on its own). families.type stays ('family'|'friend'|'trip').
