/**
 * Receipt enrichment L3/L4 — the device join engine (78-receipt-join.js).
 *
 * The whole module runs against a stubbed environment: a fake PostgREST that
 * serves receipt rows, a fake opener (the real one is pinned by the pipeline
 * suites), the real taxonomy file for the DCA walk, and a personal ledger
 * slice. What is pinned:
 *
 *   - the match rule: exact paid total, ±1 day, tail confirm/VETO, ambiguity
 *     attaches nothing, one receipt to one row;
 *   - collapse by order id, richest wins, losers retired;
 *   - DCA over item nodes: unanimous → leaf, siblings → parent, divergent
 *     roots → null (merchant tier keeps the answer);
 *   - description rules incl. mixed → "Seller · N món";
 *   - the ledger pass touches ONLY private expenses, one candidate only,
 *     young receipts wait, and grace retires the unmatched.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const SRC = fs.readFileSync(path.join(__dirname, '../src/js-ui/78-receipt-join.js'), 'utf8');
const TREE = JSON.parse(fs.readFileSync(path.join(__dirname, '../taxonomy/taxonomy.json'), 'utf8'));

let failed = 0;
function t(name, ok, extra) {
  if (ok) console.log('  PASS  ' + name);
  else { failed++; console.log('  FAIL  ' + name + (extra !== undefined ? '  -> ' + JSON.stringify(extra) : '')); }
}

const byCode = Object.fromEntries(TREE.nodes.map((n) => [n.code, n]));
/* The REAL generated tree runs inside the sandbox (11-taxonomy.js is the file
   the app ships), so keywordNode and ancestors under test are the shipping
   ones — a hand-rolled stub would let the category rules drift from the tree. */
const TAX_SRC = fs.readFileSync(path.join(__dirname, '../src/js-ui/11-taxonomy.js'), 'utf8');
const fhNodeDepth = (c) => (byCode[c] || {}).depth || 0;

function makeEnv(state) {
  const env = {
    console, setTimeout, clearTimeout, Date, JSON, Math, Promise, Array, Object, String, Number, isFinite,
    fhNodeDepth,
    curMult: () => 1000,
    sb: {
      from: () => {
        const q = { _receipt: false };
        const self = {
          select: () => self,
          eq: (k, v) => { if (k === 'row_kind' && v === 'receipt') q._receipt = true; return self; },
          order: () => self,
          limit: () => Promise.resolve(q._receipt ? { data: state.receiptRows || [], error: null } : { data: [], error: null }),
        };
        return self;
      },
      functions: { invoke: async (name, args) => {
        state.conceptCalls.push(args.body.merchants);
        return { data: { nodes: state.nodeAnswers || {} } };
      } },
    },
    fhReadStagedRow: async (row) => state.opened[row.id] || { id: row.id, _unreadable: 'x' },
    fhPersonalMatchSlice: async () => state.slice || [],
    fhPersonalSetReceipt: async (id, rc, opts) => { state.attached.push({ id, rc, upgrade: !!(opts && opts.upgrade) }); return state.setOk !== false; },
    fhPersonalGetReceipt: async (id) => (state.stored || {})[id] || null,
    fhPersonalMatchSliceInvalidate: () => {},
    fhStagedRetireIds: async (ids) => { state.retired.push(...ids); },
    fhLessonItemNode: (sig) => (state.lessons || {})[sig] || null,
  };
  env.window = env;
  env.globalThis = env;
  vm.createContext(env);
  vm.runInContext(TAX_SRC, env);     // defines window.FH_TAX, exactly as the app loads it
  vm.runInContext(SRC, env);
  return env;
}

/* One staged receipt row + its opened payload. */
function rrow(state, id, opts) {
  const o = opts || {};
  state.receiptRows.push({ id, created_at: o.created || new Date().toISOString(),
    occurred_at: o.at || '2026-09-26T13:09:20+07:00', source_provider: o.provider || 'Shopee' });
  state.opened[id] = { id, raw_extracted: {
    node: o.sealedNode || null,
    receipt: { service_type: 'goods', order_id: o.order || null, seller: o.seller || null,
      items: o.items || null,   // items may carry {node, sig} exactly as the worker seals them
      items_total: o.itemsTotal || null, discount: o.discount || null,
      shipping_fee: null, paid: o.paid, paid_with_tail: o.tail || null },
    amount: o.paid, direction: 'debit',
  } };
}
/* One opened queue (bank) row. */
function qrow(id, amount, at, tail) {
  return { id, occurred_at: at || '2026-09-26T13:09:00+07:00',
    raw_extracted: { amount, direction: 'debit', account_masked: tail ? ('5138***' + tail) : null } };
}
const freshState = () => ({ receiptRows: [], opened: {}, slice: [], retired: [], attached: [], conceptCalls: [], nodeAnswers: {} });

