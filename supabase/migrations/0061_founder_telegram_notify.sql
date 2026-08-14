-- 0061_founder_telegram_notify.sql
-- Founder-only growth alerts to a private Telegram group.
--
-- PRIVACY: nothing identifiable ever leaves the DB.
--   * Realtime pings are STATIC copy — no names, no ids, no amounts, no timestamps.
--   * The daily digest is aggregate COUNT(*) only.
-- Consistent with the E2EE promise (names stay encrypted server-side) and the
-- push-payload policy (payloads never carry titles/amounts).
--
-- SECRETS: the bot token + chat_id live in supabase_vault by NAME only. Their
-- actual values are inserted OUT-OF-BAND via vault.create_secret and are NOT in
-- this file (so the token never lands in git).
--   vault secret 'tg_bot_token'  -> Telegram bot token
--   vault secret 'tg_chat_id'    -> target group chat_id (e.g. -1003945165064)

create extension if not exists pg_net;
create extension if not exists pg_cron;

-- ---------------------------------------------------------------------------
-- Low-level sender: reads secrets from Vault, POSTs to Telegram, fire-and-forget.
-- net.http_post only enqueues a row (a background worker sends it), so a Telegram
-- outage can never fail or stall the user transaction that triggered the alert.
-- ---------------------------------------------------------------------------
create or replace function public._tg_send(p_text text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_token text;
  v_chat  text;
begin
  select decrypted_secret into v_token from vault.decrypted_secrets where name = 'tg_bot_token';
  select decrypted_secret into v_chat  from vault.decrypted_secrets where name = 'tg_chat_id';
  if v_token is null or v_chat is null then
    return;  -- not configured yet: stay silent, never raise into a user txn
  end if;
  perform net.http_post(
    url     := 'https://api.telegram.org/bot' || v_token || '/sendMessage',
    body    := jsonb_build_object('chat_id', v_chat, 'text', p_text),
    headers := jsonb_build_object('Content-Type', 'application/json')
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Option 2a — a new family was created.
-- ---------------------------------------------------------------------------
create or replace function public._tg_on_family_created()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public._tg_send('🎉 Yay! New family created');
  return null;
end;
$$;

drop trigger if exists tg_family_created on public.families;
create trigger tg_family_created
  after insert on public.families
  for each row execute function public._tg_on_family_created();

-- ---------------------------------------------------------------------------
-- Option 2b — a real (non-owner) member finished joining.
-- "Joined successfully" == key_unlocked_at reached (E2EE key unlocked).
-- Two triggers so the WHEN clause stays legal (OLD is only referenced on UPDATE);
-- the owner's own founding row and is_shared placeholders are excluded here + below.
-- ---------------------------------------------------------------------------
create or replace function public._tg_on_member_joined()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid;
begin
  select owner_id into v_owner from public.families where id = NEW.family_id;
  if NEW.user_id is null or NEW.user_id = v_owner then
    return null;  -- owner's own membership, not a join
  end if;
  perform public._tg_send('👥 Yeah! New member joined');
  return null;
end;
$$;

drop trigger if exists tg_member_joined_ins on public.members;
create trigger tg_member_joined_ins
  after insert on public.members
  for each row
  when (
    NEW.key_unlocked_at is not null
    and NEW.user_id is not null
    and NEW.is_shared is not true
  )
  execute function public._tg_on_member_joined();

drop trigger if exists tg_member_joined_upd on public.members;
create trigger tg_member_joined_upd
  after update on public.members
  for each row
  when (
    NEW.key_unlocked_at is not null
    and OLD.key_unlocked_at is null
    and NEW.user_id is not null
    and NEW.is_shared is not true
  )
  execute function public._tg_on_member_joined();

-- ---------------------------------------------------------------------------
-- Option 1 — daily aggregate digest (counts only), 21:00 Asia/Ho_Chi_Minh.
-- ---------------------------------------------------------------------------
create or replace function public._tg_daily_digest()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  f24 int; m24 int; f7 int; m7 int;
begin
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

  perform public._tg_send(
    '📊 FamilyHub — hôm nay: +' || f24 || ' gia đình, +' || m24 || ' thành viên' ||
    E'\n7 ngày: ' || f7 || ' gia đình, ' || m7 || ' thành viên'
  );
end;
$$;

-- 21:00 Asia/Ho_Chi_Minh == 14:00 UTC. pg_cron schedules in UTC.
do $$
begin
  if exists (select 1 from cron.job where jobname = 'familyhub-founder-digest') then
    perform cron.unschedule('familyhub-founder-digest');
  end if;
end $$;
select cron.schedule('familyhub-founder-digest', '0 14 * * *', 'select public._tg_daily_digest();');
