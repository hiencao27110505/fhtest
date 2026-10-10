#!/usr/bin/env node
/* The synchronous hashes and the key-derivation spin behind the .xlsx unlock
 * (src/js-data/41-xlsx-decrypt.js), checked against WebCrypto, and the unlock
 * itself run end to end on the locked fixtures.  `node tools/xlsx-hash.test.js`
 *
 * Why these exist: the spin is 100,000 chained hashes. Awaiting
 * crypto.subtle.digest for each one froze a phone for seconds (device-heat fix,
 * approach C), so the hashes are now plain JavaScript. A hash that is wrong on one
 * input length is a password that never opens, so every length from 0 to 200
 * bytes is compared, plus the exact 4 + hashLen shape the spin feeds.
 *
 *   1. SHA-1 / SHA-256 / SHA-384 / SHA-512 == crypto.subtle.digest, lengths 0..200
 *   2. the sync spin == the old awaited loop (kept here as the oracle), spin 2000
 *   3. fhDecryptXlsx opens tools/fixtures/statements/*.locked.xlsx (password in
 *      manifest.json) on the main-thread path (no Worker in Node), refuses a wrong
 *      password with 'bad_password', and reads the container once
 *   4. the same through a fake Worker built from the Blob URL source: proves the
 *      worker script is self-contained, the answers cross back, and a dead worker
 *      falls back to the main thread
 */
const fs = require('fs');
const path = require('path');
const nodeCrypto = require('crypto');
const crypto = nodeCrypto.webcrypto;

let pass = 0, fail = 0;
const t = (n, ok, d) => { console.log((ok ? '  PASS  ' : '  FAIL  ') + n + (!ok && d !== undefined ? '  -> ' + JSON.stringify(d) : '')); ok ? pass++ : fail++; };
const hex = (u) => Buffer.from(u).toString('hex');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'src', 'js-data', '41-xlsx-decrypt.js'), 'utf8');
/* A DOMParser just big enough for _attrs: the attributes of the first element
   with that tag name (the fixture's tags span several lines). */
class DOMParserStub {
  parseFromString(xml) {
    return {
      getElementsByTagName(tag) {
        const m = new RegExp('<' + tag.replace(':', '\\:') + '\\s([^>]*?)/?>').exec(xml);
        if (!m) return [];
        const attributes = [];
        m[1].replace(/([\w:]+)="([^"]*)"/g, (a, n, v) => { attributes.push({ name: n, value: v }); return a; });
        return [{ attributes }];
      },
      getElementsByTagNameNS() { return []; },
    };
  }
}
function load(env) {
  const w = {};
  new Function('window', 'DOMParser', 'Worker', 'Blob', 'URL', 'setTimeout', 'clearTimeout', SRC)(
    w, DOMParserStub, env.Worker, env.Blob, env.URL, env.setTimeout || setTimeout, env.clearTimeout || clearTimeout);
  return w;
}
const cat = (...parts) => { const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let at = 0; parts.forEach((p) => { out.set(p, at); at += p.length; }); return out; };
const le32 = (n) => new Uint8Array([n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >>> 24) & 255]);
const utf16 = (s) => { const u = new Uint8Array(s.length * 2); for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); u[i * 2] = c & 255; u[i * 2 + 1] = c >> 8; } return u; };

