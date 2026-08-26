-- 0096 — optional transaction time for the family ledger (phase 2, mirrors 0095).
-- Same integrity model as the personal ledger: the DAY stays in txn_date; this adds
-- the fine time-of-day as a local wall-clock "HH:MM" string (no UTC instant, so the
-- toISOString midnight-shift trap doesn't apply). NULL = only the day is known —
-- the UI renders date-only and never fabricates a clock time.
--
-- Two columns so it rides the family fhField/fhRead pattern (like amount/note):
--   occurred_time      — plaintext for off/dual encryption states,
--   occurred_time_enc  — ciphertext (family DEK) for the enc state.
-- Additive & backward-compatible: older clients ignore both.
alter table public.transactions
  add column if not exists occurred_time text,
  add column if not exists occurred_time_enc text;
