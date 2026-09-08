"""Emit one synthetic Python persistence payload for the Node contract test."""

import json
from datetime import datetime

import persist
from parser.spec import Extracted

payload = persist.build_payload(
    email="contract@example.com",
    message_id="python-contract-1",
    source="techcombank",
    sender_kind="bank",
    from_header="Techcombank <notice@techcombank.com.vn>",
    body="Synthetic contract fixture",
    reading=Extracted(
        amount=250_000,
        currency="VND",
        fx_amount=10,
        fx_currency="USD",
        direction="debit",
        merchant="CONTRACT SHOP",
        occurred_at=datetime(2026, 8, 21, 6, 15),
        reference="CONTRACT-REF",
        account_tail="4412",
        description="contract memo",
        transaction_type="purchase",
        status="completed",
        account_kind="credit_card",
        flow="expense",
    ),
    category="mua sắm",
)
print(json.dumps(payload))
