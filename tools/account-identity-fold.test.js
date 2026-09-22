#!/usr/bin/env node
/* One account, however its provider was spelled.
 * `node tools/account-identity-fold.test.js`
 *
 * WHAT WAS WRONG, measured on a live ledger. The same instrument is held two
 * and three times by one person:
 *   - one wallet as `momo` with a number, as `ví momo` with NO number, and
 *     under the operator's full legal name with the same number;
 *   - one bank as `hsbc` ••0041 and as `hsbc vietnam` ••0041;
 *   - a tail-less row of the first kind carrying 26 real transactions.
 * Two causes, and both are here: provider strings that do not fold to one key,
 * and a tail-less name that can still mint an account.
 *
 * WHAT THIS PINS
 *   1. the fold table — the aliases only, no ledger data — and that it is a
 *      REFINEMENT of the server's canonProviderName (senders.mjs), walked over
 *      that file's own registry so the two cannot drift apart: never two keys
 *      for one server name, and never one key for two;
 *   2. the deny list: a phrase that is not a provider ("Ngân hàng liên kết",
 *      "Tài khoản", a wallet's generic word for itself) folds to nothing;
 *   3. fhPersonalAccountEnsure, the REAL one out of 19-personal.js:
 *        · a spec with NO tail returns the owner's single non-archived account
 *          for that folded provider, and creates nothing;
 *        · with no tail and no match at all it returns null (2026-09-19);
 *        · with no tail and SEVERAL accounts at that provider, null;
 *        · identity is (provider, tail) and never the kind (full-ledger T12).
 *
 * Synthetic names and numbers only.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { pathToFileURL } = require('url');

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

/* ── the fold itself, out of 57-csv-import-review.js ───────────────────────── */
const SRC57 = read('src/js-ui/57-csv-import-review.js');
const fold = (() => {
  const ctx = { console };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext([
    'function deburr(s){ return String(s==null?"":s).normalize("NFD").replace(/[\\u0300-\\u036f]/g,"").replace(/đ/g,"d").replace(/Đ/g,"d").toLowerCase(); }',
    SRC57.match(/var CSV_PROVIDER_NOISE = \[[\s\S]*?\];/)[0],
    grab(SRC57, 'function csvCanonicalProvider(name)'),
    SRC57.match(/var FH_PROVIDER_CANON = \{[\s\S]*?\n\};/)[0],
    SRC57.match(/var FH_PROVIDER_LONG = \{[\s\S]*?\n\};/)[0],
    SRC57.match(/var FH_PROVIDER_ALIAS = \{[\s\S]*?\n\};/)[0],
    SRC57.match(/var FH_PROVIDER_NOTA = \[[\s\S]*?\];/)[0],
    grab(SRC57, 'function fhAcctProviderKey(name)'),
    grab(SRC57, 'function fhAcctIdentity(spec)'),
    grab(SRC57, 'function fhProviderName(name)'),
  ].join('\n'), ctx);
  return ctx;
})();
const key = (s) => fold.fhAcctProviderKey(s);

/* ── 1. the fold table ─────────────────────────────────────────────────────── */
console.log('the fold table: one key per provider, however it was written');
/* [what was written, what it must key as]. Aliases only — nothing here comes
   from anyone's ledger. */
const TABLE = [
  // a wallet: its short name, its "Ví X" form, its operator's legal name
  ['MoMo', 'momo'], ['momo', 'momo'], ['Ví MoMo', 'momo'], ['ví momo', 'momo'],
  ['M_Service', 'momo'], ['Công ty Cổ phần Dịch vụ Di động Trực tuyến', 'momo'],
  ['ZaloPay', 'zalopay'], ['Ví ZaloPay', 'zalopay'], ['CTCP Zion', 'zalopay'],
  ['ShopeePay', 'shopeepay'], ['Ví ShopeePay', 'shopeepay'], ['AirPay', 'shopeepay'],
  ['Viettel Money', 'viettelmoney'], ['ViettelPay', 'viettelmoney'],
  // a bank: short name, "X Vietnam", "Ngân hàng X", the long official name
  ['VCB', 'vietcom'], ['Vietcombank', 'vietcom'], ['vietcombank', 'vietcom'],
  ['Ngân hàng TMCP Ngoại thương Việt Nam', 'vietcom'], ['NH Ngoại thương', 'vietcom'],
  ['VIB', 'vib'], ['Ngân hàng Quốc Tế', 'vib'], ['Ngân hàng TMCP Quốc Tế Việt Nam', 'vib'],
  ['MB', 'mb'], ['MBBank', 'mb'], ['MB Bank', 'mb'], ['Ngân hàng TMCP Quân Đội', 'mb'],
  ['Techcombank', 'techcom'], ['TCB', 'techcom'], ['Ngân hàng TMCP Kỹ Thương', 'techcom'],
  // a bank the registry does not know still folds its dressing away
  ['HSBC', 'hsbc'], ['HSBC Vietnam', 'hsbc'], ['hsbc vietnam', 'hsbc'], ['HSBC Việt Nam', 'hsbc'],
  ['Shinhan', 'shinhan'], ['Shinhan Bank Vietnam', 'shinhan'],
];
TABLE.forEach(([wrote, want]) => ok(key(wrote) === want, '"' + wrote + '" -> ' + want, key(wrote)));

