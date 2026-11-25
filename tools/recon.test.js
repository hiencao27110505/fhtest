#!/usr/bin/env node
/* The reconcile matcher (src/js-ui/58-recon.js), rule by rule, on synthetic
 * rows only. docs/specs/reconcile-spec.md Part 3, §10, R11 to R20.
 * `node tools/recon.test.js`
 *
 * Every pairing rule is run in BOTH arrival orders: copy A booked and copy B
 * arriving, then B booked and A arriving (R10: which arrived first does not
 * matter). Rows a person typed by hand never arrive in the queue, so the
 * rounded-amount rule has one order only. The shapes are the measured ones of
 * §2 and §3, with invented values.
 *
 * The last part drives the real bucketCsvCandidates (57) the way
 * tools/dedup-evidence-flow.test.js does, and proves that 'shadow' changes no
 * bucket and keeps nothing but numbers.
 */
// NOT 'use strict': eval'd declarations must land in this scope.
const fs = require('fs');
const path = require('path');
var window = { txns: [], DB: { ownerMemberId: 'me' } };
var curMult = function(){ return 1000; };
var _ls = {};
var localStorage = { getItem: (k) => (k in _ls ? _ls[k] : null), setItem: (k, v) => { _ls[k] = String(v); }, removeItem: (k) => { delete _ls[k]; } };
eval(fs.readFileSync(path.join(__dirname, '..', 'src', 'js-ui', '58-dedup-engine.js'), 'utf8'));
eval(fs.readFileSync(path.join(__dirname, '..', 'src', 'js-ui', '58-recon.js'), 'utf8'));

let pass = 0, fail = 0;
const t = (n, ok, d) => { console.log((ok ? '  PASS  ' : '  FAIL  ') + n + (!ok && d !== undefined ? '  -> ' + JSON.stringify(d) : '')); ok ? pass++ : fail++; };
const show = (v) => v ? { tier: v.tier, why: v.why, dayShift: v.dayShift, twinKind: v.twinKind } : null;

/* ONE COPY of a money event, described once and turned into either side.
     day 'YYYY-MM-DD', time 'HH:MM' | '' (day-only), amt (đồng), dir 'out'|'in',
     text, acct (owned account id | null), lane, prov, kind (how it is booked),
     ref, src (ledger source; null = typed by hand), shape. */
let seq = 0;
const SIGN = { expense: { out: 1, in: -1 }, income: { in: 1, out: -1 }, transfer: { out: -1, in: 1 },
               loan: { out: 1, in: -1 }, repayment: { in: 1, out: -1 }, investment: { out: -1, in: 1 } };
function booked(c){
  const kind = c.kind || (c.dir === 'in' ? 'income' : 'expense');
  const src = c.src !== undefined ? c.src : (c.lane === 'statement' ? 'statement-email' : 'direct-email');
  return { id: 'b' + (++seq), date: c.day, kind: kind, amt: SIGN[kind][c.dir] * c.amt / 1000, note: c.text || '', link: null,
           src: src, time: c.time || '', acct: c.acct || null, who: c.who || null,
           refs: c.ref ? [{ k: (c.prov || 'VIB').toLowerCase(), v: c.ref }] : undefined };
}
function arriving(c){
  const xfer = c.kind && c.kind !== 'expense' && c.kind !== 'income';
  return { amount: c.amt, date: new Date(c.day + 'T00:00:00'), dateDisplay: c.day, time: c.time || '',
           timePrecision: c.time ? 'minute' : 'day', description: c.text || '', counterparty: c.cp || '',
           isIncome: c.dir === 'in' && !xfer, isTransfer: !!xfer, accountKind: c.ak || null,
           provider: c.prov || 'VIB', kind: c.senderKind || 'bank', currency: 'VND', shape: c.shape || 'bank_txn',
           statement: c.lane === 'statement', lane: c.lane || 'alert', dir: c.dir, acctId: c.acct || null,
           ref: c.ref || '', acctProviderKey: (c.prov || 'VIB').toLowerCase(), refundWorded: !!c.refund,
           pipelineDupOf: c.pipe || '' };
}
function run(cands, personal, opts, family){
  window.txns = family || []; window._fhPersonalMatchSlice = personal || [];
  return fhReconAssess(cands, fhDedupLedgerIndex(), opts);
}
function oldRun(cands, personal){
  window.txns = []; window._fhPersonalMatchSlice = personal || [];
  return fhDedupAssess(cands, fhDedupLedgerIndex(), {});
}
/* Both orders: A booked + B arriving, then B booked + A arriving. */
function both(name, A, B, check){
  var v1 = run([arriving(B)], [booked(A)])[0];
  t(name + ' [A booked, B arrives]', check(v1, 1), show(v1));
  var v2 = run([arriving(A)], [booked(B)])[0];
  t(name + ' [B booked, A arrives]', check(v2, -1), show(v2));
}
const is = (tier, why, shift) => (v, sgn) => !!v && v.tier === tier && (!why || v.why === why) && (shift === undefined || v.dayShift === shift * sgn);
const none = (v) => !v;

console.log('\n-- §3 card purchase: the statement dates it the day BEFORE the 00:25 alert --');
both('same card, merchant word, one day apart: sure acct_text',
  { day: '2026-10-06', time: '00:25', amt: 259000, dir: 'out', text: 'SHOPEE ONLINE', acct: 'card', lane: 'alert' },
  { day: '2026-10-05', amt: 259000, dir: 'out', text: 'SHOPEE', acct: 'card', lane: 'statement' },
  is('sure', 'acct_text', -1));

console.log('\n-- §3 account movement: the 22:35 transfer is on the NEXT day of the statement, memo identical --');
// Every word of this memo is a stop word or a number, so only the memo rule can see it.
both('same account, identical memo, next day: sure acct_text',
  { day: '2026-10-10', time: '22:35', amt: 1500000, dir: 'out', text: 'CHUYEN TIEN 0912345678', acct: 'dep', lane: 'alert', kind: 'transfer' },
  { day: '2026-10-11', amt: 1500000, dir: 'out', text: 'CHUYEN TIEN 0912345678', acct: 'dep', lane: 'statement' },
  is('sure', 'acct_text', 1));

