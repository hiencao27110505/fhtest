// The only place in the direct-read path that talks to a model.
//
// It exists as its own file for one reason: masking must be impossible to
// forget. Nothing else in the pipeline may call Gemini, so there is exactly one
// line of code where real email text could escape, and it is the one wrapped in
// maskForSharing() below.
//
// The contract, unchanged from the forwarding pipeline:
//   real body → mask → model sees shape-preserving fakes → real values swapped
//   back locally from the mask map.
//
// The model never sees a real amount, name, account number, reference or email
// address. It sees an email of identical shape with different values, extracts
// against that, and we substitute the truth back on our side. Direct read makes
// this MORE important, not less: we are now reading mail the user never chose
// to hand us.

'use strict';

const extract = require('./extract.js');

const GEMINI_MODEL = 'gemini-3.5-flash-lite';
const GEMINI_URL = (model, key) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`;

// fetchImpl is injectable so the masking boundary can be tested without a key.
function makeGeminiAdapter(env, fetchImpl) {
  const doFetch = fetchImpl || fetch;
  return {
    async classifyAndExtract(sender, subject, body) {
      const apiKey = env.GEMINI_API_KEY;
      if (!apiKey) throw new Error('GEMINI_API_KEY not configured');

      // THE line. Subject and body are masked together so they share one token
      // map; the sender stays real — it is the bank's own address, needed for
      // classification, and is not customer data.
      const mask = extract.maskForSharing('Subject: ' + subject + '\n\n' + body);

      const payload = {
        systemInstruction: { parts: [{ text: extract.EXTRACTION_SYSTEM_PROMPT }] },
        contents: [{ role: 'user', parts: [{ text: 'Sender: ' + sender + '\n' + mask.text }] }],
        generationConfig: {
          responseMimeType: 'application/json',
          responseSchema: extract.schemaForGemini(extract.EXTRACTION_SCHEMA),
        },
      };

      const r = await doFetch(GEMINI_URL(env.GEMINI_MODEL || GEMINI_MODEL, apiKey), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!r.ok) throw new Error('gemini_http_' + r.status + ': ' + String(await r.text()).slice(0, 200));

      const data = await r.json();
      const text = data && data.candidates && data.candidates[0] &&
        data.candidates[0].content && data.candidates[0].content.parts &&
        data.candidates[0].content.parts[0] && data.candidates[0].content.parts[0].text;
      if (!text) throw new Error('gemini returned no content');

      let parsed;
      try { parsed = JSON.parse(text); } catch (e) { throw new Error('gemini returned invalid JSON'); }

      // Swap the real values back in locally. Everything after this point holds
      // truth; everything before it held fakes.
      return extract.unmaskExtraction(parsed, mask);
    },
  };
}

module.exports = { GEMINI_MODEL, makeGeminiAdapter };
