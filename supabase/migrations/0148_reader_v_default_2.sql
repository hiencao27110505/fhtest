-- 0148_reader_v_default_2.sql
--
-- Every mailbox moved to reader 2 on 2026-09-22 02:16 UTC. A mailbox connected
-- twenty minutes later still defaulted to 1 (0147's default), and its first 219
-- rows were sealed by the old reader with none of the v2 facts, which is how the
-- founder's second account tested "v2" without ever touching it. From here on a
-- new grant starts on the reader everyone else runs. Applied 2026-09-22.

begin;
alter table public.mailbox_grants alter column reader_v set default 2;
update public.mailbox_grants set reader_v = 2 where reader_v <> 2;
commit;
