/* recurring-charges-spec.md §18.10 — detection v2, in isolation. Runs the real
   src/js-data/29-recur.js in a vm with a bare window.

   The fixtures are the ones docs/incidents/2026-10-06-recurring-detection.md
   was written about: a coffee shop visited seven times in five weeks, rent
   whose wording and category change, and the five-week window the v1 engine
   was handed at boot. v1's own tests had none of these and all passed. */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'js-data', '29-recur.js'), 'utf8');
const window = {};
vm.runInNewContext(src, { window, Date, Math, String, Number, Object, Array, Map, Set, isFinite, console });
const R = window.FH_RECUR;

let failed = 0, passed = 0;
function t(name, ok, detail) {
  console.log((ok ? '  PASS  ' : '  FAIL  ') + name + (ok ? '' : '  -> ' + JSON.stringify(detail)));
  if (ok) passed++; else failed++;
}
let _n = 0;
const row = (date, amt, o) => Object.assign({ id: 'r' + (++_n), date, amt, payee: null, note: '', node: null, kind: 'expense',
  recur: null, recurSrc: null, rcPeriod: null, recurSig: null, renewsOn: null }, o || {});
const brief = (v) => v.series.map((s) => ({ g: s.groupKey, p: s.period, src: s.source, soft: s.soft, n: s.inCadence, next: s.next, lapsed: s.lapsed }));

/* The short list of recurring leaves, as FH_TAX.recursOf answers it. */
const LEAVES = { rentpay: { period: 'monthly' }, electric: { period: 'monthly', variable: true }, streaming: { period: 'monthly' },
  software: { period: 'monthly' }, insurance: { period: 'yearly', variable: true } };
const prior = (node) => (node && LEAVES[node]) ? Object.assign({ code: node }, LEAVES[node]) : null;
const TODAY = '2026-10-07';
const an = (rows, opts, today) => R.analyse(rows, today || TODAY, Object.assign({ prior }, opts || {}));

console.log('\n-- windows --');
t('6..8 days is weekly', R.periodOf(6) === 'weekly' && R.periodOf(8) === 'weekly' && R.periodOf(9) === null);
t('25..37 days is monthly (paid on the 1st, then on the 7th)', R.periodOf(25) === 'monthly' && R.periodOf(37) === 'monthly' && R.periodOf(24) === null && R.periodOf(38) === null);
t('350..380 days is yearly', R.periodOf(350) === 'yearly' && R.periodOf(380) === 'yearly' && R.periodOf(349) === null);

console.log('\n-- next date, creep --');
t('monthly from 31 Jan clamps to 28 Feb', R.addPeriod('2026-01-31', 'monthly') === '2026-02-28');
t('yearly over a leap day', R.addPeriod('2028-02-29', 'yearly') === '2029-02-28');
t('a stated renew date wins when it is after the charge', R.nextDate('2026-10-06', 'monthly', '2026-11-09') === '2026-11-09');
t('…and is ignored when it is not', R.nextDate('2026-10-06', 'monthly', '2026-07-17') === '2026-11-06');
t('4.9% above is noise, 5.1% is creep', R.creep(104900, 100000) === 0 && R.creep(105100, 100000) === 5100);

console.log('\n-- INCIDENT 1: the coffee shop (seven visits, one pair a week apart) --');
const cafeDates = ['2026-09-02', '2026-09-04', '2026-09-05', '2026-09-09', '2026-09-10', '2026-09-10', '2026-09-17'];
const cafe = cafeDates.map((d) => row(d, 60, { payee: 'REVI PHU MY HUNG TOWER', note: 'REVI PHU MY HUNG TOWER', node: 'coffee' }));
let v = an(cafe);
t('no series: five of six gaps are shorter than a week', v.series.length === 0, brief(v));
t('nothing to write', v.patches.length === 0, v.patches);
cafe[6].recur = 'weekly'; cafe[6].recurSrc = 'pattern';      // the mark v1 wrote on 2026-09-17
v = an(cafe);
t('the stored v1 mark does NOT anchor the merchant', v.series.length === 0, brief(v));
t('…and is cleared by the pass', v.patches.length === 1 && v.patches[0].id === cafe[6].id && v.patches[0].recur === null && v.patches[0].src === null, v.patches);
cafe[6].recur = null; cafe[6].recurSrc = null;
const sat = ['2026-08-29', '2026-09-05', '2026-09-12', '2026-09-19'].map((d) => row(d, 60, { payee: 'Saturday Cafe' }));
v = an(sat);
t('a habit that really is weekly needs FOUR charges to be even a guess', v.series.length === 1 && v.series[0].period === 'weekly' && v.series[0].soft === true, brief(v));
t('three weekly charges are nothing', an(sat.slice(0, 3)).series.length === 0);

