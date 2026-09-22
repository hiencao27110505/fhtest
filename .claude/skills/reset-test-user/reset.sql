-- FamilyHub · reset-test-user · APPLY (destructive, one transaction)
-- The skill substitutes __EMAIL__ before running. For SOFT mode it strips the
-- block between the "HARD ONLY" markers (keeps the auth.users account alive).
-- Deletes only families the account SOLELY owns; a real/shared membership aborts.
--
-- SCHEMA DRIFT IS THE #1 HAZARD HERE. The table lists below WILL go stale as
-- migrations land. Two defences: (1) run coverage.sql first (SKILL.md step 0) to
-- eyeball the full table inventory, and (2) the COVERAGE SELF-CHECK block below
-- ABORTS the whole transaction if any family-scoped or user-scoped table is not
-- named in the known lists — so a new table can never silently leave orphans.
-- When the check fires, add the new table's DELETE in the right leaf-first spot
-- AND to the known list in the check, then re-run.
BEGIN;

CREATE TEMP TABLE _target ON COMMIT DROP AS
  SELECT id AS uid, email FROM auth.users WHERE lower(email) = lower('__EMAIL__');

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM _target) THEN
    RAISE EXCEPTION 'reset-test-user: no auth user for email __EMAIL__ — nothing done';
  END IF;
END $$;

-- ══ COVERAGE SELF-CHECK ═════════════════════════════════════════════════════
-- Abort if the schema grew a family- or user-scoped table this script doesn't
-- know about. Keep these two known-lists in sync with the DELETEs below.
DO $$
DECLARE unhandled text;
BEGIN
  -- (a) family-scoped: every public base table with a family_id column.
  SELECT string_agg(c.table_name, ', ' ORDER BY c.table_name) INTO unhandled
  FROM information_schema.columns c
  JOIN information_schema.tables tb
    ON tb.table_schema=c.table_schema AND tb.table_name=c.table_name AND tb.table_type='BASE TABLE'
  WHERE c.table_schema='public' AND c.column_name='family_id'
    AND c.table_name NOT IN (
      -- deleted by family_id below (leaf-first):
      'txn_shares','transaction_photos','reactions','event_fundings','event_memories',
      'savings_entries','saving_goals','events','transactions','category_budgets',
      'monthly_budgets','incomes','categories','member_weather','push_subscriptions',
      'request_reviews','passcode_attempts','invitations','settle_ups','family_streaks',
      'family_key_wraps','family_keys','family_creation_keys','members',
      -- handled specially, not by a plain family_id delete:
      'mailbox_grants',  -- deleted by user_id / member_id (mailbox is person-level)
      'profiles'         -- family_id NULLed, row kept (soft) or deleted by id (hard)
    );
  IF unhandled IS NOT NULL THEN
    RAISE EXCEPTION 'reset-test-user: UNHANDLED family-scoped table(s): % — update reset.sql (add the DELETE + this known-list) before running', unhandled;
  END IF;

  -- (b) user-scoped: every public base table with a user_id / owner_user_id column.
  SELECT string_agg(DISTINCT c.table_name, ', ' ORDER BY c.table_name) INTO unhandled
  FROM information_schema.columns c
  JOIN information_schema.tables tb
    ON tb.table_schema=c.table_schema AND tb.table_name=c.table_name AND tb.table_type='BASE TABLE'
  WHERE c.table_schema='public' AND c.column_name IN ('user_id','owner_user_id')
    AND c.table_name NOT IN (
      'members','passcode_attempts','family_creation_keys','mailbox_grants','mailbox_beta_access',
      'email_transactions','resolved_email_messages','connected_accounts','device_sessions',
      'merchant_corrections','user_consents','founder_daily_active',
      'statement_files','statement_rows','resolved_statement_rows',  -- bank-statement import
      'personal_keys','personal_accounts','personal_budgets','personal_lessons','personal_streaks',
      'personal_review_memory','personal_transaction_photos','personal_transactions','personal_labels'
    );
  IF unhandled IS NOT NULL THEN
    RAISE EXCEPTION 'reset-test-user: UNHANDLED user-scoped table(s): % — update reset.sql (add the DELETE + this known-list) before running', unhandled;
  END IF;
END $$;
-- ════════════════════════════════════════════════════════════════════════════

