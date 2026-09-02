/**
 * The label-table reader: deterministic extraction for the mail shape that
 * Vietnamese banks actually send.
 *
 * Every transaction notice we have ever seen from a VN bank — MB's tap and
 * transfer notices, Vietcombank's card alerts and biên lai, and their peers —
 * renders as a two-column label/value table. The labels come from a small,
 * stable, bilingual vocabulary ("Số tiền / Amount", "Điểm giao dịch",
 * "Ngày, giờ giao dịch / Trans. Date, Time"); only the values change per mail.
 *
 * Until now that structure was rediscovered the expensive way: the first mails
 * from each (sender, subject) shape went to the model, and a per-shape regex
 * template was derived from its answers. This module reads the structure
 * DIRECTLY: parse the table, look the labels up, normalise the values. No
 * learning phase, no model call, and a bank we have never seen works on its
 * first mail.
 *
 * Where it sits (extract.mjs): after the stored template (which is still the
 * cheapest path), before the model. It returns null unless the mail yields the
 * fields a ledger row cannot exist without — amount, a date-time, and someone
 * on the other side — so anything ambiguous still gets the model's judgement.
 * The confidence gate is the safety argument: marketing mail does not carry
 * an amount row AND a transaction-timestamp row in table form, and a mail that
 * does is a transaction notice by construction.
 *
 * Deliberately NOT handled here: memo boilerplate ("X chuyen tien"), merchant
 * aggregator prefixes, category. Those belong to the tidy layer and the
 * client, which already own them for the other two tiers.
 */

/** One label vocabulary, Vietnamese-first with the English twins the bilingual
 *  banks append. Matched against a diacritic-stripped, lowercased label cell,
 *  by CONTAINS — VCB writes "Số tiền Transaction Amount" as one cell. Order
 *  matters where vocabularies overlap: the first hit wins, so the more specific
 *  entry sits above the generic one ("số tiền phí" must never read as amount). */
const LABELS = [
  /* The absorber row. Sits ABOVE amount so that any "số tiền …" variant that
     is NOT the transaction amount — fees, promo/cashback figures, reward
     points, and the FX rate on an international card notice — is swallowed
     here instead of contains-matching into `amount`. Found by a test fixture:
     "Số tiền khuyến mãi" read as the amount; "Tỷ giá quy đổi" would have
     turned an exchange RATE into a transaction amount the same way. */
  { field: 'charge',       any: ['so tien phi', 'charge amount', 'loai phi', 'ty gia',
                                 'khuyen mai', 'so tien hoan', 'cashback', 'diem thuong', 'tich diem'] },
  /* The converted/billed VND figure an international card notice prints beside
     its foreign transaction amount ("Số tiền quy đổi: 2.923.000 VND"). Above
     `amount` because every key here contains "số tiền" and would be swallowed
     by amount's contains-match. When the mail is foreign-denominated this is
     the number that actually left the account — the bank's own settled
     conversion — so readLabelTable prefers it over the foreign figure. */
  { field: 'converted',    any: ['so tien quy doi', 'so tien ghi no', 'so tien thanh toan',
                                 'billed amount', 'billing amount', 'converted amount'] },
  { field: 'amount',       any: ['so tien giao dich', 'so tien', 'transaction amount', 'amount'] },
  /* An explicit currency row ("Loại tiền: USD"). Some banks denominate the
     amount cell bare and state the currency here instead — without this row
     a USD notice whose amount cell prints no token reads as VND. */
  { field: 'currency_row', any: ['loai tien te', 'loai tien', 'don vi tien te'] },
  { field: 'occurred_at',  any: ['ngay, gio giao dich', 'ngay gio giao dich', 'trans. date', 'date, time', 'thoi gian giao dich'] },
  { field: 'merchant',     any: ['diem giao dich', 'su dung tai', 'merchant'] },
  { field: 'beneficiary',  any: ['ten nguoi huong', 'nguoi thu huong', 'beneficiary name'] },
  { field: 'remitter',     any: ['ten nguoi chuyen', "remitter's name", 'remitter'] },
  { field: 'memo',         any: ['noi dung chuyen tien', 'noi dung', 'details of payment'] },
  { field: 'account',      any: ['tai khoan trich no', 'tai khoan nguon', 'so tai khoan', 'debit account', 'tk cham'] },
  { field: 'reference',    any: ['so lenh giao dich', 'so tham chieu', 'order number', 'ma giao dich', 'reference number'] },
  { field: 'status',       any: ['tinh trang', 'trang thai', 'status'] },
  { field: 'balance',      any: ['so du', 'balance'] },
  { field: 'txn_kind',     any: ['loai giao dich', 'transaction type'] },
  { field: 'card',         any: ['so the', 'the card', 'the'] },
];

