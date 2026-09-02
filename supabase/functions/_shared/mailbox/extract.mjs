/**
 * Reading a transaction out of one mail, cheaply where possible.
 *
 * Three outcomes, and the caller has to be able to tell them apart:
 *
 *   { ok: true,  extraction, stage: 'template' | 'llm', learned }
 *   { ok: false, reason: 'not_a_transaction' }   cached verdict or the model's
 *   { ok: false, reason: 'unreadable', detail }  nothing usable came out
 *
 * A hold (leave it for the next poll) is a THROW, not a reason: the model being
 * rate-limited is not the same event as the model saying "this is a newsletter",
 * and collapsing them would either retry a newsletter forever or permanently
 * drop a transaction because a free-tier quota reset in four minutes.
 *
 * THE CACHE IS SHARED WITH THE FORWARDING TRANSPORT. `sender_fingerprints` is
 * keyed on `(sender_address, subject_template)` and both pipelines read and
 * write it, so a template derived from a mail that arrived by forwarding is
 * applied to the same bank's mail arriving by direct read, and the other way
 * round. That is a real saving and also the thing that makes the two transports
 * behave identically on the same bank rather than merely similarly.
 *
 * Keyed on `(sender, subject_template)` and NOT on sender alone: one sender
 * sends both transaction and non-transaction mail, and caching a verdict per
 * sender misclassifies whichever kind arrived first.
 */

import { applyExtractionTemplate, deriveAccountKind, deriveExtractionTemplate } from './templates.mjs';
import { readLabelTable, maskAccount, statusReadsFailed, unknownLabels } from './labeltable.mjs';
import { canonProviderName } from './senders.mjs';
import { tidyMemo, tidyMerchant } from './memo.mjs';
import * as llm from './llm.mjs';

/**
 * The subject with the parts that vary per message removed, so two mails off
 * one template share a key. Same normalisation as the forwarding pipeline, and
 * it has to stay that way or the shared cache splits in two.
 */
export function normalizeSubjectTemplate(subject) {
  return String(subject || '')
    // A forwarded receipt is the same shape as the original: "Fwd: Biên lai"
    // must land on the "Biên lai" row, or every forwarder grows a parallel
    // cache that never meets the bank's own. Repeated prefixes (Fwd: Fwd:)
    // collapse in one pass.
    .replace(/^\s*((fwd|fw|re|chuyen tiep|chuyển tiếp)\s*:\s*)+/i, '')
    .replace(/#[\w-]+/g, '')
    .replace(/\b\d{6,}\b/g, '')
    .replace(/\b\w+ \d{1,2},? \d{4}\b/g, '')
    .replace(/\b\d{1,2}[-\/]\d{1,2}[-\/]\d{2,4}\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/*
 * A NOTE ON THE TEMPLATE'S TYPE, because it is the easy mistake here.
 * `deriveExtractionTemplate` returns a JSON STRING and `applyExtractionTemplate`
 * takes one; the column stores that string verbatim. Parsing it on the way in
 * or re-stringifying it on the way out both break silently — apply() rejects a
 * non-string by its leading-brace check and returns null, which reads exactly
 * like "the anchors did not hold" and quietly sends every mail to the model.
 * So the string is passed straight through, and the version check stays inside
 * apply() where it already lives: `EXTRACTION_LOGIC_VERSION` is stamped into
 * every template, so bumping it self-invalidates the cache and forces one clean
 * re-derivation per sender rather than serving answers shaped by logic that no
 * longer exists. (Version 3 silently dropped the memo, and every template
 * derived under it still passed its own proof.)
 */

/**
 * @param {{from: string, subject: string, body: string}} message
 * @param {{fingerprint: Function, saveFingerprint: Function}} db
 * @param {{llm: object, budget?: {spend: Function}}} deps
 */
/** The subject_template of a sender-wide verdict. Must match db.mjs. */
export const SENDER_SENTINEL = '*';

/** How many distinct junk shapes a sender may produce, with zero transactions,
 *  before it is written off wholesale.
 *
 *  Six rather than two: a bank's transactional address can open with a run of
 *  service notices — a login alert, an OTP registration, a limit change — before
 *  its first real transaction, and writing it off on that run would lose money
 *  silently. Six distinct shapes with nothing to show is a newsletter. */
export const SENDER_JUNK_THRESHOLD = 6;

/* Fire-and-forget, and BOTH halves of that matter.
 *
 * `trace` is called from inside deriveExtractionTemplate, which is synchronous
 * and guards it with try/catch — but a try/catch cannot catch a REJECTED
 * PROMISE, and the recorder is async. Without the `.catch` below, a telemetry
 * table that is unreachable, revoked, or renamed takes the whole read down with
 * it: a lost data point becomes a lost transaction. Which is the exact rule the
 * recorder was written to obey, broken at the call site rather than inside it,
 * and caught by pipeline/derive-failures.test.js rather than by production.
 *
 * Not awaited, deliberately: the derivation's answer must not wait on a
 * diagnostic write.
 */
function _noteDeriveFailure(db, sender, subjectTemplate, step) {
  try {
    const p = db.recordDeriveFailure?.(sender, subjectTemplate, step);
    if (p && typeof p.catch === 'function') p.catch(() => {});
  } catch { /* a synchronous throw is just as harmless as an async one */ }
}

export async function readTransaction(message, db, deps) {
  const sender = _address(message.from);
  const template = normalizeSubjectTemplate(message.subject);

  /* A warm map, when the caller has one (2026-08-29). The worker fetches every
     fingerprint for the window's senders in a single query and passes it here,
     which removes one database round trip per message — the largest remaining
     per-row cost once the cache is healthy. The same exact-beats-sentinel rule
     the query applies, applied to the map. A miss falls through to the query,
     so this stays an optimisation and never a source of truth. */
  let fp = null;
  const warm = deps && deps.fingerprints;
  if (warm) {
    const exact = warm.get(sender + '\u0000' + template);
    const wide = warm.get(sender + '\u0000' + SENDER_SENTINEL);
    if (exact) fp = exact;
    else if (wide) fp = { ...wide, _sender_wide: true };
  }
  if (!fp && !warm) fp = await db.fingerprint(sender, template);

  // A cached "not a transaction" costs one lookup and saves a model call
  // forever. This is most of what a real mailbox contains.
  //
  // `_sender_wide` means the verdict came from the sender-wide sentinel rather
  // than this exact subject — a sender that has produced only noise, many
  // times, and never a transaction. That is the case the per-shape cache cannot
  // help with at all: a marketing mail has a new subject every time, so the
  // shape never repeats and every message would otherwise pay for a model call
  // to be told the same thing again.
  if (fp && fp.is_transaction_source === false) {
    await db.bumpReadTally?.('junk_cache');
    return { ok: false, reason: 'not_a_transaction', senderWide: !!fp._sender_wide };
  }

  // ── stage 1: the stored template, locally, nothing leaves ────────────────
  const stored = (fp && typeof fp.extraction_regex === 'string') ? fp.extraction_regex : null;
  if (stored) {
    // Stale-version and malformed templates both come back null from here, and
    // both mean the same thing to us: re-derive.
    const applied = applyExtractionTemplate(stored, message.body);
    // The mail's own status row outranks the template: several stored templates
    // STATICISED status as success at derivation, so a declined attempt off the
    // same shape would stage as real spending. Not cached as junk — the sender
    // is a transaction source; this one mail just reports a failure.
    if (applied && statusReadsFailed(message.body)) {
      await db.bumpReadTally?.('failed_status');
      return { ok: false, reason: 'not_a_transaction' };
    }
    if (applied && applied.amount != null) {
      await db.bumpReadTally?.('template');
      _fillAccountKind(applied, message, sender);
      return {
        ok: true,
        extraction: _tidy(applied, message.body),
        stage: 'template',
        learned: false,
        transactionType: (fp && fp.transaction_type) || applied.transaction_type || null,
      };
    }
    // The anchors did not hold. Usually a structurally different mail from the
    // same sender (the credit variant of a debit notice), which is a
    // re-derivation, not a failure. Fall through to the model.
    //
    // Counted, though, because "usually" was doing a lot of work. A stored
    // template that can NEVER match — one derived against the other transport's
    // rendering of the same mail — returns null here too, and the two are
    // indistinguishable at this line. Silently falling through is correct
    // behaviour for the first and a permanent tax for the second, so the tally
    // is the only thing that tells them apart: a shape that misses once is a
    // variant, a shape that misses every single day is a template that is not
    // for us. Without this the cost is invisible and the only symptom is a bill.
    await db.bumpReadTally?.('template_missed');
  }

  // ── stage 1.5: the label-table reader, locally, nothing leaves ───────────
  // VN bank notices are two-column label/value tables off a small bilingual
  // vocabulary; this reads that structure directly. It returns null unless the
  // mail yields amount + timestamp + a counterpart, so anything ambiguous still
  // falls through to the model's judgement. On success the template learner
  // runs against ITS output exactly as it runs against the model's — a sender
  // this tier reads once graduates to the even cheaper stored-template path,
  // so the table walk is paid per SHAPE, not per mail.
  if (statusReadsFailed(message.body)) {
    await db.bumpReadTally?.('failed_status');
    return { ok: false, reason: 'not_a_transaction' };
  }
  const tabled = readLabelTable(message.subject, message.body);
  if (tabled && tabled.amount != null && tabled.direction) {
    _fillAccountKind(tabled, message, sender);
    let derivedT = null;
    try {
      derivedT = deriveExtractionTemplate(message.body, tabled,
        (step) => { _noteDeriveFailure(db, sender, template, step); });
    } catch { derivedT = null; }
    await db.saveFingerprint({
      sender_address: sender,
      subject_template: template,
      is_transaction_source: true,
      transaction_type: tabled.transaction_type || null,
      extraction_regex: derivedT,
    });
    await db.bumpReadTally?.('table');
    await db.bumpReadTally?.(derivedT ? 'template_learned' : 'template_unlearnable');
    return {
      ok: true,
      extraction: _tidy(tabled, message.body),
      stage: 'table',
      learned: !!derivedT,
      transactionType: tabled.transaction_type || null,
    };
  }

  // ── stage 2: the model, on the mail as written ───────────────────────────
  // Budgeted by the caller. A model call is the only thing here that costs
  // money or leaves the machine, so the ceiling lives at the call site rather
  // than inside the thing being limited.
  if (deps.budget && !deps.budget.spend()) {
    throw new llm.LlmUnavailable('call budget exhausted for this run');
  }

  const extraction = await llm.extract(sender, message.subject, message.body, deps.llm, deps.fetch);

  if (!extraction || extraction.is_transaction !== true) {
    // Cache the verdict for this exact shape.
    await db.saveFingerprint({
      sender_address: sender, subject_template: template,
      is_transaction_source: false, transaction_type: null, extraction_regex: null,
    });

    /* And ask whether this SENDER has earned a blanket verdict.
    
       A sender that has produced many distinct junk shapes and never once a
       transaction is a newsletter, and every future mail from it would repeat
       this exact call under a subject we have not seen before. Writing a
       sender-wide sentinel is what stops that.
    
       THE THRESHOLD IS THE WHOLE SAFETY ARGUMENT. `txn === 0` is the real
       guard: a sender that has EVER produced a transaction is never blanketed,
       however much noise it also sends — banks legitimately send both from one
       address, and silently ignoring such a sender would lose real money with
       nothing recording it. The count is the second guard, so a sender is not
       written off on the strength of two promotional mails.
    
       Best-effort: a failure here costs model calls, never correctness, so it
       must not fail the read that already succeeded. */
    if (db.senderTally) {
      try {
        const tally = await db.senderTally(sender);
        if (tally.txn === 0 && tally.junk >= SENDER_JUNK_THRESHOLD) {
          await db.saveFingerprint({
            sender_address: sender, subject_template: SENDER_SENTINEL,
            is_transaction_source: false, transaction_type: null, extraction_regex: null,
          });
        }
      } catch (e) { /* the read stands regardless */ }
    }

    await db.bumpReadTally?.('llm_junk');
    return { ok: false, reason: 'not_a_transaction' };
  }

  if (extraction.amount == null || !extraction.direction) {
    // Read as a transaction but without the two fields a ledger row cannot be
    // built from. Not cached as a non-source: the next mail off this template
    // may well be complete, and caching "not a transaction" here would blind us
    // to the whole sender on the strength of one bad mail.
    await db.bumpReadTally?.('unreadable');
    return { ok: false, reason: 'unreadable', detail: 'no amount or direction' };
  }

  // Derive a template from THIS mail. `deriveExtractionTemplate` keeps it only
  // if it reproduces the model's own output on the very body it came from, and
  // returns a JSON string or null. A plausible-looking template that does not
  // actually work would silently serve wrong figures to every later mail off
  // this sender, and to the other transport as well. Storing null is the right
  // outcome then: the sender is confirmed as a transaction source, and the next
  // mail tries the model again rather than trusting an unproven template.
  _fillAccountKind(extraction, message, sender);
  let derived = null;
  try {
    derived = deriveExtractionTemplate(message.body, extraction,
      (step) => { _noteDeriveFailure(db, sender, template, step); });
  } catch { derived = null; }

  await db.saveFingerprint({
    sender_address: sender,
    subject_template: template,
    is_transaction_source: true,
    transaction_type: extraction.transaction_type || null,
    extraction_regex: derived,
  });

  await db.bumpReadTally?.('llm');
  await db.bumpReadTally?.(derived ? 'template_learned' : 'template_unlearnable');
  /* A transaction the table tier could not read is a dictionary gap. Log the
     LABELS the mail used — bank boilerplate, no values, no amounts, nothing
     personal — so coverage grows from real misses without storing anyone's
     mail. This is the only "training data" this pipeline collects. */
  await db.logMissLabels?.(sender, unknownLabels(message.body));
  return {
    ok: true,
    extraction: _tidy(extraction, message.body),
    stage: 'llm',
    learned: !!derived,
    transactionType: extraction.transaction_type || null,
  };
}

/**
 * Adds `memo_display` alongside `memo`, never over it.
 *
 * What a bank writes in "Nội dung chuyển tiền" is usually not what the money was
 * for: "NGUYEN THU TRANG chuyen tien" is auto-fill that passes any looks-like-
 * prose test while carrying nothing. A pre-filled wrong answer gets accepted
 * rather than corrected, which is worse than a blank one. Keeping both means a
 * misjudged heuristic stays recoverable by the person reviewing the row.
 */
function _tidy(extraction, body) {
  const out = { ...extraction };
  // tidyMemo returns {description, code}, not a string: a structured bank memo
  // ("MB.5153-...NAP TIEN DIEN THOAI...") carries both a human part and a type
  // code, and they are worth keeping apart. Same use the forwarding pipeline
  // makes of it in _withTidyMemo.
  // A field named `masked` holds only a masked value, whichever tier filled it
  // — the stored templates predate this rule and capture whatever the mail
  // printed, which for MB is the FULL account number sitting one row below the
  // masked one.
  out.account_masked = maskAccount(out.account_masked);
  // every tier's provider leaves canonical — template statics included, which
  // is what heals the names already frozen at derivation without touching them
  out.source_provider = canonProviderName(out.source_provider);
  const tidy = tidyMemo(out.memo, body);
  out.memo_display = tidy.description;
  if (tidy.code) out.type_code = tidy.code;

  if (out.counterparty) {
    const merchant = tidyMerchant(out.counterparty);
    if (merchant && merchant !== out.counterparty) out.counterparty_display = merchant;
  }
  return out;
}

/**
 * Fills `account_kind` where the tier that read the mail did not.
 *
 * The LLM may answer it (schema in llm.mjs); the template tier carries it as a
 * static when derivation was confident; the table tier never answers it. The
 * heuristic (templates.mjs deriveAccountKind, spec §8.2) fills the gap — and
 * only the gap, so a model or template verdict is never overwritten. Runs
 * BEFORE template derivation at every call site, so a non-null verdict freezes
 * into the shape's static and later mails inherit it for free. A null result
 * stays null: ambiguous never invents a debt (spec §8.4), the client defaults
 * to deposit-expense behaviour and the review chip stays editable.
 *
 * The provider falls back to the sender address because the table tier leaves
 * source_provider null — and "the sender is MoMo" is exactly the e-wallet
 * signal the spec names, which the address carries as well as the label.
 */
function _fillAccountKind(extraction, message, sender) {
  if (extraction.account_kind == null) {
    extraction.account_kind = deriveAccountKind({
      bodyText: message.body,
      subject: message.subject,
      provider: extraction.source_provider || sender,
      accountMasked: extraction.account_masked,
    });
  }
  return extraction;
}

function _address(fromHeader) {
  const s = String(fromHeader || '');
  const angled = s.match(/<([^>]+)>/);
  return (angled ? angled[1] : s).trim().toLowerCase();
}
