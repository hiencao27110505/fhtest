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


def test_allowlisted_test_addresses_match():
    assert senders.match("tranminhquang4421@gmail.com") == "test"
    assert senders.match("j2team.tranminhquang@gmail.com") == "test"


def test_allowlist_ignores_case_and_display_name():
    assert senders.match("Hien <HienCao27110505@Gmail.com>") == "test"


def test_other_gmail_addresses_are_still_ignored():
    # The allowlist is exact addresses; gmail.com as a domain would let every
    # personal email through.
    assert senders.match("stranger@gmail.com") is None


def test_allowlist_does_not_disturb_real_senders():
    assert senders.match("no-reply@momo.vn") == "momo"