console.log('\n-- INCIDENT 2: the window --');
const ant = ['2026-06-18', '2026-07-18', '2026-08-18', '2026-09-18'].map((d) => row(d, 2970, { payee: 'ANTHROPIC* CLAUDE SUB', note: 'ANTHROPIC* CLAUDE SUB [111.11 USD @25,949 +3% est.]', node: 'software' }));
t('through a five-week window (v1): one charge, no series', an(ant.filter((r) => r.date >= '2026-09-01')).series.length === 0);
v = an(ant);
t('through the slice: monthly, four in cadence, confirmed', v.series.length === 1 && v.series[0].period === 'monthly' && v.series[0].inCadence === 4 && v.series[0].soft === false, brief(v));
t('next charge 18 Oct, eleven days out', v.series[0].next === '2026-10-18' && v.series[0].dueInDays === 11, v.series[0]);
t('the latest row is written as pattern, once', v.patches.length === 1 && v.patches[0].id === ant[3].id && v.patches[0].src === 'pattern', v.patches);

console.log('\n-- INCIDENT 3: rent, new wording, another category --');
const rentP = [row('2026-08-05', 7500, { payee: 'NGUYEN VAN QUANG', note: 'Em gui tien nha. Cam on anh Quang.', node: 'rentpay' }),
  row('2026-09-06', 7500, { payee: 'NGUYEN VAN QUANG', note: 'Em gui tien nha. Cam on a Quang.', node: 'rentpay' }),
  row('2026-10-06', 7500, { payee: 'NGUYEN VAN QUANG', note: 'Em chuyen tien nha. Cam on anh Quang.', node: null })];
v = an(rentP);
t('with a payee: one series whatever the note says', v.series.length === 1 && v.series[0].groupKey === 'p|nguyen van quang' && v.series[0].inCadence === 3, brief(v));
const rentN = rentP.map((r, i) => Object.assign({}, r, { id: 'rn' + i, payee: null, node: 'rentpay' }));
v = an(rentN);
t('without a payee: the note splits them, the LEAF gathers them (pass B)', v.series.length === 1 && v.series[0].groupKey === 'k|rentpay' && v.series[0].inCadence === 3, brief(v));
t('the category is in no key', R.primaryKey({ payee: 'X Y Z', cat: 'A' }) === R.primaryKey({ payee: 'x y z', cat: 'B' }));
v = an(rentP.slice(0, 2));
t('two charges on a recurring leaf are a GUESS (the leaf lowers the bar by one)', v.series.length === 1 && v.series[0].soft === true && v.patches.length === 0, brief(v));
const rentJul = row('2026-07-05', 7500, { payee: 'NGUYEN VAN QUANG', note: 'Em gui tien nha', node: 'rentpay' });
v = an([rentJul].concat(rentP.slice(0, 2)));
t('three on a leaf are fact', v.series.length === 1 && v.series[0].soft === false && v.patches.length === 1, brief(v));
const twoVendors = [row('2026-08-10', 300, { payee: 'CANVA', node: 'software' }), row('2026-09-09', 250, { payee: 'NOTION', node: 'software' })];
t('two purchases from two vendors on one leaf are NOT gathered by the leaf', an(twoVendors).series.length === 0, brief(an(twoVendors)));
const rentals = [row('2026-08-02', 49, { payee: 'APPLE.COM/BILL', node: 'streaming' }), row('2026-09-01', 49, { payee: 'APPLE.COM/BILL', node: 'streaming' })];
v = an(rentals);
t('two film rentals a month apart on the streaming leaf: a guess at most, never fact', v.series.every((x) => x.soft) && R.monthlyTotal(v.series) === 0, brief(v));
const bare = rentP.map((r, i) => Object.assign({}, r, { id: 'rx' + i, node: null }));
t('two charges on NO leaf are nothing (any shop visited twice does that)', an(bare.slice(0, 2)).series.length === 0, brief(an(bare.slice(0, 2))));
v = an(bare);
t('three are a guess, nothing written', v.series.length === 1 && v.series[0].soft === true && v.patches.length === 0, brief(v));
v = an(bare.concat([Object.assign({}, bare[2], { id: 'rx3', date: '2026-11-05' })]), null, '2026-11-06');
t('four are fact', v.series.length === 1 && v.series[0].soft === false && v.patches.length === 1, brief(v));

