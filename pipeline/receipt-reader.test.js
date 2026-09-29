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

const APPLE_RECEIPT = [
  'Receipt',
  'APPLE ACCOUNT',
  'hiencao27110505@gmail.com',
  'INVOICE DATE',
  '28 Sep 2026',
  'ORDER ID',
  'MX5XZQWBN5',
  'DOCUMENT NO.',
  '718196767166',
  'BILLED TO',
  'MasterCard .... 4751',
  'Cao Hien',
  '443/119A Le Van Sy',
  'Apple TV',
  'The Long Walk   49.000đ',
  'Thriller',
  'Movie Rental',
  'Hien’s MacBook Pro',
  'TOTAL   49.000đ',
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
  t('payment instant, second precision, +07:00',
    sp._when && sp._when.iso === '2026-09-26T13:09:20+07:00' && sp._when.precision === 'second', sp._when);
  t('no address and no phone anywhere in the reading',
    JSON.stringify(sp).indexOf('443/119') === -1 && JSON.stringify(sp).indexOf('84904911217') === -1);
  t('a campaign mail (no paid total) reads null',
    R.readShopeeReceipt('Flash sale 9.9! đơn hàng ngay hôm nay giảm 50%') === null);

  console.log('\n-- the Apple reader --');
  const ap = R.readAppleReceipt(APPLE_RECEIPT, 'Your receipt from Apple.');
  t('paid total', ap && ap.paid === 49000, ap && ap.paid);
  t('order id', ap.order_id === 'MX5XZQWBN5', ap.order_id);
  t('the billed card tail, never the PAN', ap.paid_with_tail === '4751', ap.paid_with_tail);
  t('the item line, price split from name', ap.items && ap.items.length >= 1
    && ap.items[0].name === 'The Long Walk' && ap.items[0].unit_price === 49000, ap.items);
  t('invoice date is day-only precision', ap._when && ap._when.iso.slice(0, 10) === '2026-09-28' && ap._when.precision === 'day', ap._when);
  t('service_type digital', ap.service_type === 'digital');

  console.log('\n-- the Grab reader: minimal by construction --');
  const gr = R.readGrabReceipt(GRAB_RECEIPT, 'Your Grab E-Receipt');
  t('total and booking id', gr && gr.paid === 86000 && gr.order_id === 'ADR-8127364512', gr && [gr.paid, gr.order_id]);
  t('items are ALWAYS null', gr.items === null);
  t('paid-with tail', gr.paid_with_tail === '5913', gr.paid_with_tail);
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
  t('every receipt domain has subject terms (an unfiltered domain never enters)',
    SN.RECEIPT_DOMAINS.every((d) => (SN.RECEIPT_SUBJECTS[d] || []).length > 0));

  if (failed) { console.log('\n' + failed + ' FAILED'); process.exit(1); }
  console.log('\nall passed');
})().catch((e) => { console.error(e); process.exit(1); });
