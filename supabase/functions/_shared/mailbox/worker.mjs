/**
 * One poll: from a grant to a sealed row in the review queue.
 *
 * Pure orchestration. Every dependency — the database, `fetch`, the clock, the
 * crypto library — arrives as an argument, so the whole flow runs in a test with
 * a fake Google, a real bank email, real encryption, and the actual client
 * opener reading the result back.
 *
 * THE ORDER OF THE LAST TWO STEPS IS THE WHOLE DESIGN.
 *
 *   stage every message  →  then advance the cursor
 *
 * The cursor is written LAST and only when the window was handled. A crash, a
 * rate-limited model, a family that has not minted a staging key yet: all of
 * them leave `last_synced_at` where it was, so the next poll reads the same
 * window again. Advancing first would skip mail silently, and silence is this
 * pipeline's characteristic failure — there is no error page for a transaction
 * that never appeared.
 *
 * That makes re-reading normal rather than exceptional, which is why
 * `alreadyStaged` is asked once per window before anything is fetched, and why
 * `gmail_message_id` carries a UNIQUE constraint underneath it as the real
 * guard.
 */

import { resolveDestination, MailboxHold } from './identity.mjs';
import { buildStagedRow } from './stage.mjs';
import { readTransaction } from './extract.mjs';
import * as senders from './senders.mjs';
import * as gmail from './gmail.mjs';
import * as mailtext from './mailtext.mjs';
import { decryptToken } from './token-crypto.mjs';

/** What build is live. The Apps Script logs its own version on every run
 *  because "which code is actually deployed" once cost hours of guessing; this
 *  worker had no equivalent, and answering that question is exactly what made
 *  the 28 Aug incident review slow. Bump on any deploy. */
export const BUILD_ID = '2026-08-29-stall';

/** How many consecutive no-progress runs before a stalled backfill is allowed
 *  to send its completion notice anyway (0101).
 *
 *  THE THRESHOLD DECIDES WHO IS TOLD, NEVER WHAT IS READ. `backfilled_at` stays
 *  null through all of this, so the worker keeps retrying the stragglers and no
 *  mail is ever abandoned — getting this number wrong costs an early
 *  notification, not a transaction.
 *
 *  Twelve, because the fast lane (0097) runs a stalled backfill once a minute
 *  and a transient model outage should not trigger it: twelve minutes of zero
 *  progress is a real problem, two minutes is a blip. On the 5-minute poll the
 *  same number is an hour, which is also the right shape — a mailbox that has
 *  staged nothing for an hour is not mid-flight. */
export const STALL_NOTIFY_AFTER = 12;

/** The FLOOR for an ordinary poll. Overlap is intentional: cheap, and it covers
 *  a mail that arrived while the previous run was mid-flight. The actual window
 *  is measured from the last successful poll — see `windowDays`. */
export const POLL_DAYS = 2;

/** A first connect reaches further. This is the product difference direct read
 *  buys over forwarding — "here is your last three months" rather than "we start
 *  from now" — and it happens exactly once per mailbox.
 *
 *  NINETY. This moved to 15 and back again on the same day, so the reasoning is
 *  worth keeping rather than the number. The case for a short window is the
 *  review queue: ninety days of a real household's bank mail arrived as 52 rows
 *  at once, every one pending and needing a decision, which reads as work rather
 *  than help. The case for a long one is that history is the whole point — the
 *  ledger is more useful the further back it goes, and the mail is sitting there
 *  either way.
 *
 *  Long won, and the queue size is the thing to fix instead: a first connect is
 *  the one moment a person expects to do some setup, and nothing is lost by
 *  showing them more of it. If the wall of rows becomes a real problem, the
 *  answer is batching or a date filter ON THE REVIEW SCREEN, not a narrower read
 *  — because unread mail is recoverable only while it is still in the mailbox,
 *  and a window that was too small is invisible afterwards.
 *
 *  Widening later is cheap either way: clearing `backfilled_at` sends the next
 *  tick back through the backfill path, and already-staged messages are skipped
 *  on `gmail_message_id`, so a re-read costs one listing and stages nothing
 *  twice. */
export const BACKFILL_DAYS = 90;

/** How far ahead of a watch's expiry we renew it.
 *
 *  A watch lasts 7 days; renewing 2 days out means each mailbox is re-registered
 *  roughly every five days and still has two days of slack if a sweep fails.
 *  Renewing on the last day would leave none. */
