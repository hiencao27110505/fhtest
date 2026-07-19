-- ============================================================================
-- FamilyHub — 0005 security hardening (applied after get_advisors on 0001-0004)
-- ============================================================================

-- 1. Lock function execution away from anon. Supabase grants EXECUTE to anon
--    DIRECTLY (not via PUBLIC), so 0004's "revoke from public, authenticated"
--    left every function callable by unauthenticated REST clients — including the
--    SECURITY DEFINER writer seed_default_categories (a cross-tenant write hole).
--    Keep only the two RLS-helper functions callable by anon: they return null
--    for an unauthenticated caller and are needed so anon queries don't error when
--    a policy evaluates auth_family_id()/auth_email(). The entrypoints keep their
--    explicit authenticated grant from 0004.
revoke execute on all functions in schema public from anon;
grant  execute on function public.auth_family_id() to anon;
grant  execute on function public.auth_email()     to anon;

-- 2. Pin search_path on the two functions the linter flagged as mutable.
alter function public.set_updated_at() set search_path = '';
alter function public.auth_email()     set search_path = '';

-- 3. Merge the two invitations SELECT policies into one (removes the
--    multiple-permissive-policies warning; identical visibility, OR-combined).
drop policy if exists invitations_select_family  on invitations;
drop policy if exists invitations_select_invitee on invitations;
create policy invitations_select on invitations for select
  using (family_id = auth_family_id() or lower(invited_email) = auth_email());

-- Remaining advisor notes are BY DESIGN and safe:
--   * anon/authenticated can execute the RPC entrypoints (create_family,
--     invite_to_family, accept_invitation) and the RLS helper auth_family_id —
--     that is precisely what the app calls. Not a vulnerability.
-- Deferred perf notes (WARN/INFO, negligible at family scale — revisit if data grows):
--   * auth_rls_initplan: wrap auth.uid()/auth_family_id() as (select …) in policies.
--   * unindexed_foreign_keys: add covering indexes on the composite FKs.
