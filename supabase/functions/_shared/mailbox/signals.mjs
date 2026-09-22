/**
 * What the mail ITSELF says about the movement: the signal detector.
 *
 * WHY ONE MODULE. Until now the server stated figures and the DEVICE guessed
 * what they meant, from free text, in four places that drifted apart:
 *   57-csv-import-review.js   card-repayment wording, salary/refund/interest words
 *   72-txn-review.js          _CARD_PAY_RX, _ISSUER_RX, the bank-generic memo list
 *   13-partition.js           fhTransferShape, fhLooksSelfTransfer, fhSellerSignal
 *   59-statement-table.js     the statement flow classifier
 * Four copies of the card-repayment wording, three of the own-name check. And
 * 91% of rows come from a local tier that carries no judgement at all, so most
 * rows reached review with a kind guessed from the direction alone. This module
 * is where those vocabularies are stated ONCE, on the server, where the whole
 * mail is in hand (email-reading-v2 §5, §8.4, decision R9). The device copies
 * stay as the fallback for v1 rows and retire as the scoreboard shows parity.
 *
 * WHAT IT MAY READ: only what the mail states. `type_code`, the transaction-kind
 * row, the memo, the subject's shape, the sender's class, and the two-sides
 * fields (`holder_name`, `counterparty`, `counterparty_kind`, `card_masked`,
 * `account_kind`). It knows nothing the person owns; that is the device's half
 * (§9). And when the mail does not say, the answer is NULL. Never "probably a
 * purchase": a null is a row the person files in one tap, a wrong signal is a
 * pre-selection they have to notice.
 *
 * Pure and deterministic: no I/O, no clock, no model. Rules induced by the
 * model were considered and rejected (R9): unreviewable regexes written by a
 * small model are the correctness risk this design exists to rule out.
 */

import { SIGNALS, NOTICE_SIGNALS, SRC, CHANNELS, COUNTERPARTY_KINDS } from './contract.mjs';
import { looksLikePerson } from './labeltable.mjs';

/* Deburred, lower-cased, punctuation to spaces, padded: every regex below can
   use plain spaces as word boundaries and none has to think about accents. */
function _flat(s) {
  const t = String(s == null ? '' : s)
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd').replace(/Đ/g, 'D')
    .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  return t ? ' ' + t + ' ' : '';
}

/** Letters only, the account or phone tail dropped: the form two printings of
 *  one name agree on ("NGUYEN VAN A - 0000 1234" and "Nguyễn Văn A"). */
