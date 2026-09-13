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

/* ── Contrast contract ──────────────────────────────────────────────────────────
   The second half of the rule: a value swap behind a token name must not break legibility.
   Each pair below is (foreground token, background token, minimum WCAG ratio) and is asserted
   against the resolved values in 10-tokens.css (var() chains followed, default theme). 4.5 =
   AA body text, 3 = large text / UI. Add a pair when you add a token that carries text. */
const CONTRAST = [
  ['--ink', '--white', 4.5], ['--ink-2', '--white', 4.5], ['--muted', '--white', 4.5], ['--muted-soft', '--white', 4.5],
  ['--ink', '--canvas', 4.5], ['--muted', '--canvas', 4.5], ['--muted', '--surface', 4.5],
  ['--brand-ink', '--white', 4.5], ['--brand-ink', '--brand-tint', 4.5], ['--good', '--good-tint', 4.5],
  ['--danger', '--white', 4.5], ['--danger', '--danger-tint', 4.5], ['--amber', '--white', 4.5], ['--amber', '--amber-tint', 4.5],
  ['--white', '--brand', 3], ['--white', '--danger', 4.5], ['--white', '--danger-base', 3], ['--white', '--amber-base', 3],
  ['--guide-ok-mut', '--guide-ok-bg', 4.5], ['--guide-warn-mut', '--guide-warn-bg', 4.5], ['--guide-hot-mut', '--guide-hot-bg', 4.5], ['--guide-over-mut', '--guide-over-bg', 4.5],
  ['--guide-ok', '--guide-ok-bg', 3], ['--guide-warn', '--guide-warn-bg', 3], ['--guide-hot', '--guide-hot-bg', 3], ['--guide-over', '--guide-over-bg', 3],
  ['--id-none-text', '--id-none-tint', 4.5], ['--white', '--id-none', 3],
].concat([1, 2, 3, 4, 5, 6].flatMap((n) => [['--id-' + n + '-text', '--id-' + n + '-tint', 4.5], ['--white', '--id-' + n, 3]]));

function tokenMap() {
  const css = fs.readFileSync(path.join(ROOT, 'src/css/10-tokens.css'), 'utf8');
  const root = css.slice(0, css.indexOf('.phone.t-sage{'));   // default theme only (the :root block ends where the theme classes start)
  const map = {};
  for (const m of root.matchAll(/(--[a-zA-Z0-9-]+)\s*:\s*([^;]+);/g)) map[m[1]] = m[2].trim();
  return map;
}
function resolve(map, name, depth) {
  const v = map[name]; if (v == null || depth > 12) return null;
  const m = /^var\((--[a-zA-Z0-9-]+)\)$/.exec(v);
  return m ? resolve(map, m[1], (depth || 0) + 1) : v;
}
function toRgb(v) {
  let m = /^#([0-9a-f]{6})$/i.exec(v); if (m) return [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16) / 255);
  m = /^#([0-9a-f]{3})$/i.exec(v); if (m) return m[1].split('').map((c) => parseInt(c + c, 16) / 255);
  m = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+))?\s*\)$/.exec(v);
  if (m && (m[4] == null || +m[4] >= 1)) return [m[1], m[2], m[3]].map((c) => +c / 255);
  return null;                                                // gradients / alpha: not checkable here
}
function lum([r, g, b]) { const f = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)); return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); }
function contrast(a, b) { const la = lum(a), lb = lum(b); return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05); }

function checkContrast() {
  const map = tokenMap(), bad = [];
  for (const [fg, bg, min] of CONTRAST) {
    const f = resolve(map, fg), g = resolve(map, bg);
    if (f == null || g == null) { bad.push(fg + ' on ' + bg + ': token missing'); continue; }
    const fr = toRgb(f), gr = toRgb(g);
    if (!fr || !gr) { bad.push(fg + ' on ' + bg + ': not a plain colour (' + f + ' / ' + g + ')'); continue; }
    const c = contrast(fr, gr);
    if (c < min) bad.push(fg + ' (' + f + ') on ' + bg + ' (' + g + '): ' + c.toFixed(2) + ':1, needs ' + min + ':1');
  }
  return bad;
}

function main() {
  const now = scan();
  if (process.argv.includes('--update')) {
    fs.writeFileSync(BASELINE, JSON.stringify(now, null, 2) + '\n');
    console.log('color-baseline.json updated (' + Object.keys(now).length + ' files with raw colour)');
    return 0;
  }
  const cbad = checkContrast();
  if (cbad.length) {
    console.error('\ncolor-lint: contrast contract broken in src/css/10-tokens.css\n  ' + cbad.join('\n  ')
      + '\n\nFix the token value (or its band in tools/palette-gen.js); never lower the ratio.\n');
    return 1;
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
