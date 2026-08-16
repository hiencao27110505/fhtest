// Parity + behaviour tests for pipeline/lib/extract.js (the Node port used by
// the direct-read OAuth path) against pipeline/bank-email-pipeline.gs (the
// deployed forwarding pipeline).
//
// Two implementations of one algorithm will drift. This file makes drift fail
// loudly instead of silently mis-parsing real bank mail: it evals the .gs's
// pure functions in-process (same trick as sender-auth.test.js) and runs both
// against the same inputs.
//
// Run: node pipeline/lib-extract.test.js

const fs = require('fs');
const path = require('path');
const lib = require('./lib/extract.js');

const src = fs.readFileSync(path.join(__dirname, 'bank-email-pipeline.gs'), 'utf8');

// ── load the .gs pure functions (no Apps Script APIs in any of these) ────────
const slice = (from, to) => src.slice(src.indexOf(from), src.indexOf(to));
eval(slice('var FAKE_NAMES', 'function classifyAndExtractViaHaiku'));   // masking + prompt + schema
eval(slice('function stripNullsForGemini', '// ---------- Extraction templates'));
eval(slice('var EXTRACTION_LOGIC_VERSION', 'function upsertFingerprint'));  // template engine
eval(slice('function normalizeSubjectTemplate', 'function relabelMessageThread'));

let pass = 0, fail = 0;
const t = (n, ok, d) => { console.log((ok ? '  PASS  ' : '  FAIL  ') + n + (!ok && d ? '  -> ' + d : '')); ok ? pass++ : fail++; };
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// Deterministic rng so the port's masking output is reproducible. The .gs uses
// Math.random directly, so cross-implementation comparison is done on
// STRUCTURE (which spans got masked) and on the unmask round-trip, not on the
// random digits themselves.
function seeded(seed) {
  let s = seed;
  return () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
}

// A real-shaped MB Bank debit notification (values are synthetic).
const BODY = [
  'Ngan hang TMCP Quan Doi tran trong thong bao:',
  'So tai khoan: 0123456789',
  'So tien: 250,000 VND',
  'Thoi gian: 12-08-2026 14:32:07',
  'Noi dung chuyen tien: NGUYEN THU TRANG chuyen tien an trua',
  'Nguoi thu huong: TRAN VAN BAO 9704221234567890',
  'So tham chieu: FT26224987654321',
  'So du: 1,750,000 VND',
].join('\n');

const EXTRACTION = {
  is_transaction: true,
  transaction_type: 'p2p_transfer',
  source_provider: 'MB Bank',
  occurred_at: '2026-08-12T14:32:07+07:00',
  amount: 250000,
  currency: 'VND',
  direction: 'debit',
  counterparty: 'TRAN VAN BAO 9704221234567890',
  memo: 'NGUYEN THU TRANG chuyen tien an trua',
  reference_number: 'FT26224987654321',
  status: null,
  account_masked: '0123456789',
};

console.log('\n-- masking: the invariant that must never relax --');
{
  const m = lib.maskForSharing(BODY, seeded(7));
  t('no real amount survives', m.text.indexOf('250,000') === -1);
  t('no real account number survives', m.text.indexOf('0123456789') === -1);
  t('no real reference survives', m.text.indexOf('FT26224987654321') === -1 || !/26224987654321/.test(m.text));
  t('no real personal name survives', m.text.indexOf('NGUYEN THU TRANG') === -1);
  t('date/time span is preserved verbatim (extraction needs it)', m.text.indexOf('12-08-2026 14:32:07') !== -1);
  t('institutional caps are NOT masked (VND stays VND)', m.text.indexOf('VND') !== -1);

  const em = lib.maskForSharing('contact me at trang.nguyen@gmail.com please', seeded(3));
  t('email addresses are masked', em.text.indexOf('trang.nguyen@gmail.com') === -1 && /@example\.com/.test(em.text));
}

console.log('\n-- masking: same behaviour as the deployed .gs --');
{
  // Structural comparison: both implementations must mask the SAME spans, even
  // though the substituted digits differ (both draw from Math.random/rng).
  const mine = lib.maskForSharing(BODY, seeded(11));
  const theirs = maskForSharing(BODY);
  const originals = (m) => m.pairs.map((p) => p.original).sort();
  t('identical set of masked spans', eq(originals(mine), originals(theirs)),
    JSON.stringify({ mine: originals(mine), theirs: originals(theirs) }));
  t('identical numMap arity', Object.keys(mine.numMap).length === Object.keys(theirs.numMap).length);
  t('same masked-text shape (digits differ, structure does not)',
    mine.text.replace(/\d/g, '#') === theirs.text.replace(/\d/g, '#'));
}

