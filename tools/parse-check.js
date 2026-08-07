#!/usr/bin/env node
/* Syntax gate for CI. `npm run build` concatenates the src/ regions into index.html but
   does NOT validate JS/CSS syntax — a broken file still yields a string. This parses each
   concatenated region (via esbuild, already a devDependency) so a syntax error is caught
   here instead of at runtime in the browser (or on Vercel). Does not emit anything. */
'use strict';
const fs = require('fs');
const path = require('path');
const esbuild = require('esbuild');

const ROOT = path.join(__dirname, '..');
function cat(rel) {
  const dir = path.join(ROOT, rel);
  return fs.readdirSync(dir).filter((f) => !f.startsWith('.')).sort()
    .map((f) => fs.readFileSync(path.join(dir, f), 'utf8')).join('\n');
}

let bad = 0;
for (const [name, dir, loader] of [['js-ui', 'src/js-ui', 'js'], ['js-data', 'src/js-data', 'js'], ['css', 'src/css', 'css']]) {
  try { esbuild.transformSync(cat(dir), { loader }); console.log('ok: ' + name + ' parses'); }
  catch (e) { console.error('FAIL ' + name + ': ' + e.message); bad++; }
}
// sw.js is a standalone file, not concatenated — parse it too.
try { esbuild.transformSync(fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8'), { loader: 'js' }); console.log('ok: sw.js parses'); }
catch (e) { console.error('FAIL sw.js: ' + e.message); bad++; }

process.exit(bad ? 1 : 0);
