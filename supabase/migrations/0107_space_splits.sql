-- 0107_space_splits.sql
-- Shared split state for friend/trip spaces (docs/specs/borrowing-lending-spec.md §5, §10.2).
--
-- A split must be SHARED truth — per-person tracking desyncs the moment two
-- people enter different numbers (spec Q6). So shares and settle-ups live in
-- the space, encrypted under the space DEK all members hold. Group balance is
-- DERIVED per member from {transactions + txn_shares} − {settle_ups}; nothing
-- stored (Q5 discipline). Settle-ups are unilateral, trust-based (Q11) —
-- either member can author one; it's a friends ledger, not escrow.

create table if not exists public.txn_shares (
  id              uuid primary key default gen_random_uuid(),
  family_id       uuid not null references public.families(id) on delete cascade,
  txn_id          uuid not null references public.transactions(id) on delete cascade,
  payer_member_id uuid references public.members(id) on delete set null,
  rule            text not null default 'equal' check (rule in ('equal','exact')),
  shares_enc      text,          -- JSON {member_id: amountK} ciphertext, space DEK
  version         int not null default 1,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (txn_id)
);
create index if not exists txn_shares_family_idx on public.txn_shares (family_id);

create table if not exists public.settle_ups (
  id                uuid primary key default gen_random_uuid(),
  family_id         uuid not null references public.families(id) on delete cascade,
  from_member       uuid not null references public.members(id) on delete cascade,
  to_member         uuid not null references public.members(id) on delete cascade,
  amount_enc        text not null, -- space-DEK ciphertext
  note_enc          text,
  settle_date       date not null default current_date,
  created_by        uuid references auth.users(id) on delete set null,
  transfer_group_id uuid,          -- a captured personal transfer leg can reconcile here (Q10)
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  check (from_member <> to_member)
);
create index if not exists settle_ups_family_idx on public.settle_ups (family_id);

alter table public.txn_shares enable row level security;
alter table public.settle_ups enable row level security;

-- Same reach as the widened transactions surface: the active family OR any
-- friend/trip space I'm a member of (auth_space_ids, 0106). Family_id is
-- included so a future family-side "who paid" feature needs no new policy.
drop policy if exists txn_shares_all on public.txn_shares;
create policy txn_shares_all on public.txn_shares
  for all to authenticated
  using (family_id = (select auth_family_id()) or family_id in (select auth_space_ids()))
  with check (family_id = (select auth_family_id()) or family_id in (select auth_space_ids()));

drop policy if exists settle_ups_all on public.settle_ups;
create policy settle_ups_all on public.settle_ups
  for all to authenticated
  using (family_id = (select auth_family_id()) or family_id in (select auth_space_ids()))
  with check (family_id = (select auth_family_id()) or family_id in (select auth_space_ids()));

drop trigger if exists txn_shares_touch on public.txn_shares;
create trigger txn_shares_touch
  before update on public.txn_shares
  for each row execute function public.set_updated_at();

drop trigger if exists settle_ups_touch on public.settle_ups;
create trigger settle_ups_touch
  before update on public.settle_ups
  for each row execute function public.set_updated_at();
