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

console.log('\n-- a description on two lines --');
/* Description in the LAST column (the Techcombank layout): the second line
   joins the row above, so the description is one cell. */
const g4 = gridOf(TCB.concat([it(120, 28, '29/09/2026', 40), it(120, 104, '30/09/2026', 40), it(120, 300, '120,000', 30), it(120, 440, 'Giao dịch thanh toán/Purchase - Số Thẻ/Card No:', 180),
  it(130, 440, 'MPOS*BY PREM QUAN 1 VN', 90)]));
t('in the last column: one cell, the two lines joined by a space', g4.length === 2 && g4[1][4] === 'Giao dịch thanh toán/Purchase - Số Thẻ/Card No: MPOS*BY PREM QUAN 1 VN', g4);
/* Description in a MIDDLE column (the layout above). KNOWN GAP, reported
   2026-11-25 and not fixed here: the second line is NOT joined. It comes out as
   a row of its own with no date, which the reader keeps as a note, and the
   body row's description stops at the end of its first line. */
const g5 = gridOf(HEAD.concat(lost, [it(155, 172, 'tiep theo dong hai', 80)]));
t('KNOWN GAP: in a middle column the second line is a row of its own, not part of the description', g5.length === 3 && g5[1][2] === 'Thanh toan sao ke the Master Card 08 TRAN THI MAI' &&
  JSON.stringify(g5[2]) === JSON.stringify(['tiep theo dong hai']), g5);

console.log('\n' + (fail ? fail + ' FAILED, ' : 'ALL ') + pass + ' PASSED');
process.exit(fail ? 1 : 0);
