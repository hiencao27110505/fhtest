#!/usr/bin/env node
/* A parsed statement row -> the exact shape of an OPENED bank-email row.
 * `node tools/statement-rows.test.js`
 *
 * The whole client design rests on one claim: a statement row handed to the review
 * is indistinguishable, to everything downstream, from a row opened out of
 * email_transactions. 72's accessors, the kinds in 57, the dedup engine and import
 * then need no second code path. This pins the conventions those readers rely on
 * (docs/specs/statement-capture-spec.md section 11):
 *   - a day-only row sits at UTC midnight, which fhStagedRowTime and the richest-copy
 *     merge already read as "no clock" -- so no time is invented and two honest
 *     same-amount purchases of one day are never merged
 *   - a card repayment is flow:'transfer'; a top-up and a recipient==holder memo are
 *     the ONLY things pre-set as an internal transfer, and both ask for a look
 *   - a wallet payment funded by a bank is tagged to the bank, never the wallet
 *   - nothing from the file's preamble (ID, address, full account number) rides along
 */
const fs = require('fs');
const path = require('path');
const T = require(path.join(__dirname, '..', 'src', 'js-ui', '59-statement-table.js'));
const FX = path.join(__dirname, 'fixtures', 'statements');
const grid = (n) => JSON.parse(fs.readFileSync(path.join(FX, n + '.grid.json'), 'utf8'));

// 77 is an IIFE that publishes on `window`; give it one, and the MCC table it reads.
const window = {};
const src57 = fs.readFileSync(path.join(__dirname, '..', 'src', 'js-ui', '57-csv-import-review.js'), 'utf8');
const mccSrc = src57.slice(src57.indexOf('var CSV_MCC_CONCEPT = {'), src57.indexOf('};', src57.indexOf('var CSV_MCC_CONCEPT = {')) + 2);
const CSV_MCC_CONCEPT = new Function(mccSrc + '; return CSV_MCC_CONCEPT;')();
new Function('window', 'CSV_MCC_CONCEPT', 'L', '_esc', '_escAttr', '_rpc', 'localStorage', 'sessionStorage', 'document', 'crypto',
  fs.readFileSync(path.join(__dirname, '..', 'src', 'js-data', '77-statement-capture.js'), 'utf8'))(
  window, CSV_MCC_CONCEPT, (vi) => vi, (s) => s, (s) => s, async () => null, { getItem() { return null; }, setItem() {}, removeItem() {} }, { setItem() {} }, {}, require('crypto').webcrypto);

let pass = 0, fail = 0;
const t = (n, ok, d) => { console.log((ok ? '  PASS  ' : '  FAIL  ') + n + (!ok && d !== undefined ? '  -> ' + JSON.stringify(d) : '')); ok ? pass++ : fail++; };
const stage = (parsed, acct) => parsed.rows.map((r, i) => window.fhStmtAsStaged('id' + i, window.fhStmtRowPayload(r, acct, 'S1')));

console.log('\n-- bank account statement --');
var bank = T.fhStmtParse(grid('bank-account'));
var B = stage(bank, { provider: 'VIB', kind: 'deposit', tail: bank.summary.accountTail });
t('every row is marked as a statement row, with its statement', B.every((r) => r._stmt === true && r.statement_id === 'S1'));
t('day-only rows sit at UTC midnight: no clock invented', B.every((r) => /T00:00:00Z$/.test(r.occurred_at)));
t('...which the existing "date-only" test reads as no time', B.every((r) => { const d = new Date(r.occurred_at); return d.getUTCHours() === 0 && d.getUTCMinutes() === 0 && d.getUTCSeconds() === 0; }));
t('amount is positive, direction carries the sign', B.every((r) => r.amount > 0 && (r.direction === 'debit' || r.direction === 'credit')));
t('the account is the statement\'s: kind, tail, provider', B.filter((r) => !r.raw_extracted.stmt.fundedElsewhere).every((r) => r.raw_extracted.account_kind === 'deposit' && r.raw_extracted.account_masked === '3444' && r.source_provider === 'VIB'));
t('the running balance rides along for the drift detector', B.every((r) => typeof r.raw_extracted.balance === 'number'));
var pay = B.filter((r) => r.raw_extracted.flow === 'transfer');
t('a card repayment is flow:transfer (the review reads that as "Trả nợ thẻ")', pay.length === 1 && pay[0].direction === 'debit');
var xf = B.filter((r) => r.raw_extracted.stmt.xfer);
t('pre-set as an internal transfer: the two top-ups and the recipient==holder memo, nothing else', xf.length === 3, xf.map((r) => r.raw_extracted.memo));
t('...and every one of them asks for a look', xf.every((r) => r.raw_extracted.stmt.attn === true));
var toHoa = B.find((r) => r.counterparty === 'LE THI HOA');
t('a transfer to someone else: p2p, recipient named, purpose left BLANK', toHoa && toHoa.raw_extracted.transaction_type === 'p2p_transfer' && toHoa.raw_extracted.memo_display === '' && !toHoa.raw_extracted.stmt.xfer, toHoa && toHoa.raw_extracted);
var bare = B.filter((r) => r.raw_extracted.memo_display === '' && !r.counterparty);
t('a bare holder-name memo is never a transfer', bare.length === 2 && bare.every((r) => !r.raw_extracted.stmt.xfer && r.raw_extracted.flow === 'expense'), bare.length);
var blob = JSON.stringify(B);
t('nothing from the preamble rides along: no full account number, ID or address', !/000111222333444|000000000000|Duong So 1/.test(blob));

