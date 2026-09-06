# Boot harness — the Cá nhân landing-tab feedback loop

The repro + regression loop for the 2026-09-06 "slow open / frozen on
'Đang chuẩn bị sổ cá nhân…'" fix (CHANGELOG 2026-09-06,
`docs/specs/personal-ledger-spec.md` §13/§17).

It serves the **real built `index.html`** locally, swaps `vendor/supabase.js`
for a stub with per-call latency and stall injection, seeds a personal DEK
(and, for `warm`, an encrypted snapshot) in the `fh-keys` IndexedDB, then
measures what the landing tab actually does. No credentials, no network,
deterministic.

```
node build.js                      # harness drives the BUILT app — rebuild first
node tools/boot-harness/harness.js <scenario>
```

| Scenario | Injects | GREEN means |
|---|---|---|
| `timing` | 300ms per call, healthy | ready ≤ 1500ms (boot not re-serialized) |
| `freeze` | `personal_transactions` never resolves | ready or error-with-retry ≤ 15s (watchdog + unlatch alive) |
| `freeze-early` | `my_families` never resolves | personal tab still reaches ready (boot stays independent) |
| `warm` | snapshot seeded, ALL personal reads hung | real UI painted ≤ 2s AND still intact after the 12s watchdog |

`DBG=1` prints the first 3s of state polls. Exit code 0 = GREEN.

Puppeteer is borrowed from the moneylover project's `node_modules` if not
installed here. The stub logs every supabase call with timestamps — the printed
waterfall is also the tool for spotting any future re-serialization of boot.
