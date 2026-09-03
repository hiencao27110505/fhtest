#!/usr/bin/env node
/* An import is cross-matched against the ledger it will actually land in.
 * `node pipeline/personal-ledger-dedup.test.js`
 *
 * The bug: the cross-match read window.txns — the FAMILY ledger — and nothing
 * else. Since Model Y a staged row can just as easily be written to the
 * person's own book, and since the mailbox grant defaults to personal, most of
 * them are. So a personal import was checked against a ledger it was never
 * going to touch, and re-importing the same batch stacked it silently. The
 * rows are ciphertext on the server, so no query notices either — the only
 * evidence would be a person scrolling their own ledger and seeing double.
 *
 * Both books are offered to the matcher now. Deliberately wider than "the book
 * this row is going to": destination is per-row and editable right up until
 * Import, so narrowing it would make the check depend on a decision the person
 * has not finished making.
 */
const fs = require('fs');
const path = require('path');

let pass = 0, fail = 0;
const t = (n, ok, d) => { console.log((ok ? '  PASS  ' : '  FAIL  ') + n + (!ok && d ? '  -> ' + d : '')); ok ? pass++ : fail++; };

const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'js-ui', '57-csv-import-review.js'), 'utf8');

console.log('\n-- the matcher is given both books --');
t('the personal cache is consulted (as the fallback)', /window\.fhPersonalData/.test(src));
t('the 365-day match slice is preferred over the short cache', /window\._fhPersonalMatchSlice/.test(src));
t('the family ledger is still consulted', /window\.txns \|\| \[\]/.test(src));
t('every entry is normalised to đồng before matching (the units bug, 2026-09-03)',
  /amtD: Number\(t\.amt\) \* mult/.test(src));
t('the comparison runs on the normalised amount, never the raw one',
  /Math\.abs\(t\.amtD - c\.amount\) < 1/.test(src));
t('rows with no date or no amount are dropped rather than guessed at',
  /if \(t\.amt == null \|\| !t\.date\) return;/.test(src));
t('income candidates hunt income rows, expenses hunt expenses',
  /wantKind = c\.isIncome \? 'income' : 'expense'/.test(src)
  && /t\.kind !== wantKind/.test(src));

/* Behavioural model of the shipped rule: ledger rows arrive in base units
   (đồng ÷ 1000 for VND) from BOTH books, candidates carry raw đồng — the
   model normalises exactly as the shipped builder does. */
const MULT = 1000;
const build = (fam, personal) => {
  const out = fam
    .filter(t => t._d && t.amt != null)
    .map(t => ({ amtD: t.amt * MULT, _d: t._d, kind: 'expense', book: 'family' }));
  personal.forEach(t => {
    if (t.amt == null || !t.date) return;
    if (t.kind !== 'expense' && t.kind !== 'income') return;
    out.push({ amtD: t.amt * MULT, _d: new Date(t.date + 'T00:00:00'), kind: t.kind || 'expense', book: 'personal' });
  });
  return out;
};
const crossMatch = (existing, c) => existing.find(t => {
  if (t.kind !== (c.isIncome ? 'income' : 'expense') || !c.date) return false;
  return Math.abs(t._d.getTime() - c.date.getTime()) / 86400000 <= 3
      && Math.abs(t.amtD - c.amount) < 1;
});

const D = s => new Date(s + 'T00:00:00');

console.log('\n-- a second import of the same personal batch is caught --');
const personal = [{ date: '2026-08-26', amt: 337.9, kind: 'expense' }, { date: '2026-08-25', amt: 45, kind: 'expense' }];
let ex = build([], personal);
t('the already-imported row is recognised', !!crossMatch(ex, { date: D('2026-08-26'), amount: 337900 }));
t('so is one two days off, inside the window', !!crossMatch(ex, { date: D('2026-08-28'), amount: 337900 }));
t('a genuinely new amount is not', !crossMatch(ex, { date: D('2026-08-26'), amount: 512000 }));
t('the same amount a fortnight later is not', !crossMatch(ex, { date: D('2026-09-10'), amount: 337900 }));

console.log('\n-- the family ledger still works, and both are live at once --');
ex = build([{ _d: D('2026-08-20'), amt: 100 }], personal);
t('a family row still matches', !!crossMatch(ex, { date: D('2026-08-20'), amount: 100000 }));
t('a personal row matches in the same pass', !!crossMatch(ex, { date: D('2026-08-25'), amount: 45000 }));

console.log('\n-- income is matched against income, never against a same-magnitude expense --');
ex = build([], [{ date: '2026-08-26', amt: 5000, kind: 'income' }, { date: '2026-08-26', amt: 5000, kind: 'expense' }]);
t('an income candidate finds the logged income row',
  (crossMatch(ex, { date: D('2026-08-26'), amount: 5000000, isIncome: true }) || {}).kind === 'income');
t('an expense candidate finds the expense, not the credit',
  (crossMatch(ex, { date: D('2026-08-26'), amount: 5000000 }) || {}).kind === 'expense');
t('an income candidate with no logged income matches nothing',
  !crossMatch(build([], [{ date: '2026-08-26', amt: 5000, kind: 'expense' }]),
              { date: D('2026-08-26'), amount: 5000000, isIncome: true }));

console.log('\n-- degrading safely --');
t('an unreadable personal row (amt null) is skipped, not treated as a match',
  build([], [{ date: '2026-08-26', amt: null, kind: 'expense' }]).length === 0);
t('a dateless personal row is skipped', build([], [{ date: null, amt: 50, kind: 'expense' }]).length === 0);
t('an empty personal cache leaves the family list untouched',
  build([{ _d: D('2026-08-20'), amt: 100 }], []).length === 1);

console.log('\n' + (fail === 0 ? 'ALL ' + pass + ' PASSED' : pass + ' passed, ' + fail + ' FAILED'));
process.exit(fail ? 1 : 0);
