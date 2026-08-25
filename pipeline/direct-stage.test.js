#!/usr/bin/env node
/* Nothing readable, and nothing unowned, may reach email_transactions.
 * `node pipeline/direct-stage.test.js`
 *
 * Two invariants, and both fail silently in production if they break.
 *
 * SEAL-OR-HOLD. There is no code path from "could not seal" to a readable
 * insert. Under forwarding that is enforced by trySealRow returning null and
 * the message staying labelled txn/inbox; here it is enforced by throwing, and
 * the poller leaving the cursor where it is. A plaintext fallback would be
 * invisible — the row inserts, the queue renders, the review screen shows the
 * transaction, and the only thing that changed is that the database can read
 * the family's money.
 *
 * OWNERSHIP OR NOTHING. email_transactions has no family_id column, so
 * member_id is a row's ONLY link to a family (0058). A row staged against a
 * dead, archived or moved member is visible to nobody — permanently, including
 * to the person whose transaction it is, who therefore cannot delete it either.
 * Every one of those cases is a HOLD, and a hold is cheap: the same window is
 * read again next poll and stages correctly the moment the state is fixed.
 */
const nacl = require('tweetnacl');
const crypto = require('crypto');

global.atob = b64 => Buffer.from(b64, 'base64').toString('binary');
global.btoa = s => Buffer.from(s, 'binary').toString('base64');

let pass = 0, fail = 0;
const t = (n, ok, d) => { console.log((ok ? '  PASS  ' : '  FAIL  ') + n + (!ok && d ? '  -> ' + d : '')); ok ? pass++ : fail++; };

const FAMILY_SECRET = Buffer.from('AQIDBAUGBwgJCgsMDQ4PEBESExQVFhcYGRobHB0eHyA=', 'base64');
const FAMILY_PUB = Buffer.from(
  nacl.box.keyPair.fromSecretKey(new Uint8Array(FAMILY_SECRET)).publicKey).toString('base64');
const KEY = crypto.randomBytes(32).toString('base64');

