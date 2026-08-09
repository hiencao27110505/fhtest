-- ============================================================================
-- FamilyHub — 0051: staging keypair storage for the bank-email pipeline
--
-- The pipeline writes rows from an unattended server-side script, which by
-- design can NEVER hold the family DEK. So staging rows are sealed to a family
-- PUBLIC key (ephemeral-static X25519 + XSalsa20-Poly1305, see
-- pipeline/SEALED-STAGING-DESIGN.md); the matching private key is wrapped under
-- the DEK, so any device that can open the safe can open staging rows, and no
-- server can open anything.
--
-- ADDITIVE AND DORMANT. Two nullable columns and two RPCs. Nothing writes them
-- until the client keypair flow ships; nothing reads them until sealing is
-- switched on. Existing families keep working untouched (staging_pub null =
-- "not provisioned yet", which the pipeline treats as "do not seal yet").
--
-- Deliberately does NOT modify get_family_snapshot (0048). Adding two columns
-- there would mean reproducing that whole function to change one select list —
-- a large blast radius for a small need, on a function that is actively being
-- revised. get_family_staging_key() is one extra round trip at unlock time
-- only, not per render. Fold it into the snapshot later if that ever matters.
--
-- Columns live on family_keys because it is already one row per family and
-- already carries enc_state. family_key_wraps (0042) is semantically about
-- wraps OF the DEK; this is a separate keypair whose private half happens to be
-- wrapped by it — different thing, wrong shelf. Easy to move if preferred.
-- ============================================================================

alter table public.family_keys
  add column if not exists staging_pub      text,   -- base64 X25519 public key, stored in the CLEAR (it only locks)
  add column if not exists staging_priv_enc text;   -- base64 private key, encVal(DEK, priv) — server never sees it unwrapped

comment on column public.family_keys.staging_pub is
  'Base64 X25519 public key. Public by design: the bank-email pipeline fetches it to seal staging rows and cannot decrypt anything with it.';
comment on column public.family_keys.staging_priv_enc is
  'Base64 X25519 private key, encrypted under the family DEK. Only an unlocked family device can unwrap it.';

-- ── provisioning: first writer wins ─────────────────────────────────────────
-- Two devices opening the app in the same minute must not both provision, or
-- the family ends up with two padlocks and half its boxes unopenable. The
-- UPDATE ... WHERE staging_pub IS NULL is atomic: the loser matches zero rows,
-- then reads back and adopts the winner's key.
--
-- Any family member may provision, not just the owner: whoever opens the app
-- first should be able to, and producing a valid wrap already requires holding
-- the DEK, so membership is the meaningful check.
create or replace function public.set_family_staging_key(p_pub text, p_priv_enc text)
returns json
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_fid uuid; v_pub text; v_priv text;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  if p_pub is null or p_priv_enc is null then raise exception 'staging_key_incomplete'; end if;

  select family_id into v_fid from profiles where id = v_uid;
  if v_fid is null then raise exception 'you are not in a family'; end if;

  update family_keys
     set staging_pub = p_pub, staging_priv_enc = p_priv_enc
   where family_id = v_fid and staging_pub is null;

  select staging_pub, staging_priv_enc into v_pub, v_priv
    from family_keys where family_id = v_fid;

  if v_pub is null then raise exception 'no_family_keys_row'; end if;

  -- Returns whatever is authoritative now: ours if we won the race, the other
  -- device's if we lost. The caller adopts the result either way and must NOT
  -- retry — a second keypair would orphan every box sealed to the first.
  return json_build_object('staging_pub', v_pub, 'staging_priv_enc', v_priv);
end $$;

create or replace function public.get_family_staging_key()
returns json
language plpgsql security definer set search_path = public
stable as $$
declare v_uid uuid := auth.uid(); v_fid uuid; v_pub text; v_priv text;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  select family_id into v_fid from profiles where id = v_uid;
  if v_fid is null then raise exception 'you are not in a family'; end if;

  select staging_pub, staging_priv_enc into v_pub, v_priv
    from family_keys where family_id = v_fid;

  -- nulls are a normal answer: "not provisioned yet"
  return json_build_object('staging_pub', v_pub, 'staging_priv_enc', v_priv);
end $$;

revoke execute on function public.set_family_staging_key(text, text) from public, anon;
grant  execute on function public.set_family_staging_key(text, text) to authenticated;
revoke execute on function public.get_family_staging_key()           from public, anon;
grant  execute on function public.get_family_staging_key()           to authenticated;
