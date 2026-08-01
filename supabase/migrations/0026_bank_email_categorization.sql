-- ============================================================================
-- FamilyHub — 0026: bank email pipeline — categorization moved to human review
--
-- Follow-up to 0025 (bank/transaction email ingestion pipeline), landed as a
-- new migration rather than an edit to 0025 because 0025 has already been
-- applied to the live database — corrections to applied migrations go in a
-- new file, same pattern as 0016 fixing 0015.
--
-- Product decision (2026-08-01): categorization is human-driven, not
-- rule/keyword-based. category_rules was for automated keyword guessing,
-- which is exactly what's being postponed — dropped rather than left as
-- unused complexity. In its place: sender_fingerprints.default_category_id,
-- set once by a human during the same first review that sets
-- human_verified, then reused for every future auto-promotion of that
-- (sender, subject_template) pair. Both human_verified AND
-- default_category_id must be set before anything auto-promotes.
-- ============================================================================

alter table sender_fingerprints
  add column default_category_id uuid;  -- category chosen by the human during the first review of this
                                         -- (sender, subject_template) pair; reused for every future auto-promotion

comment on column sender_fingerprints.default_category_id is
  'Category chosen by a human during the first review of this (sender, subject_template) pair. '
  'Reused for every future auto-promotion — categorization is human-driven, not rule-based.';

drop table if exists category_rules;
