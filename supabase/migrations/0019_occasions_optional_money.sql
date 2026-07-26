-- FamilyHub — 0019: an occasion doesn't have to cost money
--
-- Part of the 3-tab revamp (Nhà / Thu Chi / Khoảnh Khắc). The old model conflated
-- "a savings goal" and "a life occasion" into one required shape: every `events`
-- row had to carry a positive target_amount. The new model treats them as two
-- FACETS of a single row:
--   • money facet  — target_amount IS NOT NULL  → shows in Thu Chi as a goal
--   • moment facet — is_occasion = true          → shows in Khoảnh Khắc as an occasion
-- A row can have either or both, so the money/moments tabs stay in sync with zero
-- linking logic (the "link" between a goal and its occasion is row identity).
--
-- This migration is strictly ADDITIVE / RELAXING. Nothing is dropped or deleted;
-- the existing app keeps working unchanged (it never writes is_occasion — the
-- default covers it — and never writes a null target_amount).

-- 1) The one hard blocker: let a moneyless occasion (e.g. a free picnic you just
--    want to remember) exist. Drop NOT NULL and widen the CHECK to allow NULL.
alter table public.events alter column target_amount drop not null;

alter table public.events drop constraint if exists events_target_amount_check;
alter table public.events add  constraint events_target_amount_check
  check (target_amount is null or target_amount > 0);

-- 2) Make tab membership explicit rather than guessed. A pure saving goal
--    (e.g. an emergency fund) is is_occasion = false; anything people plan or
--    remember is true. Default true so all 20 existing events — which are trips
--    and celebrations — surface in Khoảnh Khắc exactly as before.
alter table public.events add column if not exists is_occasion boolean not null default true;

comment on column public.events.target_amount is
  'Money facet: NULL = a moneyless occasion; > 0 = a savings goal shown in Thu Chi.';
comment on column public.events.is_occasion is
  'Moment facet: true = shown in Khoảnh Khắc as a planned/remembered occasion.';
