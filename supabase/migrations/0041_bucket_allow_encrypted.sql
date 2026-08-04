-- ============================================================================
-- FamilyHub — 0041: family-media accepts encrypted photo objects
--
-- Found in production the day 0038/0039 shipped: encrypted photo uploads
-- (AES-GCM bytes, contentType application/octet-stream, '.enc' suffix) were
-- rejected by the bucket's 0012 mime allowlist, which predates photo E2EE and
-- only lists image types. Every encrypted family's photo upload — and the
-- coverage sweep re-encrypting the photo history — failed at the storage
-- layer (cleanly: no rows written, "Ảnh chưa lưu được" toast, plaintext
-- history left untouched).
--
-- Adding octet-stream costs the allowlist nothing real: contentType is
-- client-declared and never verified against the bytes, so the list was
-- always a tripwire rather than a gate — and ciphertext is exactly the
-- content this bucket now exists to hold. The 10 MB cap still applies.
-- ============================================================================

update storage.buckets
   set allowed_mime_types = array[
         'image/jpeg', 'image/png', 'image/webp',
         'image/gif',  'image/heic', 'image/heif',
         'application/octet-stream'
       ]
 where id = 'family-media';
