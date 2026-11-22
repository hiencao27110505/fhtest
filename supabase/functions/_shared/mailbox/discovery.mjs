/**
 * Receipt discovery — who else sends this mailbox receipts?
 * (receipt-providers-spec.md §5, §10, RP4)
 *
 * A HEADER PASS, run last in a mailbox's run and only for a grant on the
 * registry consent (RECEIPT_REGISTRY_V). It lists mail in the window whose
 * SUBJECT reads like a receipt and whose sender the worker does not know
 * (not a bank, wallet or registered receipt sender, not a personal mailbox,
 * not a candidate already recorded), fetches METADATA ONLY for at most
 * DISCOVERY_MAX of them, and remembers per (sender, subject template): a
 * count, a last-seen date, and the model's one-word verdict with the store
 * name as the mail signs it. The verdict is asked once per shape, from
 * whatever classify budget the run has left (last in line, never ahead of a
 * real read), and cached forever: a campaign shape is never asked again.
 *
 * What it does NOT do, structurally:
 *   - it never calls gmail.getMessage: there is no body anywhere in here;
 *   - it never stages, never joins, never writes a provider row — promotion
 *     is a person's tap (receipt_sender_add) or an operator's row;
 *   - it stores nothing about a person: receipt_candidates has no user_id,
 *     and the mailboxes column is a COUNT.
 *
 * Why generic terms and not a store list: the point is the store nobody has
 * listed yet. The 2026-10-06 survey found Google Play, FastSpring (Capture
 * One), Google Payments (Cloud), Stripe-sent receipts (Anthropic), a bus
 * line and a cycling shop this way — none registered, all receipt-shaped.
 */

import * as senders from './senders.mjs';
import * as gmail from './gmail.mjs';
import { normalizeSubjectTemplate } from './extract.mjs';
import { callGemini, toGeminiSchema } from './llm.mjs';

/** Subject words a receipt tends to carry. Quoted phrases match as phrases.
 *  "subscription" earns its place (renewal receipts) and costs a few notices
 *  ("Your Subscription is Expiring") that the verdict cache absorbs once. */
export const DISCOVERY_TERMS = Object.freeze([
  '"hoá đơn"', '"hóa đơn"', '"đơn hàng"', '"biên lai"', '"thanh toán thành công"', '"xác nhận thanh toán"',
  'receipt', 'invoice', '"order confirmation"', '"payment received"', '"your payment"', 'subscription',
]);
/** Metadata fetches per run. Ten is enough to learn a mailbox in a week and
 *  small enough that a 157-domain exclusion never matters to quota. */
export const DISCOVERY_MAX = 10;
/** Ids listed per run; the rest of the window waits for the next run. */
export const DISCOVERY_LIST = 40;

/** The Gmail query: receipt-shaped subjects from senders we do not read.
 *  Every known bank/wallet/receipt sender is negated so the list is only
 *  unknowns; `exclude` adds this grant's candidates already recorded. */
export function discoveryQuery(days, domains, exclude) {
  const known = new Set();
  for (const d of senders.KNOWN_SENDER_DOMAINS || []) known.add(d);
  for (const d of senders.RECEIPT_DOMAINS || []) known.add(d);
  for (const r of domains || []) { const d = String(r.domain_or_address || '').toLowerCase(); if (d) known.add(d); }
  for (const a of exclude || []) { const d = String(a || '').toLowerCase(); if (d && d.indexOf(' ') < 0 && d.indexOf('"') < 0) known.add(d); }
  const neg = [...known].slice(0, 400).map((d) => ' -from:' + d).join('');
  return 'subject:(' + DISCOVERY_TERMS.join(' OR ') + ')' + neg
    + senders.PROMO_TOKENS.map((t) => ' -from:' + t).join('')
    + ' -in:chats -in:spam -in:trash newer_than:' + Math.max(1, Math.floor(days)) + 'd';
}

const VERDICT_SYSTEM =
  'You classify EMAIL SENDERS for a Vietnamese family\'s spending app, from the sender and ONE subject line only. ' +
  'Answer JSON {"items":[{"i":<n>,"verdict":"receipt"|"bill"|"campaign"|"other","store":<short store or service name as the mail signs it, or null>}]}. ' +
  'receipt = the mail confirms a completed purchase, order, payment or subscription charge from a store or service ' +
  '(an order receipt, an e-receipt, a renewal charge, "payment received"). ' +
  'bill = an invoice or e-invoice for a utility, telecom, rent or tax that is to be paid or was issued. ' +
  'campaign = marketing, a sale, a price-change notice, a reminder to buy, a newsletter. other = anything else ' +
  '(account security, terms of service, job alerts, shipping status with no total, social). ' +
  'The store name is the merchant or service, not the mail platform (for a Stripe- or FastSpring-sent receipt, name the merchant).';

const VERDICT_SCHEMA = {
  type: 'object',
  properties: { items: { type: 'array', items: { type: 'object', properties: {
    i: { type: 'integer' },
    verdict: { type: 'string', enum: ['receipt', 'bill', 'campaign', 'other'] },
    store: { type: ['string', 'null'] },
  }, required: ['i', 'verdict'] } } },
  required: ['items'],
};

