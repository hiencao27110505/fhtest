// Vercel serverless function. POST { image: <base64 JPEG/PNG>, mime: 'image/jpeg', lang: 'vi'|'en' }.
// Reads ONE receipt or bank-app screenshot with Gemini and returns fields the client can
// prefill, every one re-validated here before the client ever sees it. Cloned from
// api/csv-column-mapping.js: sign-in check before spending a call, per-user throttle,
// strict response schema at temperature 0, key server-side only.
//
// What never happens here: nothing is written to disk, nothing about the image or the
// values is logged, and the model's transcription (raw_text) is used for the amount
// cross-check and then dropped — it does not go back to the client.
//
// Requires GEMINI_API_KEY (already set for the CSV mapper). GEMINI_MODEL optional.

const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-flash-latest';
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

// Public Supabase config (same values shipped in the client; safe to embed — RLS protects
// data). Used only to verify the caller's access token before spending a Gemini call.
const SUPABASE_URL = 'https://iizyukzfsbdkbrgfupwq.supabase.co';
const SUPABASE_ANON = 'sb_publishable_KQnm-h0bn3gCa1i_dlkapw_7b8kPRDD';

const MAX_B64 = 2.5 * 1024 * 1024;   // a 1600px JPEG is ~150–400 KB; this is a hard ceiling, not a target
const MIMES = new Set(['image/jpeg', 'image/png', 'image/webp']);
// The category vocabulary is the client's own concept list (CONCEPT_ORDER in
// src/js-ui/50-sheets-expense-capture.js); the client maps a concept to one of the
// family's real categories, or to nothing. The model never names a category.
const CONCEPTS = ['Housing', 'Groceries', 'Clothing', 'Shopping', 'Transport', 'Fun', 'Dining', 'Others'];

// Best-effort in-memory throttle: per user (token subject) and per warm instance, over a
// rolling minute. The JWT check is the real gate; this is a backstop.
const _hits = new Map();
const _WINDOW_MS = 60000, _PER_USER = 12, _GLOBAL = 60;
function _rateLimited(key) {
  const now = Date.now();
  const prune = (arr) => arr.filter((t) => now - t < _WINDOW_MS);
  const u = prune(_hits.get(key) || []); const g = prune(_hits.get('*') || []);
  if (u.length >= _PER_USER || g.length >= _GLOBAL) { _hits.set(key, u); _hits.set('*', g); return true; }
  u.push(now); g.push(now); _hits.set(key, u); _hits.set('*', g);
  return false;
}

async function _verifyUser(token, fetchFn) {
  if (!token) return null;
  try {
    const r = await fetchFn(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: SUPABASE_ANON, Authorization: 'Bearer ' + token } });
    if (!r.ok) return null;
    const u = await r.json();
    return (u && u.id) || null;
  } catch (e) { return null; }
}

const SYSTEM_PROMPT = `You read ONE image: a paper receipt, or a screenshot of a Vietnamese bank or e-wallet app (MoMo, ZaloPay, Vietcombank, MB, Techcombank, BIDV, ACB...). Return the transaction it documents.

Rules:
- amount_text is the TOTAL the customer paid, copied exactly as printed (e.g. "337.900đ", "-118,000 VND", "$12.99"). Prefer the line named TỔNG / TỔNG CỘNG / Thành tiền / Số tiền / Total. Never a subtotal, a tip, a fee, a cashback or a balance.
- date is YYYY-MM-DD from the image, or empty if none is printed. time is HH:MM or empty. Do not guess a date.
- counterparty is the shop, merchant, or recipient name as printed. memo is a short free-text note if the image carries one (a transfer message, an order note), else empty.
- direction is "credit" only when money clearly came IN (a refund, a received transfer); otherwise "debit".
- category is one concept from the list, judged from what was bought; "Others" when unsure.
- document_kind: paper_receipt, bank_app_screenshot, or other.
- is_transaction is false when the image is not a receipt or a payment screen at all (a menu, a selfie, a page of text). Then leave the other fields empty.
- raw_text is every line of text you can read in the image, in reading order, one line per string. Copy digits exactly.
Vietnamese amounts use "." as the thousands separator and "," as the decimal mark. Never invent values that are not in the image.`;

const RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    is_transaction: { type: 'BOOLEAN' },
    document_kind: { type: 'STRING', enum: ['paper_receipt', 'bank_app_screenshot', 'other'] },
    amount_text: { type: 'STRING' },
    currency: { type: 'STRING' },
    date: { type: 'STRING' },
    time: { type: 'STRING' },
    counterparty: { type: 'STRING' },
    memo: { type: 'STRING' },
    direction: { type: 'STRING', enum: ['debit', 'credit'] },
    category: { type: 'STRING', enum: CONCEPTS },
    raw_text: { type: 'ARRAY', items: { type: 'STRING' } },
  },
  required: ['is_transaction', 'document_kind', 'amount_text', 'currency', 'date', 'time', 'counterparty', 'memo', 'direction', 'category', 'raw_text'],
};

