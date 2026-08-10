-- FamilyHub · reset-test-user · DRY RUN (read-only, deletes nothing)
-- The skill substitutes __EMAIL__ with the target address before running.
WITH t AS (
  SELECT id AS uid, email FROM auth.users WHERE lower(email) = lower('__EMAIL__')
),
p AS (   -- families the account SOLELY owns (no other real user is a member) → safe to purge
  SELECT f.id, f.name, f.created_at
  FROM families f, t
  WHERE f.owner_id = t.uid
    AND NOT EXISTS (
      SELECT 1 FROM members m
      WHERE m.family_id = f.id
        AND m.user_id IS NOT NULL
        AND m.user_id <> t.uid
    )
)
SELECT
  (SELECT uid   FROM t) AS user_id,                 -- NULL here = email not found, abort
  (SELECT email FROM t) AS email,
  (SELECT count(*) FROM p) AS families_to_delete,
  (SELECT json_agg(json_build_object(
      'family_id',   p.id,
      'name',        p.name,
      'created_at',  p.created_at,
      'members',     (SELECT count(*) FROM members            x WHERE x.family_id = p.id),
      'transactions',(SELECT count(*) FROM transactions       x WHERE x.family_id = p.id),
      'photos',      (SELECT count(*) FROM transaction_photos x WHERE x.family_id = p.id),
      'events',      (SELECT count(*) FROM events             x WHERE x.family_id = p.id),
      'saving_goals',(SELECT count(*) FROM saving_goals       x WHERE x.family_id = p.id)
   )) FROM p) AS families_detail,
  -- PROTECTED: real/shared families the account belongs to but does NOT solely own.
  -- If this is non-null the skill MUST abort — these are left untouched.
  (SELECT json_agg(json_build_object('family_id', m.family_id, 'name', f.name))
     FROM members m JOIN families f ON f.id = m.family_id, t
    WHERE m.user_id = t.uid
      AND m.family_id NOT IN (SELECT id FROM p)) AS protected_shared_memberships;
