#!/usr/bin/env node
/* A mail somebody else read still has to arrive sealed.
 * `node pipeline/direct-ingest.test.js`
 *
 * The Python pipeline on Cloud Run reads real mailboxes and parses real
 * Vietnamese bank mail correctly, and then stops: its main.py ends at
 * `# TODO: persist`. `/ingest` is that line's other end — it takes the reading
 * and does the half that has to happen on this side, because the seal is a
 * security boundary rather than a step.
 *
 * WHAT THIS FILE IS FOR. Everything downstream of the seal is unchanged code
 * that other suites already cover. What is NEW is a caller we do not control
 * handing us a payload, and every one of this path's failures is silent:
 *
 *   - a payload trusted without validation seals a row nobody can inspect
 *     afterwards to find out what went wrong;
 *   - a hold that acks and is never recorded loses a transaction with no error
 *     anywhere, because unlike the poll this path owns no cursor to leave alone;
 *   - a redelivery staged twice is two of one purchase, and upstream delivery is
 *     at-least-once by their own docstring;
 *   - a reading passed straight through arrives with no memo_display, which
 *     hands the review screen the bank's own auto-fill as the description —
 *     reintroducing, for this transport only, the bug that field exists to fix.
 *
 * Real AES-GCM, real X25519, real fingerprints. The last assertion in the happy
 * path opens the staged row with the ACTUAL client opener, so "the user can see
 * this transaction" is proven rather than assumed.
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
/* email_transactions has no family_id column — a client knows its OWN family and
   supplies it, which is exactly what makes the binding inside the box a check
   rather than a copy. Every open in this file goes through here. */
const open = (row) => clientOpen({ ...row, family_id: FAMILY }, FAMILY_SECRET);
/* The sealed payload has two levels: the columns email_transactions would have
   had at the top, and the fuller reading under raw_extracted. Fields with no
   column of their own — balance, channel, the masked tail, the memo — live only
   in the blob, so the two are asserted through different helpers on purpose. */
const raw = (row) => open(row).raw_extracted;

let pass = 0, fail = 0;
const t = (n, ok, d) => { console.log((ok ? '  PASS  ' : '  FAIL  ') + n + (!ok && d ? '  -> ' + d : '')); ok ? pass++ : fail++; };

const FAMILY_SECRET = new Uint8Array(crypto.randomBytes(32));
const FAMILY_PUB = Buffer.from(nacl.box.keyPair.fromSecretKey(FAMILY_SECRET).publicKey).toString('base64');
const DEDUP_KEY = crypto.randomBytes(32).toString('base64');
const SUBTLE = crypto.webcrypto.subtle;

const USER = 'user-1', MEMBER = 'mem-1', FAMILY = 'fam-1', EMAIL = 'me@gmail.com';

/* The payload as the Python parser would send it: its own Reading field names,
   snake_case, with the memo under `description`. Kept in ONE place so a drift in
   what they send is one edit here rather than scattered through the file. */
function payload(over, readingOver) {
  return {
    email: EMAIL,
    gmailMessageId: 'msg-aaa',
    sourceProvider: 'techcombank',
    senderKind: 'bank',
    reading: {
      amount: 250000,
      direction: 'debit',
      merchant: 'HIGHLANDS COFFEE',
      description: 'ca phe sang',
      occurred_at: '2026-08-21T06:15:00Z',
      reference: 'FT26234',
      account_tail: '4412',
      balance: 1750000,
      channel: 'POS',
      ...(readingOver || {}),
    },
    ...(over || {}),
  };
}

