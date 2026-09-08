#!/usr/bin/env node
const { spawnSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const nacl = require('tweetnacl');

global.atob = b64 => Buffer.from(b64, 'base64').toString('binary');
global.btoa = s => Buffer.from(s, 'binary').toString('base64');
global.nacl = nacl;
global.TextDecoder = require('util').TextDecoder;
global.TextEncoder = require('util').TextEncoder;
global.window = {};
eval(fs.readFileSync(path.join(__dirname, 'client-reference-staging-keys.js'), 'utf8'));

const root = path.join(__dirname, '..');
const parserDir = path.join(root, 'earthy/serverless/functions/transaction-parser');
const python = path.join(root, 'earthy/serverless/.venv/bin/python');
const emitted = spawnSync(python, ['tests/contract_payload.py'], {
  cwd: parserDir, encoding: 'utf8', env: { ...process.env, PYTHONPATH: parserDir },
});
if (emitted.status !== 0) throw new Error(emitted.stderr || 'Python payload builder failed');
const payload = JSON.parse(emitted.stdout);

(async () => {
  const I = await import('../supabase/functions/_shared/mailbox/ingest.mjs');
  const S = await import('../supabase/functions/_shared/mailbox/stage.mjs');
  const familySecret = new Uint8Array(crypto.randomBytes(32));
  const stagingPub = Buffer.from(
    nacl.box.keyPair.fromSecretKey(familySecret).publicKey,
  ).toString('base64');
  const rows = [];
  const db = {
    async grantByEmail() { return { id: 'g1', user_id: 'u1', member_id: 'm1', family_id: 'f1' }; },
    async memberById() { return { id: 'm1', family_id: 'f1', archived_at: null }; },
    async stagingPubForFamily() { return stagingPub; },
    async providerDomains() { return []; },
    async alreadyStaged() { return new Set(); },
    async stagedCandidates() { return []; },
    async insertStaged(row) { rows.push(row); return true; },
    async recordFailure() {},
  };
  const out = await I.runIngest(payload, {
    db, nacl, subtle: crypto.webcrypto.subtle, rng: crypto.webcrypto,
    dedupKey: crypto.randomBytes(32).toString('base64'),
  });
  const row = rows[0];
  const opened = window.fhStagingOpenRow({ ...row, family_id: 'f1' }, familySecret);
  const leaked = S.MUST_BE_NULL_WHEN_SEALED.filter(column => row[column] != null);
  if (out.status !== 'staged' || opened.amount !== 250000 ||
      opened.raw_extracted.fx_currency !== 'USD' || opened.raw_extracted.status !== 'completed') {
    throw new Error('Python → ingest → opener contract did not preserve the reading');
  }
  if (leaked.length) throw new Error('sealed row leaked: ' + leaked.join(', '));
  console.log('PASS Python build_payload → runIngest → sealed row → client opener');
})();