function _strip(s) {
  return String(s || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd').replace(/Đ/g, 'D')
    .toLowerCase().replace(/\s+/g, ' ').trim();
}

/** The two text forms one mail can arrive in:
 *
 *  PRODUCTION (mailtext.mjs): every HTML table cell becomes its own LINE, so a
 *  field is a label line followed by its value line — that is the layout the
 *  stored templates anchor on ("Số tiền\\s*\\n\\s*…"), and the one this reader
 *  must speak first.
 *
 *  PIPE TABLES: Gmail's own text/plain rendering (and some forwarding paths)
 *  keeps rows as `| Label | Value |`. Supporting both means the tier reads the
 *  mail wherever it was flattened — and a fixture captured from either source
 *  exercises the same reader.
 *
 *  Rows with more cells than two (VCB's merged fee row) are exactly the ones
 *  whose meaning is NOT one label + one value, so they are skipped, not
 *  guessed at. In line form, a label line whose next line is itself a label is
 *  a field the bank left empty. */
function _rows(body, learned) {
  const out = [];
  const lines = String(body || '').split('\n').map((l) => l.trim());
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    if (line.includes('|')) {
      const cells = line.split('|').map((c) => c.trim()).filter(Boolean);
      if (cells.length === 2) out.push({ label: cells[0], value: cells[1] });
      else if (cells.length === 1 && _lookup(cells[0], learned) && lines[i + 1]) {
        // piped label with its value on the following line
        const next = lines[i + 1].split('|').map((c) => c.trim()).filter(Boolean);
        if (next.length === 1 && !_lookup(next[0], learned)) { out.push({ label: cells[0], value: next[0] }); i++; }
      }
      continue;
    }
    // line form: a known label, value on the next non-empty line
    if (_lookup(line, learned)) {
      let j = i + 1;
      while (j < lines.length && !lines[j]) j++;
      /* BILINGUAL LABELS ARRIVE AS TWO LINES. VCB writes one cell as
         "Sử dụng tại<br>At" — Vietnamese label, English twin — and every block
         tag becomes a newline (mailtext.mjs), so the twin lands where the value
         should be. Taking it blind made every VCB card row's merchant read
         "At" instead of AEON MALL: a real name replaced by a preposition.

         _lookup cannot catch it, because it matches by CONTAINS and "at" is
         not a substring of any Vietnamese label. So the twins are named
         explicitly and skipped, exactly — never by a heuristic like "short and
         alphabetic", which would eat "AEON" and "Circle K" too. */
      while (j < lines.length && _isEnglishTwin(lines[j])) {
        j++;
        while (j < lines.length && !lines[j]) j++;
      }
      const val = (lines[j] || '').replace(/^\|/, '').replace(/\|$/, '').trim();
      /* A "value" that still contains a pipe is a TABLE ROW, not a value — a
         label that swallows one consumes somebody else's data. Leave it for
         the pipe-form branch on its own turn. */
      if (val && !val.includes('|') && !_lookup(val, learned)) { out.push({ label: line, value: val }); i = j; }
    }
  }
  return out;
}

/* The English halves of the bilingual labels VN banks print. Matched EXACTLY
   on the stripped form — a contains-match on 'at' or 'card' would swallow real
   merchant names. Additive: a twin missing from this list only reproduces the
   old behaviour for that one field, never a wrong value elsewhere. */
const ENGLISH_TWINS = new Set([
  'at', 'amount', 'transaction amount', 'card', 'merchant', 'balance', 'status',
  'trans. date, time', 'date, time', 'trans date time', 'transaction date',
  'debit account', 'credit account', 'account', 'account number',
  'status of transaction', 'beneficiary name', 'beneficiary bank name',
  "remitter's name", 'remitters name', 'remitter', 'order number',
  'reference number', 'details of payment', 'content', 'transaction type',
  'charge code', 'charge amount', 'net income', 'vat', 'payment receipt',
  'currency', 'exchange rate', 'billed amount', 'billing amount', 'converted amount',
]);
function _isEnglishTwin(line) {
  return ENGLISH_TWINS.has(_strip(line));
}

