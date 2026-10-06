/* recurring-charges-spec.md §13 — the engine, in isolation. Runs the real
   src/js-data/29-recur.js in a vm with a bare window. */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'js-data', '29-recur.js'), 'utf8');
const window = {};
vm.runInNewContext(src, { window, Date, Math, String, Number, Object, Array, Map, Set, isFinite, console });
const R = window.FH_RECUR;

let failed = 0;
function t(name, ok, detail) {
  console.log((ok ? '  PASS  ' : '  FAIL  ') + name + (ok ? '' : '  -> ' + JSON.stringify(detail)));
  if (!ok) failed++;
}
const row = (o) => Object.assign({ kind: 'expense', recur: null, recurSrc: null, recurSig: null, renewsOn: null, note: '', cat: '' }, o);

console.log('\n-- windows --');
t('6..8 days is weekly', R.periodOf(6) === 'weekly' && R.periodOf(8) === 'weekly' && R.periodOf(9) === null);
t('26..35 days is monthly', R.periodOf(26) === 'monthly' && R.periodOf(35) === 'monthly' && R.periodOf(25) === null && R.periodOf(36) === null);
t('350..380 days is yearly', R.periodOf(350) === 'yearly' && R.periodOf(380) === 'yearly' && R.periodOf(349) === null);

console.log('\n-- next date --');
t('monthly from 31 Jan clamps to 28 Feb', R.addPeriod('2026-01-31', 'monthly') === '2026-02-28');
t('monthly from 6 Oct is 6 Nov', R.addPeriod('2026-10-06', 'monthly') === '2026-11-06');
t('yearly over a leap day: 29 Feb 2028 → 28 Feb 2029', R.addPeriod('2028-02-29', 'yearly') === '2029-02-28');
t('weekly adds seven days', R.addPeriod('2026-10-06', 'weekly') === '2026-10-13');
t('a stated renew date wins', R.nextDate('2026-10-06', 'monthly', '2026-11-09') === '2026-11-09');

console.log('\n-- creep --');
t('4.9% above is noise', R.creep(104900, 100000) === 0);
t('5.1% above is creep, as the delta', R.creep(105100, 100000) === 5100);
t('a decrease is never creep', R.creep(90000, 100000) === 0);

console.log('\n-- series and detection --');
const google = [
  row({ id: 'a', date: '2026-08-06', amt: 50000, who: 'Google' }),
  row({ id: 'b', date: '2026-09-06', amt: 50000, who: 'Google' }),
];
let a = R.analyse(google, '2026-10-01');
t('two monthly charges make a SOFT series', a.series.length === 1 && a.series[0].period === 'monthly' && a.series[0].soft === true, a.series);
t('…and a pattern patch on the LATEST row only', a.patches.length === 1 && a.patches[0].id === 'b' && a.patches[0].recurrence_source === 'pattern', a.patches);
t('next date derives from the latest charge', a.series[0].next === '2026-10-06', a.series[0].next);
t('due in 5 days from 1 Oct', a.series[0].dueInDays === 5, a.series[0].dueInDays);

const three = google.concat([row({ id: 'c', date: '2026-10-06', amt: 50000, who: 'Google' })]);
a = R.analyse(three, '2026-10-07');
t('a third charge confirms (not soft)', a.series[0].soft === false && a.series[0].count === 3, a.series[0]);

const creepRows = google.concat([row({ id: 'c', date: '2026-10-06', amt: 60000, who: 'Google' })]);
a = R.analyse(creepRows, '2026-10-07');
t('a 20% jump breaks the pattern chain for detection (no new vote)…', a.patches.length === 0 || a.patches[0].id !== 'c', a.patches);

const marked = [
  row({ id: 'a', date: '2026-09-06', amt: 50000, who: 'Google', recur: 'monthly', recurSrc: 'receipt', recurSig: 'sub|google|google one' }),
  row({ id: 'b', date: '2026-10-06', amt: 60000, who: 'Google', recur: 'monthly', recurSrc: 'receipt', recurSig: 'sub|google|google one' }),
];
a = R.analyse(marked, '2026-10-07');
t('a receipt-marked series is never soft and reports creep', a.series.length === 1 && a.series[0].soft === false && a.series[0].creep === 10000, a.series[0]);
t('product from the signature', a.series[0].product === 'google one', a.series[0].product);
t('no amount in the series key', a.series[0].key.indexOf('50000') < 0 && a.series[0].key.indexOf('60000') < 0, a.series[0].key);

const declined = google.concat([row({ id: 'c', date: '2026-10-06', amt: 50000, who: 'Google', recur: null, recurSrc: 'person' })]);
a = R.analyse(declined, '2026-10-07');
t('a person\'s Không blocks the merchant: no series, no patch', a.series.length === 0 && a.patches.length === 0, a);

const person = [row({ id: 'a', date: '2026-10-01', amt: 1010000, who: 'Gym X', recur: 'monthly', recurSrc: 'person' })];
a = R.analyse(person, '2026-10-07');
t('one person-marked row is a series on its own', a.series.length === 1 && a.series[0].source === 'person' && a.series[0].count === 1, a.series);

console.log('\n-- family rows: note + category key --');
const fam = [
  row({ id: 'f1', date: '2026-08-15', amt: 300000, who: null, note: 'Tiền điện tháng 8', catId: 'cat-utl' }),
  row({ id: 'f2', date: '2026-09-15', amt: 310000, who: null, note: 'Tiền điện tháng 9', catId: 'cat-utl' }),
];
a = R.analyse(fam, '2026-10-01');
t('the same first three words + category form one series', a.series.length === 1 && a.series[0].period === 'monthly', a.series);
t('within 10% tolerance (300k → 310k)', a.patches.length === 1 && a.patches[0].id === 'f2', a.patches);

console.log('\n-- totals and upcoming --');
const mix = [
  { period: 'monthly', perMonth: 50000, soft: false, dueInDays: 5 },
  { period: 'yearly', perMonth: 1200000 / 12, soft: false, dueInDays: 200 },
  { period: 'weekly', perMonth: 20000 * 52 / 12, soft: true, dueInDays: 2 },
];
t('mỗi tháng sums confirmed series only', Math.round(R.monthlyTotal(mix)) === 150000, R.monthlyTotal(mix));
t('upcoming keeps the 30-day horizon (and 3 days of grace behind)', R.upcoming(mix).length === 2, R.upcoming(mix));
t('perMonth for yearly divides by 12, weekly ×52/12', R.perMonth(120000, 'yearly') === 10000 && Math.round(R.perMonth(12000, 'weekly')) === 52000);

if (failed) { console.log('\n' + failed + ' FAILED'); process.exit(1); }
console.log('\nall passed');