console.log('\n...and never folds two different providers onto one key');
[['VIB', 'Vietcombank'], ['MB Bank', 'MSB'], ['MoMo', 'ZaloPay'], ['VPBank', 'VIB'],
 ['Techcombank', 'TPBank'], ['HSBC', 'ACB'], ['SHB', 'SeABank']].forEach(([a, b]) => {
  ok(key(a) !== key(b), key(a) + ' is not ' + key(b));
});

/* ── 2. the deny list ──────────────────────────────────────────────────────── */
console.log('\nphrases that are not a provider at all');
['Ngân hàng liên kết', 'ngan hang lien ket', 'Linked bank', 'Tài khoản', 'Account',
 'Ví', 'Ví điện tử', 'Ví của tôi', 'Wallet', 'Khác', 'Other', 'Chưa rõ', ''].forEach((s) => {
  ok(key(s) === '', '"' + s + '" names nothing', key(s));
});
ok(key('VIB') === 'vib' && key('Ví') === '', 'and the deny list does not eat a real name that starts the same way');
{
  const id = fold.fhAcctIdentity({ provider: 'Ví MoMo', tail: '••1217' });
  ok(id.key === 'momo' && id.tail === '1217' && id.id === 'momo|1217', 'an identity is (folded provider, four digits)', id);
  ok(fold.fhAcctIdentity({ provider: 'Ngân hàng liên kết' }).id === '|', 'and a phrase with no number is no identity at all',
     fold.fhAcctIdentity({ provider: 'Ngân hàng liên kết' }));
  ok(fold.fhProviderName('ví momo') === 'MoMo' && fold.fhProviderName('M_Service') === 'MoMo',
     'the display name folds with it', [fold.fhProviderName('ví momo'), fold.fhProviderName('M_Service')]);
}

