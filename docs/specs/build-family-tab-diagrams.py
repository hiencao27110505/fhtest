# Renders the five family-tab-spec diagrams in the personal-ledger spec style.
# Run: /opt/homebrew/bin/python3 build-family-tab-diagrams.py
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from diaglib import *

OUT = os.path.dirname(os.path.abspath(__file__))


# ── 1. IA map — the tab and everything it opens ────────────────────────────
def ia_map():
    W, H = 1860, 980
    fig, ax = new_fig(W, H)
    title(ax, W, 'The Family tab ("Gia đình") — one flat scroll, many doors',
          "left: the tab top-to-bottom · right: the sheets and screens each section opens")

    # left column: the scroll
    lx, lw = 90, 470
    band(ax, lx, lx + lw, 120, "The tab — #v-spending")
    secs = [
        ("Header — Gia đình", "month pill → month picker"),
        ("Setup nudge", "only until a budget exists"),
        ("Widget A — Cash flow", "left this month · In/Out · Day/Week/Month · daily guide · 4 CTAs"),
        ("Widget B — Tích lũy", "savings pot · goals · momentum spark"),
        ("Giao dịch gần đây", "realized + set-asides + proposals"),
        ("Phòng khách", "reactions wall — hidden until reactions exist"),
        ("Xu hướng 6 tháng", "spent vs budget bars — hidden until history"),
        ("Suggest footer + FAB", "feedback sheet · log an expense"),
    ]
    y = 200
    sec_pos = {}
    for name, subtext in secs:
        node(ax, lx + lw / 2, y, name, w=lw, h=64, bold=True, sub=subtext)
        sec_pos[name] = (lx + lw, y)
        y += 86

    # right column groups
    def group(x, y0, title_text, items, w=350):
        band(ax, x, x + w, y0, title_text)
        yy = y0 + 66
        pos = []
        for it in items:
            if isinstance(it, tuple):
                node(ax, x + w / 2, yy, it[0], w=w, h=58, sub=it[1])
            else:
                node(ax, x + w / 2, yy, it, w=w, h=44)
            pos.append((x, yy))
            yy += 74 if isinstance(it, tuple) else 60
        return pos

    gx1 = 720
    p_sheets = group(gx1, 120, "Sheets", [
        ("Month picker", "sheet-month · selectMonth"),
        ("Budget setup", "sheet-budget · total + categories + Others"),
        ("Saving-goal %", "sheet-savegoal · spend X% less"),
        ("Family income", "fhIncome · informational ledger"),
        ("Savings pool", "fhSavings · set the pot total"),
        ("Create / fund goal", "openGoal · fhFundGoal"),
    ])
    gx2 = 1160
    p_screens = group(gx2, 120, "Screens & overlays", [
        ("Expense list", "openTxns → #txn-overlay · search, chips, by-month"),
        ("Category breakdown", "#fh-legend · spend vs budget per category"),
        ("Category / member drill-in", "openCat → #cat-overlay"),
        ("Expense detail", "openExpenseDetail · read-first, reactions or review"),
        ("Goal detail", "openGoalDetail · read-first, review block"),
        ("Requests hub", "openRequests → #requests-overlay · incoming vs mine"),
    ])
    gx3 = 1600
    p_capture = group(gx3, 120, "Capture doors", [
        ("Expense sheet", "FAB · bulk NL entry, photos, scope"),
        ("Photo-assign", "paIngest · EXIF-dated receipts"),
        ("File import", "CSV / XLSX review"),
        ("Email review", "staged bank-email queue"),
    ], w=230)

    # a few representative edges (kept sparse for legibility)
    edge(ax, sec_pos["Header — Gia đình"], (gx1, p_sheets[0][1]), curve=0.08)
    edge(ax, sec_pos["Widget A — Cash flow"], (gx1, p_sheets[1][1]), curve=0.06)
    edge(ax, sec_pos["Widget A — Cash flow"], (gx1, p_sheets[2][1]), curve=0.10)
    edge(ax, sec_pos["Widget A — Cash flow"], (gx1, p_sheets[3][1]), curve=0.14)
    edge(ax, sec_pos["Widget A — Cash flow"], (gx2, p_screens[0][1]), curve=-0.10)
    edge(ax, sec_pos["Widget A — Cash flow"], (gx2, p_screens[5][1]), curve=0.16)
    edge(ax, sec_pos["Widget A — Cash flow"], (gx3, p_capture[3][1]), curve=-0.22)
    edge(ax, sec_pos["Widget B — Tích lũy"], (gx1, p_sheets[4][1]), curve=0.10)
    edge(ax, sec_pos["Widget B — Tích lũy"], (gx1, p_sheets[5][1]), curve=0.12)
    edge(ax, sec_pos["Widget B — Tích lũy"], (gx2, p_screens[4][1]), curve=0.10)
    edge(ax, sec_pos["Giao dịch gần đây"], (gx2, p_screens[3][1]), curve=-0.06)
    edge(ax, sec_pos["Giao dịch gần đây"], (gx2, p_screens[0][1]), curve=-0.18)
    edge(ax, sec_pos["Xu hướng 6 tháng"], (gx1, p_sheets[0][1]), curve=0.30)
    edge(ax, sec_pos["Suggest footer + FAB"], (gx3, p_capture[0][1]), curve=0.30)

    footnote(ax, W, H - 46,
             "Every door funnels into one write path (addExpense) and one shared money model — "
             "the drill-ins are one implementation reused, not lookalike screens.")
    save(fig, os.path.join(OUT, "family-tab-ia-map.png"))


