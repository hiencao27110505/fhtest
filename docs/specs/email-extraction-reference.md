# Email Extraction Reference — how a bank email becomes fields

**Genre:** reference (maintained). Version as of pipeline `mailbox-sync v24`, 30 Aug 2026.
Versions and counts in this document were read from the live project, not assumed.

Companion to `effortless-transaction-logging-spec.md`, which owns the end-to-end journey.
This document owns one link in that chain: **the conversion of mail text into ledger fields.**

---

## 1. Deployment surfaces

| Surface | Version | Deployed | Ships how |
| --- | --- | --- | --- |
| `mailbox-sync` — the reader | v24 | 30/08 10:26 | `supabase functions deploy` · manual |
| `mailbox-connect` — OAuth | v6 | 26/08 12:04 | manual |
| `push-send` | v15 | 22/08 16:37 | manual |
| App (Vercel) | — | on push | automatic from `main` |
| Apps Script — forwarding | unknown | unknown | hand-pasted into a console |

The pipeline is current with `main` as of the last commit touching `supabase/functions/`.

**Three of the five surfaces do not go through git**, so *"what is running"* and *"what is in main"*
are two different questions. The Apps Script is the sharpest case: it has no version anyone can read,
and it has drifted behind the Edge implementation by several weeks of fixes.

## 2. The three tiers

Tried in order. The first that succeeds wins, and each is roughly an order of magnitude cheaper
than the next.

### Tier 1 — stored template (`templates.mjs`)

A per-shape regex set, learned once and reused. Keyed on `(sender_address, normalised subject)` and
stored in one `sender_fingerprints` row that **both transports read and write**, last writer wins,
with no version check and no record of which transport wrote it.

> **Correction, 2026-08-31 — a template does NOT reliably carry between transports.**
> This section, and four other documents, used to say a template derived from a forwarded mail
> serves the direct reader and the other way round. That is true only when both transports see the
> **same text**, and they often do not. A template's anchors are regexes over the *rendered* body,
> and the two transports render differently: forwarding takes Gmail's own `getPlainBody()`, which
> flattens a two-cell table row onto one line and marks bold as `*At*`; the direct reader prefers
> the mail's `text/plain` part and, when there is none, flattens the HTML itself, putting label and
> value on **separate lines**. For a bank that sends a `text/plain` part the two agree. For an
> **HTML-only** mail they cannot, and a template derived under one form is a guaranteed miss under
> the other — indistinguishable, at the call site, from "this bank changed its layout".
>
> Verified by running the stored Vietcombank template against both renderings; it matched the
> plaintext form and returned `null` on the direct reader's. Counted in production since
> 2026-08-31 as the `template_missed` read-tally stage (see `pipeline/README.md`, Claims).

Two disciplines keep it honest:

- **Self-proving.** A derived template must reproduce the answer it was derived from, on the very
  body it came from, or it is discarded and `null` is stored. A plausible-but-wrong template would
  serve wrong figures to every later mail off that sender — worse than no template at all.
- **Version-stamped.** Every template carries the extraction logic version. Bumping that version
  self-invalidates the cache and forces one clean re-derivation per shape, rather than serving
  answers shaped by logic that no longer exists.

### Between the tiers: what is learned, and from what (2026-09-03)

Three learning surfaces, three different teachers:

- **Junk verdicts** are learned per (sender, subject) shape and — since the
  metadata-first change — applied BEFORE the body is fetched: an exact-shape
  verdict settles a message for the price of its headers. The sender-wide
  sentinel (`*`) never skips a fetch: it is a heuristic, and a marketing-heavy
  sender's first real transaction must still get read.
- **Templates** are learned per shape from any successful reading (label table
  or model), as before.
- **The label vocabulary itself learns** (0108): when the model reads a mail
  the dictionary could not, each (label, value) row whose value equals a field
  of the model's answer is one VOTE that the label means that field. Votes
  apply only at n≥3 from one sender domain; only memo, reference, merchant and
  beneficiary may be learned (the last two only under the transaction type that
  disambiguates them); amount, occurred_at, account and status are hand-add
  only, because a heuristic must never steer a number in a ledger. Hardcoded
  entries always win, and `delete from learned_labels` restores the
  hand-authored reader exactly. Learning is direct-read only until the shared
  logic plan reaches the forwarding transport.