console.log('\n-- softness counts charges in cadence, never rows --');
const mixed = [row('2026-07-01', 100, { payee: 'Shop' }), row('2026-07-03', 100, { payee: 'Shop' }), row('2026-07-04', 100, { payee: 'Shop' }),
  row('2026-07-20', 100, { payee: 'Shop' }), row('2026-08-19', 100, { payee: 'Shop' })];
t('five rows with one monthly pair among short gaps: no series', an(mixed).series.length === 0, brief(an(mixed)));

console.log('\n-- one payee, two subscriptions --');
const apple = [];
['2026-06-16', '2026-07-16', '2026-08-16', '2026-09-16'].forEach((d) => apple.push(row(d, 105, { payee: 'APPLE.COM/BILL', node: 'streaming' })));
['2026-06-20', '2026-07-20', '2026-08-20', '2026-09-20'].forEach((d) => apple.push(row(d, 19, { payee: 'APPLE.COM/BILL', node: 'streaming' })));
apple.push(row('2026-08-02', 49, { payee: 'APPLE.COM/BILL', node: 'streaming' }));   // a one-off rental
v = an(apple);
t('split by amount first: two series, the rental in neither', v.series.length === 2 && v.series.every((s) => s.period === 'monthly' && s.inCadence === 4), brief(v));
t('the rental is not in any series', !v.byRow.has(apple[8].id));

console.log('\n-- a bill whose amount moves --');
const elec = [['2026-06-12', 410], ['2026-07-11', 690], ['2026-08-12', 720], ['2026-09-11', 430]].map((x) => row(x[0], x[1], { payee: 'EVN HCMC', node: 'electric' }));
v = an(elec);
t('a 40% swing on a recurs_var leaf stays one series', v.series.length === 1 && v.series[0].inCadence === 4 && v.series[0].variable === true, brief(v));
v = an(elec.map((r, i) => Object.assign({}, r, { id: 'ev' + i, node: null })));
t('the same swing with no leaf does not', v.series.length === 0 || v.series.every((s) => s.inCadence < 4), brief(v));

console.log('\n-- skip, lapse, creep, yearly --');
const skip = ['2026-05-06', '2026-06-06', '2026-08-06', '2026-09-06'].map((d) => row(d, 50, { payee: 'Google' }));
v = an(skip);
t('one missed month does not break the series (three in cadence: a guess off a leaf)', v.series.length === 1 && v.series[0].period === 'monthly' && v.series[0].inCadence === 3 && v.series[0].soft === true, brief(v));
const gone = ['2026-01-06', '2026-02-06', '2026-03-06', '2026-04-06'].map((d) => row(d, 50, { payee: 'Old Sub' }));
v = an(gone);
t('a series that stopped is lapsed: out of the tile and the total', v.series.length === 1 && v.series[0].lapsed === true && R.live(v.series).length === 0 && R.monthlyTotal(v.series) === 0, brief(v));
t('…but its rows still belong to it', v.byRow.has(gone[0].id));
const up = ['2026-07-12', '2026-08-12', '2026-09-12'].map((d, i) => row(d, i === 2 ? 220 : 180, { payee: 'Netflix' }));
v = an(up);
t('a 22% rise stays in the series and is reported as creep', v.series.length === 1 && v.series[0].creep === 40, v.series[0] && v.series[0].creep);
const yr = [row('2025-10-10', 5000, { payee: 'Capture One' }), row('2026-10-01', 5000, { payee: 'Capture One' })];
v = an(yr);
t('two charges a year apart: yearly, a guess', v.series.length === 1 && v.series[0].period === 'yearly' && v.series[0].soft === true && v.series[0].next === '2027-10-01', brief(v));

