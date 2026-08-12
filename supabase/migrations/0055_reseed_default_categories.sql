-- ---------------------------------------------------------------------------
-- 0055 — reseed default categories to match the app (src/js-ui/80-onboard-boot.js
--        DEFAULT_CATS). "Con cái"/Kids is dropped as a default (a family without
--        kids shouldn't start with an empty kids line) and "Mua sắm"/Shopping is
--        added in its place at sort_order 6.
--
-- Why this must match the app EXACTLY (name, emoji, color, sort_order):
--   create_family() seeds these server-side, and createFamilyInDB()
--   (70-goals-income-onboard-ui.js) maps the per-category budgets the user set in
--   onboarding back onto these rows BY sort_order → catOrder position. If the 6th
--   seeded category is "Con cái" while the app's 6th is "Mua sắm", the Shopping
--   budget lands on Kids and, after the first hydrate, Settings shows Con cái with a
--   Shopping budget and no Mua sắm — the onboarding and in-app category/budget state
--   diverge. Keeping the two in lock-step is what "synced" means here.
--
-- Scope: NEW families only. Existing families keep whatever categories they have
-- (this only changes what future create_family calls seed) — no backfill.
-- ---------------------------------------------------------------------------
create or replace function seed_default_categories(p_family_id uuid, p_language language_code)
returns void
language plpgsql security definer set search_path = public as $$
begin
  insert into categories (family_id, name, emoji, color, sort_order) values
    (p_family_id, case when p_language='vi' then 'Nhà ở'    else 'Housing'   end, '🏠', '#7E6BE0', 1),
    (p_family_id, case when p_language='vi' then 'Đi chợ'   else 'Groceries' end, '🛒', '#1FA971', 2),
    (p_family_id, case when p_language='vi' then 'Ăn ngoài' else 'Dining'    end, '🍽️', '#E14B8A', 3),
    (p_family_id, case when p_language='vi' then 'Đi lại'   else 'Transport' end, '🚗', '#12B5A6', 4),
    (p_family_id, case when p_language='vi' then 'Giải trí' else 'Fun'       end, '🎉', '#9D4EFF', 5),
    (p_family_id, case when p_language='vi' then 'Mua sắm'  else 'Shopping'  end, '🛍️', '#E8843C', 6);
end $$;
