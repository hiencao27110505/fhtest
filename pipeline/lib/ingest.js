// One email → one staged row. The direct-read equivalent of processOneMessage()
// in bank-email-pipeline.gs, with the forwarding-specific steps removed and
// nothing else changed in spirit.
//
// Every dependency is injected (db, llm, clock) so the whole decision tree is
// testable without a network, a mailbox, or an API key. The endpoint in
// api/gmail-sync.js is a thin wrapper that supplies real ones.
//
// ── What is deliberately identical to the forwarding pipeline ───────────────
//
//   * Masking before any LLM call. Unconditional.
//   * Template-first: a known (sender, subject-shape) parses locally, no LLM.
//   * Per-run and per-day ceilings on new classifications.
//   * Cross-source dedup only — two emails from the SAME provider are two
//     transactions, not a duplicate.
//   * review_status 'pending'. NOTHING is ever auto-imported into the ledger.
//     The machine gets amount and date right and cannot know that
//     "NGUYEN THU TRANG chuyen tien" was lunch with your mum.
//
// ── What changes, because the mailbox is proven by the grant ────────────────
//
//   * No +tag parsing, no alias lookup, no routing grace period. The member is
//     known before the fetch: we are reading THEIR mailbox.
//   * No X-Forwarded-For check — there is no forwarder.
//   * DKIM still runs, and matters more: no human chose which mail to forward.

'use strict';

const extract = require('./extract.js');
const gmail = require('./gmail.js');

const DEDUPE_WINDOW_DAYS = 3;
// Ceilings, per the .gs. A pathological mailbox (or a bug) must cost a bounded
// number of LLM calls, not an unbounded one.
const MAX_NEW_CLASSIFICATIONS_PER_RUN = 10;

// ---------------------------------------------------------------------------

async function findFingerprint(deps, sender, subjectTemplate) {
  const rows = await deps.db.get('sender_fingerprints', {
    sender_address: 'eq.' + sender,
    subject_template: 'eq.' + subjectTemplate,
  });
  return rows[0] || null;
}

async function upsertFingerprint(deps, sender, subjectTemplate, isSource, txnType, regex) {
  await deps.db.post('sender_fingerprints', {
    sender_address: sender,
    subject_template: subjectTemplate,
    is_transaction_source: isSource,
    transaction_type: txnType,
    extraction_regex: regex,
  }, 'sender_address,subject_template');
}

// Cross-source duplicate: the same purchase reported by both the bank and the
// merchant. Same-provider repeats are real separate transactions.
async function findDuplicate(deps, amount, direction, occurredAt, sourceProvider) {
  if (!amount || !occurredAt) return null;
  const occurred = new Date(occurredAt);
  const windowStart = new Date(occurred.getTime() - DEDUPE_WINDOW_DAYS * 86400000).toISOString();
  const windowEnd = new Date(occurred.getTime() + DEDUPE_WINDOW_DAYS * 86400000).toISOString();

  const rows = await deps.db.get('email_transactions', {
    amount: 'eq.' + amount,
    direction: 'eq.' + direction,
    occurred_at: 'gte.' + windowStart,
    source_provider: 'neq.' + sourceProvider,
    duplicate_of_id: 'is.null',
  });
  let earliest = null;
  for (const r of rows) {
    if (r.occurred_at <= windowEnd && (!earliest || r.created_at < earliest.created_at)) earliest = r;
  }
  return earliest;
}

async function alreadyStaged(deps, messageId) {
  const rows = await deps.db.get('email_transactions', { gmail_message_id: 'eq.' + messageId }, { select: 'id' });
  return rows.length > 0;
}

async function recordFailure(deps, msg, reason) {
  await deps.db.post('parse_failures', {
    gmail_message_id: msg.id,
    sender: msg.sender || '',
    subject: msg.subject || '',
    // Bodies are the fattest sensitive payload in the system. A failure row for
    // an email we could not even parse does not justify keeping one, and under
    // direct read this body was never hand-picked by the user for us to see.
    raw_body: '',
    error_reason: reason,
  });
}

