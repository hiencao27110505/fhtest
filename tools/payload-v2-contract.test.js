#!/usr/bin/env node
/* The device reads BOTH payload versions, and its copy of the contract is pinned.
 * `node tools/payload-v2-contract.test.js`            run
 * `node tools/payload-v2-contract.test.js --update`   re-snapshot the v1 candidates
 *
 * The reading contract lives once, in supabase/functions/_shared/mailbox/contract.mjs.
 * The device is a single-file PWA and cannot import it, so it carries a small
 * mirror (FH_SIGNALS / FH_NOTICE_SIGNALS in 57-csv-import-review.js). A mirror
 * that drifts is a silent bug: a signal the server starts sending would be read
 * as "no signal" and the row would quietly fall back to guessing. So:
 *
 *   1. the mirror is compared with contract.mjs, key for key;
 *   2. every RAW_FIELDS key is carried by the opener (fhReadStagedRow) from a
 *      synthetic v2 payload, in BOTH sealed shapes, to the place the candidate
 *      reads it from. The file's idiom for that is the side channel
 *      fhStagedRawX(c.rowIndex), not a copy on the candidate: the five synthetic
 *      CSV columns are a contract of their own (see fhStagedAsCsvSource);
 *   3. a v1 payload (no `v`) builds candidates IDENTICAL to the ones it built
 *      the day before v2 existed. The snapshot in tools/fixtures/ was taken from
 *      the untouched source. Only re-snapshot for a deliberate v1 change, and
 *      say why in the commit.
 *
 * Real functions over the real tree. Synthetic values only.
 */
'use strict';
process.env.TZ = 'Asia/Ho_Chi_Minh';   // candidate dates are local; pin the zone so the snapshot is portable
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { pathToFileURL } = require('url');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const SNAP = path.join(__dirname, 'fixtures', 'payload-v1-candidates.json');
const UPDATE = process.argv.includes('--update');

let failed = 0;
function ok(cond, what, detail) {
  console.log((cond ? '  ok   ' : '  FAIL ') + what + (!cond && detail !== undefined ? '  -> ' + JSON.stringify(detail) : ''));
  if (!cond) failed++;
}
function grab(src, header) {
  const at = src.indexOf(header);
  if (at < 0) throw new Error('not found in source: ' + header);
  let i = src.indexOf('{', at), depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (!depth) break; }
  }
  return src.slice(at, i + 1);
}

const SRC72 = read('src/js-data/72-txn-review.js');
const SRC50 = read('src/js-ui/50-sheets-expense-capture.js');
const SRC45 = read('src/js-data/45-csv-import.js');