/* ── validation: nothing the model says reaches the client untested ───────── */
let _parsers = null;
async function _loadParsers() {
  // The bank-email pipeline's amount reader (VN thousands/decimal rules, currency
  // tokens, refuses zero). Same bytes, so a fix there is a fix here.
  if (!_parsers) _parsers = await import('../supabase/functions/_shared/mailbox/labeltable.mjs');
  return _parsers;
}
function _isoDateOk(d) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d || '');
  if (!m) return false;
  const t = Date.UTC(+m[1], +m[2] - 1, +m[3]);
  const dt = new Date(t);
  if (dt.getUTCFullYear() !== +m[1] || dt.getUTCMonth() !== +m[2] - 1 || dt.getUTCDate() !== +m[3]) return false;
  const now = Date.now();
  return t <= now + 2 * 864e5 && t >= now - 730 * 864e5;   // not in the future, not older than two years
}
function _timeOk(t) { return /^([01]\d|2[0-3]):[0-5]\d$/.test(t || ''); }
function _digits(s) { return String(s || '').replace(/\D+/g, ''); }

// Exported for tools/receipt-extract.test.js: pure, no I/O.
function validate(parsed, parsers) {
  const out = { ok: true, is_transaction: !!parsed.is_transaction, document_kind: parsed.document_kind || 'other',
    amount: null, currency: null, date: null, time: null, counterparty: '', memo: '', direction: 'debit', category: '',
    flags: { amount_unverified: false } };
  if (!out.is_transaction) return out;
  const a = parsers.parseAmountCell(String(parsed.amount_text || ''));
  if (a && a.value > 0) {
    out.amount = a.value;                       // raw currency units; the CLIENT divides by curMult() once
    out.currency = a.currency || (String(parsed.currency || '').toUpperCase().match(/^[A-Z]{3}$/) ? parsed.currency.toUpperCase() : 'VND');
    // The amount must appear in the model's own transcription, or the client shows "check this".
    const want = _digits(parsed.amount_text);
    const seen = (parsed.raw_text || []).map(_digits).join('|');
    out.flags.amount_unverified = !(want && seen.indexOf(want) >= 0);
  }
  if (_isoDateOk(parsed.date)) out.date = parsed.date;
  if (out.date && _timeOk(parsed.time)) out.time = parsed.time;
  out.counterparty = String(parsed.counterparty || '').trim().slice(0, 80);
  out.memo = String(parsed.memo || '').trim().slice(0, 140);
  out.direction = parsed.direction === 'credit' ? 'credit' : 'debit';
  out.category = CONCEPTS.includes(parsed.category) ? parsed.category : '';
  return out;
}

async function handler(req, res, deps) {
  const fetchFn = (deps && deps.fetch) || fetch;
  const env = (deps && deps.env) || process.env;
  if (req.method !== 'POST') { res.status(405).json({ error: 'POST only' }); return; }
  const apiKey = env.GEMINI_API_KEY;
  if (!apiKey) { res.status(500).json({ error: 'GEMINI_API_KEY not configured on the server' }); return; }

  const authz = req.headers['authorization'] || req.headers['Authorization'] || '';
  const uid = await _verifyUser(authz.replace(/^Bearer\s+/i, ''), fetchFn);
  if (!uid) { res.status(401).json({ error: 'sign-in required' }); return; }
  if (_rateLimited(uid)) { res.status(429).json({ error: 'rate limited — try again in a minute' }); return; }

  const body = req.body || {};
  const image = typeof body.image === 'string' ? body.image : '';
  const mime = String(body.mime || '');
  if (!image || !MIMES.has(mime) || image.length > MAX_B64 || !/^[A-Za-z0-9+/=]+$/.test(image.slice(0, 64))) {
    res.status(400).json({ error: 'body must be { image: <base64>, mime: image/jpeg|png|webp } under 2.5 MB' });
    return;
  }

  const geminiBody = {
    system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
    contents: [{ role: 'user', parts: [
      { inline_data: { mime_type: mime, data: image } },
      { text: (body.lang === 'en' ? 'Read this image.' : 'Đọc ảnh này.') },
    ] }],
    generationConfig: { responseMimeType: 'application/json', responseSchema: RESPONSE_SCHEMA, temperature: 0 },
  };

  let geminiRes;
  try {
    geminiRes = await fetchFn(`${GEMINI_URL}?key=${apiKey}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(geminiBody) });
  } catch (e) { res.status(502).json({ error: 'Gemini request failed' }); return; }
  if (!geminiRes.ok) { res.status(502).json({ error: `Gemini returned ${geminiRes.status}` }); return; }   // no body echoed: it could quote the image text

  const data = await geminiRes.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) { res.status(502).json({ error: 'Gemini returned no content' }); return; }
  let parsed;
  try { parsed = JSON.parse(text); } catch (e) { res.status(502).json({ error: 'Gemini response was not valid JSON' }); return; }

  let parsers;
  try { parsers = (deps && deps.parsers) || await _loadParsers(); }
  catch (e) { res.status(500).json({ error: 'validator unavailable' }); return; }   // fail closed, never unvalidated
  res.status(200).json(validate(parsed, parsers));
}

module.exports = (req, res) => handler(req, res);
module.exports.handler = handler;
module.exports.validate = validate;
module.exports.CONCEPTS = CONCEPTS;
module.exports.SYSTEM_PROMPT = SYSTEM_PROMPT;   // for tools/receipt-bench.js, so the bench sends exactly what production sends
module.exports.RESPONSE_SCHEMA = RESPONSE_SCHEMA;
module.exports.GEMINI_URL = GEMINI_URL;
