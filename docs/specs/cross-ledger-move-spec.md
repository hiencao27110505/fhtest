# Cross-Ledger Move — send a logged transaction to the other book

A transaction logged into one ledger can be moved to the other after the fact:
a private expense published out to the family book ("this lunch was actually
ours"), or an authored family expense pulled back into the private book ("I
filed my own coffee in the wrong place"). The move carries everything the
destination can hold — amount, note, category, time, account tag, **and
photos** — which is why this epic also gives the personal ledger photo capture
parity with the family book.

> **Status, 2026-09-04.** Spec agreed after design interview (decision log
> §12); build is **big bang** — photo parity + both move directions in one
> release (M11). **BUILT same day:** migration **0114 applied live**
> (`personal_transaction_photos` + the `personal-media` bucket), app `v459` —
> personal photo capture/edit/render/delete/regen (`19-personal.js`,
> `55-expense-photos-writes.js`, `57-photo-enc.js`), the move engine + journal
> (`21-ledger-move.js`), edit-mode scope chips + `#sheet-move`
> (`50-sheets-expense-capture.js`, `59-ledger-move-ui.js`), mirror-row
> tap-through and account editing on private rows (`60-transactions.js`,
> `21-personal.js`).

> **How this relates to its siblings.** `personal-ledger-spec.md` §9 named
> "publishing a private row out to a family afterwards" as designed-but-unbuilt
> — this spec builds it, plus the reverse direction. The review screen's rule
> that a family-sealed row can never re-route to personal
> (`transaction-review-spec.md` §5) is **not** contradicted here: that rule
> protects *unseen* sealed data; a committed family row has already been seen
> by the household, so pulling it back is a ledger correction, not a privacy
> restoration — and the confirm copy says exactly that (edge rule 7).

---

# Part 1 — Behaviour

## 1. Summary

- **A move is a state transition, not a copy-paste.** The two ledgers are
  already joined by the mirror engine: an authored family expense has a
  read-only master copy in the author's personal book (`link_id` pairing).
  Moving personal→family *promotes the private row in place* into that master;
  moving family→personal *demotes the master back* into a private row and
  deletes the family copy. The personal book's totals never change in either
  direction — only the label ("riêng tư" ↔ the family name) and who else can
  see the money.
- **The affordance is the scope chip.** The 🏡/🔒 "Ghi vào đâu?" chips —
  hidden in edit mode until now ("scope is fixed once logged") — reappear when
  a row is move-eligible. Flipping the chip never moves silently: it opens a
  confirm sheet that names every consequence before the one tap that commits.
- **Photos move with the transaction.** To make that possible, the personal
  ledger gains the family book's photo capture: up to 10 photos per private
  expense, EXIF/GPS-stripped, encrypted client-side under the personal DEK
  before upload. On a move, photo bytes are re-encrypted to the destination's
  key and travel with the row.
- **Expenses only, realized only, author-only.** Income, transfers (locked
  private by full-ledger T6), loans and repayments don't move. Proposals
  (future-dated family rows) don't move — retracting a proposal is what delete
  is for. And only the person who *authored* a family expense can pull it into
  their own private book.

## 2. The two directions, walked through

### 2.1 Personal → family ("Chuyển sang sổ gia đình")

You logged "trưa nay 180k" privately, then decide it was a family lunch.
Edit the row, flip the chip to 🏡. The confirm sheet says the family will see
it, and that any photos go along. One tap:

1. A family expense is written through the normal encrypted path — category
   resolved against (or created in) the family's category table, payer = you
   (adjustable in the sheet before saving), your authorship recorded.
2. Photos are re-encrypted from your personal key to the family's and attached
   to the family row; your private copies are removed (the transaction's
   photos live in whichever book the transaction lives in — mirror rows stay
   photo-less, per M7).
3. Your private row is **converted in place** into the mirror master: it gains
   `space_id` + `link_id` and becomes read-only on the personal side, exactly
   like every other authored family expense. Its `id`, `created_at`, and —
   deliberately — its **`account_id` survive**, so the account's anchored
   balance stays correct for free.

Net effect: family stats gain the expense; your personal month total is
unchanged (the row just changed label from "riêng tư" to the family's name).

### 2.2 Family → personal ("Chuyển về sổ riêng")

You logged a family expense that was actually private. From your personal tab
the row shows with the family's name (a mirror row — now tappable, M10);
tapping opens the family expense detail, Update opens the editor, flip the
chip to 🔒. The confirm sheet names what the family loses: the row leaves the
shared book, N reactions are deleted, photos come along to your private book.
It also offers an optional account tag ("Trả bằng gì?") so the row can feed an
account balance from the start. One tap:

1. Photos are re-encrypted from the family key to your personal key and
   attached in your book; the family's storage copies are removed with the row.
2. Your mirror master is converted back into a private row — `space_id` and
   `link_id` cleared, account tag applied if you chose one. It becomes
   editable again.
3. The family row is deleted through the ordinary delete path: month
   aggregates reverse, reactions cascade away, the family ledger no longer
   shows it.

Net effect: family stats lose the expense; your personal month is unchanged.
**Privacy is not retroactive** — the family already saw this row, and the
sheet's copy doesn't pretend otherwise (edge rule 7).

### 2.3 Who can move what

| | Personal → family | Family → personal |
|---|---|---|
| Eligible rows | Private rows (`kind='expense'`), readable, any date ≤ today | Realized family expenses **you authored** (`created_by` = your member) |
| Ineligible, and why | Income/transfer/loan/repayment (no family mapping; T6); unreadable rows | Proposals (retraction = delete); other people's rows (their book, their move); Event-linked rows keep their event untouched |
| Requires | Personal key + family key unlocked, online | Same |

## 3. Personal photos — the capture parity that makes moves whole

- The personal expense sheet (add and edit, single-row) gains the same photo
  field as the family sheet: up to 10, EXIF/GPS stripped by canvas re-encode,
  **always encrypted** under the personal DEK before upload (the personal
  ledger is ciphertext-only from birth — there is no unencrypted state).
- Photos render on personal rows the same way family `.enc` photos render
  everywhere: the photo observer decrypts in place; a locked ledger shows
  blanks, never bytes.
- Deleting a private row removes its photo files; regenerating the personal
  card re-encrypts photo objects under the new key alongside every `_enc`
  column (an interrupted regen resumes, old key valid until the swap).
- **Named exclusions (decisions, not omissions):** personal photos never join
  Moments/memories — that is a family surface, and leaking private-expense
  photos into any shared-adjacent view is exactly what the personal ledger
  exists to prevent (M5). The photo-assign batch tool stays family-only for
  now. Ordinary mirror rows stay photo-less — the "annotation join" item in
  `docs/features/personal-ledger.md` remains deferred (M7).

## 4. Safety rules

1. **Write the destination first, remove the source last.** Duplicating is
   recoverable; losing money is not — the same posture as review promotion.
2. **Photos are part of the destination write.** Any photo transfer failure
   aborts the whole move; there is no photo-less partial move.
3. **A pending-move journal, local-first.** Both directions have a crash
   window between the two halves; a small local record lets the next
   opportunity finish the second half instead of leaving a duplicate. The
   `link_id` is the idempotency key: the repair can always tell which half
   landed.
4. **Online-only, both keys required.** No outbox path; offline gets a toast.
5. **Payer defaults to the mover**, adjustable in the sheet (personal→family).
6. **No provenance marker.** A moved row is indistinguishable from one logged
   in its book originally — same principle as imported rows.
7. **Privacy is spent knowingly.** Family→personal copy says the family
   already saw the row; personal→family copy says the family will see it and
   there is no un-share (beyond moving it back, which doesn't un-see it).
8. **Mirror invariants hold.** The one sanctioned write that *adds* a link to
   a personal row is the move itself; every ordinary personal edit/delete
   still filters `link_id is null`. On the family side `link_id` stays
   write-once (trigger-enforced) — the move sets it at insert time.

## 5. Copy

- Personal→family sheet: **"Chuyển sang sổ gia đình?"** — "Cả nhà sẽ thấy
  khoản này. Ảnh đi kèm được giữ nguyên."
- Family→personal sheet: **"Chuyển về sổ riêng?"** — "Khoản này rời khỏi sổ
  gia đình. Ảnh được giữ; N cảm xúc của cả nhà sẽ mất."
- The personal book is **"sổ riêng"** in consequence copy (matches "Sổ riêng
  của bạn" / the "riêng tư" row label); "Cá nhân" remains the tab's name (M13).

---

# Part 2 — Technical Appendix

## 6. Schema — migration 0114

### 6.1 `personal_transaction_photos`

```sql
create table public.personal_transaction_photos (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  transaction_id uuid not null references public.personal_transactions(id) on delete cascade,
  photo_url text not null,          -- storage PATH in personal-media (not a full URL)
  sort_order int not null default 0,
  taken_on date,                    -- EXIF capture day, if known
  created_at timestamptz not null default now()
);
```

RLS: one policy, all verbs, `owner_user_id = auth.uid()` — same shape as every
personal table. Indexes on `(transaction_id)` and `(owner_user_id)`. No
ciphertext columns: the photo *bytes* are the encrypted artifact; `photo_url`
addresses ciphertext, `taken_on` follows the same plaintext-date rule as
`txn_date`.

### 6.2 `personal-media` bucket

`family-media`'s storage policies pin the first path folder to
`auth_family_id()`, so personal photos get their own bucket: `personal-media`,
public (privacy from the key, not the address — same argument as 0017), with
insert/update/delete/select policies requiring
`(storage.foldername(name))[1] = auth.uid()::text`. Objects are always
`<uid>/<ts>_<rand>.<ext>.enc` — AES-256-GCM under the personal DEK; there is
no plaintext branch because the personal ledger has no plaintext state.

## 7. Photo plumbing

- **Encrypt/decrypt:** `19-personal.js` exposes `fhPersonalEncBytes` /
  `fhPersonalDecBytes` (personal-DEK twins of `fhEncBytes`/`fhDecBytes`).
  Upload reuses the family compressor (`fhCompressImage`, newly exported from
  `40-txn-writes-outbox.js`) so EXIF/GPS stripping stays one implementation.
- **Render:** the photo observer (`57-photo-enc.js`) branches per URL: a
  `/personal-media/` URL decrypts with the personal key (gated on it), any
  other `.enc` URL keeps the family path. No render site changes.
- **Hydrate:** `fhPersonalHydrate` fetches the window's photo rows and attaches
  `photos: [publicUrl…]` to `P.txns` entries; the tab list, the shared txn
  overlay and the edit sheet all render from that.
- **Delete/regen:** `fhPersonalDeleteExpense` removes storage files before the
  row (rows cascade); `fhPersonalRegen` sweeps photo objects — decrypt with
  the old key, re-encrypt with the new, upload a new path, update the row,
  remove the old object; a photo already readable under the new key is
  skipped, so an interrupted regen resumes.

## 8. The move — exact order of operations

Both directions live in `src/js-data/21-ledger-move.js` and share the journal.

### 8.1 Personal → family (`fhLedgerMoveToFamily`)

```
guards: P.key · family key (fhKeyReady or enc off) · online · private readable expense
1. linkId = randomUUID(); journal {dir:'p2f', pid, linkId}
2. photos: fetch each personal object → fhPersonalDecBytes → family-encrypt
   (fhEncBytes when enc; plaintext bytes otherwise, like any family photo) →
   upload to family-media. Any failure → abort, best-effort cleanup, journal cleared.
3. category: window._categoryIdForName(cat, emoji) — creates if new
4. insert family row WITH link_id = linkId (write-once trigger allows the
   initial set), fhField amount/note/occurred_time, member_id = chosen payer,
   created_by = me, status 'realized'
5. insert transaction_photos rows for the uploaded paths
6. convert the private row in place:
   update personal_transactions set space_id=fid, link_id=linkId, version=1
   where id=pid and owner_user_id=me and link_id is null
   (the one sanctioned link-adding write — 21-ledger-move only)
7. delete the personal photo rows + objects (the master is photo-less, M7)
8. clear journal; rehydrate family + personal; toast
```

Crash between 4 and 6: the family row exists with a `link_id` that pairs with
nothing — the mirror engine's reconcile would insert a fresh master, briefly
double-counting next to the unconverted private row. The journal repair
(§8.3) finishes the conversion first and deletes any reconcile-minted
duplicate master by `link_id`.

### 8.2 Family → personal (`fhLedgerMoveToPersonal`)

```
guards: P.key · family readable · online · realized expense · created_by = me
1. fetch the family row's link_id; locate my master (may be absent if the
   mirror hasn't caught up — then a fresh private row is created instead of a
   conversion, same net effect)
2. journal {dir:'f2p', famId, pid(master), acctId}
3. photos: fetch each family object/URL → decrypt if '.enc' → fhPersonalEncBytes
   → upload to personal-media → insert personal_transaction_photos on the master.
   Any failure aborts.
4. convert the master to private:
   update personal_transactions set space_id=null, link_id=null,
     account_id=coalesce(chosen, account_id) where id=pid and owner_user_id=me
5. delete the family row: storage files first, then the row (photo rows and
   reactions cascade) — the same sequence as _dbDeleteTxn
6. clear journal; rehydrate family + personal; toast
```

Convert-before-delete is deliberate: once the master's `link_id` is cleared,
no reconcile pass can tombstone it when the family row disappears. The
remaining window (4→5) leaves the family row alive with a dangling `link_id`;
a racing reconcile may insert a duplicate master, which the post-delete
reconcile tombstones on its own (its family row is gone). The journal repair
finishes the delete if the app dies first.

### 8.3 The journal

`localStorage['fh-move-journal:<uid>']`, written before step 1's side effects,
cleared on completion. Repair runs at the top of every `fhPersonalMirror` pass
(the one moment both ledgers are known ready) and is idempotent:

- `p2f`: family row with `link_id` exists? → ensure the private row is
  converted (or already is), delete any duplicate master sharing the
  `link_id`, clear. Family row absent? → nothing committed; clear (orphaned
  uploads are storage-only debris, removed best-effort).
- `f2p`: family row still exists? → master already converted (its `link_id`
  cleared) means finish the delete; master untouched means the move never got
  past photos — clear and let the user retry. Family row gone? → done; clear.

## 9. UI wiring

- **Edit-mode chips** (`50-sheets-expense-capture.js`): `#ex-scopefield`
  reappears in edit mode when the row is move-eligible; the current scope is
  selected. In edit mode `pickExScope` routes to `fhMoveChipTap(dir)` instead
  of `_applyExLayout` — nothing about the edit layout changes until the move
  commits. The comment "scope is fixed once logged" is retired by this epic.
- **Confirm sheet** `#sheet-move`: title + consequence lines per direction
  (photo count, reaction count, family-visibility line), the optional account
  chips (f2p only, non-card accounts + Tiền mặt), payer note (p2f), one
  primary CTA. Cancel restores the chip to the row's real scope.
- **Mirror rows tappable** (`60-transactions.js` / `21-personal.js`): a mirror
  row of the *active* family resolves its family twin by `link_id` → local
  `_dbId` and opens `openExpenseDetail`; a row outside the loaded window (or a
  non-active family's) toasts a pointer instead.
- **Account editing on private rows** (M9): the personal edit sheet shows the
  instrument chips prefilled from the row; `fhPersonalUpdateExpense` gains
  `accountId` (undefined = untouched, null = clear, id = set).

## 10. What deliberately does not change

- The mirror engine's field list (`_insertMaster` / reconcile) is untouched —
  masters still don't carry photos, and only the move writes `account_id` on a
  master (the reconcile never nulls fields it doesn't manage).
- The review screen, sealed staging, and the promote path: unchanged. The
  over-sealing asymmetry still governs *staged* rows.
- Family photo pipeline, buckets, policies: unchanged.
- `fhPersonalAddExpense`'s private-only guard and every existing writer's
  `link_id is null` filter: unchanged.

## 11. Scope

**In (one release, big bang — M11):** migration 0114; personal photo capture
parity (add/edit/render/delete/regen); both move directions with confirm
sheets; the journal + repair; mirror-row tap-through; account editing on
private rows; account picker in the f2p sheet.

**Out (named):** income/loan/repayment moves; moving proposals; photo-assign
in personal scope; personal photos in Moments/memories; photos on ordinary
mirror rows (annotation join, still deferred); account tags on ordinary
mirror masters (sibling fix, not this epic); moving to non-active families.

## 12. Decision log

From the design interview, 2026-09-04.

| # | Decision |
|---|---|
| M1 | Both directions ship: personal→family and family→personal. |
| M2 | Family→personal is **author-only** (`created_by` = mover). Payer-but-not-author and other-member rows: delete + re-log is the escape hatch. |
| M3 | **Expenses only.** Income maps lossily, transfers are locked private (full-ledger T6), loans/repayments have no family concept. |
| M4 | Affordance = the **scope chips, unlocked in edit mode**, with a mandatory confirm sheet on flip (silent chip moves are forbidden). Repeals "scope is fixed once logged". |
| M5 | **The whole row moves, photos included** — which pulls personal photo capture parity into scope: 10 photos, EXIF-stripped, personal-DEK encrypted. Personal photos never join Moments/memories (locked). Photo-assign stays family-only. |
| M6 | **Realized rows only.** Proposals don't move (retraction = delete); future-dated private rows don't publish. |
| M7 | Ordinary mirror rows stay photo-less (annotation join stays deferred). A moved row's photos live in its destination book; the source copies are removed. |
| M8 | Family→personal **drops reactions**, count named in the confirm sheet. |
| M9 | F2p confirm offers an **optional account picker**; the personal edit path gains account editing (the untaggable-row gap). Account tags on ordinary mirror masters: named out of scope. |
| M10 | **Mirror rows become tappable** → the family expense detail. Their write-inertness is unchanged. |
| M11 | Build shape: **big bang** — photo parity + move in one release (interview initially chose milestones; overridden by the build directive). |
| M12 | Edge rules blessed: destination-first ordering · photo failure aborts · local-first pending-move journal · online-only + both keys · payer defaults to mover · no provenance marker · privacy spent knowingly · mirror invariants hold (the move is the one sanctioned link-adding personal write). |
| M13 | The personal book is **"sổ riêng"** in consequence copy; sheets titled "Chuyển sang sổ gia đình?" / "Chuyển về sổ riêng?". |

## 13. Related

- `docs/specs/personal-ledger-spec.md` — Model Y, the mirror engine, §9's
  named gap this closes.
- `docs/specs/full-ledger-spec.md` — the spine, accounts, anchored balances,
  T6 (transfers always private).
- `docs/specs/family-tab-spec.md` — the family write path, photos, reactions.
- `docs/specs/transaction-review-spec.md` — the *staged* re-route rules this
  spec deliberately does not touch.
- `docs/features/personal-ledger.md` — the deferred annotation-join item.