# ── 2. Money-model flowchart ───────────────────────────────────────────────
def money_flow():
    W, H = 1820, 1150
    fig, ax = new_fig(W, H)
    title(ax, W, "Where a family đồng lives — realized, reserved, safe",
          "every logged amount takes exactly one of these paths · safe-to-spend counts promises, not just receipts")

    # entry
    node(ax, 360, 170, "An expense is logged", w=280, h=56, fc=GREEN, tc="white", bold=True)

    # decision 1: Event category
    node(ax, 360, 300, 'Category = "Event"?', w=250, h=54, ec=GREEN)
    edge(ax, (360, 198), (360, 273))
    # event branch
    node(ax, 850, 240, "events row — an occasion", w=300, h=54, bold=True)
    edge(ax, (485, 300), (700, 250), label="yes")
    node(ax, 1330, 180, "date already passed →\nachieved · spent now", w=300, h=64)
    node(ax, 1330, 300, "future date →\nsetAside · RESERVED", w=300, h=64)
    edge(ax, (1000, 235), (1180, 185))
    edge(ax, (1000, 255), (1180, 295))

    # decision 2: future date
    node(ax, 360, 440, "Date in the future?", w=250, h=54, ec=GREEN)
    edge(ax, (360, 327), (360, 413), label="no")

    # realized branch
    node(ax, 360, 600, "REALIZED\nstatus='realized' · counts in spent,\ncatSpent, memberSpent", w=330, h=90,
         fc="#eef4f0", ec=GREEN, bold=True)
    edge(ax, (360, 467), (360, 555), label="no — today or past")
    node(ax, 360, 750, "Reactions open up\n(the five emoji — social, non-blocking)", w=330, h=64)
    edge(ax, (360, 645), (360, 718))

    # proposal branch
    node(ax, 900, 440, "PROPOSAL\nstatus='planned' · a request,\nnot yet money", w=300, h=84, fc="#fdf6df",
         ec="#e0a500", bold=True)
    edge(ax, (485, 440), (750, 440), label="yes")
    node(ax, 1380, 440, "ALIGNED\na 'love-it' review from someone\nother than the proposer", w=320, h=84,
         fc="#eef4f0", ec=GREEN, bold=True)
    edge(ax, (1050, 440), (1220, 440), label="another member reviews", label_off=(0, -22))
    node(ax, 1380, 620, "Money is set aside from this\nmonth's budget — not spent yet", w=320, h=64)
    edge(ax, (1380, 482), (1380, 588))
    node(ax, 900, 620, "A person updates it when paid →\nbecomes REALIZED (never automatic)", w=330, h=64)
    edge(ax, (1220, 630), (1067, 625))
    edge(ax, (900, 652), (525, 605), curve=-0.15)

    # formula band
    band(ax, 120, W - 120, 850, "The headline number")
    ax.text(W / 2, 925, "safe to spend  =  budget  −  spent  −  reserved",
            ha="center", va="center", fontsize=16, fontweight="bold", color=INK, fontfamily=MONO)
    ax.text(W / 2, 970,
            "reserved  =  event set-asides (not yet achieved)  +  future expenses (aligned only — an unaligned proposal reserves nothing)",
            ha="center", va="center", fontsize=11.5, color=MUT, fontfamily=SANS)
    footnote(ax, W, 1050,
             "The savings pool and family income are separate ledgers: income is informational (never auto-saved), "
             "and the pool funds goals through event_fundings — neither moves 'spent'.")
    save(fig, os.path.join(OUT, "family-money-flow.png"))


