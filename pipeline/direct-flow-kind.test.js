#!/usr/bin/env node
/* Where the money LANDS, which direction alone cannot answer.
 * `node pipeline/direct-flow-kind.test.js`
 *
 * The client now routes on this: a credit files to the income book, and a
 * mis-tagged row is no longer cosmetic — a card payment filed as income inflates
 * earnings, a salary filed as spending inflates the budget.
 *
 * THE RULE: direction is EVIDENCE, flow is JUDGEMENT, evidence wins. `direction`
 * is a fact the mail states plainly and a stored template reads with no model at
 * all; `flow` is a judgement only the model makes. So they are kept separate —
 * collapsing them would make the cheap reliable field depend on the expensive
 * fallible one — and where they disagree, direction decides.
 */
const nacl = require('tweetnacl');
const crypto = require('crypto');

let pass = 0, fail = 0;
const t = (n, ok, d) => { console.log((ok ? '  PASS  ' : '  FAIL  ') + n + (!ok && d ? '  -> ' + d : '')); ok ? pass++ : fail++; };

const FAM_SEC = new Uint8Array(crypto.randomBytes(32));
const FAM_PUB = Buffer.from(nacl.box.keyPair.fromSecretKey(FAM_SEC).publicKey).toString('base64');
const DEST = { memberId: 'm1', familyId: 'f1', ownerUserId: 'u1', stagingPub: FAM_PUB, scope: 'family' };
const DEPS = { nacl, rng: crypto.webcrypto, subtle: crypto.webcrypto.subtle,
               dedupKey: crypto.randomBytes(32).toString('base64'),
               db: { async stagedCandidates() { return []; } } };

(async () => {
const S = await import('../supabase/functions/_shared/mailbox/stage.mjs');
let seq = 0;
const flowOf = async (direction, flow) => {
  const row = await S.buildStagedRow({
    gmailMessageId: 'm' + (++seq), destination: DEST, sourceProvider: 'MB', senderKind: 'bank',
    reading: { amount: 100000, direction, flow, occurredAt: '2026-08-21T06:15:00Z' }, deps: DEPS,
  });
  return JSON.parse(Buffer.from(
    nacl.box.open(Buffer.from(row.sealed, 'base64'), Buffer.from(row.nonce, 'base64'),
                  Buffer.from(row.eph_pub, 'base64'), FAM_SEC)).toString()).raw_extracted.flow;
};

console.log('\n-- the model and the mail agree --');
t('credit + income  -> income',   await flowOf('credit', 'income') === 'income');
t('debit  + expense -> expense',  await flowOf('debit', 'expense') === 'expense');

console.log('\n-- a transfer is consistent with either direction --');
/* The same money moving between the person's own accounts: arriving in one is a
   credit, leaving the other is a debit. Both are transfers, and neither is
   spending — filing a card payment as an expense double-counts against the
   purchases already recorded on that card. */
t('credit + transfer -> transfer', await flowOf('credit', 'transfer') === 'transfer');
t('debit  + transfer -> transfer', await flowOf('debit', 'transfer') === 'transfer');

console.log('\n-- where they disagree, the MAIL wins --');
t('credit + expense is impossible -> income', await flowOf('credit', 'expense') === 'income');
t('debit  + income  is impossible -> expense', await flowOf('debit', 'income') === 'expense');

console.log('\n-- a template-parsed row has no model opinion at all --');
/* Most volume: a stored template sets direction and never sets flow. Deriving it
   here is what lets the client trust the field on every row rather than only on
   the ones a model happened to see. */
t('credit, no flow -> income',  await flowOf('credit', null) === 'income');
t('debit,  no flow -> expense', await flowOf('debit', undefined) === 'expense');
t('a nonsense flow is discarded, not stored',
  await flowOf('debit', 'refund') === 'expense');

console.log('\n' + (fail === 0 ? 'ALL ' + pass + ' PASSED' : pass + ' passed, ' + fail + ' FAILED'));
process.exit(fail ? 1 : 0);
})();
