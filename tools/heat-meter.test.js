#!/usr/bin/env node
/* window.fhHeat, the always-on heat meter (src/js-ui/07-heat-meter.js).
 * `node tools/heat-meter.test.js`
 *
 * The meter is file 07 of the classic block: it runs before everything else and
 * wraps crypto.subtle, fetch and PerformanceObserver. So the two things that
 * must be true, and that this pins against the real source text:
 *   1. the wrappers are TRANSPARENT: same return value, same `this`, same
 *      arguments, every call counted once;
 *   2. setup never throws, whatever the browser is missing, and tick is always
 *      a callable no-op-safe function.
 * The file is evaluated in a vm context whose global IS `window`, the way a
 * classic <script> sees it, with hand-rolled stand-ins for the platform APIs so
 * the counts are checkable.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const SRC = fs.readFileSync(path.join(__dirname, '..', 'src', 'js-ui', '07-heat-meter.js'), 'utf8');

let pass = 0, fail = 0;
const t = (n, ok, d) => { console.log((ok ? '  PASS  ' : '  FAIL  ') + n + (!ok && d ? '  -> ' + d : '')); ok ? pass++ : fail++; };
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/* A context shaped like a browser window. `subtle` is a prototype-method object,
   as SubtleCrypto is, so the instance-shadowing the meter relies on is what is
   under test. */
function makeWindow(opts) {
  opts = opts || {};
  const calls = { decrypt: [], digest: [], encrypt: [], fetch: [] };
  const proto = {
    decrypt(alg, key, data) { calls.decrypt.push({ self: this, args: [alg, key, data] }); return Promise.resolve('plain:' + data); },
    digest(alg, data) { calls.digest.push({ self: this, args: [alg, data] }); return Promise.resolve('hash:' + data); },
    encrypt(alg, key, data) { calls.encrypt.push({ self: this }); return Promise.resolve('ct'); },
  };
  const subtle = Object.create(proto);
  let longtaskCb = null;
  const sb = {
    console, setTimeout, clearTimeout,
    performance: { now: () => Date.now() },
    document: { hidden: !!opts.hidden, readyState: 'complete', addEventListener() {}, getAnimations: () => opts.anims || [], getElementsByTagName: () => ({ length: 7 }) },
    fetch(input, init) { calls.fetch.push({ self: this, input, init }); return Promise.resolve({ ok: true, url: typeof input === 'string' ? input : input.url }); },
    PerformanceObserver: class { constructor(cb) { longtaskCb = cb; } observe() {} },
    MutationObserver: class { constructor(cb) { this.cb = cb; } observe() { sb.__mo = this; } disconnect() { sb.__mo = null; } },
  };
  sb.PerformanceObserver.supportedEntryTypes = ['longtask'];
  if (!opts.noCrypto) sb.crypto = { subtle };
  if (opts.nacl) sb.nacl = { box: { open: Object.assign(function () { return 'opened'; }, { after: () => 'after' }) }, secretbox: { open: () => 'sopened' } };
  sb.window = sb; sb.self = sb;
  vm.createContext(sb);
  return { sb, calls, subtle, fireLongTasks: (durs) => longtaskCb && longtaskCb({ getEntries: () => durs.map((d) => ({ duration: d })) }) };
}
function load(w) { vm.runInContext(SRC, w.sb, { filename: '07-heat-meter.js' }); return w.sb.fhHeat; }

