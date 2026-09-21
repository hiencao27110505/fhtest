#!/usr/bin/env node
/* A bank's domain is also where its staff have their mailboxes.
 * `node pipeline/sender-gate.test.js`
 *
 * The Gmail query is `from:<bank domain>`. On 2026-09-16 one backfill read the
 * private mail of about 26 bank staff: 50 mails went to the model, and their
 * hand-written subjects (names, phone numbers) were cached in plaintext in a
 * table every family shares (docs/specs/email-reading-v2-spec.md §7 R18, §11).
 *
 * Pinned:
 *   • isPersonShaped: firstname.lastname at a non-free-mail domain, no role word
 *   • EVERY role address this repo has ever seen stays a role address (a bank
 *     caught by this gate would silently lose its model tier)
 *   • a person-shaped sender is still READ by the free local tiers, is never
 *     sent to the model, and leaves NO row: no fingerprint, no derive failure
 *   • that holds at budget zero too: it is settled, never held
 *   • the worker's metadata-first pass does not hold such a sender as
 *     "model-bound" even when an old fingerprint row says it is
 *   • the Apps Script never caches under a free-mail forwarder's own address
 *
 * All names and addresses are synthetic.
 */
const fs = await import('node:fs');
const nodeCrypto = await import('node:crypto').then(m => m.default || m);
const nacl = await import('tweetnacl').then(m => m.default || m);
const url = await import('node:url');
const HERE = url.fileURLToPath(new URL('.', import.meta.url));
const ROOT = HERE + '../supabase/functions/_shared/mailbox/';
const S  = await import(ROOT + 'senders.mjs');
const X  = await import(ROOT + 'extract.mjs');
const W  = await import(ROOT + 'worker.mjs');
const TC = await import(ROOT + 'token-crypto.mjs');

let pass = 0, fail = 0;
const t = (n, ok, d) => { console.log((ok ? '  PASS  ' : '  FAIL  ') + n + (!ok && d !== undefined ? '  -> ' + JSON.stringify(d) : '')); ok ? pass++ : fail++; };

console.log('\n-- every role address the repo has seen is NOT a person --');
const ROLE_ADDRESSES = [
  // named in the task / in senders.mjs comments
  'hsbc.vietnam@notification.hsbc.com.hk', 'myvib.info@vib.com.vn', 'info@myvib.vib.com.vn',
  'no-reply@momo.vn', 'mbebanking@mbbank.com.vn', 'vcbdigibank@info.vietcombank.com.vn',
  'VCBDigibank@info.vietcombank.com.vn', 'no-reply@mail.acb.com.vn', 'no-reply@mb.vn',
  'no-reply@grab.com', 'no_reply@email.apple.com', 'card@marketing.vib.com.vn', 'marketing@promotion.vib.com.vn',
  // every sender address in pipeline/ fixtures
  'info@card.vib.com.vn', 'info@info.vietcombank.com.vn', 'loyalty@info.vietcombank.com.vn',
  'dvkh247@vib.com.vn', 'hotro@mbbank.com.vn', 'mb@mbbank.com.vn', 'mbcard@mbbank.com.vn',
  'no-reply@mbbank.com.vn', 'noreply@mail.mbbank.com.vn', 'no-reply@mservice.com.vn',
  'no-reply@techcombank.com.vn', 'no-reply@zalopay.vn', 'new@bank.com.vn',
  'alerts@some-bank-we-have-not-listed.vn',
  // plausible dotted ROLE forms: the shape matches, the role word saves them
  'card.center@zqbank.example', 'e.statement@zqbank.example', 'estatement.info@zqbank.example',
  'info2.cskh@zqbank.example', 'tpbank.ebanking@tpb.vn', 'support.vn@zqbank.example', 'no.reply@zqbank.example',
  'customer.service@zqbank.example', 'alert.system@zqbank.example', 'bank.news@zqbank.example',
];
for (const a of ROLE_ADDRESSES) t(a, S.isPersonShaped(a) === false);
t('a whole From header works too', S.isPersonShaped('"VIB" <myvib.info@vib.com.vn>') === false);

