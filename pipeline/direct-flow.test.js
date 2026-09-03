#!/usr/bin/env node
/* The whole direct-read flow, end to end, in one process.
 * `node pipeline/direct-flow.test.js`
 *
 *   consent URL → callback → encrypted grant → poll → fetch → parse →
 *   seal → insert → the REAL CLIENT OPENER reads the amount back
 *
 * Everything between those ends is the production code path. What is faked is
 * only what is genuinely outside the process:
 *
 *   Google's OAuth and Gmail  — a fake `fetch` serving a real bank email
 *   Gemini                    — a fake `fetch` answering the real schema
 *   Postgres                  — an in-memory store with the same method surface
 *
 * The crypto is real: real AES-GCM for the refresh token, real X25519 and
 * XSalsa20-Poly1305 for the sealed row, real HMAC for the state and the dedup
 * fingerprint. The last assertion opens the staged row with
 * `pipeline/client-reference-staging-keys.js`, which is byte-for-byte the code
 * the app ships, so "the user can see this transaction" is proven rather than
 * assumed.
 *
 * WHY AN END-TO-END TEST AND NOT ONLY UNIT ONES. Every seam in this flow fails
 * silently by construction: a wrong field name gives a row with a null amount,
 * a cursor advanced too early skips mail, a mis-shaped template sends every mail
 * to the model forever. None of those throw. They all look like "no
 * transactions appeared", which is also what an empty mailbox looks like.
 */
const nacl = require('tweetnacl');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

global.atob = b64 => Buffer.from(b64, 'base64').toString('binary');
global.btoa = s => Buffer.from(s, 'binary').toString('base64');
global.nacl = nacl;
global.TextDecoder = require('util').TextDecoder;
global.TextEncoder = require('util').TextEncoder;
global.window = {};
eval(fs.readFileSync(path.join(__dirname, 'client-reference-staging-keys.js'), 'utf8'));
const clientOpen = window.fhStagingOpenRow;

let pass = 0, fail = 0;
const t = (n, ok, d) => { console.log((ok ? '  PASS  ' : '  FAIL  ') + n + (!ok && d ? '  -> ' + d : '')); ok ? pass++ : fail++; };

// ── the family's keys, as a device would have minted them ───────────────────
const FAMILY_SECRET = new Uint8Array(crypto.randomBytes(32));
const FAMILY_PUB = Buffer.from(nacl.box.keyPair.fromSecretKey(FAMILY_SECRET).publicKey).toString('base64');

const TOKEN_KEY = crypto.randomBytes(32).toString('base64');
const DEDUP_KEY = crypto.randomBytes(32).toString('base64');
const STATE_SECRET = 'state-secret-' + crypto.randomBytes(8).toString('hex');
const SUBTLE = crypto.webcrypto.subtle;

const USER = 'user-1', MEMBER = 'mem-1', FAMILY = 'fam-1';
const TOPIC = 'projects/fhtest/topics/familyhub-mailbox-events';
const WATCH_EXPIRY_MS = Date.parse('2026-09-01T00:00:00Z');

// ── a real Vietnamese bank email, as Gmail hands it over ────────────────────
// HTML with the fields in table cells, which is the shape that matters: the
// label and its value are separated by a cell boundary and nothing else.
const MAIL_HTML = `<html><body><table>
<tr><td>Ngân hàng</td><td>MB Bank</td></tr>
<tr><td>Số tiền giao dịch</td><td>-165,000 VND</td></tr>
<tr><td>Số dư</td><td>4,210,000 VND</td></tr>
<tr><td>Tài khoản</td><td>0123456789</td></tr>
<tr><td>Người nhận</td><td>HIGHLANDS COFFEE</td></tr>
<tr><td>Nội dung chuyển tiền</td><td>ca phe sang</td></tr>
<tr><td>Ma giao dich</td><td>FT26234000123</td></tr>
<tr><td>Thời gian</td><td>24-08-2026 10:15:00</td></tr>
</table></body></html>`;

const MESSAGE_ID = 'msg-abc-1';
const GMAIL_MESSAGE = {
  id: MESSAGE_ID,
  threadId: 'thr-1',
  internalDate: String(Date.parse('2026-08-24T03:15:00Z')),
  payload: {
    headers: [
      { name: 'From', value: 'MB Bank <no-reply@mbbank.com.vn>' },
      { name: 'Subject', value: 'Thong bao giao dich thanh cong 123456' },
      { name: 'Date', value: 'Sun, 24 Aug 2026 10:15:00 +0700' },
      { name: 'Authentication-Results', value: 'mx.google.com; dkim=pass header.d=mbbank.com.vn; spf=pass' },
    ],
    mimeType: 'text/html',
    body: { data: Buffer.from(MAIL_HTML, 'utf8').toString('base64url') },
  },
};

/* What the model would answer for this mail. Matches EXTRACTION_SCHEMA exactly;
   the figures are the real ones because nothing masks them any more. */
const MODEL_ANSWER = {
  is_transaction: true,
  transaction_type: 'bank_txn',
  source_provider: 'MB Bank',
  occurred_at: '2026-08-24T10:15:00+07:00',
  amount: 165000,
  currency: 'VND',
  direction: 'debit',
  counterparty: 'HIGHLANDS COFFEE',
  memo: 'ca phe sang',
  reference_number: 'FT26234000123',
  status: null,
  account_masked: '0123456789',
};

