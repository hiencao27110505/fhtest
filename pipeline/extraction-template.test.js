#!/usr/bin/env node
/* Template derivation must not silently drop fields.  `node pipeline/extraction-template.test.js`
 *
 * The bug this exists for: deriveExtractionTemplate anchored only
 * ['counterparty','reference_number','account_masked'] and verified only a key
 * list that also omitted `memo`. So the derived template dropped the memo AND
 * still passed its own "reproduces the LLM's extraction exactly" proof — a
 * verification that does not cover a field cannot protect it.
 *
 * The effect was invisible in the obvious place: the FIRST email from a sender
 * goes through the LLM and keeps its memo, so a spot check looks fine. Every
 * email after it is parsed by the stored template and has no memo at all — on
 * the path README.md says carries most volume, permanently. memo is the only
 * field carrying WHY the money moved.
 */
// NOT 'use strict': the suites here eval() functions out of the .gs, and strict
// mode scopes those declarations to the eval instead of leaking them here.
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, 'bank-email-pipeline.gs'), 'utf8');
global.Logger = { log: () => {} };

// Stage-1 template machinery: constants through the end of derivation/application.
eval(src.slice(src.indexOf('var EXTRACTION_LOGIC_VERSION'),
                src.indexOf('// ---------- Stage 2 helpers ----------')));

let pass = 0, fail = 0;
const t = (n, ok, d) => { console.log((ok ? '  PASS  ' : '  FAIL  ') + n + (!ok && d ? '  -> ' + d : '')); ok ? pass++ : fail++; };

/* A Vietcombank-shaped receipt, reduced to the fields that matter. The memo is
   the real thing VCB writes into "Nội dung chuyển tiền". */
const BODY_1 = [
  'Ngay, gio giao dich 2026-08-13 23:49:00',
  'So lenh giao dich 15569404547',
  'Tai khoan nguon 1046382279',
  'Ten nguoi huong CAO THAI DUY HIEN',
  'So tien 10,000 VND',
  'Noi dung chuyen tien CAO THAI DUY HIEN chuyen tien',
].join('\n');

const EXTRACTION_1 = {
  is_transaction: true,
  transaction_type: 'p2p_transfer',
  source_provider: 'Vietcombank',
  occurred_at: '2026-08-13T23:49:00+07:00',
  amount: 10000,
  currency: 'VND',
  direction: 'debit',
  counterparty: 'CAO THAI DUY HIEN',
  reference_number: '15569404547',
  status: null,
  account_masked: '1046382279',
  memo: 'CAO THAI DUY HIEN chuyen tien',
};

const tpl = deriveExtractionTemplate(BODY_1, EXTRACTION_1);
t('a template is derived from a memo-bearing email', !!tpl, String(tpl));

if (tpl) {
  const back = applyExtractionTemplate(tpl, BODY_1);
  t('applying it round-trips', !!back);
  t('THE MEMO SURVIVES the template path', back && back.memo === EXTRACTION_1.memo,
    back ? JSON.stringify(back.memo) : 'no output');
  t('counterparty still survives', back && back.counterparty === EXTRACTION_1.counterparty);
  t('amount still survives', back && String(back.amount) === String(EXTRACTION_1.amount));

  // The real payoff: a SECOND email from the same sender, different values.
  const BODY_2 = BODY_1
    .replace('15569404547', '15569404548')
    .replace('10,000', '250,000')
    .replace('CAO THAI DUY HIEN chuyen tien', 'tra tien an trua thu 6');
  const second = applyExtractionTemplate(tpl, BODY_2);
  t('a later email parses locally with no LLM', !!second);
  t('and carries ITS OWN memo, not the first one', second && second.memo === 'tra tien an trua thu 6',
    second ? JSON.stringify(second.memo) : 'no output');
}

/* A memo-less email must still derive — plenty of card-purchase notifications
   have a merchant and no memo at all, and those senders should keep their
   zero-LLM path rather than being pushed to the LLM forever. */
