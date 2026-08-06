-- ============================================================================
-- FamilyHub — 0044: seed known_provider_domains with major VN bank senders
--
-- Drives the bank-email pipeline's onboarding bank-picker UI and the (not yet
-- built) backfill triage. Domains verified against each bank's own site
-- during research — two corrections from the obvious guess worth noting:
-- Techcombank is techcombank.com (not .com.vn), TPBank is tpb.vn (not
-- tpbank.com.vn). transaction_type is 'bank_txn' as a generic best-guess only
-- (informs backfill triage, not a hard classification — real classification
-- still happens per-email via the extraction pipeline).
--
-- Does NOT touch sender_fingerprints — those still only get created from a
-- real email once seen, per the pipeline's existing design.
-- ============================================================================

insert into known_provider_domains (domain_or_address, provider_name, transaction_type) values
  ('vietcombank.com.vn', 'Vietcombank',  'bank_txn'),
  ('mbbank.com.vn',      'MB Bank',      'bank_txn'),
  ('techcombank.com',    'Techcombank',  'bank_txn'),
  ('acb.com.vn',         'ACB',          'bank_txn'),
  ('vpbank.com.vn',      'VPBank',       'bank_txn'),
  ('bidv.com.vn',        'BIDV',         'bank_txn'),
  ('agribank.com.vn',    'Agribank',     'bank_txn'),
  ('tpb.vn',             'TPBank',       'bank_txn'),
  ('sacombank.com.vn',   'Sacombank',    'bank_txn'),
  ('hdbank.com.vn',      'HDBank',       'bank_txn'),
  ('shb.com.vn',         'SHB',          'bank_txn')
on conflict (domain_or_address) do nothing;
