#!/usr/bin/env node
/* A VIB own-account transfer reads as one, with the other side named.
 * `node pipeline/vib-own-transfer-reading.test.js`
 *
 * The mail (2026-09-22, seen on a real device): "Chuyển tiền nhanh đến tài
 * khoản ngân hàng nội địa thành công", nine labelled rows, the person moving
 * money from their VIB account to their own Vietcombank account. The review
 * card said "Chuyển khoản nội bộ" and then could not say where to, because the
 * receiving account had never been materialized: Vietcombank never emails
 * money-in, so that account is never a row's OWN instrument. The device now
 * materializes the counterpart from the transfer mail itself
 * (72-txn-review.js fhStagedCounterpartAcct), and it asks three printed facts
 * of the sealed row. This pins that the server seals all three for exactly
 * this shape, with the model off:
 *
 *   counterparty_bank           "Tại ngân hàng" (label-table cp_bank)
 *   counterparty_account_tail   the account half of "Đến tài khoản: <acct> - <name>"
 *   signal own_transfer, src.signal printed, counterparty_kind self
 *
 * The last line is the one that was NOT true before: greetingName refused
 * "Kính gửi Quý khách NGUYEN VAN TEST," outright, holder_name stayed null,
 * and own_transfer could only be found through the memo, graded heuristic,
 * which the device rightly refuses to build an account from.
 *
 * And account_kind: the sending account is a 15-digit VIB deposit account.
 * The classifier may say nothing (null), never credit_card.
 *
 * Synthetic names and numbers only.
 */
import crypto from 'node:crypto';
import { memoryDb, W } from './v2-harness.mjs';

let pass = 0, fail = 0;
const t = (n, ok, d) => { console.log((ok ? '  PASS  ' : '  FAIL  ') + n + (!ok && d !== undefined ? '  -> ' + JSON.stringify(d) : '')); ok ? pass++ : fail++; };

const X = await import('../supabase/functions/_shared/mailbox/extract.mjs');
const ST = await import('../supabase/functions/_shared/mailbox/stage.mjs');
const LT = await import('../supabase/functions/_shared/mailbox/labeltable.mjs');

const BODY = [
  'Kính gửi Quý khách NGUYEN VAN TEST,',
  'VIB xin thông báo giao dịch chuyển tiền nhanh của Quý khách đã được thực hiện thành công với thông tin như sau:',
  '',
  '| Loại giao dịch | Chuyển tiền nhanh đến tài khoản ngân hàng nội địa |',
  '| Thời gian giao dịch | 14:05:12 22/09/2026 |',
  '| Từ tài khoản | 000111222333444 |',
  '| Đến tài khoản | 1000002279 - NGUYEN VAN TEST |',
  '| Tại ngân hàng | Vietcombank |',
  '| Số tiền | 5.000.000 ₫ |',
  '| Phí (bao gồm VAT) | 0 ₫ |',
  '| Diễn giải | NGUYEN VAN TEST chuyen tien den NGUYEN VAN TEST - 1000002279 |',
  '| Mã giao dịch | FT26265000123 |',
  '',
  'Cảm ơn Quý khách đã sử dụng dịch vụ của VIB.',
].join('\n');
const MSG = {
  from: 'VIB <info@vib.com.vn>',
  subject: 'Chuyển tiền nhanh đến tài khoản ngân hàng nội địa thành công',
  body: BODY, dkim: { pass: true, result: 'pass' }, internalDate: Date.now(),
};

console.log('\n-- the greeting names the holder --');
t('"Kính gửi Quý khách NAME," yields the name', LT.greetingName('Kính gửi Quý khách NGUYEN VAN TEST,\n') === 'NGUYEN VAN TEST', LT.greetingName('Kính gửi Quý khách NGUYEN VAN TEST,\n'));
t('"Kính gửi: Quý khách NAME," (MB, with a colon) too', LT.greetingName('Kính gửi: Quý khách NGUYEN VAN TEST,\n') === 'NGUYEN VAN TEST');
t('"Kính gửi Quý khách hàng," still names nobody', LT.greetingName('Kính gửi Quý khách hàng,\n') === null);
t('"Kính gửi Quý khách," alone names nobody', LT.greetingName('Kính gửi Quý khách,\n') === null);
t('a plain "Kính gửi NAME" is unchanged', LT.greetingName('Kính gửi NGUYEN VAN A\n\nGiao dịch…') === 'NGUYEN VAN A');

