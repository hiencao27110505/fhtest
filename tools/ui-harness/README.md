# UI harness — Claude sees the screen

Drives the **real built `index.html`** in headless Chrome at iPhone size against a
stubbed Supabase (`tools/boot-harness/stub-supabase.js`) fed with a fixture
family, and screenshots every screen in Vietnamese and English across themes.
No credentials, no network, never touches the live project.

```sh
npm i                                                   # puppeteer-core; uses the installed Google Chrome
node tools/ui-harness/shots.js tools/ui-harness/manifests/baseline.js      # → shots/baseline/*.png + report.json
node tools/ui-harness/storyboard.js shots/baseline --brief docs/briefs/x.md # → shots/baseline/storyboard.html
node tools/boot-harness/harness.js timing                                   # boot-timing regression (GREEN/RED)
node tools/fixture-family.test.js                                           # fixture ↔ hydrate contract (also in npm test)
```

| File | Role |
|---|---|
| `browser.js` | `launch()` via puppeteer-core + local Chrome (`PUPPETEER_EXECUTABLE_PATH` to override); `IPHONE` viewport |
| `serve.js` | zero-dep static server for the repo root on a free port |
| `fixture-family.js` | `makeFixture()` = a non-encrypted family in the exact `get_family_snapshot` shape; `makePersonal()` = a decrypted personal snapshot |
| `shots.js` | the runner: build → serve → boot with stub + fixture → run each manifest `setup` → PNG + JPEG + `report.json` |
| `storyboard.js` | one self-contained HTML (inline JPEG) for review: screens × langs, theme toggle, acceptance criteria, known gaps |
| `manifests/*.js` | `{ feature, langs, themes, shots:[{ name, setup, settleMs?, langs?, themes? }] }`; `setup` is JS run in the page |
| `session.js` | shared boot: isolated context, stub + fixture, sealed personal snapshot, first-run nudges pre-seeded, wait for hydrate |
| `lint.js` | DOM lint run after every shot (targets < 44×44, text overflow, sideways scroll, Vietnamese in English mode); `shots.js --strict` fails on hits |
| `flows.js`, `flows/*.flow.js` | scripted journeys with `t.click/type/eval/expect/shot/writes/toast`; the stub records every write in `window.__stubWrites` and applies inserts/deletes to the fixture so re-hydrates see them |
| `sweep.js`, `approved/*.json` | every manifest + flow vs the approved summary; `--approve` sets the new baseline (user's call) |

## How a run boots
`fh-resume=1`, `fh-onboarded=1`, `fh-lang`, `fh-theme`, `stub-family` (the fixture JSON) and
`stub-lang` are seeded into localStorage; a throwaway AES key plus an encrypted
personal snapshot go into the `fh-keys` IndexedDB (the boot harness's `warm`
recipe). Personal-table reads are **hung** on purpose so the painted snapshot
is never replaced by garbage ciphertext. The runner waits for
`DB._hydrated === true` and the splash to go, then evaluates each shot's `setup`
(`go('home')`, `openSheet('sheet-budget')`, `openExpense()`, …), calling
`closeModals(); closeSheet();` between shots. Each (lang, theme) pair gets its
own browser context so storage never leaks between runs.

## Writing a flow
```js
{ name: 'add-goal', lang: 'vi', run: async (t) => {
  t.step('open');  await t.eval(`go('events'); openSheet('sheet-savegoal')`);
  await t.type('#sg-name', 'Quỹ Tết');  await t.click('#sg-save');
  t.expect(/Đã lưu/.test(await t.toast()), 'toast confirms');
  t.expect((await t.writes()).some((w) => w.table === 'saving_goals' && w.op === 'insert'), 'insert sent');
  await t.shot('01-saved');
} }
```
Type into fields with `t.type` (it dispatches real input events); read state with `t.eval`; every `t.expect` is recorded per step in `flows.json` so `qc-verify` can cite it.

## Adding a feature's screens
Create `manifests/<feature>.js` with only that feature's states (empty, filled,
error, sheet open…). Permanent surfaces belong in `baseline.js`. Run both: the
baseline run is the regression check.

## Limits (read before trusting a green run)
- Headless Chrome is **not iOS Safari**: div-click, `100vh` + keyboard, standalone safe-area insets, `-webkit-` quirks only show on the phone. The on-device pass stays mandatory.
- Personal screens render from a seeded snapshot; key provisioning, lock/unlock and the boot watchdog are covered by `tools/boot-harness`, not here.
- Fixture dates float with the real clock, so month labels move; screenshots are for review, not pixel-diff regression.
- `shots/` is git-ignored. The storyboard inlines every image (~3 MB for 40 shots), so keep manifests per feature.
