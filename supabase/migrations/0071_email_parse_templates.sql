-- Learned rules for reading bank-notification email.
--
-- The transaction-parser function reads a mail by applying stored rules; only
-- when none of them work does it ask an LLM, which reads the mail AND proposes
-- a rule for next time. This table is where those proposals live, so the cost
-- of a new bank is a couple of API calls once rather than a code change and a
-- deploy.
--
-- NOT family-scoped, deliberately. A Techcombank credit notice has the same
-- shape for every household, so the rule that reads it is shared. That is only
-- safe because a rule contains no transaction data: it names the labels a bank
-- prints, and nothing else. See the `spec` column comment.

create table if not exists public.email_parse_templates (
  id           bigint generated always as identity primary key,

  -- The sender label the ingest function assigned ('techcombank', 'momo').
  -- Matches the values in senders.py; not an FK because that list lives in
  -- code, where adding a bank is a one-line change reviewed with its patterns.
  source       text        not null,

  -- The rule itself: {"amount": {"label": "Số tiền giao dịch", "type": "money"},
  -- ...}. Declarative on purpose — the parser matches these labels as literal
  -- substrings and never compiles or evaluates anything out of this column.
  -- Machine-authored content applied to money has to be inert, and a stored
  -- regex would not be.
  --
  -- Holds no amounts, no account numbers, no mail contents. Only field names.
  spec         jsonb       not null,

  -- Which model proposed it, for auditing a rule that turns out to misread.
  model        text,

  -- Operational counters. Cheap to keep and the only way to answer "is this
  -- rule still being used, or did the bank change its template months ago".
  hit_count    bigint      not null default 0,
  last_used_at timestamptz,

  created_at   timestamptz not null default now(),

  -- A rule must at least find the amount; one that cannot is inert and would
  -- make the parser fall through to the LLM on every mail anyway. Enforced
  -- here as well as in the application because this column is written by a
  -- background job acting on model output.
  constraint email_parse_templates_spec_has_amount
    check (spec ? 'amount'),

  -- Guards against a malformed proposal being stored as a scalar or an array.
  constraint email_parse_templates_spec_is_object
    check (jsonb_typeof(spec) = 'object'),

  constraint email_parse_templates_source_not_blank
    check (length(btrim(source)) > 0)
);

comment on table public.email_parse_templates is
  'Learned extraction rules for bank-notification email templates. Shared across families; contains no transaction data.';
comment on column public.email_parse_templates.spec is
  'Declarative label->field rules. Never compiled or evaluated: the parser matches these as literal substrings.';
comment on column public.email_parse_templates.source is
  'Sender label from senders.py, e.g. techcombank. Not an FK: that list lives in code.';

-- The same rule must not be stored twice. Two Cloud Function invocations can
-- learn from two mails off one template concurrently, and both will propose an
-- identical spec — so the dedup has to be a unique index the second insert
-- collides with, not a select-then-insert the two could interleave through.
--
-- On the jsonb value rather than a hash of it: jsonb normalises key order and
-- whitespace on input, so two proposals that differ only in formatting are
-- already equal here.
create unique index if not exists email_parse_templates_source_spec_uniq
  on public.email_parse_templates (source, spec);

-- The read path, and the only query in the hot path: "every rule for this
-- sender". Covering, so the lookup is index-only and does not visit the heap
-- for what is almost always a handful of rows.
create index if not exists email_parse_templates_source_idx
  on public.email_parse_templates (source)
  include (spec);

-- Row level security -------------------------------------------------------
--
-- Written and read only by the transaction-parser function, which connects as
-- service_role. RLS is enabled with NO policies: with RLS on and no policy,
-- every row is invisible to any role subject to it, so a client reaching
-- PostgREST with an anon or user JWT sees nothing. service_role has BYPASSRLS
-- and is unaffected.
--
-- Supabase's `alter default privileges` in schema public grant ALL to anon and
-- authenticated on every newly created table, so a new table is NOT private by
-- default here. The revokes below undo that. RLS with no policy already hides
-- every row; leaving INSERT to anon on a table the parser trusts is a second
-- line worth closing, because a row written here is applied to every future
-- mail from that sender.

alter table public.email_parse_templates enable row level security;

revoke all on public.email_parse_templates from anon, authenticated;
revoke all on sequence public.email_parse_templates_id_seq from anon, authenticated;

-- BYPASSRLS skips row policies, not table privileges: without these grants the
-- function fails with "permission denied" while every RLS check still passes.
grant usage on schema public to service_role;
grant select, insert, update, delete on public.email_parse_templates to service_role;
grant usage, select on sequence public.email_parse_templates_id_seq to service_role;
