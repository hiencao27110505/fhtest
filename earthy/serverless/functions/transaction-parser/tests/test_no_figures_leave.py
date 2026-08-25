"""The end-to-end claim: nothing sensitive in a family's mail reaches the network.

Every other test here stubs `llm._ask`, which is the right seam for asking
what the pipeline does with an answer. It is the wrong seam for asking what
was sent, because it sits on this side of the client that does the sending.

So these stub `genai.Client` instead — the last thing before the request — and
read what it was handed. If a figure or an address appears in that text it is
on its way to a third party, whatever the layers above intended.
"""

import pytest
from parser import llm, pipeline

# A realistic notice: transaction amount, balance, account number, reference,
# and a date, so a leak of any one of them would show up here.
TCB_CREDIT = (
    "Ngân hàng Techcombank thông báo: "
    "Số tài khoản: 19001234567 "
    "Số tiền giao dịch: +500.000 VND "
    "Số dư khả dụng: 12.345.678 VND "
    "Ngày: 23/08/2026 "
    "Liên hệ: hotro@techcombank.com.vn "
    "Nội dung: CHUYEN TIEN CHO ME"
)

# The figures that must never appear in a prompt, in every spelling the mail
# or a careless formatter might produce.
FIGURES = ["500.000", "500,000", "500000", "12.345.678", "12,345,678", "12345678"]


class _Recorder:
    """Stands in for the genai client, keeping every prompt it was sent."""

    prompts: list[str] = []

    def __init__(self, *args, **kwargs):
        self.interactions = self

    def create(self, **kwargs):
        _Recorder.prompts.append(kwargs["input"])
        # Answers in placeholders, as the real model is instructed to.
        answer = llm.Answer(
            amount="[MONEY_1]", balance="[MONEY_2]", direction="credit"
        ).model_dump_json()
        return type("I", (), {"output_text": answer})()


@pytest.fixture
def sent(monkeypatch: pytest.MonkeyPatch) -> list[str]:
    """Every prompt that reached the client, for one run."""
    import google.genai

    _Recorder.prompts = []
    monkeypatch.setenv("GEMINI_API_KEY", "k")
    monkeypatch.setattr(google.genai, "Client", _Recorder)
    return _Recorder.prompts


def test_the_extract_call_carries_no_figure(sent: list[str]) -> None:
    llm.extract(TCB_CREDIT)

    assert len(sent) == 1
    for figure in FIGURES:
        assert figure not in sent[0], f"{figure} was sent to the model"


def test_the_extract_call_still_carries_the_labels(sent: list[str]) -> None:
    """Masking must not cost the model what it needs to answer.

    Withholding the figures is only viable because the labels, the layout and
    the sign are what the question is actually about.
    """
    llm.extract(TCB_CREDIT)

    for label in ("Số tiền giao dịch", "Số dư khả dụng", "Nội dung"):
        assert label in sent[0]
    assert "+[MONEY_1]" in sent[0]  # the sign survives, beside its figure's name


def test_a_full_parse_leaks_nothing_and_still_reads_the_mail(
    sent: list[str], monkeypatch: pytest.MonkeyPatch
) -> None:
    """The whole cascade, with no stored spec, so it reaches the model.

    Both halves matter: nothing leaked, and the mail was still read correctly.
    A masker that broke parsing would pass the first assertion alone.
    """
    # induce runs after extract and gets its own recorded prompt.
    monkeypatch.setattr(llm, "induce", lambda text, reading: None)

    result = pipeline.parse("techcombank", TCB_CREDIT)

    assert result.ok
    assert result.reading is not None
    assert result.reading.amount == 500000
    assert result.reading.balance == 12345678
    assert result.reading.direction == "credit"

    for prompt in sent:
        for figure in FIGURES:
            assert figure not in prompt, f"{figure} was sent to the model"


def test_the_induce_call_carries_no_figure(sent: list[str]) -> None:
    """induce gets the same masked copy extract does.

    Not a copy with every digit blanked, which is what it used to get: a body
    reading `luc ##:##:## ##/##/####` gives the model no way to tell a
    timestamp from a reference, so it proposed labels for neither and the
    learned spec dropped `occurred_at` and `reference` on every mail after the
    first.

    What must not appear is a figure. A date and an account number are digits
    the model has to see to recognise the rows they sit in.
    """
    llm.induce(TCB_CREDIT, llm.Reading(amount=500000, balance=12345678, direction="credit"))

    assert len(sent) == 1
    for figure in FIGURES:
        assert figure not in sent[0], f"{figure} was sent to the model"
    assert "[MONEY_1]" in sent[0]


def test_the_induce_call_still_carries_a_date(sent: list[str]) -> None:
    """The point of the change: a timestamp has to survive into the prompt or
    no spec will ever learn to read one."""
    llm.induce(TCB_CREDIT, llm.Reading(amount=500000, direction="credit"))

    assert "23/08/2026" in sent[0]


def test_the_extract_call_carries_no_address(sent: list[str]) -> None:
    """Addresses are masked for the same reason figures are: the model needs
    to know a contact row is there, never who is in it."""
    llm.extract(TCB_CREDIT)

    assert "hotro@techcombank.com.vn" not in sent[0]
    assert "[EMAIL_1]" in sent[0]
    assert "Liên hệ" in sent[0]  # the label still says what the row is


def test_no_prompt_carries_an_account_number_either(sent: list[str]) -> None:
    """Not this task's job, but worth knowing where it stands.

    The account number is NOT masked by `masking` — it carries no currency
    marker, and masking it would blind the parser to a field. It survives into
    the extract prompt, and this test records that deliberately rather than
    leaving it to be discovered.
    """
    llm.extract(TCB_CREDIT)

    assert "19001234567" in sent[0]