/* The review engine, booted the way the app boots it, minus the DOM. */
function device(accounts) {
  const ctx = {
    console, L: (vi) => vi, LANG: 'vi', CUR: 'VND', csvStagedMode: true, txns: [],
    catOrder: ['Ăn uống', 'Khác'], catStyle: { 'Ăn uống': ['🍜'], 'Khác': ['🗂️'] }, CAT_FALLBACK: 'Khác',
    isVi: () => true, catValid: (c) => c === 'Ăn uống' || c === 'Khác',
    localStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
  };
  ctx.window = ctx;
  ctx.fhPersonalData = () => ({ state: 'ready', key: 'k', accounts: accounts || [], txns: [], debts: [] });
  vm.createContext(ctx);
  vm.runInContext(read('src/js-ui/11-taxonomy.js'), ctx);
  vm.runInContext(read('src/js-ui/13-partition.js'), ctx);
  vm.runInContext([
    'function deburr(', 'var KW_SHARED=', 'var KW_VI=', 'var KW_EN=', 'var CONCEPT_MATCH=',
    'function _scanConcepts(', 'function conceptFromNote(', 'function familyCatForConcept(', 'function guessCat(',
  ].map((h) => grab(SRC50, h) + (h.startsWith('var') ? ';' : '')).join('\n') + '\n' + SRC50.match(/var CONCEPT_ORDER=\[[^\]]*\];/)[0], ctx);
  vm.runInContext(SRC45.slice(0, SRC45.indexOf('function classifyDate')) + grab(SRC45, 'function classifyDate(') + '\n' + grab(SRC45, 'function classifyAmount('), ctx);
  vm.runInContext(read('src/js-ui/57-csv-import-review.js'), ctx);
  vm.runInContext(read('src/js-ui/58-dedup-engine.js'), ctx);
  // _BANK_GENERIC_MEMOS .. fhResolveRepaidCard: the staged-row accessors the builder asks.
  ctx.DB = { fid: 'fam-1' };
  ctx.fhStagingPrivKey = async () => 'priv';
  ctx.fhStagingOpenRow = () => ctx.__payload;
  vm.runInContext(grab(SRC72, 'async function fhReadStagedRow('), ctx);
  vm.runInContext(SRC72.slice(SRC72.indexOf('var _BANK_GENERIC_MEMOS'), SRC72.indexOf('window.fhStagedCardPayments = async function')), ctx);
  return ctx;
}
function candidates(ctx, rows) {
  ctx._fhStagedRows = rows;
  const s = vm.runInContext('fhStagedAsCsvSource(_fhStagedRows)', ctx);
  ctx.__p = s.parsed; ctx.__r = s.result;
  return vm.runInContext('buildCsvCandidates(__p, __r)', ctx);
}

/* ── the fixed v1 rows ──────────────────────────────────────────────────────
   One per branch the builder takes today: a merchant purchase with the
   pipeline's hint and node, money in with payroll wording, the memo-less card
   repayment confirmation, a self-transfer by memo, a bank-converted foreign
   purchase, a refund into a credit card, a person-to-person debit. */
const OWNED = [
  { id: 'acc-dep', kind: 'deposit', tail: '0001', provider: 'testbank' },
  { id: 'acc-card', kind: 'credit_card', tail: '4444', provider: 'testbank' },
];
/* A staged row the way the app gets one: a sealed payload, opened by the REAL
   opener. `detail` is what the reader extracted; direct read nests it under
   raw_extracted (stage.mjs), forwarding spreads it flat, and the opener makes
   the two identical. */
const payloadOf = (top, detail, flat) => flat
  ? Object.assign({}, top, detail)
  : Object.assign({}, top, { raw_extracted: detail });
async function openRow(ctx, id, payload, clear) {
  ctx.__payload = payload;
  ctx.__sealed = Object.assign({ id: id, sealed: 'x', eph_pub: 'x', nonce: 'x', member_id: 'm1', staging_scope: 'family',
    occurred_at: '2026-08-20T04:11:09+00:00', source_provider: 'TESTBANK', duplicate_of_id: null, resolved_before: false }, clear || {});
  return vm.runInContext('fhReadStagedRow(__sealed)', ctx);
}
const v1 = (id, top, detail, clear) => ({ id: id, clear: clear,
  payload: payloadOf(Object.assign({ amount: 250000, currency: 'VND', direction: 'debit', counterparty: 'SYNTHETIC MART' }, top),
    Object.assign({ memo: null, memo_display: '', transaction_type: 'bank_txn', account_kind: 'deposit', account_masked: '0001' }, detail)) });
