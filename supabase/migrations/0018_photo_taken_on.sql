-- FamilyHub — 0018: remember when a photo was actually taken
--
-- APPLIED 2026-07-20 to project fhtest (iizyukzfsbdkbrgfupwq).
--
-- Why this exists: the client pipes every photo through _compressImage(), which
-- redraws it on a <canvas> and re-encodes to JPEG. Canvas output carries NO EXIF,
-- so the capture date is destroyed before the bytes ever reach storage — and it
-- cannot be recovered afterwards. The client now parses EXIF DateTimeOriginal
-- from the ORIGINAL file bytes (before compression) and writes it here.
--
-- Deliberately a `date`, not a timestamptz. EXIF DateTimeOriginal is naive local
-- wall-clock with no zone, and transactions.txn_date is likewise a plain date.
-- Keeping both zone-free means they compare directly; converting through UTC
-- would shift photos taken between midnight and 07:00 (UTC+7) to the previous
-- day and silently mis-match them against yesterday's expenses.
--
-- Nullable on purpose: screenshots, images saved from chat apps, and raw HEIC
-- picked out of Files all arrive with no usable EXIF. Null means "unknown date",
-- which the UI buckets separately rather than guessing. We do NOT fall back to
-- file.lastModified — on iOS that is often the export/copy time, not the capture
-- time, which would look authoritative while being wrong.
alter table transaction_photos add column if not exists taken_on date;
alter table event_memories    add column if not exists taken_on date;

-- Supports the bulk-assign screen: "photos for day D" joined against that day's
-- transactions. Partial index — rows with no EXIF are never queried by date.
create index if not exists transaction_photos_taken_idx
  on transaction_photos (family_id, taken_on)
  where taken_on is not null;
