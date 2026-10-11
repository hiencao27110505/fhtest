#!/usr/bin/env node
/* gen-providers — ONE registry, two targets.

   taxonomy/providers.json is the provider registry (account-identity-spec.md):
   one entry per financial provider, keyed by an opaque permanent `key`, with a
   display `label`, a `kind`, the spellings seen in the wild (`names[]`), NAPAS
   BINs (`bins[]`) and wallet-statement bank codes (`codes[]`), plus the deny
   list of phrases that name NO provider ("ngân hàng liên kết", "ví", …).

   Generated, never hand-edited:
     src/js-ui/09-providers.js                          classic script → window.FH_PROVIDERS
     supabase/functions/_shared/mailbox/providers.mjs   ESM for the mailbox worker

   Run by build.js before every assembly and standalone via `npm run providers`.
   Deterministic output, no trailing newline (CLAUDE.md §1).

   Resolution (spec P4): a caller with a domain uses senders.mjs first; this
   module answers the rest — BIN / bank code → names[] → shape rules → deny →
   nothing. keyOf() returns a registry key or ''; slugOf() returns the stable
   shape-rule slug for prose the registry has never seen, so unknown providers
   still fold consistently with each other ('' only for denied/empty prose).

   Rules enforced here, because a registry that breaks them silently splits or
   wrongly merges accounts: keys unique and [a-z0-9]+; kind from the closed
   set; no name resolves to two keys; no BIN or code claimed twice; no deny
   phrase collides with a provider name.

   Face (source-face-spec.md): an entry may carry `face: { mono, hex }`, the
   monogram and brand colour a money source wears wherever it is named. It is
   presentation, so it goes to the CLIENT target only: the worker's
   providers.mjs is written without it and stays byte-identical when a face is
   added or changed, which means a colour edit never asks for a function
   deploy. The generator picks the ink (white, or dark when white would fall
   under 3:1 on the colour) and writes it as `dk`. */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'taxonomy', 'providers.json');
const KINDS = ['bank', 'wallet', 'gateway', 'broker', 'lender', 'receipt'];

/* Receipt block (receipt-providers-spec.md §9). A `kind: receipt` entry says
   who sends its receipts, which subjects are receipts (the fetch-cost gate),
   which reading family the mail belongs to, and the labels that family's
   walk anchors on. senders.mjs builds RECEIPTS / RECEIPT_SUBJECTS from this,
   so a bad block here reads the wrong mail for everyone: hence the rules. */
const FAMILIES = ['marketplace_order', 'subscription_invoice', 'service_receipt', 'model_only'];
/* A bare domain that also carries a person's own mail or a platform's
   unrelated mail may never be a receipt sender: register the full address. */
