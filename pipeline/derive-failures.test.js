#!/usr/bin/env node
/* A shape that cannot learn a template must SAY WHY, at runtime.
 * `node pipeline/derive-failures.test.js`
 *
 * THE GAP THIS CLOSES. 16 of 18 transaction shapes had `extraction_regex` null
 * — derivation failing on every mail, so each paid a model call per MAIL
 * forever — and the only symptom anyone saw was "the backfill is slow". Every
 * exit in deriveExtractionTemplate was a bare `return null`, indistinguishable
 * from the other five and from success-with-no-template, recorded nowhere.
 * Diagnosing it took two days, five real mail bodies and hand bisection; the
 * step name would have taken a query.
 *
 * The contract pinned here:
 *   • the failing STEP reaches the recorder, with the shape's cache key
 *   • never a VALUE — not an amount, counterparty, account or memo. The step
 *     is diagnosis; the value is PII, and this table lives in plaintext beside
 *     `extract_miss_labels`, which was found holding transaction amounts, a
 *     person's name and cinema seat numbers under a comment promising values
 *     never leave the mail
 *   • a recorder that THROWS costs nothing — instrumenting a failure must
 *     never create one
 *   • a shape that succeeds records no failure at all
 */
const ROOT = '../supabase/functions/_shared/mailbox/';
const R = await import(ROOT + 'extract.mjs');
const T = await import(ROOT + 'templates.mjs');

let pass = 0, fail = 0;
const t = (n, ok, d) => { console.log((ok ? '  PASS  ' : '  FAIL  ') + n + (!ok && d ? '  -> ' + d : '')); ok ? pass++ : fail++; };

/* A mail the label table reads, whose memo the model reports but which is NOT
   in the body — so anchoring fails at exactly one known step. */
const BODY = ['MB TK cham', 'x5249', 'Ngay, gio giao dich', '2026-08-25 18:52:04',
  'Diem giao dich', 'GS25 NGUYEN VAN LINH', 'So tien', '-37,000 VND'].join('\n');

console.log('\n-- the deriver names its own failing step --');
const seen = [];
const READING = {
  is_transaction: true, transaction_type: 'ecommerce_receipt', source_provider: 'MB Bank',
  occurred_at: '2026-08-25T18:52:04+07:00', amount: 37000, currency: 'VND', direction: 'debit',
  counterparty: 'GS25 NGUYEN VAN LINH', reference_number: null, status: null,
  account_masked: null, memo: 'typed by a human, never printed in this mail',
};
t('derivation fails', T.deriveExtractionTemplate(BODY, READING, (s) => seen.push(s)) === null);
t('and names the step — absent, not merely unanchorable', seen.length === 1 && seen[0] === 'absent:memo', JSON.stringify(seen));

console.log('\n-- sub-steps: the failure names its sub-cause, still no values --');
{
  const vnGrouped = ['So tien | 1.234.567 VND', 'Ngay, gio giao dich | 2026-08-25 18:52:04', 'X | y'].join('\n');
  const r1 = { is_transaction: true, transaction_type: 'bank_txn', source_provider: 'X',
    occurred_at: '2026-08-25T18:52:04+07:00', amount: 7654321, currency: 'VND', direction: 'debit',
    counterparty: null, reference_number: null, status: null, account_masked: null, memo: null };
  let s1 = null; T.deriveExtractionTemplate(vnGrouped, r1, (x) => s1 = x);
  t('a number the body never prints -> amount:absent', s1 === 'amount:absent', s1);

  const noDate = ['So tien | 37,000 VND', 'Khi nao | hom qua luc chieu', 'X | y'].join('\n');
  const r2 = { ...r1, amount: 37000 };
  let s2 = null; T.deriveExtractionTemplate(noDate, r2, (x) => s2 = x);
  t('no date-shaped text at all -> date:no_candidate', s2 === 'date:no_candidate', s2);

  const oddFormat = ['So tien | 37,000 VND', 'Ngay | 2026/08/25 18:52', 'X | y'].join('\n');
  let s3 = null; T.deriveExtractionTemplate(oddFormat, r2, (x) => s3 = x);
  t('a date the kinds cannot reproduce -> date:format', s3 === 'date:format', s3);
}

console.log('\n-- a success records nothing --');
const ok = [];
const good = { ...READING, memo: null };
t('derives', !!T.deriveExtractionTemplate(BODY, good, (s) => ok.push(s)));
t('no failure recorded', ok.length === 0, JSON.stringify(ok));

console.log('\n-- readTransaction reports the step, with the shape\'s cache key --');
const calls = [];
const mkDb = (rec) => ({
  fingerprint: async () => null, saveFingerprint: async () => {}, bumpReadTally: async () => {},
  recordDeriveFailure: rec,
});
/* Drive TIER 2 — the model path, where all 16 stuck shapes fail. The model
   reports a memo that is not in the body, so anchoring fails at exactly one
   known step while the row itself still stages. */
const modelReading = {
  is_transaction: true, transaction_type: 'ecommerce_receipt', source_provider: 'MB Bank',
  occurred_at: '2026-08-25T18:52:04+07:00', amount: 37000, currency: 'VND', direction: 'debit',
  counterparty: 'GS25 NGUYEN VAN LINH', reference_number: null, status: null,
  account_masked: null, memo: 'typed by a human, never printed in this mail',
};
const modelDeps = {
  llm: { apiKey: '<REDACTED-TEST-KEY>' },
  fetch: async () => ({ ok: true, status: 200, text: async () => JSON.stringify({
    candidates: [{ content: { parts: [{ text: JSON.stringify(modelReading) }] } }] }) }),
};
/* A body with no label-table shape at all, so tier 1.5 declines and tier 2 runs. */
const PROSE = 'Ban da thanh toan 37,000 VND tai GS25 luc 18:52 ngay 25/08/2026. Cam on.';
const res = await R.readTransaction(
  { from: 'MB <mbcard@mbbank.com.vn>', subject: 'Thong bao giao dich TK cham #12345', body: PROSE },
  mkDb(async (sender, subj, step) => { calls.push({ sender, subj, step }); }), modelDeps);
t('the row still stages — a template failure is never a lost transaction',
  res.ok === true, JSON.stringify(res.reason || res.threw));
console.log('   recorded:', JSON.stringify(calls));
t('the failing step reached the recorder', calls.length === 1, JSON.stringify(calls));
if (calls.length) {
  t('carries the normalised subject, not the raw one',
    calls[0].subj === R.normalizeSubjectTemplate('Thong bao giao dich TK cham #12345'), calls[0].subj);
  t('carries the sender, lowercased by the cache key rule',
    calls[0].sender === 'mbcard@mbbank.com.vn', calls[0].sender);
  t('carries NO value from the mail — step names only',
    !/37,?000|GS25|typed by a human/.test(JSON.stringify(calls)), JSON.stringify(calls));
}

console.log('\n-- a recorder that throws costs nothing --');
let threw = false, r2 = null;
try {
  r2 = await R.readTransaction(
    { from: 'MB <mbcard@mbbank.com.vn>', subject: 'Thong bao giao dich TK cham', body: PROSE },
    mkDb(async () => { throw new Error('table gone'); }), modelDeps);
} catch (e) { threw = true; }
t('the read still succeeds', !!r2 && r2.ok === true, JSON.stringify(r2 && (r2.reason || r2.ok)));
t('and nothing propagates to the caller', !threw);

console.log('\n' + pass + ' pass, ' + fail + ' fail\n');
if (fail) process.exit(1);