console.log('\n-- the reader, model off, over the nine-label VIB transfer --');
let calls = 0;
const db = memoryDb();
const r = await X.readTransaction(MSG, db, {
  llm: {}, subtle: crypto.webcrypto.subtle, senderKind: 'bank', provider: 'VIB',
  fetch: async () => { calls++; throw new Error('the model must not be asked'); },
});
t('read without a model call', r.ok && calls === 0, r.ok ? r.tier : r);
const x = r.ok ? r.extraction : {};
t('amount 5.000.000, debit, second precision', x.amount === 5000000 && x.direction === 'debit' && x.time_precision === 'second', [x.amount, x.direction, x.time_precision]);
t('the holder is read off the greeting', x.holder_name === 'NGUYEN VAN TEST', x.holder_name);
t('counterparty_bank from "Tại ngân hàng"', x.counterparty_bank === 'Vietcombank', x.counterparty_bank);
t('counterparty_account_tail is the last four of the "Đến tài khoản" account, masked', x.counterparty_account_tail === '…2279', x.counterparty_account_tail);
t('the sending account is masked to its last four', x.account_masked === '…3444', x.account_masked);
t('the two printed names are the same letters: counterparty_kind self, printed', x.counterparty_kind === 'self' && x.src && x.src.counterparty_kind === 'printed', [x.counterparty_kind, x.src && x.src.counterparty_kind]);
t('signal own_transfer, printed (not the memo guess)', x.signal === 'own_transfer' && x.src && x.src.signal === 'printed', [x.signal, x.src && x.src.signal]);
t('account_kind is null or deposit, never credit_card', x.account_kind === null || x.account_kind === 'deposit', x.account_kind);

console.log('\n-- what a v2 mailbox seals --');
const sealed = ST.buildPayload({ reading: W.toReading(x, MSG), senderKind: 'bank', readerV: 2 }).raw_extracted;
t('v: 2', sealed.v === 2, sealed.v);
t('counterparty_bank sealed', sealed.counterparty_bank === 'Vietcombank', sealed.counterparty_bank);
t('counterparty_account_tail sealed', sealed.counterparty_account_tail === '…2279', sealed.counterparty_account_tail);
t('counterparty_kind self sealed', sealed.counterparty_kind === 'self', sealed.counterparty_kind);
t('signal own_transfer sealed, with src.signal printed', sealed.signal === 'own_transfer' && sealed.src && sealed.src.signal === 'printed', [sealed.signal, sealed.src && sealed.src.signal]);
t('src.counterparty_bank and src.counterparty_account_tail are printed', sealed.src && sealed.src.counterparty_bank === 'printed' && sealed.src.counterparty_account_tail === 'printed', sealed.src);
t('flow transfer', sealed.flow === 'transfer', sealed.flow);
t('account_kind sealed as null or deposit, never credit_card', sealed.account_kind === null || sealed.account_kind === 'deposit', sealed.account_kind);
/* The two ACCOUNT fields carry last-four only. The counterparty cell and the
   memo are sealed as printed (the label-table vocabulary says so: a bare
   number there is "visible in review and correctable, never silent"), so they
   are not asserted here. */
t('the sending account number never leaves in account_masked', sealed.account_masked === '…3444' && !/000111222333444/.test(sealed.account_masked), sealed.account_masked);
t('the receiving account number never leaves in counterparty_account_tail', sealed.counterparty_account_tail === '…2279', sealed.counterparty_account_tail);

console.log('\n-- the same mail, greeting-less: the memo alone is only a guess --');
{
  const body2 = BODY.replace('Kính gửi Quý khách NGUYEN VAN TEST,\n', '');
  const r2 = await X.readTransaction({ ...MSG, body: body2 }, memoryDb(), { llm: {}, subtle: crypto.webcrypto.subtle, senderKind: 'bank', provider: 'VIB' });
  const x2 = r2.ok ? r2.extraction : {};
  t('still own_transfer', x2.signal === 'own_transfer', x2.signal);
  t('but graded heuristic: the device will not materialize an account from it', x2.src && x2.src.signal === 'heuristic', x2.src && x2.src.signal);
}

console.log('\n' + (fail ? 'FAILED ' + fail + ' of ' + (pass + fail) : 'ALL ' + pass + ' assertions passed'));
process.exit(fail ? 1 : 0);
