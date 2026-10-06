-- 0157_receipt_providers_recurrence — receipt-providers-spec.md §10 and
-- recurring-charges-spec.md §6. One number, two small features, applied once.
--
-- A. Receipt providers become DATA. `known_provider_domains` (0025, seeded
--    0050) was a global seed of bank sender domains, unioned into the worker's
--    query as banks. It now carries a `kind`, so an operator (or a member,
--    through receipt_sender_add) can make a receipt sender live on the next
--    run without a deploy. A receipt row always has its subject gate
--    (`subjects`) — an unfiltered receipt domain is the marketing firehose
--    senders.mjs keeps out — and names its reading family.
--    `receipt_candidates` is what discovery remembers: a sender, a subject
--    shape, counts and the model's one-word verdict. Never a body, never a
--    user. `receipt_sender_mutes` is a member's own off switch, per grant.
--
-- B. Recurrence on both ledgers. `recurrence` (weekly | monthly | yearly) and
--    `recurrence_source` (receipt | pattern | person) on personal_transactions
--    AND transactions. Deliberately PLAINTEXT (recurring-charges-spec §7): a
--    small enum that says "this row comes back", nothing about who or how
--    much; amounts stay ciphertext so totals remain device-side.

-- ── A. receipt providers ───────────────────────────────────────────────────

alter table public.known_provider_domains
  add column if not exists kind        text not null default 'bank',
  add column if not exists subjects    text[],
  add column if not exists family      text,
  add column if not exists added_by    uuid references auth.users(id) on delete set null,
  add column if not exists candidate_id uuid;

alter table public.known_provider_domains
  drop constraint if exists known_provider_domains_kind_check,
  add constraint known_provider_domains_kind_check
    check (kind in ('bank', 'wallet', 'receipt'));

-- A receipt row without a subject gate may never exist (senders.mjs rule).
alter table public.known_provider_domains
  drop constraint if exists known_provider_domains_receipt_gate,
  add constraint known_provider_domains_receipt_gate
    check (kind <> 'receipt' or (subjects is not null and cardinality(subjects) > 0));

alter table public.known_provider_domains
  drop constraint if exists known_provider_domains_family_check,
  add constraint known_provider_domains_family_check
    check (family is null or family in ('marketplace_order', 'subscription_invoice', 'service_receipt', 'model_only'));

-- What discovery found. Global knowledge about SENDERS, not about people:
-- there is no user column, and there is no body column.
create table if not exists public.receipt_candidates (
  id               uuid primary key default gen_random_uuid(),
  sender           text not null,                 -- full address, lower-cased
  subject_template text not null,                 -- normalizeSubjectTemplate() of the subject
  store_name       text,                          -- as the mail signs it ("Tiki")
  verdict          text,                          -- receipt | bill | campaign | other | null = not asked yet
  seen             integer not null default 1,
  mailboxes        integer not null default 1,    -- distinct grants that saw the shape (counted, never listed)
  first_seen_at    timestamptz not null default now(),
  last_seen_at     timestamptz not null default now(),
  promoted_at      timestamptz,                   -- set by receipt_sender_add
  unique (sender, subject_template)
);
create index if not exists receipt_candidates_sender_idx on public.receipt_candidates (sender);

alter table public.receipt_candidates enable row level security;
revoke all on public.receipt_candidates from anon;
-- Members read candidates to render Settings › Gợi ý; they never write them
-- (the worker does, with the service key). No insert/update/delete policy.
drop policy if exists receipt_candidates_read on public.receipt_candidates;
create policy receipt_candidates_read on public.receipt_candidates
  for select to authenticated using (verdict in ('receipt', 'bill') and promoted_at is null);

-- A member's own off switch for one store in one mailbox.
create table if not exists public.receipt_sender_mutes (
  grant_id   uuid not null references public.mailbox_grants(id) on delete cascade,
  sender     text not null,
  created_at timestamptz not null default now(),
  primary key (grant_id, sender)
);
alter table public.receipt_sender_mutes enable row level security;
revoke all on public.receipt_sender_mutes from anon;
drop policy if exists receipt_sender_mutes_owner on public.receipt_sender_mutes;
create policy receipt_sender_mutes_owner on public.receipt_sender_mutes
  for all to authenticated
  using  (exists (select 1 from public.mailbox_grants g where g.id = grant_id and g.user_id = auth.uid()))
  with check (exists (select 1 from public.mailbox_grants g where g.id = grant_id and g.user_id = auth.uid()));

