"""Address folding used to match a signed-in mailbox against auth.users."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from connect_mailbox import normalize_email  # noqa: E402


def test_lowercases() -> None:
    assert normalize_email("HienCao27110505@GMAIL.com") == "hiencao27110505@gmail.com"


def test_gmail_ignores_dots() -> None:
    # A real row: auth.users holds trang.nguyen.wh@, Google reports it without
    # the dots. Before folding, that user could not be found at all.
    assert normalize_email("trang.nguyen.wh@gmail.com") == "trangnguyenwh@gmail.com"


def test_gmail_strips_plus_tag() -> None:
    assert normalize_email("someone+bank@gmail.com") == "someone@gmail.com"


def test_gmail_strips_dots_and_tag_together() -> None:
    assert normalize_email("first.last+x@gmail.com") == "firstlast@gmail.com"


def test_googlemail_is_folded_too() -> None:
    assert normalize_email("a.b@googlemail.com") == "ab@googlemail.com"


def test_other_domains_keep_their_dots() -> None:
    # Only Google promises dots are insignificant; folding them elsewhere
    # would merge two genuinely different mailboxes.
    assert normalize_email("First.Last@company.com") == "first.last@company.com"


def test_other_domains_keep_their_tags() -> None:
    assert normalize_email("user+tag@company.com") == "user+tag@company.com"


def test_surrounding_whitespace_is_dropped() -> None:
    assert normalize_email("  a@gmail.com  ") == "a@gmail.com"


def test_a_string_without_an_at_is_left_alone() -> None:
    assert normalize_email("not-an-address") == "not-an-address"
