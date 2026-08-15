-- 0063_founder_engagement_analytics.sql
-- Expand the founder daily digest into a full engagement dashboard-in-a-message,
-- and start a daily active-user snapshot so "days active per week" / retention
-- become computable going forward (the last_seen_at heartbeat is overwritten in
-- place, so history must be accumulated — it cannot be backfilled).
--
-- PRIVACY: every number the digest sends is a COUNT / COUNT(DISTINCT) / ratio.
-- No names, no emails, no amounts, no ids ever leave the DB. The snapshot table
-- stores only (date, user_id) pseudonymous rows and is never read client-side.
-- Consistent with the E2EE + push-payload policy.

-- ---------------------------------------------------------------------------
-- Daily active-user snapshot (append-only history of who was active each day).
-- ---------------------------------------------------------------------------
create table if not exists public.founder_daily_active (
  activity_date date not null,
  user_id       uuid not null,
  primary key (activity_date, user_id)
);
alter table public.founder_daily_active enable row level security;  -- no policy: service-role / SECURITY DEFINER only

create or replace function public._tg_snapshot_active()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.founder_daily_active (activity_date, user_id)
  select (timezone('Asia/Ho_Chi_Minh', now()))::date, d.user_id
  from public.device_sessions d
  where d.last_seen_at >= now() - interval '24 hours'
    and d.revoked_at is null
  group by d.user_id
  on conflict (activity_date, user_id) do nothing;
end;
$$;

-- Snapshot at 20:00 Asia/Ho_Chi_Minh (13:00 UTC) — one hour before the 21:00 digest.
do $$
begin
  if exists (select 1 from cron.job where jobname = 'familyhub-active-snapshot') then
    perform cron.unschedule('familyhub-active-snapshot');
  end if;
end $$;
select cron.schedule('familyhub-active-snapshot', '0 13 * * *', 'select public._tg_snapshot_active();');

-- ---------------------------------------------------------------------------
-- Full digest.
-- ---------------------------------------------------------------------------
create or replace function public._tg_daily_digest()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  -- growth
  f24 int; m24 int; f7 int; m7 int;
  -- engagement contributions (last 24h)
  react_u int; mood_u int; exp_u int; plan_u int;
  -- retention & frequency
  wau int; dau int; stick int; power int; light int; dormant int; total_fam int; active_fam int;
  -- activation & funnel
  activated int; pending int; owner_dead int;
  -- product adoption
  goals_fam int; occ_fam int; react_fam int; mood_fam int; email_fam int; txn24 int;
  -- health
  pf24 int; push_pct int; total_mem int; push_mem int;
  today_ict date := (timezone('Asia/Ho_Chi_Minh', now()))::date;
