"""Reading a mail no stored spec could read, and proposing a spec so the next
one off that template needs no model at all.

The only stage that can read an unfamiliar template — there is no regex
fallback behind it (see the package docstring for why one was removed). So a
new bank costs API calls until a rule for it sticks, and nothing after that.

Two calls, deliberately not one:

* `extract` reads this mail. Its answer is what the pipeline needs *now*.
* `induce` looks at the same mail plus that answer and says which label
  anchors which field. Its answer is what gets stored and reused.

Merging them makes the model generalise and read at the same time, and both
answers get worse.

Both calls temporarily receive the normalized email text as written. This is
an explicit accuracy trade-off: amount magnitude, currency notation, account
shape and surrounding values help distinguish a transaction amount from a
balance, fee, cashback or reference. Callers must obtain consent before
enabling this fallback and must never log either prompt or response.

Nothing here raises. A model that is slow, rate-limited, misconfigured or
simply wrong must degrade to "could not read this mail", which the pipeline
already handles: the alternative is Pub/Sub redelivering a mail that will fail
the same way every time.
"""

import logging
import os
import re

from pydantic import BaseModel, Field

log = logging.getLogger(__name__)

# Flash: this is short-context extraction from a page of text, run a few dozen
# times over the life of the system. The larger models buy reasoning depth that
# reading a labelled table does not need.
MODEL = os.environ.get("GEMINI_MODEL", "gemini-3.5-flash")

# Cloud Functions gives the whole invocation 60s and Pub/Sub redelivers if it
# is exceeded. Two calls have to fit inside that with room for the database.
TIMEOUT_SECONDS = 20

# Bodies run to marketing footers and legal boilerplate. The transaction table
# is always near the top, and sending the rest costs tokens and latency without
# adding signal.
MAX_BODY_CHARS = 6_000

_DIGIT = re.compile(r"\d")


class Answer(BaseModel):
    """Structured extraction returned by Gemini."""

    amount: int | None = Field(
        default=None,
        description="Exact transaction amount in base units, without grouping "
        "separators or sign. Never a balance, fee, limit, cashback, reward, "
        "exchange rate, reference or account number.",
    )
    balance: int | None = Field(
        default=None,
        description="Exact account balance after the transaction in base units, "
        "or null when the email does not state one.",
    )
    direction: str | None = Field(
        default=None,
        description="'credit' if money entered the account, 'debit' if it left. "
        "Null if the mail does not make this clear.",
    )
    merchant: str | None = Field(
        default=None,
        description="Who was paid, or who sent the money. Copy it as written, "
        "keeping Vietnamese diacritics.",
    )
    occurred_at: str | None = Field(
        default=None,
        description="When the transaction happened, as the email prints it, in "
        "YYYY-MM-DD HH:MM:SS. Vietnamese mail writes dates day-first, so "
        "21/08/2026 is 2026-08-21. Null unless the email states a time; never "
        "the time the email was sent.",
    )
    reference: str | None = Field(
        default=None,
        description="The bank's own id for this transaction (mã giao dịch, số "
        "tham chiếu, trace). One unbroken token, copied exactly.",
    )
    account_tail: str | None = Field(
        default=None,
        description="The LAST FOUR DIGITS of the account or card this moved "
        "through. Four digits and nothing else, even if the email prints the "
        "number in full.",
    )
    description: str | None = Field(
        default=None,
        description="The transfer note or memo (nội dung, diễn giải), if the "
        "email prints one separately from the merchant.",
    )
    channel: str | None = Field(
        default=None,
        description="How it was paid, if stated: 'QR', 'POS', 'ATM', "
        "'chuyển khoản', 'internet banking'. Null if the email does not say.",
    )
    currency: str | None = Field(default=None, description="ISO 4217 currency of amount.")
    fx_amount: int | None = Field(
        default=None, description="Original foreign amount when amount is a converted VND value."
    )
    fx_currency: str | None = Field(default=None, description="ISO currency of fx_amount.")
    transaction_type: str | None = Field(
        default=None, description="Explicit kind such as transfer, purchase, withdrawal, or refund."
    )
    status: str | None = Field(
        default=None, description="completed, failed, declined, cancelled, or pending."
    )
    account_kind: str | None = Field(
        default=None, description="credit_card, deposit, ewallet, or null; never infer debt."
    )
    flow: str | None = Field(
        default=None, description="transfer only when explicitly a transfer; otherwise null."
    )

    def to_reading(self) -> "Reading":
        return Reading(
            amount=self.amount,
            balance=self.balance,
            direction=self.direction,
            merchant=self.merchant,
            occurred_at=self.occurred_at,
            reference=self.reference,
            account_tail=self.account_tail,
            description=self.description,
            channel=self.channel,
            currency=self.currency,
            fx_amount=self.fx_amount,
            fx_currency=self.fx_currency,
            transaction_type=self.transaction_type,
            status=self.status,
            account_kind=self.account_kind,
            flow=self.flow,
        )


