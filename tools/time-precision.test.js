#!/usr/bin/env node
/* A v2 mail STATES whether it carried a clock time.  `node tools/time-precision.test.js`
 *
 * A date-only source is stored at UTC midnight, so every reader inferred "exactly
 * 00:00:00 UTC means the mail had no time". Two wrong answers live in that guess:
 * a real payment at 07:00:00 in Vietnam IS 00:00:00 UTC and lost its time, and a
 * day-only mail stamped with any other hour was given a clock it never had.
 * Payload v2 seals `time_precision` (second | minute | day) and the three readers
 * of the guess ask it first (email-reading-v2-spec §4). v1 keeps the inference.
 *
 * Real functions extracted from source by name.
 */
'use strict';
process.env.TZ = 'Asia/Ho_Chi_Minh';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const SRC72 = fs.readFileSync(path.join(ROOT, 'src/js-data/72-txn-review.js'), 'utf8');
const SRC76 = fs.readFileSync(path.join(ROOT, 'src/js-data/76-quick-review.js'), 'utf8');
const SRC57 = fs.readFileSync(path.join(ROOT, 'src/js-ui/57-csv-import-review.js'), 'utf8');

let failed = 0;
function ok(cond, what, detail) {
  console.log((cond ? '  ok   ' : '  FAIL ') + what + (!cond && detail !== undefined ? '  -> ' + JSON.stringify(detail) : ''));
  if (!cond) failed++;
}
function grab(src, header) {
  const at = src.indexOf(header);
  if (at < 0) throw new Error('not found in source: ' + header);
  let i = src.indexOf('{', at), depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (!depth) break; }
  }
  return src.slice(at, i + 1);
}

const MIDNIGHT_UTC = '2026-08-20T00:00:00+00:00';   // 07:00 in Vietnam
const AFTERNOON = '2026-08-20T07:05:09+00:00';      // 14:05 in Vietnam

const ctx = { console };
ctx.window = ctx;
vm.createContext(ctx);
vm.runInContext(grab(SRC72, 'window.fhStagedRowTime = function (c)') + ';\n' + grab(SRC76, 'function _qrTime('), ctx);
const rowTime = (occurredAt, x) => { ctx._fhStagedRows = [{ occurred_at: occurredAt, raw_extracted: x }]; return vm.runInContext('fhStagedRowTime({ rowIndex: 0 })', ctx); };
const qrTime = (occurredAt, x) => { ctx.__a = [occurredAt, x]; return vm.runInContext('_qrTime(__a[0], __a[1])', ctx); };

console.log('the full review (fhStagedRowTime) and the quick sheet (_qrTime) agree');
for (const [name, fn] of [['fhStagedRowTime', rowTime], ['_qrTime', qrTime]]) {
  ok(fn(AFTERNOON, {}) === '14:05', name + ' v1, a real moment -> its local time', fn(AFTERNOON, {}));
  ok(fn(MIDNIGHT_UTC, {}) === undefined, name + ' v1, UTC midnight -> day-only (the inference, unchanged)', fn(MIDNIGHT_UTC, {}));
  ok(fn(MIDNIGHT_UTC, { v: 2, time_precision: 'second' }) === '07:00', name + ' v2 "second" at UTC midnight -> 07:00 is a real time and is kept', fn(MIDNIGHT_UTC, { v: 2, time_precision: 'second' }));
  ok(fn(MIDNIGHT_UTC, { v: 2, time_precision: 'minute' }) === '07:00', name + ' v2 "minute" likewise');
  ok(fn(AFTERNOON, { v: 2, time_precision: 'day' }) === undefined, name + ' v2 "day" -> day-only, whatever hour the stamp carries', fn(AFTERNOON, { v: 2, time_precision: 'day' }));
  ok(fn(MIDNIGHT_UTC, { v: 2, time_precision: 'sometime' }) === undefined && fn(MIDNIGHT_UTC, { v: 2 }) === undefined,
    name + ' an unknown or absent precision falls back to the inference');
}

console.log('\nthe richest-copy merge keys on a real instant only');
{
  const c2 = { console, csvStagedMode: true, csvInfoScore: () => 1, normDescForDedup: (s) => String(s || '').toLowerCase(), fhNodeDepth: () => 0,
    fhDedupLedgerIndex: () => ({ rows: [], byAmt: {} }), fhDedupAssess: (ecs) => ecs.map(() => null) };
  c2.window = c2;
  vm.createContext(c2);
  vm.runInContext(grab(SRC57, 'function bucketCsvCandidates('), c2);
  const pair = (occurredAt, x) => {
    c2._fhStagedRows = [0, 1].map((i) => ({ id: 'r' + i, occurred_at: occurredAt, raw_extracted: x }));
    c2.__cs = [0, 1].map((i) => ({ rowIndex: i, amount: 50000, flags: [], description: 'row ' + i, _hasDesc: true, categoryName: 'Khác', dateDisplay: '2026-08-20' }));
    return vm.runInContext('bucketCsvCandidates(__cs, false)', c2).mergedCount;
  };
  ok(pair(AFTERNOON, {}) === 1, 'v1: same second, same amount -> one payment that arrived twice');
  ok(pair(MIDNIGHT_UTC, {}) === 0, 'v1: a day-only stamp is no instant, so two honest purchases are not collapsed');
  ok(pair(AFTERNOON, { v: 2, time_precision: 'day' }) === 0, 'v2 "day": not collapsed either, though the stamp carries an hour');
  ok(pair(MIDNIGHT_UTC, { v: 2, time_precision: 'second' }) === 1, 'v2 "second" at 07:00:00 sharp: a real instant, merged');
}

console.log(failed ? '\n' + failed + ' failed' : '\nall passed');
process.exit(failed ? 1 : 0);
