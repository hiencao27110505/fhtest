#!/usr/bin/env node
/* The model as witness: derivation anchors on the model's own quote.
 * `node pipeline/witness-citation.test.js`
 *
 * Derivation's historical failure mode was never the transform — it was the
 * SEARCH: guessing which body substring a reading came from, with a scanner
 * regex and a byte-exact comparison that each new bank format defeated in a
 * new way (962b56b fixed four of those in one commit). The witness removes
 * the guess for the two MANDATORY fields: the model quotes the verbatim
 * substring it read occurred_at / amount from, and derivation trusts the
 * quote only after two checks the model cannot fake — verbatim presence in
 * the body, and one of OUR OWN transform kinds reproducing the reading from
 * it. Nothing executable comes from the model; a failed check falls through
 * to the old scan byte-for-byte.
 *
 * The cases below pin the contract's edges: the drift repair, the fallback
 * on a fabricated quote, the decoy-safety of the parse check, the untouched
 * no-citation path, and — because one client opener reads templates written
 * by BOTH transports — byte-parity between templates.mjs and the .gs twin.
 */
const fs = require('fs');
const path = require('path');

let pass = 0, fail = 0;
const t = (n, ok, d) => { console.log((ok ? '  PASS  ' : '  FAIL  ') + n + (!ok && d ? '  -> ' + d : '')); ok ? pass++ : fail++; };

// the .gs twin, loaded the way template-graduation.test.js loads it
const gsSrc = fs.readFileSync(path.join(__dirname, 'bank-email-pipeline.gs'), 'utf8');
(0, eval)(gsSrc.slice(gsSrc.indexOf('var EXTRACTION_LOGIC_VERSION'), gsSrc.indexOf('function upsertFingerprint')));
const gsDerive = globalThis.deriveExtractionTemplate;

