/* WHICH MODEL LABELS WHAT (2026-11-22). The strategy seam for the LABELING lane.
 *
 * "Labeling" here means choosing from a fixed menu: a merchant's tree node, a
 * receipt item's node, "is this a statement", a sender's verdict. Extraction
 * (amounts, dates, counterparties, items) is NOT in this lane and stays on
 * Gemini through llm.mjs: Jev only answers typed questions, it does not write
 * text, so it cannot read a mail.
 *
 * Each task module (classify, item-category, statement, discovery) keeps a small
 * table of strategies, one per provider, all with the same contract:
 *
 *     ready(cfg)               -> boolean   has what it needs to be asked (a key)
 *     run(cfg, fetchImpl, ...) -> answer | null
 *
 * and asks this file which one to use. NULL MEANS "COULD NOT ASK" (429, 5xx,
 * network, no key, an answer that did not parse), never "the model does not
 * know": the callers treat null as not tried and cache nothing. A real "cannot
 * tell" is an answer and comes back as one. That rule is what lets the fallback
 * below be safe: it only ever fires on null, so it never second-guesses a model
 * that answered.
 *
 * Configuration is ONE env var, LABELER (cfg.labeler), an ordered list:
 *   (unset)       gemini, today's behaviour
 *   jev           Jev only
 *   jev,gemini    Jev first; Gemini only when Jev could not answer (null)
 * plus JEV_API_KEY. The Jev model id and its probability threshold are
 * constants in jev.mjs (JEV_DEFAULT_MODEL, JEV_DEFAULT_MIN_PROB): they change
 * with a bench run and a commit, not per deploy. One choice for the whole lane;
 * the `task` argument is kept for the log and for a future split.
 *
 * Turning Jev on for real family mail needs consent first: consent v5 names
 * Google as the AI service (docs/PDPL-COMPLIANCE.md §2, §5d). Until then the
 * deployed default stays gemini, and Jev is measured offline
 * (tools/labeler-bench.mjs). */

export const DEFAULT_LABELER = 'gemini';

/* The ordered provider names. An unknown name is kept (and later matches no
   strategy) rather than silently swapped for another provider: a typo should
   stop the lane, not move family data to a service nobody chose. */
export function labelerChain(cfg) {
  const raw = String((cfg && cfg.labeler) || DEFAULT_LABELER).toLowerCase();
  const names = raw.split(',').map((x) => x.trim()).filter(Boolean);
  return names.length ? Array.from(new Set(names)) : [DEFAULT_LABELER];
}

export function labelerName(cfg) {
  return labelerChain(cfg)[0];
}

/* The strategies to try, in order. If the FIRST name is unknown nothing runs. */
export function strategiesFor(impls, cfg) {
  const chain = labelerChain(cfg);
  if (!impls[chain[0]]) return [];
  return chain.filter((n) => impls[n]).map((name) => ({ name, impl: impls[name] }));
}

/* True when SOME strategy can be asked. What the callers check before they
   spend a budget unit, where they used to check cfg.apiKey. */
export function labelerReady(impls, cfg, _task) {
  return strategiesFor(impls, cfg).some((s) => s.impl.ready(cfg));
}

/* Runs the task: first ready strategy that answers wins; null when none could. */
export async function runLabeler(impls, _task, cfg, fetchImpl, ...args) {
  for (const s of strategiesFor(impls, cfg)) {
    if (!s.impl.ready(cfg)) continue;
    let out = null;
    try { out = await s.impl.run(cfg, fetchImpl, ...args); } catch { out = null; }
    if (out !== null && out !== undefined) return out;
  }
  return null;
}

/* The env → cfg half, shared by mailbox-sync, mailbox-dryrun and
   merchant-concepts. `get` is the caller's env reader. Spread into the llm cfg. */
export function labelerCfgFromEnv(get) {
  const g = (k) => { try { const v = get(k); return v == null || v === '' ? undefined : String(v); } catch { return undefined; } };
  return { labeler: g('LABELER'), jev: { apiKey: g('JEV_API_KEY') } };
}

/* WHICH ONE IS ON, for logs and run replies. Names and booleans only, never a
   key. `active` is the provider that will be asked first right now (the first
   name in LABELER that has its key), null when none can be asked, e.g. a typo
   in the first name or a missing JEV_API_KEY with no fallback. */
const HAS_KEY = {
  gemini: (cfg) => !!(cfg && cfg.apiKey),
  jev: (cfg) => !!(cfg && cfg.jev && cfg.jev.apiKey),
};
export function labelerStatus(cfg) {
  const chain = labelerChain(cfg);
  const known = !!HAS_KEY[chain[0]];
  const keys = {};
  for (const n of chain) keys[n] = HAS_KEY[n] ? HAS_KEY[n](cfg) : 'unknown_provider';
  const active = known ? (chain.find((n) => HAS_KEY[n] && HAS_KEY[n](cfg)) || null) : null;
  return { chain: chain.join(','), active, keys };
}