class Reading(BaseModel):
    """What the model read off one mail, normalized for the parser."""

    amount: int | None = None
    balance: int | None = None
    direction: str | None = None
    merchant: str | None = None
    occurred_at: str | None = None
    reference: str | None = None
    account_tail: str | None = None
    description: str | None = None
    channel: str | None = None
    currency: str | None = None
    fx_amount: int | None = None
    fx_currency: str | None = None
    transaction_type: str | None = None
    status: str | None = None
    account_kind: str | None = None
    flow: str | None = None


class ProposedRule(BaseModel):
    """Where one field sits in the template."""

    field: str = Field(
        description="One of: amount, balance, direction, merchant, occurred_at, "
        "reference, account_tail, description, channel"
    )
    label: str = Field(
        description="The exact label text printed immediately before this field's "
        "value, without the colon. Copy it verbatim from the mail, keeping "
        "Vietnamese diacritics. For type 'fixed', this is the constant value "
        "itself: 'credit' or 'debit'."
    )
    type: str = Field(
        description="'money' for an amount, 'sign' to read direction from a +/- "
        "printed next to the figure, 'fixed' when direction or channel is "
        "implied by the kind of notice rather than printed, 'date' for a "
        "timestamp, 'token' for an unbroken id like a reference or an account "
        "tail, 'text' for free text."
    )


class ProposedSpec(BaseModel):
    """The rules the model proposes for reusing this template."""

    rules: list[ProposedRule] = Field(default_factory=list)
    match: list[str] = Field(
        default_factory=list,
        description="Short phrases that identify THIS kind of notice and would "
        "not appear in a different kind from the same sender, e.g. 'Phieu nhan "
        "tien'. Copy them verbatim from the email. Omit rather than guess: a "
        "phrase that varies per transaction would stop the rule ever matching.",
    )


class ProposedCategory(BaseModel):
    """Which kind of spending a merchant represents."""

    category: str = Field(
        description="Exactly one of the categories listed in the prompt, copied "
        "verbatim. Use 'thu khác' if money is coming in and nothing better fits, "
        "and 'mua sắm' if it is going out and nothing better fits."
    )


_CATEGORISE_PROMPT = """A Vietnamese household is tracking its cash flow. \
Which category does this merchant belong to?

MERCHANT: {merchant}
MONEY IS: {direction}

Answer with exactly one of these, copied verbatim:
{categories}

Rules:
- 'chuyển nội bộ' is for moving money between the household's own accounts and \
wallets, not for paying another person.
- If money is coming in, only 'lương', 'thu khác' or 'chuyển nội bộ' can be \
right.
- The merchant name is often abbreviated or written without diacritics. Read \
it as a Vietnamese reader would."""


