-- ============================================================================
-- FamilyHub — 0087: direct mailbox read (our own transport)
--
-- Second transport for the bank-email pipeline. Forwarding (0025/0059) has the
-- user point Gmail at an alias we own; this one reads the user's OWN mailbox
-- under an OAuth grant. Everything downstream is unchanged: both transports
-- stage into email_transactions, sealed, and the same review screen promotes
-- them. This migration adds only what the second transport needs to exist.
--
-- WHY OUR OWN TABLE, AND NOT connected_accounts (0070).
-- 0070 is the earthy/ backend's table: provider-agnostic OAuth links plus
-- gmail_sync_state, owned and written by GCP Cloud Functions on a pooler DSN.
-- It answers "which Google account did this auth.users row link". It cannot
-- answer the question this pipeline actually has to answer before it may write
-- a single row: WHICH MEMBER, and therefore which family, and therefore which
-- staging public key. Bolting member_id and family_id onto 0070 would mean two
-- systems writing one table with different lifecycles and different notions of
-- when a link becomes invalid. So this is a separate table with a separate
-- lifecycle, and the two can run side by side without either one having to
-- know the other exists.
--
-- WHY member_id IS BOUND AT CONNECT TIME, NOT RESOLVED AT INGEST TIME.
-- A user can belong to several families (0007), and profiles.family_id is only
-- the ACTIVE one — it changes whenever they switch. Resolving the owner at
-- ingest would mean the same mailbox silently files into whichever family
-- happened to be active when a bank sent mail, and rows sealed to one family's
-- key would be unopenable by the other. Binding at connect makes the mailbox's
-- destination a decision the user made once, visibly. It is the same shape as
-- mailbox_connections.member_id on the forwarding side, for the same reason.
--
-- A personal container is never a valid destination. 0076 made families.type
-- ('family'|'personal'|'friend'|'trip') and the personal ledger is a family row
-- that no family-scoped flow may point at (0073/0079 hardened switch_family and
-- leave_family for exactly this). Enforced below in grant_mailbox_access().
--
-- Next free migration number after this one: 0088. Verify against
-- `git ls-tree origin/main supabase/migrations/` before claiming it — this
-- range has collided repeatedly (0070 and 0071 each exist twice).
-- ============================================================================

-- ── 1. the grant ────────────────────────────────────────────────────────────
--
-- One row per (user, provider). Holds the credential, the destination, and the
-- Gmail cursor together: unlike 0070 this table serves one pipeline, and
-- splitting a cursor into its own table buys nothing when there is exactly one
-- reader and one writer.

create table if not exists public.mailbox_grants (
  id            uuid primary key default gen_random_uuid(),

  -- Who granted. The credential belongs to the person, not to the family.
  user_id       uuid not null references auth.users (id) on delete cascade,

  -- Where its transactions land. Both are captured at connect and never
  -- re-derived: see the header. family_id is denormalised from the member on
  -- purpose — it is what the sealer needs, and re-reading it per message would
  -- silently follow a member moved between families, orphaning every row
  -- already sealed to the old family's key.
  member_id     uuid not null references public.members (id) on delete cascade,
  family_id     uuid not null references public.families (id) on delete cascade,

  provider      text not null default 'google',

  -- The mailbox we were granted. Taken from the provider's own profile call,
  -- never from a login_hint: whoever actually consents is the mailbox we have,
  -- and it can differ from the account the app is signed in as.
  email         text not null,

  -- Encrypted by the worker before it ever reaches Postgres, with a key that
  -- lives outside this database. A refresh token is standing read access to a
  -- whole mailbox until it is revoked, so a database dump must not be a
  -- permanent grant on everyone's mail.
  refresh_token_enc bytea not null,

  -- Space-separated scopes actually granted. A re-consent can narrow them, so
  -- the worker checks rather than assuming what it asked for.
  scopes        text not null default '',

  -- Set when the provider rejects the refresh token: revoked, password change,
  -- or the 7-day expiry that applies while an OAuth app is in Testing status.
  -- A state, not an error — the worker skips the row and the app prompts.
  needs_reauth  boolean not null default false,

  -- Gmail cursor. Advanced only after the messages in a window are staged, so
  -- a crash replays that window rather than skipping it.
  history_id    text,
  last_synced_at timestamptz,

  -- Whether the one-time backfill of existing mail has run. Separate from the
  -- cursor because "no cursor yet" and "never backfilled" are different states:
  -- a grant reconnected after an expiry has a cursor and must not backfill
  -- again, or every message since the first connect is staged twice.
  backfilled_at timestamptz,

  connected_at  timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  constraint mailbox_grants_provider_known check (provider in ('google')),
  constraint mailbox_grants_email_not_blank check (length(btrim(email)) > 0)
);

-- One live grant per provider per user. Re-connecting replaces the credential
-- instead of accumulating dead ones beside it.
create unique index if not exists mailbox_grants_user_provider_idx
  on public.mailbox_grants (user_id, provider);

-- The worker's own sweep: "which mailboxes are due a poll". Partial, because a
-- grant awaiting re-consent cannot mint an access token and polling it only
-- burns a call.
create index if not exists mailbox_grants_due_idx
  on public.mailbox_grants (last_synced_at nulls first)
  where needs_reauth = false;

create index if not exists mailbox_grants_member_idx
  on public.mailbox_grants (member_id);

comment on table public.mailbox_grants is
  'OAuth grants for direct mailbox read, with the member/family the mail is staged to and the Gmail cursor. Separate from connected_accounts (0070) on purpose — see the migration header.';
