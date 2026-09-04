-- ============================================================================
-- FamilyHub — 0120: the alert channel has been dropping messages, silently
--
-- FOUND BY TESTING 0119. The first pipeline-health alert was composed, the
-- debounce recorded it as sent, and it never arrived. net._http_response:
--
--   status_code: null
--   error_msg:   Timeout of 5000 ms reached. Total time: 5000.866000 ms
--                (DNS time: 21.201000 ms, TCP/SSL handshake time: ...)
--
-- DNS resolved in 21ms, so Telegram is reachable; the TLS handshake and POST
-- simply do not finish within five seconds from ap-southeast-1. Confirmed by
-- probing the same host with an 8s budget, which returned 200.
--
-- 5000ms is pg_net's DEFAULT. _tg_send (0061) never passed
-- timeout_milliseconds, so every founder digest, every family-created
-- notification and every alert this project has ever sent has been running on
-- a budget that the route does not reliably fit inside.
--
-- WHY NOBODY NOTICED, AND WHY THAT IS THE REAL DEFECT. `perform
-- net.http_post(...)` only ENQUEUES the request. It returns an id immediately
-- and cannot fail on delivery, so the calling function succeeds, and
-- cron.job_run_details records `status: succeeded` for a digest that was never
-- delivered. Every layer reported success. The message just did not arrive.
--
-- That is precisely the failure class 0119 exists to catch — work that looks
-- healthy from every angle except the one nobody is looking at — reproduced
-- inside the alerting path itself. A monitor whose delivery is unobservable is
-- not a monitor; it is a second thing that can be quietly broken.
--
-- WHAT THIS CHANGES. One thing: a 15-second budget, three times the observed
-- handshake failure and well inside pg_net's worker cadence. Nothing else about
-- _tg_send moves — same signature, same vault lookup, same silent return when
-- the secrets are absent, so every existing caller is untouched.
--
-- WHAT THIS DOES NOT FIX, deliberately. Delivery is still not observable from
-- SQL after the fact: net._http_response retains roughly six hours and does not
-- record the request URL, so "did last Tuesday's digest arrive" remains
-- unanswerable. Making it answerable means logging request ids and reconciling
-- them, which is a real feature and should be decided on its own merits rather
-- than smuggled into a timeout fix. Noted in AGENT_SYNC as open.
--
-- Next free migration number after this one: 0121. Verify against
-- `git ls-tree origin/main supabase/migrations/` IMMEDIATELY BEFORE YOU PUSH.
-- ============================================================================

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
    headers := jsonb_build_object('Content-Type', 'application/json'),
    -- THE FIX. pg_net defaults to 5000ms and this route does not fit inside it:
    -- measured 5000.9ms spent in DNS + TCP/SSL alone, with the request never
    -- sent. See the header above for why the failure was invisible.
    timeout_milliseconds := 15000
  );
end;
$$;

comment on function public._tg_send(text) is
  'Founder Telegram notify. 15s timeout — pg_net''s 5s default is shorter than '
  'the TLS handshake to api.telegram.org from ap-southeast-1, and because '
  'net.http_post only enqueues, that shortfall surfaced nowhere: callers '
  'succeeded and messages silently did not arrive (0120).';