/* A label CELL, not prose that happens to contain a label phrase.
 *
 * `includes()` alone matched the footer. Vietcombank signs off with "...liên hệ
 * với các điểm giao dịch của Vietcombank (trong giờ hành chính)", which contains
 * "điểm giao dịch" and was therefore read as a merchant row — putting
 * "Vietcombank (trong giờ hành chính)" into people's ledgers as the shop they
 * visited. Reported from a real queue.
 *
 * Two properties separate a label cell from a sentence, and both are needed:
 * a label is SHORT, and its phrase sits at or near the START. The footer fails
 * both (200+ characters, phrase 150 in); every real label passes both, including
 * the long bilingual ones like "Ngày, giờ giao dịch Trans. Date, Time". */
const MAX_LABEL_LEN = 80;   // the longest real bilingual label seen is 42
const MAX_KEY_START = 24;   // "MB TK chạm" puts its key at 3; prose puts it far in

/* Words that belong to sentences and never to a table label.

   A bank's footer is prose, and prose uses the same nouns the labels do. VCB
   closes with "liên hệ với các điểm giao dịch của Vietcombank (trong giờ hành
   chính)" — which contains "điểm giao dịch", so a contains-match reads it as
   the merchant label and takes the following line as the shop. That is where
   "Vietcombank (trong giờ hành chính)." came from on Trang's cards.

   MAX_LABEL_LEN alone does not catch it: mailtext breaks that sentence across
   lines, and the fragment carrying the noun ("các điểm giao dịch của") is
   short enough to pass a length cap while still being prose. So the two guards
   are complementary — length rejects the run-on clause, these markers reject
   the wrapped one. Both are needed; neither is sufficient. */
const PROSE_MARKERS = [' cua ', ' voi ', ' hoac ', ' cac ', ' den cac ', ' theo ',
  'lien he', 'quy khach', 'vui long', 'xin cam on', 'cam on', 'thank you', 'please '];

function _lookup(labelCell, learned) {
  const flat = _strip(labelCell);
  if (!flat || flat.length > MAX_LABEL_LEN) return null;
  const padded = ' ' + flat + ' ';
  for (const m of PROSE_MARKERS) if (padded.includes(m)) return null;
  for (const entry of LABELS) {
    for (const key of entry.any) {
      const at = flat.indexOf(key);
      /* The bare card key 'the' (thẻ, stripped) must match only at the START.
         As a contains-key it fired inside prose — "Thanh toán THE tin dung VIB
         thành công" — turning a mail's TITLE into a line-form label that then
         swallowed the next table row as its "value". Found by the learned-labels
         suite: the eaten row was the one it expected a vote from. 'so the'
         (Số thẻ) carries the real mid-string use as its own key. */
      if (key === 'the' && at !== 0) continue;
      if (at >= 0 && at <= MAX_KEY_START) return entry.field;
    }
  }
  /* LEARNED mappings (0111), consulted strictly AFTER the hand-authored
     vocabulary declined — hardcoded always wins, so learning can only EXTEND
     the reader, never override it. EXACT match on the stripped form, never
     contains: a learned entry earned trust for one string, not for every
     string containing it. An absent/empty map is byte-for-byte the old
     behaviour, which is the kill-switch contract `delete from learned_labels`
     relies on — pinned in pipeline/learned-labels.test.js. */
  if (learned && learned.size) {
    const f = learned.get(flat);
    if (f) return f;
  }
  return null;
}

/* The English halves of the bilingual labels, as they appear ALONE on a line.
 *
 * Vietcombank's HTML puts "Sử dụng tại" and "At" in separate cells, so the
 * flattened text reads label / English-twin / value — and the reader took the
 * twin as the value, filing every card purchase with the merchant "At".
 *
 * Matched EXACTLY, never as a substring: a merchant genuinely called "AEON" is
 * four letters with no digits and would be indistinguishable from a twin under
 * any looser rule. Exact matching is what keeps a real short merchant name. */
