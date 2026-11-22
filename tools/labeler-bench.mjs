#!/usr/bin/env node
/* Gemini vs Jev on merchant labeling, OFFLINE, on public names only.
 *
 *   GEMINI_API_KEY=… JEV_API_KEY=… node tools/labeler-bench.mjs [--n 80] [--min-prob 0.5] [--only gemini|jev]
 *
 * Ground truth is the category tree's own curated keywords (taxonomy.mjs): each
 * brand/phrase keyword of an expense node becomes a "merchant name" labeled with
 * that node. These are public chain names and generic words, never family mail,
 * so this can run before consent names a new provider (labelers/index.mjs).
 *
 * The keyword tier would answer these for free in production; the bench asks the
 * MODEL anyway, because the question is how good each model is on the names the
 * keywords miss, and the closest public proxy is how it does on the ones they hit.
 *
 * Reports per provider: exact node, right group (answer is the truth or one of
 * its ancestors / descendants), wrong, null, latency, tokens. Spends real quota.
 *
 * For Jev it also SWEEPS JEV_MIN_PROB from one round of calls (the raw
 * probabilities are captured and re-resolved offline) and suggests the
 * threshold that answers most while staying no more wrong than Gemini (or 5%
 * when Gemini was not run). Put the suggestion in JEV_DEFAULT_MIN_PROB
 * (labelers/jev.mjs) and commit it with the bench output in the message.
 */
import { TAX } from '../supabase/functions/_shared/mailbox/taxonomy.mjs';
import { classifyMerchantsBatch, BATCH_MODEL_MAX } from '../supabase/functions/_shared/mailbox/classify.mjs';
import { resolveNode } from '../supabase/functions/_shared/mailbox/labelers/jev.mjs';

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const N = Number(arg('n', 80));
const ONLY = arg('only', null);
const MIN_PROB = Number(arg('min-prob', 0.5));

/* Deterministic sample: every expense node's keywords, round-robin, so each node
   is represented before any node gets a second name. */
const pools = TAX.nodes.filter((n) => n.kind === 'expense' && !n.manual && n.kw && n.kw.length)
  .map((n) => n.kw.filter((k) => k.length >= 4).map((k) => ({ name: k.toUpperCase(), truth: n.code })));
const sample = [];
for (let round = 0; sample.length < N && pools.some((p) => p[round]); round++) {
  for (const p of pools) { if (p[round] && sample.length < N) sample.push(p[round]); }
}

const lineage = (code) => { const out = new Set(); for (let c = code; c; c = TAX.get(c) && TAX.get(c).parent) out.add(c); return out; };
const related = (a, b) => lineage(a).has(b) || lineage(b).has(a);

async function bench(name, cfg) {
  const usage = [];
  cfg.logLlm = (r) => usage.push(r);
  const answers = [];
  const t0 = Date.now();
  for (let i = 0; i < sample.length; i += BATCH_MODEL_MAX) {
    const chunk = sample.slice(i, i + BATCH_MODEL_MAX);
    const out = await classifyMerchantsBatch(chunk.map((s) => s.name), cfg, fetch);
    if (!out) { console.log('  ' + name + ': batch at ' + i + ' could not be asked (see usage below)'); answers.push(...chunk.map(() => undefined)); continue; }
    answers.push(...out);
  }
  const ms = Date.now() - t0;
  const { tally, wrong } = score(answers.map((a) => (a === undefined ? undefined : a.node)));
  const lat = usage.map((u) => u.latency_ms).sort((x, y) => x - y);
  const pct = (p) => lat.length ? lat[Math.min(lat.length - 1, Math.floor(p * lat.length))] : null;
  const tok = usage.reduce((s, u) => s + (u.prompt_tokens || 0), 0);
  const pc = (k) => (100 * tally[k] / sample.length).toFixed(1) + '%';
  console.log('\n== ' + name + ' (' + sample.length + ' names, ' + usage.length + ' calls, ' + ms + ' ms) ==');
  console.log('  exact ' + pc('exact') + '  related ' + pc('group') + '  wrong ' + pc('wrong') + '  null ' + pc('null') + (tally.notAsked ? '  not asked ' + pc('notAsked') : ''));
  console.log('  latency p50 ' + pct(0.5) + ' ms, p95 ' + pct(0.95) + ' ms; input tokens ' + tok + '; outcomes ' + JSON.stringify(usage.map((u) => u.outcome)));
  if (wrong.length) console.log('  wrong (first 10):\n    ' + wrong.slice(0, 10).join('\n    '));
  return tally;
}

/* nodes[i]: a code, null (cannot tell) or undefined (not asked). */
function score(nodes) {
  const tally = { exact: 0, group: 0, wrong: 0, null: 0, notAsked: 0 };
  const wrong = [];
  sample.forEach((s, i) => {
    const n = nodes[i];
    if (n === undefined) tally.notAsked++;
    else if (!n) tally.null++;
    else if (n === s.truth) tally.exact++;
    else if (related(n, s.truth)) tally.group++;
    else { tally.wrong++; wrong.push(s.name + ' → ' + n + ' (truth ' + s.truth + ')'); }
  });
  return { tally, wrong };
}

/* Re-resolves the captured Jev probabilities at each threshold. */
function sweep(capture, geminiTally) {
  if (capture.length !== sample.length) { console.log('  sweep skipped: ' + capture.length + '/' + sample.length + ' answers captured'); return; }
  const maxWrong = geminiTally ? geminiTally.wrong / sample.length : 0.05;
  console.log('\n  JEV_MIN_PROB sweep (wrong allowed ≤ ' + (100 * maxWrong).toFixed(1) + '%' + (geminiTally ? ', Gemini\'s rate' : '') + '):');
  console.log('    prob   exact  related  wrong   null');
  let best = null;
  for (let p = 0.3; p <= 0.901; p += 0.05) {
    const { tally } = score(capture.map((c) => resolveNode(c.node, p)));
    const pc = (k) => (100 * tally[k] / sample.length).toFixed(1).padStart(5) + '%';
    console.log('    ' + p.toFixed(2) + '  ' + pc('exact') + '  ' + pc('group') + '  ' + pc('wrong') + '  ' + pc('null'));
    const answered = tally.exact + tally.group;
    if (tally.wrong / sample.length <= maxWrong && (!best || answered > best.answered)) best = { p, answered };
  }
  if (best && best.answered === 0) best = null;   // "always cannot tell" is not a threshold
  console.log(best ? '  suggested JEV_DEFAULT_MIN_PROB=' + best.p.toFixed(2) : '  no threshold stays within the wrong-rate bar: Jev is not ready for this lane');
}

if (!sample.length) { console.error('no sample'); process.exit(1); }
let geminiTally = null;
if (ONLY !== 'jev') {
  if (process.env.GEMINI_API_KEY) geminiTally = await bench('gemini', { labeler: 'gemini', apiKey: process.env.GEMINI_API_KEY, model: process.env.GEMINI_MODEL || undefined });
  else console.log('skip gemini: GEMINI_API_KEY not set');
}
if (ONLY !== 'gemini') {
  if (process.env.JEV_API_KEY) {
    const capture = [];
    await bench('jev @' + MIN_PROB, { labeler: 'jev', jev: { apiKey: process.env.JEV_API_KEY, minProb: MIN_PROB, capture } });
    sweep(capture, geminiTally);
  } else console.log('skip jev: JEV_API_KEY not set');
}
