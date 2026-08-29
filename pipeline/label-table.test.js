#!/usr/bin/env node
/* The label-table tier reads real VN bank mail without a model call.
 * `node pipeline/label-table.test.js`
 *
 * The four fixtures are the plaintext bodies of REAL mails from the family's
 * own mailbox (27-08-2026), with account/phone digits scrambled — the labels,
 * layout and formats are verbatim, because the whole point of this tier is
 * that the layout, not the digits, is what carries the structure.
 *
 * Properties pinned, one per failure that would cost money or trust:
 *   • each of the four SHAPES parses without the LLM — including the VCB biên
 *     lai, which had no template and burned a Gemini call per mail
 *   • amounts survive both number notations (-37,000 / 2,000.00 / 15,000)
 *   • all three date shapes normalise to ISO+07:00
 *   • a full account number NEVER leaves the reader — last four only
 *   • fee rows can never be read as the amount
 *   • self-transfer (remitter = beneficiary) is flow:transfer, not an expense
 *   • marketing prose returns null and falls through to the model's judgement
 */
const M = await import('../supabase/functions/_shared/mailbox/labeltable.mjs');
const { readLabelTable, parseAmountCell, parseWhenCell, maskAccount } = M;

let pass = 0, fail = 0;
const t = (n, ok, d) => { console.log((ok ? '  PASS  ' : '  FAIL  ') + n + (!ok && d ? '  -> ' + d : '')); ok ? pass++ : fail++; };

/* ── fixture A: MB tap card ────────────────────────────────────────────── */
const MB_TAP = `| |
| Kính gửi: Quý khách NGUYEN THU TRANG, |
| Ngân hàng TMCP Quân đội (MB) xin thông báo thông tin giao dịch của Quý khách như sau: |

| |
| MB TK chạm | x5249 |
| Ngày, giờ giao dịch | 2026-08-25 18:52:04 |
| Điểm giao dịch | AEON NGUYEN VAN LINH |
| Số tiền | -37,000 VND |
| Số tài khoản | 3510187654001 |
| Số dư | 53,362,751 VND |

| Nếu không thực hiện giao dịch, Quý khách có thể đăng nhập App MB. |`;

console.log('\n-- A · MB tap: template-grade fields, no model --');
const a = readLabelTable('Thông báo thông tin giao dịch TK chạm', MB_TAP);
t('parses', !!a);
t('amount 37000 from "-37,000 VND"', a && a.amount === 37000);
t('negative sign → debit', a && a.direction === 'debit');
t('ymd time zone-stamped', a && a.occurred_at === '2026-08-25T18:52:04+07:00');
t('merchant read', a && a.counterparty === 'AEON NGUYEN VAN LINH');
t("the bank's own masked form wins, full number never leaves", a && a.account_masked === 'x5249' && !/3510187654001/.test(JSON.stringify(a)));
t('the balance the mail carries is kept', a && a.balance === 53362751);
t('card spend is a receipt, not a transfer', a && a.transaction_type === 'ecommerce_receipt');

/* ── fixture B: MB transfer to self ────────────────────────────────────── */
const MB_SELF = `Cảm ơn Quý khách đã sử dụng dịch vụ MB eBanking.

| Ngày, giờ giao dịch | 26-08-2026 02:59:25 |
| Loại giao dịch | Chuyển tiền nhanh ngoài MB |
| Số tham chiếu | 26202602591303646 |
| Tài khoản trích nợ | NGUYEN THU TRANG - 3510187654001 (VND) |
| Người thụ hưởng | NGUYEN THU TRANG - 0944999991 |
| Số tiền giao dịch | (VND) 2,000.00 |
| Nội dung chuyển tiền | NGUYEN THU TRANG chuyen tien |
| Tình trạng | Giao dịch thành công |`;

console.log('\n-- B · MB transfer to self: money between own pockets --');
const b = readLabelTable('Thong bao giao dich thanh cong', MB_SELF);
t('parses', !!b);
t('amount 2000 from "(VND) 2,000.00"', b && b.amount === 2000);
t('dmy datetime read', b && b.occurred_at === '2026-08-26T02:59:25+07:00');
t('remitter = beneficiary → flow transfer', b && b.flow === 'transfer');
t('typed as p2p', b && b.transaction_type === 'p2p_transfer');
t('memo kept for the tidy layer to judge', b && b.memo === 'NGUYEN THU TRANG chuyen tien');
t('reference read', b && b.reference_number === '26202602591303646');

/* ── fixture C: VCB card, bilingual labels ─────────────────────────────── */
const VCB_CARD = ` Vietcombank

| Thông báo giao dịch thẻ/ Vietcombank card transaction notification |

| |
| Thẻ Card | Visa 452404...0035 |
| Sử dụng tại At | AEON NGUYEN VAN LINH HO CHI MINH VN |
| Số tiền Transaction Amount | 337,900 VND |
| Ngày, giờ giao dịch Trans. Date, Time | 26-08-2026 20:04:26 |
| Tài khoản trích nợ Debit Account | 1046999979 |
| Tình trạng giao dịch Status of Transaction | Thành công |`;

console.log('\n-- C · VCB card: bilingual label cells resolve --');
const c = readLabelTable('Thông báo giao dịch thẻ', VCB_CARD);
t('parses', !!c);
t('"Số tiền Transaction Amount" is still the amount', c && c.amount === 337900);
t('unsigned card notice → debit', c && c.direction === 'debit');
t('merchant via "Sử dụng tại At"', c && /^AEON NGUYEN VAN LINH/.test(c.counterparty || ''));
t('account masked to last four', c && c.account_masked === '…9979');

/* ── fixture D: VCB biên lai — the shape that burned a model call per mail ── */
const VCB_RECEIPT = ` Vietcombank

| Biên lai chuyển tiền qua tài khoản (Payment Receipt) |

| |
| Ngày, giờ giao dịch Trans. Date, Time | 11:11 Chủ Nhật 23/08/2026 |
| Số lệnh giao dịch Order Number | 15710007437 |
| Tài khoản nguồn Debit Account | 1046999979 |
| Tên người chuyển tiền Remitter’s name | CAO THAI DUY HIEN |
| Tài khoản người hưởng Credit Account | 0931999972 |
| Tên người hưởng Beneficiary Name | TRAN THI TUYET HANH |
| Tên ngân hàng hưởng Beneficiary Bank Name | Ngân hàng Xuất Nhập khẩu |
| Số tiền Amount | 15,000 VND |
| Loại phí Charge Code | Người chuyển trả Exclude | Số tiền phí Charge Amount Net income VAT | 0 VND 0 VND 0 VND |
| Nội dung chuyển tiền Details of Payment | CAO THAI DUY HIEN chuyen tien |`;

console.log('\n-- D · VCB biên lai: no template needed any more --');
const d = readLabelTable('Biên lai chuyển tiền qua tài khoản', VCB_RECEIPT);
t('parses', !!d);
t('amount 15000, NOT the 0 VND fee row', d && d.amount === 15000);
t('time-weekday-date shape read', d && d.occurred_at === '2026-08-23T11:11:00+07:00');
t('counterparty is the beneficiary', d && d.counterparty === 'TRAN THI TUYET HANH');
t('different people → flow left for stage.mjs to judge', d && d.flow === null);
t('typed as p2p', d && d.transaction_type === 'p2p_transfer');
t('order number read', d && d.reference_number === '15710007437');

/* ── the gate: what must NOT parse ─────────────────────────────────────── */
console.log('\n-- the confidence gate holds --');
t('marketing prose returns null', readLabelTable('Ưu đãi tháng 8',
  'Hoàn 100% phí giao dịch quốc tế cùng nhiều ưu đãi trong tháng này! Số tiền hoàn lên tới 500,000 VND cho chủ thẻ.') === null);
t('a table with no timestamp returns null', readLabelTable('x',
  '| Số tiền | 100,000 VND |\n| Điểm giao dịch | ABC |\n| Trạng thái | OK |') === null);
t('a table with no amount returns null', readLabelTable('x',
  '| Ngày, giờ giao dịch | 2026-08-25 10:00:00 |\n| Điểm giao dịch | ABC |\n| Ghi chú | hello |') === null);

