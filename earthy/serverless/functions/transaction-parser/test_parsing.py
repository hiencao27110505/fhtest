import main
import parsing


def test_amount_with_dot_grouping():
    assert parsing.parse("Số tiền: 1.234.567 VND").amount == 1234567


def test_amount_with_comma_grouping():
    assert parsing.parse("Amount 1,234,567 VND").amount == 1234567


def test_amount_with_dong_symbol():
    assert parsing.parse("Thanh toán 50.000đ").amount == 50000


def test_amount_without_grouping():
    assert parsing.parse("Số tiền 500000 VND").amount == 500000


def test_credit_direction():
    assert parsing.parse("Ghi có 100.000 VND").direction == "credit"


def test_debit_direction():
    assert parsing.parse("Ghi nợ 100.000 VND").direction == "debit"


def test_first_direction_marker_wins():
    text = "Ghi có 100.000 VND. Để thanh toán vui lòng đăng nhập."
    assert parsing.parse(text).direction == "credit"


def test_balance_is_captured_separately():
    result = parsing.parse("Ghi nợ 50.000 VND. Số dư: 1.000.000 VND")
    assert result.amount == 50000
    assert result.balance == 1000000


def test_balance_before_amount_is_not_taken_as_amount():
    # The balance appearing first must not be picked up as the amount.
    result = parsing.parse("Số dư: 1.000.000 VND. Ghi nợ 50.000 VND")
    assert result.amount == 50000
    assert result.balance == 1000000


def test_amount_equal_to_balance_still_parses():
    # Skipping by span, not by value: an amount that equals the balance
    # must survive.
    result = parsing.parse("Ghi nợ 50.000 VND. Số dư: 50.000 VND")
    assert result.amount == 50000
    assert result.balance == 50000


def test_incomplete_when_no_direction():
    assert not parsing.parse("Số tiền 100.000 VND").is_complete


def test_incomplete_when_no_amount():
    assert not parsing.parse("Ghi có vào tài khoản").is_complete


def test_strip_html_removes_tags_and_entities():
    assert main.strip_html("<p>Ghi c&oacute; 100.000&nbsp;VND</p>") == "Ghi có 100.000 VND"


def test_strip_html_drops_script_contents():
    assert "alert" not in main.strip_html("<script>alert('x')</script><p>ok</p>")


def test_realistic_vietcombank_html():
    body = """
    <html><body>
      <p>Kính gửi Quý khách,</p>
      <p>Tài khoản 0123456789 phát sinh giao dịch:</p>
      <table>
        <tr><td>Số tiền:</td><td>-2.500.000 VND</td></tr>
        <tr><td>Nội dung:</td><td>THANH TOAN MOMO</td></tr>
        <tr><td>Số dư:</td><td>15.750.000 VND</td></tr>
      </table>
    </body></html>
    """
    result = parsing.parse(main.strip_html(body))
    assert result.amount == 2500000
    assert result.direction == "debit"
    assert result.balance == 15750000
    assert result.is_complete
