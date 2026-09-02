/**
 * Bank & transaction email pipeline — Google Apps Script
 * Implements Stage 0 (fetch) / Stage 1 (classify & extract) / Stage 2 (write, relabel, promote)
 * from the design in bank-email-pipeline-{schema.sql,extraction.md} and the pipeline diagram.
 *
 * Setup required before running:
 *   1. Script Properties (Project Settings > Script Properties):
 *        GEMINI_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 *      (ANTHROPIC_API_KEY + classifyAndExtractViaHaiku() left in place below, unused —
 *      swapping the model back later is a one-line change, see processOneMessage)
 *   2. Gmail labels created: txn/inbox, txn/processed, txn/parse-failed (done — see gichisreading@gmail.com)
 *   3. Time-based trigger: processEmails, every 1 minute. ONE trigger only —
 *      it also runs confirmPendingForwarding (auto-clicks Gmail's forwarding
 *      confirmation so onboarding never asks the user to). Do not add a second
 *      trigger for it: same latency, double the daily runtime quota.
 *   4. Supabase schema applied (bank-email-pipeline-schema.sql) — 0025 is live; 0026/0027 still pending
 */

// Bumped on every change that gets pasted into Apps Script. Logged on each run
// so "which code is actually live" is never again something to infer from the
// wording of an error — several hours went into that guess this session.
var PIPELINE_VERSION = '2026-09-02-graduate';  // template graduation fixes: mask-after-learn, sign/time anchor hygiene, time-first dates; paste only from origin/main

var MAX_NEW_CLASSIFICATIONS_PER_RUN = 10;
var MAX_NEW_CLASSIFICATIONS_PER_DAY = 50;
var DEDUPE_WINDOW_DAYS = 3;
// How long to keep retrying an email whose +tag matches no mailbox_connections
// row. Long enough to cover "set up forwarding, onboard the app a few days
// later"; short enough that a genuine misconfiguration surfaces.
var ROUTING_GRACE_DAYS = 14;
// Inbox retention — see sweepProcessedMail. Trash staged mail once it is this
// old: long enough that a staged row can still be read against the email it came
// from, short enough that the mailbox stops being an archive of other people's
// banking. The sweep interval exists because this tick runs 1,440 times a day.
var RETENTION_DAYS = 7;
// Parse-failed mail gets a LONGER window, not an exemption. The original sweep
// excluded txn/parse-failed outright ("the reviewable record of what went
// wrong") - which quietly made it a forever-archive again, contradicting the
// consent text's deletion promise. 90 days is long enough to debug any failure
// anyone actually intends to debug, and it is the number the consent sheet
// states, so the two must move together (consent_v bumps if this changes).
var RETENTION_FAILED_DAYS = 90;
var RETENTION_SWEEP_INTERVAL_MIN = 60;
var RETENTION_MAX_THREADS_PER_SWEEP = 50;

// Sealed staging (SEALED-STAGING-DESIGN.md §4.3). Lands switched OFF and gets
// flipped deliberately, once, after 0065+0068 are applied and sealingPreflight()
// reports every connection's family holds a staging key. While off, behavior is
// unchanged. While on, there is NO plaintext fallback anywhere in this file:
// a message that cannot be sealed is HELD for retry, never written readable.
function sealedStagingEnabled() {
  return PropertiesService.getScriptProperties().getProperty('SEALED_STAGING_ENABLED') === 'true';
}

function processEmails() {
  // ONE run at a time, enforced, not assumed. The trigger fires every minute and
  // a run with LLM calls can exceed a minute, so overlap is a matter of time.
  // Two overlapping runs are how the DRBG hands two rows the same counter —
  // same eph_priv, same nonce, keystream reuse (see sealedBoxRandomBytes) — and
  // even without sealing they race isAlreadyStaged into double LLM spend.
  // tryLock(0), not waitLock: the next tick is 60 seconds away, so waiting here
  // only stacks executions against the daily runtime budget.
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(0)) {
    Logger.log('v' + PIPELINE_VERSION + ' | previous run still holds the lock, skipping this tick');
    return;
  }
  try {
    _processEmailsLocked();
  } finally {
    lock.releaseLock();
  }
}

function _processEmailsLocked() {
  // Retention runs BEFORE the two early returns below. An inbox with nothing new
  // is exactly when the backlog still needs draining, and both of those returns
  // would skip it — "no mailboxes connected" most of all. Wrapped for the same
  // reason confirmations are: a sweep failure must never stop transactions.
  try { sweepProcessedMail(); } catch (e) { Logger.log('retention sweep failed: ' + e); }

  // Confirmations ride the same 1-minute tick rather than a second trigger.
  // Latency matters here — someone is watching a "waiting for Gmail" screen while
  // this decides whether their setup worked — and Apps Script only allows ~90
  // minutes of trigger runtime per day, so a second 1-minute trigger would eat
  // the budget that transaction processing needs. Wrapped so a confirmation
  // failure can never stop the transaction loop, which was the only reason to
  // keep them on separate triggers in the first place.
  // ONE search covering both jobs. A Gmail search is the dominant cost of an idle
  // tick, and this runs 1,440 times a day against a 90-minute daily budget — two
  // searches per tick spends roughly half that budget finding nothing. Combining
  // them means an idle tick costs one round trip instead of two.
  //
  // Finds forwarded mail by the alias it was DELIVERED to, not by a label. The
  // label approach needed a hand-made Gmail filter in the shared inbox for every
  // user — a manual step that silently drops transactions when forgotten, which
  // is exactly what happened on the first real end-to-end run. The aliases are
  // already in mailbox_connections, so the pipeline can just ask.
  //
  // deliveredto: matches the envelope recipient, so it still matches when the
  // visible To: header carries the user's own address (which is the normal shape
  // of Gmail-forwarded mail). Excluding the two terminal labels is what stops a
  // message being reprocessed, so the state machine still works — it just no
  // longer depends on anything being labelled on arrival.
  var q = buildInboxQuery();
  if (!q) { Logger.log('v' + PIPELINE_VERSION + ' | no mailboxes connected'); return; }
  var threads = GmailApp.search(q);
  // Always logged: this one line answers "is my paste live", "what did it ask
  // Gmail", and "did Gmail return anything" — the three questions that cost the
  // most time when this was silent on success.
  Logger.log('v' + PIPELINE_VERSION + ' | ' + threads.length + ' thread(s) | q=' + q);
  if (threads.length === 0) return;

  var txnThreads = [];
  for (var i = 0; i < threads.length; i++) {
    if (isForwardingConfirmationThread(threads[i])) {
      // Wrapped per-thread so one bad confirmation cannot stop the transactions
      // in the same batch — the reason these were once on separate triggers.
      try {
        var cms = threads[i].getMessages();
        for (var c = 0; c < cms.length; c++) handleForwardingConfirmation(cms[c]);
      } catch (err) {
        Logger.log('forwarding confirmation failed: ' + err);
      }
    } else {
      txnThreads.push(threads[i]);
    }
  }

  threads = txnThreads;
  if (threads.length === 0) return;

  var runCallCount = 0;

  for (var t = 0; t < threads.length; t++) {
    var messages = threads[t].getMessages();
    for (var m = 0; m < messages.length; m++) {
      try {
        runCallCount = processOneMessage(messages[m], runCallCount);
      } catch (err) {
        // Two very different failures land here, and treating them alike loses data:
        //   • Supabase unreachable/erroring — nothing to do with THIS email. Leave it
        //     labeled txn/inbox so the next run retries it. Relabelling it failed here
        //     would drop a perfectly good transaction because the database blinked
        //     (and insertParseFailure would fail too, so there'd be no record at all).
        //   • Anything else — genuinely this message's problem. Record and stop retrying.
        if (String(err).indexOf('SUPABASE_') !== -1) {
          Logger.log('Supabase unavailable, leaving ' + messages[m].getId() + ' queued: ' + err);
          continue;
        }
        try {
          insertParseFailure(messages[m], String(err));
        } catch (e2) {
          // Can't even record it — leave it queued rather than silently burning it.
          Logger.log('parse_failures write failed for ' + messages[m].getId() + ': ' + e2);
          continue;
        }
        relabelThread(threads[t], 'txn/parse-failed');
      }
    }
  }

  // One notification per member per run, after every row is safely written.
  notifyStagedReviews();
}

// A forwarding confirmation is identified by its SENDER — never by the absence
// of a label.
//
// The dispatch above used to read "labelled txn/inbox => transaction, otherwise
// => confirmation". That was safe only while the search could return exactly two
// kinds of mail. Adding `to:<alias>` introduced a THIRD kind: hand-forwarded
// transactions, which carry no label at all. They landed in the confirmation
// branch, which looked for a vf- link, found none, and dropped them — observed
// live on 2026-08-13 as "no confirmation link found in message
// 19ffaddc4d60c6da", where that id was a real VCB transaction.
function isForwardingConfirmationThread(thread) {
  var msgs = thread.getMessages();
  var want = String(FORWARDING_CONFIRM_SENDER).toLowerCase();
  for (var i = 0; i < msgs.length; i++) {
    var from = '';
    try { from = String(extractEmailAddress(String(msgs[i].getFrom() || ''))).toLowerCase(); }
    catch (e) { /* unreadable header — treat as not-a-confirmation */ }
    if (from === want) return true;
  }
  return false;
}

function processOneMessage(message, runCallCount) {
  // Route FIRST. The inbox search is coarse (everything delivered here), so this
  // is what separates a forwarded transaction from anything else that lands in
  // the shared mailbox — and doing it before extraction means unroutable mail
  // never reaches the LLM. Held rather than failed: the usual cause is that
  // mailbox onboarding has not finished yet.
  var _routedMailbox = resolveMailbox(message);
  if (!_routedMailbox) {
    var _age = (new Date().getTime() - message.getDate().getTime()) / 86400000;
    if (_age < ROUTING_GRACE_DAYS) {
      Logger.log('no known alias on ' + message.getId() + ', holding for retry');
      return runCallCount;
    }
    insertParseFailure(message, 'unroutable_after_grace: no mailbox_connections match after ' +
      ROUTING_GRACE_DAYS + ' days');
    relabelMessageThread(message, 'txn/parse-failed');
    return runCallCount;
  }

  var sender = extractEmailAddress(message.getFrom());
  var subject = message.getSubject();
  var body = message.getPlainBody();
  var gmailMessageId = message.getId();

  // Message-level idempotency. "Have I handled this?" was answered only by a
  // THREAD label, while the work is per MESSAGE — so the two disagreed whenever
  // Gmail grouped several notifications under one subject, and the only way to
  // answer "did this email land?" was to go read the database by hand.
  //
  // One cheap lookup fixes both halves. Reprocessing becomes free and safe, so a
  // thread can be relabelled to force a re-run; and a duplicate insert can no
  // longer reach unique(gmail_message_id), whose 409 the caller would otherwise
  // read as a transient SUPABASE_ error and retry forever.
  if (isAlreadyStaged(gmailMessageId)) {
    Logger.log('already staged, skipping ' + gmailMessageId);
    relabelMessageThread(message, 'txn/processed');
    return runCallCount;
  }
  var template = normalizeSubjectTemplate(subject);

  var fingerprint = findFingerprint(sender, template);
  var extraction = null;

  if (fingerprint && fingerprint.is_transaction_source === false) {
    relabelMessageThread(message, 'txn/processed');
    return runCallCount;
  }

  if (fingerprint && fingerprint.extraction_regex) {
    extraction = tryRegexExtract(fingerprint.extraction_regex, body);
    // The template carries account_kind as a static when derivation was
    // confident; when the static is absent the per-mail heuristic fills it.
    // Never overwrites a template verdict, and null stays null (spec §8.4:
    // ambiguous never invents a debt — the client defaults, a human corrects).
    if (extraction && extraction.account_kind == null) {
      extraction.account_kind = deriveAccountKind({
        bodyText: body, subject: subject,
        provider: extraction.source_provider || sender,
        accountMasked: extraction.account_masked,
      });
    }
  }

  if (!extraction) {
    // Needs Haiku — check safety ceilings first.
    if (runCallCount >= MAX_NEW_CLASSIFICATIONS_PER_RUN || dailyCallCountExceeded()) {
      return runCallCount; // leave labeled txn/inbox, retry next run/day
    }

    var result = classifyAndExtractViaGemini(sender, subject, body);
    runCallCount++;
    incrementDailyCallCount();

    if (!result.is_transaction) {
      upsertFingerprint(sender, template, false, null, null);
      relabelMessageThread(message, 'txn/processed');
      return runCallCount;
    }

    extraction = result;
    // The model may answer account_kind itself (it is in the schema); the
    // heuristic fills only when it did not — BEFORE derivation, so a non-null
    // verdict freezes into the template static and every later mail of this
    // shape inherits it with no model involved.
    if (extraction.account_kind == null) {
      extraction.account_kind = deriveAccountKind({
        bodyText: body, subject: subject,
        provider: extraction.source_provider || sender,
        accountMasked: extraction.account_masked,
      });
    }
    var derivedRegex = deriveExtractionTemplate(body, extraction);
    upsertFingerprint(sender, template, true, extraction.transaction_type, derivedRegex);
  }

  var auth = checkSenderAuthenticity(message, sender);
  if (!auth.ok) {
    Logger.log('sender auth ' + (senderAuthEnforced() ? 'REJECTED' : 'flagged') +
      ' for ' + gmailMessageId + ': ' + auth.reasons.join('; '));
    if (senderAuthEnforced()) {
      // Not a parse failure — the email may be perfectly well-formed and still
      // forged. Record it as such so it is reviewable, never silently dropped.
      insertParseFailure(message, 'sender_auth_failed: ' + auth.reasons.join('; '));
      relabelMessageThread(message, 'txn/parse-failed');
      return runCallCount;
    }
  }

  var mailbox = _routedMailbox;

  var memberId = mailbox.member_id;
  var dup = findDuplicate(extraction.amount, extraction.direction, extraction.occurred_at,
    extraction.source_provider, extraction.currency, memberId);
  var row = buildEmailTransactionRow(gmailMessageId, sender, extraction, body, dup, memberId);
  row.raw_extracted = Object.assign({}, row.raw_extracted, { _sender_auth: auth });
  // Written in BOTH eras — that is what keeps dedup continuous across the flip:
  // rows staged plaintext this week still match rows staged sealed next week.
  row.dedup_fp = dedupFingerprint(extraction.amount, extraction.direction, extraction.currency);

  // The plaintext row above never reaches the database with sealing on — it is
  // the input to the seal, built by the same code both eras so the two extract
  // identically. trySealRow returning null means HOLD: leave the message queued
  // (no relabel), retry next run. Never fall through to a plaintext insert.
  if (sealedStagingEnabled()) {
    var sealedRow = trySealRow(row);
    if (!sealedRow) return runCallCount;
    row = sealedRow;
  }

  var inserted = insertEmailTransaction(row);
  if (!inserted) {
    insertParseFailure(message, 'email_transactions insert failed');
    relabelMessageThread(message, 'txn/parse-failed');
    return runCallCount;
  }

  queueReviewNotice(row);            // only now that the row is really written

  // A forwarded message actually arriving is the only trustworthy evidence that
  // forwarding works — confirmPendingForwarding says so and deliberately does not
  // set this, pointing here instead. The call it points at was never made, so
  // `verified` stayed false for every connection ever made and the connect screen
  // sat on "waiting for Gmail" forever while the mail routed fine behind it.
  // Guarded because this runs per staged message and the flag only ever goes
  // one way: without it, every message for the life of the connection spends a
  // PATCH to rewrite true as true.
  if (!mailbox.verified) markMailboxVerified(mailbox.forwarding_alias);

  relabelMessageThread(message, 'txn/processed');

  return runCallCount;
}