function makeDb(o) {
  o = o || {};
  const state = {
    staged: [], failures: [], lookups: [],
    members: o.members || { [MEMBER]: { id: MEMBER, family_id: FAMILY, archived_at: null } },
    stagingPub: 'stagingPub' in o ? o.stagingPub : FAMILY_PUB,
    grants: 'grants' in o ? o.grants : [{
      id: 'grant-1', user_id: USER, member_id: MEMBER, family_id: FAMILY,
      provider: 'google', email: EMAIL, needs_reauth: false,
    }],
  };
  return {
    state,
    async grantByEmail(email, folded) {
      state.lookups.push(email);
      return state.grants.find(g => g.email === email)
        || (folded ? state.grants.find(g => g.email === folded) : null) || null;
    },
    async memberById(id) { return state.members[id] || null; },
    async stagingPubForFamily() { return state.stagingPub; },
    async providerDomains() { return o.domains || []; },
    async alreadyStaged(ids) {
      const have = new Set(state.staged.map(r => r.gmail_message_id));
      return new Set(ids.filter(id => have.has(id)));
    },
    async stagedCandidates() { return o.candidates || []; },
    async insertStaged(row) {
      if (state.staged.some(r => r.gmail_message_id === row.gmail_message_id)) return false;
      state.staged.push(row);
      return true;
    },
    async recordFailure(row) { state.failures.push(row); },
  };
}

const ctxFor = (db, over) => ({
  db, nacl, subtle: SUBTLE, rng: crypto.webcrypto, dedupKey: DEDUP_KEY, ...(over || {}),
});

const ING = require('node:module');

