// Proves pipeline/lib/sealed-box.js (Node seal, direct-read path) speaks the
// SAME envelope as the other two implementations, by running it against the
// published vector from AGENT_SYNC 2026-08-09 — the identical bytes the Apps
// Script seal side and the browser open side are both pinned to.
//
// Three implementations, one format, one vector. If this fails, a real family
// gets "unreadable" rows on the review screen.
//
// Run: node pipeline/sealed-box-node.test.js

const nacl = require('tweetnacl');
const sb = require('./lib/sealed-box.js');

let pass = 0, fail = 0;
const t = (n, ok, d) => { console.log((ok ? '  PASS  ' : '  FAIL  ') + n + (!ok && d ? '  -> ' + d : '')); ok ? pass++ : fail++; };
const throws = (fn, want) => {
  try { fn(); return false; } catch (e) { return want ? String(e.message).indexOf(want) === 0 : true; }
};

// ── the published vector, verbatim ──────────────────────────────────────────
const V = {
  family_secret_b64: 'AQIDBAUGBwgJCgsMDQ4PEBESExQVFhcYGRobHB0eHyA=',
  family_pub_b64:    'B6N8vBQgk8i3VdwbEOhstCY3StFqqFPtC9/AsrhtHHw=',
  sealed:  '8zalVBFRZSuGypawcdYxLBNurbCzx/nPOaIWwhf4I4b7ukoHaXIoUGY9vH9YPqN8lEDmqhUSTwasIqpIwI4stCsO51+YLVvNRVBsK2ennytoipHWreDjT3CPc0zGgNbMvoZz8F7ZRqiQQSmczmqWXOmn5SNnDELeDUE1fYtiQ45anbh4zEoSTD7SeQAOXTrYXo6IkuQ36pqy+MmLHKEHkNMZI/s1661tsNM=',
  eph_pub: 'A4lq9OBb6ZGenQBoYA1dm5AlpNVrDlUvMaFkfNRozC8=',
  nonce:   'Ef1W6Bh5VrWw5kvQdK31RCwAHyAb23pA',
  enc_v: 1,
};
const familyPriv = new Uint8Array(Buffer.from(V.family_secret_b64, 'base64'));
const vectorRow = Object.assign({}, V, { family_id: 'fam-test-0001', gmail_message_id: 'gmail-test-0001' });

console.log('\n-- reads the published vector (same bytes as the other two sides) --');
{
  let got = null;
  try { got = sb.openSealedRow(vectorRow, familyPriv); } catch (e) { got = 'THREW: ' + e.message; }
  t('opens', got && typeof got === 'object', String(got));
  t('amount == 2000', got && got.amount === 2000);
  t('currency == VND', got && got.currency === 'VND');
  t('counterparty exact', got && got.counterparty === 'NGUYEN THU TRANG - 0944684991', got && got.counterparty);
  t('bound family_id', got && got.family_id === 'fam-test-0001');
  t('bound gmail_message_id', got && got.gmail_message_id === 'gmail-test-0001');
}

console.log('\n-- seals rows the browser side can open --');
{
  const payload = {
    amount: 250000, currency: 'VND', direction: 'debit',
    counterparty: 'TRAN VAN BAO 9704221234567890',
    memo: 'NGUYEN THU TRANG chuyen tien an trua',
    reference_number: 'FT26224987654321',
  };
  const out = sb.sealForFamily(payload, V.family_pub_b64, 'fam-1', 'msg-1');
  t('returns the four envelope fields', !!(out.sealed && out.eph_pub && out.nonce) && out.enc_v === 1);
  t('the ciphertext is not the plaintext', out.sealed.indexOf('TRAN VAN BAO') === -1);
  t('the memo is not readable in the envelope', out.sealed.indexOf('chuyen tien') === -1);

  const row = Object.assign({}, out, { family_id: 'fam-1', gmail_message_id: 'msg-1' });
  const back = sb.openSealedRow(row, familyPriv);
  t('round-trips the amount', back.amount === 250000);
  t('round-trips the memo — the field the reviewer needs', back.memo === payload.memo, back.memo);
  t('injects the binding even though the caller did not', back.family_id === 'fam-1' && back.gmail_message_id === 'msg-1');
  t('stamps the version', back.enc_v === 1);

  const again = sb.sealForFamily(payload, V.family_pub_b64, 'fam-1', 'msg-1');
  t('every seal uses a fresh ephemeral key + nonce', again.sealed !== out.sealed && again.eph_pub !== out.eph_pub && again.nonce !== out.nonce);
  console.log('        ^ Node CSPRNG, not the Apps Script HMAC-counter DRBG.');
}

