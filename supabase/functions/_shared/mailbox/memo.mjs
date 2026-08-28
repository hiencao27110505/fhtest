/**
 * Memo tidying: what the bank auto-filled versus what a person actually wrote.
 *
 * VERBATIM COPY of the slice in pipeline/bank-email-pipeline.gs between
 * `var MEMO_FILLER` and `function _withTidyMemo`, with an export block appended.
 * Same reasoning as templates.mjs, and the same parity test.
 *
 * Runs locally on plaintext already in hand. No model, no network. It adds
 * memo_display ALONGSIDE memo, never over it, so a misjudged heuristic stays
 * recoverable by the person reviewing the row.
 */

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
/* Card networks append the terminal's city and country to the merchant name —
   "AEON NGUYEN VAN LINH HO CHI MINH VN" — which tells the cardholder where
   their own supermarket is. Strip the tail: an optional known VN city, then the
   country token, both only at the END of the string so a brand containing the
   same letters mid-name is untouched. If stripping would leave nothing (the
   merchant IS the city string), keep the original: a noisy name beats a blank. */
var MERCHANT_CITY_TAIL_RE = new RegExp(
  '(?:\\s+(?:TP\\.?\\s*)?(?:HO\\s*CHI\\s*MINH(?:\\s*CITY)?|HCMC|HCM|HA\\s*NOI|HANOI|DA\\s*NANG|CAN\\s*THO|' +
  'HAI\\s*PHONG|NHA\\s*TRANG|DA\\s*LAT|DALAT|VUNG\\s*TAU|BIEN\\s*HOA|THU\\s*DUC|HUE))?\\s*(?:VIET\\s*NAM|VN)\\s*$',
  'i');

function tidyMerchant(raw) {
  var s = String(raw || '').replace(MERCHANT_AGGREGATOR_RE, '').replace(/\s+/g, ' ').trim();
  var stripped = s.replace(MERCHANT_CITY_TAIL_RE, '').trim();
  return stripped || s;
}

// Adds memo_display + type_code without touching memo. Both are additive, so an
// older client that knows nothing about them keeps working unchanged.

export {
  deburrAscii,
  splitStructuredMemo,
  isMemoBoilerplate,
  tidyMemo,
  tidyMerchant,
};
