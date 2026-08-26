-- 0094 — per-category personal budgets (parity with the family budget sheet).
-- Additive & backward-compatible: total_enc stays the monthly total; cats_enc adds
-- an encrypted JSON map { "<category name>": <amount base-units>, ... }. Older
-- clients ignore the new column and keep writing total_enc only.
alter table public.personal_budgets
  add column if not exists cats_enc text;   -- encrypted with the user's personal key; null until set