export const RENEW_WITHIN_SECONDS = 2 * 86400;

/** Per-run ceilings. A run has a function timeout and a model quota, and both
 *  are better spent across mailboxes than exhausted on one.
 *
 *  40 → 120 (2026-08-29). The old number was sized when a catch-up after an
 *  outage was rare; `windowDays` widens the window automatically, so the poll
 *  path does face backlogs, and capping at 40 turned one outage into three
 *  runs. At the measured cost of a cache-hit row (~24ms) and 20 fetch lanes,
 *  120 costs about eight seconds. */
export const MAX_MESSAGES_PER_GRANT = 120;

/** The model-call ceiling, now PER GRANT rather than per run (2026-08-29).
 *
 *  It was one pool of 10 shared by every mailbox in a run, which produced the
 *  exact outcome the comment above set out to prevent: with grants running
 *  concurrently, whichever reached the model first drained the pool and the
 *  others got nothing. A per-grant budget is what "spent across mailboxes
 *  rather than exhausted on one" actually means.
 *
 *  10 → 40 for two reasons. The free-tier quota it was sized against is not the
 *  tier in force (the key reports serviceTier "standard"), and at the measured
 *  1.54s per call, 40 calls is ~62s — comfortably inside the function timeout
 *  where 10 used barely a third of the available wall clock. This ceiling only
 *  binds when the fingerprint cache is missing; in a healthy week the whole
 *  fleet spends one or two calls a day. */
export const MAX_MODEL_CALLS_PER_GRANT = 40;

/** Kept as an alias so an older caller passing `maxModelCalls` still works. */
export const MAX_MODEL_CALLS_PER_RUN = MAX_MODEL_CALLS_PER_GRANT;

/** The staging ceiling for a FIRST read, which is a different size of problem.
 *
 *  40 was sized for a sequential fetch loop, where each message cost a full
 *  round trip in series — about 1.3 seconds, so a full run was most of a minute
 *  of pure waiting. With the fetch pooled, the same forty cost roughly a sixth
 *  of that, and the cap became the thing making a backfill slow rather than the
 *  network.
 *
 *  Raised for the backfill path only. An ordinary poll has nothing like this
 *  many messages waiting, so a larger cap there would buy nothing and would
 *  make one busy mailbox able to crowd out the others in a shared run.
 *
 *  150 → 400 (2026-08-29). A real 90-day history measured 228 messages, which
 *  at 150 was two runs and therefore two notifications; 400 makes the ordinary
 *  case one run and one notification. The ceiling that matters is the function
 *  timeout: 400 rows is ~26s of pooled fetching plus ~10s of processing, well
 *  inside it. The listing cap below is what keeps a genuinely huge mailbox from
 *  trying to do a year in one pass. */
export const BACKFILL_STAGE_MAX = 400;

/** How many ids ONE RUN may list, on any path.
 *
 *  Listing is cheap — ids only, no bodies, and `listMessageIds` stops as soon as
 *  Gmail returns no next page, so a quiet mailbox costs exactly one request
 *  whatever this is set to. Staging is the expensive half, and that is what
 *  `MAX_MESSAGES_PER_GRANT` caps.
 *
 *  Keeping the two caps separate is the point. Listing only as many as a run can
 *  stage makes "there is more" indistinguishable from "there is nothing", and a
 *  run that cannot tell the difference marks itself finished and strands the
 *  rest. Sized well above a busy household's ordinary poll. */
export const LIST_MAX_PER_RUN = 500;

/** The same cap for a FIRST read, which is a different size of problem.
 *
 *  Gmail returns newest-first and a staged message STILL MATCHES the query, so
 *  it keeps its slot in that first page forever. A window yielding more than
 *  this cap therefore leaves its oldest tail permanently unreachable — not
 *  slow, invisible: every run lists the same newest N, filters out the ones
 *  already staged, and never reaches past them.
 *
 *  Sized against the real ceiling rather than a guess: the busiest mailbox
 *  observed runs ~66 transactions a month, so a full 365-day backfill is ~800.
 *  Paging costs one API call per 100 ids, so this is 20 calls on the first run
 *  of a mailbox and none thereafter — cheap, and cheap in the one place where
 *  the alternative is silent loss. */
