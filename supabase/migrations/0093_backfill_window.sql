-- ============================================================================
-- FamilyHub — 0093: let the person choose how far back to read
--
-- The first read of a mailbox used a constant 90 days. That number moved from
-- 90 to 15 and back in a single afternoon because it is genuinely a judgement
-- call and it is not OURS to make: someone who has been running a household on
-- spreadsheets wants a year; someone trying the feature out wants a fortnight
-- and is annoyed by 52 rows arriving at once. The person knows which they are.
--
-- THE CEILING IS 365 DAYS, AND IT IS OURS, NOT GMAIL'S.
--
-- Gmail's `newer_than:` operator has no documented limit — it searches whatever
-- is in the mailbox, and accepts d/m/y. So nothing on Google's side stops us
-- asking for five years. Three things on ours do:
--
--   * `listMessageIds` stops at `LIST_MAX_PER_RUN`, and Gmail returns
--     newest-first. A staged message still MATCHES the query, so it keeps
--     occupying a slot in that first page forever — which means a window
--     yielding more than the cap leaves its oldest tail permanently
--     unreachable. Not slow: invisible. The cap is raised for backfills
--     alongside this, and 365 days is what the raised cap comfortably covers at
--     the busiest real rate observed (~66 transactions a month).
--   * Every row lands in a review queue a person has to work through by hand.
--   * A purchase from two years ago is the hardest to remember and the least
--     likely to be corrected accurately, so its value falls off faster than its
--     cost does.
--
-- Stored per grant rather than read from a config, because it is a property of
-- how this person set THIS mailbox up, and because changing the global default
-- later must not silently re-read anyone's history.
--
-- Next free migration number after this one: 0094. Verify against
-- `git ls-tree origin/main supabase/migrations/` before claiming it.
-- ============================================================================

alter table public.mailbox_grants
  add column if not exists backfill_days smallint not null default 90
    constraint mailbox_grants_backfill_days_chk check (backfill_days between 1 and 365);

comment on column public.mailbox_grants.backfill_days is
  'How many days back the FIRST read of this mailbox reaches. Chosen at connect. Ceiling 365 is ours, not Gmail''s: past it the list cap leaves the oldest messages unreachable rather than merely slow. Ignored once backfilled_at is set — an ordinary poll measures from last_synced_at.';

-- ── carried through the connect RPC ─────────────────────────────────────────
--
-- Defaulted so an older caller that omits it still gets the 90 it always got,
-- and CLAMPED rather than rejected: a client sending 5000 has a bug, and
-- refusing the whole connect over it would cost the person their mailbox to
-- punish a mistake they cannot see. Clamping keeps them connected with a window
-- we can actually serve.

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
         updated_at        = now()
    returning id into v_id;

  -- history_id and backfilled_at are still deliberately NOT touched on conflict.
  -- A reconnect that reset backfilled_at would re-read the whole window, which
  -- after 0090 no longer duplicates anything but does spend the model budget
  -- again for no new transactions.

  return v_id;
end $$;

revoke all on function public.grant_mailbox_access(uuid, text, bytea, text, text, text, int) from public, anon, authenticated;
grant execute on function public.grant_mailbox_access(uuid, text, bytea, text, text, text, int) to service_role;

comment on function public.grant_mailbox_access(uuid, text, bytea, text, text, text, int) is
  'Binds an OAuth grant to a person, with the scope and backfill window they chose. backfill_days is clamped to 1..365 rather than rejected: a bad value is a client bug, and refusing the connect would cost the person their mailbox to punish it.';

-- The six-argument form goes, so no caller can reach the old behaviour by
-- omitting the window and silently getting 90.
drop function if exists public.grant_mailbox_access(uuid, text, bytea, text, text, text);
