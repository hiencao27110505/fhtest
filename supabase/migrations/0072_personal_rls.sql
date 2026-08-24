-- 0072 — RLS access to the personal container (fixes 0071's wrong assumption)
--
-- All data-table policies gate on auth_family_id() — the ACTIVE family from
-- profiles — not on membership. The personal ledger is never the active family
-- (by design, 0071), so every client read/write against it was silently empty
-- or denied: hydrate returned nothing, _findMemberId() = null, and the mirror
-- never passed its gates ("Đang đồng bộ…" forever).
--
-- Surgical fix: each relevant policy becomes
--     family_id = auth_family_id()  OR  family_id = auth_personal_id()
-- i.e. the family surface is untouched, plus exactly ONE extra container — the
-- caller's own single-member personal ledger. No cross-family widening.

create or replace function public.auth_personal_id() returns uuid
language sql stable security definer set search_path = public as $$
  select id from families
   where owner_id = auth.uid() and type = 'personal' and archived_at is null
   limit 1
$$;
revoke execute on function public.auth_personal_id() from public, anon;
grant execute on function public.auth_personal_id() to authenticated;

-- transactions: all four verbs
alter policy transactions_select on public.transactions
  using ((family_id = (select auth_family_id())) or (family_id = (select auth_personal_id())));
alter policy transactions_insert on public.transactions
  with check ((family_id = (select auth_family_id())) or (family_id = (select auth_personal_id())));
alter policy transactions_update on public.transactions
  using ((family_id = (select auth_family_id())) or (family_id = (select auth_personal_id())))
  with check ((family_id = (select auth_family_id())) or (family_id = (select auth_personal_id())));
alter policy transactions_delete on public.transactions
  using ((family_id = (select auth_family_id())) or (family_id = (select auth_personal_id())));

-- incomes: all four verbs
alter policy incomes_select on public.incomes
  using ((family_id = (select auth_family_id())) or (family_id = (select auth_personal_id())));
alter policy incomes_insert on public.incomes
  with check ((family_id = (select auth_family_id())) or (family_id = (select auth_personal_id())));
alter policy incomes_update on public.incomes
  using ((family_id = (select auth_family_id())) or (family_id = (select auth_personal_id())))
  with check ((family_id = (select auth_family_id())) or (family_id = (select auth_personal_id())));
alter policy incomes_delete on public.incomes
  using ((family_id = (select auth_family_id())) or (family_id = (select auth_personal_id())));

-- categories: read + create-on-miss (mirror) + rename later
alter policy categories_select on public.categories
  using ((family_id = (select auth_family_id())) or (family_id = (select auth_personal_id())));
alter policy categories_insert on public.categories
  with check ((family_id = (select auth_family_id())) or (family_id = (select auth_personal_id())));
alter policy categories_update on public.categories
  using ((family_id = (select auth_family_id())) or (family_id = (select auth_personal_id())));

-- members: read (personal member-id lookup)
alter policy members_select on public.members
  using ((family_id = (select auth_family_id())) or (family_id = (select auth_personal_id())));

-- key material: enc profile + card wrap (new-device personal unlock)
alter policy family_keys_select on public.family_keys
  using ((family_id = (select auth_family_id())) or (family_id = (select auth_personal_id())));
alter policy fkw_select on public.family_key_wraps
  using ((family_id = (select auth_family_id())) or (family_id = (select auth_personal_id())));
