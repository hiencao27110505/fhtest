#!/usr/bin/env node
// The email-reading-v2 scoreboard (docs/specs/email-reading-v2-spec.md §13).
//
// Replays the owner's own mail corpus through the REAL reader, locally, with
// the model OFF, and prints how much of it the free tiers read and how richly.
// It answers one question before every landing: of N real mails, how many would
// still have to be sent to the model?
//
// WHAT IT TOUCHES: nothing. No network (the model config is null, so llm.extract
// throws LlmUnavailable before any request, and the fetch handed to the reader
// throws as well), no database (an in-memory stub that remembers fingerprints
// and formats for the length of the run, so "learned on mail N, served on mail
// N+1" is measured the way production behaves), no files written.
//
// WHAT IT PRINTS: AGGREGATES ONLY. The corpus is real mail. Every string that
// reaches the terminal goes through `safeKey`, which passes a value only when it
// belongs to a closed list this repo already publishes (contract.mjs field and
// signal names, taxonomy kinds, the sender registry's domains, tier names).
// Anything else prints as "(other)". No amount, name, account, memo or subject
// can reach the output, by construction rather than by care.
//
// Usage:
//   node tools/scoreboard/run.mjs
//   node tools/scoreboard/run.mjs --corpus /some/other/dir
//   node tools/scoreboard/run.mjs --json        # the same aggregates as JSON
//   node tools/scoreboard/run.mjs --reader /tmp/old/supabase/functions/_shared/mailbox

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MAIN = process.env.FH_MAIN_CHECKOUT || '/Users/hiencao/Documents/ClaudeHC/familyhub';

const args = process.argv.slice(2);
const flag = (name, dflt) => {
  const i = args.indexOf('--' + name);
  return i >= 0 && args[i + 1] != null ? args[i + 1] : dflt;
};
// The reader under test. Defaults to this checkout's; `--reader <dir>` points at
// another copy of _shared/mailbox (an older commit unpacked somewhere), which is
// how a before/after pair is produced by ONE tool.
const MB = path.resolve(flag('reader', path.join(HERE, '..', '..', 'supabase', 'functions', '_shared', 'mailbox')));
const CORPUS = flag('corpus', path.join(MAIN, 'research', 'statements', 'mail-corpus'));
const AS_JSON = args.includes('--json');

if (!fs.existsSync(CORPUS) || !fs.readdirSync(CORPUS).some((f) => f.endsWith('.json.gz'))) {
  console.error('\nNo mail corpus at ' + CORPUS + '.\n' +
    'Build it first (it reads YOUR mailbox, read-only, to a git-ignored folder):\n' +
    '  node tools/gmail-oauth-probe.js connect\n' +
    '  node tools/pull-mail-corpus.mjs\n');
  process.exit(2);
}

const imp = (f) => import(path.join(MB, f));
const gmail = await imp('gmail.mjs');
const mailtext = await imp('mailtext.mjs');
const senders = await imp('senders.mjs');
const extract = await imp('extract.mjs');
const llm = await imp('llm.mjs');
const classify = await imp('classify.mjs');
const taxonomy = await imp('taxonomy.mjs');
// Present only once the v2 work has landed; the scoreboard runs on either side
// of it so the SAME tool produces the before and the after.
const contract = await imp('contract.mjs').catch(() => null);
const stage = await imp('stage.mjs').catch(() => null);
const worker = await imp('worker.mjs').catch(() => null);

/* ── the closed lists a printed key must belong to ───────────────────────── */
const REGISTRY_DOMAINS = [
  ...Object.values(senders.KNOWN_DOMAINS).flatMap((group) => Object.keys(group)),
];
const FIELD_KEYS = contract ? contract.RAW_KEYS
  : ['fx_amount', 'fx_currency', 'status', 'occurred_at', 'account_masked', 'account_kind', 'balance',
     'card_masked', 'memo', 'memo_display', 'type_code', 'channel', 'node', 'category_hint', 'flow',
     'reader_type', 'sender_kind', 'txn_source'];
const SIGNAL_KEYS = contract ? [...Object.keys(contract.SIGNALS), ...contract.NOTICE_SIGNALS] : [];
const TIERS = ['seed', 'format', 'template', 'structural', 'line', 'table', 'llm', 'model'];
const OUTCOMES = ['read_locally', 'needs_model', 'not_a_transaction', 'person_sender', 'unreadable', 'multi', 'error'];
const SAFE = new Set([...FIELD_KEYS, ...SIGNAL_KEYS, ...TIERS, ...OUTCOMES,
  'debit', 'credit', 'bank', 'wallet', 'gateway', 'broker', 'lender', 'biller', 'receipt',
  '(none)', '(other)', '(unregistered)', 'ALL',
  ...taxonomy.TAX.kinds.map((k) => k.id), 'depth 1', 'depth 2', 'depth 3', 'depth 4', 'depth 5',
  'agree', 'disagree', 'detector_only', 'model_only', 'printed', 'template', 'heuristic']);

