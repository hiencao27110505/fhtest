#!/usr/bin/env node
/* A statement row the reader cannot read is shown, never invented.
 * `node tools/statement-unreadable.test.js`
 *
 * 2026-11-08, two real Techcombank card PDFs: pdf.js glued the payment's figure
 * to its memo in a shape no word pattern foresaw, the permissive number reader
 * swallowed the whole cell, and a 7,270,899 ₫ repayment reached the review queue
 * as 7,270,899,672,708,996 ₫ with the date as its memo. Three layers now stand
 * between a glued run and the queue, and each is pinned here:
 *   1. the grid builder cuts a run at the column boundary it crosses (geometry,
 *      not a word pattern), so the next layout glue meets the same rule;
 *   2. an amount cell is ONE figure or it is unreadable (fhStmtFigure), and an
 *      unreadable row is kept apart from the rows, so no arithmetic can stand
 *      for it (fhStmtProve says `unreadable`);
 *   3. the capture flow asks, names those rows, and never writes them.
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const S = require(path.join(ROOT, 'src', 'js-ui', '59-statement-table.js'));
global.window = {};
eval(fs.readFileSync(path.join(ROOT, 'src', 'js-data', '43-pdf-grid.js'), 'utf8'));
const usable = (r) => r.date !== undefined && (r.amount !== undefined || r.debit !== undefined || r.credit !== undefined);

let pass = 0, fail = 0;
const t = (n, ok, d) => { console.log((ok ? '  PASS  ' : '  FAIL  ') + n + (!ok && d !== undefined ? '  -> ' + JSON.stringify(d) : '')); ok ? pass++ : fail++; };

console.log('\n-- one figure, or nothing --');
[['5,386,180', 5386180], ['5,386,180 VND', 5386180], ['-37,000 VND', -37000], ['+5,000,000 VND', 5000000], ['0 ₫', 0], ['500,000 ₫', 500000],
 ['(74,000)', -74000], ['12.99 USD', 12.99], ['1.519.522,00', 1519522], ['-2150000.0', -2150000], ['50.000đ', 50000], ['VND 50,000', 50000],
 [': 6,636,000 VND', 6636000], [185000, 185000]].forEach(([v, n]) => t('reads ' + JSON.stringify(v), S.fhStmtFigure(v) === n, S.fhStmtFigure(v)));
[['7,270,899 6 7,270,899 6', 'the glued cell that reached the queue'], ['1,000,374 Thanh toan no the', 'a figure trailed by words'],
 ['5,386,180 5,386,180', 'two figures'], ['05/10/2026', 'a date'], ['27/06/2026 5,386,180', 'a date and a figure'],
 ['Thu Nợ Tối Thiểu', 'words only'], ['', 'empty'], [null, 'null']].forEach(([v, why]) => t('refuses ' + why + ' ' + JSON.stringify(v), S.fhStmtFigure(v) === null, S.fhStmtFigure(v)));

console.log('\n-- the reader keeps an unreadable row apart, and the proof cannot stand without it --');
const card = (creditCell) => [
  ['SAO KÊ TÀI KHOẢN THẺ TÍN DỤNG'],
  ['Ông/Bà:', 'NGUYEN VAN A', 'Ngày sao kê:', '28/10/2026'],
  ['Dư nợ cuối kỳ (VND):', '-2,444,068'],
  ['Số dư kỳ trước (VND) Previous Balance:', '-7,270,899'],
  ['Ngày giao dịch Transaction Date', 'Ngày cập nhật hệ thống Post Date', 'Số tiền giao dịch Original Amount', 'Ghi nợ (VND) Debit', 'Ghi có (VND) Credit', 'Diễn giải giao dịch Transaction Description'],
  ['05/10/2026', '05/10/2026', '7,270,899 VND', '', creditCell, 'Thanh toan no the tin dung - Sotien 7270899 VND - Ngay 05/10/2026'],
  ['17/10/2026', '19/10/2026', '95,000 VND', '95,000', '', 'Giao dịch thanh toán/Purchase - Số Thẻ/Card No: 4839...2754 MPOS*BY PREM QUAN 1 VN'],
  ['20/10/2026', '21/10/2026', '2,349,068 VND', '2,349,068', '', '4839...2754 PY*ACFC VIETNAM HOCHIMINH VN'],
  ['Tổng ghi nợ trong kỳ Total Debit in period:', '2,444,068'],
  ['Tổng ghi có trong kỳ Total Credit in period:', '7,270,899'],
  ['Số dư cần thanh toán(VND) Outstanding Balance:', '-2,444,068']
];
const clean = S.fhStmtParse(card('7,270,899'), null, { provider: 'Techcombank' });
t('a clean statement proves by its totals, 3 rows, nothing unreadable', clean.proof.ok && clean.proof.how === 'totals' && clean.rows.length === 3 && clean.unreadable.length === 0 && clean.proof.unreadable === 0, { proof: clean.proof.how, rows: clean.rows.length, un: clean.unreadable });
const glued = S.fhStmtParse(card('7,270,899 6 7,270,899 6'), null, { provider: 'Techcombank' });
t('the glued credit is one unreadable row, dated, with the cell as it was', glued.unreadable.length === 1 && glued.unreadable[0].date === '2026-10-05' && glued.unreadable[0].role === 'credit' && glued.unreadable[0].cell === '7,270,899 6 7,270,899 6' && glued.unreadable[0].why === 'shape', glued.unreadable);
t('it is not among the rows, so no 16-digit amount exists anywhere', glued.rows.length === 2 && glued.rows.every((r) => Math.abs(r.amt) < 1e7), glued.rows.map((r) => r.amt));
t('the proof says so, whatever the other rows add up to', !glued.proof.ok && glued.proof.how === 'unreadable' && glued.proof.unreadable === 1, glued.proof);
const huge = S.fhStmtParse(card('7,270,899,672,708,996'), null, { provider: 'Techcombank' });
t('a single figure no personal statement can hold is unreadable too (why: huge)', huge.unreadable.length === 1 && huge.unreadable[0].why === 'huge' && !huge.proof.ok, huge.unreadable);
const dash = S.fhStmtParse(card('-'), null, { provider: 'Techcombank' });
t('a cell with no digit is empty, not unreadable (the row is simply a row with no amount)', dash.unreadable.length === 0 && dash.rows.length === 2, dash.unreadable);
const facts = S.fhStmtAccountFacts(glued, 'credit_card');
t('account facts take no balance from a reading with an unreadable row', !facts.ok && facts.why === 'unproved', facts);

console.log('\n-- the grid builder cuts a glued run where the column boundary falls --');
/* A Techcombank-shaped page in text items: x is the run's left edge, w its
   width, y from the top. The header's six runs set the columns; the body runs
   below are the cases. Average glyph width in the body is 4 pt. */
