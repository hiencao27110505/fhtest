#!/usr/bin/env node
/* What the reader found reaches the sealed row.
 * `node pipeline/reader-verdict-sealed.test.js`
 *
 * A box is never amended, so a field the mapper drops is a field every row
 * seals without, for good (docs/specs/email-reading-v2-spec.md §2, §4 "the
 * mapping is the wire"). Three were being dropped on 2026-09-21:
 *
 *   status        worker.mjs `_toReading` had no such key, so stage.mjs read
 *                 reading.status as undefined on every direct-read row
 *   the reader's  stage.mjs derives transaction_type from the SENDER KIND, on
 *   verdict       purpose (the device's dedup rule tells a bank from a non-bank
 *                 by it), so "this is a transfer to a person" never arrived
 *   the raw       `counterparty_display || counterparty` kept only the tidied
 *   counterparty  name; the string the mail printed was gone
 *
 * Pinned here, against the REAL runGrant and the REAL opener:
 *   • transaction_type is UNCHANGED (still derived from the sender kind)
 *   • reader_type and sender_kind are new keys INSIDE raw_extracted
 *   • counterparty stays the display form; counterparty_raw is the verbatim
 *     string, only when the two differ
 *   • nothing new appears as a top-level payload key or a row column (0068)
 *   • the Python caller's transaction_type becomes reader_type on ingest
 *
 * Fixtures are synthetic.
 */
const nacl = await import('tweetnacl').then(m => m.default || m);
const crypto = await import('node:crypto').then(m => m.default || m);
const url = await import('node:url');
const HERE = url.fileURLToPath(new URL('.', import.meta.url));
const ROOT = HERE + '../supabase/functions/_shared/mailbox/';
const W  = await import(ROOT + 'worker.mjs');
const S  = await import(ROOT + 'stage.mjs');
const I  = await import(ROOT + 'ingest.mjs');
const SB = await import(ROOT + 'sealed-box.mjs');
const TC = await import(ROOT + 'token-crypto.mjs');

globalThis.atob = globalThis.atob || ((b64) => Buffer.from(b64, 'base64').toString('binary'));
globalThis.btoa = globalThis.btoa || ((s) => Buffer.from(s, 'binary').toString('base64'));

let pass = 0, fail = 0;
const t = (n, ok, d) => { console.log((ok ? '  PASS  ' : '  FAIL  ') + n + (!ok && d !== undefined ? '  -> ' + JSON.stringify(d) : '')); ok ? pass++ : fail++; };

const FAM_SEC = new Uint8Array(crypto.randomBytes(32));
const FAM_PUB = Buffer.from(nacl.box.keyPair.fromSecretKey(FAM_SEC).publicKey).toString('base64');
const open = (row) => SB.openSealedRow({ ...row, family_id: 'f1' }, FAM_SEC, { nacl });
const DEST = { memberId: 'm1', familyId: 'f1', stagingPub: FAM_PUB };
const deps = { nacl, dedupKey: crypto.randomBytes(32).toString('base64'), subtle: crypto.webcrypto.subtle };
const BASE = { amount: 90000, direction: 'debit', currency: 'VND', occurredAt: '2026-09-20T01:15:00.000Z' };

