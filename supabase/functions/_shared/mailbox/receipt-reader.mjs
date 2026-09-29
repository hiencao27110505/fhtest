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

/* ── label/value line scanning ────────────────────────────────────────────
   mailtext.mjs turns every table cell into its own LINE, so in the real
   rendering a label and its value are neighbours, not one line: "Người bán:"
   then a blank, then "olanevietnam". (The first cut of these readers assumed
   same-line labels, matched nothing on real mail, and every receipt silently
   fell to the model — order-level only. Ground truth: the 2026-09-29 corpus
   pull, tools/pull-mail-corpus.mjs.) */
const _LABEL_RE = /^[A-Za-z\u00c0-\u1ef9\u0110\u0111 .\/&()\-]{2,40}:$/;
function _lines(text) {
  return String(text || '').split('\n').map((l) => l.trim());
}
/** The value of "Label:" at line i: same-line remainder, else the next
 *  non-empty line — unless that line is itself a label (an EMPTY cell:
 *  Shopee prints "Mẫu mã:" with nothing under it on variant-less items). */
function _valAt(lines, i, label) {
  const rest = lines[i].slice(label.length).trim();
  if (rest) return rest;
  for (let j = i + 1; j < lines.length && j <= i + 3; j++) {
    if (!lines[j]) continue;
    if (_LABEL_RE.test(lines[j])) return null;
    return lines[j];
  }
  return null;
}
function _findVal(lines, re) {
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(re);
    if (m) return _valAt(lines, i, m[0]);
  }
  return null;
}
/** Trailing punctuation a link cell leaves behind: "olanevietnam ." */
function _tidyStr(s) {
  const t = String(s || '').replace(/[\s.·|\u2022-]+$/, '').trim();
  return t || null;
}

/** Shopee (and the ShopeeFood/Foody order layout, when it matches): every
 *  field is a labelled cell; items open with "N. <name>" on one line and
 *  carry their own Mẫu mã / Số lượng / Giá labels below. Null unless a paid
 *  total is found — a receipt with no paid figure cannot join anything. */
