#!/usr/bin/env node
/* What reaches the model, and what the person agreed to, must be the same thing.
 * `node pipeline/llm-raw-body.test.js`
 *
 * On 2026-08-25 masking was removed: the mail now goes to the model as written,
 * and CONSENT is the control that replaced it. That makes two things true at
 * once, and this file exists because either can drift without anything failing.
 *
 * 1. The body actually has to arrive. Masking used to be the thing standing
 *    between `body` and the request payload, and removing a transform is
 *    exactly the change that can quietly drop its input instead of passing it
 *    through. A payload missing the body does not error — the model answers
 *    from the subject line alone, plausibly, and every mail reads as
 *    is_transaction:false or as a wrong amount.
 *
 * 2. The consent sheet has to still say so. The removal is only defensible
 *    because `FH_CONSENT_V` was bumped and the copy now names what is sent. If
 *    someone re-adds masking, or edits that copy back toward "real values are
 *    never sent", the code and the agreement part company — and the direction
 *    that matters is the one where we send MORE than the sheet admits.
 *
 * Neither is a hypothetical: v3 of that copy promised masking in as many words,
 * and it was true right up until it wasn't.
 */
const fs = require('fs');
const path = require('path');

const gs = fs.readFileSync(path.join(__dirname, 'bank-email-pipeline.gs'), 'utf8');
const consent = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'js-data', '75-consent-ui.js'), 'utf8');

let pass = 0, fail = 0;
const t = (n, ok, d) => { console.log((ok ? '  PASS  ' : '  FAIL  ') + n + (!ok && d ? '  -> ' + d : '')); ok ? pass++ : fail++; };

/* Both files deliberately DISCUSS masking in their comments — the record of why
 * it was removed is the most useful thing there for whoever reaches for it next.
 * So the checks below have to read code, not prose, or the test would punish the
 * documentation it wants. Rough but sufficient: these are substring searches,
 * never eval'd, so an imperfect strip costs nothing. */
function codeOnly(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .split('\n').map(l => l.replace(/\/\/.*$/, '')).join('\n');
}
const gsCode = codeOnly(gs);
const consentCode = codeOnly(consent);

// ── Apps Script shims: capture the outbound request instead of making it ─────
const SENT = [];
global.PropertiesService = {
  getScriptProperties: () => ({ getProperty: () => 'test-key', setProperty: () => {} }),
};
global.UrlFetchApp = {
  fetch: (url, opts) => {
    SENT.push({ url, payload: JSON.parse(opts.payload) });
    // A minimal well-formed answer in each provider's own response shape.
    const answer = JSON.stringify({ is_transaction: true, amount: 165000 });
    return {
      getContentText: () => JSON.stringify(
        url.indexOf('anthropic') >= 0
          ? { content: [{ text: answer }] }
          : { candidates: [{ content: { parts: [{ text: answer }] } }] }),
    };
  },
};

// Just the two call sites and what they need, not the whole 100KB script.
eval(gs.slice(gs.indexOf('var EXTRACTION_SYSTEM_PROMPT ='),
               gs.indexOf('// ---------- Extraction templates')));

// Real-shaped values. Every one of these is something masking used to replace,
// so each is also a check that no remnant of it is still rewriting the text.
const SENDER = 'no-reply@mbbank.com.vn';
const SUBJECT = 'Thong bao giao dich thanh cong';
const BODY = [
  'So tien giao dich: 165,000 VND',
  'So du: 4,210,000 VND',
  'Tai khoan: 0123456789',
  'Nguoi nhan: NGUYEN THU TRANG',
  'Noi dung: tra tien an trua thu 6',
  'Ma giao dich: FT26234000123',
  'Lien he: hotro@mbbank.com.vn',
].join('\n');

const REAL_VALUES = [
  ['the amount', '165,000'],
  ['the balance', '4,210,000'],
  ['the account number', '0123456789'],
  ['the counterparty name', 'NGUYEN THU TRANG'],
  ['the memo', 'tra tien an trua thu 6'],
  ['the reference', 'FT26234000123'],
  ['the email address in the body', 'hotro@mbbank.com.vn'],
];

for (const [label, fn] of [['Gemini', classifyAndExtractViaGemini],
                           ['Haiku', classifyAndExtractViaHaiku]]) {
  console.log('\n-- ' + label + ': the mail arrives as written --');
  SENT.length = 0;
  const out = fn(SENDER, SUBJECT, BODY);

  t('made exactly one request', SENT.length === 1, 'made ' + SENT.length);
  const text = JSON.stringify(SENT[0].payload);

  t('the subject is in the payload', text.indexOf(SUBJECT) >= 0);
  for (const [what, value] of REAL_VALUES) {
    t(what + ' is sent verbatim', text.indexOf(value) >= 0, 'missing: ' + value);
  }
  t('the sender is named, so the model can classify', text.indexOf(SENDER) >= 0);

  // The extraction comes back exactly as the model gave it. Under masking this
  // went through unmaskExtraction, and a leftover call would either throw or
  // silently rewrite figures against an empty token map.
  t('the result is the model\'s answer, untransformed', out.amount === 165000);
}

console.log('\n-- no remnant of the masking path --');
// Not style policing: a half-removed transform is the failure mode here. Either
// helper surviving means something can still rewrite the text on its way out,
// and the consent sheet would be describing the wrong pipeline.
t('maskForSharing is gone', gsCode.indexOf('function maskForSharing') === -1);
t('unmaskExtraction is gone', gsCode.indexOf('function unmaskExtraction') === -1);
t('no call site still masks', gsCode.indexOf('maskForSharing(') === -1);
t('no call site still unmasks', gsCode.indexOf('unmaskExtraction(') === -1);
t('the fake-name pool is gone', gsCode.indexOf('FAKE_NAMES') === -1);
t('the caps blocklist is gone', gsCode.indexOf('CAPS_BLOCKLIST') === -1);
// The record of WHY, kept where the next person to reach for masking will read it.
t('the reversal is documented in the pipeline itself',
  gs.indexOf('// ---------- What the model is sent ----------') >= 0);

console.log('\n-- consent is the control that replaced it --');
const vm = consent.match(/var FH_CONSENT_V = (\d+);/);
t('FH_CONSENT_V is readable', !!vm);
// v3 is the version whose copy said "real values are never sent". A record at
// that version is agreement to a promise this pipeline no longer keeps, so the
// gate must not accept it.
t('FH_CONSENT_V is past the version that promised masking',
  !!vm && Number(vm[1]) >= 4, 'v=' + (vm && vm[1]));
t('the old promise is gone from the copy (vi)',
  consentCode.indexOf('số thật không bao giờ được gửi đi') === -1);
t('the old promise is gone from the copy (en)',
  consentCode.indexOf('real values are never sent') === -1);
t('the copy says mail is sent to an AI service (vi)',
  consentCode.indexOf('gửi nguyên nội dung email đó cho một dịch vụ AI') >= 0);
t('the copy says mail is sent to an AI service (en)',
  consentCode.indexOf('we send that email as it is to an AI service') >= 0);
// The honest other half: most mail never reaches a model, and the copy is only
// defensible while it says both things.
t('the copy still says repeat senders are read locally (vi)',
  consentCode.indexOf('không gửi đi đâu nữa') >= 0);
t('the copy still says repeat senders are read locally (en)',
  consentCode.indexOf('nothing leaves') >= 0);

console.log('\n' + (fail ? 'FAILED ' + fail + ' of ' + (pass + fail)
                         : 'ALL ' + pass + ' assertions passed'));
process.exit(fail ? 1 : 0);
