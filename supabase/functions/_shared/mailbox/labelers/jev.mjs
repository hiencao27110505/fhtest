/* The Jev (TypeSafe System One) strategies for the labeling lane.
 * See labelers/index.mjs for the contract and why extraction is not here.
 *
 * Jev answers typed questions about a `state`: a Choice picks one of up to 255
 * named criteria and returns a probability for every one; a Noul returns the
 * probability of "yes". No prompt-as-JSON, no schema to keep inside Gemini's
 * OpenAPI subset (the 155-value enum that 400'd every call is simply a criteria
 * map here, and the answer can only ever be one of its keys).
 *
 * FROM PROBABILITIES TO A NODE. The Gemini prompt asks for "a leaf when sure,
 * its group when you know the area, null for the unknowable". Here that is
 * arithmetic, not an instruction: every node's MASS is its own probability plus
 * all of its descendants', and the answer is the DEEPEST node whose mass reaches
 * minProb. A café the model splits between coffee and milktea answers `drinks`;
 * a gateway code whose mass lands on `unknown` (or spreads thin) answers null.
 *
 * WHAT IS SENT is exactly what the Gemini strategy sends, no more: merchant
 * names (the caller already stripped memo and digit runs), item signatures,
 * statement-mail sender/subject/filenames/first 4000 chars, sender+subject. The
 * usage row (cfg.logLlm) carries no content, as in callGemini.
 *
 * Pinned model: answers "can change between Jev releases" (their docs), and the
 * cache keeps every answer forever, so the default is a version, never
 * jev-latest. */

import { TAX } from '../taxonomy.mjs';

export const JEV_URL = 'https://api.typesafe.ai/v1/systemone';
export const JEV_DEFAULT_MODEL = 'jev-1.14.0';
export const JEV_DEFAULT_MIN_PROB = 0.5;
/* A wrong "not a statement" makes a statement vanish with nothing to notice; a
   wrong "is a statement" costs one parse that finds no rows. So yes is cheap. */
export const JEV_STATEMENT_YES = 0.3;
/* Names per request. One node question carries the whole ~160-node menu
   (~2.5k tokens); Jev's default request ceiling is 64k tokens. */
export const JEV_CHUNK = 8;
export const JEV_CRITERIA = () => ({ concept: CONCEPT_CRITERIA, pool: POOL_CRITERIA });

const UNKNOWN = 'unknown';
const MENU_CODES = TAX.nodes.filter((n) => n.kind === 'expense' && !n.manual).map((n) => n.code);
const MENU_SET = new Set(MENU_CODES);

function describe(code) {
  const n = TAX.get(code);
  if (!n) return code;
  const p = n.parent ? TAX.get(n.parent) : null;
  return (n.en || code) + ' (' + (n.vi || '') + ')' + (p ? ', a kind of ' + (p.en || p.code) : '');
}

let _nodeCriteria = null;
function nodeCriteria() {
  if (_nodeCriteria) return _nodeCriteria;
  const c = {};
  for (const code of MENU_CODES) c[code] = describe(code);
  c[UNKNOWN] = 'Cannot tell what kind of business or purchase this is: an opaque gateway or bank code, initials, a bare reference number.';
  _nodeCriteria = c;
  return c;
}

const CONCEPT_CRITERIA = {
  Housing: 'rent, utilities, internet, building fees',
  Groceries: 'supermarkets, convenience stores, markets',
  Clothing: 'clothes, shoes, fashion',
  Shopping: 'marketplaces, electronics, general retail',
  Transport: 'ride-hailing, taxi, fuel, parking, tolls',
  Dining: 'restaurants, cafés, food delivery, drinks',
  Fun: 'cinema, streaming, games, travel, sport',
  Others: 'pharmacy, hospital, insurance, school fees, delivery services',
  [UNKNOWN]: 'Cannot tell.',
};

/* The notification's four finer voices (classify.mjs CLASSIFY_POOLS). Asked so a
   merchant whose NODE stays null can still get the coffee/ride voice, the same as
   Gemini's legacy answer. With a node, the caller derives pool from it instead. */
const NONE = 'none';
const POOL_CRITERIA = {
  coffee: 'A coffee shop (quán cà phê).',
  milktea: 'A bubble tea or milk tea shop (trà sữa).',
  ride: 'Ride-hailing or taxi.',
  cinema: 'A movie theatre.',
  [NONE]: 'None of those four specific kinds. Most merchants are this.',
};

function minProbOf(cfg) {
  const m = cfg && cfg.jev && Number(cfg.jev.minProb);
  return m > 0 && m < 1 ? m : JEV_DEFAULT_MIN_PROB;
}

