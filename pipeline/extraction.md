# Extraction prompt + schema — v1

Designed against the two real samples collected (MB Bank transfer, Anthropic/Stripe receipt, Google Play receipt). Used once per new sender (per-sender fingerprint cache — see handoff doc Decision 4); every later email from a cached sender skips this and uses the promoted regex instead.

Model: `claude-haiku-4-5`. No caching needed — see handoff doc cost analysis. Called via Batches API where latency doesn't matter (personal Apps Script poll is real-time by design; product version can batch).

## System prompt

```
You classify and extract structured data from an email. The email may or may not represent a financial transaction (bank transfer, subscription receipt, e-commerce order, bill payment, P2P transfer). It may be in Vietnamese, English, or mixed.

If the email is NOT a transaction record (promotional, newsletter, unrelated notification), set is_transaction to false and leave all other fields null.

If it IS a transaction record, extract every field you can find. Use null for anything not present in the email — do not guess or infer values that aren't stated.

transaction_type: use p2p_transfer when the counterparty is an individual person — identified by a personal name, a phone number, or a personal account/e-wallet, with no indication of a merchant or business. Use bank_txn for other bank-initiated transactions with no clear personal counterparty (fees, interest, transfers to a business/wallet system, generic account activity). Use subscription/ecommerce_receipt/bill_payment for their respective clearly-labeled cases.

occurred_at: ISO 8601, and must include a UTC offset. If the email states one, use it. If it doesn't (most Vietnamese bank/provider emails don't), assume the timestamp is already in the sender's local time and attach that offset — for Vietnamese banks and providers this is +07:00. Never output a bare timestamp with no offset.

counterparty: copy the full counterparty string exactly as written in the email, including any account number, phone number, or identifier alongside the name — do not shorten or summarize it.

Amounts must be the raw number with no currency symbol or thousands separators. If the email states a status (success/failed/pending), extract it; otherwise null.

currency: the ISO 4217 code the amount is denominated in (VND, USD, EUR, ...), exactly as the email states it — never default to VND when the mail prints another currency. International card notices from Vietnamese banks often show BOTH a foreign transaction amount and the converted amount actually debited in VND (labelled "Số tiền quy đổi", "Số tiền ghi nợ" or similar). When both are present, amount must be the converted VND figure with currency VND, and the original foreign figure goes into fx_amount and fx_currency. When only a foreign amount is present, amount is that figure with its own currency code and fx_amount/fx_currency stay null. Never compute a conversion yourself — only report figures the mail prints.
```

> **Added 2026-09-03** (`foreign-currency-emails-spec.md`): the `currency` paragraph above and the `fx_amount`/`fx_currency` schema fields below. Fix for the USD-as-VND defect. Mirror any change here in `supabase/functions/_shared/mailbox/llm.mjs` AND `pipeline/bank-email-pipeline.gs` — both transports share the template cache.

**Corrected 2026-08-03**, after the first real (non-simulated) extraction run surfaced three gaps in the v1 prompt above: `transaction_type` was ambiguous between `bank_txn`/`p2p_transfer` with no disambiguation rule, `occurred_at` came back with no UTC offset (would silently misread as UTC downstream — a 7-hour skew on every Vietnamese-bank row), and `counterparty` got summarized down to just a name, dropping the phone number/account identifier. All three are prompt gaps, not model-specific — would have shown up with any model.

## Output schema (`output_config.format`, `json_schema`)