// ---------------------------------------------------------------------------
// The decision tree for a single message.
// ---------------------------------------------------------------------------

async function processMessage(deps, msg, connection, budget) {
  const b = budget || { llmCalls: 0 };

  if (await alreadyStaged(deps, msg.id)) return { action: 'skipped', reason: 'already_staged' };

  // The query already restricts senders; this re-checks the actual message,
  // because a Gmail search is a search and not a guarantee.
  if (!gmail.isKnownProvider(msg.sender, deps.providerDomains)) {
    return { action: 'skipped', reason: 'sender_not_a_known_provider' };
  }

  const auth = gmail.checkDkim(msg.headers, msg.sender);
  if (deps.enforceDkim && auth.dkim !== 'pass') {
    await recordFailure(deps, msg, 'dkim_' + auth.dkim + ': ' + auth.reasons.join('; '));
    return { action: 'rejected', reason: 'dkim_' + auth.dkim };
  }

  const subjectTemplate = extract.normalizeSubjectTemplate(msg.subject);
  const fp = await findFingerprint(deps, msg.sender, subjectTemplate);

  // Known non-transactional sender+shape: nothing to do, and no LLM spent.
  if (fp && fp.is_transaction_source === false) return { action: 'skipped', reason: 'known_non_transactional' };

  let extraction = null;
  let usedLlm = false;

  if (fp && fp.extraction_regex) {
    extraction = extract.applyTemplate(fp.extraction_regex, msg.body);
  }

  if (!extraction) {
    if (b.llmCalls >= MAX_NEW_CLASSIFICATIONS_PER_RUN) {
      // Not a failure — the message stays unprocessed and is picked up next
      // run, exactly like the label-queue behaviour on the forwarding side.
      return { action: 'deferred', reason: 'llm_budget_exhausted' };
    }
    b.llmCalls++;
    usedLlm = true;
    try {
      extraction = await deps.llm.classifyAndExtract(msg.sender, msg.subject, msg.body);
    } catch (e) {
      await recordFailure(deps, msg, 'llm_error: ' + String(e && e.message || e).slice(0, 200));
      return { action: 'failed', reason: 'llm_error' };
    }
  }

  if (!extraction || extraction.is_transaction !== true) {
    if (usedLlm) await upsertFingerprint(deps, msg.sender, subjectTemplate, false, null, null);
    return { action: 'skipped', reason: 'not_a_transaction' };
  }

  if (typeof extraction.amount !== 'number' || !extraction.occurred_at) {
    await recordFailure(deps, msg, 'incomplete_extraction');
    return { action: 'failed', reason: 'incomplete_extraction' };
  }

  // Learn the shape so the next email of this kind costs nothing — but never
  // overwrite a template the forwarding pipeline is relying on. See the
  // version-interop note in lib/extract.js: without this guard the two
  // pipelines re-derive over each other on every single email.
  if (usedLlm) {
    let tpl = null;
    try { tpl = extract.deriveTemplate(msg.body, extraction); } catch (e) { tpl = null; }
    const safeToStore = extract.shouldStoreTemplate(fp && fp.extraction_regex);
    await upsertFingerprint(
      deps, msg.sender, subjectTemplate, true, extraction.transaction_type,
      (tpl && safeToStore) ? tpl : (fp && fp.extraction_regex) || null,
    );
  }

  // ── seal, or hold ─────────────────────────────────────────────────────────
  //
  // When the family has a staging keypair, the row is sealed to it and the
  // server keeps nothing readable. When it does not, we HOLD the message rather
  // than writing plaintext (option (a), agreed in AGENT_SYNC 2026-08-09):
  // writing plaintext "for now" reintroduces exactly the window sealing exists
  // to remove, and makes the plaintext row shape permanent instead of
  // transitional. As of v325 every family provisions its keypair on the next
  // app open, so a hold is self-healing.
  if (deps.staging) {
    const key = await deps.staging.getFamilyKey(connection.member_id);
    if (!key || !key.stagingPub) {
      return { action: 'deferred', reason: 'awaiting_family_staging_key' };
    }
    // Defense 1: refuse to seal to a key that changed under us.
    deps.staging.assertPinned(key);

    const dupSealed = await findDuplicate(deps, extraction.amount, extraction.direction, extraction.occurred_at, extraction.source_provider);
    const env = deps.staging.seal(
      Object.assign({}, extraction, { raw_body: deps.storeRawBody === false ? undefined : msg.body }),
      key.stagingPub, key.familyId, msg.id,
    );
    await deps.db.post('email_transactions', {
      gmail_message_id: msg.id,
      // stays clear so a locked device can still render the row
      source_provider: extraction.source_provider,
      occurred_at: extraction.occurred_at,
      sealed: env.sealed, eph_pub: env.eph_pub, nonce: env.nonce, enc_v: env.enc_v,
      review_status: 'pending',
      duplicate_of_id: dupSealed ? dupSealed.id : null,
      member_id: connection.member_id,
      ingest_source: 'oauth',
    });
    return { action: 'staged', usedLlm, sealed: true, dup: !!dupSealed };
  }

  const dup = await findDuplicate(deps, extraction.amount, extraction.direction, extraction.occurred_at, extraction.source_provider);

  const row = {
    gmail_message_id: msg.id,
    transaction_type: extraction.transaction_type,
    source_provider: extraction.source_provider,
    occurred_at: extraction.occurred_at,
    amount: extraction.amount,
    currency: extraction.currency,
    direction: extraction.direction,
    counterparty: extraction.counterparty,
    reference_number: extraction.reference_number,
    raw_body: deps.storeRawBody === false ? '' : msg.body,
    raw_extracted: extraction,
    review_status: 'pending',      // never anything else. See the header.
    duplicate_of_id: dup ? dup.id : null,
    member_id: connection.member_id,
    ingest_source: 'oauth',
  };

  await deps.db.post('email_transactions', row);
  return { action: 'staged', usedLlm, sealed: false, dup: !!dup, row };
}

