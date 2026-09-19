#!/usr/bin/env node
/* gen-taxonomy — ONE source, three targets.

   taxonomy/taxonomy.json is the category tree (category-tree-spec.md): one tree
   per transaction kind, nodes with opaque permanent codes, a parent pointer,
   Vietnamese + English labels, evidence keywords, and the legacy mappings every
   older reader still needs (the 8-concept `concept`, the notify `pool`).

   Generated, never hand-edited:
     src/js-ui/11-taxonomy.js                               classic script → window.FH_TAX
     supabase/functions/_shared/mailbox/taxonomy.mjs        ESM for the mailbox worker
     earthy/serverless/functions/transaction-parser/parser/taxonomy.py   data for transport C

   Run by build.js before every assembly (so the client can never drift from the
   JSON) and standalone via `npm run taxonomy`. Output is deterministic and ends
   without a trailing newline, like every other src/ slice (CLAUDE.md §1).

   Rules enforced here, because a taxonomy that breaks them silently corrupts
   stored rows: codes unique across ALL kinds; every parent exists and is of the
   same kind; depth ≤ 3; codes are [a-z][a-z0-9]* so they survive every target. */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'taxonomy', 'taxonomy.json');

function load() {
  const tax = JSON.parse(fs.readFileSync(SRC, 'utf8'));
  const byCode = new Map();
  for (const n of tax.nodes) {
    if (!/^[a-z][a-z0-9]*$/.test(n.code)) throw new Error('taxonomy: bad code ' + n.code);
    if (byCode.has(n.code)) throw new Error('taxonomy: duplicate code ' + n.code);
    byCode.set(n.code, n);
  }
  for (const n of tax.nodes) {
    if (n.parent) {
      const p = byCode.get(n.parent);
      if (!p) throw new Error('taxonomy: ' + n.code + ' has unknown parent ' + n.parent);
      if (p.kind !== n.kind) throw new Error('taxonomy: ' + n.code + ' crosses kinds');
      if (n.depth !== p.depth + 1) throw new Error('taxonomy: ' + n.code + ' depth mismatch');
    } else if (n.depth !== 1) throw new Error('taxonomy: root node ' + n.code + ' must be depth 1');
    if (n.depth > 3) throw new Error('taxonomy: ' + n.code + ' deeper than 3');
  }
  return tax;
}

/* The shared helper body, written once as plain ES5 so the same text runs as a
   classic script (client, global scope) and inside the ESM wrapper (worker). */
function helpers() {
  return `
  var NODES = DATA.nodes, BY = {}, KIDS = {}, i;
  for (i = 0; i < NODES.length; i++) { BY[NODES[i].code] = NODES[i]; }
  for (i = 0; i < NODES.length; i++) { var p = NODES[i].parent; if (p) { (KIDS[p] = KIDS[p] || []).push(NODES[i].code); } }
  function get(code) { return BY[code] || null; }
  function children(code) { return KIDS[code] ? KIDS[code].slice() : []; }
  function isLeaf(code) { return !!BY[code] && !KIDS[code]; }
  function ancestors(code) { var out = [], n = BY[code]; while (n && n.parent) { out.push(n.parent); n = BY[n.parent]; } return out; }
  function root(code) { var n = BY[code]; while (n && n.parent) { n = BY[n.parent]; } return n ? n.code : null; }
  function kindOf(code) { var n = BY[code]; return n ? n.kind : null; }
  function roots(kind) { var out = [], j; for (j = 0; j < NODES.length; j++) { if (NODES[j].kind === kind && !NODES[j].parent) out.push(NODES[j].code); } return out; }
  function leaves(kind) { var out = [], j; for (j = 0; j < NODES.length; j++) { if ((!kind || NODES[j].kind === kind) && !KIDS[NODES[j].code] && !NODES[j].manual) out.push(NODES[j].code); } return out; }
  /* The legacy 8-concept for any node: its own, else the nearest ancestor's. */
  function conceptOf(code) { var n = BY[code]; while (n) { if (n.concept) return n.concept; n = n.parent ? BY[n.parent] : null; } return null; }
  function poolOf(code) { var n = BY[code]; return n && n.pool ? n.pool : null; }
  /* Nearest known ancestor for a code this build does not know (a newer tree
     wrote it): the rollup rule from the spec. Returns the code itself when known. */
  function rollup(code) { return BY[code] ? code : null; }
  /* Path of labels, top-down, for display: ["Ăn uống","Đồ uống","Cà phê"]. */
  function pathVi(code) { var n = BY[code], out = []; while (n) { out.unshift(n.vi); n = n.parent ? BY[n.parent] : null; } return out; }
  function deburr(s) { return String(s == null ? '' : s).normalize('NFD').replace(/[\\u0300-\\u036f]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'd').toLowerCase(); }
  /* Keyword index per kind: [ [keyword, code], ... ] ordered deepest-first then
     longest keyword first, so a specific leaf phrase wins over its group's word. */
  var KWIDX = {};
  function keywordIndex(kind) {
    if (KWIDX[kind]) return KWIDX[kind];
    var out = [], j, k;
    for (j = 0; j < NODES.length; j++) {
      var n = NODES[j]; if (n.kind !== kind || !n.kw) continue;
      for (k = 0; k < n.kw.length; k++) out.push([deburr(n.kw[k]).trim(), n.code, n.depth]);
    }
    out.sort(function (a, b) { return (b[2] - a[2]) || (b[0].length - a[0].length); });
    KWIDX[kind] = out; return out;
  }
  /* First keyword hit on deburred text. Two passes: word-boundary first (so "cho"
     never fires inside "chuyen"), then a substring pass for keywords of 5+ letters
     (brands glued to gateway prefixes: "WAYNESCOFFEE", "REVICOFFEEHCM"). Returns
     the node code, or null. */
  function keywordNode(text, kind) {
    var raw = deburr(text).replace(/[^a-z0-9]+/g, ' ').trim();
    if (raw.length < 2) return null;
    var t = ' ' + raw + ' ', compact = raw.replace(/ /g, '');
    var idx = keywordIndex(kind || 'expense'), j;
    for (j = 0; j < idx.length; j++) { if (t.indexOf(' ' + idx[j][0] + ' ') >= 0) return idx[j][1]; }
    /* Second pass for brands glued to a gateway prefix ("MPOS*WAYNESCOFFEE",
       "PAYOO-REVICOFFEEHCM03"), where no word boundary survives. Restricted to
       SINGLE-WORD keywords of 6+ letters: a multi-word keyword flattened to one
       token matches things it never meant — "thu y" became "thuy" and filed a
       person named THUY MY under the vet. */
    for (j = 0; j < idx.length; j++) {
      var k = idx[j][0];
      if (k.length < 6 || k.indexOf(' ') >= 0) continue;
      if (compact.indexOf(k) >= 0) return idx[j][1];
    }
    return null;
  }
  var API = { version: DATA.version, kinds: DATA.kinds, nodes: NODES, get: get, children: children, isLeaf: isLeaf,
    ancestors: ancestors, root: root, kindOf: kindOf, roots: roots, leaves: leaves, conceptOf: conceptOf, poolOf: poolOf,
    rollup: rollup, pathVi: pathVi, keywordIndex: keywordIndex, keywordNode: keywordNode, deburr: deburr };`;
}

