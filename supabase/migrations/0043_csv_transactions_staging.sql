-- ============================================================================
-- FamilyHub — 0043: CSV import staging table
--
-- Decided against broadening email_transactions (0025): its gmail_message_id
-- is NOT NULL UNIQUE (meaningless for a CSV row), its transaction_type enum is
-- email-specific, and CSV import needs a concept email never did — an import
-- *batch* (for catching a duplicate row within one file, e.g. the same rent
-- line appearing twice in a messy export) plus TWO distinct dedup targets,
-- not one. Same proven shape otherwise: staging, review_status,
-- promoted_transaction_id, raw payload preserved, human approves before
-- anything reaches the real ledger.
--
-- ADDITIVE ONLY — no existing table touched.
--
-- Written client-side, unlike email_transactions (a backend-pipeline table
-- the Apps Script service role writes). CSV import runs entirely in the
-- browser, so this needs real family-scoped RLS policies, not the
-- service-role-only posture 0025 uses.
--
-- Encryption-aware from day one, per CSV-IMPORT-ENCRYPTION.md's answer on
-- this exact question: a staging row is a persisted server-side row reachable
-- through the same API surface and backups as every other table — no reason
-- to treat "it's temporary" as an exemption from what enc_state protects.
-- amount/note get the same _enc sibling-column + presence-check shape as
-- 0030 gave the real ledger tables, and the same _fh_enc_guard() trigger
-- (0033) applies here too, for the same reason.
--
-- OPEN QUESTIONS (flagged, not resolved here):
--   1. paid_by / split_with (shared-expense-app columns, e.g. a Splitwise-
--      style export) have no first-class ledger equivalent — same schema gap
--      CSV-IMPORT-ENCRYPTION.md and the design doc already flagged. Kept
--      here as plain text (not encrypted) since it's not promoted into
--      `transactions` at all yet; revisit if/when split-aware transactions
--      ship.
--   2. mapping_confidence / parse_flags shapes are whatever
--      src/js-data/45-csv-import.js's resolver actually returns today —
--      not yet locked down as a stable contract, since nothing writes to
--      this table yet either (the promotion step this staging table exists
--      for is still unbuilt).
-- ============================================================================

