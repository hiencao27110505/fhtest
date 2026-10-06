# Incident: recurring-charge detection marked a coffee shop and missed rent and subscriptions

| | |
|---|---|
| Date | 2026-10-06, found the same evening in the first real test |
| Feature | Recurring charges, release 1 (`recurring-charges-spec.md`), live since 19:35 ICT that day |
| Severity | Low for data, high for trust. A label was wrong; no amount, date, category or scope changed. |
| Status | Root causes confirmed by replay on 2026-10-07. Resolution specified in `recurring-charges-spec.md` §18 (detection v2) and released the same day (SW v616, commits `3a8b2d2`, `acc256a`). Follow-up 5 is the open check. |
| Found by | Hien, testing on the test account's personal ledger |

## What happened

About an hour after release, the Định kỳ tile on Tài chính showed one recurring
charge: a coffee shop, "REVI PHU MY HUNG TOWER", 60.000 đ, "quá 12 ngày",
about 260.000 đ a month. Rent, two software subscriptions and a streaming
subscription, all paid monthly for a year, showed **Định kỳ: Không** on their
detail screens. The rent payment waiting in the review queue also showed Không.

The feature produced one answer and it was the wrong one, while missing every
answer a person would have given.

## Impact

| | |
|---|---|
| Accounts | One (the test account). No other account had consented to the new client yet. |
| Wrong marks written | 1 row of 723: the coffee row of 2026-09-17, `weekly` / `pattern` |
| Real recurring charges detected | 0 of at least 4 (rent, Anthropic, YouTube Premium, Google One) |
| Wrong figure shown | "~260.000 đ / tháng" on the tile |
| Money, dates, categories, scope | Untouched. The mark is a label and a derived date (spec §4.1). |
| Family ledger | Not observed. It holds full history, so cause 1 does not apply; causes 2, 3 and 5 do. |

## Timeline (ICT)

| When | What |
|---|---|
| 10-06 19:35 | Migration `0157` applied; `mailbox-sync` v77 deployed; client SW v615 pushed |
| 10-06 19:46 | Migration `0158` applied (snapshot RPC lacked the two columns; found by review, not by a user) |
| 10-06 20:30 | Hien opens the app. The pattern pass runs 2.5 s after hydrate and writes one mark |
| 10-06 20:31–20:56 | Hien checks the tile, six detail screens and one queue card; reports the mismatch |
| 10-07 | Investigation: code reading, one plaintext query, and a replay of the real engine on the rows in the screenshots |

## Root causes

Five causes. The first two together produce exactly what was seen; the other
three would have kept the feature wrong even with the first two fixed.

### 1. The engine was given five weeks of a thirteen-month ledger

The personal tab keeps rows from the 1st of last month in memory (`_winFrom()`
in `19-personal.js`; boot cost is the reason). Older rows load into
`P.txnsOld` only when the Giao dịch history screen is opened. The pattern pass
read `P.txns` plus `P.txnsOld`, and at 2.5 s after boot `P.txnsOld` is empty.

- Ledger: 723 expense rows, 2025-10-06 to 2026-10-06, 45 to 77 a month.
- Given to the engine: the 83 rows dated 2026-09-01 or later.

A monthly charge needs two occurrences to be seen. In a five-week window that
happens only when this month's charge has already been imported. A yearly
charge can never be seen. A weekly gap fits several times over. **The window
selected for habits and against subscriptions.**

Replay with the real engine:

| Input | Result |
|---|---|
| Rent, rows since 1 Sep only | no series |
| Rent, August and September | monthly, next 2026-10-06 |
| Anthropic, rows since 1 Sep only | no series |
| Anthropic, August and September | monthly, next 2026-10-18 |

### 2. One qualifying pair was enough, and every visit counted as confirmation

The rule let each consecutive pair of charges vote for a period, and marked
the merchant when the latest pair fitted. Nothing asked whether the merchant's
charges were *regular*.

The coffee shop, replayed: seven visits, gaps of 2, 1, 4, 1, 0 and 7 days. One
gap of six fits "weekly". Result: weekly, next 2026-09-24, 260 a month, which
is the tile to the digit. The "có vẻ" softness that should have hedged a
two-charge guess was computed from the number of rows at the merchant (7), not
the number of charges in cadence (2), so the guess was shown as fact and added
to the monthly total.

A stored `pattern` mark then anchored the period for the whole merchant on the
next run. One wrong guess would have reinforced itself indefinitely.

### 3. "Same merchant" was the first three words of the note, plus the category

Rows in `P.txns` do not carry the payee: `counterparty_enc` is decrypted for
debt rows and for the review's match slice, not for the tab. The engine fell
back to its family-row key, the note's first three words joined to the
category name.

