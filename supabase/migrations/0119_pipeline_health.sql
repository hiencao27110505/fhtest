-- ============================================================================
-- FamilyHub — 0119: the pipeline reports whether it is actually working
--
-- WHY. On 2026-08-29 the forwarding pipeline stopped staging anything and
-- nobody knew until 2026-09-04, when a Google quota email arrived naming the
-- wrong system. Six days. Every property that hid it was a correct decision in
-- isolation:
--
--   * Holding unroutable mail is the SAFE path, so it logs quietly and raises
--     nothing. A held message and a healthy idle tick look identical outside.
--   * A second user on the other transport kept working, so no aggregate moved.
--   * Cost grew linearly instead of failing, so nothing crossed a threshold
--     until the queue had grown for a week.
--
-- The obvious monitors would all have missed it. A run heartbeat: the runs were
-- succeeding. An error rate: there were no errors. "Time since the last staged
-- row": indistinguishable from a user who simply did not spend anything.
--
-- The number that WAS climbing in plain sight, every day, watched by nothing,
-- is how long the oldest unprocessed message has been sitting in the intake
-- label. 1, then 3, then 8, then 15, then a hard quota wall.
--
-- TWO SIGNALS, TWO DIFFERENT FAILURES. Neither subsumes the other:
--
--   1. STUCK — the pipeline runs, but the queue does not drain. oldest_held_at
--      goes back further than any healthy backlog could explain. This is the
--      2026-08-29 failure.
--   2. SILENT — no report at all for longer than a few ticks. The pipeline is
--      not running, or is dying before it can report. This is the 2026-09-04
--      failure, and it would have been caught in half an hour instead of a
--      morning's investigation.
--
-- WHY THE ALERT RIDES pg_cron + _tg_send RATHER THAN A NEW CHANNEL. Both
-- already exist and already reach the founder daily (0061/0064). A monitor
-- delivered somewhere nobody reads is the failure it is supposed to prevent,
-- wearing a different hat. _tg_send returns silently when the vault secrets are
-- absent, so this degrades to a no-op rather than raising.
--
-- WHY THE PIPELINE PUSHES AND THE DATABASE DOES NOT PULL. The queue lives in
-- Gmail. Postgres cannot see it, and nothing else can count it without a second
-- Gmail credential. So the .gs reports what it already knows from the run it
-- just did — no extra API call — and this side only has to notice the absence
-- of a report, which is exactly what makes signal 2 possible.
--
-- Next free migration number after this one: 0120. Verify against
-- `git ls-tree origin/main supabase/migrations/` IMMEDIATELY BEFORE YOU PUSH,
-- not only before you write — 0112/0113/0114 were each claimed twice in one day
-- because two sessions checked hours apart and both got true answers.
-- ============================================================================

-- One row per transport, upserted. Not a history table: the question is "is it
-- working right now", and a per-run log would be 1,440 rows a day to answer a
-- question that only ever reads the newest one.
create table if not exists public.pipeline_health (
  transport       text primary key,        -- 'forwarding' today; direct-read can join later
  ran_at          timestamptz not null,    -- when the pipeline last reported
  walked          int  not null default 0, -- messages examined in that run
  held            int  not null default 0, -- ...that reached no terminal state
  oldest_held_at  timestamptz,             -- date of the oldest still-held message; null = queue clear
  truncated       boolean not null default false,  -- run ended early (quota wall), so held is a floor
  version         text,                    -- PIPELINE_VERSION that reported, so a stale paste is visible
  note            text
);

comment on table public.pipeline_health is
  'What the bank-email pipeline saw on its last run. Written by the Apps Script '
  'pipeline on the service-role key; read by _tg_pipeline_health_check. Holds no '
  'family data — counts and timestamps only.';

-- Same posture as retired_aliases and mailbox_connections: RLS on, no policies,
-- off the client surface. Operational telemetry is not family data and no
-- browser has any reason to read it.
alter table public.pipeline_health enable row level security;
revoke all on public.pipeline_health from public, anon, authenticated;
grant select, insert, update on public.pipeline_health to service_role;

-- Alert debounce. Without it a stuck queue sends a message every 15 minutes for
-- days, which trains the reader to ignore the channel — the same way the
-- Apps Script failure mails became noise on 2026-09-04.
create table if not exists public.pipeline_alert_state (
  transport    text not null,
  kind         text not null,             -- 'stuck' | 'silent'
  last_sent_at timestamptz not null,
  primary key (transport, kind)
);

alter table public.pipeline_alert_state enable row level security;
revoke all on public.pipeline_alert_state from public, anon, authenticated;
grant select, insert, update on public.pipeline_alert_state to service_role;

