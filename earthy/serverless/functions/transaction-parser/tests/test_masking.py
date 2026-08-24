"""What the masker does and does not take out of a body.

Two properties carry the weight. Every figure beside a currency marker is
replaced, because one that slips through is sent to a third party. And no
digit run without one is touched, because a masked account number or date is a
row the parser can no longer read — failing closed here is not the safe
direction, it is just a different failure.
"""

import re

import pytest
from parser import masking

# Every VND spelling seen in Vietnamese bank, wallet and receipt mail, as
# (body, expected). Only the digits change; spacing, separators, signs,
# brackets and the marker itself must come back exactly as written.
FORMATS = [
    # Suffixed marker, the common case.
    ("750.000 đ", "[MONEY_1] đ"),
    ("750.000đ", "[MONEY_1]đ"),
    ("750.000 VNĐ", "[MONEY_1] VNĐ"),
    ("750.000 VND", "[MONEY_1] VND"),
    ("750,000 đ", "[MONEY_1] đ"),
    ("750,000 VNĐ", "[MONEY_1] VNĐ"),
    ("750,000 VND", "[MONEY_1] VND"),
    ("750 000 đ", "[MONEY_1] đ"),
    ("750000 đ", "[MONEY_1] đ"),
    ("750000đ", "[MONEY_1]đ"),
    ("750000 VND", "[MONEY_1] VND"),
    # Decimals, in both conventions.
    ("1.250.000,50 đ", "[MONEY_1] đ"),
    ("1,250,000.50 VND", "[MONEY_1] VND"),
    # Prefixed marker.
    ("₫750.000", "₫[MONEY_1]"),
    ("₫ 750.000", "₫ [MONEY_1]"),
    ("VND 750.000", "VND [MONEY_1]"),
    ("VNĐ 750.000", "VNĐ [MONEY_1]"),
    ("đ750.000", "đ[MONEY_1]"),
    # Parenthesised marker, as MB eBanking writes it. A real mail failed with
    # "amount missing" because the `)` sat between marker and figure, so no
    # name was issued and the model had nothing to answer with.
    ("(VND) 20,000.00", "(VND) [MONEY_1]"),
    ("(VNĐ) 750.000", "(VNĐ) [MONEY_1]"),
    # Signed, and the accounting bracket form for a negative.
    ("+750.000 đ", "+[MONEY_1] đ"),
    ("-750.000 đ", "-[MONEY_1] đ"),
    ("(750.000 đ)", "([MONEY_1] đ)"),
    # Case is not significant on the codes.
    ("750.000 vnd", "[MONEY_1] vnd"),
    ("750.000 Vnd", "[MONEY_1] Vnd"),
    ("750.000 vnđ", "[MONEY_1] vnđ"),
]


@pytest.mark.parametrize(("body", "expected"), FORMATS)
def test_every_vnd_format_is_masked(body: str, expected: str) -> None:
    masked, _ = masking.mask(body)
    assert masked == expected


@pytest.mark.parametrize(("body", "expected"), FORMATS)
def test_masking_leaves_no_digit_of_the_figure_behind(body: str, expected: str) -> None:
    """The figure goes entirely, separators and all.

    A name replaces the whole figure rather than each digit: `750.000` becomes
    `[MONEY_1]`, not `[MONEY_1].[MONEY_2]`. So the check is that none of the
    original digits survive anywhere outside a name.
    """
    masked, _ = masking.mask(body)
    assert _digits_outside_names(masked) == ""


@pytest.mark.parametrize(("body", "expected"), FORMATS)
def test_everything_around_the_figure_survives(body: str, expected: str) -> None:
    """Signs, brackets, spacing and the marker come back exactly as written.

    This is the property the parser depends on: the labels and layout it
    matches against must be the ones the bank printed.
    """
    masked, _ = masking.mask(body)
    assert _without_names(masked) == _without_figures(body)


# What each format is worth, so the table can be checked as well as the text.
VALUES = [
    ("750.000 đ", 750000),
    ("750,000 VND", 750000),
    ("750 000 đ", 750000),
    ("750000đ", 750000),
    ("₫750.000", 750000),
    ("VND 750.000", 750000),
    ("1.250.000,50 đ", 1250000),  # the fraction is dropped: VND has no subunit
    ("1,250,000.50 VND", 1250000),
    ("(VND) 20,000.00", 20000),   # MB eBanking: parenthesised marker, .00 dropped
    ("(750.000 đ)", 750000),
    ("-750.000 đ", 750000),  # the sign stays in the text, not in the figure
]


