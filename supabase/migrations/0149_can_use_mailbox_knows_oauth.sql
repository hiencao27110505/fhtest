-- 0149_can_use_mailbox_knows_oauth.sql
--
-- The mailbox gate learns about OAuth direct read. Applied 2026-09-22.
--
-- can_use_mailbox() has checked two things since 0067: the beta allowlist, and a
-- forwarding connection (mailbox_connections, joined through members). It was
-- written before direct read existed, so it never learned about mailbox_grants.
-- A person who connects their Gmail the modern way and is not on the allowlist
-- therefore fails a gate named for a feature they are actively using.
--
-- Found by way of statement capture: merchant-concepts (the only surface that
-- classifies merchants from the DEVICE) is gated on this function, so those
-- people's statement rows were never categorised and landed in the catch-all.
-- Email rows were unaffected: the worker classifies them server-side as
-- service_role. Measured: 4 of the 7 OAuth-connected accounts failed the gate,
-- and classify_merchant_batch had not been called once in 12 hours.
--
-- Widens access only to people who already hold a mailbox grant, which is the
-- same trust level the gate intends.
begin;

create or replace function public.can_use_mailbox()
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select exists (select 1 from mailbox_beta_access where user_id = auth.uid())
      or exists (select 1 from mailbox_grants where user_id = auth.uid())
      or exists (select 1
                   from mailbox_connections mc
                   join members m on m.id = mc.member_id
                  where m.user_id = auth.uid());
$function$;

commit;
