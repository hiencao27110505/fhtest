"""The end-to-end claim: the mail reaches the model as the bank wrote it.

NOTE ON THE FILENAME. This file was `test_no_figures_leave` because the claim
used to be the opposite one — every figure masked before the body left the
machine. That design was reversed deliberately (see `parser/llm`), so the name
now describes a policy that is gone. It is kept rather than renamed because
renaming a file across a shared repo is how two sessions lose work; whoever owns
this package should rename it to `test_mail_reaches_the_model`.

WHY THE POLICY CHANGED. Masking worked and it cost accuracy invisibly. A model
shown `[MONEY_1]` and `[MONEY_2]` cannot use the SIZE of a figure as evidence,
and size is most of how a balance is told from an amount in a Vietnamese notice.
It hurt `induce` worse still: that call derives a rule which then runs on real
mail with no model behind it, and a rule anchored against placeholder text is
anchored against something the next mail will not contain — a confidently wrong
spec rather than no spec. What carries the promise now is consent, recorded
against the person before any of this is collected, plus sealing everything the
model returns to the family's key before it is stored.

WHY THIS FILE STILL EARNS ITS PLACE. Every other test here stubs `llm._ask`,
which is the right seam for asking what the pipeline does with an answer and the
wrong one for asking what was SENT, because it sits on this side of the client
that does the sending. These stub `genai.Client` — the last thing before the
request — and read what it was handed. A masker reintroduced anywhere upstream
would not throw; it would quietly go back to costing accuracy on every reading,
and this is what would catch it.
"""

import pytest
from parser import llm, pipeline

# A realistic notice: transaction amount, balance, account number, reference,
# and a date, so every kind of value shows up in what was sent.
TCB_CREDIT = (
    "Ngân hàng Techcombank thông báo: "
    "Số tài khoản: 19001234567 "
    "Số tiền giao dịch: +500.000 VND "
    "Số dư khả dụng: 12.345.678 VND "
    "Ngày: 23/08/2026 "
    "Liên hệ: hotro@techcombank.com.vn "
    "Nội dung: CHUYEN TIEN CHO ME"
)

# The figures the model has to be able to SEE to tell one row from another.
FIGURES = ["500.000", "12.345.678"]


class _Recorder:
    """Stands in for the genai client, keeping every prompt it was sent."""

    prompts: list[str] = []

    def __init__(self, *args, **kwargs):
        self.interactions = self

    def create(self, **kwargs):
        _Recorder.prompts.append(kwargs["input"])
        # Answers in figures, as the model is now instructed to.
        answer = llm.Answer(
            amount=500000, balance=12345678, direction="credit"
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


def test_the_extract_call_carries_the_figures(sent: list[str]) -> None:
    llm.extract(TCB_CREDIT)

    assert len(sent) == 1
    for figure in FIGURES:
        assert figure in sent[0], f"{figure} did not reach the model"


def test_no_prompt_carries_a_placeholder(sent: list[str]) -> None:
    """The specific regression to watch for: a masker put back upstream.

    It would not raise. The prompt would simply start carrying `[MONEY_1]`
    again, the model would answer with a name, the validator would refuse it as
    unreadable, and the symptom would be mail that stopped parsing for no
    visible reason.
    """
    llm.extract(TCB_CREDIT)

    assert "[MONEY_" not in sent[0]
    assert "[EMAIL_" not in sent[0]


def test_the_extract_call_asks_for_digits(sent: list[str]) -> None:
    """The instruction has to agree with the schema, or the model answers in a
    format the validator then drops."""
    llm.extract(TCB_CREDIT)

    assert "750000" in sent[0]          # the worked example in the rules
    assert "thousands separators" in sent[0]


def test_the_extract_call_still_carries_the_labels(sent: list[str]) -> None:
    """Labels and layout were always the point; now the values come too."""
    llm.extract(TCB_CREDIT)

    for label in ("Số tiền giao dịch", "Số dư khả dụng", "Nội dung"):
        assert label in sent[0]
    assert "+500.000" in sent[0]        # the sign survives, beside its figure


def test_a_full_parse_reaches_the_model_and_still_reads_the_mail(
    sent: list[str], monkeypatch: pytest.MonkeyPatch
) -> None:
    """The whole cascade, with no stored spec, so it reaches the model.

    Both halves matter: the body went as written, and the mail was read
    correctly. A change that broke parsing would pass the first assertion alone.
    """
    monkeypatch.setattr(llm, "induce", lambda text, reading: None)

    result = pipeline.parse("techcombank", TCB_CREDIT)

    assert result.ok
    assert result.reading is not None
    assert result.reading.amount == 500000
    assert result.reading.balance == 12345678
    assert result.reading.direction == "credit"

    for prompt in sent:
        assert "[MONEY_" not in prompt


def test_the_induce_call_carries_the_mail_as_written(sent: list[str]) -> None:
    """The call this change helps most.

    A label is located by finding the value it sits beside. Derive that from a
    body where the values have been replaced and the rule anchors against text
    the next mail will not contain.
    """
    llm.induce(TCB_CREDIT, llm.Reading(amount=500000, balance=12345678, direction="credit"))

    assert len(sent) == 1
    for figure in FIGURES:
        assert figure in sent[0], f"{figure} did not reach the model"
    assert "[MONEY_" not in sent[0]


def test_the_induce_call_still_carries_a_date(sent: list[str]) -> None:
    """A timestamp has to survive into the prompt or no spec will ever learn to
    read one. True under blanking, under masking, and still true now."""
    llm.induce(TCB_CREDIT, llm.Reading(amount=500000, direction="credit"))

    assert "23/08/2026" in sent[0]


def test_the_induce_call_is_told_what_was_read(sent: list[str]) -> None:
    """Field names say which rows to look for; the values say where they sit."""
    llm.induce(TCB_CREDIT, llm.Reading(amount=500000, direction="credit"))

    assert "amount=500000" in sent[0]


def test_the_contact_address_reaches_the_model_too(sent: list[str]) -> None:
    """Recorded rather than left to be discovered.

    The bank's own support address is in the body and goes with it. It is the
    bank's published address, not the family's, and singling it out for removal
    while the account number and the amount go through would be theatre.
    """
    llm.extract(TCB_CREDIT)

    assert "hotro@techcombank.com.vn" in sent[0]
    assert "Liên hệ" in sent[0]


def test_the_account_number_reaches_the_model(sent: list[str]) -> None:
    """Unchanged by this reversal — it was never masked, because it carries no
    currency marker and removing it would blind the parser to a field it
    reads."""
    llm.extract(TCB_CREDIT)

    assert "19001234567" in sent[0]
