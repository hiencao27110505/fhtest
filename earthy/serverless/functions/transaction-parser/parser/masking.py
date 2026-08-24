"""Keeping what is in a family's mail out of the model's prompt.

Everything else in this package runs on the machine that received the mail.
`llm` is the one stage that sends a body somewhere else, so this is where the
sensitive parts are taken out of it.

Blanking them outright does not work: `llm.extract` is asked to report the
amount, and a body whose figures all read `xxx.xxx` cannot tell it which row
is the amount and which is the balance. So nothing is removed, it is
*replaced by a name* — `[MONEY_1]`, `[EMAIL_1]` — and the model answers in
those names. `restore` turns a name back into its value here, where the value
never left.

    masked, table = mask(body)      # [MONEY_1] ... [MONEY_2] ...
    reading = ask_the_model(masked) # amount="[MONEY_1]"
    amount = restore_int(reading.amount, table)   # 750000

The model keeps everything it actually needs — the labels, the layout, the
+/- next to a figure, which row came first — and none of what it does not.

HOW A KIND IS ADDED

A kind of sensitive value is a `_Kind`: a name prefix, the patterns that find
it, and how to read a match as a value. Everything after that — naming,
numbering, putting the surrounding characters back, idempotency, the reverse
lookup — is shared and does not change.

Adding one is therefore a matter of answering one question: *what
distinguishes this from ordinary text, without reading the label in front of
it?* Labels vary per bank and per template, which is the whole reason the
parser learns them rather than hard-coding them; a masker that guessed from
labels would inherit that problem while failing closed on values it did not
recognise and open on text it wrongly did.

WHAT IS MASKED TODAY

* MONEY — a figure beside a currency marker (`đ`, `₫`, `VND`, `VNĐ`).
  Restores to an `int` number of dong.
* EMAIL — an address. Restores to the address as written.

WHAT IS DELIBERATELY NOT

Account numbers, phone numbers and personal names are worth keeping back too,
and this shape is what they would use. Each is left out because it has no
answer yet to the question above:

* An account number is a run of digits, and so is a transaction reference, an
  invoice number and a date. Masking by shape alone would blind the parser to
  fields it reads.
* A personal name needs recognition, not a pattern — and it is often the
  transfer note, which is exactly the `merchant` field the parser must read.

Masking either one wrongly does not fail safe: it makes a readable mail
unreadable, which is a different failure, not a smaller one.
"""

import re
from collections.abc import Callable
from dataclasses import dataclass

# ---------------------------------------------------------------- money

# A currency marker. `đ`/`₫` are the symbols; VND/VNĐ the codes. Case-folded
# on the way in, so one spelling covers `vnd`, `VNĐ`, `Đ`.
#
# `đ` alone is a real Vietnamese word ("đến", "đã"), so it is only accepted
# where a figure sits immediately beside it — which the patterns below enforce
# by construction, never by matching the marker alone.
_MARKER = r"(?:VN[DĐ]|[đĐ₫])"

# Spacing that may sit around a figure: ordinary, non-breaking and narrow
# no-break spaces, all three common in mail that began as HTML.
_WS = "\xa0  "

# Separators inside a figure: the two decimal conventions, plus spacing.
_SEPARATORS = ".," + _WS

# The numeric part of an amount. Either digit groups with separators between
# them, or a bare run. Separated first, so `750.000` reads as one figure
# rather than `750` followed by `000`.
#
# Groups are bounded to 1-3 digits so a match cannot run off the end of the
# figure into an adjacent number. Both `.` and `,` appear as both thousands
# and decimal separators in Vietnamese mail (`1.250.000,50` and
# `1,250,000.50` are the same figure), and telling them apart is not needed
# to mask them.
_DIGITS = rf"(?:\d{{1,3}}(?:[{_SEPARATORS}]\d{{1,3}})+|\d+)"

# Money with the marker AFTER the figure: `750.000 đ`, `-750.000VND`.
# The sign and the spacing are captured so they can be put back around the
# name; the gap before the marker is optional (`750.000đ` is written both ways).
_MONEY_SUFFIXED = re.compile(
    rf"(?P<sign>[+-])?(?P<lead>[{_WS}]*)(?P<digits>{_DIGITS})"
    rf"(?P<gap>[{_WS}]*)(?P<marker>{_MARKER})\b",
    re.IGNORECASE,
)

