#!/usr/bin/env node
/* The category tree: the taxonomy's own invariants, the keyword matcher, the
 * partition, and the pieces of the review cascade that can be exercised without
 * a DOM. `node tools/tree-cascade.test.js`
 *
 * What this pins is mostly SAFETY, because the failure mode is silent: a
 * keyword that also spells a Vietnamese name files strangers under the vet, and
 * nobody sees it until they read their own breakdown. (docs/specs/category-tree-spec.md)
 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const ROOT = path.join(__dirname, '..');

let pass = 0, fail = 0;
const t = (n, ok, d) => { console.log((ok ? '  PASS  ' : '  FAIL  ') + n + (!ok && d !== undefined ? '  -> ' + JSON.stringify(d) : '')); ok ? pass++ : fail++; };

const tax = JSON.parse(fs.readFileSync(path.join(ROOT, 'taxonomy/taxonomy.json'), 'utf8'));
const ctx = { window: {}, localStorage: { getItem: () => null, setItem: () => {} } };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'src/js-ui/11-taxonomy.js'), 'utf8'), ctx);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'src/js-ui/13-partition.js'), 'utf8')
  + ';globalThis.__P={fhLabelForNode,fhDefaultClaimsFor,fhNodeGuess,fhNodeCorrections,fhNodeDepth,fhNodeFromClaims,fhNodeGroup};', ctx);
const T = ctx.FH_TAX, P = ctx.__P;

console.log('\n-- the tree is well formed --');
{
  const codes = new Set();
  let dupes = 0, orphans = 0, tooDeep = 0, badCode = 0;
  for (const n of tax.nodes) {
    if (codes.has(n.code)) dupes++;
    codes.add(n.code);
    if (!/^[a-z][a-z0-9]*$/.test(n.code)) badCode++;
    if (n.parent && !tax.nodes.some((m) => m.code === n.parent)) orphans++;
    if (n.depth > 3) tooDeep++;
  }
  t('every code is unique across ALL kinds', dupes === 0, dupes);
  t('codes are opaque and portable (no dots, no parent encoded)', badCode === 0, badCode);
  t('every parent exists', orphans === 0, orphans);
  t('nothing is deeper than 3', tooDeep === 0, tooDeep);
  t('one tree per kind', new Set(tax.nodes.map((n) => n.kind)).size === 6, [...new Set(tax.nodes.map((n) => n.kind))]);
  /* Exhaustive by construction: a parent is its own "other", so no node may be
     called Khác/Other — a row that fits no child rests on the parent instead. */
  const khac = tax.nodes.filter((n) => n.parent && /^(kh[aá]c|other|others)$/i.test(n.vi.trim()));
  t('no "Khác" leaves: a parent IS its own other', khac.length === 0, khac.map((n) => n.code));
  /* Only a person may file to the root. If a classifier could, "<1% unfiled"
     would measure nothing. */
  const manual = tax.nodes.filter((n) => n.manual);
  t('the unfiled roots are manual-only', manual.length >= 2 && manual.every((n) => !n.parent), manual.map((n) => n.code));
}

console.log('\n-- the legacy vocabularies still resolve --');
{
  const CONCEPTS = ['Housing', 'Groceries', 'Clothing', 'Shopping', 'Transport', 'Dining', 'Fun', 'Others'];
  const bad = tax.nodes.filter((n) => n.kind === 'expense' && !n.manual && CONCEPTS.indexOf(T.conceptOf(n.code)) < 0);
  t('every expense node maps to one of the 8 legacy concepts', bad.length === 0, bad.slice(0, 5).map((n) => n.code));
  t('conceptOf climbs to the nearest ancestor that has one', T.conceptOf('coffee') === 'Dining', T.conceptOf('coffee'));
  t('poolOf gives the notification its finer voice', T.poolOf('coffee') === 'coffee' && T.poolOf('milktea') === 'milktea');
  t('a ride pool comes off the leaf, not the group', T.poolOf('bikehail') === 'ride' && T.poolOf('transport') === null);
}

console.log('\n-- the keyword matcher finds what it should --');
{
  const hit = (s, want) => t('"' + s + '" → ' + want, T.keywordNode(s, 'expense') === want, T.keywordNode(s, 'expense'));
  hit('MPOS*WAYNESCOFFEE HO CHI MINH VN', 'coffee');     // brand glued to a gateway prefix
  hit('PAYOO-REVICOFFEEHCM03', 'coffee');
  hit('AEON NGUYEN VAN LINH', 'groceries');
  hit('tien dien thang 9', 'electric');
  hit('cafe 50k', 'coffee');                              // a typed note, not a bank memo
  t('a brand spanning two groups stays unanswered', T.keywordNode('VIB MOCA GRAB', 'expense') === null, T.keywordNode('VIB MOCA GRAB', 'expense'));
  t('a marketplace answers at GROUP level, never a leaf', T.keywordNode('Shopee VN', 'expense') === 'shopping');
  t('income keywords live in their own tree', T.keywordNode('thanh toan luong thang 03', 'income') === 'wage'
    && T.keywordNode('thanh toan luong thang 03', 'expense') === null);
}

