#!/usr/bin/env node
/* The duplicate engine, case by case — every shape the 2026-09-16 real-queue
 * study produced, rebuilt as synthetic rows (no real data in the repo).
 * `node tools/dedup-engine.test.js`
 *
 * The engine's contract: a verdict it can show evidence for, or nothing.
 *   sure   = same amount, same day, same merchant word OR same minute;
 *            or a rounded hand-log (<1.000đ) with the merchant word.
 *   likely = same amount, same day, no words agree, on the person's own row;
 *            a card posting ≤3.5 days after an email row; a kind conflict on
 *            an identical long text; two notices of one purchase in the queue.
 *   none   = another member's same-amount row, a different day, a transfer.
 */
const fs = require('fs');
const path = require('path');
var window = { txns: [], DB: { ownerMemberId: 'me' } };
var curMult = function(){ return 1000; };
eval(fs.readFileSync(path.join(__dirname, '..', 'src', 'js-ui', '58-dedup-engine.js'), 'utf8'));

let pass = 0, fail = 0;
const t = (n, ok, d) => { console.log((ok ? '  PASS  ' : '  FAIL  ') + n + (!ok && d ? '  -> ' + d : '')); ok ? pass++ : fail++; };

const day = (s) => new Date(s + 'T00:00:00');
const fam = (o) => Object.assign({ id: 'f' + Math.random(), _d: day(o.day), amt: o.amtD / 1000, note: o.note || '', who: o.who || 'Hien', _memberId: o.member || 'me', time: o.time || null, src: o.src || null }, o);
const per = (o) => Object.assign({ id: 'p' + Math.random(), date: o.day, kind: o.kind || 'expense', amt: o.amtD / 1000, note: o.note || '', link: o.link || null, src: o.src || null, time: o.time || '' }, o);
const cand = (o) => Object.assign({ amount: o.amount, date: new Date(o.at), dateDisplay: o.at.slice(0, 10), time: o.at.length > 10 ? o.at.slice(11, 16) : '',
  description: o.desc || '', counterparty: o.cp || '', isIncome: !!o.income, isTransfer: !!o.xfer, accountKind: o.ak || null, provider: o.prov || '', kind: o.kind || '', currency: o.cur || 'VND', shape: o.shape || '' }, o);
const run = (cands, family, personal, opts) => { window.txns = family || []; window._fhPersonalMatchSlice = personal || []; return fhDedupAssess(cands, fhDedupLedgerIndex(), opts); };
const tier = (v) => (v && v.tier) || 'none';

console.log('\n-- sure: same amount, same day, shared merchant word --');
var v = run([cand({ amount: 127000, at: '2026-09-14T19:07', desc: 'AEON NGUYEN VAN LINH', cp: 'AEON NGUYEN VAN LINH' })],
            [fam({ day: '2026-09-14', amtD: 127000, note: 'AEON NGUYEN VAN LINH', time: '19:07' })]);
t('flagged sure', tier(v[0]) === 'sure', tier(v[0]));
t('with the merchant as the reason', v[0] && v[0].why === 'exact_merchant' && v[0].shared === 'aeon', v[0] && v[0].why);
t('and the booked row as evidence', v[0] && v[0].twin && v[0].twin.book === 'family');

console.log('\n-- sure: merchant text differs in noise, still one word in common --');
v = run([cand({ amount: 976000, at: '2026-07-06T20:27', desc: 'CTY TNHH UNIQLO VIET NAM' })],
        [fam({ day: '2026-07-06', amtD: 976000, note: 'Uniqlo Viet Nam HCM - 20:27' })]);
t('"CTY TNHH UNIQLO VIET NAM" vs "Uniqlo Viet Nam HCM - 20:27" is sure', tier(v[0]) === 'sure', tier(v[0]));

console.log('\n-- sure: same minute, no words (a statement import that kept the clock in its note) --');
v = run([cand({ amount: 29400, at: '2026-07-13T19:05', desc: 'MPOS*QUICK SAVE' })],
        [fam({ day: '2026-07-13', amtD: 29400, note: 'Cửa hàng - 19:05' })]);
t('the minute in the note counts', tier(v[0]) === 'sure' && v[0].why === 'exact_minute', tier(v[0]));

console.log('\n-- sure: rounded hand-log, same merchant, same day --');
v = run([cand({ amount: 467290, at: '2026-08-27T21:26', desc: 'AEON NGUYEN VAN LINH' })],
        [fam({ day: '2026-08-27', amtD: 467000, note: 'AEON NGUYEN VAN LINH HO CHI MINH VN' })]);
t('467.290 vs 467.000 with the merchant is sure', tier(v[0]) === 'sure' && v[0].why === 'rounded_merchant', tier(v[0]));
v = run([cand({ amount: 467290, at: '2026-08-27T21:26', desc: 'HIGHLANDS COFFEE' })],
        [fam({ day: '2026-08-27', amtD: 467000, note: 'AEON NGUYEN VAN LINH' })]);
