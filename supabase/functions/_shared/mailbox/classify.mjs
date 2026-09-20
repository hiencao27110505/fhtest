/* Server-side category cascade — the one place a concept is decided when the
   extractor left `category` null, which is MOST repeat mail (the template path in
   labeltable.mjs deliberately sets `category: null` and lets learning own it).
   Whatever this fills into `extraction.category` reaches BOTH consumers from a
   single seam in the worker:
     - stage.mjs → `category_hint` on the sealed row (the in-app suggestion), and
     - copyMeta  → the notification's concept (generic vs. contextual copy).

   SINCE THE CATEGORY TREE (0144, taxonomy.mjs) the cascade decides a tree NODE
   code first — a leaf ('coffee', 'electric') when the evidence supports one, a
   group ('drinks', 'utilities') when it only supports that — and the legacy
   8-concept `category` plus the notification `pool` are DERIVED from that node
   (conceptOf / poolOf), so the three can never disagree. Old clients keep
   reading category_hint / pool exactly as before; new clients read `node`.

   Precedence, strongest first:
     1. the extractor's own node/category (the LLM saw the whole email) — never
        overridden. A concept without a node may still gain a node from the tree
        keywords, but only one whose concept AGREES with the extractor's.
     2. a synced USER correction (merchant_corrections) — a human taught this
        merchant; node when the row has one, else the legacy concept
     3. the tree keywords (taxonomy.mjs keywordNode) — deterministic + free;
        the curated DICTIONARY below is only a fallback that still names a
        concept when no tree keyword fires
     4. the per-merchant cache (merchant_concepts) — node when the row has one,
        else concept/pool; a row that EXISTS with nulls is the negative
        "tried, unknowable" and is never re-asked
     5. a ONE-SHOT model classify — budget-gated; a 429 just falls to generic
        and is NOT cached, so the merchant stays eligible next run.
   Nothing here ever retries or holds the message — a miss is a garnish miss, and
   the transaction stages exactly as before. */

import { toGeminiSchema, callGemini } from './llm.mjs';
import { TAX, keywordNode, conceptOf, poolOf } from './taxonomy.mjs';

export const CLASSIFY_CONCEPTS = ['Housing', 'Groceries', 'Clothing', 'Shopping', 'Transport', 'Dining', 'Fun', 'Others'];

/* Every EXPENSE node the model may answer — leaves AND groups, so it can say
   'drinks' when it knows a café is a café but not which kind, rather than being
   forced to guess a leaf or give up. The manual-only 'xunfiled' root is left out:
   it is a person's verdict, never a classifier's. Built once at module load. */
export const CLASSIFY_NODES = TAX.nodes
  .filter((n) => n.kind === 'expense' && !n.manual)
  .map((n) => n.code);
const NODE_SET = new Set(CLASSIFY_NODES);

/* A node code the cascade will accept from any source (model, cache, correction,
   extractor): must be a real expense node this build knows. Anything else —
   an income code, a typo, a code from a newer tree — reads as "no node". */
export function validNode(code) {
  return typeof code === 'string' && NODE_SET.has(code) ? code : null;
}

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

/* Curated merchant→concept dictionary — a server-side slice of the client's
   CSV_MERCHANTS, biggest chains only. Since the tree, this is the FALLBACK
   behind keywordNode: it still names a concept for a chain the tree has no
   keyword for ("grab" alone is deliberately not a tree keyword — GrabFood vs
   GrabBike is a node question the model answers), so old readers keep the
   concept they always had while the node comes from a later tier.
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

/* The tree's answer for a merchant string: the most specific EXPENSE node whose
   keyword appears (taxonomy.mjs orders deepest-first, longest-first). Null when
   no keyword fires — a bare "GRAB", an opaque gateway code. */
export function keywordNodeFor(text) {
  try { return validNode(keywordNode(text, 'expense')); } catch { return null; }
}

/* The four finer sub-kinds the notification has a dedicated voice for. Since the
   tree they are simply the `pool` attribute of a leaf (coffee, milktea, bikehail/
   carhail → ride, cinema): poolOf(node). The model is still asked for one on the
   legacy path so a concept-only answer keeps the coffee voice. Kept in sync with
   the POOLS keys in notify-copy.mjs. */
export const CLASSIFY_POOLS = ['coffee', 'milktea', 'ride', 'cinema'];

