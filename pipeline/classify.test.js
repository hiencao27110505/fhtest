#!/usr/bin/env node
/* The server-side category cascade (classify.mjs): dictionary (#1), synced user
 * correction (#3), per-merchant cache incl. negative (#2), and a ONE-SHOT model
 * classify (#2). `node pipeline/classify.test.js`
 *
 * What a deploy would not catch until a real family got a wrong or generic
 * banner:
 *   • the precedence order — a human correction must outrank the dictionary,
 *     the dictionary must outrank a fresh model call
 *   • the negative cache — a merchant the model already gave up on is NEVER
 *     re-called (that is the whole free-tier-spend argument)
 *   • one-shot — a 429/transport failure falls to generic AND leaves the cache
 *     untouched, so the merchant stays eligible instead of being poisoned
 *   • the budget ceiling — no classify call once the run's allowance is spent
 *   • the merchant key strips gateways (incl. REVI) and digit runs, so the #3
 *     hash is stable across a merchant's cosmetic variants
 */
const C = await import('../supabase/functions/_shared/mailbox/classify.mjs');
const { merchantKey, dictionaryConcept, enrichCategory, CLASSIFY_CONCEPTS } = C;

let pass = 0, fail = 0;
const t = (n, ok, d) => { console.log((ok ? '  PASS  ' : '  FAIL  ') + n + (!ok && d ? '  -> ' + d : '')); ok ? pass++ : fail++; };

const subtle = globalThis.crypto.subtle;

function stubDb(over) {
  return Object.assign({
    merchantCorrectionGet: async () => null,
    merchantConceptGet: async () => null,
    merchantConceptPut: async () => {},
  }, over || {});
}
// A fake Gemini response for the one-shot classify.
function fakeFetch(conceptOrNull, opts) {
  opts = opts || {};
  return async () => {
    if (opts.notOk) return { ok: false, json: async () => ({}) };   // 429/5xx
    return {
      ok: true,
      json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify({ concept: conceptOrNull }) }] } }] }),
    };
  };
}

// ── merchant key: gateways + REVI + digit runs stripped ─────────────────────
t('key strips a leading gateway + long digit run',
  merchantKey('PAYOO 998877 HIGHLANDS COFFEE', '') === 'highlands coffee',
  merchantKey('PAYOO 998877 HIGHLANDS COFFEE', ''));
t('key strips the REVI gateway word',
  merchantKey('REVI PHU MY HUNG TOWER', '').indexOf('revi') === -1,
  merchantKey('REVI PHU MY HUNG TOWER', ''));
t('key is diacritic-folded + lowercased',
  merchantKey('Cửa Hàng Tạp Hoá', '') === 'cua hang tap hoa',
  merchantKey('Cửa Hàng Tạp Hoá', ''));

// ── dictionary (#1) ─────────────────────────────────────────────────────────
t('dictionary: GRAB → Transport', dictionaryConcept('GRAB*TRIP HCM') === 'Transport');
t('dictionary: HIGHLANDS → Dining', dictionaryConcept('HIGHLANDS COFFEE Q1') === 'Dining');
t('dictionary: AEON → a real concept (not null)', !!dictionaryConcept('AEON CELADON TAN PHU'));
t('dictionary: opaque string → null', dictionaryConcept('qopaquexyz zzz') === null);

