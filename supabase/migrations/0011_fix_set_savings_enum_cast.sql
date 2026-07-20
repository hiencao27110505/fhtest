-- FamilyHub — 0011: fix set_savings enum cast
-- Bug: the CASE expression resolves to `text`; column `kind` is `savings_kind`.
-- Postgres has no implicit text->enum assignment cast, so the INSERT raised
-- "column kind is of type savings_kind but expression is of type text" (HTTP 400),
-- which broke the "Saved for events" savings adjustment entirely.
-- Fix: cast the CASE result explicitly to savings_kind.
create or replace function public.set_savings(p_amount numeric)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v_uid uuid := auth.uid(); v_family uuid; v_bal numeric; v_delta numeric; v_mid uuid;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  if p_amount < 0 then raise exception 'amount must be >= 0'; end if;
  select family_id into v_family from profiles where id = v_uid;
  if v_family is null then raise exception 'no family'; end if;
  select coalesce(sum(case when kind='deposit' then amount else -amount end),0) into v_bal
    from savings_entries where family_id = v_family;
  v_bal := v_bal - coalesce((select sum(amount) from event_fundings where family_id = v_family and source='savings'),0);
  v_delta := p_amount - v_bal;
  if v_delta = 0 then return; end if;
  select id into v_mid from members where family_id = v_family and user_id = v_uid and not is_shared limit 1;
  insert into savings_entries (family_id, member_id, kind, amount, note, entry_date)
  values (v_family, v_mid,
          (case when v_delta > 0 then 'deposit' else 'withdrawal' end)::savings_kind,
          abs(v_delta), 'Adjust savings', current_date);
end $function$;

-- CREATE OR REPLACE preserves ACLs; re-assert them so this migration is self-contained.
revoke execute on function public.set_savings(numeric) from public, anon;
grant  execute on function public.set_savings(numeric) to authenticated;
