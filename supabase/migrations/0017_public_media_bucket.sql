-- ============================================================================
-- 0017: flip family-media to a public bucket
--
-- Why: 0004 made the bucket private and served every image through
-- createSignedUrls(). That call signed the family's ENTIRE photo history on
-- every hydrate — and the app re-hydrates on focus, on realtime change, and
-- after every write. Worse, each signature produced a different URL string, so
-- the browser cache never hit and every photo was re-downloaded from scratch
-- each time the app came to the foreground. That was the app's startup lag.
--
-- Public here means: knowing the exact object path is enough to GET the bytes.
-- Paths are '{family_id}/{timestamp}_{random}.{ext}' — a v4 UUID plus a random
-- suffix, so they are not enumerable by guessing. This is "unlisted link"
-- privacy, not access control: anyone the URL is shared with can view it.
--
-- What does NOT change: the RLS policies below still gate insert / update /
-- delete and object LISTING to members of the owning family. A stranger cannot
-- enumerate the bucket, only fetch a path they were already given.
-- ============================================================================

update storage.buckets set public = true where id = 'family-media';

-- Re-assert the write-side + listing policies unchanged, so this migration is
-- self-documenting about what still guards the bucket.
drop policy if exists family_media_read   on storage.objects;
drop policy if exists family_media_insert on storage.objects;
drop policy if exists family_media_update on storage.objects;
drop policy if exists family_media_delete on storage.objects;

-- SELECT governs listing/metadata through the API. Byte fetches on a public
-- bucket bypass this by design.
create policy family_media_read on storage.objects for select
  using (bucket_id = 'family-media'
         and (storage.foldername(name))[1] = auth_family_id()::text);
create policy family_media_insert on storage.objects for insert
  with check (bucket_id = 'family-media'
              and (storage.foldername(name))[1] = auth_family_id()::text);
create policy family_media_update on storage.objects for update
  using (bucket_id = 'family-media'
         and (storage.foldername(name))[1] = auth_family_id()::text);
create policy family_media_delete on storage.objects for delete
  using (bucket_id = 'family-media'
         and (storage.foldername(name))[1] = auth_family_id()::text);