// ── cascade precedence ──────────────────────────────────────────────────────
async function run() {
  // (1) extractor already classified → left untouched even where the dictionary disagrees
  {
    const ex = { counterparty: 'GRAB TRIP', category: 'Fun' };
    await enrichCategory(ex, { user_id: 'u1' }, { db: stubDb(), subtle });
    t('extractor category is authoritative', ex.category === 'Fun', ex.category);
  }
  // (2) a synced correction outranks the dictionary
  {
    const ex = { counterparty: 'AEON MALL', category: null };
    const db = stubDb({ merchantCorrectionGet: async () => 'Fun' });
    await enrichCategory(ex, { user_id: 'u1' }, { db, subtle });
    t('user correction beats dictionary', ex.category === 'Fun', ex.category);
  }
  // (3) dictionary fills when there is no correction
  {
    const ex = { counterparty: 'GRAB TRIP', category: null };
    await enrichCategory(ex, { user_id: 'u1' }, { db: stubDb(), subtle });
    t('dictionary fills a null category', ex.category === 'Transport', ex.category);
  }
  // (4) positive cache hit for a merchant the dictionary does not know
  {
    const ex = { counterparty: 'QOPAQUE SHOP', category: null };
    const db = stubDb({ merchantConceptGet: async () => ({ concept: 'Shopping' }) });
    await enrichCategory(ex, { user_id: 'u1' }, { db, subtle });
    t('positive cache fills the concept', ex.category === 'Shopping', ex.category);
  }
  // (5) NEGATIVE cache: a row with null concept → stay generic, and NEVER call the model
  {
    let fetched = false;
    const ex = { counterparty: 'QOPAQUE SHOP', category: null };
    const db = stubDb({ merchantConceptGet: async () => ({ concept: null }) });
    await enrichCategory(ex, { user_id: 'u1' }, {
      db, subtle, llm: { apiKey: 'x' }, classifyBudget: { left: 5 },
      fetch: () => { fetched = true; return fakeFetch('Dining')(); },
    });
    t('negative cache stays generic', ex.category == null, String(ex.category));
    t('negative cache never re-calls the model', fetched === false);
  }
  // (6) fresh classify on a full miss → sets category AND writes the cache
  {
    let put = null;
    const ex = { counterparty: 'QOPAQUE SHOP', category: null };
    const db = stubDb({ merchantConceptPut: async (h, c) => { put = c; } });
    await enrichCategory(ex, { user_id: 'u1' }, {
      db, subtle, llm: { apiKey: 'x' }, classifyBudget: { left: 1 }, fetch: fakeFetch('Dining'),
    });
    t('one-shot classify fills the concept', ex.category === 'Dining', ex.category);
    t('one-shot classify caches the concept', put === 'Dining', String(put));
  }
  // (7) budget exhausted → no model call, stays generic
  {
    let fetched = false;
    const ex = { counterparty: 'QOPAQUE SHOP', category: null };
    await enrichCategory(ex, { user_id: 'u1' }, {
      db: stubDb(), subtle, llm: { apiKey: 'x' }, classifyBudget: { left: 0 },
      fetch: () => { fetched = true; return fakeFetch('Dining')(); },
    });
    t('no classify once budget is spent', ex.category == null && fetched === false);
  }
  // (8) one-shot 429: fall to generic, and DO NOT poison the cache
  {
    let put = 'untouched';
    const ex = { counterparty: 'QOPAQUE SHOP', category: null };
    const db = stubDb({ merchantConceptPut: async (h, c) => { put = c; } });
    await enrichCategory(ex, { user_id: 'u1' }, {
      db, subtle, llm: { apiKey: 'x' }, classifyBudget: { left: 1 }, fetch: fakeFetch(null, { notOk: true }),
    });
    t('a 429 stays generic', ex.category == null, String(ex.category));
    t('a 429 does not write the cache', put === 'untouched', String(put));
  }
  // model ran but could not tell → negative cache written (so we never retry)
  {
    let put = 'untouched';
    const ex = { counterparty: 'QOPAQUE SHOP', category: null };
    const db = stubDb({ merchantConceptPut: async (h, c) => { put = c; } });
    await enrichCategory(ex, { user_id: 'u1' }, {
      db, subtle, llm: { apiKey: 'x' }, classifyBudget: { left: 1 }, fetch: fakeFetch(null),
    });
    t('unknowable merchant is negatively cached', put === null, String(put));
  }

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  if (fail) process.exit(1);
}
await run();
