#!/usr/bin/env node
/* A new personal ledger must get real categories, not one bucket.
 * `node tools/personal-labels-seed.test.js`
 *
 * fhPersonalLabelsEnsureDefaults builds the person's first partition from the
 * category names already on their rows — their own vocabulary (Q6). On a BRAND
 * NEW account it ran with zero rows, so the only thing it could build was the
 * catch-all, and its own guard ("already has labels") then stopped it for good.
 * The partition was {Khác}, every node resolved to it, and the whole ledger read
 * "Others": 240 rows, 237 with a tree node, exactly one personal_labels row, on
 * the founder's second account (2026-09-22).
 *
 * So the guard is about the partition's SHAPE now: nothing, or nothing but a
 * catch-all, is still "not set up", and the fallback for a person with no
 * vocabulary of their own is the TREE — one label per expense root, named and
 * drawn from taxonomy.json so the two cannot drift.
 *
 * The whole of 19-personal.js is loaded and the REAL exported function is run;
 * only the network (sb) and the crypto are stood in for, and the stand-in
 * hydrate feeds the inserted rows back into P.labels so "run it twice" is a
 * real second run rather than a fresh one.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ROOT = path.join(__dirname, '..');

let pass = 0, fail = 0;
const t = (n, ok, d) => { console.log((ok ? '  PASS  ' : '  FAIL  ') + n + (!ok && d !== undefined ? '  -> ' + JSON.stringify(d) : '')); ok ? pass++ : fail++; };

const TAX = JSON.parse(fs.readFileSync(path.join(ROOT, 'taxonomy/taxonomy.json'), 'utf8'));
const EXPENSE_ROOTS = TAX.nodes.filter((n) => n.kind === 'expense' && !n.parent && !n.manual);

/* One ledger, wired for one run. `labels` and `txns` are the state hydrate would
   have left behind; everything returned is what the function did. */
function ledger(state) {
  const inserts = [];
  const ctx = {
    console: { warn() {}, log() {} }, L: (vi) => vi,
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    setTimeout: () => 0, clearTimeout: () => {}, crypto: { randomUUID: () => 'id' },
    document: { addEventListener() {} }, navigator: {},
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'src/js-ui/11-taxonomy.js'), 'utf8'), ctx);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'src/js-ui/13-partition.js'), 'utf8'), ctx);
  /* The values are encrypted on the way out; the stand-in keeps them readable so
     the test can assert on the NAMES and CLAIMS that were written, not on bytes. */
  vm.runInContext('var FHCrypto = { encVal: async function (k, v) { return "enc:" + JSON.stringify(v); } };', ctx);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'src/js-data/19-personal.js'), 'utf8'), ctx);

  const dec = (s) => JSON.parse(String(s).replace(/^enc:/, ''));
  ctx.sb = {
    from: (table) => ({
      insert: async (rows) => {
        if (table !== 'personal_labels') return { error: null };
        inserts.push(rows.map((r) => ({
          name: dec(r.name_enc), emoji: r.emoji, sort: r.sort_order, claims: JSON.parse(dec(r.claims_enc)),
        })));
        return { error: state.insertError || null };
      },
    }),
  };
  const P = ctx.fhPersonalData();
  P.uid = state.uid === undefined ? 'user-1' : state.uid;
  P.key = state.key === undefined ? 'key-1' : state.key;
  P.txns = state.txns || [];
  P.labels = (state.labels || []).map((l, i) => Object.assign({ id: 'lab-' + i, emoji: '🏷️', sortOrder: i }, l));
  // the real hydrate would re-read the table; this puts the new rows where it would.
  ctx.fhPersonalHydrate = async () => {
    const last = inserts[inserts.length - 1] || [];
    last.forEach((r, i) => P.labels.push({ id: 'new-' + P.labels.length + '-' + i, name: r.name, emoji: r.emoji, sortOrder: r.sort, claims: r.claims }));
  };
  return { ctx, P, inserts, run: () => ctx.fhPersonalLabelsEnsureDefaults() };
}
const names = (batch) => (batch || []).map((r) => r.name);
const catchAlls = (batch) => (batch || []).filter((r) => r.claims.length === 1 && r.claims[0] === '*');