export function readShopeeReceipt(text) {
  const t = String(text || '');
  if (!/\u0111\u01a1n h\u00e0ng/i.test(t)) return null;
  const lines = _lines(t);
  const paid = amt(_findVal(lines, /^(?:T\u1ed5ng thanh to\u00e1n|S\u1ed1 ti\u1ec1n thanh to\u00e1n):/i));
  if (!paid) return null;

  const orderId = (() => {
    const v = _findVal(lines, /^M\u00e3 \u0111\u01a1n h\u00e0ng:/i);
    const m = v && v.match(/#?([A-Z0-9]{6,})/);
    return m ? m[1] : null;
  })();
  const seller = _tidyStr(_findVal(lines, /^Ng\u01b0\u1eddi b\u00e1n:/i));
  const itemsTotal = amt(_findVal(lines, /^T\u1ed5ng ti\u1ec1n:/i));
  const ship = amt0(_findVal(lines, /^Ph\u00ed v\u1eadn chuy\u1ec3n:/i));
  // Voucher labels carry amounts; "Mã giảm giá" carries a CODE. Summed: an
  // order can stack a platform voucher and a shop voucher.
  let discount = 0;
  for (let i = 0; i < lines.length; i++) {
    if (/^Voucher[^:]*:/i.test(lines[i])) discount += amt(_valAt(lines, i, lines[i].match(/^Voucher[^:]*:/i)[0])) || 0;
  }
  if (!discount && itemsTotal && itemsTotal > paid) discount = itemsTotal - paid - (ship || 0);
  const when = receiptWhen(_findVal(lines, /^Ng\u00e0y thanh to\u00e1n:/i))
    || receiptWhen(_findVal(lines, /^Ng\u00e0y \u0111\u1eb7t h\u00e0ng:/i));

  /* Items: "N. <name…>" opens one; its labels follow until the next item or
     the totals. The name can wrap onto plain lines before the first label. */
  const items = [];
  let cur = null;
  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i];
    if (/^T\u1ed5ng ti\u1ec1n:/i.test(ln)) break;
    /* An item opens with its ordinal. TWO shapes, and the one that matters
       most is the second: the PAYMENT mail prints "1. <name>" on one line,
       while the DELIVERY mail — the one Shopee's subject filter actually
       catches — puts "1." in its own table cell, so the name is the next
       line. Reading only the first shape found zero items on every real
       order (2026-09-29). */
    const startSame = ln.match(/^(\d{1,2})\.\s+(\S.{2,})/);
    const startBare = !startSame && /^(\d{1,2})\.$/.test(ln);
    if (startSame || startBare) {
      let name = startSame ? startSame[2].trim() : null;
      if (startBare) {
        for (let j = i + 1; j < lines.length && j <= i + 4; j++) {
          if (!lines[j]) continue;
          if (_LABEL_RE.test(lines[j])) break;          // an empty ordinal cell: no name to take
          name = lines[j].trim();
          i = j;
          break;
        }
      }
      if (!name) continue;
      cur = { name: name.slice(0, 200), qty: null, unit_price: null, line_discount: null, variant: null };
      items.push(cur);
      continue;
    }
    if (!cur || !ln) continue;
    if (/^M\u1eabu m\u00e3:|^Ph\u00e2n lo\u1ea1i:/i.test(ln)) cur.variant = _tidyStr(_valAt(lines, i, ln.match(/^[^:]+:/)[0]));
    else if (/^S\u1ed1 l\u01b0\u1ee3ng:/i.test(ln)) { const v = _valAt(lines, i, 'S\u1ed1 l\u01b0\u1ee3ng:'); cur.qty = v && /^\d+$/.test(v) ? +v : cur.qty; }
    else if (/^Gi\u00e1:/i.test(ln)) cur.unit_price = amt(_valAt(lines, i, 'Gi\u00e1:'));
    else if (!_LABEL_RE.test(ln) && cur.qty == null && cur.unit_price == null && cur.variant == null
             && !/^\u20ab|^\d/.test(ln)) cur.name = (cur.name + ' ' + ln).slice(0, 200);
  }

  return {
    service_type: 'goods', order_id: orderId, seller,
    items: items.length ? items : null,
    items_total: itemsTotal, discount: discount || null, shipping_fee: ship,
    paid, paid_with_tail: cardTail(t), _when: when,
  };
}

/** Apple sends TWO layouts under three subject lines ("Your receipt from
 *  Apple.", "Your invoice from Apple.", the Vietnamese "hoá đơn"), and both
 *  are real receipts:
 *
 *    A — the purchase receipt. Unlabelled header blocks ("ORDER ID" over its
 *        value), a storefront line ("Apple TV"), then per item a name, its
 *        attribute lines, "Report a Problem", and the price; closed by
 *        "TOTAL" over the grand total. Prices read "49.000đ".
 *    B — the subscription invoice. Labelled headers ("Order ID:" over its
 *        value), the VENDOR as the section line ("YouTube"), one item with
 *        its renewal date and device, and NO "TOTAL" label at all — the
 *        charged figure is simply the last price, printed after the card.
 *        Prices read "₫105.000", symbol first.
 *
 *  Reading only A missed every invoice-titled mail (11 of 19 Apple receipts
 *  in the 2026-09-29 corpus). One walk now covers both: groups end at a
 *  price, header matter resets the group, and a leading vendor/storefront
 *  line is dropped so the NAME is the thing bought. The attributes ride as
 *  the variant — they are the insight ("Drama · Movie Rental").
 *
 *  The billing address can never reach an item: in A it sits between two
 *  reset lines with no price after it, and in B it is past the stop line. */
const _APPLE_STORES = /^(Apple TV|App Store|iTunes Store|Apple Music|Apple Books|Apple Arcade|Apple One|Apple Fitness\+?|iCloud\+?|Apple Podcasts|Apple News\+?)$/i;
/* Lines that are header furniture, not item text. A group is cleared at each
   one, so nothing above an item can ride into it. */
