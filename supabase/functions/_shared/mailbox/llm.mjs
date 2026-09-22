/**
 * Asking a model to read one mail.
 *
 * Reached only for a `(sender, subject_template)` we have no stored template
 * for. Every later mail off that template is parsed locally by templates.mjs
 * with nothing leaving at all, which is most volume permanently.
 *
 * THE MAIL IS SENT AS WRITTEN. Real amounts, names, account and reference
 * numbers. Masking was removed on 2026-08-25 and consent replaced it: the
 * `bank_email` sheet states that a first-time bank's mail goes to an AI service
 * to be read, and `FH_CONSENT_V` was bumped so a record predating that no
 * longer counts as agreement. **If you change what is sent here, change the
 * sheet in the same commit** — src/js-data/75-consent-ui.js, and the two are
 * held together by pipeline/llm-raw-body.test.js on the forwarding side.
 *
 * THE PROMPT IS NO LONGER THE FORWARDING PIPELINE'S (2026-09-22). It was copied
 * from there verbatim so both transports derived one shape of template. Under
 * email-reading-v2 the Apps Script stops reading mail at all (R11: it becomes a
 * courier that hands the mail to THIS reader), so there is one prompt again,
 * and it is this one. Until that paste lands the two differ, on purpose; the
 * v4 templates both still write are derived from fields both prompts share.
 */

import { TAX } from './taxonomy.mjs';
import { SIGNALS, NOTICE_SIGNALS, MAIL_KINDS, COUNTERPARTY_KINDS, CHANNELS, TIME_PRECISIONS } from './contract.mjs';

/**
 * Free tier, no card, rate-limited well above what this worker needs given that
 * a learned template costs nothing. Model choice is per-deployment: the schema
 * and prompt do not change with it.
 */
export const DEFAULT_MODEL = 'gemini-3.5-flash-lite';

/* The category-tree codes the model may answer in `node` (0144, taxonomy.mjs),
   by kind. Built once at module load from the generated tree, so a tree edit is
   one regeneration away from the prompt. The manual-only roots ('xunfiled',
   'iunfiled') are a person's verdict, never a model's, and are left out. */
const _codes = (kind) => TAX.nodes.filter((n) => n.kind === kind && !n.manual).map((n) => n.code);
export const EXPENSE_NODE_CODES = _codes('expense');
export const INCOME_NODE_CODES = _codes('income');
export const TRANSFER_NODE_CODES = _codes('transfer');
export const INVESTMENT_NODE_CODES = _codes('investment');
export const LOAN_NODE_CODES = _codes('loan');
export const REPAYMENT_NODE_CODES = _codes('repayment');
export const NODE_CODES = [...EXPENSE_NODE_CODES, ...INCOME_NODE_CODES];

/* ── THE PROMPT: a shared core plus one block per sender class (R8) ──────────
 *
 * One universal prompt asked a small model 20 questions about every mail, most
 * of them irrelevant to the mail in hand, and a third of the answers never
 * reached review (email-reading-v2 §2). senders.mjs knows the sender's class
 * BEFORE the call, so the model is given the core and only the block its class
 * needs: a broker's mail is asked about symbols and quantities and never about
 * card repayments. A shorter prompt also spends less of a free quota.
 *
 * THE CORE IS COPIED VERBATIM from docs/specs/email-reading-v2-spec.md §8.3,
 * where it was agreed line by line; pipeline/prompt-blocks.test.js compares the
 * two, so neither can drift without the other. Change the spec first.
 *
 * WHAT IS ASKED changed here. WHAT IS SENT did not: the mail as written, under
 * the same consent (see the header of this file and `extract` below).
 */
