-- 0155_item_signatures — receipt-enrichment-spec.md §20 (Phase 2).
--
-- What a receipt item IS, learned once per TYPE and replayed free — the same
-- economics as a stored email template. The key is never a product title and
-- never per-person: a head-noun phrase of a listing ("hn|mu boi", "hn|noi
-- chien"), an Apple storefront+content slot ("apple|apple tv|movie rental")
-- or an Apple vendor ("apple|vendor|youtube"). That is type-level vocabulary,
-- the same class of data merchant_concepts already holds — so it may be
-- shared across users, where a product title (someone's shopping list) may
-- not, and Phase 0 stopped storing those.
--
-- A row is an answer. A row whose node is NULL is "asked, unknowable" and is
-- not asked again on the same logic_version; bumping CATEGORY_LOGIC_VERSION
-- (item-category.mjs) makes every older row a miss, so a better prompt can
-- re-learn without a data migration. Written by the worker only; the device
-- never reads this table — it reads the node the worker sealed into the item.

create table if not exists public.item_signatures (
  key           text primary key,
  node          text,                        -- taxonomy code, or null = unknowable
  logic_version integer not null default 1,
  source        text not null default 'llm', -- 'llm' | 'keyword' (the proof-gate agreement)
  seen          integer not null default 1,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

alter table public.item_signatures enable row level security;
-- Service role only. No policy = no client access; the worker uses the
-- service key. Nothing personal is here, but nothing here is the client's
-- business either: the sealed item carries what the client needs.
revoke all on public.item_signatures from anon, authenticated;
