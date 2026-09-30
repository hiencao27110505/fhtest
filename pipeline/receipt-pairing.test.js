#!/usr/bin/env node
/* The receipt/transaction pairing and the late notice.
 * `node pipeline/receipt-pairing.test.js`
 *
 * item-aware-notification-spec.md §9 and §11. Two halves:
 *
 *   1. The derivations are pure and are tested for real — a basket in, an enum
 *      out, with the rules that decide which of the two fields is set.
 *   2. The pairing itself lives inside runWorker's closure and cannot be reached
 *      without a whole Gmail harness, so the rules that MUST NOT drift are
 *      pinned against the source. These are the ones where a silent regression
 *      is a wrong claim on a lock screen rather than a crash.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert');

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); console.log('  PASS  ' + name); pass++; }
  catch (e) { console.log('  FAIL  ' + name + '\n         ' + (e && e.message)); fail++; }
}
const ROOT = path.join(__dirname, '..');
const R = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const worker = R('supabase/functions/_shared/mailbox/worker.mjs');
const sync = R('supabase/functions/mailbox-sync/index.ts');
const send = R('supabase/functions/push-send/index.ts');

console.log('\n-- the basket, reduced to an enum --');

/* The generated module is ESM; the suite is CJS. Reading the two derivations
   through a dynamic import keeps this file a plain script. */
let receiptEnum, receiptBody;
const ready = import(path.join(ROOT, 'supabase/functions/_shared/mailbox/notify-copy.mjs'))
  .then((m) => { receiptEnum = m.receiptEnum; receiptBody = m.receiptBody; });

