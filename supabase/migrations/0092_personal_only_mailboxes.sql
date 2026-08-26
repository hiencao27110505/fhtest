-- ============================================================================
-- FamilyHub — 0092: a mailbox belongs to a PERSON; a family is optional
--
-- TWO DECISIONS, both taken deliberately.
--
-- 1. PERSONAL-ONLY USERS MUST BE ABLE TO CONNECT. `grant_mailbox_access` (0087)
--    refused anyone without a member row in a real family, because when it was
--    written a mailbox could only feed a family ledger. Since Model Y the person
--    is the root and a family is an optional container they direct money to, so
--    that refusal now excludes exactly the users the feature helps most: someone
--    tracking their own money who has not joined a household.
--
-- 2. PERSONAL IS THE DEFAULT SEAL. `default_scope` flips from 'family' to
--    'personal' for NEW grants. The asymmetry is the whole argument: a row
--    sealed to the person can still be promoted outward to the family ledger at
--    review — the client opens it with the personal key and re-encrypts under
--    the family DEK. A row sealed to the family CANNOT be pulled back, because
--    the household has already been able to open it. Over-sealing is
--    recoverable; under-sealing is not. So the recoverable mistake is the one to
--    make by default.
--
-- WHAT THIS MEANS FOR SCOPING, and it is the substantive change here.
--
-- `email_transactions` was scoped by `member_id` alone (0058). A row belonging
-- to someone with no member row would be visible to NOBODY — the RLS predicate
-- would simply never match — which is a silent, unrecoverable kind of loss: the
-- transaction stages, the queue stays empty, and nothing anywhere says why.
--
-- So ownership moves to `owner_user_id`, which every staged row can carry
-- regardless of family. `member_id` stays, unchanged and still populated for
-- anyone who has one, because the forwarding transport routes by it and dedup
-- reads it. The policies accept EITHER, so nothing that worked before stops.
--
-- Next free migration number after this one: 0093. Verify against
-- `git ls-tree origin/main supabase/migrations/` before claiming it.
-- ============================================================================

-- ── 1. ownership that does not require a family ─────────────────────────────

alter table public.email_transactions
  add column if not exists owner_user_id uuid references auth.users (id) on delete cascade;

comment on column public.email_transactions.owner_user_id is
  'The person this staged row belongs to. Set on every row the direct-read worker writes; NULL on older forwarding rows, which are scoped by member_id instead. Either one grants the owner read access.';

-- Backfill from the member, so existing rows gain an owner without changing who
-- can see them. Deliberately not enforced NOT NULL: forwarding rows are written
-- by the Apps Script, which has no user id to hand, and failing their insert
-- would stop the other transport dead.
update public.email_transactions t
   set owner_user_id = m.user_id
  from public.members m
 where t.member_id = m.id
   and t.owner_user_id is null;

create index if not exists email_transactions_owner_idx
  on public.email_transactions (owner_user_id, review_status)
  where owner_user_id is not null;

-- ── 2. the same for the resolved-message tombstones (0090) ──────────────────
--
-- Same reasoning: a personal-only user has no member id to key on, and a
-- tombstone that cannot be written is a message that comes back forever.

alter table public.resolved_email_messages
  add column if not exists owner_user_id uuid references auth.users (id) on delete cascade;

update public.resolved_email_messages r
   set owner_user_id = m.user_id
  from public.members m
 where r.member_id = m.id
   and r.owner_user_id is null;

-- Re-keyed on the OWNER. The old primary key was (member_id, gmail_message_id)
-- with member_id NOT NULL, so a personal-only user could not write a tombstone
-- at all — and a tombstone that cannot be written is a message that comes back
-- on every wide read, forever. owner_user_id is always known at resolve time
-- (it is auth.uid()), which member_id is not.
--
-- Backfilled above, so this can be NOT NULL immediately. Any row that somehow
-- has no owner would be one no policy could match anyway.
-- ORDER MATTERS: member_id cannot lose NOT NULL while it is still part of the
-- primary key, so the old key goes first. Postgres refuses the other order with
-- "column is in a primary key", which is the right refusal at the wrong moment.
alter table public.resolved_email_messages
  drop constraint if exists resolved_email_messages_pkey;

alter table public.resolved_email_messages alter column owner_user_id set not null;
alter table public.resolved_email_messages alter column member_id drop not null;

alter table public.resolved_email_messages
  add primary key (owner_user_id, gmail_message_id);

comment on column public.resolved_email_messages.owner_user_id is
  'Owner of the resolution, and the key this table is scoped by. member_id is kept as routing metadata for people who have one, but it is not what makes a row unique — a personal-only user has none.';

-- ── 3. RLS: either key opens the door ───────────────────────────────────────
--
-- REPLACED rather than added-alongside: two permissive SELECT policies OR
-- together anyway, and one predicate that states the whole rule is easier to
-- verify than two that must be read as a pair.

drop policy if exists email_transactions_own_select on public.email_transactions;

create policy email_transactions_own_select on public.email_transactions
  for select to authenticated
  using (
    (owner_user_id is not null and owner_user_id = (select auth.uid()))
    or (member_id is not null and member_id in (
          select m.id from public.members m where m.user_id = (select auth.uid())))
  );

