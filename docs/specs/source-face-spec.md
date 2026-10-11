# Source Faces: a bank is recognised before it is read

Every place the app names a bank account, a card or a wallet used to print text
only: "VIB ••4751", "Vietcombank ••2279". Four tiles in Tài sản were four lines
to read. Each money source now wears a **face**: a monogram on the provider's
own colour.

> **Status, 2026-10-11. BUILT and pushed to `main`, SW `v628`.** Client only:
> no migration, no Edge Function deploy, and the worker's `providers.mjs` is
> byte-identical. Tests: `tools/source-face.test.js`. Checked in the built app
> through the UI harness (tiles, setup, account screens, pay chips); not yet
> tried on a real phone.

> **How this relates to its siblings.** `account-identity-spec.md` made the
> provider half of an account's identity a registry key; the face hangs off
> that same key, so it needs no matching. `recurring-charges-spec.md` §3.4 and
> §3.5 give a *seller* its brand glyph (`taxonomy/brands.json`); this spec is
> the other side of a payment, the *source* the money left. The two registries
> stay separate on purpose: the brand matcher strikes MoMo, ZaloPay and VNPay
> out of a text as rails, while here they are the account itself.

---

## 1. What the person sees

A rounded square in the provider's colour holding its monogram, before the
account's name. From 26 px up it shows the whole monogram (VCB, MoMo, BIDV).
Under 26 px it sits inside a line of text beside the name, so it shows one
letter, two when the monogram is two (MB, ZP), and the colour does the rest.

Surfaces:

| Where | Size |
|---|---|
| Tài sản tiles (set up or not) | 28 |
| Account and card screens: the title | 34 |
| Account setup and settings: beside the name field | 40 |
| "Trả bằng gì?", "Vào tài khoản nào?", "Nguồn tiền", "Trả cho thẻ", transfer and merge pickers | 18 |
| Detail screens: the Nguồn tiền, Từ, Đến, Trả cho thẻ rows; the family detail's source line | 18, 15 |
| Queue card: the bank on the top line; quick review's source | 15, 18 |
| List rows: the source in the subline | 14 |
| List rows between two accounts: the tile is both faces, from then to | 25 + 25 |
| A card payment tagged to its card: the tile is the card's face | 42 |
| "Vừa tìm thấy" feed after connect | 30 |
| Statement cards | 34 |
| Giao dịch filter and bulk "Nguồn tiền" chips | 18 |

The kind emoji that chips carried (💳 🏦 📱) is replaced by the face. The kind
is still said in words where it was: the tile's subline, the queue card.

## 2. What a source wears, in order

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

## 3. Why monograms

Vietnamese bank and wallet marks are trademarks with no free-licence source
(Simple Icons carries none). Monograms are what people already call their
banks, need no artwork and no licence review, and cost one line per provider.
The trade is weaker recognition than a real mark, and a face that repeats the
first letters of the name beside it. Decided 2026-10-11 (S1).

Because every surface calls one renderer, a real glyph can replace the
monogram later by adding a field to the registry and a branch in `html()`. No
call site changes.

## 4. How it is built

- **Data.** `taxonomy/providers.json`: an entry may carry
  `"face": { "mono": "VCB", "hex": "00713D" }`. `mono` is one to four letters
  or digits. `hex` is six digits with no `#`, so the colour ratchet never
  counts the registry. Receipt senders may not carry one.
- **Generator.** `tools/gen-providers.js` validates the block, decides the ink
  (white when it clears 3:1 on the colour, else dark, which must clear 4.5:1,
  written as `dk`) and writes faces to the **client target only**. A colour
  edit therefore never touches a file an Edge Function is built from.
- **Renderer.** `src/js-ui/09-source-face.js`: `fhSrcFace(account, size)`,
  `fhSrcFaceId`, `fhSrcFaceKey`, `fhSrcFaceOf(prose)`, `fhSrcFaceInst(string)`,
  `fhSrcLabel(account, name)` (face plus the escaped name) and
  `fhSrcPairTile(from, to)`. Each returns HTML, or '' when there is nothing to
  show. Nothing is fetched: which banks a person uses is theirs.
- **Style.** `src/css/41-source-face.css`, tokens only. `--sfs` (side) and
  `--sfh` (colour) are set inline from the registry.

**Adding a provider's face:** one `face` line in `providers.json`, then
`npm run build`. The generator refuses a bad monogram, a bad colour, or a
colour that carries neither ink.

## 5. Limits

- 24 banks and 7 wallets or lenders have a colour. The colours were entered
  from memory of each brand's public identity and have **not been checked
  against brand guidelines**. The other providers have a monogram on neutral.
- A card and a bank account at one bank wear the same face. The four digits
  and the kind word tell them apart.
- The Giao dịch row context is pinned by `heat-txn-ctx.test.js`, so the faces
  of rows between accounts ride beside it (`_pTxnFaces`), not in it.
- Not done: the review queue's "Theo nguồn" group headers, the mailbox
  settings screen, the rules list, the investment history line.

## 6. Decision log

| # | Decision |
|---|---|
| S1 | Monograms on the provider's colour, not vendored logos. |
| S2 | The face hangs off the provider registry key. The brand registry is not reused: its rails are this registry's accounts. |
| S3 | Faces are generated to the client only; the worker copy stays byte-identical. |
| S4 | No colour in the registry means the neutral face. Nothing derives a colour. |
| S5 | Under 26 px a monogram longer than two letters shows its first letter. |
| S6 | One renderer for every surface, so the artwork can change in one place. |
| S7 | A row between two accounts wears both faces as its tile; the kind stays in words on the right. |
