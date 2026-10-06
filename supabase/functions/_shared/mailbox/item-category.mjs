/**
 * Item categorisation — the signature ladder (receipt-enrichment-spec.md §20).
 *
 * A receipt item's category, learned ONCE per TYPE and replayed free — the
 * template economics the email reader already has, applied to categories.
 * The thing that repeats is not the product (unbounded, seen once) but the
 * slot it sits in: the head-noun phrase of a listing ("mu boi"), a
 * subscription's vendor and product ("sub|google|google one" — the same key
 * whether billed through Apple or Google Play), or a store's content slot
 * ("store|apple tv|movie rental"). Each is asked about once, cached in
 * `item_signatures`, and
 * every later item under it costs nothing.
 *
 * The ladder, per item, first hit wins:
 *   1. the tree's own keywords          — deterministic, free
 *   2. the learned signature             — one row per type; a NULL row is
 *                                          "asked, unknowable", never re-asked
 *   3. the model, once per UNSEEN signature, one batched call per run,
 *      spent from the same classifyBudget merchant classification uses
 *   4. nothing                           — null always beats a guess
 *
 * WHAT KEEPS A LEARNED ANSWER HONEST. A learned email template is kept only
 * if replaying it reproduces the model's own answer. Here the guards are:
 *   - a signature the tree's keywords can read is NEVER asked: the keyword
 *     answer is authoritative, free, and every item under the same signature
 *     inherits it directly (a signature IS a type — one reading names all);
 *   - a model answer is validated structurally: it must be a machine-fileable
 *     expense code, and a goods signature (hn|…) may never resolve to a venue
 *     or class — the exact failure the merchant classifier produced;
 *   - an unknowable is cached as null, so it is asked once, not per mail;
 *   - CATEGORY_LOGIC_VERSION rides every row: a bump re-learns everything.
 *
 * What the model is SENT: the signature phrase, the provider and service
 * type. Never a full product title, never an amount, never a person. What
 * the shared table HOLDS: type words and slots — the same class of data
 * merchant_concepts already holds, and narrower than what a first-of-format
 * receipt already sends the reader's model.
 *
 * What this never does: it never touches the transaction's own node. The
 * device applies its branch constraint to whatever is sealed here
 * (78-receipt-join, spec RC9/RC19); a person's own lesson outranks it.
 */

import { TAX } from './taxonomy.mjs';
import { callGemini, toGeminiSchema } from './llm.mjs';

/** Bump when the prompt or the ladder changes MEANING: every older row in
 *  item_signatures becomes a miss and is re-learned. */
export const CATEGORY_LOGIC_VERSION = 2;   // 2 (2026-10-06): store-neutral `sub|`/`store|` keys replace `apple|…`

/* Receipt senders whose items are goods with head-initial titles. */
const HEAD_NOUN_PROVIDERS = { Shopee: 1, ShopeeFood: 1, Foody: 1, Tiki: 1, Lazada: 1 };

/* The expense menu the model may answer from — every code the tree lets a
   machine file into (a `manual` node is a person's decision, never a guess). */
const MENU_CODES = TAX.nodes.filter((n) => n.kind === 'expense' && !n.manual).map((n) => n.code);
const MENU = MENU_CODES.join(', ');
const MENU_SET = Object.fromEntries(MENU_CODES.map((c) => [c, 1]));

function validNode(code) {
  return code && MENU_SET[code] ? code : null;
}

/** The signature an item is learned under, or null when nothing usable
 *  leads its title. The reader may have set `sig` already (Apple: the slot
 *  or vendor it parsed); marketplace goods take the head-noun phrase. */
export function itemSignatureFor(item, provider) {
  if (!item) return null;
  if (item.sig) return String(item.sig);
  if (!HEAD_NOUN_PROVIDERS[provider]) return null;
  const hn = TAX.itemSignature(item.name || '');
  return hn ? 'hn|' + hn : null;
}

