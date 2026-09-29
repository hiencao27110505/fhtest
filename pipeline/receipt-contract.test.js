/**
 * Receipt enrichment L1 — the contract half (receipt-enrichment-spec.md §9).
 *
 * What is pinned here, and why it must not drift:
 *
 * 1. The receipt block's keys are the spec's list, and `paid` is among them —
 *    it is the JOIN key; a rename strands every sealed row's join.
 * 2. The privacy rule is STRUCTURAL at the item level too: an extractor
 *    emitting a delivery address inside an item element seals the item
 *    without it. Grab receipts carry home addresses; the prompt saying
 *    "never extract them" is one defence, this is the one that cannot be
 *    talked out of.
 * 3. Malformed items (a string, a number) seal as null, never as-is — a
 *    sealed row is one nobody can inspect afterwards to find out what went
 *    wrong.
 * 4. RECEIPT_CONSENT_V (senders.mjs) equals the client's FH_CONSENT_V — the
 *    worker's fetch gate and the sheet people agree to must name the same
 *    version, or consent recorded under one number gates a query built
 *    against another.
 */
const fs = require('fs');
const path = require('path');
const HERE = path.join(__dirname, '') + path.sep;

let failed = 0;
function t(name, ok, extra) {
  if (ok) console.log('  PASS  ' + name);
  else { failed++; console.log('  FAIL  ' + name + (extra !== undefined ? '  -> ' + JSON.stringify(extra) : '')); }
}

(async () => {
  const C = await import('../supabase/functions/_shared/mailbox/contract.mjs');
  const S = await import('../supabase/functions/_shared/mailbox/stage.mjs');
  const SN = await import('../supabase/functions/_shared/mailbox/senders.mjs');

  console.log('-- the receipt block --');
  const field = C.RAW_FIELDS.find((f) => f.key === 'receipt');
  t('receipt is an obj block with the spec §9 keys',
    JSON.stringify(field.keys) === JSON.stringify(
      ['service_type', 'order_id', 'seller', 'items', 'items_total', 'discount', 'shipping_fee', 'paid', 'paid_with_tail']),
    field.keys);
  t('items is declared an array of pruned elements (Phase 2 adds node + sig)',
    JSON.stringify(field.arrays && field.arrays.items) === JSON.stringify(
      ['name', 'qty', 'unit_price', 'line_discount', 'variant', 'node', 'sig']),
    field.arrays);
  t('line_items (the pre-build reserved name) is gone for good',
    field.keys.indexOf('line_items') === -1);

  console.log('\n-- the seal prunes items element-by-element --');
  const seal = (receipt) => S.buildPayload({
    reading: { raw: S.carryRaw({ receipt }, {}), amount: 681700, direction: 'debit' },
    senderKind: 'receipt', readerV: 2,
  }).raw_extracted.receipt;

  const sealed = seal({
    service_type: 'goods', order_id: '2609262Y4DUK5U', seller: 'olanevietnam',
    items: [
      { name: 'Swimming Goggles OLANE 503M', qty: 1, unit_price: 607700,
        delivery_address: '443/119a, Lê Văn Sỹ', phone: '84904911217' },
      { name: 'Mũ Bơi Olane Cherry', qty: 1, unit_price: 234000, variant: 'Cherry' },
    ],
    items_total: 841700, discount: 160000, shipping_fee: 0,
    paid: 681700, paid_with_tail: '4751',
    address: '443/119a', // block level too
  });
  t('order-level fields ride', sealed && sealed.paid === 681700 && sealed.seller === 'olanevietnam', sealed);
  t('an address at block level cannot ride (no key for it)', sealed && !('address' in sealed));
  t('an address INSIDE an item cannot ride either',
    sealed && sealed.items.every((it) => !('delivery_address' in it) && !('phone' in it)), sealed && sealed.items);
  t('the ladder\'s node and signature ride inside the item',
    (() => { const r = seal({ paid: 1, items: [{ name: 'a', node: 'sportsgear', sig: 'hn|mu boi', address: 'x' }] });
      return r.items[0].node === 'sportsgear' && r.items[0].sig === 'hn|mu boi' && !('address' in r.items[0]); })());
  t('listed item keys survive the prune',
    sealed && sealed.items[0].name === 'Swimming Goggles OLANE 503M'
      && sealed.items[1].variant === 'Cherry' && sealed.items[0].unit_price === 607700);
  t('an unlisted-only item element drops; the rest keep their order',
    (() => { const r = seal({ paid: 1, items: [{ junk: 1 }, { name: 'a' }] }); return r.items.length === 1 && r.items[0].name === 'a'; })());
  t('items as a string seals as null, never as-is',
    seal({ paid: 1, items: 'zq-items' }).items === null);
  t('items as an empty array seals as null (no half-filled blocks)',
    seal({ paid: 1, items: [] }).items === null);
  t('a receipt with only unridable content seals as null, not {}', seal({ address: 'x' }) === null);

  console.log('\n-- the consent coupling --');
  const clientSrc = fs.readFileSync(HERE + '../src/js-data/75-consent-ui.js', 'utf8');
  const m = /var FH_CONSENT_V = (\d+);/.exec(clientSrc);
  t('RECEIPT_CONSENT_V equals the client\'s FH_CONSENT_V',
    !!m && Number(m[1]) === SN.RECEIPT_CONSENT_V, { client: m && m[1], senders: SN.RECEIPT_CONSENT_V });
  t('the v6 change entry names the annotate-only rule',
    /không bao giờ tự tạo giao dịch mới/.test(clientSrc));
  t('inboxQuery still does NOT fetch receipt domains (that is L2, gated)',
    (() => { const q = SN.inboxQuery(2);
      // shopeepay.vn (a wallet) legitimately matches /shopee/, so test the
      // receipt-only domains that share no wallet sibling.
      return !/(apple\.com|grab\.com|tiki\.vn|lazada\.vn|foody\.vn)/.test(q); })());

  if (failed) { console.log('\n' + failed + ' FAILED'); process.exit(1); }
  console.log('\nall passed');
})();
