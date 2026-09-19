#!/usr/bin/env node
/* api/receipt-extract.js — the server side of receipt scan.
   Drives the REAL handler with a fake fetch (auth + Gemini) and a fake res, and
   the REAL validate() with the REAL bank-email parsers. No network, no key. */
const path = require('path');
const mod = require(path.join(__dirname, '..', 'api', 'receipt-extract.js'));

let pass = 0, fail = 0;
const t = (n, ok, d) => { console.log((ok ? '  PASS  ' : '  FAIL  ') + n + (!ok && d ? '  -> ' + d : '')); ok ? pass++ : fail++; };

function res() {
  const r = { code: null, body: null, status(c) { r.code = c; return r; }, json(b) { r.body = b; return r; } };
  return r;
}
function fakeFetch(opts) {
  opts = opts || {};
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, init });
    if (url.indexOf('/auth/v1/user') >= 0) {
      return opts.authOk === false ? { ok: false, json: async () => ({}) } : { ok: true, json: async () => ({ id: 'user-1' }) };
    }
    if (opts.geminiStatus && opts.geminiStatus !== 200) return { ok: false, status: opts.geminiStatus, text: async () => 'quota' };
    const text = opts.geminiText != null ? opts.geminiText : JSON.stringify(opts.gemini || {});
    return { ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text }] } }] }) };
  };
  fn.calls = calls;
  return fn;
}
const IMG = Buffer.from('fake jpeg bytes '.repeat(64)).toString('base64');
const good = { is_transaction: true, document_kind: 'paper_receipt', amount_text: '337.900đ', currency: '', date: '2026-09-12', time: '14:23',
  counterparty: 'CIRCLE K', memo: '', direction: 'debit', category: 'Groceries', raw_text: ['CIRCLE K', 'Nước suối 15.000', 'TỔNG 337.900'] };

(async () => {
  const parsers = await import(path.join(__dirname, '..', 'supabase', 'functions', '_shared', 'mailbox', 'labeltable.mjs'));
  const env = { GEMINI_API_KEY: 'k' };
  const req = (over) => Object.assign({ method: 'POST', headers: { authorization: 'Bearer tok' }, body: { image: IMG, mime: 'image/jpeg', lang: 'vi' } }, over || {});

  console.log('\n-- refusals, each before a Gemini call is spent --');
  let r = res(), f = fakeFetch();
  await mod.handler(req({ method: 'GET' }), r, { fetch: f, env, parsers });
  t('GET is 405', r.code === 405 && f.calls.length === 0);

  r = res(); f = fakeFetch();
  await mod.handler(req(), r, { fetch: f, env: {}, parsers });
  t('no key is 500 and nothing is fetched', r.code === 500 && f.calls.length === 0);

  r = res(); f = fakeFetch({ authOk: false });
  await mod.handler(req(), r, { fetch: f, env, parsers });
  t('bad token is 401, only the auth call was made', r.code === 401 && f.calls.length === 1 && f.calls[0].url.indexOf('/auth/') >= 0);

  r = res(); f = fakeFetch();
  await mod.handler(req({ body: { image: 'not base64 at all!!', mime: 'image/jpeg' } }), r, { fetch: f, env, parsers });
  t('non-base64 image is 400', r.code === 400 && f.calls.length === 1);

  r = res(); f = fakeFetch();
  await mod.handler(req({ body: { image: IMG, mime: 'text/plain' } }), r, { fetch: f, env, parsers });
  t('wrong mime is 400', r.code === 400);

  r = res(); f = fakeFetch();
  await mod.handler(req({ body: { image: 'A'.repeat(2.5 * 1024 * 1024 + 1), mime: 'image/jpeg' } }), r, { fetch: f, env, parsers });
  t('oversized image is 400 and Gemini is never called', r.code === 400 && !f.calls.some((c) => c.url.indexOf('generativelanguage') >= 0));

  console.log('\n-- the happy path --');
  r = res(); f = fakeFetch({ gemini: good });
  await mod.handler(req(), r, { fetch: f, env, parsers });
  const g = f.calls.find((c) => c.url.indexOf('generativelanguage') >= 0);
  t('Gemini is called once with the image inline and a strict schema at temperature 0', !!g && (() => {
    const b = JSON.parse(g.init.body);
    return b.contents[0].parts[0].inline_data.data === IMG && b.generationConfig.temperature === 0 && !!b.generationConfig.responseSchema;
  })());
  t('the key rides the URL, never the client body', g.url.indexOf('key=k') >= 0);
  t('200 with the amount in RAW units (337900, not 337.9)', r.code === 200 && r.body.amount === 337900, JSON.stringify(r.body));
  t('currency defaults to VND', r.body.currency === 'VND');
  t('date and time pass through when well-formed', r.body.date === '2026-09-12' && r.body.time === '14:23');
  t('the category is the concept, never a family category', r.body.category === 'Groceries');
  t('amount found in the transcription: not flagged', r.body.flags.amount_unverified === false);
  t('raw_text never reaches the client', !('raw_text' in r.body));

  console.log('\n-- Gemini failures never leak content --');
  r = res(); f = fakeFetch({ geminiStatus: 429 });
  await mod.handler(req(), r, { fetch: f, env, parsers });
  t('a 429 from Gemini is a 502 with no detail body', r.code === 502 && !('detail' in r.body));
  r = res(); f = fakeFetch({ geminiText: 'not json' });
  await mod.handler(req(), r, { fetch: f, env, parsers });
  t('non-JSON from Gemini is a 502 and the text is not echoed', r.code === 502 && JSON.stringify(r.body).indexOf('not json') === -1);

  console.log('\n-- validate(): nothing the model says is trusted --');
  const v = (o) => mod.validate(Object.assign({}, good, o), parsers);
  t('not a transaction: empty fields, no amount', (() => { const x = v({ is_transaction: false }); return x.is_transaction === false && x.amount === null; })());
  t('an amount the transcription does not contain is flagged', v({ raw_text: ['CIRCLE K', 'TỔNG 85.000'] }).flags.amount_unverified === true);
  t('a VN amount with a decimal tail reads as thousands (337.900 → 337900)', v({ amount_text: '337.900' }).amount === 337900);
  t('a zero amount is refused', v({ amount_text: '0đ' }).amount === null);
  t('a foreign amount keeps its currency and cents ($12.99)', (() => { const x = v({ amount_text: '$12.99', raw_text: ['TOTAL $12.99'] }); return x.amount === 12.99 && x.currency === 'USD'; })());
  t('a malformed date is dropped', v({ date: '12/09/2026' }).date === null);
  t('a date three years back is dropped', v({ date: '2023-01-01' }).date === null);
  t('a date next month is dropped', v({ date: new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10) }).date === null);
  t('time is dropped when the date is', v({ date: 'nope', time: '10:00' }).time === null);
  t('a bad time is dropped, the date kept', (() => { const x = v({ time: '25:99' }); return x.date === '2026-09-12' && x.time === null; })());
  t('an unknown concept becomes empty', v({ category: 'Pets' }).category === '');
  t('direction is debit unless the model says credit', v({ direction: 'sideways' }).direction === 'debit' && v({ direction: 'credit' }).direction === 'credit');
  t('counterparty and memo are trimmed and capped', v({ counterparty: '  ' + 'X'.repeat(200) }).counterparty.length === 80);

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
