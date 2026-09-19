-- ---------------------------------------------------------------------------
-- 0139 — statement capture: a bank's statement FILE becomes one locked card,
--        then N encrypted rows after its owner unlocks it on their device.
--        Spec: docs/specs/statement-capture-spec.md
--
-- WHY NEW TABLES AND NOT email_transactions. A statement is one Gmail message that
-- yields many rows, and email_transactions is keyed one-row-per-message
-- (`(owner_user_id, gmail_message_id)`, 0137 -- reworked days ago for the
-- two-readers case and deliberately left alone here). Its writer is also the wrong
-- one: email rows are sealed by a server that must not read them back, while a
-- statement is parsed by its owner's own device, which already holds the key. So:
--
--   statement_files          one row per captured attachment. Written by service_role,
--                            read by its owner, state changed through RPCs only. Never
--                            deleted on success: the row is the statement's own
--                            tombstone, so a re-read of the mailbox cannot capture the
--                            same attachment twice.
--   statement_rows           the parsed transactions. Written by the OWNER'S DEVICE
--                            (through stage_statement_rows), one personal-DEK
--                            ciphertext per row. No plaintext value column exists.
--   resolved_statement_rows  opaque fingerprints of rows the person already decided
--                            on, so a re-sent or overlapping statement does not ask
--                            twice. The server cannot read a fingerprint.
--   statement_shapes         "is this mail format a statement?", judged once per
--                            format and shared by every user. Its own table rather
--                            than a column on sender_fingerprints: that table's junk
--                            rows feed senderTally() and the sender-wide sentinel, and
--                            a statement verdict must not count as either.
--
-- ALWAYS PERSONAL (decision S24). The file is sealed to personal_keys.staging_pub and
-- the rows are encrypted under the personal DEK whatever the mailbox's default scope,
-- because a real statement carries an ID number, a home address and a full account
-- number. Every policy below is therefore owner-only; there is no family branch.
--
-- ADDITIVE. Nothing that exists today reads or writes any object created here, so
-- this is safe to apply ahead of the worker and the client that use it.
--
-- Next free migration number after this one: 0140 is claimed by the seed below;
-- 0141 is next. Verify against `git ls-tree origin/main supabase/migrations/` and
-- AGENT_SYNC.md before claiming it.
-- ---------------------------------------------------------------------------

-- ── 1. statement_files ──────────────────────────────────────────────────────
create table if not exists public.statement_files (
  id               uuid primary key default gen_random_uuid(),
  owner_user_id    uuid not null references auth.users(id) on delete cascade,
  gmail_message_id text not null,
  part_index       int  not null default 0,            -- which attachment of the message
  source_provider  text not null,                      -- canonical bank name, clear (same precedent as email_transactions)
  received_at      timestamptz not null,               -- the mail's date, clear: ordering and the "Sao kê cũ" fold
  file_ext         text not null check (file_ext in ('xlsx', 'csv')),
  byte_size        int  not null default 0,
  bytes_source     text not null default 'sealed_object' check (bytes_source in ('sealed_object')),
  object_path      text,                               -- {owner_user_id}/{id}.sealed in bucket statement-files; null once deleted
  meta_sealed      text,                               -- sealed JSON: file name, subject, period, account tail, sha256 of the plaintext file
  meta_eph_pub     text,
  meta_nonce       text,
  enc_v            smallint,
  status           text not null default 'pending'
                   check (status in ('pending', 'opened', 'dismissed', 'expired', 'rejected')),
  backfill         boolean not null default false,     -- found while reading history
  created_at       timestamptz not null default now(),
  opened_at        timestamptz,
  expires_at       timestamptz not null default (now() + interval '90 days'),
  constraint statement_files_owner_message_key unique (owner_user_id, gmail_message_id, part_index),
  -- A pending card must be openable: it has both the object and its sealed metadata.
  constraint statement_files_pending_is_sealed check (
    status <> 'pending' or (object_path is not null and meta_sealed is not null
                            and meta_eph_pub is not null and meta_nonce is not null and enc_v is not null))
);
comment on table public.statement_files is
  'One captured statement attachment. service_role writes, the owner reads, RPCs change state. The row outlives the file: it is the tombstone that stops a re-read of the mailbox capturing it twice.';
