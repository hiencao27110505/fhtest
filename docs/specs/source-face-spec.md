# Source Faces: a bank is recognised before it is read

Every place the app names a bank account, a card or a wallet used to print text
only: "VIB ••4751", "Vietcombank ••2279". Four tiles in Tài sản were four lines
to read. Each money source now wears a **face**: a monogram on the provider's
own colour.

> **Status, 2026-10-11 (evening). Second pass BUILT and pushed to `main`, SW
> `v630`.** The first pass (`v628`, `07a841f`) put a one-letter face inside
> list sublines and it failed on a real phone the same day (§3). This pass
> gives the face three shapes and moves a list row's source to a badge on the
> tile's corner (§2, §4; option 1 of `mockups/source-face-options.html`).
> Client only: no migration, no Edge Function deploy, the worker's
> `providers.mjs` is byte-identical. Tests: `tools/source-face.test.js`.
> Checked in the built app through the UI harness (tab list, Giao dịch, pay
> chips, tiles); **not yet re-checked on a real phone.**

> **How this relates to its siblings.** `account-identity-spec.md` made the
> provider half of an account's identity a registry key; the face hangs off
> that same key, so it needs no matching. `recurring-charges-spec.md` §3.4 and
> §3.5 give a *seller* its brand glyph (`taxonomy/brands.json`); this spec is
> the other side of a payment, the *source* the money left. The two registries
> stay separate on purpose: the brand matcher strikes MoMo, ZaloPay and VNPay
> out of a text as rails, while here they are the account itself.
> `transaction-review-spec.md` and the txn-listing revamp own the row anatomy
> this spec decorates and does not change.

---

## 1. What a source wears, in order

1. Its registry face, by `provider_key` (0150). A renamed account keeps it.
2. The face its prose resolves to: an account from before 0150, a staged row's
   `source_provider`, a family row's instrument string ("VIB · tín dụng ••4512").
3. A monogram made from its own name on the neutral fill: a provider the
   registry does not know, or an account named by hand ("Quỹ đen" is QĐ).
4. The kind's emoji on the neutral tint, for cash and for a position.

**A face never invents a colour.** No `hex` in the registry means neutral grey.
A random identity colour would read as a brand claim the app cannot back.

An account named by hand is tried against the registry by its whole name, then
its leading word. A leading word under three letters is not trusted alone:
"TP HCM quỹ" is not TPBank. "MB Bank chung" still finds MB through two words.

## 2. Three shapes, one per place

| Shape | Where | What it shows |
|---|---|---|
| **Square**, 26 px and up | Tài sản tiles (28), account and card screen titles (34), setup and settings beside the name field (40), statement cards (34), the "Vừa tìm thấy" feed (30) | The whole monogram: VCB, MoMo, BIDV |
| **Tag**, 16 to 18 px tall | Every account chip and picker, the source rows on detail screens, the queue card's top line, quick review, the Giao dịch filters | The whole monogram, as wide as it needs. Type never under 9.5 px |
| **Badge**, 22 px | The corner of a list row's tile | One letter, two when the monogram is two (MB, ZP) |

**A tag stands in place of the provider's name, never beside it.** The chip
for "Vietcombank ••2279" is the VCB tag and "••2279". An account named "VCB
lương" is the tag and "lương". A name that does not start with its provider
("Thẻ chính") is kept whole after the tag. An account with a monogram made
from its own name gets no tag at all: it would repeat, in grey, the first
letters of the words printed right after it.