const LABEL_TWINS = new Set([
  'at', 'card', 'amount', 'transaction amount', 'merchant', 'balance',
  'date, time', 'trans. date, time', 'status', 'status of transaction',
  'debit account', 'credit account', 'order number', 'reference number',
  'beneficiary name', "remitter's name", 'remitter', 'details of payment',
  'charge code', 'charge amount', 'transaction type',
  'currency', 'exchange rate', 'billed amount', 'billing amount', 'converted amount',
]);

/* The currencies a VN bank's international card notice actually prints.
 * ISO codes matched as WORDS (a substring match would find 'AUD' inside a
 * merchant name); the four symbols cover the banks that print "$111.00" with
 * no code at all. 'đ' and 'dong' are VND. FIRST occurrence wins, which is
 * also what makes a dual cell like "111 USD (2.923.000 VND)" read as the
 * foreign figure and "2.923.000 VND (111 USD)" read as the VND one — the
 * number the regex grabs is the first number, so the nearest token names it. */
const _CUR_WORD_RE = /\b(USD|EUR|GBP|AUD|SGD|JPY|CNY|KRW|THB|HKD|CHF|CAD|NZD|TWD|MYR|INR|VND)\b|(dong)/i;
const _CUR_SYMBOLS = { '$': 'USD', '€': 'EUR', '£': 'GBP', '¥': 'JPY' };

/** The currency a cell's text names, as an ISO code, or null when it names
 *  none. Word beats symbol beats 'đ' — "US$" resolves via '$' either way. */
export function cellCurrency(raw) {
  const s = String(raw || '');
  const w = s.match(_CUR_WORD_RE);
  if (w) return w[2] ? 'VND' : w[1].toUpperCase();
  const sym = s.match(/[$€£¥]/);
  if (sym) return _CUR_SYMBOLS[sym[0]];
  if (/đ/.test(s)) return 'VND';
  return null;
}

/** A foreign-denominated number in the notations VN banks print them:
 *  "1,234.56" (US), "111.00", "1.234,56" (EU), "111". Decimals are KEPT —
 *  $12.99 is not $12 — which is the opposite of the VND rule below, where a
 *  decimal tail is print noise on a currency that has no cents. */
function _parseForeignNumber(digits) {
  if (/^\d+$/.test(digits)) return parseInt(digits, 10);
  if (/^\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?$/.test(digits)) return parseFloat(digits.replace(/,/g, ''));
  if (/^\d{1,3}(?:\.\d{3})*(?:,\d{1,2})?$/.test(digits)) return parseFloat(digits.replace(/\./g, '').replace(',', '.'));
  if (/^\d+\.\d{1,2}$/.test(digits)) return parseFloat(digits);
  return null;
}

/** "-37,000 VND" | "(VND) 2,000.00" | "15,000 VND" → { value, negative, currency }.
 *  VN bank notation: comma groups thousands; a trailing .00 (or ,00) is decimals.
 *  `currency` is the ISO code the cell itself names, or null when it names
 *  none — the CALLER defaults, so a bare number stays distinguishable from an
 *  explicit "VND". A cell naming a foreign currency parses with decimals kept
 *  ($12.99 stays 12.99); stripping the "USD" token and reading the digits as
 *  VND is exactly how a $111 subscription once staged as 111đ.
 *  Returns null when the cell does not parse as one clean number. */
export function parseAmountCell(raw) {
  const currency = cellCurrency(raw);
  const s = String(raw || '').replace(/VND|đ|dong/gi, '').trim();
  const m = s.match(/(-)?\s*([\d.,]+)/);
  if (!m) return null;
  if (currency && currency !== 'VND') {
    const fv = _parseForeignNumber(m[2].replace(/[.,]+$/, ''));
    if (fv == null || !Number.isFinite(fv) || fv <= 0) return null;
    return { value: fv, negative: !!m[1], currency };
  }
  let digits = m[2];
  // strip ONE decimal tail if present, then everything else is grouping
  digits = digits.replace(/[.,]\d{2}$/, '');
  digits = digits.replace(/[.,]/g, '');
  if (!/^\d+$/.test(digits)) return null;
  const value = parseInt(digits, 10);
  if (!Number.isFinite(value) || value <= 0) return null;
  return { value, negative: !!m[1], currency };
}

