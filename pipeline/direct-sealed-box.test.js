#!/usr/bin/env node
/* The direct-read seal side must be interchangeable with the forwarding one.
 * `node pipeline/direct-sealed-box.test.js`
 *
 * There are now TWO implementations of the seal half — pipeline/sealed-box.gs
 * (Apps Script, forwarding) and supabase/functions/mailbox-sync/lib/
 * sealed-box.mjs (this transport) — and exactly ONE opener, on the client,
 * reading rows written by both. A divergence between the two sealers does not
 * fail anywhere near itself: the row inserts fine, the queue renders fine, and
 * the person sees "Không mở được" against a transaction they can no longer
 * recover, days later.
 *
 * So this file does not test the new module against itself. It tests it in both
 * directions against things that already existed:
 *
 *   1. our opener against the PUBLISHED VECTOR (AGENT_SYNC, the bytes the two
 *      sessions agreed on) — proves we read the format the same way;
 *   2. the REAL CLIENT OPENER against what we seal — proves the app can open
 *      our rows, which is the only claim that actually matters.
 *
 * The client opener used here is pipeline/client-reference-staging-keys.js,
 * which is byte-for-byte the code folded into src/js-data/18-staging-keys.js
 * (see that file's header) and is itself vector-tested.
 */
const nacl = require('tweetnacl');
const fs = require('fs');
const path = require('path');

// ── browser shims, same set the client reference test installs ──────────────
global.nacl = nacl;
global.atob = b64 => Buffer.from(b64, 'base64').toString('binary');
global.btoa = s => Buffer.from(s, 'binary').toString('base64');
global.TextDecoder = require('util').TextDecoder;
global.TextEncoder = require('util').TextEncoder;
global.window = {};

eval(fs.readFileSync(path.join(__dirname, 'client-reference-staging-keys.js'), 'utf8'));
const clientOpen = window.fhStagingOpenRow;

let pass = 0, fail = 0;
const t = (n, ok, d) => { console.log((ok ? '  PASS  ' : '  FAIL  ') + n + (!ok && d ? '  -> ' + d : '')); ok ? pass++ : fail++; };

// The published vector, verbatim from AGENT_SYNC — the same bytes
// client-reference-staging-keys.test.js asserts against.
const V = {
  family_secret_b64: 'AQIDBAUGBwgJCgsMDQ4PEBESExQVFhcYGRobHB0eHyA=',
  family_pub_b64:    'B6N8vBQgk8i3VdwbEOhstCY3StFqqFPtC9/AsrhtHHw=',
  sealed:  '8zalVBFRZSuGypawcdYxLBNurbCzx/nPOaIWwhf4I4b7ukoHaXIoUGY9vH9YPqN8lEDmqhUSTwasIqpIwI4stCsO51+YLVvNRVBsK2ennytoipHWreDjT3CPc0zGgNbMvoZz8F7ZRqiQQSmczmqWXOmn5SNnDELeDUE1fYtiQ45anbh4zEoSTD7SeQAOXTrYXo6IkuQ36pqy+MmLHKEHkNMZI/s1661tsNM=',
  eph_pub: 'A4lq9OBb6ZGenQBoYA1dm5AlpNVrDlUvMaFkfNRozC8=',
  nonce:   'Ef1W6Bh5VrWw5kvQdK31RCwAHyAb23pA',
  enc_v: 1,
};
const familyPriv = new Uint8Array(Buffer.from(V.family_secret_b64, 'base64'));

