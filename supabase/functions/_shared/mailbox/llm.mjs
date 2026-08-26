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
 * The prompt and schema are the ones the forwarding pipeline uses, verbatim.
 * They are not copied to be different; they are copied because both transports
 * write into one `sender_fingerprints` cache, so a template derived from one
 * model's output is applied to the other transport's mail. Two prompts would
 * derive two shapes of template for the same bank.
 */

/**
 * Free tier, no card, rate-limited well above what this worker needs given that
 * a learned template costs nothing. Model choice is per-deployment: the schema
 * and prompt do not change with it.
 */
export const DEFAULT_MODEL = 'gemini-3.5-flash-lite';

export const EXTRACTION_SYSTEM_PROMPT =
  'You classify and extract structured data from an email. The email may or may not represent ' +
  'a financial transaction (bank transfer, subscription receipt, e-commerce order, bill payment, ' +
  'P2P transfer). It may be in Vietnamese, English, or mixed.\n\n' +
  'If the email is NOT a transaction record (promotional, newsletter, unrelated notification), ' +
  'set is_transaction to false and leave all other fields null.\n\n' +
  'If it IS a transaction record, extract every field you can find. Use null for anything not ' +
  'present in the email — do not guess or infer values that aren\'t stated.\n\n' +
  'transaction_type: use p2p_transfer when the counterparty is an individual person — identified ' +
  'by a personal name, a phone number, or a personal account/e-wallet, with no indication of a ' +
  'merchant or business. Use bank_txn for other bank-initiated transactions with no clear personal ' +
  'counterparty (fees, interest, transfers to a business/wallet system, generic account activity). ' +
  'Use subscription/ecommerce_receipt/bill_payment for their respective clearly-labeled cases.\n\n' +
  'occurred_at: ISO 8601, and must include a UTC offset. If the email states one, use it. If it ' +
  'doesn\'t (most Vietnamese bank/provider emails don\'t), assume the timestamp is already in the ' +
  'sender\'s local time and attach that offset — for Vietnamese banks and providers this is ' +
  '+07:00. Never output a bare timestamp with no offset.\n\n' +
  'counterparty: copy the full counterparty string exactly as written in the email, including any ' +
  'account number, phone number, or identifier alongside the name — do not shorten or summarize it.\n\n' +
  'memo: the free-text note the payer attached to the transaction — the transfer message, payment ' +
  'reference, order description, or item name. In Vietnamese bank emails this is usually labelled ' +
  '"Nội dung chuyển tiền", "Nội dung giao dịch", "Diễn giải" or similar. Copy it verbatim. This is ' +
  'the only field that can carry the payer\'s own words about WHY the money moved, so never ' +
  'paraphrase it and never substitute a description of your own. Many banks auto-generate this ' +
  'field from the sender name and it carries no real meaning (e.g. "NGUYEN VAN A chuyen tien", ' +
  '"TRANSFER FROM ..."); extract it as written either way and do not try to judge whether it is ' +
  'meaningful — a human reviews it downstream.\n\n' +
  'Amounts must be the raw number with no currency symbol or thousands separators. If the email ' +
  'states a status (success/failed/pending), extract it; otherwise null.\n\n' +
  'flow: what KIND of movement this is, as one of exactly these words.\n' +
  '  income   — money that is genuinely the person\'s to spend: salary, a refund, ' +
  'interest, a p2p transfer someone sent them.\n' +
  '  expense  — money leaving for goods, services, bills or a p2p transfer they sent.\n' +
  '  transfer — the SAME money moving between accounts the person already owns, and ' +
  'therefore neither income nor spending: a credit-card bill payment, a top-up of a ' +
  'wallet from a bank account, a move between own savings and current accounts. ' +
  'Read the memo and the counterparty for this — a counterparty that names a card, a ' +
  'wallet, or the person\'s own name is the signal. When in doubt between transfer ' +
  'and the other two, answer income or expense: calling a real expense a transfer ' +
  'hides it from the ledger entirely, while a transfer filed as an expense is merely ' +
  'wrong and visible.\n' +
  'flow must agree with direction: credit is income or transfer, debit is expense or ' +
  'transfer. Never credit+expense or debit+income.\n\n' +
  'category: what the money was spent ON, as ONE of exactly these words — ' +
  'Housing, Groceries, Clothing, Shopping, Transport, Dining, Fun, Others. ' +
  'Judge from the merchant and the memo together: a coffee shop is Dining, a ' +
  'supermarket is Groceries, a ride-hailing app or fuel is Transport, an ' +
  'electricity or water or internet bill is Housing, a streaming subscription ' +
  'is Fun. Use Others when the mail genuinely does not say what was bought — a ' +
  'bare transfer to a person, or an ATM withdrawal. NULL when it is money ' +
  'coming IN rather than going out: income is not a spending category, and ' +
  'guessing one puts a salary under Shopping.';

