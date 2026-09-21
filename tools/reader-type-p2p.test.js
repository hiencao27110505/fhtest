#!/usr/bin/env node
/* "Leave the description blank for a transfer to a person" must be able to fire
 * on an EMAIL row.  `node tools/reader-type-p2p.test.js`
 *
 * The rule has been in the review since the day the description box stopped
 * being pre-filled with "LE VAN A - 0900000000": a person's name answers "who",
 * not "what for". It tested the sealed `transaction_type === 'p2p_transfer'`.
 * But on an email row that field is derived from the SENDER's kind (stage.mjs),
 * so it only ever reads bank_txn or ecommerce_receipt, and the rule was dead on
 * exactly the rows it was written for (email-reading-v2-spec §2, §15 fix 2).
 *
 * The server now seals the reader's own verdict beside it, inside raw_extracted:
 * `reader_type`, plus `sender_kind` and `counterparty_raw`. The two description
 * rules (72's fhStagedAsCsvSource, 76's _qrDesc) ask reader_type first.
 *
 * What this pins:
 *   - the new keys survive fhReadStagedRow's flattening, in BOTH sealed shapes;
 *   - a row sealed before they existed behaves exactly as it did;
 *   - `transaction_type` keeps its meaning for the one other reader that turns
 *     on it, the bank-vs-receipt duplicate rule. reader_type must never leak
 *     into that: a wallet receipt about a p2p transfer is still not a bank.
 *
 * Real functions extracted from source by name.
 */
// NOT 'use strict': the eval'd declarations must land in this scope.
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const src72 = fs.readFileSync(path.join(ROOT, 'src/js-data/72-txn-review.js'), 'utf8');
const src76 = fs.readFileSync(path.join(ROOT, 'src/js-data/76-quick-review.js'), 'utf8');
const src58 = fs.readFileSync(path.join(ROOT, 'src/js-ui/58-dedup-engine.js'), 'utf8');

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
eval(grab(src72, 'async function fhReadStagedRow('));
// _BANK_GENERIC_MEMOS .. fhStagedKindById: the description rule, and the kind rule beside it.
eval(src72.slice(src72.indexOf('var _BANK_GENERIC_MEMOS'), src72.indexOf('function fhStagedKindById')));
eval(grab(src76, 'function _qrDesc('));

let pass = 0, fail = 0;
const t = (n, ok, d) => { console.log((ok ? '  PASS  ' : '  FAIL  ') + n + (!ok && d !== undefined ? '  -> ' + JSON.stringify(d) : '')); ok ? pass++ : fail++; };

const DESC = 1;
const descOf = (r) => fhStagedAsCsvSource([r]).parsed.rows[0][DESC];
const PERSON = 'LE VAN TEST - 0900000000';
const staged = (extracted, clear) => Object.assign({
  occurred_at: '2026-08-20T04:11:00Z', amount: 250000, direction: 'debit', counterparty: PERSON, source_provider: 'TESTBANK',
}, clear || {}, { raw_extracted: extracted });