const REFUSE_BARE = new Set([
  'gmail.com', 'googlemail.com', 'yahoo.com', 'yahoo.com.vn', 'ymail.com', 'outlook.com', 'outlook.com.vn',
  'hotmail.com', 'live.com', 'msn.com', 'icloud.com', 'me.com', 'mac.com', 'aol.com', 'proton.me', 'protonmail.com',
  'zoho.com', 'mail.com', 'gmx.com', 'yandex.com', 'google.com', 'microsoft.com', 'facebook.com', 'amazon.com',
]);
function checkReceipt(p, senderIx) {
  const r = p.receipt;
  if (p.kind !== 'receipt') { if (r) throw new Error('providers: ' + p.key + ' has a receipt block but kind ' + p.kind); return; }
  if (!r) return; // a receipt provider with no block is a label only (resolves prose, never fetched)
  if (!Array.isArray(r.senders) || !r.senders.length) throw new Error('providers: ' + p.key + ' receipt.senders empty');
  for (const s0 of r.senders) {
    const s = String(s0 || '').trim().toLowerCase();
    if (!s || /\s|"/.test(s) || s !== s0) throw new Error('providers: ' + p.key + ' bad sender "' + s0 + '"');
    if (s.indexOf('@') < 0 && REFUSE_BARE.has(s)) throw new Error('providers: ' + p.key + ' bare domain ' + s + ' refused; register the full address');
    if (senderIx.has(s)) throw new Error('providers: sender ' + s + ' claimed by ' + senderIx.get(s) + ' and ' + p.key);
    senderIx.set(s, p.key);
  }
  if (!Array.isArray(r.subjects) || !r.subjects.length) throw new Error('providers: ' + p.key + ' receipt.subjects empty (the cost gate is not optional)');
  for (const t of r.subjects) if (typeof t !== 'string' || !t.trim()) throw new Error('providers: ' + p.key + ' bad subject term');
  if (FAMILIES.indexOf(r.family) < 0) throw new Error('providers: ' + p.key + ' bad family ' + r.family);
  if (r.family !== 'model_only' && (!r.labels || typeof r.labels !== 'object')) throw new Error('providers: ' + p.key + ' family ' + r.family + ' needs labels');
  if (r.since != null && !(Number.isInteger(r.since) && r.since >= 6)) throw new Error('providers: ' + p.key + ' bad since ' + r.since);
}

/* WCAG relative luminance of a 6-digit hex, and the ratio of two luminances. */
function lum(hex) {
  const c = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
const ratio = (a, b) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
const FACE_INK = '1a1117';   // the dark ink a light brand colour wears; the client reads it as var(--ink)
/* A face is { mono, hex? }. mono: one to four letters or digits, what people
   already call the provider (VCB, MB, BIDV). hex: the provider's own colour,
   six digits and no '#', so the colour ratchet never counts the registry.
   No hex = the neutral face. `dk` is derived here, never hand-written. */
function checkFace(p) {
  const f = p.face;
  if (f == null) return;
  if (p.kind === 'receipt') throw new Error('providers: ' + p.key + ' is a receipt sender; sellers wear a brand (brands.json), not a face');
  for (const k of Object.keys(f)) if (k !== 'mono' && k !== 'hex') throw new Error('providers: ' + p.key + ' face has an unknown field "' + k + '"');
  if (typeof f.mono !== 'string' || !/^[A-Za-z0-9]{1,4}$/.test(f.mono)) throw new Error('providers: ' + p.key + ' face.mono must be 1 to 4 letters or digits');
  if (f.hex != null && !/^[0-9A-Fa-f]{6}$/.test(f.hex)) throw new Error('providers: ' + p.key + ' face.hex must be six hex digits, no #');
}
/* The face as the client receives it: the ink already decided. White when it
   clears 3:1 on the colour (the bar every white-on-identity pair in
   color-lint.js is held to), else the dark ink, which must clear 4.5:1. */
function clientFace(p) {
  const f = p.face, out = { mono: f.mono };
  if (f.hex) {
    out.hex = f.hex.toUpperCase();
    const l = lum(f.hex);
    if (ratio(1, l) < 3) {
      if (ratio(lum(FACE_INK), l) < 4.5) throw new Error('providers: ' + p.key + ' face.hex ' + f.hex + ' carries neither white nor dark ink legibly');
      out.dk = 1;
    }
  }
  return out;
}

function squash(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function load() {
  const reg = JSON.parse(fs.readFileSync(SRC, 'utf8'));
  const keys = new Set(), nameIx = new Map(), binIx = new Map(), codeIx = new Map(), senderIx = new Map();
  for (const p of reg.providers) {
    checkReceipt(p, senderIx);
    checkFace(p);
    if (!/^[a-z0-9]+$/.test(p.key)) throw new Error('providers: bad key ' + p.key);
    if (keys.has(p.key)) throw new Error('providers: duplicate key ' + p.key);
    keys.add(p.key);
    if (KINDS.indexOf(p.kind) < 0) throw new Error('providers: ' + p.key + ' bad kind ' + p.kind);
    for (const n of [p.label].concat(p.names || [])) {
      const sq = squash(n);
      if (!sq) throw new Error('providers: ' + p.key + ' empty name');
      if (nameIx.has(sq) && nameIx.get(sq) !== p.key)
        throw new Error('providers: name "' + n + '" claimed by ' + nameIx.get(sq) + ' and ' + p.key);
      nameIx.set(sq, p.key);
    }
    for (const b of p.bins || []) {
      if (!/^\d{6}$/.test(b)) throw new Error('providers: ' + p.key + ' bad BIN ' + b);
      if (binIx.has(b)) throw new Error('providers: BIN ' + b + ' claimed twice');
      binIx.set(b, p.key);
    }
    for (const c of p.codes || []) {
      if (codeIx.has(c)) throw new Error('providers: code ' + c + ' claimed twice');
      codeIx.set(c, p.key);
    }
  }
  for (const d of reg.deny) {
    const sq = squash(d);
    if (nameIx.has(sq)) throw new Error('providers: deny "' + d + '" collides with provider ' + nameIx.get(sq));
  }
  return reg;
}

/* The shared helper body, plain ES5, identical text in both targets so device
   and worker can never disagree about what a spelling means. */
function helpers() {
  return `
  var LIST = DATA.providers, BY = {}, NAMES = {}, BINS = {}, CODES = {}, DENY = {}, i, j, p;
  function squash(s) {
    s = String(s == null ? '' : s);
    if (s.normalize) { s = s.normalize('NFD').replace(/[\\u0300-\\u036f]/g, ''); }
    return s.replace(/[\\u0111]/g, 'd').replace(/[\\u0110]/g, 'D').toLowerCase().replace(/[^a-z0-9]/g, '');
  }
  for (i = 0; i < LIST.length; i++) {
    p = LIST[i]; BY[p.key] = p;
    NAMES[squash(p.label)] = p.key; NAMES[p.key] = p.key;
    for (j = 0; j < (p.names || []).length; j++) { NAMES[squash(p.names[j])] = p.key; }
    for (j = 0; j < (p.bins || []).length; j++) { BINS[p.bins[j]] = p.key; }
    for (j = 0; j < (p.codes || []).length; j++) { CODES[p.codes[j]] = p.key; }
  }
  for (i = 0; i < DATA.deny.length; i++) { DENY[squash(DATA.deny[i])] = 1; }
  /* Shape rules — the last resort for prose the registry has never seen.
     Strip the corporate dressing a Vietnamese bank name arrives in, then try
     the name index again at each step. Order matters: "Ngân hàng TMCP Ngoại
     thương Việt Nam" must reach "ngoai thuong" before the trailing-VN strip. */
  function fold(sq) {
    if (!sq || DENY[sq]) return '';
    if (NAMES[sq]) return sq;
    var t = sq.replace(/^(?:nganhang|nh)(?:thuongmaicophan|tmcp)?/, '')
              .replace(/^(?:thuongmaicophan|tmcp)/, '')
              .replace(/^(?:congtycophan|congtytnhh|congty|ctcp|ctytnhh|cty|tnhh)/, '');
    if (NAMES[t]) return t;
    if (t.length > 3) { t = t.replace(/(?:vietnam|vn)$/, '') || t; }
    if (NAMES[t]) return t;
    /* "Ví X" for a known wallet: drop the vi- prefix ONLY when the remainder
       is a registry name, so "vib" never loses its head. */
    if (t.slice(0, 2) === 'vi' && NAMES[t.slice(2)]) return t.slice(2);
    return DENY[t] ? '' : t;
  }
  function keyOf(prose) { var f = fold(squash(prose)); return (f && NAMES[f]) || ''; }
  function slugOf(prose) { return fold(squash(prose)); }
  function keyFromBin(bin) { return BINS[String(bin == null ? '' : bin).replace(/\\D/g, '')] || ''; }
  function keyFromCode(code) { return CODES[squash(code)] || ''; }
  function get(key) { return BY[key] || null; }
  function labelOf(key) { return BY[key] ? BY[key].label : ''; }
  function kindOf(key) { return BY[key] ? BY[key].kind : ''; }
  function resolve(prose) { var k = keyOf(prose); return k ? { key: k, label: BY[k].label, kind: BY[k].kind } : null; }
  function all() { return LIST.slice(); }
  /* Receipt senders, one row per sender (receipt-providers-spec.md §9):
     { key, label, sender, subjects, family, labels, since }. 'since' is the
     bank_email consent version that first covers the sender (6 = the seven
     named in v6; 7 = anything added under the registry consent). */
  function receiptSenders() {
    var out = [], k, r;
    for (k = 0; k < LIST.length; k++) {
      p = LIST[k]; r = p.receipt;
      if (p.kind !== 'receipt' || !r) continue;
      for (j = 0; j < r.senders.length; j++) {
        out.push({ key: p.key, label: p.label, sender: r.senders[j], subjects: (r.subjects || []).slice(),
                   family: r.family, labels: r.labels || null, since: r.since || 6 });
      }
    }
    return out;
  }
`;
}

const API = 'version: DATA.version, get: get, labelOf: labelOf, kindOf: kindOf, keyOf: keyOf, slugOf: slugOf, keyFromBin: keyFromBin, keyFromCode: keyFromCode, resolve: resolve, all: all, receiptSenders: receiptSenders';

function generate() {
  const reg = load();
  /* Two serialisations of one registry: the worker's has no faces (see the
     header), the client's has them with the ink decided. */
  const strip = (withFace) => JSON.stringify(Object.assign({}, reg, { providers: reg.providers.map((p) => {
    const q = Object.assign({}, p);
    if (q.face) { if (withFace) q.face = clientFace(p); else delete q.face; }
    return q;
  }) }));
  const json = strip(false), jsonClient = strip(true);
  const stamp = '/* GENERATED by tools/gen-providers.js from taxonomy/providers.json — do not edit. */';

  const client = stamp + '\n(function () {\n  var DATA = ' + jsonClient + ';\n' + helpers() +
    '  window.FH_PROVIDERS = { ' + API + ' };\n})();';
  const esm = stamp + '\nconst DATA = ' + json + ';\n' + helpers() +
    'export const FH_PROVIDERS = { ' + API + ' };\nexport default FH_PROVIDERS;';

  const outs = [
    [path.join(ROOT, 'src', 'js-ui', '09-providers.js'), client],
    [path.join(ROOT, 'supabase', 'functions', '_shared', 'mailbox', 'providers.mjs'), esm],
  ];
  for (const [file, text] of outs) {
    if (!fs.existsSync(file) || fs.readFileSync(file, 'utf8') !== text) fs.writeFileSync(file, text);
  }
  return reg.providers.length;
}

if (require.main === module) console.log('gen-providers: ' + generate() + ' providers');
module.exports = { generate };
