-- 0122 — Lending capture & correction (docs/specs/lending-capture-spec.md)
--
-- Three additions, one epic:
--   1. personal_lessons — ONE encrypted blob per user holding what the review
--      screen has learned from their corrections (kind lessons "transfers to
--      Minh at this size are loans" + the migrated category lessons). Server
--      stores ciphertext under the personal DEK (the personal_budgets pattern);
--      it can never read a lesson, only sync it between the owner's devices.
--   2. personal_transactions.due_date — "hẹn trả" on a loan row. Plaintext
--      date, same stance as txn_date: a bare date with no amount or name
--      attached leaks almost nothing, and the daily guide reads it cheaply.
--   3. personal_accounts.account_number_enc — the user's own full receiving
--      account number, typed ONCE (lazily, on first "nhắc trả") to build a
--      VietQR. Sealed under the personal DEK; capture only ever sees masked
--      tails, so this is the one deliberately-entered secret on the row.

-- ── 1. personal_lessons ──────────────────────────────────────────────────────
create table if not exists public.personal_lessons (
  owner_user_id  uuid primary key references auth.users(id) on delete cascade,
  lessons_enc    text,
  updated_at     timestamptz not null default now()
);
alter table public.personal_lessons enable row level security;
drop policy if exists plsn_all on public.personal_lessons;
create policy plsn_all on public.personal_lessons
  for all to authenticated
  using (owner_user_id = (select auth.uid()))
  with check (owner_user_id = (select auth.uid()));

-- ── 2. due date on the spine (loans wear it; every other kind leaves it null) ─
alter table public.personal_transactions
  add column if not exists due_date date;

-- ── 3. the VietQR receiving account number, sealed ───────────────────────────
alter table public.personal_accounts
  add column if not exists account_number_enc text;
