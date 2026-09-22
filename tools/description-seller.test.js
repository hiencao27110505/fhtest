#!/usr/bin/env node
/* A payment to a SELLER must not arrive with an empty description.
 * `node tools/description-seller.test.js`
 *
 * "Chi cho gì" is left blank on purpose when the money went to a PERSON: their
 * name answers who was paid, not what for, and a wrong pre-fill gets accepted
 * rather than corrected. The test for "is this a person" was the reader's
 * verdict — `reader_type === 'p2p_transfer'` — and the reader calls ANY mail
 * with a beneficiary row that. So a QR payment to a shop ("VQRQ0001oqplk - VO
 * DINH PHUC", memo "Thanh toan QR", which the tidy correctly empties) took the
 * person branch and rendered blank, with the only name in the mail thrown away.
 * Measured on the founder's real queue: 19 rows read as p2p, 7 of them
 * merchants, 5 blank with a counterparty sitting right there.
 *
 * payload v2 states the fact the rule actually wants: `counterparty_kind`
 * (person | merchant | bank | wallet | self | unknown) is about the OTHER SIDE,
 * not about the mail. So it is asked first, `unknown` is no opinion, and a row
 * that carries none at all — every v1 row, every statement row — keeps today's
 * behaviour byte for byte.
 *
 * Real functions extracted from source by name, so a rename fails this rather
 * than quietly passing.
 */
// NOT 'use strict': the eval'd declarations must land in this scope.
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const src72 = fs.readFileSync(path.join(ROOT, 'src/js-data/72-txn-review.js'), 'utf8');
const src76 = fs.readFileSync(path.join(ROOT, 'src/js-data/76-quick-review.js'), 'utf8');

function grab(src, header) {
  const at = src.indexOf(header);
  if (at < 0) { console.error('not found in source: ' + header + ' — renamed?'); process.exit(1); }
  let i = src.indexOf('{', at), depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (!depth) break; }
  }
  return src.slice(at, i + 1);
}

function L(vi) { return vi; }
global.window = global.window || {};
/* From _BANK_GENERIC_MEMOS, because the description rule calls _bankGenericMemo
   declared just above it — slicing the function alone leaves it undefined and
   the suite fails on its own scaffolding instead of on the behaviour. */
eval(src72.slice(src72.indexOf('var _BANK_GENERIC_MEMOS'), src72.indexOf('function fhStagedKind')));
eval(grab(src76, 'function _qrDesc('));

let pass = 0, fail = 0;
const t = (n, ok, d) => { console.log((ok ? '  PASS  ' : '  FAIL  ') + n + (!ok && d !== undefined ? '  -> ' + JSON.stringify(d) : '')); ok ? pass++ : fail++; };

const DESC = 1;
const SELLER = 'VQRQ0001oqplk - VO DINH PHUC';
const PERSON = 'LE VAN HOANG - 0912345678';
const row = (extracted, clear) => Object.assign({
  occurred_at: '2026-08-20T04:11:00Z', amount: 250000, direction: 'debit',
  counterparty: null, source_provider: 'TESTBANK',
}, clear || {}, { raw_extracted: extracted });
const descOf = (r) => fhStagedAsCsvSource([r]).parsed.rows[0][DESC];

console.log('\n-- the reported bug: a seller payment read as p2p --');
/* The exact shape the v2 reader seals for it: the mail carries a beneficiary
   row, so reader_type says p2p_transfer; the memo is the till's "Thanh toan QR"
   and the tidy emptied it; counterparty_kind says what the other side IS. */
t('a merchant counterparty with an emptied memo describes the row',
  descOf(row({ memo: 'Thanh toan QR', memo_display: '', reader_type: 'p2p_transfer',
               counterparty_kind: 'merchant', signal: 'purchase' },
             { counterparty: SELLER })) === SELLER,
  'the seller\'s name was thrown away and the box arrived blank');

t('a real PERSON is still blank, which is the whole point of the rule',
  descOf(row({ memo: null, memo_display: '', reader_type: 'p2p_transfer',
               counterparty_kind: 'person' }, { counterparty: PERSON })) === '');

