#!/usr/bin/env node
/* How far back the first read reaches, and why it has a ceiling.
 * `node pipeline/direct-backfill-window.test.js`
 *
 * The window was a constant, and it moved 90 → 15 → 90 in one afternoon because
 * it is a judgement that is not ours: someone with years of spreadsheets wants
 * a year, someone trying the feature wants a fortnight and is annoyed when 52
 * rows land at once. It is now per-grant.
 *
 * THE CEILING IS OURS, NOT GMAIL'S, and that is the part worth pinning. Gmail's
 * `newer_than:` has no documented limit. What stops us is our own list cap plus
 * the way Gmail orders results: newest-first, and a staged message STILL
 * MATCHES the query, so it keeps its slot on that first page forever. Past the
 * cap the oldest mail is not slow to arrive — it is unreachable, because every
 * run lists the same newest N, filters out what is already staged, and never
 * looks further. That is why a backfill lists deeper than an ordinary poll.
 */
let pass = 0, fail = 0;
const t = (n, ok, d) => { console.log((ok ? '  PASS  ' : '  FAIL  ') + n + (!ok && d ? '  -> ' + d : '')); ok ? pass++ : fail++; };

(async () => {
const W = await import('../supabase/functions/_shared/mailbox/worker.mjs');
const S = await import('../supabase/functions/_shared/mailbox/senders.mjs');
const OS = await import('../supabase/functions/_shared/mailbox/oauth-state.mjs');

console.log('\n-- the query carries the days it was given --');
for (const d of [30, 60, 90, 365]) {
  t('newer_than:' + d + 'd', S.inboxQuery(d, []).indexOf('newer_than:' + d + 'd') > 0);
}
/* The restraint that stops a whole-mailbox read: senders only, never a `to:`
   term and never an unbounded query. Widening the WINDOW must not widen WHAT is
   fetched — those are different axes, and only one of them is the person's to
   choose. */
{
  const q = S.inboxQuery(30, []);
  /* The invariant is that the query is built from SENDERS and bounded by a
     window — not that nothing sits between them. Promotional exclusions were
     added after this was written, and an assertion that pinned the exact string
     failed on a change that strengthened the very restraint it guards. */
  t('the query opens with the sender group',  q.indexOf('(from:') === 0);
  t('and the window is the last term',        /newer_than:30d$/.test(q));
  t('anything between the two only NARROWS the match',
    q.slice(q.indexOf(')') + 1, q.indexOf('newer_than:')).trim()
      .split(/\s+/).filter(Boolean).every(term => term.startsWith('-')));
  t('and never carries a to: term, at any window',
    [1, 30, 365].every(d => S.inboxQuery(d, []).indexOf('to:') === -1));
}

console.log('\n-- a backfill lists DEEPER than a poll, or its tail is unreachable --');
t('the backfill cap is larger than the ordinary one',
  W.BACKFILL_LIST_MAX > W.LIST_MAX_PER_RUN,
  W.BACKFILL_LIST_MAX + ' vs ' + W.LIST_MAX_PER_RUN);
/* The busiest real mailbox runs ~66 transactions a month. A full-year backfill
   is therefore ~800, and a cap below that would strand the oldest of them with
   nothing recording they existed. */
t('and comfortably clears a year at the busiest observed rate (~66/month)',
  W.BACKFILL_LIST_MAX >= 365 / 30 * 66, String(W.BACKFILL_LIST_MAX));
/* The property, not a number (relaxed 2026-08-29 when the poll cap went 40→120
   and the backfill cap 150→400). What must hold is that a run LISTS deeper than
   it STAGES: that gap is the only thing that makes "there is more" detectable,
   and a run that cannot tell the difference marks itself finished and strands
   the rest. `MAX_MESSAGES_PER_GRANT <= 100` was a loose stand-in for that and
   would have failed on any legitimate raise; these assert the real invariant on
   both paths, with headroom so neither cap can quietly creep up to meet its
   listing cap. */
t('an ordinary poll lists deeper than it stages',
  W.MAX_MESSAGES_PER_GRANT * 3 <= W.LIST_MAX_PER_RUN,
  W.MAX_MESSAGES_PER_GRANT + ' staged vs ' + W.LIST_MAX_PER_RUN + ' listed');
t('a backfill lists deeper than it stages',
  W.BACKFILL_STAGE_MAX * 3 <= W.BACKFILL_LIST_MAX,
  W.BACKFILL_STAGE_MAX + ' staged vs ' + W.BACKFILL_LIST_MAX + ' listed');
t('and staging stays bounded per run rather than unbounded',
  W.MAX_MESSAGES_PER_GRANT <= 500 && W.BACKFILL_STAGE_MAX <= 1000,
  W.MAX_MESSAGES_PER_GRANT + ' / ' + W.BACKFILL_STAGE_MAX);

console.log('\n-- the ceiling holds wherever a value can enter --');
const SECRET = 's';
for (const [asked, want] of [[30, 30], [60, 60], [90, 90], [365, 365],
                             [5000, 365], [0, 90], [-5, 90], ['abc', 90]]) {
  const st = await OS.createState({ userId: 'u', scope: 'personal', backfillDays: asked }, SECRET);
  const back = await OS.readState(st, SECRET);
  t('state: ' + JSON.stringify(asked) + ' -> ' + want, back.backfillDays === want, String(back.backfillDays));
}
/* A state written before the field existed must mean the default rather than
   zero — zero would make the first read fetch nothing and mark itself done. */
const legacy = await OS.createState({ userId: 'u', scope: 'personal' }, SECRET);
t('a state with no window at all means the default, never zero',
  (await OS.readState(legacy, SECRET)).backfillDays === 90);

console.log('\n-- an ordinary poll is unaffected by the choice --');
t('a poll still measures from the last sync, not from the backfill window',
  W.windowDays('2026-08-25T00:00:00Z', Date.parse('2026-08-26T00:00:00Z')) === W.POLL_DAYS);
t('and still widens to cover an outage rather than skipping it',
  W.windowDays('2026-08-01T00:00:00Z', Date.parse('2026-08-26T00:00:00Z')) >= 26);

console.log('\n-- the first slice (0153): a long window opens at 45 days --');
/* first-ninety-seconds-spec §2/§2b. The decision is pure and pinned here:
   which phase a run is in, and how wide it reads. */
t('the slice is 45 days, one full monthly cycle whatever the calendar',
  W.FIRST_SLICE_DAYS === 45, String(W.FIRST_SLICE_DAYS));
{
  const fresh365 = { backfilled_at: null, first_slice_at: null };
  const p1 = W.backfillPhase(fresh365, 365);
  t('a fresh 365-day grant reads the slice first',
    p1.backfilling && p1.firstSlice && p1.days === 45, JSON.stringify(p1));
  const lit = { backfilled_at: null, first_slice_at: '2026-09-27T00:00:00Z' };
  const p2 = W.backfillPhase(lit, 365);
  t('after first light the SAME grant deepens across the whole window',
    p2.backfilling && !p2.firstSlice && p2.days === 365, JSON.stringify(p2));
  const small = { backfilled_at: null, first_slice_at: null };
  const p3 = W.backfillPhase(small, 30);
  t('a window at or under the slice is one phase, exactly as before',
    !p3.firstSlice && p3.days === 30, JSON.stringify(p3));
  const p3b = W.backfillPhase({ backfilled_at: null, first_slice_at: null }, 45);
  t('...including exactly 45', !p3b.firstSlice && p3b.days === 45, JSON.stringify(p3b));
  /* THE PRE-MIGRATION GUARD. A grant row read WITHOUT the 0153 column must
     fall back to single-phase: a caller whose projection omits it would
     otherwise see "no slice yet" forever and loop phase A for good. */
  const noCol = { backfilled_at: null };
  const p4 = W.backfillPhase(noCol, 365);
  t('a grant read without the column never enters phase A',
    !p4.firstSlice && p4.days === 365, JSON.stringify(p4));
  const done = { backfilled_at: '2026-09-27T00:00:00Z', first_slice_at: null };
  t('a finished backfill has no phase at all',
    !W.backfillPhase(done, 365).backfilling);
}

console.log('\n-- the chain (§2c): when a run hands the baton on --');
{
  const base = { backfilling: true, rateLimited: false };
  t('a capped run with a moved cursor chains',
    W.chainAfter({ ...base, cursorAdvanced: true }));
  t('a run that left a measured tail chains',
    W.chainAfter({ ...base, moreQueued: true }));
  t('first light chains straight into the deepen',
    W.chainAfter({ ...base, sliceDone: true }));
  t('Gmail saying slow down ends the chain — quota is why the lane exists',
    !W.chainAfter({ ...base, cursorAdvanced: true, rateLimited: true }));
  t('a run with no progress and no tail never chains (nothing to continue)',
    !W.chainAfter(base));
  t('an ordinary poll never chains', !W.chainAfter({ backfilling: false, cursorAdvanced: true }));
}

console.log('\n' + (fail === 0 ? 'ALL ' + pass + ' PASSED' : pass + ' passed, ' + fail + ' FAILED'));
process.exit(fail ? 1 : 0);
})();