Coverage — which senders are listed at ALL — is the one dimension no tier can
learn, so a weekly probe (`coverage_candidates`, 0110) counts transaction-shaped
mail from non-registry domains, storing domain + counts only. Widening the
registry stays a human act via `provider_domains`.

### Tier 2 — label table (`labeltable.mjs`) — added this week

Every Vietnamese bank notice we hold is a two-column label/value table over a small bilingual
vocabulary. This tier reads that structure directly: **no learning phase, no model call, and a bank
we have never seen works on its first mail.**

**Gated hard.** Without an amount, a timestamp, and a counterpart it returns nothing and lets the
model judge. Marketing mail does not carry an amount row *and* a transaction-timestamp row in table
form; a mail that does is a transaction notice by construction.

On success the template learner runs against *this tier's* output, so a shape it reads once graduates
to Tier 1 by itself. Learning stops being discovery — model-dependent and variable — and becomes
confirmation.

### Tier 3 — the model (`llm.mjs`, Gemini)

Judges what the deterministic tiers decline: genuinely prose mail, unfamiliar layouts, ambiguous
direction. It answers a closed schema, and a successful read feeds the template learner so the same
shape is never paid for twice.

Content is sent **unmasked**, on explicit consent, because masking cost more accuracy than it bought
privacy.

## 3. The field map

Labels are matched on a diacritic-stripped, lowercased form, so `Số tiền` and `SO TIEN` are one
thing. Matching is by substring, which is why the guards in §5 exist.

| Looks for | Vietnamese / English labels | Becomes |
| --- | --- | --- |
| charge | số tiền phí · loại phí · khuyến mãi · hoàn tiền · điểm thưởng | *absorbed* — never the amount |
| amount | số tiền · số tiền giao dịch · transaction amount | `amount` |
| when | ngày, giờ giao dịch · trans. date · thời gian giao dịch | `occurred_at` |
| merchant | điểm giao dịch · sử dụng tại · merchant | `counterparty` (preferred) |
| beneficiary | tên người hưởng · người thụ hưởng · beneficiary name | `counterparty` (fallback) |
| remitter | tên người chuyển · remitter's name | self-transfer test |
| memo | nội dung chuyển tiền · details of payment | `memo` → tidied to `memo_display` |
| account | tài khoản trích nợ · số tài khoản · tk chạm · debit account | `account_masked` — last four only |
| reference | số lệnh giao dịch · số tham chiếu · order number | `reference_number` |
| status | tình trạng · trạng thái · status | `status` + the failed-transaction gate |
| balance | số dư · balance | `balance` — captured, not yet used |
| kind | loại giao dịch · transaction type | transfer vs receipt |
| card | thẻ · the card | context only |

### Derived, not read

- **`direction`** — the sign when the bank prints one, otherwise the document kind. Refund or *ghi có*
  wording flips it to credit.
- **`transaction_type`** — a beneficiary or remitter, or transfer wording, makes it `p2p_transfer`;
  otherwise `ecommerce_receipt`.
- **`flow`** — `transfer` when the sender's name equals the beneficiary's. Otherwise left null for the
  staging layer, because direction is evidence and flow is judgement.
- **`source_provider`** — from the sender registry, then canonicalised, so MB / MBank / MBBank are one
  bank.
- **`category`** — never guessed here. The client owns it and learns from corrections.

## 4. Number and date handling

**Amounts.** VND is stored in base units of 1.000đ. The parser strips a currency marker, removes one
decimal tail if present, then removes grouping separators. It refuses a zero: a statement writes
"0,00" in the debit column of every credit row, and letting that through turns half the rows of a
two-column statement into phantom transactions.

**Dates.** Three shapes are recognised, all Vietnam local time, all normalised to ISO with the
`+07:00` the mails omit because they never leave Vietnam:

- `2026-08-25 18:52:04` — MB card
- `26-08-2026 20:04:26` — MB transfer, VCB card (day first)
- `11:11 Chủ Nhật 23/08/2026` — VCB receipt (time, weekday, day first)

## 5. Changes this week

Four faults in how text became fields. Each is a different way of trusting a shape that was never
promised.

### 5.1 The amount was rounded away — up to 500đ on every row

