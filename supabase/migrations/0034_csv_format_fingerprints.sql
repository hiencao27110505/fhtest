-- ============================================================================
-- FamilyHub — 0034: CSV import column-mapping fingerprint cache
--
-- Sibling to the bank-email pipeline's sender_fingerprints (0025), same idea
-- applied to CSV import: the first file with a given column-header shape gets
-- its mapping resolved by heuristics or the Gemini fallback (see
-- src/js-data/44-csv-parse.js, 45-csv-import.js, api/csv-column-mapping.js —
-- all shipped and validated against real data as of 2026-08-03); every later
-- file with the SAME header shape — from any family, not just the one that
-- hit Gemini first — reuses the cached mapping instead of calling the model
-- again. That cross-family reuse is the point: the universe of real export
-- shapes (VN banks, budgeting apps, expense-splitting apps) is small and
-- shared, unlike email senders which are effectively per-user.
--
-- ADDITIVE ONLY — no existing table touched.
--
-- NOT family-scoped, deliberately: a column-header shape ("Ngày,Nội dung,
-- Loại,Số tiền,...") isn't anyone's private data, so the usual
-- `family_id = (select auth_family_id())` RLS pattern (see CLAUDE.md §5)
-- doesn't apply here — there is no family_id column at all.
--
-- header_signature is the cache key: headers normalized (diacritics
-- stripped, lowercased, trimmed — same normalization as parseCsv's caller)
-- then SORTED and joined, so column reordering between two exports of the
-- same tool still hits the same cache row. Computed client-side today; if
-- that normalization ever needs to change, existing rows go stale silently
-- (no version column) — acceptable for a cache, but worth knowing.
--
-- OPEN QUESTIONS (flagged, not resolved here):
--   1. times_used / last_used_at need an UPDATE on every cache hit, but this
--      migration only grants authenticated SELECT + INSERT. Bumping those
--      columns from the client needs either a narrowly-scoped UPDATE policy
--      or (probably better) a SECURITY DEFINER RPC, same pattern as
--      get_family_snapshot — not built yet, since nothing client-side reads
--      or writes this table yet either (Stage 3 today always calls Gemini
--      fresh; wiring the cache lookup into resolveCsvMapping is a separate
--      follow-up).
--   2. format_family ('bank_statement' / 'expense_split' / 'budget_app' /
--      'unknown') is designed but not yet populated by any code — the
--      classifier that would set it doesn't exist yet.
-- ============================================================================

create table csv_format_fingerprints (
  id uuid primary key default gen_random_uuid(),
  header_signature text not null unique,   -- normalized, sorted, joined headers — the cache key
  column_mapping jsonb not null,           -- [{column_index, field, confidence}, ...] — same shape api/csv-column-mapping.js returns
  date_convention text check (date_convention in ('dd/mm/yyyy', 'mm/dd/yyyy', 'unclear', 'not_applicable')),
  format_family text check (format_family in ('bank_statement', 'expense_split', 'budget_app', 'unknown')),  -- not populated yet, see open question 2
  resolved_by text not null check (resolved_by in ('heuristics', 'gemini')),
  times_used integer not null default 1,   -- see open question 1 — not incremented by any code yet
  last_used_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index on csv_format_fingerprints (last_used_at desc);

-- Shared reference data, not per-family — any signed-in user can look up a
-- known shape or contribute a newly-resolved one. No UPDATE/DELETE policy:
-- a fingerprint is superseded by a fresh row, not edited in place, until the
-- reuse-counter question above is actually resolved.
alter table csv_format_fingerprints enable row level security;

create policy "authenticated can read fingerprints"
  on csv_format_fingerprints for select
  to authenticated
  using (true);

create policy "authenticated can add fingerprints"
  on csv_format_fingerprints for insert
  to authenticated
  with check (true);
