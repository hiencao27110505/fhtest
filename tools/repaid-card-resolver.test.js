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
 * NOT pinned, on purpose: one owned card while the mail's card_masked names a
 * DIFFERENT tail. Today step 4 still answers with the owned card. The same
 * one-card default is repeated at four places in 56's display, so changing the
 * resolver alone would make the shown card and the imported card disagree,
 * which §8 forbids. That is a product call, not a defect fix, so it is left
 * alone here and asserted nowhere.
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

console.log(failed ? '\n' + failed + ' failed' : '\nall passed');
process.exit(failed ? 1 : 0);
