"""Declarative extraction specs: what gets cached per email template.

A spec says *where* each field sits relative to the labels the bank prints,
and nothing else:

    {
      "amount":    {"label": "số tiền giao dịch", "type": "money"},
      "balance":   {"label": "số dư",             "type": "money"},
      "direction": {"label": "số tiền giao dịch", "type": "sign"},
      "merchant":  {"label": "nội dung",          "type": "text"}
    }

One sender has several specs — a bank sends credit notices, debit notices and
statements, all shaped differently. The pipeline applies each of the sender's
specs in turn and keeps the first result that passes validate.check.

That is not enough on its own. Two notices from one wallet — a ticket purchase
and a receipt — can share every label and differ only in which way the money
moved, and no amount of checking the figures can tell them apart: both read
cleanly, both validate, and the one tried first wins. So a spec may also carry
`match`, the phrases that must appear in a mail for the spec to be applicable
at all:

    {
      "match":  ["Phieu nhan tien"],
      "amount": {"label": "Tong tien", "type": "money"},
      ...
    }

`match` decides WHICH template this is; the rules decide WHERE the fields sit;
validation decides whether the result is trustworthy. Keeping the three apart
is what stops a receipt being posted as a payment.

`match` is optional: a spec without one applies to any mail from its sender,
which is how every spec learned before this existed keeps working.

Deliberately NOT regex. A spec is produced by an LLM (see llm.py) and stored
in the database, so it is machine-authored input applied to money. Three
reasons the format is this narrow:

* it is readable — anyone can eyeball a label and say whether it is right,
  which is not true of a 60-character regex;
* it cannot backtrack, so a bad spec cannot hang the function;
* nothing here compiles or evaluates a machine-authored string. The regexes
  in this module are literals written by hand; the spec only ever supplies
  data to match *against*.

The engine is plain Python and needs no network and no database, so the whole
deterministic path is testable on its own.
"""

import re
from dataclasses import dataclass
from datetime import datetime

# Field names a spec may carry. Anything else is rejected at parse time rather
# than silently ignored: a spec naming a field this code does not read is a
# spec that is not doing what whoever wrote it thinks it is.
FIELDS = (
    "amount",
    "balance",
    "direction",
    "merchant",
    # What a cash-flow report needs beyond the figures themselves.
    "occurred_at",  # when the transaction happened, not when the mail arrived
    "reference",    # the bank's own id for it, so one transaction counts once
    "account_tail", # which of the household's wallets it moved through
    "description",  # the transfer note, which is not always the merchant
    "channel",      # QR / POS / ATM / chuyển khoản
)

# Not a field: a key alongside them, holding the phrases that identify the
# template rather than describing where a value sits. Kept out of FIELDS so
# `apply` never treats it as something to extract.
MATCH = "match"

# "money" reads a figure, "sign" reads direction from a +/- next to one,
# "text" copies free text, "fixed" carries a constant, "date" reads a printed
# timestamp, and "token" reads a single unbroken run of letters and digits.
#
# "token" exists because a reference or an account tail is one word with no
# spaces, and reading it as "text" would swallow whatever the bank printed
# next. Anchoring on the shape is what keeps a transaction id from arriving
# with half the following sentence attached.
#
# "fixed" exists because most Vietnamese bank mail never prints a sign: which
# way the money moved is a property of the *template* ("Báo Có" vs "Báo Nợ"),
# not of any field in the body. Without it, direction would be unreadable for
# those templates and nothing could ever be learned from them.
TYPES = ("money", "sign", "text", "fixed", "date", "token")

# What a "fixed" rule may carry. Narrow on purpose: it is a way to record a
# constant the template implies, not a way to inject arbitrary values.
FIXED_VALUES = ("credit", "debit")

