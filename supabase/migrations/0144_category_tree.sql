-- ============================================================================
-- FamilyHub — 0144: system category tree under the user's own labels
--
-- WHY
-- Every ledger row today carries only the user's label (a family `categories`
-- row, or the denormalised cat_name_enc on a personal row). Labels are private
-- and free-form, so nothing on the server or across families can be compared,
-- classified, or voiced consistently: "Ăn ngoài" here and "Ăn uống" there are
-- two unrelated strings. This migration puts one SYSTEM tree per transaction
-- kind (`taxonomy/taxonomy.json`, codes like 'coffee', 'groceries', 'home')
-- UNDER the labels: a row gets a tree NODE, a label CLAIMS a set of nodes, and
-- the mailbox classifier emits node codes next to the legacy concept/pool it
-- already writes. Old clients ignore all of it; old rows simply have nulls.
--
-- WHAT (additive only, backward compatible)
--   1. transactions.node / node_enc         — pt/ct pair, same shape as note/note_enc
--   2. categories.claims / claims_enc       — JSON array of node codes; '*' = catch-all
--   3. personal_labels (new, owner-scoped)  — the personal ledger gets real labels
--   4. personal_transactions.node_enc + label_id (→ personal_labels, set null)
--   5. merchant_concepts.node / merchant_corrections.node — tree code beside concept
--   6. get_family_snapshot: +node, node_enc (transactions) +claims, claims_enc (categories)
--   7. seed_default_categories: each default label seeds its claims
--   8. scrub_plaintext_amounts / set_family_enc_state: node + claims join the
--      plaintext wipe (scrub) and the ciphertext wipe (dual→off abort)
--
-- ENCRYPTION MODEL — mirrors occurred_time/occurred_time_enc (0096), NOT note:
--   • node / claims are plaintext for off/dual, ciphertext (family DEK) for enc,
--     written through the client's fhField/fhRead pair pattern.
--   • They are deliberately NOT added to the _fh_enc_guard() pair list (0033,
--     latest body 0043) nor to _fh_enc_txt_guard() (0038). 0096 set the
--     precedent for a later-added pair: server-side flows (seed_default_categories
--     below, the mailbox worker) legitimately write plaintext node/claims into
--     enc-from-birth families exactly like categories.name, and the strict 0033
--     guard would reject every later touch of those rows. The client coverage
--     job is what covers them, as it does for name/caption.
--   • Because there is no DB guard, the scrub does not add node/claims to its
--     uncovered-row COUNT (that would block "Hoàn tất" forever for a family
--     whose client never covered them); it nulls the plaintext whenever the row
--     is scrubbed, same as note rides on amount_enc. Ship the client coverage
--     for node/claims BEFORE families reach 'enc', or those two fields are
--     dropped at scrub (node is re-derivable from the label's claims).
--
-- Personal ledger tables stay ciphertext-only (0079): node_enc and claims_enc
-- only, no plaintext twin, nothing new to guard.
-- ============================================================================

-- ── 1. family transactions: tree node, pt/ct pair ────────────────────────────
alter table public.transactions
  add column if not exists node     text,
  add column if not exists node_enc text;

comment on column public.transactions.node is
  'System taxonomy node code (taxonomy/taxonomy.json, e.g. ''coffee''). Plaintext for off/dual encryption states; null in enc. Null = not classified (old rows).';
comment on column public.transactions.node_enc is
  'Ciphertext (family DEK) of node for the enc state; the only copy once the family is encrypted.';

-- No partial index on (family_id) where node is not null: the only reader is
-- the whole-family hydrate, which already walks the family_id index and
-- takes every row regardless of node. An extra partial index would be pure
-- write-side cost on the busiest table with no query to serve.

-- ── 2. family categories (labels) claim tree nodes ───────────────────────────
alter table public.categories
  add column if not exists claims     text,
  add column if not exists claims_enc text;

comment on column public.categories.claims is
  'JSON array of taxonomy node codes this label claims, e.g. ''["eatout","drinks"]''; ''["*"]'' / ''*'' = catch-all. Plaintext for off/dual; null in enc. Null = no claims (old rows).';
comment on column public.categories.claims_enc is
  'Ciphertext (family DEK) of claims for the enc state.';

-- ── 3. personal labels (Model Y, owner-scoped, ciphertext-only) ─────────────
create table if not exists public.personal_labels (
  id             uuid primary key default gen_random_uuid(),
  owner_user_id  uuid not null references auth.users(id) on delete cascade,
  name_enc       text,                          -- label name, encrypted with the personal key
  emoji          text,
  sort_order     int  not null default 0,
  claims_enc     text,                          -- JSON array of node codes, encrypted with the personal key
  archived_at    timestamptz,
  created_at     timestamptz not null default now()
);
comment on table public.personal_labels is
  'Personal-ledger labels (the personal counterpart of family categories). Name and claims are ciphertext only, per 0079.';

alter table public.personal_labels enable row level security;
create index if not exists plab_owner_idx on public.personal_labels (owner_user_id);
drop policy if exists plab_all on public.personal_labels;
create policy plab_all on public.personal_labels
  for all to authenticated
  using (owner_user_id = (select auth.uid()))
  with check (owner_user_id = (select auth.uid()));
-- Table-level access is the same posture as personal_budgets (0083): Supabase's
-- default privileges already grant the table to authenticated and RLS is the
-- gate. Stated explicitly so the intent survives a default-privilege change.
grant select, insert, update, delete on public.personal_labels to authenticated;

-- ── 4. personal transactions: node ciphertext + label link ───────────────────
alter table public.personal_transactions
  add column if not exists node_enc text,
  add column if not exists label_id uuid references public.personal_labels(id) on delete set null;

comment on column public.personal_transactions.node_enc is
  'Ciphertext (personal key) of the taxonomy node code. Null = not classified.';
comment on column public.personal_transactions.label_id is
  'The personal_labels row this transaction is filed under; null = legacy row still on cat_name_enc/cat_emoji, or label deleted.';

-- ── 5. merchant cache + corrections learn the tree code ──────────────────────
alter table public.merchant_concepts   add column if not exists node text;
alter table public.merchant_corrections add column if not exists node text;

comment on column public.merchant_concepts.node is
  'Taxonomy node code emitted by the classifier beside the legacy concept/pool. concept stays populated for old readers.';
comment on column public.merchant_corrections.node is
  'Taxonomy node code the user taught for this merchant. concept stays populated for old readers.';

-- ── 6. snapshot ships node/node_enc and claims/claims_enc ─────────────────────
-- Body is 0131 verbatim; only the transactions and categories subselects gain
-- columns. NULL p_txn_from stays byte-identical in shape to the full result.
CREATE OR REPLACE FUNCTION public.get_family_snapshot(p_txn_from date DEFAULT NULL::date)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_fid  uuid := auth_family_id();
  v_json json;
begin
  if v_fid is null then
    return null;
  end if;

  select json_build_object(
    'family', (
      select row_to_json(f) from (
        select name, currency, default_language, house
        from families where id = v_fid) f),
    'enc', (
      select row_to_json(k) from (
        select enc_state, kdf_salt, kdf_iters, kdf_version, wrapped_dek
        from family_keys where family_id = v_fid) k),
    'key_wraps', (
      select coalesce(json_agg(to_jsonb(w) - 'created_at' order by w.created_at), '[]'::json) from (
        select id, kind, kdf_salt, kdf_iters, kdf_version, wrapped_dek, created_at
        from family_key_wraps where family_id = v_fid and rotated_at is null) w),
    'members', (
      select coalesce(json_agg(row_to_json(m) order by m.created_at), '[]'::json) from (
        select id, name, name_enc, color, is_shared, user_id, created_at, key_unlocked_at, avatar_url
        from members where family_id = v_fid and archived_at is null) m),
    'categories', (
      select coalesce(json_agg(row_to_json(c) order by c.sort_order), '[]'::json) from (
        select id, name, name_enc, emoji, color, sort_order, archived_at, claims, claims_enc
        from categories where family_id = v_fid) c),
    'category_budgets', (
      select coalesce(json_agg(row_to_json(cb)), '[]'::json) from (
        select category_id, amount, amount_enc, month
        from category_budgets where family_id = v_fid) cb),
    'monthly_budgets', (
      select coalesce(json_agg(row_to_json(mb)), '[]'::json) from (
        select month, budget_total, budget_total_enc, closed
        from monthly_budgets where family_id = v_fid) mb),
    'transactions', (
      select coalesce(json_agg(row_to_json(t) order by t.txn_date desc), '[]'::json) from (
        select id, category_id, member_id, note, note_enc, amount, amount_enc,
               occurred_time, occurred_time_enc, txn_date, status, created_by, created_at, source, instrument,
               node, node_enc
        from transactions
        where family_id = v_fid
          and (p_txn_from is null or txn_date >= p_txn_from)) t),
    'events', (
      select coalesce(json_agg(row_to_json(e) order by e.sort_order), '[]'::json) from (
        select id, name, name_enc, emoji, cover, target_amount, target_amount_enc, target_date, achieved, sort_order, source_txn_id, created_by
        from events where family_id = v_fid and archived_at is null) e),
    'event_fundings', (
      select coalesce(json_agg(row_to_json(ef)), '[]'::json) from (
        select id, event_id, goal_id, amount, amount_enc, source, month, member_id
        from event_fundings where family_id = v_fid) ef),
    'savings_entries', (
      select coalesce(json_agg(row_to_json(se)), '[]'::json) from (
        select kind, amount, amount_enc, entry_date
        from savings_entries where family_id = v_fid) se),
    'event_memories', (
      select coalesce(json_agg(row_to_json(em) order by em.sort_order), '[]'::json) from (
        select id, event_id, emoji, caption, caption_enc, photo_url, sort_order
        from event_memories where family_id = v_fid) em),
    'transaction_photos', (
      select coalesce(json_agg(row_to_json(tp)), '[]'::json) from (
        select transaction_id, photo_url
        from transaction_photos
        where family_id = v_fid
          and (p_txn_from is null or transaction_id in (
                select id from transactions
                where family_id = v_fid and txn_date >= p_txn_from))) tp),
    'incomes', (
      select coalesce(json_agg(row_to_json(inc)), '[]'::json) from (
        select amount, amount_enc, income_date
        from incomes where family_id = v_fid) inc),
    'saving_goals', (
      select coalesce(json_agg(row_to_json(sg) order by sg.sort_order), '[]'::json) from (
        select id, name, name_enc, emoji, target_amount, target_amount_enc, target_date, note, note_enc, occasion_id, achieved, sort_order, created_by
        from saving_goals where family_id = v_fid and archived_at is null) sg),
    'reactions', (
      select coalesce(json_agg(row_to_json(rx) order by rx.created_at desc), '[]'::json) from (
        select id, transaction_id, member_id, emoji, created_at
        from reactions
        where family_id = v_fid
          and (p_txn_from is null or transaction_id in (
                select id from transactions
                where family_id = v_fid and txn_date >= p_txn_from))) rx),
    'request_reviews', (
      select coalesce(json_agg(row_to_json(rr) order by rr.created_at desc), '[]'::json) from (
        select id, entity_type, entity_id, member_id, emoji, created_at
        from request_reviews where family_id = v_fid) rr)
  ) into v_json;

  return v_json;
end $function$;

-- ── 7. default categories seed their claims ──────────────────────────────────
-- Body is 0055 verbatim (name/emoji/color/sort_order MUST stay in lock-step with
-- DEFAULT_CATS in the client — see 0055 for why) plus one claims value per row.
-- The catch-all "Others" label (claims '*') is appended by the client and is not
-- a DB row. Plaintext claims here ride the same path as plaintext name: the
-- client coverage job encrypts them for enc families.
create or replace function seed_default_categories(p_family_id uuid, p_language language_code)
returns void
language plpgsql security definer set search_path = public as $$
begin
  insert into categories (family_id, name, emoji, color, sort_order, claims) values
    (p_family_id, case when p_language='vi' then 'Nhà ở'    else 'Housing'   end, '🏠', '#7E6BE0', 1, '["home"]'),
    (p_family_id, case when p_language='vi' then 'Đi chợ'   else 'Groceries' end, '🛒', '#1FA971', 2, '["groceries"]'),
    (p_family_id, case when p_language='vi' then 'Ăn ngoài' else 'Dining'    end, '🍽️', '#E14B8A', 3, '["eatout","drinks"]'),
    (p_family_id, case when p_language='vi' then 'Đi lại'   else 'Transport' end, '🚗', '#12B5A6', 4, '["transport"]'),
    (p_family_id, case when p_language='vi' then 'Giải trí' else 'Fun'       end, '🎉', '#9D4EFF', 5, '["leisure"]'),
    (p_family_id, case when p_language='vi' then 'Mua sắm'  else 'Shopping'  end, '🛍️', '#E8843C', 6, '["shopping"]');
end $$;

-- ── 8a. scrub: node + claims join the plaintext wipe (extends 0038) ──────────
-- Body is 0038 §3 verbatim. Changes: transactions wipe also nulls `node`
-- (rides on amount_enc like note does), categories wipe also nulls `claims`
-- (rides on name_enc). The uncovered-row COUNT is deliberately unchanged — see
-- the header: no DB guard covers these pairs, so counting them could block
-- "Hoàn tất" on a family whose client never covered them.
create or replace function public.scrub_plaintext_amounts() returns json
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid(); v_fid uuid; v_cur text; v_counts json; v_unc int;
  n_tx int; n_inc int; n_se int; n_ef int; n_cb int; n_mb int; n_ev int; n_sg int;
  n_cat int; n_mem int; n_em int;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  select family_id into v_fid from profiles where id = v_uid;
  if v_fid is null then raise exception 'you are not in a family'; end if;
  if not _is_owner(v_fid) then raise exception 'only the owner can scrub'; end if;
  select enc_state into v_cur from family_keys where family_id = v_fid;
  if v_cur is distinct from 'dual' then raise exception 'scrub requires dual state'; end if;

  select
    (select count(*) from transactions    where family_id = v_fid and ((amount is not null and amount_enc is null) or (note is not null and note_enc is null)))
  + (select count(*) from incomes         where family_id = v_fid and ((amount is not null and amount_enc is null) or (note is not null and note_enc is null)))
  + (select count(*) from savings_entries where family_id = v_fid and ((amount is not null and amount_enc is null) or (note is not null and note_enc is null)))
  + (select count(*) from event_fundings  where family_id = v_fid and amount is not null and amount_enc is null)
  + (select count(*) from category_budgets where family_id = v_fid and amount is not null and amount_enc is null)
  + (select count(*) from monthly_budgets where family_id = v_fid and budget_total <> 0 and budget_total_enc is null)
  + (select count(*) from events          where family_id = v_fid and ((target_amount is not null and target_amount_enc is null) or (name is not null and name_enc is null)))
  + (select count(*) from saving_goals    where family_id = v_fid and ((target_amount is not null and target_amount_enc is null) or (name is not null and name_enc is null) or (note is not null and note_enc is null)))
  + (select count(*) from categories      where family_id = v_fid and name is not null and name_enc is null)
  + (select count(*) from members         where family_id = v_fid and name is not null and name_enc is null)
  + (select count(*) from event_memories  where family_id = v_fid and caption is not null and caption_enc is null)
  into v_unc;
  if v_unc > 0 then raise exception 'uncovered_rows:%', v_unc; end if;

  update transactions set amount = null, note = null, node = null
   where family_id = v_fid and amount_enc is not null and (amount is not null or note is not null or node is not null);
  get diagnostics n_tx = row_count;
  update incomes set amount = null, note = null
   where family_id = v_fid and amount_enc is not null and (amount is not null or note is not null);
  get diagnostics n_inc = row_count;
  update savings_entries set amount = null, note = null
   where family_id = v_fid and amount_enc is not null and (amount is not null or note is not null);
  get diagnostics n_se = row_count;
  update event_fundings set amount = null
   where family_id = v_fid and amount_enc is not null and amount is not null;
  get diagnostics n_ef = row_count;
  update category_budgets set amount = null
   where family_id = v_fid and amount_enc is not null and amount is not null;
  get diagnostics n_cb = row_count;
  update monthly_budgets set budget_total = 0
   where family_id = v_fid and budget_total_enc is not null and budget_total <> 0;
  get diagnostics n_mb = row_count;
  update events
     set target_amount = case when target_amount_enc is not null then null else target_amount end,
         name          = case when name_enc          is not null then null else name          end
   where family_id = v_fid
     and ((target_amount_enc is not null and target_amount is not null)
       or (name_enc is not null and name is not null));
  get diagnostics n_ev = row_count;
  update saving_goals
     set target_amount = case when target_amount_enc is not null then null else target_amount end,
         name          = case when name_enc          is not null then null else name          end,
         note          = case when name_enc          is not null then null else note          end
   where family_id = v_fid
     and ((target_amount_enc is not null and target_amount is not null)
       or (name_enc is not null and (name is not null or note is not null)));
  get diagnostics n_sg = row_count;
  update categories set name = null, claims = null
   where family_id = v_fid and name_enc is not null and (name is not null or claims is not null);
  get diagnostics n_cat = row_count;
  update members set name = null
   where family_id = v_fid and name_enc is not null and name is not null;
  get diagnostics n_mem = row_count;
  update event_memories set caption = null
   where family_id = v_fid and caption_enc is not null and caption is not null;
  get diagnostics n_em = row_count;

  update family_keys set enc_state = 'enc' where family_id = v_fid;
  v_counts := json_build_object('transactions', n_tx, 'incomes', n_inc, 'savings_entries', n_se,
    'event_fundings', n_ef, 'category_budgets', n_cb, 'monthly_budgets', n_mb,
    'events', n_ev, 'saving_goals', n_sg,
    'categories', n_cat, 'members', n_mem, 'event_memories', n_em);
  return v_counts;
end $$;

-- ── 8b. dual→off abort also wipes node_enc / claims_enc (extends 0038 §4) ────
-- Required by the scrub change above: 0035's rule is that an aborted trial
-- leaves NO ciphertext behind, otherwise a later re-enable meets stale ct
-- (old DEK) beside edited plaintext, the cover job skips the row, and the
-- scrub would then null the plaintext and leave an undecryptable node_enc as
-- the only copy. Body is 0038 §4 verbatim plus the two new columns.
create or replace function public.set_family_enc_state(p_state text) returns void
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_fid uuid; v_cur text;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  select family_id into v_fid from profiles where id = v_uid;
  if v_fid is null then raise exception 'you are not in a family'; end if;
  if not _is_owner(v_fid) then raise exception 'only the owner can change encryption'; end if;
  select enc_state into v_cur from family_keys where family_id = v_fid;
  if v_cur is null then raise exception 'no_passcode'; end if;
  if v_cur = 'enc' then raise exception 'enc_permanent'; end if;
  if not ( (v_cur = 'off' and p_state = 'dual')
        or (v_cur = 'dual' and p_state = 'off') ) then
    raise exception 'bad_transition:% to %', v_cur, p_state;
  end if;
  if v_cur = 'dual' and p_state = 'off' then
    -- abort the trial: plaintext is authoritative, drop every ciphertext so a
    -- future enable starts from a clean slate
    update transactions     set amount_enc = null, note_enc = null, node_enc = null where family_id = v_fid and (amount_enc is not null or note_enc is not null or node_enc is not null);
    update incomes          set amount_enc = null, note_enc = null      where family_id = v_fid and (amount_enc is not null or note_enc is not null);
    update savings_entries  set amount_enc = null, note_enc = null      where family_id = v_fid and (amount_enc is not null or note_enc is not null);
    update event_fundings   set amount_enc = null                       where family_id = v_fid and amount_enc is not null;
    update category_budgets set amount_enc = null                       where family_id = v_fid and amount_enc is not null;
    update monthly_budgets  set budget_total_enc = null                 where family_id = v_fid and budget_total_enc is not null;
    update events           set target_amount_enc = null, name_enc = null where family_id = v_fid and (target_amount_enc is not null or name_enc is not null);
    update saving_goals     set target_amount_enc = null, name_enc = null, note_enc = null where family_id = v_fid and (target_amount_enc is not null or name_enc is not null or note_enc is not null);
    update categories       set name_enc = null, claims_enc = null      where family_id = v_fid and (name_enc is not null or claims_enc is not null);
    update members          set name_enc = null                         where family_id = v_fid and name_enc is not null;
    update event_memories   set caption_enc = null                      where family_id = v_fid and caption_enc is not null;
  end if;
  update family_keys set enc_state = p_state where family_id = v_fid;
end $$;

-- ── 9. grants ────────────────────────────────────────────────────────────────
-- transactions, categories, personal_transactions, merchant_corrections use
-- TABLE-level grants (0004 + Supabase default privileges) behind RLS, with no
-- column-level grant list to extend (checked: the only column-level grants in
-- this schema are profiles/0004, mailbox_grants/0087/0089/0102/0121 and
-- personal_keys/0091). merchant_concepts is service_role-only (0126) and the
-- service role bypasses RLS. Nothing further needed; personal_labels is
-- granted in §3.

-- TODO(0145): occurred_time / occurred_time_enc (0096) never joined the scrub
-- or the dual→off wipe either; the same two-line extension applies if that
-- gap is ever closed. Out of scope here (this file adds only tree columns).
