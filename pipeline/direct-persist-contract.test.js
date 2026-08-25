#!/usr/bin/env node
/* The wire between the two repos, driven from both ends at once.
 * `node pipeline/direct-persist-contract.test.js`
 *
 * earthy's persist.py builds a JSON payload; our runIngest validates it, seals
 * it, stages it; the app's opener reads it back. Three languages, one contract,
 * and nothing else checks it WHOLE: test_persist.py pins what leaves Python,
 * direct-ingest.test.js pins what our side accepts, and a rename on either side
 * would keep both green while the wire between them went dead.
 *
 * So this test runs the REAL persist.build_payload in a python3 subprocess and
 * feeds its literal output — bytes off the wire — into the REAL runIngest with
 * real X25519, then opens the staged row with the client code the app ships.
 *
 * REQUIRES python3 (stdlib only — persist.py imports nothing else, and the
 * Reading is duck-typed with SimpleNamespace so pydantic is not needed here).
 * If python3 is missing this FAILS rather than skipping: a green tick over a
 * check that did not run is the bug the test runner was written to kill.
 */
const { execFileSync } = require('child_process');
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

const FAMILY_SECRET = new Uint8Array(crypto.randomBytes(32));
const FAMILY_PUB = Buffer.from(nacl.box.keyPair.fromSecretKey(FAMILY_SECRET).publicKey).toString('base64');
const DEDUP_KEY = crypto.randomBytes(32).toString('base64');
const USER = 'user-1', MEMBER = 'mem-1', FAMILY = 'fam-1';

const PY = `
import datetime, json, sys, types
sys.path.insert(0, ${JSON.stringify(path.join(__dirname, '..', 'earthy', 'serverless', 'functions', 'transaction-parser'))})
import persist

EVENT = {
    "message_id": "msg-wire-1",
    "source": "techcombank",
    "subject": "Thong bao giao dich",
    "date": "Fri, 21 Aug 2026 13:15:00 +0700",
    "body": "Kinh gui Quy khach NGUYEN THU TRANG. So tien: 500.000 VND. "
            "Noi dung: NGUYEN THU TRANG chuyen tien",
    "mailbox": "alice@x.com",
    "from": "Techcombank <no-reply@techcombank.com.vn>",
    "kind": "bank",
}

# Duck-typed rather than the pydantic Reading: build_payload reads attributes,
# and this subprocess must stay stdlib-only so the contract test needs nothing
# installed. The attribute NAMES are the contract, and test_persist.py pins
# them against the real class.
reading = types.SimpleNamespace(
    amount=500000, balance=12345678, direction="debit",
    merchant="MPOS*QUICK SAVE MARKET",
    description="NGUYEN THU TRANG chuyen tien",
    occurred_at=datetime.datetime(2026, 8, 21, 13, 15, 0),
    reference="FT26234", account_tail="4412", channel="POS",
)

print(json.dumps(persist.build_payload(EVENT, reading, "an uong")))
`;

function makeDb() {
  const state = {
    staged: [], failures: [],
    members: { [MEMBER]: { id: MEMBER, family_id: FAMILY, archived_at: null } },
    grants: [{ id: 'grant-1', user_id: USER, member_id: MEMBER, family_id: FAMILY,
               provider: 'google', email: 'alice@x.com', needs_reauth: false }],
  };
  return {
    state,
    async grantByEmail(email, folded) {
      return state.grants.find(g => g.email === email)
        || (folded ? state.grants.find(g => g.email === folded) : null) || null;
    },
    async memberById(id) { return state.members[id] || null; },
    async stagingPubForFamily() { return FAMILY_PUB; },
    async providerDomains() { return []; },
    async alreadyStaged() { return new Set(); },
    async stagedCandidates() { return []; },
    async insertStaged(row) { state.staged.push(row); return true; },
    async recordFailure(row) { state.failures.push(row); },
  };
}

