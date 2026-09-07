-- The merchant classifier (#2) now also emits a finer "pool" — coffee / milktea /
-- ride / cinema — so a café the model recognises by name (REVI) gets the coffee
-- notification voice even though its name contains no keyword the fast pool gate
-- (poolOf in notify-copy.mjs) would match. Cached alongside the concept, once per
-- merchant, so it costs no extra model calls.
--
-- NULL pool = "none of those four kinds", which is most merchants.
alter table public.merchant_concepts add column if not exists pool text;