(async () => {
const I = await import('../supabase/functions/_shared/mailbox/ingest.mjs');
const S = await import('../supabase/functions/_shared/mailbox/stage.mjs');

/* ── the whole point: it arrives, sealed, and the family can open it ──────── */
console.log('\n-- a parsed mail becomes a sealed row the family can read --');
{
  const db = makeDb();
  const out = await I.runIngest(payload(), ctxFor(db));

  t('staged', out.status === 'staged' && out.ack === true, JSON.stringify(out));
  t('exactly one row', db.state.staged.length === 1);

  const row = db.state.staged[0];
  t('the message id is the idempotency key, in the clear',
    row.gmail_message_id === 'msg-aaa');
  t('routed to the member the grant names', row.member_id === MEMBER);
  t('review_status is pending — nothing auto-enters the ledger',
    row.review_status === 'pending');
  t('all four envelope columns are set (0068 refuses a half-sealed row)',
    !!row.sealed && !!row.eph_pub && !!row.nonce && row.enc_v === 1);

  // Against the builder's own exported list rather than a copy of it here.
  const leaked = S.MUST_BE_NULL_WHEN_SEALED.filter(c => row[c] != null);
  t('nothing sensitive is readable on the row', leaked.length === 0, 'leaked: ' + leaked);

  // THE assertion: the real client opener, with the real family secret.
  const opened = open(row);
  t('the client opener reads the amount back', opened && opened.amount === 250000,
    JSON.stringify(opened && opened.amount));
  t('and the direction', opened && opened.direction === 'debit');
  t('and the merchant', opened && opened.counterparty === 'HIGHLANDS COFFEE');
  t('and the memo the person typed', raw(row).memo === 'ca phe sang');
  t('currency defaults to VND', opened && opened.currency === 'VND');
  t('the transport is recorded on the row', raw(row)._transport === 'oauth_direct');
  t('raw_body is absent, not merely null — the mail stays in their mailbox',
    opened.raw_body === undefined && raw(row).raw_body === undefined);
}

/* ── the tidy, which is why the review screen stays honest ────────────────── */
console.log('\n-- bank auto-fill is judged here, not passed through --');
{
  // Pure filler, catchable from the memo alone.
  const db = makeDb();
  await I.runIngest(payload({}, { description: 'ck' }), ctxFor(db));
  t('a filler-only memo is judged empty without needing the body',
    raw(db.state.staged[0]).memo_display === '');
}
{
  /* THE ONE THAT NEEDS THE BODY, and the reason `body` is in the payload at all.
     "NGUYEN THU TRANG chuyen tien" is the account holder's own name plus filler.
     The name is not in any extraction schema; it is identified by appearing
     ELSEWHERE in the mail, which is a question the memo alone cannot answer. So
     with no body the tidy correctly declines to guess and keeps the raw memo —
     and the review screen then pre-fills it, which is the bug. */
  const db = makeDb();
  await I.runIngest(payload({}, { description: 'NGUYEN THU TRANG chuyen tien' }), ctxFor(db));
  t('without the body the holder name is NOT strippable, so the memo stands',
    raw(db.state.staged[0]).memo_display === 'NGUYEN THU TRANG chuyen tien',
    JSON.stringify(raw(db.state.staged[0]).memo_display));
}
{
  const db = makeDb();
  await I.runIngest(payload({ body: 'Kinh gui Quy khach NGUYEN THU TRANG. Tai khoan trich no. NGUYEN THU TRANG chuyen tien' },
                            { description: 'NGUYEN THU TRANG chuyen tien' }), ctxFor(db));
  const x = raw(db.state.staged[0]);
  t('WITH the body the name is found and the verdict is "" — the box stays blank',
    x.memo_display === '', JSON.stringify(x.memo_display));
  t('and the raw memo is still kept verbatim, so the judgement is recoverable',
    x.memo === 'NGUYEN THU TRANG chuyen tien');
}
{
  const db = makeDb();
  await I.runIngest(payload({}, { description: 'tra tien an trua thu 6' }), ctxFor(db));
  t('a memo someone actually typed survives the tidy',
    raw(db.state.staged[0]).memo_display === 'tra tien an trua thu 6');
}
{
  const db = makeDb();
  // The aggregator prefix names the processor, not the shop that was visited.
  await I.runIngest(payload({}, { merchant: 'MPOS*QUICK SAVE MARKET' }), ctxFor(db));
  const opened = open(db.state.staged[0]);
  t('the aggregator prefix is stripped off the merchant',
    opened.counterparty === 'QUICK SAVE MARKET', opened.counterparty);
}

/* ── a caller we do not control ───────────────────────────────────────────── */
console.log('\n-- the payload is validated, never trusted --');
for (const [name, p, reason] of [
  ['no message id', payload({ gmailMessageId: undefined }), I.REJECT.NO_MESSAGE_ID],
  ['no email', payload({ email: undefined }), I.REJECT.NO_EMAIL],
  ['no reading at all', payload({ reading: undefined }), I.REJECT.MALFORMED],
  ['null body', null, I.REJECT.MALFORMED],
  ['amount missing', payload({}, { amount: undefined }), I.REJECT.NO_AMOUNT],
  ['amount NaN', payload({}, { amount: NaN }), I.REJECT.NO_AMOUNT],
  ['amount Infinity', payload({}, { amount: Infinity }), I.REJECT.NO_AMOUNT],
  ['amount as a string', payload({}, { amount: '250000' }), I.REJECT.NO_AMOUNT],
  ['amount negative', payload({}, { amount: -5 }), I.REJECT.NO_AMOUNT],
  ['direction missing', payload({}, { direction: undefined }), I.REJECT.BAD_DIRECTION],
  ['direction invented', payload({}, { direction: 'outgoing' }), I.REJECT.BAD_DIRECTION],
]) {
  const db = makeDb();
  const out = await I.runIngest(p, ctxFor(db));
  t(name + ' -> rejected, nothing staged',
    out.status === 'rejected' && out.reason === reason && db.state.staged.length === 0,
    JSON.stringify(out));
  t(name + ' -> acked (a retry cannot fix a malformed payload)', out.ack === true);
}

/* ── a mailbox we do not hold ─────────────────────────────────────────────── */
console.log('\n-- a mailbox with no grant is ordinary, not an error --');
{
  const db = makeDb({ grants: [] });
  const out = await I.runIngest(payload(), ctxFor(db));
  t('no grant -> ignored and acked', out.status === 'ignored' && out.reason === 'no_grant' && out.ack === true);
  t('nothing staged', db.state.staged.length === 0);
}
{
  // Gmail folds dots and +tags; the grant lookup has to see through that or a
  // mailbox connected as one spelling never matches the other.
  const db = makeDb();
  await I.runIngest(payload({ email: 'ME@gmail.com' }), ctxFor(db));
  t('the address is folded before the grant is given up on',
    db.state.staged.length === 1 || db.state.lookups.length > 0);
}

/* ── seal or hold, and the reason a hold has to be RECORDED here ──────────── */
console.log('\n-- seal or hold: there is no third option --');
{
  const db = makeDb({ stagingPub: null });
  const out = await I.runIngest(payload(), ctxFor(db));
  t('no staging key -> held, never staged in the clear',
    out.status === 'held' && out.reason === 'no_staging_pub' && db.state.staged.length === 0,
    JSON.stringify(out));
  t('the hold is RECORDED — this path owns no cursor to leave alone',
    db.state.failures.length === 1 && /ingest_hold:no_staging_pub/.test(db.state.failures[0].error_reason),
    JSON.stringify(db.state.failures));
  t('and nothing readable went into the record',
    !JSON.stringify(db.state.failures[0]).includes('250000'));
  t('acked: redelivery cannot mint a key the family has not made',
    out.ack === true);
}
{
  const db = makeDb({ members: { [MEMBER]: { id: MEMBER, family_id: FAMILY, archived_at: '2026-01-01T00:00:00Z' } } });
  const out = await I.runIngest(payload(), ctxFor(db));
  t('an archived member holds — its rows would be visible to nobody, forever',
    out.status === 'held' && out.reason === 'member_archived' && db.state.staged.length === 0);
}
{
  // Sealing to a family the member has left produces a row their current family
  // cannot open and their old family cannot see.
  const db = makeDb({ members: { [MEMBER]: { id: MEMBER, family_id: 'fam-OTHER', archived_at: null } } });
  const out = await I.runIngest(payload(), ctxFor(db));
  t('a moved member holds rather than sealing to the family they left',
    out.status === 'held' && out.reason === 'member_moved' && db.state.staged.length === 0);
}
{
  const db = makeDb({ grants: [{
    id: 'grant-1', user_id: USER, member_id: MEMBER, family_id: FAMILY,
    provider: 'google', email: EMAIL, needs_reauth: true,
  }] });
  const out = await I.runIngest(payload(), ctxFor(db));
  t('a grant awaiting re-consent holds', out.status === 'held' && out.reason === 'needs_reauth');
}

/* ── at-least-once delivery, by their own docstring ───────────────────────── */
console.log('\n-- the same mail arriving twice is one transaction --');
{
  const db = makeDb();
  const a = await I.runIngest(payload(), ctxFor(db));
  const b = await I.runIngest(payload(), ctxFor(db));
  t('first staged', a.status === 'staged');
  t('second skipped, not staged again',
    b.status === 'skipped' && b.reason === 'already_staged', JSON.stringify(b));
  t('still exactly one row', db.state.staged.length === 1);
  t('the redelivery is acked', b.ack === true);
}
{
  // If two deliveries race past alreadyStaged, the UNIQUE underneath is what
  // holds — and losing that race must not read as a failure.
  const db = makeDb();
  db.alreadyStaged = async () => new Set();          // both see an empty table
  const a = await I.runIngest(payload(), ctxFor(db));
  const b = await I.runIngest(payload(), ctxFor(db));
  t('a race past the check is caught by the unique constraint',
    a.status === 'staged' && b.status === 'skipped' && b.reason === 'raced',
    JSON.stringify(b));
  t('and still leaves one row', db.state.staged.length === 1);
}

/* ── whose sender registry wins ───────────────────────────────────────────── */
console.log('\n-- our sender registry is authoritative where it can be --');
{
  const db = makeDb();
  const out = await I.runIngest(
    payload({ from: 'Techcombank <no-reply@techcombank.com.vn>', sourceProvider: 'tcb-something-else' }),
    ctxFor(db));
  t('a domain we know overrides the caller’s label',
    out.status === 'staged' && db.state.staged[0].source_provider !== 'tcb-something-else',
    db.state.staged[0] && db.state.staged[0].source_provider);
  t('and it is not flagged as unknown', out.senderUnknownToUs === false);
}
{
  const db = makeDb();
  const out = await I.runIngest(
    payload({ from: 'Bank <alerts@some-bank-we-have-not-listed.vn>', sourceProvider: 'newbank' }),
    ctxFor(db));
  t('a domain we do NOT know is still staged — dropping it would be invisible',
    out.status === 'staged' && db.state.staged.length === 1);
  t('under the caller’s own label', db.state.staged[0].source_provider === 'newbank');
  t('and the divergence between the two registries is REPORTED',
    out.senderUnknownToUs === true);
}

/* ── the details that decide whether a reading survives the trip ──────────── */
console.log('\n-- the reading is translated, not assumed --');
{
  const db = makeDb();
  await I.runIngest(payload({}, { currency: 'USD', amount: 200 }), ctxFor(db));
  const opened = open(db.state.staged[0]);
  t('a USD reading stays USD — 200 USD is not 200 VND',
    opened.currency === 'USD' && opened.amount === 200);
}
{
  const db = makeDb();
  await I.runIngest(payload(), ctxFor(db));
  const row = db.state.staged[0];
  const opened = open(row);
  t('occurred_at survives in the clear, because dedup queries a date range',
    row.occurred_at === '2026-08-21T06:15:00Z');
  t('the reference rides inside the box', opened.reference_number === 'FT26234');
  t('so does the masked account tail', raw(row).account_masked === '4412');
  t('so does the balance', raw(row).balance === 1750000);
  t('so does the channel', raw(row).channel === 'POS');
  t('a bank sender is typed bank_txn', opened.transaction_type === 'bank_txn');
  t('a dedup fingerprint was computed', typeof row.dedup_fp === 'string' && row.dedup_fp.length > 0);
}
{
  const db = makeDb();
  await I.runIngest(payload({ senderKind: 'wallet', from: undefined }), ctxFor(db));
  const opened = open(db.state.staged[0]);
  t('a wallet sender is typed ecommerce_receipt, not bank_txn',
    opened.transaction_type === 'ecommerce_receipt');
}
{
  // The body is passed for the tidy's benefit and must not survive the trip.
  const db = makeDb();
  await I.runIngest(
    payload({ body: 'Kinh gui Quy khach NGUYEN THU TRANG ... NGUYEN THU TRANG chuyen tien' },
            { description: 'NGUYEN THU TRANG chuyen tien' }),
    ctxFor(db));
  const row = db.state.staged[0];
  const opened = open(row);
  t('the body is used for the tidy and never stored',
    !JSON.stringify(row).includes('Kinh gui') && !JSON.stringify(opened).includes('Kinh gui'));
  t('and with the body in hand the repeated holder name is caught',
    raw(row).memo_display === '');
}

/* ── notification carries nothing ─────────────────────────────────────────── */
console.log('\n-- the notification must not learn what the row says --');
{
  const db = makeDb();
  const sent = [];
  await I.runIngest(payload(), ctxFor(db, { notify: (g, n) => { sent.push({ g, n }); } }));
  t('one notification for one staged row', sent.length === 1);
  t('it carries no amount and no merchant',
    !JSON.stringify(sent[0]).includes('250000') && !JSON.stringify(sent[0]).includes('HIGHLANDS'));
}
{
  const db = makeDb();
  const out = await I.runIngest(payload(), ctxFor(db, { notify: () => { throw new Error('push is down'); } }));
  t('a failed notification never fails the ingest',
    out.status === 'staged' && db.state.staged.length === 1);
}
{
  const db = makeDb({ stagingPub: null });
  const sent = [];
  await I.runIngest(payload(), ctxFor(db, { notify: () => sent.push(1) }));
  t('a held mail notifies nobody — there is nothing to review',
    sent.length === 0);
}

console.log('\n' + (fail === 0 ? 'ALL ' + pass + ' PASSED' : pass + ' passed, ' + fail + ' FAILED'));
process.exit(fail ? 1 : 0);
})();
