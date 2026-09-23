#!/usr/bin/env node
/* A statement row speaks the payload-v2 contract, and both its sides are named.
 * `node tools/statement-payload-v2.test.js`            run
 * `node tools/statement-payload-v2.test.js --update`   re-snapshot the candidates
 *
 * WHAT WAS WRONG. A wallet statement prints four columns that name both sides of
 * every row -- the source account and its display name, the destination account
 * and its display name. The reader used ONE of them: on an outgoing row it kept
 * the source name as the funding source (59:279). On an INCOMING row the source
 * was dropped whole, so a top-up from the person's own bank, and even a transfer
 * from their OWN account, both landed as plain income with no source and no
 * destination. Measured on one real 145-row wallet statement: 16 rows are really
 * transfers or top-ups and every one of them was filed as income.
 *
 * WHAT THIS PINS, in the order the work was done:
 *   D  the four columns map onto the SAME raw_extracted keys the email path
 *      seals (counterparty_kind, counterparty_bank, counterparty_account_tail,
 *      holder_name, signal), so the review needs no statement-only rules;
 *   C  the other side is resolved against the accounts the person owns, and a
 *      match pre-fills the transfer counterpart (fhKindFromSignal tier 2);
 *   A  a "<bankcode><digits>.bank" id names a bank through the identity fold,
 *      and NEVER mints an account, because it carries no number;
 *   B  which statement is being read is a table entry (STMT_ISSUERS), not code.
 *
 * AND the constraint that guards all four: a row whose evidence is missing
 * behaves EXACTLY as it did before any of this. The snapshot in tools/fixtures/
 * was taken from the untouched source; only re-snapshot for a deliberate change,
 * and say why in the commit.
 *
 * The real chain, no re-implementation: fhStmtParse (59, profile + holder + the
 * classifier) -> fhStmtRowPayload -> fhStmtAsStaged (77) -> fhStagedAsCsvSource
 * + the row accessors (72) -> buildCsvCandidates (57), over the real tree
 * (11, 13). SYNTHETIC rows only: every name, number and account id below is
 * invented, and the layout is the one already published in
 * tools/fixtures/statements/.
 */
'use strict';
process.env.TZ = 'Asia/Ho_Chi_Minh';   // candidate dates are local; pin the zone so the snapshot is portable
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
/* 59 names banks through the generated provider registry (BIN table moved
   there, account-identity-spec P8); in plain Node the classic script's
   window.FH_PROVIDERS does not exist, so hand it the bare global 59 also
   accepts. */
{ const _pw = {}; new Function('window', read('src/js-ui/09-providers.js'))(_pw); global.FH_PROVIDERS = _pw.FH_PROVIDERS; }
const T = require(path.join(ROOT, 'src/js-ui/59-statement-table.js'));
const SNAP = path.join(__dirname, 'fixtures', 'statement-v2-candidates.json');
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

/* ── the device, just big enough for the chain (the slice 57/72 tests take) ── */
const SRC72 = read('src/js-data/72-txn-review.js');
const SRC50 = read('src/js-ui/50-sheets-expense-capture.js');
const SRC45 = read('src/js-data/45-csv-import.js');
const SRC56 = read('src/js-ui/56-csv-import-ui.js');

