#!/usr/bin/env node
/* The statement table reader, against synthetic copies of three real layouts.
 * `node tools/statement-table.test.js`
 *
 * What it has to survive (docs/specs/statement-capture-spec.md §15):
 *   bank account  header on row 15 under a preamble, debit/credit columns,
 *                 newest-first, day-only text dates, a holder-name auto-fill memo
 *   credit card   header on row 25 under merged cells, sub-header rows INSIDE the
 *                 table, totals rows after it, credits printed NEGATIVE, an MCC column
 *   e-wallet      headers on row 1, one signed column, to-the-second timestamps,
 *                 a failed row that still carries an amount, and debits that do not
 *                 move the wallet balance (paid from a linked bank)
 *
 * The proof's contract: a right reading reconciles nearly everything, a wrong one
 * nearly nothing. Both directions are tested.
 */
const fs = require('fs');
const path = require('path');
const S = require(path.join(__dirname, '..', 'src', 'js-ui', '59-statement-table.js'));
const FX = path.join(__dirname, 'fixtures', 'statements');
const grid = (n) => JSON.parse(fs.readFileSync(path.join(FX, n + '.grid.json'), 'utf8'));
const man = JSON.parse(fs.readFileSync(path.join(FX, 'manifest.json'), 'utf8')).fixtures;
const meta = (f) => man.find((m) => m.file.indexOf(f) === 0);

let pass = 0, fail = 0;
const t = (n, ok, d) => { console.log((ok ? '  PASS  ' : '  FAIL  ') + n + (!ok && d !== undefined ? '  -> ' + JSON.stringify(d) : '')); ok ? pass++ : fail++; };

console.log('\n-- numbers, as statements print them --');
t('plain integer', S.fhStmtNum('185000') === 185000);
t('float text', S.fhStmtNum('-2150000.0') === -2150000);
t('label-side total with commas', S.fhStmtNum(': 6,636,000 VND') === 6636000);
t('dots as thousands', S.fhStmtNum('6.636.000') === 6636000);
t('dots thousands, comma decimal', S.fhStmtNum('1.519.522,00') === 1519522);
t('commas thousands, dot decimal', S.fhStmtNum('1,519,522.00') === 1519522);
t('a lone 3-digit group is thousands', S.fhStmtNum('42.000') === 42000);
t('a real decimal stays a decimal', S.fhStmtNum('42000.5') === 42000.5);
t('accounting negative', S.fhStmtNum('(74,000)') === -74000);
t('no digits is null, not zero', S.fhStmtNum('Thu Nợ Tối Thiểu') === null);

console.log('\n-- dates: day first, clock only when given --');
t('day only', JSON.stringify(S.fhStmtDate('05/08/2026')) === JSON.stringify({ date: '2026-08-05', time: '', key: '2026-08-05 00:00:00' }));
t('to the second', S.fhStmtDate('13/08/2026 09:24:18').time === '09:24' && S.fhStmtDate('13/08/2026 09:24:18').key === '2026-08-13 09:24:18');
t('ISO from a date-styled cell', S.fhStmtDate('2026-08-05').date === '2026-08-05');
t('a sub-header is not a date', S.fhStmtDate('Số thẻ/ Số tài khoản') === null);
t('a month of 13 is not a date', S.fhStmtDate('05/13/2026') === null);