-- ---------------------------------------------------------------------------
-- The check itself.
--
-- Thresholds are deliberately loose. The failure this exists for ran for SIX
-- DAYS; catching it in two hours is a total win, and a tight threshold that
-- cries wolf on an ordinary busy tick would get muted and then it protects
-- nothing.
--
--   stuck  — the oldest held message is over 6h old. A message the pipeline can
--            actually handle is staged on the next tick, so anything older than
--            a few minutes is already abnormal; 6h means it has survived ~360
--            attempts.
--   silent — no report for 30 minutes. The trigger fires every minute and the
--            pipeline reports at most every 15, so 30 minutes is two missed
--            reporting windows, not a hiccup.
--
-- Re-alerts every 6h while a condition persists, so it stays visible without
-- becoming wallpaper.
-- ---------------------------------------------------------------------------
create or replace function public._tg_pipeline_health_check()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r            record;
  v_last       timestamptz;
  v_msg        text;
  v_kind       text;
  v_age        interval;
  c_stuck      constant interval := interval '6 hours';
  c_silent     constant interval := interval '30 minutes';
  c_redo       constant interval := interval '6 hours';
begin
  for r in select * from public.pipeline_health loop
    v_kind := null;

    -- SILENT is checked first and wins: if the pipeline is not reporting, what
    -- it last said about its queue is not news, it is an artefact.
    if now() - r.ran_at > c_silent then
      v_kind := 'silent';
      v_msg  := '🔴 Pipeline im lặng — ' || r.transport || ' chưa báo cáo '
             || round(extract(epoch from (now() - r.ran_at)) / 60)::text || ' phút.'
             || E'\nLần cuối: ' || to_char(r.ran_at at time zone 'Asia/Ho_Chi_Minh', 'DD/MM HH24:MI')
             || ' (v' || coalesce(r.version, '?') || ')'
             || E'\nKiểm tra Apps Script > Executions.';
    elsif r.oldest_held_at is not null and now() - r.oldest_held_at > c_stuck then
      v_age  := now() - r.oldest_held_at;
      v_kind := 'stuck';
      v_msg  := '🟠 Hàng đợi không chảy — ' || r.transport || ': ' || r.held::text
             || ' thư đang giữ, cũ nhất ' || round(extract(epoch from v_age) / 3600)::text || ' giờ.'
             || E'\nBáo lúc: ' || to_char(r.ran_at at time zone 'Asia/Ho_Chi_Minh', 'DD/MM HH24:MI')
             || ' (v' || coalesce(r.version, '?') || ')'
             || case when r.truncated then E'\nRun bị cắt ngắn — số thư giữ là mức tối thiểu.' else '' end
             || E'\nXem log Apps Script để biết lý do giữ.';
    end if;

    if v_kind is null then
      -- Recovered: clear the debounce so the NEXT occurrence alerts at once
      -- rather than waiting out a window started by the previous one.
      delete from public.pipeline_alert_state where transport = r.transport;
      continue;
    end if;

    select last_sent_at into v_last from public.pipeline_alert_state
      where transport = r.transport and kind = v_kind;

    if v_last is null or now() - v_last > c_redo then
      perform public._tg_send(v_msg);
      insert into public.pipeline_alert_state (transport, kind, last_sent_at)
      values (r.transport, v_kind, now())
      on conflict (transport, kind) do update set last_sent_at = excluded.last_sent_at;
      -- Only one kind can be active at a time, so a switch from stuck to silent
      -- must not leave the old kind's debounce behind to suppress a later alert.
      delete from public.pipeline_alert_state
        where transport = r.transport and kind <> v_kind;
    end if;
  end loop;
end;
$$;

revoke all on function public._tg_pipeline_health_check() from public, anon, authenticated;

-- Every 15 minutes, on an off-minute: the founder digest already takes :00, and
-- two jobs landing on the same tick is how one of them starts looking flaky.
do $$
begin
  if exists (select 1 from cron.job where jobname = 'familyhub-pipeline-health') then
    perform cron.unschedule('familyhub-pipeline-health');
  end if;
end $$;
select cron.schedule('familyhub-pipeline-health', '7,22,37,52 * * * *',
                     'select public._tg_pipeline_health_check();');

-- Seeded so the SILENT check has something to be silent ABOUT. Without a row,
-- the loop above iterates zero times and a pipeline that never starts reporting
-- is monitored by nothing — the exact shape of the bug this migration exists
-- for. ran_at is backdated so the first missed report alerts immediately.
insert into public.pipeline_health (transport, ran_at, note)
values ('forwarding', now() - interval '1 hour', 'seeded by 0119; awaiting first report')
on conflict (transport) do nothing;