/** The registry domain a From address falls under, plus its own subdomain when
 *  that subdomain is only registry-domain labels ("card." + "vib.com.vn"). A
 *  domain the registry does not know never prints. */
function safeDomain(from) {
  const d = senders.domainOf(senders.addressOf(from));
  for (const parent of REGISTRY_DOMAINS) {
    if (d === parent) return d;
    if (d.endsWith('.' + parent) && /^[a-z0-9-]{1,20}(\.[a-z0-9-]{1,20})?$/.test(d.slice(0, -parent.length - 1))) return d;
  }
  return '(unregistered)';
}
function safeKey(k) { return SAFE.has(k) || REGISTRY_DOMAINS.some((p) => k === p || k.endsWith('.' + p)) ? k : '(other)'; }

/* ── the corpus, oldest first, so learning runs in the order mail arrived ─── */
function corpusIds() {
  const idx = path.join(CORPUS, 'index.jsonl');
  const onDisk = new Set(fs.readdirSync(CORPUS).filter((f) => f.endsWith('.json.gz')).map((f) => f.slice(0, -8)));
  const dated = [];
  if (fs.existsSync(idx)) {
    for (const line of fs.readFileSync(idx, 'utf8').split('\n')) {
      if (!line.trim()) continue;
      try {
        const r = JSON.parse(line);
        if (r && onDisk.has(r.id)) { dated.push({ id: r.id, at: Date.parse(r.date) || 0 }); onDisk.delete(r.id); }
      } catch { /* a torn line costs one mail its ordering, not the run */ }
    }
  }
  for (const id of onDisk) dated.push({ id, at: 0 });
  dated.sort((a, b) => a.at - b.at || (a.id < b.id ? -1 : 1));
  return dated.map((r) => r.id);
}

async function loadMessage(id) {
  const json = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(CORPUS, id + '.json.gz'))).toString('utf8'));
  // Exactly what the worker sees: gmail.getMessage over Gmail's own JSON.
  const fakeFetch = async () => ({ ok: true, status: 200, json: async () => json, text: async () => JSON.stringify(json) });
  return gmail.getMessage(id, 'scoreboard', fakeFetch, mailtext);
}

/* ── an in-memory stand-in for db.mjs: remembers, writes nowhere ─────────── */
function memoryDb() {
  const fps = new Map();
  const tally = {};
  return {
    tally,
    async fingerprint(sender, template) {
      return fps.get(sender + '\u0000' + template) || fps.get(sender + '\u0000*') || null;
    },
    async saveFingerprint(row) { fps.set(row.sender_address + '\u0000' + row.subject_template, row); },
    async bumpReadTally(stageName) { tally[stageName] = (tally[stageName] || 0) + 1; },
    async senderTally(sender) {
      let txn = 0, junk = 0;
      for (const [k, v] of fps) {
        if (!k.startsWith(sender + '\u0000')) continue;
        if (v.is_transaction_source) txn++; else junk++;
      }
      return { txn, junk };
    },
    async recordDeriveFailure() {},
    async logMissLabels() {},
    async recordLearnedLabel() {},
  };
}

const noNetwork = async () => { throw new Error('the scoreboard makes no network calls'); };

/* ── the replay ──────────────────────────────────────────────────────────── */
const inc = (obj, k, n) => { obj[k] = (obj[k] || 0) + (n == null ? 1 : n); };
const board = {};   // domain -> counters
const slot = (d) => (board[d] = board[d] || { mails: 0, outcome: {}, tier: {}, direction: {}, fields: {}, signal: {}, signalSrc: {}, nodeKind: {}, nodeDepth: {}, rows: 0 });

const db = memoryDb();
const ids = corpusIds();
/* A mail that needs the model needs it ONCE PER SHAPE in production: the first
   answer is cached under (sender, subject shape) and every later mail of that
   shape is settled from its headers. With the model off nothing is ever cached
   here, so the raw count overstates steady state; the number of distinct
   shapes among those mails is the number of calls a fresh mailbox would make.
   Only the COUNT is kept: the key itself is a subject and never printed. */
const modelShapes = new Set();

