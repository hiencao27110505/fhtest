#!/usr/bin/env node
/* FamilyHub build — assembles the deployed single-file index.html from the modular
   source in src/. Two modes:

     node build.js            → dev/committed build. UNMINIFIED. This is what
                                `npm run check` asserts is byte-identical to the
                                committed index.html, so the committed artifact and
                                the repo diffs stay human-readable.

     node build.js --deploy   → deploy build (Vercel's buildCommand). Same assembly,
                                then each region is minified in place. Kept OUT of the
                                committed file so `check` still works.

   src/index.html is the shell + markup + head (incl. the pre-paint resume gate),
   with three markers replaced by the concatenated module sources, in filename order
   (numeric prefixes = concat order = cascade / execution order):

     /* @build:css@ * /   -> src/css/*.css      (main <style> body)
     // @build:js-ui@     -> src/js-ui/*.js     (classic <script>, global scope)
     // @build:js-data@   -> src/js-data/*.js   (<script type="module"> data layer)

   MINIFICATION IS DELIBERATELY CONSERVATIVE (deploy mode):
     - CSS: full minify (no identifier concerns).
     - JS: minifyWhitespace ONLY — strips this codebase's heavy comments + whitespace.
       We do NOT minify identifiers (≈90 inline on*="fn(...)" handlers call js-ui
       globals BY NAME — renaming would break every button) and we do NOT enable
       minifySyntax (its dead-code elimination could drop a top-level function that is
       only reached from an inline handler, or a window.* export it deems unused).
       Comment/whitespace stripping is the dominant win here and carries no such risk.
*/
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const DEPLOY = process.argv.includes('--deploy');
const esbuild = DEPLOY ? require('esbuild') : null;   // only a deploy dependency; `build`/`check` never need it

const MARKERS = [
  { token: '/*@build:css@*/', dir: 'src/css', loader: 'css' },
  { token: '//@build:js-ui@', dir: 'src/js-ui', loader: 'js' },
  { token: '//@build:js-data@', dir: 'src/js-data', loader: 'js' },
];

// Concatenate a directory's files in lexical (= numeric-prefixed) order, joined by
// a single newline. Each source file holds an exact contiguous slice of the original
// region with no trailing newline, so joining slices with '\n' reproduces the region.
function concatDir(rel) {
  const dir = path.join(ROOT, rel);
  const files = fs.readdirSync(dir).filter((f) => !f.startsWith('.')).sort();
  if (!files.length) throw new Error('no source files in ' + rel);
  return files.map((f) => fs.readFileSync(path.join(dir, f), 'utf8')).join('\n');
}

function minifyRegion(body, loader) {
  if (!DEPLOY) return body;
  if (loader === 'css') return esbuild.transformSync(body, { loader: 'css', minify: true }).code;
  // JS: whitespace + comments only — NOT identifiers, NOT syntax/DCE (see header note).
  return esbuild.transformSync(body, { loader: 'js', minifyWhitespace: true, minifyIdentifiers: false, minifySyntax: false }).code;
}

function build() {
  let html = fs.readFileSync(path.join(ROOT, 'src/index.html'), 'utf8');
  for (const m of MARKERS) {
    if (html.indexOf(m.token) < 0) throw new Error('marker not found in src/index.html: ' + m.token);
    const body = minifyRegion(concatDir(m.dir), m.loader);
    html = html.replace(m.token, () => body); // function replacer: no $-pattern interpretation
  }
  // Stamp the current build version (single source of truth = sw.js CACHE_NAME) into the
  // app so "What's new" can show the version the user is running. The token lives inside a
  // string literal, so it survives whitespace minification intact.
  const sw = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
  const vm = sw.match(/familyhub-v(\d+)/);
  const version = vm ? ('v' + vm[1]) : 'v0';
  html = html.split('__FH_VERSION__').join(version);
  fs.writeFileSync(path.join(ROOT, 'index.html'), html);
  process.stdout.write('built index.html (' + Buffer.byteLength(html, 'utf8') + ' bytes' + (DEPLOY ? ', minified' : '') + ')\n');
}

build();
