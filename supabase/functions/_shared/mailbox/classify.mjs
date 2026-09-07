/* Server-side category cascade — the one place a concept is decided when the
   extractor left `category` null, which is MOST repeat mail (the template path in
   labeltable.mjs deliberately sets `category: null` and lets learning own it).
   Whatever this fills into `extraction.category` reaches BOTH consumers from a
   single seam in the worker:
     - stage.mjs → `category_hint` on the sealed row (the in-app suggestion), and
     - copyMeta  → the notification's concept (generic vs. contextual copy).

   Precedence, strongest first:
     1. the extractor's own category (the LLM saw the whole email) — kept as-is
     2. a synced USER correction (#3)      — a human taught this merchant
     3. the curated dictionary (#1)        — known chains, deterministic + free
     4. the per-merchant cache (#2)        — incl. a negative "tried, unknowable"
     5. a ONE-SHOT model classify (#2)     — budget-gated; a 429 just falls to
                                             generic and is NOT cached, so the
                                             merchant stays eligible next run.
   Nothing here ever retries or holds the message — a miss is a garnish miss, and
   the transaction stages exactly as before. */

import { toGeminiSchema } from './llm.mjs';

export const CLASSIFY_CONCEPTS = ['Housing', 'Groceries', 'Clothing', 'Shopping', 'Transport', 'Dining', 'Fun', 'Others'];

function deburr(s) {
  return String(s == null ? '' : s)
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd').replace(/Đ/g, 'd')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ').trim();
}

/* Gateway processors and bank boilerplate that ride in the counterparty and
   would otherwise split one merchant into many keys ("REVI PHU MY HUNG TOWER" vs
   "PAYOO REVICOFFEEHCM"). Stripped so the key — and therefore the #3 hash — is
   stable across variants. MUST match the client's fhMerchantKey byte-for-byte, or
   a correction taught on the device will not match on the read side. */
const GATEWAYS = /\b(payoo|mpos|vnpay|onepay|napas|ecpay|appota|zalopay|shopeepay|viettelpay|smartpay|nganluong|baokim|revi)\b/g;
const BANK_NOISE = /\b(customer|khach hang|thanh toan|chuyen tien|thanh toan qr|qr|pos|atm|ck|tt|nd|gd|ref|trace|mbvcb|mbct|vcb|tcb|acb|bidv|vietinbank|agribank|ib|ibft|ft)\b/g;

/* The stable merchant key: deburred, gateways + bank noise + long digit runs
   stripped, clamped. KEEP IN SYNC with fhMerchantKey in 57-csv-import-review.js. */
export function merchantKey(counterparty, memo) {
  let t = deburr(String(counterparty || '') + ' ' + String(memo || ''));
  t = t.replace(GATEWAYS, ' ').replace(BANK_NOISE, ' ').replace(/[0-9]{4,}/g, ' ').replace(/\s+/g, ' ').trim();
  return t.slice(0, 40).trim();
}

