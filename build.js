#!/usr/bin/env node
/* FamilyHub build — assembles the deployed single-file index.html from the modular
   source in src/. Phase-1 modularization: the runtime shape (one HTML file, two
   inline <script> blocks in global scope, one <style>) is unchanged, so there is
   NO deploy/SW change — this just reconstitutes the file the repo already serves.

   src/index.html is the shell + markup + head (incl. the pre-paint resume gate),
   with three markers that get replaced by the concatenated module sources, in
   filename order (numeric prefixes = concat order = cascade / execution order):

     /* @build:css@ * /   -> src/css/*.css      (main <style> body)
     // @build:js-ui@     -> src/js-ui/*.js     (classic <script>, global scope)
     // @build:js-data@   -> src/js-data/*.js   (<script type="module"> data layer)

   Correctness is verified by `npm run build && git diff --exit-code index.html`
   (or the diff against the pre-split snapshot): the rebuild must be byte-identical.
*/
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const MARKERS = [
  { token: '/*@build:css@*/', dir: 'src/css' },
  { token: '//@build:js-ui@', dir: 'src/js-ui' },
  { token: '//@build:js-data@', dir: 'src/js-data' },
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

function build() {
  let html = fs.readFileSync(path.join(ROOT, 'src/index.html'), 'utf8');
  for (const m of MARKERS) {
    if (html.indexOf(m.token) < 0) throw new Error('marker not found in src/index.html: ' + m.token);
    const body = concatDir(m.dir);
    html = html.replace(m.token, () => body); // function replacer: no $-pattern interpretation
  }
  fs.writeFileSync(path.join(ROOT, 'index.html'), html);
  process.stdout.write('built index.html (' + Buffer.byteLength(html, 'utf8') + ' bytes)\n');
}

build();
