/**
 * Extraction templates: parse a repeat sender with no model involved.
 *
 * VERBATIM COPY of the slice in pipeline/bank-email-pipeline.gs between
 * `var EXTRACTION_LOGIC_VERSION` and `// ---------- Stage 2 helpers ----------`,
 * with an export block appended and nothing else changed. It is copied rather
 * than rewritten because a hand-port of 350 lines of anchor derivation is a
 * transcription-error machine, and because the two implementations have to
 * agree exactly: both transports share `sender_fingerprints`, so a template
 * derived by the Apps Script is applied by this worker and the other way round.
 * A divergence would not throw. It would return a different amount.
 *
 * pipeline/direct-templates.test.js re-slices the .gs AT TEST TIME and runs both
 * copies over the same bodies, so this file cannot quietly fall behind.
 *
 * WHY THIS MATTERS MORE SINCE MASKING WAS REMOVED: the template path is the one
 * that never reaches a model at all, which is most volume permanently and is the
 * half of the consent copy that promises mail stays here. Every mail this file
 * parses is a mail that is not sent anywhere.
 *
 * The code below is ES5 by inheritance, not by preference. Leave it that way:
 * the diff against the .gs slice is the thing keeping the two honest.
 */

var EXTRACTION_LOGIC_VERSION = 4;   // 4: memo is anchored + verified (3 silently dropped it)

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
  // memo belongs here even though it is the hardest to anchor: it is the only
  // field carrying WHY the money moved, and the seed for the description a human
  // writes at review. Leaving it out meant the FIRST email from a sender kept its
  // memo (LLM path) and every email after it lost one (template path) — silently,
  // and on the path that carries most volume permanently.
  var strFields = ['counterparty', 'reference_number', 'account_masked', 'memo'];
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
  // memo is checked here too. It was missing, which is why the derivation above
  // could drop it and still pass its own "reproduces the LLM exactly" proof — a
  // verification that does not cover a field cannot protect it.
  var keys = ['transaction_type', 'source_provider', 'occurred_at', 'amount', 'currency', 'direction', 'counterparty', 'reference_number', 'status', 'account_masked', 'memo'];
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

export {
  EXTRACTION_LOGIC_VERSION,
  deriveExtractionTemplate,
  applyExtractionTemplate,
};
