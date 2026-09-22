#!/usr/bin/env node
/* An imported personal row must carry its LABEL, not just its node.
 * `node tools/promote-label-id.test.js`
 *
 * 0144 gave personal_transactions a `label_id` and every writer accepts one
 * (`fhPersonalAddExpense(..., opts.labelId)`, `fhPersonalAddMany` reads
 * `s.labelId`, the update path honours `fields.labelId`). Nothing ever set it:
 * 0 of 240 rows on a real ledger carry one. While that is true, Q12 (the label
 * is stored, with a per-row override) and Q13 (a regroup asks "Áp dụng cho N
 * khoản cũ?") have nothing to work on at all.
 *
 * The node decides it, through the person's own partition (fhPersonalLabelFor),
 * at the moment the row is written. A node that resolves to no label — because
 * the person has no partition yet — passes null, exactly as before.
 *
 * The real promote function, the real tree and the real partition helpers; only
 * the queue, the accounts and the writer are stood in for.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ROOT = path.join(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'src/js-data/72-txn-review.js'), 'utf8');
const CSVUI = fs.readFileSync(path.join(ROOT, 'src/js-ui/56-csv-import-ui.js'), 'utf8');

let pass = 0, fail = 0;
const t = (n, ok, d) => { console.log((ok ? '  PASS  ' : '  FAIL  ') + n + (!ok && d !== undefined ? '  -> ' + JSON.stringify(d) : '')); ok ? pass++ : fail++; };

function grab(src, header) {
  const at = src.indexOf(header);
  if (at < 0) throw new Error('not found in source: ' + header + ' — renamed?');
  let i = src.indexOf('{', at), depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (!depth) break; }
  }
  return src.slice(at, i + 1);
}
const REAL = [
  grab(SRC, 'async function _fhPromoteStagedRun('),
  grab(SRC, 'window.fhStagedRowTime = function (c)') + ';',
  grab(CSVUI, 'function csvRowTime('),
].join('\n');

/* The partition of a person who has been through the first-run seed: one label
   per expense root, plus the catch-all. */
const SEEDED = [
  { id: 'lab-food', name: 'Ăn uống', emoji: '🍽️', claims: ['food'] },
  { id: 'lab-transport', name: 'Đi lại', emoji: '🚗', claims: ['transport'] },
  { id: 'lab-khac', name: 'Khác', emoji: '🗂️', claims: ['*'] },
];

async function specsFor(cand, labels, rawX) {
  let captured = null;
  const ctx = {
    console: { warn() {}, log() {} },
    crypto: { randomUUID: (() => { let n = 0; return () => 'gid-' + (++n); })() },
    L: (vi) => vi, toast: () => {},
    localStorage: { getItem: () => null, setItem() {} },
    _fhStagedRows: [{ id: 'staged-1', occurred_at: '2026-08-20T07:05:00Z', raw_extracted: rawX || {} }],
    csvReview: { ready: [cand] },
    csvStagedSelected: () => [cand],
    csvRowScope: () => 'personal',
    csvBaseAmt: (n) => Math.round(Number(n) / 1000),
    fhStagedIdsForResolved: () => [],
    fhStagedSource: () => 'direct-email',
    fhStagedAcct: () => ({ kind: 'deposit', provider: 'testbank', tail: '0001' }),
    fhStagedRawX: () => rawX || {},
    fhPersonalAccountEnsure: async () => 'acct-own',
    fhPersonalAddMany: async (specs) => { captured = specs; return { ok: false, written: 0 }; },
    _stagedResolve: async () => {}, _stagedRetiredAdd: () => {},
    _txrLoadShow: () => {}, _txrLoadMsg: () => {}, _txrYield: async () => {},
    _txrHeld: false,
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  // the REAL tree and the REAL partition rules decide which label a node belongs to
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'src/js-ui/11-taxonomy.js'), 'utf8'), ctx);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'src/js-ui/13-partition.js'), 'utf8'), ctx);
  vm.runInContext('var CAT_FALLBACK = "Others";'
    + 'function isFallbackCat(n){ return String(n||"").trim().toLowerCase()==="others"; }', ctx);
  ctx.fhPersonalData = () => ({ accounts: [{ id: 'acct-own', kind: 'deposit' }], labels: labels || [] });
  vm.runInContext(REAL, ctx);
  await vm.runInContext('_fhPromoteStagedRun()', ctx);
  return captured || [];
}
const base = { rowIndex: 0, amount: 250000, description: 'synthetic row', dateDisplay: '2026-08-20',
  counterparty: 'SYNTHETIC PARTY', _v2: true };

