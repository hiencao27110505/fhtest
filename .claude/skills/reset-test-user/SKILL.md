---
name: familyhub-reset-test-user
description: Reset a FamilyHub test account back to a brand-new user so the same Gmail can re-run onboarding. Triggers on "reset test user", "reset onboarding", "delete user", "wipe my account", "test onboarding again", "brand new user", "xóa user test", "reset tài khoản test", or any request to re-test the FamilyHub new-user / create-family flow. Deletes every family the account SOLELY owns (all its data + media-metadata rows; media blobs purged out-of-band via the Storage API), and by default deletes the auth.users account too. Requires an email argument; protects real/shared families.
---

# FamilyHub — Reset a test user for onboarding

Wipe a test account so the **same Gmail can go through the brand-new-user onboarding again**.
Backend is the **live `fhtest` Supabase project** with real family data — this skill is scoped to
delete only what the given account solely owns, and it **aborts** rather than touch a shared/real
family. Run everything through the **Supabase MCP** (`mcp__supabase__execute_sql`), project ref
**`iizyukzfsbdkbrgfupwq`**.

## Modes

- **hard (default)** — purge owned families + data, then delete the `auth.users` row. Next Google
  sign-in mints a new user id and `handle_new_user()` recreates a fresh profile → truly first-time
  account (replays welcome → locale → auth → choice). You must sign in again.
- **`--soft`** — same purge, but keep the `auth.users` row and set `profiles.family_id = NULL`.
  Reload the app → drops straight into the create/join onboarding, no re-login. Infinitely
  repeatable. (Do **not** delete the profiles row in soft mode: `create_family()` does
  `UPDATE profiles …`, and the auto-create trigger only fires on user creation — a missing profile
  leaves a broken half-state.)

## Required argument

An **email** is mandatory. If the user didn't give one, ask — never guess, never default.
Optional flag: `--soft` (anything else, or nothing, means hard).

## Steps

### 1. Dry run — always first
Read `preview.sql`, replace every `__EMAIL__` with the target address, run it via
`execute_sql`. Interpret the single row:
- `user_id` is **NULL** → no such account. Stop, tell the user.
- `protected_shared_memberships` is **non-null** → the account belongs to a family it does not
  solely own. **Stop.** Report those families; do not delete anything. (Reset the account manually
  only if the user insists it's disposable.)
- Otherwise show a one-line summary: the email, how many families will be deleted, and the
  per-family counts (transactions / members / photos / events). This is what will be destroyed.

### 2. Confirm
Show the summary and the mode (hard/soft) and get a quick go-ahead. Skip the confirm only if the
user already said "just do it" / "no confirm" in the same request. It's a live prod DB.

### 3. Apply
Read `reset.sql`, replace every `__EMAIL__`. **For `--soft`, delete the lines between
`-- >>> HARD ONLY …` and `-- <<< HARD ONLY …`** (keep the markers-free remainder). For hard mode,
send the file as-is (markers are SQL comments, harmless). Run the whole thing in one
`execute_sql` call — it is a single `BEGIN … COMMIT` transaction, so it all lands or none does.

`reset.sql` deletes the `transaction_photos` **rows** but does NOT delete the media **blobs** in
storage — a direct `DELETE FROM storage.objects` is blocked by the `storage.protect_delete()`
trigger and would roll the whole transaction back. Handle media in step 3.5.

### 3.5. Purge media blobs (only if the dry run showed `photos` > 0)
Skip entirely when every purged family had `photos: 0` (the common case for throwaway test
families) — orphaned blobs under a deleted `family_id` are harmless, just wasted storage.

When there IS media, delete it out-of-band via the **Storage API** (not SQL). List the object
names first (read-only, allowed):
```sql
SELECT name FROM storage.objects
WHERE bucket_id = 'family-media'
  AND split_part(name, '/', 1) IN ( <purged family_ids> );
```
Then delete each object through the Storage REST API with the service-role key:
```
curl -X DELETE "$SUPABASE_URL/storage/v1/object/family-media/<name>" \
  -H "Authorization: Bearer $SERVICE_ROLE_KEY"
```
(or remove the whole `{family_id}/` prefix from the bucket in the Supabase Dashboard → Storage).
If you can't reach the Storage API in this context, say so and leave the blobs orphaned — note it
in the report so the user can clean up later.

### 4. Report + client reset
State what was deleted. Then give the on-device step, because the PWA caches state locally:
- **hard:** Settings → **Sign out** (or clear site data), then sign in again → full first-run.
- **soft:** just **reload** the app. It re-runs `my_families()`, gets an empty list,
  `fhWarmAbandon()` clears the `fh-fam`/`fh-snap`/`fh-onboarded` caches, and lands on the
  create/join onboarding. To also replay the welcome/auth screens, sign out first.

## Why it's safe (don't remove these guards)

- **Solo-ownership scoping:** purges only families where `owner_id` = the target and no other
  real `user_id` is a member. Throwaway onboarding families always qualify; real shared families
  never do.
- **Abort guard:** if the account is a member of any family outside that purge set, the transaction
  raises and rolls back — live family data is never touched.
- **Leaf-first delete order** in `reset.sql` respects the RESTRICT/NO-ACTION foreign keys
  (`transaction_photos → transactions → categories`, `event_fundings → events/saving_goals`,
  `savings_entries → members`, etc.). Do not reorder without re-checking the FK graph.
- **No direct storage-table writes:** `reset.sql` never touches `storage.objects` — that is
  blocked by the `storage.protect_delete()` trigger and would roll the transaction back. Media
  blobs are purged out-of-band (step 3.5), so a family with photos still resets cleanly.
- Leaves **no schema footprint** — no persistent function, just DELETEs in a transaction.

## Notes
- The email→account map is `auth.users.email`; the app maps user→family via
  `profiles.family_id` (see `auth_family_id()`), and onboarding gates on `my_families()`
  (`src/js-data/10-client-auth.js`).
- If you add a new family-scoped table in a future migration, add its `DELETE` to `reset.sql`
  in the correct leaf-first position.
