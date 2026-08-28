#!/usr/bin/env node
/* The extraction cache has to actually be readable back.
 * `node pipeline/direct-fingerprint-lookup.test.js`
 *
 * THE BUG THIS PINS. `db.fingerprint()` built its filter by running each
 * subject through encodeURIComponent and then handing the result to
 * URLSearchParams — which encodes it a SECOND time, turning every `%` into
 * `%25`. PostgREST decoded once and compared the literal text
 * `Th%C3%B4ng%20b%C3%A1o…` against a plain-text column, so the lookup missed
 * for every subject containing a space. Every Vietnamese bank subject contains
 * a space.
 *
 * WHAT THAT COST, and why it is worth a test rather than a comment: this is the
 * ONLY read of `sender_fingerprints` on the direct-read transport, so a miss is
 * not a slow path, it is the absence of all three things the table does —
 * the learned template, the cached "not a transaction" verdict, and the
 * sender-wide sentinel. 100% of a connected mailbox's mail went to Gemini,
 * reported live on 2026-08-28. Writes were never affected, so the rows were all
 * there, correct, and unread.
 *
 * Asserted against a real HTTP server rather than by inspecting the URL string.
 * A test that checked the string would encode the author's belief about what
 * PostgREST receives; this one makes something actually decode it, which is the
 * step the bug lived in.
 */
const http = require('http');
const path = require('path');
const { pathToFileURL } = require('url');

let pass = 0, fail = 0;
const t = (n, ok, d) => { console.log((ok ? '  PASS  ' : '  FAIL  ') + n + (!ok && d ? '  -> ' + d : '')); ok ? pass++ : fail++; };

/* Real production subjects, exactly as they arrive from the banks. */
const SUBJECTS = [
  'Thông báo giao dịch thẻ/ Vietcombank card transaction notification',
  'Biên lai chuyển tiền qua tài khoản',
  'Thông báo thông tin giao dịch TK chạm',
  'Thong bao giao dich thanh cong',
  'Sao kê thẻ MB VISA tháng 08.2026',
];
const SENDER = 'info@info.vietcombank.com.vn';

/* A PostgREST stand-in: decodes the query the way any HTTP server does, parses
   the in.(…) list, and answers from a table where EVERY subject is cached. */
function serve(table, seen) {
  return http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    const filter = u.searchParams.get('subject_template') || '';
    seen.push(filter);
    const m = filter.match(/^in\.\((.*)\)$/);
    const list = m ? m[1].split(/,(?=")/).map(v =>
      v.replace(/^"|"$/g, '').replace(/\\"/g, '"').replace(/\\\\/g, '\\')) : [];
    const rows = table.filter(r =>
      list.includes(r.subject_template) &&
      u.searchParams.get('sender_address') === 'eq.' + r.sender_address);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(rows));
  });
}

(async () => {
  const { createDb } = await import(pathToFileURL(
    path.join(__dirname, '..', 'supabase', 'functions', '_shared', 'mailbox', 'db.mjs')).href);

  const table = SUBJECTS.map(s => ({
    sender_address: SENDER, subject_template: s, is_transaction_source: true,
    transaction_type: 'bank_txn', extraction_regex: '{"v":4}', last_verified_at: null,
  }));
  table.push({
    sender_address: SENDER, subject_template: '*', is_transaction_source: false,
    transaction_type: null, extraction_regex: null, last_verified_at: null,
  });

  const seen = [];
  const server = serve(table, seen);
  await new Promise(r => server.listen(0, r));
  const db = createDb('http://127.0.0.1:' + server.address().port, 'k', fetch);

  console.log('\n-- a cached Vietnamese subject is found, so no model call --');
  for (const s of SUBJECTS) {
    const fp = await db.fingerprint(SENDER, s);
    t(JSON.stringify(s.slice(0, 40)), !!fp && fp.extraction_regex === '{"v":4}',
      fp ? 'no template' : 'MISS — this mail would go to the model');
  }

  console.log('\n-- the server really did receive the plain subject, not its escapes --');
  t('no percent-escape reached the filter',
    seen.every(f => !/%[0-9A-Fa-f]{2}/.test(f)),
    seen.find(f => /%[0-9A-Fa-f]{2}/.test(f)));
  t('the exact subject is inside the in.() list',
    seen[0].includes(SUBJECTS[0]), seen[0]);

  console.log('\n-- the sender-wide sentinel still resolves when the shape is new --');
  const wide = await db.fingerprint(SENDER, 'a subject nobody has ever seen');
  t('falls back to the * row', !!wide && wide.is_transaction_source === false);
  t('and says it came from the sentinel', !!wide && wide._sender_wide === true);

  console.log('\n-- the exact shape beats the sentinel, both being present --');
  const exact = await db.fingerprint(SENDER, SUBJECTS[1]);
  t('exact row wins', !!exact && exact.is_transaction_source === true && !exact._sender_wide);

  console.log('\n-- a subject carrying the quoting characters still matches --');
  const odd = 'Giao dịch "thẻ", 15.000đ \\ ref';
  table.push({ sender_address: SENDER, subject_template: odd, is_transaction_source: true,
    transaction_type: 'bank_txn', extraction_regex: '{"v":4}', last_verified_at: null });
  const q = await db.fingerprint(SENDER, odd);
  t('quotes, commas and backslashes survive the in.() list', !!q && !q._sender_wide);

  console.log('\n-- a genuinely unknown sender still misses, or the cache means nothing --');
  const none = await db.fingerprint('someone-else@example.com', SUBJECTS[0]);
  t('unknown sender returns null', none === null);

  server.close();
  console.log(fail ? '\n' + fail + ' FAILED\n' : '\nall ' + pass + ' passed\n');
  process.exit(fail ? 1 : 0);
})();