# Money with the marker BEFORE the figure: `₫750.000`, `VND 750.000`.
# Runs after the suffixed pattern, so a figure that one already claimed is no
# longer in the text to be matched twice.
#
# The lookbehind is the important half, and it was learned from real mail. In
# `Số dư: 5.750.000 VND 5:26 PM` the VND belongs to the figure BEFORE it — the
# suffixed pattern has already claimed it — and without this guard the same
# marker is spent a second time on whatever follows, which here was the hour
# of a clock time reported as an amount of 5 dong.
#
# `[MONEY_1] VND 4` is what that text looks like by the time this pattern
# runs, so the guard is "not directly after a name, allowing for the spacing
# between them". Python's lookbehind is fixed-width, so the spacing is matched
# and given back rather than looked behind: `pre` is put back untouched.
# The gap allows ONE closing bracket as well as spacing, because MB eBanking
# writes the marker parenthesised: `Số tiền giao dịch (VND) 20,000.00`. Without
# it the `)` sits between marker and figure, nothing matches, no [MONEY_n] is
# issued — and since the model only ever answers in placeholder names, it has
# nothing to point at and the amount comes back null. That is a real mail that
# reached production and was reported as "amount missing".
#
# One bracket, not a general character run: widening the gap further would let
# a marker reach across a table cell and claim a figure it does not label.
_MONEY_PREFIXED = re.compile(
    rf"(?P<pre>\][{_WS}]*)?(?P<marker>{_MARKER})(?P<gap>[)\]]?[{_WS}]*)(?P<sign>[+-])?"
    rf"(?P<lead>[{_WS}]*)(?P<digits>{_DIGITS})",
    re.IGNORECASE,
)


def _money_value(match: re.Match) -> object | None:
    """A matched figure as a whole number of dong.

    Decimals are dropped rather than rounded: VND has no subunit in practice,
    and a mail that prints `,50` is showing a converted figure whose fraction
    is not what the ledger records. None for anything the separator rules do
    not accept as one figure, which leaves the text alone rather than masking
    something half-understood.
    """
    # A marker the suffixed pattern already used belongs to the figure before
    # it, not to this one. See _MONEY_PREFIXED.
    if match.groupdict().get("pre"):
        return None

    digits = match.group("digits")
    if not digits or not digits[0].isdigit():
        return None

    groups = re.split(f"[{re.escape(_SEPARATORS)}]", digits)
    if not all(groups):
        return None  # a trailing or doubled separator: not one figure

    # A final group of 1-2 digits is a decimal fraction, not a thousands
    # group. `1.250.000,50` -> 1250000; `750.000` -> 750000.
    if len(groups) > 1 and len(groups[-1]) < 3:
        groups = groups[:-1]

    joined = "".join(groups)
    return int(joined) if joined.isdigit() else None


# ---------------------------------------------------------------- email

# An address. Deliberately narrower than the RFC: this decides what to hide,
# so missing an exotic-but-legal address costs a leak, while matching too
# widely costs a masked word that was never an address.
#
# The local part allows the characters real addresses use; the domain needs at
# least one dot and a 2+ letter TLD, which keeps `giao@dich` and a bare
# `@handle` from matching. The guards on either side stop an address inside a
# longer token being half-matched.
_EMAIL = re.compile(
    r"(?<![\w.@-])(?P<value>[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*"
    r"\.[A-Za-z]{2,})(?![\w-])"
)


def _email_value(match: re.Match) -> object | None:
    """A matched address, exactly as written."""
    return match.group("value")


# ---------------------------------------------------------------- the shape


@dataclass(frozen=True)
class _Kind:
    """One kind of value worth keeping back.

    `patterns` run in order, each over what the previous left behind, so two
    patterns for the same kind cannot claim the same span twice. Every pattern
    must have a `group` the value is read from; whatever else it matches is
    put back around the name unchanged, which is what keeps the layout intact.

    `read` turns a match into the value the caller gets back from `restore`,
    or None when the match is not really one of these after all — the text is
    then left as it was found.
    """

    prefix: str
    patterns: tuple[re.Pattern, ...]
    read: Callable[[re.Match], object | None]
    group: str


