// Tests for pipeline/lib/ingest.js — the one-email-to-one-staged-row decision
// tree for the direct-read path. Fake db/llm/gmail, no network.
//
// Run: node pipeline/ingest.test.js

const ingest = require('./lib/ingest.js');
const extract = require('./lib/extract.js');

let pass = 0, fail = 0;
const t = (n, ok, d) => { console.log((ok ? '  PASS  ' : '  FAIL  ') + n + (!ok && d ? '  -> ' + d : '')); ok ? pass++ : fail++; };

const PROVIDERS = [{ domain_or_address: 'mbbank.com.vn', provider_name: 'MB Bank' }];
const CONNECTION = { id: 'conn-1', member_id: 'member-1', oauth_email: 'trang@gmail.com' };

const BODY = [
  'Ngan hang TMCP Quan Doi tran trong thong bao:',
  'So tai khoan: 0123456789',
  'So tien: 250,000 VND',
  'Thoi gian: 12-08-2026 14:32:07',
  'Noi dung chuyen tien: NGUYEN THU TRANG chuyen tien an trua',
  'Nguoi thu huong: TRAN VAN BAO 9704221234567890',
  'So tham chieu: FT26224987654321',
].join('\n');

const EXTRACTION = {
  is_transaction: true, transaction_type: 'p2p_transfer', source_provider: 'MB Bank',
  occurred_at: '2026-08-12T14:32:07+07:00', amount: 250000, currency: 'VND', direction: 'debit',
  counterparty: 'TRAN VAN BAO 9704221234567890', memo: 'NGUYEN THU TRANG chuyen tien an trua',
  reference_number: 'FT26224987654321', status: null, account_masked: '0123456789',
};

const msg = (over) => Object.assign({
  id: 'm1',
  sender: 'mbebanking@mbbank.com.vn',
  subject: 'Bien dong so du',
  headers: { 'authentication-results': 'dkim=pass header.d=mbbank.com.vn' },
  body: BODY,
}, over || {});

// A tiny in-memory PostgREST stand-in that understands the handful of filter
// forms this code uses.
function fakeDb(seed) {
  const tables = Object.assign({ email_transactions: [], sender_fingerprints: [], parse_failures: [] }, seed || {});
  const match = (row, filters) => Object.keys(filters).every((k) => {
    const spec = String(filters[k]);
    const [op, ...rest] = spec.split('.');
    const val = rest.join('.');
    if (op === 'eq') return String(row[k]) === val;
    if (op === 'neq') return String(row[k]) !== val;
    if (op === 'gte') return String(row[k]) >= val;
    if (op === 'is') return val === 'null' ? (row[k] === null || row[k] === undefined) : true;
    return true;
  });
  return {
    tables,
    calls: [],
    async get(table, filters) { this.calls.push(['get', table]); return (tables[table] || []).filter((r) => match(r, filters || {})); },
    async post(table, row, onConflict) {
      this.calls.push(['post', table]);
      tables[table] = tables[table] || [];
      if (onConflict) {
        const keys = onConflict.split(',');
        const i = tables[table].findIndex((r) => keys.every((k) => r[k] === row[k]));
        if (i >= 0) { tables[table][i] = Object.assign({}, tables[table][i], row); return tables[table][i]; }
      }
      const stored = Object.assign({ id: table + '-' + (tables[table].length + 1), created_at: new Date().toISOString() }, row);
      tables[table].push(stored);
      return stored;
    },
    async patch() { return null; },
  };
}

function deps(over) {
  const db = (over && over.db) || fakeDb();
  return Object.assign({
    db,
    providerDomains: PROVIDERS,
    enforceDkim: false,
    llm: { calls: 0, async classifyAndExtract() { this.calls++; return JSON.parse(JSON.stringify(EXTRACTION)); } },
  }, over || {}, { db });
}

const run = (d, m, budget) => ingest.processMessage(d, m || msg(), CONNECTION, budget);

