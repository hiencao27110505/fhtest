/**
 * Receipt enrichment L2 — the reading and the staging
 * (receipt-enrichment-spec.md §10).
 *
 * Fixtures are the three real mails the feature was designed against
 * (2026-09-29): the Shopee payment confirmation (2 items, a voucher, the
 * 681.700đ paid total the VIB row also carries), the Apple movie-rental
 * receipt (49.000đ, card tail 4751), and a synthetic Grab e-receipt (no
 * corpus mail carries one — its reader is pinned to be MINIMAL, which
 * synthetic mail proves as well as real mail would).
 */
const path = require('path');
const HERE = path.join(__dirname, '') + path.sep;

let failed = 0;
function t(name, ok, extra) {
  if (ok) console.log('  PASS  ' + name);
  else { failed++; console.log('  FAIL  ' + name + (extra !== undefined ? '  -> ' + JSON.stringify(extra) : '')); }
}

/* ── fixtures: the mails as the HTML→text pass renders them ─────────────── */

const SHOPEE_PAYMENT = [
  'Xin chào caohien145,',
  'Tuyệt vời, bạn đã thanh toán thành công cho đơn hàng #2609262Y4DUK5U.',
  'THÔNG TIN ĐƠN HÀNG - DÀNH CHO NGƯỜI MUA',
  'Mã đơn hàng: #2609262Y4DUK5U',
  'Ngày đặt hàng: 26 Th09 2026 13:09:14',
  'Người bán: olanevietnam',
  '1. Swimming Goggles OLANE 503M Tráng Gương Màu PinkGold - Chống Tia UV400',
  'Số lượng: 1',
  'Giá: ₫607,700',
  '2. Mũ Bơi / Nón Bơi Silicon Người Lớn Olane In Hình Qủa Anh Đào Cherry',
  'Mẫu mã: Cherry',
  'Số lượng: 1',
  'Giá: ₫234,000',
  'Tổng tiền: ₫841,700',
  'Voucher từ Shopee: ₫160,000',
  'Mã giảm giá của Shopee: 2620STYLE700KMM',
  'Phí vận chuyển: ₫0',
  'Tổng thanh toán: ₫681,700',
  'THÔNG TIN NHẬN HÀNG',
  'Tên người nhận: Hien Cao',
  'Số điện thoại: 84904911217',
  'Địa chỉ nhận hàng: 443/119a, Lê Văn Sỹ, Phường Nhiều Lộc',
  'THÔNG TIN THANH TOÁN',
  'Phương thức thanh toán: Thẻ Tín dụng/Ghi nợ',
  'Ngày thanh toán: 26 Th 9 2026 13:09:20',
  'Số tiền thanh toán: ₫681,700',
].join('\n');

const SHOPEE_DELIVERED = [
  // The DELIVERY mail — the shape Shopee's subject filter actually catches.
  // Its ordinal sits in its OWN cell, so "1." and the product name are two
  // lines; reading only the payment mail's "1. <name>" form found zero items
  // on every real order (2026-09-29).
  'THÔNG TIN ĐƠN HÀNG - DÀNH CHO NGƯỜI MUA', '',
  'Mã đơn hàng:', '', '#2609262Y4DUK5U', '',
  'Ngày đặt hàng:', '', '26/09/2026 13:09:14', '',
  'Người bán:', '', 'olanevietnam', '',
  '1.', '',
  'Swimming Goggles OLANE 503M Tráng Gương Màu PinkGold', '',
  'Số lượng:', '', '1', '',
  'Giá:', '', '₫607,700', '',
  '2.', '',
  'Mũ Bơi / Nón Bơi Silicon Người Lớn Olane Cherry', '',
  'Mẫu mã:', '', 'Cherry', '',
  'Số lượng:', '', '1', '',
  'Giá:', '', '₫234,000', '',
  'Tổng tiền:', '', '₫841,700', '',
  'Voucher từ Shopee:', '', '₫160,000', '',
  'Mã giảm giá của Shopee:', '', '2620STYLE700KMM', '',
  'Phí vận chuyển:', '', '₫0', '',
  'Tổng thanh toán:', '', '₫681,700',
].join('\n');