const ITEM_SYSTEM =
  'You label PRODUCT TYPES and digital purchase kinds for a Vietnamese family\'s spending ledger. ' +
  'You are given a numbered list of SIGNATURES, each with its source. A signature is either a product-type ' +
  'phrase taken from the start of an e-commerce listing (Vietnamese without diacritics or English: "mu boi" = swim cap, ' +
  '"noi chien" = air fryer, "ao thun" = t-shirt, "swimming goggles"), a SUBSCRIPTION as vendor and product ' +
  '("subscription google | google one", "subscription youtube | youtube premium", "subscription duolingo | duolingo plus"), ' +
  'or a store\'s content slot ("store apple tv | movie rental", "store google play | app"). ' +
  'Reply as JSON {"items":[{"i":<number>,"node":...}]} with one item per line. ' +
  'node is the MOST SPECIFIC expense category code you are confident about, EXACTLY one of: ' + MENU + ' -- ' +
  'a leaf when the type clearly is that, its group when you know the area but not the exact kind, ' +
  'or null when you genuinely cannot tell. Do not guess wildly; null is the right answer for the unknowable. ' +
  'RULES. A physical product is a THING someone bought: never answer a place, venue, class, membership or service ' +
  'node for it (a swim cap is sports gear, not a swimming pool; a yoga mat is gear, not a gym). ' +
  'A rental or subscription is filed by what it gives access to: a video or music service is streaming, ' +
  'a language or course app is courses, cloud storage is a digital subscription, a game is games.';

const ITEM_SCHEMA = {
  type: 'object',
  properties: { items: { type: 'array', items: { type: 'object', properties: {
    i: { type: 'integer' },
    /* Plain string, not an enum: the menu is past what Gemini's OpenAPI subset
       accepts as an enum (classify.mjs learned this with a hard 400). validNode
       is the real gate. */
    node: { type: ['string', 'null'] },
  }, required: ['i', 'node'] } } },
  required: ['items'],
};

/** One batched model call for the unseen signatures. Returns a Map key→node
 *  (null = unknowable), or NULL when the model could not be asked — which the
 *  caller treats as "not tried", never as an answer: nothing is cached. */
async function askModel(entries, provider, serviceType, cfg, fetchImpl) {
  if (!cfg || !cfg.apiKey || !entries.length) return null;
  const list = entries.map((e, i) => (i + 1) + '. [' + provider + (serviceType ? ' / ' + serviceType : '') + '] '
    + e.key.replace(/^hn\|/, '').replace(/^sub\|/, 'subscription ').replace(/^store\|/, 'store ').replace(/\|/g, ' | ')).join('\n');
  const r = await callGemini('classify_item_batch', {
    systemInstruction: { parts: [{ text: ITEM_SYSTEM }] },
    contents: [{ role: 'user', parts: [{ text: list }] }],
    generationConfig: { responseMimeType: 'application/json', responseSchema: toGeminiSchema(ITEM_SCHEMA) },
  }, cfg, fetchImpl);
  if (!r || r.transportError || !r.ok) return null;
  const text = r.data && r.data.candidates && r.data.candidates[0] && r.data.candidates[0].content
    && r.data.candidates[0].content.parts && r.data.candidates[0].content.parts[0] && r.data.candidates[0].content.parts[0].text;
  if (!text) return null;
  let parsed;
  try { parsed = JSON.parse(text); } catch { return null; }
  const out = new Map(entries.map((e) => [e.key, null]));
  for (const it of (parsed && parsed.items) || []) {
    const idx = Number(it && it.i) - 1;
    if (idx >= 0 && idx < entries.length) out.set(entries[idx].key, validNode(it && it.node));
  }
  return out;
}

/**
 * Fills `receipt.items[].node` and `.sig` in place. Never throws: every tier
 * is best-effort and a miss leaves the item without a category.
 *
 * @param receipt   the reading's receipt block ({items: [...]}, or null)
 * @param meta      { provider, serviceType }
 * @param ctx       { db, llm, fetch, classifyBudget }
 * @returns         { resolved, asked, cached } counts, for the tally
 */
