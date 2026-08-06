-- ============================================================================
-- FamilyHub — Phase 0 rehearsal for the Key Card auth (0042)
--
-- Runs against a DB that HAS 0042 applied (a branch or the live DB — it is
-- wrapped in a transaction and ROLLS BACK, touching no real data, following the
-- 0030 rehearsal pattern: simulate a user via request.jwt.claims, exercise the
-- whole flow on a throwaway family, assert, roll back.)
--
-- The CLIENT crypto (genCard/parseCard/checksum, 60k cases) is validated
-- separately in JS. This harness validates the SERVER surface: the wrap table,
-- the two RPCs, the owner/member permission split, the one-live-wrap-per-kind
-- constraint, and that get_family_snapshot ships key_wraps.
--
-- Usage:  psql "$DATABASE_URL" -f 0042_card_rehearsal.sql   (or via MCP)
-- Expect: a series of NOTICE 'PASS …' lines and a final ROLLBACK. Any assertion
-- that fails raises an exception and aborts (rolling back).
-- ============================================================================
begin;

do $$
declare
  v_owner uuid; v_member uuid; v_fam uuid; v_id1 uuid; v_id2 uuid;
  v_live int; v_snap json; v_wraps json; v_denied boolean;
  DUMMY_WRAP text := repeat('A', 48);   -- stands in for b64(iv‖AES-GCM(K_wrap,DEK)); RPC only length-checks
begin
  -- ── throwaway users + family ────────────────────────────────────────────
  v_owner  := gen_random_uuid();
  v_member := gen_random_uuid();
  insert into auth.users (id, email) values (v_owner, 'owner-rehearsal@example.com'), (v_member, 'member-rehearsal@example.com');
  -- profiles are created by a trigger on auth.users in this project; ensure rows exist
  insert into profiles (id, email) values (v_owner, 'owner-rehearsal@example.com') on conflict (id) do nothing;
  insert into profiles (id, email) values (v_member, 'member-rehearsal@example.com') on conflict (id) do nothing;

  -- act as the owner and create a family via the real RPC
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated', 'email', 'owner-rehearsal@example.com')::text, true);
  v_fam := create_family('Rehearsal Family');   -- currency/language defaults avoid enum-cast fragility
  raise notice 'PASS created family %', v_fam;

  -- add a second member seat and link the member user to it
  insert into members (family_id, user_id, name) values (v_fam, v_member, 'Member');
  update profiles set family_id = v_fam where id = v_member;

  -- ── set_family_card (owner) ──────────────────────────────────────────────
  v_id1 := set_family_card('deadbeef'::text, 600000, 1, DUMMY_WRAP, 'first');
  select count(*) into v_live from family_key_wraps where family_id = v_fam and kind = 'card' and rotated_at is null;
  if v_live <> 1 then raise exception 'FAIL expected 1 live card wrap, got %', v_live; end if;
  raise notice 'PASS set_family_card created one live card wrap';

  -- ── get_family_snapshot ships key_wraps ──────────────────────────────────
  v_snap := get_family_snapshot(null);
  v_wraps := v_snap -> 'key_wraps';
  if v_wraps is null or json_array_length(v_wraps) < 1 then raise exception 'FAIL snapshot missing key_wraps'; end if;
  if (v_wraps -> 0 ->> 'kind') <> 'card' then raise exception 'FAIL snapshot wrap kind not card'; end if;
  if (v_wraps -> 0 ->> 'wrapped_dek') <> DUMMY_WRAP then raise exception 'FAIL snapshot wrapped_dek mismatch'; end if;
  raise notice 'PASS snapshot ships the live card wrap';

  -- ── set_family_card is idempotent (retires old, one live remains) ────────
  v_id2 := set_family_card('cafebabe'::text, 600000, 1, repeat('B', 48), 'second');
  select count(*) into v_live from family_key_wraps where family_id = v_fam and kind = 'card' and rotated_at is null;
  if v_live <> 1 then raise exception 'FAIL re-set left % live card wraps', v_live; end if;
  if exists (select 1 from family_key_wraps where id = v_id1 and rotated_at is null) then raise exception 'FAIL old wrap not rotated'; end if;
  raise notice 'PASS re-set retires the previous wrap (one live remains)';

  -- ── rotate_family_card allowed for a non-owner MEMBER ────────────────────
  perform set_config('request.jwt.claims', json_build_object('sub', v_member, 'role', 'authenticated', 'email', 'member-rehearsal@example.com')::text, true);
  perform rotate_family_card('f00dface'::text, 600000, 1, repeat('C', 48), 'by-member');
  select count(*) into v_live from family_key_wraps where family_id = v_fam and kind = 'card' and rotated_at is null;
  if v_live <> 1 then raise exception 'FAIL member rotate left % live wraps', v_live; end if;
  raise notice 'PASS any keyed member may rotate the card (OQ3)';

  -- ── set_family_card DENIED for a non-owner member (owner-only) ───────────
  v_denied := false;
  begin
    perform set_family_card('11111111'::text, 600000, 1, repeat('D', 48), 'should-fail');
  exception when others then v_denied := true;
  end;
  if not v_denied then raise exception 'FAIL non-owner was allowed to set_family_card'; end if;
  raise notice 'PASS set_family_card is owner-only';

  -- ── bad key material is rejected ─────────────────────────────────────────
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated', 'email', 'owner-rehearsal@example.com')::text, true);
  v_denied := false;
  begin perform set_family_card('x'::text, 50, 1, 'short', null); exception when others then v_denied := true; end;
  if not v_denied then raise exception 'FAIL bad key material accepted'; end if;
  raise notice 'PASS bad key material rejected';

  raise notice '──────── ALL CARD REHEARSAL ASSERTIONS PASSED ────────';
end $$;

rollback;
