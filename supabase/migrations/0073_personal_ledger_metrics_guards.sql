-- 0073 — personal-ledger fallout: founder metrics + active-container invariants
--
-- After 0071 every user silently gets a families row with type='personal'. This
-- migration stops that container from (a) spamming the founder channel + inflating
-- every family/member/transaction metric, and (b) ever becoming a user's ACTIVE
-- family (which would repoint auth_family_id() at the private ledger).
--
-- All changes redefine live functions with minimal edits: a `type='family'`
-- filter wherever families/members/transactions counts could include a personal
-- ledger. Family behaviour is otherwise unchanged.

-- ── 1. P0: new-family Telegram fires on personal provisioning ────────────────
create or replace function public._tg_on_family_created()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if NEW.type is distinct from 'family' then return null; end if;   -- personal/friend/trip: not a "new family"
  perform public._tg_send('🎉 Yay! New family created');
  return null;
end;
$$;

-- ── 2. P0: daily digest counted every container ──────────────────────────────
-- Only the count sources that can include a personal ledger are filtered:
-- families (created/total/active/dormant/owner_dead), and transactions/members
-- (exp_u, txn_d, total_mem) which the mirror now populates in the personal fid.
-- member-join counts (m_d/m7/activated) already exclude it via user_id<>owner_id
-- but get the filter too for clarity. Message block is byte-identical to 0064.
create or replace function public._tg_daily_digest()
 returns void language plpgsql security definer set search_path to '' as $function$
declare
  today_ict   date        := (timezone('Asia/Ho_Chi_Minh', now()))::date;
  y_date      date        := today_ict - 1;
  today_start timestamptz := (today_ict::timestamp) at time zone 'Asia/Ho_Chi_Minh';
  yest_start  timestamptz := today_start - interval '1 day';
  wk_start    timestamptz := today_start - interval '7 days';
  f_d int; m_d int; f7 int; m7 int;
  react_u int; mood_u int; exp_u int; plan_u int;
  wau int; dau int; stick int; power int; light int; dormant int; total_fam int; active_fam int;
  activated int; pending int; owner_dead int;
  goals_fam int; occ_fam int; react_fam int; mood_fam int; email_fam int; txn_d int;
  pf_d int; push_pct int; total_mem int; push_mem int;
