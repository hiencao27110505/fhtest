#!/usr/bin/env node
/* The instrument classifier: credit card vs deposit account vs e-wallet.
 * `node pipeline/account-kind.test.js`
 *
 * borrowing-lending-spec §8. The borrowing logic hinges on labelling each
 * captured row's INSTRUMENT: a card debit is spending that also grows a debt,
 * a deposit debit is just spending, a wallet debit is spending from the ví.
 * The classifier reads the mail's own words, most reliable signal first, and
 * NEVER guesses — an ambiguous mail stays null, the client defaults to
 * deposit-expense behaviour with an editable chip, and a phantom card debt is
 * never invented (spec §8.4 / Q16).
 *
 * Three layers pinned here:
 *   1. the truth table — the VN signals, in priority order;
 *   2. the template static — a non-null verdict freezes at derivation exactly
 *      like direction does, a null is ABSENT so a later confident derivation
 *      can still fill it, and the v5 bump retires every v4 template;
 *   3. the wiring — every tier of readTransaction leaves with an account_kind,
 *      and a verdict the model or the template already made is never
 *      overwritten by the heuristic.
 *
 * Both transports share one sender_fingerprints cache, so the .gs slice is
 * re-evaluated here and compared against templates.mjs on every input — the
 * same both-sides-agree discipline direct-templates.test.js applies.
 */
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, 'bank-email-pipeline.gs'), 'utf8');
// NOT 'use strict': the .gs slice is ES5 `var`/`function` declarations and they
// have to land as locals here.
eval(src.slice(src.indexOf('var EXTRACTION_LOGIC_VERSION'),
               src.indexOf('function upsertFingerprint')));

let pass = 0, fail = 0;
const t = (n, ok, d) => { console.log((ok ? '  PASS  ' : '  FAIL  ') + n + (!ok && d ? '  -> ' + d : '')); ok ? pass++ : fail++; };

