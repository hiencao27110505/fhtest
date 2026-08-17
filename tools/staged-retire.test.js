#!/usr/bin/env node
/* A promotion retires what the person FINISHED with — imported or deliberately
 * removed — and nothing that is still waiting on them.
 * `node tools/staged-retire.test.js`
 *
 * Two bugs live on this one decision, pulling opposite ways:
 *
 *   RETIRE TOO MUCH and a transaction is deleted that never reached the ledger.
 *   The original code handed every fetched id to resolve_email_transactions
 *   while csvPromote() writes only csvReview.ready, so rows parked as duplicates
 *   were destroyed. Dormant until 0060 was applied; live the moment it was.
 *
 *   RETIRE TOO LITTLE and rows the person explicitly removed come back forever.
 *   0060 exists partly for this: "the user has said this is not a transaction
 *   they want; keeping it would mean the queue slowly fills with things they
 *   already dismissed."
 *
 * The rule is therefore defined by EXCLUSION — everything except what is still
 * waiting — because three of the four ✕ handlers splice the candidate out of
 * csvReview entirely, leaving nothing to inspect afterwards.
 *
 * The real function is extracted from source by name, so a rename fails this
 * rather than quietly passing.
 */
// NOT 'use strict': the eval'd declaration must land in this scope.
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'js-data', '72-txn-review.js'), 'utf8');

const start = src.indexOf('function fhStagedIdsForResolved');
if (start < 0) {
  console.error('fhStagedIdsForResolved not found in 72-txn-review.js — renamed?');
  process.exit(1);
}
eval(src.slice(start, src.indexOf('window.fhStagedIdsForResolved')));

let pass = 0, fail = 0;
const t = (n, ok, d) => { console.log((ok ? '  PASS  ' : '  FAIL  ') + n + (!ok && d ? '  -> ' + d : '')); ok ? pass++ : fail++; };
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// Four staged rows, in the order the review screen received them.
const ROWS = [{ id: 'aaa' }, { id: 'bbb' }, { id: 'ccc' }, { id: 'ddd' }];
const cand = (i) => ({ rowIndex: i });
const review = (o) => Object.assign({ ready: [], groups: [], dup: [], deferred: [] }, o);

console.log('\n-- imported rows are finished --');
t('all four imported -> all four retired',
  eq(fhStagedIdsForResolved(ROWS, review({ ready: [0, 1, 2, 3].map(cand) })),
     ['aaa', 'bbb', 'ccc', 'ddd']));

console.log('\n-- rows still waiting are NOT retired --');
t('a deferred row survives',
  eq(fhStagedIdsForResolved(ROWS, review({ ready: [cand(0)], deferred: [cand(1)] })),
     ['aaa', 'ccc', 'ddd']));
t('a row needing a category survives',
  eq(fhStagedIdsForResolved(ROWS, review({ ready: [cand(0)], groups: [{ key: 'k', items: [cand(2)] }] })),
     ['aaa', 'bbb', 'ddd']));
t('an unruled duplicate survives',
  eq(fhStagedIdsForResolved(ROWS, review({ ready: [cand(0)], dup: [{ c: cand(3), resolved: null }] })),
     ['aaa', 'bbb', 'ccc']));

console.log('\n-- but a DECISION is finished, either way --');
t('a duplicate skipped on purpose IS retired',
  eq(fhStagedIdsForResolved(ROWS, review({ ready: [cand(0)], dup: [{ c: cand(1), resolved: 'skip' }] })),
     ['aaa', 'bbb', 'ccc', 'ddd']));
t("a duplicate included ('done') is retired — it went into ready",
  eq(fhStagedIdsForResolved(ROWS, review({ ready: [cand(0), cand(1)], dup: [{ c: cand(1), resolved: 'done' }] })),
     ['aaa', 'bbb', 'ccc', 'ddd']));

console.log('\n-- the ✕ splices: removed rows leave no trace, and must still go --');
// csvReadyRemove / csvSkipGroup / csvDeferDrop splice the candidate out, so the
// removed row appears in NO bucket. That is exactly the case exclusion catches.
t('a row removed with ✕ is retired even though nothing references it',
  eq(fhStagedIdsForResolved(ROWS, review({ ready: [cand(0)], deferred: [cand(3)] })),
     ['aaa', 'bbb', 'ccc']));
t('removing everything and importing nothing still retires them',
  eq(fhStagedIdsForResolved(ROWS, review({})), ['aaa', 'bbb', 'ccc', 'ddd']));

console.log('\n-- refuse to guess when the state is unreadable --');
t('no review object -> retire nothing', eq(fhStagedIdsForResolved(ROWS, null), []));
t('review without a ready array -> retire nothing',
  eq(fhStagedIdsForResolved(ROWS, { groups: [], dup: [], deferred: [] }), []));
t('no rows -> nothing', eq(fhStagedIdsForResolved([], review({})), []));
t('null rows -> nothing', eq(fhStagedIdsForResolved(null, review({})), []));

console.log('\n-- index handling --');
t('rowIndex 0 is respected as pending, though falsy',
  eq(fhStagedIdsForResolved(ROWS, review({ deferred: [cand(0)] })), ['bbb', 'ccc', 'ddd']));
t('a candidate with no rowIndex holds nothing back',
  eq(fhStagedIdsForResolved(ROWS, review({ deferred: [{}] })), ['aaa', 'bbb', 'ccc', 'ddd']));
t('a row with no id contributes nothing',
  eq(fhStagedIdsForResolved([{ id: '' }, { id: 'bbb' }], review({})), ['bbb']));

console.log('\n' + (fail === 0 ? 'ALL ' + pass + ' PASSED' : pass + ' passed, ' + fail + ' FAILED'));
process.exit(fail ? 1 : 0);