console.log('\n-- relocation is refused (the reason ids are bound INSIDE) --');
{
  const out = sb.sealForFamily({ amount: 1 }, V.family_pub_b64, 'fam-A', 'msg-A');
  t('REFUSES a row moved to another family',
    throws(() => sb.openSealedRow(Object.assign({}, out, { family_id: 'fam-B', gmail_message_id: 'msg-A' }), familyPriv), 'staging_family_mismatch'));
  t('REFUSES a row moved onto a different message',
    throws(() => sb.openSealedRow(Object.assign({}, out, { family_id: 'fam-A', gmail_message_id: 'msg-B' }), familyPriv), 'staging_row_mismatch'));
  console.log('        ^ an operator who can UPDATE the staging table cannot');
  console.log('          re-point one family\'s ciphertext at another\'s row.');
}

console.log('-- and so is tampering --');
{
  const out = sb.sealForFamily({ amount: 1 }, V.family_pub_b64, 'fam-A', 'msg-A');
  const flip = (b64) => {
    const b = Buffer.from(b64, 'base64'); b[3] ^= 0x01; return b.toString('base64');
  };
  const row = (over) => Object.assign({}, out, { family_id: 'fam-A', gmail_message_id: 'msg-A' }, over);
  t('REFUSES a flipped ciphertext byte', throws(() => sb.openSealedRow(row({ sealed: flip(out.sealed) }), familyPriv), 'staging_open_failed'));
  t('REFUSES a swapped nonce', throws(() => sb.openSealedRow(row({ nonce: flip(out.nonce) }), familyPriv), 'staging_open_failed'));
  t('REFUSES a swapped ephemeral key', throws(() => sb.openSealedRow(row({ eph_pub: flip(out.eph_pub) }), familyPriv), 'staging_open_failed'));
  t('REFUSES the wrong family key', throws(() => sb.openSealedRow(row({}), new Uint8Array(32)), 'staging_open_failed'));
  t('REFUSES an unknown envelope version', throws(() => sb.openSealedRow(row({ enc_v: 2 }), familyPriv), 'staging_enc_version_unsupported'));
}

console.log('\n-- refuses to seal without what makes a seal safe --');
{
  t('no family public key', throws(() => sb.sealForFamily({ a: 1 }, '', 'f', 'm'), 'SEALED_BOX_NO_FAMILY_PUB'));
  t('no family id (nothing to bind to)', throws(() => sb.sealForFamily({ a: 1 }, V.family_pub_b64, '', 'm'), 'SEALED_BOX_NO_FAMILY_ID'));
  t('no message id (nothing to bind to)', throws(() => sb.sealForFamily({ a: 1 }, V.family_pub_b64, 'f', ''), 'SEALED_BOX_NO_MESSAGE_ID'));
  t('a wrong-length public key', throws(() => sb.sealForFamily({ a: 1 }, Buffer.from('short').toString('base64'), 'f', 'm'), 'SEALED_BOX_BAD_PUB_LENGTH'));
}

console.log('\n-- key pinning (defense 1) --');
{
  const fp = sb.fingerprintFamilyPub(V.family_pub_b64);
  t('first sight returns a fingerprint to store', sb.assertFamilyPubPinned(V.family_pub_b64, null) === fp);
  t('a matching pin passes', sb.assertFamilyPubPinned(V.family_pub_b64, fp) === fp);

  const otherPub = Buffer.from(nacl.box.keyPair().publicKey).toString('base64');
  t('a SWAPPED family key refuses to seal', throws(() => sb.assertFamilyPubPinned(otherPub, fp), 'SEALED_BOX_PIN_MISMATCH'));
  console.log('        ^ refusing costs one retry cycle; sealing to a swapped key');
  console.log('          hands every new row to whoever swapped it, permanently.');
}

console.log('\n' + (fail === 0 ? 'ALL ' + pass + ' PASSED' : pass + ' passed, ' + fail + ' FAILED'));
process.exit(fail ? 1 : 0);
