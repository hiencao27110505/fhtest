import pytest
from parser import spec

TCB_CREDIT = (
    "Ngân hàng Techcombank thông báo: "
    "Số tài khoản: 19001234567 "
    "Số tiền giao dịch: +500.000 VND "
    "Số dư khả dụng: 12.345.678 VND "
    "Nội dung: CHUYEN TIEN CHO ME    Cảm ơn quý khách."
)

TCB_SPEC = spec.Spec.from_dict(
    {
        "amount": {"label": "Số tiền giao dịch", "type": "money"},
        "balance": {"label": "Số dư khả dụng", "type": "money"},
        "direction": {"label": "Số tiền giao dịch", "type": "sign"},
        "merchant": {"label": "Nội dung", "type": "text"},
    }
)


def test_reads_every_field_off_a_bank_template():
    result = spec.apply(TCB_SPEC, TCB_CREDIT)
    assert result.amount == 500000
    assert result.balance == 12345678
    assert result.direction == "credit"
    assert result.merchant.startswith("chuyen tien cho me")


def test_trailing_prose_is_kept_when_no_label_follows():
    # "Nội dung" is the last row, so its value runs to the end of the window
    # and picks up the sign-off. Left as-is deliberately: the boundary can only
    # be known from a label, and guessing it cost more than it saved. Money is
    # unaffected, and validate.check does not read merchant.
    assert spec.apply(TCB_SPEC, TCB_CREDIT).merchant.endswith("cảm ơn quý khách.")


def test_minus_sign_reads_as_debit():
    text = TCB_CREDIT.replace("+500.000", "-500.000")
    assert spec.apply(TCB_SPEC, text).direction == "debit"


def test_amount_is_not_confused_with_balance():
    # The single most common parsing error: the balance is the larger figure
    # and appears in the same table.
    result = spec.apply(TCB_SPEC, TCB_CREDIT)
    assert result.amount != result.balance


def test_comma_grouping():
    text = "Số tiền giao dịch: 1,234,567 VND"
    assert spec.apply(TCB_SPEC, text).amount == 1234567


def test_bare_digits_without_grouping():
    assert spec.apply(TCB_SPEC, "Số tiền giao dịch: 500000 VND").amount == 500000


def test_missing_label_reads_as_none_rather_than_raising():
    # A drifted template must escalate, not blow up: raising here would make
    # Pub/Sub redeliver forever.
    result = spec.apply(TCB_SPEC, "Ngân hàng thông báo một giao dịch.")
    assert result.amount is None
    assert result.balance is None


def test_label_present_but_no_figure_after_it():
    assert spec.apply(TCB_SPEC, "Số tiền giao dịch: đang cập nhật").amount is None


def test_footer_legend_does_not_shadow_the_real_row():
    # The bank explains its own field names below the table. The legend has no
    # figure after it, so the row that does must still win.
    text = (
        "Số dư khả dụng: là số tiền còn lại trong tài khoản của quý khách. "
        "Số tiền giao dịch: 500.000 VND "
        "Số dư khả dụng: 12.345.678 VND"
    )
    assert spec.apply(TCB_SPEC, text).balance == 12345678


def test_label_matching_ignores_html_whitespace_layout():
    text = "Số   tiền\n  giao   dịch :\n\n  500.000 VND"
    assert spec.apply(TCB_SPEC, text).amount == 500000


def test_merchant_stops_at_the_next_label():
    text = "Nội dung: CHUYEN TIEN Số dư khả dụng: 12.345.678 VND"
    assert spec.apply(TCB_SPEC, text).merchant == "chuyen tien"


def test_no_sign_means_no_direction():
    # A spec reads direction from a printed sign, or carries it as "fixed".
    # Neither applies here, so there is nothing to report.
    assert spec.apply(TCB_SPEC, "Số tiền giao dịch: 500.000 VND").direction is None


def test_value_far_past_the_label_is_not_picked_up():
    # Guards against a missing value silently borrowing the next row's figure.
    text = "Số tiền giao dịch: " + "x" * 200 + " 500.000 VND"
    assert spec.apply(TCB_SPEC, text).amount is None


def test_round_trips_through_the_database_shape():
    assert spec.Spec.from_dict(TCB_SPEC.to_dict()) == TCB_SPEC


def test_labels_are_normalized_on_load():
    loaded = spec.Spec.from_dict({"amount": {"label": "  Số   Tiền  ", "type": "money"}})
    assert loaded.rules["amount"].label == "số tiền"


@pytest.mark.parametrize(
    "bad",
    [
        {},
        {"amount": {"label": "x", "type": "regex"}},
        {"amount": {"label": "", "type": "money"}},
        {"amount": {"label": "x"}},
        {"balance": {"label": "x", "type": "money"}},  # no amount
        {"amount": "Số tiền"},
        {"total": {"label": "x", "type": "money"}},
        [],
    ],
)
def test_malformed_specs_are_rejected_at_load(bad):
    # Validation happens once, on the way out of the database, so a bad spec is
    # a loud failure on the template rather than a wrong number on a payment.
    with pytest.raises(spec.InvalidSpec):
        spec.Spec.from_dict(bad)


def test_a_label_that_looks_like_a_regex_is_matched_literally():
    # The whole point of the format: a stored label is data, never a pattern.
    literal = spec.Spec.from_dict({"amount": {"label": "Tổng (.*) cộng", "type": "money"}})
    # Matches only where the label appears verbatim...
    assert spec.apply(literal, "Tổng (.*) cộng: 500.000 VND").amount == 500000
    # ...and not where it would match if it were treated as a pattern.
    assert spec.apply(literal, "Tổng 999 cộng: 500.000 VND").amount is None


def test_fixed_direction_needs_no_label_in_the_body():
    # Most Vietnamese bank mail prints no sign: which way the money moved is a
    # property of the notice ("Báo Có" vs "Báo Nợ"), not of a field in it.
    loaded = spec.Spec.from_dict(
        {
            "amount": {"label": "Gia tri", "type": "money"},
            "direction": {"label": "credit", "type": "fixed"},
        }
    )
    result = spec.apply(loaded, "Gia tri: 500.000 VND")
    assert result.amount == 500000
    assert result.direction == "credit"


def test_a_fixed_rule_may_only_carry_a_direction():
    with pytest.raises(spec.InvalidSpec):
        spec.Spec.from_dict(
            {
                "amount": {"label": "Gia tri", "type": "money"},
                "direction": {"label": "probably credit", "type": "fixed"},
            }
        )


def test_only_direction_may_be_fixed():
    # A fixed rule records a constant the template implies; it is not a way to
    # hard-code an amount.
    with pytest.raises(spec.InvalidSpec):
        spec.Spec.from_dict({"amount": {"label": "credit", "type": "fixed"}})