export const BACKFILL_LIST_MAX = 2000;

/**
 * How far back this poll should reach, measured from the last successful one.
 *
 * A FIXED window is a trap: with `newer_than:2d` hard-coded, a worker that is
 * down for three days comes back and reads the last two, and the missing day is
 * gone with nothing anywhere recording that it existed. Since `last_synced_at`
 * is only written when a window was actually handled, the gap since then is
 * exactly what still needs reading.
 *
 * Plus a day of slack, floored at POLL_DAYS, because Gmail's `newer_than` is
 * day-granular and a same-day boundary would round the oldest mail out.
 */
export function windowDays(lastSyncedAt, nowMs) {
  if (!lastSyncedAt) return POLL_DAYS;
  const since = ((nowMs || Date.now()) - new Date(lastSyncedAt).getTime()) / 86400000;
  if (!Number.isFinite(since) || since < 0) return POLL_DAYS;
  return Math.max(POLL_DAYS, Math.ceil(since) + 1);
}

/**
 * Runs every due mailbox.
 *
 * One mailbox failing never stops the others: each is caught, counted and
 * reported. A run that dies on the first bad grant would let one broken
 * connection freeze everybody else's, which is exactly the kind of coupling a
 * multi-tenant job should not have.
 */
/** How many network round trips may be in flight at once.
 *
 *  Fetching a message is pure I/O — a `messages.get` and nothing else — so the
 *  old sequential loop spent nearly all of a run waiting, one round trip at a
 *  time, at roughly 1.3 seconds each. Six at a time turns a 40-message run from
 *  ~50 seconds of waiting into ~9, and the work per message is unchanged.
 *
 *  Bounded rather than "as many as there are": Gmail rate-limits per user, and
 *  being throttled costs more than the waiting it saves.
 *
 *  6 → 20 (2026-08-29), against the documented budget rather than caution. The
 *  per-user limit is ~250 quota units per second and `messages.get` costs 5, so
 *  roughly 50 requests per second are allowed. At 1.3s per call, six lanes used
 *  ~4.6/s — nine per cent of what was on offer, while fetching was 65% of a
 *  backfill run's wall clock. Twenty lanes use ~15/s, still under a third of
 *  the limit, and cut a 228-message backfill's fetching from 49s to 15s.
 *
 *  The per-user framing matters: concurrent grants read DIFFERENT mailboxes, so
 *  they do not share this budget with each other. What they do share is this
 *  process, which is why GRANT_CONCURRENCY stays where it is. */
export const FETCH_CONCURRENCY = 20;

/** How many MAILBOXES may be worked at once.
 *
 *  Independent by construction — different tokens, different mailboxes, and the
 *  only shared state is the model budget, which is a synchronous counter and so
 *  cannot be raced in a single-threaded runtime. Kept lower than the fetch
 *  concurrency because each mailbox carries its own fetch fan-out underneath,
 *  and the product of the two is what actually hits the network. */
export const GRANT_CONCURRENCY = 3;

/** Runs `worker` over `items`, at most `limit` at a time, preserving order.
 *
 *  Deliberately not Promise.all over everything: that is what turns a large
 *  backfill into a rate-limit incident. Deliberately not a queue library
 *  either — this is eight lines and the alternative is a dependency in a file
 *  that runs on two runtimes. */
async function _pooled(items, limit, worker) {
  const out = new Array(items.length);
  let next = 0;
  const lanes = new Array(Math.min(limit, items.length)).fill(0).map(async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await worker(items[i], i);
    }
  });
  await Promise.all(lanes);
  return out;
}

export async function runAll(ctx) {
  const grants = await ctx.db.dueGrants(ctx.maxGrants);
  /* A FRESH budget per grant, not one pool shared by the run (2026-08-29).
     Shared, the first mailbox to reach the model drained it and the rest of the
     run got none — the opposite of what the ceiling is for. Minted inside the
     lane below so each mailbox gets its own. */
  let modelCalls = 0;
  /* Mailboxes run concurrently. One failing must still not stop the others —
     that was true when this was a sequential loop and is more important now, so
     every rejection is caught INSIDE the lane and turned into a result. A throw
     escaping here would abandon whatever else was in flight. */
  const results = await _pooled(grants, ctx.grantConcurrency ?? GRANT_CONCURRENCY,
    async (grant) => {
      try {
        const budget = _budget(ctx.maxModelCalls ?? MAX_MODEL_CALLS_PER_GRANT);
        const out = await runGrant(grant, { ...ctx, budget });
        modelCalls += budget.used();
        return out;
      } catch (e) {
        return {
          grantId: grant.id, email: grant.email,
          status: 'error', detail: String(e && e.message || e),
        };
      }
    });
  return { polled: grants.length, modelCalls, results, build: BUILD_ID };
}

