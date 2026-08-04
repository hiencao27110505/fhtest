-- ============================================================================
-- FamilyHub — 0040: revoke API EXECUTE on the enc trigger functions
--
-- The security linter flags _fh_enc_guard (0033), _fh_enc_txt_guard (0038) and
-- _fh_photo_enc_guard (0039) as SECURITY DEFINER functions callable through
-- PostgREST by anon/authenticated. Not actually exploitable — Postgres refuses
-- to run a trigger function outside trigger context — but there is no reason
-- for them to be on the API surface at all. Revoking EXECUTE does not affect
-- trigger firing (fire-time execution is not permission-checked against the
-- writing role), matching the lock-everything posture of 0004/0005.
-- ============================================================================

revoke execute on function public._fh_enc_guard()       from public, anon, authenticated;
revoke execute on function public._fh_enc_txt_guard()   from public, anon, authenticated;
revoke execute on function public._fh_photo_enc_guard() from public, anon, authenticated;
