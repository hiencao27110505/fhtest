"""Pulling amount / direction / balance out of Vietnamese bank mail.

Kept separate from main.py because this is the volatile part: banks change
their templates, and each new source adds patterns here.

Everything is text-only. main.py strips HTML before calling in, so the
functions below can be tested with plain strings.
"""

import re
from dataclasses import dataclass

# 1.234.567 VND / 1,234,567đ / 1.234.567 đồng — the grouping separator is
# either dot or comma depending on the bank, and the currency marker varies.
_AMOUNT = re.compile(
    r"(?P<amount>\d{1,3}(?:[.,]\d{3})+|\d+)\s*(?:VND|VNĐ|đ|d|đồng)\b",
    re.IGNORECASE,
)

# Banks mark direction with a sign next to the amount, or with wording.
_CREDIT_WORDS = re.compile(
    r"ghi có|nhận tiền|tiền vào|cộng tiền|\+\s*\d", re.IGNORECASE
)
_DEBIT_WORDS = re.compile(
    r"ghi nợ|thanh toán|chuyển tiền|trừ tiền|tiền ra|-\s*\d", re.IGNORECASE
)

# "Số dư: 5.000.000" — captured separately so it is not mistaken for the
# transaction amount, which is the single most common parsing error here.
_BALANCE = re.compile(
    r"(?:số dư|so du|balance)[^\d]{0,20}(?P<balance>\d{1,3}(?:[.,]\d{3})+|\d+)",
    re.IGNORECASE,
)


@dataclass
class Parsed:
    """What could be read off one email. Fields are None when not found."""

    amount: int | None
    direction: str | None  # "credit" | "debit"
    balance: int | None

    @property
    def is_complete(self) -> bool:
        return self.amount is not None and self.direction is not None


def to_int(raw: str) -> int:
    """'1.234.567' -> 1234567. Separators are grouping only; Vietnamese bank
    mail does not use decimals for VND."""
    return int(raw.replace(".", "").replace(",", "").replace(" ", ""))


def parse(text: str) -> Parsed:
    """Read amount, direction and balance out of an email body."""
    balance_match = _BALANCE.search(text)
    balance = to_int(balance_match.group("balance")) if balance_match else None

    amount = _first_amount_excluding_balance(text, balance_match)
    return Parsed(amount=amount, direction=_direction(text), balance=balance)


def _first_amount_excluding_balance(text: str, balance_match: re.Match | None) -> int | None:
    """First amount in the text that is not the balance figure.

    The balance is skipped by span rather than by value: a transfer that
    happens to equal the balance would otherwise be discarded.
    """
    skip = balance_match.span("balance") if balance_match else None
    for match in _AMOUNT.finditer(text):
        span = match.span("amount")
        if skip and span[0] >= skip[0] and span[1] <= skip[1]:
            continue
        return to_int(match.group("amount"))
    return None


def _direction(text: str) -> str | None:
    """Credit or debit, or None when the wording is ambiguous.

    Whichever marker appears first wins: bank mail leads with the event and
    often mentions the opposite word later in boilerplate.
    """
    credit = _CREDIT_WORDS.search(text)
    debit = _DEBIT_WORDS.search(text)
    if credit and debit:
        return "credit" if credit.start() < debit.start() else "debit"
    if credit:
        return "credit"
    if debit:
        return "debit"
    return None