export async function categoriseItems(receipt, meta, ctx) {
  const stats = { resolved: 0, asked: 0, cached: 0 };
  const items = (receipt && Array.isArray(receipt.items)) ? receipt.items.filter((it) => it && it.name) : [];
  if (!items.length) return stats;
  const provider = (meta && meta.provider) || '';
  const db = ctx && ctx.db;

  // ── 1. keywords, and the signature each item is learned under ──
  const pending = [];        // items that need the cache or the model
  for (const it of items) {
    const sig = itemSignatureFor(it, provider);
    if (sig) it.sig = sig;
    let kw = null;
    try { kw = validNode(TAX.keywordNode(it.name, 'expense')); } catch { kw = null; }
    if (kw) { it.node = kw; stats.resolved++; }
    if (sig) pending.push({ it, key: sig, kw });
  }

  // ── 2. the learned signatures, one read for the run's keys ──
  const keys = [...new Set(pending.map((p) => p.key))];
  let rows = new Map();
  if (keys.length && db && db.itemSignaturesGet) {
    try { rows = await db.itemSignaturesGet(keys); } catch { rows = new Map(); }
  }
  const unseen = new Map();  // key → { key, items[] (still unresolved), kwRoots (evidence from siblings) }
  for (const p of pending) {
    const row = rows.get(p.key);
    const current = row && Number(row.logic_version) === CATEGORY_LOGIC_VERSION;
    if (p.kw) {
      /* The keyword tier already answered; let it TEACH the table when the
         table has nothing, so the next mailbox pays nothing either. */
      if (!row && db && db.itemSignaturePut) {
        try { await db.itemSignaturePut(p.key, p.kw, 'keyword', CATEGORY_LOGIC_VERSION); } catch { /* bonus */ }
      }
      /* …and NAME every sibling under the same signature that the keywords
         could not read: a signature is a type, one reading names all, and
         none of them needs the model. */
      const u0 = unseen.get(p.key) || { key: p.key, items: [], kwNode: null };
      u0.kwNode = u0.kwNode || p.kw;
      unseen.set(p.key, u0);
      continue;
    }
    if (current) {
      const node = validNode(row.node);
      if (node) { p.it.node = node; stats.resolved++; }
      stats.cached++;
      continue;                                 // a null row is an answer too
    }
    const u = unseen.get(p.key) || { key: p.key, items: [], kwNode: null };
    u.items.push(p.it);
    unseen.set(p.key, u);
  }
  for (const [k, u] of unseen) {
    if (u.kwNode) { for (const it of u.items) { it.node = u.kwNode; stats.resolved++; } unseen.delete(k); }
    else if (!u.items.length) unseen.delete(k);
  }
  if (!unseen.size) return stats;

  // ── 3. the model, once per unseen signature, budget-gated ──
  const budget = ctx && ctx.classifyBudget;
  if (!budget || budget.left <= 0) return stats;
  budget.left--;
  const entries = [...unseen.values()];
  const answers = await askModel(entries, provider, meta && meta.serviceType, ctx.llm, ctx.fetch);
  if (!answers) return stats;                   // could not ask: nothing cached, retried next run
  stats.asked = entries.length;

  for (const e of entries) {
    const node = answers.get(e.key) ?? null;
    /* THE STRUCTURAL GATE. A goods signature (hn|…) is a THING someone
       bought and may never resolve to a venue or class — the exact failure
       the merchant classifier produced (a swim cap filed as a pool). A refused
       answer is neither cached nor applied: it is asked again on a later run
       (a new prompt, a new logic version). */
    let agree = true;
    if (node && /^hn\|/.test(e.key)) {
      if (node === 'fitness' || TAX.ancestors(node).indexOf('fitness') >= 0) agree = false;
    }
    if (!agree) continue;
    if (node) for (const it of e.items) { it.node = node; stats.resolved++; }
    if (db && db.itemSignaturePut) {
      try { await db.itemSignaturePut(e.key, node, 'llm', CATEGORY_LOGIC_VERSION); } catch { /* bonus */ }
    }
  }
  return stats;
}
