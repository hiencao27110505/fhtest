#!/usr/bin/env node
/* A mail is p2p because of WHO was paid, never because of the rows it printed.
 * `node pipeline/p2p-verdict.test.js`
 *
 * readLabelTable used to answer `p2p_transfer` on the transfer SHAPE alone: a
 * beneficiary or remitter row exists, or the kind row / subject says chuyển
 * tiền, chuyển khoán, biên lai. A QR payment to a seller is printed in exactly
 * that shape — VIB's "Chuyển tiền nhanh đến tài khoản ngân hàng nội địa thành
 * công" with a virtual-account beneficiary ("VQRQ0001… - <a name>") — so it was
 * read as money sent to a friend.
 *
 * That verdict used to be discarded before sealing. Since it seals as
 * raw_extracted.reader_type the device asks it FIRST when deciding whether to
 * leave the description blank (a p2p counterparty answers "who", not "what
 * for"): measured on one real mailbox, 19 of 104 rows read p2p, 7 of them were
 * merchants, and 5 imported with an empty description although the mail had
 * printed a perfectly good merchant string.
 *
 * Properties pinned, on one VIB layout with only the counterparty changing:
 *   • a person's name           → p2p_transfer, and it seals as reader_type
 *   • a VQRQ… virtual account   → NOT p2p; ecommerce_receipt, seller mark first
 *   • a "CÔNG TY …" account     → NOT p2p; ecommerce_receipt
 *   • a counterparty that is only digits → NULL: the reader does not say, and
 *     nothing downstream is taught a coin flip
 *   • what the label LEARNER is taught follows the verdict: a seller mail votes
 *     `merchant` for its unknown counterparty label, a person mail `beneficiary`
 *
 * Every name, account and reference here is synthetic.
 */
import crypto from 'node:crypto';
import { memoryDb, W } from './v2-harness.mjs';

let pass = 0, fail = 0;
const t = (n, ok, d) => { console.log((ok ? '  PASS  ' : '  FAIL  ') + n + (!ok && d !== undefined ? '  -> ' + JSON.stringify(d) : '')); ok ? pass++ : fail++; };

const X = await import('../supabase/functions/_shared/mailbox/extract.mjs');
const ST = await import('../supabase/functions/_shared/mailbox/stage.mjs');
const F = await import('../supabase/functions/_shared/mailbox/formats.mjs');
const LT = await import('../supabase/functions/_shared/mailbox/labeltable.mjs');

const SUBJECT = 'Chuyển tiền nhanh đến tài khoản ngân hàng nội địa thành công';

/* The nine-label VIB transfer, with the beneficiary cell and the memo as the
   only variables: everything a shape-based rule can see is identical in all
   four mails below. */
const mail = (beneficiary, memo) => [
  'Kính gửi Quý khách NGUYEN VAN TEST,',
  'VIB xin thông báo giao dịch chuyển tiền nhanh của Quý khách đã được thực hiện thành công với thông tin như sau:',
  '',
  '| Loại giao dịch | Chuyển tiền nhanh đến tài khoản ngân hàng nội địa |',
  '| Thời gian giao dịch | 14:05:12 22/09/2026 |',
  '| Từ tài khoản | 000111222333444 |',
  '| Đến tài khoản | ' + beneficiary + ' |',
  '| Số tiền | 120.000 ₫ |',
  '| Phí (bao gồm VAT) | 0 ₫ |',
  '| Diễn giải | ' + memo + ' |',
  '| Mã giao dịch | FT26265000123 |',
  '',
  'Cảm ơn Quý khách đã sử dụng dịch vụ của VIB.',
].join('\n');

const PERSON  = mail('1000002279 - TRAN THI B', 'TRAN THI B tra tien com trua');
const SELLER  = mail('VQRQ0001zqab - LE VAN C', 'thanh toan don hang');
const COMPANY = mail('0987654321 - CONG TY TNHH ZQ MART', 'thanh toan don hang');
const OPAQUE  = mail('0987654321', 'giao dich tu dong');