# Fields whose value can be a property of the TEMPLATE rather than of any row
# in the body. Direction is the original case ("Báo Có" is always money in);
# channel is the same shape of fact, because a QR-payment receipt is always a
# QR payment however the figures come out.
#
# Deliberately short. A fixed rule is a constant a model chose, applied to
# every future mail off that template, so each field on this list is one more
# thing that can be silently wrong for a year.
FIXED_FIELDS = ("direction", "channel")

# How far past a label to look for its value. Generous enough to cross the
# whitespace and currency noise left by strip_html, short enough that a missing
# value does not silently pick up the *next* row's figure.
_WINDOW = 60

# A grouped or bare figure: 1.234.567 / 1,234,567 / 500000. Vietnamese bank
# mail uses dot or comma as a thousands separator and no decimals for VND.
#
# Anchored: the figure must be what FOLLOWS the label, not merely something
# found nearby. A searching pattern reads "thông báo biến động số dư. Tài
# khoản 19001234567" as a balance of 19001234567 — it walks past an entire
# other field to find a number. Only the currency marker and punctuation may
# sit in between.
# The leading run may not contain +/- : that is the sign, and swallowing it
# would lose the direction the 'sign' rule reads.
# A currency symbol may lead the figure (`₫489.000`, `đ250.000`), so the
# separator run accepts one. Without it a prefixed amount reads as missing:
# the label is found, the value right after it is not.
_MONEY = re.compile(
    r"^[\s:.·|₫đĐ]{0,4}(?P<sign>[+-])?[\s₫đĐ]{0,3}(?P<digits>\d{1,3}(?:[.,]\d{3})+|\d+)"
)

# A printed timestamp. Vietnamese bank mail writes the date day-first and the
# time on a 24-hour clock, with the two in either order and separated by
# almost anything: "21/08/2026 13:15", "13:15 21-08-2026", "13:15:07,
# 21/08/2026". Both orders are matched explicitly rather than by a pattern
# loose enough to accept either, because a loose one also accepts an account
# number with slashes in it.
#
# The year is required and must be four digits: a two-digit year is ambiguous
# in a corpus that also prints day-first dates, and guessing the century on a
# ledger is not worth the handful of mails it would rescue.
_DATE = r"(?P<d>\d{1,2})[/\-.](?P<mo>\d{1,2})[/\-.](?P<y>\d{4})"
_TIME = r"(?P<h>\d{1,2}):(?P<mi>\d{2})(?::(?P<sec>\d{2}))?"

_DATE_THEN_TIME = re.compile(rf"^[\s:.·|]{{0,4}}{_DATE}(?:[\s,]+{_TIME})?")
_TIME_THEN_DATE = re.compile(rf"^[\s:.·|]{{0,4}}{_TIME}[\s,]+(?:-\s*)?{_DATE}")

# One unbroken run: letters, digits, and the punctuation that appears inside a
# reference ("FT24123456789", "INV-2026-00125", "0123.4567"). Stops at the
# first space, which is what keeps the rest of the sentence out of it.
#
# A leading run of `*` or `x` is allowed and kept: banks mask an account as
# `****6789` or `xxxx-xxxx-1234`, and refusing those would lose the tail on
# exactly the templates that are most careful with it.
_TOKEN = re.compile(r"^[\s:.·|]{0,4}(?P<value>[*xX]*[A-Za-z0-9][A-Za-z0-9._*-]{2,})")

# Where a free-text value ends. Not guessed from spacing: strip_html collapses
# the layout away, and every attempt to infer the boundary from what is left
# either swallowed the next row's name or bit into the value. The spec already
# names every label in the template, so `apply` hands the others to _text and
# the value is cut at whichever appears first.
_WHITESPACE = re.compile(r"\s+")


class InvalidSpec(ValueError):
    """The stored spec is not something this engine can apply.

    Raised at load time, not at extraction time: a spec is validated once when
    it comes out of the database, so a malformed one is a loud failure on the
    template rather than a wrong number on a transaction.
    """


@dataclass(frozen=True)
class Rule:
    """Where one field sits: the label that anchors it, and how to read it."""

    label: str
    type: str