comment on column public.statement_files.status is
  'pending = locked card waiting; opened = rows written, file deleted; dismissed = the person removed it; expired = 90 days unopened, file deleted, card kept; rejected = the model judged this spreadsheet not a statement (no file kept).';
comment on column public.statement_files.bytes_source is
  'Where the device gets the bytes. Only sealed_object today; the column exists so a future transport can add a source without a redesign.';

create index if not exists statement_files_owner_status_idx on public.statement_files (owner_user_id, status, received_at desc);
create index if not exists statement_files_sweep_idx on public.statement_files (status, expires_at) where object_path is not null;

alter table public.statement_files enable row level security;
revoke all on public.statement_files from anon, authenticated;
grant select on public.statement_files to authenticated;
grant select, insert, update, delete on public.statement_files to service_role;

drop policy if exists statement_files_select_own on public.statement_files;
create policy statement_files_select_own on public.statement_files
  for select to authenticated
  using (owner_user_id = (select auth.uid()));

-- ── 2. statement_rows ───────────────────────────────────────────────────────
create table if not exists public.statement_rows (
  id             uuid primary key,                     -- client-minted
  owner_user_id  uuid not null references auth.users(id) on delete cascade,
  statement_id   uuid not null references public.statement_files(id) on delete cascade,
  row_index      int  not null,
  txn_date       date not null,                        -- clear, like personal_transactions.txn_date: ordering and paging
  payload_enc    text not null,                        -- personal-DEK ciphertext of the whole row; base64(iv||ct)
  created_at     timestamptz not null default now(),
  constraint statement_rows_position_key unique (statement_id, row_index)
);
comment on table public.statement_rows is
  'Transactions parsed from a statement, waiting for review. Written by the owner''s device via stage_statement_rows; one ciphertext per row under the personal DEK. No plaintext value column exists, in any state.';

create index if not exists statement_rows_owner_idx on public.statement_rows (owner_user_id, txn_date desc);

alter table public.statement_rows enable row level security;
revoke all on public.statement_rows from anon, authenticated;
grant select on public.statement_rows to authenticated;
grant select, delete on public.statement_rows to service_role;

drop policy if exists statement_rows_select_own on public.statement_rows;
create policy statement_rows_select_own on public.statement_rows
  for select to authenticated
  using (owner_user_id = (select auth.uid()));

-- ── 3. resolved_statement_rows ──────────────────────────────────────────────
create table if not exists public.resolved_statement_rows (
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  row_fp        text not null,                         -- HMAC under a key only the owner's devices can derive
  resolved_at   timestamptz not null default now(),
  primary key (owner_user_id, row_fp)
);
comment on table public.resolved_statement_rows is
  'Statement rows this person already imported or removed, as opaque fingerprints. Lets a re-sent or overlapping statement skip what was already decided. The server cannot read a fingerprint back into a transaction.';

alter table public.resolved_statement_rows enable row level security;
revoke all on public.resolved_statement_rows from anon, authenticated;
grant select on public.resolved_statement_rows to authenticated;
grant select, delete on public.resolved_statement_rows to service_role;

drop policy if exists resolved_statement_rows_select_own on public.resolved_statement_rows;
create policy resolved_statement_rows_select_own on public.resolved_statement_rows
  for select to authenticated
  using (owner_user_id = (select auth.uid()));

-- ── 4. statement_shapes ─────────────────────────────────────────────────────
create table if not exists public.statement_shapes (
  sender_address text not null,
  shape          text not null,                        -- the subject with every digit removed (statement.mjs statementShape)
  is_statement   boolean not null,
  source         text not null default 'llm',          -- 'llm' | 'seed'
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  primary key (sender_address, shape)
);
comment on table public.statement_shapes is
  'One verdict per mail FORMAT, shared by every user: is a spreadsheet from this sender under this subject a statement? Bank boilerplate only -- no value from any mail. service_role only.';

