-- FamilyHub — 0021: a funding can point at a goal OR an occasion
--
-- Stage 2 of the goal/occasion split. A pure saving goal (no occasion, e.g. an
-- emergency fund) needs its own funding rows, which therefore have no event_id.
-- Make event_id nullable and require a funding to reference at least one of the
-- two. Additive/relaxing: every existing row has an event_id, so the new CHECK
-- passes and nothing changes for the running app.
alter table public.event_fundings alter column event_id drop not null;

alter table public.event_fundings drop constraint if exists event_fundings_target_check;
alter table public.event_fundings add  constraint event_fundings_target_check
  check (event_id is not null or goal_id is not null);