export const CORE_PROMPT =
  'You read ONE email that a Vietnamese bank, e-wallet, broker or lender sent to\n' +
  'its customer, and report what it states. Vietnamese, English, or both.\n' +
  '\n' +
  'mail_kind: exactly one of\n' +
  '  transaction  the mail reports money that moved, or a card that was charged\n' +
  '  notice       a financial notice with no movement: payment due, statement\n' +
  '               ready, instalment reminder\n' +
  '  other        anything else: marketing, OTP, login alert, survey.\n' +
  '               Set every other field to null.\n' +
  '\n' +
  'RULES\n' +
  '1. Report only what the mail prints. Null always beats a guess. Never compute,\n' +
  '   convert, translate, shorten or tidy a value.\n' +
  '2. NEW. For every field you fill from a labelled row, write that label EXACTLY\n' +
  '   as printed into `labels` under the same key (labels.amount = "Số tiền giao\n' +
  '   dịch"). If the value came from a sentence, write "~". These labels teach a\n' +
  '   local reader this format so later mails never reach you: a wrong label is\n' +
  '   worse than "~".\n' +
  '3. amount: the figure that actually moved, as a positive number with no\n' +
  '   separators. Not the balance, not a fee, not a limit, not a promotional or\n' +
  '   cashback figure. amount_raw: the same figure copied character for character.\n' +
  '4. NEW. direction: debit when money left the customer\'s account or card,\n' +
  '   credit when it arrived. Accept only printed evidence: a sign (+ or -), a\n' +
  '   label ("ghi nợ" / "ghi có", "tiền ra" / "tiền vào"), or the mail\'s own\n' +
  '   wording ("bạn đã chuyển", "bạn vừa nhận"). No evidence: null.\n' +
  '5. occurred_at: ISO 8601 with an offset (+07:00 when none is printed).\n' +
  '   occurred_at_raw: copied verbatim. NEW. time_precision: second, minute or day.\n' +
  '6. currency, fx_amount, fx_currency: as today. NEW. fx_rate only if printed.\n' +
  '7. NEW. Two sides. account_tail, account_kind, balance_after, available_limit\n' +
  '   and holder_name describe the CUSTOMER\'S own instrument. counterparty,\n' +
  '   counterparty_account_tail, counterparty_bank and counterparty_kind describe\n' +
  '   the other side. holder_name is the customer\'s own name where the mail\n' +
  '   prints it (the greeting, the remitter on a debit, the beneficiary on a\n' +
  '   credit). counterparty_kind: person, merchant, bank, wallet, self or\n' +
  '   unknown. Answer self only when the printed counterparty name equals\n' +
  '   holder_name letter for letter, ignoring case and accents.\n' +
  '8. counterparty and memo: copied in full, verbatim, never paraphrased, never\n' +
  '   judged for meaning.\n' +
  '9. NEW. fee_amount only when printed as its own figure. status as printed.\n' +
  '10. card_tail: as today (the card being paid down, never the funding account).';

/* Carried over UNCHANGED from the single prompt: the three rules the core
   refers to as "as today", which a model that never saw yesterday's prompt
   needs spelled out. Never guess; never compute a conversion; "a wrongly
   claimed credit card invents a debt". */
export const FIELD_NOTES =
  'FIELD NOTES\n' +
  'currency: the ISO 4217 code the amount is denominated in (VND, USD, EUR, ...), exactly as the ' +
  'email states it. Never default to VND when the mail prints another currency. International ' +
  'card notices from Vietnamese banks often show BOTH a foreign transaction amount and the ' +
  'converted amount actually debited in VND (labelled "Số tiền quy đổi", "Số tiền ghi nợ" or ' +
  'similar). When both are present, amount must be the converted VND figure with currency VND, ' +
  'and the original foreign figure goes into fx_amount and fx_currency. When only a foreign ' +
  'amount is present, amount is that figure with its own currency code and fx_amount/fx_currency ' +
  'stay null. Never compute a conversion yourself: only report figures the mail prints.\n' +
  'account_kind: which kind of account the money moved on, judged only from what the mail itself ' +
  'says. credit_card when the mail shows a credit limit or an outstanding card balance ("Hạn mức ' +
  'khả dụng", "Dư nợ") or names a credit card ("thẻ tín dụng"). deposit when it reports the ' +
  'account balance after the transaction ("Số dư") or is a balance-change notice ("biến động số ' +
  'dư") on a bank account. ewallet when the sender is an e-wallet (MoMo, ZaloPay, ShopeePay) or ' +
  'the mail says "ví điện tử". When the mail carries none of these signals, answer null. Never ' +
  'guess, because a wrongly claimed credit card invents a debt.\n' +
  'card_tail: on a credit-card payment or repayment mail ("thanh toán thẻ tín dụng", "trả nợ ' +
  'thẻ", a statement payment), the credit card whose balance is being paid down: the card the ' +
  'money goes TO, distinct from the funding account in account_tail. Copy the card number as ' +
  'printed (masked to its last digits is fine). Null on every mail that is not a card repayment, ' +
  'and never guess: a wrong card moves the wrong balance.\n' +
  'account_tail, counterparty_account_tail: the account number as printed (masked is fine).\n' +
  'channel: QR, POS, ATM, online or transfer, only when the mail says which. Otherwise null.\n' +
  'multi: true when this ONE email reports SEVERAL separate transactions (a daily order ' +
  'summary, a list of matched trades). Then answer mail_kind transaction, multi true, and set ' +
  'every other field to null. Otherwise false.';