function device(accounts) {
  const ctx = {
    console, L: (vi) => vi, LANG: 'vi', CUR: 'VND', csvStagedMode: true, txns: [],
    catOrder: ['Ăn uống', 'Khác'], catStyle: { 'Ăn uống': ['🍜'], 'Khác': ['🗂️'] }, CAT_FALLBACK: 'Khác',
    isVi: () => true, catValid: (c) => c === 'Ăn uống' || c === 'Khác',
    localStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
  };
  ctx.window = ctx;
  ctx.fhPersonalData = () => ({ state: 'ready', key: 'k', accounts: accounts || [], txns: [], labels: [], debts: [] });
  vm.createContext(ctx);
  vm.runInContext(read('src/js-ui/11-taxonomy.js'), ctx);
  vm.runInContext(read('src/js-ui/13-partition.js'), ctx);
  vm.runInContext([
    'function deburr(', 'var KW_SHARED=', 'var KW_VI=', 'var KW_EN=', 'var CONCEPT_MATCH=',
    'function _scanConcepts(', 'function conceptFromNote(', 'function familyCatForConcept(', 'function guessCat(',
  ].map((h) => grab(SRC50, h) + (h.startsWith('var') ? ';' : '')).join('\n') + '\n' + SRC50.match(/var CONCEPT_ORDER=\[[^\]]*\];/)[0], ctx);
  vm.runInContext(SRC45.slice(0, SRC45.indexOf('function classifyDate')) + grab(SRC45, 'function classifyDate(') + '\n' + grab(SRC45, 'function classifyAmount('), ctx);
  vm.runInContext(SRC56.match(/var FH_INCOME_CATS = \[[^\]]*\];/)[0], ctx);
  // the provider registry (generated) — the fold in 57 resolves through it
  vm.runInContext(read('src/js-ui/09-providers.js'), ctx);
  vm.runInContext(read('src/js-ui/57-csv-import-review.js'), ctx);
  vm.runInContext(SRC72.slice(SRC72.indexOf('var _BANK_GENERIC_MEMOS'), SRC72.indexOf('function fhStagedKind')), ctx);
  ['window.fhStagedNode = function (rowIndex)', 'window.fhStagedRawX = function (rowIndex)', 'window.fhStagedAcct = function (c)',
   'window.fhStagedCounterpartAcct = function (x)']
    .forEach((h) => { try { vm.runInContext(grab(SRC72, h) + ';', ctx); } catch (e) {} });
  // 77 is an IIFE that publishes on `window`; hand it this one (as statement-rows.test.js does).
  new Function('window', 'CSV_MCC_CONCEPT', 'L', '_esc', '_escAttr', '_rpc', 'localStorage', 'sessionStorage', 'document', 'crypto',
    read('src/js-data/77-statement-capture.js'))(
    ctx, {}, (vi) => vi, (s) => s, (s) => s, async () => null, ctx.localStorage, { setItem() {} }, {}, require('crypto').webcrypto);
  return ctx;
}

/* ── the synthetic wallet statement ─────────────────────────────────────────
   The layout is the one in tools/fixtures/statements/ewallet.grid.json (header
   row, newest-first, a running balance). Every value is invented. The balance
   column is built forward from an opening so the column proof passes, and the
   bank-funded row deliberately does NOT move it (decision S21). */
const OWN = '0900000001';                       // the wallet's own side: a bare digit string
const HOLDER = 'TRẦN THỊ MAI';                  // with diacritics on the wallet's side...
const HOLDER_FLAT = 'TRAN THI MAI';             // ...and without, as the other bank prints it
const HDR = ['STT', 'Thời gian ', 'Mã giao dịch', 'Loại giao dịch', 'Tài khoản chuyển', 'Tên định danh\n Tài khoản chuyển',
  'Tài khoản nhận', 'Tên định danh \nTài khoản nhận', 'Số Tiền', 'Số Dư Sau giao dịch', 'Trạng Thái GD'];

