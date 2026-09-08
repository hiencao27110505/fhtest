import parser
import pytest
from parser import detection, label_table
from parser.models import EmailInput, MatchStatus, ParseFailureCode
from parser.normalization import normalize_email, normalize_subject, normalize_text

FIXTURES = (
    (
        "mbbank",
        "Thông báo giao dịch thành công",
        "Số tiền giao dịch: -337.900 VND · "
        "Ngày, giờ giao dịch: 25-08-2026 18:52:04 · Điểm giao dịch: CUA HANG A",
        337900,
        "debit",
    ),
    (
        "vietcombank",
        "Biên lai nhận tiền #FT123456789 23/08/2026",
        "Số tiền: +500.000 VND · Vào lúc: 11:11 Chủ Nhật 23/08/2026 · "
        "Tên người chuyển: NGUYEN VAN A",
        500000,
        "credit",
    ),
    (
        "vib",
        "Thông báo thanh toán thẻ tín dụng",
        "Transaction Amount: -1,250,000 VND · "
        "Transaction Date: 26/08/2026 20:04:26 · Merchant: SHOP B",
        1250000,
        "debit",
    ),
    (
        "techcombank",
        "Thông báo biến động số dư",
        "Số tiền giao dịch: +750.000 VND · "
        "Thời gian giao dịch: 21/08/2026 13:15 · "
        "Tên người chuyển: NGUOI GUI · Nội dung: NHAN TIEN",
        750000,
        "credit",
    ),
    (
        "momo",
        "Bạn đã thanh toán thành công",
        "Tổng tiền: 165.000đ · Thời gian giao dịch: 21/08/2026 13:15 · Merchant: DICH VU C",
        165000,
        "debit",
    ),
)


@pytest.mark.parametrize("source,subject,body,amount,direction", FIXTURES)
def test_supported_anonymised_templates(source, subject, body, amount, direction, monkeypatch):
    monkeypatch.setattr(parser.llm, "enabled", lambda: False)
    result = parser.parse(EmailInput(source, subject, body), None)
    assert result.ok, result.reasons
    assert result.stage == "label_table"
    assert result.reading.amount == amount
    assert result.reading.direction == direction


def test_normalization_is_idempotent_and_normalizes_subject_shape():
    raw = "\ufeffSố\xa0tiền\n\n500.000 VND · 500.000 VND"
    once = normalize_text(raw)
    assert normalize_text(once) == once
    assert normalize_subject("Fwd: Biên lai #FT123456 23/08/2026") == "biên lai"


def test_detection_uses_subject_and_body_signals():
    email = normalize_email(EmailInput("mbbank", "Thông báo", "Số tiền: +50.000 VND · Ghi có"))
    found = detection.detect(email)
    assert found.status == MatchStatus.PARTIAL
    assert found.transaction_type == "incoming"


def test_absorber_amount_and_footer_merchant_do_not_win():
    email = normalize_email(
        EmailInput(
            "vcb",
            "Thanh toán thành công",
            "Số tiền khuyến mãi: 50.000 VND · Số tiền: -200.000 VND · "
            "Thời gian giao dịch: 21/08/2026 13:15 · "
            "Merchant: SHOP · "
            "liên hệ với các điểm giao dịch của Vietcombank trong giờ hành chính: Hotline",
        )
    )
    attempt = label_table.parse(email)
    assert attempt.extraction is not None
    assert attempt.extraction.amount == 200000
    assert attempt.extraction.merchant == "shop"


def test_declined_status_is_invalid_even_when_amount_is_present():
    email = normalize_email(
        EmailInput(
            "mbbank",
            "Thông báo giao dịch",
            "Số tiền: -200.000 VND · Trạng thái: Giao dịch thất bại",
        )
    )
    attempt = label_table.parse(email)
    assert attempt.status == MatchStatus.INVALID


def test_foreign_currency_does_not_use_vnd_deterministic_reader():
    email = normalize_email(
        EmailInput(
            "vib",
            "Card purchase",
            "Transaction Amount: USD 111.00 · "
            "Transaction Date: 21/08/2026 13:15 · Merchant: SERVICE",
        )
    )
    attempt = label_table.parse(email)
    assert attempt.status == MatchStatus.PARTIAL
    assert attempt.extraction is None


def test_account_tail_never_keeps_a_full_number():
    assert parser.spec.account_tail("1900123456789") == "6789"


def test_structured_failure_has_no_mail_values(monkeypatch):
    monkeypatch.setattr(parser.llm, "enabled", lambda: False)
    secret = "SECRET-CUSTOMER-123"
    result = parser.parse(EmailInput("acb", "Private subject", secret), None)
    assert result.failure_code == ParseFailureCode.LLM_UNAVAILABLE
    assert secret not in " ".join(result.reasons)
