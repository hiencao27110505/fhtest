#!/usr/bin/env node
/* Transaction detail: one screen for every kind, view first, edit second
 * (mockups/txn-detail-view-edit.html option 1, mockups/txn-detail-kinds.html,
 * mockups/txn-detail-slot-variants.html 1A · 2B · 3B).
 * `node tools/txn-detail-view-edit.test.js`
 *
 * Source-shape guards in the style of personal-activation.test.js: the frame,
 * the three slots, the per-kind writers, the callers that must not fall back
 * to the retired sheets, and the family detail on the same pattern.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const R = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
const ui = R('src/js-ui/61-expense-detail.js');
const shell = R('src/index.html');
const css = R('src/css/46-expense-detail.css');
const data = R('src/js-data/19-personal.js');
const inv = R('src/js-data/26-investment-ui.js');
const debts = R('src/js-data/23-debts-ui.js');
const tab = R('src/js-ui/21-personal.js');
const list = R('src/js-ui/60-transactions.js');
const composer = R('src/js-ui/55-expense-photos-writes.js');
const income = R('src/js-data/70-goals-income-onboard-ui.js');

let pass = 0, fail = 0;
const t = (n, ok, d) => { console.log((ok ? '  PASS  ' : '  FAIL  ') + n + (!ok && d ? '  -> ' + d : '')); ok ? pass++ : fail++; };

const P = ui.slice(ui.indexOf('/* ═══ the PERSONAL transaction detail'));
const RENDER = P.slice(P.indexOf('function renderPersonalTxDetail(){'), P.indexOf('window.renderPersonalTxDetail='));
const ROWS = RENDER.slice(RENDER.indexOf("var rows='';"), RENDER.indexOf('var html;'));
const VIEW = RENDER.slice(RENDER.indexOf('<div class="exd-view">'), RENDER.indexOf('<div class="exd-edit">'));
const EDIT = RENDER.slice(RENDER.indexOf('<div class="exd-edit">'), RENDER.indexOf('body.innerHTML=html;'));

console.log('\n-- the frame: two states, one screen, every kind --');
t('every kind resolves to one of eight entries, a pair by group id, a card payment and an adjustment by shape',
  /function _pexdKindOf\(t\)/.test(P) && /if\(t\.transferGroupId\) return 'xfer'; if\(String\(t\.note\|\|''\)\.indexOf\('Điều chỉnh'\)===0\) return 'adjust'; return 'cardpay';/.test(P));
t('rows are found across the window, the all-time debt read and older history, merged', /var d=f\(P\.debts\), w=f\(P\.txns\)\|\|f\(P\.txnsOld\);/.test(P));
t('a pair is one entry anchored on the debit leg; a missing leg marks it broken', /E\.out=legs\.filter\(function\(d\)\{ return \(d\.amt\|\|0\)<0; \}\)\[0\]\|\|null;/.test(P) && /E\.broken=!\(E\.out&&E\.inn\);/.test(P) && /function openPersonalTransferDetail\(gid, opts\)/.test(P));
t('opens in view; a transfer, card payment or repayment opened from its own zoom-in lands in edit; an adjustment never edits',
  /_pexdEdit=!!\(_pexdOpts\.edit \|\| \(_pexdOpts\.from==='zoom' && \(k==='xfer'\|\|k==='cardpay'\|\|k==='repay'\)\)\);/.test(P) && /if\(k==='adjust'\) _pexdEdit=false;/.test(P));
t('Huỷ closes when the screen was opened straight into edit, else returns to view', /function pexdCancel\(\)\{ PXD=\{\}; if\(_pexdOpts\.edit\)\{ closePersonalTxDetail\(\); return; \}/.test(P));
t('the nav: ‹ back label per arrival · Sửa (none on an adjustment); Huỷ · kind title · Lưu', /var back=esc\(_pexdOpts\.back\|\|'Cá nhân'\);/.test(P) && /E\.k==='adjust'\?'<span><\/span>':'<button type="button" class="cd-act" onclick="pexdEdit\(\)">Sửa<\/button>'/.test(P) && /class="cd-navtitle">'\+_pexdTitle\(E\)\+'</.test(P));
t('no Cập nhật button and no trash square anywhere in the personal detail ("Cập nhật giá" is a price action, not a save)', !/Cập nhật<\//.test(P) && !/exd-cta-del/.test(P));
t('the bottom bar is emptied and hidden', /cta\.innerHTML=''/.test(P) && /#pexd-cta:empty,#exd-cta:empty\{display:none\}/.test(css));

console.log('\n-- rows: the review card\'s vocabulary, read-only in view --');
t('one row builder: read-only in view unless the row is the fix itself (live)', /ro:\(o\.live\?false:\(!ed\|\|o\.ro\)\)/.test(RENDER));
const order = ["'Ghi vào đâu'", "'Loại khoản'", "'Danh mục'", "'Ngày'", "'Giờ'", "toLbl"];
let last = -1, inOrder = true; order.forEach((k) => { const i = ROWS.indexOf(k); if (i < 0 || i < last) inOrder = false; last = i; });
t('Ghi vào đâu · Loại khoản lead, the kind rows sit between, Ngày · Giờ · Nguồn tiền close', inOrder);
t('kind rows: Cho ai mượn · Hẹn trả, Ai trả bạn, Vị thế · Số lượng, Từ · Đến tài khoản, Trả cho thẻ, Thẻ',
  /E\.lent\?'Cho ai mượn':'Mượn của ai'/.test(ROWS) && /label:'Hẹn trả'/.test(ROWS) && /E\.isIn\?'Ai trả bạn':'Trả nợ cho ai'/.test(ROWS) && /R\('Vị thế'/.test(ROWS) && /R\('Số lượng'/.test(ROWS) && /R\('Từ tài khoản'/.test(ROWS) && /R\('Đến tài khoản'/.test(ROWS) && /R\('Trả cho thẻ'/.test(ROWS) && /if\(k==='adjust'\) rows\+=R\('Thẻ'/.test(ROWS));
t('Nguồn tiền reads "Vào tài khoản nào" for money in', /var toLbl=\(E\.isIn\)\?'Vào tài khoản nào':'Nguồn tiền';/.test(ROWS));
t('Ghi vào đâu moves only an expense; Loại khoản converts only where a conversion exists', /R\('Ghi vào đâu','🔒 Cá nhân',\{ro:k!=='expense', fn:'pexdMove\(\)'\}\)/.test(ROWS) && /ro:!\(k==='expense'\|\|k==='loan'\|\|k==='invest'\), fn:'pexdSheetKind\(\)'/.test(ROWS));
t('edit has the two top inputs and the note label per kind; view has none', /id="pexd-amt"/.test(EDIT) && /id="pexd-note"/.test(EDIT) && /_pexdNoteLbl\(E\)/.test(EDIT) && !/<input/.test(VIEW) && !/<textarea/.test(VIEW));
t('delete is the muted foot line: in edit, and in view only for an adjustment', /class="exd-del" id="pexd-del" onclick="pexdDelete\(\)"/.test(EDIT) && /if\(k==='adjust'\) html\+='<button type="button" class="exd-del"/.test(VIEW));
t('typed values are read into PXD before every re-render and before Lưu', /if\(_pexdEdit\) pexdReadFields\(\);/.test(RENDER) && /pexdReadFields\(\);\s*if\(!_pxdDirty\(\)\)/.test(P));

console.log('\n-- the three slots --');
t('ask (1A): the cash-flow card\'s action row, one label per kind, opening the Chụp / Thư viện sheet',
  /_pexdCC\(_PEXD_ICO\.cam, lbl, 'pexdPhotoSheet\(\)'\)/.test(P) && /expense:'Thêm ảnh hoá đơn', income:'Thêm phiếu lương', loan:'Thêm giấy hẹn'/.test(P) && /class="cc-row"/.test(P));
t('ask: an adjustment points at the card instead; a broken pair asks nothing here', /if\(E\.k==='adjust' && E\.t\.accountId\) return '<div class="exd-meta flush">'\+_pexdCC\(_PEXD_ICO\.card,'Sửa ở màn thẻ'/.test(P) && /if\(E\.broken\) return '';/.test(P));
t('the photo sheet wraps real file inputs in choice labels; the camera one uses capture', /<label class="choice">'\+_PEXD_ICO\.cam\+'Chụp ảnh<input type="file" accept="image\/\*" capture="environment"/.test(P) && /id="sheet-exd-photo"/.test(shell));
t('photos read EXIF first and go through the personal upload path; the sheet refuses politely when locked or offline', /readPhoto\(f, function\(src\)/.test(P) && /fhPersonalUploadTxnPhotos\(id, srcs\)/.test(P) && /Mở khoá sổ cá nhân trước đã/.test(P) && /Cần mạng để thêm ảnh/.test(P));
t('fix (2B): a broken pair\'s missing leg is the amber row itself, tappable in view, and picking writes the counterpart at once',
  /miss:noFrom, live:noFrom/.test(ROWS) && /miss:noTo, live:noTo/.test(ROWS) && /if\(\(w==='from'\|\|w==='to'\) && E\.broken && !_pexdEdit\)\{ await _pexdRepairPair\(w, id\); return; \}/.test(P) && /fhPersonalAddTransfer\(signed, acctId, have\.note\|\|null, have\.date, null, E\.gid\)/.test(P));
t('context (3B): a second rows card under the rows, hidden in edit and when opened from the zoom-in that shows it',
  /function _pexdCtxHTML\(E\)\{\s*if\(_pexdEdit \|\| _pexdOpts\.from==='zoom'\) return '';/.test(P) && /_exdSecH\(title,''\)\+'<div class="exd-meta flush"><div class="csv-srows pad">'/.test(P));
t('context per kind: person balance + Nhắc trả, position + Cập nhật giá, the pair\'s two balances, the card\'s debt + Mở thẻ',
  /'Nhắc '\+esc\(who\)\+' trả','fhDebtRemindSheet\('\+idx\+'\)'/.test(P) && /'Cập nhật giá',"fhInvPriceSheet\('/.test(P) && /R\(esc\(a\.name\|\|'Tài khoản'\),'Chưa có mốc số dư','soft'\)/.test(P) && /'Mở thẻ',"openDebtAccount\('/.test(P));
t('no emoji as a control: the ask and context icons are SVG', /var _PEXD_ICO=\{/.test(P) && !/[\u{1F300}-\u{1FAFF}]/u.test(P.slice(P.indexOf('function _pexdAskHTML'), P.indexOf('function _pexdPhotoSheetOpen'))));
t('today is built locally, never from toISOString', !/toISOString\(/.test(P));

console.log('\n-- Lưu: one write per kind through that kind\'s own writer --');
t('expense → fhPersonalUpdateExpense; income → fhPersonalUpdateIncome (+ time, category)', /fhPersonalUpdateExpense\(E\.id, f\)/.test(P) && /fhPersonalUpdateIncome\(E\.id, fi\)/.test(P) && /if \(fields\.hasOwnProperty\('time'\)\) row\.occurred_time_enc/.test(data) && /if \(fields\.hasOwnProperty\('cat'\)\) \{ row\.cat_name_enc/.test(data));
t('loan / repayment / card payment → fhPersonalDebtRowUpdate (+ who, account, time), sign kept', /var sign=\(t\.amt!=null&&t\.amt<0\)\?-1:1;/.test(P) && /fhPersonalDebtRowUpdate\(E\.id, fd\)/.test(P) && /if \(fields\.hasOwnProperty\('who'\)\) row\.counterparty_enc/.test(data));
t('investment → fhInvRowUpdate (+ position, account, time)', /fhInvRowUpdate\(E\.id, fv\)/.test(P) && /if \(fields\.hasOwnProperty\('positionId'\)\) row\.position_account_id/.test(inv));
t('pair → fhPersonalUpdateTransferPair by group id (+ per-leg account, one time), delete removes both legs', /fhPersonalUpdateTransferPair\(E\.gid, fx\)/.test(P) && /const legAcct = \(leg\.amt != null && leg\.amt < 0\) \? fields\.fromAccountId : fields\.toAccountId;/.test(data) && /E\.k==='xfer'\?await window\.fhPersonalDeleteTransferPair\(E\.gid\)/.test(P));
t('Lưu with nothing changed just leaves edit (or closes when opened into edit)', /if\(!_pxdDirty\(\)\)\{ if\(_pexdOpts\.edit\)\{ closePersonalTxDetail\(\); return; \} _pexdEdit=false; renderPersonalTxDetail\(\); return; \}/.test(P));
t('photo removal is staged and reconciled on Lưu', /PXD\.photos=cur;/.test(P) && /fhPersonalSyncTxnPhotos\(E\.id, p\.photos\)/.test(P));
t('Loại khoản conversions: expense → loan / investment via their sheets; loan / investment → expense flip in place', /fhExpenseToLoanSheet\(id\)/.test(P) && /fhExpenseToInvestSheet\(id\)/.test(P) && /fhPersonalConvertToExpense\(id,'Khác','🗂️'\)/.test(P) && /fhPersonalConvertInvestmentToExpense\(id,'Khác','🗂️'\)/.test(P));

console.log('\n-- callers: every row opens the one detail; the old sheets are no longer entry points --');
const callers = [tab, list, composer, debts, inv, income].join('\n');
t('no caller opens fhDebtRowSheet / fhXferPairSheet / fhInvRowSheet / fhIncomeRowSheet any more', !/fhDebtRowSheet\(|fhXferPairSheet\(|fhInvRowSheet\(|fhIncomeRowSheet\(/.test(callers.replace(/window\.fh(DebtRowSheet|XferPairSheet|InvRowSheet|IncomeRowSheet) = /g, '')));
t('zoom-ins pass from:zoom, a back label and a structured reopen hook', /reopen:\[\\'person\\',' \+ idx \+ '\]/.test(debts) && /reopen:\[\\'acct\\',/.test(debts) && /reopen:\[\\'pos\\',/.test(inv) && /re\[0\]==='person'&&window\.openDebtPerson\) openDebtPerson\(re\[1\]\)/.test(P));
t('the composer\'s kind routing goes to the detail in edit', /openPersonalTxDetail\(id,\{edit:true\}\)/.test(composer));
t('a mirror master routes to its family twin', /if\(t\.spaceId \|\| t\.linkId\)\{ if\(typeof fhMirrorRowTap==='function'\) fhMirrorRowTap\(id\); return; \}/.test(P));
t('the personal detail paints above the debt overlay', /#pexd-overlay\{z-index:50\}/.test(css));

console.log('\n-- the family detail: same frame, same ask row --');
const F = ui.slice(ui.indexOf('function renderExpenseDetail(){'), ui.indexOf('/* ═══ the PERSONAL transaction detail'));
t('family opens in view, closes to view; nav ‹ Quay lại · Sửa, then Huỷ · Sửa khoản chi · Lưu', /EXD=\{\}; _exdEdit=false;/.test(ui) && /onclick="exdEdit\(\)">'\+L\('Sửa','Edit'\)/.test(F) && /id="exd-save" onclick="exdSave\(\)"/.test(F) && /if\(incoming\) _exdEdit=false;/.test(F));
t('family ask is the same action row and the same sheet; photos still write through paApply', /_pexdCC\(_PEXD_ICO\.cam,L\('Thêm ảnh hoá đơn','Add a receipt photo'\),'exdPhotoSheet\(\)'\)/.test(F) && /_pexdPhotoSheetOpen\('exdDoorPick'\)/.test(F) && /await window\.paApply\(id, srcs\)/.test(F));
t('no Cập nhật and no trash square in the family detail', !/Cập nhật/.test(F) && !/exd-cta-del/.test(F));
t('family delete is the muted foot line in edit only', /class="exd-del" id="exd-del" onclick="expDetailDelete\(\)"/.test(F) && /Chạm lần nữa để xoá/.test(ui));

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
