#!/usr/bin/env node
/* From a signal to a pre-selected kind: the precedence, pinned.
 * `node tools/signal-kind.test.js`
 *
 * A v2 mail states a `signal` (what the mail ITSELF can say: "card repayment",
 * "payroll"). The device combines it with what only it knows (the person's
 * accounts, cards, positions, debts and lessons) and pre-selects a kind
 * (email-reading-v2-spec §9). First match wins:
 *
 *   1. the person's explicit pick, or a lesson learned from one
 *   2. a signal PLUS a matching thing the person owns (the other half pre-filled)
 *   3. a signal alone: the kind is proposed, the missing half rests unset
 *   4. the lending pass, vetoes and all
 *   5. direction alone
 *
 * What this pins, over the REAL builder and the real tree:
 *   - each tier, and that a v1 row or a v2 row with no signal takes the old road;
 *   - the transfer counterpart is PRE-FILLED when the printed tail is an account
 *     the person owns (it never was before), and never with a wrong account;
 *   - provenance decides WHERE a row shows (c._srcAttn), never whether it imports;
 *   - nothing here ticks, unticks or imports anything;
 *   - quick review asks the same function.
 *
 * Synthetic values only.
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
const SRC76 = read('src/js-data/76-quick-review.js');
const SRC56 = read('src/js-ui/56-csv-import-ui.js');

const ACCOUNTS = [
  { id: 'dep-own', kind: 'deposit', tail: '0001', provider: 'testbank' },
  { id: 'dep-other', kind: 'deposit', tail: '7777', provider: 'otherbank' },
  { id: 'wallet', kind: 'ewallet', tail: null, provider: 'momo' },
  { id: 'card-A', kind: 'credit_card', tail: '4444', provider: 'testbank' },
  { id: 'card-B', kind: 'credit_card', tail: '5555', provider: 'otherbank' },
  { id: 'pos-fpt', kind: 'investment', assetSymbol: 'FPT', name: 'FPT' },
];
function device(opts) {
  opts = opts || {};
  const ctx = {
    console, L: (vi) => vi, LANG: 'vi', CUR: 'VND', csvStagedMode: true, txns: [],
    catOrder: ['Ăn uống', 'Khác'], catStyle: { 'Ăn uống': ['🍜'], 'Khác': ['🗂️'] }, CAT_FALLBACK: 'Khác',
    FH_INCOME_CATS: ['Lương', 'Thưởng', 'Hoàn tiền', 'Khác'],
    isVi: () => true, catValid: (c) => c === 'Ăn uống' || c === 'Khác',
    localStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
  };
  ctx.window = ctx;
  ctx.fhPersonalData = () => ({ state: 'ready', key: opts.locked ? null : 'k', accounts: opts.accounts || ACCOUNTS, txns: [], debts: [] });
  ctx.fhPersonalDebts = () => ({ people: opts.people || [] });
  if (opts.lesson) ctx.fhKindLesson = (k) => (opts.lesson(k) ? { who: 'Person L' } : null);
  if (opts.invMemory) ctx.fhInvMemoryMatch = opts.invMemory;
  vm.createContext(ctx);
  vm.runInContext(read('src/js-ui/11-taxonomy.js'), ctx);
  vm.runInContext(read('src/js-ui/13-partition.js'), ctx);
  vm.runInContext([
    'function deburr(', 'var KW_SHARED=', 'var KW_VI=', 'var KW_EN=', 'var CONCEPT_MATCH=',
    'function _scanConcepts(', 'function conceptFromNote(', 'function familyCatForConcept(', 'function guessCat(',
  ].map((h) => grab(SRC50, h) + (h.startsWith('var') ? ';' : '')).join('\n') + '\n' + SRC50.match(/var CONCEPT_ORDER=\[[^\]]*\];/)[0], ctx);
  vm.runInContext(SRC45.slice(0, SRC45.indexOf('function classifyDate')) + grab(SRC45, 'function classifyDate(') + '\n' + grab(SRC45, 'function classifyAmount('), ctx);
  // the provider registry (generated) — the fold in 57 resolves through it
  vm.runInContext(read('src/js-ui/09-providers.js'), ctx);
  vm.runInContext(read('src/js-ui/57-csv-import-review.js'), ctx);
  vm.runInContext(read('src/js-ui/58-dedup-engine.js'), ctx);
  vm.runInContext(SRC72.slice(SRC72.indexOf('var _BANK_GENERIC_MEMOS'), SRC72.indexOf('window.fhStagedCardPayments = async function')), ctx);
  return ctx;
}
/* An OPENED staged row: the flattened payload is its raw_extracted (fhReadStagedRow). */
function staged(id, top, detail, clear) {
  const t = Object.assign({ amount: 250000, currency: 'VND', direction: 'debit', counterparty: 'SYNTHETIC MART' }, top);
  const x = Object.assign({}, t, { memo: null, memo_display: '', transaction_type: 'bank_txn', account_kind: 'deposit', account_masked: '0001' }, detail);
  return Object.assign({ id: id, occurred_at: '2026-08-20T04:11:09+00:00', source_provider: 'TESTBANK',
    amount: t.amount, currency: t.currency, direction: t.direction, counterparty: t.counterparty,
    duplicate_of_id: null, resolved_before: false, raw_extracted: x }, clear || {});
}
const v2 = (id, top, detail, clear) => staged(id, top, Object.assign({ v: 2 }, detail), clear);
function build(ctx, rows) {
  ctx._fhStagedRows = rows;
  const s = vm.runInContext('fhStagedAsCsvSource(_fhStagedRows)', ctx);
  ctx.__p = s.parsed; ctx.__r = s.result;
  const cs = vm.runInContext('buildCsvCandidates(__p, __r)', ctx);
  ctx.__cs = cs;
  vm.runInContext('csvLendingPass(__cs)', ctx);
  return cs;
}
const one = (ctx, row) => build(ctx, [row])[0];
const kindOf = (c) => c._loan ? 'loan' : c._invest ? 'invest' : c._xfer ? 'xfer' : c._repay ? 'repay' : c.isTransfer ? 'cardpay' : c.isIncome ? 'income' : 'expense';
const PRINTED = { signal: 'printed', card_masked: 'printed', counterparty_account_tail: 'printed', investment: 'printed', loan: 'printed', account_masked: 'printed', fee_amount: 'printed' };

console.log('tier 2: a signal plus a thing the person owns');
{
  const ctx = device();
  let c = one(ctx, v2('t2a', { counterparty: '' }, { signal: 'card_repayment', card_masked: '**** 5555', src: PRINTED }));
  ok(kindOf(c) === 'cardpay' && c._payCardId === 'card-B' && c._sigTier === 2, 'card_repayment + an owned card_masked -> Trả nợ thẻ with THAT card', [kindOf(c), c._payCardId, c._sigTier]);

  c = one(ctx, v2('t2b', { counterparty: 'NGUYEN VAN TEST' }, { signal: 'own_transfer', counterparty_account_tail: '***7777', src: PRINTED }));
  ok(kindOf(c) === 'xfer' && c._xferOtherId === 'dep-other', 'own_transfer + an owned counterparty tail -> the counterpart account is PRE-FILLED', [kindOf(c), c._xferOtherId]);
  ok(c._nodeKind === 'transfer' && c._node === 'bankbank' && c._nodeSource === 'signal', '...filed under the transfer node the signal maps to', [c._nodeKind, c._node, c._nodeSource]);
  ok(!c._srcAttn, '...and it rests on printed facts, so it stays in the ready list', c._srcAttn);

  c = one(ctx, v2('t2c', { counterparty: 'NGUYEN VAN TEST' }, { signal: 'own_transfer', counterparty_account_tail: '0001', src: PRINTED }));
  ok(kindOf(c) === 'xfer' && !c._xferOtherId, 'the row\'s OWN account is never its counterpart', c._xferOtherId);

  c = one(ctx, v2('t2d', { direction: 'credit', counterparty: 'NGUYEN VAN TEST' }, { signal: 'own_transfer', counterparty_account_tail: '7777', src: PRINTED }));
  ok(kindOf(c) === 'xfer' && c.isIncome === true && c._xferOtherId === 'dep-other', 'money IN keeps its direction under the transfer kind', [kindOf(c), c.isIncome]);

  c = one(ctx, v2('t2e', { counterparty: 'VI MOMO' }, { signal: 'wallet_move', counterparty_kind: 'wallet', src: PRINTED }));
  ok(kindOf(c) === 'xfer' && c._xferOtherId === 'wallet', 'wallet_move + the one wallet the person owns at that provider -> pre-filled', c._xferOtherId);
  ok(c._srcAttn === true, '...but a name match is a guess: shown in "Cần bạn xem"', c._srcAttn);
  ok(!c._skipImport, '...and still ticked: provenance decides where, never whether', c._skipImport);

  c = one(ctx, v2('t2f', { counterparty: 'ATM 0042' }, { signal: 'cash_move', src: PRINTED }));
  ok(kindOf(c) === 'xfer' && c._xferOtherId === '_cash' && c._node === 'cashout', 'cash_move (debit) pairs with Tiền mặt, node cashout', [c._xferOtherId, c._node]);

  c = one(ctx, v2('t2g', { counterparty: 'SYNTHETIC SECURITIES' }, { signal: 'securities_trade', sender_kind: 'broker',
    investment: { symbol: 'fpt', side: 'buy', quantity: 300, unit_price: 100000, order_id: 'ORD1' }, src: PRINTED }));
  ok(kindOf(c) === 'invest' && c._investPosId === 'pos-fpt' && c._investQty === 300, 'securities_trade + a symbol matching a position -> Đầu tư with the position and quantity', [kindOf(c), c._investPosId, c._investQty]);
  ok(c._scope === 'personal' && !c.categoryName && c.flags.indexOf('needs_category') < 0, '...personal by nature, and no spending category asked', [c._scope, c.categoryName, c.flags]);

  c = one(ctx, v2('t2h', { direction: 'credit', counterparty: 'SYNTHETIC SECURITIES' }, { signal: 'securities_trade',
    investment: { symbol: 'FPT', side: 'sell', quantity: 100 }, src: PRINTED }));
  ok(kindOf(c) === 'invest' && c.isIncome === true, 'a sell is the same kind, money in (Bán đầu tư)', [kindOf(c), c.isIncome]);
}

console.log('\ntier 2: the loan kinds, against a counterparty balance');
{
  const ctx = device({ people: [{ who: 'SYNTHETIC FINANCE', balance: -5000 }] });
  let c = one(ctx, v2('l1', { counterparty: 'SYNTHETIC FINANCE' }, { signal: 'installment', sender_kind: 'lender', src: PRINTED,
    loan: { installment_no: 3, installment_count: 12 } }));
  ok(kindOf(c) === 'repay' && c._repayWho === 'SYNTHETIC FINANCE' && c._scope === 'personal', 'installment + someone the person owes -> Trả nợ, the person pre-filled', [kindOf(c), c._repayWho]);
  ok(c._nodeKind === 'repayment', '...filed under the repayment tree', c._nodeKind);

  c = one(ctx, v2('l2', { direction: 'credit', counterparty: 'SYNTHETIC FINANCE' }, { signal: 'loan_disbursement', sender_kind: 'lender', src: PRINTED,
    loan: { due_date: '2026-09-25', principal: 20000000 } }));
  ok(kindOf(c) === 'loan' && c.isIncome === true && c._loanWho === 'SYNTHETIC FINANCE' && c._loanDue === '2026-09-25',
    'loan_disbursement (money in) -> Đi vay, lender and due date pre-filled', [kindOf(c), c._loanWho, c._loanDue]);

  c = one(ctx, v2('l3', { counterparty: 'SYNTHETIC FINANCE' }, { signal: 'loan_disbursement', src: PRINTED }));
  ok(kindOf(c) !== 'loan', 'a "disbursement" that went OUT is not that shape: read the old way', kindOf(c));
}