// ---------- Stage 0 helpers ----------

// Builds the search from the aliases actually issued. Cached in Script Properties
// for a few minutes: mailbox_connections changes only when someone onboards, and
// re-reading it 1,440 times a day would spend the Supabase round trip that the
// single-search optimisation just saved.
var PROVIDER_LOOKBACK_DAYS = 7;   // how far back the known-bank-domain term reaches
var ALIAS_CACHE_PROP = 'ALIAS_QUERY_CACHE_V4';   // bump when the query shape changes,
                                                 // or a cached old query outlives the code
var ALIAS_CACHE_AT_PROP = 'ALIAS_QUERY_CACHE_AT';
var ALIAS_CACHE_MINUTES = 5;

function buildInboxQuery() {
  var props = PropertiesService.getScriptProperties();
  var cachedAt = Number(props.getProperty(ALIAS_CACHE_AT_PROP) || '0');
  var fresh = (new Date().getTime() - cachedAt) < ALIAS_CACHE_MINUTES * 60000;
  var aliasPart = fresh ? props.getProperty(ALIAS_CACHE_PROP) : null;

  if (aliasPart === null) {
    // Gmail rewrites Delivered-To to the BARE inbox address — the +tag survives
    // only in X-Forwarded-To, which Gmail search cannot query. So the search is
    // deliberately coarse (everything delivered here) and the +tag is matched
    // per-message afterwards. Safe because processOneMessage now routes BEFORE
    // extracting: anything without a known alias is skipped without ever
    // reaching the LLM.
    var rows = supabaseGet('mailbox_connections', { select: 'forwarding_alias' });
    // Not deliveredto:<bare inbox> — that matches the entire mailbox (measured:
    // 500 threads), so every personal email would be walked every minute.
    // And not deliveredto:<alias> either: Gmail strips the +tag from
    // Delivered-To, so it only ever matches mail addressed directly to the
    // alias.
    //
    // But `to:<alias>` DOES work, and it is a different operator from
    // deliveredto: — it reads the To: HEADER, where the +tag survives intact.
    // Measured 2026-08-13 against the live inbox: `to:gichisreading+<tag>` in a
    // 3,558-message mailbox returned 4 threads, all genuinely that alias's, zero
    // false positives.
    //
    // The two terms catch DIFFERENT mail and are both needed:
    //   • label:txn/inbox  — AUTO-forwarded mail. Gmail preserves the bank's
    //     original To:, so `to:<alias>` can never match it; the filter that
    //     applies the label is the only signal.
    //   • to:<alias>       — HAND-forwarded mail (and confirmations), where To:
    //     IS the alias. These carry the bank's address only as quoted body text,
    //     so a sender-based filter cannot label them and they were previously
    //     invisible to the pipeline forever.
    var terms = ['label:txn/inbox'];
    for (var r = 0; r < rows.length; r++) {
      if (rows[r].forwarding_alias) terms.push('to:' + aliasAddress(rows[r].forwarding_alias));
    }

    // Third term: the banks themselves.
    //
    // The label is applied by ONE hand-made Gmail filter on the shared inbox, and
    // on 2026-08-14 that filter turned out to cover MB Bank but not Vietcombank —
    // so a real auto-forwarded VCB transaction sat in the inbox unlabelled and
    // unseen. `to:<alias>` cannot rescue it either: an auto-forward preserves the
    // person's own address in To:, which is exactly the asymmetry documented in
    // README.md. A bank nobody remembered to add to the filter simply never works,
    // silently, and the only symptom is a missing transaction.
    //
    // known_provider_domains already knows which domains are banks (0050), so the
    // query can carry them and stop depending on a filter staying hand-maintained.
    // Measured 2026-08-14: `from:vietcombank.com.vn` DOES match a sender at the
    // subdomain VCBDigibank@info.vietcombank.com.vn — Gmail matches the parent.
    //
    // Bounded by newer_than so switching this on does not sweep years of archived
    // bank mail into the LLM on the first tick. Backfill is a separate feature and
    // should be a deliberate one.
    var domains = [];
    try { domains = supabaseGet('known_provider_domains', { select: 'domain_or_address' }) || []; }
    catch (e) { Logger.log('known_provider_domains unreadable, falling back to label+alias: ' + e); }
    var froms = [];
    for (var d = 0; d < domains.length; d++) {
      if (domains[d].domain_or_address) froms.push('from:' + domains[d].domain_or_address);
    }
    // Parenthesised deliberately: inside Gmail parens a space means AND, so
    // `(from:a OR from:b newer_than:7d)` would bind the date to from:b alone.
    if (froms.length) terms.push('((' + froms.join(' OR ') + ') newer_than:' + PROVIDER_LOOKBACK_DAYS + 'd)');

    aliasPart = rows.length ? terms.join(' OR ') : '';
    props.setProperty(ALIAS_CACHE_PROP, aliasPart);
    props.setProperty(ALIAS_CACHE_AT_PROP, String(new Date().getTime()));
  }

  // NOT is:unread. Read-state is a terrible record of "have I handled this" — a
  // human glancing at the message silently removes it from the search forever,
  // which happened during testing. The same labels that gate transactions gate
  // these, so opening one is harmless.
  var confirmPart = '(from:' + FORWARDING_CONFIRM_SENDER +
    ' newer_than:7d -label:txn/processed -label:txn/parse-failed)';
  if (!aliasPart) return confirmPart;   // no mailboxes yet: still confirm new ones

  return '((' + aliasPart + ') -label:txn/processed -label:txn/parse-failed) OR ' + confirmPart;
}

// Mirrors the client's address assembly (71-mailbox-ui.js). Kept as a constant
// here rather than derived, so moving to an owned domain is a one-line change on
// each side rather than a data migration.
var TXN_INBOX = 'gichisreading@gmail.com';
function aliasAddress(tag) {
  var at = TXN_INBOX.indexOf('@');
  return TXN_INBOX.slice(0, at) + '+' + tag + TXN_INBOX.slice(at);
}


function extractEmailAddress(fromHeader) {
  var match = fromHeader.match(/<(.+)>/);
  // Lowercased ALWAYS: this string keys the shared sender_fingerprints cache,
  // and the direct-read transport lowercases its side. VCB writes its own From
  // as VCBDigibank@… — without this, the two transports learned the same bank
  // under two keys and neither pile ever got tall enough to matter (0099
  // merged the split that this had already caused).
  return (match ? match[1] : fromHeader).trim().toLowerCase();
}