export const EXTRACTION_SCHEMA = {
  type: 'object',
  properties: {
    is_transaction: { type: 'boolean' },
    transaction_type: {
      type: ['string', 'null'],
      enum: ['bank_txn', 'subscription', 'ecommerce_receipt', 'p2p_transfer', 'bill_payment', null],
    },
    source_provider: { type: ['string', 'null'] },
    occurred_at: { type: ['string', 'null'] },
    amount: { type: ['number', 'null'] },
    currency: { type: ['string', 'null'] },
    direction: { type: ['string', 'null'], enum: ['debit', 'credit', null] },
    counterparty: { type: ['string', 'null'] },
    memo: { type: ['string', 'null'] },
    reference_number: { type: ['string', 'null'] },
    status: { type: ['string', 'null'] },
    account_masked: { type: ['string', 'null'] },
    /* A CLOSED vocabulary, and the same eight the app already maps to family
       categories (`CONCEPT_MATCH` in 50-sheets-expense-capture.js). Free text
       would be worse than nothing here: the family names its own categories, in
       its own language, so an invented name matches none of them and falls
       through the whole cascade anyway — while looking like an answer.
       Constraining to concepts means the guess is portable across families that
       share no category names at all. */
    /* WHERE THE MONEY LANDS, which `direction` alone cannot answer.
    
       A credit-card bill payment is a debit and is not spending; a wallet top-up
       is a debit and is not spending; both are the same money moving between
       accounts the person already owns. Filing either as an expense double-counts
       against the purchases already recorded on that card.
    
       Kept SEPARATE from `direction` rather than folded into it: direction is a
       fact the mail states plainly and the template path can read without a model,
       while flow is a judgement about what the movement MEANS. Collapsing them
       would make the cheap, reliable field depend on the expensive, fallible one. */
    flow: {
      type: ['string', 'null'],
      enum: ['income', 'expense', 'transfer', null],
    },
    category: {
      type: ['string', 'null'],
      enum: ['Housing', 'Groceries', 'Clothing', 'Shopping', 'Transport', 'Dining', 'Fun', 'Others', null],
    },
  },
  required: [
    'is_transaction', 'transaction_type', 'source_provider', 'occurred_at',
    'amount', 'currency', 'direction', 'counterparty', 'memo', 'reference_number',
    'status', 'account_masked', 'category', 'flow',
  ],
  additionalProperties: false,
};

/**
 * Gemini's `responseSchema` is a restricted OpenAPI-3.0-ish subset, not JSON
 * Schema: no `type: [x, "null"]` union (it wants `nullable: true`), and
 * `additionalProperties` is a hard 400 rather than being ignored. Converted on
 * the way out so EXTRACTION_SCHEMA itself stays the one both transports share.
 */
export function toGeminiSchema(schema) {
  const copy = JSON.parse(JSON.stringify(schema));
  delete copy.additionalProperties;
  for (const key of Object.keys(copy.properties || {})) {
    const prop = copy.properties[key];
    if (Array.isArray(prop.type)) {
      prop.type = prop.type.filter(t => t !== 'null')[0];
      prop.nullable = true;
      if (Array.isArray(prop.enum)) prop.enum = prop.enum.filter(e => e !== null);
    }
  }
  return copy;
}

/** The model could not be reached, or did not answer usably. */
export class LlmUnavailable extends Error {
  constructor(detail) {
    super('llm_unavailable' + (detail ? ': ' + detail : ''));
    this.name = 'LlmUnavailable';
  }
}

/**
 * Reads one mail. Returns the extraction object, or throws.
 *
 * Throwing rather than returning null: the caller's only sane response is to
 * leave the message for the next poll, and a null would have to be checked at
 * every call site to reach that same outcome. A rate-limited free tier makes
 * this a routine occurrence, not an incident — the mail is read on the next run.
 */
export async function extract(sender, subject, body, cfg, fetchImpl) {
  if (!cfg || !cfg.apiKey) throw new LlmUnavailable('no api key configured');
  const doFetch = fetchImpl || globalThis.fetch;
  const model = cfg.model || DEFAULT_MODEL;
  const url = 'https://generativelanguage.googleapis.com/v1beta/models/' +
    encodeURIComponent(model) + ':generateContent?key=' + encodeURIComponent(cfg.apiKey);

  // The sender line is named separately from the mail so the model can classify
  // on it. The mail itself follows, as written.
  const mailText = 'Subject: ' + subject + '\n\n' + body;

  const res = await doFetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: EXTRACTION_SYSTEM_PROMPT }] },
      contents: [{ role: 'user', parts: [{ text: 'Sender: ' + sender + '\n' + mailText }] }],
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: toGeminiSchema(EXTRACTION_SCHEMA),
      },
    }),
  });

  const text = await res.text();
  if (!res.ok) throw new LlmUnavailable('http ' + res.status + ': ' + text.slice(0, 200));

  let data;
  try { data = JSON.parse(text); } catch { throw new LlmUnavailable('response not JSON'); }
  const answer = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!answer) throw new LlmUnavailable('no candidates');

  let parsed;
  try { parsed = JSON.parse(answer); } catch { throw new LlmUnavailable('answer not JSON'); }
  return parsed;
}
