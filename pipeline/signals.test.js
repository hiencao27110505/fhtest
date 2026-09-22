#!/usr/bin/env node
/* The signal detector: what the mail ITSELF says the movement was.
 * `node pipeline/signals.test.js`
 *
 * One deterministic server module replaces four device copies of the
 * card-repayment wording, three of the own-name check, and the salary, refund,
 * fee and seller-mark lists (docs/specs/email-reading-v2-spec.md §5, §8.4, R9).
 * It reads only what the mail states and answers NULL when the mail does not
 * say; it never falls back to "probably a purchase".
 *
 * Every fixture here is SYNTHETIC.
 *
 * Properties pinned:
 *   • every signal in contract.mjs SIGNALS can be reached, with a node that is
 *     its single node or one of its listed candidates, picked by the mail's words
 *   • E7: card_repayment needs repayment wording AND no merchant; a card number
 *     alone is never proof
 *   • own_transfer is letter-for-letter name equality, ignoring case and accents
 *   • the tie-break: a transfer-type signal loses to a seller or a person
 *   • E12: virtual-account prefixes, legal-entity names and till memos mark a
 *     seller; an unknown prefix marks nothing
 *   • PROVENANCE IS GRADED: printed (a structural fact), template (frozen in a
 *     format), heuristic (free-text wording in a memo or counterparty string)
 *   • on model-read mail the detector is a cross-check: a disagreement seals
 *     signal null AND keeps src.signal, so the device can tell "withdrawn"
 *     from "the mail never said"
 *   • channel: printed from the kind row or type code, heuristic from elsewhere
 */
const url = await import('node:url');
const HERE = url.fileURLToPath(new URL('.', import.meta.url));
const ROOT = HERE + '../supabase/functions/_shared/mailbox/';
const S = await import(ROOT + 'signals.mjs');
const C = await import(ROOT + 'contract.mjs');
const { detectSignal, counterpartyKind, detectChannel, sellerMark, crossCheckSignal, nodeForSignal } = S;

let pass = 0, fail = 0;
const t = (n, ok, d) => { console.log((ok ? '  PASS  ' : '  FAIL  ') + n + (!ok && d !== undefined ? '  -> ' + JSON.stringify(d) : '')); ok ? pass++ : fail++; };
const sig = (reading, ctx) => detectSignal(reading, ctx || {});

console.log('\n-- null when the mail does not say --');
t('nothing at all → null', sig({}).signal === null);
t('an amount and a direction say nothing about WHAT it was', sig({ amount: 1, direction: 'debit' }, { subject: 'Thông báo giao dịch' }).signal === null);
t('a counterparty nobody can place → null, never "probably a purchase"', sig({ counterparty: 'ZQXW 77', direction: 'debit' }).signal === null);

console.log('\n-- every signal is reachable, and its node is one the contract allows --');
const CASES = [
  ['purchase', { counterparty: 'ZQ MART 01', counterparty_row: 'merchant', direction: 'debit' }, {}],
  ['bill_payment', { memo: 'Thanh toan hoa don tien dien thang 8', direction: 'debit' }, { senderKind: 'bank' }],
  ['fee', { txn_kind: 'Thu phí thường niên thẻ', direction: 'debit' }, { senderKind: 'bank' }],
  ['p2p', { counterparty: '0000000002 - TRAN THI B', counterparty_row: 'beneficiary', direction: 'debit' }, {}],
  ['own_transfer', { counterparty: '0000000002 - NGUYEN VAN A', holder_name: 'Nguyễn Văn A', direction: 'debit' }, {}],
  ['card_repayment', { counterparty: 'Ngân hàng TMCP ZQ', counterparty_row: 'cp_bank', card_masked: '0000', direction: 'debit' }, { subject: 'Thanh toán thẻ tín dụng ZQ thành công' }],
  ['wallet_move', { memo: 'Nap tien vao vi ZQPay', direction: 'debit' }, {}],
  ['cash_move', { txn_kind: 'Rút tiền mặt tại ATM', direction: 'debit' }, {}],
  ['savings_move', { txn_kind: 'Mở tiền gửi có kỳ hạn', direction: 'debit' }, {}],
  ['broker_funding', { txn_kind: 'Nộp tiền vào tài khoản chứng khoán', direction: 'debit' }, { senderKind: 'broker' }],
  ['fx_exchange', { txn_kind: 'Mua ngoại tệ', direction: 'debit' }, {}],
  ['securities_trade', { direction: 'debit' }, { subject: 'Thông báo kết quả khớp lệnh mua', senderKind: 'broker' }],
  ['yield', { memo: 'Tra co tuc dot 1 nam 2026', direction: 'credit' }, { senderKind: 'broker' }],
  ['salary', { memo: 'CTY ZQ thanh toan luong thang 9', direction: 'credit' }, {}],
  ['refund', { txn_kind: 'Hoàn tiền giao dịch', direction: 'credit' }, {}],
  ['loan_disbursement', { direction: 'credit' }, { subject: 'Thông báo giải ngân khoản vay', senderKind: 'lender' }],
  ['installment', { memo: 'Thanh toan ky 3 khoan tra gop', direction: 'debit' }, { senderKind: 'lender' }],
];
t('the table covers the whole closed list', CASES.map((c) => c[0]).sort().join() === Object.keys(C.SIGNALS).sort().join(), CASES.map((c) => c[0]));
for (const [want, reading, ctx] of CASES) {
  const got = sig(reading, ctx);
  const def = C.SIGNALS[want];
  const nodeOk = def.node ? got.node === def.node : (def.nodes ? (got.node === null || def.nodes.includes(got.node)) : got.node === null);
  t(want, got.signal === want && nodeOk, got);
}