(async () => {
const T = await import('../supabase/functions/_shared/mailbox/templates.mjs');
const X = await import('../supabase/functions/_shared/mailbox/extract.mjs');

/* ── 1. the truth table, on both implementations ─────────────────────────── */
console.log('\n-- the VN signals, most reliable first --');

// [name, input, expected]
const TABLE = [
  ['a credit limit in the body is a credit card',
    { bodyText: 'The MB Hi Visa\nSo tien giao dich: -250,000 VND\nHạn mức khả dụng: 15.000.000 VND' },
    'credit_card'],
  ['an outstanding balance (dư nợ) is a credit card',
    { bodyText: 'Thong bao sao ke\nDư nợ thẻ: 3.200.000 VND\nDen han thanh toan 25/09/2026' },
    'credit_card'],
  ['a balance-after-transaction row is a deposit account',
    { bodyText: 'Tai khoan 0123456789\nSo tien -92,000 VND\nSố dư: 5.200.000 VND' },
    'deposit'],
  ['MoMo as provider is an e-wallet',
    { provider: 'MoMo', bodyText: 'Ban vua thanh toan 50.000d cho GRAB' },
    'ewallet'],
  ['so is the MoMo sender address, when no provider label exists yet',
    { provider: 'no-reply@momo.vn', bodyText: 'Ban vua thanh toan 50.000d' },
    'ewallet'],
  ['ZaloPay and ShopeePay too',
    { provider: 'ZaloPay', bodyText: 'x' },
    'ewallet'],
  ['a terse mail with no signal stays null — never a guessed debt (Q16)',
    { bodyText: 'GD: -100,000 VND luc 10:15 24/08', subject: 'Thong bao giao dich' },
    null],
  ['the subject names the credit card where the body does not',
    { subject: 'Thông báo giao dịch thẻ tín dụng', bodyText: 'GD -1,500,000 VND tai AEON' },
    'credit_card'],
  ['a "biến động số dư" subject is a deposit account',
    { subject: 'Vietcombank - Biến động số dư', bodyText: 'GD -50,000 VND' },
    'deposit'],
  ['a "số dư tài khoản" subject is a deposit account',
    { subject: 'Thong bao thay doi số dư tài khoản', bodyText: 'GD +2,000,000 VND' },
    'deposit'],
  ['a real-ish VCB biến-động-số-dư body is a deposit account',
    { subject: 'Biến động số dư tài khoản',
      bodyText: ['Kính gửi Quý khách CAO THAI DUY HIEN,',
                 'Vietcombank trân trọng thông báo:',
                 'Tài khoản: 0011000123456',
                 'Số tiền: -165,000 VND',
                 'Số dư: 4.210.000 VND',
                 'Nội dung: ca phe sang'].join('\n') },
    'deposit'],
  ['a 16-digit masked PAN is the card tiebreaker',
    { bodyText: 'GD -300,000 VND', accountMasked: '4412 34** **** 5678' },
    'credit_card'],
  ['a bank account number is NOT mistaken for a card',
    { bodyText: 'GD -300,000 VND', accountMasked: '0123456789' },
    null],
];
for (const [name, input, want] of TABLE) {
  const got = T.deriveAccountKind(input);
  t(name, got === want, JSON.stringify(got) + ' wanted ' + JSON.stringify(want));
  t('  ...and the .gs slice agrees', got === deriveAccountKind(input),
    JSON.stringify(deriveAccountKind(input)));
}

console.log('\n-- priority: the stronger signal wins --');
t('dư nợ beats số dư — a card statement also prints a balance',
  T.deriveAccountKind({ bodyText: 'Dư nợ: 3.000.000\nSố dư: 1.000.000' }) === 'credit_card');
t('an e-wallet provider beats a số-dư body — the wallet prints balances too',
  T.deriveAccountKind({ provider: 'MoMo', bodyText: 'Số dư ví: 120.000đ' }) === 'ewallet');
t('but a credit signal beats even the wallet — Ví Trả Sau carries dư nợ',
  T.deriveAccountKind({ provider: 'MoMo', bodyText: 'Dư nợ kỳ này: 500.000đ' }) === 'credit_card');
t('a "số dư" in prose does not fire off the word "dư" alone',
  T.deriveAccountKind({ bodyText: 'So du\nNoi dung chuyen tien' }) === 'deposit');

/* ── 2. the template static ──────────────────────────────────────────────── */
console.log('\n-- a non-null verdict freezes into the shape, null stays absent --');

const BODY = [
  'Ngan hang MB Bank',
  'So tien giao dich -165,000 VND',
  'Tai khoan 0123456789',
  'Nguoi nhan HIGHLANDS COFFEE',
  'Ma giao dich FT26234000123',
  'Thoi gian 24-08-2026 10:15:00',
].join('\n');
const EXTRACTION = {
  is_transaction: true, transaction_type: 'bank_txn', source_provider: 'MB Bank',
  occurred_at: '2026-08-24T10:15:00+07:00', amount: 165000, currency: 'VND',
  direction: 'debit', counterparty: 'HIGHLANDS COFFEE', memo: null,
  reference_number: 'FT26234000123', status: null, account_masked: '0123456789',
};

{
  const withKind = { ...EXTRACTION, account_kind: 'credit_card' };
  const tplJson = T.deriveExtractionTemplate(BODY, withKind);
  t('a kind-bearing extraction derives', !!tplJson, String(tplJson));
  t('and the .gs derives the identical template',
    tplJson === deriveExtractionTemplate(BODY, withKind));
  const tpl = JSON.parse(tplJson);
  t('account_kind sits in the static block', tpl.static.account_kind === 'credit_card',
    JSON.stringify(tpl.static));
  const applied = T.applyExtractionTemplate(tplJson, BODY);
  t('and every later mail of the shape inherits it',
    !!applied && applied.account_kind === 'credit_card');
}
{
  const tplJson = T.deriveExtractionTemplate(BODY, { ...EXTRACTION, account_kind: null });
  t('a null verdict still derives — ambiguity must not cost the zero-LLM path',
    !!tplJson, String(tplJson));
  const tpl = JSON.parse(tplJson);
  t('but the static is ABSENT, not null — the shape has no opinion to be wrong about',
    !('account_kind' in tpl.static), JSON.stringify(tpl.static));
  const applied = T.applyExtractionTemplate(tplJson, BODY);
  t('so an applied reading carries no frozen kind',
    !!applied && applied.account_kind === undefined);
}
{
  // account_kind is filled by the per-read heuristic, not frozen behind a
  // version bump — so the logic version stays 4 (bumping it forced a mass
  // re-derivation that stalled backfills, 2026-09-02). account_kind is still
  // written into a freshly-derived template's static when non-null (additive),
  // and read back by the heuristic when a template predates it.
  t('the logic version is 4 on both sides',
    T.EXTRACTION_LOGIC_VERSION === 4 && EXTRACTION_LOGIC_VERSION === 4,
    T.EXTRACTION_LOGIC_VERSION + ' / ' + EXTRACTION_LOGIC_VERSION);
  const stale = JSON.stringify({ ...JSON.parse(T.deriveExtractionTemplate(BODY, EXTRACTION)), v: 3 });
  t('a previous-version template is refused, forcing one clean re-derivation per shape',
    T.applyExtractionTemplate(stale, BODY) === null && applyExtractionTemplate(stale, BODY) === null);
}

/* ── 3. the wiring: every tier leaves with a verdict, none overwrites one ── */
console.log('\n-- readTransaction: the tiers fill account_kind, never overwrite it --');

const BODY_SODU = BODY.replace('Tai khoan 0123456789',
                               'Tai khoan 0123456789\nSo du 4,210,000 VND');
const MSG = { from: 'MB Bank <mb@mbbank.com.vn>', subject: 'Thong bao giao dich', body: BODY_SODU };

const dbFor = (fp) => {
  const saved = [];
  return {
    saved,
    fingerprint: async () => fp || null,
    saveFingerprint: async (row) => { saved.push(row); },
  };
};
const llmAnswering = (extraction) => ({
  llm: { apiKey: 'test-key' },
  fetch: async () => ({
    ok: true,
    text: async () => JSON.stringify({
      candidates: [{ content: { parts: [{ text: JSON.stringify(extraction) }] } }],
    }),
  }),
});

{
  // LLM tier, model silent on account_kind -> the heuristic fills it.
  const db = dbFor(null);
  const r = await X.readTransaction(MSG, db, llmAnswering({ ...EXTRACTION, account_kind: null }));
  t('llm tier: heuristic fills what the model left null',
    r.ok && r.extraction.account_kind === 'deposit',
    JSON.stringify(r.ok ? r.extraction.account_kind : r));
  const fp = db.saved.find((s) => s.extraction_regex);
  t('and the filled verdict is what freezes into the stored template',
    !!fp && JSON.parse(fp.extraction_regex).static.account_kind === 'deposit',
    fp && fp.extraction_regex);
}
{
  // LLM tier, model answered -> the heuristic must NOT overwrite it, even
  // though this body's "So du" row would read as deposit.
  const db = dbFor(null);
  const r = await X.readTransaction(MSG, db, llmAnswering({ ...EXTRACTION, account_kind: 'credit_card' }));
  t('llm tier: a model verdict is never overwritten by the heuristic',
    r.ok && r.extraction.account_kind === 'credit_card',
    JSON.stringify(r.ok ? r.extraction.account_kind : r));
}
{
  // Template tier, static present -> inherited as-is.
  const tplJson = T.deriveExtractionTemplate(BODY_SODU, { ...EXTRACTION, account_kind: 'credit_card' });
  const r = await X.readTransaction(MSG, dbFor({ is_transaction_source: true, extraction_regex: tplJson }),
                                    { llm: {} });
  t('template tier: a frozen static outranks the per-mail heuristic',
    r.ok && r.stage === 'template' && r.extraction.account_kind === 'credit_card',
    JSON.stringify(r.ok ? r.stage + '/' + r.extraction.account_kind : r));
}
{
  // Template tier, static absent -> the heuristic answers per mail.
  const tplJson = T.deriveExtractionTemplate(BODY_SODU, { ...EXTRACTION, account_kind: null });
  const r = await X.readTransaction(MSG, dbFor({ is_transaction_source: true, extraction_regex: tplJson }),
                                    { llm: {} });
  t('template tier: an opinion-less shape still gets the heuristic, per mail',
    r.ok && r.stage === 'template' && r.extraction.account_kind === 'deposit',
    JSON.stringify(r.ok ? r.stage + '/' + r.extraction.account_kind : r));
}
{
  // The .gs wires the same two tiers; source-pinned like sealing.test.js does,
  // because the Apps Script cannot be executed here end-to-end.
  const pom = src.slice(src.indexOf('function processOneMessage'), src.indexOf('// ---------- Stage 0 helpers'));
  t('.gs template tier fills account_kind',
    /tryRegexExtract[\s\S]{0,600}deriveAccountKind/.test(pom));
  t('.gs llm tier fills account_kind BEFORE deriving the template',
    pom.indexOf('extraction.account_kind = deriveAccountKind', pom.indexOf('extraction = result;')) > 0 &&
    pom.indexOf('extraction.account_kind = deriveAccountKind', pom.indexOf('extraction = result;'))
      < pom.indexOf('var derivedRegex = deriveExtractionTemplate'));
  t('.gs llm schema offers the enum and does not require it',
    /account_kind:\s*\{\s*type: \['string', 'null'\],\s*enum: \['credit_card', 'deposit', 'ewallet', null\]/.test(src) &&
    !/required: \[[^\]]*account_kind[^\]]*\]/.test(src));
}

console.log('\n' + (fail ? 'FAILED ' + fail + ' of ' + (pass + fail)
                         : 'ALL ' + pass + ' assertions passed'));
process.exit(fail ? 1 : 0);
})();