console.log('\n-- and a person is a person --');
for (const a of ['an.nguyen@zqbank.example', 'van.a.nguyen@vib.com.vn', 'an2.nguyen@mbbank.com.vn',
  'thi.b.tran.le@techcombank.com.vn', '"Nguyen Van A" <an.nguyen@vib.com.vn>', 'AN.NGUYEN@VIB.COM.VN']) {
  t(a, S.isPersonShaped(a) === true);
}
t('a role word is matched as a WHOLE token, never a substring ("bankole" is a surname)', S.isPersonShaped('an.bankole@zqbank.example') === true);
t('free mail is not "person-shaped at a bank": that is the forwarder case', S.isPersonShaped('an.nguyen@gmail.com') === false);
t('no dot, no verdict', S.isPersonShaped('annguyen@zqbank.example') === false);
t('garbage in, false out', S.isPersonShaped('') === false && S.isPersonShaped(null) === false && S.isPersonShaped('not an address') === false);

console.log('\n-- isFreeMail --');
t('gmail', S.isFreeMail('someone.else@gmail.com') && S.isFreeMail('A <a.b@googlemail.com>'));
t('yahoo, outlook, icloud', S.isFreeMail('x@yahoo.com') && S.isFreeMail('x@outlook.com') && S.isFreeMail('x@icloud.com'));
t('a bank is not', !S.isFreeMail('info@card.vib.com.vn') && !S.isFreeMail('x@gmail.com.evil.tld'));

/* ── extract.mjs ─────────────────────────────────────────────────────────── */
function fakeDb() {
  const d = { saved: [], tally: [], failures: [], misses: [], learned: [],
    async fingerprint() { return null; },
    async saveFingerprint(row) { d.saved.push(row); },
    async bumpReadTally(s) { d.tally.push(s); },
    async recordDeriveFailure(s, tpl, step) { d.failures.push(step); },
    async logMissLabels(s, l) { d.misses.push(l); },
    async recordLearnedLabel(a, b, c) { d.learned.push([a, b, c]); } };
  return d;
}
const STAFF = 'Nguyen Van A <an.nguyen@zqbank.example>';
const CHATTY = { from: STAFF, subject: 'Chi Tran Thi B 090 123 4567 hoi ve khoan vay',
  body: 'Chao chi,\nEm gui chi bieu lai suat moi.\nTran trong.' };
const TABLE = { from: STAFF, subject: 'Thong bao giao dich',
  body: ['Ngay, gio giao dich', '2026-09-20 08:15:00', 'Diem giao dich', 'ZQ MART 01', 'So tien', '-90,000 VND'].join('\n') };