async function openAll(ctx, specs) {
  const out = [];
  for (const s of specs) out.push(await openRow(ctx, s.id, s.payload, s.clear));
  return out;
}
const V1_ROWS = [
  v1('p1', {}, { category_hint: 'Groceries', node: 'fresh', _transport: 'oauth_direct' }),
  v1('p2', { direction: 'credit', counterparty: 'CONG TY SYNTHETIC', amount: 15000000 },
    { memo: 'THANH TOAN LUONG THANG 8', memo_display: 'THANH TOAN LUONG THANG 8', balance: 20000000, flow: 'income' }),
  v1('p3', { counterparty: '', amount: 3000000 },
    { account_kind: 'credit_card', card_masked: '**** 4444', flow: 'transfer', reference_number: 'FT26232000002' }),
  v1('p4', { counterparty: 'NGUYEN VAN TEST', amount: 5000000 },
    { memo: 'NGUYEN VAN TEST chuyen tien den NGUYEN VAN TEST - 1000000001', memo_display: 'NGUYEN VAN TEST chuyen tien den NGUYEN VAN TEST - 1000000001', reader_type: 'p2p_transfer' }),
  v1('p5', { counterparty: 'SYNTHETIC.COM/BILL', amount: 2900000 },
    { account_kind: 'credit_card', account_masked: '4444', fx_amount: 111, fx_currency: 'USD' }),
  v1('p6', { direction: 'credit', counterparty: 'SYNTHETIC MART', amount: 120000 },
    { account_kind: 'credit_card', account_masked: '4444', memo: 'HOAN TIEN GD', memo_display: 'HOAN TIEN GD' },
    { occurred_at: '2026-08-21T00:00:00+00:00' }),
  v1('p7', { counterparty: 'LE VAN TEST - 0900000000', amount: 400000 }, { reader_type: 'p2p_transfer' }),
];
/* JSON is the comparison: a key that is undefined is a key that is not there,
   which is how the on-device draft and every reader of a candidate see it. */
const freeze = (cs) => JSON.parse(JSON.stringify(cs, (k, v) => (v instanceof Date ? 'Date:' + v.getTime() : v)));

