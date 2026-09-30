#!/usr/bin/env node
/* notify-lines — the device and the edge function must pick the SAME line.
 * `node tools/notify-lines.test.js`
 *
 * Surface 2 of notification-activation-spec.md shows a person the notification
 * they would actually have received, rendered in the browser, before they grant
 * permission. That is a promise, and it is broken the moment the two runtimes
 * disagree by one variant. So the two generated targets —
 *
 *   src/js-ui/14-notify-lines.js                          (classic script, device)
 *   supabase/functions/_shared/mailbox/notify-lines.mjs   (ESM, worker + push-send)
 *
 * — are run side by side here over the same fixtures, and every {c,t,d,p} enum
 * and every line must come out IDENTICAL. This equivalence is the whole reason
 * the generator exists; if it ever fails, the preview is lying.
 *
 * Also checked: notify-copy.mjs still answers with its own public surface, the
 * client slice obeys the src/ rules (classic script, no trailing newline), and
 * the generator's validations actually throw on malformed copy.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const ROOT = path.join(__dirname, '..');
const R = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

let pass = 0;
const t = (name, fn) => { fn(); pass++; console.log('  ✓ ' + name); };

/* The device target is loaded in a vm realm, so its objects have a DIFFERENT
   Object.prototype and deepStrictEqual would reject two identical results.
   Compare the serialisations instead — which is the stricter check anyway: it
   catches key ORDER too, and the enum is stringified into the push payload. */
const same = (a, b, msg) => assert.strictEqual(JSON.stringify(a), JSON.stringify(b), msg);

/* ── the two targets, loaded the way their runtimes load them ───────────────── */

/* Device: classic scripts in global scope, in build order — 11-taxonomy.js sorts
   before 14-notify-lines.js, which is how FH_NOTIFY reaches the tree. */
const ctx = {};
ctx.window = ctx;
ctx.console = console;
vm.createContext(ctx);
vm.runInContext(R('src/js-ui/11-taxonomy.js'), ctx);
vm.runInContext(R('src/js-ui/14-notify-lines.js'), ctx);
const CLIENT = ctx.window.FH_NOTIFY;

/* Worker: the public module, which now wraps the generated one. */
const NC = require(path.join(ROOT, 'supabase/functions/_shared/mailbox/notify-copy.mjs'));
const LINES = require(path.join(ROOT, 'supabase/functions/_shared/mailbox/notify-lines.mjs'));
const SRC = JSON.parse(R('taxonomy/notify-lines.json'));

/* ── fixtures: a spread of concepts, tiers, dayparts, pools and flows ───────── */

/* UTC instants chosen for their VN wall clock (+07:00): 01:32Z = 08:32 sáng,
   05:10Z = 12:10 trưa, 08:30Z = 15:30 chiều, 13:05Z = 20:05 tối. Midnight-Z is
   the date-only row that must produce no daypart at all. */
const AT = {
  sang: '2026-09-28T01:32:00Z',
  trua: '2026-09-28T05:10:00Z',
  chieu: '2026-09-28T08:30:00Z',
  toi: '2026-09-28T13:05:00Z',
  none: '2026-09-28T00:00:00Z',
  bad: 'not a date',
};
const AMOUNT = { 1: 18000, 2: 145000, 3: 1200000, 4: 9400000 };

const FIXTURES = [];
const push = (label, x) => FIXTURES.push({ label, x });

push('nothing at all', null);
push('an empty extraction', {});
for (const c of SRC.concepts) {
  for (const tier of [1, 2, 3, 4]) {
    for (const part of Object.keys(AT)) {
      push(c + ' t' + tier + ' ' + part, { category: c, amount: AMOUNT[tier], currency: 'VND', occurred_at: AT[part] });
    }
  }
}
/* Pools by merchant keyword — the fast gate, one merchant per pool per daypart. */
const MERCHANT = {
  coffee: 'HIGHLANDS COFFEE NGUYEN HUE',
  milktea: 'GONG CHA Q1',
  ride: 'GRAB *TRIP 84xxxx',
  cinema: 'CGV VINCOM LANDMARK',
};
for (const p of Object.keys(SRC.pools)) {
  for (const part of Object.keys(AT)) {
    push('keyword pool ' + p + ' ' + part, { counterparty: MERCHANT[p], amount: 55000, currency: 'VND', occurred_at: AT[part] });
    push('keyword pool ' + p + ' in the memo ' + part, { memo: 'thanh toan ' + MERCHANT[p], amount: 55000, currency: 'VND', occurred_at: AT[part] });
  }
  push('cached pool hint ' + p, { pool: p, category: 'Dining', amount: 55000, currency: 'VND', occurred_at: AT.chieu });
}
push('a pool hint no line exists for', { pool: 'karaoke', category: 'Fun', amount: 55000, currency: 'VND', occurred_at: AT.toi });
/* The tree fills what the extractor left empty: concept from conceptOf, pool
   from poolOf. Both sides must read the same tree. */