alter table public.statement_shapes enable row level security;
-- No policy on purpose: only service_role (which bypasses RLS) touches this table.

-- ── 5. the one-time history re-scan cursor ──────────────────────────────────
alter table public.mailbox_grants
  add column if not exists stmt_rescan_at timestamptz;
comment on column public.mailbox_grants.stmt_rescan_at is
  'When the statement lane finished its one-time read of this mailbox''s history. NULL = still owed (and gated on bank_email consent v5). Read by its own query in db.mjs, never added to the worker''s grant select lists.';

-- ── 6. the bucket ───────────────────────────────────────────────────────────
-- PRIVATE, unlike personal-media: there is no reason for these bytes to be
-- fetchable by URL, and the file behind the seal is locked with a guessable
-- password. service_role uploads (RLS bypass); the owner reads and deletes under
-- their own prefix; nobody inserts or updates from a device.
insert into storage.buckets (id, name, public)
values ('statement-files', 'statement-files', false)
on conflict (id) do nothing;

update storage.buckets
   set file_size_limit    = 11534336,                  -- 11 MB: the 10 MB file ceiling plus the seal's overhead
       allowed_mime_types = array['application/octet-stream']
 where id = 'statement-files';

drop policy if exists statement_files_obj_read   on storage.objects;
drop policy if exists statement_files_obj_delete on storage.objects;

