-- 0105_personal_debt_schema.sql
-- Borrowing & Lending, personal side (docs/specs/borrowing-lending-spec.md).
--
-- One primitive: a running balance against a counterparty, DERIVED from rows,
-- never stored (spec Q5). Card outstanding = Σ expenses tagged to the account
-- − Σ kind='transfer' rows tagged to it. Person balance = Σ signed 'loan'
-- + 'repayment' rows for that counterparty (sign lives inside the ciphertext:
-- positive = they owe me). The settlement leg is always a transfer, never
-- income/expense — that is the whole accounting rule of the epic.
--
-- E2EE posture follows the personal-table precedent exactly: names/amounts
-- encrypted per-column under the personal DEK; low-sensitivity routing keys
-- (kind, tail, provider — like cat_emoji / source / txn_date before them)
-- stay plaintext so the client can group and upsert without decrypting.

-- 1 ▸ widen the kind vocabulary (live constraint name verified via pg_constraint)
alter table public.personal_transactions
  drop constraint if exists personal_transactions_kind_check;
alter table public.personal_transactions
  add constraint personal_transactions_kind_check
  check (kind in ('expense','transfer','loan','repayment'));

-- 2 ▸ accounts: auto-materialized instruments (spec Q15 — discovered from
--     captured mail's provider+tail, editable later; "Tiền mặt" for cash).
create table if not exists public.personal_accounts (
  id               uuid primary key default gen_random_uuid(),
  owner_user_id    uuid not null references auth.users(id) on delete cascade,
  kind             text not null check (kind in ('credit_card','deposit','ewallet','cash')),
  name_enc         text,             -- display name, personal-DEK ciphertext
  tail             text,             -- last digits, plaintext routing key ('1234')
  provider         text,             -- canonical sender slug ('sacombank'), plaintext
  credit_limit_enc text,             -- user-entered limit for the utilization meter
  human_verified   boolean not null default false,
  archived_at      timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create unique index if not exists personal_accounts_uniq
  on public.personal_accounts (owner_user_id, kind, coalesce(provider,''), coalesce(tail,''))
  where archived_at is null;

alter table public.personal_accounts enable row level security;

drop policy if exists pacct_all on public.personal_accounts;
create policy pacct_all on public.personal_accounts
  for all to authenticated
  using (owner_user_id = (select auth.uid()))
  with check (owner_user_id = (select auth.uid()));

drop trigger if exists personal_accounts_touch on public.personal_accounts;
create trigger personal_accounts_touch
  before update on public.personal_accounts
  for each row execute function public.set_updated_at();

-- 3 ▸ debt columns on personal_transactions
alter table public.personal_transactions
  add column if not exists account_id        uuid references public.personal_accounts(id) on delete set null,
  add column if not exists counterparty_enc  text,   -- person name for a 1:1 IOU (ciphertext)
  add column if not exists transfer_group_id uuid;   -- pairs two captured legs of one transfer (spec Q10)

-- Debt rows are rare but need ALL-TIME reads (balances aren't windowed like
-- the monthly expense hydrate) — partial indexes keep those fetches cheap.
create index if not exists ptx_owner_nonexpense_idx
  on public.personal_transactions (owner_user_id)
  where kind <> 'expense';
create index if not exists ptx_owner_account_idx
  on public.personal_transactions (owner_user_id, account_id)
  where account_id is not null;
