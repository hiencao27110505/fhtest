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
statements, all shaped differently. The pipeline does not try to guess which
is which up front: it applies each of the sender's specs in turn and keeps the
first result that passes validate.check. That makes this module's job narrow,
and validation the one that decides what is true.

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

# Field names a spec may carry. Anything else is rejected at parse time rather
# than silently ignored: a spec naming a field this code does not read is a
# spec that is not doing what whoever wrote it thinks it is.
FIELDS = ("amount", "balance", "direction", "merchant")

# "money" reads a figure, "sign" reads direction from a +/- next to one,
# "text" copies free text, and "fixed" carries a constant.
#
# "fixed" exists because most Vietnamese bank mail never prints a sign: which
# way the money moved is a property of the *template* ("Báo Có" vs "Báo Nợ"),
# not of any field in the body. Without it, direction would be unreadable for
# those templates and nothing could ever be learned from them.
TYPES = ("money", "sign", "text", "fixed")

# What a "fixed" rule may carry. Narrow on purpose: it is a way to record a
# constant the template implies, not a way to inject arbitrary values.
FIXED_VALUES = ("credit", "debit")

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
_MONEY = re.compile(
    r"^[\s:.·|]{0,4}(?P<sign>[+-])?\s*(?P<digits>\d{1,3}(?:[.,]\d{3})+|\d+)"
)

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
    """The extraction rules for one email template."""

    rules: dict[str, Rule]

    @classmethod
    def from_dict(cls, raw: object) -> "Spec":
        """Validate and load a spec, as stored in the database.

        Every constraint is checked here so that `apply` can assume a
        well-formed spec and stay free of defensive branching.
        """
        if not isinstance(raw, dict) or not raw:
            raise InvalidSpec("spec must be a non-empty object")

        rules: dict[str, Rule] = {}
        for field, body in raw.items():
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
            if kind == "fixed" and label.strip().lower() not in FIXED_VALUES:
                raise InvalidSpec(f"{field}: fixed value must be one of {FIXED_VALUES}")
            if kind == "fixed" and field != "direction":
                raise InvalidSpec(f"{field}: only direction may be fixed")

            rules[field] = Rule(label=_squash(label), type=kind)

        if "amount" not in rules:
            # A spec that cannot find the amount has no use: the pipeline would
            # fall back to the LLM on every mail anyway.
            raise InvalidSpec("spec must define 'amount'")
        return cls(rules=rules)

    def to_dict(self) -> dict:
        """Round-trips through from_dict. What gets written to the database."""
        return {
            field: {"label": rule.label, "type": rule.type}
            for field, rule in self.rules.items()
        }


@dataclass(frozen=True)
class Extracted:
    """What a spec read off one mail. Fields are None when the label was not
    found, or was found with nothing usable after it."""

    amount: int | None = None
    balance: int | None = None
    direction: str | None = None
    merchant: str | None = None


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
            value: int | str | None
            if rule.type == "money":
                value = _money(window)
            elif rule.type == "sign":
                value = _direction(window)
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

    Cut at the start of whichever other label the template declares comes
    first. `others` is passed in from the spec, so the boundary is known
    rather than guessed; a value with no label after it runs to the end of the
    window, which is what bounds it.
    """
    cut = len(window)

    for label in others:
        at = window.find(label)
        if 0 <= at < cut:
            cut = at

    value = window[:cut].strip(" :\t")
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


def _squash(value: str) -> str:
    """Collapse whitespace and lowercase, so a label matches regardless of how
    the HTML was laid out. Diacritics stay: they distinguish real labels."""
    return _WHITESPACE.sub(" ", value).strip().lower()