/* id, when, what, [fromAcct, fromName], [toAcct, toName], amount, balance after */
const SPEC = [
  ['topup_bank',   '03/08/2026 08:15:00', 'Nạp tiền vào Ví để thanh toán',
    ['vcb01.02.bank', 'Vietcombank'], [OWN, HOLDER], 300000, 1300000],
  ['buy_wallet',   '05/08/2026 08:29:06', 'Thanh toán REVI COFFEE',
    [OWN, 'Ví MoMo'], ['m4b_topbrand12_revi', 'REVI COFFEE'], -55000, 1245000],
  ['buy_bank',     '07/08/2026 08:36:09', 'Thanh toán SUKIYA',
    [OWN, 'Vietcombank'], ['m4b_sukiya', 'SUKIYA'], -74000, 1245000],   // funded elsewhere: the balance does not move
  ['salary',       '09/08/2026 08:43:12', 'Nhận lương từ MOMO',
    ['accounting_mm', 'MoMo'], [OWN, HOLDER], 2000000, 3245000],
  ['p2p_out',      '11/08/2026 08:50:15', 'Chuyển tiền qua mã QR đến Phạm Quốc Huy',
    [OWN, HOLDER], ['*******789', 'Phạm Quốc Huy'], -45000, 3200000],
  ['p2p_in',       '13/08/2026 08:57:18', 'Nhận tiền từ Nguyễn Văn Bình',
    ['*******123', 'Nguyễn Văn Bình'], [OWN, HOLDER], 120000, 3320000],
  ['refund',       '15/08/2026 09:04:21', 'Hoàn tiền giao dịch từ Đối tác',
    ['m4becomgrab_moca_v2', 'Đối tác MoMo'], [OWN, 'Đối tác MoMo'], 12000, 3332000],
  ['own_transfer', '17/08/2026 09:11:24', 'Nhận tiền từ ' + HOLDER_FLAT,
    ['970436_1234567890', HOLDER_FLAT], [OWN, HOLDER], 500000, 3832000],
  ['topup_vib',    '19/08/2026 09:18:27', 'Nạp tiền vào ví từ VIB',
    ['vib01.bank', 'VIB'], [OWN, HOLDER], 200000, 4032000],
  ['p2p_out2',     '21/08/2026 09:25:30', 'Chuyển đến Lê Thị Hoa',
    [OWN, HOLDER], ['*******456', 'Lê Thị Hoa'], -300000, 3732000],
];
const IDS = SPEC.map((s) => s[0]);
const GRID = [HDR].concat(SPEC.slice().reverse().map((s, n) => [
  String(n + 1) + '.0', s[1], '9000000' + String(n).padStart(4, '0'), s[2],
  s[3][0], s[3][1], s[4][0], s[4][1], String(s[5]) + '.0', String(s[6]) + '.0', 'Thành công',
]));

/* A plain bank statement: no account columns at all, so the default profile
   reads it, and every row must behave exactly as it did before profiles. */
const PLAIN = [
  ['Ngày giao dịch', 'Nội dung', 'Ghi nợ', 'Ghi có', 'Số dư'],
  ['20/08/2026', 'SYNTHETIC MART', '250000', '', '9750000'],
  ['19/08/2026', 'CONG TY ABC thanh toan luong thang 08', '', '5000000', '10000000'],
  ['18/08/2026', 'Phi quan ly tai khoan', '11000', '', '5000000'],
];

const ACCT_WALLET = { provider: 'momo', kind: 'ewallet', tail: '0001' };
const ACCT_PLAIN = { provider: 'TESTBANK', kind: 'deposit', tail: '0002' };

/* One grid, all the way to its review candidates. */
function run(ctx, grid, acct, ctxParse) {
  const parsed = T.fhStmtParse(grid, null, ctxParse || { provider: acct.provider });
  const staged = parsed.rows.map((r, n) => ctx.fhStmtAsStaged('row-' + n, ctx.fhStmtRowPayload(r, acct, 'S1')));
  ctx._fhStagedRows = staged;
  const s = vm.runInContext('fhStagedAsCsvSource(_fhStagedRows)', ctx);
  ctx.__p = s.parsed; ctx.__r = s.result;
  return { parsed: parsed, staged: staged, cands: vm.runInContext('buildCsvCandidates(__p, __r)', ctx) };
}
/* The candidates, oldest-first and keyed by fixture id, as the snapshot holds
   them. buildCsvCandidates returns them in the order fhStmtParse produced. */
function byId(out) {
  const m = {};
  out.cands.forEach((c, n) => { m[IDS[n]] = JSON.parse(JSON.stringify(c)); });
  return m;
}

/* ── 1. the file is read the same way, whoever owns nothing ─────────────────
   No owned accounts: nothing to resolve the other side against, so this is the
   plain reading of the columns. It is also the snapshot's subject. */
const plainCtx = device([]);
const wallet = run(plainCtx, GRID, ACCT_WALLET);
const plainOut = run(plainCtx, PLAIN, ACCT_PLAIN);