/* The deepest menu node whose subtree mass reaches minProb; null when none. */
export function resolveNode(probabilities, minProb) {
  if (!probabilities || typeof probabilities !== 'object') return null;
  const mass = new Map();
  for (const [code, p] of Object.entries(probabilities)) {
    const v = Number(p);
    if (!MENU_SET.has(code) || !(v > 0)) continue;
    for (let c = code, guard = 0; c && guard < 16; guard++) {
      if (MENU_SET.has(c)) mass.set(c, (mass.get(c) || 0) + v);
      const n = TAX.get(c);
      c = n ? n.parent : null;
    }
  }
  let best = null, bestDepth = -1, bestMass = -1;
  for (const [code, m] of mass) {
    if (m < minProb) continue;
    const d = (TAX.get(code) && TAX.get(code).depth) || 0;
    if (d > bestDepth || (d === bestDepth && m > bestMass)) { best = code; bestDepth = d; bestMass = m; }
  }
  return best;
}

/* A Choice answer kept only when it is a real option of `criteria` (never the
   unknown/none escape) and its own probability reaches minProb. */
export function resolveChoice(answer, minProb, criteria) {
  if (!answer || typeof answer.choice !== 'string' || answer.choice === UNKNOWN || answer.choice === NONE) return null;
  if (criteria && !Object.prototype.hasOwnProperty.call(criteria, answer.choice)) return null;
  const p = answer.probabilities && Number(answer.probabilities[answer.choice]);
  return (p >= minProb) ? answer.choice : null;
}

/* The one HTTP call. Same raw-pieces contract and usage row as callGemini. */
export async function callJev(feature, body, cfg, fetchImpl) {
  const doFetch = fetchImpl || globalThis.fetch;
  const jc = (cfg && cfg.jev) || {};
  const model = jc.model || JEV_DEFAULT_MODEL;
  const startedMs = Date.now();
  let status = null, ok = false, data = null, transportError = false;
  try {
    const res = await doFetch(JEV_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + (jc.apiKey || '') },
      body: JSON.stringify({ model, ...body }),
    });
    status = res.status;
    ok = res.ok;
    const text = await res.text();
    try { data = JSON.parse(text); } catch { data = null; }
  } catch {
    transportError = true;
  }
  if (cfg && typeof cfg.logLlm === 'function') {
    const u = (data && data.usage) || null;
    const inTok = u ? (u.input_tokens ?? null) : null;
    const outTok = u ? (u.output_tokens ?? null) : null;
    try {
      await cfg.logLlm({
        feature,
        model,
        outcome: transportError ? 'error' : ((status === 429 || status === 529) ? 'rate_limited' : (ok ? 'ok' : 'error')),
        status_code: status,
        prompt_tokens: inTok,
        output_tokens: outTok,
        total_tokens: inTok != null || outTok != null ? (inTok || 0) + (outTok || 0) : null,
        latency_ms: Date.now() - startedMs,
      });
    } catch { /* monitoring never fails a capture */ }
  }
  const answers = ok && data && data.answers && typeof data.answers === 'object' ? data.answers : null;
  return { status, ok: !!answers, answers, transportError };
}

const ready = (cfg) => !!(cfg && cfg.jev && cfg.jev.apiKey);

/* Asks node (+ optionally concept and pool) for a list of strings, JEV_CHUNK per
   request. Any chunk that cannot be asked makes the whole call null: callers
   treat the batch as "not tried" and cache nothing, the same as a Gemini 429.
   cfg.jev.capture (an array, tools/labeler-bench.mjs only) receives the raw
   answers so a threshold sweep needs no second round of calls. */
async function askNodes(feature, lines, cfg, fetchImpl, opts) {
  const minProb = minProbOf(cfg);
  const out = [];
  for (let start = 0; start < lines.length; start += JEV_CHUNK) {
    const chunk = lines.slice(start, start + JEV_CHUNK);
    const questions = {};
    chunk.forEach((line, j) => {
      questions['node_' + j] = { type: 'choice', instructions: opts.nodeInstructions(line), criteria: nodeCriteria() };
      if (opts.concept) {
        questions['concept_' + j] = { type: 'choice', instructions: 'Which spending area fits "' + line + '"?', criteria: CONCEPT_CRITERIA };
        questions['pool_' + j] = { type: 'choice', instructions: 'Is "' + line + '" clearly one of these specific kinds? Answer none unless you recognise the brand or the words.', criteria: POOL_CRITERIA };
      }
    });
    const r = await callJev(feature, { state: { [opts.stateKey]: chunk }, questions }, cfg, fetchImpl);
    if (!r.ok) return null;
    chunk.forEach((_, j) => {
      const node = resolveNode(r.answers['node_' + j] && r.answers['node_' + j].probabilities, minProb);
      const concept = opts.concept ? resolveChoice(r.answers['concept_' + j], minProb, CONCEPT_CRITERIA) : null;
      const pool = opts.concept ? resolveChoice(r.answers['pool_' + j], minProb, POOL_CRITERIA) : null;
      if (cfg.jev && Array.isArray(cfg.jev.capture)) {
        cfg.jev.capture.push({ line: chunk[j], node: r.answers['node_' + j] && r.answers['node_' + j].probabilities,
          concept: r.answers['concept_' + j], pool: r.answers['pool_' + j] });
      }
      out.push({ node, concept, pool });
    });
  }
  return out;
}

