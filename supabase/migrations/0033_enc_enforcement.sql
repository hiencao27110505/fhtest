-- ============================================================================
-- FamilyHub — 0033: DATABASE-level encryption enforcement
--
-- Client guards (0030/strict mode) stop up-to-date apps from writing plaintext
-- money once a family's encryption is on — but a stale app version bypasses
-- client code by definition. These triggers make the DATABASE the enforcer:
-- once enc_state != 'off', a money write that doesn't carry ciphertext is
-- rejected outright, so an uncovered plaintext row can never be created again
-- and the "re-encrypt missed rows" step ceases to exist.
--
-- Pair rules (per protected column pair pt/ct), applied by _fh_enc_pair():
--   • dual/enc, any write: plaintext present without ciphertext → reject —
--     EXCEPT the explicit un-encrypt shape on UPDATE (old row HAD ct, new row
--     clears it while materializing plaintext): that is decrypt-back at work.
--   • dual, UPDATE: plaintext changed while ciphertext unchanged → reject
--     (a stale-app edit would otherwise leave a mismatched pt/ct pair).
--   • enc, any write: plaintext must be NULL (ciphertext is the only copy).
-- monthly_budgets.budget_total treats 0 as "empty" (NOT NULL scrub placeholder,
-- and ensure_monthly_budget() auto-creates {budget_total: 0} bucket rows).
--
-- scrub_plaintext_amounts() additionally refuses to run while ANY uncovered
-- row exists ('uncovered_rows:<n>') — with the triggers, that can only mean an
-- interrupted enable job, which the encryption sheet auto-resumes.
--
-- NOTE for the (dormant) bank-email pipeline: server-side inserts of parsed
-- amounts into an encrypted family will be rejected by design. When that
-- feature activates for encrypted families, it needs its own explicit lane.
--
-- Applied to production (fhtest) via Supabase MCP on 2026-08-03.
-- ============================================================================