console.log('\ntier 3: a signal alone proposes the kind, the missing half rests unset');
{
  const ctx = device();
  let c = one(ctx, v2('t3a', { counterparty: '' }, { signal: 'card_repayment', card_masked: '**** 9999', src: PRINTED }));
  ok(kindOf(c) === 'cardpay' && c._payCardId === null && c._sigTier === 3, 'a card the person does not own -> Trả nợ thẻ, card "Chưa rõ"', [kindOf(c), c._payCardId, c._sigTier]);

  c = one(ctx, v2('t3b', { counterparty: 'NGUYEN VAN TEST' }, { signal: 'own_transfer', counterparty_account_tail: '3131', src: PRINTED }));
  ok(kindOf(c) === 'xfer' && !c._xferOtherId, 'a counterpart tail nobody here owns -> Chuyển khoản nội bộ, account unset', [kindOf(c), c._xferOtherId]);
  ok(c._skipImport === undefined, '...it is a row on the card, not a question: nothing is held back', c._skipImport);

  c = one(ctx, v2('t3c', { counterparty: 'SYNTHETIC SECURITIES' }, { signal: 'securities_trade', investment: { symbol: 'ZZZ', quantity: 10 }, src: PRINTED }));
  ok(kindOf(c) === 'invest' && !c._investPosId && c._investQty === 10, 'a symbol with no position -> Đầu tư, position unset, quantity kept', [c._investPosId, c._investQty]);

  const two = device({ accounts: ACCOUNTS.concat([{ id: 'dep-twin', kind: 'deposit', tail: '7777', provider: 'thirdbank' }]) });
  c = one(two, v2('t3d', { counterparty: 'NGUYEN VAN TEST' }, { signal: 'own_transfer', counterparty_account_tail: '7777', src: PRINTED }));
  ok(kindOf(c) === 'xfer' && !c._xferOtherId, 'two owned accounts share the tail and no bank is named -> unset, never a guess', c._xferOtherId);
  c = one(two, v2('t3e', { counterparty: 'NGUYEN VAN TEST' }, { signal: 'own_transfer', counterparty_account_tail: '7777', counterparty_bank: 'Third Bank', src: PRINTED }));
  ok(c._xferOtherId === 'dep-twin', '...the printed bank breaks the tie', c._xferOtherId);
}