/* One line per signal: what the MAIL must say for the signal to be answered.
   The keys are contract.mjs SIGNALS, walked, never retyped, so a signal added
   there without a definition here fails pipeline/prompt-blocks.test.js. */
export const SIGNAL_DEFINITIONS = {
  purchase: 'a payment to a merchant: a merchant or POS row, a shop or company as the other side',
  bill_payment: 'a bill paid to a biller: "thanh toán hóa đơn", electricity, water, internet, phone',
  fee: 'a fee the sender itself charged: "phí thường niên", "phí SMS", "phí quản lý tài khoản"',
  p2p: 'money to or from a PERSON: the other side is an individual\'s name or personal account',
  own_transfer: 'between the customer\'s OWN accounts: the counterparty name equals holder_name',
  card_repayment: 'a credit-card bill being paid down ("thanh toán thẻ tín dụng", "dư nợ thẻ") AND the mail names no merchant',
  wallet_move: 'a top-up of, or withdrawal from, an e-wallet to or from a bank account ("nạp tiền vào ví")',
  cash_move: 'an ATM cash withdrawal or a cash deposit',
  savings_move: 'opening or closing a savings or term deposit ("mở / tất toán tiền gửi", "chứng chỉ tiền gửi")',
  broker_funding: 'cash moved into or out of a securities account',
  fx_exchange: 'a purchase or sale of foreign currency',
  securities_trade: 'an executed buy or sell of a stock, fund or bond ("khớp lệnh mua / bán")',
  yield: 'a dividend, a coupon, savings interest, "nhận lợi nhuận"',
  salary: 'payroll wording from an employer ("thanh toán lương", "lương tháng")',
  refund: 'money returned: "hoàn tiền", a reversal, cashback',
  loan_disbursement: 'a loan paid out to the customer ("giải ngân")',
  installment: 'an instalment of a loan or pay-later plan being paid ("trả góp kỳ n")',
};
export const NOTICE_DEFINITIONS = {
  card_due: 'a card payment is due: a due date, a minimum payment, the closing debt',
  installment_due: 'an instalment is due: a reminder before the debit',
  statement_ready: 'a statement is available; no figure moved',
};

const TIE_BREAK =
  'When unsure between a transfer-type signal (own_transfer, card_repayment, wallet_move, cash_move, ' +
  'savings_move, broker_funding, fx_exchange) and purchase or p2p, answer purchase or p2p: a hidden ' +
  'expense is worse than a visible wrong one. When the mail does not say, signal is null. Never ' +
  'fall back to purchase because nothing else fits.';

function _signalLines(keys) {
  return keys.map((k) => '  ' + k + ': ' + (SIGNAL_DEFINITIONS[k] || NOTICE_DEFINITIONS[k])).join('\n');
}

const _BANK_SIGNALS = Object.keys(SIGNALS);
const _BROKER_SIGNALS = ['broker_funding', 'securities_trade', 'yield'];
const _LENDER_SIGNALS = ['loan_disbursement', 'installment'];

