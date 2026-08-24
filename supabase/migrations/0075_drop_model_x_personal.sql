-- 0075 — purge Model X personal data (destructive; separated from 0074 for review)
--
-- After 0074, the old type='personal' families are inert (Model-Y client ignores
-- them; 0073 excludes them from metrics; clients filter them from pickers). This
-- deletes them and their rows for good. Safe to run any time.
do $$
declare v_ids uuid[];
begin
  select array_agg(id) into v_ids from families where type = 'personal';
  if v_ids is not null then
    delete from transaction_photos where family_id = any(v_ids);
    delete from transactions      where family_id = any(v_ids);
    delete from categories        where family_id = any(v_ids);
    delete from family_key_wraps  where family_id = any(v_ids);
    delete from family_keys       where family_id = any(v_ids);
    delete from members           where family_id = any(v_ids);
    delete from families          where id = any(v_ids);
  end if;
end $$;
