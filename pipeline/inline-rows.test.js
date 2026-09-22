#!/usr/bin/env node
/* The third row form, and the vocabulary that came with it.
 * `node pipeline/inline-rows.test.js`
 *
 * The label-table reader spoke two forms: a pipe row, and a label line with its
 * value on the next line. The largest format in the email-reading-v2 test set
 * is neither: a credit-card notice whose fields are INLINE, "Label: value" on
 * one line, with the merchant on a colon-less "Tại <shop>" line underneath. 341
 * of 955 real mails, and every one went to the model
 * (docs/specs/email-reading-v2-spec.md §2, §8.1).
 *
 * Every fixture here is SYNTHETIC: invented names, invented digits.
 *
 * Properties pinned:
 *   • an inline line is a row only when the part before the FIRST colon is a
 *     label the vocabulary knows; prose with a colon is not a row
 *   • the colon-less merchant line is read only directly under an inline block
 *   • the reading carries holder_name, time_precision, the card as the person's
 *     own instrument, and provenance `printed` for what a row printed
 *   • new keys match at WORD boundaries ("Ghi chú thêm" is not "chủ thẻ")
 *   • 'thoi gian' matches EXACTLY: a showtime is not a transaction time
 *   • a fee is captured as fee_amount AND still can never be the amount
 *   • the beneficiary's bank is counterparty_bank, the counterparty of last
 *     resort, and makes the mail a bank_txn, not a transfer between people
 *   • "ACCOUNT - NAME" yields counterparty_account_tail, raw (masked in _tidy)
 *   • the mail's own title is not a row; a sign-off is not a memo
 */
const url = await import('node:url');
const HERE = url.fileURLToPath(new URL('.', import.meta.url));
const M = await import(HERE + '../supabase/functions/_shared/mailbox/labeltable.mjs');
const { readLabelTable, tableRows, vocabularyField, whenPrecision, greetingName } = M;

let pass = 0, fail = 0;
const t = (n, ok, d) => { console.log((ok ? '  PASS  ' : '  FAIL  ') + n + (!ok && d !== undefined ? '  -> ' + JSON.stringify(d) : '')); ok ? pass++ : fail++; };

const CARD = `Thông báo giao dịch Thẻ tín dụng ZQ Cash Back

Kính gửi Quý khách hàng,

Ngân hàng ZQ cảm ơn Quý khách hàng đã giao dịch. Thông tin giao dịch của Quý khách hàng như sau:

Số thẻ: 0000***0000

Chủ thẻ: NGUYEN VAN A

Giao dịch: Thanh toán dịch vụ - hàng hóa

Giá trị: 45,000 VND

Vào lúc: 18:52 25/08/2026

Tại ZQ COFFEE 01

Để biết thêm thông tin chi tiết, Quý khách hàng vui lòng liên hệ: 0000 0000 (1.000 đồng/phút)

Hotline: 0000 0000

Trân trọng.`;

console.log('\n-- the inline form --');
const card = readLabelTable('Thông báo giao dịch thẻ tín dụng', CARD);
t('the notice is read, with no table in it at all', !!card, card);
t('amount off "Giá trị"', card && card.amount === 45000 && card.currency === 'VND', card && card.amount);
t('the moment off "Vào lúc", time first then date', card && card.occurred_at === '2026-08-25T18:52:00+07:00', card && card.occurred_at);
t('time_precision is what was PRINTED: minutes', card && card.time_precision === 'minute', card && card.time_precision);
t('the merchant off the colon-less "Tại" line', card && card.counterparty === 'ZQ COFFEE 01' && card.counterparty_row === 'merchant', card && card.counterparty);
t('a merchant row is a debit', card && card.direction === 'debit', card && card.direction);
t('holder_name off "Chủ thẻ"', card && card.holder_name === 'NGUYEN VAN A', card && card.holder_name);
t('the transaction-kind row is kept for the signal detector', card && card.txn_kind === 'Thanh toán dịch vụ - hàng hóa', card && card.txn_kind);
t('on a card PURCHASE the card is the person\'s own instrument', card && card.account_masked === '0000***0000' && card.card_masked === '0000***0000', card && card.account_masked);
t('rows_via says which reader', card && card.rows_via === 'line', card && card.rows_via);
t('provenance: printed rows are `printed`', card && card.src.amount === 'printed' && card.src.holder_name === 'printed' && card.src.direction === 'printed', card && card.src);
t('labels are recorded per row field, labels only', card && card.labels.amount === 'Giá trị' && card.labels.merchant === 'Tại' && !/45|ZQ COFFEE|NGUYEN/.test(JSON.stringify(card.labels)), card && card.labels);

