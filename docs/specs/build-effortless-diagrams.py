# Renders the three effortless-transaction-logging-spec diagrams
# in the personal-ledger spec style.
# Run: /opt/homebrew/bin/python3 build-effortless-diagrams.py
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from diaglib import *

OUT = os.path.dirname(os.path.abspath(__file__))


# ── 1. End-to-end map — three transports, one staging table, two ledgers ────
def e2e_map():
    W, H = 1760, 1330
    fig, ax = new_fig(W, H)
    title(ax, W, "Effortless transaction logging — the end-to-end map",
          "three transports converge on one sealed staging table; one review screen; two ledgers")

    # ── INGEST band: the three transports ──
    band(ax, 80, W - 80, 120, "Ingest — three transports")
    cw = 500
    ha = entity_card(ax, 100, 176, cw, "A — forwarding  (live)", [
        ("txn+<tag>@… alias", "user's Gmail rule"),
        ("Apps Script, every 1 min", "shared inbox"),
        ("identity = the +tag", "attacker-typeable"),
    ])
    hb = entity_card(ax, 630, 176, cw, "B — direct read  (canonical)", [
        ("OAuth grant, gmail.readonly", "consent v4 first"),
        ("push (seconds) + poll (5 min)", "watch + pg_cron"),
        ("identity = the grant", "no header trusted"),
    ])
    hc = entity_card(ax, 1160, 176, cw, "C — Python/GCP  (pre-live)", [
        ("Gmail push → Pub/Sub", "gmail-events topic"),
        ("ingest → parser (2 fns)", "parses, logs only"),
        ("persist.py bridge", "built, unmerged"),
    ])

    # ── WORKER card ──
    wy = 430
    wx, ww = 430, 640
    hw = entity_card(ax, wx, wy, ww, "the worker — parse + seal", [
        ("route / resolve identity", "member · family · staging_pub"),
        ("classify + extract", "cache → template → Gemini"),
        ("dedup fingerprint", "keyed HMAC, ±3d rule"),
        ("seal  (X25519 sealed box)", "or HOLD — never plaintext"),
    ], foot="sees plaintext in transit · can never read back what it writes")

    edge(ax, (100 + cw / 2, 176 + ha), (wx + 140, wy), curve=0.10)
    edge(ax, (630 + cw / 2, 176 + hb), (wx + ww / 2, wy))
    edge(ax, (1160 + cw / 2, 176 + hc), (wx + ww - 140, wy), dashed=True,
         label="POST /mailbox-sync/ingest — unmerged", curve=-0.10)

    # ── SEAL boundary ──
    sy = wy + hw + 40
    band(ax, 80, W - 80, sy, "seal — plaintext ends here")

    # ── AT REST band ──
    ry = sy + 80
    h1 = entity_card(ax, 120, ry, 560, "email_transactions  (Supabase)", [
        ("sealed · eph_pub · nonce", "amounts NULL by CHECK"),
        ("review_status = 'pending'", "the only status ever"),
        ("duplicate_of_id", "a suspicion, never a delete"),
    ], foot="the database holds ciphertext + routing metadata only")
    h2 = entity_card(ax, 730, ry, 440, "sender_fingerprints", [
        ("(sender, subject shape)", "parse cache"),
        ("learned templates", "shared by A and B"),
    ])
    h3 = entity_card(ax, 1210, ry, 440, "resolved_email_messages", [
        ("tombstones — ids only", "written before DELETE"),
        ("“finished with this mail”", "stops re-staging"),
    ])

    edge(ax, (wx + ww / 2 - 120, wy + hw), (120 + 280, ry), curve=0.06)
    edge(ax, (wx + ww / 2 + 160, wy + hw), (730 + 220, ry), dashed=True,
         label="learn / read templates", label_off=(215, 32), curve=-0.06)

    # ── ON DEVICE band ──
    dy = ry + max(h1, h2, h3) + 46
    band(ax, 80, W - 80, dy, "on device — readable again")
    rvy = dy + 120
    node(ax, W / 2, rvy, "Review — “Duyệt giao dịch”", w=460, h=64, bold=True,
         sub="opens each sealed box locally · human approves every row")
    edge(ax, (120 + 280, ry + h1), (W / 2 - 120, rvy - 32), curve=0.06,
         label="RLS: own rows only")
    node(ax, W - 320, rvy, "push: “something is waiting”", w=380, h=52,
         sub="no amount, no merchant")
    edge(ax, (120 + 500, ry + h1), (W - 320 - 100, rvy - 26),
         label="insert confirmed → notify the owner", label_off=(185, 34))
    edge(ax, (W / 2 + 230, rvy - 8), (1210 + 220, ry + h3), dashed=True, curve=-0.12,
         label="retire: tombstone → DELETE", label_off=(60, -16))

    ly = rvy + 160
    node(ax, W / 2 - 300, ly, "Family ledger — Gia đình", w=380, h=60, bold=True,
         sub="transactions · family DEK · whole family sees it")
    node(ax, W / 2 + 300, ly, "Personal ledger — Cá nhân", w=380, h=60, bold=True,
         sub="personal_transactions · your key · no un-share")
    edge(ax, (W / 2 - 90, rvy + 32), (W / 2 - 300, ly - 30), label="Nhập")
    edge(ax, (W / 2 + 90, rvy + 32), (W / 2 + 300, ly - 30),
         label="Nhập — default for a connected mailbox", label_off=(90, -10))

    footnote(ax, W, H - 45,
             "nothing auto-imports · seal or hold · the cursor moves last · a duplicate flag can hide nothing")
    save(fig, os.path.join(OUT, "effortless-e2e-map.png"))


