/**
 * Receipt reading — a merchant's own account of a purchase, read to ANNOTATE
 * the bank/wallet transaction the pipeline captures separately, never to
 * become one (receipt-enrichment-spec.md §10.2).
 *
 * Routed here by extract.mjs when the sender's class is 'receipt'
 * (senders.mjs RECEIPTS). The shape mirrors the transaction cascade one tier
 * shorter: a hand-written per-provider reader first (Shopee, Apple, Grab —
 * free, local, per mail), else the model once per (sender, subject shape) per
 * build with the receipt prompt block, else parked. There is no template or
 * label-map learning for receipts in this landing: item lists are repeated
 * groups a fixed-anchor template cannot express, so the unseeded providers
 * (Tiki, Lazada, ShopeeFood, Foody) launch on the model-once path and earn a
 * hand-written reader from observed mail (spec Part 3, L6).
 *
 * What a reading is: the §9 receipt block plus the few transaction fields a
 * staged row needs — `amount` IS `receipt.paid` (the join key: the figure
 * that hit the instrument, after every voucher), direction is always debit,
 * the counterparty is the seller. Grab is read MINIMALLY by construction:
 * its reader never emits items, because Grab mail carries home addresses and
 * the address rule is structural, not prompt-deep (spec §5).
 *
 * Outcomes match readTransaction's contract exactly, so the worker's parking,
 * junk-caching and failure handling need no receipt-specific branch:
 *   { ok: true, extraction, stage: 'receipt' | 'receipt_model' }
 *   { ok: false, reason: 'not_a_transaction' }      campaign mail; cached
 *   { ok: false, reason: 'format_cap' }             model already read this shape on this build
 *   { ok: false, reason: 'unreadable', detail }     a receipt with no paid total
 *   throws LlmUnavailable                           budget/quota — the worker parks the message
 */

import * as llm from './llm.mjs';
import { SENDER_JUNK_THRESHOLD, SENDER_SENTINEL } from './extract.mjs';

/* ── small parsers ───────────────────────────────────────────────────────── */

/** "₫607,700" | "607.700đ" | "49.000 đ" | "337.900" → 607700 … as a number.
 *  Returns null rather than 0: a zero amount and an unreadable one must not
 *  collapse (shipping_fee legitimately parses to 0 via amt0 below). */