(async () => {
  console.log('-- queue join: the match rule --');
  let st = freshState();
  rrow(st, 'r1', { paid: 681700, order: 'A1', seller: 'olanevietnam', tail: '4751',
    items: [{ name: 'Goggles' }, { name: 'Swim cap' }] });
  let env = makeEnv(st);
  let q1 = qrow('q1', 681700, '2026-09-26T13:09:00+07:00', '4751');
  let q2 = qrow('q2', 500000);
  await env.fhReceiptJoinQueue([q1, q2]);
  t('exact paid + day + tail: attached', !!q1._rcpt && q1._rcptRowId === 'r1', q1._rcpt && 'yes');
  t('the other row untouched', !q2._rcpt);
  t('nothing retired yet — the receipt retires with the IMPORT', st.retired.length === 0, st.retired);

  st = freshState();
  rrow(st, 'r1', { paid: 100000, tail: '4751' });
  env = makeEnv(st);
  q1 = qrow('q1', 100000, undefined, '9999');
  await env.fhReceiptJoinQueue([q1]);
  t('tail disagreement is a VETO even with amount+day equal', !q1._rcpt);

  st = freshState();
  rrow(st, 'r1', { paid: 100000 });
  env = makeEnv(st);
  q1 = qrow('q1', 100000); q2 = qrow('q2', 100000);
  await env.fhReceiptJoinQueue([q1, q2]);
  t('two candidates, no tail to decide: ambiguity attaches nothing', !q1._rcpt && !q2._rcpt);

  st = freshState();
  rrow(st, 'r1', { paid: 100000, tail: '4751' });
  env = makeEnv(st);
  q1 = qrow('q1', 100000); q2 = qrow('q2', 100000, undefined, '4751');
  await env.fhReceiptJoinQueue([q1, q2]);
  t('…but a tail hit breaks the tie', !q1._rcpt && q2._rcpt && q2._rcptRowId === 'r1');

  st = freshState();
  rrow(st, 'r1', { paid: 100000, at: '2026-09-20T10:00:00+07:00' });
  env = makeEnv(st);
  q1 = qrow('q1', 100000, '2026-09-26T10:00:00+07:00');
  await env.fhReceiptJoinQueue([q1]);
  t('six days apart: never a match', !q1._rcpt);

  console.log('\n-- collapse by order id --');
  st = freshState();
  rrow(st, 'rPay', { paid: 681700, order: 'A1', seller: 's', items: [{ name: 'a' }, { name: 'b' }] });
  rrow(st, 'rShip', { paid: 681700, order: 'A1' });                 // the delivered mail: poorer copy
  env = makeEnv(st);
  q1 = qrow('q1', 681700);
  await env.fhReceiptJoinQueue([q1]);
  t('richest copy wins the join', q1._rcptRowId === 'rPay', q1._rcptRowId);
  t('the poorer twin is retired', st.retired.indexOf('rShip') >= 0, st.retired);

  console.log('\n-- item categories: local, refining only, never voting --');
  st = freshState();
  rrow(st, 'r1', { paid: 100000, seller: 'olane', items: [{ name: 'Mũ bơi' }, { name: 'Kính bơi' }] });
  env = makeEnv(st);
  q1 = qrow('q1', 100000);
  q1.raw_extracted.node = 'shopping';                 // the bank-side cascade's answer
  await env.fhReceiptJoinQueue([q1]);
  t('items are categorised on the DEVICE — nothing is sent anywhere',
    st.conceptCalls.length === 0, st.conceptCalls);
  t('the tree\'s own keywords answer: swim gear is Đồ thể thao',
    (q1._rcpt.items || []).every(function (it) { return it.node === 'sportsgear'; }),
    (q1._rcpt.items || []).map(function (it) { return it.node; }));
  t('an item node INSIDE the transaction\'s branch is kept (refinement)',
    q1._rcpt.items[0].node === 'sportsgear');
  t('the transaction\'s own node is NEVER rewritten by its items',
    q1.raw_extracted.node === 'shopping', q1.raw_extracted.node);
  t('an agreeing basket still names itself', /Mũ bơi \+1 món/.test(q1._rcptDesc), q1._rcptDesc);

  st = freshState();
  rrow(st, 'r1', { paid: 100000, seller: 'olane', items: [{ name: 'Mũ bơi' }] });
  env = makeEnv(st);
  q1 = qrow('q1', 100000);
  q1.raw_extracted.node = 'streaming';                // a DIFFERENT branch
  await env.fhReceiptJoinQueue([q1]);
  t('an item node OUTSIDE the branch is dropped, never shown against it',
    q1._rcpt.items[0].node === null, q1._rcpt.items[0].node);
  t('…and it still does not move the transaction',
    q1.raw_extracted.node === 'streaming', q1.raw_extracted.node);

  st = freshState();
  rrow(st, 'r1', { paid: 100000, seller: 'AEON', items: [{ name: 'Mũ bơi' }, { name: 'Máy ảnh Canon' }] });
  env = makeEnv(st);
  q1 = qrow('q1', 100000);
  q1.raw_extracted.node = 'shopping';
  await env.fhReceiptJoinQueue([q1]);
  t('a mixed basket keeps each item\'s own category', 
    q1._rcpt.items[0].node === 'sportsgear' && q1._rcpt.items[1].node === 'hobby',
    (q1._rcpt.items || []).map(function (it) { return it.node; }));
  t('mixed basket description: seller · N món', q1._rcptDesc === 'AEON · 2 món', q1._rcptDesc);

  st = freshState();
  rrow(st, 'r1', { paid: 100000, items: [{ name: 'One thing' }] });
  env = makeEnv(st);
  q1 = qrow('q1', 100000);
  await env.fhReceiptJoinQueue([q1]);
  t('single item: its name is the description', q1._rcptDesc === 'One thing', q1._rcptDesc);

  console.log('\n-- Phase 2 on the device: lesson → sealed → keywords --');
  st = freshState();
  rrow(st, 'r1', { paid: 100000, items: [{ name: 'Qwrty Lock&Lock 5L', node: 'appliance', sig: 'hn|qwrty lock' }] });
  env = makeEnv(st);
  q1 = qrow('q1', 100000);
  q1.raw_extracted.node = 'housing';
  await env.fhReceiptJoinQueue([q1]);
  t('a node the worker sealed is used when the keywords know nothing', q1._rcpt.items[0].node === 'appliance', q1._rcpt.items[0].node);
  t('…and the signature rides through the blob', q1._rcpt.items[0].sig === 'hn|qwrty lock', q1._rcpt.items[0].sig);

  st = freshState();
  st.lessons = { 'hn|qwrty lock': 'toys' };                              // the person said: this is a toy
  rrow(st, 'r1', { paid: 100000, items: [{ name: 'Qwrty Lock&Lock 5L', node: 'appliance', sig: 'hn|qwrty lock' }] });
  env = makeEnv(st);
  q1 = qrow('q1', 100000);
  q1.raw_extracted.node = 'housing';                                     // toys is OUTSIDE this branch
  await env.fhReceiptJoinQueue([q1]);
  t('the person\'s own lesson outranks the sealed node', q1._rcpt.items[0].node === 'toys', q1._rcpt.items[0].node);
  t('…and a human pick SURVIVES the branch constraint', q1._rcpt.items[0].node === 'toys' && q1.raw_extracted.node === 'housing');

  st = freshState();
  st.lessons = { 'hn|mu boi': 'clothes' };                               // a lesson keyed by head noun, no sealed sig
  rrow(st, 'r1', { paid: 100000, items: [{ name: 'Mũ bơi Speedo' }] });  // a pre-Phase-2 blob: no node, no sig
  env = makeEnv(st);
  q1 = qrow('q1', 100000);
  await env.fhReceiptJoinQueue([q1]);
  t('an old blob without a signature still finds its lesson by head noun', q1._rcpt.items[0].node === 'clothes', q1._rcpt.items[0].node);

  st = freshState();
  rrow(st, 'r1', { paid: 100000, items: [{ name: 'Mũ bơi Speedo' }] });
  env = makeEnv(st);
  q1 = qrow('q1', 100000);
  q1.raw_extracted.node = 'shopping';
  await env.fhReceiptJoinQueue([q1]);
  t('no lesson, nothing sealed: the keywords answer (pre-Phase-2 blobs)', q1._rcpt.items[0].node === 'sportsgear', q1._rcpt.items[0].node);

  console.log('\n-- the ledger pass --');
  const old = new Date(Date.now() - 5 * 864e5).toISOString();
  st = freshState();
  rrow(st, 'r1', { paid: 681700, created: old, at: old });
  st.slice = [
    { id: 'p1', kind: 'expense', link: null, amt: 681.7, date: old.slice(0, 10) },
    { id: 'p2', kind: 'expense', link: 'fam1', amt: 681.7, date: old.slice(0, 10) },   // mirror: machine-owned
  ];
  env = makeEnv(st);
  await env.fhReceiptJoinQueue([]);   // no queue rows: straight to the ledger
  t('attached to the one private expense', st.attached.length === 1 && st.attached[0].id === 'p1', st.attached);
  t('…and the receipt row retired', st.retired.indexOf('r1') >= 0, st.retired);

  st = freshState();
  rrow(st, 'r1', { paid: 681700 });   // created NOW
  st.slice = [{ id: 'p1', kind: 'expense', link: null, amt: 681.7, date: new Date().toISOString().slice(0, 10) }];
  env = makeEnv(st);
  await env.fhReceiptJoinQueue([]);
  t('a young receipt WAITS for the review (its twin may be pending)', st.attached.length === 0 && st.retired.length === 0);

  st = freshState();
  rrow(st, 'r1', { paid: 681700, created: old, at: old });
  st.slice = [
    { id: 'p1', kind: 'expense', link: null, amt: 681.7, date: old.slice(0, 10) },
    { id: 'p2', kind: 'expense', link: null, amt: 681.7, date: old.slice(0, 10) },
  ];
  env = makeEnv(st);
  await env.fhReceiptJoinQueue([]);
  t('two ledger candidates: ambiguity attaches nothing', st.attached.length === 0);

  console.log('\n-- upgrading a poor receipt (the reader-fix recovery path) --');
  st = freshState();
  rrow(st, 'r1', { paid: 681700, created: old, at: old, items: [{ name: 'Goggles' }, { name: 'Cap' }] });
  st.slice = [{ id: 'p1', kind: 'expense', link: null, amt: 681.7, date: old.slice(0, 10) }];
  st.stored = { p1: { v: 1, source: 'email', items: null, paid: 681700 } };   // a poor blob from the broken reader
  env = makeEnv(st);
  await env.fhReceiptJoinQueue([]);
  t('a stored receipt with NO items is deepened by one that has them',
    st.attached.length === 1 && st.attached[0].upgrade === true
    && (st.attached[0].rc.items || []).length === 2, st.attached);

  st = freshState();
  rrow(st, 'r1', { paid: 681700, created: old, at: old, items: [{ name: 'Goggles' }] });
  st.slice = [{ id: 'p1', kind: 'expense', link: null, amt: 681.7, date: old.slice(0, 10) }];
  st.stored = { p1: { v: 1, items: [{ name: 'Already here' }], paid: 681700 } };
  env = makeEnv(st);
  await env.fhReceiptJoinQueue([]);
  t('a row that already has items is left alone', st.attached.length === 0, st.attached);

  st = freshState();
  rrow(st, 'r1', { paid: 681700, created: old, at: old });                     // order-level only
  st.slice = [{ id: 'p1', kind: 'expense', link: null, amt: 681.7, date: old.slice(0, 10) }];
  st.stored = { p1: { v: 1, items: null, paid: 681700 } };
  env = makeEnv(st);
  await env.fhReceiptJoinQueue([]);
  t('an item-less receipt never overwrites another item-less one', st.attached.length === 0, st.attached);

  st = freshState();
  rrow(st, 'r1', { paid: 681700, created: old, at: old, items: [{ name: 'Goggles' }] });
  st.slice = [{ id: 'p1', kind: 'expense', link: null, amt: 681.7, date: old.slice(0, 10) }];
  st.stored = { p1: '_unreadable' };
  env = makeEnv(st);
  await env.fhReceiptJoinQueue([]);
  t('an UNREADABLE blob is never overwritten (it may be good ciphertext)', st.attached.length === 0, st.attached);

  // the young-receipt wait applies to a bare row, but never to an upgrade
  st = freshState();
  const today = new Date().toISOString();
  rrow(st, 'r1', { paid: 681700, at: today, items: [{ name: 'Goggles' }] });   // created NOW
  st.slice = [{ id: 'p1', kind: 'expense', link: null, amt: 681.7, date: today.slice(0, 10) }];
  st.stored = { p1: { v: 1, items: null, paid: 681700 } };
  env = makeEnv(st);
  await env.fhReceiptJoinQueue([]);
  t('a YOUNG receipt may still upgrade a row that already joined (no twin to wait for)',
    st.attached.length === 1 && st.attached[0].upgrade === true, st.attached);

  console.log('\n-- grace --');
  const stale = new Date(Date.now() - 20 * 864e5).toISOString();
  st = freshState();
  rrow(st, 'r1', { paid: 999999, created: stale, at: stale });
  env = makeEnv(st);
  await env.fhReceiptJoinQueue([]);
  t('unmatched past 14 days: retired quietly', st.retired.indexOf('r1') >= 0, st.retired);
  st = freshState();
  rrow(st, 'r1', { paid: 999999 });
  env = makeEnv(st);
  await env.fhReceiptJoinQueue([]);
  t('unmatched but young: still waiting', st.retired.length === 0);

  if (failed) { console.log('\n' + failed + ' FAILED'); process.exit(1); }
  console.log('\nall passed');
})().catch((e) => { console.error(e); process.exit(1); });