const _APPLE_RESET = /^(APPLE ACCOUNT|BILLED TO|BILLING AND PAYMENT|ORDER ID|DOCUMENT NO\.?|DOCUMENT|INVOICE DATE|RECEIPT|INVOICE|H[OÓó]A ĐƠN)$/i;

/** A standalone price cell, either way round: "49.000đ" or "₫105.000". */
function _applePrice(ln) {
  let m = ln.match(/^([\d.,]+)\s?[đ₫]$/);
  if (!m) m = ln.match(/^[đ₫]\s?([\d.,]+)$/);
  return m ? amt(m[1]) : null;
}

/* The content kinds Apple prints as an attribute line — the half of a
   layout-A signature that says WHAT KIND of thing was bought. */
const _APPLE_KINDS = /^(movie rental|movie|film|tv season|tv show|season pass|subscription|in-app purchase|app|game|book|audiobook|song|album|storage plan|icloud\+?)$/i;

/** One item out of the lines that preceded a price. The signature it is
 *  learned under (spec §20.2) rides on the item: `apple|<storefront>|<kind>`
 *  for a purchase receipt, `apple|vendor|<vendor>` for a subscription
 *  invoice, null when neither leads the group. */
function _appleItem(group, price, items, sectionStore) {
  let g = group.filter(function (x) {
    return !/^Report a Problem/i.test(x) && !/^B\u00e1o c\u00e1o/i.test(x) && !/^\d{6,}$/.test(x);
  });
  /* Drop a leading SECTION line: a known Apple storefront, or the vendor name
     repeated above its own product ("YouTube" over "YouTube Premium
     (Monthly)"). What is bought is the name; the shop is not — but the shop
     IS the signature. */
  let store = sectionStore || null, vendor = null;   // the section's storefront names every item under it
  while (g.length > 1 && (_APPLE_STORES.test(g[0])
         || (g[0].length <= 30 && g[1].toLowerCase().indexOf(g[0].toLowerCase()) === 0))) {
    if (_APPLE_STORES.test(g[0])) store = g[0]; else vendor = g[0];
    g = g.slice(1);
  }
  if (!g.length) return;
  const attrs = g.slice(1);
  const kind = attrs.find(function (x) { return _APPLE_KINDS.test(x.trim()); }) || null;
  const norm = function (x) { return String(x).toLowerCase().replace(/\s+/g, ' ').trim(); };
  const sig = store ? ('apple|' + norm(store) + '|' + (kind ? norm(kind) : 'item'))
    : vendor ? ('apple|vendor|' + norm(vendor)) : null;
  items.push({ name: g[0].slice(0, 200), qty: null, unit_price: price, line_discount: null,
    variant: attrs.length ? attrs.join(' \u00b7 ').slice(0, 80) : null, sig });
}