begin
  -- ---- growth ----
  select count(*) into f24 from public.families where created_at >= now() - interval '24 hours';
  select count(*) into f7  from public.families where created_at >= now() - interval '7 days';
  select count(*) into m24 from public.members m join public.families f on f.id = m.family_id
    where m.key_unlocked_at >= now() - interval '24 hours'
      and m.user_id is not null and m.user_id <> f.owner_id and m.is_shared is not true;
  select count(*) into m7  from public.members m join public.families f on f.id = m.family_id
    where m.key_unlocked_at >= now() - interval '7 days'
      and m.user_id is not null and m.user_id <> f.owner_id and m.is_shared is not true;

  -- ---- engagement contributions (distinct members, 24h) ----
  select count(distinct member_id) into react_u from public.reactions      where created_at >= now() - interval '24 hours';
  select count(distinct member_id) into mood_u  from public.member_weather  where updated_at >= now() - interval '24 hours';
  select count(distinct member_id) into exp_u   from public.transactions    where created_at >= now() - interval '24 hours';
  select count(distinct m.id) into plan_u
    from public.saving_goals sg join public.members m on m.family_id = sg.family_id and m.user_id = sg.created_by
    where sg.created_at >= now() - interval '24 hours';

  -- ---- retention & frequency ----
  select count(distinct user_id) into wau from public.device_sessions where last_seen_at >= now() - interval '7 days'  and revoked_at is null;
  select count(distinct user_id) into dau from public.device_sessions where last_seen_at >= now() - interval '24 hours' and revoked_at is null;
  stick := coalesce(round(100.0 * dau / nullif(wau, 0)), 0);

  select
    count(*) filter (where nd >= 5),
    count(*) filter (where nd between 1 and 2)
  into power, light
  from (
    select user_id, count(distinct activity_date) as nd
    from public.founder_daily_active
    where activity_date > today_ict - 7
    group by user_id
  ) q;

  select count(*) into total_fam from public.families where archived_at is null;
  select count(distinct m.family_id) into active_fam
    from public.members m join public.device_sessions d on d.user_id = m.user_id
    where d.last_seen_at >= now() - interval '7 days' and d.revoked_at is null
      and m.is_shared is not true and m.archived_at is null;
  dormant := greatest(total_fam - active_fam, 0);

  -- ---- activation & funnel ----
  select count(distinct m.id) into activated
    from public.members m join public.families f on f.id = m.family_id
    where m.key_unlocked_at >= now() - interval '7 days'
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
    where f.created_at >= now() - interval '7 days' and f.archived_at is null
      and not exists (select 1 from public.transactions t where t.family_id = f.id);

  -- ---- product adoption (families using each surface) ----
  select count(distinct family_id) into goals_fam from public.saving_goals where archived_at is null;
  select count(distinct family_id) into occ_fam   from public.events where is_occasion is true and archived_at is null;
  select count(distinct family_id) into react_fam from public.reactions;
  select count(distinct family_id) into mood_fam  from public.member_weather;
  select count(distinct m.family_id) into email_fam
    from public.mailbox_connections c join public.members m on m.id = c.member_id where c.verified is true;
  select count(*) into txn24 from public.transactions where created_at >= now() - interval '24 hours';

  -- ---- health ----
  select count(*) into pf24 from public.parse_failures where created_at >= now() - interval '24 hours';
  select count(*) into total_mem from public.members where user_id is not null and is_shared is not true and archived_at is null;
  select count(distinct member_id) into push_mem from public.push_subscriptions;
  push_pct := coalesce(round(100.0 * push_mem / nullif(total_mem, 0)), 0);

  -- ---- compose ----
  perform public._tg_send(
    '📊 FamilyHub · Nhịp ngày' ||
    E'\n\n📈 Tăng trưởng' ||
    E'\n+' || f24 || ' gia đình · +' || m24 || ' thành viên (24h)' ||
    E'\n7 ngày: ' || f7 || ' gia đình · ' || m7 || ' thành viên' ||
    E'\n\n🔥 Mức độ hoạt động' ||
    E'\nWAU ' || wau || ' · DAU ' || dau || ' · độ dính ' || stick || '%' ||
    E'\nTần suất tuần: ' || power || ' người ≥5 ngày · ' || light || ' người 1–2 ngày' ||
    E'\nGia đình ngủ đông (0 hoạt động 7d): ' || dormant ||
    E'\n\n🙋 Đóng góp hôm nay' ||
    E'\n❤️ ' || react_u || ' cảm xúc · 🌤️ ' || mood_u || ' tâm trạng · 🧾 ' || exp_u || ' chi tiêu · 🎯 ' || plan_u || ' kế hoạch' ||
    E'\n\n🚀 Kích hoạt & phễu' ||
    E'\nThành viên mới có hành động (7d): ' || activated || '/' || m7 ||
    E'\nLời mời chờ tham gia: ' || pending || ' · Gia đình mới chủ chưa dùng: ' || owner_dead ||
    E'\n\n🧩 Tính năng đang dùng (số gia đình)' ||
    E'\nMục tiêu ' || goals_fam || ' · Dịp ' || occ_fam || ' · Cảm xúc ' || react_fam || ' · Tâm trạng ' || mood_fam || ' · Nhập email ' || email_fam ||
    E'\nChi tiêu ghi hôm nay: ' || txn24 ||
    E'\n\n🩺 Sức khỏe' ||
    E'\nLỗi phân tích email (24h): ' || pf24 || ' · Bật thông báo: ' || push_pct || '%'
  );
end;
$$;