console.log('\n-- prose with a colon is not a row --');
const rows = tableRows({ body: CARD }).rows.map((r) => r.label);
t('"…vui lòng liên hệ: …" is not a row', !rows.some((l) => /liên hệ/.test(l)), rows);
t('"Hotline: …" is not a row', !rows.includes('Hotline'), rows);
t('exactly the six rows of the notice', rows.join('|') === 'Số thẻ|Chủ thẻ|Giao dịch|Giá trị|Vào lúc|Tại', rows);
t('"Tại …" elsewhere in a mail is a sentence, not a merchant',
  !tableRows({ body: 'Số tiền\n50,000\n\nTại quầy giao dịch gần nhất\n\nNgày giao dịch\n11:00 01/09/2026' }).rows.some((r) => r.label === 'Tại'));
t('a bilingual LABEL line ("Số tiền: Amount") is not an inline row',
  !tableRows({ body: 'Số tiền: Amount\n50,000 VND' }).rows.some((r) => r.value === 'Amount'));

console.log('\n-- a foreign figure stays foreign --');
const usd = readLabelTable('Thông báo giao dịch thẻ tín dụng', CARD.replace('45,000 VND', '12.99 USD'));
t('12.99 USD is 12.99 USD, not 1299 dong', usd && usd.amount === 12.99 && usd.currency === 'USD', usd && [usd.amount, usd.currency]);

console.log('\n-- the vocabulary: word boundaries, exact keys --');
t('"Chủ thẻ" is the holder', vocabularyField('Chủ thẻ') === 'holder');
t('"Ghi chú thêm" is NOT the holder ("…chú thê…" contains "chu the")', vocabularyField('Ghi chú thêm') === null, vocabularyField('Ghi chú thêm'));
t('"Thời gian" alone is the transaction time', vocabularyField('Thời gian') === 'occurred_at');
t('"Thời gian chiếu" (a cinema showtime) is not', vocabularyField('Thời gian chiếu') === null, vocabularyField('Thời gian chiếu'));
t('"Thời gian sao kê" (a statement period) is not', vocabularyField('Thời gian sao kê') === null);
t('"Giao dịch" alone is the transaction kind', vocabularyField('Giao dịch') === 'txn_kind');
t('...and did not swallow "Ngày giao dịch" or "Số giao dịch"', vocabularyField('Ngày giao dịch') === 'occurred_at' && vocabularyField('Số giao dịch') === 'reference');
t('"Tại ngân hàng" is the beneficiary\'s bank, "Tại" alone the merchant', vocabularyField('Tại ngân hàng') === 'cp_bank' && vocabularyField('Tại') === 'merchant');
t('"Hạn mức khả dụng" is a limit, never a balance or an amount', vocabularyField('Hạn mức khả dụng') === 'limit');
t('"Tài khoản người hưởng" is the OTHER side\'s account', vocabularyField('Tài khoản người hưởng') === 'cp_account');
t('..."Số tài khoản người hưởng" too, not the person\'s own', vocabularyField('Số tài khoản người hưởng') === 'cp_account');
t('"Số tài khoản" is still the person\'s own', vocabularyField('Số tài khoản') === 'account');
t('"Nhà cung cấp" is the biller', vocabularyField('Nhà cung cấp') === 'merchant');
t('"Diễn giải" is the memo', vocabularyField('Diễn giải') === 'memo');
t('"Số hoá đơn" is the reference', vocabularyField('Số hoá đơn') === 'reference');

const TRANSFER = `| Số hoá đơn | 0000ZQTEST000001 |
| Trạng thái giao dịch | Thành công |
| Ngày giao dịch | 11:57 02/09/2026 |
| Từ tài khoản | 000000000000001 |
| Đến tài khoản | 0000000002 - TRAN THI B |
| Tại ngân hàng | Ngân hàng ZQ |
| Số tiền | 1,500,000 ₫ |
| Phí (bao gồm VAT) | 1,100 ₫ |
| Hạn mức khả dụng | 20,000,000 ₫ |
| Diễn giải | tien nha thang 9 |`;

console.log('\n-- the two sides, the fee, the limit --');
const tr = readLabelTable('Chuyển tiền thành công', TRANSFER);
t('parses', !!tr, tr);
t('the fee is captured…', tr && tr.fee_amount === 1100, tr && tr.fee_amount);
t('…and is still never the amount', tr && tr.amount === 1500000, tr && tr.amount);
t('a fee of zero is null, not 0', readLabelTable('x', TRANSFER.replace('1,100 ₫', '0 ₫')).fee_amount === null);
t('available_limit', tr && tr.available_limit === 20000000, tr && tr.available_limit);
t('counterparty_bank', tr && tr.counterparty_bank === 'Ngân hàng ZQ', tr && tr.counterparty_bank);
t('the counterparty is still the whole "ACCOUNT - NAME" cell the device parses', tr && tr.counterparty === '0000000002 - TRAN THI B', tr && tr.counterparty);
t('...and its account half is counterparty_account_tail, raw here (masked in _tidy)', tr && tr.counterparty_account_tail === '0000000002', tr && tr.counterparty_account_tail);
t('a virtual account has letters in it and is still found',
  readLabelTable('x', TRANSFER.replace('0000000002 - TRAN THI B', '99MM00000M00000001 - MOMO_ZQ SHOP')).counterparty_account_tail === '99MM00000M00000001');