console.log('\n-- the node is picked by the mail\'s own words, among the candidates only --');
t('cash_move: a withdrawal is cashout', sig({ txn_kind: 'Rút tiền mặt tại ATM' }).node === 'cashout');
t('cash_move: a deposit is cashin', sig({ txn_kind: 'Nộp tiền mặt tại quầy' }).node === 'cashin');
t('refund: cashback wording is cashback', sig({ txn_kind: 'Hoàn tiền cashback', direction: 'credit' }).node === 'cashback');
t('refund: otherwise purchaserefund', sig({ txn_kind: 'Hoàn tiền giao dịch', direction: 'credit' }).node === 'purchaserefund');
t('fee: a bank\'s annual fee is bankfees', sig({ txn_kind: 'Thu phí thường niên thẻ', direction: 'debit' }, { senderKind: 'bank' }).node === 'bankfees');
t('fee: the same words from a non-bank are fees', sig({ txn_kind: 'Thu phí thường niên', direction: 'debit' }, { senderKind: 'wallet' }).node === 'fees');
t('savings_move: a term deposit is termdeposit', sig({ txn_kind: 'Mở tiền gửi có kỳ hạn' }).node === 'termdeposit');
t('savings_move: otherwise savings', sig({ txn_kind: 'Gửi tiết kiệm' }).node === 'savings');
t('yield: a dividend', sig({ memo: 'tra co tuc', direction: 'credit' }).node === 'dividend');
t('yield: interest', sig({ memo: 'tra lai tien gui', direction: 'credit' }).node === 'savinterest');
t('securities_trade: a fund certificate', sig({ txn_kind: 'Khớp lệnh mua chứng chỉ quỹ' }).node === 'fund');
t('loan_disbursement: a pay-later lender is bnpl', sig({ direction: 'credit' }, { subject: 'Giải ngân', senderKind: 'lender', provider: 'Kredivo' }).node === 'bnpl');
t('loan_disbursement: a finance company is consumerfinance', sig({ direction: 'credit' }, { subject: 'Giải ngân', senderKind: 'lender', provider: 'ZQ Credit' }).node === 'consumerfinance');
t('bill_payment: utilities only when the words name a utility', sig({ memo: 'thanh toan hoa don tien dien', direction: 'debit' }).node === 'utilities');
t('bill_payment: otherwise the merchant path decides (E14a)', sig({ memo: 'thanh toan hoa don ZQ0001', direction: 'debit' }).node === null);
t('purchase and p2p never carry a node from here', sig(CASES[0][1]).node === null && sig(CASES[3][1]).node === null);
t('nodeForSignal refuses a node outside the signal\'s candidates', nodeForSignal('cash_move', 'coffee') === null && nodeForSignal('cash_move', 'cashin') === 'cashin' && nodeForSignal('card_repayment', 'coffee') === 'cardpay');