(async () => {
  console.log('\n-- 1. load shape --');
  {
    const w = makeWindow({ nacl: true }); const H = load(w);
    t('window.fhHeat exists with the documented API',
      H && ['tick', 'snapshot', 'reset', 'rates', 'window', 'report', 'deep', 'diff'].every((k) => typeof H[k] === 'function'));
    const s = H.snapshot();
    t('every counter starts at zero', s.decrypts === 0 && s.digests === 0 && s.fetches === 0 && s.longTasks === 0 && s.unseals === 0 && eq(s.ticks, {}));
    t('reports what it managed to arm', s.armed && s.armed.subtle === true && s.armed.fetch === true && s.armed.longtask === true && s.armed.nacl === true && s.armed.deep === false);
    t('nodesAdded is null while deep is off (not a misleading 0)', s.nodesAdded === null);
  }

  console.log('\n-- 2. WebCrypto wrappers count and pass through --');
  {
    const w = makeWindow(); const H = load(w); const { subtle, calls } = w;
    const r1 = await subtle.decrypt({ name: 'AES-GCM' }, 'K', 'd1');
    const r2 = await subtle.decrypt({ name: 'AES-GCM' }, 'K', 'd2');
    const r3 = await subtle.digest('SHA-512', 'x');
    const r4 = await subtle.encrypt({ name: 'AES-GCM' }, 'K', 'p');
    t('return values pass through untouched', r1 === 'plain:d1' && r2 === 'plain:d2' && r3 === 'hash:x' && r4 === 'ct');
    t('`this` is the SubtleCrypto instance', calls.decrypt.every((c) => c.self === subtle) && calls.digest[0].self === subtle);
    t('arguments pass through in order', eq(calls.decrypt[1].args, [{ name: 'AES-GCM' }, 'K', 'd2']) && eq(calls.digest[0].args, ['SHA-512', 'x']));
    const s = H.snapshot();
    t('decrypts=2, digests=1, encrypts=1', s.decrypts === 2 && s.digests === 1 && s.encrypts === 1, JSON.stringify(s));
    t('the prototype method itself is untouched (instance shadow only)', Object.getPrototypeOf(subtle).decrypt.toString().indexOf('calls.decrypt') >= 0 && Object.prototype.hasOwnProperty.call(subtle, 'decrypt'));
    const saved = subtle.decrypt;
    await saved.call(subtle, 'a', 'k', 'd3');
    t('a saved reference still counts and still forwards `this`', H.snapshot().decrypts === 3 && calls.decrypt[2].self === subtle);
  }

  console.log('\n-- 3. fetch wrapper: counts by URL class, passes through --');
  {
    const w = makeWindow(); const H = load(w); const { sb, calls } = w;
    const base = 'https://abc.supabase.co';
    const r = await sb.fetch(base + '/rest/v1/personal_transactions?select=id', { method: 'GET' });
    await sb.fetch(base + '/rest/v1/rpc/get_family_snapshot', { method: 'POST' });
    await sb.fetch(base + '/rest/v1/rpc/my_families');
    await sb.fetch(base + '/storage/v1/object/public/family-media/x.enc');
    await sb.fetch(base + '/auth/v1/token?grant_type=refresh_token');
    await sb.fetch(base + '/functions/v1/push-send');
    await sb.fetch({ url: base + '/rest/v1/email_transactions' });            // Request-like object
    await sb.fetch('https://fonts.gstatic.com/x.woff2');
    t('response passes through', r && r.ok === true && /personal_transactions/.test(r.url));
    t('init passes through and `this` is window', eq(calls.fetch[0].init, { method: 'GET' }) && calls.fetch[0].self === sb);
    const s = H.snapshot();
    t('classes: rest=2 rpc=2 storage=1 auth=1 fn=1 other=1, total 8',
      s.fetches === 8 && s.fetchRest === 2 && s.fetchRpc === 2 && s.fetchStorage === 1 && s.fetchAuth === 1 && s.fetchFn === 1 && s.fetchOther === 1 && s.fetchRealtime === 0, JSON.stringify(s));
    t('nothing was issued while hidden', s.fetchesHidden === 0);
    const w2 = makeWindow({ hidden: true }); const H2 = load(w2);
    await w2.sb.fetch(base + '/rest/v1/x');
    t('a fetch while document.hidden is counted separately', H2.snapshot().fetchesHidden === 1 && H2.snapshot().fetches === 1);
  }

  console.log('\n-- 4. ticks, long tasks, nacl, deep --');
  {
    const w = makeWindow({ nacl: true, anims: [{ playState: 'running' }, { playState: 'paused' }, { playState: 'running' }] }); const H = load(w);
    H.tick('renderPersonal'); H.tick('renderPersonal'); H.tick('renderCsvReview'); H.tick('renderPersonal');
    t('tick names aggregate', eq(H.snapshot().ticks, { renderPersonal: 3, renderCsvReview: 1 }));
    t('tick with an unknown/odd name never throws', (() => { try { H.tick(); H.tick(null); H.tick(42); return true; } catch (e) { return false; } })());
    w.fireLongTasks([60, 120.4]);
    const s = H.snapshot();
    t('long tasks: count and total ms', s.longTasks === 2 && s.longTaskMs === 180, JSON.stringify([s.longTasks, s.longTaskMs]));
    t('running animations are sampled on demand (2 of 3)', s.animations === 2);
    const opened = w.sb.nacl.box.open('a', 'b', 'c', 'd'); w.sb.nacl.secretbox.open('x');
    t('nacl.box.open / secretbox.open are wrapped and pass through', opened === 'opened' && H.snapshot().unseals === 2);
    t('nacl.box.open.after survives the wrap', typeof w.sb.nacl.box.open.after === 'function');
    t('deep is off by default and deep(true) arms a MutationObserver', H.snapshot().armed.deep === false && H.deep(true) === true && !!w.sb.__mo);
    w.sb.__mo.cb([{ addedNodes: { length: 5 } }, { addedNodes: { length: 2 } }]);
    t('nodesAdded counts addedNodes while deep', H.snapshot().nodesAdded === 7);
    t('deep(false) disconnects', H.deep(false) === false && w.sb.__mo === null);
  }

  console.log('\n-- 5. snapshot / reset / diff / rates / window / report --');
  {
    const w = makeWindow(); const H = load(w);
    await w.subtle.decrypt('a', 'k', 'd'); await w.sb.fetch('https://x.supabase.co/rest/v1/t'); H.tick('renderCsvReview');
    const a = H.snapshot();
    t('snapshot is a plain object (JSON round-trips)', eq(JSON.parse(JSON.stringify(a)), a));
    t('snapshot is a copy: mutating it does not touch the meter', (a.decrypts = 99, H.snapshot().decrypts === 1));
    await w.subtle.decrypt('a', 'k', 'd'); await w.subtle.decrypt('a', 'k', 'd'); H.tick('renderCsvReview'); H.tick('renderPersonal');
    const d = H.diff(H.snapshot(), H.snapshot());
    t('diff of identical snapshots is all zero', d.decrypts === 0 && d.fetches === 0 && eq(d.ticks, { renderCsvReview: 0, renderPersonal: 0 }));
    a.decrypts = 1;
    const d2 = H.diff(a, H.snapshot());
    t('diff(a, b) subtracts counters and ticks', d2.decrypts === 2 && d2.fetches === 0 && d2.ticks.renderCsvReview === 1 && d2.ticks.renderPersonal === 1, JSON.stringify(d2));
    const r = H.rates();
    t('rates() gives per-minute numbers with a windowMs', typeof r.windowMs === 'number' && typeof r.decrypts === 'number' && r.decrypts >= 3);
    const wr = await H.window(30);
    t('window(ms) resolves to rates over that window only (nothing happened: zeros)', wr && wr.decrypts === 0 && wr.fetches === 0 && wr.windowMs >= 25, JSON.stringify(wr));
    t('window() with no argument is rates()', !(H.window() instanceof Promise) && typeof H.window().decrypts === 'number');
    H.reset();
    const z = H.snapshot();
    t('reset zeroes counters, ticks and the clock', z.decrypts === 0 && z.fetches === 0 && eq(z.ticks, {}) && z.sinceMs < 50);
    let tabled = null; const oc = w.sb.console;
    w.sb.console = { log() {}, table(rows) { tabled = rows; } };
    const rows = H.report();
    w.sb.console = oc;
    t('report() logs a table and returns its rows', Array.isArray(rows) && rows.length > 5 && tabled === rows && rows.every((x) => 'metric' in x && 'total' in x));
  }

  console.log('\n-- 6. never throws at load --');
  {
    let H = null, err = null;
    try { H = load(makeWindow({ noCrypto: true })); } catch (e) { err = e; }
    t('setup survives crypto being undefined', !err && H && typeof H.tick === 'function', String(err));
    t('…and reports subtle as not armed, decrypts stay 0', H && H.snapshot().armed.subtle === false && H.snapshot().decrypts === 0);
    const bare = { console, window: null }; bare.window = bare; vm.createContext(bare);
    let err2 = null; try { vm.runInContext(SRC, bare); } catch (e) { err2 = e; }
    t('setup survives a window with no crypto, no fetch, no document, no performance, no observers', !err2 && bare.fhHeat && typeof bare.fhHeat.tick === 'function', String(err2));
    t('…tick / snapshot / report still work there', (() => { try { bare.fhHeat.tick('x'); const s = bare.fhHeat.snapshot(); return s.ticks.x === 1 && s.animations === -1; } catch (e) { return false; } })());
    const w3 = makeWindow(); Object.defineProperty(w3.sb, 'fetch', { value: 1, writable: false, configurable: false });
    let err3 = null; try { load(w3); } catch (e) { err3 = e; }
    t('a non-writable fetch costs only that counter', !err3 && w3.sb.fhHeat.snapshot().armed.fetch === false && w3.sb.fhHeat.snapshot().armed.subtle === true);
  }

  console.log('\n-- 7. source-shape guards --');
  t('the file ends with no trailing newline (BUILD rule)', !/\n$/.test(SRC));
  t('it is a classic-script IIFE that assigns window.fhHeat', /^\(function \(\) \{/.test(SRC.replace(/^\/\*[\s\S]*?\*\/\s*/, '')) && /W\.fhHeat = \{ tick: tick/.test(SRC));
  t('hot wrappers are bare increments (no string building, no allocation)',
    /C\[counter\]\+\+; return o\.apply\(this, arguments\);/.test(SRC) && /C\.fetches\+\+;/.test(SRC) && !/C\.fetches\+\+;[\s\S]{0,40}new /.test(SRC));

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });