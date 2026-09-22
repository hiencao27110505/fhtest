#!/usr/bin/env node
/* `card_masked` is the card BEING PAID DOWN — never the card that was charged.
 * `node pipeline/card-masked-purchase.test.js`
 *
 * card-repayment-routing-spec.md documents the field as "the card being paid
 * down, null on every mail that is not a card repayment", and the device takes
 * it at its word: fhResolveRepaidCard reads a named card as its most specific
 * evidence, and fhCardPayShaped reads one on a memo-less mail as a repayment
 * outright. The structural reader disagreed with the document. It emitted the
 * card row of EVERY card alert, purchases included — measured 2026-09-22 on a
 * VIB "Thanh toán hóa đơn QR thành công" paid by credit card, which prints
 * "Thẻ tín dụng: ••••4751" and nothing else: the same tail arrived as
 * account_masked (correct: that is the instrument) and as card_masked (a
 * repayment signal on a purchase).
 *
 * The rule now: a mail naming a MERCHANT is a purchase, so the card it prints
 * was charged, and card_masked is null. A repayment names no merchant — it
 * pays the issuer, which is why the beneficiary's bank is the counterparty of
 * last resort in this reader — and prints its funding account in its own row,
 * so the repayment path is untouched. Pinned here in both directions, because
 * "untouched" is the half that costs a person the right card.
 *
 * Every fixture is SYNTHETIC: invented names, invented digits.
 */
const url = await import('node:url');
const HERE = url.fileURLToPath(new URL('.', import.meta.url));
const M = await import(HERE + '../supabase/functions/_shared/mailbox/labeltable.mjs');
const S = await import(HERE + '../supabase/functions/_shared/mailbox/signals.mjs');
const { readLabelTable, maskAccount } = M;
const { detectSignal } = S;

let pass = 0, fail = 0;
const t = (n, ok, d) => { console.log((ok ? '  PASS  ' : '  FAIL  ') + n + (!ok && d !== undefined ? '  -> ' + JSON.stringify(d) : '')); ok ? pass++ : fail++; };

/* ── the measured mail: a bill paid BY CARD ──────────────────────────────
   Inline rows, a labelled credit-card row, a colon-less merchant line, and no
   account row at all — the card IS the instrument. */
const QR_BY_CARD = `Ngân hàng TMCP ZQ thông báo giao dịch:

Thẻ tín dụng: ••••4751
Giao dịch: Thanh toán hóa đơn QR
Giá trị: 250,000 VND
Vào lúc: 10:17 22/09/2026
Tại ZQ MART 01`;

/* ── the card repayment: two instruments, and the card is the destination ──
   card-repayment-routing-spec §7.1. Money leaves a deposit ("Từ tài khoản")
   and a separate card row names what it settles. No merchant anywhere. */
const CARD_REPAY = `| |
| Ngân hàng TMCP ZQ thông báo giao dịch: |

| |
| Loại giao dịch | Thanh toán thẻ tín dụng |
| Số tiền | -2,000,000 VND |
| Ngày, giờ giao dịch | 22-09-2026 14:32:00 |
| Từ tài khoản | 1234567890123 |
| Số thẻ | 4111********5140 |
| Ngân hàng hưởng | Ngân hàng TMCP ZQ |
| Số dư | 11,800,000 VND |`;

/* ── a purchase off a BARE "Số thẻ" row: the same rule, other label ──────── */
const CARD_PURCHASE = `Ngân hàng TMCP ZQ thông báo giao dịch:

Số thẻ: 0000***0000
Chủ thẻ: NGUYEN VAN A
Giao dịch: Thanh toán dịch vụ - hàng hóa
Giá trị: 45,000 VND
Vào lúc: 18:52 25/08/2026
Tại ZQ COFFEE 01`;

console.log('\n-- a purchase: the card was charged, so nothing was paid down --');
const qr = readLabelTable('Thanh toán hóa đơn QR thành công', QR_BY_CARD);
t('the bill-by-card mail reads', !!qr);
t('the card is the row\'s own instrument', qr && qr.account_masked === '••••4751', qr && qr.account_masked);
t('and card_masked is NULL — a purchase pays no card down', qr && qr.card_masked === null, qr && qr.card_masked);
t('so no provenance is claimed for it either', qr && !('card_masked' in (qr.src || {})), qr && qr.src);
t('the merchant is still read', qr && qr.counterparty === 'ZQ MART 01' && qr.counterparty_row === 'merchant', qr && qr.counterparty);

const buy = readLabelTable('Thông báo giao dịch thẻ tín dụng', CARD_PURCHASE);
t('a bare "Số thẻ" purchase reads', !!buy);
t('...its card is the instrument', buy && buy.account_masked === '0000***0000', buy && buy.account_masked);
t('...and carries no repaid card', buy && buy.card_masked === null, buy && buy.card_masked);

console.log('\n-- a repayment: untouched, the card is what is being settled --');
const rp = readLabelTable('Thanh toán thẻ tín dụng thành công', CARD_REPAY);
t('the repayment mail reads', !!rp);
t('account_masked is the FUNDING deposit', rp && maskAccount(rp.account_masked) === '…0123', rp && rp.account_masked);
t('card_masked is the REPAID card', rp && maskAccount(rp.card_masked) === '…5140', rp && rp.card_masked);
t('the two are different instruments', rp && maskAccount(rp.account_masked) !== maskAccount(rp.card_masked));
t('and it is still provenance `printed`', rp && rp.src.card_masked === 'printed', rp && rp.src);

console.log('\n-- what the device is handed: a purchase carries no repayment signal --');
const sigOf = (r, subject) => detectSignal(r, { subject, senderKind: 'bank' }).signal;
t('the bill-by-card mail is a purchase', sigOf(qr, 'Thanh toán hóa đơn QR thành công') === 'purchase',
  sigOf(qr, 'Thanh toán hóa đơn QR thành công'));
t('the card purchase is a purchase', sigOf(buy, 'Thông báo giao dịch thẻ tín dụng') === 'purchase',
  sigOf(buy, 'Thông báo giao dịch thẻ tín dụng'));
t('the repayment is a card_repayment', sigOf(rp, 'Thanh toán thẻ tín dụng thành công') === 'card_repayment',
  sigOf(rp, 'Thanh toán thẻ tín dụng thành công'));

console.log('\n' + (fail === 0 ? 'ALL ' + pass + ' PASSED' : pass + ' passed, ' + fail + ' FAILED'));
process.exit(fail ? 1 : 0);
