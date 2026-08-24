"""The fields a cash-flow report needs beyond the amount.

Each one earns its place by answering a question the figures alone cannot:
*when* it happened (so it lands in the right month), *which* transaction it
was (so it is counted once), *which wallet* it moved through, and *what for*.

The bar for all of them is the same as for the amount: a value that cannot be
read confidently must read as missing, never as a plausible wrong answer.
"""

from datetime import datetime, timedelta

import pytest
from parser import spec, validate

# One line in each of the shapes Vietnamese bank mail actually prints.
DATES = [
    ("Ngày giao dịch: 21/08/2026 13:15", datetime(2026, 8, 21, 13, 15)),
    ("Ngày giao dịch: 21/08/2026", datetime(2026, 8, 21)),
    ("Ngày giao dịch: 21-08-2026 13:15:07", datetime(2026, 8, 21, 13, 15, 7)),
    ("Ngày giao dịch: 21.08.2026 09:05", datetime(2026, 8, 21, 9, 5)),
    ("Ngày giao dịch: 13:15 21/08/2026", datetime(2026, 8, 21, 13, 15)),
    ("Ngày giao dịch: 13:15 - 21/08/2026", datetime(2026, 8, 21, 13, 15)),
    ("Ngày giao dịch: 13:15:07, 21/08/2026", datetime(2026, 8, 21, 13, 15, 7)),
]


@pytest.mark.parametrize(("body", "expected"), DATES)
def test_a_printed_timestamp_is_read(body, expected):
    loaded = spec.Spec.from_dict(
        {"amount": {"label": "x", "type": "money"},
         "occurred_at": {"label": "Ngày giao dịch", "type": "date"}}
    )
    assert spec.apply(loaded, body).occurred_at == expected


# Dates that are not dates, or not real ones. Each must read as missing.
BAD_DATES = [
    "Ngày giao dịch: 31/02/2026",     # not a real day
    "Ngày giao dịch: 21/08/26",       # two-digit year is ambiguous day-first
    "Ngày giao dịch: 25:00 21/08/2026",  # not a real hour
    "Ngày giao dịch: 19001234567",    # an account number
    "Ngày giao dịch: hôm nay",
    "Ngày giao dịch:",
]


@pytest.mark.parametrize("body", BAD_DATES)
def test_a_date_that_cannot_be_trusted_reads_as_missing(body):
    loaded = spec.Spec.from_dict(
        {"amount": {"label": "x", "type": "money"},
         "occurred_at": {"label": "Ngày giao dịch", "type": "date"}}
    )
    assert spec.apply(loaded, body).occurred_at is None


def test_a_reference_stops_at_the_first_space():
    """The bug 'token' exists to prevent: read as free text, a reference
    carries off the rest of the sentence."""
    loaded = spec.Spec.from_dict(
        {"amount": {"label": "x", "type": "money"},
         "reference": {"label": "Mã giao dịch", "type": "token"}}
    )
    body = "Mã giao dịch: FT2412345678 Quý khách vui lòng giữ lại"
    assert spec.apply(loaded, body).reference == "FT2412345678"


# Every masking a bank uses for an account number. Only the tail is kept.
TAILS = [
    ("Tài khoản: 19001234567", "4567"),
    ("Tài khoản: ****6789", "6789"),
    ("Tài khoản: 0123.4567", "4567"),
    ("Tài khoản: xxxx-xxxx-1234", "1234"),
]


@pytest.mark.parametrize(("body", "expected"), TAILS)
def test_only_the_last_four_digits_of_an_account_are_kept(body, expected):
    """Enough to tell one of the household's wallets from another, and no more
    than that: this table has no reason to hold an account number."""
    loaded = spec.Spec.from_dict(
        {"amount": {"label": "x", "type": "money"},
         "account_tail": {"label": "Tài khoản", "type": "token"}}
    )
    assert spec.apply(loaded, body).account_tail == expected


def test_too_few_digits_is_not_a_tail():
    loaded = spec.Spec.from_dict(
        {"amount": {"label": "x", "type": "money"},
         "account_tail": {"label": "Tài khoản", "type": "token"}}
    )
    assert spec.apply(loaded, "Tài khoản: ABC").account_tail is None


def test_merchant_and_description_are_read_separately():
    """A transfer note is not the merchant. Collapsing them loses whichever
    one the app decided not to show."""
    loaded = spec.Spec.from_dict(
        {"amount": {"label": "Số tiền", "type": "money"},
         "merchant": {"label": "Đơn vị", "type": "text"},
         "description": {"label": "Nội dung", "type": "text"}}
    )
    body = "Số tiền: 250.000 VND Đơn vị: HIGHLANDS COFFEE Nội dung: Ca phe sang"
    result = spec.apply(loaded, body)

    assert result.merchant == "highlands coffee"
    assert result.description == "ca phe sang"


