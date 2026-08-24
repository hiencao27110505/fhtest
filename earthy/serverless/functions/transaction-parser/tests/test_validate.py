from parser import spec, validate
from parser.spec import Extracted

GOOD = Extracted(amount=500_000, balance=12_345_678, direction="credit", merchant="chuyen tien")


def test_a_clean_extraction_passes():
    assert validate.check(GOOD)


def test_verdict_is_truthy_and_falsy():
    assert bool(validate.check(GOOD)) is True
    assert bool(validate.check(Extracted())) is False


def test_missing_amount_fails():
    verdict = validate.check(Extracted(direction="credit"))
    assert not verdict
    assert "amount missing" in verdict.reasons


def test_missing_direction_fails():
    # Posting money without knowing which way it moved is worse than not
    # posting it at all.
    verdict = validate.check(Extracted(amount=500_000))
    assert not verdict
    assert "direction missing" in verdict.reasons


def test_amount_equal_to_balance_fails():
    # The spec anchored onto the balance row instead of the amount row.
    verdict = validate.check(Extracted(amount=12_345_678, balance=12_345_678, direction="debit"))
    assert not verdict
    assert "amount equals balance" in verdict.reasons


def test_amount_below_the_floor_fails():
    verdict = validate.check(Extracted(amount=999, balance=None, direction="debit"))
    assert not verdict
    assert any("below" in reason for reason in verdict.reasons)


def test_amount_above_the_ceiling_fails():
    # A misplaced thousands separator: 500.000 read as 500.000.000.
    verdict = validate.check(Extracted(amount=500_000_001, direction="debit"))
    assert not verdict
    assert any("above" in reason for reason in verdict.reasons)


def test_boundaries_are_inclusive():
    assert validate.check(Extracted(amount=validate.MIN_AMOUNT, direction="debit"))
    assert validate.check(Extracted(amount=validate.MAX_AMOUNT, direction="debit"))


def test_negative_balance_fails():
    verdict = validate.check(Extracted(amount=500_000, balance=-1, direction="debit"))
    assert not verdict
    assert "balance negative" in verdict.reasons


def test_unknown_direction_value_fails():
    verdict = validate.check(Extracted(amount=500_000, direction="refund"))
    assert not verdict
    assert any("not credit/debit" in reason for reason in verdict.reasons)


def test_reasons_accumulate():
    verdict = validate.check(Extracted())
    assert "amount missing" in verdict.reasons
    assert "direction missing" in verdict.reasons


def test_plus_sign_contradicting_debit_fails():
    # This is the check that stops a credit template being applied to a debit
    # notice, which is the failure mode that matters most.
    text = "Số tiền giao dịch: +500.000 VND"
    verdict = validate.check(Extracted(amount=500_000, direction="debit"), text)
    assert not verdict
    assert any("sign is +" in reason for reason in verdict.reasons)


def test_minus_sign_contradicting_credit_fails():
    text = "Số tiền giao dịch: -500.000 VND"
    verdict = validate.check(Extracted(amount=500_000, direction="credit"), text)
    assert not verdict
    assert any("sign is -" in reason for reason in verdict.reasons)


def test_sign_agreeing_with_direction_passes():
    text = "Số tiền giao dịch: +500.000 VND"
    assert validate.check(Extracted(amount=500_000, direction="credit"), text)


def test_sign_check_handles_every_grouping_style():
    for printed in ("-1.234.567", "-1,234,567", "-1234567"):
        verdict = validate.check(
            Extracted(amount=1_234_567, direction="credit"), f"Số tiền: {printed} VND"
        )
        assert not verdict, printed


def test_sign_separated_by_a_space_is_still_read():
    verdict = validate.check(Extracted(amount=500_000, direction="credit"), "Số tiền: - 500.000")
    assert not verdict


def test_no_sign_in_the_body_is_not_a_conflict():
    # Most banks print no sign at all; direction comes from wording instead.
    assert validate.check(Extracted(amount=500_000, direction="credit"), "Số tiền: 500.000 VND")


def test_both_signs_present_is_not_a_conflict():
    # A statement listing several rows says nothing about which row was read.
    text = "Ghi có: +500.000 VND Ghi nợ: -500.000 VND"
    assert validate.check(Extracted(amount=500_000, direction="credit"), text)


def test_sign_check_is_skipped_without_the_body():
    assert validate.check(Extracted(amount=500_000, direction="credit"))


def test_judges_a_spec_result_and_an_llm_result_alike():
    # Both paths go through the same gate; nothing is trusted for its origin.
    applied = spec.apply(
        spec.Spec.from_dict(
            {
                "amount": {"label": "Số tiền giao dịch", "type": "money"},
                "direction": {"label": "Số tiền giao dịch", "type": "sign"},
            }
        ),
        "Số tiền giao dịch: +500.000 VND",
    )
    assert validate.check(applied, "Số tiền giao dịch: +500.000 VND")