t('a bare name has no account half', readLabelTable('x', TRANSFER.replace('0000000002 - TRAN THI B', 'TRAN THI B')).counterparty_account_tail === null);
t('memo off "Diễn giải"', tr && tr.memo === 'tien nha thang 9', tr && tr.memo);
t('reference off "Số hoá đơn"', tr && tr.reference_number === '0000ZQTEST000001', tr && tr.reference_number);

console.log('\n-- the bank as counterparty of last resort --');
const REPAY = `| Số giao dịch | 0000000000000001 |
| Trạng thái giao dịch | Thành công |
| Ngày giao dịch | 11:57 02/09/2026 |
| Từ tài khoản | 000000000000001 |
| Số thẻ | NGUYEN VAN A - ●●●● 0000 |
| Ngân hàng hưởng | Ngân hàng TMCP ZQ |
| Số tiền | 136,670 ₫ |`;
const rp = readLabelTable('Thanh toán thẻ tín dụng ZQ thành công', REPAY);
t('reads, though the mail names no person, no shop and no memo', !!rp, rp);
t('the counterparty is the bank, read off the bank row', rp && rp.counterparty === 'Ngân hàng TMCP ZQ' && rp.counterparty_row === 'cp_bank');
t('a payment to the bank is bank_txn, not a transfer between people', rp && rp.transaction_type === 'bank_txn', rp && rp.transaction_type);
t('the beneficiary\'s bank row implies money going out', rp && rp.direction === 'debit', rp && rp.direction);

console.log('\n-- what is NOT a row, NOT a value --');
const TITLED = `Chuyển tiền nhanh đến tài khoản ngân hàng nội địa thành công

Kính gửi NGUYEN VAN A

Ngày giao dịch
11:57 02/09/2026
Đến tài khoản
0000000002 - TRAN THI B
Số tiền
250,000 ₫
Diễn giải

Cảm ơn Quý khách đã sử dụng dịch vụ Ngân hàng điện tử ZQ.`;
const ti = readLabelTable('Chuyển tiền nhanh đến tài khoản ngân hàng nội địa thành công', TITLED);
t('the mail\'s own title contains "đến tài khoản" and is NOT the beneficiary row', ti && ti.counterparty === '0000000002 - TRAN THI B', ti && ti.counterparty);
t('...so the salutation under it is never the counterparty', ti && !/Kính gửi/.test(String(ti.counterparty)));
t('an empty "Diễn giải" does not take the sign-off as its memo', ti && ti.memo === null, ti && ti.memo);
t('a memo that merely CONTAINS "cam on" is a memo',
  readLabelTable('x', TITLED.replace('Diễn giải\n', 'Diễn giải\ncam on anh nhieu\n')).memo === 'cam on anh nhieu');

console.log('\n-- an item stands in for a memo the mail does not have --');
const BILL = `| Ngày giao dịch | 09:00 03/09/2026 |
| Thẻ tín dụng | ••••0000 |
| Hàng hóa/dịch vụ | ZQ BILL 0001 |
| Nhà cung cấp | ZQ MART |
| Số tiền thanh toán | 266,320 ₫ |`;
const bill = readLabelTable('Thanh toán hóa đơn QR thành công', BILL);
t('reads: the biller is the merchant, "Số tiền thanh toán" the amount', bill && bill.amount === 266320 && bill.counterparty === 'ZQ MART', bill);
t('"Hàng hóa/dịch vụ" becomes the memo', bill && bill.memo === 'ZQ BILL 0001', bill && bill.memo);
t('...unless the mail has a memo row of its own', readLabelTable('x', BILL + '\n| Diễn giải | tien dien thang 8 |').memo === 'tien dien thang 8');

console.log('\n-- small helpers --');
t('whenPrecision: seconds', whenPrecision('26-08-2026 20:04:26') === 'second');
t('whenPrecision: minutes', whenPrecision('11:11 Chủ Nhật 23/08/2026') === 'minute');
t('whenPrecision: a date alone is a day', whenPrecision('26/08/2026') === 'day');
t('whenPrecision: nothing printed is null', whenPrecision('') === null && whenPrecision(null) === null);
t('greetingName reads a NAME', greetingName('Kính gửi NGUYEN VAN A\n\nGiao dịch…') === 'NGUYEN VAN A');
t('greetingName ignores "Quý khách hàng"', greetingName('Kính gửi Quý khách hàng,\n') === null);

console.log('\n' + (fail === 0 ? 'ALL ' + pass + ' PASSED' : pass + ' passed, ' + fail + ' FAILED'));
process.exit(fail ? 1 : 0);