@dataclass(frozen=True)
class Spec:
    """The extraction rules for one email template, and how to recognise it."""

    rules: dict[str, Rule]
    # Phrases that must all appear in a mail for this spec to apply. Empty
    # means "applies to anything from this sender", which is what a spec
    # learned before `match` existed carries.
    match: tuple[str, ...] = ()

    @classmethod
    def from_dict(cls, raw: object) -> "Spec":
        """Validate and load a spec, as stored in the database.

        Every constraint is checked here so that `apply` can assume a
        well-formed spec and stay free of defensive branching.
        """
        if not isinstance(raw, dict) or not raw:
            raise InvalidSpec("spec must be a non-empty object")

        match = _load_match(raw.get(MATCH)) if MATCH in raw else ()

        rules: dict[str, Rule] = {}
        for field, body in raw.items():
            if field == MATCH:
                continue  # not a field; handled above
            if field not in FIELDS:
                raise InvalidSpec(f"unknown field {field!r}")
            if not isinstance(body, dict):
                raise InvalidSpec(f"{field}: rule must be an object")

            label = body.get("label")
            kind = body.get("type")
            if not isinstance(label, str) or not label.strip():
                raise InvalidSpec(f"{field}: label must be a non-empty string")
            if kind not in TYPES:
                raise InvalidSpec(f"{field}: type must be one of {TYPES}")
            if kind == "fixed":
                if field not in FIXED_FIELDS:
                    raise InvalidSpec(f"{field}: only {FIXED_FIELDS} may be fixed")
                if field == "direction" and label.strip().lower() not in FIXED_VALUES:
                    raise InvalidSpec(f"direction: fixed value must be one of {FIXED_VALUES}")

            rules[field] = Rule(label=_squash(label), type=kind)

        if "amount" not in rules:
            # A spec that cannot find the amount has no use: the pipeline would
            # fall back to the LLM on every mail anyway.
            raise InvalidSpec("spec must define 'amount'")
        return cls(rules=rules, match=match)

    def to_dict(self) -> dict:
        """Round-trips through from_dict. What gets written to the database.

        `match` is omitted when empty rather than written as `[]`, so a spec
        without one serialises to exactly the shape already stored — the
        unique index is on the jsonb value, and an added empty key would make
        every existing row look like a new spec.
        """
        out: dict = {
            field: {"label": rule.label, "type": rule.type}
            for field, rule in self.rules.items()
        }
        if self.match:
            out[MATCH] = list(self.match)
        return out


@dataclass(frozen=True)
class Extracted:
    """What a spec read off one mail. Fields are None when the label was not
    found, or was found with nothing usable after it."""

    amount: int | None = None
    balance: int | None = None
    direction: str | None = None
    merchant: str | None = None

    # A datetime when the mail printed one, naive: Vietnamese bank mail prints
    # local time without an offset, and inventing one here would be a guess.
    # The app applies Asia/Ho_Chi_Minh.
    occurred_at: datetime | None = None
    reference: str | None = None
    account_tail: str | None = None
    description: str | None = None
    channel: str | None = None


def _load_match(raw: object) -> tuple[str, ...]:
    """Validate and normalise the `match` phrases.

    Strict rather than forgiving: this comes out of a database column written
    by a model, and a phrase that silently became empty would turn a spec that
    identifies one template into a spec that applies to all of them.
    """
    if not isinstance(raw, list) or not raw:
        raise InvalidSpec("match must be a non-empty array of strings")

    phrases = []
    for phrase in raw:
        if not isinstance(phrase, str) or not phrase.strip():
            raise InvalidSpec("match: every phrase must be a non-empty string")
        phrases.append(_squash(phrase))
    return tuple(phrases)


