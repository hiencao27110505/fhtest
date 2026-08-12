-- ============================================================================
-- DEV ONLY — hand-wire one mailbox_connections row, and adopt already-staged rows
--
-- NOT a migration. Do not add this to supabase/migrations/. It writes one
-- person's data, so it is a one-off you run by hand in the SQL editor.
--
-- WHY THIS EXISTS
-- The review UI cannot show anything until email_transactions rows carry a
-- member_id, and nothing writes mailbox_connections yet (the alias-issuing
-- onboarding is designed but unbuilt). So today every staged row is unrouted
-- and therefore visible to nobody — 0058 deliberately hides them, because a row
-- with no member_id has no family linkage at all.
--
-- This links YOUR alias to YOUR member row, and adopts the rows already staged
-- before the link existed, so the review UI can be built and tested against
-- real extracted data instead of fixtures.
--
-- Run the steps IN ORDER and read the output of each before running the next.
-- ============================================================================


-- ── STEP 1 — find your member row. Note the id; you need it below. ──────────
-- Uses your app login (the Google account you sign into FamilyHub with).
select m.id            as member_id,
       m.name,
       m.family_id,
       f.name          as family_name
from members m
join families f on f.id = m.family_id
join profiles p on p.id = m.user_id
where p.id = (select id from profiles where id = m.user_id)
  and m.user_id is not null
order by m.created_at
limit 20;


-- ── STEP 2 — see what is actually staged, and which alias the mail arrived on ─
-- raw_extracted->>'_sender_auth' shows what the (advisory) sender checks made of
-- each row. member_id will be null on everything staged so far.
select id,
       source_provider,
       occurred_at,
       amount,
       currency,
       counterparty,
       raw_extracted->>'memo'         as memo,
       member_id,
       review_status,
       created_at
from email_transactions
order by created_at desc
limit 50;


-- ── STEP 3 — create the link. ───────────────────────────────────────────────
-- forwarding_alias must be the +tag EXACTLY as it appears in the To: header of
-- the forwarded mail — that is what extractPlusTag() matches on. If your filter
-- forwards to gichisreading+trang@gmail.com, the alias here is 'trang'.
--   • personal_email is the Gmail account that does the forwarding. The sender
--     checks compare it against X-Forwarded-For, so a typo here makes every
--     future row fail that check (advisory today, blocking once
--     SENDER_AUTH_ENFORCE=true).
--   • verified=true because you set the forward up by hand; the real onboarding
--     flow sets this after the auto-confirm handshake.
--
-- REPLACE the two placeholders and your member id, then run.
insert into mailbox_connections (member_id, forwarding_alias, personal_email, verified)
values (
  'PASTE_MEMBER_ID_FROM_STEP_1'::uuid,
  'PASTE_THE_PLUS_TAG',              -- e.g. 'trang'  (NOT the full address)
  'PASTE_YOUR_FORWARDING_GMAIL',     -- e.g. 'trang.nguyen.wh@gmail.com'
  true
)
on conflict (forwarding_alias) do update
  set member_id      = excluded.member_id,
      personal_email = excluded.personal_email,
      verified       = excluded.verified
returning *;


-- ── STEP 4 — adopt the rows that were staged before the link existed. ───────
-- These were written when routing could not resolve anyone, so they are stranded:
-- invisible under 0058 and never re-processed (their Gmail threads are already
-- labelled txn/processed, so the pipeline will not revisit them).
--
-- Only safe because you are the sole user right now — with several people
-- forwarding, "null member_id" would be ambiguous and this blanket claim would
-- assign someone else's transactions to you. Check STEP 2's output first and be
-- certain every listed row is yours.
update email_transactions
   set member_id = 'PASTE_MEMBER_ID_FROM_STEP_1'::uuid
 where member_id is null
returning id, source_provider, occurred_at, amount, counterparty;


-- ── STEP 5 — verify the review UI will actually see them. ───────────────────
-- Counts what 0058 exposes to your login. If this returns 0 after STEP 4, the
-- member_id you pasted is not the member row tied to your auth user.
select count(*) as rows_visible_to_me
from email_transactions
where member_id in (select id from members where user_id = auth.uid())
  and review_status = 'pending';


-- ============================================================================
-- AFTER THIS
-- New mail routes on its own: the pipeline reads the +tag, finds this row, and
-- stamps member_id at ingestion. The routing gate (ROUTING_GRACE_DAYS) means
-- anything that arrives with an unrecognised tag waits in txn/inbox rather than
-- staging unrouted — so if a new alias appears later, add its row here and the
-- held mail flows through on the next run with nothing lost.
-- ============================================================================
