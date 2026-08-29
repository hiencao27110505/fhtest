-- 0100: provenance marker on ledger rows.
--
-- Adds a nullable `source` to the three ledger tables so an imported row can be
-- told apart from a hand-typed one, and one import transport from another. The
-- reset and "how much of the ledger is captured automatically" questions both
-- need this, and nothing recorded it before — a promoted email row was
-- byte-indistinguishable from a manual entry, and the staged row that linked
-- them is deleted on promote.
--
--   NULL                hand-entered (the default, untouched on every existing row)
--   'direct-email'      imported via direct mailbox read (the OAuth worker)
--   'forwarding-email'  imported via the forwarding pipeline
--   'csv-import'        imported from a CSV / XLSX file
--
-- Plain text, no CHECK: kept open so a new import path is one client change, not
-- a migration. It is provenance metadata, never money, so it stays plaintext
-- even on E2EE families — the enc guard covers amount/note, not this.

alter table public.transactions          add column if not exists source text;
alter table public.personal_transactions add column if not exists source text;
alter table public.personal_incomes      add column if not exists source text;