for (const id of ids) {
  let message;
  try { message = await loadMessage(id); } catch { continue; }
  if (!message) continue;
  const dom = safeDomain(message.from);
  const sender = senders.match(message.from);

  let read = null, outcome;
  try {
    read = await extract.readTransaction(message, db, { llm: null, fetch: noNetwork, subtle: globalThis.crypto.subtle });
    if (read.ok) outcome = 'read_locally';
    else if (read.personalSender) outcome = 'person_sender';
    else if (read.reason === 'multi') outcome = 'multi';
    else if (read.reason === 'unreadable') outcome = 'unreadable';
    else outcome = 'not_a_transaction';
  } catch (e) {
    outcome = (e instanceof llm.LlmUnavailable) ? 'needs_model' : 'error';
    if (outcome === 'needs_model') {
      try { modelShapes.add(senders.addressOf(message.from) + ' ' + await extract.subjectCacheKey(message.subject)); } catch { /* count only */ }
    }
  }

  for (const s of [slot(dom), slot('ALL')]) {
    s.mails++;
    inc(s.outcome, outcome);
  }
  if (!read || !read.ok) continue;

  const x = read.extraction;
  // The node the row would be sealed with: the free tiers of the category
  // cascade only (no budget is handed over, so its model step never runs).
  try { await classify.enrichCategory(x, null, { subtle: globalThis.crypto.subtle, db: {} }); } catch { /* a garnish */ }

  // What would be SEALED, through the real mappers when this build exports
  // them; the extraction's own keys on a build that predates that.
  let raw = null;
  if (worker && typeof worker.toReading === 'function' && stage && typeof stage.buildPayload === 'function') {
    try {
      raw = stage.buildPayload({ reading: worker.toReading(x, message), senderKind: sender && (sender.senderKind || sender.kind), readerV: 2 }).raw_extracted;
    } catch { raw = null; }
  }
  if (!raw) raw = { ...x, category_hint: x.category, reader_type: x.transaction_type, sender_kind: sender && sender.kind };

  const tier = read.tier || read.stage;
  const node = raw.node && taxonomy.TAX.get(raw.node) ? taxonomy.TAX.get(raw.node) : null;
  for (const s of [slot(dom), slot('ALL')]) {
    s.rows++;
    inc(s.tier, safeKey(tier));
    inc(s.direction, safeKey(x.direction));
    for (const k of FIELD_KEYS) {
      const v = raw[k];
      if (v != null && v !== '' && !(typeof v === 'object' && !Object.keys(v).length)) inc(s.fields, k);
    }
    inc(s.signal, raw.signal ? safeKey(raw.signal) : '(none)');
    if (raw.signal && raw.src && raw.src.signal) inc(s.signalSrc, safeKey(raw.src.signal));
    inc(s.nodeKind, node ? safeKey(node.kind) : '(none)');
    inc(s.nodeDepth, node ? safeKey('depth ' + node.depth) : '(none)');
  }
}

/* ── printing: numbers, and keys from the closed lists above ─────────────── */
if (AS_JSON) {
  console.log(JSON.stringify({ corpus_mails: ids.length, model_shapes: modelShapes.size, tally: db.tally, board }, null, 2));
  process.exit(0);
}

const pad = (s, n) => String(s).padEnd(n);
const num = (n, w) => String(n == null ? 0 : n).padStart(w || 6);
const domains = Object.keys(board).filter((d) => d !== 'ALL').sort((a, b) => board[b].mails - board[a].mails);

console.log('\nEmail reading scoreboard: ' + ids.length + ' mails, model OFF\n');
console.log(pad('sender domain', 28) + num('mails') + num('local', 7) + num('model', 7) + num('not-txn', 9) + num('person', 8) + num('unread', 8) + num('multi', 7) + num('error', 7));
for (const d of [...domains, 'ALL']) {
  const o = board[d].outcome;
  console.log(pad(safeKey(d), 28) + num(board[d].mails) + num(o.read_locally, 7) + num(o.needs_model, 7) + num(o.not_a_transaction, 9) + num(o.person_sender, 8) + num(o.unreadable, 8) + num(o.multi, 7) + num(o.error, 7));
}

const all = board.ALL;
const share = (n) => all.rows ? (Math.round(1000 * n / all.rows) / 10).toFixed(1).padStart(6) + '%' : '     -';
const section = (title, obj, order, keyOf) => {
  console.log('\n' + title);
  const keys = order ? order.filter((k) => obj[k]) : Object.keys(obj).sort((a, b) => obj[b] - obj[a]);
  for (const k of keys) console.log('  ' + pad((keyOf || safeKey)(k), 28) + num(obj[k]) + share(obj[k]));
  if (!keys.length) console.log('  (nothing)');
};

console.log('\nRead locally, by tier, per sender domain');
for (const d of [...domains, 'ALL']) {
  if (!board[d].rows) continue;
  console.log('  ' + pad(safeKey(d), 28) + Object.entries(board[d].tier).map(([k, v]) => safeKey(k) + ' ' + v).join(', '));
}
section('Direction of read rows', all.direction);
section('Share of read rows carrying each field (as sealed)', all.fields, FIELD_KEYS);
section('Signal', all.signal);
section('Signal provenance', all.signalSrc);
section('Node kind', all.nodeKind);
section('Node depth', all.nodeDepth);
// Stage names are constants in extract.mjs, never mail text; the shape check is
// what keeps that true if someone ever bumps a tally with a variable.
section('Reader tally (stage counters the run bumped)', db.tally, null, (k) => (/^[a-z_]{1,32}$/.test(k) ? k : '(other)'));

const need = all.outcome.needs_model || 0;
console.log('\nTHE NUMBER: ' + need + ' of ' + all.mails + ' mails would need the model (' +
  (all.mails ? (Math.round(1000 * need / all.mails) / 10) : 0) + '%),\n' +
  'in ' + modelShapes.size + ' distinct (sender, subject shape) pairs: that is how many calls a fresh mailbox\n' +
  'would make before the junk cache and the learned formats answer the rest.\n');