function clientJs(tax) {
  return '/* GENERATED by tools/gen-taxonomy.js from taxonomy/taxonomy.json — do not edit.\n' +
    '   window.FH_TAX: the category tree (one per kind) + lookup helpers. Version ' + tax.version + '. */\n' +
    'var FH_TAX = (function () {\n  var DATA = ' + JSON.stringify({ version: tax.version, kinds: tax.kinds, nodes: tax.nodes }) + ';' +
    helpers() + '\n  return API;\n})();\nwindow.FH_TAX = FH_TAX;';
}

function workerMjs(tax) {
  return '/* GENERATED by tools/gen-taxonomy.js from taxonomy/taxonomy.json — do not edit.\n' +
    '   The category tree for the mailbox worker. Version ' + tax.version + '. */\n' +
    'const DATA = ' + JSON.stringify({ version: tax.version, kinds: tax.kinds, nodes: tax.nodes }) + ';' +
    helpers() + '\n' +
    'export const TAX = API;\nexport const TAX_VERSION = DATA.version;\n' +
    'export const LEAF_CODES = leaves(null);\n' +
    'export const EXPENSE_LEAVES = leaves(\'expense\');\nexport const INCOME_LEAVES = leaves(\'income\');\n' +
    'export { get as nodeOf, ancestors, root, kindOf, conceptOf, poolOf, keywordNode, pathVi, isLeaf, children, deburr };';
}

function pythonPy(tax) {
  const lines = ['# GENERATED by tools/gen-taxonomy.js from taxonomy/taxonomy.json - do not edit.',
    '# The category tree, version ' + tax.version + '. Nodes: (code, kind, parent, depth, vi, en, concept).',
    'TAX_VERSION = ' + tax.version, 'NODES = ('];
  for (const n of tax.nodes) {
    const q = (s) => s == null ? 'None' : JSON.stringify(String(s));
    lines.push('    (' + [q(n.code), q(n.kind), q(n.parent), n.depth, q(n.vi), q(n.en), q(n.concept || null)].join(', ') + '),');
  }
  lines.push(')', 'BY_CODE = {n[0]: n for n in NODES}', 'LEAF_CODES = tuple(n[0] for n in NODES if not any(m[2] == n[0] for m in NODES))');
  return lines.join('\n') + '\n';
}

function writeIfChanged(rel, content) {
  const p = path.join(ROOT, rel);
  if (fs.existsSync(p) && fs.readFileSync(p, 'utf8') === content) return false;
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content);
  return true;
}

function generate() {
  const tax = load();
  const changed = [
    writeIfChanged('src/js-ui/11-taxonomy.js', clientJs(tax)),
    writeIfChanged('supabase/functions/_shared/mailbox/taxonomy.mjs', workerMjs(tax)),
    writeIfChanged('earthy/serverless/functions/transaction-parser/parser/taxonomy.py', pythonPy(tax)),
  ].filter(Boolean).length;
  return { nodes: tax.nodes.length, changed };
}

module.exports = { generate, load };
if (require.main === module) {
  const r = generate();
  console.log('taxonomy: ' + r.nodes + ' nodes, ' + r.changed + ' target(s) rewritten');
}
