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
      from: (table) => {
        const q = { _receipt: false };
        const self = {
          select: () => self,
          eq: (k, v) => { if (k === 'row_kind' && v === 'receipt') q._receipt = true; return self; },
          order: () => self,
          // receipts are read in pages (RC26)
          range: (a, b) => { state.pages = (state.pages || 0) + 1;
            return Promise.resolve({ data: q._receipt ? (state.receiptRows || []).slice(a, b + 1) : [], error: null }); },
          // the pending-statement check (RC25)
          limit: () => Promise.resolve(table === 'statement_files'
            ? (state.stmtError ? { data: null, error: { message: 'x' } } : { data: state.pendingStmts || [], error: null })
            : { data: [], error: null }),
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
      shipping_fee: null, paid: o.paid, paid_with_tail: o.tail || null,
      service_label: o.label || null, points_discount: o.points || null, tip: o.tip != null ? o.tip : null },
    amount: o.paid, direction: 'debit', time_precision: o.precision || undefined,
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
  t('the poorer twin is NOT deleted on sight (RC28): it waits behind the winner', st.retired.indexOf('rShip') === -1, st.retired);
  t('...and is handed to the row so the import retires both together', JSON.stringify(q1._rcptCopyIds) === '["rShip"]', q1._rcptCopyIds);

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

  /* ── spec §21 (2026-10-01): statement rows, the clock, order-level detail ── */
  console.log('\n-- a STATEMENT row is a join target (RC20) --');
  // The REAL shaper builds the row: a hand-built row in the email shape is
  // exactly what hid this bug.
  const win77 = {};
  new Function('window', 'CSV_MCC_CONCEPT', 'L', '_esc', '_escAttr', '_rpc', 'localStorage', 'sessionStorage', 'document', 'crypto',
    fs.readFileSync(path.join(__dirname, '../src/js-data/77-statement-capture.js'), 'utf8'))(
    win77, {}, (vi) => vi, (s) => s, (s) => s, async () => null,
    { getItem() { return null; }, setItem() {}, removeItem() {} }, { setItem() {} }, {}, require('crypto').webcrypto);
  const srow = (id, amt, time) => win77.fhStmtAsStaged(id, { sid: 'S1', provider: 'MoMo', accountKind: 'ewallet', tail: '1217',
    date: '2026-10-01', time: time || '', sec: '00', amt: -amt, memo: 'GRAB', counterparty: 'GRAB' });

  st = freshState();
  rrow(st, 'g1', { provider: 'Grab', paid: 11000, at: '2026-09-30T17:00:00+00:00', precision: 'day', label: 'Car 6 chỗ ngồi', points: 32000 });
  env = makeEnv(st);
  let s1 = srow('s1', 11000, '12:23'), s2 = srow('s2', 40000, '13:34');
  await env.fhReceiptJoinQueue([s1, s2]);
  t('a row the real statement shaper built takes its receipt', !!s1._rcpt && !s2._rcpt, [!!s1._rcpt, !!s2._rcpt]);
  t('the order-level description names the service', s1._rcptDesc === 'Grab · Car 6 chỗ ngồi', s1._rcptDesc);
  t('label and points ride the blob', s1._rcpt.service_label === 'Car 6 chỗ ngồi' && s1._rcpt.points_discount === 32000, s1._rcpt);
  t('the shaper mirrors the cash fields inside, like an opened email row',
    s1.raw_extracted.amount === 11000 && s1.raw_extracted.currency === 'VND', s1.raw_extracted.amount);

  console.log('\n-- the clock breaks a tie, and only a tie (RC23) --');
  st = freshState();
  rrow(st, 'g1', { provider: 'Grab', paid: 40000, at: '2026-10-01T12:24:00+07:00', precision: 'minute' });
  rrow(st, 'g2', { provider: 'Grab', paid: 40000, at: '2026-10-01T18:02:00+07:00', precision: 'minute' });
  env = makeEnv(st);
  s1 = srow('s1', 40000, '12:23'); s2 = srow('s2', 40000, '18:01');
  await env.fhReceiptJoinQueue([s1, s2]);
  t('two rides at one fare: each receipt takes the row within 30 minutes',
    s1._rcptRowId === 'g1' && s2._rcptRowId === 'g2', [s1._rcptRowId, s2._rcptRowId]);

  st = freshState();
  rrow(st, 'g1', { provider: 'Grab', paid: 40000, at: '2026-10-01T12:24:00+07:00', precision: 'minute' });
  env = makeEnv(st);
  s1 = srow('s1', 40000, '12:23'); s2 = srow('s2', 40000, '12:40');
  await env.fhReceiptJoinQueue([s1, s2]);
  t('two rows inside the window, one a minute away and one sixteen: the minute decides (RC29)', s1._rcptRowId === 'g1' && !s2._rcpt, [s1._rcptRowId, !!s2._rcpt]);

  st = freshState();
  rrow(st, 'g1', { provider: 'Grab', paid: 40000, at: '2026-10-01T12:24:00+07:00', precision: 'minute' });
  env = makeEnv(st);
  s1 = srow('s1', 40000, '12:23'); s2 = srow('s2', 40000, '12:26');
  await env.fhReceiptJoinQueue([s1, s2]);
  t('two rows one and two minutes away: no clear winner, attach nothing', !s1._rcpt && !s2._rcpt);

  st = freshState();
  rrow(st, 'g1', { provider: 'Grab', paid: 40000, at: '2026-09-30T17:00:00+00:00', precision: 'day' });
  env = makeEnv(st);
  s1 = srow('s1', 40000, '12:23'); s2 = srow('s2', 40000, '18:01');
  await env.fhReceiptJoinQueue([s1, s2]);
  t('a day-only receipt has no clock to break the tie with', !s1._rcpt && !s2._rcpt);

  st = freshState();
  rrow(st, 'g1', { provider: 'Grab', paid: 40000, at: '2026-10-01T12:24:00+07:00', precision: 'minute' });
  env = makeEnv(st);
  s1 = srow('s1', 40000, '21:00');
  await env.fhReceiptJoinQueue([s1]);
  t('a clock never VETOES a lone candidate', !!s1._rcpt);

  st = freshState();
  rrow(st, 'g1', { provider: 'Grab', paid: 40000, at: '2026-10-01T12:24:00+07:00', precision: 'minute' });
  env = makeEnv(st);
  s1 = srow('s1', 40000, '');
  let s2b = srow('s2', 40000, '');
  await env.fhReceiptJoinQueue([s1, s2b]);
  t('day-only statement rows take no part in the tie-break', !s1._rcpt && !s2b._rcpt);

  console.log('\n-- ledger: a matching minute waives the young wait --');
  const nowVN = new Date(Date.now() + 7 * 3600e3).toISOString();          // VN wall clock
  const atNow = nowVN.slice(0, 16) + ':00+07:00';
  st = freshState();
  rrow(st, 'g1', { provider: 'Grab', paid: 40000, at: atNow, precision: 'minute' });   // created NOW
  st.slice = [{ id: 'p1', kind: 'expense', link: null, amt: 40, date: nowVN.slice(0, 10), time: nowVN.slice(11, 16) }];
  env = makeEnv(st);
  await env.fhReceiptJoinQueue([]);
  t('young receipt + ledger row at the same minute: attached at once', st.attached.length === 1 && st.attached[0].id === 'p1', st.attached);

  st = freshState();
  rrow(st, 'g1', { provider: 'Grab', paid: 40000, at: atNow, precision: 'minute' });
  st.slice = [{ id: 'p1', kind: 'expense', link: null, amt: 40, date: nowVN.slice(0, 10), time: '' }];
  env = makeEnv(st);
  await env.fhReceiptJoinQueue([]);
  t('young receipt + ledger row with NO clock: still waits', st.attached.length === 0, st.attached);

  console.log('\n-- a first connect keeps its receipts (RC25, RC26) --');
  const days = (n) => new Date(Date.now() - n * 864e5).toISOString();
  st = freshState();
  rrow(st, 'r1', { paid: 999999, created: days(20), at: days(40) });
  st.pendingStmts = [{ received_at: days(30) }];            // an unopened statement sent AFTER the purchase
  env = makeEnv(st);
  await env.fhReceiptJoinQueue([]);
  t('past grace, but an unopened statement could cover it: kept', st.retired.length === 0, st.retired);

  st = freshState();
  rrow(st, 'r1', { paid: 999999, created: days(20), at: days(20) });
  st.pendingStmts = [{ received_at: days(30) }];            // sent BEFORE the purchase: it cannot contain it
  env = makeEnv(st);
  await env.fhReceiptJoinQueue([]);
  t('a statement older than the purchase holds nothing: retired', st.retired.indexOf('r1') >= 0, st.retired);

  st = freshState();
  rrow(st, 'r1', { paid: 999999, created: days(20), at: days(40) });
  st.stmtError = true;
  env = makeEnv(st);
  await env.fhReceiptJoinQueue([]);
  t('the check could not be answered: nothing retires', st.retired.length === 0, st.retired);

  st = freshState();
  for (let i = 0; i < 450; i++) rrow(st, 'b' + i, { paid: 1000 + i, order: 'O' + i });
  env = makeEnv(st);
  const deep = qrow('qd', 1000 + 449);                      // only the 450th receipt matches it
  await env.fhReceiptJoinQueue([deep]);
  t('the join reads past the first 200 receipts', deep._rcptRowId === 'b449' && st.pages === 3, [deep._rcptRowId, st.pages]);

  /* ═══ 2026-10-09: a morning of Grab rides (spec §22) ═══════════════════════
     The real shape, from the MoMo statement and the four mails: three 43.000
     charges (09:18, 09:32, 11:11), an 11.000 refund at 09:18, a 20.000 tip at
     09:53 and a 47.000 ride at 12:32; receipts for 32.000 (09:18), 43.000
     (09:32), a 20.000 tip under the 09:32 ride's Booking ID, 43.000 (11:11)
     and 47.000 (12:32). Statement rows are built by the real shaper. */
  console.log('\n-- 2026-10-09: the Grab morning (RC27–RC31) --');
  const day = (id, signed, hhmm, sec, memo) => win77.fhStmtAsStaged(id, { sid: 'S9', provider: 'MoMo', accountKind: 'ewallet', tail: '1217',
    date: '2026-10-09', time: hhmm, sec: sec || '00', amt: signed, memo: memo || 'GRAB', counterparty: memo ? '' : 'GRAB' });
  const grabDay = () => {
    const stg = freshState();
    const g = (id, paid, at, order, extra) => rrow(stg, id, Object.assign({ provider: 'Grab', paid, at: '2026-10-09T' + at + '+07:00', precision: 'minute', order, label: 'Car 6 chỗ ngồi' }, extra || {}));
    g('rc0918', 32000, '09:18:00', 'A-9UCONULGWTN3AV', { label: 'Car' });
    g('rc0932', 43000, '09:32:00', 'A-9UCQUQDWX3LTAV');
    g('rcTip', 20000, '09:53:00', 'A-9UCQUQDWX3LTAV', { tip: 20000 });
    g('rc1111', 43000, '11:11:00', 'A-9UD4DB4WW94MAV');
    g('rc1232', 47000, '12:32:00', 'A-9UD9XXXXXXXXXXX');
    const rows = { a: day('a0918', -43000, '09:18', '05'), ref: day('ref0918', 11000, '09:18', '40', 'Hoàn tiền giao dịch từ Đối tác MoMo'),
      b: day('b0932', -43000, '09:32', '30'), tip: day('t0953', -20000, '09:53', '40'), c: day('c1111', -43000, '11:11', '10'), d: day('d1232', -47000, '12:32', '10') };
    return { stg, rows, list: [rows.a, rows.ref, rows.b, rows.tip, rows.c, rows.d] };
  };
  let G = grabDay(); env = makeEnv(G.stg);
  await env.fhReceiptJoinQueue(G.list);
  t('RC27: the tip and its ride share a Booking ID and are NOT copies: nothing is retired', G.stg.retired.length === 0, G.stg.retired);
  t('RC27: the tip takes the 20.000 row and is named a tip', G.rows.tip._rcptRowId === 'rcTip' && G.rows.tip._rcptDesc === 'Grab · Tip tài xế', [G.rows.tip._rcptRowId, G.rows.tip._rcptDesc]);
  t('RC29: the 09:32 ride takes the 09:32 row, though the 09:18 row is fourteen minutes away', G.rows.b._rcptRowId === 'rc0932' && G.rows.b._rcptHow === 'clock', [G.rows.b._rcptRowId, G.rows.b._rcptHow]);
  t('RC29: the 11:11 ride takes the 11:11 row', G.rows.c._rcptRowId === 'rc1111');
  t('a lone amount still joins on amount alone', G.rows.d._rcptRowId === 'rc1232' && G.rows.d._rcptHow === 'amount');
  t('RC30: the 43.000 charge with an 11.000 refund takes the 32.000 receipt', G.rows.a._rcptRowId === 'rc0918' && G.rows.a._rcptHow === 'net', [G.rows.a._rcptRowId, G.rows.a._rcptHow]);
  t('RC30: the row says what was charged and what came back, and so does the blob', G.rows.a._rcptAdj && G.rows.a._rcptAdj.charged === 43000 && G.rows.a._rcptAdj.refunded === 11000 && G.rows.a._rcptAdj.refundRowId === 'ref0918'
    && G.rows.a._rcpt.adjusted.charged === 43000 && G.rows.a._rcpt.adjusted.refunded === 11000, G.rows.a._rcptAdj);
  t('RC30: the refund row knows which charge it belongs to', G.rows.ref._adjOf === 'a0918' && !G.rows.ref._rcpt);
  t('every receipt found its row, one each', new Set(G.list.map((q) => q._rcptRowId).filter(Boolean)).size === 5);

  G = grabDay(); env = makeEnv(G.stg);
  G.stg.receiptRows = G.stg.receiptRows.filter((r) => r.id !== 'rcTip');
  G.stg.receiptRows.push({ id: 'rc0932b', created_at: new Date().toISOString(), occurred_at: '2026-10-09T09:33:00+07:00', source_provider: 'Grab' });
  G.stg.opened.rc0932b = JSON.parse(JSON.stringify(G.stg.opened.rc0932)); G.stg.opened.rc0932b.id = 'rc0932b';
  await env.fhReceiptJoinQueue(G.list);
  t('a true copy (same Booking ID, same total) still stands behind one winner', G.rows.b._rcptRowId === 'rc0932' && JSON.stringify(G.rows.b._rcptCopyIds) === '["rc0932b"]' && G.stg.retired.length === 0, [G.rows.b._rcptRowId, G.rows.b._rcptCopyIds, G.stg.retired]);

  console.log('\n-- RC30: the net rule refuses what it cannot prove --');
  G = grabDay(); env = makeEnv(G.stg);
  let other = day('x0916', -43000, '09:16', '00');                   // a second 43.000 charge two minutes earlier, never matched by a 43.000 receipt
  G.stg.receiptRows = G.stg.receiptRows.filter((r) => r.id === 'rc0918');
  await env.fhReceiptJoinQueue([G.rows.a, other, G.rows.ref]);
  t('two charges could be the adjusted one: attach nothing', !G.rows.a._rcpt && !other._rcpt && !G.rows.ref._adjOf);
  G = grabDay(); env = makeEnv(G.stg);
  G.stg.receiptRows = G.stg.receiptRows.filter((r) => r.id === 'rc0918');
  let vcb = win77.fhStmtAsStaged('v1', { sid: 'S8', provider: 'Vietcombank', accountKind: 'bank', tail: '2279', date: '2026-10-09', time: '09:18', sec: '30', amt: 11000, memo: 'hoan tien' });
  await env.fhReceiptJoinQueue([G.rows.a, vcb]);
  t('a refund into ANOTHER account proves nothing', !G.rows.a._rcpt);
  G = grabDay(); env = makeEnv(G.stg);
  G.stg.receiptRows = G.stg.receiptRows.filter((r) => r.id === 'rc0918');
  let lateRef = day('ref1130', 11000, '11:30', '00', 'Hoàn tiền');
  await env.fhReceiptJoinQueue([G.rows.a, lateRef]);
  t('a refund two hours after the receipt was sent proves nothing', !G.rows.a._rcpt);
  G = grabDay(); env = makeEnv(G.stg);
  let hold = day('h0850', -43000, '08:50', '00');                   // the hold placed at booking, the refund at trip end
  G.stg.receiptRows = G.stg.receiptRows.filter((r) => r.id === 'rc0918');
  await env.fhReceiptJoinQueue([hold, G.rows.ref]);
  t('a hold placed half an hour before its refund is still the charge', hold._rcptRowId === 'rc0918' && hold._rcptHow === 'net');

  console.log('\n-- RC31: what the person settles --');
  G = grabDay(); env = makeEnv(G.stg);
  G.stg.receiptRows = G.stg.receiptRows.filter((r) => r.id === 'rc0918');
  await env.fhReceiptJoinQueue([G.rows.a]);                          // no refund row on screen: the rules cannot prove it
  t('the rules attach nothing without the refund row', !G.rows.a._rcpt);
  let off = env.fhReceiptOffers('a0918');
  t('...but the 32.000 Grab receipt is OFFERED on the GRAB row (smaller total, provider named)', off.length === 1 && off[0].id === 'rc0918' && off[0].exact === false && off[0].paid === 32000, off);
  t('a pick attaches it and records the difference', env.fhReceiptAttach('a0918', 'rc0918') === true && G.rows.a._rcptHow === 'pick' && G.rows.a._rcptAdj.refunded === 11000);
  t('...and the offer is gone once attached', env.fhReceiptOffers('a0918').length === 0);
  t('a detach takes it off and it is offered again, marked as declined', env.fhReceiptDetach('a0918') === true && !G.rows.a._rcpt && env.fhReceiptOffers('a0918')[0].said === true);
  t('nothing was retired or written by a pick or a detach', G.stg.retired.length === 0 && G.stg.attached.length === 0);

  G = grabDay(); env = makeEnv(G.stg);
  await env.fhReceiptJoinQueue(G.list);
  env.fhReceiptDetach('b0932');                                       // "the 09:32 receipt is not this row's"
  t('"not this one" is respected: the rules do not put it back', G.rows.b._rcptRowId !== 'rc0932');
  t('...and rows the block does not touch keep what they had', G.rows.c._rcptRowId === 'rc1111' && G.rows.tip._rcptRowId === 'rcTip' && G.rows.d._rcptRowId === 'rc1232');
  t('...and no receipt sits on two rows', (() => { const ids = G.list.map((q) => q._rcptRowId).filter(Boolean); return new Set(ids).size === ids.length; })());
  await env.fhReceiptJoinQueue(G.list.map((q) => { const c = Object.assign({}, q); delete c._rcpt; delete c._rcptRowId; return c; }));
  t('the block outlives a reopened queue', true === !env.fhReceiptOffers('b0932').some((o) => o.id === 'rc0932' && !o.said));
  let offUnnamed = (() => { const q = qrow('plain', 43000, '2026-10-09T02:20:00+00:00'); return q; })();
  G = grabDay(); env = makeEnv(G.stg);
  G.stg.receiptRows = G.stg.receiptRows.filter((r) => r.id === 'rc0918');
  await env.fhReceiptJoinQueue([offUnnamed]);
  t('a smaller receipt is never offered to a row that does not name its provider', env.fhReceiptOffers('plain').length === 0);

  console.log('\n-- RC31: a ledger row attaches a waiting receipt by hand --');
  G = grabDay(); env = makeEnv(G.stg);
  G.stg.receiptRows = G.stg.receiptRows.filter((r) => r.id === 'rc0918' || r.id === 'rc1111');
  let lrow = { id: 'L1', date: '2026-10-09', time: '09:18', amt: 43, note: 'GRAB', who: 'GRAB', node: null };
  let lo = await env.fhReceiptOffersLedger(lrow);
  t('offers: the exact 43.000 first, then the smaller Grab one', lo.length === 2 && lo[0].id === 'rc1111' && lo[1].id === 'rc0918', lo.map((o) => o.id));
  t('attaching writes the blob with the difference and retires the receipt', (await env.fhReceiptAttachLedger(lrow, lo[1])) === true
    && G.stg.attached[0].id === 'L1' && G.stg.attached[0].rc.adjusted.refunded === 11000 && G.stg.retired.indexOf('rc0918') >= 0, [G.stg.attached, G.stg.retired]);

  console.log('\n-- RC29 on the ledger: the minute, with a margin --');
  st = freshState();
  rrow(st, 'g1', { provider: 'Grab', paid: 43000, at: '2026-10-09T09:32:00+07:00', precision: 'minute', created: new Date().toISOString() });
  st.slice = [{ id: 'L1', kind: 'expense', amt: 43, date: '2026-10-09', time: '09:18' }, { id: 'L2', kind: 'expense', amt: 43, date: '2026-10-09', time: '09:32' }];
  env = makeEnv(st);
  await env.fhReceiptJoinQueue([]);
  t('two booked rows fourteen minutes apart: the receipt takes the one in its minute', st.attached.length === 1 && st.attached[0].id === 'L2', st.attached.map((a) => a.id));
  st = freshState();
  rrow(st, 'g1', { provider: 'Grab', paid: 43000, at: '2026-10-09T09:32:00+07:00', precision: 'minute' });
  st.slice = [{ id: 'L1', kind: 'expense', amt: 43, date: '2026-10-09', time: '09:30' }, { id: 'L2', kind: 'expense', amt: 43, date: '2026-10-09', time: '09:33' }];
  env = makeEnv(st);
  await env.fhReceiptJoinQueue([]);
  t('two booked rows a minute and two away: nothing', st.attached.length === 0);

  console.log('\n-- wiring: the import, the card, the detail screen (RC28, RC30, RC31) --');
  {
    const rd = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
    const S72 = rd('src/js-data/72-txn-review.js'), S56 = rd('src/js-ui/56-csv-import-ui.js'), S61 = rd('src/js-ui/61-expense-detail.js'), S19 = rd('src/js-data/19-personal.js');
    t('RC28: the import retires a receipt\'s copies together with it', /pr\._rcptRowId && pr\._rcptCopyIds\) \|\| \[\]\)\.forEach\(function \(cid\) \{ if \(ids\.indexOf\(cid\) === -1\) ids\.push\(cid\); \}\)/.test(S72));
    t('the bank\'s own words are kept beside the receipt\'s', /r\._descBank = description; description = r\._rcptDesc; r\._descRc = description;/.test(S72) && /window\.fhRcDescApplies = function/.test(S72));
    t('RC31: the card offers a pick only when a receipt is waiting', /if\(_rcOffers\.length\) rows \+= row\('rcpt'/.test(S56) && /if\(f==='rcpt'\)\{ csvRcAttach\(v\); return; \}/.test(S56));
    t('RC31: a declined receipt is not mentioned again on the closed card', /fhReceiptOffers\(_rjRow\.id\)\.filter\(function\(o\)\{ return !o\.said; \}\)/.test(S56));
    t('RC31: taking a receipt off gives the card its bank words back, never a typed note', /if\(c\.description === row\._descRc\) c\.description = row\._descBank \|\| '';/.test(S56));
    t('RC30: the closed card and the open card both say charged, refunded, paid', /Thực trả '\+csvFmt\(_rj\.paid\)\+', đã hoàn '/.test(S56) && /Đã trừ '\+csvFmt\(_rj2\.adjusted\.charged\)\+', hoàn '/.test(S56));
    t('RC30: the refund card names its charge', /_rjRow\._adjOf && _rjRow\._adjInfo/.test(S56));
    t('RC31: the detail screen attaches a waiting receipt and takes one off in two taps', /_pexdOfferLoad\(t\)/.test(S61) && /fhReceiptAttachLedger\(o\.t, o\.list\[i\]\)/.test(S61) && /if\(!_pexdRcOffArmed\)\{/.test(S61) && /fhPersonalClearReceipt\(id\)/.test(S61));
    t('RC31: taking a receipt off a ledger row touches one column of a private row', /update\(\{ receipt_enc: null \}\)\s*\.eq\('id', id\)\.eq\('owner_user_id', P\.uid\)\.is\('link_id', null\)/.test(S19));
  }

  if (failed) { console.log('\n' + failed + ' FAILED'); process.exit(1); }
  console.log('\nall passed');
})().catch((e) => { console.error(e); process.exit(1); });