create table csv_transactions (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references families(id) on delete cascade,
  import_batch_id uuid not null,       -- groups every row from one CSV upload — self-dedup scope
  source_filename text,                 -- original filename, informational only
  row_index integer not null,           -- position in the source file, for support/debugging

  occurred_at date,                     -- nullable: some rows genuinely can't resolve a date, flagged for review rather than blocked
  amount numeric,
  amount_enc text,
  currency text,
  direction text check (direction in ('debit', 'credit')),
  note text,                            -- maps to transactions.note at promotion — same name, direct copy, no translation needed
  note_enc text,
  counterparty text,                    -- staging-only: transactions has no counterparty column (same as email_transactions' existing pattern) — useful for merchant-grouping and dedup, not promoted
  category_guess text,                  -- from the source file's own category column, if it had one — a suggestion shown at review, never auto-assigned (transactions.category_id is only ever set by a human picking it)

  paid_by text,                         -- see open question 1
  split_with text,

  raw_row jsonb not null,               -- every column from the source row, mapped or not — nothing from an unsupported structure (like split data) is ever silently dropped
  mapping_confidence text,              -- see open question 2
  parse_flags jsonb,                    -- e.g. ["date_missing"], ["amount_format_ambiguous"] — drives ready vs. needs-review bucketing in the review screen

  review_status text not null default 'pending' check (review_status in ('pending', 'approved', 'rejected')),
  promoted_transaction_id uuid references transactions(id),
  duplicate_of_id uuid references csv_transactions(id),                    -- matches another row in the SAME batch (self-dedup)
  possible_duplicate_of_transaction_id uuid references transactions(id),  -- matches an ALREADY-PROMOTED transaction (cross-source dedup, e.g. against a bank-email import) — flagged for the user to confirm or override, never auto-dropped, same rule as email_transactions' duplicate_of_id

  created_at timestamptz not null default now()
);

create index on csv_transactions (family_id, import_batch_id);
create index on csv_transactions (family_id, review_status) where review_status = 'pending';
create index on csv_transactions (family_id, amount, occurred_at) where possible_duplicate_of_transaction_id is null and promoted_transaction_id is null;  -- speeds up the cross-source dedup lookup, same shape as email_transactions' equivalent index

alter table csv_transactions add constraint csv_transactions_amount_check
  check (amount is null or amount > 0);
alter table csv_transactions add constraint csv_transactions_amount_presence
  check (amount is not null or amount_enc is not null);

-- ============================================================================
-- Row-Level Security — family-scoped, written by app clients directly
-- (unlike email_transactions), so real policies are needed, not RLS-on-with-
-- no-policies. Initplan form throughout, per CLAUDE.md's RLS rule.
-- ============================================================================
alter table csv_transactions enable row level security;

create policy csv_transactions_select on csv_transactions
  for select using (family_id = (select auth_family_id()));

create policy csv_transactions_insert on csv_transactions
  for insert with check (family_id = (select auth_family_id()));

-- Update is needed for the review flow itself (picking a category, resolving
-- a flagged duplicate, marking approved/rejected) and for promotion (setting
-- promoted_transaction_id). No delete policy — a rejected row stays as a
-- record rather than disappearing, same instinct as review_status='rejected'
-- on email_transactions.
create policy csv_transactions_update on csv_transactions
  for update using (family_id = (select auth_family_id()))
  with check (family_id = (select auth_family_id()));

-- Same encryption enforcement as the real ledger tables (0033) — a plaintext
-- money write without ciphertext is rejected once the family's enc_state
-- isn't 'off', so a staging row can't accidentally become the one place in
-- the app that leaks plaintext for an encrypted family.
--
-- _fh_enc_guard() (0033) dispatches on tg_table_name through a fixed
-- if/elsif chain over the 8 tables that existed when it was written —
-- csv_transactions isn't one of them, so attaching the trigger without also
-- extending the function would fire on every write and silently check
-- nothing (falls through the whole chain unmatched), which is worse than no
-- trigger at all: it would look protected without being protected. Extending
-- with create or replace, the same pattern 0032/0033 already used to evolve
-- this function — flagged in AGENT_SYNC.md for the encryption side's
-- awareness, since this function is otherwise theirs.
create or replace function public._fh_enc_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_state text; v_old_row record;
begin
  select enc_state into v_state from family_keys where family_id = new.family_id;
  if v_state is null or v_state = 'off' then return new; end if;

  if tg_table_name = 'transactions' then
    perform _fh_enc_pair(v_state, tg_op, 'transactions.amount', new.amount::text, new.amount_enc,
      case when tg_op = 'UPDATE' then old.amount::text end, case when tg_op = 'UPDATE' then old.amount_enc end);
    perform _fh_enc_pair(v_state, tg_op, 'transactions.note', new.note, new.note_enc,
      case when tg_op = 'UPDATE' then old.note end, case when tg_op = 'UPDATE' then old.note_enc end);
  elsif tg_table_name = 'incomes' then
    perform _fh_enc_pair(v_state, tg_op, 'incomes.amount', new.amount::text, new.amount_enc,
      case when tg_op = 'UPDATE' then old.amount::text end, case when tg_op = 'UPDATE' then old.amount_enc end);
    perform _fh_enc_pair(v_state, tg_op, 'incomes.note', new.note, new.note_enc,
      case when tg_op = 'UPDATE' then old.note end, case when tg_op = 'UPDATE' then old.note_enc end);
  elsif tg_table_name = 'savings_entries' then
    perform _fh_enc_pair(v_state, tg_op, 'savings_entries.amount', new.amount::text, new.amount_enc,
      case when tg_op = 'UPDATE' then old.amount::text end, case when tg_op = 'UPDATE' then old.amount_enc end);
    perform _fh_enc_pair(v_state, tg_op, 'savings_entries.note', new.note, new.note_enc,
      case when tg_op = 'UPDATE' then old.note end, case when tg_op = 'UPDATE' then old.note_enc end);
  elsif tg_table_name = 'event_fundings' then
    perform _fh_enc_pair(v_state, tg_op, 'event_fundings.amount', new.amount::text, new.amount_enc,
      case when tg_op = 'UPDATE' then old.amount::text end, case when tg_op = 'UPDATE' then old.amount_enc end);
  elsif tg_table_name = 'category_budgets' then
    perform _fh_enc_pair(v_state, tg_op, 'category_budgets.amount', new.amount::text, new.amount_enc,
      case when tg_op = 'UPDATE' then old.amount::text end, case when tg_op = 'UPDATE' then old.amount_enc end);
  elsif tg_table_name = 'monthly_budgets' then
    perform _fh_enc_pair(v_state, tg_op, 'monthly_budgets.budget_total', nullif(new.budget_total, 0)::text, new.budget_total_enc,
      case when tg_op = 'UPDATE' then nullif(old.budget_total, 0)::text end, case when tg_op = 'UPDATE' then old.budget_total_enc end);
  elsif tg_table_name = 'events' then
    perform _fh_enc_pair(v_state, tg_op, 'events.target_amount', new.target_amount::text, new.target_amount_enc,
      case when tg_op = 'UPDATE' then old.target_amount::text end, case when tg_op = 'UPDATE' then old.target_amount_enc end);
    perform _fh_enc_pair(v_state, tg_op, 'events.name', new.name, new.name_enc,
      case when tg_op = 'UPDATE' then old.name end, case when tg_op = 'UPDATE' then old.name_enc end);
  elsif tg_table_name = 'saving_goals' then
    perform _fh_enc_pair(v_state, tg_op, 'saving_goals.target_amount', new.target_amount::text, new.target_amount_enc,
      case when tg_op = 'UPDATE' then old.target_amount::text end, case when tg_op = 'UPDATE' then old.target_amount_enc end);
    perform _fh_enc_pair(v_state, tg_op, 'saving_goals.name', new.name, new.name_enc,
      case when tg_op = 'UPDATE' then old.name end, case when tg_op = 'UPDATE' then old.name_enc end);
    perform _fh_enc_pair(v_state, tg_op, 'saving_goals.note', new.note, new.note_enc,
      case when tg_op = 'UPDATE' then old.note end, case when tg_op = 'UPDATE' then old.note_enc end);
  elsif tg_table_name = 'csv_transactions' then
    perform _fh_enc_pair(v_state, tg_op, 'csv_transactions.amount', new.amount::text, new.amount_enc,
      case when tg_op = 'UPDATE' then old.amount::text end, case when tg_op = 'UPDATE' then old.amount_enc end);
    perform _fh_enc_pair(v_state, tg_op, 'csv_transactions.note', new.note, new.note_enc,
      case when tg_op = 'UPDATE' then old.note end, case when tg_op = 'UPDATE' then old.note_enc end);
  end if;
  return new;
end $$;

create trigger trg_csv_transactions_enc_guard before insert or update on csv_transactions
  for each row execute function public._fh_enc_guard();
