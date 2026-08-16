// Extraction core — masking, LLM contract, and local extraction templates.
//
// This is the Node port of the pure logic in `bank-email-pipeline.gs`, for the
// direct-read (OAuth) path that runs in `api/`. It is a PORT, not a rewrite:
// the algorithms are the ones proven against real Vietnamese bank mail since
// 2026-08. `pipeline/lib-extract.test.js` evals the .gs functions and asserts
// this file behaves identically, so the two implementations cannot drift
// silently while both are live.
//
// Do not "improve" the algorithms here alone. The .gs is the deployed
// forwarding pipeline with real transactions flowing through it; a change that
// lands only here breaks parity, and the test will say so.
//
// Two deliberate differences from the .gs, both covered in the test:
//
//   1. The masker takes an injectable `rng`. The .gs calls Math.random()
//      directly, which makes its output untestable. Default is Math.random,
//      so production behaviour is unchanged.
//
//   2. A slightly more permissive memo rule at DERIVE time — see
//      `_memoIsRequired`. The stored formats are identical either way, so both
//      sides apply each other's templates correctly.
//
// ── Template version interop ───────────────────────────────────────────────
// Both pipelines share the `sender_fingerprints` table, keyed
// (sender_address, subject_template), and the .gs upserts on that exact
// constraint — so both sides see each other's templates.
//
// **Both sides are now v4** (the .gs bumped EXTRACTION_LOGIC_VERSION to 4 and
// added 'memo' to its strFields on 2026-08-14, fixing the defect where every
// template-parsed row reached review with no memo). So a template written by
// either side is understood by the other, and there is nothing to negotiate.
//
//   • applyTemplate() accepts v4 and also v3, because v3 templates written
//     before the fix are still sitting in the table. A v3 applies correctly, it
//     just carries no memo — same as it did then, never worse.
//   • deriveTemplate() produces v4.
//   • shouldStoreTemplate() refuses only to overwrite a template from a FUTURE
//     version we do not understand. A stale v3 is safe to replace: both sides
//     reject v3 on apply and re-derive anyway.
//
// The historical hazard, kept as a note because it will recur the next time the
// versions diverge: if one side derives vN and the other only accepts vN-1,
// each invalidates the other's template on every email and both call the LLM
// forever. Bump both sides together, or make the newer side hold back.

'use strict';

// Must track the .gs's EXTRACTION_LOGIC_VERSION lineage: 3 = .gs (no memo),
// 4 = this file (memo captured). Bumping invalidates stored templates on
// purpose — a version that can't be reproduced must never be applied.
const TEMPLATE_VERSION = 4;
const LEGACY_TEMPLATE_VERSION = 3;

// ---------------------------------------------------------------------------
// Masking — no real amount, name, account, reference or email ever reaches the
// LLM. Unconditional. Direct read makes this MORE important, not less: we now
// touch mail the user never hand-picked, so nothing about the masking contract
// gets relaxed here.
// ---------------------------------------------------------------------------

const FAKE_NAMES = ['TRAN VAN BAO', 'LE THI MAI', 'PHAM MINH DUC', 'HOANG THU HA', 'VU QUOC ANH'];
// caps runs containing any of these words are institutional, not personal — leave them
const CAPS_BLOCKLIST = { VND: 1, USD: 1, EUR: 1, MB: 1, BANK: 1, EBANKING: 1, ATM: 1, NAPAS: 1, QR: 1, PBC: 1, INC: 1, LLC: 1, JSC: 1, TMCP: 1, OTP: 1 };