export const BLOCKS = {
  /* Banks, e-wallets and gateways: the whole signal list, and the node menu
     limited to the three kinds their mail can be (expense, income, transfer). */
  bank:
    'THIS SENDER IS A BANK, AN E-WALLET OR A PAYMENT GATEWAY.\n' +
    'signal: what the mail ITSELF says the movement was, exactly one of these keys, or null:\n' +
    _signalLines(_BANK_SIGNALS) + '\n' +
    'For a notice (mail_kind notice), signal is one of:\n' + _signalLines(NOTICE_SIGNALS) + '\n' +
    'and fill `notice` {statement_date, due_date, min_payment, closing_debt} with what is printed.\n' +
    TIE_BREAK + '\n' +
    'node: the MOST SPECIFIC category code you are confident about, or null. For money going out, one of: ' +
    EXPENSE_NODE_CODES.join(', ') + '. For money coming in, one of: ' + INCOME_NODE_CODES.join(', ') +
    '. For a movement between the customer\'s own accounts, one of: ' + TRANSFER_NODE_CODES.join(', ') +
    '. Prefer a leaf when the merchant clearly is that; its group when you know the area but not the ' +
    'exact kind; null for the unknowable (a bare transfer to a person, an opaque code).',
  /* Securities houses and investing apps. */
  broker:
    'THIS SENDER IS A SECURITIES BROKER OR AN INVESTING APP.\n' +
    'signal: exactly one of these keys, or null:\n' + _signalLines(_BROKER_SIGNALS) + '\n' +
    'When the mail reports an executed trade, fill `investment`: symbol (the ticker or fund code as ' +
    'printed), side (buy or sell), quantity, unit_price, order_id. Only printed values; null for the ' +
    'rest. amount is the total settled for the trade, as printed.\n' +
    'node: one of ' + [...INVESTMENT_NODE_CODES, 'investfund', 'dividend', 'savinterest'].join(', ') + ', or null.',
  /* Consumer finance and pay-later. */
  lender:
    'THIS SENDER IS A CONSUMER-FINANCE OR PAY-LATER LENDER.\n' +
    'signal: exactly one of these keys, or null:\n' + _signalLines(_LENDER_SIGNALS) + '\n' +
    'For a notice (mail_kind notice), signal is one of:\n' + _signalLines(['installment_due', 'statement_ready']) + '\n' +
    'Fill `loan` with what is printed: contract_tail (the contract number, masked is fine), ' +
    'installment_no, installment_count, due_date (ISO date), principal, interest, remaining_balance. ' +
    'For a notice, fill `notice` {statement_date, due_date, min_payment, closing_debt} instead.\n' +
    // The BORROWING side of the loan tree only: a lender's mail is never the
    // customer lending money out, and 'collect' is a repayment coming IN.
    'node: one of ' + [...LOAN_NODE_CODES.filter((c) => c === 'borrow' || TAX.root(c) === 'borrow'), 'pay'].join(', ') + ', or null.',
};

/** Which block a sender class reads. Anything unknown reads the bank block:
 *  it is the general one, and an unrecognised class must not mean no signals. */
export function blockFor(senderKind) {
  if (senderKind === 'broker') return BLOCKS.broker;
  if (senderKind === 'lender') return BLOCKS.lender;
  return BLOCKS.bank;
}

export function systemPromptFor(senderKind) {
  return CORE_PROMPT + '\n\n' + FIELD_NOTES + '\n\n' + blockFor(senderKind);
}

/** Kept for callers and tests that want "the prompt": the bank one. */
export const EXTRACTION_SYSTEM_PROMPT = systemPromptFor('bank');

const _STR = { type: ['string', 'null'] };
const _NUM = { type: ['number', 'null'] };

/* The fields a label may be cited for (core rule 2). Its own object, with every
   key declared: Gemini refuses an object schema with no properties. */
export const CITABLE_FIELDS = ['amount', 'fx_amount', 'currency', 'occurred_at', 'counterparty', 'memo',
  'reference_number', 'status', 'account_tail', 'balance_after', 'card_tail', 'fee_amount', 'available_limit',
  'holder_name', 'counterparty_bank', 'counterparty_account_tail'];

