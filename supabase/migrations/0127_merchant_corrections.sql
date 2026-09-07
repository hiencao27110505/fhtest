-- User-taught merchant→concept (#3), synced up from the device the moment a user
-- picks a category for a transaction in review. This is what fixes opaque
-- merchants (REVI and friends) after ONE human label: the next email from that
-- merchant is voiced with her concept instead of falling to generic copy.
--
-- Privacy: only a HASHED merchant key and one of the 8 concept labels ever leave
-- the device — never the plaintext merchant name, never an amount. The hash is
-- sha256 of the same normalized key the client and the mailbox worker both derive
-- (see fhMerchantKey in the client and merchantKey in classify.mjs — they MUST
-- stay in lockstep or a correction will not match on the read side).
--
-- Owner-scoped: a correction is a personal lesson (the mailbox owner's), so the
-- worker reads it for that user only, and RLS lets the device write/read just its
-- own rows.
create table if not exists public.merchant_corrections (
  owner_user_id uuid        not null references auth.users(id) on delete cascade,
  merchant_hash text        not null,        -- sha256 hex, same derivation as merchant_concepts
  concept       text        not null,        -- one of the 8 concepts
  updated_at    timestamptz not null default now(),
  primary key (owner_user_id, merchant_hash)
);

alter table public.merchant_corrections enable row level security;

create policy merchant_corrections_owner
  on public.merchant_corrections
  for all
  using (auth.uid() = owner_user_id)
  with check (auth.uid() = owner_user_id);