console.log('\n-- R12: two days apart is not a candidate --');
both('alert at 14:00, statement row two days later: nothing',
  { day: '2026-10-10', time: '14:00', amt: 330000, dir: 'out', text: 'WINMART', acct: 'card', lane: 'alert' },
  { day: '2026-10-12', amt: 330000, dir: 'out', text: 'WINMART', acct: 'card', lane: 'statement' }, none);

console.log('\n-- R14: a card repayment, booked as a transfer on the deposit account --');
var repA = { day: '2026-10-15', time: '09:12', amt: 8400000, dir: 'out', text: 'THANH TOAN THE TIN DUNG 4321', acct: 'dep', lane: 'alert', kind: 'transfer' };
var repB = { day: '2026-10-15', amt: 8400000, dir: 'out', text: 'TT THE TD', acct: 'dep', lane: 'statement', kind: 'transfer' };
both('the deposit statement\'s debit row: sure (the only such row on the account)', repA, repB, is('sure', 'acct_unique', 0));
t('the old engine says nothing about it (its isTransfer early return)', !oldRun([arriving(repB)], [booked(repA)])[0]);

console.log('\n-- R11: a transfer to the person\'s own other account, booked as a transfer pair --');
var outLeg = { day: '2026-10-16', time: '10:00', amt: 5000000, dir: 'out', text: 'CHUYEN SANG TK TIET KIEM', acct: 'dep', lane: 'alert', kind: 'transfer' };
var inLeg = { day: '2026-10-16', time: '10:00', amt: 5000000, dir: 'in', text: 'CHUYEN SANG TK TIET KIEM', acct: 'sav', lane: 'alert', kind: 'transfer' };
var depRow = { day: '2026-10-16', amt: 5000000, dir: 'out', text: 'IB CHUYEN TIEN', acct: 'dep', lane: 'statement' };
var vOwn = run([arriving(depRow)], [booked(outLeg), booked(inLeg)])[0];
t('the deposit statement row pairs with the OUT leg', vOwn && vOwn.tier === 'sure' && vOwn.twin.acct === 'dep' && vOwn.twin.dir === 'out', show(vOwn));
var savRow = { day: '2026-10-16', amt: 5000000, dir: 'in', text: 'NHAN TIEN', acct: 'sav', lane: 'statement' };
var vSav = run([arriving(savRow)], [booked(outLeg), booked(inLeg)])[0];
t('the savings statement row pairs with the IN leg', vSav && vSav.twin.acct === 'sav' && vSav.twin.dir === 'in', show(vSav));
both('own transfer, either order', outLeg, depRow, (v) => !!v && v.tier === 'sure');

console.log('\n-- R11: a booked LOAN and the statement\'s expense row the next day --');
both('loan at 22:11, expense row of the same amount next day, same account: matched',
  { day: '2026-10-20', time: '22:11', amt: 2000000, dir: 'out', text: 'CHO MUON', acct: 'dep', lane: 'alert', kind: 'loan' },
  { day: '2026-10-21', amt: 2000000, dir: 'out', text: 'IB 77665544', acct: 'dep', lane: 'statement' },
  is('sure', 'acct_unique', 1));
var borrowed = booked({ day: '2026-10-20', amt: 2000000, dir: 'in', text: 'VAY', acct: 'dep', kind: 'loan' });
t('a loan BORROWED is money in (stored -X): its direction is read from the sign', fhDedupLedgerIndex && (function(){ window.txns = []; window._fhPersonalMatchSlice = [borrowed]; return fhDedupLedgerIndex().rows[0].dir === 'in'; })());

console.log('\n-- R16: two equal purchases at one merchant on one day --');
var hl1 = { day: '2026-10-22', time: '08:10', amt: 65000, dir: 'out', text: 'HIGHLANDS COFFEE', acct: 'card', lane: 'alert' };
var hl2 = { day: '2026-10-22', time: '15:30', amt: 65000, dir: 'out', text: 'HIGHLANDS COFFEE', acct: 'card', lane: 'alert' };
var hs = () => arriving({ day: '2026-10-22', amt: 65000, dir: 'out', text: 'HIGHLANDS COFFEE PMH', acct: 'card', lane: 'statement' });
var v2 = run([hs(), hs()], [booked(hl1), booked(hl2)]);
t('two statement rows against two booked alerts: both sure', v2[0] && v2[1] && v2[0].tier === 'sure' && v2[1].tier === 'sure', v2.map(show));
t('pairing is one-to-one (two different booked rows)', v2[0] && v2[1] && v2[0].twin !== v2[1].twin);
t('neither asks (no likely)', v2.every((v) => v && v.tier !== 'likely'));
var v3 = run([hs(), hs(), hs()], [booked(hl1), booked(hl2)]);
t('three statement rows: two pair off', v3.filter((v) => v && v.tier === 'sure').length === 2, v3.map(show));
t('the third is not flagged sure', !v3[2] || v3[2].tier !== 'sure', show(v3[2]));
var hsB = { day: '2026-10-22', amt: 65000, dir: 'out', text: 'HIGHLANDS COFFEE PMH', acct: 'card', lane: 'statement' };
var w2 = run([arriving(hl1), arriving(hl2)], [booked(hsB), booked(hsB)]);
t('the other order: two alerts against two booked statement rows, both sure, distinct', w2[0] && w2[1] && w2[0].tier === 'sure' && w2[1].tier === 'sure' && w2[0].twin !== w2[1].twin, w2.map(show));
var hl3 = { day: '2026-10-22', time: '19:05', amt: 65000, dir: 'out', text: 'HIGHLANDS COFFEE', acct: 'card', lane: 'alert' };
var w3 = run([arriving(hl1), arriving(hl2), arriving(hl3)], [booked(hsB), booked(hsB)]);
t('three alerts against two booked statement rows: the third is not sure', w3.filter((v) => v && v.tier === 'sure').length === 2 && (!w3[2] || w3[2].tier !== 'sure'), w3.map(show));

