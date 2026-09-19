#!/usr/bin/env node
/* Statement capture, server side: from a Gmail attachment to a sealed object and
 * one locked card. `node pipeline/statement-lane.test.js`
 *
 * Drives the REAL lane (statement.mjs) with a fake Gmail and a fake database, and
 * REAL encryption: the sealed blob is opened with the matching private key and the
 * bytes compared, so this proves what the device will be able to do, not something
 * adjacent to it. (docs/specs/statement-capture-spec.md)
 *
 * The promises pinned here:
 *   - nothing is captured without consent v5, and nothing without a personal key
 *   - the file is sealed to the PERSONAL key even on a family-scoped grant
 *   - a rate-limited model leaves the mail UNDECIDED (no row), never "not a statement"
 *   - a known format costs zero model calls, month after month
 *   - a second run over the same mailbox captures nothing twice
 *   - the transaction loop is told which mails are statements and leaves them alone
 */
const nacl = await import('tweetnacl').then(m => m.default || m);
const crypto = await import('node:crypto').then(m => m.default || m);
const url = await import('node:url');
const HERE = url.fileURLToPath(new URL('.', import.meta.url));
const ROOT = HERE + '../supabase/functions/_shared/mailbox/';
const ST = await import(ROOT + 'statement.mjs');
const SB = await import(ROOT + 'sealed-box.mjs');
const W  = await import(ROOT + 'worker.mjs');
const TC = await import(ROOT + 'token-crypto.mjs');

let pass = 0, fail = 0;
const t = (n, ok, d) => { console.log((ok ? '  PASS  ' : '  FAIL  ') + n + (!ok && d !== undefined ? '  -> ' + JSON.stringify(d) : '')); ok ? pass++ : fail++; };

const PERSONAL = nacl.box.keyPair();
const FAMILY = nacl.box.keyPair();
const PERSONAL_PUB = Buffer.from(PERSONAL.publicKey).toString('base64');
const FAMILY_PUB = Buffer.from(FAMILY.publicKey).toString('base64');
const b64u = (buf) => Buffer.from(buf).toString('base64url');
const FILE = new Uint8Array(crypto.randomBytes(4096));          // stands in for a locked .xlsx
const OWNER = '11111111-1111-4111-8111-111111111111';

/* Three mails from known senders, each with a spreadsheet attached. */
const MAILS = {
  card: { from: 'Ngan Hang Quoc Te (VIB) <info@card.vib.com.vn>', subject: 'SAO KE THE TIN DUNG VIB CASH BACK THANG 09 NAM 2026',
          body: 'Quy khach vui long xem sao ke the dinh kem. So the 513892******4751.', file: 'vib_saoke_09_2026.xlsx' },
  wallet: { from: 'MoMo <no-reply@mservice.com.vn>', subject: 'Sao kê lịch sử giao dịch',
            body: 'MoMo xin gửi tới Quý khách Chi tiết giao dịch cho số ví 0900000001 từ ngày 20/06/2026 đến ngày 18/09/2026.', file: '0900000001_24307969.xlsx' },
  invoice: { from: 'VIB <info@myvib.vib.com.vn>', subject: 'Hoa don dien tu so 0012345', body: 'Kinh gui Quy khach hoa don dien tu.', file: 'hoadon.xlsx' },
};
function gmailMessage(id) {
  const m = MAILS[id];
  return { id, threadId: 't' + id, internalDate: String(Date.parse('2026-09-18T16:38:00Z')),
    payload: { mimeType: 'multipart/mixed',
      headers: [{ name: 'From', value: m.from }, { name: 'Subject', value: m.subject }],
      parts: [
        { mimeType: 'text/plain', body: { data: b64u(Buffer.from(m.body, 'utf8')) } },
        { mimeType: 'application/octet-stream', filename: m.file, body: { attachmentId: 'att-' + id, size: FILE.length } },
        { mimeType: 'image/png', filename: 'logo.png', body: { attachmentId: 'att-logo', size: 900 } },
      ] } };
}