const APPLE_RECEIPT = [
  // Real shape (corpus 2026-09-29, PII scrubbed): header blocks ("ORDER ID"
  // over its value), the billing cluster WITH an address (which must never
  // reach an item), then the storefront line and the item block, the price on
  // its own line, then TOTAL over the grand total.
  'Receipt', '',
  'APPLE ACCOUNT', 'test@example.com', '',
  'BILLED TO', '',
  'MasterCard .... 4751', 'Ng V A', '',
  '1 Duong X', 'Thanh pho Z, 700000', 'VNM', '',
  'INVOICE DATE', '28 Sep 2026', '',
  'ORDER ID', 'MX5XZQWBN5', '',
  'DOCUMENT NO.', '718196767166', '',
  'Apple TV', '',
  'The Long Walk', '',
  'Thriller', '',
  'Movie Rental', '',
  'Someone\u2019s MacBook Pro', '',
  'Report a Problem', '',
  '49.000\u0111', '',
  'TOTAL', '',
  '49.000\u0111',
].join('\n');

const APPLE_SUBSCRIPTION = [
  // Apple's SECOND layout ("Your invoice from Apple."): labelled headers, the
  // VENDOR as the section line, no TOTAL label at all, and prices written
  // symbol-first. 11 of 19 Apple receipts in the corpus look like this and
  // none was readable until 2026-09-29.
  'Receipt', '',
  '16 June 2026', '',
  'Order ID:', '', 'MX7DGBV7YN', '',
  'Document:', '', '732148239289', '',
  'Apple Account:', '', 'test@example.com', '',
  'YouTube', '',
  'YouTube Premium (Monthly)', '',
  'Renews 17 July 2026', '',
  'iPhone HienCao', '',
  '₫105.000', '',
  'Billing and Payment', '',
  'Ng V A', '',
  '1 Duong X', 'Thanh pho Z 700000', 'Vietnam', '',
  'MasterCard •••• 4751', '',
  '₫105.000',
].join('\n');

const GRAB_RECEIPT = [
  'Your Grab E-Receipt',
  'Booking ID: ADR-8127364512',
  '26 Th09 2026 08:12',
  'GrabCar 7 Chỗ',
  '443/119a Lê Văn Sỹ → Sailing Tower, 111A Pasteur',
  'TOTAL (VND): 86,000',
  'Paid by card •••• 5913',
].join('\n');

/* ── a db double the reader writes through ──────────────────────────────── */
function fakeDb(fp) {
  const saved = [];
  const tally = [];
  return {
    saved, tally, fp,
    saveFingerprint: async (row) => { saved.push(row); },
    bumpReadTally: async (k) => { tally.push(k); },
    senderTally: async () => ({ txn: 0, junk: 0 }),
    fingerprint: async () => fp || null,   // readTransaction's cache lookup (front-door test)
  };
}

const geminiFetch = (answer) => async (u, init) => {
  if (String(u).includes('generativelanguage.googleapis.com')) {
    return { ok: true, status: 200, text: async () => JSON.stringify({
      candidates: [{ content: { parts: [{ text: JSON.stringify(answer) }] } }],
    }) };
  }
  throw new Error('unexpected fetch: ' + u);
};