comment on policy email_transactions_own_select on public.email_transactions is
  'Own rows only, by owner OR by member. Two keys because a personal-only user has no member row and a forwarding row has no owner; requiring both would lock one of them out. Initplan form per 0022.';

drop policy if exists resolved_email_messages_select_own on public.resolved_email_messages;

create policy resolved_email_messages_select_own on public.resolved_email_messages
  for select to authenticated
  using (
    (owner_user_id is not null and owner_user_id = (select auth.uid()))
    or (member_id is not null and member_id in (
          select m.id from public.members m where m.user_id = (select auth.uid())))
  );

-- ── 4. a grant no longer needs a family ─────────────────────────────────────

alter table public.mailbox_grants alter column member_id drop not null;
alter table public.mailbox_grants alter column family_id drop not null;

comment on column public.mailbox_grants.member_id is
  'The member this mailbox routes to, when the person is in a family. NULL for a personal-only user — their rows are scoped by owner_user_id instead.';

-- Personal by default, per the asymmetry argument in the header. Existing rows
-- keep whatever they already have: this changes what a NEW grant means, not
-- what an old one meant.
alter table public.mailbox_grants alter column default_scope set default 'personal';

-- ── 5. the grant RPC, rewritten ─────────────────────────────────────────────
--
-- The member lookup is unchanged where it applies — including `order by
-- m.created_at`, which is what stops a second members row (Model Y gave everyone
-- one) turning `limit 1` into a coin flip that binds a mailbox to the wrong
-- family. What changes is that finding nothing is now a valid outcome rather
-- than an exception.

create or replace function public.grant_mailbox_access(
  p_user_id  uuid,
  p_email    text,
  p_token    bytea,
  p_scopes   text default '',
  p_provider text default 'google',
  p_scope    text default 'personal'
)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_member uuid;
  v_family uuid;
  v_id     uuid;
begin
  if p_user_id is null then raise exception 'no_user'; end if;
  if p_token is null or length(p_token) = 0 then raise exception 'no_token'; end if;
  if p_scope not in ('family', 'personal') then raise exception 'bad_scope'; end if;

  -- The member this person is in a REAL family, if any.
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

  -- A family-scoped mailbox still needs one: there would be no key to seal to
  -- and no ledger to promote into. This is the ONLY case that still refuses,
  -- and it is a product state the app explains rather than a fault.
  if p_scope = 'family' and v_member is null then
    raise exception 'no_member_row';
  end if;

  insert into mailbox_grants (user_id, member_id, family_id, provider, email,
                              refresh_token_enc, scopes, default_scope)
       values (p_user_id, v_member, v_family, p_provider, p_email, p_token, p_scopes, p_scope)
  on conflict (user_id, provider) do update
     set email             = excluded.email,
         refresh_token_enc = excluded.refresh_token_enc,
         scopes            = excluded.scopes,
         needs_reauth      = false,
         member_id         = excluded.member_id,
         family_id         = excluded.family_id,
         default_scope     = excluded.default_scope,
         updated_at        = now()
    returning id into v_id;

  -- history_id and backfilled_at are deliberately NOT touched on conflict.
  -- Overwriting a live cursor skips every message between it and now; clearing
  -- backfilled_at re-stages the whole window. Both are silent.

  return v_id;
end $$;

revoke all on function public.grant_mailbox_access(uuid, text, bytea, text, text, text) from public, anon, authenticated;
grant execute on function public.grant_mailbox_access(uuid, text, bytea, text, text, text) to service_role;

comment on function public.grant_mailbox_access(uuid, text, bytea, text, text, text) is
  'Binds an OAuth grant to a person, and to their member + family when they have one. Refuses only a FAMILY-scoped grant from someone with no family, since there would be no key to seal to. Personal scope needs no family at all.';

-- The five-argument form is dropped so no caller can reach the old behaviour by
-- omitting the scope and silently getting a family-sealed mailbox.
drop function if exists public.grant_mailbox_access(uuid, text, bytea, text, text);

-- ── 6. resolving works without a member too ─────────────────────────────────

create or replace function public.resolve_email_transactions(p_ids uuid[])
returns int
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_deleted int;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  if p_ids is null or array_length(p_ids, 1) is null then return 0; end if;

  -- Record first: a failed insert rolls back and keeps the staged row, which is
  -- the recoverable direction. Losing the row while failing to record it is the
  -- one ordering that cannot be recovered from.
  insert into resolved_email_messages (member_id, owner_user_id, gmail_message_id)
  select t.member_id, coalesce(t.owner_user_id, v_uid), t.gmail_message_id
    from email_transactions t
   where t.id = any(p_ids)
     and t.gmail_message_id is not null
     and (t.owner_user_id = v_uid
          or t.member_id in (select m.id from members m where m.user_id = v_uid))
  on conflict (owner_user_id, gmail_message_id) do nothing;

  delete from email_transactions t
   where t.id = any(p_ids)
     and (t.owner_user_id = v_uid
          or t.member_id in (select m.id from members m where m.user_id = v_uid));

  get diagnostics v_deleted = row_count;
  return v_deleted;
end $$;

revoke execute on function public.resolve_email_transactions(uuid[]) from public, anon;
grant  execute on function public.resolve_email_transactions(uuid[]) to authenticated;
