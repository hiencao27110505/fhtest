// Tests the masking boundary in pipeline/lib/llm.js by intercepting the HTTP
// request that would go to Gemini and asserting no real value is in it.
//
// This is the test that would catch someone "simplifying" the adapter by
// passing the body straight through. Everything else in the pipeline is a
// correctness concern; this one is the privacy promise.
//
// Run: node pipeline/llm-masking.test.js

const { makeGeminiAdapter } = require('./lib/llm.js');

let pass = 0, fail = 0;
const t = (n, ok, d) => { console.log((ok ? '  PASS  ' : '  FAIL  ') + n + (!ok && d ? '  -> ' + d : '')); ok ? pass++ : fail++; };

// Note the payee is NOT one of extract.FAKE_NAMES. Picking a real-data name
// that also appears in the substitution list makes this test lie: the masker
// would legitimately emit that string as the *replacement* for a different
// name, and a naive "is it present?" check reads that as a leak. The collision
// is covered explicitly at the bottom of this file instead.
const REAL = {
  amount: '250,000',
  account: '0123456789',
  ref: 'FT26224987654321',
  payer: 'NGUYEN THU TRANG',
  payee: 'NGUYEN VAN HUNG',
  card: '9704221234567890',
  email: 'trang.nguyen.wh@gmail.com',
  phone: '0987654321',
};

const BODY = [
  'Ngan hang TMCP Quan Doi tran trong thong bao:',
  `So tai khoan: ${REAL.account}`,
  `So tien: ${REAL.amount} VND`,
  'Thoi gian: 12-08-2026 14:32:07',
  `Noi dung chuyen tien: ${REAL.payer} chuyen tien an trua`,
  `Nguoi thu huong: ${REAL.payee} ${REAL.card}`,
  `So tham chieu: ${REAL.ref}`,
  `Lien he: ${REAL.email} hoac ${REAL.phone}`,
].join('\n');

(async () => {

let sentBody = null;

const fakeFetch = async (url, opts) => {
  sentBody = opts.body;
  const sent = JSON.parse(opts.body);
  const seen = sent.contents[0].parts[0].text;
  // Reply the way Gemini would: with the MASKED values it was shown, so the
  // unmask step has something real to do.
  const grab = (re) => { const m = seen.match(re); return m ? m[1] : null; };
  return {
    ok: true,
    async json() {
      return {
        candidates: [{
          content: {
            parts: [{
              text: JSON.stringify({
                is_transaction: true,
                transaction_type: 'p2p_transfer',
                source_provider: 'MB Bank',
                occurred_at: '2026-08-12T14:32:07+07:00',
                amount: Number(String(grab(/So tien: ([\d,]+) VND/) || '0').replace(/,/g, '')),
                currency: 'VND',
                direction: 'debit',
                counterparty: grab(/Nguoi thu huong: (.+)/),
                memo: grab(/Noi dung chuyen tien: (.+)/),
                reference_number: grab(/So tham chieu: (\S+)/),
                status: null,
                account_masked: grab(/So tai khoan: (\d+)/),
              }),
            }],
          },
        }],
      };
    },
  };
};

const adapter = makeGeminiAdapter({ GEMINI_API_KEY: 'test-key' }, fakeFetch);
const result = await adapter.classifyAndExtract('mbebanking@mbbank.com.vn', 'Bien dong so du', BODY);

console.log('\n-- nothing real reaches the model --');
{
  t('no real amount in the request', sentBody.indexOf(REAL.amount) === -1);
  t('no real account number', sentBody.indexOf(REAL.account) === -1);
  t('no real reference number', sentBody.indexOf(REAL.ref) === -1);
  t('no real payer name', sentBody.indexOf(REAL.payer) === -1);
  t('no real payee name', sentBody.indexOf(REAL.payee) === -1);
  t('no real card number', sentBody.indexOf(REAL.card) === -1);
  t('no real email address', sentBody.indexOf(REAL.email) === -1);
  t('no real phone number', sentBody.indexOf(REAL.phone) === -1);
}

console.log('\n-- but enough shape survives to extract against --');
{
  const sent = JSON.parse(sentBody);
  const seen = sent.contents[0].parts[0].text;
  t('the labels are intact', /So tien:/.test(seen) && /Noi dung chuyen tien:/.test(seen));
  t('the timestamp is intact (extraction needs it)', seen.indexOf('12-08-2026 14:32:07') !== -1);
  t('the bank sender is intact (needed to classify)', seen.indexOf('mbebanking@mbbank.com.vn') !== -1);
  t('the currency is intact', /VND/.test(seen));
  t('the system prompt is the shared one', /You classify and extract structured data/.test(sent.systemInstruction.parts[0].text));
  t('the schema is the Gemini-flavoured one (no union types)',
    sent.generationConfig.responseSchema.properties.amount.nullable === true &&
    !Array.isArray(sent.generationConfig.responseSchema.properties.amount.type));
}

console.log('\n-- and the truth comes back locally --');
{
  t('real amount restored', result.amount === 250000, String(result.amount));
  t('real counterparty restored', result.counterparty === `${REAL.payee} ${REAL.card}`, result.counterparty);
  t('real memo restored, with the real name in it', result.memo === `${REAL.payer} chuyen tien an trua`, result.memo);
  t('real reference restored', result.reference_number === REAL.ref, result.reference_number);
  t('real account restored', result.account_masked === REAL.account, result.account_masked);
  console.log('        ^ the model worked on fakes; the ledger gets the truth.');
}

console.log('\n-- documented quirk: a real name that IS a fake name --');
{
  // FAKE_NAMES are fixed and public (they are in the source). If a real person
  // in the email happens to be called one of them, that string can appear in
  // the masked text as the substitute for a DIFFERENT name. It round-trips
  // correctly — substitution is keyed on the masked value, not the real one —
  // and it leaks nothing an observer could act on, since they cannot tell a
  // substituted name from a coincidental one. Pinned so nobody "fixes" the
  // masker in a way that breaks parity with the deployed .gs over a non-issue.
  const extract = require('./lib/extract.js');
  const collide = [
    'Nguoi gui: NGUYEN THU TRANG',
    `Nguoi nhan: ${extract.FAKE_NAMES[0]}`,
  ].join('\n');
  const m = extract.maskForSharing(collide);
  const back = extract.unmaskExtraction(
    { sender: m.pairs.find((p) => p.original === 'NGUYEN THU TRANG').masked,
      receiver: m.pairs.find((p) => p.original === extract.FAKE_NAMES[0]).masked },
    m,
  );
  t('both names still round-trip to the truth',
    back.sender === 'NGUYEN THU TRANG' && back.receiver === extract.FAKE_NAMES[0],
    JSON.stringify(back));
  t('the two are masked to DIFFERENT values (no aliasing)',
    m.pairs.find((p) => p.original === 'NGUYEN THU TRANG').masked !==
    m.pairs.find((p) => p.original === extract.FAKE_NAMES[0]).masked);
}

console.log('\n-- misconfiguration fails loudly --');
{
  const noKey = makeGeminiAdapter({}, fakeFetch);
  let threw = false;
  try { await noKey.classifyAndExtract('a@b.com', 's', 'b'); } catch (e) { threw = /GEMINI_API_KEY/.test(e.message); }
  t('a missing API key throws instead of sending anything', threw);
}

console.log('\n' + (fail === 0 ? 'ALL ' + pass + ' PASSED' : pass + ' passed, ' + fail + ' FAILED'));
process.exit(fail ? 1 : 0);

})();
