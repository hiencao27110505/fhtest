-- ============================================================================
-- FamilyHub — 0004 RLS policies + Storage
-- Model: the browser talks to Postgres directly with the public anon key, so
-- every table is walled by RLS. Rule: you may only touch rows where
-- family_id = auth_family_id() (your profile's family). Plus bootstrap carve-outs
-- for families/profiles/invitations so a brand-new user isn't locked out.
-- ============================================================================

-- Base grants (RLS still gates every row underneath these)
grant usage on schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant execute on all functions in schema public to authenticated;

-- profiles: lock family_id (and email) so clients can't self-assign a family.
-- family_id is written ONLY by create_family / accept_invitation (SECURITY DEFINER).
revoke update on profiles from authenticated;
grant  update (display_name, avatar_url, language, theme) on profiles to authenticated;

-- ---------------------------------------------------------------------------
alter table families           enable row level security;
alter table profiles           enable row level security;
alter table members            enable row level security;
alter table categories         enable row level security;
alter table monthly_budgets    enable row level security;
alter table category_budgets   enable row level security;
alter table transactions       enable row level security;
alter table transaction_photos enable row level security;
alter table events             enable row level security;
alter table event_memories     enable row level security;
alter table savings_entries    enable row level security;
alter table event_fundings     enable row level security;
alter table invitations        enable row level security;

-- ---- families --------------------------------------------------------------
create policy families_select on families for select
  using (id = auth_family_id() or owner_id = auth.uid());
create policy families_insert on families for insert
  with check (owner_id = auth.uid());
create policy families_update on families for update
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());

-- ---- profiles: self always; plus same-family read ---------------------------
create policy profiles_select on profiles for select
  using (id = auth.uid() or family_id = auth_family_id());
create policy profiles_update on profiles for update
  using (id = auth.uid()) with check (id = auth.uid());
-- (no insert policy: rows are created by handle_new_user trigger, definer)

-- ---- generic family-scoped tables ------------------------------------------
-- Same shape for every table that carries family_id.
do $$
declare t text;
begin
  foreach t in array array[
    'members','categories','monthly_budgets','category_budgets','transactions',
    'transaction_photos','events','event_memories','savings_entries','event_fundings'
  ] loop
    execute format($f$
      create policy %1$s_select on %1$I for select using (family_id = auth_family_id());
      create policy %1$s_insert on %1$I for insert with check (family_id = auth_family_id());
      create policy %1$s_update on %1$I for update using (family_id = auth_family_id())
                                                   with check (family_id = auth_family_id());
      create policy %1$s_delete on %1$I for delete using (family_id = auth_family_id());
    $f$, t);
  end loop;
end $$;

-- ---- invitations -----------------------------------------------------------
-- family members see their family's invites; the invitee sees the one addressed
-- to their Gmail (so the app can show "You've been invited to <family>").
create policy invitations_select_family on invitations for select
  using (family_id = auth_family_id());
create policy invitations_select_invitee on invitations for select
  using (lower(invited_email) = auth_email());
-- create/revoke by a family member; accept goes through accept_invitation()
create policy invitations_insert on invitations for insert
  with check (family_id = auth_family_id() and invited_by = auth.uid());
create policy invitations_update on invitations for update
  using (family_id = auth_family_id()) with check (family_id = auth_family_id());

-- ============================================================================
-- Storage: one PRIVATE bucket, object paths prefixed by {family_id}/...
-- Serve every image via short-lived signed URLs. Never expose bare public URLs.
-- ============================================================================
insert into storage.buckets (id, name, public)
values ('family-media', 'family-media', false)
on conflict (id) do nothing;

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
