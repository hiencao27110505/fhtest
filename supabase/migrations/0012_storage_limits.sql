-- FamilyHub — 0012: storage guardrails for the family-media bucket
--
-- NOT YET APPLIED. Review, then apply (Supabase SQL editor or apply_migration).
--
-- Safe to add now because the client downscales to <=1600px and re-encodes to
-- JPEG before upload (_compressImage in index.html), which also normalizes iOS
-- HEIC. Compressed photos land around 200-500 KB, so 10 MB is a generous ceiling
-- that still stops a runaway upload.
--
-- allowed_mime_types is deliberately permissive: if canvas encoding ever fails
-- the client falls back to uploading the ORIGINAL bytes (possibly HEIC) rather
-- than losing the photo, so those types must remain accepted.
update storage.buckets
   set file_size_limit    = 10485760,   -- 10 MB
       allowed_mime_types = array[
         'image/jpeg', 'image/png', 'image/webp',
         'image/gif',  'image/heic', 'image/heif'
       ]
 where id = 'family-media';
