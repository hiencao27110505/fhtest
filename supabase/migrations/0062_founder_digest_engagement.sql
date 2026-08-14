-- 0062_founder_digest_engagement.sql
-- Extend the founder daily digest with an engagement line: distinct contributing
-- MEMBERS in the last 24h per activity — reactions, mood (member_weather),
-- expense logging (transactions), plan setting (saving_goals).
--
-- PRIVACY: still pure COUNT(DISTINCT ...) aggregates. No names/ids/amounts leave
-- the DB. Consistent with the E2EE + push-payload policy.
--
-- Notes:
--   * All four normalized to distinct members. reactions/member_weather/transactions
--     carry member_id directly; saving_goals carries created_by (auth user), so it's
--     mapped back to a member via (family_id, user_id).
--   * member_weather is an upsert (only updated_at, no history) — this counts distinct
--     users who SET/changed a mood in the window, not the number of mood changes.

create or replace function public._tg_daily_digest()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  f24 int; m24 int; f7 int; m7 int;
  react_u int; mood_u int; exp_u int; plan_u int;
begin
  -- growth (unchanged)
  select count(*) into f24 from public.families where created_at >= now() - interval '24 hours';
  select count(*) into f7  from public.families where created_at >= now() - interval '7 days';

  select count(*) into m24
    from public.members m join public.families f on f.id = m.family_id
    where m.key_unlocked_at >= now() - interval '24 hours'
      and m.user_id is not null and m.user_id <> f.owner_id and m.is_shared is not true;

  select count(*) into m7
    from public.members m join public.families f on f.id = m.family_id
    where m.key_unlocked_at >= now() - interval '7 days'
      and m.user_id is not null and m.user_id <> f.owner_id and m.is_shared is not true;

  -- engagement: distinct contributing members in the last 24h
  select count(distinct member_id) into react_u
    from public.reactions where created_at >= now() - interval '24 hours';

  select count(distinct member_id) into mood_u
    from public.member_weather where updated_at >= now() - interval '24 hours';

  select count(distinct member_id) into exp_u
    from public.transactions where created_at >= now() - interval '24 hours';

  select count(distinct m.id) into plan_u
    from public.saving_goals sg
    join public.members m on m.family_id = sg.family_id and m.user_id = sg.created_by
    where sg.created_at >= now() - interval '24 hours';

  perform public._tg_send(
    '📊 FamilyHub — hôm nay: +' || f24 || ' gia đình, +' || m24 || ' thành viên' ||
    E'\n🙋 Đóng góp hôm nay: ❤️ ' || react_u || ' cảm xúc · 🌤️ ' || mood_u ||
      ' tâm trạng · 🧾 ' || exp_u || ' chi tiêu · 🎯 ' || plan_u || ' kế hoạch' ||
    E'\n7 ngày: ' || f7 || ' gia đình, ' || m7 || ' thành viên'
  );
end;
$$;