/** The three date shapes these banks write, all Vietnam local time:
 *    2026-08-25 18:52:04          (MB card)
 *    26-08-2026 20:04:26          (MB transfer, VCB card — day first)
 *    11:11 Chủ Nhật 23/08/2026    (VCB biên lai — time, weekday, day first)
 *  → ISO string with the +07:00 the mails omit because they never leave VN. */
export function parseWhenCell(raw) {
  const s = String(raw || '').trim();
  let m = s.match(/(\d{4})-(\d{2})-(\d{2})[ T](\d{2}:\d{2}(?::\d{2})?)/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}T${_hms(m[4])}+07:00`;
  m = s.match(/(\d{2})[-\/](\d{2})[-\/](\d{4})\s+(\d{2}:\d{2}(?::\d{2})?)/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}T${_hms(m[4])}+07:00`;
  m = s.match(/(\d{1,2}:\d{2}(?::\d{2})?)\s+.*?(\d{2})[\/\-](\d{2})[\/\-](\d{4})/);
  if (m) return `${m[4]}-${m[3]}-${m[2]}T${_hms(m[1])}+07:00`;
  return null;
}
function _hms(t) { return t.length === 5 ? t + ':00' : t.padStart(8, '0'); }

/** Keep the last four digits, drop the rest. Applied here AND in the tidy layer
 *  (so the older template path is covered too): the sealed box protects these
 *  bytes from everyone else, but a field named `masked` should not be the one
 *  place in the system holding a full account number. */
export function maskAccount(raw) {
  if (raw == null) return raw;
  const s = String(raw);
  const digits = s.replace(/\D/g, '');
  if (digits.length <= 4) return s.trim();
  return '…' + digits.slice(-4);
}

/** Names as banks print them: unaccented uppercase, sometimes trailed by an
 *  account or phone. Same person ⇔ same letters once the tail is dropped. */
function _personKey(raw) {
  return _strip(String(raw || '').replace(/[-–].*$/, '')).replace(/[^a-z ]/g, '').trim();
}

/** Does the mail's own status row say the transaction FAILED? Row-targeted on
 *  purpose: a success mail's footer can contain the words "không thành công"
 *  inside safety advice, so only the status field's value gets to answer. The
 *  stored templates cannot ask this question — several staticised status as
 *  success at derivation — so extract.mjs asks it here for every tier. A
 *  declined attempt staged as spending is money the ledger loses twice. */
export function statusReadsFailed(body) {
  for (const row of _rows(body)) {
    if (_lookup(row.label) !== 'status') continue;
    return /khong thanh cong|that bai|tu choi|bi huy|failed|declined|unsuccessful|reversed/.test(_strip(row.value));
  }
  return false;
}

/** Label cells the dictionary did NOT resolve — the one piece of "training
 *  data" this pipeline is allowed to collect. Labels are the bank's own
 *  boilerplate ("Số tiền khuyến mãi", "Mã đơn hàng"); the VALUES never leave.
 *  Pipe rows give labels directly; in line form a label is guessed by shape —
 *  short, no digit runs, sitting right above a line that has digits. */
export function unknownLabels(body) {
  const out = new Set();
  const lines = String(body || '').split('\n').map((l) => l.trim());

  /* Widened 2026-08-30. The old line-form rule required the NEXT line to contain
     a digit, which is true of an amount or a date and false of a merchant, a
     beneficiary or a payment note — so a whole bank could go through the model
     hundreds of times and record nothing. VIB did exactly that: 180 model calls,
     two rows captured, both MoMo. A dictionary gap that cannot be seen cannot be
     closed.
  
     The replacement asks what a LABEL looks like rather than what its value
     looks like: short, few words, no long digit run, not a sentence, and
     followed by something that is not itself a label. */
  const looksLikeLabel = (t) =>
    !!t && t.length <= 64 && t.split(/\s+/).length <= 8 &&
    !/\d{4,}/.test(t) && !/[.!?:;]$/.test(t) && !_lookup(t);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;

    if (line.includes('|')) {
      const cells = line.split('|').map((c) => c.trim()).filter(Boolean);
      if (cells.length === 2 && looksLikeLabel(cells[0])) out.add(cells[0]);
      continue;
    }
    if (_lookup(line)) continue;
    if (!looksLikeLabel(line)) continue;
    let j = i + 1;
    while (j < lines.length && !lines[j]) j++;
    const next = lines[j];
    // A label is followed by a VALUE, not by another label and not by nothing.
    if (next && !_lookup(next)) out.add(line);
  }
  return [...out].slice(0, 24);
}

