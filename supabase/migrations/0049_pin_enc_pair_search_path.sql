-- 0049_pin_enc_pair_search_path.sql
-- Security-lint hygiene. _fh_enc_pair is the shared enc-guard predicate helper called by
-- the _fh_enc_guard / _fh_enc_txt_guard triggers (0033/0038). It was the one function
-- flagged by the advisor with a role-mutable search_path. It does NO name resolution
-- (only argument comparisons + `raise`), so a mutable search_path is not a live
-- vulnerability here — but pinning it clears the advisor and matches the convention every
-- other function in this schema already follows (e.g. get_family_snapshot SET search_path).
-- SECURITY INVOKER + IMMUTABLE + no table access → search_path = '' is safe.
alter function public._fh_enc_pair(text, text, text, text, text, text, text) set search_path = '';
