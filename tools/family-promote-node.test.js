#!/usr/bin/env node
/* A family-scoped row must be written with the node the person SAW at review.
 * `node tools/family-promote-node.test.js`
 *
 * The review resolves a tree node for every candidate (pipeline, history, a
 * lesson, keywords, or the person's own pick) and shows it on the card. A
 * personal row kept it. A family row did not: csvPromote() built its composer
 * rows without `node`, loadRow() reset the composer's node to null, and
 * addExpense() re-guessed from the note and the label. So the ledger could hold
 * a different node from the one on the card the person approved, and a node the
 * person PICKED was thrown away with the rest (email-reading-v2-spec §15 fix 4).
 *
 * The hand-off is the one source / inst / pAcct / link already use: the row
 * carries it, submitBulk() puts it on a global for the duration of that row's
 * addExpense(), and the write-through stamps it on the new txn before the
 * insert reads it.
 *
 * The rule from category-tree-spec E16 is pinned here too: a node the pipeline
 * SEALED is only trusted while fhPipeNodeOk still accepts it; a node the person
 * picked always wins.
 *
 * Real functions, extracted from source by name and run in a vm.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const CSVUI = read('src/js-ui/56-csv-import-ui.js');
const CAPTURE = read('src/js-ui/50-sheets-expense-capture.js');
const WT = read('src/js-data/50-writethrough-realtime.js');
const QUICK = read('src/js-data/76-quick-review.js');
const TAX = read('src/js-ui/11-taxonomy.js');
const PART = read('src/js-ui/13-partition.js');

let failed = 0;
function ok(cond, what, detail) {
  console.log((cond ? '  ok   ' : '  FAIL ') + what + (!cond && detail ? '  -> ' + detail : ''));
  if (!cond) failed++;
}
function grab(src, header) {
  const at = src.indexOf(header);
  if (at < 0) throw new Error('not found in source: ' + header);
  let i = src.indexOf('{', at), depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (!depth) break; }
  }
  return src.slice(at, i + 1);
}
function grabOrNull(src, header) { try { return grab(src, header); } catch (e) { return null; } }

/* ── 1. which node a reviewed candidate promotes with ──────────────────────── */
console.log('csvPromoteNode — the node a family row is written with');
const promoteNodeSrc = grabOrNull(CSVUI, 'function csvPromoteNode(');
ok(!!promoteNodeSrc, 'csvPromoteNode exists in 56-csv-import-ui.js');
if (promoteNodeSrc) {
  const ctx = { console };
  ctx.window = ctx;
  vm.createContext(ctx);
  // The real tree and the real sealed-node check: a stub here would only prove
  // that the stub agrees with itself.
  vm.runInContext(TAX, ctx);
  vm.runInContext(grab(PART, 'function fhNodeOk('), ctx);
  vm.runInContext(grab(PART, 'function fhSellerSignal('), ctx);
  vm.runInContext(PART.match(/var _RETIRED_KW=\[[\s\S]*?\]\];/)[0], ctx);
  vm.runInContext(grab(PART, 'function fhPipeNodeOk('), ctx);
  vm.runInContext(promoteNodeSrc, ctx);
  const nodeOf = (c) => { ctx.__c = c; return vm.runInContext('csvPromoteNode(__c)', ctx); };

  ok(nodeOf({ _node: 'coffee', _nodeSource: 'keyword', description: 'ca phe sang' }) === 'coffee',
    'a node the review resolved rides along');
  ok(nodeOf({ _node: 'groceries', _nodeSource: 'user', description: 'ca phe sang' }) === 'groceries',
    'a node the person picked wins, whatever the words say');
  ok(nodeOf({ _node: null, _nodeSource: null, description: 'x' }) === null,
    'no node at review -> none carried (the composer may still guess)');
  ok(nodeOf({ _node: 'not-a-real-code', _nodeSource: 'keyword' }) === null,
    'a code this tree does not know is never written');
  ok(nodeOf({ _node: 'wage', _nodeSource: 'keyword' }) === null,
    'an income node never rides a family EXPENSE row');

  // E16: "pizza" was retired as a fastfood keyword. A SEALED fastfood resting on
  // it is dropped; the same node from the person is kept.
  const retired = { _node: 'fastfood', description: 'PIZZA SYNTHETIC HOUSE', counterparty: '' };
  ok(nodeOf(Object.assign({ _nodeSource: 'pipeline' }, retired)) === null,
    'a sealed node resting on a retired keyword is dropped at promote too');
  ok(nodeOf(Object.assign({ _nodeSource: 'user' }, retired)) === 'fastfood',
    '...but the person\'s own pick of that same node stands');
  ok(nodeOf({ _node: 'coffee', _nodeSource: 'pipeline', description: 'ca phe sang' }) === 'coffee',
    'a sealed node today\'s tree still agrees with passes');
}