console.log('the file reads, and the columns are proven');
ok(wallet.parsed.proof.ok, 'the wallet grid proves its columns', wallet.parsed.proof);
ok(wallet.parsed.rows.length === SPEC.length, SPEC.length + ' rows', wallet.parsed.rows.length);
ok(plainOut.parsed.proof.ok && plainOut.parsed.rows.length === 3, 'and so does the plain bank grid', plainOut.parsed.proof);

/* ── 2. B — the issuer profile ─────────────────────────────────────────────── */
console.log('\nB · which statement is being read is a table entry');
ok(wallet.parsed.issuer === 'momo-wallet', 'the wallet file matches the wallet profile', wallet.parsed.issuer);
ok(plainOut.parsed.issuer === 'default', 'a file with no account columns falls to the default profile', plainOut.parsed.issuer);
ok(T.fhStmtParse(GRID, null, { provider: 'Some Other Bank' }).issuer === 'default',
   'the same columns under another sender are NOT read as this wallet');
ok(Array.isArray(T.STMT_ISSUERS) && T.STMT_ISSUERS.length === 1,
   'exactly one issuer profile ships, beside the default', (T.STMT_ISSUERS || []).length);
{
  /* The bank-id shape lives in two places by necessity (13-partition reads it
     for the node, 59 for the provider). Pinned equal here so they cannot drift. */
  const svc = ['vcb01.02.bank', 'vib01.bank', 'accounting_mm', 'm4b_sukiya', '*******789'];
  const viaTree = svc.map((s) => plainCtx.fhStructNode({ svc: s, desc: '', out: false }) === 'wallet');
  const viaProfile = svc.map((s) => !!T.fhStmtBankOf(s, T.STMT_ISSUERS[0]));
  ok(JSON.stringify(viaTree) === JSON.stringify(viaProfile),
     '13-partition and the profile agree on which id is a bank', [viaTree, viaProfile]);
}

/* ── 3. D — the payload-v2 contract ────────────────────────────────────────── */
console.log('\nD · the four columns become the fields the email path already seals');
const X = {};
IDS.forEach((id, n) => { X[id] = wallet.staged[n].raw_extracted; });

ok(X.topup_bank.holder_name === HOLDER, 'the holder is read off the file itself', X.topup_bank.holder_name);
ok(Number(X.topup_bank.v) >= 2, 'a statement row is a v2 row', X.topup_bank.v);

ok(X.topup_bank.counterparty_kind === 'bank' && X.topup_bank.signal === 'wallet_move',
   'a top-up from a linked bank is a wallet move, not income', [X.topup_bank.counterparty_kind, X.topup_bank.signal]);
ok(X.topup_bank.counterparty_bank === 'Vietcombank' && !X.topup_bank.counterparty_account_tail,
   'it names the bank and no number: the id carries none', [X.topup_bank.counterparty_bank, X.topup_bank.counterparty_account_tail]);
ok(X.topup_vib.counterparty_bank === 'VIB' && X.topup_vib.signal === 'wallet_move',
   'and so does the second bank shape', [X.topup_vib.counterparty_bank, X.topup_vib.signal]);

ok(X.own_transfer.counterparty_kind === 'self' && X.own_transfer.signal === 'own_transfer',
   'money in from the holder\'s OWN name is an own transfer', [X.own_transfer.counterparty_kind, X.own_transfer.signal]);
ok(X.own_transfer.counterparty_account_tail === '7890' && X.own_transfer.counterparty_bank === 'Vietcombank',
   'read off the account id, through the bank-code table', [X.own_transfer.counterparty_account_tail, X.own_transfer.counterparty_bank]);

ok(X.salary.signal === 'salary' && X.salary.counterparty_kind === 'merchant',
   'payroll is a salary', [X.salary.signal, X.salary.counterparty_kind]);
ok(X.refund.signal === 'refund', 'a partner refund is a refund', X.refund.signal);
ok(X.p2p_in.counterparty_kind === 'person' && !X.p2p_in.signal,
   'a masked phone is a person, and the file says nothing more', [X.p2p_in.counterparty_kind, X.p2p_in.signal]);