CREATE TEMP TABLE _purge ON COMMIT DROP AS
  SELECT f.id
  FROM families f
  WHERE f.owner_id IN (SELECT uid FROM _target)
    AND NOT EXISTS (
      SELECT 1 FROM members m
      WHERE m.family_id = f.id
        AND m.user_id IS NOT NULL
        AND m.user_id NOT IN (SELECT uid FROM _target)
    );

-- Guard: the account must not belong to any family it does not solely own.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM members m
    WHERE m.user_id IN (SELECT uid FROM _target)
      AND m.family_id NOT IN (SELECT id FROM _purge)
  ) THEN
    RAISE EXCEPTION 'reset-test-user: account is a member of a shared/real family it does not solely own — aborting to protect live data';
  END IF;
END $$;

-- Member set spanning the purged families (for member-scoped child tables that
-- have no family_id column of their own).
CREATE TEMP TABLE _members ON COMMIT DROP AS
  SELECT id FROM members WHERE family_id IN (SELECT id FROM _purge)
  UNION
  SELECT id FROM members WHERE user_id IN (SELECT uid FROM _target);

-- Member/person-scoped mailbox + email tables — leaf-first, before members AND
-- before transactions (email_transactions.promoted_transaction_id → transactions).
-- email_transactions has a self-FK (duplicate_of_id) — null it first so a bulk
-- delete of the whole owner set can't trip the self-reference.
UPDATE email_transactions SET duplicate_of_id = NULL
  WHERE owner_user_id IN (SELECT uid FROM _target) OR member_id IN (SELECT id FROM _members);
DELETE FROM email_transactions      WHERE owner_user_id IN (SELECT uid FROM _target) OR member_id IN (SELECT id FROM _members);
DELETE FROM resolved_email_messages WHERE owner_user_id IN (SELECT uid FROM _target) OR member_id IN (SELECT id FROM _members);
DELETE FROM mailbox_connections     WHERE member_id IN (SELECT id FROM _members);
DELETE FROM mailbox_grants          WHERE user_id IN (SELECT uid FROM _target) OR member_id IN (SELECT id FROM _members);

-- Bank-statement import (user-scoped): statement_rows → statement_files (leaf-first);
-- resolved_statement_rows is independent (owner_user_id + row_fp).
DELETE FROM resolved_statement_rows WHERE owner_user_id IN (SELECT uid FROM _target);
DELETE FROM statement_rows          WHERE owner_user_id IN (SELECT uid FROM _target);
DELETE FROM statement_files         WHERE owner_user_id IN (SELECT uid FROM _target);

-- Family-scoped data, deleted leaf-first (respects RESTRICT/NO-ACTION FKs).
--   txn_shares/transaction_photos/reactions → transactions
--   event_fundings → events, saving_goals, members ; savings_entries → saving_goals, members
--   saving_goals → events ; events → transactions ; transactions → categories, members
DELETE FROM txn_shares         WHERE family_id IN (SELECT id FROM _purge);
DELETE FROM transaction_photos WHERE family_id IN (SELECT id FROM _purge);
DELETE FROM reactions          WHERE family_id IN (SELECT id FROM _purge);
DELETE FROM event_fundings     WHERE family_id IN (SELECT id FROM _purge);
DELETE FROM event_memories     WHERE family_id IN (SELECT id FROM _purge);
DELETE FROM savings_entries    WHERE family_id IN (SELECT id FROM _purge);
DELETE FROM saving_goals       WHERE family_id IN (SELECT id FROM _purge);
DELETE FROM events             WHERE family_id IN (SELECT id FROM _purge);
DELETE FROM transactions       WHERE family_id IN (SELECT id FROM _purge);
DELETE FROM category_budgets   WHERE family_id IN (SELECT id FROM _purge);
DELETE FROM monthly_budgets    WHERE family_id IN (SELECT id FROM _purge);
DELETE FROM incomes            WHERE family_id IN (SELECT id FROM _purge);
DELETE FROM categories         WHERE family_id IN (SELECT id FROM _purge);
DELETE FROM member_weather     WHERE family_id IN (SELECT id FROM _purge);
DELETE FROM push_subscriptions WHERE family_id IN (SELECT id FROM _purge);
DELETE FROM request_reviews    WHERE family_id IN (SELECT id FROM _purge);
DELETE FROM passcode_attempts  WHERE family_id IN (SELECT id FROM _purge);
DELETE FROM invitations        WHERE family_id IN (SELECT id FROM _purge);
DELETE FROM settle_ups         WHERE family_id IN (SELECT id FROM _purge);
DELETE FROM family_streaks     WHERE family_id IN (SELECT id FROM _purge);
DELETE FROM family_key_wraps   WHERE family_id IN (SELECT id FROM _purge);
DELETE FROM family_keys        WHERE family_id IN (SELECT id FROM _purge);
DELETE FROM family_creation_keys WHERE family_id IN (SELECT id FROM _purge);
DELETE FROM members            WHERE family_id IN (SELECT id FROM _purge);

