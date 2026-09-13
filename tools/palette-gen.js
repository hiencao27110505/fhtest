#!/usr/bin/env node
/* Palette generator — the single place FamilyHub colours are COMPUTED (DESIGN.md §2.1).

   Every non-illustration colour in src/css/10-tokens.css is a point in OKLCH (L lightness,
   C chroma, H hue) chosen by rule, not by eye. This script holds those rules and prints the
   token block; 10-tokens.css is pasted from its output. Change a band here, re-run, paste.

     node tools/palette-gen.js          → CSS block for 10-tokens.css
     node tools/palette-gen.js --json   → the same values as JSON (for scripts/tests)

   The scheme (see DESIGN.md §2.1 "The harmony scheme"):
     anchor      sage H175 (the daily-guide tile's hue)
     neutrals    H175 at C ≤ .015 — a monochromatic extension of the anchor ("stone")
     danger      red H25  — near-complement (exact complement is 355; 30° warm of it so red and
                 sage never vibrate side by side)
     warning     amber H70 — split-complementary partner of red around the complement
     guide tile  175 · 85 · 50 · 25 — evenly spaced from anchor to near-complement
     identity    six slots on the 215°→85° arc; 100°–210° is reserved for the anchor so no
                 category or member can be mistaken for "money-positive"
     foliage     illustration greens rotated to H158: analogous to the anchor, clearly art */
'use strict';

// ── OKLCH → sRGB hex ───────────────────────────────────────────────────────────
function unlin(c) { return c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055; }
function lin(c) { return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
function oklchToRgb(L, C, H) {
  const a = C * Math.cos(H * Math.PI / 180), b = C * Math.sin(H * Math.PI / 180);
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b, m_ = L - 0.1055613458 * a - 0.0638541728 * b, s_ = L - 0.0894841775 * a - 1.2914855480 * b;
  const l = l_ ** 3, m = m_ ** 3, s = s_ ** 3;
  return [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s].map(unlin);
}
function hex(L, C, H) {
  return '#' + oklchToRgb(L, C, H).map((c) => Math.round(Math.min(1, Math.max(0, c)) * 255).toString(16).padStart(2, '0')).join('');
}
function hexToOklch(h) {
  h = h.replace('#', ''); if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const [r, g, b] = [0, 2, 4].map((i) => lin(parseInt(h.slice(i, i + 2), 16) / 255));
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b), m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b), s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s, a = 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s, bb = 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s;
  return { L, C: Math.hypot(a, bb), H: ((Math.atan2(bb, a) * 180 / Math.PI) + 360) % 360 };
}
function rgbOf(h) { return [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)); }
function alpha(h, a) { return 'rgba(' + rgbOf(h).join(',') + ',' + a + ')'; }
/* Rotate an existing colour to a new hue, keeping its lightness and chroma (illustration foliage). */
function rotate(h, H) { const o = hexToOklch(h); return hex(o.L, o.C, H); }

// ── The rules ──────────────────────────────────────────────────────────────────
const ANCHOR = 175;
const SAGE = { 50: [.975, .018], 100: [.945, .034], 200: [.890, .064], 300: [.810, .095], 400: [.720, .110], 500: [.623, .114], 600: [.520, .105], 700: [.470, .090], 800: [.390, .070], 900: [.300, .050] };
const STONE = { 900: [.19, .012], 800: [.33, .014], 600: [.52, .012], 500: [.56, .010], 400: [.62, .012], 300: [.84, .012], 200: [.93, .008], 150: [.955, .006], 100: [.965, .006], 50: [.98, .003], 25: [.99, .002] };
const STATUS_SHAPE = { tint: [.96, .025], light: [.78, .11], base: [.62, .15], ink: [.50, .13] };
const STATUS_HUES = { red: 25, amber: 70 };
const GUIDE = { warn: 85, hot: 50, over: 25 };            // ok = the sage ramp itself
const GUIDE_SHAPE = { main: [.62, .15], mut: [.50, .09], bg: [.965, .025] };
/* Six identity slots. Hue-spaced across the non-anchor arc with lightness alternating between
   neighbours, found by maximising the minimum pairwise OKLab distance (ΔE 14.6 all-pairs, the
   most the reserved arc allows). Colour is never the sole carrier of identity: categories have
   an emoji, members have initials. */
