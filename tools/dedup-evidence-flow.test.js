#!/usr/bin/env node
/* Evidence of difference, through the REAL review bucketing.
 * `node tools/dedup-evidence-flow.test.js`
 *
 * tools/dedup-engine.test.js proves the engine's two rules case by case. This
 * drives the actual bucketCsvCandidates (57) in staged mode, with rows shaped
 * like opened bank mail, to prove the two things the engine test cannot:
 *   1. the screen hands the engine what the rules read. The date is the
 *      calendar day with the clock beside it, and counterparty_kind travels
 *      from the opened payload (a field the engine never saw before);
 *   2. a row the engine no longer suspects lands in `ready`, the dated list,
 *      with no duplicate flag on it, and a row it still suspects does not.
 * The reported case (docs/specs/dedup-flaws-review.md Part F): a card purchase
 * at ARTISAN PATINA on the 4th at 18:40, asked about against a GRAB ride on
 * the 1st at 12:38 because both cost 130.000.
 */
// NOT 'use strict': eval'd declarations must land in this scope.
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'js-ui', '57-csv-import-review.js'), 'utf8');
function normDescForDedup(x){ return String(x||'').trim().toLowerCase().replace(/\s+/g,' '); }
function deburr(s){ return String(s||'').normalize('NFD').replace(/[̀-ͯ]/g,''); }
eval(fs.readFileSync(path.join(__dirname, '..', 'src', 'js-ui', '58-dedup-engine.js'), 'utf8'));
var window = { txns: [], DB: { ownerMemberId: 'me' }, csvStagedMode: true };
var curMult = function(){ return 1000; };
var csvStagedMode = true;
const fx = (name) => { const j = src.indexOf('function ' + name); if (j < 0) { console.error(name + ' not found'); process.exit(1); } return src.slice(j, src.indexOf('\n}', j) + 2); };
eval(fx('csvInfoScore'));
eval(fx('parseCsvDateValue'));
eval(fx('_csvDate'));
const bi = src.indexOf('function bucketCsvCandidates');
if (bi < 0) { console.error('bucketCsvCandidates not found'); process.exit(1); }
eval(src.slice(bi, src.indexOf('\n}', src.indexOf('return { ready: ready', bi)) + 2));

// the accessors 72 provides, reduced to what bucketing reads
window.fhStagedRawX = (i) => (window._fhStagedRows[i] || {}).raw_extracted || null;
window.fhStagedMeta = (i) => { const r = window._fhStagedRows[i]; return r ? { provider: r.source_provider, kind: 'bank', dupOfId: '', currency: 'VND', occurredAt: r.occurred_at, pipelineDup: false } : null; };
window.fhStagedKindById = () => '';
function csvRowTime(c){ const r = window._fhStagedRows[c.rowIndex]; return (r && r._clock) || ''; }

let pass = 0, fail = 0;
const t = (n, ok, d) => { console.log((ok ? '  PASS  ' : '  FAIL  ') + n + (!ok && d ? '  -> ' + d : '')); ok ? pass++ : fail++; };

/* One opened mail. `at` is "YYYY-MM-DD HH:MM" local, or a bare day for a bank
   that prints no clock. The candidate's date goes through the app's own date
   parser, so the clock is stripped exactly as the screen strips it. */
const mail = (o) => ({ id: 'm' + Math.random(), source_provider: o.prov || 'VIB', occurred_at: o.at, _clock: o.at.length > 10 ? o.at.slice(11, 16) : '',
  counterparty: o.cp, raw_extracted: Object.assign({ account_kind: o.ak || 'credit_card', transaction_type: 'bank_txn', account_masked: '••4751' }, o.x || {}) });