function normalizeSubjectTemplate(subject) {
  return subject
    // Same rule as the direct transport (extract.mjs): a forwarded receipt is
    // the same shape as the original, so "Fwd: Biên lai" must land on the
    // "Biên lai" row of the shared cache.
    .replace(/^\s*((fwd|fw|re|chuyen tiep|chuyển tiếp)\s*:\s*)+/i, '')
    .replace(/#[\w-]+/g, '')
    .replace(/\b\d{6,}\b/g, '')
    .replace(/\b\w+ \d{1,2},? \d{4}\b/g, '')
    .replace(/\b\d{1,2}[-\/]\d{1,2}[-\/]\d{2,4}\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function relabelMessageThread(message, labelName) {
  var thread = message.getThread();
  relabelThread(thread, labelName);
}

function relabelThread(thread, labelName) {
  // txn/inbox may never have been applied — mail is now found by delivery
  // address, not by label — so removing it is best-effort.
  try {
    var inbox = GmailApp.getUserLabelByName('txn/inbox');
    if (inbox) thread.removeLabel(inbox);
  } catch (e) { /* not labelled; nothing to remove */ }
  thread.addLabel(GmailApp.getUserLabelByName(labelName));
}

// ---------- Inbox retention ----------
//
// The shared inbox was a permanent plaintext archive. The pipeline labelled mail
// txn/processed and nothing ever removed it, so every bank email anyone had ever
// forwarded stayed sitting there, readable by whoever holds the mailbox. Staging
// IS the point of the forward; keeping the source afterwards buys nothing and
// costs the one promise this feature makes.
//
// Four deliberate limits, because this deletes other people's banking:
//
//   * TRASH, never a permanent delete. Gmail empties trash on its own after ~30
//     days, which turns a permanent archive into a bounded window while leaving
//     a recovery path for the weeks when someone might still need it. A hard
//     delete buys ~30 days of exposure and costs every mistake being final.
//   * Only txn/processed. txn/parse-failed is the reviewable record of what went
//     wrong and must survive; anything carrying neither label is still in flight.
//   * Only threads that are old END TO END. `older_than:` alone matches a thread
//     on its OLDEST message, so a live thread with one ancient message would be
//     trashed along with everything newer in it — the same hidden-later-message
//     trap the label exclusion already has. `-newer_than:` is what makes the
//     window mean the whole thread.
//   * Off until INBOX_RETENTION_ENABLED is 'true'. It lands switched off and gets
//     turned on deliberately, once, by someone who has read this.
function retentionEnabled() {
  return PropertiesService.getScriptProperties().getProperty('INBOX_RETENTION_ENABLED') === 'true';
}

function retentionDays() {
  var raw = PropertiesService.getScriptProperties().getProperty('INBOX_RETENTION_DAYS');
  var n = parseInt(raw, 10);
  // Anything unusable falls back to the constant rather than to what parseInt
  // returned: a typo'd property must not widen the window to 0 days and take
  // this morning's mail with it.
  return (isFinite(n) && n > 0) ? n : RETENTION_DAYS;
}

function sweepProcessedMail() {
  if (!retentionEnabled()) return 0;

  // A Gmail search is the dominant cost of an idle tick (see processEmails), and
  // this runs 1,440 times a day against a ~90-minute daily budget. Mail ages in
  // days, so an hourly sweep drains the backlog just as fast for 1/60th of the
  // searches. The timestamp is written BEFORE the work: a sweep that dies partway
  // must not retry every minute for the rest of the day.
  var props = PropertiesService.getScriptProperties();
  var last = parseInt(props.getProperty('INBOX_RETENTION_LAST_RUN'), 10);
  var now = new Date().getTime();
  if (isFinite(last) && (now - last) < RETENTION_SWEEP_INTERVAL_MIN * 60000) return 0;
  props.setProperty('INBOX_RETENTION_LAST_RUN', String(now));

  var days = retentionDays();
  var trashed = 0;
  // Two passes, two windows, one shape: processed mail at the short window,
  // parse-failed mail at the long one (RETENTION_FAILED_DAYS - the number the
  // consent sheet states, so the two move together). Both bounded the same way,
  // older_than AND -newer_than so a live thread with one ancient message
  // survives, and both capped per sweep.
  var passes = [
    { label: 'txn/processed', days: days },
    { label: 'txn/parse-failed', days: RETENTION_FAILED_DAYS },
  ];
  for (var p = 0; p < passes.length; p++) {
    var q = 'label:' + passes[p].label + ' older_than:' + passes[p].days + 'd -newer_than:' + passes[p].days + 'd';
    var threads = GmailApp.search(q, 0, RETENTION_MAX_THREADS_PER_SWEEP);
    if (!threads.length) continue;
    var got = 0;
    for (var i = 0; i < threads.length; i++) {
      // Per-thread, so one thread that will not move cannot strand the rest of
      // the batch behind it every hour forever.
      try { threads[i].moveToTrash(); got++; }
      catch (e) { Logger.log('retention: could not trash a thread: ' + e); }
    }
    trashed += got;
    Logger.log('v' + PIPELINE_VERSION + ' | retention: trashed ' + got + '/' + threads.length +
      ' thread(s) | q=' + q);
  }
  if (!trashed) Logger.log('v' + PIPELINE_VERSION + ' | retention: nothing past its window');
  return trashed;
}

// ---------- Stage 1 helpers ----------

function findFingerprint(sender, template) {
  var rows = supabaseGet('sender_fingerprints', {
    sender_address: 'eq.' + sender,
    subject_template: 'eq.' + template,
  });
  return rows.length ? rows[0] : null;
}

function tryRegexExtract(pattern, body) {
  return applyExtractionTemplate(pattern, body);   // template JSON (or legacy string → null)
}

function dailyCallCountExceeded() {
  var props = PropertiesService.getScriptProperties();
  var today = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  var key = 'llmCallCount:' + today;
  var count = Number(props.getProperty(key) || '0');
  return count >= MAX_NEW_CLASSIFICATIONS_PER_DAY;
}

function incrementDailyCallCount() {
  var props = PropertiesService.getScriptProperties();
  var today = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  var key = 'llmCallCount:' + today;
  var count = Number(props.getProperty(key) || '0');
  props.setProperty(key, String(count + 1));
}

// ---------- What the model is sent ----------
// The subject and body go to the model AS WRITTEN. Real amounts, real names,
// real account and reference numbers.
//
// This reverses a deliberate design. Until 2026-08-25 every LLM call went
// through maskForSharing(), which replaced each sensitive token with a
// shape-preserving fake, and unmaskExtraction(), which swapped the real values
// back locally. It worked, it was verified against live Gemini on real MB Bank
// mail, and it is gone on purpose rather than by accident.
//
// WHAT REPLACED IT: consent. Bank transactions are sensitive personal data
// under L91/2025, so the feature already asks separately before a single email
// is collected (75-consent-ui.js, kind 'bank_email', recorded in user_consents
// per 0082). That sheet now states plainly that a first-time bank's mail is
// sent to an AI service to be read, amounts and names included, and the
// version was bumped so everyone re-affirms against the new text. Consent is
// the control now; masking is not a second one running underneath it.
//
// IF YOU ARE ABOUT TO PUT IT BACK, READ THIS FIRST. Masking is not a bug fix
// here and re-adding it silently would put the code and the consent sheet out
// of step in the direction that matters least — but changing what we DISCLOSE
// without changing what people agreed to is the one that matters most. Either
// way the pair moves together: the sheet's copy and FH_CONSENT_V in
// 75-consent-ui.js, and this comment.
//
// WHAT DID NOT CHANGE, and is easy to lose sight of:
//   - Repeat senders never reach a model at all. A known (sender,
//     subject_template) with a stored template is parsed locally by
//     applyExtractionTemplate(), which is most volume, permanently. The
//     consent copy says so because it is the honest half of the picture.
//   - Nothing about at-rest sealing. The row still goes into the database in a
//     box this script cannot open (SEALED-STAGING-DESIGN). The model leg and
//     the database leg were always separate problems, and only the first one
//     moved.
//   - The app's CSV redactor (src/js-ui/43-redact-for-sharing.js) is a
//     different feature on a different surface and is untouched.

var EXTRACTION_SYSTEM_PROMPT =
  'You classify and extract structured data from an email. The email may or may not represent ' +
  'a financial transaction (bank transfer, subscription receipt, e-commerce order, bill payment, ' +
  'P2P transfer). It may be in Vietnamese, English, or mixed.\n\n' +
  'If the email is NOT a transaction record (promotional, newsletter, unrelated notification), ' +
  'set is_transaction to false and leave all other fields null.\n\n' +
  'If it IS a transaction record, extract every field you can find. Use null for anything not ' +
  'present in the email — do not guess or infer values that aren\'t stated.\n\n' +
  'transaction_type: use p2p_transfer when the counterparty is an individual person — identified ' +
  'by a personal name, a phone number, or a personal account/e-wallet, with no indication of a ' +
  'merchant or business. Use bank_txn for other bank-initiated transactions with no clear personal ' +
  'counterparty (fees, interest, transfers to a business/wallet system, generic account activity). ' +
  'Use subscription/ecommerce_receipt/bill_payment for their respective clearly-labeled cases.\n\n' +
  'occurred_at: ISO 8601, and must include a UTC offset. If the email states one, use it. If it ' +
  'doesn\'t (most Vietnamese bank/provider emails don\'t), assume the timestamp is already in the ' +
  'sender\'s local time and attach that offset — for Vietnamese banks and providers this is ' +
  '+07:00. Never output a bare timestamp with no offset.\n\n' +
  'counterparty: copy the full counterparty string exactly as written in the email, including any ' +
  'account number, phone number, or identifier alongside the name — do not shorten or summarize it.\n\n' +
  'memo: the free-text note the payer attached to the transaction — the transfer message, payment ' +
  'reference, order description, or item name. In Vietnamese bank emails this is usually labelled ' +
  '"Nội dung chuyển tiền", "Nội dung giao dịch", "Diễn giải" or similar. Copy it verbatim. This is ' +
  'the only field that can carry the payer\'s own words about WHY the money moved, so never ' +
  'paraphrase it and never substitute a description of your own. Many banks auto-generate this ' +
  'field from the sender name and it carries no real meaning (e.g. "NGUYEN VAN A chuyen tien", ' +
  '"TRANSFER FROM ..."); extract it as written either way and do not try to judge whether it is ' +
  'meaningful — a human reviews it downstream.\n\n' +
  'Amounts must be the raw number with no currency symbol or thousands separators. If the email ' +
  'states a status (success/failed/pending), extract it; otherwise null.\n\n' +
  'currency: the ISO 4217 code the amount is denominated in (VND, USD, EUR, ...), exactly as the ' +
  'email states it — never default to VND when the mail prints another currency. International ' +
  'card notices from Vietnamese banks often show BOTH a foreign transaction amount and the ' +
  'converted amount actually debited in VND (labelled "Số tiền quy đổi", "Số tiền ghi nợ" or ' +
  'similar). When both are present, amount must be the converted VND figure with currency VND, ' +
  'and the original foreign figure goes into fx_amount and fx_currency. When only a foreign ' +
  'amount is present, amount is that figure with its own currency code and fx_amount/fx_currency ' +
  'stay null. Never compute a conversion yourself — only report figures the mail prints.\n\n' +
  'account_kind: which kind of account the money moved on, judged only from what the mail itself ' +
  'says. credit_card when the mail shows a credit limit or an outstanding card balance — Vietnamese ' +
  'banks write "Hạn mức khả dụng" or "Dư nợ" — or names a credit card ("thẻ tín dụng"). deposit ' +
  'when it reports the account balance after the transaction ("Số dư") or is a balance-change ' +
  'notice ("biến động số dư") on a bank account. ewallet when the sender is an e-wallet — MoMo, ' +
  'ZaloPay, ShopeePay, or the mail says "ví điện tử". When the mail carries none of these signals, ' +
  'answer null — never guess, because a wrongly claimed credit card invents a debt.';

var EXTRACTION_SCHEMA = {
  type: 'object',
  properties: {
    is_transaction: { type: 'boolean' },
    transaction_type: {
      type: ['string', 'null'],
      enum: ['bank_txn', 'subscription', 'ecommerce_receipt', 'p2p_transfer', 'bill_payment', null],
    },
    source_provider: { type: ['string', 'null'] },
    occurred_at: { type: ['string', 'null'] },
    amount: { type: ['number', 'null'] },
    currency: { type: ['string', 'null'] },
    // The ORIGINAL foreign figure when the mail shows both it and the
    // converted VND amount it billed (foreign-currency-emails-spec.md,
    // Approach 2). NOT in `required`, same treatment as account_kind: absent
    // reads as null downstream.
    fx_amount: { type: ['number', 'null'] },
    fx_currency: { type: ['string', 'null'] },
    direction: { type: ['string', 'null'], enum: ['debit', 'credit', null] },
    counterparty: { type: ['string', 'null'] },
    memo: { type: ['string', 'null'] },
    reference_number: { type: ['string', 'null'] },
    status: { type: ['string', 'null'] },
    account_masked: { type: ['string', 'null'] },
    // WHICH INSTRUMENT moved the money (borrowing-lending-spec §8). NOT in
    // `required`: deriveAccountKind() fills the gap when the model says
    // nothing, and null means "the mail did not say" — the client defaults to
    // deposit-expense behaviour rather than inventing a debt.
    account_kind: {
      type: ['string', 'null'],
      enum: ['credit_card', 'deposit', 'ewallet', null],
    },
  },
  required: [
    'is_transaction', 'transaction_type', 'source_provider', 'occurred_at',
    'amount', 'currency', 'direction', 'counterparty', 'memo', 'reference_number',
    'status', 'account_masked',
  ],
  additionalProperties: false,
};

function classifyAndExtractViaHaiku(sender, subject, body) {
  var apiKey = PropertiesService.getScriptProperties().getProperty('ANTHROPIC_API_KEY');

  var mailText = 'Subject: ' + subject + '\n\n' + body;

  var payload = {
    model: 'claude-haiku-4-5',
    max_tokens: 512,
    system: EXTRACTION_SYSTEM_PROMPT,
    output_config: { format: { type: 'json_schema', schema: EXTRACTION_SCHEMA } },
    messages: [{
      role: 'user',
      content: 'Sender: ' + sender + '\n' + mailText,
    }],
  };

  var response = UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', {
    method: 'post',
    contentType: 'application/json',
    headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  });

  var data = JSON.parse(response.getContentText());
  return JSON.parse(data.content[0].text);
}

// Gemini equivalent — same system prompt + schema, different request/response shape.
// Free tier (Google AI Studio, no card): gemini-3.5-flash-lite, rate-limited but well
// above what this pipeline needs given the fingerprint cache. Swap the call site in
// processOneMessage back to classifyAndExtractViaHaiku() to switch models later.
var GEMINI_MODEL = 'gemini-3.5-flash-lite';

function classifyAndExtractViaGemini(sender, subject, body) {
  var apiKey = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');
  var url = 'https://generativelanguage.googleapis.com/v1beta/models/' + GEMINI_MODEL
    + ':generateContent?key=' + encodeURIComponent(apiKey);

  var mailText = 'Subject: ' + subject + '\n\n' + body;

  var payload = {
    systemInstruction: { parts: [{ text: EXTRACTION_SYSTEM_PROMPT }] },
    contents: [{
      role: 'user',
      parts: [{ text: 'Sender: ' + sender + '\n' + mailText }],
    }],
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: stripNullsForGemini(EXTRACTION_SCHEMA),
    },
  };

  var response = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  });

  var data = JSON.parse(response.getContentText());
  if (!data.candidates || !data.candidates.length) {
    throw new Error('Gemini returned no candidates: ' + response.getContentText());
  }
  return JSON.parse(data.candidates[0].content.parts[0].text);
}

// Gemini's responseSchema is a restricted OpenAPI-3.0-style subset, not full JSON Schema:
// (1) no `type: [x, "null"]` union form — wants `nullable: true` alongside a single type,
// (2) `additionalProperties` isn't a recognized field at all — including it is a hard 400,
// not silently ignored. Converts once; EXTRACTION_SCHEMA itself is untouched so
// classifyAndExtractViaHaiku() keeps working unmodified if we swap back.
function stripNullsForGemini(schema) {
  var copy = JSON.parse(JSON.stringify(schema));
  delete copy.additionalProperties;
  for (var key in copy.properties) {
    var prop = copy.properties[key];
    if (Array.isArray(prop.type)) {
      var real = prop.type.filter(function (t) { return t !== 'null'; })[0];
      prop.type = real;
      prop.nullable = true;
      if (Array.isArray(prop.enum)) prop.enum = prop.enum.filter(function (e) { return e !== null; });
    }
  }
  return copy;
}

// ---------- Extraction templates: parse repeat senders 100% locally ----------
// After the FIRST successful LLM extraction for a (sender, subject_template),
// deriveExtractionTemplate() builds a per-field anchor+capture+transform spec
// that provably reproduces the LLM's own output on that very email — stored as
// JSON in sender_fingerprints.extraction_regex. Every later matching email is
// parsed by applyExtractionTemplate() with ZERO LLM involvement: no cost, and
// nothing leaving at all. Since masking was removed this is no longer a saving
// on top of a protection, it IS the protection for everything after the first
// mail off a template — which is most volume, permanently, and the reason the
// consent copy can honestly say a bank is read on the spot after the first
// time. A structurally different email (e.g. the credit variant of a
// debit notification) fails the anchors → falls back to the LLM → re-derives.
// Templates carry EXTRACTION_LOGIC_VERSION — bump it after any prompt/logic
// improvement and every stored template self-invalidates, forcing one fresh
// LLM re-derivation per sender ("the cheat sheet stays current").
// Tested locally 2026-08-06: derive-from-real-MB-structure, apply-to-variant
// (different amount/name/ref/time), reject-different-structure, reject-stale-
// version, reject-legacy-placeholder, self-reproduction — all pass.

var EXTRACTION_LOGIC_VERSION = 4;   // 4: memo anchored + verified. account_kind is filled by the
                                    // per-read heuristic on every tier, so it needs no version bump —
                                    // bumping to 5 to staticise it stalled backfills (2026-09-02).

function _escRe(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

// which printed forms could the extracted number take in the body?
function _amountCandidates(n) {
  if (typeof n !== 'number' || isNaN(n)) return [];
  var out = [];
  var neg = n < 0, abs = Math.abs(n);
  var intPart = Math.floor(abs);
  var frac = Math.round((abs - intPart) * 100);
  var intStr = String(intPart);
  var usGroup = intStr.replace(/\B(?=(\d{3})+(?!\d))/g, ',');   // 2,000
  var vnGroup = intStr.replace(/\B(?=(\d{3})+(?!\d))/g, '.');   // 2.000
  var fr2 = (frac < 10 ? '0' : '') + frac;
  out.push({ raw: usGroup + '.' + fr2, parse: 'us' });          // 2,000.00
  out.push({ raw: vnGroup + ',' + fr2, parse: 'vn' });          // 2.000,00
  if (frac === 0) {
    out.push({ raw: usGroup, parse: 'us' });
    out.push({ raw: vnGroup, parse: 'vn' });
    out.push({ raw: intStr, parse: 'plain' });
  } else {
    out.push({ raw: intStr + '.' + fr2, parse: 'us' });
  }
  if (neg) out = out.map(function (c) { return { raw: '-' + c.raw, parse: c.parse }; });
  return out;
}

function _parseAmount(raw, mode) {
  var s = String(raw).trim();
  if (mode === 'us') s = s.replace(/,/g, '');
  else if (mode === 'vn') s = s.replace(/\./g, '').replace(/,/g, '.');
  var n = parseFloat(s);
  return isNaN(n) ? null : n;
}

function _pad2(x) { return (String(x).length < 2 ? '0' : '') + x; }
function _tryDateTransform(raw, kind, offset) {
  var m;
  if (kind === 'dmy_hms') {
    m = raw.match(/^(\d{1,2})-(\d{1,2})-(\d{4})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?$/);
    if (!m) return null;
    return m[3] + '-' + _pad2(m[2]) + '-' + _pad2(m[1]) + 'T' + _pad2(m[4]) + ':' + m[5] + ':' + (m[6] || '00') + offset;
  }
  if (kind === 'dmy_slash_hms') {
    m = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?$/);
    if (!m) return null;
    return m[3] + '-' + _pad2(m[2]) + '-' + _pad2(m[1]) + 'T' + _pad2(m[4]) + ':' + m[5] + ':' + (m[6] || '00') + offset;
  }
  if (kind === 'ymd_hms') {
    m = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?$/);
    if (!m) return null;
    return m[1] + '-' + _pad2(m[2]) + '-' + _pad2(m[3]) + 'T' + _pad2(m[4]) + ':' + m[5] + ':' + (m[6] || '00') + offset;
  }
  if (kind === 'hm_dmy_slash') {
    // "10:17 30/08/2026", optionally with the weekday between: "11:11 Chủ Nhật
    // 23/08/2026". The weekday is display, not data — stripped before parsing.
    m = raw.replace(/\s+(?:Thứ\s+\S+|Chủ\s+Nhật)\s+/, ' ')
           .match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?\s+(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (!m) return null;
    return m[6] + '-' + _pad2(m[5]) + '-' + _pad2(m[4]) + 'T' + _pad2(m[1]) + ':' + m[2] + ':' + (m[3] || '00') + offset;
  }
  // Date-only forms → midnight. Many VN banks (VCB, VIB) print "Ngày giao dịch:
  // 26/08/2026" with no clock, so the date+time kinds above never anchor and the
  // template never derives — sending every one of that bank's mails to the model
  // forever. Tried AFTER the time-bearing kinds, so a body that does carry a time
  // still anchors the exact time; these only match when the raw is date-only and
  // the model read the moment as midnight, which is what a date-only source gives.
  if (kind === 'dmy') {
    m = raw.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
    if (!m) return null;
    return m[3] + '-' + _pad2(m[2]) + '-' + _pad2(m[1]) + 'T00:00:00' + offset;
  }
  if (kind === 'dmy_slash') {
    m = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (!m) return null;
    return m[3] + '-' + _pad2(m[2]) + '-' + _pad2(m[1]) + 'T00:00:00' + offset;
  }
  if (kind === 'ymd') {
    m = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    if (!m) return null;
    return m[1] + '-' + _pad2(m[2]) + '-' + _pad2(m[3]) + 'T00:00:00' + offset;
  }
  return null;
}
var _DATE_KINDS = ['dmy_hms', 'dmy_slash_hms', 'ymd_hms', 'hm_dmy_slash', 'dmy', 'dmy_slash', 'ymd'];
/* Time may come FIRST (2026-09-02). VIB writes "Vào lúc: 10:17 30/08/2026" and
   VCB receipts write "11:11 Chủ Nhật 23/08/2026" — the scanner only knew
   time-AFTER-date, so it captured the bare date, every kind resolved to
   midnight, midnight never equalled the model's 10:17, and the very first
   required field killed the whole derivation. Both shapes are real mails in
   pipeline/template-graduation.test.js. */
