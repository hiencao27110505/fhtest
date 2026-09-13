#!/usr/bin/env node
/* Colour-literal ratchet. Runs inside `node build.js` (so it also gates the Vercel deploy).

   The rule (DESIGN.md §2.1): components use SEMANTIC tokens (--brand, --good, --guide-ok …),
   never a raw colour. The only file allowed to define colour is src/css/10-tokens.css.

   The reality: ~180 raw hexes already live in JS (house scene, onboarding art, category and
   member palettes) and a few CSS files. Failing on all of them would block every build, so this
   is a RATCHET, not a ban: tools/color-baseline.json records how many colour literals each file
   had when the rule was introduced. The build fails when

     - a file has MORE literals than its baseline (someone added a raw colour), or
     - a file not in the baseline has any literal at all (a new file must be token-only).

   Going DOWN is always fine and is not recorded automatically — when you tokenize a file, run
   `node tools/color-lint.js --update` to tighten the baseline in the same commit, so the number
   can never creep back up. Never raise a baseline by hand to make a build pass; add a token.

   What counts as a literal: #rgb / #rrggbb / #rrggbbaa, rgb()/rgba(), hsl()/hsla(). Comments
   count too (keeps the scan dumb and deterministic; a hex in a comment is a hex in a comment). */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const BASELINE = path.join(__dirname, 'color-baseline.json');
const DIRS = ['src/css', 'src/js-ui', 'src/js-data'];
const EXEMPT = new Set(['src/css/10-tokens.css']);   // the one place colour is defined
const RE = /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b|\b(?:rgba?|hsla?)\(/g;

function scan() {
  const counts = {};
  for (const rel of DIRS) {
    const dir = path.join(ROOT, rel);
    for (const f of fs.readdirSync(dir).filter((x) => !x.startsWith('.')).sort()) {
      const key = rel + '/' + f;
      if (EXEMPT.has(key)) continue;
      const n = (fs.readFileSync(path.join(dir, f), 'utf8').match(RE) || []).length;
      if (n) counts[key] = n;
    }
  }
  return counts;
}

function main() {
  const now = scan();
  if (process.argv.includes('--update')) {
    fs.writeFileSync(BASELINE, JSON.stringify(now, null, 2) + '\n');
    console.log('color-baseline.json updated (' + Object.keys(now).length + ' files with raw colour)');
    return 0;
  }
  const base = fs.existsSync(BASELINE) ? JSON.parse(fs.readFileSync(BASELINE, 'utf8')) : {};
  const bad = [];
  for (const [file, n] of Object.entries(now)) {
    const b = base[file] || 0;
    if (n > b) bad.push(file + ': ' + n + ' colour literal(s), baseline ' + b);
  }
  if (bad.length) {
    console.error('\ncolor-lint: raw colour added outside src/css/10-tokens.css\n  ' + bad.join('\n  ')
      + '\n\nUse a semantic token (DESIGN.md §2.1). If the colour is genuinely new, add it to 10-tokens.css'
      + ' as a token and reference it. Illustration-only colour in an already-listed file is tolerated'
      + ' up to its baseline; the baseline is never raised by hand.\n');
    return 1;
  }
  return 0;
}

if (require.main === module) process.exit(main());
module.exports = { scan, main };
