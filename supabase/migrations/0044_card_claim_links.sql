-- ============================================================================
-- FamilyHub — 0044: one-time claim links (the opaque card URL)
--
-- A shared card link must not carry the card in the clear. Instead the sender
-- encrypts the card under a random link-key (client-side, AES-GCM), parks the
-- CIPHERTEXT here under a random token, and the URL fragment carries only
-- `#fh-claim=<token>.<link-key>`. The server stores ciphertext it cannot read
-- (the link-key never reaches it — it lives in the fragment). The token is
-- single-use and expires in 15 minutes, so an intercepted link dies fast and
-- can be used at most once. Durable card backups stay self-contained (QR / text
-- / save-file); only the shareable LINK is ephemeral + opaque.
-- ============================================================================

create table if not exists public.card_claims (
  token       text primary key,
  family_id   uuid not null references public.families(id) on delete cascade,
  ciphertext  text not null,                 -- AES-GCM(link_key, card); server never holds link_key
  created_by  uuid,
  expires_at  timestamptz not null,
  claimed_at  timestamptz,
  created_at  timestamptz not null default now()
);
create index if not exists card_claims_expiry on public.card_claims (expires_at);
alter table public.card_claims enable row level security;   -- no policies: definer RPCs only

-- Park a claim (any keyed member of a family — they hold the card to encrypt).
create or replace function public.create_card_claim(p_token text, p_ciphertext text, p_ttl int default 900)
returns text
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_fid uuid;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  select family_id into v_fid from profiles where id = v_uid;
  if v_fid is null then raise exception 'you are not in a family'; end if;
  if length(coalesce(p_token,'')) < 16 or length(coalesce(p_ciphertext,'')) < 20 then raise exception 'bad claim'; end if;
  delete from card_claims where expires_at < now() - interval '1 hour';   -- opportunistic prune
  insert into card_claims (token, family_id, ciphertext, created_by, expires_at)
  values (p_token, v_fid, p_ciphertext, v_uid, now() + make_interval(secs => greatest(60, least(p_ttl, 3600))));
  return p_token;
end $$;
revoke execute on function public.create_card_claim(text, text, int) from public, anon;
grant  execute on function public.create_card_claim(text, text, int) to authenticated;

-- Redeem a claim once (any authenticated user — the token is the capability).
create or replace function public.redeem_card_claim(p_token text)
returns json
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_ct text; v_fid uuid; v_exp timestamptz; v_claimed timestamptz;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  select ciphertext, family_id, expires_at, claimed_at into v_ct, v_fid, v_exp, v_claimed
    from card_claims where token = p_token;
  if v_ct is null then raise exception 'claim_not_found'; end if;
  if v_claimed is not null then raise exception 'claim_used'; end if;
  if v_exp < now() then raise exception 'claim_expired'; end if;
  update card_claims set claimed_at = now() where token = p_token;
  return json_build_object('ciphertext', v_ct, 'family_id', v_fid);
end $$;
revoke execute on function public.redeem_card_claim(text) from public, anon;
grant  execute on function public.redeem_card_claim(text) to authenticated;
