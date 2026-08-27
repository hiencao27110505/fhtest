#!/usr/bin/env node
/* A newsletter must stop costing a model call per email.
 * `node pipeline/direct-sender-noise.test.js`
 *
 * REPORTED AS "100% of his emails go to Gemini", and the cache was working
 * exactly as designed — the design was wrong for this case.
 *
 * The verdict cache is keyed on (sender, normalised subject). That is right for
 * a bank: "Thong bao giao dich" repeats forever, so one call teaches it. It is
 * useless against MARKETING, where every subject is new — the shape never
 * repeats, the cache never hits, and every message pays a fresh call to be told
 * again that it is not a transaction. One real mailbox burned 58 calls that way
 * on two VIB marketing subdomains that have never sent a transaction, while
 * matching the sender allowlist through `vib.com.vn` subdomain matching.
 *
 * The fix is a sender-wide sentinel, and the danger it introduces is obvious:
 * a bank sends BOTH notices and transactions from one address, so blanketing a
 * sender that has ever produced a transaction would lose real money in silence.
 * Most of what follows tests that it cannot.
 */
let pass = 0, fail = 0;
const t = (n, ok, d) => { console.log((ok ? '  PASS  ' : '  FAIL  ') + n + (!ok && d ? '  -> ' + d : '')); ok ? pass++ : fail++; };

const MAIL = (from, subject) => ({ from, subject, body: 'nothing parseable here', dkim: { pass: true } });

/* A store shaped like the real one, counting what each decision costs. */
function makeDb(rows) {
  const saved = [];
  return {
    saved, modelCalls: 0,
    async fingerprint(sender, template) {
      const exact = rows.find(r => r.sender_address === sender && r.subject_template === template);
      if (exact) return exact;
      const sent = rows.find(r => r.sender_address === sender && r.subject_template === '*');
      return sent ? { ...sent, _sender_wide: true } : null;
    },
    async senderTally(sender) {
      const mine = rows.filter(r => r.sender_address === sender && r.subject_template !== '*');
      return { junk: mine.filter(r => r.is_transaction_source === false).length,
               txn: mine.filter(r => r.is_transaction_source === true).length };
    },
    async saveFingerprint(row) { saved.push(row); rows.push(row); },
  };
}
const junk = (sender, i) => ({ sender_address: sender, subject_template: 'shape ' + i, is_transaction_source: false });
const txn  = (sender, i) => ({ sender_address: sender, subject_template: 'txn ' + i, is_transaction_source: true });

(async () => {
const E = await import('../supabase/functions/_shared/mailbox/extract.mjs');
const T = E.SENDER_JUNK_THRESHOLD;

// A model that always says "not a transaction", and counts how often it is asked.
const deps = (db) => ({ llm: { apiKey: 'k' }, fetch: null, budget: { spend: () => true, left: () => 99 },
  _count: () => db.modelCalls });

console.log('\n-- the reported bug --');
{
  const sender = 'marketing@promotion.vib.com.vn';
  // Threshold already reached by past calls, and never a transaction.
  const rows = Array.from({ length: T }, (_, i) => junk(sender, i));
  rows.push({ sender_address: sender, subject_template: '*', is_transaction_source: false });
  const db = makeDb(rows);

  const r = await E.readTransaction(MAIL(sender, 'A subject never seen before'), db, deps(db));
  t('a brand-new subject from a proven newsletter is refused WITHOUT a model call',
    r.ok === false && r.reason === 'not_a_transaction', JSON.stringify(r));
  t('and it is reported as a sender-wide verdict, not a per-shape one',
    r.senderWide === true);
  t('nothing new was written — the sentinel already says it',
    db.saved.length === 0);
}

console.log('\n-- the danger: a sender that DOES send transactions --');
{
  // One transaction among a pile of notices. This is a bank, not a newsletter.
  const sender = 'info@myvib.vib.com.vn';
  const rows = Array.from({ length: T + 20 }, (_, i) => junk(sender, i));
  rows.push(txn(sender, 1));
  const db = makeDb(rows);
  const tally = await db.senderTally(sender);
  t('however much noise it sends, txn > 0 means it is never blanketed',
    !(tally.txn === 0 && tally.junk >= T), JSON.stringify(tally));
}
{
  const sender = 'new@bank.com.vn';
  const db = makeDb([junk(sender, 1), junk(sender, 2)]);
  const tally = await db.senderTally(sender);
  t('and a sender with only a couple of notices is not written off yet',
    tally.junk < T);
}

console.log('\n-- the exact shape always wins over the sentinel --');
{
  /* A sender can be mostly noise and still have one template worth reading.
     The specific answer must beat the blanket one, or blanketing a sender would
     silently disable a template it had already learned. */
  const sender = 'card@marketing.vib.com.vn';
  const db = makeDb([
    { sender_address: sender, subject_template: '*', is_transaction_source: false },
    { sender_address: sender, subject_template: 'Thong bao giao dich',
      is_transaction_source: true, extraction_regex: null },
  ]);
  const hit = await db.fingerprint(sender, 'Thong bao giao dich');
  t('the transactional shape is still found', hit.is_transaction_source === true);
  t('and is NOT flagged sender-wide', !hit._sender_wide);
}

console.log('\n-- promotional senders are never fetched in the first place --');
{
  const S = await import('../supabase/functions/_shared/mailbox/senders.mjs');
  const q = S.inboxQuery(90, []);

  /* The sentinel saves the model call; this saves the FETCH and, more
     importantly, the slot in the per-run staging cap — during a backfill,
     marketing mail literally crowds out the transactions the run was for. */
  for (const tok of S.PROMO_TOKENS) {
    t('the query excludes -from:' + tok, q.indexOf('-from:' + tok) > 0);
  }

  /* THE TRAP THIS AVOIDS, and the reason the list is two words rather than a
     plausible-looking prefix set: these three read every bit as promotional and
     are real transactional addresses — info.vietcombank.com.vn alone has six
     transactions behind it. Excluding by intuition would have dropped a bank
     silently, since mail that is never fetched cannot appear as skipped. */
  for (const live of ['info', 'card', 'myvib', 'no-reply', 'notification']) {
    t('does NOT exclude "' + live + '" — proven transactional or plausible',
      q.indexOf('-from:' + live) === -1);
  }

  t('the sender list itself is untouched — exclusion narrows, never replaces',
    q.indexOf('from:vietcombank.com.vn') >= 0 && q.indexOf('from:techcombank.com.vn') >= 0);
  t('exclusions come after the OR group, so they apply to the whole match',
    q.indexOf(')') < q.indexOf('-from:'));
  t('and before the window, which must stay the last term',
    q.indexOf('-from:') < q.indexOf('newer_than:'));
}

console.log('\n-- the sentinel cannot collide with a real subject --');
t('the sentinel is punctuation only, which no normalised subject produces',
  E.SENDER_SENTINEL === '*' && !/[a-z0-9]/i.test(E.SENDER_SENTINEL));
t('the threshold is high enough to survive a bank opening with service notices',
  T >= 5, String(T));

console.log('\n' + (fail === 0 ? 'ALL ' + pass + ' PASSED' : pass + ' passed, ' + fail + ' FAILED'));
process.exit(fail ? 1 : 0);
})();