/* Concept + pool DERIVED from a node, so copy and old clients stay consistent
   with the tree. A group node has no pool of its own → null. */
export function derivedFromNode(node) {
  const n = validNode(node);
  if (!n) return null;
  const concept = conceptOf(n);
  const pool = poolOf(n);
  return {
    node: n,
    concept: CLASSIFY_CONCEPTS.indexOf(concept) >= 0 ? concept : null,
    pool: CLASSIFY_POOLS.indexOf(pool) >= 0 ? pool : null,
  };
}

/* Writes {node, concept, pool} onto an extraction. The node is only ever set
   when the extraction has none (an extractor-provided node is never overridden);
   concept and pool fill only what is empty. */
function _apply(extraction, node, concept, pool) {
  if (node && !validNode(extraction.node)) extraction.node = node;
  if (concept && CLASSIFY_CONCEPTS.indexOf(extraction.category) < 0) extraction.category = concept;
  if (pool && CLASSIFY_POOLS.indexOf(extraction.pool) < 0) extraction.pool = pool;
}

/* Normalises one model answer ({node, concept, pool} in any state of validity)
   into the triple the cascade stores: a valid node wins and derives the rest;
   otherwise the legacy concept/pool answer stands on its own. */
function _fromAnswer(a) {
  const d = derivedFromNode(a && a.node);
  if (d) return d;
  return {
    node: null,
    concept: a && CLASSIFY_CONCEPTS.indexOf(a.concept) >= 0 ? a.concept : null,
    pool: a && CLASSIFY_POOLS.indexOf(a.pool) >= 0 ? a.pool : null,
  };
}

/* A merchant_corrections read, in either shape db.mjs has ever returned: the
   legacy bare concept string, or {concept, node}. */
function _fromCorrection(c) {
  if (c == null) return null;
  if (typeof c === 'string') return { node: null, concept: CLASSIFY_CONCEPTS.indexOf(c) >= 0 ? c : null, pool: null };
  const d = derivedFromNode(c.node);
  if (d) return d;
  return { node: null, concept: CLASSIFY_CONCEPTS.indexOf(c.concept) >= 0 ? c.concept : null, pool: null };
}

/* A merchant_concepts row (which may predate the node column). */
function _fromCacheRow(row) {
  const d = derivedFromNode(row && row.node);
  if (d) return d;
  return {
    node: null,
    concept: row && CLASSIFY_CONCEPTS.indexOf(row.concept) >= 0 ? row.concept : null,
    pool: row && CLASSIFY_POOLS.indexOf(row.pool) >= 0 ? row.pool : null,
  };
}

const NODE_MENU = CLASSIFY_NODES.join(', ');

export const CLASSIFY_SYSTEM = 'You label a Vietnamese bank-transaction merchant/counterparty string. ' +
  'Reply as JSON {"node": ..., "concept": ..., "pool": ...}. ' +
  'node is the MOST SPECIFIC category-tree code you are confident about, EXACTLY one of: ' + NODE_MENU + ' — ' +
  'or null when you genuinely cannot tell (an opaque gateway or bank code, initials, a bare reference number). ' +
  'Prefer a leaf (coffee, fuel, electric, pharmacy) when the merchant clearly is that; answer its group (drinks, vehicle, utilities, medical) when you know the area but not the exact kind; null for the unknowable. Do not guess wildly. ' +
  'concept is EXACTLY one of: Housing, Groceries, Clothing, Shopping, Transport, Dining, Fun, Others — or null when you cannot tell. ' +
  'pool is a FINER label, EXACTLY one of: coffee (a coffee shop / quán cà phê), milktea (bubble or milk tea), ride (ride-hailing or taxi), cinema (a movie theatre) — ' +
  'or null when the merchant is none of those four specific kinds. Most merchants are pool null; set it only when you clearly recognise the brand or words as one of the four.';

const CLASSIFY_SCHEMA = {
  type: 'object',
  properties: {
    /* A plain string, NOT an enum: 155 enum values is past what Gemini's
       OpenAPI subset accepts and it answered every call with a hard 400.
       The menu rides the prompt instead, and validNode() is the gate it
       always really was: anything that is not a code this build knows
       reads as null. */
    node: { type: ['string', 'null'] },
    concept: { type: ['string', 'null'], enum: [...CLASSIFY_CONCEPTS, null] },
    pool: { type: ['string', 'null'], enum: [...CLASSIFY_POOLS, null] },
  },
};