async function askVerdicts(shapes, cfg, fetchImpl) {
  if (!cfg || !cfg.apiKey || !shapes.length) return null;
  const list = shapes.map((s, i) => (i + 1) + '. from: ' + s.display + ' <' + s.sender + '>  subject: ' + s.sample).join('\n');
  const r = await callGemini('discovery_verdict', {
    systemInstruction: { parts: [{ text: VERDICT_SYSTEM }] },
    contents: [{ role: 'user', parts: [{ text: list }] }],
    generationConfig: { responseMimeType: 'application/json', responseSchema: toGeminiSchema(VERDICT_SCHEMA) },
  }, cfg, fetchImpl);
  if (!r || r.transportError || !r.ok) return null;
  const text = r.data && r.data.candidates && r.data.candidates[0] && r.data.candidates[0].content
    && r.data.candidates[0].content.parts && r.data.candidates[0].content.parts[0] && r.data.candidates[0].content.parts[0].text;
  if (!text) return null;
  let parsed;
  try { parsed = JSON.parse(text); } catch { return null; }
  const out = new Map();
  for (const it of (parsed && parsed.items) || []) {
    const idx = Number(it && it.i) - 1;
    if (idx < 0 || idx >= shapes.length) continue;
    const v = ['receipt', 'bill', 'campaign', 'other'].indexOf(it.verdict) >= 0 ? it.verdict : 'other';
    const store = (typeof it.store === 'string' && it.store.trim()) ? it.store.trim().slice(0, 60) : null;
    out.set(shapes[idx].sender + '\u0001' + shapes[idx].template, { verdict: v, store });
  }
  return out;
}

/** The display name part of a From header, without quotes or the address. */
function displayOf(from) {
  return String(from || '').replace(/<[^>]*>/, '').replace(/"/g, '').trim().slice(0, 60);
}

/**
 * One discovery pass for one grant. Never throws; returns counts for the
 * run summary. `ctx` is the worker's: { db, fetch, llm, classifyBudget }.
 * `access` is the Gmail access token the run already holds.
 */
export async function runDiscovery(grant, ctx, { access, days, domains }) {
  const out = { listed: 0, meta: 0, asked: 0, receipt: 0, bill: 0, campaign: 0, other: 0, quota: 0, skipped: 0 };
  const db = ctx.db;
  if (!db || !db.candidateSenders) return out;
  let exclude = [];
  try { exclude = await db.candidateSenders(); } catch { exclude = []; }
  let ids = [];
  try {
    ids = await gmail.listMessageIds(discoveryQuery(days, domains, exclude), DISCOVERY_LIST, access, ctx.fetch);
  } catch { return out; }
  out.listed = ids.length;
  await db.bumpReadTally?.('discovery_listed');
  const excludeSet = new Set(exclude.map((a) => String(a || '').toLowerCase()));
  const shapes = new Map();     // sender\u0001template → { sender, template, display, sample, n, last }
  for (const id of ids) {
    if (out.meta >= DISCOVERY_MAX) break;
    let m = null;
    try { m = await gmail.getMessageMetadata(id, access, ctx.fetch); }
    catch (e) { if (/403|429|quota|rate/i.test(String(e && e.message || e))) { out.quota++; break; } continue; }
    if (!m) continue;
    out.meta++;
    const address = senders.addressOf(m.from);
    if (!address || senders.match(m.from, domains) || senders.isFreeMail(address) || excludeSet.has(address)
        || senders.isPersonShaped(address)) { out.skipped++; continue; }
    const template = normalizeSubjectTemplate(m.subject || '') || '*';
    const k = address + '\u0001' + template;
    const s = shapes.get(k) || { sender: address, template, display: displayOf(m.from), sample: String(m.subject || '').slice(0, 160), n: 0, last: null };
    s.n++;
    const when = m.internalDate ? new Date(m.internalDate).toISOString() : null;
    if (when && (!s.last || when > s.last)) s.last = when;
    shapes.set(k, s);
  }
  if (out.meta) await db.bumpReadTally?.('discovery_meta');
  if (!shapes.size) return out;

  // What is already known about these shapes (another mailbox may have seen them).
  let known = new Map();
  try { known = await db.candidatesGet([...shapes.values()].map((s) => ({ sender: s.sender, template: s.template }))); } catch { known = new Map(); }
  const unseen = [];
  for (const s of shapes.values()) {
    const row = known.get(s.sender + '\u0001' + s.template);
    try {
      if (row) await db.candidateBump(row.id, s.n, s.last);
      else await db.candidateInsert({ sender: s.sender, subject_template: s.template, seen: s.n, last_seen_at: s.last || undefined });
    } catch { /* a candidate is a hint; never fails a run */ }
    if (!row || row.verdict == null) unseen.push(s);
  }
  if (!unseen.length) return out;

  // One batched verdict, from the budget's leftovers. No budget, no ask: the
  // shapes wait, counted, for a quieter run.
  const budget = ctx.classifyBudget;
  if (!budget || !(Number(budget.left) > 0)) return out;
  budget.left = Number(budget.left) - 1;
  const verdicts = await askVerdicts(unseen, ctx.llm, ctx.fetch);
  out.asked = unseen.length;
  await db.bumpReadTally?.('discovery_asked');
  if (!verdicts) return out;
  for (const s of unseen) {
    const v = verdicts.get(s.sender + '\u0001' + s.template);
    if (!v) continue;
    out[v.verdict] = (out[v.verdict] || 0) + 1;
    try { await db.candidateVerdict(s.sender, s.template, v.verdict, v.store); } catch { /* same */ }
    await db.bumpReadTally?.('discovery_' + v.verdict);
  }
  return out;
}