(async () => {
const T = await import('../supabase/functions/_shared/mailbox/templates.mjs');

/* A date-only mail: the raw carries no clock, so every time-bearing kind
   fails and only the midnight kinds can reproduce it. */
const DATE_ONLY_BODY = `Số tiền
2.000.000
Ngày giao dịch
26/08/2026
Tên người hưởng
NGUYEN VAN A`;

/* What a model emits for it on a bad day: a bare date, no time, no offset —
   a shape the schema forbids but models produce, and the exact drift that
   used to kill derivation byte-exactly, forever. */
const reading = (extra) => ({
  is_transaction: true, transaction_type: 'p2p_transfer', source_provider: 'VCB',
  currency: 'VND', direction: 'debit', amount: 2000000,
  occurred_at: '2026-08-26', counterparty: 'NGUYEN VAN A',
  memo: null, reference_number: null, account_masked: null,
  ...extra,
});

console.log('\n-- A. the drift repair: a bare-date reading derives ONLY via its citation --');
t('without a citation the bare date still fails (the problem is real, not vacuous)',
  T.deriveExtractionTemplate(DATE_ONLY_BODY, reading({})) === null);
{
  const r = reading({ occurred_at_raw: '26/08/2026' });
  const tpl = T.deriveExtractionTemplate(DATE_ONLY_BODY, r);
  t('with the citation it derives', !!tpl);
  if (tpl) {
    const p = JSON.parse(tpl);
    t('the transform kind is ours, chosen by our code', p.fields.occurred_at.dt === 'dmy_slash');
    const back = T.applyExtractionTemplate(tpl, DATE_ONLY_BODY);
    t('the template reads the midnight canonical on its own body',
      back && back.occurred_at === '2026-08-26T00:00:00+07:00', back && back.occurred_at);
    t('and the reading was upgraded in place, so staged == template forever',
      r.occurred_at === '2026-08-26T00:00:00+07:00', r.occurred_at);
  }
}

console.log('\n-- B. a fabricated quote is worthless --');
t('a citation that is not verbatim in the body changes nothing (still null)',
  T.deriveExtractionTemplate(DATE_ONLY_BODY, reading({ occurred_at_raw: '31/12/2099' })) === null);

console.log('\n-- C. a wrong-but-present quote loses to the parse check --');
{
  /* Two dates in the body; the reading names the FIRST instant, the citation
     (mis)quotes the second. No kind can turn the quote into the reading, so
     the citation is ignored and the ordinary scan derives the right one. */
  const TWO_DATES = `Ngày, giờ giao dịch
26/08/2026 14:32:00
Ngày sao kê
27/08/2026
Số tiền
2.000.000
Tên người hưởng
NGUYEN VAN A`;
  const r = reading({ occurred_at: '2026-08-26T14:32:00+07:00', occurred_at_raw: '27/08/2026' });
  const tpl = T.deriveExtractionTemplate(TWO_DATES, r);
  t('derives anyway, via the scan', !!tpl);
  const back = tpl && T.applyExtractionTemplate(tpl, TWO_DATES);
  t('and anchors the TRUE instant, not the mis-quoted one',
    back && back.occurred_at === '2026-08-26T14:32:00+07:00', back && back.occurred_at);
}

console.log('\n-- D. amount_raw: currency word stripped, decoys refused --');
{
  const r = reading({ occurred_at: '2026-08-26T14:32:00+07:00' });
  const AMT_BODY = `Ngày, giờ giao dịch
26/08/2026 14:32:00
Số tiền
2.000.000
Số dư
15.345.678
Tên người hưởng
NGUYEN VAN A`;
  const withRaw = { ...r, amount_raw: '2.000.000 ₫' };
  const tpl = T.deriveExtractionTemplate(AMT_BODY, withRaw);
  t('a quote with a trailing currency word still anchors', !!tpl);
  if (tpl) t('and carries the vn parse mode our code picked',
    JSON.parse(tpl).fields.amount.num === 'vn');
  /* the balance is verbatim in the body, but it does not parse to the
     reading's amount — the citation is refused, the candidates loop wins */
  const decoy = { ...r, amount_raw: '15.345.678' };
  const tpl2 = T.deriveExtractionTemplate(AMT_BODY, decoy);
  const back2 = tpl2 && T.applyExtractionTemplate(tpl2, AMT_BODY);
  t('a decoy quote (the balance) is refused by the parse check',
    back2 && back2.amount === 2000000, back2 && String(back2.amount));
}

console.log('\n-- E. no citation: the old path, byte-for-byte --');
{
  const GOOD = `Ngày, giờ giao dịch
26/08/2026 14:32:00
Số tiền
2.000.000
Tên người hưởng
NGUYEN VAN A`;
  const r = reading({ occurred_at: '2026-08-26T14:32:00+07:00' });
  const tpl = T.deriveExtractionTemplate(GOOD, r);
  t('a citation-less reading still derives', !!tpl);
  if (tpl) {
    const p = JSON.parse(tpl);
    const keys = new Set([].concat(Object.keys(p.fields.occurred_at), Object.keys(p.fields.amount)));
    t('the template format is unchanged — no citation artifact is stored',
      [...keys].every(k => ['re', 'dt', 'off', 'num'].includes(k)), [...keys].join(','));
    t('so EXTRACTION_LOGIC_VERSION needs no bump (v' + p.v + ' applies it fine)',
      T.applyExtractionTemplate(tpl, GOOD) !== null);
  }
}

console.log('\n-- F. the .gs twin agrees byte-for-byte --');
{
  const rM = reading({ occurred_at_raw: '26/08/2026' });
  const rG = reading({ occurred_at_raw: '26/08/2026' });
  const a = T.deriveExtractionTemplate(DATE_ONLY_BODY, rM);
  const b = gsDerive(DATE_ONLY_BODY, rG);
  t('drift-repair template identical across transports', !!a && a === b);
  t('and both upgraded their reading identically', rM.occurred_at === rG.occurred_at);
  const AMT_BODY2 = `Ngày, giờ giao dịch
26/08/2026 14:32:00
Số tiền
266,320
Tên người hưởng
NGUYEN VAN A`;
  const mk = () => reading({ occurred_at: '2026-08-26T14:32:00+07:00', amount: 266320, amount_raw: '266,320 VND' });
  const a2 = T.deriveExtractionTemplate(AMT_BODY2, mk());
  const b2 = gsDerive(AMT_BODY2, mk());
  t('amount-citation template identical across transports', !!a2 && a2 === b2);
}

console.log('\n' + (fail === 0 ? 'ALL ' + pass + ' PASSED' : pass + ' passed, ' + fail + ' FAILED'));
process.exit(fail ? 1 : 0);
})();
