-- ============================================================================
-- FamilyHub — 0125: the health alerts say what happened, and say when it ends
--
-- TWO CHANGES, one cause.
--
-- 1. THE COPY IS BLUNTER. 0119's headlines described the queue ("Hàng đợi không
--    chảy"); these name the state of the machine, in the words the person
--    reading them at 4am actually wants: Pipeline dead / Queue not cleared /
--    Pipeline revived. Em-dashes out, plain hyphens in, per DESIGN.md voice.
--
-- 2. RECOVERY IS ANNOUNCED. 0119 cleared the debounce row silently, so an
--    incident ended in silence — and silence was already what a healthy idle
--    pipeline looked like, so "it recovered" and "the monitor itself died" were
--    the same observation. You had to go read the table to find out it was fine.
--
--    That ambiguity gets WORSE, not better, with the .gs heartbeat fix shipping
--    alongside this (reportIdleHealth, PIPELINE_VERSION 2026-09-07-heartbeat).
--    Once an idle tick reports zeros, quiet becomes the normal healthy state and
--    carries no information at all. The only way an incident can close audibly
--    is to say so. Hence ✅.
--
-- WHY A stale_since COLUMN. The ✅ for a silent incident states how long the
-- pipeline was down, and that number has to be true. `last_sent_at` is when the
-- last ALERT went out, which is within the 6h re-alert window and says nothing
-- about the outage. So the alert records `pipeline_health.ran_at` as it was when
-- the silence was first detected — the last good report before the gap — and
-- recovery subtracts it from the new one. Exact, one column, no history table.
--
-- Nullable and null-tolerant on purpose: the row that exists RIGHT NOW was
-- written by 0119 before this column did, and the first recovery must not print
-- "im lặng  phút". It degrades to a ✅ with no duration. The backfill at the
-- bottom fills that one row from the frozen ran_at, so even this incident
-- reports its length correctly.
--
-- WHAT THIS DELIBERATELY DOES NOT DO: gate the alerts on there being connected
-- users. It was considered and rejected on 2026-09-07. `mailbox_connections`
-- held one row and zero VERIFIED rows that morning, so "only alert if someone is
-- using it" either no-ops (gate on any row) or suppresses the transport
-- entirely (gate on verified) — and it would have suppressed a TRUE positive:
-- the Apps Script really had stopped, at 03:12, and the silent alert caught it.
-- Mail arriving for an alias nobody owns is worth MORE attention than ordinary
-- backlog, not less; it is pure quota burn plus invisible data loss. The idle
-- heartbeat is the correct fix for the false positives, not a users gate.
--
-- Next free migration number after this one: 0126. Verify against
-- `git ls-tree origin/main supabase/migrations/` IMMEDIATELY BEFORE YOU PUSH.
-- ============================================================================

-- The last good report before a silence began. Null for rows written by 0119.
alter table public.pipeline_alert_state
  add column if not exists stale_since timestamptz;

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
  v_prev_kind  text;
  v_prev_stale timestamptz;
  v_down       bigint;
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
      v_msg  := '🔴 Pipeline dead - luồng ' || r.transport || ' không hoạt động trong '
             || round(extract(epoch from (now() - r.ran_at)) / 60)::text || ' phút.'
             || E'\nLần cuối: ' || to_char(r.ran_at at time zone 'Asia/Ho_Chi_Minh', 'DD/MM HH24:MI')
             || ' (v' || coalesce(r.version, '?') || ')'
             || E'\nKiểm tra Apps Script > Executions.';
    elsif r.oldest_held_at is not null and now() - r.oldest_held_at > c_stuck then
      v_age  := now() - r.oldest_held_at;
      v_kind := 'stuck';
      v_msg  := '🟠 Queue not cleared - luồng ' || r.transport || ': ' || r.held::text
             || ' thư chưa được process, cũ nhất '
             || round(extract(epoch from v_age) / 3600)::text || ' giờ.'
             || E'\nBáo lúc: ' || to_char(r.ran_at at time zone 'Asia/Ho_Chi_Minh', 'DD/MM HH24:MI')
             || ' (v' || coalesce(r.version, '?') || ')'
             || case when r.truncated then E'\nRun bị cắt ngắn - số thư giữ là mức tối thiểu.' else '' end
             || E'\nXem log Apps Script để biết lý do giữ.';
    end if;

    if v_kind is null then
      -- Recovered. Clearing the debounce lets the NEXT occurrence alert at once
      -- rather than waiting out a window started by the previous one; the
      -- RETURNING is what lets us say so out loud, and `found` is what keeps a
      -- ✅ from firing on every healthy tick — only when a row really existed.
      delete from public.pipeline_alert_state
       where transport = r.transport
      returning kind, stale_since into v_prev_kind, v_prev_stale;

      if found then
        if v_prev_kind = 'silent' and v_prev_stale is not null then
          v_down := greatest(round(extract(epoch from (r.ran_at - v_prev_stale)) / 60), 0);
          v_msg  := '✅ Pipeline revived - Đã sống lại sau khi im lặng ' || v_down::text || ' phút.';
        elsif v_prev_kind = 'silent' then
          v_msg  := '✅ Pipeline revived - Đã sống lại.';
        else
          v_msg  := '✅ Queue cleared - Hàng đợi đã thông.';
        end if;

        perform public._tg_send(v_msg
          || E'\nBáo lúc: ' || to_char(r.ran_at at time zone 'Asia/Ho_Chi_Minh', 'DD/MM HH24:MI')
          || ' (v' || coalesce(r.version, '?') || ')'
          || E'\nHàng đợi: ' || r.held::text || ' thư đang giữ.');
      end if;
      continue;
    end if;

    select last_sent_at into v_last from public.pipeline_alert_state
      where transport = r.transport and kind = v_kind;

    if v_last is null or now() - v_last > c_redo then
      perform public._tg_send(v_msg);
      -- stale_since is set on INSERT only. A re-alert 6h into the same incident
      -- must not move it, or the ✅ would report the length of the last window
      -- instead of the length of the outage.
      insert into public.pipeline_alert_state (transport, kind, last_sent_at, stale_since)
      values (r.transport, v_kind, now(), r.ran_at)
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

-- Backfill the one row 0119 left without a stale_since. `ran_at` is frozen at
-- the last good report for exactly as long as the pipeline stays down, so while
-- the incident is open this is the true start of the silence. Guarded on null so
-- re-running it can never overwrite a real value.
update public.pipeline_alert_state s
   set stale_since = h.ran_at
  from public.pipeline_health h
 where h.transport = s.transport
   and s.stale_since is null;
