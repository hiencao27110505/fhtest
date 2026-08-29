#!/usr/bin/env node
/* Two ingestions of one payment collapse, whatever the text says.
 * `node pipeline/staged-instant-dedup.test.js`
 *
 * Both transports ingest every bank email — the mailbox reader and the
 * forwarding alias — and the pipeline lets that pass, because both copies
 * canonicalise to the same bank and "same bank" means "a separate transaction"
 * there. The client's in-batch check was the net, and it was keyed on TEXT: it
 * held while both copies carried the same raw memo, and went blind the day tidy
 * correctly emptied that boilerplate, leaving one copy on its counterparty and
 * the forwarded copy on nothing.
 *
 * So the identity is amount + the exact second, which no tidying can reshape.
 * Pinned here because the failure it prevents is invisible: a duplicated
 * transaction looks exactly like two purchases.
 */
const fs = require('fs');
const path = require('path');

let pass = 0, fail = 0;
const t = (n, ok, d) => { console.log((ok ? '  PASS  ' : '  FAIL  ') + n + (!ok && d ? '  -> ' + d : '')); ok ? pass++ : fail++; };

// The rule, extracted from source so it cannot drift from what ships.
const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'js-ui', '57-csv-import-review.js'), 'utf8');
t('a merged copy is dropped, not parked for a ruling', /if \(c\._mergedCopy\) \{ merged\+\+; return; \}/.test(src));
t('the count survives so the header can say it', /mergedCount: merged/.test(src));
t('the survivor is chosen by information, not arrival order',
  /csvInfoScore\(c\)\s*>\s*csvInfoScore\(held\)/.test(src));
t('it keys on the exact instant, not the day', /var k = inst \+ '\|' \+ c\.amount/.test(src));
t('a description outranks every other signal', /if \(desc\) score \+= 100/.test(src));
t('the pre-pass runs before any text check',
  src.indexOf('richest[k] = c') < src.indexOf("var ident = (c._hasDesc"));

// Behavioural model: the shipped scorer, evaluated on real shapes.
function csvRowTime(c){ return c.time || ''; }
const scoreSrc = src.slice(src.indexOf('function csvInfoScore'), src.indexOf('function csvCanonicalProvider'));
eval(scoreSrc);

function bucket(rows, stagedRows){
  const richest = {}, dup = [], ready = [];
  rows.forEach(c => {
    const srow = stagedRows[c.rowIndex];
    const inst = srow && srow.occurred_at;
    if (!inst || !c.amount) return;
    const k = inst + '|' + c.amount;
    const held = richest[k];
    if (!held) { richest[k] = c; return; }
    if (csvInfoScore(c) > csvInfoScore(held)) { held._mergedCopy = true; richest[k] = c; }
    else { c._mergedCopy = true; }
  });
  rows.forEach(c => (c._mergedCopy ? dup : ready).push(c));
  return { ready, dup };
}

console.log('\n-- the real pair: same payment, different text --');
const staged = [
  { occurred_at: '2026-08-29T03:39:54+00:00' },   // direct read
  { occurred_at: '2026-08-29T03:39:54+00:00' },   // forwarded copy
];
let r = bucket([
  { rowIndex: 0, amount: 24000, description: 'TRAN THI CAM NHUNG - 018100XXX1246' },
  { rowIndex: 1, amount: 24000, description: '' },          // tidy emptied it
], staged);
t('one survives', r.ready.length === 1);
t('the other is flagged, despite carrying no text at all', r.dup.length === 1);
t('the copy WITH a description is the one kept', r.ready[0].rowIndex === 0);

console.log('\n-- and the richest wins even when it arrives SECOND --');
r = bucket([
  { rowIndex: 0, amount: 24000, description: '' },                                  // blank copy first
  { rowIndex: 1, amount: 24000, description: 'TRAN THI CAM NHUNG - 018100XXX1246' },
], staged);
t('arrival order does not decide it', r.ready.length === 1 && r.ready[0].rowIndex === 1);
t('the blank copy is the one flagged', r.dup.length === 1 && r.dup[0].rowIndex === 0);

console.log('\n-- richness ranks the way a person reads the card --');
t('a description beats a category alone',
  csvInfoScore({ description: 'AEON' }) > csvInfoScore({ categoryName: 'Đi chợ' }));
t('the more specific description wins',
  csvInfoScore({ description: 'TRAN THI CAM NHUNG - 018100XXX1246' }) > csvInfoScore({ description: 'MB' }));
t('with equal descriptions, a category breaks the tie',
  csvInfoScore({ description: 'AEON', categoryName: 'Đi chợ' }) > csvInfoScore({ description: 'AEON' }));
t('an empty copy scores lowest of all', csvInfoScore({}) < csvInfoScore({ description: 'x' }));

console.log('\n-- two real payments, same amount, different seconds --');
r = bucket([
  { rowIndex: 0, amount: 100000, description: 'NGUYEN THU TRANG' },
  { rowIndex: 1, amount: 100000, description: 'NGUYEN THU TRANG' },
], [
  { occurred_at: '2026-08-26T17:34:00+00:00' },
  { occurred_at: '2026-08-26T17:47:00+00:00' },
]);
t('both survive — a different second is a different transfer', r.ready.length === 2 && r.dup.length === 0);

console.log('\n-- same second, different amounts --');
r = bucket([
  { rowIndex: 0, amount: 24000, description: 'a' },
  { rowIndex: 1, amount: 170000, description: 'b' },
], [
  { occurred_at: '2026-08-29T03:39:54+00:00' },
  { occurred_at: '2026-08-29T03:39:54+00:00' },
]);
t('both survive — the amount is part of the identity', r.ready.length === 2);

console.log('\n-- a row with no instant is never collapsed by this rule --');
r = bucket([
  { rowIndex: 0, amount: 50000, description: 'x' },
  { rowIndex: 1, amount: 50000, description: 'x' },
], [{}, {}]);
t('both survive rather than guessing', r.ready.length === 2);

console.log('\n' + (fail === 0 ? 'ALL ' + pass + ' PASSED' : pass + ' passed, ' + fail + ' FAILED'));
process.exit(fail ? 1 : 0);
