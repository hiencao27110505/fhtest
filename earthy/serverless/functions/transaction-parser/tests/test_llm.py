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
    assert "[MONEY_1]" in sent
    # The account number is NOT masked — it carries no currency marker, and
    # masking it would blind the parser to a field it reads. Recorded here
    # rather than left to be discovered.
    assert "19001234567" in sent


def test_extract_is_never_sent_the_real_figures(monkeypatch: pytest.MonkeyPatch) -> None:
    """The reading call is not an exception to the rule.

    It used to be: reading the amount seemed to require sending it. Naming the
    figures instead lets the model say which row is the amount without being
    told what any row is worth.
    """
    stub = _Stub(llm.Answer(amount="[MONEY_1]", direction="credit"))
    monkeypatch.setattr(llm, "_ask", stub)

    llm.extract(TCB_CREDIT)

    sent = stub.prompts[0]
    assert "500.000" not in sent
    assert "12.345.678" not in sent
    assert "[MONEY_1]" in sent


def test_extract_exchanges_the_placeholders_back(monkeypatch: pytest.MonkeyPatch) -> None:
    # [MONEY_1] is the amount and [MONEY_2] the balance, in TCB_CREDIT's order.
    stub = _Stub(llm.Answer(amount="[MONEY_1]", balance="[MONEY_2]", direction="credit"))
    monkeypatch.setattr(llm, "_ask", stub)

    reading = llm.extract(TCB_CREDIT)

    assert reading is not None
    assert reading.amount == 500000
    assert reading.balance == 12345678
    assert reading.direction == "credit"


def test_a_figure_the_model_invented_is_dropped(monkeypatch: pytest.MonkeyPatch) -> None:
    """A model that answers with a number has not read one — every figure was
    masked before it saw the body — so the number is invention and must not
    reach a ledger."""
    stub = _Stub(llm.Answer(amount="750000", direction="credit"))
    monkeypatch.setattr(llm, "_ask", stub)

    reading = llm.extract(TCB_CREDIT)

    assert reading is not None
    assert reading.amount is None