-- The member fast lane. Takes a CANDIDATE, never an address: the refusal
-- rules (receipt-providers-spec §6.2) are re-checked here, server-side.
create or replace function public.receipt_sender_add(p_candidate uuid)
returns public.known_provider_domains
language plpgsql
security definer
set search_path = public
as $$
declare
  c   public.receipt_candidates%rowtype;
  dom text;
  r   public.known_provider_domains%rowtype;
  subj text[];
begin
  if auth.uid() is null then raise exception 'not signed in' using errcode = '42501'; end if;
  select * into c from public.receipt_candidates where id = p_candidate;
  if not found then raise exception 'no such candidate' using errcode = 'P0002'; end if;
  if c.verdict not in ('receipt', 'bill') then raise exception 'candidate is not a receipt sender' using errcode = '22023'; end if;
  if position('@' in c.sender) = 0 then raise exception 'candidate has no address' using errcode = '22023'; end if;
  dom := split_part(c.sender, '@', 2);
  -- Personal mailboxes and platforms can never be receipt senders by domain;
  -- the candidate is a full address, so the row is a full address too.
  if dom in ('gmail.com','googlemail.com','yahoo.com','yahoo.com.vn','ymail.com','outlook.com','outlook.com.vn',
             'hotmail.com','live.com','msn.com','icloud.com','me.com','mac.com','aol.com','proton.me','protonmail.com',
             'zoho.com','mail.com','gmx.com','yandex.com') then
    raise exception 'a personal mailbox cannot be a receipt sender' using errcode = '22023';
  end if;
  -- Never re-kind a bank or wallet row.
  if exists (select 1 from public.known_provider_domains k
             where k.kind <> 'receipt' and (k.domain_or_address = c.sender or k.domain_or_address = dom)) then
    raise exception 'sender is a bank or wallet' using errcode = '22023';
  end if;
  -- Every subject shape discovery saw for this sender becomes the gate.
  select array_agg(distinct subject_template) into subj
    from public.receipt_candidates where sender = c.sender and verdict in ('receipt', 'bill');
  insert into public.known_provider_domains (domain_or_address, provider_name, transaction_type, active, kind, subjects, family, added_by, candidate_id)
  values (c.sender, coalesce(nullif(c.store_name, ''), split_part(dom, '.', 1)), 'ecommerce_receipt', true, 'receipt', subj, 'model_only', auth.uid(), c.id)
  on conflict (domain_or_address) do update
    set subjects = (select array(select distinct unnest(public.known_provider_domains.subjects || excluded.subjects))),
        active = true
  returning * into r;
  update public.receipt_candidates set promoted_at = now() where sender = c.sender and promoted_at is null;
  return r;
end $$;

revoke all on function public.receipt_sender_add(uuid) from public, anon;
grant execute on function public.receipt_sender_add(uuid) to authenticated;

-- ── B. recurrence ──────────────────────────────────────────────────────────

alter table public.personal_transactions
  add column if not exists recurrence        text,
  add column if not exists recurrence_source text;
alter table public.personal_transactions
  drop constraint if exists personal_transactions_recurrence_check,
  add constraint personal_transactions_recurrence_check
    check (recurrence is null or recurrence in ('weekly', 'monthly', 'yearly')),
  drop constraint if exists personal_transactions_recurrence_source_check,
  add constraint personal_transactions_recurrence_source_check
    check (recurrence_source is null or recurrence_source in ('receipt', 'pattern', 'person'));
create index if not exists personal_transactions_recur_idx
  on public.personal_transactions (owner_user_id) where recurrence is not null;

alter table public.transactions
  add column if not exists recurrence        text,
  add column if not exists recurrence_source text;
