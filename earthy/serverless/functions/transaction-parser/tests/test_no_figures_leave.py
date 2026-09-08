"""The temporary raw-content contract at the Gemini network seam."""

import pytest
from parser import llm, pipeline

TCB_CREDIT = (
    "Ngân hàng Techcombank thông báo: "
    "Số tài khoản: 19001234567 "
    "Số tiền giao dịch: +500.000 VND "
    "Số dư khả dụng: 12.345.678 VND "
    "Ngày: 23/08/2026 "
    "Liên hệ: hotro@techcombank.com.vn "
    "Nội dung: CHUYEN TIEN CHO ME"
)


class _Recorder:
    prompts: list[str] = []

    def __init__(self, *args, **kwargs):
        self.interactions = self

    def create(self, **kwargs):
        _Recorder.prompts.append(kwargs["input"])
        answer = llm.Answer(amount=500000, balance=12345678, direction="credit").model_dump_json()
        return type("I", (), {"output_text": answer})()


@pytest.fixture
def sent(monkeypatch: pytest.MonkeyPatch) -> list[str]:
    import google.genai

    _Recorder.prompts = []
    monkeypatch.setenv("GEMINI_API_KEY", "k")
    monkeypatch.setattr(google.genai, "Client", _Recorder)
    return _Recorder.prompts


def test_extract_sends_normalized_mail_as_written(sent: list[str]) -> None:
    llm.extract(TCB_CREDIT)

    assert len(sent) == 1
    for value in (
        "500.000",
        "12.345.678",
        "19001234567",
        "hotro@techcombank.com.vn",
    ):
        assert value in sent[0]
    assert "[MONEY_" not in sent[0]
    assert "[EMAIL_" not in sent[0]


def test_full_parse_reads_numeric_response(sent: list[str], monkeypatch) -> None:
    monkeypatch.setattr(llm, "induce", lambda text, reading: None)

    result = pipeline.parse("techcombank", TCB_CREDIT)

    assert result.ok
    assert result.reading is not None
    assert result.reading.amount == 500000
    assert result.reading.balance == 12345678
    assert result.reading.direction == "credit"


def test_induce_also_receives_raw_values(sent: list[str]) -> None:
    llm.induce(
        TCB_CREDIT,
        llm.Reading(amount=500000, balance=12345678, direction="credit"),
    )

    assert len(sent) == 1
    assert "500.000" in sent[0]
    assert "23/08/2026" in sent[0]
    assert "19001234567" in sent[0]


def test_prompt_explicitly_guards_common_amount_confusions() -> None:
    prompt = llm._EXTRACT_PROMPT
    for rule in (
        "account balance",
        "fee",
        "cashback",
        "reference number",
        "non-negative integers",
        "failed, declined, cancelled or pending",
    ):
        assert rule in prompt
