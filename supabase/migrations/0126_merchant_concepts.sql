-- Per-merchant category cache (#2): classify each distinct merchant ONCE, reuse
-- forever. This is what keeps the free-tier Gemini spend flat — the number of
-- classify calls is bounded by the number of *new distinct merchants* ever seen,
-- not by transaction volume.
--
-- Global, not family-scoped: "AEON → Shopping" is universal, and a row carries
-- only a hashed merchant key + one of the 8 concept labels — no amount, no memo,
-- nothing that identifies a family. Service-role only (the mailbox worker reads
-- and writes it); RLS is on with no policy, so anon/authenticated cannot see it.
--
-- concept NULL is a deliberate NEGATIVE cache: "the model ran and could not tell"
-- (an opaque gateway code like REVI). A row-that-exists means "already tried" and
-- we never call the model for that merchant again — a user correction (0127),
-- which outranks this table, is how such a merchant still gets a real concept.
create table if not exists public.merchant_concepts (
  merchant_hash text primary key,            -- sha256 hex of the normalized merchant key
  concept       text,                        -- one of the 8 concepts, or NULL = tried-and-unclassifiable
  source        text not null default 'llm', -- provenance: 'llm'
  updated_at    timestamptz not null default now()
);

alter table public.merchant_concepts enable row level security;
-- No policy on purpose: only service_role (which bypasses RLS) touches this table.
