#!/usr/bin/env node
/* A staged row whose kind the server could not call still names its account.
 * `node tools/staged-acct-owned-match.test.js`
 *
 * fhStagedAcct used to read `x.account_kind || null` and, when that was null,
 * throw the provider and the tail away with it — so the row imported with no
 * account and the ledger said "Nguồn tiền: Chưa rõ". Measured 2026-09-22: 27 of
 * 200 live rows carried no account_kind, several of them on an account the app
 * had already held for weeks.
 *
 * full-ledger-spec T12 is the licence to do better: an account's identity is
 * (provider, tail) and the KIND is editable metadata. So when the mail prints
 * both and exactly one account the person ALREADY OWNS has that identity, the
 * kind is read off their own record. Nothing is invented — the evidence is
 * theirs.
 *
 * What must NOT change:
 *   • no owned match → still null. Creating an account needs a STATED kind
 *     (personal_accounts.kind is NOT NULL; a wrong one invents a debt, Q16).
 *   • a kind the server DID state is never overruled by the local record.
 *   • one tail, two owned accounts → null. A wrong account is worse than none.
 *
 * Providers must fold: the mail says "VIB", the account may have been created
 * as "Ngân hàng Quốc Tế" or under the long official name, and all three have to
 * key one account (fhProviderName + csvCanonicalProvider, the pair 57 already
 * uses for exactly this).
 *
 * Every fixture is SYNTHETIC: invented providers, invented digits.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const SRC72 = read('src/js-data/72-txn-review.js');
const CSVUI = read('src/js-ui/56-csv-import-ui.js');
const REVIEW = read('src/js-ui/57-csv-import-review.js');

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

const ctx = { console, L: (vi) => vi, csvStagedMode: true, esc: (s) => s };
ctx.window = ctx;
vm.createContext(ctx);
// The provider canon (57) whole — fhProviderName leans on csvCanonicalProvider
// and its noise list, and slicing those apart by hand would only test the
// slicing. Then the accessor under test, and the review chip that reads it.
vm.runInContext(grab(read('src/js-ui/50-sheets-expense-capture.js'), 'function deburr('), ctx);
vm.runInContext(REVIEW, ctx);
vm.runInContext(grab(SRC72, 'window.fhStagedAcct = function (c)') + ';', ctx);
vm.runInContext(grab(CSVUI, 'function csvStagedAcctChip('), ctx);

/* One staged row and one set of owned accounts; `acct` is what the review,
   the promote path and the census all read. `chip` is what the card shows. */
const CARD = { id: 'a1', kind: 'credit_card', provider: 'VIB', tail: '4751' };
const DEPOSIT = { id: 'a2', kind: 'deposit', provider: 'Vietcombank', tail: '0123' };
function acct(provider, extracted, accounts) {
  ctx._fhStagedRows = [{ source_provider: provider, raw_extracted: extracted }];
  ctx.__accounts = accounts || null;
  ctx.fhPersonalData = accounts ? () => ({ state: 'ready', accounts: accounts }) : undefined;
  return {
    ai: vm.runInContext('fhStagedAcct({ rowIndex: 0 })', ctx),
    chip: vm.runInContext('csvStagedAcctChip({ rowIndex: 0 })', ctx),
  };
}
// The measured mail: VIB's "Thanh toán hóa đơn QR thành công" paid by card,
// whose only instrument row is the card. Before the server learned to read that
// row, it sealed account_kind null; rows already staged still carry null and
// their sealed boxes can never be amended, which is why this tier exists.
const QR_BY_CARD = { account_masked: '••••4751', account_kind: null };

console.log('\nkind null, but the person already owns this (provider, tail)');
let r = acct('VIB', QR_BY_CARD, [CARD, DEPOSIT]);
ok(r.ai && r.ai.kind === 'credit_card' && r.ai.tail === '4751' && r.ai.provider === 'VIB',
  'their own record states the kind', r.ai);
ok(r.chip === 'tín dụng ••4751', 'and the review chip names the account instead of showing nothing', r.chip);

r = acct('VIB', { account_masked: '9999 8888 7777 0123', account_kind: null }, [CARD, DEPOSIT]);
ok(r.ai === null, 'a tail they own at ANOTHER bank is not a match — identity is the pair', r.ai);

console.log('\nno owned match → null, exactly as before');
ok(acct('VIB', QR_BY_CARD, []).ai === null, 'no accounts at all');
ok(acct('VIB', QR_BY_CARD, [DEPOSIT]).ai === null, 'accounts, none on this (provider, tail)');
ok(acct('VIB', QR_BY_CARD, null).ai === null, 'a locked ledger the device cannot read');
ok(acct('VIB', { account_masked: '', account_kind: null }, [CARD]).ai === null, 'a mail that printed no number');
ok(acct('', QR_BY_CARD, [CARD]).ai === null, 'a row with no provider');
ok(acct('VIB', { account_masked: '••••4751', account_kind: null },
  [{ id: 'a3', kind: null, provider: 'VIB', tail: '4751' }]).ai === null,
  'an owned account with no kind of its own answers nothing');

console.log('\na stated kind is never overruled by the local record');
r = acct('VIB', { account_masked: '••••4751', account_kind: 'deposit' }, [CARD]);
ok(r.ai && r.ai.kind === 'deposit', 'the server said deposit; the owned card does not re-kind the row', r.ai);
r = acct('MoMo', { account_masked: '••••4751', account_kind: null }, [CARD]);
ok(r.ai && r.ai.kind === 'ewallet', 'the wallet-provider rule still runs first', r.ai);

console.log('\nprovider aliases key ONE account');
const ALIASES = ['VIB', 'vib', 'Ngân hàng Quốc Tế', 'Ngân hàng TMCP Quốc tế Việt Nam', 'NH TMCP Quoc te'];
for (const name of ALIASES) {
  const got = acct(name, QR_BY_CARD, [CARD]).ai;
  ok(got && got.kind === 'credit_card', '"' + name + '" finds the VIB card', got);
}
ok(acct('VIB', QR_BY_CARD, [{ id: 'a4', kind: 'credit_card', provider: 'Ngân hàng TMCP Quốc tế Việt Nam', tail: '4751' }]).ai
  !== null, '...and so does an account created under the long name');

console.log('\nambiguity resolves to nothing: a wrong account is worse than no account');
const TWINS = [CARD, { id: 'a5', kind: 'deposit', provider: 'VIB', tail: '4751' }];
ok(acct('VIB', QR_BY_CARD, TWINS).ai === null, 'one tail, two owned accounts at the same bank', acct('VIB', QR_BY_CARD, TWINS).ai);
ok(acct('VIB', QR_BY_CARD, TWINS).chip === '', '...and the chip stays silent rather than guessing');

console.log('\nthe source still says what it means');
ok(/full-ledger|T12/.test(grab(SRC72, 'window.fhStagedAcct = function (c)')),
  'fhStagedAcct cites the decision it rests on');
ok(/personal_accounts/.test(grab(SRC72, 'window.fhStagedAcct = function (c)')),
  '...and why a no-match still refuses to answer');

console.log(failed ? '\n' + failed + ' failed' : '\nall passed');
process.exit(failed ? 1 : 0);