def matches(spec: Spec, text: str) -> bool:
    """Whether this spec is meant for this mail.

    Every phrase must be present — an AND, not an OR. Each phrase narrows the
    template further, so treating the list as an OR would let one loose phrase
    readmit the very mail the others were added to exclude.

    A spec with no phrases matches everything, which is what keeps specs
    learned before `match` existed working unchanged.

    Compared the same way labels are: case-folded, with runs of whitespace
    squashed, because strip_html leaves the layout as arbitrary spacing.
    """
    if not spec.match:
        return True
    body = _squash(text)
    return all(phrase in body for phrase in spec.match)


def apply(spec: Spec, text: str) -> Extracted:
    """Run a spec over one flattened mail body.

    Never raises on unrecognised input: a template that has drifted reads as
    missing fields, which the caller treats as a miss and escalates. Throwing
    here would turn a drifted template into a redelivery loop.
    """
    body = _squash(text)
    values: dict[str, object] = {}

    for field, rule in spec.rules.items():
        if rule.type == "fixed":
            # No lookup: the value is what the template implies, and the rule
            # carries it directly.
            values[field] = rule.label
            continue

        # Every *other* label in the template bounds a free-text value.
        others = tuple(r.label for f, r in spec.rules.items() if f != field)
        for window in _after_label(body, rule.label) or ():
            value: int | str | datetime | None
            if rule.type == "money":
                value = _money(window)
            elif rule.type == "sign":
                value = _direction(window)
            elif rule.type == "date":
                value = _datetime(window)
            elif rule.type == "token":
                value = _token(window)
            else:
                value = _text(window, others)
            if value is not None:
                values[field] = value
                break

    return Extracted(
        amount=_as_int(values.get("amount")),
        balance=_as_int(values.get("balance")),
        direction=_as_direction(values.get("direction")),
        merchant=_as_text(values.get("merchant")),
        occurred_at=_as_datetime(values.get("occurred_at")),
        reference=_as_reference(values.get("reference")),
        account_tail=_as_tail(values.get("account_tail")),
        description=_as_text(values.get("description")),
        channel=_as_text(values.get("channel")),
    )


def _after_label(text: str, label: str) -> list[str] | None:
    """The slices of text just past each `label`, or None if it never appears.

    Matched as a plain substring, not a pattern: the label comes from a stored
    spec, and treating machine-authored text as a regex is exactly what this
    module exists to avoid.

    The first occurrence whose window yields something wins. Bank mail repeats
    its field names in the footer legend ("Số dư: số tiền còn lại trong tài
    khoản"), so a label can appear more than once with only one of them in
    front of a real value.
    """
    windows = []
    at = text.find(label)
    while at >= 0:
        start = at + len(label)
        # Skip the separator the label was found by, plus any padding.
        windows.append(text[start : start + _WINDOW].lstrip(": \t"))
        at = text.find(label, start)
    return windows or None


def _money(window: str) -> int | None:
    """The first figure in the window, as an integer number of dong."""
    match = _MONEY.search(window)
    if match is None:
        return None
    return _to_int(match.group("digits"))


def _datetime(window: str) -> datetime | None:
    """The timestamp printed just past a label.

    Returns None for anything that is not a real date — 31/02, hour 25 — so a
    misread reads as a missing field rather than as a plausible wrong day.
    """
    match = _DATE_THEN_TIME.match(window) or _TIME_THEN_DATE.match(window)
    if match is None:
        return None

    parts = match.groupdict()
    try:
        return datetime(
            year=int(parts["y"]),
            month=int(parts["mo"]),
            day=int(parts["d"]),
            hour=int(parts.get("h") or 0),
            minute=int(parts.get("mi") or 0),
            second=int(parts.get("sec") or 0),
        )
    except ValueError:
        # 31/02, hour 25, and anything else the calendar rejects.
        return None


def _token(window: str) -> str | None:
    """A single unbroken run of letters and digits past a label.

    Used for a reference or an account tail: both are one word, and reading
    them as free text would carry off whatever the bank printed after.
    """
    match = _TOKEN.match(window)
    return match.group("value") if match else None


