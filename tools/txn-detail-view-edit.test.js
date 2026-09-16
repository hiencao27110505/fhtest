#!/usr/bin/env node
/* Personal transaction detail: view first, edit second, and the contextual
 * photo door (mockups/txn-detail-view-edit.html option 1,
 * mockups/photo-door-contextual.html option 1).
 * `node tools/txn-detail-view-edit.test.js`
 *
 * Source-shape guards in the style of personal-activation.test.js: the two
 * states, the review card's row vocabulary, where delete may live, and the
 * door's copy rules.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const R = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
const ui = R('src/js-ui/61-expense-detail.js');
const shell = R('src/index.html');
const css = R('src/css/46-expense-detail.css');

let pass = 0, fail = 0;
const t = (n, ok, d) => { console.log((ok ? '  PASS  ' : '  FAIL  ') + n + (!ok && d ? '  -> ' + d : '')); ok ? pass++ : fail++; };

// the personal block only — the family detail keeps its own Cập nhật
const P = ui.slice(ui.indexOf('/* ═══ the PERSONAL expense detail'));
const VIEW = P.slice(P.indexOf("if(!_pexdEdit){"), P.indexOf("} else {"));
const EDIT = P.slice(P.indexOf("} else {"), P.indexOf("body.innerHTML=html;"));

console.log('\n-- two states, one screen --');
t('opens in view mode, and closing resets the mode', /_pexdId=id; PXD=\{\}; _pexdEdit=false;/.test(P) && /_pexdId=null; PXD=\{\}; _pexdEdit=false;/.test(P));
t('the nav is rendered per state: ‹ Cá nhân · Sửa, then Huỷ · Sửa khoản chi · Lưu',
  /onclick="pexdEdit\(\)">Sửa</.test(P) && /onclick="pexdCancel\(\)">Huỷ</.test(P) && /class="cd-navtitle">Sửa khoản chi</.test(P) && /id="pexd-save" onclick="pexdSave\(\)">Lưu</.test(P));
t('the shell no longer hard-codes the back button; the nav is a mount point', /id="pexd-nav"/.test(shell) && !/<div class="cd-nav">\s*<button class="cd-back" onclick="closePersonalTxDetail\(\)"/.test(shell));
t('no Cập nhật anywhere in the personal detail', !/Cập nhật/.test(P));
t('the bottom CTA bar is emptied in both states and hidden when empty', /cta\.innerHTML=''/.test(P) && /#pexd-cta:empty\{display:none\}/.test(css));

console.log('\n-- view: nothing that changes data --');
t('view rows are read-only (ro), no chevron and no onclick', /_exdRow\(\{label:'Ghi vào đâu', ro:true/.test(VIEW) && !/fn:/.test(VIEW) && !/fhPickRow/.test(VIEW));
t('view has no delete and no inputs', !/pexdDelete/.test(VIEW) && !/<input/.test(VIEW.replace(/_pexdDoorHTML\(t\)/g, '')) && !/<textarea/.test(VIEW));
t('view keeps ink values on read-only rows (a fact, not a disabled control)', /\.exd-view \.csv-srow\.ro \.csv-sval b\{color:var\(--ink\)/.test(css));

console.log('\n-- edit: the review card\'s vocabulary, in its order --');
const order = ['Số tiền', 'Chi cho gì?', 'Ghi vào đâu', 'Loại khoản', 'Danh mục', "label:'Ngày'", "label:'Giờ'", 'Nguồn tiền'];
let last = -1, inOrder = true;
order.forEach((k) => { const i = EDIT.indexOf(k); if (i < 0 || i < last) inOrder = false; last = i; });
t('edit fields and rows follow the queue card: Số tiền · Chi cho gì? · Ghi vào đâu · Loại khoản · Danh mục · Ngày · Giờ · Nguồn tiền', inOrder);
t('amount and note are top inputs, not a combined sheet row', /id="pexd-amt"/.test(EDIT) && /id="pexd-note"/.test(EDIT) && !/Số tiền & ghi chú/.test(P));
t('the old "Ghi vào" label is gone; the row says "Ghi vào đâu" like the queue', !/label:'Ghi vào',/.test(P));
t('typed values are read into PXD before every re-render and before Lưu', /if\(_pexdEdit\) pexdReadFields\(\);/.test(P) && /pexdReadFields\(\);\s*if\(!_pxdDirty\(\)\)/.test(P));
t('Loại khoản opens a kind sheet whose picks are the two committed-row conversions', /onclick="pexdPickKind\(&#39;loan&#39;\)"/.test(P) && /onclick="pexdPickKind\(&#39;invest&#39;\)"/.test(P) && /fhExpenseToLoanSheet\(id\)/.test(P) && /fhExpenseToInvestSheet\(id\)/.test(P) && /id="sheet-exd-kind"/.test(shell));
t('Ghi vào đâu still routes to the move confirm, never a silent re-scope', /fn:'pexdMove\(\)'/.test(EDIT) && /fhMoveSheetOpen\(\)/.test(P));
t('delete lives only in edit, as the muted foot line, arm-then-confirm', /class="exd-del" id="pexd-del" onclick="pexdDelete\(\)"/.test(EDIT) && /Chạm lần nữa để xoá/.test(P) && !/exd-cta-del/.test(P));
t('Lưu with nothing changed just leaves edit; a change is one fhPersonalUpdateExpense', /if\(!_pxdDirty\(\)\)\{ _pexdEdit=false; renderPersonalTxDetail\(\); return; \}/.test(P) && /fhPersonalUpdateExpense\(_pexdId, fields\)/.test(P));
t('photo removal is staged and reconciled on Lưu through fhPersonalSyncTxnPhotos', /PXD\.photos=cur;/.test(P) && /fhPersonalSyncTxnPhotos\(_pexdId, p\.photos\)/.test(P));

console.log('\n-- the photo door: contextual copy, SVG marks, both doors --');
t('the door renders when the row has no photos, in both states', /\(ph\.length\?'':_pexdDoorHTML\(t\)\)/.test(VIEW) && /else html\+=_pexdDoorHTML\(t\);/.test(EDIT));
t('copy is written from the row: category, note, amount tier, source and age', /function pexdDoorCopy\(t\)/.test(P) && /big=amt>=5000/.test(P) && /an uong\|an ngoai/.test(P) && /pri=\(t\.src \|\| t\.date!==today\)\?'lib':'cam'/.test(P));
t('the mark and the buttons are SVG, no emoji in the card', /_PEXD_ICO\.receipt/.test(P) && !/[\u{1F300}-\u{1FAFF}]/u.test(P.slice(P.indexOf('function _pexdDoorHTML'), P.indexOf('function pexdDoorPick'))));
t('camera and library are real file inputs inside labels (iOS-safe), camera uses capture', /capture="environment"/.test(P) && /class="pdoor-btn/.test(P) && /<label class="pdoor-btn/.test(P));
t('today is built locally, never from toISOString', !/toISOString\(/.test(P));
t('photo picks read EXIF first (readPhoto) and go through the personal upload path', /readPhoto\(f, function\(src\)/.test(P) && /fhPersonalUploadTxnPhotos\(id, srcs\)/.test(P));
t('the door refuses politely when the ledger is locked or offline', /Mở khoá sổ cá nhân trước đã/.test(P) && /Cần mạng để thêm ảnh/.test(P));
t('door styles use tokens only', !/#[0-9a-f]{3,6}\b/i.test(css.slice(css.indexOf('.pdoor{'))));

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
