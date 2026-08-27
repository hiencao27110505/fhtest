-- ============================================================================
-- FamilyHub — 0098: a wider window on reconnect actually reads wider
--
-- THE BUG, as a real user hit it. She reconnected a mailbox and chose 2 days.
-- The grant stored 2, the sheet showed 2, and the queue kept showing 23 days of
-- transactions. Nothing was wrong with the reading — those rows were left over
-- from the 90-day backfill two days earlier — but the product had offered a
-- setting, stored it, echoed it back, and then ignored it.
--
-- `backfill_days` only ever governed the FIRST read: `grant_mailbox_access`
-- deliberately does not reset `backfilled_at` on conflict, because a reconnect
-- happens routinely (a 7-day token expiry under Testing status) and re-reading
-- the whole window each time would spend the model budget again on mail already
-- staged. That is still right. What was missing is that a person asking for
-- MORE history has said something new, and there was no way to act on it.
--
-- THE RULE NOW: widening re-reads, narrowing does nothing.
--
--   * Asked for more than the completed backfill covered → clear `backfilled_at`
--     so the next tick re-reads at the new width. Safe since 0090: every message
--     already dealt with is tombstoned, so a re-read stages only what is genuinely
--     new and cannot resurrect anything promoted.
--   * Asked for the same or less → nothing happens. They already hold more
--     history than they asked for, and re-reading to produce a SMALLER result is
--     work that can only lose.
--
-- WHY A SECOND COLUMN. `backfill_days` is what was last ASKED for; it is
-- overwritten on every reconnect. Comparing against it would make "90 then 2
-- then 90" look like a widening on the third connect when nothing had changed
-- since the first. `backfilled_days` records what the completed read actually
-- COVERED, written by the worker at the same moment it stamps `backfilled_at`,
-- so the comparison is against history rather than against intent.
--
-- Next free migration number after this one: 0099. Verify against
-- `git ls-tree origin/main supabase/migrations/` before claiming it.
-- ============================================================================

alter table public.mailbox_grants
  add column if not exists backfilled_days smallint;

comment on column public.mailbox_grants.backfilled_days is
  'How many days the COMPLETED backfill actually covered, stamped with backfilled_at. Distinct from backfill_days, which is merely what was last asked for — comparing against intent would misread a narrow-then-wide sequence as a widening.';

-- Existing completed grants get their last asked-for window as the best
-- available record. Where that under-states what really ran, the only
-- consequence is that a later reconnect at the true width re-reads once — which
-- costs a listing and stages nothing new, because 0090's tombstones hold.
update public.mailbox_grants
   set backfilled_days = backfill_days
 where backfilled_at is not null
   and backfilled_days is null;

create or replace function public.grant_mailbox_access(
  p_user_id       uuid,
  p_email         text,
  p_token         bytea,
  p_scopes        text default '',
  p_provider      text default 'google',
  p_scope         text default 'personal',
  p_backfill_days int  default 90
)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_member uuid;
  v_family uuid;
  v_id     uuid;
  v_days   smallint := least(365, greatest(1, coalesce(p_backfill_days, 90)))::smallint;
begin
  if p_user_id is null then raise exception 'no_user'; end if;
  if p_token is null or length(p_token) = 0 then raise exception 'no_token'; end if;
  if p_scope not in ('family', 'personal') then raise exception 'bad_scope'; end if;

  select m.id, m.family_id into v_member, v_family
    from members m
    join families f on f.id = m.family_id
   where m.user_id = p_user_id
     and m.is_shared = false
     and m.archived_at is null
     and f.type = 'family'
     and f.archived_at is null
   order by m.created_at
   limit 1;

  if p_scope = 'family' and v_member is null then
    raise exception 'no_member_row';
  end if;

  insert into mailbox_grants (user_id, member_id, family_id, provider, email,
                              refresh_token_enc, scopes, default_scope, backfill_days)
       values (p_user_id, v_member, v_family, p_provider, p_email, p_token, p_scopes, p_scope, v_days)
  on conflict (user_id, provider) do update
     set email             = excluded.email,
         refresh_token_enc = excluded.refresh_token_enc,
         scopes            = excluded.scopes,
         needs_reauth      = false,
         member_id         = excluded.member_id,
         family_id         = excluded.family_id,
         default_scope     = excluded.default_scope,
         backfill_days     = excluded.backfill_days,
         -- WIDENING RE-READS. Cleared only when the new window reaches further
         -- than the completed one actually covered; otherwise left exactly as
         -- it was, so an ordinary reconnect stays free. A NULL backfilled_days
         -- on a completed grant is treated as "unknown, assume narrower", which
         -- errs toward re-reading — the recoverable direction, since a re-read
         -- can only stage mail that is genuinely new.
         backfilled_at     = case
                               when mailbox_grants.backfilled_at is null then null
                               when excluded.backfill_days > coalesce(mailbox_grants.backfilled_days, 0) then null
                               else mailbox_grants.backfilled_at
                             end,
         updated_at        = now()
    returning id into v_id;

  -- history_id is still never touched: overwriting a live cursor skips every
  -- message between it and now, silently.

  return v_id;
end $$;

revoke all on function public.grant_mailbox_access(uuid, text, bytea, text, text, text, int) from public, anon, authenticated;
grant execute on function public.grant_mailbox_access(uuid, text, bytea, text, text, text, int) to service_role;

comment on function public.grant_mailbox_access(uuid, text, bytea, text, text, text, int) is
  'Binds an OAuth grant to a person, with the scope and backfill window they chose. Asking for a WIDER window than the completed backfill covered clears backfilled_at so the next tick re-reads; asking for the same or narrower changes nothing, so an ordinary reconnect after a token expiry stays free.';
