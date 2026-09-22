#!/usr/bin/env node
/* Which owned card a card payment pays off: the order of evidence, pinned.
 * `node tools/repaid-card-resolver.test.js`
 *
 * fhResolveRepaidCard had no test, and an inventory of the email path claimed
 * an ordering bug in it: "the memo-digit match (step 3) returns before the
 * single-card default (step 4)", so "a payment to your own card is never found".
 * Read closely, that cannot happen, and this file is the proof rather than a
 * fix:
 *
 *   - step 3 returns ONLY on exactly one owned-card hit. Zero hits and two hits
 *     both fall through to step 4;
 *   - step 4 fires only when one card is owned, and then step 3's one possible
 *     hit IS that card. Swapping the two steps changes no outcome.
 *
 * What it does pin is the rule the resolver exists for (card-repayment-routing-
 * spec §8.1, §10.4): a WRONG card moves the wrong balance, so ambiguity resolves
 * to null ("Chưa rõ"), never to a guess.
 *
 * ONE OWNED CARD, AND THE MAIL NAMES ANOTHER (2026-09-22). Step 4's "one owned
 * card, so that one" used to answer even when card_masked named a different
 * card in full. That drew down the wrong card's debt on the word of a mail that
 * said otherwise, against §9 ("never a wrong card"). Now a fully named card that
 * is not owned resolves to null. The same default was repeated at four places
 * in 56's display; they all go through csvPayCardFor, which asks this resolver,
 * so the card SHOWN and the card IMPORTED cannot disagree (§8). Both are pinned
 * at the bottom of this file.
 *
 * Real function extracted from source by name. Synthetic tails only.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'src', 'js-data', '72-txn-review.js'), 'utf8');

let failed = 0;
function ok(cond, what, detail) {
  console.log((cond ? '  ok   ' : '  FAIL ') + what + (!cond && detail !== undefined ? '  -> ' + JSON.stringify(detail) : ''));
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

const ctx = { console, accounts: [] };
ctx.window = ctx;
ctx.fhPersonalData = () => ({ accounts: ctx.accounts });
vm.createContext(ctx);
vm.runInContext(grab(SRC, 'window.fhResolveRepaidCard = function (rawX, sa, desc)') + ';', ctx);

const card = (id, tail, provider) => ({ id, kind: 'credit_card', tail, provider: provider || 'testbank' });
const deposit = (id, tail) => ({ id, kind: 'deposit', tail, provider: 'testbank' });
const resolve = (accounts, rawX, sa, desc) => {
  ctx.accounts = accounts; ctx.__a = [rawX, sa, desc];
  return vm.runInContext('fhResolveRepaidCard(__a[0], __a[1], __a[2])', ctx);
};
const A = card('card-A', '1111'), B = card('card-B', '2222'), D = deposit('dep-D', '3333');
const DEP_SA = { kind: 'deposit', tail: '3333', provider: 'testbank' };

console.log('the inventory\'s scenario: two owned cards, the memo names one');
ok(resolve([A, B, D], { memo: 'THANH TOAN THE 1111' }, DEP_SA, '') === 'card-A', 'the named card is found (step 3)');
ok(resolve([A, B, D], { memo: 'THANH TOAN THE 2222' }, DEP_SA, '') === 'card-B', '...whichever one it is');
ok(resolve([A, B, D], { memo: 'THANH TOAN THE' }, DEP_SA, '') === null, 'no card named, two owned -> null, never a guess');
ok(resolve([A, B, D], { memo: 'TT THE 1111 VA 2222' }, DEP_SA, '') === null, 'both named -> ambiguous -> null');

console.log('\nstep 3 never blocks step 4');
ok(resolve([A, D], { memo: 'THANH TOAN THE' }, DEP_SA, '') === 'card-A', 'one owned card, no digits at all -> that card');
ok(resolve([A, D], { memo: 'THANH TOAN THE 9876 REF 555000' }, DEP_SA, '') === 'card-A', 'one owned card, digits that match no owned card -> still that card');
ok(resolve([A, D], { memo: 'THANH TOAN THE 1111' }, DEP_SA, '') === 'card-A', 'one owned card, digits that match it -> the same answer either way');

console.log('\nthe order of evidence');
ok(resolve([A, B], { card_masked: '**** 2222', memo: 'THE 1111' }, DEP_SA, '') === 'card-B', '1. card_masked outranks a tail in the memo');
ok(resolve([A, B], { memo: 'THE 1111' }, { kind: 'credit_card', tail: '2222', provider: 'testbank' }, '') === 'card-B', '2. the card-side alert\'s own number outranks the memo');
ok(resolve([A, B, D], {}, { kind: 'credit_card', tail: '3333', provider: 'testbank' }, '') === null,
  '2. a deposit number mislabelled credit_card finds no CARD and cannot tag one (the VIB hazard)');
ok(resolve([A, B], {}, DEP_SA, 'tra the 1111') === 'card-A', '3. the reviewed description is mined too');
ok(resolve([A, B], { memo: 'ma gd 11112' }, DEP_SA, '') === null, '3. a tail inside a longer number is not a token match');

console.log('\nambiguity resolves to null');
const A2 = card('card-A2', '1111', 'otherbank');
ok(resolve([A, A2], { card_masked: '1111' }, null, '') === null, 'two cards share a tail, no provider to break the tie -> null');
ok(resolve([A, A2], { card_masked: '1111' }, { kind: 'deposit', tail: '3333', provider: 'otherbank' }, '') === 'card-A2', '...a provider hint breaks it');
ok(resolve([D], { card_masked: '1111' }, DEP_SA, '') === null, 'no card owned -> null');
ok(resolve([], {}, null, '') === null, 'nothing owned, nothing known -> null, and no throw');

console.log('\nthe mail names a card the person does not own');
ok(resolve([A, D], { card_masked: '**** 9999' }, DEP_SA, '') === null, 'one owned card, the mail names ANOTHER -> null ("Chưa rõ"), never the owned one');
ok(resolve([A, D], { card_masked: '**** 9999', memo: 'THANH TOAN THE' }, DEP_SA, 'tra no the') === null, '...whatever the memo and the description add');
ok(resolve([A, D], { card_masked: '**** 9999', memo: 'THE 1111' }, DEP_SA, '') === null, '...even a memo naming the owned card: the mail\'s own card field is the stronger statement');
ok(resolve([A, D], { card_masked: '**** 1111' }, DEP_SA, '') === 'card-A', 'the mail names the owned card -> that card (unchanged)');
ok(resolve([A, D], {}, DEP_SA, '') === 'card-A', 'the mail names NO card -> the one-card default still answers (unchanged)');
ok(resolve([A, D], { card_masked: '' }, DEP_SA, '') === 'card-A', '...an empty card field is no card named');
ok(resolve([A, D], { card_masked: '**11' }, DEP_SA, '') === 'card-A', 'a fragment shorter than four digits names nothing: it cannot be compared, so it cannot veto');
ok(resolve([A, B, D], { card_masked: '9999', memo: 'THE 1111' }, DEP_SA, '') === null, 'two owned cards, the mail names a third -> null');

console.log('\nthe card SHOWN is the card IMPORTED');
{
  const UI = fs.readFileSync(path.join(__dirname, '..', 'src', 'js-ui', '56-csv-import-ui.js'), 'utf8');
  ok(!/cards\.length\s*===\s*1/.test(UI), 'no display site repeats "one owned card, so that one" on its own');
  const sites = ['function csvStagedRowsCard(', 'function csvRowSheetHTML(', 'function csvRowKindField(', 'function csvPickRowKind('];
  sites.forEach((h) => ok(/csvPayCardFor\(c\)/.test(grab(UI, h)), h.replace('function ', '').replace('(', '') + ' asks csvPayCardFor'));
  ok(/fhResolveRepaidCard\(x, sa, c\.description\)/.test(grab(UI, 'function csvPayCardFor(')), 'and csvPayCardFor asks the one resolver, with the same three arguments the import passes');
  ok(/payCard = window\.fhResolveRepaidCard\(_sx2, ai, c\.description\)/.test(SRC), '...which is the call the promote path makes');

  // The real csvPayCardFor over the real resolver: a pick wins, else the resolver's word.
  ctx.fhStagedRawX = () => ctx.__x; ctx.fhStagedAcct = () => DEP_SA;
  vm.runInContext(grab(UI, 'function csvPayCardFor('), ctx);
  const shown = (accounts, x, cand) => { ctx.accounts = accounts; ctx.__x = x; ctx.__c = Object.assign({ rowIndex: 0, description: '' }, cand); return vm.runInContext('csvPayCardFor(__c)', ctx); };
  ok(shown([A, D], { card_masked: '9999' }, {}) === '', 'one owned card, another named -> the row shows "Chưa rõ"');
  ok(shown([A, D], {}, {}) === 'card-A', 'one owned card, none named -> the row shows that card');
  ok(shown([A, B], { card_masked: '2222' }, { _payCardId: 'card-A' }) === 'card-A', 'the person\'s own pick always wins');
}

console.log(failed ? '\n' + failed + ' failed' : '\nall passed');
process.exit(failed ? 1 : 0);
