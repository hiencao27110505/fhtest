-- 0124_account_uniq_scope.sql
-- The 0105 dedup index (owner, kind, provider, tail) exists to stop capture
-- from materializing the same instrument twice — its two keys are provider
-- and tail. A NAME-IDENTITY account (an investment position, a manual
-- "＋ Tài khoản khác" deposit) has neither, so under coalesce('') the index
-- collapsed ALL of them onto one slot: the second position — and the second
-- manual account — failed with a unique violation ("Có lỗi xảy ra, thử lại",
-- found 2026-09-06). Scope the index to rows that carry at least one real
-- routing key; name-identity accounts are as many as the person wants.
drop index if exists personal_accounts_uniq;
create unique index personal_accounts_uniq
  on public.personal_accounts (owner_user_id, kind, coalesce(provider,''), coalesce(tail,''))
  where archived_at is null and (provider is not null or tail is not null);