(async () => {
  console.log('\n-- a brand-new ledger: the tree IS the first partition --');
  {
    const g = ledger({ labels: [], txns: [] });
    const done = await g.run();
    const seeded = g.inserts[0] || [];
    t('it seeds (and says so)', done === true && g.inserts.length === 1, [done, g.inserts.length]);
    t('one label per expense root, none missing',
      EXPENSE_ROOTS.every((n) => names(seeded).indexOf(n.vi) >= 0), names(seeded));
    t('each claims exactly its own root code',
      EXPENSE_ROOTS.every((n) => {
        const row = seeded.find((r) => r.name === n.vi);
        return row && row.claims.length === 1 && row.claims[0] === n.code;
      }), seeded.map((r) => [r.name, r.claims]));
    t('names and emojis come from the tree, not from a copy',
      EXPENSE_ROOTS.every((n) => (seeded.find((r) => r.name === n.vi) || {}).emoji === n.emoji));
    t('"Chưa rõ" (manual-only) is NOT one of them: only a person files there',
      names(seeded).indexOf('Chưa rõ') < 0, names(seeded));
    t('exactly one catch-all, claiming "*"', catchAlls(seeded).length === 1, catchAlls(seeded));
    t('...and it is the whole partition plus that catch-all',
      seeded.length === EXPENSE_ROOTS.length + 1, seeded.length);
    /* The real fix, stated as the user sees it: a node now resolves to a real
       label instead of everything landing in one bucket. */
    const lab = g.ctx.fhPersonalLabelFor('coffee');
    t('a node resolves to a real label, not the catch-all',
      !!lab && lab.label.name === 'Ăn uống', lab && lab.label.name);
  }

  console.log('\n-- a ledger holding ONLY the catch-all: the same, and it is reused --');
  {
    const g = ledger({ labels: [{ name: 'Khác', claims: ['*'], emoji: '🗂️' }], txns: [] });
    const done = await g.run();
    const seeded = g.inserts[0] || [];
    t('it runs (the old guard bailed here and left the ledger broken)', done === true, done);
    t('the full root partition is added', seeded.length === EXPENSE_ROOTS.length, names(seeded));
    t('NO second catch-all is created', catchAlls(seeded).length === 0, catchAlls(seeded));
    t('the existing catch-all is still the only one',
      g.P.labels.filter((l) => (l.claims || []).join() === '*').length === 1, g.P.labels.map((l) => l.claims));
    t('the new labels sort after the one that was there',
      seeded.every((r) => r.sort >= 1), seeded.map((r) => r.sort));
  }

  console.log('\n-- the person\'s OWN vocabulary still wins (Q6) --');
  {
    const g = ledger({ labels: [], txns: [
      { cat: 'Đi chợ', emoji: '🛒' }, { cat: 'Ăn ngoài', emoji: '🍜' },
      { cat: 'Đi chợ', emoji: '🛒' }, { cat: '', emoji: null },
    ] });
    await g.run();
    const seeded = g.inserts[0] || [];
    t('one label per distinct row category, deduped',
      names(seeded).filter((n) => n !== 'Khác').join('|') === 'Đi chợ|Ăn ngoài', names(seeded));
    t('the tree roots are NOT used when the person has words of their own',
      names(seeded).indexOf('Nhà ở & hoá đơn') < 0, names(seeded));
    t('plus one catch-all', catchAlls(seeded).length === 1);
  }

  console.log('\n-- rows that say nothing but "Others" are not a vocabulary --');
  {
    /* The founder's actual shape: 240 rows, every one of them stamped with the
       family catch-all. Seeding those as labels would rebuild the one bucket. */
    const g = ledger({ labels: [{ name: 'Khác', claims: ['*'], emoji: '🗂️' }],
      txns: [{ cat: 'Others', emoji: '🗂️' }, { cat: 'Khác', emoji: '🗂️' }] });
    await g.run();
    const seeded = g.inserts[0] || [];
    t('the catch-all name is skipped and the TREE answers instead',
      seeded.length === EXPENSE_ROOTS.length && names(seeded).indexOf('Others') < 0, names(seeded));
  }

  console.log('\n-- a partition the person made is never touched --');
  {
    const g = ledger({ labels: [
      { name: 'Ăn uống', claims: ['food'] }, { name: 'Khác', claims: ['*'] },
    ], txns: [{ cat: 'Ăn uống' }] });
    const done = await g.run();
    t('it does not run', done === false && g.inserts.length === 0, [done, g.inserts]);
  }
  {
    // C3: a label the tree could not map claims nothing. It is still theirs.
    const g = ledger({ labels: [{ name: 'Con cái', claims: [] }], txns: [] });
    const done = await g.run();
    t('a label that maps to nothing is still the person\'s: hands off',
      done === false && g.inserts.length === 0, [done, g.inserts]);
  }

  console.log('\n-- idempotent, and never without a key --');
  {
    const g = ledger({ labels: [], txns: [] });
    const first = await g.run();
    const second = await g.run();
    t('running twice changes nothing',
      first === true && second === false && g.inserts.length === 1, [first, second, g.inserts.length]);
  }
  {
    const g = ledger({ key: null, labels: [], txns: [] });
    t('a locked ledger writes nothing', (await g.run()) === false && g.inserts.length === 0);
  }
  {
    const g = ledger({ uid: null, labels: [], txns: [] });
    t('no user, no write', (await g.run()) === false && g.inserts.length === 0);
  }
  {
    const g = ledger({ labels: [], txns: [], insertError: { message: 'nope' } });
    t('a refused insert reports false rather than claiming success', (await g.run()) === false);
  }

  console.log('\n' + (fail === 0 ? 'ALL ' + pass + ' PASSED' : pass + ' passed, ' + fail + ' FAILED'));
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
