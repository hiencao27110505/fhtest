-- ============================================================================
-- FamilyHub — 0045: drop the one-time claim-link machinery (0044)
--
-- Product decision: the shared card link/QR are just the self-contained card in
-- another format (opaque base64 in the fragment, but still the key), not an
-- ephemeral server-parked pointer. So the claim table + RPCs from 0044 are
-- unused — remove them. Regenerating the card (rotate_family_card) is what kills
-- a leaked link/QR now.
-- ============================================================================
drop function if exists public.create_card_claim(text, text, int);
drop function if exists public.redeem_card_claim(text);
drop table if exists public.card_claims;