t('a different merchant never near-misses', tier(v[0]) === 'none', tier(v[0]));
v = run([cand({ amount: 468500, at: '2026-08-27T21:26', desc: 'AEON NGUYEN VAN LINH' })],
        [fam({ day: '2026-08-27', amtD: 467000, note: 'AEON NGUYEN VAN LINH' })]);
t('1.500đ apart is a different purchase', tier(v[0]) === 'none', tier(v[0]));

console.log('\n-- likely: same amount, same day, the person\'s own words --');
v = run([cand({ amount: 1080000, at: '2026-07-20T23:10', desc: 'CAO THAI DUY HIEN chuyen tien den NGUYEN THI THANH TUYEN' })],
        [fam({ day: '2026-07-20', amtD: 1080000, note: 'Trekking shoes' })]);
t('"Trekking shoes" is a question, not a fact', tier(v[0]) === 'likely' && v[0].why === 'exact_day', tier(v[0]));

console.log('\n-- none: another member\'s same-amount row (five of ten false flags) --');
v = run([cand({ amount: 210000, at: '2026-07-11T09:58', desc: 'Foody' })],
        [fam({ day: '2026-07-11', amtD: 210000, note: 'Kingdommart', who: 'Trang', member: 'trang' })]);
t('Trang\'s Kingdommart does not flag my Foody', tier(v[0]) === 'none', tier(v[0]));
v = run([cand({ amount: 210000, at: '2026-07-11T09:58', desc: 'Kingdommart Foody' })],
        [fam({ day: '2026-07-11', amtD: 210000, note: 'Kingdommart', who: 'Trang', member: 'trang' })]);
t('but with the merchant word it IS sure, whoever logged it', tier(v[0]) === 'sure', tier(v[0]));
v = run([cand({ amount: 210000, at: '2026-07-11T09:58', desc: 'Foody' })],
        [fam({ day: '2026-07-11', amtD: 210000, note: 'Kingdommart', who: 'Shared', member: null })]);
t('a Shared row is treated as the person\'s own', tier(v[0]) === 'likely', tier(v[0]));

console.log('\n-- none: same round amount on a different day (the other false flags) --');
v = run([cand({ amount: 25000, at: '2026-09-07T14:33', desc: 'REVI PHU MY HUNG TOWER' })],
        [], [per({ day: '2026-09-05', amtD: 25000, note: 'FPT PHARMA' })]);
t('25.000đ two days apart, different merchant: nothing', tier(v[0]) === 'none', tier(v[0]));
v = run([cand({ amount: 1000, at: '2026-08-15T10:08', desc: 'Foody 19002042' })],
        [fam({ day: '2026-08-18', amtD: 1000, note: 'Iu anhhh' })]);
t('1.000đ three days apart: nothing', tier(v[0]) === 'none', tier(v[0]));

console.log('\n-- none: a transfer is never matched to spending --');
v = run([cand({ amount: 7000000, at: '2026-08-05T23:45', desc: 'CAO THAI DUY HIEN chuyen tien den CAO THAI DUY HIEN', xfer: true })],
        [fam({ day: '2026-08-05', amtD: 7000000, note: 'Tiền nhà', who: 'Shared', member: null })]);
t('a 7M self-transfer does not flag against "Tiền nhà"', tier(v[0]) === 'none', tier(v[0]));

console.log('\n-- none: planned rows are not spending yet --');
v = run([cand({ amount: 1200000, at: '2026-09-01T09:00', desc: 'THUE NHA' })],
        [Object.assign(fam({ day: '2026-09-01', amtD: 1200000, note: 'Thuê nhà' }), { future: true })]);
t('a planned rent never claims the real debit', tier(v[0]) === 'none', tier(v[0]));

console.log('\n-- mirrors are collapsed; one booked row explains one candidate --');
var famRow = fam({ day: '2026-09-07', amtD: 1, note: 'DV LIEN KET THE', time: '07:38' });
v = run([cand({ amount: 1, at: '2026-09-07T09:58', desc: 'DV LIEN KET THE' }), cand({ amount: 1, at: '2026-09-07T10:01', desc: 'DV LIEN KET THE' })],
        [famRow], [per({ day: '2026-09-07', amtD: 1, note: 'DV LIEN KET THE', link: famRow.id })]);
