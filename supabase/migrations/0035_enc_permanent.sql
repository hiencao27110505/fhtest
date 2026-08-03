-- ============================================================================
-- FamilyHub — 0035: encryption is PERMANENT once committed
--
-- Product decision (2026-08-03): the promise to users is absolute — after a
-- family finishes encryption ('enc'), there is no way back, for anyone,
-- including the owner. Unmasked data can never be given back to the database.
--
--   • 'enc' becomes a terminal state: set_family_enc_state raises
--     'enc_permanent' on any transition out of it. The decrypt-back path
--     (enc→dual + client-side plaintext restore) is gone.
--   • The trial window keeps its exit: 'dual' still aborts to 'off', because
--     in dual the plaintext never left the server — nothing is "given back".
--     Aborting now also WIPES all ciphertext columns server-side, so a later
--     re-enable can never meet stale ciphertext beside edited plaintext
--     (the cover job skips rows that already have ct; stale ct would poison
--     a future scrub).
--   • The 0033 triggers already reject any plaintext write in 'enc'; their
--     dual-state un-encrypt exemption is exactly the shape of this wipe and
--     of nothing else that remains, so they stay unchanged.
--
-- Applied to production (fhtest) via Supabase MCP on 2026-08-03.
-- ============================================================================

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
    update transactions     set amount_enc = null, note_enc = null      where family_id = v_fid and (amount_enc is not null or note_enc is not null);
    update incomes          set amount_enc = null, note_enc = null      where family_id = v_fid and (amount_enc is not null or note_enc is not null);
    update savings_entries  set amount_enc = null, note_enc = null      where family_id = v_fid and (amount_enc is not null or note_enc is not null);
    update event_fundings   set amount_enc = null                       where family_id = v_fid and amount_enc is not null;
    update category_budgets set amount_enc = null                       where family_id = v_fid and amount_enc is not null;
    update monthly_budgets  set budget_total_enc = null                 where family_id = v_fid and budget_total_enc is not null;
    update events           set target_amount_enc = null, name_enc = null where family_id = v_fid and (target_amount_enc is not null or name_enc is not null);
    update saving_goals     set target_amount_enc = null, name_enc = null, note_enc = null where family_id = v_fid and (target_amount_enc is not null or name_enc is not null or note_enc is not null);
  end if;
  update family_keys set enc_state = p_state where family_id = v_fid;
end $$;
