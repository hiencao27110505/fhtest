# Statement Coverage — which bank sends what, and which of it we can read

One file says, for every statement format the app has met, who sends it, what
file it is, whether it is locked, and whether the app reads it. A generator
writes that into the statement spec; a test refuses to let the file and the
code disagree. The point is that a bank the app cannot read is a **known gap
with a name**, never a surprise reported by a teammate.

> **Status, 2026-11-08. BUILT** (branch `feat/email-capture`): the JSON, the
> generator (`npm run coverage`), the test (28 checks, in `npm test` by
> discovery), four rows all `supported` and proving. The Techcombank shape's seed
> SQL is printed by the generator and handed over; it is not applied (SC6).
> Agreed in the same grilling as `pdf-statements-spec.md` (decision log §8,
> SC1–SC9). One amendment at build time: **SC5(3) checks orphan seeds only** (a
> seeded shape must have a row); a supported row whose shape is not yet seeded is
> allowed, because seeding is a migration a person applies, and the reader works
> without it (the first mail costs one model verdict).

> **How this relates to its siblings.** `statement-capture-spec.md` §15 today
> describes three real files in prose; this spec replaces that section with a
> generated table. `pdf-statements-spec.md` adds the fourth row and the first PDF.
> The `statement_shapes` seed migration (`0140`) was hand-written; from here its
> rows are derived from the matrix. The provider registry
> (`taxonomy/providers.json`) names the banks; this file says what they send.

---

# Part 1 — Behaviour

## 1. Summary

- **One source: `taxonomy/statement-formats.json`.** One row per statement
  format the app has met: provider, sender address, product, file type, locked
  or not, the password rule as an engineer's note, the subject shape, the
  status, and the fixture that proves it (SC1).
- **Three statuses, each with a meaning the test enforces (SC2):**
  `supported` (a fixture proves through the real reader), `unsupported` (the
  app knows the format and cannot read it; the card says so), `unverified`
  (seen or reported, no sample yet; the card may or may not open).
- **The spec table is generated**, never hand-edited: `statement-capture-spec.md`
  §15 is written between markers from the JSON (SC3).
- **Seeds are derived, migrations stay hand-numbered.** The generator prints the
  `statement_shapes` and `statement_formats` seed SQL for new rows; a person
  writes the numbered migration and applies it (SC6).
- **No digest** (SC7). The gate is the test; the signal in production is the
  `stmt_unread_ext` tally the PDF spec adds.

## 2. Why this exists

- The first failure of statement capture outside the founders was a format gap
  (a PDF), and nothing in the repo could have said in advance "Techcombank card:
  PDF, not read". `statement-capture-spec.md` §15 documents three files in prose
  that only a reader of that section knows about.
- Every reader fix so far was prompted by a real file arriving. A table of what
  has been seen, with the fixture that proves each row, turns that into a list
  with gaps that can be worked in order.

## 3. The row

```json
{
  "provider": "techcombank",            // key in taxonomy/providers.json
  "sender": "thetindung@techcombank.com.vn",
  "product": "card",                    // account | card | wallet
  "ext": "pdf",                         // xlsx | csv | pdf
  "locked": true,
  "password_rule": "unknown",           // engineer's note, never shown in the app (S8)
  "subject_shape": "techcombank thong bao sao ke the tin dung statement",
  "status": "supported",                // supported | unsupported | unverified
  "fixture": "credit-card-techcombank.locked.pdf",
  "seen": "2026-11-08",
  "note": "one header, columns carried across pages, fee rows post-date only, negative = owed"
}
```

- `subject_shape` is exactly what `statementShape()` computes from the real
  subject (digits and non-letters stripped); a test recomputes it from a
  `subject_sample` field and refuses a drift (SC4).
- `password_rule` is for engineers writing fixtures ("date of birth ddmmyyyy",
  "last 6 of CCCD", "unknown"). The app never surfaces it (S8).
- `fixture` names a file under `tools/fixtures/statements/`; required when
  `status = supported`, forbidden otherwise.

## 4. Initial rows

| provider | sender | product | ext | locked | status | fixture |
|---|---|---|---|---|---|---|
| vib | info@myvib.vib.com.vn | account | xlsx | no | supported | bank-account.xlsx |
| vib | info@card.vib.com.vn | card | xlsx | yes | supported | credit-card.locked.xlsx |
| momo | no-reply@mservice.com.vn | wallet | xlsx | yes | supported | ewallet.locked.xlsx |
| techcombank | thetindung@techcombank.com.vn | card | pdf | yes | unverified → supported when the PDF reader lands | credit-card-techcombank.locked.pdf |