console.log('\n-- a person-shaped sender: never the model, never the cache --');
{
  const db = fakeDb();
  let asked = 0;
  const r = await X.readTransaction(CHATTY, db, { llm: { apiKey: 'k' }, fetch: async () => { asked++; throw new Error('the model must not be called'); } });
  t('answered not_a_transaction', r.ok === false && r.reason === 'not_a_transaction', r);
  t('the model was NOT called', asked === 0, asked);
  t('NO fingerprint row was written', db.saved.length === 0, db.saved);
  t('nothing else was recorded either', db.failures.length === 0 && db.misses.length === 0 && db.learned.length === 0);
  t('counted under its own stage', db.tally.includes('personal_sender'), db.tally);
}
{
  const db = fakeDb();
  let spent = 0;
  const budget = { spend: () => { spent++; return false; }, left: () => 0 };
  let threw = false, r = null;
  try { r = await X.readTransaction(CHATTY, db, { llm: { apiKey: 'k' }, budget, fetch: async () => { throw new Error('no'); } }); }
  catch { threw = true; }
  t('at budget zero it is SETTLED, not held (a hold here would never clear)', !threw && r && r.ok === false);
  t('and the budget was never touched', spent === 0, spent);
}
{
  const db = fakeDb();
  const r = await X.readTransaction(TABLE, db, { llm: { apiKey: 'k' }, fetch: async () => { throw new Error('the model must not be called'); } });
  t('a real notice from an odd address is STILL READ by the free table tier', r.ok === true && r.stage === 'table' && r.extraction.amount === 90000, r);
  t('...and still leaves no fingerprint row', db.saved.length === 0, db.saved);
  t('...and no derive-failure row (it carries the subject)', db.failures.length === 0);
}
{
  /* The same two mails from a ROLE address behave exactly as before. */
  const db = fakeDb();
  let asked = 0;
  const role = (m) => ({ ...m, from: 'ZQ <ebanking@zqbank.example>' });
  await X.readTransaction(role(CHATTY), db, { llm: { apiKey: 'k' }, fetch: async () => { asked++;
    return { ok: true, status: 200, text: async () => JSON.stringify({ candidates: [{ content: { parts: [{ text: '{"is_transaction":false}' }] } }] }) }; } });
  t('a role address still reaches the model', asked === 1, asked);
  t('and still caches its verdict', db.saved.length === 1 && db.saved[0].is_transaction_source === false);
  const db2 = fakeDb();
  await X.readTransaction(role(TABLE), db2, { llm: { apiKey: 'k' }, fetch: async () => { throw new Error('no'); } });
  t('and a table read from a role address still learns its shape', db2.saved.length === 1 && db2.saved[0].is_transaction_source === true);
}

/* ── worker.mjs: the metadata-first pass ─────────────────────────────────── */
console.log('\n-- runGrant: a person-shaped sender is never held as model-bound --');
{
  const SEP = String.fromCharCode(0);
  const FAM_PUB = Buffer.from(nacl.box.keyPair.fromSecretKey(new Uint8Array(nodeCrypto.randomBytes(32))).publicKey).toString('base64');
  const TOKEN_KEY = nodeCrypto.randomBytes(32).toString('base64');
  const ENC = await TC.encryptToken('r-token', TOKEN_KEY, { subtle: nodeCrypto.webcrypto.subtle });
  const run = async (fromAddr) => {
    const log = { meta: [], body: [] }, saved = [];
    const SUBJECT = 'Trao doi ve ho so';
    const ctx = {
      db: {
        async memberById() { return { id: 'm1', family_id: 'f1', archived_at: null }; },
        async stagingPubForFamily() { return FAM_PUB; }, async stagingPubForUser() { return FAM_PUB; },
        async providerDomains() { return [{ domain_or_address: 'zqbank.example', provider_name: 'ZQ Bank' }]; },
        async alreadyStaged() { return new Set(); },
        async stagedState() { return { staged: new Set(), resolved: new Map() }; },
        async stagedCandidates() { return []; }, async insertStaged() { return true; },
        async recordFailure() {}, async markSynced() {}, async fingerprint() { return null; },
        // The pre-scrub state: a row that says "transaction source, no template".
        async fingerprintsForSenders() { return new Map([[fromAddr + SEP + SUBJECT, { is_transaction_source: true, extraction_regex: null }]]); },
        async saveFingerprint(r) { saved.push(r); }, async bumpReadTally() {},
        async recordStall() {}, async clearStall() {}, async pendingCount() { return 0; },
      },
      nacl, rng: nodeCrypto.webcrypto, subtle: nodeCrypto.webcrypto.subtle,
      dedupKey: nodeCrypto.randomBytes(32).toString('base64'), tokenKey: TOKEN_KEY, fromBytea: (v) => v,
      google: { clientId: 'c', clientSecret: 's' }, llm: { apiKey: 'k' }, notify: async () => {},
      budget: { spend: () => false, used: () => 0, left: () => 0 },
      fetch: async (u) => {
        u = String(u);
        if (u.startsWith('https://oauth2.googleapis.com/token'))
          return { ok: true, status: 200, json: async () => ({ access_token: 'at', expires_in: 3600 }), text: async () => '{"access_token":"at","expires_in":3600}' };
        if (u.includes('generativelanguage')) throw new Error('the model must not be called');
        if (u.includes('/messages?') || u.endsWith('/messages')) { const p = { messages: [{ id: 'staff-1' }] };
          return { ok: true, status: 200, json: async () => p, text: async () => JSON.stringify(p) }; }
        const m = u.match(/\/messages\/([^?]+)\?format=(\w+)/);
        if (m) {
          log[m[2] === 'metadata' ? 'meta' : 'body'].push(m[1]);
          const msg = { id: m[1], threadId: 't', internalDate: String(Date.now()), payload: { mimeType: 'text/plain',
            headers: [{ name: 'From', value: 'Someone <' + fromAddr + '>' }, { name: 'Subject', value: SUBJECT },
                      { name: 'Date', value: new Date().toUTCString() },
                      { name: 'Authentication-Results', value: 'mx.google.com; dkim=pass header.d=zqbank.example' }] } };
          if (m[2] === 'full') msg.payload.body = { data: Buffer.from('Chao chi, em gui ho so.', 'utf8').toString('base64url') };
          return { ok: true, status: 200, json: async () => msg, text: async () => JSON.stringify(msg) };
        }
        throw new Error('unstubbed ' + u);
      },
    };
    const out = await W.runGrant({ id: 'g1', user_id: 'u1', member_id: 'm1', family_id: 'f1', email: 'x@gmail.com', needs_reauth: false,
      refresh_token_enc: ENC, last_synced_at: new Date().toISOString(), backfilled_at: '2026-08-28T00:00:00Z',
      backfilled_days: 90, backfill_days: 90, default_scope: 'family', stalled_runs: 0 }, ctx);
    return { out, log, saved };
  };
  const role = await run('ebanking@zqbank.example');
  t('(control) a ROLE sender known to be model-bound IS held at budget zero', role.out.held === 1 && role.log.body.length === 0, role.out);
  const staff = await run('an.nguyen@zqbank.example');
  t('a person-shaped sender is NOT held', staff.out.held === 0 && staff.out.status !== 'held', staff.out);
  t('it is settled this run: skipped', staff.out.skipped >= 1, staff.out);
  t('and nothing was cached for it', staff.saved.length === 0, staff.saved);
}

