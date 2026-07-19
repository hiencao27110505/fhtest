-- ============================================================================
-- FamilyHub — 0008 realtime
-- Publish the family tables so the app's realtime channel receives changes,
-- with REPLICA IDENTITY FULL so RLS-filtered UPDATE/DELETE streams carry family_id.
-- ============================================================================
do $$
declare t text;
begin
  foreach t in array array[
    'transactions','events','event_fundings','savings_entries','category_budgets',
    'monthly_budgets','members','categories','event_memories','transaction_photos'
  ] loop
    begin
      execute format('alter publication supabase_realtime add table public.%I', t);
    exception when duplicate_object then null; end;
    execute format('alter table public.%I replica identity full', t);
  end loop;
end $$;
