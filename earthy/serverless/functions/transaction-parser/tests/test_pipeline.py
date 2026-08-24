import parser
import pytest
from parser import llm, pipeline, spec

TCB_CREDIT = (
    "Ngân hàng Techcombank thông báo: "
    "Số tài khoản: 19001234567 "
    "Số tiền giao dịch: +500.000 VND "
    "Số dư khả dụng: 12.345.678 VND "
    "Nội dung: CHUYEN TIEN CHO ME"
)

# Unusual labels, so no stored spec written for a real bank would match it and
# the cascade has to reach the LLM.
OPAQUE = (
    "Quy khach vua thuc hien mot giao dich. "
    "Gia tri: 500.000 VND. "
    "So du con lai: 12.345.678 VND"
)

# Direction is 'fixed': this template never prints a sign, so which way the
# money moved is a property of the notice rather than of any field in it.
OPAQUE_SPEC = {
    "amount": {"label": "Gia tri", "type": "money"},
    "balance": {"label": "So du con lai", "type": "money"},
    "direction": {"label": "credit", "type": "fixed"},
}

TCB_SPEC = {
    "amount": {"label": "Số tiền giao dịch", "type": "money"},
    "balance": {"label": "Số dư khả dụng", "type": "money"},
    "direction": {"label": "Số tiền giao dịch", "type": "sign"},
}

# A spec that reads the wrong row: it anchors the amount onto the balance.
WRONG_SPEC = {
    "amount": {"label": "Số dư khả dụng", "type": "money"},
    "balance": {"label": "Số dư khả dụng", "type": "money"},
    "direction": {"label": "Số tiền giao dịch", "type": "sign"},
}


class FakeTemplates:
    """In-memory stand-in for the Postgres-backed store."""

    def __init__(self, specs=None, on_save=None):
        self.specs = dict(specs or {})
        self.saved: list[tuple[str, dict]] = []
        self.on_save = on_save

    def for_source(self, source):
        return list(self.specs.get(source, []))

    def save(self, source, proposed):
        if self.on_save:
            self.on_save()
        self.saved.append((source, proposed))
        self.specs.setdefault(source, []).append(proposed)


def _read(result) -> spec.Extracted:
    """The reading, asserting there is one. Keeps each test to its own point
    instead of repeating the None check."""
    assert result.ok, result.reasons
    assert result.reading is not None
    return result.reading


def _fake_llm(monkeypatch, reading, proposed):
    monkeypatch.setattr(llm, "enabled", lambda: True)
    monkeypatch.setattr(llm, "extract", lambda body: reading)
    monkeypatch.setattr(llm, "induce", lambda body, r: proposed)


def _no_llm(monkeypatch):
    monkeypatch.setattr(llm, "enabled", lambda: False)


# ---------------------------------------------------------------- stage 1


def test_a_stored_spec_reads_the_mail(monkeypatch: pytest.MonkeyPatch) -> None:
    _no_llm(monkeypatch)
    templates = FakeTemplates({"techcombank": [TCB_SPEC]})

    result = parser.parse("techcombank", TCB_CREDIT, templates)

    assert result.ok
    assert result.stage == "spec"
    reading = _read(result)
    assert reading.amount == 500000
    assert reading.direction == "credit"


def test_the_right_spec_is_picked_out_of_several(monkeypatch: pytest.MonkeyPatch) -> None:
    # A bank has one spec per notice type; the wrong one must not win just by
    # being tried first.
    _no_llm(monkeypatch)
    templates = FakeTemplates({"techcombank": [WRONG_SPEC, TCB_SPEC]})

    result = parser.parse("techcombank", TCB_CREDIT, templates)

    assert result.ok
    assert _read(result).amount == 500000


