-- ============================================================================
-- FamilyHub — 0001 schema (tables, enums, constraints, indexes)
-- Postgres 17 / Supabase.  Money = numeric(14,2) in the family's base currency.
-- Tenant isolation is enforced by RLS (see 0004) + composite FKs (below).
-- ============================================================================

create extension if not exists pgcrypto;   -- gen_random_uuid()

-- ---------------------------------------------------------------------------
-- Enums (closed sets only; currency/language kept as enums for v1 — see backlog)
-- ---------------------------------------------------------------------------
create type currency_code      as enum ('VND','USD');
create type language_code      as enum ('vi','en');
create type theme_name         as enum ('sage','ocean','lavender','blossom','twilight');
create type transaction_status as enum ('realized','planned');
create type savings_kind       as enum ('deposit','withdrawal');
create type funding_source     as enum ('savings','budget');
create type invitation_status  as enum ('pending','accepted','revoked','expired');

-- ---------------------------------------------------------------------------
-- 1. families
-- ---------------------------------------------------------------------------
create table families (
  id               uuid primary key default gen_random_uuid(),
  name             text not null,
  owner_id         uuid not null references auth.users(id),
  currency         currency_code not null default 'VND',
  default_language language_code not null default 'vi',
  timezone         text not null default 'Asia/Ho_Chi_Minh',   -- powers "today"/month math
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
-- NOTE (backlog): treat currency as immutable after first money-bearing write.

-- ---------------------------------------------------------------------------
-- 2. profiles  (1:1 with auth.users; created by handle_new_user trigger)
-- family_id is set ONLY via SECURITY DEFINER functions (create_family / accept_invitation)
-- ---------------------------------------------------------------------------
create table profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  family_id    uuid references families(id),          -- null until create/join
  display_name text,
  email        text,
  avatar_url   text,
  language     language_code not null default 'vi',
  theme        theme_name    not null default 'sage', -- the one preference the prototype persists
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index profiles_family_idx on profiles(family_id);

-- ---------------------------------------------------------------------------
-- 3. members  (a person shown in the app; kids & "Shared" have no login)
-- unique(id, family_id) makes it a composite-FK target for tenant consistency
-- ---------------------------------------------------------------------------
create table members (
  id          uuid primary key default gen_random_uuid(),
  family_id   uuid not null references families(id),
  user_id     uuid references profiles(id),   -- null for kids / "Shared"; linked on invite-accept
  name        text not null,
  color       text,                           -- per-member avatar color (no photo avatars in app)
  avatar_url  text,
  is_shared   boolean not null default false,
  archived_at timestamptz,                     -- soft-delete: hide from pickers, keep history
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (id, family_id)
);
-- exactly one "Shared" pseudo-member per family, and it can never own a login
create unique index members_one_shared_per_family on members(family_id) where is_shared and archived_at is null;
alter table members add constraint members_shared_no_user check (not is_shared or user_id is null);
create index members_family_idx on members(family_id);

-- ---------------------------------------------------------------------------
-- 4. categories
-- ---------------------------------------------------------------------------
create table categories (
  id          uuid primary key default gen_random_uuid(),
  family_id   uuid not null references families(id),
  name        text not null,
  emoji       text,
  color       text,
  sort_order  int  not null default 0,
  archived_at timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (id, family_id)
);
create index categories_family_idx on categories(family_id);

-- ---------------------------------------------------------------------------
-- 5. monthly_budgets  (independent overall cap per family/month)
-- month = first-of-month bucket label; CHECK guarantees the UNIQUE actually holds
-- ---------------------------------------------------------------------------
create table monthly_budgets (
  id           uuid primary key default gen_random_uuid(),
  family_id    uuid not null references families(id),
  month        date not null,
  budget_total numeric(14,2) not null default 0 check (budget_total >= 0),
  closed       boolean not null default false,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (family_id, month),
  check (month = date_trunc('month', month::timestamp)::date)
);

-- ---------------------------------------------------------------------------
-- 6. category_budgets  (per-category, per-month) — FK to monthly_budgets(family,month)
-- ---------------------------------------------------------------------------
create table category_budgets (
  id          uuid primary key default gen_random_uuid(),
  family_id   uuid not null references families(id),
  month       date not null,
  category_id uuid not null,
  amount      numeric(14,2) not null check (amount > 0),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (family_id, month, category_id),
  check (month = date_trunc('month', month::timestamp)::date),
  foreign key (family_id, month)      references monthly_budgets(family_id, month) on delete restrict,
  foreign key (category_id, family_id) references categories(id, family_id)         on delete restrict
);

-- ---------------------------------------------------------------------------
-- 7. transactions  (spending ledger; photos live in transaction_photos)
-- member_id nullable: planned/future expenses have no payer (prototype omits "who")
-- status is STORED intent; the views derive realized/planned from txn_date vs today
-- ---------------------------------------------------------------------------
create table transactions (
  id          uuid primary key default gen_random_uuid(),
  family_id   uuid not null references families(id),
  category_id uuid not null,
  member_id   uuid,
  note        text,
  amount      numeric(14,2) not null check (amount > 0),
  txn_date    date not null,
  status      transaction_status not null default 'realized',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  foreign key (category_id, family_id) references categories(id, family_id) on delete restrict,
  foreign key (member_id,   family_id) references members(id,    family_id) on delete restrict,
  check (status = 'planned' or member_id is not null),  -- realized rows must have a payer
  unique (id, family_id)                                -- composite-FK target for transaction_photos
);
create index transactions_family_date_idx on transactions(family_id, txn_date);
create index transactions_category_idx     on transactions(category_id);
create index transactions_member_idx       on transactions(member_id);

-- ---------------------------------------------------------------------------
-- 8. transaction_photos  (NEW — up to N photos per expense; cascade with the tx)
-- ---------------------------------------------------------------------------
create table transaction_photos (
  id             uuid primary key default gen_random_uuid(),
  family_id      uuid not null references families(id),
  transaction_id uuid not null,
  photo_url      text not null,
  sort_order     int  not null default 0,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  -- composite FK ties the photo's tenant tag to its parent transaction's
  foreign key (transaction_id, family_id) references transactions(id, family_id) on delete cascade
);
create index transaction_photos_tx_idx on transaction_photos(transaction_id);

-- ---------------------------------------------------------------------------
-- 9. events  (savings goals; saved_amount & set_aside are DERIVED — see views)
-- ---------------------------------------------------------------------------
create table events (
  id            uuid primary key default gen_random_uuid(),
  family_id     uuid not null references families(id),
  name          text not null,
  emoji         text,
  cover         text,
  target_amount numeric(14,2) not null check (target_amount > 0),
  target_date   date,
  achieved      boolean not null default false,   -- stored override; views also treat date<today as achieved
  sort_order    int  not null default 0,
  archived_at   timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (id, family_id)
);
create index events_family_idx on events(family_id);

-- ---------------------------------------------------------------------------
-- 10. event_memories  (photo-only; the prototype's scene "cls" was mock, dropped)
-- ---------------------------------------------------------------------------
create table event_memories (
  id         uuid primary key default gen_random_uuid(),
  event_id   uuid not null,
  family_id  uuid not null references families(id),
  emoji      text,
  caption    text,
  photo_url  text,
  sort_order int  not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (event_id, family_id) references events(id, family_id) on delete cascade
);
create index event_memories_event_idx on event_memories(event_id);

-- ---------------------------------------------------------------------------
-- 11. savings_entries  (pool in/out ONLY; event allocations live in event_fundings)
-- ---------------------------------------------------------------------------
create table savings_entries (
  id         uuid primary key default gen_random_uuid(),
  family_id  uuid not null references families(id),
  member_id  uuid,
  kind       savings_kind not null,
  amount     numeric(14,2) not null check (amount > 0),   -- sign lives in `kind`, never the amount
  note       text,
  entry_date date not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (member_id, family_id) references members(id, family_id) on delete restrict
);
create index savings_entries_family_idx on savings_entries(family_id);

-- ---------------------------------------------------------------------------
-- 12. event_fundings  (every contribution toward an event's target)
-- source=budget  -> month is required (which month's budget it was reserved from)
-- source=savings -> month must be null (drawn from the pool)
-- ---------------------------------------------------------------------------
create table event_fundings (
  id         uuid primary key default gen_random_uuid(),
  family_id  uuid not null references families(id),
  event_id   uuid not null,
  member_id  uuid,
  amount     numeric(14,2) not null check (amount > 0),
  source     funding_source not null,
  month      date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (event_id,  family_id) references events(id,  family_id) on delete restrict,
  foreign key (member_id, family_id) references members(id, family_id) on delete restrict,
  check (month is null or month = date_trunc('month', month::timestamp)::date),
  check ((source = 'budget'  and month is not null)
      or (source = 'savings' and month is null))
);
create index event_fundings_event_idx on event_fundings(event_id);
create index event_fundings_family_month_idx on event_fundings(family_id, month);

-- ---------------------------------------------------------------------------
-- 13. invitations  (simple invite-by-Gmail; accepted via accept_invitation())
-- ---------------------------------------------------------------------------
create table invitations (
  id            uuid primary key default gen_random_uuid(),
  family_id     uuid not null references families(id) on delete cascade,
  invited_email text not null,
  token         uuid not null default gen_random_uuid(),
  status        invitation_status not null default 'pending',
  invited_by    uuid not null references profiles(id),
  member_id     uuid,                       -- optional: pre-created member to bind on accept
  expires_at    timestamptz not null default (now() + interval '14 days'),
  accepted_at   timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  foreign key (member_id, family_id) references members(id, family_id) on delete set null
);
create unique index invitations_pending_unique
  on invitations(family_id, lower(invited_email)) where status = 'pending';
create index invitations_email_idx on invitations(lower(invited_email));
create unique index invitations_token_idx on invitations(token);