# ── 2. The life of one email — staged-row state machine ────────────────────
def state_machine():
    W, H = 1500, 1460
    fig, ax = new_fig(W, H)
    title(ax, W, "The life of one email",
          "every path ends readable, held, or tombstoned — never silently gone")

    cx = W / 2 - 220
    y0 = 150
    node(ax, cx, y0, "Bank email arrives", w=300, h=54, bold=True,
         sub="fetched (B/C) or forwarded (A)")
    y1 = 270
    node(ax, cx, y1, "Routed — whose is it?", w=300, h=54,
         sub="the +tag (A) · the grant (B/C)")
    node(ax, cx + 470, y1, "parse_failures", w=280, h=54,
         sub="unroutable after 14-day grace")
    edge(ax, (cx + 150, y1), (cx + 330, y1), dashed=True, label="no owner")
    edge(ax, (cx, y0 + 27), (cx, y1 - 27))

    y2 = 390
    node(ax, cx, y2, "Classified", w=300, h=54,
         sub="(sender, subject shape) cache")
    node(ax, cx + 470, y2, "Junk — skipped forever", w=280, h=54,
         sub="cached verdict; no model call")
    edge(ax, (cx + 150, y2), (cx + 330, y2), dashed=True, label="not a transaction")
    edge(ax, (cx, y1 + 27), (cx, y2 - 27))

    y3 = 515
    node(ax, cx, y3, "Parsed", w=340, h=56,
         sub="stored template (local, most volume) · else Gemini, then learn one")
    edge(ax, (cx, y2 + 27), (cx, y3 - 28))

    y4 = 655
    node(ax, cx, y4, "Sealed", w=340, h=56, bold=True,
         sub="X25519 box → staging_pub · scope chosen at connect")
    edge(ax, (cx, y3 + 28), (cx, y4 - 28))
    node(ax, cx + 480, y4, "HELD — mailbox waits", w=300, h=56,
         sub="no key · reauth · moved — cursor stays put")
    edge(ax, (cx + 170, y4), (cx + 330, y4), dashed=True, label="cannot seal")
    edge(ax, (cx + 480, y4 - 28), (cx + 120, y3 + 14), dashed=True, curve=0.25,
         label="retry next run", label_off=(60, -20))

    y5 = 795
    node(ax, cx, y5, "STAGED — review_status = 'pending'", w=400, h=58, bold=True,
         sub="sealed row in email_transactions · maybe flagged “Có thể trùng”")
    edge(ax, (cx, y4 + 28), (cx, y5 - 29), label="idempotent on gmail_message_id",
         label_off=(130, 0))

    y6 = 950
    node(ax, cx, y6, "Reviewed by a person", w=340, h=54, bold=True,
         sub="Duyệt giao dịch — ticked · unticked · ✕")
    edge(ax, (cx, y5 + 29), (cx, y6 - 27), label="push: “something is waiting”",
         label_off=(120, 0))
    edge(ax, (cx - 170, y6), (cx - 200, y5 + 25), dashed=True, curve=0.3,
         label="unticked — still there tomorrow", label_off=(-140, 25))

    y7 = 1105
    node(ax, cx - 260, y7, "Imported → ledger", w=310, h=56, bold=True,
         sub="family or personal · encrypted like a typed expense")
    node(ax, cx + 260, y7, "Removed (✕) / duplicate skipped", w=330, h=56,
         sub="“not a transaction I want”")
    edge(ax, (cx - 90, y6 + 27), (cx - 260, y7 - 28), label="Nhập")
    edge(ax, (cx + 90, y6 + 27), (cx + 260, y7 - 28))

    y8 = 1255
    node(ax, cx, y8, "Tombstoned, then DELETED", w=430, h=56, bold=True,
         sub="the tombstone remembers the id — a re-read cannot bring it back")
    edge(ax, (cx - 260, y7 + 28), (cx - 70, y8 - 28))
    edge(ax, (cx + 260, y7 + 28), (cx + 70, y8 - 28))

    footnote(ax, W, H - 45,
             "the one-directional lifecycle: pending → (promote | reject) → deleted · 'approved'/'rejected' are unreachable states")
    save(fig, os.path.join(OUT, "effortless-txn-state.png"))


