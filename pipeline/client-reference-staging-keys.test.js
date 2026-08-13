// Verifies the client reference implementation against the PUBLISHED vector —
// the same bytes posted to AGENT_SYNC for the other session to match.
const nacl = require('tweetnacl');
const fs = require('fs');

// browser shims
global.nacl = nacl;
global.atob = b64 => Buffer.from(b64, 'base64').toString('binary');
global.btoa = s => Buffer.from(s, 'binary').toString('base64');
global.TextDecoder = require('util').TextDecoder;
global.window = {};

eval(fs.readFileSync(require('path').join(__dirname,'client-reference-staging-keys.js'), 'utf8'));

let pass = 0, fail = 0;
const t = (name, ok, d) => { console.log((ok ? '  PASS  ' : '  FAIL  ') + name + (!ok && d ? '  -> ' + d : '')); ok ? pass++ : fail++; };

// ── the published vector, verbatim from AGENT_SYNC ──────────────────────────
const V = {
  family_secret_b64: 'AQIDBAUGBwgJCgsMDQ4PEBESExQVFhcYGRobHB0eHyA=',
  family_pub_b64:    'B6N8vBQgk8i3VdwbEOhstCY3StFqqFPtC9/AsrhtHHw=',
  sealed:  '8zalVBFRZSuGypawcdYxLBNurbCzx/nPOaIWwhf4I4b7ukoHaXIoUGY9vH9YPqN8lEDmqhUSTwasIqpIwI4stCsO51+YLVvNRVBsK2ennytoipHWreDjT3CPc0zGgNbMvoZz8F7ZRqiQQSmczmqWXOmn5SNnDELeDUE1fYtiQ45anbh4zEoSTD7SeQAOXTrYXo6IkuQ36pqy+MmLHKEHkNMZI/s1661tsNM=',
  eph_pub: 'A4lq9OBb6ZGenQBoYA1dm5AlpNVrDlUvMaFkfNRozC8=',
  nonce:   'Ef1W6Bh5VrWw5kvQdK31RCwAHyAb23pA',
  enc_v: 1,
};
const familyPriv = new Uint8Array(Buffer.from(V.family_secret_b64, 'base64'));
const row = { ...V, family_id: 'fam-test-0001', gmail_message_id: 'gmail-test-0001' };

console.log('\n── opens the published vector ──');
let got = null;
try { got = window.fhStagingOpenRow(row, familyPriv); } catch (e) { got = 'THREW: ' + e.message; }
t('open() succeeds on the vector', got && typeof got === 'object', String(got));
t('amount == 2000', got && got.amount === 2000);
t('currency == VND', got && got.currency === 'VND');
t('counterparty exact', got && got.counterparty === 'NGUYEN THU TRANG - 0944684991');
t('bound family_id present', got && got.family_id === 'fam-test-0001');
t('bound gmail_message_id present', got && got.gmail_message_id === 'gmail-test-0001');

console.log('\n── the failures it must catch ──');
const expectThrow = (name, mutate, wantMsg) => {
  const bad = mutate({ ...row });
  try { window.fhStagingOpenRow(bad.row || bad, bad.priv || familyPriv); t(name, false, 'did not throw'); }
  catch (e) { t(name, e.message.indexOf(wantMsg) === 0, 'got: ' + e.message); }
};
// relocation: same ciphertext moved onto a different row
expectThrow('relocated to another gmail_message_id',
  r => ({ row: { ...r, gmail_message_id: 'gmail-OTHER' } }), 'staging_identity_mismatch');
expectThrow('relocated to another family',
  r => ({ row: { ...r, family_id: 'fam-OTHER' } }), 'staging_identity_mismatch');
// tamper
expectThrow('flipped a ciphertext byte', r => {
  const b = Buffer.from(r.sealed, 'base64'); b[10] ^= 0xff;
  return { row: { ...r, sealed: b.toString('base64') } };
}, 'staging_open_failed');
// wrong key
expectThrow('a different family cannot open it',
  r => ({ row: r, priv: nacl.box.keyPair().secretKey }), 'staging_open_failed');
// version
expectThrow('unknown envelope version refused',
  r => ({ row: { ...r, enc_v: 99 } }), 'staging_enc_version_unsupported');

console.log('\n── self-check (defense 2) ──');
window.fhKeyReady = () => true;
window.fhDecStr = async () => V.family_secret_b64;
window.sb = { rpc: async () => ({ data: { staging_pub: window.__pub, staging_priv_enc: 'x' } }) };
window.__pub = V.family_pub_b64; window.DB = { fid: 'fam-test-0001' };
(async () => {
  t('passes when the server key is genuine', await window.fhStagingVerifyServerKey() === true);
  window.__pub = Buffer.from(nacl.box.keyPair().publicKey).toString('base64'); window.fhStagingKeysForget();
  t('FAILS when the server key was swapped', await window.fhStagingVerifyServerKey() === false);

  console.log('\n' + (fail === 0 ? 'ALL ' + pass + ' PASSED' : pass + ' passed, ' + fail + ' FAILED'));
  process.exit(fail === 0 ? 0 : 1);
})();