/* ── stage.mjs ───────────────────────────────────────────────────────────── */
console.log('\n-- buildStagedRow: two new keys, inside the box only --');
{
  const row = await S.buildStagedRow({ gmailMessageId: 'g-1', destination: DEST, deps,
    sourceProvider: 'ZQ Bank', senderKind: 'bank',
    reading: { ...BASE, merchant: 'ZQ MART 01', merchantRaw: 'MPOS*ZQ MART 01 HO CHI MINH VN',
               readerType: 'p2p_transfer', status: 'Thành công' } });
  const o = open(row);
  t('transaction_type is still the sender-kind derivation', o.transaction_type === 'bank_txn' && o.raw_extracted.transaction_type === 'bank_txn', o.transaction_type);
  t('reader_type carries the reader\'s own verdict', o.raw_extracted.reader_type === 'p2p_transfer', o.raw_extracted.reader_type);
  t('sender_kind says why transaction_type reads as it does', o.raw_extracted.sender_kind === 'bank', o.raw_extracted.sender_kind);
  t('counterparty is the display form, as before', o.counterparty === 'ZQ MART 01' && o.raw_extracted.counterparty === 'ZQ MART 01');
  t('counterparty_raw is the verbatim string', o.raw_extracted.counterparty_raw === 'MPOS*ZQ MART 01 HO CHI MINH VN', o.raw_extracted.counterparty_raw);
  t('status is sealed', o.raw_extracted.status === 'Thành công');
  const top = Object.keys(o);
  t('no new TOP-LEVEL payload key', !top.some((k) => ['reader_type', 'sender_kind', 'counterparty_raw', 'status'].includes(k)), top);
  t('no new row column', !Object.keys(row).some((k) => ['reader_type', 'sender_kind', 'counterparty_raw', 'status'].includes(k)), Object.keys(row));
  for (const col of S.MUST_BE_NULL_WHEN_SEALED) {
    t(col + ' is still absent from the sealed row (0068)', row[col] === undefined || row[col] === null);
  }
}
{
  const row = await S.buildStagedRow({ gmailMessageId: 'g-2', destination: DEST, deps,
    sourceProvider: 'ZQ Pay', senderKind: 'wallet',
    reading: { ...BASE, merchant: 'ZQ MART 01', merchantRaw: 'ZQ MART 01', readerType: 'made_up_type' } });
  const o = open(row);
  t('identical raw and display → counterparty_raw null (nothing to add)', o.raw_extracted.counterparty_raw === null);
  t('a verdict outside the closed vocabulary seals as null', o.raw_extracted.reader_type === null);
  t('a wallet still reads as a receipt', o.transaction_type === 'ecommerce_receipt' && o.raw_extracted.sender_kind === 'wallet');
}
{
  const row = await S.buildStagedRow({ gmailMessageId: 'g-3', destination: DEST, deps,
    sourceProvider: 'x', senderKind: undefined,
    reading: { ...BASE, merchant: null, merchantRaw: 'Kính gửi NGUYEN VAN A' } });
  const o = open(row);
  t('a counterparty the tidy layer rejected does not come back as "raw"', o.raw_extracted.counterparty_raw === null && o.raw_extracted.counterparty === null);
  t('an unknown sender kind seals as null, not as a guess', o.raw_extracted.sender_kind === null);
  t('no verdict → reader_type null', o.raw_extracted.reader_type === null);
}
for (const v of S.READER_TYPES) {
  const row = await S.buildStagedRow({ gmailMessageId: 'g-' + v, destination: DEST, deps,
    sourceProvider: 'x', senderKind: 'bank', reading: { ...BASE, readerType: v } });
  t('reader verdict "' + v + '" is sealed as given', open(row).raw_extracted.reader_type === v);
}

/* ── ingest.mjs ──────────────────────────────────────────────────────────── */
console.log('\n-- normaliseReading: the caller\'s transaction_type becomes reader_type --');
{
  const r = I.normaliseReading({ amount: 1, direction: 'debit', transaction_type: 'bill_payment',
    counterparty: 'PAYOO*ZQ DIEN LUC VN', status: 'completed' }, '');
  t('transaction_type → readerType', r.readerType === 'bill_payment', r.readerType);
  t('the tidied merchant is what the device reads', r.merchant === 'ZQ DIEN LUC', r.merchant);
  t('the verbatim one rides beside it', r.merchantRaw === 'PAYOO*ZQ DIEN LUC VN', r.merchantRaw);
  t('status still mapped', r.status === 'completed');
  const row = await S.buildStagedRow({ gmailMessageId: 'g-in', destination: DEST, deps,
    sourceProvider: 'ZQ', senderKind: 'bank', reading: { ...r, amount: 5000, occurredAt: BASE.occurredAt } });
  const o = open(row);
  t('and it seals: reader_type, counterparty_raw', o.raw_extracted.reader_type === 'bill_payment' && o.raw_extracted.counterparty_raw === 'PAYOO*ZQ DIEN LUC VN', o.raw_extracted);
  t('...while transaction_type stays the sender-kind derivation', o.transaction_type === 'bank_txn');
}
t('an explicit reader_type from the caller wins over its transaction_type',
  I.normaliseReading({ amount: 1, direction: 'debit', reader_type: 'subscription', transaction_type: 'bank_txn' }, '').readerType === 'subscription');

