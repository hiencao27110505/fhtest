-- ============================================================================
-- FamilyHub — 0114: cross-ledger move (docs/specs/cross-ledger-move-spec.md)
--
-- Two additive pieces, nothing existing altered:
--
-- 1) personal_transaction_photos — the personal ledger gains photo capture
--    parity with the family book (spec M5). Photo BYTES are the encrypted
--    artifact (AES-256-GCM under the personal DEK, uploaded as *.enc), so this
--    table has no ciphertext columns: photo_url addresses ciphertext,
--    taken_on follows the same plaintext-date rule as txn_date.
--
-- 2) personal-media bucket — family-media's policies pin the first path
--    folder to auth_family_id(), so personal photos get their own bucket,
--    path-keyed to auth.uid(). Public like family-media (0017's argument):
--    privacy comes from the key, not from hiding the address — every object
--    in it is ciphertext by construction.
-- ============================================================================

create table if not exists public.personal_transaction_photos (
  id             uuid primary key default gen_random_uuid(),
  owner_user_id  uuid not null references auth.users(id) on delete cascade,
  transaction_id uuid not null references public.personal_transactions(id) on delete cascade,
  photo_url      text not null,                    -- storage PATH in personal-media (not a full URL)
  sort_order     int  not null default 0,
  taken_on       date,                             -- EXIF capture day, if known
  created_at     timestamptz not null default now()
);

alter table public.personal_transaction_photos enable row level security;

drop policy if exists personal_txn_photos_owner on public.personal_transaction_photos;
create policy personal_txn_photos_owner on public.personal_transaction_photos
  for all
  using (owner_user_id = auth.uid())
  with check (owner_user_id = auth.uid());

create index if not exists personal_txn_photos_txn_idx
  on public.personal_transaction_photos (transaction_id);
create index if not exists personal_txn_photos_owner_idx
  on public.personal_transaction_photos (owner_user_id);

-- ── the bucket ──────────────────────────────────────────────────────────────
insert into storage.buckets (id, name, public)
values ('personal-media', 'personal-media', true)
on conflict (id) do nothing;

-- SELECT governs listing/metadata through the API; byte fetches on a public
-- bucket bypass it by design (the bytes are ciphertext). Writes are owner-only
-- by path prefix.
drop policy if exists personal_media_read   on storage.objects;
drop policy if exists personal_media_insert on storage.objects;
drop policy if exists personal_media_update on storage.objects;
drop policy if exists personal_media_delete on storage.objects;

create policy personal_media_read on storage.objects for select
  using (bucket_id = 'personal-media'
         and (storage.foldername(name))[1] = auth.uid()::text);
create policy personal_media_insert on storage.objects for insert
  with check (bucket_id = 'personal-media'
              and (storage.foldername(name))[1] = auth.uid()::text);
create policy personal_media_update on storage.objects for update
  using (bucket_id = 'personal-media'
         and (storage.foldername(name))[1] = auth.uid()::text);
create policy personal_media_delete on storage.objects for delete
  using (bucket_id = 'personal-media'
         and (storage.foldername(name))[1] = auth.uid()::text);
