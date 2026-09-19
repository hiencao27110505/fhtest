#!/usr/bin/env node
/* Where is a feature in the /feature workflow? Reads the file system and git,
   never the chat, so a new session can resume at the right stage.

   node tools/feature-state.js            → every feature with a brief, worktree or branch
   node tools/feature-state.js <name>     → that feature, with the next action

   Stages (in order, numbered as in the skill): 0 none · 1 brief-draft (end state + backwards journey) ·
   2 target-drawn (shots/<name>-target/storyboard.html exists, awaiting real users + approval) ·
   2.5 brief-approved · 3 building · 4 verified (shots + report exist) ·
   5 storyboard (storyboard.html exists, built beside target, awaiting feedback) ·
   6 shipped-preview (preview/<name> on origin) · 7 merged (branch is in main; measure against the brief's thresholds).
   A brief carries an explicit `Status:` line the skill updates at each touch point; when the
   line and the file system disagree, the file system wins and the mismatch is printed. */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const sh = (cmd, cwd) => { try { return execSync(cmd, { cwd: cwd || ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch (e) { return ''; } };
const exists = (p) => { try { fs.statSync(p); return true; } catch (e) { return false; } };

function names() {
  const set = new Set();
  const briefs = path.join(ROOT, 'docs', 'briefs');
  if (exists(briefs)) fs.readdirSync(briefs).filter((f) => f.endsWith('.md') && f !== 'README.md').forEach((f) => set.add(f.replace(/\.md$/, '')));
  sh('git branch --list "feat/*" --format=%(refname:short)').split('\n').filter(Boolean).forEach((b) => set.add(b.replace(/^feat\//, '')));
  sh('git branch -r --list "origin/preview/*" --format=%(refname:short)').split('\n').filter(Boolean).forEach((b) => set.add(b.replace(/^origin\/preview\//, '')));
  return [...set].sort();
}

function state(name) {
  const s = { name, brief: null, status: null, branch: null, worktree: null, commits: 0, dirty: null, shots: false, flows: false, storyboard: false, preview: false, merged: false, stage: 0, next: '' };
  const brief = path.join(ROOT, 'docs', 'briefs', name + '.md');
  if (exists(brief)) {
    s.brief = path.relative(ROOT, brief);
    const m = fs.readFileSync(brief, 'utf8').match(/^Status:\s*(.+)$/m);
    s.status = m ? m[1].trim() : null;
  }
  const branch = 'feat/' + name;
  if (sh(`git rev-parse --verify -q ${branch}`)) {
    s.branch = branch;
    s.commits = Number(sh(`git rev-list --count main..${branch}`) || 0);
    s.merged = !!sh(`git branch --merged main --list ${branch}`) && s.commits === 0;
  }
  const wt = sh('git worktree list --porcelain').split('\n\n').map((b) => b.split('\n')).find((b) => b.some((l) => l === 'branch refs/heads/' + branch));
  if (wt) {
    s.worktree = wt[0].replace(/^worktree /, '');
    s.dirty = sh('git status --porcelain', s.worktree).split('\n').filter(Boolean).length;
  }
  const shotsDir = path.join(s.worktree || ROOT, 'shots', name);
  s.shots = exists(path.join(shotsDir, 'report.json'));
  s.flows = exists(path.join(shotsDir, 'flows.json'));
  s.storyboard = exists(path.join(shotsDir, 'storyboard.html'));
  s.target = exists(path.join(ROOT, 'shots', name + '-target', 'storyboard.html'));
  s.preview = !!sh(`git rev-parse --verify -q origin/preview/${name}`);
  // A branch with nothing on it yet is NOT merged: an in-flight worktree whose work is
  // still uncommitted reads as "0 commits ahead of main" and used to route to stage 7.
  if (s.merged && s.worktree && (s.dirty || s.commits === 0)) s.merged = false;
  if (s.merged) { s.stage = 7; s.next = 'merged: remove the worktree if it is still there; when the brief\'s measurement window closes, compare the rates with its thresholds (stage 7)'; }
  else if (s.preview) { s.stage = 6; s.next = 'user taps through the preview on the phone, then says "push main"'; }
  else if (s.storyboard) { s.stage = 5; s.next = 'user reviews shots/' + name + '/storyboard.html (built beside target); on feedback go back to stage 4, on approval ship (stage 6)'; }
  else if (s.shots) { s.stage = 4; s.next = 'run the reviewers against the target (or finish the fix loop), then build the storyboard (stage 5)'; }
  else if (s.branch || s.worktree) { s.stage = 3; s.next = (s.worktree ? 'continue building in ' + s.worktree : 'branch exists but no worktree: git worktree add ../fh-' + name + ' ' + branch) + '; then shoot (stage 4)'; }
  else if (s.brief && /approved/i.test(s.status || '')) { s.stage = 2.5; s.next = 'target approved: create the worktree and build to the target (stage 3)'; }
  else if (s.target) { s.stage = 2; s.next = 'target storyboard is out (shots/' + name + '-target/storyboard.html): ask whether real users have seen it, then for approval (touch 1)'; }
  else if (s.brief) { s.stage = 1; s.next = 'brief in progress: finish the end state and the backwards journey with feasibility, then render the target (stage 2)'; }
  else { s.stage = 0; s.next = 'no brief: ground in the repo and write docs/briefs/' + name + '.md (stage 1)'; }
  // status line vs. reality
  const want = { 0: null, 1: 'brief-draft', 2: 'target-drawn', 2.5: 'brief-approved', 3: 'building', 4: 'verified', 5: 'storyboard-sent', 6: 'shipped-preview', 7: 'merged' }[s.stage];
  s.statusMismatch = !!(s.status && want && s.status.toLowerCase() !== want) ? `brief says "${s.status}", files say "${want}"` : null;
  return s;
}

const arg = process.argv[2];
if (arg) {
  const s = state(arg);
  console.log(JSON.stringify(s, null, 2));
  console.log(`\nSTAGE ${s.stage} · ${s.next}${s.statusMismatch ? '\n⚠ ' + s.statusMismatch : ''}`);
} else {
  const all = names().map(state);
  if (!all.length) { console.log('no features in flight'); process.exit(0); }
  console.log('feature                 stage  brief  branch  worktree  shots  story  preview  next');
  for (const s of all) console.log(`${s.name.padEnd(23)} ${String(s.stage).padEnd(6)} ${(s.brief ? 'yes' : '-').padEnd(6)} ${(s.branch ? s.commits + 'c' : '-').padEnd(7)} ${(s.worktree ? (s.dirty ? 'dirty' : 'clean') : '-').padEnd(9)} ${(s.shots ? 'yes' : '-').padEnd(6)} ${(s.storyboard ? 'yes' : '-').padEnd(6)} ${(s.preview ? 'yes' : '-').padEnd(8)} ${s.next}`);
}
