-- 0064_founder_digest_prev_full_day.sql
-- Shift the founder pipeline to report on the PREVIOUS FULL Vietnam calendar day.
--   * Digest fires 06:00 Asia/Ho_Chi_Minh (23:00 UTC) — the morning after.
--   * Snapshot fires 00:05 Asia/Ho_Chi_Minh (17:05 UTC) — checkpoints the day that just ended.
-- Daily metrics are bounded to [yesterday 00:00 VN, today 00:00 VN) via `at time zone
-- 'Asia/Ho_Chi_Minh'`, so each "hôm qua" number is a complete Vietnam day — no rolling
-- window, no UTC skew. Rolling 7-day / state metrics unchanged in spirit.
--
-- PRIVACY: unchanged — all COUNT/COUNT(DISTINCT)/ratio aggregates only.

-- ---- snapshot: record who was active during the day that just ended ----
create or replace function public._tg_snapshot_active()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  today_ict   date        := (timezone('Asia/Ho_Chi_Minh', now()))::date;
  y_date      date        := today_ict - 1;
  today_start timestamptz := (today_ict::timestamp) at time zone 'Asia/Ho_Chi_Minh';
  yest_start  timestamptz := today_start - interval '1 day';
begin
  insert into public.founder_daily_active (activity_date, user_id)
  select y_date, d.user_id
  from public.device_sessions d
  where d.last_seen_at >= yest_start and d.last_seen_at < today_start
    and d.revoked_at is null
  group by d.user_id
  on conflict (activity_date, user_id) do nothing;
end;
$$;

-- 00:05 Asia/Ho_Chi_Minh == 17:05 UTC
do $$
begin
  if exists (select 1 from cron.job where jobname = 'familyhub-active-snapshot') then
    perform cron.unschedule('familyhub-active-snapshot');
  end if;
end $$;
select cron.schedule('familyhub-active-snapshot', '5 17 * * *', 'select public._tg_snapshot_active();');

-- 06:00 Asia/Ho_Chi_Minh == 23:00 UTC
do $$
begin
  if exists (select 1 from cron.job where jobname = 'familyhub-founder-digest') then
    perform cron.unschedule('familyhub-founder-digest');
  end if;
end $$;
select cron.schedule('familyhub-founder-digest', '0 23 * * *', 'select public._tg_daily_digest();');

-- ---- digest: previous full VN day ----
create or replace function public._tg_daily_digest()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  today_ict   date        := (timezone('Asia/Ho_Chi_Minh', now()))::date;
  y_date      date        := today_ict - 1;
  today_start timestamptz := (today_ict::timestamp) at time zone 'Asia/Ho_Chi_Minh';
  yest_start  timestamptz := today_start - interval '1 day';   -- start of yesterday (VN)
  wk_start    timestamptz := today_start - interval '7 days';  -- 7 full days ending yesterday
  -- growth
  f_d int; m_d int; f7 int; m7 int;
  -- contributions (yesterday)
  react_u int; mood_u int; exp_u int; plan_u int;
  -- retention & frequency
  wau int; dau int; stick int; power int; light int; dormant int; total_fam int; active_fam int;
  -- activation & funnel
  activated int; pending int; owner_dead int;
  -- adoption
  goals_fam int; occ_fam int; react_fam int; mood_fam int; email_fam int; txn_d int;
  -- health
  pf_d int; push_pct int; total_mem int; push_mem int;