const H = (x, str) => ({ str, x, y: 100, w: str.length * 4, h: 8 });
const B = (y, x, str) => ({ str, x, y, w: str.length * 4, h: 8 });
const header = [H(28, 'Ngày giao dịch'), H(104, 'Ngày cập nhật hệ'), H(178, 'Số tiền giao dịch'), H(300, 'Ghi nợ (VND)'), H(380, 'Ghi có (VND)'), H(432, 'Diễn giải giao dịch')];
const page = (bodyRuns) => [{ height: 800, items: header.concat(bodyRuns) }];
const gridOf = (runs) => { const g = window.fhPdfItemsToGrid(page(runs), { roles: S.fhStmtRoles, usable }); return g[g.length - 1]; };
// 1. a figure glued to its memo, the run starting in the credit column and reaching into the description
const r1 = gridOf([B(120, 28, '05/10/2026'), B(120, 104, '05/10/2026'), B(120, 178, '7,270,899 VND'), B(120, 394, '7,270,899 Thanh toan no the tin dung - Sotien 7270899 VND')]);
t('figure + memo: the figure stays in the credit column, the memo moves to the description', r1[4] === '7,270,899' && /^Thanh toan no the tin dung/.test(r1[5]), r1);
// 2. a glued run that never reaches the description boundary stays whole, and the reader refuses it
const r2 = gridOf([B(130, 28, '05/10/2026'), B(130, 104, '05/10/2026'), B(130, 178, '7,270,899 VND'), B(130, 352, '7,270,899 6 7,2'), B(130, 432, 'Thanh toan no the tin dung')]);
t('a glue inside one column is left as it is (a cut would be a guess)', /6/.test(r2[4] || '') && r2[5] === 'Thanh toan no the tin dung', r2);
const p2 = S.fhStmtParse([card('')[4], r2], null, { provider: 'Techcombank' });
t('…and the reader names that row instead of reading it', p2.unreadable.length === 1 && p2.rows.length === 0, p2.unreadable);
// 3. a figure glued to a figure (the September/October shape): the debit figure ends at the boundary, the credit figure follows
const r3 = gridOf([B(140, 28, '17/10/2026'), B(140, 104, '19/10/2026'), B(140, 178, '95,000 VND'), B(140, 354, '95,000 7,270,899'), B(140, 432, 'Giao dich thanh toan')]);
t('figure + figure: cut at the boundary between debit and credit', r3[3] === '95,000' && r3[4] === '7,270,899' && r3[5] === 'Giao dich thanh toan', r3);
// 4. a long memo that starts in the last column is never cut
const r4 = gridOf([B(150, 28, '17/10/2026'), B(150, 104, '19/10/2026'), B(150, 178, '95,000 VND'), B(150, 340, '95,000'), B(150, 432, 'Giao dịch thanh toán/Purchase - Số Thẻ/Card No: 4839...2754 MPOS*BY PREM QUAN 1 VN')]);
t('a memo in the last column stays one cell', r4[5] === 'Giao dịch thanh toán/Purchase - Số Thẻ/Card No: 4839...2754 MPOS*BY PREM QUAN 1 VN' && r4[3] === '95,000', r4);
// 5. a run that crosses a boundary with no space near it stays whole
const r5 = gridOf([B(160, 28, '17/10/2026'), B(160, 104, '19/10/2026'), B(160, 178, '95,000 VND'), B(160, 400, '95,000Giaodichthanhtoan')]);
t('no space near the boundary: nothing is cut', r5.join('|').indexOf('95,000Giaodichthanhtoan') >= 0, r5);

console.log('\n-- the capture flow asks, names the rows, and never writes them --');
const src = fs.readFileSync(path.join(ROOT, 'src', 'js-data', '77-statement-capture.js'), 'utf8');
t('an unreadable row always asks, remembered mapping or not', /_stmNeedsAsk = \(X\) => \(X\.parsed\.unreadable && X\.parsed\.unreadable\.length > 0\) \|\|/.test(src));
t('the ask screen lists the unreadable rows by day and cell', /const un = p\.unreadable \|\| \[\];/.test(src) && /không đọc được số tiền/.test(src) && /could not read the amount/.test(src));
t('the write plans over p.rows only, which never hold an unreadable row', /_stmBatched\(p\.rows,/.test(src) && !/p\.unreadable[^\n]*_stmWrite|_stmWrite[^\n]*unreadable/.test(src));
t('a totals mismatch is said as itself, not as "no totals"', /Tổng trong file không khớp với các dòng đọc được/.test(src) && /do not match the rows we read/.test(src));

console.log('\n' + (fail ? 'FAILED ' + fail + ' of ' + (pass + fail) : 'ALL ' + pass + ' PASSED'));
process.exit(fail ? 1 : 0);