A provider named on its own (the queue card's "Vietcombank", the peek card)
becomes its tag only when the registry has its colour. Otherwise it stays
words.

The kind emoji that chips carried (💳 🏦 📱) is gone. The kind is still said
in words where it was: the tile's subline, the queue card.

## 3. What the first pass got wrong

The first pass used one shape at every size: the square, shrunk to 14 to 18 px
with its monogram cut to one letter, placed before the account's name. On a
phone, in the transaction list:

1. The subline wrapped. Date, time, mark, name and four digits do not fit a
   text column about 157 px wide, so "••1217" sat alone on a second line and
   row heights went uneven. Long names already wrapped before; the mark made
   every row wrap.
2. The mark was separated from its name when the break fell between them.
3. The letter was about 7.5 px tall, under anything readable.
4. VIB, Vietcombank and VPBank were all "V", and two of the three are green.
5. Two saturated blocks competed in one row: the seller's logo and the mark.
6. The mark repeated the word that followed it ("M", "MoMo") on nearly every row.
7. A row between accounts wore a 42 px bank tile, the same shape and size as a
   seller's logo, so it read as the shop that was paid.

Every rule in §2 and §4 answers one of these. The lesson for later work: a
face shown under 26 px must be drawn and looked at on a phone inside the real
line it will sit in, with the longest name the registry holds.

## 4. List rows

One rule for the Cá nhân tab list and the personal Giao dịch screen.

- **The badge is the account the row moves.** For an expense that is where the
  money came from; for income, where it arrived. It sits on the tile's
  bottom-right corner with the same ring as the family mark.
- **The subline carries no mark and no bank name.** It says date, time, then
  the account's four digits ("••1217"). An account with no number says its
  name. Cash says nothing; its badge did.
- **The subline stays on one line.** If it cannot fit it is cut with an
  ellipsis; it never makes the row taller.
- **A row between two accounts** wears a neutral tile with two arrows, never a
  bank's face at tile size. Its title names both ends without their numbers
  ("VIB → Vietcombank"), numbers kept only when the names alone would read the
  same ("VIB ••5140 → VIB ••4751"). Its badge is the account the money left.
  A one-leg row (a card payment tagged to its card) keeps its note as the
  title, wears that account's badge and says its four digits.
- **"không tính thu chi" is no longer in a transfer's subline.** The grey
  amount and the word "Chuyển khoản" under it already say so, which is what
  the listing revamp had decided for these rows.
- **One corner, one meaning per row.** A family expense in the personal book
  keeps 🏡 on that corner and names no account. A family-ledger row keeps the
  member's avatar there and names its source in words.

## 5. Why monograms

Vietnamese bank and wallet marks are trademarks with no free-licence source
(Simple Icons carries none). Monograms are what people already call their
banks, need no artwork and no licence review, and cost one line per provider.
The trade is weaker recognition than a real mark. Decided 2026-10-11 (S1).

Because every surface calls one renderer, a real glyph can replace the
monogram later by adding a field to the registry and a branch in the renderer.
No call site changes.

## 6. How it is built

- **Data.** `taxonomy/providers.json`: an entry may carry
  `"face": { "mono": "VCB", "hex": "00713D" }`. `mono` is one to four letters
  or digits. `hex` is six digits with no `#`, so the colour ratchet never
  counts the registry. Receipt senders may not carry one.
- **Generator.** `tools/gen-providers.js` validates the block, decides the ink
  (white when it clears 3:1 on the colour, else dark, which must clear 4.5:1,
  written as `dk`) and writes faces to the **client target only**. A colour
  edit therefore never touches a file an Edge Function is built from.
- **Renderer.** `src/js-ui/09-source-face.js`. Nothing is fetched: which banks
  a person uses is theirs.

  | Call | Gives |
  |---|---|
  | `fhSrcFace(account, size)`, `fhSrcFaceId`, `fhSrcFaceKey`, `fhSrcFaceOf(prose)` | The square from 26 px, the tag under it |
  | `fhSrcLabel(account, name)` | An account in a chip or a value: tag, then the rest of its name, escaped |
  | `fhSrcInstLabel(string)` | A family row's instrument string: tag, then the words after the provider |
  | `fhSrcName(prose, shown)` | A provider named alone: its tag, or `shown` as text |
  | `fhSrcBadge(account)`, `fhSrcRowSub(account)` | A list row's corner badge and its subline text |
  | `fhSrcXferTitle(from, to)`, `FH_SRC_XFER_TILE` | A transfer row's title and tile |

- **Style.** `src/css/41-source-face.css`, tokens only. `--sfs` (side) and
  `--sfh` (colour) are set inline from the registry.

**Adding a provider's face:** one `face` line in `providers.json`, then
`npm run build`. **Naming an account somewhere new:** call
`fhSrcLabel(account, name)` instead of escaping the name yourself.

## 7. Limits

- 24 banks and 7 wallets or lenders have a colour. The colours were entered
  from memory of each brand's public identity and have **not been checked
  against brand guidelines**. The other providers have a monogram on neutral.
- The badge is one letter, so on a list row VIB, Vietcombank and VPBank are
  told apart by colour and by their four digits, not by a letter. This was
  the known cost of the badge when it was chosen (S8).
- A card and a bank account at one bank wear the same face. The four digits
  and the kind word tell them apart.
- The Giao dịch row context is pinned by `heat-txn-ctx.test.js`, so a row's
  badge, subline text, transfer tile and title ride beside it (`_pTxnFaces`),
  not in it.
- An investment row in the tab list still says "không tính thu chi" in its
  subline and can still wrap. Not touched here.
- Not done: the review queue's "Theo nguồn" group headers, the mailbox
  settings screen, the rules list, the investment history line.

## 8. Decision log

| # | Decision |
|---|---|
| S1 | Monograms on the provider's colour, not vendored logos. |
| S2 | The face hangs off the provider registry key. The brand registry is not reused: its rails are this registry's accounts. |
| S3 | Faces are generated to the client only; the worker copy stays byte-identical. |
| S4 | No colour in the registry means the neutral face. Nothing derives a colour. |
| S5 | REPLACED by S9. Was: under 26 px a monogram longer than two letters shows its first letter. |
| S6 | One renderer for every surface, so the artwork can change in one place. |
| S7 | REPLACED by S11. Was: a row between two accounts wears both faces as its tile. |
| S8 | A list row names its account with a badge on the tile's corner and the four digits in the subline. Chosen 2026-10-11 from eight options (`mockups/source-face-options.html`, option 1), knowing the badge is one letter. |
| S9 | Under 26 px the face is a tag with the whole monogram, type never under 9.5 px. No one-letter square exists outside the badge. |
| S10 | A tag stands in place of the provider's name. A monogram made from the name itself gives no tag. |
| S11 | A row between accounts wears a neutral two-arrow tile. No bank face at tile size in a list. |
| S12 | A list subline of short facts stays on one line (`.r-s1`). |
| S13 | "không tính thu chi" leaves the transfer row's subline. |
| S14 | A mirror row keeps 🏡 on the corner; a family-ledger row keeps the member's avatar and names its source in words. |
