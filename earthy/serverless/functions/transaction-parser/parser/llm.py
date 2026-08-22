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
— it only needs to know where the fields sit, never what they say — so the
figures in a family's mail are sent once, for the reading, and not again for
the caching.

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


class Reading(BaseModel):
    """What the model read off one mail."""

    amount: int | None = Field(
        default=None,
        description="Transaction amount in VND, digits only, no separators. "
        "The amount of THIS transaction, never the account balance.",
    )
    balance: int | None = Field(
        default=None, description="Account balance after the transaction, in VND, if stated."
    )
    direction: str | None = Field(
        default=None,
        description="'credit' if money entered the account, 'debit' if it left. "
        "Null if the mail does not make this clear.",
    )
    merchant: str | None = Field(
        default=None,
        description="Who was paid, or who sent the money, or the transfer note. "
        "Copy it as written, keeping Vietnamese diacritics.",
    )


class ProposedRule(BaseModel):
    """Where one field sits in the template."""

    field: str = Field(
        description="One of: amount, balance, direction, merchant")
    label: str = Field(
        description="The exact label text printed immediately before this field's "
        "value, without the colon. Copy it verbatim from the mail, keeping "
        "Vietnamese diacritics. For type 'fixed', this is the constant value "
        "itself: 'credit' or 'debit'."
    )
    type: str = Field(
        description="'money' for an amount, 'sign' to read direction from a +/- "
        "printed next to the figure, 'fixed' when direction is implied by the "
        "kind of notice rather than printed, 'text' for free text."
    )


class ProposedSpec(BaseModel):
    """The rules the model proposes for reusing this template."""

    rules: list[ProposedRule] = Field(default_factory=list)


_EXTRACT_PROMPT = """You are reading one transaction notification email from a \
Vietnamese bank or e-wallet.

Report what it says. Rules:
- Amounts are in VND and printed with . or , as a thousands separator. Report \
digits only: 1.234.567 is 1234567.
- The transaction amount and the account balance are different figures and are \
often in the same table. Never report the balance as the amount.
- direction is 'credit' when money entered the account (ghi có, nhận tiền, \
tiền vào, +) and 'debit' when it left (ghi nợ, thanh toán, chuyển tiền, \
trừ tiền, -).
- If the mail does not state something, report null for it. Do not guess, and \
do not calculate a figure the mail does not print.

EMAIL:
{body}"""

_INDUCE_PROMPT = """This email is one instance of a recurring template from a \
Vietnamese bank. Its digits have been replaced with # — you are not being \
asked to read values, only to say where they sit.

For each field, give the exact label text printed immediately before that \
field's value. A later email off this same template will be parsed by finding \
that label and reading what follows, so the label must be text the bank prints \
every time, not text that varies per transaction.

Rules:
- Copy labels verbatim, with Vietnamese diacritics, without the trailing colon.
- Use type 'money' for amount and balance, 'text' for merchant.
- For direction, pick ONE of two forms. If a + or - is printed next to the \
figure, use type 'sign' with the label of that figure. Otherwise, if this kind \
of notice always means the same thing (a "Báo Có" notice is always money in, a \
"Báo Nợ" notice always money out), use type 'fixed' with label 'credit' or \
'debit'. If neither is true, omit direction.
- Omit any field whose label you cannot find. A wrong label is worse than a \
missing one.
- These fields were read from this email, as a guide to which row is which: \
{reading}

EMAIL:
{body}"""


def enabled() -> bool:
    """Whether a key is configured. Off means the pipeline skips this stage."""
    return bool(os.environ.get("GOOGLE_API_KEY") or os.environ.get("GEMINI_API_KEY"))


def extract(text: str) -> Reading | None:
    """Read one mail. None when the model could not be reached or answered
    unusably — the caller treats that as an unreadable mail."""
    return _ask(_EXTRACT_PROMPT.format(body=_clip(text)), Reading)


def induce(text: str, reading: Reading) -> dict | None:
    """Propose a reusable spec for this template, as a spec.Spec-shaped dict.

    Returns None when nothing usable came back. The redaction is not a
    formality: this call is sent a copy with every digit blanked, so the
    figures reach the model once, in `extract`, and not a second time for the
    sake of the cache.
    """
    prompt = _INDUCE_PROMPT.format(
        body=redact(_clip(text)),
        reading=reading.model_dump_json(exclude_none=True),
    )
    proposed = _ask(prompt, ProposedSpec)
    if proposed is None:
        return None

    spec: dict[str, dict[str, str]] = {}
    for rule in proposed.rules:
        label = rule.label.strip().rstrip(":").strip()
        if label:
            spec[rule.field] = {"label": label, "type": rule.type}
    # Shape only. Whether it is a *valid* spec is spec.Spec.from_dict's call,
    # and whether it is a *correct* one is validate.check's.
    return spec or None


def redact(text: str) -> str:
    """Every digit replaced by #, so a body can be sent for its shape without
    its values. Labels and layout survive; amounts, account numbers, dates and
    reference numbers do not."""
    return _DIGIT.sub("#", text)


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


def _clip(text: str) -> str:
    """Trim a body to the part that carries the transaction."""
    return text[:MAX_BODY_CHARS]
