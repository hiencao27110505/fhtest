#!/usr/bin/env node
/* The accuracy gate for receipt scan (docs/briefs/receipt-scan.md, stage 5).

   node tools/receipt-bench.js <folder>            GEMINI_API_KEY in the environment

   <folder> holds real photos (jpg/png/webp) and an answers.json:
     { "circle-k.jpg": { "amount": 85000, "date": "2026-09-12" }, ... }
   amount in RAW currency units (85000, not 85). date optional.

   Each image goes through the SAME prompt, schema and validator as production
   (api/receipt-extract.js), then the result is compared with the answer. Output is
   rates, never counts. Gate: amount ≥ 95%, date ≥ 90% (brief). One image at a time,
   with a pause, so the per-minute limit is never the thing being measured.

   Limits: images are sent as-is (Node has no canvas), so pre-shrink them to the
   app's 1600px long edge for a faithful run, e.g. `sips -Z 1600 *.jpg`. */
const fs = require('fs');
const path = require('path');
const api = require(path.join(__dirname, '..', 'api', 'receipt-extract.js'));

const dir = process.argv[2];
const key = process.env.GEMINI_API_KEY;
if (!dir || !key) { console.error('usage: GEMINI_API_KEY=… node tools/receipt-bench.js <folder>'); process.exit(2); }
const answers = JSON.parse(fs.readFileSync(path.join(dir, 'answers.json'), 'utf8'));
const files = fs.readdirSync(dir).filter((f) => /\.(jpe?g|png|webp)$/i.test(f)).sort();
if (!files.length) { console.error('no images in ' + dir); process.exit(2); }
const mime = (f) => /\.png$/i.test(f) ? 'image/png' : (/\.webp$/i.test(f) ? 'image/webp' : 'image/jpeg');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const parsers = await import(path.join(__dirname, '..', 'supabase', 'functions', '_shared', 'mailbox', 'labeltable.mjs'));
  const rows = [];
  for (const f of files) {
    const b64 = fs.readFileSync(path.join(dir, f)).toString('base64');
    const body = {
      system_instruction: { parts: [{ text: api.SYSTEM_PROMPT }] },
      contents: [{ role: 'user', parts: [{ inline_data: { mime_type: mime(f), data: b64 } }, { text: 'Đọc ảnh này.' }] }],
      generationConfig: { responseMimeType: 'application/json', responseSchema: api.RESPONSE_SCHEMA, temperature: 0 },
    };
    const t0 = Date.now();
    let out = null, err = null;
    try {
      const r = await fetch(api.GEMINI_URL + '?key=' + key, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const data = await r.json();
      const text = data && data.candidates && data.candidates[0] && data.candidates[0].content.parts[0].text;
      out = api.validate(JSON.parse(text), parsers);
    } catch (e) { err = String(e.message || e); }
    const ms = Date.now() - t0;
    const want = answers[f] || {};
    const amountOk = out && want.amount != null && out.amount === Number(want.amount);
    const dateOk = out && want.date && out.date === want.date;
    rows.push({ f, ms, err, amount: out && out.amount, wantAmount: want.amount, amountOk, date: out && out.date, wantDate: want.date, dateOk, flagged: !!(out && out.flags && out.flags.amount_unverified), kind: out && out.document_kind, isTxn: !!(out && out.is_transaction) });
    console.log((amountOk ? '  ✓ ' : '  ✗ ') + f.padEnd(28) + (err ? 'ERROR ' + err : ('amount ' + (out.amount == null ? '—' : out.amount) + ' vs ' + want.amount + ' · date ' + (out.date || '—') + ' vs ' + (want.date || '—') + (out.flags.amount_unverified ? ' · flagged' : ''))) + '  ' + ms + 'ms');
    await sleep(5500);   // ≤ 12/min, comfortably
  }
  const pct = (n, d) => d ? Math.round(100 * n / d) + '%' : 'n/a';
  const withAmount = rows.filter((r) => r.wantAmount != null), withDate = rows.filter((r) => r.wantDate);
  const byKind = {};
  rows.forEach((r) => { const k = r.kind || 'error'; byKind[k] = byKind[k] || { n: 0, ok: 0 }; byKind[k].n++; if (r.amountOk) byKind[k].ok++; });
  console.log('\n' + rows.length + ' images');
  console.log('amount right     ' + pct(withAmount.filter((r) => r.amountOk).length, withAmount.length) + '   (gate ≥ 95%)');
  console.log('date right       ' + pct(withDate.filter((r) => r.dateOk).length, withDate.length) + '   (gate ≥ 90%)');
  console.log('flagged          ' + pct(rows.filter((r) => r.flagged).length, rows.length) + '   (amount not found in the transcription)');
  console.log('read as receipt  ' + pct(rows.filter((r) => r.isTxn).length, rows.length));
  console.log('errors           ' + pct(rows.filter((r) => r.err).length, rows.length));
  Object.keys(byKind).forEach((k) => console.log('  ' + k.padEnd(22) + 'amount right ' + pct(byKind[k].ok, byKind[k].n) + ' of ' + byKind[k].n));
  const times = rows.filter((r) => !r.err).map((r) => r.ms).sort((a, b) => a - b);
  if (times.length) console.log('read time p50/p90  ' + times[Math.floor(times.length * 0.5)] + 'ms / ' + times[Math.floor(times.length * 0.9)] + 'ms');
})();
