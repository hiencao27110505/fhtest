"""Deterministic reader for flattened bank label/value tables."""

import re
import unicodedata
from dataclasses import dataclass

from . import spec
from .models import MatchStatus, NormalizedEmail


@dataclass(frozen=True)
class Attempt:
    status: MatchStatus
    extraction: spec.Extracted | None = None
    reason: str = ""


_LABELS = {
    "amount": ("so tien giao dich", "so tien", "transaction amount", "tong tien", "tong cong"),
    "balance": ("so du kha dung", "so du", "available balance", "balance"),
    "occurred_at": (
        "ngay gio giao dich",
        "ngay, gio giao dich",
        "thoi gian giao dich",
        "trans date",
        "transaction date",
        "vao luc",
    ),
    "merchant": (
        "diem giao dich",
        "su dung tai",
        "merchant",
        "ten nguoi huong",
        "nguoi thu huong",
        "beneficiary name",
        "ten nguoi chuyen",
    ),
    "description": ("noi dung chuyen tien", "noi dung", "details of payment", "description"),
    "reference": (
        "so lenh giao dich",
        "so tham chieu",
        "ma giao dich",
        "order number",
        "reference",
    ),
    "account_tail": (
        "tai khoan trich no",
        "so tai khoan",
        "debit account",
        "tk cham",
        "the",
        "card",
    ),
    "channel": ("hinh thuc", "kenh giao dich", "channel"),
    "status": ("tinh trang", "trang thai", "status"),
}

_ABSORB_AMOUNT = (
    "phi",
    "fee",
    "khuyen mai",
    "promotion",
    "hoan tien",
    "cashback",
    "diem thuong",
    "reward",
)
_FAILED = ("that bai", "khong thanh cong", "tu choi", "declined", "failed", "rejected")
_CREDIT = ("ghi co", "nhan tien", "tien vao", "refund", "hoan tien", "received")
_DEBIT = ("ghi no", "thanh toan", "purchase", "tien ra", "chuyen tien", "payment")
_FOREIGN = re.compile(
    r"(?:\b(?:USD|EUR|GBP|AUD|SGD|JPY|CNY|KRW|THB|HKD|CHF|CAD|NZD|TWD|MYR|INR)\b|[$€£¥])",
    re.IGNORECASE,
)


def parse(email: NormalizedEmail) -> Attempt:
    fields = [field.strip() for field in email.body.split("·") if field.strip()]
    rows = _rows(fields)
    if any(_FOREIGN.search(value) for label, value in rows if _is_amount_label(label)):
        return Attempt(
            MatchStatus.PARTIAL, reason="foreign currency requires a currency-aware parser"
        )
    values: dict[str, str] = {}
    for label, value in rows:
        folded = _fold(label)
        for field, aliases in _LABELS.items():
            if field in values or not any(alias in folded for alias in aliases):
                continue
            if field == "amount" and any(word in folded for word in _ABSORB_AMOUNT):
                break
            if field == "merchant" and _looks_like_footer(label):
                break
            values[field] = value
            break

    status_value = _fold(values.get("status", ""))
    if any(word in status_value for word in _FAILED):
        return Attempt(MatchStatus.INVALID, reason="transaction status is not successful")

    amount = spec.money(values.get("amount"))
    occurred_at = spec.parse_datetime(values.get("occurred_at"))
    direction = _direction(values.get("amount", ""), email, values)
    counterpart = values.get("merchant")

    found = sum(value is not None for value in (amount, occurred_at, counterpart))
    if found == 0:
        return Attempt(MatchStatus.NOT_MATCHED)
    if amount is None or occurred_at is None or counterpart is None or direction is None:
        return Attempt(MatchStatus.PARTIAL, reason="deterministic fields incomplete")

    extraction = spec.Extracted(
        amount=amount,
        balance=spec.money(values.get("balance")),
        direction=direction,
        merchant=spec.free_text(counterpart),
        occurred_at=occurred_at,
        reference=spec.reference(values.get("reference")),
        account_tail=spec.account_tail(values.get("account_tail")),
        description=spec.free_text(values.get("description")),
        channel=spec.free_text(values.get("channel")),
    )
    return Attempt(MatchStatus.MATCHED, extraction)


def _rows(fields: list[str]) -> list[tuple[str, str]]:
    rows: list[tuple[str, str]] = []
    for index, field in enumerate(fields):
        inline = re.match(r"^(.{2,45}?)[\s]*[:|][\s]*(.+)$", field)
        if inline:
            rows.append((inline.group(1), inline.group(2)))
        elif index + 1 < len(fields) and _known_label(field):
            rows.append((field, fields[index + 1]))
    return rows


def _known_label(value: str) -> bool:
    folded = _fold(value)
    return any(alias in folded for aliases in _LABELS.values() for alias in aliases)


def _is_amount_label(value: str) -> bool:
    folded = _fold(value)
    return any(alias in folded for alias in _LABELS["amount"]) and not any(
        word in folded for word in _ABSORB_AMOUNT
    )


def _direction(amount_text: str, email: NormalizedEmail, values: dict[str, str]) -> str | None:
    if re.search(r"\+\s*\d", amount_text):
        return "credit"
    if re.search(r"-\s*\d", amount_text):
        return "debit"
    text = _fold(f"{email.subject} {email.body} {values.get('status', '')}")
    credit = any(word in text for word in _CREDIT)
    debit = any(word in text for word in _DEBIT)
    if credit == debit:
        return None
    return "credit" if credit else "debit"


def _looks_like_footer(label: str) -> bool:
    folded = _fold(label)
    return len(label) > 55 or any(
        word in folded for word in ("lien he", "hotline", "gio hanh chinh")
    )


def _fold(value: str) -> str:
    return (
        "".join(
            char
            for char in unicodedata.normalize("NFD", value.casefold())
            if unicodedata.category(char) != "Mn"
        )
        .replace("đ", "d")
        .strip()
    )