console.log('\n-- unmask: round-trips, and matches .gs exactly on one mask --');
{
  const m = lib.maskForSharing(BODY, seeded(5));
  // Build the LLM's-eye-view extraction: the masked values it would have read.
  const maskedOf = (orig) => { const p = m.pairs.find((x) => x.original === orig); return p ? p.masked : orig; };
  const asLlmSaw = {
    counterparty: maskedOf('TRAN VAN BAO') + ' ' + maskedOf('9704221234567890'),
    reference_number: 'FT' + maskedOf('26224987654321'),
    amount: parseFloat(maskedOf('250,000').replace(/,/g, '')),
    memo: maskedOf('NGUYEN THU TRANG') + ' chuyen tien an trua',
  };
  const mine = lib.unmaskExtraction(asLlmSaw, m);
  const theirs = unmaskExtraction(asLlmSaw, m);   // same mask object, so must agree exactly
  t('port and .gs agree byte-for-byte on the same mask', eq(mine, theirs), JSON.stringify({ mine, theirs }));
  t('real counterparty is restored', mine.counterparty === 'TRAN VAN BAO 9704221234567890', mine.counterparty);
  t('real amount is restored as a number', mine.amount === 250000, String(mine.amount));
  t('real name inside memo is restored', mine.memo === 'NGUYEN THU TRANG chuyen tien an trua', mine.memo);
}

console.log('\n-- fingerprint key: must be byte-identical or the shared cache splits --');
{
  const subjects = [
    'MB Bank: Bien dong so du #FT26224987654321',
    'Thong bao giao dich 12/08/2026',
    'Receipt from Anthropic August 4, 2026',
    'Bien dong so du TK 0123456789',
    '   spaced   out   subject   ',
  ];
  let allSame = true;
  for (const s of subjects) {
    if (lib.normalizeSubjectTemplate(s) !== normalizeSubjectTemplate(s)) {
      allSame = false;
      t('subject template mismatch for: ' + s, false,
        JSON.stringify({ mine: lib.normalizeSubjectTemplate(s), theirs: normalizeSubjectTemplate(s) }));
    }
  }
  t('all subject templates identical to the .gs', allSame);
}

console.log('\n-- Gemini schema conversion matches the .gs --');
{
  t('identical converted schema', eq(lib.schemaForGemini(lib.EXTRACTION_SCHEMA), stripNullsForGemini(EXTRACTION_SCHEMA)));
  t('prompt is character-identical', lib.EXTRACTION_SYSTEM_PROMPT === EXTRACTION_SYSTEM_PROMPT);
}

console.log('\n-- templates: the port reproduces the extraction it was derived from --');
let mineTpl = null;
{
  mineTpl = lib.deriveTemplate(BODY, EXTRACTION);
  t('derives a template from a real-shaped body', !!mineTpl);
  const applied = lib.applyTemplate(mineTpl, BODY);
  t('reproduces amount', applied && applied.amount === 250000, applied && String(applied.amount));
  t('reproduces occurred_at with offset', applied && applied.occurred_at === '2026-08-12T14:32:07+07:00', applied && applied.occurred_at);
  t('reproduces counterparty', applied && applied.counterparty === EXTRACTION.counterparty, applied && applied.counterparty);
  t('reproduces reference_number', applied && applied.reference_number === EXTRACTION.reference_number);
  t('CAPTURES MEMO — the whole point of v4', applied && applied.memo === EXTRACTION.memo, applied && String(applied.memo));
}

console.log('\n-- templates: the .gs now captures memo too (fixed 2026-08-14) --');
{
  const theirTpl = deriveExtractionTemplate(BODY, EXTRACTION);
  t('.gs also derives a template', !!theirTpl);
  const theirApplied = theirTpl && applyExtractionTemplate(theirTpl, BODY);
  t('.gs reproduces amount too', theirApplied && theirApplied.amount === 250000);
  t('.gs template NOW carries memo', theirApplied && theirApplied.memo === EXTRACTION.memo,
    JSON.stringify(theirApplied && theirApplied.memo));
  t('both sides agree on the template version', EXTRACTION_LOGIC_VERSION === lib.TEMPLATE_VERSION,
    'gs=' + EXTRACTION_LOGIC_VERSION + ' lib=' + lib.TEMPLATE_VERSION);
  console.log('        ^ was the live defect: 72-txn-review.js uses memo as the row');
  console.log('          description, so template-parsed transfers reached review blank.');
}