(async () => {
  console.log('\n-- the label rides with the node --');
  {
    let s = await specsFor(Object.assign({}, base, { _node: 'coffee', categoryName: 'Others' }), SEEDED);
    t('an expense on a leaf takes the label that claims its group',
      s.length === 1 && s[0].node === 'coffee' && s[0].labelId === 'lab-food', s);
    s = await specsFor(Object.assign({}, base, { _node: 'ridehail', categoryName: 'Others' }), SEEDED);
    t('a different group, a different label', s[0].labelId === 'lab-transport', s[0]);
    s = await specsFor(Object.assign({}, base, { _node: 'wage', isIncome: true, _incomeCat: 'Lương' }), SEEDED);
    t('an income row carries one too (the catch-all owns the income tree here)',
      s[0].kind === 'income' && s[0].labelId === 'lab-khac', s[0]);
  }

  console.log('\n-- an unresolvable label is null, which is what it always was --');
  {
    let s = await specsFor(Object.assign({}, base, { _node: 'coffee' }), []);
    t('no partition at all → null, never an invented id', s[0].labelId === null, s[0]);
    s = await specsFor(Object.assign({}, base, {}), SEEDED);
    t('no node → no label', s[0].node === null && s[0].labelId === null, s[0]);
    s = await specsFor(Object.assign({}, base, { _node: 'bankbank', _xfer: true, _xferOtherId: 'acct-other' }), SEEDED);
    t('a transfer pair has no category, so it carries no label either',
      s.length === 2 && s.every((x) => x.labelId === undefined || x.labelId === null), s.map((x) => x.labelId));
    s = await specsFor(Object.assign({}, base, { _node: 'coffee' }), SEEDED.slice(2));
    t('a partition that is only the catch-all still resolves to it (Q12)',
      s[0].labelId === 'lab-khac', s[0].labelId);
  }

  console.log('\n-- the printed fee is a row like any other --');
  {
    const s = await specsFor(Object.assign({}, base, { _node: 'coffee',
      _fee: { amount: 1100, on: true, node: 'bankfees' } }), SEEDED);
    t('the fee expense carries its own node and its own label',
      s.length === 2 && s[1].node === 'bankfees' && s[1].labelId === 'lab-khac', s.map((x) => [x.node, x.labelId]));
  }

  console.log('\n-- and the row stops being called "Others" --');
  {
    /* The review resolves a name through familyCatForConcept — the FAMILY's
       categories — even for a row bound for the personal book, which is how 240
       personal rows stored the English family catch-all. */
    let s = await specsFor(Object.assign({}, base, { _node: 'coffee', categoryName: 'Others' }), SEEDED);
    t('a personal row filed under the family catch-all takes the person\'s own label name',
      s[0].catName === 'Ăn uống' && s[0].catEmoji === '🍽️', [s[0].catName, s[0].catEmoji]);
    s = await specsFor(Object.assign({}, base, { _node: 'coffee', categoryName: 'Ăn ngoài' }), SEEDED);
    t('a name the person picked is NEVER overwritten', s[0].catName === 'Ăn ngoài', s[0].catName);
    s = await specsFor(Object.assign({}, base, { _node: 'coffee', categoryName: 'Others' }), []);
    t('a person with no labels keeps exactly today\'s behaviour', s[0].catName === 'Others', s[0].catName);
    s = await specsFor(Object.assign({}, base, { _node: 'p2p', categoryName: 'Others' }), SEEDED);
    t('a node the catch-all owns is not renamed to "Khác"', s[0].catName === 'Others', s[0].catName);
  }

  console.log('\n' + (fail === 0 ? 'ALL ' + pass + ' PASSED' : pass + ' passed, ' + fail + ' FAILED'));
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
