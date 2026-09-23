-- 0151 ▸ "Gộp vào tài khoản khác" — merging two accounts is a HUMAN act
-- (docs/specs/account-identity-spec.md §2, P7).
--
-- The registry (0150) ends the machine-made duplicate class, but no registry
-- can know everything: prose it has never seen still folds to its own slug,
-- and a person can hand-create a twin. The way out must not be an operator
-- with SQL. This RPC is the device's arm-then-confirm target: every row of
-- the source re-tagged to the destination and the emptied source deleted, in
-- ONE transaction — a half-moved merge can never exist.
--
-- Auto-merge remains rejected (P7): nothing calls this but the person's
-- confirmed tap. Guards live HERE, not only in the sheet, because the RPC is
-- callable by any authenticated client:
--   · both accounts must exist, be alive, and belong to the caller;
--   · never across the investment / non-investment line — a position's rows
--     (quantity, price memory) are meaningless on a cash account and vice
--     versa;
--   · self-merge refused.
-- Kind DIFFERENCES inside a line (card into deposit…) are allowed — kind is
-- editable metadata, not identity (full-ledger T12) — the confirm sheet shows
-- both kinds so the person sees what they are folding.
--
-- Moves every reference the schema has (0105 account_id, 0123
-- position_account_id on transactions, 0123 review memory), then deletes the
-- source row outright: nothing points at it any more, and keeping an archived
-- husk would re-occupy its (provider, tail) slot in personal_accounts_uniq.
-- The source's anchor dies with it; the destination's anchor stands, and the
-- moved rows count against it from now on — re-anchoring afterwards is the
-- same one tap it always was.

create or replace function public.merge_personal_accounts(p_src uuid, p_dst uuid)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_uid  uuid := auth.uid();
  v_src  public.personal_accounts%rowtype;
  v_dst  public.personal_accounts%rowtype;
  v_txn  integer := 0;
  v_n    integer;
begin
  if v_uid is null then raise exception 'not signed in'; end if;
  if p_src = p_dst then raise exception 'merge: source and destination are the same account'; end if;

  select * into v_src from public.personal_accounts
    where id = p_src and owner_user_id = v_uid and archived_at is null for update;
  if not found then raise exception 'merge: source account not found'; end if;
  select * into v_dst from public.personal_accounts
    where id = p_dst and owner_user_id = v_uid and archived_at is null for update;
  if not found then raise exception 'merge: destination account not found'; end if;

  if (v_src.kind = 'investment') <> (v_dst.kind = 'investment') then
    raise exception 'merge: cannot cross the investment line';
  end if;

  update public.personal_transactions set account_id = p_dst
    where owner_user_id = v_uid and account_id = p_src;
  get diagnostics v_n = row_count; v_txn := v_txn + v_n;

  update public.personal_transactions set position_account_id = p_dst
    where owner_user_id = v_uid and position_account_id = p_src;
  get diagnostics v_n = row_count; v_txn := v_txn + v_n;

  update public.personal_review_memory set position_account_id = p_dst
    where owner_user_id = v_uid and position_account_id = p_src;

  delete from public.personal_accounts where id = p_src and owner_user_id = v_uid;

  return v_txn;
end;
$$;

comment on function public.merge_personal_accounts(uuid, uuid) is
  'Account merge (account-identity-spec P7): re-tags every reference from src to dst and deletes src, atomically. Owner-only, alive accounts only, never across the investment line. Returns transaction rows moved.';