create or replace function public._fh_enc_pair(
  p_state text, p_op text, p_label text,
  p_new_pt text, p_new_ct text, p_old_pt text, p_old_ct text
) returns void
language plpgsql immutable as $$
begin
  -- plaintext without ciphertext (un-encrypt shape allowed outside 'enc')
  if p_new_pt is not null and p_new_ct is null
     and not (p_state <> 'enc' and p_op = 'UPDATE' and p_old_ct is not null) then
    raise exception 'enc_required:%', p_label;
  end if;
  -- stale pair: a NEW plaintext value arrives while ciphertext is untouched
  -- (p_new_pt must be non-null: nulling plaintext with the same ct is the
  -- scrub's own shape and must pass)
  if p_op = 'UPDATE' and p_new_pt is not null and p_new_ct is not null
     and p_new_pt is distinct from p_old_pt and p_new_ct is not distinct from p_old_ct then
    raise exception 'enc_required:%', p_label;
  end if;
  -- fully encrypted: no plaintext, period
  if p_state = 'enc' and p_new_pt is not null then
    raise exception 'enc_required:%', p_label;
  end if;
end $$;

create or replace function public._fh_enc_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_state text; v_old_row record;
begin
  select enc_state into v_state from family_keys where family_id = new.family_id;
  if v_state is null or v_state = 'off' then return new; end if;

  if tg_table_name = 'transactions' then
    perform _fh_enc_pair(v_state, tg_op, 'transactions.amount', new.amount::text, new.amount_enc,
      case when tg_op = 'UPDATE' then old.amount::text end, case when tg_op = 'UPDATE' then old.amount_enc end);
    perform _fh_enc_pair(v_state, tg_op, 'transactions.note', new.note, new.note_enc,
      case when tg_op = 'UPDATE' then old.note end, case when tg_op = 'UPDATE' then old.note_enc end);
  elsif tg_table_name = 'incomes' then
    perform _fh_enc_pair(v_state, tg_op, 'incomes.amount', new.amount::text, new.amount_enc,
      case when tg_op = 'UPDATE' then old.amount::text end, case when tg_op = 'UPDATE' then old.amount_enc end);
    perform _fh_enc_pair(v_state, tg_op, 'incomes.note', new.note, new.note_enc,
      case when tg_op = 'UPDATE' then old.note end, case when tg_op = 'UPDATE' then old.note_enc end);
  elsif tg_table_name = 'savings_entries' then
    perform _fh_enc_pair(v_state, tg_op, 'savings_entries.amount', new.amount::text, new.amount_enc,
      case when tg_op = 'UPDATE' then old.amount::text end, case when tg_op = 'UPDATE' then old.amount_enc end);
    perform _fh_enc_pair(v_state, tg_op, 'savings_entries.note', new.note, new.note_enc,
      case when tg_op = 'UPDATE' then old.note end, case when tg_op = 'UPDATE' then old.note_enc end);
  elsif tg_table_name = 'event_fundings' then
    perform _fh_enc_pair(v_state, tg_op, 'event_fundings.amount', new.amount::text, new.amount_enc,
      case when tg_op = 'UPDATE' then old.amount::text end, case when tg_op = 'UPDATE' then old.amount_enc end);
  elsif tg_table_name = 'category_budgets' then
    perform _fh_enc_pair(v_state, tg_op, 'category_budgets.amount', new.amount::text, new.amount_enc,
      case when tg_op = 'UPDATE' then old.amount::text end, case when tg_op = 'UPDATE' then old.amount_enc end);
  elsif tg_table_name = 'monthly_budgets' then
    perform _fh_enc_pair(v_state, tg_op, 'monthly_budgets.budget_total', nullif(new.budget_total, 0)::text, new.budget_total_enc,
      case when tg_op = 'UPDATE' then nullif(old.budget_total, 0)::text end, case when tg_op = 'UPDATE' then old.budget_total_enc end);
  elsif tg_table_name = 'events' then
    perform _fh_enc_pair(v_state, tg_op, 'events.target_amount', new.target_amount::text, new.target_amount_enc,
      case when tg_op = 'UPDATE' then old.target_amount::text end, case when tg_op = 'UPDATE' then old.target_amount_enc end);
    perform _fh_enc_pair(v_state, tg_op, 'events.name', new.name, new.name_enc,
      case when tg_op = 'UPDATE' then old.name end, case when tg_op = 'UPDATE' then old.name_enc end);
  elsif tg_table_name = 'saving_goals' then
    perform _fh_enc_pair(v_state, tg_op, 'saving_goals.target_amount', new.target_amount::text, new.target_amount_enc,
      case when tg_op = 'UPDATE' then old.target_amount::text end, case when tg_op = 'UPDATE' then old.target_amount_enc end);
    perform _fh_enc_pair(v_state, tg_op, 'saving_goals.name', new.name, new.name_enc,
      case when tg_op = 'UPDATE' then old.name end, case when tg_op = 'UPDATE' then old.name_enc end);
    perform _fh_enc_pair(v_state, tg_op, 'saving_goals.note', new.note, new.note_enc,
      case when tg_op = 'UPDATE' then old.note end, case when tg_op = 'UPDATE' then old.note_enc end);
  end if;
  return new;
end $$;

do $$
declare t text;
begin
  foreach t in array array['transactions','incomes','savings_entries','event_fundings',
                           'category_budgets','monthly_budgets','events','saving_goals'] loop
    execute format('drop trigger if exists trg_%1$s_enc_guard on public.%1$I;
                    create trigger trg_%1$s_enc_guard before insert or update on public.%1$I
                      for each row execute function public._fh_enc_guard()', t);
  end loop;
end $$;

-- scrub now refuses while uncovered rows exist (only an interrupted enable can
-- produce them anymore; the sheet auto-resumes, then Hoàn tất goes through)
create or replace function public.scrub_plaintext_amounts() returns json
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid(); v_fid uuid; v_cur text; v_counts json; v_unc int;
  n_tx int; n_inc int; n_se int; n_ef int; n_cb int; n_mb int; n_ev int; n_sg int;
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
  into v_unc;
  if v_unc > 0 then raise exception 'uncovered_rows:%', v_unc; end if;

  update transactions set amount = null, note = null
   where family_id = v_fid and amount_enc is not null and (amount is not null or note is not null);
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

  update family_keys set enc_state = 'enc' where family_id = v_fid;
  v_counts := json_build_object('transactions', n_tx, 'incomes', n_inc, 'savings_entries', n_se,
    'event_fundings', n_ef, 'category_budgets', n_cb, 'monthly_budgets', n_mb,
    'events', n_ev, 'saving_goals', n_sg);
  return v_counts;
end $$;
