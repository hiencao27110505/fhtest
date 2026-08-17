import senders


def test_matches_plain_address():
    assert senders.match("no-reply@techcombank.com.vn") == "techcombank"


def test_matches_display_name_form():
    assert senders.match("Techcombank <no-reply@techcombank.com.vn>") == "techcombank"


def test_matches_subdomain():
    assert senders.match("no-reply@mail.momo.vn") == "momo"


def test_is_case_insensitive():
    assert senders.match("No-Reply@MoMo.VN") == "momo"


def test_ignores_unknown_sender():
    assert senders.match("friend@gmail.com") is None


def test_ignores_empty_header():
    assert senders.match("") is None


def test_lookalike_domain_does_not_match():
    # momo.vn.evil.com must not pass as momo.vn
    assert senders.match("no-reply@momo.vn.evil.com") is None


def test_suffix_without_dot_does_not_match():
    # notmomo.vn is a different domain from momo.vn
    assert senders.match("no-reply@notmomo.vn") is None
