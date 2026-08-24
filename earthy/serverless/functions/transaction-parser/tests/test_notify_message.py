"""What the Telegram line says, and what it deliberately leaves out.

These are user-facing strings, so they are worth pinning: a message that omits
what the parser worked to extract is a silent regression — nothing fails, the
notification is just less useful than it should be.
"""

from dataclasses import dataclass
from datetime import datetime

import main


@dataclass
class Reading:
    """A parsed reading, with everything absent unless a test sets it."""

    amount: int | None = 20_000
    balance: int | None = None
    direction: str | None = "debit"
    merchant: str | None = None
    occurred_at: datetime | None = None
    reference: str | None = None
    account_tail: str | None = None
    description: str | None = None
    channel: str | None = None


@dataclass
class Result:
    category: str | None = None
    category_source: str | None = None


def test_the_subject_is_not_in_a_parsed_message() -> None:
    """Bank subjects are fixed banners, identical on every notice.

    "Thong bao giao dich thanh cong" describes MB's mail template, not this
    transaction, so putting it on the line makes every message look alike and
    crowds out what was actually read.
    """
    text = main._parsed_message(
        Reading(description="chuyen tien", merchant="NGUYEN THU TRANG"),
        Result(),
        "mbbank",
    )
    assert "Thong bao giao dich thanh cong" not in text
    assert "Tiêu đề" not in text


def test_the_memo_and_counterparty_are_shown() -> None:
    """The two things a person asks about a transaction: who, and what for."""
    text = main._parsed_message(
        Reading(merchant="NGUYEN THU TRANG", description="tra tien com"),
        Result(),
        "mbbank",
    )
    assert "Tới: NGUYEN THU TRANG" in text
    assert "Nội dung: tra tien com" in text


def test_credit_reads_as_incoming() -> None:
    text = main._parsed_message(
        Reading(direction="credit", merchant="CONG TY ABC"), Result(), "vcb"
    )
    assert "· vào" in text
    assert "Từ: CONG TY ABC" in text


def test_absent_fields_are_omitted_not_padded() -> None:
    """A thin reading says little rather than listing em-dashes."""
    text = main._parsed_message(Reading(), Result(), "vcb")
    assert text == "💸 <b>20.000 VND</b> · ra\nvcb"


def test_mail_authored_text_is_escaped() -> None:
    """Telegram parses HTML, and merchant/description come out of the mail."""
    text = main._parsed_message(
        Reading(merchant="<b>A&B</b>", description="<script>x</script>"),
        Result(),
        "acb",
    )
    assert "<b>A&B</b>" not in text
    assert "&lt;b&gt;A&amp;B&lt;/b&gt;" in text
    assert "<script>" not in text
