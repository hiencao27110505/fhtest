-- ============================================================================
-- FamilyHub — 0066: direct mailbox read (OAuth) on mailbox_connections
--
-- [renumbered 0061 -> 0062 -> 0066 before commit: 0061..0064 were taken by
--  founder-digest work on main. Third time this range has collided
--  (two 0043s, two 0048s), so: check `git ls-tree origin/main
--  supabase/migrations/` for the real high-water mark, not just AGENT_SYNC —
--  the note there is only as fresh as the last person to update it.]
--
-- Turns mailbox_connections from "the table that maps a +tag to a member" into
-- "the table that proves which mailbox belongs to which member", by whichever
-- mechanism. Same table, same job, second mechanism — per the plan in
-- pipeline/OAUTH-DIRECT-READ.md §1 ("repurpose, don't replace").
--
-- ADDITIVE AND NON-BREAKING BY DESIGN. The forwarding pipeline is live with
-- real transactions flowing through it and must not notice this migration:
--   * every new column is nullable with a default, so the existing insert in
--     get_or_create_mailbox_alias (0059) keeps working untouched;
--   * the (sender_address, subject_template) unique constraint that the Apps
--     Script upserts on is NOT touched — see the note in
--     pipeline/lib/extract.js about template version interop;
--   * the only relaxation is forwarding_alias losing NOT NULL, because an
--     OAuth connection has no alias. Nothing enforces the reverse.
--
-- WHAT IS DELIBERATELY NOT HERE: the refresh token is stored ENCRYPTED, in a
-- format this database cannot read. The key lives in the Vercel environment
-- (MAILBOX_TOKEN_KEY), never in Supabase. That split is the whole protection —
-- a database dump, a leaked service-role key, or SQL injection yields
-- ciphertext bound to a row it cannot be moved off. Construction, threat model
-- and the honest limits of the claim: pipeline/lib/token-crypto.js.
--
-- A refresh token is a bigger secret than anything else in this project: it is
-- standing access to a user's whole mailbox until they revoke it. It cannot be
-- E2EE like ledger data, because sync has to run while the user is asleep.
-- Said plainly here so nobody later assumes the family DEK protects it.
--
-- Apply AFTER 0065 (sealed staging columns) — those columns must exist
-- before the sync worker writes its first sealed row.
-- Next free migration number after both: 0067.
-- ============================================================================

-- ── connection columns ──────────────────────────────────────────────────────