console.log('\n-- R15 / Part 6: eleven wallet rows of one amount within two minutes --');
var wal = [];
for (var wi = 0; wi < 11; wi++) wal.push(arriving({ day: '2026-10-23', time: '12:0' + (wi % 2), amt: 20000, dir: 'out', text: 'MOMO ' + wi, acct: 'momo', lane: 'wallet', prov: 'MoMo', shape: 'ecommerce_receipt', senderKind: 'other' }));
var vw = run(wal, [booked({ day: '2026-10-23', amt: 20000, dir: 'out', text: 'an vat', acct: 'momo', src: 'direct-email' })]);
t('never sure', vw.every((v) => !v || v.tier !== 'sure'), vw.map(show));
t('the booked row explains one of them (likely), not eleven', vw.filter((v) => v && v.twinKind === 'ledger').length === 1);
vw = run(wal, [booked({ day: '2026-10-23', amt: 20000, dir: 'out', text: 'an vat', acct: null, src: 'file-import' })]);
t('against a booked row with no account: still never sure', vw.every((v) => !v || v.tier !== 'sure'), vw.map(show));
var oneWal = run([wal[0]], [booked({ day: '2026-10-23', amt: 350000 / 1, dir: 'out', text: 'x', acct: null, src: 'file-import' })])[0];
t('a unique wallet row is not sure on uniqueness either (wallet lane)', !oneWal || oneWal.tier !== 'sure', show(oneWal));
var walLedger = []; for (var wj = 0; wj < 11; wj++) walLedger.push(booked({ day: '2026-10-23', time: '12:00', amt: 20000, dir: 'out', text: 'MOMO', acct: 'momo', lane: 'wallet', src: 'direct-email' }));
var vwr = run([arriving({ day: '2026-10-23', amt: 20000, dir: 'out', text: 'THANH TOAN', acct: 'momo', lane: 'wallet', prov: 'MoMo' })], walLedger)[0];
t('the other order: one wallet row against eleven booked: likely at most', !vwr || vwr.tier === 'likely', show(vwr));

console.log('\n-- same source ID --');
both('the same wallet transaction id, nothing else in common: sure same_ref',
  { day: '2026-10-24', time: '09:00', amt: 120000, dir: 'out', text: 'GRAB', acct: 'momo', lane: 'wallet', prov: 'MoMo', ref: 'MM12345678' },
  { day: '2026-10-24', time: '13:30', amt: 120000, dir: 'out', text: 'THANH TOAN DICH VU', acct: null, lane: 'wallet', prov: 'MoMo', ref: 'MM 1234 5678' },
  is('sure', 'same_ref', 0));
both('different ids of the same kind, same words, same minute: two events',
  { day: '2026-10-24', time: '09:00', amt: 120000, dir: 'out', text: 'GRAB', acct: 'momo', lane: 'wallet', prov: 'MoMo', ref: 'MM111' },
  { day: '2026-10-24', time: '09:00', amt: 120000, dir: 'out', text: 'GRAB', acct: 'momo', lane: 'wallet', prov: 'MoMo', ref: 'MM222' }, none);
var qMail = arriving({ day: '2026-10-24', time: '09:00', amt: 120000, dir: 'out', text: 'GRAB', acct: 'momo', lane: 'wallet', prov: 'MoMo', ref: 'MM999' });
var qHist = arriving({ day: '2026-10-24', time: '13:00', amt: 120000, dir: 'out', text: 'DICH VU', acct: null, lane: 'wallet', prov: 'MoMo', ref: 'MM999' });
qHist.statement = true;
var vq = run([qMail, qHist], []);
t('in the queue: the wallet mail and its history row with one id, sure same_ref', vq[1] && vq[1].tier === 'sure' && vq[1].why === 'same_ref' && vq[1].twinIndex === 0, vq.map(show));
vq = run([qHist, qMail], []);
t('in the queue, the other order: one of the two is flagged, against the other', (vq[0] && vq[0].twinIndex === 1) !== (vq[1] && vq[1].twinIndex === 0) && vq.filter(Boolean).length === 1, vq.map(show));

console.log('\n-- R13: refunds and the opposite direction --');
var buy = { day: '2026-10-25', time: '11:00', amt: 499000, dir: 'out', text: 'SHOPEE PAY ORDER 8812', acct: 'card', lane: 'alert' };
var refund = { day: '2026-10-25', time: '18:00', amt: 499000, dir: 'in', text: 'HOAN TIEN SHOPEE PAY ORDER 8812', acct: 'card', lane: 'alert', kind: 'income' };
both('a refund beside its same-amount purchase: no flag', buy, refund, none);
var flipped = { day: '2026-10-25', time: '11:00', amt: 499000, dir: 'in', text: 'SHOPEE PAY ORDER 8812', acct: 'card', lane: 'statement', kind: 'income' };
both('opposite direction, same wording, same account, same day: likely direction_conflict', buy, flipped, is('likely', 'direction_conflict', 0));
both('the same, refund-worded by the payload only (refundWorded): no flag', buy, Object.assign({}, flipped, { refund: true }), (v, sgn) => sgn === 1 ? !v : true);
both('the same, one shared word only: no flag', buy, Object.assign({}, flipped, { text: 'SHOPEE' }), none);

console.log('\n-- proves two events: two different owned accounts --');
both('same amount, same day, same words on two owned accounts: nothing',
  { day: '2026-10-26', time: '12:00', amt: 150000, dir: 'out', text: 'PHUC LONG', acct: 'card', lane: 'alert' },
  { day: '2026-10-26', amt: 150000, dir: 'out', text: 'PHUC LONG', acct: 'dep', lane: 'statement' }, none);

console.log('\n-- proves two events: two machine clocks --');
both('same day, two bank clocks three hours apart, no word: nothing',
  { day: '2026-10-27', time: '09:00', amt: 75000, dir: 'out', text: 'CIRCLE K', lane: 'alert' },
  { day: '2026-10-27', time: '12:05', amt: 75000, dir: 'out', text: 'GS25', lane: 'alert', prov: 'VCB' }, none);
both('same day, clocks 30 minutes apart, no word, no account: likely exact_day',
  { day: '2026-10-27', time: '09:00', amt: 75000, dir: 'out', text: 'CIRCLE K', lane: 'alert' },
  { day: '2026-10-27', time: '09:30', amt: 75000, dir: 'out', text: 'GS25', lane: 'wallet', prov: 'MoMo' }, is('likely', 'exact_day', 0));