/* ── 3. consistency with the server's canonProviderName ────────────────────── */
(async () => {
  const senders = await import(pathToFileURL(path.join(ROOT, 'supabase/functions/_shared/mailbox/senders.mjs')).href);
  const D = senders.KNOWN_DOMAINS;
  const names = [...new Set([].concat(
    Object.values(D.BANKS), Object.values(D.WALLETS), Object.values(D.EWALLETS),
    Object.values(D.GATEWAYS), Object.values(D.BROKERS), Object.values(D.LENDERS)))];

  console.log('\nthe device fold is a REFINEMENT of the server\'s canonProviderName (' + names.length + ' providers)');
  /* The server folds spellings onto one display name; the device folds display
     names onto one key. The device may fold MORE (that is the point), but it
     must never split what the server joined, nor join what the server split. */
  const byServer = {}, bySplit = [], byMerge = {};
  names.forEach((n) => {
    const s = senders.canonProviderName(n), k = key(n);
    if (byServer[s] === undefined) byServer[s] = k;
    else if (byServer[s] !== k) bySplit.push([s, byServer[s], k]);
    (byMerge[k] = byMerge[k] || []).push(s);
  });
  ok(!bySplit.length, 'no server name keys two ways on the device', bySplit);
  const merged = Object.keys(byMerge)
    .map((k) => [k, [...new Set(byMerge[k])]])
    .filter(([, ss]) => ss.length > 1);
  ok(!merged.length, 'and no two server providers collapse into one device key', merged);
  ok(key(senders.canonProviderName('mbank')) === key('MB Bank'),
     'a stump the server aliases keys the same as the name it aliases to');

  /* ── 4. the real ensure() ───────────────────────────────────────────────── */
  console.log('\nfhPersonalAccountEnsure, the real one');
  const SRC19 = read('src/js-data/19-personal.js');
  function ledger(accounts) {
    const state = { accounts: (accounts || []).map((a) => Object.assign({}, a)), inserted: [], seq: 0 };
    const ctx = { console, fhAcctProviderKey: key };
    ctx.window = ctx;
    ctx.P = { uid: 'u1', key: 'k', accounts: state.accounts };
    ctx._encP = async (v) => v;
    ctx._sb = () => ({ from: () => ({ insert: (row) => { state.inserted.push(row); return {
      select: () => ({ single: async () => ({ data: { id: 'new-' + (++state.seq) }, error: null }) }) }; } }) });
    ctx.fhPersonalHydrate = async () => {};
    vm.createContext(ctx);
    vm.runInContext(grab(SRC19, 'window.fhPersonalAccountEnsure = async function (info)') + ';', ctx);
    return { ctx, state, ensure: (info) => ctx.fhPersonalAccountEnsure(info) };
  }

  {   /* the wallet held three ways — the exact production shape, synthetic values */
    const L = ledger([{ id: 'a-momo', kind: 'ewallet', provider: 'momo', tail: '1217' }]);
    ok(await L.ensure({ kind: 'ewallet', provider: 'ví momo' }) === 'a-momo',
       'a tail-less "ví momo" returns the one MoMo account, and mints nothing');
    ok(await L.ensure({ kind: 'ewallet', provider: 'Công ty Cổ phần Dịch vụ Di động Trực tuyến', tail: '1217' }) === 'a-momo',
       'the operator\'s legal name with the same number is the same account');
    ok(await L.ensure({ kind: 'deposit', provider: 'MoMo', tail: '1217' }) === 'a-momo',
       'and a wrong KIND never splits it (full-ledger T12)');
    ok(L.state.inserted.length === 0, 'nothing was created', L.state.inserted);
  }
  {   /* the bank held two ways */
    const L = ledger([{ id: 'a-hsbc', kind: 'deposit', provider: 'hsbc', tail: '0041' }]);
    ok(await L.ensure({ kind: 'deposit', provider: 'hsbc vietnam', tail: '••0041' }) === 'a-hsbc',
       '"hsbc vietnam" ••0041 is "hsbc" ••0041');
    ok(await L.ensure({ kind: 'deposit', provider: 'HSBC Vietnam' }) === 'a-hsbc',
       'and with no number at all it still adopts the one account there');
    ok(L.state.inserted.length === 0, 'nothing was created', L.state.inserted);
  }
  {   /* no tail, nothing to adopt */
    const L = ledger([]);
    ok(await L.ensure({ kind: 'deposit', provider: 'Vietcombank' }) === null,
       'no tail and no account at that provider: null, never a tail-less ghost');
    ok(L.state.inserted.length === 0, 'and nothing was created', L.state.inserted);
  }
  {   /* no tail, several to choose from */
    const L = ledger([
      { id: 'a-1', kind: 'deposit', provider: 'vib', tail: '4751' },
      { id: 'a-2', kind: 'deposit', provider: 'Ngân hàng TMCP Quốc Tế Việt Nam', tail: '5140' },
    ]);
    ok(await L.ensure({ kind: 'deposit', provider: 'VIB' }) === null,
       'two accounts at one bank, no number: the row cannot say which, so null');
    ok(L.state.inserted.length === 0, 'and nothing was created', L.state.inserted);
  }
  {   /* a phrase that is not a provider */
    const L = ledger([{ id: 'a-momo', kind: 'ewallet', provider: 'momo', tail: '1217' }]);
    ok(await L.ensure({ kind: 'deposit', provider: 'Ngân hàng liên kết' }) === null,
       '"Ngân hàng liên kết" with no number creates nothing and adopts nothing');
    ok(await L.ensure({ kind: 'deposit', provider: 'Tài khoản' }) === null, '"Tài khoản" likewise');
    ok(L.state.inserted.length === 0, 'nothing was created', L.state.inserted);
  }
  {   /* the one caller with neither a provider nor a number: its NAME is its
         identity, and "no tail, no account" must never reach it. */
    const L = ledger([]);
    const id = await L.ensure({ kind: 'cash', name: 'Tiền mặt' });
    ok(id === 'new-1' && L.state.inserted.length === 1, 'the cash account still creates itself', id);
    ok(await L.ensure({ kind: 'cash', name: 'Tiền mặt' }) === 'new-1', 'and only once', L.state.accounts.length);
  }
  {   /* what must still work: a real new instrument with a number */
    const L = ledger([{ id: 'a-momo', kind: 'ewallet', provider: 'momo', tail: '1217' }]);
    const id = await L.ensure({ kind: 'deposit', provider: 'Vietcombank', tail: '2279', name: 'Vietcombank ••2279' });
    ok(id === 'new-1' && L.state.inserted.length === 1, 'a number the ledger has never seen still creates its account', id);
    ok(L.state.inserted[0].provider === 'vietcombank' && L.state.inserted[0].tail === '2279',
       'stored exactly as it always was: the MATCH folds, the value does not', L.state.inserted[0]);
  }

  console.log(failed ? '\n' + failed + ' failed' : '\nall passed');
  process.exit(failed ? 1 : 0);
})();