def test_channel_may_be_a_property_of_the_template():
    """A QR receipt is a QR payment however the figures come out, so the
    channel can be fixed the way direction already can."""
    loaded = spec.Spec.from_dict(
        {"amount": {"label": "Số tiền", "type": "money"},
         "channel": {"label": "QR", "type": "fixed"}}
    )
    assert spec.apply(loaded, "Số tiền: 250.000 VND").channel == "qr"


def test_only_direction_and_channel_may_be_fixed():
    with pytest.raises(spec.InvalidSpec):
        spec.Spec.from_dict(
            {"amount": {"label": "x", "type": "money"},
             "merchant": {"label": "anything", "type": "fixed"}}
        )


# ---------------------------------------------------------------- validation


def _reading(**kwargs):
    return spec.Extracted(
        amount=250000, balance=1000000, direction="debit", **kwargs
    )


def test_a_future_transaction_is_rejected():
    """It has not happened. Usually a misread of something else on the page."""
    verdict = validate.check(_reading(occurred_at=datetime.now() + timedelta(days=30)))
    assert not verdict
    assert any("future" in r for r in verdict.reasons)


def test_an_old_transaction_is_accepted():
    """Age is not evidence of a misread.

    A 400-day bound used to reject these, and the cost was not one missing
    row: a mailbox connected today replays two years of receipts, and a mail
    rejected here never reaches the LLM stage — so its TEMPLATE is never
    learned, and every later mail off that template fails the same way. A real
    MoMo bus ticket from 2024 is what showed this.
    """
    assert validate.check(_reading(occurred_at=datetime(2024, 8, 15)))
    assert validate.check(_reading(occurred_at=datetime(2001, 1, 1)))


def test_a_mail_that_arrives_days_late_is_still_accepted():
    """The delay this field exists to fix. Rejecting it would throw away
    exactly the notifications that need a real transaction time."""
    assert validate.check(_reading(occurred_at=datetime.now() - timedelta(days=5)))


def test_a_small_clock_difference_is_tolerated():
    # The bank's clock and this machine's need not agree to the second.
    assert validate.check(_reading(occurred_at=datetime.now() + timedelta(hours=6)))


def test_no_timestamp_is_not_a_failure():
    """Most templates print one, not all do. A transaction with no time is
    still a transaction."""
    assert validate.check(_reading())


def test_a_reference_reads_the_same_from_either_stage():
    """A reference says two mails describe ONE transaction.

    The spec stage reads it out of a body that has been lower-cased for label
    matching; the model returns it as the bank printed it. If the two
    disagreed about case, the same transaction arriving twice would be counted
    twice — the exact thing this field exists to prevent.
    """
    loaded = spec.Spec.from_dict(
        {"amount": {"label": "x", "type": "money"},
         "reference": {"label": "Mã giao dịch", "type": "token"}}
    )
    from_spec = spec.apply(loaded, "Mã giao dịch: FT2412345678").reference
    from_llm = spec.reference("FT2412345678")

    assert from_spec == from_llm == "FT2412345678"


def test_free_text_reads_the_same_from_either_stage():
    """A merchant must be one string however the mail was read.

    The category cache is keyed on the merchant, and a spending report groups
    by it. Two spellings of one shop is two rows in both.
    """
    loaded = spec.Spec.from_dict(
        {"amount": {"label": "Số tiền", "type": "money"},
         "merchant": {"label": "Đơn vị", "type": "text"}}
    )
    from_spec = spec.apply(loaded, "Số tiền: 250.000 VND Đơn vị: HIGHLANDS COFFEE").merchant
    from_llm = spec.free_text("HIGHLANDS COFFEE")

    assert from_spec == from_llm == "highlands coffee"


PREFIXED_AMOUNTS = [
    ("Số tiền: ₫489.000", 489000),
    ("Số tiền: đ250.000", 250000),
    ("Số tiền: ₫ 1.250.000", 1250000),
    ("Số tiền: -₫75.000", 75000),
]


@pytest.mark.parametrize(("body", "expected"), PREFIXED_AMOUNTS)
def test_a_currency_symbol_before_the_figure_is_read(body, expected):
    """Found by a fixture: `Số tiền ₫489.000` read as a missing amount.

    The label matched and the value right after it did not, because the
    separator run between them did not allow a currency symbol — so a whole
    wallet's receipts would have fallen through to the LLM on every mail.
    """
    loaded = spec.Spec.from_dict({"amount": {"label": "Số tiền", "type": "money"}})
    assert spec.apply(loaded, body).amount == expected


def test_a_leading_symbol_does_not_swallow_the_sign():
    loaded = spec.Spec.from_dict(
        {"amount": {"label": "Số tiền", "type": "money"},
         "direction": {"label": "Số tiền", "type": "sign"}}
    )
    result = spec.apply(loaded, "Số tiền: -₫75.000")
    assert result.amount == 75000
    assert result.direction == "debit"
