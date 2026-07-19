# FamilyHub — Supabase backend

Migration set for the `fhtest` project (ref `iizyukzfsbdkbrgfupwq`). Nothing here
has been applied yet — these files are for review.

## Files (apply in order)

| Order | File | What it does |
|---|---|---|
| 1 | `migrations/0001_schema.sql` | 13 tables, 7 enums, all constraints & indexes |
| 2 | `migrations/0002_views.sql` | 8 derived views (timezone-aware, `security_invoker`) |
| 3 | `migrations/0003_functions_triggers.sql` | `updated_at` bump, new-user profile, invite/join flow, category seeding |
| 4 | `migrations/0004_rls_storage.sql` | RLS on every table + private Storage bucket |

## Decisions baked in
- Multi-family, **Google SSO**, **invite-by-Gmail** join flow.
- **1 shared family, 2 accounts** to start; `vi` default categories.
- Family-base currency (**VND**/USD); money = `numeric(14,2)`.
- Aggregates (spent, saved, reserved, savings balance) are **views**, never stored.
- Time is **family-local** (`Asia/Ho_Chi_Minh`); realized/planned/achieved are derived
  from dates in the views, so they track real "now" (the prototype's frozen clock is gone).

## Onboarding & the 2 accounts
1. Enable **Auth → Providers → Google** in the dashboard (Client ID + Secret from Google Cloud). *Manual, one-time.*
2. Person A signs in with Google → `handle_new_user` creates their profile → they call
   `select create_family('The Reeds','VND','vi');` (owner member + "Chung"/Shared member + 6 categories seeded).
3. Person A calls `select invite_to_family('personB@gmail.com');`
4. Person B signs in with the invited Gmail → calls `select accept_invitation('<token>');` → attached to the family.

## Importing historical transactions
Because you import **line items** (not month totals), the `SUM`-over-transactions views
are correct for every past month — **no rollup/snapshot table needed**. Import rules:
- One row per historical expense into `transactions` with its real past `txn_date`
  and `status='realized'` (past dates are auto-classified realized by the views anyway).
- Each row needs a valid `category_id` + `member_id` **in this family**, `amount > 0`.
- Seed each historical month's `monthly_budgets` (+ `category_budgets`) if you want the
  budget lines / trend chart to show a cap for those months.
- Recommended path: a one-off `import_transactions(jsonb)` SECURITY DEFINER function or a
  staged CSV load — to be written once the column mapping from your source is confirmed.

## v2 backlog (deliberately deferred)
- `monthly_rollup` snapshot (only if aggregate-only history is ever imported).
- currency/language as ISO-4217 / BCP-47 text + lookup instead of enums.
- `families.currency` immutability trigger; VND fractional-amount CHECK.
- Recurring **auto-save** config + manual/auto funding-type discriminator.
- Roles/permissions beyond owner (funding eligibility is derivable today).

## Open flag
- `members.color` is **kept** (you said both "don't need" and "can keep") — drop trivially
  if unwanted.
