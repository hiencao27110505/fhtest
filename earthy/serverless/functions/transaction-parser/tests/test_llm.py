import pytest
from parser import llm, spec, validate

TCB_CREDIT = (
    "Ngân hàng Techcombank thông báo: "
    "Số tài khoản: 19001234567 "
    "Số tiền giao dịch: +500.000 VND "
    "Số dư khả dụng: 12.345.678 VND "
    "Nội dung: CHUYEN TIEN CHO ME"
)


class _Stub:
    """Stands in for one `_ask` round. Records what it was asked."""

    def __init__(self, *answers):
        self.answers = list(answers)
        self.prompts: list[str] = []

    def __call__(self, prompt, schema):
        self.prompts.append(prompt)
        return self.answers.pop(0) if self.answers else None


def test_enabled_follows_the_api_key(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("GOOGLE_API_KEY", raising=False)
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    assert not llm.enabled()

    monkeypatch.setenv("GEMINI_API_KEY", "k")
    assert llm.enabled()


def test_redaction_removes_every_digit():
    redacted = llm.redact(TCB_CREDIT)
    assert not any(char.isdigit() for char in redacted)


def test_redaction_keeps_the_labels():
    # The whole point: the induce call needs the shape, never the values.
    redacted = llm.redact(TCB_CREDIT)
    for label in ("Số tiền giao dịch", "Số dư khả dụng", "Nội dung"):
        assert label in redacted


def test_induce_is_never_sent_the_real_figures(monkeypatch: pytest.MonkeyPatch) -> None:
    stub = _Stub(llm.ProposedSpec(rules=[]))
    monkeypatch.setattr(llm, "_ask", stub)

    llm.induce(TCB_CREDIT, llm.Reading(amount=500000, direction="credit"))

    sent = stub.prompts[0]
    assert "500.000" not in sent
    assert "12.345.678" not in sent
    assert "19001234567" not in sent


def test_extract_is_sent_the_real_figures(monkeypatch: pytest.MonkeyPatch) -> None:
    # The reading call does need them: that is what it is reading.
    stub = _Stub(llm.Reading(amount=500000, direction="credit"))
    monkeypatch.setattr(llm, "_ask", stub)

    llm.extract(TCB_CREDIT)

    assert "500.000" in stub.prompts[0]


def test_induce_returns_a_spec_shaped_dict(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        llm,
        "_ask",
        _Stub(
            llm.ProposedSpec(
                rules=[
                    llm.ProposedRule(field="amount", label="Số tiền giao dịch", type="money"),
                    llm.ProposedRule(field="balance", label="Số dư khả dụng", type="money"),
                ]
            )
        ),
    )

    proposed = llm.induce(TCB_CREDIT, llm.Reading(amount=500000))
    assert proposed == {
        "amount": {"label": "Số tiền giao dịch", "type": "money"},
        "balance": {"label": "Số dư khả dụng", "type": "money"},
    }


def test_a_proposed_spec_loads_and_reads_the_mail_it_came_from(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # The loop that makes the cache worth having: propose, load, apply, and the
    # result must survive validation like any other.
    monkeypatch.setattr(
        llm,
        "_ask",
        _Stub(
            llm.ProposedSpec(
                rules=[
                    llm.ProposedRule(field="amount", label="Số tiền giao dịch", type="money"),
                    llm.ProposedRule(field="balance", label="Số dư khả dụng", type="money"),
                    llm.ProposedRule(field="direction", label="Số tiền giao dịch", type="sign"),
                ]
            )
        ),
    )

    proposed = llm.induce(TCB_CREDIT, llm.Reading(amount=500000, direction="credit"))
    loaded = spec.Spec.from_dict(proposed)
    result = spec.apply(loaded, TCB_CREDIT)

    assert result.amount == 500000
    assert result.balance == 12345678
    assert result.direction == "credit"
    assert validate.check(result, TCB_CREDIT)


def test_trailing_colon_is_stripped_from_a_proposed_label(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # Models copy the colon about half the time; the spec engine matches the
    # separator itself, so leaving it in would break every lookup.
    monkeypatch.setattr(
        llm,
        "_ask",
        _Stub(
            llm.ProposedSpec(
                rules=[llm.ProposedRule(field="amount", label="Số tiền giao dịch: ", type="money")]
            )
        ),
    )

    proposed = llm.induce(TCB_CREDIT, llm.Reading())
    assert proposed is not None
    assert proposed["amount"]["label"] == "Số tiền giao dịch"


def test_an_empty_proposal_is_none_rather_than_an_empty_spec(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(llm, "_ask", _Stub(llm.ProposedSpec(rules=[])))
    assert llm.induce(TCB_CREDIT, llm.Reading()) is None


def test_a_failed_call_reads_as_none_not_an_exception(monkeypatch: pytest.MonkeyPatch) -> None:
    # Raising here would make Pub/Sub redeliver a mail that fails the same way
    # every time.
    monkeypatch.setattr(llm, "_ask", _Stub(None))
    assert llm.extract(TCB_CREDIT) is None
    monkeypatch.setattr(llm, "_ask", _Stub(None))
    assert llm.induce(TCB_CREDIT, llm.Reading()) is None


def test_ask_swallows_transport_failures(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("GOOGLE_API_KEY", "k")

    class _Exploding:
        def __init__(self, *args, **kwargs):
            raise RuntimeError("network is down")

    import google.genai

    monkeypatch.setattr(google.genai, "Client", _Exploding)
    assert llm._ask("prompt", llm.Reading) is None


def test_a_garbled_model_answer_reads_as_none(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("GOOGLE_API_KEY", "k")

    class _Interaction:
        output_text = "not json at all"

    class _Client:
        def __init__(self, *args, **kwargs):
            self.interactions = self

        def create(self, **kwargs):
            return _Interaction()

    import google.genai

    monkeypatch.setattr(google.genai, "Client", _Client)
    assert llm._ask("prompt", llm.Reading) is None


def test_the_body_is_clipped_before_it_is_sent(monkeypatch: pytest.MonkeyPatch) -> None:
    stub = _Stub(llm.Reading())
    monkeypatch.setattr(llm, "_ask", stub)

    llm.extract("x" * (llm.MAX_BODY_CHARS * 2))

    assert stub.prompts[0].count("x") == llm.MAX_BODY_CHARS


def test_the_request_carries_the_schema(monkeypatch: pytest.MonkeyPatch) -> None:
    # Guards the one thing a stubbed _ask cannot: that structured output is
    # actually requested, rather than JSON being hoped for.
    monkeypatch.setenv("GOOGLE_API_KEY", "k")
    seen: dict = {}

    class _Client:
        def __init__(self, *args, **kwargs):
            self.interactions = self

        def create(self, **kwargs):
            seen.update(kwargs)
            return type("I", (), {"output_text": llm.Reading(amount=1).model_dump_json()})()

    import google.genai

    monkeypatch.setattr(google.genai, "Client", _Client)
    llm._ask("prompt", llm.Reading)

    assert seen["model"] == llm.MODEL
    assert seen["response_format"]["schema"]["properties"].keys() >= {"amount", "direction"}
    assert seen["response_format"]["mime_type"] == "application/json"
    assert seen["timeout"] == llm.TIMEOUT_SECONDS
    # The API rejects the two together ("responseFormat must be set when
    # responseMimeType is set"), and a stubbed client cannot notice — so the
    # combination is asserted against here instead.
    assert "response_mime_type" not in seen