function _answerText(r) {
  return r.data && r.data.candidates && r.data.candidates[0] &&
    r.data.candidates[0].content && r.data.candidates[0].content.parts &&
    r.data.candidates[0].content.parts[0] && r.data.candidates[0].content.parts[0].text;
}

/* One-shot merchant classify. Never throws, never retries: any transport failure
   (429 included) returns {ok:false} so the caller falls to generic copy and does
   NOT poison the cache; a real model answer returns {ok:true, node, concept, pool}
   where all-null is a legitimate "unknowable" that DOES get negatively cached.
   A node the tree does not know is rejected (stays null) rather than stored. */
export async function classifyMerchant(text, cfg, fetchImpl) {
  if (!cfg || !cfg.apiKey) return { ok: false };
  const r = await callGemini('classify_merchant', {
    systemInstruction: { parts: [{ text: CLASSIFY_SYSTEM }] },
    contents: [{ role: 'user', parts: [{ text: 'Merchant: ' + String(text).slice(0, 200) }] }],
    generationConfig: { responseMimeType: 'application/json', responseSchema: toGeminiSchema(CLASSIFY_SCHEMA) },
  }, cfg, fetchImpl);
  if (r.transportError || !r.ok) return { ok: false };   // 429/5xx/network → one-shot, no retry, no cache
  const answer = _answerText(r);
  if (!answer) return { ok: true, node: null, concept: null, pool: null };
  let parsed;
  try { parsed = JSON.parse(answer); } catch { return { ok: true, node: null, concept: null, pool: null }; }
  return { ok: true, ..._fromAnswer(parsed) };
}

function merchantText(extraction) {
  return String(extraction.counterparty_display || extraction.counterparty || '') +
    ' ' + String(extraction.memo || '');
}

/* Mutates extraction.node / .category / .pool in place when it can improve on
   null. Best-effort throughout: any DB or model hiccup leaves them as they were. */
export async function enrichCategory(extraction, grant, ctx) {
  if (!extraction) return;
  ctx = ctx || {};

  // (1) extractor already knows the node → derive what is missing, done.
  if (validNode(extraction.node)) {
    const d = derivedFromNode(extraction.node);
    _apply(extraction, null, d.concept, d.pool);
    return;
  }

  const text = merchantText(extraction);

  // (1b) extractor knows the concept but not the node: the old contract was
  // "category is authoritative, no DB, no model". Kept — except that a FREE tree
  // keyword may add the node when its concept agrees with the extractor's.
  if (CLASSIFY_CONCEPTS.indexOf(extraction.category) >= 0) {
    const kn = keywordNodeFor(text);
    const d = derivedFromNode(kn);
    if (d && d.concept === extraction.category) _apply(extraction, d.node, null, d.pool);
    return;
  }

  const key = merchantKey(extraction.counterparty_display || extraction.counterparty, extraction.memo);
  if (!key || key.length < 2) return;

  let hash = null;
  try { hash = await hashKey(key, ctx.subtle); } catch { /* no subtle → skip the DB tiers */ }

  // (2) user correction — the human label outranks every machine.
  if (hash && ctx.db && ctx.db.merchantCorrectionGet && grant && grant.user_id) {
    try {
      const c = _fromCorrection(await ctx.db.merchantCorrectionGet(grant.user_id, hash));
      if (c && (c.node || c.concept)) { _apply(extraction, c.node, c.concept, c.pool); return; }
    } catch { /* best-effort */ }
  }

  // (3) tree keywords — deterministic, free. A node answers outright.
  const kn = derivedFromNode(keywordNodeFor(text));
  if (kn) { _apply(extraction, kn.node, kn.concept, kn.pool); return; }
  // ...and the curated dictionary still names a concept when no keyword fires.
  // Not terminal: the concept is a floor for old readers, while the cache and
  // (once, per distinct merchant) the model may still supply the node.
  const dict = dictionaryConcept(text);
  if (dict) _apply(extraction, null, dict, null);

  // (4) per-merchant cache, including the negative "already tried, unknowable".
  if (hash && ctx.db && ctx.db.merchantConceptGet) {
    try {
      const row = await ctx.db.merchantConceptGet(hash);
      if (row) {   // a row that EXISTS means we've already spent a call on this merchant
        const c = _fromCacheRow(row);
        _apply(extraction, c.node, c.concept, c.pool);
        return;    // negative (all null) → stay generic, never re-call
      }
    } catch { /* fall through to a fresh classify */ }
  }

  // (5) one-shot model classify — only if this run still has budget.
  const budget = ctx.classifyBudget;
  if (!budget || budget.left <= 0) return;
  budget.left--;
  const out = await classifyMerchant(text, ctx.llm, ctx.fetch);
  if (!out || !out.ok) return;                     // transport error → leave uncached, retry-eligible
  const node = validNode(out.node);
  // What the cache remembers: the node-derived concept when there is a node
  // (so a later read stays self-consistent), else the model's own concept, else
  // the dictionary's — never a null concept beside a known one.
  const concept = out.concept || (CLASSIFY_CONCEPTS.indexOf(extraction.category) >= 0 ? extraction.category : null);
  const pool = out.pool;
  if (hash && ctx.db && ctx.db.merchantConceptPut) {
    try { await ctx.db.merchantConceptPut(hash, concept, pool, node); } catch { /* cache is a bonus */ }
  }
  if (node) {
    // The node is the model's most specific claim; the concept it implies wins
    // over a broader dictionary guess so the two never disagree on one row.
    extraction.node = node;
    if (out.concept) extraction.category = out.concept;
    if (out.pool) extraction.pool = out.pool;
    return;
  }
  _apply(extraction, null, concept, pool);
}