@pytest.mark.parametrize(("body", "value"), VALUES)
def test_the_table_carries_the_figure(body: str, value: int) -> None:
    masked, table = masking.mask(body)
    assert table == {"[MONEY_1]": value}
    assert masking.restore("[MONEY_1]", table) == value


# Digit runs with no currency marker. Masking any of these would blind the
# parser to a field it needs, so each must come back untouched.
NOT_MONEY = [
    "OTP: 123456",
    "Mã giao dịch: FT2412345678",
    "Số tài khoản: 0123456789",
    "Ngày giao dịch: 23/08/2026",
    "Thời gian: 10:30:25",
    "Số hóa đơn: INV-2026-00125",
    "Số lượng: 750",
    "Hotline: 1900 545415",
    "Số điện thoại: 0912345678",
    "Tỷ giá 24.150",
    "Mã đơn hàng: SHOP-99823",
]


@pytest.mark.parametrize("body", NOT_MONEY)
def test_numbers_without_a_currency_marker_are_left_alone(body: str) -> None:
    masked, table = masking.mask(body)
    assert masked == body
    assert table == {}


def test_a_parenthesised_marker_after_a_number_is_not_money() -> None:
    """`3510146052001 (VND)` is an account number labelled with its currency.

    The widened gap on the prefixed pattern lets a marker reach past a closing
    bracket to the figure AFTER it. This is the other direction — marker after
    the digits, nothing following — and it must stay untouched, or every MB
    mail masks its own account number as an amount.
    """
    body = "Tài khoản trích nợ NGUYEN THU TRANG - 3510146052001 (VND)"
    masked, table = masking.mask(body)
    assert masked == body
    assert table == {}


def test_a_plain_word_starting_with_d_is_not_a_marker() -> None:
    """`đ` is a letter as well as a currency symbol.

    Without a figure beside it there is nothing to mask, and a word that
    merely begins with it must not drag the number before it into a match.
    """
    body = "Số lượng: 750 đơn hàng đã được giao"
    masked, table = masking.mask(body)
    assert masked == body
    assert table == {}


def test_several_figures_get_distinct_names() -> None:
    """The whole point of naming rather than blanking: the model can say which
    row is which because the rows are distinguishable."""
    body = "Số tiền giao dịch: +500.000 VND Số dư khả dụng: 12.345.678 VND"
    masked, table = masking.mask(body)

    assert masked == "Số tiền giao dịch: +[MONEY_1] VND Số dư khả dụng: [MONEY_2] VND"
    assert table == {"[MONEY_1]": 500000, "[MONEY_2]": 12345678}


def test_the_same_figure_twice_gets_two_names() -> None:
    # Position is what the model is being asked about, so two occurrences are
    # two answers even when they are worth the same.
    masked, table = masking.mask("Phí: 11.000 đ. Tổng phí: 11.000 đ")
    assert masked == "Phí: [MONEY_1] đ. Tổng phí: [MONEY_2] đ"
    assert table == {"[MONEY_1]": 11000, "[MONEY_2]": 11000}


def test_line_breaks_and_spacing_survive() -> None:
    body = "Ngân hàng ABC\n\n  Số tiền:   750.000 đ  \n  Số dư: 1.000.000đ\n"
    masked, _ = masking.mask(body)
    assert masked == "Ngân hàng ABC\n\n  Số tiền:   [MONEY_1] đ  \n  Số dư: [MONEY_2]đ\n"


def test_a_mail_mixing_money_and_reference_numbers() -> None:
    """The realistic case: both kinds of number in one body."""
    body = (
        "Số tài khoản: 19001234567\n"
        "Ngày: 23/08/2026 10:30:25\n"
        "Số tiền giao dịch: -750.000 VND\n"
        "Mã GD: FT2412345678\n"
        "Số dư: 12.345.678 VND"
    )
    masked, table = masking.mask(body)

    assert "19001234567" in masked
    assert "23/08/2026" in masked
    assert "FT2412345678" in masked
    assert "750.000" not in masked
    assert "12.345.678" not in masked
    assert table == {"[MONEY_1]": 750000, "[MONEY_2]": 12345678}