console.log('\n-- number + date + mask helpers, edge for edge --');
t('"53,362,751 VND"', (parseAmountCell('53,362,751 VND') || {}).value === 53362751);
t('"2,000.00" decimal tail dropped', (parseAmountCell('(VND) 2,000.00') || {}).value === 2000);
t('zero is not an amount', parseAmountCell('0 VND') === null);
t('mask keeps short values whole', maskAccount('x5249') === 'x5249');
t('mask reduces long values to last four', maskAccount('NGUYEN THU TRANG - 3510187654001 (VND)') === '…4001');
t('mask passes null through', maskAccount(null) === null);
t('refund wording flips to credit', (function(){
  const r = readLabelTable('Hoàn tiền giao dịch thẻ',
    '| Số tiền | 50,000 VND |\n| Ngày, giờ giao dịch | 2026-08-25 10:00:00 |\n| Điểm giao dịch | SHOPEE |');
  return r && r.direction === 'credit';
})());

/* ── PRODUCTION line form: mailtext.mjs gives every cell its own line ───── */
console.log('\n-- production text form (label \\n value) reads identically --');
const LINE_FORM = `Thông báo giao dịch thẻ
Thẻ Card
Visa 452404...0035
Sử dụng tại At
AEON NGUYEN VAN LINH HO CHI MINH VN
Số tiền Transaction Amount
337,900 VND
Ngày, giờ giao dịch Trans. Date, Time
26-08-2026 20:04:26
Tài khoản trích nợ Debit Account
1046999979
Tình trạng giao dịch Status of Transaction
Thành công`;
const lf = readLabelTable('Thông báo giao dịch thẻ', LINE_FORM);
t('line form parses', !!lf);
t('same amount as the pipe form', lf && lf.amount === 337900);
t('same timestamp', lf && lf.occurred_at === '2026-08-26T20:04:26+07:00');
t('same merchant', lf && /^AEON NGUYEN VAN LINH/.test(lf.counterparty || ''));

console.log('\n-- a DECLINED attempt is not spending, in either form --');
const { statusReadsFailed } = M;
t('success status is not failure', statusReadsFailed(LINE_FORM) === false);
t('declined line form reads failed', statusReadsFailed(LINE_FORM.replace('Thành công', 'Không thành công')) === true);
t('declined pipe form reads failed', statusReadsFailed(VCB_CARD.replace('Thành công', 'Không thành công')) === true);
t('footer safety-advice wording cannot fake a failure',
  statusReadsFailed(LINE_FORM + '\nNếu giao dịch không thành công, vui lòng liên hệ 1900545413') === false);

/* ── the bilingual twin: a merchant name that became a preposition ───────── */
console.log('\n-- a bilingual label split over two lines does not eat the value --');
const BILINGUAL = `Thẻ Card
Visa 452404...0035
Sử dụng tại
At
AEON MALL NGUYEN VAN LINH HO CHI MINH VN
Số tiền
Transaction Amount
337,900 VND
Ngày, giờ giao dịch
Trans. Date, Time
26-08-2026 20:04:26
Tài khoản trích nợ
Debit Account
1046999979
Tình trạng giao dịch
Status of Transaction
Thành công`;
const bl = readLabelTable('Thông báo giao dịch thẻ', BILINGUAL);
t('parses', !!bl);
t('the merchant is the merchant, not the English half of its label',
  bl && bl.counterparty === 'AEON MALL NGUYEN VAN LINH HO CHI MINH VN', bl && bl.counterparty);
t('the amount survives its own twin line', bl && bl.amount === 337900);
t('so does the timestamp', bl && bl.occurred_at === '2026-08-26T20:04:26+07:00');
t('and the account', bl && bl.account_masked === '…9979');
t('and the status', bl && bl.status === 'Thành công');

console.log('\n-- and the skip is exact, never a heuristic --');
t('a short alphabetic MERCHANT is still read',
  (readLabelTable('x', 'Điểm giao dịch\nAEON\nSố tiền\n50,000 VND\nNgày, giờ giao dịch\n2026-08-26 10:00:00') || {}).counterparty === 'AEON');
t('a two-letter merchant is not mistaken for a twin',
  (readLabelTable('x', 'Điểm giao dịch\nGS\nSố tiền\n50,000 VND\nNgày, giờ giao dịch\n2026-08-26 10:00:00') || {}).counterparty === 'GS');

console.log('\n' + (fail === 0 ? 'ALL ' + pass + ' PASSED' : pass + ' passed, ' + fail + ' FAILED'));
process.exit(fail ? 1 : 0);
