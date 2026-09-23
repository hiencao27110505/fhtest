-- 0150 ▸ account identity: the provider half becomes a machine KEY
-- (docs/specs/account-identity-spec.md, P5).
--
-- `provider` was prose — whatever the mail, the model or a statement printed —
-- and prose variance is why one wallet showed up as three cards. The identity
-- of an instrument is (provider, tail); this makes the provider half a key
-- from taxonomy/providers.json. `provider` stays as the display label and
-- stops being identity.
--
-- Additive only. The column is nullable on purpose: prose the registry has
-- never seen keeps provider_key NULL and matches by folded label exactly as
-- before, so an unknown provider is not worse off than today. The backfill of
-- existing rows runs out-of-band through the registry resolver (the resolver
-- is generated JavaScript shared by device and worker; SQL cannot host it and
-- a second implementation here would be the drift this spec exists to end).
--
-- The prose unique index (personal_accounts_uniq) is left standing: it guards
-- raw double-inserts, while identity matching happens in
-- fhPersonalAccountEnsure — the only account creator — which now compares
-- provider_key first.

alter table public.personal_accounts
  add column if not exists provider_key text;

comment on column public.personal_accounts.provider_key is
  'Registry key from taxonomy/providers.json (account-identity-spec P5). Identity half of (provider, tail); NULL = prose unknown to the registry, matched by folded label. `provider` is display-only.';