begin
  select count(*) into f_d from public.families
    where created_at >= yest_start and created_at < today_start and type = 'family';
  select count(*) into m_d from public.members m join public.families f on f.id = m.family_id
    where m.key_unlocked_at >= yest_start and m.key_unlocked_at < today_start
      and m.user_id is not null and m.user_id <> f.owner_id and m.is_shared is not true and f.type = 'family';
  select count(*) into f7 from public.families
    where created_at >= wk_start and created_at < today_start and type = 'family';
  select count(*) into m7 from public.members m join public.families f on f.id = m.family_id
    where m.key_unlocked_at >= wk_start and m.key_unlocked_at < today_start
      and m.user_id is not null and m.user_id <> f.owner_id and m.is_shared is not true and f.type = 'family';

  select count(distinct member_id) into react_u from public.reactions
    where created_at >= yest_start and created_at < today_start;
  select count(distinct member_id) into mood_u from public.member_weather
    where updated_at >= yest_start and updated_at < today_start;
  select count(distinct t.member_id) into exp_u from public.transactions t
    join public.families f on f.id = t.family_id and f.type = 'family'
    where t.created_at >= yest_start and t.created_at < today_start;
  select count(distinct m.id) into plan_u
    from public.saving_goals sg
    join public.families f on f.id = sg.family_id and f.type = 'family'
    join public.members m on m.family_id = sg.family_id and m.user_id = sg.created_by
    where sg.created_at >= yest_start and sg.created_at < today_start;

  select count(distinct user_id) into wau from public.device_sessions
    where last_seen_at >= wk_start and revoked_at is null;
  select count(distinct user_id) into dau from public.founder_daily_active where activity_date = y_date;
  stick := coalesce(round(100.0 * dau / nullif(wau, 0)), 0);
  select count(*) filter (where nd >= 5), count(*) filter (where nd between 1 and 2)
  into power, light
  from (
    select user_id, count(distinct activity_date) as nd
    from public.founder_daily_active
    where activity_date between y_date - 6 and y_date
    group by user_id
  ) q;
  select count(*) into total_fam from public.families where archived_at is null and type = 'family';
  select count(distinct m.family_id) into active_fam
    from public.members m
    join public.families f on f.id = m.family_id and f.type = 'family'
    join public.device_sessions d on d.user_id = m.user_id
    where d.last_seen_at >= wk_start and d.revoked_at is null
      and m.is_shared is not true and m.archived_at is null;
  dormant := greatest(total_fam - active_fam, 0);

  select count(distinct m.id) into activated
    from public.members m join public.families f on f.id = m.family_id
    where m.key_unlocked_at >= wk_start and m.key_unlocked_at < today_start
      and m.user_id is not null and m.user_id <> f.owner_id and m.is_shared is not true and f.type = 'family'
      and (
        exists (select 1 from public.transactions   t where t.member_id = m.id)
        or exists (select 1 from public.reactions    r where r.member_id = m.id)
        or exists (select 1 from public.member_weather w where w.member_id = m.id)
        or exists (select 1 from public.saving_goals sg where sg.family_id = m.family_id and sg.created_by = m.user_id)
      );
  select count(*) into pending from public.invitations
    where accepted_at is null and (expires_at is null or expires_at > now());
  select count(*) into owner_dead from public.families f
    where f.created_at >= wk_start and f.created_at < today_start and f.archived_at is null and f.type = 'family'
      and not exists (select 1 from public.transactions t where t.family_id = f.id);

  select count(distinct family_id) into goals_fam from public.saving_goals
    where archived_at is null and family_id in (select id from public.families where type = 'family');
  select count(distinct family_id) into occ_fam from public.events
    where is_occasion is true and archived_at is null and family_id in (select id from public.families where type = 'family');
  select count(distinct family_id) into react_fam from public.reactions
    where family_id in (select id from public.families where type = 'family');
  select count(distinct family_id) into mood_fam from public.member_weather
    where family_id in (select id from public.families where type = 'family');
  select count(distinct m.family_id) into email_fam
    from public.mailbox_connections c join public.members m on m.id = c.member_id
    where c.verified is true and m.family_id in (select id from public.families where type = 'family');
  select count(*) into txn_d from public.transactions
    where created_at >= yest_start and created_at < today_start
      and family_id in (select id from public.families where type = 'family');

  select count(*) into pf_d from public.parse_failures
    where created_at >= yest_start and created_at < today_start;
  select count(*) into total_mem from public.members
    where user_id is not null and is_shared is not true and archived_at is null
      and family_id in (select id from public.families where type = 'family');
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
$function$;

-- ── 3. P1: leave_family must not promote the personal ledger to active ────────
create or replace function public.leave_family()
 returns uuid language plpgsql security definer set search_path to 'public' as $function$
declare v_uid uuid := auth.uid(); v_family uuid; v_next uuid;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  select family_id into v_family from profiles where id = v_uid;
  if v_family is null then raise exception 'no active family'; end if;
  update members set archived_at = now() where family_id = v_family and user_id = v_uid;
  select f.id into v_next from families f
   join members m on m.family_id = f.id and m.user_id = v_uid and m.archived_at is null
   where f.archived_at is null and f.id <> v_family and f.type = 'family'   -- never hand the private ledger the active slot
   order by f.created_at limit 1;
  update profiles set family_id = v_next where id = v_uid;
  return v_next;
end $function$;

-- ── 4. P1: switch_family server backstop ─────────────────────────────────────
create or replace function public.switch_family(p_family_id uuid)
 returns void language plpgsql security definer set search_path to 'public' as $function$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  if not exists (select 1 from members where family_id = p_family_id and user_id = v_uid and archived_at is null)
     or exists (select 1 from families where id = p_family_id and (archived_at is not null or type <> 'family')) then
    raise exception 'you are not a member of that family';
  end if;
  update profiles set family_id = p_family_id where id = v_uid;
end $function$;