_EXTRACT_PROMPT = """Extract one completed financial transaction from this email.
The sender is a Vietnamese bank or e-wallet. Return only facts explicitly stated
by the transaction notice. Use null for every absent or ambiguous field.

Accuracy rules, in priority order:
- amount is the money moved by THIS transaction. Prefer a value beside labels
  such as "Số tiền giao dịch", "Transaction Amount", "Tổng tiền" or "Giá trị".
  Never use account balance, available balance, credit limit, outstanding debt,
  fee, promotion, cashback, reward points, exchange rate, account number,
  reference number, OTP, phone number or a total from footer prose.
- Return amount and balance as non-negative integers in the currency's base
  unit, without punctuation or sign. Vietnamese grouping examples:
  "750.000 VND" = 750000; "2.000,00 VND" = 2000. For VND, decimals after a
  grouped amount are formatting, not extra hundreds. Do not convert currencies.
- balance is only the account balance AFTER the transaction, usually beside
  "Số dư" or "Available balance". If uncertain whether a figure is amount or
  balance, leave the uncertain field null rather than copying the same figure.
- direction is 'credit' when money entered the account (ghi có, nhận tiền,
  tiền vào, +) and 'debit' when it left (ghi nợ, thanh toán, chuyển tiền,
  trừ tiền, -). The sign belongs to direction; amount remains non-negative.
- A failed, declined, cancelled or pending attempt is not a completed
  transaction. Set status to the explicit state and do not present it as completed.
- currency is the ISO code printed beside amount. Default to VND only when no
  other currency is stated. Never silently label USD/EUR/another currency VND.
- If the notice prints both an original foreign amount and its converted VND
  amount, amount/currency are the VND pair and fx_amount/fx_currency are the
  original pair. For a foreign-only notice, put it in amount/currency and leave
  both fx fields null. Never calculate a conversion.
- transaction_type is a short explicit semantic kind such as transfer,
  purchase, withdrawal, fee or refund. account_kind may only be credit_card,
  deposit, ewallet or null. Do not infer debt from a debit direction.
- Set flow to transfer only when the notice explicitly describes a transfer.
  Otherwise leave it null; code reconciles income/expense from direction.
- occurred_at is the time the TRANSACTION happened, not the email time. Dates
  are day-first: 21/08/2026 is 21 August. Return `YYYY-MM-DD HH:MM:SS`; use
  00:00:00 only when the email states a date but no time. Never use card expiry,
  booking time or a date from footer prose.
- account_tail is exactly the final four digits of the account or card that
  moved. Return null when fewer than four digits are visible.
- merchant is WHO; description is WHAT FOR. If only one is printed, populate
  only that field instead of copying it into both.
- Copy merchant, description and reference exactly. Do not translate,
  paraphrase, shorten names or remove Vietnamese diacritics.
- channel is only a rail explicitly stated by the email, such as QR, POS, ATM,
  card, transfer or internet banking.
- Do not infer facts from general banking knowledge or calculate missing
  values. When two candidates remain plausible, return null.

EMAIL:
{body}"""

_INDUCE_PROMPT = """This email is one instance of a recurring template from a \
Vietnamese bank. Do not extract it again. Identify stable labels and template
signals that can locate the already-confirmed fields on a future email of the
same shape.

For each field, give the exact label text printed immediately before that \
field's value. A later email off this same template will be parsed by finding \
that label and reading what follows, so the label must be text the bank prints \
every time, not text that varies per transaction.

Rules:
- Copy labels verbatim, with Vietnamese diacritics, without the trailing colon.
- A label must contain no customer name, account number, amount, date, time,
  reference, merchant or any other value that changes between transactions.
- Use type 'money' for amount and balance, 'date' for occurred_at, 'token' for \
reference and account_tail, 'text' for merchant and description.
- Give a label only for the fields this email actually prints. Most emails \
print three or four of them; none print all.
- For direction, pick ONE of two forms. If a + or - is printed next to the \
figure, use type 'sign' with the label of that figure. Otherwise, if this kind \
of notice always means the same thing (a "Báo Có" notice is always money in, a \
"Báo Nợ" notice always money out), use type 'fixed' with label 'credit' or \
'debit'. If neither is true, omit direction.
- Omit any field whose label you cannot find. A wrong label is worse than a \
missing one.
- For 'match', give the short phrases that say what KIND of notice this is — \
a purchase, a receipt, a transfer. One sender sends several kinds, and two of \
them can print the same labels while meaning opposite things, so this is what \
keeps this rule off the others. Use wording the sender prints on every notice \
of this kind and on no other; never a name, an amount, a date or a reference \
number, which change every time. Omit it if nothing in the email distinguishes \
the kind.
- These fields were successfully read from this email, so each has a row \
somewhere in it: {reading}

EMAIL:
{body}"""