var _DATE_RAW_RE = /(?:\d{1,2}:\d{2}(?::\d{2})?\s+(?:(?:Thứ\s+\S+|Chủ\s+Nhật)\s+)?)?\d{1,4}[-\/]\d{1,2}[-\/]\d{1,4}(?:[ T]\d{1,2}:\d{2}(?::\d{2})?)?/g;

// find the stable label text that precedes a value; returns {re} or null.
/* An anchor label, made safe to reuse (2026-09-02). Escaped, then every digit
   run generalised to \d+ and any trailing sign dropped. Three live templates
   carried their sample's noise as literal anchor text — a "+" that matched only
   refunds, a "10:17" that matched only one clock time — because the text
   between a label and its value belongs to the SAMPLE, not the shape. */
function _anchorLabel(text) {
  return _escRe(String(text).replace(/[+\-]\s*$/, '').trim()).replace(/\d+/g, '\\d+');
}

function _deriveAnchor(body, rawValue, valuePatterns, opts) {
  var idx = body.indexOf(rawValue);
  if (idx < 0) return null;
  var lineStart = body.lastIndexOf('\n', idx - 1) + 1;
  var samePrefix = body.slice(lineStart, idx).replace(/[+\-]\s*$/, '');
  var trials = [];
  /* A same-line prefix that reads like a PERSON'S NAME (two-plus consecutive
     unaccented-caps words, the exact way banks print holders) never becomes an
     anchor: it would put the name in a plaintext shared table AND pin the
     template to one person. The label-line trial below covers those layouts.
     Guarded per-field via opts, because "MB TK" must keep anchoring. */
  var nameLike = /[A-Z]{2,}(?: [A-Z]{2,})+/.exec(samePrefix);
  var nameRisk = !!(opts && opts.avoidNamePrefix && nameLike && nameLike[0].replace(/ /g, '').length >= 8);
  if (samePrefix.trim().length >= 2 && !nameRisk) {
    trials.push({ label: samePrefix.trim(), joiner: '[^\\S\\n]*' });
  }
  var cursor = lineStart - 1;
  while (cursor > 0 && /\s/.test(body[cursor])) cursor--;
  if (cursor > 0) {
    var prevStart = body.lastIndexOf('\n', cursor - 1) + 1;
    var prevLine = body.slice(prevStart, cursor + 1).trim();
    if (prevLine.length >= 2) trials.push({ label: prevLine, joiner: '\\s*\\n\\s*' + (nameRisk ? '[^\\n]*?' : _anchorLabel(samePrefix)) + (samePrefix.trim() ? '[^\\S\\n]*' : '') });
  }
  for (var t = 0; t < trials.length; t++) {
    for (var p = 0; p < valuePatterns.length; p++) {
      var src = _anchorLabel(trials[t].label) + trials[t].joiner + valuePatterns[p];
      try {
        var m = new RegExp(src).exec(body);
        if (m && m[1] !== undefined && String(m[1]).trim() === rawValue) return { re: src };
      } catch (e) { /* bad pattern, try next */ }
    }
  }
  return null;
}

// capture patterns, most GENERAL first: string values (names!) change between
// emails, so a pattern hard-coding this email's text validates here but fails
// on the next email. Per-field validation rejects over-greedy captures.
function _valuePatternsFor(rawValue, type) {
  var pats = [];
  if (type === 'number') {
    // The SIGN belongs to the value, never to the anchor (2026-09-02). A live
    // template had "\\+" baked into its amount anchor — derived off a refund —
    // and matched nothing but refunds: 409 misses a day, found by the
    // template_missed tally. parseFloat reads a leading + or - natively.
    // Matched OUTSIDE the capture: the template tolerates any sign, captures
    // none, and direction stays where it belongs — the statics and the status
    // of the mail. Capturing it broke the verbatim check; anchoring it broke
    // every mail with the other sign.
    pats.push('(?:[-+][^\\S\\n]*)?([\\d.,]+)');
    // A reading whose amount is ITSELF signed must capture the sign, or the
    // parse-back can never equal it. Tried second, so unsigned readings still
    // get the sign-tolerant anchor above.
    if (/^[-+]/.test(rawValue)) pats.push('([-+][\\d.,]+)');
    return pats;
  }
  pats.push('([^\\n]+)');
  if (/^\d+$/.test(rawValue)) pats.push('(\\d{' + Math.max(4, rawValue.length - 4) + ',})');
  pats.push('(' + _escRe(rawValue).replace(/\d+/g, '\\d+') + ')');
  return pats;
}

// ---- the instrument classifier: which kind of account moved the money? ----
// borrowing-lending-spec §8. 'credit_card' | 'deposit' | 'ewallet' | null.
// Heuristic over the mail's own words, diacritic-stripped; rules ordered most
// reliable first. It NEVER guesses: an ambiguous mail returns null, the client
// defaults to deposit-expense behaviour with an editable chip, and a phantom
// card debt is never invented (spec §8.4 / Q16). Lives in this shared slice so
// both transports classify identically — they write one template cache.
var _AK_EWALLETS = ['momo', 'zalopay', 'shopeepay'];

function _akNorm(s) {
  // Escaped, not literal combining marks: the .gs twin of this slice is
  // deployed by hand-pasting and invisible characters do not survive that.
  return String(s == null ? '' : s).normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D')
    .toLowerCase().replace(/\s+/g, ' ');
}

function deriveAccountKind(input) {
  var body = _akNorm(input && input.bodyText);
  var subject = _akNorm(input && input.subject);
  var provider = _akNorm(input && input.provider).replace(/[^a-z0-9]/g, '');
  // 1. a credit limit or an outstanding balance — deposit accounts have neither
  if (/\bhan muc kha dung\b/.test(body) || /\bdu no\b/.test(body)) return 'credit_card';
  // 2. the wallet providers are e-wallets whatever the body says about balances
  for (var i = 0; i < _AK_EWALLETS.length; i++) {
    if (provider.indexOf(_AK_EWALLETS[i]) >= 0) return 'ewallet';
  }
  // 3. a balance-after-transaction row is how deposit-account notices sign off
  if (/\bso du\b/.test(body)) return 'deposit';
  // 4. the subject names the product where a terse body does not
  if (/\bthe tin dung\b/.test(subject)) return 'credit_card';
  if (/\bso du tai khoan\b/.test(subject) || /\bbien dong so du\b/.test(subject)) return 'deposit';
  // 5. tiebreaker: a 16-digit masked PAN is a card; bank account numbers are shorter
  var pan = String(input && input.accountMasked != null ? input.accountMasked : '').replace(/[\s.-]/g, '');
  if (/^[0-9Xx*\u2022\u2026]{15,16}$/.test(pan) && /[0-9]/.test(pan)) return 'credit_card';
  // 6. unknown stays unknown — null, never a guessed debt
  return null;
}

/* Foreign-currency guard for the template tier (2026-09-03).
 *
 * Templates freeze `currency` as a static of the shape, and one (sender,
 * subject_template) shape legitimately carries BOTH: a bank's card notice
 * announces a domestic coffee in VND and a foreign subscription in USD off the
 * same layout. A static cannot express that, so the rule is asymmetric:
 *
 *   - derivation REFUSES a non-VND extraction outright ('foreign_currency'),
 *     so no foreign-static template can ever exist and the statics stay the
 *     one honest value they can hold;
 *   - apply DEGRADES (returns null) when the mail itself speaks a foreign
 *     currency — a token on the amount's own line, or an explicit currency
 *     row — while the template would answer VND. Degrading hands the mail to
 *     the currency-aware tiers (label-table reader, then the model), which is
 *     the standing rule: a template can degrade a mail to the expensive path,
 *     never to a wrong answer. Before this guard, a VND-derived template
 *     stamped VND onto every USD mail of its shape and re-parsed "111.00"
 *     under VN grouping as 11100.
 *
 * The token check is deliberately NARROW: the amount's line and a labelled
 * currency row, never the whole body — a footer mentioning USD in marketing
 * prose must not send every domestic mail of the shape to the model. */
var _FOREIGN_CUR_CODES = 'USD|EUR|GBP|AUD|SGD|JPY|CNY|KRW|THB|HKD|CHF|CAD|NZD|TWD|MYR|INR';
// Escaped symbols, not literals: the .gs twin of this slice is deployed by
// hand-pasting, the same reason _akNorm escapes its combining marks.
var _FOREIGN_CUR_LINE_RE = new RegExp('(?:\\b(?:' + _FOREIGN_CUR_CODES + ')\\b|[$\\u20AC\\u00A3\\u00A5])', 'i');
function _readsForeignCurrency(body, amountLine) {
  if (amountLine && _FOREIGN_CUR_LINE_RE.test(amountLine)) return true;
  var flat = _akNorm(body);
  var m = flat.match(/(?:loai tien(?: te)?|don vi tien te)\s*[:.\-]?\s*([a-z]{3})\b/);
  if (!m) return false;
  return new RegExp('^(?:' + _FOREIGN_CUR_CODES.toLowerCase() + ')$').test(m[1]);
}

function deriveExtractionTemplate(body, extraction, trace) {
  /* `trace`, optional: called with ONE short step name at whichever exit killed
     the derivation — 'date', 'amount', 'anchor:<field>', 'proof', 'hygiene',
     'foreign_currency'.
     Never a value, never mail text: the step is diagnosis, the value is PII.
     Sixteen shapes failed here for weeks with a bare null, and every caller had
     to bisect by hand what this one word would have said. */
  var fail = function (step) { try { if (trace) trace(step); } catch (e) {} return null; };
  if (!extraction || extraction.is_transaction !== true) return null;
  // See the foreign-currency guard above: a non-VND reading never becomes a
  // template, because the shape it came from also sends VND mail.
  if (extraction.currency != null && extraction.currency !== 'VND') return fail('foreign_currency');
  var tpl = { v: EXTRACTION_LOGIC_VERSION, static: {}, fields: {} };

  // constants for this (sender, subject_template) email kind — protected by the
  // anchors: a structurally different email fails them and falls back to the LLM
  tpl.static.transaction_type = extraction.transaction_type != null ? extraction.transaction_type : null;
  tpl.static.source_provider = extraction.source_provider != null ? extraction.source_provider : null;
  tpl.static.currency = extraction.currency != null ? extraction.currency : null;
  tpl.static.direction = extraction.direction != null ? extraction.direction : null;
  /* account_kind is a property of the shape, like direction: a given
     (sender, subject_template) is almost always ONE product (spec §8.1), so
     the instrument verdict freezes here — but only when NON-NULL. A null is
     "the mail did not say", and staticising it would freeze ignorance into
     the shape; an absent key copies nothing, so every later mail gets the
     per-mail heuristic again and a confident verdict can still fill it when
     the shape re-derives. */
  if (extraction.account_kind != null) tpl.static.account_kind = extraction.account_kind;
  /* status is deliberately NOT staticised. It is the one field here that is an
     OUTCOME of the individual mail rather than a property of the shape: derive
     off a declined attempt and every later success staticises as "Không thành
     công", derive off a success and every later decline staticises as real
     spending. A live VCB template carried the first of those. Nothing corrected
     it, because a success body does not read as failed.
     The mail's own status row is the only authority — statusReadsFailed(), which
     extract.mjs asks above every tier. That makes the static redundant as well
     as unsafe, so it is gone rather than merely nulled: an absent key copies
     nothing, and the shape has no opinion to be wrong about. */

  if (typeof extraction.occurred_at !== 'string') return null;
  var offM = extraction.occurred_at.match(/([+-]\d{2}:\d{2}|Z)$/);
  var offset = offM ? offM[1] : '+07:00';
  var found = null;
  var rawDates = body.match(_DATE_RAW_RE) || [];
  for (var d = 0; d < rawDates.length && !found; d++) {
    for (var k = 0; k < _DATE_KINDS.length && !found; k++) {
      if (_tryDateTransform(rawDates[d], _DATE_KINDS[k], offset) === extraction.occurred_at) {
        var anch = _deriveAnchor(body, rawDates[d], ['([\\d\\-\\/ T:]+?)(?=\\s*$|\\s*\\n)', '([\\d\\-\\/ T:]+)', '([\\d:]{4,8}\\s+(?:Thứ\\s+\\S+|Chủ\\s+Nhật)\\s+[\\d\\/]{8,10})']);
        if (anch) found = { re: anch.re, dt: _DATE_KINDS[k], off: offset };
      }
    }
  }
  if (!found) return fail('date');
  tpl.fields.occurred_at = found;

  if (typeof extraction.amount !== 'number') return null;
  var amtSpec = null;
  var cands = _amountCandidates(extraction.amount);
  for (var c = 0; c < cands.length && !amtSpec; c++) {
    if (body.indexOf(cands[c].raw) < 0) continue;
    var a = _deriveAnchor(body, cands[c].raw, _valuePatternsFor(cands[c].raw, 'number'));
    if (a && _parseAmount(cands[c].raw, cands[c].parse) === extraction.amount) {
      amtSpec = { re: a.re, num: cands[c].parse };
    }
  }
  if (!amtSpec) return fail('amount');
  tpl.fields.amount = amtSpec;

  // varying string fields — anchored if present; a present-but-unanchorable
  // value fails the whole derivation (never silently degrade vs the LLM path)
  // memo belongs here even though it is the hardest to anchor: it is the only
  // field carrying WHY the money moved, and the seed for the description a human
  // writes at review. Leaving it out meant the FIRST email from a sender kept its
  // memo (LLM path) and every email after it lost one (template path) — silently,
  // and on the path that carries most volume permanently.
  var strFields = ['counterparty', 'reference_number', 'account_masked', 'memo'];
  var accountDegraded = false;
  for (var f = 0; f < strFields.length; f++) {
    var name = strFields[f], val = extraction[name];
    if (val === null || val === undefined || val === '') { tpl.static[name] = null; continue; }
    var spec = _deriveAnchor(body, String(val), _valuePatternsFor(String(val), 'string'),
                             name === 'account_masked' ? { avoidNamePrefix: true } : null);
    if (!spec) {
      /* account_masked ALONE may degrade (2026-09-02): omitted from the
         template, derivation continues, and later mails of this shape read
         every other field free while the account stays whatever richer tier
         filled it. Three real shapes were dying on this one field — a value
         nothing in the client reads today — at the price of a model call per
         mail forever. Every OTHER field keeps the fail-hard rule, memo above
         all: a template that silently drops the one field carrying WHY the
         money moved was a real incident, and this loop's strictness is its
         scar. Degrading is per-field justified or it is silent data loss. */
      if (name === 'account_masked') { accountDegraded = true; continue; }
      return fail('anchor:' + name);
    }
    tpl.fields[name] = spec;
  }

  // final proof: the template must reproduce the LLM's extraction exactly
  var check = applyExtractionTemplate(JSON.stringify(tpl), body);
  if (!check) return fail('proof');
  // memo is checked here too. It was missing, which is why the derivation above
  // could drop it and still pass its own "reproduces the LLM exactly" proof — a
  // verification that does not cover a field cannot protect it.
  // `status` is absent on purpose, and has to be: the template no longer carries
  // one, so checking it here would compare undefined against the reading's own
  // status and fail EVERY derivation off a mail that states an outcome.
  var keys = ['transaction_type', 'source_provider', 'occurred_at', 'amount', 'currency', 'direction', 'account_kind', 'counterparty', 'reference_number', 'account_masked', 'memo'];
  // A degraded account is ABSENT from the template on purpose, so the proof
  // must not demand the template reproduce it — that would re-kill exactly the
  // derivations the degrade exists to save.
  if (accountDegraded) keys = keys.filter(function (k) { return k !== 'account_masked'; });
  for (var i = 0; i < keys.length; i++) {
    var a2 = check[keys[i]], b2 = extraction[keys[i]];
    if (String(a2 === undefined ? null : a2) !== String(b2 === undefined ? null : b2)) return fail('proof:' + keys[i]);
  }
  /* The backstop that turns a lucky audit into a rule (2026-09-02): no
     template may carry a six-plus digit run — an account number, a phone, a
     reference — into `sender_fingerprints`, which is plaintext and shared by
     every family. The audit that found 0 such rows ran once, by hand; this
     runs on every derivation, forever. Refusing is the same safe outcome as
     any other failed derivation: the shape stays on the model path. */
  var tplJsonOut = JSON.stringify(tpl);
  if (/\d{6,}/.test(tplJsonOut)) return fail('hygiene');
  return tplJsonOut;
}

