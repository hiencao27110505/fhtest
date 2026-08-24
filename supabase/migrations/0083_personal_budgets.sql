-- 0083 — personal monthly budget (Model Y). Owner-scoped, ciphertext-only.
-- Feeds the personal daily guide (budget pace) + the "chi theo danh mục" header.
create table if not exists public.personal_budgets (
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  month         date not null,                 -- 'YYYY-MM-01'
  total_enc     text not null,                 -- encrypted with the user's personal key
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  primary key (owner_user_id, month)
);
alter table public.personal_budgets enable row level security;
drop policy if exists pbud_all on public.personal_budgets;
create policy pbud_all on public.personal_budgets
  for all to authenticated
  using (owner_user_id = (select auth.uid()))
  with check (owner_user_id = (select auth.uid()));
