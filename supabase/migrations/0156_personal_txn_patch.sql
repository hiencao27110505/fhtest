-- 0156 ▸ "Áp dụng cho khoản giống" writes in ONE transaction
-- (docs/specs/apply-to-similar-spec.md §17, L14–L18).
--
-- The ledger carry changed N booked rows with N separate PATCHes, after a
-- first one for the row being edited. Two things were wrong with that:
--   · every request was its own chance to stall on a dead mobile socket, and
--     the first stall failed the whole save (2026-10-02: a 12-row carry
--     waited out the 60 s fetch cap and reported "Chưa lưu được");
--   · a failure in the middle left some rows changed and the rest not.
-- This RPC takes the whole set and applies it in one transaction: every row
-- lands or none does, in one request the device can safely repeat.
--
-- p_rows is a JSON array of { "id": uuid, "set": { column: value | null } }.
-- A key PRESENT in "set" is written (null clears); a key absent is left
-- alone — the same undefined / null contract the device's writers have always
-- had. Only the columns a person can edit on a booked row are accepted, and
-- an unknown key is refused rather than ignored, so a typo cannot pass as a
-- successful no-op.
--
-- Guards live HERE (the RPC is callable by any authenticated client):
--   · owner only — auth.uid(), on top of the table's RLS (security invoker);
--   · a mirror master (link_id set) is machine-owned: only its node may be
--     patched, exactly as fhPersonalSetNode allowed. Anything else on a
--     mirror is skipped, not written;
--   · at most 500 rows a call.
-- A row that is gone, or not the caller's, is SKIPPED and simply absent from
-- the result: the caller learns which ids were written and says so. Values
-- are ciphertext produced on the device; nothing here can read them.
--
-- Idempotent by construction (it sets fixed values), which is what makes the
-- device's retry-on-network-error safe.

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
                                  'occurred_time_enc','txn_date','account_id','node_enc','label_id'];
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
      label_id          = case when v_set ? 'label_id'          then (v_set->>'label_id')::uuid      else t.label_id end
    where t.id = v_id and t.owner_user_id = v_uid
      and (t.link_id is null or (v_set - 'node_enc') = '{}'::jsonb);
    if found then v_done := array_append(v_done, v_id); end if;
  end loop;

  return v_done;
end;
$$;

revoke all on function public.personal_txn_patch(jsonb) from public, anon;
grant execute on function public.personal_txn_patch(jsonb) to authenticated;

comment on function public.personal_txn_patch(jsonb) is
  'Atomic multi-row edit of the caller''s personal ledger rows (apply-to-similar-spec §17). p_rows = [{id, set:{column: value|null}}]; present keys are written, absent keys untouched. Owner-only; a mirror master accepts node_enc alone. Returns the ids written; missing rows are skipped.';