// run a stored template against a new email body → extraction object or null
function applyExtractionTemplate(tplJson, body) {
  if (!tplJson || tplJson[0] !== '{') return null;   // legacy placeholder strings → LLM
  var tpl;
  try { tpl = JSON.parse(tplJson); } catch (e) { return null; }
  if (tpl.v !== EXTRACTION_LOGIC_VERSION) return null;   // stale → re-derive via LLM

  var out = { is_transaction: true };
  for (var s in tpl.static) out[s] = tpl.static[s];

  var amtLine = '';
  for (var f in tpl.fields) {
    var spec = tpl.fields[f], m;
    try { m = new RegExp(spec.re).exec(body); } catch (e) { return null; }
    if (!m || m[1] === undefined) return null;
    var raw = String(m[1]).trim();
    if (spec.dt) {
      var iso = _tryDateTransform(raw, spec.dt, spec.off);
      if (!iso) return null;
      out[f] = iso;
    } else if (spec.num) {
      var n = _parseAmount(raw, spec.num);
      if (n === null || n === 0) return null;
      out[f] = n;
      if (f === 'amount') {
        // the LINE the amount was read off — where a foreign token would sit
        var vi = m.index + m[0].lastIndexOf(m[1]);
        var ls = body.lastIndexOf('\n', vi) + 1;
        var le = body.indexOf('\n', vi);
        amtLine = body.slice(ls, le < 0 ? body.length : le);
      }
    } else {
      out[f] = raw;
    }
  }
  if (typeof out.amount !== 'number' || typeof out.occurred_at !== 'string') return null;
  // The foreign-currency degrade (see the guard above deriveExtractionTemplate):
  // a mail that speaks a foreign currency where this template would answer VND
  // goes to the currency-aware tiers instead of being misread here.
  if ((out.currency == null || out.currency === 'VND') && _readsForeignCurrency(body, amtLine)) return null;
  return out;
}

function upsertFingerprint(sender, template, isSource, txnType, regex) {
  supabasePost('sender_fingerprints', {
    sender_address: sender,
    subject_template: template,
    is_transaction_source: isSource,
    transaction_type: txnType,
    extraction_regex: regex,
  }, 'sender_address,subject_template'); // on conflict, upsert
}

// ---------- Sender authenticity ----------
//
// Routing (+tag) answers "whose queue is this?" — it does NOT answer "is this
// real?". Anyone who learns a user's alias can post a hand-written "MB Bank"
// email to it and, before these checks, it would stage like any other
// transaction. Human review is a seatbelt, not a lock: approval fatigue is
// real, and a fake row that looks ordinary is exactly what gets waved through.
//
// Two independent signals, both already computed for us before the message
// lands, both free to read:
//
//   1. DKIM — the bank cryptographically signs its own outbound mail. Gmail
//      verifies that signature on arrival and records the verdict in the
//      Authentication-Results header. A forger cannot produce the bank's
//      signature, so "dkim=pass with header.d under the sender's domain" is a
//      genuine authenticity proof, not a heuristic. Survives forwarding intact
//      (unlike SPF, which is exactly why forwarded mail trips spam filters).
//
//   2. X-Forwarded-For — Gmail stamps the forwarding account on auto-forwarded
//      mail. Compared against mailbox_connections.personal_email (captured at
//      onboarding while the user was authenticated), this proves the message
//      came through the mailbox the alias was issued for, rather than being
//      posted straight at the alias by someone who learned it.
//
// ROLLOUT: advisory by default. Both verdicts are recorded on every row, but
// nothing is blocked until SENDER_AUTH_ENFORCE is set to 'true' in Script
// Properties. A check that can reject real transactions should earn its
// enforcement on observed data first — some banks legitimately sign with an ESP
// domain, and not every forwarding path stamps X-Forwarded-For. Watch the
// recorded verdicts, then turn it on.

function senderAuthEnforced() {
  return PropertiesService.getScriptProperties().getProperty('SENDER_AUTH_ENFORCE') === 'true';
}

function _domainOf(address) {
  var m = String(address || '').match(/@([^@>\s]+)/);
  return m ? m[1].toLowerCase().replace(/\.$/, '') : null;
}

// true when signing domain == sender domain, or is a parent of it
// (mb.com.vn signing mail from mbebanking.mb.com.vn is legitimate).
function _domainAligned(signingDomain, senderDomain) {
  if (!signingDomain || !senderDomain) return false;
  if (signingDomain === senderDomain) return true;
  return senderDomain.length > signingDomain.length &&
         senderDomain.slice(-(signingDomain.length + 1)) === '.' + signingDomain;
}

function checkSenderAuthenticity(message, sender) {
  var results = { dkim: 'unknown', forwarder: 'unknown', ok: true, reasons: [] };

  // ── DKIM ──
  var authResults = '';
  try { authResults = message.getHeader('Authentication-Results') || ''; } catch (e) { /* header absent */ }
  if (!authResults) {
    results.dkim = 'absent';
    results.reasons.push('no Authentication-Results header');
  } else {
    var m = authResults.match(/dkim=(\w+)/i);
    var verdict = m ? m[1].toLowerCase() : null;
    // Gmail reports the signing identity as header.i=@domain at least as often
    // as header.d=domain; accepting only the latter made every real message look
    // misaligned. header.i carries a leading @ (and may be a full address).
    var dm = authResults.match(/header\.d=([^\s;]+)/i);
    var signing = dm ? dm[1].toLowerCase() : null;
    if (!signing) {
      var im = authResults.match(/header\.i=@?([^\s;]+)/i);
      if (im) {
        signing = im[1].toLowerCase();
        var at = signing.lastIndexOf('@');
        if (at !== -1) signing = signing.slice(at + 1);   // user@domain -> domain
      }
    }
    if (verdict !== 'pass') {
      results.dkim = 'fail';
      results.reasons.push('dkim=' + (verdict || 'missing'));
    } else if (!_domainAligned(signing, _domainOf(sender))) {
      // Signed, but by someone else — common for legitimate ESP-sent mail, which
      // is why this is recorded rather than fatal until enforcement is on.
      results.dkim = 'misaligned';
      results.reasons.push('dkim=pass but header.d=' + signing + ' != sender ' + _domainOf(sender));
    } else {
      results.dkim = 'pass';
    }
  }

  // ── forwarder ──
  var mailbox = resolveMailbox(message);
  var fwd = '';
  try { fwd = message.getHeader('X-Forwarded-For') || ''; } catch (e2) { /* header absent */ }

  // HAND-forward detection. Gmail stamps X-Forwarded-For only on AUTO-forwards,
  // so its absence together with a From: that IS the alias owner identifies the
  // case exactly: the person pressed Forward themselves.
  //
  // This is named rather than lumped in with a failure because of a trap in the
  // DKIM block above. A hand-forward is genuinely signed by the forwarder's own
  // domain, and the sender genuinely IS the forwarder — so DKIM reports PASS.
  // That pass authenticates the WRAPPER, not the bank: the bank's content is now
  // quoted body text that the forwarder could have typed. A hand-forward is
  // therefore structurally unauthenticatable, and recording it as 'pass' would
  // claim a verification nobody performed.
  var senderAddr = String(extractEmailAddress(String(sender || ''))).toLowerCase();
  var ownerAddr = String((mailbox && mailbox.personal_email) || '').toLowerCase();
  var isManual = !!(ownerAddr && !fwd && senderAddr === ownerAddr);
  results.forward_mode = fwd ? 'auto' : (isManual ? 'manual' : 'unknown');
  if (isManual) results.dkim_authenticates = 'forwarder_not_bank';

  if (!mailbox) {
    results.forwarder = 'no_mailbox';
    results.reasons.push('alias not found in mailbox_connections');
  } else if (isManual) {
    // Deliberately not 'pass'. Enforcement therefore blocks hand-forwards by
    // default — a decision, not an accident. Allowing them means accepting bank
    // content nobody can verify; see pipeline/README.md.
    results.forwarder = 'manual';
    results.reasons.push('hand-forwarded by ' + senderAddr +
      ' — bank content is unverified quoted text, not a signed bank message');
  } else if (!fwd) {
    results.forwarder = 'absent';
    results.reasons.push('no X-Forwarded-For header');
  } else if (!mailbox.personal_email) {
    // No address on file is NOT a pass. The old fall-through meant an alias
    // with a null personal_email accepted ANY forwarder the moment enforcement
    // turned on, while genuine hand-forwards were blocked — exactly backwards.
    // 'unknown' keeps it advisory-visible now and fail-closed under enforcement.
    results.forwarder = 'unknown';
    results.reasons.push('no forwarding address on file for this alias');
  } else if (fwd.toLowerCase().indexOf(String(mailbox.personal_email).toLowerCase()) === -1) {
    results.forwarder = 'mismatch';
    results.reasons.push('forwarded by ' + fwd + ', alias belongs to ' + mailbox.personal_email);
  } else {
    results.forwarder = 'pass';
  }

  results.ok = (results.dkim === 'pass' && results.forwarder === 'pass');
  return results;
}

// ---------- Stage 2 helpers ----------

function findDuplicate(amount, direction, occurredAt, sourceProvider, currency, memberId) {
  if (!amount || !occurredAt) return null;
  /* SCOPE TO THE OWNER. This query runs on the SERVICE ROLE key, which bypasses
     RLS entirely, and it carried no member filter — so it compared the incoming
     row against every staged row of every member of every FAMILY. Trang found it
     from three live flags: her Vietcombank rows matched against a different
     member's MB rows, purely because the amounts agreed within three days.

     Two people spending the same amount in the same week is ordinary, not
     evidence. And a genuine cross-source pair always lands on ONE member: the
     bank notice and the merchant receipt both arrive at that member's own alias.
     So member scope is not a safety net bolted on, it is the correct scope.

     An unrouted row (member_id null) is deduped against nothing. It has no owner,
     0058 shows it to no one, and matching it to a real member's row would let a
     row nobody can see suppress one somebody is waiting for. */
  if (!memberId) return null;
  var occurred = new Date(occurredAt);
  var windowStart = new Date(occurred.getTime() - DEDUPE_WINDOW_DAYS * 86400000).toISOString();
  var windowEnd = new Date(occurred.getTime() + DEDUPE_WINDOW_DAYS * 86400000).toISOString();

  // Only cross-source matches count as duplicates (e.g. a bank email and a merchant
  // receipt for the same purchase). Two emails from the SAME provider are never
  // duplicates of each other here — each already carries its own gmail_message_id
  // and reference_number, so same-provider + same-amount + same-day is a real,
  // separate transaction (e.g. two same-amount transfers made minutes apart),
  // not a re-report of one event.
  //
  // Two query shapes, one semantics. Sealed rows have no amount column, so with
  // sealing on the match key is dedup_fp — the keyed fingerprint every row gets
  // at insert (0068; Trang's 2026-08-16 decision that dedup stays server-side,
  // superseding the move-client-side plan). While sealing is off, the amount
  // query keeps matching rows from before dedup_fp existed.
  //
  // The provider comparison happens in the LOOP below rather than as a `neq`
  // query filter, because PostgREST can only compare the raw strings and the
  // raw strings are exactly what is unreliable. See canonicalProvider below.
  var filters = {
    occurred_at: 'gte.' + windowStart,
    duplicate_of_id: 'is.null',
    member_id: 'eq.' + memberId,
  };
  if (sealedStagingEnabled()) {
    filters.dedup_fp = 'eq.' + dedupFingerprint(amount, direction, currency);
  } else {
    filters.amount = 'eq.' + amount;
    filters.direction = 'eq.' + direction;
  }
  var rows = supabaseGet('email_transactions', filters);
  var mine = canonicalProvider(sourceProvider);
  var earliest = null;
  for (var i = 0; i < rows.length; i++) {
    if (rows[i].occurred_at > windowEnd) continue;
    var theirs = canonicalProvider(rows[i].source_provider);
    if (theirs === mine) continue;          // same bank → a real separate transaction
    // Unknown on either side: refuse to guess. A missed duplicate costs the
    // reviewer one tap to skip it; a false duplicate removes a real transaction
    // from the queue AND skips its notification, silently. Those two failures are
    // not comparable, so the tie goes to keeping the row.
    if (!theirs || !mine) continue;
    if (!earliest || rows[i].created_at < earliest.created_at) earliest = rows[i];
  }
  return earliest;
}

// ---------- sealed staging (SEALED-STAGING-DESIGN.md §4.3, 0065 + 0068) ----------

