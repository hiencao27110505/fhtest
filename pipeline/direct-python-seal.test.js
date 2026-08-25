#!/usr/bin/env node
/* A row sealed in PYTHON must open with the client code the app ships.
 * `node pipeline/direct-python-seal.test.js`
 *
 * There are now three implementations of this envelope:
 *
 *   pipeline/sealed-box.gs                       Apps Script, forwarding
 *   supabase/functions/_shared/mailbox/…mjs      JavaScript
 *   earthy/…/transaction-parser/sealing.py       Python, direct read
 *
 * and exactly ONE opener, on the client. Two of those are ours and are already
 * pinned against each other. The Python one is new, lives in the backend team's
 * pipeline, and is written in a different language with a different crypto
 * library — which is precisely the pair most likely to drift and least likely
 * to be noticed drifting.
 *
 * The failure is not an exception. The row inserts, the queue renders, and the
 * person sees "không mở được" against a transaction they cannot recover. So
 * this seals with the real Python module and opens with
 * pipeline/client-reference-staging-keys.js — byte-for-byte the code folded
 * into src/js-data/18-staging-keys.js, and itself vector-tested.
 *
 * REQUIRES python3 with PyNaCl. If that is missing this FAILS rather than
 * skipping: a green tick over a check that did not run is the exact shape of
 * bug this repo's test runner was written to kill.
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const nacl = require('tweetnacl');
const { spawnSync } = require('child_process');

global.nacl = nacl;
global.atob = b64 => Buffer.from(b64, 'base64').toString('binary');
global.btoa = s => Buffer.from(s, 'binary').toString('base64');
global.TextDecoder = require('util').TextDecoder;
global.window = {};
eval(fs.readFileSync(path.join(__dirname, 'client-reference-staging-keys.js'), 'utf8'));
const clientOpen = window.fhStagingOpenRow;

let pass = 0, fail = 0;
const t = (n, ok, d) => { console.log((ok ? '  PASS  ' : '  FAIL  ') + n + (!ok && d ? '  -> ' + d : '')); ok ? pass++ : fail++; };

const SEALER_DIR = path.join(__dirname, '..', 'earthy', 'serverless', 'functions', 'transaction-parser');

/* Drives the real module in a subprocess: generates a family keypair, seals a
   payload, and hands back the envelope plus the private half so this side can
   open it. Nothing is reimplemented here — the point is to exercise the file
   that will actually run on GCP. */
function sealInPython(payload, familyId, messageId) {
  const script = `
import sys, json, base64
sys.path.insert(0, ${JSON.stringify(SEALER_DIR)})
from nacl.public import PrivateKey
import sealing

fam = PrivateKey.generate()
env = sealing.seal_for_family(
    json.loads(sys.argv[1]), base64.b64encode(bytes(fam.public_key)).decode(),
    sys.argv[2], sys.argv[3])
print(json.dumps({"env": env, "secret": base64.b64encode(bytes(fam)).decode()}))
`;
  const res = spawnSync('python3', ['-c', script, JSON.stringify(payload), familyId, messageId],
    { encoding: 'utf8' });
  if (res.status !== 0) {
    console.error('\n  python3 could not run the sealer.');
    console.error('  ' + String(res.stderr || res.error || '').trim().split('\n').slice(-3).join('\n  '));
    console.error('\n  If PyNaCl is missing:  pip install pynacl\n');
    process.exit(1);
  }
  return JSON.parse(res.stdout);
}

// A real Vietnamese bank reading, with the diacritics that a naive encode or a
// wrong content type would mangle into something the reviewer cannot read.
const PAYLOAD = {
  amount: 165000,
  currency: 'VND',
  direction: 'debit',
  counterparty: 'HIGHLANDS COFFEE',
  reference_number: 'FT26234000123',
  transaction_type: 'bank_txn',
  raw_extracted: {
    memo: 'cà phê sáng thứ 6',
    counterparty: 'HIGHLANDS COFFEE',
    balance: 4210000,
    account_masked: '0123456789',
    occurred_at: '2026-08-24T10:15:00+07:00',
    category_hint: 'ăn uống',
    _transport: 'earthy_direct',
  },
};

console.log('\n-- python seals, the shipped client opens --');
const { env, secret } = sealInPython(PAYLOAD, 'fam-1', 'msg-1');
const familyPriv = new Uint8Array(Buffer.from(secret, 'base64'));
const row = { ...env, family_id: 'fam-1', gmail_message_id: 'msg-1' };

t('the envelope has all four columns',
  !!(env.sealed && env.eph_pub && env.nonce) && env.enc_v === 1, JSON.stringify(Object.keys(env)));
