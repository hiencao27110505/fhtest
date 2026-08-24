"""Deciding whether an extraction is trustworthy enough to keep.

This module is the load-bearing one. The pipeline picks a template by trying
each stored spec for a sender until one produces a result that passes here, so
"passes here" is the whole of what stops the wrong spec being applied to a
mail — and applying a credit template to a debit notice would post money in
the wrong direction, silently.

It also gates the LLM's own output. A machine-authored spec and a
machine-authored extraction get the same scrutiny; nothing reaches a ledger
because a model sounded confident.

Everything is a check on internal consistency, not on plausibility. We cannot
know that 500.000đ is the right amount, but we can know that an amount equal
to the balance is a misread, and that a "+" next to the figure contradicts a
"debit" reading.
"""

from dataclasses import dataclass
from datetime import datetime, timedelta

# VND. Below this a "transaction" is almost certainly a fee line, a reference
# number that parsed as money, or a stray figure from the footer; above it,
# a misplaced thousands separator (500.000 read as 500.000.000).
#
# Deliberately wide: this is a sanity bound, not a policy on what a family may
# spend. Anything outside it is escalated, never dropped.
MIN_AMOUNT = 1_000
MAX_AMOUNT = 500_000_000

# How far ahead of now a printed transaction time may sit. Two days rather than
# none because a bank's clock and this machine's can disagree, and a mail can
# be composed a moment before it is sent.
#
# There is deliberately no bound in the other direction. A mailbox connected
# for the first time replays whatever history it still holds, and a receipt
# from two years ago is a real transaction someone still wants on the ledger —
# an earlier 400-day bound rejected exactly that, and the cost was not one
# missing row: the mail never reached the LLM stage, so its TEMPLATE was never
# learned, and every later mail off it failed the same way.
_FUTURE_GRACE_DAYS = 2


@dataclass(frozen=True)
class Verdict:
    """Whether an extraction may be used, and why not when it may not.

    `reasons` is for humans: it goes to the log and, for an active template
    that starts failing, to the Telegram alert. It is what tells whoever looks
    which bank changed its mail.
    """

    ok: bool
    reasons: tuple[str, ...] = ()

    def __bool__(self) -> bool:
        return self.ok


def check(extracted, text: str = "") -> Verdict:
    """Judge one extraction.

    `extracted` is anything with amount/balance/direction/merchant attributes,
    so a spec.Extracted and an LLM result are judged by the same rules.

    `text` is the flattened mail body, used only for cross-checks that need
    the original — passing it is optional so the checks that do not need it
    stay usable on their own.
    """
    reasons: list[str] = []

    amount = getattr(extracted, "amount", None)
    balance = getattr(extracted, "balance", None)
    direction = getattr(extracted, "direction", None)

    if amount is None:
        reasons.append("amount missing")
    else:
        if amount < MIN_AMOUNT:
            reasons.append(f"amount {amount} below {MIN_AMOUNT}")
        if amount > MAX_AMOUNT:
            reasons.append(f"amount {amount} above {MAX_AMOUNT}")
        if balance is not None and amount == balance:
            # The classic misread: both figures sit in the same table and the
            # spec anchored onto the wrong row.
            reasons.append("amount equals balance")

    if direction is None:
        reasons.append("direction missing")
    elif direction not in ("credit", "debit"):
        reasons.append(f"direction {direction!r} not credit/debit")

    if balance is not None and balance < 0:
        reasons.append("balance negative")

    occurred_at = getattr(extracted, "occurred_at", None)
    if occurred_at is not None:
        when = _date_problem(occurred_at)
        if when:
            reasons.append(when)

    if amount is not None and direction is not None and text:
        conflict = _sign_conflict(amount, direction, text)
        if conflict:
            reasons.append(conflict)

    return Verdict(ok=not reasons, reasons=tuple(reasons))


def _date_problem(occurred_at: datetime) -> str | None:
    """Whether a printed timestamp can be believed.

    One check, in one direction: a transaction dated in the future has not
    happened, so reading one means the wrong figure was picked up — a card
    expiry, a departure date, a reference number that parsed as a date.

    Nothing is rejected for being old. Age is not evidence of a misread: a
    mailbox connected today replays two years of receipts, and every one of
    them is a transaction someone wants recorded. See _FUTURE_GRACE_DAYS.
    """
    if occurred_at > datetime.now() + timedelta(days=_FUTURE_GRACE_DAYS):
        return f"occurred_at {occurred_at.date()} is in the future"
    return None


def _sign_conflict(amount: int, direction: str, text: str) -> str | None:
    """A sign printed next to the amount that contradicts the direction.

    Only fires when the mail actually prints a sign against *this* figure, and
    only when it prints exactly one — a body containing both "+" and "-" rows
    is a statement, not a single notification, and the sign there says nothing
    about which row was extracted.
    """
    # The same figure appears as 1.234.567, 1,234,567 or 1234567 depending on
    # the bank; check every spelling or the cross-check quietly never fires.
    forms = _spellings(amount)
    plus = any(f"+{form}" in text or f"+ {form}" in text for form in forms)
    minus = any(f"-{form}" in text or f"- {form}" in text for form in forms)

    if plus == minus:  # neither, or both: nothing to conclude
        return None
    if plus and direction != "credit":
        return "sign is + but direction is debit"
    if minus and direction != "debit":
        return "sign is - but direction is credit"
    return None


def _spellings(amount: int) -> tuple[str, ...]:
    """Every way a bank might print this figure: dot-grouped, comma-grouped,
    or bare."""
    grouped = f"{amount:,}"
    return (grouped.replace(",", "."), grouped, str(amount))