def test_a_placeholder_that_was_never_issued_is_dropped(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    stub = _Stub(llm.Answer(amount="[MONEY_99]", direction="credit"))
    monkeypatch.setattr(llm, "_ask", stub)

    reading = llm.extract(TCB_CREDIT)

    assert reading is not None
    assert reading.amount is None


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
    stub = _Stub(llm.Answer())
    monkeypatch.setattr(llm, "_ask", stub)

    llm.extract("q" * (llm.MAX_BODY_CHARS * 2))

    # Counted on a letter the prompt itself does not use, so this measures the
    # body and not the instructions wrapped around it.
    assert stub.prompts[0].count("q") == llm.MAX_BODY_CHARS


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


def test_induce_carries_match_phrases_through(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        llm,
        "_ask",
        _Stub(
            llm.ProposedSpec(
                rules=[llm.ProposedRule(field="amount", label="Tổng tiền", type="money")],
                match=["Phiếu nhận tiền"],
            )
        ),
    )

    proposed = llm.induce(TCB_CREDIT, llm.Reading(amount=500000))
    assert proposed is not None
    assert proposed["match"] == ["Phiếu nhận tiền"]


def test_a_match_phrase_from_the_redaction_is_dropped(monkeypatch: pytest.MonkeyPatch) -> None:
    """induce reads a body whose digits are all '#'.

    A phrase copied from it that carries one would never appear in a real
    mail, so the spec would be stored and then never match — inert, and
    invisibly so.
    """
    monkeypatch.setattr(
        llm,
        "_ask",
        _Stub(
            llm.ProposedSpec(
                rules=[llm.ProposedRule(field="amount", label="Tổng tiền", type="money")],
                match=["Mã GD ###", "Phiếu nhận tiền"],
            )
        ),
    )

    proposed = llm.induce(TCB_CREDIT, llm.Reading(amount=500000))
    assert proposed is not None
    assert proposed["match"] == ["Phiếu nhận tiền"]


def test_no_match_key_when_the_model_offers_none(monkeypatch: pytest.MonkeyPatch) -> None:
    """An absent key, not an empty list: a spec with no phrases applies to any
    mail from its sender, which is the behaviour every spec had before."""
    monkeypatch.setattr(
        llm,
        "_ask",
        _Stub(
            llm.ProposedSpec(
                rules=[llm.ProposedRule(field="amount", label="Tổng tiền", type="money")]
            )
        ),
    )

    proposed = llm.induce(TCB_CREDIT, llm.Reading(amount=500000))
    assert proposed is not None
    assert "match" not in proposed


# The shape a real receipt has: a short greeting, the transaction table, then
# far more boilerplate than transaction.
_RECEIPT = (
    "Xin chào Trần Minh Quang · Cảm ơn bạn đã sử dụng dịch vụ của MoMo! · "
    "MoMo xác nhận bạn đã đặt vé xem phim thành công lúc 15:38:51 15/08/2026. · "
    "Mã đặt vé · 123456789 · Thời gian chiếu · 16:00:00 15/08/2026 · "
    "Rạp chiếu · CGV Hoàng Văn Thụ · Tổng tiền · 391.500 đ · "
)
_BOILERPLATE = (
    "Chính sách hoàn huỷ. MoMo không hỗ trợ đổi trả đối với các vé đã mua. "
    "Điều khoản sử dụng. Liên hệ hỗ trợ qua tổng đài. "
)


def test_a_short_body_is_not_clipped_at_all() -> None:
    assert llm._clip(_RECEIPT) == _RECEIPT


def test_the_clip_keeps_the_transaction_not_the_head() -> None:
    """The bug this replaced: `_clip` took the first N characters on the
    assumption that the table is near the top.

    Measured against real mail that is false — in four saved receipts the
    amount sat at ~92% of the body, behind navigation, a forwarded header, an
    AI summary and a signature. Every one lost its amount to the clip, and the
    mails parsed at all only because the stored-spec stage does not clip.
    """
    body = ("Trang chủ Ưu đãi Tải ứng dụng. " * 300) + _RECEIPT + (_BOILERPLATE * 200)
    assert len(body) > llm.MAX_BODY_CHARS

    clipped = llm._clip(body)

    assert len(clipped) <= llm.MAX_BODY_CHARS
    for field in ("Tổng tiền", "391.500", "Mã đặt vé", "Rạp chiếu", "15/08/2026"):
        assert field in clipped, field


def test_the_labels_before_the_figures_survive() -> None:
    """A window starting exactly on the first figure would cut the labels that
    name it, and a label is what a spec is learned from."""
    body = ("x" * 8000) + _RECEIPT + ("y" * 8000)
    clipped = llm._clip(body)

    assert "Tổng tiền" in clipped
    assert "Xin chào" in clipped  # the greeting just above the table


def test_a_body_with_no_transaction_falls_back_to_the_head() -> None:
    """Nothing anywhere looks like a transaction, so the head is as good a
    guess as any — and is what every caller used to get."""
    body = "Bản tin khuyến mãi. " * 2000
    assert llm._clip(body) == body[: llm.MAX_BODY_CHARS]


def test_induce_is_told_about_every_field_that_was_read() -> None:
    """The bug that made learned specs drop the timestamp.

    `_shape_of` listed four field names in a literal, written when a reading
    had four. After `occurred_at`, `reference`, `account_tail`, `description`
    and `channel` were added it silently kept saying four — so `induce` was
    never told a mail had a date in it, never proposed a label for one, and
    every learned spec read the amount but not the time on every mail after
    the first.

    Deriving the list from the model's own fields is what makes the next field
    impossible to forget.
    """
    reading = llm.Reading(
        amount=500000,
        direction="credit",
        occurred_at="2026-08-21 13:15:00",
        reference="FT2412345678",
        account_tail="4567",
    )

    shape = llm._shape_of(reading)

    for field in ("amount", "direction", "occurred_at", "reference", "account_tail"):
        assert field in shape, field
    # Fields that were not read are not claimed.
    assert "balance" not in shape


def test_the_shape_covers_every_field_a_reading_can_carry() -> None:
    """A field added to Reading and forgotten here is a field no spec ever
    learns to read."""
    everything = llm.Reading(
        amount=500000,
        balance=1000000,
        direction="credit",
        merchant="HIGHLANDS COFFEE",
        occurred_at="2026-08-21 13:15:00",
        reference="FT2412345678",
        account_tail="4567",
        description="Ca phe sang",
        channel="QR",
    )

    shape = llm._shape_of(everything)

    # Enumerated from the model rather than repeated here, so a field added to
    # Reading and forgotten in the constructor above fails this too.
    for field in llm.Reading.model_fields:
        assert field in shape, field