both('a day apart, both clocked, hours apart: nothing',
  { day: '2026-10-27', time: '09:00', amt: 75000, dir: 'out', text: 'CIRCLE K', acct: 'card', lane: 'alert' },
  { day: '2026-10-28', time: '09:00', amt: 75000, dir: 'out', text: 'CIRCLE K', acct: 'card', lane: 'alert' }, none);
both('23:58 and 00:01 the next day (three minutes): still one event, sure',
  { day: '2026-10-27', time: '23:58', amt: 75000, dir: 'out', text: 'CIRCLE K', acct: 'card', lane: 'alert' },
  { day: '2026-10-28', time: '00:01', amt: 75000, dir: 'out', text: 'CIRCLE K Q7', acct: 'card', lane: 'statement' }, is('sure', 'acct_text', 1));
var handTimed = run([arriving({ day: '2026-10-27', time: '18:40', amt: 75000, dir: 'out', text: 'CIRCLE K', lane: 'alert' })],
  [booked({ day: '2026-10-27', time: '09:00', amt: 75000, dir: 'out', text: 'do an vat', src: null })])[0];
t('a hand-typed row\'s time is never a clock: still likely', handTimed && handTimed.tier === 'likely', show(handTimed));

console.log('\n-- raises to sure: account + minute, and the old same-day rules --');
both('same account, same minute, no word: sure acct_minute',
  { day: '2026-10-28', time: '14:22', amt: 88000, dir: 'out', text: 'MPOS 991', acct: 'card', lane: 'alert' },
  { day: '2026-10-28', time: '14:22', amt: 88000, dir: 'out', text: 'POS 11', acct: 'card', lane: 'statement' }, is('sure', 'acct_minute', 0));
both('no account, same day, merchant word: sure exact_merchant (the old rule)',
  { day: '2026-10-28', time: '14:22', amt: 88000, dir: 'out', text: 'AEON NGUYEN VAN LINH', lane: 'alert' },
  { day: '2026-10-28', amt: 88000, dir: 'out', text: 'AEON MALL', lane: 'statement' }, is('sure', 'exact_merchant', 0));
both('no account, a day apart, merchant word, unique both ways: sure book_unique (R15 with a word)',
  { day: '2026-10-28', time: '14:22', amt: 88000, dir: 'out', text: 'AEON NGUYEN VAN LINH', lane: 'alert' },
  { day: '2026-10-29', amt: 88000, dir: 'out', text: 'AEON MALL', lane: 'statement' }, is('sure', 'book_unique'));
var aeonX = run([arriving({ day: '2026-10-29', amt: 88000, dir: 'out', text: 'AEON MALL', lane: 'statement' })],
  [booked({ day: '2026-10-28', time: '14:22', amt: 88000, dir: 'out', text: 'AEON NGUYEN VAN LINH' }), booked({ day: '2026-10-30', time: '10:00', amt: 88000, dir: 'out', text: 'BACH HOA XANH' })])[0];
t('the same with a second booked row of that amount in the window: likely exact_merchant (a word alone proves nothing across days)', aeonX && aeonX.tier === 'likely' && aeonX.why === 'exact_merchant', show(aeonX));

console.log('\n-- rounded: a hand-typed row against the bank\'s exact figure --');
var typed = (text) => booked({ day: '2026-10-29', amt: 467000, dir: 'out', text: text, src: null });
var bank = () => arriving({ day: '2026-10-29', time: '21:26', amt: 467290, dir: 'out', text: 'AEON NGUYEN VAN LINH', lane: 'alert' });
var vr = run([bank()], [typed('aeon')])[0];
t('467.000 typed vs 467.290 at the same merchant, same day: sure rounded_merchant', vr && vr.tier === 'sure' && vr.why === 'rounded_merchant', show(vr));
t('without the shared word: nothing', !run([bank()], [typed('di cho')])[0]);
t('a machine-read 467.000 is not rounded: nothing', !run([bank()], [booked({ day: '2026-10-29', amt: 467000, dir: 'out', text: 'AEON', src: 'direct-email' })])[0]);
// (A typed row never arrives in the queue, so this rule has one order.)

console.log('\n-- R15: a booked row with no account (a catch-all wallet import) --');
var cat = (amt, day, text) => booked({ day: day || '2026-10-30', amt: amt, dir: 'out', text: text || 'an uong', acct: null, src: 'file-import' });
var bk = (amt, text) => arriving({ day: '2026-10-30', time: '19:00', amt: amt, dir: 'out', text: text || 'CTY ABC', acct: 'dep', lane: 'alert' });
var vb = run([bk(350000)], [cat(350000)])[0];
t('350.000, unique both ways: sure book_unique', vb && vb.tier === 'sure' && vb.why === 'book_unique', show(vb));
vb = run([bk(45000)], [cat(45000)])[0];
t('45.000, no shared word: likely', vb && vb.tier === 'likely', show(vb));
vb = run([bk(45000, 'BANH MI HUYNH HOA')], [cat(45000, null, 'banh mi')])[0];
t('45.000 with a shared word, a day apart: sure book_unique', vb && vb.tier === 'sure', show(vb));
var twoBooked = [cat(350000, '2026-10-29'), cat(350000, '2026-10-30')];
vb = run([bk(350000)], twoBooked)[0];
t('two booked rows of that amount in the window: likely', vb && vb.tier === 'likely', show(vb));
t('paired with the nearer day', vb && vb.twin && vb.twin.day === '2026-10-30' && vb.dayShift === 0);
vb = run([bk(350000), bk(350000)], [cat(350000)]);
t('two queue rows of that amount against one booked row: never sure', vb.every((v) => !v || v.tier !== 'sure'), vb.map(show));
var vrev = run([arriving({ day: '2026-10-30', amt: 350000, dir: 'out', text: 'an uong', acct: null, lane: 'file' })],
  [booked({ day: '2026-10-30', time: '19:00', amt: 350000, dir: 'out', text: 'CTY ABC', acct: 'dep' })])[0];
t('the other order (the booked side HAS an account, the arriving row has none): likely, as R15 is written', vrev && vrev.tier === 'likely', show(vrev));
var vwal = run([arriving({ day: '2026-10-30', time: '19:00', amt: 350000, dir: 'out', text: 'x', acct: 'momo', lane: 'wallet', prov: 'MoMo' })], [cat(350000)])[0];
t('a wallet row never reaches sure on book uniqueness', vwal && vwal.tier === 'likely', show(vwal));