/**
 * The vocabulary learns — CONSERVATIVELY, and every limit here is a scar.
 *
 * When the model reads a mail this dictionary could not, the caller holds both
 * the body and the answer. A (label, value) row whose value EQUALS a field of
 * that answer is one vote that the label means that field: "Diễn giải" beside
 * the memo the model reported teaches `dien giai → memo`. Same inversion
 * deriveExtractionTemplate performs per-shape, one level of generality up.
 *
 * What a vote is NOT: truth. The reader applies a mapping only at n>=3 from
 * one sender domain (db.loadLearnedLabels) — one equal value is a coincidence,
 * three is a layout. And these fields may NEVER be learned, in this order of
 * why: amount and occurred_at have absorbers and format rules a heuristic
 * would subvert into a wrong number in a ledger; account is a masking surface;
 * status gates staging. merchant/beneficiary are learned only under the
 * transaction type that disambiguates them, because `who` feeds the
 * self-transfer check and a swapped mapping would misfile transfers.
 *
 * Returns [{label, field}] — label is the STRIPPED form, the reader's own
 * matching key, and never a value from the mail.
 */
export function deriveLabelMappings(body, reading) {
  if (!reading || reading.is_transaction !== true) return [];
  const votes = new Map();           // label_norm -> field | null(=ambiguous, drop)
  const consider = (label, field) => {
    if (votes.has(label) && votes.get(label) !== field) votes.set(label, null);
    else votes.set(label, field);
  };
  const eq = (v, target) => {
    const a = String(v == null ? '' : v).trim();
    const b = String(target == null ? '' : target).trim();
    return a.length >= 3 && a === b;
  };
  for (const row of _rows(body)) {
    const lab = _strip(row.label);
    if (!lab || lab.length < 3 || lab.length > 64) continue;
    if (/\d{4,}/.test(lab)) continue;                 // a "label" with a number in it is a value
    if (_lookup(row.label)) continue;                  // already known — nothing to learn
    if (eq(row.value, reading.memo)) consider(lab, 'memo');
    if (eq(row.value, reading.reference_number)) consider(lab, 'reference');
    if (eq(row.value, reading.counterparty)) {
      if (reading.transaction_type === 'p2p_transfer') consider(lab, 'beneficiary');
      else if (reading.transaction_type === 'ecommerce_receipt') consider(lab, 'merchant');
      // any other type: the value matched but nothing disambiguates who the
      // counterparty IS — no vote at all beats a coin-flip vote
    }
  }
  const out = [];
  for (const [label, field] of votes) if (field) out.push({ label, field });
  return out;
}

