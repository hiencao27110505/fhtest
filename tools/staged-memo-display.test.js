#!/usr/bin/env node
/* "Chi cho gì" must not be pre-filled with what the BANK wrote.
 * `node tools/staged-memo-display.test.js`
 *
 * A bank stamps its own words into "Nội dung chuyển tiền": "NGUYEN THU TRANG
 * chuyen tien" is auto-fill that passes any looks-like-prose test while carrying
 * nothing about what the money was for. Put it in the description box and it
 * gets ACCEPTED rather than corrected — a wrong answer that looks answered is
 * worse than a blank field, because the blank one gets filled in.
 *
 * Both transports already make that judgement at staging time and write it as
 * memo_display (extract.mjs `_tidy` / the .gs `_withTidyMemo`), alongside the
 * raw memo rather than over it. This screen read raw `memo` and threw the
 * judgement away.
 *
 * THE TRAP, and the reason most of these cases exist: memo_display === '' is a
 * VERDICT — "this memo says nothing" — not a missing value. The obvious
 * `x.memo_display || x.memo` inverts the whole fix, resurrecting the raw
 * auto-fill in exactly the case the tidy just rejected. Presence, not truth.
 *
 * Real function extracted from source by name, so a rename fails this rather
 * than quietly passing.
 */
// NOT 'use strict': the eval'd declaration must land in this scope.
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'js-data', '72-txn-review.js'), 'utf8');

const start = src.indexOf('function fhStagedAsCsvSource');
if (start < 0) {
  console.error('fhStagedAsCsvSource not found in 72-txn-review.js — renamed?');
  process.exit(1);
}
const end = src.indexOf('function fhStagedKind', start);
if (end < 0) {
  console.error('fhStagedKind not found — the slice boundary moved?');
  process.exit(1);
}
function L(vi) { return vi; }   // the real one is LANG-gated; only names the source
eval(src.slice(start, end));

let pass = 0, fail = 0;
const t = (n, ok, d) => { console.log((ok ? '  PASS  ' : '  FAIL  ') + n + (!ok && d ? '  -> ' + d : '')); ok ? pass++ : fail++; };

const DESC = 1;   // fhStagedAsCsvSource's column order: occurred_at, description, amount, counterparty
const PARTY = 3;

// A staged row as fhFetchStagedTxns hands it over: clear columns on the row,
// the opened payload on raw_extracted.
function row(extracted, clear) {
  return Object.assign({
    occurred_at: '2026-08-20T04:11:00Z', amount: 250, direction: 'debit',
    counterparty: null, source_provider: null,
  }, clear || {}, { raw_extracted: extracted });
}
const descOf = (r) => fhStagedAsCsvSource([r]).parsed.rows[0][DESC];

console.log('\n-- the reported bug: bank auto-fill must not pre-fill the box --');
// The exact shape stage.mjs writes for a memo the tidy judged empty.
t('p2p, auto-fill memo, memo_display "" -> blank for the human',
  descOf(row({ memo: 'NGUYEN THU TRANG chuyen tien', memo_display: '', transaction_type: 'p2p_transfer' },
             { counterparty: 'NGUYEN THU TRANG - 0912345678' })) === '',
  'raw memo or the counterparty leaked into the description');

t('the counterparty of a PERSON is still never used as the description',
  descOf(row({ memo: null, memo_display: '', transaction_type: 'p2p_transfer' },
             { counterparty: 'LE VAN HOANG - 0912345678' })) === '');

console.log('\n-- the inversion this fix is most likely to be rewritten into --');
// `x.memo_display || x.memo` passes every other case in this file and fails
// only here, which is why it gets its own test rather than a shared one.
t('memo_display "" does NOT fall back to the raw memo (card purchase)',
  descOf(row({ memo: 'THANH TOAN', memo_display: '', transaction_type: 'card_purchase' },
             { counterparty: 'QUICK SAVE MARKET' })) === 'QUICK SAVE MARKET',
  'the tidy said this memo says nothing, and it came back anyway');

t('memo_display "" does NOT fall back to the raw memo (p2p)',
  descOf(row({ memo: 'ck', memo_display: '', transaction_type: 'p2p_transfer' })) === '');

console.log('\n-- a memo someone actually typed survives --');
t('real memo, tidy kept it -> used verbatim',
  descOf(row({ memo: 'tra tien an trua thu 6', memo_display: 'tra tien an trua thu 6',
               transaction_type: 'p2p_transfer' })) === 'tra tien an trua thu 6');

t('tidy trimmed the holder name off -> the TIDIED text wins, not the raw',
  descOf(row({ memo: 'NGUYEN THU TRANG email trans live', memo_display: 'email trans live',
               transaction_type: 'p2p_transfer' })) === 'email trans live');

t('a real memo beats the counterparty on a card purchase too',
  descOf(row({ memo: 'ca phe', memo_display: 'ca phe', transaction_type: 'card_purchase' },
             { counterparty: 'HIGHLANDS COFFEE' })) === 'ca phe');

console.log('\n-- rows staged before the tidy existed keep working --');
// stage.mjs writes `?? null`, so absent and null both mean "never judged".
t('memo_display ABSENT -> raw memo, exactly as before',
  descOf(row({ memo: 'an toi', transaction_type: 'p2p_transfer' })) === 'an toi');

t('memo_display null -> raw memo, exactly as before',
  descOf(row({ memo: 'an toi', memo_display: null, transaction_type: 'p2p_transfer' })) === 'an toi');

t('memo_display absent and no memo -> counterparty, for a card purchase',
  descOf(row({ transaction_type: 'card_purchase' }, { counterparty: 'AEON MALL' })) === 'AEON MALL');

console.log('\n-- the fallbacks below the memo are untouched --');
t('no memo, no counterparty -> source_provider names the bank',
  descOf(row({ memo_display: '', transaction_type: 'card_purchase' },
             { source_provider: 'Techcombank' })) === 'Techcombank');

t('nothing at all -> blank, never undefined',
  descOf(row({ memo_display: '' }, {})) === '');

t('an empty raw_extracted does not throw',
  descOf(row(null, { counterparty: 'AEON MALL' })) === 'AEON MALL');

console.log('\n-- the rest of the row shape is unchanged --');
const shaped = fhStagedAsCsvSource([
  row({ memo: 'ca phe', memo_display: 'ca phe' }, { counterparty: 'HIGHLANDS', direction: 'debit', amount: 250 }),
  row({ memo_display: '' }, { counterparty: 'ACB', direction: 'credit', amount: 900 }),
]);
t('four columns, in the documented order',
  JSON.stringify(shaped.parsed.headers) === JSON.stringify(['occurred_at', 'description', 'amount', 'counterparty']));
t('debit is signed, credit is not',
  shaped.parsed.rows[0][2] === '-250' && shaped.parsed.rows[1][2] === '900');
t('the counterparty COLUMN still carries the party even when blank as a description',
  shaped.parsed.rows[1][PARTY] === 'ACB');
t('one row in, one row out — order preserved for fhStagedMeta',
  shaped.parsed.rows.length === 2 && shaped.parsed.rows[0][PARTY] === 'HIGHLANDS');

console.log('\n' + (fail === 0 ? 'ALL ' + pass + ' PASSED' : pass + ' passed, ' + fail + ' FAILED'));
process.exit(fail ? 1 : 0);