(async () => {

console.log('\n-- the happy path --');
{
  const d = deps();
  const r = await run(d);
  t('stages a row', r.action === 'staged', JSON.stringify(r));
  const row = d.db.tables.email_transactions[0];
  t('amount and date land', row.amount === 250000 && row.occurred_at === '2026-08-12T14:32:07+07:00');
  t('routed to the connection owner — no +tag involved', row.member_id === 'member-1');
  t('marked as oauth-ingested', row.ingest_source === 'oauth');
  t('memo survives into raw_extracted', row.raw_extracted.memo === EXTRACTION.memo);
  t('NEVER auto-imported', row.review_status === 'pending');
  console.log('        ^ the single most important assertion in this file.');
}

console.log('\n-- the LLM is a last resort --');
{
  const d = deps();
  await run(d);
  t('first email of a new shape calls the LLM once', d.llm.calls === 1);
  const fp = d.db.tables.sender_fingerprints[0];
  t('...and a template is learned', !!(fp && fp.extraction_regex));

  // Second email of the same shape, different values.
  const NEXT = BODY.replace('250,000', '80,000').replace('FT26224987654321', 'FT26225123456789');
  const r2 = await run(d, msg({ id: 'm2', body: NEXT }));
  t('second email stages', r2.action === 'staged');
  t('...with ZERO further LLM calls', d.llm.calls === 1);
  t('...and the right new amount', d.db.tables.email_transactions[1].amount === 80000);
  console.log('        ^ this is why repeat senders cost nothing and leak nothing.');
}

console.log('\n-- masking is not optional --');
{
  let sawBody = null;
  const d = deps({ llm: { calls: 0, async classifyAndExtract(sender, subject, body) { this.calls++; sawBody = body; return JSON.parse(JSON.stringify(EXTRACTION)); } } });
  // The lib hands the raw body to deps.llm; the masking contract lives in the
  // llm adapter (api/gmail-sync.js). Assert the adapter shape is what we think.
  await run(d);
  t('the adapter receives the real body (it masks before sending)', sawBody === BODY);
  console.log('        ^ api/gmail-sync.js is where maskForSharing() runs; if that');
  console.log('          adapter is ever replaced, the masking test there must move too.');
}

console.log('\n-- things that must not be staged --');
{
  const d = deps();
  const r = await run(d, msg({ sender: 'friend@gmail.com' }));
  t('a sender outside known_provider_domains is skipped', r.action === 'skipped' && r.reason === 'sender_not_a_known_provider');
  t('...and costs no LLM call', d.llm.calls === 0);
  t('...and stages nothing', d.db.tables.email_transactions.length === 0);
}
{
  const d = deps({ enforceDkim: true });
  const r = await run(d, msg({ headers: { 'authentication-results': 'dkim=none' } }));
  t('unsigned mail is rejected when enforcement is on', r.action === 'rejected', JSON.stringify(r));
  t('...and recorded as a parse failure', d.db.tables.parse_failures.length === 1);
  t('...with NO body kept', d.db.tables.parse_failures[0].raw_body === '');
}
{
  const d = deps({ llm: { calls: 0, async classifyAndExtract() { this.calls++; return { is_transaction: false }; } } });
  const r = await run(d, msg({ subject: 'Uu dai thang 8' }));
  t('a newsletter is not staged', r.action === 'skipped' && r.reason === 'not_a_transaction');
  const fp = d.db.tables.sender_fingerprints[0];
  t('...and is remembered as non-transactional', fp && fp.is_transaction_source === false);
  const r2 = await run(d, msg({ id: 'm3', subject: 'Uu dai thang 8' }));
  t('...so the next one costs no LLM call', r2.reason === 'known_non_transactional' && d.llm.calls === 1);
}
{
  const d = deps();
  await run(d);
  const r = await run(d);   // same message id again
  t('the same message is never staged twice', r.action === 'skipped' && r.reason === 'already_staged');
  t('...still one row', d.db.tables.email_transactions.length === 1);
}

console.log('\n-- failures are recorded, not swallowed --');
{
  const d = deps({ llm: { async classifyAndExtract() { throw new Error('gemini exploded'); } } });
  const r = await run(d);
  t('an LLM error fails the message', r.action === 'failed' && r.reason === 'llm_error');
  t('...and is written to parse_failures', d.db.tables.parse_failures.length === 1);
  t('...without a body', d.db.tables.parse_failures[0].raw_body === '');
  t('...and stages nothing', d.db.tables.email_transactions.length === 0);
}
{
  const d = deps({ llm: { async classifyAndExtract() { return { is_transaction: true, amount: null, occurred_at: null }; } } });
  const r = await run(d);
  t('an extraction with no amount is a failure, not a zero-value row', r.action === 'failed' && r.reason === 'incomplete_extraction');
}

console.log('\n-- ceilings --');
{
  const d = deps();
  const budget = { llmCalls: ingest.MAX_NEW_CLASSIFICATIONS_PER_RUN };
  const r = await run(d, msg({ id: 'm9' }), budget);
  t('past the per-run LLM ceiling the message defers, it does not fail', r.action === 'deferred');
  t('...and nothing is written, so the next run picks it up', d.db.tables.email_transactions.length === 0);
}

console.log('\n-- cross-source dedup --');
{
  const d = deps({
    db: fakeDb({
      email_transactions: [{
        id: 'existing-1', gmail_message_id: 'other', amount: 250000, direction: 'debit',
        occurred_at: '2026-08-12T14:00:00+07:00', source_provider: 'Anthropic',
        duplicate_of_id: null, created_at: '2026-08-12T14:00:00Z',
      }],
    }),
  });
  const r = await run(d);
  t('a matching row from a DIFFERENT provider is linked as a duplicate', r.action === 'staged' && r.dup === true);
  t('...on the new row', d.db.tables.email_transactions[1].duplicate_of_id === 'existing-1');
}
{
  const d = deps({
    db: fakeDb({
      email_transactions: [{
        id: 'existing-2', gmail_message_id: 'other', amount: 250000, direction: 'debit',
        occurred_at: '2026-08-12T14:00:00+07:00', source_provider: 'MB Bank',
        duplicate_of_id: null, created_at: '2026-08-12T14:00:00Z',
      }],
    }),
  });
  const r = await run(d);
  t('two same-amount transfers from the SAME provider are two transactions', r.action === 'staged' && r.dup === false);
  console.log('        ^ same-provider repeats are real (two transfers minutes apart).');
}

console.log('\n-- template thrash guard, end to end --');
{
  // A v3 template stored by the forwarding pipeline for this exact sender+shape.
  const v3 = (() => {
    const fs = require('fs'), path = require('path');
    const src = fs.readFileSync(path.join(__dirname, 'bank-email-pipeline.gs'), 'utf8');
    eval(src.slice(src.indexOf('var EXTRACTION_LOGIC_VERSION'), src.indexOf('function upsertFingerprint')));
    return deriveExtractionTemplate(BODY, EXTRACTION);
  })();
  const d = deps({
    db: fakeDb({
      sender_fingerprints: [{
        sender_address: 'mbebanking@mbbank.com.vn',
        subject_template: extract.normalizeSubjectTemplate('Bien dong so du'),
        is_transaction_source: true, extraction_regex: v3,
      }],
    }),
  });
  const r = await run(d);
  t('a .gs v3 template is used as-is', r.action === 'staged' && d.llm.calls === 0);
  t('...and is NOT overwritten with a v4', d.db.tables.sender_fingerprints[0].extraction_regex === v3);
  console.log('        ^ overwriting it would make both pipelines re-derive forever.');
}

console.log('\n-- sealed staging: the server keeps nothing readable --');
{
  const sealedBox = require('./lib/sealed-box.js');
  const nacl = require('tweetnacl');
  const kp = nacl.box.keyPair();
  const pub = Buffer.from(kp.publicKey).toString('base64');

  const d = deps();
  d.staging = {
    async getFamilyKey() { return { familyId: 'fam-1', stagingPub: pub, pin: null }; },
    assertPinned(key) { return sealedBox.assertFamilyPubPinned(key.stagingPub, key.pin); },
    seal: (payload, p, fid, mid) => sealedBox.sealForFamily(payload, p, fid, mid),
  };

  const r = await run(d);
  t('stages a sealed row', r.action === 'staged' && r.sealed === true, JSON.stringify(r));

  const row = d.db.tables.email_transactions[0];
  t('NO plaintext amount on the row', row.amount === undefined);
  t('NO plaintext counterparty on the row', row.counterparty === undefined);
  t('NO raw body on the row', row.raw_body === undefined);
  t('NO raw_extracted on the row', row.raw_extracted === undefined);
  t('but occurred_at stays clear (locked rows still render)', !!row.occurred_at);
  t('and source_provider stays clear', row.source_provider === 'MB Bank');
  t('envelope is complete', !!(row.sealed && row.eph_pub && row.nonce) && row.enc_v === 1);

  const opened = sealedBox.openSealedRow(
    Object.assign({}, row, { family_id: 'fam-1', gmail_message_id: 'm1' }),
    kp.secretKey,
  );
  t('the family CAN open it', opened.amount === 250000);
  t('...including the memo', opened.memo === EXTRACTION.memo);
  console.log('        ^ the pipeline wrote a row it cannot read back.');
}

console.log('\n-- a family with no staging key HOLDS, it does not fall back to plaintext --');
{
  const d = deps();
  d.staging = {
    async getFamilyKey() { return null; },       // nobody has opened the app yet
    assertPinned() {},
    seal() { throw new Error('must not be called'); },
  };
  const r = await run(d);
  t('the message is deferred', r.action === 'deferred' && r.reason === 'awaiting_family_staging_key', JSON.stringify(r));
  t('NOTHING is written', d.db.tables.email_transactions.length === 0);
  console.log('        ^ writing plaintext "just for now" would reintroduce exactly');
  console.log('          the window sealing exists to remove. Self-healing: the family');
  console.log('          provisions a keypair on its next app open.');
}

console.log('\n-- a swapped family key refuses to seal --');
{
  const sealedBox = require('./lib/sealed-box.js');
  const nacl = require('tweetnacl');
  const realPub = Buffer.from(nacl.box.keyPair().publicKey).toString('base64');
  const attackerPub = Buffer.from(nacl.box.keyPair().publicKey).toString('base64');
  const d = deps();
  d.staging = {
    async getFamilyKey() { return { familyId: 'fam-1', stagingPub: attackerPub, pin: sealedBox.fingerprintFamilyPub(realPub) }; },
    assertPinned(key) { return sealedBox.assertFamilyPubPinned(key.stagingPub, key.pin); },
    seal: (p, pub, f, m) => sealedBox.sealForFamily(p, pub, f, m),
  };
  let threw = false;
  try { await run(d); } catch (e) { threw = /PIN_MISMATCH/.test(e.message); }
  t('sealing to an unrecognised key throws rather than proceeding', threw);
  t('...and nothing is staged', d.db.tables.email_transactions.length === 0);
}

console.log('\n-- syncConnection refuses to read an unrestricted mailbox --');
{
  const d = deps();
  d.providerDomains = [];
  d.gmail = { async listMessages() { throw new Error('should never be called'); }, async getMessage() {} };
  const r = await ingest.syncConnection(d, CONNECTION);
  t('no provider domains → no read at all', r.ok === true && r.reason === 'no_provider_domains' && r.listed === 0);
  console.log('        ^ "no banks configured" must never degrade into "read everything".');
}
{
  const d = deps();
  d.gmail = {
    async listMessages(q) { d._q = q; return [{ id: 'm1' }, { id: 'm2' }]; },
    async getMessage(id) { return msg({ id, body: id === 'm2' ? BODY.replace('250,000', '99,000') : BODY }); },
  };
  const r = await ingest.syncConnection(d, CONNECTION);
  t('sync stages both messages', r.staged === 2, JSON.stringify(r));
  t('...and the query was sender-restricted', /from:mbbank\.com\.vn/.test(d._q));
  t('...spending exactly one LLM call for the pair', r.llmCalls === 1);
}

console.log('\n' + (fail === 0 ? 'ALL ' + pass + ' PASSED' : pass + ' passed, ' + fail + ' FAILED'));
process.exit(fail ? 1 : 0);

})();