function maskForSharing(text, rng) {
  const rand = rng || Math.random;
  const pairs = [];   // [{masked, original}] string swaps, applied longest-first on the way back
  const numMap = {};  // masked numeric value -> original numeric value (amount comes back as a number)
  const holes = [];   // protected date/time spans, restored verbatim

  let out = String(text || '');

  // 1. protect date/time spans from the digit pass
  out = out.replace(/\b\d{1,4}[-\/]\d{1,2}[-\/]\d{1,4}(?:[ T]\d{1,2}:\d{2}(?::\d{2})?)?\b|\b\d{1,2}:\d{2}(?::\d{2})?\b/g, (m) => {
    holes.push(m);
    return '\x00' + (holes.length - 1) + '\x00';
  });

  // 2. email addresses in the body (the recipient's own address is personal data)
  out = out.replace(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, (m) => {
    const masked = 'user' + Math.floor(rand() * 9000 + 1000) + '@example.com';
    pairs.push({ masked, original: m });
    return masked;
  });

  // 3. ALL-CAPS name runs (Vietnamese bank emails write personal names in caps)
  const nameSeen = {};
  out = out.replace(/\b[A-Z]{2,}(?: [A-Z]{2,}){1,5}\b/g, (m) => {
    const words = m.split(' ');
    for (let i = 0; i < words.length; i++) if (CAPS_BLOCKLIST[words[i]]) return m;
    if (!nameSeen[m]) {
      const fake = FAKE_NAMES[Object.keys(nameSeen).length % FAKE_NAMES.length];
      nameSeen[m] = fake;
      pairs.push({ masked: fake, original: m });
    }
    return nameSeen[m];
  });

  // 4. digit tokens (amounts, accounts, refs, phones): random digits, same shape.
  //    Leading 0 stays 0 (phones), other leading digits stay nonzero (amounts).
  const digitSeen = {};
  out = out.replace(/\d(?:[\d.,]*\d)?/g, (m) => {
    if ((m.match(/\d/g) || []).length < 2) return m;   // lone digits carry ~nothing
    if (digitSeen[m]) return digitSeen[m];
    let masked = '', first = true;
    for (let i = 0; i < m.length; i++) {
      const c = m[i];
      if (c < '0' || c > '9') { masked += c; continue; }
      if (first) {
        masked += (c === '0') ? '0' : String(Math.floor(rand() * 9) + 1);
        first = false;
      } else {
        masked += String(Math.floor(rand() * 10));
      }
    }
    digitSeen[m] = masked;
    pairs.push({ masked, original: m });
    const numOrig = parseFloat(m.replace(/,/g, ''));
    const numMasked = parseFloat(masked.replace(/,/g, ''));
    if (!isNaN(numOrig) && !isNaN(numMasked)) numMap[String(numMasked)] = numOrig;
    return masked;
  });

  // 5. restore the protected date/time spans
  out = out.replace(/\x00(\d+)\x00/g, (_, i) => holes[Number(i)]);

  return { text: out, pairs, numMap };
}