# ── 3. Sequence — add expense, offline, and the family sync ────────────────
def seq_expense():
    W, H = 1700, 1580
    fig, ax = new_fig(W, H)
    ACTORS = [("You", 150), ("Your device", 560), ("Outbox (on device)", 940),
              ("Supabase", 1280), ("Family's other devices", 1560)]
    for label, cx in ACTORS:
        actor_box(ax, cx, 40, label, w=min(250, 200 if len(label) < 12 else 250))
        lifeline(ax, cx, 96, H - 60)
    X = {a: c for a, c in ACTORS}

    band(ax, 40, W - 40, 120, "You log an expense")
    arrow(ax, X["You"], X["Your device"], 200, "Save (single or bulk rows)")
    self_loop(ax, X["Your device"], 250, "Optimistic: row into txns · spent/catSpent/memberSpent bump · re-render")
    self_loop(ax, X["Your device"], 320, "Encrypt fields (fhField) — blocked if enc family and no key")

    band(ax, 40, W - 40, 380, "Online path")
    arrow(ax, X["Your device"], X["Supabase"], 450, "INSERT transactions (+ photos after)")
    arrow(ax, X["Supabase"], X["Your device"], 520, "row id", dashed=True)
    self_loop(ax, X["Your device"], 570, "Debounced 700 ms → windowed re-hydrate (skipped while an editor is open)")

    band(ax, 40, W - 40, 650, "Offline path — the outbox")
    arrow(ax, X["Your device"], X["Outbox (on device)"], 720, "Queue with client-minted uuid = future PK")
    self_loop(ax, X["Outbox (on device)"], 770, "Photos encrypted at rest when the family is enc + keyed")
    self_loop(ax, X["Your device"], 840, "Back online (+600 ms) · boot (+3 s) · after unlock (+400 ms)")
    arrow(ax, X["Outbox (on device)"], X["Supabase"], 910, "Replay in order, oldest first — stop at first failure")
    arrow(ax, X["Supabase"], X["Outbox (on device)"], 980, "duplicate key → already landed → item done", dashed=True)

    band(ax, 40, W - 40, 1050, "Sync to the family")
    arrow(ax, X["Supabase"], X["Family's other devices"], 1120, "Realtime tick (fam-<fid> channel)")
    self_loop(ax, X["Family's other devices"], 1170,
              "Echo-suppress own writes (2.5 s) · debounce 900 ms", side="left")
    arrow(ax, X["Family's other devices"], X["Supabase"], 1240, "Windowed hydrate (full if the row is out-of-window)")
    arrow(ax, X["Supabase"], X["Family's other devices"], 1310, "fresh snapshot → re-render", dashed=True)
    arrow(ax, X["Supabase"], X["Family's other devices"], 1380, "Web Push nudge for closed apps — no amounts in the payload")
    self_loop(ax, X["Your device"], 1440, "Mirror pass → your personal ledger (see personal-ledger spec)")

    footnote(ax, W, H - 40,
             "Inserts are idempotent by their pre-minted uuid; everything else is last-writer-wins, "
             "reconciled by the next hydrate.")
    save(fig, os.path.join(OUT, "family-seq-expense.png"))


