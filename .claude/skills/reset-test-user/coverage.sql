-- FamilyHub · reset-test-user · COVERAGE INVENTORY (read-only, deletes nothing)
-- Run this FIRST (SKILL.md step 0) whenever you haven't reset in a while. It lists
-- every table the reset must account for, grouped by how it's scoped, so you can
-- eyeball schema drift before running. reset.sql / reset-personal.sql also enforce
-- this at runtime (they ABORT on an unknown table), but seeing the inventory up
-- front turns a mid-run abort into a five-second check.
--
-- Cross-check each row against the DELETE lists in reset.sql (family + user scoped)
-- and reset-personal.sql (personal). Anything new → add it in the correct leaf-first
-- position AND to the matching known-list in the self-check.
SELECT 'family_scoped' AS scope, c.table_name,
       (SELECT string_agg(kcu.column_name, ',')
          FROM information_schema.key_column_usage kcu
          JOIN information_schema.constraint_column_usage ccu ON kcu.constraint_name=ccu.constraint_name
          JOIN information_schema.table_constraints tc ON tc.constraint_name=kcu.constraint_name AND tc.constraint_type='FOREIGN KEY'
         WHERE kcu.table_name=c.table_name AND kcu.table_schema='public'
           AND ccu.table_name IN ('transactions','events','saving_goals','categories','personal_transactions','personal_accounts')
       ) AS fk_to_watch
FROM information_schema.columns c
JOIN information_schema.tables t ON t.table_schema=c.table_schema AND t.table_name=c.table_name AND t.table_type='BASE TABLE'
WHERE c.table_schema='public' AND c.column_name='family_id'
UNION ALL
SELECT 'user_scoped', c.table_name, NULL
FROM information_schema.columns c
JOIN information_schema.tables t ON t.table_schema=c.table_schema AND t.table_name=c.table_name AND t.table_type='BASE TABLE'
WHERE c.table_schema='public' AND c.column_name IN ('user_id','owner_user_id') AND c.table_name NOT LIKE 'personal%'
UNION ALL
SELECT 'personal', t.table_name, NULL
FROM information_schema.tables t
WHERE t.table_schema='public' AND t.table_type='BASE TABLE' AND t.table_name LIKE 'personal%'
ORDER BY 1, 2;
