-- FamilyHub · reset-test-user · APPLY (destructive, one transaction)
-- The skill substitutes __EMAIL__ before running. For SOFT mode it strips the
-- block between the "HARD ONLY" markers (keeps the auth.users account alive).
-- Deletes only families the account SOLELY owns; a real/shared membership aborts.
BEGIN;

CREATE TEMP TABLE _target ON COMMIT DROP AS
  SELECT id AS uid, email FROM auth.users WHERE lower(email) = lower('__EMAIL__');

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM _target) THEN
    RAISE EXCEPTION 'reset-test-user: no auth user for email __EMAIL__ — nothing done';
  END IF;
END $$;

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

-- Family-scoped data, deleted leaf-first (respects RESTRICT/NO-ACTION FKs).
DELETE FROM transaction_photos WHERE family_id IN (SELECT id FROM _purge);
DELETE FROM reactions          WHERE family_id IN (SELECT id FROM _purge);
DELETE FROM transactions       WHERE family_id IN (SELECT id FROM _purge);
DELETE FROM category_budgets   WHERE family_id IN (SELECT id FROM _purge);
DELETE FROM monthly_budgets    WHERE family_id IN (SELECT id FROM _purge);
DELETE FROM event_fundings     WHERE family_id IN (SELECT id FROM _purge);
DELETE FROM event_memories     WHERE family_id IN (SELECT id FROM _purge);
DELETE FROM savings_entries    WHERE family_id IN (SELECT id FROM _purge);
DELETE FROM saving_goals       WHERE family_id IN (SELECT id FROM _purge);
DELETE FROM events             WHERE family_id IN (SELECT id FROM _purge);
DELETE FROM incomes            WHERE family_id IN (SELECT id FROM _purge);
DELETE FROM categories         WHERE family_id IN (SELECT id FROM _purge);
DELETE FROM member_weather     WHERE family_id IN (SELECT id FROM _purge);
DELETE FROM push_subscriptions WHERE family_id IN (SELECT id FROM _purge);
DELETE FROM request_reviews    WHERE family_id IN (SELECT id FROM _purge);
DELETE FROM passcode_attempts  WHERE family_id IN (SELECT id FROM _purge);
DELETE FROM invitations        WHERE family_id IN (SELECT id FROM _purge);
DELETE FROM family_key_wraps   WHERE family_id IN (SELECT id FROM _purge);
DELETE FROM family_keys        WHERE family_id IN (SELECT id FROM _purge);
DELETE FROM members            WHERE family_id IN (SELECT id FROM _purge);

-- NOTE: media blobs in the `family-media` bucket ({family_id}/... prefix) are NOT
-- deleted here. Direct DELETE on storage.objects is blocked by the storage.protect_delete()
-- trigger ("Direct deletion from storage tables is not allowed"), and would roll back this
-- whole transaction. Media is purged out-of-band via the Storage API — see SKILL.md step 3.5.
-- (Orphaned blobs under a deleted family_id are harmless for test resets; most test
--  families have 0 photos anyway — the dry run's `photos` count tells you.)

-- Detach the profile from any purged family, then drop the families themselves.
UPDATE profiles SET family_id = NULL WHERE family_id IN (SELECT id FROM _purge);
DELETE FROM families WHERE id IN (SELECT id FROM _purge);

-- Any passcode-attempt rows keyed to the user directly.
DELETE FROM passcode_attempts WHERE user_id IN (SELECT uid FROM _target);

-- >>> HARD ONLY (strip this block for --soft) --------------------------------
-- Remove the account itself so the next Google sign-in mints a brand-new user id
-- and handle_new_user() recreates a fresh profile.
DELETE FROM members    WHERE user_id IN (SELECT uid FROM _target);
DELETE FROM profiles   WHERE id      IN (SELECT uid FROM _target);
DELETE FROM auth.users WHERE id      IN (SELECT uid FROM _target);
-- <<< HARD ONLY --------------------------------------------------------------

COMMIT;
