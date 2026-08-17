"""Which senders count as transaction notifications.

Kept separate from main.py because this is the part that changes: every new
bank or wallet adds an entry here, while the Gmail plumbing stays put.

Matching is on the sender domain rather than the display name, which is
trivially spoofable. A real deployment should also verify SPF/DKIM before
trusting anything parsed out of the body.
"""

# domain -> short label used in logs
KNOWN_SENDERS: dict[str, str] = {
    # banks
    "techcombank.com.vn": "techcombank",
    "vietcombank.com.vn": "vietcombank",
    "acb.com.vn": "acb",
    "mbbank.com.vn": "mbbank",
    "vpbank.com.vn": "vpbank",
    "bidv.com.vn": "bidv",
    "tpb.com.vn": "tpbank",
    "vib.com.vn": "vib",
    # e-wallets
    "momo.vn": "momo",
    "zalopay.vn": "zalopay",
    "vnpay.vn": "vnpay",
    "shopeepay.vn": "shopeepay",
}


def sender_domain(from_header: str) -> str:
    """Pull the domain out of a From header.

    Handles both `Name <user@host>` and a bare `user@host`.
    """
    addr = from_header.rsplit("<", 1)[-1].rstrip(">").strip()
    _, _, domain = addr.rpartition("@")
    return domain.lower()


def match(from_header: str) -> str | None:
    """Return the sender's label, or None if it is not a known source.

    Subdomains count: `no-reply@mail.momo.vn` matches `momo.vn`.
    """
    domain = sender_domain(from_header)
    if not domain:
        return None
    for known, label in KNOWN_SENDERS.items():
        if domain == known or domain.endswith("." + known):
            return label
    return None