console.log('\n-- the person, the receipt, the lesson --');
const g1 = [row('2026-09-06', 50, { payee: 'Google', recur: 'monthly', recurSrc: 'person' })];
v = an(g1);
t('one person-marked row is a series on its own', v.series.length === 1 && v.series[0].source === 'person' && v.series[0].soft === false, brief(v));
const no = ant.map((r, i) => Object.assign({}, r, { id: 'no' + i }));
no[3].recurSrc = 'person'; no[3].recur = null;
v = an(no);
t("Không on the latest row blocks the cluster: no series, a block recorded", v.series.length === 0 && v.blocked.length === 1, brief(v));
no[1].recurSrc = 'person'; no[1].recur = 'monthly'; no[3].recurSrc = null;
t('a person mark is never overwritten by the pass', an(no).patches.every((p) => p.id !== no[1].id), an(no).patches);
const yt = [row('2026-09-16', 105, { payee: 'APPLE.COM/BILL', rcPeriod: 'monthly', recurSig: 'sub|youtube|youtube premium' })];
v = an(yt);
t('a receipt that reads a period anchors a series at one charge', v.series.length === 1 && v.series[0].source === 'receipt', brief(v));
t('the series is named by the receipt\'s own label when the row carries one', an([row('2026-09-16', 105, { payee: 'APPLE.COM/BILL', rcPeriod: 'monthly', rcLabel: 'YouTube Premium' })]).series[0].product === 'YouTube Premium');
t('…and the row is written as receipt', v.patches.length === 1 && v.patches[0].src === 'receipt' && v.patches[0].recur === 'monthly', v.patches);
const lessonOf = (k) => (k === 'p|gym x' ? { period: 'monthly', source: 'person', amt: 1010 } : null);
v = an([row('2026-10-01', 1010, { payee: 'Gym X' })], { lesson: lessonOf });
t('a lesson anchors the merchant at one charge', v.series.length === 1 && v.series[0].source === 'lesson', brief(v));
v = an([row('2026-10-01', 200, { payee: 'Gym X' })], { lesson: lessonOf });
t('…but only for the amount it was taught about', v.series.length === 0, brief(v));

console.log('\n-- receipts (§18.5) --');
t('the reader\'s period key', R.receiptMeta({ period: 'month', items: [] }).period === 'monthly' && R.receiptMeta({ period: 'year' }).period === 'yearly');
let m = R.receiptMeta({ service_type: 'digital', items: [{ name: 'YouTube Premium (Monthly)', variant: 'Renews 17 July 2026 · iPhone', sig: 'apple|vendor|youtube' }] });
t('a receipt read before the period key existed: wording decides', m.period === 'monthly', m);
t('…and the renew date is read', m.renewsOn === '2026-07-17', m);
t('…and the label is the item\'s own name without its "(Monthly)" tail', m.label === 'YouTube Premium', m.label);
t('a plain order gets no label (a basket has no name)', R.receiptMeta({ service_type: 'goods', items: [{ name: 'Kính bơi' }, { name: 'Mũ bơi' }] }).label === null);
m = R.receiptMeta({ period: 'month', items: [{ name: '100 GB (Google One)', variant: 'Auto-renewing subscription', sig: 'sub|google|google one' }] });
t('the signature rides', m.sig === 'sub|google|google one' && m.period === 'monthly', m);
t('yearly wording beats monthly wording', R.receiptMeta({ items: [{ name: 'Capture One Pro - Annual Subscription' }] }).period === 'yearly');
t('a plain order has no period', R.receiptMeta({ service_type: 'goods', items: [{ name: 'Kính bơi', variant: 'Đen' }] }).period === null);
t('no blob, no crash', R.receiptMeta(null).period === null);

console.log('\n-- the queue card (§18.8) --');
const view = an([rentJul].concat(rentP.slice(0, 2), ant));
let c = R.matchCandidate(view, { payee: 'Nguyen Van Quang', note: 'Em chuyen tien nha', amt: 7500, node: 'rentpay', date: '2026-10-06' }, { prior });
t("October's rent continues the ledger's series", c && c.period === 'monthly' && c.source === 'series' && c.soft === false, c);
c = R.matchCandidate(view, { payee: 'Nguyen Van Quang', note: 'tra tien an', amt: 300, node: null, date: '2026-10-06' }, { prior });
t('the same payee, another amount: not the series', c === null, c);
c = R.matchCandidate(view, { payee: 'Nguyen Van Quang', note: 'x', amt: 7500, node: null, date: '2026-09-20' }, { prior });
t('the same payee and amount two weeks off cadence: not the series', c === null, c);
c = R.matchCandidate(view, { payee: 'New Landlord', note: 'tien nha', amt: 9000, node: 'rentpay', date: '2026-10-06' }, { prior });
t('a first charge on a recurring leaf: the hint, soft', c && c.source === 'prior' && c.soft === true && c.period === 'monthly', c);
c = R.matchCandidate(view, { payee: 'Highlands', note: 'ca phe', amt: 55, node: 'coffee', date: '2026-10-06' }, { prior });
t('an ordinary purchase: nothing', c === null, c);
const noView = an(no.map((r, i) => Object.assign({}, r, { id: 'q' + i, recurSrc: i === 3 ? 'person' : null, recur: null })));
c = R.matchCandidate(noView, { payee: 'ANTHROPIC* CLAUDE SUB', note: '', amt: 2970, node: 'software', date: '2026-10-18' }, { prior });
t('a declined cluster answers Không, and the leaf hint stays quiet', c && c.period === null && c.source === 'person', c);

