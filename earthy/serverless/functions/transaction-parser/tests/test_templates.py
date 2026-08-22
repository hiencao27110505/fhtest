import parser
import pytest
from parser import templates


def test_an_empty_store_has_nothing_for_a_sender():
    assert templates.InMemoryStore().for_source("techcombank") == []


def test_a_saved_spec_comes_back():
    store = templates.InMemoryStore()
    spec = {"amount": {"label": "Số tiền giao dịch", "type": "money"}}

    store.save("techcombank", spec)

    assert store.for_source("techcombank") == [spec]


def test_saving_the_same_spec_twice_stores_it_once():
    # Mirrors the unique index in migration 0071: two invocations learning from
    # two mails off one template propose the same spec.
    store = templates.InMemoryStore()
    spec = {"amount": {"label": "Số tiền giao dịch", "type": "money"}}

    store.save("techcombank", spec)
    store.save("techcombank", spec)

    assert store.for_source("techcombank") == [spec]


def test_a_sender_can_have_several_specs():
    # A bank sends credit notices, debit notices and statements, all shaped
    # differently.
    store = templates.InMemoryStore()
    credit = {"amount": {"label": "Số tiền ghi có", "type": "money"}}
    debit = {"amount": {"label": "Số tiền ghi nợ", "type": "money"}}

    store.save("techcombank", credit)
    store.save("techcombank", debit)

    assert store.for_source("techcombank") == [credit, debit]


def test_specs_do_not_leak_between_senders():
    store = templates.InMemoryStore()
    store.save("techcombank", {"amount": {"label": "x", "type": "money"}})

    assert store.for_source("acb") == []


def test_the_returned_list_is_a_copy():
    # A caller mutating what it got back must not corrupt the store.
    store = templates.InMemoryStore()
    store.save("techcombank", {"amount": {"label": "x", "type": "money"}})

    store.for_source("techcombank").clear()

    assert len(store.for_source("techcombank")) == 1


def test_without_a_database_url_the_store_is_in_memory(monkeypatch: pytest.MonkeyPatch) -> None:
    # Not a broken deployment: mail is still read, each template is just
    # relearned once per instance instead of once ever.
    monkeypatch.delenv("DATABASE_URL", raising=False)
    assert isinstance(templates.create_store(), templates.InMemoryStore)


def test_with_a_database_url_the_store_is_postgres(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("DATABASE_URL", "postgresql://localhost/nowhere")
    # Constructed, not connected: the pool opens lazily on first use.
    assert isinstance(templates.create_store(), templates.PostgresStore)


def test_the_store_satisfies_what_the_pipeline_needs(monkeypatch: pytest.MonkeyPatch) -> None:
    # The end-to-end shape: a spec learned through parse() is readable back out
    # of the store on the next mail.
    from parser import llm

    body = "Gia tri: 500.000 VND. So du con lai: 12.345.678 VND"
    proposed = {
        "amount": {"label": "Gia tri", "type": "money"},
        "balance": {"label": "So du con lai", "type": "money"},
        "direction": {"label": "credit", "type": "fixed"},
    }
    monkeypatch.setattr(llm, "enabled", lambda: True)
    monkeypatch.setattr(
        llm,
        "extract",
        lambda _: llm.Reading(amount=500000, balance=12345678, direction="credit"),
    )
    monkeypatch.setattr(llm, "induce", lambda *_: proposed)

    store = templates.InMemoryStore()

    first = parser.parse("techcombank", body, store)
    assert first.stage == "llm"
    assert first.learned

    second = parser.parse("techcombank", body, store)
    assert second.stage == "spec"
    assert second.reading is not None
    assert second.reading.amount == 500000


def test_the_model_that_proposed_a_spec_is_recorded():
    # Audit trail: a rule that misreads has to be traceable to what wrote it,
    # including when the default model was used and GEMINI_MODEL is unset.
    from parser import llm, templates

    assert templates._model_name() == llm.MODEL
