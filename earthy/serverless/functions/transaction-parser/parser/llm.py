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
answers get worse. Splitting them also means `induce` runs on a redacted copy
— it only needs to know where the fields sit, never what they say.

Neither call is sent a figure. `extract` gets a body whose amounts have been
replaced by `[MONEY_n]` names (see `masking`) and answers in those names,
which are exchanged for numbers here; `induce` gets a copy with every digit
blanked. So a family's balances and transaction amounts stay on the machine
that received the mail, and the model still gets the labels, the layout and
the signs that are what it is actually being asked about.

Nothing here raises. A model that is slow, rate-limited, misconfigured or
simply wrong must degrade to "could not read this mail", which the pipeline
already handles: the alternative is Pub/Sub redelivering a mail that will fail
the same way every time.
"""

import logging
import os
import re

from pydantic import BaseModel, Field

from . import masking

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
    """What the model reported, in the terms it was given.

    Figures come back as the `[MONEY_n]` names the body carried, never as
    numbers: the model was never shown a number to report. `to_reading`
    exchanges the names for the figures, on this side of the network.
    """

    amount: str | None = Field(
        default=None,
        description="The [MONEY_n] placeholder marking the amount of THIS "
        "transaction. Copy the placeholder exactly, e.g. '[MONEY_1]'. Never "
        "the account balance, and never a number of your own.",
    )
    balance: str | None = Field(
        default=None,
        description="The [MONEY_n] placeholder marking the account balance "
        "after the transaction, if the mail states one.",
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

    def to_reading(self, table: dict[str, object]) -> "Reading":
        """Exchange the placeholders for the figures they stand for.

        A placeholder this masker never issued reads as None rather than
        raising: a model that invented one has said nothing, and the pipeline
        already handles a reading with no amount.
        """
        return Reading(
            amount=masking.restore_int(self.amount, table),
            balance=masking.restore_int(self.balance, table),
            direction=self.direction,
            merchant=self.merchant,
            occurred_at=self.occurred_at,
            reference=self.reference,
            account_tail=self.account_tail,
            description=self.description,
            channel=self.channel,
        )


class Reading(BaseModel):
    """What the model read off one mail, in figures.

    Built only by `Answer.to_reading`, so an amount here is always one that
    was in the mail: the model cannot put a number into this type, because it
    never answers in this type.
    """

    amount: int | None = None
    balance: int | None = None
    direction: str | None = None
    merchant: str | None = None
    occurred_at: str | None = None
    reference: str | None = None
    account_tail: str | None = None
    description: str | None = None
    channel: str | None = None


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


_EXTRACT_PROMPT = """You are reading one transaction notification email from a \
Vietnamese bank or e-wallet.

Sensitive values have been replaced by placeholders: every monetary figure by \
one like [MONEY_1], every email address by one like [EMAIL_1]. They are \
withheld deliberately; you are being asked which placeholder is which, not \
what any of them is.

Report what it says. Rules:
- For amount and balance, answer with the placeholder exactly as printed, \
e.g. '[MONEY_1]'. Never answer with a number: you have not been shown one, so \
any number would be a guess.
- The transaction amount and the account balance are different figures and are \
often in the same table. They carry different placeholders. Never report the \
balance's placeholder as the amount.
- direction is 'credit' when money entered the account (ghi có, nhận tiền, \
tiền vào, +) and 'debit' when it left (ghi nợ, thanh toán, chuyển tiền, \
trừ tiền, -). A + or - printed next to a placeholder still tells you this.
- occurred_at is the time the TRANSACTION happened, which the email states; it \
is not the time the email was sent. Dates are day-first: 21/08/2026 is the \
21st of August.
- account_tail is four digits. If the email prints the whole account number, \
report only its last four.
- merchant is WHO, description is WHAT FOR. If the email prints only one of \
them, report that one and leave the other null rather than copying it twice.
- If the mail does not state something, report null for it. Do not guess.

EMAIL:
{body}"""

_INDUCE_PROMPT = """This email is one instance of a recurring template from a \
Vietnamese bank. Its amounts and email addresses have been replaced with \
placeholders like [MONEY_1] — you are not being asked to read values, only to \
say where they sit.

For each field, give the exact label text printed immediately before that \
field's value. A later email off this same template will be parsed by finding \
that label and reading what follows, so the label must be text the bank prints \
every time, not text that varies per transaction.

Rules:
- Copy labels verbatim, with Vietnamese diacritics, without the trailing colon.
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

    The figures never leave: the body is masked first, the model answers in
    placeholders, and the exchange back to numbers happens here against a
    table that was never sent.
    """
    masked, table = masking.mask(_clip(text))
    answer = _ask(_EXTRACT_PROMPT.format(body=masked), Answer)
    if answer is None:
        return None
    return answer.to_reading(table)


def induce(text: str, reading: Reading) -> dict | None:
    """Propose a reusable spec for this template, as a spec.Spec-shaped dict.

    Returns None when nothing usable came back.

    Sent the same masked copy `extract` gets, not a copy with every digit
    blanked. Blanking them was the original design and it cost more than it
    saved: a body reading `luc ##:##:## ##/##/####` gives the model no way to
    tell a timestamp from a reference, so it proposed labels for neither and
    the learned spec silently dropped `occurred_at` and `reference` on every
    mail after the first.

    Masking still withholds what matters. The figures and addresses are
    placeholders; a date and a transaction id are neither, and they are what
    this call has to recognise to do its job.
    """
    masked, _ = masking.mask(_clip(text))
    prompt = _INDUCE_PROMPT.format(
        body=masked,
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

    # Dropped rather than kept: `induce` reads a body whose digits are all `#`,
    # so a phrase containing one was copied from the redaction and would never
    # match a real mail. Silently storing it would make the spec inert.
    phrases = [p.strip() for p in proposed.match if p and p.strip() and "#" not in p]
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


def redact(text: str) -> str:
    """Every digit replaced by #, so a body can be sent for its shape without
    its values. Labels and layout survive; amounts, account numbers, dates and
    reference numbers do not."""
    return _DIGIT.sub("#", text)


def _shape_of(reading: Reading) -> str:
    """Which fields were found, without what they were found to be.

    `induce` is told what `extract` read so it can tell the rows apart. Which
    rows exist is all it needs: sending the figures would put back what
    masking the body just took out.

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
            log.warning("%s call returned no text: %r",
                        schema.__name__, type(interaction))
            return None
        return schema.model_validate_json(answer)
    except Exception as exc:  # noqa: BLE001 - see module docstring
        # Broad on purpose: transport errors, quota, schema drift and malformed
        # JSON all mean the same thing here, and none of them may take down a
        # delivery that the rest of the pipeline can still report on.
        log.warning("%s call failed: %s: %s",
                    schema.__name__, type(exc).__name__, exc)
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