console.log('\n-- E7: a card number is not proof of a repayment --');
t('a card number alone → not a repayment', sig({ card_masked: '0000', counterparty: 'ZQ MART', counterparty_row: 'merchant', direction: 'debit' }).signal === 'purchase');
t('repayment wording + a MERCHANT → not a repayment', sig({ memo: 'thanh toan the tin dung', card_masked: '0000', counterparty: 'ZQ COFFEE', counterparty_row: 'merchant', direction: 'debit' }).signal === 'purchase');
t('repayment wording typed to a PERSON → p2p (visible), not a hidden transfer', sig({ memo: 'thanh toan the tin dung cho me', counterparty: 'TRAN THI B', direction: 'debit' }).signal === 'p2p');
t('repayment wording + no counterparty at all → a repayment', sig({ memo: 'Thanh toan sao ke the 08/2026', direction: 'debit' }).signal === 'card_repayment');
t('repayment wording + the issuer as counterparty → a repayment', sig({ memo: 'Tra no the', counterparty: 'Ngân hàng TMCP ZQ', direction: 'debit' }).signal === 'card_repayment');

console.log('\n-- own_transfer: letter for letter, ignoring case and accents --');
const kind = (r, c) => counterpartyKind(r, c || {}).kind;
t('same letters, different accents and case → self', kind({ counterparty: 'NGUYEN VAN A', holder_name: 'Nguyễn Văn A' }) === 'self');
t('the account tail beside the name does not matter', kind({ counterparty: '0000000002 - NGUYEN VAN A', holder_name: 'NGUYEN VAN A' }) === 'self');
t('one letter off → NOT self', kind({ counterparty: 'NGUYEN VAN AN', holder_name: 'NGUYEN VAN A' }) !== 'self');
t('no holder name → never self', kind({ counterparty: 'NGUYEN VAN A' }) === 'person');
t('a model\'s own "self" is re-checked, not trusted', kind({ counterparty: 'TRAN THI B', holder_name: 'NGUYEN VAN A', counterparty_kind: 'self' }) === 'person');
t('the bank\'s auto-fill memo "A chuyen tien den A" is an own transfer too', sig({ memo: 'NGUYEN VAN A chuyen tien den NGUYEN VAN A - 0000000002' }).signal === 'own_transfer');
t('..."A chuyen tien den B" is not', sig({ memo: 'NGUYEN VAN A chuyen tien den TRAN THI B - 0000000002' }).signal !== 'own_transfer');

console.log('\n-- counterparty_kind --');
t('a merchant ROW → merchant, printed', JSON.stringify(counterpartyKind({ counterparty: 'ZQ MART', counterparty_row: 'merchant' }, {})) === '{"kind":"merchant","src":"printed"}');
t('the beneficiary-bank row → bank', kind({ counterparty: 'Ngân hàng TMCP ZQ', counterparty_row: 'cp_bank' }) === 'bank');
t('"Ngân hàng …" anywhere → bank', kind({ counterparty: 'NGAN HANG ZQ' }) === 'bank');
t('a wallet\'s own name → wallet', kind({ counterparty: 'MOMO' }) === 'wallet' && kind({ counterparty: 'Ví ZaloPay' }) === 'wallet');
t('a Vietnamese name → person', kind({ counterparty: 'TRAN THI B' }) === 'person');
t('anything else → unknown', kind({ counterparty: 'ZQXW 77' }) === 'unknown');
t('nobody named → null', kind({}) === null);
t('a kind the model stated stands when nothing printed contradicts it', JSON.stringify(counterpartyKind({ counterparty: 'ZQXW 77', counterparty_kind: 'wallet' }, {})) === '{"kind":"wallet","src":"model"}');

