#!/usr/bin/env node
/* The PDF grid builder (src/js-data/43-pdf-grid.js) on synthetic text items.
 * `node tools/pdf-grid.test.js`
 *
 * Items are what pdf.js hands over: { str, x, y, w, h }, x the left edge, y
 * from the top, in PDF units. The geometry below is copied from one real card
 * statement page (positions only; every string is invented): figures are
 * right-aligned to their heading's right edge, so a figure WIDER than its
 * heading starts left of it, inside the column before. Four of five payments
 * on that page were filed under MCC that way and lost (reconcile-spec R3).
 * The run-cutting rules of 2026-11-08 (PS30) are pinned in
 * statement-unreadable.test.js and must stay green beside this.
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const S = require(path.join(ROOT, 'src', 'js-ui', '59-statement-table.js'));
global.window = {};
eval(fs.readFileSync(path.join(ROOT, 'src', 'js-data', '43-pdf-grid.js'), 'utf8'));
const usable = (r) => r.date !== undefined && (r.amount !== undefined || r.debit !== undefined || r.credit !== undefined);
const gridOf = (items) => window.fhPdfItemsToGrid([{ height: 800, items }], { roles: S.fhStmtRoles, usable });

let pass = 0, fail = 0;
const t = (n, ok, d) => { console.log((ok ? '  PASS  ' : '  FAIL  ') + n + (!ok && d !== undefined ? '  -> ' + JSON.stringify(d) : '')); ok ? pass++ : fail++; };
const it = (y, x, str, w) => ({ str, x, y, w, h: 8 });

console.log('\n-- a figure wider than its heading lands under its heading --');
/* header line 1: date x30 w57 · post date x101 w60 · details x172 w33 · MCC x362 w18 · amount x519 w51 (right edge 570) */
const HEAD = [it(100, 30, 'Ngày giao dịch', 57), it(100, 101, 'Ngày hạch toán', 60), it(100, 172, 'Diễn giải', 33), it(100, 362, 'MCC', 18), it(100, 519, 'Số tiền (VND)', 51)];
const ok1 = [it(130, 30, '02/08/2026', 40), it(130, 101, '04/08/2026', 40), it(130, 172, 'Mua Hàng / Foody', 107), it(130, 362, '5812-Eating Places', 74), it(130, 522, '-210,600.00', 43)];
const lost = [it(145, 30, '05/08/2026', 40), it(145, 101, '05/08/2026', 40), it(145, 172, 'Thanh toan sao ke the Master Card 08 TRAN THI MAI', 183),
  it(145, 362, '6012-Member Financial', 84), it(145, 516, '-1,366,000.00', 49)];
const g = gridOf(HEAD.concat(ok1, lost));
const rowOf = (d) => g.find((r) => r[0] === d);
t('the narrower figure (x522, right edge 565) is in the amount cell, as before', JSON.stringify(rowOf('02/08/2026')) === JSON.stringify(['02/08/2026', '04/08/2026', 'Mua Hàng / Foody', '5812-Eating Places', '-210,600.00']), rowOf('02/08/2026'));
t('the wider figure (x516, left of the heading at 519) is in the amount cell too', rowOf('05/08/2026')[4] === '-1,366,000.00', rowOf('05/08/2026'));
t('...and the MCC cell holds only the MCC text', rowOf('05/08/2026')[3] === '6012-Member Financial', rowOf('05/08/2026'));
const p = S.fhStmtParse(g);
t('through the reader: both rows are rows, with their amounts, nothing unreadable', p.rows.length === 2 && p.rows.some((r) => r.amt === -1366000) && p.unreadable.length === 0, { rows: p.rows.map((r) => r.amt), un: p.unreadable });

console.log('\n-- what must not move --');
/* A Techcombank-shaped header: a credit figure whose END strays a few points
   past the description's boundary overlaps its own heading far more. */
const TCB = [it(100, 28, 'Ngày giao dịch', 56), it(100, 104, 'Ngày cập nhật hệ', 64), it(100, 300, 'Ghi nợ (VND)', 48), it(100, 380, 'Ghi có (VND)', 48), it(100, 432, 'Diễn giải giao dịch', 76)];
const g2 = gridOf(TCB.concat([it(120, 28, '29/09/2026', 40), it(120, 104, '30/09/2026', 40), it(120, 396, '3,250,000', 38), it(120, 440, 'Thanh toan no the tin dung', 104)]));
t('a credit figure ending a few points into the next column stays a credit', g2[1][3] === '3,250,000' && g2[1][4] === 'Thanh toan no the tin dung', g2[1]);
/* A description run that reaches past the MCC boundary with no space to cut
   at (a space near it is cut there, PS30, unchanged): it overlaps its own
   heading more than MCC's, and stays whole in the description. */
const g3 = gridOf(HEAD.concat([it(160, 30, '06/08/2026', 40), it(160, 101, '07/08/2026', 40), it(160, 172, 'Mua Hàng / ANORDERWITHAVERYLONGMERCHANTNAMENOSPACE', 196), it(160, 527, '79,000.00', 38)]));
t('a description that runs past the next boundary but overlaps its own heading more stays a description', g3[1][2] === 'Mua Hàng / ANORDERWITHAVERYLONGMERCHANTNAMENOSPACE' && g3[1][3] === '' && g3[1][4] === '79,000.00', g3[1]);