export async function hashKey(key, subtle) {
  const buf = await subtle.digest('SHA-256', new TextEncoder().encode(key));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

/* Curated merchant→concept dictionary (#1) — a server-side slice of the client's
   CSV_MERCHANTS, biggest chains only (the long tail is the classifier's job).
   Ordered specific→broad; a deburred substring match, first hit wins. */
const DICTIONARY = [
  ['Dining', ['highlands', 'phuc long', 'trung nguyen legend', 'katinat', 'the coffee house', 'starbucks', 'passio', 'cong ca phe', 'ca phe', 'cafe', 'coffee', 'tra sua', 'gong cha', 'mixue', 'koi the', 'toco toco', 'phe la', 'kfc', 'lotteria', 'jollibee', 'mcdonald', 'burger king', 'pizza', 'domino', 'popeyes', 'gogi', 'kichi', 'manwah', 'hotpot', 'nha hang', 'restaurant', 'shopeefood', 'grabfood', 'baemin', 'golden gate']],
  ['Groceries', ['bach hoa xanh', 'winmart', 'win mart', 'vinmart', 'coopmart', 'co opmart', 'co op', 'big c', 'bigc', 'go bigc', 'aeon', 'emart', 'lotte mart', 'mega market', 'satra', 'kingfoodmart', 'circle k', 'gs25', 'familymart', 'ministop', '7 eleven', 'sieu thi', 'tap hoa', 'nutri mart']],
  ['Transport', ['grab', 'gojek', 'be group', 'xanh sm', 'vinasun', 'mai linh', 'g7 taxi', 'taxi', 'petrolimex', 'pvoil', 'xang dau', 'vetc', 'epass', 'parking', 'gui xe', 'cao toc']],
  ['Housing', ['evn', 'dien luc', 'sawaco', 'cap nuoc', 'fpt telecom', 'internet', 'tien dien', 'tien nuoc', 'chung cu', 'ban quan ly', 'vinhomes', 'petrogas', 'pgas']],
  ['Fun', ['cgv', 'lotte cinema', 'bhd star', 'galaxy cinema', 'cinestar', 'netflix', 'spotify', 'youtube premium', 'fpt play', 'steam games', 'playstation', 'garena', 'gym', 'fitness', 'yoga', 'karaoke', 'du lich', 'booking com', 'agoda', 'traveloka', 'klook', 'vietjet', 'vietnam airlines', 'bamboo airways', 'vexere']],
  ['Shopping', ['aeon mall', 'vincom', 'shopee', 'lazada', 'tiki', 'sendo', 'tiktok shop', 'uniqlo', 'zara', 'muji', 'dien may xanh', 'the gioi di dong', 'fpt shop', 'cellphones', 'nguyen kim', 'fahasa', 'hasaki', 'watsons', 'guardian']],
  ['Others', ['pharmacity', 'long chau', 'nha thuoc', 'benh vien', 'phong kham', 'vinmec', 'medlatec', 'bao hiem', 'prudential', 'manulife', 'hoc phi', 'ghn express', 'ghtk', 'ninja van', 'viettel post', 'vnpost']],
];

export function dictionaryConcept(text) {
  const t = ' ' + deburr(text) + ' ';
  if (t.trim().length < 2) return null;
  for (const [concept, tokens] of DICTIONARY) {
    for (const kw of tokens) {
      if (t.indexOf(deburr(kw)) >= 0) return concept;
    }
  }
  return null;
}

const CLASSIFY_SYSTEM = 'You label a Vietnamese bank-transaction merchant/counterparty string with ONE spending concept. ' +
  'Reply as JSON {"concept": ...}. concept is EXACTLY one of: Housing, Groceries, Clothing, Shopping, Transport, Dining, Fun, Others — ' +
  'or null when you genuinely cannot tell (an opaque gateway or bank code, initials, a bare reference number). Do not guess wildly; null is the right answer for the unknowable.';

const CLASSIFY_SCHEMA = {
  type: 'object',
  properties: { concept: { type: ['string', 'null'], enum: [...CLASSIFY_CONCEPTS, null] } },
};

/* One-shot merchant classify. Never throws, never retries: any transport failure
   (429 included) returns {ok:false} so the caller falls to generic copy and does
   NOT poison the cache; a real model answer returns {ok:true, concept} where a
   null concept is a legitimate "unknowable" that DOES get negatively cached. */
export async function classifyMerchant(text, cfg, fetchImpl) {
  if (!cfg || !cfg.apiKey) return { ok: false };
  const doFetch = fetchImpl || globalThis.fetch;
  const model = cfg.model || 'gemini-3.5-flash-lite';
  const url = 'https://generativelanguage.googleapis.com/v1beta/models/' +
    encodeURIComponent(model) + ':generateContent?key=' + encodeURIComponent(cfg.apiKey);
  try {
    const res = await doFetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: CLASSIFY_SYSTEM }] },
        contents: [{ role: 'user', parts: [{ text: 'Merchant: ' + String(text).slice(0, 200) }] }],
        generationConfig: { responseMimeType: 'application/json', responseSchema: toGeminiSchema(CLASSIFY_SCHEMA) },
      }),
    });
    if (!res.ok) return { ok: false };            // 429/5xx → one-shot, no retry, no cache
    const data = await res.json();
    const answer = data && data.candidates && data.candidates[0] &&
      data.candidates[0].content && data.candidates[0].content.parts &&
      data.candidates[0].content.parts[0] && data.candidates[0].content.parts[0].text;
    if (!answer) return { ok: true, concept: null };
    let parsed;
    try { parsed = JSON.parse(answer); } catch { return { ok: true, concept: null }; }
    const c = parsed && parsed.concept;
    return { ok: true, concept: CLASSIFY_CONCEPTS.indexOf(c) >= 0 ? c : null };
  } catch {
    return { ok: false };                          // network — leave it uncached
  }
}

function merchantText(extraction) {
  return String(extraction.counterparty_display || extraction.counterparty || '') +
    ' ' + String(extraction.memo || '');
}

/* Mutates extraction.category in place when it can improve on null. Best-effort
   throughout: any DB or model hiccup leaves the concept as it was. */
export async function enrichCategory(extraction, grant, ctx) {
  if (!extraction) return;
  if (CLASSIFY_CONCEPTS.indexOf(extraction.category) >= 0) return;   // (1) extractor already knows

  const text = merchantText(extraction);
  const key = merchantKey(extraction.counterparty_display || extraction.counterparty, extraction.memo);
  if (!key || key.length < 2) return;

  let hash = null;
  try { hash = await hashKey(key, ctx.subtle); } catch { /* no subtle → skip the DB tiers */ }

  // (2) user correction — the human label outranks every machine.
  if (hash && ctx.db && ctx.db.merchantCorrectionGet && grant && grant.user_id) {
    try {
      const c = await ctx.db.merchantCorrectionGet(grant.user_id, hash);
      if (CLASSIFY_CONCEPTS.indexOf(c) >= 0) { extraction.category = c; return; }
    } catch { /* best-effort */ }
  }

  // (3) curated dictionary — deterministic, free.
  const dict = dictionaryConcept(text);
  if (dict) { extraction.category = dict; return; }

  // (4) per-merchant cache, including the negative "already tried, unknowable".
  if (hash && ctx.db && ctx.db.merchantConceptGet) {
    try {
      const row = await ctx.db.merchantConceptGet(hash);
      if (row) {   // a row that EXISTS means we've already spent a call on this merchant
        if (CLASSIFY_CONCEPTS.indexOf(row.concept) >= 0) extraction.category = row.concept;
        return;    // negative (null concept) → stay generic, never re-call
      }
    } catch { /* fall through to a fresh classify */ }
  }

  // (5) one-shot model classify — only if this run still has budget.
  const budget = ctx.classifyBudget;
  if (!budget || budget.left <= 0) return;
  budget.left--;
  const out = await classifyMerchant(text, ctx.llm, ctx.fetch);
  if (!out || !out.ok) return;                     // transport error → leave uncached, retry-eligible
  const concept = CLASSIFY_CONCEPTS.indexOf(out.concept) >= 0 ? out.concept : null;
  if (hash && ctx.db && ctx.db.merchantConceptPut) {
    try { await ctx.db.merchantConceptPut(hash, concept); } catch { /* cache is a bonus */ }
  }
  if (concept) extraction.category = concept;
}