/* ── A batch of merchants, for a statement (statement-capture-spec.md section 11) ──
   One email names one merchant, and enrichCategory above spends at most one model
   call on it. A statement names thirty at once, on a project whose model quota is
   the free tier. So the same cascade runs per name with the model step LAST and
   ONCE: every name the free tiers cannot place goes into a single request.

   What arrives here is merchant names only -- the device never sends an amount, a
   date, or a counterparty that is a person. Nothing is logged but counts. */

export const BATCH_MAX = 60;          // names accepted per request
export const BATCH_MODEL_MAX = 40;    // names that may ride the one model call

export const BATCH_SYSTEM = 'You label Vietnamese merchant names from bank and e-wallet statements. ' +
  'You are given a numbered list. Reply as JSON {"items":[{"i":<number>,"node":...,"concept":...,"pool":...}]} with one item per line of the list. ' +
  'node is the MOST SPECIFIC category-tree code you are confident about, EXACTLY one of: ' + NODE_MENU + ' -- ' +
  'a leaf when the merchant clearly is that kind, its group when you know the area but not the exact kind, ' +
  'or null when you genuinely cannot tell (an opaque gateway or bank code, initials, a bare reference number). Do not guess wildly; null is the right answer for the unknowable. ' +
  'concept is EXACTLY one of: Housing, Groceries, Clothing, Shopping, Transport, Dining, Fun, Others -- or null. ' +
  'pool is EXACTLY one of: coffee, milktea, ride, cinema -- or null. Most merchants are pool null.';
const BATCH_SCHEMA = {
  type: 'object',
  properties: { items: { type: 'array', items: { type: 'object', properties: {
    i: { type: 'integer' },
    /* A plain string, NOT an enum: 155 enum values is past what Gemini's
       OpenAPI subset accepts and it answered every call with a hard 400.
       The menu rides the prompt instead, and validNode() is the gate it
       always really was: anything that is not a code this build knows
       reads as null. */
    node: { type: ['string', 'null'] },
    concept: { type: ['string', 'null'], enum: [...CLASSIFY_CONCEPTS, null] },
    pool: { type: ['string', 'null'], enum: [...CLASSIFY_POOLS, null] },
  }, required: ['i'] } } },
  required: ['items'],
};

/* Gemini's schema converter only walks top-level properties; the nested item
   properties need the same null-union → nullable rewrite by hand. */
function _batchGeminiSchema() {
  const s = toGeminiSchema(BATCH_SCHEMA);
  const props = s.properties.items.items.properties;
  for (const k of Object.keys(props)) {
    const p = props[k];
    if (Array.isArray(p.type)) {
      p.type = p.type.filter((t) => t !== 'null')[0];
      p.nullable = true;
      if (Array.isArray(p.enum)) p.enum = p.enum.filter((e) => e !== null);
    }
  }
  return s;
}

