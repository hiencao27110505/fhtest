/**
 * The reading contract, payload v2: ONE definition of what a read mail states.
 *
 * Why this file exists. Until now the shape of a reading lived in five places
 * that had to agree by hand: the model's response schema (llm.mjs), the table
 * reader's output (labeltable.mjs), the template's field list (templates.mjs),
 * and the two mappers that carry a reading into the sealed box
 * (worker.mjs `_toReading`, ingest.mjs `normaliseReading`). They did not agree:
 * `status` and the reader's own verdict were dropped on the way in, `channel`
 * was never set by anyone, and a field added to one mapper and not the other
 * sealed every row without it for good, because a box is never amended
 * (card-repayment-routing-spec.md §7.4, "the mapping IS the wire").
 *
 * So the list is here, once. Every tier fills what it can and leaves the rest
 * null; both mappers walk THIS list; the device's opener is pinned against it
 * by tools/payload-v2-contract.test.js. Design and reasons:
 * docs/specs/email-reading-v2-spec.md §4 (fields), §5 (signals), §6 (notices).
 *
 * Everything listed under `raw` lives INSIDE `raw_extracted`, inside the sealed
 * box. Nothing here is a column. The six top-level payload keys and the clear
 * columns are untouched, and so is the 0068 CHECK.
 */

/** Bumped only when a key changes MEANING. Adding a nullable key does not bump it. */
export const PAYLOAD_V = 2;

/** Where a field's value came from. It decides where a row is SHOWN at review,
 *  never whether it imports (spec §3). */
export const SRC = Object.freeze({
  PRINTED: 'printed',     // read off a labelled row or a printed sign in this mail
  TEMPLATE: 'template',   // read by a stored format or a legacy v4 template
  MODEL: 'model',         // judged by the model
  HEURISTIC: 'heuristic', // derived by a rule over free text (the signal detector, a body scan)
});

export const SENDER_KINDS = Object.freeze(['bank', 'wallet', 'gateway', 'broker', 'lender', 'biller', 'receipt']);

export const MAIL_KINDS = Object.freeze(['transaction', 'notice', 'other']);

export const COUNTERPARTY_KINDS = Object.freeze(['person', 'merchant', 'bank', 'wallet', 'self', 'unknown']);

export const CHANNELS = Object.freeze(['QR', 'POS', 'ATM', 'online', 'transfer']);

export const TIME_PRECISIONS = Object.freeze(['second', 'minute', 'day']);

/**
 * Signals: what the mail ITSELF can say about the movement. Decidable from the
 * mail alone; the device decides the KIND by combining a signal with what only
 * it knows (owned accounts, debts, positions, lessons). Direction is a separate
 * field, so one signal covers both ways.
 *
 * `node` is the taxonomy code a signal maps to when it maps to exactly one;
 * `nodes` lists the candidates when the mail's own words must pick (the reader
 * picks among THESE, never outside them); null means the merchant path decides.
 * Every code exists in taxonomy/taxonomy.json; pipeline/contract.test.js pins that.
 *
 * `proposes` is the review kind the device pre-selects when nothing it owns
 * contradicts it, in the vocabulary of csvRowKindCur (56-csv-import-ui.js).
 */
export const SIGNALS = Object.freeze({
  purchase:          { node: null,                                    proposes: 'expense' },
  bill_payment:      { nodes: ['utilities'],                          proposes: 'expense' },
  fee:               { nodes: ['bankfees', 'fees'],                   proposes: 'expense' },
  p2p:               { node: null,                                    proposes: null },       // expense or income by direction; the lending pass may override
  own_transfer:      { node: 'bankbank',                              proposes: 'xfer' },
  card_repayment:    { node: 'cardpay',                               proposes: 'cardpay' },
  wallet_move:       { node: 'wallet',                                proposes: 'xfer' },
  cash_move:         { nodes: ['cashout', 'cashin'],                  proposes: 'xfer' },
  savings_move:      { nodes: ['savings', 'termdeposit'],             proposes: 'xfer' },
  broker_funding:    { node: 'investfund',                            proposes: 'xfer' },
  fx_exchange:       { node: 'fx',                                    proposes: 'xfer' },
  securities_trade:  { nodes: ['stock', 'fund', 'bond'],              proposes: 'invest' },
  yield:             { nodes: ['dividend', 'savinterest'],            proposes: 'income' },
  salary:            { node: 'wage',                                  proposes: 'income' },
  refund:            { nodes: ['purchaserefund', 'cashback'],         proposes: 'income' },
  loan_disbursement: { nodes: ['bankloan', 'consumerfinance', 'bnpl'], proposes: 'loan' },
  installment:       { node: 'pay',                                   proposes: 'repay' },
});

/** Mail that moves no money (spec §6). Staged with row_kind 'notice'; never a review card. */
export const NOTICE_SIGNALS = Object.freeze(['card_due', 'installment_due', 'statement_ready']);

/**
 * Every key a v2 `raw_extracted` may carry, beyond the ones v1 already carries.
 * type: 'num' | 'str' | 'enum' | 'obj' | 'arr'.  `since: 1` marks a v1 key that
 * is listed so both mappers carry it from ONE list (they used to disagree).
 *
 * A key is null when the mail does not state it. Null always beats a guess.
 */