// ── the fake outside world ──────────────────────────────────────────────────
function makeWorld(o) {
  o = o || {};
  const seen = { token: 0, list: 0, get: 0, model: 0, exchange: 0, profile: 0, watch: 0, prompts: [], queries: [], watchTopics: [] };

  async function fakeFetch(url, init) {
    const u = String(url);
    const res = (status, body) => ({
      ok: status >= 200 && status < 300, status,
      text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
      json: async () => body,
    });

    if (u.startsWith('https://oauth2.googleapis.com/token')) {
      const body = String(init.body || '');
      if (body.includes('grant_type=authorization_code')) {
        seen.exchange++;
        return res(200, {
          access_token: 'access-1',
          refresh_token: o.noRefresh ? undefined : 'refresh-1',
          scope: o.narrowScope ? 'https://www.googleapis.com/auth/userinfo.email'
                               : 'https://www.googleapis.com/auth/gmail.readonly',
        });
      }
      seen.token++;
      if (o.tokenRejected) return res(400, { error: 'invalid_grant' });
      return res(200, { access_token: 'access-1' });
    }

    if (u.includes('/users/me/watch')) {
      seen.watch++;
      seen.watchTopics.push(JSON.parse(init.body).topicName);
      if (o.watchFails) return res(500, 'nope');
      // Gmail returns epoch MILLISECONDS, as a string.
      return res(200, { historyId: '4242', expiration: String(WATCH_EXPIRY_MS) });
    }

    if (u.includes('/users/me/profile')) { seen.profile++; return res(200, { emailAddress: 'me@gmail.com', historyId: '99' }); }

    if (u.includes('/users/me/messages?')) {
      seen.list++;
      seen.queries.push(decodeURIComponent(new URL(u).searchParams.get('q') || ''));
      return res(200, { messages: (o.messageIds || [MESSAGE_ID]).map(id => ({ id })) });
    }

    if (u.includes('/users/me/messages/')) {
      seen.get++;
      if (o.messageGone) return res(404, { error: 'gone' });
      return res(200, GMAIL_MESSAGE);
    }

    if (u.includes('generativelanguage.googleapis.com')) {
      seen.model++;
      seen.prompts.push(JSON.parse(init.body));
      if (o.modelDown) return res(429, 'rate limited');
      return res(200, {
        candidates: [{ content: { parts: [{ text: JSON.stringify(o.modelAnswer || MODEL_ANSWER) }] } }],
      });
    }

    throw new Error('unexpected fetch: ' + u);
  }
  return { fakeFetch, seen };
}

/* Postgres, with the method surface db.mjs exposes and nothing more. Keeping it
   to that surface is what makes it a fake rather than a second implementation:
   if the worker starts needing something else, this stops compiling rather than
   quietly diverging. */
function makeDb(o) {
  o = o || {};
  const state = {
    grants: o.grants || [],
    staged: [],
    fingerprints: new Map(),
    failures: [],
    synced: [],
    reauth: [],
    watches: [],
    lookups: [],
    members: o.members || { [MEMBER]: { id: MEMBER, family_id: FAMILY, archived_at: null } },
    stagingPub: 'stagingPub' in o ? o.stagingPub : FAMILY_PUB,
  };
  const key = (s, tpl) => s + '\u0000' + tpl;   // a separator no subject can contain

  return {
    state,
    async dueGrants() { return state.grants; },
    async markNeedsReauth(id) { state.reauth.push(id); },
    async markSynced(id, fields) { state.synced.push({ id, fields }); },
    async memberById(id) { return state.members[id] || null; },
    async stagingPubForFamily() { return state.stagingPub; },
    async fingerprint(s, tpl) { return state.fingerprints.get(key(s, tpl)) || null; },
    async saveFingerprint(row) { state.fingerprints.set(key(row.sender_address, row.subject_template), row); },
    async providerDomains() { return []; },
    async alreadyStaged(ids) {
      if (o.stagedLookupThrows) throw new Error('database unreachable');
      const have = new Set(state.staged.map(r => r.gmail_message_id));
      return new Set(ids.filter(id => have.has(id)));
    },
    /* The split view (0113): staged now, and tombstoned-when. The harness keeps
       tombstones in state.resolved as { id: resolved_at } when a scenario sets
       them; most scenarios have none. */
    async stagedState(ids) {
      if (o.stagedLookupThrows) throw new Error('database unreachable');
      const have = new Set(state.staged.map(r => r.gmail_message_id));
      const resolved = new Map();
      for (const [id, at] of Object.entries(state.resolved || {})) {
        if (ids.includes(id)) resolved.set(id, at);
      }
      return { staged: new Set(ids.filter(id => have.has(id))), resolved };
    },
    async stagedCandidates() { return o.candidates || []; },
    async insertStaged(row) {
      if (state.staged.some(r => r.gmail_message_id === row.gmail_message_id)) return false;
      state.staged.push(row);
      return true;
    },
    async recordFailure(row) { state.failures.push(row); },
    async grantByEmail(email, folded) {
      state.lookups.push(email);
      return state.grants.find(g => g.email === email)
        || (folded ? state.grants.find(g => g.email === folded) : null)
        || null;
    },
    async saveWatch(id, expiresAt) { state.watches.push({ id, expiresAt }); },
    async watchesDue() { return o.due || []; },
  };
}

