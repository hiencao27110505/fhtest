-- 0154_receipt_enrichment — the schema half of receipt-enrichment-spec.md L1.
--
-- Merchant e-receipts (Shopee, Grab, Apple, …) will stage as sealed rows that
-- ANNOTATE a captured transaction instead of becoming one, and the attached
-- detail lands on the personal spine as one encrypted blob. Two changes, both
-- additive and inert until the capture landing (L2) starts fetching receipt
-- domains — nothing live changes behaviour when this applies.
--
-- 1. personal_transactions.receipt_enc — the attached receipt, one JSON blob
--    ({source, seller, order_id, items[{name,qty,unit_price,line_discount,
--    variant,node}], items_total, discount, shipping_fee, paid, paid_with_tail})
--    encrypted as ONE value under the owner's personal DEK (encVal format,
--    base64(iv‖ct)), like every personal ciphertext. A blob and not a child
--    table on purpose (spec RC7): E2EE makes item fields unqueryable server-
--    side either way, the blob rides the existing single-row atomic writers,
--    and it is one more field in the fhPersonalRegen sweep instead of a whole
--    new table pass. Amounts inside are DETAIL — the row's amount_enc stays
--    the only figure stats read, so an unreadable blob costs a "chi tiết
--    không đọc được" line, never money.
--
-- 2. email_transactions.row_kind gains 'receipt'. A receipt is not pending
--    work: mailbox_read_status() (0147) already counts row_kind = 'txn' only,
--    so receipt rows are excluded from every badge and notification with no
--    function change — the same posture 'notice' shipped with. The clear
--    row_kind on a sealed row stays the deliberate metadata trade 0147
--    recorded (the umbrella spec's "metadata is not sealed" entry).

alter table public.personal_transactions
  add column if not exists receipt_enc text;

alter table public.email_transactions
  drop constraint if exists email_transactions_row_kind_known;
alter table public.email_transactions
  add constraint email_transactions_row_kind_known
  check (row_kind in ('txn', 'notice', 'receipt'));
