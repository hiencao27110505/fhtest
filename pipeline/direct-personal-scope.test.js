#!/usr/bin/env node
/* Personal money must never be sealed to a key the family shares.
 * `node pipeline/direct-personal-scope.test.js`
 *
 * WHAT THIS IS ABOUT. Bank email was sealed to `family_keys.staging_pub` for
 * every row, because that was the only staging key that existed. Since Model Y
 * (0079) a person's money has two destinations — the family ledger under a
 * shared key, and `personal_transactions` under their own — and the review
 * screen already lets them pick per row.
 *
 * So a transaction meant to stay private sat, from arrival until promotion,
 * sealed to a key the whole household shares. Nothing leaked: 0058's RLS scopes
 * SELECT to the reader's own member rows. But that left the privacy of personal
 * money resting on ROW-LEVEL SECURITY ALONE while the product tells the person
 * their personal data is under their own key. Encryption is the half that is
 * supposed to survive the other being wrong.
 *
 * These tests use TWO REAL X25519 keypairs and assert the strong form: a
 * personal row opens with the person's key and FAILS to open with the family's.
 * "Sealed to the right key" asserted by a column value would pass while the
 * bytes were sealed to the wrong one.
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

// Two genuinely different keypairs — the family's, and this person's.
const FAM_SEC = new Uint8Array(crypto.randomBytes(32));
const FAM_PUB = Buffer.from(nacl.box.keyPair.fromSecretKey(FAM_SEC).publicKey).toString('base64');
const PER_SEC = new Uint8Array(crypto.randomBytes(32));
const PER_PUB = Buffer.from(nacl.box.keyPair.fromSecretKey(PER_SEC).publicKey).toString('base64');

const USER = 'user-1', MEMBER = 'mem-1', FAMILY = 'fam-1';
const DEDUP_KEY = crypto.randomBytes(32).toString('base64');

const READING = {
  amount: 250000, direction: 'debit', currency: 'VND',
  merchant: 'HIGHLANDS COFFEE', description: 'ca phe',
  occurredAt: '2026-08-21T06:15:00Z',
};

function makeDb(o) {
  o = o || {};
  return {
    async memberById(id) {
      return id === MEMBER ? { id: MEMBER, family_id: FAMILY, archived_at: null } : null;
    },
    async stagingPubForFamily() { return 'famPub' in o ? o.famPub : FAM_PUB; },
    async stagingPubForUser() { return 'perPub' in o ? o.perPub : PER_PUB; },
    async stagedCandidates() { return []; },
  };
}
const grant = (over) => ({
  id: 'g1', user_id: USER, member_id: MEMBER, family_id: FAMILY,
  provider: 'google', email: 'me@gmail.com', needs_reauth: false, ...(over || {}),
});
const open = (row, secret, familyId) =>
  clientOpen({ ...row, family_id: familyId || FAMILY }, secret);

(async () => {
const I = await import('../supabase/functions/_shared/mailbox/identity.mjs');
const S = await import('../supabase/functions/_shared/mailbox/stage.mjs');

const build = async (dest) => S.buildStagedRow({
  gmailMessageId: 'msg-' + Math.abs(dest.scope.length * 7 + dest.stagingPub.length),
  destination: dest, reading: READING, sourceProvider: 'Techcombank', senderKind: 'bank',
  deps: { nacl, rng: crypto.webcrypto, subtle: crypto.webcrypto.subtle, dedupKey: DEDUP_KEY, db: makeDb() },
});

console.log('\n-- scope resolution --');
{
  const d = await I.resolveDestination(grant({ default_scope: 'personal' }), makeDb());
  t('a personal grant resolves scope=personal', d.scope === 'personal');
  t('and carries the PERSON’s key, not the family’s', d.stagingPub === PER_PUB);
  t('member and family are still returned — RLS and dedup depend on them',
    d.memberId === MEMBER && d.familyId === FAMILY);
}
{
  const d = await I.resolveDestination(grant({ default_scope: 'family' }), makeDb());
  t('a family grant resolves scope=family', d.scope === 'family' && d.stagingPub === FAM_PUB);
}
{
  const d = await I.resolveDestination(grant({}), makeDb());
  t('a grant with NO scope means family — every grant predating 0091',
    d.scope === 'family' && d.stagingPub === FAM_PUB);
}
{
  // CHECK-constrained in the DB, so this only happens if a newer client wrote a
  // scope this build predates. Falling back beats throwing on a value we simply
  // do not know yet.
  const d = await I.resolveDestination(grant({ default_scope: 'trip' }), makeDb());
  t('an unrecognised scope falls back to family rather than throwing',
    d.scope === 'family' && d.stagingPub === FAM_PUB);
}

console.log('\n-- the strong form: which key actually opens the bytes --');
{
  const dest = await I.resolveDestination(grant({ default_scope: 'personal' }), makeDb());
  const row = await build(dest);

  t('the row says it was sealed personally', row.staging_scope === 'personal');

  const opened = open(row, PER_SEC);
  t('the PERSON’s key opens it', opened && opened.amount === 250000);

  let famFailed = false;
  try { open(row, FAM_SEC); } catch (e) { famFailed = true; }
  t('the FAMILY’s key CANNOT open it — this is the whole point', famFailed);
}
{
  const dest = await I.resolveDestination(grant({ default_scope: 'family' }), makeDb());
  const row = await build(dest);

  t('a family row says so', row.staging_scope === 'family');
  t('the family key opens it', open(row, FAM_SEC).amount === 250000);

  let perFailed = false;
  try { open(row, PER_SEC); } catch (e) { perFailed = true; }
  t('the person’s key does not open a family row either — they are separate keys', perFailed);
}

console.log('\n-- seal or hold, per scope --');
{
  // The person has never unlocked their own key. Distinct from the family case:
  // no relative unlocking can fix this one, so it must not report as if one could.
  const db = makeDb({ perPub: null });
  let reason = null;
  try { await I.resolveDestination(grant({ default_scope: 'personal' }), db); }
  catch (e) { reason = e.reason; }
  t('no personal staging key HOLDS, with its own reason',
    reason === I.HOLD.NO_PERSONAL_STAGING_PUB, String(reason));
}
{
  const db = makeDb({ famPub: null });
  let reason = null;
  try { await I.resolveDestination(grant({ default_scope: 'family' }), db); }
  catch (e) { reason = e.reason; }
  t('and the family case keeps its own, unchanged', reason === I.HOLD.NO_STAGING_PUB);
}
{
  // A personal grant with no user id cannot be routed to a person at all. It
  // must NOT quietly fall back to the family key — that is precisely the leak.
  const db = makeDb();
  let reason = null;
  try { await I.resolveDestination({ ...grant({ default_scope: 'personal' }), user_id: null }, db); }
  catch (e) { reason = e.reason; }
  t('a personal grant with no user holds rather than falling back to the family',
    reason === I.HOLD.NO_PERSONAL_STAGING_PUB, String(reason));
}

console.log('\n-- the scope survives the round trip to Google, signed --');
{
  const OS = await import('../supabase/functions/_shared/mailbox/oauth-state.mjs');
  const SECRET = 'state-secret';

  for (const [asked, want] of [['family', 'family'], ['personal', 'personal'], [undefined, 'personal']]) {
    const st = await OS.createState({ userId: 'u1', returnTo: '/x', scope: asked }, SECRET);
    const back = await OS.readState(st, SECRET);
    t('scope ' + String(asked) + ' reads back as ' + want, back && back.scope === want, JSON.stringify(back));
  }

  /* The reason it lives in the signed state at all: the callback is what binds
     the grant, so a destination read from an unsigned URL would be one an
     attacker could choose by sending someone a link. */
  const good = await OS.createState({ userId: 'u1', scope: 'family' }, SECRET);
  t('a tampered state is refused outright, not read with a default scope',
    (await OS.readState(good.replace(/.$/, good.slice(-1) === 'A' ? 'B' : 'A'), SECRET)) === null);
  t('a state signed with another secret is refused',
    (await OS.readState(good, 'other-secret')) === null);

  // Absence must read as the TIGHTER scope, so an older or truncated state can
  // only ever under-share.
  const legacy = await OS.createState({ userId: 'u1' }, SECRET);
  t('a state with no scope at all defaults to personal',
    (await OS.readState(legacy, SECRET)).scope === 'personal');
}

console.log('\n-- nothing else regressed --');
{
  const dest = await I.resolveDestination(grant({ default_scope: 'personal' }), makeDb());
  const row = await build(dest);
  const leaked = S.MUST_BE_NULL_WHEN_SEALED.filter(c => row[c] != null);
  t('a personal row leaks no plaintext either', leaked.length === 0, 'leaked: ' + leaked);
  t('all four envelope columns set', !!row.sealed && !!row.eph_pub && !!row.nonce && row.enc_v === 1);
  t('member_id is present so 0058 RLS still scopes it', row.member_id === MEMBER);
  t('a fingerprint was still computed', typeof row.dedup_fp === 'string' && row.dedup_fp.length > 0);
}

console.log('\n' + (fail === 0 ? 'ALL ' + pass + ' PASSED' : pass + ' passed, ' + fail + ' FAILED'));
process.exit(fail ? 1 : 0);
})();
