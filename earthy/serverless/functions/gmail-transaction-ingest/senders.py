"""Which senders count as transaction notifications.

Kept separate from main.py because this is the part that changes: every new
bank or wallet adds an entry here, while the Gmail plumbing stays put.

Matching is on the sender domain rather than the display name, which is
trivially spoofable. A real deployment should also verify SPF/DKIM before
trusting anything parsed out of the body.
"""

# Exact addresses treated as a transaction source, so the pipeline can be
# exercised end to end without waiting for a real bank email.
#
# Whole addresses, not domains, and deliberately kept out of KNOWN_SENDERS:
# every one is @gmail.com, and a gmail.com entry in the domain table would
# admit every personal email in the mailbox.
#
# TEMPORARY — remove once real bank mail is flowing.
TEST_SENDERS: frozenset[str] = frozenset(
    {
        "tranminhquang4421@gmail.com",
        "hiencao27110505@gmail.com",
        "gichisreading@gmail.com",
        "j2team.tranminhquang@gmail.com",
    }
)


# domain -> short label used in logs
#
# THE DOMAIN IS THE ONE THAT SENDS MAIL, not the one on the website or the one
# the brand name implies. Every entry below was checked for live MX before it
# was added, because the two are often different and the failure is silent: an
# unlisted sender is dropped at ingest with no error, and the transaction just
# never appears. The traps found while compiling this:
#
#   vietinbank.com.vn   has NO MX          → vietinbank.vn
#   tpbank.com.vn       has NO MX          → tpb.com.vn
#   bacabank.com.vn     has NO MX          → baca-bank.vn   (hyphen)
#   ncb.com.vn          not the sender     → ncb-bank.vn    (hyphen)
#   bvbank.com.vn       not the sender     → bvbank.net.vn  (.net.vn)
#   kienlongbank.com.vn not the sender     → kienlongbank.com (no .vn)
#   dongabank.com.vn    dead, rebranded    → vikkibank.vn
#   wooribank.com.vn    does not resolve   → woori.com.vn
#
# So "Vietnamese banks are @name.com.vn" is a good first guess and a bad rule:
# it is wrong for VietinBank, TPBank, BacABank, NCB, BVBank, KienlongBank and
# every wallet in the second half of this table. Look the domain up; do not
# derive it from the name.
#
# Subdomains match automatically (see `match`), so `no-reply@mail.acb.com.vn`
# needs no entry of its own.
KNOWN_SENDERS: dict[str, str] = {
    # ── banks, state-owned and joint stock ──────────────────────────────────
    "vietcombank.com.vn": "vietcombank",
    "vietinbank.vn": "vietinbank",        # NOT vietinbank.com.vn
    "bidv.com.vn": "bidv",
    "agribank.com.vn": "agribank",
    "techcombank.com.vn": "techcombank",
    "mbbank.com.vn": "mbbank",
    "vpbank.com.vn": "vpbank",
    "acb.com.vn": "acb",
    "sacombank.com.vn": "sacombank",
    "sacombank.com": "sacombank",         # both are live senders
    "hdbank.com.vn": "hdbank",
    "vib.com.vn": "vib",
    "tpb.com.vn": "tpbank",               # NOT tpbank.com.vn
    "shb.com.vn": "shb",
    "seabank.com.vn": "seabank",
    "ocb.com.vn": "ocb",
    "msb.com.vn": "msb",
    "lpbank.com.vn": "lpbank",
    "eximbank.com.vn": "eximbank",
    "eib.com.vn": "eximbank",             # second Eximbank sending domain
    "namabank.com.vn": "namabank",
    "abbank.vn": "abbank",                # no .com
    "baca-bank.vn": "bacabank",           # hyphen
    "pvcombank.com.vn": "pvcombank",
    "scb.com.vn": "scb",
    "vietbank.com.vn": "vietbank",
    "kienlongbank.com": "kienlongbank",   # no .vn
    "saigonbank.com.vn": "saigonbank",
    "baovietbank.vn": "baovietbank",
    "vietabank.com.vn": "vietabank",
    "ncb-bank.vn": "ncb",                 # hyphen
    "pgbank.com.vn": "pgbank",
    "bvbank.net.vn": "bvbank",            # .net.vn
    "vikkibank.vn": "vikki",              # Dong A Bank, rebranded
    "oceanbank.vn": "oceanbank",
    "gpbank.com.vn": "gpbank",

    # ── foreign banks operating in Vietnam ──────────────────────────────────
    "woori.com.vn": "woori",              # NOT wooribank.com.vn
    "shinhan.com.vn": "shinhan",
    "hsbc.com.vn": "hsbc",
    "publicbank.com.vn": "publicbank",
    "hlbank.com.vn": "hongleong",

    # ── digital banks ───────────────────────────────────────────────────────
    "timo.vn": "timo",
    "cake.vn": "cake",
    "ubank.vn": "ubank",
    "liobank.vn": "liobank",
    "tnex.com.vn": "tnex",

    # ── e-wallets and payment services ──────────────────────────────────────
    "momo.vn": "momo",
    "mservice.com.vn": "momo",            # MoMo's corporate entity, M_Service
    "zalopay.vn": "zalopay",
    "vnpay.vn": "vnpay",
    # No MX as of Aug 2026, so nothing can match it today — kept because the
    # domain is theirs and may start sending. ShopeePay mail most likely
    # arrives from `shopee.vn`, which is deliberately NOT listed: it would also
    # admit every Shopee order and delivery mail, which are not transactions.
    "shopeepay.vn": "shopeepay",
    "viettelmoney.vn": "viettelmoney",
    "vnptmoney.vn": "vnptmoney",          # VNPT Pay, rebranded
    "payoo.vn": "payoo",
    "napas.com.vn": "napas",
    "9pay.vn": "9pay",
    "gpay.vn": "gpay",
    "onepay.vn": "onepay",
    "nganluong.vn": "nganluong",
    "baokim.vn": "baokim",
    "alepay.vn": "alepay",
    "smartpay.vn": "smartpay",
    "moca.vn": "moca",
    "appotapay.com": "appotapay",
    "finviet.com.vn": "finviet",

    # ── securities and investment: they confirm trades by mail too ──────────
    "ssi.com.vn": "ssi",
    "vndirect.com.vn": "vndirect",
    "vps.com.vn": "vps",
    "hsc.com.vn": "hsc",
    "vcbs.com.vn": "vcbs",
    "tcbs.com.vn": "tcbs",
    "mbs.com.vn": "mbs",
    "dnse.com.vn": "dnse",
    "miraeasset.com.vn": "miraeasset",
    "finhay.com.vn": "finhay",
    "infina.vn": "infina",

    # ── consumer finance and BNPL ───────────────────────────────────────────
    "fecredit.com.vn": "fecredit",
    "homecredit.vn": "homecredit",
    "hdsaison.com.vn": "hdsaison",
    "fundiin.vn": "fundiin",
    "kredivo.vn": "kredivo",

    # ── VN-namespace variants, no MX required ──────────────────────────────
    # Added on request without checking for live mail infrastructure: a dead
    # domain here just never matches, while a missing one silently drops a
    # real transaction. Restricted to .vn/.com.vn though — a bare .com is a
    # DIFFERENT registry with no ownership link to the .vn brand (alepay.com is
    # parked on Sedo, klb.com sits on French hosting, cake.com/hsc.com/bvbank.com
    # are unrelated companies) — admitting those would let a stranger's domain
    # match as a bank.
    "9pay.com.vn": "9pay",
    "abbank.com.vn": "abbank",
    "agribank.vn": "agribank",
    "appotapay.com.vn": "appotapay",
    "appotapay.vn": "appotapay",
    "baca-bank.com.vn": "bacabank",
    "baokim.com.vn": "baokim",
    "baovietbank.com.vn": "baovietbank",
    "bidv.vn": "bidv",
    "vietcapitalbank.com.vn": "bvbank",
    "cake.com.vn": "cake",
    "dnse.vn": "dnse",
    "eib.vn": "eximbank",
    "eximbank.vn": "eximbank",
    "fecredit.vn": "fecredit",
    "finhay.vn": "finhay",
    "finviet.vn": "finviet",
    "gpay.com.vn": "gpay",
    "homecredit.com.vn": "homecredit",
    "hsbc.vn": "hsbc",
    "hsc.vn": "hsc",
    "infina.com.vn": "infina",
    "kienlongbank.com.vn": "kienlongbank",
    "kienlongbank.vn": "kienlongbank",
    "klb.com.vn": "kienlongbank",
    "klb.vn": "kienlongbank",
    "kredivo.com.vn": "kredivo",
    "liobank.com.vn": "liobank",
    "lienvietpostbank.com.vn": "lpbank",
    "lienvietpostbank.vn": "lpbank",
    "lpbank.vn": "lpbank",
    "mbb.vn": "mbbank",
    "mbbank.vn": "mbbank",
    "mbs.vn": "mbs",
    "momo.com.vn": "momo",
    "mservice.vn": "momo",
    "msb.vn": "msb",
    "ncb-bank.com.vn": "ncb",
    "ncb.com.vn": "ncb",
    "ncb.vn": "ncb",
    "onepay.com.vn": "onepay",
    "payoo.com.vn": "payoo",
    "pgbank.vn": "pgbank",
    "pvcombank.vn": "pvcombank",
    "stb.com.vn": "sacombank",
    "stb.vn": "sacombank",
    "scb.vn": "scb",
    "seabank.vn": "seabank",
    "shb.vn": "shb",
    "airpay.vn": "shopeepay",
    "smartpay.com.vn": "smartpay",
    "ssi.vn": "ssi",
    "tcb.vn": "techcombank",
    "techcombank.vn": "techcombank",
    "tnex.vn": "tnex",
    "tpb.vn": "tpbank",
    "tpbank.com.vn": "tpbank",
    "tpbank.vn": "tpbank",
    "ubank.com.vn": "ubank",
    "vcbs.vn": "vcbs",
    "vietbank.vn": "vietbank",
    "vcb.com.vn": "vietcombank",
    "ctg.com.vn": "vietinbank",
    "ctg.vn": "vietinbank",
    "viettelmoney.com.vn": "viettelmoney",
    "viettelpay.com.vn": "viettelmoney",
    "viettelpay.vn": "viettelmoney",
    "vndirect.vn": "vndirect",
    "vnpay.com.vn": "vnpay",
    "vnptmoney.com.vn": "vnptmoney",
    "vnptpay.vn": "vnptmoney",
    "vps.vn": "vps",
    "woori.vn": "woori",
    "wooribank.com.vn": "woori",
    "wooribank.vn": "woori",
    "zalopay.com.vn": "zalopay",
}