def _direction(window: str) -> str | None:
    """Credit or debit, from the sign printed next to the amount.

    Only the explicit sign is read here. A template that prints no sign
    records its direction as a "fixed" rule instead — see TYPES.
    """
    match = _MONEY.search(window)
    if match is None or match.group("sign") is None:
        return None
    return "credit" if match.group("sign") == "+" else "debit"


def _text(window: str, others: tuple[str, ...] = ()) -> str | None:
    """The free-text value after a label.

    Bounded by whichever comes first: another label the template declares, or
    the field break `strip_html` leaves between cells.

    The field break is what stops a value running into the row below it. A
    cinema's name and its street address are two cells; without the break the
    value ran to the end of the window and the merchant became
    "CGV Hoàng Văn Thụ Tầng 1 và 2, Gala Center, số 415, ..." — which is a
    different merchant from the one the LLM stage reads, so the two disagree
    and the category cache holds both.

    A leading break is skipped rather than cut on: the label is followed by
    one, and cutting there would make every text field empty.
    """
    body = window.lstrip(" :·\t")
    cut = len(body)

    at = body.find("·")
    if at >= 0:
        cut = at

    for label in others:
        found = body.find(label)
        if 0 <= found < cut:
            cut = found

    value = body[:cut].strip(" :·\t")
    return value or None


def _to_int(raw: str) -> int | None:
    """'1.234.567' -> 1234567. Separators are grouping only."""
    digits = raw.replace(".", "").replace(",", "").replace(" ", "")
    return int(digits) if digits.isdigit() else None


def _as_int(value: object) -> int | None:
    return value if isinstance(value, int) else None


def _as_direction(value: object) -> str | None:
    return value if value in ("credit", "debit") else None


def _as_text(value: object) -> str | None:
    return value if isinstance(value, str) and value else None


def _as_datetime(value: object) -> datetime | None:
    return value if isinstance(value, datetime) else None


def free_text(value: object) -> str | None:
    """Free text, squashed the way the spec stage squashes it.

    The spec stage reads its values out of a body `_squash` has already folded,
    so a merchant it produces is lower-cased. The model returns one as printed.
    Left alone, the same shop would be two different strings depending on which
    stage read the mail — two rows in a spending report, and two rows in the
    category cache.

    Folding the model's answer to match is the cheaper direction: the spec
    stage cannot un-fold, and the case a bank prints ("HIGHLANDS COFFEE") is
    shouting anyway.
    """
    return _squash(value) if isinstance(value, str) and value.strip() else None


def reference(value: object) -> str | None:
    """A transaction id, upper-cased.

    Both stages must agree on the spelling: the spec stage reads it out of a
    body `_squash` has already lower-cased, while the model returns it as the
    bank printed it. A reference is what says two mails describe ONE
    transaction, so the two stages disagreeing about its case would defeat the
    deduplication it exists for.
    """
    return _as_reference(value)


def _as_reference(value: object) -> str | None:
    return value.upper() if isinstance(value, str) and value else None


def account_tail(value: object) -> str | None:
    """Public alias: the LLM stage needs the same normalisation the spec stage
    applies, so a tail means the same thing whichever stage produced it."""
    return _as_tail(value)


def _as_tail(value: object) -> str | None:
    """The last four digits of an account number, and nothing more.

    Mail prints an account in every degree of masking — full, `****6789`,
    `0123.4567`. Only the tail is kept: it is enough to tell one of the
    household's wallets from another, and keeping the rest would put an
    account number in a table that has no reason to hold one.
    """
    if not isinstance(value, str):
        return None
    digits = "".join(c for c in value if c.isdigit())
    return digits[-4:] if len(digits) >= 4 else None


def _squash(value: str) -> str:
    """Collapse whitespace and lowercase, so a label matches regardless of how
    the HTML was laid out. Diacritics stay: they distinguish real labels."""
    return _WHITESPACE.sub(" ", value).strip().lower()