export const EXTRACTION_SCHEMA = {
  type: 'object',
  properties: {
    /* THE PRIMARY VERDICT (R8). `is_transaction` was a boolean, so a payment-due
       notice had to be called a transaction or junk. It is still derived for
       every existing caller: see normaliseAnswer. */
    mail_kind: { type: 'string', enum: [...MAIL_KINDS] },
    /* One mail, several transactions (a broker's daily order summary). Flagged,
       parked and counted; never read as one row (spec §8.3). */
    multi: { type: ['boolean', 'null'] },
    /* WITNESS CITATIONS, generalised (2026-09-05 asked for two raw substrings;
       rule 2 asks for the LABEL each field was read from). This is what makes a
       format a lookup instead of a regex derivation (formats.mjs). Labels are
       mail text the pipeline already holds: nothing new leaves the machine. */
    labels: { type: ['object', 'null'], properties: Object.fromEntries(CITABLE_FIELDS.map((f) => [f, _STR])) },
    source_provider: _STR,
    occurred_at: _STR,
    occurred_at_raw: _STR,
    time_precision: { type: ['string', 'null'], enum: [...TIME_PRECISIONS, null] },
    amount: _NUM,
    amount_raw: _STR,
    currency: _STR,
    fx_amount: _NUM,
    fx_currency: _STR,
    fx_rate: _NUM,
    fee_amount: _NUM,
    tax_amount: _NUM,
    direction: { type: ['string', 'null'], enum: ['debit', 'credit', null] },
    status: _STR,
    // the customer's own instrument
    account_tail: _STR,
    account_kind: { type: ['string', 'null'], enum: ['credit_card', 'deposit', 'ewallet', null] },
    balance_after: _NUM,
    available_limit: _NUM,
    holder_name: _STR,
    // the other side
    counterparty: _STR,
    counterparty_account_tail: _STR,
    counterparty_bank: _STR,
    counterparty_kind: { type: ['string', 'null'], enum: [...COUNTERPARTY_KINDS, null] },
    card_tail: _STR,
    memo: _STR,
    reference_number: _STR,
    channel: { type: ['string', 'null'], enum: [...CHANNELS, null] },
    /* A closed list (contract.mjs): 20 values, well inside what Gemini's
       OpenAPI subset accepts as an enum. */
    signal: { type: ['string', 'null'], enum: [...Object.keys(SIGNALS), ...NOTICE_SIGNALS, null] },
    /* A PLAIN STRING, NOT AN ENUM (0144): the tree is 217 codes, past what
       Gemini accepts as an enum, and it answered every call with a hard 400.
       The menu rides the block instead, limited to the kinds that sender class
       can produce, and the caller validates the code against the tree. It is
       asked here since 2026-09-22 so a model-read mail costs ONE call, not an
       extraction plus a merchant classification (spec §10.1). */
    node: _STR,
    // kind-specific blocks: an object or null, never a half-filled object
    investment: { type: ['object', 'null'], properties: {
      symbol: _STR, side: { type: ['string', 'null'], enum: ['buy', 'sell', null] },
      quantity: _NUM, unit_price: _NUM, order_id: _STR } },
    loan: { type: ['object', 'null'], properties: {
      contract_tail: _STR, installment_no: _NUM, installment_count: _NUM, due_date: _STR,
      principal: _NUM, interest: _NUM, remaining_balance: _NUM } },
    notice: { type: ['object', 'null'], properties: {
      statement_date: _STR, due_date: _STR, min_payment: _NUM, closing_debt: _NUM } },
    /* NO `flow` AND NO `category` (2026-09-22). Both were judgements the model
       was asked for and staging then discarded or re-derived: flow comes from
       signal + direction (contract.mjs flowFor), the category from the node.
       An answer that still carries them is tolerated, never required. */
  },
  required: [
    'mail_kind', 'multi', 'source_provider', 'occurred_at', 'amount', 'currency', 'direction',
    'counterparty', 'memo', 'reference_number', 'status', 'account_tail', 'signal',
  ],
  additionalProperties: false,
};

/* The model's names, mapped to the ones every other tier and both mappers use.
   The PROMPT says account_tail, balance_after and card_tail because that is
   what the fields mean; the KEYS downstream stay account_masked, balance and
   card_masked, because the device, the dedup engine and every sealed row
   already read them (contract.mjs). An answer in the old names passes through. */
const _ANSWER_RENAMES = [['account_tail', 'account_masked'], ['balance_after', 'balance'], ['card_tail', 'card_masked']];

/**
 * The model's answer as the rest of the pipeline reads it.
 *
 *  - `is_transaction` is DERIVED from `mail_kind` for every existing caller,
 *    and `mail_kind` from `is_transaction` for an answer in the old shape.
 *  - `transaction_type`, the reader's verdict sealed as reader_type, is derived
 *    from the two things that now say it (the signal, the counterparty's kind)
 *    unless the answer still states one.
 *  - an enum the model got wrong is null, not a string nobody can switch on.
 */
