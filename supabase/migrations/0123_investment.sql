-- 0123_investment.sql
-- The "Đầu tư" bento (investment-spec.md). One new row meaning + one new
-- account kind + the review's counterparty→position memory.
--
-- Model Y discipline (0105 rule): values are personal-DEK ciphertext,
-- routing/timing keys are plaintext. Amounts/prices in base units
-- (thousands of VND); signs live inside the ciphertext.

-- 1) kind='investment' on the spine.
--    Sign convention: a buy is money OUT of the funding account
--    (amount < 0, quantity > 0); a sell is money IN (amount > 0,
--    quantity < 0). Position math sums −amount; account balance math
--    treats it like a signed transfer leg (+amount).
alter table public.personal_transactions
  drop constraint personal_transactions_kind_check;
alter table public.personal_transactions
  add constraint personal_transactions_kind_check
  check (kind in ('expense','income','transfer','loan','repayment','investment'));

-- 2) which position a buy/sell accrues to, and how much of the asset moved.
alter table public.personal_transactions
  add column position_account_id uuid references public.personal_accounts(id) on delete set null,
  add column quantity_enc text;  -- signed decimal string (up to 8 dp), ciphertext

create index if not exists ptx_owner_position_idx
  on public.personal_transactions (owner_user_id, position_account_id)
  where position_account_id is not null;

-- 3) kind='investment' on accounts — a position. No provider/tail
--    (its name is its identity, like manual accounts); balance is DERIVED
--    (net-invested = Σ buys − Σ sells), never anchored.
alter table public.personal_accounts
  drop constraint personal_accounts_kind_check;
alter table public.personal_accounts
  add constraint personal_accounts_kind_check
  check (kind in ('credit_card','deposit','ewallet','cash','investment'));

-- 4) the asset identity + the manual price.
--    asset_*_enc / manual_price_enc are personal-DEK ciphertext — the
--    operator learns a user HAS an investment account (kind is plaintext,
--    as everywhere), never which asset or how much.
--    Fetched (API) prices are NEVER stored server-side — device cache only
--    (spec I4); manual_price_* is the user's own typed price, stored like
--    ext_balance_enc so it survives across devices.
alter table public.personal_accounts
  add column asset_symbol_enc text,   -- "BTC", "SJC", "FPT" — ciphertext
  add column asset_unit_enc  text,    -- "BTC", "chỉ", "CP", "CCQ" — ciphertext
  add column asset_class_enc text,    -- crypto|gold|stock|fund|other — ciphertext
  add column manual_price_enc text,   -- VND-thousands per unit — ciphertext
  add column manual_price_at timestamptz;  -- plaintext timing key (staleness label)

-- 5) the review's counterparty→position memory (spec I9).
--    key_enc holds the deburred/normalized counterparty match key,
--    ciphertext; matching happens client-side after decryption. No unique
--    constraint is possible on ciphertext (fresh IV per write) — the
--    client dedups by decrypted key and updates in place.
create table public.personal_review_memory (
  id                  uuid primary key default gen_random_uuid(),
  owner_user_id       uuid not null references auth.users(id) on delete cascade,
  key_enc             text not null,
  position_account_id uuid not null references public.personal_accounts(id) on delete cascade,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index prm_owner_idx on public.personal_review_memory (owner_user_id);

alter table public.personal_review_memory enable row level security;
create policy prm_all on public.personal_review_memory
  for all to authenticated
  using (owner_user_id = (select auth.uid()))
  with check (owner_user_id = (select auth.uid()));

drop trigger if exists prm_touch on public.personal_review_memory;
create trigger prm_touch before update on public.personal_review_memory
  for each row execute function public.set_updated_at();