console.log('\n-- the queue: one lane, one shape --');
var al = (time) => arriving({ day: '2026-10-31', time: time, amt: 200000, dir: 'out', text: 'CK DEN NGUYEN VAN A', lane: 'alert' });
var vqq = run([al('10:00'), al('10:03')], []);
t('two alerts of one bank, one shape, one amount, one day: nothing', vqq.every((v) => !v), vqq.map(show));
vqq = run([al('10:03'), al('10:00')], []);
t('the same in the other order', vqq.every((v) => !v), vqq.map(show));
var stQ = arriving({ day: '2026-10-31', amt: 200000, dir: 'out', text: 'CK DEN NGUYEN VAN A', lane: 'statement' });
vqq = run([al('10:00'), stQ], []);
t('an alert and its statement row (same bank): likely statement_echo', vqq[1] && vqq[1].why === 'statement_echo' && vqq[1].twinIndex === 0, vqq.map(show));
vqq = run([stQ, al('10:00')], []);
t('the other order: the poorer (clockless) row is the one flagged', vqq[0] && vqq[0].twinIndex === 1 && !vqq[1], vqq.map(show));
var stA = Object.assign(arriving({ day: '2026-10-31', amt: 200000, dir: 'out', text: 'CK DEN NGUYEN VAN A', acct: 'dep', lane: 'statement' }));
var alA = arriving({ day: '2026-10-31', time: '10:00', amt: 200000, dir: 'out', text: 'CK DEN NGUYEN VAN A', acct: 'dep', lane: 'alert' });
vqq = run([alA, stA], []);
t('the same pair with the account on both: sure acct_text', vqq[1] && vqq[1].tier === 'sure' && vqq[1].why === 'acct_text', vqq.map(show));
var st2 = arriving({ day: '2026-10-31', amt: 200000, dir: 'out', text: 'CK DEN NGUYEN VAN A', lane: 'statement' });
vqq = run([stQ, st2], []);
t('two rows of one statement: nothing', vqq.every((v) => !v));
var vcb = arriving({ day: '2026-10-31', time: '10:00', amt: 200000, dir: 'out', text: 'CK DEN NGUYEN VAN A', lane: 'alert', prov: 'VCB' });
vqq = run([al('10:00'), vcb], []);
t('two banks\' alerts: nothing (two accounts)', vqq.every((v) => !v));
var momo = arriving({ day: '2026-10-31', time: '10:01', amt: 200000, dir: 'out', text: 'NAP TIEN', lane: 'wallet', prov: 'MoMo', shape: 'ecommerce_receipt' });
vqq = run([al('10:00'), momo], []);
t('a bank alert and the wallet row a minute later: likely cross_source', vqq[1] && vqq[1].why === 'cross_source' && vqq[1].tier === 'likely', vqq.map(show));
vqq = run([al('10:00'), stQ, momo], []);
t('one alert explains both its statement row and its wallet row', vqq[1] && vqq[2] && vqq[1].twinIndex === 0 && vqq[2].twinIndex === 0, vqq.map(show));
var ledgerHit = run([stQ, al('10:00')], [booked({ day: '2026-10-31', time: '10:00', amt: 200000, dir: 'out', text: 'CK DEN NGUYEN VAN A' })]);
t('a row the book explains is not asked about twice', ledgerHit.filter((v) => v && v.twinKind === 'ledger').length === 1, ledgerHit.map(show));

console.log('\n-- R17 hook: opts.notDup --');
var ndA = { day: '2026-11-01', time: '08:00', amt: 99000, dir: 'out', text: 'GRAB', acct: 'card', lane: 'alert' };
var ndB = { day: '2026-11-01', amt: 99000, dir: 'out', text: 'GRAB', acct: 'card', lane: 'statement' };
t('without it: sure', (run([arriving(ndB)], [booked(ndA)])[0] || {}).tier === 'sure');
var asked = 0;
var vnd = run([arriving(ndB)], [booked(ndA)], { notDup: function(c, e){ asked++; return !!(c && e && e.book === 'personal'); } })[0];
t('notDup returning true clears the pair', !vnd && asked > 0);
var vndq = run([arriving(ndA), arriving(ndB)], [], { notDup: function(){ return true; } });
t('and clears a queue pair', vndq.every((v) => !v));

console.log('\n-- other members\' family rows (dedup-flaws-review FP2, kept) --');
var famRow = (o) => Object.assign({ id: 'f' + (++seq), _d: new Date(o.day + 'T00:00:00'), amt: o.amtD / 1000, note: o.note || '', who: 'Trang', _memberId: 'trang', time: '', src: null, kind: 'expense' }, o);
t('another member\'s row with no word in common: nothing',
  !run([arriving({ day: '2026-11-02', time: '09:58', amt: 210000, dir: 'out', text: 'Foody' })], [], {}, [famRow({ day: '2026-11-02', amtD: 210000, note: 'Kingdommart' })])[0]);
var vfam = run([arriving({ day: '2026-11-02', time: '09:58', amt: 210000, dir: 'out', text: 'Kingdommart Foody' })], [], {}, [famRow({ day: '2026-11-02', amtD: 210000, note: 'Kingdommart' })])[0];
t('with the merchant word: sure, whoever logged it', vfam && vfam.tier === 'sure', show(vfam));

console.log('\n-- R19: fx_final, the cases of tools/dedup-fx-final.test.js --');
var EST = 'OPENAI *CHATGPT [20 USD @26,350 +3% est.]';
var fxc = (o) => ({ amount: o.amount, date: new Date(o.day + 'T00:00:00'), dateDisplay: o.day, time: '', description: o.desc || '', counterparty: '',
  isIncome: !!o.income, isTransfer: false, accountKind: 'credit_card', provider: 'VIB', kind: 'bank', currency: 'VND', shape: 'bank_txn',
  statement: o.statement !== false, lane: o.statement !== false ? 'statement' : 'alert', acctId: o.acct || null });
