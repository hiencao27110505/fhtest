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
  inbox address. The tag survives only in `X-Forwarded-To`, which Gmail *search*
  cannot query. So no delivery-address search can find forwarded mail — the
  `txn/inbox` label is the only narrow signal available, and the Gmail filter
  that applies it is load-bearing, not a workaround.
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
  it from any `is:unread` search forever. Use labels.
- **The confirmation email is addressed directly to the alias**, so `To:` works
  there — which masks the fact that `To:` is wrong for forwarded mail.

### Deploy

The script is pasted into the Apps Script editor by hand. Two consequences:

- **`PIPELINE_VERSION` is logged on every run.** Bump it whenever you change the
  file. Without it, "is my paste live" can only be inferred from error wording —
  which was wrong twice in one day, because a stale Script Properties cache made
  new code produce old output.
- **Caches in Script Properties outlive code changes.** Version the cache key
  (`ALIAS_QUERY_CACHE_V2`) or a fix will appear not to have been applied.
- Wiring `clasp` would remove this whole class of problem. Not done yet.