console.log('\n-- totals --');
const tot = an(ant.concat(sat, yr));
t('mỗi tháng sums confirmed, live series only', Math.round(R.monthlyTotal(tot.series)) === 2970, R.monthlyTotal(tot.series));
t('upcoming is confirmed series due inside the horizon', R.upcoming(tot.series).length === 1 && R.upcoming(tot.series)[0].groupKey === 'p|anthropic claude sub', R.upcoming(tot.series).map((s) => s.groupKey));
t('perMonth: yearly /12, weekly ×52/12', R.perMonth(120000, 'yearly') === 10000 && Math.round(R.perMonth(12000, 'weekly')) === 52000);

console.log('\n-- upcoming is THIS MONTH (RR20) --');
{
  const mk = (next, amt, soft) => ({ next, amount: amt, soft: !!soft, lapsed: false, dueInDays: Math.round((Date.UTC(+next.slice(0, 4), +next.slice(5, 7) - 1, +next.slice(8, 10)) - Date.UTC(2026, 9, 7)) / 86400000) });
  const S = [mk('2026-10-18', 2970), mk('2026-10-20', 88), mk('2026-11-05', 50), mk('2026-11-06', 7500), mk('2027-01-25', 475), mk('2026-10-28', 14, true)];
  let u = R.upcomingMonth(S, '2026-10-07');
  t('on 7 Oct: the two charges still due in October, and their sum', u.items.length === 2 && u.total === 3058 && u.isNext === false && u.month === 10, u);
  t('a guess is not an upcoming payment', !u.items.some((s) => s.soft));
  // After the October charges were paid their series' `next` moved to November.
  const paid = S.map((x) => (x.next.slice(0, 7) === '2026-10' && !x.soft) ? Object.assign({}, x, { next: x.next.replace('2026-10', '2026-11') }) : x);
  u = R.upcomingMonth(paid, '2026-10-21');
  t('after the last October charge: November\'s, and says so', u.items.length === 4 && u.isNext === true && u.month === 11 && u.total === 10608, u);
  u = R.upcomingMonth(S, '2026-10-21');
  t('a charge still expected this month and not seen stays listed (dự kiến), the month does not roll', u.isNext === false && u.items.length === 2, u);
  u = R.upcomingMonth([mk('2026-12-31', 10)], '2026-12-30');
  t('December rolls into January of next year', R.upcomingMonth([mk('2027-01-02', 10)], '2026-12-30').isNext === true && R.upcomingMonth([mk('2027-01-02', 10)], '2026-12-30').year === 2027);
  t('a charge expected a day or two ago still counts as this month\'s', R.upcomingMonth([mk('2026-10-05', 7500)], '2026-10-07').items.length === 1);
}

console.log('\n-- pass C: hand-typed rows, same amount --');
const typed = ['2026-07-05', '2026-08-05', '2026-09-05'].map((d, i) => row(d, 500, { note: ['tien hoc', 'hoc phi be', 'dong hoc'][i] }));
v = an(typed, { prior: () => null });
t('three charges, every gap monthly: a series, soft by rule', v.series.length === 1 && v.series[0].pass === 'C' && v.series[0].soft === true, brief(v));
v = an(typed.slice(0, 2), { prior: () => null });
t('two is not enough for pass C', v.series.length === 0, brief(v));

if (failed) { console.log('\n' + failed + ' FAILED, ' + passed + ' passed'); process.exit(1); }
console.log('\nall ' + passed + ' passed');