alter table public.transactions
  drop constraint if exists transactions_recurrence_check,
  add constraint transactions_recurrence_check
    check (recurrence is null or recurrence in ('weekly', 'monthly', 'yearly')),
  drop constraint if exists transactions_recurrence_source_check,
  add constraint transactions_recurrence_source_check
    check (recurrence_source is null or recurrence_source in ('receipt', 'pattern', 'person'));
create index if not exists transactions_recur_idx
  on public.transactions (family_id) where recurrence is not null;

-- ── C. personal_txn_patch learns the two columns (0156 redefined) ──────────
-- Same function, same guards; `recurrence` and `recurrence_source` join the
-- editable set so the detail screen's Định kỳ row and the device's pattern
-- pass write through the one patch door. A mirrored (link_id) row still
-- accepts only node_enc — and now the two recurrence columns, which carry
-- no money and no text (recurring-charges-spec §6).
create or replace function public.personal_txn_patch(p_rows jsonb)
returns uuid[]
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_uid  uuid := auth.uid();
  v_el   jsonb;
  v_set  jsonb;
  v_id   uuid;
  v_key  text;
  v_done uuid[] := '{}';
  v_ok   constant text[] := array['amount_enc','note_enc','cat_name_enc','cat_emoji',
                                  'occurred_time_enc','txn_date','account_id','node_enc','label_id',
                                  'recurrence','recurrence_source'];
begin
  if v_uid is null then raise exception 'not signed in'; end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then raise exception 'patch: rows must be an array'; end if;
  if jsonb_array_length(p_rows) > 500 then raise exception 'patch: too many rows'; end if;

  for v_el in select * from jsonb_array_elements(p_rows) loop
    v_id  := (v_el->>'id')::uuid;
    v_set := v_el->'set';
    if v_id is null or v_set is null or jsonb_typeof(v_set) <> 'object' then
      raise exception 'patch: each row needs an id and a set';
    end if;
    for v_key in select jsonb_object_keys(v_set) loop
      if not (v_key = any (v_ok)) then raise exception 'patch: column % is not editable', v_key; end if;
    end loop;
    if v_set ? 'amount_enc' and (v_set->>'amount_enc') is null then raise exception 'patch: amount cannot be cleared'; end if;
    if v_set ? 'txn_date'   and (v_set->>'txn_date')   is null then raise exception 'patch: date cannot be cleared'; end if;
    if v_set = '{}'::jsonb then continue; end if;

    update public.personal_transactions t set
      amount_enc        = case when v_set ? 'amount_enc'        then v_set->>'amount_enc'            else t.amount_enc end,
      note_enc          = case when v_set ? 'note_enc'          then v_set->>'note_enc'              else t.note_enc end,
      cat_name_enc      = case when v_set ? 'cat_name_enc'      then v_set->>'cat_name_enc'          else t.cat_name_enc end,
      cat_emoji         = case when v_set ? 'cat_emoji'         then v_set->>'cat_emoji'             else t.cat_emoji end,
      occurred_time_enc = case when v_set ? 'occurred_time_enc' then v_set->>'occurred_time_enc'     else t.occurred_time_enc end,
      txn_date          = case when v_set ? 'txn_date'          then (v_set->>'txn_date')::date      else t.txn_date end,
      account_id        = case when v_set ? 'account_id'        then (v_set->>'account_id')::uuid    else t.account_id end,
      node_enc          = case when v_set ? 'node_enc'          then v_set->>'node_enc'              else t.node_enc end,
      label_id          = case when v_set ? 'label_id'          then (v_set->>'label_id')::uuid      else t.label_id end,
      recurrence        = case when v_set ? 'recurrence'        then v_set->>'recurrence'            else t.recurrence end,
      recurrence_source = case when v_set ? 'recurrence_source' then v_set->>'recurrence_source'     else t.recurrence_source end
    where t.id = v_id and t.owner_user_id = v_uid
      and (t.link_id is null or (v_set - 'node_enc' - 'recurrence' - 'recurrence_source') = '{}'::jsonb);
    if found then v_done := array_append(v_done, v_id); end if;
  end loop;

  return v_done;
end $$;

grant execute on function public.personal_txn_patch(jsonb) to authenticated;
