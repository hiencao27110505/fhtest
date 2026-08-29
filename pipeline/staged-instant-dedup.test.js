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
const block = src.slice(src.indexOf('    if (staged) {\n      var srow'), src.indexOf('    var ident ='));
t('the instant check runs BEFORE the text check', block.includes("'inst|'"));
t('it keys on the exact occurred_at, not the day', /inst\|'\s*\+\s*inst\s*\+\s*'\|'\s*\+\s*c\.amount/.test(block));
t('it is staged-only — file rows have no instant', src.indexOf('if (staged) {\n      var srow') < src.indexOf('var ident ='));

// Behavioural model of the same rule.
function bucket(rows, stagedRows){
  const seen = {}, dup = [], ready = [];
  rows.forEach(c => {
    const srow = stagedRows[c.rowIndex];
    const inst = srow && srow.occurred_at;
    if (inst && c.amount) {
      const k = 'inst|' + inst + '|' + c.amount;
      if (seen[k]) { dup.push(c); return; }
      seen[k] = c;
    }
    ready.push(c);
  });
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
