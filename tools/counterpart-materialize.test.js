#!/usr/bin/env node
/* The other side of an own-account transfer materializes at review open.
 * `node tools/counterpart-materialize.test.js`
 *
 * Seen on a real device (2026-09-22): a VIB "Chuyển tiền nhanh đến tài khoản
 * ngân hàng nội địa" mail to the person's own Vietcombank account. The card
 * read "Chuyển khoản nội bộ" and "Chuyển đến đâu" was empty, the picker
 * offering only "Tiền mặt" and "+ Tài khoản khác". The receiving account never
 * existed: the census (full-ledger T11) materializes only a row's OWN
 * instrument, and Vietcombank never emails money-in.
 *
 * Pinned here, over the real census (72-txn-review.js fhQueueAccountCensus),
 * the real precedence (57-csv-import-review.js fhKindFromSignal) and a fake
 * ensure() that keys on (provider, tail) exactly as 19-personal.js does:
 *
 *   1. a v2 own_transfer row with a printed signal, a counterparty bank and a
 *      tail ensures ONE deposit account, named the way every materialized
 *      account is ("Vietcombank ••2279"), never a card;
 *   2. any of the three facts missing, a heuristic signal, or wallet_move:
 *      nothing is created;
 *   3. the provider key folds "Vietcombank", "VCB" and the long official name
 *      onto one account, so a later own-instrument sighting merges;
 *   4. after the census, tier 2 pre-fills _xferOtherId with that account, so
 *      the card shows "Chuyển đến đâu: Vietcombank ••2279" with no tap;
 *   5. the transfer picker lists it beside the other deposits and wallets, and
 *      never the row's own instrument or a card.
 *
 * Synthetic names and numbers only.
 */
'use strict';
process.env.TZ = 'Asia/Ho_Chi_Minh';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

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
const SRC56 = read('src/js-ui/56-csv-import-ui.js');

/* The review engine, booted the way the app boots it, minus the DOM, plus a
   personal ledger whose ensure()/update() behave like 19-personal.js:
   identity is (provider lower-cased, tail); a hit returns the id untouched. */
function device(accounts) {
  const state = { accounts: (accounts || []).map((a) => Object.assign({}, a)), ensured: [], updated: [], seq: 0 };
  const ctx = {
    console, L: (vi) => vi, LANG: 'vi', CUR: 'VND', csvStagedMode: true, txns: [],
    catOrder: ['Ăn uống', 'Khác'], catStyle: { 'Ăn uống': ['🍜'], 'Khác': ['🗂️'] }, CAT_FALLBACK: 'Khác',
    FH_INCOME_CATS: ['Lương', 'Thưởng', 'Hoàn tiền', 'Khác'],
    isVi: () => true, catValid: (c) => c === 'Ăn uống' || c === 'Khác',
    localStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
  };
  ctx.window = ctx;
  ctx.__state = state;
  ctx.fhPersonalData = () => ({ state: 'ready', key: 'k', accounts: state.accounts, txns: [], debts: [] });
  ctx.fhPersonalDebts = () => ({ people: [] });
  ctx.fhPersonalAccountEnsure = async (info) => {
    state.ensured.push(Object.assign({}, info));
    if (!info || !info.kind) return null;
    const prov = (info.provider || '').toLowerCase() || null;
    const tail = (info.tail || '').replace(/\D/g, '').slice(-4) || null;
    const hit = state.accounts.find((a) => (a.provider || '') === (prov || '') && (a.tail || '') === (tail || ''));
    if (hit) return hit.id;
    const id = 'new-' + (++state.seq);
    state.accounts.push({ id, kind: info.kind, provider: prov, tail, name: info.name, humanVerified: false });
    return id;
  };
  ctx.fhPersonalAccountUpdate = async (id, fields) => {
    state.updated.push([id, Object.assign({}, fields)]);
    const a = state.accounts.find((x) => x.id === id);
    if (a && fields.kind) a.kind = fields.kind;
    return !!a;
  };
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
  vm.runInContext(grab(SRC56, 'function csvXferAccounts(c)'), ctx);
  // _BANK_GENERIC_MEMOS .. fhStagedCardPayments: fhStagedAcct, fhStagedCounterpartAcct, fhQueueAccountCensus.
  vm.runInContext(SRC72.slice(SRC72.indexOf('var _BANK_GENERIC_MEMOS'), SRC72.indexOf('window.fhStagedCardPayments = async function')), ctx);
  return ctx;
}
/* An OPENED staged row, as the review receives it. */
function staged(id, top, detail) {
  const t = Object.assign({ amount: 5000000, currency: 'VND', direction: 'debit', counterparty: '1000002279 - NGUYEN VAN TEST' }, top);
  const x = Object.assign({}, t, { v: 2, memo: null, memo_display: '', transaction_type: 'bank_txn', account_kind: null, account_masked: '…3444' }, detail);
  return { id, occurred_at: '2026-09-22T07:05:12+00:00', source_provider: 'VIB',
    amount: t.amount, currency: t.currency, direction: t.direction, counterparty: t.counterparty,
    duplicate_of_id: null, resolved_before: false, raw_extracted: x };
}
const PRINTED = { signal: 'printed', counterparty_bank: 'printed', counterparty_account_tail: 'printed', counterparty_kind: 'printed', account_masked: 'printed' };
/* The VIB own transfer, sealed the way pipeline/vib-own-transfer-reading.test.js proves it is. */
const VIB_XFER = (over) => staged('vib-xfer', {}, Object.assign({
  signal: 'own_transfer', counterparty_kind: 'self', flow: 'transfer', node: 'bankbank',
  counterparty_bank: 'Vietcombank', counterparty_account_tail: '…2279', src: PRINTED,
}, over || {}));