console.log('\n-- templates: generalise to the NEXT email of the same shape --');
{
  const NEXT = BODY
    .replace('250,000', '80,000')
    .replace('12-08-2026 14:32:07', '13-08-2026 09:05:11')
    .replace('TRAN VAN BAO 9704221234567890', 'LE THI MAI 9704229876543210')
    .replace('FT26224987654321', 'FT26225123456789')
    .replace('NGUYEN THU TRANG chuyen tien an trua', 'NGUYEN THU TRANG tra tien dien');
  const a = lib.applyTemplate(mineTpl, NEXT);
  t('parses a different email locally, zero LLM', !!a);
  t('new amount', a && a.amount === 80000, a && String(a.amount));
  t('new timestamp', a && a.occurred_at === '2026-08-13T09:05:11+07:00', a && a.occurred_at);
  t('new counterparty', a && a.counterparty === 'LE THI MAI 9704229876543210', a && a.counterparty);
  t('new memo — the reviewer sees why the money moved', a && a.memo === 'NGUYEN THU TRANG tra tien dien', a && String(a.memo));
}

console.log('\n-- templates: refuse rather than silently mis-parse --');
{
  const DIFFERENT = 'Completely different email structure\nAmount due: 99 USD\nThanks';
  t('structurally different email is refused (falls back to LLM)', lib.applyTemplate(mineTpl, DIFFERENT) === null);
  t('legacy placeholder string is refused', lib.applyTemplate('some-old-regex-string', BODY) === null);
  t('unknown future version is refused', lib.applyTemplate(JSON.stringify({ v: 99, static: {}, fields: {} }), BODY) === null);
  t('non-transaction never derives', lib.deriveTemplate(BODY, { is_transaction: false }) === null);
}

console.log('\n-- version interop: the two pipelines share one table --');
{
  const theirTpl = deriveExtractionTemplate(BODY, EXTRACTION);
  t('port applies a .gs template', !!lib.applyTemplate(theirTpl, BODY));
  t('...and gets the memo from it', lib.applyTemplate(theirTpl, BODY).memo === EXTRACTION.memo);
  t('.gs applies a port template', !!applyExtractionTemplate(mineTpl, BODY));
  t('...and gets the same amount', applyExtractionTemplate(mineTpl, BODY).amount === 250000);
  console.log('        ^ both sides are v4, so templates are mutually usable and');
  console.log('          neither re-derives over the other.');

  // Pre-fix templates are still in the table; they must keep working. A real v3
  // has no memo capture at all — that was the defect — so build it that way
  // rather than relabelling a v4, which would not exercise the same path.
  const v3 = (() => {
    const o = JSON.parse(mineTpl);
    o.v = 3;
    delete o.fields.memo;
    delete o.static.memo;
    return JSON.stringify(o);
  })();
  t('a stale v3 template still applies', !!lib.applyTemplate(v3, BODY));
  t('...reporting memo as explicitly null, not missing', lib.applyTemplate(v3, BODY).memo === null);
  t('...and is safe to replace (both sides re-derive v3 anyway)', lib.shouldStoreTemplate(v3) === true);

  t('may overwrite our own v4', lib.shouldStoreTemplate(mineTpl) === true);
  t('may store when none exists', lib.shouldStoreTemplate(null) === true);
  t('may store over a legacy placeholder', lib.shouldStoreTemplate('old-regex') === true);

  // The guard that still matters: never clobber a version we do not understand.
  const future = JSON.stringify(Object.assign(JSON.parse(mineTpl), { v: 99 }));
  t('REFUSES to overwrite a future version', lib.shouldStoreTemplate(future) === false);
  console.log('        ^ if the .gs is ever bumped ahead of this file, overwriting its');
  console.log('          templates is how both sides start calling the LLM forever.');
}

console.log('\n-- memo policy: required for p2p, optional elsewhere --');
{
  // memo present in the extraction but absent from the body → unanchorable.
  const ghost = Object.assign({}, EXTRACTION, { memo: 'text that is not in the body at all' });
  t('p2p transfer refuses the template rather than lose memo', lib.deriveTemplate(BODY, ghost) === null);

  const CARD = [
    'Anthropic receipt',
    'Amount: 20.00 USD',
    'Date: 2026-08-12 10:00:00',
    'Description: Claude Pro',
  ].join('\n');
  const cardEx = {
    is_transaction: true, transaction_type: 'subscription', source_provider: 'Anthropic',
    occurred_at: '2026-08-12T10:00:00+07:00', amount: 20, currency: 'USD', direction: 'debit',
    counterparty: null, memo: 'a memo that does not appear verbatim', reference_number: null,
    status: null, account_masked: null,
  };
  const tpl = lib.deriveTemplate(CARD, cardEx);
  t('subscription still templates without an anchorable memo', !!tpl);
  const ap = tpl && lib.applyTemplate(tpl, CARD);
  t('...and says memo is null rather than inventing one', ap && ap.memo === null);
}

console.log('\n' + (fail === 0 ? 'ALL ' + pass + ' PASSED' : pass + ' passed, ' + fail + ' FAILED'));
process.exit(fail ? 1 : 0);
