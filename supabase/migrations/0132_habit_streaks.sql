-- Habit streaks ("Chuỗi thói quen") — docs/specs/habit-streak-spec.md.
-- User-defined no-spend streaks by merchant or category. Definitions only:
-- counts are ALWAYS derived on-device from the ledger + the review queue, so
-- there is no count column to drift. The only cached value is the personal
-- best (record_enc), which merges by max on the client.
--
-- Ciphertext-only value columns, Model-Y style: rule_enc is the whole rule
-- ({type:'merchant'|'category', key, label, emoji, milestone}) under the
-- personal DEK (personal) / family DEK (family). started_on stays plaintext —
-- it is a windowing key, the same exposure class as txn_date, and the server
-- needs nothing else to ring the 6AM doorbell.

create table if not exists public.personal_streaks (
  id            uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  rule_enc      text not null,
  started_on    date not null default (now() at time zone 'Asia/Ho_Chi_Minh')::date,
  record_enc    text,
  archived_at   timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

alter table public.personal_streaks enable row level security;

create policy personal_streaks_owner
  on public.personal_streaks
  for all
  using (auth.uid() = owner_user_id)
  with check (auth.uid() = owner_user_id);

create index if not exists personal_streaks_owner_idx
  on public.personal_streaks (owner_user_id) where archived_at is null;

-- Family streaks: same shape, family-scoped. rule_enc under the family DEK
-- (fhField 'enc' convention — the client writes ciphertext; legacy off/dual
-- families store plaintext in rule, mirroring every other family value column).
create table if not exists public.family_streaks (
  id          uuid primary key default gen_random_uuid(),
  family_id   uuid not null references public.families(id) on delete cascade,
  created_by  uuid references public.members(id) on delete set null,
  rule        text,
  rule_enc    text,
  started_on  date not null default (now() at time zone 'Asia/Ho_Chi_Minh')::date,
  record      text,
  record_enc  text,
  archived_at timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

alter table public.family_streaks enable row level security;

create policy family_streaks_select on public.family_streaks
  for select using (family_id = public.auth_family_id());
create policy family_streaks_insert on public.family_streaks
  for insert with check (family_id = public.auth_family_id());
create policy family_streaks_update on public.family_streaks
  for update using (family_id = public.auth_family_id())
  with check (family_id = public.auth_family_id());
create policy family_streaks_delete on public.family_streaks
  for delete using (family_id = public.auth_family_id());

create index if not exists family_streaks_family_idx
  on public.family_streaks (family_id) where archived_at is null;
