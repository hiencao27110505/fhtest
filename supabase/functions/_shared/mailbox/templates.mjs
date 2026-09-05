/**
 * Extraction templates: parse a repeat sender with no model involved.
 *
 * VERBATIM COPY of the slice in pipeline/bank-email-pipeline.gs between
 * `var EXTRACTION_LOGIC_VERSION` and `function upsertFingerprint`, with an
 * export block appended and nothing else changed. It is copied rather than
 * rewritten because a hand-port of 200 lines of anchor derivation is a
 * transcription-error machine, and because the two implementations have to
 * agree exactly: both transports share `sender_fingerprints`, so a template
 * derived by the Apps Script is READ by this worker and the other way round.
 * A divergence would not throw. It would return a different amount.
 *
 * READ, not "applied" — corrected 2026-08-31, and the difference is the whole
 * bug. Sharing the row is not the same as sharing an answer. These anchors are
 * regexes over the RENDERED body, and the two transports render differently:
 * the Apps Script takes Gmail's `getPlainBody()` (a table row flattened onto
 * one line, bold as `*At*`), while this worker prefers the mail's text/plain
 * part and, when there is none, flattens the HTML itself (label and value on
 * separate lines). Where a bank sends a text/plain part they agree. On an
 * HTML-ONLY mail they cannot, and a template derived under one form misses
 * under the other — returning the same `null` as "this bank changed its
 * layout", which is why it went unnoticed for weeks. Keeping the two copies
 * identical is still necessary; it was never sufficient. `template_missed` in
 * read_tally counts the gap.
 *
 * pipeline/direct-templates.test.js re-slices the .gs AT TEST TIME and runs both
 * copies over the same bodies, so this file cannot quietly fall behind.
 *
 * WHERE THE SLICE ENDS, AND WHY IT MATTERS. It stops at `upsertFingerprint`,
 * which is the first FORWARDING-specific function in that file. Everything past
 * it — the fingerprint upsert through `supabasePost`, `senderAuthEnforced`
 * reading a Script Property, and `checkSenderAuthenticity` resolving a `+tag`
 * against `mailbox_connections` — belongs to a transport this worker does not
 * use, and calls globals that do not exist here. An earlier cut of this file
 * included all of it: dead, unreachable, and misleading in exactly the place
 * someone would look to answer "does the direct-read path touch the shared
 * forwarding inbox?". It does not, and the file should not read as if it might.
 * This worker does its own sender authenticity in gmail.mjs, from the DKIM
 * verdict on the message, because there is no forwarder to compare against.
 *
 * WHY THIS PATH MATTERS MORE SINCE MASKING WAS REMOVED: it never reaches a model
 * at all, which is most volume permanently and is the half of the consent copy
 * promising mail stays here. Every mail this file parses is one that is not sent
 * anywhere.
 *
 * The code below is ES5 by inheritance, not by preference. Leave it that way:
 * the diff against the .gs slice is the thing keeping the two honest.
 */

var EXTRACTION_LOGIC_VERSION = 4;   // 4: memo anchored + verified. account_kind is filled by the
                                    // per-read heuristic (_fillAccountKind) on EVERY tier including
                                    // template reads, so it needs no version bump — bumping to 5 to
                                    // freeze it as a static forced a mass re-derivation that exceeded
                                    // MAX_MODEL_CALLS_PER_GRANT and stalled backfills (2026-09-02).

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
    // Space grouping — "1 234 567 đ" — printed by several VN banks and covered
    // by no candidate until BVBank's 'amount' failures arrived (2026-09-05).
    var spGroup = intStr.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
    if (spGroup !== intStr) out.push({ raw: spGroup, parse: 'sp' });
  } else {
    out.push({ raw: intStr + '.' + fr2, parse: 'us' });
  }
  if (neg) out = out.map(function (c) { return { raw: '-' + c.raw, parse: c.parse }; });
  return out;
}

function _parseAmount(raw, mode) {
  var s = String(raw).trim();
  if (mode === 'sp') s = s.replace(/ /g, '');
  else if (mode === 'us') s = s.replace(/,/g, '');
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
    // Space-grouped: "1 234 567". Its own pattern rather than a space in the
    // charset above, so an ordinary amount never greedily eats trailing spaces.
    pats.push('(?:[-+][^\\S\\n]*)?(\\d{1,3}(?: \\d{3})+)');
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
/* The đồng, in every spelling the model copies out of real mail: the symbol,
   VNĐ, a bare đ/d, 'dong', any casing. The guard below refuses non-VND — which
   is right for USD and was WRONG for '₫': its first day in production refused
   two genuinely-VND shapes (MoMo train ticket, VIB card bill) as 'foreign',
   quietly re-creating the model-call-per-mail disease the graduation fixes had
   just cured. Strict equality on a model-spelt string is a fixture that only
   ever met one spelling. template_derive_failures caught it in one day. */
function _canonCurrency(c) {
  var flat = _akNorm(c).replace(/[^a-z$\u20ac\u00a3\u00a5\u20ab]/g, '');
  if (flat === '' || flat === 'vnd' || flat === 'vn' || flat === 'd' || flat === 'dong' || flat === '\u20ab') return 'VND';
  return String(c).trim().toUpperCase();
}

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
  if (extraction.currency != null && _canonCurrency(extraction.currency) !== 'VND') return fail('foreign_currency');
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
  if (!found) {
    /* Three different diseases hid under one word. 'date:no_candidate' — the
       scanner saw nothing date-shaped at all (a format we do not recognise);
       'date:format' — candidates existed but no known kind reproduces the
       reading's instant (new ordering, or the model read a different row).
       Sub-steps carry NO values — self-diagnosis without anyone's mail. */
    return fail(rawDates.length === 0 ? 'date:no_candidate' : 'date:format');
  }
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
  if (!amtSpec) {
    /* 'amount:absent' — no printable form of the reading's amount appears in
       the body verbatim (grouping mismatch: the mail says 1.234.567, the
       candidates spell 1,234,567 — or the model read a different number).
       'amount:anchor' — the number is there but nothing stable precedes it. */
    var sawAmount = false;
    for (var sc = 0; sc < cands.length; sc++) { if (body.indexOf(cands[sc].raw) >= 0) { sawAmount = true; break; } }
    return fail(sawAmount ? 'amount:anchor' : 'amount:absent');
  }
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
      /* Same split 'amount' needed: absent-from-body and unanchorable are
         different diseases with different fixes. Still no values recorded. */
      return fail((body.indexOf(String(val)) < 0 ? 'absent:' : 'anchor:') + name);
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

export {
  EXTRACTION_LOGIC_VERSION,
  deriveAccountKind,
  deriveExtractionTemplate,
  applyExtractionTemplate,
};
