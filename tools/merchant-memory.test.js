#!/usr/bin/env node
/* A category taught for a merchant must carry to the same merchant at a
 * different amount.  `node tools/merchant-memory.test.js`
 *
 * The report this exists for: "REVI PHU MY HUNG TOWER is Ăn uống, we had this
 * category before, why are recent transactions not carrying it?"
 *
 * csvLearnKey was merchant + amount BAND (50k / 500k / 5M). A lesson given at
 * 2.888đ lived under `...|a` and was invisible at 120.000đ (`...|b`), so the
 * answer the person had already supplied was silently not used. Ordinary
 * spending crosses those boundaries constantly.
 *
 * Lessons are now written under both the banded and the bare key, and lookup
 * prefers the banded one — specific knowledge still beats general.
 *
 * Real functions extracted from source by name.
 */
// NOT 'use strict': eval'd declarations must land in this scope.
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'js-ui', '57-csv-import-review.js'), 'utf8');

var csvLearned = {}, saves = 0;
function csvLearnSave(){ saves++; }
function deburr(x){ return String(x).normalize('NFD').replace(/[̀-ͯ]/g, ''); }
for (const n of ['CSV_BANK_NOISE','CSV_GATEWAYS']) {
  const m = src.match(new RegExp('(?:var|const)\\s+' + n + '\\s*=\\s*[^;]+;'));
  if (m) eval(m[0]); else { console.error('missing ' + n); process.exit(1); }
}
for (const n of ['csvPatternKey','csvAmountBand','csvLearnKeyBase','csvLearnKey','csvLearnedCat','csvLearnFrom']) {
  const i = src.indexOf('function ' + n + '(');
  if (i < 0) { console.error('missing ' + n + ' — renamed?'); process.exit(1); }
  eval(src.slice(i, src.indexOf('\n}', i) + 2));
}

let pass = 0, fail = 0;
const t = (n, ok, d) => { console.log((ok ? '  PASS  ' : '  FAIL  ') + n + (!ok && d ? '  -> ' + d : '')); ok ? pass++ : fail++; };

const REVI = 'REVI PHU MY HUNG TOWER';
const at = (amount) => ({ counterparty: REVI, description: '', amount: amount });

console.log('\n-- the reported bug --');
csvLearned = {};
csvLearnFrom(Object.assign(at(2888), { categoryName: 'Ăn uống', catSource: 'user' }));
t('taught at 2.888đ', csvLearnedCat(at(2888)) === 'Ăn uống');
t('carries to 120.000đ — a different band', csvLearnedCat(at(120000)) === 'Ăn uống',
  String(csvLearnedCat(at(120000))));
t('carries to 2.000.000đ', csvLearnedCat(at(2000000)) === 'Ăn uống');
t('and to 49đ, the bottom band', csvLearnedCat(at(49)) === 'Ăn uống');

console.log('\n-- a deliberate per-size answer still wins --');
csvLearned = {};
csvLearnFrom(Object.assign(at(2888),   { categoryName: 'Ăn uống', catSource: 'user' }));
csvLearnFrom(Object.assign(at(900000), { categoryName: 'Mua sắm', catSource: 'user' }));
t('the big-band lesson is used at its own size', csvLearnedCat(at(900000)) === 'Mua sắm');
t('the small-band lesson survives it', csvLearnedCat(at(2888)) === 'Ăn uống');
t('an untaught band falls back to the most recent merchant answer',
  csvLearnedCat(at(60000)) === 'Mua sắm', String(csvLearnedCat(at(60000))));

console.log('\n-- a different merchant learns nothing from this one --');
t('unrelated merchant stays unknown',
  csvLearnedCat({ counterparty: 'HIGHLANDS COFFEE', description: '', amount: 2888 }) === null);

console.log('\n-- only an explicit pick teaches --');
csvLearned = {};
csvLearnFrom(Object.assign(at(2888), { categoryName: 'Ăn uống', catSource: 'fallback' }));
t('a guessed category is never learned', csvLearnedCat(at(2888)) === null);
csvLearnFrom(Object.assign(at(2888), { categoryName: 'Ăn uống', catSource: 'history' }));
t('a history hit is not learned either', csvLearnedCat(at(2888)) === null);

console.log('\n-- short/empty merchant names are not stored --');
csvLearned = {}; saves = 0;
csvLearnFrom({ counterparty: 'ab', description: '', amount: 1000, categoryName: 'X', catSource: 'user' });
t('too short to identify anything -> nothing saved', saves === 0 && Object.keys(csvLearned).length === 0);

console.log('\n-- saving is skipped when nothing actually changed --');
csvLearned = {};
csvLearnFrom(Object.assign(at(2888), { categoryName: 'Ăn uống', catSource: 'user' }));
var before = saves;
csvLearnFrom(Object.assign(at(2888), { categoryName: 'Ăn uống', catSource: 'user' }));
t('re-teaching the same thing does not re-save', saves === before);

console.log('\n' + (fail === 0 ? 'ALL ' + pass + ' PASSED' : pass + ' passed, ' + fail + ' FAILED'));
process.exit(fail ? 1 : 0);