/**
 * One mailbox.
 *
 * Returns a summary rather than throwing for the ordinary outcomes, because
 * "held" and "token rejected" are states the operator wants counted, not
 * incidents.
 */
export async function runGrant(grant, ctx) {
  const summary = {
    grantId: grant.id, email: grant.email, status: 'ok',
    fetched: 0, staged: 0, skipped: 0, unreadable: 0, held: 0, duplicates: 0, queued: 0,
  };

  // Resolved BEFORE any mail is fetched. A mailbox whose family has no staging
  // key cannot have a single row written for it, so fetching first would spend
  // Gmail calls and hand this process plaintext it has no way to store.
  let destination;
  try {
    destination = await resolveDestination(grant, ctx.db);
  } catch (e) {
    if (e instanceof MailboxHold) return { ...summary, status: 'held', reason: e.reason };
    throw e;
  }

  let token;
  try {
    const enc = ctx.fromBytea ? ctx.fromBytea(grant.refresh_token_enc) : grant.refresh_token_enc;
    token = await decryptToken(enc, ctx.tokenKey, { subtle: ctx.subtle });
  } catch (e) {
    // A credential we cannot read is not a transient failure and not something
    // the user can fix by waiting. Flagged so the app asks them to reconnect.
    await ctx.db.markNeedsReauth(grant.id);
    return { ...summary, status: 'token_unreadable' };
  }

  let access;
  try {
    access = await gmail.accessToken(token, ctx.google, ctx.fetch);
  } catch (e) {
    if (e instanceof gmail.TokenRejected) {
      await ctx.db.markNeedsReauth(grant.id);
      return { ...summary, status: 'needs_reauth' };
    }
    throw e;   // transient: no cursor write, next poll retries
  }

  const domains = await ctx.db.providerDomains();
  const backfilling = !grant.backfilled_at;
  /* The window the PERSON chose for this mailbox (0093), not a constant. Falls
     back to BACKFILL_DAYS for grants written before the column existed, which
     is what 90 meant for them. Clamped here as well as in the RPC: this is the
     value that reaches Gmail, and an invariant only one caller enforces is one
     refactor away from being gone. */
  const chosen = Number(grant.backfill_days) || BACKFILL_DAYS;
  const backfillDays = Math.min(365, Math.max(1, chosen));
  const days = backfilling ? backfillDays : windowDays(grant.last_synced_at, ctx.nowMs);
  const query = senders.inboxQuery(days, domains);

  const perRun = ctx.maxMessages ?? (backfilling ? BACKFILL_STAGE_MAX : MAX_MESSAGES_PER_GRANT);
  // The same list cap on both paths. An ordinary poll can face a backlog too:
  // `windowDays` widens after an outage, and listing only what one run can stage
  // would truncate the catch-up exactly the way a truncated backfill does.
  const ids = await gmail.listMessageIds(
    query,
    ctx.listMax ?? (backfilling ? BACKFILL_LIST_MAX : LIST_MAX_PER_RUN),
    access, ctx.fetch);
  summary.fetched = ids.length;

  // One query for the whole window. A throw here is NOT caught: if the database
  // is unreachable, concluding "not staged" would insert a second copy of every
  // transaction in the window.
  const staged = await ctx.db.alreadyStaged(ids, destination.memberId, destination.ownerUserId);
  const allFresh = ids.filter(id => !staged.has(id));
  summary.skipped = ids.length - allFresh.length;

  // The per-run ceiling applies to what is actually WORKED ON, not to what was
  // listed. Taking the cap off the list instead would end a backfill after 40
  // messages and mark it done, losing the rest of the history with nothing
  // recording that it was ever there.
  const fresh = allFresh.slice(0, perRun);
  const moreQueued = allFresh.length > fresh.length;
  summary.queued = allFresh.length - fresh.length;

  /* The fingerprint cache for this whole window, warmed in one query, filled in
     as messages arrive. Senders are only known once a message is fetched, so
     this starts empty and is topped up per chunk below — still one query per
     chunk of twenty rather than one per message. */
  const warmFingerprints = new Map();

  let hitLimit = false;

  /* FETCHED CONCURRENTLY, PROCESSED IN ORDER — and the split is the whole point.
  
     `messages.get` is pure I/O with no dependency on any other message, so
     fetching one at a time meant a run spent nearly all its wall clock waiting.
     Everything AFTER the fetch has ordering that matters: the model budget is
     spent in sequence and stops the mailbox when exhausted, dedup compares each
     row against ones already staged in this same window, and `hitLimit` must
     stop the window where it stopped rather than wherever a race left it.
  
     So the network is parallel and the decisions stay serial. A message that
     404s between list and get comes back null and is skipped exactly as before;
     a fetch that throws is captured and re-thrown in ITS OWN position, so an
     error still stops the window at the right place instead of surfacing early
     and stranding messages behind it. */
  const lanes = ctx.fetchConcurrency ?? FETCH_CONCURRENCY;

  /* FETCH AND PROCESS ARE INTERLEAVED, one chunk ahead (2026-08-29).
  
     They used to be two passes: fetch the entire window, then process it. That
     had two costs. The wall clock was fetch + process when it could be roughly
     max(fetch, process), and — worse — a run that stopped early had already
     paid for every download it was never going to use. A backfill capped at ten
     model calls downloaded a hundred and fifty messages to stage ten, and did it
     again on the next tick.
  
     Now the next chunk is requested BEFORE the current one is processed, so the
     network waits behind decisions instead of in front of them, and a run that
     stops early has at most one chunk in flight to waste.
  
     What did NOT change is the ordering that matters: decisions still happen
     strictly in message order, one at a time. The model budget is still spent in
     sequence, dedup still compares each row against ones already staged in this
     same window, and a fetch error is still raised in ITS OWN position rather
     than surfacing early and stranding messages behind it. */
  const _fetchChunk = (slice) => _pooled(slice, lanes, async (id) => {
    try { return { id, message: await gmail.getMessage(id, access, ctx.fetch, mailtext) }; }
    catch (e) { return { id, error: e }; }
  });

  const chunks = [];
  for (let i = 0; i < fresh.length; i += lanes) chunks.push(fresh.slice(i, i + lanes));

  let inflight = chunks.length ? _fetchChunk(chunks[0]) : null;

  for (let c = 0; c < chunks.length; c++) {
    const batch = await inflight;
    // Start the NEXT download while this batch is being decided on. The budget
    // pre-scan is meaningful here for the first time: by now the loop below has
    // actually spent some of it.
    const more = (c + 1 < chunks.length) && !(ctx.budget && ctx.budget.left && ctx.budget.left() <= 0);
    inflight = more ? _fetchChunk(chunks[c + 1]) : null;

    /* One fingerprint query for this chunk's senders, for the ones we have not
       already loaded. Twenty messages from three senders costs one round trip
       instead of twenty. */
    if (ctx.db.fingerprintsForSenders) {
      const need = [];
      for (const g of batch) {
        const from = g.message && g.message.from;
        if (!from) continue;
        const addr = String(from).match(/<([^>]+)>/);
        const a = (addr ? addr[1] : from).trim().toLowerCase();
        if (a && !warmFingerprints.has(a + '\u0000__loaded')) need.push(a);
      }
      if (need.length) {
        try {
          const got = await ctx.db.fingerprintsForSenders(need);
          for (const [k, v] of got) warmFingerprints.set(k, v);
          for (const a of need) warmFingerprints.set(a + '\u0000__loaded', true);
        } catch { /* fall back to per-message lookups */ }
      }
    }

    const fetched = batch;
    for (const got of fetched) {
    const id = got.id;
    if (got.error) throw got.error;
    const message = got.message;
    if (!message) { summary.skipped++; continue; }   // deleted between list and get

    const sender = senders.match(message.from, domains);
    if (!sender) { summary.skipped++; continue; }

    // DKIM is recorded on every row rather than enforced by default. It can
    // reject real mail — some banks legitimately sign with an ESP domain — so
    // it earns enforcement on observed verdicts rather than on principle. Under
    // this transport the stakes are higher than under forwarding: a phishing
    // mail only has to reach the user's inbox, not be forwarded to us.
    if (ctx.enforceSenderAuth && !message.dkim.pass) {
      summary.skipped++;
      await ctx.db.recordFailure({
        gmail_message_id: id, sender: message.from, subject: message.subject,
        error_reason: 'sender_auth_failed:' + message.dkim.result,
      });
      continue;
    }

    let read;
    try {
      read = await readTransaction(message, ctx.db, {
        llm: ctx.llm, fetch: ctx.fetch, budget: ctx.budget,
        fingerprints: warmFingerprints.size ? warmFingerprints : null,
      });
    } catch (e) {
      /* The model is unreachable or out of quota. The mailbox is HELD — the
         cursor stays put and this message is read again next poll.
      
         CONTINUE rather than break (2026-08-29). Holding is about the CURSOR,
         and `hitLimit` already takes care of that: `markSynced` below refuses to
         advance while it is set, so nothing is skipped either way. Breaking also
         abandoned every remaining message in the window, including the ones that
         needed no model at all — one unknown sender could strand a hundred rows
         a stored template would have read for free. Those now stage normally and
         only the model-needing ones wait for the next tick. */
      summary.held++;
      hitLimit = true;
      continue;
    }

    if (!read.ok) {
      if (read.reason === 'not_a_transaction') { summary.skipped++; continue; }
      summary.unreadable++;
      await ctx.db.recordFailure({
        gmail_message_id: id, sender: message.from, subject: message.subject,
        error_reason: read.detail || read.reason,
      });
      continue;
    }

    const row = await buildStagedRow({
      gmailMessageId: id,
      destination,
      reading: _toReading(read.extraction, message),
      sourceProvider: read.extraction.source_provider || sender.provider,
      senderKind: sender.kind,
      deps: {
        nacl: ctx.nacl, rng: ctx.rng, subtle: ctx.subtle,
        dedupKey: ctx.dedupKey, db: ctx.db,
      },
    });

    if (row.duplicate_of_id) summary.duplicates++;
    if (await ctx.db.insertStaged(row)) summary.staged++;
    else summary.skipped++;      // raced with another run; the guard held
    }
  }

  /* A prefetch we decided not to use must still be awaited, or its rejection
     surfaces as an unhandled promise after the run has already returned. */
  if (inflight) { try { await inflight; } catch { /* abandoned on purpose */ } }

  // Written last, and only when this run actually FINISHED the window: nothing
  // held, and nothing left queued. Both are the same rule seen from two angles —
  // `last_synced_at` is what `windowDays` measures from, so advancing it with
  // messages still unread shrinks the next window past them and they are gone
  // with nothing recording they were there. `backfilled_at` is the same, one
  // level up: setting it early drops a half-done backfill to an ordinary poll.
  //
  // Not advancing costs one repeated listing five minutes later, and the
  // already-staged check makes the repeat nearly free.
  if (!hitLimit && !moreQueued) {
    /* A finished backfill records WHAT IT COVERED, not just that it happened
       (0098). `backfill_days` is overwritten on every reconnect, so comparing a
       new request against it would read "90 then 2 then 90" as a widening when
       nothing had changed since the first read. This is the number the widening
       check compares against, and it is written in the same statement as
       `backfilled_at` so the two can never disagree. */
    await ctx.db.markSynced(grant.id, backfilling
      ? { backfilled_at: new Date().toISOString(), backfilled_days: backfillDays }
      : {});
  }

  /* One notification per run per mailbox, not one per transaction: a bank that
     sends five mails in a burst is one thing to look at, not five. It carries no
     amount and no merchant — the fact that something is waiting is the whole
     message, and the payload travels through a service that must not learn more.
  
     AND NOTHING AT ALL WHILE A BACKFILL IS STILL RUNNING (2026-08-29). A first
     read is the one time this pipeline stages history in bulk, and announcing
     each run of it turned "we found your last three months" into ten buzzes in
     an hour — during the exact minutes someone is deciding whether the feature
     is worth keeping. So a backfill stays silent until it FINISHES, and then
     says one thing, counting everything it staged rather than the last run's
     share. `backfilledTotal` is threaded through by the caller for that.
  
     An ordinary poll is unchanged: it has no completion moment to wait for, and
     one push for one arrival is the whole point of it. */
  /* Stall bookkeeping (0101). A backfill run that staged nothing new is the
     shape of a mailbox that cannot finish — one permanently unreadable message
     is enough to hold `hitLimit` high forever, and before this the person got
     no notification at all because a backfill only spoke when it finished.
  
     Progress clears the streak; no progress extends it. Nothing here changes
     what gets read or whether the cursor moves. */
  const backfillStalled = backfilling && summary.staged === 0 && (hitLimit || moreQueued);
  let stalledRuns = Number(grant.stalled_runs) || 0;
  if (backfilling && ctx.db.recordStall) {
    if (summary.staged > 0) {
      if (stalledRuns > 0 && ctx.db.clearStall) { await ctx.db.clearStall(grant.id); }
      stalledRuns = 0;
    } else if (backfillStalled) {
      stalledRuns += 1;
      await ctx.db.recordStall(grant.id, stalledRuns,
        grant.first_stalled_at || new Date().toISOString());
    }
  }
  summary.stalledRuns = stalledRuns;

  const finishedBackfill = backfilling && !hitLimit && !moreQueued;
  /* A backfill that has stopped making progress is allowed to speak once, so
     the person is not left with a full queue and silence. It is still NOT
     marked finished: `backfilled_at` is untouched above, the stragglers keep
     being retried, and if they ever land the normal completion notice follows.
     `>=` rather than `===` so a mailbox that was already past the threshold
     when this shipped is not skipped. */
  const stalledEnoughToSpeak = backfilling && !finishedBackfill
    && stalledRuns >= (ctx.stallNotifyAfter ?? STALL_NOTIFY_AFTER);

  let notifyCount = summary.staged;
  if ((finishedBackfill || stalledEnoughToSpeak) && ctx.db.pendingCount) {
    /* The exact number waiting, asked once. A total accumulated across runs
       would drift the first time a run died halfway; counting at the end
       cannot, and this is the only moment it is ever asked. */
    try {
      notifyCount = await ctx.db.pendingCount(destination.memberId, destination.ownerUserId)
                    || summary.staged;
    } catch { /* fall back to this run's share */ }
  }
  const shouldNotify = backfilling
    ? (finishedBackfill || stalledEnoughToSpeak)
    : summary.staged > 0;
  if (shouldNotify && notifyCount > 0 && ctx.notify) {
    try { await ctx.notify(grant, notifyCount, { backfill: finishedBackfill || stalledEnoughToSpeak }); }
    catch { /* never fails a run */ }
  }
  summary.notified = !!(shouldNotify && notifyCount > 0);

  if (hitLimit) summary.status = 'held';
  else if (moreQueued) summary.status = 'more';   // healthy, just not finished
  if (stalledRuns >= (ctx.stallNotifyAfter ?? STALL_NOTIFY_AFTER)) summary.status = 'stalled';
  return summary;
}