/* One model call for many merchants. Returns an array aligned with `texts`
   ({node, concept, pool} each), or NULL when the model could not be asked -- 429,
   transport, no key -- which the caller must treat as "not tried", never as
   "unknowable": a null here is not cached. */
export async function classifyMerchantsBatch(texts, cfg, fetchImpl) {
  if (!cfg || !cfg.apiKey || !texts || !texts.length) return null;
  const list = texts.map((x, i) => (i + 1) + '. ' + String(x).slice(0, 80).replace(/\s+/g, ' ')).join('\n');
  const r = await callGemini('classify_merchant_batch', {
    systemInstruction: { parts: [{ text: BATCH_SYSTEM }] },
    contents: [{ role: 'user', parts: [{ text: list }] }],
    generationConfig: { responseMimeType: 'application/json', responseSchema: _batchGeminiSchema() },
  }, cfg, fetchImpl);
  if (r.transportError || !r.ok) return null;
  const answer = _answerText(r);
  if (!answer) return null;
  let parsed;
  try { parsed = JSON.parse(answer); } catch { return null; }
  const out = texts.map(() => ({ node: null, concept: null, pool: null }));
  for (const it of (parsed && parsed.items) || []) {
    const idx = Number(it && it.i) - 1;
    if (!(idx >= 0 && idx < out.length)) continue;
    out[idx] = _fromAnswer(it);
  }
  return out;
}

/* names -> { concepts: {name: concept|null}, nodes: {name: node|null}, ... }.
   Precedence is enrichCategory's, per name: the person's own correction, the tree
   keywords (dictionary as a concept-only fallback), the shared cache (a row that
   EXISTS is an answer, even a null one), then the one batched call. Everything the
   model answers is cached for every user, nulls included. `concepts` keeps its
   shape for the merchant-concepts function's existing reply; `nodes` is new. */
export async function conceptsForMerchants(names, userId, ctx) {
  const result = {};
  const nodes = {};
  const uniq = [...new Set((names || []).map(n => String(n || '').trim()).filter(n => n.length >= 2))].slice(0, BATCH_MAX);
  const misses = [];
  for (const name of uniq) {
    result[name] = null;
    nodes[name] = null;
    const key = merchantKey(name, '');
    if (!key || key.length < 2) continue;
    let hash = null;
    try { hash = await hashKey(key, ctx.subtle); } catch { /* no subtle: keywords/dictionary only */ }

    if (hash && userId && ctx.db.merchantCorrectionGet) {
      try {
        const c = _fromCorrection(await ctx.db.merchantCorrectionGet(userId, hash));
        if (c && (c.node || c.concept)) { result[name] = c.concept; nodes[name] = c.node; continue; }
      } catch { /* best-effort */ }
    }
    const kn = derivedFromNode(keywordNodeFor(name));
    if (kn) { result[name] = kn.concept; nodes[name] = kn.node; continue; }
    const dict = dictionaryConcept(name);
    if (dict) result[name] = dict;
    if (hash && ctx.db.merchantConceptGet) {
      try {
        const row = await ctx.db.merchantConceptGet(hash);
        if (row) {
          const c = _fromCacheRow(row);
          if (c.node) { nodes[name] = c.node; result[name] = c.concept; }
          else if (c.concept) result[name] = c.concept;
          continue;
        }
      } catch { /* fall through to the model */ }
    }
    if (hash) misses.push({ name, hash, floor: dict });
  }

  const ask = misses.slice(0, BATCH_MODEL_MAX);
  let asked = 0, limited = false;
  if (ask.length) {
    const answers = await classifyMerchantsBatch(ask.map(m => m.name), ctx.llm, ctx.fetch);
    if (!answers) limited = true;
    else {
      asked = ask.length;
      for (let i = 0; i < ask.length; i++) {
        const a = answers[i] || { node: null, concept: null, pool: null };
        const concept = a.concept || ask[i].floor || null;
        if (a.node) { nodes[ask[i].name] = a.node; result[ask[i].name] = a.concept; }
        else if (concept) result[ask[i].name] = concept;
        if (ctx.db.merchantConceptPut) { try { await ctx.db.merchantConceptPut(ask[i].hash, concept, a.pool, a.node); } catch { /* cache is a bonus */ } }
      }
    }
  }
  return { concepts: result, nodes, asked, limited, total: uniq.length };
}
