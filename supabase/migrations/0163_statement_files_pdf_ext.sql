-- 0163: statement_files accepts file_ext = 'pdf'  (applied 2026-11-08)
--
-- pdf-statements-spec PS1: the lane lists PDF statements since mailbox-sync v78
-- (2026-11-08), but 0139's check on statement_files.file_ext still named only
-- xlsx and csv, so every PDF insert failed with 23514 and left a sealed object
-- with no row (one per PDF statement mail per mailbox per tick, until this).
-- Widen the check; nothing else about the row changes.
alter table public.statement_files
  drop constraint if exists statement_files_file_ext_check;
alter table public.statement_files
  add constraint statement_files_file_ext_check
  check (file_ext in ('xlsx', 'csv', 'pdf'));