def sender_domain(from_header: str) -> str:
    """Pull the domain out of a From header.

    Handles both `Name <user@host>` and a bare `user@host`.
    """
    addr = from_header.rsplit("<", 1)[-1].rstrip(">").strip()
    _, _, domain = addr.rpartition("@")
    return domain.lower()


def address(from_header: str) -> str:
    """The bare address out of a From header, lowercased."""
    addr = from_header.rsplit("<", 1)[-1].rstrip(">").strip()
    return addr.lower()


# Labels that are NOT banks: e-wallets, payment services, securities houses,
# and consumer finance. Everything else in KNOWN_SENDERS is a bank.
#
# CLASSIFIED BY LABEL, NOT DOMAIN, on purpose: the VN-namespace variants at the
# bottom of KNOWN_SENDERS all map onto labels that already exist, so a new alias
# domain for `momo` is a wallet automatically. The maintenance rule is one line:
# a NEW label that is not a bank goes in this set in the same commit that adds
# it. Left out, it is reported downstream as a bank — which types its rows
# `bank_txn` and, worse, feeds the review screen's bank-vs-bank duplicate rule a
# claim that stops a dedup. When unsure, leave the label OUT of this set only if
# it is actually a bank.
NON_BANK_LABELS: frozenset[str] = frozenset(
    {
        # e-wallets and payment services
        "momo", "zalopay", "vnpay", "shopeepay", "viettelmoney", "vnptmoney",
        "payoo", "napas", "9pay", "gpay", "onepay", "nganluong", "baokim",
        "alepay", "smartpay", "moca", "appotapay", "finviet",
        # securities and investment
        "ssi", "vndirect", "vps", "hsc", "vcbs", "tcbs", "mbs", "dnse",
        "miraeasset", "finhay", "infina",
        # consumer finance and BNPL
        "fecredit", "homecredit", "hdsaison", "fundiin", "kredivo",
    }
)


def kind(label: str) -> str:
    """'bank' or 'wallet', for the label `match` returned.

    Travels with the event so the persist stage can say what KIND of sender
    this was without re-deriving it from a From header it may not trust.
    "test" reads as a bank so the strict path is the one test mail exercises.
    """
    return "wallet" if label in NON_BANK_LABELS else "bank"


def match(from_header: str) -> str | None:
    """Return the sender's label, or None if it is not a known source.

    Subdomains count: `no-reply@mail.momo.vn` matches `momo.vn`.
    """
    # Exact-address allowlist first: these are test accounts, and they would
    # never match on domain.
    if address(from_header) in TEST_SENDERS:
        return "test"

    domain = sender_domain(from_header)
    if not domain:
        return None
    for known, label in KNOWN_SENDERS.items():
        if domain == known or domain.endswith("." + known):
            return label
    return None