export function readLabelTable(subject, body, learned) {
  const rows = _rows(body, learned);
  if (rows.length < 3) return null;

  const got = {};
  for (const row of rows) {
    const field = _lookup(row.label, learned);
    if (field && !(field in got)) got[field] = row.value;   // first hit wins; later dupes are footer noise
  }

  /* The amount, in the mail's own currency. Three rows can carry money here:
     the transaction amount, the converted/billed VND figure an international
     card notice prints beside it, and an explicit currency row. The rules:

       - a VND (or unmarked) transaction amount is the amount, as ever;
       - a FOREIGN transaction amount with a converted-VND row beside it takes
         the CONVERTED figure — that is the bank's own settled conversion, the
         money that actually left the account — and the foreign original rides
         along as fx_amount/fx_currency so the reviewer still sees "$111";
       - a foreign amount with NO converted row stays foreign, honestly: the
         reviewer types the VND figure at review. Defaulting it to VND is how
         a $111 subscription staged as 111đ;
       - a converted row with no transaction-amount row IS the amount (some
         banks label their only figure "Số tiền ghi nợ"). */
  let amtRaw = parseAmountCell(got.amount);
  const conv = got.converted ? parseAmountCell(got.converted) : null;
  const convVnd = (conv && (conv.currency == null || conv.currency === 'VND')) ? conv : null;
  const curRow = got.currency_row ? cellCurrency(got.currency_row) : null;
  // A bare amount cell named foreign only by the currency ROW parsed under the
  // VND rule (decimal tail = print noise) and would lose its cents — re-read
  // it under the currency the row names.
  if (amtRaw && !amtRaw.currency && curRow && curRow !== 'VND') {
    amtRaw = parseAmountCell(String(got.amount) + ' ' + curRow) || amtRaw;
  }
  const txnCur = amtRaw ? (amtRaw.currency || curRow || 'VND') : null;

  let amt = amtRaw, currency = txnCur, fxAmount = null, fxCurrency = null;
  if (amtRaw && txnCur !== 'VND' && convVnd) {
    amt = convVnd; currency = 'VND';
    fxAmount = amtRaw.value; fxCurrency = txnCur;
  } else if (!amtRaw && convVnd) {
    amt = convVnd; currency = 'VND';
  }

  const when = got.occurred_at ? parseWhenCell(got.occurred_at) : null;
  const who = got.merchant || got.beneficiary || null;

  // The confidence gate. Money, a moment, and a counterpart (or at least a
  // memo): anything less is not a ledger row, and the model gets to judge it.
  if (!amt || !when || !(who || got.memo)) return null;

  const kindFlat = _strip((got.txn_kind || '') + ' ' + (subject || ''));
  const refund = /hoan tien|refund|ghi co/.test(kindFlat + ' ' + _strip(got.status || ''));
  const isTransfer = !!(got.beneficiary || got.remitter)
    || /chuyen tien|chuyen khoan|bien lai/.test(kindFlat);

  // Direction: the sign when the bank prints one; otherwise the document kind.
  // A card notice or an outgoing transfer is money leaving; a refund is not.
  // The sign lives on the TRANSACTION amount row even when the converted VND
  // figure is the one being taken — banks print "-111 USD" and an unsigned
  // conversion beside it.
  const negative = amtRaw ? amtRaw.negative : amt.negative;
  const direction = negative ? 'debit' : (refund ? 'credit' : 'debit');

  // Self-transfer: the sender and the beneficiary are the same letters. That
  // is the person moving money between their own pockets, and filing it as an
  // expense would quietly shrink a ledger by money that never left. The sender
  // side comes from the remitter row where the bank prints one (VCB), or from
  // the holder name inside the debit-account cell where it does not (MB writes
  // "NGUYEN THU TRANG - 3510…" as the account value and has no remitter row).
  const senderName = _personKey(got.remitter) || _personKey(got.account);
  const self = !!(senderName && got.beneficiary && senderName === _personKey(got.beneficiary));

  return {
    is_transaction: true,
    transaction_type: isTransfer ? 'p2p_transfer' : 'ecommerce_receipt',
    source_provider: null,                       // worker falls back to the sender registry
    occurred_at: when,
    amount: amt.value,
    /* The currency the amount is REALLY in. 'VND' was hardcoded here until
       2026-09-03, which — with parseAmountCell then discarding the USD token —
       is the whole USD-as-VND defect (foreign-currency-emails-spec.md §2.1). */
    currency,
    /* The foreign original, when the converted VND figure was preferred over
       it. Provenance for the reviewer ("2.923.000 ₫ ≈ $111") and for the
       ledger row's note; null on every domestic mail. */
    fx_amount: fxAmount,
    fx_currency: fxCurrency,
    direction,
    counterparty: who,
    memo: got.memo || null,
    reference_number: got.reference || null,
    status: got.status || null,
    /* AS THE MAIL PRINTED IT, not masked here (2026-09-02). Masking moved to
       the one place every tier's output already passes through — `_tidy` in
       extract.mjs — because masking BEFORE the template learner ran was
       silently killing graduation: the learner requires each value verbatim in
       the body, `…9979` never is, and a shape that cannot graduate pays a
       model call per mail forever. Three of the five real shapes we hold were
       blocked by exactly this. The last-four-only invariant is unchanged and
       still pinned in tests — what changed is WHERE it is enforced, not
       whether. Nothing reads this tier's output except extract.mjs, which
       tidies, and the learner, which needs the raw. */
    account_masked: got.account || null,
    category: null,                              // the client's learning owns this
    flow: self ? 'transfer' : null,              // anything else is stage.mjs's judgement
    balance: got.balance ? (parseAmountCell(got.balance) || {}).value ?? null : null,
  };
}