for (const node of ['coffee', 'milktea', 'bikehail', 'carhail', 'cinema', 'groceries', 'food', 'fresh']) {
  push('node ' + node + ' with no category', { node: node, amount: 145000, currency: 'VND', occurred_at: AT.trua });
  push('node ' + node + ' with a date-only row', { node: node, amount: 145000, currency: 'VND', occurred_at: AT.none });
}
push('a node this build does not know', { node: 'nosuchnode', amount: 145000, currency: 'VND', occurred_at: AT.sang });
push('a node that is not a string', { node: 42, amount: 145000, currency: 'VND', occurred_at: AT.sang });
/* Flows and currency. */
push('income by flow', { flow: 'income', amount: 9400000, currency: 'VND', occurred_at: AT.sang });
push('income by direction', { direction: 'credit', amount: 300000, currency: 'VND', occurred_at: AT.toi });
push('a transfer', { flow: 'transfer', amount: 2000000, currency: 'VND', occurred_at: AT.chieu });
push('a transfer with a coffee merchant', { flow: 'transfer', counterparty: MERCHANT.coffee, amount: 55000, currency: 'VND', occurred_at: AT.sang });
push('a foreign currency has no honest tier', { category: 'Shopping', amount: 12, currency: 'USD', occurred_at: AT.trua });
push('a foreign currency, large', { category: 'Shopping', amount: 9000000, currency: 'USD', occurred_at: AT.trua });
push('no amount', { category: 'Fun', occurred_at: AT.toi });
push('a tier-boundary amount', { category: 'Dining', amount: SRC.tiers[0], currency: 'VND', occurred_at: AT.none });
push('one đồng over the boundary', { category: 'Dining', amount: SRC.tiers[0] + 1, currency: 'VND', occurred_at: AT.none });
push('an unparseable time', { category: 'Dining', amount: 145000, currency: 'VND', occurred_at: AT.bad });
push('a category the tree never had', { category: 'Crypto', amount: 145000, currency: 'VND', occurred_at: AT.none });

/* ── 1. the enum: meta() on the device == copyMeta() on the worker ──────────── */

t('every fixture distils to the identical {c,t,d,p} on both runtimes', () => {
  for (const f of FIXTURES) {
    const a = CLIENT.meta(f.x);
    const b = NC.copyMeta(f.x);
    same(a, b, f.label + ': ' + JSON.stringify(a) + ' vs ' + JSON.stringify(b));
  }
});

t('the fixtures actually reach every concept, tier, daypart and pool', () => {
  const cs = new Set(), ts = new Set(), ds = new Set(), ps = new Set();
  for (const f of FIXTURES) { const m = NC.copyMeta(f.x); cs.add(m.c); ts.add(m.t); ds.add(m.d || '-'); if (m.p) ps.add(m.p); }
  for (const c of SRC.concepts.concat(['income', 'unknown'])) assert.ok(cs.has(c), 'no fixture produced ' + c);
  for (const n of [1, 2, 3, 4]) assert.ok(ts.has(n), 'no fixture produced tier ' + n);
  for (const d of SRC.dayparts.concat(['-'])) assert.ok(ds.has(d), 'no fixture produced daypart ' + d);
  for (const p of Object.keys(SRC.pools)) assert.ok(ps.has(p), 'no fixture produced pool ' + p);
});

/* ── 2. the line: body() on the device == reviewBody() on the worker ────────── */

/* Four draws per cell, offset off the boundaries so _pick's floor is unambiguous. */
const DRAWS = [0.001, 0.26, 0.51, 0.999];

t('every fixture renders the identical line on both runtimes, both languages', () => {
  let n = 0;
  for (const f of FIXTURES) {
    const meta = NC.copyMeta(f.x);
    for (const lang of ['vi', 'en']) {
      for (const r of DRAWS) {
        const a = CLIENT.body(meta, lang, r);
        const b = NC.reviewBody(meta, lang, r);
        same(a, b, f.label + ' / ' + lang + ' / ' + r);
        n++;
      }
    }
  }
  assert.ok(n > 2000, 'only ' + n + ' comparisons');
});

