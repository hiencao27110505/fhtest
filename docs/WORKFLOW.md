# Feature workflow — work backwards, then build

How a feature goes from an idea to a preview branch and on to a measured result. The orchestrator
is the `/feature` skill (`.claude/skills/feature/SKILL.md`); this page is the contract it follows
and the reasons behind it.

## Why

Features were slow for three reasons that had nothing to do with typing speed: requirements
were re-discussed per feature; Claude never saw the rendered result, so the user was the QA on
an iPhone and every UX defect cost a full round trip; and shipping chores (rebuild, docs,
changelog, sync log, release notes, SW bump) were manual and forgettable. CI ran only the
syntax gate.

A fourth reason surfaced once those were fixed (receipt scan, 2026-09). The flow started from a
text brief, and the first picture of the experience appeared only after the build. Work drifted
forward from the mechanism (a parser, a model call) and had to be pulled back to the user's
outcome by hand, several times. So the workflow now runs backwards: define the end, walk the
journey back from it with feasibility checked in the same pass, picture the target, let real users
see it, build to it, compare what was built against it, and measure the result against thresholds
set before anything was built.

## The seven stages

| Stage | The user | Claude (orchestrator) | Scripts | Reviewer agents |
|---|---|---|---|---|
| 1 End + journey | Answer ≤5 questions once; supply what feasibility checks need from the real world (sample data, access) | Ground in repo + docs. Write `docs/briefs/<x>.md`: the end state (release-note draft vi/en, the outcome screen, success and kill thresholds as rates with window and data source), then the journey from first awareness to outcome, derived backwards, each stage with target · today · gap · plan · feasibility, checks run in the same pass | | |
| 2 Target | **Touch 1:** show the target to real users, then approve or edit | One picture per journey stage in the real app's styles (mock states injected into the harness), timed frames for moments that live in motion, a target storyboard — reviewed before it is sent | `shots.js manifests/<x>-target.js`, `target-lint.js`, `storyboard.js shots/<x>-target` | `design-audit` on the target shots |
| 3 Build | | Worktree, claim paths in `AGENT_SYNC.md`, implement in `src/` to the target, built manifest reuses the target's shot names | Hook rebuilds + parse-checks every `src/` edit | |
| 4 Verify | | Compare built with target per stage, fix findings, re-shoot, max 3 loops | `shots.js`: every screen × vi/en × themes; `flows.js` | `design-audit`, `i18n-audit`, `fh-code-review`, `boot-regression`, `qc-verify` in parallel, each given the target dir |
| 5 Storyboard | **Touch 2:** open one local page, built beside target, approve or batch feedback | `storyboard.js --target shots/<x>-target`; each correction becomes a `DESIGN.md` or reviewer rule | | |
| 6 Ship | Phone pass on the preview URL, then say "push main" | Feature doc, changelog, sync log, the release note written in stage 1, SW bump if needed, gates, one commit, push `preview/<x>` | Vercel preview deploy | |
| 7 Measure | Pull the numbers when the window closes (Claude never queries the live DB) | Compare the rates with the stage 1 thresholds and say keep, fix or pull | | |

A difference between built and target is a finding, not a matter of taste; an intended change is
recorded in the brief first. Stage 1 scales with uncertainty: a new capability, or anything touching
money, privacy or what family members see of each other, gets the full backwards pass; a bug fix
or a copy change goes through `/verify` instead.

One orchestrator per feature, plus five short-lived reviewers launched together after each
screenshot run. Everything else is a script.

## The pieces

- **Hooks** (`.claude/settings.json`, committed): `PostToolUse` on `Edit|Write|MultiEdit` runs
  `tools/hooks/post-src-edit.js` (rebuild + parse gate for `src/**`, ~0.4s, exit 2 blocks with the
  error); `Stop` runs `tools/hooks/stop-fresh.js` (index.html must be a fresh build before the
  turn ends). The Stop hook is guarded by `stop_hook_active` and a 30s timeout, so it cannot loop.
  If it ever blocks on every turn, delete the `Stop` entry. Hooks run for every session in this
  checkout, including the other collaborator's.
- **UI harness** (`tools/ui-harness/`, README there): the real built app in headless Chrome at
  iPhone size, stubbed Supabase fed by `fixture-family.js`, screenshots per manifest, and a
  local `storyboard.html`. `tools/fixture-family.test.js` keeps the fixture on the hydrate contract.