var fxp = (o) => ({ id: 'p' + (++seq), date: o.day, kind: o.kind || 'expense', amt: o.amtD / 1000, note: o.note || '', link: null, src: 'direct-email', time: '', acct: o.acct || null });
var fx1 = (c, p) => run([c], p)[0];
var vf = fx1(fxc({ amount: 527400, day: '2026-08-14', desc: 'Mua Hàng / OPENAI *CHATGPT' }), [fxp({ day: '2026-08-13', amtD: 542810, note: EST })]);
t('fires: sure fx_final', vf && vf.tier === 'sure' && vf.why === 'fx_final', show(vf));
t('the booked row is the evidence', vf && vf.twin && vf.twin.book === 'personal' && Math.round(vf.twin.amtD) === 542810);
t('the shared merchant word is reported', vf && vf.shared === 'openai', vf && vf.shared);
t('an EMAIL row never gets this tier', (function(){ var v = fx1(fxc({ amount: 527400, day: '2026-08-14', desc: 'Mua Hàng / OPENAI *CHATGPT', statement: false }), [fxp({ day: '2026-08-13', amtD: 542810, note: EST })]); return !v || v.why !== 'fx_final'; })());
t('a booked row that does NOT say it is an estimate', !fx1(fxc({ amount: 527400, day: '2026-08-14', desc: 'Mua Hàng / OPENAI *CHATGPT' }), [fxp({ day: '2026-08-13', amtD: 542810, note: 'OPENAI *CHATGPT' })]));
t('a different merchant', !fx1(fxc({ amount: 527400, day: '2026-08-14', desc: 'Mua Hàng / NETFLIX.COM' }), [fxp({ day: '2026-08-13', amtD: 542810, note: EST })]));
t('more than 6% apart', !fx1(fxc({ amount: 527400, day: '2026-08-14', desc: 'Mua Hàng / OPENAI *CHATGPT' }), [fxp({ day: '2026-08-13', amtD: 610000, note: EST })]));
t('more than a few days apart', !fx1(fxc({ amount: 527400, day: '2026-08-25', desc: 'Mua Hàng / OPENAI *CHATGPT' }), [fxp({ day: '2026-08-13', amtD: 542810, note: EST })]));
t('a refund is not the purchase', !fx1(fxc({ amount: 527400, day: '2026-08-14', desc: 'Mua Hàng / OPENAI *CHATGPT', income: true }), [fxp({ day: '2026-08-13', amtD: 542810, note: EST })]));
t('the currency code in the tag is not a shared word', (function(){ var v = fx1(fxc({ amount: 20, day: '2026-08-14', desc: 'Mua Hàng / USD SHOP' }), [fxp({ day: '2026-08-13', amtD: 20, note: 'USD SHOP [20 USD @26,350 +3% est.]' })]); return !v || v.why !== 'fx_final'; })());
var vfx = fx1(fxc({ amount: 542810, day: '2026-08-13', desc: 'Mua Hàng / OPENAI *CHATGPT' }), [fxp({ day: '2026-08-13', amtD: 542810, note: EST })]);
t('an exact match still wins: exact_merchant', vfx && vfx.why === 'exact_merchant', show(vfx));
t('R19 adds the account: two owned accounts, no fx_final', !fx1(fxc({ amount: 527400, day: '2026-08-14', desc: 'Mua Hàng / OPENAI *CHATGPT', acct: 'card' }), [fxp({ day: '2026-08-13', amtD: 542810, note: EST, acct: 'card2' })]));

console.log('\n-- the pipeline flag, ported --');
var pc = Object.assign(arriving({ day: '2026-11-03', time: '10:00', amt: 51000, dir: 'out', text: 'ABC', pipe: 'x1' }), {});
var vp = fhReconAssess([pc], { rows: [] }, { kindById: function(){ return ''; } });
t('an unproved pipeline flag stays a suspicion', vp[0] && vp[0].why === 'pipeline' && vp[0].tier === 'likely');
vp = fhReconAssess([pc], { rows: [] }, { kindById: function(){ return 'bank'; } });
t('two banks overrule it, reported beside the verdicts, the candidate untouched', !vp[0] && vp.overruled[0] === true && !pc.pipelineDupOverruled);

console.log('\n-- purity --');
var pure = [arriving(hl1), arriving(hl2), arriving(Object.assign({}, hl1, { lane: 'statement', time: '' }))];
var before = JSON.stringify(pure);
window.txns = []; window._fhPersonalMatchSlice = [booked(hsB)];
var pIdx = fhDedupLedgerIndex(), pRows = JSON.stringify(pIdx.rows);
fhReconAssess(pure, pIdx, {}); fhReconAssess(pure, pIdx, {});
t('the candidates are not written to', JSON.stringify(pure) === before);
t('the index rows are not written to', JSON.stringify(pIdx.rows) === pRows);

console.log('\n-- inputs: lane, account, facts, slice range --');
t('a file row is lane file', fhReconLane({ staged: false }) === 'file');
t('a bank mail is lane alert', fhReconLane({ staged: true, provider: 'VIB', rx: { sender_kind: 'bank' } }) === 'alert');
t('a statement row is lane statement', fhReconLane({ staged: true, provider: 'VIB', rx: { _transport: 'statement' } }) === 'statement');
t('a wallet\'s statement row is lane wallet', fhReconLane({ staged: true, provider: 'MoMo', rx: { _transport: 'statement', account_kind: 'ewallet' } }) === 'wallet');
t('a wallet by provider alone (v1 row)', fhReconLane({ staged: true, provider: 'Ví MoMo', rx: {} }) === 'wallet');
t('a merchant receipt is lane scan', fhReconLane({ staged: true, provider: 'Grab', rx: { sender_kind: 'receipt' } }) === 'scan');
t('a non-bank sender of a v1 row is lane scan', fhReconLane({ staged: true, provider: 'EVN', rx: {}, otherKind: true }) === 'scan');
var accts = fhReconAcctIndex([{ id: 'a1', kind: 'credit_card', provider: 'VIB', tail: '4751' }, { id: 'a2', kind: 'deposit', provider: 'VIB', tail: '1234' },
                              { id: 'a3', kind: 'deposit', provider: 'VCB', tail: '1234' }, { id: 'a4', kind: 'deposit', provider: 'TCB', tail: '9999' }, { id: 'a5', kind: 'deposit', provider: 'TCB', tail: '9999' }]);