console.log('\n-- the reader, on four mails of ONE shape --');
const read = (body) => LT.readLabelTable(SUBJECT, body);
const person = read(PERSON), seller = read(SELLER), company = read(COMPANY), opaque = read(OPAQUE);

t('all four parse: the shape is identical', !!person && !!seller && !!company && !!opaque);
t('a person on the other side → p2p_transfer', person && person.transaction_type === 'p2p_transfer', person && person.transaction_type);
t('a VQRQ… virtual account is a seller, not a friend', seller && seller.transaction_type === 'ecommerce_receipt', seller && seller.transaction_type);
t('...even though the name behind the prefix reads as a person', LT.looksLikePerson(LT.nameKey('VQRQ0001zqab - LE VAN C')) === true && LT.sellerMark({ counterparty: 'VQRQ0001zqab - LE VAN C' }) === 'purchase');
t('a legal entity is a seller', company && company.transaction_type === 'ecommerce_receipt', company && company.transaction_type);
t('a counterparty the reader cannot place → null, not a guess', opaque && opaque.transaction_type === null, opaque && opaque.transaction_type);
t('...and a null verdict carries no provenance either', opaque && opaque.src && opaque.src.transaction_type === undefined, opaque && opaque.src);
t('the rows read the same for all four: the SHAPE never changed', [person, seller, company, opaque].every((r) => r.counterparty_row === 'beneficiary' && r.amount === 120000 && r.direction === 'debit'));

console.log('\n-- the old rule was structural: these are what it answered p2p on --');
t('a merchant ROW under transfer wording is a receipt', (LT.readLabelTable(SUBJECT, [
  '| Loại giao dịch | Chuyển tiền nhanh đến tài khoản ngân hàng nội địa |',
  '| Thời gian giao dịch | 14:05:12 22/09/2026 |',
  '| Điểm giao dịch | ZQ MART 01 |',
  '| Số tiền | 120.000 ₫ |',
].join('\n')) || {}).transaction_type === 'ecommerce_receipt');
/* A shop-shaped NAME in a beneficiary cell, with no structural mark on it, is
   the honest null: it is not a person, and nothing in the mail says seller
   either. The device shows such a row for review with no pre-selected shape. */
t('a name that is neither a person nor a marked seller → null',
  (read(mail('ZQ MART 01', 'thanh toan')) || {}).transaction_type === null);
t('a till memo marks the seller even behind a personal-looking name',
  (read(mail('0000000002 - TRAN THI B', 'TT HD BH00120')) || {}).transaction_type === 'ecommerce_receipt');
t('the beneficiary BANK as the only counterpart is still bank_txn (a card bill)',
  (LT.readLabelTable(SUBJECT, [
    '| Loại giao dịch | Thanh toán thẻ tín dụng |',
    '| Thời gian giao dịch | 14:05:12 22/09/2026 |',
    '| Tại ngân hàng | Ngân hàng TMCP ZQ |',
    '| Số tiền | 120.000 ₫ |',
    '| Số thẻ | 401234xxxxxx5140 |',
  ].join('\n')) || {}).transaction_type === 'bank_txn');

console.log('\n-- what the label learner is taught follows the verdict --');
/* deriveLabelMappings votes `beneficiary` only under p2p_transfer and
   `merchant` only under ecommerce_receipt. A seller's name IS a merchant label,
   so a mail that moves buckets moves what it teaches — and a verdict of null
   teaches nothing at all, which is the rule this file's vote logic already
   states ("no vote at all beats a coin-flip vote"). */
const withUnknownLabel = (body, who) => body.replace('| Mã giao dịch | FT26265000123 |',
  '| Người nhận cuối | ' + who + ' |\n| Mã giao dịch | FT26265000123 |');