ready.then(() => {
  t('an agreeing basket yields a pool and no shape', () => {
    const e = receiptEnum({ paid: 681700, discount: 160000, items: [
      { node: 'sportsgear', qty: 1, unit_price: 607700 },
      { node: 'sportsgear', qty: 1, unit_price: 234000 },
    ] });
    assert.deepStrictEqual(e, { ip: 'fitness' }, JSON.stringify(e));
  });

  t('the real Shopee order reads as sport, not as shopping', () => {
    /* The order that started this spec: goggles and a swim cap. Sport gear files
       under hobbygoods in the tree, so the pool list names the depth-3 code to
       keep books and gear apart. If that mapping is lost this goes back to a
       generic hobby line and nobody notices. */
    const e = receiptEnum({ paid: 681700, items: [{ node: 'sportsgear', qty: 1, unit_price: 607700 }] });
    assert.strictEqual(e.ip, 'fitness');
  });

  t('a disagreeing basket falls to shape and never picks a winner', () => {
    const e = receiptEnum({ paid: 600000, items: [
      { node: 'sportsgear', qty: 1, unit_price: 300000 },
      { node: 'medical', qty: 1, unit_price: 300000 },
    ] });
    assert.ok(!e || !e.ip, 'named a pool for a mixed basket: ' + JSON.stringify(e));
  });

  t('a pool and a shape never ride together', () => {
    const e = receiptEnum({ paid: 600000, items: [{ node: 'clothing', qty: 1, unit_price: 600000 }] });
    assert.ok(e.ip && e.ib === undefined, JSON.stringify(e));
  });

  t('nothing readable yields nothing, never a guess', () => {
    /* A one-line order IS readable — "solo" is a true structural fact about it,
       not a guess — so the empty cases are the only ones that must stay silent. */
    for (const rc of [null, undefined, {}, { items: [] }, { items: null }]) {
      const e = receiptEnum(rc);
      assert.ok(e === null || (!e.ip && !e.ib), 'guessed from ' + JSON.stringify(rc));
    }
    assert.deepStrictEqual(receiptEnum({ items: [{ qty: 1 }] }), { ib: 'solo' }, 'a one-line order should read as solo');
  });

  t('the enum carries no name, price, count or code', () => {
    const e = receiptEnum({ paid: 607700, items: [
      { node: 'sportsgear', name: 'Swimming Goggles OLANE 503M', qty: 1, unit_price: 607700, sig: 'hn|swimming goggles' },
    ] });
    assert.ok(!/OLANE|Goggles|607700|sportsgear/.test(JSON.stringify(e)), JSON.stringify(e));
  });

  t('the late line names no purchase', () => {
    for (const lg of ['vi', 'en']) {
      const l = receiptBody(lg, 0.4);
      assert.ok(l && l.body && l.title, 'no line for ' + lg);
      assert.ok(!/\{|\d/.test(l.body), 'placeholder or digit: ' + l.body);
      assert.strictEqual(l.body.slice(-1), '!');
    }
  });

  console.log('\n-- the pairing rules, pinned against the source --');

  t('the pair key is the amount the BANK reports, never the item total', () => {
    /* receipt-reader sets amount = receipt.paid, i.e. after vouchers. Keying on
       anything else would never match: the example order is 841,700 of items and
       681,700 debited. */
    assert.ok(/_pairKey = \(e\) =>[\s\S]{0,200}String\(e\.amount\)/.test(worker), 'the key is not built from extraction.amount');
  });

  t('a disagreeing card tail vetoes, a missing one does not', () => {
    assert.ok(/_tailOk = \(a2, b2\) => !\(a2 && b2 && a2 !== b2\)/.test(worker), 'the tail veto changed shape');
    assert.ok(/_tailOk\(copyBest\.tail, rEnum\.tail\)/.test(worker), 'the receipt side does not check the tail');
    assert.ok(/_tailOk\(tail, rEnum\.tail\)/.test(worker), 'the transaction side does not check the tail');
  });

  t('the index holds the enum and the tail, never the receipt', () => {
    const decl = /const pairIx = new Map\(\);\s*\/\/ ([^\n]*)/.exec(worker);
    assert.ok(decl, 'pairIx is gone');
    assert.ok(!/pairIx\.set\([^)]*read\.extraction\.receipt\s*\)/.test(worker), 'the whole receipt is being cached');
    assert.ok(/pairIx\.set\(rk, rEnum\)/.test(worker), 'the index does not store the derived enum');
  });

  t('a receipt read AFTER its transaction still sharpens the line', () => {
    assert.ok(/copyBest && copyBest\.key === rk/.test(worker), 'the retro-fit is gone');
    assert.ok(/copyBest\.meta\.ip = rEnum\.ip; delete copyBest\.meta\.ib/.test(worker), 'a pool must clear a shape it supersedes');
  });

  t('a duplicate suspicion never earns the voice', () => {
    assert.ok(/if \(!row\.duplicate_of_id\) \{[\s\S]{0,900}?pairIx\.get\(key\)/.test(worker), 'pairing moved outside the duplicate guard');
  });

  console.log('\n-- the late notice, and its gates --');

  t('it never fires on a run that already sent a transaction push', () => {
    assert.ok(/if \(!summary\.notified && !backfilling && \(summary\.receiptLate \|\| 0\) > 0 && ctx\.notify\)/.test(worker),
      'the one-push-per-run gate changed');
  });

  t('it never fires with an empty queue', () => {
    assert.ok(/if \(pend > 0\) \{/.test(worker), 'a notice that opens an empty screen is possible again');
  });

  t('it is its own kind, with its own tag', () => {
    assert.ok(/meta && meta\.receipt \? "receipt_read"/.test(sync), 'mailbox-sync does not send the kind');
    assert.ok(/svcKind !== "receipt_read"/.test(send), 'push-send does not accept the kind');
    assert.ok(/svcKind === "receipt_read" \? "fh-receipt"/.test(send), 'it shares a tag with something else');
  });

  t('its line takes no meta, so it cannot be turned into a claim', () => {
    assert.ok(/svcKind === "receipt_read" \? \(receiptBody\(lg\)/.test(send), 'the late line is being passed a meta');
  });

  t('the counters the spec promises exist', () => {
    for (const k of ['receipt_paired_inrun', 'receipt_late', 'notify_receipt_read']) {
      assert.ok(worker.indexOf("'" + k + "'") >= 0, 'missing tally ' + k);
    }
  });

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  if (fail) process.exit(1);
});