var f = fhReconCandFacts({ staged: true, provider: 'VIB', rx: { account_masked: '••4751', direction: 'debit', reference_number: 'FT123', time_precision: 'minute' } }, accts);
t('the account resolves by provider and tail', f.acctId === 'a1' && f.acctTail === '4751' && f.ref === 'FT123' && f.timePrecision === 'minute' && f.dir === 'out', f);
t('the same tail at another bank resolves to that bank\'s account', fhReconCandFacts({ staged: true, provider: 'VCB', rx: { account_masked: '1234' } }, accts).acctId === 'a3');
t('two owned accounts with one identity: unknown', fhReconCandFacts({ staged: true, provider: 'TCB', rx: { account_masked: '9999' } }, accts).acctId === null);
t('no owned account: unknown', fhReconCandFacts({ staged: true, provider: 'ACB', rx: { account_masked: '5555' } }, accts).acctId === null);
t('a credit on a transfer-shaped row is money in (isIncome is cleared on those)', fhReconCandFacts({ staged: true, provider: 'VIB', rx: { direction: 'credit' }, isIncome: false }, accts).dir === 'in');
t('a file row falls back to isIncome / _xferDir', fhReconCandFacts({ staged: false, isIncome: false, xferDir: 'in' }, accts).dir === 'in');
t('refund wording, deburred', fhReconCandFacts({ staged: true, provider: 'VIB', rx: {}, text: 'Hoàn tiền đơn 8812' }, accts).refundWorded === true);
t('a statement\'s own refund class', fhReconCandFacts({ staged: true, provider: 'VIB', rx: { stmt: { flow: 'refund' } }, text: 'GD 8812' }, accts).refundWorded === true);
t('ordinary wording is not a refund', fhReconCandFacts({ staged: true, provider: 'VIB', rx: {}, text: 'Thanh toán SHOPEE' }, accts).refundWorded === false);
var rg = fhReconSliceRange(['2025-06-10T03:00:00Z', '2026-11-01T10:00:00Z', 'garbage', null]);
t('the slice range is the oldest row minus four days', rg && rg.from === '2025-06-06' && rg.to === '2026-11-05', rg);
t('no readable date, no range', fhReconSliceRange([null, 'x']) === null);

console.log('\n-- R20: the mode --');
delete _ls['fh-recon'];
t('default is shadow', fhReconMode() === 'shadow');
_ls['fh-recon'] = 'off'; t('off', fhReconMode() === 'off');
_ls['fh-recon'] = 'on'; t('on', fhReconMode() === 'on');
_ls['fh-recon'] = 'banana'; t('anything else is the default', fhReconMode() === 'shadow');
var savedLs = localStorage; localStorage = { getItem: function(){ throw new Error('blocked'); }, setItem: function(){ throw new Error('blocked'); } };
t('a storage that throws reads as the default', fhReconMode() === 'shadow');
localStorage = savedLs; delete _ls['fh-recon'];

/* ── the real bucketing: 'shadow' changes nothing ─────────────────────────── */
console.log('\n-- bucketCsvCandidates (57): shadow changes no bucket, keeps only numbers --');
const src57 = fs.readFileSync(path.join(__dirname, '..', 'src', 'js-ui', '57-csv-import-review.js'), 'utf8');
function normDescForDedup(x){ return String(x || '').trim().toLowerCase().replace(/\s+/g, ' '); }
function deburr(s){ return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, ''); }
window.csvStagedMode = true;
const fx = (name) => { const j = src57.indexOf('function ' + name); if (j < 0) { console.error(name + ' not found'); process.exit(1); } return src57.slice(j, src57.indexOf('\n}', j) + 2); };
eval(fx('csvInfoScore'));
const bi = src57.indexOf('function bucketCsvCandidates');
if (bi < 0) { console.error('bucketCsvCandidates not found'); process.exit(1); }
eval(src57.slice(bi, src57.indexOf('\n}', src57.indexOf('return { ready: ready', bi)) + 2));
window.fhStagedRawX = (i) => (window._fhStagedRows[i] || {}).raw_extracted || null;
window.fhStagedMeta = (i) => { const r = window._fhStagedRows[i]; return r ? { provider: r.source_provider, kind: r.raw_extracted.transaction_type === 'bank_txn' ? 'bank' : 'other', dupOfId: r.duplicate_of_id || '', currency: 'VND', occurredAt: r.occurred_at, pipelineDup: !!r.duplicate_of_id } : null; };
window.fhStagedKindById = () => '';
window.fhPersonalData = () => ({ accounts: [{ id: 'dep', kind: 'deposit', provider: 'VIB', tail: '1234' }, { id: 'card', kind: 'credit_card', provider: 'VIB', tail: '4751' }] });
function csvRowTime(c){ const r = window._fhStagedRows[c.rowIndex]; return (r && r._clock) || ''; }

/* A mixed queue: card purchases (alert + statement), a card repayment the old
   engine skips, a refund, wallet rows, a transfer, against a mixed ledger. */
