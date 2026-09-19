-- ---------------------------------------------------------------------------
-- 0143 — take the frozen `account_kind` out of every stored extraction template.
--
-- WHY. `deriveExtractionTemplate` freezes `account_kind` into a shape's template,
-- and the rule that decided it (templates.mjs deriveAccountKind, mirrored in
-- bank-email-pipeline.gs) had two faults, fixed alongside this migration:
--   • a 15–16 digit number was read as a card PAN. VIB account numbers are 15
--     digits, so every VIB account notice that printed its number froze
--     `credit_card`, and the person's real account (••5140) was materialized as a
--     credit card with 341 rows on it (2026-09-19).
--   • "dư nợ" anywhere meant card, so the account-side "Thanh toán thẻ tín dụng
--     thành công" (which shows the card's debt after payment) froze `credit_card`
--     too, although the money moved on the account.
-- 9 of the 18 stored templates carry the static. A fixed rule does nothing for
-- them: apply() copies `tpl.static` key by key and never re-derives.
--
-- STRIP, NOT PURGE — 0104's reasoning, unchanged: deleting one key leaves every
-- working anchor intact, and `_fillAccountKind` (extract.mjs) then derives the
-- kind PER MAIL from the mail's own words under the fixed rule, at no model cost.
-- A shape re-freezes the key only on a fresh derivation, which needs a model call
-- these shapes will not make again; per-mail derivation is the steady state.
--
-- Safe by 0099's reasoning: this table is a CACHE. The worst outcome of a wrong
-- edit is a relearn, never a wrong ledger row. MATERIALIZED as in 0104: the cast
-- must not run before the `like '{%'` guard on a legacy plain-regex row.
--
-- APPLIED live 2026-09-19 together with the mailbox-sync redeploy (v51).
-- Next free migration number after this one: 0144. Verify against
-- `git ls-tree origin/main supabase/migrations/` and AGENT_SYNC.md before claiming it.
-- ---------------------------------------------------------------------------
begin;

with candidates as materialized (
  select id, extraction_regex
    from public.sender_fingerprints
   where extraction_regex is not null
     and extraction_regex like '{%'
)
update public.sender_fingerprints f
   set extraction_regex = ((c.extraction_regex::jsonb) #- '{static,account_kind}')::text
  from candidates c
 where f.id = c.id
   and jsonb_exists((c.extraction_regex::jsonb) -> 'static', 'account_kind');

commit;
