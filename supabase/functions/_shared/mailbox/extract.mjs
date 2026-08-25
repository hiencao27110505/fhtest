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

import { applyExtractionTemplate, deriveExtractionTemplate } from './templates.mjs';
import { tidyMemo, tidyMerchant } from './memo.mjs';
import * as llm from './llm.mjs';

/**
 * The subject with the parts that vary per message removed, so two mails off
 * one template share a key. Same normalisation as the forwarding pipeline, and
 * it has to stay that way or the shared cache splits in two.
 */
export function normalizeSubjectTemplate(subject) {
  return String(subject || '')
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
export async function readTransaction(message, db, deps) {
  const sender = _address(message.from);
  const template = normalizeSubjectTemplate(message.subject);
  const fp = await db.fingerprint(sender, template);

  // A cached "not a transaction" costs one lookup and saves a model call
  // forever. This is most of what a real mailbox contains.
  if (fp && fp.is_transaction_source === false) {
    return { ok: false, reason: 'not_a_transaction' };
  }

  // ── stage 1: the stored template, locally, nothing leaves ────────────────
  const stored = (fp && typeof fp.extraction_regex === 'string') ? fp.extraction_regex : null;
  if (stored) {
    // Stale-version and malformed templates both come back null from here, and
    // both mean the same thing to us: re-derive.
    const applied = applyExtractionTemplate(stored, message.body);
    if (applied && applied.amount != null) {
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
    // Cache the verdict so this sender's newsletters never cost a second call.
    await db.saveFingerprint({
      sender_address: sender, subject_template: template,
      is_transaction_source: false, transaction_type: null, extraction_regex: null,
    });
    return { ok: false, reason: 'not_a_transaction' };
  }

  if (extraction.amount == null || !extraction.direction) {
    // Read as a transaction but without the two fields a ledger row cannot be
    // built from. Not cached as a non-source: the next mail off this template
    // may well be complete, and caching "not a transaction" here would blind us
    // to the whole sender on the strength of one bad mail.
    return { ok: false, reason: 'unreadable', detail: 'no amount or direction' };
  }

  // Derive a template from THIS mail. `deriveExtractionTemplate` keeps it only
  // if it reproduces the model's own output on the very body it came from, and
  // returns a JSON string or null. A plausible-looking template that does not
  // actually work would silently serve wrong figures to every later mail off
  // this sender, and to the other transport as well. Storing null is the right
  // outcome then: the sender is confirmed as a transaction source, and the next
  // mail tries the model again rather than trusting an unproven template.
  let derived = null;
  try { derived = deriveExtractionTemplate(message.body, extraction); } catch { derived = null; }

  await db.saveFingerprint({
    sender_address: sender,
    subject_template: template,
    is_transaction_source: true,
    transaction_type: extraction.transaction_type || null,
    extraction_regex: derived,
  });

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
  const tidy = tidyMemo(out.memo, body);
  out.memo_display = tidy.description;
  if (tidy.code) out.type_code = tidy.code;

  if (out.counterparty) {
    const merchant = tidyMerchant(out.counterparty);
    if (merchant && merchant !== out.counterparty) out.counterparty_display = merchant;
  }
  return out;
}

function _address(fromHeader) {
  const s = String(fromHeader || '');
  const angled = s.match(/<([^>]+)>/);
  return (angled ? angled[1] : s).trim().toLowerCase();
}