const Q = [
  { p: 'VIB', at: '2026-11-10 00:25', amt: 259000, cp: 'SHOPEE ONLINE', x: { account_masked: '4751', direction: 'debit', transaction_type: 'bank_txn', account_kind: 'credit_card', sender_kind: 'bank', time_precision: 'minute' } },
  { p: 'VIB', at: '2026-11-09', amt: 259000, cp: 'SHOPEE', x: { account_masked: '4751', direction: 'debit', transaction_type: 'bank_txn', account_kind: 'credit_card', _transport: 'statement', time_precision: 'day' } },
  { p: 'VIB', at: '2026-11-12', amt: 8400000, cp: 'TT THE TD', xfer: true, x: { account_masked: '1234', direction: 'debit', transaction_type: 'bank_txn', account_kind: 'deposit', _transport: 'statement', time_precision: 'day' } },
  { p: 'VIB', at: '2026-11-13 18:00', amt: 499000, cp: 'HOAN TIEN SHOPEE PAY ORDER', income: true, x: { account_masked: '4751', direction: 'credit', transaction_type: 'bank_txn', sender_kind: 'bank', time_precision: 'minute' } },
  { p: 'MoMo', at: '2026-11-14 12:00', amt: 20000, cp: 'MOMO A', x: { direction: 'debit', transaction_type: 'ecommerce_receipt', sender_kind: 'wallet', time_precision: 'minute' } },
  { p: 'MoMo', at: '2026-11-14 12:01', amt: 20000, cp: 'MOMO B', x: { direction: 'debit', transaction_type: 'ecommerce_receipt', sender_kind: 'wallet', time_precision: 'minute' } },
  { p: 'VIB', at: '2026-11-15 10:00', amt: 200000, cp: 'CK DEN NGUYEN VAN A', x: { account_masked: '1234', direction: 'debit', transaction_type: 'bank_txn', sender_kind: 'bank', time_precision: 'minute' } },
  { p: 'VIB', at: '2026-11-15', amt: 200000, cp: 'CK DEN NGUYEN VAN A', x: { account_masked: '1234', direction: 'debit', transaction_type: 'bank_txn', _transport: 'statement', time_precision: 'day' } },
  { p: 'VIB', at: '2026-11-16 09:00', amt: 77000, cp: 'PHUC LONG', x: { account_masked: '4751', direction: 'debit', transaction_type: 'bank_txn', sender_kind: 'bank', time_precision: 'minute' } }
];
const LEDGER = () => [
  { id: 'L1', date: '2026-11-12', kind: 'transfer', amt: -8400, note: 'THANH TOAN THE TIN DUNG', link: null, src: 'direct-email', time: '09:12', acct: 'dep', who: null },
  { id: 'L2', date: '2026-11-13', kind: 'expense', amt: 499, note: 'SHOPEE PAY ORDER', link: null, src: 'direct-email', time: '11:00', acct: 'card', who: null },
  { id: 'L3', date: '2026-11-16', kind: 'expense', amt: 77, note: 'PHUC LONG', link: null, src: null, time: '', acct: null, who: null },
  { id: 'L4', date: '2026-11-14', kind: 'expense', amt: 20, note: 'an vat', link: null, src: 'file-import', time: '', acct: null, who: null }
];
function queueRun(mode){
  if (mode) _ls['fh-recon'] = mode; else delete _ls['fh-recon'];
  window._fhStagedRows = Q.map((q, i) => ({ id: 's' + i, source_provider: q.p, occurred_at: q.at, _clock: q.at.length > 10 ? q.at.slice(11, 16) : '',
    raw_extracted: Object.assign({}, q.x) }));
  window._fhPersonalMatchSlice = LEDGER();
  window.txns = [];
  const cands = Q.map((q, i) => ({ rowIndex: i, description: q.cp, _hasDesc: true, counterparty: q.cp, amount: q.amt, isIncome: !!q.income, isTransfer: !!q.xfer,
    date: new Date(q.at.slice(0, 10) + 'T00:00:00'), dateDisplay: q.at.slice(0, 10), categoryName: 'Khác', flags: [] }));
  return bucketCsvCandidates(cands, false);
}
function snap(r){
  const one = (c) => [c.rowIndex, c._dupTier || '', c._dupWhy || '', c._dupTwinKind || '', c._dupTwin ? (c._dupTwin.id || c._dupTwin.rowIndex || 'q') : '',
    !!c.duplicateOfExisting, !!c.duplicateNearMiss, !!c.duplicateOfSource, !!c.duplicateOfPipeline, !!c.pipelineDupOverruled].join(':');
  const groups = Object.keys(r.needsCategoryGroups).sort().map((k) => k + '=' + r.needsCategoryGroups[k].map(one).join(','));
  return JSON.stringify({ ready: r.ready.map(one), dup: r.possibleDuplicate.map(one), def: r.deferred.map(one), groups: groups, merged: r.mergedCount });
}
FH_RECON_SHADOW = null; delete _ls['fh-recon-shadow'];
const offSnap = snap(queueRun('off'));
t('off mode records nothing', !_ls['fh-recon-shadow']);
const shadowSnap = snap(queueRun('shadow'));
t('shadow: every bucket identical to off', shadowSnap === offSnap, { off: offSnap, shadow: shadowSnap });
t('the default (no setting) is shadow, and identical too', snap(queueRun(null)) === offSnap);
const rec = fhReconShadow();
t('the shadow ran (two runs, every row judged)', rec.runs === 2 && rec.last.judged > 0 && rec.total.judged === 2 * rec.last.judged, rec);
t('it saw what the old engine missed (the repayment: new-only)', rec.last.newOnly >= 1, rec.last);
const onlyNumbers = (o) => Object.keys(o).every((k) => typeof o[k] === 'number' ? isFinite(o[k]) : (o[k] && typeof o[k] === 'object' && !Array.isArray(o[k]) && onlyNumbers(o[k])));
t('the in-memory record holds only numbers', onlyNumbers(rec), rec);
const stored = JSON.parse(_ls['fh-recon-shadow']);
t('the stored record holds only numbers', onlyNumbers(stored), stored);
const keys = JSON.stringify(stored);
t('and no amount, name, memo or id', !/259|8400|SHOPEE|PHUC|MOMO|NGUYEN|"s\d|"L\d|dep|card|2026/i.test(keys), keys);
t('window.fhReconShadow is exposed', window.fhReconShadow === fhReconShadow);
FH_RECON_SHADOW = null;
t('the running total survives a reload', fhReconShadow().total.judged === rec.total.judged && fhReconShadow().runs === 2);

const realAssess = fhReconAssess;
fhReconAssess = function(){ throw new Error('boom'); };
const boomSnap = snap(queueRun('shadow'));
fhReconAssess = realAssess;
t('a throw inside the shadow never breaks the queue', boomSnap === offSnap);
t('and is counted', fhReconShadow().errors === 1);

const onRes = queueRun('on');
const repay = onRes.possibleDuplicate.filter((c) => c.rowIndex === 2)[0];
t('on: the new matcher decides (the repayment is now "đã có trong sổ")', repay && repay._dupTier === 'sure' && repay._dupWhy === 'acct_unique' && repay.duplicateOfExisting && repay.duplicateOfExisting.id === 'L1', repay && repay._dupWhy);
const offRes = queueRun('off');
t('off: the old engine leaves it alone', !offRes.possibleDuplicate.some((c) => c.rowIndex === 2));
delete _ls['fh-recon'];

console.log('\n' + (fail === 0 ? 'ALL ' + pass + ' PASSED' : pass + ' passed, ' + fail + ' FAILED'));
process.exit(fail ? 1 : 0);