/**
 * The extractor's field names, mapped to the ones stage.mjs wants.
 *
 * A translation layer rather than renaming one side: the extraction shape is
 * the one the shared `sender_fingerprints` templates were derived against, and
 * the staged shape is the one the client opener reads. Neither is free to move.
 */
function _toReading(x, message) {
  return {
    amount: x.amount,
    direction: x.direction,
    currency: x.currency || 'VND',
    merchant: x.counterparty_display || x.counterparty || null,
    reference: x.reference_number || null,
    // Falling back to the mail's own date: a template that could not anchor the
    // timestamp still produced a real transaction, and a row with no date
    // cannot be deduped or shown in the right place in the ledger.
    occurredAt: x.occurred_at || _headerDate(message),
    balance: x.balance ?? null,
    // Raw and tidied are BOTH carried, exactly as the forwarding pipeline
    // carries them. tidyMemo can legitimately return an empty description (bank
    // auto-fill like "NGUYEN THU TRANG chuyen tien" says nothing), and collapsing
    // the two here would either lose that judgement or lose the original. The
    // review screen (`72-txn-review.js`) prefers `memo_display` and treats an
    // EMPTY one as the verdict it is, falling through to the counterparty rather
    // than resurrecting the raw auto-fill — which it could not do if either
    // transport had thrown a field away here.
    description: x.memo ?? null,
    descriptionDisplay: x.memo_display ?? null,
    typeCode: x.type_code || null,
    channel: x.channel || null,
    accountTail: x.account_masked || null,
    category: x.category || null,
    flow: x.flow || null,
    senderAuth: message.dkim,
  };
}