// Keyed dedup fingerprint. HMAC-SHA256 over 'v1|amount|direction|currency',
// keyed by DEDUP_FP_KEY — minted once, lives in Script Properties (Google's
// trust domain), NEVER in Supabase. That split is the whole construction: a
// database attacker holds fingerprints they cannot run a VND dictionary
// against, which is the attack that made an unkeyed index unshippable (§7).
// What equal fingerprints still reveal — that two rows share an amount and
// direction — is accepted and recorded in 0068's column comment.
// Provider is left out on purpose: cross-source is decided in findDuplicate's
// loop on CANONICAL provider names (canonicalProvider), so a fingerprint that
// fragmented on the raw spelling would reintroduce the same-bank bug there.
var _DEDUP_FP_KEY_PROP = 'DEDUP_FP_KEY';

function dedupFingerprint(amount, direction, currency) {
  var props = PropertiesService.getScriptProperties();
  var keyB64 = props.getProperty(_DEDUP_FP_KEY_PROP);
  if (!keyB64) {
    // Same minting pattern as the DRBG seed: platform CSPRNG via UUIDs, folded
    // through SHA-256. Losing this key only costs dedup continuity (old
    // fingerprints stop matching new ones) — nothing becomes readable.
    var material = '';
    for (var i = 0; i < 8; i++) material += Utilities.getUuid() + ':' + i + ';';
    keyB64 = Utilities.base64Encode(
      Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, material, Utilities.Charset.UTF_8));
    props.setProperty(_DEDUP_FP_KEY_PROP, keyB64);
  }
  var msg = 'v1|' + amount + '|' + direction + '|' + (currency || '');
  var mac = Utilities.computeHmacSha256Signature(
    Utilities.newBlob(msg).getBytes(), Utilities.base64Decode(keyB64));
  return Utilities.base64Encode(mac);
}

// member_id -> family_id -> staging_pub, cached per execution. Globals in Apps
// Script live for one execution only, so this never goes stale across runs.
var _FAMILY_ID_CACHE = {};
var _STAGING_PUB_CACHE = {};

function familyIdForMember(memberId) {
  if (_FAMILY_ID_CACHE[memberId] !== undefined) return _FAMILY_ID_CACHE[memberId];
  var rows = supabaseGet('members', { id: 'eq.' + memberId, select: 'family_id' });
  var fid = rows.length ? rows[0].family_id : null;
  _FAMILY_ID_CACHE[memberId] = fid;
  return fid;
}

function stagingPubForFamily(familyId) {
  if (_STAGING_PUB_CACHE[familyId] !== undefined) return _STAGING_PUB_CACHE[familyId];
  var rows = supabaseGet('family_keys', { family_id: 'eq.' + familyId, select: 'staging_pub' });
  var pub = (rows.length && rows[0].staging_pub) || null;
  _STAGING_PUB_CACHE[familyId] = pub;
  return pub;
}

// Turns a plaintext staging row into its sealed form, or returns null meaning
// HOLD — leave the message queued and try again next run. Null is the ONLY
// failure shape: there is no code path from "could not seal" to a plaintext
// insert, which is the invariant the whole feature stands on.
//
// Holds, and why each one is a hold and not a parse-failure:
//   • no family / no staging key — a keyless family cannot receive sealed rows
//     and must never receive plaintext ones. Connect gates on key provisioning
//     (71-mailbox-ui), so in practice this is a startup-ordering safety net.
//   • sealed-box.gs or TweetNaCl not pasted into the Apps Script project —
//     a deploy mistake; the mail is fine.
//   • SEALED_BOX_PIN_MISMATCH — the family key CHANGED under TOFU. Possibly a
//     legitimate rotation, possibly an interception attempt (§6). Either way,
//     sealing to the new key would hand rows to whoever holds it, and a
//     parse-failure would dump metadata about mail we deliberately did not
//     process. Hold, log CRITICAL, let a human look.
function trySealRow(row) {
  if (typeof sealForFamily === 'undefined' || typeof nacl === 'undefined') {
    Logger.log('CRITICAL: sealing is ON but sealed-box.gs/TweetNaCl are not in this project — holding ' +
      row.gmail_message_id);
    return null;
  }
  var familyId = familyIdForMember(row.member_id);
  if (!familyId) {
    Logger.log('sealing: no family for member ' + row.member_id + ', holding ' + row.gmail_message_id);
    return null;
  }
  var pub = stagingPubForFamily(familyId);
  if (!pub) {
    Logger.log('sealing: family ' + familyId + ' has no staging key yet, holding ' + row.gmail_message_id);
    return null;
  }
  try {
    assertFamilyPubPinned(familyId, pub);
    // Everything sensitive rides INSIDE the box, flat, because the client's
    // sealed branch reads payload.amount and payload.memo alike (72-txn-review
    // fhReadStagedRow). raw_body is deliberately NOT in the payload — nothing
    // ever reads it back, it is ~20KB of dead ciphertext per row, and the
    // source email stays in Gmail for the retention window if debugging needs
    // it. (Deviation from the §3 payload list, recorded in AGENT_SYNC.)
    var payload = Object.assign({}, row.raw_extracted, {
      amount: row.amount,
      currency: row.currency,
      direction: row.direction,
      counterparty: row.counterparty,
      reference_number: row.reference_number,
      transaction_type: row.transaction_type,
    });
    var envelope = sealForFamily(payload, pub, familyId, row.gmail_message_id);
    return {
      gmail_message_id: row.gmail_message_id,
      source_provider: row.source_provider,
      occurred_at: row.occurred_at,
      review_status: row.review_status,
      duplicate_of_id: row.duplicate_of_id,
      member_id: row.member_id,
      dedup_fp: row.dedup_fp,
      sealed: envelope.sealed,
      eph_pub: envelope.eph_pub,
      nonce: envelope.nonce,
      enc_v: envelope.enc_v,
    };
  } catch (e) {
    Logger.log('CRITICAL: sealing failed for ' + row.gmail_message_id + ' — holding. ' + e);
    return null;
  }
}

// Manual preflight — run by hand from the editor BEFORE flipping
// SEALED_STAGING_ENABLED, and read the log. Read-only: mints nothing, seals
// nothing, changes nothing. Answers the four questions that decide whether the
// flip is safe: is the code all here, are the keys all minted, does every
// connection's family hold a staging key, and do the pins agree.
function sealingPreflight() {
  Logger.log('preflight v' + PIPELINE_VERSION +
    ' | SEALED_STAGING_ENABLED=' + PropertiesService.getScriptProperties().getProperty('SEALED_STAGING_ENABLED') +
    ' | nacl=' + (typeof nacl !== 'undefined') +
    ' | sealed-box.gs=' + (typeof sealForFamily !== 'undefined') +
    ' | drbg_seed=' + !!PropertiesService.getScriptProperties().getProperty('SEALED_BOX_DRBG_SEED') +
    ' | dedup_key=' + !!PropertiesService.getScriptProperties().getProperty(_DEDUP_FP_KEY_PROP));
  var conns = supabaseGet('mailbox_connections', { select: 'forwarding_alias,member_id' });
  for (var i = 0; i < conns.length; i++) {
    var fid = familyIdForMember(conns[i].member_id);
    var pub = fid ? stagingPubForFamily(fid) : null;
    var pin = fid ? PropertiesService.getScriptProperties().getProperty('FAMILY_PUB_PIN_' + fid) : null;
    var pinState = 'none';
    if (pin && pub) {
      var digest = Utilities.base64Encode(
        Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, pub, Utilities.Charset.UTF_8));
      pinState = (pin === digest) ? 'match' : 'MISMATCH';
    }
    Logger.log('preflight | ' + conns[i].forwarding_alias +
      ' | family=' + (fid || 'MISSING') +
      ' | staging_pub=' + (pub ? 'present' : 'MISSING') +
      ' | pin=' + pinState);
  }
}

// Two spellings of one bank are not two sources.
//
// `source_provider` is free text straight from the extractor, and a single bank
// arrives as 'MB', 'MBBank' and 'MB eBanking' depending on which email template
// it came from. The cross-source rule above compares providers, so those three
// spellings made genuinely separate MB transactions look like one event reported
// by three different sources — and a row marked duplicate is filtered out of the
// review queue AND skipped by queueReviewNotice. The transaction vanished and
// nothing anywhere said so. Observed 2026-08-16 on three same-day MB rows, one of
// which disappeared.
//
// Canonicalising strips case, punctuation and accents, then the channel words
// that vary per template but never identify the bank. 'MB' / 'MBBank' /
// 'MB eBanking' all reduce to 'mb'; 'Vietcombank' to 'vietcom'; 'MSB' stays 'msb'
// because it contains no channel word — banks are only ever merged when what is
// left after stripping is genuinely identical.
function canonicalProvider(name) {
  if (!name) return '';
  var s = String(name).toLowerCase();
  // Accents first, so 'Kỹ Thương' and 'Ky Thuong' are one bank.
  // Escaped, not literal combining marks: this file is deployed by hand-pasting
  // and invisible characters do not survive that reliably.
  if (s.normalize) s = s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  s = s.replace(/[^a-z0-9]/g, '');
  // Longest first: strip 'ebanking' before 'banking' can leave a stray 'e' behind.
  var NOISE = ['internetbanking', 'mobilebanking', 'onlinebanking', 'smartbanking',
               'ebanking', 'digibank', 'banking', 'ebank', 'bank', 'jsc'];
  for (var i = 0; i < NOISE.length; i++) s = s.split(NOISE[i]).join('');
  return s;
}

// ---------- memo tidying ----------
//
// What a bank writes in "Nội dung chuyển tiền" is usually not what the money was
// FOR. Measured against a real corpus (11 samples, MB + VCB, 2026-08-14) there
// are three shapes and only one of them is worth showing a person:
//
//   NGUYEN THU TRANG chuyen tien              bank auto-fill    → say nothing
//   Thu Trang chuyen khoan nhanh qua Zalo     app auto-fill     → say nothing
//   email trans live  iu anh                  a human wrote it  → KEEP
//   MB.5153-…20260814.NAP TIEN DIEN THOAI.0944684991.MOBILETOPUP.…   → extract
//
// The auto-fills are the dangerous case, not the structured reference. They pass
// any "looks like prose" test — spaces, letters, several words — while carrying
// nothing, and 72-txn-review.js already says why that is worse than blank: a
// pre-filled wrong answer gets accepted rather than corrected.
//
// Detecting them needs no dictionary. Remove the account holder's own name (the
// email states it) and the generic banking verbs, and see whether anything is
// left. That generalises across banks — it caught VCB's "CAO THAI DUY HIEN
// chuyen tien" without knowing that name in advance.
//
// Runs locally on plaintext already in hand: no LLM, no network, and identical
// before or after sealing.

var MEMO_FILLER = ['chuyen tien', 'chuyen khoan', 'thanh toan', 'nhanh', 'qua zalo',
  'qua momo', 'ck', 'tt', 'transfer', 'payment'];
// Payment aggregators that prefix the merchant that was actually paid.
var MERCHANT_AGGREGATOR_RE = /^(MPOS|PAYOO|VNPAY|MOMO|ZALOPAY|SHOPEEPAY|NAPAS)[\s*_-]+/i;

function _memoNorm(s) { return deburrAscii(s).toLowerCase().replace(/\s+/g, ' ').trim(); }
function deburrAscii(s) {
  return String(s == null ? '' : s).normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D');
}

function _isRefSegment(seg) {
  var s = String(seg || '').trim();
  if (!s) return true;
  if (/^\d+$/.test(s)) return true;                  // pure digits, incl. dates/times
  if (/^[A-Z]{2,3}$/.test(s)) return true;           // bank code
  if (/\d/.test(s) && !/\s/.test(s)) return true;    // alphanumeric reference
  return false;
}

// A structured reference carries BOTH a prose part and a machine type code.
// The code (MOBILETOPUP, POS, ATM…) is a closed vocabulary the banks publish and
// a better category signal than any keyword guess — it is a fact about the
// transaction, not about the family, so it can be shared freely.
function splitStructuredMemo(raw) {
  var segs = String(raw || '').split(/[.|_]/).map(function (x) { return x.trim(); })
    .filter(function (x) { return x; });
  if (segs.length < 3) return { prose: raw, code: null };
  var kept = segs.filter(function (s) { return !_isRefSegment(s); });
  var words = kept.filter(function (s) { return /\s/.test(s); })
    .sort(function (a, b) { return b.length - a.length; });
  var codes = kept.filter(function (s) { return !/\s/.test(s) && /^[A-Z]{4,}$/.test(s); })
    .sort(function (a, b) { return b.length - a.length; });
  var longest = kept.slice().sort(function (a, b) { return b.length - a.length; })[0];
  return { prose: words[0] || longest || raw, code: codes[0] || null };
}

// Which leading words of the memo are the account holder's name?
//
// The name is never in the extraction schema, and adding it would mean a new LLM
// field plus a template anchor for something the email already states three
// different ways ("Tài khoản trích nợ", "Tên người chuyển tiền", "Kính gửi Quý
// khách"). Instead, use the property that distinguishes a name from a message:
// the holder's name appears ELSEWHERE in the email as well, while the words
// someone typed appear once. So a leading n-gram occurring twice or more in the
// body is the name; "email trans live" occurs once and survives.
function _repeatedLeadingName(prose, body) {
  var nb = _memoNorm(body);
  var words = _memoNorm(prose).split(' ').filter(function (w) { return w; });
  for (var n = Math.min(4, words.length); n >= 2; n--) {
    var gram = words.slice(0, n).join(' ');
    if (!gram) continue;
    var hits = nb.split(gram).length - 1;
    if (hits >= 2) return gram;
  }
  return '';
}

function isMemoBoilerplate(text, body) {
  var t = _memoNorm(text);
  var name = _repeatedLeadingName(text, body || '');
  if (name) t = t.split(name).join(' ');
  MEMO_FILLER.forEach(function (f) { t = t.replace(new RegExp('\\b' + f + '\\b', 'g'), ' '); });
  return t.split(/\s+/).filter(function (w) { return w.length > 1; }).length < 2;
}

// Returns {description, code}. description '' means "this memo says nothing" —
// the caller falls back to the counterparty, exactly as it does for a memo-less
// card purchase. The raw memo is never modified; it stays in raw_extracted.
function tidyMemo(raw, body) {
  if (!raw) return { description: '', code: null };
  var split = splitStructuredMemo(raw);
  if (isMemoBoilerplate(split.prose, body)) return { description: '', code: split.code };
  return { description: String(split.prose).replace(/\s+/g, ' ').trim(), code: split.code };
}

