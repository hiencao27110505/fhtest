-- ============================================================================
-- FamilyHub — 0003 functions & triggers
--   * updated_at auto-bump on every table
--   * handle_new_user: create a profile row on first Google sign-in
--   * auth_family_id(): the caller's family (SECURITY DEFINER to avoid RLS recursion)
--   * create_family / invite_to_family / accept_invitation: the invite-by-Gmail flow
--   * seed_default_categories: vi/en starter categories
-- ============================================================================

-- ---------------------------------------------------------------------------
-- updated_at bump
-- ---------------------------------------------------------------------------
create or replace function set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

do $$
declare t text;
begin
  foreach t in array array[
    'families','profiles','members','categories','monthly_budgets','category_budgets',
    'transactions','transaction_photos','events','event_memories','savings_entries',
    'event_fundings','invitations'
  ] loop
    execute format(
      'create trigger trg_%1$s_updated before update on %1$I
         for each row execute function set_updated_at()', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Create a profile automatically when a Google user signs in the first time.
-- ---------------------------------------------------------------------------
create or replace function handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, display_name, avatar_url)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', new.email),
    new.raw_user_meta_data->>'avatar_url'
  )
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- ---------------------------------------------------------------------------
-- The caller's family id. SECURITY DEFINER so that reading profiles here does
-- NOT re-trigger profiles' own RLS (which would recurse). Used by every policy.
-- ---------------------------------------------------------------------------
create or replace function auth_family_id() returns uuid
language sql stable security definer set search_path = public as $$
  select family_id from public.profiles where id = auth.uid();
$$;

-- caller's email from the JWT (used to match invitations)
create or replace function auth_email() returns text
language sql stable as $$
  select lower(nullif(current_setting('request.jwt.claims', true)::jsonb->>'email',''));
$$;

-- ---------------------------------------------------------------------------
-- seed_default_categories(family, language)
-- ---------------------------------------------------------------------------
create or replace function seed_default_categories(p_family_id uuid, p_language language_code)
returns void
language plpgsql security definer set search_path = public as $$
begin
  insert into categories (family_id, name, emoji, color, sort_order) values
    (p_family_id, case when p_language='vi' then 'Nhà ở'    else 'Housing'   end, '🏠', '#7E6BE0', 1),
    (p_family_id, case when p_language='vi' then 'Đi chợ'   else 'Groceries' end, '🛒', '#1FA971', 2),
    (p_family_id, case when p_language='vi' then 'Ăn ngoài' else 'Dining'    end, '🍽️', '#E14B8A', 3),
    (p_family_id, case when p_language='vi' then 'Đi lại'   else 'Transport' end, '🚗', '#12B5A6', 4),
    (p_family_id, case when p_language='vi' then 'Giải trí' else 'Fun'       end, '🎉', '#9D4EFF', 5),
    (p_family_id, case when p_language='vi' then 'Con cái'  else 'Kids'      end, '🎒', '#F0701A', 6);
end $$;

-- ---------------------------------------------------------------------------
-- create_family(name, currency, language)
-- Creates the family, attaches the caller, seeds an owner member + a "Shared"
-- member + default categories. Bypasses the profiles.family_id write-lock because
-- it runs SECURITY DEFINER. Returns the new family id.
-- ---------------------------------------------------------------------------
create or replace function create_family(
  p_name text,
  p_currency currency_code default 'VND',
  p_language language_code default 'vi'
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_uid    uuid := auth.uid();
  v_family uuid;
  v_prof   profiles;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;

  select * into v_prof from profiles where id = v_uid;
  if v_prof.family_id is not null then
    raise exception 'user already belongs to a family';
  end if;

  insert into families (name, owner_id, currency, default_language)
  values (p_name, v_uid, p_currency, p_language)
  returning id into v_family;

  update profiles set family_id = v_family where id = v_uid;

  -- owner as a real member, linked to the profile
  insert into members (family_id, user_id, name, is_shared)
  values (v_family, v_uid, coalesce(v_prof.display_name, 'Me'), false);

  -- the "Shared" pseudo-member
  insert into members (family_id, name, is_shared)
  values (v_family, case when p_language='vi' then 'Chung' else 'Shared' end, true);

  perform seed_default_categories(v_family, p_language);
  return v_family;
end $$;

-- ---------------------------------------------------------------------------
-- invite_to_family(email, member_id?) — caller must belong to a family.
-- Optionally binds the invitee to a pre-created member (e.g. the "James" slot).
-- ---------------------------------------------------------------------------
create or replace function invite_to_family(
  p_email text,
  p_member_id uuid default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_uid    uuid := auth.uid();
  v_family uuid;
  v_inv    uuid;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  select family_id into v_family from profiles where id = v_uid;
  if v_family is null then raise exception 'you are not in a family'; end if;

  -- if the member slot is given, it must belong to this family and be unlinked
  if p_member_id is not null then
    perform 1 from members
      where id = p_member_id and family_id = v_family and user_id is null;
    if not found then raise exception 'invalid member slot for this family'; end if;
  end if;

  insert into invitations (family_id, invited_email, invited_by, member_id)
  values (v_family, lower(p_email), v_uid, p_member_id)
  on conflict (family_id, lower(invited_email)) where (status = 'pending')
    do update set token = gen_random_uuid(),
                  member_id = excluded.member_id,
                  expires_at = now() + interval '14 days',
                  updated_at = now()
  returning id into v_inv;

  return v_inv;
end $$;

-- ---------------------------------------------------------------------------
-- accept_invitation(token) — invitee calls this after signing in with the
-- invited Gmail. Validates email + expiry, attaches the profile, links/creates
-- their member row, marks the invite accepted. Returns the family id.
-- ---------------------------------------------------------------------------
create or replace function accept_invitation(p_token uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_uid   uuid := auth.uid();
  v_email text := auth_email();
  v_inv   invitations;
  v_prof  profiles;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;

  select * into v_inv from invitations where token = p_token;
  if not found then raise exception 'invitation not found'; end if;
  if v_inv.status <> 'pending' then raise exception 'invitation is not pending'; end if;
  if v_inv.expires_at < now() then
    update invitations set status = 'expired' where id = v_inv.id;
    raise exception 'invitation expired';
  end if;
  if v_email is null or lower(v_inv.invited_email) <> v_email then
    raise exception 'this invitation was sent to a different email';
  end if;

  select * into v_prof from profiles where id = v_uid;
  if v_prof.family_id is not null then
    raise exception 'user already belongs to a family';
  end if;

  update profiles set family_id = v_inv.family_id where id = v_uid;

  if v_inv.member_id is not null then
    update members set user_id = v_uid where id = v_inv.member_id and family_id = v_inv.family_id;
  else
    insert into members (family_id, user_id, name, is_shared)
    values (v_inv.family_id, v_uid, coalesce(v_prof.display_name, v_email), false);
  end if;

  update invitations set status = 'accepted', accepted_at = now() where id = v_inv.id;
  return v_inv.family_id;
end $$;