async function makeGrant(refreshToken, tokenCrypto, over) {
  const enc = await tokenCrypto.encryptToken(refreshToken, TOKEN_KEY, { subtle: SUBTLE, rng: crypto.webcrypto });
  return {
    id: 'grant-1', user_id: USER, member_id: MEMBER, family_id: FAMILY,
    provider: 'google', email: 'me@gmail.com',
    refresh_token_enc: enc, scopes: 'https://www.googleapis.com/auth/gmail.readonly',
    needs_reauth: false, history_id: null, last_synced_at: null, backfilled_at: '2026-08-01T00:00:00Z',
    ...(over || {}),
  };
}

function ctxFor(db, world, over) {
  return {
    db, fetch: world.fakeFetch, nacl, subtle: SUBTLE, rng: crypto.webcrypto,
    tokenKey: TOKEN_KEY, dedupKey: DEDUP_KEY,
    google: { clientId: 'cid', clientSecret: 'csecret' },
    llm: { apiKey: 'gemini-key' },
    ...(over || {}),
  };
}

(async () => {
const W = await import('../supabase/functions/_shared/mailbox/worker.mjs');
const TC = await import('../supabase/functions/_shared/mailbox/token-crypto.mjs');
const OS = await import('../supabase/functions/_shared/mailbox/oauth-state.mjs');
const GO = await import('../supabase/functions/_shared/mailbox/google-oauth.mjs');
const SB = await import('../supabase/functions/_shared/mailbox/sealed-box.mjs');
const senders = await import('../supabase/functions/_shared/mailbox/senders.mjs');
const mailtext = await import('../supabase/functions/_shared/mailbox/mailtext.mjs');
const gmail = await import('../supabase/functions/_shared/mailbox/gmail.mjs');

// ═══ 1. connect ════════════════════════════════════════════════════════════
console.log('\n-- connect: consent, then a grant nothing else can read --');
{
  const state = await OS.createState({ userId: USER, returnTo: '/settings' }, STATE_SECRET, { subtle: SUBTLE });
  const url = GO.authorizationUrl(state, { clientId: 'cid', redirectUri: 'https://x/cb' }, 'me@gmail.com');

  t('asks for offline access, or there is no refresh token at all',
    url.includes('access_type=offline'));
  // URLSearchParams encodes the space, so the parameter reads
  // `prompt=select_account+consent`. Both words matter and neither is default.
  t('forces the consent screen, or a RE-auth returns no refresh token',
    /prompt=[^&]*consent/.test(url), url);
  t('forces the account chooser, because login_hint loses to a live session',
    /prompt=[^&]*select_account/.test(url), url);
  t('asks for gmail.readonly and nothing else',
    decodeURIComponent(url).includes('scope=https://www.googleapis.com/auth/gmail.readonly'));
  t('does not accumulate previously granted scopes',
    url.includes('include_granted_scopes=false'));

  const claims = await OS.readState(state, STATE_SECRET, { subtle: SUBTLE });
  t('the state names the user who started the flow', claims.userId === USER);
  t('and carries them back to where they were', claims.returnTo === '/settings');

  // The state is the ONLY thing identifying the user at the callback.
  const forged = state.slice(0, -4) + 'AAAA';
  t('a tampered state is refused', await OS.readState(forged, STATE_SECRET, { subtle: SUBTLE }) === null);
  t('a state signed with another key is refused',
    await OS.readState(state, 'other-secret', { subtle: SUBTLE }) === null);
  t('an expired state is refused',
    await OS.readState(state, STATE_SECRET, { subtle: SUBTLE, nowMs: Date.now() + 3600e3 }) === null);
  t('a returnTo pointing off-site is dropped, not followed',
    OS.confineToPath('https://evil.example') === null &&
    OS.confineToPath('//evil.example') === null &&
    OS.confineToPath('/settings') === '/settings');

  const world = makeWorld();
  const grant = await GO.completeConnect({ code: 'code-1' },
    { clientId: 'cid', clientSecret: 'csecret', redirectUri: 'https://x/cb' },
    { fetch: world.fakeFetch });
  t('the address comes from Google, never from the login_hint', grant.email === 'me@gmail.com');
  t('the profile call is made, proving the token actually works', world.seen.profile === 1);

  let noRefresh = null;
  try {
    await GO.completeConnect({ code: 'c' }, { clientId: 'c', clientSecret: 's', redirectUri: 'r' },
      { fetch: makeWorld({ noRefresh: true }).fakeFetch });
  } catch (e) { noRefresh = e.kind; }
  t('a grant with no refresh token is refused, not stored to die in an hour',
    noRefresh === 'no_refresh_token', String(noRefresh));

  let narrow = null;
  try {
    await GO.completeConnect({ code: 'c' }, { clientId: 'c', clientSecret: 's', redirectUri: 'r' },
      { fetch: makeWorld({ narrowScope: true }).fakeFetch });
  } catch (e) { narrow = e.kind; }
  t('a re-consent that NARROWED the scope is refused', narrow === 'insufficient_scope', String(narrow));
}

console.log('\n-- the stored credential --');
{
  const enc = await TC.encryptToken('refresh-1', TOKEN_KEY, { subtle: SUBTLE, rng: crypto.webcrypto });
  t('the token is not stored in the clear', !enc.includes('refresh-1'));
  t('it round-trips', await TC.decryptToken(enc, TOKEN_KEY, { subtle: SUBTLE }) === 'refresh-1');
  const enc2 = await TC.encryptToken('refresh-1', TOKEN_KEY, { subtle: SUBTLE, rng: crypto.webcrypto });
  t('two encryptions of one token differ (fresh nonce each time)', enc !== enc2);

  const other = crypto.randomBytes(32).toString('base64');
  let wrongKey = null;
  try { await TC.decryptToken(enc, other, { subtle: SUBTLE }); } catch (e) { wrongKey = e.message; }
  t('another key cannot open it', /could not be decrypted/.test(String(wrongKey)), String(wrongKey));

  const tampered = enc.slice(0, -6) + 'AAAAAA';
  let tamperErr = null;
  try { await TC.decryptToken(tampered, TOKEN_KEY, { subtle: SUBTLE }); } catch (e) { tamperErr = e.message; }
  t('tampered ciphertext is refused, not returned as a token', !!tamperErr);
  t('bytea survives the round trip', TC.fromBytea(TC.toBytea(enc)) === enc);
}

// ═══ 2. read ═══════════════════════════════════════════════════════════════
console.log('\n-- read: only senders we named, and only what they signed --');
{
  t('a bank is a bank', senders.match('MB <no-reply@mbbank.com.vn>').kind === 'bank');
  t('a wallet is a wallet', senders.match('MoMo <no-reply@momo.vn>').kind === 'wallet');
  t('a subdomain of a known bank counts',
    senders.match('x@info.vietcombank.com.vn').provider === 'Vietcombank');
  // The whole reason the check is a dot-boundary suffix and not indexOf.
  t('a lookalike domain does NOT count', senders.match('x@momo.vn.evil.com') === null);
  t('an unknown sender is not read at all', senders.match('friend@gmail.com') === null);
  t('the query names senders rather than fetching the mailbox',
    senders.inboxQuery(2).startsWith('(from:') && senders.inboxQuery(2).includes('newer_than:2d'));

  const v = gmail.dkimVerdict(
    { 'authentication-results': 'mx.google.com; dkim=pass header.d=mbbank.com.vn' },
    'MB <no-reply@mbbank.com.vn>');
  t('a signed bank mail passes DKIM', v.pass === true);
  const bad = gmail.dkimVerdict(
    { 'authentication-results': 'mx.google.com; dkim=pass header.d=evil.com' },
    'MB <no-reply@mbbank.com.vn>');
  t('mail signed by another domain is not aligned', bad.pass === false);
  const none = gmail.dkimVerdict({}, 'MB <no-reply@mbbank.com.vn>');
  t('no Authentication-Results header is not a pass', none.pass === false);
}

console.log('\n-- read: the HTML becomes text with its fields still apart --');
{
  const text = mailtext.toText(MAIL_HTML);
  // A cell boundary is the ONLY thing between a label and its value in bank
  // mail. One newline or two does not matter; zero does — that is the bug where
  // `Tổng tiền` reads back as `Tổng tiền 165.000đ`.
  t('the label and its value do not merge into one line',
    /Số tiền giao dịch\n+-?165,000 VND/.test(text), JSON.stringify(text.slice(0, 140)));
  t('the markup is gone', text.indexOf('<') === -1);
  t('the figures survive', text.includes('165,000') && text.includes('4,210,000'));
  t('base64url decodes', mailtext.decodeBase64Url(Buffer.from('xin chào', 'utf8').toString('base64url')) === 'xin chào');
  t('entities decode', mailtext.decodeEntities('a&nbsp;b &amp; c') === 'a b & c');
}

// ═══ 3-5. parse → seal → save, and then read it back ═══════════════════════
console.log('\n-- the full poll, first time: model reads it, template is learned --');
const db = makeDb({ grants: [] });
{
  db.state.grants = [await makeGrant('refresh-1', TC)];
  const world = makeWorld();
  const out = await W.runAll(ctxFor(db, world));

  t('one mailbox polled', out.polled === 1);
  t('one row staged', out.results[0].staged === 1, JSON.stringify(out.results[0]));
  t('the model was asked exactly once', world.seen.model === 1);
  t('a template was learned for next time', db.state.fingerprints.size === 1);
  t('the cursor advanced only after the window was handled', db.state.synced.length === 1);

  // The consent copy promises the mail is sent as written. Prove it is.
  const prompt = JSON.stringify(world.seen.prompts[0]);
  t('the real amount reached the model', prompt.includes('165,000'));
  t('the real counterparty reached the model', prompt.includes('HIGHLANDS COFFEE'));
  t('the real account number reached the model', prompt.includes('0123456789'));
  t('nothing was masked on the way out', !/\[MONEY_\d+\]/.test(prompt));
}

console.log('\n-- the row that landed --');
const staged = db.state.staged[0];
{
  t('keyed on the message id, which is the idempotency key', staged.gmail_message_id === MESSAGE_ID);
  t('owned by the member the grant was bound to', staged.member_id === MEMBER);
  t('pending, never auto-imported', staged.review_status === 'pending');
  t('sealed', !!staged.sealed && !!staged.eph_pub && !!staged.nonce && staged.enc_v === 1);
  t('carries a dedup fingerprint', typeof staged.dedup_fp === 'string' && staged.dedup_fp.length > 0);

  for (const col of ['amount', 'currency', 'direction', 'counterparty',
                     'reference_number', 'transaction_type', 'raw_extracted', 'raw_body']) {
    t('the database cannot read ' + col, staged[col] === undefined || staged[col] === null);
  }
  // The provider and the date stay clear BECAUSE dedup needs to compare them:
  // fuzzily on the name, and as a range on the date.
  t('the provider stays readable, for fuzzy dedup', staged.source_provider === 'MB Bank');
  t('the date stays readable, for the dedup window', !!staged.occurred_at);
}

console.log('\n-- decrypt and show: the app opens it --');
{
  const opened = clientOpen({ ...staged, family_id: FAMILY }, FAMILY_SECRET);
  t('the client opens the row', !!opened);
  t('the amount is right', opened.amount === 165000, String(opened.amount));
  t('the direction is right', opened.direction === 'debit');
  t('the currency is right', opened.currency === 'VND');
  t('the counterparty is right', opened.counterparty === 'HIGHLANDS COFFEE');
  t('the reference is right', opened.reference_number === 'FT26234000123');
  t('a bank sender reads as a bank transaction', opened.transaction_type === 'bank_txn');
  t('the memo survives, which is the only field saying WHY',
    (opened.raw_extracted.memo || '').includes('ca phe sang'), JSON.stringify(opened.raw_extracted.memo));
  /* The model returned a FULL account number in the field named masked — banks
     print them and models copy them. The tidy layer now enforces the name: last
     four digits survive, the rest never reaches the sealed row. */
  t('the account survives masked to last four', opened.raw_extracted.account_masked === '…6789');
  t('the full number is not in the row', !JSON.stringify(opened.raw_extracted).includes('0123456789'));
  t('the transport is recorded', opened.raw_extracted._transport === 'oauth_direct');
  t('the DKIM verdict is recorded on the row', opened.raw_extracted._sender_auth.pass === true);
  t('the date came through', typeof opened.raw_extracted.occurred_at === 'string');
  t('the raw body is nowhere', opened.raw_body === undefined);

  // The binding is what stops a ciphertext being moved onto another row.
  let moved = null;
  try { clientOpen({ ...staged, family_id: 'fam-2' }, FAMILY_SECRET); } catch (e) { moved = e.message; }
  t('the row cannot be moved to another family', moved === 'staging_identity_mismatch');
  let other = null;
  try { clientOpen({ ...staged, family_id: FAMILY }, new Uint8Array(crypto.randomBytes(32))); } catch (e) { other = e.message; }
  t('another family key cannot open it', other === 'staging_open_failed');
}

console.log('\n-- the second poll: no model, and no second copy --');
{
  const world = makeWorld();
  const out = await W.runAll(ctxFor(db, world));
  t('the message is recognised as already staged', out.results[0].skipped === 1, JSON.stringify(out.results[0]));
  t('nothing was staged twice', db.state.staged.length === 1);
  t('the model was NOT called again', world.seen.model === 0);
}

console.log('\n-- a second mail off the learned template costs no model call --');
{
  const db2 = makeDb({ grants: [await makeGrant('refresh-1', TC)] });
  // Carry the learned template across, which is what the shared cache does.
  db2.state.fingerprints = db.state.fingerprints;
  const world = makeWorld({ messageIds: ['msg-abc-2'] });
  const out = await W.runAll(ctxFor(db2, world));
  t('it still staged the transaction', out.results[0].staged === 1, JSON.stringify(out.results[0]));
  t('and read it with NO model call at all', world.seen.model === 0);
  const opened = clientOpen({ ...db2.state.staged[0], family_id: FAMILY }, FAMILY_SECRET);
  t('the template produced the same amount the model did', opened.amount === 165000, String(opened.amount));
  t('and the same counterparty', opened.counterparty === 'HIGHLANDS COFFEE');
}

// ═══ the failures that are silent by construction ══════════════════════════
console.log('\n-- holds: nothing staged, and the cursor does NOT move --');
{
  const d = makeDb({ grants: [await makeGrant('refresh-1', TC)], stagingPub: null });
  const out = await W.runAll(ctxFor(d, makeWorld()));
  t('a family with no staging key holds', out.results[0].status === 'held' && out.results[0].reason === 'no_staging_pub',
    JSON.stringify(out.results[0]));
  t('  ...stages nothing', d.state.staged.length === 0);
  t('  ...and leaves the cursor alone, so the mail is read again', d.state.synced.length === 0);
}
{
  const d = makeDb({ grants: [await makeGrant('refresh-1', TC)], members: {} });
  const out = await W.runAll(ctxFor(d, makeWorld()));
  t('a member that no longer exists holds', out.results[0].status === 'held');
  t('  ...and never fetches the mailbox', d.state.staged.length === 0);
}
{
  const d = makeDb({ grants: [await makeGrant('refresh-1', TC)] });
  d.state.members[MEMBER] = { id: MEMBER, family_id: 'fam-OTHER', archived_at: null };
  const out = await W.runAll(ctxFor(d, makeWorld()));
  t('a member moved to another family holds rather than sealing to the old one',
    out.results[0].status === 'held' && out.results[0].reason === 'member_moved', JSON.stringify(out.results[0]));
}
{
  const d = makeDb({ grants: [await makeGrant('refresh-1', TC)] });
  const out = await W.runAll(ctxFor(d, makeWorld({ modelDown: true })));
  t('a rate-limited model holds the mailbox', out.results[0].status === 'held', JSON.stringify(out.results[0]));
  t('  ...stages nothing', d.state.staged.length === 0);
  t('  ...and does not advance past mail it never read', d.state.synced.length === 0);
}

console.log('\n-- a dead token is a state, not a crash --');
{
  const d = makeDb({ grants: [await makeGrant('refresh-1', TC)] });
  const out = await W.runAll(ctxFor(d, makeWorld({ tokenRejected: true })));
  t('a rejected refresh token is reported as needing re-consent', out.results[0].status === 'needs_reauth');
  t('  ...and flagged on the grant so the app can ask', d.state.reauth.length === 1);
  t('  ...without advancing the cursor', d.state.synced.length === 0);
}
{
  const d = makeDb({ grants: [await makeGrant('refresh-1', TC)] });
  const out = await W.runAll(ctxFor(d, makeWorld(), { tokenKey: crypto.randomBytes(32).toString('base64') }));
  t('a credential we cannot decrypt is flagged, not retried forever',
    out.results[0].status === 'token_unreadable' && d.state.reauth.length === 1, JSON.stringify(out.results[0]));
}

console.log('\n-- the idempotency check must not fail open --');
{
  const d = makeDb({ grants: [await makeGrant('refresh-1', TC)], stagedLookupThrows: true });
  const out = await W.runAll(ctxFor(d, makeWorld()));
  t('an unreachable database fails the run rather than concluding "not staged"',
    out.results[0].status === 'error', JSON.stringify(out.results[0]));
  t('  ...and stages nothing', d.state.staged.length === 0);
}

console.log('\n-- mail we should not act on --');
{
  const d = makeDb({ grants: [await makeGrant('refresh-1', TC)] });
  const world = makeWorld();
  // The Gmail query is by sender, but a sender that slips through must still be
  // turned away rather than parsed.
  const orig = GMAIL_MESSAGE.payload.headers[0].value;
  GMAIL_MESSAGE.payload.headers[0].value = 'A Friend <friend@gmail.com>';
  const out = await W.runAll(ctxFor(d, world));
  GMAIL_MESSAGE.payload.headers[0].value = orig;
  t('an unknown sender is skipped, never parsed', out.results[0].skipped === 1 && d.state.staged.length === 0,
    JSON.stringify(out.results[0]));
  t('  ...and costs no model call', world.seen.model === 0);
}
{
  const d = makeDb({ grants: [await makeGrant('refresh-1', TC)] });
  const world = makeWorld();
  const orig = GMAIL_MESSAGE.payload.headers[3].value;
  GMAIL_MESSAGE.payload.headers[3].value = 'mx.google.com; dkim=fail header.d=evil.com';
  const out = await W.runAll(ctxFor(d, world, { enforceSenderAuth: true }));
  GMAIL_MESSAGE.payload.headers[3].value = orig;
  t('with enforcement on, unsigned mail is refused and recorded',
    d.state.staged.length === 0 && d.state.failures.length === 1, JSON.stringify(out.results[0]));
  t('  ...and the failure row carries no body', d.state.failures[0].raw_body === undefined);
}
{
  const d = makeDb({ grants: [await makeGrant('refresh-1', TC)] });
  const world = makeWorld({ modelAnswer: { ...MODEL_ANSWER, is_transaction: false } });
  const out = await W.runAll(ctxFor(d, world));
  t('a newsletter is not staged', d.state.staged.length === 0);
  t('  ...and the verdict is cached so it never costs a second call',
    [...d.state.fingerprints.values()][0].is_transaction_source === false);
}
{
  const d = makeDb({ grants: [await makeGrant('refresh-1', TC)] });
  const world = makeWorld({ modelAnswer: { ...MODEL_ANSWER, amount: null } });
  const out = await W.runAll(ctxFor(d, world));
  t('a transaction with no amount is recorded as unreadable, not staged as zero',
    d.state.staged.length === 0 && d.state.failures.length === 1, JSON.stringify(out.results[0]));
}

console.log('\n-- backfill: once, and all of it --');
{
  const d = makeDb({ grants: [await makeGrant('refresh-1', TC, { backfilled_at: null })] });
  const world = makeWorld();
  await W.runAll(ctxFor(d, world));
  // Asserted against the constant rather than a literal: the window is a product
  // decision that has already moved once (90 -> 15, to stop a first connect
  // opening with fifty-two chores), and a test that hard-codes it fails on the
  // decision rather than on the behaviour it is meant to protect — which is that
  // a FIRST connect reaches back further than an ordinary poll.
  t('a first connect reaches back further than a poll',
    world.seen.queries.some(q => q.includes('newer_than:' + W.BACKFILL_DAYS + 'd'))
      && W.BACKFILL_DAYS > W.POLL_DAYS,
    world.seen.queries.join(' | '));
  t('and marks the backfill done once it has finished',
    d.state.synced[0].fields.backfilled_at !== undefined, JSON.stringify(d.state.synced[0]));

  const d2 = makeDb({ grants: [await makeGrant('refresh-1', TC)] });
  await W.runAll(ctxFor(d2, makeWorld()));
  t('an ordinary poll does not re-run the backfill',
    d2.state.synced[0].fields.backfilled_at === undefined, JSON.stringify(d2.state.synced[0]));
}
{
  /* The per-run cap applies to what is WORKED ON, not to what is listed. An
     earlier cut listed 40, staged them, and marked the backfill done — silently
     losing every older message with nothing recording it had been there. */
  const many = Array.from({ length: 15 }, (_, i) => 'bulk-' + i);
  const d = makeDb({ grants: [await makeGrant('refresh-1', TC, { backfilled_at: null })] });
  const world = makeWorld({ messageIds: many });
  const out = await W.runAll(ctxFor(d, world, { maxMessages: 5 }));
  t('a backfill bigger than one run stages only its share', d.state.staged.length === 5,
    'staged=' + d.state.staged.length);
  t('  ...reports the rest as queued, not as done', out.results[0].queued === 10, JSON.stringify(out.results[0]));
  t('  ...and does not advance anything while work is queued',
    d.state.synced.length === 0, JSON.stringify(d.state.synced));

  // The next run picks up where it stopped, five minutes later.
  await W.runAll(ctxFor(d, makeWorld({ messageIds: many }), { maxMessages: 5 }));
  t('the next run continues the backlog', d.state.staged.length === 10, 'staged=' + d.state.staged.length);
  await W.runAll(ctxFor(d, makeWorld({ messageIds: many }), { maxMessages: 5 }));
  t('and the run that clears it marks the backfill done',
    d.state.staged.length === 15 && d.state.synced.length === 1 &&
    d.state.synced[0].fields.backfilled_at !== undefined,
    'staged=' + d.state.staged.length + ' synced=' + JSON.stringify(d.state.synced));
}
{
  /* The same truncation on the ORDINARY path. windowDays widens after an
     outage, so a routine poll can face a backlog too — and listing only what one
     run can stage would advance last_synced_at past the rest. */
  const many = Array.from({ length: 12 }, (_, i) => 'catchup-' + i);
  const d = makeDb({ grants: [await makeGrant('refresh-1', TC, { last_synced_at: '2026-08-01T00:00:00Z' })] });
  const out = await W.runAll(ctxFor(d, makeWorld({ messageIds: many }), { maxMessages: 5 }));
  t('a wide catch-up stages its share and holds the cursor',
    d.state.staged.length === 5 && d.state.synced.length === 0, JSON.stringify(out.results[0]));
  await W.runAll(ctxFor(d, makeWorld({ messageIds: many }), { maxMessages: 5 }));
  await W.runAll(ctxFor(d, makeWorld({ messageIds: many }), { maxMessages: 5 }));
  t('  ...and later runs finish it before the cursor moves',
    d.state.staged.length === 12 && d.state.synced.length === 1,
    'staged=' + d.state.staged.length + ' synced=' + d.state.synced.length);
}

console.log('\n-- the poll window follows the last SUCCESSFUL poll --');
{
  const now = Date.parse('2026-08-25T00:00:00Z');
  t('a fresh mailbox uses the floor', W.windowDays(null, now) === W.POLL_DAYS);
  t('a mailbox polled an hour ago uses the floor',
    W.windowDays('2026-08-24T23:00:00Z', now) === W.POLL_DAYS);
  /* The trap this replaced: a hard-coded newer_than:2d meant a worker down for
     three days came back, read the last two, and the missing day was gone with
     nothing anywhere recording that it existed. */
  t('a mailbox not polled for five days reaches back six',
    W.windowDays('2026-08-20T00:00:00Z', now) === 6, String(W.windowDays('2026-08-20T00:00:00Z', now)));
  t('a clock skewed into the future falls back to the floor',
    W.windowDays('2026-09-01T00:00:00Z', now) === W.POLL_DAYS);
  t('an unparseable timestamp falls back to the floor',
    W.windowDays('not a date', now) === W.POLL_DAYS);

  const d = makeDb({ grants: [await makeGrant('refresh-1', TC, { last_synced_at: '2026-08-20T00:00:00Z' })] });
  const world = makeWorld();
  await W.runAll(ctxFor(d, world, { nowMs: now }));
  t('and the widened window reaches Gmail',
    world.seen.queries.some(q => q.includes('newer_than:6d')), world.seen.queries.join(' | '));
}

console.log('\n-- one bad mailbox never stops the others --');
{
  const good = await makeGrant('refresh-1', TC);
  const bad = await makeGrant('refresh-1', TC, { id: 'grant-2', member_id: 'mem-GONE' });
  const d = makeDb({ grants: [bad, good] });
  const out = await W.runAll(ctxFor(d, makeWorld()));
  t('both mailboxes were attempted', out.results.length === 2);
  t('the healthy one still staged its row', d.state.staged.length === 1, JSON.stringify(out.results));
}

console.log('\n-- push: the mail arrives, and so does the notification --');
{
  /* The whole point of the watch. Gmail rings with {emailAddress, historyId}
     and no content, so what follows is the same windowed read a poll does —
     only the trigger differs, and the difference is minutes. */
  const d = makeDb({ grants: [await makeGrant('refresh-1', TC)] });
  const world = makeWorld();
  const notices = [];
  const out = await W.runPush({ emailAddress: 'me@gmail.com', historyId: '99' },
    ctxFor(d, world, { notify: (g, n) => notices.push(n) }));

  t('the mail is staged on the push, not on the next tick', d.state.staged.length === 1, JSON.stringify(out));
  t('and the owner is told immediately', notices.length === 1);
  t('the push is acknowledged', out.ack === true);
  const opened = clientOpen({ ...d.state.staged[0], family_id: FAMILY }, FAMILY_SECRET);
  t('and it is the same sealed row the poll would have produced', opened.amount === 165000);
}
{
  /* Gmail folds dots and +suffixes on its own domains. Google returns the
     canonical form in both the profile call and the push, so the first lookup
     should hit — but a miss is a notification silently dropped for a mailbox we
     DO hold, and the forwarding pipeline was bitten by exactly this. */
  const d = makeDb({ grants: [await makeGrant('refresh-1', TC, { email: 'me@gmail.com' })] });
  const out = await W.runPush({ emailAddress: 'm.e+bank@gmail.com' }, ctxFor(d, makeWorld()));
  t('a dotted or +tagged Gmail address still finds its grant',
    d.state.staged.length === 1, JSON.stringify(out));
  t('  ...and only after the exact address missed', d.state.lookups.length === 1);
}
{
  /* A watch outlives a disconnect by up to 7 days, so Gmail keeps ringing a
     doorbell nobody is behind. That is ordinary, not an error — and it must ACK,
     or Pub/Sub redelivers it for the topic's whole retention. */
  const d = makeDb({ grants: [] });
  const out = await W.runPush({ emailAddress: 'stranger@gmail.com' }, ctxFor(d, makeWorld()));
  t('a mailbox we hold no grant for is dropped quietly',
    out.status === 'ignored' && out.reason === 'no_grant', JSON.stringify(out));
  t('  ...and acknowledged, so it is not redelivered forever', out.ack === true);
  t('  ...having staged nothing', d.state.staged.length === 0);
}
{
  const d = makeDb({ grants: [] });
  for (const bad of [null, {}, { historyId: '1' }]) {
    const out = await W.runPush(bad, ctxFor(d, makeWorld()));
    t('a malformed notification is acked, not fought: ' + JSON.stringify(bad),
      out.status === 'ignored' && out.ack === true, JSON.stringify(out));
  }
  t('a bad envelope decodes to null rather than throwing',
    gmail.decodePushEnvelope({ message: { data: '!!!' } }) === null &&
    gmail.decodePushEnvelope({}) === null);
  const env = { message: { data: Buffer.from(JSON.stringify(
    { emailAddress: 'Me@Gmail.com', historyId: 7 })).toString('base64url') } };
  const decoded = gmail.decodePushEnvelope(env);
  t('a real envelope decodes, lower-cased',
    decoded.emailAddress === 'me@gmail.com' && decoded.historyId === '7', JSON.stringify(decoded));
}
{
  /* Push and poll landing on the same message is normal, not a race to avoid:
     the already-staged check and the UNIQUE constraint make the second one a
     no-op. Without that, every notification would risk a duplicate row. */
  const d = makeDb({ grants: [await makeGrant('refresh-1', TC)] });
  await W.runPush({ emailAddress: 'me@gmail.com' }, ctxFor(d, makeWorld()));
  await W.runAll(ctxFor(d, makeWorld()));
  t('a poll right after a push does not stage a second copy', d.state.staged.length === 1);
}

console.log('\n-- the watch: registered, renewed, and never silently lapsed --');
{
  const grant = await makeGrant('refresh-1', TC, { watch_expires_at: null });
  const d = makeDb({ grants: [grant], due: [grant] });
  const world = makeWorld();
  const out = await W.renewWatches(ctxFor(d, world, { topicName: TOPIC }));

  t('a mailbox with no watch is due by definition', out.renewed === 1, JSON.stringify(out));
  t('and it is registered against our own topic', world.seen.watchTopics[0] === TOPIC);
  /* Gmail returns epoch MILLISECONDS. Reading it as seconds puts the expiry in
     1970, every sweep then treats every mailbox as due, and the renewal quietly
     becomes a re-registration storm. */
  t('the expiry is stored as milliseconds, not seconds',
    d.state.watches[0].expiresAt === WATCH_EXPIRY_MS, String(d.state.watches[0].expiresAt));
}
{
  const d = makeDb({ grants: [], due: [] });
  const out = await W.renewWatches(ctxFor(d, makeWorld(), { topicName: TOPIC }));
  t('nothing due means no calls at all', out.renewed === 0 && d.state.watches.length === 0);
}
{
  const grant = await makeGrant('refresh-1', TC);
  const d = makeDb({ grants: [grant], due: [grant] });
  const out = await W.renewWatches(ctxFor(d, makeWorld({ tokenRejected: true }), { topicName: TOPIC }));
  t('a dead token during renewal is a state, not a failure',
    out.needsReauth === 1 && d.state.reauth.length === 1, JSON.stringify(out));
}
{
  const g1 = await makeGrant('refresh-1', TC, { id: 'g1' });
  const g2 = await makeGrant('refresh-1', TC, { id: 'g2' });
  const d = makeDb({ grants: [g1, g2], due: [g1, g2] });
  const out = await W.renewWatches(ctxFor(d, makeWorld({ watchFails: true }), { topicName: TOPIC }));
  t('one mailbox failing does not stop the sweep', out.failed === 2, JSON.stringify(out));
}
{
  const grant = await makeGrant('refresh-1', TC);
  const d = makeDb({ grants: [grant], due: [grant] });
  const out = await W.renewWatches(ctxFor(d, makeWorld()));
  t('with no topic configured, renewal is a no-op rather than an error',
    out.renewed === 0 && !!out.skipped, JSON.stringify(out));
}

console.log('\n-- notification: something is waiting, and nothing more --');
{
  const d = makeDb({ grants: [await makeGrant('refresh-1', TC)] });
  const notices = [];
  await W.runAll(ctxFor(d, makeWorld(), { notify: (g, n) => notices.push({ g, n }) }));
  t('the owner is told once', notices.length === 1);
  t('  ...with a count and nothing else', notices[0].n === 1);
  const payload = JSON.stringify(notices[0]);
  t('  ...carrying no amount', !payload.includes('165000') && !payload.includes('165,000'));
  t('  ...and no merchant', !payload.includes('HIGHLANDS'));

  const quiet = makeDb({ grants: [await makeGrant('refresh-1', TC)] });
  quiet.state.staged.push({ gmail_message_id: MESSAGE_ID });
  const none = [];
  await W.runAll(ctxFor(quiet, makeWorld(), { notify: (g, n) => none.push(n) }));
  t('a run that staged nothing says nothing', none.length === 0);
}

console.log('\n' + (fail ? 'FAILED ' + fail + ' of ' + (pass + fail)
                         : 'ALL ' + pass + ' assertions passed'));
process.exit(fail ? 1 : 0);
})();
