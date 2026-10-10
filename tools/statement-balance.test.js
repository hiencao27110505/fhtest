#!/usr/bin/env node
/* Statement balance (docs/specs/statement-balance-spec.md): a statement sets the
 * account, the ledger brings it to today.
 * `node tools/statement-balance.test.js`
 *
 * Two pure pieces are run for real, the way the app runs them:
 *   59-statement-table.js  fhStmtAccountFacts  what a parsed file says about the account
 *   19-anchor.js           the dated anchor    which ledger rows the statement already contains
 * against the three synthetic statement layouts and against rows shaped like the
 * ledger's own (base units of 1.000đ, the sign convention of fhPersonalBalance).
 * The wiring into the module-scoped files is guarded by source shape, in the
 * style of account-setup.test.js.
 *
 * The cases are the ones the real files produced on 2026-10-10: a wallet whose
 * newest row belongs to another pocket and shows 0 ₫, a card statement that
 * prints the limit and both dates, an account statement opened months late.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const R = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const S = require(path.join(ROOT, 'src', 'js-ui', '59-statement-table.js'));
const A = require(path.join(ROOT, 'src', 'js-ui', '19-anchor.js'));
const grid = (n) => JSON.parse(R('tools/fixtures/statements/' + n + '.grid.json'));
const man = JSON.parse(R('tools/fixtures/statements/manifest.json')).fixtures;
const meta = (f) => man.find((m) => m.file.indexOf(f) === 0);

let pass = 0, fail = 0;
const t = (n, ok, d) => { console.log((ok ? '  PASS  ' : '  FAIL  ') + n + (!ok && d !== undefined ? '  -> ' + JSON.stringify(d) : '')); ok ? pass++ : fail++; };
const near = (a, b) => Math.abs(a - b) < 1e-6;

/* ── what the file says about the account ─────────────────────────────────── */
console.log('\n-- bank account: the closing balance, as of the period\'s last day --');
const bank = S.fhStmtParse(grid('bank-account'), null, { provider: 'VIB' });
const fb = S.fhStmtAccountFacts(bank, 'deposit');
t('a balance is taken', fb.ok === true && fb.how === 'closing', fb);
t('it is the printed closing balance', fb.balDong === meta('bank-account').closing, fb.balDong);
t('true for the END of the period, not the last row\'s day (the month ran three more quiet days)', fb.asof === '2026-08-31' && fb.from === '2026-08-01', [fb.from, fb.asof]);
t('the edge is one day', fb.open === 1);
t('every row of the file rides along as [day, signed đồng]', fb.rows.length === meta('bank-account').rows && fb.rows.every((x) => /^\d{4}-\d\d-\d\d$/.test(x[0]) && Number.isInteger(x[1])));
t('...and nothing else: no words, no names, no numbers of accounts', JSON.stringify(fb.rows).replace(/[\d\-\[\],"]/g, '') === '');
t('the print date is read, and is not mistaken for the balance\'s day', fb.stmtDate === '2026-09-01');

console.log('\n-- credit card: the debt, the limit and both dates --');
const card = S.fhStmtParse(grid('credit-card'), null, { provider: 'VIB' });
const fc = S.fhStmtAccountFacts(card, 'credit_card');
t('a balance is taken, from the debt summary', fc.ok === true && fc.how === 'debt', fc);
t('stored NEGATIVE: a debt is a negative asset', fc.balDong === -Math.round(meta('credit-card').closing_debt), fc.balDong);
t('true for the statement date', fc.asof === '2026-08-31');
t('the edge is five days (a purchase can post after the statement date)', fc.open === 5);
t('credit limit', fc.limitDong === 50000000, fc.limitDong);
t('statement date and due date', fc.stmtDate === '2026-08-31' && fc.dueDate === '2026-09-15', [fc.stmtDate, fc.dueDate]);
t('minimum payment', fc.minDong === 75976, fc.minDong);
t('the auto-debit account: its last four digits and no more', fc.autoDebitTail === '3444' && !/000111222333444/.test(JSON.stringify(fc)));
t('"Phương thức thanh toán: Thu Nợ Tối Thiểu" is not read as the minimum payment', card.summary.minPayment === 75976);
t('the card\'s own number is still the account tail, not the auto-debit account', card.summary.accountTail === '6789');
{
  const unproved = JSON.parse(JSON.stringify(card)); unproved.proof.ok = false; unproved.proof.totals = false;
  const f = S.fhStmtAccountFacts(unproved, 'credit_card');
  t('a reading the totals do not prove gives no balance...', f.ok === false && f.why === 'unproved' && f.balDong === undefined, f.why);
  t('...and still gives the card facts it read', f.limitDong === 50000000 && f.dueDate === '2026-09-15');
}

console.log('\n-- wallet: the last row ON THE PROVED CHAIN --');
const wal = S.fhStmtParse(grid('ewallet'), null, { provider: 'MoMo' });
const fw = S.fhStmtAccountFacts(wal, 'ewallet');
t('a balance is taken off the running chain', fw.ok === true && fw.how === 'chain', fw);
t('it is the wallet\'s closing figure', fw.balDong === Math.round(meta('ewallet').closing), fw.balDong);
t('payments funded from a linked bank never moved this balance and are left out of the rows',
  fw.rows.length === wal.rows.filter((r) => !r.unmoved && !(r.cls && r.cls.fundedElsewhere)).length && fw.rows.length < wal.rows.length, [fw.rows.length, wal.rows.length]);
{
  /* The real file's ending: one more row, two days later, from another pocket,
     showing 0 ₫. The newest row is not the balance. */
  const g = grid('ewallet');
  const hdr = g[0], first = g[1].slice();
  const iTime = hdr.findIndex((h) => /Thời gian/.test(h)), iAmt = hdr.findIndex((h) => /Số Tiền/.test(h)), iBal = hdr.findIndex((h) => /Số Dư/.test(h)), iType = hdr.findIndex((h) => /Loại giao dịch/.test(h));
  const other = first.slice(); other[iTime] = '29/08/2026 05:13:06'; other[iAmt] = '-500.0'; other[iBal] = '0.0'; other[iType] = 'Thu hồi tiền hoàn quá hạn';
  const g2 = [hdr, other].concat(g.slice(1));
  const p2 = S.fhStmtParse(g2, null, { provider: 'MoMo' }), f2 = S.fhStmtAccountFacts(p2, 'ewallet');
  t('a newest row from another pocket (0 ₫) does not become the balance', f2.ok === true && f2.balDong === Math.round(meta('ewallet').closing), f2.balDong);
  t('the balance keeps the day of the row it came from', f2.asof === '2026-08-27', f2.asof);
  t('the trailing row is not among the rows the balance contains', f2.rows.every((x) => x[0] <= '2026-08-27'));
  /* Three rows the proof could not place after the chain's last row: the end of
     the file is not understood, so its balance is not taken. */
  const p3 = JSON.parse(JSON.stringify(wal));
  for (let k = 0; k < 3; k++) p3.rows.push({ i: 900 + k, date: '2026-08-' + (29 + k), time: '05:13', amt: -500, bal: 0, broken: true, cls: {} });
  const f3 = S.fhStmtAccountFacts(p3, 'ewallet');
  t('more than two rows trailing the chain: the file\'s end is not understood, no balance', f3.ok === false && f3.why === 'trailing', [f3.ok, f3.why]);
}
{
  const p = JSON.parse(JSON.stringify(bank)); p.summary.closing = p.summary.closing + 5000;
  const f = S.fhStmtAccountFacts(p, 'deposit');
  t('closing balance and last running balance disagree: no number is taken (SB11)', f.ok === false && f.why === 'conflict', f.why);
}
t('no table, no facts', S.fhStmtAccountFacts(S.fhStmtParse([['Xin chào']]), 'deposit').ok === false);

/* ── the dated anchor ──────────────────────────────────────────────────────── */
const row = (id, date, kind, amt, extra) => Object.assign({ id: id, accountId: 'acc', date: date, kind: kind, amt: amt, ts: date + 'T05:00:00.000Z' }, extra || {});
const stmtAcct = (facts, state) => {
  const m = A.fhAnchorMetaOf(facts, state || 'set', 1000);
  return { id: 'acc', kind: facts.kind, anchorK: state === 'offer' ? null : m.k, anchorAt: state === 'offer' ? null : A.fhAnchorAtOf(facts.asof), anchorMeta: m };
};

console.log('\n-- a typed anchor walks exactly as before (full-ledger-spec §5.1) --');
{
  const acct = { id: 'acc', kind: 'deposit', anchorK: 1000, anchorAt: '2026-09-10T03:00:00.000Z', anchorMeta: null };
  const day = (() => { const d = new Date(acct.anchorAt); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); })();
  const rows = [
    row('a', '2026-09-01', 'expense', 50),                                             // before the anchor day: inside
    row('b', day, 'expense', 30, { ts: '2026-09-10T02:00:00.000Z' }),                  // same day, logged before: inside
    row('c', day, 'expense', 20, { ts: '2026-09-10T04:00:00.000Z' }),                  // same day, logged after: counts
    row('d', '2026-09-12', 'income', 500), row('e', '2026-09-13', 'transfer', -200),
    row('f', '2026-09-13', 'loan', 100), row('g', '2026-09-14', 'repayment', 40),
    row('h', '2026-09-14', 'expense', 999, { accountId: 'other' }),                    // another account
    row('i', '2026-09-14', 'expense', null, { _unreadable: true }),                    // unreadable: never a zero, never counted
  ];
  const w = A.fhAnchorWalk(acct, rows, { mult: 1000 });
  t('anchor − 20 + 500 − 200 − 100 + 40', near(w.bal, 1000 - 20 + 500 - 200 - 100 + 40), w.bal);
  t('five rows came after it', w.later.n === 5 && w.stmt === false);
  t('`upto` stops the walk at a day', near(A.fhAnchorWalk(acct, rows, { mult: 1000, upto: '2026-09-12' }).bal, 1000 - 20 + 500));
  t('no anchor, no number', A.fhAnchorWalk({ id: 'acc', anchorK: null }, rows) === null);
  t('its day is the local day it was typed', A.fhAnchorAsof(acct) === day);
}

console.log('\n-- an anchor read from an account statement --');
{
  const acct = stmtAcct(fb);                       // 23.987.250đ as of 2026-08-31; the file's last row is 28/08
  const base = fb.balDong / 1000;
  t('anchor_at is the END of the statement\'s last day, and the as-of day reads back', A.fhAnchorAsof(acct) === '2026-08-31' && acct.anchorAt === new Date('2026-08-31T23:59:59+07:00').toISOString());
  const rows = [
    row('1', '2026-08-03', 'income', 18000, { src: 'direct-email' }),       // in the file: inside
    row('2', '2026-08-10', 'expense', 777, { src: null }),                  // NOT in the file, inside the period: the statement is the authority, inside
    row('3', '2026-08-31', 'expense', 45, { ts: '2026-09-02T00:00:00.000Z' }),   // on the edge day, not in the file: after the statement
    row('4', '2026-09-01', 'expense', 100), row('5', '2026-09-05', 'income', 2000),
  ];
  const w = A.fhAnchorWalk(acct, rows, { mult: 1000 });
  t('rows after the last day are added', w.later.n === 3 && near(w.bal, base - 45 - 100 + 2000), [w.later.n, w.bal - base]);
  t('a row inside the period is inside the balance even when the file does not list it', near(A.fhAnchorWalk(acct, rows.slice(0, 2), { mult: 1000 }).bal, base));
  t('importing the statement\'s own rows later moves nothing', near(A.fhAnchorWalk(acct, fb.rows.map((x, i) => row('s' + i, x[0], x[1] < 0 ? 'expense' : 'income', Math.abs(x[1]) / 1000, { ts: '2026-10-10T00:00:00.000Z', src: 'statement-email' })), { mult: 1000 }).bal, base));
}
{
  /* An export made mid-day: the file's last row IS on the as-of day. */
  const facts = { ok: true, kind: 'ewallet', balDong: 3000000, asof: '2026-09-16', from: '2026-06-20', open: 1, how: 'chain',
    rows: [['2026-09-10', -10000], ['2026-09-16', -52000], ['2026-09-16', -39000], ['2026-09-16', -39000]] };
  const acct = stmtAcct(facts);
  const rows = [
    row('a', '2026-09-16', 'expense', 52), row('b', '2026-09-16', 'expense', 39), row('c', '2026-09-16', 'expense', 39),
    row('d', '2026-09-16', 'expense', 39),         // a THIRD 39.000đ ride that day: the file lists two, so this one came after
    row('e', '2026-09-16', 'expense', 75),         // the afternoon, after the export
  ];
  const w = A.fhAnchorWalk(acct, rows, { mult: 1000 });
  t('on the edge day a row matching a file row is inside', w.later.n === 2, w.later);
  t('each file row absorbs ONE ledger row: two 39.000đ in the file, three in the ledger, one is added', near(w.bal, 3000 - 39 - 75), w.bal);
  t('the answer does not depend on the order the rows arrive in', near(A.fhAnchorWalk(acct, rows.slice().reverse(), { mult: 1000 }).bal, w.bal));
}

console.log('\n-- an anchor read from a card statement --');
{
  const acct = stmtAcct(fc);                       // −1.519.522đ as of 2026-08-31, edge 27/08–31/08; the file lists 236.000 on 27/08
  const base = fc.balDong / 1000;
  const rows = [
    row('1', '2026-08-27', 'expense', 236),                  // on the statement
    row('2', '2026-08-30', 'expense', 120),                  // dated before the statement date, NOT on it: posted after, belongs to the next one
    row('3', '2026-08-20', 'expense', 412.3),                // before the edge: inside
    row('4', '2026-08-15', 'expense', 55),                   // before the edge and not in the file: still inside
    row('5', '2026-09-02', 'expense', 300),                  // after
    row('6', '2026-09-05', 'transfer', 1519.522),            // the payment
  ];
  const w = A.fhAnchorWalk(acct, rows, { mult: 1000 });
  t('a purchase in the last five days that the statement does not list is counted', w.later.n === 3, w.later);
  t('debt after: closing + in-flight + new purchase − payment', near(-w.bal, 1519.522 + 120 + 300 - 1519.522), -w.bal);
  t('a base amount with a fraction (15.822đ) matches its đồng figure exactly',
    near(A.fhAnchorWalk(Object.assign({}, acct, { anchorMeta: Object.assign({}, acct.anchorMeta, { rows: [['2026-08-29', -15822]] }) }), [row('x', '2026-08-29', 'expense', 15.822)], { mult: 1000 }).bal, base));
}
{
  /* A foreign charge: the ledger holds the app's estimate, the statement the settled figure. */
  const facts = { ok: true, kind: 'credit_card', balDong: -3000000, asof: '2026-08-31', from: '2026-08-01', open: 5, how: 'debt', rows: [['2026-08-29', -2938860]] };
  const acct = stmtAcct(facts);
  const est = row('e', '2026-08-29', 'expense', 2900, { note: 'Claude [111 USD @26,350 +3% est.]' });
  t('an estimate-marked row matches the settled row of its day within 6%', near(A.fhAnchorWalk(acct, [est], { mult: 1000 }).bal, -3000));
  t('the same gap with no estimate marker is two purchases', near(A.fhAnchorWalk(acct, [Object.assign({}, est, { note: 'Claude' })], { mult: 1000 }).bal, -3000 - 2900));
  t('an estimate too far off (10%) is not absorbed', near(A.fhAnchorWalk(acct, [Object.assign({}, est, { amt: 2600 })], { mult: 1000 }).bal, -3000 - 2600));
}

console.log('\n-- what a statement may do to an account (SB6, SB7) --');
{
  const none = { id: 'acc', kind: 'deposit', anchorK: null, anchorMeta: null };
  t('no number yet: the statement is OFFERED', A.fhAnchorDecide(none, fb) === 'offer');
  const offered = stmtAcct(fb, 'offer');
  t('an offer is not a balance', A.fhAnchorWalk(offered, []) === null && A.fhAnchorOffer(offered) !== null && A.fhAnchorMetaSet(offered) === null);
  t('a newer statement replaces the offer', A.fhAnchorDecide(offered, Object.assign({}, fb, { asof: '2026-09-30' })) === 'offer');
  t('an older statement does not', A.fhAnchorDecide(offered, Object.assign({}, fb, { asof: '2026-07-31' })) === 'keep');
  const set = stmtAcct(fb);
  t('confirmed once, a NEWER statement re-anchors with no question', A.fhAnchorDecide(set, Object.assign({}, fb, { asof: '2026-09-30' })) === 'set');
  t('the same statement again changes nothing', A.fhAnchorDecide(set, fb) === 'keep');
  t('an old statement opened late changes nothing', A.fhAnchorDecide(set, Object.assign({}, fb, { asof: '2026-04-27' })) === 'keep');
  const typedLater = { id: 'acc', kind: 'deposit', anchorK: 5, anchorAt: '2026-09-20T05:00:00.000Z', anchorMeta: null };
  t('a number typed AFTER the statement\'s last day stays', A.fhAnchorDecide(typedLater, fb) === 'keep');
  t('a number typed BEFORE it gives way to the newer statement', A.fhAnchorDecide(Object.assign({}, typedLater, { anchorAt: '2026-08-05T05:00:00.000Z' }), fb) === 'set');
  t('a statement with no balance does nothing', A.fhAnchorDecide(none, { ok: false, asof: '2026-08-31' }) === 'none');
  const m = A.fhAnchorMetaOf(Object.assign({ sid: 'S1' }, fc), 'offer', 1000);
  t('the meta: version, source, the statement, base units, asset view', m.v === 1 && m.src === 'stmt' && m.sid === 'S1' && near(m.k, -1519.522) && m.open === 5 && m.asof === '2026-08-31');
  const big = { ok: true, kind: 'deposit', balDong: 1, asof: '2026-08-31', rows: Array.from({ length: 900 }, (_, i) => ['2026-08-01', i]) };
  t('the meta keeps the newest 400 rows of a long file', A.fhAnchorMetaOf(big, 'set', 1000).rows.length === 400 && A.fhAnchorMetaOf(big, 'set', 1000).rows[399][1] === 899);
}

console.log('\n-- coverage, and which figure a tile leads with (SB9, SB10) --');
{
  const acct = stmtAcct(fb), base = fb.balDong / 1000;
  const ledgerOf = (pick, src) => fb.rows.filter(pick).map((x, i) => row('k' + i, x[0], x[1] < 0 ? 'expense' : 'income', Math.abs(x[1]) / 1000, { src: src }));
  const after = [row('z1', '2026-09-03', 'expense', 100), row('z2', '2026-09-04', 'expense', 50)];
  const all = ledgerOf(() => true, 'direct-email');
  const cAll = A.fhAnchorCoverage(acct, all, { mult: 1000 });
  t('every row of the file already in the ledger from mail: coverage 1', cAll.k === cAll.n && near(cAll.share, 1), cAll);
  const outOnly = ledgerOf((x) => x[1] < 0, 'direct-email');
  const cOut = A.fhAnchorCoverage(acct, outOnly, { mult: 1000 });
  t('money in never reached the ledger: most rows covered, little of the money', cOut.k / cOut.n > 0.6 && cOut.share < 0.5, [cOut.k, cOut.n, cOut.share]);
  t('rows that entered the ledger FROM a statement prove nothing about the feed', A.fhAnchorCoverage(acct, ledgerOf(() => true, 'statement-email'), { mult: 1000 }).share === 0);
  const v0 = A.fhAnchorView(acct, all, { mult: 1000 });
  t('nothing after the statement: the statement number, as current', v0.mode === 'current' && near(v0.shown, base) && v0.later.n === 0 && v0.src === 'stmt' && v0.asof === '2026-08-31');
  const v1 = A.fhAnchorView(acct, all.concat(after), { mult: 1000 });
  t('rows after it, well covered: the brought-forward figure leads', v1.mode === 'current' && near(v1.shown, base - 150) && v1.later.n === 2);
  const v2 = A.fhAnchorView(acct, outOnly.concat(after), { mult: 1000 });
  t('rows after it, thinly covered: the DATED statement number leads', v2.mode === 'dated' && near(v2.shown, base) && near(v2.later.sum, -150));
  t('...and totals still read the brought-forward figure', near(v2.bal, base - 150));
  t('a typed anchor is always shown as current', A.fhAnchorView({ id: 'acc', kind: 'deposit', anchorK: 10, anchorAt: '2026-01-01T00:00:00.000Z', anchorMeta: null }, after, { mult: 1000 }).mode === 'current');
  t('the bar is 95% of the money', A.ANCHOR_COV_MIN === 0.95);
}

/* ── the wiring, by source shape ───────────────────────────────────────────── */
console.log('\n-- wiring --');
const data = R('src/js-data/19-personal.js'), debts = R('src/js-data/23-debts-ui.js');
const stm = R('src/js-data/77-statement-capture.js'), review = R('src/js-data/72-txn-review.js');
const mig = R('supabase/migrations/0160_anchor_meta.sql');
t('0160 adds ONE nullable sealed column and nothing else', /alter table public\.personal_accounts\s+add column if not exists anchor_meta_enc text;/.test(mig) && (mig.replace(/^--.*$/gm, '').match(/;/g) || []).length === 1);
t('the accounts read asks for the column and falls back when the database has none (SB16)',
  /async function _acctSelect\(\) \{[\s\S]{0,420}_ACCT_COLS \+ ',anchor_meta_enc'[\s\S]{0,160}_acctMetaCol = false;[\s\S]{0,60}return q\(_ACCT_COLS\);/.test(data) && /_acctSelect\(\),/.test(data));
t('a missing column is recognised by its code or its name', /String\(err\.code \|\| ''\) === '42703' \|\| \/anchor_meta_enc\/i/.test(data));
t('the balance is the pure walk, over every account-tagged row (P.debts), in đồng',
  /window\.fhPersonalBalance = function \(acctId, upto\) \{[\s\S]{0,160}if \(!a \|\| a\.anchorK == null\) return null;[\s\S]{0,60}window\.fhAnchorWalk\(a, P\.debts, \{ mult: _pMult\(\), upto: upto \|\| null \}\)/.test(data));
t('debt rows carry their source, so coverage can leave statement rows out', /label_id,source'\)\.eq\('owner_user_id', P\.uid\)\.or\('kind\.neq\.expense,account_id\.not\.is\.null'\)/.test(data) && /src: t\.source \|\| null,\s+positionId/.test(data));
t('the drift badge reads the ledger as of the bank\'s own day (SB13)', /window\.fhPersonalBalance\(acctId, a\.extDate \|\| undefined\)/.test(data) && /const asof = window\.fhAnchorAsof\(a\);/.test(data));
t('a typed number clears the statement meta, in the wizard\'s write and in the anchor sheet\'s',
  /fields\.hasOwnProperty\('anchorMeta'\) \|\| row\.anchor_balance_enc\)\) \{\s+row\.anchor_meta_enc = fields\.anchorMeta \? await _encP\(JSON\.stringify\(fields\.anchorMeta\)\) : null;/.test(data)
  && /_acctMetaCol \? \{ anchor_meta_enc: null \} : \{\}\)\)\.eq\('id', acctId\)/.test(data));
t('a statement anchor is written with the statement\'s day, not with now', /row\.anchor_at = fields\.anchorAt \|\| new Date\(\)\.toISOString\(\);/.test(data));
t('the sealed column joins the regen sweep (a column left out is lost on a new card)',
  /_acQ\(_acCols \+ ',anchor_meta_enc'\)/.test(data) && /_acctMetaCol \? \{ anchor_meta_enc: await reEnc\(r\.anchor_meta_enc\) \} : \{\}/.test(data));
t('the paint signature sees an offer arrive or an anchor move', /a\.anchorMeta \? a\.anchorMeta\.state \+ '@' \+ a\.anchorMeta\.asof \+ '@' \+ a\.anchorMeta\.k/.test(data));
t('card facts fill EMPTY fields only (SB8)', /facts\.limitDong > 0 && !\(a\.limitK > 0\)/.test(data) && /dayOf\(facts\.stmtDate\) && !a\.statementDay/.test(data) && /dayOf\(facts\.dueDate\) && !a\.dueDay/.test(data));
t('a statement and an account that disagree on card-or-not are never mixed', /const act = \(_acctMetaCol && sameSide\) \? window\.fhAnchorDecide\(a, facts\) : 'none';/.test(data));
t('the statement hands its facts over once the rows are staged, tap flow and unattended alike',
  /await _rpc\('stage_statement_rows'[\s\S]{0,1400}if \(acctId\) _stmAccountFacts\(X, acctId\);/.test(stm) && /let acctId = null;/.test(stm));
t('...without being waited for', /Promise\.resolve\(window\.fhPersonalStmtFacts\(acctId, facts\)\)\.catch\(\(\) => \{\}\);/.test(stm));
t('statement rows no longer write the bank-stated balance at import (SB14)', /var _recBal = function \(acctId\) \{[\s\S]{0,420}if \(_sx2 && _sx2\._transport === 'statement'\) return;/.test(review));
t('a card statement feeds the tile line a due notice feeds, newest wins', /window\.fhAcctNoticeSet = async function \(acctId, f\)[\s\S]{0,260}String\(cur\.at\) > String\(f\.at\)\) return false;/.test(review));
t('the wizard opens pre-filled from the offer', /const offer = window\.fhAnchorOffer \? window\.fhAnchorOffer\(acct\) : null;\s+return \{ name: acct\.name \|\| '', kind: acct\.kind, amtK: offer \? Math\.abs\(offer\.k\) : null, amtSet: !!offer, offer: offer,/.test(debts));
t('keeping the statement\'s number stores it with the statement\'s day; typing another stays "true now"',
  /if \(_wzFromStmt\(d\) && isCard === \(w\.acct\.kind === 'credit_card'\)\) \{\s+fields\.anchorK = d\.offer\.k;\s+fields\.anchorAt = window\.fhAnchorAtOf\(d\.offer\.asof\);\s+fields\.anchorMeta = Object\.assign\(\{\}, d\.offer, \{ state: 'set' \}\);/.test(debts));
t('an offer shows no number on the tile, only the way in', /offer \? 'Xác nhận số từ sao kê' : 'Chạm để thiết lập'/.test(debts) && /<div class="dbt-tv num dim">—<\/div>/.test(debts));
t('tiles lead with `shown` and say how the number is known', /const bal = v \? v\.shown : /.test(debts) && /const out = \(v && v\.mode === 'dated'\) \? -v\.shown : c\.outstanding;/.test(debts) && /\(_anchorCap\(v\) \|\| kindLbl\)/.test(debts));

console.log('\n' + (fail ? fail + ' FAILED, ' : 'ALL ') + pass + ' PASSED');
process.exit(fail ? 1 : 0);
