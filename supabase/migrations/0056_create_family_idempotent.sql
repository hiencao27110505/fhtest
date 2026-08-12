-- ---------------------------------------------------------------------------
-- 0056 — create_family idempotency backstop
--
-- Why: onboarding's finish CTA (createFamilyInDB → create_family) had no reliable
-- client double-submit guard (it disabled the wrong button), so on a slow phone a
-- user who tapped "Continue" several times minted 2–3 duplicate families on one
-- Gmail. The client re-entrancy guard (70-goals-income-onboard-ui.js) is the
-- primary fix; THIS is the server backstop so a race / retry / offline-replay can
-- never create a second family for the same onboarding attempt.
--
-- Mechanism: the client generates ONE random key per onboarding attempt and passes
-- it to a 4-arg overload of create_family. The first call creates the family and
-- records (user_id, idempotency_key → family_id). Any later call with the SAME key
-- returns the SAME family_id and does nothing else. Keys are per-user (the unique
-- index is on (user_id, idempotency_key)) so two different users can never collide.
--
-- Back-compat: the original 3-arg create_family(text, currency_code, language_code)
-- is left UNTOUCHED and still works, so the currently-deployed build keeps running
-- until the new one ships. This adds an OVERLOAD, not a replacement.
-- ---------------------------------------------------------------------------

create table if not exists family_creation_keys (
  user_id         uuid not null references auth.users(id) on delete cascade,
  idempotency_key uuid not null,
  family_id       uuid not null references families(id) on delete cascade,
  created_at      timestamptz not null default now(),
  primary key (user_id, idempotency_key)
);

alter table family_creation_keys enable row level security;
-- No policies → no direct client access. Rows are written only by the SECURITY
-- DEFINER function below; the client never reads or writes this table itself.
revoke all on family_creation_keys from public, anon, authenticated;

create or replace function create_family(
  p_name            text,
  p_currency        currency_code default 'VND',
  p_language        language_code default 'vi',
  p_idempotency_key uuid          default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_uid    uuid := auth.uid();
  v_family uuid;
  v_prof   profiles;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;

  -- Idempotent replay: same user + same attempt key → hand back the family we
  -- already made, create nothing new. The advisory lock serializes concurrent
  -- calls sharing a key so the "check → create → record" sequence is atomic and
  -- the loser of a true race never creates an orphan family.
  if p_idempotency_key is not null then
    perform pg_advisory_xact_lock(hashtextextended(v_uid::text || p_idempotency_key::text, 0));
    select family_id into v_family
      from family_creation_keys
     where user_id = v_uid and idempotency_key = p_idempotency_key;
    if found then
      -- mirror create_family's side effect so a replay still lands the user in it
      update profiles set family_id = v_family where id = v_uid;
      return v_family;
    end if;
  end if;

  select * into v_prof from profiles where id = v_uid;
  insert into families (name, owner_id, currency, default_language)
  values (p_name, v_uid, p_currency, p_language) returning id into v_family;
  update profiles set family_id = v_family where id = v_uid;
  insert into members (family_id, user_id, name, is_shared)
  values (v_family, v_uid, coalesce(v_prof.display_name, 'Me'), false);
  insert into members (family_id, name, is_shared)
  values (v_family, case when p_language='vi' then 'Chung' else 'Shared' end, true);
  perform seed_default_categories(v_family, p_language);

  if p_idempotency_key is not null then
    -- Serialized by the advisory lock above, so this insert is always the winner.
    insert into family_creation_keys (user_id, idempotency_key, family_id)
    values (v_uid, p_idempotency_key, v_family);
  end if;

  return v_family;
end $$;

revoke execute on function public.create_family(text, currency_code, language_code, uuid) from public, anon;
grant  execute on function public.create_family(text, currency_code, language_code, uuid) to authenticated;