console.log('\nincome subtypes, and the signal beats the wording');
{
  const ctx = device();
  let c = one(ctx, v2('i1', { direction: 'credit', counterparty: 'CONG TY SYNTHETIC' }, { signal: 'salary', memo: 'CK DEN', memo_display: 'CK DEN', src: PRINTED }));
  ok(kindOf(c) === 'income' && c._incomeCat === 'Lương' && c._node === 'wage', 'salary -> Thu nhập: Lương, node wage', [c._incomeCat, c._node]);
  c = one(ctx, v2('i2', { direction: 'credit' }, { signal: 'refund', src: PRINTED }));
  ok(c._incomeCat === 'Hoàn tiền', 'refund -> Hoàn tiền', c._incomeCat);
  c = one(ctx, v2('i3', { direction: 'credit', counterparty: 'SYNTHETIC SECURITIES' }, { signal: 'yield', memo: 'TRA LUONG', memo_display: 'TRA LUONG', src: PRINTED }));
  ok(c._incomeCat === 'Khác', 'yield -> Khác (the income set has no "Lãi đầu tư"), whatever the memo\'s words say', c._incomeCat);
  ctx.FH_INCOME_CATS.push('Lãi đầu tư');
  c = one(ctx, v2('i4', { direction: 'credit' }, { signal: 'yield', src: PRINTED }));
  ok(c._incomeCat === 'Lãi đầu tư', '...and "Lãi đầu tư" the day the income set has it', c._incomeCat);

  c = one(ctx, v2('i5', { counterparty: 'SYNTHETIC MART' }, { signal: 'purchase', memo: 'HOAN TIEN DON HANG', memo_display: 'HOAN TIEN DON HANG', src: PRINTED }));
  ok(kindOf(c) === 'expense', 'a debit the mail calls a purchase is spending, though its memo says "hoan tien"', kindOf(c));
  c = one(ctx, staged('i5v1', { counterparty: 'SYNTHETIC MART' }, { memo: 'HOAN TIEN DON HANG', memo_display: 'HOAN TIEN DON HANG' }));
  ok(kindOf(c) === 'income', '...while the same v1 row still reads the way it always did', kindOf(c));

  c = one(ctx, v2('i6', { counterparty: 'NGUYEN VAN TEST' }, { signal: 'p2p', memo: 'NGUYEN VAN TEST chuyen tien den NGUYEN VAN TEST - 1000000001',
    memo_display: 'NGUYEN VAN TEST chuyen tien den NGUYEN VAN TEST - 1000000001', src: PRINTED }));
  ok(kindOf(c) === 'expense' && c._sigTier === 5 && !c._sigHold, 'p2p proposes nothing: direction decides (tier 5), and the self-transfer regex stands down', [kindOf(c), c._sigTier]);
}

console.log('\nwhat takes the old road');
{
  const ctx = device();
  const memo = 'NGUYEN VAN TEST chuyen tien den NGUYEN VAN TEST - 1000000001';
  let c = one(ctx, v2('o1', { counterparty: 'NGUYEN VAN TEST' }, { signal: null, memo: memo, memo_display: memo }));
  ok(kindOf(c) === 'xfer' && c._sigKind === undefined, 'a v2 row with a NULL signal still gets the free-text heuristics', [kindOf(c), c._sigKind]);
  c = one(ctx, v2('o2', { counterparty: '' }, { signal: 'some_future_signal', account_kind: 'credit_card', card_masked: '4444', flow: 'transfer' }));
  ok(kindOf(c) === 'cardpay' && c._sigKind === undefined, 'a signal this build does not know is no signal', [kindOf(c), c._sigKind]);
  c = one(ctx, v2('o3', {}, { signal: 'card_due' }));
  ok(c._sigKind === undefined, 'a notice signal proposes no kind', c._sigKind);
  c = one(ctx, staged('o4', { counterparty: '' }, { signal: 'salary' }));
  ok(kindOf(c) === 'expense' && c._sigKind === undefined, 'a row with no `v` is v1: a stray `signal` key on it is ignored', kindOf(c));
  c = one(ctx, v2('o5', { counterparty: 'SYNTHETIC MART' }, { signal: 'card_repayment', counterparty_kind: 'merchant', card_masked: '4444' }));
  ok(kindOf(c) === 'expense', 'E7: a "repayment" that names a merchant is not trusted', kindOf(c));
  c = one(ctx, v2('o6', { direction: 'credit' }, { signal: 'purchase' }));
  ok(kindOf(c) === 'income' && c._sigKind === undefined, 'a signal its own direction contradicts is dropped: direction wins', kindOf(c));

  const locked = device({ locked: true });
  c = one(locked, v2('o7', { counterparty: 'SYNTHETIC SECURITIES' }, { signal: 'securities_trade', investment: { symbol: 'FPT' } }));
  ok(kindOf(c) === 'expense' && c._scope === undefined, 'a personal-only kind is never proposed while the personal ledger is locked', [kindOf(c), c._scope]);
}