A bank the app has never seen a statement from has **no row** (SC5): the matrix
records what has been met, not every bank in the registry.

## 5. What the test enforces (SC5)

`tools/statement-coverage.test.js` fails when:

1. a `supported` row has no fixture, or its fixture does not prove through the
   real `fhStmtParse` + `fhStmtProve` (xlsx/csv) or the real `43-pdf-grid` +
   reader (pdf);
2. a fixture exists under `tools/fixtures/statements/` with no row naming it;
3. a `(sender_address, shape)` seeded in the latest `statement_shapes` seed
   migration has no row, or a `supported` row's shape is not seeded;
4. a row's `subject_shape` differs from `statementShape(subject_sample)`;
5. a row's `provider` is not a key in `taxonomy/providers.json`;
6. the generated §15 block in `statement-capture-spec.md` differs from what the
   generator produces now (run the generator, commit the result).

## 6. The generator

`tools/gen-statement-coverage.js`:

- reads `taxonomy/statement-formats.json`;
- rewrites `docs/specs/statement-capture-spec.md` between
  `<!-- coverage:begin -->` and `<!-- coverage:end -->` with a table sorted by
  provider, then product; `unsupported` and `unverified` rows carry their note;
- prints, to stdout, the `insert … on conflict do nothing` statements for
  `statement_shapes` rows not yet in any seed migration, and for
  `statement_formats` seed rows (the PDF spec §12) whose format JSON lives beside
  the matrix in `taxonomy/statement-formats/<fixture>.format.json`;
- never writes a migration file (SC6).

Run by `npm run coverage`; `npm run check` runs the test, so a stale table fails
the build the way a stale `index.html` does.

## 7. Not in this spec

- A runtime threshold. The gate is the test (SC8).
- A weekly digest of unsupported or rejected files (SC7).
- Rows for banks never seen. A teammate's "my bank sends X" becomes an
  `unverified` row with `seen` and `note`, nothing more, until a sample lands.

---

# Part 2 — Technical Appendix

## 8. Decision log

| # | Decision | Why |
|---|---|---|
| SC1 | **The matrix is data**, `taxonomy/statement-formats.json`, one row per format met. | Prose drifts; a JSON row can be tested |
| SC2 | Statuses `supported · unsupported · unverified`, each with a test-enforced meaning. | "Supported" must be provable |
| SC3 | **§15 of the capture spec is generated between markers**; a stale block fails `npm run check`. | The spec cannot drift from the JSON |
| SC4 | Columns: `provider · sender · product · ext · locked · password_rule · subject_shape (+ subject_sample) · status · fixture · seen · note`. | — |
| SC5 | A `supported` row without a proving fixture fails; a fixture without a row fails; a seeded shape without a row fails; a bank never seen may have no row. | What is claimed is proved; nothing proved is unlisted |
| SC6 | **Seeds stay hand-numbered.** The generator prints SQL; a person writes and applies the migration. | Migrations are append-only and the user's to run |
| SC7 | **No digest.** | Decided in round 1 |
| SC8 | No runtime threshold; the test is the gate. | — |
| SC9 | Deliverable: this spec, the JSON, the generator, the test, and the four initial rows; built after the PDF reader as its acceptance gate. | — |

## 9. Module map

| File | Role |
|---|---|
| `taxonomy/statement-formats.json` (new) | the matrix |
| `taxonomy/statement-formats/*.format.json` (new) | the learned/seeded format per fixture (PDF spec §12) |
| `tools/gen-statement-coverage.js` (new) | the §15 block + seed SQL to stdout |
| `tools/statement-coverage.test.js` (new) | §5 |
| `tools/make-statement-fixtures.py` | the fixture for every `supported` row, synthetic |
| `docs/specs/statement-capture-spec.md` | §15 between markers |
| `package.json` | `coverage` script; `check` runs the test |

## 10. Related

- `docs/specs/statement-capture-spec.md` — §9 (the verdict cache this seeds), §15 (the generated block).
- `docs/specs/pdf-statements-spec.md` — the row this matrix gates, and `statement_formats`.
- `taxonomy/providers.json`, `tools/gen-providers.js` — the registry pattern this copies.