// Swaps real values back into the LLM's extraction output. String fields get
// longest-first substring replacement; numeric fields go through numMap.
function unmaskExtraction(extraction, mask) {
  const sorted = mask.pairs.slice().sort((a, b) => b.masked.length - a.masked.length);
  const out = {};
  for (const key in extraction) {
    let v = extraction[key];
    if (typeof v === 'string') {
      for (let i = 0; i < sorted.length; i++) v = v.split(sorted[i].masked).join(sorted[i].original);
      out[key] = v;
    } else if (typeof v === 'number' && mask.numMap[String(v)] !== undefined) {
      out[key] = mask.numMap[String(v)];
    } else {
      out[key] = v;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// LLM contract — kept character-identical to the .gs so a template derived on
// one side means the same thing on the other. Prompt rationale lives in
// pipeline/extraction.md.
// ---------------------------------------------------------------------------

const EXTRACTION_SYSTEM_PROMPT =
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

const EXTRACTION_SCHEMA = {
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

// Gemini's responseSchema is a restricted OpenAPI-3.0-style subset, not full JSON Schema:
// (1) no `type: [x, "null"]` union form — wants `nullable: true` alongside a single type,
// (2) `additionalProperties` isn't a recognized field at all — including it is a hard 400,
// not silently ignored. Converts once; EXTRACTION_SCHEMA itself is untouched so an
// Anthropic-shaped call keeps working unmodified if we swap back.
function schemaForGemini(schema) {
  const copy = JSON.parse(JSON.stringify(schema));
  delete copy.additionalProperties;
  for (const key in copy.properties) {
    const prop = copy.properties[key];
    if (Array.isArray(prop.type)) {
      const real = prop.type.filter((t) => t !== 'null')[0];
      prop.type = real;
      prop.nullable = true;
      if (Array.isArray(prop.enum)) prop.enum = prop.enum.filter((e) => e !== null);
    }
  }
  return copy;
}

// ---------------------------------------------------------------------------
// Local extraction templates — the reason most volume never reaches an LLM at
// all. A template is an anchored regex per field, derived once from an
// LLM-parsed email of a given (sender, subject-template) shape, then replayed
// locally on every later email of that shape.
// ---------------------------------------------------------------------------

function _escRe(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

// which printed forms could the extracted number take in the body?
function _amountCandidates(n) {
  if (typeof n !== 'number' || isNaN(n)) return [];
  let out = [];
  const neg = n < 0, abs = Math.abs(n);
  const intPart = Math.floor(abs);
  const frac = Math.round((abs - intPart) * 100);
  const intStr = String(intPart);
  const usGroup = intStr.replace(/\B(?=(\d{3})+(?!\d))/g, ',');   // 2,000
  const vnGroup = intStr.replace(/\B(?=(\d{3})+(?!\d))/g, '.');   // 2.000
  const fr2 = (frac < 10 ? '0' : '') + frac;
  out.push({ raw: usGroup + '.' + fr2, parse: 'us' });          // 2,000.00
  out.push({ raw: vnGroup + ',' + fr2, parse: 'vn' });          // 2.000,00
  if (frac === 0) {
    out.push({ raw: usGroup, parse: 'us' });
    out.push({ raw: vnGroup, parse: 'vn' });
    out.push({ raw: intStr, parse: 'plain' });
  } else {
    out.push({ raw: intStr + '.' + fr2, parse: 'us' });
  }
  if (neg) out = out.map((c) => ({ raw: '-' + c.raw, parse: c.parse }));
  return out;
}

function _parseAmount(raw, mode) {
  let s = String(raw).trim();
  if (mode === 'us') s = s.replace(/,/g, '');
  else if (mode === 'vn') s = s.replace(/\./g, '').replace(/,/g, '.');
  const n = parseFloat(s);
  return isNaN(n) ? null : n;
}

function _pad2(x) { return (String(x).length < 2 ? '0' : '') + x; }

function _tryDateTransform(raw, kind, offset) {
  let m;
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

const _DATE_KINDS = ['dmy_hms', 'dmy_slash_hms', 'ymd_hms'];
const _DATE_RAW_RE = /\d{1,4}[-\/]\d{1,2}[-\/]\d{1,4}(?:[ T]\d{1,2}:\d{2}(?::\d{2})?)?/g;

// find the stable label text that precedes a value; returns {re} or null.
function _deriveAnchor(body, rawValue, valuePatterns) {
  const idx = body.indexOf(rawValue);
  if (idx < 0) return null;
  const lineStart = body.lastIndexOf('\n', idx - 1) + 1;
  const samePrefix = body.slice(lineStart, idx);
  const trials = [];
  if (samePrefix.trim().length >= 2) {
    trials.push({ label: samePrefix.trim(), joiner: '[^\\S\\n]*' });
  }
  let cursor = lineStart - 1;
  while (cursor > 0 && /\s/.test(body[cursor])) cursor--;
  if (cursor > 0) {
    const prevStart = body.lastIndexOf('\n', cursor - 1) + 1;
    const prevLine = body.slice(prevStart, cursor + 1).trim();
    if (prevLine.length >= 2) trials.push({ label: prevLine, joiner: '\\s*\\n\\s*' + _escRe(samePrefix.trim()) + (samePrefix.trim() ? '[^\\S\\n]*' : '') });
  }
  for (let t = 0; t < trials.length; t++) {
    for (let p = 0; p < valuePatterns.length; p++) {
      const src = _escRe(trials[t].label) + trials[t].joiner + valuePatterns[p];
      try {
        const m = new RegExp(src).exec(body);
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
  const pats = [];
  if (type === 'number') { pats.push('(-?[\\d.,]+)'); return pats; }
  pats.push('([^\\n]+)');
  if (/^\d+$/.test(rawValue)) pats.push('(\\d{' + Math.max(4, rawValue.length - 4) + ',})');
  pats.push('(' + _escRe(rawValue).replace(/\d+/g, '\\d+') + ')');
  return pats;
}

// Fields whose value changes between emails of the same shape, and which are
// therefore anchored rather than stored as constants.
//
// 'memo' is here and is NOT in the .gs's list — that is the defect this port
// fixes. See the header. It is placed last so that an unanchorable memo fails
// only after the fields that matter structurally have already been proven.
const STRING_FIELDS = ['counterparty', 'reference_number', 'account_masked', 'memo'];

// A memo that cannot be anchored is a judgement call, not an obvious one:
//
//   • Refusing the template means this sender goes to the LLM on EVERY email —
//     real cost, and more masked text leaving the system.
//   • Accepting it means the row reaches review with no memo, which for a
//     person-to-person transfer is the whole point of the row: counterparty is
//     just a name, and memo is the only thing that says what the money was for.
//
// So it is split by type: p2p_transfer demands the memo anchor (refuse the
// template without it), everything else may template without memo, because a
// merchant/subscription/bill row carries its meaning in counterparty and
// source_provider. Card purchases legitimately have no memo at all.
function _memoIsRequired(extraction) {
  return extraction && extraction.transaction_type === 'p2p_transfer';
}

function deriveTemplate(body, extraction) {
  if (!extraction || extraction.is_transaction !== true) return null;
  const tpl = { v: TEMPLATE_VERSION, static: {}, fields: {} };

  // constants for this (sender, subject_template) email kind — protected by the
  // anchors: a structurally different email fails them and falls back to the LLM
  tpl.static.transaction_type = extraction.transaction_type != null ? extraction.transaction_type : null;
  tpl.static.source_provider = extraction.source_provider != null ? extraction.source_provider : null;
  tpl.static.currency = extraction.currency != null ? extraction.currency : null;
  tpl.static.direction = extraction.direction != null ? extraction.direction : null;
  tpl.static.status = extraction.status != null ? extraction.status : null;

  if (typeof extraction.occurred_at !== 'string') return null;
  const offM = extraction.occurred_at.match(/([+-]\d{2}:\d{2}|Z)$/);
  const offset = offM ? offM[1] : '+07:00';
  let found = null;
  const rawDates = body.match(_DATE_RAW_RE) || [];
  for (let d = 0; d < rawDates.length && !found; d++) {
    for (let k = 0; k < _DATE_KINDS.length && !found; k++) {
      if (_tryDateTransform(rawDates[d], _DATE_KINDS[k], offset) === extraction.occurred_at) {
        const anch = _deriveAnchor(body, rawDates[d], ['([\\d\\-\\/ T:]+?)(?=\\s*$|\\s*\\n)', '([\\d\\-\\/ T:]+)']);
        if (anch) found = { re: anch.re, dt: _DATE_KINDS[k], off: offset };
      }
    }
  }
  if (!found) return null;
  tpl.fields.occurred_at = found;

  if (typeof extraction.amount !== 'number') return null;
  let amtSpec = null;
  const cands = _amountCandidates(extraction.amount);
  for (let c = 0; c < cands.length && !amtSpec; c++) {
    if (body.indexOf(cands[c].raw) < 0) continue;
    const a = _deriveAnchor(body, cands[c].raw, _valuePatternsFor(cands[c].raw, 'number'));
    if (a && _parseAmount(cands[c].raw, cands[c].parse) === extraction.amount) {
      amtSpec = { re: a.re, num: cands[c].parse };
    }
  }
  if (!amtSpec) return null;
  tpl.fields.amount = amtSpec;

  // varying string fields — anchored if present; a present-but-unanchorable
  // value fails the whole derivation (never silently degrade vs the LLM path),
  // except for memo, which degrades by type (see _memoIsRequired).
  for (let f = 0; f < STRING_FIELDS.length; f++) {
    const name = STRING_FIELDS[f], val = extraction[name];
    if (val === null || val === undefined || val === '') { tpl.static[name] = null; continue; }
    const spec = _deriveAnchor(body, String(val), _valuePatternsFor(String(val), 'string'));
    if (!spec) {
      if (name === 'memo' && !_memoIsRequired(extraction)) { tpl.static.memo = null; continue; }
      return null;
    }
    tpl.fields[name] = spec;
  }

  // final proof: the template must reproduce the LLM's extraction exactly
  const check = applyTemplate(JSON.stringify(tpl), body);
  if (!check) return null;
  const keys = ['transaction_type', 'source_provider', 'occurred_at', 'amount', 'currency', 'direction', 'counterparty', 'reference_number', 'status', 'account_masked'];
  for (let i = 0; i < keys.length; i++) {
    const a2 = check[keys[i]], b2 = extraction[keys[i]];
    if (String(a2 === undefined ? null : a2) !== String(b2 === undefined ? null : b2)) return null;
  }
  // memo is proven too, but only when the template claims to capture it —
  // a by-design null (see _memoIsRequired) must not fail the derivation.
  if (tpl.fields.memo) {
    if (String(check.memo === undefined ? null : check.memo) !== String(extraction.memo === undefined ? null : extraction.memo)) return null;
  }
  return JSON.stringify(tpl);
}

// run a stored template against a new email body → extraction object or null
function applyTemplate(tplJson, body) {
  if (!tplJson || tplJson[0] !== '{') return null;   // legacy placeholder strings → LLM
  let tpl;
  try { tpl = JSON.parse(tplJson); } catch (e) { return null; }
  // v3 = the .gs's format. Accepted read-only: it applies correctly, it just
  // never carries memo. Rejecting it would send every shared sender to the LLM.
  if (tpl.v !== TEMPLATE_VERSION && tpl.v !== LEGACY_TEMPLATE_VERSION) return null;

  const out = { is_transaction: true };
  for (const s in tpl.static) out[s] = tpl.static[s];

  for (const f in tpl.fields) {
    const spec = tpl.fields[f];
    let m;
    try { m = new RegExp(spec.re).exec(body); } catch (e) { return null; }
    if (!m || m[1] === undefined) return null;
    const raw = String(m[1]).trim();
    if (spec.dt) {
      const iso = _tryDateTransform(raw, spec.dt, spec.off);
      if (!iso) return null;
      out[f] = iso;
    } else if (spec.num) {
      const n = _parseAmount(raw, spec.num);
      if (n === null || n === 0) return null;
      out[f] = n;
    } else {
      out[f] = raw;
    }
  }
  if (typeof out.amount !== 'number' || typeof out.occurred_at !== 'string') return null;
  // A v3 template has no memo concept at all. Make that explicit rather than
  // leaving the key absent, so a consumer can tell "no memo in this email"
  // from "this template predates memo capture".
  if (tpl.v === LEGACY_TEMPLATE_VERSION && out.memo === undefined) out.memo = null;
  return out;
}

// Is it safe to replace the stored template with one we just derived?
//
// Yes for anything we understand — absent, a legacy placeholder string, a stale
// v3 (both pipelines reject v3 on apply and re-derive anyway), or our own v4.
//
// No for a version from the FUTURE. That means the other side has been bumped
// ahead of this file, and overwriting its work with an older format is how the
// two pipelines start invalidating each other on every email (see the header).
// Holding back costs one LLM call per email for that sender until this file
// catches up; overwriting costs it for both sides, forever.
function shouldStoreTemplate(existingTplJson) {
  if (!existingTplJson || String(existingTplJson)[0] !== '{') return true;  // absent or legacy placeholder
  try {
    const v = JSON.parse(existingTplJson).v;
    return !(typeof v === 'number' && v > TEMPLATE_VERSION);
  } catch (e) { return true; }
}

// Subject with dates and reference-like runs stripped — the cache key half that
// makes a fingerprint about the email KIND, not the individual email.
//
// MUST stay byte-identical to the .gs version: both pipelines key
// sender_fingerprints on (sender_address, subject_template), so any difference
// here silently splits one sender's cache in two and re-pays the LLM for mail
// the other side already learned. The parity test pins this.
function normalizeSubjectTemplate(subject) {
  return String(subject == null ? '' : subject)
    .replace(/#[\w-]+/g, '')
    .replace(/\b\d{6,}\b/g, '')
    .replace(/\b\w+ \d{1,2},? \d{4}\b/g, '')
    .replace(/\b\d{1,2}[-\/]\d{1,2}[-\/]\d{2,4}\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

module.exports = {
  TEMPLATE_VERSION,
  LEGACY_TEMPLATE_VERSION,
  FAKE_NAMES,
  CAPS_BLOCKLIST,
  maskForSharing,
  unmaskExtraction,
  EXTRACTION_SYSTEM_PROMPT,
  EXTRACTION_SCHEMA,
  schemaForGemini,
  deriveTemplate,
  applyTemplate,
  shouldStoreTemplate,
  normalizeSubjectTemplate,
};