function makeCtx(opts) {
  opts = opts || {};
  const store = { files: [], objects: new Map(), shapes: new Map(opts.shapes || []), failures: [], rescanned: false, banners: [], queries: [], modelAsked: 0, attFetched: [] };
  const ok = (body) => ({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) });
  const ctx = {
    store,
    access: 'at', domains: [], days: 2, backfillDays: 90,
    nacl, rng: crypto.webcrypto, subtle: crypto.webcrypto.subtle,
    llm: { apiKey: opts.noModel ? null : 'k' },
    notify: async (grant, count, meta) => { store.banners.push({ count, meta }); },
    db: {
      async consentVersion() { return opts.consent === undefined ? 5 : opts.consent; },
      async stagingPubForUser() { return opts.noPersonalKey ? null : PERSONAL_PUB; },
      async stagingPubForFamily() { return FAMILY_PUB; },
      async statementRescanOwed() { return !!opts.rescan && !store.rescanned; },
      async markStatementRescanned() { store.rescanned = true; },
      async statementKnown(ids) { return new Set(store.files.map(f => f.gmail_message_id).filter(x => ids.indexOf(x) >= 0)); },
      async statementShape(sender, shape) { const v = store.shapes.get(sender + '|' + shape); return v === undefined ? null : { is_statement: v }; },
      async saveStatementShape(sender, shape, v) { store.shapes.set(sender + '|' + shape, v); },
      async insertStatementFile(row) {
        if (store.files.some(f => f.gmail_message_id === row.gmail_message_id && f.part_index === row.part_index)) return false;
        store.files.push(row); return true;
      },
      async uploadStatementObject(path, bytes) { store.objects.set(path, bytes); },
      async deleteStatementObjects(paths) { paths.forEach(p => store.objects.delete(p)); return true; },
      async recordFailure(r) { store.failures.push(r); },
    },
    fetch: async (u, init) => {
      u = String(u);
      if (u.includes('generativelanguage')) {
        store.modelAsked++;
        if (opts.model429) return { ok: false, status: 429, json: async () => ({}), text: async () => '{"error":{"code":429}}' };
        const asked = JSON.parse(init.body).contents[0].parts[0].text;
        const yes = /sao k|statement|lịch sử giao dịch/i.test(asked) && !/hoa don/i.test(asked);
        return ok({ candidates: [{ content: { parts: [{ text: JSON.stringify({ is_statement: yes }) }] } }] });
      }
      if (u.includes('/messages?')) { store.queries.push(decodeURIComponent(u)); return ok({ messages: (opts.ids || ['card', 'wallet', 'invoice']).map(id => ({ id })) }); }
      let m = u.match(/\/messages\/([^/?]+)\/attachments\/([^?]+)/);
      if (m) { store.attFetched.push(m[2]); return ok({ size: FILE.length, data: b64u(FILE) }); }
      m = u.match(/\/messages\/([^?]+)\?format=full/);
      if (m) return ok(gmailMessage(m[1]));
      throw new Error('unstubbed fetch: ' + u);
    },
  };
  return ctx;
}
const grant = (over) => Object.assign({ id: 'g1', user_id: OWNER, member_id: 'm1', family_id: 'f1', email: 'me@gmail.com', default_scope: 'family' }, over || {});

console.log('\n-- helpers --');
t('xlsx and csv are statements by name, nothing else is', ST.statementExt('a.XLSX') === 'xlsx' && ST.statementExt('b.csv') === 'csv' && ST.statementExt('c.pdf') === '' && ST.statementExt('d.xls') === '' && ST.statementExt('e.zip') === '');
t('the verdict key drops EVERY digit, so one verdict covers every month',
  ST.statementShape('SAO KE THE TIN DUNG VIB CASH BACK THANG 09 NAM 2026') === ST.statementShape('SAO KE THE TIN DUNG VIB CASH BACK THANG 10 NAM 2026'));