t('the mirror is not a second twin: exactly one of two 1đ rows is sure', (tier(v[0]) === 'sure') !== (tier(v[1]) === 'sure'), tier(v[0]) + '/' + tier(v[1]));
t('the other gets nothing (it is a real second debit, or the ledger lacks it)', [tier(v[0]), tier(v[1])].indexOf('none') >= 0);
v = run([cand({ amount: 1, at: '2026-09-07T09:58', desc: 'DV LIEN KET THE' }), cand({ amount: 1, at: '2026-09-07T10:01', desc: 'DV LIEN KET THE' })],
        [fam({ day: '2026-09-07', amtD: 1, note: 'DV LIEN KET THE' }), fam({ day: '2026-09-07', amtD: 1, note: 'DV LIEN KET THE' })]);
t('two booked rows explain two candidates', tier(v[0]) === 'sure' && tier(v[1]) === 'sure');

console.log('\n-- likely: kind conflict on an identical long text --');
v = run([cand({ amount: 11247, at: '2026-08-13T17:38', desc: 'hoan tien theo tinh nang the Ghi no quoc te VCB DigiCard', income: true })],
        [fam({ day: '2026-08-13', amtD: 11247, note: 'hoàn tiền theo tính năng thẻ Ghi nợ quốc tế VCB DigiCard' })]);
t('an income candidate against an expense row with the same words asks', tier(v[0]) === 'likely' && v[0].why === 'kind_conflict', tier(v[0]));
v = run([cand({ amount: 5000000, at: '2026-08-13T17:38', desc: 'LUONG THANG 8', income: true })],
        [fam({ day: '2026-08-13', amtD: 5000000, note: 'Mua tủ lạnh' })]);
t('a credit beside an unrelated same-magnitude expense is nothing', tier(v[0]) === 'none', tier(v[0]));

console.log('\n-- likely: card posting a few days after the account-side email --');
v = run([cand({ amount: 253900, at: '2026-09-02T11:28', desc: 'Ngan hang TMCP Quoc te', ak: 'credit_card' })],
        [fam({ day: '2026-08-30', amtD: 253900, note: 'Thanh toán dịch vụ - hàng hóa', src: 'direct-email' })]);
t('3.5 days, exact amount, card posting vs email row: likely', tier(v[0]) === 'likely' && v[0].why === 'card_posting', tier(v[0]));
v = run([cand({ amount: 253900, at: '2026-09-02T11:28', desc: 'Ngan hang TMCP Quoc te', ak: 'credit_card' })],
        [fam({ day: '2026-08-30', amtD: 253900, note: 'Thanh toán dịch vụ - hàng hóa' })]);
t('against a hand-typed row it is nothing (no email provenance)', tier(v[0]) === 'none', tier(v[0]));

console.log('\n-- in-queue: one purchase reported by a bank and a wallet --');
v = run([cand({ amount: 200000, at: '2026-08-16T10:00', desc: 'TT POS 1234', prov: 'MB Bank', kind: 'bank' }),
         cand({ amount: 200000, at: '2026-08-16T10:05', desc: 'Nha hang ABC', prov: 'Grab', kind: 'other' })]);
t('the later row is the echo', tier(v[0]) === 'none' && tier(v[1]) === 'likely' && v[1].why === 'cross_source', tier(v[0]) + '/' + tier(v[1]));
v = run([cand({ amount: 200000, at: '2026-08-16T10:00', desc: 'a', prov: 'Vietcombank', kind: 'bank' }),
         cand({ amount: 200000, at: '2026-08-16T10:05', desc: 'b', prov: 'MB', kind: 'bank' })]);
t('two banks are two accounts: nothing', tier(v[1]) === 'none', tier(v[1]));
v = run([cand({ amount: 200000, at: '2026-08-16T10:00', desc: 'a', prov: 'MB Bank', kind: 'bank' }),
         cand({ amount: 200000, at: '2026-08-16T10:05', desc: 'b', prov: 'Grab', kind: 'other', cur: 'USD' })]);
t('200 USD is not 200 VND', tier(v[1]) === 'none', tier(v[1]));
v = run([cand({ amount: 200000, at: '2026-08-16T10:00', desc: 'a', prov: '', kind: '' }),
         cand({ amount: 200000, at: '2026-08-16T10:05', desc: 'b', prov: 'Grab', kind: 'other' })]);
t('an unknown provider refuses to guess', tier(v[1]) === 'none', tier(v[1]));
v = run([cand({ amount: 200000, at: '2026-08-12T10:00', desc: 'a', prov: 'MB Bank', kind: 'bank' }),
         cand({ amount: 200000, at: '2026-08-16T10:05', desc: 'b', prov: 'Grab', kind: 'other' })]);
t('4 days apart is not a pair', tier(v[1]) === 'none', tier(v[1]));

console.log('\n-- currency synonyms are one currency --');
v = run([cand({ amount: 253900, at: '2026-08-30T10:17', desc: 'Foody', prov: 'VIB', kind: 'bank', shape: 'bank_txn', cur: 'VND' }),
         cand({ amount: 253900, at: '2026-09-02T11:28', desc: 'VIB', prov: 'VIB', kind: 'bank', shape: 'bank_txn', ak: 'credit_card', cur: '₫' })]);
