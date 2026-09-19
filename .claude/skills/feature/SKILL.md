---
name: feature
description: Build a FamilyHub (Earthy) feature end to end, working backwards from the outcome — define the end state and the user journey with feasibility checked alongside, render a target storyboard the user shows real users and approves, build to that target, verify built against target, review a built-beside-target storyboard, ship to a preview branch, then measure against thresholds set before the build. Use when the user says "/feature <name>", "build feature X", "làm tính năng X", or hands over a feature idea and wants it delivered without a long back-and-forth. Runs the pipeline in docs/WORKFLOW.md.
---

# /feature — work backwards, then build

Two decision touches: approve the target after real users have seen it, and review what was built beside that target. Then one on-device pass from the preview branch and "push main". Everything else is yours. Read `docs/WORKFLOW.md` once per session; it is the contract.

The order exists because work drifts forward from the mechanism when nothing forces the outcome first. Define the end, walk the journey back from it with feasibility checked in the same pass, picture it, build to it, compare against it, measure it.

Never do, at any stage: `git push origin main` (only on the user's literal word); any `supabase` CLI / SQL / MCP call; write or edit `supabase/migrations/*`; hand-edit `index.html`; `npm run split`; remove a worktree with uncommitted work; publish an Artifact or anything public (this user's outputs stay local: chat, files, screenshots shown inline).

## Stage 0 — Locate (every invocation, before anything else)

`/feature` can be typed at any point, in any session. Never assume you are at the start.

1. Run `node tools/feature-state.js` (no argument) to list every feature in flight with its stage. If the user gave a name, run `node tools/feature-state.js <name>`; if they gave none and exactly one feature is in flight, take that one; if several, ask which (one question, counts toward the five).
2. The script's `STAGE` and `next` line decide where you resume; its numbers match the stages below. 0 → Stage 1. 1 → finish the brief, then Stage 2. 2 → the target storyboard is out: ask whether real users have seen it and for approval (do not redraw it). 2.5 → Stage 3. 3 → continue in the worktree it names. 4 → reviewers and fix loop. 5 → the built storyboard is out: ask for batched feedback. 6 → wait for "push main". 7 → merged: remind the user when the brief's measurement window closes.
3. If the script prints a status mismatch, the files win; fix the brief's `Status:` line to match and say so.
4. Say in one line where you are resuming from and why, then continue.

**Status line.** Every brief carries `Status: <value>` on its own line under the title, one of `brief-draft`, `target-drawn`, `brief-approved`, `building`, `verified`, `storyboard-sent`, `shipped-preview`, `merged`. Update it at every stage boundary, in the same edit as the work that moved it.

## Stage 1 — End state and journey

1. **Ground.** Read `CLAUDE.md`, `DESIGN.md`, the matching `docs/features/*.md`, any research the feature rests on, and grep `src/` for every surface the journey passes through, including where people first hear of a feature (release notes, add sheet, empty states) and where the outcome shows (ledger rows, toasts, what other members see). Check `AGENT_SYNC.md` "MUST READ" + top Open items for collisions.
2. **Ask once.** State what you self-answered from the repo, then ask at most 5 questions in ONE round (`AskUserQuestion` takes 4 per call; record a fifth as an assumption rather than opening a second round), marking blockers. Separately, list the real-world inputs feasibility checks need (sample data, accounts, access); those are requests, not questions.
3. **Write `docs/briefs/<feature>.md`, end first:**
   ```
   # <Feature>  (brief, <date>)
   Status: brief-draft
   ## End state
   ### Announcement          (the release note as users will read it, vi + en; if it will not fit two plain sentences, the feature is not clear yet)
   ### Outcome               (what is true for the person when it worked, and the screen where they see it)
   ### Thresholds            (success and kill, as rates, with window, data source and who pulls the numbers)
   ## Journey                (first awareness → outcome, derived backwards from the outcome)
   ### N. <stage>            target · delivers to the next stage · today (cite file:line) · gap · plan · feasibility (the check, and its result or what it waits on)
   ## Feasibility inputs needed
   ## Screens               (each screen/state added or changed, with the global that opens it)
   ## States                (empty · loading · error · locked · offline, only the ones that apply)
   ## Acceptance criteria
   - [ ] …                  (verifiable lines, one or more per journey stage, including the outcome line)
   ## Out of scope / Known gaps
   ## Assumptions
   ## Target manifest       (one shot per journey stage + timed frames; the built manifest reuses these names)
   ```
   Run every feasibility check you can in this same pass and write the result into the stage. A failed check reshapes the target in the brief (say what changed); if nothing buildable remains, stop and say why. If the feature needs a schema change, stop: migrations are outside this workflow.
4. Continue straight to Stage 2.

## Stage 2 — Target  (touch 1)