function _headerDate(message) {
  if (message.internalDate) return new Date(message.internalDate).toISOString();
  const d = message.date ? new Date(message.date) : null;
  return d && !isNaN(d.getTime()) ? d.toISOString() : null;
}

/** A run-wide ceiling on model calls, shared across every mailbox in the run. */
function _budget(max) {
  let used = 0;
  /* `left` exists so the fetch loop can stop prefetching mail this run will
     never reach. Read-only on purpose — asking how much budget remains must
     never consume any, which a spend()-and-refund would risk. */
  return { spend: () => (used < max ? (used++, true) : false), used: () => used, left: () => max - used };
}

/**
 * One Gmail push notification: read THAT mailbox, now.
 *
 * This is the whole latency story. The notification carries `{emailAddress,
 * historyId}` and no mail content, so what happens next is exactly the windowed
 * read a poll would do — same fetch, same sender filter, same seal, same insert.
 * Only the trigger is different, and the difference is minutes.
 *
 * WHAT IT RETURNS IS AN ACK DECISION, and that matters more than it looks.
 * Pub/Sub redelivers anything not acknowledged, for as long as the topic's
 * retention allows. So every outcome that will fail identically on a retry —
 * a malformed envelope, a mailbox we hold no grant for, a mailbox that is
 * held — must ACK. Only a genuinely transient failure should be left for
 * redelivery, and even then the 5-minute poll would have caught it anyway.
 *
 * A notification for a mailbox with no grant is ORDINARY, not an error: a watch
 * outlives a disconnect by up to 7 days, and during that window Gmail keeps
 * ringing a doorbell nobody is behind. Dropping it quietly is correct.
 */