MONEY = _Kind(
    prefix="MONEY",
    patterns=(_MONEY_SUFFIXED, _MONEY_PREFIXED),
    read=_money_value,
    group="digits",
)

EMAIL = _Kind(
    prefix="EMAIL",
    patterns=(_EMAIL,),
    read=_email_value,
    group="value",
)

# Every kind `mask` applies, in the order it applies them. Fixed rather than
# incidental: the order decides which names a body gets, and those names are
# what the model answers with.
KINDS: tuple[_Kind, ...] = (MONEY, EMAIL)

# A name this module produced, of any kind. Used for the reverse lookup, and
# to keep a second pass from renaming what a first pass left: names contain
# digits, so `[MONEY_1] VND` would otherwise look like a figure beside a
# currency marker.
_NAME = re.compile(r"\[(?P<prefix>[A-Z]+)_(?P<index>\d+)\]")


def mask(text: str, kinds: tuple[_Kind, ...] = KINDS) -> tuple[str, dict[str, object]]:
    """Replace every sensitive value with a name.

    Returns the masked text and the table that reads the names back. The table
    stays with the caller: it is the half that must not be sent anywhere.

    `kinds` is open so a caller can mask *less* than the default, for a stage
    that genuinely needs one of them in the clear. Masking *more* means adding
    a `_Kind` here, not passing one in, so every kind stays reviewable in one
    place.

    Idempotent: masking an already-masked body returns it unchanged. The names
    already in it are not re-issued, and the table comes back empty because
    their values are in the table the first call returned.
    """
    table: dict[str, object] = {}
    counter = _Counter(text)

    masked = text
    for kind in kinds:

        def replace(match: re.Match, kind: _Kind = kind) -> str:
            # `kind` is bound as a default: the loop rebinds the name, and a
            # closure over it would see whichever kind the loop finished on.
            return _named(match, kind, table, counter)

        for pattern in kind.patterns:
            masked = pattern.sub(replace, masked)
    return masked, table


def restore(value: object, table: dict[str, object]) -> object | None:
    """Turn a name the model answered with back into the value it stands for.

    `value` is whatever came back in that field: a name, something the model
    reported directly, or nothing. Anything that is not a name this masker
    issued reads as None — a model that invented `[MONEY_9]`, or that ignored
    the instruction and answered with a figure, must not have that reach a
    ledger.
    """
    if not isinstance(value, str):
        # Covers the int case too: the model cannot have read a figure, since
        # every figure was masked before it saw the body, so a number here is
        # invention rather than a reading.
        return None

    name = value.strip()
    if _NAME.fullmatch(name) is None:
        return None
    return table.get(name)


def restore_int(value: object, table: dict[str, object]) -> int | None:
    """`restore` for a field that must be a number, or nothing.

    Narrowed here rather than at every call site, and a name of the wrong kind
    — `[EMAIL_1]` answered for an amount — does not pass as one.
    """
    restored = restore(value, table)
    return restored if isinstance(restored, int) else None


def _named(match: re.Match, kind: _Kind, table: dict[str, object], counter: "_Counter") -> str:
    """Swap one matched value for a fresh name, recording what it was.

    Everything the pattern matched around the value — a sign, the spacing, a
    currency marker — is put back exactly as it was found. Only the value
    itself becomes a name, so the layout the model reads is the layout the
    bank printed.
    """
    value = kind.read(match)
    if value is None:
        return match.group(0)  # not really one of these; leave the text alone

    name = counter.next(kind.prefix)
    table[name] = value

    whole = match.group(0)
    offset = match.start()
    start, end = match.span(kind.group)
    return whole[: start - offset] + name + whole[end - offset :]


class _Counter:
    """Hands out `[PREFIX_n]`, counting each prefix separately.

    Counting starts above whatever names the text already carries, so a second
    pass cannot issue a name that already means something else.
    """

    def __init__(self, text: str = "") -> None:
        self._used: dict[str, int] = {}
        for match in _NAME.finditer(text):
            prefix = match.group("prefix")
            self._used[prefix] = max(self._used.get(prefix, 0), int(match.group("index")))

    def next(self, prefix: str) -> str:
        self._used[prefix] = self._used.get(prefix, 0) + 1
        return f"[{prefix}_{self._used[prefix]}]"