const IDENTITY = [[248, .50, .13], [256, .66, .13], [308, .60, .18], [356, .68, .17], [14, .52, .17], [58, .61, .13]];
const ID_SHAPE = { soft: (L) => [Math.min(.80, L + .12), .12], tint: () => [.96, .025], text: () => [.48, .12] };
const FOLIAGE_H = 158;

// ── Build ──────────────────────────────────────────────────────────────────────
const out = { sage: {}, stone: {}, red: {}, amber: {}, guide: {}, id: [], scene: {} };
for (const k in SAGE) out.sage[k] = hex(SAGE[k][0], SAGE[k][1], ANCHOR);
out.sage.soft = hex(.605, .077, ANCHOR); out.sage.wash = alpha(out.sage[500], .18); out.sage.glow = alpha(out.sage[500], .32);
for (const k in STONE) out.stone[k] = hex(STONE[k][0], STONE[k][1], ANCHOR);
for (const name in STATUS_HUES) for (const step in STATUS_SHAPE) out[name][step] = hex(STATUS_SHAPE[step][0], STATUS_SHAPE[step][1], STATUS_HUES[name]);
for (const state in GUIDE) { out.guide[state] = {}; for (const step in GUIDE_SHAPE) out.guide[state][step] = hex(GUIDE_SHAPE[step][0], GUIDE_SHAPE[step][1], GUIDE[state]); }
out.guide.ok = { mut: hex(GUIDE_SHAPE.mut[0], GUIDE_SHAPE.mut[1], ANCHOR) };   // ok's main/bg/trk are the sage ramp; only its label tone is generated (sage-soft is fills-only)
IDENTITY.forEach(([H, L, C], i) => {
  const base = hex(L, C, H), soft = hex(...ID_SHAPE.soft(L), H), tint = hex(...ID_SHAPE.tint(), H), text = hex(...ID_SHAPE.text(), H);
  out.id.push({ n: i + 1, H, base, soft, tint, text });
});
/* Scene tokens: the four most-used foliage greens in the house/home scenes, rotated to the analogous hue. */
out.scene = { grass: rotate('#77aa67', FOLIAGE_H), 'grass-deep': rotate('#4d6a45', FOLIAGE_H), leaf: rotate('#57a86a', FOLIAGE_H), 'leaf-light': rotate('#9cc98b', FOLIAGE_H) };

// ── Emit (only when run directly; require() is silent) ────────────────────────
if (require.main === module) {
if (process.argv.includes('--json')) { process.stdout.write(JSON.stringify(out, null, 1) + '\n'); process.exit(0); }
const lines = [];
lines.push('  /* ── PRIMITIVES — generated by tools/palette-gen.js; do not hand-edit values, change the rule and re-run ── */');
lines.push('  ' + Object.keys(SAGE).map((k) => `--sage-${k}:${out.sage[k]};`).join(' '));
lines.push(`  --sage-soft:${out.sage.soft}; --sage-wash:${out.sage.wash};`);
lines.push('  ' + Object.keys(STONE).map((k) => `--stone-${k}:${out.stone[k]};`).join(' '));
for (const name of ['red', 'amber']) lines.push('  ' + Object.keys(STATUS_SHAPE).map((s) => `--${name}-${s}:${out[name][s]};`).join(' '));
for (const id of out.id) lines.push(`  --id-${id.n}:${id.base}; --id-${id.n}-soft:${id.soft}; --id-${id.n}-tint:${id.tint}; --id-${id.n}-text:${id.text};`);
lines.push('  ' + Object.keys(out.scene).map((k) => `--scene-${k}:${out.scene[k]};`).join(' '));
lines.push('  /* guide tile: ok label tone (main/bg/trk are the sage ramp), then warn/hot/over */');
lines.push(`  --guide-ok-mut:${out.guide.ok.mut};`);
for (const st of ['warn', 'hot', 'over']) lines.push(`  --guide-${st}:${out.guide[st].main}; --guide-${st}-mut:${out.guide[st].mut}; --guide-${st}-bg:${out.guide[st].bg}; --guide-${st}-trk:${alpha(out.guide[st].main, .18)};`);
process.stdout.write(lines.join('\n') + '\n');
}

module.exports = { hex, hexToOklch, rotate, alpha, out, ANCHOR, IDENTITY };
