# Release Notes

A running, human-readable log of what shipped and why. Product- and
developer-facing. Newest first.

Two neighbours this is deliberately distinct from:

- [`../CHANGELOG.md`](../CHANGELOG.md) — the historical developer changelog, a
  one-time full-history backfill grouped by era (through 2026-08-07). This file
  picks up the running log from there.
- [`../src/js-ui/90-release-notes.js`](../src/js-ui/90-release-notes.js) — the
  in-app "What's New" panel, curated and family-facing. Only user-visible changes
  appear there; internal plumbing (like the entry below) never does.

---

## 2026-08-29 · Ledger provenance: imported rows carry a `source` · v434

**Problem.** Once an imported transaction was approved it became byte-identical to
a hand-typed one, and the staged row that linked them is deleted on promote. So
there was no way to reset precisely (a reset had to delete *all* of a user's private
personal rows, not just the imports) or to measure how much of the ledger is
captured automatically versus typed by hand.

**Shipped.** A nullable `source` column on `transactions`, `personal_transactions`
and `personal_incomes` (migration `0100`), stamped at promote time from the staged
row's transport:

| `source` | meaning |
|---|---|
| `direct-email` | imported via direct mailbox read |
| `forwarding-email` | imported via the forwarding pipeline |
| `csv-import` | imported from a CSV / XLSX file |
| `NULL` | hand-entered |

The transport is read from the staged row's sealed `raw_extracted._transport`: the
direct-read worker stamps `oauth_direct`; the forwarding pipeline's absence of it
reads as forwarding. Provenance is plaintext (never money), so the E2EE guard is
unaffected.

**Why it matters.** Resets become exact (`delete … where source='direct-email'`
instead of "all private personal rows"), and the automation-rate metric
(`% of the ledger captured automatically`) is now queryable.

**Not yet.** Write-only. `source` is not returned by the hydrate or shown in the UI,
so there is no "from email" tag on rows yet. A small follow-up when wanted.
