# Statement coverage matrix  (brief, 2026-11-08)
Status: merged

Built big-bang with the consent gate and PDF statements (founder's call, 2026-11-08). No screens: this is a repo artefact. Design: `docs/specs/statement-coverage-spec.md` (SC1–SC9).

## End state

### Announcement
None user-facing (engineering tooling). Release note: none.

### Outcome
`taxonomy/statement-formats.json` names every statement format the app has met, with its status; `npm run coverage` writes the table into `statement-capture-spec.md` §15 and prints the seed SQL for supported shapes not yet seeded; `tools/statement-coverage.test.js` refuses a supported row without a proving fixture, a fixture without a row, a seeded shape without a row, a stale table, or a shape that is not what `statementShape()` computes.

### Thresholds
None at runtime; the test is the gate (SC8).

## Journey
1. A new format is met → a row is added (`unverified` until a fixture proves it) → the test demands the fixture before `supported` → the generator prints the seed SQL → a person numbers and applies the migration.

## Acceptance criteria
- [x] Four rows: VIB account, VIB card, MoMo wallet, Techcombank card PDF, all `supported`, each proving through the real reader in the test.
- [ ] `node tools/gen-statement-coverage.js --check` passes on a fresh checkout; the §15 block in the capture spec is generated.
- [x] The generator prints the Techcombank `statement_shapes` seed SQL (not yet seeded).
- [x] `npm test` runs the coverage test by discovery.

## Out of scope / Known gaps
- The digest (SC7). Rows for banks never seen (SC5).

## Assumptions
- Seeds stay hand-numbered migrations the user applies (SC6).
