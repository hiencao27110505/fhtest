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

var MAX_NEW_CLASSIFICATIONS_PER_RUN = 10;
var MAX_NEW_CLASSIFICATIONS_PER_DAY = 50;
var DEDUPE_WINDOW_DAYS = 3;
// How long to keep retrying an email whose +tag matches no mailbox_connections
// row. Long enough to cover "set up forwarding, onboard the app a few days
// later"; short enough that a genuine misconfiguration surfaces.
var ROUTING_GRACE_DAYS = 14;

function processEmails() {
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
  var threads = GmailApp.search(
    'label:txn/inbox OR (from:' + FORWARDING_CONFIRM_SENDER + ' is:unread newer_than:7d)');
  if (threads.length === 0) return;

  var txnLabel = GmailApp.getUserLabelByName('txn/inbox');
  var txnThreads = [];
  for (var i = 0; i < threads.length; i++) {
    if (_threadHasLabel(threads[i], txnLabel)) {
      txnThreads.push(threads[i]);
    } else {
      // A forwarding confirmation. Wrapped per-thread so one bad confirmation
      // cannot stop the transactions in the same batch — the reason these were
      // once on separate triggers.
      try {
        var cms = threads[i].getMessages();
        for (var c = 0; c < cms.length; c++) handleForwardingConfirmation(cms[c]);
      } catch (err) {
        Logger.log('forwarding confirmation failed: ' + err);
      }
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
}

function processOneMessage(message, runCallCount) {
  var sender = extractEmailAddress(message.getFrom());
  var subject = message.getSubject();
  var body = message.getPlainBody();
  var gmailMessageId = message.getId();
  var template = normalizeSubjectTemplate(subject);

  var fingerprint = findFingerprint(sender, template);
  var extraction = null;

  if (fingerprint && fingerprint.is_transaction_source === false) {
    relabelMessageThread(message, 'txn/processed');
    return runCallCount;
  }

  if (fingerprint && fingerprint.extraction_regex) {
    extraction = tryRegexExtract(fingerprint.extraction_regex, body);
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

  // ── routing gate ──────────────────────────────────────────────────────────
  // A row's ONLY link to a family is member_id -> members.family_id. With no
  // member_id there is no family linkage at all, so such a row can never be
  // shown to anyone: scoping it to a family is impossible, and showing it
  // family-wide would mean showing one household's transaction to every other.
  // Staging it anyway just accumulates data that is permanently unsurfaceable.
  //
  // So: hold it in txn/inbox instead. The overwhelmingly likely cause is that
  // the user has not finished mailbox onboarding yet (nothing writes
  // mailbox_connections today), and the moment they do, the next run routes
  // this same email correctly — no re-forwarding needed, nothing lost.
  //
  // Bounded so it cannot queue forever: past ROUTING_GRACE_DAYS we stop hoping,
  // record it, and move it out of the queue so the backlog cannot grow without
  // limit or hide a real misconfiguration.
  var mailbox = resolveMailbox(message);
  if (!mailbox) {
    var ageDays = (new Date().getTime() - message.getDate().getTime()) / 86400000;
    if (ageDays < ROUTING_GRACE_DAYS) {
      Logger.log('unroutable (no mailbox_connections for its +tag), holding for retry: ' + gmailMessageId);
      return runCallCount;   // stays labeled txn/inbox
    }
    insertParseFailure(message, 'unroutable_after_grace: no mailbox_connections match after ' +
      ROUTING_GRACE_DAYS + ' days — mailbox onboarding likely never completed');
    relabelMessageThread(message, 'txn/parse-failed');
    return runCallCount;
  }

  var dup = findDuplicate(extraction.amount, extraction.direction, extraction.occurred_at, extraction.source_provider);
  var memberId = mailbox.member_id;
  var row = buildEmailTransactionRow(gmailMessageId, sender, extraction, body, dup, memberId);
  row.raw_extracted = Object.assign({}, row.raw_extracted, { _sender_auth: auth });

  var inserted = insertEmailTransaction(row);
  if (!inserted) {
    insertParseFailure(message, 'email_transactions insert failed');
    relabelMessageThread(message, 'txn/parse-failed');
    return runCallCount;
  }

  relabelMessageThread(message, 'txn/processed');

  return runCallCount;
}

// ---------- Stage 0 helpers ----------

function extractEmailAddress(fromHeader) {
  var match = fromHeader.match(/<(.+)>/);
  return match ? match[1] : fromHeader;
}

function normalizeSubjectTemplate(subject) {
  return subject
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
  thread.removeLabel(GmailApp.getUserLabelByName('txn/inbox'));
  thread.addLabel(GmailApp.getUserLabelByName(labelName));
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

// ---------- Masking: no real customer data ever leaves for a third party ----------
// The subject+body are masked BEFORE any LLM call — unconditionally, no enc-state
// check, per the product promise ("no one knows your data except you"). Each
// sensitive token is replaced by a fake with the same SHAPE (digit count,
// separators, caps), the LLM extracts against the fake text, and unmaskExtraction()
// swaps the real values back in locally. Dates/times stay real (the model must
// resolve their format; they identify no one alone). Verified end-to-end against
// the live Gemini API on the real MB Bank sample, 2026-08-06: identical
// classification + extraction quality, zero real values sent.
// Sibling of the app's fhMaskSampleRowsForSharing (43-redact-for-sharing.js) —
// same idea, adapted for unstructured email text instead of CSV rows.

var FAKE_NAMES = ['TRAN VAN BAO', 'LE THI MAI', 'PHAM MINH DUC', 'HOANG THU HA', 'VU QUOC ANH'];
// caps runs containing any of these words are institutional, not personal — leave them
var CAPS_BLOCKLIST = { VND: 1, USD: 1, EUR: 1, MB: 1, BANK: 1, EBANKING: 1, ATM: 1, NAPAS: 1, QR: 1, PBC: 1, INC: 1, LLC: 1, JSC: 1, TMCP: 1, OTP: 1 };

function maskForSharing(text) {
  var pairs = [];   // [{masked, original}] string swaps, applied longest-first on the way back
  var numMap = {};  // masked numeric value -> original numeric value (amount comes back as a number)
  var holes = [];   // protected date/time spans, restored verbatim

  var out = String(text || '');

  // 1. protect date/time spans from the digit pass
  out = out.replace(/\b\d{1,4}[-\/]\d{1,2}[-\/]\d{1,4}(?:[ T]\d{1,2}:\d{2}(?::\d{2})?)?\b|\b\d{1,2}:\d{2}(?::\d{2})?\b/g, function (m) {
    holes.push(m);
    return '\x00' + (holes.length - 1) + '\x00';
  });

  // 2. email addresses in the body (the recipient's own address is personal data)
  out = out.replace(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, function (m) {
    var masked = 'user' + Math.floor(Math.random() * 9000 + 1000) + '@example.com';
    pairs.push({ masked: masked, original: m });
    return masked;
  });

  // 3. ALL-CAPS name runs (Vietnamese bank emails write personal names in caps)
  var nameSeen = {};
  out = out.replace(/\b[A-Z]{2,}(?: [A-Z]{2,}){1,5}\b/g, function (m) {
    var words = m.split(' ');
    for (var i = 0; i < words.length; i++) if (CAPS_BLOCKLIST[words[i]]) return m;
    if (!nameSeen[m]) {
      var fake = FAKE_NAMES[Object.keys(nameSeen).length % FAKE_NAMES.length];
      nameSeen[m] = fake;
      pairs.push({ masked: fake, original: m });
    }
    return nameSeen[m];
  });

  // 4. digit tokens (amounts, accounts, refs, phones): random digits, same shape.
  //    Leading 0 stays 0 (phones), other leading digits stay nonzero (amounts).
  var digitSeen = {};
  out = out.replace(/\d(?:[\d.,]*\d)?/g, function (m) {
    if ((m.match(/\d/g) || []).length < 2) return m;   // lone digits carry ~nothing
    if (digitSeen[m]) return digitSeen[m];
    var masked = '', first = true;
    for (var i = 0; i < m.length; i++) {
      var c = m[i];
      if (c < '0' || c > '9') { masked += c; continue; }
      if (first) {
        masked += (c === '0') ? '0' : String(Math.floor(Math.random() * 9) + 1);
        first = false;
      } else {
        masked += String(Math.floor(Math.random() * 10));
      }
    }
    digitSeen[m] = masked;
    pairs.push({ masked: masked, original: m });
    var numOrig = parseFloat(m.replace(/,/g, ''));
    var numMasked = parseFloat(masked.replace(/,/g, ''));
    if (!isNaN(numOrig) && !isNaN(numMasked)) numMap[String(numMasked)] = numOrig;
    return masked;
  });

  // 5. restore the protected date/time spans
  out = out.replace(/\x00(\d+)\x00/g, function (_, i) { return holes[Number(i)]; });

  return { text: out, pairs: pairs, numMap: numMap };
}

// Swaps real values back into the LLM's extraction output. String fields get
// longest-first substring replacement; numeric fields go through numMap.
function unmaskExtraction(extraction, mask) {
  var sorted = mask.pairs.slice().sort(function (a, b) { return b.masked.length - a.masked.length; });
  var out = {};
  for (var key in extraction) {
    var v = extraction[key];
    if (typeof v === 'string') {
      for (var i = 0; i < sorted.length; i++) v = v.split(sorted[i].masked).join(sorted[i].original);
      out[key] = v;
    } else if (typeof v === 'number' && mask.numMap[String(v)] !== undefined) {
      out[key] = mask.numMap[String(v)];
    } else {
      out[key] = v;
    }
  }
  return out;
}

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
  'states a status (success/failed/pending), extract it; otherwise null.';

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
    direction: { type: ['string', 'null'], enum: ['debit', 'credit', null] },
    counterparty: { type: ['string', 'null'] },
    memo: { type: ['string', 'null'] },
    reference_number: { type: ['string', 'null'] },
    status: { type: ['string', 'null'] },
    account_masked: { type: ['string', 'null'] },
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

  // Same masking contract as the Gemini path — swapping models never drops it.
  var mask = maskForSharing('Subject: ' + subject + '\n\n' + body);

  var payload = {
    model: 'claude-haiku-4-5',
    max_tokens: 512,
    system: EXTRACTION_SYSTEM_PROMPT,
    output_config: { format: { type: 'json_schema', schema: EXTRACTION_SCHEMA } },
    messages: [{
      role: 'user',
      content: 'Sender: ' + sender + '\n' + mask.text,
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
  return unmaskExtraction(JSON.parse(data.content[0].text), mask);
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

  // Mask subject+body together (shared token map); the sender line stays real —
  // it's the bank's address, needed for classification, and not customer data.
  var mask = maskForSharing('Subject: ' + subject + '\n\n' + body);

  var payload = {
    systemInstruction: { parts: [{ text: EXTRACTION_SYSTEM_PROMPT }] },
    contents: [{
      role: 'user',
      parts: [{ text: 'Sender: ' + sender + '\n' + mask.text }],
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
  return unmaskExtraction(JSON.parse(data.candidates[0].content.parts[0].text), mask);
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
// parsed by applyExtractionTemplate() with ZERO LLM involvement: no cost, no
// data leaving anywhere (masking already covers the LLM path; this removes the
// call entirely). A structurally different email (e.g. the credit variant of a
// debit notification) fails the anchors → falls back to the LLM → re-derives.
// Templates carry EXTRACTION_LOGIC_VERSION — bump it after any prompt/logic
// improvement and every stored template self-invalidates, forcing one fresh
// LLM re-derivation per sender ("the cheat sheet stays current").
// Tested locally 2026-08-06: derive-from-real-MB-structure, apply-to-variant
// (different amount/name/ref/time), reject-different-structure, reject-stale-
// version, reject-legacy-placeholder, self-reproduction — all pass.

var EXTRACTION_LOGIC_VERSION = 3;

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
  return null;
}
var _DATE_KINDS = ['dmy_hms', 'dmy_slash_hms', 'ymd_hms'];
var _DATE_RAW_RE = /\d{1,4}[-\/]\d{1,2}[-\/]\d{1,4}(?:[ T]\d{1,2}:\d{2}(?::\d{2})?)?/g;

// find the stable label text that precedes a value; returns {re} or null.
function _deriveAnchor(body, rawValue, valuePatterns) {
  var idx = body.indexOf(rawValue);
  if (idx < 0) return null;
  var lineStart = body.lastIndexOf('\n', idx - 1) + 1;
  var samePrefix = body.slice(lineStart, idx);
  var trials = [];
  if (samePrefix.trim().length >= 2) {
    trials.push({ label: samePrefix.trim(), joiner: '[^\\S\\n]*' });
  }
  var cursor = lineStart - 1;
  while (cursor > 0 && /\s/.test(body[cursor])) cursor--;
  if (cursor > 0) {
    var prevStart = body.lastIndexOf('\n', cursor - 1) + 1;
    var prevLine = body.slice(prevStart, cursor + 1).trim();
    if (prevLine.length >= 2) trials.push({ label: prevLine, joiner: '\\s*\\n\\s*' + _escRe(samePrefix.trim()) + (samePrefix.trim() ? '[^\\S\\n]*' : '') });
  }
  for (var t = 0; t < trials.length; t++) {
    for (var p = 0; p < valuePatterns.length; p++) {
      var src = _escRe(trials[t].label) + trials[t].joiner + valuePatterns[p];
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
  if (type === 'number') { pats.push('(-?[\\d.,]+)'); return pats; }
  pats.push('([^\\n]+)');
  if (/^\d+$/.test(rawValue)) pats.push('(\\d{' + Math.max(4, rawValue.length - 4) + ',})');
  pats.push('(' + _escRe(rawValue).replace(/\d+/g, '\\d+') + ')');
  return pats;
}

function deriveExtractionTemplate(body, extraction) {
  if (!extraction || extraction.is_transaction !== true) return null;
  var tpl = { v: EXTRACTION_LOGIC_VERSION, static: {}, fields: {} };

  // constants for this (sender, subject_template) email kind — protected by the
  // anchors: a structurally different email fails them and falls back to the LLM
  tpl.static.transaction_type = extraction.transaction_type != null ? extraction.transaction_type : null;
  tpl.static.source_provider = extraction.source_provider != null ? extraction.source_provider : null;
  tpl.static.currency = extraction.currency != null ? extraction.currency : null;
  tpl.static.direction = extraction.direction != null ? extraction.direction : null;
  tpl.static.status = extraction.status != null ? extraction.status : null;

  if (typeof extraction.occurred_at !== 'string') return null;
  var offM = extraction.occurred_at.match(/([+-]\d{2}:\d{2}|Z)$/);
  var offset = offM ? offM[1] : '+07:00';
  var found = null;
  var rawDates = body.match(_DATE_RAW_RE) || [];
  for (var d = 0; d < rawDates.length && !found; d++) {
    for (var k = 0; k < _DATE_KINDS.length && !found; k++) {
      if (_tryDateTransform(rawDates[d], _DATE_KINDS[k], offset) === extraction.occurred_at) {
        var anch = _deriveAnchor(body, rawDates[d], ['([\\d\\-\\/ T:]+?)(?=\\s*$|\\s*\\n)', '([\\d\\-\\/ T:]+)']);
        if (anch) found = { re: anch.re, dt: _DATE_KINDS[k], off: offset };
      }
    }
  }
  if (!found) return null;
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
  if (!amtSpec) return null;
  tpl.fields.amount = amtSpec;

  // varying string fields — anchored if present; a present-but-unanchorable
  // value fails the whole derivation (never silently degrade vs the LLM path)
  var strFields = ['counterparty', 'reference_number', 'account_masked'];
  for (var f = 0; f < strFields.length; f++) {
    var name = strFields[f], val = extraction[name];
    if (val === null || val === undefined || val === '') { tpl.static[name] = null; continue; }
    var spec = _deriveAnchor(body, String(val), _valuePatternsFor(String(val), 'string'));
    if (!spec) return null;
    tpl.fields[name] = spec;
  }

  // final proof: the template must reproduce the LLM's extraction exactly
  var check = applyExtractionTemplate(JSON.stringify(tpl), body);
  if (!check) return null;
  var keys = ['transaction_type', 'source_provider', 'occurred_at', 'amount', 'currency', 'direction', 'counterparty', 'reference_number', 'status', 'account_masked'];
  for (var i = 0; i < keys.length; i++) {
    var a2 = check[keys[i]], b2 = extraction[keys[i]];
    if (String(a2 === undefined ? null : a2) !== String(b2 === undefined ? null : b2)) return null;
  }
  return JSON.stringify(tpl);
}

// run a stored template against a new email body → extraction object or null
function applyExtractionTemplate(tplJson, body) {
  if (!tplJson || tplJson[0] !== '{') return null;   // legacy placeholder strings → LLM
  var tpl;
  try { tpl = JSON.parse(tplJson); } catch (e) { return null; }
  if (tpl.v !== EXTRACTION_LOGIC_VERSION) return null;   // stale → re-derive via LLM

  var out = { is_transaction: true };
  for (var s in tpl.static) out[s] = tpl.static[s];

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
    } else {
      out[f] = raw;
    }
  }
  if (typeof out.amount !== 'number' || typeof out.occurred_at !== 'string') return null;
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
    var dm = authResults.match(/header\.d=([^\s;]+)/i);
    var signing = dm ? dm[1].toLowerCase() : null;
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
  if (!mailbox) {
    results.forwarder = 'no_mailbox';
    results.reasons.push('alias not found in mailbox_connections');
  } else if (!fwd) {
    results.forwarder = 'absent';
    results.reasons.push('no X-Forwarded-For header');
  } else if (mailbox.personal_email &&
             fwd.toLowerCase().indexOf(String(mailbox.personal_email).toLowerCase()) === -1) {
    results.forwarder = 'mismatch';
    results.reasons.push('forwarded by ' + fwd + ', alias belongs to ' + mailbox.personal_email);
  } else {
    results.forwarder = 'pass';
  }

  results.ok = (results.dkim === 'pass' && results.forwarder === 'pass');
  return results;
}

// ---------- Stage 2 helpers ----------

function findDuplicate(amount, direction, occurredAt, sourceProvider) {
  if (!amount || !occurredAt) return null;
  var occurred = new Date(occurredAt);
  var windowStart = new Date(occurred.getTime() - DEDUPE_WINDOW_DAYS * 86400000).toISOString();
  var windowEnd = new Date(occurred.getTime() + DEDUPE_WINDOW_DAYS * 86400000).toISOString();

  // Only cross-source matches count as duplicates (e.g. a bank email and a merchant
  // receipt for the same purchase). Two emails from the SAME provider are never
  // duplicates of each other here — each already carries its own gmail_message_id
  // and reference_number, so same-provider + same-amount + same-day is a real,
  // separate transaction (e.g. two same-amount transfers made minutes apart),
  // not a re-report of one event.
  var rows = supabaseGet('email_transactions', {
    amount: 'eq.' + amount,
    direction: 'eq.' + direction,
    occurred_at: 'gte.' + windowStart,
    source_provider: 'neq.' + sourceProvider,
    duplicate_of_id: 'is.null',
  });
  var earliest = null;
  for (var i = 0; i < rows.length; i++) {
    if (rows[i].occurred_at <= windowEnd) {
      if (!earliest || rows[i].created_at < earliest.created_at) earliest = rows[i];
    }
  }
  return earliest;
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
    counterparty: extraction.counterparty,
    reference_number: extraction.reference_number,
    raw_body: body,
    raw_extracted: extraction,
    review_status: 'pending',
    duplicate_of_id: dup ? dup.id : null,
    member_id: memberId,  // null if unresolved — row still gets written, just orphaned until a mailbox_connections match exists
  };
}

function insertEmailTransaction(row) {
  return supabasePost('email_transactions', row, null);
}

// Resolves which family member this email belongs to via the +tag on the receiving
// address (e.g. 'trang' from gichisreading+trang@gmail.com) — storage only, not used
// for any promotion decision. Returns null if the tag is missing or unrecognized;
// the row still gets written, just without routing info until mailbox_connections
// has a matching entry.
function resolveMailbox(message) {
  var alias = extractPlusTag(message.getTo());
  if (!alias) return null;
  var rows = supabaseGet('mailbox_connections', { forwarding_alias: 'eq.' + alias });
  return rows.length ? rows[0] : null;
}

function resolveMemberId(message) {
  var mailbox = resolveMailbox(message);
  return mailbox ? mailbox.member_id : null;
}

function extractPlusTag(toHeader) {
  var match = toHeader.match(/\+([^@]+)@/);
  return match ? match[1] : null;
}

function insertParseFailure(message, reason) {
  supabasePost('parse_failures', {
    gmail_message_id: message.getId(),
    sender: extractEmailAddress(message.getFrom()),
    subject: message.getSubject(),
    raw_body: message.getPlainBody(),
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
  // Unread only: a handled confirmation is marked read, so this naturally stops
  // reprocessing without needing its own state.
  var threads = GmailApp.search('from:' + FORWARDING_CONFIRM_SENDER + ' is:unread newer_than:7d');
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

  // Clicking is a plain GET. muteHttpExceptions so a non-200 is inspected rather
  // than thrown — Google answers 200 for an already-confirmed link too, which is
  // why re-running is harmless.
  var response = UrlFetchApp.fetch(link, { muteHttpExceptions: true, followRedirects: true });
  var code = response.getResponseCode();
  if (code < 200 || code >= 400) {
    throw new Error('confirm link returned HTTP ' + code);
  }

  supabasePatch('mailbox_connections', { forwarding_alias: 'eq.' + alias }, { verified: true });
  message.markRead();
  Logger.log('forwarding confirmed for alias ' + alias);
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

// ---------- Supabase REST helpers ----------

// All Supabase traffic goes through here so an HTTP failure can never be mistaken
// for a result. PostgREST answers errors with a JSON *object* ({code, message,...}),
// which is truthy and parses fine — so callers checking `if (!result)` or reading
// `rows.length` silently treated outages and schema mismatches as success/empty.
// Failures throw with a SUPABASE_ prefix so processEmails() can tell "the database
// is unhappy" (retry later, keep the message queued) apart from "this email is
// unparseable" (record it, stop retrying).
function _supabaseFetch(url, options) {
  var response = UrlFetchApp.fetch(url, options);
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