const votes = (body, who) => LT.deriveLabelMappings(withUnknownLabel(body, who), read(withUnknownLabel(body, who)) || {});
t('a person mail teaches beneficiary', JSON.stringify(votes(PERSON, '1000002279 - TRAN THI B')) === JSON.stringify([{ label: 'nguoi nhan cuoi', field: 'beneficiary' }]), votes(PERSON, '1000002279 - TRAN THI B'));
t('a seller mail teaches merchant', JSON.stringify(votes(SELLER, 'VQRQ0001zqab - LE VAN C')) === JSON.stringify([{ label: 'nguoi nhan cuoi', field: 'merchant' }]), votes(SELLER, 'VQRQ0001zqab - LE VAN C'));
t('an unplaceable counterparty teaches nothing', JSON.stringify(votes(OPAQUE, '0987654321')) === '[]', votes(OPAQUE, '0987654321'));

console.log('\n-- readTransaction seals the verdict as reader_type, model off --');
const msgFor = (body) => ({
  from: 'VIB <info@vib.com.vn>', subject: SUBJECT, body,
  dkim: { pass: true, result: 'pass' }, internalDate: Date.now(),
});
async function sealed(body) {
  let calls = 0;
  const msg = msgFor(body);
  const r = await X.readTransaction(msg, memoryDb(), {
    llm: {}, subtle: crypto.webcrypto.subtle, senderKind: 'bank', provider: 'VIB',
    // A store of its own per mail: three mails of ONE layout share a format
    // key, and this file is about the reader, not about what a sibling mail
    // left in a process-wide cache.
    formats: F.memoryFormatStore(crypto.webcrypto.subtle),
    fetch: async () => { calls++; throw new Error('the model must not be asked'); },
  });
  const x = r.ok ? r.extraction : {};
  return { calls, x, box: ST.buildPayload({ reading: W.toReading(x, msg), senderKind: 'bank', readerV: 2 }) };
}

{
  const s = await sealed(PERSON);
  t('read with no model call', s.calls === 0 && s.x.amount === 120000, s.x);
  t('reader_type p2p_transfer inside the box', s.box.raw_extracted.reader_type === 'p2p_transfer', s.box.raw_extracted.reader_type);
  t('counterparty_kind agrees: person', s.box.raw_extracted.counterparty_kind === 'person', s.box.raw_extracted.counterparty_kind);
}
{
  const s = await sealed(SELLER);
  t('reader_type ecommerce_receipt inside the box', s.box.raw_extracted.reader_type === 'ecommerce_receipt', s.box.raw_extracted.reader_type);
  t('counterparty_kind agrees: merchant', s.box.raw_extracted.counterparty_kind === 'merchant', s.box.raw_extracted.counterparty_kind);
  t('the memo the mail printed still travels: the device has something to show',
    s.box.raw_extracted.memo === 'thanh toan don hang', s.box.raw_extracted.memo);
}
{
  const s = await sealed(OPAQUE);
  t('an unplaceable counterparty seals reader_type null', s.box.raw_extracted.reader_type === null, s.box.raw_extracted.reader_type);
}
{
  /* THE COLUMN THE DEVICE'S DEDUP ENGINE READS IS NOT THIS VERDICT. It is
     derived from the SENDER KIND in stage.mjs (transactionTypeFor) and must be
     'bank_txn' for every mail above, whatever the reader said. */
  const all = await Promise.all([PERSON, SELLER, OPAQUE].map(sealed));
  t('transaction_type is still the sender-kind derivation, top level and in the box',
    all.every((s) => s.box.transaction_type === 'bank_txn' && s.box.raw_extracted.transaction_type === 'bank_txn'),
    all.map((s) => s.box.transaction_type));
}

console.log('\n' + (fail === 0 ? 'ALL ' + pass + ' PASSED' : pass + ' passed, ' + fail + ' FAILED'));
process.exit(fail ? 1 : 0);