const merchantInstr = (name) => 'Which spending category is the Vietnamese bank-transaction merchant "' + name + '"? ' +
  'Most specific when the name clearly says what it is; its group when only the area is clear; unknown for the unknowable. Do not guess wildly.';

/* {node, concept, pool}. A valid node wins and the caller derives concept and pool
   from it (derivedFromNode); concept and pool only stand on their own when the
   node is null, exactly as with Gemini's answer. */
export const classifyMerchants = {
  ready,
  run: (cfg, fetchImpl, texts) => askNodes('classify_merchant_batch', texts.map((x) => String(x).slice(0, 80).replace(/\s+/g, ' ')), cfg, fetchImpl,
    { stateKey: 'merchants', concept: true, nodeInstructions: merchantInstr }),
};

export const classifyMerchant = {
  ready,
  run: async (cfg, fetchImpl, text) => {
    const r = await askNodes('classify_merchant', [String(text).slice(0, 200)], cfg, fetchImpl,
      { stateKey: 'merchants', concept: true, nodeInstructions: merchantInstr });
    return r ? r[0] : null;
  },
};

/* entries: [{key}], same line text the Gemini prompt numbers. Returns
   Map key → node|null (null = unknowable), or null when not asked. */
export const classifyItems = {
  ready,
  run: async (cfg, fetchImpl, entries, lines) => {
    const r = await askNodes('classify_item_batch', lines, cfg, fetchImpl, {
      stateKey: 'purchases', concept: false,
      nodeInstructions: (line) => 'Which expense category is this purchase signature: "' + line + '"? ' +
        'A physical product is a thing someone bought, never a place, venue, class, membership or service. ' +
        'A rental or subscription is filed by what it gives access to (video or music: streaming; a course app: courses; cloud storage: digital subscription; a game: games).',
    });
    if (!r) return null;
    return new Map(entries.map((e, i) => [e.key, r[i] ? r[i].node : null]));
  },
};

/* One Noul. true/false, or null when not asked. */
export const statementVerdict = {
  ready,
  run: async (cfg, fetchImpl, stateText) => {
    const r = await callJev('statement_verdict', {
      state: stateText,
      questions: { is_statement: {
        type: 'noul',
        instructions: 'This email from a Vietnamese bank or e-wallet has a spreadsheet attached. Is the attachment an account statement or transaction history for the recipient (sao kê, lịch sử giao dịch, bảng kê giao dịch)?',
        criteria: {
          true: 'The email says it is a statement or a list of the recipient\'s own transactions.',
          false: 'Anything else with a spreadsheet: an invoice or e-invoice, a price list, a promotion, a contract, a form.',
        },
      } },
    }, cfg, fetchImpl);
    if (!r.ok) return null;
    const p = r.answers.is_statement && Number(r.answers.is_statement.noul);
    if (!(p >= 0 && p <= 1)) return null;
    return p >= JEV_STATEMENT_YES;
  },
};

const VERDICT_CRITERIA = {
  receipt: 'Confirms a completed purchase, order, payment or subscription charge from a store or service (order receipt, e-receipt, renewal charge, "payment received").',
  bill: 'An invoice or e-invoice for a utility, telecom, rent or tax that is to be paid or was issued.',
  campaign: 'Marketing, a sale, a price-change notice, a reminder to buy, a newsletter.',
  other: 'Anything else: account security, terms of service, job alerts, shipping status with no total, social.',
};

/* lines: one "from: … subject: …" per shape. Returns an aligned array of
   {verdict, store}. Jev cannot name the store (no text output), so store is
   null: the candidate row is saved without a store name, as Gemini's own null. */
export const discoveryVerdicts = {
  ready,
  run: async (cfg, fetchImpl, lines) => {
    const out = [];
    for (let start = 0; start < lines.length; start += 40) {
      const chunk = lines.slice(start, start + 40);
      const questions = {};
      chunk.forEach((line, j) => { questions['v_' + j] = { type: 'choice', instructions: 'What kind of email sender is this, from its sender and one subject line: ' + line, criteria: VERDICT_CRITERIA }; });
      const r = await callJev('discovery_verdict', { state: { senders: chunk }, questions }, cfg, fetchImpl);
      if (!r.ok) return null;
      chunk.forEach((_, j) => {
        const a = r.answers['v_' + j];
        out.push({ verdict: a && VERDICT_CRITERIA[a.choice] ? a.choice : 'other', store: null });
      });
    }
    return out;
  },
};