# ── 3. Duplicate decision tree — pipeline guess, client verdict ────────────
def dedup_tree():
    W, H = 1560, 1160
    fig, ax = new_fig(W, H)
    title(ax, W, "Duplicates — three layers, one principle",
          "a lookup may skip; a guess may only flag; only a human may discard")

    cx = W / 2 - 160

    band(ax, 80, W - 80, 116, "Layer 1 — exactly once (a lookup)")
    y1 = 212
    node(ax, cx, y1, "gmail_message_id already known?", w=420, h=56, bold=True,
         sub="email_transactions ∪ resolved_email_messages, one query per window")
    node(ax, cx + 520, y1, "skip — already handled", w=280, h=52,
         sub="promoted mail never returns")
    edge(ax, (cx + 210, y1), (cx + 380, y1), label="yes")

    band(ax, 80, W - 80, 300, "Layer 2 — the pipeline's fingerprint (a guess)")
    y2 = 410
    node(ax, cx, y2, "another row with the same dedup_fp?", w=440, h=56, bold=True,
         sub="HMAC(key, amount|direction|currency) — equality classes, never values")
    edge(ax, (cx, y1 + 28), (cx, y2 - 28), label="no", label_off=(-22, -62))
    y3 = 540
    node(ax, cx, y3, "same member · ±3 days · different provider · not both banks",
         w=560, h=56,
         sub="“MB Bank” = “MBBank” = “MB” · every clause is a scar")
    edge(ax, (cx, y2 + 28), (cx, y3 - 28), label="yes")
    node(ax, cx + 520, y2 + 65, "stage clean", w=240, h=50, sub="no flag")
    edge(ax, (cx + 220, y2 - 10), (cx + 400, y2 + 55), dashed=True, label="no",
         curve=-0.1)
    edge(ax, (cx + 280, y3 - 5), (cx + 400, y2 + 85), dashed=True,
         label="rule fails", label_off=(30, 20), curve=0.1)
    y4 = 675
    node(ax, cx, y4, "flag: duplicate_of_id", w=340, h=56, bold=True,
         sub="a suspicion — nothing is deleted, nothing is hidden")
    edge(ax, (cx, y3 + 28), (cx, y4 - 28), label="all hold")

    band(ax, 80, W - 80, 765, "Layer 3 — the client's second opinion (better evidence)")
    y5 = 875
    node(ax, cx, y5, "review screen re-runs the rule", w=460, h=56, bold=True,
         sub="with the decrypted amount, transaction_type, and the real ledger")
    edge(ax, (cx, y4 + 28), (cx, y5 - 28))
    y6 = 1020
    node(ax, cx - 320, y6, "flag proven wrong → dropped", w=350, h=56,
         sub="bank-vs-bank — the pipeline could not see transaction_type")
    node(ax, cx + 320, y6, "“Có thể trùng” bucket", w=350, h=56, bold=True,
         sub="the human decides: Vẫn nhập · Bỏ qua")
    edge(ax, (cx - 110, y5 + 28), (cx - 320, y6 - 28))
    edge(ax, (cx + 110, y5 + 28), (cx + 320, y6 - 28))

    footnote(ax, W, H - 40,
             "a missed duplicate costs one tap; a false one hides real money — every layer is biased accordingly")
    save(fig, os.path.join(OUT, "effortless-dedup-tree.png"))