VND is stored in units of 1.000đ, and the import rounded on the way in: a 337.900đ card charge became
338 and displayed back as 338.000đ. Plausible enough never to be questioned, and every total built on
those rows carried the sum of the errors. Two rounding sites, both now lossless. Hand entry is
unchanged — typing "45" still means 45.000đ, which required stating a threshold the old code got for
free from rounding.

### 5.2 A merchant name became the English half of its own label

VCB prints `Sử dụng tại` with `At` beneath it — one table cell, the halves separated by a `<br>`.
Every block tag becomes a newline, so the English twin lands exactly where the value should be:
**AEON MALL became "At"** on every VCB card row the tier read.

The twins are now named explicitly and skipped — never by a heuristic such as "short and alphabetic",
which would eat AEON, GS and Circle K along with them.

### 5.3 A bank's sign-off became the shop

`liên hệ với các điểm giao dịch của Vietcombank (trong giờ hành chính)` contains `điểm giao dịch` —
the merchant label — so the footer read as a label and the line after it became the merchant. On rows
whose real merchant line had already been lost to 5.2, the footer was the only merchant hit there was.

A length cap already existed and did not catch it: the sentence wraps, and the fragment carrying the
noun is short. **Length rejects the run-on clause; prose markers reject the wrapped one. Neither is
sufficient alone** — which is why the first fix looked complete and was not.

### 5.4 A cashback line could hijack the amount

`Số tiền khuyến mãi` contains `số tiền`. Found by a test fixture rather than in production; the
absorber row now swallows promotional, fee and points variants before `amount` can see them.

### 5.5 Two faults about identity rather than text

- **`account_masked` held full account numbers.** MB prints the full number one row below the masked
  one, and templates captured whichever their anchor matched. A field named *masked* now holds only
  the last four, enforced for every tier on the way out.
- **Declined attempts could stage as real spending.** Several stored templates staticised status as
  success at derivation, so a refused card attempt off the same shape parsed cleanly and staged. The
  mail's own status row now outranks the template, asked for every tier.

## 6. The structural finding

**The reader is positional, not structural.** Its whole rule is *"the line after a known label is that
label's value."* The HTML has real structure — a `<tr>` with two `<td>`s is unambiguously label and
value, and footer prose is not in a two-cell row at all — and flattening to text throws that away.
The reader then reconstructs pairs from adjacency, and guesses.

§5.2 and §5.3 are both consequences of that one choice. The fixes are guards around a lossy
conversion rather than a repair of it, and each new bank's phrasing may need another guard.

**Reading the table as a table would retire the whole class**: the bilingual twin is *inside* the
label cell and cannot be mistaken for a value, and footer prose is not in a two-cell row so it is
never considered a label. Roughly a day's work, and the strongest candidate for the next extraction
change.

The reason it was not built that way: the tier operates on `message.body`, already flattened — a
shape it shares with the forwarding path, which only ever has text. Giving the direct reader the raw
HTML would mean the two transports genuinely diverge in capability, which, given they have already
diverged, may be the honest thing to accept.

## 7. Traps worth carrying forward

- **Never key an identity on something the system rewrites.** Dedup was keyed on descriptions; we
  improved descriptions; the identity dissolved. Identity must come from what is observed, never from
  what is decided.
- **Fixtures from the wrong source pass while production fails.** Gmail's plaintext keeps bilingual
  labels on one line; the HTML path splits them. Every test passed while production was wrong.
  Reproduce through the real converter, not through a convenient rendering of the same mail.
- **A failure before your instrumentation is invisible to it.** An early throw looks exactly like an
  empty mailbox — no rows, no tally, no alert.

## 8. Tests

| Suite | Assertions | Covers |
| --- | --- | --- |
| `pipeline/label-table.test.js` | 58 | the tier, both text forms, both bugs above, the confidence gate |
| `pipeline/staged-instant-dedup.test.js` | 18 | identity by amount + instant, richest-copy survival |
| `pipeline/cache-hygiene.test.js` | 15 | canonical provider names, Fwd normalisation, merchant tidy |
| `pipeline/direct-templates.test.js` | — | template derivation and self-proof |

## Related documents

- `effortless-transaction-logging-spec.md` — the end-to-end journey; owns the pipeline as a whole
- `bank-email-feature-review.md` — dated findings against the live project (30 Aug)
- `docs/features/direct-mailbox-read.md` — the OAuth transport
- `docs/features/bank-email-pipeline.md` — the forwarding transport
