-- Founder Telegram digest, cut down to two questions (replaces the 0063/0064/0078 body).
--
--   1. How many users were active yesterday / in the last 3 days / in the last 7 days?
--   2. How many users had their review queue grow in the same windows?
--
-- Windows end at the start of today (Asia/Ho_Chi_Minh) and are cumulative, so the
-- 3-day figure includes yesterday. The cron job (familyhub-founder-digest, 23:00 UTC =
-- 06:00 ICT) is unchanged; only the message body changes.
--
-- "Active" reads founder_daily_active, the per-day log written by _tg_snapshot_active,
-- the same source the old DAU/WAU lines used.
-- "Review queue grew" counts users with at least one email_transactions row created in
-- the window. Every row in that table is a waiting one: reviewing a row removes it.
create or replace function public._tg_daily_digest()
returns void
language plpgsql
security definer
set search_path to ''
as $function$
declare
  today_ict   date        := (timezone('Asia/Ho_Chi_Minh', now()))::date;
  y_date      date        := today_ict - 1;
  today_start timestamptz := (today_ict::timestamp) at time zone 'Asia/Ho_Chi_Minh';
  act_1d int; act_3d int; act_7d int;
  rev_1d int; rev_3d int; rev_7d int;
begin
  select count(distinct user_id) into act_1d from public.founder_daily_active
    where activity_date = y_date;
  select count(distinct user_id) into act_3d from public.founder_daily_active
    where activity_date between y_date - 2 and y_date;
  select count(distinct user_id) into act_7d from public.founder_daily_active
    where activity_date between y_date - 6 and y_date;

  select count(distinct owner_user_id) into rev_1d from public.email_transactions
    where created_at >= today_start - interval '1 day' and created_at < today_start;
  select count(distinct owner_user_id) into rev_3d from public.email_transactions
    where created_at >= today_start - interval '3 days' and created_at < today_start;
  select count(distinct owner_user_id) into rev_7d from public.email_transactions
    where created_at >= today_start - interval '7 days' and created_at < today_start;

  perform public._tg_send(
    '📊 FamilyHub · ' || to_char(y_date, 'DD/MM') ||
    E'\n\n👤 Người dùng có hoạt động' ||
    E'\n- Hôm qua: ' || act_1d ||
    E'\n- 3 ngày: '  || act_3d ||
    E'\n- 7 ngày: '  || act_7d ||
    E'\n\n📥 Người dùng có thêm giao dịch chờ duyệt' ||
    E'\n- Hôm qua: ' || rev_1d ||
    E'\n- 3 ngày: '  || rev_3d ||
    E'\n- 7 ngày: '  || rev_7d
  );
end;
$function$;
