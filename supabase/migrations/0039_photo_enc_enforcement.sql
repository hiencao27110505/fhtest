-- ============================================================================
-- FamilyHub — 0039: storage-photo encryption enforcement for 'enc' families
--
-- Photo BYTES are encrypted client-side (AES-GCM with the family DEK) before
-- upload; encrypted objects carry an '.enc' path suffix and octet-stream
-- content type. The bucket stays public — a public URL to ciphertext reveals
-- nothing, and the stable-URL caching that 0017 bought is preserved.
--
-- The database cannot inspect bucket bytes, but it CAN refuse to reference a
-- plaintext object from an encrypted family's photo rows. Once enc_state='enc':
--   • INSERTs must carry photo_url NULL (emoji-only memories), an absolute
--     http(s) URL (never a bucket object), or a '%.enc' bucket path.
--   • photo_url may not be UPDATEd away from that shape either.
-- 'dual' is exempt on purpose: the trial window keeps plaintext authoritative
-- and abortable; photos are re-encrypted by the coverage job after the scrub
-- commits the family to 'enc'.
--
-- Apply AFTER the matching client build (stale clients would otherwise lose
-- the photo row on upload into an 'enc' family).
-- ============================================================================

create or replace function public._fh_photo_enc_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_state text;
begin
  select enc_state into v_state from family_keys where family_id = new.family_id;
  if v_state is distinct from 'enc' then return new; end if;
  -- UPDATEs are judged only when photo_url itself changes: legacy plaintext
  -- paths must survive unrelated column updates (caption coverage, sort moves)
  -- until the photo coverage job rewrites them to '.enc'.
  if tg_op = 'UPDATE' and new.photo_url is not distinct from old.photo_url then return new; end if;
  if new.photo_url is not null
     and new.photo_url not like 'http%'
     and new.photo_url not like '%.enc' then
    raise exception 'enc_required:%', tg_table_name || '.photo_url';
  end if;
  return new;
end $$;

do $$
declare t text;
begin
  foreach t in array array['transaction_photos','event_memories'] loop
    execute format('drop trigger if exists trg_%1$s_photo_enc_guard on public.%1$I;
                    create trigger trg_%1$s_photo_enc_guard before insert or update on public.%1$I
                      for each row execute function public._fh_photo_enc_guard()', t);
  end loop;
end $$;