function amt(s) {
  if (s == null) return null;
  const m = String(s).replace(/[₫đ\s]/gi, '').match(/^-?[\d.,]+$/);
  if (!m) return null;
  const n = Number(m[0].replace(/[.,](?=\d{3}(\D|$))/g, '').replace(',', '.'));
  return Number.isFinite(n) && n > 0 ? n : null;
}
/** Like amt, but 0 is a real answer ("Phí vận chuyển: ₫0"). */
function amt0(s) {
  if (s == null) return null;
  const m = String(s).replace(/[₫đ\s]/gi, '').match(/^-?[\d.,]+$/);
  if (!m) return null;
  const n = Number(m[0].replace(/[.,](?=\d{3}(\D|$))/g, '').replace(',', '.'));
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/** One labelled row's value out of plain text: "Label: value" or the next line. */
function labelled(text, re) {
  const m = text.match(re);
  return m ? String(m[1]).trim() : null;
}

/** VN date forms receipts print: "26/09/2026 13:09:14", "26 Th09 2026
 *  13:09:20", "26 Th 9 2026", "28 Sep 2026". → { iso, precision } or null.
 *  VN mail states no offset; +07:00 is the sender's local, as everywhere. */
const _EN_MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
export function receiptWhen(s) {
  if (!s) return null;
  const t = String(s).trim();
  let d = null, mo = null, y = null;
  let m = t.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
  if (m) { d = +m[1]; mo = +m[2]; y = +m[3]; }
  if (!y) {
    m = t.match(/(\d{1,2})\s*Th\s*0?(\d{1,2})\s*(\d{4})/i);           // "26 Th09 2026", "26 Th 9 2026"
    if (m) { d = +m[1]; mo = +m[2]; y = +m[3]; }
  }
  if (!y) {
    m = t.match(/(\d{1,2})\s+([A-Za-z]{3,9})\s+(\d{4})/);             // "28 Sep 2026"
    if (m && _EN_MONTHS[m[2].slice(0, 3).toLowerCase()]) { d = +m[1]; mo = _EN_MONTHS[m[2].slice(0, 3).toLowerCase()]; y = +m[3]; }
  }
  if (!y || !mo || !d || mo > 12 || d > 31) return null;
  const tm = t.match(/(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  const p2 = (n) => String(n).padStart(2, '0');
  const time = tm ? p2(+tm[1]) + ':' + tm[2] + ':' + (tm[3] || '00') : '00:00:00';
  return {
    iso: y + '-' + p2(mo) + '-' + p2(d) + 'T' + time + '+07:00',
    precision: tm ? (tm[3] ? 'second' : 'minute') : 'day',
  };
}

/** The paying card's last four, from "MasterCard .... 4751" / "VISA ••5913"
 *  / "478466******5913" — never a full PAN. */
function cardTail(text) {
  const m = String(text || '').match(/(?:mastercard|visa|jcb|amex|card|thẻ)[^\n\d]{0,24}(?:[.•*x#]\s*){2,}(\d{4})(?!\d)/i)
    || String(text || '').match(/\d{6}[•*x#]{4,}(\d{4})(?!\d)/);
  return m ? m[1] : null;
}

/* ── the hand-written readers ────────────────────────────────────────────── */

/** Shopee (and the ShopeeFood/Foody order layout, when it matches): order
 *  confirmations print numbered item blocks over a small labelled vocabulary.
 *  Null unless a paid total is found — a receipt with no paid figure cannot
 *  join anything and the model gets its turn. */
export function readShopeeReceipt(text) {
  const t = String(text || '');
  if (!/đơn hàng/i.test(t)) return null;
  const paid = amt(labelled(t, /(?:Tổng thanh toán|Số tiền thanh toán)\s*:?[\t ]*([₫đ\d.,\s]+)/i));
  if (!paid) return null;

  const orderId = labelled(t, /Mã đơn hàng\s*:?[\t ]*#?([A-Z0-9]{6,})/i);
  const seller = labelled(t, /Người bán\s*:?[\t ]*([^\n]{2,60})/i);
  const itemsTotal = amt(labelled(t, /Tổng tiền\s*:?[\t ]*([₫đ\d.,\s]+)/i));
  const ship = amt0(labelled(t, /Phí vận chuyển\s*:?[\t ]*([₫đ\d.,\s]+)/i));
  // Voucher rows carry amounts; "Mã giảm giá" is a code, not money. Summed:
  // an order can stack a platform voucher and a shop voucher.
  let discount = 0;
  for (const m of t.matchAll(/Voucher[^\n:]*:?[\t ]*([₫đ][\d.,\s]+|[\d.,]+\s*[₫đ])/gi)) {
    discount += amt(m[1]) || 0;
  }
  if (!discount && itemsTotal && itemsTotal > paid) discount = itemsTotal - paid - (ship || 0);
  const when = receiptWhen(labelled(t, /Ngày thanh toán\s*:?[\t ]*([^\n]+)/i))
    || receiptWhen(labelled(t, /Ngày đặt hàng\s*:?[\t ]*([^\n]+)/i));

  /* Item blocks: "1. <name…>" then labelled rows until the next block or the
     totals. The name may wrap; label lines end it. */
  const items = [];
  const lines = t.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const start = lines[i].match(/^\s*(\d{1,2})\.\s+(\S.{2,})/);
    if (!start) continue;
    let name = start[2].trim();
    let qty = null, unit = null, variant = null;
    for (let j = i + 1; j < lines.length; j++) {
      const ln = lines[j];
      if (/^\s*\d{1,2}\.\s+\S/.test(ln) || /Tổng tiền|Tổng thanh toán/i.test(ln)) { i = j - 1; break; }
      const q = ln.match(/Số lượng\s*:?[\t ]*(\d+)/i);
      const g = ln.match(/Giá\s*:?[\t ]*([₫đ\d.,\s]+)/i);
      const v = ln.match(/(?:Mẫu mã|Phân loại)\s*:?[\t ]*([^\n]{1,60})/i);
      if (q) qty = +q[1];
      else if (g) unit = amt(g[1]);
      else if (v) variant = v[1].trim();
      else if (!qty && !unit && !variant && ln.trim() && !/:/.test(ln)) name += ' ' + ln.trim();
      i = j;
    }
    items.push({ name: name.slice(0, 200), qty, unit_price: unit, line_discount: null, variant });
  }

  return {
    service_type: 'goods', order_id: orderId, seller,
    items: items.length ? items : null,
    items_total: itemsTotal, discount: discount || null, shipping_fee: ship,
    paid, paid_with_tail: cardTail(t), _when: when,
  };
}

/** Apple receipts ("Your receipt from Apple / Hóa đơn"): a TOTAL, an order
 *  id, the billed card's tail, and item lines whose price ends the line. */
export function readAppleReceipt(text, subject) {
  const t = String(text || '');
  if (!/receipt|h[oó]a đơn/i.test(String(subject || '') + ' ' + t.slice(0, 400))) return null;
  const paid = amt(labelled(t, /(?:TOTAL|TỔNG|Tổng cộng)\s*:?[\t ]*\n?\s*([₫đ\d.,\s]+)/i));
  if (!paid) return null;
  const orderId = labelled(t, /ORDER ID\s*:?[\t ]*\n?\s*([A-Z0-9]{6,})/i)
    || labelled(t, /Mã đơn hàng\s*:?[\t ]*\n?\s*([A-Z0-9]{6,})/i)
    || labelled(t, /DOCUMENT NO\.?\s*:?[\t ]*\n?\s*(\d{6,})/i);
  const when = receiptWhen(labelled(t, /(?:INVOICE DATE|Ngày h[oó]a đơn)\s*:?[\t ]*\n?\s*([^\n]+)/i));

  /* Item lines: a name with its price at the end of the line. Label rows
     (TOTAL, dates, card) never match: their values are not line-final prices
     or their text is a known label. */
  const items = [];
  for (const ln of t.split('\n')) {
    const m = ln.match(/^\s*(\S.{2,80}?)\s+([\d.,]+\s?[₫đ])\s*$/);
    if (!m) continue;
    if (/TOTAL|TỔNG|INVOICE|ORDER|DOCUMENT|VAT|Subtotal/i.test(m[1])) continue;
    const price = amt(m[2]);
    if (price == null) continue;
    items.push({ name: m[1].trim(), qty: null, unit_price: price, line_discount: null, variant: null });
  }
  return {
    service_type: 'digital', order_id: orderId, seller: null,
    items: items.length ? items : null,
    items_total: null, discount: null, shipping_fee: null,
    paid, paid_with_tail: cardTail(t), _when: when,
  };
}

/** Grab, MINIMAL BY CONSTRUCTION (spec §5): service, total, time, paid-with
 *  tail, booking id. Never items — Grab mail carries home addresses, and this
 *  reader has no code path that could emit one. */
export function readGrabReceipt(text, subject) {
  const t = String(text || '');
  if (!/e-?receipt|grab/i.test(String(subject || '') + ' ' + t.slice(0, 200))) return null;
  const paid = amt(labelled(t, /(?:TOTAL|Tổng cộng|Tổng thanh toán)\s*(?:\(VND\))?\s*:?[\t ]*\n?\s*([₫đ\d.,\s]+)/i));
  if (!paid) return null;
  const booking = labelled(t, /(?:Booking ID|Mã chuyến)\s*:?[\t ]*\n?\s*([A-Z]{1,4}-?[A-Z0-9-]{6,})/i);
  const food = /grabfood|đơn hàng|delivery/i.test(t);
  const when = receiptWhen(labelled(t, /(\d{1,2}[\/\-\s](?:Th\s*0?\d{1,2}|[A-Za-z]{3,9}|\d{1,2})[\/\-\s]\d{4}[^\n]*)/));
  return {
    service_type: food ? 'food' : 'ride', order_id: booking, seller: null,
    items: null, items_total: null, discount: null, shipping_fee: null,
    paid, paid_with_tail: cardTail(t), _when: when,
  };
}

const _READERS = {
  Shopee: (m) => readShopeeReceipt(m.body),
  ShopeeFood: (m) => readShopeeReceipt(m.body),
  Foody: (m) => readShopeeReceipt(m.body),
  Apple: (m) => readAppleReceipt(m.body, m.subject),
  Grab: (m) => readGrabReceipt(m.body, m.subject),
};

/* ── an extraction the staging path can carry ────────────────────────────── */

function _extraction(rc, provider) {
  const when = rc._when || null;
  const receipt = { ...rc };
  delete receipt._when;
  return {
    is_transaction: true,
    amount: rc.paid, amount_raw: null, currency: 'VND', direction: 'debit',
    occurred_at: when ? when.iso : null,
    time_precision: when ? when.precision : null,
    counterparty: rc.seller || provider, counterparty_kind: 'merchant',
    memo: null, memo_display: null,
    reference_number: rc.order_id || null,
    transaction_type: 'ecommerce_receipt', signal: 'purchase',
    source_provider: provider,
    receipt,
    src: { amount: 'printed', receipt: 'printed' },
  };
}

/* ── the orchestrator extract.mjs calls ──────────────────────────────────── */

/**
 * @param message  { from, subject, body, … } — the same object readTransaction gets
 * @param db       the fingerprint/tally surface (possibly the warm write-through)
 * @param o        { provider, sender, template, fp, build, budget, llm, fetch }
 */
export async function readReceiptMail(message, db, o) {
  const det = _READERS[o.provider] ? _READERS[o.provider](message) : null;
  if (det) {
    /* The shape is a confirmed source — which is what keeps the sender-wide
       junk sentinel off a real receipt sender (`txn === 0` guard). Written
       once per shape, not per mail. */
    if (!(o.fp && o.fp.is_transaction_source === true)) {
      await db.saveFingerprint({
        sender_address: o.sender, subject_template: o.template,
        is_transaction_source: true, transaction_type: 'ecommerce_receipt', extraction_regex: null,
      });
    }
    await db.bumpReadTally?.('receipt_read');
    return { ok: true, extraction: _extraction(det, o.provider), stage: 'receipt', tier: 'seed' };
  }

  /* ONE MODEL READ PER SHAPE PER BUILD — the same cap and the same consent
     arithmetic as the transaction cascade (extract.mjs). Receipts learn no
     template, so without this every Tiki order would pay a model call. */
  if (o.build && o.fp && !o.fp._sender_wide && o.fp.is_transaction_source === true
      && Number(o.fp.model_reads) >= 1 && o.fp.model_read_build === o.build) {
    await db.bumpReadTally?.('format_cap');
    return { ok: false, reason: 'format_cap' };
  }

  if (o.budget && !(await o.budget.spend())) {
    throw new llm.LlmUnavailable('call budget exhausted for this run');
  }
  const modelRead = o.build
    ? { model_reads: (Number(o.fp && !o.fp._sender_wide && o.fp.model_reads) || 0) + 1, model_read_build: o.build }
    : {};

  const x = await llm.extract(o.sender, message.subject, message.body, o.llm, o.fetch, 'receipt');

  if (!x || x.is_transaction !== true) {
    // Campaign mail that slipped the subject filter: cached per shape, and the
    // sender-wide sentinel question is asked exactly as the cascade asks it.
    await db.saveFingerprint({
      sender_address: o.sender, subject_template: o.template,
      is_transaction_source: false, transaction_type: null, extraction_regex: null,
    });
    if (db.senderTally) {
      try {
        const tally = await db.senderTally(o.sender);
        if (tally.txn === 0 && tally.junk >= SENDER_JUNK_THRESHOLD) {
          await db.saveFingerprint({
            sender_address: o.sender, subject_template: SENDER_SENTINEL,
            is_transaction_source: false, transaction_type: null, extraction_regex: null,
          });
        }
      } catch (e) { /* the read stands regardless */ }
    }
    await db.bumpReadTally?.('llm_junk');
    return { ok: false, reason: 'not_a_transaction' };
  }

  const rc = (x.receipt && typeof x.receipt === 'object') ? x.receipt : {};
  const paid = Number(rc.paid ?? x.amount);
  if (!(Number.isFinite(paid) && paid > 0)) {
    // A receipt with no paid figure cannot join anything. Not cached as junk —
    // the next mail of the shape may be complete — but the read is counted on
    // a known source, exactly like the cascade's unreadable branch.
    await db.bumpReadTally?.('unreadable');
    if (o.build && o.fp && !o.fp._sender_wide && o.fp.is_transaction_source === true) {
      await db.saveFingerprint({
        sender_address: o.sender, subject_template: o.template,
        is_transaction_source: true, transaction_type: 'ecommerce_receipt', extraction_regex: null, ...modelRead,
      });
    }
    return { ok: false, reason: 'unreadable', detail: 'receipt with no paid total' };
  }

  const when = receiptWhen(x.occurred_at || '') || null;
  const extraction = _extraction({
    service_type: rc.service_type ?? null, order_id: rc.order_id ?? null, seller: rc.seller ?? null,
    // Grab stays minimal even when the model answers: structural, not prompt-deep.
    items: o.provider === 'Grab' ? null : (Array.isArray(rc.items) && rc.items.length ? rc.items : null),
    items_total: rc.items_total ?? null, discount: rc.discount ?? null, shipping_fee: rc.shipping_fee ?? null,
    paid, paid_with_tail: rc.paid_with_tail ?? null,
    _when: when || (x.occurred_at ? { iso: x.occurred_at, precision: x.time_precision || null } : null),
  }, o.provider);
  extraction.src = { amount: 'model', receipt: 'model' };

  await db.saveFingerprint({
    sender_address: o.sender, subject_template: o.template,
    is_transaction_source: true, transaction_type: 'ecommerce_receipt', extraction_regex: null, ...modelRead,
  });
  await db.bumpReadTally?.('receipt_llm');
  return { ok: true, extraction, stage: 'receipt_model', tier: 'model' };
}