comment on column public.mailbox_grants.refresh_token_enc is
  'Ciphertext. Encrypt in the worker; never write a plaintext token here.';
comment on column public.mailbox_grants.family_id is
  'Denormalised from the member AT CONNECT TIME. The sealer needs it, and re-deriving it per message would orphan rows already sealed to the previous family key.';

-- ── 2. access control ───────────────────────────────────────────────────────
--
-- The worker connects as service_role and is unaffected by RLS. The app needs
-- exactly one thing from this table: whether the person is connected, to which
-- address, and whether it has gone stale. That is a status line, not a
-- credential, so the read is granted COLUMN BY COLUMN — a table-wide grant
-- would put refresh_token_enc one PostgREST query away from a browser.
--
-- Supabase's default privileges grant ALL on a new public table to anon and
-- authenticated, so a new table is not private by default here. Revoke first,
-- then grant back only what is safe.

alter table public.mailbox_grants enable row level security;

revoke all on public.mailbox_grants from anon, authenticated;

grant select (id, provider, email, needs_reauth, connected_at, last_synced_at, backfilled_at)
  on public.mailbox_grants to authenticated;

-- Initplan form, per the 0022 rule: auth helpers wrapped in (select ...), never
-- called bare, or the policy re-evaluates per row.
create policy mailbox_grants_select_own on public.mailbox_grants
  for select to authenticated
  using (user_id = (select auth.uid()));

comment on policy mailbox_grants_select_own on public.mailbox_grants is
  'Owner reads their own connection status. Paired with a column-level grant that omits refresh_token_enc — the policy decides WHICH rows, the grant decides WHICH columns, and only both together keep the credential out of the client.';

-- No insert/update/delete policy, deliberately. Connecting is an OAuth
-- callback the client cannot perform, and disconnecting goes through the
-- SECURITY DEFINER function below so it can be one atomic, ownership-checked
-- action rather than a policy the client drives.

grant select, insert, update, delete on public.mailbox_grants to service_role;

-- ── 3. binding a grant to a member ──────────────────────────────────────────
--
-- Called by the OAuth callback (service_role) once Google has named the
-- mailbox. Everything the destination depends on is checked HERE rather than
-- in the worker: a grant that reached this table already names a member of a
-- real family, so the worker never has to decide what to do about one that
-- does not.

create or replace function public.grant_mailbox_access(
  p_user_id  uuid,
  p_email    text,
  p_token    bytea,
  p_scopes   text default '',
  p_provider text default 'google'
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

  -- The member this person is in a REAL family, not a personal container and
  -- not an archived row. `order by created_at` so a user in several families
  -- gets a stable answer rather than whichever row the planner returned first.
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

  if v_member is null then raise exception 'no_member_row'; end if;

  insert into mailbox_grants (user_id, member_id, family_id, provider, email,
                              refresh_token_enc, scopes)
       values (p_user_id, v_member, v_family, p_provider, p_email, p_token, p_scopes)
  on conflict (user_id, provider) do update
     set email             = excluded.email,
         refresh_token_enc = excluded.refresh_token_enc,
         scopes            = excluded.scopes,
         needs_reauth      = false,          -- a reconnect is what clears this
         member_id         = excluded.member_id,
         family_id         = excluded.family_id,
         updated_at        = now()
    returning id into v_id;

  -- history_id and backfilled_at are deliberately NOT touched on conflict.
  -- Overwriting a live cursor with a fresh one skips every message between it
  -- and now; clearing backfilled_at re-stages the whole backfill window. Both
  -- are silent, and both look exactly like the feature working.

  return v_id;
end $$;

revoke all on function public.grant_mailbox_access(uuid, text, bytea, text, text) from public, anon, authenticated;
grant execute on function public.grant_mailbox_access(uuid, text, bytea, text, text) to service_role;

comment on function public.grant_mailbox_access(uuid, text, bytea, text, text) is
  'Binds an OAuth grant to the caller''s member + family. Refuses a user with no member row in a real family rather than storing a grant nothing can route.';

-- ── 4. withdrawal actually stops collection ─────────────────────────────────
--
-- 0082 gave people a way to withdraw consent: disconnect_my_mailbox() deletes
-- their forwarding connection and their pending staged rows. It predates this
-- transport, so today it would leave an OAuth grant behind and the mail would
-- keep arriving — which would make the consent sheet's promise untrue.
--
-- REPLACED, not edited: 0082 stays as applied, and this is the append-only way
-- to change a function. Everything it did still happens, in the same order, and
-- the return shape gains one key rather than changing the ones already there.
--
-- Deleting the row is what stops US reading. It does not revoke the grant at
-- Google — only the person can do that, in their own account settings — and
-- the app's copy says so rather than implying more.

create or replace function public.disconnect_my_mailbox()
returns json
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_member uuid;
  v_conns int; v_rows int; v_grants int;
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

  -- Keyed on user_id, not member_id: the grant belongs to the person, and a
  -- user with members in several families still holds exactly one of these.
  delete from mailbox_grants where user_id = v_uid;
  get diagnostics v_grants = row_count;

  return json_build_object('connections', v_conns,
                           'pending_deleted', v_rows,
                           'grants', v_grants);
end $$;

revoke all on function public.disconnect_my_mailbox() from public;
grant execute on function public.disconnect_my_mailbox() to authenticated;

comment on function public.disconnect_my_mailbox() is
  'Withdrawal of consent for bank-email processing, both transports: deletes the forwarding connection (0059), the OAuth grant (0087), and every still-pending staged row. Does not revoke the grant at the provider — only the account holder can.';
