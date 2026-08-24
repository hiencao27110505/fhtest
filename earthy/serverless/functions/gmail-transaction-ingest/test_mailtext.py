"""Flattening a mail body to text.

This is the first thing that touches a body, and where the layout goes. The
tests are here rather than in the parser because normalisation happens before
the Pub/Sub topic: what the parser receives is already text.
"""

import mailtext
import pytest


def test_a_value_does_not_run_into_the_next_cell() -> None:
    """From a real MoMo receipt: the cinema name and its street address are
    two table cells, and a flattened boundary let the first run into the
    second.

    The parser reads a value up to the next field break, so a boundary lost
    here is a merchant that arrives with an address attached.
    """
    html = (
        "<table>"
        "<tr><td>Rạp chiếu</td></tr>"
        "<tr><td>CGV Hoàng Văn Thụ</td></tr>"
        "<tr><td>Tầng 1 và 2, Gala Center, số 415</td></tr>"
        "</table>"
    )
    text = mailtext.strip_html(html)

    assert "· CGV Hoàng Văn Thụ ·" in text


def test_script_and_style_contents_never_reach_the_text() -> None:
    """`get_text` would otherwise pull CSS rules and script source into the
    body, where a figure in a stylesheet could be read as money."""
    html = (
        "<html><head><style>.a{width:750px}</style></head>"
        "<body><script>var total=999000;</script>"
        "<p>Số tiền: 250.000 VND</p></body></html>"
    )
    text = mailtext.strip_html(html)

    assert "999000" not in text
    assert "750px" not in text
    assert "250.000 VND" in text


def test_entities_are_decoded() -> None:
    assert "Số tiền" in mailtext.strip_html("<p>S&#7889; ti&#7873;n</p>")


def test_malformed_html_still_yields_text() -> None:
    """Mail HTML is unclosed and mis-nested. A forgiving parser is the whole
    reason for the dependency."""
    text = mailtext.strip_html("<div><p>Số tiền: 250.000 VND<div><span>Số dư: 1.000.000")

    assert "250.000 VND" in text
    assert "1.000.000" in text


@pytest.mark.parametrize("body", ["", "   "])
def test_an_empty_body_is_not_an_error(body: str) -> None:
    assert mailtext.strip_html(body) == ""


def test_plain_text_passes_through() -> None:
    """Not every mail is HTML. One that is not must survive unchanged apart
    from whitespace."""
    assert mailtext.strip_html("Số tiền: 250.000 VND") == "Số tiền: 250.000 VND"


def test_inline_markup_does_not_split_a_value() -> None:
    """Bold, links and spans inside a value are styling, not structure.

    Breaking on them tore `<no-reply@momo.vn>` into three lines and split any
    amount a bank chose to embolden — and a value split across two lines is a
    value the parser reads as truncated.
    """
    html = (
        "<td>Số tiền</td>"
        "<td><b>391.500</b> <span>đ</span></td>"
        "<td>From: MoMo &lt;<a href='#'>no-reply@momo.vn</a>&gt;</td>"
    )
    text = mailtext.strip_html(html)

    assert "391.500 đ" in text
    assert "<no-reply@momo.vn>" in text


def test_block_elements_still_separate_fields() -> None:
    """The other half: a cell boundary must still end a value, or a merchant
    runs on into the address below it."""
    html = "<tr><td>Rạp chiếu</td></tr><tr><td>CGV Vivo City</td></tr><tr><td>Tầng 3</td></tr>"
    text = mailtext.strip_html(html)

    assert "· CGV Vivo City ·" in text


# ---------------------------------------------------------------- declutter


def test_a_url_is_dropped() -> None:
    """Nothing downstream reads one, and a tracking link in a bank mail runs
    to several hundred characters."""
    text = mailtext.declutter(
        "Xem tại https://momo.vn/a/very/long/tracking/link?utm=x · Tổng tiền · 391.500 đ"
    )

    assert "http" not in text
    assert "391.500 đ" in text


def test_invisible_characters_go() -> None:
    """Zero-width spaces and soft hyphens carry no meaning in any language,
    and templates use them for preheader padding."""
    assert mailtext.declutter("Số​tiền­ · 250.000﻿ VND") == "Sốtiền · 250.000 VND"


def test_a_field_repeated_back_to_back_is_collapsed() -> None:
    """A preheader echoing the subject, or a heading rendered twice for two
    screen widths."""
    assert mailtext.declutter("Xác nhận · Xác nhận · Tổng tiền") == "Xác nhận · Tổng tiền"


def test_the_same_figure_in_two_different_rows_is_kept() -> None:
    """Only ADJACENT repeats collapse. A fee that equals a total is two real
    values, and dropping one would take a field the parser reads.
    """
    text = mailtext.declutter("Phí · 11.000 đ · Tổng phí · 11.000 đ")

    assert text.count("11.000 đ") == 2


def test_technical_residue_goes() -> None:
    assert "cid:" not in mailtext.declutter("Logo cid:image001.png@01D9 · Tổng tiền")


FOOTER_WORDING = [
    "Tổng đài 1900 588 822",
    "Chính sách hoàn huỷ",
    "Điều khoản sử dụng",
    "Trung tâm trợ giúp",
]


@pytest.mark.parametrize("line", FOOTER_WORDING)
def test_footer_wording_does_not_cut_the_body(line: str) -> None:
    """The regression that matters most here.

    An earlier `declutter` cut the body at the first line opening a boilerplate
    block, matched against 28 phrases read off four MoMo receipts. Nothing in
    that list was true of a bank, and the failure was asymmetric: a tail that
    did not match cost some tokens, while a phrase matching EARLY cost the
    transaction. A notice printing "Tổng đài 1900 588 822" mid-body lost every
    field below it, silently.

    Deciding what a mail means from a keyword list is the one job this
    pipeline hands to a model precisely because keyword lists do not survive a
    template change. Trimming to a budget belongs to `llm._clip`, which picks
    its window by where the transaction-shaped text is.
    """
    body = f"Ngân hàng ABC · {line} · Số tiền · 250.000 VND · Số dư · 1.000.000 VND"

    text = mailtext.declutter(body)

    assert "250.000 VND" in text
    assert "1.000.000 VND" in text


def test_an_empty_body_survives_decluttering() -> None:
    assert mailtext.declutter("") == ""