export function readAppleReceipt(text, subject) {
  const t = String(text || '');
  if (!/receipt|invoice|h[oó]a đơn/i.test(String(subject || '') + ' ' + t.slice(0, 400))) return null;
  const lines = _lines(t);

  /* Where the items stop: the TOTAL label (A) or the billing block (B). */
  const totalAt = lines.findIndex(function (ln) { return /^(TOTAL|TỔNG|Tổng cộng)$/i.test(ln); });
  const billAt = lines.findIndex(function (ln) { return /^(Billing and Payment|Thanh toán)\b/i.test(ln); });
  let stop = totalAt >= 0 ? totalAt : billAt;
  if (stop < 0) stop = lines.length;

  /* What was charged. After a TOTAL label it is the next price; with no such
     label (B) it is the LAST price in the mail — the figure printed under the
     card, after every line item. */
  let paid = null;
  if (totalAt >= 0) {
    for (let j = totalAt + 1; j < lines.length && j <= totalAt + 3; j++) {
      const p = _applePrice(lines[j] || ''); if (p) { paid = p; break; }
    }
  }
  if (paid == null) {
    for (let j = lines.length - 1; j >= 0; j--) { const p = _applePrice(lines[j]); if (p) { paid = p; break; } }
  }
  if (!paid) return null;

  const orderId = _findVal(lines, /^ORDER ID$/i) || _findVal(lines, /^Order ID:/i)
    || _findVal(lines, /^Mã đơn hàng:?$/i) || _findVal(lines, /^DOCUMENT NO\.?$/i);
  /* The date is labelled in A and bare in B (the second line of the mail), so
     fall back to the first line near the top that reads as one. */
  let when = receiptWhen(_findVal(lines, /^(INVOICE DATE|Ngày h[oó]a đơn)$/i));
  if (!when) {
    for (let j = 0; j < lines.length && j < 10; j++) {
      if (!lines[j] || _LABEL_RE.test(lines[j])) continue;
      const w = receiptWhen(lines[j]);
      if (w) { when = w; break; }
    }
  }

  const items = [];
  let group = [], section = null;      // the storefront line is a SECTION header: it names every item until the next header
  for (let i = 0; i < stop; i++) {
    const ln = lines[i];
    if (!ln) continue;
    const p = _applePrice(ln);
    if (p != null) { _appleItem(group, p, items, section); group = []; continue; }
    if (_APPLE_RESET.test(ln) || _LABEL_RE.test(ln) || /@/.test(ln)
        || /^(MasterCard|Visa|VISA|JCB|Amex|Thẻ)/i.test(ln)) { group = []; section = null; continue; }
    if (_APPLE_STORES.test(ln)) section = ln;
    group.push(ln);
  }

  return {
    service_type: 'digital', order_id: orderId, seller: null,
    items: items.length ? items : null,
    items_total: null, discount: null, shipping_fee: null,
    paid, paid_with_tail: cardTail(t), _when: when,
  };
}

/** Grab, MINIMAL BY CONSTRUCTION (spec §5): service, total, time, paid-with
 *  tail, booking id, and the fare/promo split — numbers only. NEVER items:
 *  a Grab mail prints the pickup and drop-off STREET ADDRESSES a few lines
 *  below the total, and this reader has no code path that could carry one.
 *
 *  Its total is labelled "Total Paid" over the figure, which a bare `^TOTAL`
 *  pattern read as the word "Paid" (2026-09-29). */
export function readGrabReceipt(text, subject) {
  const t = String(text || '');
  if (!/e-?receipt|grab/i.test(String(subject || '') + ' ' + t.slice(0, 200))) return null;
  const lines = _lines(t);
  /* The amount under a label line, wherever the label sits on it. */
  const under = (re) => {
    for (let i = 0; i < lines.length; i++) {
      if (!re.test(lines[i])) continue;
      const rest = lines[i].replace(re, '').replace(/^[:\s]+/, '').trim();
      /* A discount prints as "-12.000"; every label here names a magnitude,
         so the sign is presentation and the figure is what matters. */
      const mag = (x) => amt(String(x == null ? '' : x).replace(/^-/, ''));
      const here = mag(rest);
      if (here != null) return here;
      for (let j = i + 1; j < lines.length && j <= i + 2; j++) {
        if (!lines[j]) continue;
        const v = mag(lines[j]);
        if (v != null) return v;
        break;
      }
    }
    return null;
  };
  const paid = under(/^(?:Total Paid|Tổng thanh toán|Tổng cộng|Total)\b\s*(?:\(VND\))?\s*:?/i);
  if (!paid) return null;
  const fare = under(/^(?:Fare|Giá cước|Cước phí)\b/i);
  const promo = under(/^(?:Promo|Khuyến mãi|Giảm giá)\b/i);
  const booking = _tidyStr(_findVal(lines, /^(?:Booking ID|Mã chuyến)\s*:?/i));
  const food = /grabfood|đơn hàng|delivery/i.test(t);
  const when = receiptWhen(labelled(t, /(\d{1,2}[\/\-\s](?:Th\s*0?\d{1,2}|[A-Za-z]{3,9}|\d{1,2})[\/\-\s]\d{4}[^\n]*)/));
  return {
    service_type: food ? 'food' : 'ride', order_id: booking, seller: null,
    items: null,
    items_total: (fare != null && fare !== paid) ? fare : null,
    discount: (promo != null && promo > 0) ? promo : null,
    shipping_fee: null,
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
