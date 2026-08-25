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

BOTH CALLS ARE SENT THE MAIL AS WRITTEN. This reversed a deliberate earlier
decision, and the reasoning is worth keeping because the old design was not
wrong so much as differently priced.

Masking replaced every figure with a `[MONEY_n]` name and asked the model which
name was the amount. It worked, and it cost accuracy in a way that is hard to
see from inside: a model that cannot read `750.000` cannot use the magnitude of
a figure as evidence. Magnitude is real evidence — a balance is usually larger
than the amount that moved, a four-digit figure beside a six-digit one in a
Vietnamese notice is a fee rather than a total, and `[MONEY_1]` beside
`[MONEY_2]` says none of that. The same masking also fed `induce`, so the spec
it proposed was derived from a body the next mail will not look like.

What replaced it is consent, not a weaker promise: the mail is sent to the model
as the bank wrote it, and the person is asked, in those terms, before any of it
is collected. That is a product decision with a record behind it
(`user_consents`, kind `bank_email`), which is a stronger basis than a masker
that was silently degrading every reading it protected.

The withholding that remains is downstream and unchanged: what the model returns
is sealed to the family's key before it is stored, so the model sees the mail
and the database never sees the reading.

Nothing here raises. A model that is slow, rate-limited, misconfigured or
simply wrong must degrade to "could not read this mail", which the pipeline
already handles: the alternative is Pub/Sub redelivering a mail that will fail
the same way every time.
"""

import logging
import os
import re

from pydantic import BaseModel, Field, field_validator

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
    """What the model reported.

    Figures come back as numbers now, read off the mail as the bank printed it.
    """

    amount: int | None = Field(
        default=None,
        description="The amount of THIS transaction, as a whole number of dong "
        "with no currency symbol and no thousands separators: 750000, not "
        "750.000 VND. Never the account balance.",
    )
    balance: int | None = Field(
        default=None,
        description="The account balance after the transaction, same format, "
        "if the mail states one.",
    )

    @field_validator("amount", "balance", mode="before")
    @classmethod
    def _as_dong(cls, v: object) -> object:
        """Accept the separators a Vietnamese notice prints, refuse everything else.

        The prompt asks for bare digits and the model mostly obliges, but
        "750.000" is what the mail itself says and it comes back that way often
        enough to matter. Stripping `.`, `,` and spaces is safe HERE and only
        here: Vietnamese uses `.` for thousands, and these two fields are whole
        dong, so there is no decimal meaning to lose.

        Anything still not all-digits afterwards becomes None rather than an
        error. A field that cannot be read must leave the reading incomplete —
        which the pipeline already treats as an unreadable mail and logs — never
        raise, because the caller's only recovery is a redelivery that will fail
        identically. A leftover `[MONEY_1]` from a stale prompt lands here too,
        and is correctly refused rather than stored as a number.
        """
        if v is None or isinstance(v, int):
            return v
        if not isinstance(v, str):
            return None
        cleaned = v.strip().replace(".", "").replace(",", "").replace(" ", "")
        if cleaned.startswith("+") or cleaned.startswith("-"):
            cleaned = cleaned[1:]
        return int(cleaned) if cleaned.isdigit() else None
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

    def to_reading(self) -> "Reading":
        """The same fields, as the pipeline's own type.

        A straight copy now that the figures arrive as figures. The validator
        above has already turned anything unreadable into None, so this cannot
        put a non-number into a reading.
        """
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

Report what it says. Rules:
- Answer amount and balance as whole numbers of dong, digits only, with no \
currency symbol and no thousands separators: write 750000, not '750.000 VND'. \
Report the figure the email prints; never round it or compute one.
- The transaction amount and the account balance are different figures and are \
often in the same table. Never report the balance as the amount. The balance is \
usually the larger of the two, and is the one labelled số dư.
- direction is 'credit' when money entered the account (ghi có, nhận tiền, \
tiền vào, +) and 'debit' when it left (ghi nợ, thanh toán, chuyển tiền, \
trừ tiền, -). A + or - printed next to the figure still tells you this.
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
Vietnamese bank. You are not being asked to read its values, only to say where \
they sit, so that a later email off this same template can be read without a \
model.

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

    The body goes as the bank wrote it. See the module docstring for why that
    reversed the earlier masking design, and what carries the promise instead.
    """
    answer = _ask(_EXTRACT_PROMPT.format(body=_clip(text)), Answer)
    if answer is None:
        return None
    return answer.to_reading()


def induce(text: str, reading: Reading) -> dict | None:
    """Propose a reusable spec for this template, as a spec.Spec-shaped dict.

    Returns None when nothing usable came back.

    Sent the same body `extract` gets, unaltered. Two earlier versions of this
    withheld part of it and both cost more than they saved: blanking every digit
    left `luc ##:##:## ##/##/####`, which gives the model no way to tell a
    timestamp from a reference, so it proposed labels for neither and every
    learned spec silently dropped `occurred_at` and `reference` after the first
    mail; masking the figures left the same hole one level up, because a label
    is anchored by what sits NEXT to it and `[MONEY_1]` does not sit anywhere
    the next mail will.

    This call derives a rule that then runs on real mail with no model behind
    it. Deriving it from a body that differs from the real one is the one input
    change that produces a confidently wrong spec rather than no spec.
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
    """Which fields were found, and what they were found to be.

    `induce` is told what `extract` read so it can tell the rows apart. It used
    to be told only WHICH fields existed, because sending the values would have
    put back what masking the body had just taken out. That reason is gone — the
    body now carries the values — and withholding them here only makes the job
    harder: a label is located by finding the value it sits beside, and
    "amount, balance" says which rows to look for while the figures say where.

    Derived from the model's own fields rather than a written-out list. The
    list version was written when a reading had four fields, and silently kept
    saying four after `occurred_at`, `reference`, `account_tail`, `description`
    and `channel` were added — so `induce` was never told a mail had a date in
    it, never proposed a label for one, and every learned spec dropped the
    timestamp on every mail after the first.
    """
    found = [
        f"{name}={getattr(reading, name)}"
        for name in Reading.model_fields
        if getattr(reading, name) is not None
    ]
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
