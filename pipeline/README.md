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
