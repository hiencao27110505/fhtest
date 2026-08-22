#!/usr/bin/env node
/* ✕ on a staged row must ARM first, then take effect immediately.
 * `node tools/staged-remove-arm.test.js`
 *
 * The bug this exists for: removal was in-memory only. csvReadyRemove spliced
 * the row out of csvReview and nothing was retired until an Import — so closing
 * the sheet without importing dropped the removal, and removing EVERY row greyed
 * the Import button out, which meant it could never be spent at all. The row
 * came back on the next open, and every new receipt dragged the old ones along.
 *
 * Two properties matter and neither is visible from reading the call site:
 *   • one tap must not delete (this deletes a transaction and its stored email)
 *   • two taps must delete NOW, not bank it for an Import that may never come
 *
 * The real function is extracted from source by name.
 */
// NOT 'use strict': eval'd declarations must land in this scope.
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'js-ui', '56-csv-import-ui.js'), 'utf8');

const start = src.indexOf('var csvArmedRemove = null;');
const end = src.indexOf('function csvGroupPick');
if (start < 0 || end < 0) {
  console.error('csvReadyRemove block not found — renamed?');
  process.exit(1);
}

let pass = 0, fail = 0;
const t = (n, ok, d) => { console.log((ok ? '  PASS  ' : '  FAIL  ') + n + (!ok && d ? '  -> ' + d : '')); ok ? pass++ : fail++; };

// Stubs for everything the block touches.
var csvReview, csvStagedMode, csvExpand, renders, dropped;
function renderCsvReview(){ renders++; }
global.window = { fhStagedDropOne: function(c){ dropped.push(c); } };

eval(src.slice(start, end));

function reset(staged){
  csvReview = { ready: [{ rowIndex:0, id:'a' }, { rowIndex:1, id:'b' }, { rowIndex:2, id:'c' }] };
  csvStagedMode = staged; csvExpand = { kind:'ready', idx:1 };
  csvArmedRemove = null; renders = 0; dropped = [];
}

console.log('\n-- staged queue: one tap arms, it does not delete --');
reset(true);
csvReadyRemove(1);
t('row survives the first tap', csvReview.ready.length === 3);
t('the row is armed', csvArmedRemove === 1, String(csvArmedRemove));
t('nothing was retired', dropped.length === 0);
t('it re-rendered so the armed state shows', renders === 1);

console.log('\n-- second tap on the SAME row removes and retires now --');
csvReadyRemove(1);
t('row is gone from the list', csvReview.ready.length === 2);
t('the right row went', csvReview.ready.map(r=>r.id).join(',') === 'a,c');
t('it was retired immediately, not banked', dropped.length === 1 && dropped[0].id === 'b');
t('disarmed afterwards', csvArmedRemove === null);
t('the open editor closed', csvExpand === null);

console.log('\n-- arming a DIFFERENT row never deletes the first --');
reset(true);
csvReadyRemove(0);
csvReadyRemove(2);              // moves the arm, must not remove row 0
t('nothing removed', csvReview.ready.length === 3);
t('arm moved to the new row', csvArmedRemove === 2);
t('still nothing retired', dropped.length === 0);

console.log('\n-- a tap elsewhere disarms, so the next ✕ cannot delete --');
reset(true);
csvReadyRemove(1);
t('disarm reports it cleared something', csvDisarmRemove() === true);
t('and it is clear', csvArmedRemove === null);
csvReadyRemove(1);
t('the next tap only re-arms', csvReview.ready.length === 3 && csvArmedRemove === 1);
t('nothing retired by an unconfirmed tap', dropped.length === 0);

console.log('\n-- CSV file import is untouched: no arming, no retirement --');
reset(false);
csvReadyRemove(1);
t('removes on the first tap', csvReview.ready.length === 2);
t('never calls the retire path (nothing to retire in a file)', dropped.length === 0);
t('never arms', csvArmedRemove === null);

console.log('\n' + (fail === 0 ? 'ALL ' + pass + ' PASSED' : pass + ' passed, ' + fail + ' FAILED'));
process.exit(fail ? 1 : 0);