t('eph_pub is 32 bytes', Buffer.from(env.eph_pub, 'base64').length === 32);
t('nonce is 24 bytes', Buffer.from(env.nonce, 'base64').length === 24);
/* PyNaCl's encrypt() returns nonce+ciphertext CONCATENATED. Handing that whole
   value over as `sealed` is the easy mistake: the nonce then travels twice, the
   opener feeds the wrong bytes to the cipher, and every row fails to open. So
   the check is direct — the ciphertext must not begin with the nonce. */
t('the nonce is NOT also prepended to the ciphertext',
  !Buffer.from(env.sealed, 'base64')
     .subarray(0, 24).equals(Buffer.from(env.nonce, 'base64')));

let opened = null, err = null;
try { opened = clientOpen(row, familyPriv); } catch (e) { err = e.message; }
t('THE CLIENT OPENS A PYTHON-SEALED ROW', !!opened, err || 'no result');

t('amount survives', !!opened && opened.amount === 165000, String(opened && opened.amount));
t('direction survives', !!opened && opened.direction === 'debit');
t('counterparty survives', !!opened && opened.counterparty === 'HIGHLANDS COFFEE');
t('the nested raw_extracted survives', !!opened && opened.raw_extracted.balance === 4210000);
// The reason UTF-8 is called out: a memo is the only field carrying WHY money
// moved, and it is the field most likely to be Vietnamese.
t('Vietnamese diacritics survive intact',
  !!opened && opened.raw_extracted.memo === 'cà phê sáng thứ 6',
  JSON.stringify(opened && opened.raw_extracted.memo));
t('and in the category hint too',
  !!opened && opened.raw_extracted.category_hint === 'ăn uống');

console.log('\n-- the binding the sealer injects, not the caller --');
t('family_id is inside the box', !!opened && opened.family_id === 'fam-1');
t('gmail_message_id is inside the box', !!opened && opened.gmail_message_id === 'msg-1');
t('and the caller never set them', PAYLOAD.family_id === undefined && PAYLOAD.gmail_message_id === undefined);

const rejects = (name, mutate, want) => {
  try { clientOpen(mutate({ ...row }), familyPriv); t(name, false, 'did not throw'); }
  catch (e) { t(name, e.message.indexOf(want) === 0, 'got: ' + e.message); }
};
rejects('a row moved to another family is rejected',
  r => ({ ...r, family_id: 'fam-2' }), 'staging_identity_mismatch');
rejects('a row moved to another message is rejected',
  r => ({ ...r, gmail_message_id: 'msg-2' }), 'staging_identity_mismatch');
rejects('a tampered box is rejected by Poly1305', r => {
  const b = Buffer.from(r.sealed, 'base64'); b[5] ^= 0xff;
  return { ...r, sealed: b.toString('base64') };
}, 'staging_open_failed');

console.log('\n-- freshness --');
const second = sealInPython(PAYLOAD, 'fam-1', 'msg-1');
t('a second seal uses a different ephemeral key', second.env.eph_pub !== env.eph_pub);
t('a second seal uses a different nonce', second.env.nonce !== env.nonce);

console.log('\n-- and it refuses rather than half-sealing --');
const refuses = (name, args, want) => {
  const script = `
import sys, json
sys.path.insert(0, ${JSON.stringify(SEALER_DIR)})
import sealing
try:
    sealing.seal_for_family({"amount": 1}, *json.loads(sys.argv[1]))
    print("NO_RAISE")
except sealing.CannotSeal as e:
    print("CannotSeal")
except Exception as e:
    print(type(e).__name__)
`;
  const res = spawnSync('python3', ['-c', script, JSON.stringify(args)], { encoding: 'utf8' });
  t(name, res.stdout.trim() === want, res.stdout.trim() + ' ' + (res.stderr || '').slice(0, 120));
};
// Every one of these is a row that must not be written. A None return would
// make the caller responsible for remembering that; an exception does not.
refuses('a family with no staging key', ['', 'fam', 'msg'], 'CannotSeal');
refuses('a staging key that is not base64', ['not base64!!', 'fam', 'msg'], 'CannotSeal');
refuses('a staging key of the wrong length', ['YWJj', 'fam', 'msg'], 'CannotSeal');
refuses('no family_id to bind', ['AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=', '', 'msg'], 'CannotSeal');
refuses('no message id to bind', ['AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=', 'fam', ''], 'CannotSeal');

console.log('\n' + (fail ? 'FAILED ' + fail + ' of ' + (pass + fail)
                         : 'ALL ' + pass + ' assertions passed'));
process.exit(fail ? 1 : 0);