# ── 4. Extraction decision flow — when Gemini, when local ──────────────────
def extract_flow():
    W, H = 1620, 1420
    fig, ax = new_fig(W, H)
    title(ax, W, "Extraction — when a mail reaches Gemini, and when it never leaves",
          "keyed on (sender, subject shape) · the first tier that answers, answers")

    cx = W / 2 - 230
    rx = cx + 560  # right rail for outcomes

    y0 = 150
    node(ax, cx, y0, "one fresh mail", w=340, h=56, bold=True,
         sub="subject normalised to a shape: “Fwd: Biên lai #FT2408… 26/08” → “Biên lai”")

    band(ax, 80, W - 80, 226, "Tier 1 — junk cache (one lookup)")
    y1 = 330
    node(ax, cx, y1, "shape (or sender-wide “*”) cached as junk?", w=460, h=56, bold=True,
         sub="sentinel written after 6 junk shapes and 0 transactions, ever")
    node(ax, rx, y1, "skipped forever", w=280, h=52,
         sub="no model call — most of a real mailbox")
    edge(ax, (cx, y0 + 28), (cx, y1 - 28))
    edge(ax, (cx + 230, y1), (rx - 140, y1), label="yes")

    band(ax, 80, W - 80, 420, "Tier 2 — the stored template (local, free, permanent)")
    y2 = 525
    node(ax, cx, y2, "template for this shape? apply its anchors", w=460, h=56, bold=True,
         sub="regex anchored on labels: “Số tiền giao dịch:[^\\S\\n]*(-?[\\d.,]+)”")
    node(ax, rx, y2, "parsed — stage: 'template'", w=300, h=52,
         sub="the steady state · nothing leaves")
    edge(ax, (cx, y1 + 28), (cx, y2 - 28), label="no")
    edge(ax, (cx + 230, y2), (rx - 150, y2), label="anchors hold + amount")
    node(ax, rx, y2 + 86, "status row says “failed”→ drop", w=300, h=48,
         sub="this mail only — not cached junk")
    edge(ax, (cx + 200, y2 + 24), (rx - 150, y2 + 82), dashed=True, curve=0.08)

    band(ax, 80, W - 80, 640, "Tier 3 — the label-table reader (local — reads an unseen bank's FIRST mail)")
    y3 = 745
    node(ax, cx, y3, "two-column VN bank table readable?", w=460, h=56, bold=True,
         sub="bilingual vocab: “Số tiền / Amount”, “Ngày, giờ giao dịch” · contains-matched")
    node(ax, rx, y3, "parsed — stage: 'table'", w=300, h=52,
         sub="then a template is learned → tier 2 next time")
    edge(ax, (cx, y2 + 28), (cx, y3 - 28), label="no template · anchors failed · stale version")
    edge(ax, (cx + 230, y3), (rx - 150, y3), label="amount + time + counterpart")

    band(ax, 80, W - 80, 860, "Tier 4 — Gemini (the only call that costs money or leaves the machine)")
    y4 = 975
    node(ax, cx, y4, "budget left?  (40 calls per grant)", w=380, h=56, bold=True,
         sub="mail sent AS WRITTEN — consent v4 covers this leg")
    node(ax, rx, y4, "THROW → mailbox HELD", w=300, h=52,
         sub="cursor stays · whole window retried next run")
    edge(ax, (cx, y3 + 28), (cx, y4 - 28), label="ambiguous — the model judges")
    edge(ax, (cx + 190, y4), (rx - 150, y4), dashed=True, label="exhausted")

    y5 = 1115
    node(ax, cx - 380, y5, "“not a transaction”", w=280, h=56,
         sub="cache junk for this shape · maybe write the sender-wide “*”")
    node(ax, cx, y5, "complete extraction", w=280, h=56, bold=True,
         sub="derive a template from THIS body")
    node(ax, cx + 390, y5, "no amount / direction", w=280, h=56,
         sub="'unreadable' → parse_failures · NOT cached — next mail may be complete")
    edge(ax, (cx - 110, y4 + 28), (cx - 360, y5 - 28))
    edge(ax, (cx, y4 + 28), (cx, y5 - 28))
    edge(ax, (cx + 110, y4 + 28), (cx + 370, y5 - 28))

    y6 = 1265
    node(ax, cx, y6, "proof: template reproduces the model's own output exactly", w=520, h=56, bold=True,
         sub="all 11 fields, memo included · pass → stored, shape is tier-2 forever · fail → store null, next mail pays the model again")
    edge(ax, (cx, y5 + 28), (cx, y6 - 28))

    footnote(ax, W, H - 45,
             "Gemini is reached only for: a first-of-its-kind shape the table can't read · a shape whose anchors broke (bank redesign) · a logic-version bump")
    save(fig, os.path.join(OUT, "effortless-extract-flow.png"))


e2e_map()
state_machine()
dedup_tree()
extract_flow()