```json
{
  "type": "object",
  "properties": {
    "is_transaction": { "type": "boolean" },
    "transaction_type": {
      "type": ["string", "null"],
      "enum": ["bank_txn", "subscription", "ecommerce_receipt", "p2p_transfer", "bill_payment", null]
    },
    "source_provider": { "type": ["string", "null"] },
    "occurred_at": { "type": ["string", "null"], "description": "ISO 8601" },
    "amount": { "type": ["number", "null"] },
    "currency": { "type": ["string", "null"] },
    "fx_amount": { "type": ["number", "null"] },
    "fx_currency": { "type": ["string", "null"] },
    "direction": { "type": ["string", "null"], "enum": ["debit", "credit", null] },
    "counterparty": { "type": ["string", "null"] },
    "reference_number": { "type": ["string", "null"] },
    "status": { "type": ["string", "null"] },
    "account_masked": { "type": ["string", "null"] }
  },
  "required": [
    "is_transaction", "transaction_type", "source_provider", "occurred_at",
    "amount", "currency", "direction", "counterparty", "reference_number",
    "status", "account_masked"
  ],
  "additionalProperties": false
}
```

## Expected output on the two real samples

**MB Bank sample:**
```json
{
  "is_transaction": true,
  "transaction_type": "bank_txn",
  "source_provider": "MB Bank",
  "occurred_at": "2026-07-31T13:18:49+07:00",
  "amount": 25000,
  "currency": "VND",
  "direction": "debit",
  "counterparty": "MOMO_PASSIO",
  "reference_number": "26193113186167686",
  "status": "success",
  "account_masked": "3510****2001"
}
```

**MB Bank sample, corrected prompt (2026-08-03, real live email, self-transfer):**
```json
{
  "is_transaction": true,
  "transaction_type": "p2p_transfer",
  "source_provider": "MB Bank",
  "occurred_at": "2026-08-01T14:51:01+07:00",
  "amount": 2000,
  "currency": "VND",
  "direction": "debit",
  "counterparty": "NGUYEN THU TRANG - 0944684991",
  "reference_number": "26200114500246462",
  "status": "success",
  "account_masked": "3510146052001"
}
```
Contrast with the v1-prompt run on this same email (before the 2026-08-03 fix): `transaction_type: "bank_txn"`, `occurred_at: "2026-08-01T14:51:01"` (no offset), `counterparty: "NGUYEN THU TRANG"` (phone number dropped) — the exact three gaps described above, reproduced.

**Anthropic receipt sample:**
```json
{
  "is_transaction": true,
  "transaction_type": "subscription",
  "source_provider": "Anthropic",
  "occurred_at": "2026-07-18T00:00:00Z",
  "amount": 111.11,
  "currency": "USD",
  "direction": "debit",
  "counterparty": "Anthropic, PBC",
  "reference_number": "2319-8968-1789",
  "status": "success",
  "account_masked": "****4751"
}
```

## Promotion-to-regex path (per (sender, subject-template) fingerprint cache)

**Caching by sender alone is wrong** — a single sender (especially a human forwarding address, e.g. someone who forwards bank receipts but also sends unrelated personal email) can send both transaction and non-transaction email. Caching "this sender = always/never a transaction" would misclassify whichever kind wasn't seen first.

Fix: fingerprint on `(sender_address, subject_template)`, where `subject_template` is the subject with anything date-like or reference-number-like stripped out, so a *specific* subject collapses to a stable *template*:

```
normalizeSubjectTemplate(subject):
  1. strip reference/invoice-number-like substrings: /#[\w-]+/g, /\b\d{6,}\b/g
  2. strip date-like substrings: /\b\w+ \d{1,2},? \d{4}\b/g, /\b\d{1,2}[-\/]\d{1,2}[-\/]\d{2,4}\b/g
  3. collapse whitespace, trim
```

