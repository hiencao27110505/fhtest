-- 0106: bring template_derive_failures in line with its sibling telemetry tables.
--
-- 0105 created it with RLS enabled and no policies, which already denies anon
-- and authenticated — a policy-less RLS table answers nobody but service_role.
-- So this changes no behaviour today. It exists because the two tables it sits
-- beside, `read_tally` and `extract_miss_labels` (0099), also REVOKE the grants
-- outright, and the gap between them is the kind that stops being cosmetic the
-- day someone adds a permissive policy for an unrelated reason and inherits a
-- grant nobody meant to leave.
--
-- Defence in depth, and cheap: two independent mechanisms have to fail before
-- this table is readable rather than one.
--
-- WHAT IT HOLDS, and why that is safe to say plainly: a sender address, a
-- normalised subject shape, and the NAME of the derivation step that failed
-- ('date', 'amount', 'anchor:counterparty', 'proof:memo'). Never a value from
-- the mail — no amount, no counterparty, no account, no memo text. That is the
-- constraint the schema itself enforces: there is no column a value could go
-- into. It is written the same way `extract_miss_labels` learned to be written
-- after that table was found holding transaction amounts, a person's name and
-- cinema seat numbers under a comment promising values never leave the mail.
--
-- Next free migration number after this one: 0107. Verify against
-- `git ls-tree origin/main supabase/migrations/` before claiming it.

begin;

revoke all on table public.template_derive_failures from anon, authenticated;
grant select, insert, update on table public.template_derive_failures to service_role;

comment on table public.template_derive_failures is
  'Why a shape could not learn an extraction template, counted per (sender, subject, step, logic_version). Carries no mail content by design: a step NAME, never a value. Read it joined against sender_fingerprints where is_transaction_source and extraction_regex is null — that join names the cause of every shape still stuck on the paid model path.';

commit;
