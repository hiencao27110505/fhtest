#!/usr/bin/env node
/* Runs every test in the repo, by discovering them rather than by listing them.
 *
 * WHY THIS EXISTS: `npm test` used to be a single line of `node a.test.js && node
 * b.test.js && …`, and that line is a merge magnet. Two sessions edit it in the
 * same afternoon, git takes one side whole, and tests do not fail — they simply
 * stop being run, which is silent and looks exactly like success. It has already
 * happened twice: `tools/mailbox-gate.test.js` (the proof the beta gate is
 * fail-closed) went missing once, and four more went with it the second time,
 * including `pipeline/review-notify.test.js` — the guard for review
 * notifications, absent from precisely the feature it covers.
 *
 * Discovery removes the shared line entirely. A new test is a new FILE, and git
 * merges new files cleanly. There is nothing left to collide on and nothing to
 * remember to update.
 *
 * FAIL-CLOSED ON AN EMPTY RUN: if discovery finds nothing, this exits 1. A glob
 * that silently matches zero files and reports success would recreate the exact
 * bug it was written to kill — a green tick over an empty suite. Same reasoning
 * as 73-mailbox-gate.js: the failure people notice is better than the one they
 * do not.
 *
 * Output is quiet by default — one line per file — and dumps the full transcript
 * of anything that fails. `--verbose` prints everything.
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const DIRS = ['pipeline', 'tools'];
const VERBOSE = process.argv.includes('--verbose') || process.argv.includes('-v');

function discover() {
  const found = [];
  for (const d of DIRS) {
    const abs = path.join(ROOT, d);
    if (!fs.existsSync(abs)) continue;
    for (const f of fs.readdirSync(abs).sort()) {
      if (f.endsWith('.test.js')) found.push(path.join(d, f));
    }
  }
  return found;
}

const tests = discover();

if (!tests.length) {
  console.error('No *.test.js found in: ' + DIRS.join(', '));
  console.error('Refusing to report success over an empty suite.');
  process.exit(1);
}

console.log('Running ' + tests.length + ' test file(s)\n');

let passed = 0;
const failed = [];

for (const rel of tests) {
  // A separate process per file, deliberately: each test ends in process.exit(),
  // so requiring them into one process would end the run at the first file.
  const res = spawnSync(process.execPath, [path.join(ROOT, rel)], {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: VERBOSE ? 'inherit' : 'pipe',
  });

  const out = VERBOSE ? '' : ((res.stdout || '') + (res.stderr || ''));

  // A test killed by a signal reports status null, which is not 0 but also is not
  // a failed assertion — call it failed and show why, rather than reading a
  // crash as a pass.
  const ok = res.status === 0;
  if (ok) {
    passed++;
    if (!VERBOSE) {
      // Surface each file's own summary line so the count stays visible.
      const last = out.trim().split('\n').filter(Boolean).pop() || '';
      console.log('  PASS  ' + rel + (last.startsWith('ALL ') ? '  (' + last.toLowerCase() + ')' : ''));
    }
  } else {
    failed.push(rel);
    console.log('  FAIL  ' + rel + (res.status === null ? '  (killed: ' + res.signal + ')' : ''));
    if (!VERBOSE && out.trim()) {
      console.log(out.trim().split('\n').map((l) => '        ' + l).join('\n'));
    }
  }
}

console.log('\n' + (failed.length
  ? failed.length + ' FAILED, ' + passed + ' passed\n  ' + failed.join('\n  ')
  : 'ALL ' + passed + ' TEST FILES PASSED'));

process.exit(failed.length ? 1 : 0);