(async () => {
const I = await import('../supabase/functions/_shared/mailbox/ingest.mjs');

let wire;
try {
  wire = execFileSync('python3', ['-c', PY], { encoding: 'utf8' });
} catch (e) {
  console.log('\n  python3 could not run persist.build_payload.');
  console.log((e.stderr || e.message || '').split('\n').map(l => '  ' + l).join('\n'));
  console.log('\n1 FAILED, 0 passed');
  process.exit(1);
}

console.log('\n-- the bytes persist.py sends are the bytes runIngest accepts --');
const payload = JSON.parse(wire);
t('python built a payload at all', payload && typeof payload === 'object');
t('and our validator accepts it whole', I.validate(payload) === null, I.validate(payload));

const db = makeDb();
const out = await I.runIngest(payload, {
  db, nacl, subtle: crypto.webcrypto.subtle, rng: crypto.webcrypto, dedupKey: DEDUP_KEY,
});
t('staged', out && out.status === 'staged', JSON.stringify(out));
t('one sealed row', db.state.staged.length === 1);

console.log('\n-- and the app opens what Python started --');
const row = db.state.staged[0];
const opened = clientOpen({ ...row, family_id: FAMILY }, FAMILY_SECRET);
const x = opened.raw_extracted;

t('amount survives three languages intact', opened.amount === 500000);
t('direction', opened.direction === 'debit');
t('occurred_at came through the datetime -> ISO hop', row.occurred_at === '2026-08-21T13:15:00');
// His label is 'techcombank'; ours is 'Techcombank'. OURS must win — the
// provider string is what the review screen's fuzzy bank-vs-bank dedup
// compares, and it has to be spelled identically whichever transport staged
// the row. The lowercase label reaching the table would quietly split the
// provider space between the two transports.
t('the From header let OUR registry name the provider, overriding his label',
  row.source_provider === 'Techcombank' && out.senderUnknownToUs === false,
  row.source_provider);
t('a bank sender typed bank_txn', x.transaction_type === 'bank_txn');
t('the aggregator prefix came off the merchant', opened.counterparty === 'QUICK SAVE MARKET');
t('his category inference arrived as category_hint', x.category_hint === 'an uong');
t('the raw memo is kept verbatim', x.memo === 'NGUYEN THU TRANG chuyen tien');
t('and the body crossed the wire for the tidy: holder-name memo judged empty',
  x.memo_display === '', JSON.stringify(x.memo_display));
t('the balance rode inside the box', x.balance === 12345678);
t('the reference too', x.reference_number === 'FT26234');
t('the body itself was never stored',
  !JSON.stringify(row).includes('Kinh gui') && x.raw_body === undefined);
t('vietnamese text with diacritics is not in this fixture by accident: memo fields round-trip bytes',
  x.memo.length === 'NGUYEN THU TRANG chuyen tien'.length);

console.log('\n-- a sparse reading crosses too --');
{
  const PY2 = PY.replace(/reading = types[\s\S]*?\)\n/, 'reading = types.SimpleNamespace(amount=1000, balance=None, direction="credit", merchant=None, description=None, occurred_at=None, reference=None, account_tail=None, channel=None)\n')
                .replace('"an uong"', 'None');
  const sparse = JSON.parse(execFileSync('python3', ['-c', PY2], { encoding: 'utf8' }));
  t('validator accepts the all-nulls shape', I.validate(sparse) === null, I.validate(sparse));
  const db2 = makeDb();
  const out2 = await I.runIngest(sparse, {
    db: db2, nacl, subtle: crypto.webcrypto.subtle, rng: crypto.webcrypto, dedupKey: DEDUP_KEY,
  });
  t('and it stages', out2.status === 'staged', JSON.stringify(out2));
  const o2 = clientOpen({ ...db2.state.staged[0], family_id: FAMILY }, FAMILY_SECRET);
  t('credit with no trimmings opens clean', o2.amount === 1000 && o2.direction === 'credit');
}

console.log('\n' + (fail === 0 ? 'ALL ' + pass + ' PASSED' : pass + ' passed, ' + fail + ' FAILED'));
process.exit(fail ? 1 : 0);
})();