export async function runPush(notification, ctx) {
  if (!notification || !notification.emailAddress) {
    return { status: 'ignored', reason: 'malformed', ack: true };
  }

  const grant = await ctx.db.grantByEmail(
    notification.emailAddress, gmail.foldAddress(notification.emailAddress));

  if (!grant) {
    // Disconnected, or awaiting re-consent (the query excludes those). Either
    // way there is nothing to read and nothing a retry would change.
    return { status: 'ignored', reason: 'no_grant', ack: true };
  }

  const summary = await runGrant(grant, {
    ...ctx,
    budget: ctx.budget || _budget(ctx.maxModelCalls ?? MAX_MODEL_CALLS_PER_RUN),
  });
  return { ...summary, ack: true };
}

/**
 * Re-registers the watches that are about to lapse.
 *
 * Runs on the same tick as the poll rather than as its own schedule: it is two
 * API calls per due mailbox, it is due for almost nobody on almost every run,
 * and a separate cron job is one more thing that can be silently not running.
 *
 * A watch that lapses takes the notifications with it and says nothing, so the
 * failure this prevents looks exactly like a quiet mailbox. The poll is what
 * keeps that from being data loss; this is what keeps it from being slow.
 */
export async function renewWatches(ctx) {
  if (!ctx.topicName) return { renewed: 0, failed: 0, skipped: 'no topic configured' };

  const due = await ctx.db.watchesDue(ctx.renewWithin ?? RENEW_WITHIN_SECONDS, ctx.maxGrants);
  let renewed = 0, failed = 0, needsReauth = 0;

  for (const grant of due) {
    try {
      const enc = ctx.fromBytea ? ctx.fromBytea(grant.refresh_token_enc) : grant.refresh_token_enc;
      const token = await decryptToken(enc, ctx.tokenKey, { subtle: ctx.subtle });
      const access = await gmail.accessToken(token, ctx.google, ctx.fetch);
      const result = await gmail.watch(ctx.topicName, access, ctx.fetch);
      await ctx.db.saveWatch(grant.id, result.expiration);
      renewed++;
    } catch (e) {
      if (e instanceof gmail.TokenRejected) {
        // Not a renewal failure: the grant itself is dead. Flagged so the app
        // asks, and so the next sweep stops spending calls on it.
        await ctx.db.markNeedsReauth(grant.id);
        needsReauth++;
      } else {
        // One mailbox failing must not stop the rest. The poll still covers it.
        failed++;
      }
    }
  }
  return { renewed, failed, needsReauth };
}
