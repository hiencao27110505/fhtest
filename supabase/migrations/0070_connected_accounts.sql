-- Third-party account links and their OAuth credentials.
--
-- Named for what it is rather than for Gmail: the row shape is the same for
-- any provider a user connects, and a second provider should not need a second
-- table. Provider-specific sync state does NOT live here — see
-- gmail_sync_state below — because that is where a shared table would start
-- collecting columns only one provider ever uses.

create table if not exists public.connected_accounts (
  id                  bigint generated always as identity primary key,
  user_id             uuid        not null references auth.users (id) on delete cascade,

  -- Identity at the provider. The natural key is (provider,
  -- provider_account_id), not the email: the same address can exist at several
  -- providers, and a provider address can change while the account does not.
  provider            text        not null,
  provider_account_id text        not null,

  -- Display only. Never join or look up on this.
  email               text,

  -- Encrypted by the application before it ever reaches Postgres. Storing a
  -- refresh token in plaintext would mean a database dump is a permanent read
  -- grant on every connected mailbox.
  refresh_token_enc   bytea       not null,

  -- Space-separated OAuth scopes actually granted. A re-consent can widen or
  -- narrow them, so the app must not assume what it asked for.
  scopes              text        not null default '',

  -- Set when the provider rejects the refresh token: revoked, password
  -- changed, or the 7-day expiry that applies while an app is in Testing
  -- publishing status. A state, not an error — the app prompts the user and
  -- background jobs skip the row.
  needs_reauth        boolean     not null default false,

  connected_at        timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  constraint connected_accounts_provider_account_uniq
    unique (provider, provider_account_id)
);

-- One link per provider per user: connecting the same provider again updates
-- the existing row instead of accumulating dead credentials.
create unique index if not exists connected_accounts_user_provider_idx
  on public.connected_accounts (user_id, provider);

comment on table public.connected_accounts is
  'OAuth links between an app user and their account at an external provider.';
comment on column public.connected_accounts.refresh_token_enc is
  'Ciphertext. Encrypt in the application; never write a plaintext token here.';

-- Provider-specific sync state, kept out of connected_accounts so that table
-- stays the same shape for every provider. Gmail tracks a history cursor and a
-- watch registration; another provider will track something else entirely.
create table if not exists public.gmail_sync_state (
  connected_account_id bigint      primary key
    references public.connected_accounts (id) on delete cascade,

  -- Cursor into the mailbox's change history. Advanced only after the messages
  -- in a window are handled, so a crash replays that window rather than
  -- skipping it. Gmail returns it as a uint64 string; text avoids any
  -- round-tripping question.
  history_id           text,

  -- When the Gmail watch lapses. A lapsed watch stops delivering notifications
  -- silently, so the renewal job needs to see this rather than infer it.
  watch_expires_at     timestamptz,
  last_synced_at       timestamptz,

  updated_at           timestamptz not null default now()
);

comment on table public.gmail_sync_state is
  'Gmail-specific cursor and watch state for a connected account.';

-- Drives the renewal job: "which watches expire soonest". Partial, because a
-- row awaiting re-consent is never renewed and does not belong in the index.
create index if not exists gmail_sync_state_watch_expires_idx
  on public.gmail_sync_state (watch_expires_at)
  where watch_expires_at is not null;

-- Row level security -------------------------------------------------------
--
-- These tables hold credentials and are written and read only by the OAuth
-- callback and the background jobs, both of which connect as service_role.
--
-- RLS is enabled with NO policies. That is deliberate: with RLS on and no
-- policy, every row is invisible to any role that is subject to RLS, so a
-- client reaching PostgREST with an anon or user JWT sees nothing at all —
-- even before privileges are considered. service_role has BYPASSRLS and is
-- unaffected.
--
-- Supabase ships `alter default privileges` in schema public that grant ALL
-- to anon and authenticated on every newly created table. A new table is
-- therefore NOT private by default here, unlike stock Postgres — the grants
-- have to be revoked explicitly, which is what the revokes below do. RLS with
-- no policy already hides every row, but leaving INSERT and TRUNCATE on a
-- credential table to anon is not a line worth relying on RLS alone for.
--
-- When the app needs to show a user their connected accounts, add a select
-- policy plus a COLUMN-level grant that omits refresh_token_enc. Granting the
-- whole table would hand the ciphertext to any client that can query it.

alter table public.connected_accounts enable row level security;
alter table public.gmail_sync_state  enable row level security;

-- Undo Supabase's default grants. Must come before the service_role grants
-- below, and must name every role that default ACLs cover.
revoke all on public.connected_accounts from anon, authenticated;
revoke all on public.gmail_sync_state  from anon, authenticated;
revoke all on sequence public.connected_accounts_id_seq from anon, authenticated;

-- BYPASSRLS skips row policies, not table privileges: without these grants the
-- jobs fail with "permission denied" while every RLS check still passes.
grant usage on schema public to service_role;
grant select, insert, update, delete on public.connected_accounts to service_role;
grant usage, select on sequence public.connected_accounts_id_seq to service_role;
grant select, insert, update, delete on public.gmail_sync_state to service_role;

-- Index backing the FK to auth.users, and any future policy that filters on it.
create index if not exists connected_accounts_user_id_idx
  on public.connected_accounts (user_id);
