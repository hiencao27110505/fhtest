-- FamilyHub · reset-test-user · PERSONAL-ONLY reset (destructive, one transaction)
-- Wipes ONE user's personal ledger (Model Y) so the app re-provisions a fresh
-- personal Key Card on their next "Cá nhân" open. Keeps the auth account AND every
-- family intact — personal data lives in its own owner-scoped tables, independent
-- of any family. Use this when a member forgot/lost their PERSONAL key (a different
-- secret from the family key) and there is no unlocked device to self-serve a regen.
--
-- The skill substitutes __EMAIL__ before running.
--
-- WHAT IS LOST vs REBUILT:
--   * private rows (personal_transactions.space_id IS NULL) → GONE. No escrow, by design.
--   * family-mirror rows (space_id set) → rebuild automatically after re-provision:
--     the mirror engine re-adopts the intact family transactions (this month + last
--     month window; older family expenses won't repopulate the personal view, but the
--     family data itself is untouched).
-- Run the personal dry-run in SKILL.md first to see the private vs mirror split.
BEGIN;

CREATE TEMP TABLE _u ON COMMIT DROP AS
  SELECT id AS uid FROM auth.users WHERE lower(email) = lower('__EMAIL__');

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM _u) THEN
    RAISE EXCEPTION 'reset-personal: no auth user for email __EMAIL__ — nothing done';
  END IF;
END $$;

-- Leaf-first (respects the personal FK graph):
--   personal_transaction_photos.transaction_id → personal_transactions
--   personal_transactions.account_id           → personal_accounts
--   personal_transactions.space_id → families is an OUTBOUND ref only (family untouched).
-- (personal_incomes was folded into personal_transactions. Keep this list in sync
--  with the `personal%` tables if the schema grows again.)
DELETE FROM personal_transaction_photos WHERE owner_user_id IN (SELECT uid FROM _u);
DELETE FROM personal_transactions       WHERE owner_user_id IN (SELECT uid FROM _u);
DELETE FROM personal_accounts           WHERE owner_user_id IN (SELECT uid FROM _u);
DELETE FROM personal_budgets            WHERE owner_user_id IN (SELECT uid FROM _u);
DELETE FROM personal_keys               WHERE user_id       IN (SELECT uid FROM _u);

-- NOTE: personal photo blobs in the `personal-media` bucket are NOT deleted here
-- (storage.protect_delete() blocks direct DELETE and would roll this back). Purge
-- out-of-band via the Storage API only if the dry-run showed photos > 0 — orphaned
-- encrypted blobs are harmless, just wasted storage.

COMMIT;