// Strips the aggregator prefix so "MPOS*QUICK SAVE MARKET" reads as the shop the
// person actually visited. Deliberately does NOT try to derive a brand key:
// tested against the corpus, no token-count rule can find the boundary between
// brand and branch — AEON is one word, QUICK SAVE MARKET is three, and nothing in
// the string says which. Grouping branches needs a merchant dictionary, not a
// heuristic; until that exists the full string stays the learning key.
function tidyMerchant(raw) {
  return String(raw || '').replace(MERCHANT_AGGREGATOR_RE, '').replace(/\s+/g, ' ').trim();
}

// Adds memo_display + type_code without touching memo. Both are additive, so an
// older client that knows nothing about them keeps working unchanged.
function _withTidyMemo(extraction, body) {
  var tidy = tidyMemo(extraction && extraction.memo, body);
  var out = {};
  for (var k in extraction) out[k] = extraction[k];
  out.memo_display = tidy.description;
  if (tidy.code) out.type_code = tidy.code;
  return out;
}

function buildEmailTransactionRow(gmailMessageId, sender, extraction, body, dup, memberId) {
  return {
    gmail_message_id: gmailMessageId,
    transaction_type: extraction.transaction_type,
    source_provider: extraction.source_provider,
    occurred_at: extraction.occurred_at,
    amount: extraction.amount,
    currency: extraction.currency,
    direction: extraction.direction,
    counterparty: tidyMerchant(extraction.counterparty) || extraction.counterparty,
    reference_number: extraction.reference_number,
    raw_body: body,
    // memo stays exactly as extracted; the tidied reading is added alongside it,
    // so a misjudged heuristic is always recoverable from the original.
    raw_extracted: _withTidyMemo(extraction, body),
    review_status: 'pending',
    duplicate_of_id: dup ? dup.id : null,
    member_id: memberId,  // null if unresolved — row still gets written, just orphaned until a mailbox_connections match exists
  };
}

function insertEmailTransaction(row) {
  return supabasePost('email_transactions', row, null);
}

// Has this exact Gmail message already been staged? Selects one column by the
// unique key, so the answer costs almost nothing on a table of any size.
//
// A throw here is deliberately NOT swallowed: if Supabase is unreachable we must
// not conclude "not staged" and go on to extract and insert a second copy. The
// SUPABASE_ token carries it up to processEmails, which leaves the message
// queued for the next run.
function isAlreadyStaged(gmailMessageId) {
  if (!gmailMessageId) return false;
  var rows = supabaseGet('email_transactions', {
    gmail_message_id: 'eq.' + gmailMessageId,
    select: 'id',
  });
  return rows.length > 0;
}

// Queue a review notice for a row that will ACTUALLY appear in the review queue.
// Called by the caller only after the insert is confirmed — counting inside
// insertEmailTransaction promised a banner even when the write failed, and
// supabasePost returns PostgREST's error OBJECT on failure (truthy), which is the
// trap SEALED-STAGING-DESIGN.md §8 warns about.
//
// One row is silently excluded: no member_id — unrouted, so 0058 shows it to
// nobody. There is no audience, so there is no banner.
//
// duplicate_of_id USED to be excluded too, and the reason was sound at the time:
// fhFetchStagedTxns filtered merged duplicates out, so notifying for one promised
// a queue entry that did not exist, and a notification opening an empty screen is
// the cry-wolf this design goes out of its way to avoid.
//
// That premise is gone. The client stopped treating the flag as a delete order —
// a guess made blind here, with no human present, was hiding real transactions —
// so a flagged row now DOES appear in the queue, in its "possible duplicate"
// section, for a person to accept or skip. Excluding it from the count is what
// would lie: a row arrives and nothing says so.
//
// Worth noting the comment this replaces anticipated the failure and guessed the
// wrong route: it expected duplicate_of_id to stop being SET once dedup moved
// client-side. It is still set. What moved was who gets to act on it.
//
// member_id survives sealing (§3 luggage tag). Nothing here reads a field that
// becomes ciphertext.
function queueReviewNotice(row) {
  if (!row || !row.member_id) return;
  _PENDING_NOTIFY[row.member_id] = (_PENDING_NOTIFY[row.member_id] || 0) + 1;
}

// ---------- review notifications ----------
//
// Counted per run, sent once at the end. The trigger fires every minute and a
// forwarding burst can stage several rows in one pass; notifying per insert
// would put five identical banners in the tray for one trip to the shop.
//
// Only the OWNING member is told. Staged rows are scoped to their own member
// (0058) — telling the family that someone has a bank transaction waiting would
// leak the thing that policy exists to keep private, and would not reach the one
// person who can act on it.
var _PENDING_NOTIFY = {};

/* Batching ACROSS runs, not just within one.
 *
 * The trigger fires every minute and each firing is a FRESH script execution, so
 * `_PENDING_NOTIFY` above only ever batches the rows of a single run. That was
 * enough for a forwarding burst that lands in one pass, and wrong for a queue
 * that drains one message per minute: thirty minutes of catching up sent thirty
 * banners, each saying "1", none saying how many were waiting. The direct-read
 * worker was given exactly this fix on 2026-08-30 (it stays silent while a
 * backfill runs and speaks once at the end); this is the same rule for the
 * transport that never got it.
 *
 * The rule is a LEADING-EDGE cooldown, and the leading edge is the load-bearing
 * half. A trailing-edge version was written first — hold everything, send when a
 * run goes quiet — and it was wrong: it delayed EVERY notification by a trigger
 * cycle, including the ordinary case of one mail arriving on a quiet afternoon.
 * The existing suite caught it, because it already pinned "a burst of 5 sends
 * ONE notification" on the same run. Quietening a storm must not slow the
 * common case down.
 *
 *   nothing sent recently  -> send NOW, with everything held
 *   inside the cooldown    -> add to the held total, say nothing
 *   cooldown expires       -> the held total goes out on the next run
 *
 * No notion of "backfill" is needed, and none is added: this file has none and
 * should not grow one. A drain and a burst look the same to it, which is the
 * point — the rule is about how often a PERSON is interrupted, not about what
 * the pipeline happens to be doing.
 *
 * State lives in Script Properties because a GAS execution keeps nothing
 * between triggers.
 */
var NOTIFY_HOLD_KEY = 'notifyHold:';        // + member_id -> held count since the last send
var NOTIFY_LAST_KEY = 'notifyLast:';        // + member_id -> ms of the last send
var NOTIFY_COOLDOWN_MS = 15 * 60 * 1000;    // at most one banner per member per 15 min

function _num(props, key) {
  var raw = props.getProperty(key);
  if (!raw) return 0;
  var n = Number(raw);
  return isFinite(n) ? n : 0;              // corrupt -> treat as absent
}

/* Every member currently holding rows, whether or not THIS run staged for them.
 * Without this a burst that stops would hold its last rows forever: the send
 * that clears them happens on a later run, which has nothing in
 * `_PENDING_NOTIFY` to iterate. */
function _heldMembers(props) {
  var out = [], all = props.getProperties();
  for (var k in all) {
    if (k.indexOf(NOTIFY_HOLD_KEY) === 0) out.push(k.slice(NOTIFY_HOLD_KEY.length));
  }
  return out;
}

function notifyStagedReviews() {
  var props = PropertiesService.getScriptProperties();
  var now = Date.now();

  // 1. fold this run's rows into whatever is already held
  for (var m in _PENDING_NOTIFY) {
    props.setProperty(NOTIFY_HOLD_KEY + m,
      String(_num(props, NOTIFY_HOLD_KEY + m) + _PENDING_NOTIFY[m]));
  }
  _PENDING_NOTIFY = {};

  // 2. who is off cooldown. A member never notified has last = 0, so their
  //    first row goes out on the run that staged it — no delay on the ordinary
  //    case of one mail arriving.
  var members = [], candidates = _heldMembers(props);
  for (var c = 0; c < candidates.length; c++) {
    var id = candidates[c];
    if (_num(props, NOTIFY_HOLD_KEY + id) <= 0) { props.deleteProperty(NOTIFY_HOLD_KEY + id); continue; }
    if (now - _num(props, NOTIFY_LAST_KEY + id) >= NOTIFY_COOLDOWN_MS) members.push(id);
  }
  if (!members.length) return;

  var base = props.getProperty('SUPABASE_URL');
  var key = props.getProperty('SUPABASE_SERVICE_ROLE_KEY');
  for (var i = 0; i < members.length; i++) {
    var count = _num(props, NOTIFY_HOLD_KEY + members[i]);
    try {
      // Deliberately no amount, merchant or bank name in the body — push transits
      // a third party, and once sealing is on the robot cannot read those values
      // anyway. The function composes count-only copy from this.
      var resp = UrlFetchApp.fetch(base + '/functions/v1/push-send', {
        method: 'post',
        contentType: 'application/json',
        headers: { Authorization: 'Bearer ' + key },
        payload: JSON.stringify({ kind: 'txn_review', member_id: members[i], count: count }),
        muteHttpExceptions: true,
      });
      Logger.log('notify ' + members[i] + ' x' + count + ' -> HTTP ' +
        resp.getResponseCode() + ' ' + String(resp.getContentText() || '').slice(0, 120));
    } catch (e) {
      // A failed notification must never cost a staged row: the transaction is
      // already written and will be reviewed whenever the app is next opened.
      Logger.log('notify failed for ' + members[i] + ': ' + e);
    }
    /* Cleared whether the send succeeded or not, and deliberately. Holding a
       failed count would re-send it every run for as long as push-send stays
       unreachable — a notification storm caused by the code that exists to
       prevent one. The rows are staged and the app shows them on open, so the
       cost of dropping one banner is a late look, not a lost transaction.
       The cooldown is stamped for the same reason: a send that threw still
       COUNTS as an attempt, or a broken push endpoint would retry every run. */
    props.deleteProperty(NOTIFY_HOLD_KEY + members[i]);
    props.setProperty(NOTIFY_LAST_KEY + members[i], String(now));
  }
}

// Resolves which family member this email belongs to via the +tag on the receiving
// address (e.g. 'trang' from gichisreading+trang@gmail.com) — storage only, not used
// for any promotion decision. Returns null if the tag is missing or unrecognized;
// the row still gets written, just without routing info until mailbox_connections
// has a matching entry.
function resolveMailbox(message) {
  var tags = extractPlusTags(recipientForRouting(message));
  for (var i = 0; i < tags.length; i++) {
    var rows = supabaseGet('mailbox_connections', { forwarding_alias: 'eq.' + tags[i] });
    if (rows.length) return rows[0];
  }
  return null;
}

function resolveMemberId(message) {
  var mailbox = resolveMailbox(message);
  return mailbox ? mailbox.member_id : null;
}

// Which address did this actually arrive at?
//
// Gmail forwarding preserves the ORIGINAL To: header — it still reads
// trang.nguyen.wh@gmail.com, not the alias — and only records the real
// destination in Delivered-To. Reading To: therefore finds no +tag on exactly
// the mail this pipeline exists to process, which is what happened on the first
// real end-to-end run. (Google's own confirmation email is a special case: it is
// addressed directly to the alias, so To: worked there and hid the bug.)
function recipientForRouting(message) {
  var candidates = ['Delivered-To', 'X-Forwarded-To', 'X-Original-To'];
  for (var i = 0; i < candidates.length; i++) {
    try {
      var v = message.getHeader(candidates[i]);
      if (v && v.indexOf('+') !== -1) return v;
    } catch (e) { /* header absent */ }
  }
  return message.getTo() || '';
}

function extractPlusTag(toHeader) {
  var all = extractPlusTags(toHeader);
  return all.length ? all[0] : null;
}

// A forwarded message can carry SEVERAL aliases in one header — mail that passed
// through two forwarding rules shows up as
//   "gichisreading+trang@gmail.com, gichisreading+8xr4ed9vr8@gmail.com, ..."
// Taking the first meant an old, retired alias shadowed the live one and the
// message was held as unroutable. Return them all; the caller picks the one it
// actually knows.
function extractPlusTags(header) {
  var out = [];
  var re = /\+([^@,\s]+)@/g;
  var m;
  while ((m = re.exec(String(header || ''))) !== null) {
    if (out.indexOf(m[1]) === -1) out.push(m[1]);
  }
  return out;
}

function markMailboxVerified(alias) {
  try {
    supabasePatch('mailbox_connections', { forwarding_alias: 'eq.' + alias }, { verified: true });
    Logger.log('mailbox ' + alias + ' verified by a real forwarded message');
  } catch (e) {
    // Cosmetic only — the transaction still processes. Next message retries.
    Logger.log('could not mark ' + alias + ' verified: ' + e);
  }
}

function insertParseFailure(message, reason) {
  // No raw_body — deliberately (0068). Storing the full plaintext email on
  // every failure was a side door around whatever the sealed table protects
  // (SEALED-STAGING-DESIGN §7). The email itself is still in Gmail, labelled
  // txn/parse-failed, which the retention sweep never touches — so debugging a
  // failure means opening the mailbox, an auditable act, not SELECTing a table.
  supabasePost('parse_failures', {
    gmail_message_id: message.getId(),
    sender: extractEmailAddress(message.getFrom()),
    subject: message.getSubject(),
    error_reason: reason,
  }, null);
}

// Promotion into the real `transactions` table is NOT done here. Category can't be
// inferred from sender+subject (one sender's transactions span many real categories —
// see 0026_bank_email_categorization.sql), so every promotion needs a human to pick a
// category on that specific transaction. This script's job stops at writing the
// pending row to email_transactions (with member_id resolved for routing, see
// resolveMemberId below); promotion is a separate, not-yet-built review flow.

// ---------- Isolated test: Stage 1 extraction only, no Supabase involved ----------
// Run this manually from the Apps Script editor (select function, Run) before ever
// running processEmails(). Only needs ANTHROPIC_API_KEY in Script Properties — proves
// the Haiku call + JSON schema work against a real email before wiring in Supabase.
function testHaikuOnRealEmail() {
  var threads = GmailApp.search('from:mbebanking@mbbank.com.vn newer_than:1d');
  if (threads.length === 0) {
    Logger.log('No MB Bank test email found — adjust the search or trigger a fresh transaction first.');
    return;
  }
  var message = threads[0].getMessages()[0];
  var sender = extractEmailAddress(message.getFrom());
  var subject = message.getSubject();
  var body = message.getPlainBody();

  Logger.log('Sender: ' + sender);
  Logger.log('Subject: ' + subject);

  var result = classifyAndExtractViaHaiku(sender, subject, body);
  Logger.log('Extraction result:\n' + JSON.stringify(result, null, 2));

  // Compare against the expected shape documented in bank-email-pipeline-extraction.md
  // ("Expected output on the two real samples") — is_transaction should be true,
  // transaction_type 'bank_txn', amount/currency/direction/counterparty/reference_number
  // all populated, status 'success'.
}

