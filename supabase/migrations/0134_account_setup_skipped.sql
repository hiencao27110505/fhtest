-- 0134 — Account setup (docs/specs/account-setup-spec.md)
-- A fresh mailbox-connected user's accounts materialize from a lookback window
-- of email, so every derived number is wrong on day one (a card's outstanding
-- ignores the balance carried in from before the window; a pre-window statement
-- payment flips it to "Đang dư"). The fix is a per-account setup step whose
-- one required input is the anchor (0109) — cards included from now on, stored
-- as a NEGATIVE asset balance so one derivation serves every kind.
--
-- The only schema need: remember that a person tapped "Để sau" on an account,
-- so the wizard never re-asks on the next import (spec Q15). Plaintext
-- timestamp, same stance as anchor_at: a timing key, not a value.
alter table public.personal_accounts
  add column if not exists setup_skipped_at timestamptz;