-- NOTE: media blobs in the `family-media` bucket ({family_id}/... prefix) are NOT
-- deleted here. Direct DELETE on storage.objects is blocked by the storage.protect_delete()
-- trigger and would roll back this whole transaction. Media is purged out-of-band via
-- the Storage API — see SKILL.md step 3.5. (Orphaned blobs are harmless, just wasted storage.)

-- Detach the profile from any purged family, then drop the families themselves.
UPDATE profiles SET family_id = NULL WHERE family_id IN (SELECT id FROM _purge);
DELETE FROM families WHERE id IN (SELECT id FROM _purge);

-- Rows keyed to the user directly (kept in SOFT — these are family-onboarding-adjacent).
DELETE FROM passcode_attempts    WHERE user_id IN (SELECT uid FROM _target);
DELETE FROM family_creation_keys WHERE user_id IN (SELECT uid FROM _target);

-- >>> HARD ONLY (strip this block for --soft) --------------------------------
-- Personal ledger (Model Y) — owner-scoped by USER, independent of any family, so
-- a full account nuke must take it too (SOFT keeps it: personal is orthogonal to
-- family onboarding). Leaf-first per the personal FK graph:
--   personal_transaction_photos.transaction_id      → personal_transactions
--   personal_transactions.account_id/position_...   → personal_accounts
--   personal_review_memory.position_account_id       → personal_accounts
-- (personal_incomes was folded into personal_transactions. Keep this list in sync
--  with the `personal%` tables — the coverage self-check above enforces it.)
--   personal_transactions.label_id → personal_labels (delete transactions first)
DELETE FROM personal_transaction_photos WHERE owner_user_id IN (SELECT uid FROM _target);
DELETE FROM personal_transactions       WHERE owner_user_id IN (SELECT uid FROM _target);
DELETE FROM personal_review_memory      WHERE owner_user_id IN (SELECT uid FROM _target);
DELETE FROM personal_accounts           WHERE owner_user_id IN (SELECT uid FROM _target);
DELETE FROM personal_labels             WHERE owner_user_id IN (SELECT uid FROM _target);
DELETE FROM personal_budgets            WHERE owner_user_id IN (SELECT uid FROM _target);
DELETE FROM personal_lessons            WHERE owner_user_id IN (SELECT uid FROM _target);
DELETE FROM personal_streaks            WHERE owner_user_id IN (SELECT uid FROM _target);
DELETE FROM personal_keys               WHERE user_id       IN (SELECT uid FROM _target);
-- (Personal photo blobs live in the `personal-media` bucket and are NOT deleted
--  here — same storage.protect_delete() constraint as family-media; purge out-of-band.)

-- Other user-scoped state, so the account comes back truly first-run.
DELETE FROM merchant_corrections WHERE owner_user_id IN (SELECT uid FROM _target);  -- learned merchant→category
DELETE FROM connected_accounts   WHERE user_id IN (SELECT uid FROM _target);        -- linked bank/wallet
DELETE FROM device_sessions      WHERE user_id IN (SELECT uid FROM _target);        -- key-card device trust
DELETE FROM user_consents        WHERE user_id IN (SELECT uid FROM _target);        -- consent records
DELETE FROM mailbox_beta_access  WHERE user_id IN (SELECT uid FROM _target);        -- mailbox beta allowlist
DELETE FROM founder_daily_active WHERE user_id IN (SELECT uid FROM _target);        -- founder-alert telemetry

-- Remove the account itself so the next Google sign-in mints a brand-new user id
-- and handle_new_user() recreates a fresh profile.
DELETE FROM members    WHERE user_id IN (SELECT uid FROM _target);
DELETE FROM profiles   WHERE id      IN (SELECT uid FROM _target);
DELETE FROM auth.users WHERE id      IN (SELECT uid FROM _target);
-- <<< HARD ONLY --------------------------------------------------------------

COMMIT;