/* ── the Apps Script: no cache row under a forwarder's own address ───────── */
console.log('\n-- the Apps Script never caches under a free-mail address --');
{
  const src = fs.readFileSync(HERE + 'bank-email-pipeline.gs', 'utf8');
  const from = src.indexOf('var FREE_MAIL_DOMAINS');
  const end = src.indexOf('\n}\n', src.indexOf('function upsertFingerprint(')) + 3;
  const posts = [];
  const G = new Function('supabasePost', src.slice(from, end) + '\nreturn { isFreeMail, upsertFingerprint, FREE_MAIL_DOMAINS };')((table, row) => posts.push({ table, row }));
  G.upsertFingerprint('someone.else@gmail.com', 'Fwd hoa don', true, 'ecommerce_receipt', null);
  t('a hand-forwarder\'s Gmail writes NO fingerprint row', posts.length === 0, posts);
  G.upsertFingerprint('info@card.vib.com.vn', 'Thong bao giao dich', true, 'bank_txn', null);
  t('a bank address still does', posts.length === 1 && posts[0].table === 'sender_fingerprints' && posts[0].row.sender_address === 'info@card.vib.com.vn', posts);
  t('both transports agree on what free mail is',
    G.FREE_MAIL_DOMAINS.every((d) => S.isFreeMail('x@' + d)) && ['gmail.com', 'yahoo.com', 'outlook.com', 'icloud.com'].every((d) => G.isFreeMail('x@' + d)));
  t('the mail itself is still processed: the skip lives inside upsertFingerprint, not around the read',
    /if \(isFreeMail\(sender\)\) return;\s*\n\s*supabasePost\('sender_fingerprints'/.test(src));
}

console.log('\n' + (fail === 0 ? 'ALL ' + pass + ' PASSED' : pass + ' passed, ' + fail + ' FAILED'));
process.exit(fail ? 1 : 0);