ok(X.buy_wallet.counterparty_kind === 'merchant' && !X.buy_wallet.signal,
   'a service id is a merchant, and the merchant path still decides', [X.buy_wallet.counterparty_kind, X.buy_wallet.signal]);
ok(X.p2p_out.counterparty_kind === 'person' && X.p2p_out.counterparty === 'Phạm Quốc Huy',
   'an outgoing row still reads its DESTINATION as the counterparty', X.p2p_out.counterparty);
ok(X.buy_bank.stmt.fundedElsewhere === true,
   'the bank-funded purchase is still tagged to the funding bank (S21)', X.buy_bank.stmt);
{
  const src = X.topup_bank.src || {};
  ok(src.signal === 'printed' && src.counterparty_kind === 'printed',
     'the file PRINTED these, so they are not a guess', src);
  ok(!src.account_kind && !src.account_masked,
     'and nothing the file did not state is given a source', src);
}
{
  const kinds = ['person', 'merchant', 'bank', 'wallet', 'self', 'unknown'];
  const bad = IDS.filter((id) => kinds.indexOf(X[id].counterparty_kind) < 0);
  ok(!bad.length, 'every counterparty_kind is one of the contract\'s six', bad);
  const sigs = IDS.map((id) => X[id].signal).filter(Boolean);
  const off = sigs.filter((s) => ['wallet_move', 'own_transfer', 'salary', 'refund'].indexOf(s) < 0);
  ok(!off.length, 'and every signal is one the file can actually evidence', off);
}

/* ── 4. C — both sides from the account graph ──────────────────────────────── */
console.log('\nC · the other side is resolved against the accounts the person owns');
{
  const owner = device([
    { id: 'a-wallet', kind: 'ewallet', tail: '0001', provider: 'momo' },
    { id: 'a-vcb', kind: 'deposit', tail: '7890', provider: 'vietcombank' },
  ]);
  const out = run(owner, GRID, ACCT_WALLET), c = byId(out);
  ok(c.own_transfer._xfer === true && c.own_transfer._xferOtherId === 'a-vcb',
     'an own transfer pre-fills the account it came from', [c.own_transfer._xfer, c.own_transfer._xferOtherId]);
  ok(c.own_transfer.isIncome === false && c.own_transfer._xferDir === 'in',
     'and it is money IN on a transfer, not income', [c.own_transfer.isIncome, c.own_transfer._xferDir]);
  ok(c.own_transfer._sigTier === 2, 'matched on the printed number: tier 2', c.own_transfer._sigTier);
  ok(!c.own_transfer._srcAttn, 'an exact number is no guess, so it is not flagged', c.own_transfer._srcAttn);

  ok(c.topup_bank._xfer === true && c.topup_bank._xferOtherId === 'a-vcb',
     'a top-up pairs with the only account at that bank', [c.topup_bank._xfer, c.topup_bank._xferOtherId]);
  ok(c.topup_bank._srcAttn === true,
     'that rests on the NAME alone, so the row asks to be looked at', c.topup_bank._srcAttn);
  ok(c.topup_vib._xfer === true && !c.topup_vib._xferOtherId,
     'a bank the person owns no account at pre-fills nothing', c.topup_vib._xferOtherId);
  ok(c.p2p_in.isIncome === true && !c.p2p_in._xfer, 'a person is still a person', [c.p2p_in.isIncome, c.p2p_in._xfer]);
  ok(c.salary._incomeCat === 'Lương' && c.refund._incomeCat === 'Hoàn tiền',
     'payroll and a refund keep their income category', [c.salary._incomeCat, c.refund._incomeCat]);
}
{
  /* Two accounts share the tail and neither names the bank: not ours to pick. */
  const owner = device([
    { id: 'a-wallet', kind: 'ewallet', tail: '0001', provider: 'momo' },
    { id: 'a-one', kind: 'deposit', tail: '7890', provider: 'techcombank' },
    { id: 'a-two', kind: 'deposit', tail: '7890', provider: 'acb' },
  ]);
  const c = byId(run(owner, GRID, ACCT_WALLET));
  ok(c.own_transfer._xfer === true && !c.own_transfer._xferOtherId,
     'an ambiguous tail pre-fills nothing, and still calls it a transfer', c.own_transfer._xferOtherId);
}
{
  /* The fold is what makes the match: the person's account is spelled the long way. */
  const owner = device([
    { id: 'a-wallet', kind: 'ewallet', tail: '0001', provider: 'ngân hàng tmcp ngoại thương việt nam' },
  ]);
  const c = byId(run(owner, GRID, ACCT_WALLET));
  ok(c.topup_bank._xferOtherId === 'a-wallet',
     'a bank spelled its long official way still matches "vcb"', c.topup_bank._xferOtherId);
}