Replay: September's rent reads "Em gui tien nha. Cam on a Quang." under Nhà ở
& hoá đơn. October's reads "Em chuyen tien nha. Cam on anh Quang." and sits
in the queue under Khác. Different words, different category, different key.
October never joins the series, which stays at two charges, soft, with its
next date stuck in the past.

Every one of the 723 rows has a payee in the database. The identity the engine
needed was there and was not loaded.

### 4. The receipt source was specified and half built

`recurring-charges-spec.md` §10 says a joined receipt with a period, or with
renewal wording, marks the row. What shipped marks a row only when it is
imported from the queue with a receipt read by the new reader. Three paths in
the spec were not built:

- a receipt attached to a row already in the ledger (`fhPersonalSetReceipt`) sets no mark;
- receipts read before 2026-10-06 carry no `period` key, and nothing re-derives it;
- the renewal-word fallback over the item's own text ("(Monthly)", "Renews …") does not exist.

YouTube Premium has a receipt that says "Monthly" in the item name. It showed Không.

### 5. The review queue never asked the ledger

The queue card's Định kỳ value came from the person's pick, the joined
receipt, or a merchant lesson. It did not look at the series already in the
ledger. A tenth monthly rent payment arrives looking like a first.

### Contributing

- **The tests encoded the idea, not the data.** `tools/recur-engine.test.js`
  had two-row fixtures built to satisfy the rule. None had a merchant visited
  seven times in five weeks, and none modelled what the engine is actually
  handed at boot. All 24 checks passed on a rule that fails the first real ledger.
- **No replay before release.** The ledger is end-to-end encrypted, so a
  server-side check was impossible, but dates, kinds and counts are plaintext.
  One query (rows per month) against the engine's input window would have
  shown 83 of 723. It was run after the report instead of before the deploy.
- **A known fact was not connected.** The two-month tab window is documented
  in the code and had already caused a detail-screen bug on 2026-10-02
  (`_exdRowOf`, same root). The design interview decided "pattern on device
  after hydrate" without asking which rows are in memory after hydrate.
- **Spec and build drifted in one session.** §10's three receipt paths were
  written at 17:00 and not built by 19:00. Nothing compares the two.

## What went well

- The mark is a label by design (§4.1), so the blast radius was one enum on one row.
- The person's "Không" already blocks a merchant and forgets its lesson, so the wrong mark was correctable in one tap from the first minute.
- Reported within the hour, with screenshots that named the exact rows; the replay needed no guessing.

## Resolution

Specified as detection v2 in `recurring-charges-spec.md` §18, decisions
RR10–RR19. In short:

| Cause | Fix |
|---|---|
| 1 | A recurrence slice: 25 months of expense rows, loaded in the background, never on the boot path (RR10) |
| 2 | A cadence rule: at most one charge per period, most gaps must fit, softness from charges in cadence. Two monthly charges are never stated as fact; off a recurring leaf they are not even a guess. Pattern marks are re-derived every run and a stale one is cleared (RR11, RR12, RR17) |
| 3 | Identity by payee, then by a recurring leaf of the tree, then by exact amount; category leaves the key (RR13) |
| 4 | The three receipt paths built; receipt wording read as well as the `period` key (RR15) |
| 5 | The queue card matches a candidate against the ledger's series (RR16) |
| — | The tree's recurring leaves act as a soft hint and lower the confirmation threshold; never a stored mark (RR14) |
| — | One truth: tile, detail row and queue card all read the same series view (RR18) |

The one wrong mark needs no manual cleanup: RR17 clears a `pattern` mark that
the engine no longer derives.

## Follow-ups

| # | Action | Where |
|---|---|---|
| 1 | Done. The incident's rows are the fixtures: the seven-visit coffee shop with v1's stored mark, rent with changed wording and category, a five-week input window, an incomplete slice | `tools/recur-engine.test.js`, `tools/recur-flow.test.js` |
| 2 | Done. Before shipping any on-device derivation: name the rows it will be handed, and compare their count with the ledger's using one plaintext query | `AGENT_SYNC.md` §7 |
| 5 | After release: confirm on the test ledger that the 2026-09-17 mark is cleared and that rent, Anthropic and YouTube Premium are marked (one plaintext query on `recurrence`, `recurrence_source`, `txn_date`) | first run after push |
| 3 | A spec section that describes behaviour not yet built carries "NOT BUILT" in its own text until it is | `recurring-charges-spec.md` §17 |
| 4 | Queue-wide detection (a year of rent all waiting in the queue, none in the ledger) is still not covered; the pass runs after import | `recurring-charges-spec.md` §18.9 |