(async () => {
  console.log('\n-- the new keys survive the flattening --');
  {
    window.DB = { fid: 'fam-1' };
    window.fhStagingPrivKey = async () => 'priv';
    // direct read NESTS the detail under raw_extracted (stage.mjs)
    const nested = { amount: 250000, currency: 'VND', direction: 'debit', counterparty: PERSON,
      raw_extracted: { memo: null, memo_display: '', transaction_type: 'bank_txn', _transport: 'oauth_direct',
        reader_type: 'p2p_transfer', sender_kind: 'bank', counterparty_raw: 'LE VAN TEST 0900000000 TESTBANK' } };
    window.fhStagingOpenRow = () => nested;
    let r = await fhReadStagedRow({ id: 'r1', sealed: 'x', occurred_at: '2026-08-20T04:11:00Z', source_provider: 'TESTBANK' });
    t('nested shape: reader_type, sender_kind and counterparty_raw are all on raw_extracted',
      r.raw_extracted.reader_type === 'p2p_transfer' && r.raw_extracted.sender_kind === 'bank'
      && r.raw_extracted.counterparty_raw === 'LE VAN TEST 0900000000 TESTBANK', r.raw_extracted);
    t('...and transaction_type is still what the server derived', r.raw_extracted.transaction_type === 'bank_txn');
    t('...and the opened row now reads as a person: description left blank', descOf(r) === '', descOf(r));

    // forwarding spreads the same fields FLAT into the payload
    const flat = { amount: 250000, currency: 'VND', direction: 'debit', counterparty: PERSON, memo_display: '',
      transaction_type: 'bank_txn', reader_type: 'p2p_transfer', sender_kind: 'bank', counterparty_raw: 'raw' };
    window.fhStagingOpenRow = () => flat;
    r = await fhReadStagedRow({ id: 'r2', sealed: 'x', occurred_at: '2026-08-20T04:11:00Z', source_provider: 'TESTBANK' });
    t('flat shape: the same three keys', r.raw_extracted.reader_type === 'p2p_transfer'
      && r.raw_extracted.sender_kind === 'bank' && r.raw_extracted.counterparty_raw === 'raw', r.raw_extracted);

    // a row sealed before any of this
    const old = { amount: 250000, currency: 'VND', direction: 'debit', counterparty: 'SYNTHETIC MART',
      raw_extracted: { memo: null, memo_display: '', transaction_type: 'bank_txn' } };
    window.fhStagingOpenRow = () => old;
    r = await fhReadStagedRow({ id: 'r3', sealed: 'x', occurred_at: '2026-08-20T04:11:00Z', source_provider: 'TESTBANK' });
    t('an old row: no key is invented', !('reader_type' in r.raw_extracted) && !('sender_kind' in r.raw_extracted), r.raw_extracted);
    t('an old row: described by its counterparty, exactly as before', descOf(r) === 'SYNTHETIC MART', descOf(r));
  }

  console.log('\n-- the full review: fhStagedAsCsvSource --');
  t('reader_type p2p on a bank-sender row -> blank (the case that could never fire)',
    descOf(staged({ memo_display: '', transaction_type: 'bank_txn', reader_type: 'p2p_transfer' })) === '');
  t('a memo someone typed still wins on that row',
    descOf(staged({ memo: 'tra tien an trua', memo_display: 'tra tien an trua', transaction_type: 'bank_txn', reader_type: 'p2p_transfer' })) === 'tra tien an trua');
  t('reader_type bank_txn -> the counterparty describes it, as a purchase always has',
    descOf(staged({ memo_display: '', transaction_type: 'bank_txn', reader_type: 'bank_txn' }, { counterparty: 'SYNTHETIC MART' })) === 'SYNTHETIC MART');
  t('reader_type null falls back to transaction_type (a statement row writes p2p itself)',
    descOf(staged({ memo_display: '', transaction_type: 'p2p_transfer', reader_type: null })) === '');
  t('no reader_type at all, transaction_type p2p -> blank, as before',
    descOf(staged({ memo_display: '', transaction_type: 'p2p_transfer' })) === '');
  t('no reader_type at all, transaction_type bank_txn -> counterparty, as before',
    descOf(staged({ memo_display: '', transaction_type: 'bank_txn' })) === PERSON);

  console.log('\n-- the quick sheet: _qrDesc makes the same call --');
  t('reader_type p2p -> blank', _qrDesc({ memo_display: '', transaction_type: 'bank_txn', reader_type: 'p2p_transfer', counterparty: PERSON }) === '');
  t('old row, bank_txn -> counterparty, as before', _qrDesc({ memo_display: '', transaction_type: 'bank_txn', counterparty: PERSON }) === PERSON);
  t('old row, p2p_transfer -> blank, as before', _qrDesc({ memo_display: '', transaction_type: 'p2p_transfer', counterparty: PERSON }) === '');
  t('a typed memo still wins', _qrDesc({ memo: 'x', memo_display: 'tien nuoc', reader_type: 'p2p_transfer', counterparty: PERSON }) === 'tien nuoc');

  console.log('\n-- transaction_type keeps its meaning for the duplicate rule --');
  t('a bank sender is a bank, whatever the reader thought the row was',
    fhStagedKind({ raw_extracted: { transaction_type: 'bank_txn', reader_type: 'ecommerce_receipt' } }) === 'bank');
  t('a wallet receipt about a p2p transfer is still NOT a bank',
    fhStagedKind({ raw_extracted: { transaction_type: 'ecommerce_receipt', reader_type: 'p2p_transfer' } }) === 'other');
  t('the dedup engine does not read reader_type', !/reader_type/.test(src58));

  console.log('\n' + (fail === 0 ? 'ALL ' + pass + ' PASSED' : pass + ' passed, ' + fail + ' FAILED'));
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