# ── 4. State machines — transaction · month · encryption ───────────────────
def state_machines():
    W, H = 1860, 1150
    fig, ax = new_fig(W, H)
    title(ax, W, "Three lifecycles behind the Family tab",
          "a transaction, a month, and the family's encryption state")

    # (a) transaction
    band(ax, 60, W - 60, 120, "A family transaction")
    node(ax, 250, 230, "Logged\n(expense sheet, import,\nemail review)", w=250, h=84, fc=GREEN, tc="white", bold=True)
    node(ax, 660, 180, "REALIZED\ncounts in spent", w=240, h=64, fc="#eef4f0", ec=GREEN, bold=True)
    node(ax, 660, 300, "PLANNED — pending\n'waiting for the family'", w=240, h=64, fc="#fdf6df", ec="#e0a500", bold=True)
    node(ax, 1100, 300, "PLANNED — aligned\nreserves budget", w=240, h=64, fc="#eef4f0", ec=GREEN, bold=True)
    node(ax, 1540, 240, "Edited / deleted\naggregates reversed, then reapplied", w=280, h=64)
    edge(ax, (375, 210), (540, 185), label="today or past")
    edge(ax, (375, 255), (540, 295), label="future date")
    edge(ax, (780, 300), (980, 300), label="a 'love-it' review from a non-creator", label_off=(0, 18))
    edge(ax, (1100, 268), (760, 200), curve=-0.2,
         label="a person moves the date to today/past — never automatic", label_off=(30, -26))
    edge(ax, (780, 170), (1400, 220), label="edit / delete", label_off=(0, -14))

    # (b) month
    band(ax, 60, W - 60, 440, "A month")
    node(ax, 400, 560, "OPEN — the live month\npace marker · daily guide ·\nDay/Week/Month periods · reserves count", w=340, h=96,
         fc="#eef4f0", ec=GREEN, bold=True)
    node(ax, 1100, 560, "DONE — a closed copy\ntotals only · no reserve · classic week chart\n'under / over budget' verdict", w=380, h=96, bold=True)
    edge(ax, (570, 560), (910, 560), label="calendar rolls over — derived, nothing is written")
    ax.text(1100, 650, "monthly_budgets.closed exists in the schema but nothing reads or writes it",
            ha="center", fontsize=9.5, style="italic", color=MUT, fontfamily=SANS)

    # (c) encryption
    band(ax, 60, W - 60, 730, "The family's encryption state (family_keys.enc_state)")
    node(ax, 330, 860, "OFF\nplaintext only", w=220, h=64, bold=True)
    node(ax, 800, 860, "DUAL\nplaintext + ciphertext twins", w=260, h=64, fc="#fdf6df", ec="#e0a500", bold=True)
    node(ax, 1330, 860, "ENC — terminal\nciphertext only · DB triggers reject\nplaintext (one-way valve)", w=300, h=80,
         fc="#eef4f0", ec=GREEN, bold=True)
    edge(ax, (440, 860), (670, 860), label="turn encryption on")
    edge(ax, (670, 890), (440, 890), label="dual → off wipes ciphertext", curve=0.3)
    edge(ax, (930, 860), (1180, 860), label="owner scrubs plaintext")
    node(ax, 500, 1020, "Device: LOCKED\nreads placeholders · every money write blocked", w=340, h=64)
    node(ax, 1150, 1020, "Device: KEYED\nfull read/write · DEK cached non-extractable", w=340, h=64)
    edge(ax, (670, 1010), (980, 1010), label="Key Card / passcode unlock (offline-capable)")
    edge(ax, (980, 1035), (670, 1035), label="sign out / key drop", curve=0.25)

    save(fig, os.path.join(OUT, "family-state-machines.png"))


