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
   phrase collides with a provider name. */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'taxonomy', 'providers.json');
const KINDS = ['bank', 'wallet', 'gateway', 'broker', 'lender', 'receipt'];

function squash(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function load() {
  const reg = JSON.parse(fs.readFileSync(SRC, 'utf8'));
  const keys = new Set(), nameIx = new Map(), binIx = new Map(), codeIx = new Map();
  for (const p of reg.providers) {
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
`;
}

const API = 'version: DATA.version, get: get, labelOf: labelOf, kindOf: kindOf, keyOf: keyOf, slugOf: slugOf, keyFromBin: keyFromBin, keyFromCode: keyFromCode, resolve: resolve, all: all';

function generate() {
  const reg = load();
  const json = JSON.stringify(reg);
  const stamp = '/* GENERATED by tools/gen-providers.js from taxonomy/providers.json — do not edit. */';

  const client = stamp + '\n(function () {\n  var DATA = ' + json + ';\n' + helpers() +
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