t('the FACT outranks the reader in both directions: person + bank_txn is still blank',
  descOf(row({ memo_display: '', reader_type: 'bank_txn', counterparty_kind: 'person' },
             { counterparty: PERSON })) === '');

console.log('\n-- the other counterparty_kind values --');
[['bank', 'MB BANK'], ['wallet', 'MOMO'], ['self', 'CAO THAI DUY HIEN']].forEach(function (p) {
  t('counterparty_kind "' + p[0] + '" is not a person → the name describes the row',
    descOf(row({ memo_display: '', reader_type: 'p2p_transfer', counterparty_kind: p[0] },
               { counterparty: p[1] })) === p[1]);
});
t('"unknown" is NO OPINION: it falls back to the reader, blank as before',
  descOf(row({ memo_display: '', reader_type: 'p2p_transfer', counterparty_kind: 'unknown' },
             { counterparty: PERSON })) === '');
t('an empty counterparty_kind falls back too',
  descOf(row({ memo_display: '', reader_type: 'p2p_transfer', counterparty_kind: '' },
             { counterparty: PERSON })) === '');

console.log('\n-- a memo someone typed still wins over everything --');
t('merchant + a real memo → the memo, not the shop',
  descOf(row({ memo: 'ca phe sang', memo_display: 'ca phe sang', reader_type: 'p2p_transfer',
               counterparty_kind: 'merchant' }, { counterparty: SELLER })) === 'ca phe sang');
t('merchant + a BANK-generic memo → the shop, the generic phrase loses',
  descOf(row({ memo: 'Thanh toán dịch vụ - hàng hoá', memo_display: 'Thanh toán dịch vụ - hàng hoá',
               reader_type: 'p2p_transfer', counterparty_kind: 'merchant' },
             { counterparty: SELLER })) === SELLER);

console.log('\n-- v1 and statement rows: SNAPSHOT, nothing may move --');
/* Every one of these carries no counterparty_kind at all. The expected column
   is what the rule produced before this change — a v1 row and a statement row
   must read exactly as they did. */
[
  [{ memo_display: '', transaction_type: 'p2p_transfer' }, { counterparty: PERSON }, ''],
  [{ memo_display: '', transaction_type: 'bank_txn' }, { counterparty: PERSON }, PERSON],
  [{ memo_display: '', reader_type: 'p2p_transfer', transaction_type: 'bank_txn' }, { counterparty: SELLER }, ''],
  [{ memo: 'an toi', transaction_type: 'p2p_transfer' }, {}, 'an toi'],
  [{ memo: 'ck', memo_display: '', transaction_type: 'p2p_transfer' }, {}, ''],
  [{ memo: null, memo_display: '', transaction_type: 'card_purchase' }, { counterparty: 'QUICK SAVE MARKET' }, 'QUICK SAVE MARKET'],
  [{ memo_display: '' }, { counterparty: null, source_provider: 'Techcombank' }, 'Techcombank'],
  [{}, { counterparty: null, source_provider: null }, ''],
].forEach(function (c, i) {
  t('v1 snapshot #' + (i + 1) + ' unchanged', descOf(row(c[0], c[1])) === c[2], descOf(row(c[0], c[1])));
});

console.log('\n-- the quick sheet makes the same call --');
t('_qrDesc: a merchant keeps its name',
  _qrDesc({ memo: 'Thanh toan QR', memo_display: '', reader_type: 'p2p_transfer',
            counterparty_kind: 'merchant', counterparty: SELLER }) === SELLER);
t('_qrDesc: a person is blank', _qrDesc({ memo_display: '', reader_type: 'p2p_transfer',
            counterparty_kind: 'person', counterparty: PERSON }) === '');
t('_qrDesc: a v1 row is unchanged', _qrDesc({ memo_display: '', transaction_type: 'p2p_transfer',
            counterparty: PERSON }) === '');
t('_qrDesc: a v1 purchase is unchanged', _qrDesc({ memo_display: '', transaction_type: 'bank_txn',
            counterparty: PERSON }) === PERSON);

console.log('\n' + (fail === 0 ? 'ALL ' + pass + ' PASSED' : pass + ' passed, ' + fail + ' FAILED'));
process.exit(fail ? 1 : 0);
