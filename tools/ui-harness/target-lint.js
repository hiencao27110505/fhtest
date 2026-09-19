#!/usr/bin/env node
/* Are the target pictures made of the real app?

   node tools/ui-harness/target-lint.js tools/ui-harness/manifests/<feature>-target.js

   A target mock is a contract the build copies, so an invented surface propagates into
   built code. Two mechanical checks over the manifest source, against the BUILT index.html:

   1. Every shot opens a real surface: it calls one of the app's own opener globals
      (openX / goX / segTo / …Sheet / …Modal). A shot with no precedent declares
      `newSurface: true` and is listed rather than failed, so the reviewer sees it.
   2. Every class the mock writes already exists in the stylesheet. Anything else is novel
      vocabulary: name it in DESIGN.md in the same change, or drop it.

   Exit 1 on findings, so it can gate. */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..', '..');

const mf = process.argv[2];
if (!mf) { console.error('usage: node tools/ui-harness/target-lint.js <manifest.js>'); process.exit(2); }

const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const globals = new Set();
for (const m of html.matchAll(/function\s+([A-Za-z_$][\w$]*)\s*\(/g)) globals.add(m[1]);
for (const m of html.matchAll(/window\.([A-Za-z_$][\w$]*)\s*=/g)) globals.add(m[1]);
const openers = [...globals].filter((n) => /^(open[A-Z]|go$|segTo$|.*Sheet$|.*Modal$)/.test(n));
const openerSet = new Set(openers);

// every style block, plus every class the shell's own markup already uses
const classes = new Set();
for (const blk of html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g))
  for (const m of blk[1].matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)) classes.add(m[1]);
for (const m of html.matchAll(/class="([^"]+)"/g))
  m[1].split(/\s+/).forEach((c) => { if (c) classes.add(c); });

const manifest = require(path.resolve(mf));
let findings = 0, declared = 0;
console.log('target lint: ' + path.relative(ROOT, path.resolve(mf)) + '  (' + openers.length + ' openers, ' + classes.size + ' classes known)\n');

for (const s of manifest.shots) {
  const src = String(s.setup || '');
  const called = [...src.matchAll(/\b([A-Za-z_$][\w$]*)\s*\(/g)].map((m) => m[1]);
  const opened = [...new Set(called.filter((n) => openerSet.has(n)))];
  const used = [...new Set([...src.matchAll(/class="([^"]+)"/g)].flatMap((m) => m[1].split(/\s+/)).filter(Boolean))];
  const novel = used.filter((c) => !classes.has(c));
  const problems = [];
  if (!opened.length && !s.newSurface) problems.push('opens no real surface, and does not declare newSurface');
  if (novel.length) problems.push('novel classes: ' + novel.join(', '));
  if (problems.length) { findings++; console.log('  ✗ ' + s.name + ' — ' + problems.join(' · ')); }
  else if (!opened.length) { declared++; console.log('  ⚑ ' + s.name + ' — declares a new surface (no precedent); classes all exist'); }
  else console.log('  ✓ ' + s.name + ' — opens ' + opened.join(', '));
}
console.log('\n' + manifest.shots.length + ' shots · ' + findings + ' findings · ' + declared + ' declared new surfaces');
process.exit(findings ? 1 : 0);
