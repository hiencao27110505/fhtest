#!/usr/bin/env node
/* "Chọn nhanh" can pick by statement. `node tools/statement-quick-select.test.js`
 *
 * A statement is mostly rows the ledger already has, and the person reviews it as a
 * block: tick everything from this statement, or everything that came by email and
 * nothing from a statement. The conditions AND with the existing ones, like every
 * other group in the sheet. Real functions, lifted from 56 by name.
 */
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'js-ui', '56-csv-import-ui.js'), 'utf8');
const fx = (name) => { const j = src.indexOf('function ' + name + '('); if (j < 0) { console.error(name + ' not found'); process.exit(1); } return src.slice(j, src.indexOf('\n}', j) + 2); };
var window = { fhStmtOfCand: (c) => c.sid ? { id: c.sid, title: 'Sao kê ' + c.sid } : null };
var csvPickF, renderCsvReview = () => {};
function csvStagedProvider(c){ return c.prov; } function csvIsFlaggedDup(c){ return !!c.dup; } function csvDupTier(c){ return c.dup || ''; } function L(vi){ return vi; }
eval(['csvPickBlank', 'csvPickCount', 'csvPickMatch', 'csvStmtOf', 'csvPickViaTgl', 'csvPickStmtTgl'].map(fx).join('\n'));
csvPickF = csvPickBlank();

let pass = 0, fail = 0;
const t = (n, ok, d) => { console.log((ok ? '  PASS  ' : '  FAIL  ') + n + (!ok && d !== undefined ? '  -> ' + JSON.stringify(d) : '')); ok ? pass++ : fail++; };
const rows = [{ k: 'email-vib', prov: 'VIB' }, { k: 'stmtA-1', prov: 'MoMo', sid: 'A' }, { k: 'stmtA-2', prov: 'MoMo', sid: 'A', dup: 'sure' }, { k: 'stmtB-1', prov: 'VIB', sid: 'B' }];
const pick = () => rows.filter((c) => csvPickMatch(c, 0)).map((c) => c.k);

t('no condition matches everything, as before', pick().length === 4 && csvPickCount() === 0);
csvPickViaTgl('stmt');
t('"Từ sao kê": every statement row, no email row', JSON.stringify(pick()) === JSON.stringify(['stmtA-1', 'stmtA-2', 'stmtB-1']) && csvPickCount() === 1, pick());
csvPickViaTgl('stmt'); csvPickViaTgl('email');
t('"Từ email": the opposite', JSON.stringify(pick()) === JSON.stringify(['email-vib']), pick());
csvPickStmtTgl('A');
t('picking ONE statement drops "email only": the two cannot both hold', csvPickF.via === null && JSON.stringify(pick()) === JSON.stringify(['stmtA-1', 'stmtA-2']), { via: csvPickF.via, pick: pick() });
csvPickStmtTgl('B');
t('two statements are an OR', pick().length === 3);
csvPickStmtTgl('B'); csvPickF.dup = 'sure';
t('...and AND with the other groups: statement A, already booked', JSON.stringify(pick()) === JSON.stringify(['stmtA-2']), pick());
t('the badge counts each condition', csvPickCount() === 2, csvPickCount());
csvPickF = csvPickBlank(); window.fhStmtOfCand = undefined;
t('an app with no statement module behaves exactly as before', pick().length === 4);

console.log('\n' + (fail ? fail + ' FAILED, ' : 'ALL ') + pass + ' PASSED');
process.exit(fail ? 1 : 0);