def test_empty_string() -> None:
    assert masking.mask("") == ("", {})


def test_content_with_no_money_at_all() -> None:
    body = "Kính gửi Quý khách,\nCảm ơn Quý khách đã sử dụng dịch vụ."
    assert masking.mask(body) == (body, {})


def test_masking_is_idempotent() -> None:
    """Masking an already-masked body must not change it again.

    The names contain digits, so a second pass that treated `[MONEY_1] VND` as
    a figure beside a marker would mask the name itself.
    """
    body = "Số tiền: 750.000 đ, số dư ₫1.000.000, phí (11.000 VND)"
    once, _ = masking.mask(body)
    twice, table = masking.mask(once)

    assert twice == once
    assert table == {}


def test_a_second_pass_does_not_reuse_names() -> None:
    """Text that already carries names, plus a figure that does not.

    Counting from the highest name present keeps the new figure from being
    given a name that already means something else.
    """
    masked, table = masking.mask("Đã trả [MONEY_1] đ, còn nợ 250.000 đ")
    assert masked == "Đã trả [MONEY_1] đ, còn nợ [MONEY_2] đ"
    assert table == {"[MONEY_2]": 250000}


RESTORE_REJECTS = [
    (None, "nothing answered"),
    ("", "empty"),
    ("750000", "a figure the model invented"),
    (750000, "a figure, as an int"),
    ("[MONEY_99]", "a name never issued"),
    ("MONEY_1", "not a name at all"),
    ("[MONEY_1] VND", "a name with the marker attached"),
]


@pytest.mark.parametrize(("value", "why"), RESTORE_REJECTS)
def test_restore_rejects_anything_it_did_not_issue(value: object, why: str) -> None:
    """Every one of these reads as None rather than raising.

    A model that answers with a number has invented it — it was shown none —
    and inventions must not reach a ledger. The pipeline already treats a
    reading with no amount as unreadable, which is the right outcome.
    """
    assert masking.restore(value, {"[MONEY_1]": 750000}) is None


def test_restore_tolerates_surrounding_whitespace() -> None:
    assert masking.restore("  [MONEY_1] ", {"[MONEY_1]": 750000}) == 750000


_NAME = re.compile(r"\[MONEY_\d+\]")

# A figure as the masker sees one: digits and the separators between them.
_FIGURE = re.compile(r"\d[\d.,\u00a0\u202f ]*\d|\d")


def _without_names(masked: str) -> str:
    """The masked text with every name deleted."""
    return _NAME.sub("", masked)


def _without_figures(body: str) -> str:
    """The original with every figure deleted, so the two can be compared."""
    return _FIGURE.sub("", body)


def _digits_outside_names(masked: str) -> str:
    """Any digit of the original that survived masking.

    The names contain digits of their own, so they are removed before looking.
    """
    return "".join(c for c in _without_names(masked) if c.isdigit())


# ---------------------------------------------------------------- email

EMAILS = [
    ("Liên hệ: an.nguyen@example.com", "Liên hệ: [EMAIL_1]"),
    ("noreply@techcombank.com.vn gửi", "[EMAIL_1] gửi"),
    ("<hoa+bank@gmail.com>", "<[EMAIL_1]>"),
    ("TEN.KH@VIETCOMBANK.COM.VN", "[EMAIL_1]"),
    ("a_b-c.d%e@sub.domain.co", "[EMAIL_1]"),
]


@pytest.mark.parametrize(("body", "expected"), EMAILS)
def test_addresses_are_masked(body: str, expected: str) -> None:
    masked, _ = masking.mask(body)
    assert masked == expected


def test_the_table_carries_the_address_as_written() -> None:
    masked, table = masking.mask("Từ: An.Nguyen@Example.COM")
    assert masked == "Từ: [EMAIL_1]"
    assert table == {"[EMAIL_1]": "An.Nguyen@Example.COM"}


