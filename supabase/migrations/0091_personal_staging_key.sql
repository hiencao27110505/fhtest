-- ============================================================================
-- FamilyHub — 0091: a staging keypair for the PERSON, not just the family
--
-- THE GAP THIS CLOSES.
--
-- Bank email is sealed to `family_keys.staging_pub` — always, for every row,
-- because that is the only staging key that exists. But since Model Y (0079) a
-- person's money has two destinations: the family ledger, and their own
-- `personal_transactions` under their own key. The review screen already lets
-- them pick per row (`csvRowScope`).
--
-- So a transaction a person intends to keep private is, from arrival until they
-- promote it, sealed to a key their whole family shares. Nothing leaks today —
-- 0058's RLS scopes SELECT to the reader's own member rows, so no relative can
-- fetch those bytes through the API. But that means the privacy of personal
-- money in staging rests on ROW-LEVEL SECURITY ALONE, while the product tells
-- the person their personal data is under their own key. For family data those
-- two statements agree. For personal data they do not, and the encryption is
-- the half that is supposed to survive the other being wrong.
--
-- WHAT THIS ADDS. The same pair `family_keys` has, on `personal_keys`, wrapped
-- by the PERSONAL DEK instead of the family DEK. Plus the two markers that let
-- a row say which key opened it and which key it should have been sealed with.
--
-- WHAT THIS DELIBERATELY DOES NOT DO.
--
--   * No re-sealing of existing rows. A box is sealed to a key; changing our
--     minds later cannot reach inside one. Rows staged before this stay
--     family-sealed and open exactly as they do now, which is why
--     `staging_scope` defaults to 'family' rather than being NOT NULL with no
--     default — the old rows are honestly described, not retro-labelled.
--   * No escrow, no second copy of the personal private key. The whole point of
--     the personal key is that losing every device loses the data. Adding a
--     family-wrapped copy "for convenience" would quietly make personal money
--     readable by the family again, which is the bug this migration exists to
--     fix.
--   * No change to dedup. `email_transactions.member_id` stays set on personal
--     rows: it is the same person's own member row either way, so the existing
--     RLS keeps working unchanged AND a bank email cannot stage twice just
--     because one copy was destined for a different ledger.
--
-- Next free migration number after this one: 0092. Verify against
-- `git ls-tree origin/main supabase/migrations/` before claiming it.
-- ============================================================================

-- ── 1. the person's staging keypair ─────────────────────────────────────────
--
-- Mirrors family_keys exactly: the public half is readable by the worker so it
-- can seal, the private half is ciphertext wrapped by the owner's DEK and is
-- only ever unwrapped on a device.

alter table public.personal_keys
  add column if not exists staging_pub      text,
  add column if not exists staging_priv_enc text;

comment on column public.personal_keys.staging_pub is
  'X25519 public key the sync worker seals personal-scoped staged rows to. Readable by service_role; safe to publish.';
comment on column public.personal_keys.staging_priv_enc is
  'The matching private key, wrapped by the OWNER''S personal DEK. Never wrapped by a family DEK — a family-readable copy would undo the point of a personal ledger.';

-- ── 2. which key a staged row was sealed to ─────────────────────────────────
--
-- The client cannot guess. It holds two private keys and a sealed box gives no
-- hint which one opens it; trying both would turn a wrong answer into a silent
-- "unreadable row" instead of a clear one.

alter table public.email_transactions
  add column if not exists staging_scope text not null default 'family'
    constraint email_transactions_staging_scope_chk check (staging_scope in ('family', 'personal'));

comment on column public.email_transactions.staging_scope is
  'Which staging key sealed this row: ''family'' (family_keys.staging_pub) or ''personal'' (personal_keys.staging_pub). Defaults to family so every row written before 0091 keeps describing itself correctly.';

-- ── 3. where a mailbox's transactions are meant to go ───────────────────────
--
-- Declared at connect, per grant, so the worker knows which key to seal to
-- BEFORE it has read anything. Deciding at review would be too late: the row is
-- already sealed by then, and the point is that the plaintext never touched a
-- key the person did not choose.
--
-- 'family' stays the default because that is what every existing grant means,
-- and because a mailbox that feeds the household ledger is the case the feature
-- shipped for. A person routes their own mailbox to 'personal' deliberately.

alter table public.mailbox_grants
  add column if not exists default_scope text not null default 'family'
    constraint mailbox_grants_default_scope_chk check (default_scope in ('family', 'personal'));

comment on column public.mailbox_grants.default_scope is
  'Which ledger this mailbox feeds, and therefore which staging key its rows are sealed to. Chosen at connect: the worker must know before it reads, because a row cannot be re-sealed afterwards.';

-- ── 4. reading and writing the personal staging key ─────────────────────────
--
-- Same shape as 0051's family pair, and the same first-writer-wins rule. That
-- rule is the whole reason this is an RPC rather than an UPDATE: two devices
-- unlocking at once must not mint two keypairs, because the second one orphans
-- every box sealed to the first. The RPC writes only while staging_pub is null
-- and then returns whatever is authoritative, so the loser adopts the winner's
-- key instead of retrying.

create or replace function public.get_personal_staging_key()
returns json
language sql security definer set search_path = public stable as $$
  select coalesce(
    (select json_build_object('staging_pub', k.staging_pub, 'staging_priv_enc', k.staging_priv_enc)
       from personal_keys k where k.user_id = (select auth.uid())),
    json_build_object('staging_pub', null, 'staging_priv_enc', null));
$$;

revoke all on function public.get_personal_staging_key() from public, anon;
grant execute on function public.get_personal_staging_key() to authenticated;

comment on function public.get_personal_staging_key() is
  'The caller''s own personal staging keypair. Returns nulls rather than raising when none exists yet, so a first-run client can tell "not provisioned" from "failed".';

create or replace function public.set_personal_staging_key(p_pub text, p_priv_enc text)
returns json
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := (select auth.uid()); v_pub text; v_priv text;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  if p_pub is null or p_priv_enc is null then raise exception 'missing_keypair'; end if;

  -- FIRST WRITER WINS. `where staging_pub is null` is the whole guard: a second
  -- device racing in updates nothing and reads back the winner below. Never
  -- overwrite — a replaced key orphans every box already sealed to the old one,
  -- silently, and rotation is a separate deliberate ceremony.
  update personal_keys
     set staging_pub = p_pub, staging_priv_enc = p_priv_enc
   where user_id = v_uid and staging_pub is null;

  select staging_pub, staging_priv_enc into v_pub, v_priv
    from personal_keys where user_id = v_uid;

  -- No personal_keys row at all means the person has not provisioned a personal
  -- key yet. That is a client sequencing error, not a race, so say so.
  if v_pub is null then raise exception 'no_personal_key'; end if;

  return json_build_object('staging_pub', v_pub, 'staging_priv_enc', v_priv);
end $$;

revoke all on function public.set_personal_staging_key(text, text) from public, anon;
grant execute on function public.set_personal_staging_key(text, text) to authenticated;

comment on function public.set_personal_staging_key(text, text) is
  'Provisions the caller''s personal staging keypair, first-writer-wins. Returns the authoritative pair so a device that lost the race adopts it rather than minting a second keypair.';

-- ── 5. the worker needs the public half ────────────────────────────────────
--
-- Column-level, and only the PUBLIC half: service_role can seal to a person and
-- can never unwrap what it sealed. Same posture the family side takes.

grant select (user_id, staging_pub) on public.personal_keys to service_role;