console.log('\n-- credit card statement --');
var card = T.fhStmtParse(grid('credit-card'));
var C = stage(card, { provider: 'VIB', kind: 'credit_card', tail: card.summary.accountTail });
t('MCC becomes a category hint in the shared 8-concept vocabulary', C.find((r) => /Foody/.test(r.raw_extracted.memo)).raw_extracted.category_hint === 'Dining' && C.find((r) => /WINMART/.test(r.raw_extracted.memo)).raw_extracted.category_hint === 'Groceries', C.map((r) => r.raw_extracted.category_hint));
t('an unknown MCC gives no hint rather than a wrong one', C.every((r) => ['', 'Housing', 'Groceries', 'Clothing', 'Shopping', 'Transport', 'Dining', 'Fun', 'Others'].indexOf(r.raw_extracted.category_hint) >= 0));
t('money INTO the card is a credit with flow:transfer', C.filter((r) => r.direction === 'credit').every((r) => r.raw_extracted.flow === 'transfer'));
t('the card is the account', C.every((r) => r.raw_extracted.account_kind === 'credit_card' && r.raw_extracted.account_masked === '6789'));

console.log('\n-- e-wallet statement --');
var wal = T.fhStmtParse(grid('ewallet'));
var Wt = stage(wal, { provider: 'MoMo', kind: 'ewallet', tail: '0001' });
t('timed rows are spelled the way the database spells a timestamp (UTC, +00:00)', Wt.every((r) => /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\+00:00$/.test(r.occurred_at)));
var first = Wt.find((r) => r.raw_extracted.reference_number === '90000000000');
t('...and it is the same instant as the file\'s VN clock (08:15 VN = 01:15 UTC)', first.occurred_at === '2026-08-01T01:15:00+00:00' && new Date(first.occurred_at).getTime() === new Date('2026-08-01T08:15:00+07:00').getTime(), first.occurred_at);
t('so an email row for the same second produces the SAME merge key', (first.occurred_at + '|' + first.amount) === ('2026-08-01T01:15:00+00:00' + '|' + 42000));
t('the wallet\'s own transaction id is the reference', Wt.every((r) => /^\d{11}$/.test(r.raw_extracted.reference_number)));
var named = Wt.find((r) => /Dong Tay/.test(r.raw_extracted.memo)), unnamed = Wt.find((r) => /SUKIYA/.test(r.raw_extracted.memo));
t('paid through the wallet from a NAMED bank: tagged to that bank', named.source_provider === 'VIB' && named.raw_extracted.account_kind === 'deposit' && named.raw_extracted.account_masked === '', named);
t('...and its wallet balance is NOT recorded against the bank', named.raw_extracted.balance === null);
t('from an UNNAMED linked bank: left unplaced, never booked to the wallet', unnamed.raw_extracted.account_kind === null);
var topups = Wt.filter((r) => r.raw_extracted.stmt.xfer);
t('top-ups from a bank are pre-set as transfers INTO the wallet', topups.length === 2 && topups.every((r) => r.direction === 'credit'));
t('an ordinary wallet purchase is an expense on the wallet', Wt.find((r) => /REVI/.test(r.raw_extracted.memo)).raw_extracted.account_kind === 'ewallet' && !Wt.find((r) => /REVI/.test(r.raw_extracted.memo)).raw_extracted.stmt.xfer);
t('a person is p2p; a merchant is not', Wt.find((r) => r.counterparty === 'Lê Thị Hoa').raw_extracted.transaction_type === 'p2p_transfer' && Wt.find((r) => r.counterparty === 'REVI COFFEE').raw_extracted.transaction_type !== 'p2p_transfer');
t('provenance marker for the ledger source stamp', Wt.every((r) => r.raw_extracted._transport === 'statement'));

console.log('\n-- "already decided": the canonical key --');
var k1 = window.fhStmtCanonical('MoMo', '0001', wal.rows[0]), k2 = window.fhStmtCanonical('MoMo', '9999', Object.assign({}, wal.rows[0], { amt: 1, date: '2020-01-01' }));
t('with a bank transaction id the key is EXACT: the id alone', /^v1\|ref\|momo\|\d{11}$/.test(k1) && k1 === k2, k1);
var r0 = bank.rows[0], kb = window.fhStmtCanonical('VIB', '3444', r0);
t('without one, the row\'s own facts', kb.indexOf('v1|row|vib|3444|' + r0.date + '|' + Math.round(r0.amt) + '|') === 0, kb);
t('the same row in a re-sent statement has the same key', kb === window.fhStmtCanonical('VIB', '3444', T.fhStmtParse(grid('bank-account')).rows[0]));
t('a different amount is a different row', kb !== window.fhStmtCanonical('VIB', '3444', Object.assign({}, r0, { amt: r0.amt - 1 })));

console.log('\n' + (fail ? fail + ' FAILED, ' : 'ALL ') + pass + ' PASSED');
process.exit(fail ? 1 : 0);
