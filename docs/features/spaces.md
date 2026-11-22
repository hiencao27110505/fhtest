# Spaces ("Nhóm")

Spec: [`docs/specs/spaces-spec.md`](../specs/spaces-spec.md) (decisions S1 to S41).
Brief: [`docs/briefs/spaces.md`](../briefs/spaces.md). Build list:
[`docs/specs/spaces-checklist.md`](../specs/spaces-checklist.md).

## Problem & Why

The app had two kinds of shared container that behaved nothing alike: the
family, which had everything, and a "nhóm chia tiền" tucked inside Tài sản that
had almost nothing and, because its roster read fields `my_families` never
returned, most likely never opened. Friends who share bills had nowhere to do
it. Now every shared container is one thing, a **space**, and what differs
between a family and a group of friends is a profile of switches.

## Architecture

- **Any space can be the open one.** The whole family stack follows
  `profiles.family_id`; `fhSpaceOpen` calls `switch_family` and re-hydrates.
  Nothing in the family stack asks what kind of container it is.
- **The profile** is `families.profile` (plaintext jsonb: eight booleans, a
  default mode, a preset, an emoji). `{}` means the preset's defaults, so an
  existing family reads as every switch on and Chia tiền off.
  `src/js-ui/15-spaces-core.js` holds the defaults and every rule that decides
  a number; `tools/spaces-core.test.js` pins them.
- **Gating is presentation, not access.** `fhSpaceShellApply`
  (`16-spaces-shell.js`) sets `sp-no-<feature>`, `sp-friend`, `sp-split`,
  `sp-closed` on `<html>`; renders ask `fhSpaceHas(feature)`.
- **The light path** (`src/js-data/22-spaces.js`) reads every OTHER space that
  keeps balances by explicit id, with that space's own key (`S.keys[fid]`, the
  same `fh-keys` store the family path reads when the space becomes open). It
  is what the Nhóm section, review and the book pass use. The open space's
  shares and settle-ups ride it too.
- **Chia** is a `transactions` row plus one `txn_shares` row whose sealed JSON
  is `{ memberId: amount, _out?, _parts?, _bill? }`. The expense goes through
  the ordinary family write path; the share row follows, with a sealed local
  retry queue (`fh-shq`). A row with no share row is Chung.
- **Balances are derived** on the device (`fhSpaceBalancesOf`,
  `fhSpacePairwiseOf`). Nothing is stored.
- **The person's own book** (`23-spaces-book.js`): each member's device writes
  that member's rows into `personal_transactions` with existing kinds, marked
  `source = 'space:<family_id>'` and linked by ids derived from the space
  row's id. The Chung mirror in `19-personal.js` skips rows that have a share
  row and never touches rows with that source.
- **Capture** (`18-spaces-capture.js`, called by `56-csv-import-ui.js`): the
  queue keeps its two scopes; `c._spaceId` says which space and `c._split`
  how. The open space is written through the family path, another one through
  `fhSpaceCaptureWrite`.

## Files

| File | Role |
|---|---|
| `src/js-ui/15-spaces-core.js` | Pure rules: presets, split arithmetic, balances, book plan and diff, link ids |
| `src/js-ui/16-spaces-shell.js` | `fhSpaceHas`, the shell classes, tab labels, the space home, the balances block, detail rows |
| `src/js-ui/17-spaces-split-ui.js` | The one "Tính thế nào?" control and its home on the expense sheet |
| `src/js-ui/18-spaces-capture.js` | Review-queue helpers: destination chips, split rows, settle-up offer |
| `src/js-data/22-spaces.js` | Roster, keys, open, light-path hydrate, writes, invite link |
| `src/js-data/23-spaces-ui.js` | Nhóm section, switcher, create, profile, invite, unlock, settle sheets |
| `src/js-data/23-spaces-book.js` | The book pass, capture into a non-open space, the tap sheet for space rows |
| `src/css/82-spaces.css` | The gates and the few new layout rules |
| `supabase/migrations/0165_spaces.sql` | The schema change, drafted for Hien to apply |
| `tools/ui-harness/flows/spaces.flow.js` | Ten journeys against the stub |

## Current State

Built on `feat/spaces` (2026-11-22). Client complete for the checklist except
the lines it leaves unticked. **Not live:** the migration is a draft and
`push-send` is edited but not deployed.

Verified in the harness (stub backend, real client): shell gating for a
family and a friend space, Chung and Chia from the expense sheet, outside
shares, settle-up, capture into the open space and into another one, the
settle-up offer, create with a profile, the invite sheet, a closed space.

Not exercised end to end, because the harness hangs personal-table reads and
the stub is not Postgres: the book pass writing real `personal_transactions`
rows; every changed SQL function; the invite link opened on a second device;
push delivery across spaces; removing a member.

## Known gaps

- A family that turns Kỷ niệm or Mục tiêu off still shows those blocks on its
  home tab (the tab itself, the add-sheet rows and the money-tab card are
  gated). Friend spaces are unaffected: their home has no such blocks.
- A Chia expense needs a connection; offline it is refused with a message.
- A Chia expense someone else recorded for you lands in your book with no
  account until you pick one, and there is no picker for it yet.
- The quick review sheet offers Cá nhân and the open space only.
- `txn_shares` and `settle_ups` are not on the realtime channel: another
  member's settle-up shows at the next hydrate.
- Quỹ, guests, by-person view, multi-currency, attaching a bank row to an
  expense someone else recorded, rules that name a space, VietQR on settle.