console.log('\n-- E12: the marks only a payment system leaves --');
for (const va of ['99MM00000M00000001', 'ZLP000000123', 'ZION-0001', 'MS01P000000123', 'MS02T000000123', 'VQRQ0001abcd', 'PHATLOC000123', 'LOCPHAT000123', 'KOV000123456']) {
  t('virtual-account prefix ' + va.slice(0, 6) + '…', sellerMark({ counterparty: va + ' - ZQ SHOP' }) === 'purchase', sellerMark({ counterparty: va + ' - ZQ SHOP' }));
}
t('MOMO_ / PAYOO account names', sellerMark({ counterparty: '0000000002 - MOMO_ZQ SHOP' }) === 'purchase' && sellerMark({ counterparty: 'PAYOO ZQ' }) === 'purchase');
for (const name of ['CONG TY TNHH ZQ', 'CTY CP ZQ', 'ZQ JSC', 'ZQ CO LTD', 'HO KINH DOANH ZQ', 'HKD ZQ', 'CUA HANG ZQ']) {
  t('legal entity: ' + name, sellerMark({ counterparty: name }) === 'bizpay', sellerMark({ counterparty: name }));
}
t('a till memo: QR + digits + TT + brand', sellerMark({ counterparty: 'TRAN THI B', memo: 'QR000001TT ZQMART' }) === 'purchase');
t('a till memo: TT HD …', sellerMark({ counterparty: 'TRAN THI B', memo: 'TT HD BH00120' }) === 'purchase');
t('an UNKNOWN prefix is not a mark', sellerMark({ counterparty: 'ABCD00000000001 - TRAN THI B' }) === null);
t('a personal account is all digits: not a mark', sellerMark({ counterparty: '0000000002 - TRAN THI B', memo: 'cam on anh' }) === null);
t('an issuer\'s name is never a shop', sellerMark({ counterparty: 'NGAN HANG TMCP ZQ', memo: 'TT HD 1' }) === null);
t('a seller mark sets counterparty_kind merchant → purchase', sig({ counterparty: '99MM00000M00000001 - MOMO_ZQ SHOP', counterparty_row: 'beneficiary', direction: 'debit' }).signal === 'purchase');

console.log('\n-- the tie-break: toward visibility --');
t('"nap tien vao vi" to a SELLER → purchase', sig({ memo: 'nap tien vao vi', counterparty: 'CONG TY TNHH ZQ', direction: 'debit' }).signal === 'purchase');
t('"gui tiet kiem" to a PERSON → p2p', sig({ memo: 'gui tiet kiem giup me', counterparty: 'TRAN THI B', direction: 'debit' }).signal === 'p2p');
t('the same words with nobody named → the transfer-type signal', sig({ memo: 'gui tiet kiem', direction: 'debit' }).signal === 'savings_move');
t('money that arrives is never a fee or a bill', sig({ txn_kind: 'Thu phí thường niên', direction: 'credit' }).signal === null);
t('money that leaves is never a salary', sig({ memo: 'thanh toan luong thang 9', direction: 'debit' }).signal === null);
t('"số lượng" is not "lương"', sig({ memo: 'so luong 3 cai', direction: 'credit' }).signal === null);

console.log('\n-- provenance is GRADED, not always heuristic --');
const src = (r, c) => sig(r, c).src;
t('own_transfer from an exact printed-name match → printed', src({ counterparty: 'NGUYEN VAN A', holder_name: 'NGUYEN VAN A' }) === 'printed');
t('own_transfer from the memo\'s wording → heuristic', src({ memo: 'NGUYEN VAN A chuyen tien den NGUYEN VAN A - 0000000002' }) === 'heuristic');
t('card_repayment: wording in the SUBJECT + a labelled card row → printed',
  src({ card_masked: '0000', counterparty: 'Ngân hàng TMCP ZQ', counterparty_row: 'cp_bank', direction: 'debit' }, { subject: 'Thanh toán thẻ tín dụng ZQ thành công' }) === 'printed');
t('card_repayment: wording in the KIND ROW + a card row → printed', src({ card_masked: '0000', txn_kind: 'Thanh toán dư nợ thẻ', direction: 'debit' }) === 'printed');
t('card_repayment: structural wording but NO card row → heuristic', src({ txn_kind: 'Thanh toán dư nợ thẻ', direction: 'debit' }) === 'heuristic');
t('card_repayment: wording only in a MEMO → heuristic, card row or not', src({ card_masked: '0000', memo: 'thanh toan sao ke the', direction: 'debit' }) === 'heuristic');
t('a signal frozen in a format → template', src({ signal_hint: 'card_repayment', counterparty: 'Ngân hàng TMCP ZQ', counterparty_row: 'cp_bank', direction: 'debit' }) === 'template');
t('...and the hint still obeys E7', sig({ signal_hint: 'card_repayment', counterparty: 'ZQ MART', counterparty_row: 'merchant', direction: 'debit' }).signal === 'purchase');
t('the bank\'s own type code → printed', src({ type_code: 'ATM', direction: 'debit' }) === 'printed' && sig({ type_code: 'ATM' }).signal === 'cash_move');
t('purchase off a merchant ROW → printed', src({ counterparty: 'ZQ MART', counterparty_row: 'merchant' }) === 'printed');
t('purchase off a SELLER MARK in a counterparty string → heuristic', src({ counterparty: 'CONG TY TNHH ZQ', counterparty_row: 'beneficiary' }) === 'heuristic');
t('purchase off the kind row → printed', src({ txn_kind: 'Thanh toán dịch vụ - hàng hóa' }) === 'printed');
t('p2p rests on how a name READS → heuristic', src({ counterparty: 'TRAN THI B' }) === 'heuristic');
t('salary wording in a memo → heuristic; in the kind row → printed',
  src({ memo: 'thanh toan luong thang 9', direction: 'credit' }) === 'heuristic' && src({ txn_kind: 'Chi lương', direction: 'credit' }) === 'printed');
