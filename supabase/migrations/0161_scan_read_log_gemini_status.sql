-- 0161 ▸ scan_read_log: what Gemini itself answered, and how many times it was asked
-- (docs/features/receipt-scan.md, "Measuring a read").
--
-- 0159 recorded our own 502 and 504 but not what stood behind them. On 2026-10-10
-- two reads were refused by Gemini inside 1 to 3 seconds and one hung past the
-- function's 60 s limit, and the log could not say whether the refusals were a
-- rate limit (429) or an overload (503). The function now retries once on a
-- refusal or a hang, so the row also has to say what the FIRST answer was:
-- a retry that succeeds would otherwise hide the fault it recovered from.
--
-- Still no user, family or device id and nothing that was read. Additive and
-- nullable: rows written before this keep reading as they did.

alter table public.scan_read_log
  add column if not exists g_first  text check (g_first  is null or length(g_first)  <= 12),   -- first answer: an HTTP status, 'timeout' or 'network'
  add column if not exists g_status text check (g_status is null or length(g_status) <= 12),   -- last answer, same vocabulary
  add column if not exists tries    integer check (tries is null or tries between 0 and 10);
