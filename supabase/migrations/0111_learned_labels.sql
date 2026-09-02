-- 0111: the vocabulary learns — and two counters learn to actually count.
--
-- THE ASYMMETRY THIS CLOSES. When the model reads a mail the label table could
-- not, we hold both the body and the answer. deriveExtractionTemplate already
-- inverts that pairing to learn WHERE a value sits (a per-shape regex);
-- deriveLabelMappings (labeltable.mjs) now inverts it one level up to learn
-- WHAT A LABEL MEANS: "Tại Foody" beside counterparty="Foody" teaches
-- `tại → merchant`, which generalises to every shape that uses the word —
-- including banks we have not met. Six VIB shapes have been paying a model
-- call each because the hand-authored dictionary lacks five words.
--
-- EVIDENCE, NOT TRUTH. A row here is a vote. The reader applies a mapping only
-- at n >= 3 from the same sender domain — one mail where a value happens to
-- equal a field is a coincidence; three is a layout. Hardcoded LABELS always
-- wins over a learned mapping, and only SAFE fields may be learned (memo,
-- reference; merchant/beneficiary under type conditions) — never amount,
-- occurred_at, account or status, whose absorbers and format rules a heuristic
-- could subvert into a wrong number in a ledger.
--
-- THE KILL SWITCH IS A CONTRACT: `delete from learned_labels` restores
-- hand-authored behaviour exactly, and pipeline/learned-labels.test.js proves
-- it. label_norm is the bank's boilerplate on the stripped form — never a value
-- from anyone's mail; there is no column a value could go into.

begin;

create table if not exists public.learned_labels (
  label_norm    text        not null,   -- _strip()'d form, the same the reader matches on
  field         text        not null,   -- 'memo' | 'reference' | 'merchant' | 'beneficiary'
  sender_domain text        not null,   -- mappings are per-domain until proven wider
  n             bigint      not null default 1,
  first_seen    timestamptz not null default now(),
  last_seen     timestamptz not null default now(),
  primary key (label_norm, field, sender_domain)
);

alter table public.learned_labels enable row level security;
revoke all on table public.learned_labels from public, anon, authenticated;
grant select, insert, update, delete on table public.learned_labels to service_role;

comment on table public.learned_labels is
  'Label→field votes derived from model answers (deriveLabelMappings). Applied only at n>=3 per domain, safe fields only, hardcoded LABELS always wins. DELETE FROM this table fully restores hand-authored behaviour — that contract is pinned in pipeline/learned-labels.test.js. label_norm is bank boilerplate, never a value.';

-- ── counters that count ─────────────────────────────────────────────────────
-- recordDeriveFailure (0105 wiring) wrote through PostgREST merge-duplicates,
-- which UPDATES only the columns in the payload — `n` was not in the payload,
-- so it kept its default of 1 forever: a counter that counts to one. Found
-- while planning this migration, fixed the same way bump_read_tally works.

create or replace function public.record_derive_failure(
  p_sender text, p_subject text, p_step text, p_version int)
returns void language sql security definer set search_path = public as $$
  insert into public.template_derive_failures as t
         (sender_address, subject_template, step, logic_version)
  values (lower(p_sender), p_subject, p_step, p_version)
  on conflict (sender_address, subject_template, step, logic_version)
  do update set n = t.n + 1, last_seen = now();
$$;
revoke all on function public.record_derive_failure(text, text, text, int) from public, anon, authenticated;
grant execute on function public.record_derive_failure(text, text, text, int) to service_role;

create or replace function public.record_learned_label(
  p_domain text, p_label text, p_field text)
returns void language sql security definer set search_path = public as $$
  insert into public.learned_labels as l (label_norm, field, sender_domain)
  values (p_label, p_field, lower(p_domain))
  on conflict (label_norm, field, sender_domain)
  do update set n = l.n + 1, last_seen = now();
$$;
revoke all on function public.record_learned_label(text, text, text) from public, anon, authenticated;
grant execute on function public.record_learned_label(text, text, text) to service_role;

commit;