function review(mails, personal){
  window._fhStagedRows = mails;
  window._fhPersonalMatchSlice = personal || [];
  const cands = mails.map((r, i) => {
    const d = parseCsvDateValue(r.occurred_at, 'iso');
    return { rowIndex: i, description: r.counterparty, _hasDesc: true, counterparty: r.counterparty, amount: r._amt, isIncome: false, isTransfer: false,
      date: d, dateDisplay: d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'), categoryName: 'Khác', flags: [] };
  });
  return bucketCsvCandidates(cands, false);
}
const amt = (m, a) => Object.assign(m, { _amt: a });
const booked = (o) => Object.assign({ id: 'p' + Math.random(), date: o.day, kind: 'expense', amt: o.amtD / 1000, note: o.note, link: null, src: o.src === undefined ? 'direct-email' : o.src, time: o.time || '' });
const grabRide = () => booked({ day: '2026-07-01', amtD: 130000, note: 'Thanh toán GRAB', time: '12:38' });

console.log('\n-- the screen strips the clock from the date, as the rules assume --');
var d0 = parseCsvDateValue('2026-07-04 18:40', 'iso');
t('a staged row\'s date is the calendar day at local midnight', d0 && d0.getHours() === 0 && d0.getMinutes() === 0 && d0.getDate() === 4, String(d0));

console.log('\n-- the reported card: ARTISAN PATINA is not the GRAB ride --');
var r = review([amt(mail({ at: '2026-07-04 18:40', cp: 'ARTISAN PATINA', x: { counterparty_kind: 'merchant' } }), 130000)], [grabRide()]);
t('it lands in the dated list', r.ready.length === 1 && r.possibleDuplicate.length === 0, 'ready=' + r.ready.length + ' dup=' + r.possibleDuplicate.length);
t('with no duplicate flag of any kind on it', r.ready[0] && !r.ready[0]._dupTier && !r.ready[0].duplicateOfExisting && !r.ready[0]._dupWhy);
r = review([amt(mail({ at: '2026-07-04 18:40', cp: 'ARTISAN PATINA' }), 130000)], [grabRide()]);
t('the same for a row sealed before payload v2 (no counterparty_kind)', r.ready.length === 1 && r.possibleDuplicate.length === 0);

console.log('\n-- the posting notice still reaches "Cần bạn xem" --');
r = review([amt(mail({ at: '2026-07-04 11:28', cp: 'Ngân hàng TMCP Quốc tế Việt Nam' }), 130000)], [grabRide()]);
t('a mail naming the bank is still asked about', r.possibleDuplicate.length === 1 && r.possibleDuplicate[0]._dupTier === 'likely' && r.possibleDuplicate[0]._dupWhy === 'card_posting',
  r.possibleDuplicate.length ? r.possibleDuplicate[0]._dupWhy : 'not flagged');
t('and names the booked row as its evidence', r.possibleDuplicate[0] && r.possibleDuplicate[0]._dupTwin && r.possibleDuplicate[0]._dupTwin.note === 'Thanh toán GRAB');
r = review([amt(mail({ at: '2026-07-04 11:28', cp: 'VIB', x: { counterparty_kind: 'bank' } }), 130000)], [grabRide()]);
t('counterparty_kind from the opened payload reaches the engine', r.possibleDuplicate.length === 1 && r.possibleDuplicate[0]._dupWhy === 'card_posting',
  'ready=' + r.ready.length + ' dup=' + r.possibleDuplicate.length);
r = review([amt(mail({ at: '2026-07-04 11:28', cp: 'VIB' }), 130000)], [grabRide()]);
t('without it the bare issuer name is an ordinary row', r.ready.length === 1 && r.possibleDuplicate.length === 0);

console.log('\n-- same day: the clock beside the date decides --');
var lunch = () => booked({ day: '2026-07-04', amtD: 130000, note: 'Thanh toán GRAB', time: '12:38' });
r = review([amt(mail({ at: '2026-07-04 18:40', cp: 'ARTISAN PATINA' }), 130000)], [lunch()]);
t('six hours after a booked email row: dated list', r.ready.length === 1 && r.possibleDuplicate.length === 0);
r = review([amt(mail({ at: '2026-07-04 12:41', cp: 'ARTISAN PATINA' }), 130000)], [lunch()]);
t('three minutes after it: still asked', r.possibleDuplicate.length === 1 && r.possibleDuplicate[0]._dupWhy === 'exact_day');
r = review([amt(mail({ at: '2026-07-04', cp: 'ARTISAN PATINA' }), 130000)], [lunch()]);
t('a date-only bank: still asked', r.possibleDuplicate.length === 1 && r.possibleDuplicate[0]._dupWhy === 'exact_day');
r = review([amt(mail({ at: '2026-07-04 18:40', cp: 'ARTISAN PATINA' }), 130000)], [booked({ day: '2026-07-04', amtD: 130000, note: 'ăn trưa', time: '12:38', src: null })]);
t('against a hand-typed row: still asked', r.possibleDuplicate.length === 1 && r.possibleDuplicate[0]._dupWhy === 'exact_day');

console.log('\n-- a fact stays a fact --');
r = review([amt(mail({ at: '2026-07-04 18:40', cp: 'GRAB' }), 130000)], [lunch()]);
t('same day, same merchant word, hours apart: "Đã có trong sổ"', r.possibleDuplicate.length === 1 && r.possibleDuplicate[0]._dupTier === 'sure');

console.log('\n-- a week of new card purchases beside a booked month --');
var month = [], names = ['GRAB', 'HIGHLANDS COFFEE', 'CIRCLE K', 'PHUC LONG', 'WINMART', 'KATINAT'];
for (var dd = 1; dd <= 28; dd++) month.push(booked({ day: '2026-06-' + String(dd).padStart(2, '0'), amtD: [45000, 59000, 130000][dd % 3], note: names[dd % 6], time: String(8 + dd % 12).padStart(2, '0') + ':15' }));
var week = [];
for (var w = 26; w <= 30; w++) week.push(amt(mail({ at: '2026-06-' + w + ' ' + String(9 + w % 9).padStart(2, '0') + ':40', cp: names[(w + 3) % 6] }), [45000, 59000, 130000][(w + 1) % 3]));
r = review(week, month);
t('five new purchases at habitual prices: none is asked about', r.ready.length === 5 && r.possibleDuplicate.length === 0, 'ready=' + r.ready.length + ' dup=' + r.possibleDuplicate.length + ' ' + r.possibleDuplicate.map(function(c){ return c._dupWhy; }).join(','));

console.log('\n' + (fail === 0 ? 'ALL ' + pass + ' PASSED' : pass + ' passed, ' + fail + ' FAILED'));
process.exit(fail ? 1 : 0);