def enabled() -> bool:
    """Whether a key is configured. Off means the pipeline skips this stage."""
    return bool(os.environ.get("GOOGLE_API_KEY") or os.environ.get("GEMINI_API_KEY"))


def extract(text: str) -> Reading | None:
    """Read one mail. None when the model could not be reached or answered
    unusably — the caller treats that as an unreadable mail.

    The normalized body is sent as written. This fallback is consent-gated by
    deployment policy; this module never logs the prompt or model response.
    """
    answer = _ask(_EXTRACT_PROMPT.format(body=_clip(text)), Answer)
    if answer is None:
        return None
    return answer.to_reading()


def induce(text: str, reading: Reading) -> dict | None:
    """Propose a reusable spec for this template, as a spec.Spec-shaped dict.

    Returns None when nothing usable came back.

    Raw normalized text lets the model distinguish stable labels from dynamic
    values and lets the replay gate test the proposal against exactly the same
    representation from which it was learned.
    """
    prompt = _INDUCE_PROMPT.format(
        body=_clip(text),
        reading=_shape_of(reading),
    )
    proposed = _ask(prompt, ProposedSpec)
    if proposed is None:
        return None

    spec: dict = {}
    for rule in proposed.rules:
        label = rule.label.strip().rstrip(":").strip()
        if label:
            spec[rule.field] = {"label": label, "type": rule.type}

    # Dynamic values make a match phrase inert on the next mail.
    phrases = [p.strip() for p in proposed.match if p and p.strip() and not _DIGIT.search(p)]
    if phrases:
        # Only when the model offered something. An empty list would load as
        # an invalid spec, and a spec with no phrases is the pre-existing
        # "applies to any mail from this sender" behaviour anyway.
        spec["match"] = phrases
    # Shape only. Whether it is a *valid* spec is spec.Spec.from_dict's call,
    # and whether it is a *correct* one is validate.check's.
    return spec or None


def categorise(merchant: str, direction: str | None) -> str | None:
    """Which category a merchant belongs to, or None if the model could not say.

    Only the merchant name and the direction are sent. The amount, the balance
    and the mail body are not: a category depends on who was paid, and nothing
    else here needs to leave the machine to work that out.
    """
    from . import category  # noqa: PLC0415 - avoids a cycle at import time

    prompt = _CATEGORISE_PROMPT.format(
        merchant=merchant,
        direction="coming in" if direction == "credit" else "going out",
        categories="\n".join(f"- {name}" for name in category.CATEGORIES),
    )
    answer = _ask(prompt, ProposedCategory)
    if answer is None:
        return None

    # A model that answered with something off the list has not answered. The
    # transaction is recorded uncategorised rather than filed under a label
    # nothing else in the app knows about.
    chosen = answer.category.strip().lower()
    return chosen if chosen in category.CATEGORIES else None


def _shape_of(reading: Reading) -> str:
    """Which fields were found, without what they were found to be.

    `induce` is told which fields `extract` confirmed so it can identify their
    labels without copying the values into its reusable rule.

    Derived from the model's own fields rather than a written-out list. The
    list version was written when a reading had four fields, and silently kept
    saying four after `occurred_at`, `reference`, `account_tail`, `description`
    and `channel` were added — so `induce` was never told a mail had a date in
    it, never proposed a label for one, and every learned spec dropped the
    timestamp on every mail after the first.
    """
    found = [name for name in Reading.model_fields if getattr(reading, name) is not None]
    return ", ".join(found) if found else "none"