t('"₫" beside "VND" still pairs', tier(v[1]) === 'likely', tier(v[1]));
t('fhDedupCur folds the synonyms', fhDedupCur('₫') === 'VND' && fhDedupCur('VNĐ') === 'VND' && fhDedupCur('đ') === 'VND' && fhDedupCur('usd') === 'USD');

console.log('\n-- a counterparty that is a bank is a posting notice, not a merchant --');
v = run([cand({ amount: 253900, at: '2026-08-30T10:17', desc: 'Thanh toan dich vu - hang hoa', cp: 'Foody', prov: 'VIB', kind: 'bank', shape: 'bank_txn', ak: 'credit_card' }),
         cand({ amount: 253900, at: '2026-09-02T11:28', desc: 'Ngân hàng TMCP Quốc tế Việt Nam', cp: 'Ngân hàng TMCP Quốc tế Việt Nam', prov: 'VIB', kind: 'bank', shape: 'bank_txn', ak: 'credit_card' })]);
t('same type, same card, but one names the bank itself: likely', tier(v[1]) === 'likely' && v[1].why === 'same_bank_pair', tier(v[1]));
t('fhDedupBankNamed reads the bank words', fhDedupBankNamed('Ngân hàng TMCP Quốc tế Việt Nam') && fhDedupBankNamed('VIB Bank') && !fhDedupBankNamed('Foody') && !fhDedupBankNamed('AEON'));

console.log('\n-- in-queue: the same bank twice --');
v = run([cand({ amount: 253900, at: '2026-08-30T10:17', desc: 'Foody', prov: 'VIB', kind: 'bank', shape: 'bank_txn', ak: 'deposit' }),
         cand({ amount: 253900, at: '2026-09-02T11:28', desc: 'VIB', prov: 'VIB', kind: 'bank', shape: 'bank_txn', ak: 'credit_card' })]);
t('two shapes of one purchase (account alert, then card posting): likely', tier(v[1]) === 'likely' && v[1].why === 'same_bank_pair', tier(v[1]));
v = run([cand({ amount: 10000, at: '2026-08-13T18:20', desc: 'CAO THAI DUY HIEN', prov: 'Vietcombank', kind: 'bank', shape: 'bank_txn' }),
         cand({ amount: 10000, at: '2026-08-13T23:49', desc: 'CAO THAI DUY HIEN', prov: 'Vietcombank', kind: 'bank', shape: 'bank_txn' })]);
t('the same shape twice is two real transfers (Trang\'s 44 topups): nothing', tier(v[1]) === 'none', tier(v[1]));

console.log('\n-- the pipeline flag: shown, overruled only with proof --');
v = run([cand({ amount: 50000, at: '2026-08-16T10:00', desc: 'Cà phê', prov: 'MB Bank', kind: 'bank', pipelineDupOf: 'abc' })], [], [], { kindById: () => '' });
t('a flag whose partner is unknown stands', tier(v[0]) === 'likely' && v[0].why === 'pipeline', tier(v[0]));
var c2 = cand({ amount: 2000, at: '2026-08-21T10:00', desc: 'x', prov: 'Vietcombank', kind: 'bank', pipelineDupOf: 'mb-1' });
v = run([c2], [], [], { kindById: (id) => id === 'mb-1' ? 'bank' : '' });
t('bank vs bank is overruled and recorded', tier(v[0]) === 'none' && c2.pipelineDupOverruled === true, tier(v[0]));

console.log('\n-- the ledger beats the queue --');
v = run([cand({ amount: 200000, at: '2026-08-16T10:00', desc: 'TT POS 1234', prov: 'MB Bank', kind: 'bank' }),
         cand({ amount: 200000, at: '2026-08-16T10:05', desc: 'GRAB RIDE', prov: 'Grab', kind: 'other' })],
        [fam({ day: '2026-08-16', amtD: 200000, note: 'Grab ride' })]);
t('a booked twin wins over an in-queue suspicion', tier(v[1]) === 'sure' && v[1].twinKind === 'ledger', tier(v[1]));

console.log('\n-- units: base-unit ledger rows against đồng candidates --');
v = run([cand({ amount: 92500, at: '2026-08-29T14:05', desc: 'SHOPEE - VIETNAM 87821624' })],
        [fam({ day: '2026-08-29', amtD: 92500, note: 'SHOPEE - VIETNAM 87821624' })]);
t('92.5 stored is 92.500đ staged', tier(v[0]) === 'sure', tier(v[0]));

console.log('\n' + (fail === 0 ? 'ALL ' + pass + ' PASSED' : pass + ' passed, ' + fail + ' FAILED'));
process.exit(fail ? 1 : 0);
