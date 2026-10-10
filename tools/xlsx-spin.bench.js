#!/usr/bin/env node
/* How long the .xlsx key-derivation spin takes, old way vs new, at the real
 * spinCount (100,000).  `node tools/xlsx-spin.bench.js`
 *
 *   old: 100,000 awaited crypto.subtle.digest round trips (what shipped first)
 *   new: the synchronous hashes in src/js-data/41-xlsx-decrypt.js (_xdMath)
 *
 * Prints both for SHA-1 (what real bank files use, spec section 15) and SHA-512
 * (the agile default, what msoffcrypto and current Excel write). Node's WebCrypto
 * is faster per call than a phone browser's, so the old numbers here flatter it;
 * the sync numbers are close to what a phone does, since it is the same JS.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto').webcrypto;

const SRC = fs.readFileSync(path.join(__dirname, '..', 'src', 'js-data', '41-xlsx-decrypt.js'), 'utf8');
const w = {};
new Function('window', 'DOMParser', 'Worker', 'Blob', 'URL', SRC)(w, undefined, undefined, undefined, undefined);
const M = w.fhXlsxMath;

const cat = (...parts) => { const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let at = 0; parts.forEach((p) => { out.set(p, at); at += p.length; }); return out; };
const le32 = (n) => new Uint8Array([n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >>> 24) & 255]);
const utf16 = (s) => { const u = new Uint8Array(s.length * 2); for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); u[i * 2] = c & 255; u[i * 2 + 1] = c >> 8; } return u; };
async function oldSpin(hash, salt, password, spin) {
  let h = new Uint8Array(await crypto.subtle.digest(hash, cat(salt, utf16(password))));
  for (let i = 0; i < spin; i++) h = new Uint8Array(await crypto.subtle.digest(hash, cat(le32(i), h)));
  return h;
}

(async () => {
  const SPIN = +process.argv[2] || 100000;
  const salt = new Uint8Array(16).map((_, i) => i * 7 + 1), pw = '01011990';
  console.log('spinCount = ' + SPIN + '\n');
  console.log('hash      old awaited loop   new sync loop   speedup');
  for (const hash of ['SHA-1', 'SHA-512']) {
    M.spin(hash, salt, utf16(pw), 2000);                        // warm the JIT
    let t0 = process.hrtime.bigint();
    const a = await oldSpin(hash, salt, pw, SPIN);
    const oldMs = Number(process.hrtime.bigint() - t0) / 1e6;
    t0 = process.hrtime.bigint();
    const b = M.spin(hash, salt, utf16(pw), SPIN);
    const newMs = Number(process.hrtime.bigint() - t0) / 1e6;
    const same = Buffer.from(a).toString('hex') === Buffer.from(b).toString('hex');
    console.log(hash.padEnd(10) + (oldMs.toFixed(0) + ' ms').padStart(13) + (newMs.toFixed(0) + ' ms').padStart(16) + ('x' + (oldMs / newMs).toFixed(1)).padStart(10) + (same ? '' : '   MISMATCH'));
  }
})();