console.log('\n-- bank account: preamble, two columns, newest first --');
var a = S.fhStmtParse(grid('bank-account')), am = meta('bank-account');
t('table found under the preamble', a.table && a.table.headerIdx > 5, a.table && a.table.headerIdx);
t('roles: date, description, debit, credit, balance', ['date', 'description', 'debit', 'credit', 'balance'].every((k) => a.table.roles[k] !== undefined), a.table.roles);
t('every row read', a.rows.length === am.rows, a.rows.length);
t('summary read from side-by-side label pairs', a.summary.opening === am.opening && a.summary.closing === am.closing && a.summary.totalDebit === am.total_debit && a.summary.totalCredit === am.total_credit, a.summary);
t('period read', a.summary.period && a.summary.period.from === '2026-08-01' && a.summary.period.to === '2026-08-31', a.summary.period);
t('only the account TAIL is kept', a.summary.accountTail === '3444' && JSON.stringify(a.summary).indexOf('000111222333444') < 0);
t('proof passes on the running balance', a.proof.ok && a.proof.how === 'running' && a.proof.ratio === 1, a.proof);
t('and the totals agree too', a.proof.totals === true);
t('row order discovered: newest-first', a.proof.order === 'newest-first');
t('rows handed back oldest-first', a.rows[0].date === '2026-08-01' && a.rows[a.rows.length - 1].date === '2026-08-28');
t('money out is negative', a.rows[0].amt === -350000);
t('no clock invented for a day-only file', a.rows.every((r) => r.time === ''));
var memo = a.rows.filter((r) => r.cls.holderMemo);
t('holder-name auto-fill recognised', memo.length === 4, memo.length);
t('...it blanks the memo and sets no flow', memo.every((r) => r.cls.memo === '' && r.cls.flow === ''));
var toHoa = a.rows.find((r) => /LE THI HOA/.test(r.description));
t('the recipient is read out of the memo, account number dropped', toHoa.cls.counterparty === 'LE THI HOA' && toHoa.cls.person === true && !toHoa.cls.selfTransfer, toHoa.cls);
var toSelf = a.rows.find((r) => /den TRAN THI MAI/.test(r.description));
t('recipient == holder is the ONLY memo evidence of a self-transfer', toSelf.cls.selfTransfer === true && a.rows.filter((r) => r.cls.selfTransfer).length === 1);
t('a bare holder memo is never a self-transfer', a.rows.filter((r) => r.cls.holderMemo && !r.cls.counterparty).every((r) => !r.cls.selfTransfer));
t('someone else\'s name with a purpose is kept', a.rows.some((r) => /an trua/.test(r.cls.memo) && !r.cls.holderMemo));
t('wallet top-up wording', a.rows.filter((r) => r.cls.flow === 'topup').length === 2);
t('card repayment wording', a.rows.filter((r) => r.cls.flow === 'cardpay').length === 1);
t('a fee is a fee', a.rows.some((r) => r.cls.flow === 'fee' && /duy tri/.test(r.description)));
t('salary', a.rows.some((r) => r.cls.flow === 'salary' && r.amt === 18000000));

console.log('\n-- credit card: header row 25, sub-headers, totals, negative credits --');
var c = S.fhStmtParse(grid('credit-card')), cm = meta('credit-card');
t('table found deep in the sheet', c.table && c.table.headerIdx >= 10, c.table && c.table.headerIdx);
t('two-line bilingual headers resolve', ['date', 'postDate', 'description', 'mcc', 'debit', 'credit'].every((k) => c.table.roles[k] !== undefined), c.table.roles);
t('transaction date and post date are different columns', c.table.roles.date !== c.table.roles.postDate);
t('sub-header and totals rows are not transactions', c.rows.length === cm.rows, c.rows.length);
t('a NEGATIVE credit is still money in', c.rows.filter((r) => r.amt > 0).length === 1 && c.rows.find((r) => r.amt > 0).amt === 2150000);
t('summary: previous and closing debt', c.summary.prevDebt === cm.previous_debt && c.summary.endDebt === cm.closing_debt, c.summary);
t('proof passes on totals (no running balance here)', c.proof.ok && c.proof.how === 'totals', c.proof);
t('MCC is the leading code only', c.rows.some((r) => r.mcc === '5812') && c.rows.every((r) => /^\d{4}$/.test(r.mcc)));
t('the row uses the TRANSACTION date, not the post date', c.rows.some((r) => /Foody/.test(r.description) && r.date === '2026-08-02'));
t('repayment recognised', c.rows.filter((r) => r.cls.flow === 'cardpay').length === 1);
t('FX fee is a fee', c.rows.some((r) => r.cls.flow === 'fee' && /Ngoại Tệ/.test(r.description)));
t('card tail only', c.summary.accountTail === '6789', c.summary.accountTail);