(async () => {
const I = await import('../supabase/functions/_shared/mailbox/identity.mjs');
const S = await import('../supabase/functions/_shared/mailbox/stage.mjs');
const SB = await import('../supabase/functions/_shared/mailbox/sealed-box.mjs');

// ── identity ────────────────────────────────────────────────────────────────
console.log('\n-- resolving a grant to a destination --');
const GRANT = { member_id: 'mem-1', family_id: 'fam-1', needs_reauth: false, email: 'a@b.com' };
const okDb = {
  memberById: async () => ({ id: 'mem-1', family_id: 'fam-1', archived_at: null }),
  stagingPubForFamily: async () => FAMILY_PUB,
};
const dest = await I.resolveDestination(GRANT, okDb);
t('resolves member, family and staging key',
  dest.memberId === 'mem-1' && dest.familyId === 'fam-1' && dest.stagingPub === FAMILY_PUB);

const holds = async (name, grant, db, reason) => {
  try {
    await I.resolveDestination(grant, db);
    t(name, false, 'resolved instead of holding');
  } catch (e) {
    t(name, e instanceof I.MailboxHold && e.reason === reason,
      'got ' + e.name + ':' + (e.reason || e.message));
  }
};
await holds('a grant awaiting re-consent holds',
  { ...GRANT, needs_reauth: true }, okDb, I.HOLD.NEEDS_REAUTH);
await holds('a grant with no destination holds',
  { ...GRANT, member_id: null }, okDb, I.HOLD.NO_MEMBER);
await holds('a member that no longer exists holds',
  GRANT, { ...okDb, memberById: async () => null }, I.HOLD.NO_MEMBER);
await holds('an archived member holds',
  GRANT, { ...okDb, memberById: async () => ({ id: 'mem-1', family_id: 'fam-1', archived_at: '2026-08-01' }) },
  I.HOLD.MEMBER_ARCHIVED);
// The row would be sealed to the grant's family; a member who has moved could
// not open it, and the family they left could not see it.
await holds('a member moved to another family holds',
  GRANT, { ...okDb, memberById: async () => ({ id: 'mem-1', family_id: 'fam-2', archived_at: null }) },
  I.HOLD.MEMBER_MOVED);
await holds('a family with no staging key holds',
  GRANT, { ...okDb, stagingPubForFamily: async () => null }, I.HOLD.NO_STAGING_PUB);

t('every hold stops the mailbox, not just one message',
  I.stopsMailbox(new I.MailboxHold(I.HOLD.NO_STAGING_PUB)));

// ── staging ─────────────────────────────────────────────────────────────────
console.log('\n-- the row that reaches the table --');
const reading = {
  amount: 165000, direction: 'debit', currency: 'VND',
  merchant: 'HIGHLANDS COFFEE', reference: 'FT26234000123',
  occurredAt: '2026-08-24T03:15:00.000Z', balance: 4210000,
  description: 'ca phe sang', channel: 'QR', accountTail: '5153',
  category: 'ăn uống',
};
const deps = { nacl, dedupKey: KEY, subtle: crypto.webcrypto.subtle };
const row = await S.buildStagedRow({
  gmailMessageId: 'gmail-1', destination: dest, reading,
  sourceProvider: 'Highlands', senderKind: 'wallet', deps,
});

t('carries the envelope, all four columns together',
  !!(row.sealed && row.eph_pub && row.nonce) && row.enc_v === 1);
t('keeps the idempotency key clear', row.gmail_message_id === 'gmail-1');
t('keeps ownership clear', row.member_id === 'mem-1');
t('keeps the provider clear, because dedup matches it fuzzily', row.source_provider === 'Highlands');
t('keeps occurred_at clear, because dedup queries a range', row.occurred_at === reading.occurredAt);
t('carries a fingerprint', typeof row.dedup_fp === 'string' && row.dedup_fp.length > 0);
t('stages as pending, the only status ever written', row.review_status === 'pending');

console.log('\n-- what must NOT be on the row (0068) --');
for (const col of S.MUST_BE_NULL_WHEN_SEALED) {
  t(`${col} is absent from a sealed row`, row[col] === undefined || row[col] === null,
    col + '=' + JSON.stringify(row[col]));
}

console.log('\n-- and is all present inside the box --');
const opened = SB.openSealedRow(
  { ...row, family_id: 'fam-1' }, new Uint8Array(FAMILY_SECRET), { nacl });
t('amount', opened.amount === 165000);
t('direction', opened.direction === 'debit');
t('currency defaults to VND', opened.currency === 'VND');
t('counterparty', opened.counterparty === 'HIGHLANDS COFFEE');
t('reference_number', opened.reference_number === 'FT26234000123');
t('transaction_type is a value 0025 accepts',
  S.TXN_TYPES.indexOf(opened.transaction_type) >= 0, opened.transaction_type);
t('a wallet reads as a receipt, not as a bank transaction',
  opened.transaction_type === 'ecommerce_receipt');
// The client's bank-vs-bank rule reads this out of raw_extracted, so it has to
// be inside the box as well as on the payload.
t('raw_extracted carries transaction_type for the client dedup rule',
  opened.raw_extracted.transaction_type === 'ecommerce_receipt');
t('the memo survives — the only field saying WHY money moved',
  opened.raw_extracted.memo === 'ca phe sang');
t('balance survives', opened.raw_extracted.balance === 4210000);
t('channel survives', opened.raw_extracted.channel === 'QR');
t('the masked account survives', opened.raw_extracted.account_masked === '5153');
t('the category is carried as a hint for the review screen',
  opened.raw_extracted.category_hint === 'ăn uống');
t('the transport is recorded on the row', opened.raw_extracted._transport === 'oauth_direct');
t('raw_body is nowhere, sealed or clear',
  opened.raw_body === undefined && opened.raw_extracted.raw_body === undefined);

console.log('\n-- a bank sender reads as a bank transaction --');
const bankRow = await S.buildStagedRow({
  gmailMessageId: 'gmail-2', destination: dest, reading,
  sourceProvider: 'MB Bank', senderKind: 'bank', deps,
});
t('senderKind bank -> bank_txn',
  SB.openSealedRow({ ...bankRow, family_id: 'fam-1' }, new Uint8Array(FAMILY_SECRET), { nacl })
    .transaction_type === 'bank_txn');
t('an unrecognised sender kind is a receipt, never a bank claim',
  S.transactionTypeFor(undefined) === 'ecommerce_receipt');

console.log('\n-- seal-or-hold has no second path --');
const refuses = async (name, over, want) => {
  let msg = null;
  try {
    await S.buildStagedRow({
      gmailMessageId: 'gmail-3', destination: dest, reading,
      sourceProvider: 'MB', senderKind: 'bank', deps, ...over,
    });
  } catch (e) { msg = e.message; }
  t(name, !!msg && msg.indexOf(want) === 0, String(msg));
};
await refuses('no staging key -> throws, never a plaintext row',
  { destination: { ...dest, stagingPub: null } }, 'STAGE_NO_DESTINATION');
await refuses('no member -> throws, never an unowned row',
  { destination: { ...dest, memberId: null } }, 'STAGE_NO_DESTINATION');
await refuses('no message id -> throws, never a row without its idempotency key',
  { gmailMessageId: null }, 'STAGE_NO_MESSAGE_ID');
await refuses('an unread mail is not staged as a zero',
  { reading: { direction: 'debit' } }, 'STAGE_NOT_READABLE');
await refuses('a reading with no direction is not staged',
  { reading: { amount: 1000 } }, 'STAGE_NOT_READABLE');
await refuses('a missing dedup key stops the row, it does not stage unfingerprinted',
  { deps: { ...deps, dedupKey: '' } }, 'DEDUP_FP_KEY_MISSING');

console.log('\n-- dedup runs against the member\'s own staged rows --');
let askedFor = null;
const dupRow = await S.buildStagedRow({
  gmailMessageId: 'gmail-4', destination: dest, reading,
  sourceProvider: 'Highlands', senderKind: 'wallet',
  deps: {
    ...deps,
    db: {
      stagedCandidates: async q => {
        askedFor = q;
        return [{ id: 'r-earlier', source_provider: 'MB Bank',
                  occurred_at: reading.occurredAt, created_at: '2026-08-24T02:00:00.000Z' }];
      },
    },
  },
});
t('scopes the dedup query to the owning member', askedFor && askedFor.memberId === 'mem-1');
t('queries by fingerprint, not by the amount it just sealed away',
  askedFor && askedFor.dedupFp === dupRow.dedup_fp && askedFor.amount === undefined);
t('flags the earlier cross-source row as a possible duplicate',
  dupRow.duplicate_of_id === 'r-earlier');
t('a flag is a suspicion — the row is still staged and still pending',
  dupRow.review_status === 'pending' && !!dupRow.sealed);

console.log('\n' + (fail ? 'FAILED ' + fail + ' of ' + (pass + fail)
                         : 'ALL ' + pass + ' assertions passed'));
process.exit(fail ? 1 : 0);
})();