export const RAW_FIELDS = Object.freeze([
  // money
  { key: 'fx_amount',        type: 'num',  since: 1 },
  { key: 'fx_currency',      type: 'str',  since: 1 },
  { key: 'fx_rate',          type: 'num',  since: 2 },
  { key: 'fee_amount',       type: 'num',  since: 2 },
  { key: 'tax_amount',       type: 'num',  since: 2 },
  { key: 'status',           type: 'str',  since: 1 },
  // time
  { key: 'occurred_at',      type: 'str',  since: 1 },
  { key: 'time_precision',   type: 'enum', since: 2, values: TIME_PRECISIONS },
  // the person's own instrument
  { key: 'account_masked',   type: 'str',  since: 1 },     // v2 name in prose: account_tail. The KEY stays account_masked: the device, the dedup engine and every sealed row already read it.
  { key: 'account_kind',     type: 'enum', since: 1, values: ['credit_card', 'deposit', 'ewallet'] },
  { key: 'balance',          type: 'num',  since: 1 },     // balance_after in prose; same reason
  { key: 'available_limit',  type: 'num',  since: 2 },
  { key: 'holder_name',      type: 'str',  since: 2 },
  // the other side
  { key: 'counterparty_raw',          type: 'str',  since: 2 },
  { key: 'counterparty_account_tail', type: 'str',  since: 2 },
  { key: 'counterparty_bank',         type: 'str',  since: 2 },
  { key: 'counterparty_kind',         type: 'enum', since: 2, values: COUNTERPARTY_KINDS },
  // card repayment
  { key: 'card_masked',      type: 'str',  since: 1 },     // card_tail in prose
  // words
  { key: 'memo',             type: 'str',  since: 1 },
  { key: 'memo_display',     type: 'str',  since: 1 },     // '' is a VERDICT ("says nothing"), never resurrect it with ||
  { key: 'type_code',        type: 'str',  since: 1 },
  { key: 'channel',          type: 'enum', since: 1, values: CHANNELS },
  // meaning
  { key: 'mail_kind',        type: 'enum', since: 2, values: MAIL_KINDS },
  { key: 'signal',           type: 'enum', since: 2, values: [...Object.keys(SIGNALS), ...NOTICE_SIGNALS] },
  { key: 'node',             type: 'str',  since: 1 },
  { key: 'category_hint',    type: 'str',  since: 1 },     // the legacy 8-concept word; kept so old clients keep working (category-tree C5)
  { key: 'flow',             type: 'enum', since: 1, values: ['income', 'expense', 'transfer'] }, // legacy; derived from signal+direction for v2 rows
  { key: 'reader_type',      type: 'str',  since: 1 },
  { key: 'sender_kind',      type: 'enum', since: 1, values: SENDER_KINDS },
  { key: 'txn_source',       type: 'str',  since: 1 },
  // kind-specific blocks: an object or null, never a half-filled object
  { key: 'investment',       type: 'obj',  since: 2, keys: ['symbol', 'side', 'quantity', 'unit_price', 'order_id'] },
  { key: 'loan',             type: 'obj',  since: 2, keys: ['contract_tail', 'installment_no', 'installment_count', 'due_date', 'principal', 'interest', 'remaining_balance'] },
  { key: 'notice',           type: 'obj',  since: 2, keys: ['statement_date', 'due_date', 'min_payment', 'closing_debt'] },
  { key: 'bill',             type: 'obj',  since: 2, keys: ['biller', 'customer_code', 'period'] },                       // wave 2
  { key: 'receipt',          type: 'obj',  since: 2, keys: ['service_type', 'order_id', 'paid_with_tail', 'line_items'] }, // wave 2; NEVER an address
  // provenance
  { key: 'v',                type: 'num',  since: 2 },
  { key: 'src',              type: 'obj',  since: 2 },     // { <field>: one of SRC }
  { key: '_transport',       type: 'str',  since: 1 },
  { key: '_sender_auth',     type: 'obj',  since: 1 },
]);

export const RAW_KEYS = Object.freeze(RAW_FIELDS.map((f) => f.key));

/** True when `value` is acceptable for `field`: null always is. A wrong enum value
 *  is dropped to null by the mappers rather than sealed, because a sealed row is
 *  one nobody can inspect afterwards to find out what went wrong. */
export function fieldAccepts(field, value) {
  if (value == null) return true;
  if (field.type === 'num') return typeof value === 'number' && Number.isFinite(value);
  if (field.type === 'str') return typeof value === 'string';
  if (field.type === 'enum') return field.values.includes(value);
  if (field.type === 'arr') return Array.isArray(value);
  if (field.type === 'obj') return typeof value === 'object' && !Array.isArray(value);
  return false;
}

/** The legacy three-value `flow`, derived so v1 readers of a v2 row see what they
 *  always saw. Direction wins over any judgment, as stage.mjs has always ruled:
 *  a credit is income or transfer, a debit is expense or transfer. */
export function flowFor(signal, direction) {
  const s = signal && SIGNALS[signal];
  if (s && (s.proposes === 'xfer' || s.proposes === 'cardpay')) return 'transfer';
  if (direction === 'credit') return 'income';
  if (direction === 'debit') return 'expense';
  return null;
}