1. Write `tools/ui-harness/manifests/<feature>-target.js` with `feature: '<feature>-target'`. **A target mock is a contract the build copies, so it must be made of the real app, never of remembered markup.** Each shot *calls the real global that renders the surface* (`openExpense()`, `openSheet('sheet-add')`, `openWhatsNew()`, `fhPrivacySheet()`, …) and then mutates that DOM — clone a real row and relabel it rather than writing one. Where the surface genuinely does not exist yet, set `newSurface: true` on the shot and build it only from classes the app already has. Name shots `NN-<stage>` in journey order and timed frames `NN-<stage>-tK`. Images are drawn on a canvas, never fetched.
2. Lint the mocks: `node tools/ui-harness/target-lint.js tools/ui-harness/manifests/<feature>-target.js`. It fails a shot that opens no real surface without declaring one, and any class the mock invents. Fix findings before shooting.
3. Shoot `node tools/ui-harness/shots.js tools/ui-harness/manifests/<feature>-target.js` and look at every PNG yourself. A mock that shows something the plan cannot deliver misleads the user; fix it or mark the stage's feasibility as open.
4. **Review the target before sending it.** Launch `design-audit` with the brief and `shots/<feature>-target`, saying it is a target review: no diff exists, so it judges the pictures by precedent diff, novel vocabulary and rhythm. Fix what it finds, or record the difference in the brief as deliberate.
5. `node tools/ui-harness/storyboard.js shots/<feature>-target --brief docs/briefs/<feature>.md --title "<Feature> target"`, then `open` it locally, paste the path, and show 2–3 key frames inline. Never publish it.
6. Set `Status: target-drawn`. Stop. **The user shows the target to real users, then approves or edits.** Edits go back to Stage 1 or 2. On approval set `Status: brief-approved`.

## Stage 3 — Build

1. Worktree: `git worktree add ../fh-<feature> -b feat/<feature> main && ln -s "$(pwd)/node_modules" ../fh-<feature>/node_modules`. Work there. (Hooks run per cwd: the symlink makes `parse-check` work.)
2. Claim territory: add a line at the top of `AGENT_SYNC.md` Open with the paths you will touch, signed "<user's name> — <feature>".
3. Set `Status: building`. Implement in `src/` only (see `CLAUDE.md` §2–§3 for file placement and scope), to the approved target. The PostToolUse hook rebuilds + parse-checks after every edit; a blocking hook message means fix it now.
4. Write `tools/ui-harness/manifests/<feature>.js` for the built states, reusing the target manifest's shot names for every stage the build renders.

## Stage 4 — Verify loop  (max 3 loops)

1. Shoot: `node tools/ui-harness/shots.js tools/ui-harness/manifests/<feature>.js` and `… manifests/baseline.js` (regressions), then `node tools/ui-harness/flows.js tools/ui-harness/flows/baseline.flow.js` (plus `flows/<feature>.flow.js` if the brief defines journeys). Read the lint block of every shot in `report.json`, and compare every built PNG with its target PNG yourself before handing them to reviewers.
2. Review: launch the five agents **in one message, in parallel** — `design-audit`, `i18n-audit`, `fh-code-review`, `boot-regression`, `qc-verify` — giving each the diff range (`main...HEAD`), the brief path, the shots dir and the target dir `shots/<feature>-target`. A built-vs-target difference is a finding unless the brief records it as an accepted change.
3. Fix every high/medium finding (nits when cheap), re-shoot, re-run only the reviewers whose area changed. After 3 loops, remaining items go into the brief's Known gaps. Then set `Status: verified`.

## Stage 5 — Storyboard  (touch 2)

1. `node tools/ui-harness/storyboard.js shots/<feature> --brief docs/briefs/<feature>.md --target shots/<feature>-target` → `shots/<feature>/storyboard.html`, built beside target per stage. Open it locally for the user and paste the path in chat; show the 2–3 key comparisons inline. Never publish it.
2. Set `Status: storyboard-sent`. Stop. **The user approves or batches feedback.** Feedback → back to Stage 4. Every UX correction the user gives is also written down as a rule in the same commit: the relevant `DESIGN.md` section for a taste/pattern rule, or the matching reviewer agent in `~/.claude/agents/*.md` when it is mechanically checkable. This is a required step, not a suggestion.

## Stage 6 — Ship

1. Docs: `docs/features/<x>.md` `## Current State`, a dated `CHANGELOG.md` entry, the `AGENT_SYNC.md` entry (what landed, signed), and the `release-notes` skill using the Announcement written in Stage 1 (adjust only what the build changed, and say what). Bump `sw.js CACHE_NAME` only if a precached asset changed.
2. Gates: `npm run check && npm test`, plus `node tools/boot-harness/harness.js timing`.
3. One commit with explicit paths (`git add src/… index.html docs/… tools/ui-harness/manifests/<feature>*.js`; never `-A`), message in the repo's voice, ending with the attribution line from the session.
4. `git push origin HEAD:preview/<feature>` and tell the user the branch name; Vercel builds a preview for it. Set `Status: shipped-preview` (commit that too). Stop. Push `main` only when the user says so (run `/qc` first if they have not); then set `Status: merged` and remove the worktree.

## Stage 7 — Measure

When the brief's measurement window closes, remind the user and give them the exact definitions and the query or dashboard view from the Thresholds section. They pull the numbers; never query the live database yourself. Compare each rate with its success and kill threshold, write the verdict under `## End state` as **keep**, **fix** (with the stage that fails) or **pull**, and say it in chat.