const BODY_CARD = [
  'MB TK cham x5249',
  'Ngay, gio giao dich 2026-08-13 14:54:18',
  'Diem giao dich REVI PHU MY HUNG TOWER',
  'So tien -35,000 VND',
].join('\n');
const EXTRACTION_CARD = {
  is_transaction: true, transaction_type: 'card_purchase', source_provider: 'MB Bank',
  occurred_at: '2026-08-13T14:54:18+07:00', amount: 35000, currency: 'VND', direction: 'debit',
  counterparty: 'REVI PHU MY HUNG TOWER', reference_number: null, status: null,
  account_masked: 'x5249', memo: null,
};
const tplCard = deriveExtractionTemplate(BODY_CARD, EXTRACTION_CARD);
t('a memo-less sender still gets a template (keeps its zero-LLM path)', !!tplCard, String(tplCard));
if (tplCard) {
  const backCard = applyExtractionTemplate(tplCard, BODY_CARD);
  t('memo stays null rather than becoming a stale constant', backCard && !backCard.memo,
    backCard ? JSON.stringify(backCard.memo) : 'no output');
  t('the merchant is what fills the description for these', backCard && backCard.counterparty === 'REVI PHU MY HUNG TOWER');
}

/* Date-only banks. VCB and VIB print "Ngày giao dịch: 26/08/2026" with no clock
   time, so the date+time anchors never held, no template ever derived, and every
   one of those banks' mails went to the model forever — the single biggest reason
   VIB/VCB (85% of real volume) never learned a template while MB, which stamps a
   full timestamp, did. */
const BODY_DATEONLY = [
  'Ten nguoi huong NGUYEN VAN B',
  'So tien -500,000 VND',
  'Noi dung tra tien an trua',
  'Ngay giao dich 26/08/2026',
].join('\n');
const EXTRACTION_DATEONLY = {
  is_transaction: true, transaction_type: 'p2p_transfer', source_provider: 'Vietcombank',
  occurred_at: '2026-08-26T00:00:00+07:00', amount: -500000, currency: 'VND', direction: 'debit',
  counterparty: 'NGUYEN VAN B', reference_number: null, status: null,
  account_masked: null, memo: 'tra tien an trua',
};
const tplDate = deriveExtractionTemplate(BODY_DATEONLY, EXTRACTION_DATEONLY);
t('a date-only email (no clock time) still derives a template', !!tplDate, String(tplDate));
if (tplDate) {
  const backD = applyExtractionTemplate(tplDate, BODY_DATEONLY);
  t('its occurred_at round-trips to midnight',
    backD && backD.occurred_at === '2026-08-26T00:00:00+07:00',
    backD ? JSON.stringify(backD.occurred_at) : 'no output');
  const BODY_DATEONLY_2 = BODY_DATEONLY
    .replace('26/08/2026', '27/08/2026')
    .replace('500,000', '120,000')
    .replace('NGUYEN VAN B', 'TRAN THI C')
    .replace('tra tien an trua', 'tra tien dien');
  const secondD = applyExtractionTemplate(tplDate, BODY_DATEONLY_2);
  t('a later date-only email parses locally with no LLM (different date/amount/name)',
    !!secondD && secondD.occurred_at === '2026-08-27T00:00:00+07:00' && secondD.counterparty === 'TRAN THI C',
    secondD ? JSON.stringify(secondD.occurred_at + ' / ' + secondD.counterparty) : 'no output');
}

/* A body that DOES carry a time still anchors the exact time — the date-only
   kinds are tried last, so they must not shadow a real clock. */
const tplTimed = deriveExtractionTemplate(BODY_1, EXTRACTION_1);
t('a timed email still anchors its exact time, not midnight',
  !!tplTimed && applyExtractionTemplate(tplTimed, BODY_1).occurred_at === '2026-08-13T23:49:00+07:00');

/* Version gate: bumping EXTRACTION_LOGIC_VERSION must retire templates derived
   by the older, memo-dropping logic rather than letting them live forever. */
const stale = JSON.parse(tpl || '{}');
stale.v = EXTRACTION_LOGIC_VERSION - 1;
t('a template from the previous logic version is refused',
  applyExtractionTemplate(JSON.stringify(stale), BODY_1) === null);

console.log('\n' + (fail === 0 ? 'ALL ' + pass + ' PASSED' : pass + ' passed, ' + fail + ' FAILED'));
process.exit(fail ? 1 : 0);