alter table public.mailbox_connections
  -- 'forwarding' = the +tag path (everything that exists today).
  -- 'oauth'      = direct read. Set explicitly so a row's mechanism is never
  --                inferred from which columns happen to be null.
  add column if not exists connection_source text not null default 'forwarding'
    check (connection_source in ('forwarding', 'oauth')),

  -- The sealed refresh token: "v1.<keyId>.<iv>.<ciphertext+tag>".
  -- Opaque to the database on purpose.
  add column if not exists oauth_refresh_enc text,

  -- The Google account that granted access. Shown back to the user ("connected
  -- as ..."), and the only way they can tell which mailbox this row is for.
  add column if not exists oauth_email text,

  -- Exact scope string granted, recorded rather than assumed. If Google ever
  -- narrows what a grant covers, or we request something different, the rows
  -- issued under the old terms are identifiable.
  add column if not exists oauth_scope text,

  add column if not exists oauth_connected_at timestamptz,

  -- Revocation is a NORMAL state, not an error (OAUTH-DIRECT-READ.md §3.4).
  -- Users will revoke from their Google account and we find out only when a
  -- refresh fails; the UI must show a re-connect path, not a broken screen.
  add column if not exists oauth_status text not null default 'none'
    check (oauth_status in ('none', 'active', 'needs_reconnect', 'revoked')),

  -- Why the connection stopped working, in words a support conversation can
  -- use. Never contains a token or a message body.
  add column if not exists oauth_last_error text,

  add column if not exists last_sync_at timestamptz,

  -- Gmail History API resume point. Null = fall back to a time-windowed query,
  -- which is the correct behaviour on first sync and after a long gap (Gmail
  -- expires history ids after about a week).
  add column if not exists last_history_id text,

  -- First-connect backfill state. The whole product argument for direct read is
  -- that a new user gets their last six months, not an empty screen, so this
  -- must be resumable across serverless invocations rather than one long run.
  add column if not exists backfill_status text not null default 'pending'
    check (backfill_status in ('pending', 'running', 'done', 'skipped')),
  add column if not exists backfill_cursor timestamptz;

-- An OAuth connection has no forwarding alias. (0059's insert always supplies
-- one, so this only widens what is accepted.)
alter table public.mailbox_connections alter column forwarding_alias drop not null;

-- One OAuth connection per member per Google account. Partial, so it cannot
-- collide with forwarding rows (which have neither column set) and cannot be
-- tripped by the several historical rows that may share a null oauth_email.
create unique index if not exists mailbox_connections_oauth_unique
  on public.mailbox_connections (member_id, oauth_email)
  where connection_source = 'oauth' and oauth_email is not null;

-- The sync worker's hot query: "which connections are due?"
create index if not exists mailbox_connections_sync_due
  on public.mailbox_connections (last_sync_at)
  where connection_source = 'oauth' and oauth_status = 'active';

comment on column public.mailbox_connections.oauth_refresh_enc is
  'AES-256-GCM sealed Google refresh token, bound to (id, member_id) via GCM AAD. Key is MAILBOX_TOKEN_KEY in the Vercel env and is NEVER in this database. See pipeline/lib/token-crypto.js.';
comment on column public.mailbox_connections.oauth_status is
  'none | active | needs_reconnect | revoked. needs_reconnect is the expected end state of a refused refresh (user revoked, or the 7-day Testing-mode token expiry) and must surface as a re-connect prompt, not an error.';

-- ── staged-row provenance ───────────────────────────────────────────────────
--
-- Which pipeline produced a staged row. Needed to tell "direct read is working"
-- from "forwarding is still carrying everything" while both run, and to make
-- the eventual retirement of forwarding measurable rather than a guess.
alter table public.email_transactions
  add column if not exists ingest_source text not null default 'forwarding'
    check (ingest_source in ('forwarding', 'oauth'));

-- ── read model for the client ───────────────────────────────────────────────
--
-- mailbox_connections stays deny-all with no policies (0025), off the PostgREST
-- surface entirely. The client needs to render connection state, so it gets a
-- SECURITY DEFINER function that returns only non-secret fields for the
-- caller's own members. The token column is not selectable through it, which is
-- the point: there is no client-reachable path to the ciphertext, let alone the
-- token.
create or replace function public.get_my_mailbox_connections()
returns json
language sql security definer set search_path = public
stable
as $$
  select coalesce(json_agg(row_to_json(c)), '[]'::json)
  from (
    select
      mc.id,
      mc.member_id,
      mc.connection_source,
      mc.forwarding_alias,
      mc.personal_email,
      mc.verified,
      mc.oauth_email,
      mc.oauth_status,
      mc.oauth_connected_at,
      mc.oauth_last_error,
      mc.last_sync_at,
      mc.backfill_status,
      mc.created_at
    from public.mailbox_connections mc
    join public.members m on m.id = mc.member_id
    where m.user_id = (select auth.uid())
    order by mc.created_at
  ) c;
$$;

-- Disconnecting must be possible from inside the app, without a support
-- request. It clears the token immediately and marks the row revoked; the user
-- should ALSO revoke at Google (the UI says so), because deleting our copy does
-- not invalidate the grant — only Google can do that.
create or replace function public.disconnect_mailbox(p_connection_id uuid)
returns json
language plpgsql security definer set search_path = public
as $$
declare
  v_row public.mailbox_connections;
begin
  select mc.* into v_row
  from public.mailbox_connections mc
  join public.members m on m.id = mc.member_id
  where mc.id = p_connection_id
    and m.user_id = (select auth.uid())
  limit 1;

  if v_row.id is null then
    return json_build_object('ok', false, 'error', 'not_found');
  end if;

  update public.mailbox_connections
     set oauth_refresh_enc = null,
         oauth_status      = 'revoked',
         oauth_last_error  = null,
         last_history_id   = null
   where id = v_row.id;

  return json_build_object('ok', true, 'id', v_row.id);
end;
$$;

-- Grants: authenticated only, matching 0059's posture. Neither function is
-- reachable by anon.
revoke execute on function public.get_my_mailbox_connections()  from public, anon;
revoke execute on function public.disconnect_mailbox(uuid)      from public, anon;
grant  execute on function public.get_my_mailbox_connections()  to authenticated;
grant  execute on function public.disconnect_mailbox(uuid)      to authenticated;