console.log('\n-- e-wallet: signed column, failed rows, payments funded elsewhere --');
var w = S.fhStmtParse(grid('ewallet')), wm = meta('ewallet');
t('headers on the first row', w.table && w.table.headerIdx === 0);
t('roles incl. names before accounts', ['date', 'ref', 'description', 'fromAcct', 'fromName', 'toAcct', 'toName', 'amount', 'balance', 'status'].every((k) => w.table.roles[k] !== undefined), w.table.roles);
t('names and accounts did not collide', new Set(['fromAcct', 'fromName', 'toAcct', 'toName'].map((k) => w.table.roles[k])).size === 4);
t('the failed row is dropped and counted', w.failed === wm.failed && w.rows.length === wm.rows - wm.failed, { failed: w.failed, rows: w.rows.length });
t('proof passes though two rows did not move the balance', w.proof.ok && w.proof.how === 'running' && w.proof.strict < 0.9 && w.proof.ratio >= 0.9, { strict: w.proof.strict, ratio: w.proof.ratio });
var un = w.rows.filter((r) => r.unmoved);
t('rows that did not move the balance are marked', un.length === wm.bank_funded, un.map((r) => r.description));
t('...and read as funded elsewhere', un.every((r) => r.cls.fundedElsewhere));
t('...with the funding source named', un.every((r) => r.cls.funding !== ''), un.map((r) => r.cls.funding));
t('a named bank is recognised as a bank', un.some((r) => r.cls.fundingIsBank && r.cls.funding === 'VIB'));
t('an ordinary wallet payment is not', w.rows.filter((r) => /EVERY HALF/.test(r.description)).every((r) => !r.cls.fundedElsewhere));
t('exact key: the wallet\'s own transaction id', w.rows.every((r) => /^\d{11}$/.test(r.ref)));
t('clock kept to the minute', w.rows.every((r) => /^\d\d:\d\d$/.test(r.time)));
t('top-up from a bank', w.rows.filter((r) => r.cls.flow === 'topup').length === 2);
t('a person is a person, a merchant is not', w.rows.find((r) => /Lê Thị Hoa/.test(r.description)).cls.person === true && w.rows.find((r) => /REVI/.test(r.description)).cls.person === false);
t('counterparty is the OTHER side', w.rows.find((r) => /REVI/.test(r.description)).cls.counterparty === 'REVI COFFEE' && w.rows.find((r) => /Nguyễn Văn Bình/.test(r.description)).cls.counterparty === 'Nguyễn Văn Bình');
t('refund and salary', w.rows.some((r) => r.cls.flow === 'refund') && w.rows.some((r) => r.cls.flow === 'salary'));

console.log('\n-- a WRONG reading reconciles nothing --');
var good = S.fhStmtFindTable(grid('ewallet'));
var swapped = Object.assign({}, good.roles, { amount: good.roles.balance, balance: good.roles.amount });
var bad = S.fhStmtParse(grid('ewallet'), swapped);
t('balance taken for amount: proof refuses', bad.proof.ok === false && bad.proof.ratio < 0.2, { ratio: bad.proof.ratio });
var flat = S.fhStmtParse(grid('ewallet'), Object.assign({}, good.roles, { balance: good.roles.status }));
t('a constant column taken for the balance cannot prove itself', flat.proof.ok === false, { ratio: flat.proof.ratio });
var g2 = S.fhStmtFindTable(grid('bank-account'));
var bad2 = S.fhStmtParse(grid('bank-account'), Object.assign({}, g2.roles, { debit: g2.roles.credit, credit: g2.roles.debit }));
t('debit and credit swapped: proof refuses', bad2.proof.ok === false, bad2.proof);

console.log('\n-- never throws on a strange file --');
t('empty grid', S.fhStmtParse([]).table === null);
t('a sheet with no table', S.fhStmtParse([['Xin chào'], ['Không có bảng nào ở đây']]).table === null);
t('header signature carries labels, never values', /so tien/.test(w.sig) && !/\d{5,}/.test(w.sig));

console.log('\n' + (fail ? fail + ' FAILED, ' : 'ALL ') + pass + ' PASSED');
process.exit(fail ? 1 : 0);