def _ask[Schema: BaseModel](prompt: str, schema: type[Schema]) -> Schema | None:
    """One structured call, answering in whichever schema it is handed.

    Returns None on any failure, having logged it."""
    try:
        from google import genai
    except ImportError:
        log.error("google-genai is not installed; LLM fallback unavailable")
        return None

    try:
        client = genai.Client()
        interaction = client.interactions.create(
            model=MODEL,
            input=prompt,
            # The mime type goes INSIDE response_format. Passing
            # response_mime_type alongside it is rejected with
            # "responseFormat must be set when responseMimeType is set" —
            # confusing, but the two are not meant to be combined.
            response_format={
                "type": "text",
                "mime_type": "application/json",
                "schema": schema.model_json_schema(),
            },
            timeout=TIMEOUT_SECONDS,
        )
        # `create` is typed as returning either an Interaction or a Stream; we
        # never pass stream=True, so anything else is the SDK behaving in a way
        # this code has no answer for.
        answer = getattr(interaction, "output_text", None)
        if not isinstance(answer, str):
            log.warning("%s call returned no text: %r", schema.__name__, type(interaction))
            return None
        return schema.model_validate_json(answer)
    except Exception as exc:  # noqa: BLE001 - see module docstring
        # Broad on purpose: transport errors, quota, schema drift and malformed
        # JSON all mean the same thing here, and none of them may take down a
        # delivery that the rest of the pipeline can still report on.
        log.warning("%s call failed: %s: %s", schema.__name__, type(exc).__name__, exc)
        return None


# What a transaction row looks like from a distance: a figure beside a currency
# marker, a printed date, a clock time. Counted, not read — this only has to
# find WHERE the transaction is, and `spec`/`llm` do the reading.
_SIGNALS = (
    re.compile(r"\d[\d.,\s]*\s*(?:VN[DĐ]|[đĐ₫])|(?:VN[DĐ]|[₫])\s*\d", re.IGNORECASE),
    re.compile(r"\d{1,2}[/\-.]\d{1,2}[/\-.]\d{4}"),
    re.compile(r"\d{1,2}:\d{2}"),
)

# How wide a slice to score at a time when hunting for the transaction. Small
# enough that a receipt does not share a bucket with the footer, large enough
# that its rows are not split across several.
_PROBE = 500


def _clip(text: str) -> str:
    """Trim a body to the part that carries the transaction.

    This used to take the first `MAX_BODY_CHARS` characters, on the reasoning
    that the transaction table is always near the top. Measured against real
    mail that is simply false: in four saved receipts the amount sat at ~92% of
    the body, behind navigation, a forwarded header, an AI summary and a
    signature block. Every one of them lost its amount to the clip — the mails
    parsed at all only because the stored-spec stage does not clip.

    So the window is chosen rather than assumed. The body is scored in slices
    by how many transaction-shaped things each contains, and the window is
    centred on the densest run. Nothing here is bank-specific: a template this
    code has never seen still puts its figures, dates and times together, and
    its navigation and legal boilerplate do not.

    A body already inside the limit is returned whole, so the common case
    costs one length check.
    """
    if len(text) <= MAX_BODY_CHARS:
        return text

    slices = [text[at : at + _PROBE] for at in range(0, len(text), _PROBE)]
    scores = [sum(len(sig.findall(chunk)) for sig in _SIGNALS) for chunk in slices]

    # The densest run of slices that fits the budget, by a running sum over a
    # window of that width.
    width = max(1, MAX_BODY_CHARS // _PROBE)
    best_at, best_score = 0, -1
    for start in range(max(1, len(scores) - width + 1)):
        score = sum(scores[start : start + width])
        if score > best_score:
            best_at, best_score = start, score

    if best_score <= 0:
        # Nothing anywhere looks like a transaction. The head is as good a
        # guess as any, and is what every caller used to get.
        return text[:MAX_BODY_CHARS]

    # Centre the budget on the dense run rather than starting at it. The labels
    # that name the fields sit just before the figures, and the last row of a
    # table sits just after, so a window flush against either edge cuts one of
    # them off.
    dense_start = best_at * _PROBE
    dense_end = min(len(text), (best_at + width) * _PROBE)
    slack = MAX_BODY_CHARS - (dense_end - dense_start)
    start = max(0, dense_start - slack // 2)
    return text[start : start + MAX_BODY_CHARS]