/* ── 5. A — the bank-code rule never invents an account ────────────────────── */
console.log('\nA · a bank id names a bank, and mints nothing');
{
  const ids = ['vcb01.02.bank', 'vib01.bank', 'bidv12.bank'];
  const got = ids.map((i) => T.fhStmtBankOf(i, T.STMT_ISSUERS[0]));
  ok(got.every((g) => g && g.name && !g.tail), 'every ".bank" id gives a name and no number', got);
  ok(!T.fhStmtBankOf('m4b_sukiya', T.STMT_ISSUERS[0]) && !T.fhStmtBankOf('*******789', T.STMT_ISSUERS[0]),
     'a service id and a phone are not banks');
  ok(!!T.fhStmtBankOf('970436_1234567890', T.STMT_ISSUERS[0]).tail,
     'the interbank shape DOES carry a number, so it may be matched on');
  /* The census materializes accounts from staged rows. A statement row must
     never hand it a counterpart, tail or no tail: the file is bulk history. */
  const cp = IDS.map((id) => plainCtx.fhStagedCounterpartAcct(X[id])).filter(Boolean);
  ok(!cp.length, 'no statement row offers a counterpart account to materialize', cp);
}

/* ── 6. the constraint: no evidence, no movement ───────────────────────────── */
console.log('\nthe rows with no new evidence have not moved');
const snapshot = { wallet: byId(wallet), plain: JSON.parse(JSON.stringify(plainOut.cands)) };
if (UPDATE) {
  fs.writeFileSync(SNAP, JSON.stringify(snapshot, null, 1) + '\n');
  console.log('  snapshot written: ' + path.relative(ROOT, SNAP));
} else {
  const want = JSON.parse(fs.readFileSync(SNAP, 'utf8'));
  /* The rows the four steps are ABOUT are expected to move; these are the rest.
     They may gain exactly ONE key, `_v2: true`, which is true (the row now
     carries a v2 reading) and inert for them: the only thing that reads it is
     _v2Node in 72, which lets a node ride a TRANSFER, a loan, a repayment or an
     investment — never the expense and income rows below. Anything else moving
     means a row with nothing new to say was read differently. */
  const UNMOVED = ['buy_wallet', 'buy_bank', 'p2p_out', 'p2p_in', 'p2p_out2'];
  UNMOVED.forEach((id) => {
    const now = Object.assign({}, snapshot.wallet[id]);
    const added = Object.keys(now).filter((k) => !(k in want.wallet[id]));
    ok(added.length === 0 || (added.length === 1 && added[0] === '_v2' && now._v2 === true),
       id + ' gained nothing but the v2 marker', added);
    delete now._v2;
    ok(JSON.stringify(now) === JSON.stringify(want.wallet[id]),
       'and the candidate for ' + id + ' is otherwise byte-identical to the day before this change',
       { now: now, was: want.wallet[id] });
  });
  ok(JSON.stringify(snapshot.plain) === JSON.stringify(want.plain),
     'and a plain bank statement, which has none of these columns, is untouched to the byte',
     { now: snapshot.plain, was: want.plain });
}

console.log(failed ? '\n' + failed + ' failed' : '\nall passed');
process.exit(failed ? 1 : 0);