/* ── 2. the hand-off: row -> global -> the new txn -> the insert ───────────── */
console.log('\nsubmitBulk -> addExpense write-through');
{
  const inserted = [];
  const fields = { 'ex-note': { value: '' }, 'ex-amt': { value: '' }, 'ex-date': { value: '' }, 'ex-time': { value: '' } };
  const ctx = {
    console, L: (vi) => vi, TODAY: new Date(2026, 7, 13), crypto: { randomUUID: () => 'uuid' },
    document: { getElementById: (id) => fields[id] || null },
    txns: [], order: [], events: {}, exPhotos: [], lastWho: 'Bố', bulkSaveTried: false,
    parseAmtBase: (s) => Math.round((parseInt(String(s || '').replace(/[^0-9]/g, ''), 10) || 0) / 1000),
    parseBulkLine: () => ({}), catValid: () => true, bulkShowInvalid: () => {},
    selectChipByVal: () => {}, setDateFloor: () => {}, isoMonthStart: () => '2024-01-01',
    isoDate: () => '2026-08-13', _syncExTime: () => {}, updateExWhen: () => {}, refreshExCta: () => {},
    clearDrafts: () => {}, toast: () => {}, closeModals: () => {}, closeExpense: () => {}, renderAll: () => {}, renderTxns: () => {},
    renderBulk: () => {}, floatEmojis: () => {}, go: () => {}, segTo: () => {}, fmt: (n) => String(n),
    // What the composer would guess from the words alone. Deliberately WRONG for
    // these rows, so a pass proves the reviewed node replaced it.
    fhNodeGuess: () => 'groceries',
    _fhWriteLocked: () => false, _famAcctPick: () => null,
    _dbInsertTxn: (t) => { inserted.push(Object.assign({}, t)); return Promise.resolve(); },
    _dbInsertEvent: () => {},
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext('var bulkRows=[], bulkActive=0, BULK_SAVING=false;', ctx);
  vm.runInContext(CAPTURE.match(/var exNode=null, _nodeTouched=false;/)[0], ctx);
  vm.runInContext(grab(CAPTURE, 'function exGuessNode('), ctx);
  vm.runInContext(grab(CAPTURE, 'function loadRow('), ctx);
  vm.runInContext(grab(CAPTURE, 'function submitBulk('), ctx);
  // The js-ui addExpense, reduced to the two lines that matter here: it asks the
  // composer for the node exactly as the real one does, and adds the local row.
  vm.runInContext(`function addExpense(){
    var note=document.getElementById('ex-note').value;
    var _node=exGuessNode(note,'Ăn uống');
    txns.unshift({ id:'t'+txns.length, note:note, node:_node });
  }`, ctx);
  // The REAL write-through decorator, wrapped around it.
  vm.runInContext('const _origAddExpense = window.addExpense;\n' + grab(WT, 'window.addExpense = function ()') + ';', ctx);

  vm.runInContext(`bulkRows=[
    { note:'row reviewed as coffee', amt:'45000', cat:'Ăn uống', who:'Bố', date:'2026-08-11', node:'coffee' },
    { note:'row the person re-filed', amt:'90000', cat:'Ăn uống', who:'Bố', date:'2026-08-11', node:'pharmacy', _nodeTouched:true },
    { note:'row with no node at review', amt:'30000', cat:'Ăn uống', who:'Bố', date:'2026-08-11', node:null },
  ]; submitBulk({prepared:true});`, ctx);

  const by = (note) => inserted.find((t) => t.note === note) || {};
  ok(inserted.length === 3, 'three rows reach the insert', String(inserted.length));
  ok(by('row reviewed as coffee').node === 'coffee',
    'the reviewed node is what is written, not the composer\'s re-guess', by('row reviewed as coffee').node);
  ok(by('row the person re-filed').node === 'pharmacy', 'a hand-picked node is written', by('row the person re-filed').node);
  ok(by('row with no node at review').node === 'groceries',
    'a row that had no node keeps the composer\'s guess, as before', by('row with no node at review').node);
  ok(ctx._fhImportNode == null, 'the hand-off global is cleared after the batch');

  // A hand-typed log is not an import: nothing on the global may leak into it.
  ctx._fhImportNode = 'coffee';
  vm.runInContext('exNode=null; _nodeTouched=false; document.getElementById("ex-note").value="typed by hand"; window.addExpense();', ctx);
  ok(by('typed by hand').node === 'groceries', 'a stale global never rides a manual log', by('typed by hand').node);
}

/* ── 3. the call sites that make the above reachable ───────────────────────── */
console.log('\ncall sites');
const promoteBody = grab(CSVUI, 'function csvPromote(');
ok(/node:\s*_pn\b|node:\s*csvPromoteNode\(c\)/.test(promoteBody), 'csvPromote() puts the promoted node on each composer row');
ok(/_nodeTouched:/.test(promoteBody), 'and marks a hand-picked one touched, so no guess overwrites it');
ok(/window\._fhImportNode\s*=\s*\(rows\[k\]/.test(CAPTURE), 'submitBulk() hands each row\'s node to the write-through');
ok(/_fhImportNode/.test(grab(QUICK, 'async function _qrWriteFamily(')), 'quick review\'s one-row family write hands its node over too');

console.log(failed ? '\n' + failed + ' failed' : '\nall passed');
process.exit(failed ? 1 : 0);