t('the full enum cross-product renders identically, cell by cell', () => {
  const concepts = SRC.concepts.concat(['income', 'unknown', 'Crypto']);
  const parts = [undefined].concat(SRC.dayparts).concat(['khuya']);
  const pools = [undefined].concat(Object.keys(SRC.pools)).concat(['karaoke']);
  let n = 0, distinct = new Set();
  for (const lang of ['vi', 'en']) {
    for (const c of concepts) {
      for (let tier = 1; tier <= 4; tier++) {
        for (const d of parts) {
          for (const p of pools) {
            const meta = { c: c, t: tier };
            if (d) meta.d = d;
            if (p) meta.p = p;
            for (const r of DRAWS) {
              const a = CLIENT.body(meta, lang, r);
              const b = NC.reviewBody(meta, lang, r);
              same(a, b, JSON.stringify(meta) + ' / ' + lang + ' / ' + r);
              distinct.add(a.title + a.body);
              n++;
            }
          }
        }
      }
    }
  }
  assert.ok(n > 10000, 'only ' + n + ' comparisons');
  /* A shared bug that returned one constant line would pass every equality
     above, so insist the sweep actually moved through the tables. */
  assert.ok(distinct.size > 300, 'the sweep only produced ' + distinct.size + ' distinct lines');
});

t('a degenerate meta degrades the same way on both sides', () => {
  for (const meta of [null, undefined, 0, 'Dining', [], {}, { c: 'Dining' }, { t: 9 }, { c: 'Dining', t: 0 },
    { c: 'Dining', t: -3 }, { c: 'Dining', t: '3' }, { c: 'Dining', t: 2, d: 'sang', p: 'coffee' }]) {
    for (const lang of ['vi', 'en', 'fr', undefined]) {
      for (const r of DRAWS) {
        same(CLIENT.body(meta, lang, r), NC.reviewBody(meta, lang, r), JSON.stringify(meta) + ' / ' + lang);
      }
    }
  }
});

t('the digest and the statement line are identical on both runtimes', () => {
  for (const lang of ['vi', 'en', 'fr', undefined]) {
    same(CLIENT.statement(lang), NC.statementBody(lang), 'statement / ' + lang);
    for (const n of [0, 1, 2, 7, 128, 806, 1e6, null, undefined, 'x', -5]) {
      same(CLIENT.digest(n, lang), NC.digestBody(n, lang), 'digest ' + n + ' / ' + lang);
    }
  }
  assert.strictEqual(NC.digestBody(806, 'vi').body.indexOf('806') >= 0, true);
  assert.strictEqual(NC.digestBody(806, 'vi').body.indexOf('{n}'), -1, 'the placeholder must be substituted');
});

t('the shared primitives agree too', () => {
  for (const [a, c] of [[0, 'VND'], [30000, 'VND'], [30001, 'VND'], [500000, 'VND'], [5000001, 'VND'], [12, 'USD'], [null, null]]) {
    assert.strictEqual(CLIENT.tierOf(a, c), LINES.tierOf(a, c), 'tierOf ' + a + ' ' + c);
  }
  for (const k of Object.keys(AT)) assert.strictEqual(CLIENT.dayPartOf(AT[k]), LINES.dayPartOf(AT[k]), k);
  for (const s of ['Highlands Coffee', 'CÀ PHÊ ĐÊM', 'Gong Cha', 'grab*trip', 'nothing here']) {
    assert.strictEqual(CLIENT.deburr(s), LINES.deburr(s), s);
    assert.strictEqual(CLIENT.keywordPool({ counterparty: s }), LINES.keywordPool({ counterparty: s }), s);
  }
});

/* ── 3. the tables themselves are the same bytes on both sides ──────────────── */