def test_a_spec_reading_the_balance_as_the_amount_is_rejected(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # Validation, not ordering, is what stops this: the spec reads 12.345.678
    # as the amount, which is refused, so the mail is never reported with the
    # balance as its amount.
    _no_llm(monkeypatch)
    templates = FakeTemplates({"techcombank": [WRONG_SPEC]})

    result = parser.parse("techcombank", TCB_CREDIT, templates)

    assert not result.ok
    assert result.stage != "spec"


def test_a_malformed_stored_spec_is_skipped_not_fatal(monkeypatch: pytest.MonkeyPatch) -> None:
    _no_llm(monkeypatch)
    templates = FakeTemplates({"techcombank": [{"nonsense": True}, TCB_SPEC]})

    assert parser.parse("techcombank", TCB_CREDIT, templates).ok


def test_specs_belong_to_one_sender(monkeypatch: pytest.MonkeyPatch) -> None:
    _no_llm(monkeypatch)
    templates = FakeTemplates({"techcombank": [TCB_SPEC]})

    # Same body, different sender: that sender has no specs of its own.
    result = parser.parse("acb", TCB_CREDIT, templates)
    assert result.stage != "spec"


# ------------------------------------------------- no spec, no LLM


def test_an_unfamiliar_template_needs_the_llm(monkeypatch: pytest.MonkeyPatch) -> None:
    # There is no regex fallback: a mail no stored spec covers is unread
    # unless a model can read it. Deliberate — see the package docstring.
    _no_llm(monkeypatch)

    result = parser.parse("acb", "Ghi có 500.000 VND. Số dư: 12.345.678 VND", None)

    assert not result.ok
    assert any("not configured" in reason for reason in result.reasons)


def test_a_database_failure_falls_through_rather_than_raising(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # A store that is down must degrade to the LLM stage, not take the
    # delivery with it.
    _fake_llm(monkeypatch, llm.Reading(amount=500000, direction="credit"), None)

    class Broken:
        def for_source(self, source):
            raise RuntimeError("connection refused")

        def save(self, source, proposed):
            raise RuntimeError("connection refused")

    result = parser.parse("acb", "Gia tri: 500.000 VND", Broken())

    assert result.ok
    assert result.stage == "llm"


# ---------------------------------------------------------------- stage 2


def test_the_llm_reads_a_mail_nothing_else_could(monkeypatch: pytest.MonkeyPatch) -> None:
    _fake_llm(
        monkeypatch,
        llm.Reading(amount=500000, balance=12345678, direction="credit"),
        OPAQUE_SPEC,
    )
    templates = FakeTemplates()

    result = parser.parse("techcombank", OPAQUE, templates)

    assert result.ok
    assert result.stage == "llm"
    assert _read(result).amount == 500000


def test_a_working_proposal_is_learned(monkeypatch: pytest.MonkeyPatch) -> None:
    _fake_llm(
        monkeypatch,
        llm.Reading(amount=500000, balance=12345678, direction="credit"),
        OPAQUE_SPEC,
    )
    templates = FakeTemplates()

    result = parser.parse("techcombank", OPAQUE, templates)

    assert result.learned
    assert templates.saved == [("techcombank", OPAQUE_SPEC)]


def test_what_was_learned_is_used_next_time(monkeypatch: pytest.MonkeyPatch) -> None:
    # The whole point of the cache: the second mail costs no LLM call.
    _fake_llm(
        monkeypatch,
        llm.Reading(amount=500000, balance=12345678, direction="credit"),
        OPAQUE_SPEC,
    )
    templates = FakeTemplates()

    assert parser.parse("techcombank", OPAQUE, templates).stage == "llm"

    calls = []
    def _record(body):
        calls.append(body)
        return None

    monkeypatch.setattr(llm, "extract", _record)

    second = parser.parse("techcombank", OPAQUE, templates)
    assert second.stage == "spec"
    assert calls == []


def test_a_proposal_that_cannot_reread_its_own_mail_is_not_stored(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # The promotion gate. A spec that does not work here would be applied to
    # every future mail from this sender.
    _fake_llm(
        monkeypatch,
        llm.Reading(amount=500000, balance=12345678, direction="credit"),
        WRONG_SPEC,
    )
    templates = FakeTemplates()

    result = parser.parse("techcombank", TCB_CREDIT, templates)

    assert result.ok  # the mail was still read
    assert not result.learned
    assert templates.saved == []


def test_a_malformed_proposal_is_not_stored(monkeypatch: pytest.MonkeyPatch) -> None:
    _fake_llm(
        monkeypatch,
        llm.Reading(amount=500000, direction="credit"),
        {"balance": {"label": "Số dư khả dụng", "type": "money"}},  # no amount
    )
    templates = FakeTemplates()

    assert not parser.parse("techcombank", TCB_CREDIT, templates).learned


def test_an_llm_reading_that_fails_validation_is_rejected(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # The model is judged like everything else: this reading has the balance
    # as the amount, which is the classic misread.
    _fake_llm(
        monkeypatch,
        llm.Reading(amount=12345678, balance=12345678, direction="credit"),
        OPAQUE_SPEC,
    )

    result = parser.parse("techcombank", OPAQUE, FakeTemplates())

    assert not result.ok
    assert any("equals balance" in reason for reason in result.reasons)


def test_a_storage_failure_does_not_lose_the_reading(monkeypatch: pytest.MonkeyPatch) -> None:
    def explode():
        raise RuntimeError("disk on fire")

    _fake_llm(
        monkeypatch,
        llm.Reading(amount=500000, balance=12345678, direction="credit"),
        TCB_SPEC,
    )
    templates = FakeTemplates(on_save=explode)

    result = parser.parse("techcombank", TCB_CREDIT, templates)

    assert result.ok
    assert not result.learned


def test_nothing_is_learned_without_a_store(monkeypatch: pytest.MonkeyPatch) -> None:
    _fake_llm(monkeypatch, llm.Reading(amount=500000, direction="credit"), TCB_SPEC)

    result = parser.parse("techcombank", TCB_CREDIT, None)

    assert result.ok
    assert not result.learned


# ---------------------------------------------------------------- nothing works


def test_an_unreadable_mail_is_a_result_not_an_exception(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # Raising would make Pub/Sub redeliver a mail that fails identically.
    _no_llm(monkeypatch)

    result = parser.parse("acb", "Kính gửi quý khách, xin cảm ơn.", None)

    assert not result.ok
    assert result.reading is None
    assert result.reasons


def test_an_unconfigured_llm_says_so(monkeypatch: pytest.MonkeyPatch) -> None:
    _no_llm(monkeypatch)

    result = parser.parse("acb", "Kính gửi quý khách.", None)

    assert any("not configured" in reason for reason in result.reasons)


def test_the_package_exposes_one_entry_point() -> None:
    # Reading a mail is one call; the store is exposed only so main.py can
    # build one per instance. Everything else is internal.
    assert parser.__all__ == ["Result", "create_store", "parse"]
    assert parser.parse is pipeline.parse


def test_a_spec_whose_phrases_miss_its_own_mail_is_not_learned(monkeypatch):
    """A proposal has to match the mail it came from.

    Storing one that does not would put a spec in the database that can never
    be applied — it would sit there looking learned while every future mail
    from that sender still cost an LLM call.
    """
    monkeypatch.setattr(llm, "enabled", lambda: True)
    monkeypatch.setattr(
        llm, "extract", lambda body: llm.Reading(amount=500000, direction="credit")
    )
    monkeypatch.setattr(
        llm,
        "induce",
        lambda body, reading: {**TCB_SPEC, "match": ["khong he co trong mail nay"]},
    )

    templates = FakeTemplates()
    result = pipeline.parse("techcombank", TCB_CREDIT, templates)

    assert result.ok  # the mail was still read
    assert result.learned is False
    assert templates.saved == []


def test_a_matching_proposal_is_learned(monkeypatch):
    monkeypatch.setattr(llm, "enabled", lambda: True)
    monkeypatch.setattr(
        llm,
        "extract",
        lambda body: llm.Reading(amount=500000, balance=12345678, direction="credit"),
    )
    monkeypatch.setattr(
        llm, "induce", lambda body, reading: {**TCB_SPEC, "match": ["Techcombank"]}
    )

    templates = FakeTemplates()
    result = pipeline.parse("techcombank", TCB_CREDIT, templates)

    assert result.learned is True
    assert templates.saved[0][1]["match"] == ["Techcombank"]


# TCB_SPEC reads no merchant, and a category is inferred from the merchant, so
# these need a spec that reads one.
TCB_SPEC_WITH_MERCHANT = {**TCB_SPEC, "merchant": {"label": "Nội dung", "type": "text"}}


def test_a_parsed_mail_carries_a_category(monkeypatch):
    monkeypatch.setattr(parser.category, "_ask", lambda merchant, direction: "ăn uống")

    templates = FakeTemplates({"techcombank": [TCB_SPEC_WITH_MERCHANT]})
    result = pipeline.parse("techcombank", TCB_CREDIT, templates)

    assert result.ok
    assert result.category == "ăn uống"
    assert result.category_source == "llm"


def test_a_category_is_cached_across_mails(monkeypatch):
    """The second mail from the same merchant costs no API call."""
    calls = []
    monkeypatch.setattr(
        parser.category,
        "_ask",
        lambda merchant, direction: calls.append(merchant) or "ăn uống",
    )

    # A store that keeps categories as well as specs; FakeTemplates keeps only
    # specs, and the pipeline correctly asks every time when it has nowhere to
    # cache.
    class Caching(FakeTemplates):
        def __init__(self, specs):
            super().__init__(specs)
            self.categories: dict[str, str] = {}

        def category_for(self, merchant):
            return self.categories.get(merchant)

        def save_category(self, merchant, cat):
            self.categories.setdefault(merchant, cat)

    templates = Caching({"techcombank": [TCB_SPEC_WITH_MERCHANT]})
    pipeline.parse("techcombank", TCB_CREDIT, templates)
    second = pipeline.parse("techcombank", TCB_CREDIT, templates)

    assert calls == ["chuyen tien cho me"]
    assert second.category_source == "store"


def test_an_unread_mail_has_no_category(monkeypatch):
    """Nothing to categorise, and nothing asked."""
    calls = []
    monkeypatch.setattr(
        parser.category, "_ask", lambda merchant, direction: calls.append(merchant)
    )

    result = pipeline.parse("techcombank", "not a transaction at all", FakeTemplates())

    assert not result.ok
    assert result.category is None
    assert calls == []


def test_a_failed_categorisation_does_not_fail_the_parse(monkeypatch):
    """The mail was read. A missing category is a missing label, not a failure."""
    monkeypatch.setattr(
        parser.category, "_ask", lambda merchant, direction: None
    )

    templates = FakeTemplates({"techcombank": [TCB_SPEC_WITH_MERCHANT]})
    result = pipeline.parse("techcombank", TCB_CREDIT, templates)

    assert result.ok
    assert result.reading.amount == 500000
    assert result.category is None