/* ── worker.mjs, end to end: _toReading is the wire ──────────────────────── */
console.log('\n-- runGrant: what the table reader found is inside the staged row --');
const TOKEN_KEY = crypto.randomBytes(32).toString('base64');
const ENC = await TC.encryptToken('r-token', TOKEN_KEY, { subtle: crypto.webcrypto.subtle });
const b64u = (s) => Buffer.from(s, 'utf8').toString('base64url');
const BODIES = {
  'p2p-1': ['Ngay, gio giao dich', '2026-09-20 08:15:00', 'Ten nguoi huong', 'LE VAN C',
            'So tien', '-250,000 VND', 'Noi dung', 'tien nha thang chin', 'Tinh trang', 'Giao dich thanh cong'].join('\n'),
  'card-1': ['Ngay, gio giao dich', '2026-09-20 09:30:00', 'Diem giao dich', 'MPOS*ZQ MART 01 HO CHI MINH VN',
             'So tien', '-90,000 VND'].join('\n'),
};
const rows = new Map();
const ctx = {
  db: {
    async memberById() { return { id: 'm1', family_id: 'f1', archived_at: null }; },
    async stagingPubForFamily() { return FAM_PUB; },
    async stagingPubForUser() { return FAM_PUB; },
    async providerDomains() { return [{ domain_or_address: 'zqbank.example', provider_name: 'ZQ Bank' }]; },
    async alreadyStaged() { return new Set(); },
    async stagedState() { return { staged: new Set(), resolved: new Map() }; },
    async stagedCandidates() { return []; },
    async insertStaged(r) { rows.set(r.gmail_message_id, r); return true; },
    async recordFailure() {}, async markSynced() {},
    async fingerprint() { return null; },
    async fingerprintsForSenders() { return new Map(); },
    async saveFingerprint() {}, async bumpReadTally() {},
    async recordStall() {}, async clearStall() {}, async pendingCount() { return 1; },
  },
  nacl, rng: crypto.webcrypto, subtle: crypto.webcrypto.subtle,
  dedupKey: crypto.randomBytes(32).toString('base64'),
  tokenKey: TOKEN_KEY, fromBytea: (v) => v,
  google: { clientId: 'c', clientSecret: 's' },
  llm: { apiKey: null },
  notify: async () => {},
  fetch: async (u) => {
    u = String(u);
    if (u.startsWith('https://oauth2.googleapis.com/token'))
      return { ok: true, status: 200, json: async () => ({ access_token: 'at', expires_in: 3600 }),
               text: async () => '{"access_token":"at","expires_in":3600}' };
    if (u.includes('/messages?') || u.endsWith('/messages')) {
      const p = { messages: Object.keys(BODIES).map((id) => ({ id })) };
      return { ok: true, status: 200, json: async () => p, text: async () => JSON.stringify(p) };
    }
    const m = u.match(/\/messages\/([^?]+)\?format=(\w+)/);
    if (m) {
      const id = m[1];
      const msg = { id, threadId: 't' + id, internalDate: String(Date.now()), payload: {
        headers: [{ name: 'From', value: 'ZQ Bank <ebanking@zqbank.example>' },
                  { name: 'Subject', value: 'Thong bao giao dich ' + (id === 'p2p-1' ? 'chuyen khoan' : 'the') },
                  { name: 'Date', value: new Date().toUTCString() },
                  { name: 'Authentication-Results', value: 'mx.google.com; dkim=pass header.d=zqbank.example' }],
        mimeType: 'text/plain' } };
      if (m[2] === 'full') msg.payload.body = { data: b64u(BODIES[id]) };
      return { ok: true, status: 200, json: async () => msg, text: async () => JSON.stringify(msg) };
    }
    throw new Error('unstubbed ' + u);
  },
};
await W.runGrant({ id: 'g1', user_id: 'u1', member_id: 'm1', family_id: 'f1',
  email: 'x@gmail.com', needs_reauth: false, refresh_token_enc: ENC,
  last_synced_at: new Date().toISOString(), backfilled_at: '2026-08-28T00:00:00Z',
  backfilled_days: 90, backfill_days: 90, default_scope: 'family', stalled_runs: 0 }, ctx);

t('both mails staged', rows.has('p2p-1') && rows.has('card-1'), [...rows.keys()]);
if (rows.has('p2p-1')) {
  const o = open(rows.get('p2p-1'));
  t('the transfer\'s reader verdict arrived: p2p_transfer', o.raw_extracted.reader_type === 'p2p_transfer', o.raw_extracted.reader_type);
  t('the mail\'s own status arrived', o.raw_extracted.status === 'Giao dich thanh cong', o.raw_extracted.status);
  t('sender_kind is the registry\'s', typeof o.raw_extracted.sender_kind === 'string' && S.transactionTypeFor(o.raw_extracted.sender_kind) === o.transaction_type, o.raw_extracted.sender_kind);
}
if (rows.has('card-1')) {
  const o = open(rows.get('card-1'));
  t('the card row keeps the tidy name the device reads', o.raw_extracted.counterparty === 'ZQ MART 01', o.raw_extracted.counterparty);
  t('and the string the mail printed', o.raw_extracted.counterparty_raw === 'MPOS*ZQ MART 01 HO CHI MINH VN', o.raw_extracted.counterparty_raw);
  t('reader verdict: a receipt', o.raw_extracted.reader_type === 'ecommerce_receipt');
}

console.log('\n' + (fail === 0 ? 'ALL ' + pass + ' PASSED' : pass + ' passed, ' + fail + ' FAILED'));
process.exit(fail ? 1 : 0);
