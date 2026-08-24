# Encryption (E2EE)

## Problem & Why

FamilyHub stores money amounts, notes, goal names, category/member names, memory captions, and photos in Supabase Postgres + Storage — infrastructure we operate. The product promise for a family that opts in is that the operator (us, or anyone who compromises the database/storage/API) cannot read the plaintext of that data. That has to be a mathematical property, not an access-control policy, because access control is exactly what an operator-level compromise defeats.

The mechanism is client-side encryption with a key the server never holds and cannot derive: every protected field is AES-256-GCM-encrypted in the browser under a per-family data-encryption key (DEK), and the DEK itself is wrapped under a key derived from a secret that never leaves the device. The server persists ciphertext, a wrapped DEK, and public KDF parameters — nothing from which the DEK is recoverable.

Two generations of "what unwraps the DEK" exist side by side:
- **Card-born families** (created on the current build) derive the wrap key from a 128-bit Key Card — see `ENCRYPTION-RELEASE-NOTE.md` for the full cryptographic argument, and `docs/features/key-card-auth.md` for the card mechanics (generation, encoding, migration from passcode). That note is explicitly scoped to card-born families only.
- **Pre-existing passcode families** derive the same wrap key from a 6-digit passcode. They reach full encryption through a separate, in-app **off → dual → enc** migration lifecycle, documented only in code comments today. This doc narrates that lifecycle (see below) since no other doc covers it.

Both generations converge on the same DEK/AES-GCM machinery — the only thing that differs is what unwraps K_wrap. `enc_state` (`off`/`dual`/`enc`) tracks the *data* migration; it is orthogonal to *which* wrap kind (`passcode` vs `card` in `family_key_wraps`) a device uses to unlock.

## Architecture & How It Works

### Key hierarchy and primitives

`src/js-data/15-crypto.js` is the crypto core, all running through WebCrypto (`crypto.subtle`):

```
passcode (6-digit) or Key Card (128-bit)
   │  PBKDF2-SHA256(salt, iters)  →  256-bit master
   ▼
 HKDF-SHA256 (info-separated)
   ├─ "fh-auth-v1" → K_auth  (passcode families only: bcrypt-hashed server-side, proves door knowledge)
   └─ "fh-wrap-v1" → K_wrap  (AES-256-GCM key, device-only, never transmitted)
                    │
        K_wrap unwraps ▼
   DEK (256-bit CSPRNG, generated on-device at family creation)
                    │
     AES-256-GCM(DEK) ▼
   every encrypted field + photo bytes
```

- `FHCrypto.deriveKeys(passcode, saltHex, iters, version)` (`src/js-data/15-crypto.js:49-61`) — PBKDF2 then HKDF-splits into `kAuthHex` and `kWrap`. Iteration count is caller-supplied: `FH_KDF_ITERS = 310000` for passcode families, `FH_KDF_ITERS_CARD = 600000` for card families (`src/js-data/15-crypto.js:14-15`).
- `FHCrypto.wrapDek` / `unwrapDek` (`src/js-data/15-crypto.js:66-75`) — AES-256-GCM wrap/unwrap of the raw DEK under `K_wrap`; envelope is `base64(iv‖ct)`, 96-bit random IV.
- `FHCrypto.encVal` / `decVal` (`src/js-data/15-crypto.js:77-88`) — field-level encrypt/decrypt: UTF-8 string in, `base64(iv‖ct)` out, fresh 96-bit IV per call.
- `FHCrypto.encBytes` / `decBytes` (`src/js-data/15-crypto.js:92-101`) — binary twins of the above for photo blobs (raw `iv‖ct`, no double base64).
- The active family's DEK lives in module state (`_fhDek`, `src/js-data/15-crypto.js:158`) and is cached raw in IndexedDB (`fh-keys` store, `src/js-data/15-crypto.js:159-176`) so the passcode/card is entered once per device, not per session. `fhKeyDrop` (`src/js-data/15-crypto.js:193-198`) clears the session key, purges decrypted-photo object URLs, and drops the local card cache — used on logout/leave.

### Write/read shape per field: `fhField` / `fhRead`