export function normaliseAnswer(parsed) {
  if (!parsed || typeof parsed !== 'object') return parsed;
  const x = { ...parsed };
  if (MAIL_KINDS.indexOf(x.mail_kind) < 0) {
    x.mail_kind = x.is_transaction === true ? 'transaction' : (x.is_transaction === false ? 'other' : null);
  }
  x.is_transaction = x.mail_kind === 'transaction';
  x.multi = x.multi === true;
  for (const [from, to] of _ANSWER_RENAMES) {
    if (x[to] == null && x[from] != null) x[to] = x[from];
    delete x[from];
  }
  if (x.labels && typeof x.labels === 'object') {
    const l = { ...x.labels };
    for (const [from, to] of _ANSWER_RENAMES) { if (l[to] == null && l[from] != null) l[to] = l[from]; delete l[from]; }
    x.labels = l;
  } else x.labels = null;
  if (COUNTERPARTY_KINDS.indexOf(x.counterparty_kind) < 0) x.counterparty_kind = null;
  if (CHANNELS.indexOf(x.channel) < 0) x.channel = null;
  if (TIME_PRECISIONS.indexOf(x.time_precision) < 0) x.time_precision = null;
  if (!(SIGNALS[x.signal] || NOTICE_SIGNALS.indexOf(x.signal) >= 0)) x.signal = null;
  if (typeof x.node !== 'string' || !TAX.get(x.node) || TAX.get(x.node).manual) x.node = null;
  for (const k of ['investment', 'loan', 'notice']) {
    const b = x[k];
    if (!b || typeof b !== 'object' || Array.isArray(b) || !Object.values(b).some((v) => v != null)) x[k] = null;
  }
  if (x.is_transaction && !x.transaction_type) {
    x.transaction_type = (x.counterparty_kind === 'person' || x.counterparty_kind === 'self' || x.signal === 'p2p' || x.signal === 'own_transfer') ? 'p2p_transfer'
      : x.signal === 'bill_payment' ? 'bill_payment'
      : (x.counterparty_kind === 'merchant' || x.signal === 'purchase') ? 'ecommerce_receipt'
      : 'bank_txn';
  }
  return x;
}

/**
 * Gemini's `responseSchema` is a restricted OpenAPI-3.0-ish subset, not JSON
 * Schema: no `type: [x, "null"]` union (it wants `nullable: true`), and
 * `additionalProperties` is a hard 400 rather than being ignored. Converted on
 * the way out so EXTRACTION_SCHEMA itself stays the one both transports share.
 *
 * AT EVERY DEPTH (2026-09-22). This used to walk the TOP-LEVEL properties only,
 * which is all the flat extraction schema ever needed. The first nested schema
 * (classify.mjs BATCH_SCHEMA: an array of objects) went through it untouched
 * below the first level, and its caller patched one level by hand. A converter
 * that is correct only for the shapes it has met so far is how
 * `classify_merchant_batch` came to fail 4 of 4 with HTTP 400: every rule above
 * is a hard 400, and any of them surviving anywhere in the tree is enough. So
 * the rewrite now recurses through `properties`, `items` and `anyOf`, and a
 * `required` list inside `items` rides through untouched, as Gemini accepts it.
 * A null inside an `enum` makes the node nullable even when its `type` was not
 * written as a union, because Gemini refuses the null either way.
 */
export function toGeminiSchema(schema) {
  return _geminiNode(JSON.parse(JSON.stringify(schema)));
}

function _geminiNode(node) {
  if (!node || typeof node !== 'object' || Array.isArray(node)) return node;
  delete node.additionalProperties;
  if (Array.isArray(node.type)) {
    const real = node.type.filter((t) => t !== 'null');
    if (real.length !== node.type.length) node.nullable = true;
    node.type = real[0];
  }
  if (Array.isArray(node.enum) && node.enum.indexOf(null) >= 0) {
    node.enum = node.enum.filter((e) => e !== null);
    node.nullable = true;
  }
  if (node.properties && typeof node.properties === 'object') {
    for (const key of Object.keys(node.properties)) node.properties[key] = _geminiNode(node.properties[key]);
  }
  if (node.items) node.items = _geminiNode(node.items);
  if (Array.isArray(node.anyOf)) node.anyOf = node.anyOf.map(_geminiNode);
  return node;
}