console.log('\ntier 1 and tier 4: lessons first, then the lending pass');
{
  const lessoned = device({ lesson: () => true });
  let c = one(lessoned, v2('p1', { counterparty: 'SYNTHETIC GOLD SHOP' }, { signal: 'purchase', src: PRINTED }));
  ok(kindOf(c) === 'loan' && c._lessonWhy === 'learned' && c._sigKind === undefined, 'a lesson from the person\'s own pick outranks the signal', [kindOf(c), c._lessonWhy]);

  const owing = device({ people: [{ who: 'SYNTHETIC MART', balance: -900 }] });
  c = one(owing, v2('p2', { counterparty: 'SYNTHETIC MART' }, { signal: 'purchase', src: PRINTED }));
  ok(kindOf(c) === 'expense' && c._sigHold === true, 'a signal alone outranks the lending pass\'s name match', kindOf(c));
  c = one(owing, v2('p3', { counterparty: 'SYNTHETIC MART' }, { signal: 'p2p', src: PRINTED }));
  ok(kindOf(c) === 'repay' && c._lessonWhy === 'owe', 'p2p is the pass\'s own territory: exactly as today', [kindOf(c), c._lessonWhy]);
  c = one(owing, staged('p4', { counterparty: 'SYNTHETIC MART' }, {}));
  ok(kindOf(c) === 'repay', '...and so is every v1 row', kindOf(c));
}

console.log('\nthe structural rule above the signal');
{
  const ctx = device();
  const c = one(ctx, v2('s1', { direction: 'credit' }, { signal: 'refund', account_kind: 'credit_card', account_masked: '4444', src: PRINTED }));
  ok(kindOf(c) === 'cardpay' && c._payCardId === 'card-A', 'a refund INTO a credit card draws the card\'s debt down: a transfer into that card, never income', [kindOf(c), c._payCardId]);
}