export function nameKey(raw) {
  const parts = String(raw == null ? '' : raw).split(/\s+[-–|]\s+/);
  // "ACCOUNT - NAME" and "NAME - ACCOUNT" are both printed; the name is the
  // part with the fewest digits.
  let best = parts[0] || '';
  for (const p of parts) if ((p.match(/\d/g) || []).length < (best.match(/\d/g) || []).length) best = p;
  return _flat(best).replace(/[0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
}

/* ── who was paid: the marks only a payment SYSTEM leaves (E12, E13) ─────────
   Kept consistent with fhSellerSignal in src/js-ui/13-partition.js, which the
   device keeps running on v1 rows. Measured there on two real mailboxes: 143 of
   273 yearly transfers in one and 56 of 158 in the other carry one of these
   marks, and not one of them also carries a person-to-person note. None of it
   reads a payee's NAME for meaning. An unknown prefix is NOT a mark: a missing
   rule makes the answer shallower, never wrong. [\dX] because some transports
   mask digits. */
const _VA_RX = [/^99MM[\dX]/, /^99ZP[\dX]/, /^ZLP[\dX]{6}/, /^ZION-/i, /^9627952[\dX]/, /^9990018[\dX]/, /^9990009[\dX]/,
  /^MS0[\dX][PT][\dX]{6}/, /^VQRQ[A-Z0-9]{4}/i, /^(PHATLOC|LOCPHAT)[\dX]{3}/, /^(V3)?KOV[\dX]{3}/, /^MWGVN/,
  /^AGBVMSP/, /^(PMC|PSP)[\dX]{10}/, /^MD18[\dX]{10}/, /^[\dX]{6,}QR[A-Z]{3}[\dX]{2}$/, /^MB?999[\dX]{6}/,
  /^962NPS/, /^HE1TINGEE/, /^[A-Z0-9]{8,}VCB$/];
const _PSP_NAME_RX = /(^|[\s|\-])(momo_|zalopay_|payoo[ _\-*])/;
const _BIZ_RX = /\b(cong ty|cty|ct tnhh|ct cp|tnhh|co phan|hkd|ho kinh doanh|dntn|doanh nghiep tu nhan|company|limited|corporation|jsc|co ltd|ltd|cua hang|nha thuoc|tiem)\b/;
const _TILL_MEMO_RX = [/^tt hd\b/, /^\d{5} [a-z0-9]{5}$/, /^qr[a-z0-9]{6}tt\b/, /^qr\d+tt\b/, /^kovqr[a-z0-9]+$/, /^(vqrloamb|mbts)[a-z0-9]+$/,
  /^[a-z0-9]{15} \d{9}$/, /\bthanh toan qrcode tai\b/, /^thanh toan cho .+\([^)]+\)$/];
const _ISSUER_RX = /\bngan hang\b|\bnh tmcp\b|\btmcp\b|\bbank\b/;

function _deburr(s) {
  return String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase();
}

/** 'bizpay' when the account name is a legal entity, 'purchase' for any other
 *  seller mark, null otherwise. The same three answers fhSellerSignal gives. */
export function sellerMark(reading) {
  const r = reading || {};
  const segs = [];
  for (const v of [r.counterparty, r.counterparty_account_tail, r.memo]) {
    for (const x of String(v == null ? '' : v).split('|')) { const t = x.trim(); if (t) segs.push(t); }
  }
  if (!segs.length) return null;
  const flat = _deburr(segs.join(' | '));
  if (/\bngan hang\b/.test(flat)) return null;               // an issuer's name: a repayment, not a shop
  let mark = _PSP_NAME_RX.test(flat);
  for (let i = 0; i < segs.length && !mark; i++) {
    for (const tok of segs[i].split(/\s+-\s+|\s+/)) {
      const tk = tok.replace(/[.,;:]+$/, '');
      if (tk.length < 8 || !/[\dX]/.test(tk)) { if (!/^ZION-/i.test(tk)) continue; }
      if (_VA_RX.some((rx) => rx.test(tk))) { mark = true; break; }
    }
  }
  for (let i = 0; i < segs.length && !mark; i++) {
    const m = _deburr(segs[i]).replace(/\s+/g, ' ').trim();
    if (_TILL_MEMO_RX.some((rx) => rx.test(m))) mark = true;
  }
  if (_BIZ_RX.test(flat.replace(/[^a-z0-9]+/g, ' '))) return 'bizpay';
  return mark ? 'purchase' : null;
}

const _WALLET_NAME_RX = /^ (?:vi (?:dien tu )?)?(?:momo|zalopay|zalo pay|shopeepay|shopee pay|airpay|viettel money|viettelpay|vnpt money|vnpt pay|moca|smartpay) (?:$|vi |wallet )/;

/**
 * Who is on the other side: person | merchant | bank | wallet | self | unknown,
 * or null when the mail names nobody.
 *
 * `self` is the strictest: the printed counterparty name equals `holder_name`
 * letter for letter, ignoring case and accents (spec §8.3 rule 7). `merchant`
 * is a merchant/POS ROW (a printed fact) or a structural seller mark. A kind the
 * model stated stands when no printed fact or seller mark contradicts it; its
 * own `self` is re-checked here, because a wrong `self` hides an expense.
 */
export function counterpartyKind(reading, ctx) {
  const r = reading || {};
  if (!r.counterparty) return { kind: null, src: null };
  const cp = nameKey(r.counterparty);
  const holder = nameKey(r.holder_name);
  // Two PRINTED names that are the same letters: a fact of the mail, not a guess.
  if (holder && holder.length >= 6 && cp === holder) return { kind: 'self', src: SRC.PRINTED };
  if (r.counterparty_row === 'merchant') return { kind: 'merchant', src: SRC.PRINTED };
  if (sellerMark(r)) return { kind: 'merchant', src: SRC.HEURISTIC };

  const said = COUNTERPARTY_KINDS.indexOf(r.counterparty_kind) >= 0 ? r.counterparty_kind : null;
  if (said && said !== 'self' && said !== 'unknown') return { kind: said, src: SRC.MODEL };

  const flat = _flat(r.counterparty);
  if (r.counterparty_row === 'cp_bank') return { kind: 'bank', src: SRC.PRINTED };
  const issuer = ctx && ctx.provider ? _flat(ctx.provider).trim() : '';
  if (_ISSUER_RX.test(flat) || (issuer && issuer.length >= 3 && flat.trim() === issuer)) return { kind: 'bank', src: SRC.HEURISTIC };
  if (_WALLET_NAME_RX.test(flat)) return { kind: 'wallet', src: SRC.HEURISTIC };
  if (looksLikePerson(r.counterparty) || looksLikePerson(cp.toUpperCase())) return { kind: 'person', src: SRC.HEURISTIC };
  return { kind: 'unknown', src: SRC.HEURISTIC };
}

/* ── channel ─────────────────────────────────────────────────────────────── */
const _CHANNEL_RULES = [
  ['ATM', / atm | rut tien mat | cash withdrawal /],
  ['QR', / qr | qrcode | vietqr | vnpayqr | qr pay /],
  ['POS', / pos | mpos | quet the | may pos /],
  ['online', / truc tuyen | online | ecom | ecommerce | e commerce | internet /],
  ['transfer', / chuyen tien | chuyen khoan | ibft | napas 247 | transfer /],
];

/** QR | POS | ATM | online | transfer, or null when nothing in the mail says.
 *  `printed` when the transaction-kind row or the bank's type code says it;
 *  `heuristic` when the word was found in the subject, the memo or the
 *  merchant string ("MPOS*…"). */
export function detectChannel(reading, ctx) {
  const r = reading || {};
  const printedText = _flat(r.txn_kind) + _flat(r.type_code);
  const looseText = _flat(ctx && ctx.subject) + _flat(r.memo) + _flat(String(r.counterparty || '').split(/[*\s]/)[0]);
  for (const [channel, rx] of _CHANNEL_RULES) if (rx.test(printedText)) return { channel, src: SRC.PRINTED };
  if (CHANNELS.indexOf(r.channel) >= 0) return { channel: r.channel, src: (r.src && r.src.channel) || SRC.MODEL };
  for (const [channel, rx] of _CHANNEL_RULES) if (rx.test(looseText)) return { channel, src: SRC.HEURISTIC };
  return { channel: null, src: null };
}

/* ── the wording, stated once ────────────────────────────────────────────── */
/* Card repayment: the union of the four device copies. */
const _CARD_PAY_RX = / thanh toan (?:sao ke |du no )?the(?: tin dung)? | tt the tin dung | tra no the | thanh toan the (?:visa|master|jcb) | credit card payment | tra tien the tin dung | thanh toan du no the /;
const _SELF_MEMO_RX = /^ (.+?) chuyen (?:tien|khoan) (?:den|toi|cho|sang) (.+) $/;
const _WALLET_MOVE_RX = / nap tien vao vi | nap tien vi | nap vi | nap tien vao vi dien tu | top up wallet | wallet top up | rut tien (?:tu|ve|khoi) vi | rut tien ve tai khoan /;
const _ATM_OUT_RX = / rut tien mat | rut tien tai atm | rut tien atm | atm withdrawal | cash withdrawal /;
const _CASH_IN_RX = / nop tien mat | nap tien mat | cash deposit /;
const _SAVINGS_RX = / gui tiet kiem | mo so tiet kiem | tat toan so | tat toan tien gui | tat toan tai khoan tiet kiem | mo tien gui | mo tai khoan tiet kiem | chung chi tien gui | tien gui co ky han | term deposit /;
const _TERM_RX = / chung chi tien gui | co ky han | term deposit /;
const _BROKER_CASH_RX = / nop tien | nap tien | rut tien | chuyen tien (?:vao|ra) | deposit | withdraw(?:al)? /;
const _FX_RX = / mua ngoai te | ban ngoai te | doi ngoai te | currency exchange | fx (?:buy|sell) /;
const _TRADE_RX = / khop lenh | ket qua khop lenh | xac nhan giao dich chung khoan | order matched | trade confirmation /;
const _FUND_RX = / chung chi quy | ccq | quy mo | fund /;
const _BOND_RX = / trai phieu | bond /;
const _YIELD_RX = / co tuc | dividend | coupon | trai tuc | nhan loi nhuan | tra lai | lai tien gui | lai tiet kiem | tien lai | lai suat | interest (?:paid|payment|credit) /;
const _DIVIDEND_RX = / co tuc | dividend | coupon | trai tuc | nhan loi nhuan /;
const _SALARY_RX = / thanh toan luong | tra luong | chi luong | luong thang | nhan luong | luong t\d{1,2} | salary | payroll /;
const _REFUND_RX = / hoan tien | hoan tra | thu hoi tien hoan | refund(?:ed)? | reversal | cashback | hoan phi /;
const _CASHBACK_RX = / cashback | cash back | hoan tien uu dai | hoan tien khuyen mai | tien thuong /;
const _DISBURSE_RX = / giai ngan | disburse(?:ment|d)? /;
const _BNPL_RX = / tra sau | pay later | paylater | bnpl | kredivo | fundiin /;
const _INSTALLMENT_RX = / tra gop ky | ky tra gop | thanh toan ky(?: thu)? \d+ | thanh toan khoan vay | tra no (?:goc|vay) | thu no (?:goc|lai|vay) | thanh toan khoan tra gop | installment /;
const _FEE_RX = / phi thuong nien | phi sms | phi quan ly | phi duy tri | phi dich vu (?:tai khoan|the|sms|ngan hang) | annual fee | phi rut tien | thu phi | phi phat hanh /;
const _BANK_FEE_WORDS_RX = / thuong nien | sms | tai khoan | the | duy tri | annual | phat hanh /;
const _BILL_RX = / thanh toan hoa don | tt hoa don | bill payment | tien dien | tien nuoc | cuoc (?:internet|dien thoai|truyen hinh|vien thong) | nap tien dien thoai | hoa don (?:dien|nuoc|internet|truyen hinh|dien thoai) /;
const _UTILITY_WORDS_RX = / tien dien | tien nuoc | hoa don dien | hoa don nuoc | internet | truyen hinh | cuoc | evn | dien luc | cap nuoc /;
const _PURCHASE_RX = / thanh toan dich vu hang hoa | thanh toan hang hoa dich vu | thanh toan hang hoa | mua hang | purchase | thanh toan qr | thanh toan hoa don qr | giao dich the | thanh toan tai /;

const _NOTICE_RULES = [
  ['statement_ready', / sao ke .*(?:san sang|da co|da duoc gui)| bang sao ke | statement (?:is )?(?:ready|available) | e statement /],
  ['card_due', / den han thanh toan(?: the)? | nhac (?:no|thanh toan) the | thanh toan toi thieu | du no the .*den han | payment due | minimum payment /],
  ['installment_due', / ky tra gop .*den han| khoan vay .*den han | nhac (?:no|thanh toan) khoan vay | den han tra gop | installment due | loan payment due /],
];

/** Signals that say "this was not spending". The tie-break below only ever
 *  takes one of THESE away, never a purchase or a p2p. */
const _TRANSFER_TYPE = new Set(['card_repayment', 'wallet_move', 'cash_move', 'savings_move', 'broker_funding', 'fx_exchange']);

function _pickNode(signal, words, ctx) {
  const def = SIGNALS[signal];
  if (!def) return null;
  if (def.node) return def.node;
  const among = (code) => (def.nodes && def.nodes.indexOf(code) >= 0 ? code : null);
  switch (signal) {
    case 'cash_move': return among(_CASH_IN_RX.test(words) ? 'cashin' : 'cashout');
    case 'savings_move': return among(_TERM_RX.test(words) ? 'termdeposit' : 'savings');
    case 'securities_trade': return among(_FUND_RX.test(words) ? 'fund' : _BOND_RX.test(words) ? 'bond' : 'stock');
    case 'yield': return among(_DIVIDEND_RX.test(words) ? 'dividend' : 'savinterest');
    case 'refund': return among(_CASHBACK_RX.test(words) ? 'cashback' : 'purchaserefund');
    case 'fee': return among(ctx && ctx.senderKind === 'bank' && _BANK_FEE_WORDS_RX.test(words) ? 'bankfees' : 'fees');
    case 'loan_disbursement':
      if (ctx && ctx.senderKind === 'bank') return among('bankloan');
      return among(_BNPL_RX.test(words + _flat(ctx && ctx.provider)) ? 'bnpl' : (ctx && ctx.senderKind === 'lender' ? 'consumerfinance' : 'bankloan'));
    // A bill is only a UTILITY bill when the mail's own words say which
    // utility. Otherwise the merchant path decides (E14a: what was bought
    // outranks the fact that it was a bill).
    case 'bill_payment': return _UTILITY_WORDS_RX.test(words) ? among('utilities') : null;
    default: return null;
  }
}

/**
 * @param {object} reading  one tier's extraction (raw or tidied; both work)
 * @param {{subject?: string, senderKind?: string, provider?: string, notice?: boolean}} ctx
 * @return {{signal: string|null, node: string|null, src: string|null}}
 *   `signal` is a key of contract.mjs SIGNALS or NOTICE_SIGNALS, or null.
 *   `node` is SIGNALS[signal].node, or one of its `nodes` picked by the mail's
 *   own words, or null when the merchant path (classify.mjs) decides.
 */
export function detectSignal(reading, ctx) {
  const r = reading || {};
  const c = ctx || {};
  const none = { signal: null, node: null, src: null };
  const subject = _flat(c.subject);
  const kindRow = _flat(r.txn_kind);
  const memo = _flat(r.memo);
  const code = _flat(r.type_code);
  const words = kindRow + memo + subject + code;

  if (c.notice || r.mail_kind === 'notice') {
    for (const [signal, rx] of _NOTICE_RULES) if (rx.test(subject + kindRow)) return { signal, node: null, src: SRC.HEURISTIC };
    return none;
  }

  const who = COUNTERPARTY_KINDS.indexOf(r.counterparty_kind) >= 0
    ? { kind: r.counterparty_kind, src: (r.src && r.src.counterparty_kind) || SRC.HEURISTIC }
    : counterpartyKind(r, c);
  const cpKind = who.kind;

  /* HOW SURE, NOT JUST WHAT (2026-09-22, from the device build). The device
     shows a row in "Cần bạn xem" when its pre-selected kind rests on a signal
     whose source is `model` or `heuristic`. Grading every detector answer
     `heuristic` would put nearly every transfer and card repayment there,
     including own-account transfers the device pre-selects silently today:
     louder than today, which breaks "no extra taps" (E14). So the grade says
     WHERE the evidence was:
       printed    a structural fact of the mail: the transaction-kind row, the
                  subject, the bank's own type code, a merchant ROW, two printed
                  names that match letter for letter
       template   frozen in a stored format whose subject or labels state it
       heuristic  free-text wording in a memo, or a guess from a counterparty
                  string (a seller mark, a name that reads as a person) */
  const structural = kindRow + subject + code;
  const grade = (rx) => (rx.test(structural) ? SRC.PRINTED : (rx.test(memo) ? SRC.HEURISTIC : null));
  const found = (signal, src) => ({ signal, node: _pickNode(signal, words, c), src });

  // own_transfer: the two printed names are the same letters, or the bank's own
  // auto-fill says so ("A chuyen tien den A - 0123…"), which is memo text.
  if (cpKind === 'self') return found('own_transfer', SRC.PRINTED);
  if (r.flow === 'transfer' && r.src && r.src.flow === SRC.HEURISTIC) return found('own_transfer', SRC.PRINTED);
  const selfMemo = memo.match(_SELF_MEMO_RX);
  if (selfMemo) {
    const a = nameKey(selfMemo[1]), b = nameKey(selfMemo[2]);
    if (a.length >= 6 && a === b) return found('own_transfer', SRC.HEURISTIC);
  }

  // The closed list, most specific wording first.
  const RULES = [
    ['card_repayment', _CARD_PAY_RX], ['cash_move', _ATM_OUT_RX], ['cash_move', _CASH_IN_RX],
    ['wallet_move', _WALLET_MOVE_RX], ['savings_move', _SAVINGS_RX], ['fx_exchange', _FX_RX],
    ['securities_trade', _TRADE_RX],
    ...(c.senderKind === 'broker' ? [['broker_funding', _BROKER_CASH_RX]] : []),
    ['loan_disbursement', _DISBURSE_RX], ['installment', _INSTALLMENT_RX], ['salary', _SALARY_RX],
    ['refund', _REFUND_RX], ['yield', _YIELD_RX], ['fee', _FEE_RX],
  ];
  let signal = null, src = null;
  for (const [name, rx] of RULES) {
    const g = grade(rx);
    if (g) { signal = name; src = g; break; }
  }
  if (!signal && / atm /.test(code)) { signal = 'cash_move'; src = SRC.PRINTED; }
  if (!signal && !/ hoa don qr /.test(words)) { const g = grade(_BILL_RX); if (g) { signal = 'bill_payment'; src = g; } }
  /* A signal FROZEN in the format this mail was read through: stated by the
     format's subject shape or its labels, verified when the format was written. */
  const hint = r.signal_hint && (SIGNALS[r.signal_hint] || NOTICE_SIGNALS.indexOf(r.signal_hint) >= 0) ? r.signal_hint : null;
  if (hint && (!signal || signal === hint)) { signal = hint; src = SRC.TEMPLATE; }

  /* card_repayment is `printed` only on BOTH halves of the evidence: the
     wording in a structural place, AND a labelled card row. A card number alone
     is never proof (E7, below); the wording alone, in a memo, is a guess. */
  if (signal === 'card_repayment' && src === SRC.PRINTED && !r.card_masked) src = SRC.HEURISTIC;

  /* Direction is a separate field and one signal covers both ways, with three
     exceptions that ARE a direction: money that arrives cannot be a fee or a
     bill, and money that leaves cannot be a salary, a refund or a yield. A
     mismatch means the wording was about something else. */
  if (signal && r.direction === 'credit' && (signal === 'fee' || signal === 'bill_payment' || signal === 'installment')) signal = null;
  if (signal && r.direction === 'debit' && (signal === 'salary' || signal === 'refund' || signal === 'yield' || signal === 'loan_disbursement')) signal = null;

  /* E7: A CARD NUMBER IS NOT PROOF OF A REPAYMENT, and neither is the wording
     alone. `card_repayment` also requires that the mail names no merchant: no
     counterparty at all, or the issuer as counterparty. Verified by the device
     work on 204 real mails: 20 repayments, all of them the bank's own
     confirmation, 0 of them naming a merchant; APPLE.COM/BILL, CO.OP MART and
     WAYNESCOFFEE had been queued as "Trả nợ thẻ" on the strength of "Số thẻ". */
  if (signal === 'card_repayment' && !(cpKind == null || cpKind === 'bank' || cpKind === 'self')) signal = null;

  /* THE TIE-BREAK, toward visibility: when unsure between a transfer-type
     signal and purchase/p2p, answer purchase/p2p. A hidden expense is worse
     than a visible wrong one. "Unsure" is concrete here: the words said
     transfer, and the other side is a seller or a person. */
  if (signal && _TRANSFER_TYPE.has(signal) && (cpKind === 'merchant' || cpKind === 'person')) signal = null;

  if (signal) return found(signal, src);
  // A merchant ROW is a printed fact; a seller mark or a model's word is not.
  if (cpKind === 'merchant') return found('purchase', who.src === SRC.PRINTED || who.src === SRC.TEMPLATE ? SRC.PRINTED : SRC.HEURISTIC);
  if (_PURCHASE_RX.test(kindRow + code) || / pos | mpos /.test(code)) return found('purchase', SRC.PRINTED);
  if (cpKind === 'person') return found('p2p', SRC.HEURISTIC);
  return none;
}

/**
 * The detector beside the model, on mail the model read (§8.4): a CROSS-CHECK.
 * Both answer and agree: the signal stands, as the model's. Both answer and
 * disagree: NULL, and the row shows in "Cần bạn xem" on the device. One side
 * only: that side's answer, with its own provenance.
 *
 * @return {{signal, node, src, outcome: 'agree'|'disagree'|'one_sided'|'none'}}
 */
export function crossCheckSignal(detected, modelSignal, modelNode) {
  const known = (s) => (typeof s === 'string' && (SIGNALS[s] || NOTICE_SIGNALS.indexOf(s) >= 0) ? s : null);
  const d = detected && known(detected.signal) ? detected : null;
  const m = known(modelSignal);
  if (d && m) {
    /* WITHDRAWN, VISIBLY. The signal is null and its source is still `model`:
       the device reads "no signal, but a source for one" as "withdrawn after a
       disagreement" and shows the row in "Cần bạn xem", where "no signal and no
       source" means only "the mail never said". */
    if (d.signal !== m) return { signal: null, node: null, src: SRC.MODEL, outcome: 'disagree' };
    return { signal: m, node: nodeForSignal(m, modelNode) || d.node, src: SRC.MODEL, outcome: 'agree' };
  }
  if (d) return { ...d, outcome: 'one_sided' };
  if (m) return { signal: m, node: nodeForSignal(m, modelNode), src: SRC.MODEL, outcome: 'one_sided' };
  return { signal: null, node: null, src: null, outcome: 'none' };
}

/** A node someone proposed for a signal, accepted only when the signal allows
 *  it: its single node, or one of its listed candidates. For purchase and p2p
 *  (node null in the contract) nothing is decided here; classify.mjs decides. */
export function nodeForSignal(signal, proposed) {
  const def = SIGNALS[signal];
  if (!def) return null;
  if (def.node) return def.node;
  if (def.nodes) return def.nodes.indexOf(proposed) >= 0 ? proposed : (def.nodes.length === 1 && signal !== 'bill_payment' ? def.nodes[0] : null);
  return null;
}