// ---------------------------------------------------------------------------
// One connection's sync pass.
// ---------------------------------------------------------------------------

async function syncConnection(deps, connection, opts) {
  const o = opts || {};
  const backfill = o.backfill === true;
  const query = gmail.buildProviderQuery(deps.providerDomains, {
    days: backfill ? gmail.BACKFILL_DAYS : gmail.SYNC_LOOKBACK_DAYS,
  });

  // No providers configured means nothing to read. It must NEVER widen into an
  // unrestricted mailbox read.
  if (!query) return { ok: true, listed: 0, staged: 0, reason: 'no_provider_domains' };

  const ids = await deps.gmail.listMessages(query, { max: o.max || (backfill ? 200 : 50) });
  const budget = { llmCalls: 0 };
  const counts = { listed: ids.length, staged: 0, skipped: 0, failed: 0, deferred: 0, rejected: 0, llmCalls: 0 };

  for (const { id } of ids) {
    let msg;
    try {
      msg = await deps.gmail.getMessage(id);
    } catch (e) {
      counts.failed++;
      continue;
    }
    const r = await processMessage(deps, msg, connection, budget);
    if (r.action === 'staged') counts.staged++;
    else if (r.action === 'failed') counts.failed++;
    else if (r.action === 'deferred') counts.deferred++;
    else if (r.action === 'rejected') counts.rejected++;
    else counts.skipped++;
  }
  counts.llmCalls = budget.llmCalls;
  return Object.assign({ ok: true }, counts);
}

module.exports = {
  DEDUPE_WINDOW_DAYS,
  MAX_NEW_CLASSIFICATIONS_PER_RUN,
  processMessage,
  syncConnection,
  findDuplicate,
};
