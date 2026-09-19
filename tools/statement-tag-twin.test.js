#!/usr/bin/env node
/* Skipping an already-booked STATEMENT row tags its untagged twin with the
 * statement's account. `node tools/statement-tag-twin.test.js`
 *
 * Why: email rows with no account number were booked untagged, or onto a tail-less
 * ghost account. No bulk rule can place them -- a cross-check of one real ghost
 * against the real account statement showed a mix (2026-09-19). The statement that
 * lists the same purchase can, one row at a time, and only where the tag is blank.
 * Real csvStmtTagTwin from 56, lifted by name.
 */
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'js-ui', '56-csv-import-ui.js'), 'utf8');
const j = src.indexOf('function csvStmtTagTwin(');
var csvStagedMode = true;
var calls = { ensure: [], set: [] };
var window = {
  fhStmtOfCand: (c) => c.stmt ? { id: 'S', title: 'Sao kê' } : null,
  fhStagedAcct: (c) => c.ai || null,
  fhPersonalAccountEnsure: async (ai) => { calls.ensure.push(ai); return 'acct-' + ai.tail; },
  fhPersonalSetAccount: async (id, acct) => { calls.set.push([id, acct]); return true; },
};
function csvDupTier(c){ return c._dupTier || ''; }
eval(src.slice(j, src.indexOf('\n}', j) + 2));

let pass = 0, fail = 0;
const t = (n, ok, d) => { console.log((ok ? '  PASS  ' : '  FAIL  ') + n + (!ok && d !== undefined ? '  -> ' + JSON.stringify(d) : '')); ok ? pass++ : fail++; };
const tick = () => new Promise((r) => setTimeout(r, 0));
const AI = { kind: 'deposit', provider: 'VIB', tail: '5140' };
const row = (o) => Object.assign({ stmt: true, ai: AI, _dupTier: 'sure', _dupTwinKind: 'ledger', _dupTwin: { id: 'p1', book: 'personal', acct: null } }, o);

(async () => {
  csvStmtTagTwin(row({})); await tick();
  t('a sure statement row tags its untagged personal twin with the statement\'s account', calls.set.length === 1 && calls.set[0][0] === 'p1' && calls.set[0][1] === 'acct-5140', calls.set);
  calls.set = [];
  csvStmtTagTwin(row({ _dupTwin: { id: 'p2', book: 'personal', acct: 'already' } })); await tick();
  t('a twin that already has an account is left alone: fills blanks, never overrules', calls.set.length === 0);
  csvStmtTagTwin(row({ _dupTwin: { id: 'f1', book: 'family', acct: null } })); await tick();
  t('a family-book twin is not touched', calls.set.length === 0);
  csvStmtTagTwin(row({ stmt: false })); await tick();
  t('an EMAIL row proves nothing about accounts', calls.set.length === 0);
  csvStmtTagTwin(row({ _dupTier: 'likely' })); await tick();
  t('"có thể trùng" is a guess, and a guess never writes', calls.set.length === 0);
  csvStmtTagTwin(row({ _dupTwinKind: 'queue' })); await tick();
  t('a twin in the queue is not a booked row', calls.set.length === 0);
  csvStmtTagTwin(row({ ai: null })); await tick();
  t('a statement row with no account of its own tags nothing', calls.set.length === 0);
  console.log('\n' + (fail ? fail + ' FAILED, ' : 'ALL ') + pass + ' PASSED');
  process.exit(fail ? 1 : 0);
})();
