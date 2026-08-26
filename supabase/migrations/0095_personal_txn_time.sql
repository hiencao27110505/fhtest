-- 0095 — optional transaction time for the personal ledger (E2EE, on-device only).
-- The DAY already lives in txn_date (plaintext, indexable). This adds the fine
-- time-of-day as the LOCAL wall-clock "HH:MM", encrypted under the personal key,
-- so it never sits in the clear and is only ever read on-device.
--
-- Integrity: NULL means "only the day is known" (manual entry with no time given,
-- or a legacy row) — the UI must render date-only and never fabricate a clock time.
-- Additive & backward-compatible: older clients ignore the column.
alter table public.personal_transactions
  add column if not exists occurred_time_enc text;   -- encrypted "HH:MM"; null = day-only