Examples:
- `"Your receipt from Anthropic, PBC #2319-8968-1789"` → `"Your receipt from Anthropic, PBC"`
- `"Your Google Play Order Receipt from Jul 24, 2026"` → `"Your Google Play Order Receipt from"`
- `"Thong bao giao dich thanh cong"` → unchanged (no dates/numbers in this bank's subject)

A sender can have multiple fingerprint rows (one per distinct kind of email they send). Lookup: fetch every `sender_fingerprints` row for the sender, find the one whose `subject_template` matches the incoming (normalized) subject. Match found → use the cached verdict/regex. No match → this is a new *kind* of email from a known sender → run the LLM classifier, then insert a new fingerprint row for that template (existing rows for that sender's other templates are untouched).

After a successful extraction, store the derived regex in that `(sender, template)` row's `extraction_regex`. Next matching email tries the stored regex first; if it fails to match (template drifted), fall back to the LLM call for that one email and re-derive the regex.

**MB Bank fast-path regex** (their table format is consistent key-value pairs — reliable to regex once seen):
```
Ngày, giờ giao dịch\s*\n+\s*([\d-]+ [\d:]+)
Số tham chiếu\s*\n+\s*(\d+)
\(VND\) ([\d,]+\.\d+)
Tình trạng\s*\n+\s*(.+)
```

**Anthropic/Stripe fast-path regex** (Stripe's receipt format is standardized across all Stripe-billed senders, not just Anthropic — worth genericizing later):
```
Receipt from .+ \$([\d.]+) Paid (\w+ \d+, \d+)
Receipt number (\S+)
```

## What the model is sent (masking removed 2026-08-25)

The subject and body go to the model **as written** — real amounts, accounts, references, phones, names and email addresses. The sender address goes too; it is the bank's identity, needed for classification.

**This was masked until 2026-08-25.** `maskForSharing()` replaced each sensitive token with a fake of identical shape and `unmaskExtraction()` swapped the real values back locally. It was verified end to end against live Gemini on the real MB Bank sample (2026-08-06) with identical extraction quality, and it was removed deliberately rather than because it stopped working.

**Consent replaced it.** Bank transactions are sensitive personal data under L91/2025, and the feature already asks separately before collecting anything (`75-consent-ui.js`, kind `bank_email`, recorded in `user_consents` per 0082). That sheet now states that a first-time bank's mail is sent to an AI service to be read, amounts and names included, and `FH_CONSENT_V` went to 4 so a v3 record — which promised the opposite — no longer counts as agreement. **If you change what is sent, change the sheet and bump the version in the same commit.**

What did not change: a known `(sender, subject_template)` with a stored template is parsed locally with no model involved at all, which is most volume permanently, and is the half of the claim the consent copy still makes. The app's CSV redactor (`43-redact-for-sharing.js`) is a different feature on a different surface and still masks.

## Safety ceiling on LLM calls (testing)

Two caps, tracked via Apps Script `PropertiesService` — no DB round-trip needed. Both count only actual LLM calls (new `(sender, subject_template)` pairs) — cached/regex-path emails never count against them.

- **Per-run cap** — `MAX_NEW_CLASSIFICATIONS_PER_RUN = 10`. If a single 1-minute run would trigger more than 10 new LLM calls, stop after 10 and leave the rest labeled `txn/inbox` for next run. Protects against a burst (e.g. a filter misfire pulling in a large batch of threads at once) without permanently blocking anything — the remainder just waits one more run.
- **Daily hard ceiling** — `MAX_NEW_CLASSIFICATIONS_PER_DAY = 50`, tracked as script property `llmCallCount:<YYYY-MM-DD>`. Once hit, remaining new-template messages stay unprocessed (`txn/inbox`) until the date rolls over and the counter resets. Nothing is lost — `gmail_message_id` dedupe still applies whenever they're eventually processed.

Both numbers should start low while testing and only be raised once the pipeline is trusted not to misfire. Not a rate-based throttle — a hard stop, since the goal is testing safety, not smoothing traffic.

## Batching — deliberately deferred

Batches API (50% off) was considered but dropped for now: at personal-use volume the savings are pennies, and the ~1hr latency trades away real-time feedback while still testing. Revisit only if this becomes a multi-tenant product where volume actually makes the discount matter more than the delay.

## Open item

Neither real sample so far needed the LLM to resolve ambiguity — both are cleanly structured. The LLM-first approach earns its keep once we see messier formats (e-commerce receipts with line items, bill payments with due dates vs paid dates). Revisit regex-vs-LLM balance once those samples exist.