// Same test, Gemini path — only needs GEMINI_API_KEY in Script Properties.
function testGeminiOnRealEmail() {
  var threads = GmailApp.search('from:mbebanking@mbbank.com.vn newer_than:1d');
  if (threads.length === 0) {
    Logger.log('No MB Bank test email found — adjust the search or trigger a fresh transaction first.');
    return;
  }
  var message = threads[0].getMessages()[0];
  var sender = extractEmailAddress(message.getFrom());
  var subject = message.getSubject();
  var body = message.getPlainBody();

  Logger.log('Sender: ' + sender);
  Logger.log('Subject: ' + subject);

  var result = classifyAndExtractViaGemini(sender, subject, body);
  Logger.log('Extraction result:\n' + JSON.stringify(result, null, 2));
}


// ============================================================================
// Auto-confirm forwarding verification
//
// When a user tells their Gmail to forward to their alias, Google emails a
// confirmation link to that alias and refuses to forward anything until it is
// clicked. The alias is a +tag on the shared inbox this script is bound to, so
// the confirmation lands somewhere we can already read — meaning we can click
// it for them. That is the whole reason onboarding can promise "we handle the
// confirmation email" instead of "go find an email from Google".
//
// Runs on its own trigger (every 5 min is plenty — this only matters during the
// minutes after someone sets up forwarding), NOT inside processEmails(): these
// confirmations arrive at the inbox unlabelled, and coupling them to the
// transaction loop would mean a failure in one stalls the other.
//
// Idempotent and self-limiting: it only looks at unread confirmations from
// Google, marks each read once handled, and never touches anything else.
// ============================================================================

var FORWARDING_CONFIRM_SENDER = 'forwarding-noreply@google.com';

// A thread carries the label object itself, so this is a local comparison rather
// than another Gmail query.
function _threadHasLabel(thread, label) {
  if (!label) return false;
  var labels = thread.getLabels();
  for (var i = 0; i < labels.length; i++) {
    if (labels[i].getName() === label.getName()) return true;
  }
  return false;
}

// Kept as a standalone entry point for manual runs and debugging. The scheduled
// path does NOT call this — processEmails() folds the same work into its single
// combined search so an idle tick costs one Gmail round trip, not two.
function confirmPendingForwarding() {
  // NOT is:unread. handleForwardingConfirmation relabels to txn/processed, and
  // the label is what marks the work done — read-state does not, because a human
  // opening the confirmation removes it from an is:unread search forever. That
  // is exactly how three real confirmations sat unhandled in the shared inbox on
  // 2026-08-13. Same exclusion the scheduled path in buildInboxQuery() uses.
  var threads = GmailApp.search('from:' + FORWARDING_CONFIRM_SENDER +
    ' newer_than:7d -label:txn/processed -label:txn/parse-failed');
  for (var t = 0; t < threads.length; t++) {
    var messages = threads[t].getMessages();
    for (var m = 0; m < messages.length; m++) {
      try {
        handleForwardingConfirmation(messages[m]);
      } catch (err) {
        // Never let one bad confirmation stop the rest. Left unread so the next
        // run retries — Google's links stay valid for days.
        Logger.log('forwarding confirmation failed for ' + messages[m].getId() + ': ' + err);
      }
    }
  }
}

function handleForwardingConfirmation(message) {
  // Which alias is being confirmed? The confirmation is addressed TO the alias,
  // so the +tag identifies whose setup this is. Without it we cannot attribute
  // the confirmation and must not click blindly — clicking would enable
  // forwarding for an address we cannot account for.
  var alias = extractPlusTag(message.getTo());
  if (!alias) {
    Logger.log('forwarding confirmation with no +tag, ignoring: ' + message.getTo());
    return;
  }

  var rows = supabaseGet('mailbox_connections', { forwarding_alias: 'eq.' + alias });
  if (!rows.length) {
    // A confirmation for an alias we never issued. Do NOT click: that would let
    // anyone who guesses the inbox address get forwarding switched on.
    Logger.log('forwarding confirmation for unknown alias ' + alias + ', ignoring');
    return;
  }

  var link = extractForwardingConfirmLink(message);
  if (!link) {
    Logger.log('no confirmation link found in message ' + message.getId());
    return;
  }

  // Fetching the link is a best-effort nudge, NOT proof of anything. Google
  // answers 200 for an interstitial that still expects a human click, so an
  // earlier version marked the mailbox verified on a bare 200 — and the app
  // cheerfully reported "Connected" while Gmail still showed the address as
  // unverified. Claiming success we cannot observe is worse than failing.
  var response = UrlFetchApp.fetch(link, { muteHttpExceptions: true, followRedirects: true });
  var code = response.getResponseCode();
  var body = String(response.getContentText() || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  Logger.log('confirm fetch for ' + alias + ': HTTP ' + code + ' | ' + body.slice(0, 300));

  // verified is NOT set here. The only trustworthy evidence that forwarding
  // works is a forwarded message actually arriving at this alias, which
  // processOneMessage records when it routes one (see markMailboxVerified).
  // Leaving it false keeps the UI honestly in "waiting" until that happens.
  //
  // Labelled rather than marked read: the label is what the search excludes, so
  // handling survives a human opening the message.
  message.markRead();
  relabelMessageThread(message, 'txn/processed');
}

// Finds the confirmation link in Google's forwarding email.
//
// The real email (captured 2026-08-13) carries TWO links on the same host:
//   confirm:  https://mail-settings.google.com/mail/vf-<token>
//   cancel:   https://mail-settings.google.com/mail/uf-<token>
// The cancel link REVOKES the request. Clicking it instead would silently undo
// the setup the user just completed and present as "forwarding never worked".
// So this matches the /mail/vf- PATH SEGMENT — not merely a URL containing
// "vf-", since those tokens are random and hyphenated and a cancel link's token
// could contain that sequence.
//
// Reads BOTH body formats. The HTML body can break a long URL with tags or
// entities, and the plain body can wrap it across lines; neither is reliable
// alone, so each is tried, plus a tag-stripped variant. The host is not
// hard-coded — assuming
// mail.google.com is what broke the first version in production; Google sends
// these from mail-settings.google.com.
function extractForwardingConfirmLink(message) {
  var candidates = [];
  try { candidates.push(message.getPlainBody() || ''); } catch (e) { /* absent */ }
  try {
    var html = message.getBody() || '';
    candidates.push(html);
    // tags removed, for the case where the link appears only as visible text
    // and markup sits inside it. NOT whitespace-stripped: joining every gap
    // would glue the following prose onto the URL and win on length.
    candidates.push(html.replace(/<[^>]*>/g, '').replace(/&amp;/g, '&'));
  } catch (e2) { /* absent */ }

  // LONGEST match wins, not the first. A URL interrupted by markup or wrapped
  // across lines still matches its opening fragment, so "first match" would
  // happily return a truncated link and we would click something broken. The
  // intact copy is by definition the longest one seen across the variants.
  var re = /https:\/\/[a-z0-9.-]*google\.com\/mail\/vf-[^\s"'<>)]+/i;
  var best = null;
  for (var i = 0; i < candidates.length; i++) {
    var m = String(candidates[i]).replace(/&amp;/g, '&').match(re);
    if (m && (!best || m[0].length > best.length)) best = m[0];
  }
  if (best) return best;

  // Still nothing: report what was actually there so this stops being guesswork.
  // Query strings are stripped — they carry the token, and a working
  // confirmation link must never be written into logs.
  var lens = candidates.map(function (c) { return String(c).length; }).join('/');
  var seen = [];
  for (var j = 0; j < candidates.length && seen.length < 8; j++) {
    var urls = String(candidates[j]).match(/https?:\/\/[^\s"'<>)]+/g) || [];
    for (var k = 0; k < urls.length && seen.length < 8; k++) {
      if (!/google\.com/i.test(urls[k])) continue;
      var u = urls[k].split('?')[0].slice(0, 100);
      if (seen.indexOf(u) === -1) seen.push(u);
    }
  }
  Logger.log('no vf- link. body lengths=' + lens + '; google urls seen: ' +
    (seen.length ? seen.join(' | ') : 'NONE'));
  return null;
}

// ---------- One-off diagnostic ----------
// Run manually from the editor when routing or sender-auth fails on a specific
// message and the reason is not obvious. Prints the header block only — stops at
// the blank line that separates headers from the body, so no transaction content
// reaches the logs. Safe to leave in place; nothing calls it on a schedule.
function debugMessageHeaders() {
  var id = '19ffa1dc1b8fc981';                 // <- the message id from the failing log line
  var m = GmailApp.getMessageById(id);
  if (!m) { Logger.log('no message with id ' + id); return; }

  Logger.log('getTo():        ' + m.getTo());
  Logger.log('getFrom():      ' + m.getFrom());
  ['Delivered-To', 'X-Forwarded-To', 'X-Original-To', 'X-Forwarded-For', 'Authentication-Results']
    .forEach(function (h) {
      var v = '';
      try { v = m.getHeader(h); } catch (e) { v = '<getHeader threw: ' + e + '>'; }
      Logger.log('header ' + h + ': ' + (v === '' ? '<empty>' : v));
    });

  // Ground truth: every header actually present, straight off the wire.
  var raw = m.getRawContent() || '';
  var end = raw.indexOf('\r\n\r\n');
  if (end === -1) end = raw.indexOf('\n\n');
  var headerBlock = end === -1 ? raw.slice(0, 4000) : raw.slice(0, end);
  var names = [];
  headerBlock.split(/\r?\n/).forEach(function (line) {
    var m2 = line.match(/^([A-Za-z0-9-]+):/);
    if (m2 && names.indexOf(m2[1]) === -1) names.push(m2[1]);
  });
  Logger.log('ALL header names present: ' + names.join(', '));
  Logger.log('--- header block (first 2500 chars) ---');
  Logger.log(headerBlock.slice(0, 2500));
}

// One-off: which Gmail query actually finds the forwarded transactions?
// Run manually. Prints the hit count for each variant so the real search can be
// chosen from evidence instead of assumptions about Gmail's operator semantics.
function debugSearch() {
  var qs = [
    buildInboxQuery(),
    'deliveredto:' + TXN_INBOX,
    'deliveredto:' + TXN_INBOX + ' -label:txn/processed -label:txn/parse-failed',
    'from:mbcard@mbbank.com.vn',
    'from:mbbank.com.vn',
    'in:inbox',
    'in:inbox -label:txn/processed -label:txn/parse-failed',
    'label:txn/inbox'
  ];
  for (var i = 0; i < qs.length; i++) {
    var n = -1;
    try { n = GmailApp.search(qs[i]).length; } catch (e) { Logger.log('QUERY ERROR: ' + qs[i] + ' -> ' + e); continue; }
    Logger.log(n + ' thread(s)  <-  ' + qs[i]);
  }
  // And what the pipeline would decide about the newest inbox thread
  var t = GmailApp.search('in:inbox', 0, 3);
  for (var j = 0; j < t.length; j++) {
    var m = t[j].getMessages()[0];
    Logger.log('inbox[' + j + '] from=' + m.getFrom() +
      ' | routed=' + JSON.stringify(recipientForRouting(m)) +
      ' | tag=' + extractPlusTag(recipientForRouting(m)) +
      ' | labels=' + t[j].getLabels().map(function (l) { return l.getName(); }).join(','));
  }
}

// ---------- Supabase REST helpers ----------

// All Supabase traffic goes through here so an HTTP failure can never be mistaken
// for a result. PostgREST answers errors with a JSON *object* ({code, message,...}),
// which is truthy and parses fine — so callers checking `if (!result)` or reading
// `rows.length` silently treated outages and schema mismatches as success/empty.
// Failures throw with a SUPABASE_ prefix so processEmails() can tell "the database
// is unhappy" (retry later, keep the message queued) apart from "this email is
// unparseable" (record it, stop retrying).
function _supabaseFetch(url, options) {
  var response;
  try {
    response = UrlFetchApp.fetch(url, options);
  } catch (e) {
    // UrlFetchApp throws for transport-level failures BEFORE any response
    // exists — "Address unavailable", "Bandwidth quota exceeded", DNS, timeout.
    // None of those strings contain SUPABASE_, and processEmails decides whether
    // a failure is transient by looking for exactly that token. So an outage was
    // being read as "this message is bad": a parse_failure was written and the
    // thread relabelled txn/parse-failed, which the query excludes forever.
    // A perfectly good bank email was discarded because the database was briefly
    // over quota — observed 2026-08-15, three rows in parse_failures.
    // Tagging them here is what makes transient reliably mean transient.
    throw new Error('SUPABASE_NET: ' + String((e && e.message) || e).slice(0, 300));
  }
  var code = response.getResponseCode();
  var text = response.getContentText();
  if (code < 200 || code >= 300) {
    throw new Error('SUPABASE_HTTP_' + code + ': ' + String(text).slice(0, 300));
  }
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new Error('SUPABASE_BAD_JSON: ' + String(text).slice(0, 300));
  }
}

function supabaseGet(table, filters) {
  var base = PropertiesService.getScriptProperties().getProperty('SUPABASE_URL');
  var key = PropertiesService.getScriptProperties().getProperty('SUPABASE_SERVICE_ROLE_KEY');
  var params = [];
  for (var k in filters) params.push(k + '=' + encodeURIComponent(filters[k]));
  var url = base + '/rest/v1/' + table + '?' + params.join('&');

  var result = _supabaseFetch(url, {
    headers: { apikey: key, Authorization: 'Bearer ' + key },
    muteHttpExceptions: true,
  });
  // A successful PostgREST select is always an array; anything else means the
  // shape changed underneath us and callers doing rows.length would misread it.
  return Array.isArray(result) ? result : [];
}

function supabasePost(table, row, onConflict) {
  var base = PropertiesService.getScriptProperties().getProperty('SUPABASE_URL');
  var key = PropertiesService.getScriptProperties().getProperty('SUPABASE_SERVICE_ROLE_KEY');
  var url = base + '/rest/v1/' + table + (onConflict ? '?on_conflict=' + onConflict : '');

  var headers = {
    apikey: key,
    Authorization: 'Bearer ' + key,
    'Content-Type': 'application/json',
    Prefer: onConflict ? 'resolution=merge-duplicates,return=representation' : 'return=representation',
  };

  var result = _supabaseFetch(url, {
    method: 'post',
    headers: headers,
    payload: JSON.stringify(row),
    muteHttpExceptions: true,
  });
  return Array.isArray(result) ? result[0] : result;
}

function supabasePatch(table, filters, updates) {
  var base = PropertiesService.getScriptProperties().getProperty('SUPABASE_URL');
  var key = PropertiesService.getScriptProperties().getProperty('SUPABASE_SERVICE_ROLE_KEY');
  var params = [];
  for (var k in filters) params.push(k + '=' + encodeURIComponent(filters[k]));
  var url = base + '/rest/v1/' + table + '?' + params.join('&');

  _supabaseFetch(url, {
    method: 'patch',
    headers: { apikey: key, Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
    payload: JSON.stringify(updates),
    muteHttpExceptions: true,
  });
}
