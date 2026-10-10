-- 0160 — Statement balance (docs/specs/statement-balance-spec.md)
-- A bank statement prints the balance the setup wizard asks a person to type.
-- An anchor can now come from a statement, and a statement's balance is true
-- for the statement's last day, not for the moment it is written. So an anchor
-- read from a statement needs to carry that day, and the rows of the file that
-- decide which ledger rows it already contains.
--
-- One sealed column holds all of it: personal-DEK ciphertext of a small JSON
-- object ({ v, src, state, k, sid, asof, from, open, how, rows }). Null means the
-- anchor was typed (or there is none), which is how every existing row reads.
-- Nothing here is plaintext: the as-of day is inside the ciphertext, and
-- anchor_at keeps its place as the one timing key (for a statement anchor it is
-- the end of the as-of day, which an older client reads correctly as "typed
-- then").
--
-- Covered by the table's existing owner-only policy and grants (0105). The
-- client reads the column through a fallback, so this migration and the client
-- can land in either order.
alter table public.personal_accounts
  add column if not exists anchor_meta_enc text;