t('both targets carry the same table, and it is the JSON on disk', () => {
  const want = JSON.stringify({
    version: SRC.version, concepts: SRC.concepts, tiers: SRC.tiers, dayparts: SRC.dayparts,
    pools: SRC.pools, matrix: SRC.matrix, daypart: SRC.daypart,
    poolLines: SRC.poolLines, poolDaypart: SRC.poolDaypart,
    itemPools: SRC.itemPools, itemLines: SRC.itemLines,
    basketLines: SRC.basketLines, receiptRead: SRC.receiptRead,
    digest: SRC.digest, statement: SRC.statement,
  });
  assert.strictEqual(JSON.stringify(CLIENT.lines), want, 'the client slice drifted from the JSON');
  assert.strictEqual(JSON.stringify({
    version: LINES.NOTIFY_VERSION, concepts: LINES.CONCEPTS, tiers: LINES.TIERS, dayparts: SRC.dayparts,
    pools: LINES.POOLS, matrix: LINES.MATRIX, daypart: LINES.DAYPART,
    poolLines: LINES.POOL_LINES, poolDaypart: LINES.POOL_DAYPART,
    itemPools: LINES.ITEM_POOLS, itemLines: LINES.ITEM_LINES,
    basketLines: LINES.BASKET_LINES, receiptRead: LINES.RECEIPT_READ,
    digest: LINES.DIGEST, statement: LINES.STATEMENT,
  }), want, 'the worker module drifted from the JSON');
});

/* ── 3b. the basket (item-aware-notification-spec.md §3, §10) ───────────────── */

/* A receipt whose items all file under one pool's categories. `sportsgear` sits
   under hobbygoods, which the JSON maps to the `hobby` pool. */
/* The client's enum is built inside the vm realm, so deepStrictEqual would fail
   on prototypes alone. Values are the whole contract here. */
function eqMeta(a, b, where) {
  assert.strictEqual(JSON.stringify(a), JSON.stringify(b), where);
}
function receipt(items, extra) {
  return Object.assign({ paid: 600000, discount: 0, items: items }, extra || {});
}
const EXP = { flow: 'expense', direction: 'debit', amount: 600000, currency: 'VND', category: 'Shopping' };

t('an agreeing basket names its pool, identically on both sides', () => {
  const codes = Object.keys(SRC.itemPools);
  let checked = 0;
  for (const pool of codes) {
    const cat = SRC.itemPools[pool][0];
    const ex = Object.assign({}, EXP, { receipt: receipt([{ node: cat, qty: 1, unit_price: 600000 }]) });
    const a = CLIENT.meta(ex), b = NC.copyMeta(ex);
    eqMeta(a, b, 'meta drifted for ' + pool);
    assert.strictEqual(a.ip, pool, pool + ' did not survive into the enum');
    assert.ok(a.ib === undefined, 'a pool and a shape must never ride together');
    for (const lang of ['vi', 'en']) for (const r of DRAWS) {
      same(CLIENT.body(a, lang, r), NC.reviewBody(b, lang, r), pool + '/' + lang + '/' + r);
    }
    checked++;
  }
  assert.ok(checked === codes.length && checked > 0, 'no pools checked');
});

t('a basket that disagrees falls to its shape, never to a winner', () => {
  const ex = Object.assign({}, EXP, { receipt: receipt([
    { node: 'sportsgear', qty: 1, unit_price: 300000 },
    { node: 'medical', qty: 1, unit_price: 300000 },
  ]) });
  const a = CLIENT.meta(ex), b = NC.copyMeta(ex);
  eqMeta(a, b, 'a disagreeing basket');
  assert.ok(a.ip === undefined, 'a disagreeing basket must not name a pool');
});

t('the three shapes read the same on both sides', () => {
  const cases = {
    solo:    receipt([{ node: 'xunfiled', qty: 1, unit_price: 600000 }]),
    many:    receipt(Array.from({ length: 9 }, () => ({ node: 'xunfiled', qty: 1, unit_price: 60000 }))),
    voucher: receipt([{ node: 'xunfiled', qty: 2, unit_price: 200000 },
                      { node: 'clothing', qty: 1, unit_price: 200000 }], { discount: 400000 }),
  };
  for (const shape of Object.keys(cases)) {
    const ex = Object.assign({}, EXP, { receipt: cases[shape] });
    const a = CLIENT.meta(ex), b = NC.copyMeta(ex);
    eqMeta(a, b, 'meta drifted for ' + shape);
    assert.strictEqual(a.ib, shape, 'expected shape ' + shape + ', got ' + JSON.stringify(a));
    for (const lang of ['vi', 'en']) for (const r of DRAWS) {
      same(CLIENT.body(a, lang, r), NC.reviewBody(b, lang, r), shape + '/' + lang + '/' + r);
    }
  }
});

t('a voucher beats a long basket, and one big line beats many small ones', () => {
  const heavy = receipt(Array.from({ length: 9 }, () => ({ node: 'xunfiled', qty: 1, unit_price: 60000 })), { discount: 400000 });
  assert.strictEqual(CLIENT.meta(Object.assign({}, EXP, { receipt: heavy })).ib, 'voucher');
  const dominated = receipt([{ node: 'xunfiled', qty: 1, unit_price: 500000 },
                             { node: 'clothing', qty: 1, unit_price: 20000 }]);
  assert.strictEqual(CLIENT.meta(Object.assign({}, EXP, { receipt: dominated })).ib, 'solo');
});

