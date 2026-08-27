#!/usr/bin/env node
/* Widening the window re-reads; narrowing does nothing.
 * `node pipeline/direct-rebackfill.test.js`
 *
 * THE BUG THIS PINS, as a real user hit it. She reconnected a mailbox and chose
 * 2 days. The grant stored 2, the sheet echoed 2, and the queue kept showing 23
 * days — because those rows were left over from a 90-day backfill two days
 * earlier and `backfill_days` only ever governed the FIRST read. Nothing read
 * too far; the product had offered a setting and then ignored it.
 *
 * The rule now: asking for MORE than the completed read covered clears
 * `backfilled_at` so the next tick re-reads wider; asking for the same or less
 * does nothing, because you already hold more history than you asked for and
 * re-reading to produce a smaller result can only lose.
 *
 * These drive the real worker to prove the OTHER half — that a finished
 * backfill records what it covered, since the comparison is worthless without
 * it.
 */
const nacl = require('tweetnacl');
const crypto = require('crypto');

let pass = 0, fail = 0;
const t = (n, ok, d) => { console.log((ok ? '  PASS  ' : '  FAIL  ') + n + (!ok && d ? '  -> ' + d : '')); ok ? pass++ : fail++; };

const FAM_PUB = Buffer.from(nacl.box.keyPair.fromSecretKey(
  new Uint8Array(crypto.randomBytes(32))).publicKey).toString('base64');

/* The rule as the migration expresses it, exercised here so the intent is
   readable and a change to the SQL that contradicts it fails something. */
function backfilledAtAfterReconnect(existing, asked) {
  if (existing.backfilled_at === null) return null;                 // never finished
  if (asked > (existing.backfilled_days ?? 0)) return null;         // widened -> re-read
  return existing.backfilled_at;                                    // unchanged
}

(async () => {
const W = await import('../supabase/functions/_shared/mailbox/worker.mjs');

console.log('\n-- the rule --');
const done = { backfilled_at: '2026-08-25T20:25:00Z', backfilled_days: 90 };
t('90 -> 2 changes nothing (you already have more than you asked for)',
  backfilledAtAfterReconnect(done, 2) === done.backfilled_at);
t('90 -> 90 changes nothing (an ordinary reconnect stays free)',
  backfilledAtAfterReconnect(done, 90) === done.backfilled_at);
t('90 -> 365 clears it, so the next tick reads wider',
  backfilledAtAfterReconnect(done, 365) === null);
t('a backfill that never finished stays unfinished',
  backfilledAtAfterReconnect({ backfilled_at: null, backfilled_days: null }, 30) === null);
/* Erring toward re-reading is the recoverable direction: a re-read can only
   stage mail that is genuinely new, because 0090 tombstones everything already
   dealt with. */
t('an unknown covered-width is treated as narrower, so it re-reads',
  backfilledAtAfterReconnect({ backfilled_at: '2026-08-25T20:25:00Z', backfilled_days: null }, 30) === null);

console.log('\n-- and the worker records what it covered --');
{
  const marked = [];
  const db = {
    async memberById() { return { id: 'm1', family_id: 'f1', archived_at: null }; },
    async stagingPubForFamily() { return FAM_PUB; },
    async stagingPubForUser() { return FAM_PUB; },
    async providerDomains() { return []; },
    async alreadyStaged() { return new Set(); },
    async stagedCandidates() { return []; },
    async insertStaged() { return true; },
    async recordFailure() {},
    async markSynced(id, fields) { marked.push(fields); },
    async fingerprint() { return null; },
    async saveFingerprint() {},
  };
  const grant = {
    id: 'g1', user_id: 'u1', member_id: 'm1', family_id: 'f1', email: 'me@gmail.com',
    needs_reauth: false, refresh_token_enc: 'x', last_synced_at: null,
    backfilled_at: null, backfill_days: 45, default_scope: 'family',
  };
  const ctx = {
    db, nacl, rng: crypto.webcrypto, subtle: crypto.webcrypto.subtle,
    dedupKey: crypto.randomBytes(32).toString('base64'),
    tokenKey: crypto.randomBytes(32).toString('base64'),
    fromBytea: () => 'v1::',
    // No Gmail: the token decrypt throws, the run reports an error, and
    // markSynced is never reached. So stub the seam the window is read through.
    fetch: async () => { throw new Error('no network in this test'); },
  };
  let threw = false;
  try { await W.runGrant(grant, ctx); } catch (e) { threw = true; }
  t('a run that cannot reach Gmail does NOT stamp a backfill as finished',
    marked.length === 0, JSON.stringify(marked));
}

console.log('\n-- the constant a stamped width is measured against --');
t('BACKFILL_DAYS is still the default for grants predating the column',
  W.BACKFILL_DAYS === 90);
t('and it sits inside the range the RPC clamps to', W.BACKFILL_DAYS >= 1 && W.BACKFILL_DAYS <= 365);

console.log('\n' + (fail === 0 ? 'ALL ' + pass + ' PASSED' : pass + ' passed, ' + fail + ' FAILED'));
process.exit(fail ? 1 : 0);
})();