/** The model could not be reached, or did not answer usably. */
export class LlmUnavailable extends Error {
  constructor(detail) {
    super('llm_unavailable' + (detail ? ': ' + detail : ''));
    this.name = 'LlmUnavailable';
  }
}

/**
 * A 429 that says WHICH wall we hit, and for how long.
 *
 * Both walls used to arrive as the same opaque LlmUnavailable, and the caller's
 * only move was "hold, retry next run". That is right for the per-minute wall
 * and badly wrong for the per-day one: on 2026-09-02 a mailbox re-read the same
 * window 66 times against an exhausted daily pool while a live transaction sat
 * unstaged inside it. Retrying into a wall we have already been told about is
 * the whole failure.
 *
 * `scope` is what lets the caller stand down for the right length of time.
 */
export class LlmRateLimited extends LlmUnavailable {
  constructor(scope, retryAfterMs, detail) {
    super('rate_limited_' + scope + (detail ? ': ' + detail : ''));
    this.name = 'LlmRateLimited';
    this.scope = scope;                 // 'day' | 'minute'
    this.retryAfterMs = retryAfterMs;   // null on 'day' — the caller uses the Pacific reset
  }
}

/** What a per-minute wall costs us when the body does not say. */
export const DEFAULT_RETRY_AFTER_MS = 30000;

/**
 * Reads a 429 body into {scope, retryAfterMs}.
 *
 * Gemini answers with `error.details[]` carrying a QuotaFailure (whose
 * `quotaId` names the dimension, e.g. GenerateRequestsPerDayPerProjectPerModel
 * vs ...PerMinute...) and often a RetryInfo (`retryDelay: "34s"`).
 *
 * EVERY AMBIGUITY RESOLVES TO 'minute', and that asymmetry is deliberate.
 * Reading a per-minute wall as per-day pauses the whole fleet's capture for
 * hours over one misparse; reading a per-day wall as per-minute costs one
 * wasted request before we hit it again and learn. Those are not comparable, so
 * the tie goes to staying live.
 */
export function rateLimitFrom(bodyText) {
  let details = [];
  try {
    const parsed = JSON.parse(bodyText);
    details = (parsed && parsed.error && parsed.error.details) || [];
  } catch { /* a 429 with an unreadable body is still a 429 */ }

  let scope = null;
  let retryAfterMs = null;

  for (const d of (Array.isArray(details) ? details : [])) {
    const type = String((d && d['@type']) || '');
    if (/QuotaFailure$/.test(type)) {
      for (const v of (d.violations || [])) {
        const id = String((v && (v.quotaId || v.quotaMetric)) || '');
        // Day wins outright: a body naming both dimensions has us past the
        // larger wall, and honouring the smaller one would retry into it.
        if (/PerDay/i.test(id)) { scope = 'day'; break; }
        if (/PerMinute/i.test(id) && !scope) scope = 'minute';
      }
    }
    if (/RetryInfo$/.test(type)) {
      const m = String((d && d.retryDelay) || '').match(/^([\d.]+)s$/);
      if (m) retryAfterMs = Math.round(parseFloat(m[1]) * 1000);
    }
  }

  if (scope !== 'day') scope = 'minute';
  return new LlmRateLimited(
    scope,
    scope === 'minute' ? (retryAfterMs != null ? retryAfterMs : DEFAULT_RETRY_AFTER_MS) : retryAfterMs,
    bodyText ? String(bodyText).slice(0, 200) : '');
}

/**
 * When the daily pool refills: the next midnight America/Los_Angeles, which is
 * 14:00 Vietnam.
 *
 * RPD resets on Google's Pacific calendar day, so every counter and every pause
 * in this pipeline has to be measured there — not on the script's timezone
 * (which is what the Apps Script's own daily cap wrongly used) and not on the
 * database's `current_date`, which is UTC.
 *
 * Intl rather than a fixed -7/-8: the offset moves twice a year, and a
 * hard-coded one is wrong for months at a time without ever throwing.
 */
export function nextPacificReset(nowMs) {
  const now = new Date(nowMs);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles', hour12: false,
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).format(now).split(':').map(Number);
  // Some ICU builds render midnight as 24; fold it so elapsed is never a day.
  const elapsed = (((parts[0] % 24) * 60 + parts[1]) * 60 + parts[2]) * 1000;
  return new Date(nowMs + (86400000 - elapsed));
}

