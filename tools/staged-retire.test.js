#!/usr/bin/env node
/* A promotion must retire EXACTLY the rows it wrote — no more.
 * `node tools/staged-retire.test.js`
 *
 * The bug this exists for: fhPromoteStaged captured every readable row's id
 * (`_fhStagedIds = readable.map(...)`) and handed the whole list to
 * resolve_email_transactions, while csvPromote() writes only csvReview.ready.
 * Anything the review screen parked — a flagged duplicate, a deferred row — was
 * therefore DELETED without ever reaching the ledger.
 *
 * It never fired in production only because resolve_email_transactions appears
 * not to be applied, so nothing was being deleted at all. Applying 0060 would
 * have switched it on. Retiring more than was promoted is silent data loss on a
 * screen whose entire purpose is that a human sees every row first.
 *
 * The real function is extracted from source by name, so renaming or changing it
 * fails this rather than quietly passing.
 */
// NOT 'use strict': the eval'd declaration must land in this scope.
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'js-data', '72-txn-review.js'), 'utf8');

const start = src.indexOf('function fhStagedIdsForPromoted');
if (start < 0) {
  console.error('fhStagedIdsForPromoted not found in 72-txn-review.js — was it renamed?');
  process.exit(1);
}
eval(src.slice(start, src.indexOf('window.fhStagedIdsForPromoted')));

let pass = 0, fail = 0;
const t = (n, ok, d) => { console.log((ok ? '  PASS  ' : '  FAIL  ') + n + (!ok && d ? '  -> ' + d : '')); ok ? pass++ : fail++; };
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// Three staged rows, in the order the review screen received them.
const ROWS = [{ id: 'aaa' }, { id: 'bbb' }, { id: 'ccc' }];

console.log('\n-- the whole point: only what was promoted --');
t('all three promoted -> all three retired',
  eq(fhStagedIdsForPromoted(ROWS, [{ rowIndex: 0 }, { rowIndex: 1 }, { rowIndex: 2 }]),
     ['aaa', 'bbb', 'ccc']));
t('one held back as a duplicate -> it SURVIVES',
  eq(fhStagedIdsForPromoted(ROWS, [{ rowIndex: 0 }, { rowIndex: 2 }]), ['aaa', 'ccc']));
t('nothing promoted -> nothing retired',
  eq(fhStagedIdsForPromoted(ROWS, []), []));

console.log('\n-- order and identity follow rowIndex, not position --');
t('a reordered ready list still maps to the right rows',
  eq(fhStagedIdsForPromoted(ROWS, [{ rowIndex: 2 }, { rowIndex: 0 }]), ['ccc', 'aaa']));

console.log('\n-- nothing is invented when inputs are missing or odd --');
t('no ready list at all', eq(fhStagedIdsForPromoted(ROWS, null), []));
t('no rows at all', eq(fhStagedIdsForPromoted(null, [{ rowIndex: 0 }]), []));
t('both missing', eq(fhStagedIdsForPromoted(null, null), []));
t('a rowIndex past the end is dropped, not undefined',
  eq(fhStagedIdsForPromoted(ROWS, [{ rowIndex: 9 }]), []));
t('a candidate with no rowIndex is dropped',
  eq(fhStagedIdsForPromoted(ROWS, [{}]), []));
t('rowIndex 0 is kept — it is falsy but valid',
  eq(fhStagedIdsForPromoted(ROWS, [{ rowIndex: 0 }]), ['aaa']));
t('a row with no id contributes nothing',
  eq(fhStagedIdsForPromoted([{ id: '' }, { id: 'bbb' }], [{ rowIndex: 0 }, { rowIndex: 1 }]), ['bbb']));

console.log('\n' + (fail === 0 ? 'ALL ' + pass + ' PASSED' : pass + ' passed, ' + fail + ' FAILED'));
process.exit(fail ? 1 : 0);