t('the enum never carries a name, a code, a count or an amount', () => {
  const ex = Object.assign({}, EXP, { receipt: receipt([
    { node: 'sportsgear', name: 'Swimming Goggles OLANE 503M', qty: 1, unit_price: 607700, sig: 'hn|swimming goggles' },
  ]) });
  const m = CLIENT.meta(ex);
  const flat = JSON.stringify(m);
  assert.ok(!/OLANE|Goggles|607700|sportsgear|hn\|/.test(flat), 'the enum leaked something: ' + flat);
  assert.strictEqual(Object.keys(m).sort().join(','), 'c,ip,t', 'unexpected enum shape: ' + flat);
});

t('no receipt at all leaves the line exactly as it was', () => {
  const bare = Object.assign({}, EXP);
  const m = CLIENT.meta(bare);
  assert.ok(m.ip === undefined && m.ib === undefined);
  for (const lang of ['vi', 'en']) for (const r of DRAWS) {
    same(CLIENT.body(m, lang, r), NC.reviewBody(NC.copyMeta(bare), lang, r), 'bare/' + lang + '/' + r);
  }
});

t('an itemless receipt says nothing rather than guessing', () => {
  for (const rc of [receipt([]), receipt(null), { paid: 0, items: [{ qty: 1 }] }]) {
    const m = CLIENT.meta(Object.assign({}, EXP, { receipt: rc }));
    assert.ok(m.ip === undefined, 'named a pool from nothing: ' + JSON.stringify(m));
  }
});

