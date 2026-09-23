/**
 * Reading a transaction out of one mail, cheaply where possible.
 *
 * THE CASCADE (email-reading-v2 §8.1), cheapest first, nothing leaving the
 * machine until the last step:
 *
 *   junk cache        a header-only verdict, keyed (sender, subject shape)
 *   known format      a stored label map (formats.mjs): a seed, then a learned one
 *   legacy template   the v4 regex templates, until formats cover their shapes
 *   structural reader the mail's table read as a table, or its lines walked,
 *                     over the shared vocabulary; on success it WRITES a format
 *   the model         only when none of the above can answer; its cited labels
 *                     write a format, proven by replaying it on the same mail
 *   signal detector   after EVERY tier (signals.mjs): what the mail itself says
 *                     the movement was, and who is on the other side
 *
 * Four outcomes, and the caller has to be able to tell them apart:
 *
 *   { ok: true,  extraction, stage, tier, learned }
 *        stage  'format' | 'template' | 'table' | 'llm'
 *        tier   'seed' | 'format' | 'template' | 'structural' | 'line' | 'model'
 *   { ok: false, reason: 'not_a_transaction' }   cached verdict or the model's
 *   { ok: false, reason: 'unreadable', detail }  nothing usable came out
 *   { ok: false, reason: 'multi' }               one mail, several transactions:
 *                                                given up on and counted, never
 *                                                cached as junk (spec §8.3)
 *   { ok: false, reason: 'format_cap' }          this shape already had its one
 *                                                model read on this build and
 *                                                learned nothing (spec §11);
 *                                                given up on until a new build
 *   { ok: false, reason: 'not_a_transaction', mailKind: 'notice', notice }
 *                                                mail that moves no money; the
 *                                                worker stages it as a notice
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
import { readLabelTable, tableRows, greetingName, whenPrecision, maskAccount, statusReadsFailed, unknownLabels, deriveLabelMappings } from './labeltable.mjs';
import { canonProviderName, isPersonShaped, match as matchSender } from './senders.mjs';
import { FH_PROVIDERS } from './providers.mjs';
import { hashKey } from './classify.mjs';
import { tidyMemo, tidyMerchant } from './memo.mjs';
import { labelSignature, learnFormat, applyFormat, isSeed, memoryFormatStore } from './formats.mjs';
import { detectSignal, detectChannel, counterpartyKind, crossCheckSignal } from './signals.mjs';
import { SRC } from './contract.mjs';
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
    /* A MASKED ACCOUNT AND A TYPED PHONE ARE NOT A SHAPE, AND NOT OURS TO KEEP
       (2026-09-22). This string is stored in plaintext in a table every family
       shares. "TK 0123-XXXX-456" survived every rule above (no six-digit run),
       and so did a phone typed the way people type them, "090 123 4567" or
       "+84.90.123.4567": two subjects with a masked token and a run of bank
       staff's hand-written subjects were cached readable. Same family as the
       date rule above. The Apps Script twin carries the identical two lines. */
    .replace(/\b\d{2,4}-[Xx*]{3,}(?:-\d{2,4})?/g, '')
    .replace(/(?:\+?84|\b0)(?:[\s.\-]?\d){8,10}\b/g, '')
    /* A MONTH IN THE SUBJECT IS NOT A SHAPE (2026-09-15). "Bang sao ke ... ky
       09/2026" and the same line for 10/2026 are one template, and treating
       them as two meant every statement sender relearned itself every month
       (three such groups in the live cache). Same family as the date rules
       above; kept separate so the legacy reader below can drop exactly these. */
    .replace(/\b(th[aá]ng|k[yỳ])\s*\d{1,2}\s*[\/-]\s*\d{2,4}\b/gi, '')
    .replace(/\b\d{1,2}\/\d{4}\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * The shape key as it was written BEFORE the month rules above.
 *
 * Read-only, and only as a fallback: a row learned last month still answers,
 * so nothing re-derives and no model call is paid twice for a shape we already
 * know (the b0d5fdd lesson — a key change that invalidates the cache stalls
 * every backfill behind it). Never written to; a re-learn migrates the row to
 * the new key by itself.
 */
export function legacySubjectTemplate(subject) {
  return String(subject || '')
    .replace(/^\s*((fwd|fw|re|chuyen tiep|chuyển tiếp)\s*:\s*)+/i, '')
    .replace(/#[\w-]+/g, '')
    .replace(/\b\d{6,}\b/g, '')
    .replace(/\b\w+ \d{1,2},? \d{4}\b/g, '')
    .replace(/\b\d{1,2}[-\/]\d{1,2}[-\/]\d{2,4}\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * HASH ON DOUBT (2026-09-22): the key the cache is actually read and written by.
 *
 * The normaliser above removes what it recognises. What it does not recognise
 * used to be stored as it stood, and a hand-written subject can carry anything:
 * a customer id, a contract number, digits typed with dots. The cache is an
 * EXACT-MATCH lookup, so it never needed readable text in the first place. When
 * the normalised subject still looks dirty, the key is its SHA-256 instead:
 * same hits, nothing to read.
 *
 * Dirty means a run of four or more digits that is not a plain year (19xx or
 * 20xx: "Sao ke nam 2026" is a shape, and 36 such rows are live), or eight or
 * more digits strung together by spaces, dots or dashes.
 *
 * ONE STRING, EVERYWHERE. Lookup, save, derive-failure recording and the
 * worker's metadata-first pass must all use this key, or the cache is written
 * under one name and read under another and never hits. The Apps Script twin
 * (`subjectCacheKey` in bank-email-pipeline.gs) produces the same key with
 * Utilities.computeDigest; pipeline/subject-hygiene.test.js pins a known digest
 * so the two cannot drift.
 */
export function subjectLooksDirty(normalised) {
  const t = String(normalised || '');
  for (const run of (t.match(/\d{4,}/g) || [])) {
    if (!/^(?:19|20)\d{2}$/.test(run)) return true;
  }
  return /\d(?:[\s.\-]?\d){7,}/.test(t);
}

/** WebCrypto, as classify.mjs hashes a merchant key: `crypto.subtle` is a global
 *  on Deno (the worker) and on the Node that runs the tests, and a caller that
 *  already holds one (ctx.subtle) may pass it. With no digest available at all
 *  the digits are dropped instead: a worse key, and still never a readable one. */
export async function subjectCacheKey(subject, subtle) {
  const t = normalizeSubjectTemplate(subject);
  if (!subjectLooksDirty(t)) return t;
  const impl = subtle || (globalThis.crypto && globalThis.crypto.subtle) || null;
  if (!impl) return 'd:' + t.replace(/\d+/g, '').replace(/\s+/g, ' ').trim();
  return 'h:' + await hashKey(t, impl);
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

/* A FOREIGN MAIL MUST NOT COST THE SHAPE ITS VND TEMPLATE (2026-09-22).
 *
 * One (sender, subject) shape legitimately carries both currencies: a card
 * notice announces a domestic coffee in VND and a foreign subscription in USD
 * off the same layout (templates.mjs, the foreign-currency guard). The design
 * is asymmetric on purpose: the stored VND template DEGRADES on the USD mail,
 * the currency-aware tiers read it, and derivation REFUSES to make a template
 * of it. But the save that followed wrote `extraction_regex: null` through
 * merge-duplicates, which REPLACED the working VND template with nothing. So
 * every foreign mail un-learned its shape, the next domestic mail paid the
 * model to learn it again, and template_derive_failures filled with
 * 'foreign_currency' rows on a sender whose mail is nearly all VND.
 *
 * Narrow on purpose: only the 'foreign_currency' refusal keeps the stored
 * template. Any other failed derivation still stores null, as before. */
function _templateToStore(derived, stored, failedStep) {
  if (derived) return derived;
  return (failedStep === 'foreign_currency' && typeof stored === 'string') ? stored : null;
}

export async function readTransaction(message, db, deps) {
  const sender = _address(message.from);
  // The cache key: the normalised subject, or its hash when it still looks
  // dirty (subjectCacheKey). Every read and write below uses THIS string.
  const template = await subjectCacheKey(message.subject, deps && deps.subtle);
  /* THE SENDER GATE (senders.mjs isPersonShaped, 2026-09-22). A person-shaped
     address at a bank's domain is a member of staff, not a notice: their mail
     may still be READ by the free local tiers below, but it is never sent to
     the model and nothing about it is ever cached, because the cache key is
     their hand-written subject, in plaintext, in a table every family shares. */
  const personal = isPersonShaped(sender);
  /* Rows written before hash-on-doubt sit under the readable key. Read them,
     never write them: the same fallback the month rules got, for the same
     reason (a key change that empties the cache stalls every backfill behind
     it). A re-learn moves the row to the new key by itself. */
  const plain = normalizeSubjectTemplate(message.subject);

  /* A warm map, when the caller has one (2026-08-29). The worker fetches every
     fingerprint for the window's senders in a single query and passes it here,
     which removes one database round trip per message — the largest remaining
     per-row cost once the cache is healthy. The same exact-beats-sentinel rule
     the query applies, applied to the map. A miss falls through to the query,
     so this stays an optimisation and never a source of truth. */
  let fp = null;
  const legacy = legacySubjectTemplate(message.subject);
  const warm = deps && deps.fingerprints;
  if (warm) {
    const exact = warm.get(sender + '\u0000' + template)
      || (plain !== template ? warm.get(sender + '\u0000' + plain) : null)
      || (legacy !== template && legacy !== plain ? warm.get(sender + '\u0000' + legacy) : null);
    const wide = warm.get(sender + '\u0000' + SENDER_SENTINEL);
    if (exact) fp = exact;
    else if (wide) fp = { ...wide, _sender_wide: true };
  }
  if (!fp && !warm) {
    fp = await db.fingerprint(sender, template);
    if (!fp && plain !== template) fp = await db.fingerprint(sender, plain);
    if (!fp && legacy !== template && legacy !== plain) fp = await db.fingerprint(sender, legacy);
  }

  /* A VERDICT LEARNED ON THIS MESSAGE MUST REACH THE NEXT ONE (2026-09-15).
     The worker warms the map once per sender per run, and the query above is
     skipped whenever a map exists — so a shape learned here stayed invisible
     for the rest of the run and every later mail of the same shape paid for its
     own model call. Measured on the 15/09 read: 162 calls for 25 shapes,
     against a 20-per-minute free-tier wall. Writing through the save keeps one
     source of truth (the table) and one cache, without touching five call
     sites. */
  if (warm && db && typeof db.saveFingerprint === 'function' && !db._warmThrough) {
    const inner = db;
    db = Object.create(inner);
    db._warmThrough = true;
    db.saveFingerprint = async function (row) {
      try {
        warm.set(String(row && row.sender_address) + '\u0000' + String(row && row.subject_template), row);
      } catch (e) { /* the save below is what matters */ }
      return inner.saveFingerprint(row);
    };
  }

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

  /* WHO SENT IT, as the registry classes them (senders.mjs): the class picks
     the model's prompt block and feeds the signal detector, and the provider
     is half of a format's key. A caller that already matched the sender (the
     worker does, with the database's extra domains) may pass both. */
  const matched = matchSender(message.from);
  const senderKind = (deps && deps.senderKind) || (matched && matched.senderKind) || null;
  const provider = (deps && deps.provider) || (matched && matched.provider) || sender.slice(sender.lastIndexOf('@') + 1);
  const ctx = { subject: message.subject, senderKind, provider };
  /* The learned vocabulary for THIS sender's domain, if any mappings have
     reached the n>=3 confirmation bar (db.loadLearnedLabels, 0111). Hardcoded LABELS
     always wins inside the reader; an absent map is exactly the old reader. */
  const learnedForDomain = deps && deps.learnedLabels
    ? deps.learnedLabels.get(sender.slice(sender.lastIndexOf('@') + 1)) : undefined;

  // ── stage 0.5: a known FORMAT, locally, nothing leaves ───────────────────
  // The mail's rows, the signature of their labels, and the label map stored
  // under (provider, signature): a hand-written seed first, then a learned one
  // (the store's `get` owns that order). A store that is down, a mail with no
  // rows, a map that does not read this mail: all of them are just "the next
  // tier", never a failed read.
  const formats = (deps && deps.formats) || _defaultFormats(deps && deps.subtle);
  let table = null, sig = null, known = null;
  try {
    table = tableRows(message, learnedForDomain);
    if (table.rows.length >= 3) {
      sig = await labelSignature(table.rows, deps && deps.subtle);
      known = await formats.get(provider, sig);
    }
  } catch { known = null; }
  if (known) {
    let rows = table.rows;
    /* The line walk only sees labels SOMEBODY knows. A format learned from the
       model's citations knows labels the vocabulary does not, so the lines are
       walked again with the format's own labels added. The signature above was
       taken over the first walk, at learning and here alike. */
    if (table.via === 'line') {
      try {
        const extra = new Map(learnedForDomain || []);
        for (const [label, field] of Object.entries(known.map || {})) if (!extra.has(label)) extra.set(label, field);
        rows = tableRows({ body: message.body }, extra).rows;
      } catch { rows = table.rows; }
    }
    const viaFormat = applyFormat(known, rows, message.subject);
    if (viaFormat) {
      if (statusReadsFailed(message.body)) {
        await db.bumpReadTally?.('failed_status');
        return { ok: false, reason: 'not_a_transaction' };
      }
      await db.bumpReadTally?.(isSeed(known) ? 'format_seed' : 'format');
      _fillAccountKind(viaFormat, message, sender);
      return {
        ok: true,
        extraction: await _finish(viaFormat, message, ctx, db, false),
        stage: 'format',
        tier: isSeed(known) ? 'seed' : 'format',
        learned: false,
        transactionType: viaFormat.transaction_type || null,
      };
    }
    await db.bumpReadTally?.('format_missed');
  }
  /* Learns a format from a read, best-effort and never for a person-shaped
     sender. Skipped when a format already holds this key and merely did not
     read THIS mail (a foreign-currency mail off a VND layout): overwriting it
     would un-learn the layout for every domestic mail that follows, which is
     the template-side bug _templateToStore exists for. */
  const learnFormatFrom = async (extraction, source, labels) => {
    if (personal || !sig || known || !table) return false;
    try {
      const fmt = await learnFormat({ provider, senderKind, rows: table.rows, extraction, labels, source,
        subject: message.subject, subtle: deps && deps.subtle });
      if (!fmt) { await db.bumpReadTally?.('format_unlearnable'); return false; }
      const kept = await formats.put(fmt);
      await db.bumpReadTally?.(kept === false ? 'format_kept_seed' : 'format_learned');
      return kept !== false;
    } catch { return false; }   // learning is optional; reading is not
  };

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
      /* Upgrade-on-hit (card-repayment-routing-spec follow-up, 2026-09-07): a
         template derived before card_masked existed carries no such key, and a
         template hit returns before the label-table tier that now reads the
         repaid card — so every pre-448ee22 card-payment shape served "Chưa rõ"
         forever. When THIS mail's own label table reads a card for the SAME
         amount, adopt it and re-derive the template so the upgrade is one-time
         per shape. Strictly local — no model call on any path; a failed
         re-derivation just repeats the (cheap) table walk next mail. */
      if (!personal && applied.card_masked == null && stored.indexOf('card_masked') < 0) {
        try {
          const learned0 = deps && deps.learnedLabels
            ? deps.learnedLabels.get(sender.slice(sender.lastIndexOf('@') + 1)) : undefined;
          const t2 = readLabelTable(message.subject, message.body, learned0);
          if (t2 && t2.card_masked && t2.amount === applied.amount) {
            applied.card_masked = t2.card_masked;
            let d2 = null;
            try { d2 = deriveExtractionTemplate(message.body, applied, () => {}); } catch { d2 = null; }
            if (d2) {
              await db.saveFingerprint({
                sender_address: sender,
                subject_template: template,
                is_transaction_source: true,
                transaction_type: (fp && fp.transaction_type) || applied.transaction_type || null,
                extraction_regex: d2,
              });
              await db.bumpReadTally?.('template_upgraded');
            }
          }
        } catch (e) { /* an upgrade must never cost the read itself */ }
      }
      /* Upgrade-on-hit, for payload v2 (email-reading-v2 §8.1 step 3). A v4
         template anchors seven fields and cannot carry a fee, a holder name,
         the other side's bank or the time's precision. The structural reader
         can, on THIS mail, locally: when it reads the same amount and does not
         contradict the direction, its v2-only fields are adopted, and the
         format it implies is written so the NEXT mail of this layout is served
         by the format tier above and never comes here again. No model call on
         any path, and no logic-version bump: a bump re-derives every shape
         through the model at once, which is what stalled backfills on
         2026-09-02. */
      applied.src = _srcFor(applied, SRC.TEMPLATE);
      try {
        const t3 = readLabelTable(message.subject, message.body, learnedForDomain, message.html);
        if (t3 && t3.amount === applied.amount && (!t3.direction || t3.direction === applied.direction)) {
          for (const k of V2_UPGRADE_FIELDS) {
            if (applied[k] == null && t3[k] != null) { applied[k] = t3[k]; applied.src[k] = SRC.PRINTED; }
          }
          if (t3.direction && table && t3.rows_via === table.via && await learnFormatFrom(t3, 'table', t3.labels)) {
            await db.bumpReadTally?.('template_to_format');
          }
        }
      } catch (e) { /* an upgrade must never cost the read itself */ }
      await db.bumpReadTally?.('template');
      _fillAccountKind(applied, message, sender);
      return {
        ok: true,
        extraction: await _finish(applied, message, ctx, db, false),
        stage: 'template',
        tier: 'template',
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
  // The mail's HTML table read AS A TABLE when it has one (htmltable.mjs), its
  // flattened lines walked otherwise; one vocabulary, one gate, either way.
  const tabled = readLabelTable(message.subject, message.body, learnedForDomain, message.html);
  if (tabled && tabled.amount != null && tabled.direction) {
    _fillAccountKind(tabled, message, sender);
    let derivedT = null, stepT = null;
    // A person-shaped sender is READ here and never LEARNED: no derivation (its
    // failure record carries the subject too) and no fingerprint row.
    if (!personal) {
      try {
        derivedT = deriveExtractionTemplate(message.body, tabled,
          (step) => { stepT = step; _noteDeriveFailure(db, sender, template, step); });
      } catch { derivedT = null; }
      await db.saveFingerprint({
        sender_address: sender,
        subject_template: template,
        is_transaction_source: true,
        transaction_type: tabled.transaction_type || null,
        extraction_regex: _templateToStore(derivedT, stored, stepT),
      });
    }
    await db.bumpReadTally?.('table');
    await db.bumpReadTally?.(tabled.rows_via === 'structural' ? 'table_structural' : 'table_line');
    if (!personal) await db.bumpReadTally?.(derivedT ? 'template_learned' : 'template_unlearnable');
    /* ...and the FORMAT this read implies (spec §8.1 step 4: "on success it
       writes the format it just read, so the walk is paid once per format").
       Only when the rows the reader used are the rows the signature was taken
       over. The v4 template above is still written: the forwarding transport
       shares that cache, and it is the fallback tier. */
    const learnedFormat = (table && tabled.rows_via === table.via)
      ? await learnFormatFrom(tabled, 'table', tabled.labels) : false;
    return {
      ok: true,
      extraction: await _finish(tabled, message, ctx, db, false),
      stage: 'table',
      tier: tabled.rows_via === 'structural' ? 'structural' : 'line',
      learned: !!derivedT || learnedFormat,
      transactionType: tabled.transaction_type || null,
    };
  }

  /* The sender gate closes HERE: after every tier that keeps the mail on this
     machine, before the budget is touched and before anything is sent. Not a
     hold (nothing will change by next poll) and not cached (see above): the
     same answer is reached again for free next time, from the address alone.
     Its own tally stage, so a bank that really does send notices from a
     person-shaped address shows up as a number instead of as silence. */
  if (personal) {
    await db.bumpReadTally?.('personal_sender');
    return { ok: false, reason: 'not_a_transaction', personalSender: true };
  }

  /* ONE MODEL READ PER FORMAT PER BUILD (spec §11; 0147 model_reads). Consent
     says a new format goes to the model "một lần". Twelve shapes paid on every
     mail because their template could never be derived and nothing remembered
     the question had been asked. Now the fingerprint remembers: a transaction
     shape with no template and no format that this build has already sent
     once and learned nothing from is refused here, and the worker gives the
     mail up (it is released when the reader's code changes, never when the
     next mail arrives). Checked AFTER every free tier and the format tier, so
     a shape a seed or a learned format reads is never capped. */
  const build = (deps && deps.build) || null;
  if (build && fp && !fp._sender_wide && fp.is_transaction_source === true && !stored && !known
      && Number(fp.model_reads) >= 1 && fp.model_read_build === build) {
    await db.bumpReadTally?.('format_cap');
    return { ok: false, reason: 'format_cap' };
  }

  // ── stage 2: the model, on the mail as written ───────────────────────────
  // Budgeted by the caller. A model call is the only thing here that costs
  // money or leaves the machine, so the ceiling lives at the call site rather
  // than inside the thing being limited. Awaited: the worker's gate asks the
  // day's ledger (spend_model_budget) as well as the run's counter.
  if (deps.budget && !(await deps.budget.spend())) {
    throw new llm.LlmUnavailable('call budget exhausted for this run');
  }
  /* What this model read must record on the shape, whatever it learns: one
     more read, on this build. Merged into the fingerprint save below ONLY when
     the read produced neither a template nor a format; a shape that taught
     something is free again and its count is left alone. */
  const modelRead = build ? { model_reads: (Number(fp && !fp._sender_wide && fp.model_reads) || 0) + 1, model_read_build: build } : {};

  // The sender's class picks WHAT IS ASKED (one prompt block per class, llm.mjs).
  // WHAT IS SENT is unchanged: the sender, the subject, the mail as written.
  const extraction = await llm.extract(sender, message.subject, message.body, deps.llm, deps.fetch, senderKind);

  /* ONE MAIL, SEVERAL TRANSACTIONS (a broker's daily order summary). Its own
     outcome: not junk (the sender is a transaction source and the next mail may
     be a single trade), not unreadable (nothing failed), and never cached,
     because the cache key is the subject shape and a cached "junk" here would
     hide every single-trade mail that shares it. The worker parks it and the
     scoreboard counts it, so the real volume is known before anything is built
     (spec §8.3). */
  if (extraction && extraction.multi === true) {
    await db.bumpReadTally?.('multi');
    return { ok: false, reason: 'multi' };
  }

  /* A NOTICE moved no money and is NOT junk (spec §6): it is staged with
     row_kind 'notice', so its shape must stay a transaction source, or the
     second due notice off it is answered by the junk cache and never read. No
     template can come of it (no amount), so the read is counted against the
     shape like any unlearnable one: the next notice of this shape on this
     build is capped above, and a new build reads it again. */
  if (extraction && extraction.is_transaction !== true && extraction.mail_kind === 'notice') {
    await db.saveFingerprint({
      sender_address: sender, subject_template: template,
      is_transaction_source: true, transaction_type: null, extraction_regex: _templateToStore(null, stored, null),
      ...modelRead,
    });
    await db.bumpReadTally?.('llm_notice');
    const noticeSignal = detectSignal(extraction, { ...ctx, notice: true }).signal || extraction.signal || null;
    return { ok: false, reason: 'not_a_transaction', mailKind: 'notice',
      notice: { signal: noticeSignal, fields: extraction.notice || null, loan: extraction.loan || null } };
  }

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
    /* Still one model read on this shape, and it learned nothing: counted, so
       the next mail of the shape does not pay again on this build. Only when
       the shape is already a known source: a first mail that is unreadable
       says nothing about whether the shape is a source at all. */
    if (build && fp && !fp._sender_wide && fp.is_transaction_source === true) {
      await db.saveFingerprint({ sender_address: sender, subject_template: template,
        is_transaction_source: true, transaction_type: fp.transaction_type || null, extraction_regex: stored, ...modelRead });
    }
    return { ok: false, reason: 'unreadable', detail: 'no amount or direction' };
  }

  // Derive a template from THIS mail. `deriveExtractionTemplate` keeps it only
  // if it reproduces the model's own output on the very body it came from, and
  // returns a JSON string or null. A plausible-looking template that does not
  // actually work would silently serve wrong figures to every later mail off
  // this sender, and to the other transport as well. Storing null is the right
  // outcome then: the sender is confirmed as a transaction source, and the next
  // mail tries the model again rather than trusting an unproven template.
  // Stamped BEFORE the account-kind heuristic below fills its gap, so a kind
  // the model stated reads `model` and a kind the body scan supplied does not.
  extraction.src = _srcFor(extraction, SRC.MODEL);
  _fillAccountKind(extraction, message, sender);
  let derived = null, derivedStep = null;
  try {
    derived = deriveExtractionTemplate(message.body, extraction,
      (step) => { derivedStep = step; _noteDeriveFailure(db, sender, template, step); });
  } catch { derived = null; }

  /* THE FORMAT, from the labels the model CITED (core prompt rule 2). This is
     what makes "once per format" true: the labels it names become a label map,
     the map is replayed on this same mail, and only a map that reproduces the
     model's own answer is kept. No proof, no format. */
  if (extraction.time_precision == null) {
    extraction.time_precision = whenPrecision(extraction.occurred_at_raw);
    if (extraction.time_precision) extraction.src.time_precision = SRC.HEURISTIC;
  }
  const learnedFormat = await learnFormatFrom(extraction, 'model', extraction.labels);

  /* The shape is confirmed as a source either way. The read is COUNTED against
     it only when neither a template nor a format came of it: that is the shape
     the cap above refuses next time, on this build. */
  await db.saveFingerprint({
    sender_address: sender,
    subject_template: template,
    is_transaction_source: true,
    transaction_type: extraction.transaction_type || null,
    extraction_regex: _templateToStore(derived, stored, derivedStep),
    ...(derived || learnedFormat ? {} : modelRead),
  });

  await db.bumpReadTally?.('llm');
  await db.bumpReadTally?.(derived ? 'template_learned' : 'template_unlearnable');
  /* A transaction the table tier could not read is a dictionary gap. Log the
     LABELS the mail used — bank boilerplate, no values, no amounts, nothing
     personal — so coverage grows from real misses without storing anyone's
     mail. This is the only "training data" this pipeline collects. */
  await db.logMissLabels?.(sender, unknownLabels(message.body, extraction));
  /* And the mappings those labels imply — the model's answer beside the mail's
     own rows, inverted into label→field VOTES (deriveLabelMappings; applied
     only at n>=3, safe fields only, hardcoded vocabulary always first). Fire
     and forget with the same discipline as the failure recorder: a rejected
     promise from a telemetry write must never cost the transaction. */
  try {
    const learned = deriveLabelMappings(message.body, extraction);
    const dom = sender.slice(sender.lastIndexOf('@') + 1);
    for (const m of learned) {
      const lp = db.recordLearnedLabel?.(dom, m.label, m.field);
      if (lp && typeof lp.catch === 'function') lp.catch(() => {});
    }
  } catch { /* learning is optional; reading is not */ }
  return {
    ok: true,
    extraction: await _finish(extraction, message, ctx, db, true),
    stage: 'llm',
    tier: 'model',
    learned: !!derived || learnedFormat,
    transactionType: extraction.transaction_type || null,
  };
}

/* The v2 fields a v4 template cannot carry and the structural reader can. */
const V2_UPGRADE_FIELDS = ['time_precision', 'fee_amount', 'available_limit', 'holder_name',
  'counterparty_bank', 'counterparty_account_tail', 'txn_kind', 'counterparty_row'];

/* One in-memory store per process, holding the seeds and whatever this process
   learns, for a caller that injects none (every test, the scoreboard, and the
   worker until the formats table exists). */
let _memoryFormats = null;
function _defaultFormats(subtle) {
  if (!_memoryFormats) _memoryFormats = memoryFormatStore(subtle);
  return _memoryFormats;
}

/* Every field a tier filled, stamped with that tier's provenance. */
const _SRC_FIELDS = ['occurred_at', 'time_precision', 'amount', 'currency', 'fx_amount', 'fx_currency', 'fx_rate',
  'fee_amount', 'tax_amount', 'available_limit', 'direction', 'counterparty', 'counterparty_kind', 'holder_name',
  'counterparty_bank', 'counterparty_account_tail', 'memo', 'reference_number', 'status', 'account_masked',
  'account_kind', 'card_masked', 'balance', 'channel', 'signal', 'node', 'category', 'transaction_type',
  'investment', 'loan', 'notice'];
function _srcFor(extraction, src) {
  const out = {};
  for (const k of _SRC_FIELDS) if (extraction[k] != null) out[k] = src;
  return out;
}

/**
 * What runs after EVERY tier, in this order, on the tier's RAW output:
 *
 *   1. the holder's name from the greeting, when no row printed it
 *   2. who is on the other side (signals.mjs counterpartyKind)
 *   3. the channel
 *   4. the signal, and the node a signal maps to
 *   5. `_tidy`: masking, memo_display, the display merchant, the balance scan
 *
 * Before `_tidy` on purpose: a virtual-account prefix ("99MM…") is a seller
 * mark, and `_tidy` masks account numbers down to four digits.
 *
 * ON MODEL-READ MAIL THE DETECTOR IS A CROSS-CHECK (spec §8.4). Both answer and
 * agree: the signal stands. Both answer and disagree: the sealed signal is
 * NULL, and the row shows in "Cần bạn xem" on the device. The three outcomes
 * are tallied, so a detector that keeps contradicting the model is a number
 * someone can look at, not a silence.
 */
async function _finish(extraction, message, ctx, db, modelRead) {
  const x = extraction;
  const src = x.src = { ...(x.src || {}) };
  const heuristic = (field) => { if (x[field] != null) src[field] = SRC.HEURISTIC; };
  // account_kind was filled by the tier (its src is already stamped) or by
  // _fillAccountKind just before this, which is a body scan.
  if (x.account_kind != null && !src.account_kind) src.account_kind = SRC.HEURISTIC;

  if (!x.holder_name) { x.holder_name = greetingName(message.body); heuristic('holder_name'); }
  // The bank's own type code rides inside a structured memo ("…POS…",
  // "MOBILETOPUP"); `_tidy` splits it out below, and the detector wants it now.
  if (!x.type_code) { try { const code = tidyMemo(x.memo, message.body).code; if (code) x.type_code = code; } catch { /* _tidy decides */ } }

  const who = counterpartyKind(x, ctx);
  x.counterparty_kind = who.kind;
  if (who.kind) src.counterparty_kind = who.src; else delete src.counterparty_kind;

  const ch = detectChannel(x, ctx);
  x.channel = ch.channel;
  if (ch.channel) src.channel = ch.src; else delete src.channel;

  const modelSignal = modelRead ? x.signal : null;
  const modelNode = modelRead ? x.node : null;
  const detected = detectSignal(x, ctx);
  let verdict;
  if (modelRead) {
    verdict = crossCheckSignal(detected, modelSignal, modelNode);
    await db.bumpReadTally?.(verdict.outcome === 'agree' ? 'signal_agree'
      : verdict.outcome === 'disagree' ? 'signal_disagree'
      : verdict.outcome === 'one_sided' ? 'signal_one_sided' : 'signal_none');
  } else {
    verdict = detected;   // graded by the detector: printed | template | heuristic
  }
  x.signal = verdict.signal;
  /* `src.signal` is kept on a DISAGREEMENT, where the signal itself is null:
     that pair is how the device tells "withdrawn" from "the mail never said". */
  if (verdict.src) src.signal = verdict.src; else delete src.signal;
  delete x.signal_hint;
  /* The node a signal maps to. For purchase and p2p the contract says null: the
     merchant path decides (classify.mjs enrichCategory). The WHO nodes
     ('purchase', 'bizpay', 'p2p') are deliberately NOT sealed from here: the
     device reads a sealed node FIRST, ahead of every tier that knows what was
     bought, so a who-node in the box would displace a what-answer (E14a). It
     has `signal` and `counterparty_kind` to place its own who-tier last. A
     model's node stands only where no signal contradicts it. */
  if (verdict.node) { x.node = verdict.node; src.node = verdict.src; }
  else if (modelRead && verdict.outcome === 'disagree') { x.node = null; delete src.node; }

  return _tidy(x, message.body);
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
  // The repaid card (card-repayment-routing-spec.md) gets the same last-4-only
  // treatment as account_masked, whichever tier filled it. maskAccount(null)
  // returns null, so the no-card case is untouched.
  out.card_masked = maskAccount(out.card_masked);
  // ...and the OTHER side's account, by the same rule (email-reading-v2 §4).
  out.counterparty_account_tail = maskAccount(out.counterparty_account_tail) ?? null;
  // every tier's provider leaves canonical — template statics included, which
  // is what heals the names already frozen at derivation without touching them.
  // The healing now goes through the provider registry first (account-identity
  // spec §3): a spelling the registry knows leaves as its LABEL, and the sender
  // table's canon stays as the fallback so prose the registry has never seen
  // heals exactly as it did before.
  {
    const hit = FH_PROVIDERS.resolve(out.source_provider);
    out.source_provider = hit ? hit.label : canonProviderName(out.source_provider);
  }
  const tidy = tidyMemo(out.memo, body);
  out.memo_display = tidy.description;
  if (tidy.code) out.type_code = tidy.code;

  if (out.counterparty) {
    const merchant = tidyMerchant(out.counterparty);
    if (merchant === '') out.counterparty = null;
    else if (merchant && merchant !== out.counterparty) out.counterparty_display = merchant;
  }
  /* balance-after (full-ledger spec §7.4): the label-table tier reads it as a
     field; the template and model tiers usually don't. A deposit notice signs
     off with "Số dư: 11.800.000 VND", so a cheap body scan fills the gap —
     fail-quiet, because a missing balance only mutes the client's drift
     detector, never a transaction. */
  const src = out.src = { ...(out.src || {}) };
  if (out.balance == null) { out.balance = _balanceAfter(body); if (out.balance != null) src.balance = SRC.HEURISTIC; }
  // What this function derives is a judgement over free text, whoever read the
  // mail: the display memo, the bank's type code, the display merchant.
  if (out.memo_display) src.memo_display = SRC.HEURISTIC;
  if (out.type_code) src.type_code = SRC.HEURISTIC;
  if (out.counterparty_display) src.counterparty_display = SRC.HEURISTIC;
  if (!out.counterparty) { delete src.counterparty; delete src.counterparty_kind; out.counterparty_kind = null; }
  return out;
}

/** "Số dư (khả dụng/cuối/hiện tại): 12.345.678 (VND|đ)" → 12345678, else null.
 *  Deburred + lowercased before matching, so the mail's own diacritics (or a
 *  bank's lack of them) don't decide coverage. VND has no decimals in these
 *  notices — separators are thousands marks and are simply stripped. */
function _balanceAfter(body) {
  try {
    const flat = String(body || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase();
    const m = flat.match(/so\s*du(?:\s*(?:kha\s*dung|cuoi|hien\s*tai|tai\s*khoan))?\s*[:\-]?\s*(?:vnd\s*)?([\d][\d.,\s]{2,18}[\d])/);
    if (!m) return null;
    const n = Number(m[1].replace(/[^\d]/g, ''));
    return (n > 0 && n < 1e13) ? n : null;
  } catch { return null; }
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
