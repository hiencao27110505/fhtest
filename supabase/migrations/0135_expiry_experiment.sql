-- ============================================================================
-- FamilyHub / Earthy — 0135: tell the founder whether publishing killed the
-- 7-day token expiry
--
-- THE EXPERIMENT. Google issues a refresh token that dies after exactly 7 days
-- to an app in *Testing* publishing status. On 2026-09-13 the OAuth app was
-- flipped Testing -> In production (still unverified), and two mailboxes were
-- reconnected afterwards, so their tokens were minted under the new status.
-- pipeline/OAUTH-COMPLIANCE-FINDINGS.md predicts the expiry is tied to Testing
-- status rather than to being unverified. If it holds, the weekly reconnect is
-- gone for a 100-user beta with no CASA. If not, the day-6 reminder and CASA
-- pricing become real work.
--
-- WHY THE DATABASE WATCHES, NOT A SESSION. A week is longer than any agent
-- session lives, and pg_cron + _tg_send already reach the founder daily (0061,
-- 0064, 0119). A monitor delivered somewhere nobody reads is the failure it is
-- meant to prevent.
--
-- THE MINT WINDOWS ARE BOUNDS, NOT TIMES. There is no token-issued column —
-- connected_at does not move on a reconnect and updated_at moves on every sync —
-- so each window is bracketed by observations taken live on 2026-09-13/14:
--   trang.nguyen.wh   dead at 09-13 06:03 UTC, syncing again by 09-13 06:55
--   hiencao27110505   dead at 09-13 06:03 UTC, syncing again by 09-14 02:35
--
-- FOUR OUTCOMES, and three of them exist to stop a wrong verdict:
--   ❌ a token dies with an age consistent with 7 days     -> the expiry survived
--   🟠 a token dies clearly too early to be the expiry     -> revoke / password
--      change; reported, that mailbox dropped, the other keeps being watched
--   ⚪ a watched grant row disappears                       -> disconnected or
--      replaced, its clock reset; void
--   ✅ past the verdict time, BOTH still connected AND actually syncing
-- "Actually syncing" matters: a grant that is alive while the worker is broken
-- would otherwise report a surviving token that nothing is reading.
--
-- CONFOUND THE DATA CANNOT SEE: reconnecting a watched mailbox again before the
-- verdict re-mints its token silently and would produce a false ✅. Recorded in
-- AGENT_SYNC; the watched people have been told not to.
--
-- SENDS ONCE, THEN REMOVES ITSELF. verdict_sent_at is set in the same function
-- that sends, and every run checks it first, so a failed unschedule degrades to
-- an idle hourly no-op rather than a message an hour (the 2026-08-30 worker
-- incident was exactly that shape).
--
-- Copy follows 0125: English, an emoji status, hyphens not em-dashes, plain
-- text because _tg_send sets no parse mode.
--
-- Next free migration number after this one: 0136. Verify against
-- `git ls-tree origin/main supabase/migrations/` IMMEDIATELY BEFORE YOU PUSH.
-- ============================================================================

create table if not exists public.expiry_experiment (
  grant_id        uuid primary key,
  label           text        not null,
  minted_after    timestamptz not null,   -- token certainly minted after this
  minted_before   timestamptz not null,   -- ...and certainly by this
  verdict_sent_at timestamptz
);

comment on table public.expiry_experiment is
  'One-off monitor (0135): watched mailbox grants reconnected after the OAuth app left Testing status. Bounds on when each token was minted, plus whether the verdict has been sent. Deletable once the verdict lands.';

-- Server-only. RLS on with no policies denies anon and authenticated outright;
-- the tick runs as the definer.
alter table public.expiry_experiment enable row level security;
revoke all on public.expiry_experiment from anon, authenticated;

insert into public.expiry_experiment (grant_id, label, minted_after, minted_before) values
  ('54a6d704-3c9d-4077-bad9-47b464af6c4f', 'trang.nguyen.wh',  '2026-09-13 06:03:00+00', '2026-09-13 06:55:00+00'),
  ('25101d7b-b35c-4a63-96a7-20094f69482e', 'hiencao27110505',  '2026-09-13 06:03:00+00', '2026-09-14 02:35:00+00')
on conflict (grant_id) do nothing;

create or replace function public._expiry_experiment_tick()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  -- Past the LATEST possible Testing-status death of either token
  -- (hiencao: minted by 09-14 02:35 -> dead by 09-21 02:35) with margin.
  -- 08:00 UTC is 15:00 in Hanoi.
  c_verdict_at constant timestamptz := '2026-09-21 08:00:00+00';
  c_lag        constant interval    := interval '10 minutes';  -- sync tick + detection slack
  v_now     timestamptz := now();
  r         record;
  v_lo      numeric;
  v_hi      numeric;
  v_left    int;
  v_stale   int;
  v_last    timestamptz;