console.log('\nplacement by provenance');
{
  const ctx = device();
  const src = (o) => Object.assign({}, PRINTED, o);
  let c = one(ctx, v2('w1', { counterparty: '' }, { signal: 'card_repayment', card_masked: '4444', src: src({ signal: 'template' }) }));
  ok(!c._srcAttn, 'a template-read signal keeps the row where it is today', c._srcAttn);
  c = one(ctx, v2('w2', { counterparty: '' }, { signal: 'card_repayment', card_masked: '4444', src: src({ signal: 'model' }) }));
  ok(c._srcAttn === true && kindOf(c) === 'cardpay' && c._payCardId === 'card-A', 'the model\'s judgment still pre-selects, and the row shows in "Cần bạn xem"', [c._srcAttn, kindOf(c)]);
  c = one(ctx, v2('w3', { counterparty: 'NGUYEN VAN TEST' }, { signal: 'own_transfer', counterparty_account_tail: '7777', src: src({ counterparty_account_tail: 'heuristic' }) }));
  ok(c._srcAttn === true && c._xferOtherId === 'dep-other', 'a guessed counterpart tail: pre-filled AND flagged', [c._srcAttn, c._xferOtherId]);
  c = one(ctx, v2('w3b', {}, { signal: 'purchase', src: { signal: 'heuristic' } }));
  ok(!c._srcAttn && kindOf(c) === 'expense', 'a guessed `purchase` does NOT flag: Chi tiêu for a debit rests on the printed direction, not on the signal', c._srcAttn);
  c = one(ctx, v2('w3c', { direction: 'credit', counterparty: 'CONG TY SYNTHETIC' }, { signal: 'salary', src: { signal: 'heuristic' } }));
  ok(!c._srcAttn && c._incomeCat === 'Lương', '...nor a guessed `salary`: the subtype is a pre-fill the wording rule always made unflagged', c._srcAttn);
  c = one(ctx, v2('w3d', { counterparty: 'NGUYEN VAN TEST' }, { signal: 'own_transfer', counterparty_account_tail: '7777', src: src({ signal: 'heuristic' }) }));
  ok(c._srcAttn === true && kindOf(c) === 'xfer', 'a guessed own_transfer DOES: the direction alone would never have said "transfer"', c._srcAttn);
  c = one(ctx, v2('w4', {}, { signal: null, src: { signal: 'model' } }));
  ok(c._srcAttn === true, 'a signal the server withdrew (null, with its source kept) is flagged', c._srcAttn);
  c = one(ctx, v2('w5', {}, { signal: null }));
  ok(!c._srcAttn, 'a signal nobody ever stated is not', c._srcAttn);
  c = one(ctx, v2('w6', {}, { signal: 'purchase', src: src({ account_masked: 'model' }) }));
  ok(c._srcAttn === true, 'the row\'s own account, when its number was judged rather than read', c._srcAttn);
  const all = build(ctx, [v2('w7', { counterparty: '' }, { signal: 'card_repayment', card_masked: '4444', src: src({ signal: 'model' }) }), staged('w8', { amount: 99000 }, {})]);   // a different amount: same instant + same amount would be one payment twice
  ok(all.every((x) => !x._skipImport), 'no flag ever unticks a row', all.map((x) => x._skipImport));
  ctx.__cs = all;
  const b = vm.runInContext('bucketCsvCandidates(__cs, false)', ctx);
  ok(b.ready.length === 2 && b.deferred.length === 0, 'and both stay importable: the flag only changes where the card is drawn', [b.ready.length, b.deferred.length]);
  ok(/if\(csvStagedMode && \(csvDupTier\(c\) \|\| c\._srcAttn\)\) return;/.test(SRC56) && /srcRows\.forEach\(function\(e\)\{ (?:if\(csvCatHide\(e\.c\)\) return; )?attnHtml \+= csvStagedSrcCard/.test(SRC56),
    'the renderer draws a flagged row under "Cần bạn xem" and not a second time in the dated list');
}

console.log('\nthe printed fee rides on its parent');
{
  const ctx = device();
  let c = one(ctx, v2('f1', { counterparty: 'NGUYEN VAN TEST' }, { signal: 'p2p', fee_amount: 1100, src: PRINTED }));
  ok(c._fee && c._fee.amount === 1100 && c._fee.on === true && c._fee.node === 'bankfees', 'a printed fee is proposed, ticked, on the bank-fee node', c._fee);
  c = one(ctx, v2('f2', { counterparty: 'NGUYEN VAN TEST' }, { signal: 'p2p', fee_amount: 1100, src: { fee_amount: 'model' } }));
  ok(c._fee && c._fee.on === false, 'a fee the model judged is proposed but NOT ticked', c._fee);
  c = one(ctx, v2('f3', {}, { signal: 'purchase', fee_amount: 0 }));
  ok(c._fee === undefined, 'no fee, no line', c._fee);
  c = one(ctx, staged('f4', {}, { fee_amount: 1100 }));
  ok(c._fee === undefined, 'a v1 row never grows one', c._fee);
  const cs = build(ctx, [v2('f5', {}, { signal: 'purchase', fee_amount: 1100, src: PRINTED })]);
  ok(cs.length === 1, 'and it is never a second candidate: one staged row, one card', cs.length);
}

console.log('\nquick review asks the same function');
{
  ok(/sig = fhKindFromSignal\(\{ x: re,/.test(SRC76), 'fhQuickReviewMaybe calls fhKindFromSignal');
  ok(/if \(foreign \|\| hasFee \|\| \(sig && !sigSimple\)/.test(SRC76), 'anything but a plain expense or income goes to the full screen');
  ok(/catName: QR\.incomeCat \|\| 'Khác'/.test(SRC76), 'and an income row carries the subtype the signal stated');
  ok(/c\._kindPicked = true;/.test(grab(SRC56, 'function csvPickRowKind(')), 'a hand-picked kind is marked as the person\'s own');
}

console.log(failed ? '\n' + failed + ' failed' : '\nall passed');
process.exit(failed ? 1 : 0);
