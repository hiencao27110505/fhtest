#!/usr/bin/env node
/* Mail the person has already dealt with must not come back.
 * `node pipeline/direct-resolved-messages.test.js`
 *
 * THE FAILURE THIS PINS, which happened in production. A promotion DELETES the
 * staged row (resolve_email_transactions), and the worker's idempotency check
 * asked one question: "is this gmail_message_id in email_transactions?" After a
 * promotion the answer is no.
 *
 * That never surfaces on an ordinary poll, because the cursor has long since
 * moved past the window. It surfaces the moment anything re-reads an OLD one —
 * a widened backfill, a cleared `backfilled_at`, an outage long enough for
 * `windowDays` to reach back. Then every message already promoted is staged
 * again, and a real user's queue filled with 42 transactions that were already
 * in their ledger. Promote them a second time and the ledger double-counts,
 * with nothing downstream to catch it.
 *
 * The client's own guard cannot cover it: it remembers staged-row UUIDs, and a
 * re-staged message is a NEW row with a new UUID — and its prune drops any id
 * the server stops returning, so the memory is gone before the message returns.
 *
 * So the answer moved server-side (migration 0090). These tests drive the real
 * db.mjs against a fake REST layer, because the union of the two tables IS the
 * behaviour — a test against a hand-written fake store would pass while the
 * query it stands for was wrong.
 */
let pass = 0, fail = 0;
const t = (n, ok, d) => { console.log((ok ? '  PASS  ' : '  FAIL  ') + n + (!ok && d ? '  -> ' + d : '')); ok ? pass++ : fail++; };

const MEMBER = 'mem-1';

/* A fetch that answers the two tables from plain arrays and records the paths
   it was asked for, so the SHAPE of each query is assertable, not just the
   answer it happened to give. */
function fakeFetch(staged, resolved, opts) {
  const seen = [];
  const fn = async (url) => {
    seen.push(String(url));
    const path = String(url);
    const pick = (rows) => rows
      .filter(r => path.includes(encodeURIComponent(r.gmail_message_id)) || path.includes(r.gmail_message_id))
      .map(r => ({ gmail_message_id: r.gmail_message_id }));
    if (path.includes('/resolved_email_messages')) {
      if (opts && opts.resolvedThrows) throw new Error('resolved lookup unreachable');
      const scoped = resolved.filter(r => path.includes(r.member_id));
      return { ok: true, status: 200, text: async () => JSON.stringify(pick(scoped)) };
    }
    if (path.includes('/email_transactions')) {
      if (opts && opts.stagedThrows) throw new Error('staged lookup unreachable');
      return { ok: true, status: 200, text: async () => JSON.stringify(pick(staged)) };
    }
    return { ok: true, status: 200, text: async () => '[]' };
  };
  fn.seen = seen;
  return fn;
}

(async () => {
const { createDb } = await import('../supabase/functions/_shared/mailbox/db.mjs');
const mk = (staged, resolved, opts) => {
  const f = fakeFetch(staged, resolved, opts);
  return { db: createDb('https://x.supabase.co', 'service-key', f), seen: f.seen };
};

console.log('\n-- the bug: a promoted message must stay gone --');
{
  // 'promoted' is in NEITHER staged table — that is exactly the state after a
  // promotion — and only resolved_email_messages remembers it.
  const { db } = mk([{ gmail_message_id: 'still-pending' }],
                    [{ member_id: MEMBER, gmail_message_id: 'promoted' }]);
  const done = await db.alreadyStaged(['still-pending', 'promoted', 'brand-new'], MEMBER);

  t('a message still in the queue counts as done', done.has('still-pending'));
  t('a PROMOTED message counts as done, though its row was deleted',
    done.has('promoted'), 'this is the 42-duplicate bug');
  t('a genuinely new message does not', !done.has('brand-new'));
  t('exactly two of the three', done.size === 2, String(done.size));
}

console.log('\n-- both tables are actually consulted --');
{
  const { db, seen } = mk([], [{ member_id: MEMBER, gmail_message_id: 'x' }]);
  await db.alreadyStaged(['x'], MEMBER);
  t('email_transactions is queried', seen.some(u => u.includes('/email_transactions')));
  t('resolved_email_messages is queried', seen.some(u => u.includes('/resolved_email_messages')));
  t('the resolved lookup is SCOPED to the member',
    seen.some(u => u.includes('/resolved_email_messages') && u.includes('member_id=eq.' + MEMBER)),
    seen.join(' | '));
}

console.log('\n-- one person finishing says nothing about another --');
{
  // The same shared mailbox connected by two members. Theirs must not hide mine.
  const { db } = mk([], [{ member_id: 'someone-else', gmail_message_id: 'theirs' }]);
  const done = await db.alreadyStaged(['theirs'], MEMBER);
  t('another member’s resolution does not hide my mail', !done.has('theirs'));
}

console.log('\n-- degrading safely --');
{
  // No member to scope by: ask the half that is safe rather than an unscoped
  // question whose answer could hide someone else's mail.
  const { db, seen } = mk([{ gmail_message_id: 'a' }], [{ member_id: MEMBER, gmail_message_id: 'b' }]);
  const done = await db.alreadyStaged(['a', 'b'], undefined);
  t('with no member, the staged half still answers', done.has('a'));
  t('and the resolved half is skipped rather than asked unscoped',
    !done.has('b') && !seen.some(u => u.includes('/resolved_email_messages')));
}
{
  // Failing OPEN here stages the whole window twice. It must throw.
  const { db } = mk([], [], { resolvedThrows: true });
  let threw = false;
  try { await db.alreadyStaged(['a'], MEMBER); } catch (e) { threw = true; }
  t('a broken resolved lookup THROWS rather than reporting nothing is done', threw);
}
{
  const { db } = mk([], [], { stagedThrows: true });
  let threw = false;
  try { await db.alreadyStaged(['a'], MEMBER); } catch (e) { threw = true; }
  t('a broken staged lookup throws too', threw);
}

console.log('\n-- the trivial case is not a query --');
{
  const { db, seen } = mk([], []);
  const done = await db.alreadyStaged([], MEMBER);
  t('an empty window asks nothing and answers nothing', done.size === 0 && seen.length === 0);
}

console.log('\n' + (fail === 0 ? 'ALL ' + pass + ' PASSED' : pass + ' passed, ' + fail + ' FAILED'));
process.exit(fail ? 1 : 0);
})();