begin
  -- Already concluded. Retry the unschedule in case the first one failed.
  if exists (select 1 from public.expiry_experiment where verdict_sent_at is not null) then
    begin perform cron.unschedule('familyhub-expiry-experiment'); exception when others then null; end;
    return;
  end if;

  -- ⚪ A watched row vanished: disconnected (0087 deletes the grant) or replaced
  -- by a different account. Either way its clock is gone.
  for r in
    select e.label from public.expiry_experiment e
     where not exists (select 1 from public.mailbox_grants g where g.id = e.grant_id)
  loop
    perform public._tg_send(
      '⚪ Expiry experiment void - ' || r.label || ' was disconnected or replaced, so its token clock reset. '
      || 'Reconnect after publishing and wait 7 days to retest.');
    update public.expiry_experiment set verdict_sent_at = v_now;
    begin perform cron.unschedule('familyhub-expiry-experiment'); exception when others then null; end;
    return;
  end loop;

  -- A watched token died. How old was it? last_synced_at is the last run that
  -- still worked, so death lies between it and the next tick.
  for r in
    select e.grant_id, e.label, e.minted_after, e.minted_before, g.last_synced_at
      from public.expiry_experiment e
      join public.mailbox_grants g on g.id = e.grant_id
     where g.needs_reauth = true
       and g.last_synced_at is not null      -- no last good sync = no age to judge
     order by g.last_synced_at
  loop
    v_lo := round(extract(epoch from (r.last_synced_at - r.minted_before)) / 86400.0, 1);
    v_hi := round(extract(epoch from (r.last_synced_at + c_lag - r.minted_after)) / 86400.0, 1);

    if v_lo <= 7.2 and v_hi >= 6.8 then
      -- ❌ Consistent with the 7-day mark: the expiry survived publishing.
      perform public._tg_send(
        '❌ The 7-day expiry survived publishing. ' || r.label || ' lost its token at '
        || v_lo || '-' || v_hi || ' days old, right on the 7-day mark. '
        || 'Next: build the day-6 reminder (token_issued_at) and price CASA.');
      update public.expiry_experiment set verdict_sent_at = v_now;
      begin perform cron.unschedule('familyhub-expiry-experiment'); exception when others then null; end;
      return;
    end if;

    -- 🟠 Too early or too late to be the expiry. Say so, stop watching this one.
    perform public._tg_send(
      '🟠 Expiry experiment: ' || r.label || ' disconnected at ' || v_lo || '-' || v_hi
      || ' days - not the 7-day mark, so probably a revoke or password change. '
      || 'Dropped it; still watching the rest.');
    delete from public.expiry_experiment where grant_id = r.grant_id;
  end loop;

  select count(*) into v_left from public.expiry_experiment;
  if v_left = 0 then
    begin perform cron.unschedule('familyhub-expiry-experiment'); exception when others then null; end;
    return;
  end if;

  if v_now < c_verdict_at then
    return;
  end if;

  -- Past the verdict time and nothing died. Only trust it if they are reading.
  select count(*), min(g.last_synced_at) into v_stale, v_last
    from public.expiry_experiment e
    join public.mailbox_grants g on g.id = e.grant_id
   where g.last_synced_at is null or g.last_synced_at < v_now - interval '2 hours';

  if v_stale > 0 then
    perform public._tg_send(
      '⚪ Expiry experiment inconclusive - the tokens are still valid past 7 days, but '
      || v_stale || ' watched mailbox(es) have not synced since '
      || coalesce(to_char(v_last at time zone 'Asia/Ho_Chi_Minh', 'DD/MM HH24:MI'), 'never')
      || ' Hanoi. Check the worker before trusting this.');
  else
    perform public._tg_send(
      '✅ Publishing killed the 7-day expiry. ' || v_left
      || ' mailbox(es) reconnected on 13-14/09 are still connected and syncing past 7 days. '
      || 'The weekly reconnect is gone for the beta - no CASA needed yet.');
  end if;

  update public.expiry_experiment set verdict_sent_at = v_now;
  begin perform cron.unschedule('familyhub-expiry-experiment'); exception when others then null; end;
end;
$$;

revoke all on function public._expiry_experiment_tick() from public, anon, authenticated;

comment on function public._expiry_experiment_tick() is
  'Hourly one-off (0135): reports on Telegram whether tokens minted after the OAuth app left Testing status outlive 7 days, then unschedules itself. Idempotent after the verdict.';

do $$
begin
  if exists (select 1 from cron.job where jobname = 'familyhub-expiry-experiment') then
    perform cron.unschedule('familyhub-expiry-experiment');
  end if;
end $$;

-- :17 past the hour — clear of the :07/:22/:37/:52 pipeline-health ticks.
select cron.schedule('familyhub-expiry-experiment', '17 * * * *',
                     'select public._expiry_experiment_tick();');

-- Arming notice. Doubles as the only real proof the Telegram path works:
-- _tg_send returns void and silently no-ops on a bad token, so a missing
-- message here means the verdict would never arrive either.
select public._tg_send(
  '🧪 Expiry experiment armed. Watching trang.nguyen.wh and hiencao27110505, both reconnected after '
  || 'the OAuth app was published on 13/09. Verdict by 21/09 15:00 Hanoi, sooner if a token dies. '
  || 'Do not reconnect either mailbox before then - it resets the clock.');
