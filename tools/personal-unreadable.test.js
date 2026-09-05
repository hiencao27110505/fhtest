#!/usr/bin/env node
/* A personal row we cannot decrypt must never be counted as 0đ.
 * `node tools/personal-unreadable.test.js`
 *
 * _decP caught every error and returned null. null is ALSO what an absent field
 * returns, so "nothing stored" and "stored but unreadable" were the same value.
 * Number(null) is 0, and `s + (t.amt || 0)` folded the row into the month at
 * zero — so a wrong key or a half-finished rotation UNDERSTATED spending while
 * the tab still reported itself ready.
 *
 * The staged review screen already refuses to silently skip a row it cannot
 * open. This is the personal ledger brought in line with it.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const data = fs.readFileSync(path.join(__dirname, '..', 'src', 'js-data', '19-personal.js'), 'utf8');
const ui   = fs.readFileSync(path.join(__dirname, '..', 'src', 'js-ui',   '21-personal.js'), 'utf8');

let pass = 0, fail = 0;
const t = (n, ok, d) => { console.log((ok ? '  PASS  ' : '  FAIL  ') + n + (!ok && d ? '  -> ' + d : '')); ok ? pass++ : fail++; };

console.log('\n-- absence and failure are different values --');
t('a distinct failure sentinel exists', /_DEC_FAILED\s*=/.test(data));
t('an absent field still returns null, not the sentinel',
  /if \(!b64\) return null;/.test(data));
t('a throw returns the sentinel instead of null',
  /catch \(e\) \{ return _DEC_FAILED; \}/.test(data));
t('text fields degrade to null so a bad NOTE never marks the row unreadable',
  /_decTxt[\s\S]{0,140}_DEC_FAILED \? null : v/.test(data));

console.log('\n-- the row is marked, and counted --');
t('rows carry _unreadable', /_unreadable: bad/.test(data));
t('an unreadable amount becomes null, never 0', /amt: bad \? null : Number\(a\)/.test(data));
t('a running count is kept for the UI', /P\.unreadable\+\+/.test(data));
t('the counter resets each hydrate, so it cannot drift',
  /P\.txns = \[\]; P\.unreadable = 0;/.test(data));
t('incomes are covered too, not just expenses',
  (data.match(/_unreadable: bad/g) || []).length >= 2);

console.log('\n-- totals exclude it rather than adding zero --');
t('the month expense filter drops unreadable rows',
  /kind==='expense' && !t\._unreadable/.test(ui));
t('the month income filter drops them too', /&& !i\._unreadable/.test(ui));
t('the per-space roll-up derives from the FILTERED set, so it is covered',
  ui.indexOf('txM.forEach(function(t){ var k=t.spaceId') > ui.indexOf("!t._unreadable"));

console.log('\n-- and the person is told --');
t('a notice is rendered when any row is unreadable', /if\(monUnread\)\{/.test(ui));
t('it says the rows are not in the total',
  /chưa tính vào tổng/.test(ui));
t('it says what to do about it', /mở khoá lại bằng thẻ cá nhân/i.test(ui));
t('singular and plural both read correctly',
  /monUnread===1 \?/.test(ui));
// The locked row must show a DASH, never a formatted amount: fmt(null) would
// print 0đ and re-create the exact lie this fixes, one row at a time.
const lockedRow = ui.slice(ui.indexOf("if(t._unreadable){"), ui.indexOf("if(t._unreadable){") + 400);
t('the locked row is labelled', /Chưa đọc được/.test(lockedRow));
t('and shows a dash, never a formatted amount', lockedRow.indexOf('—') > 0 && !/fmt\(/.test(lockedRow));
t('no unreadable row reaches the money formatter',
  /if\(t\._unreadable\)\{[\s\S]{0,400}?return;/.test(ui));

console.log('\n' + (fail ? '  ' + fail + ' FAILED' : '  all ' + pass + ' passed') + ' (' + (pass + fail) + ' assertions)\n');
process.exit(fail ? 1 : 0);
