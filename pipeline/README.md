# Bank-email ingestion pipeline

Reads forwarded bank/provider transaction emails and writes pending rows to
`email_transactions` (staging — never the real ledger). Promotion into
`transactions` is a human review step (approve + categorize), not built yet.

**This folder is the source of truth for the pipeline code.** The deployed copy
runs as a Google Apps Script bound to the shared inbox (`gichisreading@gmail.com`),
currently deployed by pasting `bank-email-pipeline.gs` into the Apps Script
editor whole-file. TODO: wire [clasp](https://github.com/google/clasp)
(`npm i -g @google/clasp`, `clasp login`, `clasp push`) so deploys come from
this folder instead of the clipboard.

## How it works

```
Gmail filter labels bank email txn/inbox
  → Apps Script trigger (processEmails, every 1 min)
      → fingerprint lookup (sender + normalized subject template)
          known non-transactional        → skip
          stored extraction template     → parse 100% locally, zero LLM
          unknown / template mismatch    → mask → Gemini classify+extract → unmask
                                            → derive + store template for next time
      → cross-source dedup check → resolve member via +tag
      → insert pending row into email_transactions → relabel txn/processed
```

Privacy invariants (unconditional — encryption is default-on product-wide):
- **Masking**: no real amounts/names/accounts/refs/emails ever reach the LLM;
  it extracts against shape-preserving fakes, real values are swapped back
  locally (`maskForSharing`/`unmaskExtraction`).
- **Templates**: repeat senders are parsed entirely locally
  (`deriveExtractionTemplate`/`applyExtractionTemplate`) — no third party at
  all. Templates self-invalidate via `EXTRACTION_LOGIC_VERSION` when the
  prompt/logic improves.
- **Open**: `email_transactions` rows are still plaintext at rest — design
  question for the encryption owner in `AGENT_SYNC.md` (sealed-box writes,
  ships with the review UI).

## Files

| File | What |
|---|---|
| `bank-email-pipeline.gs` | The whole pipeline (Stage 0 fetch, Stage 1 mask+extract+templates, Stage 2 write). Deploy = paste into Apps Script (until clasp). |
| `extraction.md` | LLM prompt + output schema, masking spec, template derivation notes, safety ceilings. |

Script Properties required: `GEMINI_API_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`.
Schema: migrations `0025`/`0027`/`0028` (live) + `0048` seed branch (pending merge).

Design history (decision log, connection-method comparison, cost analysis) lives
in Trang's working docs; current open questions live in `AGENT_SYNC.md`.

## Gmail's actual behaviour (learned the hard way, 2026-08-13)

Every one of these cost real debugging time because it was assumed rather than
checked. If you are touching the pipeline, read this before theorising.

- **`Delivered-To` does NOT carry the `+tag`.** Gmail rewrites it to the bare
  inbox address. On AUTO-forwarded mail the tag survives only in
  `X-Forwarded-To`, which Gmail *search* cannot query — so for that mail the
  `txn/inbox` label really is the only narrow signal, and the Gmail filter that
  applies it is load-bearing.
- **But `to:<alias>` DOES work — this file said otherwise until 2026-08-13.**
  `to:` is a different operator from `deliveredto:`: it reads the `To:` *header*,
  where the `+tag` survives intact. Measured on the live inbox:
  `to:gichisreading+<tag>` returned 4 threads out of 3,558 messages, all
  genuinely that alias's, zero false positives. The earlier blanket claim that
  "no delivery-address search can find forwarded mail" was wrong, and it cost us
  a silent ingestion hole (below).
- **AUTO-forward and HAND-forward need DIFFERENT search terms.** They are not
  variations of one thing:
  - *Auto-forward* — Gmail preserves the bank's original `From:` **and** the
    original `To:` (the person's own address). So the sender-based filter labels
    it, and `to:<alias>` can never match it.
  - *Hand-forward* — the person pressed Forward, so `From:` is **them**, `To:`
    **is** the alias, and the bank's address exists only as quoted body text.
    No sender-based filter can label it. Until `to:<alias>` was added to
    `buildInboxQuery()`, every hand-forwarded email was invisible to the pipeline
    forever — it just sat in the inbox unlabelled. That is how a real VCB test
    forward went missing on 2026-08-13.
- **A hand-forward cannot be sender-authenticated, and it looks like it can.**
  DKIM reports **pass** on one — legitimately, because the forwarder's own domain
  signed it and the sender genuinely is the forwarder. That pass authenticates
  the wrapper, not the bank; the bank's content is quoted text the forwarder
  could have typed. `checkSenderAuthenticity` now names this case
  (`forward_mode:'manual'`, `forwarder:'manual'`,
  `dkim_authenticates:'forwarder_not_bank'`) instead of reporting a bare missing
  header. It does **not** count as authenticated, so switching
  `SENDER_AUTH_ENFORCE=true` will block hand-forwards. That is a decision to make
  deliberately, not to discover in production.
- **`deliveredto:<bare inbox>` matches the entire mailbox** (measured: 500
  threads). Never search on it.
- **A forwarded message can carry SEVERAL aliases in one header** when it passed
  through more than one forwarding rule:
  `"gichisreading+trang@…, gichisreading+8xr4ed9vr8@…, gichisreading@…"`.
  Take all of them and try each; taking the first lets a retired alias shadow
  the live one.
- **DKIM reports `header.i=@domain` at least as often as `header.d=domain`.**
  Accepting only `header.d` makes every genuine message look misaligned.
- **The forwarding confirmation link cannot be clicked server-side.** Fetching it
  returns HTTP 200 with an interstitial that still expects a human
  ("Please confirm forwarding mail of…"). A 200 is not approval. `verified` is
  therefore set by a real forwarded message arriving, never by the fetch.
- **Read-state is not a record of work done.** A human opening a message removes
  it from any `is:unread` search forever. Use labels. (`confirmPendingForwarding`
  was still doing this on 2026-08-13 — three real confirmation emails sat
  unhandled in the shared inbox because someone had opened them. Now excluded by
  label, like everything else.)
- **The confirmation email is addressed directly to the alias**, so `To:` works
  there — which masks the fact that `To:` is wrong for forwarded mail.

## Review notifications

When a run stages rows, the member who owns them gets one push: *"Có giao dịch
mới cần bạn duyệt."* Tapping it opens the review queue.

Two things about it are deliberate and easy to undo by accident:

- **Only the owning member is told, never the family.** Staged rows are scoped to
  their own member (`0058`). The social kinds in `push-send` fan out to everyone
  *except* the actor; this one does the opposite, because the person who has to
  act is exactly the one that path excludes, and telling the family would leak
  the thing `0058` exists to keep private.
- **The payload is `{kind, member_id, count}` and nothing else.** No amount, no
  merchant, no bank name. Push transits a third party, and once sealing is on the
  robot could not read those values to send them anyway. The count is the only
  number allowed through; `push-send` composes the wording itself.

`notifyStagedReviews()` batches per run — five emails in one tick is one banner,
not five. A failed notification is logged and dropped: the row is already
written, and the queue is there whenever the app is next opened.

Guard: `node pipeline/review-notify.test.js` (18 assertions — batching, per-member
targeting, the payload shape, the service-role gate, and that no copy variant can
carry money).

### Deploying it — three parts, in any order

1. **Apps Script** — paste `bank-email-pipeline.gs` (`PIPELINE_VERSION` ≥
   `2026-08-14-c`). Each attempt logs `notify <member> xN -> HTTP <code>`, which
   is how you tell whether the function is live.
2. **Edge function** — `supabase functions deploy push-send`. It gains a
   service-role entrance; the existing user-JWT path is untouched. Needs Supabase
   access, so it is the one step the pipeline owner may not be able to do alone.
3. **Client** — the `txn_review` route in `src/js-data/55-push.js`, then a normal
   build + deploy. Without it a tapped notification opens the app but lands
   nowhere in particular.

**Known gap:** push is only ever offered at Settings → Notifications. A member who
connects a mailbox but never enables notifications gets nothing, silently, and
nothing in the mailbox onboarding tells them. The onboarding should nudge
`fhPushSheet()` once the alias is issued — not built.

### Deploy

The script is pasted into the Apps Script editor by hand. Two consequences:

- **`PIPELINE_VERSION` is logged on every run.** Bump it whenever you change the
  file. Without it, "is my paste live" can only be inferred from error wording —
  which was wrong twice in one day, because a stale Script Properties cache made
  new code produce old output.
- **Caches in Script Properties outlive code changes.** Version the cache key
  (`ALIAS_QUERY_CACHE_V2`) or a fix will appear not to have been applied.
- Wiring `clasp` would remove this whole class of problem. Not done yet.