`fhField(name, value)` (`src/js-data/15-crypto.js:228-240`) builds the write payload for one logical field, driven by the family's `enc_state`:
- `off` → `{ name: value }` (today's plaintext behavior)
- `dual` → `{ name: value, name_enc: ciphertext }` (both, for the verification window)
- `enc` → `{ name: null, name_enc: ciphertext }` (ciphertext only; throws if the key isn't loaded — writing plaintext here would break the guarantee)

`fhRead(row, name)` (`src/js-data/15-crypto.js:247-261`) is the inverse resolver: in `enc` state it prefers ciphertext (plaintext may already be scrubbed); in `dual` it prefers plaintext but also decrypts the ciphertext and logs loudly (`console.error('FH DUAL MISMATCH', ...)`) on any mismatch — this cross-check is the entire point of the dual window. Bank-import/legacy rows that never got ciphertext keep reading as plaintext in every state.

Every write callsite in `src/js-data/` builds its row via `fhField()`; every read path resolves values via `fhRead()`. This is how the app stays state-machine-agnostic at the call site — callers don't branch on `enc_state` themselves.

### The off → dual → enc lifecycle (`src/js-data/66-enc-ui.js`)

This is the migration path for **pre-existing passcode families with real transaction history** — the thing `ENCRYPTION-RELEASE-NOTE.md` explicitly excludes ("legacy passcode families... deliberately out of scope"). It exists because a family with months of plaintext data can't jump straight to ciphertext-only the way a brand-new family can (`0032_default_enc_new_families.sql` lets *new, empty* families set `enc_state='enc'` directly at passcode-set time — see `set_family_passcode`'s `p_enc_state` guard at `supabase/migrations/0032_default_enc_new_families.sql:52-55`).

The lifecycle, staged and reversible until the very last step (`src/js-data/66-enc-ui.js:1-9`):

```
off → [download plaintext .xlsx backup] → [encrypt alongside originals, verify-before-upload] → dual
dual → run indefinitely (every read self-checks ct==pt, loudly on mismatch)
dual → scrub (owner, arm-then-confirm — THE one destructive step) → enc
```

1. **`fhEncEnable(btn, opts)`** (`src/js-data/66-enc-ui.js:280-329`) — the `off → dual` transition:
   - Flips `enc_state` to `'dual'` via the `set_family_enc_state` RPC *first* (`:288`). From that moment the database itself rejects plaintext-only money writes (see enforcement triggers below), so no new uncovered row can appear while the backlog is being covered.
   - Downloads a plaintext `.xlsx` safety-net copy (`_fhExportPlain()`, unless `opts.resume`) — see export section below.
   - Iterates `_ENC_TABLES` (the full coverage list, below), encrypting every field that has plaintext but no ciphertext yet, verifying each value round-trips (`FHCrypto.decVal` immediately after `encVal`) before writing `field_enc`. A verify failure aborts with a count of mismatches (`:319`) rather than silently writing bad ciphertext.
   - `opts.resume: true` re-runs the same coverage loop without re-downloading the export — this is the auto-resume path for an enable that got interrupted (app closed mid-loop). It's triggered automatically from the encryption sheet whenever `dual` state is showing and an uncovered-row count is nonzero (`:87-91`).

2. **`fhEncVerifyAll(btn)`** (`src/js-data/66-enc-ui.js:335-364`) — one-tap proof step available only in `dual`: decrypts every ciphertext in the family and compares it against the plaintext still sitting beside it, reporting `ok`/`bad` counts. This is the ground-truth check the owner runs before committing to the irreversible scrub.

3. **`fhEncScrub(btn)`** (`src/js-data/66-enc-ui.js:367-396`) — the `dual → enc` transition, the one destructive step. UI requires arm-then-confirm (tap once to arm, tap again within 4s to execute, `:368-375`). Calls the `scrub_plaintext_amounts` RPC, which nulls plaintext columns for every row that has ciphertext (server re-verifies owner + `dual` state, and — since `0033`/`0038` — refuses if any row is still uncovered, surfacing `uncovered_rows:<n>` back to the client, which responds by auto-resuming `fhEncEnable(null, {resume:true})`, `:380-390`).

4. **`fhEncDisable(btn)`** (`src/js-data/66-enc-ui.js:470-493`) — `dual → off` only, the abort path. Because plaintext never left the server during `dual`, nothing is "restored"; the server just wipes the trial's ciphertext columns (`0035_enc_permanent.sql:39-50`, extended in `0038_e2ee_text_fields.sql:181-195`) and the family is back exactly where it started. This is the *only* reverse transition that exists — once a family reaches `enc`, `set_family_enc_state` unconditionally raises `enc_permanent` (`0035_enc_permanent.sql:34`); there is no decrypt-back path in the current schema (an earlier `enc → dual` decrypt-back existed in `0030`/`0033` and was deliberately removed in `0035`).

### Coverage list — `_ENC_TABLES`

`src/js-data/66-enc-ui.js:14-28` defines every table/field pair the money-and-text lifecycle covers:

| Table | Numeric fields | String fields |
|---|---|---|
| `transactions` | `amount` | `note` |
| `incomes` | `amount` | `note` |
| `savings_entries` | `amount` | `note` |
| `event_fundings` | `amount` | — |
| `category_budgets` | `amount` | — |
| `monthly_budgets` | `budget_total` | — |
| `events` | `target_amount` | `name` |
| `saving_goals` | `target_amount` | `name`, `note` |
| `categories` | — | `name` |
| `members` | — | `name` |
| `event_memories` | — | `caption` |

The last three (`categories`, `members`, `event_memories`) were added in `0038_e2ee_text_fields.sql` — user-typed text joining the same `fhField`/`fhRead` machinery as the original money fields from `0030`. `_fhUncoveredCount()` (`src/js-data/66-enc-ui.js:259-272`) walks this same list to compute the backlog that drives auto-resume; `monthly_budgets.budget_total` treats `0` as "empty" (it's the NOT-NULL scrub placeholder, not a real value) both here and server-side.

### Coverage sweep for committed (`enc`) families — `fhEncCoverSweep`

`src/js-data/66-enc-ui.js:398-463`. This is a *second*, independent mechanism from the dual-window enable job above, needed because plaintext can still land in a committed `enc` family through paths the client-side enable job never touches:
- **Enc-from-birth families** (`0032`): server-side seeding (`create_family`, `redeem_invite`) inserts plaintext `categories.name` / `members.name` rows directly — there was never a `dual` window to cover them.
- **A family that just finished the scrub** still has its entire photo history sitting as plaintext bucket objects — photos aren't part of the money/text scrub at all.

The sweep is silent, idempotent, and resumable, and runs from three places: opening the encryption sheet while `enc` (`:116`), right after an unlock, and once per session after hydrate. It does two things:
1. **Text** (`_TXT_COVER`: `categories.name`, `members.name`, `event_memories.caption`, `:410-414`) — for any row with plaintext and no ciphertext, encrypt and write `field_enc`; if the row is already `enc`-committed, additionally null the plaintext in the same update (`:427-434`).
2. **Photos** (`:436-457`) — for `transaction_photos` and `event_memories` rows whose `photo_url` is still a plaintext bucket path (not `http...`, not `.enc`): fetch the plaintext bytes, `fhEncBytes()` them, upload to `<path>.enc`, repoint the row at the new path, then delete the old plaintext object — **in that order**, so an interruption mid-photo never loses data (the row only stops pointing at the plaintext object after the encrypted one is confirmed uploaded and the row updated).

### Server-side enforcement (the invariant is a DB property, not a client promise)

Client-side gating (`fhField` refusing to write plaintext in `enc`) only binds an up-to-date app. Stale clients bypass it by definition, so triggers enforce the same rule in Postgres:

- **`0033_enc_enforcement.sql`** — `_fh_enc_guard()` trigger on `transactions`, `incomes`, `savings_entries`, `event_fundings`, `category_budgets`, `monthly_budgets`, `events`, `saving_goals` (`:103-112`). Per protected column pair, `_fh_enc_pair()` (`:32-54`) rejects: plaintext written without ciphertext in `dual`/`enc` (except the explicit un-encrypt shape used by the `dual→off` abort); a plaintext value changed while ciphertext is untouched in `dual` (stale-pair guard); any plaintext at all in `enc`. This is also what makes `scrub_plaintext_amounts()` safe to assume "no uncovered row can be created after `dual` begins" (`0033_enc_enforcement.sql:114-139`).
- **`0038_e2ee_text_fields.sql`** — a *different*, looser trigger shape (`_fh_enc_txt_guard`, `:44-72`) for `categories`, `members`, `event_memories`, because unlike money tables these have legitimate server-side plaintext INSERTs (family seeding, invite redemption) that must keep working. It's a one-way valve: INSERTs always pass; UPDATEs may not *change* a plaintext value without attaching fresh ciphertext, and in `enc` a changed value may never rematerialize as plaintext. This is exactly the gap `fhEncCoverSweep` exists to retire.
- **`0039_photo_enc_enforcement.sql`** — `_fh_photo_enc_guard()` on `transaction_photos`, `event_memories`: once `enc_state='enc'`, `photo_url` must be `NULL`, an absolute `http(s)` URL, or a `%.enc` bucket path — never a plaintext bucket object. Exempt in `dual` on purpose (photos are covered by the sweep only after commit).

### Photo decryption on render (`src/js-data/57-photo-enc.js`)

Encrypted photo bytes live in the public Storage bucket as AES-GCM ciphertext under `<path>.enc`; the data model still carries the same stable public URL everywhere (snapshots, `pathByUrl`, delete paths) — this module is the only layer that turns those URLs into pixels, so every existing render site gets encrypted photos for free without modification.

Mechanism: a `MutationObserver` (`:79-87`) watches the whole document body for added nodes and `src`-attribute changes. Any `<img src>` or inline `background-image` containing `.enc` gets intercepted:
- `_phSwapImg` / `_phSwapBg` (`:50-69`) set a 1x1 transparent GIF placeholder immediately (no broken-image flash) and kick off `_phResolve(url)`.
- `_phResolve` (`:29-49`) is memoized in `_phCache` (a `Map`, LRU-capped at `_PH_MAX = 150` entries, `:15,22-28`): fetch the ciphertext (served through the service worker's media cache like any other photo), `fhDecBytes()` it with the session DEK, wrap the plaintext in a `Blob`, and hand back an `URL.createObjectURL(...)` object URL.
- If the key isn't loaded (`fhKeyReady()` false), `_phResolve` returns `null` **without caching the miss** (`:31-32`), so the very next attempt after unlock retries instead of staying pinned to a blank image.
- Decrypted bytes exist only in memory — never written to Cache API, IndexedDB, or localStorage. Every object URL is revoked when the key is dropped (`fhKeyDrop` → `window.__fhPhotoCachePurge`, `:88-91`), and `window.__fhPhotoRefresh` (`:106-117`) re-resolves every `[data-fhenc]` element on screen when a device unlocks mid-session, since a locked-then-unlocked image otherwise stays blank until the app is reloaded.

### The `.xlsx` export-before-encrypting safety net

`_fhExportPlain()` (`src/js-data/66-enc-ui.js:199-248`) is called automatically inside `fhEncEnable()` (unless resuming) before any row is touched — a decrypted, human-readable snapshot of the family's money data downloads to the device *before* the app starts encrypting anything. It queries every `_ENC_TABLES`-adjacent table, resolves each value through `fhRead()` (so it works correctly regardless of current `enc_state`), and builds a real `.xlsx` via a from-scratch, dependency-free writer:
- `_zipStore()` (`:139-159`) builds an uncompressed (STORED) ZIP — local file headers, central directory, EOCD — by hand, in ~20 lines, rather than pulling in a zip library.
- `_sheetXml()` / `_fhXlsx()` (`:161-198`) emit minimal OOXML spreadsheet parts (`[Content_Types].xml`, `workbook.xml`, one `sheet<N>.xml` per tab) with real numeric cells (so Excel can sum them) and inline UTF-8 strings (Vietnamese diacritics safe).
- Three tabs are produced: Ledger (`Sổ ghi chép`), Goals (`Mục tiêu`), Budgets (`Ngân sách`) (`:238-242`).

This exists because the encryption lifecycle is a one-way ratchet past the scrub step — if something goes wrong (a bug, a lost card, a botched verify), the family still has an offline, human-readable copy of their data made *before* any encryption began. The UI entry point for re-downloading this on demand (`fhEncExport`) is currently hidden by product decision (`:119-123`) but the code path is fully wired — the automatic safety download inside `fhEncEnable` still runs every time.

## Current State

**Shipped and live:**
- Full key hierarchy (PBKDF2 → HKDF → K_wrap → DEK → AES-256-GCM) for both passcode-derived and Key Card-derived families.
- `off → dual → enc` migration lifecycle for pre-existing passcode families, with client-side verify, server-side enforcement triggers, auto-resume for interrupted enables, and a terminal (non-reversible) `enc` state.
- Enc-from-birth path for brand-new families (`0032`).
- Full `_ENC_TABLES` coverage (money + user-typed text) plus the separate photo-byte encryption path.
- Coverage sweep (`fhEncCoverSweep`) retiring legacy plaintext text and re-encrypting plaintext photos in committed families.
- `.xlsx` export-before-encrypting safety net, wired but with its manual re-download entry point currently hidden.
- Decrypt-on-render for photos via `MutationObserver`, with in-memory-only plaintext and key-drop cache purge.
- Card-based auth as an additive, coexisting wrap kind (`family_key_wraps`, `0042`+) with a gated passcode-retirement step (`0047`) — full mechanics in `docs/features/key-card-auth.md`.

**Proposed hardening, not shipped:** `encryption-mechanics-granular.drawio.xml` and `bank-email-sealedbox-flow.drawio.xml` (repo root) design an AAD-binding + X25519 sealed-box pass: binding each ciphertext to `(family_id, row)` as AES-GCM associated data, and a sealed-box scheme (ephemeral X25519 + ECDH + AEAD) so the bank-email pipeline can encrypt *to* a family's public key without ever holding the DEK. **Zero implementation exists** — confirmed by grepping `src/` and `supabase/migrations/` for `AAD`/`sealed`, both return no hits. This diagram is the designed answer to the honest limitation `ENCRYPTION-RELEASE-NOTE.md` names in its own "Non-goals and honest caveats" section: *"AES-GCM here authenticates each value but is used without associated data (AAD) binding a ciphertext to its row id and column... a malicious operator could relocate or replay a validly-encrypted ciphertext into another field... Binding per-cell AAD is the natural hardening and is not yet done."* Treat both `.drawio.xml` files as design intent only when reading this codebase — nothing in `src/js-data/15-crypto.js` or any migration passes or checks AAD today, and no sealed-box code exists anywhere in the client.

Who encrypts pipeline-ingested `email_transactions` rows — given the pipeline writer can never hold the family DEK — was **answered by sealed staging** (`0065` + `0068`): the pipeline seals to the family's `staging_pub` and can never read the row back. See `docs/features/bank-email-pipeline.md`.

## Related

- `../ARCHITECTURE.md` — cross-cutting patterns this doc doesn't re-explain: the hydrate/write-through model (`get_family_snapshot` shipping `_enc` columns, `enc` block, `key_unlocked_at`) and the build system.
- `docs/features/key-card-auth.md` — Key Card generation/encoding, the passcode→card migration (Phases C/D), and the auth-layer wrap mechanics referenced but not detailed here.
- `docs/features/bank-email-pipeline.md` — how server-ingested `email_transactions` rows get encrypted without the pipeline ever holding the DEK. The sealed-box design above is the shipped answer, not a proposal.
- `docs/features/csv-import.md` — the other server/bulk-write path into money tables; subject to the same `0033` enforcement triggers as any other writer.
- `ENCRYPTION-RELEASE-NOTE.md` (repo root) — the precise cryptographic claim and threat model for card-born families, including the full "Non-goals and honest caveats" section this doc's Current State section cites.
- `encryption-mechanics-granular.drawio.xml`, `bank-email-sealedbox-flow.drawio.xml` (repo root) — the unshipped AAD/sealed-box hardening design.
