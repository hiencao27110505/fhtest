# Transaction time-of-day

An optional per-transaction **time**, on both ledgers, added to the existing day.

## Model (integrity-first)

- The **day** lives in `txn_date` (plaintext, indexable) — unchanged.
- The **time** is a **local wall-clock `"HH:MM"` string**, stored separately:
  - Personal (E2EE): `personal_transactions.occurred_time_enc` — encrypted under the
    personal key, read only on-device (migration `0095`).
  - Family: `transactions.occurred_time` + `occurred_time_enc` via the `fhField`/
    `fhRead` pattern — plaintext for off/dual, ciphertext for enc (migration `0096`).
- **Precision is honest.** `null` = only the day is known → the UI renders date-only
  and **never fabricates a clock time**. No backfill from `created_at` (that would
  invent spend-times out of logging-times).
- No UTC instant is stored, so the `toISOString()` midnight-shift trap does not apply.

## Flows covered (all synced)

- **Manual capture** — per row. A same-day row defaults to now; a back-dated row
  defaults to empty; once the user edits it, it's never auto-overridden. Each bulk
  row carries its own time.
- **Import — mailbox-read + forwarded email** — `email_transactions.occurred_at` is a
  `timestamptz` (the bank's real moment). Promote derives VN-local `HH:MM` from it
  (`fhStagedRowTime`) and passes it through the personal/family writes. A date-only
  source (UTC midnight, e.g. a CSV *file*) stays day-only.
- **Personal↔family mirror** — a family expense mirrored into the personal ledger
  carries its time across (read the family time, re-encrypt under the personal key),
  so both tabs agree.

## Storage-format decision (READ BEFORE MULTI-REGION)

We store a **bare local `HH:MM`** on the deliberate assumption that the userbase is
**single-timezone (VN, `Asia/Ho_Chi_Minh`, fixed `+07:00`, no DST)**. The zone is
implicit.

This is a **two-way door**: it is reversible with **zero data loss**, because
`txn_date` + `HH:MM` + VN's constant offset (no DST → no ambiguity) fully determine
the instant. Upgrading is a client-side payload change (the column is an opaque
`text` field — no `ALTER TABLE`) plus an on-device re-encode sweep for the encrypted
values.

The best-practice-at-scale format is an **offset-bearing ISO-8601 instant** (e.g.
`2026-08-27T14:32:00+07:00`), which is simultaneously the absolute instant and the
local wall clock — orderable across zones and travel-stable.

### ⚠️ TRIPWIRE

**Upgrade `occurred_time` from bare `HH:MM` to offset-bearing ISO BEFORE:**
- onboarding the first user outside `+07:00`, **or**
- ingesting any email/transaction from a non-`+07:00` source.

Crossing that line while still on bare-local silently mislabels those rows under VN's
implicit offset, and *that* data is not recoverable. Before the line, upgrading loses
nothing. The line is visible and controllable — do not let bare-local outlive
single-region.
