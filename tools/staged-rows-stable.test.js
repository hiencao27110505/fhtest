#!/usr/bin/env node
/* The staged-row map survives a partial import. `node tools/staged-rows-stable.test.js`
 *
 * 2026-09-30 (kaoheen@): a one-row "Nhập ngay" resolved its row and then EMPTIED
 * window._fhStagedRows, while the review stayed open with 808 candidates whose
 * rowIndex still pointed into that array. The next press wrote all 808 to the
 * ledger, mapped every candidate to nothing, hit `if (!ids.length) return;`
 * AFTER the writes, and never told the server: badge frozen at 8xx, the queue
 * offering the same rows to any other device, the phone hot repainting 813
 * cards into a hidden sheet.
 *
 * Three guards, each against the real source (a rename fails this loudly):
 *   1. a resolved row becomes a HOLE (null) in the map, the array is never replaced;
 *   2. a candidate resolves to its staged id through the id it was born with,
 *      or the row still at its index — and a hole yields null, never a throw;
 *   3. the exclusion rule skips holes, and the promote tail no longer contains
 *      the silent early return.
 */
// NOT 'use strict': the eval'd declarations must land in this scope.
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'js-data', '72-txn-review.js'), 'utf8');

let pass = 0, fail = 0;
const t = (n, ok, d) => { console.log((ok ? '  PASS  ' : '  FAIL  ') + n + (!ok && d ? '  -> ' + d : '')); ok ? pass++ : fail++; };
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function slice(name, stopAt) {
  const k = src.indexOf('function ' + name + '(');
  if (k < 0) { console.error(name + ' not found in 72-txn-review.js — renamed?'); process.exit(1); }
  return src.slice(k, src.indexOf(stopAt, k));
}
const window = {};
eval(slice('_stagedRowsForget', '  /* The staged id of a candidate'));
eval(slice('_stagedIdOfCand', 'window.fhStagedIdOfCand'));
eval(slice('fhStagedIdsForResolved', 'window.fhStagedIdsForResolved'));

console.log('\n-- 1. resolve leaves a hole, never a new array --');
window._fhStagedRows = [{ id: 'aaa' }, { id: 'bbb' }, { id: 'ccc' }];
const before = window._fhStagedRows;
_stagedRowsForget(['bbb']);
t('same array object', window._fhStagedRows === before);
t('length kept, resolved entry is null', eq(window._fhStagedRows, [{ id: 'aaa' }, null, { id: 'ccc' }]));
t('unknown ids are a no-op', (_stagedRowsForget(['zzz']), eq(window._fhStagedRows, [{ id: 'aaa' }, null, { id: 'ccc' }])));
t('empty inputs are safe', (_stagedRowsForget([]), _stagedRowsForget(null), true));

console.log('\n-- 2. candidate → staged id --');
t('born with _stagedId wins', _stagedIdOfCand({ rowIndex: 1, _stagedId: 'bbb' }) === 'bbb');
t('falls back to the row at its index', _stagedIdOfCand({ rowIndex: 2 }) === 'ccc');
t('a hole yields null, not a throw', _stagedIdOfCand({ rowIndex: 1 }) === null);
t('no rowIndex yields null', _stagedIdOfCand({}) === null && _stagedIdOfCand(null) === null);

console.log('\n-- 3. the exclusion rule and the promote tail --');
const review = (o) => Object.assign({ ready: [], groups: [], dup: [], deferred: [] }, o);
t('holes are skipped by the exclusion rule',
  eq(fhStagedIdsForResolved(window._fhStagedRows, review({ ready: [{ rowIndex: 0 }, { rowIndex: 2 }] })), ['aaa', 'ccc']));
t('the map is never emptied on resolve', src.indexOf('window._fhStagedRows = [];') < 0, 'found `window._fhStagedRows = [];`');
const promoteSrc = src.slice(src.indexOf('async function _fhPromoteStagedRun'), src.indexOf('/* Account setup (0134'));
t('promote tail exists', promoteSrc.length > 0);
t('no silent early return after the ledger writes', promoteSrc.indexOf('if (!ids.length) return;') < 0, 'found `if (!ids.length) return;` in the promote tail');
t('candidates are stamped with their staged id on open', src.indexOf('c._stagedId = readable[c.rowIndex].id') >= 0);
t('unmapped-after-write is logged', src.indexOf('rows written, none mapped to a staged id') >= 0);
t('the retired list is keyed on the person, not the seat', src.indexOf("'fh-staged-retired:u:'") >= 0);

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