(async () => {
  const W = load({ Worker: undefined, Blob: undefined, URL: undefined });
  const M = W.fhXlsxMath;

  console.log('\n-- 1. the four hashes against WebCrypto, every length 0..200 --');
  for (const name of ['SHA-1', 'SHA-256', 'SHA-384', 'SHA-512']) {
    let bad = null;
    for (let n = 0; n <= 200 && !bad; n++) {
      const m = new Uint8Array(nodeCrypto.randomBytes(n));
      const a = hex(M.hash[name](m)), b = hex(new Uint8Array(await crypto.subtle.digest(name, m)));
      if (a !== b) bad = { n, a, b };
    }
    t(name + ' matches WebCrypto on lengths 0..200', !bad, bad);
    // the spin's own shape: 4-byte counter + the previous digest, and a 3-block message
    const hl = M.hash[name](new Uint8Array(0)).length;
    const spinIn = cat(le32(12345), new Uint8Array(nodeCrypto.randomBytes(hl)));
    t(name + ' matches on the 4+' + hl + '-byte spin input', hex(M.hash[name](spinIn)) === hex(new Uint8Array(await crypto.subtle.digest(name, spinIn))));
    const long = new Uint8Array(nodeCrypto.randomBytes(1000));
    t(name + ' matches on a 1000-byte message', hex(M.hash[name](long)) === hex(new Uint8Array(await crypto.subtle.digest(name, long))));
  }
  t('empty-message SHA-256 is the known constant', hex(M.hash['SHA-256'](new Uint8Array(0))) === 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  t('"abc" SHA-1 is the known constant', hex(M.hash['SHA-1'](new TextEncoder().encode('abc'))) === 'a9993e364706816aba3e25717850c26c9cd0d89d');

  console.log('\n-- 2. the spin against the old awaited loop (the oracle), spin 2000 --');
  async function oldSpin(hash, salt, password, spin) {
    let h = new Uint8Array(await crypto.subtle.digest(hash, cat(salt, utf16(password))));
    for (let i = 0; i < spin; i++) h = new Uint8Array(await crypto.subtle.digest(hash, cat(le32(i), h)));
    return h;
  }
  const salt = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]);
  for (const name of ['SHA-1', 'SHA-256', 'SHA-384', 'SHA-512']) {
    const a = hex(M.spin(name, salt, utf16('01011990'), 2000)), b = hex(await oldSpin(name, salt, '01011990', 2000));
    t(name + ' spin(2000) equals the awaited loop', a === b, { a: a.slice(0, 16), b: b.slice(0, 16) });
  }
  t('a different password spins to a different key', hex(M.spin('SHA-512', salt, utf16('01011991'), 50)) !== hex(M.spin('SHA-512', salt, utf16('01011990'), 50)));
  t('spin 0 is hash(salt || password)', hex(M.spin('SHA-256', salt, utf16('x'), 0)) === hex(new Uint8Array(await crypto.subtle.digest('SHA-256', cat(salt, utf16('x'))))));

  console.log('\n-- 3. the locked fixtures open on the main-thread path --');
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'statements', 'manifest.json'), 'utf8'));
  const locked = manifest.fixtures.filter((f) => f.password);
  t('the fixture set has locked workbooks with a known password', locked.length >= 1, manifest.fixtures.map((f) => f.file));
  const fixtureBuf = (name) => { const b = fs.readFileSync(path.join(__dirname, 'fixtures', 'statements', name)); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); };
  const looksLikeXlsx = (ab) => { const u = new Uint8Array(ab); const s = Buffer.from(u).toString('latin1'); return u[0] === 0x50 && u[1] === 0x4b && s.indexOf('xl/workbook.xml') > 0 && s.indexOf('xl/worksheets/sheet1.xml') > 0; };
  for (const f of locked) {
    const ab = fixtureBuf(f.file);
    const c = W.fhXlsxContainer(ab);
    t(f.file + ': the container says agile, with both streams', c.kind === 'agile' && c.streams.EncryptionInfo && c.streams.EncryptedPackage, c.kind);
    t(f.file + ': fhXlsxEncryptionKind bridge still answers a string', W.fhXlsxEncryptionKind(ab) === 'agile');
    const out = await W.fhDecryptXlsx(c, f.password);
    t(f.file + ': opens with the manifest password into a plain .xlsx', looksLikeXlsx(out), out.byteLength);
    const again = await W.fhDecryptXlsx(ab, f.password);
    t(f.file + ': an ArrayBuffer is still accepted, same bytes out', hex(new Uint8Array(again)) === hex(new Uint8Array(out)));
    let err = null; try { await W.fhDecryptXlsx(c, f.password + '1'); } catch (e) { err = e.message; }
    t(f.file + ': a wrong password is refused as bad_password', err === 'bad_password', err);
    let err2 = null; try { await W.fhDecryptXlsx(c, f.password); } catch (e) { err2 = e.message; }
    t(f.file + ': the same container opens again after a wrong try (streams untouched)', err2 === null, err2);
  }
  const plain = fixtureBuf('bank-account.xlsx');
  let plainErr = null; try { W.fhXlsxContainer(plain); } catch (e) { plainErr = e.message; }
  t('a plain ZIP is not a container (throws, as 42 expects and catches)', plainErr !== null);

  console.log('\n-- 4. the same through a worker built from the Blob URL --');
  /* The Blob holds the script text; the fake Worker evaluates it with a `self`
     whose postMessage comes back as onmessage. Nothing else is in scope, so a
     reference to an outer helper would throw here exactly as it would in a browser. */
  const blobs = new Map(); let made = 0, terminated = 0;
  class BlobStub { constructor(parts) { this.text = parts.join(''); } }
  const URLStub = { createObjectURL: (b) => { const u = 'blob:test/' + blobs.size; blobs.set(u, b.text); return u; }, revokeObjectURL: () => {} };
  const mkWorker = (opts) => class WorkerStub {
    constructor(url) {
      made++;
      const self = { postMessage: (m) => queueMicrotask(() => this.onmessage && this.onmessage({ data: m })) };
      this._self = self;
      new Function('self', 'crypto', blobs.get(url))(self, crypto);
    }
    postMessage(m) {
      if (opts && opts.dead) { queueMicrotask(() => this.onerror && this.onerror({ message: 'boom' })); return; }
      queueMicrotask(() => this._self.onmessage({ data: m }));
    }
    terminate() { terminated++; }
  };
  const WW = load({ Worker: mkWorker(), Blob: BlobStub, URL: URLStub, setTimeout: () => 0, clearTimeout: () => {} });
  const f0 = locked[0], ab0 = fixtureBuf(f0.file);
  const viaWorker = await WW.fhDecryptXlsx(ab0, f0.password);
  t('the worker opens the file: same bytes as the main-thread path', hex(new Uint8Array(viaWorker)) === hex(new Uint8Array(await W.fhDecryptXlsx(ab0, f0.password))));
  t('the worker source is self-contained (it ran with only self + crypto in scope)', made === 1);
  let werr = null; try { await WW.fhDecryptXlsx(ab0, 'nope'); } catch (e) { werr = e.message; }
  t('a wrong password through the worker is still bad_password', werr === 'bad_password', werr);
  t('one worker is reused across attempts, not one per attempt', made === 1, made);
  const c0 = WW.fhXlsxContainer(ab0);
  await WW.fhDecryptXlsx(c0, f0.password);
  t('the container\'s package survives the transfer (a copy was sent)', c0.streams.EncryptedPackage.byteLength > 0 && (await WW.fhDecryptXlsx(c0, f0.password)).byteLength > 0);

  made = 0; terminated = 0;
  const WD = load({ Worker: mkWorker({ dead: true }), Blob: BlobStub, URL: URLStub, setTimeout: () => 0, clearTimeout: () => {} });
  const viaFallback = await WD.fhDecryptXlsx(ab0, f0.password);
  t('a worker that dies mid-job: the main thread finishes the same unlock', looksLikeXlsx(viaFallback));
  t('...and the dead worker was terminated, not leaked', terminated === 1, terminated);

  console.log('\n' + (fail ? fail + ' FAILED, ' : 'ALL ') + pass + ' PASSED');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