t('the late receipt line names no purchase and matches on both sides', () => {
  for (const lang of ['vi', 'en']) for (const r of DRAWS) {
    const a = CLIENT.receiptRead(lang, r);
    assert.ok(a && a.title && a.body, 'no late line for ' + lang);
    assert.ok(!/\{|\d/.test(a.body), 'the late line carries a placeholder or a digit: ' + a.body);
    assert.strictEqual(a.body.slice(-1), '!');
  }
});

/* ── 4. shape guards: the generator's rules about its own output ────────────── */

t('the client slice is a classic script that ends without a newline (CLAUDE.md §1)', () => {
  const src = R('src/js-ui/14-notify-lines.js');
  assert.ok(!/\n$/.test(src), 'a trailing newline would make every rebuild diff');
  assert.ok(/^\/\* GENERATED by tools\/gen-notify-lines\.js/.test(src), 'no generated stamp');
  assert.ok(/window\.FH_NOTIFY = FH_NOTIFY;$/.test(src), 'FH_NOTIFY is not published');
  assert.ok(!/^\s*(?:import|export)\s/m.test(src), 'a module keyword would break the classic block');
  assert.ok(/window\.FH_TAX/.test(src), 'the tree is read through window.FH_TAX');
  const mjs = R('supabase/functions/_shared/mailbox/notify-lines.mjs');
  assert.ok(!/\n$/.test(mjs));
  assert.ok(/^import \{ conceptOf, poolOf, ancestors \} from '\.\/taxonomy\.mjs';$/m.test(mjs), 'the worker reads the real tree');
});

t('the selection logic is emitted once, so both targets hold the same text', () => {
  const logic = require(path.join(__dirname, 'gen-notify-lines.js'));
  assert.ok(typeof logic.generate === 'function' && typeof logic.load === 'function');
  const client = R('src/js-ui/14-notify-lines.js');
  const mjs = R('supabase/functions/_shared/mailbox/notify-lines.mjs');
  for (const fn of ['function tierOf(', 'function dayPartOf(', 'function keywordPool(', 'function validPool(',
    'function itemPoolOf(', 'function basketOf(', 'function receiptReadOf(',
    'function metaOf(', 'function _pick(', 'function bodyOf(', 'function digestOf(', 'function statementOf(']) {
    assert.ok(client.indexOf(fn) >= 0, 'client is missing ' + fn);
    assert.ok(mjs.indexOf(fn) >= 0, 'worker is missing ' + fn);
  }
  /* The whole body between the table and the wrapper must be byte-identical. */
  const slice = (s) => s.slice(s.indexOf('  var CONCEPTS = DATA.concepts'), s.lastIndexOf('function statementOf('));
  assert.strictEqual(slice(client), slice(mjs), 'the two targets hold DIFFERENT selection logic');
  assert.ok(slice(client).length > 2000);
});

t('notify-copy.mjs keeps its four exports and holds no tables of its own', () => {
  for (const name of ['copyMeta', 'reviewBody', 'digestBody', 'statementBody']) {
    assert.strictEqual(typeof NC[name], 'function', name + ' is gone');
  }
  assert.strictEqual(NC.copyMeta.length, 1);
  assert.strictEqual(NC.reviewBody.length, 3);
  assert.strictEqual(NC.digestBody.length, 2);
  assert.strictEqual(NC.statementBody.length, 1);
  const src = R('supabase/functions/_shared/mailbox/notify-copy.mjs');
  assert.ok(/from '\.\/notify-lines\.mjs'/.test(src), 'it no longer imports the generated tables');
  assert.ok(!/const (?:MATRIX|POOLS|DAYPART|POOL_LINES|POOL_DAYPART|TIERS|CONCEPTS) =/.test(src),
    'a literal table survived in notify-copy.mjs — that is the drift this change removes');
});

/* ── 5. the validations are real: malformed copy must fail loudly ───────────── */

const GEN = require(path.join(__dirname, 'gen-notify-lines.js'));
const RAW = R('taxonomy/notify-lines.json');
function loadMutated(mutate) {
  const bad = JSON.parse(RAW);
  mutate(bad);
  const orig = fs.readFileSync;
  fs.readFileSync = function (p) {
    if (typeof p === 'string' && p.indexOf('notify-lines.json') >= 0) return JSON.stringify(bad);
    return orig.apply(fs, arguments);
  };
  try { GEN.load(); } finally { fs.readFileSync = orig; }
}
const rejects = (why, mutate) => t('rejected: ' + why, () => {
  assert.throws(() => loadMutated(mutate), /notify-lines:/, why + ' was accepted');
});

t('the JSON on disk passes its own validation', () => { GEN.load(); });

rejects('a concept missing from one language', (d) => { delete d.matrix.en.Dining; });
rejects('a tier cell with three variants', (d) => { d.matrix.vi.Dining[1].pop(); });
rejects('a concept with three tiers', (d) => { d.matrix.en.Fun.pop(); });
rejects('a body that does not end in "!"', (d) => { d.matrix.vi.Fun[0][0].b = 'Vui tí cho đời dễ thở nha'; });
rejects('a body carrying a digit', (d) => { d.matrix.vi.Fun[0][0].b = 'Vui tí cho đời dễ thở 2 nha!'; });
rejects('a body of ten words', (d) => { d.matrix.en.Fun[0][0].b = 'One two three four five six seven eight nine ten!'; });
rejects('a title of two emoji', (d) => { d.matrix.vi.Fun[0][0].e = '😌😌'; });
rejects('a title that is not an emoji', (d) => { d.matrix.vi.Fun[0][0].e = 'A'; });
rejects('an emoji in the body', (d) => { d.matrix.vi.Fun[0][0].b = 'Vui tí cho đời dễ thở 😌!'; });
rejects('pool lines for a pool with no keywords', (d) => { d.poolLines.vi.karaoke = d.poolLines.vi.coffee; });
rejects('a pool with keywords but no lines', (d) => { d.pools.karaoke = ['karaoke']; });
rejects('a pool daypart for a pool that does not exist', (d) => { d.poolDaypart.en.karaoke = d.poolDaypart.en.coffee; });
rejects('a daypart override on a concept with no matrix row', (d) => { d.daypart.vi.Karaoke = d.daypart.vi.Dining; });
rejects('a missing daypart in a set', (d) => { delete d.daypart.en.Dining.trua; });
rejects('a keyword that is not deburred', (d) => { d.pools.coffee.push('cà phê'); });
rejects('a keyword claimed by two pools', (d) => { d.pools.cinema.push('grab'); });
rejects('tiers that do not ascend', (d) => { d.tiers = [500000, 30000, 5000000]; });
rejects('a digest with no {n}', (d) => { d.digest.vi.b = 'Đã tìm thấy giao dịch cũ, xem lúc rảnh nha!'; });
rejects('a statement line carrying a placeholder', (d) => { d.statement.en.b = 'A new {n} statement is waiting!'; });
rejects('a non-integer version', (d) => { d.version = 1.5; });

console.log('\nALL ' + pass + ' PASSED — device and edge function pick the same line');