async function census(ctx, rows) {
  ctx._fhStagedRows = rows;
  ctx._fhQueueNewAccts = [];
  await vm.runInContext('fhQueueAccountCensus(_fhStagedRows)', ctx);
}
function build(ctx, rows) {
  ctx._fhStagedRows = rows;
  const s = vm.runInContext('fhStagedAsCsvSource(_fhStagedRows)', ctx);
  ctx.__p = s.parsed; ctx.__r = s.result;
  const cs = vm.runInContext('buildCsvCandidates(__p, __r)', ctx);
  ctx.__cs = cs;
  vm.runInContext('csvLendingPass(__cs)', ctx);
  return cs;
}
const deposits = (ctx) => ctx.__state.accounts.filter((a) => a.kind === 'deposit');

console.log('1. the counterpart of a printed own transfer materializes as ONE deposit');
{
  const ctx = device([{ id: 'vib-3444', kind: 'deposit', provider: 'vib', tail: '3444', name: 'VIB ••3444' }]);
  (async () => {
    await census(ctx, [VIB_XFER()]);
    const vcb = ctx.__state.accounts.filter((a) => a.provider === 'vietcombank');
    ok(vcb.length === 1 && vcb[0].kind === 'deposit' && vcb[0].tail === '2279', 'Vietcombank ••2279 exists once, as a deposit', ctx.__state.accounts);
    ok(vcb.length === 1 && vcb[0].name === 'Vietcombank ••2279', 'named the way every materialized account is named', vcb[0] && vcb[0].name);
    ok(ctx._fhQueueNewAccts.length === 1 && ctx._fhQueueNewAccts[0] === vcb[0].id, 'counted as an account this queue session made (the wizard treats it as touched)', ctx._fhQueueNewAccts);
    ok(!ctx.__state.accounts.some((a) => a.kind === 'credit_card'), 'never a card');

    await census(ctx, [VIB_XFER(), VIB_XFER()]);
    ok(ctx.__state.accounts.filter((a) => a.provider === 'vietcombank').length === 1, 'reopening the queue, or two transfers to the same account, creates nothing twice', ctx.__state.accounts.length);
    ok(ctx._fhQueueNewAccts.length === 0, '...and nothing is counted as new the second time', ctx._fhQueueNewAccts);

    console.log('2. any missing fact, a guessed signal, or a wallet move: nothing is created');
    for (const [what, over] of [
      ['no counterparty_bank', { counterparty_bank: null }],
      ['no counterparty_account_tail', { counterparty_account_tail: null }],
      ['a tail shorter than four digits', { counterparty_account_tail: '…79' }],
      ['a heuristic signal (the memo said "A chuyen tien den A", nobody printed it)', { counterparty_kind: 'person', src: Object.assign({}, PRINTED, { signal: 'heuristic', counterparty_kind: 'heuristic' }) }],
      ['a model signal', { src: Object.assign({}, PRINTED, { signal: 'model' }) }],
      ['no src map at all', { src: undefined }],
      ['a v1 row', { v: 1 }],
      ['wallet_move (the other side is a wallet, not a bank account)', { signal: 'wallet_move', counterparty_kind: 'wallet', node: 'wallet' }],
      ['a purchase that happens to print a bank and a tail', { signal: 'purchase', counterparty_kind: 'merchant', node: null }],
    ]) {
      const c2 = device([]);
      await census(c2, [VIB_XFER(over)]);
      ok(c2.__state.accounts.length === 0, what, c2.__state.accounts);
    }
    {
      const c2 = device([]);
      await census(c2, [VIB_XFER({ src: Object.assign({}, PRINTED, { signal: 'template' }) })]);
      ok(deposits(c2).length === 1, 'a template-grade signal (frozen in a verified format) is a fact too', c2.__state.accounts);
    }
    {
      const c2 = device([]);
      await census(c2, [VIB_XFER({ signal: null })]);
      ok(deposits(c2).length === 1, 'counterparty_kind self alone (printed) is enough: the two printed names matched', c2.__state.accounts);
    }
    {
      const c2 = device([]);
      await census(c2, [VIB_XFER({ direction: 'credit', counterparty: 'NGUYEN VAN TEST - 1000002279' })]);
      ok(deposits(c2).length === 1 && deposits(c2)[0].tail === '2279', 'money IN from an own account materializes the sending side the same way', c2.__state.accounts);
    }

    console.log('3. one provider key however the bank was spelled');
    ok(vm.runInContext('fhProviderName("Vietcombank")', ctx) === 'Vietcombank', 'Vietcombank');
    ok(vm.runInContext('fhProviderName("VCB")', ctx) === 'Vietcombank', 'VCB');
    ok(vm.runInContext('fhProviderName("Ngân hàng TMCP Ngoại thương")', ctx) === 'Vietcombank', 'Ngân hàng TMCP Ngoại thương');
    ok(vm.runInContext('fhProviderName("Ngân hàng TMCP Ngoại thương Việt Nam")', ctx) === 'Vietcombank', '...Việt Nam');
    ok(vm.runInContext('fhProviderName("NH TMCP Ngoai Thuong VN")', ctx) === 'Vietcombank', 'NH TMCP Ngoai Thuong VN');
    ok(vm.runInContext('fhProviderName("Ngân hàng TMCP Quân đội")', ctx) === 'MB Bank', 'Ngân hàng TMCP Quân đội -> MB Bank');
    ok(vm.runInContext('fhProviderName("Ngân hàng Quốc tế")', ctx) === 'VIB', 'Ngân hàng Quốc tế -> VIB');
    ok(vm.runInContext('fhProviderName("Ngân hàng TMCP Bản Việt")', ctx) === 'Ngân hàng TMCP Bản Việt', 'a bank not on the list passes through as printed, never folded into another');
    for (const spelled of ['VCB', 'Ngân hàng TMCP Ngoại thương Việt Nam']) {
      const c3 = device([{ id: 'vcb-2279', kind: 'deposit', provider: 'vietcombank', tail: '2279', name: 'Vietcombank ••2279' }]);
      await census(c3, [VIB_XFER({ counterparty_bank: spelled })]);
      ok(c3.__state.accounts.length === 1, '"' + spelled + '" in the mail lands on the existing Vietcombank ••2279 (no twin)', c3.__state.accounts);
    }
    {
      // The other order: the counterpart came first, then Vietcombank's own
      // money-in mail for the same account. Identity is (provider, tail).
      const c4 = device([]);
      await census(c4, [VIB_XFER()]);
      const rows = [Object.assign(staged('vcb-in', { direction: 'credit', counterparty: 'NGUYEN VAN TEST' },
        { signal: 'own_transfer', counterparty_kind: 'self', account_kind: 'deposit', account_masked: '…2279',
          counterparty_bank: 'VIB', counterparty_account_tail: '…3444', src: PRINTED }), { source_provider: 'Vietcombank' })];
      await census(c4, rows);
      ok(c4.__state.accounts.filter((a) => a.provider === 'vietcombank').length === 1, 'a later own-instrument sighting of the same account merges into the one the transfer made', c4.__state.accounts);
    }

    console.log('4. tier 2 then pre-fills "Chuyển đến đâu" with no tap');
    {
      const c5 = device([{ id: 'vib-3444', kind: 'deposit', provider: 'vib', tail: '3444', name: 'VIB ••3444' }]);
      const rows = [VIB_XFER()];
      await census(c5, rows);
      const vcbId = c5.__state.accounts.find((a) => a.provider === 'vietcombank').id;
      const c = build(c5, rows)[0];
      ok(c._xfer === true, 'the row is an internal transfer', c._xfer);
      ok(c._xferOtherId === vcbId, '_xferOtherId is the materialized Vietcombank ••2279', [c._xferOtherId, vcbId]);
      ok(c._sigTier === 2 && !c._srcAttn, 'tier 2, resting on printed facts: stays in the ready list', [c._sigTier, c._srcAttn]);

      console.log('5. the transfer picker offers it');
      c5.__c = c;
      const listed = vm.runInContext('csvXferAccounts(__c).map(function (a) { return a.id; })', c5);
      ok(listed.indexOf(vcbId) >= 0, 'the picker lists Vietcombank ••2279', listed);
      ok(listed.indexOf('vib-3444') < 0, '...and never the row\'s own instrument', listed);
      c5.__state.accounts.push({ id: 'card-x', kind: 'credit_card', provider: 'vib', tail: '4751', name: 'VIB ••4751' });
      ok(vm.runInContext('csvXferAccounts(__c).map(function (a) { return a.id; })', c5).indexOf('card-x') < 0, '...and never a card', listed);
    }
    {
      // Before the census, tier 2 has nothing to find: what the device showed.
      const c6 = device([{ id: 'vib-3444', kind: 'deposit', provider: 'vib', tail: '3444', name: 'VIB ••3444' }]);
      const c = build(c6, [VIB_XFER()])[0];
      ok(c._xfer === true && !c._xferOtherId, 'without the census the counterpart is empty (the bug as observed)', c._xferOtherId);
    }

    console.log(failed ? '\n' + failed + ' FAILED' : '\nall passed');
    process.exit(failed ? 1 : 0);
  })().catch((e) => { console.error(e); process.exit(1); });
}
