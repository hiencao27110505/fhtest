#!/usr/bin/env node
/* The vendored pdf.js build (vendor/pdfjs/) is the same version as the
 * pdfjs-dist the tests run under Node, or the tests prove a reader the app
 * does not ship (pdf-statements-spec.md PS15). Both files must be present,
 * and the build must stay OUT of the service-worker precache (PS6).
 *
 *   node tools/vendor-pin.test.js
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
const t = (n, ok, d) => { console.log((ok ? '  PASS  ' : '  FAIL  ') + n + (!ok && d !== undefined ? '  -> ' + d : '')); ok ? pass++ : fail++; };

const want = require(path.join(ROOT, 'node_modules', 'pdfjs-dist', 'package.json')).version;
const lib = path.join(ROOT, 'vendor', 'pdfjs', 'pdf.min.mjs');
const worker = path.join(ROOT, 'vendor', 'pdfjs', 'pdf.worker.min.mjs');
t('vendor/pdfjs/pdf.min.mjs is present', fs.existsSync(lib));
t('vendor/pdfjs/pdf.worker.min.mjs is present', fs.existsSync(worker));
const libSrc = fs.existsSync(lib) ? fs.readFileSync(lib, 'utf8') : '';
const workerSrc = fs.existsSync(worker) ? fs.readFileSync(worker, 'utf8') : '';
t('the vendored library is pdfjs-dist ' + want, libSrc.includes('"' + want + '"'), 'version string not found in pdf.min.mjs');
t('the vendored worker is pdfjs-dist ' + want, workerSrc.includes('"' + want + '"'), 'version string not found in pdf.worker.min.mjs');
const sw = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
t('pdf.js is NOT in the service-worker precache (loaded on first PDF open)', !/vendor\/pdfjs/.test(sw));
const grid = fs.readFileSync(path.join(ROOT, 'src', 'js-data', '43-pdf-grid.js'), 'utf8');
t('the app loads exactly the vendored paths, as relative specifiers', /'\.\/vendor\/pdfjs\/pdf\.min\.mjs'/.test(grid) && /'\.\/vendor\/pdfjs\/pdf\.worker\.min\.mjs'/.test(grid));
t('pdfjs-dist is a devDependency (tests), not a dependency (the app vendors it)',
  !!(require(path.join(ROOT, 'package.json')).devDependencies || {})['pdfjs-dist'] && !((require(path.join(ROOT, 'package.json')).dependencies || {})['pdfjs-dist']));

console.log('\n' + (fail ? 'FAILED ' + fail + ' of ' + (pass + fail) : 'ALL ' + pass + ' PASSED'));
process.exit(fail ? 1 : 0);
