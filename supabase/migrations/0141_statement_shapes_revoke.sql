-- ---------------------------------------------------------------------------
-- 0141 — statement_shapes is service_role only, and its privileges now say so.
--
-- 0139 created the table with RLS on and no policy, which already hides every row
-- from anon and authenticated (the same posture as sender_fingerprints and
-- merchant_concepts). What it did NOT do is revoke Supabase's default table grants,
-- so `information_schema.role_table_grants` still listed INSERT/UPDATE/DELETE for
-- both roles -- harmless behind RLS, but a privilege list that contradicts the
-- design is one policy mistake away from mattering. Found by checking the live
-- database after applying 0139, not by reading the migration.
--
-- APPLIED live 2026-09-19 together with 0139 and 0140.
--
-- Next free migration number after this one: 0142. Verify against
-- `git ls-tree origin/main supabase/migrations/` and AGENT_SYNC.md before claiming it.
-- ---------------------------------------------------------------------------
revoke all on public.statement_shapes from anon, authenticated;
grant select, insert, update, delete on public.statement_shapes to service_role;