console.log('\n-- a description on more than one line --');
/* Description in the LAST column (the Techcombank layout): the second line
   joins the row above, so the description is one cell. */
const g4 = gridOf(TCB.concat([it(120, 28, '29/09/2026', 40), it(120, 104, '30/09/2026', 40), it(120, 300, '120,000', 30), it(120, 440, 'Giao dịch thanh toán/Purchase - Số Thẻ/Card No:', 180),
  it(130, 440, 'MPOS*BY PREM QUAN 1 VN', 90)]));
t('in the last column: one cell, the two lines joined by a space', g4.length === 2 && g4[1][4] === 'Giao dịch thanh toán/Purchase - Số Thẻ/Card No: MPOS*BY PREM QUAN 1 VN', g4);
/* Description in a MIDDLE column: the real card PDF's own layout, where every
   card payment wraps. Real positions (y grows downward, items h 8): a two-line
   sub-header, an ordinary row, the wrapped row with two more lines (the third
   a "09/2026" fragment, not a date), the next row. Rows are 15 or more apart,
   continuation lines 9. */
const MID = HEAD.concat([
  it(479, 30, 'Số thẻ / Số tài khoản', 79), it(479, 172, '000000000123456', 67), it(491, 30, 'Card number / Account', 102),
  it(507, 30, '02/08/2026', 40), it(507, 101, '04/08/2026', 40), it(507, 172, 'Mua Hàng / Foody', 107), it(507, 362, '5812-Eating Places', 74), it(507, 522, '-210,600.00', 43),
  it(522, 30, '05/08/2026', 40), it(522, 101, '05/08/2026', 40), it(522, 172, '000000000123456 - TRAN THI MAI -', 183), it(522, 362, '6012-Member Financial', 84), it(522, 516, '-1,366,000.00', 49),
  it(531, 172, 'Thanh toan sao ke the Master Card', 171),
  it(540, 172, '09/2026', 29),
  it(550, 30, '06/08/2026', 40), it(550, 101, '07/08/2026', 40), it(550, 172, 'Mua Hàng / APPLE.COM/BILL', 110), it(550, 362, '5818-Digital Goods', 70), it(550, 527, '79,000.00', 38)]);
const g5 = gridOf(MID);
const w5 = g5.find((r) => r[0] === '05/08/2026');
t('in a middle column: ONE body row, its three lines joined with single spaces', !!w5 && w5[2] === '000000000123456 - TRAN THI MAI - Thanh toan sao ke the Master Card 09/2026', w5);
t('...its MCC and amount cells untouched', w5 && w5[3] === '6012-Member Financial' && w5[4] === '-1,366,000.00', w5);
t('...no line of it left over as a row of its own', !g5.some((r) => r.length === 1 && /Thanh toan|^09\/2026$/.test(r[0])), g5);
t('the two sub-header lines are still notes, the rows around the wrap intact', JSON.stringify(g5.slice(1)) === JSON.stringify([
  ['Số thẻ / Số tài khoản', '000000000123456'], ['Card number / Account'],
  ['02/08/2026', '04/08/2026', 'Mua Hàng / Foody', '5812-Eating Places', '-210,600.00'],
  ['05/08/2026', '05/08/2026', '000000000123456 - TRAN THI MAI - Thanh toan sao ke the Master Card 09/2026', '6012-Member Financial', '-1,366,000.00'],
  ['06/08/2026', '07/08/2026', 'Mua Hàng / APPLE.COM/BILL', '5818-Digital Goods', '79,000.00']]), g5);
const p5 = S.fhStmtParse(g5);
t('through the reader: three rows, the wrapped one read as the card repayment', p5.rows.length === 3 && p5.rows.some((r) => r.amt === -1366000 && r.cls.flow === 'cardpay'), p5.rows.map((r) => [r.description, r.cls.flow]));

console.log('\n-- what a continuation must not swallow --');
/* a label row right under a body row: a cell in the first column and one in the description column */
const g6 = gridOf(MID.concat([it(559, 30, 'Số thẻ / Số tài khoản', 79), it(559, 172, '512345******6789', 67)]));
t('a label row directly under a body row is not joined', g6[g6.length - 1].length === 2 && g6[g6.length - 1][0] === 'Số thẻ / Số tài khoản' &&
  g6.find((r) => r[0] === '06/08/2026')[2] === 'Mua Hàng / APPLE.COM/BILL', g6.slice(-2));
/* a line in the description column only, but a full row pitch below the last row */
const g7 = gridOf(MID.concat([it(565, 172, 'Tong cong', 40)]));
t('a description-column line a full row pitch below is not joined', g7.find((r) => r[0] === '06/08/2026')[2] === 'Mua Hàng / APPLE.COM/BILL' && g7[g7.length - 1][0] === 'Tong cong', g7.slice(-2));
/* a continuation never crosses a new body row: the next dated row starts fresh */
t('a new body row is never part of the one above', g5.filter((r) => /^\d\d\/\d\d\/2026$/.test(r[0])).length === 3);

console.log('\n' + (fail ? fail + ' FAILED, ' : 'ALL ') + pass + ' PASSED');
process.exit(fail ? 1 : 0);
