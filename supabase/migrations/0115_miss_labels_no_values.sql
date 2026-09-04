-- 0115: extract_miss_labels records labels. Make that true, and enforceable.
--
-- WHY. The table's call site describes it as "bank boilerplate, no values, no
-- amounts, nothing personal — the only training data this pipeline collects".
-- On 2026-09-03 it held 1,627 rows whose 697 distinct entries included 500
-- amount-shaped strings and 318 names or merchants: the account holder's own
-- name in 772 rows ("Kính gửi CAO THÁI DUY HIỂN"), their coffee shops, their
-- Apple bills, bare figures like "7,500,000 ₫".
--
-- Access control was never the defect — RLS is on, there are no policies, and
-- only service_role holds a grant, so no client could read a byte of it. The
-- defect is that a database whose entire staging design exists to hold money it
-- cannot read had acquired a plaintext table of one person's spending, under a
-- comment asserting the opposite, described by no consent text we have shown
-- anyone.
--
-- HOW IT HAPPENED. The writer asked whether a line LOOKED like a label: short,
-- few words, no run of four digits. In production line-form rendering a VALUE
-- looks exactly like that, and a formatted VND amount never presents four
-- consecutive digits because of its comma separators — so "500,000 ₫" passed
-- every test there was. labeltable.mjs now subtracts the extraction's own
-- values and rejects digits, currency, hosts and proper-noun runs
-- (pipeline/miss-labels-hygiene.test.js pins each family against the real
-- leaked entries).
--
-- PURGE, not repair. The rows carry no provenance, so nothing distinguishes a
-- genuine label that happens to contain a digit from a captured value. They are
-- also the least valuable thing here: the table refills from live mail within
-- days, and what it refills with is now clean.

begin;

delete from public.extract_miss_labels;

-- The backstop. The application filter is the one that understands context —
-- it can subtract the extraction's own answer, which SQL cannot see. This
-- constraint is the part that does not depend on any caller getting it right,
-- in the same spirit as email_transactions_sealed_or_plain: the shapes that
-- carry money must be UNWRITABLE, not merely unwritten.
--
-- Deliberately narrow. It catches digits, currency and over-long strings —
-- every amount, date, reference and account number. It cannot catch a name or a
-- merchant, because to SQL those are just words; that half is the application's
-- job and is tested there. A constraint that tried would reject real labels.
-- A CHECK may not contain a subquery, and testing each array element needs one,
-- so the test lives in an IMMUTABLE function the constraint calls instead.
-- CAVEAT worth knowing: Postgres does not re-validate existing rows if this
-- function is later redefined. Loosening it is therefore not the same as
-- loosening a plain CHECK — rewrite the constraint, do not quietly edit this.
create or replace function public.miss_labels_are_clean(p_labels text[])
returns boolean
language sql
immutable
as $$
  select coalesce(bool_and(
    l !~ '[0-9]' and l !~ '(₫|VND|\$)' and length(l) <= 64
  ), true)
  from unnest(coalesce(p_labels, '{}'::text[])) as l
$$;

alter table public.extract_miss_labels
  add constraint extract_miss_labels_no_values
  check (public.miss_labels_are_clean(labels));

commit;