console.log('\n-- and NOT what it should not (the expensive half) --');
{
  /* Every one of these is a real string from a real mailbox that an earlier
     version of the tree filed wrongly. A bank memo is mostly people's names,
     and Vietnamese without diacritics is full of collisions. */
  const clean = (s) => t('"' + s + '" stays unanswered', T.keywordNode(s, 'expense') === null, T.keywordNode(s, 'expense'));
  clean('616066 - NGO CUC THUY MY');                      // "thu y" (vet) inside the name THUY MY
  clean('468888 - TRUONG CAM THUY');                      // "truong" (school) is a surname
  clean('1029761712 - TANG KHANH HAO');                   // "tang" (to gift) is a surname
  clean('0721000536225 - MA PHI THONG');                  // "phi" (fee) is a given name
  clean('chuyen tien noi bo');                            // "noi" (pot) inside "nội bộ"
  clean('chua ro');                                       // "chua" (temple) vs "chưa" (not yet)
  clean('vay tieu dung');                                 // "vay" (skirt) vs "vay" (to borrow)
  clean('QOPAQUE SHOP');                                  // "shop" is in half the merchant names
  clean('Cong ty CPDV DDTT thanh toan luong thang 03');   // must not read as an expense at all
  t('"mua hang" is buying, not dancing', T.keywordNode('mua hang tiki', 'expense') === 'shopping');
}

console.log('\n-- the partition: labels claim nodes, most specific wins --');
{
  const labels = [
    { key: 'Ăn ngoài', claims: ['eatout', 'drinks'] },
    { key: 'Đi chợ', claims: ['groceries'] },
    { key: 'Cà phê', claims: ['coffee'] },
    { key: 'Others', claims: ['*'] },
  ];
  t('a leaf claim beats its group', P.fhLabelForNode('coffee', labels).key === 'Cà phê');
  t('a sibling of that leaf stays with the group', P.fhLabelForNode('milktea', labels).key === 'Ăn ngoài');
  t('a node under another claim goes there', P.fhLabelForNode('fresh', labels).key === 'Đi chợ');
  t('anything unclaimed lands in the catch-all', P.fhLabelForNode('fuel', labels).key === 'Others');
  t('an unknown code still lands in the catch-all', P.fhLabelForNode('zzz', labels).key === 'Others');
  t('no labels at all is null, never a crash', P.fhLabelForNode('coffee', []) === null);
}

console.log('\n-- default claims for the categories people already have --');
{
  const d = (name, emoji) => P.fhDefaultClaimsFor(name, emoji);
  t('a seeded name maps to its group', JSON.stringify(d('Ăn ngoài', '🍽️')) === '["eatout"]', d('Ăn ngoài', '🍽️'));
  t('Nhà ở → home', JSON.stringify(d('Nhà ở', '🏠')) === '["home"]', d('Nhà ở', '🏠'));
  t('the catch-all owns the root', JSON.stringify(d('Others', '🗂️')) === '["*"]', d('Others', '🗂️'));
  /* A label that spans several groups claims nothing rather than guessing one:
     "Con cái" is kids' food AND kids' clothes AND school fees. */
  t('a cross-cutting label claims nothing', d('Con cái', '👶').length === 0, d('Con cái', '👶'));
  t('an unknown name with a known emoji still maps', JSON.stringify(d('Mèo của tôi', '🐶')) === '["pets"]', d('Mèo của tôi', '🐶'));
}

console.log('\n-- the guess, and what a label may contribute --');
{
  t('a note alone is enough', P.fhNodeGuess({ note: 'cafe 50k' }) === 'coffee');
  /* The label is evidence only when the words are not: "200k" says nothing, so
     the label's own claim answers — at GROUP level, never a leaf. */
  t('a silent note falls back to the label claim', P.fhNodeGuess({ note: '200k', labelClaims: ['groceries'] }) === 'groceries');
  t('a label spanning two groups contributes nothing', P.fhNodeGuess({ note: 'xxx', labelClaims: ['eatout', 'drinks'] }) === null);
  t('a repayment never guesses (it inherits its loan)', P.fhNodeGuess({ kind: 'repayment', note: 'cafe' }) === null);
  t('corrections are siblings first', P.fhNodeCorrections('coffee').slice(0, 3).every((c) => T.get(c).parent === 'drinks'));
  t('depth: leaf 3, category 2, group 1, unknown 0',
    P.fhNodeDepth('coffee') === 3 && P.fhNodeDepth('drinks') === 2 && P.fhNodeDepth('food') === 1 && P.fhNodeDepth('zzz') === 0);
}

console.log('\n-- the generated targets stay in lockstep with the JSON --');
{
  const gen = require(path.join(ROOT, 'tools/gen-taxonomy.js'));
  const before = fs.readFileSync(path.join(ROOT, 'src/js-ui/11-taxonomy.js'), 'utf8');
  gen.generate();
  const after = fs.readFileSync(path.join(ROOT, 'src/js-ui/11-taxonomy.js'), 'utf8');
  t('regenerating changes nothing (the client is current)', before === after);
  t('the worker twin exists', fs.existsSync(path.join(ROOT, 'supabase/functions/_shared/mailbox/taxonomy.mjs')));
  t('the python twin exists', fs.existsSync(path.join(ROOT, 'earthy/serverless/functions/transaction-parser/parser/taxonomy.py')));
}

console.log('\n' + (fail ? fail + ' FAILED, ' : 'ALL ') + pass + ' PASSED');
process.exit(fail ? 1 : 0);