t('no signal → no src', src({}) === null);

console.log('\n-- notices --');
t('a statement-ready subject', sig({ mail_kind: 'notice' }, { subject: 'Bảng sao kê thẻ tín dụng tháng 09/2026' }).signal === 'statement_ready');
t('a card due notice', sig({}, { notice: true, subject: 'Thông báo đến hạn thanh toán thẻ' }).signal === 'card_due');
t('an instalment reminder', sig({}, { notice: true, subject: 'Khoản vay của bạn sắp đến hạn' }).signal === 'installment_due');
t('a notice that says none of these → null', sig({}, { notice: true, subject: 'Thông báo' }).signal === null);
t('every notice signal is in the contract', ['statement_ready', 'card_due', 'installment_due'].every((s) => C.NOTICE_SIGNALS.includes(s)));

console.log('\n-- the cross-check on model-read mail --');
const D = (signal, src) => ({ signal, node: null, src: src || 'heuristic' });
t('agree → the signal stands, as the model\'s', JSON.stringify(crossCheckSignal(D('refund'), 'refund', 'cashback')) === JSON.stringify({ signal: 'refund', node: 'cashback', src: 'model', outcome: 'agree' }));
const dis = crossCheckSignal(D('card_repayment'), 'purchase', 'coffee');
t('disagree → signal NULL…', dis.signal === null && dis.node === null && dis.outcome === 'disagree', dis);
t('…and src stays "model": withdrawn, not "never said"', dis.src === 'model', dis);
t('detector only → the detector\'s answer and its own grade', JSON.stringify(crossCheckSignal({ signal: 'own_transfer', node: 'bankbank', src: 'printed' }, null)) === JSON.stringify({ signal: 'own_transfer', node: 'bankbank', src: 'printed', outcome: 'one_sided' }));
t('model only → the model\'s', crossCheckSignal(D(null), 'salary', null).signal === 'salary' && crossCheckSignal(D(null), 'salary', null).src === 'model');
t('a signal outside the closed list is no answer', crossCheckSignal(D(null), 'probably_a_purchase', null).outcome === 'none');
t('neither → none, and no src', crossCheckSignal(D(null), null).src === null);

console.log('\n-- channel --');
t('QR from the kind row → printed', JSON.stringify(detectChannel({ txn_kind: 'Thanh toán QR' }, {})) === '{"channel":"QR","src":"printed"}');
t('ATM from the type code → printed', detectChannel({ type_code: 'ATM' }, {}).channel === 'ATM');
t('POS from an "MPOS*" merchant string → heuristic', JSON.stringify(detectChannel({ counterparty: 'MPOS*ZQ MART' }, {})) === '{"channel":"POS","src":"heuristic"}');
t('transfer from the subject → heuristic', detectChannel({}, { subject: 'Chuyển tiền thành công' }).channel === 'transfer');
t('online from the kind row', detectChannel({ txn_kind: 'Thanh toán trực tuyến' }, {}).channel === 'online');
t('a model\'s channel stands when nothing printed says otherwise', detectChannel({ channel: 'POS' }, {}).channel === 'POS');
t('nothing says → null', detectChannel({ counterparty: 'ZQ MART' }, { subject: 'Thông báo giao dịch' }).channel === null);
t('every channel is in the contract', ['QR', 'POS', 'ATM', 'online', 'transfer'].every((c) => C.CHANNELS.includes(c)));

console.log('\n' + (fail === 0 ? 'ALL ' + pass + ' PASSED' : pass + ' passed, ' + fail + ' FAILED'));
process.exit(fail ? 1 : 0);
