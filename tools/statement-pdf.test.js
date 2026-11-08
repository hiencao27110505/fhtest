#!/usr/bin/env node
/* A PDF statement through the REAL pipeline (pdf-statements-spec.md §15):
 * pdfjs-dist (Node build) extracts the text items of the synthetic locked
 * Techcombank-layout fixture, 43-pdf-grid.js turns them into the grid, and
 * 59-statement-table.js finds the table, reads the rows, proves the totals and
 * reads the account facts. Nothing is mocked between the bytes and the proof.
 *
 *   node tools/statement-pdf.test.js
 *
 * What it has to survive (spec §4): one bilingual header on page 1, pages 2-3
 * with no header, two-line descriptions, fee rows with a post date only, an
 * original-amount column carrying a currency, negative = owed, a glossary page.
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const S = require(path.join(ROOT, 'src', 'js-ui', '59-statement-table.js'));
const FX = path.join(__dirname, 'fixtures', 'statements');
const man = JSON.parse(fs.readFileSync(path.join(FX, 'manifest.json'), 'utf8')).fixtures;
const meta = man.find((m) => m.file === 'credit-card-techcombank.locked.pdf');

let pass = 0, fail = 0;
const t = (n, ok, d) => { console.log((ok ? '  PASS  ' : '  FAIL  ') + n + (!ok && d !== undefined ? '  -> ' + JSON.stringify(d).slice(0, 300) : '')); ok ? pass++ : fail++; };

// 43 is an IIFE that hangs its functions on window; the dynamic import inside
// fhPdfReady is never reached here (the Node build of pdf.js is handed in).
global.window = {};
eval(fs.readFileSync(path.join(ROOT, 'src', 'js-data', '43-pdf-grid.js'), 'utf8'));
const usable = (r) => r.date !== undefined && (r.amount !== undefined || r.debit !== undefined || r.credit !== undefined);
const opts = { roles: S.fhStmtRoles, usable: usable };

(async () => {
  const lib = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const bytes = fs.readFileSync(path.join(FX, meta.file));

  console.log('\n-- the lock --');
  let code = null;
  try { await window.fhPdfPagesOf(lib, bytes, undefined); } catch (e) { code = e && e.name === 'PasswordException' ? (e.code === 2 ? 'bad_password' : 'pdf_encrypted') : String(e); }
  t('no password: the file asks for one (pdf_encrypted)', code === 'pdf_encrypted', code);
  code = null;
  try { await window.fhPdfPagesOf(lib, bytes, 'nope'); } catch (e) { code = e && e.name === 'PasswordException' ? (e.code === 2 ? 'bad_password' : 'pdf_encrypted') : String(e); }
  t('a wrong password is bad_password, not a crash', code === 'bad_password', code);

  console.log('\n-- items to grid --');
  const pages = await window.fhPdfPagesOf(lib, bytes, meta.password, { standardFontDataUrl: path.join(ROOT, 'node_modules', 'pdfjs-dist', 'standard_fonts') + '/' });
  t('three pages of text items (a text PDF, not a scan)', pages.length === 3 && pages.every((p) => p.items.length > 0), pages.map((p) => p.items.length));
  const grid = window.fhPdfItemsToGrid(pages, opts);
  t('a grid of rows of cells', Array.isArray(grid) && grid.length > 40 && grid.every((r) => Array.isArray(r)), grid.length);
  const hdrIdx = grid.findIndex((r) => { const rl = S.fhStmtRoles(r); return usable(rl) && Object.keys(rl).length >= 3; });
  t('exactly one header row, on page 1', hdrIdx > 0 && grid.filter((r) => { const rl = S.fhStmtRoles(r); return usable(rl) && Object.keys(rl).length >= 3; }).length === 1, hdrIdx);
  const hdr = grid[hdrIdx];
  t('both header lines merged, so both languages name the roles', /Transaction Date/.test(hdr[0]) && /Post Date/.test(hdr[1]) && /Original Amount/.test(hdr[2]), hdr);
  const roles = S.fhStmtRoles(hdr);
  t('roles: date · postDate · fxAmount (not amount) · debit · credit · description',
    roles.date === 0 && roles.postDate === 1 && roles.fxAmount === 2 && roles.amount === undefined && roles.debit === 3 && roles.credit === 4 && roles.description === 5, roles);
  const body = grid.slice(hdrIdx + 1).filter((r) => /^\d\d\/\d\d\/\d{4}$/.test(r[0]) || /^\d\d\/\d\d\/\d{4}$/.test(r[1]));
  t('every body row keeps the header\'s columns across pages 1-3', body.length === meta.rows && body.every((r) => r.length === hdr.length), body.length);
  t('a two-line description is one cell', body.some((r) => /Purchase - Số Thẻ\/Card No: .*MPOS\*BY PREM QUAN 1 VN$/.test(r[5])), body.slice(1, 3).map((r) => r[5]));
  const fee = body.filter((r) => r[0] === '' && /^\d\d\/\d\d\/\d{4}$/.test(r[1]));
  t('the fee row has a post date and no transaction date', fee.length === meta.fee_rows && /PHI GIAO DICH/.test(fee[0][5]), fee);
  t('page numbers and the glossary never become rows of the table', !grid.some((r) => r.some((c) => /^\d\/ ?\d$/.test(c))) && !body.some((r) => /CÁCH ĐỌC/.test(r.join(' '))));
  const due = grid.slice(0, hdrIdx).find((r) => r.some((c) => /Thời hạn thanh toán/.test(c)));
  t('a due date printed under its time rejoins its line (date first, so it parses)', !!due && due.some((c) => /^\d\d\/\d\d\/\d{4} 17:00$/.test(c)), due);

  console.log('\n-- through the real reader and proof --');
  const parsed = S.fhStmtParse(grid, null, { provider: 'Techcombank' });
  t('the table is found', !!parsed.table);
  t('all rows read, none dropped', parsed.rows.length === meta.rows, parsed.rows.length);
  t('the totals prove exactly: previous + debit − credit = closing', parsed.proof.ok && parsed.proof.how === 'totals', parsed.proof);
  const sum = parsed.summary;
  t('summary: prevDebt · totalDebit · totalCredit · endDebt', sum.prevDebt === meta.totals.prevDebt && sum.totalDebit === meta.totals.totalDebit && sum.totalCredit === meta.totals.totalCredit && sum.endDebt === meta.totals.endDebt, sum);
  t('summary: limit, statement date and due date (thời hạn thanh toán trước)', sum.limit === 50000000 && sum.stmtDate === meta.stmtDate && /^\d{4}-\d\d-\d\d$/.test(sum.dueDate || ''), { limit: sum.limit, stmtDate: sum.stmtDate, dueDate: sum.dueDate });
  t('only the masked tail of the card number is kept', sum.accountTail === '7890' && !JSON.stringify(sum).includes('19031234567890'), sum.accountTail);
  const feeRow = parsed.rows.find((r) => /PHI GIAO DICH/.test(r.description));
  t('the fee row takes its post date as the day and is money out', !!feeRow && /^\d{4}-\d\d-\d\d$/.test(feeRow.date) && feeRow.amt < 0, feeRow && { date: feeRow.date, amt: feeRow.amt });
  const fxRow = parsed.rows.find((r) => r.fx);
  t('a foreign purchase carries fx {amount, currency} and the VND debit as the amount', !!fxRow && fxRow.fx.currency === 'USD' && fxRow.fx.amount === 2.99 && fxRow.amt === -78000, fxRow && { fx: fxRow.fx, amt: fxRow.amt });
  t('a VND original amount carries no fx', parsed.rows.filter((r) => r.fx).length === meta.fx_rows, parsed.rows.filter((r) => r.fx).length);
  const pay = parsed.rows.find((r) => r.amt > 0);
  t('the card repayment is the one credit, with the bank\'s repayment wording for the queue to read', !!pay && pay.amt === 3250000 && /Thanh toan no the tin dung/.test(pay.description) && parsed.rows.filter((r) => r.amt > 0).length === 1, pay && pay.description);
  const facts = S.fhStmtAccountFacts(parsed, 'credit_card');
  t('account facts: closing debt NEGATIVE, limit, statement day', facts.ok && facts.balDong < 0 && Math.abs(facts.balDong) === meta.totals.endDebt && facts.debtDong === meta.totals.endDebt && facts.limitDong === 50000000 && facts.stmtDate === meta.stmtDate, { ok: facts.ok, why: facts.why, balDong: facts.balDong, debtDong: facts.debtDong, limitDong: facts.limitDong, stmtDate: facts.stmtDate });
  const stmSrc = fs.readFileSync(path.join(ROOT, 'src', 'js-data', '77-statement-capture.js'), 'utf8');
  t('the remembered password is keyed per (bank, product) on a language-free token, bank-only key as the fallback (PS16)',
    /_stmPwScope = \(card\) => [^\n]*_stmKindKey\(card\)/.test(stmSrc) && !/_stmPwScope = \(card\) => [^\n]*_stmKindWord/.test(stmSrc)
    && /all\[k\] \|\| all\[k\.split\('\|'\)\[0\]\]/.test(stmSrc)
    && !/_stmPwGet\(card\.source_provider\)|_stmPwSet\(X\.card\.source_provider|_stmPwSet\(card\.source_provider/.test(stmSrc));
  t('forgetting a wrong password forgets only the key that was tried', /else if \(k in all\) delete all\[k\]; else delete all\[k\.split\('\|'\)\[0\]\]/.test(stmSrc));
  t('every pdf code is mapped on the tap path AND the auto path', ['pdf_encrypted', 'pdf_scanned', 'pdf_unsupported', 'pdf_lib'].every((c) => (stmSrc.match(new RegExp("'" + c + "'", 'g')) || []).length >= 2));
  t('a foreign row\'s fx rides into raw_extracted as fx_amount / fx_currency (PS12)', /fx_amount: p\.fx \? p\.fx\.amount : null, fx_currency: p\.fx \? p\.fx\.currency : null/.test(stmSrc) && /fx: row\.fx \|\| null/.test(stmSrc));
  t('a wrong reading reconciles nothing', (function () { const wrong = Object.assign({}, roles, { debit: 4, credit: 3 }); const p2 = S.fhStmtParse(grid, wrong, { provider: 'Techcombank' }); return !p2.proof.ok; })());

  console.log('\n' + (fail ? 'FAILED ' + fail + ' of ' + (pass + fail) : 'ALL ' + pass + ' PASSED'));
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
