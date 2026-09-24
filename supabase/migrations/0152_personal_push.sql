-- ============================================================================
-- FamilyHub — 0152: push for personal-only users (activation-journey-spec §8)
--
-- push_subscriptions becomes USER-scoped, with the family pair optional. A
-- famless account (Model Y personal ledger — no members row anywhere) could
-- not save a subscription at all: the client refused ("Hãy mở một gia đình
-- trước"), the insert had nowhere to hang its NOT NULL family/member pair,
-- and the pipeline's "something is waiting" push therefore had NO destination
-- for exactly the solo users the activation journey targets.
--
-- owner_user_id carries `default auth.uid()` on purpose: a client from before
-- this migration inserts without the column and still lands a correctly-owned
-- row, so the schema change never races the big-bang client update.
--
-- The social fan-out is untouched: it selects by family_id, and a personal
-- row (family_id null) can never match. push-send's pipeline branch now
-- resolves the person and sends to owner_user_id, which covers both row
-- shapes.
-- ============================================================================

alter table public.push_subscriptions
  add column if not exists owner_user_id uuid references auth.users(id) on delete cascade default auth.uid();

-- existing rows: the owner is the member's user
update public.push_subscriptions ps
   set owner_user_id = m.user_id
  from public.members m
 where ps.member_id = m.id and ps.owner_user_id is null;
-- any row whose member vanished has no reachable owner and no working endpoint claim
delete from public.push_subscriptions where owner_user_id is null;

alter table public.push_subscriptions alter column owner_user_id set not null;
alter table public.push_subscriptions alter column family_id drop not null;
alter table public.push_subscriptions alter column member_id drop not null;

-- the family pair is all-or-none: a row is either family-seated or personal
alter table public.push_subscriptions drop constraint if exists push_subscriptions_scope_pair;
alter table public.push_subscriptions
  add constraint push_subscriptions_scope_pair check ((family_id is null) = (member_id is null));

create index if not exists push_subscriptions_owner_idx on public.push_subscriptions(owner_user_id);

-- ── RLS: the OWNER is the key; the family clauses stay for seated rows ──────
drop policy if exists push_subscriptions_select on public.push_subscriptions;
drop policy if exists push_subscriptions_insert on public.push_subscriptions;
drop policy if exists push_subscriptions_update on public.push_subscriptions;
drop policy if exists push_subscriptions_delete on public.push_subscriptions;

create policy push_subscriptions_select on public.push_subscriptions for select
  using (owner_user_id = (select auth.uid())
         or family_id = (select public.auth_family_id()));
create policy push_subscriptions_insert on public.push_subscriptions for insert
  with check (
    owner_user_id = (select auth.uid())
    and (family_id is null
         or (family_id = (select public.auth_family_id())
             and member_id in (select id from public.members where user_id = (select auth.uid())))));
create policy push_subscriptions_update on public.push_subscriptions for update
  using (owner_user_id = (select auth.uid()))
  with check (
    owner_user_id = (select auth.uid())
    and (family_id is null
         or (family_id = (select public.auth_family_id())
             and member_id in (select id from public.members where user_id = (select auth.uid())))));
create policy push_subscriptions_delete on public.push_subscriptions for delete
  using (owner_user_id = (select auth.uid()));