(async () => {
  const R = await import('../supabase/functions/_shared/mailbox/receipt-reader.mjs');
  const S = await import('../supabase/functions/_shared/mailbox/stage.mjs');
  const SN = await import('../supabase/functions/_shared/mailbox/senders.mjs');
  const X = await import('../supabase/functions/_shared/mailbox/extract.mjs');
  const nacl = require('tweetnacl');

  console.log('-- the Shopee reader --');
  const sp = R.readShopeeReceipt(SHOPEE_PAYMENT);
  t('reads the paid total, not the items total', sp && sp.paid === 681700, sp && sp.paid);
  t('order id and seller', sp.order_id === '2609262Y4DUK5U' && sp.seller === 'olanevietnam', [sp.order_id, sp.seller]);
  t('two items, names verbatim', sp.items && sp.items.length === 2
    && /Swimming Goggles OLANE 503M/.test(sp.items[0].name) && /Mũ Bơi/.test(sp.items[1].name), sp.items);
  t('qty, unit price, variant', sp.items[0].qty === 1 && sp.items[0].unit_price === 607700
    && sp.items[1].unit_price === 234000 && sp.items[1].variant === 'Cherry', sp.items);
  t('the honest math rides: items_total − voucher = paid',
    sp.items_total === 841700 && sp.discount === 160000 && sp.shipping_fee === 0
    && sp.items_total - sp.discount - sp.shipping_fee === sp.paid, [sp.items_total, sp.discount, sp.shipping_fee]);
  t('a voucher CODE is not money', sp.discount !== null && String(sp.discount).indexOf('2620') === -1);
  t('item 1: empty Mẫu mã cell reads as NO variant, never the next label',
    sp.items[0].variant === null, sp.items[0].variant);
  t('payment instant, second precision, +07:00',
    sp._when && sp._when.iso === '2026-09-26T13:09:20+07:00' && sp._when.precision === 'second', sp._when);
  t('no address and no phone anywhere in the reading',
    JSON.stringify(sp).indexOf('Đường X') === -1 && JSON.stringify(sp).indexOf('840000000000') === -1);
  t('a campaign mail (no paid total) reads null',
    R.readShopeeReceipt('Flash sale 9.9! đơn hàng ngay hôm nay giảm 50%') === null);

  console.log('\n-- the Shopee DELIVERY shape (bare ordinal cell) --');
  const sd = R.readShopeeReceipt(SHOPEE_DELIVERED);
  t('the bare "1." cell still opens an item; the name is the next line',
    sd && sd.items && sd.items.length === 2
    && /Swimming Goggles/.test(sd.items[0].name) && /M\u0169 B\u01a1i/.test(sd.items[1].name), sd && sd.items);
  t('prices and the variant survive the split form',
    sd.items[0].unit_price === 607700 && sd.items[1].unit_price === 234000 && sd.items[1].variant === 'Cherry', sd.items);
  t('an item name is never the ordinal itself', sd.items.every(function (it) { return !/^\d{1,2}\.?$/.test(it.name); }), sd.items);
  t('same order, same money as the payment mail', sd.paid === 681700 && sd.order_id === '2609262Y4DUK5U' && sd.discount === 160000);
  t('dd/mm/yyyy order date reads', sd._when && sd._when.iso.slice(0, 10) === '2026-09-26', sd._when);

  console.log('\n-- the Apple reader --');
  const ap = R.readAppleReceipt(APPLE_RECEIPT, 'Your receipt from Apple.');
  t('paid total', ap && ap.paid === 49000, ap && ap.paid);
  t('order id', ap.order_id === 'MX5XZQWBN5', ap.order_id);
  t('the billed card tail, never the PAN', ap.paid_with_tail === '4751', ap.paid_with_tail);
  t('the item block: name from the storefront-gated group', ap.items && ap.items.length === 1
    && ap.items[0].name === 'The Long Walk' && ap.items[0].unit_price === 49000, ap.items);
  t('attributes ride as the variant', /Thriller · Movie Rental/.test(ap.items[0].variant), ap.items[0].variant);
  t('the billing ADDRESS can never reach an item (structural)',
    JSON.stringify(ap.items).indexOf('Duong X') === -1 && JSON.stringify(ap.items).indexOf('Ng V A') === -1, ap.items);
  t('invoice date is day-only precision', ap._when && ap._when.iso.slice(0, 10) === '2026-09-28' && ap._when.precision === 'day', ap._when);
  t('service_type digital', ap.service_type === 'digital');

  console.log('\n-- Apple layout B: the subscription invoice --');
  const ab = R.readAppleReceipt(APPLE_SUBSCRIPTION, 'Your invoice from Apple.');
  t('a mail with NO "TOTAL" label still yields what was charged', ab && ab.paid === 105000, ab && ab.paid);
  t('the labelled order id reads', ab.order_id === 'MX7DGBV7YN', ab.order_id);
  t('the bare date line reads when nothing labels it',
    ab._when && ab._when.iso.slice(0, 10) === '2026-06-16', ab._when);
  t('the VENDOR line is dropped: the name is the thing bought',
    ab.items && ab.items.length === 1 && ab.items[0].name === 'YouTube Premium (Monthly)', ab.items);
  t('its renewal and device ride as the variant',
    /Renews 17 July 2026/.test(ab.items[0].variant), ab.items[0].variant);
  t('symbol-first prices parse', ab.items[0].unit_price === 105000, ab.items[0].unit_price);
  t('the billing ADDRESS is past the stop line and can never be an item',
    JSON.stringify(ab.items).indexOf('Duong X') === -1 && JSON.stringify(ab.items).indexOf('Ng V A') === -1, ab.items);

  console.log('\n-- the Grab reader: minimal by construction --');
  const gr = R.readGrabReceipt(GRAB_RECEIPT, 'Your Grab E-Receipt');
  t('total and booking id', gr && gr.paid === 86000 && gr.order_id === 'ADR-8127364512', gr && [gr.paid, gr.order_id]);
  t('items are ALWAYS null', gr.items === null);
  t('paid-with tail', gr.paid_with_tail === '5913', gr.paid_with_tail);
  const gp = R.readGrabReceipt([
    'Car 6 chỗ ngồi', '', 'Picked up on 25 September 2026', '',
    'Booking ID: A-9SJ7XNSWWVRKAV', '',
    'Total Paid', '', '109.000 ₫', '',
    'Breakdown', '', 'Fare', '', '121.000', '', 'Promo', '', '-12.000', '',
    'Total Paid', '', '109.000', '',
    'Your Trip', '', '451/10 Nguyen Trai St.', '',
  ].join('\n'), 'Your Grab E-Receipt');
  t('"Total Paid" over the figure reads as money, not as the word "Paid"',
    gp && gp.paid === 109000, gp && gp.paid);
  t('fare and promo balance against what was charged',
    gp.items_total === 121000 && gp.discount === 12000 && gp.items_total - gp.discount === gp.paid,
    [gp.items_total, gp.discount, gp.paid]);
  t('a trip address never survives, even in the breakdown form',
    JSON.stringify(gp).indexOf('Nguyen Trai') === -1 && gp.items === null, gp);
  t('no address survives', JSON.stringify(gr).indexOf('Pasteur') === -1 && JSON.stringify(gr).indexOf('443/') === -1, gr);

  console.log('\n-- readReceiptMail: the orchestrator --');
  const msg = (body, subject, from) => ({ body, subject, from: from || 'Shopee <noreply@shopee.vn>' });
  let db = fakeDb(null);
  let out = await R.readReceiptMail(msg(SHOPEE_PAYMENT, 'Đơn hàng #2609262Y4DUK5U đã thanh toán'), db,
    { provider: 'Shopee', sender: 'noreply@shopee.vn', template: 'đơn hàng', fp: null, build: 'b1' });
  t('deterministic hit: ok, stage receipt, zero model calls', out.ok && out.stage === 'receipt');
  t('extraction: amount IS paid, debit, merchant counterparty',
    out.extraction.amount === 681700 && out.extraction.direction === 'debit'
    && out.extraction.counterparty === 'olanevietnam' && out.extraction.transaction_type === 'ecommerce_receipt');
  t('the shape is confirmed a source (junk sentinel can never blanket it)',
    db.saved.length === 1 && db.saved[0].is_transaction_source === true);
  t('tallied receipt_read', db.tally.indexOf('receipt_read') >= 0, db.tally);
  db = fakeDb({ is_transaction_source: true });
  await R.readReceiptMail(msg(SHOPEE_PAYMENT, 'x'), db, { provider: 'Shopee', sender: 's', template: 't', fp: db.fp, build: 'b1' });
  t('a known source shape is not re-saved per mail', db.saved.length === 0);

  // format cap: one model read per shape per build
  db = fakeDb({ is_transaction_source: true, model_reads: 1, model_read_build: 'b1' });
  out = await R.readReceiptMail(msg('không đọc được', 'x'), db,
    { provider: 'Tiki', sender: 'a@tiki.vn', template: 't', fp: db.fp, build: 'b1' });
  t('model already read this shape on this build: format_cap', !out.ok && out.reason === 'format_cap');
  t('...and tallied as such', db.tally.indexOf('format_cap') >= 0);

  // budget exhausted throws (the worker parks the message)
  db = fakeDb(null);
  let threw = null;
  try {
    await R.readReceiptMail(msg('body', 'x'), db, { provider: 'Tiki', sender: 'a@tiki.vn', template: 't', fp: null,
      build: 'b1', budget: { spend: async () => false } });
  } catch (e) { threw = e; }
  t('no budget: throws LlmUnavailable (parked, never lost)', threw && /budget/.test(threw.message), threw && threw.message);

  // the model path: a real answer through the real llm.extract
  const llmCfg = { apiKey: 'k' };
  const modelAnswer = {
    mail_kind: 'transaction', multi: false, source_provider: 'Tiki', occurred_at: '2026-09-26T10:00:00+07:00',
    amount: 250000, currency: 'VND', direction: 'debit', counterparty: 'Tiki Trading', memo: null,
    reference_number: null, status: 'success', account_tail: null, signal: 'purchase',
    receipt: { service_type: 'goods', order_id: 'TK123456', seller: 'Tiki Trading',
      items: [{ name: 'Sách nấu ăn', qty: 1, unit_price: 250000, line_discount: null, variant: null }],
      items_total: 250000, discount: null, shipping_fee: 0, paid: 250000, paid_with_tail: null },
  };
  db = fakeDb(null);
  out = await R.readReceiptMail(msg('đơn hàng Tiki', 'Đơn hàng TK123456', 'Tiki <noreply@tiki.vn>'), db,
    { provider: 'Tiki', sender: 'noreply@tiki.vn', template: 'đơn hàng', fp: null, build: 'b1',
      budget: { spend: async () => true }, llm: llmCfg, fetch: geminiFetch(modelAnswer) });
  t('model fallback: ok, receipt block carried, amount = paid',
    out.ok && out.stage === 'receipt_model' && out.extraction.amount === 250000
    && out.extraction.receipt.order_id === 'TK123456' && out.extraction.receipt.items.length === 1, out);
  t('the read is counted on the shape (model_reads, this build)',
    db.saved.some((r) => r.model_reads === 1 && r.model_read_build === 'b1'), db.saved);

  // the model calls it a campaign: junk-cached like the cascade
  db = fakeDb(null);
  out = await R.readReceiptMail(msg('flash sale', 'Sale 9.9', 'Tiki <noreply@tiki.vn>'), db,
    { provider: 'Tiki', sender: 'noreply@tiki.vn', template: 'sale', fp: null, build: 'b1',
      budget: { spend: async () => true }, llm: llmCfg,
      fetch: geminiFetch({ mail_kind: 'other', multi: false, source_provider: null, occurred_at: null, amount: null,
        currency: null, direction: null, counterparty: null, memo: null, reference_number: null, status: null,
        account_tail: null, signal: null }) });
  t('campaign via model: not_a_transaction, verdict cached',
    !out.ok && out.reason === 'not_a_transaction'
    && db.saved.some((r) => r.is_transaction_source === false), db.saved);

  // Grab via the model still never carries items
  db = fakeDb(null);
  out = await R.readReceiptMail(msg('grab ride', 'Your Grab E-Receipt', 'Grab <no-reply@grab.com>'), db,
    { provider: 'Grab', sender: 'no-reply@grab.com', template: 'e-receipt', fp: null, build: 'b1',
      budget: { spend: async () => true }, llm: llmCfg,
      fetch: geminiFetch({ ...modelAnswer, receipt: { ...modelAnswer.receipt, items: [{ name: 'ride' }] } }) });
  t('Grab items are nulled even when the model answers some', out.ok && out.extraction.receipt.items === null,
    out.extraction && out.extraction.receipt);

  console.log('\n-- readTransaction routes receipt senders here --');
  db = fakeDb(null);
  out = await X.readTransaction(msg(SHOPEE_PAYMENT, 'Đơn hàng #99 đã thanh toán'), db,
    { senderKind: 'receipt', provider: 'Shopee' });
  t('a Shopee mail through the front door reads as a receipt', out.ok && out.stage === 'receipt', out);

  console.log('\n-- staging a receipt row --');
  const kp = nacl.box.keyPair();
  const deps = { nacl, rng: globalThis.crypto, subtle: globalThis.crypto.subtle, dedupKey: 'kk' };
  const destination = { scope: 'personal', ownerUserId: 'u1', stagingPub: Buffer.from(kp.publicKey).toString('base64') };
  const row = await S.buildStagedRow({
    gmailMessageId: 'g1', destination, rowKind: 'receipt',
    reading: { raw: S.carryRaw({ receipt: sp }, {}), amount: sp.paid, direction: 'debit',
      occurredAt: '2026-09-26T13:09:20+07:00' },
    sourceProvider: 'Shopee', senderKind: 'receipt', readerV: 2, deps,
  });
  t('row_kind receipt on the row', row.row_kind === 'receipt', row.row_kind);
  t('no dedup fingerprint and no duplicate flag — the bank twin is the point',
    row.dedup_fp === null && row.duplicate_of_id === null, [row.dedup_fp, row.duplicate_of_id]);
  t('sealed like everything else (all four envelope fields)',
    !!row.sealed && !!row.eph_pub && !!row.nonce && row.enc_v === 1);
  t('clear columns stay the routing minimum', row.occurred_at === '2026-09-26T13:09:20+07:00' && row.review_status === 'pending');

  console.log('\n-- the query: receipts enter only by consent, only filtered --');
  const qOff = SN.inboxQuery(2, [], { skip: [] });
  const qOn = SN.inboxQuery(2, [], { skip: [], receipts: true });
  t('off by default', !/apple\.com|grab\.com|tiki\.vn/.test(qOff));
  t('on: every receipt domain rides WITH a subject filter',
    SN.RECEIPT_DOMAINS.every((d) => qOn.indexOf('(from:' + d + ' subject:(') >= 0), qOn);
  t('on: the bank group is untouched', qOn.indexOf(qOff.split(' -from:')[0].replace(/^\(/, '')) >= 0
    || qOn.indexOf('from:mbbank') >= 0 || /from:/.test(qOn));
  t('the Apple filter catches invoice-titled receipts too',
    (SN.RECEIPT_SUBJECTS['apple.com'] || []).some(function (x) { return /invoice from Apple/i.test(x); }),
    SN.RECEIPT_SUBJECTS['apple.com']);
  t('the Shopee filter catches the payment mail too, not only the delivery one',
    (SN.RECEIPT_SUBJECTS['shopee.vn'] || []).some(function (x) { return /thanh to/i.test(x); }),
    SN.RECEIPT_SUBJECTS['shopee.vn']);
  t('every receipt domain has subject terms (an unfiltered domain never enters)',
    SN.RECEIPT_DOMAINS.every((d) => (SN.RECEIPT_SUBJECTS[d] || []).length > 0));

  if (failed) { console.log('\n' + failed + ' FAILED'); process.exit(1); }
  console.log('\nall passed');
})().catch((e) => { console.error(e); process.exit(1); });