# Text that is not an address, and must survive untouched. The domain rules
# are what separate these from the real thing.
NOT_EMAIL = [
    "Số tiền @ 750 nghìn",
    "giao@dich",          # no dot in the domain
    "@techcombank",       # a handle, not an address
    "user@localhost",     # no TLD
    "nguyen@.com",        # empty domain label
    "Mã: FT24@1234",      # no letters-only TLD
]


@pytest.mark.parametrize("body", NOT_EMAIL)
def test_text_that_is_not_an_address_is_left_alone(body: str) -> None:
    masked, table = masking.mask(body)
    assert masked == body
    assert table == {}


# ---------------------------------------------------------------- both kinds


def test_money_and_email_are_numbered_separately() -> None:
    """Each prefix counts on its own, so the two never share an index and a
    name always says which kind it is."""
    body = "Từ a@b.com: 500.000 đ. Từ c@d.com: 12.000 đ"
    masked, table = masking.mask(body)

    assert masked == "Từ [EMAIL_1]: [MONEY_1] đ. Từ [EMAIL_2]: [MONEY_2] đ"
    assert table == {
        "[EMAIL_1]": "a@b.com",
        "[EMAIL_2]": "c@d.com",
        "[MONEY_1]": 500000,
        "[MONEY_2]": 12000,
    }


def test_masking_both_kinds_is_idempotent() -> None:
    body = "Từ an@example.com, số tiền 750.000 đ, số dư ₫1.000.000"
    once, _ = masking.mask(body)
    twice, table = masking.mask(once)

    assert twice == once
    assert table == {}


def test_a_caller_can_ask_for_fewer_kinds() -> None:
    """`kinds` narrows what is masked, for a stage that needs one in the clear.
    Widening it is a code change here, not a parameter."""
    body = "Từ an@example.com, số tiền 750.000 đ"
    masked, table = masking.mask(body, kinds=(masking.MONEY,))

    assert masked == "Từ an@example.com, số tiền [MONEY_1] đ"
    assert table == {"[MONEY_1]": 750000}


# ---------------------------------------------------------------- restore


def test_restore_returns_an_address_for_an_address_name() -> None:
    _, table = masking.mask("an@example.com")
    assert masking.restore("[EMAIL_1]", table) == "an@example.com"


def test_restore_int_refuses_a_name_of_the_wrong_kind() -> None:
    """An amount answered with an address's name is not an amount.

    Without the kind check this would return a string into a field the ledger
    reads as a number.
    """
    _, table = masking.mask("an@example.com")
    assert masking.restore_int("[EMAIL_1]", table) is None


def test_a_clock_time_after_an_amount_is_not_money() -> None:
    """From a real inbox: `Số dư: 5.750.000 VND 5:26 PM`.

    Two things went wrong here at once. The VND belongs to the figure before
    it, but the prefixed pattern spent the same marker a second time on the
    figure after it — and that figure was the hour of a clock time. The result
    was `[MONEY_n]:26 PM`, an amount of 5 dong invented out of a timestamp.
    """
    body = "Số dư: 5.750.000 VND 5:26 PM"
    masked, table = masking.mask(body)

    assert masked == "Số dư: [MONEY_1] VND 5:26 PM"
    assert table == {"[MONEY_1]": 5750000}


def test_a_marker_is_not_spent_twice() -> None:
    # The general form of the bug above: one marker, one figure.
    masked, table = masking.mask("Số dư: 6.750.000 VND 4 giao dịch")
    assert masked == "Số dư: [MONEY_1] VND 4 giao dịch"
    assert table == {"[MONEY_1]": 6750000}


def test_a_real_bank_notice_line() -> None:
    """One line as it arrives, after strip_html, from a live mailbox."""
    body = (
        "Tài khoản 0123456789 phát sinh giao dịch: "
        "Số tiền: -250.000 VND Nội dung: THANH TOAN MOMO "
        "Số dư: 6.750.000 VND 5:26 PM"
    )
    masked, table = masking.mask(body)

    assert masked == (
        "Tài khoản 0123456789 phát sinh giao dịch: "
        "Số tiền: -[MONEY_1] VND Nội dung: THANH TOAN MOMO "
        "Số dư: [MONEY_2] VND 5:26 PM"
    )
    assert table == {"[MONEY_1]": 250000, "[MONEY_2]": 6750000}