# ── 5. Data model ──────────────────────────────────────────────────────────
def data_model():
    W, H = 1980, 1620
    fig, ax = new_fig(W, H)
    title(ax, W, "Family finance — the tables behind the tab",
          "every money value is a plaintext/ciphertext pair · DB triggers enforce the pair once encryption is on")

    # center: transactions
    tx_x, tx_y, tx_w = 760, 300, 480
    entity_card(ax, tx_x, tx_y, tx_w, "transactions", [
        ("id PK", "client-minted uuid when queued offline"),
        ("family_id → families", "RLS anchor"),
        ("category_id → categories", "RESTRICT"),
        ("member_id → members", "the PAYER · null on planned"),
        ("created_by", "the PROPOSER"),
        ("amount/_enc · note/_enc", "pt/ct pairs"),
        ("txn_date", "the day — always plaintext"),
        ("occurred_time(_enc)", "optional HH:MM"),
        ("status", "'realized' | 'planned'"),
        ("link_id · version", "personal mirror, write-once"),
        ("kind · transfer_*", "transfer-ready, unused"),
    ], foot="enc guard + link guard triggers · realized = status≠planned AND date ≤ today")

    # left column
    entity_card(ax, 70, 140, 420, "monthly_budgets", [
        ("family_id + month UNIQUE", "month = first of month"),
        ("budget_total / _enc", "0 is the scrubbed placeholder"),
        ("closed", "schema-only — nothing reads it"),
    ])
    entity_card(ax, 70, 400, 420, "category_budgets", [
        ("family + month + category", "UNIQUE"),
        ("amount / amount_enc", "pt/ct pair"),
        ("→ monthly_budgets", "parent auto-created by trigger"),
    ])
    entity_card(ax, 70, 650, 420, "categories", [
        ("name/_enc · emoji", "rename = one-way valve"),
        ("archived_at", "soft delete, old txns resolve"),
        ('"Others" catch-all', "client invariant: always exists"),
    ])
    entity_card(ax, 70, 900, 420, "incomes", [
        ("member_id → members", "SET NULL on member archive"),
        ("amount/_enc · note/_enc", "pt/ct pairs"),
        ("income_date", "informational — never feeds budget"),
    ])
    entity_card(ax, 70, 1150, 420, "families · family_keys", [
        ("currency · timezone · house", "family-level"),
        ("save_goal_pct", "0–90, tightens the daily guide"),
        ("enc_state", "off | dual | enc (terminal)"),
    ])

    # right column
    entity_card(ax, 1490, 140, 420, "saving_goals", [
        ("name/_enc · target/_enc", "pt/ct pairs"),
        ("occasion_id → events", "optional — money vs moment"),
        ("achieved · created_by", "proposal-aware"),
        ("archived_at", "archive = full funding reversal"),
    ])
    entity_card(ax, 1490, 430, 420, "event_fundings", [
        ("event_id OR goal_id", "at least one — shared ledger"),
        ("source", "'savings' pool | 'budget'"),
        ("month", "budget only · 1/(event, month)"),
        ("amount / amount_enc", "pt/ct pair"),
    ], foot="a goal's saved total and the pool balance are both derived from here")
    entity_card(ax, 1490, 740, 420, "savings_entries", [
        ("kind", "'deposit' | 'withdrawal'"),
        ("amount/_enc · note/_enc", "pt/ct pairs"),
    ], foot="pool = Σ deposits − withdrawals − savings-source fundings")
    entity_card(ax, 1490, 960, 420, "events (money facet)", [
        ("target_amount/_enc", "null = moneyless occasion"),
        ("achieved", "or target_date passed"),
        ("source_txn_id → txns", "photo-expense mirror, 1 live"),
    ])

    # bottom middle
    entity_card(ax, 460, 1020, 380, "transaction_photos", [
        ("transaction_id →", "CASCADE with the row"),
        ("photo_url", "'.enc' object when enc"),
        ("taken_on", "EXIF day, pre-compression"),
    ])
    entity_card(ax, 900, 1020, 380, "reactions", [
        ("txn_id + member_id", "UNIQUE — re-react replaces"),
        ("emoji", "the five — realized rows only"),
    ])
    entity_card(ax, 900, 1250, 380, "request_reviews", [
        ("entity + member UNIQUE", "polymorphic, replace"),
        ("entity_type", "'expense'|'goal'|'occasion'"),
        ("emoji", "same five, as consent"),
    ], foot="only a 'love-it' from a non-creator aligns (client rule)")
    entity_card(ax, 460, 1250, 380, "personal_transactions", [
        ("link_id ↔ transactions", "1↔1 mirror pairing"),
    ], foot="see the personal-ledger spec")

    # edges (FKs only, kept sparse)
    edge(ax, (490, 730), (760, 450), curve=0.08)          # categories → tx
    edge(ax, (1700, 430), (1700, 315))                    # fundings → goals
    edge(ax, (1490, 1010), (1240, 590), curve=0.12)       # events.source_txn_id → tx
    edge(ax, (650, 1020), (900, 630))                     # photos → tx
    edge(ax, (1090, 1020), (1090, 660))                   # reactions → tx
    edge(ax, (1280, 1275), (1250, 640), curve=-0.15)      # reviews → tx (expense)
    edge(ax, (650, 1250), (770, 620), curve=0.1)          # personal mirror

    band(ax, 80, W - 80, 1480, "Tenancy & encryption rule")
    ax.text(W / 2, 1545,
            "Every table: RLS family_id = auth_family_id() · composite FKs pin children to the same family · "
            "no DELETE policy on members/categories/events/saving_goals (soft delete).",
            ha="center", va="center", fontsize=11, color=INK, fontfamily=SANS)
    ax.text(W / 2, 1575,
            "Once enc_state ≠ 'off', _fh_enc_guard triggers reject plaintext-only money writes; 'enc' is permanent.",
            ha="center", va="center", fontsize=11, color=MUT, fontfamily=SANS)
    save(fig, os.path.join(OUT, "family-data-model.png"))


if __name__ == "__main__":
    ia_map(); money_flow(); seq_expense(); state_machines(); data_model()