(async () => {
  const contract = await import(pathToFileURL(path.join(ROOT, 'supabase/functions/_shared/mailbox/contract.mjs')).href);

  console.log('v1 rows build exactly what they built before v2 existed');
  {
    const ctx1 = device(OWNED);
    const got = freeze(candidates(ctx1, await openAll(ctx1, V1_ROWS)));
    if (UPDATE) {
      fs.mkdirSync(path.dirname(SNAP), { recursive: true });
      fs.writeFileSync(SNAP, JSON.stringify(got, null, 1) + '\n');
      console.log('  snapshot written: ' + path.relative(ROOT, SNAP));
    }
    const want = JSON.parse(fs.readFileSync(SNAP, 'utf8'));
    ok(got.length === want.length, 'same number of candidates', [got.length, want.length]);
    want.forEach((w, i) => {
      const g = got[i] || {};
      const keys = Array.from(new Set(Object.keys(w).concat(Object.keys(g))));
      const diff = keys.filter((k) => JSON.stringify(w[k]) !== JSON.stringify(g[k]));
      ok(!diff.length, 'row ' + w.raw[1].slice(0, 28).padEnd(28) + ' identical', diff.map((k) => [k, w[k], g[k]]));
    });
  }

  console.log('\nthe device\'s signal mirror is the contract\'s signal list');
  {
    const ctx = device(OWNED);
    const mirror = vm.runInContext('FH_SIGNALS', ctx), notices = vm.runInContext('FH_NOTICE_SIGNALS', ctx);
    const want = Object.keys(contract.SIGNALS).sort(), got = Object.keys(mirror).sort();
    ok(JSON.stringify(want) === JSON.stringify(got), 'same signals, no more, no fewer',
      { missing: want.filter((k) => got.indexOf(k) < 0), extra: got.filter((k) => want.indexOf(k) < 0) });
    want.forEach((k) => {
      const c = contract.SIGNALS[k], m = mirror[k] || {};
      ok(m.proposes === c.proposes && (m.node || null) === (c.node || null), k.padEnd(18) + ' proposes ' + String(c.proposes).padEnd(8) + ' node ' + (c.node || '-'),
        { contract: [c.proposes, c.node || null], device: [m.proposes, m.node || null] });
    });
    ok(JSON.stringify(notices.slice().sort()) === JSON.stringify(contract.NOTICE_SIGNALS.slice().sort()), 'same notice signals', notices);
    const kinds = ['expense', 'income', 'xfer', 'cardpay', 'invest', 'loan', 'repay'];
    const nodeKind = vm.runInContext('FH_KIND_NODEKIND', ctx);
    ok(want.every((k) => contract.SIGNALS[k].proposes === null || kinds.indexOf(contract.SIGNALS[k].proposes) >= 0),
      'every proposed kind is one the Kind control knows');
    ok(kinds.every((k) => !!nodeKind[k]), 'and each of those kinds files under a taxonomy kind', nodeKind);
    ok(want.every((k) => !mirror[k].node || vm.runInContext('FH_TAX.kindOf(' + JSON.stringify(mirror[k].node) + ')', ctx) === nodeKind[mirror[k].proposes]),
      'a signal\'s node belongs to the kind the signal proposes');
    ok(contract.PAYLOAD_V === 2, 'this test was written against payload v2; a bump means re-reading the device', contract.PAYLOAD_V);
  }

  console.log('\nevery contract key survives the opener, in both sealed shapes');
  {
    /* One synthetic value per declared type, so a key the opener dropped, renamed
       or coerced cannot hide behind a null. */
    const sample = (f) => f.key === 'v' ? 2
      : f.type === 'num' ? 1234.5
      : f.type === 'enum' ? f.values[0]
      : f.type === 'arr' ? ['x']
      : f.type === 'obj' ? (f.keys ? Object.fromEntries(f.keys.map((k, i) => [k, 'v' + i])) : { amount: 'printed', signal: 'template' })
      : 'synthetic ' + f.key;
    const detail = {};
    contract.RAW_FIELDS.forEach((f) => { detail[f.key] = sample(f); });
    ok(contract.RAW_FIELDS.every((f) => contract.fieldAccepts(f, detail[f.key])), 'the synthetic payload is one the contract itself accepts');
    const top = { amount: 250000, currency: 'VND', direction: 'debit', counterparty: 'SYNTHETIC MART' };
    for (const flat of [false, true]) {
      const ctx = device(OWNED);
      const row = await openRow(ctx, 'v2-' + flat, payloadOf(top, detail, flat));
      const lost = contract.RAW_KEYS.filter((k) => JSON.stringify((row.raw_extracted || {})[k]) !== JSON.stringify(detail[k]));
      ok(!row._unreadable && !lost.length, (flat ? 'flat (forwarding)' : 'nested (direct read)') + ': all ' + contract.RAW_KEYS.length + ' keys reach the opened row', lost);
      const c = candidates(ctx, [row])[0];
      ctx.__c = c;
      const seen = vm.runInContext('fhStagedRawX(__c.rowIndex)', ctx) || {};
      const lost2 = contract.RAW_KEYS.filter((k) => JSON.stringify(seen[k]) !== JSON.stringify(detail[k]));
      ok(!lost2.length, '...and the candidate reads every one of them (fhStagedRawX by rowIndex)', lost2);
      ok(c._v2 === true, '...and the candidate knows it is a v2 row', c._v2);
    }
    const ctx = device(OWNED);
    const old = candidates(ctx, await openAll(ctx, V1_ROWS.slice(0, 1)))[0];
    ok(old._v2 === undefined, 'a row with no `v` is v1', old._v2);
    const V2_ONLY = ['_v2', '_sigKind', '_sigTier', '_sigHold', '_srcAttn', '_fee', '_loan', '_repay', '_invest', '_scope', '_xferOtherId', '_investPosId', '_investQty', '_loanWho', '_loanDue', '_repayWho'];
    ok(V2_ONLY.every((k) => old[k] === undefined), 'and carries none of the v2 marks', V2_ONLY.filter((k) => old[k] !== undefined));
  }

  console.log(failed ? '\n' + failed + ' failed' : '\nall passed');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