t('...and a forward prefix lands on the same key', ST.statementShape('Fwd: Sao kê tài khoản') === ST.statementShape('Sao kê tài khoản'));
t('the lane lists files only, from known senders only', /has:attachment \(filename:xlsx OR filename:csv\)$/.test(ST.statementQuery(2, [])) && /^\(from:/.test(ST.statementQuery(2, [])));
var d = ST.statementDetails(MAILS.wallet.subject, MAILS.wallet.body);
t('period read from the mail\'s own words', d.period_from === '2026-06-20' && d.period_to === '2026-09-18', d);
t('only the account TAIL is read, never the number', d.account_tail === '0001' && JSON.stringify(d).indexOf('0900000001') < 0, d);
t('a month-only subject still gives a period', ST.statementDetails(MAILS.card.subject, '').period_month === '2026-09');

console.log('\n-- the seeded formats match what the code computes, byte for byte --');
const fs = await import('node:fs');
const SEED = fs.readFileSync(HERE + '../supabase/migrations/0140_statement_shapes_seed.sql', 'utf8');
for (const [addr, subj] of [['info@card.vib.com.vn', MAILS.card.subject], ['info@myvib.vib.com.vn', 'Sao kê tài khoản'], ['no-reply@mservice.com.vn', MAILS.wallet.subject]]) {
  t('seed for ' + addr, SEED.includes("('" + addr + "',") && SEED.includes("'" + ST.statementShape(subj) + "'"), ST.statementShape(subj));
}
t('the consent version here equals the client\'s', new RegExp('var FH_CONSENT_V = ' + ST.STATEMENT_CONSENT_V + ';').test(fs.readFileSync(HERE + '../src/js-data/75-consent-ui.js', 'utf8')));

console.log('\n-- the gates: consent, then a key to seal to --');
var c = makeCtx({ consent: 4 }); var r = await ST.runStatementLane(grant(), c);
t('consent v4 captures nothing', r.summary.status === 'no_consent' && c.store.files.length === 0);
t('...and spends no Gmail call finding that out', c.store.queries.length === 0);
c = makeCtx({ noPersonalKey: true }); r = await ST.runStatementLane(grant(), c);
t('no personal staging key: HOLD, never a family-key fallback', r.summary.status === 'held' && c.store.files.length === 0 && c.store.objects.size === 0);
c = makeCtx({}); delete c.db.consentVersion; r = await ST.runStatementLane(grant(), c);
t('a database from before this feature simply has no lane', r.summary.status === 'off');

console.log('\n-- capture --');
c = makeCtx({}); c.statementModelCalls = 3; r = await ST.runStatementLane(grant(), c);
t('two statements captured, the invoice rejected', r.summary.captured === 2 && r.summary.rejected === 1, r.summary);
t('only the spreadsheet is fetched, never the logo', c.store.attFetched.length === 2 && c.store.attFetched.every(a => a !== 'att-logo'), c.store.attFetched);
var card = c.store.files.find(f => f.gmail_message_id === 'card');
t('row: pending, personal path, 90-day default left to the database', card.status === 'pending' && card.object_path === OWNER + '/' + card.id + '.sealed' && card.bytes_source === 'sealed_object');
t('row: provider in the clear, canonical', /VIB/.test(card.source_provider), card.source_provider);
t('row: NO file name, subject, period or account tail in the clear',
  !/saoke|SAO KE|2026-09|4751/.test(JSON.stringify(Object.assign({}, card, { meta_sealed: '', received_at: '' }))));
var blob = c.store.objects.get(card.object_path);
t('the stored object is not the file', blob && blob.length === FILE.length + 32 + 24 + 16 && Buffer.compare(Buffer.from(blob.subarray(56, 56 + 64)), Buffer.from(FILE.subarray(0, 64))) !== 0);
t('the PERSONAL key opens it, byte for byte', Buffer.compare(Buffer.from(SB.openSealedBytes(blob, PERSONAL.secretKey, { nacl })), Buffer.from(FILE)) === 0);
var famOpen = null; try { famOpen = SB.openSealedBytes(blob, FAMILY.secretKey, { nacl }); } catch (e) { famOpen = 'refused'; }
t('the FAMILY key does not, even on a family-scoped grant', famOpen === 'refused');
var meta = JSON.parse(new TextDecoder().decode(nacl.box.open(SB.unb64(card.meta_sealed), SB.unb64(card.meta_nonce), SB.unb64(card.meta_eph_pub), PERSONAL.secretKey)));
t('sealed metadata binds the owner and the message', meta.owner_user_id === OWNER && meta.gmail_message_id === 'card' && meta.family_id === undefined, meta);
t('...and carries the file name, period and tail', meta.filename === MAILS.card.file && meta.period_month === '2026-09' && meta.account_tail === '4751', meta);
t('...and the hash that ties the blob to it', meta.file_sha256 === crypto.createHash('sha256').update(FILE).digest('hex'));
var inv = c.store.files.find(f => f.gmail_message_id === 'invoice');
t('a rejected mail is remembered per message, with no object', inv.status === 'rejected' && !inv.object_path && c.store.objects.size === 2);
t('...and logged, so a wrong "no" can be found', c.store.failures.length === 1 && /^statement_rejected:/.test(c.store.failures[0].error_reason));
t('all three mails are handed to the transaction loop as "mine"', ['card', 'wallet', 'invoice'].every(id => r.messageIds.has(id)));
t('one push, its own flag, no bank and no number in the meta', c.store.banners.length === 1 && c.store.banners[0].meta.statement === true && Object.keys(c.store.banners[0].meta).length === 1);

console.log('\n-- the model: once per format, and a limit never loses --');
var asked1 = c.store.modelAsked;
t('each unknown format was asked about exactly once', asked1 === 3, asked1);
r = await ST.runStatementLane(grant(), c);
t('second run: nothing captured twice', r.summary.captured === 0 && c.store.files.length === 3, r.summary);
t('...and no further model calls', c.store.modelAsked === asked1);
var slow = makeCtx({}); r = await ST.runStatementLane(grant(), slow);
t('default allowance: two calls a run, the third mail waits undecided', slow.store.modelAsked === 2 && r.summary.undecided === 1 && r.summary.status === 'more' && slow.store.files.length === 2, r.summary);
r = await ST.runStatementLane(grant(), slow);
t('...and is decided on the next run, nothing lost', slow.store.files.length === 3 && slow.store.modelAsked === 3 && r.summary.status === 'ok', r.summary);
var next = makeCtx({ shapes: Array.from(c.store.shapes.entries()), ids: ['card'] });
r = await ST.runStatementLane(grant(), next);
t('next month, same format: zero model calls', next.store.modelAsked === 0 && r.summary.captured === 1);
c = makeCtx({ model429: true }); r = await ST.runStatementLane(grant(), c);
t('rate-limited: no row at all, so the mail is met again next run', c.store.files.length === 0 && r.summary.undecided >= 1 && r.summary.status === 'more', r.summary);
t('...and it is NOT remembered as "not a statement"', c.store.shapes.size === 0);
c = makeCtx({ noModel: true }); r = await ST.runStatementLane(grant(), c);
t('no model key: same, undecided rather than rejected', c.store.files.length === 0 && r.summary.undecided >= 1);

console.log('\n-- the one-time history re-scan --');
var seeded = [['info@card.vib.com.vn|' + ST.statementShape(MAILS.card.subject), true], ['no-reply@mservice.com.vn|' + ST.statementShape(MAILS.wallet.subject), true], ['info@myvib.vib.com.vn|' + ST.statementShape(MAILS.invoice.subject), false]];
c = makeCtx({ rescan: true, shapes: seeded }); r = await ST.runStatementLane(grant(), c);
t('reads the person\'s chosen window, not two days', /newer_than:90d/.test(c.store.queries[0]), c.store.queries[0]);
t('history finds are flagged for the "Sao kê cũ" fold', c.store.files.filter(f => f.status === 'pending').every(f => f.backfill === true));
t('...and stay quiet: no push for history', c.store.banners.length === 0);
t('marked done once the listing is worked through', c.store.rescanned === true);
c = makeCtx({ rescan: true, model429: true }); r = await ST.runStatementLane(grant(), c);
t('NOT marked done while anything is undecided', c.store.rescanned === false);

console.log('\n-- inside the real worker --');
const TOKEN_KEY = crypto.randomBytes(32).toString('base64');
const ENC = await TC.encryptToken('r-token', TOKEN_KEY, { subtle: crypto.webcrypto.subtle });
var full = makeCtx({ shapes: seeded });
var bodyFetched = [];
var laneFetch = full.fetch;
Object.assign(full, { tokenKey: TOKEN_KEY, fromBytea: v => v, google: { clientId: 'c', clientSecret: 's' }, dedupKey: crypto.randomBytes(32).toString('base64'),
  fetch: async (u, init) => {
    u = String(u);
    if (u.startsWith('https://oauth2.googleapis.com/token')) return { ok: true, status: 200, json: async () => ({ access_token: 'at', expires_in: 3600 }), text: async () => '{"access_token":"at","expires_in":3600}' };
    const meta = u.match(/\/messages\/([^?]+)\?format=metadata/);
    if (meta) { bodyFetched.push('meta:' + meta[1]); const g = gmailMessage(meta[1]); return { ok: true, status: 200, json: async () => g, text: async () => '' }; }
    return laneFetch(u, init);
  } });
Object.assign(full.db, {
  async memberById() { return { id: 'm1', family_id: 'f1', archived_at: null }; },
  async providerDomains() { return []; }, async stagedState() { return { staged: new Set(), resolved: new Map() }; },
  async stagedCandidates() { return []; }, async insertStaged() { return true; }, async markSynced() {}, async fingerprint() { return null; },
  async fingerprintsForSenders() { return new Map(); }, async saveFingerprint() {}, async bumpReadTally() {}, async recordStall() {}, async clearStall() {}, async pendingCount() { return 0; },
});
var out = await W.runGrant(Object.assign(grant(), { needs_reauth: false, refresh_token_enc: ENC, last_synced_at: new Date().toISOString(), backfilled_at: new Date().toISOString(), backfill_days: 90, stalled_runs: 0 }), Object.assign(full, { budget: { spend: () => false, used: () => 0, left: () => 0 } }));
t('the worker reports the lane in its summary', out.statements && out.statements.captured === 2, out.statements);
t('...and the transaction loop never touches a statement mail', bodyFetched.length === 0 && out.staged === 0, { bodyFetched, status: out.status });
var broken = makeCtx({});
broken.db.statementKnown = async () => { throw new Error('db down'); };
Object.assign(broken, { tokenKey: TOKEN_KEY, fromBytea: v => v, google: { clientId: 'c', clientSecret: 's' }, dedupKey: full.dedupKey, fetch: full.fetch }); Object.assign(broken.db, full.db, { statementKnown: broken.db.statementKnown });
out = await W.runGrant(Object.assign(grant(), { needs_reauth: false, refresh_token_enc: ENC, last_synced_at: new Date().toISOString(), backfilled_at: new Date().toISOString(), backfill_days: 90, stalled_runs: 0 }), Object.assign(broken, { budget: { spend: () => false, used: () => 0, left: () => 0 } }));
t('a failing lane never costs the transaction run', out.statements.status === 'error' && out.status !== 'error', { lane: out.statements, status: out.status });

console.log('\n' + (fail ? fail + ' FAILED, ' : 'ALL ') + pass + ' PASSED');
process.exit(fail ? 1 : 0);