- **Reviewer agents** (`~/.claude/agents/{design-audit,i18n-audit,fh-code-review,boot-regression}.md`,
  user level so they work across projects): read-only, fixed output contract
  (`severity · file:line · rule · fix` or `CLEAN`). They read the project's `CLAUDE.md`/`DESIGN.md`
  and apply the FamilyHub-specific checks only when they detect this repo. A new agent file is
  registered at session start; restart Claude Code after adding one.
- **Boot harness** (`tools/boot-harness/`): timing / freeze / warm regressions, now runnable here.
- **CI** (`.github/workflows/ci.yml`): parse, `npm run check`, `npm test`. The screenshot runner
  is local only (needs Chrome).

## QC: proving behaviour, not just looks

The feature flow proves a change looks right in static screens. QC proves the app still behaves
right before a release. Same harness, three more scripts and one more agent:

| Piece | What it proves | Command |
|---|---|---|
| DOM lint (`tools/ui-harness/lint.js`, inside every shot) | tappables under 44×44, text spilling its box, sideways page scroll, Vietnamese text in English mode | part of `shots.js`; `--strict` fails on hits |
| Flows (`tools/ui-harness/flows.js`, `flows/*.flow.js`) | scripted journeys through the real UI code with assertions on the screen and on the stub's write log (`window.__stubWrites`) | `node tools/ui-harness/flows.js tools/ui-harness/flows/baseline.flow.js` |
| Sweep (`tools/ui-harness/sweep.js`, `approved/*.json`) | every manifest + flow file against the approved summary: vanished shots, new errors, lint growth, flows that stopped passing | `node tools/ui-harness/sweep.js [--approve]` |
| `qc-verify` agent (`~/.claude/agents/qc-verify.md`) | each `- [ ]` acceptance criterion gets evidence (flow check, screenshot, test, code) and is ticked in the brief | launched by `/feature` stage 4, `/verify`, `/qc` |
| Device checklist (`docs/qc/device-checklist.md`, `tools/qc/device-checklist.js`) | the iPhone-only checks, filtered to the surfaces a range touched | `node tools/qc/device-checklist.js <range>` |
| Target lint (`tools/ui-harness/target-lint.js`) | a target mock is made of the real app: every shot opens a real surface (or declares `newSurface`), and every class it writes already exists | `node tools/ui-harness/target-lint.js tools/ui-harness/manifests/<x>-target.js` |

Entry points:
- **`/feature`** now opens with `node tools/feature-state.js` and resumes at the detected stage (brief-draft → target-drawn → brief-approved → building → verified → storyboard-sent → shipped-preview → merged). Every brief carries a `Status:` line; files win over the line when they disagree.
- **`/verify [branch|range] [fix]`** — stage 4 alone, for bug fixes and other people's branches. No brief, no worktree, no shipping.
- **`/qc [range]`** — the release gate before "push main": tests, boot harness, sweep, reviewers on the release range, acceptance verdicts per brief, the filtered device checklist, and a local `shots/qc/report.md` with READY / NOT READY.

Approving a new sweep baseline (`--approve`) is the user's call after seeing the storyboard, never the agent's.

## Never automated

`git push origin main` (the user's literal word only); any `supabase` CLI / SQL / MCP call;
writing `supabase/migrations/*` (a brief that needs schema stops at stage 1); hand-editing
`index.html`; `npm run split`; removing a worktree with uncommitted work; publishing anything
(no Artifacts; outputs stay in chat or local files).

## Limits, so a green run is not over-trusted

- Headless Chrome is not iOS Safari: div-click, `100vh` with the keyboard, standalone safe-area
  insets and `-webkit-` quirks only show on the phone. The on-device pass is mandatory.
- Personal-ledger screens render from a seeded snapshot (no server crypto). Key provisioning,
  lock/unlock and the boot watchdog are covered by the boot harness only.
- Fixture dates float with the real clock; screenshots are for review, not pixel-diff regression.
- The storyboard inlines its images (~3 MB for 40 shots). Keep manifests per feature.
- Reviewer agents check what `DESIGN.md` and `CLAUDE.md` state. Taste stays with the user, and
  each correction is written back as a rule so it is checked next time.