create policy statement_files_obj_read on storage.objects for select to authenticated
  using (bucket_id = 'statement-files'
         and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy statement_files_obj_delete on storage.objects for delete to authenticated
  using (bucket_id = 'statement-files'
         and (storage.foldername(name))[1] = (select auth.uid())::text);

-- ── 7. device-side RPCs ─────────────────────────────────────────────────────

-- Writes every parsed row AND marks the card opened, in one transaction. A dropped
-- connection at row 100 leaves the card pending and no rows at all; a retry after a
-- lost reply is a no-op that returns what the first call wrote.
create or replace function public.stage_statement_rows(p_statement_id uuid, p_rows jsonb)
returns int
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_status text; v_n int;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then raise exception 'statement_rows_not_array'; end if;
  if jsonb_array_length(p_rows) > 5000 then raise exception 'statement_rows_too_many'; end if;

  select status into v_status from statement_files
   where id = p_statement_id and owner_user_id = v_uid
   for update;
  if not found then raise exception 'statement_not_found'; end if;

  if v_status = 'opened' then
    return (select count(*)::int from statement_rows where statement_id = p_statement_id);
  end if;
  -- 'expired' is allowed: the sealed file is gone, but the person may open the same
  -- statement from a copy on their device, and the rows still belong to this card.
  if v_status not in ('pending', 'expired') then raise exception 'statement_not_pending'; end if;

  insert into statement_rows (id, owner_user_id, statement_id, row_index, txn_date, payload_enc)
  select (r->>'id')::uuid, v_uid, p_statement_id, (r->>'row_index')::int, (r->>'txn_date')::date, r->>'payload_enc'
    from jsonb_array_elements(p_rows) r
  on conflict (statement_id, row_index) do nothing;
  get diagnostics v_n = row_count;

  update statement_files set status = 'opened', opened_at = now() where id = p_statement_id;
  return v_n;
end $$;
comment on function public.stage_statement_rows(uuid, jsonb) is
  'Atomic: insert every parsed row and mark the statement opened. Idempotent on a second call.';

create or replace function public.dismiss_statement_file(p_statement_id uuid)
returns boolean
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_n int;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  update statement_files set status = 'dismissed'
   where id = p_statement_id and owner_user_id = v_uid and status in ('pending', 'expired');
  get diagnostics v_n = row_count;
  return v_n > 0;
end $$;
comment on function public.dismiss_statement_file(uuid) is
  'The person removed a statement card without opening it. The sweep deletes the sealed file.';

-- Same ordering as resolve_email_transactions: RECORD FIRST, delete second. A failed
-- insert rolls back and keeps the rows, which is the recoverable direction.
create or replace function public.resolve_statement_rows(p_ids uuid[], p_fps text[])
returns int
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_deleted int;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  if p_ids is null or array_length(p_ids, 1) is null then return 0; end if;

  if p_fps is not null and array_length(p_fps, 1) is not null then
    insert into resolved_statement_rows (owner_user_id, row_fp)
    select v_uid, fp from unnest(p_fps) fp
     where fp is not null and length(fp) between 16 and 128
    on conflict (owner_user_id, row_fp) do nothing;
  end if;

  delete from statement_rows where id = any(p_ids) and owner_user_id = v_uid;
  get diagnostics v_deleted = row_count;
  return v_deleted;
end $$;
comment on function public.resolve_statement_rows(uuid[], text[]) is
  'Retires reviewed statement rows: remembers their fingerprints, then deletes them.';

-- Disconnecting the mailbox (or withdrawing consent) deletes what capture stored.
-- Returns the object paths so the device can remove the files at once; the sweep is
-- the net for any it could not.
create or replace function public.purge_my_statements()
returns setof text
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  delete from statement_rows where owner_user_id = v_uid;
  update statement_files set status = 'dismissed'
   where owner_user_id = v_uid and status in ('pending', 'expired');
  return query select object_path from statement_files
                where owner_user_id = v_uid and object_path is not null;
end $$;
comment on function public.purge_my_statements() is
  'Erasure for statement capture: drops this person''s parsed rows, dismisses their cards, and lists the sealed files to delete.';

revoke execute on function public.stage_statement_rows(uuid, jsonb)      from public, anon;
revoke execute on function public.dismiss_statement_file(uuid)           from public, anon;
revoke execute on function public.resolve_statement_rows(uuid[], text[]) from public, anon;
revoke execute on function public.purge_my_statements()                  from public, anon;
grant  execute on function public.stage_statement_rows(uuid, jsonb)      to authenticated;
grant  execute on function public.dismiss_statement_file(uuid)           to authenticated;
grant  execute on function public.resolve_statement_rows(uuid[], text[]) to authenticated;
grant  execute on function public.purge_my_statements()                  to authenticated;

-- ── 8. the sweep (worker-side) ──────────────────────────────────────────────
-- Storage objects are deleted through the Storage API, never by SQL (a row deleted
-- from storage.objects orphans the bytes). So the database only decides WHICH files
-- go; the worker deletes them and reports back.
create or replace function public.statement_sweep_list(p_limit int default 20)
returns table (id uuid, object_path text)
language plpgsql security definer set search_path = public as $$
begin
  -- 90 days unopened: the file goes, the card stays and says so.
  update statement_files f set status = 'expired'
   where f.status = 'pending' and f.expires_at < now();

  -- The owner no longer has a mailbox connected: capture's stored data goes with it.
  update statement_files f set status = 'dismissed'
   where f.status in ('pending', 'expired')
     and not exists (select 1 from mailbox_grants g where g.user_id = f.owner_user_id);
  delete from statement_rows r
   where not exists (select 1 from mailbox_grants g where g.user_id = r.owner_user_id);

  return query
    select f.id, f.object_path from statement_files f
     where f.object_path is not null and f.status <> 'pending'
     order by f.created_at
     limit greatest(1, least(coalesce(p_limit, 20), 100));
end $$;

create or replace function public.statement_sweep_done(p_ids uuid[])
returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_ids is null or array_length(p_ids, 1) is null then return; end if;
  update statement_files set object_path = null where id = any(p_ids) and status <> 'pending';
end $$;

revoke all on function public.statement_sweep_list(int)   from public, anon, authenticated;
revoke all on function public.statement_sweep_done(uuid[]) from public, anon, authenticated;
grant execute on function public.statement_sweep_list(int)   to service_role;
grant execute on function public.statement_sweep_done(uuid[]) to service_role;

comment on function public.statement_sweep_list(int) is
  'Expires unopened statements past 90 days, drops capture data for owners with no mailbox, and lists sealed files the worker should delete.';
comment on function public.statement_sweep_done(uuid[]) is
  'The worker deleted these sealed files; forget their paths.';
