-- Which kind of spending a merchant represents.
--
-- The transaction-parser function reads a merchant off a mail; what KIND of
-- spending that is — ăn uống, đi lại, hóa đơn — is not printed anywhere in the
-- mail and has to be inferred from the merchant name. This table is where that
-- inference is cached, so the model is asked once per merchant rather than
-- once per transaction. Same bargain as 0071_email_parse_templates: learn it
-- once, then stop paying for it.
--
-- Keyed on the MERCHANT, not on the template. A merchant turns up in several
-- of a sender's templates and a template carries many merchants, so a category
-- stored against a template would be wrong for most of the mail it was applied
-- to.
--
-- NOT family-scoped, deliberately, and for the same reason as 0071: "Highlands
-- Coffee is ăn uống" is true for every household. That is only safe because a
-- row here holds a merchant name and a label, and no transaction data — no
-- amount, no date, no account, and nothing that ties a merchant to a family.

create table if not exists public.merchant_categories (
  id           bigint generated always as identity primary key,

  -- The merchant as the parser normalises it: whitespace squashed and
  -- case-folded, so GRAB / Grab / 'grab  ' are one row rather than three that
  -- can disagree. Stored already-normalised because the lookup is an equality
  -- match on this column and a mismatch is a silent cache miss.
  merchant     text        not null,

  -- One of the categories in parser/category.py. Text rather than an enum: the
  -- list is a product decision that will change, and adding a value to a
  -- Postgres enum takes a migration while the application already rejects an
  -- unknown label on read (see category._known).
  category     text        not null,

  -- Which model proposed it, for auditing a category that turns out to be
  -- wrong. Null when a human wrote the row.
  model        text,

  -- Operational counters, the same pair 0071 keeps and for the same reason:
  -- the only way to answer "is this row still used, or is it a merchant the
  -- household stopped shopping at a year ago".
  hit_count    bigint      not null default 0,
  last_used_at timestamptz,

  created_at   timestamptz not null default now(),

  constraint merchant_categories_merchant_not_blank
    check (length(btrim(merchant)) > 0),

  -- Normalisation is the application's job, but a row that arrives unfolded
  -- would never be found again, so the shape is enforced here too.
  constraint merchant_categories_merchant_normalised
    check (merchant = lower(btrim(merchant))),

  constraint merchant_categories_category_not_blank
    check (length(btrim(category)) > 0)
);

comment on table public.merchant_categories is
  'Cached merchant -> spending category. Shared across families; contains no transaction data.';
comment on column public.merchant_categories.merchant is
  'Merchant name, whitespace-squashed and lowercased by parser/category.normalise.';
comment on column public.merchant_categories.category is
  'A value from parser/category.CATEGORIES. Not an enum: the list is a product decision that changes.';

-- One category per merchant, and the thing two concurrent invocations collide
-- on rather than interleave through. Both can categorise the same merchant at
-- the same moment and propose the same answer; the unique index settles it
-- without either raising.
create unique index if not exists merchant_categories_merchant_uniq
  on public.merchant_categories (merchant);

-- Row level security -------------------------------------------------------
--
-- Written and read only by the transaction-parser function, which connects as
-- service_role. RLS on with NO policies: every row is invisible to any role
-- subject to it, so a client reaching PostgREST with an anon or user JWT sees
-- nothing. service_role has BYPASSRLS and is unaffected.
--
-- Supabase's `alter default privileges` grant ALL to anon and authenticated on
-- every newly created table in schema public, so a new table is NOT private by
-- default here. The revokes below undo that.

alter table public.merchant_categories enable row level security;

revoke all on public.merchant_categories from anon, authenticated;
revoke all on sequence public.merchant_categories_id_seq from anon, authenticated;

-- BYPASSRLS skips row policies, not table privileges: without these grants the
-- function fails with "permission denied" while every RLS check still passes.
grant usage on schema public to service_role;
grant select, insert, update, delete on public.merchant_categories to service_role;
grant usage, select on sequence public.merchant_categories_id_seq to service_role;