begin
  -- growth: yesterday (full VN day)
  select count(*) into f_d from public.families
    where created_at >= yest_start and created_at < today_start;
  select count(*) into m_d from public.members m join public.families f on f.id = m.family_id
    where m.key_unlocked_at >= yest_start and m.key_unlocked_at < today_start
      and m.user_id is not null and m.user_id <> f.owner_id and m.is_shared is not true;
  -- growth: last 7 full VN days
  select count(*) into f7 from public.families
    where created_at >= wk_start and created_at < today_start;
  select count(*) into m7 from public.members m join public.families f on f.id = m.family_id
    where m.key_unlocked_at >= wk_start and m.key_unlocked_at < today_start
      and m.user_id is not null and m.user_id <> f.owner_id and m.is_shared is not true;

  -- contributions: distinct members, yesterday
  select count(distinct member_id) into react_u from public.reactions
    where created_at >= yest_start and created_at < today_start;
  select count(distinct member_id) into mood_u from public.member_weather
    where updated_at >= yest_start and updated_at < today_start;
  select count(distinct member_id) into exp_u from public.transactions
    where created_at >= yest_start and created_at < today_start;
  select count(distinct m.id) into plan_u
    from public.saving_goals sg join public.members m on m.family_id = sg.family_id and m.user_id = sg.created_by
    where sg.created_at >= yest_start and sg.created_at < today_start;

  -- retention & frequency
  -- WAU: active in the last 7 days (rolling latest-heartbeat is accurate for "active at all")
  select count(distinct user_id) into wau from public.device_sessions
    where last_seen_at >= wk_start and revoked_at is null;
  -- DAU: from the calendar-day snapshot for yesterday
  select count(distinct user_id) into dau from public.founder_daily_active where activity_date = y_date;
  stick := coalesce(round(100.0 * dau / nullif(wau, 0)), 0);
  -- days-active distribution over the 7 days ending yesterday
  select count(*) filter (where nd >= 5), count(*) filter (where nd between 1 and 2)
  into power, light
  from (
    select user_id, count(distinct activity_date) as nd
    from public.founder_daily_active
    where activity_date between y_date - 6 and y_date
    group by user_id
  ) q;
  -- dormant families: no member active in the last 7 days
  select count(*) into total_fam from public.families where archived_at is null;
  select count(distinct m.family_id) into active_fam
    from public.members m join public.device_sessions d on d.user_id = m.user_id
    where d.last_seen_at >= wk_start and d.revoked_at is null
      and m.is_shared is not true and m.archived_at is null;
  dormant := greatest(total_fam - active_fam, 0);

  -- activation & funnel (last 7 full VN days)
  select count(distinct m.id) into activated
    from public.members m join public.families f on f.id = m.family_id
    where m.key_unlocked_at >= wk_start and m.key_unlocked_at < today_start
      and m.user_id is not null and m.user_id <> f.owner_id and m.is_shared is not true
      and (
        exists (select 1 from public.transactions   t where t.member_id = m.id)
        or exists (select 1 from public.reactions    r where r.member_id = m.id)
        or exists (select 1 from public.member_weather w where w.member_id = m.id)
        or exists (select 1 from public.saving_goals sg where sg.family_id = m.family_id and sg.created_by = m.user_id)
      );
  select count(*) into pending from public.invitations
    where accepted_at is null and (expires_at is null or expires_at > now());
  select count(*) into owner_dead from public.families f
    where f.created_at >= wk_start and f.created_at < today_start and f.archived_at is null
      and not exists (select 1 from public.transactions t where t.family_id = f.id);

  -- product adoption (current state)
  select count(distinct family_id) into goals_fam from public.saving_goals where archived_at is null;
  select count(distinct family_id) into occ_fam   from public.events where is_occasion is true and archived_at is null;
  select count(distinct family_id) into react_fam from public.reactions;
  select count(distinct family_id) into mood_fam  from public.member_weather;
  select count(distinct m.family_id) into email_fam
    from public.mailbox_connections c join public.members m on m.id = c.member_id where c.verified is true;
  select count(*) into txn_d from public.transactions
    where created_at >= yest_start and created_at < today_start;

  -- health
  select count(*) into pf_d from public.parse_failures
    where created_at >= yest_start and created_at < today_start;
  select count(*) into total_mem from public.members where user_id is not null and is_shared is not true and archived_at is null;
  select count(distinct member_id) into push_mem from public.push_subscriptions;
  push_pct := coalesce(round(100.0 * push_mem / nullif(total_mem, 0)), 0);

  perform public._tg_send(
    '📊 FamilyHub · Nhịp ngày ' || to_char(y_date, 'DD/MM') ||
    E'\n\n📈 Tăng trưởng' ||
    E'\n+' || f_d || ' gia đình · +' || m_d || ' thành viên (hôm qua)' ||
    E'\n7 ngày: ' || f7 || ' gia đình · ' || m7 || ' thành viên' ||
    E'\n\n🔥 Mức độ hoạt động' ||
    E'\nWAU ' || wau || ' · DAU ' || dau || ' · độ dính ' || stick || '%' ||
    E'\nTần suất tuần: ' || power || ' người ≥5 ngày · ' || light || ' người 1–2 ngày' ||
    E'\nGia đình ngủ đông (0 hoạt động 7d): ' || dormant ||
    E'\n\n🙋 Đóng góp hôm qua' ||
    E'\n❤️ ' || react_u || ' cảm xúc · 🌤️ ' || mood_u || ' tâm trạng · 🧾 ' || exp_u || ' chi tiêu · 🎯 ' || plan_u || ' kế hoạch' ||
    E'\n\n🚀 Kích hoạt & phễu' ||
    E'\nThành viên mới có hành động (7d): ' || activated || '/' || m7 ||
    E'\nLời mời chờ tham gia: ' || pending || ' · Gia đình mới chủ chưa dùng: ' || owner_dead ||
    E'\n\n🧩 Tính năng đang dùng (số gia đình)' ||
    E'\nMục tiêu ' || goals_fam || ' · Dịp ' || occ_fam || ' · Cảm xúc ' || react_fam || ' · Tâm trạng ' || mood_fam || ' · Nhập email ' || email_fam ||
    E'\nChi tiêu ghi hôm qua: ' || txn_d ||
    E'\n\n🩺 Sức khỏe' ||
    E'\nLỗi phân tích email (hôm qua): ' || pf_d || ' · Bật thông báo: ' || push_pct || '%'
  );
end;
$$;
