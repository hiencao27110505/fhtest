-- 0109 — Full ledger (docs/specs/full-ledger-spec.md)
-- 1) Income joins the personal spine as kind='income' (T7): personal_incomes
--    rows copy over verbatim — same personal DEK, same encVal format, so the
--    ciphertexts need no re-encryption — and the table is dropped.
-- 2) Non-card accounts gain a balance anchor (declared truth at a moment) and
--    the bank's last self-stated balance (the drift detector, T9). Amounts are
--    ciphertext; the timing keys are plaintext, per the 0105 rule.

-- 1a. kind gains 'income'
alter table public.personal_transactions
  drop constraint personal_transactions_kind_check;
alter table public.personal_transactions
  add constraint personal_transactions_kind_check
  check (kind in ('expense','income','transfer','loan','repayment'));

-- 1b. fold personal_incomes in. Row ids are reused (both uuid PKs, nothing
--     references them), so a re-run cannot double-copy: on conflict do nothing.
insert into public.personal_transactions
  (id, owner_user_id, kind, amount_enc, note_enc, txn_date, source, created_at)
select id, owner_user_id, 'income', amount_enc, note_enc, income_date, source, created_at
from public.personal_incomes
on conflict (id) do nothing;

drop table public.personal_incomes;

-- 2. balance anchor + bank-stated balance per account
alter table public.personal_accounts
  add column if not exists anchor_balance_enc text,       -- personal-DEK ciphertext, base units
  add column if not exists anchor_at          timestamptz, -- the moment the anchor declared truth
  add column if not exists ext_balance_enc    text,        -- last "Số dư" a bank email stated, ciphertext
  add column if not exists ext_balance_date   date;        -- when the bank said it (staleness display)
