-- 0108_personal_account_statement.sql
-- Credit-card configuration a real card has beyond a name + limit
-- (docs/specs/borrowing-lending-spec.md). Day-of-month fields only — not
-- sensitive, so plaintext like `tail` / `provider`, not encrypted:
--   statement_day — ngày chốt sao kê (when the cycle closes)
--   due_day       — ngày đến hạn thanh toán (when the payment is due)
-- The *balance truth* problem (email capture missing transactions) is handled
-- in the client as a reconcile ADJUSTMENT — a dated transfer that books the gap
-- between the derived balance and the real one — so it needs no column; the
-- derived-balance model stays intact.
alter table public.personal_accounts
  add column if not exists statement_day smallint check (statement_day between 1 and 31),
  add column if not exists due_day       smallint check (due_day between 1 and 31);
