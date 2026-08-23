-- ============================================================================
-- FamilyHub — 0071: provable PDPL consent + mailbox disconnect
--
-- Two halves of one legal promise (docs/PDPL-COMPLIANCE.md §4, ship-blockers
-- 1 and 3). Consent for sensitive-data processing must be PROVABLE — a stored
-- record of who affirmed which text version, when — and withdrawable, which
-- needs a disconnect a user can perform themselves instead of a founder SQL
-- lever. Apply BEFORE the client that references them ships: the consent gate
-- fails closed to re-asking, but the agree action cannot complete without
-- this table, which would lock the connect flows.
--
-- Next free migration number after this one: 0072. Verify against
-- `git ls-tree origin/main supabase/migrations/` — this range has collided
-- six times now (0070 was taken by family_save_goal mid-week).
-- ============================================================================

-- One row per (user, consent kind, text version). Re-consent after a text
-- change inserts a NEW row rather than updating — the history is the proof,
-- and "which version did they see" must survive later versions shipping.
create table public.user_consents (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null default auth.uid() references auth.users (id) on delete cascade,
  kind         text not null,              -- 'bank_email' covers both connect paths (forwarding + OAuth)
  version      int  not null,              -- consent_v of the text the person affirmed
  consented_at timestamptz not null default now(),
  unique (user_id, kind, version)
);

comment on table public.user_consents is
  'Affirmative-consent records (PDPL). The row IS the proof: the person chủ động xác nhận đồng ý to text version N of the named consent. Never updated, never deleted by the app; withdrawal is recorded by the disconnect action, not by removing history.';

alter table public.user_consents enable row level security;

-- Initplan form, per the 0022 rule: auth helpers wrapped in (select ...).
create policy user_consents_select_own on public.user_consents
  for select to authenticated
  using (user_id = (select auth.uid()));

create policy user_consents_insert_own on public.user_consents
  for insert to authenticated
  with check (user_id = (select auth.uid()));

-- ----------------------------------------------------------------------------
-- Withdrawal: disconnect my mailbox, and honor the 72-hour deletion promise
-- immediately rather than within it. Deletes the caller's OWN connection and
-- their OWN pending staged rows; sealed and plaintext alike (id-scoped, no
-- content needed). Reviewed rows already left the table at promotion (0060).
-- Routing reads mailbox_connections, so mail arriving after this holds as
-- unroutable and ages out under ROUTING_GRACE_DAYS — the UI's companion step
-- tells the person to delete their Gmail forwarding rule, which is the half
-- only they can do.
create or replace function public.disconnect_my_mailbox()
returns json
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_member uuid;
  v_conns int; v_rows int;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  select id into v_member from members
   where user_id = v_uid and is_shared = false limit 1;
  if v_member is null then raise exception 'no_member_row'; end if;

  delete from email_transactions
   where member_id = v_member and review_status = 'pending';
  get diagnostics v_rows = row_count;

  delete from mailbox_connections where member_id = v_member;
  get diagnostics v_conns = row_count;

  return json_build_object('connections', v_conns, 'pending_deleted', v_rows);
end $$;

revoke all on function public.disconnect_my_mailbox() from public;
grant execute on function public.disconnect_my_mailbox() to authenticated;