/**
 * Reads one mail. Returns the extraction object, or throws.
 *
 * Throwing rather than returning null: the caller's only sane response is to
 * leave the message for the next poll, and a null would have to be checked at
 * every call site to reach that same outcome. A rate-limited free tier makes
 * this a routine occurrence, not an incident — the mail is read on the next run.
 */
/**
 * The ONE place the app talks to Gemini. Every feature's request goes through
 * here so usage is logged in exactly one spot and can never diverge per caller.
 *
 * It does NOT interpret the answer — callers keep their own success/error/parse
 * rules — it only performs the request, records ONE usage row (best-effort,
 * whatever the outcome), and hands back the raw pieces:
 *   { status, ok, text, data, transportError }
 * `data` is the parsed JSON body (null if it did not parse), `transportError` is
 * true only when the fetch itself threw (network), where `status` is null.
 *
 * The usage row carries no content — feature, model, outcome, the API's own
 * token counts, latency. `cfg.logLlm` is the sink (wired in mailbox-sync); when
 * it is absent (tests, or a caller that opted out) nothing is logged.
 */
export async function callGemini(feature, requestBody, cfg, fetchImpl) {
  const doFetch = fetchImpl || globalThis.fetch;
  const model = (cfg && cfg.model) || DEFAULT_MODEL;
  const url = 'https://generativelanguage.googleapis.com/v1beta/models/' +
    encodeURIComponent(model) + ':generateContent?key=' + encodeURIComponent((cfg && cfg.apiKey) || '');

  const startedMs = Date.now();
  let status = null, ok = false, text = '', data = null, transportError = false;
  try {
    const res = await doFetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
    });
    status = res.status;
    ok = res.ok;
    text = await res.text();
    try { data = JSON.parse(text); } catch { data = null; }
  } catch {
    transportError = true;
  }

  if (cfg && typeof cfg.logLlm === 'function') {
    const usage = (data && data.usageMetadata) || null;
    const outcome = transportError ? 'error' : (status === 429 ? 'rate_limited' : (ok ? 'ok' : 'error'));
    try {
      await cfg.logLlm({
        feature,
        model,
        outcome,
        status_code: status,
        prompt_tokens: usage ? (usage.promptTokenCount ?? null) : null,
        output_tokens: usage ? (usage.candidatesTokenCount ?? null) : null,
        total_tokens: usage ? (usage.totalTokenCount ?? null) : null,
        latency_ms: Date.now() - startedMs,
      });
    } catch { /* monitoring is a bystander — it must never fail a capture */ }
  }

  return { status, ok, text, data, transportError };
}

export async function extract(sender, subject, body, cfg, fetchImpl, senderKind) {
  if (!cfg || !cfg.apiKey) throw new LlmUnavailable('no api key configured');

  // The sender line is named separately from the mail so the model can classify
  // on it. The mail itself follows, as written.
  const mailText = 'Subject: ' + subject + '\n\n' + body;

  const r = await callGemini('extract', {
    // WHAT IS ASKED depends on the sender's class. WHAT IS SENT (the next line)
    // does not, and has not changed: the sender, the subject, the mail as written.
    systemInstruction: { parts: [{ text: systemPromptFor(senderKind) }] },
    contents: [{ role: 'user', parts: [{ text: 'Sender: ' + sender + '\n' + mailText }] }],
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: toGeminiSchema(EXTRACTION_SCHEMA),
    },
  }, cfg, fetchImpl);

  if (r.transportError) throw new LlmUnavailable('fetch failed');
  // Classified BEFORE the generic branch: a 429 is the one non-2xx whose right
  // response is not "hold and retry next run".
  if (r.status === 429) throw rateLimitFrom(r.text);
  if (!r.ok) throw new LlmUnavailable('http ' + r.status + ': ' + r.text.slice(0, 200));

  if (!r.data) throw new LlmUnavailable('response not JSON');
  const answer = r.data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!answer) throw new LlmUnavailable('no candidates');

  let parsed;
  try { parsed = JSON.parse(answer); } catch { throw new LlmUnavailable('answer not JSON'); }
  return normaliseAnswer(parsed);
}
