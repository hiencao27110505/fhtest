"""Stable input, output and failure vocabulary for the parser module."""

from dataclasses import dataclass
from datetime import datetime
from enum import StrEnum


class MatchStatus(StrEnum):
    MATCHED = "matched"
    PARTIAL = "partial"
    INVALID = "invalid"
    NOT_MATCHED = "not_matched"


class ParseFailureCode(StrEnum):
    INVALID_EMAIL = "invalid_email"
    UNSUPPORTED_SOURCE = "unsupported_source"
    UNSUPPORTED_TEMPLATE = "unsupported_template"
    PARSER_MISMATCH = "parser_mismatch"
    MISSING_REQUIRED_FIELD = "missing_required_field"
    INVALID_AMOUNT = "invalid_amount"
    INVALID_DATE = "invalid_date"
    VALIDATION_FAILED = "validation_failed"
    LLM_UNAVAILABLE = "llm_unavailable"


@dataclass(frozen=True)
class EmailInput:
    source: str
    subject: str
    body: str


@dataclass(frozen=True)
class NormalizedEmail:
    source: str
    subject: str
    subject_template: str
    body: str


@dataclass(frozen=True)
class Detection:
    provider: str
    subject_template: str
    template: str | None = None
    transaction_type: str | None = None
    status: MatchStatus = MatchStatus.NOT_MATCHED


@dataclass(frozen=True)
class RawExtraction:
    amount: object = None
    balance: object = None
    direction: object = None
    merchant: object = None
    occurred_at: object = None
    reference: object = None
    account_tail: object = None
    description: object = None
    channel: object = None
    currency: object = None
    fx_amount: object = None
    fx_currency: object = None
    transaction_type: object = None
    status: object = None
    account_kind: object = None
    flow: object = None


@dataclass(frozen=True)
class ParsedTransaction:
    amount: int | None = None
    balance: int | None = None
    direction: str | None = None
    merchant: str | None = None
    occurred_at: datetime | None = None
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
    category: str | None = None