(async () => {
const SB = await import('../supabase/functions/mailbox-sync/lib/sealed-box.mjs');

console.log('\n-- our opener reads the published vector --');
const row = { ...V, family_id: 'fam-test-0001', gmail_message_id: 'gmail-test-0001' };
let got = null, threw = null;
try { got = SB.openSealedRow(row, familyPriv, { nacl }); } catch (e) { threw = e.message; }
t('opens the vector at all', !!got, threw || 'no result');
t('amount == 2000', !!got && got.amount === 2000);
t('currency == VND', !!got && got.currency === 'VND');
t('counterparty exact', !!got && got.counterparty === 'NGUYEN THU TRANG - 0944684991');
t('carries the bound family_id', !!got && got.family_id === 'fam-test-0001');
t('carries the bound gmail_message_id', !!got && got.gmail_message_id === 'gmail-test-0001');

console.log('\n-- the client opens what WE seal --');
const payload = {
  amount: 165000, currency: 'VND', direction: 'debit',
  counterparty: 'HIGHLANDS COFFEE',
  reference_number: 'FT26234000123',
  transaction_type: 'ecommerce_receipt',
  raw_extracted: { memo: 'ca phe sang', channel: 'QR', balance: 4210000 },
};
const sealedRow = SB.sealForFamily(payload, V.family_pub_b64, 'fam-A', 'gmail-A', { nacl });

t('emits sealed/eph_pub/nonce/enc_v',
  !!(sealedRow.sealed && sealedRow.eph_pub && sealedRow.nonce) && sealedRow.enc_v === 1);
t('eph_pub is 32 bytes', Buffer.from(sealedRow.eph_pub, 'base64').length === 32);
t('nonce is 24 bytes', Buffer.from(sealedRow.nonce, 'base64').length === 24);

const asRow = { ...sealedRow, family_id: 'fam-A', gmail_message_id: 'gmail-A' };
let opened = null, openErr = null;
try { opened = clientOpen(asRow, familyPriv); } catch (e) { openErr = e.message; }
t('CLIENT opener succeeds on our ciphertext', !!opened, openErr || 'no result');
t('amount survives the round trip', !!opened && opened.amount === 165000);
t('nested raw_extracted survives', !!opened && opened.raw_extracted && opened.raw_extracted.memo === 'ca phe sang');
t('binding injected by the sealer, not by the caller',
  !!opened && opened.family_id === 'fam-A' && opened.gmail_message_id === 'gmail-A');
t('payload never carried the binding itself',
  payload.family_id === undefined && payload.gmail_message_id === undefined);

console.log('\n-- freshness: nothing is reused between seals --');
const s2 = SB.sealForFamily(payload, V.family_pub_b64, 'fam-A', 'gmail-A', { nacl });
t('a second seal uses a different ephemeral key', s2.eph_pub !== sealedRow.eph_pub);
t('a second seal uses a different nonce', s2.nonce !== sealedRow.nonce);
t('a second seal produces different ciphertext', s2.sealed !== sealedRow.sealed);

console.log('\n-- the failures the binding exists to catch --');
const expectClientThrow = (name, mutate, wantMsg) => {
  const bad = mutate({ ...asRow });
  try { clientOpen(bad, familyPriv); t(name, false, 'did not throw'); }
  catch (e) { t(name, e.message.indexOf(wantMsg) === 0, 'got: ' + e.message); }
};
// Ciphertext moved onto another row of the same family: the amount would land
// on the wrong transaction, and nothing outside the box could tell.
expectClientThrow('ciphertext relocated to another message is rejected',
  r => ({ ...r, gmail_message_id: 'gmail-B' }), 'staging_identity_mismatch');
expectClientThrow('ciphertext relocated to another family is rejected',
  r => ({ ...r, family_id: 'fam-B' }), 'staging_identity_mismatch');
expectClientThrow('a tampered box is rejected by Poly1305', r => {
  const b = Buffer.from(r.sealed, 'base64'); b[10] ^= 0xff;
  return { ...r, sealed: b.toString('base64') };
}, 'staging_open_failed');
expectClientThrow('an unknown envelope version is refused, not guessed',
  r => ({ ...r, enc_v: 2 }), 'staging_enc_version_unsupported');

console.log('\n-- randomness has no fallback --');
// The whole reason this module exists rather than porting the Apps Script DRBG.
// A fallback here would be undetectable in every other test in this file.
let noRngErr = null;
try {
  SB.sealForFamily(payload, V.family_pub_b64, 'fam-A', 'gmail-A', { nacl, rng: {} });
} catch (e) { noRngErr = e.message; }
t('throws rather than seal with no CSPRNG', noRngErr === 'SEALED_BOX_NO_CSPRNG', String(noRngErr));

console.log('\n-- refusals that keep a bad row out of the table --');
const refuses = (name, fn, want) => {
  let msg = null;
  try { fn(); } catch (e) { msg = e.message; }
  t(name, !!msg && msg.indexOf(want) === 0, String(msg));
};
refuses('a truncated family_pub is refused',
  () => SB.sealForFamily(payload, Buffer.from([1, 2, 3]).toString('base64'), 'f', 'g', { nacl }),
  'SEALED_BOX_BAD_PUB_LENGTH');
refuses('a family with no staging key cannot be sealed to',
  () => SB.sealForFamily(payload, null, 'f', 'g', { nacl }), 'SEALED_BOX_NO_FAMILY_PUB');
refuses('sealing without a family_id is refused',
  () => SB.sealForFamily(payload, V.family_pub_b64, null, 'g', { nacl }), 'SEALED_BOX_NO_FAMILY_ID');
refuses('sealing without a message id is refused',
  () => SB.sealForFamily(payload, V.family_pub_b64, 'f', null, { nacl }), 'SEALED_BOX_NO_MESSAGE_ID');

console.log('\n' + (fail ? 'FAILED ' + fail + ' of ' + (pass + fail)
                         : 'ALL ' + pass + ' assertions passed'));
process.exit(fail ? 1 : 0);
})();
